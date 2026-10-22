// Small shared pieces: dialogs, avatars, toasts.
import { useEffect, useRef, type ReactNode } from 'react';
import { call } from '../api';
import { useApp } from '../state';
import { avatarColours, initials } from '../util';
import { Icon } from './Icon';

export function Dialog({ title, onClose, children, footer, wide, className }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector('input, select, textarea, button:not(.icon-btn)') as HTMLElement | null;
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'dialog' + (wide ? ' wide' : '') + (className ? ' ' + className : '')} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="content">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Avatar({ name, email, size = 32, photo }: { name: string; email?: string; size?: number; photo?: string }) {
  const [bg, fg] = avatarColours(email ?? name);
  return (
    <span className="av" style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.round(size * 0.36) }} aria-hidden>
      {photo ? <img src={photo} alt="" referrerPolicy="no-referrer" /> : initials(name)}
    </span>
  );
}

export function Toasts() {
  const { toasts, dropToast } = useApp();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.kind}>
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                dropToast(t.id);
                void runToastAction(t.action!.method, t.action!.args);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button aria-label="Dismiss" onClick={() => dropToast(t.id)} style={{ color: '#fff', opacity: 0.7 }}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Empty({ icon, title, text, children }: { icon: string; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={36} strokeWidth={1.2} />
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="hint-text">{hint}</span>}
    </label>
  );
}

async function runToastAction(method: string, args: unknown[]): Promise<void> {
  try {
    if (method === 'dav:undo-send') {
      const d = await call('mail.cancelSend', args[0] as string);
      if (d) await call('app.openWindow', 'compose', { draft: JSON.stringify({ ...d, sendAt: undefined }) });
      return;
    }
    await (call as (m: string, ...a: unknown[]) => Promise<unknown>)(method, ...args);
  } catch (e) {
    useApp.getState().pushToast({ id: String(Date.now()), kind: 'error', text: (e as Error).message });
  }
}
