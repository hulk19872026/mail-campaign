import { Router } from 'express';
import { databaseTarget, one, query } from '../lib/db';
import { verifyToken } from '../lib/tokens';
import { handler } from '../lib/http';
import { log } from '../lib/logger';
import { getSettings } from '../services/settings';
import { verifyResendWebhook } from '../services/resend';
import { audit, notify } from '../services/activity';
import { escapeHtml } from '../email/render';

export const publicRouter = Router();

const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

/* ------------------------------ open tracking ----------------------------- */

publicRouter.get(
  '/t/open/:token.gif',
  handler(async (req, res) => {
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.end(PIXEL);

    const payload = verifyToken<{ r: number; c: number; u: number }>(req.params.token);
    if (!payload?.r) return;
    await query(
      `UPDATE campaign_recipients SET opened_at = COALESCE(opened_at, now()) WHERE id = $1`,
      [payload.r]
    );
    const first = await one(
      `SELECT 1 FROM email_events WHERE recipient_id=$1 AND type='opened'`,
      [payload.r]
    );
    if (!first) {
      await query(
        `INSERT INTO email_events (campaign_id, customer_id, recipient_id, type) VALUES ($1,$2,$3,'opened')`,
        [payload.c ?? null, payload.u ?? null, payload.r]
      );
    }
  })
);

/* ------------------------------ click tracking ---------------------------- */

publicRouter.get(
  '/t/click/:token',
  handler(async (req, res) => {
    const settings = await getSettings();
    const target = String(req.query.u ?? settings.website);
    const payload = verifyToken<{ r: number; c: number; u: number; i?: string }>(req.params.token);

    res.redirect(302, target);
    if (!payload?.r) return;

    await query(
      `UPDATE campaign_recipients SET clicked_at = COALESCE(clicked_at, now()) WHERE id = $1`,
      [payload.r]
    );
    await query(
      `INSERT INTO email_events (campaign_id, customer_id, recipient_id, type, metadata)
       VALUES ($1,$2,$3,'clicked',$4)`,
      [payload.c ?? null, payload.u ?? null, payload.r, JSON.stringify({ url: target, interest: payload.i })]
    );

    // A click on a maintenance call to action becomes a lead, once per campaign.
    if (payload.i && payload.u) {
      const existing = await one(
        `SELECT 1 FROM maintenance_leads WHERE customer_id=$1 AND campaign_id IS NOT DISTINCT FROM $2`,
        [payload.u, payload.c ?? null]
      );
      if (!existing) {
        await query(
          `INSERT INTO maintenance_leads (customer_id, campaign_id, interest) VALUES ($1,$2,$3)`,
          [payload.u, payload.c ?? null, payload.i]
        );
        const customer = await one<any>('SELECT first_name, last_name, company_name FROM customers WHERE id=$1', [
          payload.u,
        ]);
        await notify(
          'success',
          'New maintenance lead',
          `${[customer?.first_name, customer?.last_name].filter(Boolean).join(' ') || customer?.company_name || 'A customer'} clicked "${payload.i}".`
        );
      }
    }
  })
);

/* ------------------------------- unsubscribe ------------------------------ */

async function optOut(payload: { u?: number | null; e?: string; c?: number | null }): Promise<void> {
  if (payload.u) {
    await query(
      `UPDATE customers SET marketing_opt_out=true, unsubscribed_at=now() WHERE id=$1`,
      [payload.u]
    );
  }
  if (payload.e) {
    await query(
      `INSERT INTO suppression_list (email, reason) VALUES ($1,'unsubscribed')
       ON CONFLICT (lower(email)) DO NOTHING`,
      [payload.e]
    );
  }
  await query(
    `INSERT INTO unsubscribe_records (customer_id, campaign_id, email, reason)
     VALUES ($1,$2,$3,'link')`,
    [payload.u ?? null, payload.c ?? null, payload.e ?? '']
  );
  await query(
    `INSERT INTO email_events (campaign_id, customer_id, type) VALUES ($1,$2,'unsubscribed')`,
    [payload.c ?? null, payload.u ?? null]
  );
  await audit('customer.unsubscribed', { actor: payload.e ?? 'customer', entity: 'customer', entityId: payload.u ?? '' });
  await notify('warning', 'Customer unsubscribed', payload.e ?? '');
}

function unsubscribePage(company: string, email: string, done: boolean): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(company)} — email preferences</title>
<style>
  body{margin:0;background:#0b0f14;color:#e8eaed;font:400 16px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{background:#141a21;border:1px solid #202a35;border-radius:16px;padding:32px;max-width:460px;width:100%}
  h1{margin:0 0 8px;font-size:22px;letter-spacing:-0.3px}
  p{margin:0 0 18px;color:#9aa5b1}
  button{background:#22C55E;color:#08120b;border:0;border-radius:10px;padding:13px 22px;font-size:16px;font-weight:700;cursor:pointer}
  .done{color:#22C55E;font-weight:600}
</style></head><body><div class="card">
${
  done
    ? `<h1>You're unsubscribed</h1><p>${escapeHtml(email)} will not receive further marketing emails from ${escapeHtml(company)}. Service and billing messages are unaffected.</p><p class="done">Nothing else to do.</p>`
    : `<h1>Unsubscribe from marketing emails</h1><p>Confirm and ${escapeHtml(email)} will be removed from ${escapeHtml(company)} marketing lists.</p>
       <form method="POST"><button type="submit">Unsubscribe me</button></form>`
}
</div></body></html>`;
}

publicRouter.get(
  '/u/:token',
  handler(async (req, res) => {
    const settings = await getSettings();
    const payload = verifyToken<{ u: number; e: string; c: number }>(req.params.token);
    if (!payload) {
      res.status(400).send(unsubscribePage(settings.company_name, 'that address', false));
      return;
    }
    res.send(unsubscribePage(settings.company_name, payload.e ?? '', false));
  })
);

publicRouter.post(
  '/u/:token',
  handler(async (req, res) => {
    const settings = await getSettings();
    const payload = verifyToken<{ u: number; e: string; c: number }>(req.params.token);
    if (!payload) {
      res.status(400).send('That unsubscribe link is not valid.');
      return;
    }
    await optOut(payload);
    res.send(unsubscribePage(settings.company_name, payload.e ?? '', true));
  })
);

/* -------------------------------- webhooks -------------------------------- */

publicRouter.post(
  '/webhooks/resend',
  handler(async (req, res) => {
    const raw = (req as any).rawBody ?? JSON.stringify(req.body ?? {});
    if (!verifyResendWebhook(req.headers as any, raw)) {
      res.status(401).json({ error: 'invalid signature' });
      return;
    }
    res.json({ ok: true });

    const event = req.body ?? {};
    const type = String(event.type ?? '');
    const messageId = event?.data?.email_id ?? event?.data?.id;
    if (!messageId) return;

    const recipient = await one<any>(
      `SELECT id, campaign_id, customer_id FROM campaign_recipients WHERE provider_message_id = $1`,
      [messageId]
    );
    if (!recipient) return;

    const map: Record<string, { column?: string; event: string }> = {
      'email.delivered': { column: 'delivered_at', event: 'delivered' },
      'email.opened': { column: 'opened_at', event: 'opened' },
      'email.clicked': { column: 'clicked_at', event: 'clicked' },
      'email.bounced': { column: 'bounced_at', event: 'bounced' },
      'email.complained': { event: 'complained' },
      'email.delivery_delayed': { event: 'delayed' },
    };
    const mapped = map[type];
    if (!mapped) return;

    if (mapped.column) {
      await query(
        `UPDATE campaign_recipients SET ${mapped.column} = COALESCE(${mapped.column}, now()) WHERE id = $1`,
        [recipient.id]
      );
    }
    await query(
      `INSERT INTO email_events (campaign_id, customer_id, recipient_id, type, metadata)
       VALUES ($1,$2,$3,$4,$5)`,
      [recipient.campaign_id, recipient.customer_id, recipient.id, mapped.event, JSON.stringify(event.data ?? {})]
    );

    // Hard bounces and complaints are permanent: stop mailing that address.
    if (mapped.event === 'bounced' || mapped.event === 'complained') {
      const customer = await one<any>('SELECT email FROM customers WHERE id=$1', [recipient.customer_id]);
      if (customer?.email) {
        await query(
          `INSERT INTO suppression_list (email, reason) VALUES ($1,$2)
           ON CONFLICT (lower(email)) DO NOTHING`,
          [customer.email, mapped.event]
        );
      }
      log.warn('Address suppressed after provider event', { type, messageId });
    }
  })
);

/* --------------------------------- health --------------------------------- */

publicRouter.get('/healthz', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', database: databaseTarget(), time: new Date().toISOString() });
  } catch (err) {
    // Say which database could not be reached: when sign-in fails because the
    // database is down, this page is the quickest way to confirm it.
    res.status(503).json({
      status: 'degraded',
      database: databaseTarget(),
      error: String((err as any)?.message ?? err),
      time: new Date().toISOString(),
    });
  }
});
