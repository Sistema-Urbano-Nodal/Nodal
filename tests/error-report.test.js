import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createErrorReporter, routeOf, scrub, sentryEndpoint } from '../server/error-report.js';
import { createApp } from '../server/server.js';
import { createStore } from '../server/store.js';

const DSN = 'https://abc123publickey@o4507.ingest.us.sentry.io/4508123';
// A recording fetch: each call's URL, headers and parsed envelope lines.
function recorder(answer = async () => ({ ok: true, status: 200 })) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options.headers, lines: String(options.body).split('\n').filter(Boolean).map((line) => JSON.parse(line)), signal: options.signal });
    return answer(url, options);
  };
  return { calls, fetchImpl };
}
const failure = (message = 'database unavailable') => {
  const err = new Error(message);
  err.stack = `Error: ${message}\n    at query (/var/task/server/supabase.js:120:11)\n    at async handle (file:///var/task/server/server.js:1600:9)\n    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)`;
  return err;
};

test('without a valid Sentry DSN nothing is sent and reporting never fails', async (t) => {
  // An unset dsn falls back to SENTRY_DSN, which a Vercel build has: clear it for this test.
  const old = process.env.SENTRY_DSN;delete process.env.SENTRY_DSN;t.after(() => { if (old !== undefined) process.env.SENTRY_DSN = old; });
  for (const dsn of [undefined, '', 'not a url', 'http://key@o1.ingest.sentry.io/1', 'https://o1.ingest.sentry.io/1', 'https://key@o1.ingest.sentry.io/', 'https://key@o1.ingest.sentry.io/project']) {
    const { calls, fetchImpl } = recorder();
    const reporter = createErrorReporter({ dsn, fetchImpl });
    assert.equal(reporter.enabled, false, String(dsn));
    assert.equal(await reporter.report(failure(), { method: 'GET', route: '/api/x', status: 500 }), false);
    assert.equal(calls.length, 0);
  }
  assert.deepEqual(sentryEndpoint(DSN), { url: 'https://o4507.ingest.us.sentry.io/api/4508123/envelope/', key: 'abc123publickey' });
  assert.equal(sentryEndpoint('https://key@sentry.example.org/prefix/42').url, 'https://sentry.example.org/prefix/api/42/envelope/', 'a self-hosted Sentry under a path');
});

test('a report carries the error, its code locations and the route, never personal data, query strings or absolute paths', async () => {
  const { calls, fetchImpl } = recorder();
  const reporter = createErrorReporter({ dsn: DSN, environment: 'production', release: 'fcc2670abc', fetchImpl, now: () => Date.parse('2026-10-20T20:00:00Z') });
  assert.equal(reporter.enabled, true);
  const err = failure('lookup failed for ana@example.test with token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop on 72e3cc56-a506-4a1b-97b5-9333e8d283ca');
  assert.equal(await reporter.report(err, { method: 'POST', route: routeOf('/api/courses/72e3cc56-a506-4a1b-97b5-9333e8d283ca/enroll?email=ana@example.test'), status: 500 }), true);
  assert.equal(calls.length, 1);
  const [{ url, headers, lines }] = calls;
  assert.equal(url, 'https://o4507.ingest.us.sentry.io/api/4508123/envelope/');
  assert.equal(headers['Content-Type'], 'application/x-sentry-envelope');
  assert.match(headers['X-Sentry-Auth'], /^Sentry sentry_version=7, sentry_key=abc123publickey, sentry_client=nodal-server\/1$/);
  const [envelope, item, event] = lines;
  assert.match(envelope.event_id, /^[0-9a-f]{32}$/);assert.equal(event.event_id, envelope.event_id);assert.equal(item.type, 'event');
  assert.equal(event.level, 'error');assert.equal(event.platform, 'node');assert.equal(event.environment, 'production');assert.equal(event.release, 'fcc2670abc');
  assert.equal(event.timestamp, Date.parse('2026-10-20T20:00:00Z') / 1000);
  assert.equal(event.transaction, 'POST /api/courses/:id/enroll');
  assert.deepEqual(event.tags, { method: 'POST', route: '/api/courses/:id/enroll', status: '500' });
  const [exception] = event.exception.values;
  assert.equal(exception.type, 'Error');
  assert.equal(exception.value, 'lookup failed for [email] with token [token] on [id]');
  assert.deepEqual(exception.stacktrace.frames, [
    { function: 'process.processTicksAndRejections', filename: 'node:internal/process/task_queues', lineno: 95, colno: 5, in_app: false },
    { function: 'handle', filename: 'server/server.js', lineno: 1600, colno: 9, in_app: true },
    { function: 'query', filename: 'server/supabase.js', lineno: 120, colno: 11, in_app: true },
  ], 'oldest first, paths relative to the app');
  const text = JSON.stringify(lines);
  for (const leak of ['ana@example.test', 'eyJhbGci', '72e3cc56', '/var/task', 'email=', '?'])assert.equal(text.includes(leak), false, leak);
  for (const field of ['request', 'user', 'server_name', 'contexts', 'extra'])assert.equal(field in event, false, field);
});

test('scrubbing and routes: ids, emails and tokens are replaced, and the query string never leaves', () => {
  assert.equal(routeOf('/api/admin/fiiu/registrations/123456/attendance?x=1'), '/api/admin/fiiu/registrations/:id/attendance');
  assert.equal(routeOf('/api/fiiu/files/0b9a3f0e8c7d4e5fa1b2c3d4e5f60718?size=thumb'), '/api/fiiu/files/:id');
  assert.equal(routeOf('/course.html'), '/course.html');
  assert.equal(routeOf('//evil/%E0%A4%A'), '/evil/:id', 'an unparseable segment does not throw');
  assert.equal(routeOf('/api/users/search/ana@example.test'), '/api/users/search/:id');
  assert.equal(scrub('x'.repeat(2000)).length <= 500, true, 'a message is capped');
  assert.equal(scrub('code 42 at row 7'), 'code 42 at row 7', 'short numbers stay');
  assert.equal(scrub('key sb_secret_abcdefghijklmnopqrstuvwxyz0123 leaked'), 'key [token] leaked');
});

test('a burst of errors is capped per minute, and the same error is sent once a minute', async () => {
  let clock = Date.parse('2026-10-20T20:00:00Z');
  const { calls, fetchImpl } = recorder();
  const reporter = createErrorReporter({ dsn: DSN, fetchImpl, now: () => clock, perMinute: 20 });
  for (let i = 0; i < 25; i++) await reporter.report(failure(`failure number ${i}`), { method: 'GET', route: '/api/x', status: 500 });
  assert.equal(calls.length, 20, 'at most 20 a minute');
  clock += 61_000;
  assert.equal(await reporter.report(failure('same'), { method: 'GET', route: '/api/x', status: 500 }), true);
  assert.equal(await reporter.report(failure('same'), { method: 'GET', route: '/api/x', status: 500 }), false, 'a repeat within the minute is dropped');
  assert.equal(await reporter.report(failure('same'), { method: 'GET', route: '/api/y', status: 500 }), true, 'the same error on another route counts apart');
  clock += 61_000;
  assert.equal(await reporter.report(failure('same'), { method: 'GET', route: '/api/x', status: 500 }), true, 'and again after a minute');
});

test('a slow or failing Sentry never holds a response longer than the time limit, nor throws', async () => {
  const hung = createErrorReporter({ dsn: DSN, timeoutMs: 50, fetchImpl: (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))) });
  const started = Date.now();
  assert.equal(await hung.report(failure(), { method: 'GET', route: '/api/x', status: 500 }), false);
  assert.ok(Date.now() - started < 1000);
  const refused = createErrorReporter({ dsn: DSN, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(await refused.report(failure(), { method: 'GET', route: '/api/x', status: 500 }), false);
  const rejected = createErrorReporter({ dsn: DSN, fetchImpl: async () => ({ ok: false, status: 429 }) });
  assert.equal(await rejected.report(failure(), { method: 'GET', route: '/api/x', status: 500 }), false);
  assert.equal(await createErrorReporter({ dsn: DSN, fetchImpl: recorder().fetchImpl }).report('not an error', {}), true, 'a thrown string is reported too');
});

test('the server reports a request that fails with a 5xx before answering it, and nothing for an ordinary refusal', async (t) => {
  const reports = [];
  const errorReport = { enabled: true, report: async (error, context) => { reports.push({ message: error.message, ...context }); return true; } };
  const broken = new Proxy({}, { get() { throw new Error('billing settings unreadable'); } });
  const server = createApp({ store: createStore(), billingEnv: broken, errorReport, citySearch: { search: async () => ({ cities: [] }) } });
  server.listen(0, '127.0.0.1');await once(server, 'listening');t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/api/billing/config?token=secret`);
  assert.equal(res.status, 500);assert.deepEqual(await res.json(), { error: 'internal error' });
  assert.deepEqual(reports, [{ message: 'billing settings unreadable', method: 'GET', route: '/api/billing/config', status: 500 }]);
  assert.equal((await fetch(`${base}/api/no-such-route`)).status, 404);
  assert.equal(reports.length, 1, 'a 404 is not an error to report');
});

test('only the deployed entry points report: an app built in a test stays silent even with SENTRY_DSN set, so Vercel builds send nothing', async (t) => {
  const old = process.env.SENTRY_DSN;process.env.SENTRY_DSN = DSN;t.after(() => { if (old === undefined) delete process.env.SENTRY_DSN; else process.env.SENTRY_DSN = old; });
  const sent = [], realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => { if (String(url).includes('sentry.io')) { sent.push(url); return { ok: true, status: 200 }; } return realFetch(url, options); };
  t.after(() => { globalThis.fetch = realFetch; });
  const broken = new Proxy({}, { get() { throw new Error('billing settings unreadable'); } });
  const server = createApp({ store: createStore(), billingEnv: broken, citySearch: { search: async () => ({ cities: [] }) } });
  server.listen(0, '127.0.0.1');await once(server, 'listening');t.after(() => server.close());
  assert.equal((await realFetch(`http://127.0.0.1:${server.address().port}/api/billing/config`)).status, 500);
  assert.deepEqual(sent, [], 'no report from a test app');
  const { readFileSync } = await import('node:fs');
  const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.match(source('api/index.js'), /const reporter = createErrorReporter\(\);/, 'the Vercel function reports');
  assert.match(source('api/index.js'), /createApp\(\{[^}]*errorReport: reporter \}\)/, 'through the app, and on a failed start');
  // Until the Membresía Fundador release, the deployed app reads no payment links, whatever Vercel holds.
  assert.match(source('api/index.js'), /createApp\(\{[^}]*billingEnv: PAYMENTS_CLOSED,[^}]*\}\)/);assert.match(source('api/index.js'), /const PAYMENTS_CLOSED = Object\.freeze\(\{\}\);/);
  assert.match(source('server/server.js'), /createApp\(\{ cache, errorReport: createErrorReporter\(\) \}\)/, 'npm start reports');
});

// Review fixes, 20 Oct 2026 (obs-review): what the first version left out.
const recording = () => { const reports = []; return { reports, errorReport: { enabled: true, report: async (error, context) => { reports.push({ message: error?.message, ...context }); return true; } } }; };
async function boot(t, options) {
  const server = createApp({ citySearch: { search: async () => ({ cities: [] }) }, ...options });
  server.listen(0, '127.0.0.1');await once(server, 'listening');t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('provider failures the server answers itself are reported too: sign-up, password recovery and course invitations', async (t) => {
  const { createDatabase } = await import('../server/db.js');
  const { createRepository } = await import('../server/repository.js');
  const db = createDatabase({ filename: ':memory:' });t.after(() => db.close());
  const repository = createRepository({ db });
  repository.signup = async () => { throw Object.assign(new Error('Auth provider answered 500'), { status: 500 }); };
  repository.requestPasswordRecovery = async () => ({ status: 503, code: 'recovery_unavailable', cookies: [] });
  repository.completeCourseInvitation = async () => ({ status: 503, code: 'invitation_unavailable', cookies: [] });
  const { reports, errorReport } = recording();
  const base = await boot(t, { repository, errorReport, courseParticipants: { authorize: async () => true, accept: async () => ({}) } });
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) });
  assert.equal((await post('/api/auth/signup', { fullName: 'Ana Test', email: 'ana@example.test', password: 'a-long-password-1' })).status, 502);
  assert.equal((await post('/api/auth/recovery/request', { email: 'ana@example.test' })).status, 503);
  assert.equal((await post('/api/auth/course-invitation/complete', { tokenHash: 'a'.repeat(64), password: 'a-long-password-1', fullName: 'Ana Test' })).status, 503);
  assert.deepEqual(reports.map((r) => [r.route, r.status]), [['/api/auth/signup', 502], ['/api/auth/recovery/request', 503], ['/api/auth/course-invitation/complete', 503]]);
  assert.equal(reports[0].message, 'Auth provider answered 500');assert.match(reports[1].message, /recovery_unavailable/);
});

test('an invalid SENTRY_DSN says so once in the log, without the value, and a valid one says reports are on', () => {
  const said = [];
  createErrorReporter({ dsn: '"https://key@o1.ingest.us.sentry.io/42"', log: (...args) => said.push(args.join(' ')) });
  createErrorReporter({ dsn: 'https://key@o1.ingest.us.sentry.io/42', log: (...args) => said.push(args.join(' ')) });
  createErrorReporter({ dsn: '', log: (...args) => said.push(args.join(' ')) });
  assert.equal(said.length, 2);assert.match(said[0], /SENTRY_DSN is set but is not a valid https Sentry DSN; error reports are off/);
  assert.match(said[1], /error reports are on \(Sentry project 42\)/);
  assert.equal(said.join(' ').includes('key@'), false, 'never the DSN itself');
});

test('routes keep only NODAL\'s own path words, so typed names, numbers and tokens never reach Sentry', () => {
  for (const [raw, route] of [['/api/users/Juan%20P%C3%A9rez', '/api/users/:id'], ['/api/catalog/+51-987-654-321', '/api/catalog/:id'], ['/api/x;jsessionid=abc', '/api/:id'],
    ['/api/fiiu/admin/questions', '/api/fiiu/admin/questions'], ['/payments.html', '/payments.html'], ['/fiiu-ui.js', '/fiiu-ui.js'], ['/api/courses/c1/modules', '/api/courses/:id/modules'], ['/API/Courses', '/:id/:id']]) assert.equal(routeOf(raw), route, raw);
});

test('scrubbing also covers bearer headers, Supabase keys, encoded emails and long numbers, stays fast on huge messages, and never splits a character', () => {
  for (const [text, expected] of [['Bearer abc.def-ghi', '[token]'], ['key sb_publishable_xyzABC', 'key [token]'], ['for ana%40example.test', 'for [email]'], ['call +51 987 654 321', 'call [number]'], ['DNI 45678912 refused', 'DNI [number] refused'], ["mail (o'brien@example.test)", 'mail [email]'], ['address "ana(trabajo)@gmail.com" refused', 'address "[email]" refused'], ['GET https://x.example/a?token=a1b2&lang=es failed', 'GET https://x.example/a?token=[value]&lang=[value] failed']]) assert.equal(scrub(text), expected, text);
  const started = Date.now();scrub('a'.repeat(2_000_000));scrub('@'.repeat(500_000));assert.ok(Date.now() - started < 500, 'bounded work');
  assert.equal(scrub('a'.repeat(499) + '😀').isWellFormed(), true);
});

test('Sentry asking to slow down pauses reports for as long as it says, and a thrown non-Error carries no empty stack', async () => {
  let clock = Date.parse('2026-10-20T20:00:00Z');const calls = [];
  const reporter = createErrorReporter({ dsn: DSN, now: () => clock, fetchImpl: async (url, options) => { calls.push(options.body); return calls.length === 1 ? { ok: false, status: 429, headers: { get: (name) => name.toLowerCase() === 'retry-after' ? '120' : null } } : { ok: true, status: 200 }; } });
  assert.equal(await reporter.report(failure('first'), { route: '/a' }), false);
  clock += 60_000;assert.equal(await reporter.report(failure('second'), { route: '/b' }), false);assert.equal(calls.length, 1, 'still waiting');
  clock += 61_000;assert.equal(await reporter.report('a thrown string', { route: '/c' }), true);
  const event = JSON.parse(calls[1].split('\n')[2]);assert.equal('stacktrace' in event.exception.values[0], false);assert.equal(event.exception.values[0].value, 'a thrown string');
});

test('a Vercel instance that cannot start reports why, once per failed start, and still answers 500', async (t) => {
  const { createHandler } = await import('../api/index.js');
  const { reports, errorReport } = recording();
  const handler = createHandler({ boot: async () => { throw new Error('TRUST_PROXY must be "true" or "false"'); }, reporter: errorReport });
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => handler(req, res));server.listen(0, '127.0.0.1');await once(server, 'listening');t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health?x=1`);
  assert.equal(res.status, 500);assert.deepEqual(await res.json(), { error: 'internal error' });
  assert.deepEqual(reports, [{ message: 'TRUST_PROXY must be "true" or "false"', method: 'GET', route: '/api/health', status: 500 }]);
});
