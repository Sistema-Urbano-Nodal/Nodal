import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

/* Runs only against an empty disposable local database (NODAL_MEMBERSHIP_TEST_DATABASE_URL, e.g.
   postgres://127.0.0.1:54329/nodal_membership_test_1), like the FIIU PostgreSQL checks. */
const databaseUrl=process.env.NODAL_MEMBERSHIP_TEST_DATABASE_URL;
test('PostgreSQL keeps Nodal Fundadores acceptances server-only, insert-only for the server, and past the profile they name',{skip:!databaseUrl,timeout:30000},async()=>{
 const url=new URL(databaseUrl);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
 assert.match(url.pathname,/^\/nodal_membership_test_[a-z0-9_]+$/);assert.equal(url.search,'');
 const execute=promisify(execFile),args=[databaseUrl,'-X','-qAt','-v','ON_ERROR_STOP=1'];
 const sql=async text=>(await execute('psql',[...args,'-c',text])).stdout.trim();
 assert.equal(await sql("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"),'0','only an empty disposable database is allowed');
 await sql(`DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
 END $$; CREATE TABLE profiles(id uuid PRIMARY KEY); GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;`);
 // Supabase's default privileges give the browser roles everything on a new table; the migration must take it back.
 await sql('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;');
 await execute('psql',[...args,'-f',new URL('../supabase/migrations/20261021000000_membership_acceptances.sql',import.meta.url).pathname]);
 assert.equal(await sql(`SELECT relrowsecurity FROM pg_class WHERE oid='public.membership_acceptances'::regclass`),'t');
 for(const role of ['anon','authenticated'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal(await sql(`SELECT has_table_privilege('${role}','public.membership_acceptances','${privilege}')`),'f',`${role} ${privilege}`);
 for(const [privilege,held] of [['SELECT','t'],['INSERT','t'],['UPDATE','f'],['DELETE','f'],['TRUNCATE','f']])assert.equal(await sql(`SELECT has_table_privilege('service_role','public.membership_acceptances','${privilege}')`),held,`service_role ${privilege}`);
 const person='11111111-1111-4111-8111-111111111111',acceptance='22222222-2222-4222-8222-222222222222';
 await sql(`INSERT INTO profiles VALUES('${person}'); SET ROLE service_role;
 INSERT INTO public.membership_acceptances(id,user_id,email,full_name,option,terms_version,amount_text,authorizations,accepted_at)
 VALUES('${acceptance}','${person}','ana@example.test','Ana Fundadora','installments','FUNDADORES-2027-v1','2 × S/ 275 (S/ 550)','{"terms":true,"payment":true,"renewal":true}','2026-10-21T15:00:00Z');`);
 const insert=(option,authorizations,email)=>sql(`SET ROLE service_role; INSERT INTO public.membership_acceptances(id,email,full_name,option,terms_version,amount_text,authorizations,accepted_at)
  VALUES(gen_random_uuid(),${email},'B',${option},'FUNDADORES-2027-v1','S/ 499',${authorizations},now());`);
 await assert.rejects(insert("'yearly'","'{}'","'b@example.test'"),/check constraint/,'an unknown option');
 await assert.rejects(insert("'once'","'[true]'","'b@example.test'"),/check constraint/,'authorizations that are not an object');
 await assert.rejects(insert("'once'","'{}'",'NULL'),/null value/,'no email');
 // The record is never rewritten or removed by the server.
 await assert.rejects(sql(`SET ROLE service_role; UPDATE public.membership_acceptances SET email='x@example.test';`),/permission denied/);
 await assert.rejects(sql(`SET ROLE service_role; DELETE FROM public.membership_acceptances;`),/permission denied/);
 // Erasing the profile (GoTrue's cascade, as its owner) keeps the evidence and only forgets whose it was.
 await sql(`DELETE FROM profiles WHERE id='${person}';`);
 assert.equal(await sql(`SET ROLE service_role; SELECT coalesce(user_id::text,'-')||'|'||email||'|'||full_name||'|'||amount_text FROM public.membership_acceptances;`),'-|ana@example.test|Ana Fundadora|2 × S/ 275 (S/ 550)');
 assert.equal(await sql(`SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='membership_acceptances' AND indexname IN ('membership_acceptances_user','membership_acceptances_accepted')`),'2');
});
