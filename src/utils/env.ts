import { z } from 'zod';
import * as dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),

  // Preferred (already used in prod compose)
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL').optional(),

  // Alternative: construct DATABASE_URL from standard Postgres env vars
  POSTGRES_USER: z.string().min(1).optional(),
  POSTGRES_PASSWORD: z.string().min(1).optional(),
  POSTGRES_DB: z.string().min(1).optional(),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().default(5432),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // HTTP server for dashboard API
  HTTP_PORT: z.coerce.number().default(3000),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
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

// Normalize DATABASE_URL (allow either explicit DATABASE_URL or POSTGRES_* parts)
if (!env.DATABASE_URL) {
  const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_HOST, POSTGRES_PORT } = env;
  if (POSTGRES_USER && POSTGRES_PASSWORD && POSTGRES_DB) {
    env.DATABASE_URL = `postgresql://${encodeURIComponent(POSTGRES_USER)}:${encodeURIComponent(
      POSTGRES_PASSWORD
    )}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}`;
  } else {
    console.error('❌ Invalid environment variables:');
    console.error('  - DATABASE_URL is required, or POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB must be provided');
    process.exit(1);
  }
}

export { env };

