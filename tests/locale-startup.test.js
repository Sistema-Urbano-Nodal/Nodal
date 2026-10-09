import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const script = name => {
  const file = new URL(`../web/scripts/${name}.js`, import.meta.url);
  return readFileSync(file, 'utf8');
};

function browser({ saved = 'pt', storage = new Map(saved ? [['nodal.lang', saved]] : []), cookie = '', search = '', blockedStorage = false, navigator, scripts = ['i18n', 'auth'] } = {}) {
  const events = new Map(), windowEvents = new Map();
  const html = { lang: 'en', dataset: {}, setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { if(key==='data-locale-pending')delete this.dataset.localePending; } };
  const title = { dataset: { i18n: 'a.signin' }, textContent: 'Sign in' };
  const buttons = ['en', 'es', 'pt'].map(lang => ({ dataset: { lang }, classList: { toggle() {} }, setAttribute() {}, addEventListener(name, fn) { this[name] = fn; } }));
  // A cookie jar: each write sets one name, reading returns them all.
  const jar = new Map(cookie.split(';').map(part => part.trim()).filter(Boolean).map(part => [part.slice(0, part.indexOf('=')), part.slice(part.indexOf('=') + 1)])), writes = [];
  const document = {
    documentElement: html, body: { dataset: {} }, readyState: 'loading',
    get cookie() { return [...jar].map(([name, value]) => `${name}=${value}`).join('; '); },
    set cookie(value) { writes.push(value); const pair = value.split(';')[0]; jar.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)); },
    addEventListener(name, fn) { events.set(name, [...(events.get(name) || []), fn]); },
    querySelectorAll(selector) {
      if (selector === 'script[src]') return scripts.map(name => ({ getAttribute: () => `${name}.js?v=test` }));
      if (selector === '.lang-btn') return buttons;
      return selector === '[data-i18n]' ? [title] : [];
    },
    querySelector() { return null; },
  };
  const location = new URL('https://nodal.test/login.html' + search);
  const context = {
    document, location, URL, URLSearchParams, console,
    localStorage: {
      getItem(key) { if (blockedStorage) throw new Error('storage denied'); return storage.get(key); },
      setItem(key, value) { if (blockedStorage) throw new Error('storage denied'); storage.set(key, value); },
    },
    window: { location, addEventListener(name, fn) { windowEvents.set(name, fn); } },
    ...(navigator ? { navigator } : {}),
  };
  vm.createContext(context);
  const run = name => {
    if (name !== 'locale') document.readyState = 'interactive';
    return vm.runInContext(script(name), context);
  };
  run('locale');
  return { context, document, html, title, storage, writes, run, click: lang => buttons.find(button => button.dataset.lang === lang).click(), fire: name => events.get(name)?.forEach(fn => fn()), restore: () => windowEvents.get('pageshow')?.({ persisted: true }), leave: () => windowEvents.get('pagehide')?.({ persisted: true }) };
}
const spanish = { languages: ['es-PE', 'es', 'en'], language: 'es-PE' }, english = { languages: ['en-US'], language: 'en-US' };

test('saved language is established before deferred translations and the English shell stays concealed until ready', () => {
  const h = browser();
  assert.equal(h.html.lang, 'pt');
  assert.equal(h.html.dataset.localePending, 'true');
  assert.equal(h.title.textContent, 'Sign in');
  h.run('i18n');
  assert.equal(h.title.textContent, 'Entrar');
  // Unrelated deferred application code has not finished yet.
  assert.equal(h.html.dataset.localePending, undefined);
});

test('course shell waits for its own translations but not the globe or application scripts', () => {
  const h = browser({ scripts: ['i18n', 'pilot-i18n', 'pilot', 'dashboard', 'coastline', 'globe'] });
  h.run('i18n');
  assert.equal(h.html.dataset.localePending, 'true');
  h.context.window.nodalLocale.ready('pilot');
  assert.equal(h.html.dataset.localePending, undefined);
});

test('login waits for recovery labels and invitation pages reveal after their translations', () => {
  const login = browser({ scripts: ['i18n', 'recovery-i18n', 'auth'] });
  login.run('i18n');
  assert.equal(login.html.dataset.localePending, 'true');
  login.run('recovery-i18n');
  assert.equal(login.html.dataset.localePending, undefined);
  const invitation = browser({ scripts: ['accept-invitation', 'invitation-i18n'] });
  invitation.run('invitation-i18n');
  assert.equal(invitation.html.dataset.localePending, undefined);
});

test('language persists through a cookie when local storage is unavailable', () => {
  const h = browser({ blockedStorage: true, cookie: 'nodal.lang=es', search: '?lang=pt' });
  h.run('i18n');
  assert.equal(h.context.window.nodalI18n.lang, 'es');
  h.context.window.nodalI18n.apply('pt');
  const next = browser({ blockedStorage: true, cookie: h.document.cookie });
  next.run('i18n');
  assert.equal(next.context.window.nodalI18n.lang, 'pt');
});

test('failed translation assets do not leave the page permanently concealed', () => {
  const h = browser();
  assert.equal(h.html.dataset.localePending, 'true');
  h.fire('DOMContentLoaded');
  assert.equal(h.html.dataset.localePending, undefined);
});

test('back-forward restoration uses the latest explicit choice and preserves unsaved form state', () => {
  const h = browser(); h.run('i18n'); h.fire('DOMContentLoaded');
  const draft = { value: 'Unsaved message' }; h.document.body.draft = draft;
  h.leave();
  assert.equal(h.html.dataset.localePending, 'true');
  h.storage.set('nodal.lang', 'es'); h.restore();
  assert.equal(h.html.lang, 'es');
  assert.equal(h.title.textContent, 'Iniciar sesión');
  assert.equal(h.document.body.draft, draft);
  assert.equal(draft.value, 'Unsaved message');
  assert.equal(h.html.dataset.localePending, undefined);
});

test('invitation pages share the saved preference even with unavailable local storage', () => {
  const h = browser({ blockedStorage: true, cookie: 'nodal.lang=pt', search: '?lang=es' });
  h.run('invitation-i18n');
  assert.equal(h.html.lang, 'pt');
  assert.equal(h.context.window.nodalInvitationI18n.t('fullName'), 'Nome completo');
});

test('invalid stored locale values cannot become page languages or cookies', () => {
  const h = browser({ saved: '__proto__', cookie: 'nodal.lang=constructor', search: '?lang=es' });
  h.run('i18n');
  assert.equal(h.html.lang, 'es');
  h.context.window.nodalI18n.apply('unsupported');
  assert.equal(h.html.lang, 'en');
  assert.match(h.document.cookie, /(?:^|; )nodal\.lang=en(?:;|$)/);
});

test('a first visit follows a Spanish browser without saving it as a choice', () => {
  const h = browser({ saved: null, navigator: spanish });
  assert.equal(h.html.lang, 'es');
  assert.equal(h.html.dataset.localePending, 'true');
  h.run('i18n');
  assert.equal(h.context.window.nodalI18n.lang, 'es');
  assert.equal(h.title.textContent, 'Iniciar sesión');
  assert.equal(h.html.dataset.localePending, undefined);
  assert.equal(h.context.window.nodalLocale.chosen(), null);
  assert.equal(h.storage.size, 0);
  assert.equal(h.document.cookie, '');
  h.leave(); h.restore();
  assert.equal(h.html.lang, 'es');
  assert.equal(h.storage.size, 0);
  assert.equal(h.document.cookie, '');
});

test('the first supported browser language is used, else English', () => {
  assert.equal(browser({ saved: null, navigator: { languages: ['fr-FR', 'pt-BR', 'es'] } }).html.lang, 'pt');
  assert.equal(browser({ saved: null, navigator: { languages: [], language: 'ES-419' } }).html.lang, 'es');
  assert.equal(browser({ saved: null, navigator: { languages: ['de-DE', 'fr'] } }).html.lang, 'en');
  assert.equal(browser({ saved: null, navigator: { get languages() { throw new Error('blocked'); } } }).html.lang, 'en');
  assert.equal(browser({ saved: null, navigator: spanish, search: '?lang=pt' }).html.lang, 'pt');
  assert.equal(browser({ saved: null }).html.lang, 'en');
});

test('a default visit leaves a later language link in charge, and the link is then remembered', () => {
  const first = browser({ saved: null });
  first.run('i18n');
  assert.equal(first.context.window.nodalI18n.lang, 'en');
  assert.equal(first.storage.size, 0);
  assert.equal(first.document.cookie, '');
  const link = browser({ storage: first.storage, cookie: first.document.cookie, search: '?lang=es' });
  link.run('i18n');
  assert.equal(link.context.window.nodalI18n.lang, 'es');
  assert.equal(link.storage.get('nodal.lang'), 'es');
  assert.equal(link.storage.get('nodal.lang.chosen'), '1');
  assert.equal(browser({ storage: link.storage, navigator: english }).html.lang, 'es');
});

test('an automatic English saved before choices were marked gives way to the browser language', () => {
  const legacy = () => new Map([['nodal.lang', 'en']]);
  const h = browser({ storage: legacy(), cookie: 'nodal.lang=en', navigator: spanish });
  h.run('i18n');
  assert.equal(h.context.window.nodalI18n.lang, 'es');
  assert.equal(h.storage.has('nodal.lang.chosen'), false);
  assert.equal(browser({ storage: legacy(), cookie: 'nodal.lang=en', navigator: english }).html.lang, 'en');
  assert.equal(browser({ storage: legacy() }).html.lang, 'en');
  assert.equal(browser({ storage: legacy(), search: '?lang=pt', navigator: english }).html.lang, 'pt');
  assert.equal(browser({ blockedStorage: true, cookie: 'nodal.lang=en', navigator: spanish }).html.lang, 'es');
});

test('real choices keep winning over the browser language and old links', () => {
  // Spanish and Portuguese were never saved automatically, so unmarked ones are choices.
  const pt = browser({ saved: 'pt', navigator: spanish, search: '?lang=es' });
  pt.run('i18n');
  assert.equal(pt.context.window.nodalI18n.lang, 'pt');
  assert.equal(pt.storage.get('nodal.lang.chosen'), '1');
  assert.equal(browser({ storage: new Map([['nodal.lang', 'en'], ['nodal.lang.chosen', '1']]), navigator: spanish, search: '?lang=es' }).html.lang, 'en');
  assert.equal(browser({ blockedStorage: true, cookie: 'nodal.lang.chosen=1; nodal.lang=en', navigator: spanish }).html.lang, 'en');
});

test('a language click is saved with the marker in storage and in both cookies', () => {
  const h = browser({ saved: null, navigator: spanish });
  h.run('i18n');
  h.click('en');
  assert.equal(h.context.window.nodalI18n.lang, 'en');
  assert.equal(h.html.lang, 'en');
  assert.equal(h.storage.get('nodal.lang'), 'en');
  assert.equal(h.storage.get('nodal.lang.chosen'), '1');
  assert.equal(h.document.cookie, 'nodal.lang.chosen=1; nodal.lang=en');
  assert.ok(h.writes.every(value => value.endsWith('; Path=/; Max-Age=31536000; SameSite=Lax; Secure')));
  assert.equal(browser({ storage: h.storage, navigator: spanish }).html.lang, 'en');
  assert.equal(browser({ blockedStorage: true, cookie: h.document.cookie, navigator: spanish }).html.lang, 'en');
});

test('restoring an invitation page in the browser language does not save it', () => {
  const h = browser({ saved: null, navigator: spanish, scripts: ['accept-invitation', 'invitation-i18n'] });
  h.run('invitation-i18n');
  assert.equal(h.html.lang, 'es');
  h.leave(); h.restore();
  assert.equal(h.html.lang, 'es');
  assert.equal(h.storage.size, 0);
  assert.equal(h.document.cookie, '');
  h.storage.set('nodal.lang', 'pt'); h.restore();
  assert.equal(h.html.lang, 'pt');
});
