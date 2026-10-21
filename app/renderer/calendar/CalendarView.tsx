// The Calendar module: Day, Work week, Week, Month and Schedule views over every selected calendar.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalEvent, CalendarInfo } from '../../shared/types';
import { call, useLive } from '../api';
import { Icon } from '../components/Icon';
import { MiniCalendar } from '../components/MiniCalendar';
import { Rail, Ribbon, StatusBar, TitleBar } from '../components/Shell';
import { Dialog, Field } from '../components/ui';
import { fail, notify, useApp } from '../state';
import { addDays, cx, dayName, longDay, monthYear, rangeTitle, sameDay, startOfDay, startOfWeek, time } from '../util';

const HOUR = 48; // pixels per hour
type View = 'day' | 'workweek' | 'week' | 'month' | 'schedule';

export function openEventEditor(params: { event?: CalEvent; draft?: Partial<CalEvent> }) {
  void call('app.openWindow', 'event', {
    ...(params.event ? { key: JSON.stringify({ accountId: params.event.accountId, calendarId: params.event.calendarId, id: params.event.id }) } : {}),
    ...(params.draft ? { draft: JSON.stringify(params.draft) } : {})
  });
}

function range(view: View, date: number, workWeek: number[]): { start: number; end: number; days: number[] } {
  if (view === 'day') return { start: startOfDay(date), end: addDays(startOfDay(date), 1), days: [startOfDay(date)] };
  if (view === 'week' || view === 'workweek') {
    const s = startOfWeek(date, 1);
    const days = Array.from({ length: 7 }, (_, i) => addDays(s, i)).filter((d) => view === 'week' || workWeek.includes(new Date(d).getDay()));
    return { start: days[0], end: addDays(days[days.length - 1], 1), days };
  }
  if (view === 'month') {
    const first = new Date(date);
    first.setDate(1);
    const s = startOfWeek(first.getTime(), 1);
    return { start: s, end: addDays(s, 42), days: Array.from({ length: 42 }, (_, i) => addDays(s, i)) };
  }
  const s = startOfDay(date);
  return { start: s, end: addDays(s, 30), days: Array.from({ length: 30 }, (_, i) => addDays(s, i)) };
}

export function CalendarView() {
  const { calDate, setCalDate, settings, updateSettings, accounts, openDialog } = useApp();
  const view = settings.calendarView as View;
  const setView = (v: View) => updateSettings({ calendarView: v });
  const r = useMemo(() => range(view, calDate, settings.workWeek), [view, calDate, settings.workWeek]);
  const [events] = useLive(() => call('calendar.events', r.start - 864e5, r.end + 864e5), ['calendar'], [r.start, r.end], [] as CalEvent[]);
  const [cals] = useLive(() => call('calendar.calendars'), ['calendar', 'accounts'], [], [] as CalendarInfo[]);
  const [peek, setPeek] = useState<{ ev: CalEvent; x: number; y: number } | null>(null);

  const step = (dir: number) => {
    if (view === 'day') setCalDate(addDays(calDate, dir));
    else if (view === 'month') {
      const d = new Date(calDate);
      d.setMonth(d.getMonth() + dir);
      setCalDate(d.getTime());
    } else setCalDate(addDays(calDate, dir * (view === 'schedule' ? 30 : 7)));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'n') { e.preventDefault(); openEventEditor({ draft: defaultDraft() }); }
      else if (e.altKey && e.key === 'ArrowLeft') step(-1);
      else if (e.altKey && e.key === 'ArrowRight') step(1);
      else if (ctrl && e.altKey && ['1', '2', '3', '4', '5'].includes(e.key)) setView((['day', 'workweek', 'week', 'month', 'schedule'] as View[])[Number(e.key) - 1]);
      else if (e.key === 'Escape') setPeek(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const defaultDraft = (start?: number, end?: number, allDay = false): Partial<CalEvent> => {
    const s = start ?? (() => {
      const d = new Date();
      d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
      return d.getTime();
    })();
    const primary = cals.find((c) => c.primary);
    return { accountId: primary?.accountId ?? accounts[0]?.id, calendarId: primary?.id ?? 'primary', start: s, end: end ?? s + 30 * 60_000, allDay, attendees: [] };
  };

  const busyDays = useMemo(() => new Set(events.filter((e) => e.eventType === 'default').map((e) => startOfDay(e.start))), [events]);
  const title = view === 'month' ? monthYear(calDate) : view === 'day' ? longDay(calDate) + ' ' + new Date(calDate).getFullYear() : rangeTitle(r.start, r.end);
  const viewBtn = (v: View, label: string, icon: string) => ({ label, icon, onClick: () => setView(v), outline: view === v });

  return (
    <>
      <TitleBar placeholder="Search calendar" onSearch={(q) => { if (q) { setView('schedule'); } }} />
      <Ribbon
        groups={[
          { label: 'New', buttons: [
            { label: 'New event', icon: 'plus', primary: true, onClick: () => openEventEditor({ draft: defaultDraft() }), title: 'New event (Ctrl+N)' },
            { label: 'Meet meeting', icon: 'video', onClick: () => openEventEditor({ draft: { ...defaultDraft(), meetUrl: 'new' } }) }
          ] },
          { label: 'Go to', buttons: [
            { label: 'Today', icon: 'calendar', onClick: () => setCalDate(Date.now()) },
            { label: 'Previous', icon: 'chevLeft', iconOnly: true, onClick: () => step(-1), title: 'Previous (Alt+Left)' },
            { label: 'Next', icon: 'chevRight', iconOnly: true, onClick: () => step(1), title: 'Next (Alt+Right)' }
          ] },
          { label: 'Arrange', buttons: [
            viewBtn('day', 'Day', 'list'), viewBtn('workweek', 'Work week', 'grid'), viewBtn('week', 'Week', 'grid'), viewBtn('month', 'Month', 'calendar'), viewBtn('schedule', 'Schedule', 'list')
          ] },
          { label: 'Manage', buttons: [
            { label: 'Scheduling Assistant', icon: 'people', onClick: () => openEventEditor({ draft: { ...defaultDraft(), title: '' }, }) },
            { label: 'Working location', icon: 'building', menu: () => ['Office', 'Home', 'Other…'].map((p) => ({
              label: `${p} today`, icon: p === 'Home' ? 'home' : 'building', onClick: () => {
                const label = p === 'Other…' ? window.prompt('Where are you working today?') : p;
                if (!label) return;
                const d = defaultDraft(startOfDay(Date.now()), addDays(startOfDay(Date.now()), 1), true);
                void call('calendar.save', { event: { ...(d as CalEvent), title: label, eventType: 'workingLocation', workingLocation: label }, notify: false }).then(() => notify('Working location set.')).catch(fail);
              }
            })) },
            { label: 'Status', icon: 'plane', menu: () => [
              { label: 'Out of office…', icon: 'plane', onClick: () => openEventEditor({ draft: { ...defaultDraft(startOfDay(Date.now()), addDays(startOfDay(Date.now()), 1), true), title: 'Out of office', eventType: 'outOfOffice', autoDecline: true } }) },
              { label: 'Focus time…', icon: 'focus', onClick: () => openEventEditor({ draft: { ...defaultDraft(), title: 'Focus time', eventType: 'focusTime', autoDecline: true, end: (defaultDraft().start ?? Date.now()) + 2 * 3600_000 } }) }
            ] },
            { label: 'Open calendar', icon: 'person', title: "Open a colleague's calendar", onClick: () => openDialog('subscribe') },
            { label: 'Share', icon: 'link', onClick: () => call('app.openExternal', 'https://calendar.google.com/calendar/r/settings') }
          ] }
        ]}
      />
      <div className="body">
        <Rail />
        <nav className="pane folder-pane" aria-label="Calendars" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <MiniCalendar value={calDate} onPick={setCalDate} rangeStart={r.start} rangeEnd={view === 'month' || view === 'schedule' ? undefined : r.end} busyDays={busyDays} />
          <CalendarList cals={cals} />
        </nav>
        <main className="cal-main" aria-label={title}>
          <div className="cal-head">
            <button className="icon-btn" aria-label="Previous" onClick={() => step(-1)}><Icon name="chevLeft" /></button>
            <button className="icon-btn" aria-label="Next" onClick={() => step(1)}><Icon name="chevRight" /></button>
            <h1>{title}</h1>
            <span style={{ color: 'var(--muted)' }}>{Intl.DateTimeFormat().resolvedOptions().timeZone.replace('_', ' ')}</span>
            <span style={{ flex: 1 }} />
            <span className="cal-legend"><span className="sw" style={{ background: 'repeating-linear-gradient(45deg,#DCE3EE 0 3px,#fff 3px 6px)', border: '1px solid #B9C5D8' }} />Focus time</span>
            <span className="cal-legend"><span className="sw" style={{ background: '#EFE9F4', border: '1px solid #C6B6D6' }} />Out of office</span>
            <span className="cal-legend"><span className="sw" style={{ border: '1px dashed var(--muted)' }} />Not yet answered</span>
          </div>
          {(view === 'day' || view === 'week' || view === 'workweek') && (
            <WeekView days={r.days} events={events} onPeek={(ev, x, y) => setPeek({ ev, x, y })} onCreate={(s, e, allDay) => openEventEditor({ draft: defaultDraft(s, e, allDay) })} />
          )}
          {view === 'month' && <MonthView days={r.days} month={new Date(calDate).getMonth()} events={events} onPeek={(ev, x, y) => setPeek({ ev, x, y })} onDay={(d) => { setCalDate(d); setView('day'); }} />}
          {view === 'schedule' && <ScheduleView days={r.days} events={events} onPeek={(ev, x, y) => setPeek({ ev, x, y })} />}
        </main>
      </div>
      <StatusBar left={<span>{events.filter((e) => e.start >= r.start && e.start < r.end && e.eventType === 'default').length} events in view</span>} />
      {peek && <EventPeek ev={peek.ev} x={peek.x} y={peek.y} onClose={() => setPeek(null)} />}
    </>
  );
}

function CalendarList({ cals }: { cals: CalendarInfo[] }) {
  const { accounts } = useApp();
  return (
    <div>
      {accounts.map((a) => {
        const mine = cals.filter((c) => c.accountId === a.id);
        if (!mine.length) return null;
        const group = (label: string, list: CalendarInfo[]) =>
          list.length ? (
            <div key={label} style={{ marginBottom: 10 }}>
              <div className="pane-heading" style={{ padding: '2px 0 4px' }}>{label}</div>
              {list.map((c) => (
                <label key={c.id} className="check" style={{ margin: '4px 0' }}>
                  <input type="checkbox" checked={c.selected} style={{ accentColor: c.color }} onChange={(e) => call('calendar.setSelected', c.accountId, c.id, e.target.checked)} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                </label>
              ))}
            </div>
          ) : null;
        return (
          <div key={a.id}>
            {accounts.length > 1 && <div style={{ fontSize: 12, fontWeight: 600, margin: '6px 0' }}>{a.email}</div>}
            {group('My calendars', mine.filter((c) => c.kind === 'mine'))}
            {group('Colleagues and shared', mine.filter((c) => c.kind === 'other'))}
            {group('Rooms', mine.filter((c) => c.kind === 'resource'))}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Week / day ----------

interface Placed {
  ev: CalEvent;
  top: number;
  height: number;
  col: number;
  cols: number;
}

function layoutDay(events: CalEvent[], day: number): Placed[] {
  const s = startOfDay(day);
  const e = addDays(s, 1);
  const list = events
    .filter((x) => !x.allDay && x.eventType !== 'workingLocation' && x.start < e && x.end > s)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = 0;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((p) => p.col + 1));
    cluster.forEach((p) => (p.cols = cols));
    cluster = [];
  };
  for (const ev of list) {
    const start = Math.max(ev.start, s);
    const end = Math.min(ev.end, e);
    if (start >= clusterEnd) flush();
    const used = new Set(cluster.filter((p) => p.ev.end > start).map((p) => p.col));
    let col = 0;
    while (used.has(col)) col++;
    const p = { ev, top: ((start - s) / 3600_000) * HOUR, height: Math.max(((end - start) / 3600_000) * HOUR - 2, 18), col, cols: 1 };
    cluster.push(p);
    placed.push(p);
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return placed;
}

function evClass(ev: CalEvent): string {
  return cx(
    'ev',
    ev.eventType === 'focusTime' && 'focus',
    ev.eventType === 'outOfOffice' && 'ooo',
    ev.myResponse === 'needsAction' && 'needs',
    ev.myResponse === 'tentative' && 'tentative',
    ev.myResponse === 'declined' && 'declined'
  );
}

function evStyle(ev: CalEvent): React.CSSProperties {
  if (ev.eventType === 'focusTime' || ev.eventType === 'outOfOffice') return {};
  const c = ev.color ?? '#1F3A5F';
  return { background: c + '26', borderLeft: `3px solid ${c}`, color: 'var(--text)' };
}

function WeekView({ days, events, onPeek, onCreate }: { days: number[]; events: CalEvent[]; onPeek: (e: CalEvent, x: number, y: number) => void; onCreate: (s: number, e: number, allDay?: boolean) => void }) {
  const { settings } = useApp();
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ day: number; from: number; to: number } | null>(null);
  const [move, setMove] = useState<{ ev: CalEvent; dayIndex: number; offsetMin: number; startY: number; moved: boolean } | null>(null);
  const [now, setNow] = useState(Date.now());
  const tz2 = settings.secondTimeZone;
  const gutter = tz2 ? 104 : 56;
  const cols = `${gutter}px repeat(${days.length}, minmax(0, 1fr))`;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = Math.max(0, (settings.dayStartHour - 0.5) * HOUR);
  }, [settings.dayStartHour]);

  const minutesAt = (clientY: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(24 * 60, Math.round(((clientY - rect.top) / HOUR) * 60 / 15) * 15));
  };

  const allDay = (d: number) => events.filter((e) => (e.allDay || e.end - e.start >= 864e5) && e.start < addDays(d, 1) && e.end > d);

  const commitMove = async (ev: CalEvent, dayIndex: number, startMin: number) => {
    const dur = ev.end - ev.start;
    const start = days[dayIndex] + startMin * 60_000;
    if (start === ev.start) return;
    if (!ev.canEdit) return notify("You can't move this event — you're not the organiser.", 'error');
    const scope = ev.recurringEventId ? (window.confirm('Move only this occurrence? Choose Cancel to keep it where it is.') ? 'this' : null) : 'this';
    if (!scope) return;
    await call('calendar.save', { event: { ...ev, start, end: start + dur }, scope: 'this' }).then(() => notify('Event moved. Attendees have been updated.')).catch(fail);
  };

  return (
    <div className="week" onMouseUp={() => {
      if (drag) {
        const [a, b] = [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to) + 30];
        onCreate(drag.day + a * 60_000, drag.day + b * 60_000);
        setDrag(null);
      }
    }}>
      <div className="week-head" style={{ gridTemplateColumns: cols }}>
        <div style={{ borderLeft: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', gap: 8, fontSize: 10, color: 'var(--muted)' }}>
          {tz2 && <span>{tz2.split('/').pop()?.replace('_', ' ')}</span>}
          <span>{Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop()?.replace('_', ' ')}</span>
        </div>
        {days.map((d) => {
          const wl = events.find((e) => e.eventType === 'workingLocation' && sameDay(e.start, d));
          const ooo = events.find((e) => e.eventType === 'outOfOffice' && e.start <= d && e.end > d);
          return (
            <div key={d} className={sameDay(d, now) ? 'today' : ''}>
              <div className="dow">{dayName(d)}</div>
              <div className="num">{new Date(d).getDate()}</div>
              {(wl || ooo) && <span className="loc-chip" style={ooo ? { background: '#EFE9F4', color: '#4A2F5E' } : undefined}>{ooo ? 'Out of office' : wl!.workingLocation ?? wl!.title}</span>}
            </div>
          );
        })}
      </div>
      <div className="week-allday" style={{ gridTemplateColumns: cols }}>
        <div className="gutter">All day</div>
        {days.map((d) => (
          <div key={d} onDoubleClick={() => onCreate(d, addDays(d, 1), true)}>
            {allDay(d).filter((e) => e.eventType !== 'workingLocation').map((e) => (
              <button key={e.accountId + e.id} className="allday-ev" style={{ background: (e.eventType === 'outOfOffice' ? '#7A4E9C' : e.color ?? '#1F3A5F') + '30', color: 'var(--text)' }} onClick={(ev) => onPeek(e, ev.clientX, ev.clientY)}>
                {e.title}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="week-scroll" ref={scroller}>
        <div className="week-grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR }}>
          <div className="hours" style={{ display: 'grid', gridTemplateColumns: tz2 ? '1fr 1fr' : '1fr' }}>
            {tz2 && (
              <div>
                {Array.from({ length: 24 }, (_, h) => {
                  const ref = new Date(days[0]);
                  ref.setHours(h, 0, 0, 0);
                  return <div key={h} style={{ height: HOUR }}>{h === 0 ? '' : ref.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: tz2 })}</div>;
                })}
              </div>
            )}
            <div>
              {Array.from({ length: 24 }, (_, h) => <div key={h} style={{ height: HOUR }}>{h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}</div>)}
            </div>
          </div>
          {days.map((d, di) => {
            const placed = layoutDay(events, d);
            const isToday = sameDay(d, now);
            const workDay = settings.workWeek.includes(new Date(d).getDay());
            return (
              <div
                key={d}
                className={cx('day-col', isToday && 'today')}
                style={{ backgroundImage: 'repeating-linear-gradient(to bottom, var(--border-soft) 0 1px, transparent 1px ' + HOUR + 'px)' }}
                onMouseDown={(e) => {
                  if ((e.target as HTMLElement).closest('.ev') || e.button !== 0) return;
                  const m = minutesAt(e.clientY, e.currentTarget);
                  setDrag({ day: d, from: Math.floor(m / 30) * 30, to: Math.floor(m / 30) * 30 });
                }}
                onMouseMove={(e) => {
                  if (drag && drag.day === d) setDrag({ ...drag, to: Math.floor(minutesAt(e.clientY, e.currentTarget) / 30) * 30 });
                  if (move) {
                    const m = minutesAt(e.clientY, e.currentTarget) - move.offsetMin;
                    if (Math.abs(e.clientY - move.startY) > 4 || di !== move.dayIndex) setMove({ ...move, dayIndex: di, offsetMin: move.offsetMin, moved: true, startY: move.startY, ev: { ...move.ev, start: d + Math.max(0, m) * 60_000, end: d + Math.max(0, m) * 60_000 + (move.ev.end - move.ev.start) } });
                  }
                }}
                onMouseUp={(e) => {
                  if (move) {
                    const m = minutesAt(e.clientY, e.currentTarget) - move.offsetMin;
                    const orig = events.find((x) => x.id === move.ev.id && x.calendarId === move.ev.calendarId)!;
                    if (move.moved && orig) void commitMove(orig, di, Math.max(0, Math.round(m / 15) * 15));
                    setMove(null);
                  }
                }}
              >
                {workDay ? (
                  <>
                    <div className="nonwork" style={{ top: 0, height: settings.dayStartHour * HOUR }} />
                    <div className="nonwork" style={{ top: settings.dayEndHour * HOUR, height: (24 - settings.dayEndHour) * HOUR }} />
                  </>
                ) : (
                  <div className="nonwork" style={{ top: 0, height: 24 * HOUR }} />
                )}
                {placed.map((p) => {
                  const ghost = move?.moved && move.ev.id === p.ev.id && move.ev.calendarId === p.ev.calendarId;
                  return (
                    <button
                      key={p.ev.accountId + p.ev.calendarId + p.ev.id}
                      className={evClass(p.ev)}
                      style={{ ...evStyle(p.ev), top: p.top, height: p.height, left: `calc(${(p.col / p.cols) * 100}% + 2px)`, width: `calc(${100 / p.cols}% - 6px)`, opacity: ghost ? 0.35 : undefined }}
                      title={`${p.ev.title}\n${time(p.ev.start)}–${time(p.ev.end)}${p.ev.location ? '\n' + p.ev.location : ''}`}
                      onMouseDown={(e) => {
                        if (e.button !== 0 || !p.ev.canEdit) return;
                        e.stopPropagation();
                        const col = (e.currentTarget.parentElement as HTMLElement);
                        const m = minutesAt(e.clientY, col);
                        setMove({ ev: p.ev, dayIndex: di, offsetMin: m - (p.ev.start - d) / 60_000, startY: e.clientY, moved: false });
                      }}
                      onClick={(e) => {
                        if (move?.moved) return;
                        onPeek(p.ev, e.clientX, e.clientY);
                      }}
                      onDoubleClick={() => openEventEditor({ event: p.ev })}
                    >
                      <span className="t">{p.ev.title}</span>
                      {p.height > 30 && <span className="m">{time(p.ev.start)}–{time(p.ev.end)}{p.ev.location ? ' · ' + p.ev.location : p.ev.meetUrl ? ' · Meet' : ''}</span>}
                    </button>
                  );
                })}
                {move?.moved && move.dayIndex === di && (
                  <div className="ev draft" style={{ top: ((move.ev.start - d) / 3600_000) * HOUR, height: ((move.ev.end - move.ev.start) / 3600_000) * HOUR - 2, left: 2, right: 6 }}>
                    <span className="t">{move.ev.title}</span>
                    <span className="m">{time(move.ev.start)}–{time(move.ev.end)}</span>
                  </div>
                )}
                {drag && drag.day === d && (
                  <div className="ev draft" style={{ top: (Math.min(drag.from, drag.to) / 60) * HOUR, height: ((Math.abs(drag.to - drag.from) + 30) / 60) * HOUR - 2, left: 2, right: 6 }}>
                    <span className="t">New event</span>
                    <span className="m">{time(d + Math.min(drag.from, drag.to) * 60_000)}–{time(d + (Math.max(drag.from, drag.to) + 30) * 60_000)}</span>
                  </div>
                )}
                {isToday && <div className="now-line" style={{ top: ((now - d) / 3600_000) * HOUR }} aria-label={'Now, ' + time(now)} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------- Month ----------

function MonthView({ days, month, events, onPeek, onDay }: { days: number[]; month: number; events: CalEvent[]; onPeek: (e: CalEvent, x: number, y: number) => void; onDay: (d: number) => void }) {
  return (
    <div className="month">
      {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => <div key={d} className="dow-h">{d}</div>)}
      {days.map((d) => {
        const evs = events.filter((e) => e.eventType !== 'workingLocation' && e.start < addDays(d, 1) && e.end > d).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
        const shown = evs.slice(0, 4);
        return (
          <div key={d} className={cx('cell', new Date(d).getMonth() !== month && 'other', sameDay(d, Date.now()) && 'today')} onDoubleClick={() => onDay(d)}>
            <button className="n" onClick={() => onDay(d)} aria-label={longDay(d)}>{new Date(d).getDate()}</button>
            {shown.map((e) => (
              <button key={e.accountId + e.id} className="mev" onClick={(ev) => onPeek(e, ev.clientX, ev.clientY)} style={e.allDay ? { background: (e.color ?? '#1F3A5F') + '30' } : undefined}>
                {!e.allDay && <span className="d" style={{ background: e.color ?? 'var(--accent)' }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{!e.allDay && <b style={{ fontWeight: 600 }}>{time(e.start)} </b>}{e.title}</span>
              </button>
            ))}
            {evs.length > shown.length && <button className="mev" style={{ color: 'var(--muted)' }} onClick={() => onDay(d)}>+{evs.length - shown.length} more</button>}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Schedule ----------

function ScheduleView({ days, events, onPeek }: { days: number[]; events: CalEvent[]; onPeek: (e: CalEvent, x: number, y: number) => void }) {
  const { search } = useApp();
  const q = search.toLowerCase();
  return (
    <div className="schedule">
      {days.map((d) => {
        const evs = events.filter((e) => e.eventType !== 'workingLocation' && e.start < addDays(d, 1) && e.end > d && (!q || e.title.toLowerCase().includes(q) || (e.location ?? '').toLowerCase().includes(q)));
        if (!evs.length) return null;
        return (
          <div key={d} className="day">
            <h3 style={sameDay(d, Date.now()) ? { color: 'var(--accent)' } : undefined}>{longDay(d)}</h3>
            <div>
              {evs.map((e) => (
                <button key={e.accountId + e.id} className="item" onClick={(ev) => onPeek(e, ev.clientX, ev.clientY)}>
                  <span style={{ width: 110, color: 'var(--muted)' }}>{e.allDay ? 'All day' : `${time(e.start)}–${time(e.end)}`}</span>
                  <span className="dot" style={{ background: e.color ?? 'var(--accent)', marginTop: 4 }} />
                  <span><b>{e.title}</b>{e.location ? <span style={{ color: 'var(--muted)' }}> · {e.location}</span> : null}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Peek ----------

function EventPeek({ ev, x, y, onClose }: { ev: CalEvent; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 12), y: Math.min(y, window.innerHeight - r.height - 12) });
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    setTimeout(() => window.addEventListener('mousedown', off), 0);
    return () => window.removeEventListener('mousedown', off);
  }, [x, y, onClose]);
  const respond = (r: 'accepted' | 'tentative' | 'declined') => call('calendar.respond', ev.accountId, ev.calendarId, ev.id, r).then(onClose).catch(fail);
  const others = ev.attendees.filter((a) => !a.resource);
  const rooms = ev.attendees.filter((a) => a.resource);
  return (
    <div className="peek" ref={ref} style={{ left: pos.x, top: pos.y }} role="dialog" aria-label={ev.title}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span className="dot" style={{ background: ev.color ?? 'var(--accent)', marginTop: 6, width: 10, height: 10, flexBasis: 10 }} />
        <div style={{ flex: 1 }}>
          <h3>{ev.title}</h3>
          <div style={{ color: 'var(--muted)' }}>{ev.allDay ? `${longDay(ev.start)}${ev.end - ev.start > 864e5 ? ' – ' + longDay(ev.end - 1) : ''} · All day` : `${longDay(ev.start)} · ${time(ev.start)}–${time(ev.end)}`}</div>
        </div>
        <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
      </div>
      {ev.meetUrl && (
        <div className="row-i">
          <Icon name="video" />
          <button className="btn primary small" onClick={() => call('app.openExternal', ev.meetUrl!)}>Join with Google Meet</button>
        </div>
      )}
      {(ev.location || rooms.length > 0) && <div className="row-i"><Icon name="location" /><span>{[ev.location, ...rooms.map((r) => r.name ?? r.email)].filter(Boolean).join(' · ')}</span></div>}
      {ev.recurringEventId && <div className="row-i"><Icon name="repeat" /><span>Repeating event</span></div>}
      {ev.eventType === 'outOfOffice' && <div className="row-i"><Icon name="plane" /><span>Out of office{ev.autoDecline ? ' · declining new invitations' : ''}</span></div>}
      {ev.eventType === 'focusTime' && <div className="row-i"><Icon name="focus" /><span>Focus time{ev.autoDecline ? ' · declining conflicting invitations' : ''}</span></div>}
      {others.length > 0 && (
        <div className="row-i">
          <Icon name="people" />
          <div>
            <div>{others.length} guests · {others.filter((a) => a.response === 'accepted').length} yes{others.some((a) => a.response === 'needsAction') ? ` · ${others.filter((a) => a.response === 'needsAction').length} awaiting` : ''}</div>
            <div style={{ maxHeight: 110, overflow: 'auto', marginTop: 4 }}>
              {others.map((a) => (
                <div key={a.email} style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  {a.response === 'accepted' ? '✓' : a.response === 'declined' ? '✗' : a.response === 'tentative' ? '?' : '·'} {a.name ?? a.email}{a.organizer ? ' (organiser)' : ''}{a.optional ? ' (optional)' : ''}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {ev.description && <div className="row-i"><Icon name="list" /><span style={{ whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto', display: 'block' }}>{ev.description.replace(/<[^>]+>/g, '')}</span></div>}
      {ev.myResponse && ev.organizer && !ev.canEdit && (
        <div className="rsvp" role="group" aria-label="Respond">
          <button className={cx('btn small', ev.myResponse === 'accepted' && 'primary')} onClick={() => respond('accepted')}>Yes</button>
          <button className={cx('btn small', ev.myResponse === 'tentative' && 'primary')} onClick={() => respond('tentative')}>Maybe</button>
          <button className={cx('btn small', ev.myResponse === 'declined' && 'primary')} onClick={() => respond('declined')}>No</button>
        </div>
      )}
      <div className="rsvp">
        <button className="btn small" onClick={() => { openEventEditor({ event: ev }); onClose(); }}><Icon name="edit" /> {ev.canEdit ? 'Edit' : 'Open'}</button>
        {ev.canEdit && (
          <button className="btn small danger" onClick={() => {
            const scope = ev.recurringEventId ? (window.confirm('Delete the whole series? Choose Cancel to delete just this one.') ? 'all' : 'this') : 'this';
            if (!ev.recurringEventId && !window.confirm(`Delete "${ev.title}"?${others.length ? ' Guests will be told it is cancelled.' : ''}`)) return;
            void call('calendar.delete', ev.accountId, ev.calendarId, ev.id, scope).then(onClose).catch(fail);
          }}><Icon name="trash" /> Delete</button>
        )}
        {ev.htmlLink && <button className="btn small ghost" onClick={() => call('app.openExternal', ev.htmlLink!)}>Open in Google</button>}
      </div>
    </div>
  );
}

export function SubscribeDialog({ onClose }: { onClose: () => void }) {
  const { accounts } = useApp();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [email, setEmail] = useState('');
  return (
    <Dialog title="Open a colleague's calendar" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => call('calendar.subscribe', accountId, email.trim()).then(() => { notify('Calendar added.'); onClose(); }).catch(fail)}>Open</button></>}>
      {accounts.length > 1 && (
        <Field label="Account">
          <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
          </select>
        </Field>
      )}
      <Field label="Their email address" hint="They need to have shared their calendar with you. You can always see when people are busy in the Scheduling Assistant.">
        <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@yourcompany.com" autoFocus />
      </Field>
    </Dialog>
  );
}
