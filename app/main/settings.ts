import { defaultSettings, type Settings } from '../shared/types';
import { kvGet, kvSet } from './db';
import { changed } from './events';

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (!cache) cache = { ...defaultSettings, ...(kvGet<Partial<Settings>>('settings', 'app') ?? {}) };
  return cache;
}

export function setSettings(patch: Partial<Settings>): Settings {
  cache = { ...getSettings(), ...patch };
  kvSet('settings', 'app', cache);
  changed('settings');
  return cache;
}
