import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readdirSync} from 'node:fs';
import {createDatabase} from '../server/db.js';
import {createVisitStore} from '../server/visits-repository.js';

// Opt-in only: supply an EMPTY disposable local database named nodal_metrics_test_<suffix>. The test installs every migration itself.
// NODAL_METRICS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/nodal_metrics_test_run node --test tests/metrics-postgres.test.js
const databaseUrl=process.env.NODAL_METRICS_TEST_DATABASE_URL;
const migrationsDir=new URL('../supabase/migrations/',import.meta.url);
test('PostgreSQL visit counts: server-only table, atomic increments, summed totals',{skip:!databaseUrl,timeout:120000},async()=>{
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
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
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
});
