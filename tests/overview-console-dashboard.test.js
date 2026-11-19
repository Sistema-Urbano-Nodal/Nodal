import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/* The member console as dashboard.html ships it: the page's own markup, parsed into a small DOM, with
   i18n-dashboard.js, i18n.js and dashboard.js run on it in that order, against a server that keeps what
   PATCH /api/me sends and guards the city the way the API does (409 location_conflict). */
const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const flush = async () => { for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (match, name) => ENTITIES[name]);
const camel = (name) => name.replace(/-([a-z])/g, (match, c) => c.toUpperCase());
const all = (node) => node.children.flatMap((child) => [child, ...all(child)]);

class El {
  constructor(doc, tag) {
    Object.assign(this, {
      ownerDocument: doc, localName: tag, children: [], parentNode: null, attributes: new Map(), dataset: {}, listeners: {},
      style: { setProperty() {} }, hidden: false, disabled: false, checked: false, open: false, value: '', type: '', id: '',
      className: '', title: '', href: '', text: '',
    });
  }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this.text = String(value); for (const child of this.children) child.parentNode = null; this.children = []; }
  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean);
    const write = (list) => { this.className = [...new Set(list)].join(' '); };
    return {
      contains: (name) => names().includes(name),
      add: (...more) => write([...names(), ...more]),
      remove: (...less) => write(names().filter((name) => !less.includes(name))),
      toggle: (name, force) => {
        const on = force === undefined ? !names().includes(name) : Boolean(force);
        write(on ? [...names(), name] : names().filter((other) => other !== name));
        return on;
      },
    };
  }
  get parentElement() { return this.parentNode; }
  get nextElementSibling() { const list = this.parentNode?.children ?? []; return list.slice(list.indexOf(this) + 1).find((node) => node.localName !== '#text') ?? null; }
  get firstChild() { return this.children[0] ?? null; }
  get scrollHeight() { return 0; }
  get clientHeight() { return 0; }
  append(...nodes) { for (const node of nodes) this.appendChild(typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node); }
  appendChild(node) { node.remove(); node.parentNode = this; this.children.push(node); return node; }
  insertBefore(node, before) { node.remove(); node.parentNode = this; const at = this.children.indexOf(before); this.children.splice(at < 0 ? this.children.length : at, 0, node); return node; }
  before(...nodes) { for (const node of nodes) this.parentNode?.insertBefore(node, this); }
  after(...nodes) { const next = this.nextElementSibling; for (const node of nodes) { if (next) this.parentNode.insertBefore(node, next); else this.parentNode?.appendChild(node); } }
  replaceChildren(...nodes) { this.textContent = ''; this.append(...nodes); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); this.parentNode = null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  // Runs the listeners as the browser would for a click (or another event), and returns what they return.
  fire(type, extra = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
    return (this.listeners[type] ?? []).map((listener) => listener(event));
  }
  click() { return this.fire('click'); }
  focus(options) { this.ownerDocument.activeElement = this; this.focusOptions = options; }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
  scrollIntoView() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
  matches(selector) { return selector.split(',').some((alternative) => matchChain(this, alternative.trim().split(/\s+/))); }
  closest(selector) { for (let node = this; node && node.matches; node = node.parentNode) if (node.matches(selector)) return node; return null; }
  querySelectorAll(selector) { return all(this).filter((node) => node.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
// tag, #id, .class, [attr], [attr="v"], [attr^="v"] and :checked, joined by descendant spaces: what the console asks for.
function matchCompound(node, compound) {
  if (node.localName === '#text' || node.localName === '#document') return false;
  for (const [, tag, id, cls, attr, op, value, pseudo] of compound.matchAll(/^([a-z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:(\^?=)"([^"]*)")?\]|:(checked)/g)) {
    if (tag && node.localName !== tag) return false;
    if (id && node.id !== id) return false;
    if (cls && !node.classList.contains(cls)) return false;
    if (pseudo && !node.checked) return false;
    if (attr) {
      const actual = attr.startsWith('data-') ? node.dataset[camel(attr.slice(5))] : node.getAttribute(attr);
      if (actual === undefined || actual === null) return false;
      if (op === '=' && actual !== value) return false;
      if (op === '^=' && !actual.startsWith(value)) return false;
    }
  }
  return true;
}
function matchChain(node, chain) {
  if (!matchCompound(node, chain.at(-1))) return false;
  let ancestor = node.parentNode;
  for (let i = chain.length - 2; i >= 0; i -= 1) {
    while (ancestor && !matchCompound(ancestor, chain[i])) ancestor = ancestor.parentNode;
    if (!ancestor) return false;
    ancestor = ancestor.parentNode;
  }
  return true;
}
function setParsedAttribute(node, name, value) {
  node.setAttribute(name, value);
  if (name === 'id') node.id = value;
  else if (name === 'class') node.className = value;
  else if (['hidden', 'disabled', 'checked', 'open'].includes(name)) node[name] = true;
  else if (['type', 'value', 'href', 'title'].includes(name)) node[name] = value;
  else if (name.startsWith('data-')) node.dataset[camel(name.slice(5))] = value;
}
function makeDocument(html) {
  const doc = { activeElement: null, readyState: 'loading', listeners: {} };
  doc.createElement = (tag) => new El(doc, tag.toLowerCase());
  doc.createElementNS = (ns, tag) => Object.assign(new El(doc, tag), { namespaceURI: ns });
  doc.createTextNode = (value) => Object.assign(new El(doc, '#text'), { text: String(value) });
  const root = new El(doc, '#document');
  const stack = [root];
  const tokens = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  for (const [, close, open, attributes, selfClosing, text] of html.matchAll(tokens)) {
    if (text !== undefined) { stack.at(-1).append(decode(text)); continue; }
    if (close) { const at = stack.findLastIndex((node) => node.localName === close.toLowerCase()); if (at > 0) stack.length = at; continue; }
    if (!open) continue;
    const node = doc.createElement(open);
    for (const [, name, double, single, bare] of attributes.matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      setParsedAttribute(node, name, decode(double ?? single ?? bare ?? ''));
    }
    stack.at(-1).appendChild(node);
    if (!selfClosing && !VOID.has(node.localName)) stack.push(node);
  }
  doc.documentElement = root.querySelector('html');
  doc.head = root.querySelector('head');
  doc.body = root.querySelector('body');
  doc.getElementById = (id) => all(root).find((node) => node.id === id) ?? null;
  doc.querySelectorAll = (selector) => root.querySelectorAll(selector);
  doc.querySelector = (selector) => root.querySelector(selector);
  doc.addEventListener = (type, listener) => { (doc.listeners[type] ??= []).push(listener); };
  doc.dispatchEvent = (event) => { (doc.listeners[event.type] ?? []).forEach((listener) => listener(event)); return true; };
  return doc;
}

const DEFAULTS = { assessed: false, topics: [], skills: [], partC: {}, indicators: { leadership: 'No', transmission: 'No' }, requests: {}, mentorApplied: false, notifRead: false };
/* me: the member the server holds. me: null makes /api/auth/me fail (503). The server answers PATCH /api/me with its copy
   of the member, and refuses the whole patch with 409 location_conflict when the city it guards is no longer the stored one.
   respond(request, reply) answers any other request first (return nothing to leave it to the server above). Timers fire
   at once, so the search's debounce needs no waiting out. */
function consoleFor(me, { lang = 'en', respond = () => undefined } = {}) {
  const doc = makeDocument(read('web', 'pages', 'dashboard.html'));
  const stored = me && JSON.parse(JSON.stringify({ ...DEFAULTS, ...me }));
  const requests = [], windowListeners = {}, located = [];
  const reply = (status, data) => ({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(data)) });
  const fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, method, body });
    const answer = respond({ url, method, body }, reply);
    if (answer) return answer;
    if (url === '/api/auth/me') return stored ? reply(200, { user: stored }) : reply(503, { error: 'unavailable' });
    if (url === '/api/me' && method === 'PATCH') {
      const { expectedCity, ...fields } = body;
      if ('city' in fields && expectedCity !== undefined && stored.city !== expectedCity) return reply(409, { error: 'location_conflict' });
      Object.assign(stored, fields);
      return reply(200, { user: stored });
    }
    return reply(404, { error: 'not found' });
  };
  const storage = new Map([['nodal.lang', lang]]);
  const location = { pathname: '/dashboard.html', search: '', hash: '', assign(url) { this.assigned = url; } };
  class Observer { observe() {} disconnect() {} }
  const window = {
    location, history: { state: null, replaceState() {} },
    addEventListener: (type, listener) => { (windowListeners[type] ??= []).push(listener); },
    removeEventListener() {},
    dispatchEvent: (event) => { (windowListeners[event.type] ?? []).forEach((listener) => listener(event)); return true; },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    IntersectionObserver: Observer,
    nodalLocationCheck: { setUser: (user) => located.push(user), setSaving() {} },
  };
  const context = vm.createContext({
    window, document: doc, location, fetch, console, URL, URLSearchParams, Intl, Date, JSON, Promise, Error, Map, Set,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    IntersectionObserver: Observer, MutationObserver: Observer,
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    setTimeout: (fn, ms, ...args) => setImmediate(fn, ...args), clearTimeout: (handle) => handle && clearImmediate(handle), AbortController,
  });
  for (const name of ['i18n-dashboard', 'i18n', 'dashboard']) vm.runInContext(read('web', 'scripts', `${name}.js`), context, { filename: `${name}.js` });
  const byId = (id) => doc.getElementById(id);
  return {
    doc, byId, stored, requests, located, window, i18n: window.nodalI18n,
    patches: () => requests.filter((r) => r.method === 'PATCH').map((r) => r.body),
    text: (id) => byId(id).textContent.replace(/\s+/g, ' ').trim(),
  };
}
const ana = { id: 'ana-id', fullName: 'Ana Quispe', title: 'Planner', city: 'Lima',
  topics: [{ name: 'Mobility', level: 1, validatedAt: 0, endorsedAt: 0 }, { name: 'Housing', level: 1, validatedAt: 0, endorsedAt: 0 }] };
// A FIIU registration brings a name and an account, but no NODAL topics (and often no city).
const registrant = { id: 'rosa-id', fullName: 'Rosa Huamán', title: 'Member', city: '', topics: [] };

/* ---------------- I2: export and deletion for every loaded account ---------------- */

test('a profile with no topics, a festival registrant’s, offers Export my data and Delete account in the profile dialog', async () => {
  for (const me of [registrant, { ...registrant, city: 'Lima' }]) {
    const c = consoleFor(me);
    await flush();
    const dialog = c.byId('userDialog');
    assert.equal(dialog.open, true, 'the prompt opens by itself for an incomplete profile');
    assert.equal(c.text('ucTitle'), 'Complete your profile', 'the dialog still asks to complete the profile');
    assert.equal(c.text('ucSubmit'), 'Create profile');
    assert.equal(c.byId('ucDataControls').hidden, false, `${me.city || 'no city'}: Export and Delete are there before any topic is picked`);
    assert.equal(c.text('ucExport'), 'Export my data');
    assert.equal(c.text('ucDelete'), 'Delete account');
  }
});

test('a complete profile edits in place and keeps Export my data and Delete account, in every language', async () => {
  const c = consoleFor(ana, { lang: 'es' });
  await flush();
  assert.equal(c.byId('userDialog').open, false, 'a complete profile is not prompted');
  c.byId('userBtn').click();
  assert.equal(c.byId('userDialog').open, true);
  assert.equal(c.text('ucTitle'), 'Edita tu perfil');
  assert.equal(c.byId('ucDataControls').hidden, false);
  assert.equal(c.text('ucDelete'), 'Eliminar cuenta');
});

test('before a member is loaded there is no dialog to open, so the account tools stay hidden', async () => {
  const c = consoleFor(null);
  await flush();
  c.byId('userBtn').click();
  assert.equal(c.byId('userDialog').open, false);
  assert.equal(c.byId('ucDataControls').hidden, true, 'the markup ships them hidden');
});

/* ---------------- M50: Part A is the profile the prompt asks for ---------------- */

const stop = (c, i) => { const button = c.byId('spineStops').children[i].querySelector('button'); return { button, label: button.querySelector('b').textContent, meta: button.querySelector('em').textContent }; };
const timelineFirst = (c) => c.byId('tline').children[0].children.map((node) => node.textContent);

test('a profile without topics is not shown as Part A done or 30% complete, and completing it in the dialog ticks Part A', async () => {
  const c = consoleFor(registrant);
  await flush();
  let first = stop(c, 0);
  assert.equal(first.button.classList.contains('is-done'), false, 'the first stop of the route is not ticked');
  assert.equal(first.button.classList.contains('is-now'), true, 'it is where the member is');
  assert.deepEqual([first.label, first.meta], ['Complete your profile', 'Part A · city and topics']);
  assert.equal(c.text('ringText'), '0%');
  assert.equal(c.byId('partAStatus').classList.contains('done'), false, 'Part A · Core is not ticked');
  assert.deepEqual(timelineFirst(c), ['Today', 'Complete your profile', 'Part A · city and topics']);

  c.byId('ucCity').value = 'Lima';
  c.byId('ucRole').value = 'Urbanista';
  c.byId('ucTopics').querySelectorAll('input')[0].checked = true;
  c.byId('userForm').fire('submit');
  await flush();
  first = stop(c, 0);
  assert.equal(first.button.classList.contains('is-done'), true);
  assert.deepEqual([first.label, first.meta], ['Profile created', 'Part A · done']);
  assert.equal(c.text('ringText'), '30%');
  assert.equal(c.byId('partAStatus').classList.contains('done'), true);
  assert.deepEqual(timelineFirst(c), ['Today', 'Profile created · Part A complete', 'Counts toward Profile Pioneer']);
  assert.deepEqual(c.patches().map((p) => [p.city, p.interests]), [['Lima', ['mobility']]]);
});

test('a city alone is not Part A either, and the route reads in Spanish and Portuguese', async () => {
  const c = consoleFor({ ...registrant, city: 'Cusco' }, { lang: 'es' });
  await flush();
  assert.deepEqual([stop(c, 0).label, stop(c, 0).meta], ['Completa tu perfil', 'Parte A · ciudad y temas']);
  assert.equal(c.text('ringText'), '0%');
  c.i18n.apply('pt', { persist: false });
  assert.deepEqual([stop(c, 0).label, stop(c, 0).meta], ['Complete seu perfil', 'Parte A · cidade e temas']);
  // The markup ships Part A unticked: until the member is loaded nothing says it is done.
  assert.doesNotMatch(read('web', 'pages', 'dashboard.html'), /<li class="done" data-i18n="d\.ctx\.partA"/);
});

test('a complete profile keeps Part A done and its 30%', async () => {
  const c = consoleFor(ana);
  await flush();
  assert.equal(stop(c, 0).button.classList.contains('is-done'), true);
  assert.equal(stop(c, 1).button.classList.contains('is-now'), true, 'the self-assessment is next');
  assert.equal(c.text('ringText'), '30%');
  assert.equal(c.byId('partAStatus').classList.contains('done'), true);
});

/* ---------------- M40: a city changed in another tab or on another device ---------------- */

// The member edits their city in the profile dialog of a console that read Lima, after another tab or device stored Cusco.
async function editCityAfterAMoveElsewhere(c) {
  await flush();
  c.stored.city = 'Cusco';
  c.byId('userBtn').click();
  c.byId('ucCity').value = 'Arequipa';
  c.byId('ucRole').value = 'Urban planner';
  c.byId('userForm').fire('submit');
  await flush();
}

test('a city refused because it changed elsewhere gives way to the stored one, the other changes are saved, and later saves go through', async () => {
  const c = consoleFor(ana);
  await editCityAfterAMoveElsewhere(c);
  const [refused, resent] = c.patches();
  assert.deepEqual([refused.city, refused.expectedCity, refused.title], ['Arequipa', 'Lima', 'Urban planner']);
  assert.equal('city' in resent, false, 'the other changes go once more, without a city');
  assert.equal(resent.title, 'Urban planner');
  assert.deepEqual(c.requests.filter(r => r.url !== '/api/workspace').map((r) => `${r.method} ${r.url}`), ['GET /api/auth/me', 'PATCH /api/me', 'GET /api/auth/me', 'PATCH /api/me'],
    'the stored city is read again once, after the refusal');
  assert.deepEqual([c.stored.city, c.stored.title], ['Cusco', 'Urban planner']);
  assert.equal(c.text('sheetCity'), 'Cusco');
  assert.equal(c.byId('ucCity').value, 'Cusco', 'the profile editor no longer holds the refused city');
  assert.equal(c.located.at(-1).city, 'Cusco', 'the location check is told the stored city');
  assert.equal(c.byId('saveAlert').hidden, false);
  assert.equal(c.text('saveAlertText'), 'Your city is now Cusco: it was changed in another tab or on another device. Your other changes are saved.');
  assert.equal(c.byId('saveRetry').hidden, true, 'nothing is left to try again');
  assert.equal(c.byId('saveClose').hidden, false);
  assert.equal(c.text('saveClose'), 'Close');

  // Every later save used to carry the same stale guard and be refused; now a level reaches the server.
  c.byId('assessTopics').querySelectorAll('.seg')[0].querySelectorAll('button')[2].click();
  await flush();
  assert.equal(c.patches().length, 3);
  assert.equal('city' in c.patches()[2], false);
  assert.equal(c.stored.topics[0].level, 3, 'Mobility is Proficient on the server');
  assert.equal(c.byId('saveAlert').hidden, false, 'a later save leaves the notice up');
  c.byId('saveClose').click();
  assert.equal(c.byId('saveAlert').hidden, true);
  c.byId('assessTopics').querySelectorAll('.seg')[1].querySelectorAll('button')[1].click();
  await flush();
  assert.equal(c.stored.topics[1].level, 2);
  assert.equal(c.byId('saveAlert').hidden, true, 'once closed, the notice does not come back');
});

test('when the session now belongs to another account, nothing of it is taken and the refused save fails as before', async () => {
  let reads = 0;
  const c = consoleFor(ana, { respond: ({ url }, reply) => {
    if (url === '/api/auth/me' && (reads += 1) > 1) return reply(200, { user: { ...ana, id: 'other-id', city: 'Quito' } });
    return undefined;
  } });
  await editCityAfterAMoveElsewhere(c);
  assert.equal(c.patches().length, 1, 'nothing is sent again');
  assert.equal(c.text('sheetCity'), 'Arequipa', 'the other account’s city is not taken');
  assert.equal(c.located.some((user) => user.id === 'other-id'), false);
  assert.equal(c.text('saveAlertText'), 'Your last change did not reach the server. It is still only on this screen.');
  assert.deepEqual([c.byId('saveRetry').hidden, c.byId('saveClose').hidden], [false, true]);
});

// The member saves another city from the profile dialog while the notice is still up.
async function saveCityAgain(c, city) {
  c.byId('userBtn').click();
  c.byId('ucCity').value = city;
  c.byId('userForm').fire('submit');
  await flush();
}

test('the city notice goes once a later save stores another city, and stays while the stored city is still the one it names', async () => {
  const c = consoleFor(ana);
  await editCityAfterAMoveElsewhere(c);
  assert.equal(c.byId('saveAlert').hidden, false);
  await saveCityAgain(c, 'Cusco');
  assert.equal(c.byId('saveAlert').hidden, false, 'saving the city it names leaves the notice true, so it stays');
  await saveCityAgain(c, 'Trujillo');
  assert.deepEqual([c.patches().at(-1).city, c.patches().at(-1).expectedCity], ['Trujillo', 'Cusco']);
  assert.equal(c.stored.city, 'Trujillo');
  assert.equal(c.byId('saveAlert').hidden, true, 'the box no longer says the city is Cusco');
  c.byId('assessTopics').querySelectorAll('.seg')[0].querySelectorAll('button')[2].click();
  await flush();
  assert.equal(c.byId('saveAlert').hidden, true, 'and it does not come back with the next save');
});

test('a newer city typed while the refused one is read again is the one saved, and no notice names the city it replaced', async () => {
  let reads = 0;
  const c = consoleFor(ana, { respond: ({ url }) => {
    // The member saves Trujillo from the dialog while the console reads the stored city again after the refusal.
    if (url === '/api/auth/me' && (reads += 1) === 2) {
      c.byId('ucCity').value = 'Trujillo';
      c.byId('userForm').fire('submit');
    }
    return undefined;
  } });
  await editCityAfterAMoveElsewhere(c);
  await flush();
  const [refused, resent] = c.patches();
  assert.equal(refused.city, 'Arequipa');
  assert.deepEqual([resent.city, resent.expectedCity], ['Trujillo', 'Cusco'], 'the newer city goes out, guarded by the stored one');
  assert.equal(c.stored.city, 'Trujillo');
  assert.equal(c.text('sheetCity'), 'Trujillo');
  assert.equal(c.byId('saveAlert').hidden, true, 'nothing says the city is now Cusco');
});

test('the location check storing another city takes the city notice down, but leaves a failed save on screen', async () => {
  const c = consoleFor(ana);
  await editCityAfterAMoveElsewhere(c);
  // What location-check.js does once the server has stored the city it found.
  const locate = (console, city) => {
    console.stored.city = city;
    console.window.dispatchEvent({ type: 'nodal:location-updated', detail: { userId: 'ana-id', city } });
  };
  const located = (city) => locate(c, city);
  located('Cusco');
  assert.equal(c.byId('saveAlert').hidden, false, 'the stored city is still the one the notice names');
  located('Puno');
  assert.equal(c.byId('saveAlert').hidden, true);
  c.byId('assessTopics').querySelectorAll('.seg')[0].querySelectorAll('button')[2].click();
  await flush();
  assert.equal(c.byId('saveAlert').hidden, true, 'the next save does not bring the Cusco notice back');

  // A failed save is not the notice: a city stored by the location check does not hide it.
  const failing = consoleFor(ana, { respond: ({ url, method }, reply) => {
    if (url === '/api/me' && method === 'PATCH' && failing.patches().length === 3) return reply(503, { error: 'unavailable' });
    return undefined;
  } });
  await editCityAfterAMoveElsewhere(failing);
  failing.byId('assessTopics').querySelectorAll('.seg')[0].querySelectorAll('button')[2].click();
  await flush();
  assert.equal(failing.text('saveAlertText'), 'Your last change did not reach the server. It is still only on this screen.');
  locate(failing, 'Puno');
  assert.equal(failing.byId('saveAlert').hidden, false, 'the failure stays, with Try again');
  assert.equal(failing.byId('saveRetry').hidden, false);
  failing.byId('saveRetry').click();
  await flush();
  assert.equal(failing.byId('saveAlert').hidden, true, 'once the retry goes through, no Cusco notice comes back');
});

test('the city notice and its Close read in Spanish and Portuguese', async () => {
  const c = consoleFor(ana, { lang: 'es' });
  await editCityAfterAMoveElsewhere(c);
  assert.equal(c.text('saveAlertText'), 'Tu ciudad ahora es Cusco: se cambió en otra pestaña o en otro dispositivo. Tus otros cambios se guardaron.');
  assert.equal(c.text('saveClose'), 'Cerrar');
  c.i18n.apply('pt', { persist: false });
  assert.equal(c.text('saveClose'), 'Fechar');
  assert.equal(c.i18n.t('d.save.cityKept', { city: 'Cusco' }), 'Sua cidade agora é Cusco: ela foi alterada em outra aba ou em outro dispositivo. Suas outras alterações foram salvas.');
});

/* ---------------- M43: a People search that fails is not "No matches" ---------------- */

const searchFor = async (c, text) => { c.byId('searchInput').value = text; c.byId('searchInput').fire('input'); await flush(); };
const scopeChip = (c, scope) => c.byId('searchChips').querySelector(`[data-scope="${scope}"]`);
const lookAgain = async (c) => { scopeChip(c, 'Projects').click(); await flush(); scopeChip(c, 'People').click(); await flush(); };
const directorySearches = (c) => c.requests.filter((r) => r.url === '/api/users/search').length;

test('a People search that fails says the directory cannot be searched, and the next look asks again', async () => {
  let directory = 'down';
  const c = consoleFor(ana, { respond: ({ url }, reply) => {
    if (url === '/api/users/search') return directory === 'down' ? reply(503, { error: 'unavailable' }) : reply(200, { users: [] });
    if (url.startsWith('/api/catalog')) return reply(200, { items: [] });
    return undefined;
  } });
  await flush();
  await searchFor(c, 'Rosa');
  assert.equal(c.text('searchPop'), 'The member directory cannot be searched right now. Try again.');
  await lookAgain(c);
  assert.equal(directorySearches(c), 2, 'the failure was not kept as the answer for “Rosa”');
  assert.equal(c.text('searchPop'), 'The member directory cannot be searched right now. Try again.');
  directory = 'up';
  await lookAgain(c);
  assert.equal(directorySearches(c), 3);
  assert.match(c.text('searchPop'), /^No matches for “Rosa” in People\./, 'a real empty answer still reads No matches');
  await lookAgain(c);
  assert.equal(directorySearches(c), 3, 'and is kept for the same words');
});

test('the directory’s 40-a-minute limit and a dropped connection read the same; static hosting (404, 405) still reads No matches', async () => {
  for (const [answer, expected] of [
    [(reply) => reply(429, { error: 'too many searches' }), /^The member directory cannot be searched right now\. Try again\.$/],
    [() => Promise.reject(new TypeError('Failed to fetch')), /^The member directory cannot be searched right now\. Try again\.$/],
    [(reply) => reply(404, { error: 'not found' }), /^No matches for “Rosa” in People\./],
    [(reply) => reply(405, {}), /^No matches for “Rosa” in People\./],
  ]) {
    const c = consoleFor(ana, { respond: ({ url }, reply) => (url === '/api/users/search' ? answer(reply) : undefined) });
    await flush();
    await searchFor(c, 'Rosa');
    assert.match(c.text('searchPop'), expected, String(answer));
  }
});

test('the directory failure line reads in Spanish and Portuguese', async () => {
  const c = consoleFor(ana, { lang: 'es', respond: ({ url }, reply) => (url === '/api/users/search' ? reply(503, {}) : undefined) });
  await flush();
  await searchFor(c, 'Rosa');
  assert.equal(c.text('searchPop'), 'No se puede buscar en el directorio de miembros ahora. Inténtalo de nuevo.');
  c.i18n.apply('pt', { persist: false });
  assert.equal(c.i18n.t('d.search.directoryUnavailable'), 'Não é possível buscar no diretório de membros agora. Tente novamente.');
});

/* ---------------- M44: the server's 'Member' placeholder in People results ---------------- */

test('People results translate the server’s Member placeholder, in the language on screen when they are shown', async () => {
  const users = [
    { id: 'u1', name: 'Rosa Huamán', role: 'Member', city: 'Lima' },
    { id: 'u2', name: 'Luis Rojas', role: 'Arquitecto', city: '' },
    { id: 'u3', name: 'Ana Quispe', role: 'Member', city: '' },
  ];
  const c = consoleFor(ana, { lang: 'es', respond: ({ url }, reply) => {
    if (url === '/api/users/search') return reply(200, { users });
    if (url.startsWith('/api/catalog')) return reply(200, { items: [] });
    return undefined;
  } });
  await flush();
  const shown = () => c.byId('searchPop').querySelectorAll('.search-hit').map((hit) => [hit.querySelector('strong').textContent, hit.querySelector('span').textContent]);
  await searchFor(c, 'lima');
  assert.deepEqual(shown(), [['Rosa Huamán', 'Miembro de la comunidad · Lima'], ['Luis Rojas', 'Arquitecto'], ['Ana Quispe', 'Miembro de la comunidad']]);
  c.i18n.apply('pt', { persist: false });
  await lookAgain(c);
  assert.equal(directorySearches(c), 1, 'the answer is kept');
  assert.deepEqual(shown()[0], ['Rosa Huamán', 'Membro da comunidade · Lima'], 'and drawn in the new language');
});

/* ---------------- M47: one topic is singular ---------------- */

test('the self-assessment’s eyebrow counts one topic in the singular, in every language', async () => {
  const one = { ...ana, topics: [ana.topics[0]] };
  for (const [lang, single, plural] of [['en', 'Self-assessment · 1 topic', 'Self-assessment · 2 topics'], ['es', 'Autoevaluación · 1 tema', 'Autoevaluación · 2 temas'], ['pt', 'Autoavaliação · 1 tema', 'Autoavaliação · 2 temas']]) {
    const c = consoleFor(one, { lang });
    await flush();
    assert.equal(c.text('assessEyebrow'), single, lang);
    const two = consoleFor(ana, { lang });
    await flush();
    assert.equal(two.text('assessEyebrow'), plural, lang);
  }
});

/* ---------------- M48: the catalog's empty line around a scope's name ---------------- */

test('an empty catalog search reads correctly in Spanish and Portuguese, whatever the scope’s gender and number', async () => {
  const c = consoleFor(ana, { lang: 'es', respond: ({ url }, reply) => (url.startsWith('/api/catalog') ? reply(200, { items: [] }) : undefined) });
  await flush();
  const expected = {
    es: { Projects: 'Proyectos', Knowledge: 'Conocimiento', Opportunities: 'Oportunidades' },
    pt: { Projects: 'Projetos', Knowledge: 'Conhecimento', Opportunities: 'Oportunidades' },
  };
  for (const lang of ['es', 'pt']) {
    c.i18n.apply(lang, { persist: false });
    for (const [scope, label] of Object.entries(expected[lang])) {
      scopeChip(c, scope).click();
      await searchFor(c, 'beca');
      assert.equal(c.text('searchPop'), lang === 'es'
        ? `Sin resultados publicados para “beca” en ${label}.`
        : `Nenhum resultado publicado para “beca” em ${label}.`, `${lang} ${scope}`);
    }
  }
});

/* ---------------- M49: skills are words, not topics ---------------- */

test('skills are listed as they were written, with no level, dots or stage, and nothing reads undefined', async () => {
  const c = consoleFor({ ...ana, skills: ['GIS', 'Survey design'] });
  await flush();
  const rows = c.byId('trustList').children;
  assert.deepEqual(rows.map((row) => [row.className, row.querySelector('.t-name')?.textContent ?? row.textContent]), [
    ['t-group', 'Topics · what'], ['', 'Mobility'], ['', 'Housing'], ['t-group', 'Skills · how'], ['', 'GIS'], ['', 'Survey design'],
  ]);
  for (const row of rows.slice(4)) assert.equal(row.querySelector('.t-dots') ?? row.querySelector('.t-level'), null, row.textContent);
  assert.doesNotMatch(c.text('trustList'), /undefined/);
  assert.equal(c.byId('trustList').querySelectorAll('.t-dots').length, 2, 'the two topics keep their level dots');
  const none = consoleFor(ana);
  await flush();
  assert.doesNotMatch(none.text('trustList'), /Skills/, 'no skills, no group');
});

/* ---------------- M51: a console that failed to load ---------------- */

test('when the console could not load, the path rows, the path button, the indicator answers and Mark all as read do nothing', async () => {
  const c = consoleFor(null);
  await flush();
  assert.equal(c.text('greetSub'), 'We could not load your console. Check your connection and try again.');
  const rows = c.byId('pathList').querySelectorAll('.path-row');
  const answers = c.doc.querySelectorAll('.seg[data-ind] button');
  const pressed = () => answers.map((button) => [button.className, button.getAttribute('aria-pressed')]);
  const before = { rows: rows.map((row) => row.className), answers: pressed() };
  for (const control of [rows[1], c.byId('pdCta'), answers[1], c.byId('notifClear')]) {
    assert.doesNotThrow(() => control.click(), control.id || control.className);
  }
  await flush();
  assert.deepEqual(rows.map((row) => row.className), before.rows, 'no path is shown as picked');
  assert.deepEqual(pressed(), before.answers, 'no answer is shown as given');
  assert.deepEqual(c.patches(), [], 'and nothing is sent');
});

/* ---------------- M52: focus stays on the level just picked ---------------- */

test('picking a self-assessment level keeps the keyboard on that level of that topic, drawn again, without scrolling', async () => {
  const c = consoleFor(ana);
  await flush();
  const levels = (i) => c.byId('assessTopics').querySelectorAll('.seg')[i].querySelectorAll('button');
  const picked = levels(1)[2];                       // Housing → Proficient
  picked.focus();
  picked.click();
  const focused = c.doc.activeElement;
  assert.notEqual(focused, picked, 'the rows were drawn again');
  assert.equal(focused, levels(1)[2], 'focus is on the new Proficient button of Housing');
  assert.equal(focused.getAttribute('aria-pressed'), 'true');
  assert.equal(focused.focusOptions?.preventScroll, true, 'the page does not jump');
  assert.deepEqual([focused.dataset.topic, focused.dataset.level], ['Housing', '3']);
});

/* ---------------- M53/M155: the picked scope and the picked path, said to assistive technology ---------------- */

test('the search scope chips and the path rows say which one is picked with aria-pressed, from the markup on', async () => {
  const c = consoleFor(ana);
  const chips = c.byId('searchChips').querySelectorAll('.chip');
  const rows = c.byId('pathList').querySelectorAll('.path-row');
  const pressed = (list) => list.map((node) => node.getAttribute('aria-pressed'));
  // before any script has run on them: the page's own markup
  assert.deepEqual(pressed(chips), ['true', 'false', 'false', 'false'], 'People is the scope the page opens on');
  assert.deepEqual(pressed(rows), ['true', 'false', 'false', 'false'], 'Knowledge is the path the panel opens on');
  await flush();
  scopeChip(c, 'Opportunities').click();
  assert.deepEqual(pressed(chips), ['false', 'false', 'false', 'true']);
  assert.deepEqual(chips.map((chip) => chip.classList.contains('is-on')), [false, false, false, true]);
  rows[2].click();
  assert.deepEqual(pressed(rows), ['false', 'false', 'true', 'false']);
  assert.deepEqual(rows.map((row) => row.classList.contains('is-on')), [false, false, true, false]);
});
