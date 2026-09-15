import { Router } from 'express';
import { one, query } from '../lib/db';
import { actorOf, handler, intParam } from '../lib/http';
import { AppError } from '../lib/errors';
import { audit } from '../services/activity';

export const groupsRouter = Router();

const COLORS = ['green', 'blue', 'amber', 'red', 'grey'];

function colorOf(value: any): string {
  return COLORS.includes(String(value)) ? String(value) : 'green';
}

function idList(value: any): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((n: any) => parseInt(String(n), 10)).filter((n) => Number.isFinite(n)))];
}

/**
 * Every group with the three counts that decide whether a campaign aimed at it
 * will actually reach anyone: who is in it, how many can be emailed, and how
 * many have both a number and texting consent.
 */
groupsRouter.get(
  '/',
  handler(async (_req, res) => {
    const groups = await query(
      `SELECT g.*,
        (SELECT count(*) FROM customer_group_members m WHERE m.group_id = g.id) AS member_count,
        (SELECT count(*) FROM customer_group_members m
           JOIN customers c ON c.id = m.customer_id
          WHERE m.group_id = g.id AND c.status='active' AND c.marketing_opt_out=false AND c.email <> ''
        ) AS emailable_count,
        (SELECT count(*) FROM customer_group_members m
           JOIN customers c ON c.id = m.customer_id
          WHERE m.group_id = g.id AND c.status='active' AND c.marketing_opt_out=false
            AND c.sms_opt_in=true AND c.phone <> ''
        ) AS textable_count
       FROM customer_groups g ORDER BY g.name`
    );
    res.json({ groups });
  })
);

groupsRouter.post(
  '/',
  handler(async (req, res) => {
    const b = req.body ?? {};
    const name = String(b.name ?? '').trim();
    if (!name) throw new AppError('Give the group a name.', 400);
    const row = await one(
      `INSERT INTO customer_groups (name, description, color) VALUES ($1,$2,$3) RETURNING *`,
      [name, String(b.description ?? '').trim(), colorOf(b.color)]
    ).catch(() => {
      throw new AppError('A group with that name already exists.', 400);
    });
    await audit('group.created', { actor: actorOf(req), entity: 'group', entityId: (row as any).id });
    res.json({ group: row });
  })
);

groupsRouter.put(
  '/:id',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    const b = req.body ?? {};
    const row = await one(
      `UPDATE customer_groups SET name=COALESCE($2,name), description=COALESCE($3,description),
         color=COALESCE($4,color), updated_at=now() WHERE id=$1 RETURNING *`,
      [
        id,
        b.name ? String(b.name).trim() : null,
        typeof b.description === 'string' ? b.description.trim() : null,
        b.color ? colorOf(b.color) : null,
      ]
    ).catch(() => {
      throw new AppError('A group with that name already exists.', 400);
    });
    if (!row) throw new AppError('That group was not found.', 404);
    await audit('group.updated', { actor: actorOf(req), entity: 'group', entityId: id });
    res.json({ group: row });
  })
);

groupsRouter.delete(
  '/:id',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    // Campaigns still pointed at this group would silently reach nobody, so say
    // so rather than letting the group disappear from under them.
    const inUse = await one<{ count: string }>(
      `SELECT count(*)::text AS count FROM campaigns
        WHERE audience='group' AND $1 = ANY(group_ids) AND status IN ('draft','scheduled','active','paused')`,
      [id]
    );
    if (Number(inUse?.count ?? 0) > 0) {
      throw new AppError(
        'A campaign is still aimed at this group. Point that campaign somewhere else first.',
        400
      );
    }
    await query('DELETE FROM customer_groups WHERE id = $1', [id]);
    await audit('group.deleted', { actor: actorOf(req), entity: 'group', entityId: id });
    res.json({ ok: true });
  })
);

groupsRouter.get(
  '/:id/members',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    const group = await one('SELECT * FROM customer_groups WHERE id = $1', [id]);
    if (!group) throw new AppError('That group was not found.', 404);

    const search = String(req.query.search ?? '').trim().toLowerCase();
    const page = Math.max(1, intParam(req.query.page, 1));
    const pageSize = 50;
    const params: any[] = [id];
    let where = 'm.group_id = $1';
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (lower(c.first_name || ' ' || c.last_name) LIKE $${params.length}
        OR lower(c.company_name) LIKE $${params.length} OR lower(c.email) LIKE $${params.length})`;
    }
    params.push(pageSize, (page - 1) * pageSize);
    const members = await query(
      `SELECT c.id, c.first_name, c.last_name, c.company_name, c.email, c.phone,
              c.status, c.marketing_opt_out, c.sms_opt_in, m.added_at
         FROM customer_group_members m JOIN customers c ON c.id = m.customer_id
        WHERE ${where} ORDER BY c.first_name, c.last_name
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const totalRow = await one<{ count: string }>(
      `SELECT count(*)::text AS count FROM customer_group_members m
         JOIN customers c ON c.id = m.customer_id WHERE ${where}`,
      params.slice(0, params.length - 2)
    );
    res.json({ group, members, total: Number(totalRow?.count ?? 0), page, pageSize });
  })
);

groupsRouter.post(
  '/:id/members',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    const ids = idList(req.body?.ids);
    if (!ids.length) throw new AppError('Choose at least one customer to add.', 400);
    const rows = await query(
      `INSERT INTO customer_group_members (group_id, customer_id)
       SELECT $1, c.id FROM customers c WHERE c.id = ANY($2::int[])
       ON CONFLICT (group_id, customer_id) DO NOTHING
       RETURNING customer_id`,
      [id, ids]
    );
    await audit('group.members_added', {
      actor: actorOf(req),
      entity: 'group',
      entityId: id,
      details: { added: rows.length },
    });
    res.json({ ok: true, added: rows.length });
  })
);

groupsRouter.post(
  '/:id/members/remove',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    const ids = idList(req.body?.ids);
    if (!ids.length) throw new AppError('Choose at least one customer to remove.', 400);
    await query('DELETE FROM customer_group_members WHERE group_id = $1 AND customer_id = ANY($2::int[])', [
      id,
      ids,
    ]);
    await audit('group.members_removed', {
      actor: actorOf(req),
      entity: 'group',
      entityId: id,
      details: { removed: ids.length },
    });
    res.json({ ok: true, removed: ids.length });
  })
);
