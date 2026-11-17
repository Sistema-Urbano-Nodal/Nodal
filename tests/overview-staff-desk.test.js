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

const descendants = (node) => (node?.children || []).flatMap((child) => (child && typeof child === 'object' ? [child, ...descendants(child)] : []));
const flush = async () => { for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
// A 204 has no body, so its json() fails as a real Response's does.
const response = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() { if (status === 204) throw new SyntaxError('Unexpected end of JSON input'); return payload; },
});

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

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

const interest = (id, overrides = {}) => ({
  id, version: 1, status: 'new', message: 'Hola', member: { name: 'Ana', email: 'ana@example.test' },
  item: { itemId: 'r1', title: 'Fondo para calles', kind: 'opportunity', organization: 'NODAL' }, ...overrides,
});
const nodeView = (id, overrides = {}) => ({
  id, kind: 'node', name: 'Ana Quispe', organization: `Colectivo ${id}`, email: 'ana@example.test', phone: null, community: null, memberships: null,
  message: 'Queremos activar un nodo.', language: 'es', status: 'new', emailStatus: 'sent',
  createdAt: '2026-11-03T04:30:00.000Z', updatedAt: '2026-11-03T04:30:00.000Z', version: 1, ...overrides,
});

test('M66: a Load more that fails is reported on its band and settles, never left as an unhandled rejection', async () => {
  const d = desk({ routes: {
    interests: (call) => (call.url.includes('cursor=') ? Promise.reject(new TypeError('Failed to fetch')) : response({ interests: [interest('i1')], nextCursor: 'later-interests' })),
    nodes: (call) => (call.url.includes('cursor=') ? response({ error: 'cursor expired' }, 400) : response({ requests: [nodeView('n1')], nextCursor: 'later-requests' })),
  } });
  await flush();
  await assert.doesNotReject(d.node('adminInterestMore').listeners.get('click')());
  assert.equal(d.node('adminInterestStatus').textContent, 'Member interests are unavailable.');
  assert.equal(d.node('adminInterestList').children.length, 1, 'the page already loaded stays');
  await assert.doesNotReject(d.node('adminNodeMore').listeners.get('click')());
  assert.equal(d.node('adminNodeStatus').textContent, 'cursor expired', 'a refusal in the server’s words');
  assert.equal(d.node('adminNodeList').children.length, 1);
});

test('M144: a new record whose save got no answer reloads the catalog list before Publish comes back; refusals and edits do not', async () => {
  let stored = [];
  let post = () => response({ error: 'unexpected' }, 500);
  let patch = () => response({ error: 'unexpected' }, 500);
  const d = desk({ routes: { catalog: (call) => (call.method === 'POST' ? post(call) : call.method === 'PATCH' ? patch(call) : response({ items: stored, nextCursor: null })) } });
  await flush();
  const reads = () => d.requests.filter((r) => r.url.startsWith('/api/admin/catalog?')).length;
  const first = reads();
  d.node('adminTitleEn').value = 'Open call for street labs';
  // The server stores the record, but its answer never arrives.
  let publishBack;
  post = (call) => {
    stored = [{ ...record('landed', 'Open call for street labs'), ...call.body, id: 'landed' }];
    publishBack = d.node('adminPublish').disabled;
    return Promise.reject(new TypeError('Failed to fetch'));
  };
  const loaded = d.node('adminCatalogListStatus');
  const pending = d.node('adminPublish').listeners.get('click')();
  await pending;
  assert.equal(publishBack, true, 'Publish is off while the save runs');
  assert.equal(reads(), first + 1, 'the list is read again');
  assert.ok(catalogRow(d, 'landed'), 'the copy that landed is on the list');
  assert.equal(loaded.textContent, '1 record loaded.');
  assert.equal(d.node('adminEditorStatus').textContent, 'The record could not be saved.');
  assert.equal(d.node('adminPublish').disabled, false);
  assert.equal(d.node('adminTitleEn').value, 'Open call for street labs', 'the editor keeps the text');

  // A refusal stored nothing: no reload.
  post = () => response({ error: 'organization is required to publish', field: 'organization' }, 400);
  await d.node('adminPublish').listeners.get('click')();
  assert.equal(reads(), first + 1);
  assert.equal(d.node('adminEditorStatus').textContent, 'organization is required to publish');
  // An edit whose answer is lost is caught by its version on the next save: no reload either.
  catalogRow(d, 'landed').listeners.get('click')();
  patch = () => Promise.reject(new TypeError('Failed to fetch'));
  await d.node('adminSaveDraft').listeners.get('click')();
  assert.equal(reads(), first + 1);
  assert.equal(d.requests.filter((r) => r.method === 'POST').length, 2);
});

test('M64: an interest refused for a stale version says so once the queue has reloaded, and still says so when the reload fails', async () => {
  let current = interest('i1');
  let queue = () => response({ interests: [current], nextCursor: null });
  const d = desk({ routes: { interests: (call) => {
    if (call.method !== 'PATCH') return queue(call);
    current = { ...current, status: 'closed', version: current.version + 1 };
    return response({ error: 'interest changed; reload before saving', interest: current }, 409);
  } } });
  await flush();
  const status = () => d.node('adminInterestStatus').textContent;
  const update = async (value) => {
    const card = d.node('adminInterestList').children[0];
    descendants(card).find((n) => n.tagName === 'select').value = value;
    await descendants(card).find((n) => n.tagName === 'button').listeners.get('click')();
  };
  await update('contacted');
  assert.equal(status(), d.i18n.t('ops.interest.changed'), 'the refusal is what the line says, not the count');
  assert.equal(descendants(d.node('adminInterestList')).find((n) => n.tagName === 'select').children.find((o) => o.selected).value, 'closed', 'the queue shows their status');

  queue = () => response({}, 503);
  await update('contacted');
  assert.equal(status(), `${d.i18n.t('ops.interest.changed')} ${d.i18n.t('ops.interest.failed', { status: 503 })}`);
  d.i18n.apply('es');
  assert.equal(status(), `${d.i18n.t('ops.interest.changed')} ${d.i18n.t('ops.interest.failed', { status: 503 })}`, 'both parts follow a language switch');
  assert.match(status(), /\(503\)\.$/);
});

test('M149: an organization request write keeps its own result on the band while the list reloads, and when the reload fails', async () => {
  let current = nodeView('n1', { version: 3 });
  let listing = () => response({ requests: [current], nextCursor: null });
  let write = () => response({ error: 'unexpected' }, 500);
  const d = desk({ routes: { nodes: (call) => (call.method === 'GET' ? listing(call) : write(call)) } });
  await flush();
  const t = (key, vars) => d.i18n.t(key, vars);
  const status = () => d.node('adminNodeStatus').textContent;
  const control = (tag, label) => descendants(d.node('adminNodeList')).find((n) => n.tagName === tag && (!label || n.textContent === label));
  const relist = async () => { listing = () => response({ requests: [current], nextCursor: null }); await d.node('adminNodeFilter').listeners.get('change')(); await flush(); };
  const down = () => response({}, 503);
  const failed = () => t('ops.nodes.failed', { status: 503 });

  // Refused, and the list cannot be read again: the line still says nothing was saved.
  write = () => {
    current = { ...current, status: 'closed', version: current.version + 1 };
    return response({ error: 'node request changed; reload before saving', code: 'version_conflict', request: current }, 409);
  };
  listing = down;
  control('select').value = 'contacted';
  await control('button', 'Update').listeners.get('click')();
  assert.equal(status(), `${t('ops.nodes.changed')} ${failed()}`);
  assert.equal(d.node('adminNodeList').children.length, 0, 'the list it could not read is emptied, as before');
  d.i18n.apply('pt');
  assert.equal(status(), `${t('ops.nodes.changed')} ${failed()}`, 'both parts follow a language switch');
  d.i18n.apply('en');

  // Updated, then the reload fails: the update is not lost from the line.
  await relist();
  write = (call) => { current = { ...current, status: call.body.status, version: current.version + 1 }; return response({ request: current }); };
  listing = down;
  control('select').value = 'contacted';
  await control('button', 'Update').listeners.get('click')();
  assert.equal(status(), `${t('ops.nodes.updated')} ${failed()}`);

  // Deleted, then the reload fails.
  await relist();
  write = () => response(null, 204);
  listing = down;
  await control('button', 'Delete request').listeners.get('click')();
  assert.equal(status(), `${t('ops.nodes.deleted')} ${failed()}`);

  // While the list reloads, the line already says what the write did, and keeps saying it.
  await relist();
  const held = deferred();
  write = (call) => { current = { ...current, status: call.body.status, version: current.version + 1 }; return response({ request: current }); };
  listing = () => held.promise;
  control('select').value = 'new';
  const pending = control('button', 'Update').listeners.get('click')();
  await flush();
  assert.equal(status(), t('ops.nodes.updated'), 'said at once, not "Loading…"');
  held.resolve(response({ requests: [current], nextCursor: null }));
  await pending;
  assert.equal(status(), t('ops.nodes.updated'), 'and not replaced by the count once the list is back');
});

test('M153: after Update or Delete, focus returns to the same request in the redrawn list, or to the band’s line once it is gone', async () => {
  let current = [nodeView('n1'), nodeView('n2')];
  let write = () => response({ error: 'unexpected' }, 500);
  const d = desk({ routes: { nodes: (call) => (call.method === 'GET' ? response({ requests: current, nextCursor: null }) : write(call)) } });
  await flush();
  const rowOf = (id) => d.node('adminNodeList').children.find((article) => descendants(article).some((n) => n.tagName === 'h3' && n.textContent === `Colectivo ${id}`));
  const part = (id, tag, label) => descendants(rowOf(id)).find((n) => n.tagName === tag && (!label || n.textContent === label));
  const saved = (call) => {
    current = current.map((entry) => (call.url.endsWith(`/${entry.id}`) ? { ...entry, status: call.body.status, version: entry.version + 1 } : entry));
    return response({ request: current.find((entry) => call.url.endsWith(`/${entry.id}`)) });
  };

  // From the keyboard: the redraw takes the pressed button away, and focus goes to that request's status in the new list.
  write = saved;
  const update = part('n1', 'button', 'Update');
  update.focus();
  part('n1', 'select').value = 'contacted';
  await update.listeners.get('click')();
  assert.notEqual(part('n1', 'button', 'Update'), update, 'the row was drawn again');
  assert.equal(d.document.activeElement, part('n1', 'select'));
  assert.equal(d.document.activeElement.children.find((option) => option.selected).value, 'contacted', 'showing the status just saved');

  // Deleted: the row is gone, so focus goes to the band's line, which says what happened.
  write = () => { current = current.filter((entry) => entry.id !== 'n2'); return response(null, 204); };
  part('n2', 'button', 'Delete request').focus();
  await part('n2', 'button', 'Delete request').listeners.get('click')();
  assert.equal(rowOf('n2'), undefined);
  assert.equal(d.document.activeElement, d.node('adminNodeStatus'));
  assert.equal(d.node('adminNodeStatus').textContent, 'Request deleted.');

  // Refused before any redraw: focus goes back to the button pressed.
  write = () => response({ error: 'status must be new, contacted or closed', field: 'status' }, 400);
  const refused = part('n1', 'button', 'Update');
  refused.focus();
  await refused.listeners.get('click')();
  assert.equal(d.document.activeElement, refused);

  // A click that never focused the button (Safari) moves nothing, and neither does focus the person has moved meanwhile.
  write = saved;
  d.document.body.focus();
  await part('n1', 'button', 'Update').listeners.get('click')();
  assert.equal(d.document.activeElement, d.document.body);
  const held = deferred();
  write = (call) => held.promise.then(() => saved(call));
  part('n1', 'button', 'Update').focus();
  const pending = part('n1', 'button', 'Update').listeners.get('click')();
  d.node('adminNodeFilter').focus();
  held.resolve();
  await pending;
  assert.equal(d.document.activeElement, d.node('adminNodeFilter'));
});

test('M69: the news fields and Topics are named by their label text alone; the live count and the errors only describe them', () => {
  const html = adminPage();
  for (const [control, label, text, described] of [
    ['adminNewsTitle', 'adminNewsTitleLabel', 'Title', 'adminNewsTitleError'],
    ['adminNewsBody', 'adminNewsBodyLabel', 'Text', 'adminNewsBodyError adminNewsBodyCount'],
    ['adminNewsUrl', 'adminNewsUrlLabel', 'Link, optional', 'adminNewsUrlError'],
    ['adminTopics', 'adminTopicsLabel', 'Topics', 'adminTopicsError'],
  ]) {
    const tag = html.match(new RegExp(`<(?:input|textarea) id="${control}"[^>]*>`))?.[0] || '';
    assert.match(tag, new RegExp(`aria-labelledby="${label}"`), `${control} takes its name from its label text`);
    assert.match(tag, new RegExp(`aria-describedby="${described}"`), `${control} keeps its description`);
    // The named span holds the label text only: the count and the error sit beside it, outside the name.
    assert.match(html, new RegExp(`<span id="${label}" data-i18n="[^"]+">${text}</span>`), control);
  }
});

test('M67: the Organizations band names both kinds of request in its own loading line', () => {
  // The band lists Nodo and sponsorship requests (6e2bf37); its runtime lines are ops.nodes.loading, failed and unavailable.
  assert.match(adminPage(), /<p class="admin-live" id="adminNodeStatus" role="status" aria-live="polite" tabindex="-1">Loading organization requests…<\/p>/);
});

test('M63: the button that saves an open record with its current status says so, not that it saves the feature setting alone', async () => {
  // It sends every field of the editor (saveCatalog with the record's own status), so a published record's unfinished edits go live with it.
  assert.match(adminPage(), /<button class="admin-textbutton" id="adminSaveFeature" type="button" hidden data-i18n="ops\.editor\.saveFeature">Save without changing status<\/button>/);
  const sent = [];
  const live = record('r1', 'First', { status: 'published', version: 4 });
  const d = desk({ routes: { catalog: (call) => {
    if (call.method === 'PATCH') { sent.push(call.body); return response({ item: { ...live, ...call.body, id: 'r1', version: 5 } }); }
    return response({ items: [live], nextCursor: null });
  } } });
  await flush();
  catalogRow(d, 'r1').listeners.get('click')();
  d.node('adminSummaryEs').value = 'Resumen nuevo';
  d.node('adminFeatured').checked = true;
  await d.node('adminSaveFeature').listeners.get('click')();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].status, 'published', 'the status stays');
  assert.equal(sent[0].featured, true);
  assert.equal(sent[0].translations.es.summary, 'Resumen nuevo', 'and every other field is saved with it');
});
