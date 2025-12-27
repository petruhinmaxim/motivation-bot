import { Bot } from 'grammy';
import { env } from '../utils/env.js';
import { stateMiddleware } from './middleware.js';
import logger from '../utils/logger.js';
import { schedulerService } from '../services/scheduler.service.js';
import { idleTimerService } from '../services/idle-timer.service.js';
import { userService } from '../services/user.service.js';

export const bot = new Bot(env.BOT_TOKEN);

// Обработчик события блокировки/разблокировки бота
bot.on('my_chat_member', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) {
    return;
  }

  const newStatus = ctx.myChatMember.new_chat_member.status;
  const oldStatus = ctx.myChatMember.old_chat_member.status;

  try {
    // Если пользователь заблокировал бота
    if (newStatus === 'kicked' || newStatus === 'left') {
      await userService.markUserAsBlocked(userId);
      logger.info(`User ${userId} blocked the bot`);
    }
    // Если пользователь разблокировал бота
    else if ((oldStatus === 'kicked' || oldStatus === 'left') && newStatus === 'member') {
      await userService.markUserAsUnblocked(userId);
      logger.info(`User ${userId} unblocked the bot`);
    }
  } catch (error) {
    logger.error(`Error handling my_chat_member event for user ${userId}:`, error);
  }
});

// Регистрируем middleware
bot.use(stateMiddleware);

// Инициализируем scheduler service с API бота
schedulerService.setBotApi(bot.api);

// Инициализируем idle timer service с API бота
idleTimerService.setBotApi(bot.api);

// Обработка ошибок
bot.catch((err) => {
  logger.error('Bot error:', {
    error: err.error instanceof Error ? err.error.message : String(err.error),
    stack: err.error instanceof Error ? err.error.stack : undefined,
    ctx: err.ctx?.from?.id ? { userId: err.ctx.from.id } : undefined,
  });
});

logger.info('Bot initialized');

