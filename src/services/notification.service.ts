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
   * Вычисляет время следующей проверки пропущенных дней (4:00 по местному времени)
   * @param timezone - часовой пояс пользователя
   * @param challengeStartDate - дата создания челленджа (для проверки, создан ли между 0-4 ночи)
   * @param isFirstSchedule - true при первом планировании (проверяем время создания), false при перепланировании
   */
  private getNextMissedCheckTime(timezone: number, challengeStartDate: Date, isFirstSchedule: boolean = true): Date {
    const now = new Date();
    const timezoneOffsetMs = timezone * 60 * 60 * 1000;
    
    // Получаем текущее время в локальном часовом поясе
    const localNowMs = now.getTime() + timezoneOffsetMs;
    const msPerDay = 24 * 60 * 60 * 1000;
    const localDayStartMs = Math.floor(localNowMs / msPerDay) * msPerDay;
    
    // Время 4:00 сегодня в локальном времени
    const today4AMLocalMs = localDayStartMs + (4 * 60 * 60 * 1000);
    
    let nextCheckLocalMs: number;
    
    if (isFirstSchedule) {
      // При первом планировании проверяем время создания челленджа
      const challengeStartLocalMs = challengeStartDate.getTime() + timezoneOffsetMs;
      const challengeStartDayStartMs = Math.floor(challengeStartLocalMs / msPerDay) * msPerDay;
      const challengeStartHour = Math.floor((challengeStartLocalMs - challengeStartDayStartMs) / (60 * 60 * 1000));
      
      // Если челлендж создан между 0-4 ночи, планируем на завтра в 4:00
      if (challengeStartHour >= 0 && challengeStartHour < 4) {
        nextCheckLocalMs = today4AMLocalMs + msPerDay;
      } else {
        // Если 4:00 уже прошло сегодня, планируем на завтра
        nextCheckLocalMs = today4AMLocalMs <= localNowMs 
          ? today4AMLocalMs + msPerDay 
          : today4AMLocalMs;
      }
    } else {
      // При перепланировании просто планируем на следующее 4:00
      nextCheckLocalMs = today4AMLocalMs <= localNowMs 
        ? today4AMLocalMs + msPerDay 
        : today4AMLocalMs;
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

    const scheduledTime = this.getNextMissedCheckTime(timezone, challengeStartDate, true);
    const now = new Date();
    const delay = scheduledTime.getTime() - now.getTime();

    if (delay <= 0) {
      // Время уже прошло, планируем на завтра в 4:00
      const tomorrowTime = this.getNextMissedCheckTime(timezone, challengeStartDate, false);
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
          // При перепланировании используем isFirstSchedule = false
          const scheduledTime = this.getNextMissedCheckTime(currentTimezone, new Date(challenge.startDate), false);
          const now = new Date();
          const delay = scheduledTime.getTime() - now.getTime();
          if (delay > 0) {
            await this.scheduleMissedCheckInternal(userId, currentTimezone, scheduledTime, delay, challenge.id, new Date(challenge.startDate));
          } else {
            // Если время уже прошло, планируем на завтра
            const tomorrowTime = this.getNextMissedCheckTime(currentTimezone, new Date(challenge.startDate), false);
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
   * Перепланирует проверку пропущенных дней (при изменении часового пояса)
   */
  async rescheduleMissedDaysCheck(userId: number, timezone: number): Promise<void> {
    const challenge = await challengeService.getActiveChallenge(userId);
    if (!challenge) {
      return;
    }

    // Отменяем текущую проверку
    this.cancelMissedDaysCheck(userId);

    // Планируем новую проверку (перепланирование, не первое)
    const scheduledTime = this.getNextMissedCheckTime(timezone, new Date(challenge.startDate), false);
    const now = new Date();
    const delay = scheduledTime.getTime() - now.getTime();

    if (delay <= 0) {
      // Время уже прошло, планируем на завтра
      const tomorrowTime = this.getNextMissedCheckTime(timezone, new Date(challenge.startDate), false);
      const tomorrowDelay = tomorrowTime.getTime() - now.getTime();
      await this.scheduleMissedCheckInternal(userId, timezone, tomorrowTime, tomorrowDelay, challenge.id, new Date(challenge.startDate));
    } else {
      await this.scheduleMissedCheckInternal(userId, timezone, scheduledTime, delay, challenge.id, new Date(challenge.startDate));
    }
  }

  /**
   * Восстанавливает все уведомления из Redis при старте
   */
  async restoreNotifications(): Promise<void> {
    try {
      logger.info('Restoring notifications from Redis...');

      // Восстанавливаем ежедневные уведомления
      const dailyListKey = getDailyRemindersListKey();
      const dailyUserIds = await redis.smembers(dailyListKey);
      let restoredDaily = 0;

      for (const userIdStr of dailyUserIds) {
        const userId = parseInt(userIdStr, 10);
        if (isNaN(userId)) continue;

        try {
          const dataJson = await redis.get(getDailyReminderDataKey(userId));
          if (!dataJson) {
            await redis.srem(dailyListKey, userIdStr);
            continue;
          }

          const data: DailyReminderData = JSON.parse(dataJson);
          const scheduledTime = new Date(data.scheduledTime);
          const now = new Date();

          // Проверяем актуальность
          const challenge = await challengeService.getActiveChallenge(userId);
          if (!challenge || challenge.status !== 'active' || !challenge.reminderStatus) {
            await this.removeDailyReminderFromRedis(userId);
            continue;
          }

          // Если время прошло, планируем на завтра
          if (scheduledTime <= now) {
            const user = await userService.getUser(userId);
            const timezone = user?.timezone ?? data.timezone;
            await this.scheduleDailyReminder(userId, data.reminderTime, timezone);
          } else {
            // Восстанавливаем уведомление
            const delay = scheduledTime.getTime() - now.getTime();
            await this.scheduleDailyReminderInternal(
              userId,
              data.reminderTime,
              data.timezone,
              scheduledTime,
              delay,
              data.challengeId
            );
          }
          restoredDaily++;
        } catch (error) {
          logger.error(`Error restoring daily reminder for user ${userId}:`, error);
        }
      }

      // Восстанавливаем проверки пропущенных дней
      const missedListKey = getMissedChecksListKey();
      const missedUserIds = await redis.smembers(missedListKey);
      let restoredMissed = 0;

      for (const userIdStr of missedUserIds) {
        const userId = parseInt(userIdStr, 10);
        if (isNaN(userId)) continue;

        try {
          const dataJson = await redis.get(getMissedCheckDataKey(userId));
          if (!dataJson) {
            await redis.srem(missedListKey, userIdStr);
            continue;
          }

          const data: MissedCheckData = JSON.parse(dataJson);
          const scheduledTime = new Date(data.scheduledTime);
          const now = new Date();

          // Проверяем актуальность
          const challenge = await challengeService.getActiveChallenge(userId);
          if (!challenge || challenge.status !== 'active') {
            await this.removeMissedCheckFromRedis(userId);
            continue;
          }

          // Если время прошло, планируем на завтра в 4:00 (перепланирование)
          if (scheduledTime <= now) {
            const user = await userService.getUser(userId);
            const timezone = user?.timezone ?? data.timezone;
            const tomorrowTime = this.getNextMissedCheckTime(timezone, new Date(data.challengeStartDate), false);
            const tomorrowDelay = tomorrowTime.getTime() - now.getTime();
            await this.scheduleMissedCheckInternal(userId, timezone, tomorrowTime, tomorrowDelay, data.challengeId, new Date(data.challengeStartDate));
          } else {
            // Восстанавливаем проверку
            const delay = scheduledTime.getTime() - now.getTime();
            await this.scheduleMissedCheckInternal(
              userId,
              data.timezone,
              scheduledTime,
              delay,
              data.challengeId,
              new Date(data.challengeStartDate)
            );
          }
          restoredMissed++;
        } catch (error) {
          logger.error(`Error restoring missed check for user ${userId}:`, error);
        }
      }

      logger.info(`Restored ${restoredDaily} daily reminders and ${restoredMissed} missed checks from Redis`);

      // Инициализируем уведомления для активных челленджей без уведомлений
      await this.initializeNotificationsForActiveChallenges();
    } catch (error) {
      logger.error('Error restoring notifications from Redis:', error);
    }
  }

  /**
   * Инициализирует уведомления для активных челленджей, которые еще не запланированы
   */
  private async initializeNotificationsForActiveChallenges(): Promise<void> {
    try {
      const activeChallenges = await challengeService.getAllActiveChallenges();
      let initializedMissed = 0;

      for (const challenge of activeChallenges) {
        // Пропускаем, если проверка уже запланирована
        if (this.missedChecks.has(challenge.userId)) {
          continue;
        }

        // Проверяем в Redis
        const dataJson = await redis.get(getMissedCheckDataKey(challenge.userId));
        if (dataJson) {
          continue;
        }

        // Планируем проверку пропущенных дней
        const user = await userService.getUser(challenge.userId);
        const timezone = user?.timezone ?? 3;
        await this.scheduleMissedDaysCheck(challenge.userId, timezone, new Date(challenge.startDate));
        initializedMissed++;
      }

      if (initializedMissed > 0) {
        logger.info(`Initialized ${initializedMissed} missed checks for active challenges`);
      }
    } catch (error) {
      logger.error('Error initializing notifications for active challenges:', error);
    }
  }
}

export const notificationService = new NotificationService();

