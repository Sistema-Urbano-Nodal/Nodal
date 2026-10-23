import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/server.js';
import { createDatabase, createUser, deleteUserById } from '../server/db.js';
import { createSession } from '../server/auth.js';
import { createRepository } from '../server/repository.js';
import { createSupabaseRepository } from '../server/supabase.js';
import { createCourseStore } from '../server/courses-repository.js';

/* The Founder badge /fundadores.html promises every Membresía Fundador member: kept on their profile for as long as they
   keep their NODAL account. NODAL never sees the Mercado Pago payment, so only an administrator gives it
   (/api/admin/membership/founders), by the email of the member's account; the member can never set it. Every app here
   gets its own billing settings, pilot mode and clock: Vercel runs the suite with the production environment. */
const ROOT = path.resolve(import.meta.dirname, '..');
const T0 = Date.parse('2026-10-23T15:00:00.000Z');

async function boot(t) {
  const db = createDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  const clock = { at: T0 };
  const server = createApp({ db, billingEnv: {}, now: () => clock.at, pilotMode: true, citySearch: { search: async () => ({ cities: [] }) } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const account = (fullName, email, role = 'member') => {
    const user = createUser(db, { fullName, email, passwordHash: 'unused', role });
    return { user, id: user.id, cookie: createSession(db, user.id).cookie.split(';')[0] };
  };
  const call = (route, { cookie, method = 'GET', body, origin = base } = {}) => fetch(`${base}${route}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = async (route, options) => { const res = await call(route, options); return { status: res.status, body: await res.json().catch(() => null) }; };
  const founderSince = (id) => db.prepare('SELECT founder_since FROM users WHERE id = ?').get(id).founder_since;
  return { db, base, clock, account, call, json, founderSince };
}

const FOUNDERS = '/api/admin/membership/founders';
const grant = (app, admin, email) => app.json(FOUNDERS, { cookie: admin.cookie, method: 'POST', body: { email } });

// Captures the server's info lines (the grant and removal log) for one test.
function infoLines(t) {
  const lines = [], original = console.info;
  console.info = (...args) => { lines.push(args.join(' ')); };
  t.after(() => { console.info = original; });
  return lines;
}

test('SQLite migration 10 adds users.founder_since, empty for every account', async (t) => {
  const { db, account } = await boot(t);
  assert.equal(db.prepare('SELECT version FROM schema_migrations WHERE version = 10').get()?.version, 10);
  const column = db.prepare('PRAGMA table_info(users)').all().find((c) => c.name === 'founder_since');
  assert.ok(column, 'the column');
  assert.equal(column.type, 'TEXT');
  assert.equal(column.notnull, 0);
  assert.equal(column.dflt_value, null);
  const ana = account('Ana Fundadora', 'ana@example.test');
  assert.equal(db.prepare('SELECT founder_since FROM users WHERE id = ?').get(ana.id).founder_since, null);
});

test('a member cannot give themselves the badge through a profile update, under any of its names', async (t) => {
  const app = await boot(t);
  const ana = app.account('Ana Fundadora', 'ana@example.test');
  for (const body of [{ founder: true }, { founderSince: '2020-01-01T00:00:00.000Z' }, { founder_since: '2020-01-01T00:00:00.000Z' },
    { fullName: 'Ana Fundadora', founder: false }, { fullName: 'Ana Fundadora', founderSince: null }, { fullName: 'Ana Fundadora', founder_since: null }]) {
    const res = await app.json('/api/me', { cookie: ana.cookie, method: 'PATCH', body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.body.error, /cannot be changed through profile updates/);
  }
  // The role keys keep their own refusal.
  const role = await app.json('/api/me', { cookie: ana.cookie, method: 'PATCH', body: { role: 'admin' } });
  assert.deepEqual([role.status, role.body.error], [400, 'app_role cannot be changed through profile updates']);
  assert.equal(app.founderSince(ana.id), null, 'the flag is unchanged');
  const me = await app.json('/api/auth/me', { cookie: ana.cookie });
  assert.deepEqual([me.body.user.founder, me.body.user.founderSince], [false, null]);
});

test('only an administrator reads, gives or removes badges: signed out 401, members 403, cross-origin writes 403', async (t) => {
  const app = await boot(t);
  const admin = app.account('Equipo NODAL', 'equipo@example.test', 'admin');
  const ana = app.account('Ana Fundadora', 'ana@example.test');
  for (const [method, route, body] of [['GET', FOUNDERS], ['POST', FOUNDERS, { email: 'ana@example.test' }], ['DELETE', `${FOUNDERS}/${ana.id}`]]) {
    assert.equal((await app.call(route, { method, body })).status, 401, `${method} signed out`);
    assert.equal((await app.call(route, { method, body, cookie: ana.cookie })).status, 403, `${method} member`);
  }
  for (const [method, route, body] of [['POST', FOUNDERS, { email: 'ana@example.test' }], ['DELETE', `${FOUNDERS}/${ana.id}`]]) {
    assert.equal((await app.call(route, { method, body, cookie: admin.cookie, origin: 'https://evil.example' })).status, 403, `${method} cross-origin`);
  }
  assert.equal(app.founderSince(ana.id), null, 'nothing was given');
  assert.deepEqual(await app.json(FOUNDERS, { cookie: admin.cookie }), { status: 200, body: { founders: [] } });
});

test('an administrator gives the badge by the account email, once: the first date stays, and the member sees it', async (t) => {
  const app = await boot(t);
  const lines = infoLines(t);
  const admin = app.account('Equipo NODAL', 'equipo@example.test', 'admin');
  const ana = app.account('Ana Fundadora', 'Ana.Fundadora@Example.test');
  const first = await grant(app, admin, '  ANA.fundadora@example.TEST ');
  const at = new Date(T0).toISOString();
  assert.equal(first.status, 201);
  assert.deepEqual(first.body, { result: 'granted', founder: { id: ana.id, name: 'Ana Fundadora', email: 'ana.fundadora@example.test', founderSince: at } });
  const me = await app.json('/api/auth/me', { cookie: ana.cookie });
  assert.deepEqual([me.body.user.founder, me.body.user.founderSince], [true, at]);
  // A second grant, later, answers "already" and never moves the date.
  app.clock.at = T0 + 86_400_000;
  const again = await grant(app, admin, 'ana.fundadora@example.test');
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, { result: 'already', founder: first.body.founder });
  assert.equal(app.founderSince(ana.id), at);
  // The account's own data download carries it.
  const exported = await app.json('/api/me/export', { cookie: ana.cookie });
  assert.deepEqual([exported.body.data.user.founder, exported.body.data.user.founderSince], [true, at]);
  // One log line, for the grant only: the administrator's id and the member's, never the email.
  const logged = lines.filter((line) => /founder/i.test(line));
  assert.equal(logged.length, 1);
  assert.ok(logged[0].includes(admin.id) && logged[0].includes(ana.id), logged[0]);
  assert.ok(!/@|fundadora/i.test(logged[0].replace(/Founder/gi, '')), 'no email in the log');
});

test('a grant answers 404 for an address with no account and 400 for anything that is not one', async (t) => {
  const app = await boot(t);
  const admin = app.account('Equipo NODAL', 'equipo@example.test', 'admin');
  const ana = app.account('Ana Fundadora', 'ana@example.test');
  assert.deepEqual(await grant(app, admin, 'nobody@example.test'), { status: 404, body: { code: 'founder_not_found' } });
  for (const email of ['not-an-email', '', '   ', 'ana@', `${'a'.repeat(250)}@example.test`, 42, null, ['ana@example.test'], { email: 'ana@example.test' }]) {
    assert.deepEqual(await grant(app, admin, email), { status: 400, body: { code: 'founder_email_invalid' } }, JSON.stringify(email));
  }
  assert.deepEqual(await app.json(FOUNDERS, { cookie: admin.cookie, method: 'POST', body: {} }), { status: 400, body: { code: 'founder_email_invalid' } });
  assert.equal(app.founderSince(ana.id), null);
});

test('the account lookup\'s refusals keep their codes, and a provider failure is 503 founder_unavailable, never its wording', async (t) => {
  const db = createDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  const errors = [], original = console.error;
  console.error = (...args) => { errors.push(args.join(' ')); };
  t.after(() => { console.error = original; });
  let failure = null;
  const sqlite = createRepository({ db });
  const failing = (method) => async (...args) => { if (failure) throw failure; return sqlite[method](...args); };
  const repository = { ...sqlite, findCourseAccount: failing('findCourseAccount'), listFounders: failing('listFounders'), removeFounder: failing('removeFounder') };
  const server = createApp({ db, repository, billingEnv: {}, now: () => T0, pilotMode: true, citySearch: { search: async () => ({ cities: [] }) } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const admin = createUser(db, { fullName: 'Equipo NODAL', email: 'equipo@example.test', passwordHash: 'unused', role: 'admin' });
  const cookie = createSession(db, admin.id).cookie.split(';')[0];
  const ask = async (method, route, body) => {
    const res = await fetch(`${base}${route}`, { method, headers: { Cookie: cookie, Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const cases = [
    // supabase.js findCourseAccount's own refusals carry no expose flag.
    [Object.assign(new Error('Account could not be verified.'), { status: 409 }), 409, 'founder_account_conflict'],
    [Object.assign(new Error('A valid email is required.'), { status: 400 }), 400, 'founder_email_invalid'],
    // A provider's answer is never the lookup's refusal, whatever its status.
    [Object.assign(new Error('duplicate key value violates "profiles_pkey"'), { status: 409, expose: false }), 503, 'founder_unavailable'],
    [Object.assign(new Error('column profiles.founder_since does not exist'), { status: 400, expose: false }), 503, 'founder_unavailable'],
    [Object.assign(new Error('Supabase unavailable: TimeoutError'), { status: 503, expose: false }), 503, 'founder_unavailable'],
  ];
  for (const [error, status, code] of cases) {
    failure = error;
    assert.deepEqual(await ask('POST', FOUNDERS, { email: 'ana@example.test' }), { status, body: { code } }, error.message);
  }
  failure = Object.assign(new Error('relation "profiles" is locked'), { status: 500, expose: false });
  assert.deepEqual(await ask('GET', FOUNDERS), { status: 503, body: { code: 'founder_unavailable' } });
  assert.deepEqual(await ask('DELETE', `${FOUNDERS}/${admin.id}`), { status: 503, body: { code: 'founder_unavailable' } });
  assert.ok(errors.some((line) => line.includes('request error')), 'the failures are logged');
});

test('the founders list is newest first, with name, email and date only, and an account deleted takes its badge with it', async (t) => {
  const app = await boot(t);
  const admin = app.account('Equipo NODAL', 'equipo@example.test', 'admin');
  const ana = app.account('Ana Fundadora', 'ana@example.test');
  const bruno = app.account('Bruno Dias', 'bruno@example.test');
  app.account('Carla Sem Badge', 'carla@example.test');
  assert.equal((await grant(app, admin, 'ana@example.test')).status, 201);
  app.clock.at = T0 + 60_000;
  assert.equal((await grant(app, admin, 'bruno@example.test')).status, 201);
  const listed = await app.json(FOUNDERS, { cookie: admin.cookie });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.body, { founders: [
    { id: bruno.id, name: 'Bruno Dias', email: 'bruno@example.test', founderSince: new Date(T0 + 60_000).toISOString() },
    { id: ana.id, name: 'Ana Fundadora', email: 'ana@example.test', founderSince: new Date(T0).toISOString() },
  ] });
  deleteUserById(app.db, bruno.id);
  assert.deepEqual((await app.json(FOUNDERS, { cookie: admin.cookie })).body.founders.map((f) => f.id), [ana.id]);
});

test('another member\'s card says whether they hold the badge, without its date', async (t) => {
  const app = await boot(t);
  const admin = app.account('Equipo NODAL', 'equipo@example.test', 'admin');
  const consent = { bio: 'Works on bus corridors.', linkedin: '', portfolio: '', references: '', availability: '', consent: true };
  const ana = app.account('Ana Fundadora', 'ana@example.test');
  const bruno = app.account('Bruno Dias', 'bruno@example.test');
  for (const member of [ana, bruno]) assert.equal((await app.call('/api/me', { cookie: member.cookie, method: 'PATCH', body: { fullName: member.user.full_name, partC: consent } })).status, 200);
  assert.equal((await grant(app, admin, 'ana@example.test')).status, 201);
  const card = await app.json(`/api/users/${ana.id}`, { cookie: bruno.cookie });
  assert.equal(card.status, 200);
  assert.equal(card.body.self, false);
  assert.equal(card.body.user.founder, true);
  assert.equal(card.body.user.founderSince, undefined, 'the date is the member\'s own');
  assert.equal((await app.json(`/api/users/${bruno.id}`, { cookie: ana.cookie })).body.user.founder, false);
  const own = await app.json(`/api/users/${ana.id}`, { cookie: ana.cookie });
  assert.deepEqual([own.body.self, own.body.user.founder, own.body.user.founderSince], [true, true, new Date(T0).toISOString()]);
});

test('removing a badge answers removed once, then 404, and is logged by ids', async (t) => {
  const app = await boot(t);
  const lines = infoLines(t);
  const admin = app.account('Equipo NODAL', 'equipo@example.test', 'admin');
  const ana = app.account('Ana Fundadora', 'ana@example.test');
  const bruno = app.account('Bruno Dias', 'bruno@example.test');
  assert.equal((await grant(app, admin, 'ana@example.test')).status, 201);
  const remove = (id) => app.json(`${FOUNDERS}/${id}`, { cookie: admin.cookie, method: 'DELETE' });
  assert.deepEqual(await remove(bruno.id), { status: 404, body: { code: 'founder_not_found' } }, 'an account without the badge');
  assert.deepEqual(await remove(randomUUID()), { status: 404, body: { code: 'founder_not_found' } }, 'no such account');
  assert.deepEqual(await remove('not-an-id'), { status: 404, body: { code: 'founder_not_found' } });
  assert.deepEqual(await remove(ana.id), { status: 200, body: { result: 'removed' } });
  assert.equal(app.founderSince(ana.id), null);
  assert.deepEqual(await remove(ana.id), { status: 404, body: { code: 'founder_not_found' } });
  const me = await app.json('/api/auth/me', { cookie: ana.cookie });
  assert.deepEqual([me.body.user.founder, me.body.user.founderSince], [false, null]);
  const removal = lines.filter((line) => /removed/i.test(line));
  assert.equal(removal.length, 1);
  assert.ok(removal[0].includes(admin.id) && removal[0].includes(ana.id) && !removal[0].includes('@'), removal[0]);
  // Given again after a mistake was corrected: a new date.
  app.clock.at = T0 + 5_000;
  assert.equal((await grant(app, admin, 'ana@example.test')).body.founder.founderSince, new Date(T0 + 5_000).toISOString());
});

test('course posts carry their author\'s badge as it is now, older posts too, and the report\'s participants carry it', async (t) => {
  const app = await boot(t);
  const admin = app.account('Equipo NODAL', 'equipo@example.test', 'admin');
  const ana = app.account('Ana Fundadora', 'ana@example.test');
  const bruno = app.account('Bruno Dias', 'bruno@example.test');
  const created = await app.json('/api/admin/courses', { cookie: admin.cookie, method: 'POST', body: { title: 'Movilidad', status: 'published', startsOn: '2026-09-09' } });
  assert.equal(created.status, 201);
  const course = created.body.course;
  const made = await app.json(`/api/admin/courses/${course.id}/modules`, { cookie: admin.cookie, method: 'POST', body: { title: 'First session', status: 'published' } });
  assert.equal(made.status, 201);
  const posts = `/api/courses/${course.id}/modules/${made.body.module.id}/posts`;
  const intake = { fullName: 'Participant', profession: 'Planner', city: 'Lima', motivation: 'Learn', experience: 'Beginner', expectations: 'Practice', caseStudy: 'Station', digitalFamiliarity: 'Comfortable' };
  for (const member of [ana, bruno]) {
    assert.equal((await app.call(`/api/courses/${course.id}/enroll`, { cookie: member.cookie, method: 'POST', body: {} })).status, 200);
    assert.equal((await app.call(`/api/courses/${course.id}/intake`, { cookie: member.cookie, method: 'PUT', body: intake })).status, 200);
  }
  const write = (member, body) => app.json(posts, { cookie: member.cookie, method: 'POST', body: { kind: 'question', body, clientId: randomUUID() } });
  const before = await write(ana, 'Written before the badge');
  assert.equal(before.status, 201);
  assert.equal(before.body.post.founder, false);
  assert.equal((await grant(app, admin, 'ana@example.test')).status, 201);
  const after = await write(ana, 'Written with the badge');
  assert.equal(after.body.post.founder, true, 'a new post by a founder');
  const plain = await write(bruno, 'Written by a member without it');
  assert.equal(plain.body.post.founder, false);
  const founderOf = (page) => Object.fromEntries(page.body.posts.map((post) => [post.body, post.founder]));
  const expected = { 'Written before the badge': true, 'Written with the badge': true, 'Written by a member without it': false };
  // Read by someone else, by the founder herself, and by staff.
  for (const viewer of [bruno, ana]) assert.deepEqual(founderOf(await app.json(posts, { cookie: viewer.cookie })), expected);
  // The single-post answers: reading one's own post back, and editing it.
  const own = `/api/courses/${course.id}/posts/${before.body.post.id}`;
  assert.equal((await app.json(own, { cookie: ana.cookie })).body.post.founder, true);
  const edited = await app.json(own, { cookie: ana.cookie, method: 'PATCH', body: { expectedBody: 'Written before the badge', body: 'Edited with the badge' } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.post.founder, true);
  // A withdrawn post shows no author, and no badge.
  assert.equal((await app.call(own, { cookie: ana.cookie, method: 'DELETE' })).status, 200);
  const withdrawn = await app.json(own, { cookie: ana.cookie });
  assert.deepEqual([withdrawn.body.post.deleted, withdrawn.body.post.founder], [true, false]);
  // The teaching report lists who holds it; the participants CSV keeps its columns.
  const report = await app.json(`/api/admin/courses/${course.id}/report`, { cookie: admin.cookie });
  assert.equal(report.status, 200);
  assert.deepEqual(Object.fromEntries(report.body.participants.map((p) => [p.userId, p.founder])), { [ana.id]: true, [bruno.id]: false });
  const exported = await app.call(`/api/admin/courses/${course.id}/export?type=participants`, { cookie: admin.cookie });
  assert.equal(exported.status, 200);
  // (text() drops the byte-order mark.)
  assert.equal((await exported.text()).replace(/^﻿/, '').split('\r\n')[0], '"userId","name","email","enrolledAt","intakeCompleted"');
  // Removing the badge removes it from every post at once.
  assert.equal((await app.call(`${FOUNDERS}/${ana.id}`, { cookie: admin.cookie, method: 'DELETE' })).status, 200);
  assert.deepEqual(Object.values(founderOf(await app.json(posts, { cookie: bruno.cookie }))), [false, false]);
});

test('the SQLite repository keeps the earliest date, removes only a badge that exists, and lists up to the limit', async (t) => {
  const db = createDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  const repository = createRepository({ db });
  const ids = ['Ana', 'Bruno', 'Carla'].map((name) => createUser(db, { fullName: name, email: `${name.toLowerCase()}@example.test`, passwordHash: 'unused' }).id);
  const first = await repository.grantFounder(ids[0], '2026-10-23T15:00:00.000Z');
  assert.deepEqual(first, { result: 'granted', founder: { id: ids[0], name: 'Ana', email: 'ana@example.test', founderSince: '2026-10-23T15:00:00.000Z' } });
  assert.deepEqual(await repository.grantFounder(ids[0], '2026-10-20T15:00:00.000Z'), { ...first, result: 'already' }, 'never moved');
  assert.equal(await repository.grantFounder(randomUUID(), '2026-10-23T15:00:00.000Z'), null, 'no such account');
  await repository.grantFounder(ids[1], '2026-10-24T15:00:00.000Z');
  await repository.grantFounder(ids[2], '2026-10-25T15:00:00.000Z');
  assert.deepEqual((await repository.listFounders()).map((f) => f.name), ['Carla', 'Bruno', 'Ana']);
  assert.deepEqual((await repository.listFounders({ limit: 2 })).map((f) => f.name), ['Carla', 'Bruno']);
  assert.equal(await repository.removeFounder(ids[1]), true);
  assert.equal(await repository.removeFounder(ids[1]), false);
  assert.equal(repository.toApiUser(await repository.getUserById(ids[0])).founderSince, '2026-10-23T15:00:00.000Z');
  assert.equal(repository.toApiUser(await repository.getUserById(ids[1])).founder, false);
});

/* ---- Supabase: profiles.founder_since through PostgREST ---- */

const SUPABASE_ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-public-key', SUPABASE_SECRET_KEY: 'test-server-key' };
const ANA = '0e9b9c1e-1111-4111-8111-111111111111';
const PROFILE = { id: ANA, full_name: 'Ana Fundadora', preferred_name: 'Ana', email: 'ana@example.test', app_role: 'member', account_status: 'active', founder_since: null };
const FOUNDER_SELECT = 'id,email,full_name,preferred_name,founder_since';

// answer(call) gives the rows (or {rows, range}) for a request; anything it does not expect fails the test.
function supabaseFake(answer) {
  const calls = [];
  const fetchImpl = async (raw, options = {}) => {
    const url = new URL(raw), method = options.method || 'GET';
    const call = { url, method, headers: options.headers || {}, body: options.body ? JSON.parse(options.body) : undefined, query: Object.fromEntries(url.searchParams) };
    calls.push(call);
    const result = answer(call);
    if (result === undefined) throw new Error(`unexpected Supabase request: ${method} ${url.pathname}${url.search}`);
    const rows = Array.isArray(result) ? result : result.rows;
    return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json', ...(result.range ? { 'Content-Range': result.range } : {}) } });
  };
  return { calls, repository: createSupabaseRepository({ env: SUPABASE_ENV, fetchImpl }) };
}

test('Supabase maps founder_since onto the member: a canonical date, or no badge', async () => {
  for (const [stored, founder, founderSince] of [['2026-10-23T15:00:00.123456+00:00', true, '2026-10-23T15:00:00.123Z'], [null, false, null], [undefined, false, null], ['not a date', false, null]]) {
    const { repository } = supabaseFake(({ method, url }) => {
      if (method !== 'GET') return undefined;
      if (url.pathname === '/rest/v1/profiles') return [{ ...PROFILE, founder_since: stored }];
      if (['/rest/v1/profile_preferences', '/rest/v1/onboarding_responses'].includes(url.pathname)) return [];
      return undefined;
    });
    const user = await repository.getUserById(ANA);
    assert.deepEqual([user.founder, user.founderSince], [founder, founderSince], String(stored));
  }
});

test('Supabase grants with one guarded PATCH that only fills an empty date, and reads back an existing one', async () => {
  const granted = supabaseFake(({ method, url }) => method === 'PATCH' && url.pathname === '/rest/v1/profiles' ? [{ ...PROFILE, founder_since: '2026-10-23T15:00:00+00:00' }] : undefined);
  assert.deepEqual(await granted.repository.grantFounder(ANA, '2026-10-23T15:00:00.000Z'), {
    result: 'granted', founder: { id: ANA, name: 'Ana Fundadora', email: 'ana@example.test', founderSince: '2026-10-23T15:00:00.000Z' },
  });
  assert.equal(granted.calls.length, 1);
  const [patch] = granted.calls;
  assert.deepEqual(patch.query, { id: `eq.${ANA}`, founder_since: 'is.null', select: FOUNDER_SELECT });
  assert.equal(patch.headers.Prefer, 'return=representation');
  assert.equal(patch.headers.Authorization, 'Bearer test-server-key');
  assert.deepEqual(patch.body, { founder_since: '2026-10-23T15:00:00.000Z' }, 'nothing but the date, never app_role');

  // Already a founder: the PATCH matches nothing, and the first date is read back unchanged.
  const already = supabaseFake(({ method }) => method === 'PATCH' ? [] : method === 'GET' ? [{ ...PROFILE, founder_since: '2026-10-01T12:00:00+00:00' }] : undefined);
  assert.deepEqual(await already.repository.grantFounder(ANA, '2026-10-23T15:00:00.000Z'), {
    result: 'already', founder: { id: ANA, name: 'Ana Fundadora', email: 'ana@example.test', founderSince: '2026-10-01T12:00:00.000Z' },
  });
  assert.deepEqual(already.calls.map((c) => c.method), ['PATCH', 'GET']);
  assert.deepEqual(already.calls[1].query, { id: `eq.${ANA}`, select: FOUNDER_SELECT });

  // The profile is gone: no founder.
  const gone = supabaseFake(({ method }) => ['PATCH', 'GET'].includes(method) ? [] : undefined);
  assert.equal(await gone.repository.grantFounder(ANA, '2026-10-23T15:00:00.000Z'), null);
});

test('Supabase removes with one guarded PATCH and lists founders newest first, page by page up to the limit', async () => {
  const removed = supabaseFake(({ method }) => method === 'PATCH' ? [{ id: ANA }] : undefined);
  assert.equal(await removed.repository.removeFounder(ANA), true);
  assert.deepEqual(removed.calls[0].query, { id: `eq.${ANA}`, founder_since: 'not.is.null', select: 'id' });
  assert.deepEqual(removed.calls[0].body, { founder_since: null });
  assert.equal(removed.calls[0].headers.Prefer, 'return=representation');
  assert.equal(await supabaseFake(({ method }) => method === 'PATCH' ? [] : undefined).repository.removeFounder(ANA), false);

  const rows = Array.from({ length: 5 }, (_, i) => ({ ...PROFILE, id: `${i}e9b9c1e-1111-4111-8111-111111111111`, full_name: `Founder ${i}`, founder_since: `2026-10-2${5 - i}T15:00:00+00:00` }));
  // A project row cap of 2 shortens every page; Content-Range says more may follow.
  const listing = supabaseFake(({ method, query }) => {
    if (method !== 'GET') return undefined;
    const offset = Number(query.offset || 0), page = rows.slice(offset, offset + Math.min(Number(query.limit), 2));
    return { rows: page, range: page.length ? `${offset}-${offset + page.length - 1}/*` : '*/*' };
  });
  const listed = await listing.repository.listFounders();
  assert.deepEqual(listed.map((f) => f.founderSince), rows.map((row) => new Date(row.founder_since).toISOString()));
  assert.deepEqual(listed[0], { id: rows[0].id, name: 'Founder 0', email: 'ana@example.test', founderSince: '2026-10-25T15:00:00.000Z' });
  for (const call of listing.calls) {
    assert.equal(call.url.pathname, '/rest/v1/profiles');
    assert.deepEqual([call.query.select, call.query.founder_since, call.query.order], [FOUNDER_SELECT, 'not.is.null', 'founder_since.desc,id.desc']);
    assert.ok(Number(call.query.limit) <= 500);
  }
  assert.equal((await listing.repository.listFounders({ limit: 3 })).length, 3);
});

test('Supabase answers an id that is not a uuid as no founder, without a request', async () => {
  const { calls, repository } = supabaseFake(() => undefined);
  for (const id of ['not-a-uuid', '', `${ANA}x`, `${ANA}&app_role=eq.admin`, null, undefined, 42]) {
    assert.equal(await repository.grantFounder(id, '2026-10-23T15:00:00.000Z'), null, String(id));
    assert.equal(await repository.removeFounder(id), false, String(id));
  }
  assert.equal(calls.length, 0);
});

test('Supabase profile updates never write founder_since, whatever the patch says', async () => {
  const { calls, repository } = supabaseFake(({ method, url }) => {
    if (url.pathname === '/rest/v1/profiles') return [{ ...PROFILE }];
    if (method === 'GET' || method === 'POST') return [];
    return undefined;
  });
  await repository.updateUserProfile(ANA, { fullName: 'Ana Fundadora', founder: true, founderSince: '2020-01-01T00:00:00.000Z', founder_since: '2020-01-01T00:00:00.000Z' });
  const writes = calls.filter((c) => c.method !== 'GET');
  assert.ok(writes.some((c) => c.method === 'PATCH' && c.url.pathname === '/rest/v1/profiles'), 'the profile was patched');
  assert.ok(writes.every((c) => !JSON.stringify(c.body).includes('founder')), 'no founder field in any write');
});

test('Supabase course members carry the badge from founder_since', async () => {
  const calls = [];
  const store = createCourseStore({ clients: { admin: { rest: async (table, args) => {
    calls.push({ table, ...args });
    return { rows: [{ id: 'a', full_name: 'Ana', email: 'ana@example.test', app_role: 'member', founder_since: '2026-10-23T15:00:00+00:00' }, { id: 'b', full_name: 'Bruno', email: 'bruno@example.test', app_role: 'admin', founder_since: null }], contentRange: '0-1/2' };
  } } } });
  assert.deepEqual(await store.getMembers(['a', 'b']), [
    { id: 'a', name: 'Ana', email: 'ana@example.test', staff: false, founder: true },
    { id: 'b', name: 'Bruno', email: 'bruno@example.test', staff: true, founder: false },
  ]);
  assert.equal(calls[0].table, 'profiles');
  assert.equal(calls[0].query.select, 'id,full_name,email,app_role,founder_since');
});

test('the Supabase migration only adds the nullable column, applied by hand before main', () => {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const name = readdirSync(dir).find((file) => file.endsWith('_founder_badge.sql'));
  assert.equal(name, '20261023000000_founder_badge.sql');
  assert.ok(readdirSync(dir).filter((file) => file.endsWith('.sql')).sort().at(-1) === name, 'the newest migration');
  const raw = readFileSync(path.join(dir, name), 'utf8');
  assert.match(raw, /npx --no-install supabase db query --linked -f supabase\/migrations\/20261023000000_founder_badge\.sql/);
  assert.match(raw, /supabase migration repair --status applied 20261023000000/);
  assert.match(raw, /Never `db push`/);
  assert.match(raw, /BEFORE pushing `main`/);
  assert.match(raw, /Additive/);
  for (const route of ['/api/admin/membership/founders', '/api/me/export']) assert.ok(raw.includes(route), route);
  // The header says why no grant or view change is needed.
  assert.match(raw, /service_role/);
  assert.match(raw, /public_profiles/);
  const statements = raw.replace(/--[^\n]*/g, '').split(';').map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
  assert.deepEqual(statements.map((s) => s.split(' ').slice(0, 3).join(' ')), ['BEGIN', 'ALTER TABLE public.profiles', 'COMMENT ON COLUMN', 'COMMIT']);
  assert.equal(statements[1], 'ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS founder_since timestamptz');
  assert.match(statements[2], /^COMMENT ON COLUMN public\.profiles\.founder_since IS '[^']*\/api\/admin\/membership\/founders[^']*never from a request body[^']*'$/);
  const deployment = readFileSync(path.join(ROOT, 'DEPLOYMENT.md'), 'utf8');
  const step = deployment.slice(deployment.indexOf('## Founder badge'), deployment.indexOf('## Supabase Setup'));
  assert.ok(step.length > 200, 'DEPLOYMENT.md has the step');
  assert.match(step, /before pushing `main`/);
  assert.ok(step.includes('20261023000000_founder_badge.sql') && step.includes('migration repair --status applied 20261023000000'));
  for (const route of ['/api/admin/membership/founders', '/api/me/export']) assert.ok(step.includes(route), `DEPLOYMENT.md: ${route}`);
});

test('the payments routine gives the badge on the admin desk after adding a payer, and again for a re-created account', () => {
  const doc = readFileSync(path.join(ROOT, 'docs', 'supporter-payments.md'), 'utf8');
  const routine = doc.slice(doc.indexOf('## 3. Add each payer'), doc.indexOf('## 4.'));
  const steps = [...routine.matchAll(/^(\d)\. \*\*([^*]+)\*\*/gm)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(steps.map((s) => s.slice(0, 1)), ['1', '2', '3', '4', '5']);
  assert.match(steps[3], /^4 Give the Founder badge/);
  const badge = routine.slice(routine.indexOf('4. **'), routine.indexOf('5. **'));
  assert.match(badge, /`\/admin\.html`[^\n]*Membresía Fundador/);
  assert.match(badge, /not renewed/);
  assert.match(badge, /delete[^\n]*NODAL account/);
  assert.match(badge, /again/);
  assert.match(badge, /mistake/);
  assert.match(badge, /acceptances CSV/);
  // Cross-references follow the renumbered step.
  assert.match(doc, /see \*Add each payer\*, step 5/);
  assert.match(doc, /\*\*A payer who deleted their NODAL account[^\n]*Founder badge/);
});
