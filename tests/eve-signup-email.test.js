import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createSupabaseRepository } from '../server/supabase.js';
import { createApp } from '../server/server.js';

/* GoTrue sends the confirmation email inside the sign-up and rolls the new account back when the mail server refuses
   it (a sending quota at the 09:00 door rush, say). Nothing exists yet, so "if you already confirmed your email, sign
   in" sends the walk-in to a sign-in that cannot work; they are told the email could not be sent instead. */
const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-test-key', SUPABASE_SECRET_KEY: 'server-test-key', PUBLIC_BASE_URL: 'https://nodal.example' };
const reply = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function goTrue(answers) {
  const calls = [];
  const fetchImpl = async (raw, options) => {
    const url = new URL(raw);
    calls.push(url.pathname);
    const answer = answers[url.pathname];
    if (answer) return reply(...answer);
    throw new Error('Unexpected provider call ' + url.pathname);
  };
  return { calls, repository: createSupabaseRepository({ env, fetchImpl }) };
}
async function boot(t, repository) {
  const server = createApp({ repository, courseStore: null, fiiuStore: null, newsStore: null });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  return 'http://127.0.0.1:' + server.address().port;
}
const post = (base, path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const quietly = t => { const error = console.error; console.error = () => {}; t.after(() => { console.error = error; }); };

test('a sign-up whose confirmation email could not be sent says the email is unavailable, never to sign in', async t => {
  quietly(t);
  for (const msg of ['Error sending confirmation email', 'Error sending confirmation mail', 'Error sending confirmation email: 550 5.4.5 Daily user sending limit exceeded']) {
    const { calls, repository } = goTrue({ '/auth/v1/signup': [{ code: 500, error_code: 'unexpected_failure', msg }, 500] });
    const base = await boot(t, repository);
    const response = await post(base, '/api/auth/signup', { fullName: 'Walk In', email: 'walk.in@example.test', password: 'correct-horse' });
    assert.equal(response.status, 503, msg);
    assert.match(response.headers.get('retry-after'), /^\d+$/);
    const body = await response.json();
    // The exact wording web/scripts/auth.js turns into its confirmationUnavailable message.
    assert.equal(body.error, 'Confirmation email is temporarily unavailable. Please try again later.');
    assert.doesNotMatch(JSON.stringify(body), /sign in|5\.4\.5|sending limit/i);
    assert.deepEqual(calls, ['/auth/v1/signup']);
  }
});

test('other provider failures on sign-up keep their answer', async t => {
  quietly(t);
  const { repository } = goTrue({ '/auth/v1/signup': [{ code: 500, error_code: 'unexpected_failure', msg: 'Database error saving new user' }, 500] });
  const base = await boot(t, repository);
  const response = await post(base, '/api/auth/signup', { fullName: 'Walk In', email: 'walk.in@example.test', password: 'correct-horse' });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'Account creation could not be completed. If you already confirmed your email, sign in.');
});

test('a recovery email the provider could not send answers recovery_unavailable and keeps the browser verifier', async t => {
  quietly(t);
  const { calls, repository } = goTrue({ '/auth/v1/recover': [{ code: 500, error_code: 'unexpected_failure', msg: 'Error sending recovery email' }, 500] });
  const base = await boot(t, repository);
  const response = await post(base, '/api/auth/recovery/request', { email: 'member@example.test' });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, code: 'recovery_unavailable' });
  assert.match(response.headers.getSetCookie().join('\n'), /nodal_recovery=[^;]+/);
  assert.deepEqual(calls, ['/auth/v1/recover']);
});
