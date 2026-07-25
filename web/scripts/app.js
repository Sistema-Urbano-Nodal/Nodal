/* platform: tabs + the network graph + node card.
   The graph is a live force simulation (Obsidian-style): edges are springs,
   nodes repel, and any node can be grabbed and dragged — the network reacts
   and resettles. The sim sleeps when the layout is at rest.
   All DOM via createElement/textContent (CSP-safe: no innerHTML, no inline
   style attributes — geometry goes through SVG attributes and CSS custom
   props). Labels and card content read from the i18n'd .gc-pool, so
   language switches re-render correctly. */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  /* The membership price slot. Until a launch price is configured the server
     answers with its "unannounced" sentinel, and the landing says so in the
     reader's language instead of showing a number. A configured amount is
     printed exactly as the operator set it — only the period suffix and the
     sentinel are copy. */
  const I18N = window.nodalI18n;
  const t = (key) => (I18N ? I18N.t(key) : key);
  const PRICE_COPY = new Map([
    ['Soon', 'mem.priceSoon'],
    ['/ month', 'y.perMonth'], ['/month', 'y.perMonth'], ['/ mo', 'y.perMonth'],
    ['/ year', 'y.perYear'], ['/year', 'y.perYear'], ['/ yr', 'y.perYear'],
  ]);
  const localisePrice = (value) => (PRICE_COPY.has(value) ? t(PRICE_COPY.get(value)) : value);

  let monthlyBilling = null;
  function renderLandingPrice() {
    const price = document.querySelector('[data-billing-price]');
    if (!price) return;
    if (!monthlyBilling?.amount) { price.textContent = t('mem.priceSoon'); return; }
    const amount = localisePrice(monthlyBilling.amount);
    const per = monthlyBilling.per ? ` ${localisePrice(monthlyBilling.per)}` : '';
    price.textContent = `${amount}${per}`;
  }

  async function loadLandingBillingConfig() {
    if (!document.querySelector('[data-billing-price]')) return;
    try {
      const res = await fetch('/api/billing/config', { headers: { Accept: 'application/json' } });
      if (res.ok) monthlyBilling = (await res.json()).cycles?.monthly ?? null;
    } catch {
      // static previews have no API; the translated fallback still applies
    }
    renderLandingPrice();
  }

  loadLandingBillingConfig();
  I18N?.onChange(renderLandingPrice);

  /* ---------- section tabs ---------- */
  const tabs = [...document.querySelectorAll('.plat-tab')];
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
  function selectTab(i) {
    tabs.forEach((t, k) => {
      const on = k === i;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (panels[k]) panels[k].hidden = !on;
    });
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(i));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const n = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      selectTab(n);
      tabs[n].focus();
    });
  });

  /* ---------- graph data (hybrid: actors around the project hub) ---------- */
  const N = [
    { id: 'project',    x: 450, y: 280, r: 16, m: 2.6, hub: true },
    { id: 'citygov',    x: 185, y: 115, r: 9, m: 1 },
    { id: 'investor',   x: 430, y:  75, r: 9, m: 1 },
    { id: 'ngo',        x: 700, y: 100, r: 9, m: 1 },
    { id: 'architect',  x: 105, y: 295, r: 9, m: 1 },
    { id: 'researcher', x: 300, y: 205, r: 9, m: 1 },
    { id: 'mobility',   x: 590, y: 210, r: 9, m: 1 },
    { id: 'economist',  x: 805, y: 280, r: 9, m: 1 },
    { id: 'community',  x: 245, y: 425, r: 9, m: 1 },
    { id: 'civil',      x: 555, y: 440, r: 9, m: 1 },
    { id: 'academia',   x:  95, y: 175, r: 9, m: 1 },
    { id: 'media',      x: 700, y: 395, r: 9, m: 1 },
    { id: 'business',   x: 395, y: 470, r: 9, m: 1 },
  ];
  const E = [
    ['project', 'researcher'], ['project', 'mobility'], ['project', 'community'], ['project', 'civil'], ['project', 'media'],
    ['researcher', 'citygov'], ['researcher', 'architect'], ['researcher', 'community'], ['researcher', 'mobility'],
    ['mobility', 'investor'], ['mobility', 'economist'], ['mobility', 'ngo'], ['mobility', 'civil'],
    ['citygov', 'investor'], ['ngo', 'economist'], ['civil', 'community'], ['citygov', 'architect'],
    ['academia', 'researcher'], ['academia', 'economist'], ['academia', 'citygov'],
    ['media', 'community'], ['media', 'citygov'],
    ['business', 'community'], ['business', 'mobility'], ['business', 'economist'],
  ];
  const idx = new Map(N.map((n, i) => [n.id, i]));
  const EIDX = E.map(([a, b]) => [idx.get(a), idx.get(b)]);   // edges as node indices
  const HUB_EDGE = E.map(([a, b]) => a === 'project' || b === 'project');
  const adj = N.map(() => new Set());
  EIDX.forEach(([a, b]) => { adj[a].add(b); adj[b].add(a); });

  const pool = document.querySelector('.gc-pool');
  const svg = document.getElementById('graph');
  const card = document.getElementById('graphCard');
  if (!svg || !card || !pool) return;
  const poolOf = (id) => pool.querySelector(`[data-node="${id}"]`);
  const labelOf = (id) => poolOf(id)?.querySelector('h3')?.textContent ?? id;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- build the svg ---------- */
  const COL = {
    edge: 'rgba(61,92,56,.22)', edgeDim: 'rgba(61,92,56,.08)', edgeOn: '#59bc53',
    hubEdge: 'rgba(89,188,83,.45)', node: '#3d5c38', hub: '#59bc53', ring: '#addea8',
  };
  const edgeEls = E.map(() => {
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('stroke', COL.edge);
    l.setAttribute('stroke-width', '1.5');
    svg.appendChild(l);
    return l;
  });
  const nodeEls = N.map((n, i) => {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', n.hub ? 'gnode ghub' : 'gnode');
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', '0');
    g.setAttribute('aria-label', labelOf(n.id));
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('r', n.r + 4);
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', COL.ring);
    ring.setAttribute('stroke-width', n.hub ? '2.5' : '1.5');
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', n.r);
    c.setAttribute('fill', n.hub ? COL.hub : COL.node);
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('class', 'glabel');
    t.setAttribute('data-i18n', `graph.n.${n.id}.t`);
    t.textContent = labelOf(n.id);
    // no aria-label: role=button names itself from the (i18n-translated) text child
    g.append(ring, c, t);
    svg.appendChild(g);
    return { g, c, ring, t };
  });

  function renderFrame() {
    edgeEls.forEach((l, k) => {
      const A = N[EIDX[k][0]], B = N[EIDX[k][1]];
      l.setAttribute('x1', A.x.toFixed(1)); l.setAttribute('y1', A.y.toFixed(1));
      l.setAttribute('x2', B.x.toFixed(1)); l.setAttribute('y2', B.y.toFixed(1));
    });
    nodeEls.forEach((el, i) => {
      const n = N[i];
      el.c.setAttribute('cx', n.x.toFixed(1)); el.c.setAttribute('cy', n.y.toFixed(1));
      el.ring.setAttribute('cx', n.x.toFixed(1)); el.ring.setAttribute('cy', n.y.toFixed(1));
      el.t.setAttribute('x', n.x.toFixed(1)); el.t.setAttribute('y', (n.y + n.r + 18).toFixed(1));
    });
    if (selected !== null && !card.hidden) anchorCard(selected);   // card follows its node
  }

  /* ---------- force simulation ---------- */
  const SIM = {
    rest: 165, spring: 0.02, repulse: 23000, center: 0.010,
    damp: 0.85, maxV: 10, cx: 450, cy: 268,
    minX: 52, maxX: 848, minY: 44, maxY: 458,
  };
  N.forEach((n) => { n.vx = 0; n.vy = 0; n.fixed = false; });
  let running = false;
  let dragging = null;

  function step() {
    let energy = 0;
    const fx = N.map(() => 0), fy = N.map(() => 0);
    for (let i = 0; i < N.length; i += 1) {
      for (let j = i + 1; j < N.length; j += 1) {
        const dx = N[i].x - N[j].x, dy = N[i].y - N[j].y;
        const d2 = Math.max(dx * dx + dy * dy, 900);
        const f = SIM.repulse / d2, d = Math.sqrt(d2);
        fx[i] += (dx / d) * f; fy[i] += (dy / d) * f;
        fx[j] -= (dx / d) * f; fy[j] -= (dy / d) * f;
      }
    }
    EIDX.forEach(([a, b]) => {
      const dx = N[b].x - N[a].x, dy = N[b].y - N[a].y;
      const d = Math.max(Math.hypot(dx, dy), 1);
      const f = SIM.spring * (d - SIM.rest);
      fx[a] += (dx / d) * f; fy[a] += (dy / d) * f;
      fx[b] -= (dx / d) * f; fy[b] -= (dy / d) * f;
    });
    N.forEach((n, i) => {
      if (n.fixed) { n.vx = 0; n.vy = 0; return; }
      fx[i] += (SIM.cx - n.x) * SIM.center;
      fy[i] += (SIM.cy - n.y) * SIM.center;
      n.vx = Math.max(-SIM.maxV, Math.min(SIM.maxV, (n.vx + fx[i] / n.m) * SIM.damp));
      n.vy = Math.max(-SIM.maxV, Math.min(SIM.maxV, (n.vy + fy[i] / n.m) * SIM.damp));
      n.x = Math.max(SIM.minX, Math.min(SIM.maxX, n.x + n.vx));
      n.y = Math.max(SIM.minY, Math.min(SIM.maxY, n.y + n.vy));
      energy += n.vx * n.vx + n.vy * n.vy;
    });
    return energy;
  }

  function frame() {
    const energy = step();
    renderFrame();
    if (!dragging && energy < 0.02 * N.length) { running = false; return; }
    requestAnimationFrame(frame);
  }
  function wake() {
    if (running || reduced) return;
    running = true;
    requestAnimationFrame(frame);
  }

  /* ---------- drag (pointer events; click = press without travel) ---------- */
  nodeEls.forEach((el, i) => {
    el.g.addEventListener('pointerdown', (e) => {
      if (dragging) return;   // one drag at a time — a second finger must not steal the slot
      e.preventDefault();
      // rect cached for the drag's lifetime: no layout read per move
      dragging = { i, moved: 0, px: e.clientX, py: e.clientY, rect: svg.getBoundingClientRect() };
      N[i].fixed = true;
      el.g.classList.add('is-drag');
      try { el.g.setPointerCapture(e.pointerId); } catch { /* pointer already inactive (Safari) */ }
      highlight(i);
      wake();
    });
    el.g.addEventListener('pointermove', (e) => {
      if (!dragging || dragging.i !== i) return;
      dragging.moved += Math.hypot(e.clientX - dragging.px, e.clientY - dragging.py);
      dragging.px = e.clientX; dragging.py = e.clientY;
      const r = dragging.rect;
      N[i].x = Math.max(SIM.minX, Math.min(SIM.maxX, (e.clientX - r.left) * (900 / r.width)));
      N[i].y = Math.max(SIM.minY, Math.min(SIM.maxY, (e.clientY - r.top) * (520 / r.height)));
      if (reduced) renderFrame(); else wake();
    });
    const release = (e) => {
      if (!dragging || dragging.i !== i) return;
      const tap = dragging.moved < 6;
      dragging = null;
      N[i].fixed = false;
      el.g.classList.remove('is-drag');
      if (el.g.hasPointerCapture?.(e.pointerId)) el.g.releasePointerCapture(e.pointerId);
      if (tap) select(i);
      else if (selected === null) reset();
      else highlight(selected);
      wake();
    };
    el.g.addEventListener('pointerup', release);
    el.g.addEventListener('pointercancel', release);
    el.g.addEventListener('mouseenter', () => { if (!dragging) highlight(i); });
    el.g.addEventListener('mouseleave', () => {
      if (dragging) return;
      if (selected === null) reset(); else highlight(selected);
    });
    el.g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i); }
    });
  });
  // safety net: if pointer capture failed (Safari) and the release landed off
  // the node, never leave a node frozen with a stuck drag
  document.addEventListener('pointerup', () => {
    if (!dragging) return;
    const stuck = dragging;
    dragging = null;
    N[stuck.i].fixed = false;
    nodeEls[stuck.i].g.classList.remove('is-drag');
    if (selected === null) reset(); else highlight(selected);
    wake();
  });

  function highlight(i) {
    edgeEls.forEach((l, k) => {
      const on = EIDX[k][0] === i || EIDX[k][1] === i;
      l.setAttribute('stroke', on ? COL.edgeOn : COL.edgeDim);
      l.setAttribute('stroke-width', on ? '2.5' : '1');
    });
    nodeEls.forEach((el, k) => {
      el.g.classList.toggle('is-dim', !(k === i || adj[i].has(k)));
      el.c.setAttribute('r', k === i ? N[k].r + 3 : N[k].r);
    });
  }
  function reset() {
    edgeEls.forEach((l, k) => {
      l.setAttribute('stroke', HUB_EDGE[k] ? COL.hubEdge : COL.edge);
      l.setAttribute('stroke-width', '1.5');
    });
    nodeEls.forEach((el, k) => { el.g.classList.remove('is-dim'); el.c.setAttribute('r', N[k].r); });
  }

  /* ---------- shortest path from the hub (BFS) ---------- */
  function pathFromHub(target) {
    const prev = new Map([[0, null]]);
    let frontier = [0];
    while (frontier.length && !prev.has(target)) {
      const next = [];
      for (const u of frontier) {
        for (const v of adj[u]) if (!prev.has(v)) { prev.set(v, u); next.push(v); }
      }
      frontier = next;
    }
    const path = [];
    for (let cur = target; cur !== null && cur !== undefined; cur = prev.get(cur)) path.unshift(cur);
    return path;
  }

  /* ---------- node card ---------- */
  let selected = null;
  let cardTab = 0;

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const uiText = (key, fallback) =>
    document.querySelector(`.gc-ui [data-i18n="${key}"]`)?.textContent ?? fallback;

  function buildCard(i) {
    const n = N[i];
    const src = poolOf(n.id);
    if (!src) return;
    card.replaceChildren();

    const head = el('div', 'gc-head');
    // title + chip share a wrapping row so a long chip drops under the title
    // instead of pushing the card open; the close button stays pinned right.
    const headline = el('div', 'gc-headline');
    const title = el('h3', 'gc-title', labelOf(n.id));
    headline.append(title);
    const countText = src.querySelector('.gc-count')?.textContent?.trim() ?? '';
    if (countText) headline.append(el('span', 'gc-chip', countText));
    const close = el('button', 'gc-close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', deselect);
    head.append(headline, close);

    // breadcrumb from the hub; on the hub itself the path is just itself, which
    // would only restate the title — so it is dropped in that case
    const path = pathFromHub(i);
    const pathP = path.length > 1 ? el('p', 'gc-path') : null;
    if (pathP) {
      path.forEach((k, j) => {
        if (j) pathP.append(el('span', 'gc-arrow', ' → '));
        pathP.append(el('strong', k === i ? 'gc-here' : '', labelOf(N[k].id)));
      });
    }

    const labels = [
      uiText('graph.tabContacts', 'Contacts'),
      uiText('graph.tabConnects', 'Connects with'),
      uiText('graph.tabAsks', 'Typical asks'),
    ];
    const panes = [el('div', 'gc-pane'), el('div', 'gc-pane'), el('div', 'gc-pane')];

    const list = el('ul', 'gc-list');
    src.querySelectorAll('ul li').forEach((li) => list.append(el('li', '', li.textContent)));
    panes[0].append(list);

    const chips = el('div', 'gc-chips');
    [...adj[i]].forEach((k) => {
      const b = el('button', 'gc-peer', labelOf(N[k].id));
      b.type = 'button';
      b.addEventListener('click', () => select(k));
      chips.append(b);
    });
    panes[1].append(chips);

    panes[2].append(el('p', 'gc-ask', src.querySelector('.gc-ask')?.textContent ?? ''));

    const tabsRow = el('div', 'gc-tabs');
    const btns = labels.map((lab, k) => {
      const b = el('button', 'gc-tab' + (k === cardTab ? ' is-on' : ''), lab);
      b.type = 'button';
      b.addEventListener('click', () => {
        cardTab = k;
        btns.forEach((bb, kk) => bb.classList.toggle('is-on', kk === k));
        panes.forEach((p, kk) => { p.hidden = kk !== k; });
      });
      return b;
    });
    panes.forEach((p, k) => { p.hidden = k !== cardTab; });
    tabsRow.append(...btns);
    card.append(head, ...(pathP ? [pathP] : []), tabsRow, ...panes);
    anchorCard(i);
  }

  // anchor near the node's CURRENT position, clamped (≤820px CSS makes it a sheet)
  function anchorCard(i) {
    const n = N[i];
    const px = Math.min(Math.max((n.x / 900) * 100, 6), 62);
    const py = Math.min(Math.max((n.y / 520) * 100, 5), 48);
    card.style.setProperty('--gc-x', `${px.toFixed(1)}%`);
    card.style.setProperty('--gc-y', `${py.toFixed(1)}%`);
  }

  function select(i) {
    selected = i;
    cardTab = 0;
    buildCard(i);
    card.hidden = false;
    highlight(i);
  }
  function deselect() {
    const wasSelected = selected;
    selected = null;
    card.hidden = true;
    reset();
    if (wasSelected !== null) nodeEls[wasSelected].g.focus();
  }
  svg.addEventListener('click', (e) => { if (e.target === svg) deselect(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !card.hidden) deselect(); });
  // language switch: i18n.js sets <html lang> then retranslates the pool —
  // rebuild an open card so it follows the new language
  new MutationObserver(() => {
    if (selected !== null && !card.hidden) buildCard(selected);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  /* ---------- intro: draw in, then let the simulation settle ---------- */
  renderFrame();
  if (!reduced) {
    nodeEls.forEach((eln, i) => {
      eln.g.classList.add('g-in');
      eln.g.style.transitionDelay = `${100 + i * 55}ms`;
    });
    edgeEls.forEach((l, i) => {
      const len = l.getTotalLength ? l.getTotalLength() : 200;
      l.style.strokeDasharray = len;
      l.style.strokeDashoffset = len;
      setTimeout(() => {
        l.style.transition = 'stroke-dashoffset .9s cubic-bezier(.45,0,.25,1)';
        l.style.strokeDashoffset = 0;
      }, 320 + i * 45);
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      nodeEls.forEach((elr) => elr.g.classList.add('g-on'));
    }));
    setTimeout(() => {
      // dasharray would clip edges as they stretch during the sim — clear it
      edgeEls.forEach((l) => { l.style.transition = ''; l.style.strokeDasharray = ''; l.style.strokeDashoffset = ''; });
      // an early click may already hold a selection — don't clobber it
      if (selected === null) reset(); else highlight(selected);
      wake();
    }, 320 + edgeEls.length * 45 + 1000);
  } else {
    reset();
  }
})();
