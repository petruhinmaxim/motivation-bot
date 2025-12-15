import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';

export async function handleChallengeSettingsScene(ctx: Context) {
  const messageText = 
    `Ни шагу назад, продолжительность челленджа не изменить. А вот время напоминаний всегда пожалуйста`;

  const keyboard = new InlineKeyboard()
    .text('Изменить часовой пояс', 'change_timezone')
    .row()
    .text('Изменить время уведомлений', 'change_reminder_time')
    .row()
    .text('К челленджу', 'challenge_stats');

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText, { reply_markup: keyboard });
  }
}
