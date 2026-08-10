import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSupabaseRepository,
  createSupabaseClients,
  publicSupabaseConfig,
  resolveSupabaseEnv,
} from '../server/supabase.js';

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

test('Supabase catalog adapter sends equivalent filters, ordering, cursor, and version guard', async () => {
  const calls = [];
  const item = {
    id: 'catalog-1', kind: 'opportunity', subtype: 'job', status: 'published', visibility: 'public',
    translations: { en: { title: 'Urban role', summary: 'Summary', body: 'Body', cta: 'Apply' }, es: { title: 'Rol urbano', summary: 'Resumen', body: 'Cuerpo', cta: 'Postularse' }, pt: { title: 'Cargo urbano', summary: 'Resumo', body: 'Corpo', cta: 'Candidate-se' } },
    organization: 'Cities', location: 'Lima', topics: ['mobility'], action_mode: 'external', action_url: 'https://cities.example.test/apply',
    sourceUrl: 'https://cities.example.test/source', sourceVerifiedAt: '2030-05-01T00:00:00.000Z', actionMode: 'external', actionUrl: 'https://cities.example.test/apply', deadlineAt: '2030-05-20T00:00:00.000Z',
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
  const read = calls.find((call) => call.options.method === 'GET');
  assert.equal(read.url.searchParams.get('status'), 'eq.published');
  assert.equal(read.url.searchParams.get('visibility'), 'eq.public');
  assert.equal(read.url.searchParams.get('kind'), 'eq.opportunity');
  assert.equal(read.url.searchParams.get('featured'), 'eq.true');
  assert.equal(read.url.searchParams.get('order'), 'featured.desc,deadline_at.asc.nullslast,published_at.desc,id.asc');
  assert.match(read.url.searchParams.get('or'), /catalog-0/);
  const updated = await repo.updateCatalogItem(item.id, { ...item, featured: false }, 1, TEST_USER_ID);
  assert.equal(updated.version, 2);
  const write = calls.find((call) => call.options.method === 'PATCH');
  assert.equal(write.url.searchParams.get('id'), 'eq.catalog-1');
  assert.equal(write.url.searchParams.get('version'), 'eq.1');
});
