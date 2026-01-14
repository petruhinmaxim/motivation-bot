import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { BUTTONS, MESSAGES } from './messages.js';

export async function handleStartNewChallengeConfirmScene(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const messageText = MESSAGES.START_NEW_CHALLENGE_CONFIRM.TEXT;

  const keyboard = new InlineKeyboard()
    .text(BUTTONS.YES, 'start_new_challenge_yes')
    .text(BUTTONS.NO, 'start_new_challenge_no');

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, {
      reply_markup: keyboard,
      parse_mode: 'HTML',
    });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, {
      reply_markup: keyboard,
      parse_mode: 'HTML',
    });
  }
}
