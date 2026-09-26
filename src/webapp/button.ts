import { InlineKeyboard } from 'grammy';
import { env } from '../utils/env.js';
import { BUTTONS } from '../scenes/messages.js';

export function withStartWebAppButton(keyboard: InlineKeyboard): InlineKeyboard {
  if (!env.WEBAPP_URL) {
    return keyboard;
  }

  return keyboard.row().webApp(BUTTONS.START_WEBAPP, env.WEBAPP_URL);
}
