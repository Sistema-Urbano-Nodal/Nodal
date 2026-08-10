import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSupabaseRepository,
  createSupabaseClients,
  publicSupabaseConfig,
  resolveSupabaseEnv,
} from '../server/supabase.js';
import { decodeCatalogCursor, decodeCatalogInterestCursor, localizeCatalogItem } from '../server/catalog.js';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

const testEnv = () => ({
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-public-key',
  SUPABASE_SECRET_KEY: 'test-server-key',
});

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => payload,
    text: async () => (payload === null ? '' : JSON.stringify(payload)),
  };
}

function profileState() {
  return {
    profile: {
      id: TEST_USER_ID,
      full_name: 'Persisted Member',
      preferred_name: 'Persisted',
      email: 'persisted@example.com',
      public_role: 'Urban Researcher',
      app_role: 'admin',
      city_region: 'Lima',
      bio: 'Original bio',
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z',
    },
    preferences: {
      user_id: TEST_USER_ID,
      visibility: { directory: true },
      notification_preferences: { dashboardRead: true },
      data_consent: { directoryPublic: true },
    },
    onboarding: {
      user_id: TEST_USER_ID,
      interests: ['mobility'],
      skills: ['research'],
      goals: ['build a coalition'],
      contribution_preferences: ['pm'],
      availability: '2 h / month',
      mentoring_interest: 'none',
      raw_answers: {
        title: 'Urban Researcher',
        active: ['pm'],
        topics: [{ name: 'Mobility', level: 2, validatedAt: 0, endorsedAt: 0 }],
        indicators: { leadership: 'Regularly', transmission: 'No' },
        partC: {
          bio: 'Original bio',
          linkedin: 'https://www.linkedin.com/in/persisted-member',
          portfolio: 'https://example.com/work',
          references: 'Available',
          availability: '2 h / month',
          consent: true,
        },
        requests: { knowledge: true },
        mentorApplied: false,
        assessed: true,
        notifRead: true,
      },
    },
    catalogInterests: [{
      id: 'interest-1', item_id: 'catalog-1', user_id: TEST_USER_ID, message: 'Please contact me.', status: 'new', version: 1,
      created_at: '2030-05-01T00:00:00.000Z', updated_at: '2030-05-01T00:00:00.000Z', updated_by: TEST_USER_ID,
    }],
  };
}

function statefulFetch(state, calls, { expireAccessToken = false, signupResponse = null } = {}) {
  let accessAttempted = false;
  return async (rawUrl, options) => {
    const url = new URL(rawUrl);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, options, body });

    if (url.pathname === '/auth/v1/signup' && signupResponse) {
      return response(signupResponse);
    }
    if (url.pathname === '/auth/v1/user') {
      if (expireAccessToken && !accessAttempted) {
        accessAttempted = true;
        return response({ message: 'expired token' }, 401);
      }
      return response({ user: { id: TEST_USER_ID, email: state.profile.email, user_metadata: {} } });
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      return response({
        access_token: 'signed-in-access',
        refresh_token: 'signed-in-refresh',
        expires_in: 3600,
        user: { id: TEST_USER_ID, email: state.profile.email, user_metadata: {} },
      });
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      return response({
        access_token: 'refreshed-access',
        refresh_token: 'refreshed-refresh',
        expires_in: 3600,
        user: { id: TEST_USER_ID, email: state.profile.email, user_metadata: {} },
      });
    }

    const table = url.pathname.replace('/rest/v1/', '');
    if (method === 'GET') {
      if (table === 'profiles') return response([state.profile]);
      if (table === 'profile_preferences') return response([state.preferences]);
      if (table === 'onboarding_responses') return response([state.onboarding]);
      if (table === 'catalog_interests') return response(state.catalogInterests || []);
      if (table === 'member_follows' || table === 'member_interactions' || table === 'stripe_customers') return response([]);
    }
    if (table === 'profiles' && method === 'POST') return response([state.profile]);
    if (table === 'profiles' && method === 'PATCH') {
      state.profile = { ...state.profile, ...body };
      return response([state.profile]);
    }
    if (table === 'profile_preferences' && method === 'POST') {
      if (!options.headers.Prefer.includes('resolution=ignore-duplicates')) {
        state.preferences = { ...state.preferences, ...body[0] };
      }
      return response([]);
    }
    if (table === 'onboarding_responses' && method === 'POST') {
      state.onboarding = { ...state.onboarding, ...body[0] };
      return response([]);
    }
    throw new Error(`unexpected Supabase request: ${method} ${url.pathname}`);
  };
}

test('Supabase env accepts publishable key and keeps the secret server-only', () => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co/',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-public-key',
    SUPABASE_SECRET_KEY: 'test-server-key',
  };

  assert.deepEqual(publicSupabaseConfig(env), {
    url: 'https://project.supabase.co',
    publishableKey: 'test-public-key',
  });

  const resolved = resolveSupabaseEnv(env, { requireServer: true });
  assert.equal(resolved.url, 'https://project.supabase.co');
  assert.equal(resolved.publishableKey, 'test-public-key');
  assert.equal(resolved.serverKey, 'test-server-key');
  assert.equal(JSON.stringify(publicSupabaseConfig(env)).includes('test-server-key'), false);
});

test('Supabase env supports legacy anon/service_role names without browser exposure', () => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://legacy.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'legacy-anon-jwt',
    SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role-jwt',
  };

  const resolved = resolveSupabaseEnv(env, { requireServer: true });
  assert.equal(resolved.publishableKey, 'legacy-anon-jwt');
  assert.equal(resolved.serverKey, 'legacy-service-role-jwt');
  assert.deepEqual(publicSupabaseConfig(env), {
    url: 'https://legacy.supabase.co',
    publishableKey: 'legacy-anon-jwt',
  });
});

test('Supabase clients send service credentials only from the server client', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ([]),
      text: async () => '[]',
    };
  };
  const clients = createSupabaseClients({
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-public-key',
      SUPABASE_SECRET_KEY: 'test-server-key',
    },
    fetchImpl,
  });

  await clients.browser.rest('profiles', { query: { select: 'id' } });
  await clients.admin.rest('profiles', { query: { select: 'id' } });

  assert.equal(calls[0].options.headers.apikey, 'test-public-key');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-public-key');
  assert.equal(calls[1].options.headers.apikey, 'test-server-key');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-server-key');
});

test('Supabase signup accepts the direct user response used by email confirmation', async () => {
  const state = profileState();
  const calls = [];
  const repo = createSupabaseRepository({
    env: testEnv(),
    fetchImpl: statefulFetch(state, calls, {
      signupResponse: {
        id: TEST_USER_ID,
        email: state.profile.email,
        user_metadata: { full_name: state.profile.full_name },
        confirmation_sent_at: '2026-07-10T12:00:00.000Z',
      },
    }),
  });

  const result = await repo.signup({
    fullName: state.profile.full_name,
    email: state.profile.email,
    password: 'correct-horse',
  });

  assert.equal(result.status, 202);
  assert.equal(result.requiresEmailConfirmation, true);
  assert.equal(result.user.id, TEST_USER_ID);
  assert.deepEqual(result.cookies, []);
});

test('Supabase repeated signup skips profile writes for an obfuscated user', async () => {
  const state = profileState();
  const calls = [];
  const repo = createSupabaseRepository({
    env: testEnv(),
    fetchImpl: statefulFetch(state, calls, {
      signupResponse: {
        id: 'f8bf7ca9-1340-4e99-a709-93c08047bb49',
        email: state.profile.email,
        user_metadata: {},
        identities: [],
      },
    }),
  });

  const result = await repo.signup({
    fullName: state.profile.full_name,
    email: state.profile.email,
    password: 'correct-horse',
  });

  assert.equal(result.status, 202);
  assert.equal(result.requiresEmailConfirmation, true);
  assert.equal(result.user, null);
  assert.deepEqual(result.cookies, []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/auth/v1/signup');
});

test('Supabase env rejects secret-looking keys in public config', () => {
  assert.throws(() => publicSupabaseConfig({
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ['sb', 'secret', 'wrongplace'].join('_'),
  }), /public Supabase key must not be a secret key/);
});

test('Supabase session reads an existing profile without initialization writes', async () => {
  const state = profileState();
  const calls = [];
  const repo = createSupabaseRepository({
    env: testEnv(),
    fetchImpl: statefulFetch(state, calls),
  });

  const resolved = await repo.resolveSession({
    headers: { cookie: 'nodal_session=valid-access' },
  });

  assert.equal(resolved.user.title, 'Urban Researcher');
  assert.equal(resolved.user.partC.consent, true);
  const initializationWrites = calls.filter(({ options }) => options.method === 'POST')
    .filter(({ url }) => ['/rest/v1/profiles', '/rest/v1/profile_preferences'].includes(url.pathname));
  assert.equal(initializationWrites.length, 0);
});

test('Supabase session repairs missing preferences without overwriting profile data', async () => {
  const state = profileState();
  state.preferences = null;
  const calls = [];
  const repo = createSupabaseRepository({
    env: testEnv(),
    fetchImpl: statefulFetch(state, calls),
  });

  const resolved = await repo.resolveSession({
    headers: { cookie: 'nodal_session=valid-access' },
  });

  assert.equal(resolved.user.title, 'Urban Researcher');
  const initializationWrites = calls.filter(({ options }) => options.method === 'POST')
    .filter(({ url }) => ['/rest/v1/profiles', '/rest/v1/profile_preferences'].includes(url.pathname));
  assert.equal(initializationWrites.length, 2);
  for (const call of initializationWrites) {
    assert.match(call.options.headers.Prefer, /resolution=ignore-duplicates/);
  }
});

test('Supabase partial profile updates preserve nested profile state and goals', async () => {
  const state = profileState();
  const calls = [];
  const repo = createSupabaseRepository({
    env: testEnv(),
    fetchImpl: statefulFetch(state, calls),
  });

  const updated = await repo.updateUserProfile(TEST_USER_ID, {
    partC: { bio: 'Updated bio' },
  });

  const onboardingWrite = calls.find(({ url, options }) =>
    url.pathname === '/rest/v1/onboarding_responses' && options.method === 'POST');
  assert.equal(onboardingWrite.body[0].goals[0], 'build a coalition');
  assert.equal(onboardingWrite.body[0].raw_answers.partC.bio, 'Updated bio');
  assert.equal(onboardingWrite.body[0].raw_answers.partC.consent, true);
  assert.equal(onboardingWrite.body[0].raw_answers.partC.linkedin, 'https://www.linkedin.com/in/persisted-member');
  assert.equal(updated.partC.consent, true);
  assert.deepEqual(updated.goals, ['build a coalition']);
});

test('Supabase profile updates preserve validation markers and enforce mentor eligibility', async () => {
  const state = profileState();
  const calls = [];
  const repo = createSupabaseRepository({
    env: testEnv(),
    fetchImpl: statefulFetch(state, calls),
  });

  const updated = await repo.updateUserProfile(TEST_USER_ID, {
    topics: [{ name: 'Mobility', level: 4, validatedAt: 4, endorsedAt: 4 }],
    indicators: { leadership: 'Regularly', transmission: 'No' },
    mentorApplied: true,
    assessed: true,
  });

  assert.deepEqual(updated.topics, [{
    name: 'Mobility',
    level: 3,
    validatedAt: 0,
    endorsedAt: 0,
  }]);
  assert.equal(updated.mentorApplied, false);
});

test('Supabase session resolution refreshes an expired access token', async () => {
  const state = profileState();
  const calls = [];
  const repo = createSupabaseRepository({
    env: testEnv(),
    fetchImpl: statefulFetch(state, calls, { expireAccessToken: true }),
  });

  const resolved = await repo.resolveSession({
    headers: { cookie: 'nodal_session=expired; nodal_refresh=valid-refresh' },
  });

  assert.equal(resolved.user.id, TEST_USER_ID);
  assert.ok(calls.some(({ url }) => url.pathname === '/auth/v1/token'
    && url.searchParams.get('grant_type') === 'refresh_token'));
  assert.ok(resolved.cookies.some((cookie) => cookie.startsWith('nodal_session=refreshed-access')));
  assert.ok(resolved.cookies.some((cookie) => cookie.startsWith('nodal_refresh=refreshed-refresh')));
});

test('Supabase applies a Stripe event through one database RPC', async () => {
  const calls = [];
  const fetchImpl = async (rawUrl, options) => {
    const url = new URL(rawUrl);
    calls.push({ url, options, body: JSON.parse(options.body) });
    return response([{
      user_id: TEST_USER_ID,
      subscription_status: 'active',
      updated_at: '2026-07-10T00:00:00.000Z',
    }]);
  };
  const repo = createSupabaseRepository({ env: testEnv(), fetchImpl });

  const result = await repo.applyStripeEvent({
    eventId: 'evt_rpc',
    eventType: 'checkout.session.completed',
    eventCreated: 300,
    eventRank: 10,
    userId: TEST_USER_ID,
    stripeCustomerId: 'cus_rpc',
    stripeSubscriptionId: 'sub_rpc',
    stripeCheckoutSessionId: 'cs_rpc',
    status: 'active',
  });

  assert.equal(result.status, 'active');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/rest/v1/rpc/apply_stripe_event');
  assert.equal(calls[0].body.p_event_id, 'evt_rpc');
  assert.equal(calls[0].body.p_event_rank, 10);
});

test('Supabase rejects a bad sign-in in our own words, not the provider\'s', async () => {
  const repository = createSupabaseRepository({
    env: testEnv(),
    fetchImpl: async () => response({
      code: 400,
      error_code: 'invalid_credentials',
      msg: 'Invalid login credentials',
    }, 400),
  });
  const result = await repository.login({ email: 'someone@example.com', password: 'nope' });
  assert.equal(result.status, 401);
  assert.equal(result.error, 'invalid email or password');
  assert.deepEqual(result.cookies, []);
});

test('Supabase says plainly when the email was never confirmed', async () => {
  const repository = createSupabaseRepository({
    env: testEnv(),
    fetchImpl: async () => response({ error_code: 'email_not_confirmed', msg: 'Email not confirmed' }, 400),
  });
  const result = await repository.login({ email: 'someone@example.com', password: 'correct-horse' });
  assert.equal(result.status, 403);
  assert.match(result.error, /confirm your email/i);
});

test('a PostgREST error carries its detail for the log but never for the caller', async () => {
  const repository = createSupabaseRepository({
    env: testEnv(),
    fetchImpl: async () => response({
      message: 'duplicate key value violates unique constraint "profiles_pkey"',
      hint: 'check the id column',
    }, 409),
  });
  await assert.rejects(
    () => repository.getUserById(TEST_USER_ID),
    (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.expose, false, 'the request handler must not echo this');
      assert.match(err.message, /profiles_pkey/, 'the detail is kept for the log');
      return true;
    },
  );
});

test('the globe reads request a deterministic order, so the same network hashes to the same ETag', async () => {
  // Postgres gives no row-order guarantee without ORDER BY. The globe route
  // hashes the serialized response for its ETag, so an unordered read would
  // make the ETag change on every poll even when nothing changed.
  const calls = [];
  const fetchImpl = async (rawUrl, options) => {
    calls.push({ url: new URL(rawUrl), options });
    return response([]);
  };
  const repo = createSupabaseRepository({ env: testEnv(), fetchImpl });

  await repo.listDirectoryUsers();
  await repo.loadGraphStore();

  const profiles = calls.find((c) => c.url.pathname === '/rest/v1/profiles');
  assert.equal(profiles.url.searchParams.get('order'), 'created_at.asc,id.asc',
    'created_at alone can tie; id breaks the tie so the order is total');

  const follows = calls.find((c) => c.url.pathname === '/rest/v1/member_follows');
  assert.equal(follows.url.searchParams.get('order'), 'user_id.asc,target_user_id.asc');
});

/* The Supabase backend reported every member as 'active' from a hardcoded
   literal, so suspension did nothing on the backend production actually runs.
   These cover the four places the sqlite backend has always enforced it. */
const suspended = (status) => {
  const state = profileState();
  state.profile.account_status = status;
  return state;
};
const repoFor = (state) => createSupabaseRepository({
  env: testEnv(),
  fetchImpl: statefulFetch(state, []),
});
const clearsSession = (cookies) => cookies.some((c) => c.startsWith('nodal_session=;'));

test('a suspended member cannot resolve a session, and the stale cookie is cleared', async () => {
  for (const status of ['disabled', 'pending']) {
    const resolved = await repoFor(suspended(status))
      .resolveSession({ headers: { cookie: 'nodal_session=token-abc' } });
    assert.equal(resolved.user, null, `${status} must not resolve a session`);
    assert.ok(clearsSession(resolved.cookies),
      'the browser must stop replaying a session the server will not honour');
  }
});

test('a refresh does not hand a suspended member fresh cookies', async () => {
  const repository = createSupabaseRepository({
    env: testEnv(),
    fetchImpl: statefulFetch(suspended('disabled'), [], { expireAccessToken: true }),
  });
  const resolved = await repository.resolveSession({
    headers: { cookie: 'nodal_session=stale; nodal_refresh=refresh-abc' },
  });
  assert.equal(resolved.user, null);
  assert.ok(clearsSession(resolved.cookies));
  assert.ok(!resolved.cookies.some((c) => c.includes('refreshed-access')),
    'a refreshed access token must not be issued to a suspended member');
});

test('an active member still resolves a session', async () => {
  const resolved = await repoFor(suspended('active'))
    .resolveSession({ headers: { cookie: 'nodal_session=token-abc' } });
  assert.equal(resolved.user?.id, TEST_USER_ID);
  assert.equal(resolved.user.accountStatus, 'active');
});

test('a row written before the column existed is still active', async () => {
  const state = profileState();          // no account_status at all
  const resolved = await repoFor(state)
    .resolveSession({ headers: { cookie: 'nodal_session=token-abc' } });
  assert.equal(resolved.user?.accountStatus, 'active');
});

test('an unrecognised account_status fails closed', async () => {
  const resolved = await repoFor(suspended('banana'))
    .resolveSession({ headers: { cookie: 'nodal_session=token-abc' } });
  assert.equal(resolved.user, null, 'anything not on the allow-list is not active');
});

test('a suspended member cannot sign in, and is not told why', async () => {
  const result = await repoFor(suspended('disabled'))
    .login({ email: 'persisted@example.com', password: 'correct-horse' });
  assert.equal(result.status, 401);
  assert.equal(result.error, 'invalid email or password',
    'naming the suspension would confirm the account exists to anyone guessing');
  assert.deepEqual(result.cookies, []);
});

test('a suspended member drops out of the directory despite consenting', async () => {
  const listed = await repoFor(suspended('disabled')).listDirectoryUsers();
  assert.equal(listed.length, 0);
  const active = await repoFor(suspended('active')).listDirectoryUsers();
  assert.equal(active.length, 1, 'and an active consenting member stays listed');
});

test('a member cannot lift their own suspension through the profile API', async () => {
  const state = suspended('disabled');
  const calls = [];
  const repository = createSupabaseRepository({ env: testEnv(), fetchImpl: statefulFetch(state, calls) });
  await repository.updateUserProfile(TEST_USER_ID, {
    fullName: 'Persisted Member',
    account_status: 'active',
    accountStatus: 'active',
  });
  assert.equal(state.profile.account_status, 'disabled', 'the column is untouched');
  const patches = calls.filter((c) => c.options.method === 'PATCH' && c.url.pathname.endsWith('/profiles'));
  assert.ok(patches.length > 0, 'the profile was actually patched');
  assert.ok(patches.every((c) => !('account_status' in (c.body || {}))),
    'account_status is never part of a profile write');
});

test('Supabase maps server-owned app_role and never includes it in profile writes', async () => {
  const state = profileState();
  const calls = [];
  const repository = createSupabaseRepository({ env: testEnv(), fetchImpl: statefulFetch(state, calls) });
  const user = await repository.getUserById(TEST_USER_ID);
  assert.equal(user.permission, 'admin');
  await repository.updateUserProfile(TEST_USER_ID, { fullName: 'Updated Admin', app_role: 'member', permission: 'member' });
  const profilePatches = calls.filter((call) => call.options.method === 'PATCH' && call.url.pathname.endsWith('/profiles'));
  assert.ok(profilePatches.every((call) => !('app_role' in call.body)), 'app_role must remain server-owned');
  assert.equal(state.profile.app_role, 'admin');
});

test('Supabase account export includes the member catalog interests', async () => {
  const state = profileState();
  const repo = createSupabaseRepository({ env: testEnv(), fetchImpl: statefulFetch(state, []) });
  const exported = await repo.exportUserData(TEST_USER_ID);
  assert.deepEqual(exported.catalogInterests, [{
    id: 'interest-1', itemId: 'catalog-1', message: 'Please contact me.', status: 'new', version: 1,
    createdAt: '2030-05-01T00:00:00.000Z', updatedAt: '2030-05-01T00:00:00.000Z',
  }]);
});

test('Supabase account deletion delegates once to Auth Admin without unsafe table deletes', async () => {
  const calls = [];
  const repo = createSupabaseRepository({ env: testEnv(), fetchImpl: async (rawUrl, options) => {
    calls.push({ url: new URL(rawUrl), options });
    return response({});
  } });

  assert.equal(await repo.deleteUserById(TEST_USER_ID), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, `/auth/v1/admin/users/${TEST_USER_ID}`);
  assert.equal(calls[0].options.method, 'DELETE');
  assert.equal(calls[0].options.headers.apikey, 'test-server-key');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-server-key');
  assert.equal(calls.some((call) => call.url.pathname.startsWith('/rest/v1/')), false);
});

test('Supabase catalog adapter sends equivalent filters, ordering, cursor, and version guard', async () => {
  const calls = [];
  const item = {
    id: 'catalog-1', kind: 'opportunity', subtype: 'job', status: 'published', visibility: 'public',
    translations: { en: { title: 'Urban role', summary: 'Summary', body: 'Body', cta: 'Apply' }, es: { title: 'Rol urbano', summary: 'Resumen', body: 'Cuerpo', cta: 'Postularse' }, pt: { title: 'Cargo urbano', summary: 'Resumo', body: 'Corpo', cta: 'Candidate-se' } },
    organization: 'Cities', location: 'Lima', topics: ['mobility'], action_mode: 'external', action_url: 'https://cities.example.test/apply',
    source_label: 'Cities official source', source_url: 'https://cities.example.test/source', source_verified_at: '2030-05-01T00:00:00.000Z',
    featured: true, version: 1, deadline_at: '2030-05-20T00:00:00.000Z', published_at: '2030-05-01T00:00:00.000Z', created_at: '2030-05-01T00:00:00.000Z', updated_at: '2030-05-01T00:00:00.000Z',
  };
  const fetchImpl = async (rawUrl, options) => {
    const url = new URL(rawUrl);
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (url.pathname.endsWith('/catalog_items') && options.method === 'GET') return response([item]);
    if (url.pathname.endsWith('/catalog_items') && options.method === 'PATCH') return response([{ ...item, featured: false, version: 2 }]);
    throw new Error(`unexpected request ${options.method} ${url.pathname}`);
  };
  const repo = createSupabaseRepository({ env: testEnv(), fetchImpl });
  const cursor = Buffer.from(JSON.stringify([1, '2030-05-20T00:00:00.000Z', '2030-05-01T00:00:00.000Z', 'catalog-0'])).toString('base64url');
  const list = await repo.listCatalogItems({ kind: 'opportunity', featured: true, limit: 2, cursor, state: 'all' }, null);
  assert.equal(list.items[0].translations.en.title, 'Urban role');
  assert.equal(list.items[0].sourceLabel, 'Cities official source');
  const read = calls.find((call) => call.options.method === 'GET');
  assert.equal(read.url.searchParams.get('status'), 'eq.published');
  assert.equal(read.url.searchParams.get('visibility'), 'eq.public');
  assert.equal(read.url.searchParams.get('kind'), 'eq.opportunity');
  assert.equal(read.url.searchParams.get('featured'), 'eq.true');
  assert.equal(
    read.url.searchParams.get('order'),
    'featured.desc,deadline_at.asc.nullslast,published_at.desc.nullslast,id.asc',
    'drafts with no publication timestamp must follow published records just as they do in the shared cursor tuple',
  );
  assert.equal(read.url.searchParams.has('or'), false, 'cursor continuation is applied after complete ordered scan');
  assert.equal(read.url.searchParams.get('offset'), '0');
  const updated = await repo.updateCatalogItem(item.id, { ...list.items[0], featured: false }, 1, TEST_USER_ID);
  assert.equal(updated.version, 2);
  const write = calls.find((call) => call.options.method === 'PATCH');
  assert.equal(write.url.searchParams.get('id'), 'eq.catalog-1');
  assert.equal(write.url.searchParams.get('version'), 'eq.1');
  assert.equal(JSON.parse(write.options.body).source_label, 'Cities official source');
});

test('Supabase canonicalizes real PostgREST timestamptz shapes before catalog cursor pagination', async () => {
  const rows = [
    {
      id: 'catalog-first', kind: 'resource', subtype: null, status: 'published', visibility: 'public',
      translations: { en: { title: 'First', summary: 'Summary', body: 'Body', cta: 'Read' } },
      organization: 'NODAL', location: '', topics: [], starts_at: '2030-05-19T09:00:00.123456+00:00',
      deadline_at: '2030-05-20T09:00:00+00:00', end_date: '2030-05-21T23:59:59.999+00:00',
      source_label: 'Official', source_url: 'https://example.test/source', source_verified_at: '2030-05-01T00:00:00+00:00',
      action_mode: 'none', action_url: '', featured: false, version: 1,
      published_at: '2030-05-01T00:00:00.123456+00:00', created_at: '2030-04-01T00:00:00+00:00', updated_at: '2030-05-01T00:00:00.654321+00:00',
    },
    {
      id: 'catalog-second', kind: 'resource', subtype: null, status: 'published', visibility: 'public',
      translations: { en: { title: 'Second', summary: 'Summary', body: 'Body', cta: 'Read' } },
      organization: 'NODAL', location: '', topics: [], deadline_at: '2030-05-20T10:00:00+00:00',
      source_label: 'Official', source_url: 'https://example.test/source', source_verified_at: '2030-05-02T00:00:00+00:00',
      action_mode: 'none', action_url: '', featured: false, version: 1,
      published_at: '2030-05-01T00:00:00.123456+00:00', created_at: '2030-04-02T00:00:00+00:00', updated_at: '2030-05-02T00:00:00+00:00',
    },
  ];
  const repo = createSupabaseRepository({ env: testEnv(), fetchImpl: async (rawUrl, options) => {
    const url = new URL(rawUrl);
    if (url.pathname.endsWith('/catalog_items') && options.method === 'GET') return response(rows);
    throw new Error(`unexpected request ${options.method} ${url.pathname}`);
  } });
  const first = await repo.listCatalogItems({ state: 'all', limit: 1 }, null);
  assert.equal(first.items[0].startsAt, '2030-05-19T09:00:00.123Z');
  assert.equal(first.items[0].deadlineAt, '2030-05-20T09:00:00.000Z');
  assert.equal(first.items[0].endDate, '2030-05-21T23:59:59.999Z');
  assert.equal(first.items[0].sourceVerifiedAt, '2030-05-01T00:00:00.000Z');
  assert.equal(first.items[0].publishedAt, '2030-05-01T00:00:00.123Z');
  assert.equal(first.items[0].createdAt, '2030-04-01T00:00:00.000Z');
  assert.equal(first.items[0].updatedAt, '2030-05-01T00:00:00.654Z');
  assert.doesNotThrow(() => decodeCatalogCursor(first.nextCursor));
  const second = await repo.listCatalogItems({ state: 'all', limit: 1, cursor: first.nextCursor }, null);
  assert.equal(second.items[0].id, 'catalog-second');
});

test('Supabase catalog cursor preserves PostgREST microseconds that determine database order', async () => {
  // Truncating the cursor timestamp to milliseconds drops `a-item` after the
  // database correctly returns `z-item` first within the same millisecond.
  const shared = {
    kind: 'resource', subtype: null, status: 'published', visibility: 'public',
    translations: { en: { title: 'Resource', summary: 'Summary', body: 'Body', cta: 'Read' } },
    organization: 'NODAL', location: '', topics: [], deadline_at: '2030-05-20T00:00:00.000000+00:00',
    source_label: 'Official', source_url: 'https://example.test/source', source_verified_at: '2030-05-01T00:00:00+00:00',
    action_mode: 'none', action_url: '', featured: false, version: 1,
    created_at: '2030-04-01T00:00:00+00:00', updated_at: '2030-05-01T00:00:00+00:00',
  };
  const rows = [
    { ...shared, id: 'z-item', published_at: '2030-05-01T00:00:00.123900+00:00' },
    { ...shared, id: 'a-item', published_at: '2030-05-01T00:00:00.123100+00:00' },
  ];
  const repo = createSupabaseRepository({ env: testEnv(), fetchImpl: async (rawUrl, options) => {
    const url = new URL(rawUrl);
    if (url.pathname.endsWith('/catalog_items') && options.method === 'GET') return response(rows);
    throw new Error(`unexpected request ${options.method} ${url.pathname}`);
  } });

  const first = await repo.listCatalogItems({ state: 'all', limit: 1 }, null);
  assert.equal(first.items[0].id, 'z-item');
  assert.equal(first.items[0].publishedAt, '2030-05-01T00:00:00.123Z', 'public/admin records stay millisecond-canonical');
  assert.equal(decodeCatalogCursor(first.nextCursor)[2], '2030-05-01T00:00:00.123900Z');

  const second = await repo.listCatalogItems({ state: 'all', limit: 1, cursor: first.nextCursor }, null);
  assert.deepEqual(second.items.map((item) => item.id), ['a-item']);
  assert.equal(second.nextCursor, null);
});

test('Supabase publication transitions refresh audit metadata while published edits preserve it', async () => {
  const rows = new Map([
    ['archived', {
      id: 'archived', kind: 'opportunity', subtype: 'job', status: 'archived', visibility: 'public',
      translations: { en: { title: 'Role', summary: 'Summary', body: 'Body', cta: 'Apply' }, es: { title: 'Rol', summary: 'Resumen', body: 'Cuerpo', cta: 'Aplicar' }, pt: { title: 'Cargo', summary: 'Resumo', body: 'Corpo', cta: 'Aplicar' } },
      organization: 'Cities', location: 'Lima', topics: ['Mobility'], starts_at: '2030-06-01T00:00:00.000Z', deadline_at: '2030-05-20T00:00:00.000Z',
      source_label: 'Official source', source_url: 'https://cities.example.test/source', source_verified_at: '2030-05-01T00:00:00.000Z', action_mode: 'none', action_url: '', featured: false,
      version: 2, published_by: 'old-publisher', published_at: '2029-01-01T00:00:00.000Z',
    }],
    ['published', {
      id: 'published', kind: 'opportunity', subtype: 'job', status: 'published', visibility: 'public',
      translations: { en: { title: 'Role', summary: 'Summary', body: 'Body', cta: 'Apply' }, es: { title: 'Rol', summary: 'Resumen', body: 'Cuerpo', cta: 'Aplicar' }, pt: { title: 'Cargo', summary: 'Resumo', body: 'Corpo', cta: 'Aplicar' } },
      organization: 'Cities', location: 'Lima', topics: ['Mobility'], starts_at: '2030-06-01T00:00:00.000Z', deadline_at: '2030-05-20T00:00:00.000Z',
      source_label: 'Official source', source_url: 'https://cities.example.test/source', source_verified_at: '2030-05-01T00:00:00.000Z', action_mode: 'none', action_url: '', featured: false,
      version: 4, published_by: 'old-publisher', published_at: '2029-01-01T00:00:00.000Z',
    }],
  ]);
  const writes = [];
  const repo = createSupabaseRepository({ env: testEnv(), fetchImpl: async (rawUrl, options) => {
    const url = new URL(rawUrl);
    const id = url.searchParams.get('id')?.replace('eq.', '');
    if (url.pathname.endsWith('/catalog_items') && options.method === 'GET') return response([rows.get(id)]);
    if (url.pathname.endsWith('/catalog_items') && options.method === 'PATCH') {
      const body = JSON.parse(options.body); writes.push({ id, body }); return response([{ ...rows.get(id), ...body }]);
    }
    throw new Error(`unexpected request ${options.method} ${url.pathname}`);
  } });
  const archived = rows.get('archived');
  await repo.updateCatalogItem('archived', { ...archived, status: 'published', sourceLabel: archived.source_label, sourceUrl: archived.source_url, sourceVerifiedAt: archived.source_verified_at, startsAt: archived.starts_at, deadlineAt: archived.deadline_at, actionMode: 'none', actionUrl: '' }, 2, TEST_USER_ID);
  const published = rows.get('published');
  await repo.updateCatalogItem('published', { ...published, sourceLabel: published.source_label, sourceUrl: published.source_url, sourceVerifiedAt: published.source_verified_at, startsAt: published.starts_at, deadlineAt: published.deadline_at, actionMode: 'none', actionUrl: '' }, 4, TEST_USER_ID);
  assert.equal(writes[0].body.published_by, TEST_USER_ID);
  assert.notEqual(writes[0].body.published_at, '2029-01-01T00:00:00.000Z');
  assert.equal(writes[1].body.published_by, 'old-publisher');
  assert.equal(writes[1].body.published_at, '2029-01-01T00:00:00.000Z');
});

test('Supabase applies case-insensitive topic and full operational-text search after bounded reads', async () => {
  const item = {
    id: 'catalog-target', kind: 'resource', subtype: null, status: 'published', visibility: 'public',
    translations: { en: { title: 'Guide', summary: 'Summary', body: 'Body', cta: 'Read' } },
    organization: 'Andean Streets Alliance', location: 'Cusco Territory', topics: ['Safe Mobility'], source_label: 'Official',
    action_mode: 'none', action_url: '', featured: false, version: 1, deadline_at: null, published_at: '2030-05-01T00:00:00.000Z',
  };
  const calls = [];
  const repo = createSupabaseRepository({ env: testEnv(), fetchImpl: async (rawUrl, options) => {
    const url = new URL(rawUrl); calls.push(url);
    if (url.pathname.endsWith('/catalog_items') && options.method === 'GET') return response([item]);
    throw new Error(`unexpected request ${options.method} ${url.pathname}`);
  } });
  for (const query of [{ q: 'andean streets' }, { q: 'cusco territory' }, { q: 'safe mobility' }, { topic: 'SAFE MOBILITY' }]) {
    const result = await repo.listCatalogItems({ ...query, state: 'all' }, null);
    assert.deepEqual(result.items.map((row) => row.id), ['catalog-target']);
  }
  assert.ok(calls.every((url) => !url.searchParams.has('topics')), 'case-sensitive array containment must not narrow topic reads');
});

test('Supabase scans beyond a raw fetch window before applying open-state and text filtering', async () => {
  const closedOrUnmatched = Array.from({ length: 25 }, (_, index) => ({
    id: `catalog-${index}`, kind: 'resource', subtype: null, status: 'published', visibility: 'public',
    translations: { en: { title: index === 0 ? 'Target but closed' : 'Unrelated', summary: '', body: '', cta: '' } },
    organization: 'NODAL', location: '', topics: [], action_mode: 'none', action_url: '', featured: false, version: 1,
    deadline_at: index === 0 ? '2000-01-01T00:00:00.000Z' : '2030-05-20T00:00:00.000Z', published_at: '2030-05-01T00:00:00.000Z',
  }));
  const matching = [{
    id: 'catalog-target', kind: 'resource', subtype: null, status: 'published', visibility: 'public',
    translations: { en: { title: 'Target opportunity', summary: '', body: '', cta: '' } },
    organization: 'NODAL', location: '', topics: [], action_mode: 'none', action_url: '', featured: false, version: 1,
    deadline_at: '2030-05-21T00:00:00.000Z', published_at: '2030-05-01T00:00:00.000Z',
  }];
  const calls = [];
  const repo = createSupabaseRepository({
    env: testEnv(),
    fetchImpl: async (rawUrl, options) => {
      const url = new URL(rawUrl);
      calls.push({ url, options });
      if (url.pathname.endsWith('/catalog_items') && options.method === 'GET') {
        return response(Number(url.searchParams.get('offset') || 0) === 0 ? closedOrUnmatched : matching);
      }
      throw new Error(`unexpected request ${options.method} ${url.pathname}`);
    },
  });
  const result = await repo.listCatalogItems({ q: 'target', limit: 1 }, null);
  assert.deepEqual(result.items.map((item) => item.id), ['catalog-target']);
  assert.equal(calls.some((call) => call.url.searchParams.get('offset') === '25'), true);
});

test('Supabase null-deadline cursors continue locally without constructing invalid timestamp filters', async () => {
  const cursor = Buffer.from(JSON.stringify([0, '\uffff', '2030-05-01T00:00:00.000Z', 'catalog-0']), 'utf8').toString('base64url');
  const repo = createSupabaseRepository({
    env: testEnv(),
    fetchImpl: async (rawUrl, options) => {
      const url = new URL(rawUrl);
      if (url.pathname.endsWith('/catalog_items') && options.method === 'GET') {
        if (url.searchParams.has('or')) throw new Error('Postgres cannot compare a timestamptz to the cursor sentinel');
        return response([{
          id: 'catalog-1', kind: 'resource', subtype: null, status: 'published', visibility: 'public',
          translations: { en: { title: 'No deadline', summary: '', body: '', cta: '' } }, organization: 'NODAL', location: '', topics: [],
          action_mode: 'none', action_url: '', featured: false, version: 1, deadline_at: null, published_at: '2030-05-01T00:00:00.000Z',
        }]);
      }
      throw new Error(`unexpected request ${options.method} ${url.pathname}`);
    },
  });
  const result = await repo.listCatalogItems({ cursor, limit: 1, state: 'all' }, null);
  assert.deepEqual(result.items.map((item) => item.id), ['catalog-1']);
});

test('Supabase stops after the page boundary when no local filter needs more rows', async () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({
    id: `catalog-${index}`, kind: 'resource', subtype: null, status: 'published', visibility: 'public',
    translations: { en: { title: `Item ${index}`, summary: '', body: '', cta: '' } }, organization: 'NODAL', location: '', topics: [],
    action_mode: 'none', action_url: '', featured: false, version: 1, deadline_at: '2030-05-20T00:00:00.000Z', published_at: '2030-05-01T00:00:00.000Z',
  }));
  let requests = 0;
  const repo = createSupabaseRepository({
    env: testEnv(),
    fetchImpl: async (rawUrl, options) => {
      const url = new URL(rawUrl);
      if (url.pathname.endsWith('/catalog_items') && options.method === 'GET') {
        requests += 1;
        if (requests > 1) throw new Error('listing fetched past its limit + 1 boundary');
        return response(rows);
      }
      throw new Error(`unexpected request ${options.method} ${url.pathname}`);
    },
  });
  const result = await repo.listCatalogItems({ limit: 1, state: 'all' }, null);
  assert.equal(result.items.length, 1);
  assert.ok(result.nextCursor);
  assert.equal(requests, 1);
});

test('Supabase rejects invalid cursors before issuing a catalog request', async () => {
  let requests = 0;
  const repo = createSupabaseRepository({
    env: testEnv(),
    fetchImpl: async () => {
      requests += 1;
      return response([]);
    },
  });
  const cursor = Buffer.from(JSON.stringify([1, '2030-02-30T00:00:00.000Z', '2030-05-01T00:00:00.000Z', 'catalog-1']), 'utf8').toString('base64url');
  await assert.rejects(repo.listCatalogItems({ cursor }, null), /cursor/i);
  assert.equal(requests, 0);
});

test('Supabase preserves an identical active interest without issuing a PATCH', async () => {
  // A retry of the same PUT must not advance version/audit state or generate an admin conflict.
  const item = {
    id: 'catalog-1', kind: 'resource', subtype: null, status: 'published', visibility: 'public',
    translations: { en: { title: 'Guide', summary: 'Summary', body: 'Body', cta: 'Read' } }, organization: 'NODAL', location: '', topics: [],
    action_mode: 'interest', action_url: '', featured: false, version: 1, deadline_at: '2030-05-20T00:00:00.000Z', published_at: '2030-05-01T00:00:00.000Z',
  };
  const interest = {
    id: 'interest-1', item_id: item.id, user_id: TEST_USER_ID, message: 'Same message', status: 'new', version: 4,
    created_at: '2030-05-01T00:00:00.000Z', updated_at: '2030-05-02T00:00:00.000Z', updated_by: TEST_USER_ID,
  };
  let patched = false;
  const repo = createSupabaseRepository({
    env: testEnv(),
    fetchImpl: async (rawUrl, options) => {
      const url = new URL(rawUrl);
      if (url.pathname.endsWith('/catalog_items') && options.method === 'GET') return response([item]);
      if (url.pathname.endsWith('/catalog_interests') && options.method === 'GET') return response([interest]);
      if (url.pathname.endsWith('/catalog_interests') && options.method === 'PATCH') { patched = true; return response([{ ...interest, version: 5 }]); }
      throw new Error(`unexpected request ${options.method} ${url.pathname}`);
    },
  });
  const repeated = await repo.upsertCatalogInterest(item.id, TEST_USER_ID, 'Same message');
  assert.equal(repeated.version, 4);
  assert.equal(repeated.updatedAt, '2030-05-02T00:00:00.000Z');
  assert.equal(patched, false);
});

test('Supabase concurrent duplicate interest writes converge idempotently', async (t) => {
  const item = {
    id: 'catalog-1', kind: 'resource', subtype: null, status: 'published', visibility: 'public',
    translations: { en: { title: 'Guide', summary: 'Summary', body: 'Body', cta: 'Read' } }, organization: 'NODAL', location: '', topics: [],
    action_mode: 'interest', action_url: '', featured: false, version: 1, deadline_at: '2030-05-20T00:00:00.000Z', published_at: '2030-05-01T00:00:00.000Z',
  };

  await t.test('two first PUTs share the row created through the unique constraint race', async () => {
    let stored = null;
    let initialReads = 0;
    let releaseInitialReads;
    const initialReadGate = new Promise((resolve) => { releaseInitialReads = resolve; });
    const repo = createSupabaseRepository({ env: testEnv(), fetchImpl: async (rawUrl, options) => {
      const url = new URL(rawUrl);
      if (url.pathname.endsWith('/catalog_items') && options.method === 'GET') return response([item]);
      if (url.pathname.endsWith('/catalog_interests') && options.method === 'GET') {
        initialReads += 1;
        if (initialReads <= 2) {
          if (initialReads === 2) releaseInitialReads();
          await initialReadGate;
          return response([]);
        }
        return response(stored ? [stored] : []);
      }
      if (url.pathname.endsWith('/catalog_interests') && options.method === 'POST') {
        if (stored) return response({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
        const body = JSON.parse(options.body)[0];
        stored = {
          id: 'interest-1', item_id: body.item_id, user_id: body.user_id, message: body.message, status: body.status, version: 1,
          created_at: '2030-05-01T00:00:00.000Z', updated_at: '2030-05-01T00:00:00.000Z', updated_by: body.updated_by,
        };
        return response([stored]);
      }
      throw new Error(`unexpected request ${options.method} ${url.pathname}`);
    } });

    const results = await Promise.all([
      repo.upsertCatalogInterest(item.id, TEST_USER_ID, 'Same message'),
      repo.upsertCatalogInterest(item.id, TEST_USER_ID, 'Same message'),
    ]);

    assert.deepEqual(results.map((interest) => interest.id), ['interest-1', 'interest-1']);
    assert.deepEqual(results.map((interest) => interest.status), ['new', 'new']);
    assert.equal(stored.version, 1);
  });

  await t.test('two reopen PUTs tolerate the losing conditional PATCH', async () => {
    let stored = {
      id: 'interest-1', item_id: item.id, user_id: TEST_USER_ID, message: 'Old', status: 'withdrawn', version: 1,
      created_at: '2030-05-01T00:00:00.000Z', updated_at: '2030-05-01T00:00:00.000Z', updated_by: TEST_USER_ID,
    };
    let initialReads = 0;
    let releaseInitialReads;
    const initialReadGate = new Promise((resolve) => { releaseInitialReads = resolve; });
    const repo = createSupabaseRepository({ env: testEnv(), fetchImpl: async (rawUrl, options) => {
      const url = new URL(rawUrl);
      if (url.pathname.endsWith('/catalog_items') && options.method === 'GET') return response([item]);
      if (url.pathname.endsWith('/catalog_interests') && options.method === 'GET') {
        initialReads += 1;
        const snapshot = { ...stored };
        if (initialReads <= 2) {
          if (initialReads === 2) releaseInitialReads();
          await initialReadGate;
        }
        return response([snapshot]);
      }
      if (url.pathname.endsWith('/catalog_interests') && options.method === 'PATCH') {
        const expectedVersion = Number(url.searchParams.get('version').replace('eq.', ''));
        if (stored.version !== expectedVersion) return response([]);
        stored = { ...stored, ...JSON.parse(options.body), updated_at: '2030-05-02T00:00:00.000Z' };
        return response([stored]);
      }
      throw new Error(`unexpected request ${options.method} ${url.pathname}`);
    } });

    const results = await Promise.all([
      repo.upsertCatalogInterest(item.id, TEST_USER_ID, 'Reopened'),
      repo.upsertCatalogInterest(item.id, TEST_USER_ID, 'Reopened'),
    ]);

    assert.deepEqual(results.map((interest) => interest.status), ['new', 'new']);
    assert.deepEqual(results.map((interest) => interest.version), [2, 2]);
    assert.equal(stored.message, 'Reopened');
  });

  await t.test('two DELETEs tolerate the losing conditional PATCH', async () => {
    let stored = {
      id: 'interest-1', item_id: item.id, user_id: TEST_USER_ID, message: 'Active', status: 'new', version: 1,
      created_at: '2030-05-01T00:00:00.000Z', updated_at: '2030-05-01T00:00:00.000Z', updated_by: TEST_USER_ID,
    };
    let initialReads = 0;
    let releaseInitialReads;
    const initialReadGate = new Promise((resolve) => { releaseInitialReads = resolve; });
    const repo = createSupabaseRepository({ env: testEnv(), fetchImpl: async (rawUrl, options) => {
      const url = new URL(rawUrl);
      if (url.pathname.endsWith('/catalog_interests') && options.method === 'GET') {
        initialReads += 1;
        const snapshot = { ...stored };
        if (initialReads <= 2) {
          if (initialReads === 2) releaseInitialReads();
          await initialReadGate;
        }
        return response([snapshot]);
      }
      if (url.pathname.endsWith('/catalog_interests') && options.method === 'PATCH') {
        const expectedVersion = Number(url.searchParams.get('version').replace('eq.', ''));
        if (stored.version !== expectedVersion) return response([]);
        stored = { ...stored, ...JSON.parse(options.body), updated_at: '2030-05-02T00:00:00.000Z' };
        return response([stored]);
      }
      throw new Error(`unexpected request ${options.method} ${url.pathname}`);
    } });

    assert.deepEqual(await Promise.all([
      repo.withdrawCatalogInterest(item.id, TEST_USER_ID),
      repo.withdrawCatalogInterest(item.id, TEST_USER_ID),
    ]), [true, true]);
    assert.equal(stored.status, 'withdrawn');
    assert.equal(stored.version, 2);
  });
});

test('Supabase bounds insert-race retries without masking a non-convergent database error', async () => {
  const item = {
    id: 'catalog-1', kind: 'resource', subtype: null, status: 'published', visibility: 'public',
    translations: { en: { title: 'Guide', summary: 'Summary', body: 'Body', cta: 'Read' } }, organization: 'NODAL', location: '', topics: [],
    action_mode: 'interest', action_url: '', featured: false, version: 1, deadline_at: '2030-05-20T00:00:00.000Z', published_at: '2030-05-01T00:00:00.000Z',
  };
  let insertAttempts = 0;
  const repo = createSupabaseRepository({ env: testEnv(), fetchImpl: async (rawUrl, options) => {
    const url = new URL(rawUrl);
    if (url.pathname.endsWith('/catalog_items') && options.method === 'GET') return response([item]);
    if (url.pathname.endsWith('/catalog_interests') && options.method === 'GET') return response([]);
    if (url.pathname.endsWith('/catalog_interests') && options.method === 'POST') {
      insertAttempts += 1;
      return response({ code: '23505', message: 'unrelated primary key collision' }, 409);
    }
    throw new Error(`unexpected request ${options.method} ${url.pathname}`);
  } });

  await assert.rejects(
    repo.upsertCatalogInterest(item.id, TEST_USER_ID, 'Same message'),
    (err) => err.code === '23505' && err.message === 'unrelated primary key collision',
  );
  assert.equal(insertAttempts, 3);
});

test('Supabase interest adapters paginate stable cursors and batch-load private catalog context', async () => {
  const interests = Array.from({ length: 3 }, (_, index) => ({
    id: `interest-${index}`, item_id: `catalog-${index}`, user_id: TEST_USER_ID, message: `Message ${index}`, status: 'new', version: 1,
    created_at: `2030-05-0${index + 1}T00:00:00.123456+00:00`, updated_at: `2030-05-0${index + 1}T00:00:00.654321+00:00`, updated_by: TEST_USER_ID,
  }));
  const items = Array.from({ length: 3 }, (_, index) => ({
    id: `catalog-${index}`, kind: 'resource', subtype: null, status: index === 1 ? 'archived' : 'published', visibility: 'members',
    translations: { en: { title: `English ${index}`, summary: 'Summary', body: 'Body', cta: 'Read' } },
    organization: 'NODAL', location: '', topics: [], source_label: 'Official', source_url: 'https://example.test/source',
    source_verified_at: '2030-01-01T00:00:00.000Z', action_mode: 'none', action_url: '', featured: false, version: 1,
    published_at: '2030-01-01T00:00:00.000Z', updated_at: '2030-01-01T00:00:00.000Z',
  }));
  const calls = [];
  const repo = createSupabaseRepository({ env: testEnv(), fetchImpl: async (rawUrl, options) => {
    const url = new URL(rawUrl); calls.push(url);
    if (url.pathname.endsWith('/catalog_interests') && options.method === 'GET') return response(interests);
    if (url.pathname.endsWith('/catalog_items') && options.method === 'GET') return response(items);
    throw new Error(`unexpected request ${options.method} ${url.pathname}`);
  } });

  const mineFirst = await repo.listCatalogInterestsForUser(TEST_USER_ID, { limit: 2 });
  assert.equal(mineFirst.interests[0].updatedAt, '2030-05-03T00:00:00.654Z');
  assert.doesNotThrow(() => decodeCatalogInterestCursor(mineFirst.nextCursor));
  const mineSecond = await repo.listCatalogInterestsForUser(TEST_USER_ID, { limit: 2, cursor: mineFirst.nextCursor });
  assert.deepEqual([...mineFirst.interests, ...mineSecond.interests].map((entry) => entry.id), ['interest-2', 'interest-1', 'interest-0']);
  assert.equal(mineFirst.interests[1].item.status, 'archived');
  assert.equal(localizeCatalogItem(mineFirst.interests[1].item, 'pt', { fallback: true }).title, 'English 1');
  const adminFirst = await repo.listAdminInterests({ status: 'new', limit: 2 });
  const adminSecond = await repo.listAdminInterests({ status: 'new', limit: 2, cursor: adminFirst.nextCursor });
  assert.deepEqual([...adminFirst.interests, ...adminSecond.interests].map((entry) => entry.id), ['interest-0', 'interest-1', 'interest-2']);
  assert.equal(adminFirst.interests[0].item.translations.en.title, 'English 0');
  assert.ok(calls.some((url) => url.pathname.endsWith('/catalog_items') && url.searchParams.get('id')?.startsWith('in.(')));
  await assert.rejects(repo.listCatalogInterestsForUser(TEST_USER_ID, { cursor: 'invalid' }), /cursor/i);
});

test('Supabase interest continuations use one bounded keyset read instead of offset-scanning history', async (t) => {
  const item = {
    id: 'catalog-next', kind: 'resource', subtype: null, status: 'published', visibility: 'members',
    translations: { en: { title: 'Next record', summary: 'Summary', body: 'Body', cta: 'Read' } },
    organization: 'NODAL', location: '', topics: [], source_label: 'Official', source_url: 'https://example.test/source',
    source_verified_at: '2030-01-01T00:00:00.000Z', action_mode: 'none', action_url: '', featured: false, version: 1,
    published_at: '2030-01-01T00:00:00.000Z', updated_at: '2030-01-01T00:00:00.000Z',
  };
  const cursorId = 'interest-cursor';
  const scenarios = [
    {
      name: 'member descending', direction: 'desc', comparison: 'lt', cursorTime: '2030-05-02T00:00:00.123456Z',
      rowTime: '2030-05-01T00:00:00.654321+00:00',
      list: (repo, query) => repo.listCatalogInterestsForUser(TEST_USER_ID, query),
    },
    {
      name: 'admin ascending', direction: 'asc', comparison: 'gt', cursorTime: '2030-05-01T00:00:00.123456Z',
      rowTime: '2030-05-02T00:00:00.654321+00:00',
      list: (repo, query) => repo.listAdminInterests({ status: 'new', ...query }),
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const interestReads = [];
      const row = {
        id: 'interest-next', item_id: item.id, user_id: TEST_USER_ID, message: 'Next', status: 'new', version: 1,
        created_at: '2030-05-01T00:00:00.000Z', updated_at: scenario.rowTime, updated_by: TEST_USER_ID,
      };
      const repo = createSupabaseRepository({ env: testEnv(), fetchImpl: async (rawUrl, options) => {
        const url = new URL(rawUrl);
        if (url.pathname.endsWith('/catalog_interests') && options.method === 'GET') {
          interestReads.push(url);
          return response([row]);
        }
        if (url.pathname.endsWith('/catalog_items') && options.method === 'GET') return response([item]);
        throw new Error(`unexpected request ${options.method} ${url.pathname}`);
      } });
      const cursor = Buffer.from(JSON.stringify([scenario.cursorTime, cursorId]), 'utf8').toString('base64url');

      const result = await scenario.list(repo, { limit: 2, cursor });

      assert.deepEqual(result.interests.map((interest) => interest.id), ['interest-next']);
      assert.equal(interestReads.length, 1);
      assert.equal(interestReads[0].searchParams.get('limit'), '3');
      assert.equal(interestReads[0].searchParams.has('offset'), false);
      assert.equal(interestReads[0].searchParams.get('order'), `updated_at.${scenario.direction},id.asc`);
      assert.equal(
        interestReads[0].searchParams.get('or'),
        `(updated_at.${scenario.comparison}.${scenario.cursorTime},and(updated_at.eq.${scenario.cursorTime},id.gt.${cursorId}))`,
      );
    });
  }
});

test('Supabase member and admin interest cursors preserve PostgREST microsecond ordering', async (t) => {
  const itemFor = (id) => ({
    id: `catalog-${id}`, kind: 'resource', subtype: null, status: 'published', visibility: 'members',
    translations: { en: { title: id, summary: 'Summary', body: 'Body', cta: 'Read' } },
    organization: 'NODAL', location: '', topics: [], source_label: 'Official', source_url: 'https://example.test/source',
    source_verified_at: '2030-01-01T00:00:00.000Z', action_mode: 'none', action_url: '', featured: false, version: 1,
    published_at: '2030-01-01T00:00:00.000Z', updated_at: '2030-01-01T00:00:00.000Z',
  });
  const interestFor = (id, updatedAt) => ({
    id: `${id}-item`, item_id: `catalog-${id}`, user_id: TEST_USER_ID, message: id, status: 'new', version: 1,
    created_at: '2030-05-01T00:00:00.000Z', updated_at: updatedAt, updated_by: TEST_USER_ID,
  });
  const scenarios = [
    {
      name: 'member descending', direction: 'desc',
      rows: [interestFor('z', '2030-05-01T00:00:00.123900+00:00'), interestFor('a', '2030-05-01T00:00:00.123100+00:00')],
      list: (repo, query) => repo.listCatalogInterestsForUser(TEST_USER_ID, query),
      cursorTime: '2030-05-01T00:00:00.123900Z',
    },
    {
      name: 'admin ascending', direction: 'asc',
      rows: [interestFor('z', '2030-05-01T00:00:00.123100+00:00'), interestFor('a', '2030-05-01T00:00:00.123900+00:00')],
      list: (repo, query) => repo.listAdminInterests({ status: 'new', ...query }),
      cursorTime: '2030-05-01T00:00:00.123100Z',
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const items = scenario.rows.map((row) => itemFor(row.id[0]));
      const repo = createSupabaseRepository({ env: testEnv(), fetchImpl: async (rawUrl, options) => {
        const url = new URL(rawUrl);
        if (url.pathname.endsWith('/catalog_interests') && options.method === 'GET') {
          assert.equal(url.searchParams.get('order'), `updated_at.${scenario.direction},id.asc`);
          return response(scenario.rows);
        }
        if (url.pathname.endsWith('/catalog_items') && options.method === 'GET') return response(items);
        throw new Error(`unexpected request ${options.method} ${url.pathname}`);
      } });

      const first = await scenario.list(repo, { limit: 1 });
      assert.equal(first.interests[0].id, 'z-item');
      assert.equal(first.interests[0].updatedAt, '2030-05-01T00:00:00.123Z');
      assert.equal(decodeCatalogInterestCursor(first.nextCursor)[0], scenario.cursorTime);
      const second = await scenario.list(repo, { limit: 1, cursor: first.nextCursor });
      assert.deepEqual(second.interests.map((interest) => interest.id), ['a-item']);
      assert.equal(second.nextCursor, null);
    });
  }
});

test('Supabase admin interest update distinguishes a missing ID from a stale version before PATCH', async () => {
  // Treating both empty conditional patches as conflicts gives missing records the wrong HTTP status.
  for (const scenario of [
    { name: 'missing', current: [], version: 1, expectMissing: true },
    { name: 'stale', current: [{ id: 'interest-1', item_id: 'catalog-1', user_id: TEST_USER_ID, message: 'Message', status: 'new', version: 2, created_at: '2030-05-01T00:00:00.000Z', updated_at: '2030-05-01T00:00:00.000Z' }], version: 1, expectMissing: false },
  ]) {
    let patched = false;
    const repo = createSupabaseRepository({
      env: testEnv(),
      fetchImpl: async (rawUrl, options) => {
        const url = new URL(rawUrl);
        if (url.pathname.endsWith('/catalog_interests') && options.method === 'GET') return response(scenario.current);
        if (url.pathname.endsWith('/catalog_interests') && options.method === 'PATCH') { patched = true; return response([]); }
        throw new Error(`unexpected request ${options.method} ${url.pathname}`);
      },
    });
    if (scenario.expectMissing) {
      assert.equal(await repo.updateCatalogInterest('interest-1', { status: 'contacted' }, scenario.version, TEST_USER_ID), null);
    } else {
      await assert.rejects(repo.updateCatalogInterest('interest-1', { status: 'contacted' }, scenario.version, TEST_USER_ID), (err) => err.code === 'CATALOG_VERSION_CONFLICT');
    }
    assert.equal(patched, false, scenario.name);
  }
});
