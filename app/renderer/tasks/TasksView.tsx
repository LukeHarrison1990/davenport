// Tasks: Google Tasks lists, My Day, and tasks created from flagged email.
import { useState } from 'react';
import type { Task, TaskList } from '../../shared/types';
import { call, useLive } from '../api';
import { Icon } from '../components/Icon';
import { Rail, Ribbon, StatusBar, TitleBar } from '../components/Shell';
import { Empty, Field } from '../components/ui';
import { fail, useApp } from '../state';
import { cx, fromLocalInput, startOfDay, toLocalInput } from '../util';

type Sel = { kind: 'myday' } | { kind: 'list'; list: TaskList };

export function TasksView() {
  const { accounts, setModule, openFolder, select } = useApp();
  const [lists] = useLive(() => call('tasks.lists'), ['tasks'], [], [] as TaskList[]);
  const [sel, setSel] = useState<Sel>({ kind: 'myday' });
  const [showDone, setShowDone] = useState(false);
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState<Task | null>(null);
  const [tasks] = useLive(
    () => (sel.kind === 'myday' ? call('tasks.myDay') : call('tasks.list', sel.list.accountId, sel.list.id, true)),
    ['tasks', 'mail'],
    [JSON.stringify(sel)],
    [] as Task[]
  );
  const today = startOfDay(Date.now());
  const open = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    const list = sel.kind === 'list' ? sel.list : lists[0];
    if (!list) return;
    await call('tasks.save', { accountId: list.accountId, listId: list.id, id: '', title: t, completed: false, due: sel.kind === 'myday' ? today : undefined }).catch(fail);
    setTitle('');
  };

  const row = (t: Task) => {
    const overdue = !t.completed && t.due !== undefined && t.due < today;
    return (
      <div key={t.accountId + t.id} className={cx('task-item', t.completed && 'done')}>
        <input type="checkbox" checked={t.completed} aria-label={`Complete ${t.title}`} onChange={(e) => call('tasks.save', { ...t, completed: e.target.checked }).catch(fail)} />
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setEditing(t)}>
          <div className="t">{t.title || '(untitled)'}</div>
          <div className="n">
            {t.due && <span style={{ color: overdue ? 'var(--danger)' : undefined }}>{startOfDay(t.due) === today ? 'Today' : overdue ? 'Overdue · ' + new Date(t.due).toLocaleDateString() : new Date(t.due).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span>}
            {t.linkedMessage && <> · <a href="#" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setModule('mail'); openFolder({ accountId: t.accountId, folder: { type: 'label', id: 'STARRED' }, folderName: 'Flagged' }); select([{ accountId: t.accountId, id: t.linkedMessage!.messageId, threadId: t.linkedMessage!.messageId }]); }}>Open flagged email</a></>}
          </div>
        </div>
        <button className="icon-btn" aria-label="Delete task" onClick={() => call('tasks.delete', t.accountId, t.listId, t.id).catch(fail)}><Icon name="trash" size={15} /></button>
      </div>
    );
  };

  return (
    <>
      <TitleBar placeholder="Search tasks" onSearch={() => undefined} />
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
          { label: 'Refresh', icon: 'sync', onClick: () => call('sync.now') }
        ] }
      ]} />
      <div className="body">
        <Rail />
        <nav className="pane folder-pane" aria-label="Task lists">
          <button className="folder" aria-current={sel.kind === 'myday'} onClick={() => setSel({ kind: 'myday' })}><span className="twisty" /><Icon name="sun" size={15} /><span className="name">My Day</span></button>
          <div className="pane-heading" style={{ marginTop: 12 }}>Lists</div>
          {lists.map((l) => (
            <button key={l.accountId + l.id} className="folder" aria-current={sel.kind === 'list' && sel.list.id === l.id} onClick={() => setSel({ kind: 'list', list: l })}>
              <span className="twisty" /><Icon name="list" size={15} /><span className="name">{l.title}</span>
              {accounts.length > 1 && <span className="dot" style={{ background: accounts.find((a) => a.id === l.accountId)?.color }} />}
            </button>
          ))}
        </nav>
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
          <aside className="side-panel" aria-label="Task details">
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
