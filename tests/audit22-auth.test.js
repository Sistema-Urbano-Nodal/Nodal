/* Accounts findings of the 22 Oct 2026 audit (A1, A2, A3 server part). SQLite apps, and a fake GoTrue for the sign-up
   answers: nothing here reaches a real provider. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/server.js';
import { createDatabase, createUser } from '../server/db.js';
import { createSession } from '../server/auth.js';
import { createSupabaseRepository } from '../server/supabase.js';

async function listen(t, server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}
async function bootDb(t, options = {}) {
  const db = createDatabase({ filename: ':memory:' }); t.after(() => db.close());
  const base = await listen(t, createApp({ db, fiiuConfirmation: null, fiiuPartyNotice: null, citySearch: { search: async () => ({ cities: [] }) }, ...options }));
  const member = (email = 'ana@example.test') => {
    const user = createUser(db, { fullName: 'Ana Pérez', email, passwordHash: 'unused' });
    return { user, cookie: createSession(db, user.id).cookie.split(';')[0] };
  };
  return { db, base, member };
}
const quietly = t => { const error = console.error; console.error = () => {}; t.after(() => { console.error = error; }); };

/* A confirmation link lands on /login.html#access_token=…&refresh_token=…. A browser that is already signed in is sent
   on, and a Location without a fragment keeps the old one (RFC 9110 §10.2.2): the new account's tokens would sit in
   the dashboard's address and history. An explicit empty fragment drops them; a destination's own fragment stays. */
test('a signed-in visit to sign-in is sent on with an empty fragment, so a confirmation link\'s tokens never follow', async t => {
  const { base, member } = await bootDb(t);
  const { cookie } = member();
  const location = async path => (await fetch(base + path, { redirect: 'manual', headers: { Cookie: cookie } })).headers.get('location');
  assert.equal(await location('/login.html'), '/dashboard.html#');
  assert.equal(await location('/login.html?next=' + encodeURIComponent('/courses.html?id=c1')), '/courses.html?id=c1#');
  assert.equal(await location('/login.html?next=' + encodeURIComponent('/courses.html#module-2')), '/courses.html#module-2');
  // The unsafe-target fallback is the dashboard, with the empty fragment too.
  assert.equal(await location('/login.html?next=' + encodeURIComponent('//evil.example')), '/dashboard.html#');
});

const goTrueEnv = { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-test-key', SUPABASE_SECRET_KEY: 'server-test-key', PUBLIC_BASE_URL: 'https://nodal.example' };
async function signupAgainst(t, status, payload) {
  const fetchImpl = async raw => {
    if (new URL(raw).pathname === '/auth/v1/signup') return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
    throw new Error('unexpected provider call ' + raw);
  };
  const base = await listen(t, createApp({ repository: createSupabaseRepository({ env: goTrueEnv, fetchImpl }), courseStore: null, fiiuStore: null, newsStore: null }));
  return fetch(base + '/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: 'Ana Pérez', email: 'ana@gmail.con', password: 'password123' }) });
}

/* The provider's own address and password checks used to come back as "If you already confirmed your email, sign in",
   which sends a person with a typo or a breached password to a sign-in that cannot work. */
test('a sign-up the provider refuses for its address says the email is not valid', async t => {
  quietly(t);
  for (const [status, payload] of [
    [400, { code: 400, error_code: 'email_address_invalid', msg: 'Email address "ana@gmail.con" is invalid' }],
    [400, { code: 400, error_code: 'validation_failed', msg: 'Unable to validate email address: invalid format' }],
  ]) {
    const response = await signupAgainst(t, status, payload);
    assert.equal(response.status, 400, payload.error_code);
    // The exact wording web/scripts/auth.js shows as "Enter a valid email address."
    assert.deepEqual(await response.json(), { error: 'valid email is required' });
  }
});

test('a sign-up the provider refuses for a weak password says so, with a code the page translates', async t => {
  quietly(t);
  const response = await signupAgainst(t, 422, { code: 422, error_code: 'weak_password', msg: 'Password is known to be weak and easy to guess, please choose a different one.', weak_password: { reasons: ['pwned'] } });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'password is too weak', code: 'weak_password' });
});

test('other provider refusals at sign-up keep their answer', async t => {
  quietly(t);
  const response = await signupAgainst(t, 422, { code: 422, error_code: 'signup_disabled', msg: 'Signups not allowed for this instance' });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, 'Account creation could not be completed. If you already confirmed your email, sign in.');
});

/* The console shows these refusals in the member's language, so each carries a code; the English text stays for
   older pages. */
test('account deletion refusals carry a code the console can translate', async t => {
  const del = (base, cookie, confirmEmail) => fetch(base + '/api/me', { method: 'DELETE', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmEmail }) });
  {
    const { base, member } = await bootDb(t);
    const { cookie } = member();
    const typo = await del(base, cookie, 'ana@example.tset');
    assert.equal(typo.status, 400);
    assert.deepEqual(await typo.json(), { error: 'account deletion requires email confirmation', code: 'confirm_email_mismatch' });
  }
  const now = () => new Date().toISOString();
  {
    // A festival photo still uploading.
    const talkStore = { userFiles: async () => [{ id: 'f1', status: 'pending', createdAt: now() }] };
    const { base, member } = await bootDb(t, { talkStore, courseStore: null });
    const { cookie } = member();
    const busy = await del(base, cookie, 'ana@example.test');
    assert.equal(busy.status, 409);
    assert.deepEqual(await busy.json(), { error: 'An upload is in progress. Try again in a few minutes.', code: 'upload_in_progress' });
  }
  {
    // A course certificate an organiser is uploading for this member.
    const courseStore = { find: async name => name === 'certificates' ? [{ id: 'c1', status: 'pending', createdAt: now() }] : [] };
    const { base, member } = await bootDb(t, { talkStore: null, courseStore });
    const { cookie } = member();
    const busy = await del(base, cookie, 'ana@example.test');
    assert.equal(busy.status, 409);
    assert.equal((await busy.json()).code, 'certificate_upload_in_progress');
  }
  {
    // A course file left pending needs the teaching team: a code of its own, which the console may not know yet.
    const courseStore = { find: async name => name === 'attachments' ? [{ id: 'a1', status: 'pending', createdAt: now() }] : [] };
    const { base, member } = await bootDb(t, { talkStore: null, courseStore });
    const { cookie } = member();
    const pending = await del(base, cookie, 'ana@example.test');
    assert.equal(pending.status, 409);
    assert.equal((await pending.json()).code, 'upload_awaiting_reconciliation');
  }
});
