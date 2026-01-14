import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { BUTTONS, MESSAGES } from './messages.js';
import { challengeService } from '../services/challenge.service.js';

export async function handleChallengeSettingsScene(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Проверяем статус напоминаний
  const challenge = await challengeService.getActiveChallenge(userId);
  const remindersEnabled = challenge?.reminderStatus ?? false;

  const messageText = MESSAGES.CHALLENGE_SETTINGS.TEXT;

  const keyboard = new InlineKeyboard()
    .text(BUTTONS.CHANGE_TIMEZONE, 'change_timezone')
    .row()
    .text(BUTTONS.CHANGE_REMINDER_TIME, 'change_reminder_time')
    .row();

  // Добавляем кнопку включения/отключения напоминаний
  if (remindersEnabled) {
    keyboard.text(BUTTONS.DISABLE_REMINDERS, 'disable_reminders');
  } else {
    keyboard.text(BUTTONS.ENABLE_REMINDERS, 'enable_reminders');
  }

  keyboard.row().text(BUTTONS.START_NEW_CHALLENGE, 'start_new_challenge_confirm')
    .row()
    .text(BUTTONS.BACK, 'challenge_stats');

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, { reply_markup: keyboard });
  }
}
