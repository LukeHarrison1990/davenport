// Sample data for the demo account, so every screen can be explored before connecting Google.
import type { Addr, CalEvent, ChatMessage, ChatSpace, Contact, Task } from '../shared/types';
import { get, run, tx } from './db';
import { changed } from './events';
import { createDemoAccount } from './services/accounts';
import { upsertMessage } from './services/mailStore';

const ME: Addr = { name: 'Alex Morgan', email: 'alex@northfield.example' };
const P = {
  priya: { name: 'Priya Shah', email: 'priya.shah@northfield.example' },
  tom: { name: 'Tom Hargreaves', email: 'tom.hargreaves@northfield.example' },
  lena: { name: 'Lena Okafor', email: 'lena@brightwater.example' },
  sarah: { name: 'Sarah Chen', email: 'sarah.chen@northfield.example' },
  daniel: { name: 'Daniel Reyes', email: 'daniel.reyes@northfield.example' },
  facilities: { name: 'Facilities', email: 'facilities@northfield.example' },
  ap: { name: 'Accounts payable', email: 'ap@northfield.example' },
  cal: { name: 'Google Calendar', email: 'calendar-notification@google.com' },
  news: { name: 'The Workplace Weekly', email: 'newsletter@workplaceweekly.example' },
  shop: { name: 'Officeland', email: 'offers@officeland.example' }
};

const LABELS: [string, string, string | null, number][] = [
  ['Label_clients', 'Clients', null, 0],
  ['Label_acme', 'Clients/Acme', '#F6EBDD', 1],
  ['Label_brightwater', 'Clients/Brightwater', null, 0],
  ['Label_finance', 'Finance', '#E6F1EA', 1],
  ['Label_projects', 'Projects', '#E5ECF7', 1],
  ['Label_website', 'Projects/Website relaunch', null, 0]
];

export function seedDemo(): string {
  const accountId = createDemoAccount();
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const at = (dayOffset: number, h: number, m = 0) => today.getTime() + dayOffset * 864e5 + (h * 60 + m) * 60_000;
  // Keep "today" messages in the past even early in the morning.
  const todayAt = (h: number, m: number) => Math.min(at(0, h, m), Date.now() - (12 - h) * 60_000 - 60_000);

  tx(() => {
    for (const sys of ['INBOX', 'SENT', 'DRAFT', 'TRASH', 'SPAM', 'STARRED', 'IMPORTANT', 'UNREAD', 'CATEGORY_PERSONAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES']) {
      run("INSERT OR IGNORE INTO labels (account_id, id, name, path, type) VALUES (?, ?, ?, ?, 'system')", accountId, sys, sys, sys);
    }
    for (const [id, path, color, cat] of LABELS) {
      const catColor = cat ? (path.includes('Finance') ? '#2E7D5B' : path.includes('Acme') ? '#9A7740' : '#24497A') : null;
      run('INSERT OR IGNORE INTO labels (account_id, id, name, path, type, color, is_category) VALUES (?, ?, ?, ?, ?, ?, ?)', accountId, id, path.split('/').pop(), path, 'user', catColor ?? color, cat);
    }

    let n = 0;
    const msg = (o: {
      from: Addr; to?: Addr[]; cc?: Addr[]; subject: string; html: string; date: number; labels: string[]; attachments?: { filename: string; mimeType: string; size: number }[]; thread?: string;
    }) => {
      const id = 'demo-' + ++n;
      const text = o.html.replace(/<br\s*\/?>/g, '\n').replace(/<\/p>/g, '\n\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
      upsertMessage(accountId, {
        id, threadId: o.thread ?? id, labelIds: o.labels, snippet: text.replace(/\s+/g, ' ').slice(0, 140), date: o.date, size: o.html.length,
        from: o.from, to: o.to ?? [ME], cc: o.cc ?? [], bcc: [], replyTo: [], subject: o.subject, messageIdHeader: `<${id}@northfield.example>`,
        hasAttachments: !!o.attachments?.length, html: `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.55">${o.html}</div>`, text,
        attachments: (o.attachments ?? []).map((a, i) => ({ id: 'att' + i, ...a })), full: true
      });
      return id;
    };

    const budget = msg({
      from: P.priya, cc: [{ name: 'Finance team', email: 'finance@northfield.example' }], subject: 'Q4 budget review — revised figures', date: todayAt(9, 42),
      labels: ['INBOX', 'UNREAD', 'IMPORTANT', 'STARRED', 'Label_finance', 'CATEGORY_PERSONAL'],
      html: `<p>Hi Alex,</p><p>Attached are the revised Q4 figures ahead of the review. The main change is the facilities line, which now reflects the new maintenance contract from November.</p>
      <p>Could you check the IT capital spend in rows 40–52 and let me know if the laptop refresh can move into January? If it can, we come in under the forecast.</p><p>Thanks,<br>Priya</p>`,
      attachments: [
        { filename: 'Q4-budget-revised.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 86016 },
        { filename: 'Variance-notes.pdf', mimeType: 'application/pdf', size: 217088 }
      ]
    });
    run('UPDATE messages SET flag_due = ? WHERE account_id = ? AND id = ?', at(1, 17), accountId, budget);

    const webThread = 'demo-thread-web';
    msg({ from: ME, to: [P.tom], subject: 'Website relaunch timeline', date: at(-1, 15, 10), labels: ['SENT'], thread: webThread,
      html: '<p>Tom, can we look at moving the soft launch? Marketing would like a little more time on the pricing page.</p><p>Alex</p>' });
    msg({ from: P.tom, subject: 'Re: Website relaunch timeline', date: todayAt(9, 15), labels: ['INBOX', 'UNREAD', 'Label_projects', 'Label_website', 'CATEGORY_PERSONAL'], thread: webThread,
      html: '<p>Agree on moving the soft launch to the 10th — can we confirm the DNS change window with IT before then?</p><p>I have put the checklist in the shared drive.</p><p>Tom</p>' });
    msg({ from: P.cal, subject: 'Invitation: Supplier call', date: todayAt(8, 50), labels: ['INBOX', 'UNREAD', 'CATEGORY_UPDATES'],
      html: `<p><b>Supplier call</b></p><p>Lena Okafor has invited you to this event.</p><p>Join with Google Meet: meet.google.com/abc-defg-hij</p>` });
    msg({ from: P.lena, subject: 'Contract draft v3 for Acme', date: todayAt(8, 12), labels: ['INBOX', 'Label_acme', 'Label_clients', 'CATEGORY_PERSONAL'],
      html: '<p>Hi Alex,</p><p>Tracked changes are on clauses 4 and 9 only. Happy to talk it through on Thursday if that helps.</p><p>Best wishes,<br>Lena</p>',
      attachments: [{ filename: 'Acme-contract-v3.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 48128 }] });
    msg({ from: P.sarah, subject: 'Re: Interview panel next week', date: at(-1, 16, 20), labels: ['INBOX', 'STARRED', 'CATEGORY_PERSONAL'],
      html: '<p>Tuesday afternoon works for me. I\'ll send the candidate packs round on Monday.</p><p>Sarah</p>' });
    msg({ from: P.facilities, subject: 'Fire alarm test on Friday', date: at(-1, 11, 5), labels: ['INBOX', 'CATEGORY_UPDATES'],
      html: '<p>The weekly fire alarm test will take place at 11:00 on Friday. No action is needed.</p>' });
    msg({ from: P.daniel, subject: 'Lunch and learn: advanced Sheets', date: at(-1, 9, 30), labels: ['INBOX', 'CATEGORY_PERSONAL'],
      html: '<p>Bring your laptop — we\'ll cover pivot tables and QUERY. Sandwiches provided.</p><p>Daniel</p>' });
    msg({ from: P.news, subject: 'This week: hybrid working, revisited', date: at(-2, 7, 0), labels: ['INBOX', 'CATEGORY_PROMOTIONS'],
      html: '<p>Five things we learned from a year of hybrid teams…</p>' });
    msg({ from: P.shop, subject: '20% off desk chairs this week', date: at(-3, 10, 0), labels: ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS'],
      html: '<p>Upgrade your workspace with our autumn sale.</p>' });
    msg({ from: P.ap, subject: 'Invoice INV-2041 paid', date: at(-6, 15, 0), labels: ['INBOX', 'Label_finance', 'CATEGORY_UPDATES'],
      html: '<p>Payment of £4,280.00 was made on 14 October to Brightwater Ltd.</p>', attachments: [{ filename: 'INV-2041.pdf', mimeType: 'application/pdf', size: 51200 }] });
    msg({ from: P.lena, subject: 'Brightwater onboarding pack', date: at(-8, 11, 0), labels: ['Label_brightwater', 'Label_clients'],
      html: '<p>Here is the onboarding pack we discussed.</p>' });
    msg({ from: ME, to: [P.priya], subject: 'Laptop refresh quotes', date: at(-2, 14, 30), labels: ['SENT'],
      html: '<p>Priya — three quotes attached for the laptop refresh. The middle option is best value.</p><p>Alex</p>' });
    msg({ from: ME, to: [P.daniel], subject: 'Team offsite venues', date: at(0, 7, 0), labels: ['DRAFT'],
      html: '<p>Daniel, I\'ve shortlisted three venues for the offsite:</p><ul><li>The Corn Exchange</li><li>Harewood House</li></ul>' });
  });

  seedCalendar(accountId, at);
  seedPeople(accountId);
  seedTasks(accountId, at);
  seedChat(accountId, todayAt, at);
  return accountId;
}

function seedCalendar(accountId: string, at: (d: number, h: number, m?: number) => number) {
  const dow = new Date().getDay(); // 0 Sun
  const mon = (dow === 0 ? -6 : 1 - dow);
  const ev = (d: number, sh: number, sm: number, eh: number, em: number, title: string, extra: Partial<CalEvent> = {}): CalEvent => ({
    accountId, calendarId: 'primary', id: 'ev-' + title.replace(/\W/g, '') + d + sh, title, start: at(d, sh, sm), end: at(d, eh, em), allDay: false,
    attendees: [], eventType: 'default', status: 'confirmed', color: '#1F3A5F', canEdit: true, myResponse: 'accepted', ...extra
  });
  const evs: CalEvent[] = [];
  for (let d = mon - 7; d < mon + 21; d++) {
    const wd = (new Date(at(d, 12)).getDay());
    if (wd === 0 || wd === 6) continue;
    evs.push(ev(d, 10, 30, 10, 45, 'Team stand-up', { meetUrl: 'https://meet.google.com/abc-defg-hij', id: 'ev-standup-' + d, recurringEventId: 'ev-standup',
      attendees: [{ email: ME.email, name: ME.name, response: 'accepted', self: true }, { email: P.tom.email, name: P.tom.name, response: 'accepted' }, { email: P.priya.email, name: P.priya.name, response: 'accepted' }] }));
  }
  evs.push(ev(mon, 9, 0, 9, 30, 'Weekly planning', { location: 'Room 2.04' }));
  evs.push(ev(mon, 13, 0, 14, 0, 'Lunch and learn: Sheets', { location: 'Board room' }));
  evs.push(ev(mon, 15, 0, 16, 30, 'Focus time', { eventType: 'focusTime', autoDecline: true }));
  evs.push(ev(mon + 1, 11, 0, 12, 0, 'Interview panel', { meetUrl: 'https://meet.google.com/xyz-uvwx-rst', attendees: [{ email: P.sarah.email, name: P.sarah.name, response: 'accepted' }, { email: ME.email, response: 'accepted', self: true }] }));
  evs.push(ev(mon + 1, 14, 0, 15, 0, 'Website relaunch review', { meetUrl: 'https://meet.google.com/web-rela-unc', organizer: P.tom, canEdit: false,
    attendees: [{ email: P.tom.email, name: P.tom.name, response: 'accepted', organizer: true }, { email: ME.email, name: ME.name, response: 'accepted', self: true }] }));
  evs.push(ev(mon + 2, 14, 0, 14, 30, '1:1 with Priya', { location: 'Room 2.04', color: '#9A7740',
    attendees: [{ email: P.priya.email, name: P.priya.name, response: 'accepted' }, { email: ME.email, response: 'accepted', self: true }, { email: 'room-204@resource.calendar.google.com', name: 'Room 2.04', response: 'accepted', resource: true }] }));
  evs.push(ev(mon + 2, 16, 0, 17, 0, 'Focus time', { eventType: 'focusTime', autoDecline: true }));
  evs.push(ev(mon + 3, 14, 0, 15, 0, 'Supplier call', { meetUrl: 'https://meet.google.com/abc-defg-hij', organizer: P.lena, canEdit: false, myResponse: 'needsAction',
    attendees: [{ email: P.lena.email, name: P.lena.name, response: 'accepted', organizer: true }, { email: ME.email, name: ME.name, response: 'needsAction', self: true }] }));
  evs.push(ev(mon + 4, 0, 0, 0, 0, 'Out of office', { allDay: true, start: at(mon + 4, 0), end: at(mon + 5, 0), eventType: 'outOfOffice', autoDecline: true, description: 'Annual leave' }));
  const wl: [number, string][] = [[mon, 'Office'], [mon + 1, 'Home'], [mon + 2, 'Office'], [mon + 3, 'Office']];
  for (const [d, place] of wl) evs.push(ev(d, 0, 0, 0, 0, place, { id: 'wl-' + d, allDay: true, start: at(d, 0), end: at(d + 1, 0), eventType: 'workingLocation', workingLocation: place, color: '#5B6472' }));
  evs.push(ev(mon + 7, 10, 0, 16, 0, 'Team offsite', { location: 'Harewood House', color: '#2E7D5B' }));

  tx(() => {
    run("INSERT OR REPLACE INTO calendars (account_id, id, name, color, is_primary, selected, access_role, kind) VALUES (?, 'primary', 'Alex Morgan', '#1F3A5F', 1, 1, 'owner', 'mine')", accountId);
    run("INSERT OR REPLACE INTO calendars (account_id, id, name, color, is_primary, selected, access_role, kind) VALUES (?, 'holidays', 'Team holidays', '#2E7D5B', 0, 1, 'writer', 'mine')", accountId);
    run("INSERT OR REPLACE INTO calendars (account_id, id, name, color, is_primary, selected, access_role, kind) VALUES (?, ?, 'Priya Shah', '#9A7740', 0, 0, 'reader', 'other')", accountId, P.priya.email);
    run("INSERT OR REPLACE INTO calendars (account_id, id, name, color, is_primary, selected, access_role, kind) VALUES (?, 'room-204@resource.calendar.google.com', 'Room 2.04 (8 seats)', '#5B6472', 0, 0, 'freeBusyReader', 'resource')", accountId);
    for (const e of evs) run('INSERT OR REPLACE INTO events (account_id, calendar_id, id, start, end, json) VALUES (?, ?, ?, ?, ?, ?)', accountId, e.calendarId, e.id, e.start, e.end, JSON.stringify(e));
    const hol: CalEvent = { accountId, calendarId: 'holidays', id: 'hol-1', title: 'Sarah — annual leave', start: at(mon + 9, 0), end: at(mon + 12, 0), allDay: true, attendees: [], eventType: 'default', status: 'confirmed', color: '#2E7D5B', canEdit: true };
    run('INSERT OR REPLACE INTO events (account_id, calendar_id, id, start, end, json) VALUES (?, ?, ?, ?, ?, ?)', accountId, 'holidays', hol.id, hol.start, hol.end, JSON.stringify(hol));
  });
}

function seedPeople(accountId: string) {
  const c = (id: string, a: Addr, extra: Partial<Contact> = {}): Contact => ({
    accountId, id: 'people/demo-' + id, name: a.name!, emails: [a.email], phones: [], groups: [], source: 'contacts', ...extra
  });
  const list = [
    c('priya', P.priya, { company: 'Northfield', title: 'Finance Manager', phones: ['+44 113 496 0123'], groups: ['contactGroups/demo-team'] }),
    c('tom', P.tom, { company: 'Northfield', title: 'Web Lead', phones: ['+44 113 496 0456'], groups: ['contactGroups/demo-team'] }),
    c('lena', P.lena, { company: 'Brightwater Ltd', title: 'Account Director', phones: ['+44 20 7946 0321'], groups: ['contactGroups/demo-clients'], address: '12 Wharf Street, Leeds LS2 7EH' }),
    c('sarah', P.sarah, { company: 'Northfield', title: 'People Partner', groups: ['contactGroups/demo-team'] }),
    c('daniel', P.daniel, { company: 'Northfield', title: 'Data Analyst', groups: ['contactGroups/demo-team'] }),
    c('marcus', { name: 'Marcus Webb', email: 'marcus@acme.example' }, { company: 'Acme Corp', title: 'Procurement', phones: ['+44 161 496 0777'], groups: ['contactGroups/demo-clients'] }),
    c('hannah', { name: 'Hannah Ellis', email: 'hannah.ellis@northfield.example' }, { company: 'Northfield', title: 'Office Manager' })
  ];
  tx(() => {
    for (const x of list) run('INSERT OR REPLACE INTO contacts (account_id, id, name, emails, source, json) VALUES (?, ?, ?, ?, ?, ?)', accountId, x.id, x.name, x.emails.join(' '), 'contacts', JSON.stringify(x));
    const staff: [string, string, string, string][] = [
      ['Alex Morgan', 'alex', 'Operations Manager', 'Operations'], ['Priya Shah', 'priya.shah', 'Finance Manager', 'Finance'],
      ['Tom Hargreaves', 'tom.hargreaves', 'Web Lead', 'Digital'], ['Sarah Chen', 'sarah.chen', 'People Partner', 'People'],
      ['Daniel Reyes', 'daniel.reyes', 'Data Analyst', 'Finance'], ['Hannah Ellis', 'hannah.ellis', 'Office Manager', 'Operations'],
      ['Oliver Grant', 'oliver.grant', 'Head of IT', 'IT'], ['Amelia Ward', 'amelia.ward', 'Receptionist', 'Operations'],
      ['James Okoro', 'james.okoro', 'Developer', 'Digital'], ['Grace Liu', 'grace.liu', 'Marketing Lead', 'Marketing'],
      ['Ethan Price', 'ethan.price', 'Accounts Assistant', 'Finance'], ['Chloe Bennett', 'chloe.bennett', 'Designer', 'Marketing'],
      ['Mohammed Rahman', 'mohammed.rahman', 'IT Technician', 'IT'], ['Isla Murray', 'isla.murray', 'Facilities Coordinator', 'Operations']
    ];
    for (const [name, user, title, dept] of staff) {
      const d: Contact = { accountId, id: 'people/dir-' + user, name, emails: [user + '@northfield.example'], phones: [], groups: [], source: 'directory', company: 'Northfield · ' + dept, title };
      run('INSERT OR REPLACE INTO contacts (account_id, id, name, emails, source, json) VALUES (?, ?, ?, ?, ?, ?)', accountId, d.id, d.name, d.emails[0], 'directory', JSON.stringify(d));
    }
    run("INSERT OR REPLACE INTO contact_groups (account_id, id, name, count) VALUES (?, 'contactGroups/demo-team', 'My team', 4)", accountId);
    run("INSERT OR REPLACE INTO contact_groups (account_id, id, name, count) VALUES (?, 'contactGroups/demo-clients', 'Clients', 2)", accountId);
  });
}

function seedTasks(accountId: string, at: (d: number, h: number, m?: number) => number) {
  const t = (id: string, title: string, due?: number, extra: Partial<Task> = {}): Task => ({ accountId, listId: 'list-main', id, title, due, completed: false, ...extra });
  const list = [
    t('t1', 'Review Acme contract', at(0, 0)),
    t('t2', 'Q4 budget review — revised figures', at(1, 0), { linkedMessage: { messageId: 'demo-1', subject: 'Q4 budget review — revised figures' }, notes: 'Follow up on email from Priya Shah' }),
    t('t3', 'Book venue for team offsite', at(10, 0)),
    t('t4', 'Renew SSL certificate', at(5, 0)),
    t('t5', 'Send onboarding pack to Brightwater', undefined, { completed: true, completedAt: at(-2, 12) })
  ];
  tx(() => {
    run("INSERT OR REPLACE INTO tasklists (account_id, id, title) VALUES (?, 'list-main', 'My Tasks')", accountId);
    run("INSERT OR REPLACE INTO tasklists (account_id, id, title) VALUES (?, 'list-home', 'Personal')", accountId);
    for (const x of list) run('INSERT OR REPLACE INTO tasks (account_id, list_id, id, json) VALUES (?, ?, ?, ?)', accountId, x.listId, x.id, JSON.stringify(x));
    run("UPDATE messages SET task_id = 't2' WHERE account_id = ? AND id = 'demo-1'", accountId);
  });
}

function seedChat(accountId: string, todayAt: (h: number, m: number) => number, at: (d: number, h: number, m?: number) => number) {
  const space = (id: string, name: string, kind: ChatSpace['kind'], unread: number, lastActive: number, lastPreview: string, extra: Partial<ChatSpace> = {}): ChatSpace => ({
    accountId, id: 'spaces/' + id, name, kind, unread, lastActive, lastPreview, ...extra
  });
  const spaces = [
    space('web', 'Website relaunch', 'space', 0, todayAt(9, 48), 'Tom: @Alex Morgan can you confirm…', { memberCount: 7, external: true }),
    space('fin', 'Finance team', 'space', 2, todayAt(9, 30), 'Priya: Q4 pack is in the drive', { memberCount: 5 }),
    space('it', 'IT helpdesk', 'space', 0, at(-1, 16), 'Printer on floor 2 is fixed', { memberCount: 24 }),
    space('all', 'All staff announcements', 'space', 0, at(-1, 11), 'Fire alarm test on Friday at 11:00', { memberCount: 140 }),
    space('dm-priya', 'Priya Shah', 'dm', 1, todayAt(9, 55), 'See you at 2 in 2.04'),
    space('dm-tom', 'Tom Hargreaves', 'dm', 0, at(-1, 17), 'You: sounds good'),
    space('dm-lena', 'Lena Okafor', 'dm', 0, at(-2, 12), 'Contract v3 attached')
  ];
  const m = (sp: string, id: string, sender: Addr, text: string, t: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    accountId, spaceId: 'spaces/' + sp, id: `spaces/${sp}/messages/${id}`, sender: { id: sender.email === ME.email ? 'users/demo-me' : 'users/' + sender.email, name: sender.name!, email: sender.email },
    text, createTime: t, threadId: `spaces/${sp}/threads/${extra.threadId ?? id}`, isThreadReply: false, attachments: [], reactions: [], mine: sender.email === ME.email, ...extra
  });
  const msgs: ChatMessage[] = [
    m('web', 'w1', P.tom, 'Morning all — staging is updated with the new navigation. Can everyone give it a click-through before Friday? https://staging.northfield.example', todayAt(9, 2), { reactions: [{ emoji: '👍', count: 3, mine: false }] }),
    m('web', 'w2', P.priya, "The pricing page still shows last year's figures. I've updated the sheet with next year's prices.", todayAt(9, 20), { attachments: [{ name: 'Pricing 2027', kind: 'drive', url: 'https://drive.google.com' }] }),
    m('web', 'w2r1', P.tom, "Thanks — I'll pull the new numbers in this afternoon.", todayAt(9, 34), { threadId: 'w2', isThreadReply: true }),
    m('web', 'w2r2', P.priya, 'Great. The GBP column is final; EUR follows on Friday.', todayAt(9, 40), { threadId: 'w2', isThreadReply: true }),
    m('web', 'w3', P.lena, "From our side the contract page copy is approved — go ahead whenever you're ready.", todayAt(9, 31)),
    m('web', 'w4', P.tom, '@Alex Morgan can you confirm the certificate renewal is booked before the 10th?', todayAt(9, 48)),
    m('fin', 'f1', P.daniel, 'Month-end close is done. Variance report in the usual folder.', todayAt(8, 40)),
    m('fin', 'f2', P.priya, 'Q4 pack is in the drive — please check your cost centre lines by Thursday.', todayAt(9, 30)),
    m('dm-priya', 'p1', ME, 'Have you got ten minutes before our 1:1?', todayAt(9, 50)),
    m('dm-priya', 'p2', P.priya, 'See you at 2 in 2.04', todayAt(9, 55)),
    m('dm-tom', 't1', P.tom, 'Shall we move the DNS change to Thursday evening?', at(-1, 16, 50)),
    m('dm-tom', 't2', ME, 'sounds good', at(-1, 17)),
    m('it', 'i1', { name: 'IT helpdesk', email: 'it@northfield.example' }, 'Printer on floor 2 is fixed', at(-1, 16)),
    m('all', 'a1', P.facilities, 'Fire alarm test on Friday at 11:00', at(-1, 11)),
    m('dm-lena', 'l1', P.lena, 'Contract v3 attached', at(-2, 12), { attachments: [{ name: 'Acme-contract-v3.docx', kind: 'drive', url: 'https://drive.google.com' }] })
  ];
  tx(() => {
    for (const s of spaces) run('INSERT OR REPLACE INTO chat_spaces (account_id, id, json, last_active) VALUES (?, ?, ?, ?)', accountId, s.id, JSON.stringify(s), s.lastActive);
    for (const x of msgs) run('INSERT OR REPLACE INTO chat_messages (account_id, space_id, id, create_time, thread_id, json) VALUES (?, ?, ?, ?, ?, ?)', accountId, x.spaceId, x.id, x.createTime, x.threadId ?? null, JSON.stringify(x));
  });
}

/** Demo account only: a new reply arrives in a conversation, as if from Gmail (used by the interface checks). */
export function demoReceive(threadId: string): string {
  const accountId = 'demo';
  const last = get<{ subject: string }>(
    "SELECT subject FROM messages WHERE account_id = ? AND thread_id = ? AND labels NOT LIKE '%\"DRAFT\"%' ORDER BY date DESC LIMIT 1",
    accountId, threadId
  );
  if (!last) throw new Error('No such conversation in the demo account.');
  const id = 'demo-in-' + Date.now();
  const from = P.priya;
  const html = '<p>One more thing: can we confirm by Friday?</p>';
  upsertMessage(accountId, {
    id, threadId, labelIds: ['INBOX', 'UNREAD'], snippet: 'One more thing: can we confirm by Friday?', date: Date.now(), size: html.length,
    from, to: [ME], cc: [], bcc: [], replyTo: [], subject: last.subject.startsWith('Re:') ? last.subject : 'Re: ' + last.subject,
    messageIdHeader: `<${id}@northfield.example>`, hasAttachments: false, html, text: 'One more thing: can we confirm by Friday?', attachments: [], full: true
  });
  changed('mail', accountId);
  changed('folders', accountId);
  return id;
}
