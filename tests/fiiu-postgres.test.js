import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const databaseUrl=process.env.NODAL_FIIU_TEST_DATABASE_URL;
test('PostgreSQL festival migration enforces private access, conditional writes and account erasure',{skip:!databaseUrl,timeout:30000},async()=>{
 const url=new URL(databaseUrl);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
 assert.match(url.pathname,/^\/nodal_fiiu_test_[a-z0-9_]+$/);assert.equal(url.search,'');
 const execute=promisify(execFile),args=[databaseUrl,'-X','-qAt','-v','ON_ERROR_STOP=1'];
 const sql=async text=>(await execute('psql',[...args,'-c',text])).stdout.trim();
 assert.equal(await sql("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"),'0','only an empty disposable database is allowed');
 await sql(`DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
 END $$; CREATE TABLE profiles(id uuid PRIMARY KEY); GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
 await execute('psql',[...args,'-f',new URL('../supabase/migrations/20260928233515_fiiu_festival.sql',import.meta.url).pathname]);
 for(const name of ['registrations','attendance','config','content']){
  assert.equal(await sql(`SELECT relrowsecurity FROM pg_class WHERE oid='fiiu_${name}'::regclass`),'t');
  for(const role of ['anon','authenticated'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal(await sql(`SELECT has_table_privilege('${role}','fiiu_${name}','${privilege}')`),'f');
 }
 const person='11111111-1111-4111-8111-111111111111',reg='22222222-2222-4222-8222-222222222222';
 await sql(`INSERT INTO profiles VALUES('${person}'); SET ROLE service_role;
 INSERT INTO fiiu_registrations VALUES('${reg}','fiiu-2026','${person}','fixture@example.test','{}','none',1,now(),now());`);
 const update=()=>sql(`SET ROLE service_role; UPDATE fiiu_registrations SET version=version+1 WHERE id='${reg}' AND version=1 RETURNING version;`);
 const results=await Promise.all([update(),update()]);assert.deepEqual(results.sort(),['','2']);
 assert.equal(await sql(`SET ROLE service_role; DELETE FROM fiiu_registrations WHERE id='${reg}' AND version=1 RETURNING id;`),'');
 await assert.rejects(sql(`SET ROLE authenticated; SELECT * FROM fiiu_registrations;`),/permission denied/);
 await assert.rejects(sql(`SET ROLE service_role; INSERT INTO fiiu_registrations VALUES(gen_random_uuid(),'fiiu-2026','${person}','fixture@example.test','{}','none',1,now(),now());`),/duplicate key/);
 await assert.rejects(sql(`SET ROLE service_role; UPDATE fiiu_registrations SET answers='[]' WHERE id='${reg}';`),/check constraint/);
 await sql(`SET ROLE service_role; INSERT INTO fiiu_attendance VALUES(gen_random_uuid(),'${reg}','day1-am','${person}',now());`);
 await sql(`DELETE FROM profiles WHERE id='${person}';`);
 assert.equal(await sql('SELECT count(*) FROM fiiu_registrations'),'0');assert.equal(await sql('SELECT count(*) FROM fiiu_attendance'),'0');
});
