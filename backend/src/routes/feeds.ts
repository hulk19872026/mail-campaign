import { timingSafeEqual } from 'crypto';
import { Router } from 'express';
import { env } from '../lib/env';
import { handler } from '../lib/http';
import { AppError } from '../lib/errors';
import { audit, notify } from '../services/activity';
import { importProspectRows } from './prospects';
import { parseCsv } from './customers';

/**
 * Machine-to-machine drop-off for the weekly lead finder. It can only ADD
 * prospects — never read, change or delete anything, and never send email —
 * and it is switched off unless PROSPECT_FEED_TOKEN is set in Railway.
 */
export const feedsRouter = Router();

const MAX_ROWS = 200;

function tokenMatches(header: string | undefined): boolean {
  const expected = env.PROSPECT_FEED_TOKEN;
  const given = (header ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

feedsRouter.post(
  '/prospects',
  handler(async (req, res) => {
    if (!env.PROSPECT_FEED_TOKEN) {
      throw new AppError('The prospect feed is switched off. Set PROSPECT_FEED_TOKEN in Railway to turn it on.', 503);
    }
    if (!tokenMatches(req.get('authorization'))) throw new AppError('Not authorised.', 401);

    const b = req.body ?? {};
    const rows: Record<string, any>[] = Array.isArray(b.prospects)
      ? b.prospects.filter((r: any) => r && typeof r === 'object')
      : typeof b.csv === 'string'
        ? parseCsv(b.csv)
        : [];
    if (!rows.length) throw new AppError('Send "prospects" as a list of rows, or "csv" as text.', 400);
    if (rows.length > MAX_ROWS) throw new AppError(`Send at most ${MAX_ROWS} prospects at a time.`, 400);

    const source = String(b.source ?? 'lead finder').slice(0, 60);
    const result = await importProspectRows(b.list, rows);
    await audit('prospect.feed', { actor: source, details: { list: b.list, ...result } });
    if (result.added > 0) {
      await notify('info', `${result.added} new prospects added`, `From the ${source}. Open Prospects to see them.`);
    }
    res.json(result);
  })
);
