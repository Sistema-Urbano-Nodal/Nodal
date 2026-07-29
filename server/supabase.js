import { parseCookies, sessionCookie } from './auth.js';
import { defaultProfilePreferences } from './domain.js';
import { recordInteraction } from './store.js';
import {
  DEFAULT_INDICATORS,
  canApplyForMentor,
  cleanIndicators,
  cleanRequests,
  cleanTopics,
  normalizePartC,
} from './profile-policy.js';

const ROOT_ROLE = 'Member';
const ACCESS_COOKIE = 'nodal_session';
const REFRESH_COOKIE = 'nodal_refresh';
const SUBSCRIPTION_STATUSES = new Set([
  'pending',
  'active',
  'trialing',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
]);

const nowIso = () => new Date().toISOString();
const asArray = (value) => (Array.isArray(value) ? value : []);
const cleanString = (value, max = 220) => String(value ?? '').trim().slice(0, max);
const cleanStatus = (value) => (SUBSCRIPTION_STATUSES.has(String(value)) ? String(value) : 'pending');

const ACCOUNT_STATUSES = new Set(['active', 'disabled', 'pending']);
/* Anything unrecognised counts as not active. A column that has been tampered
   with, or a row written before the column existed, must fail closed. */
const cleanAccountStatus = (value) => {
  if (value === undefined || value === null || value === '') return 'active';
  return ACCOUNT_STATUSES.has(String(value)) ? String(value) : 'disabled';
};
const isActive = (user) => user?.accountStatus === 'active';

export function dataBackend(env = process.env) {
  const value = String(env.DATA_BACKEND || (env.VERCEL ? 'supabase' : 'sqlite')).trim().toLowerCase();
  if (!['sqlite', 'supabase'].includes(value)) {
    throw new Error('DATA_BACKEND must be either sqlite or supabase');
  }
  return value;
}

function required(value, name) {
  const out = String(value ?? '').trim();
  if (!out) throw new Error(`${name} is required for Supabase`);
  return out;
}

function normalizeProjectUrl(value) {
  const raw = required(value, 'NEXT_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must be a valid URL');
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must be HTTPS outside localhost');
  }
  return parsed.origin;
}

function assertPublicKey(key) {
  if (key.startsWith('sb_secret_')) throw new Error('public Supabase key must not be a secret key');
  return key;
}

function assertServerKey(key) {
  if (key.startsWith('sb_publishable_')) throw new Error('server Supabase key must not be a publishable key');
  return key;
}

export function resolveSupabaseEnv(env = process.env, { requireServer = false } = {}) {
  const url = normalizeProjectUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey = assertPublicKey(required(
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ));
  const serverKeyValue = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const serverKey = requireServer ? assertServerKey(required(serverKeyValue, 'SUPABASE_SECRET_KEY')) : String(serverKeyValue ?? '').trim();
  return { url, publishableKey, serverKey };
}

export function publicSupabaseConfig(env = process.env) {
  const { url, publishableKey } = resolveSupabaseEnv(env, { requireServer: false });
  return { url, publishableKey };
}

function encodeQuery(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const out = params.toString();
  return out ? `?${out}` : '';
}

/* `expose: false` marks this as somebody else's error text. PostgREST and
   GoTrue answer with column names, constraint names and internal hints, and the
   request handler echoes any sub-500 message straight to the caller — so these
   are carried for our own logs and branching, never for the response body. */
function responseError(status, payload, fallback) {
  const message = payload?.msg || payload?.message || payload?.error_description || payload?.error || fallback;
  return Object.assign(new Error(message), {
    status,
    expose: false,
    code: String(payload?.error_code || payload?.code || ''),
  });
}

function createRestClient({ url, key, fetchImpl = fetch, authToken = key }) {
  async function request(path, {
    method = 'GET',
    query,
    body,
    headers = {},
    auth = authToken,
  } = {}) {
    const fullUrl = `${url}${path}${encodeQuery(query)}`;
    const finalHeaders = {
      apikey: key,
      Authorization: `Bearer ${auth}`,
      Accept: 'application/json',
      ...headers,
    };
    let payload;
    if (body !== undefined) {
      finalHeaders['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetchImpl(fullUrl, { method, headers: finalHeaders, body: payload });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw responseError(res.status, json, 'Supabase request failed');
    return json;
  }

  return {
    request,
    rest(table, options = {}) {
      return request(`/rest/v1/${table}`, options);
    },
    auth(path, options = {}) {
      return request(`/auth/v1${path}`, options);
    },
  };
}

export function createSupabaseClients({ env = process.env, fetchImpl = fetch } = {}) {
  const resolved = resolveSupabaseEnv(env, { requireServer: true });
  return {
    env: resolved,
    publicConfig: { url: resolved.url, publishableKey: resolved.publishableKey },
    browser: createRestClient({ url: resolved.url, key: resolved.publishableKey, fetchImpl }),
    admin: createRestClient({ url: resolved.url, key: resolved.serverKey, fetchImpl }),
    user(accessToken) {
      return createRestClient({
        url: resolved.url,
        key: resolved.publishableKey,
        authToken: accessToken,
        fetchImpl,
      });
    },
  };
}

function refreshCookie(value, { env = process.env, maxAge = 60 * 60 * 24 * 30 } = {}) {
  const secure = env.COOKIE_SECURE === 'true' || env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${REFRESH_COOKIE}=${encodeURIComponent(value)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

function sessionCookies(session, env) {
  if (!session?.access_token) return [];
  const accessMaxAge = Math.max(60, Number(session.expires_in) || 60 * 60);
  const cookies = [sessionCookie(session.access_token, { env, maxAge: accessMaxAge })];
  if (session.refresh_token) cookies.push(refreshCookie(session.refresh_token, { env }));
  return cookies;
}

function clearSessionCookies(env) {
  return [
    sessionCookie('', { env, maxAge: 0 }),
    refreshCookie('', { env, maxAge: 0 }),
  ];
}

async function first(promise) {
  const rows = await promise;
  return Array.isArray(rows) ? rows[0] ?? null : rows;
}

function profileQuery(id) {
  return { id: `eq.${id}`, select: '*' };
}

function userIdQuery(userId) {
  return { user_id: `eq.${userId}`, select: '*' };
}

function profileName(profile = {}) {
  return cleanString(profile.full_name || profile.preferred_name || profile.email?.split('@')[0] || 'Member', 120);
}

function toApiUserFromSupabase({ profile, preferences, onboarding }) {
  if (!profile) return null;
  const raw = onboarding?.raw_answers && typeof onboarding.raw_answers === 'object' ? onboarding.raw_answers : {};
  const rawPartC = raw.partC && typeof raw.partC === 'object' ? raw.partC : {};
  const dataConsent = preferences?.data_consent && typeof preferences.data_consent === 'object' ? preferences.data_consent : {};
  const notifications = preferences?.notification_preferences && typeof preferences.notification_preferences === 'object'
    ? preferences.notification_preferences
    : {};
  // through the same allow-list the write path uses, so anything a profile
  // picked up before that existed stops being served
  const partC = {
    ...normalizePartC(rawPartC),
    bio: cleanString(profile.bio || rawPartC.bio || '', 2000),
    availability: cleanString(onboarding?.availability || rawPartC.availability || '', 120),
    consent: dataConsent.directoryPublic === true || (dataConsent.directoryPublic === undefined && rawPartC.consent === true),
  };
  const title = cleanString(raw.title || profile.public_role || ROOT_ROLE, 80) || ROOT_ROLE;
  const interests = asArray(onboarding?.interests).map(String);
  const rawTopics = asArray(raw.topics);
  return {
    id: profile.id,
    fullName: profileName(profile),
    name: profileName(profile),
    email: cleanString(profile.email, 320),
    permission: 'member',
    accountStatus: cleanAccountStatus(profile.account_status),
    role: title,
    title,
    city: cleanString(profile.city_region, 120),
    country: cleanString(profile.country, 80),
    interests,
    active: asArray(raw.active).map(String),
    linkedin: cleanString(rawPartC.linkedin || raw.linkedin || '', 220),
    topics: rawTopics,
    skills: asArray(onboarding?.skills).map(String),
    goals: asArray(onboarding?.goals).map(String),
    indicators: { ...DEFAULT_INDICATORS, ...(raw.indicators && typeof raw.indicators === 'object' ? raw.indicators : {}) },
    partC,
    requests: raw.requests && typeof raw.requests === 'object' ? raw.requests : {},
    mentorApplied: Boolean(raw.mentorApplied),
    assessed: Boolean(raw.assessed),
    notifRead: Boolean(notifications.dashboardRead ?? raw.notifRead),
    location: Number.isFinite(profile.city_lat) && Number.isFinite(profile.city_lon)
      ? { lat: profile.city_lat, lon: profile.city_lon, label: profile.city_label || cleanString(profile.city_region, 120) }
      : null,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

function toGraphUser(user) {
  const topicInterests = user.topics.map((t) => String(t.name || t).toLowerCase()).filter(Boolean);
  return {
    id: user.id,
    name: user.fullName,
    role: user.title,
    city: user.city,
    interests: user.interests.length ? user.interests : topicInterests,
    active: user.active,
    linkedin: user.linkedin,
  };
}

function subscriptionToApi(row) {
  if (!row) return { status: 'none', active: false };
  return {
    status: row.subscription_status || 'pending',
    active: ['active', 'trialing'].includes(row.subscription_status),
    currentPeriodEnd: row.current_period_end || null,
    updatedAt: row.updated_at,
  };
}

export function createSupabaseRepository({ env = process.env, fetchImpl = fetch } = {}) {
  const clients = createSupabaseClients({ env, fetchImpl });
  const { admin, browser } = clients;

  async function bundleForUser(userId) {
    const [profile, preferences, onboarding] = await Promise.all([
      first(admin.rest('profiles', { query: profileQuery(userId) })),
      first(admin.rest('profile_preferences', { query: userIdQuery(userId) })),
      first(admin.rest('onboarding_responses', {
        query: { ...userIdQuery(userId), order: 'created_at.desc', limit: 1 },
      })),
    ]);
    return { profile, preferences, onboarding };
  }

  async function apiUser(userId) {
    return toApiUserFromSupabase(await bundleForUser(userId));
  }

  async function existingOrEnsureProfile(authUser) {
    const userId = authUser?.id;
    if (!userId) throw Object.assign(new Error('Supabase auth did not return a user'), { status: 502 });
    const bundle = await bundleForUser(userId);
    if (bundle.profile && bundle.preferences) return toApiUserFromSupabase(bundle);
    return ensureProfile(authUser);
  }

  async function ensureProfile(authUser, fallbackName = '') {
    const userId = authUser?.id;
    if (!userId) throw Object.assign(new Error('Supabase auth did not return a user'), { status: 502 });
    const metadata = authUser.user_metadata || {};
    const email = cleanString(authUser.email, 320);
    const fullName = cleanString(fallbackName || metadata.full_name || metadata.name || email.split('@')[0] || 'Member', 120);
    await Promise.all([
      admin.rest('profiles', {
        method: 'POST',
        query: { on_conflict: 'id' },
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: [{
          id: userId,
          preferred_name: fullName.split(/\s+/)[0] || fullName,
          full_name: fullName,
          email,
          avatar_url: cleanString(metadata.avatar_url, 500),
          public_role: ROOT_ROLE,
        }],
      }),
      admin.rest('profile_preferences', {
        method: 'POST',
        query: { on_conflict: 'user_id' },
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: [defaultProfilePreferences(userId)],
      }),
    ]);
    return apiUser(userId);
  }

  async function authUserFromToken(accessToken) {
    const data = await browser.auth('/user', { auth: accessToken });
    return data?.user || data;
  }

  async function upsertProfileState(userId, patch, current) {
    if (!current) throw Object.assign(new Error('profile not found'), { status: 404 });
    const partC = 'partC' in patch ? normalizePartC(patch.partC, current.partC) : current.partC;
    const title = 'title' in patch ? cleanString(patch.title, 80) : current.title;
    const fullName = 'fullName' in patch ? cleanString(patch.fullName, 120) : current.fullName;
    const city = 'city' in patch ? cleanString(patch.city, 120) : current.city;
    const topics = 'topics' in patch ? cleanTopics(patch.topics, current.topics) : current.topics;
    const indicators = 'indicators' in patch ? cleanIndicators(patch.indicators) : current.indicators;
    const assessed = 'assessed' in patch ? Boolean(patch.assessed) : current.assessed;
    const canApplyMentor = canApplyForMentor({ assessed, topics, indicators });
    const mentorApplied = 'mentorApplied' in patch
      ? Boolean(current.mentorApplied || (patch.mentorApplied && canApplyMentor))
      : current.mentorApplied;
    const rawAnswers = {
      title,
      active: 'active' in patch ? asArray(patch.active).map(String).slice(0, 6) : current.active,
      topics,
      indicators,
      partC,
      requests: 'requests' in patch ? cleanRequests(patch.requests, current.requests, partC) : current.requests,
      mentorApplied,
      assessed,
      notifRead: 'notifRead' in patch ? Boolean(patch.notifRead) : current.notifRead,
    };
    await admin.rest('profiles', {
      method: 'PATCH',
      query: { id: `eq.${userId}` },
      headers: { Prefer: 'return=representation' },
      body: {
        full_name: fullName,
        preferred_name: fullName.split(/\s+/)[0] || fullName,
        city_region: city,
        bio: cleanString(partC.bio, 2000),
        public_role: title,
        updated_at: nowIso(),
      },
    });
    await admin.rest('profile_preferences', {
      method: 'POST',
      query: { on_conflict: 'user_id' },
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: [{
        user_id: userId,
        visibility: { directory: Boolean(partC.consent) },
        notification_preferences: { dashboardRead: Boolean(rawAnswers.notifRead) },
        data_consent: { directoryPublic: Boolean(partC.consent) },
        updated_at: nowIso(),
      }],
    });
    await admin.rest('onboarding_responses', {
      method: 'POST',
      query: { on_conflict: 'user_id' },
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: [{
        user_id: userId,
        interests: 'interests' in patch ? asArray(patch.interests).map(String).slice(0, 12) : current.interests,
        skills: 'skills' in patch ? asArray(patch.skills).map(String).slice(0, 12) : current.skills,
        goals: 'goals' in patch ? asArray(patch.goals).map(String).slice(0, 12) : current.goals,
        contribution_preferences: rawAnswers.active,
        availability: cleanString(partC.availability, 120),
        mentoring_interest: rawAnswers.mentorApplied ? 'applied' : 'none',
        raw_answers: rawAnswers,
        updated_at: nowIso(),
      }],
    });
    return apiUser(userId);
  }

  return {
    kind: 'supabase',
    async resolveSession(req) {
      const cookies = parseCookies(req.headers.cookie);
      const accessToken = cookies.get(ACCESS_COOKIE);
      const refreshToken = cookies.get(REFRESH_COOKIE);
      if (accessToken) {
        try {
          const authUser = await authUserFromToken(accessToken);
          if (!authUser?.id) return { user: null, cookies: clearSessionCookies(env) };
          const user = await existingOrEnsureProfile(authUser);
          /* A suspended member's token is still valid as far as the auth
             provider is concerned, so this is the only thing standing between
             them and every authenticated route. Their cookies go too, or the
             browser keeps replaying a session the server will not honour. */
          if (!isActive(user)) return { user: null, cookies: clearSessionCookies(env) };
          return { user, cookies: [] };
        } catch (err) {
          if (!refreshToken || ![401, 403].includes(err?.status)) {
            return { user: null, cookies: err?.status === 401 ? clearSessionCookies(env) : [] };
          }
        }
      }
      if (!refreshToken) return { user: null, cookies: [] };
      try {
        const session = await browser.auth('/token', {
          method: 'POST',
          query: { grant_type: 'refresh_token' },
          body: { refresh_token: refreshToken },
        });
        const authUser = session?.user || await authUserFromToken(session?.access_token);
        if (!authUser?.id) return { user: null, cookies: clearSessionCookies(env) };
        const user = await existingOrEnsureProfile(authUser);
        // a refresh must not hand a suspended member a fresh pair of cookies
        if (!isActive(user)) return { user: null, cookies: clearSessionCookies(env) };
        return { user, cookies: sessionCookies(session, env) };
      } catch {
        return { user: null, cookies: clearSessionCookies(env) };
      }
    },
    async signup({ fullName, email, password }) {
      const data = await browser.auth('/signup', {
        method: 'POST',
        body: { email, password, data: { full_name: fullName } },
      });
      const authUser = data.user || (data.id ? data : null);
      const session = data.session || (data.access_token ? data : null);
      if (Array.isArray(authUser?.identities) && authUser.identities.length === 0) {
        return {
          status: 202,
          user: null,
          cookies: [],
          requiresEmailConfirmation: true,
        };
      }
      const user = await ensureProfile(authUser, fullName);
      return {
        status: session?.access_token ? 201 : 202,
        user,
        cookies: sessionCookies(session, env),
        requiresEmailConfirmation: !session?.access_token,
      };
    },
    /* Answers in the same shape the sqlite backend does. Letting a rejected
       sign-in throw sent GoTrue's own wording — and its status — to the browser
       instead of the one message the login form is meant to show. */
    async login({ email, password }) {
      let data;
      try {
        data = await browser.auth('/token', {
          method: 'POST',
          query: { grant_type: 'password' },
          body: { email, password },
        });
      } catch (err) {
        if (err?.code === 'email_not_confirmed') {
          return { status: 403, error: 'Confirm your email before signing in.', cookies: [] };
        }
        if ([400, 401, 403, 422].includes(err?.status)) {
          return { status: 401, error: 'invalid email or password', cookies: [] };
        }
        throw err;
      }
      const authUser = data.user;
      const user = await ensureProfile(authUser);
      /* Same answer a wrong password gets, and the same one the sqlite backend
         gives: telling a caller that this particular address is suspended would
         confirm the account exists to anyone who guessed it. */
      if (!isActive(user)) return { status: 401, error: 'invalid email or password', cookies: [] };
      return { status: 200, user, cookies: sessionCookies(data, env) };
    },
    async logout(req) {
      const accessToken = parseCookies(req.headers.cookie).get(ACCESS_COOKIE);
      if (accessToken) {
        try { await browser.auth('/logout', { method: 'POST', auth: accessToken }); } catch { /* best effort */ }
      }
      return { status: 200, cookies: clearSessionCookies(env) };
    },
    toApiUser(user) {
      return user;
    },
    async getUserById(id) {
      return apiUser(id);
    },
    async updateUserProfile(id, patch) {
      const current = await apiUser(id);
      return upsertProfileState(id, patch, current);
    },
    /* Separate from updateUserProfile on purpose: its allow-list is fed by the
       request body, and a coordinate must only ever come from the server. */
    async setUserLocation(id, point) {
      await admin.rest(`profiles?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: {
          city_lat: point?.lat ?? null,
          city_lon: point?.lon ?? null,
          city_label: point?.label ?? '',
        },
      });
      return apiUser(id);
    },
    async listDirectoryUsers() {
      /* Postgres gives no row-order guarantee without ORDER BY, and this row
         order becomes the order of `places`/`topics` in the globe payload —
         the ETag hashes the bytes that order produces. created_at alone can
         tie, so id breaks the tie and makes the order total. */
      const [profiles, prefsRows, onboardingRows] = await Promise.all([
        admin.rest('profiles', { query: { select: '*', order: 'created_at.asc,id.asc' } }),
        admin.rest('profile_preferences', { query: { select: '*' } }),
        admin.rest('onboarding_responses', { query: { select: '*' } }),
      ]);
      const prefsByUser = new Map(prefsRows.map((row) => [row.user_id, row]));
      const onboardingByUser = new Map(onboardingRows.map((row) => [row.user_id, row]));
      return profiles
        .map((profile) => toApiUserFromSupabase({
          profile,
          preferences: prefsByUser.get(profile.id),
          onboarding: onboardingByUser.get(profile.id),
        }))
        // consent puts you in the directory; being active keeps you there
        .filter((user) => user?.partC?.consent === true && isActive(user));
    },
    async loadGraphStore({ viewerId } = {}) {
      const visible = await this.listDirectoryUsers();
      const viewer = viewerId ? await apiUser(viewerId) : null;
      const users = new Map();
      for (const user of [...visible, viewer].filter(Boolean)) users.set(user.id, toGraphUser(user));
      const follows = new Map([...users.keys()].map((id) => [id, new Set()]));
      const [followRows, interactionRows] = await Promise.all([
        admin.rest('member_follows', { query: { select: '*', order: 'user_id.asc,target_user_id.asc' } }),
        admin.rest('member_interactions', { query: { select: '*', order: 'created_at.asc' } }),
      ]);
      for (const row of followRows) {
        if (follows.has(row.user_id) && users.has(row.target_user_id)) follows.get(row.user_id).add(row.target_user_id);
      }
      const store = { users, follows, engagement: new Map() };
      for (const row of interactionRows) {
        if (users.has(row.from_user_id) && users.has(row.to_user_id)) {
          recordInteraction(store, row.from_user_id, row.to_user_id, row.type, Date.parse(row.created_at));
        }
      }
      return store;
    },
    async addFollow(from, to) {
      await admin.rest('member_follows', {
        method: 'POST',
        query: { on_conflict: 'user_id,target_user_id' },
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: [{ user_id: from, target_user_id: to }],
      });
      await this.recordInteraction(from, to, 'follow');
      return true;
    },
    async recordInteraction(from, to, type) {
      await admin.rest('member_interactions', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: [{ from_user_id: from, to_user_id: to, type }],
      });
    },
    async exportUserData(userId) {
      const user = await apiUser(userId);
      const [follows, followers, interactions, subscription] = await Promise.all([
        admin.rest('member_follows', { query: { user_id: `eq.${userId}`, select: 'target_user_id,created_at' } }),
        admin.rest('member_follows', { query: { target_user_id: `eq.${userId}`, select: 'user_id,created_at' } }),
        admin.rest('member_interactions', { query: { from_user_id: `eq.${userId}`, select: 'to_user_id,type,created_at' } }),
        this.getSubscriptionStatus(userId),
      ]);
      return {
        exportedAt: nowIso(),
        user,
        follows: follows.map((row) => ({ targetUserId: row.target_user_id, createdAt: row.created_at })),
        followers: followers.map((row) => ({ userId: row.user_id, createdAt: row.created_at })),
        interactions: interactions.map((row) => ({ toUserId: row.to_user_id, type: row.type, createdAt: row.created_at })),
        subscription,
      };
    },
    async deleteUserById(userId) {
      await admin.request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      return true;
    },
    async getSubscriptionStatus(userId) {
      const row = await first(admin.rest('stripe_customers', {
        query: { user_id: `eq.${userId}`, select: '*', order: 'updated_at.desc', limit: 1 },
      }));
      return subscriptionToApi(row);
    },
    async applyStripeEvent({
      eventId,
      eventType,
      eventCreated = 0,
      eventRank = 0,
      userId = null,
      stripeCustomerId = null,
      stripeSubscriptionId = null,
      stripeCheckoutSessionId = null,
      status = 'pending',
      currentPeriodEnd = null,
    }) {
      const nullable = (value, max) => cleanString(value, max) || null;
      const row = await first(admin.request('/rest/v1/rpc/apply_stripe_event', {
        method: 'POST',
        body: {
          p_event_id: cleanString(eventId, 120),
          p_event_type: cleanString(eventType || 'unknown', 120),
          p_event_created: Number(eventCreated) || 0,
          p_event_rank: Number(eventRank) || 0,
          p_user_id: nullable(userId, 80),
          p_stripe_customer_id: nullable(stripeCustomerId, 120),
          p_stripe_subscription_id: nullable(stripeSubscriptionId, 120),
          p_stripe_checkout_session_id: nullable(stripeCheckoutSessionId, 120),
          p_status: cleanStatus(status),
          p_current_period_end: nullable(currentPeriodEnd, 80),
        },
      }));
      return subscriptionToApi(row);
    },
    close() {},
  };
}
