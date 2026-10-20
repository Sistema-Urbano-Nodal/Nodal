import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Node, key, content, flush, descendants } from './helpers/fiiu-ui-harness.js';
import { FIIU_EVENT } from '../server/fiiu-domain.js';
import { mergeProgramme } from '../server/fiiu-programme.js';

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
// A page clock frozen at iso; set() moves it on.
function clock(iso) {
  let at = Date.parse(iso);
  return { Date: class extends Date { constructor(...args) { super(...(args.length ? args : [at])); } static now() { return at; } }, set: (next) => { at = Date.parse(next); } };
}
// time: a clock(); without one the block runs on the real date. timers: what the block set with setInterval, cleared ones marked.
async function widget(respond, { time } = {}) {
  const body = new Node('body'), host = new Node(), requests = [], listeners = {}, events = [], timers = [];
  body.append(host);
  // events: what the block dispatches on document for the console (dashboard.js) to pick up.
  const document = { body, documentElement: { lang: 'en' }, visibilityState: 'visible', getElementById: (id) => (id === 'fiiuDashboardBody' ? host : null), createElement: (tag) => new Node(tag), querySelectorAll: (selector) => body.querySelectorAll(selector), addEventListener: (type, fn) => { listeners[type] = fn; }, dispatchEvent: (event) => { events.push(event); return true; } };
  const CustomEvent = class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
  const context = vm.createContext({ document, CustomEvent, window: { nodalI18n: { lang: 'en', onChange() {} } }, Intl, Date: time?.Date ?? Date, Error, AbortSignal, Promise,
    setInterval: (callback, delay) => timers.push({ callback, delay }), clearInterval: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    fetch: async (url) => { requests.push(url); const result = await respond(url, requests.filter((r) => r === url).length); return { ok: !result.status || result.status < 400, status: result.status || 200, json: async () => result.data ?? result }; } });
  for (const name of ['fiiu-ui', 'fiiu-hubs']) vm.runInContext(read('web', 'scripts', `${name}.js`), context);
  await flush();
  return { host, requests, listeners, document, events, timers };
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

test('the block says whether the member is registered, so the console can place it (unknown while a read fails)', async () => {
  const failed = await widget((url) => (url === '/api/fiiu/registration' ? { status: 503, data: { error: 'unavailable' } } : url === '/api/fiiu?kind=news' ? feed : { questions: [] }));
  assert.equal(failed.host.dataset.registered, undefined);
  const member = await widget((url) => (url === '/api/fiiu/registration' ? { user, registration, attendance: [], isAdmin: false } : url === '/api/fiiu?kind=news' ? feed : { questions: [] }));
  assert.equal(member.host.dataset.registered, 'true');
  const guest = await widget((url) => (url === '/api/fiiu/registration' ? { user, registration: null, attendance: [], isAdmin: false } : url === '/api/fiiu?kind=news' ? feed : { questions: [] }));
  assert.equal(guest.host.dataset.registered, 'false');
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

test('the festival block hands its registration, attendance and programme to the Recognition ledger, which reads nothing itself', async () => {
  const attendance = [{ activityId: 'day1-am', createdAt: '2026-10-21T14:12:00.000Z', method: 'qr' }];
  let failing = false;
  const w = await widget((url) => (failing && url === '/api/fiiu?kind=news' ? { status: 503, data: { error: 'unavailable' } } : url === '/api/fiiu/registration' ? { user, registration, attendance, isAdmin: false } : url === '/api/fiiu?kind=news' ? feed : { questions: [] }));
  assert.equal(w.events.length, 1, 'one hand-off per drawn block');
  const [event] = w.events;
  assert.equal(event.type, 'nodal:fiiu-festival');
  assert.equal(event.detail.registration.id, registration.id);
  assert.deepEqual(event.detail.attendance, attendance);
  assert.equal(event.detail.event, feed.event, 'the merged programme the news page carries');
  assert.deepEqual([...new Set(w.requests)].sort(), ['/api/fiiu/pulse', '/api/fiiu/registration', '/api/fiiu?kind=news'], 'the reads the block already made');
  const realNow = Date.now;
  Date.now = () => realNow() + 16 * 60000;
  try {
    // A refresh on the way back hands the new data over too; a refresh that fails hands nothing, so the ledger keeps what it shows.
    await w.listeners.visibilitychange();
    await flush();
    assert.equal(w.events.length, 2);
    failing = true;
    Date.now = () => realNow() + 32 * 60000;
    await w.listeners.visibilitychange();
    await flush();
    assert.equal(w.events.length, 2);
  } finally { Date.now = realNow; }
  // Without a registration the hand-off says so, and the ledger shows no festival family; a failed first read sends nothing.
  const guest = await widget((url) => (url === '/api/fiiu/registration' ? { user, registration: null, attendance: [], isAdmin: false } : url === '/api/fiiu?kind=news' ? feed : { questions: [] }));
  assert.equal(guest.events.length, 1);
  assert.equal(guest.events[0].detail.registration, null);
  const failed = await widget((url) => (url === '/api/fiiu?kind=news' ? { status: 503, data: { error: 'unavailable' } } : url === '/api/fiiu/registration' ? { user, registration, attendance, isAdmin: false } : { questions: [] }));
  assert.equal(failed.events.length, 0);
});

test('the member’s session under way reads Happening now, and the block follows the clock to the next one without a reload', async () => {
  // Wed 21 Oct, 10:10 in Lima: day1-am (09:00–13:00) is on; the compact live line skips it and names day1-pm as up next.
  const time = clock('2026-10-21T10:10:00-05:00');
  const plan = { ...registration, answers: { ...registration.answers, activities: ['day1-am', 'day1-pm'] } };
  const w = await widget((url) => (url === '/api/fiiu/registration' ? { user, registration: plan, attendance: [], isAdmin: false } : url === '/api/fiiu?kind=news' ? feed : { questions: [] }), { time });
  const next = () => { const line = w.host.querySelector('.f-next'); return line && [line.children[0].dataset.fiiuText, content(line.querySelector('.f-next-title')).trim()]; };
  const reads = () => w.requests.filter((r) => r === '/api/fiiu/registration').length;
  const tick = async (at) => { time.set(at); await Promise.all(w.timers.filter((timer) => !timer.cleared).map((timer) => timer.callback())); await flush(); };
  assert.deepEqual(next(), ['nowForYou', 'El poder de lo local']);
  assert.deepEqual(w.timers.map((timer) => timer.delay), [60000], 'one check a minute');
  await tick('2026-10-21T10:11:00-05:00');
  assert.equal(reads(), 1, 'a minute with nothing new reads nothing');
  // 13:00:30: the morning block is over. A phone in a pocket reads nothing; back on screen, the block moves on at once.
  w.document.visibilityState = 'hidden';
  await tick('2026-10-21T13:00:30-05:00');
  assert.equal(reads(), 1);
  w.document.visibilityState = 'visible';
  await w.listeners.visibilitychange();
  await flush();
  assert.equal(reads(), 2);
  assert.equal(next()[0], 'nextForYou');
  assert.match(next()[1], /^Intervenir para activar/);
  await tick('2026-10-21T19:00:30-05:00');
  assert.equal(next()[0], 'nowForYou', 'the evening block, once it starts');
  assert.match(next()[1], /^Intervenir para activar/);
  await tick('2026-10-21T21:00:30-05:00');
  assert.equal(next(), null, 'nothing left in the plan');
  assert.equal(reads(), 4);
  assert.equal(w.timers.length, 1, 'redraws do not stack checks');
  // After the last day the check stops.
  await tick('2026-10-26T09:00:00-05:00');
  assert.equal(w.timers[0].cleared, true);
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
  // Placed after the greeting for a member without a registration, it keeps the route's own gap off the title block.
  assert.match(blocks(css(), '@media (max-width: 980px)'), /#overview > #fiiuDashboard\s*\{\s*margin-top:\s*clamp\(26px, 3\.4vh, 46px\);?\s*\}/);
});

test('the phone nav rail is one sideways row, so the festival block and greeting are not a screen down', () => {
  const phone = blocks(css(), '@media (max-width: 760px)');
  assert.match(phone, /\.side-nav\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto/);
  assert.match(phone, /\.side-nav\s*\{[^}]*mask-image:\s*linear-gradient/, 'a fade at the edge says the row goes on');
  assert.match(phone, /\.side-foot\s*\{\s*display:\s*contents;?\s*\}/, 'language next to the wordmark, sign-out under the row');
  // The scroller clips an outer focus ring, so the ring goes inside.
  assert.match(phone, /\.side \.side-link:focus-visible\s*\{\s*outline-offset:\s*-3px;\s*outline-color:\s*#fff;?\s*\}/, 'white reads on the green active link too');
  // A mouse cannot swipe the row and its scrollbar is hidden, so with a fine pointer the links wrap again.
  const mouse = blocks(css(), '@media (max-width: 760px) and (hover: hover) and (pointer: fine)');
  assert.match(mouse, /\.side-nav\s*\{[^}]*flex-wrap:\s*wrap;[^}]*overflow-x:\s*visible;[^}]*mask-image:\s*none/);
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
  assert.deepEqual(g.appended.map((s) => s.src), ['coastline.js?v=3', 'globe-geo.js?v=1', 'globe.js?v=30']);
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


/* ---------------- FIIU badges in the Recognition ledger ---------------- */

// The recognition section of dashboard.js, run against fiiu-ui.js and the real dictionaries, fed the way fiiu-hubs.js feeds it.
const festivalPlan = (answers) => ({ id: 'r-1', version: 1, labStatus: 'none', answers: { activities: [], externalActivities: [], applyLab: false, ...answers } });
const anaPlan = festivalPlan({ activities: ['day1-am', 'day2-am', 'closing-party'], externalActivities: ['workshop-espacios-comunidad'] });
const attended = (...ids) => ids.map((activityId) => ({ activityId, createdAt: '2026-10-21T14:12:00.000Z', method: activityId.startsWith('day') ? 'qr' : 'staff' }));
// The programme as the API serves it, with an organiser's venue change on day1-am.
const EDITED = JSON.parse(JSON.stringify(mergeProgramme([{ id: 'day1-am', data: { venue: 'Auditorio NOS PUCP, San Isidro' } }])));
const text = (node) => node.textContent + node.children.map(text).join('');
// The console appends strings and calls appendChild, which the festival harness's Node does not.
class El extends Node {
  append(...nodes) { super.append(...nodes.map((n) => (typeof n === 'string' ? Object.assign(new El('#text'), { textContent: n }) : n))); }
  appendChild(node) { this.append(node); return node; }
}
function ledger({ lang = 'en', storage = new Map(), store, fiiuLoaded = true, me = { id: 'ana-id' } } = {}) {
  const nodes = { badgeGrid: new El('div'), badgesEyebrow: new El('span') }, listeners = {};
  const document = {
    documentElement: { lang }, querySelectorAll: () => [], getElementById: (id) => nodes[id] ?? null,
    createElement: (tag) => new El(tag), createElementNS: (ns, tag) => Object.assign(new El(tag), { namespaceURI: ns }),
    createTextNode: (value) => Object.assign(new El('#text'), { textContent: value }),
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  const i18n = loadI18n(lang);
  const localStorage = store ?? { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) };
  const context = vm.createContext({ document, localStorage, i18n, Intl, Date, Error, JSON, window: { nodalI18n: { lang, onChange() {} } } });
  if (fiiuLoaded) vm.runInContext(read('web', 'scripts', 'fiiu-ui.js'), context);
  const source = dashboardJs();
  const helpers = piece(source, '  const el = (tag, cls, text) => {', 'if (node) node.textContent = text; };');
  const svg = piece(source, "  const SVGNS = 'http://www.w3.org/2000/svg';", '    return node;\n  };');
  const recognition = piece(source, '  /* ================= recognition', '  /* ================= self-assessment').replace(/ {2}\/\* =+ self-assessment$/, '');
  const user = { assessed: false, indicators: { transmission: 'No' }, topics: [], city: 'Lima', ...me };
  vm.runInContext(`const t = (key, vars) => i18n.t(key, vars);\n${helpers}\n${svg}\nlet U = ${JSON.stringify(user)};\nconst maxLevel = () => 0;\nconst cityLabel = () => U.city;\n${recognition}\nglobalThis.renderBadges = renderBadges; globalThis.familyMark = familyMark;`, context, { filename: 'dashboard-recognition.js' });
  const grid = nodes.badgeGrid;
  const groups = () => grid.children.map((group) => ({ family: group.children[0].children[1].textContent, count: group.children[0].children[2].textContent, rows: group.children.filter((n) => n.tagName === 'article') }));
  return {
    grid, storage, context, groups,
    eyebrow: () => nodes.badgesEyebrow.textContent,
    render: () => context.renderBadges(),
    hand: (detail) => listeners['nodal:fiiu-festival']?.({ type: 'nodal:fiiu-festival', detail }),
    lang: (next) => { i18n.apply(next, { persist: false }); context.window.nodalI18n.lang = next; context.renderBadges(); },
  };
}
function view(row) {
  const [idx, body, status] = row.children;
  const [name, req, opens] = body.children;
  const tags = name.children.filter((n) => /\bbl-(next|new)\b/.test(n.className));
  return {
    idx: idx.textContent, state: row.className, req: text(req), opens: text(opens),
    name: name.textContent + name.children.filter((n) => !tags.includes(n)).map(text).join(''),
    lang: name.children.find((n) => !tags.includes(n))?.lang ?? null,
    tags: tags.map((n) => n.textContent),
    check: status.children.find((n) => n.className === 'bl-check')?.['aria-label'] ?? null,
    meter: status.children.find((n) => n.className === 'bl-frac')?.textContent ?? null,
  };
}
const familyNames = (l) => l.groups().map((g) => g.family);

test('members without a FIIU registration see the ledger exactly as before, and nothing is remembered for them', () => {
  const l = ledger();
  l.render();
  const shown = text(l.grid), eyebrow = l.eyebrow();
  assert.deepEqual(familyNames(l), ['Contribution', 'Role', 'Recognition']);
  assert.equal(eyebrow, 'Recognition · 0 of 11');
  l.hand({ registration: null, attendance: [], event: FIIU_EVENT });
  assert.equal(text(l.grid), shown);
  assert.equal(l.eyebrow(), eyebrow);
  assert.equal(l.storage.size, 0);
  // Before fiiu-ui.js has run (it loads after dashboard.js) the family is simply absent too, without an error.
  const early = ledger({ fiiuLoaded: false });
  early.render();
  assert.doesNotThrow(() => early.hand({ registration: anaPlan, attendance: attended('day1-am'), event: FIIU_EVENT }));
  assert.deepEqual(familyNames(early), ['Contribution', 'Role', 'Recognition']);
});

test('a registrant’s FIIU Fest 11 family heads the ledger: a row per session in the plan, locked until checked in, then dated with its hours', () => {
  const l = ledger();
  l.render();
  l.hand({ registration: anaPlan, attendance: attended('day1-am'), event: EDITED });
  const [fiiu, contribution] = l.groups();
  assert.deepEqual(familyNames(l), ['FIIU Fest 11', 'Contribution', 'Role', 'Recognition']);
  assert.equal(fiiu.count, '2/6');
  const rows = fiiu.rows.map(view);
  assert.deepEqual(rows.map((r) => r.idx), ['01', '02', '03', '04', '05', '06']);
  assert.deepEqual(rows[0], { idx: '01', state: 'bl-row is-earned', name: 'El poder de lo local', lang: 'es', tags: ['New'], check: 'earned', meter: null,
    req: 'Wed 21 Oct · 09:00–13:00 · Auditorio NOS PUCP, San Isidro', opens: 'Opens: 4 h toward your FIIU certificate' });
  assert.deepEqual(rows[1], { idx: '02', state: 'bl-row is-locked', name: 'Cuidar y transformar la ciudad', lang: 'es', tags: ['next'], check: 'locked', meter: null,
    req: 'Check in with the session QR to unlock', opens: 'Opens: 4 h toward your FIIU certificate' });
  assert.deepEqual(rows.slice(2).map((r) => [r.name, r.state, r.meter ?? r.check, r.tags]), [
    ['First activity', 'bl-row is-earned', 'earned', ['New']],
    ['Four panels', 'bl-row is-locked', '1/4', []],
    ['All five panels', 'bl-row is-locked', '1/5', []],
    ['Full FIIU', 'bl-row is-locked', '1/9', []],
  ]);
  assert.match(rows[3].req, /Conference blocks attended, 4 of the 5/);
  assert.match(rows[5].req, /All 5 conference blocks, 2 workshops and 2 urban routes/);
  assert.equal(view(contribution.rows[0]).idx, '07', 'the numbering runs on through the ledger');
  assert.equal(l.eyebrow(), 'Recognition · 2 of 17', 'the band counts the festival badges too');
  // A refresh with a new check-in redraws the family.
  l.hand({ registration: anaPlan, attendance: attended('day1-am', 'day2-am'), event: EDITED });
  assert.equal(l.groups()[0].count, '3/6');
  assert.equal(l.eyebrow(), 'Recognition · 3 of 17');
});

test('workshops and routes appear once the team confirms them, without hours; the laboratory is listed for applicants, with no milestone of its own', () => {
  const l = ledger();
  l.hand({ registration: festivalPlan({ publicOfficial: true, applyLab: true, activities: ['day1-am'] }), attendance: attended('workshop-espacios-comunidad'), event: FIIU_EVENT });
  const rows = l.groups()[0].rows.map(view);
  assert.deepEqual(rows.map((r) => [r.name.slice(0, 22), r.state.replace('bl-row ', '')]), [
    ['Gestión urbana en acci', 'is-locked'], ['El poder de lo local', 'is-locked'], ['Espacios que sostienen', 'is-earned'],
    ['First activity', 'is-earned'], ['Four panels', 'is-locked'], ['All five panels', 'is-locked'], ['Full FIIU', 'is-locked'],
  ]);
  assert.equal(rows[0].opens, 'Opens: a record of your participation in FIIU Fest 11', 'the laboratory has no certificate hours while its length is unknown');
  assert.equal(rows[2].req, 'Wed 21 Oct · MALI, Cercado de Lima', 'a workshop with no time keeps its day and venue');
  assert.equal(rows[2].opens, 'Opens: a record of your participation in FIIU Fest 11');
  assert.equal(rows[6].meter, '1/9', 'the confirmed workshop is one of the two Full FIIU asks for');
  assert.equal(rows[0].tags.join(), 'next', 'the first badge not yet earned, overall');
  assert.ok(!rows.some((r) => /Fiesta/.test(r.name)), 'the closing party is never a badge');
});

test('badges earned since the last visit carry a New tag, kept through this visit and gone on the next; without storage there are none', () => {
  const storage = new Map();
  const newOnes = (l) => l.groups()[0].rows.map(view).filter((r) => r.tags.length && r.state.endsWith('is-earned')).map((r) => [r.name, r.tags.join()]);
  const first = ledger({ storage });
  first.hand({ registration: anaPlan, attendance: attended('day1-am'), event: FIIU_EVENT });
  assert.deepEqual(newOnes(first), [['El poder de lo local', 'New'], ['First activity', 'New']]);
  assert.deepEqual(JSON.parse(storage.get('nodal.fiiuBadgesSeen.ana-id')).sort(), ['milestone:first', 'session:day1-am'], 'remembered per account once drawn');
  first.lang('es');
  assert.deepEqual(newOnes(first), [['El poder de lo local', 'Nueva'], ['Primera actividad', 'Nueva']], 'a redraw in this visit keeps them');
  const later = ledger({ storage });
  later.hand({ registration: anaPlan, attendance: attended('day1-am'), event: FIIU_EVENT });
  assert.deepEqual(newOnes(later), [], 'the next visit shows them as seen');
  later.hand({ registration: anaPlan, attendance: attended('day1-am', 'day2-am'), event: FIIU_EVENT });
  assert.deepEqual(newOnes(later), [['Cuidar y transformar la ciudad', 'New']], 'a check-in made meanwhile is new');
  const other = ledger({ storage, me: { id: 'beto-id' } });
  other.hand({ registration: anaPlan, attendance: attended('day1-am'), event: FIIU_EVENT });
  assert.equal(newOnes(other).length, 2, 'another account on the same phone keeps its own list');
  for (const store of [{ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, { getItem: () => null, setItem() { throw new Error('quota'); } }]) {
    const blocked = ledger({ store });
    assert.doesNotThrow(() => blocked.hand({ registration: anaPlan, attendance: attended('day1-am'), event: FIIU_EVENT }));
    assert.equal(blocked.groups()[0].family, 'FIIU Fest 11', 'the family still shows');
    assert.deepEqual(newOnes(blocked), [], 'storage that cannot keep the list shows no tags rather than the same ones on every visit');
  }
});

test('each earned FIIU badge in the ledger can be shared, and only those: not locked rows, not the other families', async () => {
  const l = ledger(), shared = [];
  l.context.navigator = { share: async (data) => { shared.push(JSON.parse(JSON.stringify(data))); } };
  l.hand({ registration: anaPlan, attendance: attended('day1-am'), event: FIIU_EVENT });
  const [fiiu, ...others] = l.groups();
  const share = (row) => row.querySelector('.f-share-button');
  const byName = (name) => fiiu.rows.find((row) => view(row).name.startsWith(name));
  assert.deepEqual(fiiu.rows.map((row) => [view(row).name.slice(0, 20), Boolean(share(row))]), [
    ['El poder de lo local', true], ['Cuidar y transformar', false], ['First activity', true], ['Four panels', false], ['All five panels', false], ['Full FIIU', false],
  ]);
  assert.ok(others.every((group) => group.rows.every((row) => !share(row))), 'only FIIU badges have something to share');
  const session = share(byName('El poder de lo local'));
  assert.equal(session.textContent, 'Share');
  assert.equal(session['aria-label'], 'Share: El poder de lo local', 'several buttons on one page, each named by its badge');
  await session.listeners.click();
  await share(byName('First activity')).listeners.click();
  assert.deepEqual(shared.map((data) => data.text), [
    'I was at “El poder de lo local” at FIIU Fest 11 in Lima. Ideas for the city that start at the local level. Programme: https://fiiu.sistemaurbano.org/ #FIIU11',
    'My first FIIU Fest 11 activity was “El poder de lo local”. https://fiiu.sistemaurbano.org/ #FIIU11',
  ]);
  // The row keeps its three lines (name, requirement, what it opens); the share control comes after them.
  assert.equal(byName('El poder de lo local').children[1].children.at(-1).className, 'f-share');
  l.lang('es');
  assert.equal(share(l.groups()[0].rows[0]).textContent, 'Compartir', 'a language switch redraws it in the new language');
});

test('First activity names the block actually attended, and Four panels offers no share once all five are earned', async () => {
  const shared = [], panels = ['day1-am', 'day1-pm', 'day2-am', 'day2-pm', 'day3-am'];
  const share = (row) => row.querySelector('.f-share-button');
  const missed = ledger();
  missed.context.navigator = { share: async (data) => { shared.push(JSON.parse(JSON.stringify(data))); } };
  missed.hand({ registration: anaPlan, attendance: attended('day2-am'), event: FIIU_EVENT });
  const rows = missed.groups()[0].rows, byName = (name) => rows.find((row) => view(row).name.startsWith(name));
  assert.equal(share(byName('El poder de lo local')), null, 'a planned block that was missed has nothing to share');
  await share(byName('First activity')).listeners.click();
  assert.equal(shared[0].text, 'My first FIIU Fest 11 activity was “Cuidar y transformar la ciudad”. https://fiiu.sistemaurbano.org/ #FIIU11');
  const all = ledger();
  all.hand({ registration: festivalPlan({ activities: panels }), attendance: attended(...panels), event: FIIU_EVENT });
  const done = all.groups()[0].rows, named = (name) => done.find((row) => view(row).name.startsWith(name));
  assert.equal(share(named('Four panels')), null, 'four of five would understate five of five');
  assert.ok(share(named('All five panels')));
});

test('in the ledger a panel session offers WhatsApp but not LinkedIn; a milestone or a workshop offers both', () => {
  const l = ledger();
  l.hand({ registration: anaPlan, attendance: attended('day1-am', 'workshop-espacios-comunidad'), event: FIIU_EVENT });
  const rows = l.groups()[0].rows, byName = (name) => rows.find((row) => view(row).name.startsWith(name));
  const kinds = (row) => (row.querySelector('.f-share')?.children || []).filter((n) => n.tagName === 'a').map((n) => n.dataset.fiiuText);
  assert.deepEqual(kinds(byName('El poder de lo local')), ['shareWhatsApp']);
  assert.deepEqual(kinds(byName('Espacios que sostienen')), ['shareWhatsApp', 'shareLinkedIn']);
  assert.deepEqual(kinds(byName('First activity')), ['shareWhatsApp', 'shareLinkedIn']);
  const linkedIn = byName('First activity').querySelector('.f-share').children.find((n) => n.dataset.fiiuText === 'shareLinkedIn');
  assert.equal(linkedIn['aria-label'], 'Add to LinkedIn: First activity (opens in a new tab)', 'named by its badge, and says it opens a new tab');
  assert.equal(new URL(linkedIn.href).searchParams.get('organizationName'), 'NODAL');
  const whatsApp = byName('First activity').querySelector('.f-share').children.find((n) => n.dataset.fiiuText === 'shareWhatsApp');
  assert.equal(whatsApp['aria-label'], 'Send via WhatsApp: First activity (opens in a new tab)');
  const workshop = byName('Espacios que sostienen').querySelector('.f-share').children.find((n) => n.dataset.fiiuText === 'shareLinkedIn');
  assert.equal(new URL(workshop.href).searchParams.get('name'), 'FIIU Fest 11 · Espacios que sostienen comunidad', 'a 162-character title keeps its part before the colon');
});

test('a ledger redraw (a refresh on the way back from the share sheet, a language switch) gives focus back to the same share button', () => {
  const l = ledger();
  l.context.navigator = { share: async () => {} };
  l.hand({ registration: anaPlan, attendance: attended('day1-am'), event: FIIU_EVENT });
  const copyOf = () => l.groups()[0].rows[0].querySelector('.f-share').children.filter((n) => n.tagName === 'button')[1];
  const before = copyOf();
  l.context.document.activeElement = before;
  l.hand({ registration: anaPlan, attendance: attended('day1-am'), event: FIIU_EVENT });
  const after = copyOf();
  assert.notEqual(after, before, 'the row was drawn again');
  assert.equal(after.focused, true, 'focus is back on Copy text of the same badge');
  assert.match(read('web', 'scripts', 'dashboard.js'), /focus\?\.\(\{ preventScroll: true \}\)/, 'without moving the page');
});

test('the FIIU family reads in English, Spanish and Portuguese, with its own family mark', () => {
  const dash = { window: {} };
  vm.runInNewContext(read('web', 'scripts', 'i18n-dashboard.js'), dash);
  const fiiuKeys = (lang) => Object.keys(dash.window.NODAL_I18N_DASH[lang]).filter((k) => k.startsWith('d.badge.fiiu.')).sort();
  assert.ok(fiiuKeys('en').length >= 17);
  for (const lang of ['es', 'pt']) assert.deepEqual(fiiuKeys(lang), fiiuKeys('en'), `${lang} has every FIIU badge string`);
  for (const lang of ['en', 'es', 'pt']) for (const k of fiiuKeys(lang)) assert.ok(dash.window.NODAL_I18N_DASH[lang][k].trim(), `${lang} ${k}`);
  const l = ledger({ lang: 'es' });
  l.hand({ registration: anaPlan, attendance: attended('day1-am'), event: FIIU_EVENT });
  const rows = l.groups()[0].rows.map(view);
  assert.equal(l.eyebrow(), 'Reconocimiento · 2 de 17');
  assert.equal(rows[0].opens, 'Abre: 4 h para tu certificado del FIIU');
  assert.equal(rows[1].req, 'Registra tu asistencia con el QR de la sesión para desbloquearla');
  assert.match(rows[0].req, /21/);
  l.lang('pt');
  assert.equal(view(l.groups()[0].rows[2]).name, 'Primeira atividade');
  assert.equal(l.eyebrow(), 'Reconhecimento · 2 de 17');
  const mark = (fam) => l.context.familyMark(fam).children.map((n) => n.tagName).join();
  assert.equal(mark('fiiu'), 'rect,circle', 'a check-in square, drawn like the other marks');
  assert.notEqual(mark('fiiu'), mark('contribution'));
});

test('the ledger listens before the festival block can hand anything over, and draws no left accent bars', () => {
  const html = read('web', 'pages', 'dashboard.html');
  const at = (name) => html.indexOf(`src="${name}?`);
  assert.ok(at('dashboard.js') > 0 && at('dashboard.js') < at('fiiu-ui.js') && at('fiiu-ui.js') < at('fiiu-hubs.js'), 'dashboard.js runs first, then fiiu-ui.js, then fiiu-hubs.js');
  assert.match(dashboardJs(), /document\.addEventListener\('nodal:fiiu-festival'/);
  const sheet = css(), ledgerCss = sheet.slice(sheet.indexOf('/* ============================ recognition'), sheet.indexOf('/* ============================ self-assessment'));
  assert.doesNotMatch(ledgerCss, /inset \d+px 0 0/, 'state is carried by the check and the ink, not a left bar');
});

/* ---------------- self-assessment and the profile dialog, on the whole console ---------------- */

// i18n.js and the whole of dashboard.js with the self-assessment list and the profile dialog. The server keeps what PATCH /api/me sends and answers
// with its own copy of the member, as the API does.
function memberConsole(me) {
  const ids = Object.fromEntries(['assessTopics', 'userDialog', 'userForm', 'userBtn', 'ucName', 'ucCity', 'ucRole', 'ucTopics', 'ucError'].map((id) => [id, new El('div')]));
  ids.ucTopics.querySelectorAll = (selector) => descendants(ids.ucTopics).filter((n) => n.tagName === 'input' && (selector === 'input' || n.checked));
  ids.userDialog.showModal = () => { ids.userDialog.open = true; };
  const stored = JSON.parse(JSON.stringify(me)), patches = [];
  const location = new URL('https://nodal.test/dashboard.html'), history = { state: null, replaceState() {} };
  const document = { body: new El('body'), documentElement: {}, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, getElementById: (id) => ids[id] ?? null, createElement: (tag) => new El(tag) };
  const context = vm.createContext({ document, location, history, URL, URLSearchParams, console, setTimeout() {}, clearTimeout() {}, localStorage: { getItem: () => null, setItem() {} },
    fetch: async (url, options = {}) => {
      if (options.method === 'PATCH') { const { expectedCity, ...fields } = JSON.parse(options.body); patches.push(fields); Object.assign(stored, fields); }
      return { ok: true, status: 200, json: async () => ({ user: JSON.parse(JSON.stringify(stored)) }) };
    } });
  context.window = { location, history, addEventListener() {} };
  for (const name of ['i18n-dashboard', 'i18n', 'dashboard']) vm.runInContext(read('web', 'scripts', `${name}.js`), context);
  return { ids, stored, patches };
}
const ana = { id: 'ana-id', fullName: 'Ana Quispe', title: 'Planner', city: 'Lima', assessed: false, partC: {},
  topics: [{ name: 'Mobility', level: 1, validatedAt: 0, endorsedAt: 0 }, { name: 'Housing', level: 1, validatedAt: 0, endorsedAt: 0 }] };

test('every self-assessment level a member picks is saved and stays on screen, not only the first one', async () => {
  const c = memberConsole(ana);
  await flush();
  const levels = (topic) => c.ids.assessTopics.children[topic].children[1].children;
  const pick = async (topic, level) => { levels(topic)[level - 1].listeners.click(); await flush(); };
  const shown = (topic) => levels(topic).findIndex((button) => button['aria-pressed'] === 'true') + 1;
  const saved = () => c.stored.topics.map((x) => `${x.name}:${x.level}`);
  await pick(0, 3);
  assert.deepEqual(saved(), ['Mobility:3', 'Housing:1']);
  // That save gave the console the server's copy of the member; later picks change that copy, so they are sent too.
  await pick(0, 2);
  assert.deepEqual(saved(), ['Mobility:2', 'Housing:1']);
  assert.equal(shown(0), 2);
  await pick(1, 3);
  assert.deepEqual(saved(), ['Mobility:2', 'Housing:3']);
  assert.deepEqual([shown(0), shown(1)], [2, 3]);
  assert.equal(c.patches.length, 3);
});

test('the profile dialog refuses a one-letter name, as the server does, instead of breaking every later save', async () => {
  const c = memberConsole(ana);
  await flush();
  c.ids.userBtn.listeners.click();
  const submit = () => { let refused = false; c.ids.userForm.listeners.submit({ preventDefault() { refused = true; } }); return refused; };
  c.ids.ucName.value = ' A ';
  assert.equal(submit(), true, 'the dialog stays open');
  assert.equal(c.ids.ucError.hidden, false);
  assert.equal(c.ids.ucError.textContent, 'Add your name to save your profile.');
  await flush();
  assert.equal(c.patches.length, 0, 'nothing the server would refuse is sent');
  c.ids.ucName.value = 'Al';
  assert.equal(submit(), false);
  await flush();
  assert.deepEqual(c.patches.map((p) => p.fullName), ['Al']);
});
