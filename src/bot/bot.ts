import { Bot } from 'grammy';
import { env } from '../utils/env.js';
import { stateMiddleware } from './middleware.js';
import logger from '../utils/logger.js';
import { schedulerService } from '../services/scheduler.service.js';

export const bot = new Bot(env.BOT_TOKEN);

// Регистрируем middleware
bot.use(stateMiddleware);

// Инициализируем scheduler service с API бота
schedulerService.setBotApi(bot.api);

// Обработка ошибок
bot.catch((err) => {
  logger.error('Bot error:', err);
});

logger.info('Bot initialized');

