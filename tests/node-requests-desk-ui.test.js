import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/* The publishing desk's Nodos band: the organization node requests sent from the landing page's form, without an account
   (spec: docs/superpowers/specs/2026-11-03-organisation-node-requests-design.md, "Desk tab"; API in server/node-requests-api.js).
   The harness is the desk's (tests/catalog-ui.test.js adminHarness): admin.html's ids as fake elements, the real dictionaries,
   a stubbed fetch and confirm, and admin.js run as the page runs it, bootstrap included. Every field was typed by an
   anonymous visitor, so the band writes each one as text. */
const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const adminPage = () => read('web', 'pages', 'admin.html');

class FakeNode {
  constructor(tag = '') {
    this.tagName = tag;
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.value = '';
    this.dataset = {};
    this.children = [];
    this.style = {};
    this.listeners = new Map();
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  }

  append(...nodes) { for (const node of nodes) { if (node && typeof node === 'object') node.parent = this; this.children.push(node); } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { for (const child of this.children) if (child && typeof child === 'object') child.parent = null; this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this); this.parent = null; }
  setAttribute(name, value) { this[name] = String(value); }
  getAttribute(name) { return this[name] ?? null; }
  removeAttribute(name) { delete this[name]; }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  scrollIntoView() {}
  focus() { this.focused = true; }
  getBoundingClientRect() { return {}; }
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
  const document = { body: { dataset: {} }, documentElement: new FakeNode('html'), querySelectorAll: () => [] };
  const context = { URLSearchParams, document, console, localStorage: { getItem() { return null; }, setItem() {} }, location: { search: '' } };
  context.window = context;
  vm.runInNewContext(read('web', 'scripts', 'i18n-dashboard.js'), context, { filename: 'i18n-dashboard.js' });
  vm.runInNewContext(read('web', 'scripts', 'i18n.js'), context, { filename: 'i18n.js' });
  context.window.nodalI18n.apply(lang, { persist: false });
  return context.window.nodalI18n;
}

/* nodes({url, method, body}) answers every /api/admin/node-requests call; the other bands get empty lists.
   observer: give the page an IntersectionObserver, so the tab row follows the reader. */
function desk({ lang = 'en', nodes = () => response({ requests: [], nextCursor: null }), confirm = () => true, observer = false } = {}) {
  const ids = new Map([...adminPage().matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], Object.assign(new FakeNode(match[1]), { id: match[1] })]));
  const requests = [], confirms = [], observed = [], windowListeners = {};
  const fetchImpl = async (url, options = {}) => {
    const call = { url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined };
    requests.push(call);
    if (url.startsWith('/api/admin/node-requests')) return nodes(call);
    if (url.startsWith('/api/admin/news')) return response({ items: [], nextCursor: null });
    if (url.startsWith('/api/admin/catalog')) return response({ items: [], nextCursor: null });
    if (url.startsWith('/api/admin/interests')) return response({ interests: [], nextCursor: null });
    if (url.startsWith('/api/admin/membership/founders')) return response({ founders: [] });
    return response({ error: 'not found' }, 404);
  };
  const i18n = deskI18n(lang);
  const context = {
    AbortController, Date, URL, URLSearchParams, Intl, clearTimeout, setTimeout, encodeURIComponent, console, crypto: globalThis.crypto,
    document: { getElementById: (id) => ids.get(id) ?? null, createElement: (tag) => new FakeNode(tag) },
    fetch: fetchImpl,
    location: { hash: '', assigned: '', assign(value) { this.assigned = value; } },
    matchMedia: () => ({ matches: true }),
    nodalI18n: i18n,
    confirm: (message) => { confirms.push(message); return confirm(message); },
  };
  if (observer) {
    context.IntersectionObserver = class {
      constructor(callback, options) { this.callback = callback; this.options = options; this.targets = []; observed.push(this); }
      observe(target) { this.target = target; this.targets.push(target); }
      disconnect() { this.disconnected = true; }
    };
    context.addEventListener = (type, handler) => { (windowListeners[type] ??= []).push(handler); };
    context.innerHeight = 800;
  }
  context.window = context;
  vm.runInNewContext(read('web', 'scripts', 'admin.js'), context, { filename: 'admin.js' });
  const node = (id) => ids.get(id);
  const rows = () => node('adminNodeList').children;
  const part = (row, className) => descendants(row).find((n) => n.className === className);
  const tag = (row, name) => descendants(row).find((n) => n.tagName === name);
  const button = (row, label) => descendants(row).find((n) => n.tagName === 'button' && n.textContent === label);
  const gets = () => requests.filter((r) => r.url.startsWith('/api/admin/node-requests') && r.method === 'GET').map((r) => r.url);
  const status = () => node('adminNodeStatus').textContent;
  const filter = async (value) => { node('adminNodeFilter').value = value; await node('adminNodeFilter').listeners.get('change')(); await flush(); };
  const more = async () => { await node('adminNodeMore').listeners.get('click')(); await flush(); };
  return { ids, node, requests, confirms, i18n, observed, windowListeners, rows, part, tag, button, gets, status, filter, more };
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
// Task 4's nodeRequestAdminView.
const view = (overrides = {}) => ({
  id: A, name: 'Ana Quispe', organization: 'Colectivo Ciudad', email: 'ana@example.test', phone: null,
  message: 'Queremos activar un nodo en Arequipa.', language: 'es', status: 'new', emailStatus: 'sent',
  createdAt: '2026-11-03T04:30:00.000Z', updatedAt: '2026-11-03T04:30:00.000Z', version: 1, ...overrides,
});

test('lists node requests newest first with every field as text', async () => {
  // 04:30 UTC on 3 November is still 2 November in Lima (UTC-05:00).
  const newest = view({
    id: A,
    organization: 'Colectivo <script>alert(1)</script>\r\nCiudad 🏙️',
    name: 'Ana 🌱 Quispe\r\n<img src=x onerror=alert(1)>',
    email: 'ana+nodo@example.test',
    phone: '+51 (1) 555-0100',
    message: 'Línea uno\r\nLínea dos\n\n<script>alert("x")</script> 🚲',
    language: 'es',
    status: 'contacted',
    createdAt: '2026-11-03T04:30:00.000Z',
  });
  const older = view({ id: B, organization: 'Red Urbana', name: 'Beto Ruiz', email: 'beto@example.test', phone: null, message: 'Hola', language: 'pt', createdAt: '2026-10-30T15:00:00.000Z' });
  const d = desk({ nodes: () => response({ requests: [newest, older], nextCursor: null }) });
  await flush();

  assert.deepEqual(d.gets(), ['/api/admin/node-requests?limit=24'], 'the first page of every status: no empty parameter');
  assert.equal(d.rows().length, 2);
  const [first, second] = d.rows();
  assert.equal(d.tag(first, 'h3').textContent, newest.organization, 'the organization heads its request, newest first');
  assert.equal(d.tag(second, 'h3').textContent, older.organization);
  assert.equal(d.part(first, 'admin-node-name').textContent, newest.name);
  const email = d.tag(first, 'a');
  assert.equal(email.textContent, newest.email);
  assert.equal(email.href, `mailto:${encodeURIComponent(newest.email)}`);
  assert.equal(d.part(first, 'admin-node-phone').textContent, 'Phone: +51 (1) 555-0100');
  assert.equal(d.part(second, 'admin-node-phone'), undefined, 'no phone line without a phone');
  assert.equal(d.part(first, 'admin-node-message').textContent, newest.message, 'line breaks stay in the text; CSS shows them');
  assert.equal(d.part(first, 'admin-node-meta').textContent, 'Received 2 November 2026 · Language: Spanish');
  assert.equal(d.part(second, 'admin-node-meta').textContent, 'Received 30 October 2026 · Language: Portuguese');
  assert.equal(d.tag(first, 'select').children.find((option) => option.selected).value, 'contacted');
  assert.equal(d.status(), '2 requests loaded.');
  // Nothing a visitor typed is parsed as markup.
  for (const n of descendants(d.node('adminNodeList'))) {
    assert.equal('innerHTML' in n, false);
    assert.ok(!['script', 'img'].includes(n.tagName), n.tagName);
  }
  assert.doesNotMatch(read('web', 'scripts', 'admin.js'), /innerHTML|outerHTML|insertAdjacentHTML/);
  assert.match(read('web', 'styles', 'admin.css'), /\.admin-node-message\s*\{[^}]*white-space:\s*pre-wrap/);
});

test('filters by status and pages with the cursor', async () => {
  const html = adminPage();
  assert.match(html, /<select id="adminNodeFilter"><option value="" data-i18n="ops\.filter\.allStatuses">All statuses<\/option><option value="new" data-i18n="ops\.nodes\.new">New<\/option><option value="contacted" data-i18n="ops\.nodes\.contacted">Contacted<\/option><option value="closed" data-i18n="ops\.nodes\.closed">Closed<\/option><\/select>/);
  assert.match(html, /<button class="admin-button admin-more" id="adminNodeMore" type="button" hidden data-i18n="ops\.nodes\.more">/);
  const pages = {
    '/api/admin/node-requests?limit=24': { requests: [view({ id: A })], nextCursor: 'page-2' },
    '/api/admin/node-requests?limit=24&cursor=page-2': { requests: [view({ id: B, organization: 'Red Urbana' })], nextCursor: null },
    '/api/admin/node-requests?limit=24&status=new': { requests: [view({ id: A })], nextCursor: 'new-2' },
    '/api/admin/node-requests?limit=24&status=new&cursor=new-2': { requests: [view({ id: C, organization: 'Tercera Red' })], nextCursor: null },
    '/api/admin/node-requests?limit=24&status=closed': { requests: [], nextCursor: null },
  };
  // The server answers 400 to an empty or unknown parameter, as the Interests queue does.
  const d = desk({ nodes: ({ url }) => (pages[url] ? response(pages[url]) : response({ error: 'query is invalid', field: 'query' }, 400)) });
  const organizations = () => d.rows().map((row) => d.tag(row, 'h3').textContent);
  await flush();
  assert.deepEqual(organizations(), ['Colectivo Ciudad']);
  assert.equal(d.node('adminNodeMore').hidden, false);
  await d.more();
  assert.deepEqual(organizations(), ['Colectivo Ciudad', 'Red Urbana'], 'the next page is added after the first');
  assert.equal(d.node('adminNodeMore').hidden, true);

  await d.filter('new');
  assert.deepEqual(organizations(), ['Colectivo Ciudad'], 'a new filter starts from the first page');
  await d.more();
  assert.deepEqual(organizations(), ['Colectivo Ciudad', 'Tercera Red']);
  await d.filter('closed');
  assert.deepEqual(organizations(), []);
  assert.equal(d.node('adminNodeMore').hidden, true);
  assert.equal(d.status(), 'No node requests match this status.');
  await d.filter('');
  assert.deepEqual(organizations(), ['Colectivo Ciudad']);
  assert.equal(d.node('adminNodeMore').hidden, false);

  assert.deepEqual(d.gets(), [
    '/api/admin/node-requests?limit=24',
    '/api/admin/node-requests?limit=24&cursor=page-2',
    '/api/admin/node-requests?limit=24&status=new',
    '/api/admin/node-requests?limit=24&status=new&cursor=new-2',
    '/api/admin/node-requests?limit=24&status=closed',
    '/api/admin/node-requests?limit=24',
  ]);
});

test('updates the status with the version and reloads on a conflict', async () => {
  let current = view({ id: A, status: 'new', version: 3 });
  let patch = () => response({ error: 'unexpected' }, 500);
  const d = desk({ nodes: (call) => (call.method === 'GET' ? response({ requests: [current], nextCursor: null }) : patch(call)) });
  await flush();

  const answer = deferred();
  patch = () => answer.promise;
  const row = d.rows()[0];
  d.tag(row, 'select').value = 'contacted';
  const update = d.button(row, 'Update');
  const pending = update.listeners.get('click')();
  assert.equal(update.disabled, true, 'one PATCH at a time');
  assert.equal(d.button(row, 'Delete request').disabled, true, 'no delete while the status is being saved');
  assert.equal(d.status(), 'Updating the request…');
  current = { ...current, status: 'contacted', version: 4 };
  answer.resolve(response({ request: current }));
  await pending;
  assert.deepEqual(d.requests.filter((r) => r.method === 'PATCH'), [{ url: `/api/admin/node-requests/${A}`, method: 'PATCH', body: { status: 'contacted', version: 3 } }]);
  assert.equal(d.gets().length, 2, 'the list reloads after the update');
  assert.equal(d.status(), 'Request status updated. The active filter has been reapplied.');

  // Someone else closed it meanwhile: the server keeps their change and answers 409 with the current row.
  patch = () => {
    current = { ...current, status: 'closed', version: 5 };
    return response({ error: 'node request changed; reload before saving', code: 'version_conflict', request: current }, 409);
  };
  d.tag(d.rows()[0], 'select').value = 'new';
  await d.button(d.rows()[0], 'Update').listeners.get('click')();
  assert.deepEqual(d.requests.filter((r) => r.method === 'PATCH').at(-1).body, { status: 'new', version: 4 });
  assert.equal(d.gets().length, 3, 'the conflict reloads the list');
  assert.equal(d.status(), 'Someone else changed this request first, so nothing was saved. The list shows its current status.');
  const reloaded = d.rows()[0];
  assert.equal(d.tag(reloaded, 'select').children.find((option) => option.selected).value, 'closed');
  assert.equal(d.button(reloaded, 'Update').disabled, false);

  // Any other refusal is shown in the server's words, and the list is not reloaded.
  patch = () => response({ error: 'status must be new, contacted or closed', field: 'status' }, 400);
  await d.button(reloaded, 'Update').listeners.get('click')();
  assert.equal(d.status(), 'status must be new, contacted or closed');
  assert.equal(d.gets().length, 3);
  assert.equal(d.button(reloaded, 'Update').disabled, false);
});

test('deletes after a confirm that mentions the team emails and their Sent-folder copies', async () => {
  let listed = [view({ id: A, organization: 'Colectivo Ciudad' })];
  let answer = false;
  const nodes = (call) => {
    if (call.method === 'DELETE') { listed = []; return response(null, 204); }
    return response({ requests: listed, nextCursor: null });
  };
  const d = desk({ confirm: () => answer, nodes });
  await flush();
  const remove = d.button(d.rows()[0], 'Delete request');
  assert.equal(remove.getAttribute('aria-label'), 'Delete request: Colectivo Ciudad', 'each Delete names its request');

  await remove.listeners.get('click')();
  assert.equal(d.requests.some((r) => r.method === 'DELETE'), false, 'cancelled: nothing is deleted');
  assert.equal(d.rows().length, 1);

  answer = true;
  await remove.listeners.get('click')();
  assert.deepEqual(d.confirms, Array(2).fill('Delete the request from Colectivo Ciudad? This cannot be undone. Remember to delete the two team emails about it, and their copies in the sending account’s Sent folder.'));
  assert.deepEqual(d.requests.filter((r) => r.method === 'DELETE'), [{ url: `/api/admin/node-requests/${A}`, method: 'DELETE', body: undefined }]);
  assert.equal(d.gets().length, 2, 'the list reloads after the delete');
  assert.equal(d.rows().length, 0);
  assert.equal(d.status(), 'Request deleted.');

  const es = desk({ lang: 'es', confirm: () => false, nodes: () => response({ requests: [view({ organization: 'Colectivo Ciudad' })], nextCursor: null }) });
  await flush();
  await es.button(es.rows()[0], 'Eliminar solicitud').listeners.get('click')();
  assert.equal(es.confirms[0], '¿Eliminar la solicitud de Colectivo Ciudad? No se puede deshacer. Recuerda eliminar también los dos correos que recibió el equipo sobre ella y sus copias en la carpeta de enviados de la cuenta que los envió.');
  assert.equal(deskI18n('pt').t('ops.nodes.confirmDelete', { organization: 'X' }), 'Excluir a solicitação de X? Não é possível desfazer. Lembre-se de excluir também os dois e-mails que a equipe recebeu sobre ela e as cópias deles na pasta de enviados da conta que os enviou.');
});

test('warns when the team email was not sent', async () => {
  const outcomes = ['sent', 'partial', 'failed', 'uncertain', 'off', null];
  const list = outcomes.map((emailStatus, index) => view({ id: `request-${index}`, organization: `Org ${emailStatus}`, emailStatus }));
  const warnings = async (lang) => {
    const d = desk({ lang, nodes: () => response({ requests: list, nextCursor: null }) });
    await flush();
    return d.rows().map((row) => d.part(row, 'admin-node-warning')?.textContent ?? null);
  };
  assert.deepEqual(await warnings('en'), [
    null,
    'Warning: the team email reached only one of the two team members.',
    'Warning: the team email failed for both team members.',
    'Warning: it is not known whether the team email arrived.',
    'Warning: the team email was not sent (email is off, or the day’s limit was reached).',
    'Warning: the team email has no recorded result.',
  ]);
  const spanish = await warnings('es');
  assert.equal(spanish[0], null);
  assert.match(spanish[4], /no se envió el correo al equipo/);
  // null is what a failed write of the outcome leaves too, so it never reads as temporary.
  assert.equal(spanish[5], 'Aviso: correo al equipo sin resultado registrado.');
  const portuguese = await warnings('pt');
  assert.equal(portuguese[5], 'Aviso: o e-mail para a equipe não tem resultado registrado.');
  for (const lines of [spanish, portuguese]) {
    assert.equal(new Set(lines.slice(1)).size, 5, 'one wording per outcome');
    assert.ok(lines.slice(1).every((line) => /^Aviso: /.test(line)), lines.join(' | '));
  }
  assert.match(read('web', 'styles', 'admin.css'), /\.admin-node \.admin-node-warning\s*\{[^}]*color:\s*var\(--alert\)/);
});

test('re-renders the band when the language changes', async () => {
  const request = view({ organization: 'Colectivo <b>Ciudad</b>', name: 'Ana 🌱', phone: '999 888 777', language: 'en', status: 'closed', emailStatus: 'off' });
  const d = desk({ nodes: () => response({ requests: [request], nextCursor: null }) });
  await flush();
  const shown = () => {
    const row = d.rows()[0];
    const select = d.tag(row, 'select');
    return {
      organization: d.tag(row, 'h3').textContent,
      name: d.part(row, 'admin-node-name').textContent,
      phone: d.part(row, 'admin-node-phone').textContent,
      meta: d.part(row, 'admin-node-meta').textContent,
      warning: d.part(row, 'admin-node-warning').textContent,
      field: d.tag(d.tag(row, 'label'), 'span').textContent,
      options: select.children.map((option) => option.textContent),
      selected: select.children.find((option) => option.selected).value,
      buttons: descendants(row).filter((n) => n.tagName === 'button').map((n) => n.textContent),
      remove: descendants(row).filter((n) => n.tagName === 'button').at(-1).getAttribute('aria-label'),
      status: d.status(),
    };
  };
  assert.deepEqual(shown(), {
    organization: 'Colectivo <b>Ciudad</b>', name: 'Ana 🌱', phone: 'Phone: 999 888 777',
    meta: 'Received 2 November 2026 · Language: English',
    warning: 'Warning: the team email was not sent (email is off, or the day’s limit was reached).',
    field: 'Status', options: ['New', 'Contacted', 'Closed'], selected: 'closed',
    buttons: ['Update', 'Delete request'], remove: 'Delete request: Colectivo <b>Ciudad</b>', status: '1 request loaded.',
  });
  d.i18n.apply('es');
  assert.deepEqual(shown(), {
    organization: 'Colectivo <b>Ciudad</b>', name: 'Ana 🌱', phone: 'Teléfono: 999 888 777',
    meta: 'Recibida el 2 de noviembre de 2026 · Idioma: Inglés',
    warning: 'Aviso: no se envió el correo al equipo (el correo está desactivado o se alcanzó el tope del día).',
    field: 'Estado', options: ['Nueva', 'Contactada', 'Cerrada'], selected: 'closed',
    buttons: ['Actualizar', 'Eliminar solicitud'], remove: 'Eliminar solicitud: Colectivo <b>Ciudad</b>', status: '1 solicitud cargada.',
  });
  d.i18n.apply('pt');
  assert.deepEqual(shown(), {
    organization: 'Colectivo <b>Ciudad</b>', name: 'Ana 🌱', phone: 'Telefone: 999 888 777',
    meta: 'Recebida em 2 de novembro de 2026 · Idioma: Inglês',
    warning: 'Aviso: o e-mail para a equipe não foi enviado (o e-mail está desligado ou o limite do dia foi atingido).',
    field: 'Status', options: ['Nova', 'Contatada', 'Encerrada'], selected: 'closed',
    buttons: ['Atualizar', 'Excluir solicitação'], remove: 'Excluir solicitação: Colectivo <b>Ciudad</b>', status: '1 solicitação carregada.',
  });
  assert.equal(d.gets().length, 1, 'a language switch re-renders what is loaded, without a new read');
});

test('marks the Nodos tab while its band is on screen', async () => {
  const html = adminPage();
  assert.match(html, /<li><a href="#nodes" id="adminTabNodes" data-i18n="ops\.index\.nodes">Nodes<\/a><\/li>/);
  const at = (needle) => html.indexOf(needle);
  assert.ok(at('id="adminTabInterests"') < at('id="adminTabNodes"') && at('id="adminTabNodes"') < at('id="adminTabFounders"'), 'the tab sits between Interest requests and Founder Membership');
  assert.match(html, /<section class="admin-band" id="nodes" aria-labelledby="nodesTitle">/);
  assert.ok(at('id="interests"') < at('id="nodes"') && at('id="nodes"') < at('id="founders"'), 'Founder Membership stays the last band');
  assert.match(html, /<p class="admin-live" id="adminNodeStatus" role="status" aria-live="polite">[^<]*<\/p>/);
  assert.doesNotMatch(html, /id="adminNodeStatus"[^>]*data-i18n=/, 'the status line is runtime text');
  assert.match(html, /<div class="admin-node-list" id="adminNodeList" aria-busy="true"><\/div>/);
  assert.deepEqual(['en', 'es', 'pt'].map((lang) => deskI18n(lang).t('ops.index.nodes')), ['Nodes', 'Nodos', 'Nós']);

  const d = desk({ observer: true });
  await flush();
  const band = d.observed.find((o) => o.options?.rootMargin);
  const end = d.observed.find((o) => o.options?.threshold);
  assert.ok(band?.targets.includes(d.node('nodes')), 'the tab row watches the Nodos band');
  const current = () => ['adminTabNews', 'adminTabCatalog', 'adminTabInterests', 'adminTabNodes', 'adminTabFounders'].filter((id) => d.node(id).getAttribute('aria-current') === 'true');
  band.callback([{ target: d.node('nodes'), isIntersecting: true }]);
  assert.deepEqual(current(), ['adminTabNodes'], 'the band crossing the reading line');
  band.callback([{ target: d.node('nodes'), isIntersecting: false }, { target: d.node('interests'), isIntersecting: true }]);
  assert.deepEqual(current(), ['adminTabInterests']);
  // Nodos is short and just before the last band: once clicked, its tab keeps the mark at the page's end while the band is on screen.
  d.node('nodes').getBoundingClientRect = () => ({ top: 200, bottom: 520 });
  d.node('adminTabList').listeners.get('click')({ target: { closest: () => d.node('adminTabNodes') } });
  assert.deepEqual(current(), ['adminTabNodes']);
  end.callback([{ target: d.node('founders'), intersectionRatio: 1 }]);
  assert.deepEqual(current(), ['adminTabNodes']);
  for (const handler of d.windowListeners.wheel ?? []) handler();
  end.callback([{ target: d.node('founders'), intersectionRatio: 1 }]);
  assert.deepEqual(current(), ['adminTabFounders'], 'scrolling by hand gives the mark back to the page position');
});
