/* Network reads: recommendations for members who are not in the directory, the
   globe's geocoding when the provider is failing, and the staff file library's
   request budget. SQLite only; the geocoder is a stub. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

// A short geocoding budget keeps the slow-provider case quick; set before the server module reads it.
process.env.NETWORK_GEOCODE_BUDGET_MS = '400';
const { createApp } = await import('../server/server.js');
const { createDatabase, createUser, updateUserProfile, setUserLocation } = await import('../server/db.js');
const { createRepository } = await import('../server/repository.js');
const { createSession } = await import('../server/auth.js');

async function boot(t, options) {
  const server = createApp(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

function database(t) {
  const db = createDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  return db;
}

const member = (db, name, { consent = true, city = '', role = 'member', point = null } = {}) => {
  const user = createUser(db, { fullName: name, email: `${name.toLowerCase().replaceAll(' ', '-')}@test.invalid`, passwordHash: 'unusable', role });
  updateUserProfile(db, user.id, { city, interests: ['urban data', 'mobility'], partC: { consent } });
  if (point) setUserLocation(db, user.id, point);
  return { id: user.id, cookie: createSession(db, user.id).cookie.split(';')[0] };
};

test('a cached recommendation for an unlisted member is served without reloading the graph', async t => {
  const db = database(t);
  const repository = createRepository({ db });
  let graphLoads = 0;
  const load = repository.loadGraphStore.bind(repository);
  repository.loadGraphStore = async options => { graphLoads++; return load(options); };
  for (const name of ['Peer One', 'Peer Two', 'Peer Three']) member(db, name);
  const viewer = member(db, 'Private Viewer', { consent: false });
  const base = await boot(t, { repository, citySearch: { search: async () => ({ cities: [] }) } });
  const get = () => fetch(`${base}/api/recommendations/me`, { headers: { cookie: viewer.cookie } });
  const first = await get();
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-cache'), 'MISS');
  const firstBody = await first.json();
  const loadsAfterMiss = graphLoads;
  for (let i = 0; i < 3; i++) {
    const again = await get();
    assert.equal(again.headers.get('x-cache'), 'HIT');
    assert.deepEqual(await again.json(), firstBody);
  }
  assert.equal(graphLoads, loadsAfterMiss, 'a cache hit reads no follows or interactions');

  // Any write moves the revision, so the next request is recomputed.
  member(db, 'Peer Four');
  const fresh = await get();
  assert.equal(fresh.headers.get('x-cache'), 'MISS');
  assert.ok((await fresh.json()).recommendations.some(r => r.name === 'Peer Four'));
});

test('a city the geocoder cannot place is not looked up again on every rebuild', async t => {
  const db = database(t);
  let lookups = 0;
  const citySearch = { search: async () => { lookups++; throw new Error('city provider returned 503'); } };
  const viewer = member(db, 'Atlantis Member', { city: 'Atlantis' });
  const base = await boot(t, { db, citySearch });
  const places = async () => {
    const res = await fetch(`${base}/api/network/places`, { headers: { cookie: viewer.cookie } });
    assert.equal(res.status, 200);
    return res.json();
  };
  assert.equal((await places()).places.length, 0);
  assert.equal(lookups, 1);
  // A write changes the network revision, so the places payload is built again.
  member(db, 'Quito Member', { city: 'Quito', point: { lat: -0.2, lon: -78.5, label: 'Quito' } });
  const rebuilt = await places();
  assert.deepEqual(rebuilt.places.map(p => p.city), ['Quito']);
  assert.equal(lookups, 1, 'the recent failure is remembered');
});

test('a slow geocoder cannot hold the globe poll open', async t => {
  const db = database(t);
  let lookups = 0;
  const citySearch = { search: async () => { lookups++; await new Promise(resolve => setTimeout(resolve, 1500)); return { cities: [] }; } };
  const viewer = member(db, 'Slow One', { city: 'Slowtown' });
  for (const city of ['Lagtown', 'Waitville', 'Hangburg']) member(db, `${city} Member`, { city });
  const base = await boot(t, { db, citySearch });
  const started = Date.now();
  const res = await fetch(`${base}/api/network/places`, { headers: { cookie: viewer.cookie }, signal: AbortSignal.timeout(10_000) });
  assert.equal(res.status, 200);
  assert.ok(Date.now() - started < 1400, `answered in ${Date.now() - started} ms`);
  assert.equal(lookups, 1, 'no further lookups start once the time budget is spent');
});

test('listing the staff file library does not spend the upload budget', async t => {
  const db = database(t);
  const admin = member(db, 'Course Admin', { role: 'admin' });
  const base = await boot(t, { db, citySearch: { search: async () => ({ cities: [] }) } });
  const statuses = [];
  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${base}/api/admin/courses/course-1/modules/module-1/attachments`, { headers: { cookie: admin.cookie } });
    statuses.push(res.status);
    await res.arrayBuffer();
  }
  assert.ok(!statuses.includes(429), `statuses: ${statuses.join(',')}`);
});
