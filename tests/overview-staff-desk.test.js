import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/* The publishing desk (admin.js) after the code overview of 16 Nov 2026: the fixes of its staff batch.
   The harness is the desk's (tests/node-requests-desk-ui.test.js desk()): admin.html's ids as fake elements, the real
   dictionaries, a stubbed fetch and confirm, and admin.js run as the page runs it, bootstrap included. Its document also
   tracks focus as Chromium does: a control that is disabled or taken off the page leaves focus on the body. */
const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const adminPage = () => read('web', 'pages', 'admin.html');

function dom() {
  let focused = null;
  const roots = new Set();
  class FakeNode {
    constructor(tag = '') {
      this.tagName = tag;
      this.hidden = false;
      this.off = false;
      this.textContent = '';
      this.value = '';
      this.checked = false;
      this.dataset = {};
      this.children = [];
      this.parent = null;
      this.listeners = new Map();
      this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
    }

    get disabled() { return this.off; }
    set disabled(value) { this.off = Boolean(value); if (value && focused === this) focused = null; }
    get attached() { let node = this; while (node.parent) node = node.parent; return roots.has(node); }
    append(...nodes) { for (const node of nodes) { if (node && typeof node === 'object') { node.parent?.children.splice(node.parent.children.indexOf(node), 1); node.parent = this; } this.children.push(node); } }
    appendChild(node) { this.append(node); return node; }
    replaceChildren(...nodes) { for (const child of this.children) if (child && typeof child === 'object') child.parent = null; this.children = []; this.append(...nodes); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this); this.parent = null; }
    contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; }
    getClientRects() { return this.attached && !this.hidden ? [{}] : []; }
    setAttribute(name, value) { this[name] = String(value); }
    getAttribute(name) { return this[name] ?? null; }
    removeAttribute(name) { delete this[name]; }
    addEventListener(name, handler) { this.listeners.set(name, handler); }
    querySelectorAll() { return []; }
    querySelector() { return null; }
    scrollIntoView() {}
    focus() { if (!this.disabled && this.attached) focused = this; }
    getBoundingClientRect() { return {}; }
  }
  const body = new FakeNode('body');
  roots.add(body);
  const root = (node) => { roots.add(node); return node; };
  const document = {
    body,
    get activeElement() { return focused && focused.attached && !focused.disabled ? focused : body; },
    createElement: (tag) => new FakeNode(tag),
  };
  return { FakeNode, document, root };
}

const flush = async () => { for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
// A 204 has no body, so its json() fails as a real Response's does.
const response = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { if (status === 204) throw new SyntaxError('Unexpected end of JSON input'); return payload; },
});

function deskI18n(lang) {
  const document = { body: { dataset: {} }, documentElement: { dataset: {} }, querySelectorAll: () => [] };
  const context = { URLSearchParams, document, console, localStorage: { getItem() { return null; }, setItem() {} }, location: { search: '' } };
  context.window = context;
  vm.runInNewContext(read('web', 'scripts', 'i18n-dashboard.js'), context, { filename: 'i18n-dashboard.js' });
  vm.runInNewContext(read('web', 'scripts', 'i18n.js'), context, { filename: 'i18n.js' });
  context.window.nodalI18n.apply(lang, { persist: false });
  return context.window.nodalI18n;
}

/* routes answers each band's calls ({url, method, body}); a band left out gets an empty list. */
function desk({ lang = 'en', routes = {}, confirm = () => true } = {}) {
  const { FakeNode, document, root } = dom();
  const ids = new Map([...adminPage().matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], root(Object.assign(new FakeNode(match[1]), { id: match[1] }))]));
  document.getElementById = (id) => ids.get(id) ?? null;
  const requests = [], confirms = [], windowListeners = {};
  const empty = {
    news: () => response({ items: [], nextCursor: null }),
    catalog: () => response({ items: [], nextCursor: null }),
    interests: () => response({ interests: [], nextCursor: null }),
    nodes: () => response({ requests: [], nextCursor: null }),
    founders: () => response({ founders: [] }),
  };
  const band = (url) => (url.startsWith('/api/admin/news') ? 'news' : url.startsWith('/api/admin/catalog') ? 'catalog' : url.startsWith('/api/admin/interests') ? 'interests'
    : url.startsWith('/api/admin/node-requests') ? 'nodes' : url.startsWith('/api/admin/membership/founders') ? 'founders' : '');
  const fetchImpl = async (url, options = {}) => {
    const call = { url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined };
    requests.push(call);
    const name = band(url);
    if (!name) return response({ error: 'not found' }, 404);
    return (routes[name] || empty[name])(call);
  };
  const i18n = deskI18n(lang);
  const context = {
    AbortController, Date, URL, URLSearchParams, Intl, clearTimeout, setTimeout, encodeURIComponent, console, crypto: globalThis.crypto,
    document,
    fetch: fetchImpl,
    location: { hash: '', assigned: '', assign(value) { this.assigned = value; } },
    matchMedia: () => ({ matches: true }),
    nodalI18n: i18n,
    confirm: (message) => { confirms.push(message); return confirm(message); },
    addEventListener: (type, handler) => { (windowListeners[type] ??= []).push(handler); },
  };
  context.window = context;
  vm.runInNewContext(read('web', 'scripts', 'admin.js'), context, { filename: 'admin.js' });
  const node = (id) => ids.get(id);
  // The beforeunload listeners, as the browser runs them: true when the page asks before it goes.
  const leaveAsks = () => {
    let asked = false;
    for (const listener of windowListeners.beforeunload || []) listener({ preventDefault() { asked = true; } });
    return asked;
  };
  return { ids, node, requests, confirms, i18n, context, document, windowListeners, leaveAsks, FakeNode, root };
}

const record = (id, title, overrides = {}) => ({
  id, version: 1, kind: 'resource', subtype: null, status: 'draft', visibility: 'public',
  translations: { en: { title, summary: 'Summary', body: 'Body', cta: 'Read' }, es: { title: `${title} ES`, summary: '', body: '', cta: '' }, pt: { title: '', summary: '', body: '', cta: '' } },
  organization: 'NODAL', location: 'Lima', topics: ['mobility'], startsAt: null, deadlineAt: '2026-12-01T17:00:00.000Z', endDate: null,
  sourceLabel: 'Official page', sourceUrl: 'https://source.example/item', sourceVerifiedAt: '2026-11-01', actionMode: 'none', actionUrl: '', featured: false, ...overrides,
});
const catalogRow = (d, id) => d.node('adminCatalogList').children.find((row) => row.dataset.id === id);

test('M60: opening another catalog record or a blank one asks before unsaved edits are dropped', async () => {
  let answer = false;
  const d = desk({ routes: { catalog: () => response({ items: [record('r1', 'First'), record('r2', 'Second')], nextCursor: null }) }, confirm: () => answer });
  await flush();
  catalogRow(d, 'r1').listeners.get('click')();
  assert.equal(d.node('adminCatalogId').value, 'r1');
  catalogRow(d, 'r2').listeners.get('click')();
  assert.equal(d.node('adminCatalogId').value, 'r2');
  assert.deepEqual(d.confirms, [], 'an untouched record is replaced without a question');

  d.node('adminSummaryPt').value = 'Resumo ainda não salvo';
  catalogRow(d, 'r1').listeners.get('click')();
  assert.deepEqual(d.confirms, [d.i18n.t('ops.catalog.discard')], 'its own question, not the news editor’s');
  assert.equal(d.node('adminCatalogId').value, 'r2', 'declining keeps the record open');
  assert.equal(d.node('adminSummaryPt').value, 'Resumo ainda não salvo', 'with every unsaved field');
  d.node('adminNewItem').listeners.get('click')();
  assert.equal(d.confirms.length, 2, 'New record asks too');
  assert.equal(d.node('adminCatalogId').value, 'r2');
  assert.equal(d.node('adminSummaryPt').value, 'Resumo ainda não salvo');

  answer = true;
  catalogRow(d, 'r1').listeners.get('click')();
  assert.equal(d.confirms.length, 3);
  assert.equal(d.node('adminCatalogId').value, 'r1');
  assert.equal(d.node('adminSummaryPt').value, '');
  // The record just opened is clean again; so is the blank one New record opens.
  d.node('adminNewItem').listeners.get('click')();
  assert.equal(d.node('adminCatalogId').value, '');
  d.node('adminKind').value = 'opportunity';
  d.node('adminKind').listeners.get('change')();
  d.node('adminKind').value = 'resource';
  d.node('adminKind').listeners.get('change')();
  catalogRow(d, 'r2').listeners.get('click')();
  assert.equal(d.confirms.length, 3, 'a kind changed and changed back is no edit');
  assert.equal(d.node('adminCatalogId').value, 'r2');
});

test('M60: a saved record is clean, a failed save stays unsaved, and reloading the server version after a conflict asks nothing', async () => {
  let patch = () => response({ error: 'unexpected' }, 500);
  const items = [record('r1', 'First'), record('r2', 'Second')];
  const d = desk({ routes: { catalog: (call) => (call.method === 'PATCH' ? patch(call) : response({ items, nextCursor: null })) }, confirm: () => false });
  await flush();
  catalogRow(d, 'r1').listeners.get('click')();
  d.node('adminTitleEs').value = 'Primero, corregido';
  patch = (call) => response({ item: { ...record('r1', 'First'), ...call.body, id: 'r1', version: 2 } });
  await d.node('adminSaveDraft').listeners.get('click')();
  assert.equal(d.node('adminCatalogVersion').textContent, '2');
  catalogRow(d, 'r2').listeners.get('click')();
  assert.deepEqual(d.confirms, [], 'the save’s answer is what the editor now holds');
  assert.equal(d.node('adminCatalogId').value, 'r2');

  d.node('adminTitleEs').value = 'Segundo, a medias';
  patch = () => response({ error: 'database unavailable' }, 503);
  await d.node('adminSaveDraft').listeners.get('click')();
  catalogRow(d, 'r1').listeners.get('click')();
  assert.equal(d.confirms.length, 1, 'a refused save leaves the edit unsaved');
  assert.equal(d.node('adminTitleEs').value, 'Segundo, a medias');

  const theirs = record('r2', 'Second', { version: 5, translations: { ...record('r2', 'Second').translations, es: { title: 'Su versión', summary: '', body: '', cta: '' } } });
  patch = () => response({ error: 'catalog item changed; reload before saving', current: theirs }, 409);
  await d.node('adminSaveDraft').listeners.get('click')();
  assert.equal(d.node('adminConflictPanel').hidden, false);
  d.node('adminConflictReload').listeners.get('click')();
  assert.equal(d.confirms.length, 1, 'Reload server version is the choice to drop the edit');
  assert.equal(d.node('adminTitleEs').value, 'Su versión');
  assert.equal(d.node('adminCatalogVersion').textContent, '5');
  catalogRow(d, 'r1').listeners.get('click')();
  assert.equal(d.confirms.length, 1, 'and leaves a clean editor');
});

// The staff bar, run in the desk's own window as the page runs it: admin-nav.js finds the bar by [data-staff-nav].
function staffBar(d, { logout = async () => ({ ok: true, status: 200 }) } = {}) {
  const signOut = Object.assign(new d.FakeNode('button'), { dataset: { staff: 'signOut' } });
  const line = Object.assign(new d.FakeNode('span'), { dataset: { staffStatus: '' } });
  const nav = d.root(new d.FakeNode('nav'));
  nav.append(signOut, line);
  nav.querySelectorAll = (selector) => (selector === '[data-staff]' ? [signOut] : []);
  nav.querySelector = (selector) => (selector === '[data-staff-status]' ? line : null);
  Object.assign(d.document, { documentElement: { lang: 'en' }, addEventListener() {}, querySelector: (selector) => (selector === '[data-staff-nav]' ? nav : null) });
  const page = d.context.fetch;
  const calls = [];
  d.context.fetch = (url, options) => {
    if (url !== '/api/auth/logout') return page(url, options);
    calls.push(url);
    return logout();
  };
  d.context.localStorage = { removeItem() {} };
  vm.runInNewContext(read('web', 'scripts', 'admin-nav.js'), d.context, { filename: 'admin-nav.js' });
  return { press: () => signOut.listeners.get('click')(), calls, line };
}

test('M61/M141: the desk tells the staff bar about an unsaved post or catalog record; its own leave prompt still covers news only', async () => {
  const d = desk({ routes: { catalog: () => response({ items: [record('r1', 'First')], nextCursor: null }) } });
  await flush();
  assert.equal(d.context.nodalUnsaved(), false, 'a desk just opened has nothing unsaved');
  d.node('adminNewsBody').value = 'Texto a medias';
  assert.equal(d.context.nodalUnsaved(), true);
  assert.equal(d.leaveAsks(), true);
  d.node('adminNewsBody').value = '';
  assert.equal(d.context.nodalUnsaved(), false);
  catalogRow(d, 'r1').listeners.get('click')();
  assert.equal(d.context.nodalUnsaved(), false, 'an opened record is no edit');
  d.node('adminLocation').value = 'Cusco';
  assert.equal(d.context.nodalUnsaved(), true, 'an edited record counts for the bar');
  assert.equal(d.leaveAsks(), false, 'M11: the leave prompt itself stays on the news editor');
});

test('M61/M141: Sign out with an unsaved post asks before the session closes, and the sign-in page then opens without a second question', async () => {
  let answer = false;
  const d = desk({ confirm: () => answer });
  await flush();
  const bar = staffBar(d);
  d.node('adminNewsTitle').value = 'Convocatoria abierta';
  await bar.press();
  assert.deepEqual(d.confirms, ['Sign out and discard your unsaved changes?']);
  assert.deepEqual(bar.calls, [], 'Cancel: the session stays open, so Publish still works');
  assert.equal(d.context.location.assigned, '');
  assert.equal(d.leaveAsks(), true, 'and the desk still guards the post');
  answer = true;
  await bar.press();
  assert.equal(d.confirms.length, 2);
  assert.deepEqual(bar.calls, ['/api/auth/logout']);
  assert.equal(d.context.location.assigned, '/login.html');
  assert.equal(d.leaveAsks(), false, 'the browser is not made to ask again once the session is gone');

  const clean = desk({ confirm: () => false });
  await flush();
  const quiet = staffBar(clean);
  await quiet.press();
  assert.deepEqual(clean.confirms, [], 'nothing unsaved: no question');
  assert.equal(clean.context.location.assigned, '/login.html');
});
