import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import { BUTTONS, MESSAGES } from './messages.js';
import { challengeService } from '../services/challenge.service.js';

export async function handleInfoScene(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const messageText = MESSAGES.INFO.TEXT;

  // Проверяем наличие активного челленджа
  const activeChallenge = await challengeService.getActiveChallenge(userId);
  
  // Создаем клавиатуру
  const keyboard = new InlineKeyboard();
  
  // Если есть активный челлендж, добавляем кнопку "К челленджу" (без кнопки "Назад")
  if (activeChallenge) {
    keyboard.text(BUTTONS.TO_CHALLENGE, 'challenge_stats');
  } else {
    // Если нет активного челленджа, показываем кнопку "Назад"
    keyboard.text(BUTTONS.BACK, 'back');
  }

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, {
      reply_markup: keyboard,
      parse_mode: "HTML",
    });
  }
}

