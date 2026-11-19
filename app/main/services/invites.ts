// Meeting invitations in email: the Accept / Tentative / Decline card in the reading pane.
//
// Invitations from Google Calendar (their UID ends in @google.com) are answered the way Gmail on the web does it:
// by setting your response on the event in Google Calendar, which tells the organiser. Invitations from Outlook,
// Exchange and other systems are added to (or updated in) your Google Calendar and answered with a standard
// iCalendar reply (RFC 5546 iMIP) sent to the organiser, as Outlook would.
import type { Addr, CalEvent, Invite, InviteResponse, Response } from '../../shared/types';
import { run } from '../db';
import { changed, toast } from '../events';
import { buildMime } from '../google/mime';
import { client, getAccount, isDemo } from './accounts';
import * as calendar from './calendar';
import { type IcsCalendar, type IcsEvent, buildReply, demoEventId, mainEvent, parseIcs } from './ics';
import * as mail from './mail';
import * as store from './mailStore';

const CAL = 'https://www.googleapis.com/calendar/v3';
const enc = encodeURIComponent;

interface GEventLite {
  id: string;
  status?: string;
  recurringEventId?: string;
  attendees?: { email: string; displayName?: string; responseStatus?: Response; self?: boolean; organizer?: boolean; optional?: boolean; resource?: boolean }[];
  organizer?: { email: string; self?: boolean };
}

const PARTSTAT: Record<string, Response> = { ACCEPTED: 'accepted', TENTATIVE: 'tentative', DECLINED: 'declined', 'NEEDS-ACTION': 'needsAction' };

function inviteAttachment(accountId: string, messageId: string) {
  const d = store.getDetail(accountId, messageId);
  if (!d) return undefined;
  const ics = (a: { mimeType: string; filename: string }) => /^(text\/calendar|application\/ics)$/i.test(a.mimeType) || /\.ics$/i.test(a.filename);
  const att = d.attachments.find((a) => a.role === 'invite') ?? d.attachments.find((a) => !a.contentId && ics(a));
  return att ? { d, att } : undefined;
}

async function readInvite(accountId: string, messageId: string): Promise<{ cal: IcsCalendar; ev: IcsEvent; msg: NonNullable<ReturnType<typeof store.getDetail>> } | null> {
  const found = inviteAttachment(accountId, messageId);
  if (!found || found.att.size > 2_000_000) return null;
  const data = await mail.attachmentData(accountId, messageId, found.att.id, found.att.filename);
  const cal = parseIcs(data.toString('utf8'));
  if (!cal) return null;
  return { cal, ev: mainEvent(cal), msg: found.d };
}

/** Quick check, without reading the file, used to decide whether to show a card at all. */
export function hasInvite(accountId: string, messageId: string): boolean {
  return !!inviteAttachment(accountId, messageId);
}

const demoKey = demoEventId;

async function findEvent(accountId: string, uid: string): Promise<{ calendarId: string; event: GEventLite } | undefined> {
  const primary = calendar.calendars().find((c) => c.accountId === accountId && c.primary)?.id ?? getAccount(accountId).email;
  if (isDemo(accountId)) {
    try {
      const e = calendar.getEvent(accountId, primary, demoKey(uid));
      return { calendarId: primary, event: { id: e.id, status: e.status, attendees: e.attendees.map((a) => ({ email: a.email, responseStatus: a.response, self: a.self })) } };
    } catch {
      return undefined;
    }
  }
  const r = await client(accountId).get<{ items?: GEventLite[] }>(CAL + '/calendars/primary/events', { iCalUID: uid, showDeleted: 'true', maxResults: '25' });
  const items = (r.items ?? []).filter((e) => e.status !== 'cancelled');
  const e = items.find((x) => !x.recurringEventId) ?? items[0];
  return e ? { calendarId: primary, event: e } : undefined;
}

export async function getInvite(accountId: string, messageId: string): Promise<Invite | null> {
  const r = await readInvite(accountId, messageId);
  if (!r) return null;
  const { cal, ev } = r;
  const me = getAccount(accountId).email.toLowerCase();
  const existing = cal.method === 'REPLY' ? undefined : await findEvent(accountId, ev.uid).catch(() => undefined);
  const mineInIcs = ev.attendees.find((a) => a.email === me);
  const mineInCal = existing?.event.attendees?.find((a) => a.self || a.email.toLowerCase() === me);
  const iAmOrganizer = ev.organizer?.email === me;
  // Other things in your calendar at the same time (not all-day events, free time or ones you've declined).
  const conflicts = ev.allDay
    ? []
    : calendar
        .events(ev.start, ev.end)
        .filter((e: CalEvent) => e.accountId === accountId && e.id !== existing?.event.id && !e.allDay && e.start < ev.end && e.end > ev.start)
        .filter((e) => e.myResponse !== 'declined' && e.transparency !== 'transparent' && e.status !== 'cancelled' && e.eventType === 'default')
        .map((e) => e.title)
        .slice(0, 3);
  const replier = cal.method === 'REPLY' ? ev.attendees[0] : undefined;
  return {
    method: (['REQUEST', 'CANCEL', 'REPLY', 'PUBLISH'].includes(cal.method) ? cal.method : 'PUBLISH') as Invite['method'],
    title: ev.summary,
    start: ev.start,
    end: ev.end,
    allDay: ev.allDay,
    location: ev.location,
    meetingUrl: ev.meetingUrl,
    recurring: !!ev.rrule,
    organizer: ev.organizer ? { email: ev.organizer.email, name: ev.organizer.name } : undefined,
    iAmOrganizer,
    attendeeCount: ev.attendees.length,
    fromGoogle: /@google\.com$/i.test(ev.uid),
    inCalendar: !!existing,
    myResponse: mineInCal?.responseStatus ?? (mineInIcs?.partstat ? PARTSTAT[mineInIcs.partstat] : undefined),
    reply: replier ? { email: replier.email, name: replier.name, response: PARTSTAT[replier.partstat ?? ''] ?? 'needsAction' } : undefined,
    conflicts
  };
}

const LABEL: Record<InviteResponse, { subject: string; part: 'ACCEPTED' | 'TENTATIVE' | 'DECLINED'; verb: string }> = {
  accepted: { subject: 'Accepted', part: 'ACCEPTED', verb: 'accepted' },
  tentative: { subject: 'Tentative', part: 'TENTATIVE', verb: 'tentatively accepted' },
  declined: { subject: 'Declined', part: 'DECLINED', verb: 'declined' }
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function gTime(ms: number, allDay: boolean, tz: string) {
  if (allDay) {
    const d = new Date(ms);
    return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` };
  }
  return { dateTime: new Date(ms).toISOString(), timeZone: tz };
}

/**
 * Accept, tentatively accept or decline an invitation. `notify` sends the organiser your response (the usual case);
 * without it, only your own calendar changes, like Outlook's "Don't send a response".
 */
export async function respond(accountId: string, messageId: string, response: InviteResponse, notify = true, comment?: string, done?: string): Promise<void> {
  const r = await readInvite(accountId, messageId);
  if (!r) throw new Error("Davenport couldn't read this invitation.");
  const { cal, ev, msg } = r;
  const acct = getAccount(accountId);
  const me = acct.email.toLowerCase();
  const fromGoogle = /@google\.com$/i.test(ev.uid);
  const existing = await findEvent(accountId, ev.uid);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (isDemo(accountId)) {
    const calId = existing?.calendarId ?? calendar.calendars().find((c) => c.accountId === accountId && c.primary)?.id ?? acct.email;
    const color = calendar.calendars().find((c) => c.accountId === accountId && c.id === calId)?.color ?? '#0F6CBD';
    const e: CalEvent = {
      accountId, calendarId: calId, id: demoKey(ev.uid), title: ev.summary, start: ev.start, end: ev.end, allDay: ev.allDay, location: ev.location,
      description: ev.description, organizer: ev.organizer ? { email: ev.organizer.email, name: ev.organizer.name } : undefined,
      attendees: ev.attendees.map((a) => ({ email: a.email, name: a.name, response: a.email === me ? response : PARTSTAT[a.partstat ?? ''] ?? 'needsAction', self: a.email === me })),
      meetUrl: ev.meetingUrl, eventType: 'default', status: 'confirmed', color, myResponse: response, canEdit: false
    };
    if (response === 'declined' && !existing) {
      // Nothing to add: declining an invitation that isn't in the calendar only tells the organiser.
    } else run('INSERT OR REPLACE INTO events (account_id, calendar_id, id, start, end, json) VALUES (?, ?, ?, ?, ?, ?)', accountId, calId, e.id, e.start, e.end, JSON.stringify(e));
    changed('calendar', accountId);
  } else {
    const c = client(accountId);
    if (existing) {
      // Set your response on the event. For Google Calendar invitations Google tells the organiser; for others
      // Davenport sends the reply itself below, so Google is asked not to.
      const attendees = [...(existing.event.attendees ?? [])];
      const i = attendees.findIndex((a) => a.self || a.email.toLowerCase() === me);
      if (i >= 0) attendees[i] = { ...attendees[i], responseStatus: response };
      else attendees.push({ email: acct.email, responseStatus: response });
      await c.patch(CAL + `/calendars/primary/events/${enc(existing.event.id)}`, { attendees }, { sendUpdates: fromGoogle && notify ? 'all' : 'none' });
    } else if (response !== 'declined') {
      // Not in your calendar yet (Outlook invitations, or ones Google didn't add): add it with your response.
      await c.post(CAL + '/calendars/primary/events/import', {
        iCalUID: ev.uid,
        sequence: ev.sequence,
        summary: ev.summary,
        description: ev.description,
        location: ev.location,
        start: gTime(ev.start, ev.allDay, tz),
        end: gTime(ev.end, ev.allDay, tz),
        recurrence: ev.rrule ? ['RRULE:' + ev.rrule] : undefined,
        organizer: ev.organizer ? { email: ev.organizer.email, displayName: ev.organizer.name } : undefined,
        attendees: cal.method === 'PUBLISH' ? undefined : [
          ...ev.attendees.filter((a) => a.email !== me).map((a) => ({ email: a.email, displayName: a.name, responseStatus: PARTSTAT[a.partstat ?? ''] ?? 'needsAction' })),
          { email: acct.email, displayName: acct.name, responseStatus: response }
        ]
      });
    }
    // Tell the organiser, unless Google already did (a Google Calendar invitation that is in your calendar).
    const googleTold = fromGoogle && !!existing;
    if (notify && !googleTold && ev.organizer && ev.organizer.email !== me) {
      const label = LABEL[response];
      const ics = buildReply(cal, ev, { email: acct.email, name: acct.name }, label.part, comment);
      const who = acct.name || acct.email;
      const html = `<p>${esc(who)} has ${label.verb} this invitation.</p>${comment ? `<p>${esc(comment)}</p>` : ''}`;
      const to: Addr[] = [{ email: ev.organizer.email, name: ev.organizer.name }];
      const mime = buildMime({
        from: { email: acct.email, name: acct.name }, to, subject: `${label.subject}: ${ev.summary}`, html,
        inReplyTo: msg.messageIdHeader, references: msg.references, calendar: { method: 'REPLY', ics }
      });
      await mail.sendRawNow(accountId, mime, msg.threadId);
    }
    await calendar.fetchRange(accountId, ev.start - 86_400_000, ev.end + 86_400_000, undefined, true).catch(() => undefined);
  }
  toast({ kind: 'success', text: done ?? (response === 'accepted' ? 'Accepted.' : response === 'declined' ? 'Declined.' : 'Tentatively accepted.') });
}

/** Remove a cancelled meeting from your calendar. */
export async function removeCancelled(accountId: string, messageId: string): Promise<void> {
  const r = await readInvite(accountId, messageId);
  if (!r) throw new Error("Davenport couldn't read this message.");
  const existing = await findEvent(accountId, r.ev.uid);
  if (existing) {
    if (isDemo(accountId)) run('DELETE FROM events WHERE account_id = ? AND id = ?', accountId, existing.event.id);
    else await client(accountId).del(CAL + `/calendars/primary/events/${enc(existing.event.id)}`, { sendUpdates: 'none' });
    if (!isDemo(accountId)) await calendar.fetchRange(accountId, r.ev.start - 86_400_000, r.ev.end + 86_400_000, undefined, true).catch(() => undefined);
    run('DELETE FROM events WHERE account_id = ? AND id = ?', accountId, existing.event.id);
    changed('calendar', accountId);
  }
  toast({ kind: 'success', text: 'Removed from your calendar.' });
}

/** An event sent as a file rather than an invitation (a booking, a ticket): add it to your calendar. */
export async function addToCalendar(accountId: string, messageId: string): Promise<void> {
  await respond(accountId, messageId, 'accepted', false, undefined, 'Added to your calendar.');
}
