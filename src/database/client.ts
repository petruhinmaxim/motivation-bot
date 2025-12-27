import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../utils/env.js';
import * as schema from './schema.js';
import logger from '../utils/logger.js';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20, // Максимальное количество клиентов в пуле
  min: 2, // Минимальное количество клиентов в пуле
  idleTimeoutMillis: 30000, // Закрывать неиспользуемые соединения после 30 секунд
  connectionTimeoutMillis: 10000, // Таймаут подключения 10 секунд
});

// Обработка ошибок пула
pool.on('error', (err) => {
  logger.error('Unexpected database pool error:', err);
});

pool.on('connect', () => {
  logger.debug('New database connection established');
});

pool.on('remove', () => {
  logger.debug('Database connection removed from pool');
});

export const db = drizzle(pool, { schema });

/**
 * Gracefully закрывает все соединения в пуле
 */
export async function closeDatabase(): Promise<void> {
  try {
    await pool.end();
    logger.info('Database connections closed');
  } catch (error) {
    logger.error('Error closing database pool:', error);
    throw error;
  }
}

logger.info('Database client initialized');

