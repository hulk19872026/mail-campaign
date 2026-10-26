import cron from 'node-cron';
import { withClient } from '../lib/db';
import { log } from '../lib/logger';
import { minutesNow, parseTime, processDueCampaigns, recoverStuckRecipients, today } from './campaigns';
import { getSettings } from './settings';
import {
  MAX_SYNC_ATTEMPTS_PER_DAY,
  failedSyncsToday,
  lastSuccessfulSyncDay,
  syncWaveCustomers,
  waveConfigured,
} from './wave';

const LOCK_KEY = 918_273_645;
/** A separate lock, so a long send never holds up the nightly sync or vice versa. */
const SYNC_LOCK_KEY = 918_273_646;

export const schedulerState = {
  enabled: false,
  lastRunAt: null as string | null,
  lastResult: null as { sent: number; failed: number; skipped: number; reason?: string } | null,
  lastSyncAt: null as string | null,
  lastSyncResult: null as { imported: number; updated: number; skipped: number } | { error: string } | null,
};

/** Only one Railway instance runs a pass at a time, enforced by a PostgreSQL advisory lock. */
async function withLock<T>(fn: () => Promise<T>, key = LOCK_KEY): Promise<T | null> {
  return withClient(async (client) => {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [key]
    );
    if (!rows[0]?.locked) return null;
    try {
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key]);
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

/**
 * The nightly customer sync.
 *
 * Wave is the customer list's source of truth, and it used to only be read when
 * somebody pressed "Sync customers". A campaign — a repeating one especially —
 * would then keep missing anyone added in Wave since the last time that
 * happened. This pulls the list overnight instead, before the morning's sending
 * starts.
 *
 * It is a check rather than a fixed cron time, because the hour that matters is
 * the business's own, and a cron expression is fixed to the server's. Each pass
 * asks: is it past the configured time today, and has today's sync not happened
 * yet? A sync anyone ran by hand today counts, so this stands down after one.
 */
async function syncTick(): Promise<void> {
  const settings = await getSettings(true);
  if (!settings.wave_sync_enabled) return;
  if (minutesNow(settings) < parseTime(settings.wave_sync_time)) return;

  const day = today(settings);
  if ((await lastSuccessfulSyncDay(settings.timezone)) === day) return;
  if (!(await waveConfigured())) return;
  if ((await failedSyncsToday(settings.timezone)) >= MAX_SYNC_ATTEMPTS_PER_DAY) return;

  const outcome = await withLock(async () => {
    // Checked again inside the lock: another instance may have just finished one.
    if ((await lastSuccessfulSyncDay(settings.timezone)) === day) return null;
    return syncWaveCustomers('scheduler');
  }, SYNC_LOCK_KEY).catch((err) => {
    // syncWaveCustomers has already recorded the failure and notified; this only
    // stops a rejected promise escaping the cron callback.
    log.error('Nightly Wave sync failed', { error: String(err) });
    return { error: String(err instanceof Error ? err.message : err) } as const;
  });

  if (!outcome) return;
  schedulerState.lastSyncAt = new Date().toISOString();
  if ('error' in outcome) {
    schedulerState.lastSyncResult = outcome;
    return;
  }
  schedulerState.lastSyncResult = {
    imported: outcome.imported,
    updated: outcome.updated,
    skipped: outcome.skipped,
  };
  log.info('Nightly Wave sync finished', schedulerState.lastSyncResult);
}

export function startScheduler(): void {
  // Every five minutes: checks the clock, the daily count, and the queue.
  cron.schedule('*/5 * * * *', () => {
    tick().catch((err) => log.error('Scheduler tick failed', { error: String(err) }));
  });
  schedulerState.enabled = true;

  // Every quarter of an hour: is the nightly customer sync due? Checking more
  // often than nightly is what lets a missed window — the app was asleep at 2am,
  // or only started this morning — still be caught the same day.
  cron.schedule('*/15 * * * *', () => {
    syncTick().catch((err) => log.error('Sync tick failed', { error: String(err) }));
  });

  // On boot, requeue anything that was mid-flight when the process stopped.
  recoverStuckRecipients()
    .then(() => tick())
    .catch((err) => log.error('Startup recovery failed', { error: String(err) }));

  log.info('Scheduler started (sending every 5 minutes, customer sync checked every 15)');
}

/** Runs the same check the quarter-hourly tick does, without waiting for it. */
export async function runSyncCheckNow(): Promise<void> {
  return syncTick();
}

export async function runSchedulerNow() {
  const result = await withLock(() => processDueCampaigns({ force: true }));
  schedulerState.lastRunAt = new Date().toISOString();
  if (result) schedulerState.lastResult = result;
  return result ?? { sent: 0, failed: 0, skipped: 0, reason: 'A send is already running.' };
}
