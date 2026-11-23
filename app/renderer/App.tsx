// Davenport window root: picks the module, hosts dialogs, menus and notifications.
import { useEffect, useRef } from 'react';
import { call, onEngine } from './api';
import { MenuHost } from './components/Menu';
import { Toasts } from './components/ui';
import { UpdateBanner } from './components/UpdateBanner';
import { MailView } from './mail/MailView';
import { MoveDialog, NewFolderDialog, OutOfOfficeDialog, QuickStepsDialog, RulesDialog, SearchFolderDialog, SignatureDialog, TemplatesDialog } from './mail/dialogs';
import { AboutDialog, SettingsDialog, Welcome } from './settings/Settings';
import { useApp, type Module } from './state';
import { TitleBar } from './components/Shell';
import { CalendarView, SubscribeDialog } from './calendar/CalendarView';
import { PeopleView } from './people/PeopleView';
import { TasksView } from './tasks/TasksView';
import { ChatView } from './chat/ChatView';

export function App() {
  const { module, setModule, accounts, setAccounts, setSettings, dialog, dialogArg, openDialog, pushToast } = useApp();
  const loaded = useRef(false);

  useEffect(() => {
    void call('settings.get').then(setSettings);
    const loadAccounts = () => call('accounts.list').then((a) => {
      setAccounts(a);
      loaded.current = true;
    });
    void loadAccounts();
    void call('sync.progress').then((p) => useApp.getState().setSyncProgress(p));
    return onEngine({
      changed: (c) => {
        if (c.scope === 'accounts') void loadAccounts();
        if (c.scope === 'settings') void call('settings.get').then(setSettings);
      },
      toast: (t) => pushToast(t),
      syncStatus: () => void loadAccounts(),
      syncProgress: (p) => useApp.getState().setSyncProgress(p),
      navigate: (n) => {
        setModule(n.module as Module);
        if (n.module === 'mail' && n.accountId && n.id) {
          useApp.getState().openFolder({ accountId: n.accountId, folder: { type: 'label', id: 'INBOX' }, folderName: 'Inbox' });
          useApp.getState().select([{ accountId: n.accountId, id: n.id, threadId: n.threadId ?? n.id }]);
        }
      }
    });
  }, [setAccounts, setSettings, pushToast, setModule]);

  // Show "Sending… Undo" for each message in its undo window.
  useEffect(() => {
    const seen = new Set<string>();
    return onEngine({
      changed: async (c) => {
        if (c.scope !== 'outbox') return;
        const items = await call('mail.outbox');
        for (const o of items) {
          if (seen.has(o.id) || o.status !== 'waiting' || !o.undoable || o.sendAt < Date.now()) continue;
          seen.add(o.id);
          const secs = Math.round((o.sendAt - Date.now()) / 1000);
          if (secs <= 0) continue;
          useApp.getState().pushToast({
            id: 'send-' + o.id,
            kind: 'undo',
            text: `Sending “${o.subject}”…`,
            timeoutMs: Math.max(1500, o.sendAt - Date.now()),
            action: { label: 'Undo', method: 'dav:undo-send', args: [o.id] }
          });
        }
      }
    });
  }, []);

  // Global shortcuts: module switching and send/receive.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const map: Record<string, Module> = { '1': 'mail', '2': 'calendar', '3': 'people', '4': 'chat', '5': 'tasks' };
      if (ctrl && !e.shiftKey && map[e.key]) {
        e.preventDefault();
        setModule(map[e.key]);
      } else if (e.key === 'F9') {
        e.preventDefault();
        void call('sync.now');
      } else if (ctrl && e.key === ',') {
        e.preventDefault();
        openDialog('settings');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setModule, openDialog]);

  const close = () => openDialog(null);
  const view = !accounts.length ? null : module === 'mail' ? <MailView /> : module === 'calendar' ? <CalendarView /> : module === 'people' ? <PeopleView /> : module === 'tasks' ? <TasksView /> : <ChatView />;

  return (
    <div className="app">
      {accounts.length ? (
        view
      ) : (
        <>
          <TitleBar placeholder="" />
          {loaded.current && <Welcome />}
        </>
      )}
      {dialog === 'settings' && <SettingsDialog arg={dialogArg} onClose={close} />}
      {dialog === 'about' && <AboutDialog onClose={close} />}
      {dialog === 'moveTo' && <MoveDialog arg={dialogArg as never} onClose={close} />}
      {dialog === 'newFolder' && <NewFolderDialog arg={dialogArg as never} onClose={close} />}
      {dialog === 'rules' && <RulesDialog arg={dialogArg as never} onClose={close} />}
      {dialog === 'quicksteps' && <QuickStepsDialog arg={dialogArg} onClose={close} />}
      {dialog === 'templates' && <TemplatesDialog onClose={close} />}
      {dialog === 'searchFolder' && <SearchFolderDialog arg={dialogArg as never} onClose={close} />}
      {dialog === 'outOfOffice' && <OutOfOfficeDialog onClose={close} />}
      {dialog === 'signature' && <SignatureDialog onClose={close} />}
      {dialog === 'subscribe' && <SubscribeDialog onClose={close} />}
      <MenuHost />
      <UpdateBanner />
      <Toasts />
    </div>
  );
}
