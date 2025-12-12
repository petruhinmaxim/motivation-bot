import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import { BUTTONS, MESSAGES } from './messages.js';

export const mondayKeyboard = new InlineKeyboard()
  .text(BUTTONS.START_NOW, 'start_now_monday');

export async function handleMondayScene(ctx: Context) {
  const messageText = MESSAGES.MONDAY.TEXT;

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, {
      reply_markup: mondayKeyboard,
    });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, {
      reply_markup: mondayKeyboard,
    });
  }
}
