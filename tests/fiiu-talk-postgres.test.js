import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// Opt-in: run against an empty disposable database, for example
//   createdb -h 127.0.0.1 nodal_fiiu_test_talk$$ && NODAL_FIIU_TALK_TEST_DATABASE_URL=postgresql://127.0.0.1/nodal_fiiu_test_talk$$ node --test tests/fiiu-talk-postgres.test.js; dropdb -h 127.0.0.1 nodal_fiiu_test_talk$$
const databaseUrl=process.env.NODAL_FIIU_TALK_TEST_DATABASE_URL;
const migrations=['20260928233515_fiiu_festival','20260929194059_fiiu_event_summary','20261001011759_fiiu_checkin','20261003013301_fiiu_confirmation_email','20261011120000_fiiu_conversations','20261013120000_fiiu_programme_general'];
test('PostgreSQL festival conversations keep revisions, counters, rating totals and the upload allowance in triggers, stay server-only and survive account erasure',{skip:!databaseUrl,timeout:60000},async()=>{
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
 const triggers=['public.fiiu_message_sequence()','public.fiiu_like_count()','public.fiiu_question_revision()','public.fiiu_file_attached()','public.erase_fiiu_messages_on_account_delete()','nodal_private.guard_fiiu_upload_quota()'];
 const rpcs=['public.reserve_fiiu_file(jsonb)','public.fiiu_question_stats(text)'];
 assert.equal(await sql(`SELECT coalesce(string_agg(r||' '||f,', '),'') FROM unnest(array['anon','authenticated']) r,unnest(${list([...triggers,...rpcs])}) f WHERE has_function_privilege(r,f,'EXECUTE')`),'','browser roles execute nothing');
 assert.equal(await sql(`SELECT bool_and(has_function_privilege('service_role',f,'EXECUTE')) FROM unnest(${list(rpcs)}) f`),'t');
 await assert.rejects(as('anon',`SELECT * FROM public.fiiu_messages;`),/permission denied for table fiiu_messages/);
 await assert.rejects(as('authenticated',`SELECT * FROM public.fiiu_question_stats('fiiu-2026');`),/permission denied for function fiiu_question_stats/);
 // Account deletion reaches the triggers as GoTrue's role, so they run as their owner with an empty search path.
 assert.equal(await sql(`SELECT string_agg(proname,',' ORDER BY proname) FROM pg_proc WHERE prosecdef AND proconfig=ARRAY['search_path=""'] AND oid IN (SELECT unnest(${list(triggers)})::regprocedure)`),
  'erase_fiiu_messages_on_account_delete,fiiu_file_attached,fiiu_like_count,fiiu_message_sequence,fiiu_question_revision');
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

 // Attaching a file restamps its message (a second request after the insert), so a browser that synced the message
 // without its files fetches it again; a status change or an unchanged message_id moves nothing.
 const file=`md5('file-1')::uuid`,stamp=async()=>[await question('revision'),await message(1,'seq')];
 await service(`UPDATE public.fiiu_files SET status='ready' WHERE id=${file};`);
 const [ready]=await stamp();
 await service(`UPDATE public.fiiu_files SET message_id='${m(1)}' WHERE id=${file} AND message_id IS NULL;`);
 assert.deepEqual(await stamp(),[String(Number(ready)+1),String(Number(ready)+1)]);
 await service(`UPDATE public.fiiu_files SET message_id=message_id,status=status WHERE id=${file};`);
 assert.equal(await question('revision'),String(Number(ready)+1));

 // 20261013120000: programme edits, one-off notices and rating questions are server-only like the rest.
 const added=['public.fiiu_programme','public.fiiu_notices','public.fiiu_ratings'];
 assert.equal(await sql(`SELECT count(*) FROM unnest(${list(added)}) t WHERE (SELECT relrowsecurity FROM pg_class WHERE oid=t::regclass)`),'3');
 assert.equal(await sql(`SELECT coalesce(string_agg(r||' '||p||' '||t,', '),'') FROM unnest(array['anon','authenticated']) r,unnest(${list(added)}) t,
  unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE has_table_privilege(r,t,p)`),'','browser roles hold nothing on the new tables');
 assert.equal(await sql(`SELECT bool_and(has_table_privilege('service_role',t,p)) FROM unnest(${list(added)}) t,unnest(array['SELECT','INSERT','UPDATE','DELETE']) p`),'t');
 const ratingTriggers=['public.fiiu_question_kind_lock()','public.fiiu_rating_count()'],setRating='public.set_fiiu_rating(uuid,uuid,smallint,timestamptz)';
 assert.equal(await sql(`SELECT coalesce(string_agg(r||' '||f,', '),'') FROM unnest(array['anon','authenticated']) r,unnest(${list([...ratingTriggers,setRating])}) f WHERE has_function_privilege(r,f,'EXECUTE')`),'','browser roles execute none of the new functions');
 assert.equal(await sql(`SELECT has_function_privilege('service_role','${setRating}','EXECUTE')`),'t');
 await assert.rejects(as('authenticated',`SELECT * FROM public.set_fiiu_rating('${q}','${a}',5::smallint,now());`),/permission denied for function set_fiiu_rating/);
 await assert.rejects(as('anon',`SELECT * FROM public.fiiu_ratings;`),/permission denied for table fiiu_ratings/);
 assert.equal(await sql(`SELECT string_agg(proname,',' ORDER BY proname) FROM pg_proc WHERE prosecdef AND proconfig=ARRAY['search_path=""'] AND oid IN (SELECT unnest(${list(ratingTriggers)})::regprocedure)`),
  'fiiu_question_kind_lock,fiiu_rating_count','the triggers run as their owner, so an account deletion reaches them');

 // A question is a conversation without totals or a rating with exactly ten; existing questions are conversations.
 assert.equal(await question("kind||':'||coalesce(array_to_string(rating_counts,','),'null')"),'chat:null');
 const r='40000000-0000-4000-8000-000000000001',zeros='{0,0,0,0,0,0,0,0,0,0}';
 const ask=(id,kind,counts)=>service(`INSERT INTO public.fiiu_questions(id,event_id,activity_id,talk,body,status,created_by,version,created_at,updated_at,kind,rating_counts)
  VALUES('${id}','fiiu-2026','general',NULL,'Del 1 al 10','open',NULL,1,now(),now(),'${kind}',${counts});`);
 await assert.rejects(ask('40000000-0000-4000-8000-000000000002','rating','NULL'),/fiiu_questions_rating_counts/,'a rating question has its totals');
 await assert.rejects(ask('40000000-0000-4000-8000-000000000003','rating',"'{0,0,0}'"),/fiiu_questions_rating_counts/,'ten of them');
 await assert.rejects(ask('40000000-0000-4000-8000-000000000004','chat',`'${zeros}'`),/fiiu_questions_rating_counts/,'a conversation has none');
 await assert.rejects(ask('40000000-0000-4000-8000-000000000005','poll','NULL'),/check constraint/);
 await ask(r,'rating',`'${zeros}'`);
 const rq=field=>service(`SELECT ${field} FROM public.fiiu_questions WHERE id='${r}';`);
 const rate=(user,score,id=r)=>service(`SELECT array_to_string(counts,',')||':'||rev FROM public.set_fiiu_rating('${id}','${user}',${score}::smallint,now());`);

 // One score per person, changeable: the RPC answers the totals and revision the trigger moved in the same transaction.
 assert.equal(await rate(a,8),'0,0,0,0,0,0,0,1,0,0:1');
 assert.equal(await rate(a,8),'0,0,0,0,0,0,0,1,0,0:1','the same score again changes nothing');
 assert.equal(await rate(a,3),'0,0,1,0,0,0,0,0,0,0:3','a change moves one total down and another up');
 assert.equal(await rate(b,3),'0,0,2,0,0,0,0,0,0,0:4');
 assert.equal(await service(`SELECT string_agg(score::text,',' ORDER BY score) FROM public.fiiu_ratings WHERE question_id='${r}';`),'3,3');
 await assert.rejects(rate(a,11),/check constraint/);
 await assert.rejects(rate(a,5,q),/PFR02/,'a conversation takes no score');
 await assert.rejects(rate(a,5,'40000000-0000-4000-8000-0000000000ff'),/PFR01/,'nor a missing question');
 await service(`UPDATE public.fiiu_questions SET status='closed' WHERE id='${r}';`);
 await assert.rejects(rate(a,5),/PFR03/,'nor a closed one');
 assert.equal(await rq("array_to_string(rating_counts,',')||':'||revision"),'0,0,2,0,0,0,0,0,0,0:5','refusals move nothing; the close moved the revision');
 await assert.rejects(service(`UPDATE public.fiiu_questions SET kind='chat',rating_counts=NULL WHERE id='${r}';`),/PFR04/,'the type never changes');
 await service(`UPDATE public.fiiu_questions SET kind='rating',body='Del 1 al 10, ¿cuánto?' WHERE id='${r}';`);

 // GoTrue's account deletion cascades the score away, and the trigger takes it out of the totals even once closed; a
 // notice goes with the account and a programme edit stays without its editor.
 await service(`INSERT INTO public.fiiu_programme VALUES('day1-am','fiiu-2026','{"title":"Editado"}',1,'${a}',now());
  INSERT INTO public.fiiu_notices VALUES(gen_random_uuid(),'fiiu-2026','${a}','closing-party','sent','es',now(),now(),now());`);
 await assert.rejects(service(`INSERT INTO public.fiiu_notices VALUES(gen_random_uuid(),'fiiu-2026','${a}','closing-party','pending','es',now(),now(),now());`),/duplicate key/,'one notice of a kind per person');
 await service(`DELETE FROM public.fiiu_files WHERE user_id='${a}';`);
 const revision=Number(await rq('revision'));
 await erase([a]);
 assert.equal(await rq("array_to_string(rating_counts,',')"),'0,0,1,0,0,0,0,0,0,0');assert.equal(Number(await rq('revision')),revision+1);
 assert.equal(await service(`SELECT count(*) FROM public.fiiu_ratings WHERE user_id='${a}';`),'0');
 assert.equal(await service(`SELECT count(*) FROM public.fiiu_notices WHERE user_id='${a}';`),'0');
 assert.equal(await service(`SELECT data->>'title'||':'||coalesce(updated_by::text,'null') FROM public.fiiu_programme WHERE id='day1-am';`),'Editado:null');
});
