import { DateTime } from 'luxon';
import { Router } from 'express';
import { one, query } from '../lib/db';
import { actorOf, handler, intParam } from '../lib/http';
import { AppError } from '../lib/errors';
import { audit } from '../services/activity';
import { getSettings } from '../services/settings';
import {
  Campaign,
  flyerOnDisk,
  flyerUrl,
  getCampaign,
  previewAudienceCount,
  sentToday,
  isSms,
  sendTestEmail,
  sendTestSms,
  scheduleSummary,
  setCampaignStatus,
  smsBodyFor,
  startCampaign,
} from '../services/campaigns';
import { describeRepeat, occurrencesFrom, repeatOf, toDateString } from '../services/recurrence';
import { smsSegments, twilioConfigured } from '../services/twilio';
import { renderEmail } from '../email/render';
import { runSchedulerNow } from '../services/scheduler';

export const campaignsRouter = Router();

const INTERVALS = ['none', 'daily', 'weekly', 'monthly'];

/** Today's date in the business's timezone, as 'YYYY-MM-DD'. */
function todayIn(timezone: string): string {
  return DateTime.now().setZone(timezone).toISODate() as string;
}

/**
 * The repeat rule as the wizard sends it, cleaned up. Anything unrecognised
 * falls back to "sends once" rather than being stored as a schedule nobody
 * asked for.
 */
function repeatFields(b: any) {
  const interval = INTERVALS.includes(String(b.repeat_interval)) ? String(b.repeat_interval) : 'none';
  const recurring = interval !== 'none';
  const days = Array.isArray(b.repeat_days)
    ? [...new Set<number>(b.repeat_days.map((d: any) => parseInt(String(d), 10)))]
        .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
        .sort((a, b2) => a - b2)
    : [];
  return {
    interval,
    every: recurring ? Math.min(52, Math.max(1, parseInt(String(b.repeat_every ?? 1), 10) || 1)) : 1,
    days: interval === 'weekly' ? days : [],
    dayOfMonth:
      interval === 'monthly' && b.repeat_day_of_month
        ? Math.min(31, Math.max(1, parseInt(String(b.repeat_day_of_month), 10)))
        : null,
    until: recurring ? toDateString(b.repeat_until) : null,
    count:
      recurring && b.repeat_count
        ? Math.min(365, Math.max(1, parseInt(String(b.repeat_count), 10)))
        : null,
  };
}

function groupIds(value: any): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((n: any) => parseInt(String(n), 10)).filter((n) => Number.isFinite(n)))];
}

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
    // Progress is about the send that is running now, so it is counted for the
    // current occurrence; a repeating campaign's running total is reported
    // beside it rather than mixed into the bar.
    const countsSql = `SELECT
         count(*)                                  AS total,
         count(*) FILTER (WHERE status='sent')     AS sent,
         count(*) FILTER (WHERE status='queued')   AS queued,
         count(*) FILTER (WHERE status='failed')   AS failed,
         count(*) FILTER (WHERE status='unsubscribed') AS unsubscribed,
         count(*) FILTER (WHERE opened_at IS NOT NULL)  AS opened,
         count(*) FILTER (WHERE clicked_at IS NOT NULL) AS clicked
       FROM campaign_recipients WHERE campaign_id = $1`;
    const counts = await one<any>(`${countsSql} AND occurrence = $2`, [id, campaign.occurrence ?? 1]);
    const lifetime = await one<any>(countsSql, [id]);
    const groups = campaign.group_ids?.length
      ? await query('SELECT id, name, color FROM customer_groups WHERE id = ANY($1::int[]) ORDER BY name', [
          campaign.group_ids,
        ])
      : [];
    const settings = await getSettings();
    res.json({
      campaign,
      counts,
      lifetime,
      groups,
      schedule: scheduleSummary(campaign),
      dailyLimit: isSms(campaign) ? settings.sms_daily_limit : settings.daily_limit,
      sentToday: await sentToday(settings, isSms(campaign) ? 'sms' : 'email'),
      flyerUrl: flyerUrl(campaign),
      // So the page can say the flyer needs re-uploading, rather than the first
      // sign of it being a broken image in a customer's inbox.
      flyerMissing: Boolean(campaign.flyer_path) && !(await flyerOnDisk(campaign)),
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
    const repeat = repeatFields(b);
    if (repeat.interval === 'monthly' && repeat.dayOfMonth == null && !toDateString(b.start_date)) {
      throw new AppError('Choose which day of the month this campaign should send on.', 400);
    }
    const settings = await getSettings();
    const row = await one<Campaign>(
      `INSERT INTO campaigns
        (name, subject, template_id, blocks, audience, audience_days, audience_ids,
         test_mode, test_email, start_date, send_time, created_by, flyer_path, flyer_name, flyer_kind,
         channel, sms_body, group_ids,
         repeat_interval, repeat_every, repeat_days, repeat_day_of_month, repeat_until, repeat_count,
         next_run_date, repeat_anchor_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
               $19,$20,$21,$22,$23,$24,$10,$10) RETURNING *`,
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
        toDateString(b.start_date),
        b.send_time ?? settings.send_time,
        req.user?.id ?? null,
        b.flyer_path ?? null,
        b.flyer_name ?? null,
        b.flyer_kind ?? null,
        b.channel === 'sms' ? 'sms' : 'email',
        b.sms_body ?? '',
        groupIds(b.group_ids),
        repeat.interval,
        repeat.every,
        repeat.days,
        repeat.dayOfMonth,
        repeat.until,
        repeat.count,
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
    const repeat = repeatFields(b);
    const row = await one<Campaign>(
      `UPDATE campaigns SET
         name=COALESCE($2,name), subject=COALESCE($3,subject), template_id=COALESCE($4,template_id),
         blocks=COALESCE($5,blocks), audience=COALESCE($6,audience), audience_days=COALESCE($7,audience_days),
         audience_ids=COALESCE($8,audience_ids), test_mode=COALESCE($9,test_mode),
         test_email=COALESCE($10,test_email), start_date=COALESCE($11,start_date),
         send_time=COALESCE($12,send_time), flyer_path=COALESCE($13,flyer_path),
         flyer_name=COALESCE($14,flyer_name), flyer_kind=COALESCE($15,flyer_kind),
         channel=COALESCE($16,channel), sms_body=COALESCE($17,sms_body),
         group_ids=COALESCE($18,group_ids),
         repeat_interval=COALESCE($19,repeat_interval), repeat_every=COALESCE($20,repeat_every),
         repeat_days=COALESCE($21,repeat_days), repeat_day_of_month=$22,
         repeat_until=$23, repeat_count=$24,
         next_run_date=COALESCE($11,next_run_date),
         repeat_anchor_date=COALESCE($11,repeat_anchor_date)
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
        toDateString(b.start_date),
        b.send_time ?? null,
        b.flyer_path ?? null,
        b.flyer_name ?? null,
        b.flyer_kind ?? null,
        b.channel === 'sms' || b.channel === 'email' ? b.channel : null,
        typeof b.sms_body === 'string' ? b.sms_body : null,
        Array.isArray(b.group_ids) ? groupIds(b.group_ids) : null,
        b.repeat_interval === undefined ? null : repeat.interval,
        b.repeat_interval === undefined ? null : repeat.every,
        b.repeat_interval === undefined ? null : repeat.days,
        b.repeat_interval === undefined ? existing.repeat_day_of_month : repeat.dayOfMonth,
        b.repeat_interval === undefined ? existing.repeat_until : repeat.until,
        b.repeat_interval === undefined ? existing.repeat_count : repeat.count,
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
      group_ids: groupIds(b.group_ids),
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

    // What the review screen says about the calendar: the rule in words, and
    // the days it actually lands on.
    const repeat = repeatOf({
      repeat_interval: b.repeat_interval,
      repeat_every: b.repeat_every,
      repeat_days: b.repeat_days,
      repeat_day_of_month: b.repeat_day_of_month,
      repeat_until: b.repeat_until,
      repeat_count: b.repeat_count,
    });
    const anchor = toDateString(b.start_date) ?? todayIn(settings.timezone);
    const upcoming = occurrencesFrom(repeat, anchor, { limit: 6 });

    const groups = draft.group_ids.length
      ? await query('SELECT id, name FROM customer_groups WHERE id = ANY($1::int[]) ORDER BY name', [
          draft.group_ids,
        ])
      : [];

    res.json({
      recipients,
      channel,
      dailyLimit: perDay,
      sentToday: alreadySent,
      estimatedDays: days,
      groups,
      repeats: repeat.interval !== 'none',
      repeatDescription: describeRepeat(repeat, anchor),
      upcoming,
      // Each occurrence sends to the whole audience again, so the running cost
      // of a repeating campaign is what the owner should be seeing.
      totalSends: repeat.interval === 'none' ? recipients : recipients * upcoming.length,
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
