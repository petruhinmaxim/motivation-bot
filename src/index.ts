import * as dotenv from 'dotenv';
import { bot } from './bot/bot.js';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, closeDatabase } from './database/client.js';
import logger from './utils/logger.js';
import { notificationService } from './services/notification.service.js';
import { closeRedis } from './redis/client.js';
import { startHttpServer } from './api/http-server.js';

dotenv.config();

let isShuttingDown = false;
let httpServer: import('node:http').Server | undefined;

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

    // Останавливаем HTTP сервер
    if (httpServer) {
      logger.info('Stopping HTTP server...');
      await new Promise<void>((resolve, reject) => {
        httpServer?.close((err?: Error) => (err ? reject(err) : resolve()));
      });
      logger.info('HTTP server stopped');
    }

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

    // Запускаем HTTP API (для дашборда)
    httpServer = startHttpServer();

    // Запускаем бота (не ждем завершения, так как bot.start() может не завершиться)
    logger.info('Starting bot...');
    const botStartPromise = bot.start().catch((error) => {
      logger.error('Error starting bot:', error);
      // Не прерываем запуск, бот может продолжить работать
    });
    
    // Запускаем восстановление уведомлений параллельно
    logger.info('Restoring notifications...');
    const notificationsPromise = notificationService.restoreNotifications().catch((error) => {
      logger.error('Error restoring notifications:', error);
      // Не прерываем запуск, но логируем ошибку
    });

    // Ждем завершения восстановления уведомлений (это важнее для работы)
    await notificationsPromise;
    logger.info('✅ Notifications restored');

    // Пытаемся дождаться запуска бота с таймаутом
    logger.info('Waiting for bot to start (with timeout)...');
    try {
      await Promise.race([
        botStartPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Bot start timeout')), 5000)
        )
      ]);
      logger.info('✅ Bot is running!');
    } catch (error) {
      logger.warn('Bot start may still be in progress (this is normal for long polling)');
      // Это нормально для long polling - бот может продолжать работать
    }
    
    logger.info('✅ Application startup completed');
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

