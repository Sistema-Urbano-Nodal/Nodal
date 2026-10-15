import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {createDatabase,createUser} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createApp} from '../server/server.js';
import {createRepository} from '../server/repository.js';
import {createFiiuStore} from '../server/fiiu-repository.js';
import {createTalkStore} from '../server/fiiu-talk-repository.js';
import {createTalkApi,exportTalkData,deleteTalkData} from '../server/fiiu-talk-api.js';
import {FIIU_EVENT} from '../server/fiiu-domain.js';

const answers={firstName:'Ana',lastName:'Test',country:'Perú',city:'Lima',profile:'professional',publicOfficial:false,activities:['day1-am'],externalActivities:[],nationalId:'TEST-ID',gender:'prefer_not',age:30,accessibility:['none'],motivation:'learn',previousAttendance:'no',privacyAccepted:true};
const jpeg=Buffer.from([255,216,255,224,...Array(60).fill(0)]).toString('base64');
const thumb=Buffer.from([255,216,255,224,7,7,7]).toString('base64');
const pdf=Buffer.from('%PDF-1.4 festival notes').toString('base64');
const PULSE_CACHE='public, max-age=0, s-maxage=2, stale-while-revalidate=4';

// member (Ana Test) and other (Ben Otro) register; admin organises without a registration; stranger is signed in but
// not registered; guest has no session at all.
async function setup(t,{app={},wrapTalk=store=>store}={}){
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const cookies={},users={};
 const names={member:'Ana Test',other:'Ben Otro',admin:'Flavia  Ramírez Soto',stranger:'Sin Registro'};
 for(const name of Object.keys(names)){users[name]=createUser(db,{fullName:names[name],email:`${name}@example.test`,passwordHash:'unused',role:name==='admin'?'admin':'member'});cookies[name]=createSession(db,users[name].id).cookie.split(';')[0];}
 const talkStore=wrapTalk(createTalkStore({db}));
 const server=createApp({db,fiiuStore:createFiiuStore({db}),talkStore,fiiuConfirmation:null,...app});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,{actor='member',method='GET',body,headers={}}={})=>fetch(base+path,{method,redirect:'manual',headers:{...(cookies[actor]?{Cookie:cookies[actor]}:{}),Origin:base,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const json=async(path,options)=>{const r=await call(path,options);return {status:r.status,headers:r.headers,body:await r.json()};};
 for(const [actor,firstName,lastName] of [['member','Ana','Test'],['other','Ben','Otro']])assert.equal((await call('/api/fiiu/registration',{actor,method:'PUT',body:{version:0,...answers,firstName,lastName}})).status,200);
 const ask=async(extra={})=>{const r=await json('/api/admin/fiiu/questions',{actor:'admin',method:'POST',body:{activityId:'day1-am',body:'¿Qué te llevas?',status:'open',...extra}});assert.equal(r.status,201);return r.body.question;};
 const post=(q,body,{actor='member',clientId=randomUUID(),fileIds}={})=>json(`/api/fiiu/questions/${q.id}/messages`,{actor,method:'POST',body:{clientId,body,...(fileIds?{fileIds}:{})}});
 const upload=(file={},actor='member')=>json('/api/fiiu/files',{actor,method:'POST',body:{name:'photo.jpg',mime:'image/jpeg',data:jpeg,width:1600,height:900,...file}});
 const pulse=async()=>(await json('/api/fiiu/pulse',{actor:'guest'})).body.questions;
 const close=async q=>{const current=(await json('/api/admin/fiiu/questions',{actor:'admin'})).body.questions.find(x=>x.id===q.id);const r=await json(`/api/admin/fiiu/questions/${q.id}`,{actor:'admin',method:'PATCH',body:{version:current.version,status:'closed'}});assert.equal(r.status,200);return r.body.question;};
 return {db,talkStore,users,cookies,base,call,json,ask,post,upload,pulse,close};
}

test('the pulse is public, cacheable and cookie-free while conversations need a festival registration or an organiser',async t=>{
 const {call,json,base}=await setup(t);
 for(const actor of ['guest','member']){
  const pulse=await call('/api/fiiu/pulse',{actor});
  assert.equal(pulse.status,200,actor);assert.equal(pulse.headers.get('cache-control'),PULSE_CACHE);assert.equal(pulse.headers.get('set-cookie'),null,'the session is never read, so it is never refreshed');
  assert.deepEqual(await pulse.json(),{questions:[]});
 }
 // A stale session cookie would normally be cleared; the pulse does not even look at it.
 assert.equal((await fetch(`${base}/api/fiiu/pulse`,{headers:{Cookie:'nodal_session=expired'}})).headers.get('set-cookie'),null);
 const head=await call('/api/fiiu/pulse',{actor:'guest',method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('cache-control'),PULSE_CACHE);assert.equal(await head.text(),'');
 const refused=await call('/api/fiiu/pulse',{actor:'admin',method:'POST',body:{}});assert.equal(refused.status,405);assert.equal(refused.headers.get('allow'),'GET, HEAD');
 assert.equal((await call('/api/fiiu/questions?activityId=day1-am',{actor:'guest'})).status,401);
 const stranger=await json('/api/fiiu/questions?activityId=day1-am',{actor:'stranger'});
 assert.equal(stranger.status,403);assert.deepEqual(stranger.body,{error:'festival registration required',code:'not_registered'});
 const member=await json('/api/fiiu/questions?activityId=day1-am');assert.equal(member.status,200);
 assert.equal(member.body.activity.id,'day1-am');assert.equal(member.body.activity.title,'El poder de lo local');assert.deepEqual(member.body.questions,[]);
 assert.equal((await json('/api/fiiu/questions?activityId=day1-am',{actor:'admin'})).status,200,'organisers need no registration');
 for(const activityId of ['nope','workshop-day1','']){const r=await json(`/api/fiiu/questions?activityId=${activityId}`);assert.equal(r.status,400,activityId);assert.equal(r.body.code,'invalid_activity');}
 assert.equal((await call('/api/admin/fiiu/questions')).status,403);
 assert.equal((await call('/api/admin/fiiu/questions',{actor:'guest'})).status,401);
 assert.equal((await call('/api/admin/fiiu/questions',{actor:'admin',method:'POST',body:{activityId:'day1-am',body:'x',status:'open'},headers:{Origin:'https://evil.example'}})).status,403);
 // Other festival routes are still answered by the FIIU API.
 assert.equal((await call('/api/fiiu/registration')).status,200);
 assert.equal((await call('/api/fiiu/questions/not-a-route/at-all')).status,404);
});

test('old conversation links, and loose spellings of the session page typed by hand, redirect to the session page with the query kept',async t=>{
 const {call}=await setup(t),q=randomUUID();
 const loose=[['/fiiu-talk.html?a=day1-am','/fiiu-session.html?a=day1-am'],['/fiiu-talk.html?q='+q,'/fiiu-session.html?q='+q],['/fiiu-talk.html?q='+q+'&present=1','/fiiu-session.html?q='+q+'&present=1'],
  ['/fiiu-talk?a=day1-am','/fiiu-session.html?a=day1-am'],['/fiiu-talk.htm?a=general','/fiiu-session.html?a=general'],['/fiiu-talk.html/?a=general','/fiiu-session.html?a=general'],
  ['/Fiiu-talk.html?a=general','/fiiu-session.html?a=general'],['/FIIU-TALK.HTML?a=day2-am','/fiiu-session.html?a=day2-am'],['/fiiu-talk/','/fiiu-session.html'],['/fiiu-talk.html','/fiiu-session.html'],
  // The projector's typed address now names the session page, so its loose spellings are forgiven too.
  ['/fiiu-session?a=day1-am','/fiiu-session.html?a=day1-am'],['/Fiiu-Session.html?a=general','/fiiu-session.html?a=general'],['/fiiu-session.html/?a=general','/fiiu-session.html?a=general'],['/fiiu-session.htm','/fiiu-session.html']];
 for(const [path,location] of loose)for(const actor of ['guest','member']){
  const response=await call(path,{actor});assert.equal(response.status,302,`${path} ${actor}`);assert.equal(response.headers.get('location'),location,path);assert.equal(response.headers.get('cache-control'),'no-store');
 }
 const head=await call('/fiiu-talk?a=day1-am',{actor:'guest',method:'HEAD'});assert.equal(head.status,302);assert.equal(head.headers.get('location'),'/fiiu-session.html?a=day1-am');
 assert.equal((await call('/fiiu-talk.html?a=day1-am',{method:'POST',body:{}})).status,405,'only page loads are redirected');
 for(const path of ['/fiiu-talks','/fiiu-talk.js.html','/fiiu-sessions','/fiiu-session.js.html'])assert.equal((await call(path,{actor:'guest'})).status,404,path);
});

test('the General space takes questions and chat like a block, for registered people and organisers only',async t=>{
 const {json,call,ask,post,pulse}=await setup(t);
 const general={id:'general',period:'general',title:'FIIU General',date:null,time:'',venue:'',sessions:[],registration:'general-space'};
 const q=await ask({activityId:'general',body:'¿Qué te ha gustado del festival?'});
 assert.equal(q.activityId,'general');assert.equal(q.talk,null);
 const talk=await json('/api/admin/fiiu/questions',{actor:'admin',method:'POST',body:{activityId:'general',talk:'¡Bienvenidos al FIIU 11!',body:'x',status:'open'}});
 assert.equal(talk.status,400);assert.equal(talk.body.code,'invalid_talk','General has no talks');
 for(const actor of ['member','admin']){
  const list=await json('/api/fiiu/questions?activityId=general',{actor});
  assert.equal(list.status,200,actor);assert.deepEqual(list.body.activity,general);assert.deepEqual(list.body.questions.map(x=>x.id),[q.id]);
 }
 const stranger=await json('/api/fiiu/questions?activityId=general',{actor:'stranger'});
 assert.equal(stranger.status,403);assert.deepEqual(stranger.body,{error:'festival registration required',code:'not_registered'});
 assert.equal((await call('/api/fiiu/questions?activityId=general',{actor:'guest'})).status,401);
 assert.deepEqual((await json('/api/fiiu/questions?activityId=day1-am')).body.questions,[],'General questions stay out of the blocks');
 assert.deepEqual(await pulse(),[[q.id,'general',0,'open']]);
 const sent=await post(q,'¡Todo!');assert.equal(sent.status,201);
 const page=await json(`/api/fiiu/questions/${q.id}`,{actor:'other'});
 assert.equal(page.status,200);assert.deepEqual(page.body.activity,general);assert.deepEqual(page.body.messages.map(m=>m.body),['¡Todo!']);
 const lines=(await (await call(`/api/admin/fiiu/questions/${q.id}/export`,{actor:'admin'})).text()).replace(/^﻿/,'').split('\r\n');
 assert.match(lines[1],/^"¿Qué te ha gustado del festival\?","FIIU General","",/);
});

test('conversation block views and talks follow the programme the server serves',async()=>{
 const edited={...FIIU_EVENT,activities:FIIU_EVENT.activities.map(a=>a.id==='day1-am'?{...a,title:'Lo local, editado',venue:'Otra sala',sessions:[['09:00–10:00','Bienvenida renombrada']]}:a)};
 let reads=0;const sent=[],inserted=[];
 const programme={event:async()=>{reads++;return edited;}};
 const q={id:'22222222-2222-4222-8222-222222222222',eventId:'fiiu-2026',activityId:'day1-am',talk:null,body:'¿Qué?',status:'open',revision:0,messageCount:0,version:1,createdAt:'2026-10-21T14:00:00.000Z'};
 const store={listQuestions:async()=>[q],getQuestion:async()=>q,latestMessages:async()=>({rows:[],more:false}),insertQuestion:async record=>{inserted.push(record);return {...q,...record,revision:0,messageCount:0,version:1};}};
 const api=createTalkApi({store,programme,sameOrigin:()=>true,send:(res,status,body)=>sent.push({status,body})});
 const admin={id:'11111111-1111-4111-8111-111111111111',permission:'admin'};
 const run=(method,path,body)=>api({req:Object.assign(Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]),{method,headers:{'content-type':'application/json'}}),res:{},url:new URL(`http://x${path}`),user:admin});
 await run('GET','/api/fiiu/questions?activityId=day1-am');
 assert.equal(sent.at(-1).body.activity.title,'Lo local, editado');assert.equal(sent.at(-1).body.activity.venue,'Otra sala');
 await run('GET',`/api/fiiu/questions/${q.id}`);assert.equal(sent.at(-1).body.activity.title,'Lo local, editado');
 await run('POST','/api/admin/fiiu/questions',{activityId:'day1-am',talk:'Bienvenida renombrada',body:'x',status:'open'});
 assert.equal(sent.at(-1).status,201);assert.equal(inserted[0].talk,'Bienvenida renombrada','a talk is checked against the edited sessions');
 await run('POST','/api/admin/fiiu/questions',{activityId:'day1-am',talk:'¡Bienvenidos al FIIU 11!',body:'x',status:'open'});
 assert.deepEqual([sent.at(-1).status,sent.at(-1).body.code],[400,'invalid_talk']);
 assert.equal(reads,4);
 // Edits that cannot be read never stop a conversation: the built-in programme serves, and the failure is logged.
 const logged=[],down=createTalkApi({store,programme:{event:async()=>{throw Error('programme table unavailable');}},sameOrigin:()=>true,send:(res,status,body)=>sent.push({status,body}),log:(...args)=>logged.push(args)});
 await down({req:{method:'GET',headers:{}},res:{},url:new URL('http://x/api/fiiu/questions?activityId=day1-am'),user:admin});
 assert.equal(sent.at(-1).status,200);assert.equal(sent.at(-1).body.activity.title,'El poder de lo local');
 assert.deepEqual(logged,[['festival programme unavailable:','programme table unavailable']]);
});

test('rating questions are created with their type, which never changes, and every list and sync carries their totals',async t=>{
 const {json,ask}=await setup(t);
 const zeros=Array(10).fill(0);
 const chat=await ask();assert.equal(chat.kind,'chat');assert.equal('ratingCounts' in chat,false);
 const rating=await ask({activityId:'general',body:'Del 1 al 10, ¿cuánto te sirvió el festival?',kind:'rating'});
 assert.equal(rating.kind,'rating');assert.deepEqual(rating.ratingCounts,zeros);
 const bad=await json('/api/admin/fiiu/questions',{actor:'admin',method:'POST',body:{activityId:'day1-am',body:'x',status:'open',kind:'poll'}});
 assert.deepEqual([bad.status,bad.body.code],[400,'invalid_kind']);
 const locked=await json(`/api/admin/fiiu/questions/${rating.id}`,{actor:'admin',method:'PATCH',body:{version:1,kind:'chat'}});
 assert.deepEqual([locked.status,locked.body.code],[400,'kind_locked']);
 assert.equal((await json(`/api/admin/fiiu/questions/${chat.id}`,{actor:'admin',method:'PATCH',body:{version:1,kind:'rating'}})).body.code,'kind_locked');
 const participants=(await json('/api/fiiu/questions?activityId=general')).body.questions;
 assert.deepEqual(participants.map(q=>[q.kind,q.ratingCounts]),[['rating',zeros]]);
 const since=await json(`/api/fiiu/questions/${rating.id}/messages?since=0`,{actor:'other'});
 assert.equal(since.body.question.kind,'rating');assert.deepEqual(since.body.question.ratingCounts,zeros);
 assert.equal((await json(`/api/fiiu/questions/${chat.id}/messages?since=0`,{actor:'other'})).body.question.kind,'chat');
 const edited=await json(`/api/admin/fiiu/questions/${rating.id}`,{actor:'admin',method:'PATCH',body:{version:1,body:'Del 1 al 10, ¿cuánto te sirvió?',status:'closed',kind:'rating'}});
 assert.equal(edited.status,200);assert.deepEqual([edited.body.question.kind,edited.body.question.status,edited.body.question.body],['rating','closed','Del 1 al 10, ¿cuánto te sirvió?']);
 assert.deepEqual(edited.body.question.ratingCounts,zeros);
 const list=(await json('/api/admin/fiiu/questions',{actor:'admin'})).body.questions;
 // Both were created in the same millisecond, so the list's order between them falls to their random ids: compare as a set.
 assert.deepEqual(list.map(q=>[q.id,q.kind,q.ratingCounts??null]).sort((a,b)=>a[0]<b[0]?-1:1),[[chat.id,'chat',null],[rating.id,'rating',zeros]].sort((a,b)=>a[0]<b[0]?-1:1));
 // A retried save is the same question only with the same type.
 const draft={id:randomUUID(),activityId:'general',body:'¿Del 1 al 10?',status:'hidden',kind:'rating'};
 assert.equal((await json('/api/admin/fiiu/questions',{actor:'admin',method:'POST',body:draft})).status,201);
 assert.equal((await json('/api/admin/fiiu/questions',{actor:'admin',method:'POST',body:draft})).status,200);
 const other=await json('/api/admin/fiiu/questions',{actor:'admin',method:'POST',body:{...draft,kind:'chat'}});
 assert.equal(other.status,409);assert.equal(other.body.question.kind,'rating');
});

const counts=(...pairs)=>{const c=Array(10).fill(0);for(const [score,n] of pairs)c[score-1]=n;return c;};
test('registered people and organisers rate a 1–10 question, change it while open, and get the totals and only their own score back',async t=>{
 const {json,ask,pulse}=await setup(t);
 const q=await ask({activityId:'general',body:'Del 1 al 10, ¿cuánto te sirvió?',kind:'rating'});
 const rate=(score,actor='member')=>json(`/api/fiiu/questions/${q.id}/rating`,{actor,method:'PUT',body:{score}});
 const read=(actor='member')=>json(`/api/fiiu/questions/${q.id}`,{actor});
 assert.equal((await read()).body.me.score,null,'not rated yet');
 const first=await rate(8);
 assert.equal(first.status,200);assert.deepEqual(first.body,{score:8,ratingCounts:counts([8,1]),revision:1});
 assert.deepEqual((await rate(8)).body,{score:8,ratingCounts:counts([8,1]),revision:1},'the same score again changes nothing');
 assert.equal((await read()).body.me.score,8);
 const changed=await rate(3);assert.deepEqual(changed.body.ratingCounts,counts([3,1]));assert.ok(changed.body.revision>1,'a change moves the revision');
 assert.deepEqual((await rate(3,'other')).body.ratingCounts,counts([3,2]),'a second person adds to the totals');
 const mine=await read();assert.equal(mine.body.me.score,3);assert.deepEqual(mine.body.question.ratingCounts,counts([3,2]));
 const organiser=await read('admin');assert.equal(organiser.body.me.score,null);assert.deepEqual(organiser.body.question.ratingCounts,counts([3,2]));
 const staff=await rate(10,'admin');assert.equal(staff.status,200,'organisers may rate');assert.deepEqual(staff.body.ratingCounts,counts([3,2],[10,1]));
 assert.equal((await read('admin')).body.me.score,10);
 const since=await json(`/api/fiiu/questions/${q.id}/messages?since=0`,{actor:'other'});
 assert.deepEqual(since.body.question.ratingCounts,counts([3,2],[10,1]),'since answers carry the totals');assert.equal(since.body.question.revision,staff.body.revision);
 assert.deepEqual(await pulse(),[[q.id,'general',staff.body.revision,'open']],'the pulse moved with them');
 const chat=await ask();assert.equal('score' in (await json(`/api/fiiu/questions/${chat.id}`)).body.me,false,'a conversation has no score');
});

test('a rating is refused, moving no total, without a registration, on a conversation, closed or hidden, or out of 1–10',async t=>{
 const {json,ask,close}=await setup(t);
 const q=await ask({kind:'rating'}),chat=await ask();
 const rate=(body,{actor='member',id=q.id,headers}={})=>json(`/api/fiiu/questions/${id}/rating`,{actor,method:'PUT',body,headers});
 const refused=async(answer,status,code,why)=>{const r=await answer;assert.deepEqual([r.status,r.body.code],[status,code],why);};
 assert.equal((await rate({score:5},{actor:'other'})).status,200);
 const totals=async()=>{const {question}=(await json(`/api/fiiu/questions/${q.id}`,{actor:'admin'})).body;return [question.ratingCounts,question.revision];};
 const baseline=await totals();
 await refused(rate({score:5},{actor:'stranger'}),403,'not_registered','no registration');
 await refused(rate({score:5},{id:chat.id}),400,'not_rating','a conversation');
 for(const body of [{score:0},{score:11},{score:'8'},{score:8.5},{score:null},{score:-3},{}])await refused(rate(body),400,'invalid_score',JSON.stringify(body));
 await refused(rate({score:5},{id:randomUUID()}),404,'question_unavailable','no such question');
 assert.equal((await rate({score:5},{actor:'guest'})).status,401);
 assert.equal((await rate({score:5},{headers:{Origin:'https://evil.example'}})).status,403,'cross-origin');
 assert.deepEqual(await totals(),baseline,'nothing moved');assert.equal((await json(`/api/fiiu/questions/${q.id}`)).body.me.score,null);
 const closed=await close(q);
 await refused(rate({score:5}),409,'question_closed','closed');
 assert.equal((await json(`/api/admin/fiiu/questions/${q.id}`,{actor:'admin',method:'PATCH',body:{version:closed.version,status:'hidden'}})).status,200);
 await refused(rate({score:5}),404,'question_unavailable','a hidden question is no question to participants');
 await refused(rate({score:5},{actor:'admin'}),409,'question_closed','organisers see it, but it takes no scores');
 assert.deepEqual((await totals())[0],baseline[0]);
});

test('ratings spend the like budget',async t=>{
 const {json,ask}=await setup(t,{app:{talkLimits:{like:2}}});
 const q=await ask({kind:'rating'}),rate=score=>json(`/api/fiiu/questions/${q.id}/rating`,{method:'PUT',body:{score}});
 assert.equal((await rate(4)).status,200);assert.equal((await rate(5)).status,200);
 const limited=await rate(6);assert.equal(limited.status,429);assert.ok(limited.headers.get('retry-after'));
 assert.equal((await json(`/api/fiiu/questions/${q.id}`)).body.me.score,5);
});

test('no answer says who gave which score: totals for everyone and to each person only their own',async t=>{
 const {json,call,ask,post,users}=await setup(t);
 const q=await ask({activityId:'general',kind:'rating'});
 for(const [actor,score] of [['member',9],['other',2],['admin',7]])assert.equal((await json(`/api/fiiu/questions/${q.id}/rating`,{actor,method:'PUT',body:{score}})).status,200);
 await post(q,'Me encantó');
 const scores=(value,path='')=>value&&typeof value==='object'?Object.entries(value).flatMap(([k,v])=>[...(k==='score'?[path+k]:[]),...scores(v,`${path}${k}.`)]):[];
 const ids=Object.values(users).map(u=>u.id);
 const answers=[];
 for(const actor of ['member','other','admin']){
  const page=await json(`/api/fiiu/questions/${q.id}`,{actor});answers.push(page.body);
  assert.equal(page.body.me.score,{member:9,other:2,admin:7}[actor],actor);assert.deepEqual(scores(page.body),['me.score'],`${actor}: only their own score`);
  for(const path of [`/api/fiiu/questions/${q.id}/messages?since=0`,'/api/fiiu/questions?activityId=general'])answers.push((await json(path,{actor})).body);
 }
 answers.push((await json('/api/admin/fiiu/questions',{actor:'admin'})).body,(await json('/api/fiiu/pulse',{actor:'guest'})).body);
 for(const body of answers)if(!body.me)assert.deepEqual(scores(body),[],JSON.stringify(body).slice(0,120));
 for(const body of answers)for(const id of ids)assert.doesNotMatch(JSON.stringify(body),new RegExp(id));
 const csv=await (await call(`/api/admin/fiiu/questions/${q.id}/export`,{actor:'admin'})).text();
 assert.equal(csv.replace(/^﻿/,'').split('\r\n')[0],'"question","block","talk","createdAtLima","author","email","organiser","text","files","likes","hidden","deleted"','no score column');
 for(const id of ids)assert.doesNotMatch(csv,new RegExp(id));
});

test('the account export lists the person\'s own scores, and deleting the account takes them out of the totals',async t=>{
 const {db,json,call,ask,users}=await setup(t);
 const q=await ask({activityId:'general',body:'Del 1 al 10, ¿cuánto te sirvió?',kind:'rating'});
 const rate=(actor,score)=>json(`/api/fiiu/questions/${q.id}/rating`,{actor,method:'PUT',body:{score}});
 await rate('member',9);await rate('other',2);
 const {ratings}=(await json('/api/me/export')).body.data.fiiuConversations;
 assert.deepEqual(ratings,[{questionId:q.id,question:'Del 1 al 10, ¿cuánto te sirvió?',score:9,createdAt:ratings[0].createdAt,updatedAt:ratings[0].updatedAt}]);
 assert.match(ratings[0].createdAt,/^\d{4}-\d\d-\d\dT/);
 const baseline=(await json(`/api/fiiu/questions/${q.id}`,{actor:'admin'})).body.question.revision;
 assert.equal((await call('/api/me',{method:'DELETE',body:{confirmEmail:'member@example.test'}})).status,200);
 const after=(await json(`/api/fiiu/questions/${q.id}`,{actor:'admin'})).body.question;
 assert.deepEqual(after.ratingCounts,counts([2,1]));assert.ok(after.revision>baseline,'phones learn the totals changed');
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_ratings WHERE user_id=?').get(users.member.id).n,0);
});

test('organisers create, retry, hide, close and edit questions with versions',async t=>{
 const {json,ask,pulse}=await setup(t);
 const open=await ask({talk:'¡Bienvenidos al FIIU 11!'});
 assert.equal(open.revision,0);assert.equal(open.version,1);assert.equal(open.talk,'¡Bienvenidos al FIIU 11!');assert.equal(open.messageCount,0);
 const draft={id:randomUUID(),activityId:'day1-am',body:'Pregunta preparada',status:'hidden'};
 const created=await json('/api/admin/fiiu/questions',{actor:'admin',method:'POST',body:draft});assert.equal(created.status,201);assert.equal(created.body.question.id,draft.id);
 const retry=await json('/api/admin/fiiu/questions',{actor:'admin',method:'POST',body:draft});assert.equal(retry.status,200);assert.equal(retry.body.question.id,draft.id);
 const changed=await json('/api/admin/fiiu/questions',{actor:'admin',method:'POST',body:{...draft,body:'Otra pregunta'}});
 assert.equal(changed.status,409);assert.equal(changed.body.question.body,'Pregunta preparada');
 for(const bad of [{activityId:'workshop-day1',body:'x'},{activityId:'day1-am',talk:'Otra charla',body:'x'},{activityId:'day1-am',body:'x',status:'closed'},{activityId:'day1-am',body:''}]){
  assert.equal((await json('/api/admin/fiiu/questions',{actor:'admin',method:'POST',body:bad})).status,400,JSON.stringify(bad));
 }
 assert.deepEqual(await pulse(),[[open.id,'day1-am',0,'open']],'hidden questions never reach the public pulse');
 assert.deepEqual((await json('/api/fiiu/questions?activityId=day1-am')).body.questions.map(q=>q.id),[open.id]);
 assert.equal((await json('/api/fiiu/questions?activityId=day1-am')).body.questions[0].version,undefined,'participants get no version');
 assert.deepEqual((await json('/api/fiiu/questions?activityId=day1-am',{actor:'admin'})).body.questions.map(q=>q.id).sort(),[open.id,draft.id].sort());
 const hidden=await json(`/api/fiiu/questions/${draft.id}`);assert.equal(hidden.status,404);assert.equal(hidden.body.code,'question_unavailable');
 assert.equal((await json(`/api/fiiu/questions/${randomUUID()}`)).status,404);
 const preview=await json(`/api/fiiu/questions/${draft.id}`,{actor:'admin'});assert.equal(preview.status,200);assert.deepEqual(preview.body.me,{draftKey:preview.body.me.draftKey,organiser:true,canPost:false});assert.match(preview.body.me.draftKey,/^[\w-]{16}$/);
 const list=await json('/api/admin/fiiu/questions',{actor:'admin'});
 assert.equal(list.status,200);assert.deepEqual(list.body.questions.find(q=>q.id===open.id).stats,{messages:0,people:0,likes:0});
 const closed=await json(`/api/admin/fiiu/questions/${open.id}`,{actor:'admin',method:'PATCH',body:{version:1,status:'closed'}});
 assert.equal(closed.status,200);assert.equal(closed.body.question.status,'closed');assert.equal(closed.body.question.version,2);assert.equal(closed.body.question.revision,1);
 assert.deepEqual(await pulse(),[[open.id,'day1-am',1,'closed']]);
 const stale=await json(`/api/admin/fiiu/questions/${open.id}`,{actor:'admin',method:'PATCH',body:{version:1,body:'Editada'}});
 assert.equal(stale.status,409);assert.equal(stale.body.question.version,2);assert.equal(stale.body.question.body,'¿Qué te llevas?');
 const edited=await json(`/api/admin/fiiu/questions/${open.id}`,{actor:'admin',method:'PATCH',body:{version:2,body:'¿Qué te llevas hoy?',talk:null}});
 assert.equal(edited.status,200);assert.equal(edited.body.question.body,'¿Qué te llevas hoy?');assert.equal(edited.body.question.talk,null);assert.equal(edited.body.question.status,'closed');
 assert.equal((await json(`/api/admin/fiiu/questions/${open.id}`,{actor:'admin',method:'PATCH',body:{version:3,activityId:'day2-am'}})).status,400,'the block cannot change');
 assert.equal((await json(`/api/admin/fiiu/questions/${randomUUID()}`,{actor:'admin',method:'PATCH',body:{version:1,status:'open'}})).status,404);
});

test('participants post with idempotent retries, see display names only, and sync changes since a revision',async t=>{
 const {json,ask,post,pulse,talkStore,users}=await setup(t);
 const q=await ask();
 const clientId=randomUUID();
 const first=await post(q,'  Hola a todos  ',{clientId});
 assert.equal(first.status,201);
 assert.deepEqual(first.body.message,{id:first.body.message.id,author:'Ana T.',organiser:false,mine:true,body:'Hola a todos',files:[],likeCount:0,liked:false,createdAt:first.body.message.createdAt,seq:1});
 const again=await post(q,'Hola a todos',{clientId});assert.equal(again.status,200,'an identical retry is the same message');assert.equal(again.body.message.id,first.body.message.id);
 const reused=await post(q,'Otro texto',{clientId});assert.equal(reused.status,409);assert.equal(reused.body.code,'client_id_reused');
 assert.equal((await post(q,'   ')).body.code,'empty_message');
 assert.equal((await post(q,'x'.repeat(1001))).body.code,'message_too_long');
 const seen=await json(`/api/fiiu/questions/${q.id}`,{actor:'other'});
 assert.equal(seen.status,200);assert.equal(seen.body.revision,1);assert.deepEqual(seen.body.me,{draftKey:seen.body.me.draftKey,organiser:false,canPost:true});
 assert.equal(seen.body.question.messageCount,1);assert.equal(seen.body.activity.id,'day1-am');assert.equal(seen.body.before,null);
 const [view]=seen.body.messages;assert.equal(view.author,'Ana T.');assert.equal(view.mine,false);
 assert.equal('userId' in view,false);assert.equal('authorFull' in view,false);assert.doesNotMatch(JSON.stringify(seen.body),new RegExp(users.member.id));
 // Each viewer gets their own stable name for drafts kept in the tab; it is not their id.
 const seenAgain=await json(`/api/fiiu/questions/${q.id}`,{actor:'other'}),author=await json(`/api/fiiu/questions/${q.id}`);
 assert.equal(seenAgain.body.me.draftKey,seen.body.me.draftKey);assert.notEqual(author.body.me.draftKey,seen.body.me.draftKey);
 assert.doesNotMatch(JSON.stringify(author.body),new RegExp(users.member.id),'nor the reader’s own id');
 const second=await post(q,'Respuesta',{actor:'other'});assert.equal(second.status,201);assert.equal(second.body.message.author,'Ben O.');
 const since=await json(`/api/fiiu/questions/${q.id}/messages?since=1`);
 assert.equal(since.status,200);assert.deepEqual(since.body.changes.map(c=>c.id),[second.body.message.id]);assert.equal(since.body.liked,undefined);
 assert.equal(since.body.revision,(await pulse()).find(([id])=>id===q.id)[2],'the pulse publishes the same revision');
 assert.deepEqual((await json(`/api/fiiu/questions/${q.id}/messages?since=${since.body.revision}`)).body.changes,[]);
 assert.equal((await json(`/api/fiiu/questions/${q.id}/messages?since=99`)).body.reset,true,'a revision from the future reloads');
 for(const bad of ['since=-1','since=abc','before=%%%','']){assert.equal((await json(`/api/fiiu/questions/${q.id}/messages?${bad}`)).status,400,bad);}
 const organiser=await json(`/api/fiiu/questions/${q.id}`,{actor:'admin'});
 assert.equal(organiser.body.messages[0].authorFull,'Ana Test');assert.equal(organiser.body.messages[0].hidden,false);assert.equal(organiser.body.me.organiser,true);
 const staff=await post(q,'Gracias por participar',{actor:'admin'});assert.equal(staff.status,201);
 assert.equal(staff.body.message.organiser,true);assert.equal(staff.body.message.author,'Flavia S.','an organiser without a registration is named from the profile');
 // More than 200 changes since a revision ask the page to reload; the first page holds the latest 100 and pages back.
 // Later than any real clock, so these are the newest whatever day the suite runs.
 const at=i=>new Date(Date.UTC(2099,0,1,0,0,0,i)).toISOString();
 for(let i=0;i<205;i++)await talkStore.insertMessage({id:randomUUID(),questionId:q.id,userId:users.other.id,authorName:'Ben O.',authorFull:'Ben Otro',organiser:false,body:`m${i}`,clientId:randomUUID(),createdAt:at(i)});
 const reset=await json(`/api/fiiu/questions/${q.id}/messages?since=1`);assert.equal(reset.body.reset,true);assert.equal(reset.body.revision,208);assert.equal(reset.body.changes,undefined);
 const page=await json(`/api/fiiu/questions/${q.id}`);
 assert.equal(page.body.messages.length,100);assert.equal(page.body.messages.at(-1).body,'m204');assert.equal(page.body.messages[0].body,'m105');assert.ok(page.body.before);
 const older=await json(`/api/fiiu/questions/${q.id}/messages?before=${page.body.before}`);
 assert.equal(older.status,200);assert.equal(older.body.messages.length,100);assert.equal(older.body.messages.at(-1).body,'m104');assert.ok(older.body.before);
 const oldest=await json(`/api/fiiu/questions/${q.id}/messages?before=${older.body.before}`);
 assert.deepEqual(oldest.body.messages.map(m=>m.body).slice(-5),['m0','m1','m2','m3','m4']);assert.equal(oldest.body.before,null);
});

test('a lost send retried with the same clientId never duplicates: concurrent sends, an interrupted attach, a closed question',async t=>{
 // The first lookup misses, as for two requests of one draft arriving together: the insert then meets the first one's row.
 let miss=false;
 const {json,ask,post,upload,talkStore,users,close}=await setup(t,{wrapTalk:store=>({...store,findMessageByClient:async(...args)=>{if(miss){miss=false;return null;}return store.findMessageByClient(...args);}})});
 const q=await ask(),clientId=randomUUID();
 const first=await post(q,'hola',{clientId});assert.equal(first.status,201);
 miss=true;const racing=await post(q,'hola',{clientId});
 assert.equal(racing.status,200);assert.equal(racing.body.message.id,first.body.message.id);
 assert.equal((await json(`/api/fiiu/questions/${q.id}`)).body.messages.length,1);
 // The first request stopped after the insert, before the attach: the retry finishes it.
 const file=(await upload()).body.file,draft=randomUUID();
 await talkStore.insertMessage({id:randomUUID(),questionId:q.id,userId:users.member.id,authorName:'Ana T.',authorFull:'Ana Test',organiser:false,body:'con foto',clientId:draft,createdAt:new Date().toISOString()});
 const finished=await post(q,'con foto',{clientId:draft,fileIds:[file.id]});
 assert.equal(finished.status,200);assert.deepEqual(finished.body.message.files.map(f=>f.id),[file.id]);
 assert.equal((await json(`/api/fiiu/questions/${q.id}`)).body.messages.length,2);
 // Closed after the message was stored: the retry still learns it was sent.
 await close(q);
 assert.equal((await post(q,'hola',{clientId})).status,200);
 assert.equal((await post(q,'nuevo')).body.code,'question_closed');
});

test('a retry racing the first send of a draft with a photo keeps one message with its photo, whichever attach lands first',async t=>{
 // Each hold() stops the next attachFiles call until released, so the two requests of one draft can be interleaved.
 const gates=[];
 const hold=()=>{const gate={};gate.entered=new Promise(r=>{gate.enter=r;});gate.opened=new Promise(r=>{gate.release=r;});gates.push(gate);return gate;};
 const {db,json,ask,post,upload,talkStore}=await setup(t,{wrapTalk:store=>({...store,attachFiles:async(...args)=>{const gate=gates.shift();if(gate){gate.enter();await gate.opened;}return store.attachFiles(...args);}})});
 const q=await ask(),sent=[];
 const send=(clientId,file)=>post(q,'con foto',{clientId,fileIds:[file.id]});
 const same=(answers,file)=>{
  assert.deepEqual(answers.map(a=>a.status),[201,200],JSON.stringify(answers.map(a=>a.body)));
  assert.equal(answers[1].body.message.id,answers[0].body.message.id);
  for(const a of answers)assert.deepEqual(a.body.message.files.map(f=>f.id),[file.id]);
  sent.push([answers[0].body.message.id,file.id]);
 };
 // The retry attaches while the first request waits at its attach, which then finds the photo already on its message.
 const photo=(await upload()).body.file,draft=randomUUID(),held=hold(),first=send(draft,photo);await held.entered;
 const retry=await send(draft,photo);held.release();
 same([await first,retry],photo);
 // The retry reads the message before the first request attaches, and attaches after it.
 const second=(await upload()).body.file,again=randomUUID(),a=hold(),b=hold(),original=send(again,second);await a.entered;
 const late=send(again,second);await b.entered;
 a.release();const stored=await original;b.release();
 same([stored,await late],second);
 const page=await json(`/api/fiiu/questions/${q.id}`,{actor:'other'});
 assert.deepEqual(page.body.messages.map(m=>[m.id,m.files.map(f=>f.id)[0]]),sent,'one visible message each, with its photo');
 for(const [,id] of sent){assert.equal((await talkStore.findFile(id))?.status,'ready');assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_file_bytes WHERE file_id=?').get(id).n,1);}
});

test('a retry can only finish its own send: no new file once the question closed, the message was hidden, has files or is old',async t=>{
 let now=Date.parse('2026-10-21T14:00:00.000Z');
 const {json,ask,post,upload,close,talkStore}=await setup(t,{app:{talkClock:()=>now}});
 const q=await ask(),stray=(await upload()).body.file;
 const retry=(clientId,body,files)=>post(q,body,{clientId,fileIds:files.map(f=>f.id)});
 const hid=randomUUID(),hidden=(await post(q,'oculto',{clientId:hid})).body.message;
 assert.equal((await json(`/api/admin/fiiu/messages/${hidden.id}/hidden`,{actor:'admin',method:'PUT',body:{}})).status,200);
 assert.equal((await retry(hid,'oculto',[stray])).body.code,'client_id_reused','a moderated message takes no new file');
 const sent=randomUUID(),photo=(await upload()).body.file;
 assert.equal((await retry(sent,'con foto',[photo])).status,201);
 assert.equal((await retry(sent,'con foto',[photo,stray])).body.code,'client_id_reused','a message with its files takes no more');
 assert.equal((await retry(sent,'con foto',[photo])).status,200,'the same retry is still answered');
 const old=randomUUID();assert.equal((await post(q,'viejo',{clientId:old})).status,201);
 now+=10*60000;
 assert.equal((await retry(old,'viejo',[stray])).body.code,'client_id_reused','past the ten-minute retry window');
 const late=randomUUID();assert.equal((await post(q,'tarde',{clientId:late})).status,201);
 await close(q);
 const closed=await retry(late,'tarde',[stray]);assert.equal(closed.status,403);assert.equal(closed.body.code,'question_closed');
 assert.equal((await post(q,'tarde',{clientId:late})).status,200,'a retry without new files still learns it was sent');
 assert.equal((await talkStore.findFile(stray.id)).messageId,null,'the stray file never moved');
});

test('a refused finish withdraws a photo-only message that never got its photo, so nobody sees an empty message',async t=>{
 const {json,ask,post,upload,close,talkStore,users}=await setup(t);
 const q=await ask(),photo=(await upload()).body.file,draft=randomUUID();
 // The first request inserted the message and stopped before attaching its only content, the photo.
 const stored=await talkStore.insertMessage({id:randomUUID(),questionId:q.id,userId:users.member.id,authorName:'Ana T.',authorFull:'Ana Test',organiser:false,body:'',clientId:draft,createdAt:new Date().toISOString()});
 await close(q);
 const refused=await post(q,'',{clientId:draft,fileIds:[photo.id]});
 assert.equal(refused.status,403);assert.equal(refused.body.code,'question_closed');
 assert.ok((await talkStore.findMessage(stored.id)).deletedAt,'withdrawn rather than left empty');
 assert.deepEqual((await json(`/api/fiiu/questions/${q.id}`,{actor:'other'})).body.messages,[]);
});

test('a send withdrawn because a file was taken gives up its clientId, so the Retry posts it rather than learning it is gone',async t=>{
 let lose=true;
 const {json,ask,post,upload}=await setup(t,{wrapTalk:store=>({...store,attachFiles:async(...args)=>{if(lose){lose=false;return 0;}return store.attachFiles(...args);}})});
 const q=await ask(),photo=(await upload()).body.file,draft=randomUUID();
 const first=await post(q,'con foto',{clientId:draft,fileIds:[photo.id]});
 assert.equal(first.status,400);assert.equal(first.body.code,'file_unavailable');
 const retry=await post(q,'con foto',{clientId:draft,fileIds:[photo.id]});
 assert.equal(retry.status,201,JSON.stringify(retry.body));assert.equal(retry.body.message.gone,undefined);
 assert.deepEqual(retry.body.message.files.map(f=>f.id),[photo.id]);
 assert.deepEqual((await json(`/api/fiiu/questions/${q.id}`,{actor:'other'})).body.messages.map(m=>m.body),['con foto']);
});

test('a close landing between the question read and the changes read still reaches the page in that same answer',async t=>{
 let race=null;
 const {json,ask,post,talkStore}=await setup(t,{wrapTalk:store=>({...store,messagesSince:async(...args)=>{if(race){const go=race;race=null;await go();}return store.messagesSince(...args);}})});
 const q=await ask(),baseline=(await json(`/api/fiiu/questions/${q.id}`,{actor:'other'})).body.revision;
 // A last answer, then the close, both after the question was read for this sync and before its changes were.
 race=async()=>{await post(q,'justo a tiempo');const current=await talkStore.getQuestion(q.id);await talkStore.updateQuestion(q.id,current.version,{status:'closed',updatedAt:new Date().toISOString()});};
 const answer=await json(`/api/fiiu/questions/${q.id}/messages?since=${baseline}`,{actor:'other'});
 assert.equal(answer.body.changes.length,1);
 assert.equal(answer.body.question.status,'closed','the question is as new as the rows');
});

test('files attached after the insert reach peers that synced the message without them',async t=>{
 // The first send stops after the insert (a PostgREST timeout on the attach); its author retries.
 let broken=true;
 const {json,ask,post,upload,pulse}=await setup(t,{wrapTalk:store=>({...store,attachFiles:async(...args)=>{if(broken){broken=false;throw Object.assign(Error('attach timed out'),{status:502});}return store.attachFiles(...args);}})});
 const q=await ask(),file=(await upload()).body.file,clientId=randomUUID();
 assert.equal((await post(q,'',{clientId,fileIds:[file.id]})).status,502);
 const early=await json(`/api/fiiu/questions/${q.id}/messages?since=0`,{actor:'other'});
 assert.deepEqual(early.body.changes.map(c=>c.files.length),[0],'a peer synced the photo message before its photo');
 const finished=await post(q,'',{clientId,fileIds:[file.id]});assert.equal(finished.status,200);
 const later=await json(`/api/fiiu/questions/${q.id}/messages?since=${early.body.revision}`,{actor:'other'});
 assert.deepEqual(later.body.changes.map(c=>[c.id,c.files.map(f=>f.id)]),[[finished.body.message.id,[file.id]]]);
 assert.equal((await pulse())[0][2],later.body.revision,'the pulse moved with it');
 assert.equal(finished.body.message.seq,later.body.revision,'the answer carries the seq the attach stamped');
 const fresh=await post(q,'',{fileIds:[(await upload()).body.file.id]});
 assert.equal(fresh.status,201);assert.equal(fresh.body.message.seq,(await pulse())[0][2],'so does a first send with files');
});

test('a retry of a message deleted since it was sent learns it is gone',async t=>{
 const {json,ask,post,upload}=await setup(t);
 const q=await ask(),clientId=randomUUID(),file=(await upload()).body.file,m=(await post(q,'hola',{clientId,fileIds:[file.id]})).body.message;
 assert.equal((await json(`/api/fiiu/messages/${m.id}`,{method:'DELETE',body:{}})).status,200);
 const retry=await post(q,'hola',{clientId,fileIds:[file.id]});
 assert.equal(retry.status,200);assert.deepEqual(retry.body.message,{id:m.id,seq:retry.body.message.seq,gone:true});
});

test('a retry of a message hidden since it was sent gets its author\'s hidden view, as their next sync would',async t=>{
 const {json,ask,post}=await setup(t);
 const q=await ask(),clientId=randomUUID(),m=(await post(q,'hola',{clientId})).body.message;
 assert.equal((await json(`/api/admin/fiiu/messages/${m.id}/hidden`,{actor:'admin',method:'PUT',body:{}})).status,200);
 const retry=await post(q,'hola',{clientId});
 assert.equal(retry.status,200);assert.deepEqual(retry.body.message,{...m,seq:retry.body.message.seq,hidden:true});
});

test('likes are idempotent, never on your own message and never on a closed question, while deleting your own still works',async t=>{
 const {json,call,ask,post,close}=await setup(t);
 const q=await ask(),m=(await post(q,'hola')).body.message;
 const like=method=>json(`/api/fiiu/messages/${m.id}/like`,{actor:'other',method,body:{}});
 assert.deepEqual((await like('PUT')).body,{likeCount:1,liked:true});
 assert.deepEqual((await like('PUT')).body,{likeCount:1,liked:true},'a second device liking again does not double count');
 const synced=await json(`/api/fiiu/questions/${q.id}/messages?since=1`,{actor:'other'});
 // A since answer is shared between viewers, so it carries the count and no like of the viewer's: the page keeps its own.
 assert.equal(synced.body.changes[0].likeCount,1);assert.equal('liked' in synced.body.changes[0],false);assert.equal(synced.body.liked,undefined);
 const seeded=await json(`/api/fiiu/questions/${q.id}`,{actor:'other'});assert.equal(seeded.body.messages[0].liked,true);assert.deepEqual(seeded.body.liked,[m.id]);
 assert.equal((await json(`/api/fiiu/questions/${q.id}`)).body.messages[0].liked,false,'the author sees the count, not the like as theirs');
 assert.deepEqual((await like('DELETE')).body,{likeCount:0,liked:false});
 assert.deepEqual((await like('DELETE')).body,{likeCount:0,liked:false},'unliking twice never goes negative');
 const own=await json(`/api/fiiu/messages/${m.id}/like`,{method:'PUT',body:{}});assert.equal(own.status,403);assert.equal(own.body.code,'own_message');
 assert.equal((await json(`/api/fiiu/messages/${randomUUID()}/like`,{actor:'other',method:'PUT',body:{}})).status,404);
 assert.equal((await call(`/api/fiiu/messages/${m.id}`,{actor:'other',method:'DELETE',body:{}})).status,404,'only the author deletes a message');
 await close(q);
 const closedLike=await like('PUT');assert.equal(closedLike.status,403);assert.equal(closedLike.body.code,'question_closed');
 const closedPost=await post(q,'tarde');assert.equal(closedPost.status,403);assert.equal(closedPost.body.code,'question_closed');
 const closedView=await json(`/api/fiiu/questions/${q.id}`);assert.equal(closedView.body.me.canPost,false);
 const removed=await json(`/api/fiiu/messages/${m.id}`,{method:'DELETE',body:{}});assert.equal(removed.status,200);assert.deepEqual(removed.body,{ok:true});
 assert.equal((await call(`/api/fiiu/messages/${m.id}`,{method:'DELETE',body:{}})).status,404,'already gone');
 const after=await json(`/api/fiiu/questions/${q.id}`,{actor:'other'});assert.deepEqual(after.body.messages,[]);assert.equal(after.body.question.messageCount,0);
});

test('two devices liking at once count once, and a withdrawn message or a hidden question cannot be liked',async t=>{
 const {json,ask,post}=await setup(t);
 const q=await ask(),m=(await post(q,'hola')).body.message;
 const like=(id,method='PUT',actor='other')=>json(`/api/fiiu/messages/${id}/like`,{actor,method,body:{}});
 const both=await Promise.all([like(m.id),like(m.id)]);
 assert.deepEqual(both.map(r=>[r.status,r.body.liked]),[[200,true],[200,true]]);
 assert.equal((await json(`/api/fiiu/questions/${q.id}`,{actor:'other'})).body.messages[0].likeCount,1);
 const off=await Promise.all([like(m.id,'DELETE'),like(m.id,'DELETE')]);assert.deepEqual(off.map(r=>r.body.likeCount),[0,0]);
 const draft=(await post(q,'borrador')).body.message;
 assert.equal((await json(`/api/fiiu/messages/${draft.id}`,{method:'DELETE',body:{}})).status,200);
 const withdrawn=await like(draft.id);assert.equal(withdrawn.status,404);assert.equal(withdrawn.body.code,'message_unavailable');
 const current=(await json('/api/admin/fiiu/questions',{actor:'admin'})).body.questions.find(x=>x.id===q.id);
 assert.equal((await json(`/api/admin/fiiu/questions/${q.id}`,{actor:'admin',method:'PATCH',body:{version:current.version,status:'hidden'}})).status,200);
 const hidden=await like(m.id);assert.equal(hidden.status,404);assert.equal(hidden.body.code,'message_unavailable');
 assert.equal((await like(m.id,'PUT','admin')).body.code,'question_closed','organisers see the hidden question but it takes no likes');
});

test('an organiser hides a message from participants within one sync and brings it back',async t=>{
 const {json,ask,post,pulse}=await setup(t);
 const q=await ask(),m=(await post(q,'hola')).body.message;
 const baseline=(await json(`/api/fiiu/questions/${q.id}`,{actor:'other'})).body.revision;
 assert.equal((await json(`/api/admin/fiiu/messages/${m.id}/hidden`,{method:'PUT',body:{}})).status,403);
 const hidden=await json(`/api/admin/fiiu/messages/${m.id}/hidden`,{actor:'admin',method:'PUT',body:{}});
 assert.equal(hidden.status,200);assert.equal(hidden.body.message.hidden,true);assert.equal(hidden.body.message.authorFull,'Ana Test');
 const revision=(await pulse()).find(([id])=>id===q.id)[2];assert.ok(revision>baseline);
 const gone=await json(`/api/fiiu/questions/${q.id}/messages?since=${baseline}`,{actor:'other'});
 assert.deepEqual(gone.body.changes,[{id:m.id,seq:revision,gone:true}]);assert.equal(gone.body.revision,revision);
 assert.deepEqual((await json(`/api/fiiu/questions/${q.id}`,{actor:'other'})).body.messages,[]);
 const own=(await json(`/api/fiiu/questions/${q.id}/messages?since=${baseline}`)).body.changes[0];
 const {liked,...shared}=m;assert.equal(liked,false);
 assert.deepEqual(own,{...shared,seq:revision,hidden:true},'its author keeps it, marked hidden, so they can still delete it');
 const staff=await json(`/api/fiiu/questions/${q.id}/messages?since=${baseline}`,{actor:'admin'});
 assert.equal(staff.body.changes[0].hidden,true);assert.equal(staff.body.changes[0].authorFull,'Ana Test');assert.equal(staff.body.changes[0].body,'hola');
 const staffPage=await json(`/api/fiiu/questions/${q.id}`,{actor:'admin'});assert.equal(staffPage.body.messages[0].hidden,true);assert.equal(staffPage.body.question.messageCount,0);
 assert.equal((await json(`/api/fiiu/messages/${m.id}/like`,{actor:'other',method:'PUT',body:{}})).status,404);
 assert.equal((await json(`/api/admin/fiiu/messages/${m.id}/hidden`,{actor:'admin',method:'PUT',body:{}})).body.message.hidden,true,'hiding again is harmless');
 const shown=await json(`/api/admin/fiiu/messages/${m.id}/hidden`,{actor:'admin',method:'DELETE',body:{}});assert.equal(shown.status,200);assert.equal(shown.body.message.hidden,false);
 const back=await json(`/api/fiiu/questions/${q.id}/messages?since=${revision}`,{actor:'other'});
 assert.equal(back.body.changes.length,1);assert.equal(back.body.changes[0].body,'hola');assert.equal(back.body.changes[0].gone,undefined);
 assert.equal((await json(`/api/admin/fiiu/messages/${randomUUID()}/hidden`,{actor:'admin',method:'PUT',body:{}})).status,404);
});

test('since answers carry the question, so an edit or a close sharing a sync with message changes still reaches the page',async t=>{
 const {json,ask,post,close}=await setup(t);
 const q=await ask(),baseline=(await json(`/api/fiiu/questions/${q.id}`,{actor:'other'})).body.revision;
 const current=(await json('/api/admin/fiiu/questions',{actor:'admin'})).body.questions.find(x=>x.id===q.id);
 assert.equal((await json(`/api/admin/fiiu/questions/${q.id}`,{actor:'admin',method:'PATCH',body:{version:current.version,body:'¿Y ahora?',talk:'¡Bienvenidos al FIIU 11!'}})).status,200);
 const m=(await post(q,'hola')).body.message;
 const both=await json(`/api/fiiu/questions/${q.id}/messages?since=${baseline}`,{actor:'other'});
 assert.deepEqual(both.body.changes.map(c=>c.id),[m.id]);
 assert.deepEqual(both.body.question,(await json(`/api/fiiu/questions/${q.id}`,{actor:'other'})).body.question,'the same view as the page');
 assert.equal(both.body.question.body,'¿Y ahora?');assert.equal(both.body.question.talk,'¡Bienvenidos al FIIU 11!');assert.equal(both.body.question.version,undefined);
 await close(q);
 const closed=await json(`/api/fiiu/questions/${q.id}/messages?since=${both.body.revision}`,{actor:'other'});
 assert.deepEqual(closed.body.changes,[]);assert.equal(closed.body.question.status,'closed');
 const reset=await json(`/api/fiiu/questions/${q.id}/messages?since=999`,{actor:'admin'});
 assert.equal(reset.body.reset,true);assert.equal(reset.body.question.status,'closed');assert.equal(typeof reset.body.question.version,'number','organisers get their version');
});

test('authors keep their own hidden message, with its files, on every read and can still delete it; everyone else loses it',async t=>{
 const {json,call,ask,post,upload,talkStore}=await setup(t);
 const q=await ask(),file=(await upload()).body.file,clientId=randomUUID(),m=(await post(q,'mira',{clientId,fileIds:[file.id]})).body.message;
 const peer=(await post(q,'otro',{actor:'other'})).body.message;
 assert.equal((await json(`/api/admin/fiiu/messages/${m.id}/hidden`,{actor:'admin',method:'PUT',body:{}})).status,200);
 const page=(await json(`/api/fiiu/questions/${q.id}`)).body;
 const view=page.messages.find(x=>x.id===m.id);
 assert.equal(view.hidden,true);assert.equal(view.mine,true);assert.deepEqual(view.files.map(f=>f.id),[file.id]);assert.equal(view.authorFull,undefined);
 assert.equal(page.question.messageCount,1,'the count is still what participants see');
 assert.equal((await call(`/api/fiiu/files/${file.id}`)).status,200,'the author still opens the file');
 assert.deepEqual((await json(`/api/fiiu/questions/${q.id}`,{actor:'other'})).body.messages.map(x=>x.id),[peer.id]);
 assert.equal((await call(`/api/fiiu/files/${file.id}`,{actor:'other'})).status,404);
 // One shared since answer: the author's view and everyone else's are built from the same rows.
 const mine=await json(`/api/fiiu/questions/${q.id}/messages?since=0`),theirs=await json(`/api/fiiu/questions/${q.id}/messages?since=0`,{actor:'other'});
 assert.equal(mine.body.changes.find(c=>c.id===m.id).hidden,true);assert.equal(mine.body.changes.find(c=>c.id===m.id).files.length,1);
 assert.deepEqual(theirs.body.changes.find(c=>c.id===m.id),{id:m.id,seq:mine.body.changes.find(c=>c.id===m.id).seq,gone:true});
 assert.equal(theirs.body.changes.find(c=>c.id===peer.id).mine,true);assert.equal(mine.body.changes.find(c=>c.id===peer.id).mine,false);
 assert.equal((await json(`/api/fiiu/messages/${m.id}/like`,{actor:'other',method:'PUT',body:{}})).status,404);
 assert.equal((await json(`/api/fiiu/messages/${m.id}`,{method:'DELETE',body:{}})).status,200);
 assert.deepEqual((await json(`/api/fiiu/questions/${q.id}`)).body.messages.map(x=>x.id),[peer.id]);
 assert.equal(await talkStore.findFile(file.id),null,'its files went with it');
});

test('since answers are read once per question, revision and audience for 1.5 s, then built per viewer in memory',async()=>{
 const Q='22222222-2222-4222-8222-222222222222';let t=1000,reads=0;const sent=[];
 const row=(id,userId,seq,extra={})=>({id,questionId:Q,userId,authorName:'Ana T.',authorFull:'Ana Test',organiser:false,body:'hola',likeCount:0,seq,hiddenAt:null,deletedAt:null,createdAt:'2026-10-21T14:00:00.000Z',...extra});
 const store={findRegistration:async()=>({firstName:'Ana',lastName:'Test'}),
  getQuestion:async()=>{reads++;await new Promise(r=>setTimeout(r,5));return {id:Q,eventId:'fiiu-2026',activityId:'day1-am',talk:null,body:'¿Qué?',status:'open',revision:1000,messageCount:1,version:2,createdAt:'x'};},
  messagesSince:async()=>{reads++;return [row('m1','a',900,{hiddenAt:'x'}),row('m2','b',901)];},
  filesForMessages:async()=>{reads++;return [];},likedAmong:async()=>{throw Error('a since answer reads no per-viewer likes');}};
 const api=createTalkApi({store,sameOrigin:()=>true,send:(res,status,body)=>sent.push(body),clock:()=>t});
 const get=(id,since=2,permission='member')=>api({req:{method:'GET',headers:{}},res:{},url:new URL(`http://x/api/fiiu/questions/${Q}/messages?since=${since}`),user:{id,permission}});
 await Promise.all([get('a'),get('b'),get('c')]);
 assert.equal(reads,3,'one question, one changes and one files read for three viewers');
 sent.length=0;await get('a');await get('b');
 assert.equal(reads,3);
 assert.equal(sent[0].changes[0].hidden,true,'the author sees their hidden message');assert.equal(sent[0].changes[0].mine,true);
 assert.deepEqual(sent[1].changes[0],{id:'m1',seq:900,gone:true},'nobody else does');assert.equal(sent[1].changes[1].mine,true);
 assert.equal(sent[0].question.body,'¿Qué?');assert.equal(sent[0].revision,1000);
 await get('o',2,'admin');assert.equal(reads,6,'organisers have their own entry');assert.equal(sent.at(-1).changes[0].hidden,true);assert.equal(sent.at(-1).question.version,2);
 await get('a',3);assert.equal(reads,9,'another revision is another entry');
 t+=1499;await get('b');assert.equal(reads,9);
 t+=1;await get('b');assert.equal(reads,12,'expired after 1.5 s');
 // Bounded: the oldest entry goes first.
 for(let i=10;i<=210;i++)await get('a',i);
 const before=reads;await get('a',210);assert.equal(reads,before,'the newest is kept');
 await get('a',10);assert.equal(reads,before+3,'the oldest was dropped');
 // A write through this instance drops them, so its author's next poll reads past it.
 const posted=reads;
 await api({req:{method:'DELETE',headers:{}},res:{},url:new URL(`http://x/api/fiiu/messages/${Q}`),user:{id:'a',permission:'member'}}).catch(()=>{});
 await get('a',210);assert.equal(reads,posted+3);
 // A like answers with its own count, so it keeps them: in a full room every poll after a like would otherwise read again.
 const liked=reads;
 await api({req:{method:'PUT',headers:{}},res:{},url:new URL(`http://x/api/fiiu/messages/${Q}/like`),user:{id:'b',permission:'member'}}).catch(()=>{});
 await get('a',210);assert.equal(reads,liked,'a like keeps the shared answers');
});

test('festival files: types, sizes, thumbnails, attach rules, download access and headers, and release on delete',async t=>{
 const {db,json,call,ask,post,upload,talkStore}=await setup(t,{app:{talkLimits:{upload:20}}});
 const q=await ask();
 const up=await upload({thumb:{mime:'image/jpeg',data:thumb,width:480,height:270}});
 assert.equal(up.status,201);
 const file=up.body.file;assert.deepEqual(file,{id:file.id,name:'photo.jpg',mime:'image/jpeg',size:64,width:1600,height:900,thumb:true});
 assert.equal((await upload({name:'a.txt',mime:'text/plain',data:Buffer.from('hola').toString('base64')})).body.code,'file_type');
 assert.equal((await upload({name:'a.png',mime:'image/png'})).body.code,'file_type','the bytes must match the type');
 const big=await upload({data:Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(3*1024*1024-2)]).toString('base64')});assert.equal(big.status,413);assert.equal(big.body.code,'file_size');
 assert.equal((await upload({name:'a.pdf',mime:'application/pdf',data:pdf,thumb:{mime:'image/jpeg',data:thumb}})).status,400,'PDFs carry no thumbnail');
 assert.equal((await upload({},'stranger')).body.code,'not_registered');
 const mine=await call(`/api/fiiu/files/${file.id}`);assert.equal(mine.status,200,'the owner reads a file before sending it');
 assert.equal((await call(`/api/fiiu/files/${file.id}`,{actor:'other'})).status,404,'nobody else sees an unsent file');
 const stolen=await post(q,'mira',{actor:'other',fileIds:[file.id]});assert.equal(stolen.status,400);assert.equal(stolen.body.code,'file_unavailable');
 const sent=await post(q,'mira',{fileIds:[file.id]});assert.equal(sent.status,201);
 assert.deepEqual(sent.body.message.files,[{id:file.id,name:'photo.jpg',mime:'image/jpeg',size:64,width:1600,height:900,thumb:true}]);
 assert.equal((await post(q,'otra vez',{fileIds:[file.id]})).body.code,'file_unavailable','an attached file cannot be attached again');
 const full=await call(`/api/fiiu/files/${file.id}`,{actor:'other'});
 assert.equal(full.status,200);assert.equal(full.headers.get('content-type'),'image/jpeg');assert.match(full.headers.get('content-disposition'),/^inline; filename="photo\.jpg"/);
 assert.equal(full.headers.get('content-security-policy'),"default-src 'none'; sandbox");assert.equal(full.headers.get('x-content-type-options'),'nosniff');
 assert.equal(full.headers.get('cache-control'),'private, max-age=86400, immutable');assert.equal(full.headers.get('etag'),`"${file.id}"`);assert.equal(full.headers.get('vary'),'Cookie');
 assert.equal(Buffer.from(await full.arrayBuffer()).toString('base64'),jpeg);
 const small=await call(`/api/fiiu/files/${file.id}?size=thumb`,{actor:'other'});
 assert.equal(small.status,200);assert.equal(small.headers.get('etag'),`"${file.id}-thumb"`);assert.equal(Buffer.from(await small.arrayBuffer()).toString('base64'),thumb);
 assert.equal((await call(`/api/fiiu/files/${file.id}`,{actor:'other',headers:{'If-None-Match':`"${file.id}"`}})).status,304);
 assert.equal((await call(`/api/fiiu/files/${file.id}?size=thumb`,{actor:'other',headers:{'If-None-Match':`W/"${file.id}-thumb"`}})).status,304);
 assert.equal((await call(`/api/fiiu/files/${file.id}`,{actor:'stranger'})).status,403);
 const doc=(await upload({name:'notas.pdf',mime:'application/pdf',data:pdf,width:10,height:10})).body.file;
 assert.equal(doc.width,null,'a PDF has no image box');assert.equal(doc.thumb,false);
 assert.equal((await post(q,'',{fileIds:[doc.id]})).status,201,'a file alone is a message');
 const pdfDownload=await call(`/api/fiiu/files/${doc.id}`,{actor:'other'});
 assert.equal(pdfDownload.headers.get('content-type'),'application/pdf');assert.match(pdfDownload.headers.get('content-disposition'),/^attachment; filename="notas\.pdf"/);
 const fallback=await call(`/api/fiiu/files/${doc.id}?size=thumb`,{actor:'other'});assert.equal(fallback.status,200,'no thumbnail serves the file itself');assert.equal(Buffer.from(await fallback.arrayBuffer()).toString('base64'),pdf);
 assert.equal((await call(`/api/fiiu/files/${randomUUID()}`)).status,404);
 assert.equal((await json(`/api/admin/fiiu/messages/${sent.body.message.id}/hidden`,{actor:'admin',method:'PUT',body:{}})).status,200);
 assert.equal((await call(`/api/fiiu/files/${file.id}`,{actor:'other'})).status,404,'a hidden message hides its files');
 assert.equal((await call(`/api/fiiu/files/${file.id}`,{actor:'admin'})).status,200,'organisers still open them');
 assert.equal((await json(`/api/fiiu/messages/${sent.body.message.id}`,{method:'DELETE',body:{}})).status,200);
 assert.equal(await talkStore.findFile(file.id),null,'deleting the message releases its files');
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_file_bytes WHERE file_id=?').get(file.id).n,0);
 assert.equal((await call(`/api/fiiu/files/${file.id}`)).status,404);
});

test('a thumbnail is read from Storage once per instance for every viewer, while access is still checked on each request',async t=>{
 const reads=[];
 const {json,call,ask,post,upload}=await setup(t,{wrapTalk:store=>({...store,getBytes:async(file,variant)=>{reads.push(variant);return store.getBytes(file,variant);}})});
 const q=await ask(),file=(await upload({thumb:{mime:'image/jpeg',data:thumb,width:480,height:270}})).body.file;
 const m=(await post(q,'mira',{fileIds:[file.id]})).body.message;
 const small=actor=>call(`/api/fiiu/files/${file.id}?size=thumb`,{actor});
 const answers=await Promise.all(['other','admin','member','other'].map(small));
 assert.deepEqual(answers.map(r=>[r.status,r.headers.get('content-type')]),Array(4).fill([200,'image/jpeg']));
 for(const r of answers)assert.equal(Buffer.from(await r.arrayBuffer()).toString('base64'),thumb);
 assert.deepEqual(reads,['thumb'],'one Storage read, shared by requests in flight');
 for(let i=0;i<2;i++)assert.equal((await call(`/api/fiiu/files/${file.id}`,{actor:'other'})).status,200);
 assert.deepEqual(reads,['thumb','full','full'],'full images are read each time');
 assert.equal((await json(`/api/admin/fiiu/messages/${m.id}/hidden`,{actor:'admin',method:'PUT',body:{}})).status,200);
 assert.equal((await small('other')).status,404,'a cached thumbnail still needs its message shown');
 assert.equal((await small('stranger')).status,403);
 assert.equal((await small('admin')).status,200);assert.equal(reads.length,3);
});

test('the thumbnail cache keeps at most 200 thumbnails and 20 MB, least recently used first, and the file is read beside the access check',async()=>{
 const id=i=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
 const make=size=>{
  const gets=[];let registered=false;
  const store={findRegistration:async()=>{await new Promise(r=>setTimeout(r,5));registered=true;return {firstName:'Ana',lastName:'Test'};},
   findFile:async fileId=>({id:fileId,eventId:'fiiu-2026',userId:'u',status:'ready',thumbSize:5,mime:'image/jpeg',name:'a.jpg',size:10,messageId:null,registeredFirst:registered}),
   getBytes:async file=>{gets.push(file.id);return Buffer.alloc(size,255);}};
  const sent=[];
  const api=createTalkApi({store,sameOrigin:()=>true,send:(res,status)=>sent.push(status),clock:()=>1000});
  const get=i=>api({req:{method:'GET',headers:{}},res:{},url:new URL(`http://x/api/fiiu/files/${id(i)}?size=thumb`),user:{id:'u',permission:'member'}});
  return {gets,sent,get,store};
 };
 const many=make(10);
 const first=many.store.findFile;let registeredFirst;many.store.findFile=async fileId=>{const f=await first(fileId);registeredFirst=f.registeredFirst;return f;};
 await many.get(0);assert.equal(registeredFirst,false,'the file is read while the registration is');assert.deepEqual(many.sent,[200]);
 for(let i=1;i<=200;i++)await many.get(i);
 assert.equal(many.gets.length,201);
 await many.get(1);await many.get(200);assert.equal(many.gets.length,201,'still kept');
 await many.get(0);assert.equal(many.gets.length,202,'the least recently used went first');
 await many.get(2);assert.equal(many.gets.length,203,'and then the next');
 await many.get(1);assert.equal(many.gets.length,203,'a recent read keeps it');
 const big=make(8*1024*1024);
 for(const i of [1,2,3])await big.get(i);
 await big.get(3);await big.get(2);assert.equal(big.gets.length,3);
 await big.get(1);assert.equal(big.gets.length,4,'24 MB is over 20 MB, so the oldest went');
});

test('festival downloads spend the shared byte budget, organisers excepted, and their own request budget, not the chat\'s',async t=>{
 const {json,call,ask,post,upload}=await setup(t,{app:{downloadLimits:[{windowMs:60000,bytes:100}],talkLimits:{file:4}}});
 const q=await ask(),file=(await upload()).body.file;
 assert.equal((await post(q,'mira',{fileIds:[file.id]})).status,201);
 const get=(actor='other')=>call(`/api/fiiu/files/${file.id}`,{actor});
 assert.equal((await get()).status,200,'the first file of a window always fits');
 const over=await get();assert.equal(over.status,429);assert.ok(Number(over.headers.get('retry-after'))>0);
 assert.deepEqual(await over.json(),{error:'download limit reached; try again later',code:'download_rate'});
 assert.equal((await get('admin')).status,200,'organisers are not budgeted');
 // HEAD is not served: it would read the bytes from Storage for nothing.
 const head=await call(`/api/fiiu/files/${file.id}`,{actor:'admin',method:'HEAD'});assert.equal(head.status,405);assert.equal(head.headers.get('allow'),'GET');
 // Four file requests a minute here: the fifth is refused, while the conversation's own reads go on.
 for(let i=0;i<3;i++)assert.equal((await get('admin')).status,200);
 const busy=await get('admin');assert.equal(busy.status,429);assert.equal((await busy.json()).error,'too many requests');
 assert.equal((await json(`/api/fiiu/questions/${q.id}`,{actor:'admin'})).status,200);
});

test('a withdrawn message whose file cannot be released logs it and never serves the file again',async t=>{
 // Mocked before the app starts: the conversations take console.error as their log then.
 let broken=true;const logged=t.mock.method(console,'error',()=>{});
 const {db,json,call,ask,post,upload,talkStore}=await setup(t,{wrapTalk:store=>({...store,deleteBytes:async file=>{if(broken){broken=false;throw Object.assign(Error('storage down'),{status:502});}return store.deleteBytes(file);}})});
 const q=await ask(),file=(await upload()).body.file,m=(await post(q,'mira',{fileIds:[file.id]})).body.message;
 assert.equal((await json(`/api/fiiu/messages/${m.id}`,{method:'DELETE',body:{}})).status,200,'the withdrawal already happened');
 assert.equal((await talkStore.findFile(file.id)).status,'deleting');
 assert.deepEqual(logged.mock.calls.map(c=>c.arguments).filter(([text])=>/^festival/.test(text)),[['festival file cleanup failed:',file.id,'storage down']]);
 assert.equal((await call(`/api/fiiu/files/${file.id}`)).status,404);
 // Account deletion clears what is left.
 assert.equal((await call('/api/me',{method:'DELETE',body:{confirmEmail:'member@example.test'}})).status,200);
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_files').get().n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_file_bytes').get().n,0);
});

test('the festival upload allowance refuses the 31st file',async t=>{
 const {upload}=await setup(t,{app:{talkLimits:{upload:100}}});
 for(let i=0;i<30;i++)assert.equal((await upload({name:`p${i}.jpg`})).status,201,`upload ${i+1}`);
 const over=await upload({name:'p30.jpg'});
 assert.equal(over.status,413);assert.deepEqual(over.body,{error:'festival upload allowance reached',code:'upload_allowance'});
});

test('uploads that never reached a message stop holding the allowance once stale: ready after 30 minutes, pending after an hour',async t=>{
 let now=Date.parse('2026-10-21T14:00:00.000Z');
 const {db,ask,post,upload,talkStore,users}=await setup(t,{app:{talkClock:()=>now,talkLimits:{upload:100}}});
 const q=await ask(),sent=(await upload()).body.file;
 assert.equal((await post(q,'mira',{fileIds:[sent.id]})).status,201);
 // Answers lost (the page uploaded again), drafts dropped or refused: ready rows no message will ever take.
 const orphans=[];for(let i=0;i<28;i++){const r=await upload({name:`p${i}.jpg`});assert.equal(r.status,201);orphans.push(r.body.file.id);}
 // An upload that died between its reservation and its bytes.
 const died=randomUUID();
 await talkStore.reserveFile({id:died,eventId:'fiiu-2026',userId:users.member.id,name:'d.jpg',mime:'image/jpeg',size:10,width:null,height:null,thumbSize:null,storagePath:`fiiu/${users.member.id}/${died}`,createdAt:new Date(now).toISOString()});
 const theirs=(await upload({},'other')).body.file;
 assert.equal((await upload()).body.code,'upload_allowance');
 now+=30*60000;
 assert.equal((await upload()).body.code,'upload_allowance','not before 30 minutes');
 now+=1;
 const fresh=await upload();assert.equal(fresh.status,201);
 for(const id of orphans)assert.equal(await talkStore.findFile(id),null);
 assert.equal(db.prepare(`SELECT count(*) AS n FROM fiiu_file_bytes WHERE file_id IN (${orphans.map(()=>'?').join(',')})`).get(...orphans).n,0,'their bytes went too');
 assert.ok((await talkStore.findFile(sent.id)).messageId,'an attached file stays');
 assert.equal((await talkStore.findFile(died)).status,'pending','a pending upload has an hour');
 assert.equal((await talkStore.findFile(theirs.id)).status,'ready','another person\'s uploads are theirs to release');
 now+=30*60000;
 assert.equal((await upload()).status,201);assert.equal(await talkStore.findFile(died),null);
 assert.equal((await talkStore.findFile(fresh.body.file.id)).status,'ready','a recent upload is kept for its draft');
});

test('releasing stale uploads never takes a file a send attached in the meantime',async t=>{
 let now=Date.parse('2026-10-21T14:00:00.000Z'),racing=null;
 // The send attaches the file between the release's read and its claim.
 const {ask,post,upload,talkStore}=await setup(t,{app:{talkClock:()=>now},wrapTalk:store=>({...store,setFileStatus:async(...args)=>{if(racing&&args[0]===racing.file&&args[2]==='deleting'){const r=racing;racing=null;await r.send();}return store.setFileStatus(...args);}})});
 const q=await ask(),file=(await upload()).body.file;
 now+=31*60000;
 let sent;racing={file:file.id,send:async()=>{sent=await post(q,'tarde',{fileIds:[file.id]});}};
 assert.equal((await upload()).status,201);
 assert.equal(sent.status,201);assert.ok((await talkStore.findFile(file.id)).messageId,'the attached file stayed');
});

test('the account export carries conversations, and account deletion erases files, likes and message text',async t=>{
 const {db,json,call,ask,post,upload,talkStore,users}=await setup(t);
 const q=await ask();
 const file=(await upload()).body.file;
 const mine=(await post(q,'mi aporte',{fileIds:[file.id]})).body.message;
 const theirs=(await post(q,'otro aporte',{actor:'other'})).body.message;
 assert.equal((await json(`/api/fiiu/messages/${theirs.id}/like`,{method:'PUT',body:{}})).status,200);
 assert.equal((await json(`/api/fiiu/messages/${mine.id}/like`,{actor:'other',method:'PUT',body:{}})).status,200);
 const exported=(await json('/api/me/export')).body.data.fiiuConversations;
 assert.deepEqual(exported.messages,[{id:mine.id,questionId:q.id,question:'¿Qué te llevas?',body:'mi aporte',createdAt:mine.createdAt,deleted:false,hidden:false}]);
 assert.deepEqual(exported.files,[{id:file.id,messageId:mine.id,name:'photo.jpg',mime:'image/jpeg',size:64,createdAt:exported.files[0].createdAt}]);
 assert.doesNotMatch(JSON.stringify(exported),/storagePath|fiiu\//);
 assert.deepEqual(exported.likedMessageIds,[theirs.id]);
 const baseline=(await json(`/api/fiiu/questions/${q.id}`,{actor:'other'})).body.revision;
 // An upload still in flight blocks the deletion, so its object cannot land in Storage after the account is gone.
 const pendingId=randomUUID();
 await talkStore.reserveFile({id:pendingId,eventId:'fiiu-2026',userId:users.member.id,name:'p.jpg',mime:'image/jpeg',size:10,width:null,height:null,thumbSize:null,storagePath:`fiiu/${users.member.id}/${pendingId}`,createdAt:new Date().toISOString()});
 const blocked=await call('/api/me',{method:'DELETE',body:{confirmEmail:'member@example.test'}});assert.equal(blocked.status,409);
 assert.ok(await talkStore.findFile(file.id),'nothing was touched');
 db.prepare('UPDATE fiiu_files SET created_at=? WHERE id=?').run(new Date(Date.now()-11*60000).toISOString(),pendingId);
 assert.equal((await call('/api/me',{method:'DELETE',body:{confirmEmail:'member@example.test'}})).status,200);
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_files').get().n,0);assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_file_bytes').get().n,0);
 const since=await json(`/api/fiiu/questions/${q.id}/messages?since=${baseline}`,{actor:'other'});
 assert.ok(since.body.changes.some(c=>c.id===mine.id&&c.gone===true),'the erased message is gone for everyone');
 assert.equal(since.body.changes.find(c=>c.id===theirs.id)?.likeCount,0,'their likes are gone');
 const page=await json(`/api/fiiu/questions/${q.id}`,{actor:'other'});
 assert.deepEqual(page.body.messages.map(m=>m.id),[theirs.id]);assert.equal(page.body.question.messageCount,1);
 const row=db.prepare('SELECT body,author_name,author_full,user_id,deleted_at FROM fiiu_messages WHERE id=?').get(mine.id);
 assert.deepEqual({...row,deleted_at:Boolean(row.deleted_at)},{body:'',author_name:'',author_full:'',user_id:null,deleted_at:true});
});

test('the account export leaves out the text of a question that is now hidden, a draft its participants cannot see',async t=>{
 const {json,ask,post}=await setup(t);
 const q=await ask(),m=(await post(q,'respuesta')).body.message;
 const current=(await json('/api/admin/fiiu/questions',{actor:'admin'})).body.questions.find(x=>x.id===q.id);
 assert.equal((await json(`/api/admin/fiiu/questions/${q.id}`,{actor:'admin',method:'PATCH',body:{version:current.version,status:'hidden',body:'Borrador secreto'}})).status,200);
 assert.equal((await json(`/api/fiiu/questions/${q.id}`)).status,404);
 const exported=(await json('/api/me/export')).body.data.fiiuConversations;
 assert.deepEqual(exported.messages,[{id:m.id,questionId:q.id,question:'',body:'respuesta',createdAt:m.createdAt,deleted:false,hidden:false}]);
 assert.doesNotMatch(JSON.stringify(exported),/secreto/);
});

test('a refused account deletion erases nothing: every refusal is checked before the festival data goes',async t=>{
 const {db,json,call,ask,post,upload,talkStore,users}=await setup(t);
 const q=await ask(),file=(await upload()).body.file;
 const mine=(await post(q,'mi aporte',{fileIds:[file.id]})).body.message,theirs=(await post(q,'otro',{actor:'other'})).body.message;
 assert.equal((await json(`/api/fiiu/messages/${theirs.id}/like`,{method:'PUT',body:{}})).status,200);
 const created=await json('/api/admin/courses',{actor:'admin',method:'POST',body:{title:'Movilidad',status:'published',startsOn:'2026-09-09'}});assert.equal(created.status,201);
 const course=created.body.course,module=(await json(`/api/admin/courses/${course.id}/modules`,{actor:'admin',method:'POST',body:{title:'Primera sesión',status:'published'}})).body.module;
 const erase=()=>json('/api/me',{method:'DELETE',body:{confirmEmail:'member@example.test'}});
 const untouched=async why=>{
  const refused=await erase();assert.equal(refused.status,409,why);
  assert.equal((await talkStore.findMessage(mine.id)).body,'mi aporte',why);assert.equal((await talkStore.findFile(file.id))?.status,'ready',why);
  assert.deepEqual(await talkStore.userLikes(users.member.id),[theirs.id],why);
  assert.equal((await call('/api/auth/me')).status,200,why);
  return refused.body.error;
 };
 // A course upload awaiting reconciliation, which an interrupted upload leaves with no time limit.
 const attachment=randomUUID();
 db.prepare("INSERT INTO course_attachments (id,course_id,module_id,user_id,purpose,name,mime,size,storage_path,status,created_at) VALUES (?,?,?,?,'post','notas.txt','text/plain',5,?,'pending',?)").run(attachment,course.id,module.id,users.member.id,`courses/${course.id}/${attachment}`,new Date(Date.now()-86400000).toISOString());
 assert.match(await untouched('a course upload awaiting reconciliation'),/awaiting reconciliation/);
 db.prepare('DELETE FROM course_attachments WHERE id=?').run(attachment);
 // A certificate an organiser is uploading for this person right now.
 const certificate=randomUUID();
 db.prepare("INSERT INTO course_certificates (id,course_id,user_id,size,storage_path,status,created_at) VALUES (?,?,?,10,?,'pending',?)").run(certificate,course.id,users.member.id,`certificates/${certificate}`,new Date().toISOString());
 assert.match(await untouched('a certificate being uploaded'),/certificate is being uploaded/);
 db.prepare('DELETE FROM course_certificates WHERE id=?').run(certificate);
 assert.equal((await erase()).status,200);
 assert.equal(db.prepare('SELECT body FROM fiiu_messages WHERE id=?').get(mine.id).body,'');
});

test('per-account limits cap messages while the pulse is never rate limited',async t=>{
 const {ask,post,call}=await setup(t,{app:{talkLimits:{message:3}}});
 const q=await ask();
 for(let i=0;i<3;i++)assert.equal((await post(q,`m${i}`)).status,201);
 const limited=await post(q,'m3');assert.equal(limited.status,429);assert.ok(limited.headers.get('retry-after'));
 assert.equal((await post(q,'de otra cuenta',{actor:'other'})).status,201,'the budget is per account');
 // Venue Wi-Fi: hundreds of phones share one address. More reads than the public read budget (600 a minute per
 // address) all succeed.
 for(let round=0;round<13;round++){
  const statuses=await Promise.all(Array.from({length:50},()=>call('/api/fiiu/pulse',{actor:'guest'}).then(async r=>{await r.arrayBuffer();return r.status;})));
  assert.deepEqual([...new Set(statuses)],[200],`round ${round}`);
 }
});

test('the chat poll remembers a verified session for 30 s by a hash of its token, while other routes and tokens verify each request',async t=>{
 let now=Date.parse('2026-10-21T14:00:00.000Z');
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const repository=createRepository({db}),resolve=repository.resolveSession.bind(repository);let verified=0;
 repository.resolveSession=async(...args)=>{verified++;return resolve(...args);};
 const admin=createUser(db,{fullName:'Flavia Soto',email:'admin@example.test',passwordHash:'unused',role:'admin'});
 const [one,two]=[createSession(db,admin.id),createSession(db,admin.id)].map(s=>s.cookie.split(';')[0]);
 const server=createApp({repository,fiiuStore:createFiiuStore({db}),talkStore:createTalkStore({db}),fiiuConfirmation:null,talkClock:()=>now});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,cookie,{method='GET',body}={})=>fetch(base+path,{method,headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const q=(await (await call('/api/admin/fiiu/questions',one,{method:'POST',body:{activityId:'day1-am',body:'¿Qué te llevas?',status:'open'}})).json()).question;
 const poll=`/api/fiiu/questions/${q.id}/messages?since=0`;
 verified=0;
 for(let i=0;i<3;i++)assert.equal((await call(poll,one)).status,200);
 assert.equal(verified,1,'one verification for three polls');
 assert.equal((await call(`/api/fiiu/questions/${q.id}`,one)).status,200);assert.equal(verified,2,'the page itself verifies');
 assert.equal((await call(`/api/fiiu/questions/${q.id}/messages`,one,{method:'POST',body:{clientId:randomUUID(),body:'hola'}})).status,201);assert.equal(verified,3,'so does a write to the same path');
 assert.equal((await call(poll,two)).status,200);assert.equal(verified,4,'another token verifies');
 // The trade-off: signed out (or suspended) elsewhere, this one read route answers for at most 30 s more.
 assert.equal((await call('/api/auth/logout',two,{method:'POST',body:{}})).status,200);
 assert.equal((await call(poll,two)).status,200);assert.equal(verified,4);
 assert.equal((await call(`/api/fiiu/questions/${q.id}`,two)).status,401,'every other route sees the sign-out at once');
 now+=30000;
 assert.equal((await call(poll,two)).status,401,'and this one after 30 s');
 assert.equal((await call(poll,one)).status,200);assert.equal(verified,7,'an expired entry verifies again');
 // A refused session is never remembered.
 for(let i=0;i<2;i++)assert.equal((await call(poll,'nodal_session=not-a-session')).status,401);
 assert.equal(verified,9);
});

test('rate limit kinds per route, and the pulse branch never asks for one',async()=>{
 const asked=[];
 const api=createTalkApi({store:{pulse:async()=>[]},sameOrigin:()=>true,send:()=>{},rateLimit:(req,res,user,path,kind)=>{asked.push([req.method,path,kind]);return false;}});
 const member={id:'11111111-1111-4111-8111-111111111111',permission:'member'},admin={...member,permission:'admin'};
 const run=(method,path,user=member)=>api({req:{method,headers:{}},res:{},url:new URL(`http://x${path}`),user});
 const q='22222222-2222-4222-8222-222222222222';
 assert.equal(await run('GET','/api/fiiu/pulse',null),true);assert.equal(await run('GET','/api/fiiu/pulse',member),true);
 assert.deepEqual(asked,[]);
 const routes=[['GET',`/api/fiiu/questions?activityId=day1-am`,'read'],['GET',`/api/fiiu/questions/${q}`,'read'],['GET',`/api/fiiu/questions/${q}/messages`,'read'],['POST',`/api/fiiu/questions/${q}/messages`,'message'],
  ['DELETE',`/api/fiiu/messages/${q}`,'write'],['PUT',`/api/fiiu/messages/${q}/like`,'like'],['DELETE',`/api/fiiu/messages/${q}/like`,'like'],['PUT',`/api/fiiu/questions/${q}/rating`,'like'],['POST','/api/fiiu/files','upload'],['GET',`/api/fiiu/files/${q}`,'file'],
  ['GET','/api/admin/fiiu/questions','read',admin],['POST','/api/admin/fiiu/questions','write',admin],['PATCH',`/api/admin/fiiu/questions/${q}`,'write',admin],
  ['PUT',`/api/admin/fiiu/messages/${q}/hidden`,'moderate',admin],['DELETE',`/api/admin/fiiu/messages/${q}/hidden`,'moderate',admin],['GET',`/api/admin/fiiu/questions/${q}/export`,'read',admin],['GET',`/api/admin/fiiu/questions/${q}/qr`,'read',admin]];
 for(const [method,path,kind,user] of routes){asked.length=0;assert.equal(await run(method,path,user),true,path);assert.deepEqual(asked.map(a=>a[2]),[kind],`${method} ${path}`);}
 // Paths outside the contract belong to the FIIU API.
 for(const path of ['/api/fiiu','/api/fiiu/registration','/api/fiiu/checkin','/api/admin/fiiu/summary',`/api/fiiu/questions/${q}/other`,'/api/fiiu/pulse/x'])assert.equal(await run('GET',path),false,path);
});

test('the registration memo keeps at most 5,000 accounts, dropping the oldest first',async()=>{
 let reads=0;
 const store={findRegistration:async()=>{reads++;return {firstName:'Ana',lastName:'Test'};},listQuestions:async()=>[]};
 const api=createTalkApi({store,sameOrigin:()=>true,send:()=>{},clock:()=>1000});
 const id=i=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
 const read=i=>api({req:{method:'GET',headers:{}},res:{},url:new URL('http://x/api/fiiu/questions?activityId=day1-am'),user:{id:id(i),permission:'member'}});
 for(let i=0;i<=5000;i++)await read(i);
 assert.equal(reads,5001);
 await read(1);assert.equal(reads,5001,'still remembered');
 await read(0);assert.equal(reads,5002,'the oldest was dropped');
});

test('the routes send their own refusal codes but leave unexposed errors to the global handler',async()=>{
 const sent=[],hidden=Object.assign(Error('column "secret" of relation "x"'),{status:400,code:'backend_detail',expose:false});
 const api=createTalkApi({store:{findMessage:async()=>{throw hidden;}},sameOrigin:()=>true,send:(res,status,body)=>sent.push({status,body})});
 const run=()=>api({req:{method:'DELETE',headers:{}},res:{},url:new URL('http://x/api/fiiu/messages/22222222-2222-4222-8222-222222222222'),user:{id:'u',permission:'member'}});
 await assert.rejects(run(),err=>err===hidden);assert.deepEqual(sent,[]);
 hidden.expose=undefined;await run();
 assert.deepEqual(sent,[{status:400,body:{error:'column "secret" of relation "x"',code:'backend_detail'}}]);
});

test('the pulse memo answers a burst from one read and lets a write through at once',async()=>{
 let reads=0,t=1000;const sent=[];
 const store={pulse:async()=>{reads++;await new Promise(r=>setTimeout(r,5));return [{id:'q',activityId:'day1-am',revision:reads,status:'open'}];},findMessage:async()=>null};
 const api=createTalkApi({store,sameOrigin:()=>true,send:(res,status,body,headers)=>sent.push({status,body,headers}),clock:()=>t});
 const get=()=>api({req:{method:'GET',headers:{}},res:{},url:new URL('http://x/api/fiiu/pulse'),user:null});
 await Promise.all(Array.from({length:20},get));
 assert.equal(reads,1);assert.equal(sent.length,20);assert.deepEqual(sent[0].body,{questions:[['q','day1-am',1,'open']]});
 assert.equal(sent[0].headers['Cache-Control'],'public, max-age=0, s-maxage=2, stale-while-revalidate=4');
 t+=999;await get();assert.equal(reads,1);
 t+=2;await get();assert.equal(reads,2);assert.deepEqual(sent.at(-1).body.questions[0],['q','day1-am',2,'open']);
 const write=user=>api({req:{method:'DELETE',headers:{}},res:{},url:new URL('http://x/api/fiiu/messages/22222222-2222-4222-8222-222222222222'),user});
 await write(null);await api({req:{method:'POST',headers:{}},res:{},url:new URL('http://x/api/fiiu/pulse'),user:null});await get();
 assert.equal(reads,2,'refused writes keep the memo');
 await write({id:'u',permission:'member'});assert.equal(sent.at(-1).status,404);await get();assert.equal(reads,3,'a write through this instance shows at once');
});

test('the organiser CSV neutralises formulas and fills emails; members cannot download it',async t=>{
 const {call,ask,post}=await setup(t);
 const q=await ask({talk:'¡Bienvenidos al FIIU 11!'});
 await post(q,'=SUM(A1:A9)');await post(q,'hola "a todos"',{actor:'other'});
 assert.equal((await call(`/api/admin/fiiu/questions/${q.id}/export`)).status,403);
 const r=await call(`/api/admin/fiiu/questions/${q.id}/export`,{actor:'admin'});
 assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/^text\/csv/);
 assert.equal(r.headers.get('content-disposition'),`attachment; filename="fiiu-conversation-${q.id.slice(0,8)}.csv"`);
 const lines=(await r.text()).replace(/^﻿/,'').split('\r\n');
 assert.equal(lines[0],'"question","block","talk","createdAtLima","author","email","organiser","text","files","likes","hidden","deleted"');
 assert.equal(lines.length,3);
 assert.match(lines.find(l=>l.includes('SUM')),/^"¿Qué te llevas\?","El poder de lo local","¡Bienvenidos al FIIU 11!","\d{4}-\d{2}-\d{2} \d{2}:\d{2}","Ana Test","member@example\.test","false","'=SUM\(A1:A9\)","","0","false","false"$/);
 assert.match(lines.find(l=>l.includes('Ben')),/"Ben Otro","other@example\.test","false","hola ""a todos"""/);
 assert.equal((await call(`/api/admin/fiiu/questions/${randomUUID()}/export`,{actor:'admin'})).status,404);
});

test('the projector QR points at the configured public origin and is for organisers only',async t=>{
 const keys=['PUBLIC_BASE_URL','NEXT_PUBLIC_APP_URL','VERCEL_URL'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 t.after(()=>{for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
 for(const k of keys)delete process.env[k];process.env.PUBLIC_BASE_URL='https://nodal.example';
 const {json,ask}=await setup(t);
 const q=await ask();
 const r=await json(`/api/admin/fiiu/questions/${q.id}/qr`,{actor:'admin'});
 assert.equal(r.status,200);assert.equal(r.body.url,`https://nodal.example/fiiu-session.html?q=${q.id}`,'the join code opens the session page at its question, with no redirect on the way');
 assert.equal(typeof r.body.qr.size,'number');assert.equal(typeof r.body.qr.bits,'string');
 assert.equal((await json(`/api/admin/fiiu/questions/${q.id}/qr`)).status,403);
 assert.equal((await json(`/api/admin/fiiu/questions/${randomUUID()}/qr`,{actor:'admin'})).status,404);
});

test('cancelling a registration keeps the messages, and access ends once the registration memo expires',async t=>{
 let now=Date.parse('2026-10-21T14:00:00.000Z');
 const {json,ask,post}=await setup(t,{app:{talkClock:()=>now}});
 const q=await ask();
 const m=(await post(q,'me quedo')).body.message;
 assert.equal((await json(`/api/fiiu/questions/${q.id}`)).status,200);
 const {registration}=(await json('/api/fiiu/registration')).body;
 assert.equal((await json('/api/fiiu/registration',{method:'DELETE',body:{version:registration.version,registrationId:registration.id}})).status,200);
 assert.deepEqual((await json(`/api/fiiu/questions/${q.id}`,{actor:'other'})).body.messages.map(x=>x.id),[m.id],'the message stays');
 assert.equal((await json(`/api/fiiu/questions/${q.id}`)).status,200,'within the 60 s memo');
 now+=61000;
 const refused=await json(`/api/fiiu/questions/${q.id}`);assert.equal(refused.status,403);assert.equal(refused.body.code,'not_registered');
 assert.equal((await json(`/api/fiiu/messages/${m.id}`,{method:'DELETE',body:{}})).status,200,'the author can still delete it');
});

test('exportTalkData and deleteTalkData work on the store directly',async()=>{
 const db=createDatabase({filename:':memory:'});
 try{
  const user=createUser(db,{fullName:'Ana Test',email:'ana@example.test',passwordHash:'x'});
  const store=createTalkStore({db});
  assert.deepEqual(await exportTalkData(store,user.id),{messages:[],files:[],likedMessageIds:[],ratings:[]});
  const id=randomUUID(),now=Date.parse('2026-10-21T14:00:00.000Z');
  await store.reserveFile({id,eventId:'fiiu-2026',userId:user.id,name:'a.jpg',mime:'image/jpeg',size:10,width:null,height:null,thumbSize:null,storagePath:`fiiu/${user.id}/${id}`,createdAt:new Date(now-60000).toISOString()});
  await assert.rejects(deleteTalkData(store,user.id,{now}),err=>err.status===409&&/upload is in progress/.test(err.message));
  const q=await store.insertQuestion({id:randomUUID(),eventId:'fiiu-2026',activityId:'general',talk:null,body:'¿Del 1 al 10?',status:'open',kind:'rating',createdBy:null,createdAt:new Date(now).toISOString()});
  await store.setRating(q.id,user.id,6,new Date(now).toISOString());
  assert.deepEqual((await exportTalkData(store,user.id)).ratings.map(r=>[r.question,r.score]),[['¿Del 1 al 10?',6]]);
  await store.updateQuestion(q.id,1,{status:'hidden',updatedAt:new Date(now).toISOString()});
  assert.deepEqual((await exportTalkData(store,user.id)).ratings.map(r=>[r.question,r.score]),[['',6]],'a question hidden since is a draft again: its text is left out');
  await deleteTalkData(store,user.id,{now:now+10*60000});
  assert.equal(await store.findFile(id),null);
  assert.deepEqual(await store.userRatings(user.id),[]);assert.deepEqual((await store.getQuestion(q.id)).ratingCounts,Array(10).fill(0));
 }finally{db.close();}
});
