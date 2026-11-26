import { one, query } from '../lib/db';
import { AppError } from '../lib/errors';

/**
 * The do-not-contact list: email addresses and whole domains that never get
 * cold email, whatever their prospect status says. Checked by the automatic
 * sender, the CSV export and the importers.
 */

/** SQL that is true when the email in `column` is blocked by address or by domain. */
export function blockedSql(column: string): string {
  return `EXISTS (SELECT 1 FROM do_not_contact d
                   WHERE lower(d.value) = lower(${column})
                      OR lower(d.value) = split_part(lower(${column}), '@', 2))`;
}

/** Blocking one of these would block thousands of unrelated businesses. */
const SHARED_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'aol.com', 'outlook.com', 'hotmail.com', 'live.com',
  'msn.com', 'icloud.com', 'me.com', 'mac.com', 'verizon.net', 'optonline.net', 'comcast.net',
  'att.net', 'protonmail.com', 'proton.me', 'ymail.com', 'mail.com',
]);

/** "Info@Acme.com" stays an address; "@acme.com", "acme.com" or "https://www.acme.com/" become "acme.com". */
export function normalizeEntry(raw: any): { value: string; kind: 'email' | 'domain' } {
  let v = String(raw ?? '').trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { value: v, kind: 'email' };
  v = v.replace(/^@/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v)) {
    throw new AppError('Enter an email address (name@business.com) or a domain (business.com).', 400);
  }
  if (SHARED_DOMAINS.has(v)) {
    throw new AppError(`${v} is shared by millions of people — block the person's full email address instead.`, 400);
  }
  return { value: v, kind: 'domain' };
}

export async function addToDnc(raw: string, reason: string, addedBy: string) {
  const { value, kind } = normalizeEntry(raw);
  const row = await one(
    `INSERT INTO do_not_contact (value, reason, added_by) VALUES ($1, $2, $3)
     ON CONFLICT (lower(value)) DO NOTHING RETURNING *`,
    [value, reason.slice(0, 200), addedBy]
  );
  // Anyone on a prospect list it covers stops being emailed straight away.
  const touched = await query<{ id: number }>(
    `UPDATE prospects p SET status = 'do_not_contact', next_follow_up = NULL, updated_at = now()
      WHERE p.email <> '' AND p.status <> 'do_not_contact' AND ${blockedSql('p.email')}
      RETURNING p.id`
  );
  return { entry: row, kind, prospectsUpdated: touched.length, alreadyListed: !row };
}

/** For prospects set to Do not contact by hand or by a bounce: keep them blocked for good. */
export async function rememberProspectEmail(email: string, reason: string, addedBy = 'system') {
  const e = String(email ?? '').trim().toLowerCase();
  if (!e) return;
  await query(
    `INSERT INTO do_not_contact (value, reason, added_by) VALUES ($1, $2, $3) ON CONFLICT (lower(value)) DO NOTHING`,
    [e, reason.slice(0, 200), addedBy]
  );
}

export async function isBlocked(email: string): Promise<boolean> {
  if (!email) return false;
  return !!(await one(`SELECT 1 WHERE ${blockedSql('$1::text')}`, [email]));
}
