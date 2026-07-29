import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');

/* The browser loads this as a plain <script> that assigns window.NodalGeo, so
   there is nothing to import. Evaluating it against a fake window gives the
   geometry a real test suite without a DOM. */
function loadGeo() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(readFileSync(path.join(ROOT, 'web', 'scripts', 'globe-geo.js'), 'utf8'), context);
  return context.window.NodalGeo;
}

// same trick, for the generated coastline data file — only its string payload
// is used, so there's no realm-identity concern here at all.
function loadCoastline() {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(readFileSync(path.join(ROOT, 'web', 'scripts', 'coastline.js'), 'utf8'), context);
  return context.window.NODAL_COASTLINE;
}

const G = loadGeo();
const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
const identity = (v) => v;

/* Which longitudes face the viewer is not a free choice — it falls out of
   toXYZ, where z = cos(lat) * sin(lon). Under the identity rotation the sphere
   faces longitude 90, the limb runs through longitude 0 and 180, and longitude
   270 is dead centre of the far side. Every fixture below is built on that.

   Note also: this module is evaluated in a vm realm, so its arrays have a
   different Array.prototype than this file's. assert.deepEqual is strict and
   compares prototypes, so it can never match across that boundary — length and
   member checks are used instead. */

test('toXYZ places the cardinal points where they belong', () => {
  const [x, y, z] = G.toXYZ(0, 0);
  assert.ok(near(x, 1) && near(y, 0) && near(z, 0), 'lon 0 sits on the limb');
  assert.ok(near(G.toXYZ(0, 90)[2], 1), 'lon 90 faces the viewer');
  assert.ok(near(G.toXYZ(0, 270)[2], -1), 'lon 270 is the far side');
  assert.ok(near(G.toXYZ(90, 0)[1], 1), 'the north pole is +y');
  assert.ok(near(Math.hypot(...G.toXYZ(51.5, -0.12)), 1), 'always a unit vector');
});

test('parse reads polygons, lakes and bounding caps', () => {
  const polygons = G.parse('0,0 1,0 1,1 0,1|0.2,0.2 0.8,0.2 0.8,0.8 0.2,0.8;10,10 11,10 11,11 10,11');
  assert.equal(polygons.length, 2);
  assert.equal(polygons[0].rings.length, 2, 'the lake is a second ring');
  assert.equal(polygons[1].rings.length, 1);
  assert.equal(polygons[0].rings[0].length, 4);
  assert.ok(near(Math.hypot(...polygons[0].centroid), 1), 'the cap centroid is normalised');
  assert.ok(polygons[0].capCos > 0.9, 'a one-degree polygon has a tight cap');
  assert.equal(G.parse('').length, 0, 'no data is not an error');
  assert.equal(G.parse('garbage').length, 0, 'an unparseable ring is dropped, not thrown');
});

test('isVisible rejects only what is genuinely behind the sphere', () => {
  assert.equal(G.isVisible(G.parse('85,0 95,0 95,5 85,5')[0], identity), true, 'lon 90 faces us');
  assert.equal(G.isVisible(G.parse('265,0 275,0 275,5 265,5')[0], identity), false, 'lon 270 does not');
  // straddling the limb at lon 180 must NOT be culled
  assert.equal(G.isVisible(G.parse('170,0 190,0 190,5 170,5')[0], identity), true);
});

test('a fully visible ring closes on itself and strokes whole', () => {
  const [poly] = G.parse('85,0 95,0 95,5 85,5');
  const { fill, stroke } = G.clip(poly.rings[0], identity);
  assert.equal(fill.length, 1);
  assert.equal(stroke.length, 1);
  assert.equal(fill[0].length, 4, 'an unclipped ring is passed through untouched');
});

test('a ring wholly behind the sphere yields nothing to draw', () => {
  const [poly] = G.parse('265,0 275,0 275,5 265,5');
  const { fill, stroke } = G.clip(poly.rings[0], identity);
  assert.equal(fill.length, 0);
  assert.equal(stroke.length, 0);
});

test('a clipped ring is closed on the limb but only stroked where there is coast', () => {
  const [poly] = G.parse('150,0 210,0 210,10 150,10');
  const { fill, stroke } = G.clip(poly.rings[0], identity);
  assert.equal(fill.length, 1, 'one closed region');
  assert.ok(fill[0].length > 4, 'the limb closure adds points');
  assert.ok(fill[0].every((p) => p[2] >= -1e-9), 'nothing in the fill is behind the sphere');
  assert.ok(stroke.length >= 1);
  assert.ok(stroke.every((run) => run.every((p) => p[2] >= -1e-9)));
  // the crucial property: the limb closure must never be stroked as coastline
  const strokePoints = stroke.reduce((n, run) => n + run.length, 0);
  assert.ok(strokePoints < fill[0].length, 'the stroke is shorter than the closed fill');
});

test('a run spanning index 0 is never split, because the walk starts behind', () => {
  // front, front, back, back — the first and last points are one piece of coast
  const [poly] = G.parse('90,0 170,0 260,0 350,0');
  const { fill } = G.clip(poly.rings[0], identity);
  assert.equal(fill.length, 1, 'a wrapped run must not be reported as two');
});

test('an open line is split at the limb and never wrapped', () => {
  const visible = G.graticule(30)
    .map((line) => G.clipLine(line, identity))
    .filter((runs) => runs.length);
  assert.ok(visible.length > 0, 'some graticule lines cross the visible face');
  assert.ok(visible.every((runs) => runs.every((run) => run.every((p) => p[2] >= -1e-9))),
    'a clipped line never keeps a point behind the sphere');
  // a closed-ring clip would join a meridian's two poles with a chord; this must not
  const meridian = G.graticule(30).find((line) => G.clipLine(line, identity).length);
  const kept = G.clipLine(meridian, identity).reduce((n, run) => n + run.length, 0);
  assert.ok(kept <= meridian.length + 4, 'no wrap-around segment was added');
});

test('clipLine never joins the end of an open line back to its start', () => {
  // hidden -> visible -> visible: the line ends inside the visible face and
  // must not be extended by a spurious crossing back toward the hidden start
  // the way a closed ring's clip() would close a gap along the limb.
  const line = [G.toXYZ(0, 260), G.toXYZ(0, 120), G.toXYZ(0, 90)];
  const runs = G.clipLine(line, identity);
  assert.equal(runs.length, 1, 'one continuous visible run');
  assert.equal(runs[0].length, 3, 'crossing-in plus the two visible points, nothing appended after the last one');
  const last = runs[0][runs[0].length - 1];
  assert.ok(near(last[0], 0) && near(last[2], 1),
    'the run ends at the final visible point, not wrapped back toward the hidden start');
});

test('graticule generates meridians and parallels on the unit sphere', () => {
  const rings = G.graticule(30);
  assert.ok(rings.length >= 12 + 5, 'meridians every 30 plus parallels every 30');
  assert.ok(rings.every((ring) => ring.length > 8), 'each line is sampled, not a chord');
  assert.ok(rings.every((ring) => ring.every((p) => near(Math.hypot(...p), 1, 1e-6))),
    'every graticule point sits on the sphere');
});

/* rotate(), copied verbatim from web/scripts/globe.js, not reimplemented —
   a toy fixture can hide a bug that only the real viewing transform and real
   coastline data expose (that's exactly how the whole-ocean-filled regression
   got past every other test here). yaw/tilt are in degrees to match how the
   renderer's own state and this bug were described, then converted. */
function makeRotate(yawDeg, tiltDeg) {
  const yaw = yawDeg * Math.PI / 180;
  const tilt = tiltDeg * Math.PI / 180;
  const cy = Math.cos(yaw); const sy = Math.sin(yaw);
  const ct = Math.cos(tilt); const st = Math.sin(tilt);
  return (v) => {
    // negated: the face points at longitude yaw + 90 degrees -- see globe.js's rotate()
    const x = -(v[0] * cy + v[2] * sy);
    const z1 = -v[0] * sy + v[2] * cy;
    return [x, v[1] * ct - z1 * st, v[1] * st + z1 * ct];
  };
}

// shoelace formula: absolute area of a closed polygon given as [x, y, z] points
// (z is ignored -- every point clip() emits already lies in the visible half).
function area(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

test('clip() never fills more of the disc than the real coastline actually covers', () => {
  /* This is the test that would have caught the regression the other clip()
     tests could not: a wrongly-chosen closing arc still only emits points on
     the limb (z === 0), which every "nothing is behind the sphere" assertion
     accepts trivially. Only measuring the filled AREA against the disc itself
     (radius 1, area PI) tells the difference between a coastline and an ocean
     painted as land. Several real orientations are used because the bug was
     orientation-dependent: it showed up at some yaw/tilt pairs and not others. */
  const COASTLINE = loadCoastline();
  const polygons = G.parse(COASTLINE);
  assert.ok(polygons.length > 900, 'the real coastline loaded');

  const DISC = Math.PI;
  const rotations = [[-165, -12], [0, -12], [100, -12], [-165, 60], [-20, 10]];

  for (const [yawDeg, tiltDeg] of rotations) {
    const rotate = makeRotate(yawDeg, tiltDeg);
    let total = 0;
    let worst = 0;
    for (const polygon of polygons) {
      if (!G.isVisible(polygon, rotate)) continue;
      const { fill } = G.clip(polygon.rings[0], rotate);
      for (const region of fill) {
        const a = area(region);
        total += a;
        if (a > worst) worst = a;
      }
    }
    assert.ok(worst < 1.6,
      `yaw ${yawDeg}/tilt ${tiltDeg}: no single region should approach the disc (PI = ${DISC.toFixed(3)}); worst was ${worst.toFixed(3)}`);
    assert.ok(total < 2.0,
      `yaw ${yawDeg}/tilt ${tiltDeg}: total filled area should stay well under the disc; Earth is ~29% land; total was ${total.toFixed(3)}`);
  }
});
