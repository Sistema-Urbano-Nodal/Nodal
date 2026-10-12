import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser} from '../server/db.js';
import {createFiiuStore} from '../server/fiiu-repository.js';
import {createTalkStore} from '../server/fiiu-talk-repository.js';

const EVENT='fiiu-2026',MB=1024*1024;
const at=s=>new Date(Date.UTC(2026,9,21,14,0,s)).toISOString();
function setup(){
 const db=createDatabase({filename:':memory:'});
 const [ana,ben,org]=['Ana','Ben','Org'].map(name=>createUser(db,{fullName:`${name} Test`,email:`${name.toLowerCase()}@example.test`,passwordHash:'x'}));
 const store=createTalkStore({db});let clock=0;
 const question=(extra={})=>store.insertQuestion({id:randomUUID(),eventId:EVENT,activityId:'day1-am',talk:null,body:'¿Qué te llevas?',status:'open',createdBy:org.id,createdAt:at(clock++),...extra});
 const message=(q,user,extra={})=>store.insertMessage({id:randomUUID(),questionId:q.id,userId:user.id,authorName:'Ana T.',authorFull:'Ana Test',organiser:false,body:'hola',clientId:randomUUID(),createdAt:at(clock++),...extra});
 const file=(user,extra={})=>{const id=randomUUID();return store.reserveFile({id,eventId:EVENT,userId:user.id,name:'a.jpg',mime:'image/jpeg',size:10,width:null,height:null,thumbSize:null,storagePath:`fiiu/${user.id}/${id}`,createdAt:at(clock++),...extra});};
 return {db,store,ana,ben,org,question,message,file};
}

test('registrations are read for names and emails only',async()=>{
 const {db,store,ana,ben}=setup();
 await createFiiuStore({db}).insert('registrations',{id:randomUUID(),eventId:EVENT,userId:ana.id,email:'ana@example.test',answers:{firstName:'Ana',lastName:'Test',nationalId:'12345678'},labStatus:'none',version:1,createdAt:at(0),updatedAt:at(0)});
 const found=await store.findRegistration(EVENT,ana.id);
 assert.deepEqual(Object.keys(found).sort(),['email','firstName','id','lastName'],'the national ID never leaves the store');
 assert.equal(found.firstName,'Ana');assert.equal(found.lastName,'Test');assert.equal(found.email,'ana@example.test');
 assert.equal(await store.findRegistration(EVENT,ben.id),null);assert.equal(await store.findRegistration('other',ana.id),null);
 const emails=await store.registrationEmails(EVENT,[ana.id,ben.id,ana.id]);
 assert.ok(emails instanceof Map);assert.equal(emails.get(ana.id),'ana@example.test');assert.equal(emails.has(ben.id),false);
 assert.equal((await store.registrationEmails(EVENT,[])).size,0);
 // An erased author's messages keep user_id NULL; the export asks for their email too and simply gets none.
 const erased=await store.registrationEmails(EVENT,[ana.id,null,undefined]);
 assert.deepEqual([...erased],[[ana.id,'ana@example.test']]);
});

test('the talk store reads registrations even when the FIIU store has not run on the database yet',async()=>{
 const db=createDatabase({filename:':memory:'});
 const ana=createUser(db,{fullName:'Ana Test',email:'ana@example.test',passwordHash:'x'});
 const store=createTalkStore({db});
 assert.equal(await store.findRegistration(EVENT,ana.id),null);assert.equal((await store.registrationEmails(EVENT,[ana.id])).size,0);
 await createFiiuStore({db}).insert('registrations',{id:randomUUID(),eventId:EVENT,userId:ana.id,email:'ana@example.test',answers:{firstName:'Ana',lastName:'Test'},labStatus:'none',version:1,createdAt:at(0),updatedAt:at(0)});
 assert.equal((await store.findRegistration(EVENT,ana.id)).firstName,'Ana','the FIIU store still upgrades and uses the same table');
});

test('an optional field left undefined is treated as absent, as JSON leaves it out for Supabase',async()=>{
 const {store,ana,question,message,file}=setup();
 const pdf=await file(ana,{mime:'application/pdf',width:undefined,height:undefined,thumbSize:undefined});
 assert.deepEqual([pdf.status,pdf.width,pdf.height,pdf.thumbSize],['pending',null,null,null]);
 const q=await question(),m=await message(q,ana);
 const hidden=await store.updateMessage({id:m.id},{hiddenAt:at(70),hiddenBy:undefined,body:undefined});
 assert.equal(hidden.body,'hola','an undefined patch field leaves the column alone');assert.equal(hidden.hiddenAt,at(70));
 await assert.rejects(store.updateMessage({id:m.id},{body:undefined}),/empty/);
});

test('each message moves its question revision and takes it as seq',async()=>{
 const {store,ana,ben,org,question,message}=setup();
 const q=await question();
 assert.equal(q.revision,0);assert.equal(q.version,1);assert.equal(q.messageCount,0);assert.equal(q.updatedAt,q.createdAt);assert.equal(q.createdBy,org.id);
 const m1=await message(q,ana),m2=await message(q,ben,{organiser:true});
 assert.equal(m1.seq,1);assert.equal(m2.seq,2);assert.equal(m1.organiser,false);assert.equal(m2.organiser,true);assert.equal(m1.likeCount,0);
 const now=await store.getQuestion(q.id);assert.equal(now.revision,2);assert.equal(now.messageCount,2);
 assert.equal((await store.findMessage(m1.id)).body,'hola');assert.equal((await store.findMessageByClient(ben.id,m2.clientId)).id,m2.id);
 assert.equal(await store.findMessageByClient(ana.id,m2.clientId),null);assert.equal(await store.getQuestion(randomUUID()),null);
});

test('messagesSince returns rows changed after a revision, hidden ones included with their new seq',async()=>{
 const {store,ana,ben,org,question,message}=setup();
 const q=await question(),m1=await message(q,ana),m2=await message(q,ben);
 assert.deepEqual((await store.messagesSince(q.id,1)).map(m=>m.id),[m2.id]);
 const hidden=await store.updateMessage({id:m1.id,hiddenAt:null},{hiddenAt:at(50),hiddenBy:org.id});
 assert.equal(hidden.seq,3,'the returned row carries the seq the trigger stamped');assert.equal(hidden.hiddenBy,org.id);
 const since=await store.messagesSince(q.id,2);
 assert.deepEqual(since.map(m=>[m.id,m.seq,m.hiddenAt]),[[m1.id,3,at(50)]]);
 assert.equal((await store.getQuestion(q.id)).messageCount,1);
 assert.equal(await store.updateMessage({id:m1.id,hiddenAt:null},{hiddenAt:at(51)}),null,'a null filter means IS NULL, so an already hidden message is not hidden again');
 assert.equal(await store.updateMessage({id:m2.id,userId:ana.id},{body:''}),null,'someone else\'s message is out of scope');
 const shown=await store.updateMessage({id:m1.id},{hiddenAt:null,hiddenBy:null});assert.equal(shown.seq,4);assert.equal((await store.getQuestion(q.id)).messageCount,2);
 assert.deepEqual((await store.messagesSince(q.id,0,{limit:1})).map(m=>m.id),[m2.id],'ordered by seq and limited');
 assert.equal((await store.updateMessage({id:m2.id},{body:m2.body})).seq,m2.seq,'an update that changes nothing does not move the revision');
 await assert.rejects(store.updateMessage({userId:ana.id},{body:''}),/scoped/);
});

test('likes are idempotent per person and the count never goes negative',async()=>{
 const {store,ana,ben,question,message}=setup();
 const q=await question(),m=await message(q,ana);
 assert.equal(await store.like(m.id,ben.id,at(60)),true);assert.equal(await store.like(m.id,ben.id,at(61)),false);
 assert.equal((await store.findMessage(m.id)).likeCount,1);assert.equal((await store.getQuestion(q.id)).revision,2,'a like moves the revision once');
 assert.equal((await store.messagesSince(q.id,1))[0].likeCount,1);
 assert.deepEqual([...await store.likedAmong(ben.id,[m.id,randomUUID()])],[m.id]);assert.equal((await store.likedAmong(ana.id,[m.id])).size,0);
 assert.deepEqual(await store.userLikes(ben.id),[m.id]);
 assert.equal(await store.unlike(m.id,ben.id),true);assert.equal(await store.unlike(m.id,ben.id),false);
 assert.equal((await store.findMessage(m.id)).likeCount,0);assert.equal((await store.getQuestion(q.id)).revision,3);
 await assert.rejects(store.like(randomUUID(),ben.id,at(62)),e=>e.status===404,'a message deleted mid-request is a 404');
 await store.like(m.id,ana.id,at(63));assert.equal(await store.removeUserLikes(ana.id),1);assert.equal((await store.findMessage(m.id)).likeCount,0);
});

test('the latest page skips deleted messages, hides hidden ones unless asked and pages back by (createdAt, id)',async()=>{
 const {store,ana,org,question,message}=setup();
 const q=await question(),ms=[];for(let i=0;i<5;i++)ms.push(await message(q,ana,{body:'m'+i}));
 await store.updateMessage({id:ms[1].id},{hiddenAt:at(70),hiddenBy:org.id});await store.updateMessage({id:ms[3].id},{body:'',deletedAt:at(71)});
 const page=await store.latestMessages(q.id,{limit:2});
 assert.deepEqual(page.rows.map(m=>m.body),['m2','m4'],'oldest first');assert.equal(page.more,true);
 const older=await store.latestMessages(q.id,{limit:2,before:{createdAt:page.rows[0].createdAt,id:page.rows[0].id}});
 assert.deepEqual(older.rows.map(m=>m.body),['m0']);assert.equal(older.more,false);
 const all=await store.latestMessages(q.id,{limit:10,includeHidden:true});
 assert.deepEqual(all.rows.map(m=>m.body),['m0','m1','m2','m4'],'organisers see hidden messages, never deleted ones');assert.equal(all.more,false);
 assert.deepEqual((await store.latestMessages(q.id,{limit:10,ownHidden:ana.id})).rows.map(m=>m.body),['m0','m1','m2','m4'],'an author sees their own hidden message');
 assert.deepEqual((await store.latestMessages(q.id,{limit:10,ownHidden:org.id})).rows.map(m=>m.body),['m0','m2','m4'],'and nobody else\'s');
 // Two messages written in the same millisecond still page apart by id.
 const same=at(90),[a,b]=[randomUUID(),randomUUID()].sort();
 await message(q,ana,{id:a,createdAt:same,body:'a'});await message(q,ana,{id:b,createdAt:same,body:'b'});
 const tie=await store.latestMessages(q.id,{limit:1});assert.deepEqual(tie.rows.map(m=>m.body),['b']);
 assert.deepEqual((await store.latestMessages(q.id,{limit:1,before:{createdAt:same,id:b}})).rows.map(m=>m.body),['a']);
 assert.deepEqual((await store.allMessages(q.id)).map(m=>m.body),['m0','m1','m2','','m4','a','b'],'the export keeps every state');
 assert.equal((await store.userMessages(ana.id)).length,7);
});

test('question edits are compare-and-set on version and only text, talk and status move the revision',async()=>{
 const {store,question}=setup();
 const q=await question();
 assert.equal(await store.updateQuestion(q.id,2,{status:'closed',updatedAt:at(80)}),null,'a stale version changes nothing');
 const closed=await store.updateQuestion(q.id,1,{status:'closed',updatedAt:at(80)});
 assert.equal(closed.status,'closed');assert.equal(closed.version,2);assert.equal(closed.revision,1);assert.equal(closed.updatedAt,at(80));
 const same=await store.updateQuestion(q.id,2,{status:'closed',body:q.body,updatedAt:at(81)});
 assert.equal(same.version,3);assert.equal(same.revision,1,'saving the same values does not wake every browser');
 const edited=await store.updateQuestion(q.id,3,{body:'¿Y ahora?',talk:'¡Bienvenidos al FIIU 11!',updatedAt:at(82)});
 assert.equal(edited.revision,2);assert.equal(edited.talk,'¡Bienvenidos al FIIU 11!');
 await assert.rejects(store.updateQuestion(q.id,4,{activityId:'day2-am'}),/unknown/,'the block cannot move');
});

test('the pulse and the participant list leave hidden questions out',async()=>{
 const {store,question,ana,message}=setup();
 const open=await question({activityId:'day1-am'}),hidden=await question({activityId:'day1-am',status:'hidden'}),other=await question({activityId:'day2-am'});
 await message(open,ana);
 assert.deepEqual(await store.pulse(EVENT),[{id:open.id,activityId:'day1-am',revision:1,status:'open'},{id:other.id,activityId:'day2-am',revision:0,status:'open'}]);
 assert.deepEqual((await store.listQuestions(EVENT,{activityId:'day1-am'})).map(q=>q.id),[open.id]);
 assert.deepEqual((await store.listQuestions(EVENT,{activityId:'day1-am',includeHidden:true})).map(q=>q.id),[open.id,hidden.id]);
 assert.deepEqual((await store.listQuestions(EVENT,{includeHidden:true})).map(q=>q.id),[open.id,hidden.id,other.id]);
 assert.deepEqual(await store.pulse('other-event'),[]);
});

test('the upload allowance stops the 31st file and the byte past 30 MB, counting pending files',async()=>{
 const {store,ana,ben,org,file}=setup();
 for(let i=0;i<30;i++)assert.equal((await file(ana)).status,'pending');
 await assert.rejects(file(ana),e=>e.status===413&&e.code==='upload_allowance'&&e.message==='festival upload allowance reached');
 for(let i=0;i<10;i++)await file(ben,{size:3*MB});
 await assert.rejects(file(ben,{size:1}),e=>e.status===413&&e.code==='upload_allowance');
 assert.equal((await store.userFiles(ben.id)).length,10,'the refused reservation left no row');
 assert.equal((await store.userFiles(ben.id,{limit:3})).length,3);
 const first=await file(org);
 await assert.rejects(file(org,{id:first.id}),e=>e.status===409&&e.code==='conflict','a retried reservation id is a conflict');
 assert.equal((await file(org,{eventId:'another-event',size:30*MB})).status,'pending','the allowance is per event');
});

test('files attach only when ready, unattached and the poster\'s own',async()=>{
 const {store,ana,ben,question,message,file}=setup();
 const q=await question(),m=await message(q,ana),m2=await message(q,ana);
 const mine=await file(ana),pending=await file(ana),theirs=await file(ben);
 assert.equal((await store.setFileStatus(mine.id,'pending','ready')).status,'ready');assert.equal(await store.setFileStatus(mine.id,'pending','ready'),null);
 await store.setFileStatus(theirs.id,'pending','ready');
 assert.equal(await store.attachFiles([theirs.id],m.id,ana.id),0,'someone else\'s file');
 assert.equal(await store.attachFiles([pending.id],m.id,ana.id),0,'a pending upload');
 assert.equal(await store.attachFiles([mine.id],m.id,ana.id),1);
 assert.equal(await store.attachFiles([mine.id],m2.id,ana.id),0,'an attached file');
 assert.equal(await store.attachFiles([],m.id,ana.id),0);
 assert.deepEqual((await store.filesForMessages([m.id,m2.id])).map(f=>f.id),[mine.id]);
 assert.deepEqual((await store.filesByIds([pending.id,mine.id])).map(f=>f.id).sort(),[mine.id,pending.id].sort());
 assert.equal((await store.findFile(mine.id)).messageId,m.id);
 assert.equal(await store.removeFile(pending.id),1);assert.equal(await store.findFile(pending.id),null);
});

test('attaching files moves the question revision and restamps the message, so a sync fetches it again with them',async()=>{
 const {store,ana,question,message,file}=setup();
 const q=await question(),m=await message(q,ana),[f1,f2,f3]=[await file(ana),await file(ana),await file(ana)];
 for(const f of [f1,f2,f3])await store.setFileStatus(f.id,'pending','ready');
 assert.equal((await store.getQuestion(q.id)).revision,1,'a file finishing its upload moves nothing');
 assert.equal(await store.attachFiles([f1.id,f2.id],m.id,ana.id),2);
 const after=await store.getQuestion(q.id),moved=await store.findMessage(m.id);
 assert.ok(after.revision>1);assert.equal(moved.seq,after.revision);assert.equal(after.messageCount,1,'the visible count is unchanged');
 assert.deepEqual((await store.messagesSince(q.id,1)).map(x=>x.id),[m.id]);
 assert.equal(await store.attachFiles([f1.id],m.id,ana.id),0);assert.equal((await store.getQuestion(q.id)).revision,after.revision,'a refused attach moves nothing');
 await store.setFileStatus(f1.id,'ready','deleting');assert.equal((await store.getQuestion(q.id)).revision,after.revision,'neither does a release');
});

test('scrubbing a person blanks their messages, and deleting the account keeps the rows and cascades the likes',async()=>{
 const {db,store,ana,ben,question,message}=setup();
 const q=await question(),mine=await message(q,ana),theirs=await message(q,ben),gone=await message(q,ana);
 await store.updateMessage({id:gone.id},{body:'',deletedAt:at(40)});
 await store.like(theirs.id,ana.id,at(41));
 assert.equal(await store.scrubUserMessages(ana.id,at(42)),2);
 const scrubbed=await store.findMessage(mine.id);
 assert.deepEqual([scrubbed.body,scrubbed.authorName,scrubbed.authorFull,scrubbed.deletedAt],['','','',at(42)]);
 assert.equal((await store.findMessage(gone.id)).deletedAt,at(40),'an earlier deletion time is kept');
 assert.equal((await store.getQuestion(q.id)).messageCount,1);
 db.prepare('DELETE FROM users WHERE id=?').run(ana.id);
 const orphan=await store.findMessage(mine.id);assert.equal(orphan.userId,null);assert.equal(orphan.body,'');
 assert.equal((await store.findMessage(theirs.id)).likeCount,0,'the like went with the account');
 assert.equal((await store.userLikes(ana.id)).length,0);
});

test('deleting an account that was never scrubbed still blanks its messages, as the Postgres trigger does',async()=>{
 const {db,store,ana,ben,question,message,file}=setup();
 const q=await question(),mine=await message(q,ana),theirs=await message(q,ben);
 const held=await file(ana);
 assert.throws(()=>db.prepare('DELETE FROM users WHERE id=?').run(ana.id),/FOREIGN KEY/,'files are removed by the application first');
 assert.equal((await store.findMessage(mine.id)).body,'hola','the refused deletion rolled the blanking back');
 await store.removeFile(held.id);
 const before=await store.getQuestion(q.id);
 db.prepare('DELETE FROM users WHERE id=?').run(ana.id);
 const orphan=await store.findMessage(mine.id);
 assert.deepEqual([orphan.userId,orphan.body,orphan.authorName,orphan.authorFull],[null,'','','']);
 assert.match(orphan.deletedAt,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/,'stamped in the UTC ISO form the app writes');
 const after=await store.getQuestion(q.id);
 assert.equal(after.messageCount,1);assert.ok(after.revision>before.revision,'browsers learn the message went');
 assert.equal((await store.findMessage(theirs.id)).body,'hola');
 assert.deepEqual((await store.allMessages(q.id)).filter(m=>m.body).map(m=>m.id),[theirs.id]);
});

test('a reused client id or question id is a 409 conflict',async()=>{
 const {store,ana,question,message}=setup();
 const q=await question(),m=await message(q,ana);
 await assert.rejects(message(q,ana,{clientId:m.clientId}),e=>e.status===409&&e.code==='conflict');
 await assert.rejects(question({id:q.id}),e=>e.status===409&&e.code==='conflict');
 await assert.rejects(message(q,{id:randomUUID()}),e=>e.status===404,'an account deleted mid-request is a 404');
 await assert.rejects(message({id:randomUUID()},ana),e=>e.status===404&&e.message==='related record unavailable','an unknown question has no revision to take');
 assert.equal((await store.getQuestion(q.id)).revision,1,'the refused insert left the revision alone');
});

test('question stats count people and likes over visible messages',async()=>{
 const {store,ana,ben,org,question,message}=setup();
 const q=await question(),empty=await question();
 const a=await message(q,ana),b=await message(q,ana),c=await message(q,ben);
 await store.like(a.id,ben.id,at(30));await store.like(b.id,ben.id,at(31));await store.like(c.id,ana.id,at(32));
 await store.updateMessage({id:c.id},{hiddenAt:at(33),hiddenBy:org.id});
 const stats=await store.questionStats(EVENT);
 assert.deepEqual(stats.get(q.id),{people:1,likes:2});assert.equal(stats.has(empty.id),false);
});

test('file bytes round-trip for both variants and are removed together',async()=>{
 const {store,ana,file}=setup();
 const f=await file(ana);
 await store.putBytes(f,'full',Buffer.from('full'));await store.putBytes(f,'thumb',Buffer.from('thumb'));
 assert.equal((await store.getBytes(f,'full')).toString(),'full');assert.equal((await store.getBytes(f,'thumb')).toString(),'thumb');
 assert.ok(Buffer.isBuffer(await store.getBytes(f,'full')));
 // Storage answers these with the 502 of object-storage.js (x-upsert false refuses a second put, a missing object is
 // a failed GET), so local tests see the statuses production returns.
 const storage=e=>e.status===502&&e.message==='attachment storage unavailable';
 await assert.rejects(store.putBytes(f,'full',Buffer.from('again')),storage,'bytes are never replaced');
 assert.equal((await store.getBytes(f,'full')).toString(),'full');
 await store.deleteBytes(f);
 await assert.rejects(store.getBytes(f,'full'),storage);await assert.rejects(store.getBytes(f,'thumb'),storage);
 await assert.rejects(store.putBytes(f,'original',Buffer.from('x')),/variant/);
});

// Supabase: the real REST client over a recording fetch. `answer` returns {status, body, range} per call.
const ENV={NEXT_PUBLIC_SUPABASE_URL:'https://p.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:'sb_secret_test'};
function supabase(answer=()=>({})){
 const calls=[];
 const fetchImpl=async(url,init={})=>{
  const u=new URL(url),call={url,path:u.pathname,params:u.searchParams,query:Object.fromEntries(u.searchParams),method:init.method??'GET',headers:init.headers??{},body:typeof init.body==='string'?JSON.parse(init.body):init.body};
  calls.push(call);const {status=200,body=[],range=''}=(await answer(call))??{};
  const raw=Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
  return {ok:status>=200&&status<300,status,headers:{get:name=>name.toLowerCase()==='content-range'?range:null},text:async()=>raw.toString(),arrayBuffer:async()=>raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength)};
 };
 return {calls,store:createTalkStore({env:ENV,fetchImpl})};
}
const Q='11111111-1111-4111-8111-111111111111',U='22222222-2222-4222-8222-222222222222',F='33333333-3333-4333-8333-333333333333',M='44444444-4444-4444-8444-444444444444';
const without=(params,key)=>{const copy=new URLSearchParams(params);copy.delete(key);return copy.toString();};

test('Supabase messagesSince and the latest page send exact keyset queries and return camelCase rows in UTC',async()=>{
 const pg=supabase(call=>call.query.order==='created_at.desc,id.desc'?{body:[{id:'b',created_at:'2026-10-21T14:00:02.5+00:00',organiser:true,seq:'9'},{id:'a',created_at:'2026-10-21T14:00:01+00:00',organiser:false,hidden_at:null}]}:{});
 await pg.store.messagesSince(Q,5,{limit:201});
 assert.equal(pg.calls[0].path,'/rest/v1/fiiu_messages');assert.equal(pg.calls[0].method,'GET');
 assert.equal(without(pg.calls[0].params,'select'),`question_id=eq.${Q}&seq=gt.5&order=seq.asc&limit=201`);
 assert.match(pg.calls[0].query.select,/(^|,)author_full(,|$)/);assert.match(pg.calls[0].query.select,/(^|,)seq(,|$)/);
 await pg.store.messagesSince(Q,5,{limit:5000});assert.equal(pg.calls[1].query.limit,'201','every limit is capped at 201');
 const page=await pg.store.latestMessages(Q,{limit:1,before:{createdAt:'2026-10-21T14:00:03.000Z',id:M}});
 const sent=pg.calls[2].query;
 assert.equal(sent.order,'created_at.desc,id.desc');assert.equal(sent.limit,'2');assert.equal(sent.deleted_at,'is.null');assert.equal(sent.hidden_at,'is.null');
 assert.equal(sent.or,`(created_at.lt.2026-10-21T14:00:03.000Z,and(created_at.eq.2026-10-21T14:00:03.000Z,id.lt.${M}))`);
 assert.deepEqual(page.rows.map(r=>[r.id,r.createdAt,r.organiser]),[['b','2026-10-21T14:00:02.500Z',true]],'one row over the limit is trimmed, the rest come oldest first');
 assert.equal(page.more,true);
 await pg.store.latestMessages(Q,{includeHidden:true});assert.equal(pg.calls[3].query.hidden_at,undefined);assert.equal(pg.calls[3].query.limit,'101');
 // An author's own hidden messages come too; the filter rides in `and`, so it never meets the cursor's `or`.
 await pg.store.latestMessages(Q,{ownHidden:U,before:{createdAt:'2026-10-21T14:00:03.000Z',id:M}});
 assert.equal(pg.calls[4].query.hidden_at,undefined);assert.equal(pg.calls[4].query.and,`(or(hidden_at.is.null,user_id.eq.${U}))`);assert.match(pg.calls[4].query.or,/^\(created_at\.lt\./);
 await assert.rejects(pg.store.latestMessages(Q,{ownHidden:'x,y'}),/identifier/,'an author id never takes PostgREST syntax');
 await assert.rejects(pg.store.latestMessages(Q,{before:{createdAt:'x),or(id.gt.0',id:M}}),e=>e.status===400,'a cursor cannot inject a filter');
});

test('Supabase likes ignore duplicates, unlikes return what they removed, and updates turn null filters into IS NULL',async()=>{
 let likeRows=[{message_id:M,user_id:U}];
 const pg=supabase(call=>call.path.endsWith('fiiu_message_likes')&&call.method==='POST'?{status:201,body:likeRows}:call.method==='DELETE'?{body:[{message_id:M}]}:call.method==='PATCH'?{body:[{id:M,hidden_at:'2026-10-21T15:00:00+00:00'}]}:{});
 assert.equal(await pg.store.like(M,U,'2026-10-21T14:00:00.000Z'),true);
 assert.equal(pg.calls[0].headers.Prefer,'resolution=ignore-duplicates,return=representation');
 assert.deepEqual(pg.calls[0].body,{message_id:M,user_id:U,created_at:'2026-10-21T14:00:00.000Z'});
 likeRows=[];assert.equal(await pg.store.like(M,U,'2026-10-21T14:00:00.000Z'),false,'a duplicate is ignored, not counted');
 assert.equal(await pg.store.unlike(M,U),true);
 const unlike=pg.calls.at(-1);assert.equal(unlike.method,'DELETE');assert.equal(unlike.headers.Prefer,'return=representation');
 assert.equal(unlike.query.message_id,`eq.${M}`);assert.equal(unlike.query.user_id,`eq.${U}`);
 const hidden=await pg.store.updateMessage({id:M,hiddenAt:null,deletedAt:null},{hiddenAt:'2026-10-21T15:00:00.000Z',hiddenBy:U});
 const patch=pg.calls.at(-1);assert.equal(patch.method,'PATCH');assert.equal(patch.query.hidden_at,'is.null');assert.equal(patch.query.deleted_at,'is.null');assert.equal(patch.query.id,`eq.${M}`);
 assert.deepEqual(patch.body,{hidden_at:'2026-10-21T15:00:00.000Z',hidden_by:U});assert.equal(hidden.hiddenAt,'2026-10-21T15:00:00.000Z');
 const fk=supabase(()=>({status:409,body:{code:'23503',message:'violates foreign key constraint'}}));
 await assert.rejects(fk.store.like(M,U,'2026-10-21T14:00:00.000Z'),e=>e.status===404);
 const dup=supabase(()=>({status:409,body:{code:'23505',message:'duplicate key'}}));
 const post={id:M,questionId:Q,userId:U,authorName:'A',authorFull:'A',organiser:false,body:'x',clientId:F,createdAt:'2026-10-21T14:00:00.000Z'};
 await assert.rejects(dup.store.insertMessage(post),e=>e.status===409&&e.code==='conflict');
 // The BEFORE INSERT trigger takes seq from the question's revision, so a missing question fails NOT NULL on seq before
 // the foreign key is checked; it is still a missing parent. Any other NOT NULL failure is a bug and stays unmapped.
 const orphan=supabase(()=>({status:400,body:{code:'23502',message:'null value in column "seq" of relation "fiiu_messages" violates not-null constraint'}}));
 await assert.rejects(orphan.store.insertMessage(post),e=>e.status===404&&e.message==='related record unavailable');
 const bug=supabase(()=>({status:400,body:{code:'23502',message:'null value in column "body" of relation "fiiu_messages" violates not-null constraint'}}));
 await assert.rejects(bug.store.insertMessage(post),e=>e.status===400&&e.code==='23502');
});

test('Supabase attaches files only when ready and unattached, and maps the allowance and lock errors of the reservation RPC',async()=>{
 const pg=supabase(call=>call.method==='PATCH'?{body:[{id:F}]}:{});
 assert.equal(await pg.store.attachFiles([F],M,U),1);
 const patch=pg.calls[0];
 assert.equal(patch.path,'/rest/v1/fiiu_files');assert.equal(patch.query.message_id,'is.null');assert.equal(patch.query.status,'eq.ready');
 assert.equal(patch.query.id,`in.(${F})`);assert.equal(patch.query.user_id,`eq.${U}`);assert.deepEqual(patch.body,{message_id:M});assert.equal(patch.headers.Prefer,'return=representation');
 const record={id:F,eventId:EVENT,userId:U,name:'a.jpg',mime:'image/jpeg',size:10,width:1600,height:900,thumbSize:6,storagePath:`fiiu/${U}/${F}`,createdAt:'2026-10-21T14:00:00.000Z'};
 const ok=supabase(()=>({body:[{...Object.fromEntries(Object.entries(record).map(([k,v])=>[k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),v])),status:'pending',message_id:null}]}));
 const saved=await ok.store.reserveFile(record);
 assert.equal(ok.calls[0].path,'/rest/v1/rpc/reserve_fiiu_file');assert.equal(ok.calls[0].body.p_file.storage_path,`fiiu/${U}/${F}`);assert.equal(ok.calls[0].body.p_file.thumb_size,6);assert.equal(ok.calls[0].body.p_file.status,'pending');
 assert.equal(saved.status,'pending');assert.equal(saved.storagePath,`fiiu/${U}/${F}`);
 const refuse=code=>supabase(()=>({status:400,body:{code,message:'provider text'}})).store.reserveFile(record);
 await assert.rejects(refuse('PFU01'),e=>e.status===413&&e.code==='upload_allowance'&&e.message==='festival upload allowance reached');
 await assert.rejects(refuse('23505'),e=>e.status===409);
 await assert.rejects(refuse('40001'),e=>e.status===409&&e.code==='conflict'&&e.message==='upload changed; retry');
 await assert.rejects(refuse('40P01'),e=>e.status===409&&e.code==='conflict');
});

test('Supabase reads registration names through JSON paths, never the whole questionnaire, and chunks emails by 100',async()=>{
 const pg=supabase(call=>call.query.select.startsWith('id,')?{body:[{id:'r',email:'ana@example.test',first_name:'Ana',last_name:'Test'}]}:{body:call.query.user_id.slice(4,-1).split(',').map(id=>({user_id:id,email:id+'@example.test'}))});
 assert.deepEqual(await pg.store.findRegistration(EVENT,U),{id:'r',email:'ana@example.test',firstName:'Ana',lastName:'Test'});
 const read=pg.calls[0];assert.equal(read.path,'/rest/v1/fiiu_registrations');
 assert.equal(read.query.select,'id,email,first_name:answers->>firstName,last_name:answers->>lastName');
 assert.ok(!read.query.select.split(',').includes('answers'),'the national ID never leaves the database');
 assert.equal(read.query.event_id,`eq.${EVENT}`);assert.equal(read.query.user_id,`eq.${U}`);
 const ids=Array.from({length:150},(_,i)=>`${String(i).padStart(8,'0')}-0000-4000-8000-000000000000`);
 const emails=await pg.store.registrationEmails(EVENT,ids);
 assert.equal(emails.size,150);assert.equal(emails.get(ids[149]),ids[149]+'@example.test');
 assert.deepEqual(pg.calls.slice(1).map(c=>c.query.user_id.split(',').length),[100,50]);assert.equal(pg.calls[1].query.select,'user_id,email');
 await assert.rejects(pg.store.registrationEmails(EVENT,['a,b']),/identifier/,'an in-list never takes PostgREST syntax');
 // An erased author (user_id NULL) is skipped rather than failing the whole organiser export.
 const calls=pg.calls.length,erased=await pg.store.registrationEmails(EVENT,[U,null,undefined]);
 assert.deepEqual([...erased],[[U,U+'@example.test']]);assert.equal(pg.calls.at(-1).query.user_id,`in.(${U})`);assert.equal(pg.calls.length,calls+1);
 assert.equal((await pg.store.registrationEmails(EVENT,[null])).size,0);assert.equal(pg.calls.length,calls+1,'nothing to look up, no request');
});

test('Supabase drops undefined patch fields the way SQLite does, so an all-undefined update is refused on both',async()=>{
 const pg=supabase(call=>call.method==='PATCH'?{body:[{id:M,hidden_at:'2026-10-21T15:00:00+00:00'}]}:{});
 await assert.rejects(pg.store.updateMessage({id:M},{body:undefined}),/empty/);assert.equal(pg.calls.length,0);
 await pg.store.updateMessage({id:M},{hiddenAt:'2026-10-21T15:00:00.000Z',hiddenBy:undefined});
 assert.deepEqual(pg.calls[0].body,{hidden_at:'2026-10-21T15:00:00.000Z'});
});

test('Supabase keeps file bytes at fiiu/<userId>/<id> and .thumb in the private bucket and removes both at once',async()=>{
 const pg=supabase(call=>call.method==='GET'?{body:Buffer.from('jpeg')}:{});
 const file={id:F,userId:U,mime:'image/png',storagePath:`fiiu/${U}/${F}`};
 await pg.store.putBytes(file,'full',Buffer.from('png'));await pg.store.putBytes(file,'thumb',Buffer.from('jpg'));
 assert.equal(pg.calls[0].url,`https://p.supabase.co/storage/v1/object/course-attachments/fiiu/${U}/${F}`);assert.equal(pg.calls[0].headers['Content-Type'],'image/png');
 assert.equal(pg.calls[1].url,`https://p.supabase.co/storage/v1/object/course-attachments/fiiu/${U}/${F}.thumb`);assert.equal(pg.calls[1].headers['Content-Type'],'image/jpeg');
 assert.equal(pg.calls[0].headers.Authorization,'Bearer sb_secret_test');assert.equal(pg.calls[0].headers['x-upsert'],'false');
 assert.equal((await pg.store.getBytes(file,'thumb')).toString(),'jpeg');assert.ok(pg.calls[2].url.endsWith('.thumb'));
 await pg.store.deleteBytes(file);
 assert.equal(pg.calls.length,4,'one call removes both variants');assert.equal(pg.calls[3].method,'DELETE');
 assert.deepEqual(pg.calls[3].body,{prefixes:[`fiiu/${U}/${F}`,`fiiu/${U}/${F}.thumb`]});
 await assert.rejects(pg.store.getBytes({...file,storagePath:'fiiu/../courses/x'},'full'),/path/,'a stored path outside fiiu/<user>/<id> is never requested');
 assert.equal(pg.calls.length,4);
});

test('Supabase full reads page by (created_at, id), the stats come from the RPC and the pulse never reads hidden questions',async()=>{
 const row=i=>({id:`${String(i).padStart(8,'0')}-0000-4000-8000-000000000000`,created_at:'2026-10-21T14:00:00+00:00',question_id:Q,user_id:U,seq:i});
 const pg=supabase(call=>{
  if(call.path.endsWith('rpc/fiiu_question_stats'))return {body:[{question_id:Q,people:'3',likes:7}]};
  if(call.path.endsWith('fiiu_questions'))return {body:[{id:Q,activity_id:'day1-am',revision:4,status:'open',created_at:'2026-10-21T14:00:00+00:00'}],range:'0-0/1'};
  return call.query.and?{body:[row(200)],range:'0-0/*'}:{body:Array.from({length:200},(_,i)=>row(i)),range:'0-199/201'};
 });
 assert.equal((await pg.store.allMessages(Q)).length,201);
 const [first,second]=pg.calls;
 assert.equal(first.query.order,'created_at.asc,id.asc');assert.equal(first.query.limit,'200');assert.equal(first.headers.Prefer,'count=exact');
 assert.equal(second.query.and,`(or(created_at.gt.2026-10-21T14:00:00+00:00,and(created_at.eq.2026-10-21T14:00:00+00:00,id.gt.${row(199).id})))`);
 assert.equal(pg.calls.length,2,'the exact count ends the read without an empty page');
 const stats=await pg.store.questionStats(EVENT);
 assert.deepEqual(pg.calls.at(-1).body,{p_event_id:EVENT});assert.equal(pg.calls.at(-1).method,'POST');assert.deepEqual(stats.get(Q),{people:3,likes:7});
 assert.deepEqual(await pg.store.pulse(EVENT),[{id:Q,activityId:'day1-am',revision:4,status:'open'}]);
 assert.equal(pg.calls.at(-1).query.status,'neq.hidden');assert.equal(pg.calls.at(-1).query.event_id,`eq.${EVENT}`);
});

test('Supabase question writes are versioned and scrubbing blanks deleted and live messages without double counting',async()=>{
 const pg=supabase(call=>call.method==='PATCH'&&call.path.endsWith('fiiu_questions')?{body:call.query.version==='eq.1'?[{id:Q,version:2,status:'closed',revision:3}]:[]}:call.method==='PATCH'?{body:call.query.deleted_at==='is.null'?[{id:'a'},{id:'b'}]:[{id:'c'}]}:{status:201,body:[{id:Q,version:1,revision:0}]});
 const created=await pg.store.insertQuestion({id:Q,eventId:EVENT,activityId:'day1-am',talk:null,body:'¿Qué?',status:'open',createdBy:U,createdAt:'2026-10-21T14:00:00.000Z'});
 assert.equal(created.version,1);assert.equal(pg.calls[0].body.version,1);assert.equal(pg.calls[0].body.updated_at,'2026-10-21T14:00:00.000Z');assert.equal(pg.calls[0].headers.Prefer,'return=representation');
 assert.equal((await pg.store.updateQuestion(Q,1,{status:'closed',updatedAt:'2026-10-21T15:00:00.000Z'})).version,2);
 const cas=pg.calls.at(-1);assert.equal(cas.query.id,`eq.${Q}`);assert.equal(cas.query.version,'eq.1');assert.deepEqual(cas.body,{status:'closed',updated_at:'2026-10-21T15:00:00.000Z',version:2});
 assert.equal(await pg.store.updateQuestion(Q,5,{status:'open',updatedAt:'x'}),null);
 assert.equal(await pg.store.scrubUserMessages(U,'2026-10-21T16:00:00.000Z'),3);
 const [old,live]=pg.calls.slice(-2);
 assert.equal(old.query.deleted_at,'not.is.null');assert.deepEqual(old.body,{body:'',author_name:'',author_full:''});
 assert.equal(live.query.deleted_at,'is.null');assert.deepEqual(live.body,{body:'',author_name:'',author_full:'',deleted_at:'2026-10-21T16:00:00.000Z'});
 assert.ok([old,live].every(c=>c.query.user_id===`eq.${U}`));
});
