// Out of office, Outlook-style: Google keeps Gmail's vacation responder (automatic email replies) and
// Calendar's out-of-office entries (which decline meetings) as two separate settings. Davenport links them,
// so setting one can set the other, and changing or turning off one keeps its partner in step.
import type { CalEvent, EventSave, Vacation } from '../../shared/types';
import { kvDelete, kvGet, kvSet } from '../db';
import { toast } from '../events';
import { htmlToText } from '../google/mime';
import * as calendar from './calendar';
import * as mail from './mail';

interface Link {
  calendarId: string;
  eventId: string;
}

const DEFAULT_MESSAGE = '<p>Thank you for your email. I am out of the office and will reply when I return.</p>';

const linkOf = (accountId: string) => kvGet<Link>('oooLink', accountId);

function linkedEvent(accountId: string): CalEvent | undefined {
  const l = linkOf(accountId);
  if (!l) return undefined;
  try {
    return calendar.getEvent(accountId, l.calendarId, l.eventId);
  } catch {
    kvDelete('oooLink', accountId);
    return undefined;
  }
}

function primaryCalendarId(accountId: string): string {
  return calendar.calendars().find((c) => c.accountId === accountId && c.primary)?.id ?? 'primary';
}

/** Automatic replies, plus whether a linked Calendar out-of-office entry exists. */
export async function get(accountId: string): Promise<Vacation> {
  const v = await mail.vacation(accountId);
  const linked = !!linkedEvent(accountId);
  // Unset (rather than false) when replies are off, so the option defaults to on once dates are entered.
  return { ...v, blockCalendar: linked ? true : v.enabled ? false : undefined };
}

/** Saves automatic replies and, if asked, keeps a matching Calendar out-of-office entry. */
export async function set(accountId: string, v: Vacation): Promise<void> {
  await mail.setVacation(accountId, v, true);
  const existing = linkedEvent(accountId);
  const wantsCalendar = v.enabled && !!v.blockCalendar && !!v.startTime && !!v.endTime && v.endTime > v.startTime;
  if (wantsCalendar) {
    const ev = await calendar.saveEvent({
      event: {
        ...(existing ?? {}),
        accountId,
        calendarId: existing?.calendarId ?? primaryCalendarId(accountId),
        title: 'Out of office',
        start: v.startTime!,
        end: v.endTime!,
        allDay: false,
        eventType: 'outOfOffice',
        autoDecline: true,
        description: htmlToText(v.html || DEFAULT_MESSAGE).slice(0, 1000)
      },
      notify: false
    });
    kvSet('oooLink', accountId, { calendarId: ev.calendarId, eventId: ev.id } satisfies Link);
  } else if (existing) {
    await calendar.deleteEvent(accountId, existing.calendarId, existing.id).catch(() => undefined);
    kvDelete('oooLink', accountId);
  }
  toast({
    kind: 'success',
    text: v.enabled
      ? wantsCalendar
        ? 'Automatic replies are on in Gmail, and your calendar shows you as out of office.'
        : 'Automatic replies are on in Gmail.'
      : 'Automatic replies are off.'
  });
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Saving a Calendar out-of-office entry can switch on matching automatic replies. */
export async function saveEvent(s: EventSave): Promise<CalEvent> {
  const ev = await calendar.saveEvent(s);
  const accountId = ev.accountId;
  const l = linkOf(accountId);
  const isLinked = !!l && l.eventId === ev.id && l.calendarId === ev.calendarId;
  if (ev.eventType === 'outOfOffice' && (s.autoReply || isLinked)) {
    if (s.autoReply === false && isLinked) {
      await mail.setVacation(accountId, { ...(await mail.vacation(accountId)), enabled: false }, true);
      kvDelete('oooLink', accountId);
      toast({ kind: 'info', text: 'Automatic replies are off.' });
      return ev;
    }
    const current = await mail.vacation(accountId).catch(() => undefined);
    const message = ev.description?.trim() ? `<p>${escapeHtml(ev.description.trim()).replace(/\n/g, '<br>')}</p>` : current?.html || DEFAULT_MESSAGE;
    await mail.setVacation(
      accountId,
      {
        enabled: true,
        subject: current?.subject || 'Out of office',
        html: message,
        startTime: ev.start,
        endTime: ev.end,
        restrictToContacts: current?.restrictToContacts ?? false,
        restrictToDomain: current?.restrictToDomain ?? false
      },
      true
    );
    kvSet('oooLink', accountId, { calendarId: ev.calendarId, eventId: ev.id } satisfies Link);
    toast({ kind: 'success', text: `Out of office saved. Automatic replies are on in Gmail until ${new Date(ev.end).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.` });
  }
  return ev;
}

/** Deleting the linked Calendar entry also switches automatic replies off. */
export async function deleteEvent(accountId: string, calendarId: string, id: string, scope?: 'this' | 'all'): Promise<void> {
  await calendar.deleteEvent(accountId, calendarId, id, scope);
  const l = linkOf(accountId);
  if (l && l.calendarId === calendarId && l.eventId === id) {
    kvDelete('oooLink', accountId);
    const v = await mail.vacation(accountId).catch(() => undefined);
    if (v?.enabled) {
      await mail.setVacation(accountId, { ...v, enabled: false }, true);
      toast({ kind: 'info', text: 'Out of office removed, and automatic replies are off.' });
    }
  }
}

/** Whether a Calendar entry is the one linked to automatic replies (for the event editor). */
export function isLinked(accountId: string, calendarId: string, id: string): boolean {
  const l = linkOf(accountId);
  return !!l && l.calendarId === calendarId && l.eventId === id;
}
