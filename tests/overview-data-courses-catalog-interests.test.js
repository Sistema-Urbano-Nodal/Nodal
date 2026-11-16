/* Catalog interests on Supabase key on uuids (catalog_interests.id and item_id), and PostgREST answers any other value
   with 22P02, a 400 the server turns into a 502 and a log line. An id that cannot exist is answered as missing here,
   as the SQLite twin answers it, without a provider call. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseRepository } from '../server/supabase.js';

const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-public-key', SUPABASE_SECRET_KEY: 'test-server-key' };
const MEMBER = '00000000-0000-4000-8000-000000000001';
const forgedCursor = Buffer.from(JSON.stringify(['2026-01-01T00:00:00.000Z', 'probe'])).toString('base64url');

function fakePostgrest() {
  const calls = [];
  const fetchImpl = async (raw) => {
    const query = decodeURIComponent(new URL(raw).search);
    calls.push(query);
    if (/probe/.test(query)) return new Response(JSON.stringify({ code: '22P02', message: 'invalid input syntax for type uuid: "probe1"' }), { status: 400, headers: { 'content-type': 'application/json' } });
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  };
  return { calls, repo: createSupabaseRepository({ env, fetchImpl }) };
}

test('a catalog interest whose item or id cannot exist is missing without asking PostgREST', async () => {
  const { calls, repo } = fakePostgrest();
  assert.equal(await repo.getCatalogInterest('probe1', MEMBER), null);
  assert.equal(await repo.withdrawCatalogInterest('probe1', MEMBER), false);
  assert.equal(await repo.getCatalogInterestById('probe1'), null);
  assert.equal(await repo.updateCatalogInterest('probe1', { status: 'closed' }, 1, MEMBER), null);
  assert.deepEqual(calls, []);
});

test('a forged interest cursor id widens the PostgREST filter and the exact comparison decides', async () => {
  const { calls, repo } = fakePostgrest();
  assert.deepEqual(await repo.listCatalogInterestsForUser(MEMBER, { cursor: forgedCursor }), { interests: [], nextCursor: null });
  assert.deepEqual(await repo.listAdminInterests({ cursor: forgedCursor }), { interests: [], nextCursor: null });
  assert.equal(calls.length, 2);
  for (const query of calls) {
    assert.doesNotMatch(query, /probe/);
    assert.match(query, /and\(updated_at\.eq\.2026-01-01T00:00:00\.000Z,id\.not\.is\.null\)/);
  }
});
