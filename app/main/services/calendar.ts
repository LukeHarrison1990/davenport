// Google Calendar: calendars, events, invitations, Meet links, free/busy and reminders.
import crypto from 'node:crypto';
import type { Attendee, CalEvent, CalendarInfo, EventSave, FreeBusy, Response } from '../../shared/types';
import { all, get, kvGet, kvSet, run, tx, uid } from '../db';
import { changed, toast } from '../events';
import { GoogleApiError } from '../google/http';
import { client, isDemo, listAccounts } from './accounts';
import * as store from './mailStore';
import { notifyReminder } from './notify';

const CAL = 'https://www.googleapis.com/calendar/v3';
const enc = encodeURIComponent;

export const EVENT_COLORS: Record<string, string> = {
  '1': '#7986CB', '2': '#33B679', '3': '#8E24AA', '4': '#E67C73', '5': '#F6BF26', '6': '#F4511E',
  '7': '#039BE5', '8': '#616161', '9': '#3F51B5', '10': '#0B8043', '11': '#D50000'
};

interface GDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}
interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  start: GDateTime;
  end: GDateTime;
  attendees?: { email: string; displayName?: string; responseStatus?: Response; optional?: boolean; resource?: boolean; self?: boolean; organizer?: boolean }[];
  organizer?: { email: string; displayName?: string; self?: boolean };
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[]; createRequest?: unknown };
  eventType?: string;
  recurrence?: string[];
  recurringEventId?: string;
  transparency?: 'opaque' | 'transparent';
  visibility?: 'default' | 'public' | 'private' | 'confidential';
  reminders?: { useDefault: boolean; overrides?: { method: string; minutes: number }[] };
  workingLocationProperties?: { type?: string; homeOffice?: unknown; customLocation?: { label?: string }; officeLocation?: { label?: string } };
  outOfOfficeProperties?: { autoDeclineMode?: string; declineMessage?: string };
  focusTimeProperties?: { autoDeclineMode?: string; chatStatus?: string };
  htmlLink?: string;
  guestsCanModify?: boolean;
}

const parseDate = (d: GDateTime): number => {
  if (d.dateTime) return Date.parse(d.dateTime);
  const [y, m, day] = (d.date ?? '1970-01-01').split('-').map(Number);
  return new Date(y, m - 1, day).getTime();
};
const ymd = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function fromGoogle(accountId: string, calendarId: string, e: GEvent, calColor: string, accessRole: string): CalEvent {
  const self = e.attendees?.find((a) => a.self);
  const meet = e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri;
  const wl = e.workingLocationProperties;
  const organiserIsMe = e.organizer?.self ?? !e.organizer;
  return {
    accountId,
    calendarId,
    id: e.id,
    title: e.summary ?? (e.eventType === 'workingLocation' ? 'Working location' : '(No title)'),
    start: parseDate(e.start),
    end: parseDate(e.end),
    allDay: !!e.start.date,
    location: e.location,
    description: e.description,
    attendees: (e.attendees ?? []).map((a) => ({
      email: a.email, name: a.displayName, response: a.responseStatus ?? 'needsAction', optional: a.optional, resource: a.resource, self: a.self, organizer: a.organizer
    })),
    organizer: e.organizer ? { email: e.organizer.email, name: e.organizer.displayName } : undefined,
    meetUrl: meet,
    eventType: (['focusTime', 'outOfOffice', 'workingLocation'].includes(e.eventType ?? '') ? e.eventType : 'default') as CalEvent['eventType'],
    status: (e.status as CalEvent['status']) ?? 'confirmed',
    color: e.colorId ? EVENT_COLORS[e.colorId] : calColor,
    myResponse: self?.responseStatus,
    recurrence: e.recurrence,
    recurringEventId: e.recurringEventId,
    transparency: e.transparency,
    visibility: e.visibility === 'confidential' ? 'private' : e.visibility,
    reminders: e.reminders?.useDefault ? undefined : e.reminders?.overrides?.map((o) => o.minutes),
    workingLocation: wl ? wl.customLocation?.label ?? wl.officeLocation?.label ?? (wl.type === 'homeOffice' ? 'Home' : 'Office') : undefined,
    autoDecline: !!(e.outOfOfficeProperties?.autoDeclineMode || e.focusTimeProperties?.autoDeclineMode),
    htmlLink: e.htmlLink,
    canEdit: ['owner', 'writer'].includes(accessRole) && (organiserIsMe || !!e.guestsCanModify)
  };
}

function toGoogle(s: EventSave): Partial<GEvent> & Record<string, unknown> {
  const ev = s.event;
  const tz = localTz();
  const body: Partial<GEvent> & Record<string, unknown> = {
    summary: ev.title,
    description: ev.description,
    location: ev.location,
    start: ev.allDay ? { date: ymd(ev.start) } : { dateTime: new Date(ev.start).toISOString(), timeZone: tz },
    end: ev.allDay ? { date: ymd(ev.end) } : { dateTime: new Date(ev.end).toISOString(), timeZone: tz },
    attendees: ev.attendees?.map((a) => ({ email: a.email, displayName: a.name, optional: a.optional, responseStatus: a.self ? a.response : undefined })),
    transparency: ev.transparency,
    visibility: ev.visibility,
    recurrence: ev.recurrence?.length ? ev.recurrence : undefined
  };
  if (ev.reminders) body.reminders = { useDefault: false, overrides: ev.reminders.map((m) => ({ method: 'popup', minutes: m })) };
  if (ev.color) {
    const id = Object.entries(EVENT_COLORS).find(([, c]) => c.toLowerCase() === ev.color!.toLowerCase())?.[0];
    if (id) body.colorId = id;
  }
  if (ev.eventType === 'focusTime') {
    body.eventType = 'focusTime';
    body.focusTimeProperties = { autoDeclineMode: ev.autoDecline ? 'declineOnlyNewConflictingInvitations' : 'declineNone', chatStatus: 'doNotDisturb' };
    body.transparency = 'opaque';
    delete body.attendees;
  } else if (ev.eventType === 'outOfOffice') {
    body.eventType = 'outOfOffice';
    body.outOfOfficeProperties = { autoDeclineMode: ev.autoDecline ? 'declineAllConflictingInvitations' : 'declineNone', declineMessage: ev.description || 'I am out of office.' };
    delete body.attendees;
    delete body.location;
  } else if (ev.eventType === 'workingLocation') {
    body.eventType = 'workingLocation';
    body.visibility = 'public';
    body.transparency = 'transparent';
    const label = ev.workingLocation ?? 'Office';
    body.workingLocationProperties = /^home$/i.test(label) ? { type: 'homeOffice', homeOffice: {} } : { type: 'customLocation', customLocation: { label } };
    delete body.attendees;
  }
  if (s.addMeet) body.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  return body;
}

// ---------- Calendars ----------

export function calendars(): CalendarInfo[] {
  return all<{ account_id: string; id: string; name: string; color: string; is_primary: number; selected: number; access_role: CalendarInfo['accessRole']; kind: CalendarInfo['kind'] }>(
    'SELECT c.* FROM calendars c JOIN accounts a ON a.id = c.account_id ORDER BY a.sort, c.is_primary DESC, c.kind, c.name'
  ).map((r) => ({
    accountId: r.account_id, id: r.id, name: r.name, color: r.color, primary: !!r.is_primary, selected: !!r.selected, accessRole: r.access_role, kind: r.kind
  }));
}

export async function syncCalendars(accountId: string): Promise<void> {
  if (isDemo(accountId)) return;
  const items = await client(accountId).all<{
    id: string; summary: string; summaryOverride?: string; backgroundColor?: string; primary?: boolean; selected?: boolean; accessRole: CalendarInfo['accessRole']; hidden?: boolean;
  }>(CAL + '/users/me/calendarList', 'items', { maxResults: 250 });
  const existing = new Map(calendars().filter((c) => c.accountId === accountId).map((c) => [c.id, c]));
  const accColor = get<{ color: string }>('SELECT color FROM accounts WHERE id = ?', accountId)?.color ?? '#1F3A5F';
  tx(() => {
    run('DELETE FROM calendars WHERE account_id = ?', accountId);
    for (const c of items) {
      if (c.hidden) continue;
      const prev = existing.get(c.id);
      const kind = c.id.endsWith('resource.calendar.google.com') ? 'resource' : c.primary || c.accessRole === 'owner' ? 'mine' : 'other';
      run(
        'INSERT INTO calendars (account_id, id, name, color, is_primary, selected, access_role, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        accountId, c.id, c.primary ? getAccountName(accountId) : c.summaryOverride ?? c.summary, c.primary ? accColor : c.backgroundColor ?? '#5B6472',
        !!c.primary, prev ? prev.selected : !!(c.primary || c.selected), c.accessRole, kind
      );
    }
  });
  changed('calendar', accountId);
}

const getAccountName = (accountId: string) => get<{ name: string }>('SELECT name FROM accounts WHERE id = ?', accountId)?.name ?? 'Calendar';

export function setSelected(accountId: string, calendarId: string, selected: boolean): void {
  run('UPDATE calendars SET selected = ? WHERE account_id = ? AND id = ?', selected, accountId, calendarId);
  changed('calendar', accountId);
  if (selected) void fetchRange(accountId, Date.now() - 60 * 864e5, Date.now() + 365 * 864e5, [calendarId], true);
}

export async function subscribe(accountId: string, email: string): Promise<CalendarInfo> {
  if (isDemo(accountId)) {
    run("INSERT OR REPLACE INTO calendars (account_id, id, name, color, is_primary, selected, access_role, kind) VALUES (?, ?, ?, '#7A4E9C', 0, 1, 'freeBusyReader', 'other')", accountId, email, email);
  } else {
    try {
      await client(accountId).post(CAL + '/users/me/calendarList', { id: email });
    } catch (e) {
      if (e instanceof GoogleApiError && (e.status === 404 || e.status === 403)) {
        throw new Error(`${email} hasn't shared their calendar with you. You can still see when they're busy in the Scheduling Assistant.`);
      }
      throw e;
    }
    await syncCalendars(accountId);
    setSelected(accountId, email, true);
  }
  changed('calendar', accountId);
  return calendars().find((c) => c.accountId === accountId && c.id === email)!;
}

// ---------- Events ----------

const rowToEvent = (r: { json: string }) => JSON.parse(r.json) as CalEvent;

export function events(start: number, end: number): CalEvent[] {
  // Fetch from Google in the background if this range isn't cached yet.
  for (const a of listAccounts()) {
    if (a.kind !== 'google') continue;
    const range = kvGet<{ start: number; end: number }>('calRange', a.id);
    if (!range || start < range.start || end > range.end) {
      const s = Math.min(start, range?.start ?? start) - 7 * 864e5;
      const e = Math.max(end, range?.end ?? end) + 7 * 864e5;
      void fetchRange(a.id, s, e).catch(() => undefined);
    }
  }
  return all<{ json: string }>(
    `SELECT e.json FROM events e JOIN calendars c ON c.account_id = e.account_id AND c.id = e.calendar_id
     WHERE c.selected = 1 AND e.start < ? AND e.end > ? ORDER BY e.start`,
    end,
    start
  )
    .map(rowToEvent)
    .filter((e) => e.status !== 'cancelled');
}

const inflight = new Set<string>();

export async function fetchRange(accountId: string, start: number, end: number, only?: string[], force = false): Promise<void> {
  if (isDemo(accountId)) return;
  const key = `${accountId}|${start}|${end}|${only?.join(',') ?? ''}`;
  if (inflight.has(key) && !force) return;
  inflight.add(key);
  try {
    const cals = calendars().filter((c) => c.accountId === accountId && c.selected && (!only || only.includes(c.id)));
    for (const c of cals) {
      let items: GEvent[];
      try {
        items = await client(accountId).all<GEvent>(
          CAL + `/calendars/${enc(c.id)}/events`,
          'items',
          {
            timeMin: new Date(start).toISOString(),
            timeMax: new Date(end).toISOString(),
            singleEvents: true,
            maxResults: 2500,
            showDeleted: false,
            eventTypes: c.primary ? ['default', 'focusTime', 'outOfOffice', 'workingLocation'] : undefined
          },
          10
        );
      } catch (e) {
        if (e instanceof GoogleApiError && (e.status === 404 || e.status === 403)) continue;
        throw e;
      }
      tx(() => {
        run('DELETE FROM events WHERE account_id = ? AND calendar_id = ? AND start < ? AND end > ?', accountId, c.id, end, start);
        for (const ev of items) {
          const e = fromGoogle(accountId, c.id, ev, c.color, c.accessRole);
          run('INSERT OR REPLACE INTO events (account_id, calendar_id, id, start, end, json) VALUES (?, ?, ?, ?, ?, ?)', accountId, c.id, e.id, e.start, e.end, JSON.stringify(e));
        }
      });
    }
    if (!only) {
      const prev = kvGet<{ start: number; end: number }>('calRange', accountId);
      kvSet('calRange', accountId, { start: Math.min(start, prev?.start ?? start), end: Math.max(end, prev?.end ?? end) });
    }
    changed('calendar', accountId);
  } finally {
    inflight.delete(key);
  }
}

export async function syncCalendar(accountId: string): Promise<void> {
  if (isDemo(accountId)) return;
  await syncCalendars(accountId);
  const range = kvGet<{ start: number; end: number }>('calRange', accountId);
  const start = Math.min(range?.start ?? Infinity, Date.now() - 60 * 864e5);
  const end = Math.max(range?.end ?? 0, Date.now() + 365 * 864e5);
  await fetchRange(accountId, start, end, undefined, true);
}

export function getEvent(accountId: string, calendarId: string, id: string): CalEvent {
  const r = get<{ json: string }>('SELECT json FROM events WHERE account_id = ? AND calendar_id = ? AND id = ?', accountId, calendarId, id);
  if (!r) throw new Error('Event not found');
  return rowToEvent(r);
}

export async function saveEvent(s: EventSave): Promise<CalEvent> {
  const { accountId, calendarId } = s.event;
  const cal = calendars().find((c) => c.accountId === accountId && c.id === calendarId);
  const color = cal?.color ?? '#1F3A5F';
  if (isDemo(accountId)) {
    const ev: CalEvent = {
      attendees: [],
      eventType: 'default',
      status: 'confirmed',
      canEdit: true,
      ...(s.event.id ? getEvent(accountId, calendarId, s.event.id) : {}),
      ...s.event,
      id: s.event.id ?? 'ev-' + uid(),
      color: s.event.color ?? color
    } as CalEvent;
    if (s.addMeet && !ev.meetUrl) ev.meetUrl = 'https://meet.google.com/abc-defg-hij';
    run('INSERT OR REPLACE INTO events (account_id, calendar_id, id, start, end, json) VALUES (?, ?, ?, ?, ?, ?)', accountId, calendarId, ev.id, ev.start, ev.end, JSON.stringify(ev));
    changed('calendar', accountId);
    return ev;
  }
  const body = toGoogle(s);
  const query = { conferenceDataVersion: 1, sendUpdates: s.notify === false ? 'none' : 'all' };
  let targetId = s.event.id;
  if (targetId && s.scope === 'all' && s.event.recurringEventId) targetId = s.event.recurringEventId;
  const g = targetId
    ? await client(accountId).patch<GEvent>(CAL + `/calendars/${enc(calendarId)}/events/${enc(targetId)}`, body, query)
    : await client(accountId).post<GEvent>(CAL + `/calendars/${enc(calendarId)}/events`, body, query);
  const ev = fromGoogle(accountId, calendarId, g, color, cal?.accessRole ?? 'owner');
  if (g.recurrence?.length || s.event.recurringEventId) {
    await fetchRange(accountId, Date.now() - 60 * 864e5, Date.now() + 365 * 864e5, [calendarId], true);
  } else {
    run('INSERT OR REPLACE INTO events (account_id, calendar_id, id, start, end, json) VALUES (?, ?, ?, ?, ?, ?)', accountId, calendarId, ev.id, ev.start, ev.end, JSON.stringify(ev));
  }
  changed('calendar', accountId);
  return ev;
}

export async function deleteEvent(accountId: string, calendarId: string, id: string, scope: 'this' | 'all' = 'this'): Promise<void> {
  const ev = get<{ json: string }>('SELECT json FROM events WHERE account_id = ? AND calendar_id = ? AND id = ?', accountId, calendarId, id);
  const parsed = ev ? rowToEvent(ev) : undefined;
  const target = scope === 'all' && parsed?.recurringEventId ? parsed.recurringEventId : id;
  if (!isDemo(accountId)) {
    try {
      await client(accountId).del(CAL + `/calendars/${enc(calendarId)}/events/${enc(target)}`, { sendUpdates: 'all' });
    } catch (e) {
      if (!(e instanceof GoogleApiError && e.status === 410)) throw e;
    }
  }
  if (scope === 'all' && parsed?.recurringEventId) {
    for (const r of all<{ id: string; json: string }>('SELECT id, json FROM events WHERE account_id = ? AND calendar_id = ?', accountId, calendarId)) {
      if (rowToEvent(r).recurringEventId === parsed.recurringEventId) run('DELETE FROM events WHERE account_id = ? AND calendar_id = ? AND id = ?', accountId, calendarId, r.id);
    }
  }
  run('DELETE FROM events WHERE account_id = ? AND calendar_id = ? AND id = ?', accountId, calendarId, id);
  changed('calendar', accountId);
}

export async function respond(accountId: string, calendarId: string, id: string, response: Response): Promise<void> {
  const ev = getEvent(accountId, calendarId, id);
  const attendees: Attendee[] = ev.attendees.map((a) => (a.self ? { ...a, response } : a));
  ev.attendees = attendees;
  ev.myResponse = response;
  if (!isDemo(accountId)) {
    const g = await client(accountId).get<GEvent>(CAL + `/calendars/${enc(calendarId)}/events/${enc(id)}`);
    const list = (g.attendees ?? []).map((a) => (a.self ? { ...a, responseStatus: response } : a));
    await client(accountId).patch(CAL + `/calendars/${enc(calendarId)}/events/${enc(id)}`, { attendees: list }, { sendUpdates: 'all' });
  }
  run('UPDATE events SET json = ? WHERE account_id = ? AND calendar_id = ? AND id = ?', JSON.stringify(ev), accountId, calendarId, id);
  changed('calendar', accountId);
  toast({ kind: 'success', text: response === 'accepted' ? 'Accepted.' : response === 'declined' ? 'Declined.' : 'Marked as tentative.' });
}

export async function freeBusy(accountId: string, emails: string[], start: number, end: number): Promise<FreeBusy[]> {
  if (isDemo(accountId)) return demoFreeBusy(emails, start);
  const r = await client(accountId).post<{ calendars: Record<string, { busy: { start: string; end: string }[]; errors?: { reason: string }[] }> }>(CAL + '/freeBusy', {
    timeMin: new Date(start).toISOString(),
    timeMax: new Date(end).toISOString(),
    items: emails.map((id) => ({ id }))
  });
  return emails.map((email) => {
    const c = r.calendars[email];
    return {
      email,
      busy: (c?.busy ?? []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) })),
      error: c?.errors?.length ? 'Free/busy not available' : undefined
    };
  });
}

function demoFreeBusy(emails: string[], start: number): FreeBusy[] {
  const day = new Date(start);
  day.setHours(0, 0, 0, 0);
  const at = (h: number, m = 0) => day.getTime() + (h * 60 + m) * 60_000;
  const patterns: [number, number, number, number][][] = [
    [[10, 30, 10, 45]],
    [[9, 0, 10, 0], [12, 0, 13, 0], [15, 0, 16, 0]],
    [[10, 0, 11, 0], [14, 0, 15, 30]],
    [[9, 0, 10, 0], [16, 0, 17, 0]]
  ];
  return emails.map((email, i) => ({ email, busy: patterns[i % patterns.length].map(([a, b, c, d]) => ({ start: at(a, b), end: at(c, d) })) }));
}

export function rooms(accountId: string): { email: string; name: string; capacity?: number }[] {
  const seen = new Map<string, string>();
  for (const c of calendars().filter((c) => c.accountId === accountId && c.kind === 'resource')) seen.set(c.id, c.name);
  for (const r of all<{ json: string }>('SELECT json FROM events WHERE account_id = ?', accountId)) {
    for (const a of rowToEvent(r).attendees) if (a.resource && !seen.has(a.email)) seen.set(a.email, a.name ?? a.email);
  }
  return [...seen].map(([email, name]) => ({ email, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export function fromMessage(accountId: string, messageId: string): Partial<CalEvent> {
  const m = store.getDetail(accountId, messageId);
  if (!m) return {};
  const me = new Set(listAccounts().map((a) => a.email.toLowerCase()));
  const people = [m.from, ...m.to, ...m.cc].filter((a, i, arr) => !me.has(a.email.toLowerCase()) && arr.findIndex((b) => b.email === a.email) === i);
  const start = new Date();
  start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);
  return {
    title: m.subject.replace(/^((re|fw|fwd)\s*:\s*)+/i, ''),
    description: `${m.text?.slice(0, 1500) ?? m.snippet}\n\n— From the email "${m.subject}" (${m.from.name ?? m.from.email})`,
    attendees: people.map((p) => ({ email: p.email, name: p.name, response: 'needsAction' as Response })),
    start: start.getTime(),
    end: start.getTime() + 30 * 60_000,
    allDay: false
  };
}

// ---------- Reminders ----------

const reminded = new Set<string>();
export function checkReminders(): void {
  const now = Date.now();
  for (const r of all<{ json: string }>(
    `SELECT e.json FROM events e JOIN calendars c ON c.account_id = e.account_id AND c.id = e.calendar_id
     WHERE c.selected = 1 AND c.kind = 'mine' AND e.start > ? AND e.start < ?`,
    now - 60_000,
    now + 24 * 3600_000
  )) {
    const e = rowToEvent(r);
    if (e.allDay || e.eventType !== 'default' || e.myResponse === 'declined' || e.status === 'cancelled') continue;
    const mins = e.reminders?.length ? e.reminders : [10];
    for (const m of mins) {
      const key = `${e.accountId}|${e.id}|${e.start}|${m}`;
      const at = e.start - m * 60_000;
      if (now >= at && now < e.start + 60_000 && !reminded.has(key)) {
        reminded.add(key);
        const t = new Date(e.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        notifyReminder(e.accountId, e.title, `${m === 0 ? 'Now' : `In ${m} minutes`} · ${t}${e.location ? ' · ' + e.location : ''}`, e.meetUrl, e.id);
      }
    }
  }
}
