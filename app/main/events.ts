// Pushes engine events (data changed, toasts, navigation) to every open window.
import { BrowserWindow } from 'electron';
import type { EngineEvents } from '../shared/api';
import type { ChangeScope, Toast } from '../shared/types';
import { uid } from './db';

export function emit<K extends keyof EngineEvents>(event: K, payload: EngineEvents[K]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('engine-event', event, payload);
  }
}

// Coalesce bursts of change notifications (a sync can touch thousands of rows).
const pending = new Map<string, { scope: ChangeScope; accountId?: string }>();
let timer: NodeJS.Timeout | null = null;

export function changed(scope: ChangeScope, accountId?: string): void {
  pending.set(scope + '|' + (accountId ?? ''), { scope, accountId });
  if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      const items = [...pending.values()];
      pending.clear();
      for (const it of items) emit('changed', it);
    }, 120);
  }
}

export function toast(t: Omit<Toast, 'id'>): void {
  emit('toast', { id: uid(), ...t });
}
