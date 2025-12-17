import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { BUTTONS, MESSAGES } from './messages.js';

export async function handleChallengeFailedScene(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const messageText = MESSAGES.CHALLENGE_FAILED.TEXT;

  const keyboard = new InlineKeyboard()
    .text(BUTTONS.START_NEW_CHALLENGE, 'start_new_challenge');

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, { reply_markup: keyboard });
  }
}
