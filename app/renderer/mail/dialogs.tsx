// Mail dialogs: Move to folder, folders, rules, Quick Steps, templates, Search Folders, automatic replies, signatures.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Folder, QuickAction, QuickStep, Rule, SearchFolder, SendAs, Template, Vacation } from '../../shared/types';
import { call, useLive } from '../api';
import { Icon } from '../components/Icon';
import { RichEditor, type RichEditorHandle } from '../components/RichEditor';
import { Dialog, Field } from '../components/ui';
import { fail, notify, useApp } from '../state';
import { fromLocalInput, toLocalInput } from '../util';
import type { Sel } from './actions';
import { snooze } from './actions';

function useFolders(accountId: string | undefined): Folder[] {
  const [f] = useLive(() => (accountId ? call('mail.folders', accountId) : Promise.resolve([])), ['folders'], [accountId], [] as Folder[]);
  return f;
}

function AccountPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { accounts } = useApp();
  if (accounts.length < 2) return null;
  return (
    <Field label="Account">
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
      </select>
    </Field>
  );
}

export function MoveDialog({ arg, onClose }: { arg: { mode: 'move' | 'label' | 'snoozeAt'; sel: Sel }; onClose: () => void }) {
  const accountId = arg.sel[0]?.accountId;
  const folders = useFolders(accountId);
  const [q, setQ] = useState('');
  const [when, setWhen] = useState(() => toLocalInput(Date.now() + 3 * 3600_000));
  const ref = useRef<HTMLInputElement>(null);
  const list = folders.filter((f) => !['SCHEDULED', 'SNOOZED', 'DRAFT', 'SENT', 'STARRED'].includes(f.id) && (arg.mode === 'move' || f.type === 'user')).filter((f) => f.path.toLowerCase().includes(q.toLowerCase()));

  if (arg.mode === 'snoozeAt') {
    return (
      <Dialog title="Snooze until" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => { void snooze(arg.sel, fromLocalInput(when)); onClose(); }}>Snooze</button></>}>
        <Field label="Date and time"><input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <p className="hint-text">The message leaves your inbox and comes back, marked unread, at this time. Davenport needs to be running (it can sit in the notification area).</p>
      </Dialog>
    );
  }

  const act = (f: Folder) => {
    const by = new Map<string, string[]>();
    for (const s of arg.sel) by.set(s.accountId, [...(by.get(s.accountId) ?? []), s.id]);
    const from = useApp.getState().mail.folder;
    const fromId = from.type === 'label' ? from.id : 'INBOX';
    for (const [a, ids] of by) {
      (arg.mode === 'move' ? call('mail.move', a, ids, f.id, fromId) : call('mail.label', a, ids, [f.id], [])).catch(fail);
    }
    notify(`${arg.sel.length === 1 ? 'Message' : arg.sel.length + ' messages'} ${arg.mode === 'move' ? 'moved to' : 'labelled'} ${f.path}.`);
    onClose();
  };

  return (
    <Dialog title={arg.mode === 'move' ? 'Move to folder' : 'Add label'} onClose={onClose} footer={<button className="btn" onClick={onClose}>Cancel</button>}>
      <input ref={ref} className="input" placeholder="Search folders" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) act(list[0]); }} autoFocus />
      <div className="list-box" style={{ marginTop: 10, maxHeight: 340, overflow: 'auto' }}>
        {list.map((f) => (
          <button key={f.id} className="menu-item" onClick={() => act(f)} style={{ paddingLeft: 10 + (f.path.split('/').length - 1) * 14 }}>
            {f.isCategory ? <span className="dot" style={{ background: f.color }} /> : <Icon name="folder" />}
            {f.type === 'user' ? f.path : f.name}
          </button>
        ))}
        {q && !folders.some((f) => f.path.toLowerCase() === q.toLowerCase()) && accountId && (
          <button className="menu-item" onClick={async () => {
            try {
              const f = await call('mail.createFolder', accountId, q);
              act(f);
            } catch (e) {
              fail(e);
            }
          }}>
            <Icon name="folderPlus" /> Create folder “{q}”
          </button>
        )}
      </div>
    </Dialog>
  );
}

export function NewFolderDialog({ arg, onClose }: { arg: { accountId: string; parent?: string; rename?: Folder }; onClose: () => void }) {
  const [accountId, setAccountId] = useState(arg.accountId);
  const folders = useFolders(accountId);
  const [name, setName] = useState(arg.rename?.name ?? '');
  const [parent, setParent] = useState(arg.rename ? arg.rename.path.split('/').slice(0, -1).join('/') : arg.parent ?? '');
  const submit = async () => {
    if (!name.trim()) return;
    const path = (parent ? parent + '/' : '') + name.trim();
    try {
      if (arg.rename) await call('mail.renameFolder', accountId, arg.rename.id, path);
      else await call('mail.createFolder', accountId, path);
      onClose();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <Dialog title={arg.rename ? 'Rename folder' : 'New folder'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={submit}>{arg.rename ? 'Rename' : 'Create'}</button></>}>
      {!arg.rename && <AccountPicker value={accountId} onChange={setAccountId} />}
      <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} autoFocus /></Field>
      <Field label="Inside">
        <select className="input" value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">(Top level)</option>
          {folders.filter((f) => f.type === 'user' && f.id !== arg.rename?.id).map((f) => <option key={f.id} value={f.path}>{f.path}</option>)}
        </select>
      </Field>
      <p className="hint-text">Folders are Gmail labels, so they appear in Gmail on the web and your phone too.</p>
    </Dialog>
  );
}

// ---------- Rules ----------

const emptyRule = (accountId: string): Rule => ({ id: '', accountId, name: '', enabled: true, conditions: {}, actions: {}, where: 'server' });

export function RulesDialog({ arg, onClose }: { arg?: { from?: string; subject?: string; accountId?: string }; onClose: () => void }) {
  const { accounts } = useApp();
  const [accountId, setAccountId] = useState(arg?.accountId ?? accounts[0]?.id ?? '');
  const [listError, setListError] = useState<string | null>(null);
  const [rules, reload, loadingRules] = useLive(
    () =>
      accountId
        ? call('rules.list', accountId).then(
            (r) => (setListError(null), r),
            (e) => {
              setListError((e as Error).message);
              throw e;
            }
          )
        : Promise.resolve([] as Rule[]),
    ['rules'],
    [accountId],
    [] as Rule[]
  );
  const [edit, setEdit] = useState<Rule | null>(arg?.from ? { ...emptyRule(accountId), name: `Mail from ${arg.from}`, conditions: { from: arg.from } } : null);
  const folders = useFolders(accountId);

  if (edit) {
    const c = edit.conditions;
    const a = edit.actions;
    const setC = (p: Partial<Rule['conditions']>) => setEdit({ ...edit, conditions: { ...c, ...p } });
    const setA = (p: Partial<Rule['actions']>) => setEdit({ ...edit, actions: { ...a, ...p } });
    const save = async () => {
      if (!Object.values(c).some(Boolean)) return notify('Add at least one condition.', 'error');
      if (!Object.values(a).some(Boolean)) return notify('Add at least one action.', 'error');
      try {
        await call('rules.save', { ...edit, accountId, name: edit.name || 'Rule' });
        notify(edit.where === 'server' ? 'Rule saved as a Gmail filter and applied to your inbox.' : 'Rule saved.');
        setEdit(null);
        reload();
      } catch (e) {
        fail(e);
      }
    };
    return (
      <Dialog title={edit.id ? 'Edit rule' : 'New rule'} wide onClose={onClose} footer={<><button className="btn" onClick={() => setEdit(null)}>Back</button><button className="btn primary" onClick={save}>Save rule</button></>}>
        <Field label="Name"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        <div className="row-2">
          <div>
            <h3 style={{ fontSize: 14, margin: '4px 0 8px' }}>When a message arrives that…</h3>
            <Field label="Is from"><input className="input" placeholder="name@example.com" value={c.from ?? ''} onChange={(e) => setC({ from: e.target.value })} /></Field>
            <Field label="Is sent to"><input className="input" value={c.to ?? ''} onChange={(e) => setC({ to: e.target.value })} /></Field>
            <Field label="Subject includes"><input className="input" value={c.subject ?? ''} onChange={(e) => setC({ subject: e.target.value })} /></Field>
            <Field label="Has the words"><input className="input" value={c.hasWords ?? ''} onChange={(e) => setC({ hasWords: e.target.value })} /></Field>
            <label className="check"><input type="checkbox" checked={!!c.hasAttachment} onChange={(e) => setC({ hasAttachment: e.target.checked })} /> Has an attachment</label>
          </div>
          <div>
            <h3 style={{ fontSize: 14, margin: '4px 0 8px' }}>Do the following</h3>
            <Field label="Move to folder">
              <select className="input" value={a.addLabelId ?? ''} onChange={(e) => setA({ addLabelId: e.target.value || undefined, archive: !!e.target.value || a.archive })}>
                <option value="">(Don't move)</option>
                {folders.filter((f) => f.type === 'user').map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
              </select>
            </Field>
            <label className="check"><input type="checkbox" checked={!!a.archive} onChange={(e) => setA({ archive: e.target.checked })} /> Skip the inbox</label>
            <label className="check"><input type="checkbox" checked={!!a.markRead} onChange={(e) => setA({ markRead: e.target.checked })} /> Mark as read</label>
            <label className="check"><input type="checkbox" checked={!!a.flag} onChange={(e) => setA({ flag: e.target.checked })} /> Flag it</label>
            <label className="check"><input type="checkbox" checked={!!a.markImportant} onChange={(e) => setA({ markImportant: e.target.checked })} /> Mark as important</label>
            <label className="check"><input type="checkbox" checked={!!a.neverSpam} onChange={(e) => setA({ neverSpam: e.target.checked })} /> Never send to Spam</label>
            <label className="check"><input type="checkbox" checked={!!a.trash} onChange={(e) => setA({ trash: e.target.checked })} /> Delete it</label>
            <Field label="Forward to" hint="Gmail asks you to confirm a new forwarding address by email first.">
              <input className="input" value={a.forwardTo ?? ''} onChange={(e) => setA({ forwardTo: e.target.value || undefined })} disabled={edit.where === 'local'} />
            </Field>
          </div>
        </div>
        <Field label="Where it runs">
          <select className="input" value={edit.where} onChange={(e) => setEdit({ ...edit, where: e.target.value as Rule['where'] })}>
            <option value="server">On Gmail's servers (recommended — works even when Davenport is closed)</option>
            <option value="local">In Davenport only</option>
          </select>
        </Field>
      </Dialog>
    );
  }

  return (
    <Dialog title="Rules" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => setEdit(emptyRule(accountId))}><Icon name="plus" /> New rule</button></>}>
      <AccountPicker value={accountId} onChange={setAccountId} />
      <p className="hint-text">Rules run on Gmail's servers as filters, so they keep working on your phone and when Davenport is closed. Existing Gmail filters appear here too.</p>
      <div className="list-box">
        {rules.map((r) => (
          <div key={r.id} className="item">
            <Icon name="rules" />
            <div className="grow">
              <div>{r.name}</div>
              <div className="sub">{describeRule(r, [])} · {r.where === 'server' ? 'Gmail filter' : 'Davenport only'}</div>
            </div>
            <button className="btn small" onClick={() => setEdit(r)}>Edit</button>
            <button className="btn small danger" onClick={() => window.confirm('Delete this rule?') && call('rules.delete', accountId, r.id).then(reload).catch(fail)}>Delete</button>
          </div>
        ))}
        {!rules.length && (
          <div className="item">
            <span className="sub">{loadingRules ? 'Loading rules…' : listError ? listError : 'No rules yet.'}</span>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function describeRule(r: Rule, _f: Folder[]): string {
  const a = r.actions;
  const parts = [a.archive && 'skip inbox', a.addLabelId && 'move to folder', a.markRead && 'mark read', a.flag && 'flag', a.trash && 'delete', a.forwardTo && `forward to ${a.forwardTo}`, a.neverSpam && 'never spam', a.markImportant && 'important'].filter(Boolean);
  return parts.join(', ') || 'No actions';
}

// ---------- Quick Steps ----------

const ACTION_LABELS: Record<QuickAction['type'], string> = {
  move: 'Move to folder', label: 'Add label', markRead: 'Mark as read', markUnread: 'Mark as unread', flag: 'Flag', clearFlag: 'Clear flag',
  archive: 'Archive', trash: 'Delete', reply: 'Reply (with template)', forward: 'Forward to', task: 'Create a task'
};

export function QuickStepsDialog({ arg, onClose }: { arg?: unknown; onClose: () => void }) {
  const { accounts } = useApp();
  const [steps, reload] = useLive(() => call('quicksteps.list'), ['settings'], [], [] as QuickStep[]);
  const [edit, setEdit] = useState<QuickStep | null>(arg === 'new' ? { id: '', accountId: accounts[0]?.id ?? '', name: '', actions: [{ type: 'markRead' }] } : null);
  const folders = useFolders(edit?.accountId);
  const [templates] = useLive(() => call('templates.list'), ['settings'], [], [] as Template[]);

  if (edit) {
    const setAction = (i: number, a: QuickAction) => setEdit({ ...edit, actions: edit.actions.map((x, j) => (j === i ? a : x)) });
    return (
      <Dialog title={edit.id ? 'Edit Quick Step' : 'New Quick Step'} onClose={onClose} footer={<><button className="btn" onClick={() => setEdit(null)}>Back</button><button className="btn primary" onClick={async () => {
        if (!edit.name.trim()) return notify('Give it a name.', 'error');
        await call('quicksteps.save', edit).catch(fail);
        setEdit(null);
        reload();
      }}>Save</button></>}>
        <Field label="Name"><input className="input" placeholder="e.g. File to Clients/Acme" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        <AccountPicker value={edit.accountId} onChange={(id) => setEdit({ ...edit, accountId: id })} />
        <div className="field-label" style={{ marginBottom: 6 }}>Actions, in order</div>
        {edit.actions.map((a, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <select className="input" value={a.type} onChange={(e) => {
              const t = e.target.value as QuickAction['type'];
              setAction(i, t === 'move' || t === 'label' ? { type: t, labelId: '' } : t === 'forward' ? { type: t, to: '' } : t === 'reply' ? { type: t } : ({ type: t } as QuickAction));
            }}>
              {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {(a.type === 'move' || a.type === 'label') && (
              <select className="input" value={a.labelId} onChange={(e) => setAction(i, { ...a, labelId: e.target.value })}>
                <option value="">Choose a folder…</option>
                {folders.filter((f) => f.type === 'user' || f.id === 'INBOX').map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
              </select>
            )}
            {a.type === 'forward' && <input className="input" placeholder="name@example.com" value={a.to} onChange={(e) => setAction(i, { ...a, to: e.target.value })} />}
            {a.type === 'reply' && (
              <select className="input" value={a.templateId ?? ''} onChange={(e) => setAction(i, { ...a, templateId: e.target.value || undefined })}>
                <option value="">Open a reply to edit</option>
                {templates.map((t) => <option key={t.id} value={t.id}>Send template: {t.name}</option>)}
              </select>
            )}
            <button className="icon-btn" aria-label="Remove action" onClick={() => setEdit({ ...edit, actions: edit.actions.filter((_, j) => j !== i) })}><Icon name="close" /></button>
          </div>
        ))}
        <button className="btn small" onClick={() => setEdit({ ...edit, actions: [...edit.actions, { type: 'archive' }] })}><Icon name="plus" /> Add action</button>
      </Dialog>
    );
  }
  return (
    <Dialog title="Quick Steps" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => setEdit({ id: '', accountId: accounts[0]?.id ?? '', name: '', actions: [{ type: 'markRead' }] })}><Icon name="plus" /> New Quick Step</button></>}>
      <p className="hint-text">Quick Steps do several things to a message in one click — for example, reply with a template and file it away.</p>
      <div className="list-box">
        {steps.map((s) => (
          <div key={s.id} className="item">
            <span style={{ color: 'var(--brass)' }}><Icon name="bolt" /></span>
            <div className="grow"><div>{s.name}</div><div className="sub">{s.actions.map((a) => ACTION_LABELS[a.type]).join(' → ')}</div></div>
            <button className="btn small" onClick={() => setEdit(s)}>Edit</button>
            <button className="btn small danger" onClick={() => call('quicksteps.delete', s.id).then(reload)}>Delete</button>
          </div>
        ))}
        {!steps.length && <div className="item"><span className="sub">No Quick Steps yet.</span></div>}
      </div>
    </Dialog>
  );
}

// ---------- Templates ----------

export function TemplatesDialog({ onClose }: { onClose: () => void }) {
  const [list, reload] = useLive(() => call('templates.list'), ['settings'], [], [] as Template[]);
  const [edit, setEdit] = useState<Template | null>(null);
  const editor = useRef<RichEditorHandle>(null);
  if (edit) {
    return (
      <Dialog title={edit.id ? 'Edit template' : 'New template'} wide onClose={onClose} footer={<><button className="btn" onClick={() => setEdit(null)}>Back</button><button className="btn primary" onClick={async () => {
        await call('templates.save', { ...edit, html: editor.current?.getHtml() ?? edit.html }).catch(fail);
        setEdit(null);
        reload();
      }}>Save</button></>}>
        <Field label="Name"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
        <Field label="Subject (optional)"><input className="input" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></Field>
        <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <RichEditor ref={editor} initialHtml={edit.html} onChange={() => undefined} minHeight={200} label="Template body" />
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog title="My Templates" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => setEdit({ id: '', name: '', subject: '', html: '<p></p>' })}><Icon name="plus" /> New template</button></>}>
      <div className="list-box">
        {list.map((t) => (
          <div key={t.id} className="item">
            <Icon name="template" />
            <div className="grow"><div>{t.name}</div><div className="sub">{t.subject || 'No subject'}</div></div>
            <button className="btn small" onClick={() => setEdit(t)}>Edit</button>
            <button className="btn small danger" onClick={() => call('templates.delete', t.id).then(reload)}>Delete</button>
          </div>
        ))}
        {!list.length && <div className="item"><span className="sub">No templates yet. Templates you save here can be inserted from any new message.</span></div>}
      </div>
    </Dialog>
  );
}

// ---------- Search Folders ----------

export function SearchFolderDialog({ arg, onClose }: { arg?: SearchFolder; onClose: () => void }) {
  const [f, setF] = useState<SearchFolder>(arg ?? { id: '', accountId: 'all', name: '', query: '' });
  const { accounts } = useApp();
  const presets: [string, string][] = [
    ['Unread mail', 'is:unread'], ['Flagged', 'is:flagged'], ['Has attachments', 'has:attachment'], ['Large mail (over 5 MB)', 'larger:5M'], ['Last 7 days', 'newer_than:7d']
  ];
  return (
    <Dialog title={arg ? 'Edit Search Folder' : 'New Search Folder'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={async () => {
      if (!f.name.trim() || !f.query.trim()) return notify('Add a name and a search.', 'error');
      await call('searchFolders.save', f).catch(fail);
      onClose();
    }}>Save</button></>}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {presets.map(([n, q]) => <button key={n} className="btn small" onClick={() => setF({ ...f, name: f.name || n, query: q })}>{n}</button>)}
      </div>
      <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Search" hint="Uses Gmail search words: from:, to:, subject:, has:attachment, is:unread, is:flagged, larger:5M, newer_than:7d, label:name, before:2026/01/01">
        <input className="input" value={f.query} onChange={(e) => setF({ ...f, query: e.target.value })} />
      </Field>
      <Field label="Accounts">
        <select className="input" value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
          <option value="all">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
        </select>
      </Field>
    </Dialog>
  );
}

// ---------- Automatic replies ----------

export function OutOfOfficeDialog({ onClose }: { onClose: () => void }) {
  const { accounts } = useApp();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [v, setV] = useState<Vacation | null>(null);
  const editor = useRef<RichEditorHandle>(null);
  useEffect(() => {
    setV(null);
    if (accountId) call('gmail.vacation', accountId).then(setV).catch(fail);
  }, [accountId]);
  return (
    <Dialog title="Automatic replies" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!v} onClick={async () => {
      if (!v) return;
      await call('gmail.setVacation', accountId, { ...v, html: editor.current?.getHtml() ?? v.html }).then(onClose).catch(fail);
    }}>Save</button></>}>
      <AccountPicker value={accountId} onChange={setAccountId} />
      {!v ? <p>Loading…</p> : (
        <>
          <label className="check"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /> <b>Send automatic replies</b></label>
          <div className="row-2" style={{ marginTop: 8 }}>
            <Field label="Start (optional)"><input type="datetime-local" className="input" value={v.startTime ? toLocalInput(v.startTime) : ''} onChange={(e) => setV({ ...v, startTime: e.target.value ? fromLocalInput(e.target.value) : undefined, blockCalendar: v.blockCalendar ?? true })} /></Field>
            <Field label="End (optional)"><input type="datetime-local" className="input" value={v.endTime ? toLocalInput(v.endTime) : ''} onChange={(e) => setV({ ...v, endTime: e.target.value ? fromLocalInput(e.target.value) : undefined, blockCalendar: v.blockCalendar ?? true })} /></Field>
          </div>
          <Field label="Subject"><input className="input" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} placeholder="Out of office" /></Field>
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 10 }}>
            <RichEditor key={accountId} ref={editor} initialHtml={v.html || '<p>Thank you for your email. I am out of the office and will reply when I return.</p>'} onChange={() => undefined} minHeight={140} label="Automatic reply" />
          </div>
          <label className="check"><input type="checkbox" checked={v.restrictToContacts} onChange={(e) => setV({ ...v, restrictToContacts: e.target.checked })} /> Only reply to people in my contacts</label>
          <label className="check"><input type="checkbox" checked={v.restrictToDomain} onChange={(e) => setV({ ...v, restrictToDomain: e.target.checked })} /> Only reply to people in my organisation</label>
          <label className="check" style={{ marginTop: 10 }}>
            <input type="checkbox" disabled={!v.enabled || !v.startTime || !v.endTime} checked={!!v.blockCalendar && !!v.startTime && !!v.endTime} onChange={(e) => setV({ ...v, blockCalendar: e.target.checked })} />
            <span><b>Also show me as out of office in Calendar</b> and decline new meetings during this time</span>
          </label>
          {(!v.startTime || !v.endTime) && <p className="hint-text" style={{ margin: '2px 0 0 24px' }}>Set a start and end time to block your calendar too.</p>}
          <p className="hint-text" style={{ marginTop: 12 }}>These are Gmail's automatic replies (the vacation responder), so they work on the web and your phone too, even when Davenport is closed.</p>
        </>
      )}
    </Dialog>
  );
}

// ---------- Signatures ----------

export function SignatureDialog({ onClose }: { onClose: () => void }) {
  const { accounts } = useApp();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [list, setList] = useState<SendAs[]>([]);
  const [email, setEmail] = useState('');
  const editor = useRef<RichEditorHandle>(null);
  useEffect(() => {
    call('gmail.sendAs', accountId).then((l) => {
      setList(l);
      setEmail(l.find((s) => s.isDefault)?.email ?? l[0]?.email ?? '');
    }).catch(fail);
  }, [accountId]);
  const current = useMemo(() => list.find((s) => s.email === email), [list, email]);
  return (
    <Dialog title="Signatures" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={async () => {
      await call('gmail.setSignature', accountId, email, editor.current?.getHtml() ?? '').then(() => { notify('Signature saved to Gmail.'); onClose(); }).catch(fail);
    }}>Save</button></>}>
      <AccountPicker value={accountId} onChange={setAccountId} />
      {list.length > 1 && (
        <Field label="Address">
          <select className="input" value={email} onChange={(e) => setEmail(e.target.value)}>
            {list.map((s) => <option key={s.email} value={s.email}>{s.email}</option>)}
          </select>
        </Field>
      )}
      <p className="hint-text">Signatures are stored in Gmail, so the same one appears on the web and your phone. New messages get it automatically.</p>
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {current && <RichEditor key={accountId + email} ref={editor} initialHtml={current.signature} onChange={() => undefined} minHeight={160} label="Signature" />}
      </div>
    </Dialog>
  );
}
