import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import { one, query, databaseHealthy } from '../lib/db';
import { env } from '../lib/env';
import { actorOf, handler, intParam } from '../lib/http';
import { AppError } from '../lib/errors';
import { audit } from '../services/activity';
import { getSettings, saveSettings } from '../services/settings';
import { lastSync, syncWaveCustomers, testWaveConnection } from '../services/wave';
import { listResendDomains, testResendConnection } from '../services/resend';
import { schedulerState } from '../services/scheduler';
import { sentToday } from '../services/campaigns';
import { renderEmail } from '../email/render';

export const manageRouter = Router();

/* ------------------------------- templates ------------------------------- */

manageRouter.get(
  '/templates',
  handler(async (_req, res) => {
    res.json({ templates: await query('SELECT * FROM email_templates ORDER BY id') });
  })
);

manageRouter.post(
  '/templates',
  handler(async (req, res) => {
    const b = req.body ?? {};
    if (!String(b.name ?? '').trim()) throw new AppError('Give the template a name.', 400);
    const row = await one(
      `INSERT INTO email_templates (name, description, subject, blocks) VALUES ($1,$2,$3,$4) RETURNING *`,
      [b.name, b.description ?? '', b.subject ?? '', JSON.stringify(b.blocks ?? [])]
    );
    await audit('template.created', { actor: actorOf(req), entity: 'template', entityId: (row as any).id });
    res.json({ template: row });
  })
);

manageRouter.put(
  '/templates/:id',
  handler(async (req, res) => {
    const b = req.body ?? {};
    const row = await one(
      `UPDATE email_templates SET name=COALESCE($2,name), description=COALESCE($3,description),
         subject=COALESCE($4,subject), blocks=COALESCE($5,blocks), updated_at=now()
       WHERE id=$1 RETURNING *`,
      [
        intParam(req.params.id),
        b.name ?? null,
        b.description ?? null,
        b.subject ?? null,
        b.blocks ? JSON.stringify(b.blocks) : null,
      ]
    );
    if (!row) throw new AppError('That template was not found.', 404);
    res.json({ template: row });
  })
);

manageRouter.delete(
  '/templates/:id',
  handler(async (req, res) => {
    await query('DELETE FROM email_templates WHERE id=$1', [intParam(req.params.id)]);
    res.json({ ok: true });
  })
);

/** Renders blocks to HTML for the live editor preview. */
manageRouter.post(
  '/templates/render',
  handler(async (req, res) => {
    const settings = await getSettings();
    const { html } = renderEmail(req.body?.blocks ?? [], {
      settings,
      customer: {
        id: null,
        first_name: 'John',
        last_name: 'Smith',
        company_name: 'ABC Security',
        email: 'john@example.com',
      },
      campaignId: null,
      recipientId: null,
      flyerUrl: req.body?.flyer_path ? `/uploads/${req.body.flyer_path}` : null,
      tracking: false,
    });
    res.json({ html });
  })
);

/* -------------------------------- uploads -------------------------------- */

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(env.UPLOAD_DIR, { recursive: true });
    cb(null, env.UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'].includes(file.mimetype);
    cb(null, ok);
  },
});

manageRouter.post('/uploads', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Upload a PNG, JPG or PDF under 8 MB.' });
    return;
  }
  const kind = req.file.mimetype === 'application/pdf' ? 'pdf' : 'image';
  res.json({
    path: req.file.filename,
    name: req.file.originalname,
    kind,
    url: `/uploads/${req.file.filename}`,
  });
});

/* -------------------------------- settings ------------------------------- */

manageRouter.get(
  '/settings',
  handler(async (_req, res) => {
    res.json({ settings: await getSettings(true) });
  })
);

manageRouter.put(
  '/settings',
  handler(async (req, res) => {
    const settings = await saveSettings(req.body ?? {});
    await audit('settings.updated', { actor: actorOf(req), details: req.body ?? {} });
    res.json({ settings });
  })
);

/* ------------------------------ integrations ----------------------------- */

manageRouter.get(
  '/integrations',
  handler(async (_req, res) => {
    const settings = await getSettings();
    const customers = await one<{ count: string }>('SELECT count(*)::text AS count FROM customers');
    res.json({
      wave: {
        configured: !!env.WAVE_API_TOKEN && !!env.WAVE_BUSINESS_ID,
        businessId: env.WAVE_BUSINESS_ID ? `${env.WAVE_BUSINESS_ID.slice(0, 8)}…` : '',
        lastSync: await lastSync(),
        customers: Number(customers?.count ?? 0),
      },
      resend: {
        configured: !!env.RESEND_API_KEY,
        fromEmail: settings.from_email,
        replyTo: settings.reply_to,
        sentToday: await sentToday(settings),
        remaining: Math.max(0, settings.daily_limit - (await sentToday(settings))),
        dailyLimit: settings.daily_limit,
      },
    });
  })
);

manageRouter.post(
  '/integrations/wave/test',
  handler(async (_req, res) => {
    res.json(await testWaveConnection());
  })
);

manageRouter.post(
  '/integrations/wave/sync',
  handler(async (req, res) => {
    res.json(await syncWaveCustomers(actorOf(req)));
  })
);

manageRouter.post(
  '/integrations/resend/test',
  handler(async (_req, res) => {
    const status = await testResendConnection();
    res.json({ ...status, domains: await listResendDomains() });
  })
);

manageRouter.post(
  '/integrations/resend/test-email',
  handler(async (req, res) => {
    const address = String(req.body?.email ?? '').trim();
    if (!address.includes('@')) throw new AppError('Enter an address to send the test to.', 400);
    const settings = await getSettings();
    const { sendEmail } = await import('../services/resend');
    const outcome = await sendEmail({
      to: address,
      subject: 'HULK Automation — test email',
      html: `<p style="font:400 16px/1.6 Helvetica,Arial,sans-serif">This is a test from your HULK Automation Marketing Center. If you can read this, sending works.</p>`,
      fromName: settings.from_name,
      fromEmail: settings.from_email,
      replyTo: settings.reply_to || undefined,
    });
    if (!outcome.ok) throw new AppError(outcome.message, 400);
    res.json({ ok: true, message: `Test email sent to ${address}.` });
  })
);

/* --------------------------------- status -------------------------------- */

manageRouter.get(
  '/status',
  handler(async (_req, res) => {
    const settings = await getSettings();
    const dbOk = await databaseHealthy();
    const activeCampaign = await one(
      `SELECT id, name FROM campaigns WHERE status='active' ORDER BY created_at LIMIT 1`
    );
    res.json({
      backend: true,
      database: dbOk,
      wave: !!env.WAVE_API_TOKEN && !!env.WAVE_BUSINESS_ID,
      resend: !!env.RESEND_API_KEY,
      scheduler: schedulerState.enabled && settings.scheduler_enabled,
      lastSchedulerRun: schedulerState.lastRunAt,
      lastSchedulerResult: schedulerState.lastResult,
      activeCampaign,
      timezone: settings.timezone,
      sendTime: settings.send_time,
      dailyLimit: settings.daily_limit,
      sentToday: await sentToday(settings),
    });
  })
);
