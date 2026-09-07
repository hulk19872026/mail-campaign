import { DateTime } from 'luxon';
import { one, query, transaction } from '../lib/db';
import { log } from '../lib/logger';
import { env } from '../lib/env';
import { AppError } from '../lib/errors';
import { getSettings, AppSettings } from './settings';
import { sendEmail } from './resend';
import { normalizePhone, phoneKeySql, sendSms, twilioConfigured } from './twilio';
import { audit, notify } from './activity';
import { renderEmail, unsubscribeUrl, personalize, Block } from '../email/render';

export type Campaign = {
  id: number;
  name: string;
  subject: string;
  blocks: Block[];
  flyer_path: string | null;
  flyer_name: string | null;
  flyer_kind: string | null;
  audience: string;
  audience_days: number;
  audience_ids: number[];
  status: string;
  test_mode: boolean;
  test_email: string | null;
  start_date: string | null;
  send_time: string;
  daily_limit: number | null;
  total_recipients: number;
  channel: string; // email | sms
  sms_body: string;
};

export function today(settings: AppSettings): string {
  return DateTime.now().setZone(settings.timezone).toISODate() as string;
}

function minutesNow(settings: AppSettings): number {
  const now = DateTime.now().setZone(settings.timezone);
  return now.hour * 60 + now.minute;
}

function parseTime(value: string): number {
  const [h, m] = String(value || '09:00').split(':').map((n) => parseInt(n, 10));
  return (isNaN(h) ? 9 : h) * 60 + (isNaN(m) ? 0 : m);
}

export async function sentToday(settings: AppSettings, channel: string = 'email'): Promise<number> {
  const column = channel === 'sms' ? 'sms_count' : 'count';
  const row = await one<{ count: number }>(
    `SELECT ${column} AS count FROM daily_send_counts WHERE day = $1`,
    [today(settings)]
  );
  return row?.count ?? 0;
}

async function bumpDailyCount(day: string, channel: string, by = 1): Promise<void> {
  const column = channel === 'sms' ? 'sms_count' : 'count';
  await query(
    `INSERT INTO daily_send_counts (day, ${column}, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (day) DO UPDATE SET ${column} = daily_send_counts.${column} + $2, updated_at = now()`,
    [day, by]
  );
}

/** The per-day allowance for a channel: texts and emails are budgeted apart. */
function limitFor(settings: AppSettings, channel: string): number {
  return channel === 'sms' ? settings.sms_daily_limit : settings.daily_limit;
}

export function isSms(campaign: Pick<Campaign, 'channel'>): boolean {
  return campaign.channel === 'sms';
}

/**
 * The SQL that turns an audience choice into a set of customer ids.
 *
 * The two channels have different notions of "reachable". Email needs an
 * address that is not suppressed; texting needs a phone number AND explicit
 * consent, because sending marketing texts without it is what the law is
 * actually about. Recency is likewise per channel — someone emailed last week
 * has not necessarily been texted at all.
 */
function audienceSql(campaign: Campaign): { sql: string; params: any[] } {
  const params: any[] = [];
  const sms = isSms(campaign);
  const recency = sms ? 'c.last_texted_at' : 'c.last_emailed_at';

  let where = sms
    ? `c.phone <> '' AND c.sms_opt_in = true AND c.marketing_opt_out = false
       AND NOT EXISTS (
         SELECT 1 FROM sms_suppression_list s
          WHERE ${phoneKeySql('s.phone')} = ${phoneKeySql('c.phone')}
       )`
    : `c.email <> '' AND c.marketing_opt_out = false
       AND NOT EXISTS (SELECT 1 FROM suppression_list s WHERE lower(s.email) = lower(c.email))`;

  switch (campaign.audience) {
    case 'all':
      break;
    case 'never_emailed':
      where += ` AND c.status = 'active' AND ${recency} IS NULL`;
      break;
    case 'not_in_days':
      params.push(campaign.audience_days || 90);
      where += ` AND c.status = 'active' AND (${recency} IS NULL OR ${recency} < now() - ($${params.length} || ' days')::interval)`;
      break;
    case 'custom':
      params.push(campaign.audience_ids ?? []);
      where += ` AND c.id = ANY($${params.length}::int[])`;
      break;
    case 'active':
    default:
      where += ` AND c.status = 'active'`;
  }

  return { sql: `SELECT c.id, c.email, c.phone FROM customers c WHERE ${where}`, params };
}

export async function previewAudienceCount(campaign: Campaign): Promise<number> {
  if (campaign.test_mode) return 1;
  const { sql, params } = audienceSql(campaign);
  const row = await one<{ count: string }>(
    `SELECT count(*)::text AS count FROM (${sql}) AS eligible`,
    params
  );
  return Number(row?.count ?? 0);
}

/**
 * Writes one recipient row per customer. The unique index on
 * (campaign_id, customer_id) is what makes double-sending impossible.
 */
export async function materializeRecipients(campaign: Campaign): Promise<number> {
  if (campaign.test_mode) {
    if (!campaign.test_email) throw new AppError('Add a test address before starting a test send.', 400);
    await query(
      `INSERT INTO campaign_recipients (campaign_id, customer_id, email, phone)
       SELECT $1, NULL, $2, $3
       WHERE NOT EXISTS (SELECT 1 FROM campaign_recipients WHERE campaign_id = $1)`,
      [campaign.id, isSms(campaign) ? '' : campaign.test_email, isSms(campaign) ? campaign.test_email : '']
    );
  } else {
    const { sql, params } = audienceSql(campaign);
    await query(
      `INSERT INTO campaign_recipients (campaign_id, customer_id, email, phone)
       SELECT $${params.length + 1}, e.id, e.email, e.phone FROM (${sql}) AS e
       ON CONFLICT (campaign_id, customer_id) WHERE customer_id IS NOT NULL DO NOTHING`,
      [...params, campaign.id]
    );
  }

  const row = await one<{ count: string }>(
    'SELECT count(*)::text AS count FROM campaign_recipients WHERE campaign_id = $1',
    [campaign.id]
  );
  const total = Number(row?.count ?? 0);
  await query('UPDATE campaigns SET total_recipients = $2 WHERE id = $1', [campaign.id, total]);
  return total;
}

export async function getCampaign(id: number): Promise<Campaign | null> {
  return one<Campaign>('SELECT * FROM campaigns WHERE id = $1', [id]);
}

export async function startCampaign(id: number, actor: string): Promise<Campaign> {
  const campaign = await getCampaign(id);
  if (!campaign) throw new AppError('That campaign no longer exists.', 404);
  if (['active', 'completed'].includes(campaign.status))
    throw new AppError(`This campaign is already ${campaign.status}.`, 400);
  const settings = await getSettings();

  if (isSms(campaign)) {
    if (!campaign.sms_body?.trim())
      throw new AppError('Write the text message before starting the blast.', 400);
    if (!twilioConfigured())
      throw new AppError(
        'Twilio is not connected. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Railway first.',
        400
      );
    if (!settings.sms_from_number)
      throw new AppError('Set the number texts are sent from in Settings → Texting.', 400);
  } else {
    if (!campaign.subject) throw new AppError('Give the campaign a subject line first.', 400);
    if (!campaign.blocks?.length) throw new AppError('Choose or build an email before starting.', 400);
    if (!settings.from_email)
      throw new AppError('Set a "from" address in Settings → Email before sending.', 400);
  }

  const total = await materializeRecipients(campaign);
  if (total === 0)
    throw new AppError(
      isSms(campaign)
        ? 'Nobody in that audience has a phone number and texting consent, so there is nobody to text. ' +
          'Mark who has agreed to receive texts on the Customers page first.'
        : 'No customers match that audience, so there is nobody to send to.',
      400
    );

  const startDate = campaign.start_date ?? today(settings);
  await query(
    `UPDATE campaigns SET status='active', started_at = COALESCE(started_at, now()), start_date=$2 WHERE id=$1`,
    [id, startDate]
  );
  await audit('campaign.started', { actor, entity: 'campaign', entityId: id, details: { total } });
  await notify('success', 'Campaign started', `${campaign.name} — ${total} recipients queued.`);
  return (await getCampaign(id))!;
}

export async function setCampaignStatus(
  id: number,
  status: 'paused' | 'active' | 'cancelled',
  actor: string
): Promise<Campaign> {
  const campaign = await getCampaign(id);
  if (!campaign) throw new AppError('That campaign no longer exists.', 404);
  await query('UPDATE campaigns SET status = $2 WHERE id = $1', [id, status]);
  await audit(`campaign.${status}`, { actor, entity: 'campaign', entityId: id });
  await notify(
    status === 'active' ? 'success' : 'warning',
    status === 'active' ? 'Campaign resumed' : status === 'paused' ? 'Campaign paused' : 'Campaign cancelled',
    campaign.name
  );
  return (await getCampaign(id))!;
}

export function flyerUrl(campaign: Campaign): string | null {
  if (!campaign.flyer_path) return null;
  return `${env.APP_URL}/uploads/${campaign.flyer_path}`;
}

type RecipientRow = {
  id: number;
  campaign_id: number;
  customer_id: number | null;
  email: string;
  phone: string;
  attempts: number;
};

/**
 * Marks up to `limit` queued recipients as 'sending' in a single transaction.
 * FOR UPDATE SKIP LOCKED means two workers can never claim the same person.
 */
async function claimBatch(campaignId: number, limit: number): Promise<RecipientRow[]> {
  return transaction(async (client) => {
    const { rows } = await client.query<RecipientRow>(
      `UPDATE campaign_recipients SET status = 'sending'
       WHERE id IN (
         SELECT id FROM campaign_recipients
         WHERE campaign_id = $1 AND status = 'queued'
         ORDER BY id
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       RETURNING id, campaign_id, customer_id, email, phone, attempts`,
      [campaignId, limit]
    );
    return rows;
  });
}

async function releaseRecipient(id: number, status: string, error?: string): Promise<void> {
  await query(
    `UPDATE campaign_recipients SET status = $2, error_message = $3, attempts = attempts + 1 WHERE id = $1`,
    [id, status, error ?? null]
  );
}

type SendResult = 'sent' | 'failed' | 'retry' | 'skipped';

/**
 * The text a blast actually sends: the campaign's message, personalized, with
 * the opt-out sentence appended. Every marketing text has to say how to stop,
 * so it is added here rather than left to whoever writes the campaign.
 */
export function smsBodyFor(campaign: Pick<Campaign, 'sms_body'>, ctx: any): string {
  const body = personalize(campaign.sms_body ?? '', ctx).trim();
  if (!body) return '';
  return /\bSTOP\b/i.test(body) ? body : `${body}\n\nReply STOP to opt out.`;
}

/** Marks a number as never to be texted again, and clears the customer's consent. */
export async function suppressNumber(
  phone: string,
  customerId: number | null,
  reason: string
): Promise<void> {
  if (phone) {
    await query(
      `INSERT INTO sms_suppression_list (phone, reason) VALUES ($1, $2)
       ON CONFLICT (${phoneKeySql('phone')}) DO NOTHING`,
      [phone, reason]
    );
  }
  if (customerId) {
    await query(
      `UPDATE customers SET sms_opt_in = false, sms_opt_out_at = now() WHERE id = $1`,
      [customerId]
    );
  }
}

async function sendSmsToRecipient(
  campaign: Campaign,
  recipient: RecipientRow,
  settings: AppSettings,
  customer: any
): Promise<SendResult> {
  const phone = normalizePhone(recipient.phone || customer?.phone || '');
  if (!phone) {
    await releaseRecipient(recipient.id, 'failed', 'No phone number on this customer.');
    return 'failed';
  }

  // Consent is checked again at the moment of sending: someone can reply STOP
  // while their message sits in the queue, and the queue can be days long.
  if (customer && !customer.sms_opt_in) {
    await query(`UPDATE campaign_recipients SET status='unsubscribed' WHERE id=$1`, [recipient.id]);
    return 'skipped';
  }
  const stopped = await one(
    `SELECT 1 FROM sms_suppression_list WHERE ${phoneKeySql('phone')} = ${phoneKeySql('$1')}`,
    [phone]
  );
  if (stopped) {
    await query(`UPDATE campaign_recipients SET status='skipped' WHERE id=$1`, [recipient.id]);
    return 'skipped';
  }

  const ctx = {
    settings,
    customer: {
      id: customer?.id ?? null,
      first_name: customer?.first_name ?? '',
      last_name: customer?.last_name ?? '',
      company_name: customer?.company_name ?? '',
      email: recipient.email || customer?.email || '',
    },
    campaignId: campaign.id,
    recipientId: recipient.id,
    tracking: false,
  };

  const outcome = await sendSms({
    to: phone,
    from: settings.sms_from_number,
    body: smsBodyFor(campaign, ctx),
    statusCallback: `${env.APP_URL}/webhooks/twilio/status`,
  });

  if (outcome.ok) {
    await query(
      `UPDATE campaign_recipients
       SET status='sent', sent_at=now(), provider_message_id=$2, error_message=NULL, attempts = attempts + 1
       WHERE id=$1`,
      [recipient.id, outcome.id]
    );
    if (recipient.customer_id) {
      await query('UPDATE customers SET last_texted_at = now() WHERE id = $1', [recipient.customer_id]);
    }
    await query(
      `INSERT INTO email_events (campaign_id, customer_id, recipient_id, type, metadata)
       VALUES ($1, $2, $3, 'sent', $4)`,
      [campaign.id, recipient.customer_id, recipient.id, JSON.stringify({ message_id: outcome.id, channel: 'sms' })]
    );
    return 'sent';
  }

  // Twilio saying the number has replied STOP is consent withdrawn, not a
  // delivery failure: take the number off the list rather than retrying it.
  if (outcome.unsubscribed) {
    await suppressNumber(phone, recipient.customer_id, 'stop');
    await query(`UPDATE campaign_recipients SET status='unsubscribed' WHERE id=$1`, [recipient.id]);
    return 'skipped';
  }

  const permanent = outcome.permanent || recipient.attempts + 1 >= 3;
  await releaseRecipient(recipient.id, permanent ? 'failed' : 'queued', outcome.message);
  if (permanent) {
    await query(
      `INSERT INTO email_events (campaign_id, customer_id, recipient_id, type, metadata)
       VALUES ($1, $2, $3, 'failed', $4)`,
      [campaign.id, recipient.customer_id, recipient.id, JSON.stringify({ error: outcome.message, channel: 'sms' })]
    );
  }
  return permanent ? 'failed' : 'retry';
}

/** Sends one queued recipient down whichever channel the campaign uses. */
export async function sendToRecipient(
  campaign: Campaign,
  recipient: RecipientRow,
  settings: AppSettings
): Promise<SendResult> {
  const customer = recipient.customer_id
    ? await one<any>('SELECT * FROM customers WHERE id = $1', [recipient.customer_id])
    : null;

  // Applies to both channels: they may have opted out of marketing entirely, or
  // been disabled, while queued.
  if (customer && (customer.marketing_opt_out || customer.status !== 'active')) {
    await query(
      `UPDATE campaign_recipients SET status='unsubscribed', sent_at=NULL WHERE id=$1`,
      [recipient.id]
    );
    return 'skipped';
  }

  return isSms(campaign)
    ? sendSmsToRecipient(campaign, recipient, settings, customer)
    : sendEmailToRecipient(campaign, recipient, settings, customer);
}

async function sendEmailToRecipient(
  campaign: Campaign,
  recipient: RecipientRow,
  settings: AppSettings,
  customer: any
): Promise<SendResult> {
  const suppressed = await one(
    'SELECT 1 FROM suppression_list WHERE lower(email) = lower($1)',
    [recipient.email]
  );
  if (suppressed) {
    await query(`UPDATE campaign_recipients SET status='skipped' WHERE id=$1`, [recipient.id]);
    return 'skipped';
  }

  const ctx = {
    settings,
    customer: {
      id: customer?.id ?? null,
      first_name: customer?.first_name ?? '',
      last_name: customer?.last_name ?? '',
      company_name: customer?.company_name ?? '',
      email: recipient.email,
    },
    campaignId: campaign.id,
    recipientId: recipient.id,
    flyerUrl: flyerUrl(campaign),
    tracking: true,
  };

  const { html, text } = renderEmail(campaign.blocks ?? [], ctx);
  const attachments =
    campaign.flyer_kind === 'pdf' && campaign.flyer_path
      ? await readFlyerAttachment(campaign)
      : undefined;

  const outcome = await sendEmail({
    to: recipient.email,
    subject: personalize(campaign.subject, ctx),
    html,
    text,
    fromName: settings.from_name,
    fromEmail: settings.from_email,
    replyTo: settings.reply_to || undefined,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl(ctx)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    attachments,
    tags: [{ name: 'campaign_id', value: String(campaign.id) }],
  });

  if (outcome.ok) {
    await query(
      `UPDATE campaign_recipients
       SET status='sent', sent_at=now(), provider_message_id=$2, error_message=NULL, attempts = attempts + 1
       WHERE id=$1`,
      [recipient.id, outcome.id]
    );
    if (recipient.customer_id) {
      await query('UPDATE customers SET last_emailed_at = now() WHERE id = $1', [recipient.customer_id]);
    }
    await query(
      `INSERT INTO email_events (campaign_id, customer_id, recipient_id, type, metadata)
       VALUES ($1, $2, $3, 'sent', $4)`,
      [campaign.id, recipient.customer_id, recipient.id, JSON.stringify({ message_id: outcome.id })]
    );
    return 'sent';
  }

  const permanent = outcome.permanent || recipient.attempts + 1 >= 3;
  await releaseRecipient(recipient.id, permanent ? 'failed' : 'queued', outcome.message);
  if (permanent) {
    await query(
      `INSERT INTO email_events (campaign_id, customer_id, recipient_id, type, metadata)
       VALUES ($1, $2, $3, 'failed', $4)`,
      [campaign.id, recipient.customer_id, recipient.id, JSON.stringify({ error: outcome.message })]
    );
  }
  return permanent ? 'failed' : 'retry';
}

async function readFlyerAttachment(campaign: Campaign) {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const file = path.join(env.UPLOAD_DIR, campaign.flyer_path!);
    const data = await fs.readFile(file);
    return [{ filename: campaign.flyer_name || 'flyer.pdf', content: data.toString('base64') }];
  } catch (err) {
    log.warn('Flyer attachment could not be read', { error: String(err) });
    return undefined;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let running = false;

/**
 * One scheduler pass. Sends up to the remaining daily allowance, in batches,
 * across every active campaign, then stops until the next day.
 */
export async function processDueCampaigns(opts: { force?: boolean } = {}): Promise<{
  sent: number;
  failed: number;
  skipped: number;
  reason?: string;
}> {
  if (running) return { sent: 0, failed: 0, skipped: 0, reason: 'A send is already in progress.' };
  running = true;
  const settings = await getSettings(true);
  const day = today(settings);
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  try {
    if (!settings.scheduler_enabled && !opts.force) {
      return { sent, failed, skipped, reason: 'Automatic sending is turned off in Settings.' };
    }

    // One budget per channel, so a morning of emailing cannot spend the texting
    // allowance (and vice versa).
    const budgets: Record<string, number> = {
      email: settings.daily_limit - (await sentToday(settings, 'email')),
      sms: settings.sms_daily_limit - (await sentToday(settings, 'sms')),
    };
    if (budgets.email <= 0 && budgets.sms <= 0) {
      return { sent, failed, skipped, reason: `Daily limit reached (${settings.daily_limit}).` };
    }

    const campaigns = await query<Campaign>(
      `SELECT * FROM campaigns
       WHERE status = 'active' AND (start_date IS NULL OR start_date <= $1::date)
       ORDER BY created_at ASC`,
      [day]
    );
    if (!campaigns.length) return { sent, failed, skipped, reason: 'No active campaigns.' };

    for (const campaign of campaigns) {
      const startMinutes = parseTime(campaign.send_time || settings.send_time);
      if (!opts.force && minutesNow(settings) < startMinutes) continue;

      const channel = isSms(campaign) ? 'sms' : 'email';
      if (budgets[channel] <= 0) continue;

      const channelLimit = limitFor(settings, channel);
      const campaignCap = campaign.daily_limit
        ? Math.min(campaign.daily_limit, channelLimit)
        : channelLimit;
      let campaignBudget = Math.min(budgets[channel], campaignCap);

      while (campaignBudget > 0) {
        const batchSize = Math.min(settings.batch_size, campaignBudget);
        const batch = await claimBatch(campaign.id, batchSize);
        if (!batch.length) break;

        for (const recipient of batch) {
          const result = await sendToRecipient(campaign, recipient, settings);
          if (result === 'sent') {
            sent++;
            budgets[channel]--;
            campaignBudget--;
            await bumpDailyCount(day, channel, 1);
          } else if (result === 'failed') {
            failed++;
          } else if (result === 'skipped') {
            skipped++;
          }
          if (budgets[channel] <= 0) break;
        }

        if (budgets[channel] <= 0 || campaignBudget <= 0) break;

        const remaining = await one<{ count: string }>(
          `SELECT count(*)::text AS count FROM campaign_recipients WHERE campaign_id=$1 AND status='queued'`,
          [campaign.id]
        );
        if (Number(remaining?.count ?? 0) === 0) break;
        if (settings.batch_delay_seconds > 0) await sleep(settings.batch_delay_seconds * 1000);
      }

      await maybeComplete(campaign);
      if (budgets.email <= 0 && budgets.sms <= 0) break;
    }

    if (sent > 0) {
      const emails = await sentToday(settings, 'email');
      const texts = await sentToday(settings, 'sms');
      await audit('scheduler.run', { details: { sent, failed, skipped, emails, texts } });
      if (emails >= settings.daily_limit) {
        await notify(
          'info',
          `${emails} emails sent today`,
          'The daily email limit has been reached. Sending resumes tomorrow.'
        );
      }
      if (texts >= settings.sms_daily_limit) {
        await notify(
          'info',
          `${texts} texts sent today`,
          'The daily texting limit has been reached. Sending resumes tomorrow.'
        );
      }
    }
    return { sent, failed, skipped };
  } catch (err) {
    log.error('Scheduler run failed', { error: String(err) });
    await notify('error', 'Sending hit a problem', String(err instanceof Error ? err.message : err));
    return { sent, failed, skipped, reason: String(err instanceof Error ? err.message : err) };
  } finally {
    running = false;
  }
}

async function maybeComplete(campaign: Campaign): Promise<void> {
  const row = await one<{ count: string }>(
    `SELECT count(*)::text AS count FROM campaign_recipients
     WHERE campaign_id = $1 AND status IN ('queued','sending')`,
    [campaign.id]
  );
  if (Number(row?.count ?? 0) > 0) return;
  await query(
    `UPDATE campaigns SET status='completed', completed_at=now() WHERE id=$1 AND status='active'`,
    [campaign.id]
  );
  await audit('campaign.completed', { entity: 'campaign', entityId: campaign.id });
  await notify('success', 'Campaign completed', `${campaign.name} has finished sending.`);
}

/** Recovers rows left in 'sending' if the process was killed mid-batch. */
export async function recoverStuckRecipients(): Promise<number> {
  const rows = await query<{ id: number }>(
    `UPDATE campaign_recipients SET status='queued'
     WHERE status='sending' AND created_at < now() - interval '1 minute'
     RETURNING id`
  );
  if (rows.length) log.info(`Recovered ${rows.length} in-flight recipients after restart`);
  return rows.length;
}

/** Sends the campaign's text to one number, without touching the queue. */
export async function sendTestSms(campaignId: number, phone: string): Promise<void> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new AppError('That campaign no longer exists.', 404);
  if (!campaign.sms_body?.trim()) throw new AppError('Write the text message first.', 400);
  const settings = await getSettings();

  const ctx = {
    settings,
    customer: {
      id: null,
      first_name: 'David',
      last_name: 'Sample',
      company_name: 'Sample Company',
      email: '',
    },
    campaignId: campaign.id,
    recipientId: null,
    tracking: false,
  };

  const outcome = await sendSms({
    to: phone,
    from: settings.sms_from_number,
    body: `[TEST] ${smsBodyFor(campaign, ctx)}`,
  });
  if (!outcome.ok) throw new AppError(outcome.message, 400);
  await audit('campaign.test_texted', { entity: 'campaign', entityId: campaignId, details: { phone } });
}

export async function sendTestEmail(campaignId: number, address: string): Promise<void> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new AppError('That campaign no longer exists.', 404);
  const settings = await getSettings();
  const ctx = {
    settings,
    customer: {
      id: null,
      first_name: 'David',
      last_name: 'Sample',
      company_name: 'Sample Company',
      email: address,
    },
    campaignId: campaign.id,
    recipientId: null,
    flyerUrl: flyerUrl(campaign),
    tracking: false,
  };
  const { html, text } = renderEmail(campaign.blocks ?? [], ctx);
  const outcome = await sendEmail({
    to: address,
    subject: `[TEST] ${personalize(campaign.subject, ctx)}`,
    html,
    text,
    fromName: settings.from_name,
    fromEmail: settings.from_email,
    replyTo: settings.reply_to || undefined,
  });
  if (!outcome.ok) throw new AppError(outcome.message, 400);
  await audit('campaign.test_sent', { entity: 'campaign', entityId: campaignId, details: { address } });
}
