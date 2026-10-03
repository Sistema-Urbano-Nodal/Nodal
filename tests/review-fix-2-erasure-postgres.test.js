import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readdirSync, readFileSync} from 'node:fs';

const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const migrations = readdirSync(migrationsDir).filter(file => file.endsWith('.sql')).sort();
const FIX = '20261003201144_course_posts_revision_definer.sql';

/* GoTrue deletes auth.users as supabase_auth_admin. The profile cascade sets
   course_posts.user_id to NULL, and Postgres fires the AFTER trigger that
   change queues as the deleting role, which has no grant on public tables. A
   trigger that writes another table must therefore run as its owner. */
test('the course post revision trigger runs as its owner, so Auth can erase an account that has posted', () => {
  const statements = migrations.flatMap(file => readFileSync(new URL(file, migrationsDir), 'utf8')
    .replace(/--[^\n]*/g, '').split(';').map(sql => ({file, sql: sql.replace(/\s+/g, ' ').trim()})));
  const created = statements.findIndex(({sql}) => /CREATE (OR REPLACE )?FUNCTION public\.course_posts_revision\(\)/i.test(sql));
  assert.ok(created >= 0, 'the trigger function exists');
  const later = statements.slice(created);
  // The latest statement that defines or alters the function decides its security.
  const definer = later.filter(({sql}) => /FUNCTION public\.course_posts_revision\(\)/i.test(sql) && /SECURITY (DEFINER|INVOKER)/i.test(sql)).at(-1);
  assert.ok(definer, 'a migration sets the security of course_posts_revision()');
  assert.match(definer.sql, /SECURITY DEFINER/i);
  const path = later.filter(({sql}) => /FUNCTION public\.course_posts_revision\(\)/i.test(sql) && /search_path/i.test(sql)).at(-1);
  assert.match(path.sql, /SET search_path\s*=\s*''/i, 'a definer function pins an empty search path');
  assert.ok(later.some(({sql}) => /REVOKE ALL ON FUNCTION public\.course_posts_revision\(\) FROM PUBLIC/i.test(sql)));
  assert.ok(migrations.includes(FIX));
  // Every table the body touches is schema-qualified, so the empty path cannot break it.
  const source = readFileSync(new URL(statements[created].file, migrationsDir), 'utf8');
  const body = source.match(/FUNCTION public\.course_posts_revision\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$/i)[1];
  const tables = [...body.matchAll(/\b(?:UPDATE|FROM|INTO|JOIN)\s+([a-z_."]+)/gi)].map(match => match[1]);
  assert.ok(tables.length >= 2);
  for (const table of tables) assert.match(table, /^public\./, table);
});

// Opt-in only: supply an EMPTY disposable local database named
// nodal_erasure_test_<suffix>. The test installs every migration itself.
// NODAL_ERASURE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/nodal_erasure_test_run
// node --test tests/review-fix-2-erasure-postgres.test.js
const databaseUrl = process.env.NODAL_ERASURE_TEST_DATABASE_URL;
test('Auth deletes a member who posted in a course once the revision trigger runs as its owner', {skip: !databaseUrl, timeout: 120000}, async () => {
  const url = new URL(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'only a local disposable PostgreSQL server is permitted');
  assert.match(url.pathname, /^\/nodal_erasure_test_[a-z0-9_]+$/);
  assert.equal(url.search, '', 'connection parameters cannot override the local host');
  const execute = promisify(execFile), psql = process.env.NODAL_ERASURE_TEST_PSQL || 'psql';
  const args = [databaseUrl, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
  const sql = async text => (await execute(psql, [...args, '-c', text], {maxBuffer: 1024 * 1024})).stdout.trim();
  const apply = file => execute(psql, [...args, '-f', new URL(file, migrationsDir).pathname], {maxBuffer: 1024 * 1024});
  assert.equal(await sql("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"), '0', 'validation database must start empty');
  await sql(`DO $$ BEGIN
   IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
   IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
   IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
   -- Stands in for supabase_auth_admin: it may delete Auth users and holds no grant on public tables.
   IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='nodal_test_auth_admin') THEN CREATE ROLE nodal_test_auth_admin NOLOGIN; END IF;
  END $$;
  CREATE SCHEMA auth; CREATE SCHEMA storage;
  CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
  CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
  GRANT USAGE ON SCHEMA auth TO nodal_test_auth_admin; GRANT SELECT,DELETE ON auth.users TO nodal_test_auth_admin;`);
  for (const file of migrations.filter(file => file < FIX)) await apply(file);

  const poster = '11111111-1111-4111-8111-111111111111', course = '33333333-3333-4333-8333-333333333333', module = '44444444-4444-4444-8444-444444444444';
  await sql(`INSERT INTO auth.users VALUES('${poster}','poster@example.test');
   INSERT INTO public.profiles(id,email) VALUES('${poster}','poster@example.test');
   INSERT INTO public.pilot_courses(id,title,status,created_at,updated_at) VALUES('${course}','Course','published','2026-09-09','2026-09-09');
   INSERT INTO public.course_modules(id,course_id,title,position,status,created_at,updated_at) VALUES('${module}','${course}','Session',1,'published','2026-09-09','2026-09-09');
   INSERT INTO public.course_posts(id,course_id,module_id,user_id,author_name,client_id,kind,body,created_at)
   VALUES(gen_random_uuid(),'${course}','${module}','${poster}','Poster',gen_random_uuid(),'question','Hello','2026-09-09');`);
  const erase = `SET ROLE nodal_test_auth_admin; DELETE FROM auth.users WHERE id='${poster}'; RESET ROLE;`;

  await assert.rejects(sql(erase), error => /permission denied for table course_modules/.test(error.stderr), 'before the fix, the deletion fails');
  assert.equal(await sql(`SELECT count(*) FROM auth.users WHERE id='${poster}'`), '1', 'and nothing is deleted');

  await apply(FIX);
  await apply(FIX); // idempotent: it is applied by hand with `supabase db query --linked -f`
  const before = await sql(`SELECT posts_revision FROM public.course_modules WHERE id='${module}'`);
  await sql(erase);
  assert.equal(await sql(`SELECT count(*) FROM auth.users WHERE id='${poster}'`), '0');
  assert.equal(await sql(`SELECT count(*) FROM public.profiles WHERE id='${poster}'`), '0');
  assert.equal(await sql(`SELECT count(*)||':'||count(*) FILTER (WHERE body='' AND author_name='' AND deleted_at IS NOT NULL) FROM public.course_posts WHERE user_id IS NULL`), '1:1', 'the post stays as an anonymous tombstone');
  assert.ok(Number(await sql(`SELECT posts_revision FROM public.course_modules WHERE id='${module}'`)) > Number(before), 'the module cache still invalidates');
  // The function is still unreachable for API roles.
  assert.equal(await sql(`SELECT has_function_privilege('authenticated','public.course_posts_revision()','EXECUTE')::text||has_function_privilege('anon','public.course_posts_revision()','EXECUTE')::text`), 'falsefalse');
});
