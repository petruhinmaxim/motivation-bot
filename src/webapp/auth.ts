import crypto from 'node:crypto';

export interface WebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

export function readWebAppUser(initData: string, botToken: string): WebAppUser {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  const userRaw = params.get('user');
  const authDateRaw = params.get('auth_date');

  if (!hash || !userRaw || !authDateRaw) {
    throw new Error('Telegram init data is incomplete');
  }

  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > MAX_AUTH_AGE_SECONDS) {
    throw new Error('Telegram init data is expired');
  }

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculated = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const calculatedBuffer = Buffer.from(calculated, 'hex');
  const hashBuffer = Buffer.from(hash, 'hex');

  if (calculatedBuffer.length !== hashBuffer.length || !crypto.timingSafeEqual(calculatedBuffer, hashBuffer)) {
    throw new Error('Telegram init data signature is invalid');
  }

  const user = JSON.parse(userRaw) as Partial<WebAppUser>;
  if (!user || typeof user.id !== 'number' || typeof user.first_name !== 'string') {
    throw new Error('Telegram user is missing');
  }

  return {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
    language_code: user.language_code,
    is_premium: user.is_premium,
  };
}
