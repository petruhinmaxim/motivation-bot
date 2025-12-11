import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';

export const beginKeyboard = new InlineKeyboard()
  .text('◀️ Назад', 'back');

export async function handleBeginScene(ctx: Context) {
  const messageText =
    `🚀 Начнем твой путь к успеху!\n\n` +
    `Ты сделал первый шаг - это уже победа! 🎉\n\n` +
    `Каждый день - это новая возможность стать лучше.\n` +
    `Помни: маленькие шаги приводят к большим результатам.\n\n` +
    `Готов начать? Тогда давай вместе достигнем твоих целей! 💫`;

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, {
      reply_markup: beginKeyboard,
    });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, {
      reply_markup: beginKeyboard,
    });
  }
}

