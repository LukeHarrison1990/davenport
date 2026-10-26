// Title bar, module rail, ribbon and status bar.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { call, platform, useLive } from '../api';
import { useApp, type Module } from '../state';
import { cx, initials } from '../util';
import { Icon, Logo } from './Icon';
import { openMenu, type MenuEntry } from './Menu';

export function TitleBar({ placeholder, onSearch }: { placeholder: string; onSearch?: (q: string) => void }) {
  const { accounts, search, setSearch, openDialog, syncProgress } = useApp();
  const [text, setText] = useState(search);
  const ref = useRef<HTMLInputElement>(null);
  const pushed = useRef(search);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Follow changes made elsewhere (e.g. the Filter menu), but never overwrite what's being typed.
  useEffect(() => {
    if (search !== pushed.current) {
      pushed.current = search;
      setText(search);
    }
  }, [search]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  // Search as you type: results update a moment after you stop typing.
  const apply = (q: string, delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      pushed.current = q.trim();
      setSearch(q.trim());
      onSearch?.(q.trim());
    }, delay);
  };
  useEffect(() => {
    const focus = () => ref.current?.focus();
    window.addEventListener('dav:focus-search', focus);
    return () => window.removeEventListener('dav:focus-search', focus);
  }, []);
  const status = syncProgress.active
    ? { text: 'Sending and receiving…', colour: '#D9E2EE', icon: 'sync' }
    : accounts.some((a) => a.status === 'reauth')
    ? { text: 'Sign-in needed', colour: '#F2C14E', icon: 'warning' }
    : accounts.some((a) => a.status === 'syncing')
      ? { text: 'Syncing…', colour: '#D9E2EE', icon: 'sync' }
      : accounts.some((a) => a.status === 'offline')
        ? { text: 'Offline', colour: '#F2C14E', icon: 'warning' }
        : accounts.some((a) => a.status === 'error')
          ? { text: 'Sync problem', colour: '#F2C14E', icon: 'warning' }
          : { text: 'Up to date', colour: '#9FD3A8', icon: 'check' };
  const primary = accounts[0];
  return (
    <header className={cx('titlebar', platform !== 'darwin' && 'has-overlay')} style={platform === 'darwin' ? { paddingLeft: 84 } : undefined}>
      <div className="brand">
        <Logo size={26} />
        <span>Davenport</span>
      </div>
      {onSearch && (
        <form
          className="search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            apply(text, 0);
          }}
        >
          <Icon name="search" />
          <label htmlFor="global-search" className="sr-only">{placeholder}</label>
          <input
            id="global-search"
            ref={ref}
            type="search"
            placeholder={placeholder}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              apply(e.target.value, e.target.value ? 220 : 0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setText('');
                apply('', 0);
                (e.target as HTMLInputElement).blur();
              }
              // Down arrow moves from the search box into the results.
              if (e.key === 'ArrowDown') {
                const list = document.getElementById('message-list');
                if (list) {
                  e.preventDefault();
                  list.focus();
                  list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
                }
              }
            }}
          />
        </form>
      )}
      <div className="right" style={accounts.length ? undefined : { visibility: 'hidden' }}>
        <button className="sync" onClick={() => call('sync.now')} title="Send / Receive (F9)" aria-busy={syncProgress.active}>
          <span className={cx('sync-icon', syncProgress.active && 'spinning')}><Icon name={syncProgress.active ? 'sync' : status.icon} size={14} /></span>
          <span style={{ color: status.colour }}>{status.text}</span>
        </button>
        <button
          className="avatar-btn"
          aria-label={primary ? `Accounts: ${primary.email}` : 'Accounts'}
          onClick={(e) =>
            openMenu(
              [
                ...accounts.map((a) => ({ label: a.email, colour: a.color, hint: a.status === 'reauth' ? 'Sign in' : undefined, onClick: () => openDialog('settings', 'accounts') })),
                { sep: true as const },
                { label: 'Add account…', icon: 'plus', onClick: () => openDialog('settings', 'accounts') },
                { label: 'Settings', icon: 'settings', onClick: () => openDialog('settings') },
                { label: 'About Davenport', icon: 'info', onClick: () => openDialog('about') }
              ],
              e.currentTarget
            )
          }
        >
          {primary ? initials(primary.name) : '·'}
        </button>
      </div>
    </header>
  );
}

export function Rail() {
  const { module, setModule, openDialog } = useApp();
  const [badges] = useLive(
    async () => {
      const accounts = await call('accounts.list');
      let mail = 0;
      for (const a of accounts) mail += (await call('mail.folders', a.id)).find((f) => f.id === 'INBOX')?.unread ?? 0;
      const chat = (await call('chat.spaces', 'all')).reduce((n, s) => n + (s.unread || 0), 0);
      return { mail, chat };
    },
    ['mail', 'folders', 'chat', 'accounts'],
    [],
    { mail: 0, chat: 0 }
  );
  const item = (m: Module, icon: string, label: string, key: string, badge?: number, brass?: boolean) => (
    <button aria-label={`${label} (Ctrl+${key})${badge ? `, ${badge} unread` : ''}`} title={`${label} (Ctrl+${key})`} aria-current={module === m ? 'page' : undefined} onClick={() => setModule(m)}>
      <Icon name={icon} size={22} />
      {!!badge && <span className={cx('badge', brass && 'brass')}>{badge > 99 ? '99+' : badge}</span>}
    </button>
  );
  return (
    <nav className="rail" aria-label="Modules">
      {item('mail', 'mail', 'Mail', '1', badges.mail)}
      {item('calendar', 'calendar', 'Calendar', '2')}
      {item('people', 'people', 'People', '3')}
      {item('chat', 'chat', 'Chat', '4', badges.chat, true)}
      {item('tasks', 'tasks', 'Tasks', '5')}
      <button className="bottom" aria-label="Settings" title="Settings" onClick={() => openDialog('settings')}>
        <Icon name="settings" size={20} />
      </button>
    </nav>
  );
}

export interface RibbonButton {
  label: string;
  icon?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  menu?: () => MenuEntry[] | Promise<MenuEntry[]>;
  disabled?: boolean;
  primary?: boolean;
  outline?: boolean;
  title?: string;
  iconColour?: string;
  iconOnly?: boolean;
  /** Animate the icon (e.g. the Send / Receive arrows while syncing). */
  spin?: boolean;
  /** A split button: the main action plus an attached arrow that opens this menu. */
  split?: () => MenuEntry[] | Promise<MenuEntry[]>;
}
export interface RibbonGroup {
  label: string;
  buttons: RibbonButton[];
}

export function Ribbon({ tabs, groups }: { tabs?: { id: string; label: string; groups: RibbonGroup[] }[]; groups: RibbonGroup[] }) {
  const { settings } = useApp();
  const [tab, setTab] = useState('home');
  const active = tab === 'home' ? groups : tabs?.find((t) => t.id === tab)?.groups ?? groups;
  return (
    <div className={cx('ribbon', settings.ribbon === 'classic' && 'classic')}>
      <div className="ribbon-tabs" role="tablist" aria-label="Ribbon">
        <button className="ribbon-tab" role="tab" aria-selected={tab === 'home'} onClick={() => setTab('home')}>Home</button>
        {tabs?.map((t) => (
          <button key={t.id} className="ribbon-tab" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="toolbar" role="toolbar" aria-label={tab}>
        {active.map((g, gi) => (
          <Fragment key={g.label}>
            {gi > 0 && <span className="tb-sep" aria-hidden />}
            <div className="tb-group" role="group" aria-label={g.label}>
              <div className="tb-group-body">
                {g.buttons.map((b) => {
                  const btn = (
                    <button
                      key={b.label}
                      className={cx('tb-btn', b.primary && 'primary', b.outline && 'outline', b.iconOnly && 'icon-only', b.split && 'split-main')}
                      aria-label={b.iconOnly ? b.label : undefined}
                      disabled={b.disabled}
                      title={b.title ?? b.label}
                      onClick={async (e) => {
                        const t = e.currentTarget;
                        if (b.menu) openMenu(await b.menu(), t);
                        else b.onClick?.(e);
                      }}
                    >
                      <span className={cx('tb-icon', b.spin && 'spinning')} style={{ color: b.iconColour }}>{b.icon && <Icon name={b.icon} size={16} />}</span>
                      <span className="tb-label">
                        {b.label}
                        {b.menu && <Icon name="chevDown" size={11} className="chev" />}
                      </span>
                    </button>
                  );
                  if (!b.split) return btn;
                  return (
                    <span key={b.label} className={cx('tb-split', b.primary && 'primary')}>
                      {btn}
                      <button
                        className={cx('tb-btn', 'split-more', b.primary && 'primary')}
                        aria-label={`More ${b.label.toLowerCase()} options`}
                        title="More options"
                        onClick={async (e) => {
                          const t = e.currentTarget.parentElement as HTMLElement;
                          openMenu(await b.split!(), t);
                        }}
                      >
                        <Icon name="chevDown" size={12} />
                      </button>
                    </span>
                  );
                })}
              </div>
              <span className="tb-group-label">{g.label}</span>
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export function StatusBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  const { accounts, syncProgress: p } = useApp();
  const google = accounts.filter((a) => a.kind === 'google');
  const problem = accounts.find((a) => a.status === 'reauth' || a.status === 'error' || a.status === 'offline');
  const syncing = accounts.find((a) => a.status === 'syncing');
  // Say "complete" for a few seconds after Send / Receive finishes, so a quick one still shows it happened.
  const [, tick] = useState(0);
  const justFinished = !p.active && !!p.finishedAt && Date.now() - p.finishedAt < 4000;
  useEffect(() => {
    if (!justFinished) return;
    const t = setTimeout(() => tick((n) => n + 1), 4000 - (Date.now() - p.finishedAt!));
    return () => clearTimeout(t);
  }, [justFinished, p.finishedAt]);
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <footer className="statusbar">
      {left}
      <span className="right">
        {right}
        {p.active ? (
          <span className="sync-progress" role="status" aria-live="polite">
            <span className="spinning"><Icon name="sync" size={12} /></span>
            <span>Send/Receive: {p.label}…</span>
            <span className="bar" role="progressbar" aria-label="Send/Receive progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <span style={{ width: `${Math.max(4, pct)}%` }} />
            </span>
            <span className="pct">{pct}%</span>
          </span>
        ) : (
          <span role="status">
            {problem
              ? `${problem.email}: ${problem.status === 'reauth' ? 'please sign in again' : problem.error ?? problem.status}`
              : justFinished
                ? 'Send/Receive complete · all folders are up to date'
                : syncing
                  ? syncing.error ?? 'Syncing…'
                  : accounts.length
                    ? `All folders are up to date · ${google.length ? 'Connected to Google' : 'Demo data'}`
                    : 'No accounts'}
          </span>
        )}
      </span>
    </footer>
  );
}
