import { env } from '../lib/env';
import { one, query } from '../lib/db';
import { log } from '../lib/logger';
import { AppError } from '../lib/errors';
import { audit, notify } from './activity';
import { getSettings } from './settings';

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

const CUSTOMERS_QUERY = `
  query ($businessId: ID!, $page: Int!, $pageSize: Int!) {
    business(id: $businessId) {
      id
      name
      customers(page: $page, pageSize: $pageSize) {
        pageInfo { currentPage totalPages totalCount }
        edges {
          node {
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
            }
          }
        }
      }
    }
  }
`;

export type SyncResult = {
  imported: number;
  updated: number;
  skipped: number;
  total: number;
  business: string;
};

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
  let total = 0;
  let business = '';

  try {
    let page = 1;
    let totalPages = 1;
    const pageSize = 200;

    do {
      const data = await waveRequest<any>(CUSTOMERS_QUERY, {
        businessId,
        page,
        pageSize,
      });
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
        const email = String(node.email ?? '').trim().toLowerCase();
        if (!email || !email.includes('@')) {
          skipped++;
          continue;
        }
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
            node.firstName || firstName || '',
            node.lastName || rest.join(' ') || '',
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
          // A customer with this email already exists under a different Wave ID: link them instead.
          if (String(err?.message ?? '').includes('customers_email_key')) {
            await query(
              `UPDATE customers SET wave_customer_id = $1, updated_at = now()
               WHERE lower(email) = lower($2) AND wave_customer_id IS NULL`,
              [node.id, email]
            );
            return { inserted: false };
          }
          throw err;
        });

        if (result?.inserted) imported++;
        else updated++;
      }

      page++;
    } while (page <= totalPages);

    await query(
      `UPDATE sync_runs SET status='success', imported=$2, updated=$3, skipped=$4, finished_at=now()
       WHERE id=$1`,
      [run!.id, imported, updated, skipped]
    );
    await audit('wave.sync', {
      actor,
      entity: 'wave',
      details: { imported, updated, skipped, total },
    });
    await notify(
      'success',
      'Wave sync finished',
      `${imported} new customers, ${updated} updated, ${skipped} skipped (no email address).`
    );
    log.info('Wave sync complete', { imported, updated, skipped });
    return { imported, updated, skipped, total, business };
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
    `SELECT id, status, imported, updated, skipped, error, started_at, finished_at
     FROM sync_runs WHERE source='wave' ORDER BY id DESC LIMIT 1`
  );
}
