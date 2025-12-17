import { GrammyError, HttpError } from 'grammy';
import logger from './logger.js';

/**
 * Обрабатывает ошибки Telegram API
 * @param error - Ошибка от Telegram API
 * @param userId - ID пользователя (опционально)
 * @returns true, если ошибка критическая и нужно отменить задачи для пользователя
 */
export function handleTelegramError(error: unknown, userId?: number): boolean {
  // Если это GrammyError (ошибка Telegram API)
  if (error instanceof GrammyError) {
    const errorCode = error.error_code;
    const description = error.description || '';

    // 403 Forbidden - пользователь заблокировал бота
    if (errorCode === 403) {
      logger.warn(`User ${userId || 'unknown'} blocked the bot (403 Forbidden)`);
      return true; // Нужно отменить задачи
    }

    // 429 Too Many Requests - rate limit
    if (errorCode === 429) {
      const retryAfter = error.parameters?.retry_after || 60;
      logger.warn(`Rate limit hit for user ${userId || 'unknown'}, retry after ${retryAfter}s`);
      // Не критично, можно повторить позже
      return false;
    }

    // 400 Bad Request - обычно некорректные данные
    if (errorCode === 400) {
      logger.warn(`Bad request for user ${userId || 'unknown'}: ${description}`);
      return false;
    }

    // Другие ошибки
    logger.error(`Telegram API error ${errorCode} for user ${userId || 'unknown'}: ${description}`);
    return false;
  }

  // Если это HttpError (сетевая ошибка)
  if (error instanceof HttpError) {
    logger.error(`HTTP error for user ${userId || 'unknown'}:`, error);
    return false;
  }

  // Другая ошибка
  logger.error(`Unknown error for user ${userId || 'unknown'}:`, error);
  return false;
}

/**
 * Обертка для безопасной отправки сообщений через Telegram API
 * @param sendFn - Функция отправки сообщения
 * @param userId - ID пользователя
 * @returns Результат отправки или null при ошибке
 */
export async function safeSendMessage<T>(
  sendFn: () => Promise<T>,
  userId: number
): Promise<T | null> {
  try {
    return await sendFn();
  } catch (error) {
    const shouldCancel = handleTelegramError(error, userId);
    if (shouldCancel) {
      // Возвращаем специальный маркер, что нужно отменить задачи
      throw new Error('USER_BLOCKED_BOT');
    }
    // Для других ошибок просто логируем и возвращаем null
    return null;
  }
}
