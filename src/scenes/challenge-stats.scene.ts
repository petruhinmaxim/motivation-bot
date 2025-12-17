import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { challengeService } from '../services/challenge.service.js';

export async function handleChallengeStatsScene(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Получаем данные челленджа из базы
  const challenge = await challengeService.getActiveChallenge(userId);

  if (!challenge) {
    await ctx.reply('Челлендж не найден. Начни новый челлендж!');
    return;
  }

  // Форматируем дату начала
  const startDate = new Date(challenge.startDate);
  const formattedStartDate = startDate.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // Форматируем время напоминания (обрезаем секунды, оставляем только HH:MM)
  const reminderTimeText = challenge.reminderTime 
    ? challenge.reminderTime.slice(0, 5) // Берем только первые 5 символов (HH:MM)
    : 'отключены';

  const messageText = 
    `📊 Статистика челленджа\n\n` +
    `Дата начала челленджа: ${formattedStartDate}\n` +
    `Количество дней ${challenge.successfulDays} / ${challenge.duration}\n` +
    `Пропущено дней подряд: ${challenge.daysWithoutWorkout}\n` +
    `Начало тренировки: ${reminderTimeText}`;

  const keyboard = new InlineKeyboard()
    .text('📸 Отправить фото', 'send_photo')
    .row()
    .text('⚙️ Настройки челленджа', 'challenge_settings')
    .row()
    .text('📋 Правила челленджа', 'challenge_rules');

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, { reply_markup: keyboard });
  }
}
