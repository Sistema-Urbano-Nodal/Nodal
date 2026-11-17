import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const script = () => read('web', 'scripts', 'admin-nav.js');
// The spec's markup, byte for byte (R3: four links).
const BAR = '<nav class="staff-nav" data-staff-nav aria-label="Administration"><a href="admin-home.html" data-staff="home">Metrics</a><a href="admin.html" data-staff="desk">Publishing</a><a href="fiiu-admin.html" data-staff="festival">Festival</a><a href="teaching.html" data-staff="courses">Courses</a><button type="button" data-staff="signOut">Sign out</button><span role="status" aria-live="polite" data-staff-status></span></nav>';
const WORDS = {
  en: [['Publishing', 'Festival', 'Courses', 'Sign out'], 'Administration', 'Signing out…', 'Sign out failed.', 'Metrics'],
  es: [['Publicación', 'Festival', 'Cursos', 'Cerrar sesión'], 'Administración', 'Cerrando sesión…', 'No se pudo cerrar la sesión.', 'Indicadores'],
  pt: [['Publicação', 'Festival', 'Cursos', 'Sair'], 'Administração', 'Saindo…', 'Não foi possível sair.', 'Indicadores'],
};

// The bar as fake elements, admin-nav.js run in a vm, and optionally the real i18n.js after it in the same context.
// unsaved stands for the tool's window.nodalUnsaved (left out: a page without one, like admin-home.html); confirm answers the browser's dialog.
function mount({ bar = BAR, lang = 'en', fetch = async () => ({ ok: true, status: 200 }), removeItem = null, withI18n = false, unsaved, confirm = () => true } = {}) {
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
  const asked = [];
  const document = {
    body: { dataset: {} }, documentElement: { lang, dataset: {} },
    querySelector: (selector) => (selector === '[data-staff-nav]' ? nav : null),
    querySelectorAll: () => [],
    addEventListener(name, fn, options) { if (name === 'DOMContentLoaded') ready.push({ fn, options }); },
  };
  const context = { URLSearchParams, document, console, fetch,
    localStorage: { getItem: () => lang, setItem() {}, removeItem: removeItem || ((key) => { removed.push(key); }) },
    location: { search: '', assigned: '', assign(value) { this.assigned = value; } },
    confirm: (message) => { asked.push(message); return confirm(message); } };
  if (unsaved) context.nodalUnsaved = unsaved;
  context.window = context;
  vm.runInNewContext(script(), context, { filename: 'admin-nav.js' });
  if (withI18n) vm.runInNewContext(read('web', 'scripts', 'i18n.js'), context, { filename: 'i18n.js' });
  const by = (key) => children.find((child) => child.dataset.staff === key);
  return { context, nav, ready, removed, asked, by, location: context.location,
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
  const bar = BAR.replace('<a href="admin.html"', '<a href="x.html" data-staff="later">Later</a><a href="admin.html"');
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
  assert.deepEqual(h.asked, [], 'nothing unsaved, nothing asked');
  // The tool's own leave prompt stays quiet from here: the session is closed, so "Stay" could save nothing (Review Focus 6).
  assert.equal(h.context.nodalSignedOut, true);
  assert.equal(h.by('signOut').disabled, true);
  assert.equal(h.status(), 'Cerrando sesión…');
});

test('with unsaved work the bar asks before the session closes, and Cancel keeps the session and the button', async () => {
  for (const [lang, question] of [['en', 'Sign out and discard your unsaved changes?'], ['es', '¿Cerrar sesión y descartar los cambios sin guardar?'], ['pt', 'Sair e descartar as alterações não salvas?']]) {
    let calls = 0;
    const h = mount({ lang, unsaved: () => true, confirm: () => false, fetch: async () => { calls += 1; return { ok: true, status: 200 }; } });
    await h.press();
    assert.deepEqual(h.asked, [question], lang);
    assert.equal(calls, 0, `${lang}: no logout request`);
    assert.equal(h.by('signOut').disabled, false);
    assert.equal(h.status(), '');
    assert.equal(h.location.assigned, '');
    assert.deepEqual(h.removed, [], 'the staff marker stays');
    assert.equal(h.context.nodalSignedOut, undefined, 'the tool still guards its work when the person leaves another way');
  }
});

test('with unsaved work and the person agreeing, the bar signs out once and the tool asks nothing more', async () => {
  const calls = [];
  const h = mount({ unsaved: () => true, fetch: async (url) => { calls.push(url); return { ok: true, status: 200 }; } });
  await h.press();
  assert.deepEqual(h.asked, ['Sign out and discard your unsaved changes?']);
  assert.deepEqual(calls, ['/api/auth/logout']);
  assert.equal(h.location.assigned, '/login.html');
  assert.equal(h.context.nodalSignedOut, true);
});

test('a tool that reports nothing unsaved, or a page with no hook (admin-home.html), signs out without a question', async () => {
  for (const unsaved of [() => false, undefined]) {
    const h = mount({ unsaved, confirm: () => false });
    await h.press();
    assert.deepEqual(h.asked, []);
    assert.equal(h.location.assigned, '/login.html');
  }
});

test('a refused sign-out after the question leaves the tool guarding its work, and a hook that fails is asked about', async () => {
  const refused = mount({ unsaved: () => true, fetch: async () => ({ ok: false, status: 500 }) });
  await refused.press();
  assert.equal(refused.asked.length, 1);
  assert.equal(refused.context.nodalSignedOut, undefined);
  assert.equal(refused.by('signOut').disabled, false);
  assert.equal(refused.status(), 'Sign out failed.');
  const broken = mount({ unsaved: () => { throw new TypeError('not ready'); }, confirm: () => false });
  await broken.press();
  assert.equal(broken.asked.length, 1, 'asked rather than signed out silently');
  assert.equal(broken.location.assigned, '');
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

test('admin-nav.css is scoped to the bar, self-contained, wraps and never sticks or folds', () => {
  const css = read('web', 'styles', 'admin-nav.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...css.replace(/@media[^{]*\{/g, '').matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(',')).map((s) => s.trim());
  assert.ok(selectors.length >= 9);
  for (const selector of selectors) assert.match(selector, /\.staff-nav\b/, selector);
  // Not sticky (the offsets at admin.css:24 and fiiu.css:74 hold), nothing clipped, no borrowed variable, no accent bar.
  assert.doesNotMatch(css, /position\s*:|overflow|nowrap/);
  assert.doesNotMatch(css, /border-left|box-shadow|@import|url\(|!important|var\(--(?!staff-gutter\))/);
  assert.match(css, /\.staff-nav\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/);
  assert.match(css, /\.staff-nav\s*\{[^}]*font:\s*500 \.9375rem\/1\.4 Montserrat, sans-serif;/);
  assert.match(css, /\.staff-nav\s*\{[^}]*--staff-gutter:\s*clamp\(20px, 4vw, 56px\);/);
  assert.match(css, /\.pilot-page \.staff-nav\s*\{\s*--staff-gutter:\s*max\(28px, calc\(\(100vw - 1320px\) \/ 2\)\);\s*\}/);
  assert.match(css, /@media \(max-width: 760px\)\s*\{\s*\.pilot-page \.staff-nav\s*\{\s*--staff-gutter:\s*20px;\s*\}\s*\}/);
  assert.match(css, /\.staff-nav a,\s*\.staff-nav button\s*\{[^}]*min-width:\s*44px;\s*min-height:\s*44px;[^}]*border:\s*0;[^}]*background:\s*none;[^}]*font:\s*inherit;/);
  assert.match(css, /\.staff-nav a\[aria-current="page"\]\s*\{\s*font-weight:\s*700;\s*text-decoration:\s*underline;\s*text-decoration-thickness:\s*1px;/);
  assert.match(css, /\.staff-nav button\s*\{\s*margin-left:\s*auto;\s*justify-content:\s*flex-end;\s*\}/);
  assert.match(css, /\.staff-nav :focus-visible\s*\{\s*outline:\s*2px solid #286998;/);
  assert.match(css, /\.staff-nav \[data-staff-status\]:empty\s*\{\s*padding-bottom:\s*0;\s*\}/);
  assert.doesNotMatch(css, /display:\s*none|visibility\s*:/, 'nothing is hidden: the bar never folds and the status line stays a rendered live region');
});

test('admin-nav.css is served, built and cached like the desk stylesheet', () => {
  const serverSource = read('server', 'server.js');
  const buildSource = read('scripts', 'build-static.js');
  const vercel = JSON.parse(read('vercel.json'));
  const list = (source, name) => source.match(new RegExp(`const ${name} = (?:new Set\\()?\\[([^\\]]*)\\]`))?.[1] || '';
  const merged = (url) => Object.fromEntries(vercel.headers.filter((r) => new RegExp(`^${r.source}$`).test(url)).flatMap((r) => r.headers.map(({ key, value }) => [key, value])));
  assert.ok(list(serverSource, 'STATIC_STYLES').includes("'admin-nav.css'"));
  assert.ok(list(buildSource, 'STATIC_STYLES').includes("'admin-nav.css'"));
  assert.deepEqual(merged('/admin-nav.css'), merged('/admin.css'));
});

const STAFF_PAGES = { 'admin-home.html': 'home', 'admin.html': 'desk', 'fiiu-admin.html': 'festival', 'teaching.html': 'courses' };
const page = (name) => read('web', 'pages', name);

test('the bar has four links in order, and the real dictionary names the first Metrics or Indicadores', () => {
  const keys = [...BAR.matchAll(/data-staff="([A-Za-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['home', 'desk', 'festival', 'courses', 'signOut']);
  for (const [lang, word] of [['es', 'Indicadores'], ['en', 'Metrics'], ['pt', 'Indicadores']]) {
    const h = mount({ lang: 'en', withI18n: true });
    h.ready[0].fn();
    h.context.nodalI18n.apply(lang);
    assert.equal(h.by('home').textContent, word, lang);
  }
});

test('the bar is the same on every staff page but for aria-current, and is the element just before <main>', () => {
  assert.doesNotMatch(BAR, /<li\b|data-i18n|\bid=/);
  for (const [name, own] of Object.entries(STAFF_PAGES)) {
    const html = page(name);
    const bars = html.match(/<nav class="staff-nav"[\s\S]*?<\/nav>/g) || [];
    assert.equal(bars.length, 1, name);
    assert.equal(bars[0].replace(` data-staff="${own}" aria-current="page"`, ` data-staff="${own}"`), BAR, name);
    assert.equal((bars[0].match(/aria-current/g) || []).length, 1, name);
    const at = html.indexOf(bars[0]);
    assert.match(html.slice(at + bars[0].length), /^\s*<main\b/, `${name}: <main> follows the bar`);
    const before = name === 'teaching.html'
      ? /<div class="pilot-notice" data-pilot-banner hidden>[\s\S]*?<\/div>\s*$/
      : /<\/header>\s*$/;
    assert.match(html.slice(0, at), before, `${name}: what the bar follows`);
  }
  // The pilot banner keeps its place (tests/page-loading.test.js:107) and the public header its first link (tests/fiiu-ui.test.js:939-946).
  assert.match(page('teaching.html'), /<\/header>\s*<div class="pilot-notice" data-pilot-banner/);
});

test('each staff page loads admin-nav.js deferred before the dictionaries and admin-nav.css last', () => {
  for (const name of Object.keys(STAFF_PAGES)) {
    const html = page(name);
    const head = html.slice(0, html.indexOf('</head>'));
    assert.match(head, /<script defer src="admin-nav\.js\?v=20261114a"><\/script>/, name);
    const scripts = [...head.matchAll(/<script\b[^>]*\bsrc="([^"?]+)/g)].map((m) => m[1]);
    const next = name === 'admin.html' ? 'i18n-dashboard.js' : name === 'admin-home.html' ? 'admin-home.js' : 'i18n.js';
    assert.equal(scripts[scripts.indexOf('admin-nav.js') + 1], next, `${name}: directly before ${next}`);
    assert.ok(scripts.indexOf('admin-nav.js') < scripts.indexOf('i18n.js'), name);
    const sheets = [...head.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(sheets.at(-1), 'admin-nav.css?v=20261114a', name);
  }
});

test('the door-screen list has no bar', () => {
  assert.doesNotMatch(page('fiiu-qr.html'), /staff-nav|admin-nav\.(?:js|css)/);
});
