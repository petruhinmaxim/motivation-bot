import type { Api } from 'grammy';
import { InputFile } from 'grammy';
import logger from '../utils/logger.js';
import redis from '../redis/client.js';
import { 
  getScheduledTaskDataKey, 
  getScheduledTasksKey,
  getDailyRemindersKey,
  getDailyReminderDataKey,
  getMidnightChecksKey,
  getMidnightCheckDataKey,
  getReminderLockKey,
  getLastMissedDayNotificationKey,
} from '../redis/keys.js';
import { getRandomReminderPhrase } from '../utils/motivational-phrases.js';
import { handleChallengeStatsScene } from '../scenes/challenge-stats.scene.js';
import { handleChallengeStartNotificationScene } from '../scenes/challenge-start-notification.scene.js';
import { handleChallengeFailedScene } from '../scenes/challenge-failed.scene.js';
import { challengeService } from './challenge.service.js';
import { userService } from './user.service.js';
import { handleTelegramError } from '../utils/telegram-error-handler.js';
import { getMissedDayImagePath } from '../utils/missed-days-images.js';

interface ScheduledTask {
  userId: number;
  timeoutId: NodeJS.Timeout;
  scheduledTime: Date;
}

interface SavedTask {
  userId: number;
  scheduledTime: string; // ISO string
  type: 'tomorrow' | 'monday' | 'daily_reminder';
}

interface DailyReminderData {
  userId: number;
  reminderTime: string; // HH:MM format
  timezone: number; // UTC offset in hours
  scheduledTime: string; // ISO string of next scheduled reminder
}

interface MidnightCheckData {
  userId: number;
  timezone: number; // UTC offset in hours
  scheduledTime: string; // ISO string of next scheduled midnight check
}

class SchedulerService {
  private tasks = new Map<number, ScheduledTask>();
  private dailyReminders = new Map<number, ScheduledTask>();
  private midnightChecks = new Map<number, ScheduledTask>();
  private botApi: Api | null = null;
  private isRestoring = false; // Флаг для предотвращения параллельных вызовов restoreTasks
  private healthCheckInterval: NodeJS.Timeout | null = null;

  /**
   * Устанавливает API бота (вызывается после инициализации бота)
   */
  setBotApi(api: Api): void {
    this.botApi = api;
  }

  /**
   * Восстанавливает все запланированные задачи из Redis при старте
   * Использует Redis lock для предотвращения race conditions
   */
  async restoreTasks(): Promise<void> {
    // Предотвращаем параллельные вызовы через Redis lock
    const lockKey = 'scheduler:restore:lock';
    const lockValue = Date.now().toString();
    const lockTTL = 60; // 60 секунд
    
    // Пытаемся получить блокировку
    const lockAcquired = await redis.set(lockKey, lockValue, 'EX', lockTTL, 'NX');
    
    if (!lockAcquired) {
      logger.warn('Restore tasks already in progress (lock exists), skipping');
      return;
    }

    // Устанавливаем локальный флаг для дополнительной защиты
    if (this.isRestoring) {
      await redis.del(lockKey);
      logger.warn('Restore tasks already in progress (local flag), skipping');
      return;
    }

    this.isRestoring = true;
    try {
      // Восстанавливаем одноразовые задачи
      const tasksJson = await redis.get(getScheduledTasksKey());
      if (tasksJson) {
        const savedTasks: SavedTask[] = JSON.parse(tasksJson);
        const now = new Date();
        let restoredCount = 0;

        for (const task of savedTasks) {
          const scheduledTime = new Date(task.scheduledTime);
          
          // Пропускаем задачи, которые уже должны были выполниться
          if (scheduledTime <= now) {
            logger.warn(`Skipping expired task for user ${task.userId}`);
            await this.removeTaskFromRedis(task.userId);
            continue;
          }

          // Проверяем, не запланирована ли уже задача для этого пользователя
          if (this.tasks.has(task.userId)) {
            logger.warn(`Task already scheduled for user ${task.userId}, skipping restore`);
            continue;
          }

          // Восстанавливаем задачу
          if (task.type === 'tomorrow') {
            this.scheduleTomorrowDuration(task.userId);
          } else if (task.type === 'monday') {
            this.scheduleMondayDuration(task.userId);
          }
          restoredCount++;
        }

        logger.info(`Restored ${restoredCount} scheduled tasks from Redis`);
      }

      // Восстанавливаем ежедневные напоминания
      await this.restoreDailyReminders();
      
      // Восстанавливаем проверки пропущенных дней (4:00 утра)
      await this.restoreMidnightChecks();
      
      // Инициализируем проверки пропущенных дней для всех активных челленджей, которые еще не запланированы
      await this.initializeMidnightChecksForActiveChallenges();
      
      // Инициализируем напоминания для всех активных челленджей, которые еще не запланированы
      await this.initializeDailyRemindersForActiveChallenges();
    } catch (error) {
      logger.error('Error restoring tasks from Redis:', error);
    } finally {
      this.isRestoring = false;
      // Освобождаем блокировку
      try {
        await redis.del(lockKey);
      } catch (error) {
        logger.error('Error releasing restore lock:', error);
      }
    }
  }

  /**
   * Восстанавливает ежедневные напоминания из Redis
   */
  private async restoreDailyReminders(): Promise<void> {
    try {
      const remindersJson = await redis.get(getDailyRemindersKey());
      if (!remindersJson) {
        logger.info('No daily reminders to restore');
        return;
      }

      const reminders: DailyReminderData[] = JSON.parse(remindersJson);
      let restoredCount = 0;

      for (const reminder of reminders) {
        try {
          // Проверяем, не запланировано ли уже напоминание для этого пользователя в памяти
          if (this.dailyReminders.has(reminder.userId)) {
            logger.warn(`Daily reminder already scheduled in memory for user ${reminder.userId}, skipping restore`);
            continue;
          }

          // Дополнительная проверка: проверяем, есть ли активное напоминание в Redis
          const reminderDataKey = getDailyReminderDataKey(reminder.userId);
          const existingReminderData = await redis.get(reminderDataKey);
          if (existingReminderData) {
            try {
              const existingReminder: DailyReminderData = JSON.parse(existingReminderData);
              const scheduledTime = new Date(existingReminder.scheduledTime);
              const now = new Date();
              
              // Если напоминание еще не должно было выполниться, пропускаем восстановление
              // (возможно, оно уже запланировано в другом экземпляре)
              if (scheduledTime > now) {
                logger.debug(
                  `Daily reminder already exists in Redis for user ${reminder.userId} (scheduled for ${scheduledTime.toISOString()}), skipping restore`
                );
                continue;
              }
            } catch (parseError) {
              logger.warn(`Error parsing existing reminder data for user ${reminder.userId}, continuing restore:`, parseError);
            }
          }

          // Проверяем, что челлендж все еще активен
          const challenge = await challengeService.getActiveChallenge(reminder.userId);
          if (!challenge) {
            logger.warn(`Skipping reminder for user ${reminder.userId}: challenge inactive`);
            await this.removeDailyReminderFromRedis(reminder.userId);
            continue;
          }

          // Планируем следующее напоминание (используем время из челленджа или null)
          const reminderTime = challenge.reminderTime || null;
          await this.scheduleDailyReminder(reminder.userId, reminderTime);
          restoredCount++;
        } catch (error) {
          logger.error(`Error restoring daily reminder for user ${reminder.userId}:`, error);
        }
      }

      logger.info(`Restored ${restoredCount} daily reminders from Redis`);
    } catch (error) {
      logger.error('Error restoring daily reminders from Redis:', error);
    }
  }

  /**
   * Сохраняет задачу в Redis
   */
  private async saveTaskToRedis(userId: number, scheduledTime: Date, type: 'tomorrow' | 'monday'): Promise<void> {
    try {
      const taskData: SavedTask = {
        userId,
        scheduledTime: scheduledTime.toISOString(),
        type,
      };

      // Сохраняем данные задачи
      const ttlSeconds = Math.ceil((scheduledTime.getTime() - Date.now()) / 1000) + 3600; // TTL = время до выполнения + 1 час
      await redis.set(
        getScheduledTaskDataKey(userId),
        JSON.stringify(taskData),
        'EX',
        ttlSeconds > 0 ? ttlSeconds : 3600
      );

      // Добавляем в список всех задач
      const tasksKey = getScheduledTasksKey();
      const existingTasksJson = await redis.get(tasksKey);
      const existingTasks: SavedTask[] = existingTasksJson ? JSON.parse(existingTasksJson) : [];
      
      // Удаляем старую задачу для этого пользователя, если есть
      const filteredTasks = existingTasks.filter(t => t.userId !== userId);
      filteredTasks.push(taskData);

      await redis.set(tasksKey, JSON.stringify(filteredTasks));
    } catch (error) {
      logger.error(`Error saving task to Redis for user ${userId}:`, error);
    }
  }

  /**
   * Сохраняет ежедневное напоминание в Redis
   */
  private async saveDailyReminderToRedis(
    userId: number,
    reminderTime: string,
    timezone: number,
    scheduledTime: Date
  ): Promise<void> {
    try {
      const reminderData: DailyReminderData = {
        userId,
        reminderTime,
        timezone,
        scheduledTime: scheduledTime.toISOString(),
      };

      // Сохраняем данные напоминания
      const ttlSeconds = Math.ceil((scheduledTime.getTime() - Date.now()) / 1000) + 86400; // TTL = время до выполнения + 1 день
      await redis.set(
        getDailyReminderDataKey(userId),
        JSON.stringify(reminderData),
        'EX',
        ttlSeconds > 0 ? ttlSeconds : 86400
      );

      // Добавляем в список всех ежедневных напоминаний
      const remindersKey = getDailyRemindersKey();
      const existingRemindersJson = await redis.get(remindersKey);
      const existingReminders: DailyReminderData[] = existingRemindersJson ? JSON.parse(existingRemindersJson) : [];
      
      // Удаляем старое напоминание для этого пользователя, если есть
      const filteredReminders = existingReminders.filter(r => r.userId !== userId);
      filteredReminders.push(reminderData);

      await redis.set(remindersKey, JSON.stringify(filteredReminders));
    } catch (error) {
      logger.error(`Error saving daily reminder to Redis for user ${userId}:`, error);
    }
  }

  /**
   * Удаляет задачу из Redis
   */
  private async removeTaskFromRedis(userId: number): Promise<void> {
    try {
      await redis.del(getScheduledTaskDataKey(userId));

      const tasksKey = getScheduledTasksKey();
      const existingTasksJson = await redis.get(tasksKey);
      if (existingTasksJson) {
        const existingTasks: SavedTask[] = JSON.parse(existingTasksJson);
        const filteredTasks = existingTasks.filter(t => t.userId !== userId);
        await redis.set(tasksKey, JSON.stringify(filteredTasks));
      }
    } catch (error) {
      logger.error(`Error removing task from Redis for user ${userId}:`, error);
    }
  }

  /**
   * Удаляет ежедневное напоминание из Redis
   */
  private async removeDailyReminderFromRedis(userId: number): Promise<void> {
    try {
      await redis.del(getDailyReminderDataKey(userId));

      const remindersKey = getDailyRemindersKey();
      const existingRemindersJson = await redis.get(remindersKey);
      if (existingRemindersJson) {
        const existingReminders: DailyReminderData[] = JSON.parse(existingRemindersJson);
        const filteredReminders = existingReminders.filter(r => r.userId !== userId);
        await redis.set(remindersKey, JSON.stringify(filteredReminders));
      }
    } catch (error) {
      logger.error(`Error removing daily reminder from Redis for user ${userId}:`, error);
    }
  }

  /**
   * Планирует отправку сообщения пользователю в указанное время
   */
  scheduleMessage(userId: number, scheduledTime: Date, callback: () => Promise<void>): void {
    // Отменяем предыдущую задачу для этого пользователя, если есть
    this.cancelTask(userId);

    const now = new Date();
    const delay = scheduledTime.getTime() - now.getTime();

    if (delay <= 0) {
      logger.warn(`Scheduled time is in the past for user ${userId}, executing immediately`);
      callback().catch((error) => {
        logger.error(`Error executing scheduled task for user ${userId}:`, error);
      });
      return;
    }

    logger.info(
      `Scheduling message for user ${userId} at ${scheduledTime.toISOString()} (in ${Math.round(delay / 1000)}s)`
    );

    const timeoutId = setTimeout(async () => {
      try {
        await callback();
        this.tasks.delete(userId);
        await this.removeTaskFromRedis(userId);
        logger.info(`Scheduled task completed for user ${userId}`);
      } catch (error) {
        logger.error(`Error in scheduled task for user ${userId}:`, error);
        this.tasks.delete(userId);
        await this.removeTaskFromRedis(userId);
      }
    }, delay);

    this.tasks.set(userId, {
      userId,
      timeoutId,
      scheduledTime,
    });
  }

  /**
   * Отменяет запланированную задачу для пользователя
   */
  cancelTask(userId: number): void {
    const task = this.tasks.get(userId);
    if (task) {
      clearTimeout(task.timeoutId);
      this.tasks.delete(userId);
      this.removeTaskFromRedis(userId);
      logger.info(`Cancelled scheduled task for user ${userId}`);
    }
  }

  /**
   * Отменяет ежедневное напоминание для пользователя
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
   * Получает время следующего 4:00 утра в часовом поясе пользователя
   * @param timezone - Смещение от UTC в часах
   * @returns Дата следующего 4:00 утра в UTC
   */
  private getNextMidnightTime(timezone: number): Date {
    const now = new Date();
    
    // Смещение часового пояса в миллисекундах
    const timezoneOffsetMs = timezone * 60 * 60 * 1000;
    
    // Получаем текущее время в UTC (миллисекунды)
    const nowUtcMs = now.getTime();
    
    // Вычисляем текущее время в локальном часовом поясе пользователя (в миллисекундах)
    // Это не реальное UTC время, а просто число для вычислений
    const localNowMs = nowUtcMs + timezoneOffsetMs;
    
    // Вычисляем начало текущего дня в локальном времени (00:00:00)
    const msPerDay = 24 * 60 * 60 * 1000;
    const localDayStartMs = Math.floor(localNowMs / msPerDay) * msPerDay;
    
    // Время 4:00 утра сегодня в локальном времени (в миллисекундах)
    const targetLocalMs = localDayStartMs + (4 * 60 * 60 * 1000);
    
    // Если 4:00 уже прошло сегодня, планируем на завтра
    const nextTargetLocalMs = targetLocalMs <= localNowMs 
      ? targetLocalMs + msPerDay 
      : targetLocalMs;
    
    // Конвертируем обратно в UTC: вычитаем смещение часового пояса
    const nextTargetUtcMs = nextTargetLocalMs - timezoneOffsetMs;
    
    return new Date(nextTargetUtcMs);
  }

  /**
   * Планирует проверку пропущенных дней для пользователя (выполняется в 4:00 утра по местному времени)
   * @param userId - ID пользователя
   */
  async scheduleMidnightCheck(userId: number): Promise<void> {
    // Отменяем предыдущую проверку, если есть
    this.cancelMidnightCheck(userId);

    // Получаем или устанавливаем часовой пояс по умолчанию (МСК)
    const userTimezone = await userService.getOrSetDefaultTimezone(userId);

    const scheduledTime = this.getNextMidnightTime(userTimezone);
    const now = new Date();
    const delay = scheduledTime.getTime() - now.getTime();

    if (delay <= 0) {
      logger.warn(`Scheduled check time (4:00 AM) is in the past for user ${userId}, scheduling for tomorrow`);
      // Если время уже прошло, планируем на завтра
      const tomorrowTime = this.getNextMidnightTime(userTimezone);
      const tomorrowDelay = tomorrowTime.getTime() - now.getTime();
      this.scheduleMidnightCheckInternal(userId, userTimezone, tomorrowTime, tomorrowDelay);
      return;
    }

    this.scheduleMidnightCheckInternal(userId, userTimezone, scheduledTime, delay);
  }

  /**
   * Внутренний метод для планирования проверки пропущенных дней (4:00 утра)
   */
  private scheduleMidnightCheckInternal(
    userId: number,
    timezone: number,
    scheduledTime: Date,
    delay: number
  ): void {
    logger.info(
      `Scheduling missed days check (4:00 AM) for user ${userId} at ${scheduledTime.toISOString()} (in ${Math.round(delay / 1000)}s)`
    );

    const timeoutId = setTimeout(async () => {
      try {
        // Получаем актуальный часовой пояс пользователя (может быть установлен МСК по умолчанию)
        await this.performMidnightCheck(userId);
        this.midnightChecks.delete(userId);
        // Планируем следующую проверку
        await this.scheduleMidnightCheck(userId);
      } catch (error) {
        logger.error(`Error in midnight check for user ${userId}:`, error);
        this.midnightChecks.delete(userId);
        // Пытаемся запланировать следующую проверку даже при ошибке
        try {
          await this.scheduleMidnightCheck(userId);
        } catch (retryError) {
          logger.error(`Error retrying midnight check for user ${userId}:`, retryError);
        }
      }
    }, delay);

    this.midnightChecks.set(userId, {
      userId,
      timeoutId,
      scheduledTime,
    });

    // Сохраняем в Redis
    this.saveMidnightCheckToRedis(userId, timezone, scheduledTime);
  }

  /**
   * Выполняет проверку пропущенных дней для пользователя (вызывается в 4:00 утра по местному времени)
   */
  private async performMidnightCheck(userId: number): Promise<void> {
    try {
      // Получаем или устанавливаем часовой пояс по умолчанию (МСК)
      const userTimezone = await userService.getOrSetDefaultTimezone(userId);
      
      // Проверяем и увеличиваем счетчик дней без тренировки
      const challengeFailed = await challengeService.checkAndIncrementMissedDays(userId, userTimezone);
      
      // Если челлендж был переведен в failed, отменяем только полночные проверки
      // Напоминания оставляем активными, чтобы сцена провала была отправлена вместо напоминания
      // Напоминания будут отменены после отправки сцены провала в sendDailyReminder
      if (challengeFailed) {
        this.cancelMidnightCheck(userId);
        logger.info(`Challenge failed for user ${userId}, cancelled midnight checks. Reminder will send failed scene.`);
      }
      
      logger.info(`Midnight check completed for user ${userId}`);
    } catch (error) {
      logger.error(`Error performing midnight check for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Сохраняет полночную проверку в Redis
   */
  private async saveMidnightCheckToRedis(
    userId: number,
    timezone: number,
    scheduledTime: Date
  ): Promise<void> {
    try {
      const checkData: MidnightCheckData = {
        userId,
        timezone,
        scheduledTime: scheduledTime.toISOString(),
      };

      // Сохраняем данные проверки
      const ttlSeconds = Math.ceil((scheduledTime.getTime() - Date.now()) / 1000) + 86400; // TTL = время до выполнения + 1 день
      await redis.set(
        getMidnightCheckDataKey(userId),
        JSON.stringify(checkData),
        'EX',
        ttlSeconds > 0 ? ttlSeconds : 86400
      );

      // Добавляем в список всех проверок пропущенных дней
      const checksKey = getMidnightChecksKey();
      const existingChecksJson = await redis.get(checksKey);
      const existingChecks: MidnightCheckData[] = existingChecksJson ? JSON.parse(existingChecksJson) : [];
      
      // Удаляем старую проверку для этого пользователя, если есть
      const filteredChecks = existingChecks.filter(c => c.userId !== userId);
      filteredChecks.push(checkData);

      await redis.set(checksKey, JSON.stringify(filteredChecks));
    } catch (error) {
      logger.error(`Error saving midnight check to Redis for user ${userId}:`, error);
    }
  }

  /**
   * Восстанавливает проверки пропущенных дней (4:00 утра) из Redis
   */
  private async restoreMidnightChecks(): Promise<void> {
    try {
      const checksJson = await redis.get(getMidnightChecksKey());
      if (!checksJson) {
        logger.info('No midnight checks to restore');
        return;
      }

      const checks: MidnightCheckData[] = JSON.parse(checksJson);
      let restoredCount = 0;

      for (const check of checks) {
        try {
          // Проверяем, не запланирована ли уже проверка для этого пользователя
          if (this.midnightChecks.has(check.userId)) {
            logger.warn(`Midnight check already scheduled for user ${check.userId}, skipping restore`);
            continue;
          }

          // Проверяем, что челлендж все еще активен
          const challenge = await challengeService.getActiveChallenge(check.userId);
          if (!challenge || challenge.status !== 'active') {
            logger.warn(`Skipping midnight check for user ${check.userId}: challenge inactive`);
            await this.removeMidnightCheckFromRedis(check.userId);
            continue;
          }

          // Планируем следующую проверку (часовой пояс будет установлен автоматически, если нужно)
          await this.scheduleMidnightCheck(check.userId);
          restoredCount++;
        } catch (error) {
          logger.error(`Error restoring midnight check for user ${check.userId}:`, error);
        }
      }

      logger.info(`Restored ${restoredCount} midnight checks from Redis`);
    } catch (error) {
      logger.error('Error restoring midnight checks from Redis:', error);
    }
  }

  /**
   * Удаляет проверку пропущенных дней из Redis
   */
  private async removeMidnightCheckFromRedis(userId: number): Promise<void> {
    try {
      await redis.del(getMidnightCheckDataKey(userId));

      const checksKey = getMidnightChecksKey();
      const existingChecksJson = await redis.get(checksKey);
      if (existingChecksJson) {
        const existingChecks: MidnightCheckData[] = JSON.parse(existingChecksJson);
        const filteredChecks = existingChecks.filter(c => c.userId !== userId);
        await redis.set(checksKey, JSON.stringify(filteredChecks));
      }
    } catch (error) {
      logger.error(`Error removing midnight check from Redis for user ${userId}:`, error);
    }
  }

  /**
   * Отменяет проверку пропущенных дней для пользователя
   */
  cancelMidnightCheck(userId: number): void {
    const check = this.midnightChecks.get(userId);
    if (check) {
      clearTimeout(check.timeoutId);
      this.midnightChecks.delete(userId);
      this.removeMidnightCheckFromRedis(userId);
      logger.info(`Cancelled midnight check for user ${userId}`);
    }
  }

  /**
   * Инициализирует полночные проверки для всех активных челленджей, которые еще не запланированы
   */
  private async initializeMidnightChecksForActiveChallenges(): Promise<void> {
    try {
      const activeChallenges = await challengeService.getAllActiveChallenges();
      let initializedCount = 0;

      for (const challenge of activeChallenges) {
        // Пропускаем, если проверка уже запланирована
        if (this.midnightChecks.has(challenge.userId)) {
          continue;
        }

        // Планируем проверку пропущенных дней (4:00 утра)
        // Часовой пояс будет установлен автоматически (МСК), если не установлен
        await this.scheduleMidnightCheck(challenge.userId);
        initializedCount++;
      }

      if (initializedCount > 0) {
        logger.info(`Initialized ${initializedCount} midnight checks for active challenges`);
      }
    } catch (error) {
      logger.error('Error initializing midnight checks for active challenges:', error);
    }
  }

  /**
   * Инициализирует ежедневные напоминания для всех активных челленджей, которые еще не запланированы
   */
  private async initializeDailyRemindersForActiveChallenges(): Promise<void> {
    try {
      const activeChallenges = await challengeService.getAllActiveChallenges();
      let initializedCount = 0;

      for (const challenge of activeChallenges) {
        // Пропускаем, если напоминание уже запланировано в памяти
        if (this.dailyReminders.has(challenge.userId)) {
          continue;
        }

        // Дополнительная проверка: проверяем, есть ли активное напоминание в Redis
        const reminderDataKey = getDailyReminderDataKey(challenge.userId);
        const existingReminderData = await redis.get(reminderDataKey);
        if (existingReminderData) {
          try {
            const existingReminder: DailyReminderData = JSON.parse(existingReminderData);
            const scheduledTime = new Date(existingReminder.scheduledTime);
            const now = new Date();
            
            // Если напоминание уже запланировано и еще не должно было выполниться, пропускаем
            if (scheduledTime > now) {
              logger.debug(
                `Daily reminder already exists in Redis for user ${challenge.userId} (scheduled for ${scheduledTime.toISOString()}), skipping initialization`
              );
              continue;
            }
          } catch (parseError) {
            logger.warn(`Error parsing existing reminder data for user ${challenge.userId}, continuing initialization:`, parseError);
          }
        }

        // Планируем ежедневное напоминание (используем время из челленджа или null для 12:00 МСК)
        const reminderTime = challenge.reminderTime || null;
        await this.scheduleDailyReminder(challenge.userId, reminderTime);
        initializedCount++;
      }

      if (initializedCount > 0) {
        logger.info(`Initialized ${initializedCount} daily reminders for active challenges`);
      }
    } catch (error) {
      logger.error('Error initializing daily reminders for active challenges:', error);
    }
  }

  /**
   * Проверяет все активные челленджи и восстанавливает напоминания, если они отсутствуют
   */
  private async verifyAndRestoreReminders(): Promise<void> {
    try {
      logger.info('Starting reminder health check...');
      
      const activeChallenges = await challengeService.getAllActiveChallenges();
      let restoredCount = 0;
      let checkedCount = 0;

      for (const challenge of activeChallenges) {
        checkedCount++;
        
        // Проверяем, должно ли быть напоминание
        // Если reminderStatus = false, напоминание не должно быть
        if (!challenge.reminderStatus) {
          continue;
        }

        // Проверяем, есть ли напоминание в памяти
        const hasInMemory = this.dailyReminders.has(challenge.userId);
        
        // Проверяем, есть ли напоминание в Redis
        const reminderDataKey = getDailyReminderDataKey(challenge.userId);
        const reminderDataJson = await redis.get(reminderDataKey);
        const hasInRedis = reminderDataJson !== null;

        // Если напоминание отсутствует и в памяти, и в Redis - восстанавливаем
        if (!hasInMemory && !hasInRedis) {
          logger.warn(`Reminder missing for user ${challenge.userId} (not in memory or Redis), restoring...`);
          try {
            const reminderTime = challenge.reminderTime || null;
            await this.scheduleDailyReminder(challenge.userId, reminderTime);
            restoredCount++;
            logger.info(`Restored missing reminder for user ${challenge.userId}`);
          } catch (error) {
            logger.error(`Error restoring reminder for user ${challenge.userId}:`, error);
          }
        } else if (hasInRedis && !hasInMemory) {
          // Напоминание есть в Redis, но не в памяти - проверяем, нужно ли восстанавливать
          try {
            const reminderData: DailyReminderData = JSON.parse(reminderDataJson!);
            const scheduledTime = new Date(reminderData.scheduledTime);
            const now = new Date();
            
            // Если время еще не прошло, восстанавливаем из Redis
            if (scheduledTime > now) {
              logger.warn(
                `Reminder exists in Redis but not in memory for user ${challenge.userId} (scheduled for ${scheduledTime.toISOString()}), restoring...`
              );
              const delay = scheduledTime.getTime() - now.getTime();
              await this.scheduleDailyReminderInternal(
                challenge.userId,
                reminderData.reminderTime,
                scheduledTime,
                delay
              );
              restoredCount++;
              logger.info(`Restored reminder from Redis for user ${challenge.userId}`);
            } else {
              // Время прошло, планируем следующее
              logger.warn(
                `Reminder in Redis expired for user ${challenge.userId} (was scheduled for ${scheduledTime.toISOString()}), scheduling next...`
              );
              await this.scheduleDailyReminder(challenge.userId, reminderData.reminderTime);
              restoredCount++;
              logger.info(`Scheduled next reminder for user ${challenge.userId}`);
            }
          } catch (error) {
            logger.error(`Error restoring reminder from Redis for user ${challenge.userId}:`, error);
          }
        } else if (hasInMemory && !hasInRedis) {
          // Напоминание есть в памяти, но не в Redis - синхронизируем с Redis
          logger.warn(`Reminder exists in memory but not in Redis for user ${challenge.userId}, syncing...`);
          try {
            const reminder = this.dailyReminders.get(challenge.userId);
            if (reminder) {
              const reminderTime = challenge.reminderTime || null;
              const userTimezone = await userService.getOrSetDefaultTimezone(challenge.userId);
              await this.saveDailyReminderToRedis(
                challenge.userId,
                reminderTime || '12:00',
                userTimezone,
                reminder.scheduledTime
              );
              logger.info(`Synced reminder to Redis for user ${challenge.userId}`);
            }
          } catch (error) {
            logger.error(`Error syncing reminder to Redis for user ${challenge.userId}:`, error);
          }
        }
        // Если напоминание есть и в памяти, и в Redis - все в порядке, пропускаем
      }

      logger.info(
        `Health check completed: checked ${checkedCount} challenges, restored ${restoredCount} reminders`
      );
    } catch (error) {
      logger.error('Error in verifyAndRestoreReminders:', error);
    }
  }

  /**
   * Запускает периодическую проверку и восстановление напоминаний
   * @param intervalHours - интервал проверки в часах (по умолчанию 12 часов)
   */
  startHealthCheck(intervalHours: number = 12): void {
    // Проверяем сразу при запуске
    this.verifyAndRestoreReminders().catch((error) => {
      logger.error('Error in initial health check:', error);
    });

    // Затем проверяем периодически
    const intervalMs = intervalHours * 60 * 60 * 1000; // Конвертируем часы в миллисекунды
    this.healthCheckInterval = setInterval(() => {
      this.verifyAndRestoreReminders().catch((error) => {
        logger.error('Error in periodic health check:', error);
      });
    }, intervalMs);

    logger.info(`Started reminder health check with interval ${intervalHours} hours`);
  }

  /**
   * Останавливает периодическую проверку
   */
  stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      logger.info('Stopped reminder health check');
    }
  }

  /**
   * Вычисляет следующее время напоминания с учетом часового пояса пользователя
   * @param reminderTime - время в формате HH:MM
   * @param timezone - смещение от UTC в часах
   * @returns Дата следующего напоминания в UTC
   */
  private getNextReminderTime(reminderTime: string, timezone: number): Date {
    const now = new Date();
    const [hours, minutes] = reminderTime.split(':').map(Number);
    
    // Смещение часового пояса в миллисекундах
    const timezoneOffsetMs = timezone * 60 * 60 * 1000;
    
    // Получаем текущее время в UTC (миллисекунды)
    const nowUtcMs = now.getTime();
    
    // Вычисляем текущее время в локальном часовом поясе пользователя (в миллисекундах)
    // Это не реальное UTC время, а просто число для вычислений
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
   * Планирует ежедневное напоминание для пользователя
   * @param userId - ID пользователя
   * @param reminderTime - время в формате HH:MM, или null если не установлено (будет использовано 12:00 МСК)
   */
  async scheduleDailyReminder(userId: number, reminderTime: string | null): Promise<void> {
    // Отменяем предыдущее напоминание, если есть
    this.cancelDailyReminder(userId);

    // Получаем или устанавливаем часовой пояс по умолчанию (МСК)
    const userTimezone = await userService.getOrSetDefaultTimezone(userId);

    // Если время не установлено, используем 12:00 МСК
    const scheduledTime = reminderTime 
      ? this.getNextReminderTime(reminderTime, userTimezone)
      : this.getNext12MSKTime();
    
    const now = new Date();
    const delay = scheduledTime.getTime() - now.getTime();

    if (delay <= 0) {
      logger.warn(`Scheduled reminder time is in the past for user ${userId}, scheduling for tomorrow`);
      // Если время уже прошло, планируем на завтра
      const tomorrowTime = reminderTime 
        ? this.getNextReminderTime(reminderTime, userTimezone)
        : this.getNext12MSKTime();
      const tomorrowDelay = tomorrowTime.getTime() - now.getTime();
      await this.scheduleDailyReminderInternal(userId, reminderTime, tomorrowTime, tomorrowDelay);
      return;
    }

    await this.scheduleDailyReminderInternal(userId, reminderTime, scheduledTime, delay);
  }

  /**
   * Внутренний метод для планирования ежедневного напоминания
   */
  private async scheduleDailyReminderInternal(
    userId: number,
    reminderTime: string | null,
    scheduledTime: Date,
    delay: number
  ): Promise<void> {
    logger.info(
      `Scheduling daily reminder for user ${userId} at ${scheduledTime.toISOString()} (in ${Math.round(delay / 1000)}s, reminderTime: ${reminderTime || '12:00 MSK'})`
    );

    const timeoutId = setTimeout(async () => {
      try {
        // Получаем актуальный часовой пояс пользователя (может быть установлен МСК по умолчанию)
        const currentTimezone = await userService.getOrSetDefaultTimezone(userId);
        await this.sendDailyReminder(userId, reminderTime || '12:00', currentTimezone);
        this.dailyReminders.delete(userId);
        // Планируем следующее напоминание
        // Получаем актуальное время из челленджа
        const challenge = await challengeService.getActiveChallenge(userId);
        const actualReminderTime = challenge?.reminderTime || null;
        await this.scheduleDailyReminder(userId, actualReminderTime);
      } catch (error: any) {
        // Проверяем, не заблокировал ли пользователь бота
        const shouldCancel = handleTelegramError(error, userId);
        
        if (shouldCancel || error?.message === 'USER_BLOCKED_BOT') {
          logger.info(`User ${userId} blocked the bot, cancelling all reminders and checks`);
          this.cancelDailyReminder(userId);
          this.cancelMidnightCheck(userId);
          return;
        }
        
        logger.error(`Error in daily reminder for user ${userId}:`, error);
        this.dailyReminders.delete(userId);
        // Пытаемся запланировать следующее напоминание даже при ошибке
        try {
          const challenge = await challengeService.getActiveChallenge(userId);
          const actualReminderTime = challenge?.reminderTime || null;
          await this.scheduleDailyReminder(userId, actualReminderTime);
        } catch (retryError) {
          logger.error(`Error retrying daily reminder for user ${userId}:`, retryError);
        }
      }
    }, delay);

    this.dailyReminders.set(userId, {
      userId,
      timeoutId,
      scheduledTime,
    });

    // Сохраняем в Redis синхронно (с await)
    try {
      const userTimezone = await userService.getOrSetDefaultTimezone(userId);
      await this.saveDailyReminderToRedis(userId, reminderTime || '12:00', userTimezone, scheduledTime);
    } catch (error) {
      logger.error(`Error getting timezone for saving reminder to Redis for user ${userId}:`, error);
      // Используем МСК по умолчанию
      await this.saveDailyReminderToRedis(userId, reminderTime || '12:00', 3, scheduledTime);
    }
  }

  /**
   * Отправляет сцену провала челленджа пользователю
   */
  private async sendChallengeFailedScene(userId: number): Promise<void> {
    if (!this.botApi) {
      logger.error('Bot API is not initialized');
      return;
    }

    try {
      // Создаем минимальный контекст для вызова handleChallengeFailedScene
      const mockContext = {
        from: { id: userId },
        reply: async (text: string, options?: any) => {
          return this.botApi!.sendMessage(userId, text, {
            ...options,
            disable_notification: false,
          });
        },
        editMessageText: async (text: string, options?: any) => {
          // Для уведомлений отправляем новое сообщение
          return this.botApi!.sendMessage(userId, text, {
            ...options,
            disable_notification: false,
          });
        },
      } as any;

      await handleChallengeFailedScene(mockContext);
      logger.info(`Challenge failed scene sent to user ${userId}`);
    } catch (error) {
      const shouldCancel = handleTelegramError(error, userId);
      if (shouldCancel) {
        this.cancelDailyReminder(userId);
        this.cancelMidnightCheck(userId);
        return;
      }
      logger.error(`Error sending challenge failed scene to user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Отправляет ежедневное напоминание пользователю
   * @param userId - ID пользователя
   * @param reminderTime - Время напоминания (не используется напрямую, но нужно для сигнатуры)
   * @param timezone - Часовой пояс (не используется напрямую, но нужно для сигнатуры)
   */
  private async sendDailyReminder(userId: number, _reminderTime: string, _timezone: number): Promise<void> {
    if (!this.botApi) {
      logger.error('Bot API is not initialized');
      return;
    }

    try {
      // Проверяем, что челлендж все еще активен
      const challenge = await challengeService.getActiveChallenge(userId);
      if (!challenge) {
        logger.info(`Skipping reminder for user ${userId}: challenge inactive`);
        this.cancelDailyReminder(userId);
        return;
      }

      // Если челлендж провален, отправляем сцену провала вместо напоминания
      if (challenge.status === 'failed') {
        await this.sendChallengeFailedScene(userId);
        this.cancelDailyReminder(userId);
        this.cancelMidnightCheck(userId);
        return;
      }

      // Проверяем, что челлендж активен
      if (challenge.status !== 'active') {
        logger.info(`Skipping reminder for user ${userId}: challenge is not active`);
        this.cancelDailyReminder(userId);
        return;
      }

      // Проверяем, есть ли пропущенные дни
      if (challenge.daysWithoutWorkout > 0) {
        // Используем Redis lock для предотвращения дубликатов при параллельных вызовах
        const lockKey = getReminderLockKey(userId);
        const lockValue = Date.now().toString();
        const lockTTL = 300; // 5 минут блокировка
        
        // Пытаемся получить блокировку
        const lockAcquired = await redis.set(lockKey, lockValue, 'EX', lockTTL, 'NX');
        
        if (!lockAcquired) {
          logger.warn(`Reminder lock already exists for user ${userId}, skipping duplicate notification`);
          // Планируем следующее напоминание даже если не отправили (чтобы не пропустить следующее)
          const actualReminderTime = challenge.reminderTime || null;
          await this.scheduleDailyReminder(userId, actualReminderTime);
          return;
        }

        try {
          // Проверяем время последней отправки уведомления о пропущенном дне
          // Предотвращаем повторную отправку в течение 1 часа
          const lastSentKey = getLastMissedDayNotificationKey(userId);
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
              // Освобождаем блокировку
              await redis.del(lockKey);
              // Планируем следующее напоминание
              const actualReminderTime = challenge.reminderTime || null;
              await this.scheduleDailyReminder(userId, actualReminderTime);
              return;
            }
          }

          // Отправляем сообщение о пропущенной тренировке (всегда, даже если уведомления отключены)
          const missedWorkoutText = 
            'Вчера ты дал жиру отдохнуть. Поделишься своим отчётом? Отправь его в чат, я сохраню, и по завершению челленджа ты увидишь, где были сложности и как прогрессировал.';
          
          try {
            // Пытаемся отправить фото для пропущенного дня
            try {
              const imagePath = getMissedDayImagePath(challenge.daysWithoutWorkout);
              const photo = new InputFile(imagePath);
              await this.botApi.sendPhoto(userId, photo, {
                caption: missedWorkoutText,
              });
              logger.info(`Missed workout reminder with photo sent to user ${userId} (day ${challenge.daysWithoutWorkout})`);
            } catch (photoError) {
              // Если не удалось отправить фото, отправляем только текст
              logger.warn(`Failed to send missed day photo for user ${userId}, sending text only:`, photoError);
              await this.botApi.sendMessage(userId, missedWorkoutText);
              logger.info(`Missed workout reminder (text only) sent to user ${userId}`);
            }
            
            // Сохраняем время отправки (TTL 24 часа)
            await redis.set(lastSentKey, now.toString(), 'EX', 86400);
            logger.debug(`Saved last missed day notification time for user ${userId}`);
          } catch (error) {
            const shouldCancel = handleTelegramError(error, userId);
            if (shouldCancel) {
              this.cancelDailyReminder(userId);
              this.cancelMidnightCheck(userId);
              // Освобождаем блокировку при ошибке
              await redis.del(lockKey).catch((err) => {
                logger.error(`Error releasing lock for user ${userId}:`, err);
              });
              return;
            }
            throw error;
          } finally {
            // Освобождаем блокировку после отправки
            await redis.del(lockKey).catch((err) => {
              logger.error(`Error releasing lock for user ${userId}:`, err);
            });
          }
        } catch (error) {
          // Освобождаем блокировку при ошибке
          await redis.del(lockKey).catch((err) => {
            logger.error(`Error releasing lock for user ${userId}:`, err);
          });
          throw error;
        }
        
        // После отправки уведомления о пропущенном дне, планируем следующее
        // Получаем актуальное время из челленджа
        const actualReminderTime = challenge.reminderTime || null;
        await this.scheduleDailyReminder(userId, actualReminderTime);
        return;
      }
      
      // Если нет пропущенных дней, проверяем, включены ли уведомления
      if (!challenge.reminderStatus) {
        // Уведомления отключены и нет пропущенных дней - не отправляем мотивационное сообщение
        // Но планируем следующую проверку на завтра
        const actualReminderTime = challenge.reminderTime || null;
        await this.scheduleDailyReminder(userId, actualReminderTime);
        return;
      }
      
      // Уведомления включены и нет пропущенных дней - отправляем обычное мотивационное сообщение
      // Отправляем обычное мотивационное сообщение
      const reminderPhrase = getRandomReminderPhrase();
        try {
          await this.botApi.sendMessage(userId, reminderPhrase);
        } catch (error) {
          const shouldCancel = handleTelegramError(error, userId);
          if (shouldCancel) {
            this.cancelDailyReminder(userId);
            this.cancelMidnightCheck(userId);
            return;
          }
          throw error;
        }

        // Отправляем сцену статистики челленджа
        // Создаем минимальный контекст для вызова handleChallengeStatsScene
        const mockContext = {
          from: { id: userId },
          reply: async (text: string, options?: any) => {
            try {
              return await this.botApi!.sendMessage(userId, text, {
                ...options,
                disable_notification: true,
              });
            } catch (error) {
              const shouldCancel = handleTelegramError(error, userId);
              if (shouldCancel) {
                throw new Error('USER_BLOCKED_BOT');
              }
              throw error;
            }
          },
          editMessageText: async (text: string, options?: any) => {
            // Для напоминаний отправляем новое сообщение
            try {
              return await this.botApi!.sendMessage(userId, text, {
                ...options,
                disable_notification: true,
              });
            } catch (error) {
              const shouldCancel = handleTelegramError(error, userId);
              if (shouldCancel) {
                throw new Error('USER_BLOCKED_BOT');
              }
              throw error;
            }
          },
        } as any;

        try {
          await handleChallengeStatsScene(mockContext);
          logger.info(`Daily reminder sent to user ${userId}`);
        } catch (error: any) {
          const shouldCancel = handleTelegramError(error, userId);
          if (shouldCancel || error?.message === 'USER_BLOCKED_BOT') {
            this.cancelDailyReminder(userId);
            this.cancelMidnightCheck(userId);
            return;
          }
          throw error;
        }
        
        // Планируем следующее напоминание
        const actualReminderTime = challenge.reminderTime || null;
        await this.scheduleDailyReminder(userId, actualReminderTime);
    } catch (error) {
      const shouldCancel = handleTelegramError(error, userId);
      if (shouldCancel) {
        this.cancelDailyReminder(userId);
        this.cancelMidnightCheck(userId);
        return;
      }
      logger.error(`Error sending daily reminder to user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Получает время следующего понедельника в 12:00 МСК
   */
  getNextMonday12MSK(): Date {
    const now = new Date();
    // МСК = UTC+3
    const mskOffset = 3 * 60 * 60 * 1000; // 3 часа в миллисекундах
    
    // Получаем текущее время в МСК
    const mskTime = now.getTime() + mskOffset;
    const mskDate = new Date(mskTime);
    
    // Получаем день недели в МСК (0 = воскресенье, 1 = понедельник, ...)
    const dayOfWeek = mskDate.getUTCDay();
    const currentHour = mskDate.getUTCHours();
    const currentMinute = mskDate.getUTCMinutes();
    
    let daysUntilMonday: number;
    
    // Если сегодня понедельник
    if (dayOfWeek === 1) {
      // Если уже прошло 12:00, берем следующий понедельник (через 7 дней)
      if (currentHour > 12 || (currentHour === 12 && currentMinute > 0)) {
        daysUntilMonday = 7;
      } else {
        // Еще не 12:00, используем сегодня
        daysUntilMonday = 0;
      }
    } else {
      // Вычисляем количество дней до следующего понедельника
      // dayOfWeek: 0=воскр, 1=пн, 2=вт, 3=ср, 4=чт, 5=пт, 6=сб
      daysUntilMonday = (8 - dayOfWeek) % 7;
      if (daysUntilMonday === 0) {
        daysUntilMonday = 7; // Если сегодня воскресенье, берем следующий понедельник
      }
    }

    // Создаем дату следующего понедельника в 12:00 МСК
    const targetMSK = new Date(mskDate);
    targetMSK.setUTCDate(mskDate.getUTCDate() + daysUntilMonday);
    targetMSK.setUTCHours(12, 0, 0, 0);

    // Конвертируем обратно в UTC
    return new Date(targetMSK.getTime() - mskOffset);
  }

  /**
   * Получает время следующего 12:00 МСК (сегодня, если еще не прошло, иначе завтра)
   */
  private getNext12MSKTime(): Date {
    const now = new Date();
    // МСК = UTC+3
    const mskOffset = 3 * 60 * 60 * 1000;
    
    // Получаем текущее время в UTC (миллисекунды)
    const nowUtcMs = now.getTime();
    
    // Вычисляем текущее время в МСК (в миллисекундах для вычислений)
    const localNowMs = nowUtcMs + mskOffset;
    
    // Вычисляем начало текущего дня в МСК (00:00:00)
    const msPerDay = 24 * 60 * 60 * 1000;
    const localDayStartMs = Math.floor(localNowMs / msPerDay) * msPerDay;
    
    // Время 12:00 сегодня в МСК (в миллисекундах)
    const targetLocalMs = localDayStartMs + (12 * 60 * 60 * 1000);
    
    // Если 12:00 уже прошло сегодня, планируем на завтра
    const nextTargetLocalMs = targetLocalMs <= localNowMs 
      ? targetLocalMs + msPerDay 
      : targetLocalMs;
    
    // Конвертируем обратно в UTC: вычитаем смещение часового пояса
    const nextTargetUtcMs = nextTargetLocalMs - mskOffset;
    
    return new Date(nextTargetUtcMs);
  }

  /**
   * Получает время завтра в 12:00 МСК
   */
  getTomorrow12MSK(): Date {
    const now = new Date();
    // МСК = UTC+3
    const mskOffset = 3 * 60 * 60 * 1000;
    
    // Получаем текущее время в МСК
    const mskTime = now.getTime() + mskOffset;
    const mskDate = new Date(mskTime);

    // Завтра в 12:00 МСК
    const tomorrow = new Date(mskDate);
    tomorrow.setUTCDate(mskDate.getUTCDate() + 1);
    tomorrow.setUTCHours(12, 0, 0, 0);

    // Конвертируем обратно в UTC
    return new Date(tomorrow.getTime() - mskOffset);
  }

  /**
   * Планирует отправку сцены уведомления о старте челленджа завтра в 12:00 МСК
   */
  scheduleTomorrowDuration(userId: number): void {
    const scheduledTime = this.getTomorrow12MSK();
    
    this.scheduleMessage(userId, scheduledTime, async () => {
      if (!this.botApi) {
        logger.error('Bot API is not initialized');
        return;
      }

      try {
        // Создаем минимальный контекст для вызова handleChallengeStartNotificationScene
        const mockContext = {
          from: { id: userId },
          reply: async (text: string, options?: any) => {
            try {
              return await this.botApi!.sendMessage(userId, text, {
                ...options,
                disable_notification: true,
              });
            } catch (error) {
              const shouldCancel = handleTelegramError(error, userId);
              if (shouldCancel) {
                throw new Error('USER_BLOCKED_BOT');
              }
              throw error;
            }
          },
          editMessageText: async (text: string, options?: any) => {
            // Для уведомлений отправляем новое сообщение
            try {
              return await this.botApi!.sendMessage(userId, text, {
                ...options,
                disable_notification: true,
              });
            } catch (error) {
              const shouldCancel = handleTelegramError(error, userId);
              if (shouldCancel) {
                throw new Error('USER_BLOCKED_BOT');
              }
              throw error;
            }
          },
        } as any;

        await handleChallengeStartNotificationScene(mockContext);
      } catch (error: any) {
        const shouldCancel = handleTelegramError(error, userId);
        if (shouldCancel || error?.message === 'USER_BLOCKED_BOT') {
          this.cancelTask(userId);
          return;
        }
        logger.error(`Error sending scheduled challenge start notification to user ${userId}:`, error);
      }
    });

    // Сохраняем в Redis
    this.saveTaskToRedis(userId, scheduledTime, 'tomorrow');
  }

  /**
   * Планирует отправку сцены уведомления о старте челленджа в следующий понедельник в 12:00 МСК
   */
  scheduleMondayDuration(userId: number): void {
    const scheduledTime = this.getNextMonday12MSK();
    
    this.scheduleMessage(userId, scheduledTime, async () => {
      if (!this.botApi) {
        logger.error('Bot API is not initialized');
        return;
      }

      try {
        // Создаем минимальный контекст для вызова handleChallengeStartNotificationScene
        const mockContext = {
          from: { id: userId },
          reply: async (text: string, options?: any) => {
            try {
              return await this.botApi!.sendMessage(userId, text, {
                ...options,
                disable_notification: true,
              });
            } catch (error) {
              const shouldCancel = handleTelegramError(error, userId);
              if (shouldCancel) {
                throw new Error('USER_BLOCKED_BOT');
              }
              throw error;
            }
          },
          editMessageText: async (text: string, options?: any) => {
            // Для уведомлений отправляем новое сообщение
            try {
              return await this.botApi!.sendMessage(userId, text, {
                ...options,
                disable_notification: true,
              });
            } catch (error) {
              const shouldCancel = handleTelegramError(error, userId);
              if (shouldCancel) {
                throw new Error('USER_BLOCKED_BOT');
              }
              throw error;
            }
          },
        } as any;

        await handleChallengeStartNotificationScene(mockContext);
      } catch (error: any) {
        const shouldCancel = handleTelegramError(error, userId);
        if (shouldCancel || error?.message === 'USER_BLOCKED_BOT') {
          this.cancelTask(userId);
          return;
        }
        logger.error(`Error sending scheduled challenge start notification to user ${userId}:`, error);
      }
    });

    // Сохраняем в Redis
    this.saveTaskToRedis(userId, scheduledTime, 'monday');
  }
}

export const schedulerService = new SchedulerService();
