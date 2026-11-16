import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readdirSync} from 'node:fs';
import {createDatabase} from '../server/db.js';
import {createVisitStore} from '../server/visits-repository.js';
import {expectedMemberDays,loadPostgres,METRICS_TODAY} from './fixtures/metrics-fixture.js';

// Opt-in only: supply an EMPTY disposable local database named nodal_metrics_test_<suffix>. The test installs every migration itself.
// NODAL_METRICS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/nodal_metrics_test_run node --test tests/metrics-postgres.test.js
// One test, one empty database per run: R1's visit counts first, then R3's metrics functions and readings table.
const databaseUrl=process.env.NODAL_METRICS_TEST_DATABASE_URL;
const migrationsDir=new URL('../supabase/migrations/',import.meta.url);
test('PostgreSQL visit counts and metrics: server-only objects, atomic increments, summed totals, the fixture answered',{skip:!databaseUrl,timeout:120000},async()=>{
 const url=new URL(databaseUrl);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'only a local disposable PostgreSQL server is permitted');
 assert.match(url.pathname,/^\/nodal_metrics_test_[a-z0-9_]+$/);assert.equal(url.search,'');
 const execute=promisify(execFile),args=[databaseUrl,'-X','-qAt','-v','ON_ERROR_STOP=1'];
 const sql=async text=>(await execute('psql',[...args,'-c',text],{maxBuffer:1024*1024})).stdout.trim();
 assert.equal(await sql("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"),'0','only an empty disposable database is allowed');
 await sql(`DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
 END $$;
 CREATE SCHEMA auth; CREATE SCHEMA storage;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,created_at timestamptz NOT NULL DEFAULT now(),email_confirmed_at timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
 // Supabase's default privileges give the browser roles everything on a new table or function; the migration must take it back.
 await sql('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;');
 for(const file of readdirSync(migrationsDir).filter(f=>f.endsWith('.sql')).sort())await execute('psql',[...args,'-f',new URL(file,migrationsDir).pathname],{maxBuffer:1024*1024});

 assert.equal(await sql(`SELECT relrowsecurity FROM pg_class WHERE oid='public.visit_counts'::regclass`),'t');
 for(const role of ['anon','authenticated'])for(const p of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal(await sql(`SELECT has_table_privilege('${role}','public.visit_counts','${p}')`),'f',`${role} ${p}`);
 for(const [p,held] of [['SELECT','t'],['INSERT','t'],['UPDATE','t'],['DELETE','f'],['TRUNCATE','f']])assert.equal(await sql(`SELECT has_table_privilege('service_role','public.visit_counts','${p}')`),held,`service_role ${p}`);
 for(const [fn,volatility] of [['public.count_visit(jsonb)','v'],['public.visit_totals(jsonb)','s']]){
  assert.equal(await sql(`SELECT provolatile::text||':'||prosecdef::text FROM pg_proc WHERE oid='${fn}'::regprocedure`),`${volatility}:false`);
  assert.equal(await sql(`SELECT proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='${fn}'::regprocedure`),'t');
  for(const role of ['anon','authenticated'])assert.equal(await sql(`SELECT has_function_privilege('${role}','${fn}','EXECUTE')`),'f',`${role} ${fn}`);
  assert.equal(await sql(`SELECT has_function_privilege('service_role','${fn}','EXECUTE')`),'t');
 }
 await assert.rejects(sql(`SET ROLE anon; SELECT public.count_visit('{}');`),/permission denied for function count_visit/);
 await assert.rejects(sql(`SET ROLE authenticated; SELECT public.visit_totals('{}');`),/permission denied for function visit_totals/);

 const hit=`SET ROLE service_role; SELECT public.count_visit('{"day":"2026-11-14","page":"index.html","arrival":true,"source":"search"}');`;
 await Promise.all(Array.from({length:20},()=>sql(hit))); // 20 independent sessions
 assert.equal(await sql(`SELECT string_agg(kind||':'||source||':'||n,',' ORDER BY kind) FROM public.visit_counts`),'arrival:search:20,view::20');
 await sql(`SET ROLE service_role; SELECT public.count_visit('{"day":"2026-11-14","page":"fundadores.html","arrival":false,"source":""}');`);
 await sql(`SET ROLE service_role; SELECT public.count_visit('{"day":"2026-10-01","page":"index.html","arrival":true,"source":"qr"}');`);
 const expected={v:1,days:[['2026-10-01',1,1],['2026-11-14',21,20]],pages:{'index.html':20,'fundadores.html':1},sources:{search:20}};
 const answer=JSON.parse(await sql(`SET ROLE service_role; SELECT public.visit_totals('{"from":"2026-11-14","to":"2026-11-14"}');`));
 assert.deepEqual(answer,expected);

 // The twin: the local SQLite store, fed the same hits, answers the same.
 const db=createDatabase({filename:':memory:'});
 try{
  const local=createVisitStore({db}),base={day:'2026-11-14',page:'index.html',arrival:true,source:'search'};
  for(let i=0;i<20;i++)await local.count(base);
  await local.count({day:'2026-11-14',page:'fundadores.html',arrival:false,source:''});
  await local.count({day:'2026-10-01',page:'index.html',arrival:true,source:'qr'});
  assert.deepEqual(await local.totals('2026-11-14','2026-11-14'),answer);
 }finally{db.close();}

 await assert.rejects(sql(`SET ROLE service_role; DELETE FROM public.visit_counts;`),/permission denied/);
 await assert.rejects(sql(`SET ROLE service_role; INSERT INTO public.visit_counts VALUES('2026-11-14','click','index.html','',1);`),/check constraint/);
 // R3: the metrics functions and the readings table (supabase/migrations/20261114010000_metrics.sql).
 for(const [fn,definer] of [['public.metrics_account_days()','true'],['public.metrics_member_days(date)','false']]){
  assert.equal(await sql(`SELECT provolatile::text||':'||prosecdef::text FROM pg_proc WHERE oid='${fn}'::regprocedure`),`s:${definer}`);
  assert.equal(await sql(`SELECT proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='${fn}'::regprocedure`),'t');
  for(const role of ['anon','authenticated'])assert.equal(await sql(`SELECT has_function_privilege('${role}','${fn}','EXECUTE')`),'f',`${role} ${fn}`);
  assert.equal(await sql(`SELECT has_function_privilege('service_role','${fn}','EXECUTE')`),'t');
 }
 assert.equal(await sql(`SELECT relrowsecurity FROM pg_class WHERE oid='public.metrics_readings'::regclass`),'t');
 for(const role of ['anon','authenticated']){
  await assert.rejects(sql(`SET ROLE ${role}; SELECT public.metrics_account_days();`),/permission denied for function metrics_account_days/);
  await assert.rejects(sql(`SET ROLE ${role}; SELECT public.metrics_member_days('${METRICS_TODAY}');`),/permission denied for function metrics_member_days/);
  await assert.rejects(sql(`SET ROLE ${role}; SELECT * FROM public.metrics_readings;`),/permission denied for table metrics_readings/);
 }
 assert.deepEqual(JSON.parse(await sql('SET ROLE service_role; SELECT public.metrics_account_days();')),{v:1,days:[]});
 // Three accounts either side of 05:00:00Z: Lima days 13 and 14 November, confirmed counted on the day of creation.
 await sql(`INSERT INTO auth.users(id,email,created_at,email_confirmed_at) VALUES
  ('00000000-0000-4000-8999-000000000001','one@example.test','2026-11-14T04:59:59Z',NULL),
  ('00000000-0000-4000-8999-000000000002','two@example.test','2026-11-14T05:00:00Z','2026-11-14T06:00:00Z'),
  ('00000000-0000-4000-8999-000000000003','three@example.test','2026-11-14T05:00:01Z',NULL);`);
 assert.deepEqual(JSON.parse(await sql('SET ROLE service_role; SELECT public.metrics_account_days();')),{v:1,days:[['2026-11-13',1,0],['2026-11-14',2,1]]});

 // Readings: the server inserts and reads, never updates or deletes; one per day.
 const reading=`SET ROLE service_role; INSERT INTO public.metrics_readings(day,taken_at,defs,figures) VALUES('2026-11-14','2026-11-14T13:36:00Z',1,'{"signups.accounts":525}');`;
 await sql(reading);
 assert.equal(await sql(`SET ROLE service_role; SELECT day||' '||defs||' '||(figures->>'signups.accounts') FROM public.metrics_readings;`),'2026-11-14 1 525');
 await assert.rejects(sql(reading),/duplicate key value violates unique constraint "metrics_readings_pkey"/);
 await assert.rejects(sql(`SET ROLE service_role; UPDATE public.metrics_readings SET defs=2;`),/permission denied for table metrics_readings/);
 await assert.rejects(sql(`SET ROLE service_role; DELETE FROM public.metrics_readings;`),/permission denied for table metrics_readings/);
 await assert.rejects(sql(`SET ROLE service_role; INSERT INTO public.metrics_readings(day,taken_at,defs,figures) VALUES('2026-11-15',now(),1,'[]');`),/check constraint/);

 // twin equality: the fixture's rows, answered by the function the server calls, as the server.
 const {users}=await loadPostgres(sql);
 const memberDays=async()=>JSON.parse(await sql(`SET ROLE service_role; SELECT public.metrics_member_days('${METRICS_TODAY}');`));
 // As the baseline counts (docs/ops/2026-11-14-metrics-baseline.sql): a member is an account with a profiles row whose
 // role is not admin. The accounts made above have no profile; a skip by one of them, inside 7 days, is nobody's activity.
 const stray=n=>`00000000-0000-4000-8999-00000000000${n}`;
 await sql(`INSERT INTO public.member_interactions(from_user_id,to_user_id,type,created_at) VALUES('${stray(1)}','${users.get('m1')}','skip','2026-11-10T15:00:00Z');`);
 assert.deepEqual(await memberDays(),expectedMemberDays);
 // Its saved answers count where the baseline counts rows of onboarding_responses (interests, self-assessment and the
 // saves per day), and nowhere a profile is asked for.
 await sql(`INSERT INTO public.onboarding_responses(user_id,interests,raw_answers,created_at,updated_at)
  VALUES('${stray(2)}',ARRAY['datos']::text[],'{"assessed":true,"partC":{"bio":"Sin perfil","consent":true}}'::jsonb,'2026-09-21T15:00:00Z','2026-11-10T15:00:00Z');`);
 const withStray=structuredClone(expectedMemberDays);
 withStray.now.interests+=1;withStray.now.assessed+=1;
 withStray.days.profileSaves=[['2026-09-20',2],['2026-09-21',1],...expectedMemberDays.days.profileSaves.slice(1)];
 assert.deepEqual(await memberDays(),withStray);
});
