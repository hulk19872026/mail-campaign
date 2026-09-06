import { one, query } from '../lib/db';
import { env } from '../lib/env';

export type AppSettings = {
  company_name: string;
  website: string;
  mailing_address: string;
  support_phone: string;
  /** The number the email's "Text us" button opens. Falls back to support_phone. */
  sms_number: string;
  timezone: string;
  daily_limit: number;
  batch_size: number;
  batch_delay_seconds: number;
  send_time: string; // HH:mm, 24h, in the timezone above
  scheduler_enabled: boolean;
  from_name: string;
  from_email: string;
  reply_to: string;
  logo_url: string;
  accent_color: string;
  /**
   * Which Wave business to pull customers from. Kept here rather than only in
   * WAVE_BUSINESS_ID so it can be chosen in the app: the id is not a secret, and
   * correcting it should not need an environment variable edit and a redeploy.
   */
  wave_business_id: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  company_name: 'HULK Automation',
  website: 'https://hulkautomation.com',
  mailing_address: '',
  support_phone: '',
  sms_number: '',
  timezone: 'America/New_York',
  daily_limit: 99,
  batch_size: 10,
  batch_delay_seconds: 30,
  send_time: '09:00',
  scheduler_enabled: true,
  from_name: env.RESEND_FROM_NAME || 'HULK Automation',
  from_email: env.RESEND_FROM_EMAIL || '',
  reply_to: env.RESEND_REPLY_TO || '',
  logo_url: '',
  accent_color: '#22C55E',
  wave_business_id: env.WAVE_BUSINESS_ID,
};

const KEY = 'app';
let cache: { value: AppSettings; at: number } | null = null;
const TTL_MS = 5000;

export async function getSettings(force = false): Promise<AppSettings> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const row = await one<{ value: any }>('SELECT value FROM settings WHERE key = $1', [KEY]);
  const value: AppSettings = { ...DEFAULT_SETTINGS, ...(row?.value ?? {}) };
  // Guard rails: the daily limit can be configured, but never to something unsafe.
  value.daily_limit = clamp(num(value.daily_limit, 99), 1, 500);
  value.batch_size = clamp(num(value.batch_size, 10), 1, 50);
  value.batch_delay_seconds = clamp(num(value.batch_delay_seconds, 30), 0, 3600);
  cache = { value, at: Date.now() };
  return value;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings(true);
  const next = { ...current, ...patch };
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [KEY, JSON.stringify(next)]
  );
  cache = null;
  return getSettings(true);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** Zero is a legitimate setting, so `||` would be wrong here. */
function num(value: any, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
