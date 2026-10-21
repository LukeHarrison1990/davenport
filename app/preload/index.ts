// The only bridge between the window and the engine: a typed invoke() and an event subscription.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('davenport', {
  invoke: async (method: string, ...args: unknown[]) => {
    const r = (await ipcRenderer.invoke('api', method, args)) as { ok: boolean; value?: unknown; error?: string };
    if (!r.ok) throw new Error(r.error);
    return r.value;
  },
  on: (handler: (event: string, payload: unknown) => void) => {
    const listener = (_e: unknown, event: string, payload: unknown) => handler(event, payload);
    ipcRenderer.on('engine-event', listener);
    return () => ipcRenderer.removeListener('engine-event', listener);
  },
  platform: process.platform
});
