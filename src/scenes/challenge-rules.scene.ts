import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';

export async function handleChallengeRulesScene(ctx: Context) {
  const messageText = 
    `Йееей! Осталось пройти челлендж, для этого:\n` +
    `1) Занимайся любой активностью каждый день.\n` +
    `2) Делай фото активности и загружай сюда.\n` +
    `3) Мы подготовим фото для публикации в соц сеть\n` +
    `4) Делись прогрессом с друзьями\n\n` +
    `Если 3 дня от тебя не будет фото, это значит, что жир победил и прогресс будет сброшен. Ты в любой момент сможешь начать челлендж сначала`;

  const keyboard = new InlineKeyboard()
    .text('К челленджу!', 'challenge_stats');

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, { reply_markup: keyboard });
  }
}
