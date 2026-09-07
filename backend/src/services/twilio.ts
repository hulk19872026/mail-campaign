import crypto from 'crypto';
import { env } from '../lib/env';
import { AppError } from '../lib/errors';

// Overridable so the integration can be exercised against a stand-in API in
// tests. Unset in production, where it is Twilio's own API.
const TWILIO_API = process.env.TWILIO_API_BASE ?? 'https://api.twilio.com';

export type OutgoingSms = {
  to: string;
  body: string;
  from: string;
  statusCallback?: string;
};

export type SmsOutcome =
  | { ok: true; id: string }
  | { ok: false; permanent: boolean; message: string; unsubscribed?: boolean };

/** Digits only, with a leading + kept, so numbers compare and dial consistently. */
export function normalizePhone(value: string): string {
  const trimmed = String(value ?? '').trim();
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (trimmed.startsWith('+')) return `+${digits}`;
  // A bare 10-digit number is North American; assume +1 so Twilio accepts it.
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

/**
 * GSM-7 fits 160 characters per segment, 153 when a message needs several.
 * Anything outside that alphabet forces UCS-2, which drops to 70 and 67. Each
 * segment is billed separately, so the editor shows this before a blast goes.
 */
export function smsSegments(body: string): { characters: number; segments: number; unicode: boolean } {
  const text = String(body ?? '');
  const gsm =
    /^[A-Za-z0-9@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà\n\r\f^{}\\[~\]|€]*$/;
  const unicode = !gsm.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  const characters = text.length;
  const segments = characters === 0 ? 0 : characters <= single ? 1 : Math.ceil(characters / multi);
  return { characters, segments, unicode };
}

/**
 * SQL comparing two phone numbers on their last ten digits.
 *
 * Stored numbers are whatever was typed ("212 555 0101"); Twilio always reports
 * E.164 ("+12125550101"). Comparing every digit makes those two different
 * numbers, so matching is done on the ten that identify the line.
 *
 * The column name is interpolated, so only pass literals from this codebase.
 */
export function phoneKeySql(column: string): string {
  return `right(regexp_replace(${column}, '[^0-9]', '', 'g'), 10)`;
}

export function twilioConfigured(): boolean {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN);
}

function authHeader(): string {
  const pair = `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`;
  return `Basic ${Buffer.from(pair).toString('base64')}`;
}

/** Sends one text. Never throws for delivery problems — it classifies them instead. */
export async function sendSms(sms: OutgoingSms): Promise<SmsOutcome> {
  if (!twilioConfigured()) {
    return {
      ok: false,
      permanent: true,
      message:
        'Twilio is not connected. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Railway, then reconnect in Settings.',
    };
  }
  const to = normalizePhone(sms.to);
  if (!to) return { ok: false, permanent: true, message: 'That customer has no usable phone number.' };
  if (!sms.from) {
    return {
      ok: false,
      permanent: true,
      message: 'No texting number is set. Add one in Settings → Texting.',
    };
  }

  const form = new URLSearchParams({ To: to, From: normalizePhone(sms.from), Body: sms.body });
  if (sms.statusCallback) form.set('StatusCallback', sms.statusCallback);

  let response: Response;
  try {
    response = await fetch(`${TWILIO_API}/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
  } catch (err) {
    // Network blip — worth retrying later.
    return { ok: false, permanent: false, message: `Could not reach Twilio: ${String(err)}` };
  }

  const payload: any = await response.json().catch(() => ({}));
  if (response.ok && payload?.sid) return { ok: true, id: payload.sid };

  const code = Number(payload?.code ?? 0);
  const message = payload?.message || `Twilio error ${response.status}`;

  // 21610 is Twilio's "this number has replied STOP". It is permanent, and the
  // number has to come off the list rather than simply being marked failed.
  if (code === 21610) {
    return { ok: false, permanent: true, unsubscribed: true, message: 'That number has replied STOP.' };
  }
  // 429 = rate limited, 5xx = their side: retry later. Everything else is a bad
  // number, a bad key or a blocked message, none of which a retry improves.
  const permanent = response.status !== 429 && response.status < 500;
  return { ok: false, permanent, message };
}

export async function testTwilioConnection(): Promise<{ connected: boolean; message: string }> {
  if (!twilioConfigured()) {
    return { connected: false, message: 'No Twilio credentials are set yet.' };
  }
  try {
    const res = await fetch(`${TWILIO_API}/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}.json`, {
      headers: { Authorization: authHeader() },
    });
    if (res.status === 401) {
      return {
        connected: false,
        message:
          'Twilio rejected the credentials — the account SID or auth token is wrong or has been rotated. Copy them again from the Twilio console.',
      };
    }
    if (!res.ok) {
      return { connected: false, message: `Twilio responded with ${res.status}. Try again shortly.` };
    }
    const data: any = await res.json().catch(() => ({}));
    const status = String(data?.status ?? '');
    if (status && status !== 'active') {
      return { connected: true, message: `Connected, but the Twilio account is ${status}, so sending will fail.` };
    }
    const name = data?.friendly_name ? ` (${data.friendly_name})` : '';
    return { connected: true, message: `Connected to Twilio${name}.` };
  } catch (err) {
    throw new AppError("Twilio couldn't be reached right now. Try again shortly.", 502, String(err));
  }
}

/**
 * Verifies a Twilio webhook signature, which is an HMAC over the full request
 * URL with the POST fields appended in sorted order.
 * Returns true when no auth token is configured, so setup is not a deadlock.
 */
export function verifyTwilioWebhook(signature: string, url: string, params: Record<string, any>): boolean {
  if (!env.TWILIO_AUTH_TOKEN) return true;
  if (!signature) return false;

  const payload = Object.keys(params ?? {})
    .sort()
    .reduce((acc, key) => acc + key + String(params[key] ?? ''), url);
  const expected = crypto
    .createHmac('sha1', env.TWILIO_AUTH_TOKEN)
    .update(Buffer.from(payload, 'utf8'))
    .digest('base64');

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
