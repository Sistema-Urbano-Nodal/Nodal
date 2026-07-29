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

const G = loadGeo();
const near = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

test('toXYZ places the cardinal points where they belong', () => {
  const [x, y, z] = G.toXYZ(0, 0);
  assert.ok(near(x, 1) && near(y, 0) && near(z, 0));
  const north = G.toXYZ(90, 0);
  assert.ok(near(north[1], 1), 'the north pole is +y');
  assert.ok(G.toXYZ(37.5, -122.3).every((n) => Number.isFinite(n)));
  const unit = G.toXYZ(51.5, -0.12);
  assert.ok(near(Math.hypot(...unit), 1), 'always a unit vector');
});

test('parse reads polygons, lakes and bounding caps', () => {
  const polygons = G.parse('0,0 1,0 1,1 0,1|0.2,0.2 0.8,0.2 0.8,0.8 0.2,0.8;10,10 11,10 11,11 10,11');
  assert.equal(polygons.length, 2);
  assert.equal(polygons[0].rings.length, 2, 'the lake is a second ring');
  assert.equal(polygons[1].rings.length, 1);
  assert.equal(polygons[0].rings[0].length, 4);
  assert.ok(near(Math.hypot(...polygons[0].centroid), 1), 'the cap centroid is normalised');
  assert.ok(polygons[0].capCos > 0.9, 'a one-degree polygon has a tight cap');
  assert.deepEqual(G.parse(''), [], 'no data is not an error');
  assert.deepEqual(G.parse('garbage'), [], 'an unparseable ring is dropped, not thrown');
});

test('isVisible rejects only what is genuinely behind the sphere', () => {
  const identity = (v) => v;
  const [front] = G.parse('0,0 1,0 1,1 0,1');
  assert.equal(G.isVisible(front, identity), true, '+z faces the viewer');
  const [back] = G.parse('179,0 180,0 180,1 179,1');
  assert.equal(G.isVisible(back, identity), false);
  // a polygon straddling the limb must NOT be culled
  const [edge] = G.parse('88,0 92,0 92,2 88,2');
  assert.equal(G.isVisible(edge, identity), true, 'straddling the limb still draws');
});

test('a fully visible ring closes on itself and strokes whole', () => {
  const identity = (v) => v;
  const [poly] = G.parse('0,0 2,0 2,2 0,2');
  const { fill, stroke } = G.clip(poly.rings[0], identity);
  assert.equal(fill.length, 1);
  assert.equal(stroke.length, 1);
  assert.equal(fill[0].length, 4, 'an unclipped ring is passed through untouched');
});

test('a ring wholly behind the sphere yields nothing to draw', () => {
  const identity = (v) => v;
  const [poly] = G.parse('178,0 180,0 180,2 178,2');
  const { fill, stroke } = G.clip(poly.rings[0], identity);
  assert.deepEqual(fill, []);
  assert.deepEqual(stroke, []);
});

test('a clipped ring is closed on the limb but only stroked where there is coast', () => {
  const identity = (v) => v;
  const [poly] = G.parse('80,0 100,0 100,10 80,10');
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
  const identity = (v) => v;
  // starts on the front, crosses to the back, returns to the front — the first
  // and last runs are the same piece of coast and must be merged
  const [poly] = G.parse('0,0 100,0 190,0 260,0');
  const { fill } = G.clip(poly.rings[0], identity);
  assert.equal(fill.length, 1, 'a wrapped run must not be reported as two');
});

test('an open line is split at the limb and never wrapped', () => {
  const identity = (v) => v;
  const meridian = G.graticule(30)[0];
  const runs = G.clipLine(meridian, identity);
  assert.ok(runs.length >= 1);
  assert.ok(runs.every((run) => run.every((p) => p[2] >= -1e-9)));
  // a closed-ring clip would join the two poles with a chord; this must not
  const flat = runs.flat();
  assert.ok(flat.length < meridian.length + 4, 'no wrap-around segment was added');
});

test('limbSweep picks the arc the ring actually went behind', () => {
  // from 0 to PI: going anticlockwise passes through -PI/2, clockwise through PI/2
  assert.equal(G.limbSweep(0, Math.PI, Math.PI / 2), false);
  assert.equal(G.limbSweep(0, Math.PI, -Math.PI / 2), true);
  // wrap-around across the +/-PI seam
  assert.equal(G.limbSweep(3, -3, 3.14), false);
});

test('graticule generates meridians and parallels on the unit sphere', () => {
  const rings = G.graticule(30);
  assert.ok(rings.length >= 12 + 5, 'meridians every 30 plus parallels every 30');
  assert.ok(rings.every((ring) => ring.length > 8), 'each line is sampled, not a chord');
  assert.ok(rings.every((ring) => ring.every((p) => near(Math.hypot(...p), 1, 1e-6))),
    'every graticule point sits on the sphere');
});
