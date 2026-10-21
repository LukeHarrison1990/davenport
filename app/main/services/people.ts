// Google Contacts (People API): your contacts, "other contacts" for autocomplete, and the Workspace directory.
import type { Contact, ContactGroup } from '../../shared/types';
import { all, get, run, tx, uid } from '../db';
import { changed } from '../events';
import { GoogleApiError } from '../google/http';
import { client, isDemo, listAccounts } from './accounts';

const PEOPLE = 'https://people.googleapis.com/v1';
const FIELDS = 'names,emailAddresses,phoneNumbers,organizations,photos,memberships,addresses,biographies';

interface GPerson {
  resourceName: string;
  etag?: string;
  names?: { displayName?: string; givenName?: string; familyName?: string }[];
  emailAddresses?: { value: string }[];
  phoneNumbers?: { value: string }[];
  organizations?: { name?: string; title?: string }[];
  photos?: { url: string; default?: boolean }[];
  memberships?: { contactGroupMembership?: { contactGroupResourceName: string } }[];
  addresses?: { formattedValue?: string }[];
  biographies?: { value: string }[];
}

function fromPerson(accountId: string, p: GPerson, source: Contact['source']): Contact {
  const n = p.names?.[0];
  const emails = (p.emailAddresses ?? []).map((e) => e.value);
  return {
    accountId,
    id: p.resourceName,
    name: n?.displayName || emails[0] || '(No name)',
    givenName: n?.givenName,
    familyName: n?.familyName,
    emails,
    phones: (p.phoneNumbers ?? []).map((x) => x.value),
    company: p.organizations?.[0]?.name,
    title: p.organizations?.[0]?.title,
    photoUrl: p.photos?.find((x) => !x.default)?.url,
    address: p.addresses?.[0]?.formattedValue,
    notes: p.biographies?.[0]?.value,
    groups: (p.memberships ?? [])
      .map((m) => m.contactGroupMembership?.contactGroupResourceName)
      .filter((g): g is string => !!g && g !== 'contactGroups/myContacts'),
    source,
    etag: p.etag
  };
}

function toPerson(c: Contact): GPerson {
  return {
    resourceName: c.id,
    etag: c.etag,
    names: [{ givenName: c.givenName ?? c.name.split(' ')[0], familyName: c.familyName ?? c.name.split(' ').slice(1).join(' ') }],
    emailAddresses: c.emails.filter(Boolean).map((value) => ({ value })),
    phoneNumbers: c.phones.filter(Boolean).map((value) => ({ value })),
    organizations: c.company || c.title ? [{ name: c.company, title: c.title }] : [],
    addresses: c.address ? [{ formattedValue: c.address }] : [],
    biographies: c.notes ? [{ value: c.notes }] : []
  };
}

function store(c: Contact): void {
  run(
    'INSERT OR REPLACE INTO contacts (account_id, id, name, emails, source, json) VALUES (?, ?, ?, ?, ?, ?)',
    c.accountId, c.id, c.name, c.emails.join(' ').toLowerCase(), c.source, JSON.stringify(c)
  );
}

export async function syncPeople(accountId: string): Promise<void> {
  if (isDemo(accountId)) return;
  const c = client(accountId);
  const people = await c.all<GPerson>(PEOPLE + '/people/me/connections', 'connections', { personFields: FIELDS, pageSize: 1000 }, 20);
  let others: GPerson[] = [];
  try {
    others = await c.all<GPerson>(PEOPLE + '/otherContacts', 'otherContacts', { readMask: 'names,emailAddresses', pageSize: 1000 }, 10);
  } catch {
    /* optional */
  }
  const groups = await c
    .get<{ contactGroups?: { resourceName: string; name: string; formattedName?: string; memberCount?: number; groupType: string }[] }>(PEOPLE + '/contactGroups', { pageSize: 200 })
    .catch(() => ({ contactGroups: [] }));
  tx(() => {
    run("DELETE FROM contacts WHERE account_id = ? AND source IN ('contacts','other')", accountId);
    for (const p of people) store(fromPerson(accountId, p, 'contacts'));
    for (const p of others) if (p.emailAddresses?.length) store(fromPerson(accountId, p, 'other'));
    run('DELETE FROM contact_groups WHERE account_id = ?', accountId);
    for (const g of groups.contactGroups ?? []) {
      if (g.groupType !== 'USER_CONTACT_GROUP') continue;
      run('INSERT INTO contact_groups (account_id, id, name, count) VALUES (?, ?, ?, ?)', accountId, g.resourceName, g.formattedName ?? g.name, g.memberCount ?? 0);
    }
  });
  changed('people', accountId);
}

export function list(accountId: string | 'all', groupId?: string): Contact[] {
  const rows = accountId === 'all'
    ? all<{ json: string }>("SELECT json FROM contacts WHERE source = 'contacts' ORDER BY name COLLATE NOCASE")
    : all<{ json: string }>("SELECT json FROM contacts WHERE account_id = ? AND source = 'contacts' ORDER BY name COLLATE NOCASE", accountId);
  const out = rows.map((r) => JSON.parse(r.json) as Contact);
  return groupId ? out.filter((c) => c.groups.includes(groupId)) : out;
}

export function groups(accountId: string | 'all'): ContactGroup[] {
  const rows = accountId === 'all'
    ? all<{ account_id: string; id: string; name: string }>('SELECT * FROM contact_groups ORDER BY name')
    : all<{ account_id: string; id: string; name: string }>('SELECT * FROM contact_groups WHERE account_id = ? ORDER BY name', accountId);
  return rows.map((g) => ({
    accountId: g.account_id,
    id: g.id,
    name: g.name,
    count: list(g.account_id, g.id).length
  }));
}

/** Address-book autocomplete across contacts, people you've emailed, and recent senders. */
export function search(q: string, limit = 8): Contact[] {
  const needle = `%${q.toLowerCase()}%`;
  const rows = all<{ json: string; source: string }>(
    `SELECT json, source FROM contacts WHERE (LOWER(name) LIKE ? OR emails LIKE ?)
     ORDER BY CASE source WHEN 'contacts' THEN 0 WHEN 'directory' THEN 1 ELSE 2 END, name COLLATE NOCASE LIMIT ?`,
    needle, needle, limit * 2
  );
  const out: Contact[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const c = JSON.parse(r.json) as Contact;
    const key = c.emails[0]?.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  if (out.length < limit) {
    // Fill in from people who have emailed you.
    for (const m of all<{ from_name: string | null; from_email: string; account_id: string }>(
      'SELECT from_name, from_email, account_id FROM messages WHERE (LOWER(from_email) LIKE ? OR LOWER(from_name) LIKE ?) GROUP BY LOWER(from_email) ORDER BY MAX(date) DESC LIMIT ?',
      needle, needle, limit
    )) {
      const key = m.from_email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ accountId: m.account_id, id: 'recent:' + key, name: m.from_name ?? m.from_email, emails: [m.from_email], phones: [], groups: [], source: 'other' });
    }
  }
  return out.slice(0, limit);
}

export async function directory(accountId: string, q: string): Promise<Contact[]> {
  if (isDemo(accountId)) return search(q, 20).filter((c) => c.emails[0]?.endsWith('@northfield.example'));
  try {
    const r = await client(accountId).get<{ people?: GPerson[] }>(PEOPLE + '/people:searchDirectoryPeople', {
      query: q,
      readMask: 'names,emailAddresses,phoneNumbers,organizations,photos',
      sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'],
      pageSize: 30
    });
    const out = (r.people ?? []).map((p) => fromPerson(accountId, p, 'directory'));
    tx(() => out.forEach(store));
    return out;
  } catch (e) {
    if (e instanceof GoogleApiError && (e.status === 403 || e.status === 400)) return [];
    throw e;
  }
}

export async function save(c: Contact): Promise<Contact> {
  let saved = c;
  if (isDemo(c.accountId)) {
    saved = { ...c, id: c.id && !c.id.startsWith('recent:') ? c.id : 'people/demo-' + uid(), source: 'contacts' };
  } else if (c.id && c.id.startsWith('people/') && c.source === 'contacts') {
    const p = await client(c.accountId).patch<GPerson>(PEOPLE + `/${c.id}:updateContact`, toPerson(c), {
      updatePersonFields: 'names,emailAddresses,phoneNumbers,organizations,addresses,biographies',
      personFields: FIELDS
    });
    saved = fromPerson(c.accountId, p, 'contacts');
  } else {
    const body = toPerson(c);
    delete (body as Partial<GPerson>).resourceName;
    delete (body as Partial<GPerson>).etag;
    const p = await client(c.accountId).post<GPerson>(PEOPLE + '/people:createContact', body, { personFields: FIELDS });
    saved = fromPerson(c.accountId, p, 'contacts');
  }
  // Group membership changes.
  const before = get<{ json: string }>('SELECT json FROM contacts WHERE account_id = ? AND id = ?', c.accountId, saved.id);
  const prevGroups = before ? (JSON.parse(before.json) as Contact).groups : [];
  if (!isDemo(c.accountId)) {
    for (const g of c.groups.filter((g) => !prevGroups.includes(g))) {
      await client(c.accountId).post(PEOPLE + `/${g}/members:modify`, { resourceNamesToAdd: [saved.id] }).catch(() => undefined);
    }
    for (const g of prevGroups.filter((g) => !c.groups.includes(g))) {
      await client(c.accountId).post(PEOPLE + `/${g}/members:modify`, { resourceNamesToRemove: [saved.id] }).catch(() => undefined);
    }
  }
  saved.groups = c.groups;
  store(saved);
  changed('people', c.accountId);
  return saved;
}

export async function remove(accountId: string, id: string): Promise<void> {
  if (!isDemo(accountId)) await client(accountId).del(PEOPLE + `/${id}:deleteContact`);
  run('DELETE FROM contacts WHERE account_id = ? AND id = ?', accountId, id);
  changed('people', accountId);
}

export async function createGroup(accountId: string, name: string): Promise<ContactGroup> {
  let id = 'contactGroups/demo-' + uid();
  if (!isDemo(accountId)) {
    const g = await client(accountId).post<{ resourceName: string }>(PEOPLE + '/contactGroups', { contactGroup: { name } });
    id = g.resourceName;
  }
  run('INSERT INTO contact_groups (account_id, id, name, count) VALUES (?, ?, ?, 0)', accountId, id, name);
  changed('people', accountId);
  return { accountId, id, name, count: 0 };
}

export async function myPersonId(accountId: string): Promise<string | undefined> {
  if (isDemo(accountId)) return 'users/demo-me';
  try {
    const me = await client(accountId).get<{ resourceName: string }>(PEOPLE + '/people/me', { personFields: 'names' });
    return me.resourceName.replace('people/', 'users/');
  } catch {
    return undefined;
  }
}

export function accountsWithPeople(): string[] {
  return listAccounts().map((a) => a.id);
}
