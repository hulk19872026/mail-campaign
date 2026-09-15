/**
 * When a recurring campaign sends next.
 *
 * Dates here are plain 'YYYY-MM-DD' strings in the business's own timezone —
 * the scheduler has already decided what "today" is before anything in this
 * file is asked a question, so there is no clock and no zone arithmetic to get
 * wrong. Everything is worked out against the campaign's first sending day,
 * the anchor, so a monthly campaign that started on the 3rd keeps landing on
 * the 3rd however many times it has been paused.
 *
 * The same rules are implemented for the browser in frontend/src/lib/recurrence.ts,
 * which draws the calendar. Change one, change the other.
 */

export type RepeatInterval = 'none' | 'daily' | 'weekly' | 'monthly';

export type Repeat = {
  interval: RepeatInterval;
  every: number;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. Weekly only; empty means "the anchor's own weekday". */
  days: number[];
  /** 1–31, clamped to the last day of shorter months. Monthly only; null means "the anchor's own day". */
  dayOfMonth: number | null;
  until: string | null;
  count: number | null;
};

const DAY_MS = 86_400_000;

/** How far ahead the search gives up. Three years is past any sane schedule. */
const HORIZON_DAYS = 1100;

export function isRecurring(repeat: Pick<Repeat, 'interval'>): boolean {
  return repeat.interval === 'daily' || repeat.interval === 'weekly' || repeat.interval === 'monthly';
}

export function toDateString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function utc(date: string): number {
  const [y, m, d] = date.split('-').map((n) => parseInt(n, 10));
  return Date.UTC(y, m - 1, d);
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return iso(utc(date) + days * DAY_MS);
}

function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** 1 = Monday … 7 = Sunday, matching the ISO numbering used in repeat_days. */
export function weekday(date: string): number {
  const day = new Date(utc(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** The Monday of the week a date falls in, so week counting is stable. */
function weekStart(date: string): string {
  return addDays(date, 1 - weekday(date));
}

function dayOfMonth(date: string): number {
  return parseInt(date.slice(8, 10), 10);
}

function daysInMonth(date: string): number {
  const y = parseInt(date.slice(0, 4), 10);
  const m = parseInt(date.slice(5, 7), 10);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function monthsBetween(from: string, to: string): number {
  const fy = parseInt(from.slice(0, 4), 10);
  const fm = parseInt(from.slice(5, 7), 10);
  const ty = parseInt(to.slice(0, 4), 10);
  const tm = parseInt(to.slice(5, 7), 10);
  return (ty - fy) * 12 + (tm - fm);
}

/** Is `date` one of the days this campaign sends on? */
export function matches(repeat: Repeat, anchor: string, date: string): boolean {
  if (!isRecurring(repeat) || date < anchor) return false;
  const every = Math.max(1, repeat.every || 1);

  if (repeat.interval === 'daily') {
    return daysBetween(anchor, date) % every === 0;
  }

  if (repeat.interval === 'weekly') {
    const days = repeat.days?.length ? repeat.days : [weekday(anchor)];
    if (!days.includes(weekday(date))) return false;
    return (daysBetween(weekStart(anchor), weekStart(date)) / 7) % every === 0;
  }

  // Monthly: the 31st becomes the 30th in April and the 28th in February,
  // rather than skipping those months entirely.
  const wanted = repeat.dayOfMonth ?? dayOfMonth(anchor);
  if (dayOfMonth(date) !== Math.min(wanted, daysInMonth(date))) return false;
  return monthsBetween(anchor, date) % every === 0;
}

/**
 * The sending days from the anchor onwards, in order. `sent` is how many
 * occurrences have already gone out, so an "after 6 sends" rule stops at the
 * right place whichever end of the schedule is being drawn.
 */
export function occurrencesFrom(
  repeat: Repeat,
  anchor: string,
  opts: { limit?: number; sent?: number; horizonDays?: number } = {}
): string[] {
  const limit = opts.limit ?? 24;
  const horizon = opts.horizonDays ?? HORIZON_DAYS;
  const dates: string[] = [];
  if (!anchor) return dates;

  // The anchor is always the first send, even if it is not itself a day the
  // rule would pick (someone choosing "every Monday" starting on a Wednesday
  // still means "send on Wednesday, then Mondays").
  const remaining = repeat.count == null ? Infinity : Math.max(0, repeat.count - (opts.sent ?? 0));
  if (remaining <= 0) return dates;
  dates.push(anchor);

  for (let i = 1; i <= horizon && dates.length < limit && dates.length < remaining; i++) {
    const date = addDays(anchor, i);
    if (repeat.until && date > repeat.until) break;
    if (matches(repeat, anchor, date)) dates.push(date);
  }
  return dates;
}

/**
 * The next sending day strictly after `after`, or null when the schedule has
 * run out. `sent` is the number of occurrences already sent, which is what an
 * "after N sends" limit counts.
 */
export function nextOccurrence(
  repeat: Repeat,
  anchor: string,
  after: string,
  sent: number
): string | null {
  if (!isRecurring(repeat) || !anchor) return null;
  if (repeat.count != null && sent >= repeat.count) return null;

  const from = after < anchor ? anchor : after;
  for (let i = 1; i <= HORIZON_DAYS; i++) {
    const date = addDays(from, i);
    if (repeat.until && date > repeat.until) return null;
    if (matches(repeat, anchor, date)) return date;
  }
  return null;
}

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** A plain-English description of the rule, for review screens and campaign pages. */
export function describeRepeat(repeat: Repeat, anchor: string | null): string {
  if (!isRecurring(repeat)) return 'Sends once';
  const every = Math.max(1, repeat.every || 1);
  let text: string;

  if (repeat.interval === 'daily') {
    text = every === 1 ? 'Every day' : `Every ${every} days`;
  } else if (repeat.interval === 'weekly') {
    const days = (repeat.days?.length ? repeat.days : anchor ? [weekday(anchor)] : [])
      .slice()
      .sort((a, b) => a - b)
      .map((d) => WEEKDAY_NAMES[d - 1])
      .filter(Boolean);
    const on = days.length ? ` on ${days.join(', ')}` : '';
    text = every === 1 ? `Every week${on}` : `Every ${every} weeks${on}`;
  } else {
    const day = repeat.dayOfMonth ?? (anchor ? dayOfMonth(anchor) : 1);
    const on = ` on the ${ordinal(day)}`;
    text = every === 1 ? `Every month${on}` : `Every ${every} months${on}`;
  }

  if (repeat.count != null) text += `, ${repeat.count} time${repeat.count === 1 ? '' : 's'} in total`;
  else if (repeat.until) text += `, until ${repeat.until}`;
  return text;
}

/** Pulls the rule off a campaign row, defaulting anything missing or invalid. */
export function repeatOf(campaign: {
  repeat_interval?: string | null;
  repeat_every?: number | null;
  repeat_days?: number[] | null;
  repeat_day_of_month?: number | null;
  repeat_until?: unknown;
  repeat_count?: number | null;
}): Repeat {
  const interval = ['daily', 'weekly', 'monthly'].includes(String(campaign.repeat_interval))
    ? (campaign.repeat_interval as RepeatInterval)
    : 'none';
  return {
    interval,
    every: Math.min(52, Math.max(1, Number(campaign.repeat_every ?? 1) || 1)),
    days: (campaign.repeat_days ?? []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7),
    dayOfMonth:
      campaign.repeat_day_of_month == null
        ? null
        : Math.min(31, Math.max(1, Number(campaign.repeat_day_of_month))),
    until: toDateString(campaign.repeat_until),
    count: campaign.repeat_count == null ? null : Math.max(1, Number(campaign.repeat_count)),
  };
}
