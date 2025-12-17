import type { Context } from 'grammy';
import { userService } from '../services/user.service.js';
import { MESSAGE_FUNCTIONS } from './messages.js';

export async function handleReminderTimeScene(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  // Получаем timezone пользователя из базы
  const user = await userService.getUser(userId);
  const timezoneText = user?.timezone !== null && user?.timezone !== undefined
    ? `UTC${user.timezone >= 0 ? '+' : ''}${user.timezone}`
    : 'не указан';

  const messageText = MESSAGE_FUNCTIONS.REMINDER_TIME_TEXT(timezoneText);

  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(messageText);
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(messageText);
  }
}
