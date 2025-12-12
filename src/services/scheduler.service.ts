import type { Api } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { BUTTONS, MESSAGES } from '../scenes/messages.js';
import logger from '../utils/logger.js';

interface ScheduledTask {
  userId: number;
  timeoutId: NodeJS.Timeout;
  scheduledTime: Date;
}

class SchedulerService {
  private tasks = new Map<number, ScheduledTask>();
  private botApi: Api | null = null;

  /**
   * Устанавливает API бота (вызывается после инициализации бота)
   */
  setBotApi(api: Api): void {
    this.botApi = api;
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
        logger.info(`Scheduled task completed for user ${userId}`);
      } catch (error) {
        logger.error(`Error in scheduled task for user ${userId}:`, error);
        this.tasks.delete(userId);
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
   * Планирует отправку сцены выбора продолжительности завтра в 12:00 МСК
   */
  scheduleTomorrowDuration(userId: number): void {
    const scheduledTime = this.getTomorrow12MSK();
    
    this.scheduleMessage(userId, scheduledTime, async () => {
      if (!this.botApi) {
        logger.error('Bot API is not initialized');
        return;
      }

      try {
        const durationKeyboard = new InlineKeyboard()
          .text(BUTTONS.DURATION_30, 'duration_30')
          .text(BUTTONS.DURATION_60, 'duration_60')
          .text(BUTTONS.DURATION_90, 'duration_90')
          .row()
          .text(BUTTONS.BACK, 'back');

        await this.botApi.sendMessage(userId, MESSAGES.DURATION.TEXT, {
          reply_markup: durationKeyboard,
        });
      } catch (error) {
        logger.error(`Error sending scheduled duration scene to user ${userId}:`, error);
      }
    });
  }

  /**
   * Планирует отправку сцены выбора продолжительности в следующий понедельник в 12:00 МСК
   */
  scheduleMondayDuration(userId: number): void {
    const scheduledTime = this.getNextMonday12MSK();
    
    this.scheduleMessage(userId, scheduledTime, async () => {
      if (!this.botApi) {
        logger.error('Bot API is not initialized');
        return;
      }

      try {
        const durationKeyboard = new InlineKeyboard()
          .text(BUTTONS.DURATION_30, 'duration_30')
          .text(BUTTONS.DURATION_60, 'duration_60')
          .text(BUTTONS.DURATION_90, 'duration_90')
          .row()
          .text(BUTTONS.BACK, 'back');

        await this.botApi.sendMessage(userId, MESSAGES.DURATION.TEXT, {
          reply_markup: durationKeyboard,
        });
      } catch (error) {
        logger.error(`Error sending scheduled duration scene to user ${userId}:`, error);
      }
    });
  }
}

export const schedulerService = new SchedulerService();
