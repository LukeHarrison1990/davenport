// Notification-area (tray) icon with unread count, and the taskbar badge.
import { app, Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';
import { focusMain, getMainWindow, setQuitting } from './windows';
import { totalUnreadInbox } from './services/mailStore';

let tray: Tray | null = null;

export function createTray(onSync: () => void, onNewMail: () => void): void {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', process.platform === 'win32' ? 'icon.ico' : 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Davenport');
  tray.on('click', focusMain);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Davenport', click: focusMain },
      { label: 'New email', click: onNewMail },
      { label: 'Send / Receive', click: onSync },
      { type: 'separator' },
      {
        label: 'Quit Davenport',
        click: () => {
          setQuitting();
          app.quit();
        }
      }
    ])
  );
  updateBadge();
}

export function updateBadge(): void {
  let n = 0;
  try {
    n = totalUnreadInbox();
  } catch {
    return;
  }
  tray?.setToolTip(n ? `Davenport — ${n} unread` : 'Davenport');
  if (process.platform === 'darwin' || process.platform === 'linux') app.setBadgeCount(n);
  const win = getMainWindow();
  if (process.platform === 'win32' && win) {
    if (n > 0) {
      const label = n > 99 ? '99+' : String(n);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="#9A7740"/><text x="16" y="21" font-family="Segoe UI,Arial" font-size="${label.length > 2 ? 11 : 15}" font-weight="700" fill="#fff" text-anchor="middle">${label}</text></svg>`;
      const img = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
      win.setOverlayIcon(img, `${n} unread`);
    } else win.setOverlayIcon(null, '');
  }
}
