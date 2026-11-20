// Recipient field with chips and address-book autocomplete (contacts, directory and recent senders).
import { useEffect, useRef, useState } from 'react';
import type { Addr, Contact } from '../../shared/types';
import { call } from '../api';
import { addrFull, isValidEmail, parseRecipients } from '../util';
import { Avatar } from './ui';

export function AddressInput({ value, onChange, label, id, autoFocus }: { value: Addr[]; onChange: (v: Addr[]) => void; label: string; id: string; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const [sugg, setSugg] = useState<Contact[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (text.trim().length < 1) {
      setSugg([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      call('people.search', text.trim(), 8).then((r) => {
        if (live) {
          setSugg(r.filter((c) => c.emails.length && !value.some((v) => v.email.toLowerCase() === c.emails[0].toLowerCase())));
          setActive(0);
        }
      });
    }, 90);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text, value]);

  const commit = (raw?: string) => {
    const s = (raw ?? text).trim();
    if (!s) return false;
    const parsed = parseRecipients(s);
    const add = parsed.length ? parsed : [{ email: s }];
    onChange([...value, ...add.filter((a) => !value.some((v) => v.email.toLowerCase() === a.email.toLowerCase()))]);
    setText('');
    setSugg([]);
    return true;
  };
  const pick = (c: Contact) => {
    onChange([...value, { name: c.name, email: c.emails[0] }]);
    setText('');
    setSugg([]);
    input.current?.focus();
  };

  return (
    <div className="addr-input" onClick={() => input.current?.focus()}>
      {value.map((a, i) => (
        <span key={a.email + i} className={'addr-chip' + (isValidEmail(a.email) ? '' : ' invalid')} title={addrFull(a)}>
          <span>{a.name || a.email}</span>
          <button type="button" aria-label={`Remove ${a.name || a.email}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            ×
          </button>
        </span>
      ))}
      <input
        ref={input}
        id={id}
        aria-label={label}
        autoFocus={autoFocus}
        value={text}
        autoComplete="off"
        onChange={(e) => {
          const v = e.target.value;
          if (/[;,]\s*$/.test(v) && v.trim().length > 1) commit(v.replace(/[;,]\s*$/, ''));
          else setText(v);
        }}
        onPaste={(e) => {
          const t = e.clipboardData.getData('text');
          if (/[;,\n]/.test(t) || /<.+@.+>/.test(t)) {
            e.preventDefault();
            commit(t);
          }
        }}
        onKeyDown={(e) => {
          if (sugg.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + sugg.length) % sugg.length);
          } else if ((e.key === 'Enter' || e.key === 'Tab') && sugg.length && text) {
            e.preventDefault();
            pick(sugg[active]);
          } else if ((e.key === 'Enter' || e.key === 'Tab') && text) {
            if (commit()) e.preventDefault();
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1));
          } else if (e.key === 'Escape' && sugg.length) {
            e.stopPropagation();
            setSugg([]);
          }
        }}
        onBlur={() => setTimeout(() => {
          if (text) commit();
          setSugg([]);
        }, 150)}
      />
      {sugg.length > 0 && (
        <div className="menu suggest" style={{ position: 'absolute' }} role="listbox">
          {sugg.map((c, i) => (
            <button
              key={c.id + c.emails[0]}
              type="button"
              role="option"
              aria-selected={i === active}
              className="menu-item"
              style={i === active ? { background: 'var(--accent-tint)' } : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
            >
              <Avatar name={c.name} email={c.emails[0]} size={26} photo={c.photoUrl} />
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span>{c.name}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{c.emails[0]}{c.source === 'directory' ? ' · Directory' : ''}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
