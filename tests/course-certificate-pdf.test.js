import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { renderCourseCertificate } from '../server/course-certificate-pdf.js';

async function readCertificate(name, course) {
  const bytes = await renderCourseCertificate({ name, course });
  assert.ok(Buffer.isBuffer(bytes) && bytes.byteLength < 3 * 1024 * 1024);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.equal(pdf.getSubject(), name.normalize('NFC'));
  assert.ok(pdf.getTitle().includes(course));
  const page = pdf.getPages()[0];
  assert.ok(page.getWidth() > page.getHeight());
  // Last stream is the personalized overlay on the approved one-page artwork.
  const contents = page.node.Contents();
  const stream = pdf.context.lookup(contents.get(contents.size() - 1));
  return inflateSync(stream.getContents()).toString('ascii');
}

test('personalizes the printed artwork with the participant and course, including accents and punctuation', async () => {
  const data = await readCertificate('Mari\u0301a Muñoz (Sá)', 'Diseño & acción');
  for (const label of ['María Muñoz (Sá)', 'Diseño & acción']) {
    const encoded = Buffer.from(label, 'latin1').toString('hex').toUpperCase();
    assert.ok(data.includes('<' + encoded + '> Tj'), 'personalized text must be drawn');
  }
});

test('wraps long names and course titles inside separate bands above the footer', async () => {
  const data = await readCertificate('María García '.repeat(8).trim(), 'Participación y ciudadanía '.repeat(8).trim());
  const y = [...data.matchAll(/1 0 0 1 54 ([\d.]+) Tm/g)].map(m => Number(m[1]));
  const names = y.filter(n => n > 200);
  const titles = y.filter(n => n <= 200);
  assert.ok(names.length > 1 && Math.max(...names) <= 265 && Math.min(...names) > 200);
  assert.ok(titles.length > 1 && Math.max(...titles) <= 165 && Math.min(...titles) > 98);
});

test('embeds a Unicode fallback for names and course titles beyond WinAnsi', async () => {
  const data = await readCertificate('Жанна Łucja', 'Δίκτυα πόλεων');
  assert.match(data, /DejaVuSans-Bold/);
});

test('signals a typesetting review for invalid or unrepresentable text instead of issuing a damaged PDF', async () => {
  for (const name of ['', 'X\u0001Y', '李', 'W'.repeat(2000)]) {
    await assert.rejects(renderCourseCertificate({ name, course: 'Curso' }), { code: 'certificate_text_unsupported' });
  }
});
