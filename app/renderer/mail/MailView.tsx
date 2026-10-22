// The Mail module: ribbon, folder pane, message list, reading pane and To-Do bar.
import { useEffect, useRef, useState } from 'react';
import type { Folder } from '../../shared/types';
import { call, useLive } from '../api';
import { Rail, Ribbon, StatusBar, TitleBar, type RibbonGroup } from '../components/Shell';
import { TodoBar } from '../components/TodoBar';
import { fail, notify, useApp } from '../state';
import { archive, categoryMenu, del, flag, flagMenu, markRead, newMail, quickStepsMenu, respond, snoozeMenu, spam } from './actions';
import { FolderPane } from './FolderPane';
import { MessageList } from './MessageList';
import { ReadingPane } from './ReadingPane';

export function MailView() {
  const { accounts, mail, selected, settings, openDialog, updateSettings, setSearch } = useApp();
  const [folders] = useLive(
    async () => {
      const out: Folder[] = [];
      for (const a of accounts) out.push(...(await call('mail.folders', a.id)));
      return out;
    },
    ['folders', 'accounts'],
    [accounts.map((a) => a.id).join()],
    [] as Folder[]
  );

  const splitRef = useRef<HTMLDivElement>(null);
  const clampHeight = (h: number) => {
    const total = splitRef.current?.getBoundingClientRect().height ?? 700;
    return Math.round(Math.max(120, Math.min(total - 160, h)));
  };
  const [listHeight, setListHeight] = useState(() => {
    try {
      return Number(localStorage.getItem('dav.listHeight')) || 300;
    } catch {
      return 300;
    }
  });

  const has = selected.length > 0;
  const one = selected.length === 1;
  const folderId = mail.folder.type === 'label' ? mail.folder.id : '';
  const acctFolders = (accountId?: string) => folders.filter((f) => f.accountId === (accountId ?? selected[0]?.accountId));

  // Outlook-style keyboard shortcuts (or Gmail's single keys if chosen in Settings).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && !e.shiftKey && k === 'n') { e.preventDefault(); void newMail(); return; }
      if (ctrl && k === 'e') { e.preventDefault(); window.dispatchEvent(new Event('dav:focus-search')); return; }
      if (typing) return;
      const sel = useApp.getState().selected;
      if (ctrl && e.shiftKey && k === 'r') { e.preventDefault(); void respond(sel, 'replyAll'); }
      else if (ctrl && k === 'r') { e.preventDefault(); void respond(sel, 'reply'); }
      else if (ctrl && k === 'f') { e.preventDefault(); void respond(sel, 'forward'); }
      else if (ctrl && k === 'q') { e.preventDefault(); void markRead(sel, true); }
      else if (ctrl && k === 'u') { e.preventDefault(); void markRead(sel, false); }
      else if (ctrl && e.shiftKey && k === 'v') { e.preventDefault(); if (sel.length) openDialog('moveTo', { mode: 'move', sel }); }
      else if (ctrl && k === 'p' && sel.length === 1) { e.preventDefault(); void call('mail.print', sel[0].accountId, sel[0].id).catch(fail); }
      else if (e.key === 'Delete' && sel.length) { e.preventDefault(); del(sel); }
      else if (e.key === 'Backspace' && sel.length) { e.preventDefault(); archive(sel); }
      else if (e.key === 'Insert' && sel.length) { e.preventDefault(); void flag(sel, true); }
      else if (settings.shortcuts === 'gmail' && !ctrl && !e.altKey) {
        const map: Record<string, () => void> = {
          c: () => void newMail(),
          r: () => void respond(sel, 'reply'),
          a: () => void respond(sel, 'replyAll'),
          f: () => void respond(sel, 'forward'),
          e: () => sel.length && archive(sel),
          '#': () => sel.length && del(sel),
          s: () => void flag(sel, true),
          '/': () => window.dispatchEvent(new Event('dav:focus-search')),
          u: () => void markRead(sel, false),
          i: () => void markRead(sel, true),
          v: () => sel.length && openDialog('moveTo', { mode: 'move', sel })
        };
        const fn = map[e.shiftKey && e.key === 'I' ? 'i' : e.key === '#' ? '#' : k];
        if (fn) { e.preventDefault(); fn(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openDialog, settings.shortcuts]);

  const home: RibbonGroup[] = [
    { label: 'New', buttons: [
      { label: 'New mail', icon: 'mail', primary: true, onClick: () => void newMail(), title: 'New mail (Ctrl+N)', split: () => [
        { label: 'Email message', icon: 'mail', onClick: () => void newMail() },
        { label: 'Event', icon: 'calendar', onClick: () => void call('app.openWindow', 'event', {}) },
        { label: 'Contact', icon: 'person', onClick: () => { useApp.getState().setModule('people'); window.dispatchEvent(new Event('dav:new-contact')); } },
        { label: 'Task', icon: 'tasks', onClick: () => useApp.getState().setModule('tasks') },
        { label: 'Folder', icon: 'folderPlus', onClick: () => openDialog('newFolder', { accountId: mail.accountId !== 'all' ? mail.accountId : accounts[0]?.id, parent: '' }) }
      ] }
    ] },
    { label: 'Delete', buttons: [
      { label: 'Delete', icon: 'trash', disabled: !has, onClick: () => del(selected), title: 'Delete (Del)' },
      { label: 'Archive', icon: 'archive', disabled: !has, onClick: () => archive(selected), title: 'Archive (Backspace)' },
      { label: folderId === 'SPAM' ? 'Not spam' : 'Spam', icon: 'spam', disabled: !has, onClick: () => void spam(selected, folderId !== 'SPAM') }
    ] },
    { label: 'Respond', buttons: [
      { label: 'Reply', icon: 'reply', disabled: !one, onClick: () => void respond(selected, 'reply'), title: 'Reply (Ctrl+R)' },
      { label: 'Reply all', icon: 'replyAll', disabled: !one, onClick: () => void respond(selected, 'replyAll'), title: 'Reply all (Ctrl+Shift+R)' },
      { label: 'Forward', icon: 'forward', disabled: !has, onClick: () => void respond(selected, 'forward'), title: 'Forward (Ctrl+F)' }
    ] },
    { label: 'Move', buttons: [
      { label: 'Move', icon: 'move', disabled: !has, menu: () => [
        { label: 'Other folder…', icon: 'move', hint: 'Ctrl+Shift+V', onClick: () => openDialog('moveTo', { mode: 'move', sel: selected }) },
        { label: 'Inbox', icon: 'inbox', onClick: () => void call('mail.move', selected[0].accountId, selected.filter((s) => s.accountId === selected[0].accountId).map((s) => s.id), 'INBOX', folderId || 'ALL') },
        { sep: true },
        { label: 'Create rule…', icon: 'rules', onClick: () => openDialog('rules') },
        { label: 'Manage rules', icon: 'settings', onClick: () => openDialog('rules') }
      ], title: 'Move to folder (Ctrl+Shift+V)' }
    ] },
    { label: 'Tags', buttons: [
      { label: 'Read / Unread', icon: 'unread', iconOnly: true, disabled: !has, onClick: async () => {
        const items = await call('mail.get', selected[0].accountId, selected[0].id).catch(() => null);
        void markRead(selected, items ? items.unread : true);
      }, title: 'Ctrl+Q / Ctrl+U' },
      { label: 'Categorise', icon: 'tag', disabled: !has, menu: () => categoryMenu(selected, acctFolders(), []) },
      { label: 'Follow up', icon: 'flag', disabled: !has, menu: () => flagMenu(selected, true) },
      { label: 'Snooze', icon: 'snooze', disabled: !has, menu: () => snoozeMenu(selected) }
    ] },
    { label: 'Quick Steps', buttons: [
      { label: 'Quick Steps', icon: 'bolt', outline: true, iconColour: 'var(--brass)', menu: () => quickStepsMenu(selected) }
    ] },
    { label: 'Find', buttons: [
      { label: 'Filter', icon: 'list', iconOnly: true, menu: () => [
        { label: 'Unread', onClick: () => setSearch('is:unread') },
        { label: 'Flagged', onClick: () => setSearch('is:flagged') },
        { label: 'Has attachments', onClick: () => setSearch('has:attachment') },
        { label: 'Last 7 days', onClick: () => setSearch('newer_than:7d') },
        { sep: true },
        { label: 'Clear filter', onClick: () => setSearch('') }
      ] }
    ] }
  ];

  const tabs = [
    { id: 'send', label: 'Send / Receive', groups: [
      { label: 'Send & Receive', buttons: [
        { label: 'Send / Receive all folders', icon: 'sync', onClick: () => void call('sync.now'), title: 'F9' },
        { label: 'Scheduled', icon: 'scheduled', onClick: () => useApp.getState().openFolder({ accountId: 'all', folder: { type: 'label', id: 'SCHEDULED' }, folderName: 'Scheduled' }) }
      ] },
      { label: 'Preferences', buttons: [
        { label: `Undo send: ${settings.undoSendSeconds}s`, icon: 'clock', menu: () => [5, 10, 20, 30].map((n) => ({ label: `${n} seconds`, checked: settings.undoSendSeconds === n, onClick: () => updateSettings({ undoSendSeconds: n }) })) }
      ] }
    ] },
    { id: 'folder', label: 'Folder', groups: [
      { label: 'New', buttons: [
        { label: 'New folder', icon: 'folderPlus', onClick: () => openDialog('newFolder', { accountId: mail.accountId !== 'all' ? mail.accountId : accounts[0]?.id, parent: '' }) },
        { label: 'New Search Folder', icon: 'search', onClick: () => openDialog('searchFolder') }
      ] },
      { label: 'Rules', buttons: [
        { label: 'Rules', icon: 'rules', onClick: () => openDialog('rules') },
        { label: 'Quick Steps', icon: 'bolt', onClick: () => openDialog('quicksteps') }
      ] },
      { label: 'Clean up', buttons: [
        { label: 'Mark all as read', icon: 'read', onClick: async () => {
          const items = await call('mail.list', { accountId: mail.accountId, folder: mail.folder, limit: 5000, unreadOnly: true });
          await markRead(items.map((m) => ({ accountId: m.accountId, id: m.id, threadId: m.threadId })), true);
          notify('All marked as read.');
        } },
        { label: 'Empty Bin', icon: 'trash', disabled: mail.accountId === 'all', onClick: () => {
          if (mail.accountId !== 'all' && window.confirm("Permanently delete everything in the Bin? This can't be undone.")) void call('mail.emptyFolder', mail.accountId, 'TRASH').catch(fail);
        } }
      ] },
      { label: 'Automatic replies', buttons: [
        { label: 'Automatic replies', icon: 'plane', onClick: () => openDialog('outOfOffice') },
        { label: 'Signatures', icon: 'signature', onClick: () => openDialog('signature') },
        { label: 'Templates', icon: 'template', onClick: () => openDialog('templates') }
      ] }
    ] },
    { id: 'view', label: 'View', groups: [
      { label: 'Layout', buttons: [
        { label: 'Reading pane', icon: 'pane', menu: () => (['right', 'bottom', 'off'] as const).map((p) => ({ label: p === 'off' ? 'Off' : p === 'right' ? 'Right' : 'Bottom', checked: settings.readingPane === p, onClick: () => updateSettings({ readingPane: p }) })) },
        { label: 'To-Do bar', icon: 'tasks', onClick: () => updateSettings({ todoBar: !settings.todoBar }) },
        { label: 'Conversations', icon: 'thread', onClick: () => updateSettings({ conversationView: !settings.conversationView }) },
        { label: 'Focused Inbox', icon: 'inbox', onClick: () => updateSettings({ focusedInbox: settings.focusedInbox === 'off' ? 'categories' : 'off' }) }
      ] },
      { label: 'Appearance', buttons: [
        { label: 'Theme', icon: 'brightness', menu: () => (['system', 'light', 'dark'] as const).map((t) => ({ label: t === 'system' ? 'Follow Windows' : t[0].toUpperCase() + t.slice(1), checked: settings.theme === t, onClick: () => updateSettings({ theme: t }) })) },
        { label: 'Density', icon: 'list', menu: () => (['compact', 'standard', 'roomy'] as const).map((t) => ({ label: t[0].toUpperCase() + t.slice(1), checked: settings.density === t, onClick: () => updateSettings({ density: t }) })) },
        { label: settings.ribbon === 'classic' ? 'Simplified ribbon' : 'Classic ribbon', icon: 'grid', onClick: () => updateSettings({ ribbon: settings.ribbon === 'classic' ? 'simplified' : 'classic' }) }
      ] }
    ] }
  ];

  const pane = settings.readingPane;
  return (
    <>
      <TitleBar placeholder="Search mail" onSearch={(q) => setSearch(q)} />
      <Ribbon groups={home} tabs={tabs} />
      <div className="body">
        <Rail />
        <FolderPane />
        <div className={'mail-split ' + pane} ref={splitRef}>
          <MessageList folders={folders} position={pane} height={pane === 'bottom' ? listHeight : undefined} />
          {pane === 'bottom' && (
            <div
              className="splitter"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize message list"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') setListHeight((h) => clampHeight(h - 24));
                if (e.key === 'ArrowDown') setListHeight((h) => clampHeight(h + 24));
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                const top = splitRef.current!.getBoundingClientRect().top;
                const el = e.currentTarget;
                el.classList.add('dragging');
                const move = (ev: MouseEvent) => setListHeight(clampHeight(ev.clientY - top));
                const up = () => {
                  el.classList.remove('dragging');
                  window.removeEventListener('mousemove', move);
                  window.removeEventListener('mouseup', up);
                  setListHeight((h) => {
                    try { localStorage.setItem('dav.listHeight', String(h)); } catch { /* ignore */ }
                    return h;
                  });
                };
                window.addEventListener('mousemove', move);
                window.addEventListener('mouseup', up);
              }}
            />
          )}
          {pane !== 'off' && <ReadingPane folders={folders} />}
        </div>
        {settings.todoBar && <TodoBar />}
      </div>
      <MailStatus />
    </>
  );
}

function MailStatus() {
  const { mail, search } = useApp();
  const [count] = useLive(
    () => call('mail.count', { accountId: mail.accountId, folder: search ? { type: 'search', q: search } : mail.folder }),
    ['mail'],
    [JSON.stringify(mail), search],
    { total: 0, unread: 0 }
  );
  return <StatusBar left={<><span>Items: {count.total.toLocaleString()}</span><span>Unread: {count.unread.toLocaleString()}</span></>} />;
}
