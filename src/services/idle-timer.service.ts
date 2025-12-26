import type { Api } from 'grammy';
import logger from '../utils/logger.js';
import redis from '../redis/client.js';
import { getIdleTimerKey } from '../redis/keys.js';
import { handleBeginScene, handleTimezoneScene, handleReminderTimeScene } from '../scenes/index.js';
import { handleTelegramError } from '../utils/telegram-error-handler.js';
import { MESSAGES } from '../scenes/messages.js';
import type { Scene } from '../state/types.js';

// Сцены процесса регистрации
const REGISTRATION_SCENES: Scene[] = ['begin', 'timezone', 'reminder_time'];

interface IdleTimer {
  userId: number;
  timeoutId: NodeJS.Timeout;
  scheduledTime: Date;
  scene: Scene; // Текущая сцена регистрации
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
   * Проверяет, является ли сцена частью процесса регистрации
   */
  isRegistrationScene(scene: Scene): boolean {
    return REGISTRATION_SCENES.includes(scene);
  }

  /**
   * Запускает или перезапускает таймер бездействия для пользователя на сцене регистрации
   * @param userId - ID пользователя
   * @param scene - Текущая сцена регистрации
   */
  startIdleTimer(userId: number, scene: Scene): void {
    if (!this.isRegistrationScene(scene)) {
      logger.warn(`Attempted to start idle timer for non-registration scene: ${scene}`);
      return;
    }

    // Отменяем предыдущий таймер, если есть
    this.cancelIdleTimer(userId);

    const scheduledTime = new Date(Date.now() + this.IDLE_TIMEOUT_MS);

    logger.info(
      `Starting idle timer for user ${userId} on ${scene} scene (will trigger in ${this.IDLE_TIMEOUT_MS / 1000}s)`
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
      scene,
    });

    // Сохраняем в Redis
    this.saveTimerToRedis(userId, scheduledTime, scene);
  }

  /**
   * Обновляет сцену в таймере без перезапуска таймера
   * Используется при переходах между сценами регистрации
   * @param userId - ID пользователя
   * @param scene - Новая сцена регистрации
   */
  updateScene(userId: number, scene: Scene): void {
    if (!this.isRegistrationScene(scene)) {
      logger.warn(`Attempted to update idle timer with non-registration scene: ${scene}`);
      return;
    }

    const timer = this.timers.get(userId);
    if (timer) {
      timer.scene = scene;
      logger.info(`Updated idle timer scene for user ${userId} to ${scene}`);
      // Обновляем в Redis
      this.saveTimerToRedis(userId, timer.scheduledTime, scene);
    }
  }

  /**
   * Проверяет, активен ли таймер для пользователя
   */
  hasActiveTimer(userId: number): boolean {
    return this.timers.has(userId);
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
   * Отправляет сообщение "Эй жир победил!" и повторно показывает текущую сцену регистрации
   */
  private async handleIdleTimeout(userId: number): Promise<void> {
    if (!this.botApi) {
      logger.error('Bot API is not initialized');
      return;
    }

    const timer = this.timers.get(userId);
    if (!timer) {
      logger.warn(`No active timer found for user ${userId} during timeout handling`);
      return;
    }

    const scene = timer.scene;

    try {
      // Отправляем сообщение "Эй жир победил!"
      await this.botApi.sendMessage(userId, MESSAGES.IDLE.TIMEOUT_MESSAGE);

      // Создаем mock context для показа сцены
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

      // Показываем соответствующую сцену
      if (scene === 'begin') {
        await handleBeginScene(mockContext);
      } else if (scene === 'timezone') {
        await handleTimezoneScene(mockContext);
      } else if (scene === 'reminder_time') {
        await handleReminderTimeScene(mockContext);
      }

      logger.info(`Idle timeout handled for user ${userId}: sent message and ${scene} scene`);
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
  private async saveTimerToRedis(userId: number, scheduledTime: Date, scene: Scene): Promise<void> {
    try {
      const timerData = {
        userId,
        scheduledTime: scheduledTime.toISOString(),
        scene,
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

