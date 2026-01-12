import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { BUTTONS, MESSAGES, MESSAGE_FUNCTIONS } from './messages.js';
import { challengeService } from '../services/challenge.service.js';
import { userService } from '../services/user.service.js';
import { notificationService } from '../services/notification.service.js';

export async function handleChallengeStatsScene(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Получаем данные челленджа из базы
  const challenge = await challengeService.getActiveChallenge(userId);

  if (!challenge) {
    const keyboard = new InlineKeyboard()
      .text(BUTTONS.START_NEW_CHALLENGE, 'begin');
    await ctx.reply(MESSAGES.CHALLENGE_STATS.NOT_FOUND, { reply_markup: keyboard });
    return;
  }

  // Форматируем дату начала
  const startDate = new Date(challenge.startDate);
  const formattedStartDate = startDate.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // Форматируем время напоминания (обрезаем секунды, оставляем только HH:MM)
  let reminderTimeText: string;
  if (challenge.reminderStatus && challenge.reminderTime) {
    // Показываем время только если уведомления включены
    reminderTimeText = challenge.reminderTime.slice(0, 5); // Берем только первые 5 символов (HH:MM)
  } else {
    // Если уведомления отключены или время не установлено - показываем "отключены"
    reminderTimeText = 'отключены';
  }

  // Получаем часовой пояс пользователя
  const user = await userService.getUser(userId);
  const timezone = user?.timezone ?? null;

  // Если уведомления включены и еще не запланированы - планируем
  if (challenge.reminderStatus) {
    if (!notificationService.hasDailyReminder(userId)) {
      const userTimezone = user?.timezone ?? 3;
      // Если время не установлено, используем 12:00 МСК по умолчанию
      const reminderTime = challenge.reminderTime 
        ? challenge.reminderTime.slice(0, 5) // HH:MM
        : '12:00'; // По умолчанию 12:00 МСК
      
      // Если время не было установлено, сохраняем его
      if (!challenge.reminderTime) {
        await challengeService.updateReminderTime(userId, reminderTime);
        // Перепланируем проверку пропущенных дней на новое время
        await notificationService.rescheduleMissedDaysCheck(userId, userTimezone);
      }
      
      await notificationService.scheduleDailyReminder(userId, reminderTime, userTimezone);
    }
  }

  const messageText = MESSAGE_FUNCTIONS.CHALLENGE_STATS_TEXT(
    formattedStartDate,
    challenge.successfulDays,
    challenge.duration,
    challenge.daysWithoutWorkout,
    reminderTimeText,
    timezone
  );

  const keyboard = new InlineKeyboard()
    .text(BUTTONS.CHALLENGE_RULES, 'challenge_rules')
    .text(BUTTONS.INFO, 'info')
    .row()
    .text(BUTTONS.CHALLENGE_SETTINGS, 'challenge_settings')
    .text(BUTTONS.FEEDBACK, 'feedback')
    .row()
    .text(BUTTONS.SEND_PHOTO, 'send_photo');

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, { reply_markup: keyboard });
  }
}
