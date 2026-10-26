import { DateTime } from 'luxon';
import { env } from '../lib/env';
import { one, query } from '../lib/db';
import { log } from '../lib/logger';
import { AppError } from '../lib/errors';
import { audit, notify } from './activity';
import { AppSettings, getSettings } from './settings';

// Overridable so the sync can be exercised against a stand-in API in tests.
// Unset in production, where it is Wave's own endpoint.
const WAVE_ENDPOINT = process.env.WAVE_ENDPOINT ?? 'https://gql.waveapps.com/graphql/public';

async function waveRequest<T = any>(graphql: string, variables: Record<string, any> = {}): Promise<T> {
  if (!env.WAVE_API_TOKEN) {
    throw new AppError(
      'Wave is not connected yet. Add your Wave API token in Settings → Wave, then try again.',
      400
    );
  }
  let response: Response;
  try {
    response = await fetch(WAVE_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WAVE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: graphql, variables }),
    });
  } catch (err) {
    throw new AppError(
      "Wave couldn't be reached right now. We'll try again shortly.",
      502,
      String(err)
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new AppError(
      'Wave rejected the API token. Create a new token in Wave and paste it into Settings → Wave.',
      401
    );
  }
  if (!response.ok) {
    throw new AppError(
      `Wave returned an error (${response.status}). This is usually temporary — try again shortly.`,
      502,
      await response.text().catch(() => '')
    );
  }

  const payload = (await response.json()) as any;
  if (payload.errors?.length) {
    throw new AppError(
      'Wave refused that request. Press "Test connection" on the Integrations page to pick the right business.',
      400,
      JSON.stringify(payload.errors)
    );
  }
  return payload.data as T;
}

/**
 * The business to sync, from Settings if one was chosen there, otherwise from
 * WAVE_BUSINESS_ID. Settings wins so a wrong id can be corrected in the app.
 */
export async function resolveBusinessId(): Promise<string> {
  const chosen = (await getSettings()).wave_business_id?.trim();
  return chosen || env.WAVE_BUSINESS_ID.trim();
}

/** Wave ids are base64 of "Business:<uuid>", so a token pasted here is obvious. */
function looksLikeBusinessId(value: string): boolean {
  try {
    return Buffer.from(value, 'base64').toString('utf8').startsWith('Business:');
  } catch {
    return false;
  }
}

export async function listBusinesses(): Promise<{ id: string; name: string }[]> {
  const data = await waveRequest<any>(`
    query { businesses(page: 1, pageSize: 20) { edges { node { id name } } } }
  `);
  return (data?.businesses?.edges ?? []).map((e: any) => ({ id: e.node.id, name: e.node.name }));
}

export async function testWaveConnection(): Promise<{
  connected: boolean;
  business?: string;
  businessId?: string;
  businesses: { id: string; name: string }[];
  message: string;
}> {
  const businesses = await listBusinesses();
  if (!businesses.length) {
    return { connected: false, businesses, message: 'That token works, but no businesses are visible on it.' };
  }
  const configured = await resolveBusinessId();
  const match = configured ? businesses.find((b) => b.id === configured) : businesses[0];

  if (configured && !match) {
    // The full ids go back in `businesses` for the page to list and apply. They
    // used to appear only inside this sentence, where a toast cut them off and
    // left the one value needed to fix the problem unreadable.
    return {
      connected: false,
      businessId: configured,
      businesses,
      message: looksLikeBusinessId(configured)
        ? 'The token works, but the Business ID does not match any business on it. Pick the right one below.'
        : 'The token works, but that Business ID is not a Wave business id — it looks like something else was pasted. Pick the right one below.',
    };
  }
  return {
    connected: true,
    business: match?.name,
    businessId: match?.id,
    businesses,
    message: `Connected to ${match?.name}.`,
  };
}

/**
 * The fields every Wave schema is known to have. An address typed into any of
 * them still reaches the customer, so all of them get scanned.
 */
const BASE_FIELDS = `
            id
            name
            firstName
            lastName
            email
            phone
            mobile
            address {
              addressLine1
              addressLine2
              city
              postalCode
              province { name }
              country { name }
            }`;

/**
 * Fields that hold an address often enough to be worth asking for, but which
 * are documented outside Wave's own schema reference. Wave rejects a query
 * naming a field it does not have, which would take the whole sync down with
 * it, so the extended query is attempted once and the base one is used from
 * then on if it is refused.
 */
const EXTRA_FIELDS = `
            website
            internalNotes
            shippingDetails {
              name
              phone
              instructions
            }`;

function customersQuery(extended: boolean): string {
  return `
  query ($businessId: ID!, $page: Int!, $pageSize: Int!) {
    business(id: $businessId) {
      id
      name
      customers(page: $page, pageSize: $pageSize) {
        pageInfo { currentPage totalPages totalCount }
        edges {
          node {${BASE_FIELDS}${extended ? EXTRA_FIELDS : ''}
          }
        }
      }
    }
  }
`;
}

const EMAIL_PATTERN = /[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[^\s@<>(),;:"']+/;

/** The first email address found in a piece of text, lower-cased, or null. */
function findEmail(value: unknown): string | null {
  const match = String(value ?? '').match(EMAIL_PATTERN);
  return match ? match[0].replace(/\.+$/, '').toLowerCase() : null;
}

/**
 * The "Contact" row on a Wave customer is its first and last name, but people
 * often type the contact's email address into it instead. Pull an address out
 * of either box so a customer with an empty Email field can still be reached,
 * and keep the address out of the name fields.
 */
function contactDetails(node: any): { email: string | null; firstName: string; lastName: string } {
  const parts = [node.firstName, node.lastName].map((v) => String(v ?? '').trim());
  const email = parts.map(findEmail).find(Boolean) ?? null;
  if (!email) return { email: null, firstName: parts[0], lastName: parts[1] };
  const names = parts.filter((p) => p && !findEmail(p));
  return { email, firstName: names[0] ?? '', lastName: names[1] ?? '' };
}

/**
 * Everywhere an address can hide on a Wave customer, in the order they deserve
 * to be trusted: the Email box first, then the contact name, then the boxes
 * people use when there is nowhere obvious to put a second address.
 *
 * Wave only validates the Email field, so the rest hold whatever was typed —
 * which for hundreds of customers is the only address anyone recorded. Each is
 * scanned for something email-shaped rather than taken wholesale.
 */
function emailSources(node: any, contact: { email: string | null }): [string, unknown][] {
  const ship = node.shippingDetails ?? {};
  const addr = node.address ?? {};
  return [
    ['email', node.email],
    ['contact name', contact.email],
    ['shipping name', ship.name],
    ['shipping instructions', ship.instructions],
    ['internal notes', node.internalNotes],
    ['website', node.website],
    ['address line', [addr.addressLine1, addr.addressLine2].filter(Boolean).join(' ')],
    ['customer name', node.name],
  ];
}

/** The first address found on a customer, and which box it came out of. */
function discoverEmail(node: any, contact: { email: string | null }): { email: string; from: string } | null {
  for (const [from, value] of emailSources(node, contact)) {
    const email = findEmail(value);
    if (email) return { email, from };
  }
  return null;
}

/**
 * Whether Wave turned the query down for naming a field it does not have, as
 * opposed to being unreachable. Only the first is worth retrying with fewer
 * fields; treating a network failure that way would report the wrong cause and
 * send a second doomed request.
 */
function isUnknownFieldError(err: unknown): boolean {
  if (!(err instanceof AppError) || err.status !== 400) return false;
  return /cannot query field|unknown field|fieldundefined|undefinedfield/i.test(err.message);
}

export type SyncResult = {
  imported: number;
  updated: number;
  skipped: number;
  duplicates: number;
  total: number;
  business: string;
  /** How many addresses came out of each box, for the Integrations page. */
  foundIn: Record<string, number>;
};

type MissingCustomer = { waveId: string; name: string; reason: string; email?: string };

/** Pulls every Wave customer with a usable email address into PostgreSQL. */
export async function syncWaveCustomers(actor = 'system'): Promise<SyncResult> {
  const businessId = await resolveBusinessId();
  if (!businessId) {
    throw new AppError(
      'No Wave business is selected yet. Press "Test connection" on the Integrations page and choose one.',
      400
    );
  }

  const run = await one<{ id: number }>(
    `INSERT INTO sync_runs (source, status) VALUES ('wave', 'running') RETURNING id`
  );

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let duplicates = 0;
  let total = 0;
  let business = '';
  const foundIn: Record<string, number> = {};
  const missing: MissingCustomer[] = [];
  let extended = true;

  try {
    let page = 1;
    let totalPages = 1;
    const pageSize = 200;

    do {
      let data: any;
      try {
        data = await waveRequest<any>(customersQuery(extended), { businessId, page, pageSize });
      } catch (err) {
        // Wave refusing a field is not a reason to abandon the sync: drop the
        // extended selection and carry on with the fields every schema has.
        // Only a schema rejection though — a network failure must still surface
        // as one, rather than being reported as a missing field and retried.
        if (!extended || !isUnknownFieldError(err)) throw err;
        log.warn('Wave does not have the extended customer fields; syncing with the base fields', {
          error: String(err instanceof Error ? err.message : err),
        });
        extended = false;
        data = await waveRequest<any>(customersQuery(false), { businessId, page, pageSize });
      }
      const biz = data?.business;
      if (!biz) {
        throw new AppError(
          'That Wave business was not found on this token. Press "Test connection" and choose one.',
          400
        );
      }
      business = biz.name;
      const info = biz.customers?.pageInfo ?? { totalPages: 1 };
      totalPages = info.totalPages ?? 1;
      const edges = biz.customers?.edges ?? [];
      total += edges.length;

      for (const edge of edges) {
        const node = edge.node;
        const contact = contactDetails(node);
        const found = discoverEmail(node, contact);
        if (!found) {
          skipped++;
          missing.push({
            waveId: String(node.id ?? ''),
            name: String(node.name ?? '').trim() || 'Unnamed customer',
            reason: 'no email address in any field',
          });
          continue;
        }
        const email = found.email;
        foundIn[found.from] = (foundIn[found.from] ?? 0) + 1;
        const [firstName, ...rest] = String(node.name ?? '').trim().split(' ');
        const addr = node.address ?? {};
        const street = [addr.addressLine1, addr.addressLine2].filter(Boolean).join(', ');

        const result = await one<{ inserted: boolean }>(
          `INSERT INTO customers
             (wave_customer_id, first_name, last_name, company_name, email, phone,
              address, city, province, postal_code, country, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'wave')
           ON CONFLICT (wave_customer_id) DO UPDATE SET
             first_name   = COALESCE(NULLIF(EXCLUDED.first_name, ''), customers.first_name),
             last_name    = COALESCE(NULLIF(EXCLUDED.last_name, ''), customers.last_name),
             company_name = COALESCE(NULLIF(EXCLUDED.company_name, ''), customers.company_name),
             email        = EXCLUDED.email,
             phone        = COALESCE(NULLIF(EXCLUDED.phone, ''), customers.phone),
             address      = COALESCE(NULLIF(EXCLUDED.address, ''), customers.address),
             city         = COALESCE(NULLIF(EXCLUDED.city, ''), customers.city),
             province     = COALESCE(NULLIF(EXCLUDED.province, ''), customers.province),
             postal_code  = COALESCE(NULLIF(EXCLUDED.postal_code, ''), customers.postal_code),
             country      = COALESCE(NULLIF(EXCLUDED.country, ''), customers.country),
             updated_at   = now()
           RETURNING (xmax = 0) AS inserted`,
          [
            node.id,
            contact.firstName || firstName || '',
            contact.lastName || rest.join(' ') || '',
            node.name ?? '',
            email,
            node.phone || node.mobile || '',
            street || '',
            addr.city ?? '',
            addr.province?.name ?? '',
            addr.postalCode ?? '',
            addr.country?.name ?? '',
          ]
        ).catch(async (err: any) => {
          if (!String(err?.message ?? '').includes('customers_email_key')) throw err;
          // This address is already in the list. If it is on a row no Wave
          // customer owns yet, claim it. If another Wave customer owns it, the
          // two share an address and only one can hold it — which used to be
          // counted as an update, so the second one disappeared with nothing
          // said about it.
          const linked = await query<{ id: number }>(
            `UPDATE customers SET wave_customer_id = $1, updated_at = now()
              WHERE lower(email) = lower($2) AND wave_customer_id IS NULL
              RETURNING id`,
            [node.id, email]
          );
          if (linked.length) return { inserted: false };
          return { inserted: false, duplicate: true };
        });

        if ((result as any)?.duplicate) {
          duplicates++;
          missing.push({
            waveId: String(node.id ?? ''),
            name: String(node.name ?? '').trim() || 'Unnamed customer',
            reason: 'shares an email address with another Wave customer',
            email,
          });
        } else if (result?.inserted) imported++;
        else updated++;
      }

      page++;
    } while (page <= totalPages);

    await query(
      `UPDATE sync_runs SET status='success', imported=$2, updated=$3, skipped=$4,
              details=$5, finished_at=now()
       WHERE id=$1`,
      [
        run!.id,
        imported,
        updated,
        skipped,
        JSON.stringify({ duplicates, total, foundIn, extended, missing }),
      ]
    );
    await audit('wave.sync', {
      actor,
      entity: 'wave',
      details: { imported, updated, skipped, duplicates, total, foundIn },
    });
    const unreachable = skipped + duplicates;
    await notify(
      'success',
      'Wave sync finished',
      `${total} customers in Wave — ${imported} new, ${updated} updated` +
        (unreachable
          ? `, ${unreachable} could not be mailed (${skipped} with no email anywhere, ` +
            `${duplicates} sharing an address with another customer). The Integrations page lists them.`
          : '.')
    );
    log.info('Wave sync complete', { imported, updated, skipped, duplicates, total, foundIn });
    return { imported, updated, skipped, duplicates, total, business, foundIn };
  } catch (err) {
    await query(
      `UPDATE sync_runs SET status='failed', error=$2, finished_at=now() WHERE id=$1`,
      [run!.id, String(err instanceof Error ? err.message : err)]
    );
    await notify('error', 'Wave sync failed', String(err instanceof Error ? err.message : err));
    throw err;
  }
}

export async function lastSync() {
  return one(
    `SELECT id, status, imported, updated, skipped, error, details, started_at, finished_at
     FROM sync_runs WHERE source='wave' ORDER BY id DESC LIMIT 1`
  );
}

/** Is there a token and a business to pull from? Nothing can sync without both. */
export async function waveConfigured(): Promise<boolean> {
  return !!env.WAVE_API_TOKEN && !!(await resolveBusinessId());
}

function businessDay(when: Date, timezone: string): string | null {
  return DateTime.fromJSDate(when).setZone(timezone).toISODate();
}

/**
 * The business-local day the customer list was last pulled successfully, or
 * null if it never has been. This is what "already synced today" is decided on,
 * so a sync someone ran by hand at lunchtime counts and the nightly one stands
 * down.
 */
export async function lastSuccessfulSyncDay(timezone: string): Promise<string | null> {
  const row = await one<{ finished_at: Date | null }>(
    `SELECT finished_at FROM sync_runs
      WHERE source='wave' AND status='success' AND finished_at IS NOT NULL
      ORDER BY id DESC LIMIT 1`
  );
  return row?.finished_at ? businessDay(row.finished_at, timezone) : null;
}

/**
 * How many syncs have already failed today. Wave being down should not mean a
 * failure notification every quarter of an hour until midnight, so the nightly
 * job gives up after a few tries and waits for tomorrow.
 */
export async function failedSyncsToday(timezone: string): Promise<number> {
  const rows = await query<{ started_at: Date }>(
    `SELECT started_at FROM sync_runs
      WHERE source='wave' AND status='failed' ORDER BY id DESC LIMIT 20`
  );
  const day = DateTime.now().setZone(timezone).toISODate();
  return rows.filter((r) => businessDay(r.started_at, timezone) === day).length;
}

/** The maximum automatic attempts in one day, after which it waits for tomorrow. */
export const MAX_SYNC_ATTEMPTS_PER_DAY = 3;

/**
 * When the next automatic sync is expected, for the Integrations page. Null when
 * automatic syncing is switched off.
 */
export async function nextAutomaticSync(settings: AppSettings): Promise<string | null> {
  if (!settings.wave_sync_enabled) return null;
  const now = DateTime.now().setZone(settings.timezone);
  const [hour, minute] = settings.wave_sync_time.split(':').map((n) => parseInt(n, 10));
  const at = now.set({ hour, minute, second: 0, millisecond: 0 });

  const done = (await lastSuccessfulSyncDay(settings.timezone)) === now.toISODate();
  if (done) return at.plus({ days: 1 }).toISO();
  // Not yet done today: either it is still to come, or the window has passed and
  // the next tick will pick it up.
  return (at > now ? at : now).toISO();
}
