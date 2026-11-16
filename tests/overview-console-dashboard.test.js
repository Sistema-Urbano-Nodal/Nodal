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
   of the member, and refuses the whole patch with 409 location_conflict when the city it guards is no longer the stored one. */
function consoleFor(me, { lang = 'en' } = {}) {
  const doc = makeDocument(read('web', 'pages', 'dashboard.html'));
  const stored = me && JSON.parse(JSON.stringify({ ...DEFAULTS, ...me }));
  const requests = [], windowListeners = {}, located = [];
  const reply = (status, data) => ({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(data)) });
  const fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, method, body });
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
    setTimeout, clearTimeout,
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
