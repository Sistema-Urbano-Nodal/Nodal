import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {setTimeout as wait} from 'node:timers/promises';
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
 await sql(`ALTER TABLE profiles ADD COLUMN account_status text NOT NULL DEFAULT 'active';
   CREATE TABLE catalog_items(id uuid PRIMARY KEY,kind text,status text,visibility text,featured boolean,translations jsonb,organization text DEFAULT '');
   CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);`);
 await execute('psql',[...args,'-f',new URL('20261122010000_news_email_alerts.sql',migrations).pathname]);
 await execute('psql',[...args,'-f',new URL('20261123235000_publication_email_credits.sql',migrations).pathname]);
 await execute('psql',[...args,'-f',new URL('20261123235500_publication_covers.sql',migrations).pathname]);
 for(const role of ['anon','authenticated']){
  await assert.rejects(sql(`SET ROLE ${role}; SELECT * FROM public.claim_news_email();`),/permission denied/);
  await assert.rejects(sql(`SET ROLE ${role}; SELECT * FROM public.claim_publication_email();`),/permission denied/);
  await assert.rejects(sql(`SET ROLE ${role}; SELECT * FROM public.claim_publication_email_with_cover();`),/permission denied/);
  await assert.rejects(sql(`SET ROLE ${role}; SELECT public.subscribe_news_email(gen_random_uuid(),'es');`),/permission denied/);
  await assert.rejects(sql(`SET ROLE ${role}; SELECT * FROM public.news_email_preferences;`),/permission denied/);
 }
 const revision='ab'.repeat(32), coverFields=`cover_revision='${revision}',cover_alt='Capa',cover_jpeg=decode('ffd8ffd9','hex')`;
 await assert.rejects(sql(`UPDATE nodal_news SET cover_jpeg=decode('ff','hex') WHERE id='${item}';`),/check constraint/);
 const sub=crypto.randomUUID(),guest=crypto.randomUUID(),news=crypto.randomUUID();
 await sql(`INSERT INTO profiles(id) VALUES('${sub}'),('${guest}');
   INSERT INTO auth.users VALUES('${sub}','test@example.test',now()),('${guest}','guest@example.test',NULL);
   SET ROLE service_role; INSERT INTO public.news_email_preferences(user_id,language) VALUES('${sub}','pt'),('${guest}','es');`);
 // No backfill of the seven older posts. Republishing does not insert a second row.
 assert.equal(await sql('SELECT count(*) FROM public.news_email_outbox'),'0');
 await sql(`SET ROLE service_role; INSERT INTO nodal_news(id,title,body,url,status,pinned,created_at,updated_at,version)
   VALUES('${news}','News','','','draft',false,now(),now(),1);
   UPDATE nodal_news SET status='published',published_at=now() WHERE id='${news}';
   UPDATE nodal_news SET status='draft' WHERE id='${news}';
   UPDATE nodal_news SET status='published' WHERE id='${news}';`);
 assert.equal(await sql('SELECT count(*) FROM public.news_email_outbox'),'2');
 const claim=()=>sql('SET ROLE service_role; SELECT email,language,attempts FROM public.claim_publication_email();');
 await sql(`UPDATE nodal_news SET ${coverFields},body='Updated news text',public_byline='Redacción NODAL' WHERE id='${news}';`);
 const claimCredit=()=>sql('SET ROLE service_role; SELECT email,language,attempts,excerpt,byline,organization,cover_url,cover_alt FROM public.claim_publication_email_with_cover();');
 assert.deepEqual((await Promise.all([claimCredit(),claimCredit()])).sort(),['',`test@example.test|pt|1|Updated news text|Redacción NODAL||/api/publication-covers/news/${news}/${revision}.jpg|Capa`]);
 const exported=JSON.parse(await sql(`SET ROLE service_role; SELECT public.export_news_email('${sub}');`));
 assert.equal(exported.subscription.language,'pt');assert.deepEqual(exported.deliveries,[{news_id:news,catalog_id:null,status:'sending',attempts:1}]);
 await sql(`SET ROLE service_role; DELETE FROM public.news_email_preferences WHERE user_id='${sub}';`);
 assert.equal(await sql(`SELECT count(*) FROM public.news_email_outbox WHERE user_id='${sub}'`),'0');
 const opportunity=crypto.randomUUID(),resource=crypto.randomUUID();
 await sql(`INSERT INTO public.news_email_preferences(user_id,language) VALUES('${sub}','pt');
   SET ROLE service_role; INSERT INTO catalog_items (id,kind,status,visibility,featured,translations) VALUES
    ('${resource}','resource','published','public',true,'{"pt":{"title":"Guia"}}'),
    ('${opportunity}','opportunity','published','members',true,'{"pt":{"title":"Vaga"}}');`);
 assert.equal(await claim(),'');
 await sql(`SET ROLE service_role; UPDATE catalog_items SET visibility='public' WHERE id='${opportunity}';
  UPDATE catalog_items SET featured=false WHERE id='${opportunity}';`);
 assert.equal(await claim(),'');
 await sql(`SET ROLE service_role; UPDATE catalog_items SET ${coverFields},featured=true,organization='Escola',translations='{"pt":{"title":"Vaga","summary":"Resumo para leitores","body":"Longo"},"es":{"summary":"Otro texto"}}'
   WHERE id='${opportunity}';`);
 assert.equal(await sql(`SET ROLE service_role; SELECT catalog_id,title,excerpt,byline,organization,cover_url,cover_alt FROM public.claim_publication_email_with_cover();`),`${opportunity}|Vaga|Resumo para leitores||Escola|/api/publication-covers/opportunity/${opportunity}/${revision}.jpg|Capa`);
 assert.equal(await sql(`SELECT count(*) FROM news_email_events WHERE catalog_id='${resource}'`),'0');
 assert.equal(await claim(),'');
 const qa=crypto.randomUUID(),draft=crypto.randomUUID(),wrongDraft=crypto.randomUUID(),publicNews=crypto.randomUUID();
 const testId='test:'+qa+':'+draft,invalidId='test:'+qa+':wrong';
 await sql(`INSERT INTO profiles(id) VALUES('${qa}'); INSERT INTO auth.users VALUES('${qa}','qa@example.test',now());
   SET ROLE service_role; INSERT INTO news_email_preferences(user_id,notice_version) VALUES('${qa}','qa:one-message');`);
 await insert(draft,{createdBy:'NULL'});await insert(wrongDraft,{createdBy:'NULL'});
 await sql(`SET ROLE service_role; INSERT INTO news_email_events(event_id,news_id)
     VALUES('${testId}','${draft}'),('${invalidId}','${wrongDraft}');`);
 assert.equal(await sql("SELECT count(*) FROM news_email_outbox WHERE event_id LIKE 'test:%'"),'0');
 await sql(`SET ROLE service_role; INSERT INTO news_email_outbox(event_id,user_id)
   VALUES('${testId}','${sub}'),('${invalidId}','${qa}');`);
 assert.equal(await claim(),'','a different subscriber and malformed private id are ineligible');
 await sql(`SET ROLE service_role; INSERT INTO news_email_outbox(event_id,user_id) VALUES('${testId}','${qa}');`);
 await sql(`UPDATE nodal_news SET ${coverFields} WHERE id='${draft}';`);
 assert.equal(await sql('SET ROLE service_role; SELECT email,language,attempts,cover_url,cover_alt FROM public.claim_publication_email_with_cover();'),'qa@example.test|es|1||');
 await insert(publicNews,{status:"'published'",publishedAt:'now()',createdBy:'NULL'});
 assert.equal(await sql(`SELECT count(*) FROM news_email_outbox WHERE event_id='n:${publicNews}' AND user_id='${qa}';`),'0');
 const exportedQa=JSON.parse(await sql(`SET ROLE service_role; SELECT public.export_news_email('${qa}');`));
 assert.equal(exportedQa.subscription,null);
 await sql(`SET ROLE service_role; SELECT public.subscribe_news_email('${qa}','en');`);
 assert.equal(await sql(`SELECT language,notice_version FROM news_email_preferences WHERE user_id='${qa}';`),'en|news-v1');

 // Hold an unsubscribe until the publishing transaction is waiting on that exact row.
 // Releasing it must let publication finish while omitting the withdrawn recipient.
 const locker=spawn('psql',args,{stdio:['pipe','pipe','pipe']});
 const lines=createInterface({input:locker.stdout})[Symbol.asyncIterator]();
 const raceNews=crypto.randomUUID(),app='news_unsubscribe_race';
 let published;
 try {
   locker.stdin.write(`BEGIN; SET ROLE service_role; DELETE FROM news_email_preferences WHERE user_id='${sub}'; SELECT 'locked';
`);
   assert.equal((await lines.next()).value,'locked');
   published=sql(`SET application_name='${app}'; SET ROLE service_role;
     INSERT INTO nodal_news(${columns}) VALUES(${values(raceNews,{status:"'published'",publishedAt:'now()',createdBy:'NULL'})});`);
   published.catch(()=>{}); // A rejection is reported below after releasing the row lock.
   let waiting=false;
   for(let i=0;i<100&&!waiting;i++){
     waiting=await sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${app}' AND wait_event_type='Lock');`)==='t';
     if(!waiting)await wait(20);
   }
   assert.ok(waiting,'publication encountered the concurrent unsubscribe');
 } finally {locker.stdin.end('COMMIT;\n');}
 await published;
 assert.equal(await sql(`SELECT count(*) FROM news_email_outbox WHERE event_id='n:${raceNews}' AND user_id='${sub}';`),'0');
 assert.equal(await sql(`SELECT count(*) FROM news_email_outbox WHERE event_id='n:${raceNews}' AND user_id='${qa}';`),'1');

});
