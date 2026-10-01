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
async function consoleFor(me) {
  const source = read('web', 'scripts', 'dashboard.js');
  const start = source.indexOf('  async function init() {');
  const end = source.indexOf('  init();', start);
  assert.ok(start > 0 && end > start, 'dashboard init must stay discoverable');
  const link = { id: 'publishLink', hidden: true };
  const context = {
    api: async (url) => { assert.equal(url, '/api/auth/me'); return me(); },
    byId: (id) => (id === 'publishLink' ? link : null),
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
