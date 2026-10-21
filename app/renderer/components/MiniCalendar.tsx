import { useState } from 'react';
import { addDays, cx, monthYear, sameDay, startOfDay, startOfWeek } from '../util';
import { Icon } from './Icon';

export function MiniCalendar({ value, onPick, rangeStart, rangeEnd, busyDays }: { value: number; onPick: (d: number) => void; rangeStart?: number; rangeEnd?: number; busyDays?: Set<number> }) {
  const [month, setMonth] = useState(() => {
    const d = new Date(value);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
  const first = startOfWeek(month, 1);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i));
  const m = new Date(month).getMonth();
  const shift = (n: number) => {
    const d = new Date(month);
    setMonth(new Date(d.getFullYear(), d.getMonth() + n, 1).getTime());
  };
  const rows = cells[35] && new Date(cells[35]).getMonth() !== m ? cells.slice(0, 35) : cells;
  return (
    <section className="mini-cal" aria-label={monthYear(month)}>
      <div className="head">
        <strong>{monthYear(month)}</strong>
        <span>
          <button className="icon-btn" style={{ width: 26, height: 26 }} aria-label="Previous month" onClick={() => shift(-1)}>
            <Icon name="chevLeft" size={14} />
          </button>
          <button className="icon-btn" style={{ width: 26, height: 26 }} aria-label="Next month" onClick={() => shift(1)}>
            <Icon name="chevRight" size={14} />
          </button>
        </span>
      </div>
      <div className="grid">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="dow" aria-hidden>
            {d}
          </span>
        ))}
        {rows.map((d) => (
          <button
            key={d}
            className={cx(
              'day',
              new Date(d).getMonth() !== m && 'other',
              sameDay(d, Date.now()) && 'today',
              rangeStart !== undefined && rangeEnd !== undefined && d >= startOfDay(rangeStart) && d < rangeEnd && !sameDay(d, Date.now()) && 'inrange',
              busyDays?.has(startOfDay(d)) && 'has'
            )}
            aria-label={new Date(d).toDateString()}
            onClick={() => onPick(d)}
          >
            {new Date(d).getDate()}
          </button>
        ))}
      </div>
    </section>
  );
}
