// Event editor window: details, attendees, rooms, Google Meet, repeat, reminders, status events and the Scheduling Assistant.
import { useEffect, useMemo, useState } from 'react';
import type { Addr, Attendee, CalEvent, CalendarInfo, FreeBusy } from '../../shared/types';
import { call } from '../api';
import { AddressInput } from '../components/AddressInput';
import { Icon } from '../components/Icon';
import { Field } from '../components/ui';
import { fail, notify, useApp } from '../state';
import { addDays, cx, fromLocalInput, longDay, startOfDay, time, toLocalInput } from '../util';
import { EVENT_COLOURS } from './colours';

const REPEAT: Record<string, string | null> = {
  none: null,
  daily: 'RRULE:FREQ=DAILY',
  weekdays: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  weekly: 'RRULE:FREQ=WEEKLY',
  fortnightly: 'RRULE:FREQ=WEEKLY;INTERVAL=2',
  monthly: 'RRULE:FREQ=MONTHLY',
  yearly: 'RRULE:FREQ=YEARLY'
};
const repeatFrom = (r?: string[]) => {
  const rule = r?.find((x) => x.startsWith('RRULE'));
  if (!rule) return 'none';
  return Object.entries(REPEAT).find(([, v]) => v && rule.startsWith(v) && (v.includes('INTERVAL') || !rule.includes('INTERVAL')) && (v.includes('BYDAY') || !rule.includes('BYDAY')))?.[0] ?? 'custom';
};

export function EventEditor({ initial, onClose }: { initial: Partial<CalEvent>; onClose: () => void }) {
  const { accounts } = useApp();
  const [cals, setCals] = useState<CalendarInfo[]>([]);
  const [ev, setEv] = useState<Partial<CalEvent>>({ attendees: [], eventType: 'default', allDay: false, ...initial });
  const [addMeet, setAddMeet] = useState(initial.meetUrl === 'new');
  const [repeat, setRepeat] = useState(repeatFrom(initial.recurrence));
  const [fb, setFb] = useState<FreeBusy[]>([]);
  const [rooms, setRooms] = useState<{ email: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [autoReply, setAutoReply] = useState(true);
  useEffect(() => {
    if (initial.id && initial.eventType === 'outOfOffice') {
      void call('calendar.isAutoReplyLinked', initial.accountId!, initial.calendarId!, initial.id).then(setAutoReply).catch(() => setAutoReply(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isNew = !initial.id;
  const readOnly = !isNew && initial.canEdit === false;
  const me = accounts.find((a) => a.id === ev.accountId);

  useEffect(() => {
    call('calendar.calendars').then((c) => {
      setCals(c);
      // Resolve the "primary" alias to the account's real primary calendar.
      if (ev.calendarId === 'primary' || !ev.calendarId) {
        const p = c.find((x) => x.accountId === ev.accountId && x.primary) ?? c.find((x) => x.primary);
        if (p) setEv((x) => ({ ...x, accountId: p.accountId, calendarId: p.id }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (ev.accountId) call('calendar.rooms', ev.accountId).then(setRooms).catch(() => undefined);
  }, [ev.accountId]);

  const start = ev.start ?? Date.now();
  const end = ev.end ?? start + 30 * 60_000;
  const guests = (ev.attendees ?? []).filter((a) => !a.self);
  const people: Addr[] = guests.filter((a) => !a.resource).map((a) => ({ email: a.email, name: a.name }));
  const roomList = guests.filter((a) => a.resource);

  // Scheduling Assistant: free/busy for everyone on the chosen day.
  const dayStart = startOfDay(start);
  const fbKey = [ev.accountId, dayStart, ...guests.map((g) => g.email)].join('|');
  useEffect(() => {
    if (!ev.accountId || !me) return;
    const emails = [me.email, ...guests.map((g) => g.email)];
    const t = setTimeout(() => {
      call('calendar.freeBusy', ev.accountId!, emails, dayStart, addDays(dayStart, 1)).then(setFb).catch(() => setFb([]));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fbKey]);

  const set = (p: Partial<CalEvent>) => setEv((x) => ({ ...x, ...p }));
  const setPeople = (list: Addr[]) =>
    set({
      attendees: [
        ...(ev.attendees ?? []).filter((a) => a.self || a.resource),
        ...list.map((a) => ({ ...(ev.attendees?.find((x) => x.email === a.email) ?? { response: 'needsAction' as const }), email: a.email, name: a.name }))
      ]
    });
  const toggleOptional = (email: string) => set({ attendees: (ev.attendees ?? []).map((a) => (a.email === email ? { ...a, optional: !a.optional } : a)) });
  const addRoom = (r: { email: string; name: string }) => set({ attendees: [...(ev.attendees ?? []), { email: r.email, name: r.name, resource: true, response: 'needsAction' }], location: ev.location || r.name });

  const durationMs = end - start;
  const save = async (notifyGuests = true) => {
    if (!ev.title?.trim() && ev.eventType === 'default') return notify('Add a title.', 'error');
    if (end <= start && !ev.allDay) return notify('The event ends before it starts.', 'error');
    setSaving(true);
    try {
      const recurrence = repeat === 'custom' ? ev.recurrence : REPEAT[repeat] ? [REPEAT[repeat]!] : [];
      const attendees: Attendee[] = (ev.attendees ?? []).length && me && !(ev.attendees ?? []).some((a) => a.self) ? [{ email: me.email, response: 'accepted', self: true, organizer: true }, ...(ev.attendees ?? [])] : ev.attendees ?? [];
      await call('calendar.save', {
        event: { ...(ev as CalEvent), title: ev.title || (ev.eventType === 'focusTime' ? 'Focus time' : ev.eventType === 'outOfOffice' ? 'Out of office' : 'Working location'), start, end: ev.allDay ? Math.max(end, addDays(startOfDay(start), 1)) : end, recurrence, attendees, meetUrl: ev.meetUrl === 'new' ? undefined : ev.meetUrl },
        addMeet: addMeet && !ev.meetUrl?.startsWith('http'),
        notify: notifyGuests,
        autoReply: ev.eventType === 'outOfOffice' ? autoReply : undefined,
        scope: ev.recurringEventId ? (window.confirm('Apply changes to the whole series? Choose Cancel to change only this occurrence.') ? 'all' : 'this') : 'this'
      });
      notify(isNew ? (guests.length && notifyGuests ? 'Invitations sent.' : 'Event saved.') : guests.length && notifyGuests ? 'Update sent to guests.' : 'Event saved.');
      onClose();
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!initial.id) return onClose();
    const scope = initial.recurringEventId ? (window.confirm('Delete the whole series? Choose Cancel to delete only this one.') ? 'all' : 'this') : 'this';
    if (!initial.recurringEventId && !window.confirm('Delete this event?')) return;
    await call('calendar.delete', initial.accountId!, initial.calendarId!, initial.id, scope).then(onClose).catch(fail);
  };

  // Free/busy grid from 07:00 to 19:00 in half hours.
  const slots = Array.from({ length: 24 }, (_, i) => dayStart + (7 * 60 + i * 30) * 60_000);
  const busy = (email: string, s: number) => fb.find((f) => f.email === email)?.busy.some((b) => b.start < s + 30 * 60_000 && b.end > s);
  const allFree = (s: number, dur: number) => fb.length > 0 && fb.every((f) => !f.busy.some((b) => b.start < s + dur && b.end > s));
  const suggestions = useMemo(() => {
    const now = Date.now();
    return slots.filter((s) => s > now && allFree(s, Math.max(durationMs, 30 * 60_000)) && new Date(s).getHours() >= 8 && new Date(s + durationMs).getHours() <= 18).slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fb, durationMs, dayStart]);

  const status = ev.eventType !== 'default';
  const writable = cals.filter((c) => c.accessRole === 'owner' || c.accessRole === 'writer');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--surface)' }}>
      <div className="compose-bar">
        {!readOnly && (
          <>
            <button className="btn primary" disabled={saving} onClick={() => void save(true)}>
              <Icon name="send" /> {guests.length ? (isNew ? 'Send invitation' : 'Send update') : 'Save'}
            </button>
            {guests.length > 0 && <button className="btn" disabled={saving} onClick={() => void save(false)}>Save without notifying</button>}
          </>
        )}
        {!isNew && <button className="btn ghost danger" onClick={del}><Icon name="trash" /> {readOnly ? 'Remove from my calendar' : 'Delete'}</button>}
        {readOnly && initial.myResponse && (
          <span style={{ display: 'inline-flex', gap: 6 }}>
            {(['accepted', 'tentative', 'declined'] as const).map((r) => (
              <button key={r} className={cx('btn', initial.myResponse === r && 'primary')} onClick={() => call('calendar.respond', initial.accountId!, initial.calendarId!, initial.id!, r).then(onClose).catch(fail)}>
                {r === 'accepted' ? 'Accept' : r === 'tentative' ? 'Tentative' : 'Decline'}
              </button>
            ))}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 440px', padding: '16px 20px', minWidth: 0 }}>
          <input className="subject-input" style={{ fontSize: 20, fontWeight: 600, borderBottom: '1px solid var(--border-soft)', marginBottom: 12 }} placeholder={status ? 'Title (optional)' : 'Add a title'} value={ev.title ?? ''} onChange={(e) => set({ title: e.target.value })} disabled={readOnly} autoFocus={isNew} aria-label="Title" />
          {isNew && (
            <div className="tabs-row" role="tablist" aria-label="Event type">
              {([['default', 'Event'], ['focusTime', 'Focus time'], ['outOfOffice', 'Out of office'], ['workingLocation', 'Working location']] as const).map(([t, l]) => (
                <button key={t} role="tab" aria-selected={ev.eventType === t} onClick={() => set({ eventType: t, allDay: t === 'workingLocation' || (t === 'outOfOffice' ? true : ev.allDay), autoDecline: t === 'focusTime' || t === 'outOfOffice' })}>{l}</button>
              ))}
            </div>
          )}
          <div className="row-2">
            <Field label="Starts">
              <input type={ev.allDay ? 'date' : 'datetime-local'} className="input" value={toLocalInput(start, ev.allDay)} disabled={readOnly}
                onChange={(e) => { const s = fromLocalInput(e.target.value); set({ start: s, end: s + durationMs }); }} />
            </Field>
            <Field label="Ends">
              <input type={ev.allDay ? 'date' : 'datetime-local'} className="input" value={toLocalInput(ev.allDay ? end - 864e5 : end, ev.allDay)} disabled={readOnly}
                onChange={(e) => { const t = fromLocalInput(e.target.value); set({ end: ev.allDay ? addDays(t, 1) : t }); }} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
            <label className="check"><input type="checkbox" checked={!!ev.allDay} disabled={readOnly} onChange={(e) => set({ allDay: e.target.checked, ...(e.target.checked ? { start: startOfDay(start), end: addDays(startOfDay(start), 1) } : { start: startOfDay(start) + 9 * 3600_000, end: startOfDay(start) + 9.5 * 3600_000 }) })} /> All day</label>
            {!status && (
              <label className="check">
                <Icon name="repeat" />
                <select className="input" style={{ width: 'auto', minHeight: 28 }} value={repeat} disabled={readOnly} onChange={(e) => setRepeat(e.target.value)} aria-label="Repeat">
                  <option value="none">Doesn't repeat</option><option value="daily">Every day</option><option value="weekdays">Every weekday</option><option value="weekly">Every week</option><option value="fortnightly">Every two weeks</option><option value="monthly">Every month</option><option value="yearly">Every year</option>
                  {repeat === 'custom' && <option value="custom">Custom (set in Google Calendar)</option>}
                </select>
              </label>
            )}
          </div>

          {ev.eventType === 'workingLocation' && (
            <Field label="Where are you working?">
              <select className="input" value={ev.workingLocation ?? 'Office'} onChange={(e) => set({ workingLocation: e.target.value, title: e.target.value })}>
                <option>Office</option><option>Home</option><option>Client site</option><option>Travelling</option>
              </select>
            </Field>
          )}
          {(ev.eventType === 'focusTime' || ev.eventType === 'outOfOffice') && (
            <label className="check"><input type="checkbox" checked={!!ev.autoDecline} onChange={(e) => set({ autoDecline: e.target.checked })} /> Automatically decline {ev.eventType === 'outOfOffice' ? 'new invitations during this time' : 'conflicting meetings'}</label>
          )}
          {ev.eventType === 'outOfOffice' && (
            <label className="check">
              <input type="checkbox" checked={autoReply} onChange={(e) => setAutoReply(e.target.checked)} />
              <span><b>Also send automatic email replies</b> (Gmail) for the same dates, using the message below</span>
            </label>
          )}

          {!status && (
            <>
              <div className="field">
                <span>Guests</span>
                <div style={{ border: '1px solid var(--input-border)', borderRadius: 6, padding: '2px 8px', position: 'relative' }}>
                  <AddressInput id="ev-guests" label="Guests" value={people} onChange={setPeople} />
                </div>
                {guests.filter((g) => !g.resource).length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {guests.filter((g) => !g.resource).map((g) => (
                      <button key={g.email} className="btn small ghost" onClick={() => toggleOptional(g.email)} title="Toggle optional" disabled={readOnly}>
                        {g.response === 'accepted' ? '✓ ' : g.response === 'declined' ? '✗ ' : g.response === 'tentative' ? '? ' : ''}{g.name ?? g.email}{g.optional ? ' (optional)' : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="row-2">
                <Field label="Location">
                  <input className="input" value={ev.location ?? ''} onChange={(e) => set({ location: e.target.value })} disabled={readOnly} placeholder="Add a place" />
                </Field>
                <Field label="Room">
                  <select className="input" value="" disabled={readOnly} onChange={(e) => { const r = rooms.find((x) => x.email === e.target.value); if (r) addRoom(r); }}>
                    <option value="">{roomList.length ? roomList.map((r) => r.name ?? r.email).join(', ') : rooms.length ? 'Add a room…' : 'No rooms found yet'}</option>
                    {rooms.filter((r) => !roomList.some((x) => x.email === r.email)).map((r) => <option key={r.email} value={r.email}>{r.name}</option>)}
                  </select>
                </Field>
              </div>
              <label className="check" style={{ marginBottom: 10 }}>
                <input type="checkbox" checked={addMeet || !!ev.meetUrl?.startsWith('http')} disabled={readOnly || !!ev.meetUrl?.startsWith('http')} onChange={(e) => setAddMeet(e.target.checked)} />
                <Icon name="video" /> {ev.meetUrl?.startsWith('http') ? <a href="#" onClick={(e) => { e.preventDefault(); void call('app.openExternal', ev.meetUrl!); }}>{ev.meetUrl}</a> : 'Add Google Meet video conferencing'}
              </label>
            </>
          )}

          <Field label={ev.eventType === 'outOfOffice' ? 'Message (for automatic replies and declined meetings)' : 'Description'}>
            <textarea className="input" value={(ev.description ?? '').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')} onChange={(e) => set({ description: e.target.value })} disabled={readOnly} rows={5} />
          </Field>

          <div className="row-3">
            <Field label="Calendar">
              <select className="input" disabled={readOnly || !isNew} value={`${ev.accountId}|${ev.calendarId}`} onChange={(e) => { const [a, ...c] = e.target.value.split('|'); set({ accountId: a, calendarId: c.join('|') }); }}>
                {writable.map((c) => <option key={c.accountId + c.id} value={`${c.accountId}|${c.id}`}>{c.name}{accounts.length > 1 ? ` (${accounts.find((a) => a.id === c.accountId)?.email})` : ''}</option>)}
              </select>
            </Field>
            {!status && (
              <Field label="Show as">
                <select className="input" disabled={readOnly} value={ev.transparency ?? 'opaque'} onChange={(e) => set({ transparency: e.target.value as 'opaque' | 'transparent' })}>
                  <option value="opaque">Busy</option><option value="transparent">Free</option>
                </select>
              </Field>
            )}
            <Field label="Reminder">
              <select className="input" disabled={readOnly} value={ev.reminders?.[0] ?? -1} onChange={(e) => set({ reminders: Number(e.target.value) < 0 ? undefined : [Number(e.target.value)] })}>
                <option value={-1}>Calendar default</option><option value={0}>At start</option><option value={5}>5 minutes before</option><option value={10}>10 minutes before</option><option value={15}>15 minutes before</option><option value={30}>30 minutes before</option><option value={60}>1 hour before</option><option value={1440}>1 day before</option>
              </select>
            </Field>
          </div>
          {!status && (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="check"><input type="checkbox" disabled={readOnly} checked={ev.visibility === 'private'} onChange={(e) => set({ visibility: e.target.checked ? 'private' : 'default' })} /> Private</label>
              <span className="field-label">Colour</span>
              {EVENT_COLOURS.map((c) => (
                <button key={c} aria-label={`Colour ${c}`} disabled={readOnly} onClick={() => set({ color: c })} style={{ width: 20, height: 20, borderRadius: 10, background: c, border: ev.color === c ? '2px solid var(--text)' : '1px solid var(--border)' }} />
              ))}
            </div>
          )}
        </div>

        {!status && (
          <aside className="side-panel" style={{ flex: '1 1 340px', maxWidth: 420, borderLeft: '1px solid var(--border)' }} aria-label="Scheduling Assistant">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>Scheduling Assistant</strong>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <button className="icon-btn" aria-label="Previous day" onClick={() => set({ start: start - 864e5, end: end - 864e5 })}><Icon name="chevLeft" size={14} /></button>
                <span className="hint-text">{longDay(start)}</span>
                <button className="icon-btn" aria-label="Next day" onClick={() => set({ start: start + 864e5, end: end + 864e5 })}><Icon name="chevRight" size={14} /></button>
              </span>
            </div>
            <div className="fb-grid" style={{ gridTemplateColumns: `100px repeat(${slots.length}, minmax(0, 1fr))` }}>
              <span />
              {slots.map((s, i) => <span key={s} style={{ color: 'var(--muted)', fontSize: 10 }}>{i % 4 === 0 ? String(new Date(s).getHours()).padStart(2, '0') : ''}</span>)}
              {[{ email: me?.email ?? '', name: 'You' }, ...guests].map((g) => {
                const info = fb.find((f) => f.email === g.email);
                return (
                  <FbRow key={g.email} label={g.name ?? g.email} unknown={!!info?.error || !info} slots={slots} busy={(s) => !!busy(g.email, s)} picked={(s) => s >= start && s < end} />
                );
              })}
            </div>
            {fb.length > 0 && (
              <div>
                <div className="field-label" style={{ marginBottom: 6 }}>{suggestions.length ? 'Times when everyone is free' : 'No common free time on this day'}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {suggestions.map((s) => (
                    <button key={s} className={cx('btn small', s === start && 'primary')} onClick={() => set({ start: s, end: s + durationMs })}>{time(s)}–{time(s + durationMs)}</button>
                  ))}
                </div>
              </div>
            )}
            <p className="hint-text">Busy times come from Google Calendar free/busy. People outside your organisation may show as unknown.</p>
          </aside>
        )}
      </div>
    </div>
  );
}

function FbRow({ label, slots, busy, picked, unknown }: { label: string; slots: number[]; busy: (s: number) => boolean; picked: (s: number) => boolean; unknown: boolean }) {
  return (
    <>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 4 }} title={label}>{label}</span>
      {slots.map((s) => <span key={s} className={cx('fb-cell', unknown ? 'unknown' : busy(s) ? 'busy' : picked(s) ? 'pick' : '')} />)}
    </>
  );
}
