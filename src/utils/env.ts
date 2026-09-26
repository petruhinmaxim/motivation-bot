import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config();

const httpsUrl = z
  .string()
  .url()
  .refine((value) => value.startsWith('https://'), {
    message: 'WEBAPP_URL must be an https URL',
  });

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  WEBAPP_PORT: z.coerce.number().int().positive().default(3002),
  WEBAPP_URL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    httpsUrl.optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

let env: Env;

try {
  env = envSchema.parse(process.env);
} catch (error: unknown) {
  if (error instanceof z.ZodError) {
    console.error('❌ Invalid environment variables:');
    error.errors.forEach((err) => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`);
    });
    process.exit(1);
  }
  throw error;
}

export { env };

