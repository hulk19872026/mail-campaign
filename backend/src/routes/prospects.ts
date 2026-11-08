import { Router } from 'express';
import { one, query } from '../lib/db';
import { actorOf, handler, intParam } from '../lib/http';
import { AppError } from '../lib/errors';
import { audit } from '../services/activity';
import { parseCsv } from './customers';

/**
 * Prospects are businesses that have never asked to hear from us. This router
 * stores, tracks and exports them — it deliberately has no way to email them.
 * Resend's policy forbids cold outreach and a breach would shut down the
 * account customers' mail goes through, so cold email is sent from a separate
 * domain with Mailmeteor using the CSV exported here.
 */
export const prospectsRouter = Router();

export const PROSPECT_LISTS = ['voip', 'violations', 'construction'] as const;
export const PROSPECT_STATUSES = [
  'new',
  'contacted',
  'follow_up',
  'replied',
  'meeting',
  'quoted',
  'won',
  'lost',
  'do_not_contact',
] as const;

/** Statuses that must never land in an outreach export. */
const NO_OUTREACH = ['replied', 'meeting', 'quoted', 'won', 'lost', 'do_not_contact'];

/** Days until the next touch after an email goes out — matches the day 1 / 4 / 10 sequence. */
const FOLLOW_UP_DAYS: Record<string, number> = { contacted: 3, follow_up: 6 };

function listOf(value: any): string {
  const v = String(value ?? '').trim();
  return (PROSPECT_LISTS as readonly string[]).includes(v) ? v : 'voip';
}

function statusOf(value: any): string | null {
  const v = String(value ?? '').trim();
  return (PROSPECT_STATUSES as readonly string[]).includes(v) ? v : null;
}

function text(value: any): string {
  return String(value ?? '').trim();
}

function emailOf(value: any): string {
  const v = text(value).toLowerCase();
  if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    throw new AppError(`"${v}" doesn't look like an email address.`, 400);
  }
  return v;
}

// Joined onto every listing so the page can warn when a prospect is already a
// customer or has unsubscribed from us — both must stay out of cold outreach.
const SELECT_PROSPECTS = `
  SELECT p.*,
         to_char(p.next_follow_up, 'YYYY-MM-DD') AS next_follow_up,
         c.id AS customer_id,
         COALESCE(c.marketing_opt_out, false) AS customer_opted_out
    FROM prospects p
    LEFT JOIN customers c ON p.email <> '' AND lower(c.email) = lower(p.email)`;

prospectsRouter.get(
  '/',
  handler(async (req, res) => {
    const list = listOf(req.query.list);
    const params: any[] = [list];
    let where = 'p.list = $1';
    const status = statusOf(req.query.status);
    if (status) {
      params.push(status);
      where += ` AND p.status = $${params.length}`;
    }
    const search = text(req.query.search).toLowerCase();
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (lower(p.business_name) LIKE $${params.length} OR lower(p.contact_name) LIKE $${params.length}
        OR lower(p.email) LIKE $${params.length} OR lower(p.category) LIKE $${params.length}
        OR lower(p.address) LIKE $${params.length})`;
    }
    const prospects = await query(
      `${SELECT_PROSPECTS} WHERE ${where}
        ORDER BY (p.next_follow_up IS NULL), p.next_follow_up, p.created_at DESC, p.id DESC`,
      params
    );
    const counts = await query<{ list: string; status: string; count: string }>(
      `SELECT list, status, count(*)::text AS count FROM prospects GROUP BY list, status`
    );
    const due = await one<{ count: string }>(
      `SELECT count(*)::text AS count FROM prospects
        WHERE list = $1 AND next_follow_up <= current_date AND status IN ('contacted','follow_up')`,
      [list]
    );
    res.json({ prospects, counts, dueToday: Number(due?.count ?? 0) });
  })
);

prospectsRouter.post(
  '/',
  handler(async (req, res) => {
    const b = req.body ?? {};
    const business = text(b.business_name);
    if (!business) throw new AppError('Give the business a name.', 400);
    const row = await one(
      `INSERT INTO prospects (list, business_name, contact_name, email, phone, address, category, notes, source_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *, to_char(next_follow_up, 'YYYY-MM-DD') AS next_follow_up`,
      [
        listOf(b.list),
        business,
        text(b.contact_name),
        emailOf(b.email),
        text(b.phone),
        text(b.address),
        text(b.category),
        text(b.notes),
        text(b.source_url),
      ]
    ).catch((err) => {
      if (err?.code === '23505') throw new AppError('A prospect with that email is already on a list.', 400);
      throw err;
    });
    await audit('prospect.created', { actor: actorOf(req), entity: 'prospect', entityId: (row as any).id });
    res.json({ prospect: row });
  })
);

/** CSV in, one prospect per row. Columns are matched loosely so a Google Maps or Hunter export works as is. */
prospectsRouter.post(
  '/import/csv',
  handler(async (req, res) => {
    const list = listOf(req.body?.list);
    const raw = String(req.body?.csv ?? '');
    if (!raw.trim()) throw new AppError('Paste or upload a CSV with at least a business name column.', 400);
    const rows = parseCsv(raw);
    if (!rows.length) throw new AppError('No rows were found in that CSV.', 400);

    let added = 0;
    let duplicates = 0;
    let skipped = 0;
    for (const r of rows) {
      const business = text(r.business_name ?? r.business ?? r.company ?? r.company_name ?? r.name);
      let email = text(r.email ?? r.email_address).toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = '';
      if (!business && !email) {
        skipped++;
        continue;
      }
      const inserted = await one(
        `INSERT INTO prospects (list, business_name, contact_name, email, phone, address, category, notes, source_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT DO NOTHING RETURNING id`,
        [
          list,
          business || email,
          text(r.contact_name ?? r.contact ?? r.first_name),
          email,
          text(r.phone ?? r.phone_number),
          text(r.address ?? r.street),
          text(r.category ?? r.type),
          text(r.notes),
          text(r.source_url ?? r.website ?? r.source),
        ]
      );
      if (inserted) added++;
      else duplicates++;
    }
    await audit('prospect.import', { actor: actorOf(req), details: { list, added, duplicates, skipped } });
    res.json({ added, duplicates, skipped });
  })
);

/**
 * The file Mailmeteor sends from. Only prospects that are still worth a cold
 * email are included: they have an address, haven't replied or been closed,
 * aren't already customers, and have never unsubscribed from us.
 */
prospectsRouter.get(
  '/export/csv',
  handler(async (req, res) => {
    const list = listOf(req.query.list);
    const rows = await query(
      `${SELECT_PROSPECTS}
        WHERE p.list = $1 AND p.email <> '' AND p.status <> ALL($2::text[]) AND c.id IS NULL
        ORDER BY p.business_name`,
      [list, NO_OUTREACH]
    );
    const header = 'email,first_name,contact_name,business_name,phone,address,category,status';
    const body = rows
      .map((r: any) =>
        [
          r.email,
          firstName(r.contact_name),
          r.contact_name,
          r.business_name,
          r.phone,
          r.address,
          r.category,
          r.status,
        ]
          .map(csvCell)
          .join(',')
      )
      .join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="hulk-prospects-${list}.csv"`);
    res.send(`${header}\n${body}`);
  })
);

prospectsRouter.put(
  '/:id',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    const b = req.body ?? {};
    const current = await one<any>('SELECT * FROM prospects WHERE id = $1', [id]);
    if (!current) throw new AppError('That prospect was not found.', 404);

    const status = b.status !== undefined ? statusOf(b.status) : null;
    if (b.status !== undefined && !status) throw new AppError('That status is not recognised.', 400);

    // Logging an email moves the follow-up date forward; closing a prospect clears it.
    let nextFollowUp: string | null | undefined = b.next_follow_up === undefined ? undefined : text(b.next_follow_up) || null;
    let touched = false;
    if (status && status !== current.status) {
      if (FOLLOW_UP_DAYS[status] !== undefined) {
        touched = true;
        if (nextFollowUp === undefined) {
          const d = new Date();
          d.setDate(d.getDate() + FOLLOW_UP_DAYS[status]);
          nextFollowUp = d.toISOString().slice(0, 10);
        }
      } else if (NO_OUTREACH.includes(status) && nextFollowUp === undefined) {
        nextFollowUp = null;
      }
    }

    const row = await one(
      `UPDATE prospects SET
         status        = COALESCE($2, status),
         business_name = COALESCE($3, business_name),
         contact_name  = COALESCE($4, contact_name),
         email         = COALESCE($5, email),
         phone         = COALESCE($6, phone),
         address       = COALESCE($7, address),
         category      = COALESCE($8, category),
         notes         = COALESCE($9, notes),
         next_follow_up = CASE WHEN $10 THEN $11::date ELSE next_follow_up END,
         last_contacted_at = CASE WHEN $12 THEN now() ELSE last_contacted_at END,
         updated_at = now()
       WHERE id = $1 RETURNING *, to_char(next_follow_up, 'YYYY-MM-DD') AS next_follow_up`,
      [
        id,
        status,
        b.business_name !== undefined ? text(b.business_name) || null : null,
        b.contact_name !== undefined ? text(b.contact_name) : null,
        b.email !== undefined ? emailOf(b.email) : null,
        b.phone !== undefined ? text(b.phone) : null,
        b.address !== undefined ? text(b.address) : null,
        b.category !== undefined ? text(b.category) : null,
        b.notes !== undefined ? text(b.notes) : null,
        nextFollowUp !== undefined,
        nextFollowUp ?? null,
        touched,
      ]
    ).catch((err) => {
      if (err?.code === '23505') throw new AppError('Another prospect already uses that email.', 400);
      throw err;
    });
    await audit('prospect.updated', {
      actor: actorOf(req),
      entity: 'prospect',
      entityId: id,
      details: status ? { status } : undefined,
    });
    res.json({ prospect: row });
  })
);

prospectsRouter.delete(
  '/:id',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    await query('DELETE FROM prospects WHERE id = $1', [id]);
    await audit('prospect.deleted', { actor: actorOf(req), entity: 'prospect', entityId: id });
    res.json({ ok: true });
  })
);

/**
 * Moves a prospect into the customer list that Resend campaigns go to. Never
 * automatic — it happens only when someone presses the button on a Won prospect.
 */
prospectsRouter.post(
  '/:id/convert',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    const p = await one<any>('SELECT * FROM prospects WHERE id = $1', [id]);
    if (!p) throw new AppError('That prospect was not found.', 404);
    if (!p.email) throw new AppError('Add an email address before making them a customer.', 400);
    // Prospects stay out of the customer base until they actually buy: a reply
    // or a quote is not enough. Only a Won prospect can be moved across.
    if (p.status !== 'won') {
      throw new AppError('Only a prospect marked Won can join your customer list. Set their status to Won first.', 400);
    }
    const [first, ...rest] = text(p.contact_name).split(/\s+/);
    const customer = await one<any>(
      `INSERT INTO customers (first_name,last_name,company_name,email,phone,address,source)
       VALUES ($1,$2,$3,$4,$5,$6,'prospect')
       ON CONFLICT (lower(email)) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [first ?? '', rest.join(' '), p.business_name, p.email.toLowerCase(), p.phone, p.address]
    );
    await query('UPDATE prospects SET converted_customer_id = $2, updated_at = now() WHERE id = $1', [
      id,
      customer!.id,
    ]);
    await audit('prospect.converted', {
      actor: actorOf(req),
      entity: 'prospect',
      entityId: id,
      details: { customerId: customer!.id },
    });
    res.json({ ok: true, customerId: customer!.id });
  })
);

function firstName(contact: string): string {
  const n = text(contact).replace(/^(dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i, '');
  return n.split(/\s+/)[0] ?? '';
}

function csvCell(value: any): string {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
