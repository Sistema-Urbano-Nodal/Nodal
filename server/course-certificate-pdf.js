import { readFile } from 'node:fs/promises';

const template = new URL('./assets/certificates/template.pdf', import.meta.url);
const fallbackFont = new URL('./assets/certificates/DejaVuSans-Bold.ttf', import.meta.url);
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const columnWidth = 493;
const left = 54;

function typesettingError() {
  return Object.assign(new Error('The participant name or course title needs typesetting review.'), {
    code: 'certificate_text_unsupported',
  });
}

function label(value) {
  if (typeof value !== 'string' || value.length > 2000) throw typesettingError();
  const text = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!text || /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(text)) throw typesettingError();
  return text;
}

function wrap(text, font, size) {
  const fits = (line) => font.widthOfTextAtSize(line, size) <= columnWidth;
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const joined = line ? line + ' ' + word : word;
    if (fits(joined)) { line = joined; continue; }
    if (line) lines.push(line);
    line = word;
    if (fits(word)) continue;
    line = '';
    for (const {segment} of graphemes.segment(word)) {
      if (!fits(line + segment)) {
        if (!line || !fits(segment)) throw typesettingError();
        lines.push(line);
        line = '';
      }
      line += segment;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function drawField(page, text, font, loadFallback, baseline, maxBaseline, preferredSize, oneLineMin, color) {
  const supports = (face) => {
    const codes = new Set(face.getCharacterSet());
    return Array.from(text).every((ch) => codes.has(ch.codePointAt(0)));
  };
  if (!supports(font)) {
    font = await loadFallback();
    if (!supports(font)) throw typesettingError();
  }
  const natural = font.widthOfTextAtSize(text, preferredSize);
  let size = Math.min(preferredSize, preferredSize * columnWidth / natural);
  let lines = [text];
  if (size < oneLineMin) {
    // Keep both fields inside their own vertical band even for long unbroken names.
    for (size = preferredSize; size >= 9; size--) {
      lines = wrap(text, font, size);
      if (lines.length * size * 1.15 <= 66) break;
    }
    if (size < 9) throw typesettingError();
  }
  const leading = size * 1.15;
  const firstBaseline = Math.min(maxBaseline, baseline + (lines.length - 1) * leading / 2);
  for (const [index, line] of lines.entries()) {
    page.drawText(line, { x: left, y: firstBaseline - index * leading, font, size, color });
  }
}

export async function renderCourseCertificate({ name, course }) {
  const recipient = label(name);
  const title = label(course);
  const [{ PDFDocument, StandardFonts, rgb }, artwork] = await Promise.all([
    import('pdf-lib'), readFile(template),
  ]);
  const doc = await PDFDocument.load(artwork);
  const [page] = doc.getPages();
  const ink = rgb(36 / 255, 55 / 255, 43 / 255);
  let fallback;
  async function loadFallback() {
    if (!fallback) {
      const [{ default: fontkit }, bytes] = await Promise.all([import('@pdf-lib/fontkit'), readFile(fallbackFont)]);
      doc.registerFontkit(fontkit);
      fallback = await doc.embedFont(bytes, { subset: true });
    }
    return fallback;
  }
  await drawField(page, recipient, await doc.embedFont(StandardFonts.TimesRomanBold), loadFallback, 247, 265, 32, 24, ink);
  await drawField(page, title, await doc.embedFont(StandardFonts.HelveticaBold), loadFallback, 160, 165, 17, 13, ink);
  doc.setTitle('Constancia de participación · ' + title);
  doc.setAuthor('NODAL · Sistema Urbano');
  doc.setSubject(recipient);
  doc.setCreationDate(new Date());
  return Buffer.from(await doc.save());
}
