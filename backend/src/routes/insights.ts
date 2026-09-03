import { Router } from 'express';
import { DateTime } from 'luxon';
import { one, query } from '../lib/db';
import { actorOf, handler, intParam } from '../lib/http';
import { getSettings } from '../services/settings';
import { sentToday, today } from '../services/campaigns';
import { audit } from '../services/activity';
import { AppError } from '../lib/errors';

export const insightsRouter = Router();

insightsRouter.get(
  '/dashboard',
  handler(async (_req, res) => {
    const settings = await getSettings();
    const day = today(settings);

    const customers = await one<any>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE status='active' AND marketing_opt_out=false) AS active,
              count(*) FILTER (WHERE marketing_opt_out=true) AS unsubscribed
       FROM customers`
    );
    const events = await one<any>(
      `SELECT count(*) FILTER (WHERE type='sent')    AS sent,
              count(*) FILTER (WHERE type='opened')  AS opened,
              count(*) FILTER (WHERE type='clicked') AS clicked
       FROM email_events`
    );
    const leads = await one<any>(
      `SELECT count(*) AS total, count(*) FILTER (WHERE status='new') AS new FROM maintenance_leads`
    );

    const active = await one<any>(
      `SELECT c.*,
        (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.status='sent')   AS sent,
        (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.status='queued') AS queued
       FROM campaigns c WHERE c.status IN ('active','paused') ORDER BY c.created_at LIMIT 1`
    );

    const sent = Number(events?.sent ?? 0);
    const opened = Number(events?.opened ?? 0);
    const clicked = Number(events?.clicked ?? 0);
    const todayCount = await sentToday(settings);
    const remaining = active ? Number(active.queued ?? 0) : 0;

    const nextSend = DateTime.fromISO(day, { zone: settings.timezone })
      .plus({ days: todayCount >= settings.daily_limit ? 1 : 0 })
      .set({
        hour: parseInt(settings.send_time.split(':')[0] ?? '9', 10),
        minute: parseInt(settings.send_time.split(':')[1] ?? '0', 10),
      });

    res.json({
      customers: {
        total: Number(customers?.total ?? 0),
        active: Number(customers?.active ?? 0),
        unsubscribed: Number(customers?.unsubscribed ?? 0),
      },
      emails: {
        sent,
        openRate: sent ? Math.round((opened / sent) * 1000) / 10 : 0,
        clickRate: sent ? Math.round((clicked / sent) * 1000) / 10 : 0,
      },
      today: {
        sent: todayCount,
        limit: settings.daily_limit,
        remaining: Math.max(0, settings.daily_limit - todayCount),
        limitReached: todayCount >= settings.daily_limit,
      },
      leads: { total: Number(leads?.total ?? 0), new: Number(leads?.new ?? 0) },
      activeCampaign: active
        ? {
            id: active.id,
            name: active.name,
            status: active.status,
            sent: Number(active.sent ?? 0),
            queued: Number(active.queued ?? 0),
            total: Number(active.total_recipients ?? 0),
            estimatedDays: Math.ceil(remaining / settings.daily_limit),
          }
        : null,
      nextSend: nextSend.toISO(),
      timezone: settings.timezone,
    });
  })
);

insightsRouter.get(
  '/analytics',
  handler(async (req, res) => {
    const days = Math.min(180, Math.max(7, intParam(req.query.days, 30)));

    const totals = await one<any>(
      `SELECT count(*) FILTER (WHERE type='sent')      AS sent,
              count(*) FILTER (WHERE type='delivered') AS delivered,
              count(*) FILTER (WHERE type='opened')    AS opened,
              count(*) FILTER (WHERE type='clicked')   AS clicked,
              count(*) FILTER (WHERE type='bounced')   AS bounced,
              count(*) FILTER (WHERE type='failed')    AS failed,
              count(*) FILTER (WHERE type='unsubscribed') AS unsubscribed
       FROM email_events`
    );

    const series = await query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              count(e.*) FILTER (WHERE e.type='sent')    AS sent,
              count(e.*) FILTER (WHERE e.type='opened')  AS opened,
              count(e.*) FILTER (WHERE e.type='clicked') AS clicked
       FROM generate_series(current_date - ($1::int - 1), current_date, interval '1 day') AS d(day)
       LEFT JOIN email_events e ON date_trunc('day', e.created_at) = d.day
       GROUP BY d.day ORDER BY d.day`,
      [days]
    );

    const campaigns = await query(
      `SELECT c.id, c.name, c.status, c.total_recipients,
              count(r.*) FILTER (WHERE r.status='sent')            AS sent,
              count(r.*) FILTER (WHERE r.opened_at IS NOT NULL)    AS opened,
              count(r.*) FILTER (WHERE r.clicked_at IS NOT NULL)   AS clicked,
              count(r.*) FILTER (WHERE r.status='failed')          AS failed
       FROM campaigns c LEFT JOIN campaign_recipients r ON r.campaign_id = c.id
       GROUP BY c.id ORDER BY c.created_at DESC LIMIT 20`
    );

    res.json({ totals, series, campaigns });
  })
);

insightsRouter.get(
  '/leads',
  handler(async (_req, res) => {
    const leads = await query(
      `SELECT l.*, c.first_name, c.last_name, c.company_name, c.email, c.phone, ca.name AS campaign_name
       FROM maintenance_leads l
       LEFT JOIN customers c ON c.id = l.customer_id
       LEFT JOIN campaigns ca ON ca.id = l.campaign_id
       ORDER BY l.created_at DESC LIMIT 300`
    );
    res.json({ leads });
  })
);

insightsRouter.put(
  '/leads/:id',
  handler(async (req, res) => {
    const status = String(req.body?.status ?? '');
    if (!['new', 'contacted', 'quoted', 'won', 'lost'].includes(status)) {
      throw new AppError('Pick one of: new, contacted, quoted, won, lost.', 400);
    }
    const row = await one(
      `UPDATE maintenance_leads SET status=$2, notes=COALESCE($3,notes), updated_at=now()
       WHERE id=$1 RETURNING *`,
      [intParam(req.params.id), status, req.body?.notes ?? null]
    );
    await audit('lead.updated', { actor: actorOf(req), entity: 'lead', entityId: req.params.id });
    res.json({ lead: row });
  })
);

insightsRouter.get(
  '/notifications',
  handler(async (_req, res) => {
    const notifications = await query(
      'SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50'
    );
    const unread = await one<{ count: string }>(
      'SELECT count(*)::text AS count FROM notifications WHERE read = false'
    );
    res.json({ notifications, unread: Number(unread?.count ?? 0) });
  })
);

insightsRouter.post(
  '/notifications/read',
  handler(async (_req, res) => {
    await query('UPDATE notifications SET read = true WHERE read = false');
    res.json({ ok: true });
  })
);

insightsRouter.get(
  '/logs',
  handler(async (req, res) => {
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const params: any[] = [];
    let where = '1=1';
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (lower(action) LIKE $${params.length} OR lower(actor) LIKE $${params.length})`;
    }
    const logs = await query(
      `SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    res.json({ logs });
  })
);

insightsRouter.get(
  '/suppression',
  handler(async (_req, res) => {
    res.json({ entries: await query('SELECT * FROM suppression_list ORDER BY created_at DESC LIMIT 500') });
  })
);

insightsRouter.post(
  '/suppression',
  handler(async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!email.includes('@')) throw new AppError('Enter a valid email address.', 400);
    await query(
      `INSERT INTO suppression_list (email, reason) VALUES ($1,$2)
       ON CONFLICT (lower(email)) DO NOTHING`,
      [email, req.body?.reason ?? 'manual']
    );
    await audit('suppression.added', { actor: actorOf(req), details: { email } });
    res.json({ ok: true });
  })
);

insightsRouter.delete(
  '/suppression/:id',
  handler(async (req, res) => {
    await query('DELETE FROM suppression_list WHERE id=$1', [intParam(req.params.id)]);
    res.json({ ok: true });
  })
);
