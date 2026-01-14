import type { Api } from 'grammy';
import { InputFile, InlineKeyboard } from 'grammy';
import logger from '../utils/logger.js';
import redis from '../redis/client.js';
import { 
  getDailyReminderDataKey,
  getMissedCheckDataKey,
  getNotificationLockKey,
  getMissedNotificationSentKey,
  getDailyRemindersListKey,
  getMissedChecksListKey,
  getDailyHealthCheckLockKey,
  getMissedDayNotificationDataKey,
  getMissedDayNotificationsListKey,
} from '../redis/keys.js';
import { challengeService } from './challenge.service.js';
import { userService } from './user.service.js';
import { getRandomReminderPhrase } from '../utils/motivational-phrases.js';
import { getMissedDayImagePath } from '../utils/missed-days-images.js';
import { getYesterdayDateString } from '../utils/date-utils.js';
import { handleChallengeStatsScene } from '../scenes/challenge-stats.scene.js';
import { handleTelegramError } from '../utils/telegram-error-handler.js';
import { BUTTONS, MESSAGES } from '../scenes/messages.js';

interface DailyReminderData {
  userId: number;
  scheduledTime: string; // ISO string
  reminderTime: string; // HH:MM
  timezone: number;
  challengeId: number;
}

interface MissedCheckData {
  userId: number;
  scheduledTime: string; // ISO string
  timezone: number;
  challengeId: number;
  challengeStartDate: string; // ISO string
}

interface MissedDayNotificationData {
  userId: number;
  scheduledTime: string; // ISO string
  timezone: number;
  challengeId: number;
  daysWithoutWorkout: number;
  isFailed: boolean;
}

interface ScheduledReminder {
  userId: number;
  timeoutId: NodeJS.Timeout;
  scheduledTime: Date;
}

interface ScheduledMissedCheck {
  userId: number;
  timeoutId: NodeJS.Timeout;
  scheduledTime: Date;
}

interface ScheduledMissedDayNotification {
  userId: number;
  timeoutId: NodeJS.Timeout;
  scheduledTime: Date;
}

class NotificationService {
  private dailyReminders = new Map<number, ScheduledReminder>();
  private missedChecks = new Map<number, ScheduledMissedCheck>();
  private missedDayNotifications = new Map<number, ScheduledMissedDayNotification>();
  private botApi: Api | null = null;
  private dailyHealthCheckTimeoutId: NodeJS.Timeout | null = null;

  /**
   * Устанавливает API бота
   */
  setBotApi(api: Api): void {
    this.botApi = api;
  }

  /**
   * Конвертирует UTC время в локальное время пользователя
   */
  private getLocalTime(utcTime: Date, timezone: number): Date {
    const timezoneOffsetMs = timezone * 60 * 60 * 1000;
    return new Date(utcTime.getTime() + timezoneOffsetMs);
  }

  /**
   * Форматирует время до уведомления в читаемом виде
   */
  private formatTimeUntil(delayMs: number): string {
    const seconds = Math.floor(delayMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      const remainingHours = hours % 24;
      if (remainingHours > 0) {
        return `${days} дн. ${remainingHours} ч.`;
      }
      return `${days} дн.`;
    } else if (hours > 0) {
      const remainingMinutes = minutes % 60;
      if (remainingMinutes > 0) {
        return `${hours} ч. ${remainingMinutes} мин.`;
      }
      return `${hours} ч.`;
    } else if (minutes > 0) {
      return `${minutes} мин.`;
    } else {
      return `${seconds} сек.`;
    }
  }

  /**
   * Форматирует дату и время в локальном часовом поясе
   */
  private formatLocalDateTime(localTime: Date): string {
    const year = localTime.getUTCFullYear();
    const month = String(localTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(localTime.getUTCDate()).padStart(2, '0');
    const hours = String(localTime.getUTCHours()).padStart(2, '0');
    const minutes = String(localTime.getUTCMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  /**
   * Вычисляет следующее время ежедневного уведомления с учетом часового пояса
   */
  private getNextReminderTime(reminderTime: string, timezone: number): Date {
    const now = new Date();
    const [hours, minutes] = reminderTime.split(':').map(Number);
    
    // Смещение часового пояса в миллисекундах
    const timezoneOffsetMs = timezone * 60 * 60 * 1000;
    
    // Получаем текущее время в UTC (миллисекунды)
    const nowUtcMs = now.getTime();
    
    // Вычисляем текущее время в локальном часовом поясе пользователя
    const localNowMs = nowUtcMs + timezoneOffsetMs;
    
    // Вычисляем начало текущего дня в локальном времени (00:00:00)
    const msPerDay = 24 * 60 * 60 * 1000;
    const localDayStartMs = Math.floor(localNowMs / msPerDay) * msPerDay;
    
    // Время напоминания сегодня в локальном времени (в миллисекундах)
    const targetLocalMs = localDayStartMs + (hours * 60 * 60 * 1000) + (minutes * 60 * 1000);
    
    // Если время напоминания уже прошло сегодня, планируем на завтра
    const nextTargetLocalMs = targetLocalMs <= localNowMs 
      ? targetLocalMs + msPerDay 
      : targetLocalMs;
    
    // Конвертируем обратно в UTC: вычитаем смещение часового пояса
    const nextTargetUtcMs = nextTargetLocalMs - timezoneOffsetMs;
    
    return new Date(nextTargetUtcMs);
  }

  /**
   * Вычисляет время следующего уведомления о пропущенном дне в установленное пользователем время
   * @param reminderTime - время напоминания (HH:MM) или null для использования 12:00 МСК
   * @param timezone - часовой пояс пользователя
   * @returns Дата следующего уведомления
   */
  private getNextNotificationTime(reminderTime: string | null, timezone: number): Date {
    const now = new Date();
    
    // Если время не установлено, используем 12:00 МСК (timezone = 3)
    const notificationTime = reminderTime || '12:00';
    const notificationTimezone = reminderTime ? timezone : 3; // Если время не установлено, используем МСК
    
    const [hours, minutes] = notificationTime.split(':').map(Number);
    
    // Смещение часового пояса в миллисекундах
    const timezoneOffsetMs = notificationTimezone * 60 * 60 * 1000;
    
    // Получаем текущее время в локальном часовом поясе
    const localNowMs = now.getTime() + timezoneOffsetMs;
    const msPerDay = 24 * 60 * 60 * 1000;
    const localDayStartMs = Math.floor(localNowMs / msPerDay) * msPerDay;
    
    // Время уведомления сегодня в локальном времени (в миллисекундах)
    const todayNotificationLocalMs = localDayStartMs + (hours * 60 * 60 * 1000) + (minutes * 60 * 1000);
    
    // Если время уведомления уже прошло сегодня, планируем на завтра
    const nextNotificationLocalMs = todayNotificationLocalMs <= localNowMs 
      ? todayNotificationLocalMs + msPerDay 
      : todayNotificationLocalMs;
    
    // Конвертируем обратно в UTC
    const nextNotificationUtcMs = nextNotificationLocalMs - timezoneOffsetMs;
    return new Date(nextNotificationUtcMs);
  }


  /**
   * Сохраняет ежедневное уведомление в Redis
   */
  private async saveDailyReminderToRedis(
    userId: number,
    reminderTime: string,
    timezone: number,
    scheduledTime: Date,
    challengeId: number
  ): Promise<void> {
    try {
      const data: DailyReminderData = {
        userId,
        scheduledTime: scheduledTime.toISOString(),
        reminderTime,
        timezone,
        challengeId,
      };

      const ttlSeconds = Math.ceil((scheduledTime.getTime() - Date.now()) / 1000) + 86400; // TTL = время до выполнения + 1 день
      await redis.set(
        getDailyReminderDataKey(userId),
        JSON.stringify(data),
        'EX',
        ttlSeconds > 0 ? ttlSeconds : 86400
      );

      // Добавляем в список
      const listKey = getDailyRemindersListKey();
      await redis.sadd(listKey, userId.toString());
    } catch (error) {
      logger.error(`Error saving daily reminder to Redis for user ${userId}:`, error);
    }
  }

  /**
   * Сохраняет проверку пропущенных дней в Redis
   * @deprecated Больше не используется, так как проверка выполняется только в 4:00 МСК
   * @internal
   */
  // @ts-expect-error - Deprecated method, kept for backward compatibility
  private async saveMissedCheckToRedis(
    userId: number,
    timezone: number,
    scheduledTime: Date,
    challengeId: number,
    challengeStartDate: Date
  ): Promise<void> {
    try {
      const data: MissedCheckData = {
        userId,
        scheduledTime: scheduledTime.toISOString(),
        timezone,
        challengeId,
        challengeStartDate: challengeStartDate.toISOString(),
      };

      const ttlSeconds = Math.ceil((scheduledTime.getTime() - Date.now()) / 1000) + 86400;
      await redis.set(
        getMissedCheckDataKey(userId),
        JSON.stringify(data),
        'EX',
        ttlSeconds > 0 ? ttlSeconds : 86400
      );

      // Добавляем в список
      const listKey = getMissedChecksListKey();
      await redis.sadd(listKey, userId.toString());
    } catch (error) {
      logger.error(`Error saving missed check to Redis for user ${userId}:`, error);
    }
  }

  /**
   * Удаляет ежедневное уведомление из Redis
   */
  private async removeDailyReminderFromRedis(userId: number): Promise<void> {
    try {
      await redis.del(getDailyReminderDataKey(userId));
      const listKey = getDailyRemindersListKey();
      await redis.srem(listKey, userId.toString());
    } catch (error) {
      logger.error(`Error removing daily reminder from Redis for user ${userId}:`, error);
    }
  }

  /**
   * Удаляет проверку пропущенных дней из Redis
   */
  private async removeMissedCheckFromRedis(userId: number): Promise<void> {
    try {
      await redis.del(getMissedCheckDataKey(userId));
      const listKey = getMissedChecksListKey();
      await redis.srem(listKey, userId.toString());
    } catch (error) {
      logger.error(`Error removing missed check from Redis for user ${userId}:`, error);
    }
  }

  /**
   * Сохраняет уведомление о пропущенном дне в Redis
   */
  private async saveMissedDayNotificationToRedis(
    userId: number,
    scheduledTime: Date,
    timezone: number,
    challengeId: number,
    daysWithoutWorkout: number,
    isFailed: boolean
  ): Promise<void> {
    try {
      const data: MissedDayNotificationData = {
        userId,
        scheduledTime: scheduledTime.toISOString(),
        timezone,
        challengeId,
        daysWithoutWorkout,
        isFailed,
      };

      const ttlSeconds = Math.ceil((scheduledTime.getTime() - Date.now()) / 1000) + 86400; // TTL = время до выполнения + 1 день
      await redis.set(
        getMissedDayNotificationDataKey(userId),
        JSON.stringify(data),
        'EX',
        ttlSeconds > 0 ? ttlSeconds : 86400
      );

      // Добавляем в список
      const listKey = getMissedDayNotificationsListKey();
      await redis.sadd(listKey, userId.toString());
    } catch (error) {
      logger.error(`Error saving missed day notification to Redis for user ${userId}:`, error);
    }
  }

  /**
   * Удаляет уведомление о пропущенном дне из Redis
   */
  private async removeMissedDayNotificationFromRedis(userId: number): Promise<void> {
    try {
      await redis.del(getMissedDayNotificationDataKey(userId));
      const listKey = getMissedDayNotificationsListKey();
      await redis.srem(listKey, userId.toString());
    } catch (error) {
      logger.error(`Error removing missed day notification from Redis for user ${userId}:`, error);
    }
  }

  /**
   * Планирует ежедневное уведомление
   */
  async scheduleDailyReminder(userId: number, reminderTime: string, timezone: number): Promise<void> {
    // Отменяем предыдущее уведомление
    this.cancelDailyReminder(userId);

    const challenge = await challengeService.getActiveChallenge(userId);
    if (!challenge) {
      logger.warn(`Cannot schedule daily reminder: no active challenge for user ${userId}`);
      return;
    }

    const scheduledTime = this.getNextReminderTime(reminderTime, timezone);
    const now = new Date();
    const delay = scheduledTime.getTime() - now.getTime();

    if (delay <= 0) {
      // Время уже прошло, планируем на завтра
      const tomorrowTime = this.getNextReminderTime(reminderTime, timezone);
      const tomorrowDelay = tomorrowTime.getTime() - now.getTime();
      await this.scheduleDailyReminderInternal(userId, reminderTime, timezone, tomorrowTime, tomorrowDelay, challenge.id);
      return;
    }

    await this.scheduleDailyReminderInternal(userId, reminderTime, timezone, scheduledTime, delay, challenge.id);
  }

  /**
   * Внутренний метод для планирования ежедневного уведомления
   */
  private async scheduleDailyReminderInternal(
    userId: number,
    reminderTime: string,
    timezone: number,
    scheduledTime: Date,
    delay: number,
    challengeId: number
  ): Promise<void> {
    const localTime = this.getLocalTime(scheduledTime, timezone);
    const localTimeStr = this.formatLocalDateTime(localTime);
    const timeUntilStr = this.formatTimeUntil(delay);
    const timezoneStr = timezone >= 0 ? `+${timezone}` : `${timezone}`;
    
    logger.info(
      `Scheduling daily reminder for user ${userId}: ` +
      `local time ${localTimeStr} (UTC${timezoneStr}), ` +
      `UTC ${scheduledTime.toISOString()}, ` +
      `in ${timeUntilStr} (${Math.round(delay / 1000)}s)`
    );

    const timeoutId = setTimeout(async () => {
      try {
        await this.sendDailyReminder(userId);
        this.dailyReminders.delete(userId);
        // Планируем следующее уведомление
        const challenge = await challengeService.getActiveChallenge(userId);
        if (challenge && challenge.reminderStatus && challenge.reminderTime) {
          const user = await userService.getUser(userId);
          const currentTimezone = user?.timezone ?? 3;
          await this.scheduleDailyReminder(userId, challenge.reminderTime.slice(0, 5), currentTimezone);
        }
      } catch (error: any) {
        const shouldCancel = handleTelegramError(error, userId);
        if (shouldCancel || error?.message === 'USER_BLOCKED_BOT') {
          logger.info(`User ${userId} blocked the bot, cancelling daily reminder`);
          this.cancelDailyReminder(userId);
          return;
        }
        logger.error(`Error in daily reminder for user ${userId}:`, error);
        this.dailyReminders.delete(userId);
      }
    }, delay);

    this.dailyReminders.set(userId, {
      userId,
      timeoutId,
      scheduledTime,
    });

    await this.saveDailyReminderToRedis(userId, reminderTime, timezone, scheduledTime, challengeId);
  }

  /**
   * Отправляет ежедневное уведомление
   */
  private async sendDailyReminder(userId: number): Promise<void> {
    if (!this.botApi) {
      logger.error('Bot API is not initialized');
      return;
    }

    try {
      const challenge = await challengeService.getActiveChallenge(userId);
      if (!challenge || challenge.status !== 'active') {
        logger.info(`Skipping reminder for user ${userId}: challenge inactive`);
        this.cancelDailyReminder(userId);
        return;
      }

      if (!challenge.reminderStatus) {
        logger.info(`Skipping reminder for user ${userId}: reminders disabled`);
        this.cancelDailyReminder(userId);
        return;
      }

      // НЕ отправляем напоминание, если есть пропущенные дни
      // В этом случае должно отправляться только уведомление о пропущенном дне
      if (challenge.daysWithoutWorkout > 0) {
        logger.info(`Skipping reminder for user ${userId}: has ${challenge.daysWithoutWorkout} missed days`);
        return;
      }

      // Дополнительная проверка: проверяем, было ли фото загружено вчера
      // Это предотвращает race condition, когда напоминание отправляется раньше,
      // чем проверка пропущенных дней в 4:00 увеличит счетчик
      const user = await userService.getUser(userId);
      const timezone = user?.timezone ?? 3;
      const yesterdayDate = getYesterdayDateString(timezone);
      const hadPhotoYesterday = await challengeService.hasPhotoUploadedToday(userId, yesterdayDate);
      
      if (!hadPhotoYesterday) {
        logger.info(`Skipping reminder for user ${userId}: no photo uploaded yesterday (date: ${yesterdayDate})`);
        // Не отправляем напоминание, если фото не было загружено вчера
        // Уведомление о пропущенном дне будет отправлено проверкой в 4:00
        return;
      }

      // Отправляем случайную фразу
      const reminderPhrase = getRandomReminderPhrase();
      await this.botApi.sendMessage(userId, reminderPhrase);

      // Отправляем сцену статистики
      const mockContext = {
        from: { id: userId },
        reply: async (text: string, options?: any) => {
          return this.botApi!.sendMessage(userId, text, {
            ...options,
            disable_notification: true,
          });
        },
        editMessageText: async (text: string, options?: any) => {
          return this.botApi!.sendMessage(userId, text, {
            ...options,
            disable_notification: true,
          });
        },
      } as any;

      await handleChallengeStatsScene(mockContext);
      logger.info(`Daily reminder sent to user ${userId}`);
    } catch (error) {
      const shouldCancel = handleTelegramError(error, userId);
      if (shouldCancel) {
        this.cancelDailyReminder(userId);
        return;
      }
      logger.error(`Error sending daily reminder to user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Отменяет ежедневное уведомление
   */
  cancelDailyReminder(userId: number): void {
    const reminder = this.dailyReminders.get(userId);
    if (reminder) {
      clearTimeout(reminder.timeoutId);
      this.dailyReminders.delete(userId);
      this.removeDailyReminderFromRedis(userId);
      logger.info(`Cancelled daily reminder for user ${userId}`);
    }
  }

  /**
   * Перепланирует ежедневное уведомление (при изменении времени/часового пояса)
   */
  async rescheduleDailyReminder(userId: number): Promise<void> {
    const challenge = await challengeService.getActiveChallenge(userId);
    if (!challenge || !challenge.reminderStatus || !challenge.reminderTime) {
      return;
    }

    const user = await userService.getUser(userId);
    const timezone = user?.timezone ?? 3;
    await this.scheduleDailyReminder(userId, challenge.reminderTime.slice(0, 5), timezone);
  }

  /**
   * Проверяет, запланировано ли ежедневное уведомление
   */
  hasDailyReminder(userId: number): boolean {
    return this.dailyReminders.has(userId);
  }

  /**
   * Проверяет, запланирована ли проверка пропущенных дней
   * @deprecated Используется только для обратной совместимости
   */
  hasMissedDaysCheck(userId: number): boolean {
    return this.missedChecks.has(userId);
  }

  /**
   * Проверяет, запланировано ли уведомление о пропущенном дне
   */
  hasMissedDayNotification(userId: number): boolean {
    return this.missedDayNotifications.has(userId);
  }

  /**
   * Планирует уведомление о пропущенном дне на установленное пользователем время
   * @param userId - ID пользователя
   * @param timezone - часовой пояс пользователя
   * @param daysWithoutWorkout - количество пропущенных дней
   * @param isFailed - true, если челлендж провален (3 дня пропущено)
   */
  async scheduleMissedDayNotification(
    userId: number,
    timezone: number,
    daysWithoutWorkout: number,
    isFailed: boolean = false
  ): Promise<void> {
    // Отменяем предыдущее уведомление
    this.cancelMissedDayNotification(userId);

    const challenge = await challengeService.getActiveChallenge(userId);
    if (!challenge) {
      logger.warn(`Cannot schedule missed day notification: no active challenge for user ${userId}`);
      return;
    }

    // Получаем время напоминания из челленджа (или null, если не установлено)
    const reminderTime = challenge.reminderTime ? challenge.reminderTime.slice(0, 5) : null; // HH:MM

    // Вычисляем время уведомления
    const scheduledTime = this.getNextNotificationTime(reminderTime, timezone);
    const now = new Date();
    const delay = scheduledTime.getTime() - now.getTime();

    if (delay <= 0) {
      // Время уже прошло, планируем на завтра
      const tomorrowTime = this.getNextNotificationTime(reminderTime, timezone);
      const tomorrowDelay = tomorrowTime.getTime() - now.getTime();
      await this.scheduleMissedDayNotificationInternal(
        userId,
        timezone,
        tomorrowTime,
        tomorrowDelay,
        challenge.id,
        daysWithoutWorkout,
        isFailed
      );
      return;
    }

    await this.scheduleMissedDayNotificationInternal(
      userId,
      timezone,
      scheduledTime,
      delay,
      challenge.id,
      daysWithoutWorkout,
      isFailed
    );
  }

  /**
   * Внутренний метод для планирования уведомления о пропущенном дне
   */
  private async scheduleMissedDayNotificationInternal(
    userId: number,
    timezone: number,
    scheduledTime: Date,
    delay: number,
    challengeId: number,
    daysWithoutWorkout: number,
    isFailed: boolean
  ): Promise<void> {
    const localTime = this.getLocalTime(scheduledTime, timezone);
    const localTimeStr = this.formatLocalDateTime(localTime);
    const timeUntilStr = this.formatTimeUntil(delay);
    const timezoneStr = timezone >= 0 ? `+${timezone}` : `${timezone}`;
    const statusStr = isFailed ? 'FAILED' : 'active';
    
    logger.info(
      `Scheduling missed day notification for user ${userId}: ` +
      `local time ${localTimeStr} (UTC${timezoneStr}), ` +
      `UTC ${scheduledTime.toISOString()}, ` +
      `in ${timeUntilStr} (${Math.round(delay / 1000)}s), ` +
      `days: ${daysWithoutWorkout}, status: ${statusStr}`
    );

    const timeoutId = setTimeout(async () => {
      try {
        if (isFailed) {
          await this.sendFinalMissedDayNotification(userId);
        } else {
          await this.sendMissedDayNotification(userId, daysWithoutWorkout);
        }
        this.missedDayNotifications.delete(userId);
        await this.removeMissedDayNotificationFromRedis(userId);
      } catch (error: any) {
        const shouldCancel = handleTelegramError(error, userId);
        if (shouldCancel || error?.message === 'USER_BLOCKED_BOT') {
          logger.info(`User ${userId} blocked the bot, cancelling missed day notification`);
          this.cancelMissedDayNotification(userId);
          return;
        }
        logger.error(`Error in missed day notification for user ${userId}:`, error);
        this.missedDayNotifications.delete(userId);
        await this.removeMissedDayNotificationFromRedis(userId);
      }
    }, delay);

    this.missedDayNotifications.set(userId, {
      userId,
      timeoutId,
      scheduledTime,
    });

    await this.saveMissedDayNotificationToRedis(userId, scheduledTime, timezone, challengeId, daysWithoutWorkout, isFailed);
  }

  /**
   * Отменяет уведомление о пропущенном дне
   */
  cancelMissedDayNotification(userId: number): void {
    const notification = this.missedDayNotifications.get(userId);
    if (notification) {
      clearTimeout(notification.timeoutId);
      this.missedDayNotifications.delete(userId);
      this.removeMissedDayNotificationFromRedis(userId);
      logger.info(`Cancelled missed day notification for user ${userId}`);
    }
  }

  /**
   * Перепланирует уведомление о пропущенном дне (при изменении времени напоминания)
   */
  async rescheduleMissedDayNotification(userId: number, timezone: number): Promise<void> {
    const challenge = await challengeService.getActiveChallenge(userId);
    if (!challenge) {
      return;
    }

    // Отменяем текущее уведомление
    this.cancelMissedDayNotification(userId);

    // Если есть пропущенные дни, перепланируем уведомление
    if (challenge.daysWithoutWorkout > 0) {
      const isFailed = challenge.status === 'failed';
      await this.scheduleMissedDayNotification(userId, timezone, challenge.daysWithoutWorkout, isFailed);
    }
  }

  /**
   * Планирует проверку пропущенных дней
   * @deprecated Проверка теперь выполняется только в 4:00 МСК через performDailyHealthCheck
   * Метод оставлен для обратной совместимости, но больше не выполняет проверку
   */
  async scheduleMissedDaysCheck(_userId: number, _timezone: number, _challengeStartDate: Date): Promise<void> {
    // Проверка пропущенных дней теперь выполняется только в 4:00 МСК
    // Этот метод оставлен для обратной совместимости
    logger.debug(`scheduleMissedDaysCheck called, but checks are now done only at 4:00 MSK`);
  }

  /**
   * Отправляет уведомление о пропущенном дне (1-2 дня)
   */
  private async sendMissedDayNotification(userId: number, daysWithoutWorkout: number): Promise<void> {
    if (!this.botApi) {
      logger.error('Bot API is not initialized');
      return;
    }

    try {
      // Используем Redis lock для предотвращения дубликатов
      const lockKey = getNotificationLockKey(userId);
      const lockValue = Date.now().toString();
      const lockTTL = 300; // 5 минут

      const lockAcquired = await redis.set(lockKey, lockValue, 'EX', lockTTL, 'NX');
      if (!lockAcquired) {
        logger.warn(`Notification lock already exists for user ${userId}, skipping duplicate`);
        return;
      }

      try {
        // Проверяем время последней отправки (предотвращаем повторную отправку в течение 1 часа)
        const lastSentKey = getMissedNotificationSentKey(userId);
        const lastSentTimestamp = await redis.get(lastSentKey);
        const now = Date.now();
        const oneHourMs = 60 * 60 * 1000;

        if (lastSentTimestamp) {
          const lastSent = parseInt(lastSentTimestamp, 10);
          const timeSinceLastSent = now - lastSent;

          if (timeSinceLastSent < oneHourMs) {
            logger.warn(
              `Missed day notification was sent ${Math.round(timeSinceLastSent / 1000 / 60)} minutes ago for user ${userId}, skipping duplicate`
            );
            await redis.del(lockKey);
            return;
          }
        }

        const missedWorkoutText = MESSAGES.MISSED_WORKOUT.TEXT;

        // Отправляем фото
        try {
          const imagePath = getMissedDayImagePath(daysWithoutWorkout);
          const photo = new InputFile(imagePath);
          const keyboard = new InlineKeyboard()
            .text(BUTTONS.TO_CHALLENGE, 'challenge_stats');

          await this.botApi.sendPhoto(userId, photo, {
            caption: missedWorkoutText,
            reply_markup: keyboard,
          });

          logger.info(`Missed workout notification with photo sent to user ${userId} (day ${daysWithoutWorkout})`);
        } catch (photoError) {
          // Если не удалось отправить фото, отправляем только текст
          logger.warn(`Failed to send missed day photo for user ${userId}, sending text only:`, photoError);
          const keyboard = new InlineKeyboard()
            .text(BUTTONS.TO_CHALLENGE, 'challenge_stats');
          await this.botApi.sendMessage(userId, missedWorkoutText, {
            reply_markup: keyboard,
          });
          logger.info(`Missed workout notification (text only) sent to user ${userId}`);
        }

        // Сохраняем время отправки
        await redis.set(lastSentKey, now.toString(), 'EX', 86400);
        await redis.del(lockKey);
      } catch (error) {
        await redis.del(lockKey).catch(() => {});
        throw error;
      }
    } catch (error) {
      const shouldCancel = handleTelegramError(error, userId);
      if (shouldCancel) {
        this.cancelMissedDaysCheck(userId);
        return;
      }
      logger.error(`Error sending missed day notification to user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Отправляет финальное уведомление о провале челленджа (3 дня пропущено)
   */
  private async sendFinalMissedDayNotification(userId: number): Promise<void> {
    if (!this.botApi) {
      logger.error('Bot API is not initialized');
      return;
    }

    try {
      const finalText = 'В этот раз жир одержал победу(((. Сделай паузу и приступай к новому челленджу, все получится!';
      const imagePath = getMissedDayImagePath(3);
      const photo = new InputFile(imagePath);
      const keyboard = new InlineKeyboard()
        .text(BUTTONS.START_NEW_CHALLENGE, 'begin');

      await this.botApi.sendPhoto(userId, photo, {
        caption: finalText,
        reply_markup: keyboard,
      });

      logger.info(`Final missed day notification sent to user ${userId}`);
    } catch (photoError) {
      // Если не удалось отправить фото, отправляем только текст
      logger.warn(`Failed to send final missed day photo for user ${userId}, sending text only:`, photoError);
      const keyboard = new InlineKeyboard()
        .text(BUTTONS.START_NEW_CHALLENGE, 'begin');
      await this.botApi.sendMessage(userId, 'В этот раз жир одержал победу(((. Сделай паузу и приступай к новому челленджу, все получится!', {
        reply_markup: keyboard,
      });
      logger.info(`Final missed day notification (text only) sent to user ${userId}`);
    }
  }

  /**
   * Отменяет проверку пропущенных дней
   */
  cancelMissedDaysCheck(userId: number): void {
    const check = this.missedChecks.get(userId);
    if (check) {
      clearTimeout(check.timeoutId);
      this.missedChecks.delete(userId);
      this.removeMissedCheckFromRedis(userId);
      logger.info(`Cancelled missed days check for user ${userId}`);
    }
  }

  /**
   * Перепланирует уведомление о пропущенном дне (при изменении времени напоминания)
   */
  async rescheduleMissedDaysCheck(userId: number, timezone: number): Promise<void> {
    // Перепланируем уведомление, если есть пропущенные дни
    await this.rescheduleMissedDayNotification(userId, timezone);
  }

  /**
   * Восстанавливает все уведомления при старте бота
   * Удаляет все существующие уведомления и пересоздает их заново на основе текущего состояния челленджей
   */
  async restoreNotifications(): Promise<void> {
    try {
      logger.info('=== Starting notification restoration ===');

      // Шаг 1: Удаляем все уведомления из памяти
      let cancelledMissedChecks = 0;
      let cancelledDailyReminders = 0;
      let cancelledMissedDayNotifications = 0;

      for (const [userId, check] of this.missedChecks.entries()) {
        clearTimeout(check.timeoutId);
        this.missedChecks.delete(userId);
        cancelledMissedChecks++;
      }

      for (const [userId, reminder] of this.dailyReminders.entries()) {
        clearTimeout(reminder.timeoutId);
        this.dailyReminders.delete(userId);
        cancelledDailyReminders++;
      }

      for (const [userId, notification] of this.missedDayNotifications.entries()) {
        clearTimeout(notification.timeoutId);
        this.missedDayNotifications.delete(userId);
        cancelledMissedDayNotifications++;
      }

      logger.info(
        `Cancelled from memory: ${cancelledMissedChecks} missed checks, ` +
        `${cancelledDailyReminders} daily reminders, ${cancelledMissedDayNotifications} missed day notifications`
      );

      // Шаг 2: Очищаем все уведомления из Redis
      let removedFromRedis = 0;

      // Удаляем ежедневные напоминания
      const dailyRemindersListKey = getDailyRemindersListKey();
      const dailyReminderUserIds = await redis.smembers(dailyRemindersListKey);
      for (const userIdStr of dailyReminderUserIds) {
        const userId = parseInt(userIdStr, 10);
        if (!isNaN(userId)) {
          await this.removeDailyReminderFromRedis(userId);
          removedFromRedis++;
        }
      }

      // Удаляем проверки пропущенных дней
      const missedChecksListKey = getMissedChecksListKey();
      const missedCheckUserIds = await redis.smembers(missedChecksListKey);
      for (const userIdStr of missedCheckUserIds) {
        const userId = parseInt(userIdStr, 10);
        if (!isNaN(userId)) {
          await this.removeMissedCheckFromRedis(userId);
          removedFromRedis++;
        }
      }

      // Удаляем уведомления о пропущенных днях
      const missedDayNotificationsListKey = getMissedDayNotificationsListKey();
      const missedDayNotificationUserIds = await redis.smembers(missedDayNotificationsListKey);
      for (const userIdStr of missedDayNotificationUserIds) {
        const userId = parseInt(userIdStr, 10);
        if (!isNaN(userId)) {
          await this.removeMissedDayNotificationFromRedis(userId);
          removedFromRedis++;
        }
      }

      logger.info(`Removed ${removedFromRedis} notification entries from Redis`);

      // Шаг 3: Получаем все активные челленджи и пересоздаем уведомления
      const activeChallenges = await challengeService.getAllActiveChallenges();
      logger.info(`Found ${activeChallenges.length} active challenges`);

      let createdDailyReminders = 0;
      let createdMissedDayNotifications = 0;
      let skippedChallenges = 0;

      // Для каждого активного челленджа заново создаем напоминания
      for (const challenge of activeChallenges) {
        try {
          const user = await userService.getUser(challenge.userId);
          if (!user) {
            logger.warn(`User ${challenge.userId} not found, skipping challenge`);
            skippedChallenges++;
            continue;
          }

          const timezone = user.timezone ?? 3;

          // Создаем ежедневное напоминание, если оно включено
          if (challenge.reminderStatus && challenge.reminderTime) {
            const reminderTime = challenge.reminderTime.slice(0, 5); // HH:MM
            // Вычисляем время заранее для логирования
            const scheduledTime = this.getNextReminderTime(reminderTime, timezone);
            await this.scheduleDailyReminder(challenge.userId, reminderTime, timezone);
            
            logger.info(
              `User ${challenge.userId}: Scheduled daily reminder at ${reminderTime} ` +
              `(timezone: ${timezone >= 0 ? '+' : ''}${timezone}, scheduled: ${scheduledTime.toISOString()})`
            );
            createdDailyReminders++;
          }

          // Если есть пропущенные дни, планируем уведомление
          if (challenge.daysWithoutWorkout > 0) {
            const isFailed = challenge.status === 'failed';
            const reminderTime = challenge.reminderTime 
              ? challenge.reminderTime.slice(0, 5) 
              : null;
            // Вычисляем время заранее для логирования
            const scheduledTime = this.getNextNotificationTime(reminderTime, timezone);
            await this.scheduleMissedDayNotification(
              challenge.userId,
              timezone,
              challenge.daysWithoutWorkout,
              isFailed
            );
            
            const reminderTimeStr = reminderTime || '12:00 (default)';
            logger.info(
              `User ${challenge.userId}: Scheduled missed day notification ` +
              `(${challenge.daysWithoutWorkout} days missed, ${isFailed ? 'FAILED' : 'active'}) ` +
              `at ${reminderTimeStr} (timezone: ${timezone >= 0 ? '+' : ''}${timezone}, scheduled: ${scheduledTime.toISOString()})`
            );
            createdMissedDayNotifications++;
          }
        } catch (error) {
          logger.error(`Error recreating notifications for user ${challenge.userId}:`, error);
          skippedChallenges++;
        }
      }

      // Шаг 4: Планируем ежедневную проверку здоровья
      this.scheduleDailyHealthCheck();
      const healthCheckTime = this.dailyHealthCheckTimeoutId 
        ? 'scheduled' 
        : 'not scheduled';
      logger.info(`Daily health check: ${healthCheckTime}`);

      // Итоговая статистика
      logger.info('=== Notification restoration completed ===');
      logger.info(
        `Summary: ${createdDailyReminders} daily reminders, ` +
        `${createdMissedDayNotifications} missed day notifications created, ` +
        `${skippedChallenges} challenges skipped`
      );
    } catch (error) {
      logger.error('Error recreating notifications:', error);
    }
  }

  /**
   * Ежедневная проверка здоровья всех активных челленджей в 4:00 МСК
   * Проверяет пропущенные дни и пересоздает уведомления при необходимости
   */
  async performDailyHealthCheck(): Promise<void> {
    // Используем Redis lock для предотвращения параллельных запусков
    const lockKey = getDailyHealthCheckLockKey();
    const lockValue = Date.now().toString();
    const lockTTL = 3600; // 1 час (на случай, если проверка застрянет)

    try {
      const lockAcquired = await redis.set(lockKey, lockValue, 'EX', lockTTL, 'NX');
      if (!lockAcquired) {
        logger.warn('Daily health check already in progress (lock exists), skipping');
        return;
      }

      logger.info('Starting daily health check at 4:00 MSK...');

      // Получаем все активные челленджи
      const activeChallenges = await challengeService.getAllActiveChallenges();
      let checkedCount = 0;
      let recreatedMissedChecks = 0;
      let recreatedReminders = 0;
      let failedCount = 0;
      let errorCount = 0;

      for (const challenge of activeChallenges) {
        try {
          const user = await userService.getUser(challenge.userId);
          if (!user) {
            logger.warn(`User ${challenge.userId} not found, skipping health check`);
            continue;
          }

          const timezone = user.timezone ?? 3;

          // 1. Проверяем пропущенные дни (идемпотентная операция)
          // Это безопасно, так как checkAndIncrementMissedDays использует транзакции
          const wasFailed = await challengeService.checkAndIncrementMissedDays(
            challenge.userId,
            timezone
          );

          // Получаем обновленный челлендж после проверки
          const updatedChallenge = await challengeService.getActiveChallenge(challenge.userId);
          if (!updatedChallenge) {
            continue;
          }

          if (wasFailed || updatedChallenge.status === 'failed') {
            failedCount++;
            // Челлендж провален, отменяем проверки и уведомления
            this.cancelMissedDaysCheck(challenge.userId);
            this.cancelMissedDayNotification(challenge.userId);
            this.cancelDailyReminder(challenge.userId);
            // Планируем финальное уведомление о провале на установленное пользователем время
            await this.scheduleMissedDayNotification(challenge.userId, timezone, 3, true);
            logger.info(`Challenge failed for user ${challenge.userId} during health check, notification scheduled`);
            continue;
          }

          // 2. Проверяем, нужно ли планировать уведомление о пропущенном дне
          // Проверяем, было ли фото загружено вчера
          const yesterdayDate = getYesterdayDateString(timezone);
          const hadPhotoYesterday = await challengeService.hasPhotoUploadedToday(challenge.userId, yesterdayDate);

          if (!hadPhotoYesterday && updatedChallenge.daysWithoutWorkout > 0) {
            // Фото не было загружено вчера и есть пропущенные дни - планируем уведомление
            // Отменяем старое уведомление, если есть
            this.cancelMissedDayNotification(challenge.userId);
            await this.scheduleMissedDayNotification(
              challenge.userId,
              timezone,
              updatedChallenge.daysWithoutWorkout,
              false
            );
            recreatedMissedChecks++;
            logger.info(`Scheduled missed day notification for user ${challenge.userId} (${updatedChallenge.daysWithoutWorkout} days)`);
          } else if (hadPhotoYesterday) {
            // Фото было загружено вчера - отменяем уведомление, если оно было запланировано
            this.cancelMissedDayNotification(challenge.userId);
            logger.debug(`Photo was uploaded yesterday for user ${challenge.userId}, no notification needed`);
          }

          // 3. Проверяем, запланировано ли ежедневное напоминание (если включено)
          if (challenge.reminderStatus && challenge.reminderTime) {
            const hasReminder = this.hasDailyReminder(challenge.userId);
            if (!hasReminder) {
              const reminderTime = challenge.reminderTime.slice(0, 5); // HH:MM
              await this.scheduleDailyReminder(challenge.userId, reminderTime, timezone);
              recreatedReminders++;
              logger.info(`Recreated daily reminder for user ${challenge.userId}`);
            }
          }

          checkedCount++;
        } catch (error) {
          errorCount++;
          logger.error(`Error in health check for user ${challenge.userId}:`, error);
          // Продолжаем обработку других челленджей
        }
      }

      logger.info(
        `Daily health check completed: checked ${checkedCount} challenges, ` +
        `scheduled ${recreatedMissedChecks} missed day notifications, ` +
        `recreated ${recreatedReminders} reminders, ` +
        `failed ${failedCount} challenges, ` +
        `errors ${errorCount}`
      );
    } catch (error) {
      logger.error('Error performing daily health check:', error);
    } finally {
      // Освобождаем блокировку
      try {
        await redis.del(lockKey);
      } catch (error) {
        logger.error('Error releasing health check lock:', error);
      }
    }
  }

  /**
   * Отменяет ежедневную проверку здоровья
   */
  cancelDailyHealthCheck(): void {
    if (this.dailyHealthCheckTimeoutId) {
      clearTimeout(this.dailyHealthCheckTimeoutId);
      this.dailyHealthCheckTimeoutId = null;
      logger.info('Cancelled daily health check');
    }
  }

  /**
   * Планирует ежедневную проверку здоровья в 4:00 МСК
   */
  scheduleDailyHealthCheck(): void {
    // Отменяем предыдущую проверку, если есть
    if (this.dailyHealthCheckTimeoutId) {
      clearTimeout(this.dailyHealthCheckTimeoutId);
      this.dailyHealthCheckTimeoutId = null;
    }

    const now = new Date();
    const mskOffset = 3 * 60 * 60 * 1000; // МСК = UTC+3
    const mskTime = now.getTime() + mskOffset;
    const mskDate = new Date(mskTime);

    // Устанавливаем время на 4:00 МСК сегодня
    const today4AM = new Date(mskDate);
    today4AM.setUTCHours(4, 0, 0, 0);

    // Если уже прошло 4:00, планируем на завтра
    const msPerDay = 24 * 60 * 60 * 1000;
    const targetTime = today4AM.getTime() <= mskTime
      ? today4AM.getTime() + msPerDay
      : today4AM.getTime();

    const delay = targetTime - mskTime;
    const targetDate = new Date(targetTime - mskOffset); // Конвертируем обратно в UTC

    logger.info(`Scheduling daily health check at ${targetDate.toISOString()} (in ${Math.round(delay / 1000 / 60)} minutes)`);

    this.dailyHealthCheckTimeoutId = setTimeout(async () => {
      this.dailyHealthCheckTimeoutId = null;
      await this.performDailyHealthCheck();
      // Планируем следующую проверку на завтра
      this.scheduleDailyHealthCheck();
    }, delay);
  }

}

export const notificationService = new NotificationService();

