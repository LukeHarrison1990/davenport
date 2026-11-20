// The meeting card shown above an invitation email: what, when, where, clashes, and Accept / Tentative / Decline.
import { useState } from 'react';
import type { Invite, InviteResponse, MessageDetail, Response } from '../../shared/types';
import { call, useLive } from '../api';
import { Icon } from '../components/Icon';
import { fail, useApp } from '../state';
import { time } from '../util';

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = { format: (d: Date) => time(d.getTime()) };

export function inviteWhen(i: Pick<Invite, 'start' | 'end' | 'allDay'>): string {
  const s = new Date(i.start);
  const e = new Date(i.end);
  if (i.allDay) {
    const last = new Date(i.end - 1);
    return last.toDateString() === s.toDateString() ? `${dayFmt.format(s)} (all day)` : `${dayFmt.format(s)} – ${dayFmt.format(last)}`;
  }
  if (s.toDateString() === e.toDateString()) return `${dayFmt.format(s)} · ${timeFmt.format(s)} – ${timeFmt.format(e)}`;
  return `${dayFmt.format(s)}, ${timeFmt.format(s)} – ${dayFmt.format(e)}, ${timeFmt.format(e)}`;
}

const RESPONSE_TEXT: Record<Response, string> = {
  accepted: 'You accepted.',
  tentative: 'You tentatively accepted.',
  declined: 'You declined.',
  needsAction: ''
};
const REPLY_TEXT: Record<Response, string> = {
  accepted: 'has accepted',
  tentative: 'has tentatively accepted',
  declined: 'has declined',
  needsAction: 'has replied to'
};

export function InviteCard({ m, onFound }: { m: MessageDetail; onFound: (found: boolean) => void }) {
  const { setModule, setCalDate } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const [inv, reload] = useLive<Invite | null>(
    () =>
      call('invite.get', m.accountId, m.id).then(
        (r) => (onFound(!!r), r),
        () => (onFound(false), null)
      ),
    ['calendar'],
    [m.accountId, m.id],
    null
  );
  if (!inv) return null;

  const act = (key: string, p: Promise<unknown>) => {
    setBusy(key);
    p.catch(fail).finally(() => {
      setBusy(null);
      reload();
    });
  };
  const respond = (r: InviteResponse) => act(r, call('invite.respond', m.accountId, m.id, r, notify));
  const view = () => {
    setCalDate(inv.start);
    setModule('calendar');
  };
  const title = inv.method === 'CANCEL' ? `Cancelled: ${inv.title}` : inv.title;

  return (
    <section className={'invite-card' + (inv.method === 'CANCEL' ? ' cancelled' : '')} aria-label="Meeting invitation">
      <div className="invite-main">
        <span className="invite-icon"><Icon name="calendar" size={20} /></span>
        <div className="invite-info">
          <div className="invite-title">{title}</div>
          <div className="invite-line">{inviteWhen(inv)}{inv.recurring ? ' · repeats' : ''}</div>
          {inv.location && <div className="invite-line">{inv.location}</div>}
          {inv.organizer && !inv.iAmOrganizer && inv.method !== 'REPLY' && (
            <div className="invite-line muted">Organiser: {inv.organizer.name ?? inv.organizer.email}</div>
          )}
          {inv.method === 'REQUEST' && !inv.iAmOrganizer && (
            <div className={'invite-line ' + (inv.conflicts.length ? 'warn' : 'muted')}>
              {inv.conflicts.length ? `Clashes with ${inv.conflicts.join(', ')}` : 'Nothing else in your calendar at this time'}
            </div>
          )}
        </div>
        <div className="invite-side">
          {inv.meetingUrl && (
            <button className="btn" onClick={() => call('app.openExternal', inv.meetingUrl!).catch(fail)}><Icon name="video" size={16} /> Join</button>
          )}
          <button className="btn" onClick={view}><Icon name="calendar" size={16} /> View in calendar</button>
        </div>
      </div>

      {inv.method === 'REQUEST' && !inv.iAmOrganizer && (
        <div className="invite-actions">
          <div className="invite-buttons" role="group" aria-label="Respond">
            {(
              [
                ['accepted', 'Accept', 'check'],
                ['tentative', 'Tentative', 'question'],
                ['declined', 'Decline', 'close']
              ] as const
            ).map(([r, label, icon]) => (
              <button
                key={r}
                className={'btn' + (inv.myResponse === r ? ' primary' : '')}
                aria-pressed={inv.myResponse === r}
                disabled={!!busy}
                onClick={() => respond(r)}
              >
                <Icon name={icon} size={16} /> {busy === r ? 'Sending…' : label}
              </button>
            ))}
          </div>
          <label className="invite-notify">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Send my response to the organiser
          </label>
          {inv.myResponse && inv.myResponse !== 'needsAction' && <span className="invite-status">{RESPONSE_TEXT[inv.myResponse]}</span>}
        </div>
      )}
      {inv.method === 'CANCEL' && (
        <div className="invite-actions">
          <span className="invite-status">The organiser has cancelled this meeting.</span>
          {inv.inCalendar && (
            <button className="btn primary" disabled={!!busy} onClick={() => act('remove', call('invite.removeCancelled', m.accountId, m.id))}>
              {busy ? 'Removing…' : 'Remove from calendar'}
            </button>
          )}
        </div>
      )}
      {inv.method === 'REPLY' && inv.reply && (
        <div className="invite-actions">
          <span className="invite-status">{inv.reply.name ?? inv.reply.email} {REPLY_TEXT[inv.reply.response]} this invitation.</span>
        </div>
      )}
      {inv.method === 'PUBLISH' && (
        <div className="invite-actions">
          {inv.inCalendar ? (
            <span className="invite-status">This is in your calendar.</span>
          ) : (
            <button className="btn primary" disabled={!!busy} onClick={() => act('add', call('invite.addToCalendar', m.accountId, m.id))}>
              <Icon name="calendar" size={16} /> {busy ? 'Adding…' : 'Add to calendar'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
