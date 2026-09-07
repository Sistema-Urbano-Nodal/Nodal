import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseRepository } from '../server/supabase.js';
import { createRepository } from '../server/repository.js';
import { createDatabase, createUser } from '../server/db.js';

const USER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const EMAIL = 'student@example.test';
const HASH = 'a'.repeat(56);
const env = {
  NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://nodal.example.test',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key', SUPABASE_SECRET_KEY: 'server-key',
};
const json = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status });
function provider(options = {}) {
  const calls = [];
  const state = {
    profile: { id: USER, email: EMAIL, full_name: 'Original name', account_status: 'active', app_role: 'member' },
    authUser: { id: USER, email: EMAIL, email_confirmed_at: '2026-09-01T12:00:00Z', is_anonymous: false, user_metadata: {} },
    used: false, password: null, ...options,
  };
  const repo = createSupabaseRepository({ env: { ...env, ...options.env }, fetchImpl: async (raw, init) => {
    const url = new URL(raw), body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, init, body });
    if (url.pathname === '/auth/v1/invite') {
      if (state.inviteError) return json({ message: 'provider detail', error_code: 'over_email_send_rate_limit' }, state.inviteError);
      return json(state.invitedUser || state.authUser);
    }
    if (url.pathname.startsWith('/auth/v1/admin/users/')) return json(state.authUser);
    if (url.pathname === '/auth/v1/verify') {
      if (state.verifyError) return json({ message: 'provider detail' }, state.verifyError);
      if (state.used) return json({ message: 'expired' }, 403);
      state.used = true;
      return json({ access_token: 'trusted-access', refresh_token: 'trusted-refresh', user: state.authUser });
    }
    if (url.pathname === '/auth/v1/user' && init.method === 'PUT') {
      if (state.passwordThrow) throw new Error('connection lost after provider may have committed');
      if (state.passwordError) return json({ message: 'provider password policy' }, state.passwordError);
      state.password = body.password;
      state.authUser.user_metadata = { ...state.authUser.user_metadata, ...body.data };
      return json(state.authUser);
    }
    if (url.pathname === '/auth/v1/logout') return json(null, state.logoutError || 204);
    if (url.pathname === '/rest/v1/profiles') {
      if (init.method === 'POST') {
        state.profile ||= { ...body[0], account_status: 'active', app_role: 'member' };
        return json(null);
      }
      if (init.method === 'PATCH') {
        if (state.profileUpdateError) return json({ message: 'database unavailable' }, 503);
        state.profile = { ...state.profile, ...body }; return json([state.profile]);
      }
      return json(state.profiles || (state.profile ? [state.profile] : []));
    }
    if (url.pathname === '/rest/v1/profile_preferences') return json(init.method === 'POST' ? null : [{ user_id: USER }]);
    if (url.pathname === '/rest/v1/onboarding_responses') return json([]);
    throw new Error('Unexpected provider path: ' + url.pathname);
  } });
  return { repo, state, calls };
}
const input = (overrides = {}) => ({
  tokenHash: HASH, password: 'new-password-123', fullName: 'Student Name',
  authorize: async () => true, enroll: async () => ['course-1'], ...overrides,
});
const writesPassword = calls => calls.some(c => c.url.pathname === '/auth/v1/user' && c.init.method === 'PUT');
const assertNoSessionLeaks = result => {
  assert.ok(!JSON.stringify(result).includes('trusted-'));
  assert.ok((result.cookies || []).every(cookie => !/nodal_(?:session|refresh)=[^;]/.test(cookie)));
};

test('course account lookup normalizes case and verifies identity against Auth, not just profile email', async () => {
  const { repo, calls } = provider({ profile: { id: USER, email: 'Student@Example.Test', full_name: 'Existing Student', account_status: 'active' } });
  assert.deepEqual(await repo.findCourseAccount(' STUDENT@example.test '), { id: USER, email: EMAIL, name: 'Existing Student', confirmed: true, active: true });
  assert.equal(calls.find(c => c.url.pathname.startsWith('/auth/v1/admin/users/')).url.pathname, '/auth/v1/admin/users/' + USER);
});

test('course account lookup distinguishes absent, unconfirmed and disabled users', async () => {
  assert.equal(await provider({ profile: null }).repo.findCourseAccount(EMAIL), null);
  assert.equal((await provider({ authUser: { id: USER, email: EMAIL, email_confirmed_at: null } }).repo.findCourseAccount(EMAIL)).confirmed, false);
  for (const account_status of ['disabled', 'pending', 'unexpected']) {
    const account = await provider({ profile: { id: USER, email: EMAIL, full_name: 'Student', account_status } }).repo.findCourseAccount(EMAIL);
    assert.equal(account.active, false);
  }
  assert.equal((await provider({ authUser: { id: USER, email: EMAIL, email_confirmed_at: '2026-09-01T00:00:00Z', banned_until: '2999-01-01T00:00:00Z' } }).repo.findCourseAccount(EMAIL)).active, false);
});

test('course account lookup treats literal asterisks, plus signs and dots as email characters', async () => {
  const { repo, calls } = provider({ profile: null });
  assert.equal(await repo.findCourseAccount(' Team+*_%@Example.Test '), null);
  assert.equal(calls[0].url.searchParams.get('email'), 'imatch.^team\\+\\*_%@example\\.test$');
});

test('course account lookup fails closed for stale Auth email, wrong id or ambiguous profiles', async () => {
  for (const setup of [
    { authUser: { id: USER, email: 'other@example.test', email_confirmed_at: '2026-09-01T00:00:00Z' } },
    { authUser: { id: OTHER, email: EMAIL, email_confirmed_at: '2026-09-01T00:00:00Z' } },
    { profiles: [{ id: USER, email: EMAIL }, { id: OTHER, email: EMAIL }] },
    { profile: { id: USER, email: 'other@example.test', full_name: 'Other' } },
  ]) await assert.rejects(provider(setup).repo.findCourseAccount(EMAIL), { status: 409 });
});

test('SQLite account lookup supports admin enrollment without pretending to deliver invitations', async t => {
  const db = createDatabase({ filename: ':memory:' }); t.after(() => db.close());
  const student = createUser(db, { fullName: 'Student', email: EMAIL, passwordHash: 'unused' });
  const repo = createRepository({ db });
  assert.deepEqual(await repo.findCourseAccount(' STUDENT@example.test '), { id: student.id, email: EMAIL, name: 'Student', confirmed: true, active: true });
  db.prepare("UPDATE users SET account_status='disabled' WHERE id=?").run(student.id);
  assert.equal((await repo.findCourseAccount(EMAIL)).active, false);
  assert.equal(await repo.findCourseAccount('missing@example.test'), null);
  assert.equal(repo.sendCourseInvitation, undefined);
});

test('native invite delivery uses server credentials and only the configured canonical callback', async () => {
  const { repo, calls } = provider();
  assert.deepEqual(await repo.sendCourseInvitation({ email: ' STUDENT@example.test ', redirectTo: 'https://attacker.test' }), { id: USER, email: EMAIL });
  const call = calls[0];
  assert.equal(call.url.pathname, '/auth/v1/invite');
  assert.equal(call.url.searchParams.get('redirect_to'), 'https://nodal.example.test/accept-invitation.html');
  assert.equal(call.init.headers.apikey, 'server-key');
  assert.deepEqual(call.body, { email: EMAIL });
  assert.ok(call.init.signal instanceof AbortSignal);
});

test('native invite delivery rejects untrusted callback configuration and mismatched provider identity', async () => {
  for (const base of ['', 'http://insecure.test', 'https://name:secret@nodal.example.test']) {
    const { repo, calls } = provider({ env: { PUBLIC_BASE_URL: base } });
    await assert.rejects(repo.sendCourseInvitation({ email: EMAIL }));
    assert.equal(calls.length, 0);
  }
  await assert.rejects(provider({ invitedUser: { id: OTHER, email: 'other@example.test' } }).repo.sendCourseInvitation({ email: EMAIL }));
  await assert.rejects(provider({ inviteError: 429 }).repo.sendCourseInvitation({ email: EMAIL }), { status: 429 });
});

test('invitation acceptance verifies the one-time hash, authorizes its owner, sets their password, then enrolls', async () => {
  const { repo, state, calls } = provider({ profile: null });
  const result = await repo.completeCourseInvitation(input({
    authorize: async user => { assert.equal(user.id, USER); assert.equal(state.password, null); return true; },
    enroll: async user => { assert.equal(user.id, USER); assert.equal(state.password, 'new-password-123'); return ['course-1']; },
  }));
  assert.equal(result.status, 200); assert.equal(result.passwordChanged, true); assert.deepEqual(result.courseIds, ['course-1']);
  assert.equal(calls[0].url.pathname, '/auth/v1/verify');
  assert.deepEqual(calls[0].body, { type: 'invite', token_hash: HASH });
  assert.equal(calls[0].init.headers.apikey, 'public-key');
  const password = calls.find(c => c.url.pathname === '/auth/v1/user');
  assert.equal(password.init.headers.Authorization, 'Bearer trusted-access');
  assert.deepEqual(password.body, { password: 'new-password-123', data: { full_name: 'Student Name' } });
  assert.ok(calls.some(c => c.url.pathname === '/auth/v1/logout' && c.url.searchParams.get('scope') === 'global'));
  assert.equal(state.profile.app_role, 'member');
  assert.equal(state.profile.full_name, 'Student Name');
  assertNoSessionLeaks(result);
});

test('invitation acceptance never accepts client bearer tokens or malformed form values', async () => {
  for (const patch of [
    { tokenHash: undefined, accessToken: 'attacker-token' }, { tokenHash: '../invalid' },
    { password: 'short' }, { password: 'x'.repeat(161) },
    { fullName: '' }, { fullName: 'x'.repeat(121) }, { fullName: 'Student\nInjected' },
    { authorize: undefined }, { enroll: undefined },
  ]) {
    const { repo, calls } = provider(); const result = await repo.completeCourseInvitation(input(patch));
    assert.equal(result.status, 400); assert.equal(calls.length, 0); assertNoSessionLeaks(result);
  }
});

test('invitee name replaces an old unconfirmed signup name without changing permissions', async () => {
  const { repo, state } = provider();
  assert.equal((await repo.completeCourseInvitation(input())).status, 200);
  assert.equal(state.profile.full_name, 'Student Name');
  assert.equal(state.profile.preferred_name, 'Student');
  assert.equal(state.profile.app_role, 'member');
});

test('invitation acceptance rejects unconfirmed, anonymous, mismatched and suspended accounts before password mutation', async () => {
  for (const setup of [
    { authUser: { id: USER, email: EMAIL, email_confirmed_at: null } },
    { authUser: { id: USER, email: EMAIL, email_confirmed_at: '2026-09-01T00:00:00Z', is_anonymous: true } },
    { authUser: { id: USER, email: EMAIL, email_confirmed_at: '2026-09-01T00:00:00Z', banned_until: '2999-01-01T00:00:00Z' } },
    { profile: { id: USER, email: 'other@example.test', account_status: 'active' } },
    { profile: { id: USER, email: EMAIL, account_status: 'disabled' } },
  ]) {
    const { repo, calls } = provider(setup); let enrolled = false;
    const result = await repo.completeCourseInvitation(input({ enroll: async () => { enrolled = true; return []; } }));
    assert.ok(result.status >= 400); assert.equal(writesPassword(calls), false); assert.equal(enrolled, false); assertNoSessionLeaks(result);
  }
});

test('missing or different invitation owner cannot authorize a password change', async () => {
  for (const authorize of [async () => false, async () => ({ ok: true }), async () => { throw new Error('database unavailable'); }]) {
    const { repo, calls } = provider();
    const result = await repo.completeCourseInvitation(input({ authorize }));
    assert.ok(result.status >= 400); assert.equal(writesPassword(calls), false); assertNoSessionLeaks(result);
    assert.ok(calls.some(c => c.url.pathname === '/auth/v1/logout'), 'discard the temporary verified session');
  }
});

test('expired or consumed invitation hashes cannot repeat password changes', async () => {
  const { repo, calls } = provider();
  assert.equal((await repo.completeCourseInvitation(input())).status, 200);
  const result = await repo.completeCourseInvitation(input({ password: 'second-password' }));
  assert.equal(result.status, 400);
  assert.equal(calls.filter(c => c.url.pathname === '/auth/v1/user').length, 1);
  assertNoSessionLeaks(result);
});

test('provider verify failures do not leak provider details or write passwords', async () => {
  for (const status of [403, 429, 500]) {
    const { repo, calls } = provider({ verifyError: status });
    const result = await repo.completeCourseInvitation(input());
    assert.ok(result.status >= 400); assert.equal(writesPassword(calls), false);
    assert.equal(JSON.stringify(result).includes('provider detail'), false); assertNoSessionLeaks(result);
  }
});

test('consumed hash plus rejected or uncertain password update reports failure and does not enroll', async () => {
  for (const setup of [{ passwordError: 422 }, { passwordThrow: true }]) {
    const { repo, calls } = provider(setup); let enrolled = false;
    const result = await repo.completeCourseInvitation(input({ enroll: async () => { enrolled = true; return []; } }));
    assert.ok(result.status >= 400); assert.equal(enrolled, false); assertNoSessionLeaks(result);
    assert.ok(calls.some(c => c.url.pathname === '/auth/v1/logout'));
    assert.equal((await repo.completeCourseInvitation(input())).status, 400);
  }
});

test('post-password enrollment or session revocation failures preserve the successful password outcome', async () => {
  for (const setup of [{}, { logoutError: 503 }]) {
    const { repo, state } = provider(setup);
    const result = await repo.completeCourseInvitation(input({ enroll: setup.logoutError ? async () => ['course-1'] : async () => { throw new Error('database unavailable'); } }));
    assert.equal(result.status, 200); assert.equal(result.passwordChanged, true); assert.equal(result.code, 'invitation_partial');
    assert.equal(state.password, 'new-password-123'); assertNoSessionLeaks(result);
  }
});

test('profile name persistence failure is reported after password success but still attempts enrollment', async () => {
  const { repo } = provider({ profileUpdateError: true });
  const result = await repo.completeCourseInvitation(input());
  assert.equal(result.status, 200); assert.equal(result.passwordChanged, true); assert.equal(result.code, 'invitation_partial');
  assert.deepEqual(result.courseIds, ['course-1']);
});
