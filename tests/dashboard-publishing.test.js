import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');

function loadI18n(lang) {
  const context = {
    document: { body: { dataset: { page: 'dashboard' } }, documentElement: {}, querySelectorAll: () => [] },
    window: { location: { search: '' } },
    localStorage: { getItem() { return null; }, setItem() {} },
    URLSearchParams,
    console,
  };
  // As dashboard.html loads them: the console's own strings, then i18n.js.
  vm.runInNewContext(read('web', 'scripts', 'i18n-dashboard.js'), context);
  vm.runInNewContext(read('web', 'scripts', 'i18n.js'), context);
  context.window.nodalI18n.apply(lang);
  return context.window.nodalI18n;
}

// Runs the console's init() against a stubbed /api/auth/me; everything else it calls is a no-op.
async function consoleFor(me, nodes = {}) {
  const source = read('web', 'scripts', 'dashboard.js');
  const start = source.indexOf('  async function init() {');
  const end = source.indexOf('  init();', start);
  assert.ok(start > 0 && end > start, 'dashboard init must stay discoverable');
  const link = { id: 'publishLink', hidden: true };
  const label = { id: 'staffLabel', hidden: true };
  const staff = { publishLink: link, staffLabel: label };
  const context = {
    api: async (url) => { assert.equal(url, '/api/auth/me'); return me(); },
    byId: (id) => staff[id] ?? nodes[id] ?? null,
    t: (key) => `t:${key}`,
    normalizeApiUser: (user) => ({ city: 'Lima', role: 'Planner', topics: ['mobility'], notifRead: false, ...user }),
    applyAll() {},
    openUserDialog() {},
    state: {},
    window: {},
  };
  // init() asks partADone() whether to prompt for the profile; that line is cut from the same file.
  const partA = source.match(/^ {2}const partADone = .*$/m)[0];
  vm.runInNewContext(`let U, confirmedCity;\n${partA}\n${source.slice(start, end)}\nglobalThis.done = init();`, context, { filename: 'dashboard-init.js' });
  await context.done;
  // Both halves of the staff group move together; a test that reads `.hidden` reads the link.
  assert.equal(label.hidden, link.hidden, 'the Team label shows exactly when the link does');
  return link;
}

class Node {
  constructor(id = '') { this.id = id; this.dataset = {}; this.children = []; this.listeners = {}; this.attributes = {}; this.classList = { toggle() {}, add() {}, remove() {}, contains: () => false }; this.hidden = false; this.disabled = false; this.textContent = ''; this.value = ''; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  matches(selector) { return selector[0] === '[' && this.dataset[selector.slice(6, -1).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] !== undefined; }
  querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

// The whole console (i18n.js + dashboard.js) on the markup's own placeholders, with /api/auth/me scripted.
const LIVE_IDS = ['greetWord', 'userName', 'greetSub', 'loadRetry', 'sheetRole', 'userBtn', 'searchInput', 'notifBtn', 'userDialog', 'partCDialog'];
function liveConsole({ lang = 'es', replies }) {
  const html = read('web', 'pages', 'dashboard.html');
  const nodes = LIVE_IDS.map((id) => {
    const node = new Node(id);
    const [tag, text] = html.match(new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>([^<]*)`));
    node.textContent = text;
    for (const [, name, value] of tag.matchAll(/\s(data-i18n(?:-aria-label)?|aria-label|hidden)(?:="([^"]*)")?/g)) {
      if (name === 'data-i18n') node.dataset.i18n = value;
      else if (name === 'data-i18n-aria-label') node.dataset.i18nAriaLabel = value;
      else if (name === 'aria-label') node.setAttribute('aria-label', value);
      else node.hidden = true;
    }
    return node;
  });
  const body = new Node('body');
  body.append(...nodes);
  const requests = [];
  const location = { href: 'https://nodal.test/dashboard.html', pathname: '/dashboard.html', search: '', hash: '', assign(value) { this.assigned = value; } };
  const document = {
    body, documentElement: {}, addEventListener() {},
    querySelectorAll: (selector) => body.querySelectorAll(selector), querySelector: (selector) => body.querySelector(selector),
    getElementById: (id) => nodes.find((node) => node.id === id) ?? null, createElement: (tag) => new Node(tag),
  };
  const history = { state: null, replaceState() {} };
  const context = {
    document, location, history, URL, URLSearchParams, console, setTimeout, clearTimeout,
    localStorage: { getItem: () => lang, setItem() {} },
    fetch: async (url) => {
      requests.push(url);
      const reply = replies.shift();
      return { ok: reply.status === undefined, status: reply.status || 200, json: async () => reply };
    },
  };
  context.window = { location, history, addEventListener() {}, matchMedia: () => ({ matches: true }) };
  vm.createContext(context);
  vm.runInContext(read('web', 'scripts', 'i18n-dashboard.js'), context);
  vm.runInContext(read('web', 'scripts', 'i18n.js'), context);
  vm.runInContext(read('web', 'scripts', 'dashboard.js'), context);
  return { node: (id) => document.getElementById(id), requests, location, i18n: context.window.nodalI18n };
}
const member = { user: { id: 'member', fullName: 'Ana Quispe', title: 'Member', city: 'Lima', topics: [{ name: 'Mobility', level: 1 }], partC: {} } };

test('the console shows the staff group (Team label and admin link) to admins only', async () => {
  assert.equal((await consoleFor(async () => ({ user: { id: 'a', permission: 'admin' } }))).hidden, false);
  assert.equal((await consoleFor(async () => ({ user: { id: 'm', permission: 'member' } }))).hidden, true);
  assert.equal((await consoleFor(async () => ({ user: { id: 'x' } }))).hidden, true, 'a user without a permission is a member');
  assert.equal((await consoleFor(async () => ({ user: { id: 'r', role: 'admin' } }))).hidden, true, 'the job title field is not a permission');
  assert.equal((await consoleFor(async () => { throw new Error('api 500'); })).hidden, true, 'a failed session read keeps the link hidden');
});

test('the staff group opens the rail, hidden until dashboard.js reveals it', () => {
  const html = read('web', 'pages', 'dashboard.html');
  const nav = html.slice(html.indexOf('<nav class="side-nav"'), html.indexOf('</nav>', html.indexOf('<nav class="side-nav"')));
  // First in the rail (and so the first chip of the phone's sideways row), the label before the link, then General.
  assert.match(nav, /^<nav class="side-nav"[^>]*>\s*<p class="side-label" id="staffLabel" data-i18n="d\.nav\.team" hidden>Team<\/p>\s*<a class="side-link side-link-staff" href="admin-home\.html" id="publishLink" hidden>\s*<svg viewBox="0 0 24 24" aria-hidden="true">([\s\S]*?)<\/svg>\s*<span data-i18n="d\.nav\.publish">Metrics and tools<\/span><\/a>\s*<p class="side-label" data-i18n="d\.nav\.general">/);
  assert.equal(html.match(/href="admin-home\.html"/g).length, 1, 'one way in: the old link under Tools is gone');
  const icon = nav.match(/id="publishLink" hidden>\s*<svg[^>]*>([\s\S]*?)<\/svg>/)[1];
  assert.doesNotMatch(icon, /M4 20V10M12 20V4M20 20v-7/, 'the bar icon belongs to Community paths');
  const css = read('web', 'styles', 'dashboard.css');
  // .side-link sets display:flex, which would override the hidden attribute without this rule; the label gets one too.
  assert.match(css, /\.side-link\[hidden\][^{]*\{\s*display:\s*none;?\s*\}/);
  assert.match(css, /\.side-label\[hidden\][^{]*\{\s*display:\s*none;?\s*\}/);
  // A member's rail starts at General: it keeps the first group's spacing when the staff group is hidden.
  assert.match(css, /\.side-nav > \.side-label:first-child,\s*\.side-nav > \.side-link\[hidden\] \+ \.side-label\s*\{\s*border-top: 0; margin-top: 0; padding-top: 4px;\s*\}/);
  const staff = css.match(/\.side-link\.side-link-staff\s*\{([^}]*)\}/);
  assert.ok(staff, 'the staff link has its own look');
  assert.match(staff[1], /background:\s*var\(--beige\)/);
  assert.match(staff[1], /border-color:\s*var\(--beige\)/);
  assert.match(staff[1], /color:\s*var\(--forest\)/);
  assert.match(css, /\.side-link\.side-link-staff:hover\s*\{[^}]*background:\s*var\(--pastel\)[^}]*color:\s*var\(--forest\)/);
  // The phone row draws rail focus rings white, which would vanish on beige.
  const phoneStart = css.indexOf('The rail: the wordmark'), phoneEnd = css.indexOf('/* A narrow window with a mouse');
  assert.ok(phoneStart > 0 && phoneEnd > phoneStart, "the phone rail block must stay discoverable");
  const phone = css.slice(phoneStart, phoneEnd);
  assert.match(phone, /\.side \.side-link\.side-link-staff:focus-visible\s*\{\s*outline-color:\s*var\(--forest\);?\s*\}/);
  const js = read('web', 'scripts', 'dashboard.js');
  assert.match(js, /publish\.hidden = data\.user\?\.permission !== 'admin'/);
  assert.match(js, /staffLabel\.hidden = publish\.hidden/);
});

test('the staff group, its link and the news heading read in each language', () => {
  const expected = {
    en: ['Team', 'Metrics and tools', 'NODAL news'],
    es: ['Equipo', 'Indicadores y gestión', 'Noticias NODAL'],
    pt: ['Equipe', 'Indicadores e gestão', 'Notícias NODAL'],
  };
  for (const [lang, [team, link, news]] of Object.entries(expected)) {
    const i18n = loadI18n(lang);
    assert.equal(i18n.t('d.nav.team'), team, lang);
    assert.equal(i18n.t('d.nav.publish'), link, lang);
    assert.equal(i18n.t('news.title'), news, lang);
  }
});

test('a failed session read says so and offers a retry; a 401 stays quiet while it redirects', async () => {
  const note = { dataset: { i18n: 'd.greet.loading' }, textContent: 'Your node is loading.' };
  const retry = { hidden: true, addEventListener() {} };
  await consoleFor(async () => { throw new Error('api 503'); }, { greetSub: note, loadRetry: retry });
  assert.equal(note.textContent, 't:d.load.failed');
  assert.equal(note.dataset.i18n, 'd.load.failed', 'a language switch must re-translate the failure, not restore the loading line');
  assert.equal(retry.hidden, false);

  const quietNote = { dataset: { i18n: 'd.greet.loading' }, textContent: 'Your node is loading.' };
  const quietRetry = { hidden: true, addEventListener() {} };
  await consoleFor(async () => { throw new Error('authentication required'); }, { greetSub: quietNote, loadRetry: quietRetry });
  assert.equal(quietNote.textContent, 'Your node is loading.');
  assert.equal(quietRetry.hidden, true);

  const shown = { hidden: false, addEventListener() {} };
  await consoleFor(async () => ({ user: { id: 'm' } }), { loadRetry: shown });
  assert.equal(shown.hidden, true, 'a successful load hides the retry');
});

test('console placeholders, accessible names and the no-title role read in Spanish, and Try again reloads the member', async () => {
  const h = liveConsole({ replies: [{ status: 503 }, member] });
  assert.equal(h.node('greetWord').textContent, 'Hola');
  assert.equal(h.node('userName').textContent, 'Miembro de la comunidad');
  assert.equal(h.node('searchInput').getAttribute('aria-label'), 'Busca en la comunidad');
  assert.equal(h.node('notifBtn').getAttribute('aria-label'), 'Notificaciones');
  assert.equal(h.node('userBtn').getAttribute('aria-label'), 'Edita tu perfil');
  assert.equal(h.node('userDialog').getAttribute('aria-label'), 'Tu perfil');
  assert.equal(h.node('partCDialog').getAttribute('aria-label'), 'Parte C · profundidad del perfil');
  await flush();
  assert.equal(h.node('greetSub').textContent, 'No pudimos cargar tu panel. Revisa tu conexión e inténtalo de nuevo.');
  assert.equal(h.node('loadRetry').hidden, false);
  assert.equal(h.node('loadRetry').textContent, 'Intentar de nuevo');
  h.i18n.apply('pt');
  assert.equal(h.node('greetSub').textContent, 'Não conseguimos carregar seu painel. Confira sua conexão e tente de novo.');
  h.i18n.apply('es');

  h.node('loadRetry').listeners.click();
  assert.equal(h.node('loadRetry').disabled, true);
  assert.equal(h.node('greetSub').textContent, 'Cargando tu nodo…');
  await flush();
  assert.deepEqual(h.requests, ['/api/auth/me', '/api/auth/me']);
  assert.equal(h.node('loadRetry').hidden, true);
  assert.equal(h.node('loadRetry').disabled, false);
  assert.equal(h.node('userName').textContent, 'Ana Quispe');
  assert.equal(h.node('sheetRole').textContent, 'Miembro de la comunidad', "the server's 'Member' sentinel is shown translated");
  assert.equal(h.node('userBtn').title, 'Edita tu perfil');
  h.i18n.apply('pt');
  assert.equal(h.node('sheetRole').textContent, 'Membro da comunidade');
  assert.equal(h.node('userName').textContent, 'Ana Quispe', 'a language switch keeps the member, not the placeholder');
});

test('the retry button ships hidden and keeps the hidden attribute over .btn-green', () => {
  const html = read('web', 'pages', 'dashboard.html');
  assert.match(html, /<p id="greetSub" data-i18n="d\.greet\.loading">Your node is loading\.<\/p>\s*<button type="button" class="btn-green" id="loadRetry" data-i18n="d\.save\.retry" hidden>Try again<\/button>/);
  assert.doesNotMatch(html, /id="userBtn"[^>]*\btitle=/, 'dashboard.js sets the tooltip in the member\'s language');
  assert.match(read('web', 'styles', 'dashboard.css'), /#loadRetry\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
});

test('every console accessible name in the markup is translated, except the live completeness ring', () => {
  const html = read('web', 'pages', 'dashboard.html');
  const keys = [...html.matchAll(/data-i18n-aria-label="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(keys.length >= 11);
  const english = loadI18n('en');
  for (const lang of ['es', 'pt']) {
    const i18n = loadI18n(lang);
    for (const key of keys) assert.notEqual(i18n.t(key), english.t(key), `${key} must be translated in ${lang}`);
  }
  // dashboard.js writes the ring's label with the live percentage; everything else is static markup
  const untranslated = [...html.matchAll(/<[a-z]+\b[^>]*\baria-label="[^"]*"[^>]*>/g)].map((match) => match[0])
    .filter((tag) => !/data-i18n-aria-label=/.test(tag) && !/id="ringSvg"/.test(tag) && !/class="lang-btn/.test(tag));
  assert.deepEqual(untranslated, []);
});

test('on one column the festival block opens the work surface for registrants, follows the greeting otherwise, and goes back to the context column when wide', () => {
  const source = read('web', 'scripts', 'dashboard.js');
  const start = source.indexOf('(function placeFestival()');
  const iife = source.slice(start, source.indexOf('})();', start) + 5);
  const el = (id) => ({ id, parentElement: null, children: [], dataset: {},
    get previousElementSibling() { const s = this.parentElement?.children; return s ? s[s.indexOf(this) - 1] ?? null : null; },
    get nextElementSibling() { const s = this.parentElement?.children; return s ? s[s.indexOf(this) + 1] ?? null : null; },
    get firstChild() { return this.children[0] ?? null; },
    querySelector(selector) { return this.children.find((node) => `.${node.id}` === selector) ?? null; },
    insertBefore(node, ref) { node.remove(); node.parentElement = this; this.children.splice(ref ? this.children.indexOf(ref) : this.children.length, 0, node); },
    after(node) { this.parentElement.insertBefore(node, this.nextElementSibling); },
    before(node) { this.parentElement.insertBefore(node, this); },
    remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; } });
  const work = el('work'), overview = el('overview'), lede = el('lede'), spine = el('spine'), network = el('network'), inner = el('ctx-inner'), block = el('fiiuDashboard'), body = el('fiiuDashboardBody'), news = el('news');
  work.insertBefore(overview); work.insertBefore(network); overview.insertBefore(lede); overview.insertBefore(spine); inner.insertBefore(block); inner.insertBefore(news);
  const byId = (id) => [overview, block, body].find((node) => node.id === id) ?? null;
  const media = { matches: true, listener: null, addEventListener(type, fn) { this.listener = fn; } };
  const watched = [];
  class MutationObserver { constructor(fn) { this.fn = fn; } observe(target, options) { watched.push({ target, options, fn: this.fn }); } }
  const registered = (value) => { body.dataset.registered = value; for (const w of watched) if (w.target === body && w.options.attributeFilter.includes('data-registered')) w.fn([]); };
  vm.runInNewContext(iife, { byId, MutationObserver, window: { matchMedia: () => media } });
  // Under the greeting and the route the block started a screen and a half down on a phone. Until fiiu-hubs.js has read the
  // registration (and when that read fails) the block opens the work surface, where most members at the festival want it.
  assert.deepEqual(work.children.map((node) => node.id), ['fiiuDashboard', 'overview', 'network']);
  registered('true');
  assert.deepEqual(work.children.map((node) => node.id), ['fiiuDashboard', 'overview', 'network'], 'a registration keeps it first');
  // Without a registration it is an invitation: the greeting (the page h1) comes first, then the block, then the route.
  registered('false');
  assert.deepEqual(work.children.map((node) => node.id), ['overview', 'network']);
  assert.deepEqual(overview.children.map((node) => node.id), ['lede', 'fiiuDashboard', 'spine']);
  media.matches = false; media.listener();
  assert.deepEqual(inner.children.map((node) => node.id), ['fiiuDashboard', 'news'], 'wide screens get it back first in the context column');
  assert.deepEqual(overview.children.map((node) => node.id), ['lede', 'spine']);
  registered('true');
  assert.deepEqual(inner.children.map((node) => node.id), ['fiiuDashboard', 'news'], 'a wide screen keeps it in the context column whatever the registration');
  media.matches = true; media.listener();
  assert.equal(block.nextElementSibling, overview);
});
