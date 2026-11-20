// Draggable dividers between panes. Sizes are remembered per window in localStorage.
import { useCallback, useState } from 'react';

/** A pane size in pixels that persists between sessions. */
export function usePaneSize(key: string, initial: number): [number, (n: number) => void, () => void] {
  const [size, setSize] = useState(() => {
    try {
      const v = Number(localStorage.getItem(key));
      return v > 0 ? v : initial;
    } catch {
      return initial;
    }
  });
  const persist = useCallback(() => {
    setSize((s) => {
      try {
        localStorage.setItem(key, String(Math.round(s)));
      } catch {
        /* not essential */
      }
      return s;
    });
  }, [key]);
  return [size, setSize, persist];
}

interface Props {
  /** 'x' resizes widths (a vertical bar), 'y' resizes heights (a horizontal bar). */
  dir: 'x' | 'y';
  size: number;
  setSize: (n: number) => void;
  onCommit: () => void;
  min: number;
  max: number | (() => number);
  /** Size to return to on double-click. */
  reset: number;
  /** For a pane on the right/bottom of the bar: dragging towards it makes it smaller. */
  invert?: boolean;
  label: string;
}

export function Splitter({ dir, size, setSize, onCommit, min, max, reset, invert, label }: Props) {
  const clamp = (n: number) => {
    const hi = Math.max(min, typeof max === 'function' ? max() : max);
    return Math.round(Math.min(hi, Math.max(min, n)));
  };
  const sign = invert ? -1 : 1;
  const step = 16;
  return (
    <div
      className={'splitter ' + dir}
      role="separator"
      aria-orientation={dir === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(size)}
      aria-valuemin={min}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onDoubleClick={() => {
        setSize(clamp(reset));
        onCommit();
      }}
      onKeyDown={(e) => {
        const less = dir === 'x' ? 'ArrowLeft' : 'ArrowUp';
        const more = dir === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (e.key !== less && e.key !== more) return;
        e.preventDefault();
        setSize(clamp(size + (e.key === more ? step : -step) * sign));
        onCommit();
      }}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const start = dir === 'x' ? e.clientX : e.clientY;
        const startSize = size;
        const el = e.currentTarget;
        el.classList.add('dragging');
        // Iframes (message bodies) would swallow the mouse while dragging over them.
        document.body.classList.add('resizing', dir === 'x' ? 'resizing-x' : 'resizing-y');
        const move = (ev: MouseEvent) => setSize(clamp(startSize + ((dir === 'x' ? ev.clientX : ev.clientY) - start) * sign));
        const up = () => {
          el.classList.remove('dragging');
          document.body.classList.remove('resizing', 'resizing-x', 'resizing-y');
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          onCommit();
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      }}
    />
  );
}
