import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {createDatabase,createUser} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createApp} from '../server/server.js';
import {createMailTransport} from '../server/mailer.js';
import {createNodeRequestStore} from '../server/node-requests-repository.js';
import {createNodeRequestNotice,NODE_REQUEST_RECIPIENTS} from '../server/node-requests-email.js';
import {NODE_REQUEST_LIMITS,limaDayStart,nodeRequestAdminView} from '../server/node-requests-api.js';
import {startFakeSmtp,parseMessage} from './helpers/fake-smtp.js';

const VIEW_KEYS=['createdAt','email','emailStatus','id','language','message','name','organization','phone','status','updatedAt','version'];
const START='2026-11-03T15:00:00.000Z';
let serial=0;
// A valid request with its own address, so the per-email budget (3 a day) never decides a test that is not about it.
const valid=(over={})=>({name:'Ana Quispe',organization:'Colectivo Ciudad Viva',email:`ana${++serial}@colectivo.example`,phone:'+51 999 111 222',
 message:'Queremos activar un Nodo en Arequipa.',language:'pt',...over});
const stored=(n,over={})=>{const createdAt=over.createdAt??'2026-11-03T12:00:00.000Z';return {id:crypto.randomUUID(),name:`Persona ${n}`,organization:`Organización ${n}`,
 email:`p${n}@example.org`,phone:null,message:'Hola',language:'es',status:'new',emailStatus:'sent',createdAt,updatedAt:createdAt,updatedBy:null,version:1,...over};};
// A notifier double: records each request it is handed and answers the outcome it is given (or computes it).
const notifier=(outcome='sent')=>{const calls=[];return Object.assign(async({request})=>{calls.push(request);return typeof outcome==='function'?outcome(request,calls.length):outcome;},{calls});};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// The whole server (createApp) on SQLite, with the clock and the team notifier injected.
async function setup(t,{notice=notifier(),limits,store,start=START}={}){
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const users={},cookies={};
 for(const name of ['member','admin']){users[name]=createUser(db,{fullName:name,email:`${name}@example.test`,passwordHash:'unused',role:name});cookies[name]=createSession(db,users[name].id).cookie.split(';')[0];}
 const clock={at:Date.parse(start)};
 const server=createApp({db,now:()=>clock.at,nodeRequestNotice:notice,...(limits?{nodeRequestLimits:limits}:{}),...(store?{nodeRequestStore:store(db)}:{})});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,{actor='guest',method='GET',body,origin=base,type='application/json'}={})=>fetch(base+path,{method,redirect:'manual',
  headers:{...(cookies[actor]?{Cookie:cookies[actor]}:{}),Origin:origin,'Content-Type':type},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
 const json=async response=>({status:response.status,body:response.status===204?await response.text():await response.json()});
 return {db,clock,users,base,call,json,notice,
  rows:()=>db.prepare('SELECT * FROM node_requests ORDER BY rowid').all(),// in the order they were stored
  seed:async records=>{const own=createNodeRequestStore({db});for(const record of records)await own.insert(record);},
  post:(fields,options={})=>call('/api/node-requests',{method:'POST',body:fields,...options}).then(json),
  list:(query='',actor='admin')=>call(`/api/admin/node-requests${query}`,{actor}).then(json),
  patch:(id,body,actor='admin')=>call(`/api/admin/node-requests/${id}`,{actor,method:'PATCH',body}).then(json),
  remove:(id,actor='admin')=>call(`/api/admin/node-requests/${id}`,{actor,method:'DELETE'}).then(json),
 };
}
const smtpNotice=(smtp,options={})=>createNodeRequestNotice({env:{EMAIL_SMTP_URL:`smtp://127.0.0.1:${smtp.port}`,EMAIL_FROM:'Equipo <equipo@example.org>'},
 origin:'https://nodal.example.org',loopbackOnly:true,log:()=>{},...options});

test('exports the limits, the Lima day and the desk view',()=>{
 assert.deepEqual(NODE_REQUEST_LIMITS,{name:120,organization:160,email:254,phone:40,message:1000,page:24,emailsPerDay:40,retentionMonths:12});
 // Lima is UTC-05:00 all year: its day starts at 05:00 UTC.
 assert.equal(limaDayStart(Date.parse('2026-11-03T04:59:59.999Z')),'2026-11-02T05:00:00.000Z');
 assert.equal(limaDayStart(Date.parse('2026-11-03T05:00:00.000Z')),'2026-11-03T05:00:00.000Z');
 assert.equal(limaDayStart(Date.parse('2026-11-04T03:00:00.000Z')),'2026-11-03T05:00:00.000Z');
 const record=stored(1,{updatedBy:'someone',phone:'+51 1'});
 assert.deepEqual(Object.keys(nodeRequestAdminView(record)).sort(),VIEW_KEYS,'the desk never sees who changed it last');
 assert.equal(nodeRequestAdminView(record).phone,'+51 1');
});

test('accepts a request without an account, stores it and emails the team once',async t=>{
 const smtp=await startFakeSmtp();t.after(smtp.close);
 const {post,call,rows,list,clock}=await setup(t,{notice:smtpNotice(smtp)});
 const request=valid({email:'ana@colectivo.example'});
 const response=await call('/api/node-requests',{method:'POST',body:request});
 assert.equal(response.status,202);assert.deepEqual(await response.json(),{ok:true});
 assert.equal(response.headers.get('set-cookie'),null,'no session is started for a visitor');
 assert.equal(response.headers.get('cache-control'),'no-store');
 const [row]=rows();
 assert.match(row.id,/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[\da-f]{4}-[\da-f]{12}$/);
 assert.deepEqual({...row,id:0},{id:0,name:'Ana Quispe',organization:'Colectivo Ciudad Viva',email:'ana@colectivo.example',phone:'+51 999 111 222',
  message:'Queremos activar un Nodo en Arequipa.',language:'pt',status:'new',email_status:'sent',created_at:new Date(clock.at).toISOString(),updated_at:new Date(clock.at).toISOString(),updated_by:null,version:1});
 assert.equal(smtp.messages.length,2,'one message to each team member');
 const messages=smtp.messages.map(m=>parseMessage(m.data));
 assert.deepEqual(messages.map(m=>m.headers.to).sort(),[...NODE_REQUEST_RECIPIENTS].sort());
 for(const message of messages){assert.equal(message.headers['reply-to'],'"Ana Quispe" <ana@colectivo.example>');assert.equal(message.subject,'Solicitud de Nodo: Colectivo Ciudad Viva');}
 const desk=await list();assert.equal(desk.status,200);
 assert.deepEqual(desk.body,{requests:[{id:row.id,name:'Ana Quispe',organization:'Colectivo Ciudad Viva',email:'ana@colectivo.example',phone:'+51 999 111 222',
  message:'Queremos activar un Nodo en Arequipa.',language:'pt',status:'new',emailStatus:'sent',createdAt:row.created_at,updatedAt:row.updated_at,version:1}],nextCursor:null});
 // A signed-in member is not linked to the request either.
 assert.deepEqual(await post(valid(),{actor:'member'}),{status:202,body:{ok:true}});
 assert.equal(rows()[1].updated_by,null);
});

test('trims fields, stores a blank phone as null and refuses a blank message',async t=>{
 const notice=notifier(),{post,rows}=await setup(t,{notice});
 assert.equal((await post({name:'  Ana  ',organization:'\tColectivo\n',email:'  ANA.Quispe@Colectivo.EXAMPLE ',phone:'   ',message:'  Hola,\nqueremos un Nodo.  \n',language:' en '})).status,202);
 for(const phone of ['+',' + ','',null,undefined])assert.equal((await post(valid({phone}))).status,202,String(phone));
 assert.equal((await post(valid({language:undefined}))).status,202);
 const [first,...others]=rows();
 assert.deepEqual([first.name,first.organization,first.email,first.phone,first.message,first.language],['Ana','Colectivo','ana.quispe@colectivo.example',null,'Hola,\nqueremos un Nodo.','en']);
 assert.deepEqual(others.map(r=>r.phone),[null,null,null,null,null,'+51 999 111 222'],'a phone without a digit is no phone');
 assert.equal(others.at(-1).language,'es','Spanish when the page did not say');
 assert.equal(notice.calls[0].email,'ana.quispe@colectivo.example','the team gets what was stored');
 for(const message of ['   ','\n\t \n',''])assert.deepEqual(await post(valid({message})),{status:400,body:{error:'message is required',field:'message'}},JSON.stringify(message));
 assert.equal(rows().length,7);assert.equal(notice.calls.length,7);
});

test('names the field for each invalid input',async t=>{
 const notice=notifier(),{post,rows}=await setup(t,{notice,limits:{perAddress:1000}});
 const cases=[
  [{name:''},'name'],[{name:'   '},'name'],[{name:'x'.repeat(121)},'name'],[{name:7},'name'],[{name:undefined},'name'],
  [{organization:''},'organization'],[{organization:'x'.repeat(161)},'organization'],[{organization:['Org']},'organization'],[{organization:undefined},'organization'],
  [{email:''},'email'],[{email:'ana'},'email'],[{email:'ana@colectivo'},'email'],[{email:'ana @colectivo.example'},'email'],[{email:`${'x'.repeat(243)}@example.org`},'email'],[{email:5},'email'],[{email:undefined},'email'],
  [{phone:'llámame'},'phone'],[{phone:'999#111'},'phone'],[{phone:'+51\t999'},'phone'],[{phone:'1'.repeat(41)},'phone'],[{phone:51999},'phone'],
  [{message:'x'.repeat(1001)},'message'],[{message:undefined},'message'],[{message:{text:'hola'}},'message'],
  [{language:'fr'},'language'],[{language:'ES'},'language'],[{language:''},'language'],[{language:3},'language'],
 ];
 for(const [input,field] of cases){
  const answer=await post(valid(input));
  assert.equal(answer.status,400,JSON.stringify(input));assert.equal(answer.body.field,field,JSON.stringify(input));assert.equal(typeof answer.body.error,'string');
 }
 assert.equal(rows().length,0);assert.equal(notice.calls.length,0);
 // Every limit is inclusive.
 const longest=valid({name:'n'.repeat(120),organization:'o'.repeat(160),email:`${'x'.repeat(242)}@example.org`,phone:'(01) 234-5678 +'.padEnd(40,'9'),message:'m'.repeat(1000)});
 assert.equal(longest.email.length,254);assert.equal((await post(longest)).status,202);
 assert.equal(rows()[0].phone.length,40);
});

test('answers a filled honeypot like a success and stores nothing',async t=>{
 const notice=notifier(),{post,rows}=await setup(t,{notice});
 const email='bot@spam.example';
 for(const website of ['https://spam.example','x',7,true])assert.deepEqual(await post(valid({email,website})),{status:202,body:{ok:true}},String(website));
 assert.equal(rows().length,0);assert.equal(notice.calls.length,0);
 assert.equal((await post(valid({website:'https://spam.example',email:'not an address'}))).status,400,'the fields are checked first');
 // A trapped request spends no email budget, and an empty trap is a person.
 for(const website of ['','   ',null])assert.equal((await post(valid({email,website}))).status,202);
 assert.equal(rows().length,3);assert.equal(notice.calls.length,3);
});

test('limits requests per address and per email',async t=>{
 const {post,call,rows}=await setup(t);
 const email='ana@colectivo.example';
 for(let n=0;n<3;n++)assert.equal((await post(valid({email}))).status,202);
 const fourth=await call('/api/node-requests',{method:'POST',body:valid({email:'  ANA@Colectivo.example '})});
 assert.equal(fourth.status,429);assert.deepEqual(await fourth.json(),{error:'too many requests'});
 const wait=Number(fourth.headers.get('retry-after'));assert.ok(wait>3600&&wait<=86400,`per day: ${wait}`);
 assert.equal((await post(valid())).status,202,'another address still gets through');
 for(let n=5;n<20;n++)assert.equal((await post(valid())).status,202,`request ${n+1}`);
 // The 21st from one address is refused before its body is read.
 const refused=await call('/api/node-requests',{method:'POST',body:'{'});
 assert.equal(refused.status,429);assert.deepEqual(await refused.json(),{error:'too many requests'});
 const hour=Number(refused.headers.get('retry-after'));assert.ok(hour>0&&hour<=3600,`per hour: ${hour}`);
 assert.equal(rows().length,19);
});

test('stores off and sends nothing past 40 emailed requests in a Lima day',async t=>{
 const logged=t.mock.method(console,'warn',()=>{});
 const notice=notifier(),{post,seed,rows,clock}=await setup(t,{notice,start:'2026-11-03T23:00:00.000Z'});
 // 38 attempted sends since 00:00 in Lima (05:00 UTC), whatever their outcome, and one still in flight (null): with the
 // new request's own row that makes 40. Neither the previous Lima day nor off counts.
 const outcomes=['sent','partial','failed','uncertain'];
 await seed([
  ...Array.from({length:38},(_,n)=>stored(n,{createdAt:'2026-11-03T05:00:00.000Z',emailStatus:outcomes[n%4]})),
  ...Array.from({length:10},(_,n)=>stored(100+n,{createdAt:'2026-11-03T04:59:59.999Z'})), // the previous Lima day, the same UTC day
  stored(200,{emailStatus:'off'}),stored(201,{emailStatus:null}),
 ]);
 const statusOf=async request=>{assert.equal((await post(request)).status,202);return rows().find(r=>r.email===request.email).email_status;};
 assert.equal(await statusOf(valid()),'sent','the 40th of the Lima day is emailed');assert.equal(notice.calls.length,1);
 const over=valid();assert.equal(await statusOf(over),'off','the 41st is stored, not emailed');assert.equal(notice.calls.length,1);
 const line=logged.mock.calls.map(c=>c.arguments.join(' ')).find(l=>/Node request email off/.test(l));
 assert.ok(line,'the ceiling is logged');assert.ok(!line.includes(over.email)&&!line.includes(over.name),line);
 clock.at=Date.parse('2026-11-04T02:00:00.000Z');// a new UTC day, still 3 November in Lima
 assert.equal(await statusOf(valid()),'off');assert.equal(notice.calls.length,1);
 clock.at=Date.parse('2026-11-04T05:00:00.000Z');// midnight in Lima
 assert.equal(await statusOf(valid()),'sent');assert.equal(notice.calls.length,2);
});

test('counts the sends still in flight, so the 41st of a burst is stored off',async t=>{
 t.mock.method(console,'warn',()=>{});
 let release;const gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
 // The first two sends stay in flight (email_status null) until the gate opens, as when instances answer at once.
 const notice=notifier((request,n)=>n<=2?gate.then(()=>'sent'):'sent'),{post,seed,rows}=await setup(t,{notice});
 await seed(Array.from({length:38},(_,n)=>stored(n)));
 const inFlight=async n=>{const answer=post(valid()),started=Date.now();
  while(notice.calls.length<n&&Date.now()-started<5000)await pause(5);assert.equal(notice.calls.length,n);return {answer};};
 const first=await inFlight(1),second=await inFlight(2);// the 39th and the 40th of the Lima day
 assert.deepEqual(rows().slice(38).map(r=>r.email_status),[null,null],'both sends are in flight');
 const last=valid();assert.deepEqual(await post(last),{status:202,body:{ok:true}});
 assert.equal(rows().find(r=>r.email===last.email).email_status,'off','the 41st counts both sends in flight');assert.equal(notice.calls.length,2);
 release();assert.deepEqual([await first.answer,await second.answer],[{status:202,body:{ok:true}},{status:202,body:{ok:true}}]);
 assert.deepEqual(rows().slice(38).map(r=>r.email_status),['sent','sent','off']);
});

test('stores the outcome the notifier reports, and off when email is gated',async t=>{
 const seen=[],context={};
 const outcomes=['partial','failed','uncertain','sent'];
 const notice=notifier((request,n)=>{seen.push(context.db.prepare('SELECT email_status FROM node_requests WHERE id=?').get(request.id)?.email_status);return outcomes[n-1];});
 const app=await setup(t,{notice});context.db=app.db;
 for(let n=0;n<4;n++)assert.equal((await app.post(valid())).status,202);
 assert.deepEqual(app.rows().map(r=>r.email_status),outcomes);
 assert.deepEqual(seen,[null,null,null,null],'each request is stored before the team is emailed');
 assert.deepEqual(Object.keys(notice.calls[0]).sort(),['createdAt','email','emailStatus','id','language','message','name','organization','phone','status','updatedAt','updatedBy','version']);
 // Gated (here a Vercel Preview with mail settings): the notifier factory gives null, and the request is stored as off.
 const logs=[];
 const gated=createNodeRequestNotice({env:{VERCEL:'1',VERCEL_ENV:'preview',EMAIL_SMTP_URL:'smtps://u:p@smtp.example.org',EMAIL_FROM:'a@example.org',PUBLIC_BASE_URL:'https://nodal.example.org'},log:line=>logs.push(line)});
 assert.equal(gated,null);assert.deepEqual(logs,['Node request email is off outside Vercel Production']);
 const off=await setup(t,{notice:gated});assert.equal((await off.post(valid())).status,202);assert.deepEqual(off.rows().map(r=>r.email_status),['off']);
 // An outcome that cannot be written leaves the request stored (email_status null) and is logged, not answered.
 const logged=t.mock.method(console,'warn',()=>{});
 const failing=await setup(t,{store:db=>({...createNodeRequestStore({db}),setEmailStatus:async()=>{throw Object.assign(Error('node request save unavailable'),{status:502,expose:false});}})});
 const request=valid();assert.deepEqual(await failing.post(request),{status:202,body:{ok:true}});
 assert.deepEqual(failing.rows().map(r=>r.email_status),[null]);
 const lines=logged.mock.calls.map(c=>c.arguments.join(' '));
 assert.ok(lines.some(l=>/email status/i.test(l)),lines.join('\n'));assert.ok(lines.every(l=>!l.includes(request.email)&&!l.includes(request.name)));
});

test('waits for both team sends up to the mail timeout, after storing the request, and stores uncertain',async t=>{
 const smtp=await startFakeSmtp({hang:'message'});t.after(smtp.close);
 const timeoutMs=1000,logs=[];
 const transport=createMailTransport({env:{EMAIL_SMTP_URL:`smtp://127.0.0.1:${smtp.port}`,EMAIL_FROM:'Equipo <equipo@example.org>'},timeoutMs});
 const {post,rows}=await setup(t,{notice:smtpNotice(smtp,{transport,log:line=>logs.push(line)})});
 const request=valid(),started=Date.now(),answer=post(request);
 // Both messages are handed over before either send times out: the two sends run in parallel.
 while(smtp.transcript.filter(line=>line==='DATA').length<2&&Date.now()-started<5000)await pause(10);
 assert.equal(smtp.transcript.filter(line=>line==='DATA').length,2);assert.ok(Date.now()-started<timeoutMs,'the second send did not wait for the first');
 assert.deepEqual(rows().map(r=>[r.email,r.email_status]),[[request.email,null]],'stored while the email is still going out');
 assert.deepEqual(await answer,{status:202,body:{ok:true}});
 assert.ok(Date.now()-started<2*timeoutMs,'bounded by one timeout, not two');
 assert.deepEqual(rows().map(r=>r.email_status),['uncertain']);
 assert.equal(logs.length,1);assert.ok(!logs[0].includes(request.email)&&!logs[0].includes(request.name),logs[0]);
});

test('answers 503 and sends nothing when the store refuses the insert',async t=>{
 const logged=t.mock.method(console,'warn',()=>{});
 const refusals=[Object.assign(Error('node request save unavailable'),{status:502,expose:false}),Object.assign(Error('node request already exists'),{status:409}),Error('Failing row contains (ana@colectivo.example)')];
 for(const refusal of refusals){
  const notice=notifier(),app=await setup(t,{notice,store:db=>({...createNodeRequestStore({db}),insert:async()=>{throw refusal;}})});
  const response=await app.call('/api/node-requests',{method:'POST',body:valid({email:'ana@colectivo.example'})});
  assert.equal(response.status,503,refusal.message);assert.deepEqual(await response.json(),{error:'service unavailable'});
  assert.equal(notice.calls.length,0);assert.equal(app.rows().length,0);
 }
 const lines=logged.mock.calls.map(c=>c.arguments.join(' '));
 assert.equal(lines.length,3);assert.ok(lines.every(l=>!l.includes('ana@')&&!l.includes('Ana Quispe')),lines.join('\n'));
});

test('refuses a cross-origin post',async t=>{
 const notice=notifier(),{call,json,post,rows}=await setup(t,{notice});
 assert.deepEqual(await post(valid(),{origin:'https://elsewhere.test'}),{status:403,body:{error:'cross-origin request rejected'}});
 assert.deepEqual(await post(valid(),{origin:'null'}),{status:403,body:{error:'cross-origin request rejected'}});
 assert.equal(rows().length,0);assert.equal(notice.calls.length,0);
 // Only a JSON object of bounded size, by POST.
 for(const method of ['GET','PUT','PATCH','DELETE']){const r=await call('/api/node-requests',{method,body:method==='GET'?undefined:{}});assert.equal(r.status,405,method);assert.equal(r.headers.get('allow'),'POST');}
 assert.equal((await call('/api/node-requests',{method:'POST',body:JSON.stringify(valid()),type:'text/plain'})).status,415);
 assert.equal((await json(await call('/api/node-requests',{method:'POST',body:'['}))).status,400);
 assert.equal((await json(await call('/api/node-requests',{method:'POST',body:'[]'}))).status,400);
 assert.equal((await call('/api/node-requests',{method:'POST',body:valid({message:'x'.repeat(16400)})})).status,413);
 assert.equal((await call('/api/node-requests/extra',{method:'POST',body:valid()})).status,404);
 assert.equal(rows().length,0);
});

test('never resolves a session for the public post',async t=>{
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 let lookups=0;
 const repository={resolveSession(){lookups++;throw new Error('session service stalled');}};
 const notice=notifier();
 const server=createApp({repository,nodeRequestStore:createNodeRequestStore({db}),nodeRequestNotice:notice});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(`${base}/api/node-requests`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:'nodal_session=stale; nodal_refresh=stale'},body:JSON.stringify(valid())});
 assert.equal(response.status,202);assert.deepEqual(await response.json(),{ok:true});
 assert.equal(lookups,0);assert.equal(notice.calls.length,1);
 assert.equal(db.prepare('SELECT count(*) AS n FROM node_requests').get().n,1);
});

test('lists, filters, pages, updates and deletes requests for admins only',async t=>{
 const {call,json,list,patch,remove,seed,rows,clock,users}=await setup(t);
 const statuses=['new','contacted','closed'];
 const records=Array.from({length:30},(_,n)=>stored(n,{createdAt:new Date(Date.UTC(2026,9,1,0,n)).toISOString(),status:statuses[n%3],emailStatus:n===0?'failed':'sent',phone:n===1?'+51 1':null}));
 await seed(records);const newest=[...records].reverse();
 // Access: no account, then a member, for every desk route.
 for(const [path,method,body] of [['/api/admin/node-requests','GET'],[`/api/admin/node-requests/${records[0].id}`,'PATCH',{status:'closed',version:1}],[`/api/admin/node-requests/${records[0].id}`,'DELETE']]){
  assert.deepEqual(await json(await call(path,{method,body})),{status:401,body:{error:'sign in required'}},`${method} guest`);
  assert.deepEqual(await json(await call(path,{actor:'member',method,body})),{status:403,body:{error:'administrator access required'}},`${method} member`);
 }
 assert.equal(rows().filter(r=>r.status==='closed').length,10,'refused writes change nothing');
 // Newest first, 24 a page, every field the desk shows and nothing else.
 const first=await list();assert.equal(first.status,200);
 assert.deepEqual(first.body.requests,newest.slice(0,24).map(nodeRequestAdminView));
 for(const request of first.body.requests)assert.deepEqual(Object.keys(request).sort(),VIEW_KEYS);
 assert.equal(typeof first.body.nextCursor,'string');
 const second=await list(`?cursor=${first.body.nextCursor}`);assert.deepEqual(second.body,{requests:newest.slice(24).map(nodeRequestAdminView),nextCursor:null});
 assert.deepEqual((await list('?limit=5')).body.requests.map(r=>r.id),newest.slice(0,5).map(r=>r.id),'the desk may ask for fewer');
 const head=await call('/api/admin/node-requests',{actor:'admin',method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 const ids=[];let cursor='';do{const page=await list(`?status=closed&limit=3${cursor?`&cursor=${cursor}`:''}`);assert.equal(page.status,200);ids.push(...page.body.requests.map(r=>r.id));cursor=page.body.nextCursor;}while(cursor);
 assert.deepEqual(ids,newest.filter(r=>r.status==='closed').map(r=>r.id));
 // Unknown keys, values, repeats and forged cursors are refused before the store sees them.
 const forged=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 for(const query of ['?status=withdrawn','?status=','?status=new&status=closed','?limit=0','?limit=25','?limit=1.5','?limit=','?cursor=','?cursor=garbage!',
  `?cursor=${forged(['2026-10-01T00:00:00Z,id.gt.0)',records[0].id])}`,`?cursor=${forged(['2026-10-01T00:00:00Z','x'])}`,`?cursor=${forged(['yesterday',records[0].id])}`,'?lang=es','?page=2'])
  assert.equal((await list(query)).status,400,query);
 // Status changes are a compare-and-swap on the version.
 const target=records[2];clock.at=Date.parse('2026-11-05T10:00:00.000Z');
 const updated=await patch(target.id,{status:'new',version:1});assert.equal(updated.status,200);
 assert.deepEqual(updated.body,{request:{...nodeRequestAdminView(target),status:'new',version:2,updatedAt:'2026-11-05T10:00:00.000Z'}});
 assert.equal(rows().find(r=>r.id===target.id).updated_by,users.admin.id,'the desk records who changed it');
 const stale=await patch(target.id,{status:'contacted',version:1});
 assert.deepEqual(stale,{status:409,body:{error:'node request changed; reload before saving',code:'version_conflict',request:updated.body.request}});
 for(const [input,field] of [[{status:'withdrawn',version:2},'status'],[{version:2},'status'],[{status:'closed'},'version'],[{status:'closed',version:'2'},'version'],[{status:'closed',version:0},'version'],[{status:'closed',version:1.5},'version']])
  assert.equal((await patch(target.id,input)).body.field,field,JSON.stringify(input));
 assert.equal(rows().find(r=>r.id===target.id).version,2,'a refused change writes nothing');
 assert.equal((await patch(crypto.randomUUID(),{status:'closed',version:1})).status,404);
 assert.deepEqual(await patch('not-an-id',{status:'closed',version:1}),{status:400,body:{error:'id is invalid',field:'id'}});
 assert.equal((await json(await call(`/api/admin/node-requests/${target.id}`,{actor:'admin',method:'PATCH',body:{status:'closed',version:2},origin:'https://elsewhere.test'}))).status,403);
 assert.equal((await json(await call(`/api/admin/node-requests/${target.id}`,{actor:'admin',method:'DELETE',origin:'https://elsewhere.test'}))).status,403);
 // Deleting is final and idempotent.
 assert.deepEqual(await remove(target.id),{status:204,body:''});
 assert.deepEqual(await remove(target.id),{status:204,body:''},'deleting again is not an error');
 assert.equal(rows().some(r=>r.id===target.id),false);assert.equal((await patch(target.id,{status:'closed',version:2})).status,404);
 assert.equal((await remove('nope')).body.field,'id');
 // Methods and paths the desk does not use.
 const put=await call('/api/admin/node-requests',{actor:'admin',method:'POST',body:{}});assert.equal(put.status,405);assert.equal(put.headers.get('allow'),'GET, HEAD');
 const one=await call(`/api/admin/node-requests/${records[3].id}`,{actor:'admin'});assert.equal(one.status,405);assert.equal(one.headers.get('allow'),'PATCH, DELETE');
 assert.equal((await call('/api/admin/node-requests/a/b',{actor:'admin'})).status,404);
 // Desk writes share a per-account budget.
 let refused=null;for(let n=0;n<31&&!refused;n++){const r=await remove(crypto.randomUUID());if(r.status===429)refused=r;}
 assert.deepEqual(refused,{status:429,body:{error:'too many requests'}});
});

test('purges closed requests older than 12 months when the desk lists or a request arrives',async t=>{
 const {list,post,seed,rows,clock}=await setup(t);
 const cutoff='2025-11-03T15:00:00.000Z';// twelve calendar months before START
 const old=stored(1,{status:'closed',createdAt:'2025-01-01T00:00:00.000Z',updatedAt:'2025-11-03T14:59:59.999Z'});
 const edge=stored(2,{status:'closed',createdAt:'2025-01-01T00:00:00.000Z',updatedAt:cutoff});
 const open=[stored(3,{status:'new',createdAt:'2024-01-01T00:00:00.000Z'}),stored(4,{status:'contacted',createdAt:'2024-01-01T00:00:00.000Z'})];
 await seed([old,edge,...open]);
 const desk=await list();assert.equal(desk.status,200);
 assert.deepEqual(desk.body.requests.map(r=>r.id).sort(),[edge.id,...open.map(r=>r.id)].sort(),'the purge runs before the list is read');
 clock.at=Date.parse('2026-11-03T15:00:00.001Z');
 assert.equal((await post(valid())).status,202);
 const kept=rows();assert.equal(kept.length,3);
 assert.deepEqual(kept.slice(0,-1).map(r=>r.id).sort(),open.map(r=>r.id).sort(),'a new request purges too; open requests stay however old');
 // Best effort: a purge that fails is logged and neither the list nor a new request fails with it.
 const logged=t.mock.method(console,'warn',()=>{});
 const failing=await setup(t,{store:db=>({...createNodeRequestStore({db}),purgeClosedBefore:async()=>{throw Object.assign(Error('node request deletion unavailable'),{status:502,expose:false});}})});
 assert.equal((await failing.list()).status,200);assert.equal((await failing.post(valid())).status,202);assert.equal(failing.rows().length,1);
 assert.equal(logged.mock.calls.filter(c=>/purge/i.test(c.arguments.join(' '))).length,2);
});

test('README names every node-request endpoint',()=>{
 const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8');
 for(const endpoint of ['POST /api/node-requests','GET /api/admin/node-requests','PATCH|DELETE /api/admin/node-requests/:id'])assert.ok(readme.includes(endpoint),endpoint);
});

test('DEPLOYMENT.md applies the node_requests migration before main, outside the Founder sections tests read',()=>{
 const deployment=readFileSync(new URL('../DEPLOYMENT.md',import.meta.url),'utf8');
 const start=deployment.indexOf('## Organisation node requests: one migration before `main`');assert.ok(start>0);
 const end=deployment.indexOf('\n## ',start+1),step=deployment.slice(start,end);
 for(const [from,to] of [['## Founder Membership acceptances','## Founder badge'],['## Founder badge','## Supabase Setup']]){
  const a=deployment.indexOf(from),b=deployment.indexOf(to);assert.ok(start<a||start>=b,`outside ${from}`);
 }
 assert.ok(step.includes('npx --no-install supabase db query --linked -f supabase/migrations/20261103000000_node_requests.sql'));
 assert.ok(step.includes('npx --no-install supabase migration repair --status applied 20261103000000'));
 assert.match(step,/before pushing `main`/);assert.ok(step.includes('/api/node-requests')&&step.includes('/api/admin/node-requests'));
});
