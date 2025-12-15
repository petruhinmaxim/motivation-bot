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
  handleReminderTimeScene,
  handleChallengeRulesScene,
} from '../scenes/index.js';
import { MESSAGES } from '../scenes/messages.js';
import { schedulerService } from '../services/scheduler.service.js';
import { validateTime } from '../utils/time-validator.js';

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
        await stateService.sendEvent(userId, { type: 'GO_TO_DURATION' });
        await handleDurationScene(ctx);
        return;
      }

      if (data === 'start_tomorrow') {
        await stateService.sendEvent(userId, { type: 'GO_TO_TOMORROW' });
        await handleTomorrowScene(ctx);
        schedulerService.scheduleTomorrowDuration(userId);
        return;
      }

      if (data === 'start_monday') {
        await stateService.sendEvent(userId, { type: 'GO_TO_MONDAY' });
        await handleMondayScene(ctx);
        schedulerService.scheduleMondayDuration(userId);
        return;
      }

      if (data === 'start_now_tomorrow') {
        // Отменяем запланированное напоминание
        schedulerService.cancelTask(userId);
        // Открываем сцену выбора продолжительности
        await stateService.sendEvent(userId, { type: 'GO_TO_DURATION' });
        await handleDurationScene(ctx);
        return;
      }

      if (data === 'start_now_monday') {
        // Отменяем запланированное напоминание
        schedulerService.cancelTask(userId);
        // Открываем сцену выбора продолжительности
        await stateService.sendEvent(userId, { type: 'GO_TO_DURATION' });
        await handleDurationScene(ctx);
        return;
      }

      if (data === 'duration_30' || data === 'duration_60' || data === 'duration_90') {
        // Определяем продолжительность челленджа
        const duration = data === 'duration_30' ? 30 : data === 'duration_60' ? 60 : 90;
        
        // Создаем или обновляем челлендж
        await challengeService.createOrUpdateChallenge(userId, duration);
        
        // Переходим к сцене выбора часового пояса
        await stateService.sendEvent(userId, { type: 'GO_TO_TIMEZONE' });
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

    // Обрабатываем текстовые сообщения в зависимости от текущей сцены
    if (ctx.message?.text && ctx.message.text !== '/start') {
      const currentScene = await stateService.getCurrentScene(userId);

      // Обрабатываем timezone только если пользователь в сцене timezone
      if (currentScene === 'timezone') {
        const timezone = parseTimezone(ctx.message.text);
        
        if (timezone !== null) {
          // Сохраняем timezone
          await userService.updateTimezone(userId, timezone);
          // Переходим к сцене выбора времени напоминаний
          await stateService.sendEvent(userId, { type: 'GO_TO_REMINDER_TIME' });
          await handleReminderTimeScene(ctx);
          return;
        } else {
          // Не удалось распарсить, просим повторить
          await ctx.reply('Не удалось распознать часовой пояс. Пожалуйста, отправь сообщение в формате "X МСК", например: "0 МСК" или "+2 МСК"');
          return;
        }
      }

      // Обрабатываем время напоминаний только если пользователь в сцене reminder_time
      if (currentScene === 'reminder_time') {
        const validation = validateTime(ctx.message.text);
        
        if (validation.isValid && validation.time) {
          // Сохраняем время напоминаний
          await challengeService.updateReminderTime(userId, validation.time);
          // Переходим к сцене правил челленджа
          await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_RULES' });
          await handleChallengeRulesScene(ctx);
          return;
        } else {
          // Не удалось распарсить, просим повторить
          await ctx.reply('Не удалось распознать время. Пожалуйста, отправь время в формате "HH:MM", например: "14:00" или "09:30"');
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

