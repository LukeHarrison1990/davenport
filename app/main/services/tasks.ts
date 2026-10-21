// Google Tasks: the To-Do bar, task lists and "flag for follow-up".
import type { Task, TaskList } from '../../shared/types';
import { all, get, run, tx, uid } from '../db';
import { changed } from '../events';
import { client, getAccount, isDemo } from './accounts';
import * as store from './mailStore';

const TASKS = 'https://tasks.googleapis.com/tasks/v1';
const enc = encodeURIComponent;

interface GTask {
  id: string;
  title?: string;
  notes?: string;
  due?: string;
  status: 'needsAction' | 'completed';
  completed?: string;
  parent?: string;
  position?: string;
  deleted?: boolean;
  hidden?: boolean;
  links?: { type: string; description?: string; link: string }[];
}

const fromG = (accountId: string, listId: string, t: GTask, linked?: Task['linkedMessage']): Task => ({
  accountId,
  listId,
  id: t.id,
  title: t.title ?? '',
  notes: t.notes,
  due: t.due ? Date.parse(t.due) : undefined,
  completed: t.status === 'completed',
  completedAt: t.completed ? Date.parse(t.completed) : undefined,
  parent: t.parent,
  position: t.position,
  linkedMessage: linked
});

const dueIso = (ms?: number) => {
  if (!ms) return undefined;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T00:00:00.000Z`;
};

function put(t: Task): void {
  run('INSERT OR REPLACE INTO tasks (account_id, list_id, id, json) VALUES (?, ?, ?, ?)', t.accountId, t.listId, t.id, JSON.stringify(t));
}

export function lists(): TaskList[] {
  return all<{ account_id: string; id: string; title: string }>('SELECT * FROM tasklists ORDER BY account_id, rowid').map((r) => ({
    accountId: r.account_id, id: r.id, title: r.title
  }));
}

export async function syncTasks(accountId: string): Promise<void> {
  if (isDemo(accountId)) return;
  const c = client(accountId);
  const ls = await c.all<{ id: string; title: string }>(TASKS + '/users/@me/lists', 'items', { maxResults: 100 });
  const linkedByTask = new Map(
    all<{ json: string }>('SELECT json FROM tasks WHERE account_id = ?', accountId)
      .map((r) => JSON.parse(r.json) as Task)
      .filter((t) => t.linkedMessage)
      .map((t) => [t.id, t.linkedMessage])
  );
  const fetched: { list: { id: string; title: string }; items: GTask[] }[] = [];
  for (const l of ls) {
    const items = await c.all<GTask>(TASKS + `/lists/${enc(l.id)}/tasks`, 'items', { showCompleted: true, showHidden: true, maxResults: 100 }, 20);
    fetched.push({ list: l, items });
  }
  tx(() => {
    run('DELETE FROM tasklists WHERE account_id = ?', accountId);
    run('DELETE FROM tasks WHERE account_id = ?', accountId);
    for (const { list, items } of fetched) {
      run('INSERT INTO tasklists (account_id, id, title) VALUES (?, ?, ?)', accountId, list.id, list.title);
      for (const t of items) if (!t.deleted) put(fromG(accountId, list.id, t, linkedByTask.get(t.id)));
    }
  });
  changed('tasks', accountId);
}

export function list(accountId: string, listId: string, showCompleted = true): Task[] {
  return all<{ json: string }>('SELECT json FROM tasks WHERE account_id = ? AND list_id = ?', accountId, listId)
    .map((r) => JSON.parse(r.json) as Task)
    .filter((t) => showCompleted || !t.completed)
    .sort((a, b) => Number(a.completed) - Number(b.completed) || (a.due ?? 9e15) - (b.due ?? 9e15) || (a.position ?? '').localeCompare(b.position ?? ''));
}

/** "My Day": tasks due today or overdue, plus tasks created from flagged mail, across all accounts. */
export function myDay(): Task[] {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return all<{ json: string }>('SELECT json FROM tasks')
    .map((r) => JSON.parse(r.json) as Task)
    .filter((t) => !t.completed && ((t.due !== undefined && t.due <= end.getTime() + 2 * 864e5) || !!t.linkedMessage))
    .sort((a, b) => (a.due ?? 9e15) - (b.due ?? 9e15));
}

export async function save(t: Task): Promise<Task> {
  let saved = t;
  if (!isDemo(t.accountId)) {
    const body: Partial<GTask> = {
      title: t.title,
      notes: t.notes,
      due: dueIso(t.due),
      status: t.completed ? 'completed' : 'needsAction'
    };
    if (!t.completed) (body as Record<string, unknown>).completed = null;
    const g = t.id && !t.id.startsWith('new-')
      ? await client(t.accountId).patch<GTask>(TASKS + `/lists/${enc(t.listId)}/tasks/${enc(t.id)}`, body)
      : await client(t.accountId).post<GTask>(TASKS + `/lists/${enc(t.listId)}/tasks`, body);
    saved = fromG(t.accountId, t.listId, g, t.linkedMessage);
  } else {
    saved = { ...t, id: t.id && !t.id.startsWith('new-') ? t.id : 'task-' + uid(), completedAt: t.completed ? Date.now() : undefined };
  }
  put(saved);
  // Completing a task created from a flagged email clears the flag, as Outlook does.
  if (saved.completed && saved.linkedMessage) {
    const row = store.getRow(saved.accountId, saved.linkedMessage.messageId);
    if (row?.starred) {
      store.modifyLocal(saved.accountId, [row.id], [], ['STARRED']);
      const { enqueue } = await import('./ops');
      enqueue(saved.accountId, 'modify', { ids: [row.id], add: [], remove: ['STARRED'] });
      run('UPDATE messages SET flag_due = NULL, task_id = NULL WHERE account_id = ? AND id = ?', saved.accountId, row.id);
      changed('mail', saved.accountId);
    }
  }
  changed('tasks', t.accountId);
  return saved;
}

export async function remove(accountId: string, listId: string, id: string): Promise<void> {
  if (!isDemo(accountId)) await client(accountId).del(TASKS + `/lists/${enc(listId)}/tasks/${enc(id)}`);
  run('DELETE FROM tasks WHERE account_id = ? AND list_id = ? AND id = ?', accountId, listId, id);
  changed('tasks', accountId);
}

export async function createList(accountId: string, title: string): Promise<TaskList> {
  let id = 'list-' + uid();
  if (!isDemo(accountId)) id = (await client(accountId).post<{ id: string }>(TASKS + '/users/@me/lists', { title })).id;
  run('INSERT INTO tasklists (account_id, id, title) VALUES (?, ?, ?)', accountId, id, title);
  changed('tasks', accountId);
  return { accountId, id, title };
}

function defaultListId(accountId: string): string | undefined {
  return get<{ id: string }>('SELECT id FROM tasklists WHERE account_id = ? ORDER BY rowid LIMIT 1', accountId)?.id;
}

export async function createTaskForMessage(accountId: string, messageId: string, due?: number): Promise<void> {
  const m = store.getRow(accountId, messageId);
  if (!m) return;
  let listId = defaultListId(accountId);
  if (!listId && !isDemo(accountId)) {
    await syncTasks(accountId);
    listId = defaultListId(accountId);
  }
  if (!listId) listId = (await createList(accountId, 'My Tasks')).id;
  const acc = getAccount(accountId);
  const link = `https://mail.google.com/mail/u/${encodeURIComponent(acc.email)}/#all/${m.thread_id}`;
  const task = await save({
    accountId,
    listId,
    id: m.task_id ?? 'new-' + uid(),
    title: m.subject || '(no subject)',
    notes: `Follow up on email from ${m.from_name ?? m.from_email}\n${link}`,
    due,
    completed: false,
    linkedMessage: { messageId, subject: m.subject }
  });
  run('UPDATE messages SET task_id = ? WHERE account_id = ? AND id = ?', task.id, accountId, messageId);
}

export async function completeTaskForMessage(accountId: string, messageId: string): Promise<void> {
  const taskId = get<{ task_id: string | null }>('SELECT task_id FROM messages WHERE account_id = ? AND id = ?', accountId, messageId)?.task_id;
  if (!taskId) return;
  const row = get<{ json: string }>('SELECT json FROM tasks WHERE account_id = ? AND id = ?', accountId, taskId);
  run('UPDATE messages SET task_id = NULL WHERE account_id = ? AND id = ?', accountId, messageId);
  if (!row) return;
  const t = JSON.parse(row.json) as Task;
  await save({ ...t, completed: true, linkedMessage: undefined });
}
