/* Regressions found by the October 3 sweep over the review fixes. Every provider
   call goes to an in-memory stub. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/server.js';
import { createSupabaseRepository } from '../server/supabase.js';

const env = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
};
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = exp => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'member-1', exp, aud: 'authenticated' })}.signature`;
const LIVE = jwt(Math.floor(Date.now() / 1000) + 3600);
const EXPIRED = jwt(Math.floor(Date.now() / 1000) - 60);
const authUser = { id: 'member-1', email: 'member@example.test', user_metadata: { full_name: 'Member One' } };

function provider({ tokenStatus = 200 } = {}) {
  const calls = [];
  const reply = (payload, status = 200) => ({
    ok: status < 300, status, headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(payload),
  });
  const fetchImpl = async (raw, init = {}) => {
    const url = new URL(raw);
    calls.push(`${init.method || 'GET'} ${url.pathname}`);
    if (url.pathname === '/auth/v1/user') {
      return init.headers.Authorization === `Bearer ${LIVE}` ? reply(authUser) : reply({ msg: 'invalid JWT' }, 401);
    }
    if (url.pathname === '/auth/v1/logout') {
      return init.headers.Authorization === `Bearer ${LIVE}` ? reply(null, 204) : reply({ msg: 'invalid JWT' }, 401);
    }
    if (url.pathname === '/auth/v1/token') {
      if (tokenStatus !== 200) return reply({ msg: 'unavailable' }, tokenStatus);
      const body = JSON.parse(init.body || '{}');
      return body.refresh_token === 'good-refresh'
        ? reply({ access_token: LIVE, refresh_token: 'good-refresh', expires_in: 3600, user: authUser })
        : reply({ error: 'invalid_grant' }, 400);
    }
    if (url.pathname === '/rest/v1/profiles') return reply([{ id: 'member-1', email: 'member@example.test', full_name: 'Member One', account_status: 'active', app_role: 'member' }]);
    if (url.pathname === '/rest/v1/profile_preferences') return reply([{ user_id: 'member-1' }]);
    return reply([]);
  };
  return { calls, repository: createSupabaseRepository({ env, fetchImpl }) };
}

async function boot(t, repository) {
  const server = createApp({
    repository, courseStore: null, fiiuStore: null, newsStore: null,
    citySearch: { search: async () => ({ cities: [] }) },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

const signOut = (base, cookie) => fetch(`${base}/api/auth/logout`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, cookie }, body: '{}',
});

test('a class signing out together from one address leaves the session-refresh budget to classmates', async t => {
  const p = provider();
  const base = await boot(t, p.repository);
  // More sign-outs than SESSION_REFRESH_FAILURE_LIMIT (30): live access tokens, and pages left open past the hour.
  for (let i = 0; i < 40; i++) {
    const res = await signOut(base, `nodal_session=${i % 2 ? LIVE : EXPIRED}; nodal_refresh=good-refresh`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie') || '', /nodal_refresh=;[^,]*Max-Age=0/);
  }
  // A classmate on the same network whose access token just expired is still refreshed, not signed out.
  const state = await fetch(`${base}/api/auth/state`, { headers: { cookie: `nodal_session=${EXPIRED}; nodal_refresh=good-refresh` } });
  assert.deepEqual(await state.json(), { authenticated: true });
  assert.match(state.headers.get('set-cookie') || '', /nodal_session=ey/);
});

test('sign-out keeps counting refresh tokens the provider rejects, and only those', async t => {
  const rejected = provider();
  assert.equal((await rejected.repository.logout({ headers: { cookie: 'nodal_refresh=used' } })).refreshRejected, true);
  assert.equal((await rejected.repository.logout({ headers: { cookie: `nodal_session=${LIVE}; nodal_refresh=used` } })).refreshRejected, false, 'revoked with the access token; no refresh needed');
  assert.equal((await rejected.repository.logout({ headers: { cookie: 'nodal_refresh=good-refresh' } })).refreshRejected, false);
  const down = provider({ tokenStatus: 503 });
  assert.equal((await down.repository.logout({ headers: { cookie: 'nodal_refresh=good-refresh' } })).refreshRejected, false, 'an outage is not a rejection');

  // Over HTTP: junk refresh tokens still use up the address's budget, so sign-out cannot drive refreshes without bound.
  const base = await boot(t, rejected.repository);
  rejected.calls.length = 0;
  for (let i = 0; i < 40; i++) assert.equal((await signOut(base, `nodal_refresh=junk${i}`)).status, 200);
  assert.equal(rejected.calls.filter(call => call.endsWith('/auth/v1/token')).length, 30);
});
