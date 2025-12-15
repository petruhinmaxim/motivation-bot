import type { Context } from 'grammy';
import { userService } from '../services/user.service.js';

export async function handleEditReminderTimeScene(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Получаем timezone пользователя из базы
  const user = await userService.getUser(userId);
  const timezoneText = user?.timezone !== null && user?.timezone !== undefined
    ? `UTC${user.timezone >= 0 ? '+' : ''}${user.timezone}`
    : 'не указан';

  const messageText = `Твой часовой пояс: ${timezoneText}. Напиши в чат новое время напоминаний, к примеру "14:00"`;

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText);
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText);
  }
}
