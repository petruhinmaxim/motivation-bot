import type { Api } from 'grammy';
import logger from '../utils/logger.js';
import redis from '../redis/client.js';
import { 
  getScheduledTaskDataKey, 
  getScheduledTasksKey,
  getDailyRemindersKey,
  getDailyReminderDataKey,
} from '../redis/keys.js';
import { getRandomReminderPhrase } from '../utils/motivational-phrases.js';
import { handleChallengeStatsScene } from '../scenes/challenge-stats.scene.js';
import { handleChallengeStartNotificationScene } from '../scenes/challenge-start-notification.scene.js';
import { challengeService } from './challenge.service.js';

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

class SchedulerService {
  private tasks = new Map<number, ScheduledTask>();
  private dailyReminders = new Map<number, ScheduledTask>();
  private botApi: Api | null = null;

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
    } catch (error) {
      logger.error('Error restoring tasks from Redis:', error);
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

      // Отправляем мотивационное сообщение
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
