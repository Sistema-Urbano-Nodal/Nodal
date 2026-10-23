import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/* The publishing desk's Membresía Fundador band. Members pay on Mercado Pago links, outside NODAL, so only an administrator
   gives the Founder badge (POST /api/admin/membership/founders {email}), once the payment is approved and the acceptance
   checked; the desk lists who has it (GET) and can take it back to correct a mistake (DELETE …/:id). Every message is the
   desk's own, in the page language: server text never reaches the screen. */
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
const rendered = (node) => [node?.textContent || '', ...(node?.children || []).map(rendered)].join(' ').replace(/\s+/g, ' ').trim();
const flush = async () => { for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const response = (payload, status = 200) => ({ ok: status < 400, status, async json() { return payload; } });

function deskI18n(lang) {
  const document = { body: { dataset: {} }, documentElement: new FakeNode('html'), querySelectorAll: () => [] };
  const context = { URLSearchParams, document, console, localStorage: { getItem() { return null; }, setItem() {} }, location: { search: '' } };
  context.window = context;
  vm.runInNewContext(read('web', 'scripts', 'i18n-dashboard.js'), context, { filename: 'i18n-dashboard.js' });
  vm.runInNewContext(read('web', 'scripts', 'i18n.js'), context, { filename: 'i18n.js' });
  context.window.nodalI18n.apply(lang, { persist: false });
  return context.window.nodalI18n;
}

/* founders: what GET answers; write(method, url, body) answers the POST and DELETE. observer: give the page an IntersectionObserver
   (the band then loads when it comes into view). hash: the address's #fragment. */
function desk({ lang = 'en', founders = [], write = () => response({}, 500), confirm = () => true, observer = false, hash = '', list } = {}) {
  const ids = new Map([...adminPage().matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], new FakeNode(match[1])]));
  const requests = [], confirms = [], observed = [];
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    requests.push({ url, method, body: options.body ? JSON.parse(options.body) : undefined, credentials: options.credentials, headers: options.headers });
    if (url.startsWith('/api/admin/membership/founders')) {
      if (method === 'GET') return list ? list() : response({ founders });
      return write(method, url, options.body ? JSON.parse(options.body) : undefined);
    }
    if (url.startsWith('/api/admin/news')) return response({ items: [], nextCursor: null });
    if (url.startsWith('/api/admin/catalog')) return response({ items: [], nextCursor: null });
    if (url.startsWith('/api/admin/interests')) return response({ interests: [], nextCursor: null });
    return response({ error: 'not found' }, 404);
  };
  const i18n = deskI18n(lang);
  const context = {
    AbortController, Date, URL, URLSearchParams, Intl, clearTimeout, setTimeout, encodeURIComponent, console, crypto: globalThis.crypto,
    document: { getElementById: (id) => ids.get(id) ?? null, createElement: (tag) => new FakeNode(tag) },
    fetch: fetchImpl,
    location: { hash, assigned: '', assign(value) { this.assigned = value; } },
    matchMedia: () => ({ matches: true }),
    nodalI18n: i18n,
    confirm: (message) => { confirms.push(message); return confirm(message); },
  };
  if (observer) {
    context.IntersectionObserver = class {
      constructor(callback) { this.callback = callback; observed.push(this); }
      observe(target) { this.target = target; }
      disconnect() { this.disconnected = true; }
    };
  }
  context.window = context;
  vm.runInNewContext(read('web', 'scripts', 'admin.js'), context, { filename: 'admin.js' });
  const node = (id) => ids.get(id);
  const founderRequests = () => requests.filter((r) => r.url.startsWith('/api/admin/membership/founders'));
  // The band comes into view: every observer watching it is told.
  const scrollToBand = () => observed.filter((o) => o.target === node('founders')).forEach((o) => o.callback([{ target: o.target, isIntersecting: true }]));
  const grant = async (email) => { node('adminFounderEmail').value = email; await node('adminFounderForm').listeners.get('submit')({ preventDefault() {} }); await flush(); };
  const rows = () => node('adminFounderList').children;
  const removeButton = (row) => descendants(row).find((n) => n.tagName === 'button');
  // Everything the band writes at run time: its two status lines, the list title and the list.
  const shown = () => ['adminFounderStatus', 'adminFounderListStatus', 'adminFounderListTitle', 'adminFounderList'].map((id) => rendered(node(id))).join(' ');
  return { ids, node, requests, founderRequests, confirms, i18n, scrollToBand, grant, rows, removeButton, shown };
}

const ana = { id: '11111111-1111-4111-8111-111111111111', name: 'Ana Quispe', email: 'ana@example.test', founderSince: '2026-10-22T03:30:00.000Z' };
const beto = { id: '22222222-2222-4222-8222-222222222222', name: 'Beto Ruiz', email: 'beto@example.test', founderSince: '2026-10-21T15:00:00.000Z' };

test('the desk has a Founder Membership tab and band after Interest requests, before the links away', () => {
  const html = adminPage();
  const tabs = [...html.matchAll(/<li[^>]*><a href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['#news', '#catalog', '#interests', '#founders', 'fiiu-admin.html#content', 'teaching.html']);
  assert.match(html, /<a href="#founders" id="adminTabFounders" data-i18n="ops\.index\.founders">Founder Membership<\/a>/);
  assert.ok(html.indexOf('id="interests"') < html.indexOf('id="founders"'), 'the band follows Interest requests');
  assert.match(html, /<section class="admin-band" id="founders" aria-labelledby="foundersTitle">/);
  assert.match(html, /<h2 id="foundersTitle" data-i18n="ops\.founders\.title">Founder Membership<\/h2>/);
  // The acceptances CSV the administrator checks before giving the badge: a download, not a page.
  assert.match(html, /<a class="admin-textbutton admin-download" id="adminFoundersCsv" href="\/api\/admin\/membership\/acceptances" download data-i18n="ops\.founders\.csv">/);
  assert.match(html, /<form class="admin-founder-form" id="adminFounderForm" novalidate>/);
  assert.match(html, /<input id="adminFounderEmail" type="email" inputmode="email" maxlength="254" autocomplete="off" autocapitalize="none" spellcheck="false"/);
  assert.match(html, /<button class="admin-button admin-button-accent" id="adminFounderGrant" type="submit" data-i18n="ops\.founders\.grant">Give the Founder badge<\/button>/);
  for (const id of ['adminFounderStatus', 'adminFounderListStatus']) {
    assert.match(html, new RegExp(`id="${id}" role="status" aria-live="polite"`), id);
    assert.doesNotMatch(html, new RegExp(`id="${id}"[^>]*data-i18n=`), `${id} is runtime text`);
  }
  assert.doesNotMatch(html, /id="adminFounderListTitle"[^>]*data-i18n=/, 'the list title carries its count, so admin.js writes it');
  // Still the desk's own assets: no course-pilot script or stylesheet comes with the band.
  assert.doesNotMatch(html, /pilot\.js|pilot-i18n\.js|courses\.css/);
  assert.match(html, /href="admin\.css\?v=20261023a"/);
  assert.match(html, /src="admin\.js\?v=20261023a"/);
  assert.match(html, /src="i18n-dashboard\.js\?v=20261023a"/);
});

test('the band’s copy is the desk’s own in English, Spanish and Portuguese, and keeps the word Founder', () => {
  const COPY = {
    en: { title: 'Founder Membership', lead: 'Give the Founder badge to each member whose payment Mercado Pago approved, after you check their acceptance. It shows on their profile, console and course posts, and stays for as long as they keep their NODAL account.', csv: 'Download the acceptances (CSV)', email: 'Email of the member’s NODAL account', grant: 'Give the Founder badge' },
    es: { title: 'Membresía Fundador', lead: 'Da el badge Founder a cada miembro cuyo pago aprobó Mercado Pago, después de revisar su aceptación. Aparece en su perfil, su panel y sus aportes en los cursos, y se mantiene mientras conserve su cuenta en Nodal.', csv: 'Descargar las aceptaciones (CSV)', email: 'Correo de la cuenta Nodal del miembro', grant: 'Dar el badge Founder' },
    pt: { title: 'Membresia Fundador' },
  };
  for (const lang of ['en', 'es', 'pt']) {
    const i18n = deskI18n(lang);
    for (const [key, value] of Object.entries(COPY[lang])) assert.equal(i18n.t(`ops.founders.${key}`), value, `${lang} ${key}`);
    assert.equal(i18n.t('ops.index.founders'), COPY[lang].title, `${lang} tab`);
    for (const key of ['lead', 'grant', 'granted', 'already', 'confirm', 'empty']) assert.match(i18n.t(`ops.founders.${key}`), /Founder/, `${lang} ${key} keeps the word Founder`);
  }
  // Every ops.founders.* key the desk asks for exists in all three languages, each its own translation.
  const keys = [...new Set([...read('web', 'scripts', 'admin.js').matchAll(/'(ops\.founders\.\w+)'/g)].map((m) => m[1]))];
  assert.ok(keys.length >= 15, `the band's copy is keyed (${keys.length})`);
  const context = { window: {} };
  vm.runInNewContext(read('web', 'scripts', 'i18n-dashboard.js'), context);
  const dict = context.window.NODAL_I18N_DASH;
  for (const key of [...keys, 'ops.founders.title', 'ops.founders.lead', 'ops.founders.csv', 'ops.founders.email', 'ops.founders.grant', 'ops.index.founders']) {
    for (const lang of ['en', 'es', 'pt']) assert.ok(dict[lang][key]?.trim(), `${lang} ${key}`);
    if (!/title|index/.test(key)) assert.notEqual(dict.pt[key], dict.es[key], `pt ${key} is Portuguese, not the Spanish copied`);
  }
});

test('the list loads when the band is first seen, once, newest first with each member’s date in the page language and Lima time', async () => {
  const d = desk({ lang: 'es', founders: [ana, beto], observer: true });
  await flush();
  assert.equal(d.founderRequests().length, 0, 'nothing is asked before the band is seen');
  d.scrollToBand();
  await flush();
  assert.deepEqual(d.founderRequests().map((r) => [r.method, r.url, r.credentials]), [['GET', '/api/admin/membership/founders', 'same-origin']]);
  assert.equal(d.node('adminFounderListTitle').textContent, 'Miembros con el badge (2)');
  assert.equal(d.rows().length, 2);
  // 03:30 UTC on the 22nd is still the 21st in Lima.
  assert.equal(rendered(d.rows()[0]), 'Ana Quispe ana@example.test desde el 21 de octubre de 2026 Quitar badge');
  assert.equal(rendered(d.rows()[1]), 'Beto Ruiz beto@example.test desde el 21 de octubre de 2026 Quitar badge');
  assert.equal(d.removeButton(d.rows()[0])['aria-label'], 'Quitar badge: Ana Quispe', 'the visible label, then whose badge');
  assert.equal(d.node('adminFounderListStatus').textContent, '');
  d.scrollToBand();
  d.node('adminTabFounders').listeners.get('click')?.();
  await flush();
  assert.equal(d.founderRequests().length, 1, 'seen again, the list is not asked for again');
  d.i18n.apply('pt', { persist: false });
  assert.equal(d.node('adminFounderListTitle').textContent, 'Membros com o badge (2)');
  assert.equal(rendered(d.rows()[0]), 'Ana Quispe ana@example.test desde 21 de outubro de 2026 Remover badge');
  d.i18n.apply('en', { persist: false });
  assert.equal(rendered(d.rows()[0]), 'Ana Quispe ana@example.test since 21 October 2026 Remove badge');
});

test('the Founder Membership tab, an address that opens on #founders, or a browser without IntersectionObserver loads the list', async () => {
  const tab = desk({ observer: true });
  await flush();
  assert.equal(tab.founderRequests().length, 0);
  await tab.node('adminTabFounders').listeners.get('click')();
  assert.equal(tab.founderRequests().length, 1);
  const linked = desk({ observer: true, hash: '#founders' });
  await flush();
  assert.equal(linked.founderRequests().length, 1);
  const old = desk();
  await flush();
  assert.equal(old.founderRequests().length, 1);
  assert.equal(old.node('adminFounderListStatus').textContent, 'No one has the Founder badge yet.');
  assert.equal(old.node('adminFounderListTitle').textContent, 'Members with the badge (0)');
});

test('a list that cannot load says so in the page language, never in the server’s words', async () => {
  for (const reply of [() => response({ error: 'founder lookup exploded' }, 503), () => response({ error: 'Forbidden' }, 403), () => response({ nope: true }), () => Promise.reject(new TypeError('Failed to fetch'))]) {
    const d = desk({ lang: 'es', list: reply });
    await flush();
    assert.equal(d.node('adminFounderListStatus').textContent, 'No se pudo cargar la lista. Recarga la página.');
    assert.doesNotMatch(d.shown(), /exploded|Forbidden/);
  }
});

test('giving the badge posts the email, says who got it and refreshes the list', async () => {
  let founders = [beto];
  const d = desk({
    list: () => response({ founders }),
    write: (method, url, body) => {
      assert.equal(method, 'POST');
      assert.equal(url, '/api/admin/membership/founders');
      founders = [{ ...ana, email: body.email }, beto];
      return response({ result: 'granted', founder: founders[0] }, 201);
    },
  });
  await flush();
  await d.grant('  Ana@Example.test ');
  const post = d.founderRequests().find((r) => r.method === 'POST');
  assert.deepEqual(post.body, { email: 'Ana@Example.test' }, 'trimmed; the server matches the email case-insensitively');
  assert.equal(post.credentials, 'same-origin');
  assert.equal(post.headers['Content-Type'], 'application/json');
  assert.equal(d.node('adminFounderStatus').textContent, 'Founder badge given to Ana Quispe.');
  assert.equal(d.node('adminFounderEmail').value, '', 'ready for the next member');
  assert.deepEqual(d.founderRequests().map((r) => r.method), ['GET', 'POST', 'GET'], 'the list is read again after the change');
  assert.equal(d.node('adminFounderListTitle').textContent, 'Members with the badge (2)');
  assert.equal(d.node('adminFounderGrant').disabled, false);
  d.i18n.apply('es', { persist: false });
  assert.equal(d.node('adminFounderStatus').textContent, 'Badge Founder dado a Ana Quispe.', 'the message follows a language switch');
});

test('a member who already has the badge keeps their date, and the desk says so', async () => {
  const d = desk({ lang: 'es', founders: [ana], write: () => response({ result: 'already', founder: ana }) });
  await flush();
  await d.grant('ana@example.test');
  assert.equal(d.node('adminFounderStatus').textContent, 'Ana Quispe ya tiene el badge Founder.');
});

test('every refusal reads as the desk’s own message, and an email that is not one is never sent', async () => {
  const CASES = [
    [400, { code: 'founder_email_invalid', error: 'email is invalid' }, 'Escribe un correo válido.'],
    [404, { code: 'founder_not_found', error: 'no account' }, 'Ninguna cuenta de Nodal usa ese correo. Pregunta al miembro qué correo usa su cuenta.'],
    [409, { code: 'founder_account_conflict', error: 'several profiles' }, 'Más de una cuenta coincide con ese correo. Avisa al desarrollador.'],
    [403, { error: 'Forbidden' }, 'No se pudo guardar. Inténtalo de nuevo.'],
    [429, { error: 'Too many requests' }, 'No se pudo guardar. Inténtalo de nuevo.'],
    [503, { code: 'founder_unavailable', error: 'provider down' }, 'No se pudo guardar. Inténtalo de nuevo.'],
    [200, { result: 'something else' }, 'No se pudo guardar. Inténtalo de nuevo.'],
  ];
  for (const [status, payload, message] of CASES) {
    const d = desk({ lang: 'es', write: () => response(payload, status) });
    await flush();
    await d.grant('ana@example.test');
    assert.equal(d.node('adminFounderStatus').textContent, message, String(status));
    assert.doesNotMatch(d.shown(), /invalid|no account|several|Forbidden|Too many|provider|something/);
    assert.equal(d.node('adminFounderEmail').value, 'ana@example.test', `${status}: the email stays to correct or retry`);
    assert.deepEqual(d.founderRequests().map((r) => r.method), ['GET', 'POST'], `${status}: nothing changed, so the list is not read again`);
  }
  const offline = desk({ write: () => Promise.reject(new TypeError('Failed to fetch')) });
  await flush();
  await offline.grant('ana@example.test');
  assert.equal(offline.node('adminFounderStatus').textContent, 'Could not save. Try again.');
  for (const email of ['', '   ', 'ana', 'ana@', 'ana @example.test', `${'a'.repeat(250)}@x.io`]) {
    const d = desk();
    await flush();
    await d.grant(email);
    assert.equal(d.node('adminFounderStatus').textContent, 'Enter a valid email.', JSON.stringify(email));
    assert.equal(d.node('adminFounderEmail')['aria-invalid'], 'true');
    assert.equal(d.founderRequests().filter((r) => r.method === 'POST').length, 0, 'no request for an email that is not one');
  }
});

test('a second click while the badge is being given sends one request', async () => {
  let release;
  const d = desk({ write: () => new Promise((resolve) => { release = () => resolve(response({ result: 'granted', founder: ana }, 201)); }) });
  await flush();
  d.node('adminFounderEmail').value = 'ana@example.test';
  const submit = d.node('adminFounderForm').listeners.get('submit');
  const first = submit({ preventDefault() {} });
  await flush();
  assert.equal(d.node('adminFounderGrant').disabled, true);
  assert.equal(d.node('adminFounderForm')['aria-busy'], 'true');
  await submit({ preventDefault() {} });
  assert.equal(d.founderRequests().filter((r) => r.method === 'POST').length, 1);
  release();
  await first;
  await flush();
  assert.equal(d.node('adminFounderGrant').disabled, false);
  assert.equal(d.node('adminFounderForm')['aria-busy'], 'false');
});

test('removing a badge asks first, says the badge is meant to stay, then deletes it and refreshes the list', async () => {
  let founders = [ana, beto], answer = false;
  const d = desk({
    list: () => response({ founders }),
    confirm: () => answer,
    write: (method, url) => {
      assert.equal(method, 'DELETE');
      assert.equal(url, `/api/admin/membership/founders/${ana.id}`);
      founders = [beto];
      return response({ result: 'removed' });
    },
  });
  await flush();
  const remove = d.removeButton(d.rows()[0]);
  await remove.listeners.get('click')();
  assert.deepEqual(d.confirms, ['Remove the Founder badge from Ana Quispe? Do this only to correct a mistake: the badge is meant to stay.']);
  assert.equal(d.founderRequests().filter((r) => r.method === 'DELETE').length, 0, 'cancelled: nothing is sent');
  assert.equal(d.rows().length, 2);
  answer = true;
  await remove.listeners.get('click')();
  await flush();
  const del = d.founderRequests().find((r) => r.method === 'DELETE');
  assert.equal(del.credentials, 'same-origin');
  assert.equal(d.node('adminFounderStatus').textContent, 'Badge removed from Ana Quispe.');
  assert.equal(d.rows().length, 1);
  assert.equal(d.node('adminFounderListTitle').textContent, 'Members with the badge (1)');
  assert.deepEqual(d.founderRequests().map((r) => r.method), ['GET', 'DELETE', 'GET']);
  const es = desk({ lang: 'es', founders: [ana], confirm: () => false });
  await flush();
  await es.removeButton(es.rows()[0]).listeners.get('click')();
  assert.deepEqual(es.confirms, ['¿Quitar el badge Founder a Ana Quispe? Hazlo solo para corregir un error: el badge está pensado para quedarse.']);
});

test('a badge that is already gone, or a removal that fails, says so without the server’s words', async () => {
  let founders = [ana];
  const gone = desk({ lang: 'pt', list: () => response({ founders }), write: () => { founders = []; return response({ code: 'founder_not_found', error: 'founder not found' }, 404); } });
  await flush();
  await gone.removeButton(gone.rows()[0]).listeners.get('click')();
  await flush();
  assert.equal(gone.node('adminFounderStatus').textContent, 'Ana Quispe não tem mais o badge Founder.');
  assert.equal(gone.rows().length, 0, 'the list is read again');
  assert.equal(gone.node('adminFounderListStatus').textContent, 'Ninguém tem o badge Founder ainda.');
  for (const status of [403, 429, 503]) {
    const failed = desk({ founders: [ana], write: () => response({ error: 'server words' }, status) });
    await flush();
    await failed.removeButton(failed.rows()[0]).listeners.get('click')();
    await flush();
    assert.equal(failed.node('adminFounderStatus').textContent, 'Could not save. Try again.', String(status));
    assert.equal(failed.rows().length, 1, `${status}: the member still has the badge`);
    assert.doesNotMatch(failed.shown(), /server words/);
  }
});

test('a member without a name is listed and named by their email', async () => {
  const d = desk({ founders: [{ ...ana, name: '' }], confirm: () => false });
  await flush();
  assert.match(rendered(d.rows()[0]), /^ana@example\.test ana@example\.test since/);
  await d.removeButton(d.rows()[0]).listeners.get('click')();
  assert.match(d.confirms[0], /^Remove the Founder badge from ana@example\.test\?/);
});

test('the band follows the desk’s sheet: whitespace between members, no left bars, no uppercase eyebrows', () => {
  const css = read('web', 'styles', 'admin.css');
  const band = css.slice(css.indexOf('/* ---------- Membresía Fundador'), css.indexOf('@media (max-width: 1180px)'));
  assert.ok(band.length > 200, 'the band has its own block');
  assert.doesNotMatch(band, /border-left|border-top|border-bottom/, 'members are separated by whitespace, not rules');
  assert.doesNotMatch(band, /text-transform|box-shadow/);
  assert.match(band, /\.admin-founder-list:empty\s*\{\s*display:\s*none;/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.admin-founder\b[^{]*\{[^}]*grid-template-columns:\s*1fr/);
});
