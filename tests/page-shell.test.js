import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createApp } from '../server/server.js';
import { createDatabase, createUser } from '../server/db.js';
import { createSession } from '../server/auth.js';
import { preparePageHtml } from '../server/page-shell.js';

async function boot(t, pilotMode) {
  const db = createDatabase({ filename: ':memory:' });
  const user = createUser(db, { fullName: 'Loading QA', email: 'loading@example.test', passwordHash: 'unusable' });
  const cookie = createSession(db, user.id).cookie.split(';')[0];
  const server = createApp({ db, pilotMode });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  return { base: `http://127.0.0.1:${server.address().port}`, cookie };
}

for (const mode of [true, false]) test(`initial HTML includes the actual pilot mode (${mode}) and stable banner visibility`, async t => {
  const { base, cookie } = await boot(t, mode);
  for (const page of ['login', 'dashboard', 'courses', 'course', 'profile', 'opportunities']) {
    const response = await fetch(`${base}/${page}.html`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200, page);
    const html = await response.text();
    assert.match(html, new RegExp(`<html[^>]* data-pilot="${mode}"`), page);
    const banners = [...html.matchAll(/<div\b[^>]*data-pilot-banner[^>]*>/g)];
    assert.equal(banners.length, 1, page);
    assert.equal(/\shidden\b/.test(banners[0][0]), !mode, page);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-security-policy'), /font-src 'self'/);
  }
  const home = await (await fetch(base + '/')).text();
  assert.equal(home, readFileSync(new URL('../web/pages/index.html', import.meta.url), 'utf8'));
  const head = await fetch(base + '/login.html', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
});

test('pilot shell preparation is idempotent and reversible for static builds', () => {
  const raw = readFileSync(new URL('../web/pages/opportunities.html', import.meta.url), 'utf8');
  const enabled = preparePageHtml(raw, { pilotMode: true });
  assert.equal(preparePageHtml(enabled, { pilotMode: true }), enabled);
  const disabled = preparePageHtml(enabled, { pilotMode: false });
  assert.match(disabled, /data-pilot="false"/);
  assert.match(disabled, /data-pilot-banner hidden>/);
  assert.equal(preparePageHtml(disabled, { pilotMode: true }), enabled);
});

test('local fonts are cacheable public resources and cannot expose arbitrary source files', async t => {
  const { base } = await boot(t, true);
  const font = await fetch(base + '/assets/fonts/montserrat-v31-latin-normal.woff2');
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  assert.match(font.headers.get('cache-control'), /public, max-age=3600/);
  assert.equal(Buffer.from(await font.arrayBuffer()).subarray(0, 4).toString(), 'wOF2');
  for (const resource of ['fonts.css', 'assets/fonts/OFL.txt']) {
    const response = await fetch(base + '/' + resource); assert.equal(response.status, 200); await response.text();
  }
  for (const resource of ['assets/fonts/SOURCES.json', 'assets/fonts/not-a-font.woff2', 'assets/fonts/../../server/server.js']) {
    const response = await fetch(base + '/' + resource); assert.equal(response.status, 404); await response.text();
  }
});
