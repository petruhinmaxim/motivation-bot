import { Keyboard } from 'grammy';
import type { Context } from 'grammy';

export const startKeyboard = new Keyboard()
  .text('ℹ️ Инфо')
  .text('🚀 Начать')
  .resized();

export async function handleStartScene(ctx: Context) {
  await ctx.reply(
    `👋 Привет! Добро пожаловать в бот для мотивации!\n\n` +
      `Я помогу тебе оставаться мотивированным и достигать своих целей.\n\n` +
      `Выбери действие:`,
    {
      reply_markup: startKeyboard,
    }
  );
}

