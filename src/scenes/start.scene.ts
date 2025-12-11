import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';

export const startKeyboard = new InlineKeyboard()
  .text('ℹ️ Инфо', 'info')
  .text('🚀 Начать', 'begin');

export async function handleStartScene(ctx: Context) {
  const messageText =
    `👋 Привет! Добро пожаловать в бот для мотивации!\n\n` +
    `Я помогу тебе оставаться мотивированным и достигать своих целей.\n\n` +
    `Выбери действие:`;

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

