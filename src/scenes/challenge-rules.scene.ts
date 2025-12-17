import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { BUTTONS, MESSAGES } from './messages.js';

export async function handleChallengeRulesScene(ctx: Context) {
  const messageText = MESSAGES.CHALLENGE_RULES.TEXT;

  const keyboard = new InlineKeyboard()
    .text(BUTTONS.TO_CHALLENGE, 'challenge_stats');

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, { reply_markup: keyboard });
  }
}
