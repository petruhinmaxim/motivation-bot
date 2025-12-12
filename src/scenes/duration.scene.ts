import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import { BUTTONS, MESSAGES } from './messages.js';

export const durationKeyboard = new InlineKeyboard()
  .text(BUTTONS.DURATION_30, 'duration_30')
  .text(BUTTONS.DURATION_60, 'duration_60')
  .text(BUTTONS.DURATION_90, 'duration_90')
  .row()
  .text(BUTTONS.POSTPONE_START, 'postpone_start')

export async function handleDurationScene(ctx: Context) {
  const messageText = MESSAGES.DURATION.TEXT;

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, {
      reply_markup: durationKeyboard,
    });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, {
      reply_markup: durationKeyboard,
    });
  }
}
