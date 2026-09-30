// Geometry for the landing hero's map network (web/pages/index.html, svg.hero-net).
// The overlay's user units are pixels of web/assets/source/latam-map.png (1953×2385),
// which is spherical Mercator. Coastal markers are nudged to the land side of the
// coastline stroke, so x, y are the drawn positions and lat, lon the true ones.
// Not run by the build: `node scripts/hero-network-geometry.mjs` prints the svg block,
// and tests/hero-network.test.js checks index.html against markup().
import { pathToFileURL } from 'node:url';

export const MAP = { width: 1953, height: 2385, R: 1312.5467, x0: 2717.6932, y0: 825.8128 };
export const project = (lat, lon) => {
  const d = Math.PI / 180;
  return [MAP.x0 + MAP.R * lon * d, MAP.y0 - MAP.R * Math.log(Math.tan(Math.PI / 4 + (lat * d) / 2))];
};

export const CITIES = [
  { id: 'mex', name: 'Ciudad de México', lat: 19.4326, lon: -99.1332, x: 447, y: 372 },
  { id: 'gua', name: 'Ciudad de Guatemala', lat: 14.6349, lon: -90.5069, x: 646, y: 486 },
  { id: 'sjo', name: 'San José', lat: 9.9281, lon: -84.0907, x: 792, y: 595 },
  { id: 'pty', name: 'Ciudad de Panamá', lat: 8.9824, lon: -79.5199, x: 896, y: 620 },
  { id: 'sdq', name: 'Santo Domingo', lat: 18.4861, lon: -69.9312, x: 1091, y: 387 },
  { id: 'ccs', name: 'Caracas', lat: 10.4806, lon: -66.9036, x: 1186, y: 603 },
  { id: 'bog', name: 'Bogotá', lat: 4.7110, lon: -74.0721, x: 1021, y: 718 },
  { id: 'uio', name: 'Quito', lat: -0.1807, lon: -78.4678, x: 920, y: 830 },
  { id: 'lim', name: 'Lima', lat: -12.0464, lon: -77.0428, x: 967, y: 1097 },
  { id: 'lpb', name: 'La Paz', lat: -16.4897, lon: -68.1193, x: 1157, y: 1209 },
  { id: 'mao', name: 'Manaus', lat: -3.1190, lon: -60.0217, x: 1343, y: 897 },
  { id: 'bsb', name: 'Brasília', lat: -15.7939, lon: -47.8828, x: 1621, y: 1192 },
  { id: 'sao', name: 'São Paulo', lat: -23.5505, lon: -46.6333, x: 1647, y: 1378 },
  { id: 'rio', name: 'Rio de Janeiro', lat: -22.9068, lon: -43.1729, x: 1723, y: 1342 },
  { id: 'poa', name: 'Porto Alegre', lat: -30.0346, lon: -51.2177, x: 1544, y: 1548 },
  { id: 'asu', name: 'Asunción', lat: -25.2637, lon: -57.5759, x: 1399, y: 1424 },
  { id: 'cor', name: 'Córdoba', lat: -31.4201, lon: -64.1888, x: 1247, y: 1585 },
  { id: 'bue', name: 'Buenos Aires', lat: -34.6037, lon: -58.3816, x: 1367, y: 1677 },
  { id: 'mvd', name: 'Montevideo', lat: -34.9011, lon: -56.1645, x: 1437, y: 1658 },
  { id: 'scl', name: 'Santiago', lat: -33.4489, lon: -70.6693, x: 1099, y: 1640 },
];

// Document order is the choreography order. For tree edges `a` is the introducer;
// `via` is the broker path; `bow` is the signed control offset as a fraction of the chord.
export const EDGES = [
  { a: 'lim', b: 'lpb', role: 'tree', bow: 0.06 },
  { a: 'lim', b: 'uio', role: 'tree', bow: -0.06 },
  { a: 'lim', b: 'scl', role: 'tree', bow: 0.06 },
  { a: 'lim', b: 'sao', role: 'tree', bow: -0.06 }, // bows north, clear of La Paz
  { a: 'uio', b: 'bog', role: 'tree', bow: -0.06 },
  { a: 'bog', b: 'pty', role: 'tree', bow: 0.06 },
  { a: 'bog', b: 'ccs', role: 'tree', bow: -0.06 },
  { a: 'ccs', b: 'sdq', role: 'tree', bow: 0.06 },
  { a: 'pty', b: 'sjo', role: 'tree', bow: 0.06 },
  { a: 'sjo', b: 'gua', role: 'tree', bow: 0.06 },
  { a: 'gua', b: 'mex', role: 'tree', bow: 0.06 },
  { a: 'scl', b: 'cor', role: 'tree', bow: 0.06 },
  { a: 'scl', b: 'bue', role: 'tree', bow: 0.06 },
  { a: 'bue', b: 'mvd', role: 'tree', bow: 0.06 },
  { a: 'sao', b: 'rio', role: 'tree', bow: 0.06 },
  { a: 'sao', b: 'bsb', role: 'tree', bow: -0.06 },
  { a: 'sao', b: 'poa', role: 'tree', bow: -0.06 },
  { a: 'sao', b: 'asu', role: 'tree', bow: -0.06 },
  { a: 'bsb', b: 'mao', role: 'tree', bow: -0.06 },
  { a: 'lim', b: 'bog', role: 'closure', via: ['uio'], bow: 0.06 },
  { a: 'rio', b: 'bsb', role: 'closure', via: ['sao'], bow: -0.06 },
  { a: 'cor', b: 'bue', role: 'closure', via: ['scl'], bow: 0.06 },
  { a: 'bue', b: 'sao', role: 'climax', via: ['scl', 'lim'], bow: -0.03 }, // inland, clear of Porto Alegre
  { a: 'asu', b: 'bue', role: 'reserve', via: ['sao'], bow: -0.06 },
  { a: 'sdq', b: 'bog', role: 'reserve', via: ['ccs'], bow: 0.06 },
  { a: 'asu', b: 'cor', role: 'reserve', via: ['bue'], bow: -0.06 },
];

const K = MAP.height / 828; // user units per css px at 1440×900 (92vh = 828 px)
const round1 = (v) => Math.round(v * 10) / 10;
const byId = Object.fromEntries(CITIES.map((c) => [c.id, c]));

// C = M + 2·bow·L·n, so the curve passes M + bow·L·n at t = .5
export function curve({ a, b, bow }) {
  const { x: x1, y: y1 } = byId[a], { x: x2, y: y2 } = byId[b];
  const L = Math.hypot(x2 - x1, y2 - y1), nx = -(y2 - y1) / L, ny = (x2 - x1) / L;
  const cx = round1((x1 + x2) / 2 + 2 * bow * L * nx), cy = round1((y1 + y2) / 2 + 2 * bow * L * ny);
  return { x1, y1, cx, cy, x2, y2, d: `M${x1} ${y1}Q${cx} ${cy} ${x2} ${y2}` };
}

// arc length in css px at 1440×900 (64-segment polyline)
export function lref(g) {
  const at = (t) => [(1 - t) ** 2 * g.x1 + 2 * (1 - t) * t * g.cx + t * t * g.x2, (1 - t) ** 2 * g.y1 + 2 * (1 - t) * t * g.cy + t * t * g.y2];
  let s = 0, p = at(0);
  for (let i = 1; i <= 64; i++) { const n = at(i / 64); s += Math.hypot(n[0] - p[0], n[1] - p[1]); p = n; }
  return s / K;
}

export const degree = Object.fromEntries(CITIES.map((c) => [c.id, EDGES.filter((e) => e.a === c.id || e.b === c.id).length]));
export const rOf = (d) => Math.max(3.5, Math.min(2.6 + 0.9 * d, 9));

export function markup() {
  const lines = ['  <svg class="hero-net" viewBox="0 0 1953 2385" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">', '    <g class="hn-edges">'];
  for (const e of EDGES) {
    const accent = e.role === 'climax' ? ' is-accent' : '', via = e.via ? ` data-via="${e.via.join(' ')}"` : '';
    lines.push(`      <path class="hn-edge${accent}" data-a="${e.a}" data-b="${e.b}" data-role="${e.role}"${via} d="${curve(e).d}"/>`);
  }
  lines.push('    </g>', '    <g class="hn-halos">');
  for (const c of CITIES) lines.push(`      <circle class="hn-halo" data-city="${c.id}" cx="${c.x}" cy="${c.y}" r="${degree[c.id] >= 4 ? round1((rOf(degree[c.id]) + 8) * K) : 0}"/>`);
  lines.push('    </g>', '    <g class="hn-nodes">');
  for (const c of CITIES) lines.push(`      <circle class="hn-core" data-city="${c.id}" data-name="${c.name}" cx="${c.x}" cy="${c.y}" r="${round1(rOf(degree[c.id]) * K)}"/>`);
  lines.push('    </g>', '  </svg>');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(markup());
