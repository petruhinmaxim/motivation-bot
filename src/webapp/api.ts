import type { IncomingMessage, ServerResponse } from 'node:http';
import type { User as TelegramUser } from 'grammy/types';
import { env } from '../utils/env.js';
import logger from '../utils/logger.js';
import { challengeService } from '../services/challenge.service.js';
import { userService } from '../services/user.service.js';
import { notificationService } from '../services/notification.service.js';
import { readWebAppUser, type WebAppUser } from './auth.js';

const DURATIONS = new Set([15, 30, 50, 100]);
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

interface StartBody {
  mode?: unknown;
  duration?: unknown;
  days?: unknown;
  time?: unknown;
  timezone?: unknown;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8192) {
        reject(new Error('Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function localDateString(date: Date, utcOffset: number): string {
  const local = new Date(date.getTime() + utcOffset * 60 * 60 * 1000);
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  return `${local.getUTCFullYear()}-${month}-${day}`;
}

function nextScheduledStart(days: number[], utcOffset: number): Date {
  const localNow = new Date(Date.now() + utcOffset * 60 * 60 * 1000);
  const year = localNow.getUTCFullYear();
  const month = localNow.getUTCMonth();
  const day = localNow.getUTCDate();

  for (let add = 1; add <= 7; add += 1) {
    const localMidnight = Date.UTC(year, month, day + add);
    if (days.includes(new Date(localMidnight).getUTCDay())) {
      return new Date(localMidnight - utcOffset * 60 * 60 * 1000);
    }
  }

  return new Date();
}

function parseDays(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const days = [...new Set(value.map(Number))];
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    return null;
  }

  return days;
}

async function challengePayload(userId: number) {
  const challenge = await challengeService.getActiveChallenge(userId);
  if (!challenge) {
    return null;
  }

  const user = await userService.getUser(userId);
  const utcOffset = user?.timezone ?? 3;
  const activityDays = (challenge.activityDays ?? '')
    .split(',')
    .filter((part) => part !== '')
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  const startMode = localDateString(challenge.startDate, utcOffset) > localDateString(new Date(), utcOffset)
    ? 'schedule'
    : 'now';

  return {
    duration: challenge.duration,
    successfulDays: challenge.successfulDays,
    reminderTime: (challenge.reminderTime ?? '15:00').slice(0, 5),
    timezoneMsk: utcOffset - 3,
    activityDays,
    startMode,
  };
}

async function saveUser(user: WebAppUser): Promise<void> {
  const telegramUser = {
    id: user.id,
    is_bot: false,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
    language_code: user.language_code,
    is_premium: user.is_premium,
  } as TelegramUser;

  await userService.saveOrUpdateUser(telegramUser);
}

export async function handleWebAppApi(req: IncomingMessage, res: ServerResponse, urlPath: string): Promise<boolean> {
  if (urlPath !== '/api/challenge') {
    return false;
  }

  try {
    const initData = req.headers['x-telegram-init-data'];
    if (typeof initData !== 'string' || initData.trim() === '') {
      sendJson(res, 401, { error: 'Telegram init data is required' });
      return true;
    }

    const user = readWebAppUser(initData, env.BOT_TOKEN);

    if (req.method === 'GET') {
      const challenge = await challengePayload(user.id);
      if (!challenge) {
        sendJson(res, 404, { error: 'Active challenge not found' });
        return true;
      }
      sendJson(res, 200, challenge);
      return true;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }

    const body = JSON.parse(await readBody(req)) as StartBody;
    const days = parseDays(body.days);
    const duration = Number(body.duration);
    const time = typeof body.time === 'string' ? body.time : '';
    const timezoneMsk = Number(body.timezone);
    const utcOffset = timezoneMsk + 3;

    if (
      (body.mode !== 'now' && body.mode !== 'schedule')
      || !DURATIONS.has(duration)
      || !days
      || !TIME_PATTERN.test(time)
      || !Number.isInteger(timezoneMsk)
      || utcOffset < -12
      || utcOffset > 14
    ) {
      sendJson(res, 400, { error: 'Invalid challenge settings' });
      return true;
    }

    await saveUser(user);

    const existing = await challengeService.getActiveChallenge(user.id);
    if (!existing) {
      await userService.updateTimezone(user.id, utcOffset);
      const startDate = body.mode === 'schedule' ? nextScheduledStart(days, utcOffset) : new Date();
      await challengeService.createOrUpdateChallenge(user.id, duration, startDate);
      await challengeService.setActivityDays(user.id, days);
      await challengeService.updateReminderTime(user.id, time);
      await notificationService.scheduleDailyReminder(
        user.id,
        time,
        utcOffset,
        body.mode === 'schedule' ? startDate : undefined,
      );
    }

    const challenge = await challengePayload(user.id);
    if (!challenge) {
      sendJson(res, 500, { error: 'Failed to save challenge' });
      return true;
    }
    sendJson(res, existing ? 200 : 201, challenge);
  } catch (error) {
    logger.error('WebApp API error:', error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Failed to save challenge' });
    }
  }

  return true;
}
