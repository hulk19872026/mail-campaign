import { Router } from 'express';
import { one, query } from '../lib/db';
import { actorOf, handler, intParam } from '../lib/http';
import { AppError } from '../lib/errors';
import { audit } from '../services/activity';

export const customersRouter = Router();

customersRouter.get(
  '/',
  handler(async (req, res) => {
    const search = String(req.query.search ?? '').trim();
    const status = String(req.query.status ?? 'all');
    const sort = String(req.query.sort ?? 'name');
    const page = Math.max(1, intParam(req.query.page, 1));
    const pageSize = Math.min(200, Math.max(10, intParam(req.query.pageSize, 50)));

    const params: any[] = [];
    let where = '1=1';
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      where += ` AND (lower(first_name || ' ' || last_name) LIKE $${params.length}
        OR lower(company_name) LIKE $${params.length}
        OR lower(email) LIKE $${params.length}
        OR phone LIKE $${params.length})`;
    }
    if (status === 'active') where += ` AND status='active' AND marketing_opt_out=false`;
    if (status === 'disabled') where += ` AND status='disabled'`;
    if (status === 'unsubscribed') where += ` AND marketing_opt_out=true`;
    if (status === 'sms_ready')
      where += ` AND sms_opt_in=true AND phone <> '' AND status='active' AND marketing_opt_out=false`;
    if (status === 'sms_missing') where += ` AND sms_opt_in=false AND phone <> ''`;

    const orderBy =
      sort === 'recent'
        ? 'created_at DESC'
        : sort === 'last_email'
        ? 'last_emailed_at DESC NULLS LAST'
        : sort === 'company'
        ? 'company_name ASC'
        : "first_name ASC, last_name ASC";

    params.push(pageSize, (page - 1) * pageSize);
    const rows = await query(
      `SELECT c.*,
        (SELECT count(*) FROM campaign_recipients r WHERE r.customer_id = c.id AND r.status='sent') AS campaigns_sent
       FROM customers c WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const totalRow = await one<{ count: string }>(
      `SELECT count(*)::text AS count FROM customers WHERE ${where}`,
      params.slice(0, params.length - 2)
    );

    res.json({ customers: rows, total: Number(totalRow?.count ?? 0), page, pageSize });
  })
);

customersRouter.get(
  '/:id',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    const customer = await one('SELECT * FROM customers WHERE id = $1', [id]);
    if (!customer) throw new AppError('That customer was not found.', 404);

    const stats = await one<any>(
      `SELECT
        count(*) FILTER (WHERE type='sent')    AS sent,
        count(*) FILTER (WHERE type='opened')  AS opened,
        count(*) FILTER (WHERE type='clicked') AS clicked,
        count(*) FILTER (WHERE type='bounced') AS bounced
       FROM email_events WHERE customer_id = $1`,
      [id]
    );
    const history = await query(
      `SELECT r.id, r.status, r.sent_at, r.opened_at, r.clicked_at, r.error_message,
              c.name AS campaign_name, c.id AS campaign_id
       FROM campaign_recipients r
       JOIN campaigns c ON c.id = r.campaign_id
       WHERE r.customer_id = $1 ORDER BY r.id DESC LIMIT 25`,
      [id]
    );
    res.json({ customer, stats, history });
  })
);

customersRouter.post(
  '/',
  handler(async (req, res) => {
    const b = req.body ?? {};
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!email.includes('@')) throw new AppError('Enter a valid email address.', 400);
    const row = await one(
      `INSERT INTO customers (first_name,last_name,company_name,email,phone,address,city,province,postal_code,country,source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual') RETURNING *`,
      [
        b.first_name ?? '',
        b.last_name ?? '',
        b.company_name ?? '',
        email,
        b.phone ?? '',
        b.address ?? '',
        b.city ?? '',
        b.province ?? '',
        b.postal_code ?? '',
        b.country ?? '',
      ]
    ).catch(() => {
      throw new AppError('A customer with that email address already exists.', 400);
    });
    await audit('customer.created', { actor: actorOf(req), entity: 'customer', entityId: (row as any).id });
    res.json({ customer: row });
  })
);

customersRouter.put(
  '/:id',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    const b = req.body ?? {};
    const row = await one(
      `UPDATE customers SET
         first_name=COALESCE($2,first_name), last_name=COALESCE($3,last_name),
         company_name=COALESCE($4,company_name), email=COALESCE($5,email), phone=COALESCE($6,phone),
         address=COALESCE($7,address), city=COALESCE($8,city), province=COALESCE($9,province),
         postal_code=COALESCE($10,postal_code), country=COALESCE($11,country),
         status=COALESCE($12,status), marketing_opt_out=COALESCE($13,marketing_opt_out),
         sms_opt_in=COALESCE($14,sms_opt_in),
         sms_opt_in_at = CASE WHEN $14 IS TRUE AND sms_opt_in = false THEN now()
                              WHEN $14 IS FALSE THEN sms_opt_in_at ELSE sms_opt_in_at END,
         sms_opt_out_at = CASE WHEN $14 IS FALSE THEN now() ELSE sms_opt_out_at END,
         updated_at=now()
       WHERE id=$1 RETURNING *`,
      [
        id,
        b.first_name ?? null,
        b.last_name ?? null,
        b.company_name ?? null,
        b.email ? String(b.email).toLowerCase() : null,
        b.phone ?? null,
        b.address ?? null,
        b.city ?? null,
        b.province ?? null,
        b.postal_code ?? null,
        b.country ?? null,
        b.status ?? null,
        typeof b.marketing_opt_out === 'boolean' ? b.marketing_opt_out : null,
        typeof b.sms_opt_in === 'boolean' ? b.sms_opt_in : null,
      ]
    );
    if (!row) throw new AppError('That customer was not found.', 404);
    await audit('customer.updated', { actor: actorOf(req), entity: 'customer', entityId: id });
    res.json({ customer: row });
  })
);

customersRouter.delete(
  '/:id',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    await query('DELETE FROM customers WHERE id = $1', [id]);
    await audit('customer.deleted', { actor: actorOf(req), entity: 'customer', entityId: id });
    res.json({ ok: true });
  })
);

customersRouter.post(
  '/bulk',
  handler(async (req, res) => {
    const ids: number[] = (req.body?.ids ?? []).map((n: any) => parseInt(String(n), 10)).filter(Boolean);
    const action = String(req.body?.action ?? '');
    if (!ids.length) throw new AppError('Select at least one customer first.', 400);

    if (action === 'disable') await query(`UPDATE customers SET status='disabled' WHERE id = ANY($1)`, [ids]);
    else if (action === 'enable') await query(`UPDATE customers SET status='active' WHERE id = ANY($1)`, [ids]);
    else if (action === 'unsubscribe')
      await query(
        `UPDATE customers SET marketing_opt_out=true, unsubscribed_at=now() WHERE id = ANY($1)`,
        [ids]
      );
    else if (action === 'delete') await query('DELETE FROM customers WHERE id = ANY($1)', [ids]);
    // Recording texting consent in bulk is for customers who have already given
    // it — on a signed work order, a form, or in writing. It is not a way to
    // opt people in who never agreed, and the timestamp is what evidences it.
    else if (action === 'sms_opt_in')
      await query(
        `UPDATE customers SET sms_opt_in=true, sms_opt_in_at=now(), sms_opt_out_at=NULL
          WHERE id = ANY($1) AND phone <> ''`,
        [ids]
      );
    else if (action === 'sms_opt_out')
      await query(
        `UPDATE customers SET sms_opt_in=false, sms_opt_out_at=now() WHERE id = ANY($1)`,
        [ids]
      );
    else throw new AppError('That action is not available.', 400);

    await audit(`customer.bulk_${action}`, { actor: actorOf(req), details: { count: ids.length } });
    res.json({ ok: true, count: ids.length });
  })
);

customersRouter.get(
  '/export/csv',
  handler(async (_req, res) => {
    const rows = await query(
      `SELECT first_name,last_name,company_name,email,phone,address,city,province,postal_code,country,
              status,marketing_opt_out,last_emailed_at FROM customers ORDER BY id`
    );
    const header =
      'first_name,last_name,company_name,email,phone,address,city,province,postal_code,country,status,unsubscribed,last_emailed_at';
    const body = rows
      .map((r: any) =>
        [
          r.first_name,
          r.last_name,
          r.company_name,
          r.email,
          r.phone,
          r.address,
          r.city,
          r.province,
          r.postal_code,
          r.country,
          r.status,
          r.marketing_opt_out ? 'yes' : 'no',
          r.last_emailed_at ? new Date(r.last_emailed_at).toISOString() : '',
        ]
          .map(csvCell)
          .join(',')
      )
      .join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="hulk-customers.csv"');
    res.send(`${header}\n${body}`);
  })
);

customersRouter.post(
  '/import/csv',
  handler(async (req, res) => {
    const text = String(req.body?.csv ?? '');
    if (!text.trim()) throw new AppError('The file looked empty. Export a sample CSV to see the format.', 400);
    const rows = parseCsv(text);
    if (!rows.length) throw new AppError('No rows were found in that file.', 400);

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    for (const row of rows) {
      const email = String(row.email ?? '').trim().toLowerCase();
      if (!email.includes('@')) {
        skipped++;
        continue;
      }
      const result = await one<{ inserted: boolean }>(
        `INSERT INTO customers (first_name,last_name,company_name,email,phone,address,city,province,postal_code,country,source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'csv')
         ON CONFLICT (lower(email)) DO UPDATE SET
           first_name = COALESCE(NULLIF(EXCLUDED.first_name,''), customers.first_name),
           last_name  = COALESCE(NULLIF(EXCLUDED.last_name,''), customers.last_name),
           company_name = COALESCE(NULLIF(EXCLUDED.company_name,''), customers.company_name),
           phone = COALESCE(NULLIF(EXCLUDED.phone,''), customers.phone),
           updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [
          row.first_name ?? '',
          row.last_name ?? '',
          row.company_name ?? row.company ?? '',
          email,
          row.phone ?? '',
          row.address ?? '',
          row.city ?? '',
          row.province ?? row.state ?? '',
          row.postal_code ?? row.zip ?? '',
          row.country ?? '',
        ]
      );
      if (result?.inserted) imported++;
      else updated++;
    }
    await audit('customer.import', { actor: actorOf(req), details: { imported, updated, skipped } });
    res.json({ imported, updated, skipped });
  })
);

function csvCell(value: any): string {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Small dependency-free CSV reader: handles quotes, commas and CRLF. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += char;
    } else if (char === '"') inQuotes = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length) return [];

  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => (obj[h] = (r[i] ?? '').trim()));
      return obj;
    });
}
