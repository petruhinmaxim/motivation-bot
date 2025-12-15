import type { Context } from 'grammy';
import { MESSAGES } from './messages.js';

export async function handleTimezoneScene(ctx: Context) {
  const messageText = MESSAGES.TIMEZONE.TEXT;

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText);
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText);
  }
}
