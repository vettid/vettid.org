import { createHash } from 'node:crypto';
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';

/**
 * Membership terms are authored as plain text; the text is the source of
 * truth (its SHA-256 identifies the version a member accepts) and the PDF is
 * a rendering of it. Paragraphs are separated by blank lines; single line
 * breaks inside a paragraph are kept.
 */

/** Canonical form, so the same words always hash the same. */
export function normalizeTermsText(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ')
    .split('\n')
    .map((l) => l.replace(/\s+$/u, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

/**
 * Characters the standard PDF font can't draw (it covers Latin-1 plus common
 * punctuation such as curly quotes and dashes). Legal text must not be
 * silently altered, so callers reject rather than substitute.
 */
export function unsupportedChars(text: string, font: PDFFont): string[] {
  const bad = new Set<string>();
  for (const ch of new Set(text.replace(/\n/g, ''))) {
    try {
      font.encodeText(ch);
    } catch {
      bad.add(ch);
    }
  }
  return [...bad];
}

export async function checkTermsText(text: string): Promise<string[]> {
  const doc = await PDFDocument.create();
  return unsupportedChars(text, await doc.embedFont(StandardFonts.Helvetica));
}

const PAGE = { w: 612, h: 792, margin: 72 }; // US Letter, 1" margins
const BODY = { size: 10.5, leading: 15, paraGap: 8 };

function wrap(line: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of line.split(/ +/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      cur = next;
      continue;
    }
    if (cur) out.push(cur);
    // A single word wider than the line (e.g. a long URL): hard-break it.
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > width) {
      let i = rest.length - 1;
      while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > width) i--;
      out.push(rest.slice(0, i));
      rest = rest.slice(i);
    }
    cur = rest;
  }
  out.push(cur);
  return out;
}

export async function renderTermsPdf(opts: {
  title: string;
  versionId: string;
  text: string; // already normalized
  textSha256: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(opts.title);
  doc.setSubject(`VettID membership terms, version ${opts.versionId}`);
  doc.setCreator('VettID admin');
  doc.setProducer('VettID');

  const width = PAGE.w - 2 * PAGE.margin;
  const bottom = PAGE.margin + 24; // room for the footer
  let page = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.margin;

  const ensure = (h: number) => {
    if (y - h < bottom) {
      page = doc.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - PAGE.margin;
    }
  };

  for (const l of wrap(opts.title, bold, 16, width)) {
    ensure(22);
    page.drawText(l, { x: PAGE.margin, y: y - 16, size: 16, font: bold });
    y -= 22;
  }
  page.drawText(`Version ${opts.versionId}`, { x: PAGE.margin, y: y - 9, size: 9, font: regular, color: rgb(0.35, 0.35, 0.4) });
  y -= 9 + 20;

  for (const para of opts.text.split('\n\n')) {
    const lines = para.split('\n').flatMap((l) => wrap(l, regular, BODY.size, width));
    for (const l of lines) {
      ensure(BODY.leading);
      page.drawText(l, { x: PAGE.margin, y: y - BODY.size, size: BODY.size, font: regular });
      y -= BODY.leading;
    }
    y -= BODY.paraGap;
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const footer = `VettID membership terms · version ${opts.versionId} · text SHA-256 ${opts.textSha256.slice(0, 16)}… · page ${i + 1} of ${pages.length}`;
    p.drawText(footer, { x: PAGE.margin, y: PAGE.margin - 12, size: 7.5, font: regular, color: rgb(0.4, 0.4, 0.45) });
  });

  return doc.save();
}
