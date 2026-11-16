import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/* The landing's network graph (app.js) with reduced motion, so a drag moves a node at once, in a fake page whose
   elements keep their classes and attributes. */
const source = readFileSync(new URL('../web/scripts/app.js', import.meta.url), 'utf8');
const LABELS = {
  project: 'Your city question', citygov: 'City Government', investor: 'Investors', ngo: 'NGOs', architect: 'Architects',
  researcher: 'Researchers', mobility: 'Mobility experts', economist: 'Economists', community: 'Community leaders',
  civil: 'Civil engineering', academia: 'Academia', media: 'Media', business: 'Local business',
};

class El {
  constructor(tag) {
    this.tagName = tag; this.attributes = {}; this.children = []; this.listeners = {}; this.style = { setProperty() {} };
    this.hidden = false; this.textContent = ''; this.className = '';
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name),
      toggle: (name, on = !classes.has(name)) => { if (on) classes.add(name); else classes.delete(name); return on; },
    };
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  fire(name, event = {}) { for (const fn of this.listeners[name] || []) fn({ preventDefault() {}, ...event }); }
  after() {}
  focus() {}
  scrollIntoView() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 900, height: 520 }; }   // one CSS pixel per graph unit
  setPointerCapture() {}
  hasPointerCapture() { return false; }
  releasePointerCapture() {}
}

function graphPage() {
  const documentListeners = {};
  const svg = new El('svg'); const card = new El('div');
  card.hidden = true;
  const article = (id) => ({ querySelector: (selector) => (selector === 'h3' ? { textContent: LABELS[id] } : null), querySelectorAll: () => [] });
  const pool = { querySelector: (selector) => article(selector.match(/data-node="([^"]+)"/)[1]) };
  const document = {
    querySelector: (selector) => (selector === '.gc-pool' ? pool : null),
    querySelectorAll: () => [],
    getElementById: (id) => ({ graph: svg, graphCard: card })[id] ?? null,
    createElement: (tag) => new El(tag),
    createElementNS: (ns, tag) => new El(tag),
    addEventListener: (name, fn) => { (documentListeners[name] ||= []).push(fn); },
    documentElement: {},
  };
  vm.runInNewContext(source, { document, window: {}, matchMedia: () => ({ matches: true }), MutationObserver: class { observe() {} }, console }, { filename: 'app.js' });
  return {
    card,
    nodes: svg.children.filter((child) => child.tagName === 'g'),
    // an event that bubbled up to the document, as a pointerup lifted away from the node does
    document: (name, event) => (documentListeners[name] || []).forEach((fn) => fn(event)),
  };
}

/* ---------- M97: a drag belongs to the finger that started it ---------- */

test('a second finger lifting, anywhere, leaves the first finger dragging its graph node', () => {
  const g = graphPage();
  const node = g.nodes[1];
  const dot = node.children[1];   // ring, dot, label
  node.fire('pointerdown', { pointerId: 1, clientX: 185, clientY: 115 });
  assert.equal(node.classList.contains('is-drag'), true);

  g.document('pointerup', { pointerId: 2 });       // a second finger lifted elsewhere on the page
  node.fire('pointerup', { pointerId: 2 });        // ... or over the dragged node itself
  assert.equal(node.classList.contains('is-drag'), true, 'the first finger still holds the node');
  node.fire('pointermove', { pointerId: 1, clientX: 300, clientY: 200 });
  assert.deepEqual([dot.getAttribute('cx'), dot.getAttribute('cy')], ['300.0', '200.0'], 'the node follows the first finger');
  node.fire('pointermove', { pointerId: 2, clientX: 600, clientY: 400 });
  assert.equal(dot.getAttribute('cx'), '300.0', 'a second finger crossing the node does not take it over');

  node.fire('pointerup', { pointerId: 1, clientX: 300, clientY: 200 });
  assert.equal(node.classList.contains('is-drag'), false, 'the drag ends when its own finger lifts');
  assert.equal(g.card.hidden, true, 'a drag is not a tap: no card opens');
});

test('the page-wide safety net still ends a drag whose own pointer was released off the node', () => {
  const g = graphPage();
  const node = g.nodes[2];
  node.fire('pointerdown', { pointerId: 7, clientX: 430, clientY: 75 });
  g.document('pointerup', { pointerId: 7 });
  assert.equal(node.classList.contains('is-drag'), false);
  node.fire('pointermove', { pointerId: 7, clientX: 600, clientY: 300 });
  assert.notEqual(node.children[1].getAttribute('cx'), '600.0', 'the released node no longer follows the pointer');
});
