// Dropdown and right-click menus.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Icon } from './Icon';

export type MenuEntry =
  | { label: string; icon?: string; hint?: string; onClick?: () => void; disabled?: boolean; submenu?: MenuEntry[]; checked?: boolean; danger?: boolean; colour?: string }
  | { sep: true }
  | { header: string };

interface MenuState {
  items: MenuEntry[] | null;
  x: number;
  y: number;
  stack: MenuEntry[][];
  open: (items: MenuEntry[], x: number, y: number) => void;
  close: () => void;
  push: (items: MenuEntry[]) => void;
  pop: () => void;
}

const useMenu = create<MenuState>((set, get) => ({
  items: null,
  x: 0,
  y: 0,
  stack: [],
  open: (items, x, y) => set({ items, x, y, stack: [] }),
  close: () => set({ items: null, stack: [] }),
  push: (items) => set({ stack: [...get().stack, get().items!], items }),
  pop: () => {
    const s = [...get().stack];
    const prev = s.pop();
    if (prev) set({ items: prev, stack: s });
  }
}));

export function openMenu(items: MenuEntry[], at: { x: number; y: number } | HTMLElement | EventTarget | null): void {
  let x = 100;
  let y = 100;
  if (at instanceof HTMLElement) {
    const r = at.getBoundingClientRect();
    x = r.left;
    y = r.bottom + 4;
  } else if (at && 'x' in (at as object)) {
    x = (at as { x: number }).x;
    y = (at as { y: number }).y;
  }
  useMenu.getState().open(items, x, y);
}

export function closeMenu(): void {
  useMenu.getState().close();
}

export function MenuHost() {
  const { items, x, y, close, push, pop, stack } = useMenu();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    if (!items || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      y: y + r.height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - r.height - 8) : y
    });
    (ref.current.querySelector('button:not(:disabled)') as HTMLButtonElement | null)?.focus();
  }, [items, x, y]);

  useEffect(() => {
    if (!items) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        stack.length ? pop() : close();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const btns = [...(ref.current?.querySelectorAll('button:not(:disabled)') ?? [])] as HTMLButtonElement[];
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
    };
  }, [items, stack.length, close, pop]);

  if (!items) return null;
  return (
    <div className="menu" role="menu" ref={ref} style={{ left: pos.x, top: pos.y }}>
      {stack.length > 0 && (
        <>
          <button className="menu-item" role="menuitem" onClick={pop}>
            <Icon name="chevLeft" /> Back
          </button>
          <div className="menu-sep" />
        </>
      )}
      {items.map((it, i) => {
        if ('sep' in it) return <div key={i} className="menu-sep" role="separator" />;
        if ('header' in it) return <div key={i} className="menu-label">{it.header}</div>;
        return (
          <button
            key={i}
            className="menu-item"
            role="menuitem"
            disabled={it.disabled}
            style={it.danger ? { color: 'var(--danger)' } : undefined}
            onClick={() => {
              if (it.submenu) return push(it.submenu);
              close();
              it.onClick?.();
            }}
          >
            {it.colour ? <span className="dot" style={{ background: it.colour, width: 12, height: 12, flexBasis: 12 }} /> : <span style={{ width: 16, display: 'inline-flex' }}>{it.checked ? <Icon name="check" /> : it.icon ? <Icon name={it.icon} /> : null}</span>}
            <span>{it.label}</span>
            {it.hint && <span className="hint">{it.hint}</span>}
            {it.submenu && <span className="hint"><Icon name="chevRight" size={14} /></span>}
          </button>
        );
      })}
    </div>
  );
}
