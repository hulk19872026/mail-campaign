import { env } from '../lib/env';
import { one, query } from '../lib/db';
import { log } from '../lib/logger';
import { AppError } from '../lib/errors';
import { audit, notify } from './activity';

const WAVE_ENDPOINT = 'https://gql.waveapps.com/graphql/public';

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
      'Wave refused that request. Check that the Business ID in Settings matches your Wave business.',
      400,
      JSON.stringify(payload.errors)
    );
  }
  return payload.data as T;
}

export async function listBusinesses(): Promise<{ id: string; name: string }[]> {
  const data = await waveRequest<any>(`
    query { businesses(page: 1, pageSize: 20) { edges { node { id name } } } }
  `);
  return (data?.businesses?.edges ?? []).map((e: any) => ({ id: e.node.id, name: e.node.name }));
}

export async function testWaveConnection(): Promise<{ connected: boolean; business?: string; message: string }> {
  const businesses = await listBusinesses();
  if (!businesses.length) {
    return { connected: false, message: 'That token works, but no businesses are visible on it.' };
  }
  const match = env.WAVE_BUSINESS_ID
    ? businesses.find((b) => b.id === env.WAVE_BUSINESS_ID)
    : businesses[0];
  if (env.WAVE_BUSINESS_ID && !match) {
    return {
      connected: false,
      message: `The token works, but no business matches WAVE_BUSINESS_ID. Available: ${businesses
        .map((b) => `${b.name} (${b.id})`)
        .join(', ')}`,
    };
  }
  return {
    connected: true,
    business: match?.name,
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
  if (!env.WAVE_BUSINESS_ID) {
    throw new AppError('Add your Wave Business ID in Settings → Wave before syncing.', 400);
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
        businessId: env.WAVE_BUSINESS_ID,
        page,
        pageSize,
      });
      const biz = data?.business;
      if (!biz) throw new AppError('That Wave Business ID was not found on this token.', 400);
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
