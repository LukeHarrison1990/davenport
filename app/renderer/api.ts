// Typed access to the engine from the window.
import { useEffect, useRef, useState } from 'react';
import type { Api, ApiMethod, EngineEvents } from '../shared/api';
import type { ChangeScope } from '../shared/types';

interface Bridge {
  invoke: (method: string, ...args: unknown[]) => Promise<unknown>;
  on: (handler: (event: string, payload: unknown) => void) => () => void;
  platform: string;
}

declare global {
  interface Window {
    davenport: Bridge;
  }
}

export const bridge = window.davenport;
export const platform = bridge?.platform ?? 'win32';

export function call<M extends ApiMethod>(method: M, ...args: Parameters<Api[M]>): Promise<Awaited<ReturnType<Api[M]>>> {
  return bridge.invoke(method, ...args) as Promise<Awaited<ReturnType<Api[M]>>>;
}

type Listener = { [K in keyof EngineEvents]?: (p: EngineEvents[K]) => void };
const listeners = new Set<Listener>();
bridge?.on((event, payload) => {
  for (const l of listeners) (l[event as keyof EngineEvents] as ((p: unknown) => void) | undefined)?.(payload);
});

export function onEngine(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * Loads data from the engine and reloads it whenever the engine reports a change in one of the given scopes.
 * Keeps showing the previous value while reloading, so lists don't flicker.
 */
export function useLive<T>(load: () => Promise<T>, scopes: ChangeScope[], deps: unknown[], initial: T): [T, () => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);
  const reload = () => {
    const n = ++seq.current;
    loadRef
      .current()
      .then((v) => {
        if (n === seq.current) {
          setValue(v);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (n === seq.current) setLoading(false);
        console.warn(e);
      });
  };
  useEffect(() => {
    setLoading(true);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(
    () =>
      onEngine({
        changed: (c) => {
          if (scopes.includes(c.scope)) reload();
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopes.join()]
  );
  return [value, reload, loading];
}
