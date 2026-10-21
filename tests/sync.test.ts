// Exercises the real sync engine against a simulated Gmail API (no network, no Google account needed).
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false, setBadgeCount: () => true },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  safeStorage: { isEncryptionAvailable: () => false },
  Notification: Object.assign(function () { return { on() {}, show() {} }; }, { isSupported: () => false }),
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createEmpty: () => ({}), createFromDataURL: () => ({}) },
  dialog: {},
  screen: {},
  Menu: {},
  Tray: function () {}
}));

import { openDatabase, run, get, kvSet } from '../app/main/db';
import { saveTokens } from '../app/main/google/http';
import { setSettings } from '../app/main/settings';
import * as mail from '../app/main/services/mail';
import * as store from '../app/main/services/mailStore';
import { fromBase64Url } from '../app/main/google/mime';

// ---- A tiny fake Gmail ----
type Msg = { id: string; threadId: string; labelIds: string[]; from: string; subject: string; date: number };
const server = {
  historyId: 100,
  messages: new Map<string, Msg>(),
  history: [] as unknown[],
  modifies: [] as { ids: string[]; addLabelIds: string[]; removeLabelIds: string[] }[],
  sent: [] as { raw: string; threadId?: string }[]
};
const meta = (m: Msg) => ({
  id: m.id, threadId: m.threadId, labelIds: m.labelIds, snippet: 'Snippet of ' + m.subject, internalDate: String(m.date),
  payload: { mimeType: 'text/plain', headers: [{ name: 'From', value: m.from }, { name: 'To', value: 'me@x.com' }, { name: 'Subject', value: m.subject }] }
});
const add = (m: Msg) => server.messages.set(m.id, m);

let quotaFailures = 0;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fakeFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const p = url.pathname.replace('/gmail/v1/users/me', '');
  if (url.host === 'oauth2.googleapis.com') return json({ access_token: 'tok', expires_in: 3600, scope: 'x' });
  if (p === '/profile') return json({ emailAddress: 'me@x.com', historyId: String(server.historyId) });
  if (p === '/labels') return json({ labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'Label_9', name: 'Clients/Acme', type: 'user' }] });
  if (p === '/messages' && (init?.method ?? 'GET') === 'GET') {
    const label = url.searchParams.get('labelIds');
    const list = [...server.messages.values()].filter((m) => !label || m.labelIds.includes(label)).sort((a, b) => b.date - a.date);
    return json({ messages: list.map((m) => ({ id: m.id, threadId: m.threadId })) });
  }
  if (quotaFailures > 0 && p.startsWith('/messages/')) {
    quotaFailures--;
    return new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user' of service 'gmail.googleapis.com'" } }), {
      status: 429, headers: { 'content-type': 'application/json', 'retry-after': '1' }
    });
  }
  const one = (init?.method ?? 'GET') === 'GET' ? p.match(/^\/messages\/([^/]+)$/) : null;
  if (one) {
    const m = server.messages.get(one[1]);
    return m ? json(meta(m)) : json({ error: { message: 'Not found' } }, 404);
  }
  if (p === '/history') {
    if (Number(url.searchParams.get('startHistoryId')) < 50) return json({ error: { message: 'gone' } }, 404);
    return json({ history: server.history, historyId: String(server.historyId) });
  }
  if (p === '/messages/batchModify') {
    server.modifies.push(JSON.parse(String(init!.body)));
    return new Response(null, { status: 204 });
  }
  if (p === '/messages/send') {
    const body = JSON.parse(String(init!.body));
    server.sent.push(body);
    add({ id: 'sent-1', threadId: body.threadId ?? 'sent-1', labelIds: ['SENT'], from: 'Me <me@x.com>', subject: 'Sent subject', date: Date.now() });
    return json({ id: 'sent-1', threadId: body.threadId ?? 'sent-1' });
  }
  if (p === '/settings/sendAs') return json({ sendAs: [{ sendAsEmail: 'me@x.com', displayName: 'Me', isDefault: true, isPrimary: true, signature: '' }] });
  return json({ error: { message: 'Unhandled ' + p } }, 400);
});

beforeAll(() => {
  vi.stubGlobal('fetch', fakeFetch);
  openDatabase('', ':memory:');
  kvSet('oauth', 'client', { clientId: 'id.apps.googleusercontent.com', secret: 'b64:' + Buffer.from('s').toString('base64') });
  run("INSERT INTO accounts (id, email, name, kind, color, status, sort) VALUES ('g1', 'me@x.com', 'Me', 'google', '#000', 'ok', 1)");
  saveTokens('g1', { access_token: 'tok', refresh_token: 'refresh', expires_in: 3600, scope: 'x' });
  setSettings({ undoSendSeconds: 0, conversationView: false });
  const now = Date.now();
  add({ id: 'a', threadId: 'ta', labelIds: ['INBOX', 'UNREAD'], from: 'Priya <p@x.com>', subject: 'Budget', date: now - 5000 });
  add({ id: 'b', threadId: 'tb', labelIds: ['INBOX'], from: 'Tom <t@x.com>', subject: 'Website', date: now - 10000 });
  add({ id: 'c', threadId: 'tc', labelIds: ['Label_9'], from: 'Lena <l@x.com>', subject: 'Contract', date: now - 20000 });
});

describe('Gmail sync', () => {
  it('does an initial sync of labels and messages', async () => {
    await mail.syncMail('g1');
    expect(get<{ n: number }>('SELECT COUNT(*) AS n FROM messages')?.n).toBe(3);
    const folders = store.folders('g1');
    expect(folders.find((f) => f.path === 'Clients/Acme')?.total).toBe(1);
    expect(folders.find((f) => f.id === 'INBOX')?.unread).toBe(1);
    expect(get<{ history_id: string }>("SELECT history_id FROM accounts WHERE id = 'g1'")?.history_id).toBe('100');
  });

  it('applies incremental history: new mail, label changes and deletions', async () => {
    add({ id: 'd', threadId: 'td', labelIds: ['INBOX', 'UNREAD'], from: 'Sarah <s@x.com>', subject: 'Interview', date: Date.now() });
    server.history = [
      { id: '101', messagesAdded: [{ message: { id: 'd', threadId: 'td', labelIds: ['INBOX', 'UNREAD'] } }] },
      { id: '102', labelsRemoved: [{ message: { id: 'a', threadId: 'ta', labelIds: ['INBOX'] }, labelIds: ['UNREAD'] }] },
      { id: '103', messagesDeleted: [{ message: { id: 'b', threadId: 'tb' } }] }
    ];
    server.historyId = 103;
    await mail.syncMail('g1');
    expect(store.getSummary('g1', 'd')?.subject).toBe('Interview');
    expect(store.getSummary('g1', 'a')?.unread).toBe(false);
    expect(store.getSummary('g1', 'b')).toBeUndefined();
    expect(get<{ history_id: string }>("SELECT history_id FROM accounts WHERE id = 'g1'")?.history_id).toBe('103');
  });

  it('queues local changes and replays them to Gmail', async () => {
    mail.archive('g1', ['d']);
    expect(store.getLabels('g1', 'd')).not.toContain('INBOX');
    await vi.waitFor(() => expect(server.modifies.length).toBeGreaterThan(0), { timeout: 3000 });
    expect(server.modifies[0]).toEqual({ ids: ['d'], addLabelIds: [], removeLabelIds: ['INBOX'] });
    expect(get<{ n: number }>('SELECT COUNT(*) AS n FROM pending_ops')?.n).toBe(0);
  });

  it('sends a reply in the right thread with a proper MIME body', async () => {
    const d = await mail.prepareReply('g1', 'a', 'reply');
    expect(d.subject).toBe('Re: Budget');
    expect(d.to).toEqual([{ name: 'Priya', email: 'p@x.com' }]);
    d.html = '<p>Thanks — looks good.</p>' + d.html;
    mail.send(d);
    await vi.waitFor(() => expect(server.sent.length).toBe(1), { timeout: 3000 });
    expect(server.sent[0].threadId).toBe('ta');
    const raw = fromBase64Url(server.sent[0].raw).toString('utf8');
    expect(raw).toContain('To: Priya <p@x.com>');
    expect(raw).toContain('Subject: Re: Budget');
    await vi.waitFor(() => expect(get<{ n: number }>('SELECT COUNT(*) AS n FROM outbox')?.n).toBe(0), { timeout: 3000 });
    expect(store.getSummary('g1', 'sent-1')?.labelIds).toContain('SENT');
  });

  it('holds mail for the undo window and lets you cancel', () => {
    setSettings({ undoSendSeconds: 30 });
    const r = mail.send({ localId: 'x', accountId: 'g1', from: 'me@x.com', to: [{ email: 'z@x.com' }], cc: [], bcc: [], subject: 'Oops', html: 'x', attachments: [], mode: 'new' });
    expect(mail.outbox().find((o) => o.id === r.outboxId)?.undoable).toBe(true);
    const back = mail.cancelSend(r.outboxId);
    expect(back?.subject).toBe('Oops');
    expect(mail.outbox()).toHaveLength(0);
  });

  it('starts again when Gmail history has expired', async () => {
    run("UPDATE accounts SET history_id = '10' WHERE id = 'g1'");
    server.history = [];
    await mail.syncMail('g1');
    expect(get<{ history_id: string }>("SELECT history_id FROM accounts WHERE id = 'g1'")?.history_id).toBe(String(server.historyId));
  });

  it('waits out Google rate limits and finishes the sync', async () => {
    run("UPDATE accounts SET initial_done = 0, history_id = NULL WHERE id = 'g1'");
    run("DELETE FROM messages WHERE account_id = 'g1'");
    quotaFailures = 3;
    const t0 = Date.now();
    await mail.syncMail('g1');
    expect(quotaFailures).toBe(0);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900); // honoured Retry-After
    expect(get<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE account_id = 'g1'")?.n).toBeGreaterThan(0);
    expect(get<{ status: string }>("SELECT status FROM accounts WHERE id = 'g1'")?.status).toBe('ok');
  }, 20000);
});
