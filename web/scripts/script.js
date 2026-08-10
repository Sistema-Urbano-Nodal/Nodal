/* logo mark: CONFIG.nodes are circle positions in the 120x130 viewBox,
   edges connect node indices, timing tunes the intro animation */
(() => {
  const CONFIG = {
    // node positions in the SVG's 120 x 130 coordinate space
    nodes: [
      { x:  30, y:  18, r: 6.5 },  // 0
      { x:  66, y:  28, r: 7.5 },  // 1
      { x:  92, y:  60, r: 5.5 },  // 2
      { x:  40, y:  72, r: 12  },  // 3  (hub)
      { x:  74, y:  94, r: 10  },  // 4
      { x:  44, y: 116, r: 6   },  // 5
    ],
    edges: [ [0,3], [1,3], [1,2], [2,4], [3,4], [4,5] ],

    // timing
    nodePopSpeed:   600,   // ms per node pop-in
    nodePopStagger: 110,   // ms between nodes
    drawSpeed:     1400,   // ms per edge draw  (bigger = slower)
    drawStagger:    220,   // ms between edges starting
    drawEase: 'cubic-bezier(.45,0,.25,1)',

    // gentle continuous float after the intro
    floatAmount: 0.7,
    floatSpeed:  1.0,
  };

  const svg = document.getElementById('net');
  const NS = 'http://www.w3.org/2000/svg';
  const { nodes, edges } = CONFIG;

  // edges first (under nodes), then nodes
  const edgeEls = edges.map(() => {
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('class', 'edge');
    l.setAttribute('stroke', '#ffffff');
    l.setAttribute('stroke-width', '2.4');
    l.setAttribute('stroke-linecap', 'round');
    l.setAttribute('fill', 'none');
    l.style.opacity = 0;
    svg.appendChild(l);
    return l;
  });
  const nodeEls = nodes.map(n => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', n.r);
    c.setAttribute('fill', '#ffffff');
    c.style.transformBox = 'fill-box';
    c.style.transformOrigin = 'center';
    c.style.transform = 'scale(0)';
    svg.appendChild(c);
    return c;
  });

  // per-node drift for the float loop
  const drift = nodes.map((_, i) => ({
    ax: (1.2 + (i % 3) * 0.5) * CONFIG.floatAmount,
    ay: (1.5 + ((i * 1.7) % 4) * 0.5) * CONFIG.floatAmount,
    px: i * 1.3, py: i * 0.7,
    sp: (0.5 + (i % 4) * 0.12) * CONFIG.floatSpeed,
  }));

  function loop(t) {
    const time = t / 1000;
    const pos = nodes.map((n, i) => {
      const d = drift[i];
      return {
        x: n.x + Math.sin(time * d.sp + d.px) * d.ax,
        y: n.y + Math.cos(time * d.sp + d.py) * d.ay,
      };
    });
    nodeEls.forEach((c, i) => { c.setAttribute('cx', pos[i].x); c.setAttribute('cy', pos[i].y); });
    edgeEls.forEach((l, i) => {
      const [a, b] = edges[i];
      l.setAttribute('x1', pos[a].x); l.setAttribute('y1', pos[a].y);
      l.setAttribute('x2', pos[b].x); l.setAttribute('y2', pos[b].y);
    });
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  function play() {
    // only the node network animates — the wordmark image stays static
    nodeEls.forEach(c => { c.style.transition = 'none'; c.style.transform = 'scale(0)'; });
    edgeEls.forEach(l => {
      const len = l.getTotalLength ? l.getTotalLength() : 120;
      l.style.transition = 'none';
      l.style.strokeDasharray = len;
      l.style.strokeDashoffset = len;
      l.style.opacity = 0;
    });

    void svg.getBoundingClientRect();

    // 1) nodes pop in
    nodeEls.forEach((c, i) => {
      c.style.transition = `transform ${CONFIG.nodePopSpeed}ms cubic-bezier(.34,1.56,.64,1)`;
      setTimeout(() => { c.style.transform = 'scale(1)'; }, 100 + i * CONFIG.nodePopStagger);
    });

    // 2) edges self-draw
    const edgesStart = 100 + nodes.length * CONFIG.nodePopStagger;
    edgeEls.forEach((l, i) => {
      setTimeout(() => {
        l.style.transition =
          `stroke-dashoffset ${CONFIG.drawSpeed}ms ${CONFIG.drawEase}, opacity 400ms ease`;
        l.style.strokeDashoffset = 0;
        l.style.opacity = 0.95;
      }, edgesStart + i * CONFIG.drawStagger);
    });
  }

  // kick off node animation + headline, allow replay on click
  function start() {
    play();
    document.querySelector('.headline')?.classList.add('in');
  }
  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);

  document.getElementById('brand')?.addEventListener('click', (e) => {
    const href = e.currentTarget?.getAttribute('href');
    if (href && href !== '#top' && href !== '#') return;
    e.preventDefault();
    play();
  });
})();
