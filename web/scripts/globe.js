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

  /* ---------- where NODAL organises ---------- */
  const PLACES = [
    ['Lima', -12.05, -77.04], ['São Paulo', -23.55, -46.63], ['Bogotá', 4.71, -74.07],
    ['Ciudad de México', 19.43, -99.13], ['Buenos Aires', -34.60, -58.38], ['Santiago', -33.45, -70.67],
    ['Quito', -0.18, -78.47], ['Recife', -8.05, -34.88], ['Medellín', 6.24, -75.58],
    ['Montevideo', -34.90, -56.16], ['Guadalajara', 20.67, -103.35], ['Belo Horizonte', -19.92, -43.94],
    ['San José', 9.93, -84.08], ['Ciudad de Panamá', 8.98, -79.52], ['La Paz', -16.50, -68.15],
    ['Asunción', -25.28, -57.63], ['Ciudad de Guatemala', 14.63, -90.51], ['La Habana', 23.11, -82.37],
    ['Porto Alegre', -30.03, -51.23], ['Curitiba', -25.43, -49.27], ['Salvador', -12.97, -38.51],
    ['Fortaleza', -3.73, -38.53], ['Cali', 3.44, -76.52], ['Rosario', -32.95, -60.64],
    ['Tegucigalpa', 14.07, -87.19], ['Madrid', 40.42, -3.70], ['Lisboa', 38.72, -9.14],
    ['Barcelona', 41.39, 2.17], ['New York', 40.71, -74.01], ['Toronto', 43.65, -79.38],
    ['London', 51.51, -0.13], ['Paris', 48.86, 2.35], ['Berlin', 52.52, 13.40],
    ['Nairobi', -1.29, 36.82], ['Lagos', 6.52, 3.38], ['Cape Town', -33.92, 18.42],
    ['Accra', 5.60, -0.19], ['Cairo', 30.04, 31.24], ['Mumbai', 19.08, 72.88],
    ['Delhi', 28.61, 77.21], ['Bangkok', 13.76, 100.50], ['Jakarta', -6.21, 106.85],
    ['Manila', 14.60, 120.98], ['Singapore', 1.35, 103.82], ['Seoul', 37.57, 126.98],
    ['Tokyo', 35.68, 139.65], ['Sydney', -33.87, 151.21], ['Auckland', -36.85, 174.76],
  ].map(([name, lat, lon], i) => ({ i, name, members: 0, roles: [], arrived: 0, v: toXYZ(lat, lon) }));

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const EDGES = [];
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
  [[0, 25], [1, 28], [3, 30], [2, 26], [4, 31], [33, 1], [38, 0], [45, 5], [34, 8]]
    .forEach(([a, b]) => link(a, b));
  const neighbours = (i) => EDGES.filter(([a, b]) => a === i || b === i)
    .map(([a, b]) => PLACES[a === i ? b : a]);

  const slerp = (a, b, s) => {
    const om = Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
    if (om < 1e-6) return a;
    const k1 = Math.sin((1 - s) * om) / Math.sin(om);
    const k2 = Math.sin(s * om) / Math.sin(om);
    return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
  };

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
    R = Math.min(W, H) * 0.45;
    CX = W / 2; CY = H / 2;
  }

  function rotate(v) {
    const cy = Math.cos(state.yaw);
    const sy = Math.sin(state.yaw);
    const x = v[0] * cy + v[2] * sy;
    const z1 = -v[0] * sy + v[2] * cy;
    const ct = Math.cos(state.tilt);
    const st = Math.sin(state.tilt);
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
      const has = n.members > 0;
      const r = (has ? 3.6 : 2.2) + Math.sqrt(n.members) * 1.1;

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
      if (has) {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, r + 9);
        glow.addColorStop(0, 'rgba(89,188,83,.5)');
        glow.addColorStop(1, 'rgba(89,188,83,0)');
        ctx.beginPath();
        ctx.arc(x, y, r + 9, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#25341f' : has ? '#59bc53' : 'rgba(255,255,255,.9)';
      ctx.fill();
      if (!has) {
        ctx.strokeStyle = 'rgba(61,92,56,.75)';
        ctx.lineWidth = 1.3;
        ctx.stroke();
      }
      if (has) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      if (active) {
        ctx.font = '700 12px Montserrat, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#25341f';
        ctx.fillText(n.name, x, y - r - 11);
      }
    });
  }

  function frame(time) {
    if (state.visible) {
      ctx.clearRect(0, 0, W, H);
      if (!state.drag && !calm()) state.yaw += 0.0014;
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
    set('globeCount', place.members ? t('d.globe.members', { n: place.members }) : t('d.globe.noMembers'));
    set('globeRoles', place.roles.length ? [...new Set(place.roles)].slice(0, 4).join(' · ') : t('d.globe.noRoles'));
    set('globeLinks', neighbours(place.i).map((o) => o.name).join(', '));
  }

  function pick(ev) {
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
      state.yaw += ev.movementX * 0.005;
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
  const normalise = (s) => String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  const byCity = new Map(PLACES.map((p) => [normalise(p.name), p]));
  const known = new Set();
  let started = false;

  function spinTo(place) {
    state.picked = place.i;
    state.yaw = Math.atan2(place.v[2], place.v[0]) - Math.PI / 2;
    showPlace(place);
  }

  async function poll() {
    let users;
    try {
      const res = await fetch('/api/users', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      users = (await res.json()).users;
      if (!Array.isArray(users)) return;
    } catch { return; }               // static hosting: the map still draws

    const arrivals = [];
    PLACES.forEach((p) => { p.members = 0; p.roles = []; });
    users.forEach((u) => {
      const place = byCity.get(normalise(u.city));
      if (!place) return;
      place.members += 1;
      if (u.role) place.roles.push(u.role);
      if (started && !known.has(u.id)) arrivals.push({ user: u, place });
      known.add(u.id);
    });
    if (!started) users.forEach((u) => known.add(u.id));
    started = true;

    const reached = PLACES.filter((p) => p.members > 0).length;
    set('globeEyebrow', t('d.globe.eyebrow', { n: reached, total: PLACES.length }));

    arrivals.forEach(({ user, place }) => {
      place.arrived = performance.now();
      announce(user, place);
    });
    if (arrivals.length && state.picked < 0) spinTo(arrivals[arrivals.length - 1].place);
  }

  const feed = document.getElementById('globeFeed');
  function announce(user, place) {
    if (!feed) return;
    const row = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = user.name;
    const where = document.createElement('span');
    where.textContent = `${user.role ? `${user.role} · ` : ''}${place.name}`;
    row.append(name, where);
    feed.prepend(row);
    while (feed.children.length > 4) feed.lastElementChild.remove();
    feed.hidden = false;
    document.getElementById('globeFeedLabel')?.removeAttribute('hidden');
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { state.visible = e.isIntersecting; });
  }, { rootMargin: '80px' });
  io.observe(canvas);

  window.addEventListener('resize', resize);
  I18N?.onChange(() => showPlace(state.picked >= 0 ? PLACES[state.picked] : null));
  resize();
  requestAnimationFrame(frame);
  poll();
  setInterval(poll, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
