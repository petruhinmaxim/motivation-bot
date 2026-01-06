import type { Api } from 'grammy';
import logger from '../utils/logger.js';
import redis from '../redis/client.js';
import { handleTelegramError } from '../utils/telegram-error-handler.js';
import { 
  getScheduledTaskDataKey, 
  getScheduledTasksKey,
} from '../redis/keys.js';

interface ScheduledTask {
  userId: number;
  timeoutId: NodeJS.Timeout;
  scheduledTime: Date;
}

interface SavedTask {
  userId: number;
  scheduledTime: string; // ISO string
  type: 'tomorrow' | 'monday';
}

class SchedulerService {
  private tasks = new Map<number, ScheduledTask>();
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
        // Notification mechanics removed - scene kept for future implementation
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
        // Notification mechanics removed - scene kept for future implementation
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
