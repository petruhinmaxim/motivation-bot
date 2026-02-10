import type { Context } from 'grammy';
import { InputFile, InlineKeyboard } from 'grammy';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BUTTONS, MESSAGES } from './messages.js';
import redis from '../redis/client.js';
import { FINISH30_GIF_FILE_ID_KEY } from '../redis/keys.js';
import { challengeService } from '../services/challenge.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getFinish30AssetPath(filename: string): string {
  const projectRoot = join(__dirname, '..', '..');
  return join(projectRoot, 'assets', 'finish30', filename);
}

export async function handleFinish30Scene(ctx: Context) {
  const userId = ctx.from?.id;
  if (!userId) return;

  const chatId = ctx.chat?.id;

  if (!chatId) return;

  const challenge = await challengeService.getActiveChallenge(userId);
  const duration = challenge?.duration ?? 30;

  const keyboard = new InlineKeyboard();
  if (duration < 50) {
    keyboard.text(BUTTONS.EXTEND_CHALLENGE_50, 'extend_challenge_50').row();
  }
  if (duration < 100) {
    keyboard.text(BUTTONS.EXTEND_CHALLENGE_100, 'extend_challenge_100').row();
  }
  keyboard.text(BUTTONS.FINISH_CHALLENGE, 'finish_challenge');

  const messageOptions = {
    parse_mode: 'HTML' as const,
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  };

  let messageSent = false;
  try {
    // 1) GIF/анимация
    const cachedGifId = await redis.get(FINISH30_GIF_FILE_ID_KEY);
    if (cachedGifId) {
      await ctx.api.sendAnimation(chatId, cachedGifId);
    } else {
      const gifPath = getFinish30AssetPath('finish30.mp4');
      const animMsg = await ctx.api.sendAnimation(chatId, new InputFile(gifPath));
      const fileId = animMsg.animation?.file_id;
      if (fileId) {
        await redis.set(FINISH30_GIF_FILE_ID_KEY, fileId);
      }
    }

    // 2) Текст с кнопками
    await ctx.api.sendMessage(chatId, MESSAGES.FINISH30.TEXT, messageOptions);
    messageSent = true;

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery();
    }
  } catch (error) {
    // Пытаемся отправить: GIF → текст
    try {
      const cachedGifId = await redis.get(FINISH30_GIF_FILE_ID_KEY);
      if (cachedGifId) {
        await ctx.api.sendAnimation(chatId, cachedGifId);
      } else {
        await ctx.api.sendAnimation(chatId, new InputFile(getFinish30AssetPath('finish30.mp4')));
      }
    } catch {
      // Игнорируем
    }
    if (!messageSent) {
      await ctx.api.sendMessage(chatId, MESSAGES.FINISH30.TEXT, messageOptions);
    }

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery();
    }
  }
}
