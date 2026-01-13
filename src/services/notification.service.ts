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
} from '../redis/keys.js';
import { challengeService } from './challenge.service.js';
import { userService } from './user.service.js';
import { getRandomReminderPhrase } from '../utils/motivational-phrases.js';
import { getMissedDayImagePath } from '../utils/missed-days-images.js';
import { getYesterdayDateString } from '../utils/date-utils.js';
import { handleChallengeStatsScene } from '../scenes/challenge-stats.scene.js';
import { handleTelegramError } from '../utils/telegram-error-handler.js';
import { BUTTONS } from '../scenes/messages.js';

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

class NotificationService {
  private dailyReminders = new Map<number, ScheduledReminder>();
  private missedChecks = new Map<number, ScheduledMissedCheck>();
  private botApi: Api | null = null;
  private dailyHealthCheckTimeoutId: NodeJS.Timeout | null = null;

  /**
   * Устанавливает API бота
   */
  setBotApi(api: Api): void {
    this.botApi = api;
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
   * Вычисляет время следующей проверки пропущенных дней в установленное пользователем время
   * @param reminderTime - время напоминания (HH:MM) или null для использования 12:00 МСК
   * @param timezone - часовой пояс пользователя
   * @param challengeStartDate - дата создания челленджа (для проверки, создан ли сегодня)
   * @param isFirstSchedule - true при первом планировании (проверяем время создания), false при перепланировании
   */
  private getNextMissedCheckTime(reminderTime: string | null, timezone: number, challengeStartDate: Date, isFirstSchedule: boolean = true): Date {
    const now = new Date();
    
    // Если время не установлено, используем 12:00 МСК (timezone = 3)
    const checkTime = reminderTime || '12:00';
    const checkTimezone = reminderTime ? timezone : 3; // Если время не установлено, используем МСК
    
    const [hours, minutes] = checkTime.split(':').map(Number);
    
    // Смещение часового пояса в миллисекундах
    const timezoneOffsetMs = checkTimezone * 60 * 60 * 1000;
    
    // Получаем текущее время в локальном часовом поясе
    const localNowMs = now.getTime() + timezoneOffsetMs;
    const msPerDay = 24 * 60 * 60 * 1000;
    const localDayStartMs = Math.floor(localNowMs / msPerDay) * msPerDay;
    
    // Время проверки сегодня в локальном времени (в миллисекундах)
    const todayCheckLocalMs = localDayStartMs + (hours * 60 * 60 * 1000) + (minutes * 60 * 1000);
    
    let nextCheckLocalMs: number;
    
    if (isFirstSchedule) {
      // При первом планировании проверяем, создан ли челлендж сегодня
      const challengeStartLocalMs = challengeStartDate.getTime() + timezoneOffsetMs;
      const challengeStartDayStartMs = Math.floor(challengeStartLocalMs / msPerDay) * msPerDay;
      const currentDayStartMs = localDayStartMs;
      
      // Если челлендж создан сегодня, планируем проверку на завтра
      if (challengeStartDayStartMs === currentDayStartMs) {
        nextCheckLocalMs = todayCheckLocalMs + msPerDay;
      } else {
        // Если время проверки уже прошло сегодня, планируем на завтра
        nextCheckLocalMs = todayCheckLocalMs <= localNowMs 
          ? todayCheckLocalMs + msPerDay 
          : todayCheckLocalMs;
      }
    } else {
      // При перепланировании просто планируем на следующее время проверки
      nextCheckLocalMs = todayCheckLocalMs <= localNowMs 
        ? todayCheckLocalMs + msPerDay 
        : todayCheckLocalMs;
    }
    
    // Конвертируем обратно в UTC
    const nextCheckUtcMs = nextCheckLocalMs - timezoneOffsetMs;
    return new Date(nextCheckUtcMs);
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
   */
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
    logger.info(
      `Scheduling daily reminder for user ${userId} at ${scheduledTime.toISOString()} (in ${Math.round(delay / 1000)}s)`
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
   */
  hasMissedDaysCheck(userId: number): boolean {
    return this.missedChecks.has(userId);
  }

  /**
   * Планирует проверку пропущенных дней
   */
  async scheduleMissedDaysCheck(userId: number, timezone: number, challengeStartDate: Date): Promise<void> {
    // Отменяем предыдущую проверку
    this.cancelMissedDaysCheck(userId);

    const challenge = await challengeService.getActiveChallenge(userId);
    if (!challenge) {
      logger.warn(`Cannot schedule missed check: no active challenge for user ${userId}`);
      return;
    }

    // Получаем время напоминания из челленджа (или null, если не установлено)
    const reminderTime = challenge.reminderTime ? challenge.reminderTime.slice(0, 5) : null; // HH:MM

    const scheduledTime = this.getNextMissedCheckTime(reminderTime, timezone, challengeStartDate, true);
    const now = new Date();
    const delay = scheduledTime.getTime() - now.getTime();

    if (delay <= 0) {
      // Время уже прошло, планируем на завтра
      const tomorrowTime = this.getNextMissedCheckTime(reminderTime, timezone, challengeStartDate, false);
      const tomorrowDelay = tomorrowTime.getTime() - now.getTime();
      await this.scheduleMissedCheckInternal(userId, timezone, tomorrowTime, tomorrowDelay, challenge.id, challengeStartDate);
      return;
    }

    await this.scheduleMissedCheckInternal(userId, timezone, scheduledTime, delay, challenge.id, challengeStartDate);
  }

  /**
   * Внутренний метод для планирования проверки пропущенных дней
   */
  private async scheduleMissedCheckInternal(
    userId: number,
    timezone: number,
    scheduledTime: Date,
    delay: number,
    challengeId: number,
    challengeStartDate: Date
  ): Promise<void> {
    logger.info(
      `Scheduling missed days check for user ${userId} at ${scheduledTime.toISOString()} (in ${Math.round(delay / 1000)}s)`
    );

    const timeoutId = setTimeout(async () => {
      try {
        await this.checkAndSendMissedDay(userId, timezone);
        this.missedChecks.delete(userId);
        // Планируем следующую проверку (перепланирование, не первое)
        const challenge = await challengeService.getActiveChallenge(userId);
        if (challenge) {
          const user = await userService.getUser(userId);
          const currentTimezone = user?.timezone ?? 3;
          // Получаем актуальное время напоминания из челленджа
          const currentReminderTime = challenge.reminderTime ? challenge.reminderTime.slice(0, 5) : null;
          // При перепланировании используем isFirstSchedule = false
          const scheduledTime = this.getNextMissedCheckTime(currentReminderTime, currentTimezone, new Date(challenge.startDate), false);
          const now = new Date();
          const delay = scheduledTime.getTime() - now.getTime();
          if (delay > 0) {
            await this.scheduleMissedCheckInternal(userId, currentTimezone, scheduledTime, delay, challenge.id, new Date(challenge.startDate));
          } else {
            // Если время уже прошло, планируем на завтра
            const tomorrowTime = this.getNextMissedCheckTime(currentReminderTime, currentTimezone, new Date(challenge.startDate), false);
            const tomorrowDelay = tomorrowTime.getTime() - now.getTime();
            await this.scheduleMissedCheckInternal(userId, currentTimezone, tomorrowTime, tomorrowDelay, challenge.id, new Date(challenge.startDate));
          }
        }
      } catch (error: any) {
        const shouldCancel = handleTelegramError(error, userId);
        if (shouldCancel || error?.message === 'USER_BLOCKED_BOT') {
          logger.info(`User ${userId} blocked the bot, cancelling missed check`);
          this.cancelMissedDaysCheck(userId);
          return;
        }
        logger.error(`Error in missed check for user ${userId}:`, error);
        this.missedChecks.delete(userId);
      }
    }, delay);

    this.missedChecks.set(userId, {
      userId,
      timeoutId,
      scheduledTime,
    });

    await this.saveMissedCheckToRedis(userId, timezone, scheduledTime, challengeId, challengeStartDate);
  }

  /**
   * Проверяет пропущенные дни и отправляет уведомление при необходимости
   */
  private async checkAndSendMissedDay(userId: number, timezone: number): Promise<void> {
    if (!this.botApi) {
      logger.error('Bot API is not initialized');
      return;
    }

    try {
      const challenge = await challengeService.getActiveChallenge(userId);
      if (!challenge || challenge.status !== 'active') {
        logger.info(`Skipping missed check for user ${userId}: challenge inactive`);
        this.cancelMissedDaysCheck(userId);
        return;
      }

      // Проверяем и увеличиваем счетчик пропущенных дней
      const wasFailed = await challengeService.checkAndIncrementMissedDays(userId, timezone);
      
      // Получаем обновленный челлендж
      const updatedChallenge = await challengeService.getActiveChallenge(userId);
      if (!updatedChallenge) {
        return;
      }

      if (wasFailed || updatedChallenge.status === 'failed') {
        // Челлиндж провален (3 дня пропущено)
        await this.sendFinalMissedDayNotification(userId);
        this.cancelMissedDaysCheck(userId);
      } else if (updatedChallenge.daysWithoutWorkout > 0) {
        // Есть пропущенные дни, но челлендж еще активен
        await this.sendMissedDayNotification(userId, updatedChallenge.daysWithoutWorkout);
      } else {
        // Проверяем, было ли фото отправлено вчера, даже если счетчик еще не увеличился
        // (это может произойти, если челлендж создан поздно вечером)
        const yesterdayDate = getYesterdayDateString(timezone);
        const hadPhotoYesterday = await challengeService.hasPhotoUploadedToday(userId, yesterdayDate);
        
        if (!hadPhotoYesterday) {
          // Фото не было отправлено вчера, но счетчик еще не увеличился
          // Это может произойти, если челлендж создан поздно вечером и проверка происходит на следующий день
          // Отправляем уведомление о пропущенном дне
          logger.info(`Photo not uploaded yesterday for user ${userId}, but daysWithoutWorkout is 0, sending notification anyway`);
          await this.sendMissedDayNotification(userId, 1);
        }
      }
    } catch (error) {
      const shouldCancel = handleTelegramError(error, userId);
      if (shouldCancel) {
        this.cancelMissedDaysCheck(userId);
        return;
      }
      logger.error(`Error checking missed days for user ${userId}:`, error);
      throw error;
    }
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

        const missedWorkoutText = 
          'Вчера ты дал жиру отдохнуть. Поделишься своим отчётом? Отправь его в чат, я сохраню, и по завершению челленджа ты увидишь, где были сложности и как прогрессировал.';

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
   * Перепланирует проверку пропущенных дней (при изменении часового пояса или времени напоминаний)
   */
  async rescheduleMissedDaysCheck(userId: number, timezone: number): Promise<void> {
    const challenge = await challengeService.getActiveChallenge(userId);
    if (!challenge) {
      return;
    }

    // Отменяем текущую проверку
    this.cancelMissedDaysCheck(userId);

    // Получаем время напоминания из челленджа (или null, если не установлено)
    const reminderTime = challenge.reminderTime ? challenge.reminderTime.slice(0, 5) : null; // HH:MM

    // Планируем новую проверку (перепланирование, не первое)
    const scheduledTime = this.getNextMissedCheckTime(reminderTime, timezone, new Date(challenge.startDate), false);
    const now = new Date();
    const delay = scheduledTime.getTime() - now.getTime();

    if (delay <= 0) {
      // Время уже прошло, планируем на завтра
      const tomorrowTime = this.getNextMissedCheckTime(reminderTime, timezone, new Date(challenge.startDate), false);
      const tomorrowDelay = tomorrowTime.getTime() - now.getTime();
      await this.scheduleMissedCheckInternal(userId, timezone, tomorrowTime, tomorrowDelay, challenge.id, new Date(challenge.startDate));
    } else {
      await this.scheduleMissedCheckInternal(userId, timezone, scheduledTime, delay, challenge.id, new Date(challenge.startDate));
    }
  }

  /**
   * Восстанавливает все уведомления при старте бота
   * Заново создает все проверки и напоминания для активных челленджей
   */
  async restoreNotifications(): Promise<void> {
    try {
      logger.info('Recreating notifications for all active challenges...');

      // Отменяем все существующие проверки и напоминания
      // Это гарантирует, что не будет дубликатов
      for (const [userId, check] of this.missedChecks.entries()) {
        clearTimeout(check.timeoutId);
        this.missedChecks.delete(userId);
        await this.removeMissedCheckFromRedis(userId);
      }

      for (const [userId, reminder] of this.dailyReminders.entries()) {
        clearTimeout(reminder.timeoutId);
        this.dailyReminders.delete(userId);
        await this.removeDailyReminderFromRedis(userId);
      }

      // Получаем все активные челленджи
      const activeChallenges = await challengeService.getAllActiveChallenges();
      let createdMissedChecks = 0;
      let createdDailyReminders = 0;

      // Для каждого активного челленджа заново создаем проверки и напоминания
      for (const challenge of activeChallenges) {
        try {
          const user = await userService.getUser(challenge.userId);
          const timezone = user?.timezone ?? 3;

          // Создаем проверку пропущенных дней для всех активных челленджей
          // Проверка будет использовать время напоминаний из челленджа (или 12:00 МСК по умолчанию)
          await this.scheduleMissedDaysCheck(challenge.userId, timezone, new Date(challenge.startDate));
          createdMissedChecks++;

          // Создаем ежедневное напоминание, если оно включено
          if (challenge.reminderStatus && challenge.reminderTime) {
            const reminderTime = challenge.reminderTime.slice(0, 5); // HH:MM
            await this.scheduleDailyReminder(challenge.userId, reminderTime, timezone);
            createdDailyReminders++;
          }
        } catch (error) {
          logger.error(`Error recreating notifications for user ${challenge.userId}:`, error);
        }
      }

      logger.info(`Recreated ${createdMissedChecks} missed checks and ${createdDailyReminders} daily reminders for active challenges`);

      // Планируем ежедневную проверку здоровья
      this.scheduleDailyHealthCheck();
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
            // Челлендж провален, отменяем проверки
            this.cancelMissedDaysCheck(challenge.userId);
            this.cancelDailyReminder(challenge.userId);
            // Отправляем финальное уведомление о провале
            if (this.botApi) {
              try {
                await this.sendFinalMissedDayNotification(challenge.userId);
              } catch (error) {
                logger.error(`Error sending final notification to user ${challenge.userId}:`, error);
              }
            }
            logger.info(`Challenge failed for user ${challenge.userId} during health check`);
            continue;
          }

          // 2. Проверяем, запланирована ли проверка пропущенных дней
          const hasMissedCheck = this.hasMissedDaysCheck(challenge.userId);
          if (!hasMissedCheck) {
            // Пересоздаем проверку
            // Уведомление будет отправлено в установленное пользователем время (или 12:00 МСК по умолчанию)
            await this.scheduleMissedDaysCheck(
              challenge.userId,
              timezone,
              new Date(challenge.startDate)
            );
            recreatedMissedChecks++;
            logger.info(`Recreated missed check for user ${challenge.userId}`);
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
        `recreated ${recreatedMissedChecks} missed checks, ` +
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

