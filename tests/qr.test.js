import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encodeQr, packBits } from '../server/qr.js';

// The reader below is written from ISO/IEC 18004 independently of server/qr.js: its own block table,
// alignment centres, format/version words and zig-zag walk, so a shared mistake cannot hide.
// Table 9, level M: [EC codewords per block, [blocks, data codewords each], ...].
const LEVEL_M = {
  1: [10, [1, 16]], 2: [16, [1, 28]], 3: [26, [1, 44]], 4: [18, [2, 32]], 5: [24, [2, 43]],
  6: [16, [4, 27]], 7: [18, [4, 31]], 8: [22, [2, 38], [2, 39]], 9: [22, [3, 36], [2, 37]], 10: [26, [4, 43], [1, 44]],
};
const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346]; // Table 1
const REMAINDER_BITS = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0]; // Table 1
const CAPACITY = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213]; // Table 7, byte mode, level M
const CENTRES = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] }; // Annex E
const FORMAT_M = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0]; // Table C.1, level M, masks 0–7
const VERSION_INFO = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 }; // Table D.1
const MASK = [ // Table 10, i = row, j = column
  (i, j) => (i + j) % 2 === 0, (i) => i % 2 === 0, (i, j) => j % 3 === 0, (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0, (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0, (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
];
const EXP = [], LOG = [];
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x > 255) x ^= 0x11d; }
const gmul = (a, b) => (a && b ? EXP[(LOG[a] + LOG[b]) % 255] : 0);

const CHECKIN = 'https://sistema-urbano-nodal-ten.vercel.app/fiiu-checkin.html?a=day1-am&c=AbCdEfGhIjKlMnOpQrSt-_';
const LONG_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSeZ7mN3xQ8vT2bK9wR4yH6jL1pC5sD0fG3hJ8kM2nB7vX4qWe/viewform?usp=pp_url&entry.1234567890=route-comunidad-arte-naturaleza&entry.987654321=2026-10-24';
const filler = (length) => { let s = 'https://ex.org/'; for (let i = 0; s.length < length; i++) s += 'aZ09-._~/?=&%'[(i * 7 + length) % 13]; return s.slice(0, length); };

const get = (qr, x, y) => qr.modules[y * qr.size + x];
const centresOf = (version) => {
  const n = version * 4 + 17, c = CENTRES[version];
  return c.flatMap((cy) => c.map((cx) => [cx, cy])).filter(([cx, cy]) => !(cx < 9 && cy < 9) && !(cx > n - 9 && cy < 9) && !(cx < 9 && cy > n - 9));
};
function isFunction(version, x, y) {
  const n = version * 4 + 17;
  if ((x < 9 && y < 9) || (x >= n - 8 && y < 9) || (x < 9 && y >= n - 8) || x === 6 || y === 6) return true;
  if (version >= 7 && ((x >= n - 11 && x < n - 8 && y < 6) || (y >= n - 11 && y < n - 8 && x < 6))) return true;
  return centresOf(version).some(([cx, cy]) => Math.abs(x - cx) <= 2 && Math.abs(y - cy) <= 2);
}
// Both format copies and both version copies, read most significant bit first as a scanner does.
function readFormat(qr) {
  const n = qr.size; let a = 0, b = 0;
  for (let x = 0; x < 6; x++) a = (a << 1) | get(qr, x, 8);
  for (const [x, y] of [[7, 8], [8, 8], [8, 7]]) a = (a << 1) | get(qr, x, y);
  for (let y = 5; y >= 0; y--) a = (a << 1) | get(qr, 8, y);
  for (let y = n - 1; y >= n - 7; y--) b = (b << 1) | get(qr, 8, y);
  for (let x = n - 8; x < n; x++) b = (b << 1) | get(qr, x, 8);
  return [a, b];
}
function readVersion(qr) {
  const n = qr.size; let a = 0, b = 0;
  for (let y = 5; y >= 0; y--) for (let x = n - 9; x >= n - 11; x--) a = (a << 1) | get(qr, x, y);
  for (let x = 5; x >= 0; x--) for (let y = n - 9; y >= n - 11; y--) b = (b << 1) | get(qr, x, y);
  return [a, b];
}
function decode(qr) {
  const version = (qr.size - 17) / 4, n = qr.size;
  assert.ok(Number.isInteger(version) && version >= 1 && version <= 10, `size ${n}`);
  const [format, formatCopy] = readFormat(qr);
  assert.equal(format, formatCopy, 'both format copies agree');
  const mask = FORMAT_M.indexOf(format);
  assert.ok(mask >= 0, `format word 0x${format.toString(16)} is level M`);
  if (version >= 7) assert.deepEqual(readVersion(qr), [VERSION_INFO[version], VERSION_INFO[version]]);
  const bits = [];
  for (let j = n - 1, up = true; j > 0; j -= 2, up = !up) {
    if (j === 6) j--;
    for (let c = 0; c < n; c++) {
      const i = up ? n - 1 - c : c;
      for (const x of [j, j - 1]) if (!isFunction(version, x, i)) bits.push(get(qr, x, i) ^ (MASK[mask](i, x) ? 1 : 0));
    }
  }
  assert.equal(bits.length, TOTAL_CODEWORDS[version] * 8 + REMAINDER_BITS[version], 'data region size');
  assert.ok(bits.slice(TOTAL_CODEWORDS[version] * 8).every((b) => b === 0), 'remainder bits are zero');
  const codewords = Array.from({ length: TOTAL_CODEWORDS[version] }, (_, k) => bits.slice(k * 8, k * 8 + 8).reduce((v, b) => (v << 1) | b, 0));
  const [ec, ...groups] = LEVEL_M[version], lengths = groups.flatMap(([count, length]) => Array(count).fill(length));
  const blocks = lengths.map(() => []);
  let k = 0;
  for (let i = 0; i < Math.max(...lengths); i++) lengths.forEach((length, b) => { if (i < length) blocks[b].push(codewords[k++]); });
  for (let i = 0; i < ec; i++) blocks.forEach((block) => block.push(codewords[k++]));
  assert.equal(k, TOTAL_CODEWORDS[version]);
  const syndromes = blocks.map((block) => Array.from({ length: ec }, (_, s) => block.reduce((acc, c) => gmul(acc, EXP[s]) ^ c, 0)));
  const data = blocks.flatMap((block, b) => block.slice(0, lengths[b]));
  const stream = data.flatMap((byte) => Array.from({ length: 8 }, (_, i) => (byte >> (7 - i)) & 1));
  let at = 0;
  const take = (count) => { let v = 0; for (let i = 0; i < count; i++) v = (v << 1) | stream[at++]; return v; };
  const mode = take(4), length = take(version < 10 ? 8 : 16), bytes = Buffer.from(Array.from({ length }, () => take(8)));
  const terminator = Math.min(4, stream.length - at);
  assert.equal(take(terminator), 0, 'terminator');
  assert.equal(take((8 - (at % 8)) % 8), 0, 'zero bits up to the byte boundary');
  const pads = data.slice(at / 8);
  assert.deepEqual(pads, pads.map((_, i) => (i % 2 ? 0x11 : 0xec)), 'pad codewords alternate 0xEC 0x11');
  return { version, mask, mode, text: bytes.toString('utf8'), blocks: blocks.length, syndromes };
}
// N1–N4 written over row/column strings, scanning outside the symbol as light.
function referencePenalty(qr) {
  const n = qr.size, lines = [];
  for (let a = 0; a < n; a++) { let row = '', col = ''; for (let b = 0; b < n; b++) { row += get(qr, b, a); col += get(qr, a, b); } lines.push(row, col); }
  let score = 0, dark = 0;
  for (const line of lines) {
    for (const run of line.match(/0{5,}|1{5,}/g) || []) score += 3 + run.length - 5;
    const padded = `0000${line}0000`;
    score += 40 * ((padded.match(/(?=00001011101)/g) || []).length + (padded.match(/(?=10111010000)/g) || []).length);
  }
  for (let y = 0; y + 1 < n; y++) for (let x = 0; x + 1 < n; x++) {
    const sum = get(qr, x, y) + get(qr, x + 1, y) + get(qr, x, y + 1) + get(qr, x + 1, y + 1);
    if (sum === 0 || sum === 4) score += 3;
  }
  for (const m of qr.modules) dark += m;
  let k = 0;
  while (!((45 - 5 * k) * n * n <= 100 * dark && 100 * dark <= (55 + 5 * k) * n * n)) k++;
  return score + 10 * k;
}

test('qr: every version 1–10 decodes back to its text at the capacity edge, with zero Reed–Solomon syndromes in every block', () => {
  for (let version = 1; version <= 10; version++) {
    const text = filler(CAPACITY[version]), qr = encodeQr(text), read = decode(qr);
    assert.equal(qr.version, version);
    assert.equal(qr.size, version * 4 + 17);
    assert.equal(qr.modules.length, qr.size * qr.size);
    assert.ok(qr.modules.every((m) => m === 0 || m === 1));
    assert.equal(read.mode, 0b0100, 'byte mode');
    assert.equal(read.text, text);
    assert.equal(read.mask, qr.mask);
    assert.equal(read.blocks, LEVEL_M[version].slice(1).reduce((sum, [count]) => sum + count, 0));
    for (const block of read.syndromes) assert.deepEqual(block, block.map(() => 0), `v${version} syndromes`);
  }
});

test('qr: each of the eight masks decodes and the format bits name level M with that mask', () => {
  for (const version of [1, 2, 6, 7, 8, 10]) {
    const text = filler(CAPACITY[version] - 3);
    for (let mask = 0; mask < 8; mask++) {
      const qr = encodeQr(text, { mask }), read = decode(qr);
      assert.equal(qr.mask, mask);
      assert.equal(read.mask, mask);
      assert.equal(read.text, text);
      assert.ok(read.syndromes.flat().every((s) => s === 0));
    }
  }
});

test('qr: format words are BCH(15,5) codewords masked with 0x5412 and version words are BCH(18,6)', () => {
  const remainder = (value, poly, degree) => { for (let i = 31 - Math.clz32(value); i >= degree; i--) if ((value >>> i) & 1) value ^= poly << (i - degree); return value; };
  for (let mask = 0; mask < 8; mask++) {
    const word = readFormat(encodeQr('format', { mask }))[0];
    assert.equal(word, FORMAT_M[mask]);
    assert.equal((word ^ 0x5412) >>> 10, mask, 'level M (00) then the mask');
    assert.equal(remainder(word ^ 0x5412, 0x537, 10), 0);
  }
  for (let version = 7; version <= 10; version++) {
    const [word, copy] = readVersion(encodeQr(filler(CAPACITY[version])));
    assert.equal(word, copy);
    assert.equal(word >>> 12, version);
    assert.equal(remainder(word, 0x1f25, 12), 0);
  }
});

test('qr: finder, separator, timing and alignment patterns and the dark module sit where the standard puts them', () => {
  const finder = (dx, dy) => { const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3)); return ring === 2 ? 0 : 1; };
  for (let version = 1; version <= 10; version++) {
    const qr = encodeQr(filler(CAPACITY[version])), n = qr.size;
    for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) assert.equal(get(qr, ox + dx, oy + dy), finder(dx, dy), `v${version} finder at ${ox},${oy}`);
    }
    for (let i = 0; i < 8; i++) {
      for (const [x, y] of [[i, 7], [7, i], [n - 1 - i, 7], [n - 8, i], [i, n - 8], [7, n - 1 - i]]) assert.equal(get(qr, x, y), 0, `v${version} separator ${x},${y}`);
    }
    for (let i = 8; i < n - 8; i++) {
      assert.equal(get(qr, i, 6), i % 2 === 0 ? 1 : 0, `v${version} horizontal timing ${i}`);
      assert.equal(get(qr, 6, i), i % 2 === 0 ? 1 : 0, `v${version} vertical timing ${i}`);
    }
    assert.equal(centresOf(version).length, version === 1 ? 0 : CENTRES[version].length ** 2 - 3);
    for (const [cx, cy] of centresOf(version)) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) assert.equal(get(qr, cx + dx, cy + dy), Math.max(Math.abs(dx), Math.abs(dy)) === 1 ? 0 : 1, `v${version} alignment ${cx},${cy}`);
    }
    assert.equal(get(qr, 8, n - 8), 1, 'dark module');
  }
});

test('qr: picks the smallest version that fits the UTF-8 bytes and refuses text past 10-M', () => {
  for (const [bytes, version] of [[0, 1], [17, 2], [84, 5], [106, 6], [122, 7]]) assert.equal(encodeQr('x'.repeat(bytes)).version, version, `${bytes} bytes`);
  for (let version = 1; version <= 10; version++) {
    assert.equal(encodeQr('x'.repeat(CAPACITY[version])).version, version);
    if (version < 10) assert.equal(encodeQr('x'.repeat(CAPACITY[version] + 1)).version, version + 1);
  }
  assert.equal(decode(encodeQr('')).text, '');
  assert.equal(encodeQr('ñ'.repeat(53)).version, 6, '106 bytes, 53 characters');
  assert.equal(decode(encodeQr('Participação · día ñ ✓')).text, 'Participação · día ñ ✓');
  assert.throws(() => encodeQr('x'.repeat(214)), { name: 'RangeError', message: 'QR text is 214 bytes; version 10-M holds at most 213' });
  assert.throws(() => encodeQr('ñ'.repeat(107)), /214 bytes/);
  assert.throws(() => encodeQr(42), TypeError);
  assert.throws(() => encodeQr(undefined), TypeError);
  for (const mask of [-1, 8, 1.5, '1', null]) assert.throws(() => encodeQr('x', { mask }), RangeError);
});

test('qr: chooses the mask with the lowest N1–N4 penalty, first one on a tie', () => {
  const ids = ['day0-lab', 'day1-am', 'day1-pm', 'day2-am', 'day2-pm', 'day3-am'];
  const texts = [CHECKIN, LONG_FORM, '', 'A', ...CAPACITY.slice(1).map(filler), ...ids.map((id, i) => CHECKIN.replace('day1-am', id).replace('AbCd', 'Zz9' + i)), 'AAAA', 'A'.repeat(53), '~'.repeat(11), 'a1'.repeat(13).slice(1)];
  for (const text of texts) {
    const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => referencePenalty(encodeQr(text, { mask })));
    assert.equal(encodeQr(text).mask, scores.indexOf(Math.min(...scores)), `${text.length} bytes: ${scores}`);
  }
});

test('qr: output is deterministic and matches the golden fixtures', () => {
  const digest = (qr) => createHash('sha256').update(qr.modules).digest('hex');
  const checkin = encodeQr(CHECKIN), form = encodeQr(LONG_FORM);
  assert.deepEqual(encodeQr(CHECKIN), checkin);
  assert.equal(packBits(encodeQr(CHECKIN)), packBits(checkin));
  assert.deepEqual([checkin.version, checkin.mask, checkin.size], [6, 7, 41]);
  assert.equal(digest(checkin), '31571551693bc1b71f75bcc99420a5173da54040de5badb7f1ef94df4a6e541d');
  assert.deepEqual([form.version, form.mask, form.size], [10, 2, 57]);
  assert.equal(digest(form), 'e9893bdba4e42f61903dd098ad53278f3fd09bdbd40f3f35c18369ab2dc58b72');
  assert.equal(decode(checkin).text, CHECKIN);
  assert.equal(decode(form).text, LONG_FORM);
});

test('qr: packBits is row-major, most significant bit first, zero-padded, base64', () => {
  assert.equal(packBits({ size: 3, modules: Uint8Array.from([1, 0, 1, 0, 1, 0, 1, 0, 1]) }), 'qoA=');
  assert.equal(packBits({ size: 2, modules: [0, 0, 0, 1] }), 'EA==');
  const qr = encodeQr(CHECKIN), bytes = Buffer.from(packBits(qr), 'base64');
  assert.equal(bytes.length, Math.ceil(41 * 41 / 8));
  assert.deepEqual(Uint8Array.from({ length: qr.size * qr.size }, (_, k) => (bytes[k >> 3] >> (7 - (k & 7))) & 1), qr.modules);
  assert.equal(bytes.at(-1) & 0x7f, 0, 'padding bits are zero');
  assert.throws(() => packBits({ size: 3, modules: new Uint8Array(8) }), TypeError);
  assert.throws(() => packBits({}), TypeError);
});
