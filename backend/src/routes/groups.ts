import { Router } from 'express';
import { one, query } from '../lib/db';
import { actorOf, handler, intParam } from '../lib/http';
import { AppError } from '../lib/errors';
import { audit } from '../services/activity';

export const groupsRouter = Router();

/**
 * How many people in a group a campaign would actually reach. It mirrors the
 * email side of audienceSql in services/campaigns.ts: active, has an address,
 * not unsubscribed, not suppressed. A group of 40 where 12 have unsubscribed
 * is worth seeing as "40 people · 28 can be emailed" before pressing send.
 */
const EMAILABLE = `
  SELECT count(*) FROM customer_group_members m
    JOIN customers c ON c.id = m.customer_id
   WHERE m.group_id = g.id
     AND c.status = 'active'
     AND c.email <> ''
     AND c.marketing_opt_out = false
     AND NOT EXISTS (SELECT 1 FROM suppression_list s WHERE lower(s.email) = lower(c.email))`;

const GROUP_COLUMNS = `
  g.*,
  (SELECT count(*) FROM customer_group_members m WHERE m.group_id = g.id) AS member_count,
  (${EMAILABLE}) AS emailable_count`;

function cleanIds(value: any): number[] {
  return (Array.isArray(value) ? value : [])
    .map((n: any) => parseInt(String(n), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function nameOf(value: any): string {
  const name = String(value ?? '').trim();
  if (!name) throw new AppError('Give the group a name.', 400);
  if (name.length > 80) throw new AppError('That name is too long — keep it under 80 characters.', 400);
  return name;
}

groupsRouter.get(
  '/',
  handler(async (_req, res) => {
    const groups = await query(
      `SELECT ${GROUP_COLUMNS} FROM customer_groups g ORDER BY lower(g.name)`
    );
    res.json({ groups });
  })
);

groupsRouter.get(
  '/:id',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    const group = await one(`SELECT ${GROUP_COLUMNS} FROM customer_groups g WHERE g.id = $1`, [id]);
    if (!group) throw new AppError('That group was not found.', 404);
    const members = await query(
      `SELECT c.id, c.first_name, c.last_name, c.company_name, c.email, c.phone,
              c.status, c.marketing_opt_out, c.last_emailed_at, m.added_at
         FROM customer_group_members m
         JOIN customers c ON c.id = m.customer_id
        WHERE m.group_id = $1
        ORDER BY lower(c.first_name), lower(c.last_name), c.id`,
      [id]
    );
    res.json({ group, members });
  })
);

groupsRouter.post(
  '/',
  handler(async (req, res) => {
    const b = req.body ?? {};
    const name = nameOf(b.name);
    const row = await one<{ id: number }>(
      `INSERT INTO customer_groups (name, description, created_by) VALUES ($1,$2,$3) RETURNING *`,
      [name, String(b.description ?? '').trim(), req.user?.id ?? null]
    ).catch(() => {
      throw new AppError('You already have a group with that name.', 400);
    });

    // Creating a group straight from a selection on the Customers page.
    const ids = cleanIds(b.ids);
    if (ids.length) await addMembers(row!.id, ids);

    await audit('group.created', { actor: actorOf(req), entity: 'group', entityId: row!.id });
    res.json({ group: await one(`SELECT ${GROUP_COLUMNS} FROM customer_groups g WHERE g.id = $1`, [row!.id]) });
  })
);

groupsRouter.put(
  '/:id',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    const b = req.body ?? {};
    const row = await one(
      `UPDATE customer_groups SET name = COALESCE($2, name), description = COALESCE($3, description),
              updated_at = now()
        WHERE id = $1 RETURNING id`,
      [id, b.name === undefined ? null : nameOf(b.name), b.description === undefined ? null : String(b.description).trim()]
    ).catch(() => {
      throw new AppError('You already have a group with that name.', 400);
    });
    if (!row) throw new AppError('That group was not found.', 404);
    await audit('group.updated', { actor: actorOf(req), entity: 'group', entityId: id });
    res.json({ group: await one(`SELECT ${GROUP_COLUMNS} FROM customer_groups g WHERE g.id = $1`, [id]) });
  })
);

groupsRouter.delete(
  '/:id',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    // Only the group goes; the customers in it are untouched, and campaigns
    // already sent to it keep their own recipient list.
    await query('DELETE FROM customer_groups WHERE id = $1', [id]);
    await audit('group.deleted', { actor: actorOf(req), entity: 'group', entityId: id });
    res.json({ ok: true });
  })
);

/** Add or remove customers. Adding someone already in the group is a no-op. */
groupsRouter.post(
  '/:id/members',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    const group = await one<{ id: number }>('SELECT id FROM customer_groups WHERE id = $1', [id]);
    if (!group) throw new AppError('That group was not found.', 404);

    const ids = cleanIds(req.body?.ids);
    if (!ids.length) throw new AppError('Select at least one customer first.', 400);
    const action = String(req.body?.action ?? 'add');

    if (action === 'add') await addMembers(id, ids);
    else if (action === 'remove')
      await query('DELETE FROM customer_group_members WHERE group_id = $1 AND customer_id = ANY($2)', [id, ids]);
    else throw new AppError('That action is not available.', 400);

    await audit(`group.members_${action}`, {
      actor: actorOf(req),
      entity: 'group',
      entityId: id,
      details: { count: ids.length },
    });
    res.json({
      ok: true,
      count: ids.length,
      group: await one(`SELECT ${GROUP_COLUMNS} FROM customer_groups g WHERE g.id = $1`, [id]),
    });
  })
);

export async function addMembers(groupId: number, ids: number[]): Promise<void> {
  await query(
    `INSERT INTO customer_group_members (group_id, customer_id)
     SELECT $1, c.id FROM customers c WHERE c.id = ANY($2)
     ON CONFLICT (group_id, customer_id) DO NOTHING`,
    [groupId, ids]
  );
}
