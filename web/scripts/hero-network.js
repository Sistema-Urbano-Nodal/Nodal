/* NODAL landing hero: the map network. Twenty real cities, registered to the map artwork,
   join one at a time: a city becomes a node when its first tie arrives, introductions close
   triangles, one long introduction reaches across the region, and hubs are earned by degree.
   The network then keeps a gentle life of exchanges for as long as it is on screen. The markup
   in index.html is the finished still (no JS, reduced motion, paused); this script only animates
   it by writing SVG attributes, and runs requestAnimationFrame only while a signal, flash or ring
   moves (a timer waits between events; the hub halos breathe in CSS while the life runs). */
(() => {
  'use strict';
  const wrap = document.querySelector('.hero-map');
  const svg = wrap?.querySelector('.hero-net');
  if (!svg) return;

  const NS = 'http://www.w3.org/2000/svg', MAP_H = 2385, REF_H = 828, REST = -1e9, STORE = 'nodal.heroMotion';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v)), unit = v => clamp(v, 0, 1);
  // intro choreography (ms; every duration is rounded; L is always Lref, css px at 1440×900)
  // rings are [ms, growth css px] (+ optional [stroke width, opacity]); blooms (a soft swell of the halo disc) are [ms, growth, strength]
  const T = { specks: 400, specksDur: 600, ignite: 1100, grow: 380, igniteRing: [1300, 30, 2, .72], igniteBloom: [1300, 20, .55],
    ignitePop: [640, .42], seedLead: 420, childLead: 180, stagger: 160, maxTreeDraw: 3, maxDraw: 4,
    treeDur: L => Math.round(clamp(260 + 2.4 * L, 420, 1000)), cool: 700, halo: 600, seedCool: 700,
    arriveFlash: 700, ring: [700, 10], anchorRing: [900, 16], bloom: [660, 9, .5],
    closureMin: 3800, readyDelay: 200, gap: 360, maxClosures: 2,
    brokerLead: 120, brokerFlash: 600, sigDur: L => Math.round(clamp(300 + 1.6 * L, 420, 900)),
    arrive: 80, targetFlash: 600, handshake: L => Math.round(clamp(200 + 2 * L, 380, 800)),
    chainSeg: L => Math.round(clamp(L / 0.5, 300, 700)), dwell: 90, chainFlash: 500, solo: 200, proof: 350,
    pathHeat: .75, flight: .25, heatFade: 650, sigFade: 220, handover: 160 };
  // paint at f = 1 (css px): [stroke-opacity, width, leaf tint] of a resting tie and of the climax accent, a tie at full heat,
  // a latent speck [r, fill-opacity] and a ring [width, opacity]
  const P = { tie: [.72, 2, 0], accent: [.85, 2.3, 1], hot: [.97, 2.6], speck: [2.3, .45], ring: [1.5, .6] };
  // the signal capsule, bottom to top: [class, length, width, opacity, longest share of the tie]. Two wide, faint dashes
  // around the head step its light down softly (a glow without SVG filters), over a long trail and a bright head
  const CAPSULE = [['hn-aura', 24, 13, .12, .55], ['hn-glow', 20, 7.5, .24, .5], ['hn-trail', 64, 2.4, .72, .45], ['hn-head', 15, 4, 1, .3]];
  // ambient life after the intro, for as long as the hero is on screen (lite: every offset and interval × 2, never a pair)
  const A = { start: 1800, firstIntro: 5200, exchange: [3300, 800], intro: [11000, 2500], rest: [3600, 900], afterIntro: 1600,
    pair: .3, pairLag: [480, 240], minGap: 400, resumeMin: 600, hoverRetry: 1000,
    sigDur: L => Math.round(clamp(420 + 2.4 * L, 560, 1100)), heartbeat: [420, .14], exFlash: 520, exHeat: .6,
    exRing: [620, 10, 1.3, .55], exBloom: [620, 8, .46], hoverRate: 1500 };

  const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const bez = (x1, y1, x2, y2) => p => {
    if (p <= 0) return 0; if (p >= 1) return 1;
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    let u = p;
    for (let i = 0; i < 8; i++) { const e = ((ax * u + bx) * u + cx) * u - p, d = (3 * ax * u + 2 * bx) * u + cx;
      if (Math.abs(e) < 1e-5 || !d) break; u = Math.min(1, Math.max(0, u - e / d)); }
    return ((ay * u + by) * u + cy) * u;
  };
  const travel = bez(.4, 0, .2, 1), out = bez(.2, .8, .2, 1), grow = bez(.34, 1.35, .64, 1), pulse = bez(.45, 0, .55, 1);
  const rOf = d => Math.max(3.5, Math.min(2.6 + .9 * d, 9));
  const pairKey = (a, b) => a < b ? `${a} ${b}` : `${b} ${a}`;
  const fx = v => String(Math.round(v * 100) / 100), fo = v => String(Math.round(v * 1000) / 1000);
  function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const rand = mulberry32(0x4e4f4441); // "NODA": the same life on every load
  const mq = q => (typeof window.matchMedia === 'function' ? window.matchMedia(q) : null);
  const onChange = (q, fn) => { if (typeof q?.addEventListener === 'function') q.addEventListener('change', fn); else q?.addListener?.(fn); };
  const wide = mq('(min-width: 1100px)'), canAnimate = typeof requestAnimationFrame === 'function';

  let cities = [], edges = [], byId = {}, byPair = {}, seed = null, plan = null, model = null, INTRO_END = 0;
  let slots = [], label = null, button = null, reducedNow = false, reach = 0;
  let deep = [61, 92, 56], leaf = [89, 188, 83], W = MAP_H / REF_H, view = { left: 0, top: 0, k: MAP_H / REF_H, width: 0, header: 0, boxes: [] };
  let built = false, ready = false, invalid = false, lite = false, userPaused = false, decoded = true, started = false;
  let t = 0, mode = 'intro', raf = null, timer = null, layoutTimer = null, lastNow = null, idleNow = null;
  let visible = true, hideAll = false, hoverOn = false, hovered = null, near = [], recent = [];
  let nextEx = 0, nextIntro = Infinity, reserve = [];
  const log = [], note = x => { if (log.length >= 400) log.shift(); log.push(x); }; // the life never ends: keep the test log bounded

  // every engine element writes through a cache, so idle elements cost nothing
  const att = el => ({ el, c: {} });
  const put = (a, name, value) => { if (a.c[name] !== value) { a.c[name] = value; a.el.setAttribute(name, value); } };
  const mix = h => `rgb(${deep.map((v, i) => Math.round(v + (leaf[i] - v) * h)).join(',')})`;
  const edgeOf = (a, b) => byPair[pairKey(a, b)];

  /* ---------- markup → graph ---------- */
  function parse() {
    const halos = {};
    svg.querySelectorAll('.hn-halo').forEach(el => { halos[el.getAttribute('data-city')] = el; });
    svg.querySelectorAll('.hn-core').forEach(el => {
      const id = el.getAttribute('data-city') || '', x = parseFloat(el.getAttribute('cx')), y = parseFloat(el.getAttribute('cy'));
      if (!id || byId[id] || !Number.isFinite(x) || !Number.isFinite(y)) { invalid = true; return; }
      cities.push(byId[id] = { id, name: el.getAttribute('data-name') || id, x, y, deg: 0, parent: false, culled: false, vx: 0, room: Infinity,
        sentAt: -Infinity, core: att(el), halo: halos[id] ? att(halos[id]) : null, ring: null, hit: null });
    });
    svg.querySelectorAll('.hn-edge').forEach(el => {
      const d = el.getAttribute('d') || '', m = /^M(\S+) (\S+)Q(\S+) (\S+) (\S+) (\S+)$/.exec(d), g = m ? m.slice(1).map(Number) : [];
      const e = { i: edges.length, a: el.getAttribute('data-a') || '', b: el.getAttribute('data-b') || '', role: el.getAttribute('data-role') || '',
        via: (el.getAttribute('data-via') || '').split(' ').filter(Boolean), r: att(el), culled: false, d, dRev: d, L: 0, Lref: 0 };
      e.A = byId[e.a]; e.B = byId[e.b]; e.key = pairKey(e.a, e.b);
      if (g.length === 6 && g.every(Number.isFinite)) {
        const [x1, y1, cx, cy, x2, y2] = g;
        let px = x1, py = y1;
        for (let i = 1; i <= 64; i++) { const u = i / 64, v = 1 - u, x = v * v * x1 + 2 * v * u * cx + u * u * x2, y = v * v * y1 + 2 * v * u * cy + u * u * y2;
          e.L += Math.hypot(x - px, y - py); px = x; py = y; }
        e.Lref = e.L * REF_H / MAP_H; e.dRev = `M${m[5]} ${m[6]}Q${m[3]} ${m[4]} ${m[1]} ${m[2]}`;
      } else invalid = true;
      if (!(e.key in byPair)) byPair[e.key] = e;
      if (e.A && e.B) { e.A.deg++; e.B.deg++; }
      edges.push(e);
    });
  }

  // §2.3: a spanning tree whose root is the seed; every introduction runs over earlier edges;
  // exactly one climax (a relay of three or more hops); every other introduction has one broker
  function validate() {
    if (invalid || cities.length < 2) return false;
    const childOf = {}, seen = new Set();
    let climaxes = 0;
    for (const e of edges) {
      if (!e.A || !e.B || e.A === e.B || seen.has(e.key) || !e.L) return false;
      seen.add(e.key);
      if (e.role === 'tree') { if (e.via.length || childOf[e.b]) return false; childOf[e.b] = e.a; e.A.parent = true; continue; }
      if (e.role === 'climax') climaxes++;
      else if (e.role !== 'closure' && e.role !== 'reserve') return false;
      if (e.role === 'climax' ? e.via.length < 2 : e.via.length !== 1) return false;
      const path = [e.a, ...e.via, e.b];
      for (let j = 1; j < path.length; j++) {
        const p = edgeOf(path[j - 1], path[j]);
        if (!p || p.i >= e.i || (e.role !== 'reserve' && p.role === 'reserve')) return false;
      }
    }
    const roots = cities.filter(c => !childOf[c.id]);
    if (climaxes !== 1 || roots.length !== 1 || Object.keys(childOf).length !== cities.length - 1) return false;
    const reached = new Set([roots[0].id]);
    for (let grew = true; grew;) { grew = false; for (const e of edges) if (e.role === 'tree' && reached.has(e.a) && !reached.has(e.b)) { reached.add(e.b); grew = true; } }
    seed = roots[0];
    return reached.size === cities.length;
  }

  /* ---------- records: the model every frame is computed from ---------- */
  const blankNode = act => ({ act, degT: [], flashes: [], rings: [], blooms: [], beats: [] });
  const emptyModel = () => ({ end: 0, draw: edges.map(() => null), signals: [], node: Object.fromEntries(cities.map(c => [c.id, blankNode(Infinity)])) });
  const until = (M, v) => { M.end = Math.max(M.end, v); };
  const flash = (M, id, s, hold, dur) => { M.node[id].flashes.push({ s, hold, dur }); until(M, s + hold + dur); };
  const ring = (M, id, s, [dur, size, width = P.ring[0], alpha = P.ring[1]]) => { M.node[id].rings.push({ s, dur, size, width, alpha }); until(M, s + dur); };
  const bloom = (M, id, s, [dur, size, alpha]) => { M.node[id].blooms.push({ s, dur, size, alpha }); until(M, s + dur); };
  const beat = (M, id, s, [dur, amp] = A.heartbeat) => { M.node[id].beats.push({ s, dur, amp }); until(M, s + dur); };
  // a receiving city blooms: its core flashes leaf, a ring spreads and its halo disc swells softly
  const receive = (M, id, s, fl, rg, bl) => { flash(M, id, s, 0, fl); ring(M, id, s, rg); bloom(M, id, s, bl); };
  const drawEdge = (M, e, s, dur, kind) => { M.draw[e.i] = { s, dur, kind }; until(M, s + dur + T.cool); };
  const signal = (M, e, from, s, dur, level) => { M.signals.push({ e, reverse: from !== e.a, s, dur, level }); until(M, s + dur + Math.max(T.sigFade, T.heatFade)); };
  const degree = (M, id, s) => { const d = M.node[id].degT; d.push(s); d.sort((x, y) => x - y); until(M, Math.max(s + T.grow, d.length >= 4 ? d[3] + T.halo : 0)); };

  // two-hop introduction: the broker flashes, sends two signals at once, both cities flash, then they handshake
  function twoHop(e, s, slot) {
    const broker = e.via[0], ea = edgeOf(broker, e.a), ec = edgeOf(broker, e.b);
    const sigS = s + T.brokerLead, sig = T.sigDur(Math.max(ea.Lref, ec.Lref)), arr = sigS + sig, dur = T.handshake(e.Lref);
    const hs = slot ? slot(arr + T.arrive, dur) : arr + T.arrive;
    return { e, a: e.a, b: e.b, kind: 'closure', via: e.via, s, sigS, sig, arr, hs, dur, end: hs + dur, broker, ea, ec };
  }
  // the climax: one signal relays hop by hop along the path, then the two ends handshake (both ring as it closes), then use the new tie
  function relay(e, s, slot) {
    const path = [e.a, ...e.via, e.b], segs = [];
    let at = s;
    for (let j = 1; j < path.length; j++) {
      const hop = edgeOf(path[j - 1], path[j]), dur = T.chainSeg(hop.Lref);
      segs.push({ hop, from: path[j - 1], to: path[j], s: at, dur }); at += dur + (j < path.length - 1 ? T.dwell : 0);
    }
    const dur = T.handshake(e.Lref), hs = slot(at + T.arrive, dur), end = hs + dur, proofS = end + T.proof, proofDur = T.sigDur(e.Lref);
    return { e, a: e.a, b: e.b, kind: 'climax', via: e.via, s, segs, arr: at, hs, dur, end, proofS, proofEnd: proofS + proofDur };
  }
  function commit(M, r) {
    const e = r.e;
    if (r.kind === 'climax') { // the asker lights as the relay leaves, then every city it passes through
      flash(M, e.a, r.s, 0, T.chainFlash);
      r.segs.forEach((g, j) => { signal(M, g.hop, g.from, g.s, g.dur, T.pathHeat); if (j < r.segs.length - 1) flash(M, g.to, g.s + g.dur, 0, T.chainFlash); });
    }
    else { flash(M, r.broker, r.s, T.brokerLead, T.brokerFlash); ring(M, r.broker, r.s, T.ring);
      signal(M, r.ea, r.broker, r.sigS, r.sig, T.pathHeat); signal(M, r.ec, r.broker, r.sigS, r.sig, T.pathHeat); }
    for (const id of [e.a, e.b]) { receive(M, id, r.arr, T.targetFlash, T.ring, T.bloom); degree(M, id, r.end); if (r.kind === 'climax') ring(M, id, r.end, T.ring); }
    drawEdge(M, e, r.hs, r.dur, 'handshake');
  }
  // first use of a new tie: a signal b → a, and a answers with a bloom
  function proof(M, e, s) {
    const dur = T.sigDur(e.Lref);
    signal(M, e, e.b, s, dur, T.pathHeat); receive(M, e.a, s + dur, T.targetFlash, T.ring, T.bloom);
    return s + dur;
  }

  // §6.4: pure and deterministic; the same plan at every viewport
  function buildPlan() {
    const M = emptyModel(), draws = [], tree = [], intros = [], ends = {};
    const busyAt = x => draws.reduce((n, d) => n + (d.s <= x && x < d.e), 0);
    const slot = cap => (t0, dur) => {
      let x = t0;
      for (let guard = 0; guard < 500; guard++) {
        const busy = draws.filter(d => d.s < x + dur && x < d.e);
        if ([x, ...busy.map(d => d.s).filter(v => v > x)].every(v => busyAt(v) < cap)) return x;
        x = Math.min(...busy.map(d => d.e).filter(v => v > x));
      }
      return x;
    };
    const firstTies = edges.filter(e => e.role === 'tree' && e.a === seed.id);
    const queue = [], enqueue = (id, at, lead) => edges.filter(e => e.role === 'tree' && e.a === id)
      .sort((x, y) => x.Lref - y.Lref || x.i - y.i).forEach((e, k) => queue.push({ e, nominal: at + lead + T.stagger * k }));
    // the ignition: a heavier ring, a wide soft bloom and a core that pops before it settles
    M.node[seed.id].act = T.ignite; ring(M, seed.id, T.ignite, T.igniteRing); bloom(M, seed.id, T.ignite, T.igniteBloom); beat(M, seed.id, T.ignite, T.ignitePop);
    enqueue(seed.id, T.ignite, T.seedLead);
    while (queue.length) {
      queue.sort((x, y) => x.nominal - y.nominal);
      const { e, nominal } = queue.shift(), dur = T.treeDur(e.Lref), start = slot(T.maxTreeDraw)(nominal, dur), end = start + dur;
      draws.push({ s: start, e: end, kind: 'tree' }); tree.push({ a: e.a, b: e.b, nominal, start, dur, end }); ends[e.key] = end;
      drawEdge(M, e, start, dur, 'tree'); M.node[e.b].act = end; until(M, end + T.grow);
      flash(M, e.b, end, 0, T.arriveFlash); ring(M, e.b, end, firstTies.includes(e) ? T.anchorRing : T.ring);
      degree(M, e.a, end); degree(M, e.b, end);
      enqueue(e.b, end, T.childLead);
    }
    // the seed stays lit until its last first tie lands, then cools like every node
    flash(M, seed.id, T.ignite, Math.max(0, ...firstTies.map(e => ends[e.key] - T.ignite)), T.seedCool);
    let prevStart = -Infinity;
    for (const e of edges) {
      if (e.role !== 'closure' && e.role !== 'climax') continue;
      const path = [e.a, ...e.via, e.b], climax = e.role === 'climax';
      let s = Math.max(Math.max(...path.slice(1).map((id, j) => ends[pairKey(path[j], id)])) + T.readyDelay, prevStart + T.gap, T.closureMin), r;
      if (climax) s = Math.max(s, ...intros.map(x => x.end + T.solo), ...tree.map(x => x.end + T.solo));
      for (let guard = 0; guard < 100; guard++) {
        r = climax ? relay(e, s, slot(T.maxDraw)) : twoHop(e, s, slot(T.maxDraw));
        const over = intros.filter(x => x.s < r.end && r.s < x.end);
        if (over.length < T.maxClosures) break;
        s = Math.min(...over.map(x => x.end));
      }
      draws.push({ s: r.hs, e: r.end, kind: 'handshake' }); ends[e.key] = r.end; prevStart = r.s;
      commit(M, r); if (climax) proof(M, e, r.proofS);
      intros.push({ a: r.a, b: r.b, kind: r.kind, via: r.via, s: r.s, arr: r.arr, hs: r.hs, dur: r.dur, end: r.end, proofS: r.proofS, proofEnd: r.proofEnd });
    }
    const introEnd = Math.max(...tree.map(x => x.end), ...intros.map(x => x.proofEnd ?? x.end));
    return { seed: seed.id, tree, intros, draws, INTRO_END: introEnd, busyUntil: M.end, model: M,
      reserve: edges.filter(e => e.role === 'reserve').map(e => ({ a: e.a, b: e.b, via: e.via })),
      act: Object.fromEntries(cities.map(c => [c.id, M.node[c.id].act])), degT: Object.fromEntries(cities.map(c => [c.id, M.node[c.id].degT.slice()])) };
  }

  /* ---------- paint ---------- */
  function paintEdge(e, t) {
    const d = model.draw[e.i], r = e.r;
    if (!d || t < d.s) { put(r, 'stroke-opacity', '0'); return; }
    const end = d.s + d.dur, p = d.dur > 0 ? travel(unit((t - d.s) / d.dur)) : 1;
    if (p >= 1) { put(r, 'stroke-dasharray', 'none'); put(r, 'stroke-dashoffset', '0'); }
    else if (d.kind === 'tree') { const n = fx(e.L + 1); put(r, 'stroke-dasharray', `${n} ${n}`); put(r, 'stroke-dashoffset', fx((e.L + 1) * (1 - p))); }
    else { const a = e.L / 2 * p; put(r, 'stroke-dasharray', `${fx(a)} ${fx(Math.max(e.L - 2 * a, 0))} ${fx(a)} ${fx(e.L)}`); put(r, 'stroke-dashoffset', '0'); }
    // a tie stays almost at rest while a signal is on it, so the capsule reads as travelling, and glows once it lands;
    // the leaf accent hands its colour to the signal while one travels on it (a leaf capsule on a leaf tie would vanish)
    let h = t < end ? 1 : Math.max(0, 1 - (t - end) / T.cool), quiet = 0;
    for (const s of model.signals) if (s.e === e && t >= s.s) {
      const q = t - s.s - s.dur;
      h = Math.max(h, s.level * (q < 0 ? T.flight : Math.max(0, 1 - q / T.heatFade)));
      if (q < 0) quiet = Math.max(quiet, unit(Math.min(t - s.s, -q) / T.handover));
    }
    tint(e, h, quiet);
  }
  // heat h (0..1) from a tie's resting paint to full heat; the climax tie rests as the leaf accent
  function tint(e, h, quiet = 0) {
    const [o, w, c] = e.role === 'climax' ? P.accent : P.tie;
    put(e.r, 'stroke', mix(Math.max(c * (1 - quiet), h))); put(e.r, 'stroke-opacity', fo(o + (P.hot[0] - o) * h)); put(e.r, 'stroke-width', fx((w + (P.hot[1] - w) * h) * W));
  }
  function paintCity(c, t) {
    const n = model.node[c.id], core = c.core;
    if (t < n.act) { // latent speck
      put(core, 'r', fx(P.speck[0] * W)); put(core, 'fill', mix(0)); put(core, 'fill-opacity', fo(P.speck[1] * out(unit((t - T.specks) / T.specksDur)))); put(core, 'stroke-width', '0');
      if (c.halo) put(c.halo, 'fill-opacity', '0');
      put(c.ring, 'stroke-opacity', '0'); return;
    }
    let r = P.speck[0] + (rOf(0) - P.speck[0]) * grow(unit((t - n.act) / T.grow)), deg = 0, fl = 0, g = null, bl = 0, swell = 0;
    for (const s of n.degT) { if (t < s) break; deg++; r += (rOf(deg) - rOf(deg - 1)) * grow(unit((t - s) / T.grow)); }
    for (const b of n.beats) if (t >= b.s && t < b.s + b.dur) r *= 1 + b.amp * Math.sin(Math.PI * (t - b.s) / b.dur);
    // flashes ease in and out, so an arrival stays visibly leaf for about half its length instead of blinking
    for (const f of n.flashes) if (t >= f.s) fl = Math.max(fl, t <= f.s + f.hold ? 1 : 1 - pulse(unit((t - f.s - f.hold) / f.dur)));
    put(core, 'r', fx(r * W)); put(core, 'fill', mix(fl)); put(core, 'fill-opacity', '1'); put(core, 'stroke-width', fx(4 * W));
    // a bloom rises fast and settles slowly, and swells the halo disc out and back, so a hub's resting halo never jumps
    for (const x of n.blooms) if (t >= x.s && t < x.s + x.dur) {
      const q = (t - x.s) / x.dur, v = q < .18 ? out(q / .18) : 1 - pulse((q - .18) / .82);
      if (v * x.alpha > bl) { bl = v * x.alpha; swell = v * x.size; }
    }
    if (c.halo) {
      const rest = deg >= 4 ? .42 * out(unit((t - n.degT[3]) / T.halo)) : 0;
      const base = deg >= 4 ? 8 : 2, grown = Math.min((deg >= 4 ? .6 : 1) * swell, Math.max(0, c.room - r - base)); // like a ring, a bloom never reaches the header
      if (rest || bl) { put(c.halo, 'r', fx((r + base + grown) * W)); put(c.halo, 'fill-opacity', fo(rest + (1 - rest) * bl)); }
      else put(c.halo, 'fill-opacity', '0');
    }
    for (const x of n.rings) if (t >= x.s && t < x.s + x.dur && (!g || x.s >= g.s)) g = x;
    if (!g) { put(c.ring, 'stroke-opacity', '0'); return; }
    const q = (t - g.s) / g.dur, size = Math.min(g.size, Math.max(0, c.room - r)); // a ring never reaches the header
    put(c.ring, 'r', fx((r + size * out(q)) * W)); put(c.ring, 'stroke-opacity', fo(g.alpha * (1 - q))); put(c.ring, 'stroke-width', fx(g.width * W));
  }
  // a signal is a glowing capsule: four dashes (aura, glow, trail and head) on pooled paths, each drawing only [front − len, front)
  const dark = slot => { for (const a of slot) put(a, 'stroke-opacity', '0'); };
  function paintSignals(t) {
    const live = model.signals.filter(s => t >= s.s && t <= s.s + s.dur + T.sigFade && !s.e.culled).sort((x, y) => x.s - y.s);
    slots.forEach((slot, i) => {
      const s = live[i];
      if (!s) { dark(slot); return; }
      const L = s.e.L, front = L * pulse(unit((t - s.s) / s.dur)), fade = t <= s.s + s.dur ? 1 : Math.max(0, 1 - (t - s.s - s.dur) / T.sigFade);
      for (const [j, [, len, width, alpha, cap]] of CAPSULE.entries()) {
        const a = slot[j], n = Math.min(len * W, cap * L);
        put(a, 'd', s.reverse ? s.e.dRev : s.e.d); put(a, 'stroke-dasharray', `${fx(n)} ${fx(L + n)}`); put(a, 'stroke-dashoffset', fx(n - front));
        put(a, 'stroke-width', fx(width * W)); put(a, 'stroke-opacity', fo(alpha * fade));
      }
    });
  }
  function renderAt(at) {
    for (const e of edges) if (!e.culled) paintEdge(e, at);
    for (const c of cities) if (!c.culled) paintCity(c, at);
    paintSignals(at);
  }
  // the finished network at rest; the climax tie keeps its leaf tint ("an introduction became a connection")
  function renderStill() {
    for (const e of edges) if (!e.culled) { put(e.r, 'stroke-dasharray', 'none'); put(e.r, 'stroke-dashoffset', '0'); tint(e, 0); }
    for (const c of cities) {
      if (c.culled) continue;
      const r = rOf(c.deg);
      put(c.core, 'r', fx(r * W)); put(c.core, 'fill', mix(0)); put(c.core, 'fill-opacity', '1'); put(c.core, 'stroke-width', fx(4 * W));
      if (c.halo) { put(c.halo, 'r', fx((r + 8) * W)); put(c.halo, 'fill-opacity', c.deg >= 4 ? '0.42' : '0'); }
      put(c.ring, 'stroke-opacity', '0');
    }
    slots.forEach(dark);
  }
  const render = () => { if (mode === 'still') renderStill(); else renderAt(t); };

  /* ---------- layout: the only place that reads layout ---------- */
  function layout(paint = true) {
    if (wide && !wide.matches) return;
    const box = wrap.getBoundingClientRect();
    if (!box.height) return;
    const k = MAP_H / box.height, sy = window.scrollY || 0, cw = document.documentElement.clientWidth || 0, boxes = [];
    W = clamp(Math.sqrt(box.height / REF_H), .9, 1.25) * k;
    const header = document.querySelector('.navbar')?.getBoundingClientRect().height || 0;
    view = { left: box.left, top: box.top + sy, k, width: cw, header, boxes }; // boxes: the text and CTA rects, in page px
    const add = (r, [dx, dy] = [0, 0]) => { if (r && (r.width || r.height)) boxes.push([r.left - dx, r.right - dx, r.top - dy + sy, r.bottom - dy + sy]); };
    // the text may still be rising into place (translateY entrance): measure where it lands, not where it is now
    const shift = el => {
      const m = /^matrix(3d)?\((.+)\)$/.exec(typeof getComputedStyle === 'function' ? getComputedStyle(el).transform || '' : ''), v = m ? m[2].split(',').map(Number) : [];
      return m ? (m[1] ? [v[12], v[13]] : [v[4], v[5]]).map(n => n || 0) : [0, 0];
    };
    if (typeof document.createTreeWalker === 'function' && typeof document.createRange === 'function') {
      const range = document.createRange();
      for (const root of ['.hero-kicker', '.headline', '.hero-sub'].map(s => document.querySelector(s))) {
        if (!root) continue;
        const walker = document.createTreeWalker(root, 4); // NodeFilter.SHOW_TEXT
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.nodeValue?.trim()) continue;
          const lift = [0, 0];
          for (let el = n.parentNode; el; el = el === root ? null : el.parentNode) { const [x, y] = shift(el); lift[0] += x; lift[1] += y; }
          range.selectNodeContents(n);
          const list = range.getClientRects();
          for (let i = 0; i < list.length; i++) add(list[i], lift);
        }
      }
    }
    document.querySelectorAll('.hero-cta .btn').forEach(el => add(el.getBoundingClientRect()));
    let culled = 0;
    const f = W / k;
    for (const c of cities) {
      const dy = box.top + sy + c.y / k;
      c.vx = box.left + c.x / k; c.room = (dy - header - 6) / f; // ring headroom under the header, in css px at f = 1
      // a disc (with its knockout) keeps 7 px clear of the header, 16 px of the right edge and 24 px of the text
      c.culled = dy - (rOf(c.deg) + 2) * f < header + 7 || c.vx > cw - 16 || boxes.some(([l, r, top, bottom]) => c.vx >= l - 24 && c.vx <= r + 24 && dy >= top - 24 && dy <= bottom + 24);
      if (c.culled) culled++;
      for (const a of [c.core, c.halo, c.ring]) if (a) a.el.style.display = c.culled ? 'none' : '';
      if (c.hit) { c.hit.el.style.display = hoverOn && !c.culled ? '' : 'none'; put(c.hit, 'r', fx(hitR(c) * W)); }
    }
    // a partial network would misstate the picture: hide it whole when a tree hub or more than three cities are covered
    hideAll = culled > 3 || cities.some(c => c.culled && c.parent);
    for (const e of edges) { e.culled = !!(e.A?.culled || e.B?.culled); e.r.el.style.display = e.culled ? 'none' : ''; }
    svg.classList.toggle('is-off', hideAll);
    if (hovered?.culled) unfocus();
    syncButton();
    if (paint) render();
  }
  function scheduleLayout() {
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => { layoutTimer = null; layout(); sync(); }, 150);
  }

  /* ---------- clock and modes ---------- */
  // reducedNow is cached from the change event: Chromium drops that event for a MediaQueryList whose .matches was read after the flip
  const stillWanted = () => invalid || userPaused || reducedNow || !canAnimate;
  const running = () => !stillWanted() && visible && !document.hidden && !hideAll;
  const clearTimer = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };
  const bank = () => { if (idleNow !== null) { t += now() - idleNow; idleNow = null; } };
  function stopLoop() { if (raf !== null) cancelAnimationFrame(raf); raf = null; lastNow = null; bank(); clearTimer(); }
  function requestFrame() { if (raf === null) raf = requestAnimationFrame(frame); }
  function frame(ts) {
    raf = null;
    if (!running()) return;
    t += lastNow === null ? 0 : Math.min(ts - lastNow, 50); lastNow = ts;
    renderAt(t);
    if (t < model.end) requestFrame();
    else { lastNow = null; if (mode === 'intro') enterAmbient(); armTimer(false); }
  }
  function sync() {
    if (!ready) return;
    step();
    // the hub halos breathe (a CSS transform) only while the life runs: never in the still, paused, hidden, offscreen or before the start
    svg.classList.toggle('is-running', mode !== 'still' && started && running());
  }
  function step() {
    if (stillWanted()) { stopLoop(); if (mode !== 'still') enterStill(); return; }
    if (mode === 'still') leaveStill();
    if (!running()) { stopLoop(); return; }
    if (!started) { // start gate: the map artwork is decoded (or 1.2 s passed)
      if (!decoded && timer === null) timer = setTimeout(() => { timer = null; decoded = true; sync(); }, 1200);
      if (!decoded) return;
      started = true; clearTimer();
      if (lite) snapIntro();
    }
    if (t < model.end) requestFrame();
    else { if (mode === 'intro') enterAmbient(); armTimer(true); }
  }
  // snap the model to rest: every present edge drawn, degrees grown, nothing in flight
  function settle(all) {
    const drawn = edges.filter(e => all || model.draw[e.i] || e.role !== 'reserve');
    for (const e of drawn) model.draw[e.i] = { s: REST, dur: 0, kind: 'rest' };
    for (const c of cities) { model.node[c.id] = blankNode(REST); model.node[c.id].degT = drawn.filter(e => e.A === c || e.B === c).map(() => REST); }
    model.signals = []; model.end = t;
    if (all) reserve = [];
  }
  function snapIntro() { t = INTRO_END; settle(false); enterAmbient(); renderAt(t); }
  function enterAmbient() {
    const m = lite ? 2 : 1;
    mode = 'ambient'; nextEx = INTRO_END + A.start * m; nextIntro = INTRO_END + A.firstIntro * m;
    reserve = edges.filter(e => e.role === 'reserve' && !model.draw[e.i]);
    enableHover();
  }
  function enterStill() { mode = 'still'; stopLoop(); renderStill(); enableHover(); }
  // never replays the intro: the network resumes complete, and its exchanges pick up again
  function leaveStill() {
    settle(true); started = true; mode = 'ambient';
    nextEx = t + A.start * (lite ? 2 : 1); nextIntro = Infinity;
    renderAt(t);
  }

  /* ---------- ambient life: one timer slot; one event (an introduction, or one or two exchanges) in flight ---------- */
  const jitter = ([base, spread]) => Math.round((base + (2 * rand() - 1) * spread) * (lite ? 2 : 1));
  const present = e => mode === 'still' || (!!model.draw[e.i] && t >= model.draw[e.i].s + model.draw[e.i].dur);
  const degreeNow = id => model.node[id].degT.reduce((n, s) => n + (s <= t), 0);
  // a reserve introduction waits while an end or a broker leg is culled, and plays once the viewport shows all of it
  const playable = e => !e.culled && e.via.every(v => !edgeOf(v, e.a).culled && !edgeOf(v, e.b).culled);
  function armTimer(resume) {
    bank(); clearTimer(); // a redundant sync() must not postpone the next event
    const due = Math.min(nextEx, reserve.some(playable) ? nextIntro : Infinity);
    idleNow = now(); timer = setTimeout(fire, Math.max(due - t, resume ? A.resumeMin : A.minGap));
  }
  function prune() {
    const done = (s, span) => s + span <= t;
    model.signals = model.signals.filter(s => !done(s.s, s.dur + T.heatFade));
    for (const id in model.node) { const n = model.node[id];
      n.flashes = n.flashes.filter(f => !done(f.s, f.hold + f.dur)); n.rings = n.rings.filter(g => !done(g.s, g.dur));
      n.blooms = n.blooms.filter(b => !done(b.s, b.dur)); n.beats = n.beats.filter(b => !done(b.s, b.dur)); }
  }
  // an exchange: a signal at s, and the receiving city answers with a heartbeat and a small bloom
  function exchange(e, from, s, type) {
    const to = from === e.a ? e.b : e.a, dur = A.sigDur(e.Lref);
    signal(model, e, from, s, dur, A.exHeat); beat(model, to, s + dur); receive(model, to, s + dur, A.exFlash, A.exRing, A.exBloom);
    note({ type, edge: e.key, from, start: s });
  }
  // a present, visible tie, weighted towards busy cities and towards ties long enough for a signal to read as travelling
  function choose(ok) {
    const cands = edges.filter(e => ok(e) && !e.culled && present(e)), weights = cands.map(e => (degreeNow(e.a) + degreeNow(e.b)) * clamp(e.Lref / 90, .35, 1.5));
    if (!cands.length) return null;
    let x = rand() * weights.reduce((s, w) => s + w, 0), i = 0;
    while (i < cands.length - 1 && (x -= weights[i]) >= 0) i++;
    const e = cands[i], [hi, lo] = degreeNow(e.b) > degreeNow(e.a) ? [e.b, e.a] : [e.a, e.b];
    return { e, from: rand() < .72 ? hi : lo }; // mostly from the busier end, sometimes back to it
  }
  function fire() {
    timer = null; bank();
    if (!running()) return;
    const pick = reserve.findIndex(playable), introDue = pick >= 0 && nextIntro <= nextEx;
    if (hovered) { if (introDue) nextIntro += A.hoverRetry; else nextEx += A.hoverRetry; armTimer(false); return; }
    prune();
    if (introDue) {
      const e = reserve.splice(pick, 1)[0], r = twoHop(e, t, null);
      commit(model, r);
      const end = proof(model, e, r.end + T.proof);
      recent = [e, ...recent].slice(0, 3); note({ type: 'intro', edge: e.key, from: r.broker, start: t });
      nextIntro = Math.max(nextIntro, t) + jitter(A.intro); nextEx = Math.max(nextEx, end + A.afterIntro); // a late intro never pulls the next one closer
    } else {
      // one exchange, and now and then a second one on a tie that shares no city with it (never in lite mode)
      const first = choose(e => !recent.includes(e)), pair = rand() < A.pair && !lite;
      const second = first && pair ? choose(e => !recent.includes(e) && e.A !== first.e.A && e.A !== first.e.B && e.B !== first.e.A && e.B !== first.e.B) : null;
      if (first) exchange(first.e, first.from, t, 'exchange');
      if (second) exchange(second.e, second.from, t + jitter(A.pairLag), 'exchange');
      recent = [...[second, first].filter(Boolean).map(x => x.e), ...recent].slice(0, 3); // the last three ties rest a while
      nextEx = Math.max(nextEx, t) + jitter(reserve.some(playable) ? A.exchange : A.rest); // a late exchange never pulls the next one closer
    }
    if (t < model.end) requestFrame(); else armTimer(false);
  }

  /* ---------- hover (fine pointers only): name the city, show its ties, send one exchange ---------- */
  function enableHover() {
    if (hoverOn) return;
    hoverOn = true;
    for (const c of cities) if (c.hit) c.hit.el.style.display = c.culled ? 'none' : '';
  }
  // the hovered city's hit circle grows to reach its label, so the pointer can move onto the label (WCAG 1.4.13)
  const hitR = c => Math.max(10, rOf(c.deg) + 5, c === hovered ? reach : 0);
  function focus(c) {
    if (hovered === c) return; // back from the label onto its own city
    unfocus(); hovered = c;
    svg.classList.add('is-focus');
    const mark = (x, cls) => { for (const a of [x.core, x.halo]) if (a) { a.el.classList.add(cls); near.push([a.el, cls]); } };
    mark(c, 'is-focus');
    const ties = edges.filter(e => (e.A === c || e.B === c) && !e.culled && present(e));
    for (const e of ties) { e.r.el.classList.add('is-near'); near.push([e.r.el, 'is-near']); mark(e.A === c ? e.B : e.A, 'is-near'); }
    const deg = mode === 'still' ? c.deg : degreeNow(c.id), rim = rOf(deg) + (deg >= 4 ? 8 : 2); // halo, or the knockout ring
    const [anchor, x, y] = placeLabel(c, rOf(deg), rim);
    label.el.textContent = c.name.toLocaleUpperCase(document.documentElement.lang || 'es');
    put(label, 'font-size', fx(11 * W)); put(label, 'stroke-width', fx(3 * W));
    put(label, 'x', fx(x)); put(label, 'y', fx(y)); put(label, 'text-anchor', anchor);
    label.el.classList.add('is-on');
    reach = rim + 7; if (c.hit) put(c.hit, 'r', fx(hitR(c) * W));
    // one exchange per city per 1.5 s of wall time (t stands still while the life waits for its next event)
    if (!running() || mode !== 'ambient' || t < model.end || now() - c.sentAt < A.hoverRate) return;
    const to = ties.map(e => (e.A === c ? e.B : e.A)).sort((x, y) => degreeNow(y.id) - degreeNow(x.id) || (x.id < y.id ? -1 : 1))[0];
    if (!to) return;
    bank(); clearTimer(); c.sentAt = now();
    prune(); exchange(edgeOf(c.id, to.id), c.id, t, 'hover');
    requestFrame();
  }
  // right of the node, else left, else above or below: the first spot on screen, under the header, 6 px clear of the hero text and CTA,
  // and clear of other cities; when every such spot touches a city, the one that intrudes least on it; when none qualifies, right
  // (left near the right edge). Every spot keeps 6 px (4 px vertically) off the rim, the halo of a hub or the knockout ring of a leaf
  function placeLabel(c, r, rim) {
    const { left, top, k, width, header, boxes } = view, w = c.name.length * 10 * W, side = (rim + 6) * W, lift = (rim + 4) * W, base = 4 * W;
    const spots = [['start', c.x + side, c.y + base], ['end', c.x - side, c.y + base], ['end', c.x + r * W, c.y - lift], ['start', c.x - r * W, c.y - lift],
      ['end', c.x + r * W, c.y + lift + 9 * W], ['start', c.x - r * W, c.y + lift + 9 * W]];
    const cost = ([anchor, x, y]) => {
      const x0 = anchor === 'start' ? x : x - w, x1 = x0 + w, y0 = y - 8.5 * W, y1 = y + 1.5 * W;
      const px0 = left + x0 / k, px1 = left + x1 / k, py0 = top + y0 / k, py1 = top + y1 / k; // page px
      if (px0 < 8 || px1 > width - 8 || py0 < header + 4 || boxes.some(([l, rt, tp, bt]) => px0 < rt + 6 && px1 > l - 6 && py0 < bt + 6 && py1 > tp - 6)) return Infinity;
      return Math.max(0, ...cities.map(o => {
        if (o === c || o.culled) return 0;
        const d = Math.hypot(Math.max(x0 - o.x, 0, o.x - x1), Math.max(y0 - o.y, 0, o.y - y1)), ro = rOf(o.deg);
        return Math.max((ro + 3) * W - d, o.deg >= 4 ? ((ro + 8) * W - d) / 4 : 0); // a hub's translucent halo counts a quarter
      }));
    };
    const costs = spots.map(cost), best = Math.min(...costs);
    return best < Infinity ? spots[costs.indexOf(best)] : spots[c.vx > width - 140 ? 1 : 0];
  }
  function unfocus() {
    const c = hovered;
    if (!c) return;
    hovered = null; svg.classList.remove('is-focus');
    for (const [el, cls] of near) el.classList.remove(cls);
    near = []; label.el.classList.remove('is-on');
    if (c.hit) put(c.hit, 'r', fx(hitR(c) * W));
  }

  /* ---------- pause control (WCAG 2.2.2) ---------- */
  function syncButton() {
    if (!button) return;
    button.hidden = !ready || invalid || hideAll || reducedNow || !canAnimate;
    button.setAttribute('aria-pressed', String(userPaused));
  }
  function togglePause() {
    userPaused = !userPaused;
    try { if (userPaused) window.localStorage.setItem(STORE, 'off'); else window.localStorage.removeItem(STORE); } catch { /* storage unavailable: session-only */ }
    syncButton(); sync();
  }

  /* ---------- setup: once, at ≥1100 px ---------- */
  function setup() {
    if (built) return;
    built = true;
    parse();
    if (!cities.length || !edges.length) return;
    invalid = !validate();
    plan = invalid ? null : buildPlan();
    model = plan ? plan.model : emptyModel();
    INTRO_END = plan ? plan.INTRO_END : 0;

    const make = (tag, cls, parent, before = null) => { const el = document.createElementNS(NS, tag); el.classList.add(cls); parent.insertBefore(el, before); return el; };
    const gHalos = svg.querySelector('.hn-halos'), gNodes = svg.querySelector('.hn-nodes');
    const gSignals = make('g', 'hn-signals', svg, gHalos || gNodes);
    // four pooled capsules, layer by layer: every glow sits under every trail and head, so crossing signals never muddy each other
    const layers = CAPSULE.map(([cls]) => [0, 1, 2, 3].map(() => att(make('path', cls, gSignals))));
    slots = layers[0].map((_, i) => layers.map(l => l[i]));
    slots.forEach(dark);
    // hubs (final degree ≥ 4, the cities with a halo) breathe out of step: each its own period and phase
    if (!invalid) cities.filter(c => c.halo && c.deg >= 4).forEach((c, k) => {
      c.halo.el.classList.add('is-hub'); c.halo.el.style.animationDelay = `${fx(k * .9)}s`; c.halo.el.style.animationDuration = `${fx(3.4 + (k * 3 % 4) * .2)}s`;
    });
    const gRings = make('g', 'hn-rings', svg, gNodes);
    for (const c of cities) { c.ring = att(make('circle', 'hn-ring', gRings)); put(c.ring, 'cx', String(c.x)); put(c.ring, 'cy', String(c.y)); put(c.ring, 'stroke-opacity', '0'); }
    label = att(make('text', 'hn-label', svg));
    if (mq('(hover: hover) and (pointer: fine)')?.matches) {
      const gHits = make('g', 'hn-hits', svg);
      for (const c of cities) {
        c.hit = att(make('circle', 'hn-hit', gHits)); put(c.hit, 'cx', String(c.x)); put(c.hit, 'cy', String(c.y));
        c.hit.el.style.display = 'none';
        c.hit.el.addEventListener('pointerenter', () => focus(c));
        c.hit.el.addEventListener('pointerleave', e => { if (hovered === c && e?.relatedTarget !== label.el) unfocus(); });
      }
      // the label can be hovered (it takes the pointer while shown) and dismissed with Escape
      label.el.addEventListener('pointerleave', e => { if (hovered && e?.relatedTarget !== hovered.hit?.el) unfocus(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') unfocus(); });
    }

    const css = typeof getComputedStyle === 'function' ? getComputedStyle(svg) : null;
    const color = (name, fallback) => {
      const v = String(css?.getPropertyValue(name) || '').trim(), hex = /^#([0-9a-f]{6})$/i.exec(v), rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
      return hex ? [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)) : rgb ? rgb.slice(1, 4).map(Number) : fallback;
    };
    deep = color('--hn-deep', deep); leaf = color('--hn-leaf', leaf);
    const nav = window.navigator || {};
    lite = nav.connection?.saveData === true || (nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 2);
    try { userPaused = window.localStorage.getItem(STORE) === 'off'; } catch { userPaused = false; }
    const img = wrap.querySelector('.map-outline');
    decoded = !img || (img.complete && img.naturalWidth > 0);
    const markDecoded = () => { if (decoded) return; decoded = true; sync(); };
    if (!decoded) img.decode?.()?.then?.(markDecoded, markDecoded);

    const reduced = mq('(prefers-reduced-motion: reduce)'), content = document.querySelector('.hero-content');
    reducedNow = !!reduced?.matches; // the only read: later values come from the change event
    button = wrap.querySelector('.hn-toggle');
    document.addEventListener('visibilitychange', sync);
    onChange(reduced, e => { reducedNow = !!e.matches; syncButton(); sync(); });
    if (typeof IntersectionObserver === 'function') {
      new IntersectionObserver(entries => { const last = entries[entries.length - 1]; if (last) { visible = last.isIntersecting; sync(); } }, { threshold: 0 }).observe(svg);
    }
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(scheduleLayout);
      ro.observe(wrap); if (content) ro.observe(content);
    }
    content?.addEventListener?.('animationend', scheduleLayout); // once more when the entrance has landed
    window.addEventListener?.('resize', scheduleLayout); // width-only changes move the map without resizing either box
    window.nodalI18n?.onChange?.(scheduleLayout);
    document.fonts?.ready?.then?.(scheduleLayout);
    button?.addEventListener('click', togglePause);

    const hook = window.__nodalHeroTest;
    if (hook && typeof hook === 'object') Object.assign(hook, { plan, renderAt, INTRO_END, events: () => log.map(x => ({ ...x })),
      state: () => ({ t, mode, busyUntil: model.end, started, visible, hideAll, userPaused, lite, invalid, nextEx, nextIntro,
        reserve: reserve.map(e => e.key), culled: cities.filter(c => c.culled).map(c => c.id), hovered: hovered?.id ?? null }) });

    mode = 'intro'; t = 0;
    layout(false);
    if (stillWanted()) enterStill(); else renderAt(0);
    svg.classList.add('is-live');
    ready = true; syncButton(); sync();
  }

  if (!wide || wide.matches) setup();
  onChange(wide, e => { if (!e.matches) return; if (!built) setup(); else if (ready) scheduleLayout(); });
})();
