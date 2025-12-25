import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import { BUTTONS, MESSAGES } from './messages.js';

export const beginKeyboard = new InlineKeyboard()
  .text(BUTTONS.TODAY, 'start_today')
  .text(BUTTONS.TOMORROW, 'start_tomorrow')
  .row()
  .text(BUTTONS.MONDAY, 'start_monday')

export async function handleBeginScene(ctx: Context) {
  const messageText = MESSAGES.BEGIN.TEXT;

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, {
      reply_markup: beginKeyboard,
      parse_mode: "HTML",
    });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, {
      reply_markup: beginKeyboard,
      parse_mode: "HTML",
    });
  }
}

