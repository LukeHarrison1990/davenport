import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import type { CalEvent, Draft } from '../shared/types';
import { call, onEngine } from './api';
import { App } from './App';
import { EventEditor } from './calendar/EventEditor';
import { MenuHost } from './components/Menu';
import { Toasts } from './components/ui';
import { Compose } from './mail/Compose';
import { ReadingPane } from './mail/ReadingPane';
import { useApp } from './state';

function useSettingsAndAccounts() {
  const { setSettings, setAccounts, pushToast } = useApp();
  useEffect(() => {
    void call('settings.get').then(setSettings);
    void call('accounts.list').then(setAccounts);
    return onEngine({
      toast: pushToast,
      changed: (c) => {
        if (c.scope === 'settings') void call('settings.get').then(setSettings);
        if (c.scope === 'accounts') void call('accounts.list').then(setAccounts);
      }
    });
  }, [setSettings, setAccounts, pushToast]);
}

function ChildWindow({ kind }: { kind: 'compose' | 'event' | 'message' }) {
  useSettingsAndAccounts();
  const [params, setParams] = useState<Record<string, string> | null>(null);
  const [event, setEvent] = useState<Partial<CalEvent> | null>(null);
  useEffect(() => {
    void call('app.windowParams').then(async (p) => {
      setParams(p);
      if (kind === 'event') {
        if (p.key) {
          const k = JSON.parse(p.key);
          setEvent(await call('calendar.get', k.accountId, k.calendarId, k.id));
        } else setEvent(p.draft ? JSON.parse(p.draft) : {});
      }
    });
  }, [kind]);
  const close = () => void call('app.closeWindow');
  if (!params) return null;
  let body = null;
  if (kind === 'compose' && params.draft) {
    const d = JSON.parse(params.draft) as Draft;
    document.title = d.subject || (d.mode === 'new' ? 'New message' : d.subject);
    body = <Compose initial={d} onClose={close} />;
  }
  if (kind === 'event' && event) {
    document.title = event.title || 'Event';
    body = <EventEditor initial={event} onClose={close} />;
  }
  if (kind === 'message' && params.accountId) {
    body = (
      <div style={{ height: '100vh', display: 'flex' }}>
        <ReadingPane folders={[]} standalone={{ accountId: params.accountId, id: params.id, threadId: params.threadId ?? params.id }} />
      </div>
    );
  }
  return (
    <div className="app">
      {body}
      <MenuHost />
      <Toasts />
    </div>
  );
}

function Root() {
  const route = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  if (route === 'compose' || route === 'event' || route === 'message') return <ChildWindow kind={route} />;
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
