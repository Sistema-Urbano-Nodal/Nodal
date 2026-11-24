import test from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNewsEmailCron, drainNewsEmail } from '../api/cron/news-email.js';
import { deliverBatch } from '../server/news-alerts.js';

const env = { VERCEL_ENV: 'production', DATA_BACKEND: 'supabase', CRON_SECRET: 'test-worker-key' };
const delivered = { sent: 3, failed: 0, uncertain: 0, deferred: 0 };
async function request({ settings = env, authorization = 'Bearer test-worker-key', method = 'GET', run } = {}) {
  let calls = 0;
  const handler = createNewsEmailCron({ env: settings, run: async actual => {
    calls++;
    assert.equal(actual, settings);
    return run ? run() : delivered;
  }, log: { error() {}, warn() {} } });
  const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = JSON.parse(body); } };
  await handler({ method, headers: { authorization } }, response);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  return { ...response, calls };
}

test('only the authenticated production job can drain the hosted outbox', async () => {
  for (const [args, status] of [
    [{ settings: { ...env, VERCEL_ENV: 'preview' } }, 404],
    [{ settings: { ...env, CRON_SECRET: '' }, authorization: 'Bearer ' }, 401],
    [{ authorization: '' }, 401],
    [{ authorization: 'Bearer test-worker-keX' }, 401],
    [{ method: 'POST' }, 405],
    [{ method: 'HEAD' }, 405],
    [{ settings: { ...env, DATA_BACKEND: 'sqlite' } }, 503],
  ]) {
    const response = await request(args);
    assert.equal(response.statusCode, status);
    assert.equal(response.calls, 0);
  }
  const success = await request();
  assert.equal(success.statusCode, 200);
  assert.deepEqual(success.body, delivered);
  assert.equal(success.calls, 1);
});

test('the database scheduler authenticates with the Vault bearer while the deployment holds just its verifier', async () => {
  const token = randomBytes(32).toString('hex');
  const verifier = createHash('sha256').update(token).digest('hex');
  const settings = { ...env, CRON_SECRET: '', NODAL_NEWS_SCHEDULE_SHA256: verifier };
  const success = await request({ settings, authorization: 'Bearer ' + token });
  assert.equal(success.calls, 1);
  assert.equal(success.statusCode, 200);
  for (const authorization of ['Bearer ' + verifier, 'Bearer ' + '0'.repeat(64), token, 'Bearer ']) {
    const denied = await request({ settings, authorization });
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.calls, 0);
  }
  const unset = await request({ settings: { ...settings, NODAL_NEWS_SCHEDULE_SHA256: '' }, authorization: 'Bearer ' + token });
  assert.equal(unset.statusCode, 401);
});

test('cron surfaces delivery failures and returns counts without subscriber information', async () => {
  for (const kind of ['failed', 'deferred', 'uncertain']) {
    const partial = { ...delivered, [kind]: 1 };
    const response = await request({ run: () => partial });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.body, partial);
  }
  const failure = await request({ run: () => { throw new Error('private provider detail'); } });
  assert.equal(failure.statusCode, 503);
  assert.deepEqual(failure.body, { error: 'news email sender unavailable' });
});

test('the scheduled sender drains consecutive batches and stops before claiming past its deadline', async () => {
  let calls = 0;
  const counts = await drainNewsEmail(env, { alerts: {}, sendBatch: async (_alerts, { limit, deadline }) => {
    calls++;
    assert.equal(limit, 100);
    assert.ok(deadline > Date.now() && deadline <= Date.now() + 240_000);
    return { ...delivered, sent: calls === 1 ? 100 : 3 };
  } });
  assert.deepEqual(counts, { ...delivered, sent: 103 });
  assert.equal(calls, 2);
  let claims = 0;
  const expired = await deliverBatch({ alerts: { claim() { claims++; } }, origin: 'https://example.test', deadline: 0 });
  assert.equal(claims, 0);
  assert.equal(expired.sent, 0);
});

test('the quarter-hour production schedule and the manual recovery workflow use the canonical sender', () => {
  const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
  const config = JSON.parse(read('../vercel.json'));
  const workflow = read('../.github/workflows/news-email.yml');
  const rule = config.rewrites.find(route => new RegExp('^' + route.source + '$').test('/api/cron/news-email'));
  assert.equal(rule.destination, '/api/cron/news-email.js');
  assert.equal(config.functions['api/cron/news-email.js'].maxDuration, 300);
  const schedule = read('../docs/ops/news-email-schedule.sql');
  assert.match(schedule, /cron\.schedule\('nodal-publication-emails', '7,22,37,52 \* \* \* \*'/);
  assert.match(schedule, /https:\/\/sistema-urbano-nodal-ten\.vercel\.app\/api\/cron\/news-email/);
  assert.doesNotMatch(workflow, /^\s+schedule:/m);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions: \{\}/);
  assert.match(workflow, /github\.repository == 'Sistema-Urbano-Nodal\/Nodal' && github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /https:\/\/sistema-urbano-nodal-ten\.vercel\.app\/api\/cron\/news-email/);
  assert.match(workflow, /secrets\.NODAL_NEWS_CRON_SECRET/);
  assert.doesNotMatch(workflow, /uses:|pull_request/);
});
