/* Spherical geometry for the globe, kept apart from the drawing so it can be
   tested without a canvas. Loaded as a plain script before globe.js.

   Everything here works in unit vectors. "View space" means already rotated:
   +z points at the viewer, so z >= 0 is the visible hemisphere and the limb —
   the sphere's silhouette — is the circle z = 0. */
(() => {
  'use strict';

  const RAD = Math.PI / 180;
  const TAU = Math.PI * 2;

  const toXYZ = (lat, lon) => [
    Math.cos(lat * RAD) * Math.cos(lon * RAD),
    Math.sin(lat * RAD),
    Math.cos(lat * RAD) * Math.sin(lon * RAD),
  ];

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  function normalise(v) {
    const m = Math.hypot(v[0], v[1], v[2]);
    return m ? [v[0] / m, v[1] / m, v[2] / m] : [0, 0, 1];
  }

  function parseRing(text) {
    const points = [];
    for (const pair of text.split(' ')) {
      if (!pair) continue;
      const comma = pair.indexOf(',');
      if (comma === -1) return null;
      const lon = Number(pair.slice(0, comma));
      const lat = Number(pair.slice(comma + 1));
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      points.push(toXYZ(lat, lon));
    }
    return points.length >= 3 ? points : null;
  }

  /* Each polygon gets a bounding cap: the unit centroid of its outer ring and
     the cosine of the angle to its farthest point. One dot product against that
     rejects a whole landmass on the far side before a single point of it is
     projected, which is what pays for the finer coastline. */
  function boundingCap(ring) {
    const sum = ring.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
    const centroid = normalise(sum);
    let capCos = 1;
    for (const p of ring) capCos = Math.min(capCos, dot(centroid, p));
    return { centroid, capCos };
  }

  function parse(text) {
    const polygons = [];
    for (const chunk of String(text || '').split(';')) {
      if (!chunk) continue;
      const rings = chunk.split('|').map(parseRing);
      if (rings.some((r) => r === null) || !rings.length) continue;
      polygons.push({ rings, ...boundingCap(rings[0]) });
    }
    return polygons;
  }

  /* Visible unless the whole cap is behind the limb. The cap half-angle is
     acos(capCos); the polygon is entirely hidden when its centre sits more than
     90 degrees plus that half-angle away from the viewer. */
  function isVisible(polygon, rotate) {
    const z = rotate(polygon.centroid)[2];
    const capSin = Math.sqrt(Math.max(0, 1 - polygon.capCos * polygon.capCos));
    return z > -capSin;
  }

  // where the segment a-b crosses z = 0, pushed back onto the unit circle
  function crossing(a, b) {
    const k = a[2] / (a[2] - b[2]);
    const x = a[0] + (b[0] - a[0]) * k;
    const y = a[1] + (b[1] - a[1]) * k;
    const m = Math.hypot(x, y) || 1;
    return [x / m, y / m, 0];
  }

  const angleOf = (p) => Math.atan2(p[1], p[0]);

  /* True when sweeping from `from` to `to` passes through `via` going the
     negative way round. The caller knows `via` because it is the azimuth of the
     stretch the ring travelled while it was behind the sphere — so this picks
     the arc the coastline actually took, not merely the shorter one. */
  function limbSweep(from, to, via) {
    const forward = (to - from + TAU) % TAU;
    const toVia = (via - from + TAU) % TAU;
    return toVia > forward;
  }

  /* Splits a closed ring at the limb. Returns the closed regions to fill and,
     kept separate, only the runs that are real coastline — closing a region
     along the limb must never be stroked as if it were a shore.

     The walk starts from a point that is BEHIND the sphere. That is not a
     detail: it means no run is ever split across index 0, so there is nothing
     to stitch back together afterwards, and every run is followed by exactly
     one hidden stretch whose azimuth tells us which way round the limb to
     close. */
  function clip(ring, rotate) {
    const view = ring.map(rotate);
    if (view.every((p) => p[2] < 0)) return { fill: [], stroke: [] };
    if (view.every((p) => p[2] >= 0)) return { fill: [view], stroke: [view] };

    let start = 0;
    while (view[start][2] >= 0) start += 1;

    const runs = [];
    const hiddens = [];      // hiddens[i] is the stretch that PRECEDES runs[i]
    let current = null;
    let hidden = [];
    for (let k = 0; k < view.length; k += 1) {
      const a = view[(start + k) % view.length];
      const b = view[(start + k + 1) % view.length];
      if (a[2] < 0) {
        hidden.push(a);
        if (b[2] >= 0) {
          hiddens.push(hidden);
          hidden = [];
          current = [crossing(a, b)];
          runs.push(current);
        }
      } else {
        current.push(a);
        if (b[2] < 0) { current.push(crossing(a, b)); current = null; }
      }
    }
    if (!runs.length) return { fill: [], stroke: [] };

    /* The gap AFTER runs[i] is the stretch before the next run, wrapping to
       hiddens[0] for the last one. Its midpoint says where the coastline went
       while it was out of sight, which is the arc we close along. */
    const viaAngle = (i) => {
      const gap = hiddens[(i + 1) % hiddens.length];
      return angleOf(gap[Math.floor(gap.length / 2)]);
    };

    const region = [];
    for (let i = 0; i < runs.length; i += 1) {
      const piece = runs[i];
      const next = runs[(i + 1) % runs.length];
      region.push(...piece);
      const from = angleOf(piece[piece.length - 1]);
      const to = angleOf(next[0]);
      const forward = (to - from + TAU) % TAU;
      const sweep = limbSweep(from, to, viaAngle(i)) ? forward - TAU : forward;
      const steps = Math.max(2, Math.ceil(Math.abs(sweep) / 0.15));
      for (let s = 1; s <= steps; s += 1) {
        const angle = from + (sweep * s) / steps;
        region.push([Math.cos(angle), Math.sin(angle), 0]);
      }
    }
    return { fill: [region], stroke: runs.map((r) => r.slice()) };
  }

  /* An open polyline — a graticule line, not a coastline. Split at the limb and
     never wrapped, because the last point does not join back to the first: a
     meridian's ends are the two poles, and closing it would draw a chord
     straight through the sphere. */
  function clipLine(points, rotate) {
    const view = points.map(rotate);
    const runs = [];
    let run = null;
    for (let i = 0; i < view.length; i += 1) {
      const a = view[i];
      const b = view[i + 1];
      if (a[2] >= 0) {
        if (!run) { run = []; runs.push(run); }
        run.push(a);
        if (b && b[2] < 0) { run.push(crossing(a, b)); run = null; }
      } else if (b && b[2] >= 0) {
        run = [crossing(a, b)];
        runs.push(run);
      }
    }
    return runs.filter((r) => r.length > 1);
  }

  /* Meridians and parallels, generated rather than stored. Sampled finely
     enough that a 30-degree arc never shows as a chord. */
  function graticule(stepDegrees = 30) {
    const step = Math.max(5, Number(stepDegrees) || 30);
    const rings = [];
    for (let lon = -180; lon < 180; lon += step) {
      const ring = [];
      for (let lat = -90; lat <= 90; lat += 3) ring.push(toXYZ(lat, lon));
      rings.push(ring);
    }
    for (let lat = -90 + step; lat < 90; lat += step) {
      const ring = [];
      for (let lon = -180; lon <= 180; lon += 3) ring.push(toXYZ(lat, lon));
      rings.push(ring);
    }
    return rings;
  }

  window.NodalGeo = { toXYZ, parse, isVisible, clip, clipLine, graticule, limbSweep, dot };
})();
