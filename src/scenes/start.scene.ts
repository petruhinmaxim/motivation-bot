import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import { BUTTONS, MESSAGES } from './messages.js';

export const startKeyboard = new InlineKeyboard()
  .text(BUTTONS.INFO, 'info')
  .text(BUTTONS.BEGIN, 'begin');

export async function handleStartScene(ctx: Context) {
  const messageText = MESSAGES.START.TEXT;

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, {
      reply_markup: startKeyboard,
    });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение (команда /start), сначала удаляем reply keyboard
    const removeMsg = await ctx.reply('.', {
      reply_markup: { remove_keyboard: true },
    });
    
    // Удаляем временное сообщение
    await ctx.api.deleteMessage(ctx.chat!.id, removeMsg.message_id);
    
    // Затем отправляем основное сообщение с inline кнопками
    await ctx.reply(messageText, {
      reply_markup: startKeyboard,
    });
  }
}

