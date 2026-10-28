// Shared pieces for right-click menus across Mail, Calendar, People, Chat and Tasks.
import type React from 'react';
import { call } from '../api';
import { fail, notify } from '../state';
import { openMenu, type MenuEntry } from './Menu';

/** Copies text to the clipboard and confirms what was copied. */
export function copyText(text: string, what = 'Text'): void {
  void call('app.copyText', text).then(() => notify(`${what} copied`)).catch(fail);
}

/** "Copy" for whatever text is selected in the window, if any. */
export function selectionItems(): MenuEntry[] {
  const sel = window.getSelection();
  const text = sel && !sel.isCollapsed ? sel.toString() : '';
  return text.trim() ? [{ label: 'Copy', icon: 'copy', hint: 'Ctrl+C', onClick: () => copyText(text) }, { sep: true }] : [];
}

/** Drops separators at the start or end and any doubled up, so menus built from optional parts stay tidy. */
export function tidy(items: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const it of items) {
    if ('sep' in it && (!out.length || 'sep' in out[out.length - 1])) continue;
    out.push(it);
  }
  while (out.length && 'sep' in out[out.length - 1]) out.pop();
  return out;
}

/** An onContextMenu handler that shows a menu at the pointer (with Copy first when text is selected). */
export function contextMenu(build: () => MenuEntry[]): (e: React.MouseEvent) => void {
  return (e) => {
    const t = e.target as HTMLElement;
    // Text boxes keep the standard Cut / Copy / Paste menu.
    if (t.closest('input, textarea, [contenteditable="true"]')) return;
    const items = tidy([...selectionItems(), ...build()]);
    if (!items.length) return;
    e.preventDefault();
    e.stopPropagation();
    openMenu(items, { x: e.clientX, y: e.clientY });
  };
}
