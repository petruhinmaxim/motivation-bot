import type { Context, NextFunction } from 'grammy';
import { stateService } from '../services/state.service.js';
import { userService } from '../services/user.service.js';
import logger from '../utils/logger.js';
import {
  handleStartScene,
  handleInfoScene,
  handleBeginScene,
} from '../scenes/index.js';
import { MESSAGES } from '../scenes/messages.js';

export async function stateMiddleware(ctx: Context, next: NextFunction) {
  if (!ctx.from) {
    return next();
  }

  const userId = ctx.from.id;

  try {
    // Сохраняем/обновляем пользователя в БД
    await userService.saveOrUpdateUser(ctx.from);

    // Обрабатываем команду /start
    if (ctx.message?.text === '/start') {
      await stateService.sendEvent(userId, { type: 'GO_TO_START' });
      await handleStartScene(ctx);
      return;
    }

    // Обрабатываем callback query (нажатия на inline кнопки)
    if (ctx.callbackQuery?.data) {
      const data = ctx.callbackQuery.data;

      if (data === 'back') {
        await stateService.sendEvent(userId, { type: 'GO_TO_START' });
        await handleStartScene(ctx);
        return;
      }

      if (data === 'info') {
        await stateService.sendEvent(userId, { type: 'GO_TO_INFO' });
        await handleInfoScene(ctx);
        return;
      }

      if (data === 'begin') {
        await stateService.sendEvent(userId, { type: 'GO_TO_BEGIN' });
        await handleBeginScene(ctx);
        return;
      }
    }

    // Если это не команда/кнопка, просто продолжаем
    return next();
  } catch (error) {
    logger.error(`Error in state middleware for user ${userId}:`, error);
    await ctx.reply(MESSAGES.ERROR.TEXT);
  }

  return next();
}

