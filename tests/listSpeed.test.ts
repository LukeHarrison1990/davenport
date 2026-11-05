// Guards against the message list slowing down again: every list refresh runs on the engine's main thread,
// so a slow query freezes the whole window (1.0.16 took 1.4 s per Inbox refresh on a mailbox like this).
import { vi, beforeAll, expect, it } from 'vitest';
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, safeStorage: { isEncryptionAvailable: () => false } }));
import { openDatabase, tx } from '../app/main/db';
import * as store from '../app/main/services/mailStore';
import { setSettings } from '../app/main/settings';

let seed = 7;
const rnd = (n: number) => ((seed = (seed * 16807) % 2147483647), seed % n);
beforeAll(() => {
  openDatabase('', ':memory:');
  setSettings({ conversationView: true, focusedInbox: 'categories' });
  tx(() => {
    for (let i = 0; i < 20000; i++) {
      const mine = rnd(4) === 0;
      const inInbox = !mine && i < 7000 && rnd(4) === 0;
      const labels = mine ? ['SENT'] : inInbox ? ['INBOX', 'CATEGORY_PERSONAL', ...(rnd(60) === 0 ? ['UNREAD'] : [])] : ['CATEGORY_UPDATES', 'Label_' + rnd(30)];
      store.upsertMessage('a', {
        id: 'm' + i, threadId: 't' + rnd(9000), labelIds: labels, snippet: 'snippet ' + i, date: 1_790_000_000_000 - i * 300000, size: 1000,
        from: mine ? { name: 'Me', email: 'me@x.com' } : { name: 'Person ' + rnd(400), email: `p${rnd(400)}@x.com` }, to: [{ email: 'me@x.com' }], cc: [], bcc: [], replyTo: [],
        subject: 'Subject ' + rnd(5000), hasAttachments: false, text: 'body ' + i, attachments: [], full: false
      });
    }
  });
}, 120000);

const ms = (fn: () => unknown) => {
  fn(); // warm up
  const t = performance.now();
  for (let i = 0; i < 3; i++) fn();
  return (performance.now() - t) / 3;
};

it('lists conversations on a 20,000-message mailbox quickly', () => {
  // Generous limits so slower machines pass; before the fix these took well over a second.
  expect(ms(() => store.list({ accountId: 'a', folder: { type: 'label', id: 'INBOX' }, tab: 'focused', limit: 200 }))).toBeLessThan(300);
  expect(ms(() => store.list({ accountId: 'a', folder: { type: 'label', id: 'INBOX' }, limit: 200 }))).toBeLessThan(300);
  expect(ms(() => store.list({ accountId: 'all', folder: { type: 'unified', label: 'INBOX' }, tab: 'other', limit: 200 }))).toBeLessThan(300);
  expect(ms(() => store.folders('a'))).toBeLessThan(300);
});

it('still returns the right conversations', () => {
  const rows = store.list({ accountId: 'a', folder: { type: 'label', id: 'INBOX' }, limit: 200 });
  expect(rows.length).toBe(200);
  expect(new Set(rows.map((r) => r.threadId)).size).toBe(200); // one row per conversation
  for (let i = 1; i < rows.length; i++) expect(rows[i - 1].date).toBeGreaterThanOrEqual(rows[i].date); // newest first
  const focused = store.list({ accountId: 'a', folder: { type: 'label', id: 'INBOX' }, tab: 'focused', limit: 2000 });
  const other = store.list({ accountId: 'a', folder: { type: 'label', id: 'INBOX' }, tab: 'other', limit: 2000 });
  expect(focused.length).toBeGreaterThan(0);
  expect(other.every((r) => !focused.some((f) => f.id === r.id))).toBe(true);
});
