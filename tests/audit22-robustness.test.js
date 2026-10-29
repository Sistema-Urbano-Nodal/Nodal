/* Robustness findings of the 22 Oct 2026 audit (R1–R8). SQLite apps, and fake GoTrue/PostgREST answers for the
   Supabase paths: nothing here reaches a real provider. */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { createApp } from '../server/server.js';
import { createDatabase, createUser } from '../server/db.js';
import { createSession } from '../server/auth.js';
import { createSupabaseRepository } from '../server/supabase.js';
import { validateCatalogInterestMessage, validateCatalogDraft } from '../server/catalog.js';
import { normalizePartC, cleanIndicators, cleanTopics } from '../server/profile-policy.js';
import { createCourseApi, bodyJson } from '../server/courses-api.js';
import { createCourseStore } from '../server/courses-repository.js';

async function listen(t, server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}
async function bootDb(t, options = {}) {
  const db = createDatabase({ filename: ':memory:' }); t.after(() => db.close());
  const base = await listen(t, createApp({ db, pilotMode: false, fiiuConfirmation: null, fiiuPartyNotice: null, citySearch: { search: async () => ({ cities: [] }) }, ...options }));
  const account = (role = 'member', email = `${role}@example.test`) => {
    const user = createUser(db, { fullName: 'Ana Pérez', email, passwordHash: 'unused', role });
    return { user, cookie: createSession(db, user.id).cookie.split(';')[0] };
  };
  return { db, base, account };
}
const quietly = t => { const error = console.error; console.error = () => {}; t.after(() => { console.error = error; }); };
const json = (base, path, { method = 'POST', cookie, body, raw } = {}) => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) }, body: raw ?? JSON.stringify(body),
});

const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test' };
const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'member@example.test', user_metadata: { full_name: 'Member One' } };
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const LIVE = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' })}.signature`;
const reply = (payload, status = 200, headers = {}) => new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', ...headers } });
/* GoTrue accepts LIVE and the refresh token 'good-refresh'; PostgREST answers `rest` (a function of the table) or, by
   default, an active member's rows. */
function provider({ user = 200, rest } = {}) {
  const calls = [];
  const fetchImpl = async (raw, init = {}) => {
    const url = new URL(raw), method = init.method || 'GET';
    calls.push(`${method} ${url.pathname}`);
    if (url.pathname === '/auth/v1/user') return user === 200 && init.headers.Authorization === `Bearer ${LIVE}` ? reply(USER) : reply({ msg: 'invalid JWT' }, 401);
    if (url.pathname === '/auth/v1/token') return JSON.parse(init.body || '{}').refresh_token === 'good-refresh'
      ? reply({ access_token: LIVE, refresh_token: 'good-refresh', expires_in: 3600, user: USER }) : reply({ error: 'invalid_grant' }, 400);
    const table = url.pathname.replace('/rest/v1/', '');
    const answer = rest?.(table, method);
    if (answer) return answer;
    if (table === 'profiles') return reply([{ id: USER.id, email: USER.email, full_name: 'Member One', account_status: 'active', app_role: 'member' }]);
    if (table === 'profile_preferences') return reply([{ user_id: USER.id }]);
    return reply([]);
  };
  return { calls, repository: createSupabaseRepository({ env: ENV, fetchImpl }) };
}
const bootSupabase = (t, repository, options = {}) => listen(t, createApp({ repository, courseStore: null, fiiuStore: null, talkStore: null, newsStore: null, citySearch: { search: async () => ({ cities: [] }) }, ...options }));
const POSTGREST_REFUSALS = [
  [401, { code: 'PGRST301', message: 'JWT expired' }],
  [403, { code: '42501', message: 'permission denied for table profiles' }],
  [400, { code: '22P02', message: 'invalid input syntax for type uuid' }],
  [404, { code: 'PGRST205', message: "Could not find the table 'public.profiles' in the schema cache" }],
];

/* R1. Only GoTrue's own answers about the access or refresh token mean signed out. A PostgREST refusal while the
   profile is read says nothing about the session: it used to spend the refresh token and clear both cookies (401/403)
   or answer 401 everywhere (400/404). */
test('a PostgREST refusal while reading the profile is an outage, never a sign-out', async t => {
  for (const [status, payload] of POSTGREST_REFUSALS) {
    for (const authorizationOnly of [false, true]) {
      const p = provider({ rest: table => (table === 'profiles' ? reply(payload, status) : null) });
      await assert.rejects(p.repository.resolveSession({ headers: { cookie: `nodal_session=${LIVE}; nodal_refresh=good-refresh` } }, { authorizationOnly }), error => {
        assert.equal(error.status, 503, `${status} ${authorizationOnly}`);
        assert.equal(error.expose, false);
        assert.match(error.message, new RegExp(`upstream ${status} ${payload.code}`));
        return true;
      });
      assert.ok(!p.calls.includes('POST /auth/v1/token'), `${status}: the refresh token is never spent on it`);
    }
    // After a refresh, too: the new session is not turned into a sign-out by the profile read.
    const refreshed = provider({ rest: table => (table === 'profiles' ? reply(payload, status) : null) });
    await assert.rejects(refreshed.repository.resolveSession({ headers: { cookie: 'nodal_refresh=good-refresh' } }), { status: 503 });
  }
  // GoTrue's refusals still sign out.
  const rejected = provider({ user: 401 });
  const signedOut = await rejected.repository.resolveSession({ headers: { cookie: `nodal_session=${LIVE}` } });
  assert.equal(signedOut.user, null);
  assert.match(signedOut.cookies.join('\n'), /nodal_session=;.*Max-Age=0/);
});

test('a route whose profile read is refused answers 503 and keeps the session cookies', async t => {
  quietly(t);
  const p = provider({ rest: table => (table === 'profiles' ? reply({ code: 'PGRST301', message: 'JWT expired' }, 401) : null) });
  const base = await bootSupabase(t, p.repository);
  const response = await fetch(`${base}/api/auth/me`, { headers: { Cookie: `nodal_session=${LIVE}; nodal_refresh=good-refresh` } });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.ok(!p.calls.includes('POST /auth/v1/token'));
});

/* R2. PostgREST's and GoTrue's statuses belong to the request NODAL made, not to the visitor's: passed through, a
   provider 401 read as signed out, a 403 as a locked page, a 404 as a missing item. They answer 502, and a provider
   rate limit 503 with Retry-After. NODAL's own refusals keep theirs. */
test('a provider refusal reaching the global handler answers 502, and a provider rate limit 503', async t => {
  quietly(t);
  for (const [status, payload] of [...POSTGREST_REFUSALS, [409, { code: '23505', message: 'duplicate key value violates unique constraint' }]]) {
    const reports = [];
    const p = provider({ rest: table => (table === 'catalog_items' ? reply(payload, status) : null) });
    const base = await bootSupabase(t, p.repository, { errorReport: { enabled: true, report: async (_error, context) => { reports.push(context); return true; } } });
    const response = await fetch(`${base}/api/catalog`);
    assert.equal(response.status, 502, String(status));
    assert.doesNotMatch(await response.text(), new RegExp(payload.code), 'the provider\'s wording stays in the log');
    assert.deepEqual(reports, [{ method: 'GET', route: '/api/catalog', status: 502 }]);
  }
  const limited = provider({ rest: table => (table === 'catalog_items' ? reply({ message: 'Too Many Requests' }, 429) : null) });
  const base = await bootSupabase(t, limited.repository);
  const response = await fetch(`${base}/api/catalog`);
  assert.equal(response.status, 503);
  assert.match(response.headers.get('retry-after'), /^\d+$/);
  // NODAL's own refusal of a bad query keeps its status and wording.
  const own = await fetch(`${base}/api/catalog?kind=spaceship`);
  assert.equal(own.status, 400);
  assert.deepEqual(await own.json(), { error: 'kind is invalid' });
});

/* R5. No answer (a timeout, a dropped connection) or an answer that is not JSON had no status and became a 500. */
test('a provider that times out, drops the connection or answers something other than JSON is unavailable (503)', async t => {
  quietly(t);
  for (const [name, answer] of [
    ['timeout', () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))],
    ['fetch failed', () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))],
    ['html', () => new Response('<html><body>502 Bad Gateway</body></html>', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['truncated', () => new Response('[{"id": 1,', { status: 200, headers: { 'content-type': 'application/json' } })],
  ]) {
    const p = provider({ rest: table => (table === 'catalog_items' ? answer() : null) });
    const base = await bootSupabase(t, p.repository);
    const response = await fetch(`${base}/api/catalog`);
    assert.equal(response.status, 503, name);
    assert.match(response.headers.get('retry-after'), /^\d+$/, name);
    assert.deepEqual(await response.json(), { error: 'internal error' }, name);
  }
  // A refusal whose body is not JSON (an HTML error page) keeps its status for the code that branches on it.
  const repository = createSupabaseRepository({ env: ENV, fetchImpl: async () => new Response('<html>Not Found</html>', { status: 404, headers: { 'content-type': 'text/html' } }) });
  await assert.rejects(repository.getCatalogItem('11111111-1111-4111-8111-111111111111'), { status: 404, expose: false });
});

/* R3. JSON can send {"toString":1} where text belongs, and String() of that throws: a 500 (sign-up needs no sign-in),
   or the exception's own words echoed back. */
test('text fields that are not text are refused with the route\'s own message, never a 500', async t => {
  const { base, account } = await bootDb(t);
  for (const fullName of [{ toString: 1 }, [{ toString: 1 }], 12345]) {
    const signup = await json(base, '/api/auth/signup', { body: { fullName, email: 'new@example.test', password: 'correct-horse-1' } });
    assert.equal(signup.status, 400, JSON.stringify(fullName));
    assert.deepEqual(await signup.json(), { error: 'full name is required' });
  }
  const { cookie } = account();
  const hostile = { toString: 1 };
  for (const [body, error] of [
    [{ fullName: hostile }, 'full name is required'],
    [{ fullName: [hostile] }, 'full name is required'],
    [{ title: hostile }, 'invalid profile payload'],
    [{ city: [hostile] }, 'invalid profile payload'],
    [{ linkedin: hostile }, 'LinkedIn link must use https://linkedin.com/in/...'],
    [{ partC: { linkedin: hostile } }, 'LinkedIn link must use https://linkedin.com/in/...'],
    [{ partC: { portfolio: hostile } }, 'portfolio link must start with http:// or https://'],
    [{ partC: { bio: hostile } }, 'invalid profile payload'],
    [{ indicators: { leadership: hostile } }, 'invalid profile payload'],
  ]) {
    const response = await json(base, '/api/me', { method: 'PATCH', cookie, body });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(await response.json(), { error }, JSON.stringify(body));
  }
  // Nested values the profile only reads loosely are dropped, not crashed on.
  const topics = await json(base, '/api/me', { method: 'PATCH', cookie, body: { topics: [{ name: hostile }, { name: 'Mobility', level: hostile }] } });
  assert.equal(topics.status, 200);
  assert.deepEqual((await topics.json()).user.topics.map(topic => [topic.name, topic.level]), [['Mobility', 1]]);
  const unchanged = await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })).json();
  assert.equal(unchanged.user.fullName, 'Ana Pérez');
  const deletion = await json(base, '/api/me', { method: 'DELETE', cookie, body: { confirmEmail: hostile } });
  assert.equal(deletion.status, 400);
  assert.equal((await deletion.json()).code, 'confirm_email_mismatch');
  const admin = account('admin');
  for (const field of ['kind', 'subtype', 'status', 'visibility', 'actionMode']) {
    const response = await json(base, '/api/admin/catalog', { cookie: admin.cookie, body: { [field]: hostile } });
    assert.equal(response.status, 400, field);
    assert.doesNotMatch((await response.json()).error, /primitive/, field);
  }
  // The shared helpers never throw on such values either.
  assert.equal(normalizePartC({ bio: hostile, linkedin: [hostile] }).bio, '');
  assert.deepEqual(cleanIndicators({ leadership: hostile, transmission: 'Formally' }), { leadership: 'No', transmission: 'Formally' });
  assert.deepEqual(cleanTopics([{ name: hostile }, hostile]), []);
  assert.throws(() => validateCatalogDraft({ kind: hostile }), /kind is invalid/);
});

/* R4. An oversized body used to reset the connection (req.destroy()), which browsers report as a network failure. */
test('an oversized body answers 413, and the connection stays usable', async t => {
  const { base } = await bootDb(t, { payments: { config: { webhookSecret: 'whsec_test_secret' }, fetchImpl: fetch } });
  for (const size of [40 * 1024, 2 * 1024 * 1024]) {
    const login = await json(base, '/api/auth/login', { body: { email: 'a@example.test', password: 'x', pad: 'x'.repeat(size) } });
    assert.equal(login.status, 413, String(size));
    assert.deepEqual(await login.json(), { error: 'request too large' });
  }
  const webhook = await fetch(`${base}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(200 * 1024) });
  assert.equal(webhook.status, 413);
  assert.deepEqual(await webhook.json(), { error: 'request too large' });
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});
/* The course, festival and news routes read their bodies with bodyJson, which left its read loop at the cap: that
   destroyed the request, and a fresh connection (no keep-alive, as http.request with agent:false) got EPIPE or a reset. */
test('an oversized body on a course, festival or news route answers 413 too, never a reset connection', async t => {
  const { base, account } = await bootDb(t, { now: () => Date.parse('2026-10-29T12:00:00Z') });
  const { cookie } = account();
  const post = (path, body) => new Promise((resolve, reject) => {
    const req = http.request(base + path, { method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Origin: base, Cookie: cookie } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end(body);
  });
  for (const size of [200 * 1024, 1024 * 1024, 4 * 1024 * 1024]) {
    const answer = await post('/api/feedback', JSON.stringify({ action: 'idea', message: 'x'.repeat(size) }));
    assert.equal(answer.status, 413, String(size));
    assert.deepEqual(JSON.parse(answer.body), { error: 'request too large' });
  }
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});
test('bodyJson reads an over-cap body to its end before refusing it, and keeps none of it', async () => {
  const stream = Readable.from(Array.from({ length: 8 }, () => Buffer.alloc(16 * 1024, 'x')));
  stream.headers = { 'content-type': 'application/json' };
  await assert.rejects(bodyJson(stream, 64 * 1024), error => error.status === 413 && error.message === 'request too large');
  assert.equal(stream.readableEnded, true, 'the rest of the body was read');
  assert.equal(stream.destroyed && !stream.readableEnded, false, 'the request was not destroyed before its end');
});

/* R6. The tag check ran before the length check, and on "<a<a<a…" it is quadratic: one 32 KB message held the event
   loop for about 270 ms. Too long is refused before anything else is looked at. */
test('an over-long catalog text is refused before the tag check runs', () => {
  const started = performance.now();
  assert.throws(() => validateCatalogInterestMessage('<a'.repeat(64 * 1024)), /at most 1000 characters/);
  assert.ok(performance.now() - started < 500, `took ${Math.round(performance.now() - started)} ms`);
});

/* R7. `key in allowed` also found inherited keys (constructor, toString…), whose values are functions, not columns. */
test('a profile patch with inherited property names is ignored, not a 500', async t => {
  const { base, account } = await bootDb(t);
  const { cookie } = account();
  const response = await json(base, '/api/me', { method: 'PATCH', cookie, raw: '{"constructor":"x","toString":"y","hasOwnProperty":"z","__proto__":{"fullName":"Mallory"}}' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.fullName, 'Ana Pérez');
});

/* R8. A store that did not honour the cursor answered the same page forever, and an export had no ceiling. */
async function feedbackExport(t, feedbackPage) {
  const staff = { id: 'staff-1', permission: 'admin', role: 'admin', fullName: 'Staff', email: 'staff@example.test' };
  let reads = 0;
  const store = {
    find: async (name, filters, options) => {
      if (name !== 'feedback') return [];
      if (++reads > 150) throw new Error('the export kept reading');
      await new Promise(resolve => setImmediate(resolve));
      return feedbackPage(options);
    },
    getMembers: async () => [],
    count: async () => 0,
  };
  const api = createCourseApi({ store, userRepository: { getUserById: async () => staff, toApiUser: user => user }, sameOrigin: () => true });
  const server = http.createServer(async (req, res) => {
    try { if (!await api({ req, res, url: new URL(req.url, 'http://127.0.0.1'), user: staff })) { res.writeHead(404); res.end(); } }
    catch (error) { res.writeHead(error.status ?? 500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
  });
  const base = await listen(t, server);
  const response = await fetch(`${base}/api/admin/feedback/export`);
  return { response, reads: () => reads };
}
const feedbackRow = n => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, userId: 'u', action: 'general', courseId: null, moduleId: null, rating: 5, comment: '', createdAt: '2026-10-01T00:00:00.000Z' });

test('an unbounded course read stops when the store repeats a page, and fails past 50,000 rows', async t => {
  // The cursor is ignored: the same 500 rows every time.
  const repeated = await feedbackExport(t, ({ limit }) => Array.from({ length: limit }, (_, i) => feedbackRow(i)));
  assert.equal(repeated.response.status, 200);
  assert.equal((await repeated.response.text()).trim().split('\r\n').length, 501, 'each row once, after the header');
  assert.equal(repeated.reads(), 2);
  // An honest cursor over more rows than any export should hold.
  const endless = await feedbackExport(t, ({ limit, after }) => {
    const start = after ? Number(after.id.slice(-12)) + 1 : 0;
    return Array.from({ length: limit }, (_, i) => feedbackRow(start + i));
  });
  assert.equal(endless.response.status, 503);
  assert.ok(endless.reads() <= 101);
});

test('a Supabase course page stops when the provider ignores its keyset', async () => {
  const calls = [];
  const rows = Array.from({ length: 3 }, (_, i) => ({ id: `id-${i}`, course_id: 'course', created_at: '2026-09-05T00:00:00.000Z', resources: [], status: 'published' }));
  // Says 10 rows exist, answers 3 at a time, and never applies the keyset.
  const store = createCourseStore({ clients: { admin: { rest: async (table, args) => { calls.push(args.query); return { rows, contentRange: '0-2/10' }; } } } });
  const page = await store.find('modules', { courseId: 'course' }, { limit: 30, order: ['createdAt', 'id'] });
  assert.deepEqual(page.map(row => row.id), ['id-0', 'id-1', 'id-2'], 'no row twice');
  assert.equal(calls.length, 2);
});

