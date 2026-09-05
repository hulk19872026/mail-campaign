import { Pool, PoolClient, QueryResultRow } from 'pg';
import { env, isProd } from './env';
import { AppError } from './errors';
import { log } from './logger';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  ssl: isProd && !env.DATABASE_URL.includes('railway.internal')
    ? { rejectUnauthorized: false }
    : undefined,
});

/** Host and database name from DATABASE_URL, without the password — safe to log. */
export function databaseTarget(): string {
  try {
    const url = new URL(env.DATABASE_URL);
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
  } catch {
    return 'the address in DATABASE_URL';
  }
}

/** The connection failed before the query reached Postgres, so retrying is safe. */
function neverReachedServer(err: unknown): boolean {
  const code = (err as any)?.code ?? '';
  const message = err instanceof Error ? err.message : String(err);
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(`${code} ${message}`);
}

/** Any failure to talk to Postgres, including one that dropped mid-query. */
export function isConnectionError(err: unknown): boolean {
  const code = (err as any)?.code ?? '';
  const message = err instanceof Error ? err.message : String(err);
  return (
    neverReachedServer(err) ||
    /ETIMEDOUT|ECONNRESET|EPIPE|Connection terminated|server closed the connection|timeout exceeded when trying to connect/i.test(
      `${code} ${message}`
    )
  );
}

function unreachable(err: unknown): AppError {
  return new AppError(
    "The database isn't reachable right now. It usually comes back on its own within a " +
      'minute — if it does not, check that the database service is running.',
    503,
    `Database ${databaseTarget()} unreachable: ${err instanceof Error ? err.message : String(err)}`
  );
}

// node-postgres reports failures on idle pooled connections through the pool. With
// no listener attached that surfaces as an uncaught exception and takes the whole
// process down, so a Postgres restart would knock the app offline instead of
// costing it one connection.
pool.on('error', (err) => {
  log.error('An idle database connection dropped', {
    database: databaseTarget(),
    error: String(err?.message ?? err),
  });
});

export async function query<T extends QueryResultRow = any>(
  text: string,
  params: any[] = []
): Promise<T[]> {
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await pool.query<T>(text, params);
      return result.rows;
    } catch (err) {
      // Only retry when nothing reached Postgres. A statement that may have run
      // must never be sent a second time.
      if (attempt >= maxAttempts || !neverReachedServer(err)) {
        throw isConnectionError(err) ? unreachable(err) : err;
      }
      log.warn(
        `Database ${databaseTarget()} did not answer — retrying (${attempt} of ${maxAttempts - 1})`
      );
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
}

export async function one<T extends QueryResultRow = any>(
  text: string,
  params: any[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (err) {
    throw isConnectionError(err) ? unreachable(err) : err;
  }
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
      // A rollback on a dropped connection throws too — never let it hide the
      // failure that actually caused it.
      await client.query('ROLLBACK').catch(() => undefined);
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
