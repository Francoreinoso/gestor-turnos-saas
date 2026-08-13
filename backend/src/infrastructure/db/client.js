import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema.js';

const env = process.env.NODE_ENV || 'development';
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: env === 'production' ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool, { schema });
