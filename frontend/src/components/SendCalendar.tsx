import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Repeat,
  addMonths,
  formatDay,
  isRecurring,
  isSameMonth,
  monthGrid,
  monthLabel,
  occurrencesFrom,
  todayIso,
} from '../lib/recurrence';

/**
 * The month view of a campaign's sending days. It is the control, not a
 * picture of one: clicking a day moves the first send there, and every later
 * send follows from it, so the effect of a rule is visible before anything is
 * committed.
 */
export default function SendCalendar({
  startDate,
  repeat,
  onPickDate,
}: {
  startDate: string;
  repeat: Repeat;
  onPickDate?: (date: string) => void;
}) {
  const today = todayIso();
  const anchor = startDate || today;
  const [month, setMonth] = useState(() => `${anchor.slice(0, 7)}-01`);

  // A year and a bit of sending days is more than enough to fill any month the
  // owner is likely to page to, and keeps the highlighting honest about an
  // "after N sends" rule running out.
  const sendDays = useMemo(
    () => new Set(occurrencesFrom(repeat, anchor, 400)),
    [repeat, anchor]
  );
  const upcoming = useMemo(() => occurrencesFrom(repeat, anchor, 5), [repeat, anchor]);
  const grid = useMemo(() => monthGrid(month), [month]);

  return (
    <div className="rounded-xl2 border border-line bg-ink p-4">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth((m) => addMonths(m, -1))}
          className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-white"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-semibold text-white">{monthLabel(month)}</p>
        <button
          type="button"
          onClick={() => setMonth((m) => addMonths(m, 1))}
          className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-white"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.map((date) => {
          const sends = sendDays.has(date);
          const isStart = date === anchor;
          const outside = !isSameMonth(date, month);
          const past = date < today;

          return (
            <button
              key={date}
              type="button"
              disabled={!onPickDate || past}
              onClick={() => onPickDate?.(date)}
              title={sends ? `Sends on ${formatDay(date)}` : formatDay(date)}
              className={`aspect-square rounded-lg border text-xs font-medium transition-colors ${
                isStart
                  ? 'border-accent bg-accent text-accent-text'
                  : sends
                  ? 'border-accent/50 bg-accent/10 text-accent'
                  : outside
                  ? 'border-transparent text-muted/40'
                  : past
                  ? 'border-transparent text-muted/60'
                  : 'border-line text-soft hover:border-[#33414F] hover:text-white'
              } ${date === today && !isStart ? 'ring-1 ring-inset ring-soft/40' : ''}`}
            >
              {parseInt(date.slice(8, 10), 10)}
            </button>
          );
        })}
      </div>

      <div className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs">
        <p className="flex flex-wrap items-center gap-3 text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> First send
          </span>
          {isRecurring(repeat) && (
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm border border-accent/50 bg-accent/10" /> Repeats
            </span>
          )}
          {onPickDate && <span>Click a day to start there</span>}
        </p>
        {isRecurring(repeat) && (
          <p className="text-soft">
            Next sends: {upcoming.map(formatDay).join(' · ')}
            {upcoming.length >= 5 ? ' …' : ''}
          </p>
        )}
      </div>
    </div>
  );
}
