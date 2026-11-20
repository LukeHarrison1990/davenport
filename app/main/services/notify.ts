// Desktop notifications (Windows toast notifications) for new mail, reminders and chat.
import { Notification } from 'electron';
import type { Addr } from '../../shared/types';
import { getSettings } from '../settings';
import { emit } from '../events';
import { focusMain } from '../windows';
import { updateBadge } from '../tray';

interface MailLike {
  id: string;
  threadId: string;
  from: Addr;
  subject: string;
  snippet: string;
}

export function notifyNewMail(accountId: string, msgs: MailLike[], title?: string): void {
  updateBadge();
  if (!getSettings().notifications || !msgs.length || !Notification.isSupported()) return;
  const shown = msgs.slice(0, 3);
  for (const m of shown) {
    const n = new Notification({
      title: title ?? (m.from.name || m.from.email),
      subtitle: title ? m.from.name || m.from.email : undefined,
      body: `${m.subject}\n${m.snippet}`.slice(0, 220),
      silent: !getSettings().notificationSound
    });
    n.on('click', () => {
      focusMain();
      emit('navigate', { module: 'mail', accountId, id: m.id, threadId: m.threadId });
    });
    n.show();
  }
  if (msgs.length > shown.length) {
    new Notification({ title: 'Davenport', body: `${msgs.length - shown.length} more new messages`, silent: true }).show();
  }
}

export function notifyReminder(accountId: string, title: string, when: string, meetUrl?: string, eventId?: string): void {
  if (!getSettings().notifications || !Notification.isSupported()) return;
  const n = new Notification({
    title,
    body: when + (meetUrl ? '\nClick to open, or join from the reminder.' : ''),
    actions: meetUrl ? [{ type: 'button', text: 'Join' }] : [],
    silent: !getSettings().notificationSound
  });
  n.on('click', () => {
    focusMain();
    emit('navigate', { module: 'calendar', accountId, id: eventId });
  });
  n.on('action', () => {
    if (meetUrl) void import('electron').then(({ shell }) => shell.openExternal(meetUrl));
  });
  n.show();
}

export function notifyChat(accountId: string, spaceId: string, sender: string, space: string, text: string): void {
  if (!getSettings().notifications || !Notification.isSupported()) return;
  const n = new Notification({ title: sender, subtitle: space, body: text.slice(0, 220), silent: !getSettings().notificationSound });
  n.on('click', () => {
    focusMain();
    emit('navigate', { module: 'chat', accountId, id: spaceId });
  });
  n.show();
}
