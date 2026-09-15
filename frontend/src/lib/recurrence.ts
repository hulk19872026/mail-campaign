/**
 * How often a campaign sends, worked out in the browser so the calendar
 * responds as the rule is edited.
 *
 * Dates are plain 'YYYY-MM-DD' strings — no Date objects are handed around,
 * because a local-midnight Date shifts a day either way depending on the
 * timezone, and a sending day is a calendar day, not an instant.
 *
 * These rules mirror backend/src/services/recurrence.ts, which is what actually
 * schedules the sends. Change one, change the other.
 */

export type RepeatInterval = 'none' | 'daily' | 'weekly' | 'monthly';

export type Repeat = {
  interval: RepeatInterval;
  every: number;
  /** ISO weekdays, 1 = Monday … 7 = Sunday. Weekly only. */
  days: number[];
  /** 1–31, clamped to the last day of shorter months. Monthly only. */
  dayOfMonth: number | null;
  until: string | null;
  count: number | null;
};

export const NO_REPEAT: Repeat = {
  interval: 'none',
  every: 1,
  days: [],
  dayOfMonth: null,
  until: null,
  count: null,
};

const DAY_MS = 86_400_000;
const HORIZON_DAYS = 1100;

export const WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function isRecurring(repeat: Pick<Repeat, 'interval'>): boolean {
  return repeat.interval !== 'none';
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

export function addMonths(date: string, months: number): string {
  const y = parseInt(date.slice(0, 4), 10);
  const m = parseInt(date.slice(5, 7), 10);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-01`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** 1 = Monday … 7 = Sunday. */
export function weekday(date: string): number {
  const day = new Date(utc(date)).getUTCDay();
  return day === 0 ? 7 : day;
}

function weekStart(date: string): string {
  return addDays(date, 1 - weekday(date));
}

function dayOfMonth(date: string): number {
  return parseInt(date.slice(8, 10), 10);
}

export function daysInMonth(date: string): number {
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

/** Today, as a calendar day in the browser's own timezone. */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
}

export function monthLabel(date: string): string {
  return `${MONTH_NAMES[parseInt(date.slice(5, 7), 10) - 1]} ${date.slice(0, 4)}`;
}

export function formatDay(date: string): string {
  const d = new Date(utc(date));
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function matches(repeat: Repeat, anchor: string, date: string): boolean {
  if (!isRecurring(repeat) || date < anchor) return false;
  const every = Math.max(1, repeat.every || 1);

  if (repeat.interval === 'daily') return daysBetween(anchor, date) % every === 0;

  if (repeat.interval === 'weekly') {
    const days = repeat.days.length ? repeat.days : [weekday(anchor)];
    if (!days.includes(weekday(date))) return false;
    return (daysBetween(weekStart(anchor), weekStart(date)) / 7) % every === 0;
  }

  const wanted = repeat.dayOfMonth ?? dayOfMonth(anchor);
  if (dayOfMonth(date) !== Math.min(wanted, daysInMonth(date))) return false;
  return monthsBetween(anchor, date) % every === 0;
}

/** The sending days from the first one onwards. */
export function occurrencesFrom(repeat: Repeat, anchor: string, limit = 24): string[] {
  const dates: string[] = [];
  if (!anchor) return dates;

  const remaining = repeat.count == null ? Infinity : Math.max(0, repeat.count);
  if (remaining <= 0) return dates;
  dates.push(anchor);

  for (let i = 1; i <= HORIZON_DAYS && dates.length < limit && dates.length < remaining; i++) {
    const date = addDays(anchor, i);
    if (repeat.until && date > repeat.until) break;
    if (matches(repeat, anchor, date)) dates.push(date);
  }
  return dates;
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

export function describeRepeat(repeat: Repeat, anchor: string | null): string {
  if (!isRecurring(repeat)) return 'Sends once';
  const every = Math.max(1, repeat.every || 1);
  let text: string;

  if (repeat.interval === 'daily') {
    text = every === 1 ? 'Every day' : `Every ${every} days`;
  } else if (repeat.interval === 'weekly') {
    const days = (repeat.days.length ? repeat.days : anchor ? [weekday(anchor)] : [])
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
  else if (repeat.until) text += `, until ${formatDay(repeat.until)}`;
  return text;
}

/** The grid a month calendar draws: whole weeks, Monday first, padded either side. */
export function monthGrid(month: string): string[] {
  const first = `${month.slice(0, 7)}-01`;
  const start = addDays(first, 1 - weekday(first));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function isSameMonth(date: string, month: string): boolean {
  return date.slice(0, 7) === month.slice(0, 7);
}
