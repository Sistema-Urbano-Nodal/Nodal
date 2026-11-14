import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { VISIT_PAGES } from '../server/visits-api.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const SOURCE = read('web/scripts/visit.js');

function run({ pathname = '/index.html', search = '', host = 'nodal.example', referrer = '', staff = false, marker, webdriver = false, prerendering = false, throwStorage = false, fetchImpl } = {}) {
  const calls = [];
  const storage = new Map(marker === undefined ? [] : [['nodal.staff', marker]]);
  const refuse = () => { throw new Error('storage refused'); };
  const localStorage = throwStorage
    ? { getItem: refuse, setItem: refuse, removeItem: refuse }
    : { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, x) => storage.set(k, String(x)), removeItem: (k) => storage.delete(k) };
  const context = {
    document: { currentScript: { hasAttribute: (name) => staff && name === 'data-staff' }, referrer, prerendering },
    location: { pathname, search, host },
    navigator: { webdriver },
    localStorage,
    fetch: fetchImpl || ((url, init) => { calls.push([url, JSON.parse(JSON.stringify(init))]); return Promise.resolve({}); }),
    URL,
    URLSearchParams,
  };
  vm.runInNewContext(SOURCE, context);
  return { calls, storage };
}
const body = (extra) => ({ method: 'POST', keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(extra) });

test('a public page sends its path, referrer host and via', () => {
  const { calls } = run({ pathname: '/fundadores.html', search: '?via=whatsapp&x=1', referrer: 'https://www.google.com/search?q=nodal' });
  assert.deepEqual(calls, [['/api/visit', body({ p: '/fundadores.html', r: 'www.google.com', v: 'whatsapp' })]]);
});

test('a move inside the site is sent as self, and no referrer as empty', () => {
  assert.deepEqual(run({ referrer: 'https://nodal.example/index.html' }).calls, [['/api/visit', body({ p: '/index.html', r: 'self', v: '' })]]);
  assert.deepEqual(run({ referrer: '' }).calls, [['/api/visit', body({ p: '/index.html', r: '', v: '' })]]);
});

test('an unparseable referrer is sent as no referrer', () => {
  assert.deepEqual(run({ referrer: 'not a url' }).calls, [['/api/visit', body({ p: '/index.html', r: '', v: '' })]]);
});

test('a via too long to be one of the seven is sent as none', () => {
  const { calls } = run({ search: '?via=' + 'x'.repeat(2000) });
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0][1].body).v, '');
  assert.ok(Buffer.byteLength(calls[0][1].body) < 1024);
  assert.equal(JSON.parse(run({ search: '?via=%20WhatsApp%20' }).calls[0][1].body).v, ' WhatsApp ');
});

test('a staff page sets the marker and sends nothing', () => {
  const { calls, storage } = run({ staff: true, pathname: '/admin.html' });
  assert.deepEqual(calls, []);
  assert.equal(storage.get('nodal.staff'), '1');
});

test('a marked browser sends nothing, and neither does an automated or prerendering one', () => {
  assert.deepEqual(run({ marker: '1' }).calls, []);
  assert.deepEqual(run({ webdriver: true }).calls, []);
  assert.deepEqual(run({ prerendering: true }).calls, []);
});

test('the sign-in page clears the marker, then counts', () => {
  const { calls, storage } = run({ marker: '1', pathname: '/login.html' });
  assert.equal(storage.has('nodal.staff'), false);
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0][1].body).p, '/login.html');
});

test('a browser that refuses storage neither breaks nor miscounts', () => {
  assert.equal(run({ throwStorage: true }).calls.length, 1);
  assert.equal(run({ throwStorage: true, staff: true, pathname: '/admin.html' }).calls.length, 0);
  assert.equal(run({ throwStorage: true, pathname: '/login.html' }).calls.length, 1);
});

test('a failed or throwing fetch never reaches the page', async () => {
  let unhandled = 0;
  const onUnhandled = () => { unhandled += 1; };
  process.on('unhandledRejection', onUnhandled);
  try {
    assert.doesNotThrow(() => run({ fetchImpl: () => Promise.reject(new Error('offline')) }));
    assert.doesNotThrow(() => run({ fetchImpl: () => { throw new Error('blocked'); } }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(unhandled, 0);
  } finally { process.off('unhandledRejection', onUnhandled); }
});

test('the source reads nothing else from the address', () => {
  for (const word of ['location.href', 'location.hash', 'document.cookie', 'sendBeacon']) assert.ok(!SOURCE.includes(word), word);
  assert.doesNotMatch(SOURCE, /\bt\(|getElementById|querySelector/);
  assert.ok(SOURCE.split('\n').length <= 60);
});

test('the tag is on exactly the listed pages, last in the head, and the page map matches it', () => {
  const PLAIN_TAG = '<script defer src="visit.js?v=20261114a"></script>';
  const STAFF_TAG = '<script defer src="visit.js?v=20261114a" data-staff></script>';
  const plain = ['community', 'course', 'courses', 'dashboard', 'fiiu-session', 'fiiu-talk', 'fiiu', 'fundadores', 'index', 'knowledge', 'login', 'opportunities', 'payments', 'profile', 'resources'].map((n) => `${n}.html`).sort();
  const staff = ['admin', 'fiiu-admin', 'fiiu-qr', 'teaching'].map((n) => `${n}.html`).sort();
  const withTag = { plain: [], staff: [] };
  for (const file of readdirSync(path.join(ROOT, 'web/pages')).filter((f) => f.endsWith('.html')).sort()) {
    const html = read(`web/pages/${file}`);
    const mentions = (html.match(/visit\.js/g) || []).length;
    if (!mentions) continue;
    assert.equal(mentions, 1, file);
    const tag = html.includes(STAFF_TAG) ? STAFF_TAG : PLAIN_TAG;
    assert.ok(html.includes(tag), `${file} spells the tag exactly`);
    (tag === STAFF_TAG ? withTag.staff : withTag.plain).push(file);
    const head = html.slice(0, html.indexOf('</head>'));
    assert.equal(head.lastIndexOf('<script'), head.lastIndexOf(tag), `${file}: the tag is the last script of the head`);
    assert.ok(head.lastIndexOf(tag) >= 0, file);
  }
  assert.deepEqual(withTag.plain, plain);
  assert.deepEqual(withTag.staff, staff);
  assert.deepEqual([...new Set(Object.values(VISIT_PAGES))].sort(), plain.filter((f) => f !== 'fiiu-talk.html'));
});
