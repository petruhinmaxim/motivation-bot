import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';

export const infoKeyboard = new InlineKeyboard()
  .text('◀️ Назад', 'back');

export async function handleInfoScene(ctx: Context) {
  const messageText =
    `ℹ️ Информация о боте\n\n` +
    `Этот бот создан для мотивации и поддержки на пути к достижению целей.\n\n` +
    `Здесь ты сможешь:\n` +
    `• Получать ежедневные мотивационные сообщения\n` +
    `• Отслеживать свой прогресс\n` +
    `• Ставить и достигать цели\n\n` +
    `Мы верим в тебя! 💪`;

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, {
      reply_markup: infoKeyboard,
    });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, {
      reply_markup: infoKeyboard,
    });
  }
}

