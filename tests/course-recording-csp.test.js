import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/server.js';
import { createDatabase, createUser } from '../server/db.js';
import { createSession } from '../server/auth.js';

const RECORDING_ORIGINS = [
  'https://drive.google.com',
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
];

async function boot(t) {
  const db = createDatabase({ filename: ':memory:' });
  const user = createUser(db, {
    fullName: 'Course CSP Member',
    email: 'course-csp@example.test',
    passwordHash: 'unusable',
  });
  const cookie = createSession(db, user.id).cookie.split(';')[0];
  const server = createApp({ db });
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { base: `http://127.0.0.1:${server.address().port}`, cookie };
}

function csp(response) {
  const header = response.headers.get('content-security-policy');
  assert.ok(header, 'HTML responses must include Content-Security-Policy');
  const directives = new Map();
  for (const directive of header.split(';').map(value => value.trim()).filter(Boolean)) {
    const [name, ...sources] = directive.split(/\s+/);
    assert.equal(directives.has(name), false, `CSP must not repeat ${name}`);
    directives.set(name, sources);
  }
  return directives;
}

test('authenticated course HTML permits only the three recording frame origins', async t => {
  const { base, cookie } = await boot(t);
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  const baseline = csp(home);
  await home.text();

  for (const path of ['/course.html', '/course.html?id=course-csp&module=session-csp', '/%63ourse.html']) {
    const response = await fetch(base + path, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/, path);
    const directives = csp(response);
    assert.deepEqual(directives.get('frame-src')?.slice().sort(), RECORDING_ORIGINS.slice().sort(), path);
    directives.delete('frame-src');
    assert.deepEqual(directives, baseline, 'recording frames must not relax other CSP directives');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.match(await response.text(), /data-page="course"/, 'the authenticated course page is served');
  }
});

test('home and login keep their restrictive CSP without recording origins', async t => {
  const { base } = await boot(t);
  for (const path of ['/', '/index.html', '/login.html']) {
    const response = await fetch(base + path, { redirect: 'manual' });
    assert.equal(response.status, 200, path);
    const directives = csp(response);
    assert.deepEqual(directives.get('default-src'), ["'self'"], path);
    assert.deepEqual(directives.get('script-src'), ["'self'"], path);
    assert.deepEqual(directives.get('object-src'), ["'none'"], path);
    assert.deepEqual(directives.get('frame-ancestors'), ["'none'"], path);
    assert.equal(directives.has('frame-src'), false, `${path} must retain default-src frame restrictions`);
    assert.equal(directives.has('child-src'), false, `${path} must not override the frame fallback`);
    for (const origin of RECORDING_ORIGINS) {
      assert.ok(!response.headers.get('content-security-policy').includes(origin), `${path} must not permit ${origin}`);
    }
    await response.text();
  }
});
