import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import { BUTTONS, MESSAGES } from './messages.js';
import { challengeService } from '../services/challenge.service.js';

const SUPPORT_TELEGRAM_URL = 'https://t.me/petruhinMaks';

export const startKeyboard = new InlineKeyboard()
  .text(BUTTONS.INFO, 'info')
  .text(BUTTONS.BEGIN, 'begin')
  .row()
  .url(BUTTONS.RESTORE_CHALLENGE_DAYS, SUPPORT_TELEGRAM_URL);

export async function handleStartScene(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Проверяем наличие активного челленджа
  const activeChallenge = await challengeService.getActiveChallenge(userId);
  
  let messageText = MESSAGES.START.TEXT;
  let keyboard = startKeyboard;

  // Если есть активный челлендж, добавляем текст и кнопку
  if (activeChallenge) {
    messageText += MESSAGES.START.ACTIVE_CHALLENGE;
    keyboard = new InlineKeyboard()
      .text(BUTTONS.TO_CHALLENGE, 'challenge_stats')
      .row()
      .text(BUTTONS.INFO, 'info')
      .row()
      .url(BUTTONS.RESTORE_CHALLENGE_DAYS, SUPPORT_TELEGRAM_URL);
  }

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, {
      reply_markup: keyboard,
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
      reply_markup: keyboard,
    });
  }
}

