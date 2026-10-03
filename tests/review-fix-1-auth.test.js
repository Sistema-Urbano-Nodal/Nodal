/* Sign-in, recovery, sign-up and invitation budgets: one person's (or an
   attacker's) attempts must not lock somebody else out, and the anonymous
   email-sending paths must stay under the shared email quota. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/server.js';
import { createDatabase } from '../server/db.js';
import { createRepository } from '../server/repository.js';

const PASSWORD = 'right-password';

function withTrustedProxy(t) {
  const old = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = 'true';
  t.after(() => { if (old === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = old; });
}

async function fixture(t, { loginDelayMs = 0 } = {}) {
  withTrustedProxy(t);
  const calls = [];
  const repository = {
    resolveSession: async () => ({ user: null, cookies: [] }),
    signup: async body => { calls.push({ action: 'signup', email: body.email }); return { status: 202, requiresEmailConfirmation: true, cookies: [] }; },
    login: async body => {
      calls.push({ action: 'login', email: body.email });
      if (loginDelayMs) await new Promise(resolve => setTimeout(resolve, loginDelayMs));
      return body.password === PASSWORD ? { status: 200, user: { id: 'member' }, cookies: [] } : { status: 401, error: 'invalid email or password', cookies: [] };
    },
    requestPasswordRecovery: async body => { calls.push({ action: 'recovery', email: body.email }); return { status: 202, cookies: ['nodal_recovery=verifier; HttpOnly; Path=/api/auth/recovery'] }; },
  };
  const server = createApp({ repository, courseStore: null, fiiuStore: null, newsStore: null });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body, ip) => {
    const res = await fetch(`${base}/api/auth/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, 'X-Real-IP': ip }, body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };
  return { calls, post };
}

test('wrong passwords from one address do not lock the owner out from theirs', async t => {
  const { post } = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await post('login', { email: 'organiser@example.test', password: `guess-${i}` }, '203.0.113.9')).status, 401);
  assert.equal((await post('login', { email: 'organiser@example.test', password: 'guess-x' }, '203.0.113.9')).status, 429, 'the guessing address is stopped');
  const owner = await post('login', { email: 'organiser@example.test', password: PASSWORD }, '192.0.2.50');
  assert.equal(owner.status, 200, 'the owner signs in from their own address');
});

test('successful sign-ins never spend the account budget (many door devices)', async t => {
  const { post, calls } = await fixture(t);
  for (let i = 0; i < 15; i++) assert.equal((await post('login', { email: 'door@example.test', password: PASSWORD }, `198.51.100.${i}`)).status, 200, `device ${i}`);
  for (let i = 0; i < 15; i++) assert.equal((await post('login', { email: 'door@example.test', password: PASSWORD }, '198.51.100.200')).status, 200, `same device ${i}`);
  assert.equal(calls.length, 30);
});

test('distributed guessing against one account still meets a shared ceiling', async t => {
  const { post, calls } = await fixture(t);
  for (let i = 0; i < 50; i++) assert.equal((await post('login', { email: 'target@example.test', password: `guess-${i}` }, `203.0.113.${i}`)).status, 401, `guess ${i}`);
  const blocked = await post('login', { email: 'Target@Example.test', password: 'guess-final' }, '203.0.113.250');
  assert.equal(blocked.status, 429);
  assert.match(blocked.headers.get('retry-after'), /^\d+$/);
  assert.equal(calls.length, 50);
});

test('parallel guesses from one address cannot slip past the budget', async t => {
  const { post, calls } = await fixture(t, { loginDelayMs: 40 });
  const results = await Promise.all(Array.from({ length: 25 }, (_, i) => post('login', { email: 'parallel@example.test', password: `guess-${i}` }, '203.0.113.30')));
  assert.equal(calls.length, 10, 'only the budgeted attempts reach the password check');
  assert.equal(results.filter(r => r.status === 429).length, 15);
});

test('another requester cannot use up a member\'s password-recovery budget', async t => {
  const { post, calls } = await fixture(t);
  for (let i = 0; i < 3; i++) assert.equal((await post('recovery/request', { email: 'victim@example.test' }, '203.0.113.9')).status, 202);
  const attacker = await post('recovery/request', { email: 'victim@example.test' }, '203.0.113.9');
  assert.equal(attacker.status, 429, 'the requester over its own budget is told so');
  assert.equal(attacker.body.code, 'recovery_rate');
  const victim = await post('recovery/request', { email: 'victim@example.test' }, '192.0.2.50');
  assert.equal(victim.status, 202);
  assert.match(victim.headers.get('set-cookie') || '', /nodal_recovery=/, 'the owner gets a verifier for the link sent to them');
  assert.equal(calls.filter(c => c.action === 'recovery').length, 4);
});

test('recovery for one address has an overall cap that answers honestly instead of a fake "sent"', async t => {
  const { post, calls } = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await post('recovery/request', { email: 'popular@example.test' }, `203.0.113.${i}`)).status, 202);
  const capped = await post('recovery/request', { email: 'popular@example.test' }, '192.0.2.77');
  assert.equal(capped.status, 429);
  assert.equal(capped.body.code, 'recovery_rate');
  assert.equal(calls.length, 10);
});

test('anonymous sign-ups stop below the shared email quota while sign-in keeps working', async t => {
  const { post, calls } = await fixture(t);
  for (let i = 0; i < 200; i++) {
    assert.equal((await post('signup', { fullName: 'New Person', email: `person-${i}@example.test`, password: 'long-password' }, `203.0.113.${i % 250}`)).status, 202, `signup ${i}`);
  }
  const over = await post('signup', { fullName: 'New Person', email: 'person-x@example.test', password: 'long-password' }, '192.0.2.10');
  assert.equal(over.status, 429);
  assert.match(over.body.error, /temporarily unavailable/);
  assert.match(over.headers.get('retry-after'), /^\d+$/);
  assert.equal(calls.filter(c => c.action === 'signup').length, 200, 'the provider is not asked to send the email');
  assert.equal((await post('login', { email: 'person-1@example.test', password: PASSWORD }, '192.0.2.10')).status, 200);
  assert.equal((await post('recovery/request', { email: 'person-2@example.test' }, '192.0.2.10')).status, 202, 'password recovery keeps its share of the quota');
});

test('a classroom on one network can accept its course invitations', async t => {
  withTrustedProxy(t);
  const db = createDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  const completions = [];
  const repository = {
    ...createRepository({ db }),
    async completeCourseInvitation({ tokenHash }) { completions.push(tokenHash); return { status: 200, passwordChanged: true, courseIds: [], cookies: [] }; },
  };
  const server = createApp({ repository });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const complete = tokenHash => fetch(`${base}/api/auth/course-invitation/complete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, 'X-Real-IP': '198.51.100.20' },
    body: JSON.stringify({ tokenHash, password: 'long-password', fullName: 'Student' }),
  });
  for (let i = 0; i < 30; i++) assert.equal((await complete(`token-${String(i).padStart(40, '0')}`)).status, 200, `student ${i}`);
  assert.equal(completions.length, 30);
  // One invitation still cannot be guessed at without limit.
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await complete('the-same-invitation-token-0000000000000000')).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
  assert.equal(statuses[10], 429);
});
