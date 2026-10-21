// Window management: the main window plus pop-out compose, event and message windows.
import { app, BrowserWindow, Menu, screen, shell } from 'electron';
import path from 'node:path';
import { kvGet, kvSet } from './db';
import { getSettings } from './settings';

let mainWindow: BrowserWindow | null = null;
const windowParams = new Map<number, Record<string, string>>();
export let quitting = false;
export const setQuitting = () => {
  quitting = true;
};

const isDev = () => !!process.env.DAVENPORT_DEV_URL;

function iconPath(): string {
  return path.join(__dirname, '..', 'renderer', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}

function load(win: BrowserWindow, hash = ''): void {
  if (isDev()) void win.loadURL(process.env.DAVENPORT_DEV_URL + '/#' + hash);
  else void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { hash });
}

function secure(win: BrowserWindow): void {
  // Links never navigate the app; they open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault();
      if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    }
  });
}

const webPreferences = () => ({
  preload: path.join(__dirname, '..', 'preload', 'index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: true
});

export function createMainWindow(): BrowserWindow {
  const saved = kvGet<{ x?: number; y?: number; width: number; height: number; maximised: boolean }>('window', 'main');
  const area = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: saved?.width ?? Math.min(1480, area.width),
    height: saved?.height ?? Math.min(940, area.height),
    x: saved?.x,
    y: saved?.y,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'Davenport',
    backgroundColor: '#EEF0F3',
    icon: iconPath(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'win32' || process.platform === 'linux' ? { color: '#1F3A5F', symbolColor: '#FFFFFF', height: 44 } : undefined,
    webPreferences: webPreferences()
  });
  if (process.platform === 'win32') mainWindow.setBackgroundMaterial?.('mica');
  secure(mainWindow);
  load(mainWindow);
  mainWindow.once('ready-to-show', () => {
    if (saved?.maximised) mainWindow!.maximize();
    if (!process.argv.includes('--hidden')) mainWindow!.show();
  });
  const persist = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
    const b = mainWindow.getNormalBounds();
    kvSet('window', 'main', { ...b, maximised: mainWindow.isMaximized() });
  };
  mainWindow.on('resize', persist);
  mainWindow.on('move', persist);
  mainWindow.on('close', (e) => {
    persist();
    if (!quitting && getSettings().closeToTray && process.platform !== 'darwin') {
      e.preventDefault();
      mainWindow!.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function focusMain(): void {
  if (!mainWindow) createMainWindow();
  if (mainWindow!.isMinimized()) mainWindow!.restore();
  mainWindow!.show();
  mainWindow!.focus();
}

export function setTitleBarColour(color: string, dark: boolean): void {
  if (mainWindow && (process.platform === 'win32' || process.platform === 'linux')) {
    try {
      mainWindow.setTitleBarOverlay({ color: dark ? '#141A22' : color, symbolColor: '#FFFFFF', height: 44 });
    } catch {
      /* not supported on this platform */
    }
  }
}

export function openChildWindow(kind: 'compose' | 'event' | 'message', params: Record<string, string>): void {
  const sizes = { compose: [860, 720], event: [940, 760], message: [900, 760] } as const;
  const [w, h] = sizes[kind];
  const win = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 600,
    minHeight: 480,
    title: kind === 'compose' ? 'New message' : kind === 'event' ? 'Event' : 'Message',
    backgroundColor: '#FFFFFF',
    icon: iconPath(),
    show: false,
    autoHideMenuBar: true,
    webPreferences: webPreferences()
  });
  const contentsId = win.webContents.id;
  windowParams.set(contentsId, params);
  secure(win);
  load(win, '/' + kind);
  win.once('ready-to-show', () => win.show());
  // The window's webContents is destroyed by the time 'closed' fires, so use the id captured above.
  win.on('closed', () => windowParams.delete(contentsId));
}

export function paramsFor(webContentsId: number): Record<string, string> {
  return windowParams.get(webContentsId) ?? {};
}

export function buildMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' }
    ])
  );
}

export function dev(): boolean {
  return isDev() || !app.isPackaged;
}
