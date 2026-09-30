import type { Context } from 'grammy';
import { MESSAGES } from './messages.js';
import { createStartKeyboard } from '../webapp/button.js';

export async function handleStartScene(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const messageText = MESSAGES.START.TEXT;
  const keyboard = createStartKeyboard();

  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, {
      reply_markup: keyboard,
    });
    await ctx.answerCallbackQuery();
    return;
  }

  const removeMsg = await ctx.reply('.', {
    reply_markup: { remove_keyboard: true },
  });

  await ctx.api.deleteMessage(ctx.chat!.id, removeMsg.message_id);

  await ctx.reply(messageText, {
    reply_markup: keyboard,
  });
}
