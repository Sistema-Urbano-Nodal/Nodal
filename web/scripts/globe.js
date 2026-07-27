/* NODAL global network — a real globe: Natural Earth coastlines under the
   live network of members, drawn on a transparent canvas so it sits on the
   page like a cut-out rather than inside a panel.

   No libraries. The orthographic projection is trigonometry and the coastline
   ships as data (see scripts/build-coastline.js), so nothing is fetched at
   runtime except the directory itself.

   New members appear while you watch: the directory is polled, and a city
   that gains someone pulses. Only members who opted into the directory in
   Part C are counted — the same promise Part C makes. A node names a place
   and a count, never a person. */
(() => {
  'use strict';

  const canvas = document.getElementById('globeCanvas');
  if (!canvas) return;

  const I18N = window.nodalI18n;
  const t = (key, vars) => (I18N ? I18N.t(key, vars) : key);
  const RAD = Math.PI / 180;
  const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const toXYZ = (lat, lon) => [
    Math.cos(lat * RAD) * Math.cos(lon * RAD),
    Math.sin(lat * RAD),
    Math.cos(lat * RAD) * Math.sin(lon * RAD),
  ];

  /* ---------- the land ---------- */
  const LAND = (window.NODAL_COASTLINE || '').split(';').filter(Boolean).map((ring) => ring
    .split(' ')
    .map((pair) => {
      const [lon, lat] = pair.split(',');
      return toXYZ(Number(lat), Number(lon));
    }));

  /* Nothing on this globe is invented. Every node is a city a member typed
     into their own profile, resolved to real coordinates by the server. A node
     moves only when that member changes their city — there is no browser
     geolocation here and there never should be. */
  let PLACES = [];

  /* ---------- the cage ----------
     A geodesic shell sitting just outside the sphere: the structure the globe
     is drawn on, not data. Deliberately a hairline with pinprick vertices so
     it can never be mistaken for a member — members are the filled green nodes
     and nothing else. Built from an icosahedron subdivided once: 42 vertices,
     120 struts, generated rather than stored. */
  const CAGE_R = 1.075;
  const CAGE = (() => {
    const t = (1 + Math.sqrt(5)) / 2;
    const unit = (v) => { const m = Math.hypot(...v); return [v[0] / m, v[1] / m, v[2] / m]; };
    let verts = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ].map(unit);
    let faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    const mid = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (mid.has(key)) return mid.get(key);
      const i = verts.push(unit([
        (verts[a][0] + verts[b][0]) / 2,
        (verts[a][1] + verts[b][1]) / 2,
        (verts[a][2] + verts[b][2]) / 2,
      ])) - 1;
      mid.set(key, i);
      return i;
    };
    faces = faces.flatMap(([a, b, c]) => {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
    const struts = new Set();
    faces.forEach(([a, b, c]) => [[a, b], [b, c], [c, a]].forEach(([x, y]) => {
      struts.add(x < y ? `${x}:${y}` : `${y}:${x}`);
    }));
    return {
      verts,
      struts: [...struts].map((k) => k.split(':').map(Number)),
    };
  })();

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let EDGES = [];
  function rebuildEdges() {
    EDGES = [];
    const seen = new Set();
    const link = (a, b) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (a !== b && !seen.has(key)) { seen.add(key); EDGES.push([a, b]); }
    };
    PLACES.forEach((n) => {
      PLACES.filter((o) => o !== n)
        .sort((x, y) => dot(n.v, y.v) - dot(n.v, x.v))
        .slice(0, 3)
        .forEach((o) => link(n.i, o.i));
    });
    /* Then one long reach per place, to the node furthest from it. Nearest
       neighbours alone would draw clusters; this is what makes the map read as
       one network. No city names appear here — the set is whatever the
       directory happens to contain. */
    PLACES.forEach((n) => {
      const farthest = PLACES.reduce(
        (worst, o) => (o !== n && (!worst || dot(n.v, o.v) < dot(n.v, worst.v)) ? o : worst), null);
      if (farthest) link(n.i, farthest.i);
    });
  }
  const neighbours = (i) => EDGES.filter(([a, b]) => a === i || b === i)
    .map(([a, b]) => PLACES[a === i ? b : a]);

  const slerp = (a, b, s) => {
    const om = Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
    if (om < 1e-6) return a;
    const k1 = Math.sin((1 - s) * om) / Math.sin(om);
    const k2 = Math.sin(s * om) / Math.sin(om);
    return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
  };

  const SPIN = 0.036;    // radians per SECOND — a full turn takes about three minutes
  const ctx = canvas.getContext('2d');
  // the meridian facing the viewer is yaw + 90°, so this opens on the Americas
  const state = { yaw: (-75 - 90) * RAD, tilt: -12 * RAD, hover: -1, picked: -1, drag: false, visible: true };
  let W = 0; let H = 0; let R = 0; let CX = 0; let CY = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = window.devicePixelRatio || 1;
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = Math.min(W, H) * 0.445;   // leaves room for the cage at 1.075
    CX = W / 2; CY = H / 2;
  }

  /* The rotation only changes once a frame, but it is applied to every one of
     several thousand coastline points — so the four trig calls are hoisted out
     of the inner loop and refreshed once per draw. */
  let cy = 1; let sy = 0; let ct = 1; let st = 0;
  function syncRotation() {
    cy = Math.cos(state.yaw); sy = Math.sin(state.yaw);
    ct = Math.cos(state.tilt); st = Math.sin(state.tilt);
  }
  function rotate(v) {
    // negated: the face points at longitude yaw + 90°, which makes
    // (v.x·cos + v.z·sin) the negative of sin(lon − centre). Without this the
    // whole world is a mirror image and east falls on the left.
    const x = -(v[0] * cy + v[2] * sy);
    const z1 = -v[0] * sy + v[2] * cy;
    return [x, v[1] * ct - z1 * st, v[1] * st + z1 * ct];
  }
  const screenOf = (r) => [CX + R * r[0], CY - R * r[1]];
  function project(v) {
    const r = rotate(v);
    return [CX + R * r[0], CY - R * r[1], r[2]];
  }

  /* Clip a ring against the visible hemisphere. Where an edge crosses the
     horizon the crossing point is interpolated and pushed back onto the unit
     sphere, so the landmass ends exactly on the limb instead of being smeared
     around it. A ring wholly on the far side simply disappears. */
  function clipToFront(ring) {
    const view = ring.map(rotate);
    const runs = [];
    let run = null;
    const cross = (a, b) => {
      const k = a[2] / (a[2] - b[2]);
      const p = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, 0];
      const m = Math.hypot(p[0], p[1]) || 1;
      return [p[0] / m, p[1] / m, 0];
    };
    for (let i = 0; i < view.length; i += 1) {
      const a = view[i];
      const b = view[(i + 1) % view.length];
      if (a[2] >= 0) {
        if (!run) { run = []; runs.push(run); }
        run.push(a);
        if (b[2] < 0) { run.push(cross(a, b)); run = null; }
      } else if (b[2] >= 0) {
        run = [cross(a, b)];
        runs.push(run);
      }
    }
    return runs.filter((r) => r.length > 1);
  }

  /* Coastlines are drawn as open lines, never closed polygons. Closing a
     clipped ring would need a chord across the sphere, and on a landmass as
     wide as Eurasia that chord cuts straight through the visible face. Lines
     have no such seam at any rotation — and a globe drawn in outline is the
     same engraved language the rest of the console speaks. */
  function land() {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    LAND.forEach((ring) => {
      clipToFront(ring).forEach((run) => {
        const pts = run.map(screenOf);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.strokeStyle = 'rgba(61,92,56,.8)';
        ctx.lineWidth = 1.15;
        ctx.stroke();
      });
    });
  }

  function cage() {
    const scale = (v) => [v[0] * CAGE_R, v[1] * CAGE_R, v[2] * CAGE_R];
    CAGE.struts.forEach(([ai, bi]) => {
      const a = CAGE.verts[ai];
      const b = CAGE.verts[bi];
      const pts = [];
      for (let k = 0; k <= 6; k += 1) pts.push(project(scale(slerp(a, b, k / 6))));
      strokeArc(pts, 'rgba(61,92,56,.3)', 'rgba(61,92,56,.09)', 0.7);
    });
    CAGE.verts.forEach((v) => {
      const [x, y, z] = project(scale(v));
      ctx.beginPath();
      ctx.arc(x, y, z >= 0 ? 1.5 : 1, 0, Math.PI * 2);
      ctx.fillStyle = z >= 0 ? 'rgba(61,92,56,.45)' : 'rgba(61,92,56,.13)';
      ctx.fill();
    });
  }

  function limb() {
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(61,92,56,.38)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  function strokeArc(points, front, back, width) {
    let run = [];
    let side = null;
    const flush = () => {
      if (run.length > 1) {
        ctx.beginPath();
        ctx.moveTo(run[0][0], run[0][1]);
        for (let i = 1; i < run.length; i += 1) ctx.lineTo(run[i][0], run[i][1]);
        ctx.strokeStyle = side ? front : back;
        ctx.lineWidth = width;
        ctx.stroke();
      }
      run = [];
    };
    points.forEach((p) => {
      const isFront = p[2] >= 0;
      if (!back && !isFront) { flush(); return; }
      if (side === null) side = isFront;
      if (isFront !== side) { flush(); side = isFront; }
      run.push(p);
    });
    flush();
  }

  function connections() {
    const active = state.picked >= 0 ? state.picked : state.hover;
    EDGES.forEach(([ai, bi]) => {
      const lit = active >= 0 && (ai === active || bi === active);
      if (active >= 0 && !lit) return;
      const span = Math.acos(Math.min(1, Math.max(-1, dot(PLACES[ai].v, PLACES[bi].v))));
      const bow = 0.05 * (1 - span / Math.PI);      // long hauls hug the surface
      const pts = [];
      for (let s = 0; s <= 26; s += 1) {
        const k = s / 26;
        const p = slerp(PLACES[ai].v, PLACES[bi].v, k);
        const lift = 1 + bow * Math.sin(Math.PI * k);
        pts.push(project([p[0] * lift, p[1] * lift, p[2] * lift]));
      }
      strokeArc(pts, lit ? 'rgba(47,130,42,1)' : 'rgba(89,188,83,.75)', 'rgba(89,188,83,.16)', lit ? 2 : 1.1);
    });
  }

  const screen = [];
  function nodes(time) {
    screen.length = 0;
    PLACES.forEach((n) => {
      const [x, y, z] = project(n.v);
      screen.push({ i: n.i, x, y, z });
      if (z < 0) return;
      const active = n.i === state.picked || n.i === state.hover;
      // a place exists only because someone is there, so every node is a member node
      const r = 3.6 + Math.sqrt(n.members) * 1.1;

      // a place that just gained a member rings out for a few seconds
      if (n.arrived && !calm()) {
        const age = (time - n.arrived) / 2600;
        if (age < 1) {
          ctx.beginPath();
          ctx.arc(x, y, r + age * 26, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(89,188,83,${(0.75 * (1 - age)).toFixed(3)})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        } else { n.arrived = 0; }
      }
      const glow = ctx.createRadialGradient(x, y, 0, x, y, r + 9);
      glow.addColorStop(0, 'rgba(89,188,83,.5)');
      glow.addColorStop(1, 'rgba(89,188,83,0)');
      ctx.beginPath();
      ctx.arc(x, y, r + 9, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#25341f' : '#59bc53';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      if (active) {
        ctx.font = '700 12px Montserrat, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#25341f';
        ctx.fillText(n.name, x, y - r - 11);
      }
    });
  }

  let lastFrame = 0;
  function frame(time) {
    // tied to elapsed time, not to frame count: a 120Hz display must not spin
    // the world twice as fast as a 60Hz one
    const dt = lastFrame ? Math.min((time - lastFrame) / 1000, 0.1) : 0;
    lastFrame = time;
    if (state.visible) {
      ctx.clearRect(0, 0, W, H);
      if (!state.drag && !calm()) state.yaw -= SPIN * dt;
      syncRotation();
      cage();
      limb();
      land();
      connections();
      nodes(time);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- the panel ---------- */
  const card = document.getElementById('globeCard');
  const hint = document.getElementById('globeHint');
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

  function showPlace(place) {
    if (!card || !hint) return;
    if (!place) { card.hidden = true; hint.hidden = false; return; }
    hint.hidden = true;
    card.hidden = false;
    set('globeCity', place.name);
    set('globeLabel', place.label && place.label !== place.name ? place.label : '');
    set('globeCount', t('d.globe.members', { n: place.members }));

    const list = document.getElementById('globePeople');
    if (list) {
      list.replaceChildren(...(place.people || []).map((m) => {
        const row = document.createElement('li');
        const who = document.createElement('a');
        who.className = 'globe-person';
        who.href = `profile.html?id=${encodeURIComponent(m.id)}`;
        who.textContent = m.name;
        row.appendChild(who);
        if (m.role) {
          const role = document.createElement('span');
          role.textContent = m.role;
          row.appendChild(role);
        }
        if (m.linkedin) {
          const li = document.createElement('a');
          li.className = 'globe-contact';
          li.href = m.linkedin;
          li.target = '_blank';
          li.rel = 'noopener noreferrer';
          li.textContent = 'LinkedIn';
          row.appendChild(li);
        }
        return row;
      }));
    }
    set('globeLinks', neighbours(place.i).map((o) => o.name).join(', '));
  }

  function pick(ev) {
    syncRotation();
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    let best = -1;
    let bestD = 16;
    screen.forEach(({ i, x, y, z }) => {
      if (z < 0) return;
      const d = Math.hypot(x - mx, y - my);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  canvas.addEventListener('pointermove', (ev) => {
    if (state.drag) {
      state.yaw -= ev.movementX * 0.005;
      state.tilt = Math.max(-1.1, Math.min(1.1, state.tilt - ev.movementY * 0.004));
      return;
    }
    state.hover = pick(ev);
    canvas.style.cursor = state.hover >= 0 ? 'pointer' : 'grab';
  });
  canvas.addEventListener('pointerdown', (ev) => { state.drag = true; canvas.setPointerCapture(ev.pointerId); });
  canvas.addEventListener('pointerup', (ev) => {
    state.drag = false;
    const hit = pick(ev);
    state.picked = hit === state.picked ? -1 : hit;
    showPlace(state.picked >= 0 ? PLACES[state.picked] : null);
  });
  canvas.addEventListener('pointerleave', () => { state.drag = false; state.hover = -1; });
  canvas.addEventListener('keydown', (ev) => {
    if (!['ArrowRight', 'ArrowLeft'].includes(ev.key)) return;
    ev.preventDefault();
    state.picked = (state.picked + (ev.key === 'ArrowRight' ? 1 : -1) + PLACES.length) % PLACES.length;
    const p = PLACES[state.picked];
    state.yaw = Math.atan2(p.v[2], p.v[0]) - Math.PI / 2;   // centre = yaw + 90°
    showPlace(p);
  });

  /* ---------- the directory, live ---------- */
  const normalise = (s2) => String(s2 || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  /* Arrivals are detected by comparing each city's roster as a multiset, not
     by name alone: two members can share a name in the same city, and the
     endpoint deliberately withholds member ids. */
  const roster = new Map();
  let started = false;
  const bag = (people) => {
    const counts = new Map();
    people.forEach((m) => {
      const key = `${normalise(m.name)}|${normalise(m.role)}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  };
  function newcomers(city, people) {
    const before = roster.get(city) || new Map();
    const after = bag(people);
    const added = [];
    after.forEach((n, key) => {
      const gained = n - (before.get(key) || 0);
      for (let k = 0; k < gained; k += 1) {
        added.push(people.find((m) => `${normalise(m.name)}|${normalise(m.role)}` === key));
      }
    });
    roster.set(city, after);
    return added;
  }

  function spinTo(place) {
    state.picked = place.i;
    state.yaw = Math.atan2(place.v[2], place.v[0]) - Math.PI / 2;
    showPlace(place);
  }

  function mergePlaces(live) {
    const kept = new Map(PLACES.map((p) => [normalise(p.name), p.arrived]));
    PLACES = live.map((L, i) => ({
      i,
      name: L.city,
      label: L.label || L.city,
      members: L.members,
      people: L.people || [],
      arrived: kept.get(normalise(L.city)) || 0,
      v: toXYZ(L.lat, L.lon),
    }));
    rebuildEdges();
    if (state.picked >= PLACES.length) state.picked = -1;
  }

  function sayWhereYouStand(you) {
    const note = document.getElementById('globeYou');
    const cta = document.getElementById('globeYouCta');
    if (!note || !cta) return;
    let key = null;
    if (!you) { note.hidden = true; cta.hidden = true; return; }
    if (!you.listed) key = 'd.globe.youNotListed';
    else if (!you.hasCity) key = 'd.globe.youNoCity';
    else if (!you.onMap) key = 'd.globe.youUnplaced';
    if (!key) { note.hidden = true; cta.hidden = true; return; }
    note.textContent = key === 'd.globe.youUnplaced' ? t(key, { city: you.city }) : t(key);
    note.hidden = false;
    cta.hidden = you.listed && you.hasCity;
  }

  async function poll() {
    let data;
    try {
      const res = await fetch('/api/network/places', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      data = await res.json();
      if (!Array.isArray(data.places)) return;
    } catch { return; }          // static hosting: the backdrop still draws

    mergePlaces(data.places);
    sayWhereYouStand(data.you);

    const arrivals = [];
    PLACES.forEach((place) => {
      const added = newcomers(normalise(place.name), place.people || []);
      if (started) added.forEach((person) => arrivals.push({ person, place }));
    });
    started = true;

    set('globeEyebrow', t('d.globe.eyebrow', { cities: PLACES.length, members: data.members ?? 0 }));
    const empty = document.getElementById('globeEmpty');
    if (empty) empty.hidden = PLACES.length > 0;

    arrivals.forEach(({ person, place }) => {
      place.arrived = performance.now();
      announce(person, place);
    });
    if (arrivals.length && state.picked < 0) spinTo(arrivals[arrivals.length - 1].place);
    else if (state.picked >= 0) showPlace(PLACES[state.picked]);
  }

  const feed = document.getElementById('globeFeed');
  function announce(person, place) {
    if (!feed) return;
    const row = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = person.name;
    const where = document.createElement('span');
    where.textContent = `${person.role ? `${person.role} · ` : ''}${place.name}`;
    row.append(name, where);
    feed.prepend(row);
    while (feed.children.length > 4) feed.lastElementChild.remove();
    feed.hidden = false;
    document.getElementById('globeFeedLabel')?.removeAttribute('hidden');
  }

  document.getElementById('globeYouCta')?.addEventListener('click', () => {
    document.getElementById('partCBtn')?.click();
  });

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { state.visible = e.isIntersecting; });
  }, { rootMargin: '80px' });
  io.observe(canvas);

  window.addEventListener('resize', resize);
  I18N?.onChange(() => showPlace(state.picked >= 0 ? PLACES[state.picked] : null));
  resize();
  requestAnimationFrame(frame);
  poll();
  setInterval(poll, 8000);    // the server caches 3s, so a change lands within ~11s
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
