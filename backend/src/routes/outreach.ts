import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { query } from '../lib/db';
import { env } from '../lib/env';
import { AppError } from '../lib/errors';
import { actorOf, handler, intParam } from '../lib/http';
import { audit } from '../services/activity';
import {
  OUTREACH_LISTS,
  checkInbox,
  getOutreachSettings,
  outreachConfigured,
  outreachState,
  readinessProblems,
  saveOutreachSettings,
  sendTest,
  todayStats,
  verifyConnection,
} from '../services/outreach';

/** Settings, email sequences and status for automatic prospect emails. */
export const outreachRouter = Router();

outreachRouter.get(
  '/',
  handler(async (_req, res) => {
    const settings = await getOutreachSettings();
    const steps = await query(`SELECT list, step, subject, body FROM outreach_steps ORDER BY list, step`);
    const waiting = await query<{ list: string; count: string }>(
      `SELECT list, count(*)::text AS count FROM prospects p
        WHERE status = 'new' AND sequence_step = 0 AND email <> '' AND converted_customer_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM customers c WHERE lower(c.email) = lower(p.email))
        GROUP BY list`
    );
    const recent = await query(
      `SELECT m.id, m.step, m.to_email, m.subject, m.error, m.sent_at, m.opened_at, m.open_count,
              p.business_name, p.list
         FROM outreach_messages m LEFT JOIN prospects p ON p.id = m.prospect_id
        ORDER BY m.sent_at DESC LIMIT 25`
    );
    // Whether each list's flyer is still on the server, and how big it is.
    const flyers: Record<string, { exists: boolean; size: number }> = {};
    for (const [list, a] of Object.entries(settings.attachments)) {
      const stat = fs.statSync(path.join(env.UPLOAD_DIR, a.path), { throwIfNoEntry: false });
      flyers[list] = { exists: !!stat, size: stat?.size ?? 0 };
    }
    res.json({
      flyers,
      settings,
      configured: outreachConfigured(),
      sender: env.OUTREACH_EMAIL,
      problems: await readinessProblems(settings),
      steps,
      waiting,
      recent,
      stats: await todayStats(),
      state: outreachState,
    });
  })
);

outreachRouter.put(
  '/',
  handler(async (req, res) => {
    const b = req.body ?? {};
    const patch: Record<string, any> = {};
    for (const key of ['lists', 'daily_new_limit', 'start_time', 'end_time', 'gap_minutes', 'track_opens', 'from_name', 'signature', 'attachments']) {
      if (b[key] !== undefined) patch[key] = b[key];
    }
    if (b.enabled !== undefined) patch.enabled = b.enabled === true;
    if (patch.enabled) {
      const merged = { ...(await getOutreachSettings()), ...patch };
      const problems = await readinessProblems(merged as any);
      if (problems.length) throw new AppError(problems.join(' '), 400);
    }
    const settings = await saveOutreachSettings(patch);
    await audit('outreach.settings', { actor: actorOf(req), details: patch });
    res.json({ settings });
  })
);

outreachRouter.put(
  '/steps/:list',
  handler(async (req, res) => {
    const list = String(req.params.list);
    if (!(OUTREACH_LISTS as readonly string[]).includes(list)) throw new AppError('Unknown list.', 400);
    const steps: any[] = Array.isArray(req.body?.steps) ? req.body.steps : [];
    for (const s of steps) {
      const step = intParam(s.step);
      if (step < 1 || step > 3) continue;
      const subject = String(s.subject ?? '').trim().slice(0, 200);
      const body = String(s.body ?? '').slice(0, 5000);
      if (step === 1 && body.trim() && !subject) throw new AppError('Email 1 needs a subject line.', 400);
      await query(
        `INSERT INTO outreach_steps (list, step, subject, body, updated_at) VALUES ($1,$2,$3,$4, now())
         ON CONFLICT (list, step) DO UPDATE SET subject = EXCLUDED.subject, body = EXCLUDED.body, updated_at = now()`,
        [list, step, subject, body]
      );
    }
    await audit('outreach.steps', { actor: actorOf(req), details: { list } });
    res.json({ ok: true });
  })
);

outreachRouter.post(
  '/test',
  handler(async (req, res) => {
    const b = req.body ?? {};
    const list = String(b.list ?? '');
    if (!(OUTREACH_LISTS as readonly string[]).includes(list)) throw new AppError('Unknown list.', 400);
    const to = String(b.to ?? req.user?.email ?? '').trim();
    const result = await sendTest(list, intParam(b.step, 1), to);
    res.json({ ok: true, to, ...result });
  })
);

outreachRouter.post(
  '/verify',
  handler(async (_req, res) => {
    res.json(await verifyConnection());
  })
);

outreachRouter.post(
  '/check-inbox',
  handler(async (_req, res) => {
    if (!outreachConfigured()) throw new AppError('Add OUTREACH_EMAIL and OUTREACH_APP_PASSWORD in Railway first.', 400);
    const result = await checkInbox();
    outreachState.lastInboxCheckAt = new Date().toISOString();
    outreachState.lastInboxResult = result;
    res.json({ result });
  })
);
