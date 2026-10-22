// People: Google Contacts, contact groups and the Workspace directory.
import { useEffect, useMemo, useState } from 'react';
import type { Contact, ContactGroup } from '../../shared/types';
import { call, useLive } from '../api';
import { Icon } from '../components/Icon';
import { Rail, Ribbon, StatusBar, TitleBar } from '../components/Shell';
import { Avatar, Empty, Field } from '../components/ui';
import { fail, notify, useApp } from '../state';
import { newMail } from '../mail/actions';
import { openEventEditor } from '../calendar/CalendarView';

type Source = { kind: 'all' } | { kind: 'group'; accountId: string; id: string; name: string } | { kind: 'directory'; accountId: string };

export function PeopleView() {
  const { accounts, search, setSearch } = useApp();
  const [source, setSource] = useState<Source>({ kind: 'all' });
  const [selected, setSelected] = useState<Contact | null>(null);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [dirResults, setDirResults] = useState<Contact[]>([]);
  const [contacts] = useLive(() => (source.kind === 'group' ? call('people.list', source.accountId, source.id) : call('people.list', 'all')), ['people'], [JSON.stringify(source)], [] as Contact[]);
  const [groups] = useLive(() => call('people.groups', 'all'), ['people'], [], [] as ContactGroup[]);

  useEffect(() => {
    const onNew = () => startNew();
    window.addEventListener('dav:new-contact', onNew);
    return () => window.removeEventListener('dav:new-contact', onNew);
  });

  const dirAccount = source.kind === 'directory' ? source.accountId : '';
  const [dirStatus, reloadDirStatus] = useLive(
    () => (dirAccount ? call('people.directoryStatus', dirAccount) : Promise.resolve({ count: 0 } as { count: number; error?: string })),
    ['people'],
    [dirAccount],
    { count: 0 } as { count: number; error?: string }
  );
  const [dirBusy, setDirBusy] = useState(false);
  useEffect(() => {
    if (!dirAccount) return;
    void call('people.directoryList', dirAccount).then(setDirResults).catch(fail);
  }, [dirAccount, dirStatus.count]);
  const downloadDirectory = async () => {
    if (!dirAccount) return;
    setDirBusy(true);
    try {
      const n = await call('people.syncDirectory', dirAccount);
      notify(n ? `Downloaded ${n.toLocaleString()} people from your organisation.` : 'Your organisation directory is up to date.');
      reloadDirStatus();
    } catch (e) {
      fail(e);
    } finally {
      setDirBusy(false);
    }
  };

  const list = useMemo(() => {
    const base = source.kind === 'directory' ? dirResults : contacts;
    const q = search.toLowerCase();
    return q ? base.filter((c) => c.name.toLowerCase().includes(q) || c.emails.some((e) => e.toLowerCase().includes(q)) || (c.company ?? '').toLowerCase().includes(q)) : base;
  }, [contacts, dirResults, search, source.kind]);

  const startNew = () => setEditing({ accountId: accounts[0]?.id ?? '', id: '', name: '', emails: [''], phones: [''], groups: [], source: 'contacts' });

  const letters = useMemo(() => {
    const m = new Map<string, Contact[]>();
    for (const c of list) {
      const l = (c.name[0] ?? '#').toUpperCase();
      const k = /[A-Z]/.test(l) ? l : '#';
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()];
  }, [list]);

  return (
    <>
      <TitleBar placeholder="Search people" onSearch={setSearch} />
      <Ribbon groups={[
        { label: 'New', buttons: [
          { label: 'New contact', icon: 'plus', primary: true, onClick: startNew },
          { label: 'New group', icon: 'people', onClick: async () => {
            const name = window.prompt('Group name');
            if (name && accounts[0]) await call('people.createGroup', accounts[0].id, name).catch(fail);
          } }
        ] },
        { label: 'Communicate', buttons: [
          { label: 'Email', icon: 'mail', disabled: !selected?.emails[0], onClick: () => void newMail(undefined, selected?.emails[0]) },
          { label: 'Meeting', icon: 'calendar', disabled: !selected?.emails[0], onClick: () => {
            const s = new Date();
            s.setMinutes(s.getMinutes() < 30 ? 30 : 60, 0, 0);
            openEventEditor({ draft: { accountId: accounts[0]?.id, calendarId: 'primary', start: s.getTime(), end: s.getTime() + 30 * 60_000, allDay: false, attendees: [{ email: selected!.emails[0], name: selected!.name, response: 'needsAction' }] } });
          } },
          { label: 'Email group', icon: 'people', disabled: source.kind !== 'group' || !list.length, onClick: async () => {
            if (!accounts[0]) return;
            const d = await call('mail.newDraft', accounts[0].id);
            d.bcc = list.filter((c) => c.emails[0]).map((c) => ({ name: c.name, email: c.emails[0] }));
            void call('app.openWindow', 'compose', { draft: JSON.stringify(d) });
          } }
        ] },
        { label: 'Manage', buttons: [
          { label: 'Edit', icon: 'edit', disabled: !selected || selected.source !== 'contacts', onClick: () => selected && setEditing(selected) },
          { label: 'Delete', icon: 'trash', disabled: !selected || selected.source !== 'contacts', onClick: () => {
            if (selected && window.confirm(`Delete ${selected.name} from your Google contacts?`)) void call('people.delete', selected.accountId, selected.id).then(() => setSelected(null)).catch(fail);
          } },
          { label: 'Add to contacts', icon: 'plus', disabled: !selected || selected.source === 'contacts', onClick: () => selected && setEditing({ ...selected, id: '', source: 'contacts', accountId: accounts[0]?.id ?? selected.accountId }) }
        ] }
      ]} />
      <div className="body">
        <Rail />
        <nav className="pane folder-pane" aria-label="Address books">
          <div className="pane-heading">Contacts</div>
          <button className="folder" aria-current={source.kind === 'all'} onClick={() => setSource({ kind: 'all' })}><span className="twisty" /><Icon name="people" size={15} /><span className="name">All contacts</span></button>
          {groups.length > 0 && <div className="pane-heading" style={{ marginTop: 12 }}>Groups</div>}
          {groups.map((g) => (
            <button key={g.accountId + g.id} className="folder" aria-current={source.kind === 'group' && source.id === g.id} onClick={() => setSource({ kind: 'group', accountId: g.accountId, id: g.id, name: g.name })}>
              <span className="twisty" /><Icon name="people" size={15} /><span className="name">{g.name}</span><span className="count items">{g.count}</span>
            </button>
          ))}
          {accounts.some((a) => a.isWorkspace) && <div className="pane-heading" style={{ marginTop: 12 }}>Directory</div>}
          {accounts.filter((a) => a.isWorkspace).map((a) => (
            <button key={a.id} className="folder" aria-current={source.kind === 'directory' && source.accountId === a.id} onClick={() => setSource({ kind: 'directory', accountId: a.id })}>
              <span className="twisty" /><Icon name="building" size={15} /><span className="name">{a.email.split('@')[1]}</span>
            </button>
          ))}
        </nav>
        <section className="people-list" aria-label="People">
          <div className="list-head">
            <span className="title">{source.kind === 'all' ? 'All contacts' : source.kind === 'group' ? source.name : 'Organisation directory'}</span>
            {source.kind === 'directory' && (
              <>
                <span className="spacer" />
                <button className="ghost" onClick={downloadDirectory} disabled={dirBusy} title="Download the whole directory again">
                  <Icon name="sync" size={14} /> {dirBusy ? 'Downloading…' : 'Refresh'}
                </button>
              </>
            )}
          </div>
          <div className="list-scroll">
            {letters.map(([l, cs]) => (
              <div key={l}>
                <div className="group-label">{l}</div>
                {cs.map((c) => (
                  <button key={c.accountId + c.id} className="person" aria-selected={selected?.id === c.id && selected.accountId === c.accountId} onClick={() => { setSelected(c); setEditing(null); }}>
                    <Avatar name={c.name} email={c.emails[0]} size={34} photo={c.photoUrl} />
                    <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{c.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[c.title, c.company].filter(Boolean).join(', ') || c.emails[0]}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {!list.length && source.kind === 'directory' && !search && (
              <Empty icon="building" title={dirStatus.error ? "Your organisation's directory isn't available" : 'Directory not downloaded yet'} text={dirStatus.error ? 'Your Google Workspace admin may have turned off directory sharing (Admin console › Directory › Directory settings › Sharing settings › Contact sharing).' : 'Davenport downloads everyone in your organisation so you can browse and address them offline.'}>
                <button className="btn primary" onClick={downloadDirectory} disabled={dirBusy}>{dirBusy ? 'Downloading…' : 'Download directory now'}</button>
              </Empty>
            )}
            {!list.length && (source.kind !== 'directory' || search) && <Empty icon="people" title={search ? 'No matches' : 'No contacts'} />}
          </div>
        </section>
        <div className="detail">
          {editing ? <ContactEditor c={editing} groups={groups} onDone={(saved) => { setEditing(null); if (saved) setSelected(saved); }} /> : selected ? <ContactCard c={selected} groups={groups} /> : <Empty icon="person" title="Select a person" />}
        </div>
      </div>
      <StatusBar left={<span>{list.length.toLocaleString()} people{source.kind === 'directory' && dirStatus.count ? ' in your organisation' : ''}</span>} />
    </>
  );
}

function ContactCard({ c, groups }: { c: Contact; groups: ContactGroup[] }) {
  return (
    <>
      <div className="card-head">
        <Avatar name={c.name} email={c.emails[0]} size={72} photo={c.photoUrl} />
        <div>
          <h1>{c.name}</h1>
          <div style={{ color: 'var(--muted)' }}>{[c.title, c.company].filter(Boolean).join(' · ')}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            {c.emails[0] && <button className="btn" onClick={() => void newMail(undefined, c.emails[0])}><Icon name="mail" /> Email</button>}
            {c.phones[0] && <button className="btn" onClick={() => call('app.openExternal', 'tel:' + c.phones[0])}><Icon name="phone" /> Call</button>}
          </div>
        </div>
      </div>
      <dl className="kv">
        {c.emails.map((e, i) => (<><dt key={'e' + i}>{i ? '' : 'Email'}</dt><dd key={'ed' + i}><a href="#" onClick={(ev) => { ev.preventDefault(); void newMail(undefined, e); }}>{e}</a></dd></>))}
        {c.phones.map((p, i) => (<><dt key={'p' + i}>{i ? '' : 'Phone'}</dt><dd key={'pd' + i}>{p}</dd></>))}
        {c.address && <><dt>Address</dt><dd>{c.address}</dd></>}
        {c.groups.length > 0 && <><dt>Groups</dt><dd>{c.groups.map((g) => groups.find((x) => x.id === g)?.name ?? '').filter(Boolean).join(', ')}</dd></>}
        {c.notes && <><dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</dd></>}
        <dt>Source</dt><dd>{c.source === 'directory' ? 'Organisation directory' : c.source === 'other' ? 'People you have emailed' : 'Google Contacts'}</dd>
      </dl>
    </>
  );
}

function ContactEditor({ c, groups, onDone }: { c: Contact; groups: ContactGroup[]; onDone: (saved?: Contact) => void }) {
  const { accounts } = useApp();
  const [x, setX] = useState<Contact>({ ...c, givenName: c.givenName ?? c.name.split(' ')[0], familyName: c.familyName ?? c.name.split(' ').slice(1).join(' ') });
  const set = (p: Partial<Contact>) => setX({ ...x, ...p });
  const save = async () => {
    const name = `${x.givenName ?? ''} ${x.familyName ?? ''}`.trim();
    if (!name && !x.emails.filter(Boolean).length) return notify('Add a name or an email address.', 'error');
    try {
      const saved = await call('people.save', { ...x, name: name || x.emails[0], emails: x.emails.filter(Boolean), phones: x.phones.filter(Boolean) });
      notify('Contact saved.');
      onDone(saved);
    } catch (e) {
      fail(e);
    }
  };
  return (
    <div style={{ maxWidth: 640 }}>
      <h2 style={{ marginTop: 0 }}>{c.id ? 'Edit contact' : 'New contact'}</h2>
      {!c.id && accounts.length > 1 && (
        <Field label="Save to">
          <select className="input" value={x.accountId} onChange={(e) => set({ accountId: e.target.value })}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
          </select>
        </Field>
      )}
      <div className="row-2">
        <Field label="First name"><input className="input" value={x.givenName ?? ''} onChange={(e) => set({ givenName: e.target.value })} autoFocus /></Field>
        <Field label="Last name"><input className="input" value={x.familyName ?? ''} onChange={(e) => set({ familyName: e.target.value })} /></Field>
      </div>
      <div className="row-2">
        <Field label="Company"><input className="input" value={x.company ?? ''} onChange={(e) => set({ company: e.target.value })} /></Field>
        <Field label="Job title"><input className="input" value={x.title ?? ''} onChange={(e) => set({ title: e.target.value })} /></Field>
      </div>
      {x.emails.map((e, i) => (
        <Field key={'e' + i} label={i ? 'Another email' : 'Email'}>
          <input className="input" type="email" value={e} onChange={(ev) => set({ emails: x.emails.map((v, j) => (j === i ? ev.target.value : v)) })} />
        </Field>
      ))}
      <button className="btn small" style={{ marginBottom: 12 }} onClick={() => set({ emails: [...x.emails, ''] })}><Icon name="plus" /> Add email</button>
      {x.phones.map((p, i) => (
        <Field key={'p' + i} label={i ? 'Another phone' : 'Phone'}>
          <input className="input" type="tel" value={p} onChange={(ev) => set({ phones: x.phones.map((v, j) => (j === i ? ev.target.value : v)) })} />
        </Field>
      ))}
      <button className="btn small" style={{ marginBottom: 12 }} onClick={() => set({ phones: [...x.phones, ''] })}><Icon name="plus" /> Add phone</button>
      <Field label="Address"><input className="input" value={x.address ?? ''} onChange={(e) => set({ address: e.target.value })} /></Field>
      {groups.filter((g) => g.accountId === x.accountId).length > 0 && (
        <div className="field">
          <span>Groups</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {groups.filter((g) => g.accountId === x.accountId).map((g) => (
              <label key={g.id} className="check"><input type="checkbox" checked={x.groups.includes(g.id)} onChange={(e) => set({ groups: e.target.checked ? [...x.groups, g.id] : x.groups.filter((y) => y !== g.id) })} /> {g.name}</label>
            ))}
          </div>
        </div>
      )}
      <Field label="Notes"><textarea className="input" value={x.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" onClick={save}>Save</button>
        <button className="btn" onClick={() => onDone()}>Cancel</button>
      </div>
    </div>
  );
}
