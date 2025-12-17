import type { Api } from 'grammy';
import logger from '../utils/logger.js';
import redis from '../redis/client.js';
import { 
  getScheduledTaskDataKey, 
  getScheduledTasksKey,
  getDailyRemindersKey,
  getDailyReminderDataKey,
  getMidnightChecksKey,
  getMidnightCheckDataKey,
} from '../redis/keys.js';
import { getRandomReminderPhrase } from '../utils/motivational-phrases.js';
import { handleChallengeStatsScene } from '../scenes/challenge-stats.scene.js';
import { handleChallengeStartNotificationScene } from '../scenes/challenge-start-notification.scene.js';
import { challengeService } from './challenge.service.js';
import { userService } from './user.service.js';

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

  /**
   * Устанавливает API бота (вызывается после инициализации бота)
   */
  setBotApi(api: Api): void {
    this.botApi = api;
  }

  /**
   * Восстанавливает все запланированные задачи из Redis при старте
   */
  async restoreTasks(): Promise<void> {
    // Предотвращаем параллельные вызовы
    if (this.isRestoring) {
      logger.warn('Restore tasks already in progress, skipping');
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
      
      // Восстанавливаем полночные проверки
      await this.restoreMidnightChecks();
      
      // Инициализируем полночные проверки для всех активных челленджей, которые еще не запланированы
      await this.initializeMidnightChecksForActiveChallenges();
    } catch (error) {
      logger.error('Error restoring tasks from Redis:', error);
    } finally {
      this.isRestoring = false;
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
          // Проверяем, не запланировано ли уже напоминание для этого пользователя
          if (this.dailyReminders.has(reminder.userId)) {
            logger.warn(`Daily reminder already scheduled for user ${reminder.userId}, skipping restore`);
            continue;
          }

          // Проверяем, что челлендж все еще активен и напоминания включены
          const challenge = await challengeService.getActiveChallenge(reminder.userId);
          if (!challenge || !challenge.reminderStatus || !challenge.reminderTime) {
            logger.warn(`Skipping reminder for user ${reminder.userId}: challenge inactive or reminders disabled`);
            await this.removeDailyReminderFromRedis(reminder.userId);
            continue;
          }

          // Планируем следующее напоминание
          await this.scheduleDailyReminder(reminder.userId, challenge.reminderTime, reminder.timezone);
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
   * Получает время следующей полночи в часовом поясе пользователя
   * @param timezone - Смещение от UTC в часах
   * @returns Дата следующей полночи в UTC
   */
  private getNextMidnightTime(timezone: number): Date {
    const now = new Date();
    
    // Вычисляем текущее время в часовом поясе пользователя
    const userTimezoneOffset = timezone * 60 * 60 * 1000; // в миллисекундах
    const userTime = new Date(now.getTime() + userTimezoneOffset);
    
    // Создаем дату с полночью в часовом поясе пользователя
    const midnightDate = new Date(userTime);
    midnightDate.setUTCHours(0, 0, 0, 0);
    
    // Если полночь уже прошла сегодня, планируем на завтра
    if (midnightDate <= userTime) {
      midnightDate.setUTCDate(midnightDate.getUTCDate() + 1);
    }
    
    // Конвертируем обратно в UTC
    return new Date(midnightDate.getTime() - userTimezoneOffset);
  }

  /**
   * Планирует полночную проверку для пользователя
   * @param userId - ID пользователя
   * @param timezone - Смещение от UTC в часах
   */
  async scheduleMidnightCheck(userId: number, timezone: number): Promise<void> {
    // Отменяем предыдущую проверку, если есть
    this.cancelMidnightCheck(userId);

    const scheduledTime = this.getNextMidnightTime(timezone);
    const now = new Date();
    const delay = scheduledTime.getTime() - now.getTime();

    if (delay <= 0) {
      logger.warn(`Scheduled midnight time is in the past for user ${userId}, scheduling for tomorrow`);
      // Если время уже прошло, планируем на завтра
      const tomorrowTime = this.getNextMidnightTime(timezone);
      const tomorrowDelay = tomorrowTime.getTime() - now.getTime();
      this.scheduleMidnightCheckInternal(userId, timezone, tomorrowTime, tomorrowDelay);
      return;
    }

    this.scheduleMidnightCheckInternal(userId, timezone, scheduledTime, delay);
  }

  /**
   * Внутренний метод для планирования полночной проверки
   */
  private scheduleMidnightCheckInternal(
    userId: number,
    timezone: number,
    scheduledTime: Date,
    delay: number
  ): void {
    logger.info(
      `Scheduling midnight check for user ${userId} at ${scheduledTime.toISOString()} (in ${Math.round(delay / 1000)}s)`
    );

    const timeoutId = setTimeout(async () => {
      try {
        await this.performMidnightCheck(userId, timezone);
        this.midnightChecks.delete(userId);
        // Планируем следующую проверку
        await this.scheduleMidnightCheck(userId, timezone);
      } catch (error) {
        logger.error(`Error in midnight check for user ${userId}:`, error);
        this.midnightChecks.delete(userId);
        // Пытаемся запланировать следующую проверку даже при ошибке
        try {
          await this.scheduleMidnightCheck(userId, timezone);
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
   * Выполняет полночную проверку для пользователя
   */
  private async performMidnightCheck(userId: number, timezone: number): Promise<void> {
    try {
      // Проверяем и увеличиваем счетчик дней без тренировки
      await challengeService.checkAndIncrementMissedDays(userId, timezone);
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

      // Добавляем в список всех полночных проверок
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
   * Восстанавливает полночные проверки из Redis
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

          // Проверяем, что пользователь имеет часовой пояс
          const user = await userService.getUser(check.userId);
          if (!user || user.timezone === null || user.timezone === undefined) {
            logger.warn(`Skipping midnight check for user ${check.userId}: timezone not set`);
            await this.removeMidnightCheckFromRedis(check.userId);
            continue;
          }

          // Планируем следующую проверку
          await this.scheduleMidnightCheck(check.userId, check.timezone);
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
   * Удаляет полночную проверку из Redis
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
   * Отменяет полночную проверку для пользователя
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

        // Получаем пользователя для получения часового пояса
        const user = await userService.getUser(challenge.userId);
        if (!user || user.timezone === null || user.timezone === undefined) {
          logger.warn(`Skipping midnight check initialization for user ${challenge.userId}: timezone not set`);
          continue;
        }

        // Планируем полночную проверку
        await this.scheduleMidnightCheck(challenge.userId, user.timezone);
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
   * Вычисляет следующее время напоминания с учетом часового пояса пользователя
   * @param reminderTime - время в формате HH:MM
   * @param timezone - смещение от UTC в часах
   * @returns Дата следующего напоминания в UTC
   */
  private getNextReminderTime(reminderTime: string, timezone: number): Date {
    const now = new Date();
    const [hours, minutes] = reminderTime.split(':').map(Number);
    
    // Вычисляем текущее время в часовом поясе пользователя
    const userTimezoneOffset = timezone * 60 * 60 * 1000; // в миллисекундах
    const userTime = new Date(now.getTime() + userTimezoneOffset);
    
    // Создаем дату с временем напоминания в часовом поясе пользователя
    const reminderDate = new Date(userTime);
    reminderDate.setUTCHours(hours, minutes, 0, 0);
    
    // Если время напоминания уже прошло сегодня, планируем на завтра
    if (reminderDate <= userTime) {
      reminderDate.setUTCDate(reminderDate.getUTCDate() + 1);
    }
    
    // Конвертируем обратно в UTC
    return new Date(reminderDate.getTime() - userTimezoneOffset);
  }

  /**
   * Планирует ежедневное напоминание для пользователя
   * @param userId - ID пользователя
   * @param reminderTime - время в формате HH:MM
   * @param timezone - смещение от UTC в часах
   */
  async scheduleDailyReminder(userId: number, reminderTime: string, timezone: number): Promise<void> {
    // Отменяем предыдущее напоминание, если есть
    this.cancelDailyReminder(userId);

    const scheduledTime = this.getNextReminderTime(reminderTime, timezone);
    const now = new Date();
    const delay = scheduledTime.getTime() - now.getTime();

    if (delay <= 0) {
      logger.warn(`Scheduled reminder time is in the past for user ${userId}, scheduling for tomorrow`);
      // Если время уже прошло, планируем на завтра
      const tomorrowTime = this.getNextReminderTime(reminderTime, timezone);
      const tomorrowDelay = tomorrowTime.getTime() - now.getTime();
      this.scheduleDailyReminderInternal(userId, reminderTime, timezone, tomorrowTime, tomorrowDelay);
      return;
    }

    this.scheduleDailyReminderInternal(userId, reminderTime, timezone, scheduledTime, delay);
  }

  /**
   * Внутренний метод для планирования ежедневного напоминания
   */
  private scheduleDailyReminderInternal(
    userId: number,
    reminderTime: string,
    timezone: number,
    scheduledTime: Date,
    delay: number
  ): void {
    logger.info(
      `Scheduling daily reminder for user ${userId} at ${scheduledTime.toISOString()} (in ${Math.round(delay / 1000)}s)`
    );

    const timeoutId = setTimeout(async () => {
      try {
        await this.sendDailyReminder(userId, reminderTime, timezone);
        this.dailyReminders.delete(userId);
        // Планируем следующее напоминание
        await this.scheduleDailyReminder(userId, reminderTime, timezone);
      } catch (error) {
        logger.error(`Error in daily reminder for user ${userId}:`, error);
        this.dailyReminders.delete(userId);
        // Пытаемся запланировать следующее напоминание даже при ошибке
        try {
          await this.scheduleDailyReminder(userId, reminderTime, timezone);
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

    // Сохраняем в Redis
    this.saveDailyReminderToRedis(userId, reminderTime, timezone, scheduledTime);
  }

  /**
   * Отправляет ежедневное напоминание пользователю
   */
  private async sendDailyReminder(userId: number, reminderTime: string, timezone: number): Promise<void> {
    if (!this.botApi) {
      logger.error('Bot API is not initialized');
      return;
    }

    try {
      // Проверяем, что челлендж все еще активен
      const challenge = await challengeService.getActiveChallenge(userId);
      if (!challenge || !challenge.reminderStatus || challenge.status !== 'active') {
        logger.info(`Skipping reminder for user ${userId}: challenge inactive or reminders disabled`);
        this.cancelDailyReminder(userId);
        return;
      }

      // Проверяем, есть ли пропущенные дни
      if (challenge.daysWithoutWorkout > 0) {
        // Отправляем сообщение о пропущенной тренировке
        const missedWorkoutText = 
          'Вчера ты дал жиру отдохнуть. Поделишься своим отчётом? Отправь его в чат, я сохраню, и по завершению челленджа ты увидишь, где были сложности и как прогрессировал.';
        
        await this.botApi.sendMessage(userId, missedWorkoutText);
        logger.info(`Missed workout reminder sent to user ${userId}`);
      } else {
        // Отправляем обычное мотивационное сообщение
        const reminderPhrase = getRandomReminderPhrase();
        await this.botApi.sendMessage(userId, reminderPhrase);

        // Отправляем сцену статистики челленджа
        // Создаем минимальный контекст для вызова handleChallengeStatsScene
        const mockContext = {
          from: { id: userId },
          reply: async (text: string, options?: any) => {
            return this.botApi!.sendMessage(userId, text, {
              ...options,
              disable_notification: true,
            });
          },
          editMessageText: async (text: string, options?: any) => {
            // Для напоминаний отправляем новое сообщение
            return this.botApi!.sendMessage(userId, text, {
              ...options,
              disable_notification: true,
            });
          },
        } as any;

        await handleChallengeStatsScene(mockContext);

        logger.info(`Daily reminder sent to user ${userId}`);
      }
    } catch (error) {
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
            return this.botApi!.sendMessage(userId, text, {
              ...options,
              disable_notification: true,
            });
          },
          editMessageText: async (text: string, options?: any) => {
            // Для уведомлений отправляем новое сообщение
            return this.botApi!.sendMessage(userId, text, {
              ...options,
              disable_notification: true,
            });
          },
        } as any;

        await handleChallengeStartNotificationScene(mockContext);
      } catch (error) {
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
            return this.botApi!.sendMessage(userId, text, {
              ...options,
              disable_notification: true,
            });
          },
          editMessageText: async (text: string, options?: any) => {
            // Для уведомлений отправляем новое сообщение
            return this.botApi!.sendMessage(userId, text, {
              ...options,
              disable_notification: true,
            });
          },
        } as any;

        await handleChallengeStartNotificationScene(mockContext);
      } catch (error) {
        logger.error(`Error sending scheduled challenge start notification to user ${userId}:`, error);
      }
    });

    // Сохраняем в Redis
    this.saveTaskToRedis(userId, scheduledTime, 'monday');
  }
}

export const schedulerService = new SchedulerService();
