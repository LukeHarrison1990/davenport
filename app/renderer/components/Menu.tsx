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
  open: (items: MenuEntry[], x: number, y: number) => void;
  close: () => void;
}

const useMenu = create<MenuState>((set) => ({
  items: null,
  x: 0,
  y: 0,
  open: (items, x, y) => set({ items, x, y }),
  close: () => set({ items: null })
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

/** An open submenu: which item at that level opened it, and where that item is on screen. */
interface Open {
  index: number;
  rect: DOMRect;
}

const HOVER_DELAY = 200; // ms, like Windows: long enough to cross other items on the way to a submenu

const enabledButtons = (panel: Element | null) => [...(panel?.querySelectorAll(':scope > button.menu-item:not(:disabled)') ?? [])] as HTMLButtonElement[];

/** Right-click and dropdown menus, with submenus that open beside their parent on hover, like Windows. */
export function MenuHost() {
  const { items, x, y, close } = useMenu();
  const root = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState<Open[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusLevel = useRef<number | null>(null);

  useEffect(() => {
    setPath([]);
    focusLevel.current = 0;
  }, [items]);

  // The panels to show: the root menu, then each open submenu.
  const levels: MenuEntry[][] = [];
  if (items) {
    levels.push(items);
    for (const o of path) {
      const it = levels[levels.length - 1][o.index];
      if (!it || !('label' in it) || !it.submenu) break;
      levels.push(it.submenu);
    }
  }

  const cancelTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const openAt = (level: number, index: number, el: HTMLElement, focus = false) => {
    cancelTimer();
    focusLevel.current = focus ? level + 1 : null;
    setPath((p) => [...p.slice(0, level), { index, rect: el.getBoundingClientRect() }]);
  };
  const closeFrom = (level: number) => {
    cancelTimer();
    setPath((p) => (p.length > level ? p.slice(0, level) : p));
  };

  useEffect(() => {
    if (!items) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const panel = active?.closest('.menu') ?? null;
      const level = Number(panel?.getAttribute('data-level') ?? 0);
      if (e.key === 'Escape' || (e.key === 'ArrowLeft' && level > 0)) {
        e.preventDefault();
        e.stopPropagation();
        if (level > 0) {
          // Back to the item that opened this submenu.
          const parent = root.current?.querySelector(`.menu[data-level="${level - 1}"] button.menu-item.open`) as HTMLButtonElement | null;
          closeFrom(level - 1);
          parent?.focus();
        } else close();
        return;
      }
      if (e.key === 'ArrowRight' && active?.classList.contains('has-sub')) {
        e.preventDefault();
        openAt(level, Number(active.dataset.index), active, true);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const btns = enabledButtons(panel ?? root.current?.querySelector('.menu[data-level="0"]') ?? null);
        if (!btns.length) return;
        const i = btns.indexOf(active as HTMLButtonElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length;
        btns[next].focus();
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
      cancelTimer();
    };
  }, [items, close]);

  if (!items) return null;
  return (
    <div ref={root} style={{ display: 'contents' }}>
      {levels.map((list, level) => (
        <MenuPanel
          key={level}
          level={level}
          items={list}
          anchor={level === 0 ? { x, y } : path[level - 1].rect}
          openIndex={path[level]?.index}
          focusFirst={focusLevel.current === level}
          onFocused={() => (focusLevel.current = null)}
          onPanelEnter={cancelTimer}
          onHover={(index, el, hasSub) => {
            cancelTimer();
            if (path[level]?.index === index) return;
            timer.current = setTimeout(() => (hasSub ? openAt(level, index, el) : closeFrom(level)), HOVER_DELAY);
          }}
          onChoose={(it, index, el) => {
            if (it.submenu) return openAt(level, index, el, true);
            close();
            it.onClick?.();
          }}
        />
      ))}
    </div>
  );
}

type Item = Extract<MenuEntry, { label: string }>;

function MenuPanel({ level, items, anchor, openIndex, focusFirst, onFocused, onPanelEnter, onHover, onChoose }: {
  level: number;
  items: MenuEntry[];
  anchor: { x: number; y: number } | DOMRect;
  openIndex?: number;
  focusFirst: boolean;
  onFocused: () => void;
  onPanelEnter: () => void;
  onHover: (index: number, el: HTMLElement, hasSub: boolean) => void;
  onChoose: (it: Item, index: number, el: HTMLElement) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const anchorKey = anchor instanceof DOMRect ? `${anchor.left},${anchor.top},${anchor.right}` : `${anchor.x},${anchor.y}`;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;
    let nx: number;
    let ny: number;
    if (anchor instanceof DOMRect) {
      // Beside the item that opened it; flip to the left if there's no room on the right.
      nx = anchor.right + r.width + 4 <= W ? anchor.right - 2 : Math.max(8, anchor.left - r.width + 2);
      ny = anchor.top - 5;
    } else {
      nx = Math.min(anchor.x, W - r.width - 8);
      ny = anchor.y;
    }
    if (ny + r.height > H - 8) ny = Math.max(8, H - r.height - 8);
    setPos({ x: Math.max(8, nx), y: ny });
    // Re-measure only when the anchor actually moves (the root's {x, y} is a fresh object each render).
  }, [anchorKey, items]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pos || !focusFirst) return;
    enabledButtons(ref.current)[0]?.focus();
    onFocused();
  }, [pos, focusFirst]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="menu"
      role="menu"
      data-level={level}
      ref={ref}
      style={pos ? { left: pos.x, top: pos.y } : { left: -9999, top: -9999 }}
      onMouseEnter={onPanelEnter}
    >
      {items.map((it, i) => {
        if ('sep' in it) return <div key={i} className="menu-sep" role="separator" />;
        if ('header' in it) return <div key={i} className="menu-label">{it.header}</div>;
        const hasSub = !!it.submenu;
        return (
          <button
            key={i}
            className={'menu-item' + (hasSub ? ' has-sub' : '') + (openIndex === i ? ' open' : '')}
            role="menuitem"
            data-index={i}
            aria-haspopup={hasSub ? 'menu' : undefined}
            aria-expanded={hasSub ? openIndex === i : undefined}
            disabled={it.disabled}
            style={it.danger ? { color: 'var(--danger)' } : undefined}
            onMouseEnter={(e) => onHover(i, e.currentTarget, hasSub)}
            onClick={(e) => onChoose(it, i, e.currentTarget)}
          >
            {it.colour ? <span className="dot" style={{ background: it.colour, width: 12, height: 12, flexBasis: 12 }} /> : <span style={{ width: 16, display: 'inline-flex' }}>{it.checked ? <Icon name="check" /> : it.icon ? <Icon name={it.icon} /> : null}</span>}
            <span>{it.label}</span>
            {it.hint && <span className="hint">{it.hint}</span>}
            {hasSub && <span className="hint"><Icon name="chevRight" size={14} /></span>}
          </button>
        );
      })}
    </div>
  );
}
