import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readdirSync} from 'node:fs';

// NODAL_NEWS_TEST_DATABASE_URL=postgresql://127.0.0.1:<port>/nodal_news_test_<run> pointing to an EMPTY disposable database.
const databaseUrl=process.env.NODAL_NEWS_TEST_DATABASE_URL;
const migrations=new URL('../supabase/migrations/',import.meta.url);
test('PostgreSQL news migration enforces private access, the publication rules, conditional writes and author erasure',{skip:!databaseUrl,timeout:30000},async()=>{
 const url=new URL(databaseUrl);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
 assert.match(url.pathname,/^\/nodal_news_test_[a-z0-9_]+$/);assert.equal(url.search,'');
 const execute=promisify(execFile),args=[databaseUrl,'-X','-qAt','-v','ON_ERROR_STOP=1'];
 const sql=async text=>(await execute('psql',[...args,'-c',text])).stdout.trim();
 assert.equal(await sql("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"),'0','only an empty disposable database is allowed');
 // Supabase grants every new public table to its API roles by default; the migration must take that back.
 await sql(`DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
 END $$; CREATE TABLE profiles(id uuid PRIMARY KEY); GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;`);
 await execute('psql',[...args,'-f',new URL(readdirSync(migrations).find(name=>name.endsWith('_nodal_news.sql')),migrations).pathname]);
 assert.equal(await sql("SELECT relrowsecurity FROM pg_class WHERE oid='nodal_news'::regclass"),'t');
 const can=(role,privilege)=>sql(`SELECT has_table_privilege('${role}','nodal_news','${privilege}')`);
 for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']){
  for(const role of ['anon','authenticated'])assert.equal(await can(role,privilege),'f',`${role} ${privilege}`);
  assert.equal(await can('service_role',privilege),['SELECT','INSERT','UPDATE','DELETE'].includes(privilege)?'t':'f',`service_role ${privilege}`);
 }
 for(const role of ['anon','authenticated'])await assert.rejects(sql(`SET ROLE ${role}; SELECT * FROM nodal_news;`),/permission denied/);
 const author='11111111-1111-4111-8111-111111111111',item='22222222-2222-4222-8222-222222222222';
 await sql(`INSERT INTO profiles VALUES('${author}');`);
 const columns='id,title,body,url,status,pinned,published_at,created_at,updated_at,created_by,version';
 const values=(id,{title="'News'",body="''",url="''",status="'draft'",pinned='false',publishedAt='NULL',createdBy=`'${author}'`,version=1}={})=>`'${id}',${title},${body},${url},${status},${pinned},${publishedAt},now(),now(),${createdBy},${version}`;
 const insert=(id,fields)=>sql(`SET ROLE service_role; INSERT INTO nodal_news(${columns}) VALUES(${values(id,fields)});`);
 await insert(item,{title:`repeat('t',160)`,body:`repeat('b',2000)`,url:`'https://example.test/'||repeat('x',479)`});
 for(const bad of [{title:"''"},{title:`repeat('t',161)`},{body:`repeat('b',2001)`},{url:"'http://example.test/'"},{url:`'https://example.test/'||repeat('x',480)`},{status:"'archived'"},{status:"'published'"},{version:0}])
  await assert.rejects(insert(crypto.randomUUID(),bad),/check constraint/,JSON.stringify(bad));
 await assert.rejects(insert(item),/duplicate key/);
 await assert.rejects(insert(crypto.randomUUID(),{createdBy:`'${crypto.randomUUID()}'`}),/foreign key/);
 // The store's conditional edit: two editors holding version 1 race, exactly one wins.
 const update=title=>sql(`SET ROLE service_role; UPDATE nodal_news SET title='${title}',version=version+1 WHERE id='${item}' AND version=1 RETURNING version;`);
 assert.deepEqual((await Promise.all([update('A'),update('B')])).sort(),['','2']);
 assert.equal(await sql(`SET ROLE service_role; DELETE FROM nodal_news WHERE id='${crypto.randomUUID()}' RETURNING id;`),'');
 // The feed order the API relies on: pinned first, newest publication next, id as the tie-break.
 const at=day=>`'2026-10-${day}T12:00:00Z'`,ids={};
 for(const [name,pinned,day] of [['pinnedOld',true,'01'],['pinnedNew',true,'05'],['newest',false,'09'],['tieLow',false,'08'],['tieHigh',false,'08'],['oldest',false,'02']]){
  ids[name]=name==='tieLow'?'30000000-0000-4000-8000-000000000000':name==='tieHigh'?'40000000-0000-4000-8000-000000000000':crypto.randomUUID();
  await insert(ids[name],{status:"'published'",pinned:String(pinned),publishedAt:at(day)});
 }
 const feed=async(where='')=>(await sql(`SET ROLE service_role; SELECT id FROM nodal_news WHERE status='published'${where} ORDER BY pinned DESC,published_at DESC,id DESC;`)).split('\n').filter(Boolean);
 assert.deepEqual(await feed(),[ids.pinnedNew,ids.pinnedOld,ids.newest,ids.tieHigh,ids.tieLow,ids.oldest]);
 // The PostgREST keyset after a pinned row, as server/news-repository.js writes it, still reaches the unpinned items.
 assert.deepEqual(await feed(` AND (pinned=false OR (pinned=true AND published_at<${at('05')}) OR (pinned=true AND published_at=${at('05')} AND id<'${ids.pinnedNew}'))`),[ids.pinnedOld,ids.newest,ids.tieHigh,ids.tieLow,ids.oldest]);
 assert.deepEqual(await feed(` AND pinned=false AND (published_at<${at('08')} OR (published_at=${at('08')} AND id<'${ids.tieHigh}'))`),[ids.tieLow,ids.oldest]);
 assert.match(await sql("SELECT indexdef FROM pg_indexes WHERE indexname='nodal_news_public'"),/\(status, pinned DESC, published_at DESC, id DESC\)$/);
 assert.match(await sql(`SET enable_seqscan=off; EXPLAIN SELECT id FROM nodal_news WHERE status='published' ORDER BY pinned DESC,published_at DESC,id DESC LIMIT 11;`),/nodal_news_public/);
 // Erasing the author keeps the news and drops only the link.
 await sql(`DELETE FROM profiles WHERE id='${author}';`);
 assert.equal(await sql('SELECT count(*) FROM nodal_news WHERE created_by IS NOT NULL'),'0');
 assert.equal(await sql('SELECT count(*) FROM nodal_news'),'7');
});
