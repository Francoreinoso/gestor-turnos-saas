import 'dotenv/config';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../../db/migrations');

let pool;
export let db;

export async function setupDb() {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder });
}

export async function teardownDb() {
  await pool?.end();
}

// ponytail: cascade delete por FK — cada test tiene su propio account UUID,
// borrarlo limpia todo el árbol sin necesidad de rollback anidado.
// Evita el conflicto que surge cuando casos de uso llaman db.transaction() internamente.
export async function withAccount(fn) {
  const [account] = await db.insert(schema.accounts).values({ business_name: 'Test' }).returning();
  try {
    await fn(account);
  } finally {
    await db.delete(schema.accounts).where(eq(schema.accounts.id, account.id));
  }
}
