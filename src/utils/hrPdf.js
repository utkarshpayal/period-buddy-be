// PDF work for HR documents (pdf-lib, no browser): fill a fixed Canva design,
// lay a letter out on a letterhead, and stamp a signature. Positions come in
// as PDF points from the page's TOP-LEFT (what the Admin Workspace editor
// uses) and are flipped to pdf-lib's bottom-left origin here.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { fillText } from './hrValues.js';

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
// The Canva designs' own fonts (Arimo body, Cormorant Garamond headings), so
// filled-in text matches the printed text. Both cover ₹ and are OFL-licensed;
// static weights cut from the Google Fonts variable files.
const FONT_FILES = {
  sans: 'Arimo-Regular.ttf',
  'sans-bold': 'Arimo-Bold.ttf',
  serif: 'CormorantGaramond-SemiBold.ttf',
  'serif-bold': 'CormorantGaramond-Bold.ttf',
};
const fontBytes = {};
const readFont = (name) =>
  (fontBytes[name] ??= fs.readFileSync(path.join(FONT_DIR, FONT_FILES[name])));

/** Lazily embeds each font the first time it's used. */
const fontSet = (doc) => {
  doc.registerFontkit(fontkit);
  const cache = {};
  return async (family = 'sans', bold = false) => {
    const name = `${family === 'serif' ? 'serif' : 'sans'}${bold ? '-bold' : ''}`;
    // Embedded whole: pdf-lib's subsetter drops glyphs from these fonts, so the
    // files are pre-trimmed to Latin + ₹ instead (~40 KB each).
    cache[name] ??= doc.embedFont(readFont(name));
    return cache[name];
  };
};

const hexColor = (hex = '#1E1823') => {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

/**
 * The page's top edge in PDF user space. Canva exports place the visible
 * page at y ≈ 7.8, not 0, so flipping top-left positions against the height
 * alone drew everything ~8 pt too high.
 */
const pageTop = (page) => {
  const box = page.getCropBox();
  return box.y + box.height;
};

/** Page sizes of an uploaded PDF, or throws if it isn't one pdf-lib can read. */
export const pdfPages = async (bytes) => {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPages().map((p) => {
    const { width, height } = p.getSize();
    return { width: Math.round(width * 100) / 100, height: Math.round(height * 100) / 100 };
  });
};

const setMeta = (doc, title) => {
  doc.setTitle(title);
  doc.setCreator('The Nura Admin Workspace');
  doc.setProducer('The Nura Admin Workspace');
};

/* ------------------------------ Fixed design ------------------------------ */

/**
 * Split text into words that keep their trailing space, so widths add up
 * exactly, then break them into lines no wider than `maxWidth`. `**bold**`
 * runs are measured in the bold font.
 */
const wrapRuns = (text, maxWidth, size, regular, bold) => {
  const lines = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const words = boldRuns(rawLine).flatMap((run) =>
      run.text.split(/(?<=\s)/).map((t) => ({ text: t, bold: run.bold })),
    );
    let line = [];
    let width = 0;
    for (const w of words) {
      const f = w.bold ? bold : regular;
      // A trailing space may hang past the edge; the word itself may not.
      if (line.length && width + f.widthOfTextAtSize(w.text.trimEnd(), size) > maxWidth) {
        lines.push(line);
        line = [];
        width = 0;
        if (!w.text.trim()) continue;
      }
      line.push(w);
      width += f.widthOfTextAtSize(w.text, size);
    }
    lines.push(line);
  }
  return lines;
};

const runsWidth = (words, size, regular, bold) =>
  words.reduce((sum, w) => sum + (w.bold ? bold : regular).widthOfTextAtSize(w.text, size), 0) -
  // the last word's trailing space doesn't count towards alignment
  (words.length && /\s$/.test(words.at(-1).text)
    ? (words.at(-1).bold ? bold : regular).widthOfTextAtSize(' ', size)
    : 0);

/**
 * Draw each field's value into its box on a copy of the template. A plain
 * field is one line that shrinks to fit its width (down to 60%), with line
 * breaks in the value (an address, say) becoming extra lines below. A `wrap`
 * field is a paragraph: it wraps to the width at full size, and `**bold**`
 * runs are drawn bold in `boldColor`, like a sentence with a name in it.
 */
export const fillFixed = async (templateBytes, fields, values, { title = 'Document' } = {}) => {
  const doc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const font = fontSet(doc);
  const pages = doc.getPages();
  for (const f of fields) {
    const page = pages[f.page];
    if (!page) continue;
    const pageHeight = pageTop(page);
    if (f.cover) {
      page.drawRectangle({
        x: f.cover.x,
        y: pageHeight - f.cover.y - f.cover.height,
        width: f.cover.width,
        height: f.cover.height,
        color: hexColor(f.cover.color),
      });
    }
    const value = String(f.text ? fillText(f.text, values) : (values[f.key] ?? '')).trim();
    if (!value) continue;
    const gap = f.fontSize * (f.lineHeight ?? 1.25);
    if (f.wrap) {
      const regular = await font(f.font, f.bold);
      const bold = await font(f.font, true);
      const ascent = regular.heightAtSize(f.fontSize, { descender: false });
      wrapRuns(value, f.width, f.fontSize, regular, bold).forEach((words, i) => {
        const w = runsWidth(words, f.fontSize, regular, bold);
        let x =
          f.align === 'center'
            ? f.x + (f.width - w) / 2
            : f.align === 'right'
              ? f.x + f.width - w
              : f.x;
        for (const word of words) {
          const wf = word.bold ? bold : regular;
          if (word.text.trim()) {
            page.drawText(word.text, {
              x,
              y: pageHeight - (f.y + ascent + i * gap),
              size: f.fontSize,
              font: wf,
              color: hexColor(word.bold ? (f.boldColor ?? f.color) : f.color),
            });
          }
          x += wf.widthOfTextAtSize(word.text, f.fontSize);
        }
      });
      continue;
    }
    const pdfFont = await font(f.font, f.bold);
    const lines = value.split(/\r?\n/);
    const widest = Math.max(...lines.map((l) => pdfFont.widthOfTextAtSize(l, f.fontSize)));
    const size =
      widest > f.width ? Math.max(f.fontSize * 0.6, (f.fontSize * f.width) / widest) : f.fontSize;
    const ascent = pdfFont.heightAtSize(size, { descender: false });
    const height = pageHeight;
    lines.forEach((line, i) => {
      const w = pdfFont.widthOfTextAtSize(line, size);
      const x =
        f.align === 'center'
          ? f.x + (f.width - w) / 2
          : f.align === 'right'
            ? f.x + f.width - w
            : f.x;
      page.drawText(line, {
        x,
        y: height - (f.y + ascent + i * (f.lineHeight ? gap : size * 1.25)),
        size,
        font: pdfFont,
        color: hexColor(f.color),
      });
    });
  }
  setMeta(doc, title);
  return doc.save();
};

/* -------------------------------- Letterhead ------------------------------ */

/** "Hello **there**" → [{ text: 'Hello ', bold: false }, { text: 'there', bold: true }] */
export const boldRuns = (line) => {
  const runs = [];
  line.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (!part) return;
    const bold = part.startsWith('**') && part.endsWith('**') && part.length > 4;
    runs.push({ text: bold ? part.slice(2, -2) : part, bold });
  });
  return runs;
};

const SIGNATURE_BOX = { width: 180, height: 60 };

/**
 * Lay `body` (placeholders already filled) out on the letterhead: the first
 * template page behind page 1, the second (or the first again) behind any
 * continuation pages. Returns the PDF and, when a signature is needed, the
 * box reserved for it after the text (top-left coordinates).
 */
export const renderLetterhead = async (
  templateBytes,
  body,
  layout,
  { requiresSignature = false, title = 'Letter' } = {},
) => {
  const source = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const doc = await PDFDocument.create();
  const srcCount = source.getPageCount();
  const font = fontSet(doc);
  const regular = await font(layout.font, false);
  const bold = await font(layout.font, true);
  const size = layout.fontSize;
  const lineGap = size * layout.lineHeight;
  const { width: pw, height: ph } = source.getPage(0).getSize();
  const maxWidth = pw - layout.marginLeft - layout.marginRight;
  const bottom = ph - layout.marginBottom;

  // Pass 1: lay the lines out ({ page, y, words }) without drawing anything.
  const lines = [];
  let pageIndex = 0;
  let y = layout.marginTop; // top of the next line, from the top
  const nextPage = () => {
    pageIndex += 1;
    y = layout.marginTop;
  };
  const place = (words) => {
    if (y + lineGap > bottom) nextPage();
    lines.push({ page: pageIndex, y, words });
    y += lineGap;
  };

  const paragraphs = String(body)
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/);
  paragraphs.forEach((para, pi) => {
    wrapRuns(para, maxWidth, size, regular, bold).forEach(place);
    if (pi < paragraphs.length - 1) y += size * 0.6;
  });

  let signatureBox = null;
  if (requiresSignature) {
    y += lineGap * 0.5;
    if (y + SIGNATURE_BOX.height + 24 > bottom) nextPage();
    signatureBox = { page: pageIndex, x: layout.marginLeft, y, ...SIGNATURE_BOX };
  }

  // Pass 2: copy the letterhead in as each page (page 1 of the template
  // first, then its page 2, or page 1 again, for the rest) and draw on it.
  // Copying keeps Canva's vector artwork and works even for an empty page.
  const pageCount = pageIndex + 1;
  const order = Array.from({ length: pageCount }, (_, i) => (i === 0 || srcCount === 1 ? 0 : 1));
  const pages = (await doc.copyPages(source, order)).map((p) => doc.addPage(p));
  const ascent = regular.heightAtSize(size, { descender: false });
  const top = pageTop(source.getPage(0));
  for (const line of lines) {
    let x = layout.marginLeft;
    for (const w of line.words) {
      const f = w.bold ? bold : regular;
      if (w.text.trim()) {
        pages[line.page].drawText(w.text, {
          x,
          y: top - (line.y + ascent),
          size,
          font: f,
          color: rgb(0.12, 0.09, 0.14),
        });
      }
      x += f.widthOfTextAtSize(w.text, size);
    }
  }
  setMeta(doc, title);
  return {
    bytes: await doc.save(),
    signatureBox,
    pages: pages.map(() => ({ width: pw, height: ph })),
  };
};

/* -------------------------------- Signature ------------------------------- */

/**
 * Stamp a PNG signature into `box` (kept in proportion, bottom-aligned),
 * with "Signed electronically by … on …" in small print underneath, or at
 * `box.noteX/noteY` when the design has a better spot for it. A design with
 * a Date line sets `box.dateX/dateY` and gets the signing date written there.
 */
export const stampSignature = async (pdfBytes, box, pngBytes, { signerName, signedAt, title }) => {
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const page = doc.getPages()[box.page] ?? doc.getPages().at(-1);
  const ph = pageTop(page);
  const png = await doc.embedPng(pngBytes);
  const scale = Math.min(box.width / png.width, box.height / png.height);
  const w = png.width * scale;
  const h = png.height * scale;
  page.drawImage(png, { x: box.x, y: ph - (box.y + box.height), width: w, height: h });

  const font = await fontSet(doc)('sans', false);
  const when = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(signedAt);
  const note = `Signed electronically by ${signerName} on ${when} IST`;
  const noteY = box.noteY != null ? ph - box.noteY : ph - (box.y + box.height) - 10;
  page.drawText(note, {
    x: box.noteX ?? box.x,
    y: noteY > 8 ? noteY : ph - box.y + 4,
    size: 7,
    font,
    color: rgb(0.45, 0.42, 0.47),
  });
  if (box.dateX != null && box.dateY != null) {
    const date = new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    }).format(signedAt);
    const size = 8.6;
    page.drawText(date, {
      x: box.dateX,
      y: ph - (box.dateY + font.heightAtSize(size, { descender: false })),
      size,
      font,
      color: hexColor('#2C2F36'),
    });
  }
  if (title) setMeta(doc, title);
  return doc.save();
};
