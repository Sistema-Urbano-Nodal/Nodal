import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// Opt-in: run against an empty disposable database, for example
//   createdb -h 127.0.0.1 nodal_fiiu_test_talk$$ && NODAL_FIIU_TALK_TEST_DATABASE_URL=postgresql://127.0.0.1/nodal_fiiu_test_talk$$ node --test tests/fiiu-talk-postgres.test.js; dropdb -h 127.0.0.1 nodal_fiiu_test_talk$$
const databaseUrl=process.env.NODAL_FIIU_TALK_TEST_DATABASE_URL;
const migrations=['20260928233515_fiiu_festival','20260929194059_fiiu_event_summary','20261001011759_fiiu_checkin','20261003013301_fiiu_confirmation_email','20261011120000_fiiu_conversations'];
test('PostgreSQL festival conversations keep revisions, counters and the upload allowance in triggers, stay server-only and survive account erasure',{skip:!databaseUrl,timeout:60000},async()=>{
 const url=new URL(databaseUrl);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
 assert.match(url.pathname,/^\/nodal_fiiu_test_[a-z0-9_]+$/);assert.equal(url.search,'');
 // Verbose errors carry the SQLSTATE, so the allowance is recognised by PFU01 rather than by its wording.
 const execute=promisify(execFile),args=[databaseUrl,'-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
 const sql=async text=>(await execute('psql',[...args,'-c',text])).stdout.trim();
 const as=(role,text)=>sql(`SET ROLE ${role}; ${text}`),service=text=>as('service_role',text);
 assert.equal(await sql("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"),'0','only an empty disposable database is allowed');
 // supabase_auth_admin stands in for GoTrue: it may delete a profile (reading the id its WHERE names) and nothing else,
 // so the erasure below succeeds only because the triggers it sets off run as their owner.
 await sql(`DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
 END $$; CREATE TABLE profiles(id uuid PRIMARY KEY); GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role,supabase_auth_admin;
 GRANT SELECT(id),DELETE ON profiles TO supabase_auth_admin;`);
 for(const name of migrations)await execute('psql',[...args,'-f',new URL(`../supabase/migrations/${name}.sql`,import.meta.url).pathname]);

 // Server-only: RLS on, the browser roles hold nothing on the tables or the functions, the server keeps its two RPCs.
 const tables=['public.fiiu_questions','public.fiiu_messages','public.fiiu_message_likes','public.fiiu_files','nodal_private.fiiu_upload_locks'];
 const list=items=>`array[${items.map(item=>`'${item}'`).join(',')}]`;
 assert.equal(await sql(`SELECT count(*) FROM unnest(${list(tables)}) t WHERE (SELECT relrowsecurity FROM pg_class WHERE oid=t::regclass)`),'5');
 assert.equal(await sql(`SELECT coalesce(string_agg(r||' '||p||' '||t,', '),'') FROM unnest(array['anon','authenticated']) r,unnest(${list(tables)}) t,
  unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE has_table_privilege(r,t,p)`),'','browser roles hold no table privilege');
 const triggers=['public.fiiu_message_sequence()','public.fiiu_like_count()','public.fiiu_question_revision()','public.erase_fiiu_messages_on_account_delete()','nodal_private.guard_fiiu_upload_quota()'];
 const rpcs=['public.reserve_fiiu_file(jsonb)','public.fiiu_question_stats(text)'];
 assert.equal(await sql(`SELECT coalesce(string_agg(r||' '||f,', '),'') FROM unnest(array['anon','authenticated']) r,unnest(${list([...triggers,...rpcs])}) f WHERE has_function_privilege(r,f,'EXECUTE')`),'','browser roles execute nothing');
 assert.equal(await sql(`SELECT bool_and(has_function_privilege('service_role',f,'EXECUTE')) FROM unnest(${list(rpcs)}) f`),'t');
 await assert.rejects(as('anon',`SELECT * FROM public.fiiu_messages;`),/permission denied for table fiiu_messages/);
 await assert.rejects(as('authenticated',`SELECT * FROM public.fiiu_question_stats('fiiu-2026');`),/permission denied for function fiiu_question_stats/);
 // Account deletion reaches the triggers as GoTrue's role, so they run as their owner with an empty search path.
 assert.equal(await sql(`SELECT string_agg(proname,',' ORDER BY proname) FROM pg_proc WHERE prosecdef AND proconfig=ARRAY['search_path=""'] AND oid IN (SELECT unnest(${list(triggers)})::regprocedure)`),
  'erase_fiiu_messages_on_account_delete,fiiu_like_count,fiiu_message_sequence,fiiu_question_revision');
 assert.equal(await sql(`SELECT has_table_privilege('supabase_auth_admin','public.fiiu_messages','UPDATE') OR has_table_privilege('supabase_auth_admin','public.fiiu_questions','UPDATE')`),'f');

 const [a,b,c,d]=['a','b','c','d'].map(x=>`${x.repeat(8)}-${x.repeat(4)}-4${x.repeat(3)}-8${x.repeat(3)}-${x.repeat(12)}`);
 const q='10000000-0000-4000-8000-000000000001',m=n=>`20000000-0000-4000-8000-00000000000${n}`;
 const question=field=>service(`SELECT ${field} FROM public.fiiu_questions WHERE id='${q}';`);
 const message=(n,field)=>service(`SELECT ${field} FROM public.fiiu_messages WHERE id='${m(n)}';`);
 const post=(n,user)=>service(`INSERT INTO public.fiiu_messages(id,question_id,user_id,author_name,author_full,body,client_id,created_at)
  VALUES('${m(n)}','${q}','${user}','Ana T.','Ana Test','hola ${n}','30000000-0000-4000-8000-00000000000${n}',now()) RETURNING seq;`);
 const like=(n,user)=>service(`INSERT INTO public.fiiu_message_likes VALUES('${m(n)}','${user}',now());`);
 const unlike=(n,user)=>service(`DELETE FROM public.fiiu_message_likes WHERE message_id='${m(n)}' AND user_id='${user}';`);
 await sql(`INSERT INTO profiles VALUES('${a}'),('${b}'),('${c}'),('${d}');`);
 await service(`INSERT INTO public.fiiu_questions(id,event_id,activity_id,talk,body,status,created_by,version,created_at,updated_at)
  VALUES('${q}','fiiu-2026','day1-am',NULL,'What do you take home?','open','${c}',1,now(),now());`);
 assert.equal(await question("revision||':'||message_count"),'0:0');
 await assert.rejects(service(`INSERT INTO public.fiiu_questions VALUES(gen_random_uuid(),'fiiu-2026','Day 1','x','y','open',0,0,NULL,1,now(),now());`),/check constraint/,'activity ids are catalogue slugs');

 // Every message write moves the question's revision and stamps the message with it.
 assert.equal(await post(1,a),'1');assert.equal(await post(2,b),'2');
 assert.equal(await question("revision||':'||message_count"),'2:2');
 await assert.rejects(service(`INSERT INTO public.fiiu_messages(id,question_id,user_id,author_name,author_full,body,client_id,created_at)
  VALUES(gen_random_uuid(),'${q}','${a}','Ana T.','Ana Test','again','30000000-0000-4000-8000-000000000001',now());`),/duplicate key/,'a client id is used once per person');

 // Likes count through the message, so they move the revision too; a duplicate is refused and changes nothing.
 await like(1,b);
 assert.equal(await message(1,"like_count||':'||seq"),'1:3');assert.equal(await question('revision'),'3');
 await assert.rejects(like(1,b),/duplicate key/);
 assert.equal(await message(1,'like_count'),'1');
 await unlike(1,b);
 assert.equal(await message(1,'like_count'),'0');assert.equal(await question('revision'),'4');

 // Hiding leaves the visible count and moves the revision; a write the trigger does not watch moves nothing.
 await service(`UPDATE public.fiiu_messages SET hidden_at=now(),hidden_by='${c}' WHERE id='${m(2)}';`);
 assert.equal(await question("revision||':'||message_count"),'5:1');assert.equal(await message(2,'seq'),'5');
 await service(`UPDATE public.fiiu_messages SET created_at=created_at,hidden_by=hidden_by WHERE id IN ('${m(1)}','${m(2)}');`);
 assert.equal(await question('revision'),'5');

 // Question edits: the text, the talk and the status move the revision; bookkeeping columns and same values do not.
 await service(`UPDATE public.fiiu_questions SET body='What will you take home?',version=version+1,updated_at=now() WHERE id='${q}';`);
 assert.equal(await question('revision'),'6');
 await service(`UPDATE public.fiiu_questions SET updated_at=now() WHERE id='${q}';`);
 await service(`UPDATE public.fiiu_questions SET body=body,talk=talk,status=status WHERE id='${q}';`);
 assert.equal(await question('revision'),'6');

 // A count that drifted to zero never goes negative when the like row goes.
 await like(1,b);await service(`UPDATE public.fiiu_messages SET like_count=0 WHERE id='${m(1)}';`);await unlike(1,b);
 assert.equal(await message(1,'like_count'),'0');assert.equal(await question('revision'),'8');

 // A hidden message that its author then deletes, and an organiser then unhides, is uncounted exactly once.
 assert.equal(await post(3,d),'9');assert.equal(await post(4,a),'10');assert.equal(await post(5,b),'11');
 assert.equal(await question('message_count'),'4');
 for(const change of ['hidden_at=now()','deleted_at=now()','hidden_at=NULL'])await service(`UPDATE public.fiiu_messages SET ${change} WHERE id='${m(5)}';`);
 assert.equal(await question("revision||':'||message_count"),'14:3');

 // Organiser totals cover visible messages only: m2 is hidden (its like came before), m5 is deleted.
 for(const [n,user] of [[1,b],[1,d],[3,a],[2,b]])await like(n,user);
 assert.equal(await service(`SELECT question_id||':'||people||':'||likes FROM public.fiiu_question_stats('fiiu-2026');`),`${q}:2:3`);
 assert.equal(await service(`SELECT count(*) FROM public.fiiu_question_stats('other-event');`),'0');

 // Upload allowance: 30 files or 30 MiB per person, pending reservations included. The RPC forces a pending,
 // unattached row whatever the caller sends.
 const reserve=(n,user,size)=>`SELECT status||':'||coalesce(message_id::text,'-') FROM public.reserve_fiiu_file(jsonb_build_object('id',md5('file-${n}')::uuid,
  'event_id','fiiu-2026','user_id','${user}','name','photo.jpg','mime','image/jpeg','size',${size},'storage_path','fiiu/${user}/'||md5('file-${n}'),
  'status','ready','message_id','${m(1)}','created_at',now()));`;
 assert.deepEqual((await service(Array.from({length:30},(_,i)=>reserve(i+1,a,1000)).join('\n'))).split('\n'),Array(30).fill('pending:-'));
 await assert.rejects(service(reserve(31,a,1000)),/PFU01/);
 await service(Array.from({length:10},(_,i)=>reserve(41+i,b,3145728)).join('\n'));
 await assert.rejects(service(reserve(51,b,1)),/PFU01/,'31,457,281 bytes in total is over');
 assert.equal(await service(`SELECT count(*)||':'||sum(size) FROM public.fiiu_files WHERE user_id='${b}';`),'10:31457280');
 await service(reserve(61,d,500));
 assert.equal(await service(`SELECT count(*) FROM nodal_private.fiiu_upload_locks;`),'3');

 // Erasure: a tracked file blocks the account until the application removes it; then GoTrue's deletion blanks the
 // person's messages, clears the author, drops their likes and keeps the conversation's shape.
 const erase=ids=>as('supabase_auth_admin',`DELETE FROM profiles WHERE id IN (${ids.map(id=>`'${id}'`).join(',')});`);
 const before=Number(await question('revision'));
 await assert.rejects(erase([d]),/violates foreign key constraint[\s\S]*fiiu_files/);
 assert.equal(await message(3,'body'),'hola 3','a refused deletion changes nothing');
 await service(`DELETE FROM public.fiiu_files WHERE user_id='${d}';`);
 await erase([c,d]);
 assert.equal(await message(3,"body||'|'||author_name||'|'||author_full||'|'||(deleted_at IS NOT NULL)||'|'||coalesce(user_id::text,'null')||'|'||like_count"),'|||true|null|1');
 assert.equal(await service(`SELECT count(*) FROM public.fiiu_message_likes WHERE user_id IN ('${c}','${d}');`),'0');
 assert.equal(await message(1,'like_count'),'1','the erased like is uncounted');
 assert.equal(await question("message_count||':'||coalesce(created_by::text,'null')"),'2:null');
 assert.equal(await message(2,"(hidden_at IS NOT NULL)||':'||coalesce(hidden_by::text,'null')"),'true:null','a hidden message stays hidden after its moderator leaves');
 assert.equal(Number(await question('revision')),before+3,'the blanking, the cleared author and the removed like each move the revision');
 assert.equal(await service(`SELECT count(*) FROM nodal_private.fiiu_upload_locks;`),'2');
 assert.equal(await service(`SELECT people||':'||likes FROM public.fiiu_question_stats('fiiu-2026');`),'1:1');
});
