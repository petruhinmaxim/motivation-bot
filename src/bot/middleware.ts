import type { Context, NextFunction } from 'grammy';
import { InputFile, InlineKeyboard } from 'grammy';
import { stateService } from '../services/state.service.js';
import type { Scene } from '../state/types.js';
import { userService } from '../services/user.service.js';
import { challengeService } from '../services/challenge.service.js';
import { idleTimerService } from '../services/idle-timer.service.js';
import { parseTimezone } from '../utils/timezone-parser.js';
import logger from '../utils/logger.js';
import {
  handleStartScene,
  handleInfoScene,
  handleBeginScene,
  handleTomorrowScene,
  handleMondayScene,
  handleTimezoneScene,
  handleReminderTimeScene,
  handleChallengeRulesScene,
  handleChallengeStatsScene,
  handleChallengeSettingsScene,
  handleEditTimezoneScene,
  handleEditReminderTimeScene,
  handleFeedbackScene,
  handleStartNewChallengeConfirmScene,
} from '../scenes/index.js';
import { missedWorkoutReportService } from '../services/missed-workout-report.service.js';
import { feedbackService } from '../services/feedback.service.js';
import { buttonLogService } from '../services/button-log.service.js';
import { MESSAGES, BUTTONS } from '../scenes/messages.js';
import { schedulerService } from '../services/scheduler.service.js';
import { notificationService } from '../services/notification.service.js';
import { validateTime } from '../utils/time-validator.js';
import { processImage } from '../utils/image-processor.js';
import { getRandomMotivationalPhrase } from '../utils/motivational-phrases.js';
import { getCurrentDateString } from '../utils/date-utils.js';
import { env } from '../utils/env.js';
import { bot } from './bot.js';
import sharp from 'sharp';

// Максимальный размер файла для обработки (20 МБ)
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * Вспомогательная функция для корректного перехода в состояние timezone.
 * Если пользователь находится в состоянии, из которого нельзя напрямую перейти в timezone,
 * использует промежуточные переходы через begin (или start -> begin).
 */
async function goToTimezone(userId: number): Promise<Scene> {
  const currentScene = await stateService.getCurrentScene(userId);
  
  // Проверяем, можем ли мы напрямую перейти в timezone из текущего состояния
  // GO_TO_TIMEZONE может быть обработан только из begin, tomorrow, monday
  if (currentScene === 'begin' || currentScene === 'tomorrow' || currentScene === 'monday') {
    // Можем напрямую перейти
    return await stateService.sendEvent(userId, { type: 'GO_TO_TIMEZONE' });
  } else if (currentScene === 'start' || currentScene === 'challenge_stats') {
    // Из start и challenge_stats можно перейти в begin
    logger.debug(`User ${userId} is in state ${currentScene}, transitioning through begin to timezone`);
    await stateService.sendEvent(userId, { type: 'GO_TO_BEGIN' });
    return await stateService.sendEvent(userId, { type: 'GO_TO_TIMEZONE' });
  } else {
    // Для других состояний используем путь через start -> begin -> timezone
    // GO_TO_START доступен из большинства состояний
    logger.debug(`User ${userId} is in state ${currentScene}, transitioning through start -> begin -> timezone`);
    await stateService.sendEvent(userId, { type: 'GO_TO_START' });
    await stateService.sendEvent(userId, { type: 'GO_TO_BEGIN' });
    return await stateService.sendEvent(userId, { type: 'GO_TO_TIMEZONE' });
  }
}

export async function stateMiddleware(ctx: Context, next: NextFunction) {
  if (!ctx.from) {
    return next();
  }

  const userId = ctx.from.id;

  try {
    // Сохраняем/обновляем пользователя в БД
    await userService.saveOrUpdateUser(ctx.from);

    // Проверяем текущую сцену и управляем общим таймером бездействия для процесса регистрации
    const currentScene = await stateService.getCurrentScene(userId);
    if (idleTimerService.isRegistrationScene(currentScene)) {
      // Если пользователь на сцене регистрации и есть активный таймер - перезапускаем (взаимодействие)
      // Если таймера нет - запускаем новый
      if (idleTimerService.hasActiveTimer(userId)) {
        // Перезапускаем таймер при взаимодействии на сцене регистрации
        idleTimerService.startIdleTimer(userId, currentScene);
      } else {
        // Запускаем новый таймер
        idleTimerService.startIdleTimer(userId, currentScene);
      }
    } else {
      // Если пользователь не на сцене регистрации - отменяем таймер
      idleTimerService.cancelIdleTimer(userId);
    }

    // Обрабатываем команду /start
    if (ctx.message?.text === '/start') {
      // Отменяем таймер бездействия при переходе на start
      idleTimerService.cancelIdleTimer(userId);
      await stateService.sendEvent(userId, { type: 'GO_TO_START' });
      await handleStartScene(ctx);
      return;
    }

    // Обрабатываем команду sendAllUsers
    if (ctx.message?.text && ctx.message.text.startsWith('sendAllUsers')) {
      const messageText = ctx.message.text;
      const lines = messageText.split('\n');
      
      // Извлекаем текст после команды (все строки после первой)
      const textToSend = lines.slice(1).join('\n').trim();
      
      if (!textToSend) {
        await ctx.reply('Пожалуйста, укажите текст для отправки после команды sendAllUsers');
        return;
      }

      try {
        // Получаем всех активных пользователей
        const activeUsers = await userService.getAllActiveUsers();
        
        // Создаем клавиатуру с кнопкой "к челленджу"
        const keyboard = new InlineKeyboard()
          .text(BUTTONS.TO_CHALLENGE, 'challenge_stats');

        let successCount = 0;
        let errorCount = 0;

        // Отправляем сообщение всем пользователям
        for (const user of activeUsers) {
          try {
            await bot.api.sendMessage(user.id, textToSend, {
              reply_markup: keyboard,
            });
            successCount++;
          } catch (error: any) {
            errorCount++;
            // Логируем ошибки, но продолжаем отправку остальным
            logger.warn(`Failed to send message to user ${user.id}:`, error.message || error);
            
            // Если пользователь заблокировал бота, помечаем его как заблокированного
            if (error.error_code === 403 || error.description?.includes('blocked')) {
              await userService.markUserAsBlocked(user.id);
            }
          }
        }

        // Отправляем подтверждение отправителю
        await ctx.reply(
          `✅ Сообщение отправлено ${successCount} пользователям${errorCount > 0 ? ` (ошибок: ${errorCount})` : ''}`
        );
        
        logger.info(`User ${userId} sent message to all users. Success: ${successCount}, Errors: ${errorCount}`);
      } catch (error) {
        logger.error(`Error sending message to all users:`, error);
        await ctx.reply('Произошла ошибка при отправке сообщения всем пользователям');
      }
      
      return;
    }

    // Обрабатываем callback query (нажатия на inline кнопки)
    if (ctx.callbackQuery?.data) {
      const data = ctx.callbackQuery.data;

      // Логируем нажатие кнопки
      await buttonLogService.logButtonClick(userId, data);

      if (data === 'back') {
        // Отменяем таймер бездействия при выходе со сцены begin
        if (currentScene === 'begin') {
          idleTimerService.cancelIdleTimer(userId);
        }
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
        // sendEvent теперь возвращает обновленное состояние
        const newScene = await stateService.sendEvent(userId, { type: 'GO_TO_BEGIN' });
        // Если таймер уже активен - обновляем сцену, иначе запускаем новый
        if (idleTimerService.hasActiveTimer(userId)) {
          idleTimerService.updateScene(userId, newScene);
        } else {
          idleTimerService.startIdleTimer(userId, newScene);
        }
        await handleBeginScene(ctx);
        return;
      }

      if (data === 'start_today' || data === 'start_today_from_notification') {
        try {
          // Отменяем запланированное уведомление (если есть)
          schedulerService.cancelTask(userId);
          
          // Логируем текущее состояние перед переходом
          const sceneBefore = await stateService.getCurrentScene(userId);
          logger.info(`User ${userId} clicked start_today. Current scene: ${sceneBefore}`);
          
          // Создаем новый челлендж с продолжительностью 30 дней
          await challengeService.createOrUpdateChallenge(userId, 30);
          logger.debug(`Challenge created for user ${userId}`);
          
          // Переходим к сцене выбора часового пояса
          // Используем вспомогательную функцию для корректного перехода
          const newScene = await goToTimezone(userId);
          logger.info(`User ${userId} state changed to: ${newScene} after GO_TO_TIMEZONE event`);
          
          // Проверяем, что состояние действительно обновилось
          const verifyScene = await stateService.getCurrentScene(userId);
          if (verifyScene !== 'timezone') {
            logger.error(`State mismatch after GO_TO_TIMEZONE for user ${userId}. Expected: timezone, got: ${verifyScene}. Retrying...`);
            // Пытаемся восстановить состояние
            const retryScene = await goToTimezone(userId);
            logger.info(`User ${userId} state after retry: ${retryScene}`);
          }
          
          // Финальная проверка состояния
          const finalScene = await stateService.getCurrentScene(userId);
          logger.info(`User ${userId} final scene before handleTimezoneScene: ${finalScene}`);
          
          // Обновляем сцену в таймере (переход между сценами регистрации - таймер продолжает идти)
          if (idleTimerService.hasActiveTimer(userId)) {
            idleTimerService.updateScene(userId, 'timezone');
          } else {
            idleTimerService.startIdleTimer(userId, 'timezone');
          }
          await handleTimezoneScene(ctx);
        } catch (error: any) {
          // Если у пользователя уже есть активный челлендж
          if (error.message === 'User already has an active challenge') {
            // Отменяем таймер при выходе из процесса регистрации
            idleTimerService.cancelIdleTimer(userId);
            await ctx.reply(MESSAGES.CHALLENGE.ALREADY_ACTIVE);
            await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_STATS' });
            await handleChallengeStatsScene(ctx);
          } else {
            logger.error(`Error creating challenge for user ${userId}:`, error);
            await ctx.reply(MESSAGES.CHALLENGE.CREATE_ERROR);
          }
        }
        return;
      }

      if (data === 'start_tomorrow' || data === 'start_tomorrow_from_notification') {
        // Если челлендж уже активен — ведем в статистику
        const activeChallenge = await challengeService.getActiveChallenge(userId);
        if (activeChallenge) {
          // На всякий случай отменяем отложенный старт, чтобы не присылал уведомление
          schedulerService.cancelTask(userId);
          idleTimerService.cancelIdleTimer(userId);
          await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_STATS' });
          await handleChallengeStatsScene(ctx);
          return;
        }

        // Отменяем таймер бездействия при выходе со сцены begin (если не из уведомления)
        if (data === 'start_tomorrow') {
          idleTimerService.cancelIdleTimer(userId);
        }

        // Отменяем предыдущее уведомление и создаем новое на завтра
        schedulerService.cancelTask(userId);
        schedulerService.scheduleTomorrowDuration(userId);

        // Поведение как при первом выборе старта: переключаем сцену и редактируем сообщение
        await stateService.sendEvent(userId, { type: 'GO_TO_TOMORROW' });
        await handleTomorrowScene(ctx);
        return;
      }

      if (data === 'start_monday' || data === 'start_monday_from_notification') {
        // Если челлендж уже активен — ведем в статистику
        const activeChallenge = await challengeService.getActiveChallenge(userId);
        if (activeChallenge) {
          // На всякий случай отменяем отложенный старт, чтобы не присылал уведомление
          schedulerService.cancelTask(userId);
          idleTimerService.cancelIdleTimer(userId);
          await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_STATS' });
          await handleChallengeStatsScene(ctx);
          return;
        }

        // Отменяем таймер бездействия при выходе со сцены begin (если не из уведомления)
        if (data === 'start_monday') {
          idleTimerService.cancelIdleTimer(userId);
        }

        // Отменяем предыдущее уведомление и создаем новое на понедельник
        schedulerService.cancelTask(userId);
        schedulerService.scheduleMondayDuration(userId);

        // Поведение как при первом выборе старта: переключаем сцену и редактируем сообщение
        await stateService.sendEvent(userId, { type: 'GO_TO_MONDAY' });
        await handleMondayScene(ctx);
        return;
      }

      if (data === 'start_now_tomorrow') {
        // Отменяем запланированное напоминание
        schedulerService.cancelTask(userId);
        
        try {
          // Создаем новый челлендж с продолжительностью 30 дней
          await challengeService.createOrUpdateChallenge(userId, 30);
          
          // Переходим к сцене выбора часового пояса
          // Используем вспомогательную функцию для корректного перехода
          const newScene = await goToTimezone(userId);
          
          // Проверяем, что состояние действительно обновилось
          if (newScene !== 'timezone') {
            logger.error(`State mismatch after GO_TO_TIMEZONE for user ${userId}. Expected: timezone, got: ${newScene}. Retrying...`);
            // Пытаемся восстановить состояние
            await goToTimezone(userId);
          }
          
          // Обновляем сцену в таймере (переход между сценами регистрации - таймер продолжает идти)
          if (idleTimerService.hasActiveTimer(userId)) {
            idleTimerService.updateScene(userId, 'timezone');
          } else {
            idleTimerService.startIdleTimer(userId, 'timezone');
          }
          await handleTimezoneScene(ctx);
        } catch (error: any) {
          // Если у пользователя уже есть активный челлендж
          if (error.message === 'User already has an active challenge') {
            // Отменяем таймер при выходе из процесса регистрации
            idleTimerService.cancelIdleTimer(userId);
            await ctx.reply(MESSAGES.CHALLENGE.ALREADY_ACTIVE);
            await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_STATS' });
            await handleChallengeStatsScene(ctx);
          } else {
            logger.error(`Error creating challenge for user ${userId}:`, error);
            await ctx.reply(MESSAGES.CHALLENGE.CREATE_ERROR);
          }
        }
        return;
      }

      if (data === 'start_now_monday') {
        // Отменяем запланированное напоминание
        schedulerService.cancelTask(userId);
        
        try {
          // Создаем новый челлендж с продолжительностью 30 дней
          await challengeService.createOrUpdateChallenge(userId, 30);
          
          // Переходим к сцене выбора часового пояса
          // Используем вспомогательную функцию для корректного перехода
          const newScene = await goToTimezone(userId);
          
          // Проверяем, что состояние действительно обновилось
          if (newScene !== 'timezone') {
            logger.error(`State mismatch after GO_TO_TIMEZONE for user ${userId}. Expected: timezone, got: ${newScene}. Retrying...`);
            // Пытаемся восстановить состояние
            await goToTimezone(userId);
          }
          
          // Обновляем сцену в таймере (переход между сценами регистрации - таймер продолжает идти)
          if (idleTimerService.hasActiveTimer(userId)) {
            idleTimerService.updateScene(userId, 'timezone');
          } else {
            idleTimerService.startIdleTimer(userId, 'timezone');
          }
          await handleTimezoneScene(ctx);
        } catch (error: any) {
          // Если у пользователя уже есть активный челлендж
          if (error.message === 'User already has an active challenge') {
            // Отменяем таймер при выходе из процесса регистрации
            idleTimerService.cancelIdleTimer(userId);
            await ctx.reply(MESSAGES.CHALLENGE.ALREADY_ACTIVE);
            await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_STATS' });
            await handleChallengeStatsScene(ctx);
          } else {
            logger.error(`Error creating challenge for user ${userId}:`, error);
            await ctx.reply(MESSAGES.CHALLENGE.CREATE_ERROR);
          }
        }
        return;
      }

      if (data === 'start_new_challenge') {
        await stateService.sendEvent(userId, { type: 'GO_TO_START' });
        await handleStartScene(ctx);
        return;
      }


      if (data === 'challenge_stats') {
        // Переходим к сцене статистики челленджа
        await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_STATS' });
        await handleChallengeStatsScene(ctx);
        return;
      }

      if (data === 'challenge_stats_missed_day') {
        // Кнопка из уведомления о пропущенном дне:
        // статистику отправляем новым сообщением (без попытки редактировать исходное)
        await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_STATS' });
        await handleChallengeStatsScene(ctx);
        return;
      }

      if (data === 'start_from_failed_challenge_notification') {
        // Кнопка из сообщения о проваленном челлендже (часто это фото):
        // стартовую сцену отправляем НОВЫМ сообщением, без попытки редактировать исходное.
        await stateService.sendEvent(userId, { type: 'GO_TO_START' });
        await ctx.answerCallbackQuery();

        const mockContext = {
          from: ctx.from,
          chat: ctx.chat,
          api: ctx.api,
          reply: ctx.reply.bind(ctx),
        } as any;

        await handleStartScene(mockContext);
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

      if (data === 'start_new_challenge_confirm') {
        // Переходим к сцене подтверждения начала нового челленджа
        await stateService.sendEvent(userId, { type: 'GO_TO_START_NEW_CHALLENGE_CONFIRM' });
        await handleStartNewChallengeConfirmScene(ctx);
        return;
      }

      if (data === 'start_new_challenge_yes') {
        try {
          // Переводим активный челлендж в failed
          await challengeService.failChallenge(userId);
          
          // Удаляем все уведомления для пользователя
          notificationService.cancelDailyReminder(userId);
          notificationService.cancelMissedDayNotification(userId);
          
          // Отправляем стартовую сцену
          await stateService.sendEvent(userId, { type: 'GO_TO_START' });
          await handleStartScene(ctx);
        } catch (error: any) {
          logger.error(`Error starting new challenge for user ${userId}:`, error);
          await ctx.answerCallbackQuery('Произошла ошибка. Попробуйте позже.');
        }
        return;
      }

      if (data === 'start_new_challenge_no') {
        // Возвращаем пользователя к настройкам
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

      if (data === 'disable_reminders') {
        // Отключаем напоминания
        await challengeService.disableReminders(userId);
        notificationService.cancelDailyReminder(userId);
        await ctx.answerCallbackQuery(MESSAGES.REMINDERS.DISABLED);
        await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_SETTINGS' });
        await handleChallengeSettingsScene(ctx);
        return;
      }

      if (data === 'enable_reminders') {
        // Включаем напоминания (используем старое время или 12:00 МСК по умолчанию)
        const challenge = await challengeService.getActiveChallenge(userId);
        if (!challenge) {
          await ctx.answerCallbackQuery('Челлендж не найден');
          return;
        }

        await challengeService.enableReminders(userId);
        
        // Получаем обновленный челлендж
        const updatedChallenge = await challengeService.getActiveChallenge(userId);
        if (updatedChallenge) {
          const user = await userService.getUser(userId);
          const timezone = user?.timezone ?? 3;
          const reminderTime = updatedChallenge.reminderTime?.slice(0, 5) || '12:00';
          await notificationService.scheduleDailyReminder(userId, reminderTime, timezone);
        }
        
        await ctx.answerCallbackQuery('✅ Уведомления включены');
        await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_SETTINGS' });
        await handleChallengeSettingsScene(ctx);
        return;
      }

      if (data === 'send_photo') {
        // Отправляем сообщение с просьбой отправить фото
        await ctx.answerCallbackQuery();
        await ctx.reply(MESSAGES.PHOTO.SEND_REQUEST);
        // Переводим пользователя в сцену ожидания фото
        await stateService.sendEvent(userId, { type: 'GO_TO_WAITING_FOR_PHOTO' });
        return;
      }

      if (data === 'feedback') {
        // Переходим к сцене обратной связи
        await stateService.sendEvent(userId, { type: 'GO_TO_FEEDBACK' });
        await handleFeedbackScene(ctx);
        return;
      }
    }

    // Обрабатываем текстовые сообщения в зависимости от текущей сцены
    if (ctx.message?.text && ctx.message.text !== '/start') {
      // Получаем актуальное состояние сцены перед обработкой текстового сообщения
      // Это важно, так как состояние могло измениться с момента получения на строке 52
      let currentScene = await stateService.getCurrentScene(userId);
      
      // Логируем для отладки (можно убрать в продакшене)
      logger.debug(`Processing text message for user ${userId}, current scene: ${currentScene}, text: ${ctx.message.text.substring(0, 50)}`);
      
      // Если пользователь ожидал фото, но отправил текст, возвращаем в статистику
      if (currentScene === 'waiting_for_photo') {
        // sendEvent теперь возвращает обновленное состояние
        await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_STATS' });
        await handleChallengeStatsScene(ctx);
        return;
      }

      // Обрабатываем timezone только если пользователь в сцене timezone
      // Важно: проверяем состояние непосредственно перед обработкой
      if (currentScene === 'timezone') {
        const timezone = parseTimezone(ctx.message.text);
        
        if (timezone !== null) {
          // Сохраняем timezone
          await userService.updateTimezone(userId, timezone);
          // Перепланируем проверку пропущенных дней с новым часовым поясом
          await notificationService.rescheduleMissedDaysCheck(userId, timezone);
          // Отменяем таймер бездействия при выходе из процесса регистрации
          idleTimerService.cancelIdleTimer(userId);
          // Переходим к сцене установки времени уведомлений
          await stateService.sendEvent(userId, { type: 'GO_TO_REMINDER_TIME' });
          await handleReminderTimeScene(ctx);
          return;
        } else {
          // Не удалось распарсить, просим повторить
          // Важно: после ошибки пользователь должен остаться в сцене timezone
          // Явно проверяем и восстанавливаем состояние, если оно потерялось
          const sceneAfterError = await stateService.getCurrentScene(userId);
          if (sceneAfterError !== 'timezone') {
            logger.warn(`Scene lost after timezone parse error for user ${userId}. Expected: timezone, got: ${sceneAfterError}. Restoring to timezone.`);
            await goToTimezone(userId);
          }
          await ctx.reply(MESSAGES.TIMEZONE.PARSE_ERROR);
          return;
        }
      }
      
      // Дополнительная проверка: если текст похож на часовой пояс, но мы не в сцене timezone,
      // возможно состояние потерялось - пытаемся восстановить
      // Проверяем, что мы не в сценах, связанных с timezone
      // Используем явную проверку для избежания проблем с типами TypeScript
      if (currentScene !== 'edit_timezone') {
        const potentialTimezone = parseTimezone(ctx.message.text);
        if (potentialTimezone !== null) {
          // Текст похож на часовой пояс, но мы не в нужной сцене
          // Проверяем, не должны ли мы быть в сцене timezone
          logger.warn(`User ${userId} sent timezone-like text "${ctx.message.text}" but is in scene "${currentScene}". This might indicate state loss.`);
          // Не обрабатываем автоматически, чтобы не нарушить логику, но логируем для диагностики
        }
      }

      // Обрабатываем редактирование timezone из настроек
      if (currentScene === 'edit_timezone') {
        const timezone = parseTimezone(ctx.message.text);
        
        if (timezone !== null) {
          // Сохраняем timezone
          await userService.updateTimezone(userId, timezone);
          // Перепланируем проверку пропущенных дней с новым часовым поясом
          await notificationService.rescheduleMissedDaysCheck(userId, timezone);
          // Если уведомления включены - перепланируем и их
          const challenge = await challengeService.getActiveChallenge(userId);
          if (challenge?.reminderStatus && challenge.reminderTime) {
            await notificationService.rescheduleDailyReminder(userId);
          }
          // Отправляем уведомление об успехе
          await ctx.reply(MESSAGES.TIMEZONE.UPDATED);
          // Возвращаемся в настройки
          // sendEvent теперь возвращает обновленное состояние
          await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_SETTINGS' });
          await handleChallengeSettingsScene(ctx);
          return;
        } else {
          // Не удалось распарсить, просим повторить
          // Важно: после ошибки пользователь должен остаться в сцене edit_timezone
          // Явно проверяем и восстанавливаем состояние, если оно потерялось
          const sceneAfterError = await stateService.getCurrentScene(userId);
          if (sceneAfterError !== 'edit_timezone') {
            logger.warn(`Scene lost after edit_timezone parse error for user ${userId}, restoring to edit_timezone`);
            await stateService.sendEvent(userId, { type: 'GO_TO_EDIT_TIMEZONE' });
          }
          await ctx.reply(MESSAGES.TIMEZONE.PARSE_ERROR_EDIT);
          return;
        }
      }

    }

    // Вспомогательная функция для валидации изображения
    async function validateImage(imageBuffer: Buffer): Promise<{ valid: boolean; error?: string }> {
      try {
        const image = sharp(imageBuffer);
        const metadata = await image.metadata();
        
        const width = metadata.width || 0;
        const height = metadata.height || 0;
        const format = metadata.format;
        
        // Проверяем размеры изображения
        const MIN_SIZE = 100;
        const MAX_SIZE = 10000;
        
        if (width < MIN_SIZE || height < MIN_SIZE) {
          return { valid: false, error: MESSAGES.PHOTO.INVALID_SIZE };
        }
        
        if (width > MAX_SIZE || height > MAX_SIZE) {
          return { valid: false, error: MESSAGES.PHOTO.INVALID_SIZE };
        }
        
        // Проверяем формат (только JPEG, PNG, WebP)
        const allowedFormats = ['jpeg', 'jpg', 'png', 'webp'];
        if (!format || !allowedFormats.includes(format.toLowerCase())) {
          return { valid: false, error: MESSAGES.PHOTO.INVALID_FORMAT };
        }
        
        return { valid: true };
      } catch (error) {
        logger.error('Error validating image:', error);
        return { valid: false, error: MESSAGES.PHOTO.INVALID_FORMAT };
      }
    }

    // Вспомогательная функция для обработки изображения
    async function processImageFromFile(fileId: string, userId: number, fileSize?: number) {
      const currentScene = await stateService.getCurrentScene(userId);
      
      // Разрешаем обработку фото в challenge_stats и waiting_for_photo
      if (currentScene !== 'waiting_for_photo' && currentScene !== 'challenge_stats') {
        // Если пользователь не в сцене статистики или ожидания фото, отправляем сообщение и переводим на статистику
        await ctx.reply(MESSAGES.PHOTO.CLICK_BUTTON);
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
        await ctx.reply(MESSAGES.CHALLENGE.NOT_ACTIVE);
        return;
      }

      // Проверяем, что челлендж активен (не провален)
      if (challenge.status !== 'active') {
        await ctx.reply(MESSAGES.CHALLENGE.ALREADY_COMPLETED);
        await stateService.sendEvent(userId, { type: 'GO_TO_START' });
        await handleStartScene(ctx);
        return;
      }

      // Проверяем, было ли уже загружено фото сегодня (для отображения сообщения)
      const alreadyUploaded = await challengeService.hasPhotoUploadedToday(userId, currentDate);
      
      // Показываем сообщение, если фото уже было загружено сегодня
      if (alreadyUploaded) {
        await ctx.reply(MESSAGES.PHOTO.ALREADY_UPLOADED);
      }

      try {
      // Проверяем размер файла (если передан)
      if (fileSize && fileSize > MAX_FILE_SIZE) {
          await ctx.reply(MESSAGES.PHOTO.FILE_TOO_LARGE);
          return;
        }
        
        // Получаем файл
        const file = await ctx.api.getFile(fileId);
        
        // Скачиваем файл с таймаутом
        const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 секунд таймаут
        
        try {
          const response = await fetch(fileUrl, {
            signal: controller.signal,
          });
          
          if (!response.ok) {
            throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
          }
          
          const imageBuffer = Buffer.from(await response.arrayBuffer());
          clearTimeout(timeoutId);
          
          // Дополнительная проверка размера буфера
          if (imageBuffer.length > MAX_FILE_SIZE) {
            await ctx.reply(MESSAGES.PHOTO.FILE_TOO_LARGE);
            return;
          }
        
        // Валидируем изображение (формат и размеры)
        const validation = await validateImage(imageBuffer);
        if (!validation.valid) {
          await ctx.reply(validation.error || MESSAGES.PHOTO.PROCESS_ERROR);
          return;
        }

          // Увеличиваем successfulDays ПЕРЕД обработкой и отправкой фото
          // Это гарантирует, что если что-то пойдет не так, мы не отправим фото без увеличения счетчика
          let wasIncremented = false;
          let updatedChallenge = challenge;
          
          if (!alreadyUploaded) {
            try {
              wasIncremented = await challengeService.incrementSuccessfulDays(userId, currentDate);
              if (wasIncremented) {
                // Получаем обновленный челлендж для правильного расчета номера дня
                updatedChallenge = await challengeService.getActiveChallenge(userId);
                if (!updatedChallenge) {
                  throw new Error('Failed to get updated challenge after increment');
                }
                logger.info(`Successfully incremented counter for user ${userId}, new successfulDays: ${updatedChallenge.successfulDays}`);
              }
            } catch (incrementError: any) {
              logger.error(`Failed to increment successfulDays for user ${userId}:`, incrementError);
              await ctx.reply(MESSAGES.PHOTO.PROCESS_ERROR);
              return;
            }
          }

          // Определяем номер дня для обработки изображения
          // Если фото уже загружено, используем текущее значение, иначе используем обновленное значение
          const dayNumber = alreadyUploaded 
            ? challenge.successfulDays 
            : updatedChallenge.successfulDays;
          
          // Обрабатываем изображение
          const processedImage = await processImage(imageBuffer, dayNumber, challenge.duration);

          // Отправляем обработанное фото
          await ctx.replyWithPhoto(new InputFile(processedImage, 'photo.jpg'), {
            caption: getRandomMotivationalPhrase(),
          });

          // Возвращаем пользователя в сцену статистики
          await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_STATS' });
          
          // Отправляем сцену статистики
          await handleChallengeStatsScene(ctx);
        } catch (fetchError: any) {
          clearTimeout(timeoutId);
          if (fetchError.name === 'AbortError') {
            logger.error(`Timeout downloading image for user ${userId}`);
            await ctx.reply('Превышено время ожидания загрузки изображения. Пожалуйста, попробуйте еще раз.');
          } else {
            throw fetchError;
          }
        }
      } catch (error: any) {
        logger.error(`Error processing image for user ${userId}:`, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        
        // Более информативное сообщение об ошибке
        if (error.message?.includes('timeout') || error.message?.includes('Timeout')) {
          await ctx.reply('Превышено время ожидания обработки изображения. Пожалуйста, попробуйте еще раз.');
        } else {
          await ctx.reply(MESSAGES.PHOTO.PROCESS_ERROR);
        }
      }
    }

    // Обрабатываем фото
    if (ctx.message?.photo) {
      const userId = ctx.from.id;
      // Любое фото (в любой сцене) отменяет уведомление "пропущен день",
      // если оно запланировано на этот же локальный день.
      try {
        const user = await userService.getUser(userId);
        const timezone = user?.timezone ?? 3;
        const receivedAtUtc = new Date(ctx.message.date * 1000);
        await notificationService.registerAnyPhotoReceived(userId, timezone, receivedAtUtc);
      } catch (e) {
        logger.warn(`Failed to register any-photo marker for user ${userId}:`, e);
      }

      // Получаем самое большое фото (обычно последнее в массиве)
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      
      // Проверяем размер файла
      if (photo.file_size && photo.file_size > MAX_FILE_SIZE) {
        await ctx.reply(MESSAGES.PHOTO.FILE_TOO_LARGE);
        return;
      }
      
      await processImageFromFile(photo.file_id, userId, photo.file_size);
      return;
    }

    // Обрабатываем документы (файлы) - проверяем, что это изображение
    if (ctx.message?.document) {
      const userId = ctx.from.id;
      const document = ctx.message.document;
      
      // Проверяем размер файла
      if (document.file_size && document.file_size > MAX_FILE_SIZE) {
        await ctx.reply(MESSAGES.PHOTO.FILE_TOO_LARGE);
        return;
      }
      
      // Проверяем, что файл является изображением по MIME типу (только JPEG, PNG, WebP)
      const imageMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      const isImageByMime = document.mime_type && imageMimeTypes.includes(document.mime_type.toLowerCase());
      
      // Проверяем по расширению файла (только JPEG, PNG, WebP)
      const fileName = document.file_name?.toLowerCase() || '';
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
      const isImageByExtension = imageExtensions.some(ext => fileName.endsWith(ext));
      
      if (isImageByMime || isImageByExtension) {
        // Любая картинка-документ (в любой сцене) отменяет уведомление "пропущен день",
        // если оно запланировано на этот же локальный день.
        try {
          const user = await userService.getUser(userId);
          const timezone = user?.timezone ?? 3;
          const receivedAtUtc = new Date(ctx.message.date * 1000);
          await notificationService.registerAnyPhotoReceived(userId, timezone, receivedAtUtc);
        } catch (e) {
          logger.warn(`Failed to register any-photo marker for user ${userId}:`, e);
        }

        await processImageFromFile(document.file_id, userId, document.file_size);
        return;
      } else {
        // Если это не изображение или неподдерживаемый формат, отправляем сообщение
        await ctx.reply(MESSAGES.PHOTO.INVALID_FORMAT);
        return;
      }
    }

    // Обрабатываем текст как отчет о пропущенной тренировке
    // Если пользователь отправил текст (не команду, не фото), и у него есть пропущенные дни
    if (ctx.message?.text && !ctx.message.text.startsWith('/')) {
      const currentScene = await stateService.getCurrentScene(userId);
      
      // Обрабатываем обратную связь
      if (currentScene === 'feedback') {
        try {
          await feedbackService.createFeedback(userId, ctx.message.text);
          
          // Отправляем подтверждение
          await ctx.reply(MESSAGES.FEEDBACK.THANKS, {
            parse_mode: 'HTML',
          });
          
          // Переводим на сцену статистики
          await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_STATS' });
          await handleChallengeStatsScene(ctx);
          return;
        } catch (error: any) {
          logger.error(`Error saving feedback for user ${userId}:`, error);
          
          // Более информативное сообщение об ошибке валидации
          if (error.message && error.message.includes('exceeds maximum length')) {
            await ctx.reply('Текст слишком длинный. Пожалуйста, отправьте более короткое сообщение.');
          } else if (error.message && error.message.includes('cannot be empty')) {
            await ctx.reply('Сообщение не может быть пустым.');
          } else {
            await ctx.reply(MESSAGES.ERROR.TEXT);
          }
          return;
        }
      }
      
      // Обрабатываем установку времени напоминаний при создании челленджа
      if (currentScene === 'reminder_time') {
        const validation = validateTime(ctx.message.text);
        
        if (validation.isValid && validation.time) {
          // Сохраняем время напоминаний
          await challengeService.updateReminderTime(userId, validation.time);
          
          // Перепланируем ежедневное уведомление
          const user = await userService.getUser(userId);
          const timezone = user?.timezone ?? 3;
          await notificationService.scheduleDailyReminder(userId, validation.time, timezone);
          
          // Перепланируем проверку пропущенных дней на новое время
          await notificationService.rescheduleMissedDaysCheck(userId, timezone);
          
          // Отменяем таймер бездействия при выходе из процесса регистрации
          idleTimerService.cancelIdleTimer(userId);
          // Переходим к сцене правил челленджа
          await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_RULES' });
          await handleChallengeRulesScene(ctx);
          return;
        } else {
          // Не удалось распарсить, просим повторить
          // Важно: после ошибки пользователь должен остаться в сцене reminder_time
          const sceneAfterError = await stateService.getCurrentScene(userId);
          if (sceneAfterError !== 'reminder_time') {
            logger.warn(`Scene lost after reminder_time parse error for user ${userId}, restoring to reminder_time`);
            await stateService.sendEvent(userId, { type: 'GO_TO_REMINDER_TIME' });
          }
          await ctx.reply(MESSAGES.TIME.PARSE_ERROR);
          return;
        }
      }

      // Обрабатываем редактирование времени напоминаний из настроек
      if (currentScene === 'edit_reminder_time') {
        const validation = validateTime(ctx.message.text);
        
        if (validation.isValid && validation.time) {
          // Сохраняем время напоминаний
          await challengeService.updateReminderTime(userId, validation.time);
          
          // Перепланируем ежедневное уведомление
          const user = await userService.getUser(userId);
          const timezone = user?.timezone ?? 3;
          await notificationService.scheduleDailyReminder(userId, validation.time, timezone);
          
          // Перепланируем проверку пропущенных дней на новое время
          await notificationService.rescheduleMissedDaysCheck(userId, timezone);
          
          // Отправляем уведомление об успехе
          await ctx.reply(MESSAGES.TIME.UPDATED);
          // Возвращаемся в настройки
          await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_SETTINGS' });
          await handleChallengeSettingsScene(ctx);
          return;
        } else {
          // Не удалось распарсить, просим повторить
          await ctx.reply(MESSAGES.TIME.PARSE_ERROR_EDIT);
          return;
        }
      }

      // Проверяем, что пользователь не в другой специальной сцене
      const specialScenes = ['timezone', 'reminder_time', 'edit_timezone', 'edit_reminder_time', 'waiting_for_photo'];
      if (!specialScenes.includes(currentScene)) {
        // Проверяем, есть ли активный челлендж и пропущенные дни
        const challenge = await challengeService.getActiveChallenge(userId);
        if (challenge && challenge.daysWithoutWorkout > 0) {
          // Сохраняем отчет
          try {
            await missedWorkoutReportService.createReport(challenge.id, ctx.message.text);
            
            // Отправляем подтверждение
            await ctx.reply(MESSAGES.REPORT.SAVED);
            
            // Переводим на сцену статистики
            await stateService.sendEvent(userId, { type: 'GO_TO_CHALLENGE_STATS' });
            await handleChallengeStatsScene(ctx);
            return;
          } catch (error: any) {
            logger.error(`Error saving missed workout report for user ${userId}:`, error);
            
            // Более информативное сообщение об ошибке валидации
            if (error.message && error.message.includes('exceeds maximum length')) {
              await ctx.reply('Текст слишком длинный. Пожалуйста, отправьте более короткое сообщение.');
            } else if (error.message && error.message.includes('cannot be empty')) {
              await ctx.reply('Сообщение не может быть пустым.');
            } else {
              await ctx.reply(MESSAGES.REPORT.SAVE_ERROR);
            }
            return;
          }
        }
      }
    }

    // Если это не команда/кнопка, просто продолжаем
    return next();
  } catch (error: any) {
    logger.error(`Error in state middleware for user ${userId}:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      userId,
    });
    
    // Пытаемся отправить сообщение об ошибке, но не блокируем, если это не удастся
    try {
      await ctx.reply(MESSAGES.ERROR.TEXT).catch((sendError) => {
        logger.error(`Failed to send error message to user ${userId}:`, sendError);
      });
    } catch (replyError) {
      logger.error(`Error sending error message to user ${userId}:`, replyError);
    }
  }

  return next();
}

