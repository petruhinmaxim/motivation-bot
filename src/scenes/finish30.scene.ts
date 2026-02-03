import type { Context } from 'grammy';
import { InputFile, InlineKeyboard, InputMediaBuilder } from 'grammy';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { BUTTONS, MESSAGES } from './messages.js';
import redis from '../redis/client.js';
import {
  FINISH30_GIF_FILE_ID_KEY,
  FINISH30_PHOTO1_FILE_ID_KEY,
  FINISH30_PHOTO2_FILE_ID_KEY,
} from '../redis/keys.js';

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

  const keyboard = new InlineKeyboard()
    .text(BUTTONS.EXTEND_CHALLENGE_50, 'extend_challenge_50')
    .row()
    .text(BUTTONS.EXTEND_CHALLENGE_100, 'extend_challenge_100')
    .row()
    .text(BUTTONS.FINISH_CHALLENGE, 'finish_challenge');

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

    // 2) Два фото альбомом (используем file_id из кэша, если есть)
    const cachedPhoto1Id = await redis.get(FINISH30_PHOTO1_FILE_ID_KEY);
    const cachedPhoto2Id = await redis.get(FINISH30_PHOTO2_FILE_ID_KEY);

    if (cachedPhoto1Id && cachedPhoto2Id) {
      const media = [
        InputMediaBuilder.photo(cachedPhoto1Id),
        InputMediaBuilder.photo(cachedPhoto2Id),
      ];
      await ctx.api.sendMediaGroup(chatId, media);
    } else {
      const photo1Path = getFinish30AssetPath('toha1.jpg');
      const photo2Path = getFinish30AssetPath('toha2.jpg');
      const media = [
        InputMediaBuilder.photo(new InputFile(photo1Path)),
        InputMediaBuilder.photo(new InputFile(photo2Path)),
      ];
      const messages = await ctx.api.sendMediaGroup(chatId, media);
      const msg0 = messages[0];
      const msg1 = messages[1];
      if (msg0 && 'photo' in msg0 && msg0.photo?.length) {
        await redis.set(FINISH30_PHOTO1_FILE_ID_KEY, msg0.photo[msg0.photo.length - 1].file_id);
      }
      if (msg1 && 'photo' in msg1 && msg1.photo?.length) {
        await redis.set(FINISH30_PHOTO2_FILE_ID_KEY, msg1.photo[msg1.photo.length - 1].file_id);
      }
    }

    // 3) Текст с кнопками
    await ctx.api.sendMessage(chatId, MESSAGES.FINISH30.TEXT, messageOptions);
    messageSent = true;

    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery();
    }
  } catch (error) {
    // Пытаемся отправить в том же порядке: GIF → фото → текст
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
    try {
      const cachedPhoto1Id = await redis.get(FINISH30_PHOTO1_FILE_ID_KEY);
      const cachedPhoto2Id = await redis.get(FINISH30_PHOTO2_FILE_ID_KEY);
      if (cachedPhoto1Id && cachedPhoto2Id) {
        await ctx.api.sendMediaGroup(chatId, [
          InputMediaBuilder.photo(cachedPhoto1Id),
          InputMediaBuilder.photo(cachedPhoto2Id),
        ]);
      } else {
        await ctx.api.sendMediaGroup(chatId, [
          InputMediaBuilder.photo(new InputFile(getFinish30AssetPath('toha1.jpg'))),
          InputMediaBuilder.photo(new InputFile(getFinish30AssetPath('toha2.jpg'))),
        ]);
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
