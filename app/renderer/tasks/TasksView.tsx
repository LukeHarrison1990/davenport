// Tasks: Google Tasks lists, My Day, and tasks created from flagged email.
import { useState } from 'react';
import type { Task, TaskList } from '../../shared/types';
import { call, useLive } from '../api';
import { Icon } from '../components/Icon';
import { contextMenu, copyText } from '../components/contextMenu';
import type { MenuEntry } from '../components/Menu';
import { Splitter, usePaneSize } from '../components/Splitter';
import { Rail, Ribbon, StatusBar, TitleBar } from '../components/Shell';
import { Empty, Field } from '../components/ui';
import { fail, notify, useApp } from '../state';
import { addDays, cx, fromLocalInput, startOfDay, toLocalInput } from '../util';

type Sel = { kind: 'myday' } | { kind: 'list'; list: TaskList };

export function TasksView() {
  const { accounts, setModule, openFolder, select, search, setSearch, syncProgress } = useApp();
  const [lists] = useLive(() => call('tasks.lists'), ['tasks'], [], [] as TaskList[]);
  const [sel, setSel] = useState<Sel>({ kind: 'myday' });
  const [showDone, setShowDone] = useState(false);
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState<Task | null>(null);
  const [paneWidth, setPaneWidth, savePaneWidth] = usePaneSize('dav.folderWidth', 240);
  const [panelWidth, setPanelWidth, savePanelWidth] = usePaneSize('dav.tasks.panelWidth', 340);
  const [tasks] = useLive(
    () => (sel.kind === 'myday' ? call('tasks.myDay') : call('tasks.list', sel.list.accountId, sel.list.id, true)),
    ['tasks', 'mail'],
    [JSON.stringify(sel)],
    [] as Task[]
  );
  const today = startOfDay(Date.now());
  const q = search.toLowerCase();
  const shown = q ? tasks.filter((t) => t.title.toLowerCase().includes(q) || (t.notes ?? '').toLowerCase().includes(q)) : tasks;
  const open = shown.filter((t) => !t.completed);
  const done = shown.filter((t) => t.completed);

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    const list = sel.kind === 'list' ? sel.list : lists[0];
    if (!list) return;
    await call('tasks.save', { accountId: list.accountId, listId: list.id, id: '', title: t, completed: false, due: sel.kind === 'myday' ? today : undefined }).catch(fail);
    setTitle('');
  };

  const openEmail = (t: Task) => {
    if (!t.linkedMessage) return;
    setModule('mail');
    openFolder({ accountId: t.accountId, folder: { type: 'label', id: 'STARRED' }, folderName: 'Flagged' });
    select([{ accountId: t.accountId, id: t.linkedMessage.messageId, threadId: t.linkedMessage.messageId }]);
  };
  const saveTask = (t: Task, said: string) => void call('tasks.save', t).then(() => notify(said)).catch(fail);

  /** Outlook's task menu: complete, open, due date, copy, delete. */
  const taskMenu = (t: Task): MenuEntry[] => {
    const nextMonday = startOfDay(addDays(today, ((8 - new Date(today).getDay()) % 7) || 7));
    const due = (d: number | undefined, said: string): MenuEntry => ({ label: said, checked: d !== undefined && t.due !== undefined && startOfDay(t.due) === d, onClick: () => saveTask({ ...t, due: d }, d === undefined ? 'Due date removed' : `Due ${said.toLowerCase()}`) });
    return [
      { label: t.completed ? 'Mark as not complete' : 'Mark complete', icon: 'check', onClick: () => saveTask({ ...t, completed: !t.completed }, t.completed ? 'Marked as not complete' : 'Completed') },
      { label: 'Open', icon: 'edit', onClick: () => setEditing(t) },
      { sep: true },
      { label: 'Due', icon: 'flag', submenu: [
        due(today, 'Today'),
        due(addDays(today, 1), 'Tomorrow'),
        due(nextMonday, 'Next week'),
        { sep: true },
        { label: 'Choose a date…', onClick: () => setEditing(t) },
        { label: 'No due date', disabled: t.due === undefined, onClick: () => saveTask({ ...t, due: undefined }, 'Due date removed') }
      ] },
      ...(t.linkedMessage ? [{ label: 'Open flagged email', icon: 'mail', onClick: () => openEmail(t) } as MenuEntry] : []),
      { label: 'Copy', icon: 'copy', onClick: () => copyText([t.title, t.notes].filter(Boolean).join('\n'), 'Task') },
      { sep: true },
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => void call('tasks.delete', t.accountId, t.listId, t.id).then(() => { if (editing?.id === t.id) setEditing(null); }).catch(fail) }
    ];
  };

  const row = (t: Task) => {
    const overdue = !t.completed && t.due !== undefined && t.due < today;
    return (
      <div key={t.accountId + t.id} className={cx('task-item', t.completed && 'done')} onContextMenu={contextMenu(() => taskMenu(t))}>
        <input type="checkbox" checked={t.completed} aria-label={`Complete ${t.title}`} onChange={(e) => call('tasks.save', { ...t, completed: e.target.checked }).catch(fail)} />
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setEditing(t)}>
          <div className="t">{t.title || '(untitled)'}</div>
          <div className="n">
            {t.due && <span style={{ color: overdue ? 'var(--danger)' : undefined }}>{startOfDay(t.due) === today ? 'Today' : overdue ? 'Overdue · ' + new Date(t.due).toLocaleDateString() : new Date(t.due).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>}
            {t.linkedMessage && <> · <a href="#" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openEmail(t); }}>Open flagged email</a></>}
          </div>
        </div>
        <button className="icon-btn" aria-label="Delete task" onClick={() => call('tasks.delete', t.accountId, t.listId, t.id).catch(fail)}><Icon name="trash" size={15} /></button>
      </div>
    );
  };

  return (
    <>
      <TitleBar placeholder="Search tasks" onSearch={setSearch} />
      <Ribbon groups={[
        { label: 'New', buttons: [
          { label: 'New task', icon: 'plus', primary: true, onClick: () => document.getElementById('task-new')?.focus() },
          { label: 'New list', icon: 'list', onClick: async () => {
            const name = window.prompt('List name');
            if (name && accounts[0]) await call('tasks.createList', accounts[0].id, name).catch(fail);
          } }
        ] },
        { label: 'View', buttons: [
          { label: showDone ? 'Hide completed' : 'Show completed', icon: 'check', onClick: () => setShowDone(!showDone) },
          { label: 'Refresh', icon: 'sync', spin: syncProgress.active, onClick: () => call('sync.now') }
        ] }
      ]} />
      <div className="body">
        <Rail />
        <nav className="pane folder-pane" aria-label="Task lists" style={{ flex: `0 0 ${paneWidth}px` }}>
          <button className="folder" aria-current={sel.kind === 'myday'} onClick={() => setSel({ kind: 'myday' })}><span className="twisty" /><Icon name="sun" size={15} /><span className="name">My Day</span></button>
          <div className="pane-heading" style={{ marginTop: 12 }}>Lists</div>
          {lists.map((l) => (
            <button key={l.accountId + l.id} className="folder" aria-current={sel.kind === 'list' && sel.list.id === l.id} onClick={() => setSel({ kind: 'list', list: l })}
              onContextMenu={contextMenu(() => [
                { label: 'Open', icon: 'list', onClick: () => setSel({ kind: 'list', list: l }) },
                { label: 'New task in this list', icon: 'plus', onClick: () => { setSel({ kind: 'list', list: l }); setTimeout(() => document.getElementById('task-new')?.focus(), 50); } },
                { sep: true },
                { label: 'Manage lists in Google Tasks', icon: 'globe', onClick: () => void call('app.openExternal', 'https://tasks.google.com/') }
              ])}>
              <span className="twisty" /><Icon name="list" size={15} /><span className="name">{l.title}</span>
              {accounts.length > 1 && <span className="dot" style={{ background: accounts.find((a) => a.id === l.accountId)?.color }} />}
            </button>
          ))}
        </nav>
        <Splitter dir="x" label="Resize task lists pane" size={paneWidth} setSize={setPaneWidth} onCommit={savePaneWidth} min={180} max={420} reset={240} />
        <main className="tasks-main" aria-label="Tasks">
          <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 600 }}>{sel.kind === 'myday' ? 'My Day' : sel.list.title}</h1>
          <p className="hint-text" style={{ marginTop: 0 }}>{sel.kind === 'myday' ? new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) + ' · tasks due soon and flagged email' : 'Synced with Google Tasks'}</p>
          <form className="add-task" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <label htmlFor="task-new" className="sr-only">Add a task</label>
            <input id="task-new" className="input" placeholder="Add a task" value={title} onChange={(e) => setTitle(e.target.value)} />
            <button className="btn primary" type="submit">Add</button>
          </form>
          {open.map(row)}
          {!open.length && <Empty icon="check" title="All done" text="Nothing left on this list." />}
          {done.length > 0 && sel.kind === 'list' && (
            <>
              <button className="btn ghost" onClick={() => setShowDone(!showDone)} style={{ margin: '10px 0' }}>
                <Icon name={showDone ? 'chevDown' : 'chevRight'} /> Completed ({done.length})
              </button>
              {showDone && done.map(row)}
            </>
          )}
        </main>
        {editing && (
          <Splitter dir="x" invert label="Resize task details" size={panelWidth} setSize={setPanelWidth} onCommit={savePanelWidth} min={260} max={600} reset={340} />
        )}
        {editing && (
          <aside className="side-panel" aria-label="Task details" style={{ flex: `0 0 ${panelWidth}px` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><strong>Task</strong><button className="icon-btn" aria-label="Close" onClick={() => setEditing(null)}><Icon name="close" /></button></div>
            <Field label="Title"><input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></Field>
            <Field label="Due"><input type="date" className="input" value={editing.due ? toLocalInput(editing.due, true) : ''} onChange={(e) => setEditing({ ...editing, due: e.target.value ? fromLocalInput(e.target.value) : undefined })} /></Field>
            <Field label="Notes"><textarea className="input" rows={6} value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary" onClick={() => call('tasks.save', editing).then(() => setEditing(null)).catch(fail)}>Save</button>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </aside>
        )}
      </div>
      <StatusBar left={<span>{open.length} open · {done.length} completed</span>} />
    </>
  );
}
