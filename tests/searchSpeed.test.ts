// Guards against search slowing down again on large mailboxes.
import { vi, beforeAll, expect, it } from 'vitest';
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, safeStorage: { isEncryptionAvailable: () => false } }));
import { openDatabase, tx } from '../app/main/db';
import { deleteLocal, list, upsertMessage } from '../app/main/services/mailStore';
import { setSettings } from '../app/main/settings';

const words = 'budget review meeting invoice payment project website launch contract client report schedule update team office holiday training policy finance agenda minutes'.split(' ');
let seed = 1;
const rnd = (n: number) => ((seed = (seed * 16807) % 2147483647), seed % n);
const sentence = (n: number) => Array.from({ length: n }, () => words[rnd(words.length)]).join(' ');

beforeAll(() => {
  openDatabase('', ':memory:');
  setSettings({ conversationView: true });
  tx(() => {
    for (let i = 0; i < 8000; i++) {
      upsertMessage('a', {
        id: 'm' + i, threadId: 't' + rnd(4000), labelIds: ['INBOX'], snippet: sentence(15), date: 1_700_000_000_000 - i * 60000, size: 1000,
        from: { name: 'Person ' + rnd(300), email: `p${rnd(300)}@x.com` }, to: [{ email: 'me@x.com' }], cc: [], bcc: [], replyTo: [],
        subject: i === 4321 ? 'Quarterly zephyr report' : sentence(5), hasAttachments: false, text: sentence(100), attachments: [], full: true
      });
    }
  });
}, 60000);

it('searches 8,000 messages quickly, even for one or two letters', () => {
  for (const q of ['b', 'bu', 'bud', 'budget', 'budget rev', 'from:person']) {
    const t = performance.now();
    const r = list({ accountId: 'all', folder: { type: 'search', q }, limit: 200 });
    expect(r.length).toBeGreaterThan(0);
    expect(performance.now() - t).toBeLessThan(1000);
  }
});

it('finds, updates and forgets index entries correctly', () => {
  expect(list({ accountId: 'all', folder: { type: 'search', q: 'zephyr' } }).map((m) => m.id)).toEqual(['m4321']);
  deleteLocal('a', ['m4321']);
  expect(list({ accountId: 'all', folder: { type: 'search', q: 'zephyr' } })).toHaveLength(0);
});
