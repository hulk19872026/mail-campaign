import { randomBytes } from 'crypto';
import { DateTime } from 'luxon';
import nodemailer, { type Transporter } from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { one, query } from '../lib/db';
import { env } from '../lib/env';
import { AppError } from '../lib/errors';
import { log } from '../lib/logger';
import { audit, notify } from './activity';
import { getSettings, type AppSettings } from './settings';

/**
 * Automatic cold outreach to prospects.
 *
 * Sent through a separate Google Workspace mailbox (OUTREACH_EMAIL) over Gmail's
 * own SMTP server — the same path Mailmeteor would use — and never through
 * Resend, whose policy forbids cold email. Each weekday it emails a few new
 * prospects, then follows up on day 4 and day 10 as replies in the same thread.
 * Anyone who replies or bounces drops out of the sequence.
 */

export const OUTREACH_LISTS = ['voip', 'violations', 'construction'] as const;

export type OutreachSettings = {
  enabled: boolean;
  /** Which prospect lists are emailed automatically. */
  lists: string[];
  /** New prospects emailed per weekday. Follow-ups are on top of this. */
  daily_new_limit: number;
  /** Sending window, HH:mm in the business's timezone, Monday to Friday only. */
  start_time: string;
  end_time: string;
  /** Minimum minutes between any two emails, so sends look like a person's. */
  gap_minutes: number;
  /** Adds an invisible image that records when an email is opened. */
  track_opens: boolean;
  from_name: string;
  /** Plain text added under every email. Empty = name, company and phone from Settings. */
  signature: string;
};

export const DEFAULT_OUTREACH: OutreachSettings = {
  enabled: false,
  lists: [],
  daily_new_limit: 5,
  start_time: '09:30',
  end_time: '16:00',
  gap_minutes: 10,
  track_opens: true,
  from_name: 'HULK Automation',
  signature: '',
};

/** Never more than this many emails of any kind in one day, whatever the settings say. */
const HARD_DAILY_CAP = 40;
/** Days after each email before the next one: email 2 on day 4, email 3 on day 10. */
const NEXT_GAP_DAYS: Record<number, number | null> = { 1: 3, 2: 6, 3: null };
/** Opens this soon after sending are usually a spam filter scanning the email, not a person. */
const SCANNER_SECONDS = 60;

const KEY = 'outreach';

export const outreachState = {
  lastRunAt: null as string | null,
  lastResult: '' as string,
  lastInboxCheckAt: null as string | null,
  lastInboxResult: '' as string,
  lastError: '' as string,
};

/* -------------------------------- settings -------------------------------- */

export async function getOutreachSettings(): Promise<OutreachSettings> {
  const row = await one<{ value: any }>('SELECT value FROM settings WHERE key = $1', [KEY]);
  const v: OutreachSettings = { ...DEFAULT_OUTREACH, ...(row?.value ?? {}) };
  v.enabled = v.enabled === true;
  v.lists = (Array.isArray(v.lists) ? v.lists : []).filter((l) => (OUTREACH_LISTS as readonly string[]).includes(l));
  v.daily_new_limit = clamp(Number(v.daily_new_limit) || 0, 0, 30);
  v.gap_minutes = clamp(Number(v.gap_minutes) || 0, 3, 120);
  v.start_time = hhmm(v.start_time, DEFAULT_OUTREACH.start_time);
  v.end_time = hhmm(v.end_time, DEFAULT_OUTREACH.end_time);
  v.track_opens = v.track_opens !== false;
  v.from_name = String(v.from_name ?? '').trim().slice(0, 80) || DEFAULT_OUTREACH.from_name;
  v.signature = String(v.signature ?? '').slice(0, 1000);
  return v;
}

export async function saveOutreachSettings(patch: Partial<OutreachSettings>): Promise<OutreachSettings> {
  const next = { ...(await getOutreachSettings()), ...patch };
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [KEY, JSON.stringify(next)]
  );
  return getOutreachSettings();
}

export function outreachConfigured(): boolean {
  return !!(env.OUTREACH_EMAIL && env.OUTREACH_APP_PASSWORD);
}

/** Reasons sending can't be switched on, in plain words. Empty = ready. */
export async function readinessProblems(s?: OutreachSettings, app?: AppSettings): Promise<string[]> {
  const settings = s ?? (await getOutreachSettings());
  const appSettings = app ?? (await getSettings());
  const problems: string[] = [];
  if (!outreachConfigured()) {
    problems.push('Add OUTREACH_EMAIL and OUTREACH_APP_PASSWORD in Railway → your service → Variables.');
  }
  const resendDomain = (env.RESEND_FROM_EMAIL.split('@')[1] ?? '').toLowerCase();
  const outreachDomain = (env.OUTREACH_EMAIL.split('@')[1] ?? '').toLowerCase();
  if (outreachDomain && resendDomain && outreachDomain === resendDomain) {
    problems.push(
      `OUTREACH_EMAIL is on ${outreachDomain}, the same domain your customer emails come from. Use the separate domain.`
    );
  }
  if (!appSettings.mailing_address.trim()) {
    problems.push('Add your business mailing address in Settings — the law requires it in every cold email.');
  }
  if (!settings.lists.length) problems.push('Choose at least one list to email.');
  return problems;
}

/* --------------------------------- sending -------------------------------- */

let transport: Transporter | null = null;
function mailer(): Transporter {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: env.OUTREACH_EMAIL, pass: env.OUTREACH_APP_PASSWORD },
    });
  }
  return transport;
}

function imap(): ImapFlow {
  return new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: env.OUTREACH_EMAIL, pass: env.OUTREACH_APP_PASSWORD },
    logger: false,
  });
}

/** Signs in to Gmail for sending and for reading replies, and says what failed. */
export async function verifyConnection(): Promise<{ smtp: string; imap: string }> {
  if (!outreachConfigured()) throw new AppError('Add OUTREACH_EMAIL and OUTREACH_APP_PASSWORD in Railway first.', 400);
  const result = { smtp: 'ok', imap: 'ok' };
  try {
    await mailer().verify();
  } catch (err) {
    result.smtp = friendlyError(err);
  }
  const client = imap();
  try {
    await client.connect();
    await client.logout();
  } catch (err) {
    result.imap = friendlyError(err);
  }
  return result;
}

type ProspectRow = {
  id: number;
  list: string;
  business_name: string;
  contact_name: string;
  email: string;
  address: string;
  category: string;
  sequence_step: number;
  first_subject: string;
  last_message_id: string;
};

export function firstName(contact: string): string {
  const n = String(contact ?? '').trim().replace(/^(dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i, '');
  return n.split(/\s+/)[0] ?? '';
}

/** Fills {{first_name}}, {{business_name}}, {{address}}, {{contact_name}} and {{category}}. */
export function fill(template: string, p: Pick<ProspectRow, 'business_name' | 'contact_name' | 'address' | 'category'>): string {
  const values: Record<string, string> = {
    first_name: firstName(p.contact_name) || 'there',
    contact_name: p.contact_name || 'there',
    business_name: p.business_name || 'your business',
    address: p.address || 'your building',
    category: p.category || '',
  };
  return String(template ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => values[key] ?? '');
}

function signatureFor(s: OutreachSettings, app: AppSettings): string {
  if (s.signature.trim()) return s.signature.trim();
  return [s.from_name !== app.company_name ? s.from_name : '', app.company_name, app.support_phone]
    .filter(Boolean)
    .join('\n');
}

/** The footer US law (CAN-SPAM) requires: a real postal address and a way to opt out. */
function footerFor(app: AppSettings): string {
  return `${app.mailing_address.trim()}\nIf you'd rather not hear from us, just reply "no thanks" and we won't email again.`;
}

export type Rendered = { subject: string; text: string; html: string };

export function render(
  step: number,
  stepTemplate: { subject: string; body: string },
  firstSubject: string,
  p: ProspectRow,
  s: OutreachSettings,
  app: AppSettings,
  pixelUrl?: string
): Rendered {
  const subject =
    step === 1 ? fill(stepTemplate.subject, p) : `Re: ${(firstSubject || fill(stepTemplate.subject, p)).replace(/^re:\s*/i, '')}`;
  const body = fill(stepTemplate.body, p).trim();
  const text = `${body}\n\n${signatureFor(s, app)}\n\n--\n${footerFor(app)}`;
  const para = (t: string) =>
    t
      .split(/\n{2,}/)
      .map((block) => `<p style="margin:0 0 14px">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
      .join('');
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">` +
    para(body) +
    para(signatureFor(s, app)) +
    `<p style="margin:18px 0 0;font-size:12px;color:#777">${escapeHtml(footerFor(app)).replace(/\n/g, '<br>')}</p>` +
    (pixelUrl ? `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;border:0">` : '') +
    `</div>`;
  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function stepTemplate(list: string, step: number) {
  return one<{ subject: string; body: string }>(
    `SELECT subject, body FROM outreach_steps WHERE list = $1 AND step = $2 AND btrim(body) <> ''`,
    [list, step]
  );
}

/** Prospects that may be emailed: a real address, not a customer, never unsubscribed. */
const ELIGIBLE = `
  p.email <> '' AND p.converted_customer_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM customers c WHERE lower(c.email) = lower(p.email))`;

async function nextFollowUp(lists: string[], day: string): Promise<(ProspectRow & { step: number }) | null> {
  return one(
    `SELECT p.*, p.sequence_step + 1 AS step FROM prospects p
       JOIN outreach_steps s ON s.list = p.list AND s.step = p.sequence_step + 1 AND btrim(s.body) <> ''
      WHERE p.list = ANY($1) AND ${ELIGIBLE}
        AND p.status IN ('contacted','follow_up') AND p.sequence_step IN (1,2)
        AND p.next_follow_up IS NOT NULL AND p.next_follow_up <= $2::date
      ORDER BY p.next_follow_up, p.id LIMIT 1`,
    [lists, day]
  );
}

async function nextNew(lists: string[]): Promise<(ProspectRow & { step: number }) | null> {
  return one(
    `SELECT p.*, 1 AS step FROM prospects p
       JOIN outreach_steps s ON s.list = p.list AND s.step = 1 AND btrim(s.body) <> '' AND btrim(s.subject) <> ''
      WHERE p.list = ANY($1) AND ${ELIGIBLE}
        AND p.status = 'new' AND p.sequence_step = 0
      ORDER BY p.created_at, p.id LIMIT 1`,
    [lists]
  );
}

/** Sends one email to one prospect and moves them along the sequence. */
async function sendStep(p: ProspectRow, step: number, s: OutreachSettings, app: AppSettings, day: string) {
  const template = await stepTemplate(p.list, step);
  if (!template) throw new Error(`No email ${step} written for the ${p.list} list.`);
  const token = randomBytes(16).toString('hex');
  const pixel = s.track_opens ? `${env.APP_URL}/t/p/${token}.gif` : undefined;
  const msg = render(step, template, p.first_subject, p, s, app, pixel);

  try {
    const info = await mailer().sendMail({
      from: { name: s.from_name, address: env.OUTREACH_EMAIL },
      to: p.email,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      ...(step > 1 && p.last_message_id
        ? { inReplyTo: p.last_message_id, references: [p.last_message_id] }
        : {}),
    });
    await query(
      `INSERT INTO outreach_messages (prospect_id, step, to_email, subject, message_id, token)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [p.id, step, p.email, msg.subject, info.messageId ?? '', s.track_opens ? token : '']
    );
    const gap = NEXT_GAP_DAYS[step];
    const next = gap == null ? null : DateTime.fromISO(day).plus({ days: gap }).toISODate();
    await query(
      `UPDATE prospects SET
         sequence_step = $2,
         status = $3,
         last_contacted_at = now(),
         next_follow_up = $4::date,
         last_message_id = $5,
         first_subject = CASE WHEN $2 = 1 THEN $6 ELSE first_subject END,
         updated_at = now()
       WHERE id = $1`,
      [p.id, step, step === 1 ? 'contacted' : 'follow_up', next, info.messageId ?? '', msg.subject]
    );
    await audit('prospect.emailed', { entity: 'prospect', entityId: p.id, details: { step, to: p.email } });
    return { ok: true as const };
  } catch (err) {
    const message = friendlyError(err);
    await query(
      `INSERT INTO outreach_messages (prospect_id, step, to_email, subject, error) VALUES ($1,$2,$3,$4,$5)`,
      [p.id, step, p.email, msg.subject, message.slice(0, 500)]
    );
    // Gmail refusing the address itself: never try this prospect again.
    const code = Number((err as any)?.responseCode ?? 0);
    if (code >= 550 && code < 560 && /recipient|address|user|mailbox/i.test(String((err as any)?.response ?? ''))) {
      await markBounced(p.id, 'Gmail refused the address');
      return { ok: false as const, error: message, skipped: true };
    }
    return { ok: false as const, error: message };
  }
}

async function markBounced(prospectId: number, why: string) {
  const row = await one<{ business_name: string }>(
    `UPDATE prospects SET status = 'do_not_contact', next_follow_up = NULL,
            notes = btrim(notes || E'\\n' || $2), updated_at = now()
      WHERE id = $1 AND status <> 'do_not_contact' RETURNING business_name`,
    [prospectId, `Email bounced (${DateTime.now().toISODate()}): ${why}`]
  );
  if (row) await audit('prospect.bounced', { entity: 'prospect', entityId: prospectId, details: { why } });
}

async function counts(day: string, tz: string) {
  const row = await one<{ total: string; fresh: string; last: string | null }>(
    `SELECT count(*) FILTER (WHERE error = '')::text AS total,
            count(*) FILTER (WHERE error = '' AND step = 1)::text AS fresh,
            max(sent_at)::text AS last
       FROM outreach_messages
      WHERE (sent_at AT TIME ZONE $2)::date = $1::date`,
    [day, tz]
  );
  return { total: Number(row?.total ?? 0), fresh: Number(row?.fresh ?? 0), last: row?.last ?? null };
}

export async function todayStats() {
  const app = await getSettings();
  const day = DateTime.now().setZone(app.timezone).toISODate() as string;
  const c = await counts(day, app.timezone);
  return { sentToday: c.total, newToday: c.fresh };
}

/** Why nothing would be sent right now, or '' when a send is due. */
export function windowProblem(s: OutreachSettings, now: DateTime): string {
  if (now.weekday > 5) return 'Weekend — sending resumes Monday.';
  const minutes = now.hour * 60 + now.minute;
  if (minutes < toMinutes(s.start_time)) return `Waiting for ${s.start_time}.`;
  if (minutes >= toMinutes(s.end_time)) return `Done for today (window ends ${s.end_time}).`;
  return '';
}

/**
 * One pass of the sender, run every few minutes by the scheduler. Sends at
 * most one email, so emails go out spread across the day: follow-ups that are
 * due first, then new prospects up to the daily number.
 */
export async function runOutreachPass(): Promise<string> {
  const s = await getOutreachSettings();
  if (!s.enabled) return 'Switched off.';
  const app = await getSettings();
  const problems = await readinessProblems(s, app);
  if (problems.length) return problems[0];

  const now = DateTime.now().setZone(app.timezone);
  const closed = windowProblem(s, now);
  if (closed) return closed;

  const day = now.toISODate() as string;
  const c = await counts(day, app.timezone);
  if (c.total >= HARD_DAILY_CAP) return `Reached the safety limit of ${HARD_DAILY_CAP} emails today.`;
  // Any attempt (sent or failed) counts towards the gap, so a broken login
  // doesn't retry every five minutes.
  const last = await one<{ minutes: number | null }>(
    `SELECT (EXTRACT(EPOCH FROM now() - max(sent_at)) / 60)::float AS minutes FROM outreach_messages`
  );
  if (last?.minutes != null && last.minutes < s.gap_minutes) return 'Spacing emails out.';

  let p = await nextFollowUp(s.lists, day);
  if (!p) {
    if (c.fresh >= s.daily_new_limit) return `Sent today's ${s.daily_new_limit} new emails.`;
    p = await nextNew(s.lists);
  }
  if (!p) return 'Nobody waiting to be emailed.';

  const result = await sendStep(p, Number(p.step), s, app, day);
  if (result.ok) {
    outreachState.lastError = '';
    return `Sent email ${p.step} to ${p.business_name}.`;
  }
  if (!('skipped' in result) && outreachState.lastError !== result.error) {
    await notify('error', 'Automatic prospect email failed', result.error);
  }
  outreachState.lastError = result.error;
  return `Couldn't send to ${p.business_name}: ${result.error}`;
}

/** Sends one email of a sequence to a chosen address, filled in with a sample prospect. */
export async function sendTest(list: string, step: number, to: string) {
  if (!outreachConfigured()) throw new AppError('Add OUTREACH_EMAIL and OUTREACH_APP_PASSWORD in Railway first.', 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new AppError('Enter the address to send the test to.', 400);
  const template = await stepTemplate(list, step);
  if (!template) throw new AppError(`Email ${step} for this list is empty.`, 400);
  const sample =
    (await one<ProspectRow>(`SELECT * FROM prospects WHERE list = $1 ORDER BY id LIMIT 1`, [list])) ??
    ({ id: 0, list, business_name: 'Sample Business', contact_name: 'Alex Sample', email: to, address: '123 Main St, Brooklyn, NY', category: '', sequence_step: 0, first_subject: '', last_message_id: '' } as ProspectRow);
  const s = await getOutreachSettings();
  const app = await getSettings();
  const first = step > 1 ? await stepTemplate(list, 1) : null;
  const msg = render(step, template, first ? fill(first.subject, sample) : '', sample, s, app);
  try {
    await mailer().sendMail({
      from: { name: s.from_name, address: env.OUTREACH_EMAIL },
      to,
      subject: `[TEST] ${msg.subject}`,
      text: msg.text,
      html: msg.html,
    });
  } catch (err) {
    throw new AppError(`Gmail didn't accept the test: ${friendlyError(err)}`, 400);
  }
  return { sample: sample.business_name };
}

/* ----------------------------- open tracking ------------------------------ */

export async function recordOpen(token: string): Promise<void> {
  if (!/^[a-f0-9]{32}$/.test(token)) return;
  const msg = await one<{ prospect_id: number; seconds: number }>(
    `SELECT prospect_id, EXTRACT(EPOCH FROM now() - sent_at)::int AS seconds
       FROM outreach_messages WHERE token = $1`,
    [token]
  );
  if (!msg || msg.seconds < SCANNER_SECONDS) return;
  await query(
    `UPDATE outreach_messages SET opened_at = COALESCE(opened_at, now()), open_count = open_count + 1 WHERE token = $1`,
    [token]
  );
  await query(
    `UPDATE prospects SET opened_at = COALESCE(opened_at, now()), open_count = open_count + 1 WHERE id = $1`,
    [msg.prospect_id]
  );
}

/* ------------------------- replies and bounces ---------------------------- */

const REPLY_FROM_STATUSES = ['new', 'contacted', 'follow_up'];

/**
 * Reads the outreach mailbox's inbox for the last few days. A message from a
 * prospect we've emailed (or replying to one of our emails) marks them Replied;
 * a bounce marks the address Do not contact. Safe to run repeatedly.
 */
export async function checkInbox(): Promise<string> {
  if (!outreachConfigured()) return 'Not set up.';
  const anyone = await one(`SELECT 1 FROM outreach_messages WHERE error = '' LIMIT 1`);
  if (!anyone) return 'Nothing sent yet.';

  const client = imap();
  let replies = 0;
  let bounces = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = DateTime.now().minus({ days: 3 }).toJSDate();
      const uids = await client.search({ since }, { uid: true });
      if (uids && uids.length) {
        for await (const m of client.fetch(
          uids,
          { uid: true, envelope: true, headers: ['in-reply-to', 'references', 'x-failed-recipients'] },
          { uid: true }
        )) {
          const from = (m.envelope?.from?.[0]?.address ?? '').toLowerCase();
          if (!from || from === env.OUTREACH_EMAIL) continue;
          const headers = m.headers ? m.headers.toString('utf8') : '';

          if (/^(mailer-daemon|postmaster)@/.test(from)) {
            const failed = /x-failed-recipients:\s*([^\r\n]+)/i.exec(headers)?.[1] ?? '';
            for (const address of failed.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean)) {
              const p = await one<{ id: number }>(
                `SELECT id FROM prospects WHERE lower(email) = $1 AND status <> 'do_not_contact'`,
                [address]
              );
              if (p) {
                await markBounced(p.id, 'address does not exist');
                bounces++;
              }
            }
            continue;
          }

          const refs = (headers.match(/<[^>\s]+>/g) ?? []).map((r) => r.trim());
          const p = await one<{ id: number; business_name: string }>(
            `SELECT id, business_name FROM prospects
              WHERE status = ANY($2) AND sequence_step > 0
                AND (lower(email) = $1
                     OR id IN (SELECT prospect_id FROM outreach_messages WHERE message_id = ANY($3)))
              LIMIT 1`,
            [from, REPLY_FROM_STATUSES, refs.length ? refs : ['']]
          );
          if (!p) continue;
          await query(
            `UPDATE prospects SET status = 'replied', replied_at = now(), next_follow_up = NULL, updated_at = now()
              WHERE id = $1`,
            [p.id]
          );
          await audit('prospect.replied', { entity: 'prospect', entityId: p.id, details: { from } });
          await notify('success', `${p.business_name} replied`, `Their reply is in ${env.OUTREACH_EMAIL}. Follow-ups to them have stopped.`);
          replies++;
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return `${replies} new ${replies === 1 ? 'reply' : 'replies'}, ${bounces} ${bounces === 1 ? 'bounce' : 'bounces'}.`;
}

/* --------------------------------- helpers -------------------------------- */

export function friendlyError(err: unknown): string {
  const raw = String((err as any)?.response ?? (err as any)?.message ?? err);
  if (/535|534|Invalid credentials|AUTHENTICATIONFAILED|Username and Password not accepted|application-specific password/i.test(raw)) {
    return 'Gmail rejected the login. Check OUTREACH_EMAIL, and that OUTREACH_APP_PASSWORD is an app password (needs 2-Step Verification on that Google account).';
  }
  if (/daily user sending limit|5\.4\.5/i.test(raw)) return 'Gmail says the daily sending limit is reached. It resets within 24 hours.';
  return raw.slice(0, 300);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function hhmm(value: any, fallback: string): string {
  const t = String(value ?? '');
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : fallback;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function logOutreach(result: string) {
  outreachState.lastRunAt = new Date().toISOString();
  outreachState.lastResult = result;
  if (/^Sent|Couldn't/.test(result)) log.info('Outreach pass', { result });
}
