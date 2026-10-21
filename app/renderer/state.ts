// Window-wide interface state (what's selected, which module is open, dialogs).
import { create } from 'zustand';
import type { Account, FolderRef, Settings, Toast } from '../shared/types';
import { defaultSettings } from '../shared/types';
import { call } from './api';

export type Module = 'mail' | 'calendar' | 'people' | 'chat' | 'tasks';
export type DialogName =
  | null | 'settings' | 'rules' | 'quicksteps' | 'templates' | 'searchFolder' | 'outOfOffice' | 'signature' | 'newFolder' | 'moveTo' | 'about' | 'subscribe';

export interface MailSel {
  accountId: string | 'all';
  folder: FolderRef;
  folderName: string;
}

interface State {
  module: Module;
  accounts: Account[];
  settings: Settings;
  mail: MailSel;
  tab: 'focused' | 'other';
  selected: { accountId: string; id: string; threadId: string }[];
  search: string;
  calDate: number;
  dialog: DialogName;
  dialogArg: unknown;
  toasts: Toast[];
  setModule: (m: Module) => void;
  setAccounts: (a: Account[]) => void;
  setSettings: (s: Settings) => void;
  updateSettings: (p: Partial<Settings>) => Promise<void>;
  openFolder: (sel: MailSel) => void;
  setTab: (t: 'focused' | 'other') => void;
  select: (items: { accountId: string; id: string; threadId: string }[]) => void;
  setSearch: (q: string) => void;
  setCalDate: (d: number) => void;
  openDialog: (d: DialogName, arg?: unknown) => void;
  pushToast: (t: Toast) => void;
  dropToast: (id: string) => void;
}

export const useApp = create<State>((set, get) => ({
  module: 'mail',
  accounts: [],
  settings: defaultSettings,
  mail: { accountId: 'all', folder: { type: 'unified', label: 'INBOX' }, folderName: 'Inbox' },
  tab: 'focused',
  selected: [],
  search: '',
  calDate: Date.now(),
  dialog: null,
  dialogArg: undefined,
  toasts: [],
  setModule: (module) => set({ module }),
  setAccounts: (accounts) => {
    const cur = get().mail;
    // If the selected account went away, fall back to the unified inbox.
    if (cur.accountId !== 'all' && !accounts.some((a) => a.id === cur.accountId)) {
      set({ accounts, mail: { accountId: 'all', folder: { type: 'unified', label: 'INBOX' }, folderName: 'Inbox' }, selected: [] });
    } else set({ accounts });
  },
  setSettings: (settings) => {
    set({ settings });
    applyTheme(settings);
  },
  updateSettings: async (p) => {
    const s = await call('settings.set', p);
    get().setSettings(s);
  },
  openFolder: (mail) => set({ mail, selected: [], search: '' }),
  setTab: (tab) => set({ tab, selected: [] }),
  select: (selected) => set({ selected }),
  setSearch: (search) => set({ search }),
  setCalDate: (calDate) => set({ calDate }),
  openDialog: (dialog, dialogArg) => set({ dialog, dialogArg }),
  pushToast: (t) => {
    set({ toasts: [...get().toasts.filter((x) => x.text !== t.text), t].slice(-4) });
    setTimeout(() => get().dropToast(t.id), t.timeoutMs ?? (t.kind === 'error' ? 8000 : 5000));
  },
  dropToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}));

let mql: MediaQueryList | null = null;
export function applyTheme(s: Settings): void {
  const root = document.documentElement;
  const resolve = () => (s.theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : s.theme);
  root.dataset.theme = resolve();
  root.dataset.density = s.density;
  root.style.setProperty('--accent', s.accent);
  root.style.setProperty('--accent-strong', shade(s.accent, -0.18));
  if (!mql) {
    mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', () => applyTheme(useApp.getState().settings));
  }
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + v * amt)));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
}

export const toastId = () => Math.random().toString(36).slice(2);
export function notify(text: string, kind: Toast['kind'] = 'info', action?: Toast['action']): void {
  useApp.getState().pushToast({ id: toastId(), text, kind, action });
}
export function fail(e: unknown): void {
  notify((e as Error)?.message ?? String(e), 'error');
}
