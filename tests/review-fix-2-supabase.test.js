import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseRepository } from '../server/supabase.js';
import { decodeCatalogCursor } from '../server/catalog.js';

const env = () => ({
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-public-key',
  SUPABASE_SECRET_KEY: 'test-server-key',
});
const response = (payload, status = 200) => ({
  ok: status >= 200 && status < 300, status, headers: new Headers({ 'content-type': 'application/json' }),
  text: async () => (payload === null ? '' : JSON.stringify(payload)),
});

/* ---------- signup is not a membership oracle ---------- */
test('signup answers a new, an unconfirmed and an already confirmed address identically, and writes no profile', async () => {
  const id = '5777e974-0000-4000-8000-000000000001';
  const shapes = {
    // a brand-new address: GoTrue creates the user and sends the confirmation
    new: { id, email: 'new@example.org', user_metadata: { full_name: 'Probe Person' }, identities: [{ id, provider: 'email' }], confirmation_sent_at: '2026-10-03T00:00:00Z' },
    // an address someone registered and never confirmed: GoTrue returns that first registrant
    unconfirmed: { user: { id, email: 'pending@example.org', user_metadata: { full_name: 'First Registrant' }, identities: [{ id, provider: 'email' }] } },
    // a confirmed member: GoTrue returns a stand-in user with no identities
    confirmed: { id: 'f8bf7ca9-1340-4e99-a709-93c08047bb49', email: 'member@example.org', user_metadata: {}, identities: [] },
  };
  const answers = [];
  for (const [kind, payload] of Object.entries(shapes)) {
    const calls = [];
    const repo = createSupabaseRepository({ env: env(), fetchImpl: async (rawUrl, options) => {
      const url = new URL(rawUrl); calls.push(`${options.method || 'GET'} ${url.pathname}`);
      if (url.pathname === '/auth/v1/signup') return response(payload);
      // Any profile read or write would be the oracle; answer it so a leak shows up in the result.
      return response([{ id, full_name: 'First Registrant', email: 'pending@example.org', app_role: 'member' }]);
    } });
    const result = await repo.signup({ fullName: 'Probe Person', email: `${kind}@example.org`, password: 'probe-password-1' });
    assert.deepEqual(calls, ['POST /auth/v1/signup'], `${kind}: nothing but the signup itself`);
    answers.push(JSON.stringify(result));
  }
  assert.equal(new Set(answers).size, 1, answers.join('\n'));
  assert.deepEqual(JSON.parse(answers[0]), { status: 202, user: null, cookies: [], requiresEmailConfirmation: true });
});

test('a signup that returns a session (confirmation switched off) still creates the profile and signs in', async () => {
  const id = '5777e974-0000-4000-8000-000000000002', writes = [];
  const repo = createSupabaseRepository({ env: env(), fetchImpl: async (rawUrl, options) => {
    const url = new URL(rawUrl), method = options.method || 'GET';
    if (url.pathname === '/auth/v1/signup') return response({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, user: { id, email: 'a@example.org', user_metadata: {} } });
    if (method === 'POST') { writes.push(url.pathname); return response(null, 201); }
    if (url.pathname.endsWith('/profiles')) return response([{ id, full_name: 'Ana Member', email: 'a@example.org' }]);
    return response([]);
  } });
  const result = await repo.signup({ fullName: 'Ana Member', email: 'a@example.org', password: 'password-123' });
  assert.equal(result.status, 201);
  assert.equal(result.user.id, id);
  assert.equal(result.requiresEmailConfirmation, false);
  assert.ok(writes.includes('/rest/v1/profiles'));
  assert.match(result.cookies.join(';'), /nodal_session=access/);
});

/* ---------- sign-out revokes the Supabase session ---------- */
function authFake({ logoutStatus = () => 204, refreshStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (rawUrl, options) => {
    const url = new URL(rawUrl);
    calls.push({ path: `${url.pathname}${url.search}`, auth: options.headers.Authorization, body: options.body ? JSON.parse(options.body) : null });
    if (url.pathname === '/auth/v1/logout') { const status = logoutStatus(options.headers.Authorization); return status === 204 ? response(null, 204) : response({ msg: 'invalid JWT' }, status); }
    if (url.pathname === '/auth/v1/token') return refreshStatus === 200 ? response({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3600 }) : response({ error: 'invalid_grant' }, refreshStatus);
    throw new Error(`unexpected ${url.pathname}`);
  };
  return { calls, repo: createSupabaseRepository({ env: env(), fetchImpl }) };
}
const cleared = (result) => result.status === 200 && result.cookies.length === 2 && result.cookies.every((cookie) => /Max-Age=0/.test(cookie));

test('signing out after the access cookie expired still revokes the session through the refresh token', async () => {
  const { calls, repo } = authFake();
  const result = await repo.logout({ headers: { cookie: 'nodal_refresh=stale-refresh' } });
  assert.ok(cleared(result));
  assert.deepEqual(calls.map((call) => call.path), ['/auth/v1/token?grant_type=refresh_token', '/auth/v1/logout']);
  assert.deepEqual(calls[0].body, { refresh_token: 'stale-refresh' });
  assert.equal(calls[1].auth, 'Bearer fresh-access', 'the session is revoked with the exchanged access token');
});

test('an access token GoTrue rejects falls back to the refresh token; a valid one needs nothing more', async () => {
  const rejected = authFake({ logoutStatus: (auth) => (auth === 'Bearer expired-access' ? 401 : 204) });
  assert.ok(cleared(await rejected.repo.logout({ headers: { cookie: 'nodal_session=expired-access; nodal_refresh=r1' } })));
  assert.deepEqual(rejected.calls.map((call) => call.path), ['/auth/v1/logout', '/auth/v1/token?grant_type=refresh_token', '/auth/v1/logout']);
  assert.equal(rejected.calls[2].auth, 'Bearer fresh-access');

  const valid = authFake();
  assert.ok(cleared(await valid.repo.logout({ headers: { cookie: 'nodal_session=live-access; nodal_refresh=r1' } })));
  assert.deepEqual(valid.calls.map((call) => call.path), ['/auth/v1/logout'], 'no refresh token is spent on a session already revoked');
  assert.equal(valid.calls[0].auth, 'Bearer live-access');
});

test('sign-out always clears the cookies: no cookies, a dead refresh token or an unreachable provider', async () => {
  const none = authFake();
  assert.ok(cleared(await none.repo.logout({ headers: {} })));
  assert.equal(none.calls.length, 0);
  const dead = authFake({ refreshStatus: 400 });
  assert.ok(cleared(await dead.repo.logout({ headers: { cookie: 'nodal_refresh=used' } })));
  assert.equal(dead.calls.length, 1);
  const down = authFake({ logoutStatus: () => 503 });
  assert.ok(cleared(await down.repo.logout({ headers: { cookie: 'nodal_session=a; nodal_refresh=r' } })));
  assert.deepEqual(down.calls.map((call) => call.path), ['/auth/v1/logout'], 'an outage is not a reason to rotate the refresh token');
});

/* ---------- the public catalog listing ---------- */
const NOW = Date.now();
const iso = (offsetDays) => new Date(NOW + offsetDays * 86400000).toISOString();
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function row(n, patch) {
  return {
    id: uuid(n), kind: 'opportunity', subtype: 'job', status: 'published', visibility: 'public',
    translations: { en: { title: `Item ${n}`, summary: 'Summary', body: 'Body', cta: 'Apply' } },
    organization: 'NODAL', location: 'Lima', topics: ['Mobility'], action_mode: 'none', action_url: '', featured: false, version: 1,
    deadline_at: null, end_date: null, published_at: '2030-05-01T00:00:00.000000Z', ...patch,
  };
}

/* A small PostgREST stand-in: the filters this listing sends (eq/gt/lt/gte,
   is.null, not.is.null, nested and/or), its order and limit/offset, over rows
   whose timestamps all share one canonical form. */
function split(list) {
  const parts = []; let depth = 0, start = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === '(') depth += 1; else if (list[i] === ')') depth -= 1;
    else if (list[i] === ',' && depth === 0) { parts.push(list.slice(start, i)); start = i + 1; }
  }
  parts.push(list.slice(start));
  return parts;
}
function condition(expr) {
  const logic = /^(and|or)\((.*)\)$/.exec(expr);
  if (logic) {
    const parts = split(logic[2]).map(condition);
    return logic[1] === 'and' ? (r) => parts.every((p) => p(r)) : (r) => parts.some((p) => p(r));
  }
  const [, field, op, value] = /^([a-z_]+)\.(not\.is|is|eq|gt|gte|lt)\.(.*)$/.exec(expr);
  const read = (r) => (field === 'end_date' ? r.end_date?.slice(0, 10) ?? null : field === 'featured' ? String(r.featured) : r[field]);
  return (r) => {
    const v = read(r);
    if (op === 'is') return v === null;
    if (op === 'not.is') return v !== null;
    if (v === null) return false;
    return { eq: v === value, gt: v > value, gte: v >= value, lt: v < value }[op];
  };
}
function fakePostgrest(rows) {
  const reads = [];
  const fetchImpl = async (rawUrl) => {
    const url = new URL(rawUrl), q = url.searchParams;
    const filters = [];
    for (const [key, value] of q) {
      if (key === 'or' || key === 'and') filters.push(condition(`${key}${value}`));
      else if (key === 'status' || key === 'visibility') filters.push((r) => r[key] === value.replace(/^eq\./, ''));
    }
    const ordered = rows.filter((r) => filters.every((f) => f(r))).sort((a, b) =>
      (Number(b.featured) - Number(a.featured))
      || ((a.deadline_at ?? '￿') < (b.deadline_at ?? '￿') ? -1 : (a.deadline_at ?? '￿') > (b.deadline_at ?? '￿') ? 1 : 0)
      || ((b.published_at ?? '') < (a.published_at ?? '') ? -1 : (b.published_at ?? '') > (a.published_at ?? '') ? 1 : 0)
      || (a.id < b.id ? -1 : 1));
    const offset = Number(q.get('offset') || 0), limit = Number(q.get('limit'));
    const page = ordered.slice(offset, offset + limit);
    reads.push({ params: Object.fromEntries(q), rows: page });
    return response(page);
  };
  return { reads, repo: createSupabaseRepository({ env: env(), fetchImpl }) };
}
// Timestamps as PostgREST stores them for this stand-in: one 6-digit form, so string order is time order.
const micro = (value) => (value ? value.replace(/\.(\d{3})Z$/, '.$1000Z') : value);
function catalogRows() {
  const rows = [];
  // 400 published opportunities whose deadline passed, and some that ended without one
  for (let n = 1; n <= 400; n += 1) rows.push(row(n, { deadline_at: micro(iso(-1 - (n % 90))), featured: n % 7 === 0 }));
  for (let n = 401; n <= 420; n += 1) rows.push(row(n, { end_date: iso(-3 - (n % 5)).slice(0, 10) }));
  // 70 open ones: featured and not, with and without deadlines, sharing deadlines and publication times
  for (let n = 501; n <= 570; n += 1) {
    rows.push(row(n, {
      featured: n % 5 === 0,
      deadline_at: n % 4 === 0 ? null : micro(iso(1 + (n % 6))),
      end_date: n % 8 === 0 ? iso(30).slice(0, 10) : null,
      published_at: n % 9 === 0 ? null : `2030-05-0${1 + (n % 3)}T00:00:00.12${n % 10}${n % 4}00Z`,
      translations: { en: { title: n % 3 === 0 ? `Needle ${n}` : `Item ${n}`, summary: '', body: '', cta: '' } },
    }));
  }
  return rows;
}

test('expired opportunities never leave the database, and each page continues after the last instead of rescanning', async () => {
  const rows = catalogRows();
  const { reads, repo } = fakePostgrest(rows);
  const expected = rows.filter((r) => r.id >= uuid(501)).length;
  const seen = [];
  let cursor = null, pages = 0;
  do {
    const before = reads.length;
    const result = await repo.listCatalogItems({ limit: 24, ...(cursor ? { cursor } : {}) }, null);
    pages += 1;
    assert.ok(reads.length - before <= 2, `page ${pages} took ${reads.length - before} reads`);
    seen.push(...result.items.map((item) => item.id));
    cursor = result.nextCursor;
  } while (cursor && pages < 10);
  assert.equal(seen.length, expected, 'every open item, once');
  assert.equal(new Set(seen).size, expected);
  const transferred = reads.flatMap((read) => read.rows);
  assert.equal(transferred.filter((r) => r.id < uuid(501)).length, 0, 'no closed row was transferred');
  // The order is the one a single scan of the open items produces.
  const all = await fakePostgrest(rows.filter((r) => r.id >= uuid(501))).repo.listCatalogItems({ limit: 24, state: 'all' }, null);
  assert.deepEqual(seen.slice(0, 24), all.items.map((item) => item.id));
  // state=all still sees closed items, so staff history and old links keep working
  const history = fakePostgrest(rows);
  const everything = await history.repo.listCatalogItems({ limit: 24, state: 'all' }, null);
  assert.equal(history.reads.length, 1);
  assert.equal(history.reads[0].params.or, undefined);
  assert.equal(everything.items.length, 24);
});

test('a search with no match reads a bounded number of batches and hands back a cursor to continue', async () => {
  const rows = catalogRows();
  for (let n = 600; n < 900; n += 1) rows.push(row(n, { deadline_at: micro(iso(40)), translations: { en: { title: 'Unrelated', summary: '', body: '', cta: '' } } }));
  const { reads, repo } = fakePostgrest(rows);
  const first = await repo.listCatalogItems({ q: 'no-such-term', limit: 24 }, null);
  assert.ok(reads.length <= 8, `${reads.length} sequential reads for one request`);
  assert.deepEqual(first.items, []);
  assert.ok(first.nextCursor, 'the scan stopped early, so it says where to resume');
  // Following the cursors reaches the end, never rereads a row and never loops.
  let cursor = first.nextCursor, requests = 1;
  while (cursor && requests < 20) {
    const page = await repo.listCatalogItems({ q: 'no-such-term', limit: 24, cursor }, null);
    assert.deepEqual(page.items, []);
    cursor = page.nextCursor; requests += 1;
  }
  assert.equal(cursor, null);
  assert.ok(requests < 20);
  const read = reads.flatMap((entry) => entry.rows.map((r) => r.id));
  assert.equal(new Set(read).size, read.length, 'a resumed scan does not reread rows');
  assert.equal(read.length, rows.filter((r) => r.id >= uuid(501)).length, 'every open row is read exactly once across the requests');
  // A matching search still finds every match across the cursor.
  const needles = rows.filter((r) => r.id >= uuid(501) && /Needle/.test(r.translations.en.title)).length;
  const found = [];
  let next = null;
  do { const page = await repo.listCatalogItems({ q: 'needle', limit: 5, ...(next ? { cursor: next } : {}) }, null); found.push(...page.items); next = page.nextCursor; } while (next);
  assert.equal(found.length, needles);
});

test('the keyset filter sends only valid PostgREST values, including for null deadlines and publication times', async () => {
  const { reads, repo } = fakePostgrest([]);
  for (const tuple of [[1, '2030-05-20T00:00:00.000Z', '2030-05-01T00:00:00.123900Z', uuid(7)], [0, '￿', '', uuid(8)]]) {
    await repo.listCatalogItems({ cursor: Buffer.from(JSON.stringify(tuple)).toString('base64url'), state: 'all' }, null);
  }
  assert.equal(reads[0].params.and, `(or(featured.eq.false,and(featured.eq.true,or(deadline_at.gt.2030-05-20T00:00:00.000Z,deadline_at.is.null,and(deadline_at.eq.2030-05-20T00:00:00.000Z,or(published_at.lt.2030-05-01T00:00:00.123900Z,published_at.is.null,and(published_at.eq.2030-05-01T00:00:00.123900Z,id.gt.${uuid(7)})))))))`);
  assert.equal(reads[1].params.and, `(and(featured.eq.false,and(deadline_at.is.null,and(published_at.is.null,id.gt.${uuid(8)}))))`);
  assert.ok(reads.every((read) => !/￿/.test(JSON.stringify(read.params))));
  // A cursor whose id is not a uuid cannot come from this server: it widens instead of erroring in Postgres.
  await repo.listCatalogItems({ cursor: Buffer.from(JSON.stringify([0, '￿', '', 'catalog-1'])).toString('base64url'), state: 'all' }, null);
  assert.doesNotMatch(reads[2].params.and, /catalog-1/);
  assert.doesNotThrow(() => decodeCatalogCursor(Buffer.from(JSON.stringify([0, '￿', '', uuid(8)])).toString('base64url')));
});

test('the detail read does not inherit the open-state filter', async () => {
  const { reads, repo } = fakePostgrest([row(1, { deadline_at: micro(iso(-10)) })]);
  const item = await repo.getCatalogItem(uuid(1), null);
  assert.equal(item.id, uuid(1), 'a closed opportunity can still be opened by its link');
  assert.equal(reads[0].params.or, undefined);
  assert.equal(reads[0].params.and, undefined);
});
