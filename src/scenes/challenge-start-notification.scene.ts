import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import { BUTTONS, MESSAGES } from './messages.js';

export const challengeStartNotificationKeyboard = new InlineKeyboard()
  .text(BUTTONS.TODAY, 'start_today')
  .text(BUTTONS.TOMORROW, 'start_tomorrow')
  .row()
  .text(BUTTONS.MONDAY, 'start_monday');

export async function handleChallengeStartNotificationScene(ctx: Context) {
  const messageText = MESSAGES.CHALLENGE_START_NOTIFICATION.TEXT;

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, {
      reply_markup: challengeStartNotificationKeyboard,
    });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, {
      reply_markup: challengeStartNotificationKeyboard,
    });
  }
}
