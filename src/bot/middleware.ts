import type { Context, NextFunction } from 'grammy';
import { stateService } from '../services/state.service.js';
import { userService } from '../services/user.service.js';
import { challengeService } from '../services/challenge.service.js';
import { parseTimezone } from '../utils/timezone-parser.js';
import logger from '../utils/logger.js';
import {
  handleStartScene,
  handleInfoScene,
  handleBeginScene,
  handleDurationScene,
  handleTomorrowScene,
  handleMondayScene,
  handleTimezoneScene,
} from '../scenes/index.js';
import { MESSAGES } from '../scenes/messages.js';
import { schedulerService } from '../services/scheduler.service.js';

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

      if (data === 'start_today') {
        await handleDurationScene(ctx);
        return;
      }

      if (data === 'start_tomorrow') {
        await handleTomorrowScene(ctx);
        schedulerService.scheduleTomorrowDuration(userId);
        return;
      }

      if (data === 'start_monday') {
        await handleMondayScene(ctx);
        schedulerService.scheduleMondayDuration(userId);
        return;
      }

      if (data === 'start_now_tomorrow') {
        // Отменяем запланированное напоминание
        schedulerService.cancelTask(userId);
        // Открываем сцену выбора продолжительности
        await handleDurationScene(ctx);
        return;
      }

      if (data === 'start_now_monday') {
        // Отменяем запланированное напоминание
        schedulerService.cancelTask(userId);
        // Открываем сцену выбора продолжительности
        await handleDurationScene(ctx);
        return;
      }

      if (data === 'duration_30' || data === 'duration_60' || data === 'duration_90') {
        // Определяем продолжительность челленджа
        const duration = data === 'duration_30' ? 30 : data === 'duration_60' ? 60 : 90;
        
        // Создаем или обновляем челлендж
        await challengeService.createOrUpdateChallenge(userId, duration);
        
        // Переходим к сцене выбора часового пояса
        await handleTimezoneScene(ctx);
        return;
      }

      if (data === 'postpone_start') {
        // Возвращаемся на сцену выбора старта челленджа
        await stateService.sendEvent(userId, { type: 'GO_TO_BEGIN' });
        await handleBeginScene(ctx);
        return;
      }
    }

    // Обрабатываем текстовые сообщения в сцене выбора часового пояса
    if (ctx.message?.text && ctx.message.text !== '/start') {
      const user = await userService.getUser(userId);
      const challenge = await challengeService.getActiveChallenge(userId);

      // Если у пользователя есть активный челлендж, но нет timezone, значит он в сцене выбора timezone
      if (challenge && user && user.timezone === null) {
        const timezone = parseTimezone(ctx.message.text);
        
        if (timezone !== null) {
          // Сохраняем timezone
          await userService.updateTimezone(userId, timezone);
          await ctx.reply(`Отлично! Твой часовой пояс сохранен: UTC${timezone >= 0 ? '+' : ''}${timezone}`);
          return;
        } else {
          // Не удалось распарсить, просим повторить
          await ctx.reply('Не удалось распознать часовой пояс. Пожалуйста, отправь сообщение в формате "X МСК", например: "0 МСК" или "+2 МСК"');
          return;
        }
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

