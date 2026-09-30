import { InlineKeyboard, type Api } from 'grammy';
import { env } from '../utils/env.js';
import { BUTTONS } from '../scenes/messages.js';

function markSuccess(keyboard: InlineKeyboard): InlineKeyboard {
  const button = keyboard.inline_keyboard.at(-1)?.at(-1);
  if (button && 'web_app' in button) {
    (button as { style?: 'success' }).style = 'success';
  }
  return keyboard;
}

function webAppUrl(screen?: string): string | undefined {
  if (!env.WEBAPP_URL) {
    return undefined;
  }

  const url = new URL(env.WEBAPP_URL);
  if (screen) {
    url.searchParams.set('screen', screen);
  }
  return url.toString();
}

export function createStartKeyboard(): InlineKeyboard | undefined {
  const url = webAppUrl('settings');
  if (!url) {
    return undefined;
  }

  return markSuccess(new InlineKeyboard().webApp(BUTTONS.START, url));
}

export async function setWebAppMenuButton(api: Api): Promise<void> {
  const url = webAppUrl();
  if (!url) {
    return;
  }

  await api.setChatMenuButton({
    menu_button: {
      type: 'web_app',
      text: BUTTONS.MENU,
      web_app: { url },
    },
  });
}

export function withStartWebAppButton(keyboard: InlineKeyboard): InlineKeyboard {
  if (!env.WEBAPP_URL) {
    return keyboard;
  }

  return keyboard.row().webApp(BUTTONS.START_WEBAPP, env.WEBAPP_URL);
}
