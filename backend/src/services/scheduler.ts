import cron from 'node-cron';
import { withClient } from '../lib/db';
import { log } from '../lib/logger';
import { processDueCampaigns, recoverStuckRecipients } from './campaigns';

const LOCK_KEY = 918_273_645;

export const schedulerState = {
  enabled: false,
  lastRunAt: null as string | null,
  lastResult: null as { sent: number; failed: number; skipped: number; reason?: string } | null,
};

/** Only one Railway instance runs a pass at a time, enforced by a PostgreSQL advisory lock. */
async function withLock<T>(fn: () => Promise<T>): Promise<T | null> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [LOCK_KEY]
    );
    if (!rows[0]?.locked) return null;
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  });
}

async function tick(): Promise<void> {
  const result = await withLock(() => processDueCampaigns());
  if (result) {
    schedulerState.lastRunAt = new Date().toISOString();
    schedulerState.lastResult = result;
    if (result.sent || result.failed) {
      log.info('Scheduler pass finished', result);
    }
  }
}

export function startScheduler(): void {
  // Every five minutes: checks the clock, the daily count, and the queue.
  cron.schedule('*/5 * * * *', () => {
    tick().catch((err) => log.error('Scheduler tick failed', { error: String(err) }));
  });
  schedulerState.enabled = true;

  // On boot, requeue anything that was mid-flight when the process stopped.
  recoverStuckRecipients()
    .then(() => tick())
    .catch((err) => log.error('Startup recovery failed', { error: String(err) }));

  log.info('Scheduler started (checks every 5 minutes)');
}

export async function runSchedulerNow() {
  const result = await withLock(() => processDueCampaigns({ force: true }));
  schedulerState.lastRunAt = new Date().toISOString();
  if (result) schedulerState.lastResult = result;
  return result ?? { sent: 0, failed: 0, skipped: 0, reason: 'A send is already running.' };
}
