/* Zero-dependency QR Code encoder (ISO/IEC 18004) for the FIIU check-in screen.
   Byte mode (UTF-8), error correction level M, versions 1–10. encodeQr returns the
   module grid row-major with 1 = dark; packBits turns it into base64 so the browser
   can draw it as one SVG path. The output is deterministic for a given text. */

// Level M per version: [EC codewords per block, group-1 blocks, data codewords each, group-2 blocks, data codewords each].
const BLOCKS = [null,
  [10, 1, 16, 0, 0], [16, 1, 28, 0, 0], [26, 1, 44, 0, 0], [18, 2, 32, 0, 0], [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0], [18, 4, 31, 0, 0], [22, 2, 38, 2, 39], [22, 3, 36, 2, 37], [26, 4, 43, 1, 44]];
const ALIGNMENT = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const MAX_VERSION = 10;
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
  (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

const dataCodewords = (version) => { const [, b1, d1, b2, d2] = BLOCKS[version]; return b1 * d1 + b2 * d2; };
const countBits = (version) => (version < 10 ? 8 : 16);
const capacity = (version) => Math.floor((dataCodewords(version) * 8 - 4 - countBits(version)) / 8);

// GF(256) over x^8 + x^4 + x^3 + x^2 + 1 (0x11d), generator α = 2.
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++, x = (x << 1) ^ (x & 0x80 ? 0x11d : 0)) { EXP[i] = x; LOG[x] = i; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

// Monic generator polynomial Π(x − α^i), i < degree, highest power first.
function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    poly.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, EXP[i]); });
    poly = next;
  }
  return poly;
}

function reedSolomon(data, gen) {
  const n = gen.length - 1, rem = new Uint8Array(n);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.copyWithin(0, 1); rem[n - 1] = 0;
    for (let j = 0; j < n; j++) rem[j] ^= mul(gen[j + 1], factor);
  }
  return rem;
}

// Mode 0100, character count, the bytes, up to four terminator zeros, then 0xEC/0x11 padding.
function dataStream(bytes, version) {
  const total = dataCodewords(version), out = new Uint8Array(total);
  let bit = 0;
  const put = (value, length) => { for (let i = length - 1; i >= 0; i--, bit++) out[bit >> 3] |= ((value >>> i) & 1) << (7 - (bit & 7)); };
  put(0b0100, 4); put(bytes.length, countBits(version));
  for (const byte of bytes) put(byte, 8);
  bit = Math.min(bit + 4, total * 8);
  for (let i = Math.ceil(bit / 8), pad = 0xec; i < total; i++, pad ^= 0xec ^ 0x11) out[i] = pad;
  return out;
}

// Split into blocks, append each block's EC codewords, interleave data then EC column by column.
function interleave(data, version) {
  const [ec, b1, d1, b2, d2] = BLOCKS[version], gen = generator(ec), blocks = [];
  for (let b = 0, at = 0; b < b1 + b2; b++) {
    const block = data.subarray(at, at += b < b1 ? d1 : d2);
    blocks.push([block, reedSolomon(block, gen)]);
  }
  const out = [];
  for (let i = 0; i < Math.max(d1, d2); i++) for (const [block] of blocks) if (i < block.length) out.push(block[i]);
  for (let i = 0; i < ec; i++) for (const [, check] of blocks) out.push(check[i]);
  return out;
}

const bch = (value, poly, degree) => {
  let rem = value << degree;
  for (let i = 31 - Math.clz32(rem); i >= degree; i--) if ((rem >>> i) & 1) rem ^= poly << (i - degree);
  return (value << degree) | rem;
};
// Level M is 00, so the five format data bits are just the mask number.
const formatBits = (mask) => bch(mask, 0x537, 10) ^ 0x5412;
const versionBits = (version) => bch(version, 0x1f25, 12);

function template(version) {
  const size = version * 4 + 17, modules = new Uint8Array(size * size), reserved = new Uint8Array(size * size);
  const set = (x, y, dark) => { modules[y * size + x] = dark ? 1 : 0; reserved[y * size + x] = 1; };
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, ring = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, ring !== 2 && ring !== 4);
    }
  }
  for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
  const centres = ALIGNMENT[version], last = centres.length - 1;
  centres.forEach((cy, row) => centres.forEach((cx, col) => {
    if ((row === 0 && (col === 0 || col === last)) || (row === last && col === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  drawFormat(set, size, 0);
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3), b = Math.floor(i / 3), dark = (bits >>> i) & 1;
      set(a, b, dark); set(b, a, dark);
    }
  }
  return { size, modules, reserved };
}

// Both copies of the 15 format bits (bit 14 first), plus the dark module beside the lower-left finder.
function drawFormat(set, size, mask) {
  const bits = formatBits(mask), bit = (i) => (bits >>> i) & 1;
  for (let i = 0; i < 6; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, 1);
}

// Two-column zig-zag from the lower right, skipping the vertical timing column and reserved modules.
function placeData(modules, reserved, size, codewords) {
  const total = codewords.length * 8;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (reserved[y * size + x]) continue;
        modules[y * size + x] = i < total ? (codewords[i >> 3] >>> (7 - (i & 7))) & 1 : 0;
        i++;
      }
    }
  }
}

function penalty(modules, size) {
  let score = 0, dark = 0;
  const line = (at) => {
    for (let i = 0, run = 0; i < size; i++) {
      run = i > 0 && at(i) === at(i - 1) ? run + 1 : 1;
      if (run === 5) score += 3; else if (run > 5) score += 1;
    }
    const light = (from) => { for (let k = from; k < from + 4; k++) if (k >= 0 && k < size && at(k)) return false; return true; };
    for (let i = 0; i + 7 <= size; i++) {
      if (!(at(i) && !at(i + 1) && at(i + 2) && at(i + 3) && at(i + 4) && !at(i + 5) && at(i + 6))) continue;
      if (light(i - 4)) score += 40;
      if (light(i + 7)) score += 40;
    }
  };
  for (let y = 0; y < size; y++) line((x) => modules[y * size + x]);
  for (let x = 0; x < size; x++) line((y) => modules[y * size + x]);
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const c = modules[y * size + x];
    if (c === modules[y * size + x + 1] && c === modules[(y + 1) * size + x] && c === modules[(y + 1) * size + x + 1]) score += 3;
  }
  for (const m of modules) dark += m;
  const total = size * size;
  return score + 10 * (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1);
}

export function encodeQr(text, { mask: fixedMask } = {}) {
  if (typeof text !== 'string') throw new TypeError('QR text must be a string');
  if (fixedMask !== undefined && !(Number.isInteger(fixedMask) && fixedMask >= 0 && fixedMask < 8)) throw new RangeError('QR mask must be an integer from 0 to 7');
  const bytes = Buffer.from(text, 'utf8');
  let version = 1;
  while (version <= MAX_VERSION && bytes.length > capacity(version)) version++;
  if (version > MAX_VERSION) throw new RangeError(`QR text is ${bytes.length} bytes; version ${MAX_VERSION}-M holds at most ${capacity(MAX_VERSION)}`);
  const { size, modules: base, reserved } = template(version);
  placeData(base, reserved, size, interleave(dataStream(bytes, version), version));
  let best = null;
  for (const mask of fixedMask === undefined ? MASKS.keys() : [fixedMask]) {
    const modules = base.slice(), test = MASKS[mask];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!reserved[y * size + x] && test(x, y)) modules[y * size + x] ^= 1;
    drawFormat((x, y, dark) => { modules[y * size + x] = dark ? 1 : 0; }, size, mask);
    const score = fixedMask === undefined ? penalty(modules, size) : 0;
    if (!best || score < best.score) best = { version, mask, size, modules, score };
  }
  const { score, ...qr } = best;
  return qr;
}

// Row-major, most significant bit first: module k is bit 7 − (k mod 8) of byte ⌊k / 8⌋; the last byte is zero-padded.
export function packBits({ size, modules }) {
  if (!Number.isInteger(size) || size < 1 || modules?.length !== size * size) throw new TypeError('packBits needs {size, modules} with size × size modules');
  const out = Buffer.alloc(Math.ceil(modules.length / 8));
  for (let k = 0; k < modules.length; k++) if (modules[k]) out[k >> 3] |= 0x80 >> (k & 7);
  return out.toString('base64');
}
