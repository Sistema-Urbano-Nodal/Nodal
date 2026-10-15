import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createDatabase,createUser} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createApp} from '../server/server.js';
import {createRepository} from '../server/repository.js';
import {createFiiuStore} from '../server/fiiu-repository.js';
import {createTalkStore} from '../server/fiiu-talk-repository.js';
import {createProgramme,mergeProgramme} from '../server/fiiu-programme.js';
import {EVENT_ID} from '../server/fiiu-domain.js';
import {createLive,festivalMilestones} from '../server/fiiu-live.js';

/* The festival live window (GET /api/fiiu/live): what is on now and next, the open conversations, how many people
   reached each badge milestone and the day's numbers, for registered people and organisers. */

// One set of cases for both badge rules: the client's Fiiu.festivalBadges (the console and the check-in page) and the
// server's festivalMilestones (the live counts), so the counts the live window shows are the badges people see.
const CASES=JSON.parse(readFileSync(new URL('./fixtures/fiiu-badge-cases.json',import.meta.url),'utf8'));
const EVENT=JSON.parse(JSON.stringify(mergeProgramme()));
const MILESTONES=['first','three','conferences','lab'];
function clientBadges(){
 const context={window:{nodalI18n:{lang:'es',onChange(){}}},document:{documentElement:{lang:'es'},querySelectorAll:()=>[]},Intl,Date,Error};
 vm.runInNewContext(readFileSync(new URL('../web/scripts/fiiu-ui.js',import.meta.url),'utf8'),context);
 return context.window.Fiiu.festivalBadges;
}
const rows=ids=>ids.map(activityId=>({activityId,createdAt:'2026-10-21T14:12:00.000Z',method:'qr'}));

test('the shared milestone cases cover each milestone both ways',()=>{
 assert.ok(CASES.length>=10);
 for(const k of MILESTONES)for(const value of [true,false])assert.ok(CASES.some(c=>c.milestones[k]===value),`${k} ${value}`);
});
test('the client badge rule earns exactly the milestones of every shared case',()=>{
 const festivalBadges=clientBadges();
 for(const c of CASES){
  const badges=festivalBadges(c.registration,rows(c.attended),EVENT);
  assert.deepEqual(Object.fromEntries(MILESTONES.map(k=>[k,badges.some(b=>b.id==='milestone:'+k&&b.state==='earned')])),c.milestones,c.name);
 }
});
test('the server milestone rule agrees with the client on every shared case, from the attendance alone',()=>{
 for(const c of CASES)assert.deepEqual(festivalMilestones(c.attended,EVENT),c.milestones,c.name);
});

const member={id:'m',permission:'member'},organiser={id:'o',permission:'admin'};
const AT='2026-10-21T14:30:00.000Z';
// Real local stores behind a counter, a switch that makes every store call fail, and a clock the test moves.
async function world(t,{at=AT}={}){
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const fiiu=createFiiuStore({db}),talk=createTalkStore({db});
 const clock={at:Date.parse(at),set(value){clock.at=Date.parse(value);},tick(ms){clock.at+=ms;}};
 const reads={n:0},broken={on:false};
 const counted=store=>new Proxy(store,{get(target,key){const value=target[key];if(typeof value!=='function')return value;
  return (...args)=>{reads.n++;if(broken.on)return Promise.reject(Object.assign(new Error('festival data unavailable'),{status:502}));return value.apply(target,args);};}});
 const logged=[];
 const live=createLive({fiiuStore:counted(fiiu),talkStore:counted(talk),programme:createProgramme({store:counted(fiiu),ttlMs:0,now:()=>clock.at}),clock:()=>clock.at,log:(...args)=>logged.push(args.join(' '))});
 let n=0;
 const person=async(answers={},labStatus='none')=>{
  const user=createUser(db,{fullName:`Persona ${++n}`,email:`p${n}@example.test`,passwordHash:'x'});
  return {...await fiiu.insert('registrations',{id:randomUUID(),eventId:EVENT_ID,userId:user.id,email:user.email,answers:{firstName:'Persona',lastName:String(n),activities:[],...answers},labStatus,version:1,createdAt:at,updatedAt:at}),user};
 };
 const attend=(registration,activityId,createdAt=at)=>fiiu.insert('attendance',{id:randomUUID(),registrationId:registration.id,activityId,confirmedBy:null,createdAt,method:'qr'});
 const ask=(activityId,{body='¿Qué te llevas?',status='open',kind='chat',createdAt=at}={})=>talk.insertQuestion({id:randomUUID(),eventId:EVENT_ID,activityId,talk:null,body,status,kind,createdBy:null,createdAt});
 let tick=0;
 const say=(q,who,body,extra={})=>talk.insertMessage({id:randomUUID(),questionId:q.id,userId:who.user.id,authorName:'María G.',authorFull:'María García',organiser:false,body,clientId:randomUUID(),createdAt:new Date(Date.parse(at)+(++tick)*1000).toISOString(),...extra});
 return {db,fiiu,talk,clock,reads,broken,logged,live,person,attend,ask,say};
}
const block=id=>{const a=EVENT.activities.find(x=>x.id===id);return {id:a.id,title:a.title,date:a.date,time:a.time,venue:a.venue};};

test('the live view has one shape: now and next, every check-in session, conversations, milestone counts and the pulse',async t=>{
 const {live,person,attend}=await world(t);
 const ana=await person({activities:['day1-am','day1-pm']}),beto=await person({activities:['day1-am']});
 await attend(ana,'day1-am','2026-10-21T14:05:00.000Z');await attend(beto,'day1-am','2026-10-21T14:20:00.000Z');
 const view=await live.read(member);
 assert.deepEqual(Object.keys(view),['active','generatedAt','now','next','sessions','conversations','badges','pulse']);
 assert.equal(view.active,true);assert.equal(view.generatedAt,AT);
 assert.deepEqual(view.now,{activity:block('day1-am'),checkedIn:2},'09:30 in Lima, the morning block is under way');
 assert.deepEqual(view.next,{activity:block('day1-pm')});
 assert.deepEqual(view.sessions,[['day0-lab',0],['day1-am',2],['day1-pm',0],['day2-am',0],['day2-pm',0],['day3-am',0]].map(([activityId,checkedIn])=>({activityId,checkedIn})),'every block that takes a check-in, in programme order');
 assert.deepEqual(view.conversations,[]);
 assert.deepEqual(view.badges,{first:2,three:0,conferences:0,lab:0});
 assert.deepEqual(view.pulse,{registered:2,checkedInToday:2,checkedInTotal:2,messages:0,ratings:0});
 assert.doesNotMatch(JSON.stringify(view),new RegExp(`${ana.user.id}|${ana.id}|Persona|p1@example`),'counts only: no person\'s id, registration, name or email');
});

test('now is the check-in block under way in Lima, next the one to start after it, across midnight and evening blocks',async t=>{
 const {live,clock}=await world(t,{at:'2026-10-15T15:00:00.000Z'});
 const at=[
  ['2026-10-15T15:00:00.000Z',null,'day0-lab','days before the festival'],
  ['2026-10-20T04:59:00.000Z',null,'day0-lab','23:59 on the 19th in Lima'],
  ['2026-10-20T15:00:00.000Z',null,'day0-lab','the untimed laboratory is never under way, only next, all its day'],
  ['2026-10-21T04:59:00.000Z',null,'day0-lab','still its day at 23:59 in Lima'],
  ['2026-10-21T05:00:00.000Z',null,'day1-am','midnight in Lima ends it'],
  ['2026-10-21T14:00:00.000Z','day1-am','day1-pm','a block starts on the minute'],
  ['2026-10-21T17:59:00.000Z','day1-am','day1-pm',''],
  ['2026-10-21T18:00:00.000Z',null,'day1-pm','and ends on the minute'],
  ['2026-10-22T00:00:00.000Z','day1-pm','day2-am','19:00 in Lima is already the 22nd in UTC'],
  ['2026-10-22T01:59:00.000Z','day1-pm','day2-am',''],
  ['2026-10-22T02:00:00.000Z',null,'day2-am',''],
  ['2026-10-23T14:30:00.000Z','day3-am',null,'the last block that takes a check-in has nothing after it (the party takes none)'],
  ['2026-10-25T23:00:00.000Z',null,null,''],
 ];
 for(const [iso,now,next,why] of at){
  clock.set(iso);const view=await live.read(member);
  assert.deepEqual([view.now?.activity.id??null,view.next?.activity.id??null],[now,next],`${iso} ${why}`);
  if(view.next)assert.deepEqual(Object.keys(view.next),['activity'],'next carries no count: nobody has checked in to it yet');
 }
});

test('the window is active during the festival in Lima, and always for organisers, as a preview outside it',async t=>{
 const {live,clock}=await world(t,{at:'2026-10-20T04:59:00.000Z'});
 const at=[['2026-10-20T04:59:00.000Z',false],['2026-10-20T05:00:00.000Z',true],['2026-10-23T12:00:00.000Z',true],['2026-10-26T04:59:00.000Z',true],['2026-10-26T05:00:00.000Z',false],['2026-11-02T15:00:00.000Z',false]];
 for(const [iso,active] of at){clock.set(iso);assert.equal((await live.read(member)).active,active,iso);assert.equal((await live.read(organiser)).active,true,`${iso} organiser`);}
 // Outside the dates the content is the same for both: only active differs.
 const {active:a,...forMember}=await live.read(member),{active:b,...forOrganiser}=await live.read(organiser);
 assert.deepEqual([a,b],[false,true]);assert.deepEqual(forMember,forOrganiser);
});

test('milestone counts are people whose attendance reaches each one, by the shared rule, and the pulse counts check-ins since Lima midnight',async t=>{
 const {live,person,attend}=await world(t);
 for(const c of CASES){const r=await person(c.registration.answers,c.registration.labStatus);for(const id of new Set(c.attended))await attend(r,id,'2026-10-20T15:00:00.000Z');}
 await person({activities:['day3-am']});
 const expected=Object.fromEntries(MILESTONES.map(k=>[k,CASES.filter(c=>c.milestones[k]).length]));
 const view=await live.read(member);
 assert.deepEqual(view.badges,expected);
 const rowsCounted=CASES.reduce((n,c)=>n+[...new Set(c.attended)].filter(id=>!['closing-party','not-an-activity'].includes(id)).length,0);
 assert.deepEqual(view.pulse,{registered:CASES.length+1,checkedInToday:0,checkedInTotal:rowsCounted,messages:0,ratings:0},'rows of the 20th, read on the 21st, are not today\'s; the party and unknown activities are no check-in');
 assert.equal(view.sessions.find(s=>s.activityId==='day1-am').checkedIn,CASES.filter(c=>c.attended.includes('day1-am')).length);
});

test('checked in today starts at midnight in Lima',async t=>{
 const {live,person,attend}=await world(t);
 const ana=await person({activities:['day1-am']}),beto=await person({activities:['day1-am']}),carla=await person({activities:['day1-am']});
 await attend(ana,'day1-am','2026-10-21T04:59:59.000Z');await attend(beto,'day1-am','2026-10-21T05:00:00.000Z');await attend(carla,'day1-am','2026-10-21T14:29:00.000Z');
 assert.deepEqual((await live.read(member)).pulse,{registered:3,checkedInToday:2,checkedInTotal:3,messages:0,ratings:0});
});

// The band words them so ("Asistencias hoy", "Asistencias en total"); people are the milestone counts.
test('the day\'s numbers are check-ins, not people: one person at the morning and the evening block counts twice',async t=>{
 // 19:30 on the 21st in Lima, already the 22nd in UTC.
 const {live,person,attend}=await world(t,{at:'2026-10-22T00:30:00.000Z'});
 const ana=await person({activities:['day1-am','day1-pm']});
 await attend(ana,'day1-am','2026-10-21T14:05:00.000Z');await attend(ana,'day1-pm','2026-10-22T00:10:00.000Z');
 const view=await live.read(member);
 assert.deepEqual(view.pulse,{registered:1,checkedInToday:2,checkedInTotal:2,messages:0,ratings:0});
 assert.equal(view.badges.first,1,'one person');assert.deepEqual(view.now,{activity:block('day1-pm'),checkedIn:1});
});

test('conversations are the open questions, most recently active first, at most five, with their latest visible answer cut short',async t=>{
 const {talk,live,person,ask,say,clock}=await world(t);
 const ana=await person({activities:['day1-am']});
 const quiet=await ask('day1-am',{body:'¿Pregunta tranquila?',createdAt:'2026-10-21T13:00:00.000Z'});
 const busy=await ask('day1-am',{body:'¿Qué te llevas?'.padEnd(400,' y más'),createdAt:'2026-10-21T13:01:00.000Z'});
 const general=await ask('general',{body:'¿Qué te ha gustado del festival?',createdAt:'2026-10-21T13:02:00.000Z'});
 const closed=await ask('day2-am',{body:'Cerrada',status:'closed'}),hidden=await ask('day1-pm',{body:'Borrador',status:'hidden'});
 const shown=await say(busy,ana,'Una respuesta visible '+'😀'.repeat(300));
 const later=await say(busy,ana,'Oculta por moderación');await talk.updateMessage({id:later.id},{hiddenAt:new Date(clock.at).toISOString()});
 const gone=await say(busy,ana,'Retirada');await talk.updateMessage({id:gone.id},{body:'',deletedAt:new Date(clock.at).toISOString()});
 await say(general,ana,'Hola desde General');
 for(const q of [closed,hidden])await say(q,ana,'No se ve aquí');
 await say(hidden,ana,'Ni esta');
 const view=await live.read(member);
 assert.deepEqual(view.conversations.map(c=>c.questionId),[general.id,busy.id,quiet.id],'the newest answer first; the closed and the hidden question never');
 const [g,b,qq]=view.conversations;
 assert.deepEqual(Object.keys(b),['questionId','activityId','activityTitle','body','kind','messageCount','latest','rating']);
 assert.equal(g.activityTitle,'FIIU General');assert.equal(g.activityId,'general');assert.equal(b.activityTitle,'El poder de lo local');
 assert.equal(b.messageCount,1,'visible answers only');assert.equal(b.kind,'chat');assert.equal(b.rating,null);
 assert.ok([...b.body].length<=180&&[...b.body].length>170);assert.ok(b.body.endsWith('…'));assert.ok(b.body.startsWith('¿Qué te llevas?'));
 assert.deepEqual({...b.latest,body:undefined},{author:'María G.',body:undefined,likeCount:0,createdAt:shown.createdAt},'the newest answer still visible, not the hidden or withdrawn ones');
 assert.equal([...b.latest.body].length,140);assert.ok(b.latest.body.endsWith('…'));assert.equal(b.latest.body.isWellFormed(),true,'never half an emoji');
 assert.equal(qq.latest,null);assert.equal(qq.body,'¿Pregunta tranquila?','a short question is untouched');
 assert.doesNotMatch(JSON.stringify(view),/No se ve aquí|Ni esta|Borrador|Oculta|Retirada|María García/);
 assert.equal(view.pulse.messages,3,'two visible answers on open questions and one on the closed one; none on the hidden question');
 // At most five, the quiet ones left out.
 for(let i=0;i<5;i++)await say(await ask('day2-am',{body:`Nueva ${i}`}),ana,`Respuesta ${i}`);
 clock.tick(15000);
 const five=(await live.read(member)).conversations;
 assert.deepEqual(five.map(c=>c.body),['Nueva 4','Nueva 3','Nueva 2','Nueva 1','Nueva 0']);
});

test('a rating question carries its average to one decimal and its count, and a hidden one counts in no total',async t=>{
 const {talk,live,person,ask,clock}=await world(t);
 const people=await Promise.all([1,2,3,4].map(()=>person({activities:['day1-am']})));
 const rating=await ask('day1-am',{body:'¿Cómo calificas la sesión?',kind:'rating'}),empty=await ask('day1-pm',{body:'¿Y esta?',kind:'rating',createdAt:'2026-10-21T13:00:00.000Z'});
 const draft=await ask('day2-am',{body:'Borrador',kind:'rating'});
 for(const [i,score] of [[0,9],[1,10],[2,8]])await talk.setRating(rating.id,people[i].user.id,score,new Date(clock.at).toISOString());
 for(const [i,score] of [[0,1],[3,2]])await talk.setRating(draft.id,people[i].user.id,score,new Date(clock.at).toISOString());
 await talk.updateQuestion(draft.id,1,{status:'hidden',updatedAt:new Date(clock.at).toISOString()});
 const view=await live.read(member);
 const byId=Object.fromEntries(view.conversations.map(c=>[c.questionId,c]));
 assert.deepEqual(byId[rating.id].rating,{average:9,count:3});assert.equal(byId[rating.id].kind,'rating');
 assert.deepEqual(byId[empty.id].rating,{average:null,count:0},'no scores yet');
 assert.equal(byId[draft.id],undefined);
 assert.equal(view.pulse.ratings,3,'the hidden question\'s two scores are left out');
 await talk.setRating(empty.id,people[0].user.id,7,new Date(clock.at).toISOString());await talk.setRating(empty.id,people[1].user.id,8,new Date(clock.at).toISOString());await talk.setRating(empty.id,people[2].user.id,8,new Date(clock.at).toISOString());
 clock.tick(15000);
 assert.deepEqual((await live.read(member)).conversations.find(c=>c.questionId===empty.id).rating,{average:7.7,count:3});
});

test('blocks follow the programme as organisers edited it',async t=>{
 const {fiiu,live,ask,clock}=await world(t);
 const q=await ask('day1-am');
 await fiiu.insert('programme',{id:'day1-am',eventId:EVENT_ID,data:{title:'El poder de lo local (sala nueva)',time:'15:00–17:00',venue:'Sala 2'},version:1,updatedBy:null,updatedAt:AT});
 const view=await live.read(member);
 assert.equal(view.now,null,'09:30 in Lima is before its new start');
 assert.deepEqual(view.next,{activity:{id:'day1-am',title:'El poder de lo local (sala nueva)',date:'2026-10-21',time:'15:00–17:00',venue:'Sala 2'}});
 assert.equal(view.conversations.find(c=>c.questionId===q.id).activityTitle,'El poder de lo local (sala nueva)');
 clock.set('2026-10-21T20:30:00.000Z');assert.equal((await live.read(member)).now.activity.id,'day1-am');
});

test('the view is built at most every 15 s per instance, concurrent reads share one build, and a failed build serves the last one',async t=>{
 const {live,reads,broken,clock,logged,person}=await world(t);
 await person({activities:['day1-am']});
 // Nothing to fall back on yet: the failure is the caller's, and nothing is kept.
 broken.on=true;await assert.rejects(live.read(member),/festival data unavailable/);broken.on=false;
 reads.n=0;
 const [one,two]=await Promise.all([live.read(member),live.read(organiser)]);
 const perBuild=reads.n;assert.ok(perBuild>0);
 assert.equal(one.generatedAt,two.generatedAt);assert.equal(one.pulse.registered,1);
 clock.tick(14999);await live.read(member);assert.equal(reads.n,perBuild,'a read inside 15 s reads no store');
 clock.tick(1);const fresh=await live.read(member);assert.equal(reads.n,2*perBuild,'after 15 s the stores are read again');assert.notEqual(fresh.generatedAt,one.generatedAt);
 await person({activities:['day1-am']});
 clock.tick(15000);broken.on=true;
 const stale=await live.read(member);assert.equal(stale.generatedAt,fresh.generatedAt,'the last view, saying when it was made');assert.equal(stale.pulse.registered,1);
 assert.equal(logged.length,1);
 const during=reads.n;await live.read(member);assert.equal(reads.n,during,'a failure is not retried on every request of the window');
 broken.on=false;clock.tick(15000);assert.equal((await live.read(member)).pulse.registered,2,'and the next window reads again');
});

test('clear() drops the kept view, so the next read builds again inside the 15 s, and a failed build still serves the last one',async t=>{
 const {live,reads,broken,clock,logged,person}=await world(t);
 await person({activities:['day1-am']});
 await live.read(member);const perBuild=reads.n;
 await person({activities:['day1-am']});
 live.clear();
 const again=await live.read(member);assert.equal(reads.n,2*perBuild,'read again without the clock moving');assert.equal(again.pulse.registered,2);
 await live.read(member);assert.equal(reads.n,2*perBuild,'and kept for its own 15 s');
 clock.tick(1000);live.clear();broken.on=true;
 const stale=await live.read(member);assert.equal(stale.generatedAt,again.generatedAt,'the outage fallback is untouched');assert.equal(logged.length,1);
});

/* Over HTTP: member (Ana Test) is registered, stranger is signed in without a registration, admin organises without
   one, guest has no session. */
async function app(t,{at=AT,repository}={}){
 let now=Date.parse(at);
 const db=repository?.database??createDatabase({filename:':memory:'});t.after(()=>db.close());
 const cookies={},users={};
 for(const name of ['member','stranger','admin']){users[name]=createUser(db,{fullName:name==='member'?'Ana Test':name,email:`${name}@example.test`,passwordHash:'unused',role:name==='admin'?'admin':'member'});cookies[name]=createSession(db,users[name].id).cookie.split(';')[0];}
 const server=createApp({...(repository?{repository}:{db}),fiiuStore:createFiiuStore({db}),talkStore:createTalkStore({db}),fiiuConfirmation:null,talkClock:()=>now});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,{actor='member',method='GET',body,cookie}={})=>fetch(base+path,{method,redirect:'manual',headers:{...(cookie||cookies[actor]?{Cookie:cookie??cookies[actor]}:{}),Origin:base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const answers={firstName:'Ana',lastName:'Test',country:'Perú',city:'Lima',profile:'professional',publicOfficial:false,activities:['day1-am'],externalActivities:[],nationalId:'TEST-ID',gender:'prefer_not',age:30,accessibility:['none'],motivation:'learn',previousAttendance:'no',privacyAccepted:true};
 assert.equal((await call('/api/fiiu/registration',{method:'PUT',body:{version:0,...answers}})).status,200);
 return {db,users,cookies,call,clock:{tick(ms){now+=ms;}}};
}

test('the live route answers registered people and organisers, privately and never stored, and nobody else',async t=>{
 const {call}=await app(t);
 const guest=await call('/api/fiiu/live',{actor:'guest'});assert.equal(guest.status,401);
 const stranger=await call('/api/fiiu/live',{actor:'stranger'});assert.equal(stranger.status,403);assert.deepEqual(await stranger.json(),{error:'festival registration required',code:'not_registered'});
 for(const actor of ['member','admin']){
  const response=await call('/api/fiiu/live',{actor});assert.equal(response.status,200,actor);
  assert.equal(response.headers.get('cache-control'),'private, no-store',actor);
  const body=await response.json();assert.equal(body.active,true);assert.equal(body.pulse.registered,1);assert.equal(body.now.activity.id,'day1-am');
 }
 const head=await call('/api/fiiu/live',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 const post=await call('/api/fiiu/live',{method:'POST',body:{}});assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET, HEAD');
 assert.equal((await call('/api/fiiu/live/x')).status,404,'only the one route');
});

/* Review Focus 3 over HTTP: what an organiser hides or takes down, and what an author withdraws, leaves the instance's
   live view at once rather than staying on the band for the rest of its 15 s; a new answer may wait for the next window. */
test('a hidden, withdrawn or taken-down answer or question leaves the live view at once, not 15 s later',async t=>{
 const {call,clock}=await app(t);
 const json=async(path,options)=>{const r=await call(path,options);return {status:r.status,body:await r.json()};};
 const q=(await json('/api/admin/fiiu/questions',{actor:'admin',method:'POST',body:{activityId:'day1-am',body:'¿Qué te llevas?',status:'open'}})).body.question;
 const post=async body=>{clock.tick(1);const r=await json(`/api/fiiu/questions/${q.id}/messages`,{method:'POST',body:{clientId:randomUUID(),body}});assert.equal(r.status,201);return r.body.message;};
 const conversation=async(actor='member')=>(await json('/api/fiiu/live',{actor})).body.conversations.find(c=>c.questionId===q.id)??null;
 const first=await post('Primera respuesta'),second=await post('Segunda respuesta');
 assert.equal((await conversation()).latest.body,'Segunda respuesta');
 assert.equal((await json(`/api/admin/fiiu/messages/${second.id}/hidden`,{actor:'admin',method:'PUT',body:{}})).status,200);
 const afterHide=await conversation();assert.equal(afterHide.latest.body,'Primera respuesta','an organiser hid it');assert.equal(afterHide.messageCount,1);
 assert.equal((await json(`/api/fiiu/messages/${first.id}`,{method:'DELETE',body:{}})).status,200);
 const afterWithdraw=await conversation();assert.equal(afterWithdraw.latest,null,'its author withdrew it');assert.equal(afterWithdraw.messageCount,0);
 await post('Tercera respuesta');
 assert.equal((await conversation()).latest,null,'a new answer waits for the next window');
 clock.tick(15000);assert.equal((await conversation()).latest.body,'Tercera respuesta');
 const version=(await json('/api/admin/fiiu/questions',{actor:'admin'})).body.questions.find(x=>x.id===q.id).version;
 assert.equal((await json(`/api/admin/fiiu/questions/${q.id}`,{actor:'admin',method:'PATCH',body:{version,body:'¿Qué te llevas hoy?'}})).status,200);
 assert.equal((await conversation()).body,'¿Qué te llevas hoy?','an edit of the question shows at once');
 assert.equal((await json(`/api/admin/fiiu/questions/${q.id}`,{actor:'admin',method:'PATCH',body:{version:version+1,status:'hidden'}})).status,200);
 assert.equal(await conversation(),null,'a question taken back to a draft');
 assert.doesNotMatch(JSON.stringify((await json('/api/fiiu/live')).body),/Primera|Segunda|Tercera/);
});

test('an account deleted with its festival messages leaves the live view at once',async t=>{
 const {call,clock}=await app(t);
 const json=async(path,options)=>{const r=await call(path,options);return {status:r.status,body:await r.json()};};
 const q=(await json('/api/admin/fiiu/questions',{actor:'admin',method:'POST',body:{activityId:'day1-am',body:'¿Qué te llevas?',status:'open'}})).body.question;
 clock.tick(1);assert.equal((await json(`/api/fiiu/questions/${q.id}/messages`,{method:'POST',body:{clientId:randomUUID(),body:'Una respuesta de Ana'}})).status,201);
 const latest=async()=>(await json('/api/fiiu/live',{actor:'admin'})).body.conversations.find(c=>c.questionId===q.id).latest;
 assert.equal((await latest()).body,'Una respuesta de Ana');
 assert.equal((await call('/api/me',{method:'DELETE',body:{confirmEmail:'member@example.test'}})).status,200);
 assert.equal(await latest(),null,'her answer and her name are gone from the window too');
});

test('the live route reuses a verified session for 30 s, as the chat poll does, so polling phones do not each ask the auth provider',async t=>{
 const db=createDatabase({filename:':memory:'});
 const repository=createRepository({db}),resolve=repository.resolveSession.bind(repository);let verified=0;
 repository.resolveSession=async(...args)=>{verified++;return resolve(...args);};
 const {call,clock}=await app(t,{repository});
 verified=0;
 for(let i=0;i<3;i++)assert.equal((await call('/api/fiiu/live')).status,200);
 assert.equal(verified,1,'one verification for three reads');
 assert.equal((await call('/api/fiiu/registration')).status,200);assert.equal(verified,2,'other routes verify every request');
 clock.tick(30000);
 assert.equal((await call('/api/fiiu/live')).status,200);assert.equal(verified,3,'after 30 s the session is verified again');
 for(let i=0;i<2;i++)assert.equal((await call('/api/fiiu/live',{cookie:'nodal_session=not-a-session'})).status,401);
 assert.equal(verified,5,'a refused session is never remembered');
});
