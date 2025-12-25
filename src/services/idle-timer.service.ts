import type { Api } from 'grammy';
import logger from '../utils/logger.js';
import redis from '../redis/client.js';
import { getIdleTimerKey } from '../redis/keys.js';
import { handleBeginScene } from '../scenes/begin.scene.js';
import { handleTelegramError } from '../utils/telegram-error-handler.js';
import { MESSAGES } from '../scenes/messages.js';

interface IdleTimer {
  userId: number;
  timeoutId: NodeJS.Timeout;
  scheduledTime: Date;
}

class IdleTimerService {
  private timers = new Map<number, IdleTimer>();
  private botApi: Api | null = null;
  private readonly IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 минуты

  /**
   * Устанавливает API бота (вызывается после инициализации бота)
   */
  setBotApi(api: Api): void {
    this.botApi = api;
  }

  /**
   * Запускает таймер бездействия для пользователя на сцене begin
   * @param userId - ID пользователя
   */
  startIdleTimer(userId: number): void {
    // Отменяем предыдущий таймер, если есть
    this.cancelIdleTimer(userId);

    const scheduledTime = new Date(Date.now() + this.IDLE_TIMEOUT_MS);

    logger.info(
      `Starting idle timer for user ${userId} on begin scene (will trigger in ${this.IDLE_TIMEOUT_MS / 1000}s)`
    );

    const timeoutId = setTimeout(async () => {
      try {
        await this.handleIdleTimeout(userId);
        this.timers.delete(userId);
        await this.removeTimerFromRedis(userId);
        logger.info(`Idle timer completed for user ${userId}`);
      } catch (error) {
        logger.error(`Error in idle timer for user ${userId}:`, error);
        this.timers.delete(userId);
        await this.removeTimerFromRedis(userId);
      }
    }, this.IDLE_TIMEOUT_MS);

    this.timers.set(userId, {
      userId,
      timeoutId,
      scheduledTime,
    });

    // Сохраняем в Redis
    this.saveTimerToRedis(userId, scheduledTime);
  }

  /**
   * Отменяет таймер бездействия для пользователя
   * @param userId - ID пользователя
   */
  cancelIdleTimer(userId: number): void {
    const timer = this.timers.get(userId);
    if (timer) {
      clearTimeout(timer.timeoutId);
      this.timers.delete(userId);
      this.removeTimerFromRedis(userId);
      logger.info(`Cancelled idle timer for user ${userId}`);
    }
  }

  /**
   * Обрабатывает срабатывание таймера бездействия
   * Отправляет сообщение "Эй жир победил!" и повторно показывает сцену begin
   */
  private async handleIdleTimeout(userId: number): Promise<void> {
    if (!this.botApi) {
      logger.error('Bot API is not initialized');
      return;
    }

    try {
      // Отправляем сообщение "Эй жир победил!"
      await this.botApi.sendMessage(userId, MESSAGES.IDLE.TIMEOUT_MESSAGE);

      // Повторно показываем сцену begin
      const mockContext = {
        from: { id: userId },
        reply: async (text: string, options?: any) => {
          try {
            return await this.botApi!.sendMessage(userId, text, {
              ...options,
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
          // Для повторного показа отправляем новое сообщение
          try {
            return await this.botApi!.sendMessage(userId, text, {
              ...options,
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

      await handleBeginScene(mockContext);
      logger.info(`Idle timeout handled for user ${userId}: sent message and begin scene`);
    } catch (error: any) {
      const shouldCancel = handleTelegramError(error, userId);
      if (shouldCancel || error?.message === 'USER_BLOCKED_BOT') {
        this.cancelIdleTimer(userId);
        return;
      }
      logger.error(`Error handling idle timeout for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Сохраняет таймер в Redis
   */
  private async saveTimerToRedis(userId: number, scheduledTime: Date): Promise<void> {
    try {
      const timerData = {
        userId,
        scheduledTime: scheduledTime.toISOString(),
      };

      const ttlSeconds = Math.ceil((scheduledTime.getTime() - Date.now()) / 1000) + 60; // TTL = время до выполнения + 1 минута
      await redis.set(
        getIdleTimerKey(userId),
        JSON.stringify(timerData),
        'EX',
        ttlSeconds > 0 ? ttlSeconds : 60
      );
    } catch (error) {
      logger.error(`Error saving idle timer to Redis for user ${userId}:`, error);
    }
  }

  /**
   * Удаляет таймер из Redis
   */
  private async removeTimerFromRedis(userId: number): Promise<void> {
    try {
      await redis.del(getIdleTimerKey(userId));
    } catch (error) {
      logger.error(`Error removing idle timer from Redis for user ${userId}:`, error);
    }
  }

  /**
   * Восстанавливает таймеры бездействия из Redis при старте
   */
  async restoreTimers(): Promise<void> {
    // Для таймеров бездействия восстановление не требуется,
    // так как они должны запускаться только при активном взаимодействии пользователя
    // и не должны переживать перезапуск сервера
    logger.info('Idle timers do not need restoration (user-initiated only)');
  }
}

export const idleTimerService = new IdleTimerService();

