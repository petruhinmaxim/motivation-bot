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
});

redis.on('connect', () => {
  logger.info('Redis client connected');
});

redis.on('error', (error) => {
  logger.error('Redis client error:', error);
});

export default redis;

