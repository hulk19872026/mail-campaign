import { Pool, PoolClient, QueryResultRow } from 'pg';
import { env, isProd } from './env';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  ssl: isProd && !env.DATABASE_URL.includes('railway.internal')
    ? { rejectUnauthorized: false }
    : undefined,
});

export async function query<T extends QueryResultRow = any>(
  text: string,
  params: any[] = []
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function one<T extends QueryResultRow = any>(
  text: string,
  params: any[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function transaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

export async function databaseHealthy(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
