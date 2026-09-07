import { Router } from 'express';
import { one, query } from '../lib/db';
import { actorOf, handler, intParam } from '../lib/http';
import { AppError } from '../lib/errors';
import { audit } from '../services/activity';
import { getSettings } from '../services/settings';
import {
  Campaign,
  flyerUrl,
  getCampaign,
  previewAudienceCount,
  sentToday,
  isSms,
  sendTestEmail,
  sendTestSms,
  setCampaignStatus,
  smsBodyFor,
  startCampaign,
} from '../services/campaigns';
import { smsSegments, twilioConfigured } from '../services/twilio';
import { renderEmail } from '../email/render';
import { runSchedulerNow } from '../services/scheduler';

export const campaignsRouter = Router();

campaignsRouter.get(
  '/',
  handler(async (_req, res) => {
    const campaigns = await query(
      `SELECT c.*,
        (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.status='sent') AS sent_count,
        (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.status='queued') AS queued_count,
        (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id=c.id AND r.status='failed') AS failed_count
       FROM campaigns c ORDER BY c.created_at DESC`
    );
    res.json({ campaigns });
  })
);

campaignsRouter.get(
  '/:id',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    const campaign = await getCampaign(id);
    if (!campaign) throw new AppError('That campaign was not found.', 404);
    const counts = await one<any>(
      `SELECT
         count(*)                                  AS total,
         count(*) FILTER (WHERE status='sent')     AS sent,
         count(*) FILTER (WHERE status='queued')   AS queued,
         count(*) FILTER (WHERE status='failed')   AS failed,
         count(*) FILTER (WHERE status='unsubscribed') AS unsubscribed,
         count(*) FILTER (WHERE opened_at IS NOT NULL)  AS opened,
         count(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked
       FROM campaign_recipients WHERE campaign_id = $1`,
      [id]
    );
    const settings = await getSettings();
    res.json({
      campaign,
      counts,
      dailyLimit: isSms(campaign) ? settings.sms_daily_limit : settings.daily_limit,
      sentToday: await sentToday(settings, isSms(campaign) ? 'sms' : 'email'),
      flyerUrl: flyerUrl(campaign),
    });
  })
);

campaignsRouter.get(
  '/:id/recipients',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    const status = String(req.query.status ?? 'all');
    const page = Math.max(1, intParam(req.query.page, 1));
    const pageSize = 50;
    const params: any[] = [id];
    let where = 'r.campaign_id = $1';
    if (status !== 'all') {
      params.push(status);
      where += ` AND r.status = $${params.length}`;
    }
    params.push(pageSize, (page - 1) * pageSize);
    const recipients = await query(
      `SELECT r.*, c.first_name, c.last_name, c.company_name
       FROM campaign_recipients r LEFT JOIN customers c ON c.id = r.customer_id
       WHERE ${where} ORDER BY r.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ recipients, page });
  })
);

campaignsRouter.post(
  '/',
  handler(async (req, res) => {
    const b = req.body ?? {};
    if (!String(b.name ?? '').trim()) throw new AppError('Give the campaign a name.', 400);
    const settings = await getSettings();
    const row = await one<Campaign>(
      `INSERT INTO campaigns
        (name, subject, template_id, blocks, audience, audience_days, audience_ids,
         test_mode, test_email, start_date, send_time, created_by, flyer_path, flyer_name, flyer_kind,
         channel, sms_body)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [
        b.name,
        b.subject ?? '',
        b.template_id ?? null,
        JSON.stringify(b.blocks ?? []),
        b.audience ?? 'active',
        b.audience_days ?? 90,
        b.audience_ids ?? [],
        !!b.test_mode,
        b.test_email ?? null,
        b.start_date ?? null,
        b.send_time ?? settings.send_time,
        req.user?.id ?? null,
        b.flyer_path ?? null,
        b.flyer_name ?? null,
        b.flyer_kind ?? null,
        b.channel === 'sms' ? 'sms' : 'email',
        b.sms_body ?? '',
      ]
    );
    await audit('campaign.created', { actor: actorOf(req), entity: 'campaign', entityId: row!.id });
    res.json({ campaign: row });
  })
);

campaignsRouter.put(
  '/:id',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    const existing = await getCampaign(id);
    if (!existing) throw new AppError('That campaign was not found.', 404);
    if (['active', 'completed'].includes(existing.status)) {
      throw new AppError('Pause the campaign before editing it.', 400);
    }
    const b = req.body ?? {};
    const row = await one<Campaign>(
      `UPDATE campaigns SET
         name=COALESCE($2,name), subject=COALESCE($3,subject), template_id=COALESCE($4,template_id),
         blocks=COALESCE($5,blocks), audience=COALESCE($6,audience), audience_days=COALESCE($7,audience_days),
         audience_ids=COALESCE($8,audience_ids), test_mode=COALESCE($9,test_mode),
         test_email=COALESCE($10,test_email), start_date=COALESCE($11,start_date),
         send_time=COALESCE($12,send_time), flyer_path=COALESCE($13,flyer_path),
         flyer_name=COALESCE($14,flyer_name), flyer_kind=COALESCE($15,flyer_kind),
         channel=COALESCE($16,channel), sms_body=COALESCE($17,sms_body)
       WHERE id=$1 RETURNING *`,
      [
        id,
        b.name ?? null,
        b.subject ?? null,
        b.template_id ?? null,
        b.blocks ? JSON.stringify(b.blocks) : null,
        b.audience ?? null,
        b.audience_days ?? null,
        b.audience_ids ?? null,
        typeof b.test_mode === 'boolean' ? b.test_mode : null,
        b.test_email ?? null,
        b.start_date ?? null,
        b.send_time ?? null,
        b.flyer_path ?? null,
        b.flyer_name ?? null,
        b.flyer_kind ?? null,
        b.channel === 'sms' || b.channel === 'email' ? b.channel : null,
        typeof b.sms_body === 'string' ? b.sms_body : null,
      ]
    );
    res.json({ campaign: row });
  })
);

campaignsRouter.delete(
  '/:id',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    const campaign = await getCampaign(id);
    if (campaign?.status === 'active') throw new AppError('Pause the campaign before deleting it.', 400);
    await query('DELETE FROM campaigns WHERE id = $1', [id]);
    await audit('campaign.deleted', { actor: actorOf(req), entity: 'campaign', entityId: id });
    res.json({ ok: true });
  })
);

/** Everything the confirmation screen needs before the owner commits to a send. */
campaignsRouter.post(
  '/preview',
  handler(async (req, res) => {
    const b = req.body ?? {};
    const settings = await getSettings();
    const draft = {
      id: b.id ?? 0,
      audience: b.audience ?? 'active',
      audience_days: b.audience_days ?? 90,
      audience_ids: b.audience_ids ?? [],
      test_mode: !!b.test_mode,
      channel: b.channel === 'sms' ? 'sms' : 'email',
      sms_body: b.sms_body ?? '',
    } as Campaign;

    const sms = isSms(draft);
    const channel = sms ? 'sms' : 'email';
    const recipients = await previewAudienceCount(draft);
    const alreadySent = await sentToday(settings, channel);
    const perDay = sms ? settings.sms_daily_limit : settings.daily_limit;
    const days = Math.max(1, Math.ceil(recipients / perDay));

    const { html } = renderEmail(b.blocks ?? [], {
      settings,
      customer: {
        id: null,
        first_name: 'John',
        last_name: 'Smith',
        company_name: 'ABC Security',
        email: 'john@example.com',
      },
      campaignId: b.id ?? null,
      recipientId: null,
      flyerUrl: b.flyer_path ? `/uploads/${b.flyer_path}` : null,
      tracking: false,
    });

    // What a text blast needs confirming is different: the exact message that
    // goes out, and how many segments each one is billed as.
    const body = sms
      ? smsBodyFor(draft, {
          settings,
          customer: { id: null, first_name: 'John', last_name: 'Smith', company_name: 'ABC Security', email: '' },
        })
      : '';

    res.json({
      recipients,
      channel,
      dailyLimit: perDay,
      sentToday: alreadySent,
      estimatedDays: days,
      from: sms ? settings.sms_from_number : `${settings.from_name} <${settings.from_email}>`,
      subject: b.subject ?? '',
      html,
      smsBody: body,
      smsSegments: sms ? smsSegments(body) : null,
      smsReady: sms ? twilioConfigured() && Boolean(settings.sms_from_number) : true,
    });
  })
);

campaignsRouter.post(
  '/:id/start',
  handler(async (req, res) => {
    const campaign = await startCampaign(intParam(req.params.id), actorOf(req));
    // Kick off the first batch immediately rather than waiting for the next tick.
    runSchedulerNow().catch(() => undefined);
    res.json({ campaign });
  })
);

campaignsRouter.post(
  '/:id/pause',
  handler(async (req, res) => {
    res.json({ campaign: await setCampaignStatus(intParam(req.params.id), 'paused', actorOf(req)) });
  })
);

campaignsRouter.post(
  '/:id/resume',
  handler(async (req, res) => {
    res.json({ campaign: await setCampaignStatus(intParam(req.params.id), 'active', actorOf(req)) });
  })
);

campaignsRouter.post(
  '/:id/cancel',
  handler(async (req, res) => {
    res.json({ campaign: await setCampaignStatus(intParam(req.params.id), 'cancelled', actorOf(req)) });
  })
);

campaignsRouter.post(
  '/:id/test',
  handler(async (req, res) => {
    const id = intParam(req.params.id);
    const campaign = await getCampaign(id);
    if (!campaign) throw new AppError('That campaign was not found.', 404);

    if (isSms(campaign)) {
      const phone = String(req.body?.phone ?? req.body?.email ?? '').trim();
      if (phone.replace(/[^0-9]/g, '').length < 10)
        throw new AppError('Enter the number the test text should go to.', 400);
      await sendTestSms(id, phone);
      res.json({ ok: true, message: `Test text sent to ${phone}.` });
      return;
    }

    const address = String(req.body?.email ?? '').trim();
    if (!address.includes('@')) throw new AppError('Enter the address the test should go to.', 400);
    await sendTestEmail(id, address);
    res.json({ ok: true, message: `Test email sent to ${address}.` });
  })
);

campaignsRouter.post(
  '/run-now',
  handler(async (req, res) => {
    const result = await runSchedulerNow();
    await audit('scheduler.manual_run', { actor: actorOf(req), details: result });
    res.json(result);
  })
);
