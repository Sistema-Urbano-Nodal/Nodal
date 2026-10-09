import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');

const LABELS = {
  project: 'Your city question', citygov: 'City Government', investor: 'Investors', ngo: 'NGOs', architect: 'Architects',
  researcher: 'Researchers', mobility: 'Mobility experts', economist: 'Economists', community: 'Community leaders',
  civil: 'Civil engineering', academia: 'Academia', media: 'Media', business: 'Local business',
};

class El {
  constructor(tag, page) { this.tagName = tag; this.page = page; this.attributes = {}; this.children = []; this.listeners = {}; this.classList = { add() {}, remove() {}, toggle() {} }; this.style = { setProperty() {} }; this.hidden = false; this.textContent = ''; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  fire(name, event = {}) { for (const fn of this.listeners[name] || []) fn({ preventDefault() {}, ...event }); }
  after(node) { this.page.after.push([this, node]); }
  focus() { this.page.focused = this; }
  scrollIntoView(options) { this.page.scrolled = [this, options]; }
}

// app.js on the landing graph with reduced motion (no animation frames), the
// real node ids and an English pool of labels.
function graphPage() {
  const page = { after: [], focused: null, docListeners: {} };
  const svg = new El('svg', page), card = new El('div', page);
  card.hidden = true;
  const article = (id) => ({ querySelector: (selector) => (selector === 'h3' ? { textContent: LABELS[id] } : null), querySelectorAll: () => [] });
  const pool = { querySelector: (selector) => article(selector.match(/data-node="([^"]+)"/)[1]) };
  const document = {
    querySelector: (selector) => (selector === '.gc-pool' ? pool : null),
    querySelectorAll: () => [],
    getElementById: (id) => ({ graph: svg, graphCard: card })[id] ?? null,
    createElement: (tag) => new El(tag, page),
    createElementNS: (ns, tag) => new El(tag, page),
    addEventListener: (name, fn) => { (page.docListeners[name] ||= []).push(fn); },
    documentElement: {},
  };
  const context = { document, window: {}, matchMedia: () => ({ matches: true }), MutationObserver: class { observe() {} }, console };
  vm.runInNewContext(read('web', 'scripts', 'app.js'), context, { filename: 'app.js' });
  const nodes = svg.children.filter((child) => child.tagName === 'g');
  return { page, svg, card, nodes, escape: () => page.docListeners.keydown.forEach((fn) => fn({ key: 'Escape' })) };
}

test('phones get one translated, real button per graph node, placed right after the SVG', () => {
  const { page, svg } = graphPage();
  assert.equal(page.after.length, 1);
  const [anchor, list] = page.after[0];
  assert.equal(anchor, svg);
  assert.equal(list.className, 'graph-nodes');
  assert.equal(list.children.length, Object.keys(LABELS).length);
  for (const button of list.children) {
    assert.equal(button.tagName, 'button');
    assert.equal(button.type, 'button');
    assert.equal(button.className, 'gc-peer');
    const id = button.getAttribute('data-i18n').match(/^graph\.n\.(\w+)\.t$/)[1];
    assert.equal(button.textContent, LABELS[id], 'the label comes from the i18n-translated pool');
  }
});

test('a node card opened from the phone list returns focus to that list, and from the SVG to the node', () => {
  const { page, card, nodes, escape } = graphPage();
  const list = page.after[0][1].children;
  const mobility = list.find((button) => button.textContent === LABELS.mobility);
  mobility.fire('click');
  assert.equal(card.hidden, false);
  assert.equal(page.scrolled[0], card, 'the card opens below the list, so it is brought into view');
  assert.equal(page.scrolled[1].block, 'nearest');
  assert.equal(card.children[0].children[0].children[0].textContent, LABELS.mobility);
  // moving to a peer inside the card keeps the phone list as the way back
  const peers = card.children.find((child) => child.className === 'gc-pane' && child.children[0]?.className === 'gc-chips').children[0].children;
  const peer = peers.find((button) => button.textContent === LABELS.economist);
  peer.fire('click');
  escape();
  assert.equal(card.hidden, true);
  assert.equal(page.focused, list.find((button) => button.textContent === LABELS.economist));

  nodes[1].fire('keydown', { key: 'Enter' });
  assert.equal(card.hidden, false);
  const close = card.children[0].children[1];
  close.fire('click');
  assert.equal(card.hidden, true);
  assert.equal(page.focused, nodes[1], 'desktop keeps returning focus to the SVG node');
});

test('the phone list and the scrolling tab strip exist only at phone width', () => {
  const css = read('web', 'styles', 'styles.css');
  assert.match(css, /\.graph-nodes \{ display: none; \}/);
  const phone = [...css.matchAll(/@media \(max-width: 560px\) \{([\s\S]*?)\n\}/g)].map((match) => match[1]).join('\n');
  assert.match(phone, /\.graph-nodes \{ display: flex;/);
  assert.match(phone, /\.graph-nodes \.gc-peer \{ min-height: 44px; \}/);
  assert.match(phone, /\.glabel \{ display: none; \}/);
  assert.match(phone, /\.plat-tabs \{ overflow-x: auto;/);
  assert.match(phone, /\.plat-tab \{ flex: 0 0 auto; white-space: nowrap;/);
  assert.doesNotMatch(css, /\.plat-tab \{[^}]*flex: 1 1 0/, 'equal-width tabs push long words into the next tab');
});
