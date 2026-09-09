import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {readdir} from 'node:fs/promises';

// Opt-in only: supply an EMPTY disposable local database named
// nodal_course_quota_test_<suffix>. The test installs migrations and fixtures.
// NODAL_COURSE_QUOTA_TEST_DATABASE_URL=postgresql://.../nodal_course_quota_test_run
// node --test tests/courses-upload-quota-postgres.test.js
const databaseUrl=process.env.NODAL_COURSE_QUOTA_TEST_DATABASE_URL;
test('PostgreSQL quota serializes RPC and legacy INSERT at READ COMMITTED and REPEATABLE READ', {skip:!databaseUrl,timeout:120000},async()=>{
 const url=new URL(databaseUrl);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'only a local disposable PostgreSQL server is permitted');
 assert.match(url.pathname,/^\/nodal_course_quota_test_[a-z0-9_]+$/);
 assert.equal(url.search,'','connection parameters cannot override the local host');
 const execute=promisify(execFile),psql=process.env.NODAL_COURSE_QUOTA_TEST_PSQL||'psql';
 const args=[databaseUrl,'-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
 const sql=async text=>(await execute(psql,[...args,'-c',text],{maxBuffer:1024*1024})).stdout.trim();
 const apply=relative=>execute(psql,[...args,'-f',new URL(relative,import.meta.url).pathname],{maxBuffer:1024*1024});
 assert.equal(await sql("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"),'0','validation database must start empty');
 assert.equal(await sql('SHOW server_encoding'),'UTF8','Unicode fixtures require a UTF-8 database');
 await sql(`DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
 END $$;
 CREATE SCHEMA auth; CREATE SCHEMA storage;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
 const migrations=(await readdir(new URL('../supabase/migrations/',import.meta.url))).filter(file=>file.endsWith('.sql')&&(file<='20260908005245_course_post_owner_edit.sql'||file==='20260909005100_course_upload_quota.sql')).sort();
 for(const file of migrations)await apply('../supabase/migrations/'+file);
 for(const file of ['course-postgres-check.sql','course-post-owner-edit-check.sql','course-upload-quota-check.sql'])await apply('./fixtures/'+file);

 const waitFor=async query=>{
  const deadline=Date.now()+10000;
  do {const value=await sql(query);if(value)return value;await new Promise(resolve=>setTimeout(resolve,20));}while(Date.now()<deadline);
  assert.fail('quota race barrier was not reached');
 };
 let barrierKey=93210510;
 for(const repeatable of [false,true])for(const direct of [false,true])for(const material of [false,true]) {
  const [person,course,module]=Array.from({length:3},()=>randomUUID());
  // Cover both byte and file-count bounds across personal and shared quotas.
  const countBound=material&&direct,size=countBound?1:3145728,filled=countBound?99:9;
  const owner=material?'NULL':`'${person}'`,purpose=material?'material':'post';
  const label=`${repeatable?'RR':'RC'} ${direct?'INSERT':'RPC'} ${material?'material':'personal'} ${countBound?'count':'bytes'}`;
  await sql(`INSERT INTO auth.users VALUES('${person}','race@example.test');
   INSERT INTO profiles(id,email) VALUES('${person}','race@example.test');
   INSERT INTO pilot_courses(id,title,status,created_at,updated_at) VALUES('${course}','Race','published','2026-09-09','2026-09-09');
   INSERT INTO course_modules(id,course_id,title,position,status,created_at,updated_at) VALUES('${module}','${course}','Session',1,'published','2026-09-09','2026-09-09');
   INSERT INTO course_attachments(id,course_id,module_id,user_id,purpose,name,mime,size,storage_path,status,created_at)
   SELECT gen_random_uuid(),'${course}','${module}',${owner},'${purpose}','fixture','text/plain',${size},'fixture','pending','2026-09-09' FROM generate_series(1,${filled});`);
  const reserve=()=>{
   if(direct)return `INSERT INTO course_attachments(id,course_id,module_id,user_id,purpose,name,mime,size,storage_path,status,created_at) VALUES(gen_random_uuid(),'${course}','${module}',${owner},'${purpose}','fixture','text/plain',${size},'fixture','pending','2026-09-09');`;
   const item={id:randomUUID(),course_id:course,module_id:module,user_id:material?null:person,purpose,name:'fixture',mime:'text/plain',size,storage_path:'fixture',created_at:'2026-09-09'};
   return `SELECT id FROM reserve_course_attachment('${JSON.stringify(item)}'::jsonb);`;
  };
  const key=barrierKey++,locks=`pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND objid=${key}`;
  const holder=sql(`BEGIN; SELECT pg_advisory_xact_lock(${key}); SELECT pg_sleep(20); COMMIT;`).catch(error=>error);
  const pid=await waitFor(`SELECT pid FROM ${locks} AND granted`);
  // Both sessions establish snapshots before the barrier opens. Each releases
  // the artificial SESSION lock before INSERT, so it cannot serialize writes
  // for the implementation under test; only the real quota lock may do that.
  const write=()=>sql(`BEGIN${repeatable?' ISOLATION LEVEL REPEATABLE READ':''}; SET LOCAL ROLE service_role;
   SELECT count(*) FROM course_attachments WHERE course_id='${course}';
   SELECT pg_advisory_lock(${key}); SELECT pg_advisory_unlock(${key});
   ${reserve()} SELECT pg_sleep(0.1); COMMIT;`);
  const pending=Promise.allSettled([write(),write()]);
  try {await waitFor(`SELECT count(*) FROM ${locks} AND NOT granted HAVING count(*)=2`);}
  finally {await sql(`SELECT pg_cancel_backend(${Number(pid)})`);assert.match((await holder).stderr,/57014/);}
  const outcomes=await pending;
  assert.equal(outcomes.filter(outcome=>outcome.status==='fulfilled').length,1,label);
  assert.match(outcomes.find(outcome=>outcome.status==='rejected').reason.stderr,repeatable?/40001/:/PCA01/,label);
  assert.equal(await sql(`SELECT count(*)||':'||sum(size) FROM course_attachments WHERE course_id='${course}'`),`${filled+1}:${(filled+1)*size}`,label);
  // Owner lock bookkeeping must disappear with account erasure, too.
  await sql(`DELETE FROM course_attachments WHERE course_id='${course}'; DELETE FROM profiles WHERE id='${person}';`);
  assert.equal(await sql(`SELECT count(*) FROM nodal_private.course_upload_locks WHERE user_id='${person}'`),'0');
 }
});
