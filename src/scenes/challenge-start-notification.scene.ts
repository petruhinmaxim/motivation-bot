import { InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import { BUTTONS } from './messages.js';

export const challengeStartNotificationKeyboard = new InlineKeyboard()
  .text(BUTTONS.TODAY, 'start_today')
  .text(BUTTONS.TOMORROW, 'start_tomorrow')
  .row()
  .text(BUTTONS.MONDAY, 'start_monday');

const NOTIFICATION_TEXT = 
  'Тук-тук. Я без звука, чтоб не отвлекать тебя, тем более я не знаю твоего часового пояса. ' +
  'Понедельник настал, тот самый, который «с понедельника» и, надеюсь, жир не победил. Когда начинаем?';

export async function handleChallengeStartNotificationScene(ctx: Context) {
  // Если это callback query (нажатие на кнопку), редактируем сообщение
  if (ctx.callbackQuery) {
    await ctx.editMessageText(NOTIFICATION_TEXT, {
      reply_markup: challengeStartNotificationKeyboard,
    });
    await ctx.answerCallbackQuery();
  } else {
    // Если это новое сообщение, отправляем новое
    await ctx.reply(NOTIFICATION_TEXT, {
      reply_markup: challengeStartNotificationKeyboard,
    });
  }
}
