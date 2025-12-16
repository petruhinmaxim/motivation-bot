import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { challengeService } from '../services/challenge.service.js';

export async function handleChallengeSettingsScene(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Проверяем статус напоминаний
  const challenge = await challengeService.getActiveChallenge(userId);
  const remindersEnabled = challenge?.reminderStatus ?? false;

  const messageText = 
    `Ни шагу назад, продолжительность челленджа не изменить. А вот время напоминаний всегда пожалуйста`;

  const keyboard = new InlineKeyboard()
    .text('Изменить часовой пояс', 'change_timezone')
    .row()
    .text('Изменить время уведомлений', 'change_reminder_time')
    .row();

  // Добавляем кнопку включения/отключения напоминаний
  if (remindersEnabled) {
    keyboard.text('🔕 Отключить уведомления', 'disable_reminders');
  } else {
    keyboard.text('🔔 Включить уведомления', 'enable_reminders');
  }

  keyboard.row().text('К челленджу', 'challenge_stats');

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, { reply_markup: keyboard });
  }
}
