import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { flush } from './helpers/fiiu-ui-harness.js';

/* The member console on a phone at the festival: the bell, the globe, the festival block, the news, the profile
   prompt, touch sizes and the globe download. Rules are read from the shipped CSS and behaviour is run from the
   shipped scripts, cut at their section markers where running the whole console would need a whole DOM. */
const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const css = () => read('web', 'styles', 'dashboard.css');

// Every `header { … }` block in the stylesheet, joined; a brace scan, since rules nest inside media queries.
function blocks(source, header) {
  const found = [];
  for (let start = source.indexOf(header); start !== -1; start = source.indexOf(header, start + 1)) {
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}' && --depth === 0) { found.push(source.slice(start, i + 1)); break; }
    }
  }
  assert.ok(found.length, `${header} block is missing`);
  return found.join('\n');
}

/* ---------------- notifications (finding 30) ---------------- */

test('on phones the bell stays at the right edge and its panel opens inside the screen gutter', () => {
  const phone = blocks(css(), '@media (max-width: 760px)');
  // The wrapped topbar put the bell at the left, so the right-anchored panel hung about 226px off the screen.
  assert.match(phone, /\.top-actions\s*\{\s*margin-left:\s*auto;?\s*\}/);
  assert.match(phone, /\.notif-pop\s*\{[^}]*width:\s*min\(320px,\s*calc\(100vw - 2 \* var\(--pad\)\)\)/, 'never wider than the screen less both gutters');
});

/* ---------------- globe touch (finding 31) ---------------- */

test('a vertical swipe over the globe scrolls the page; sideways drags still turn it', () => {
  const rule = css().match(/#globeCanvas\s*\{[^}]*\}/)[0];
  assert.match(rule, /touch-action:\s*pan-y pinch-zoom/);
  assert.doesNotMatch(rule, /touch-action:\s*none/);
});

class GlobeElement {
  constructor() { this.children = []; this.listeners = {}; this.dataset = {}; this.style = {}; this.hidden = false; this.textContent = ''; this.value = ''; this.classList = { add() {}, remove() {} }; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  appendChild(node) { this.append(node); return node; }
  prepend(node) { node.parent = this; this.children.unshift(node); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() {}
  removeAttribute(name) { if (name === 'hidden') this.hidden = false; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  dispatchEvent(event) { return this.listeners[event.type]?.(event); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 500, height: 500 }; }
  setPointerCapture() {}
}
function globe() {
  const ids = Object.fromEntries(['globeCanvas', 'globeCard', 'globeCity', 'globeLabel', 'globeCount', 'globePeople', 'globeLinks', 'globeEyebrow', 'globeYou', 'globeYouCta', 'globeEmpty', 'globeFeed', 'globeFeedLabel', 'globeTopics', 'globeSince', 'globeSinceLabel', 'globePlay'].map((id) => [id, new GlobeElement()]));
  const draws = [];
  let frame;
  ids.globeCanvas.getContext = () => new Proxy({ createRadialGradient: () => ({ addColorStop() {} }) }, { get(target, name) { return target[name] ?? ((...args) => draws.push({ name, args })); } });
  const snapshot = { places: [{ city: 'Lima', label: 'Lima', lat: -12, lon: -77, members: 1, named: 1, people: [{ id: 'a', name: 'Ana', role: 'Planner', linkedin: '', joinedAt: '2026-09-01T00:00:00Z' }] }], links: [], topics: [], you: { listed: true, hasCity: true, onMap: true, city: 'Lima' } };
  const context = vm.createContext({
    window: { IntersectionObserver: true, devicePixelRatio: 1, matchMedia: () => ({ matches: true }), addEventListener() {}, nodalI18n: { lang: 'en', t: (k) => k, onChange() {} } },
    document: { hidden: false, getElementById: (id) => ids[id] || null, createElement: () => new GlobeElement(), addEventListener() {} },
    console, Event, AbortSignal, performance: { now: () => 1000 },
    IntersectionObserver: class { observe() {} },
    requestAnimationFrame: (callback) => { frame = callback; return 1; }, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    fetch: async () => ({ status: 200, ok: true, headers: { get: () => 'v1' }, json: async () => snapshot }),
  });
  for (const file of ['globe-geo', 'globe']) vm.runInContext(read('web', 'scripts', `${file}.js`), context);
  const canvas = ids.globeCanvas;
  const pointer = (type, x, y, extra = {}) => canvas.dispatchEvent({ type, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', ...extra });
  const drawn = () => { draws.length = 0; frame(1000); return JSON.stringify(draws.filter((d) => ['moveTo', 'lineTo'].includes(d.name)).map((d) => d.args)); };
  const pick = () => canvas.dispatchEvent({ type: 'keydown', key: 'ArrowRight', preventDefault() {} });
  return { ids, canvas, pointer, drawn, pick };
}

test('lifting a finger after spinning the globe keeps the city that was selected', async () => {
  const g = globe();
  await flush();
  g.pick();
  assert.equal(g.ids.globeCard.hidden, false, 'a city is selected');
  g.pointer('pointerdown', 40, 40);
  g.pointer('pointermove', 120, 44);
  g.pointer('pointerup', 120, 44);
  assert.equal(g.ids.globeCard.hidden, false, 'a sideways spin is not a tap: the selection stays');
  g.pointer('pointerdown', 40, 40);
  g.pointer('pointerup', 42, 41);
  assert.equal(g.ids.globeCard.hidden, true, 'a tap on empty space still clears the selection');
});

test('the globe turns from the finger position, and a scroll the browser takes over ends the drag', async () => {
  const g = globe();
  await flush();
  const before = g.drawn();
  // Touch moves may carry no movementX (Safari): the turn comes from clientX.
  g.pointer('pointerdown', 100, 100);
  g.pointer('pointermove', 160, 100);
  const after = g.drawn();
  assert.ok(!/null|NaN/.test(after), 'no undefined movement turns the globe into NaN');
  assert.ok(after !== before, 'a sideways drag turns the globe');
  // pan-y hands a vertical swipe to the browser, which cancels the pointer: the next move is a hover, not a drag.
  g.canvas.style.cursor = '';
  g.pointer('pointercancel', 160, 100);
  g.pointer('pointermove', 200, 300);
  assert.ok(g.canvas.style.cursor, 'after pointercancel a move is a hover again');
});

/* ---------------- touch targets and search scopes (finding 35) ---------------- */

test('every console control is at least 44px on a touch screen, without changing type sizes', () => {
  const touch = blocks(css(), '@media (pointer: coarse)');
  for (const selector of ['.chip', '.seg button', '.side-link', '.side-out', '.lang-btn', '.btn-ghost', '.btn-dark', '.btn-green', '.pill-btn', '.pc-cancel', '.globe-chip', '.globe-play', '.notif-clear', '.location-check .btn-ghost', '.location-check-preference', '.uc-topics label', '.partc input[type="text"]', '.partc select']) {
    assert.ok(touch.includes(selector), `${selector} must reach 44px on touch`);
  }
  assert.match(touch, /min-height:\s*44px/);
  assert.match(touch, /\.top-ico,\s*\.top-avatar\s*\{\s*width:\s*44px;\s*height:\s*44px;?\s*\}/);
  assert.match(touch, /#fiiuDashboard :is\(\.f-button, \.f-text-link\)/, 'the festival block links (fiiu.css stops at 40px)');
  assert.match(touch, /#nodalNews :is\(\.f-text-link, \.nodal-news-all\)/);
  assert.match(touch, /\.side-privacy/);
  assert.doesNotMatch(touch, /font-size/, 'type sizes stay as they are');
});

test('all four search scopes stay visible: two by two on phones, wrapping under the box on laptops', () => {
  const sheet = css();
  assert.match(sheet, /\.search\s*\{[^}]*flex-wrap:\s*wrap/, 'the chips wrap under the input instead of being clipped');
  assert.match(sheet, /\.search-chips\s*\{[^}]*flex:\s*0 0 auto/, 'the chip row is never squeezed into a hidden scroll');
  assert.match(sheet, /\.search input\s*\{[^}]*flex:\s*1 1 \d+px/);
  assert.match(blocks(sheet, '@media (max-width: 1439px)'), /\.search-in\s*\{\s*display:\s*none;?\s*\}/);
  const phone = blocks(sheet, '@media (max-width: 760px)');
  assert.match(phone, /\.search-chips\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

