import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const script = name => {
  const file = new URL(`../web/scripts/${name}.js`, import.meta.url);
  return readFileSync(file, 'utf8');
};

function browser({ saved = 'pt', cookie = '', search = '', blockedStorage = false, scripts = ['i18n', 'auth'] } = {}) {
  const storage = new Map(saved ? [['nodal.lang', saved]] : []);
  const events = new Map(), windowEvents = new Map();
  const html = { lang: 'en', dataset: {}, setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { if(key==='data-locale-pending')delete this.dataset.localePending; } };
  const title = { dataset: { i18n: 'a.signin' }, textContent: 'Sign in' };
  const document = {
    documentElement: html, body: { dataset: {} }, cookie, readyState: 'loading',
    addEventListener(name, fn) { events.set(name, [...(events.get(name) || []), fn]); },
    querySelectorAll(selector) {
      if (selector === 'script[src]') return scripts.map(name => ({ getAttribute: () => `${name}.js?v=test` }));
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
  };
  vm.createContext(context);
  const run = name => {
    if (name !== 'locale') document.readyState = 'interactive';
    return vm.runInContext(script(name), context);
  };
  run('locale');
  return { context, document, html, title, storage, run, fire: name => events.get(name)?.forEach(fn => fn()), restore: () => windowEvents.get('pageshow')?.({ persisted: true }), leave: () => windowEvents.get('pagehide')?.({ persisted: true }) };
}

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
  assert.match(h.document.cookie, /^nodal.lang=en;/);
});
