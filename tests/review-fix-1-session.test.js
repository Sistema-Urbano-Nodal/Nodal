/* Session resolution on the Supabase backend: which routes pay for it, how many
   GoTrue calls a cookie can cause, and what a GoTrue outage does to routes that
   work without a session. Every provider call goes to an in-memory stub. */
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
const jwt = (exp, sub = 'member-1') => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp, aud: 'authenticated' })}.signature`;
const LIVE = jwt(Math.floor(Date.now() / 1000) + 3600);
const FORGED = jwt(Math.floor(Date.now() / 1000) + 3600, 'someone-else');
const EXPIRED = jwt(Math.floor(Date.now() / 1000) - 60);
const authUser = { id: 'member-1', email: 'member@example.test', user_metadata: { full_name: 'Member One' } };

function provider({ userStatus = 200, tokenStatus = 200 } = {}) {
  const calls = [];
  const reply = (payload, status = 200) => ({
    ok: status < 300, status, headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(payload),
  });
  const fetchImpl = async (raw, init = {}) => {
    const url = new URL(raw);
    const method = init.method || 'GET';
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname === '/auth/v1/user') {
      if (userStatus !== 200) return reply({ msg: 'unavailable' }, userStatus);
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
    if (url.pathname === '/rest/v1/onboarding_responses') return reply([]);
    if (url.pathname === '/rest/v1/stripe_customers') return reply([]);
    if (url.pathname === '/rest/v1/catalog_items') return reply([]);
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

const auth = calls => calls.filter(call => call.includes('/auth/v1/'));

test('the pricing endpoint and the Stripe webhook never resolve a session', async t => {
  const p = provider();
  const base = await boot(t, p.repository);
  for (let i = 0; i < 50; i++) {
    const res = await fetch(`${base}/api/billing/config`, { headers: { cookie: `nodal_session=junk${i}; nodal_refresh=junk${i}` } });
    assert.equal(res.status, 200);
    await res.arrayBuffer();
  }
  const signedIn = await fetch(`${base}/api/billing/config`, { headers: { cookie: `nodal_session=${LIVE}` } });
  assert.equal(signedIn.status, 200);
  const webhook = await fetch(`${base}/api/stripe/webhook`, { method: 'POST', headers: { cookie: `nodal_session=junk; nodal_refresh=junk` }, body: '{}' });
  assert.equal(webhook.status, 503, 'payments webhook not configured');
  assert.deepEqual(p.calls, [], 'no GoTrue or PostgREST call for routes that never read the session');
});

test('junk session cookies cannot make anonymous requests call GoTrue without bound', async t => {
  const p = provider();
  const base = await boot(t, p.repository);
  for (let i = 0; i < 100; i++) {
    const res = await fetch(`${base}/api/auth/state`, { headers: { cookie: `nodal_session=junk${i}; nodal_refresh=junk${i}` } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { authenticated: false });
  }
  assert.equal(p.calls.filter(call => call.endsWith('/auth/v1/user')).length, 0, 'a token that is not a live JWT is never sent to /auth/v1/user');
  const refreshes = p.calls.filter(call => call.endsWith('/auth/v1/token')).length;
  assert.ok(refreshes >= 1 && refreshes <= 30, `failed refreshes per address are budgeted (saw ${refreshes})`);

  // A live-looking token that GoTrue rejects cannot reopen the refresh path once the address is over budget.
  p.calls.length = 0;
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${base}/api/auth/state`, { headers: { cookie: `nodal_session=${FORGED}; nodal_refresh=junk${i}` } });
    assert.equal((await res.json()).authenticated, false);
  }
  assert.equal(p.calls.filter(call => call.endsWith('/auth/v1/token')).length, 0);
});

test('sign-out with junk cookies cannot drive refreshes either, and always clears the cookies', async t => {
  const p = provider();
  const base = await boot(t, p.repository);
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, cookie: `nodal_session=junk${i}; nodal_refresh=junk${i}` }, body: '{}' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie') || '', /nodal_session=;[^,]*Max-Age=0/);
  }
  assert.ok(p.calls.filter(call => call.endsWith('/auth/v1/token')).length <= 30);
  assert.equal(p.calls.filter(call => call.endsWith('/auth/v1/logout')).length, 0, 'a token that is not a live JWT is never sent');
  // A member's own sign-out from that address still revokes the session with its live token.
  p.calls.length = 0;
  const real = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, cookie: `nodal_session=${LIVE}; nodal_refresh=good-refresh` }, body: '{}' });
  assert.equal(real.status, 200);
  assert.deepEqual(auth(p.calls), ['POST /auth/v1/logout']);
});

test('expired, malformed and empty session cookies are cleared without calling GoTrue', async t => {
  const p = provider();
  const base = await boot(t, p.repository);
  for (const cookie of [`nodal_session=${EXPIRED}`, 'nodal_session=not-a-jwt', `nodal_session=${EXPIRED}; nodal_refresh=`, 'nodal_refresh=has spaces%20inside']) {
    const res = await fetch(`${base}/api/auth/state`, { headers: { cookie } });
    assert.deepEqual(await res.json(), { authenticated: false }, cookie);
    const cleared = res.headers.get('set-cookie') || '';
    assert.match(cleared, /nodal_session=;[^,]*Max-Age=0/, cookie);
    assert.match(cleared, /nodal_refresh=;[^,]*Max-Age=0/, cookie);
  }
  assert.deepEqual(p.calls, []);
});

test('real sessions still work: live tokens, refreshes past the failure budget, and expired tokens with a refresh', async t => {
  const p = provider();
  const base = await boot(t, p.repository);
  const live = await fetch(`${base}/api/auth/state`, { headers: { cookie: `nodal_session=${LIVE}; nodal_refresh=good-refresh` } });
  assert.deepEqual(await live.json(), { authenticated: true });
  assert.equal(p.calls.filter(call => call.endsWith('/auth/v1/token')).length, 0, 'a live token needs no refresh');
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${base}/api/auth/state`, { headers: { cookie: `nodal_session=${EXPIRED}; nodal_refresh=good-refresh` } });
    assert.deepEqual(await res.json(), { authenticated: true }, `refresh ${i}`);
    assert.match(res.headers.get('set-cookie') || '', new RegExp(`nodal_session=${LIVE.replaceAll('.', '\\.')}`));
  }
  assert.equal(p.calls.filter(call => call.endsWith('/auth/v1/user')).length, 1, 'an expired token goes straight to the refresh');
});

test('a session-service outage leaves public routes and the sign-in page working, cookies intact', async t => {
  const p = provider({ userStatus: 429, tokenStatus: 503 });
  const base = await boot(t, p.repository);
  const cookie = `nodal_session=${LIVE}; nodal_refresh=good-refresh`;
  const login = await fetch(`${base}/login.html`, { headers: { cookie } });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('content-type'), /text\/html/);
  const state = await fetch(`${base}/api/auth/state`, { headers: { cookie } });
  assert.equal(state.status, 200);
  assert.deepEqual(await state.json(), { authenticated: false });
  assert.equal(state.headers.get('set-cookie'), null, 'an outage never clears the member\'s cookies');
  const catalog = await fetch(`${base}/api/catalog`, { headers: { cookie } });
  assert.equal(catalog.status, 200);
  const refreshOnly = await fetch(`${base}/api/catalog`, { headers: { cookie: `nodal_session=${EXPIRED}; nodal_refresh=good-refresh` } });
  assert.equal(refreshOnly.status, 200);
  assert.equal(refreshOnly.headers.get('set-cookie'), null);

  // Routes that need the member still fail closed, and a private page answers in HTML.
  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
  assert.equal(me.status, 503);
  assert.match(me.headers.get('content-type'), /application\/json/);
  const dashboard = await fetch(`${base}/dashboard.html`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(dashboard.status, 503);
  assert.match(dashboard.headers.get('content-type'), /text\/html/);
  assert.match(dashboard.headers.get('retry-after') || '', /^\d+$/);
  assert.match(dashboard.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.match(await dashboard.text(), /temporarily unavailable/i);
});

test('id-only routes authorize with the profile row instead of the full profile bundle', async t => {
  const p = provider();
  const base = await boot(t, p.repository);
  const cookie = `nodal_session=${LIVE}`;
  const status = await fetch(`${base}/api/billing/status`, { headers: { cookie } });
  assert.equal(status.status, 200);
  assert.deepEqual(p.calls, ['GET /auth/v1/user', 'GET /rest/v1/profiles', 'GET /rest/v1/stripe_customers']);
  p.calls.length = 0;
  const cities = await fetch(`${base}/api/cities?q=Li`, { headers: { cookie } });
  assert.equal(cities.status, 200);
  assert.deepEqual(p.calls, ['GET /auth/v1/user', 'GET /rest/v1/profiles']);
  p.calls.length = 0;
  // The member's own profile still comes back complete.
  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
  assert.ok(p.calls.includes('GET /rest/v1/profile_preferences') && p.calls.includes('GET /rest/v1/onboarding_responses'));
  assert.equal(auth(p.calls).length, 1);
});
