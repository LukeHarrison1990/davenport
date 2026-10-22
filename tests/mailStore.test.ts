import { beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../app/main/db';
import { seedDemo } from '../app/main/demo';
import * as store from '../app/main/services/mailStore';
import { setSettings } from '../app/main/settings';
import { search as peopleSearch } from '../app/main/services/people';
import { myDay } from '../app/main/services/tasks';

let acc = '';
beforeAll(() => {
  openDatabase('', ':memory:');
  acc = seedDemo();
});

describe('folders', () => {
  it('lists Outlook-style system folders and the label tree', () => {
    const f = store.folders(acc);
    expect(f.slice(0, 3).map((x) => x.name)).toEqual(['Inbox', 'Drafts', 'Sent']);
    expect(f.find((x) => x.path === 'Clients/Acme')?.isCategory).toBe(true);
    const inbox = f.find((x) => x.id === 'INBOX')!;
    expect(inbox.unread).toBe(4);
    expect(f.find((x) => x.id === 'DRAFT')!.total).toBe(1);
  });
});

describe('listing', () => {
  it('splits the inbox into Focused and Other', () => {
    setSettings({ focusedInbox: 'categories', conversationView: false });
    const focused = store.list({ accountId: acc, folder: { type: 'label', id: 'INBOX' }, tab: 'focused' });
    const other = store.list({ accountId: acc, folder: { type: 'label', id: 'INBOX' }, tab: 'other' });
    const all = store.list({ accountId: acc, folder: { type: 'label', id: 'INBOX' }, tab: 'all' });
    expect(focused.length + other.length).toBe(all.length);
    expect(other.map((m) => m.subject)).toContain('20% off desk chairs this week');
    expect(focused.map((m) => m.subject)).toContain('Q4 budget review — revised figures');
    expect(focused[0].date).toBeGreaterThanOrEqual(focused[1].date);
  });

  it('groups conversations and reports thread size', () => {
    setSettings({ conversationView: true });
    const all = store.list({ accountId: acc, folder: { type: 'search', q: 'website' } });
    expect(all.length).toBe(2); // search shows individual messages
    const inbox = store.list({ accountId: acc, folder: { type: 'label', id: 'INBOX' }, tab: 'all' });
    const web = inbox.find((m) => m.subject === 'Re: Website relaunch timeline');
    expect(web?.threadCount).toBe(2);
  });

  it('searches with Gmail operators and free text', () => {
    setSettings({ conversationView: false });
    const fromPriya = store.list({ accountId: acc, folder: { type: 'search', q: 'from:priya has:attachment' } });
    expect(fromPriya.map((m) => m.subject)).toEqual(['Q4 budget review — revised figures']);
    const words = store.list({ accountId: acc, folder: { type: 'search', q: 'pivot tables' } });
    expect(words[0]?.subject).toBe('Lunch and learn: advanced Sheets');
    const unread = store.list({ accountId: acc, folder: { type: 'search', q: 'is:unread' } });
    expect(unread.every((m) => m.unread)).toBe(true);
  });

  it('applies label changes locally', () => {
    const [m] = store.list({ accountId: acc, folder: { type: 'search', q: 'subject:"fire alarm"' } });
    const changed = store.modifyLocal(acc, [m.id], ['STARRED'], ['INBOX']);
    expect(changed).toEqual([m.id]);
    expect(store.getSummary(acc, m.id)?.flagged).toBe(true);
    expect(store.list({ accountId: acc, folder: { type: 'label', id: 'INBOX' } }).some((x) => x.id === m.id)).toBe(false);
    expect(store.modifyLocal(acc, [m.id], ['STARRED'], [])).toEqual([]);
  });
});

describe('people and tasks', () => {
  it('autocompletes from contacts', () => {
    const r = peopleSearch('pri');
    expect(r[0].emails[0]).toBe('priya.shah@northfield.example');
  });
  it('puts flagged email into My Day', () => {
    expect(myDay().some((t) => t.linkedMessage)).toBe(true);
  });
});

describe('deleting', () => {
  it('removes binned mail from every folder except the Bin', () => {
    setSettings({ conversationView: false });
    const inAcme = () => store.list({ accountId: acc, folder: { type: 'label', id: 'Label_brightwater' } });
    const [m] = inAcme();
    expect(m).toBeDefined();
    const before = store.folders(acc).find((f) => f.id === 'Label_brightwater')!.total;
    store.modifyLocal(acc, [m.id], ['TRASH'], ['INBOX', 'UNREAD']);
    expect(inAcme().some((x) => x.id === m.id)).toBe(false);
    expect(store.folders(acc).find((f) => f.id === 'Label_brightwater')!.total).toBe(before - 1);
    expect(store.list({ accountId: acc, folder: { type: 'label', id: 'TRASH' } }).some((x) => x.id === m.id)).toBe(true);
    expect(store.list({ accountId: acc, folder: { type: 'label', id: 'ALL' } }).some((x) => x.id === m.id)).toBe(false);
  });
  it('hides binned sent mail and flagged mail too', () => {
    const [sent] = store.list({ accountId: acc, folder: { type: 'label', id: 'SENT' } });
    store.modifyLocal(acc, [sent.id], ['TRASH', 'STARRED'], []);
    expect(store.list({ accountId: acc, folder: { type: 'label', id: 'SENT' } }).some((x) => x.id === sent.id)).toBe(false);
    expect(store.list({ accountId: acc, folder: { type: 'flagged' } }).some((x) => x.id === sent.id)).toBe(false);
  });
});
