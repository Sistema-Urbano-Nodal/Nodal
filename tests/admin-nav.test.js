import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const script = () => read('web', 'scripts', 'admin-nav.js');
// The spec's markup, byte for byte (R2: three links).
const BAR = '<nav class="staff-nav" data-staff-nav aria-label="Administration"><a href="admin.html" data-staff="desk">Publishing</a><a href="fiiu-admin.html" data-staff="festival">Festival</a><a href="teaching.html" data-staff="courses">Courses</a><button type="button" data-staff="signOut">Sign out</button><span role="status" aria-live="polite" data-staff-status></span></nav>';
const WORDS = {
  en: [['Publishing', 'Festival', 'Courses', 'Sign out'], 'Administration', 'Signing out…', 'Sign out failed.', 'Metrics'],
  es: [['Publicación', 'Festival', 'Cursos', 'Cerrar sesión'], 'Administración', 'Cerrando sesión…', 'No se pudo cerrar la sesión.', 'Indicadores'],
  pt: [['Publicação', 'Festival', 'Cursos', 'Sair'], 'Administração', 'Saindo…', 'Não foi possível sair.', 'Indicadores'],
};

// The bar as fake elements, admin-nav.js run in a vm, and optionally the real i18n.js after it in the same context.
function mount({ bar = BAR, lang = 'en', fetch = async () => ({ ok: true, status: 200 }), removeItem = null, withI18n = false } = {}) {
  const node = (tag, attributes, text) => {
    const attrs = Object.fromEntries([...attributes.matchAll(/([a-z-]+)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? '']));
    return { tag, attrs, textContent: text, disabled: false, listeners: new Map(),
      dataset: Object.fromEntries(Object.entries(attrs).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5).replace(/-(.)/g, (_, c) => c.toUpperCase()), v])),
      setAttribute(name, value) { this.attrs[name] = String(value); }, getAttribute(name) { return this.attrs[name] ?? null; },
      addEventListener(name, fn) { this.listeners.set(name, fn); } };
  };
  const children = [...bar.matchAll(/<(a|button|span)\b([^>]*)>([^<]*)<\/\1>/g)].map((m) => node(m[1], m[2], m[3]));
  const nav = bar ? Object.assign(node('nav', bar.match(/^<nav\b([^>]*)>/)[1], ''), {
    querySelectorAll: (selector) => (selector === '[data-staff]' ? children.filter((child) => 'staff' in child.dataset) : []),
    querySelector: (selector) => (selector === '[data-staff-status]' ? children.find((child) => 'staffStatus' in child.dataset) : null),
  }) : null;
  const ready = [];
  const removed = [];
  const document = {
    body: { dataset: {} }, documentElement: { lang, dataset: {} },
    querySelector: (selector) => (selector === '[data-staff-nav]' ? nav : null),
    querySelectorAll: () => [],
    addEventListener(name, fn, options) { if (name === 'DOMContentLoaded') ready.push({ fn, options }); },
  };
  const context = { URLSearchParams, document, console, fetch,
    localStorage: { getItem: () => lang, setItem() {}, removeItem: removeItem || ((key) => { removed.push(key); }) },
    location: { search: '', assigned: '', assign(value) { this.assigned = value; } } };
  context.window = context;
  vm.runInNewContext(script(), context, { filename: 'admin-nav.js' });
  if (withI18n) vm.runInNewContext(read('web', 'scripts', 'i18n.js'), context, { filename: 'i18n.js' });
  const by = (key) => children.find((child) => child.dataset.staff === key);
  return { context, nav, ready, removed, by, location: context.location,
    labels: () => ['desk', 'festival', 'courses', 'signOut'].map((key) => by(key).textContent),
    status: () => children.find((child) => 'staffStatus' in child.dataset).textContent,
    press: () => by('signOut').listeners.get('click')() };
}

test('paints the page language at evaluation, before i18n.js exists, and reads English for any other language', () => {
  for (const lang of ['en', 'es', 'pt', 'fr', '']) {
    const [labels, aria] = WORDS[lang] || WORDS.en;
    const h = mount({ lang });
    assert.deepEqual(h.labels(), labels, lang);
    assert.equal(h.nav.getAttribute('aria-label'), aria, lang);
    assert.equal(h.status(), '', 'the status line is empty until sign-out starts');
    assert.equal(h.context.nodalI18n, undefined);
  }
});

test('subscribes once the document is ready and follows the real i18n.js', () => {
  const h = mount({ lang: 'es', withI18n: true });
  assert.equal(h.ready.length, 1);
  assert.equal(h.ready[0].options?.once, true);
  h.context.nodalI18n.apply('pt');
  assert.deepEqual(h.labels(), WORDS.es[0], 'not subscribed before DOMContentLoaded');
  h.ready[0].fn();
  h.context.nodalI18n.apply('en');
  assert.deepEqual(h.labels(), WORDS.en[0]);
  assert.equal(h.nav.getAttribute('aria-label'), 'Administration');
  h.context.nodalI18n.apply('pt');
  assert.deepEqual(h.labels(), WORDS.pt[0]);
  assert.equal(h.nav.getAttribute('aria-label'), 'Administração');
});

test('already names the home link R3 adds, and leaves an unknown key alone', () => {
  const bar = BAR.replace('<a href="admin.html"', '<a href="admin-home.html" data-staff="home">Metrics</a><a href="x.html" data-staff="later">Later</a><a href="admin.html"');
  for (const lang of ['en', 'es', 'pt']) {
    const h = mount({ bar, lang });
    assert.equal(h.by('home').textContent, WORDS[lang][4], lang);
    assert.equal(h.by('later').textContent, 'Later');
  }
});

test('a page without the bar: the script does nothing', () => {
  const h = mount({ bar: '' });
  assert.equal(h.ready.length, 0);
});

test('sign-out POSTs, clears the staff marker and opens the sign-in page', async () => {
  const calls = [];
  let release;
  const h = mount({ lang: 'es', fetch: (url, options) => { calls.push([url, options]); return new Promise((resolve) => { release = resolve; }); } });
  const done = h.press();
  assert.equal(h.by('signOut').disabled, true);
  assert.equal(h.status(), 'Cerrando sesión…');
  assert.deepEqual(h.removed, [], 'the marker stays until the session is closed');
  release({ ok: true, status: 200 });
  await done;
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } }]]);
  assert.deepEqual(h.removed, ['nodal.staff']);
  assert.equal(h.location.assigned, '/login.html');
  // If a tool's leave prompt is answered "Stay", this is what remains on screen (Review Focus 6).
  assert.equal(h.by('signOut').disabled, true);
  assert.equal(h.status(), 'Cerrando sesión…');
});

test('a second press while signing out sends nothing', async () => {
  let count = 0;
  let release;
  const h = mount({ fetch: () => { count += 1; return new Promise((resolve) => { release = resolve; }); } });
  const first = h.press();
  const second = h.press();
  release({ ok: true, status: 200 });
  await Promise.all([first, second]);
  assert.equal(count, 1);
});

test('a refused or failed sign-out gives the button back and says so in the page language', async () => {
  for (const fetch of [async () => ({ ok: false, status: 403 }), async () => { throw new TypeError('offline'); }]) {
    const h = mount({ lang: 'pt', fetch, withI18n: true });
    h.ready[0].fn();
    await h.press();
    assert.equal(h.by('signOut').disabled, false);
    assert.equal(h.status(), 'Não foi possível sair.');
    assert.equal(h.location.assigned, '');
    assert.deepEqual(h.removed, []);
    h.context.nodalI18n.apply('en');
    assert.equal(h.status(), 'Sign out failed.', 'the line follows a language change');
    assert.deepEqual(h.labels(), WORDS.en[0]);
  }
});

test('a browser that refuses storage still signs out', async () => {
  const h = mount({ removeItem: () => { throw new Error('SecurityError'); } });
  await h.press();
  assert.equal(h.location.assigned, '/login.html');
});

test('admin-nav.js keeps its own labels and looks nothing up by id', () => {
  const js = script();
  assert.doesNotMatch(js, /\bt\(/, 'no function named t: deploy.test.js reads t(\'…\') as a dictionary key');
  assert.doesNotMatch(js, /['"`](?:d|p|y|ops)\./, 'no dictionary key');
  assert.doesNotMatch(js, /getElementById|\bbyId\(|querySelector\(\s*['"]#/);
  assert.doesNotMatch(js, /innerHTML|\.style\b|document\.cookie|sendBeacon/);
  assert.ok(js.length < 4000, 'about 60 lines');
});

test('admin-nav.js is served, built and cached like the desk script', () => {
  const serverSource = read('server', 'server.js');
  const buildSource = read('scripts', 'build-static.js');
  const vercel = JSON.parse(read('vercel.json'));
  const list = (source, name) => source.match(new RegExp(`const ${name} = (?:new Set\\()?\\[([^\\]]*)\\]`))?.[1] || '';
  const merged = (url) => Object.fromEntries(vercel.headers.filter((r) => new RegExp(`^${r.source}$`).test(url)).flatMap((r) => r.headers.map(({ key, value }) => [key, value])));
  assert.ok(existsSync(path.join(ROOT, 'web', 'scripts', 'admin-nav.js')));
  assert.ok(list(serverSource, 'STATIC_SCRIPTS').includes("'admin-nav.js'"));
  assert.ok(list(buildSource, 'STATIC_SCRIPTS').includes("'admin-nav.js'"));
  assert.deepEqual(merged('/admin-nav.js'), merged('/admin.js'));
});
