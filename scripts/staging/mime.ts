/**
 * A small, dependency-free reader for the raw MIME messages SES stores in
 * staging's test-mail bucket (scripts/staging/mail.ts). It handles what
 * VettID's and SES's own mail use: single-part and nested multipart
 * messages, base64 / quoted-printable / 7bit / 8bit bodies, charsets,
 * RFC 2047 encoded headers. Not a general mail parser: attachments are
 * skipped, and only the first text/plain and text/html parts are kept.
 */

export interface ParsedMail {
  /** The decoded From header, e.g. `VettID <no-reply@staging.vettid.org>`. */
  from: string;
  /** Addresses in To, Cc and Delivered-To / X-Original-To, lowercase. */
  to: string[];
  subject: string;
  date: string;
  /** Plain text: the text/plain part, or the HTML part converted to text. */
  text: string;
  html?: string;
  /** Every http(s) link in the text and the HTML (hrefs), in order, unique. */
  links: string[];
}

type Headers = Map<string, string[]>;

interface Part {
  headers: Headers;
  /** The body as a binary string (one char per byte). */
  body: string;
}

/** Splits headers from body and unfolds header lines. Input: binary string. */
function splitPart(raw: string): Part {
  const s = raw.replace(/\r\n/g, '\n');
  const sep = s.indexOf('\n\n');
  const head = sep < 0 ? s : s.slice(0, sep);
  const body = sep < 0 ? '' : s.slice(sep + 2);
  const headers: Headers = new Map();
  for (const line of head.replace(/\n[ \t]+/g, ' ').split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    const list = headers.get(name) ?? [];
    list.push(line.slice(i + 1).trim());
    headers.set(name, list);
  }
  return { headers, body };
}

const header = (h: Headers, name: string): string => h.get(name)?.[0] ?? '';

/** `type/subtype; a=b; c="d"` → { type, params } (names lowercase). */
export function parseContentType(value: string): { type: string; params: Record<string, string> } {
  const [type = '', ...rest] = value.split(';');
  const params: Record<string, string> = {};
  const re = /\s*([^=\s;]+)\s*=\s*("((?:[^"\\]|\\.)*)"|[^;]*)/g;
  const tail = rest.join(';');
  let m: RegExpExecArray | null;
  while ((m = re.exec(tail))) params[m[1].toLowerCase()] = m[3] !== undefined ? m[3].replace(/\\(.)/g, '$1') : m[2].trim();
  return { type: type.trim().toLowerCase() || 'text/plain', params };
}

function bytes(binary: string): Uint8Array {
  return Uint8Array.from(Buffer.from(binary, 'latin1'));
}

function decodeCharset(data: Uint8Array, charset: string | undefined): string {
  const cs = (charset ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(cs === 'us-ascii' ? 'utf-8' : cs).decode(data);
  } catch {
    return new TextDecoder('utf-8').decode(data);
  }
}

/** Quoted-printable → binary string. */
export function decodeQuotedPrintable(s: string): string {
  return s.replace(/[ \t]+$/gm, '').replace(/=\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function decodeTransfer(body: string, encoding: string): string {
  switch (encoding.trim().toLowerCase()) {
    case 'base64':
      return Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64').toString('latin1');
    case 'quoted-printable':
      return decodeQuotedPrintable(body);
    default:
      return body;
  }
}

/** RFC 2047 encoded words (`=?utf-8?Q?...?=`, `=?utf-8?B?...?=`) in a header value. */
export function decodeHeader(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, '$1')
    .replace(/=\?([^?*]+)(?:\*[^?]*)?\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, enc: string, text: string) => {
      const bin = enc.toUpperCase() === 'B'
        ? Buffer.from(text, 'base64').toString('latin1')
        : text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
      return decodeCharset(bytes(bin), charset);
    });
}

/** Lowercase addresses in a header value. */
export function addresses(value: string): string[] {
  return [...value.matchAll(/[A-Za-z0-9._%+\-=']+@[A-Za-z0-9.\-]+[A-Za-z0-9]/g)].map((m) => m[0].toLowerCase());
}

/** The first text/plain and text/html leaves, depth first; attachments skipped. */
function leaves(part: Part, out: { text?: string; html?: string }, depth = 0): void {
  if (depth > 10) return;
  const ct = parseContentType(header(part.headers, 'content-type'));
  if (ct.type.startsWith('multipart/')) {
    const boundary = ct.params.boundary;
    if (!boundary) return;
    const delim = `--${boundary}`;
    const chunks = ('\n' + part.body).split(`\n${delim}`);
    // chunks[0] is the preamble; a chunk starting with "--" is the close delimiter.
    for (const chunk of chunks.slice(1)) {
      if (chunk.startsWith('--')) break;
      leaves(splitPart(chunk.replace(/^[ \t]*\n/, '')), out, depth + 1);
    }
    return;
  }
  if (/^attachment/i.test(header(part.headers, 'content-disposition'))) return;
  if (ct.type === 'message/rfc822') return;
  if (ct.type !== 'text/plain' && ct.type !== 'text/html') return;
  const key = ct.type === 'text/plain' ? 'text' : 'html';
  if (out[key] !== undefined) return;
  const binary = decodeTransfer(part.body, header(part.headers, 'content-transfer-encoding') || '7bit');
  out[key] = decodeCharset(bytes(binary), ct.params.charset);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi, (_, _q: string, href: string, label: string) => `${label} (${href})`)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|table)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Trims punctuation that ends a sentence rather than the URL. */
function trimUrl(u: string): string {
  let url = u.replace(/[.,;:!?'"]+$/, '');
  while (/[)\]}>]$/.test(url)) {
    const close = url.slice(-1);
    const open = ({ ')': '(', ']': '[', '}': '{', '>': '<' } as Record<string, string>)[close];
    if (url.split(open).length >= url.split(close).length) break;
    url = url.slice(0, -1).replace(/[.,;:!?'"]+$/, '');
  }
  return url;
}

export function extractLinks(text: string, html?: string): string[] {
  const found: string[] = [];
  if (html) {
    for (const m of html.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)) {
      const href = decodeEntities(m[2]).trim();
      if (/^https?:\/\//i.test(href)) found.push(href);
    }
  }
  const plain = [text, html ? decodeEntities(html.replace(/<[^>]+>/g, ' ')) : ''].join('\n');
  for (const m of plain.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) found.push(trimUrl(m[0]));
  return [...new Set(found)];
}

/** Parses one raw message (as stored by SES: the bytes as received). */
export function parseMail(raw: Uint8Array | string): ParsedMail {
  const binary = typeof raw === 'string' ? Buffer.from(raw, 'utf8').toString('latin1') : Buffer.from(raw).toString('latin1');
  const top = splitPart(binary);
  const out: { text?: string; html?: string } = {};
  leaves(top, out);
  // Headers are ASCII or RFC 2047; raw UTF-8 (RFC 6532) is decoded too.
  const h = (name: string) => decodeHeader(decodeCharset(bytes(top.headers.get(name)?.join(', ') ?? ''), 'utf-8'));
  const to = [...new Set(['to', 'cc', 'delivered-to', 'x-original-to'].flatMap((n) => addresses(h(n))))];
  const text = out.text ?? (out.html !== undefined ? htmlToText(out.html) : '');
  return {
    from: h('from'),
    to,
    subject: h('subject'),
    date: h('date'),
    text: text.replace(/\r\n/g, '\n'),
    ...(out.html !== undefined ? { html: out.html } : {}),
    links: extractLinks(text, out.html),
  };
}
