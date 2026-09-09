import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSupabaseRepository } from '../server/supabase.js';

const execute = promisify(execFile);
const from = '90000000-0000-0000-0000-000000000001';
const to = '90000000-0000-0000-0000-000000000002';
const third = '90000000-0000-0000-0000-000000000003';
const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-test', SUPABASE_SECRET_KEY: 'server-test' };

test('Supabase follow retries report existing edges without issuing a second interaction write', async () => {
  const calls = [];
  const repository = createSupabaseRepository({ env, fetchImpl: async (rawUrl, options) => {
    calls.push({ url: new URL(rawUrl), options });
    assert.equal(calls.at(-1).url.pathname, '/rest/v1/member_follows');
    assert.equal(options.headers.Authorization, 'Bearer server-test');
    assert.match(options.headers.Prefer, /resolution=ignore-duplicates/);
    assert.match(options.headers.Prefer, /return=representation/);
    return new Response(JSON.stringify(calls.length === 1 ? [{ user_id: from, target_user_id: to }] : []));
  } });
  assert.equal(await repository.addFollow(from, to), true);
  assert.equal(await repository.addFollow(from, to), false);
  assert.equal(calls.length, 2);
});

test('a failed Supabase follow never issues an independent interaction write', async () => {
  let calls = 0;
  const repository = createSupabaseRepository({ env, fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ message: 'temporarily unavailable' }), { status: 503 });
  } });
  await assert.rejects(repository.addFollow(from, to), { status: 503 });
  assert.equal(calls, 1);
});

// Explicit opt-in: this test owns an EMPTY disposable database, never a linked
// Supabase project. The regular suite does not require PostgreSQL to be installed.
const postgresUrl = process.env.NODAL_INTERACTION_TEST_DATABASE_URL;
test('PostgreSQL migration trims history, denies browser access, and serializes concurrent writes', { skip: !postgresUrl, timeout: 120000 }, async () => {
  const url = new URL(postgresUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'only a local disposable PostgreSQL server is permitted');
  assert.match(url.pathname, /^\/nodal_interaction_test_[a-z0-9_]+$/);
  assert.equal(url.search, '', 'connection parameters cannot override the local host');
  const psql = process.env.NODAL_INTERACTION_TEST_PSQL || 'psql';
  const sql = async text => (await execute(psql, [postgresUrl, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-c', text], { maxBuffer: 1024 * 1024 })).stdout.trim();
  const apply = async relative => execute(psql, [postgresUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', new URL(relative, import.meta.url).pathname], { maxBuffer: 1024 * 1024 });
  assert.equal(await sql("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"), '0', 'validation database must start empty');
  await sql(`DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  END $$;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users(id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
  GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
  for (const migration of ['20260709_production_core.sql', '20260710000000_security_hardening.sql', '20260710010000_advisor_hardening.sql', '20260810131954_catalog_and_admin_roles.sql', '20260810175241_service_role_data_api_grants.sql', '20260905175135_network_revision.sql']) {
    await apply('../supabase/migrations/' + migration);
  }
  await sql(`INSERT INTO auth.users(id) VALUES('${from}'),('${to}'),('${third}');
    INSERT INTO public.member_interactions(from_user_id,to_user_id,type,created_at)
    SELECT '${from}','${to}','skip','2026-01-01'::timestamptz + n * interval '1 second' FROM generate_series(1,80) n;
    INSERT INTO public.member_interactions(from_user_id,to_user_id,type) VALUES('${to}','${from}','skip');`);
  const newest = await sql(`SELECT string_agg(id::text,',' ORDER BY id) FROM (SELECT id FROM public.member_interactions WHERE from_user_id='${from}' ORDER BY created_at DESC,id DESC LIMIT 50) newest`);
  await apply('../supabase/migrations/20260909005000_member_interaction_retention.sql');
  assert.equal(await sql(`SELECT string_agg(id::text,',' ORDER BY id) FROM public.member_interactions WHERE from_user_id='${from}'`), newest, 'backfill preserves exactly the newest 50 rows');
  assert.equal(await sql(`SELECT count(*) FROM public.member_interactions WHERE from_user_id='${to}'`), '1', 'reverse direction is independent');
  await apply('./fixtures/member-interaction-retention-check.sql');

  // Separate PostgreSQL sessions overlap while retaining the lock through commit.
  // All timestamps in each transaction tie, exercising the id tie-breaker too.
  await Promise.all(Array.from({ length: 8 }, () => sql(`BEGIN; SET LOCAL ROLE service_role;
    INSERT INTO public.member_interactions(from_user_id,to_user_id,type)
    SELECT '${from}','${to}','skip' FROM generate_series(1,12);
    SELECT pg_sleep(0.08); COMMIT;`)));
  assert.equal(await sql(`SELECT count(*) FROM public.member_interactions WHERE from_user_id='${from}' AND to_user_id='${to}'`), '50', 'concurrent committed batches cannot exceed the pair bound');
  assert.equal(await sql(`SELECT count(*) FROM public.member_interactions WHERE from_user_id='${to}' AND to_user_id='${from}'`), '1');

  // Retention and revision locks must use the same order even when two batches
  // visit different pairs in opposite orders. Each row fires both triggers.
  await Promise.all([false, true].map(reverse => sql(`BEGIN; SET LOCAL ROLE service_role;
    INSERT INTO public.member_interactions(from_user_id,to_user_id,type)
    SELECT '${from}',CASE WHEN n % 2 = ${reverse ? 0 : 1} THEN '${to}'::uuid ELSE '${third}'::uuid END,'skip'
    FROM generate_series(1,60) n; COMMIT;`)));
  assert.equal(await sql(`SELECT count(*) FROM public.member_interactions WHERE from_user_id='${from}' AND to_user_id='${to}'`), '50');
  assert.equal(await sql(`SELECT count(*) FROM public.member_interactions WHERE from_user_id='${from}' AND to_user_id='${third}'`), '50');

  // Hold both repeatable-read snapshots behind a third session's advisory lock.
  // The revision row changes after those snapshots, so exactly one transaction
  // commits and the stale transaction must abort with SQLSTATE 40001. This also
  // exercises the boundary where an unchecked stale count could leave 51 rows.
  await sql(`DELETE FROM public.member_interactions WHERE from_user_id='${to}' AND to_user_id='${from}';
    INSERT INTO public.member_interactions(from_user_id,to_user_id,type)
    SELECT '${to}','${from}','skip' FROM generate_series(1,49);`);
  const barrierKey = 93210050;
  const barrier = sql(`BEGIN; SELECT pg_advisory_xact_lock(${barrierKey}); SELECT pg_sleep(20); COMMIT;`).catch(error => error);
  const waitFor = async query => {
    const deadline = Date.now() + 10000;
    do {
      const result = await sql(query);
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    assert.fail('PostgreSQL concurrency barrier was not reached');
  };
  const locks = `pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND objid=${barrierKey}`;
  const holderPid = await waitFor(`SELECT pid FROM ${locks} AND granted`);
  const repeatableWrite = `BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL ROLE service_role;
    SELECT revision FROM public.network_revision WHERE id=1;
    SELECT pg_advisory_xact_lock(${barrierKey});
    INSERT INTO public.member_interactions(from_user_id,to_user_id,type) VALUES('${to}','${from}','skip'); COMMIT;`;
  const competing = Promise.allSettled([sql(repeatableWrite), sql(repeatableWrite)]);
  try {
    await waitFor(`SELECT count(*) FROM ${locks} AND NOT granted HAVING count(*)=2`);
  } finally {
    // This cancels only the dedicated barrier session in this empty local test
    // database, releasing its transaction lock so both writers can finish.
    await sql(`SELECT pg_cancel_backend(${Number(holderPid)})`);
    const cancelled = await barrier;
    assert.match(cancelled.stderr || '', /57014/, 'barrier session was cancelled');
  }
  const outcomes = await competing;
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  const rejected = outcomes.find(outcome => outcome.status === 'rejected');
  assert.match(rejected.reason.stderr, /40001/, 'stale repeatable-read snapshot fails safely');
  assert.equal(await sql(`SELECT count(*) FROM public.member_interactions WHERE from_user_id='${to}' AND to_user_id='${from}'`), '50');
  // Retrying as a fresh REST transaction succeeds and retains the same bound.
  await sql(`BEGIN; SET LOCAL ROLE service_role; INSERT INTO public.member_interactions(from_user_id,to_user_id,type) VALUES('${to}','${from}','skip'); COMMIT;`);
  assert.equal(await sql(`SELECT count(*) FROM public.member_interactions WHERE from_user_id='${to}' AND to_user_id='${from}'`), '50');

  await Promise.all(Array.from({ length: 8 }, () => sql(`BEGIN; SET LOCAL ROLE service_role;
    INSERT INTO public.member_follows(user_id,target_user_id) VALUES('${from}','${third}') ON CONFLICT DO NOTHING;
    SELECT pg_sleep(0.02); COMMIT;`)));
  assert.equal(await sql(`SELECT count(*) FROM public.member_follows WHERE user_id='${from}' AND target_user_id='${third}'`), '1');
  assert.equal(await sql(`SELECT count(*) FROM public.member_interactions WHERE from_user_id='${from}' AND to_user_id='${third}' AND type='follow'`), '1', 'concurrent follow retries create exactly one event');
  assert.equal(await sql(`SELECT count(*) FROM (SELECT from_user_id,to_user_id FROM public.member_interactions GROUP BY 1,2 HAVING count(*)>50) excess`), '0');
});
