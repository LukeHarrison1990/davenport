// A rich-text editor for composing mail and signatures (bold, lists, links, fonts, images, quotes).
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import DOMPurify from 'dompurify';
import { Icon } from './Icon';

export interface RichEditorHandle {
  focus: () => void;
  insertHtml: (html: string) => void;
  getHtml: () => string;
  setHtml: (html: string) => void;
}

const exec = (cmd: string, value?: string) => document.execCommand(cmd, false, value);

export const RichEditor = forwardRef<RichEditorHandle, { initialHtml: string; onChange: (html: string) => void; minHeight?: number; label?: string }>(
  function RichEditor({ initialHtml, onChange, minHeight = 220, label = 'Message body' }, ref) {
    const el = useRef<HTMLDivElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (el.current) el.current.innerHTML = DOMPurify.sanitize(initialHtml, { ADD_ATTR: ['target'] });
      // Only set once; the editor owns its content afterwards.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const emit = () => onChange(el.current?.innerHTML ?? '');

    useImperativeHandle(ref, () => ({
      focus: () => {
        el.current?.focus();
        const sel = window.getSelection();
        if (sel && el.current) {
          sel.selectAllChildren(el.current);
          sel.collapseToStart();
        }
      },
      insertHtml: (html: string) => {
        el.current?.focus();
        exec('insertHTML', DOMPurify.sanitize(html));
        emit();
      },
      getHtml: () => el.current?.innerHTML ?? '',
      setHtml: (html: string) => {
        if (el.current) el.current.innerHTML = DOMPurify.sanitize(html);
        emit();
      }
    }));

    const btn = (icon: string, title: string, fn: () => void) => (
      <button type="button" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={() => { fn(); emit(); }}>
        <Icon name={icon} />
      </button>
    );

    return (
      <>
        <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
          <select aria-label="Font" defaultValue="" onChange={(e) => { exec('fontName', e.target.value); emit(); }}>
            <option value="" disabled>Font</option>
            <option value="Segoe UI, Arial, sans-serif">Segoe UI</option>
            <option value="Calibri, Arial, sans-serif">Calibri</option>
            <option value="Arial, sans-serif">Arial</option>
            <option value="Georgia, serif">Georgia</option>
            <option value="Times New Roman, serif">Times New Roman</option>
            <option value="Consolas, monospace">Consolas</option>
          </select>
          <select aria-label="Size" defaultValue="" onChange={(e) => { exec('fontSize', e.target.value); emit(); }}>
            <option value="" disabled>Size</option>
            <option value="2">Small</option>
            <option value="3">Normal</option>
            <option value="4">Large</option>
            <option value="5">Larger</option>
          </select>
          {btn('bold', 'Bold (Ctrl+B)', () => exec('bold'))}
          {btn('italic', 'Italic (Ctrl+I)', () => exec('italic'))}
          {btn('underline', 'Underline (Ctrl+U)', () => exec('underline'))}
          <input type="color" aria-label="Text colour" title="Text colour" style={{ width: 30, height: 28, border: 0, background: 'transparent', padding: 2 }} onChange={(e) => { exec('foreColor', e.target.value); emit(); }} />
          {btn('bullets', 'Bulleted list', () => exec('insertUnorderedList'))}
          {btn('numbers', 'Numbered list', () => exec('insertOrderedList'))}
          {btn('outdent', 'Decrease indent', () => exec('outdent'))}
          {btn('indent', 'Increase indent', () => exec('indent'))}
          {btn('link', 'Insert link (Ctrl+K)', () => {
            const url = window.prompt('Link address', 'https://');
            if (url) exec('createLink', url);
          })}
          {btn('image', 'Insert picture', () => fileRef.current?.click())}
          {btn('clear', 'Clear formatting', () => exec('removeFormat'))}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const r = new FileReader();
              r.onload = () => {
                el.current?.focus();
                exec('insertHTML', `<img src="${r.result}" style="max-width:100%" alt="">`);
                emit();
              };
              r.readAsDataURL(f);
              e.target.value = '';
            }}
          />
        </div>
        <div
          ref={el}
          className="editor"
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          spellCheck
          style={{ minHeight }}
          onInput={emit}
          onPaste={(e) => {
            const html = e.clipboardData.getData('text/html');
            if (html) {
              e.preventDefault();
              exec('insertHTML', DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'meta', 'link'], FORBID_ATTR: ['class'] }));
              emit();
            }
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
              e.preventDefault();
              const url = window.prompt('Link address', 'https://');
              if (url) exec('createLink', url);
              emit();
            }
          }}
        />
      </>
    );
  }
);
