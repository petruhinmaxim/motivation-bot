import * as dotenv from 'dotenv';
import { bot } from './bot/bot.js';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, closeDatabase } from './database/client.js';
import logger from './utils/logger.js';
import { schedulerService } from './services/scheduler.service.js';
import { closeRedis } from './redis/client.js';

dotenv.config();

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress, forcing exit...');
    process.exit(1);
  }

  isShuttingDown = true;
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  const shutdownTimeout = setTimeout(() => {
    logger.error('Shutdown timeout exceeded, forcing exit...');
    process.exit(1);
  }, 30000); // 30 секунд на graceful shutdown

  try {
    // Останавливаем бота
    logger.info('Stopping bot...');
    await bot.stop();
    logger.info('Bot stopped');

    // Останавливаем периодическую проверку напоминаний
    schedulerService.stopHealthCheck();

    // Закрываем соединения с БД и Redis
    logger.info('Closing database connections...');
    await Promise.all([
      closeDatabase(),
      closeRedis(),
    ]);
    logger.info('All connections closed');

    clearTimeout(shutdownTimeout);
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

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

    // Запускаем периодическую проверку напоминаний (каждые 12 часов)
    schedulerService.startHealthCheck(12);
    logger.info('✅ Reminder health check started');
  } catch (error) {
    logger.error('Failed to start application:', error);
    await shutdown('STARTUP_ERROR');
  }
}

// Обработка завершения
process.once('SIGINT', () => {
  shutdown('SIGINT').catch((error) => {
    logger.error('Error in SIGINT handler:', error);
    process.exit(1);
  });
});

process.once('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    logger.error('Error in SIGTERM handler:', error);
    process.exit(1);
  });
});

// Обработка необработанных ошибок
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // В production не нужно завершать процесс, только логировать
  // Но можно добавить отправку в систему мониторинга
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception:', error);
  // Критическая ошибка, завершаем процесс после логирования
  shutdown('UNCAUGHT_EXCEPTION').catch(() => {
    process.exit(1);
  });
});

start();

