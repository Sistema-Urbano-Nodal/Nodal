import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Node, key, content, flush, descendants } from './helpers/fiiu-ui-harness.js';
import { FIIU_EVENT } from '../server/fiiu-domain.js';

/* The member console on a phone at the festival: the bell, the globe, the festival block, the news, the profile
   prompt, touch sizes and the globe download. Rules are read from the shipped CSS and behaviour is run from the
   shipped scripts, cut at their section markers where running the whole console would need a whole DOM. */
const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const css = () => read('web', 'styles', 'dashboard.css');
const dashboardJs = () => read('web', 'scripts', 'dashboard.js');

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
// One self-contained piece of dashboard.js: from its opening line to the first `closing` after it.
function piece(source, opening, closing) {
  const start = source.indexOf(opening);
  const end = source.indexOf(closing, start + opening.length);
  assert.ok(start >= 0 && end > start, `${opening.trim()} must stay discoverable in dashboard.js`);
  return source.slice(start, end + closing.length);
}
function loadI18n(lang) {
  const context = { document: { body: { dataset: { page: 'dashboard' } }, documentElement: {}, querySelectorAll: () => [] }, window: { location: { search: '' } }, localStorage: { getItem: () => null, setItem() {} }, URLSearchParams, console };
  vm.runInNewContext(read('web', 'scripts', 'i18n-dashboard.js'), context);
  vm.runInNewContext(read('web', 'scripts', 'i18n.js'), context);
  context.window.nodalI18n.apply(lang, { persist: false });
  return context.window.nodalI18n;
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

/* ---------------- the festival block (finding 32) ---------------- */

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'ana@example.test', name: 'Ana Test', city: 'Lima' };
const registration = { userId: user.id, id: '00000000-0000-4000-8000-000000000002', version: 1, email: user.email, labStatus: 'none', answers: { firstName: 'Ana', lastName: 'Test', activities: ['day1-am'], externalActivities: [] } };
const feed = { event: FIIU_EVENT, config: { registrationOpen: true }, content: [{ id: 'n1', kind: 'news', title: 'Cambio de sala', body: 'El bloque del jueves será en el Auditorio NOS PUCP.', url: '', createdAt: '2026-09-29T12:00:00.000Z' }], nextCursor: null };
async function widget(respond) {
  const body = new Node('body'), host = new Node(), requests = [], listeners = {};
  body.append(host);
  const document = { body, documentElement: { lang: 'en' }, visibilityState: 'visible', getElementById: (id) => (id === 'fiiuDashboardBody' ? host : null), createElement: (tag) => new Node(tag), querySelectorAll: (selector) => body.querySelectorAll(selector), addEventListener: (type, fn) => { listeners[type] = fn; } };
  const context = vm.createContext({ document, window: { nodalI18n: { lang: 'en', onChange() {} } }, Intl, Date, Error, AbortSignal, Promise,
    fetch: async (url) => { requests.push(url); const result = await respond(url, requests.filter((r) => r === url).length); return { ok: !result.status || result.status < 400, status: result.status || 200, json: async () => result.data ?? result }; } });
  for (const name of ['fiiu-ui', 'fiiu-hubs']) vm.runInContext(read('web', 'scripts', `${name}.js`), context);
  await flush();
  return { host, requests, listeners, document };
}
const errors = (host) => descendants(host).filter((node) => node.dataset.fiiuText === 'loadError');
const retries = (host) => descendants(host).filter((node) => node.dataset.fiiuText === 'retry');

test('a failed festival news read shows one error and one retry, which redraws the whole block', async () => {
  const w = await widget((url, n) => (url === '/api/fiiu?kind=news' ? (n === 1 ? { status: 503, data: { error: 'unavailable' } } : feed) : url === '/api/fiiu/registration' ? { user, registration, attendance: [], isAdmin: false } : { questions: [] }));
  assert.equal(errors(w.host).length, 1, 'one error message for the block');
  assert.equal(retries(w.host).length, 1, 'one retry for the block');
  assert.ok(key(w.host, 'viewRegistration'), 'the registration still shows its way back');
  assert.equal(descendants(w.host).filter((node) => node.dataset.fiiuText === 'registration').length, 0, 'no second link to the same page');
  await retries(w.host)[0].listeners.click();
  await flush();
  assert.equal(errors(w.host).length, 0, 'the error goes once both reads succeed');
  assert.equal(retries(w.host).length, 0);
  assert.match(content(w.host), /Cambio de sala/);
  assert.ok(key(w.host, 'badges'), 'badges come back with the retry');
  assert.equal(w.requests.filter((r) => r === '/api/fiiu/registration').length, 2, 'the retry reloads both reads');
});

test('a failed registration read offers a retry instead of telling people to try again with nothing to press', async () => {
  const w = await widget((url, n) => (url === '/api/fiiu/registration' ? (n === 1 ? { status: 503, data: { error: 'unavailable' } } : { user, registration, attendance: [], isAdmin: false }) : url === '/api/fiiu?kind=news' ? feed : { questions: [] }));
  assert.equal(errors(w.host).length, 1);
  const [retry] = retries(w.host);
  assert.ok(retry, 'the error carries its retry');
  const pending = retry.listeners.click();
  assert.equal(retry.disabled, true, 'repeated taps on slow Wi-Fi do not stack requests');
  await pending;
  await flush();
  assert.equal(errors(w.host).length, 0);
  assert.ok(key(w.host, 'statusRegistered'));
  assert.ok(key(w.host, 'viewRegistration'));
});

test('a festival block left open for a while refreshes when the phone comes back to it', async () => {
  const w = await widget((url) => (url === '/api/fiiu/registration' ? { user, registration, attendance: [], isAdmin: false } : url === '/api/fiiu?kind=news' ? feed : { questions: [] }));
  assert.equal(typeof w.listeners.visibilitychange, 'function');
  const reads = () => w.requests.filter((r) => r === '/api/fiiu/registration').length;
  await w.listeners.visibilitychange();
  await flush();
  assert.equal(reads(), 1, 'switching straight back does not reload');
  const realNow = Date.now;
  Date.now = () => realNow() + 31 * 60000;
  try { await w.listeners.visibilitychange(); await flush(); } finally { Date.now = realNow; }
  assert.equal(reads(), 2, 'half an hour later the next session is read again');
});

test('a refresh on the way back keeps the drawn block while it reads, and keeps it when a read fails', async () => {
  let failing = false, release = null;
  const w = await widget(async (url) => {
    if (url === '/api/fiiu/registration' || url === '/api/fiiu?kind=news') {
      if (release) await release;
      if (failing) return { status: 503, data: { error: 'unavailable' } };
    }
    return url === '/api/fiiu/registration' ? { user, registration, attendance: [], isAdmin: false } : url === '/api/fiiu?kind=news' ? feed : { questions: [] };
  });
  const count = (name) => descendants(w.host).filter((node) => node.dataset.fiiuText === name).length;
  const drawn = (when) => {
    assert.equal(count('viewRegistration'), 1, `${when}: the registration keeps its one way back`);
    assert.equal(count('badges'), 1, `${when}: the badges stay`);
    assert.equal(count('allNews'), 1, `${when}: the news stays, once`);
    assert.match(content(w.host), /Cambio de sala/, `${when}: the news stays`);
    assert.equal(count('loading'), 0, `${when}: no loading line replaces the block`);
    assert.equal(errors(w.host).length, 0, `${when}: no error replaces the block`);
  };
  drawn('first load');
  const reads = () => w.requests.filter((r) => r === '/api/fiiu/registration').length;
  const realNow = Date.now;
  Date.now = () => realNow() + 16 * 60000;
  try {
    // A phone waking on venue Wi-Fi: the reads are slow, then fail.
    failing = true;
    let open;
    release = new Promise((resolve) => { open = resolve; });
    const refresh = w.listeners.visibilitychange();
    await flush();
    drawn('while the refresh reads');
    open();
    await refresh;
    await flush();
    drawn('after the refresh failed');
    assert.equal(reads(), 2, 'the refresh did read again');
    // A failed refresh keeps the old time, so the next return tries again, and good reads redraw in one step.
    failing = false;
    release = null;
    await w.listeners.visibilitychange();
    await flush();
    drawn('after a good refresh');
    assert.equal(reads(), 3, 'the next return tries again');
  } finally { Date.now = realNow; }
});

/* ---------------- news read in place (finding 33) ---------------- */

test('festival and NODAL news show six lines, and a longer body opens in place', () => {
  const sheet = css();
  assert.match(sheet, /#fiiuDashboard \.f-news-body,\s*#nodalNews \.f-news-body\s*\{[^}]*-webkit-line-clamp:\s*6;[^}]*line-clamp:\s*6/);
  assert.match(sheet, /#fiiuDashboard \.f-news-body\.is-open,\s*#nodalNews \.f-news-body\.is-open\s*\{[^}]*display:\s*block/);
  assert.match(blocks(sheet, '@media (pointer: coarse)'), /\.news-more/);
});

class Body {
  constructor(id, cut) { this.id = id; this.className = 'f-news-body'; this.scrollHeight = cut ? 130 : 43; this.clientHeight = 43; this.dataset = {}; this.parent = null; this.attributes = {};
    const classes = new Set(['f-news-body']);
    this.classList = { contains: (c) => classes.has(c), toggle: (c, force) => { const on = force ?? !classes.has(c); if (on) classes.add(c); else classes.delete(c); return on; } };
  }
  after(node) { const list = this.parent.children; list.splice(list.indexOf(this) + 1, 0, node); node.parent = this.parent; }
  get nextElementSibling() { const list = this.parent.children; return list[list.indexOf(this) + 1] ?? null; }
}
function newsHarness(bodies) {
  const article = { children: [] };
  for (const body of bodies) { body.parent = article; article.children.push(body); }
  const block = { querySelectorAll: (selector) => (selector === '.f-news-body' ? article.children.filter((n) => n instanceof Body) : []) };
  let observe;
  const created = [];
  const context = {
    byId: (id) => (id === 'fiiuDashboard' ? block : null),
    t: (k) => `t:${k}`,
    el: (tag, cls) => { const classes = new Set(cls.split(' ')); const node = { tagName: tag, className: cls, dataset: {}, attributes: {}, listeners: {}, hidden: false, textContent: '', classList: { contains: (c) => classes.has(c) }, setAttribute(k, v) { this.attributes[k] = String(v); }, addEventListener(type, fn) { this.listeners[type] = fn; } }; created.push(node); return node; },
    MutationObserver: class { constructor(fn) { observe = fn; } observe() {} },
    window: { addEventListener() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  };
  vm.runInNewContext(piece(dashboardJs(), '  (function readNewsInPlace() {', '\n  })();'), context);
  return { article, created, mutate: () => observe([]) };
}

test('only a body the six-line cut shortens gets a Show more toggle, wired for screen readers', () => {
  const short = new Body('', false), long = new Body('', true);
  const h = newsHarness([short, long]);
  const toggles = () => h.article.children.filter((n) => n.className === 'news-more');
  assert.equal(toggles().length, 1);
  const [toggle] = toggles();
  assert.equal(h.article.children.indexOf(toggle), h.article.children.indexOf(long) + 1, 'the toggle follows the body it opens');
  assert.equal(toggle.type, 'button');
  assert.ok(long.id, 'the body gets an id to be controlled by');
  assert.equal(toggle.attributes['aria-controls'], long.id);
  assert.equal(toggle.attributes['aria-expanded'], 'false');
  assert.equal(toggle.dataset.i18n, 'd.news.more', 'a language switch relabels it');
  assert.equal(toggle.textContent, 't:d.news.more');
  toggle.listeners.click();
  assert.equal(long.classList.contains('is-open'), true);
  assert.equal(toggle.attributes['aria-expanded'], 'true');
  assert.equal(toggle.textContent, 't:d.news.less');
  h.mutate();
  assert.equal(toggles().length, 1, 'redraws never add a second toggle');
  toggle.listeners.click();
  assert.equal(long.classList.contains('is-open'), false);
  assert.equal(toggle.textContent, 't:d.news.more');
});

test('Show more and Show less read in English, Spanish and Portuguese', () => {
  const expected = { en: ['Show more', 'Show less'], es: ['Ver más', 'Ver menos'], pt: ['Ver mais', 'Ver menos'] };
  for (const [lang, [more, less]] of Object.entries(expected)) {
    const i18n = loadI18n(lang);
    assert.equal(i18n.t('d.news.more'), more, lang);
    assert.equal(i18n.t('d.news.less'), less, lang);
  }
});

/* ---------------- profile prompt and the festival block's place (finding 34) ---------------- */

function promptHarness({ stored = null, user: me = { id: 'ana', city: '', role: 'Member', topics: [] } } = {}) {
  const source = dashboardJs();
  const storage = new Map(stored === null ? [] : [['nodal.profilePrompt.dismissed', stored]]);
  let opened = 0;
  const context = {
    api: async () => ({ user: me }), byId: () => null, t: (k) => k, applyAll() {}, state: {}, window: {},
    normalizeApiUser: (u) => ({ topics: [], ...u }),
    openUserDialog: () => { opened += 1; },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
  };
  const prompt = piece(source, '  /* ================= profile prompt', '  /* ================= profile dialog').replace(/ {2}\/\* =+ profile dialog$/, '');
  vm.runInNewContext(`let U, confirmedCity;\n${prompt}\n${piece(source, '  async function init() {', '\n  }\n')}\nglobalThis.declinePrompt = declinePrompt; globalThis.done = init();`, context, { filename: 'dashboard-prompt.js' });
  return { context, storage, opened: () => opened };
}

test('the profile prompt opens by itself until the member closes it once', async () => {
  const fresh = promptHarness();
  await fresh.context.done;
  assert.equal(fresh.opened(), 1, 'a new account is asked once');
  fresh.context.declinePrompt();
  assert.equal(fresh.storage.get('nodal.profilePrompt.dismissed'), 'ana');
  const again = promptHarness({ stored: 'ana' });
  await again.context.done;
  assert.equal(again.opened(), 0, 'a closed prompt stays closed on the next visit');
  const other = promptHarness({ stored: 'someone-else' });
  await other.context.done;
  assert.equal(other.opened(), 1, 'another account on the same phone is still asked');
  // Storage that throws (private mode, blocked site data) still loads the console.
  const blocked = promptHarness();
  await blocked.context.done;
  blocked.context.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.doesNotThrow(() => blocked.context.declinePrompt());
});

test('Cancel and Escape on the profile dialog both count as closing the prompt', () => {
  const source = dashboardJs();
  assert.match(source, /byId\('ucCancel'\)\?\.addEventListener\('click', \(\) => \{ declinePrompt\(\); userDialog\.close\(\); \}\);/);
  assert.match(source, /userDialog\.addEventListener\('cancel', declinePrompt\);/);
  assert.match(source, /if \(\(!U\.city \|\| !U\.role \|\| U\.topics\.length === 0\) && !promptDeclined\(\)\) openUserDialog\(\);/);
});

// dashboard-publishing.test.js runs placeFestival(); here, the spacing it gets in its place.
test('on one column the festival block opens the work surface, spaced like a band', () => {
  assert.match(blocks(css(), '@media (max-width: 980px)'), /\.work > #fiiuDashboard\s*\{\s*margin:\s*calc\(var\(--pad\) \* \.7\) var\(--pad\) 0;?\s*\}/);
});

test('the phone nav rail is one sideways row, so the festival block and greeting are not a screen down', () => {
  const phone = blocks(css(), '@media (max-width: 760px)');
  assert.match(phone, /\.side-nav\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto/);
  assert.match(phone, /\.side-nav\s*\{[^}]*mask-image:\s*linear-gradient/, 'a fade at the edge says the row goes on');
  assert.match(phone, /\.side-foot\s*\{\s*display:\s*contents;?\s*\}/, 'language next to the wordmark, sign-out under the row');
  // The scroller clips an outer focus ring, so the ring goes inside.
  assert.match(phone, /\.side \.side-link:focus-visible\s*\{\s*outline-offset:\s*-3px;\s*outline-color:\s*#fff;?\s*\}/, 'white reads on the green active link too');
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

/* ---------------- the globe loads on approach (finding 58) ---------------- */

function globeLoader({ wide = false, observer = true, hasNetwork = true, readyState = 'interactive' } = {}) {
  const appended = [], onLoad = [], idle = [];
  let fire, margin, observed = 0, disconnected = false;
  const context = {
    byId: (id) => (hasNetwork && ['network', 'globeCanvas'].includes(id) ? { id } : null),
    document: { readyState, createElement: (tag) => ({ tagName: tag }), head: { append: (node) => appended.push(node) } },
    window: {
      matchMedia: (query) => ({ matches: wide && /min-width: 1241px/.test(query) }),
      addEventListener: (type, fn) => { if (type === 'load') onLoad.push(fn); },
      requestIdleCallback: (fn) => idle.push(fn),
    },
  };
  if (observer) context.window.IntersectionObserver = context.IntersectionObserver = class { constructor(fn, options) { fire = fn; margin = options?.rootMargin; } observe() { observed += 1; } disconnect() { disconnected = true; } };
  vm.runInNewContext(piece(dashboardJs(), '  (function loadGlobeOnApproach() {', '\n  })();'), context);
  return {
    appended, margin: () => margin, observed: () => observed, disconnected: () => disconnected,
    // the page finishes loading, then the browser goes idle
    settle: () => { onLoad.splice(0).forEach((fn) => fn()); idle.splice(0).forEach((fn) => fn()); },
    near: (yes) => { assert.ok(observed, 'the band is watched'); fire([{ isIntersecting: yes }]); },
  };
}

test('on phones the globe and its 195 KB coastline load only as the network band comes near', () => {
  const g = globeLoader();
  assert.deepEqual(g.appended, [], 'nothing on first load');
  // The greeting, the route and the festival block arrive after the first paint and push the band down:
  // watched at once, it looked near on every cold load.
  assert.equal(g.observed(), 0, 'the band is not watched while the page is still loading');
  g.settle();
  assert.equal(g.observed(), 1);
  assert.match(g.margin(), /\b[6-9]\d\dpx\b/, 'it starts several hundred pixels before the band shows');
  g.near(false);
  assert.deepEqual(g.appended, []);
  g.near(true);
  assert.deepEqual(g.appended.map((s) => s.src), ['coastline.js?v=3', 'globe-geo.js?v=1', 'globe.js?v=29']);
  assert.ok(g.appended.every((s) => s.tagName === 'script' && s.async === false), 'inserted scripts run in order, coastline first');
  assert.equal(g.disconnected(), true);
  g.near(true);
  assert.equal(g.appended.length, 3, 'only once');
  const late = globeLoader({ readyState: 'complete' });
  late.settle();
  assert.equal(late.observed(), 1, 'a console that ran after the load event waits only for idle');
});

test('on the wide console, without IntersectionObserver, or with no globe, the loader behaves', () => {
  assert.equal(globeLoader({ wide: true }).appended.length, 3, 'the wide console, where the globe is on the first screen, loads it at once');
  assert.equal(globeLoader({ observer: false }).appended.length, 3, 'an old browser loads it at once');
  assert.equal(globeLoader({ hasNetwork: false }).appended.length, 0);
});

test('globe.js only looks up elements dashboard.html has, now that dashboard.js loads it', () => {
  const html = read('web', 'pages', 'dashboard.html');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const js = read('web', 'scripts', 'globe.js');
  const referenced = [...js.matchAll(/getElementById\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(referenced.length > 10);
  assert.deepEqual(referenced.filter((id) => !ids.has(id)), []);
});

/* ---------------- language buttons in the console rail (finding 52) ---------------- */

test('the console rail language buttons say which language is on', () => {
  const buttons = ['en', 'es', 'pt'].map((lang) => ({ dataset: { lang }, attributes: {}, setAttribute(k, v) { this.attributes[k] = String(v); } }));
  let listener;
  const context = { document: { querySelectorAll: (s) => (s === '.lang-btn' ? buttons : []) }, I18N: { lang: 'es', onChange: (fn) => { listener = fn; } } };
  vm.runInNewContext(piece(dashboardJs(), '  (function pressedLanguage() {', '\n  })();'), context);
  assert.deepEqual(buttons.map((b) => b.attributes['aria-pressed']), ['false', 'true', 'false']);
  context.I18N.lang = 'pt';
  listener('pt');
  assert.deepEqual(buttons.map((b) => b.attributes['aria-pressed']), ['false', 'false', 'true']);
});
