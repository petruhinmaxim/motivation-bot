import * as dotenv from 'dotenv';
import { bot } from './bot/bot.js';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './database/client.js';
import logger from './utils/logger.js';
import { schedulerService } from './services/scheduler.service.js';

dotenv.config();

async function start() {
  try {
    // Запускаем миграции
    logger.info('Running database migrations...');
    await migrate(db, { migrationsFolder: './src/database/migrations' });
    logger.info('✅ Database migrations completed');

    // Запускаем бота
    logger.info('Starting bot...');
    await bot.start();
    logger.info('✅ Bot is running!');

    // Восстанавливаем запланированные задачи из Redis
    logger.info('Restoring scheduled tasks...');
    await schedulerService.restoreTasks();
    logger.info('✅ Scheduled tasks restored');
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Обработка завершения
process.once('SIGINT', () => {
  logger.info('Shutting down...');
  bot.stop();
  process.exit(0);
});

process.once('SIGTERM', () => {
  logger.info('Shutting down...');
  bot.stop();
  process.exit(0);
});

start();

