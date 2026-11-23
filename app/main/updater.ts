// Updates from Davenport's GitHub releases (github.com/LukeHarrison1990/davenport).
//
// Davenport checks shortly after starting and then every six hours. When there's a newer release it tells the
// user, who chooses whether to download and install it; nothing is installed without asking. Network managers
// can switch this off for a computer (see docs/DEPLOYMENT.md), and portable copies only point to the download.
import { app } from 'electron';
import { execFile } from 'node:child_process';
import type { UpdateState } from '../shared/types';
import { emit } from './events';
import { getSettings } from './settings';

const RELEASES = 'https://github.com/LukeHarrison1990/davenport/releases';
const FIRST_CHECK_MS = 30_000;
const EVERY_MS = 6 * 60 * 60_000;

let state: UpdateState = { status: 'idle', current: app.getVersion() };
let timer: NodeJS.Timeout | null = null;
let policyOff: boolean | null = null;

function set(next: Partial<UpdateState>): void {
  state = { ...state, ...next };
  emit('update', state);
}

export const updateState = (): UpdateState => state;

/** Portable copies run from wherever they were saved, so they can't replace themselves. */
const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_DIR;

/**
 * Switched off by IT for this computer: the DisableUpdates policy value in the registry (set by installing with
 * /DISABLEUPDATES, by Group Policy or by Intune), or the DAVENPORT_DISABLE_UPDATES environment variable.
 */
export async function updatesDisabledByPolicy(): Promise<boolean> {
  if (policyOff !== null) return policyOff;
  if (process.env.DAVENPORT_DISABLE_UPDATES === '1') return (policyOff = true);
  if (process.platform !== 'win32') return (policyOff = false);
  const read = (hive: string) =>
    new Promise<boolean>((resolve) =>
      execFile('reg', ['query', `${hive}\\SOFTWARE\\Policies\\Davenport`, '/v', 'DisableUpdates'], { windowsHide: true }, (err, out) =>
        resolve(!err && /DisableUpdates\s+REG_DWORD\s+0x0*1\b/i.test(out))
      )
    );
  policyOff = (await read('HKLM')) || (await read('HKCU'));
  return policyOff;
}

type Updater = typeof import('electron-updater').autoUpdater;
let updater: Updater | null = null;

async function getUpdater(): Promise<Updater> {
  if (updater) return updater;
  const { autoUpdater } = await import('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;
  autoUpdater.on('update-available', (info) => set({ status: 'available', latest: info.version, notes: notesText(info.releaseNotes), error: undefined }));
  autoUpdater.on('update-not-available', () => set({ status: 'current', checkedAt: Date.now(), error: undefined }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', latest: info.version, percent: 100 }));
  autoUpdater.on('error', (e) => set({ status: 'error', error: friendly(e) }));
  updater = autoUpdater;
  return autoUpdater;
}

function notesText(notes: unknown): string | undefined {
  const raw = Array.isArray(notes) ? notes.map((n) => (n as { note?: string }).note ?? '').join('\n') : typeof notes === 'string' ? notes : '';
  const text = raw.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return text ? text.slice(0, 1500) : undefined;
}

function friendly(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::|network/i.test(m)) return "Davenport couldn't reach GitHub to check for updates.";
  if (/404|latest\.yml/i.test(m)) return "The latest release on GitHub doesn't have an installer for this computer yet.";
  return 'Checking for updates failed: ' + m.split('\n')[0];
}

/** Checks GitHub for a newer release. `manual` is a click on "Check for updates" (always allowed to report). */
export async function checkForUpdates(manual = false): Promise<UpdateState> {
  if (!app.isPackaged) return state;
  if (await updatesDisabledByPolicy()) {
    set({ status: 'managed' });
    return state;
  }
  if (!manual && !getSettings().autoUpdate) return state;
  if (isPortable()) {
    // Ask GitHub for the latest version number only, and point to the download.
    try {
      const r = await fetch('https://api.github.com/repos/LukeHarrison1990/davenport/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
      const j = (await r.json()) as { tag_name?: string; body?: string };
      const latest = (j.tag_name ?? '').replace(/^v/, '');
      if (latest && newer(latest, app.getVersion())) set({ status: 'available', latest, notes: j.body?.slice(0, 1500), portable: true });
      else set({ status: 'current', checkedAt: Date.now() });
    } catch (e) {
      set({ status: 'error', error: friendly(e) });
    }
    return state;
  }
  if (state.status === 'downloading' || state.status === 'ready') return state;
  set({ status: 'checking', error: undefined });
  try {
    await (await getUpdater()).checkForUpdates();
  } catch (e) {
    set({ status: 'error', error: friendly(e) });
  }
  return state;
}

export function newer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

/** Downloads the update the user agreed to. */
export async function downloadUpdate(): Promise<void> {
  if (state.portable) {
    const { shell } = await import('electron');
    await shell.openExternal(RELEASES + '/latest');
    return;
  }
  set({ status: 'downloading', percent: 0 });
  try {
    await (await getUpdater()).downloadUpdate();
  } catch (e) {
    set({ status: 'error', error: friendly(e) });
  }
}

/** Closes Davenport, installs the downloaded update and starts the new version. */
export async function installUpdate(): Promise<void> {
  if (state.status !== 'ready') return;
  const { setQuitting } = await import('./windows');
  setQuitting();
  // Silent install that keeps the existing choices (per-user or per-machine, folder), then reopens Davenport.
  (await getUpdater()).quitAndInstall(true, true);
}

export function startUpdateChecks(): void {
  if (!app.isPackaged || timer) return;
  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS);
  timer = setInterval(() => void checkForUpdates(), EVERY_MS);
}
