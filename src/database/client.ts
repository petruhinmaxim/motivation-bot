import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../utils/env.js';
import * as schema from './schema.js';
import logger from '../utils/logger.js';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

logger.info('Database client initialized');

