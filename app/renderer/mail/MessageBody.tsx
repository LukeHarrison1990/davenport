// Renders an email safely: sanitised HTML in a sandboxed frame with no scripts, remote images blocked until allowed.
import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { call } from '../api';
import { closeMenu } from '../components/Menu';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function linkify(text: string): string {
  return esc(text).replace(/(https?:\/\/[^\s<]+[^\s<.,;:)\]'"])/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>');
}

export function prepareHtml(html: string | undefined, text: string | undefined, allowRemote: boolean): { doc: string; blocked: number } {
  let blocked = 0;
  const source = html ?? `<div style="white-space:normal">${linkify(text ?? '')}</div>`;
  const clean = DOMPurify.sanitize(source, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'meta', 'base', 'link'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'srcset'],
    ADD_ATTR: ['target'],
    ALLOW_UNKNOWN_PROTOCOLS: false
  });
  const tmpl = document.createElement('html');
  tmpl.innerHTML = clean;
  tmpl.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    if (/^https?:/i.test(src) && !allowRemote) {
      img.setAttribute('data-blocked-src', src);
      img.removeAttribute('src');
      blocked++;
    }
  });
  tmpl.querySelectorAll('[style*="url("]').forEach((el) => {
    if (!allowRemote) {
      el.setAttribute('style', (el.getAttribute('style') ?? '').replace(/url\((['"]?)https?:[^)]+\)/gi, 'none'));
    }
  });
  tmpl.querySelectorAll('a').forEach((a) => a.setAttribute('target', '_blank'));
  const csp = `default-src 'none'; img-src data: ${allowRemote ? 'https: http:' : ''}; style-src 'unsafe-inline'; font-src data:`;
  const base = `<meta http-equiv="Content-Security-Policy" content="${csp}"><meta charset="utf-8">
  <style>html,body{margin:0;padding:0;background:#fff;color:#1B1F24}body{padding:2px 4px;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.55;word-wrap:break-word;overflow-wrap:anywhere}
  img{max-width:100%;height:auto}pre{white-space:pre-wrap}blockquote{margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex}a{color:#1F5FAD}
  table{max-width:100%}</style>`;
  const head = tmpl.querySelector('head');
  return { doc: `<!doctype html><html><head>${base}${head?.innerHTML ?? ''}</head><body>${tmpl.querySelector('body')?.innerHTML ?? ''}</body></html>`, blocked };
}

/** What was right-clicked inside a message body. */
export interface BodyContext {
  x: number;
  y: number;
  selection: string;
  link?: string;
  image?: string;
  selectAll: () => void;
}

export function MessageBody({ html, text, allowRemote, onBlocked, onContextMenu }: { html?: string; text?: string; allowRemote: boolean; onBlocked?: (n: number) => void; onContextMenu?: (c: BodyContext) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const menuRef = useRef(onContextMenu);
  menuRef.current = onContextMenu;
  const [height, setHeight] = useState(120);
  const prepared = useMemo(() => prepareHtml(html, text, allowRemote), [html, text, allowRemote]);

  useEffect(() => onBlocked?.(prepared.blocked), [prepared.blocked, onBlocked]);

  useEffect(() => {
    const f = frame.current;
    if (!f) return;
    let ro: ResizeObserver | null = null;
    const onLoad = () => {
      const doc = f.contentDocument;
      if (!doc) return;
      const measure = () => setHeight(Math.max(60, doc.documentElement.scrollHeight + 4));
      measure();
      ro = new ResizeObserver(measure);
      ro.observe(doc.body);
      // Clicks inside the frame don't reach the window, so close any open menu from here.
      doc.addEventListener('mousedown', (e) => {
        if (e.button === 0) closeMenu();
      });
      // The message sits in its own frame, so its right-clicks are passed up to the reading pane's menu.
      doc.addEventListener('contextmenu', (e) => {
        if (!menuRef.current) return;
        e.preventDefault();
        const r = f.getBoundingClientRect();
        const t = e.target as Element;
        const a = t.closest?.('a');
        const img = t.closest?.('img');
        menuRef.current({
          x: r.left + e.clientX,
          y: r.top + e.clientY,
          selection: doc.getSelection()?.toString() ?? '',
          link: a?.getAttribute('href') ?? undefined,
          image: img?.getAttribute('src') || undefined,
          selectAll: () => {
            const range = doc.createRange();
            range.selectNodeContents(doc.body);
            const sel = doc.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
        });
      });
      doc.addEventListener('click', (e) => {
        const a = (e.target as HTMLElement).closest('a');
        if (a) {
          e.preventDefault();
          const href = a.getAttribute('href') ?? '';
          if (/^(https?|mailto):/i.test(href)) void call('app.openExternal', href);
          else if (href.startsWith('#')) doc.getElementById(href.slice(1))?.scrollIntoView();
        }
      });
    };
    f.addEventListener('load', onLoad);
    return () => {
      f.removeEventListener('load', onLoad);
      ro?.disconnect();
    };
  }, [prepared.doc]);

  return <iframe ref={frame} className="message-frame" title="Message" sandbox="allow-same-origin" srcDoc={prepared.doc} style={{ height }} />;
}
