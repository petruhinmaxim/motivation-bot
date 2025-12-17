import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';

export async function handleChallengeFailedScene(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const messageText = 
    'Жир одержал победу. Все получится, но не с первого раза. Запускай новый челлендж!';

  const keyboard = new InlineKeyboard()
    .text('Начать новый челлендж', 'start_new_challenge');

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, { reply_markup: keyboard });
  }
}
