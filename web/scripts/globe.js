/* NODAL global network — an orthographic sphere drawn from nodes and the
   great-circle connections between them. There is no graticule: the sphere
   exists because the network describes it.

   No libraries — the projection is trigonometry, so it runs under
   script-src 'self'. Canvas rather than SVG because every frame redraws.

   City coordinates are real. Member counts come from the directory
   (/api/users) and are matched by city name; a city the directory has not
   reached yet still shows as a node, dimmer, with an honest zero. Following
   the rule the landing graph already sets, a node names a place and a kind of
   work — never an invented person. */
(() => {
  'use strict';

  const canvas = document.getElementById('globeCanvas');
  if (!canvas) return;

  const I18N = window.nodalI18n;
  const t = (key, vars) => (I18N ? I18N.t(key, vars) : key);
  const RAD = Math.PI / 180;
  const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Where NODAL is organising. Latitude, longitude, and the topics that work
     in each place is grouped under. */
  const PLACES = [
    ['Lima', -12.05, -77.04, ['Mobility', 'Public space']],
    ['São Paulo', -23.55, -46.63, ['Housing', 'Urban data & tech']],
    ['Bogotá', 4.71, -74.07, ['Mobility', 'Governance & participation']],
    ['Ciudad de México', 19.43, -99.13, ['Public space', 'Climate & resilience']],
    ['Buenos Aires', -34.60, -58.38, ['Housing', 'Heritage']],
    ['Santiago', -33.45, -70.67, ['Climate & resilience', 'Urban data & tech']],
    ['Quito', -0.18, -78.47, ['Governance & participation', 'Informality']],
    ['Recife', -8.05, -34.88, ['Climate & resilience', 'Housing']],
    ['Medellín', 6.24, -75.58, ['Mobility', 'Safety']],
    ['Montevideo', -34.90, -56.16, ['Public space']],
    ['Guadalajara', 20.67, -103.35, ['Mobility']],
    ['Belo Horizonte', -19.92, -43.94, ['Urban data & tech']],
    ['San José', 9.93, -84.08, ['Environment & nature']],
    ['Ciudad de Panamá', 8.98, -79.52, ['Land use & planning']],
    ['La Paz', -16.50, -68.15, ['Informality', 'Mobility']],
    ['Asunción', -25.28, -57.63, ['Land use & planning']],
    ['Ciudad de Guatemala', 14.63, -90.51, ['Safety']],
    ['La Habana', 23.11, -82.37, ['Heritage']],
    ['Porto Alegre', -30.03, -51.23, ['Governance & participation']],
    ['Curitiba', -25.43, -49.27, ['Mobility', 'Environment & nature']],
    ['Salvador', -12.97, -38.51, ['Heritage', 'Care & gender']],
    ['Fortaleza', -3.73, -38.53, ['Climate & resilience']],
    ['Cali', 3.44, -76.52, ['Safety', 'Public space']],
    ['Rosario', -32.95, -60.64, ['Land use & planning']],
    ['Tegucigalpa', 14.07, -87.19, ['Informality']],
    ['Madrid', 40.42, -3.70, ['Governance & participation']],
    ['Lisboa', 38.72, -9.14, ['Heritage']],
    ['Barcelona', 41.39, 2.17, ['Public space']],
    ['New York', 40.71, -74.01, ['Urban data & tech']],
    ['Toronto', 43.65, -79.38, ['Housing']],
    ['London', 51.51, -0.13, ['Urban data & tech']],
    ['Paris', 48.86, 2.35, ['Mobility']],
    ['Berlin', 52.52, 13.40, ['Climate & resilience']],
    ['Nairobi', -1.29, 36.82, ['Informality', 'Climate & resilience']],
    ['Lagos', 6.52, 3.38, ['Housing']],
    ['Cape Town', -33.92, 18.42, ['Governance & participation']],
    ['Accra', 5.60, -0.19, ['Public space']],
    ['Cairo', 30.04, 31.24, ['Heritage']],
    ['Mumbai', 19.08, 72.88, ['Informality']],
    ['Delhi', 28.61, 77.21, ['Climate & resilience']],
    ['Bangkok', 13.76, 100.50, ['Mobility']],
    ['Jakarta', -6.21, 106.85, ['Climate & resilience', 'Housing']],
    ['Manila', 14.60, 120.98, ['Safety']],
    ['Singapore', 1.35, 103.82, ['Land use & planning']],
    ['Seoul', 37.57, 126.98, ['Urban data & tech']],
    ['Tokyo', 35.68, 139.65, ['Public space']],
    ['Sydney', -33.87, 151.21, ['Environment & nature']],
    ['Auckland', -36.85, 174.76, ['Environment & nature']],
  ].map(([name, lat, lon, topics], i) => ({
    i, name, topics, members: 0,
    v: [
      Math.cos(lat * RAD) * Math.cos(lon * RAD),
      Math.sin(lat * RAD),
      Math.cos(lat * RAD) * Math.sin(lon * RAD),
    ],
  }));

  const TOPIC_KEYS = new Map([
    ['Mobility', 'mobility'], ['Public space', 'publicSpace'], ['Housing', 'housing'],
    ['Climate & resilience', 'climate'], ['Care & gender', 'care'],
    ['Governance & participation', 'governance'], ['Safety', 'safety'],
    ['Informality', 'informality'], ['Heritage', 'heritage'],
    ['Urban data & tech', 'urbanData'], ['Land use & planning', 'landUse'],
    ['Environment & nature', 'environment'],
  ]);
  const topicLabel = (name) => (TOPIC_KEYS.has(name) ? t(`d.topic.${TOPIC_KEYS.get(name)}`) : name);

  /* Connections: each place reaches its nearest peers, plus a handful of
     deliberate long hauls so the sphere reads as one network rather than
     separate clusters. */
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
  const neighbours = (i) => EDGES
    .filter(([a, b]) => a === i || b === i)
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
  const state = { yaw: (-75 - 90) * RAD, tilt: -18 * RAD, hover: -1, picked: -1, drag: false, visible: true };
  let W = 0; let H = 0; let R = 0; let CX = 0; let CY = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = window.devicePixelRatio || 1;
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = Math.min(W, H) * 0.44;
    CX = W / 2; CY = H / 2;
  }

  function project(v) {
    const cy = Math.cos(state.yaw);
    const sy = Math.sin(state.yaw);
    const x = v[0] * cy + v[2] * sy;
    const z1 = -v[0] * sy + v[2] * cy;
    const ct = Math.cos(state.tilt);
    const st = Math.sin(state.tilt);
    const y = v[1] * ct - z1 * st;
    const z = v[1] * st + z1 * ct;
    return [CX + R * x, CY - R * y, z];
  }

  function body() {
    const g = ctx.createRadialGradient(CX - R * 0.3, CY - R * 0.35, R * 0.1, CX, CY, R);
    g.addColorStop(0, 'rgba(61,92,56,.55)');
    g.addColorStop(1, 'rgba(21,32,17,.8)');
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(173,222,168,.4)';
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
      const bow = 0.05 * (1 - span / Math.PI);          // long hauls hug the surface
      const pts = [];
      for (let s = 0; s <= 26; s += 1) {
        const k = s / 26;
        const p = slerp(PLACES[ai].v, PLACES[bi].v, k);
        const lift = 1 + bow * Math.sin(Math.PI * k);
        pts.push(project([p[0] * lift, p[1] * lift, p[2] * lift]));
      }
      strokeArc(pts, lit ? 'rgba(120,224,112,1)' : 'rgba(89,188,83,.5)', 'rgba(89,188,83,.1)', lit ? 2 : 1.1);
    });
  }

  const screen = [];
  function nodes() {
    screen.length = 0;
    PLACES.forEach((n) => {
      const [x, y, z] = project(n.v);
      screen.push({ i: n.i, x, y, z });
      if (z < 0) return;
      const active = n.i === state.picked || n.i === state.hover;
      const r = 3.4 + Math.sqrt(n.members) * 1.1;
      const fade = (n.members ? 0.72 : 0.5) + 0.28 * z;
      if (active) {
        ctx.beginPath();
        ctx.arc(x, y, r + 7, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(89,188,83,.18)';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#59bc53' : `rgba(173,222,168,${fade.toFixed(3)})`;
      ctx.fill();
      if (active) {
        ctx.font = '700 12px Montserrat, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fff';
        ctx.fillText(n.name, x, y - r - 12);
      }
    });
  }

  function frame() {
    if (state.visible) {
      ctx.clearRect(0, 0, W, H);
      if (!state.drag && !calm()) state.yaw += 0.0016;
      body();
      connections();
      nodes();
    }
    requestAnimationFrame(frame);
  }

  /* ---------- the card ---------- */
  const card = document.getElementById('globeCard');
  const empty = document.getElementById('globeHint');
  function showPlace(place) {
    if (!card || !empty) return;
    if (!place) { card.hidden = true; empty.hidden = false; return; }
    empty.hidden = true;
    card.hidden = false;
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    set('globeCity', place.name);
    set('globeCount', place.members
      ? t('d.globe.members', { n: place.members })
      : t('d.globe.noMembers'));
    set('globeTopics', place.topics.map(topicLabel).join(' · '));
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

  // keyboard: step through the places without a pointer
  canvas.addEventListener('keydown', (ev) => {
    if (!['ArrowRight', 'ArrowLeft', 'Enter', ' '].includes(ev.key)) return;
    ev.preventDefault();
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
      const step = ev.key === 'ArrowRight' ? 1 : -1;
      state.picked = (state.picked + step + PLACES.length) % PLACES.length;
      // bring the chosen place round to the front
      const p = PLACES[state.picked];
      state.yaw = -Math.atan2(p.v[2], p.v[0]) - Math.PI / 2;
    }
    showPlace(state.picked >= 0 ? PLACES[state.picked] : null);
  });

  /* ---------- real member counts, matched by city ---------- */
  const normalise = (s) => String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  const byCity = new Map(PLACES.map((p) => [normalise(p.name), p]));
  fetch('/api/users', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data || !Array.isArray(data.users)) return;
      data.users.forEach((u) => {
        const place = byCity.get(normalise(u.city));
        if (place) place.members += 1;
      });
      const reached = PLACES.filter((p) => p.members > 0).length;
      const eyebrow = document.getElementById('globeEyebrow');
      if (eyebrow) eyebrow.textContent = t('d.globe.eyebrow', { n: reached, total: PLACES.length });
    })
    .catch(() => { /* static hosting: the scaffold still draws */ });

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { state.visible = e.isIntersecting; });
  }, { rootMargin: '80px' });
  io.observe(canvas);

  window.addEventListener('resize', resize);
  I18N?.onChange(() => showPlace(state.picked >= 0 ? PLACES[state.picked] : null));
  resize();
  requestAnimationFrame(frame);
})();
