// The message list: grouped by date, with multi-select, keyboard navigation, drag to folders and hover actions.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Folder, MessageSummary, OutboxItem } from '../../shared/types';
import { call, useLive } from '../api';
import { Icon } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { Empty } from '../components/ui';
import { fail, notify, useApp } from '../state';
import { addrName, cx, groupLabel, listTime } from '../util';
import { archive, del, flag, markRead, rowMenu, type Sel } from './actions';
import { DRAG_MIME } from './FolderPane';

export function MessageList({ folders, position, size }: { folders: Folder[]; position: 'right' | 'bottom' | 'off'; size?: number }) {
  const sizeStyle = size ? (position === 'bottom' ? { height: size } : { flex: `0 0 ${size}px` }) : undefined;
  const { mail, tab, setTab, selected, select, search, accounts, settings } = useApp();
  const [oldestFirst, setOldestFirst] = useState(false);
  const [limit, setLimit] = useState(200);
  const [serverResults, setServerResults] = useState<MessageSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const anchor = useRef<number>(-1);
  const scroller = useRef<HTMLDivElement>(null);

  const folderId = mail.folder.type === 'label' ? mail.folder.id : mail.folder.type === 'unified' ? mail.folder.label : '';
  const isInbox = folderId === 'INBOX';
  const showTabs = isInbox && settings.focusedInbox !== 'off' && !search;
  const isScheduled = folderId === 'SCHEDULED';

  useEffect(() => {
    setServerResults(null);
    setLimit(200);
  }, [mail, search]);

  const [items, , loading] = useLive(
    () =>
      call('mail.list', {
        accountId: mail.accountId,
        folder: search ? { type: 'search', q: search } : mail.folder,
        tab: showTabs ? tab : 'all',
        limit
      }),
    ['mail', 'settings'],
    [JSON.stringify(mail), tab, search, limit, showTabs],
    [] as MessageSummary[]
  );
  const [outbox] = useLive(() => call('mail.outbox'), ['outbox'], [], [] as OutboxItem[]);

  const list = useMemo(() => {
    const base = serverResults ?? items;
    return oldestFirst ? [...base].reverse() : base;
  }, [items, serverResults, oldestFirst]);

  const groups = useMemo(() => {
    const out: { label: string; items: { m: MessageSummary; index: number }[] }[] = [];
    list.forEach((m, index) => {
      const label = groupLabel(m.date);
      if (!out.length || out[out.length - 1].label !== label) out.push({ label, items: [] });
      out[out.length - 1].items.push({ m, index });
    });
    return out;
  }, [list]);

  const selIds = new Set(selected.map((s) => s.accountId + s.id));
  const toSel = (ms: MessageSummary[]): Sel => ms.map((m) => ({ accountId: m.accountId, id: m.id, threadId: m.threadId }));

  // Keep the selection valid when the list changes (e.g. after deleting the selected message, select the next).
  const lastIndex = useRef(0);
  useEffect(() => {
    if (!list.length) return;
    const still = selected.filter((s) => list.some((m) => m.accountId === s.accountId && m.id === s.id));
    if (selected.length && still.length === 0) {
      const next = list[Math.min(lastIndex.current, list.length - 1)];
      if (next) select(toSel([next]));
    } else if (still.length !== selected.length) select(still);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  // Mark as read after a short delay, as Outlook does.
  useEffect(() => {
    if (selected.length !== 1 || settings.markReadAfterSeconds < 0) return;
    const s = selected[0];
    const m = list.find((x) => x.accountId === s.accountId && x.id === s.id);
    if (!m?.unread) return;
    const t = setTimeout(() => void call('mail.markRead', s.accountId, [s.id], true), settings.markReadAfterSeconds * 1000);
    return () => clearTimeout(t);
  }, [selected, list, settings.markReadAfterSeconds]);

  const clickRow = (e: React.MouseEvent, m: MessageSummary, index: number) => {
    lastIndex.current = index;
    if (e.shiftKey && anchor.current >= 0) {
      const [a, b] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
      select(toSel(list.slice(a, b + 1)));
    } else if (e.ctrlKey || e.metaKey) {
      const key = m.accountId + m.id;
      select(selIds.has(key) ? selected.filter((s) => s.accountId + s.id !== key) : [...selected, ...toSel([m])]);
      anchor.current = index;
    } else {
      select(toSel([m]));
      anchor.current = index;
    }
  };

  const listRef = useRef(list);
  listRef.current = list;
  useEffect(() => {
    const all = () => {
      const l = listRef.current;
      if (!l.length) return;
      select(l.map((m) => ({ accountId: m.accountId, id: m.id, threadId: m.threadId })));
      anchor.current = 0;
      scroller.current?.focus();
    };
    window.addEventListener('dav:select-all', all);
    return () => window.removeEventListener('dav:select-all', all);
  }, [select]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!list.length) return;
    const cur = list.findIndex((m) => selIds.has(m.accountId + m.id));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || (settings.shortcuts === 'gmail' && (e.key === 'j' || e.key === 'k'))) {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1;
      const n = Math.max(0, Math.min(list.length - 1, (cur < 0 ? -1 : cur) + dir));
      if (e.shiftKey && anchor.current >= 0) {
        const [a, b] = [Math.min(anchor.current, n), Math.max(anchor.current, n)];
        select(toSel(list.slice(a, b + 1)));
      } else {
        select(toSel([list[n]]));
        anchor.current = n;
      }
      lastIndex.current = n;
      scroller.current?.querySelector(`[data-index="${n}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const n = e.key === 'Home' ? 0 : list.length - 1;
      select(toSel([list[n]]));
      scroller.current?.querySelector(`[data-index="${n}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      e.stopPropagation();
      select(toSel(list));
    } else if (e.key === 'Enter' && selected.length === 1) {
      const s = selected[0];
      const m = list.find((x) => x.accountId === s.accountId && x.id === s.id);
      if (m?.labelIds.includes('DRAFT')) void call('mail.openDraft', m.accountId, m.id).then((d) => call('app.openWindow', 'compose', { draft: JSON.stringify(d) })).catch(fail);
      else void call('app.openWindow', 'message', { accountId: s.accountId, id: s.id, threadId: s.threadId });
    }
  };

  const doServerSearch = async () => {
    setSearching(true);
    try {
      const targets = mail.accountId === 'all' ? accounts : accounts.filter((a) => a.id === mail.accountId);
      const all: MessageSummary[] = [];
      for (const a of targets) all.push(...(await call('mail.serverSearch', a.id, search)));
      all.sort((a, b) => b.date - a.date);
      setServerResults(all);
      if (!all.length) notify('No more results on the server.');
    } catch (e) {
      fail(e);
    } finally {
      setSearching(false);
    }
  };

  const accountColour = (id: string) => accounts.find((a) => a.id === id)?.color;
  const multi = accounts.length > 1 && mail.accountId === 'all';
  const showRecipient = folderId === 'SENT' || folderId === 'DRAFT';

  if (isScheduled) {
    return (
      <section className={cx('list-pane', position)} style={sizeStyle} aria-label="Scheduled">
        <div className="list-head"><span className="title">Scheduled</span></div>
        <div className="list-scroll">
          {outbox.filter((o) => mail.accountId === 'all' || o.accountId === mail.accountId).map((o) => (
            <div key={o.id} className="row">
              <span className="unread-mark"><span /></span>
              <span className="main">
                <span className="line"><span className="from">To: {o.to}</span><span className="time">{o.status === 'failed' ? 'Failed' : new Date(o.sendAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></span>
                <span className="subject">{o.subject}</span>
                <span className="line">
                  {o.error && <span className="preview" style={{ color: 'var(--danger)' }}>{o.error}</span>}
                  <span style={{ flex: 1 }} />
                  <button className="btn small" onClick={async () => {
                    const d = await call('mail.cancelSend', o.id);
                    if (d) void call('app.openWindow', 'compose', { draft: JSON.stringify({ ...d, sendAt: undefined }) });
                  }}>Edit</button>
                  <button className="btn small danger" onClick={() => void call('mail.cancelSend', o.id)}>Cancel send</button>
                </span>
              </span>
            </div>
          ))}
          {!outbox.length && <Empty icon="scheduled" title="Nothing scheduled" text="Use Send later in a new message to schedule it." />}
        </div>
      </section>
    );
  }

  return (
    <section className={cx('list-pane', position)} style={sizeStyle} aria-label={`Messages in ${mail.folderName}`}>
      <div className="list-head">
        {showTabs ? (
          <div role="tablist" aria-label="Inbox view" style={{ display: 'flex' }}>
            <button className="tab" role="tab" aria-selected={tab === 'focused'} onClick={() => setTab('focused')} title={settings.focusedInbox === 'important' ? 'Mail Gmail marks as important' : 'Mail in Gmail’s Primary category'}>{settings.focusedInbox === 'important' ? 'Important' : 'Primary'}</button>
            <button className="tab" role="tab" aria-selected={tab === 'other'} onClick={() => setTab('other')} title={settings.focusedInbox === 'important' ? 'Everything Gmail doesn’t mark as important' : 'Social, Promotions, Updates and Forums'}>Other</button>
          </div>
        ) : (
          <span className="title">{search ? `Results for “${search}”` : mail.folderName}</span>
        )}
        <span className="spacer" />
        <button className="ghost" onClick={() => setOldestFirst(!oldestFirst)} title="Sort order">
          By date {oldestFirst ? '↑' : '↓'}
        </button>
        <button
          className="ghost"
          aria-label="List options"
          onClick={(e) =>
            openMenu(
              [
                { label: 'Show as conversations', checked: settings.conversationView, onClick: () => useApp.getState().updateSettings({ conversationView: !settings.conversationView }) },
                { label: 'Inbox tabs', checked: settings.focusedInbox !== 'off', onClick: () => useApp.getState().updateSettings({ focusedInbox: settings.focusedInbox === 'off' ? 'categories' : 'off' }) },
                { sep: true },
                { label: 'Reading pane on the right', checked: settings.readingPane === 'right', onClick: () => useApp.getState().updateSettings({ readingPane: 'right' }) },
                { label: 'Reading pane at the bottom', checked: settings.readingPane === 'bottom', onClick: () => useApp.getState().updateSettings({ readingPane: 'bottom' }) },
                { label: 'Reading pane off', checked: settings.readingPane === 'off', onClick: () => useApp.getState().updateSettings({ readingPane: 'off' }) },
                { sep: true },
                { label: 'Select all', hint: 'Ctrl+A', onClick: () => select(toSel(list)) },
                { label: 'Mark all as read', onClick: () => void markRead(toSel(list.filter((m) => m.unread)), true) }
              ],
              e.currentTarget
            )
          }
        >
          <Icon name="more" />
        </button>
      </div>
      <div className="list-scroll" ref={scroller} tabIndex={0} role="listbox" aria-multiselectable="true" aria-label="Messages" onKeyDown={onKey} id="message-list">
        {groups.map((g) => (
          <div key={g.label + g.items[0].index} role="group" aria-label={g.label}>
            <div className="group-label">{g.label}</div>
            {g.items.map(({ m, index }) => {
              const isSel = selIds.has(m.accountId + m.id);
              const who = showRecipient ? 'To: ' + (m.to.map(addrName).join(', ') || '(no recipients)') : m.threadSenders ?? addrName(m.from);
              return (
                <div
                  key={m.accountId + m.id}
                  data-index={index}
                  className={cx('row', m.unread && 'unread')}
                  role="option"
                  aria-selected={isSel}
                  draggable
                  onDragStart={(e) => {
                    const sel = isSel ? selected : toSel([m]);
                    if (!isSel) select(sel);
                    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(sel.map((s) => ({ ...s, from: folderId }))));
                    e.dataTransfer.effectAllowed = 'copyMove';
                  }}
                  onClick={(e) => clickRow(e, m, index)}
                  onDoubleClick={() => {
                    if (m.labelIds.includes('DRAFT')) void call('mail.openDraft', m.accountId, m.id).then((d) => call('app.openWindow', 'compose', { draft: JSON.stringify(d) })).catch(fail);
                    else void call('app.openWindow', 'message', { accountId: m.accountId, id: m.id, threadId: m.threadId });
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const sel = isSel ? selected : toSel([m]);
                    if (!isSel) select(sel);
                    openMenu(rowMenu(m, sel, folders.filter((f) => f.accountId === m.accountId), folderId), { x: e.clientX, y: e.clientY });
                  }}
                >
                  <span className="unread-mark" aria-hidden><span /></span>
                  {multi && <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: accountColour(m.accountId) }} aria-hidden />}
                  <span className="main">
                    <span className="line">
                      <span className="from">{who}</span>
                      {m.threadCount && m.threadCount > 1 ? <span className="thread-count" aria-label={`${m.threadCount} messages`}>{m.threadCount}</span> : null}
                      <span className="icons">
                        {m.important && <span style={{ color: 'var(--brass)' }}><Icon name="important" size={12} title="Important" /></span>}
                        {m.hasAttachments && <Icon name="attach" size={13} title="Has attachment" />}
                        {m.snoozedUntil && <Icon name="snooze" size={13} title="Snoozed" />}
                        {m.flagged && <span style={{ color: 'var(--flag)' }}><Icon name="flag" size={13} title="Flagged" fill="currentColor" /></span>}
                      </span>
                      <span className="time">{listTime(m.date)}</span>
                    </span>
                    <span className="subject">{m.subject}</span>
                    <span className="line">
                      {m.categories.map((c) => (
                        <span key={c.name} className="chip cat" style={{ ['--c' as string]: c.color }}>{c.name}</span>
                      ))}
                      <span className="preview">{m.labelIds.includes('DRAFT') && !showRecipient ? '[Draft] ' : ''}{m.snippet}</span>
                    </span>
                  </span>
                  <span className="hover-actions" onClick={(e) => e.stopPropagation()}>
                    <button title="Delete" aria-label="Delete" onClick={() => del(toSel([m]))}><Icon name="trash" size={15} /></button>
                    <button title="Archive" aria-label="Archive" onClick={() => archive(toSel([m]))}><Icon name="archive" size={15} /></button>
                    <button title={m.unread ? 'Mark as read' : 'Mark as unread'} aria-label={m.unread ? 'Mark as read' : 'Mark as unread'} onClick={() => markRead(toSel([m]), m.unread)}><Icon name={m.unread ? 'read' : 'unread'} size={15} /></button>
                    <button title={m.flagged ? 'Clear flag' : 'Flag'} aria-label={m.flagged ? 'Clear flag' : 'Flag'} onClick={() => flag(toSel([m]), !m.flagged)}><Icon name="flag" size={15} /></button>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {!loading && !list.length && (
          search ? (
            <Empty icon="search" title="No matches in downloaded mail" text="Davenport searched the mail on this computer.">
              <button className="btn" onClick={doServerSearch} disabled={searching}>{searching ? 'Searching…' : 'Search all mail on Google'}</button>
            </Empty>
          ) : (
            <Empty icon={isInbox ? 'inbox' : 'folder'} title={isInbox && tab === 'focused' ? 'All caught up' : 'Nothing here'} text={isInbox ? 'New mail will appear here.' : undefined} />
          )
        )}
        {list.length >= limit && !serverResults && (
          <div style={{ padding: 12, textAlign: 'center' }}>
            <button className="btn" onClick={() => setLimit(limit + 200)}>Show more</button>
          </div>
        )}
        {search && list.length > 0 && !serverResults && (
          <div style={{ padding: 12, textAlign: 'center' }}>
            <button className="btn ghost" onClick={doServerSearch} disabled={searching}>{searching ? 'Searching…' : 'Search all mail on Google'}</button>
          </div>
        )}
      </div>
    </section>
  );
}
