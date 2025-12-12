import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import { BUTTONS, MESSAGES } from './messages.js';

export const tomorrowKeyboard = new InlineKeyboard()
  .text(BUTTONS.START_NOW, 'start_now_tomorrow');

export async function handleTomorrowScene(ctx: Context) {
  const messageText = MESSAGES.TOMORROW.TEXT;

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, {
      reply_markup: tomorrowKeyboard,
    });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, {
      reply_markup: tomorrowKeyboard,
    });
  }
}
