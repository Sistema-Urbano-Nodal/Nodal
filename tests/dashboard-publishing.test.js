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
  const context = {
    api: async (url) => { assert.equal(url, '/api/auth/me'); return me(); },
    byId: (id) => (id === 'publishLink' ? link : nodes[id] ?? null),
    t: (key) => `t:${key}`,
    normalizeApiUser: (user) => ({ city: 'Lima', role: 'Planner', topics: ['mobility'], notifRead: false, ...user }),
    applyAll() {},
    openUserDialog() {},
    state: {},
    window: {},
  };
  vm.runInNewContext(`let U, confirmedCity;\n${source.slice(start, end)}\nglobalThis.done = init();`, context, { filename: 'dashboard-init.js' });
  await context.done;
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
  vm.runInContext(read('web', 'scripts', 'i18n.js'), context);
  vm.runInContext(read('web', 'scripts', 'dashboard.js'), context);
  return { node: (id) => document.getElementById(id), requests, location, i18n: context.window.nodalI18n };
}
const member = { user: { id: 'member', fullName: 'Ana Quispe', title: 'Member', city: 'Lima', topics: [{ name: 'Mobility', level: 1 }], partC: {} } };

test('the console shows the Publishing link to admins only', async () => {
  assert.equal((await consoleFor(async () => ({ user: { id: 'a', permission: 'admin' } }))).hidden, false);
  assert.equal((await consoleFor(async () => ({ user: { id: 'm', permission: 'member' } }))).hidden, true);
  assert.equal((await consoleFor(async () => ({ user: { id: 'x' } }))).hidden, true, 'a user without a permission is a member');
  assert.equal((await consoleFor(async () => ({ user: { id: 'r', role: 'admin' } }))).hidden, true, 'the job title field is not a permission');
  assert.equal((await consoleFor(async () => { throw new Error('api 500'); })).hidden, true, 'a failed session read keeps the link hidden');
});

test('the Publishing link sits in the Tools rail, hidden until dashboard.js reveals it', () => {
  const html = read('web', 'pages', 'dashboard.html');
  const tools = html.slice(html.indexOf('data-i18n="d.nav.tools"'), html.indexOf('</nav>', html.indexOf('data-i18n="d.nav.tools"')));
  assert.match(tools, /<a class="side-link" href="admin\.html" id="publishLink" hidden>\s*<svg viewBox="0 0 24 24" aria-hidden="true">[\s\S]*?<\/svg>\s*<span data-i18n="d\.nav\.publish">Publishing<\/span><\/a>/);
  // .side-link sets display:flex, which would override the hidden attribute without this rule.
  assert.match(read('web', 'styles', 'dashboard.css'), /\.side-link\[hidden\][^{]*\{\s*display:\s*none;?\s*\}/);
  assert.match(read('web', 'scripts', 'dashboard.js'), /publish\.hidden = data\.user\?\.permission !== 'admin'/);
});

test('the Publishing link and the news heading read in Spanish and Portuguese', () => {
  const expected = { en: ['Publishing', 'NODAL news'], es: ['Publicar', 'Noticias NODAL'], pt: ['Publicar', 'Notícias NODAL'] };
  for (const [lang, [link, news]] of Object.entries(expected)) {
    const i18n = loadI18n(lang);
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

test('on one column the festival block moves under the greeting, and back to the context column when wide', () => {
  const source = read('web', 'scripts', 'dashboard.js');
  const start = source.indexOf('(function placeFestival()');
  const iife = source.slice(start, source.indexOf('})();', start) + 5);
  const el = (id) => ({ id, parentElement: null, children: [],
    get previousElementSibling() { const s = this.parentElement?.children; return s ? s[s.indexOf(this) - 1] ?? null : null; },
    get nextElementSibling() { const s = this.parentElement?.children; return s ? s[s.indexOf(this) + 1] ?? null : null; },
    get firstChild() { return this.children[0] ?? null; },
    insertBefore(node, ref) { node.remove(); node.parentElement = this; this.children.splice(ref ? this.children.indexOf(ref) : this.children.length, 0, node); },
    after(node) { this.parentElement.insertBefore(node, this.nextElementSibling); },
    remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; } });
  const work = el('work'), overview = el('overview'), network = el('network'), inner = el('ctx-inner'), block = el('fiiuDashboard'), news = el('news');
  work.insertBefore(overview); work.insertBefore(network); inner.insertBefore(block); inner.insertBefore(news);
  const byId = (id) => [overview, block].find((node) => node.id === id) ?? null;
  const media = { matches: true, listener: null, addEventListener(type, fn) { this.listener = fn; } };
  vm.runInNewContext(iife, { byId, window: { matchMedia: () => media } });
  assert.deepEqual(work.children.map((node) => node.id), ['overview', 'fiiuDashboard', 'network']);
  media.matches = false; media.listener();
  assert.deepEqual(inner.children.map((node) => node.id), ['fiiuDashboard', 'news'], 'wide screens get it back first in the context column');
  assert.deepEqual(work.children.map((node) => node.id), ['overview', 'network']);
  media.matches = true; media.listener();
  assert.equal(block.previousElementSibling, overview);
});
