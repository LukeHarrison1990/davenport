// mailto: links, as Windows hands them to Davenport when it's the default email app.

export interface MailtoParts {
  to: string[];
  cc: string[];
  bcc: string[];
  subject?: string;
  body?: string;
}

/** Reads a mailto: link (RFC 6068): several addresses, cc, bcc, subject and body. Attachment parameters are ignored. */
export function parseMailto(url: string): MailtoParts {
  const rest = url.replace(/^mailto:/i, '');
  const q = rest.indexOf('?');
  const split = (v: string | null | undefined) =>
    (v ?? '').split(/[,;]/).map((x) => decodeURIComponent(x).trim()).filter((x) => /^[^\s@<>]+@[^\s@<>]+$/.test(x));
  const parts: MailtoParts = { to: split(q >= 0 ? rest.slice(0, q) : rest), cc: [], bcc: [] };
  for (const pair of (q >= 0 ? rest.slice(q + 1) : '').split('&')) {
    const [k, ...v] = pair.split('=');
    const value = v.join('=');
    let decoded = '';
    try {
      decoded = decodeURIComponent(value.replace(/\+/g, '%20'));
    } catch {
      continue;
    }
    switch (k.toLowerCase()) {
      case 'to': parts.to.push(...split(value)); break;
      case 'cc': parts.cc.push(...split(value)); break;
      case 'bcc': parts.bcc.push(...split(value)); break;
      case 'subject': parts.subject = decoded.replace(/[\r\n]+/g, ' '); break;
      case 'body': parts.body = decoded; break;
    }
  }
  return parts;
}
