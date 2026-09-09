import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDatabase, createUser, updateUserProfile } from '../server/db.js';
import { createRepository } from '../server/repository.js';
import { createApp, createCitySearch } from '../server/server.js';

async function fixture(t, { allowGraph = false } = {}) {
  const db = createDatabase({ filename: ':memory:' });
  const member = createUser(db, { fullName: 'Member', email: 'member@test.invalid', passwordHash: 'unusable' });
  const peer = createUser(db, { fullName: 'Peer', email: 'peer@test.invalid', passwordHash: 'unusable' });
  updateUserProfile(db, peer.id, { partC: { consent: true } });
  const repository = createRepository({ db });
  repository.resolveSession = async () => ({ user: member, cookies: [] });
  let reads = 0;
  const get = repository.getUserById;
  repository.getUserById = async id => { reads++; return get(id); };
  let graphReads = 0;
  const loadGraph = repository.loadGraphStore.bind(repository);
  repository.loadGraphStore = async (...args) => {
    graphReads++;
    if (!allowGraph) throw new Error('An interaction must not load the graph');
    return loadGraph(...args);
  };
  const server = createApp({ repository, courseStore: null });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (action, body) => fetch(`${base}/api/users/me/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { db, peer, post, base, reads: () => reads, graphReads: () => graphReads };
}

test('recommendation throttling runs before graph work and has an independent budget', async t => {
  const f = await fixture(t, { allowGraph: true });
  for (let i = 0; i < 60; i++) {
    const response = await fetch(`${f.base}/api/recommendations/me`);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray((await response.json()).recommendations));
  }
  const reads = f.graphReads();
  const blocked = await fetch(`${f.base}/api/recommendations/me`);
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
  assert.equal(f.graphReads(), reads);
  assert.equal((await f.post('follow', { targetId: f.peer.id })).status, 200);
});

test('invalid activity consumes budget before any target or graph lookup', async t => {
  const f = await fixture(t);
  for (const action of ['follow', 'interactions']) {
    for (let i = 0; i < 60; i++) assert.equal((await f.post(action, {})).status, 400);
    const blocked = await f.post(action, { targetId: f.peer.id, type: 'skip' });
    assert.equal(blocked.status, 429); assert.ok(blocked.headers.get('retry-after'));
  }
  assert.equal(f.reads(), 0);
});

test('valid activity uses a scoped target lookup and enforces privacy', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('interactions', { targetId: f.peer.id, type: 'message' })).status, 400);
  assert.equal(f.reads(), 0);
  assert.equal((await f.post('follow', { targetId: f.peer.id })).status, 200);
  assert.equal((await f.post('interactions', { targetId: f.peer.id, type: 'skip' })).status, 200);
  assert.equal(f.reads(), 2);
  updateUserProfile(f.db, f.peer.id, { partC: { consent: false } });
  assert.equal((await f.post('follow', { targetId: f.peer.id })).status, 400);
  updateUserProfile(f.db, f.peer.id, { partC: { consent: true } });
  f.db.prepare("UPDATE users SET account_status='disabled' WHERE id=?").run(f.peer.id);
  assert.equal((await f.post('follow', { targetId: f.peer.id })).status, 400);
  assert.equal((await f.post('follow', { targetId: 'missing' })).status, 400);
});

test('non-object JSON fails cleanly before route field access', async t => {
  const f = await fixture(t);
  for (const value of [null, [], false, 'hello', 42]) {
    const response = await f.post('interactions', value);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /invalid JSON/);
  }
  assert.equal(f.reads(), 0);
});

const cityResponse = () => ({ ok: true, json: async () => ({ data: [{ city: 'Equator', countryCode: 'EC', latitude: 0, longitude: 0 }] }) });

test('city cache evicts old keys, expires results, and keeps zero coordinates', async () => {
  let calls = 0, now = 1;
  const search = createCitySearch({ maxEntries: 2, minIntervalMs: 0, now: () => now, fetchImpl: async () => { calls++; return cityResponse(); } });
  const first = await search.search('alpha');
  assert.equal(first.cities[0].lat, 0); assert.equal(first.cities[0].lon, 0);
  await search.search('alpha'); assert.equal(calls, 1);
  await search.search('bravo'); await search.search('charlie');
  await search.search('alpha'); assert.equal(calls, 4);
  now += 2 * 86400000; await search.search('alpha'); assert.equal(calls, 5);
});

test('city lookup coalesces identical in-flight requests', async () => {
  let calls = 0, release;
  const response = new Promise(resolve => { release = resolve; });
  const search = createCitySearch({ minIntervalMs: 0, fetchImpl: async () => { calls++; return response; } });
  const results = Array.from({ length: 200 }, () => search.search('Cambridge'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(calls, 1); release(cityResponse()); await Promise.all(results);
});

test('city lookup caps queued work and aborts a stalled upstream', async () => {
  const waits = [];
  const queued = createCitySearch({ now: () => 100, minIntervalMs: 1000, wait: async ms => waits.push(ms), fetchImpl: async () => cityResponse() });
  const work = ['alpha', 'bravo', 'charlie', 'delta'].map(q => queued.search(q));
  const outcomes = await Promise.allSettled(work);
  assert.deepEqual(waits, [1000, 2000]); assert.equal(outcomes[3].status, 'rejected');
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const stalled = createCitySearch({ minIntervalMs: 0, requestTimeoutMs: 10, fetchImpl: (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
    await assert.rejects(stalled.search('alpha'), error => error.name === 'TimeoutError');
  } finally { clearTimeout(keepAlive); }
});
