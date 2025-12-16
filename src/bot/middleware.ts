import type { Context, NextFunction } from 'grammy';
import { InputFile } from 'grammy';
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
  handleChallengeStatsScene,
  handleChallengeSettingsScene,
  handleEditTimezoneScene,
  handleEditReminderTimeScene,
} from '../scenes/index.js';
import { MESSAGES } from '../scenes/messages.js';
import { schedulerService } from '../services/scheduler.service.js';
import { validateTime } from '../utils/time-validator.js';
import { processImage } from '../utils/image-processor.js';
import { getRandomMotivationalPhrase } from '../utils/motivational-phrases.js';
import { getCurrentDateString } from '../utils/date-utils.js';
import { env } from '../utils/env.js';

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

      if (data === 'challenge_stats') {
        // Переходим к сцене статистики челленджа
        await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_STATS' });
        await handleChallengeStatsScene(ctx);
        return;
      }

      if (data === 'challenge_rules') {
        // Переходим к сцене правил челленджа
        await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_RULES' });
        await handleChallengeRulesScene(ctx);
        return;
      }

      if (data === 'challenge_settings') {
        // Переходим к сцене настроек челленджа
        await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_SETTINGS' });
        await handleChallengeSettingsScene(ctx);
        return;
      }

      if (data === 'change_timezone') {
        // Переходим к сцене редактирования часового пояса
        await stateService.sendEvent(userId, { type: 'GO_TO_EDIT_TIMEZONE' });
        await handleEditTimezoneScene(ctx);
        return;
      }

      if (data === 'change_reminder_time') {
        // Переходим к сцене редактирования времени уведомлений
        await stateService.sendEvent(userId, { type: 'GO_TO_EDIT_REMINDER_TIME' });
        await handleEditReminderTimeScene(ctx);
        return;
      }

      if (data === 'send_photo') {
        // Отправляем сообщение с просьбой отправить фото
        await ctx.answerCallbackQuery();
        await ctx.reply('Отправь фото в чат и помни, жир не пройдет!');
        // Переводим пользователя в сцену ожидания фото
        await stateService.sendEvent(userId, { type: 'GO_TO_WAITING_FOR_PHOTO' });
        return;
      }
    }

    // Обрабатываем текстовые сообщения в зависимости от текущей сцены
    if (ctx.message?.text && ctx.message.text !== '/start') {
      const currentScene = await stateService.getCurrentScene(userId);
      
      // Если пользователь ожидал фото, но отправил текст, возвращаем в статистику
      if (currentScene === 'waiting_for_photo') {
        await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_STATS' });
        await handleChallengeStatsScene(ctx);
        return;
      }

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

      // Обрабатываем редактирование timezone из настроек
      if (currentScene === 'edit_timezone') {
        const timezone = parseTimezone(ctx.message.text);
        
        if (timezone !== null) {
          // Сохраняем timezone
          await userService.updateTimezone(userId, timezone);
          // Отправляем уведомление об успехе
          await ctx.reply('✅ Часовой пояс успешно изменен!');
          // Возвращаемся в настройки
          await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_SETTINGS' });
          await handleChallengeSettingsScene(ctx);
          return;
        } else {
          // Не удалось распарсить, просим повторить
          await ctx.reply('❌ Не удалось распознать часовой пояс. Пожалуйста, отправь сообщение в формате "X МСК", например: "0 МСК" или "+2 МСК"');
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

      // Обрабатываем редактирование времени напоминаний из настроек
      if (currentScene === 'edit_reminder_time') {
        const validation = validateTime(ctx.message.text);
        
        if (validation.isValid && validation.time) {
          // Сохраняем время напоминаний
          await challengeService.updateReminderTime(userId, validation.time);
          // Отправляем уведомление об успехе
          await ctx.reply('✅ Время уведомлений успешно изменено!');
          // Возвращаемся в настройки
          await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_SETTINGS' });
          await handleChallengeSettingsScene(ctx);
          return;
        } else {
          // Не удалось распарсить, просим повторить
          await ctx.reply('❌ Не удалось распознать время. Пожалуйста, отправь время в формате "HH:MM", например: "14:00" или "09:30"');
          return;
        }
      }
    }

    // Обрабатываем фото
    if (ctx.message?.photo) {
      const userId = ctx.from.id;
      
      // Проверяем, ожидаем ли мы фото от этого пользователя (проверяем сцену)
      const currentScene = await stateService.getCurrentScene(userId);
      
      if (currentScene !== 'waiting_for_photo') {
        // Если пользователь не нажимал кнопку "Отправить фото", отправляем сообщение и переводим на статистику
        await ctx.reply('Для загрузки фото нажми на кнопку');
        await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_STATS' });
        await handleChallengeStatsScene(ctx);
        return;
      }
      
      const user = await userService.getUser(userId);
      const timezoneOffset = user?.timezone ?? null;
      const currentDate = getCurrentDateString(timezoneOffset);

      // Проверяем, есть ли активный челлендж
      const challenge = await challengeService.getActiveChallenge(userId);
      if (!challenge) {
        await ctx.reply('У тебя нет активного челленджа. Начни новый челлендж!');
        return;
      }

      // Проверяем, было ли уже загружено фото сегодня
      const alreadyUploaded = await challengeService.hasPhotoUploadedToday(userId, currentDate);
      
      if (alreadyUploaded) {
        // Если фото уже было загружено сегодня
        await ctx.reply('Вижу вторую тренировку - огонь. Мы засчитываем одну в день, но тело всё запомнило.');
        // Возвращаем пользователя в сцену статистики
        await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_STATS' });
        // Отправляем сцену статистики
        await handleChallengeStatsScene(ctx);
        return;
      }

      try {
        // Получаем самое большое фото (обычно последнее в массиве)
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const file = await ctx.api.getFile(photo.file_id);
        
        // Скачиваем фото
        const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`;
        const response = await fetch(fileUrl);
        const imageBuffer = Buffer.from(await response.arrayBuffer());

        // Обрабатываем изображение
        const dayNumber = challenge.successfulDays + 1;
        const processedImage = await processImage(imageBuffer, dayNumber, challenge.duration);

        // Отправляем обработанное фото
        await ctx.replyWithPhoto(new InputFile(processedImage, 'photo.jpg'), {
          caption: getRandomMotivationalPhrase(),
        });

        // Увеличиваем successfulDays
        await challengeService.incrementSuccessfulDays(userId, currentDate);

        // Возвращаем пользователя в сцену статистики
        await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_STATS' });
        
        // Отправляем сцену статистики
        await handleChallengeStatsScene(ctx);
      } catch (error) {
        logger.error(`Error processing photo for user ${userId}:`, error);
        await ctx.reply('Произошла ошибка при обработке фото. Попробуй еще раз.');
      }
      return;
    }

    // Если это не команда/кнопка, просто продолжаем
    return next();
  } catch (error) {
    logger.error(`Error in state middleware for user ${userId}:`, error);
    await ctx.reply(MESSAGES.ERROR.TEXT);
  }

  return next();
}

