// To-Do bar: month calendar, today's meetings and tasks (Google Tasks), docked on the right.
import { useState } from 'react';
import type { CalEvent, Task } from '../../shared/types';
import { call, useLive } from '../api';
import { fail, useApp } from '../state';
import { addDays, startOfDay, time } from '../util';
import { MiniCalendar } from './MiniCalendar';

export function TodoBar() {
  const { setModule, setCalDate } = useApp();
  const [newTask, setNewTask] = useState('');
  const today = startOfDay(Date.now());
  const [events] = useLive(() => call('calendar.events', today, addDays(today, 2)), ['calendar'], [today], [] as CalEvent[]);
  const [tasks] = useLive(() => call('tasks.myDay'), ['tasks', 'mail'], [], [] as Task[]);
  const upcoming = events.filter((e) => !e.allDay && e.end > Date.now() && e.eventType === 'default' && e.myResponse !== 'declined').slice(0, 4);

  const addTask = async () => {
    const title = newTask.trim();
    if (!title) return;
    const lists = await call('tasks.lists');
    const list = lists[0];
    if (!list) return fail(new Error('No task list yet.'));
    await call('tasks.save', { accountId: list.accountId, listId: list.id, id: '', title, completed: false, due: today }).catch(fail);
    setNewTask('');
  };

  return (
    <aside className="todo-bar" aria-label="To-Do bar">
      <MiniCalendar value={Date.now()} onPick={(d) => { setCalDate(d); setModule('calendar'); }} />
      <section aria-label="Upcoming">
        <div className="pane-heading" style={{ padding: '0 0 8px' }}>{upcoming.length ? 'Coming up' : 'No more meetings today'}</div>
        {upcoming.map((e) => (
          <button key={e.accountId + e.id} className="agenda-item" onClick={() => { setCalDate(e.start); setModule('calendar'); }}>
            <span className="bar" style={{ background: e.color ?? 'var(--accent)' }} />
            <span className="t">
              <strong>{e.title}</strong>
              <span>
                {startOfDay(e.start) !== today ? 'Tomorrow ' : ''}{time(e.start)}–{time(e.end)}{e.location ? ' · ' + e.location : e.meetUrl ? ' · Google Meet' : ''}
              </span>
              {e.meetUrl && e.start - Date.now() < 15 * 60_000 && (
                <a href="#" style={{ fontWeight: 600 }} onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); void call('app.openExternal', e.meetUrl!); }}>Join</a>
              )}
            </span>
          </button>
        ))}
      </section>
      <section aria-label="Tasks">
        <div className="pane-heading" style={{ padding: '0 0 6px' }}>Tasks</div>
        {tasks.map((t) => {
          const overdue = t.due !== undefined && t.due < today;
          return (
            <label key={t.accountId + t.id} className="task-row">
              <input type="checkbox" checked={t.completed} onChange={(e) => call('tasks.save', { ...t, completed: e.target.checked }).catch(fail)} />
              <span>
                <span className="title">{t.title}</span>
                <br />
                <span className={'due' + (overdue ? ' overdue' : '')}>
                  {t.linkedMessage ? 'Flagged email · ' : ''}
                  {t.due ? (startOfDay(t.due) === today ? 'Due today' : overdue ? 'Overdue' : 'Due ' + new Date(t.due).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })) : 'No date'}
                </span>
              </span>
            </label>
          );
        })}
        <form onSubmit={(e) => { e.preventDefault(); void addTask(); }} style={{ marginTop: 6 }}>
          <label className="sr-only" htmlFor="todo-add">Add a task</label>
          <input id="todo-add" className="input" placeholder="Add a task" value={newTask} onChange={(e) => setNewTask(e.target.value)} />
        </form>
      </section>
    </aside>
  );
}
