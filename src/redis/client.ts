import Redis from 'ioredis';
import { env } from '../utils/env.js';
import logger from '../utils/logger.js';

const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  connectTimeout: 10000, // Таймаут подключения 10 секунд
  lazyConnect: false, // Подключаться сразу при создании
  maxRetriesPerRequest: 3, // Максимум 3 попытки на запрос
  enableReadyCheck: true, // Проверять готовность Redis
  enableOfflineQueue: true, // Очередь для операций при недоступности
  keepAlive: 30000, // Keep-alive для соединения
});

redis.on('connect', () => {
  logger.info('Redis client connected');
});

redis.on('ready', () => {
  logger.info('Redis client ready');
});

redis.on('error', (error) => {
  logger.error('Redis client error:', error);
  // Не бросаем ошибку, чтобы приложение не упало при проблемах с Redis
  // Сервисы должны обрабатывать ошибки Redis отдельно
});

redis.on('close', () => {
  logger.warn('Redis connection closed');
});

redis.on('reconnecting', (delay: number) => {
  logger.info(`Redis reconnecting in ${delay}ms`);
});

/**
 * Gracefully закрывает соединение с Redis
 */
export async function closeRedis(): Promise<void> {
  try {
    await redis.quit();
    logger.info('Redis connection closed gracefully');
  } catch (error) {
    logger.error('Error closing Redis connection:', error);
    // Принудительно закрываем соединение в случае ошибки
    redis.disconnect();
  }
}

export default redis;

