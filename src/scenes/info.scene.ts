import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import { BUTTONS, MESSAGES } from './messages.js';

export const infoKeyboard = new InlineKeyboard()
  .text(BUTTONS.BACK, 'back');

export async function handleInfoScene(ctx: Context) {
  const messageText = MESSAGES.INFO.TEXT;

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, {
      reply_markup: infoKeyboard,
      parse_mode: "HTML",
    });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, {
      reply_markup: infoKeyboard,
      parse_mode: "HTML",
    });
  }
}

