import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDatabase,createUser} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createApp} from '../server/server.js';
import {createFiiuStore} from '../server/fiiu-repository.js';
import {FIIU_EVENT,applicationStatus} from '../server/fiiu-domain.js';

const answers={firstName:'Ana',lastName:'Test',country:'Perú',city:'Lima',profile:'professional',publicOfficial:false,activities:['day1-am'],externalActivities:[],nationalId:'TEST-ID',gender:'prefer_not',age:30,accessibility:['none'],motivation:'learn',previousAttendance:'no',privacyAccepted:true};
async function setup(t,wrapStore=store=>store){
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const cookies={},users={};
 for(const name of ['member','other','admin']){users[name]=createUser(db,{fullName:name,email:`${name}@example.test`,passwordHash:'unused',role:name==='admin'?'admin':'member'});cookies[name]=createSession(db,users[name].id).cookie.split(';')[0];}
 const server=createApp({db,fiiuStore:wrapStore(createFiiuStore({db}))});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,{actor='member',method='GET',body,origin=base}={})=>fetch(base+path,{method,redirect:'manual',headers:{...(cookies[actor]?{Cookie:cookies[actor]}:{}),Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const save=(body=answers,actor='member')=>call('/api/fiiu/registration',{actor,method:'PUT',body:{version:0,...body}});
 return {db,call,save,users,cookies};
}

test('a newly created local account can register, sign out, sign back in and recover its event registration',async t=>{
 const {call,save,cookies}=await setup(t);
 const credentials={email:'new-attendee@example.test',password:'LocalReadiness!2026',fullName:'New attendee'};
 const signup=await call('/api/auth/signup',{actor:'guest',method:'POST',body:credentials});assert.equal(signup.status,201);
 const account=await signup.json();cookies.attendee=signup.headers.getSetCookie()[0].split(';')[0];assert.ok(account.user.id);
 const saved=await save({...answers,expectedUserId:account.user.id},'attendee');assert.equal(saved.status,200);const {registration}=await saved.json();
 const logout=await call('/api/auth/logout',{actor:'attendee',method:'POST',body:{}});assert.equal(logout.status,200);
 assert.equal((await call('/api/fiiu/registration',{actor:'attendee'})).status,401);
 const login=await call('/api/auth/login',{actor:'guest',method:'POST',body:credentials});assert.equal(login.status,200);cookies.attendee=login.headers.getSetCookie()[0].split(';')[0];
 const me=await(await call('/api/fiiu/registration',{actor:'attendee'})).json();assert.equal(me.registration.id,registration.id);assert.equal(me.registration.email,credentials.email);
});

test('festival is discoverable before login, but registrations and admin data are protected',async t=>{
 const {call}=await setup(t);
 const response=await call('/api/fiiu',{actor:'guest'});assert.equal(response.status,200);
 const {event}=await response.json();assert.equal(event.id,'fiiu-2026');assert.equal(event.activities.filter(a=>a.registration==='general').length,5);
 assert.equal((await call('/api/fiiu/registration',{actor:'guest'})).status,401);
 assert.equal((await call('/api/admin/fiiu/registrations')).status,403);
 assert.equal((await call('/fiiu.html',{actor:'guest'})).status,200);
 assert.equal((await call('/fiiu-admin.html',{actor:'guest'})).status,302);
 assert.equal((await call('/fiiu-admin.html')).status,403);
 assert.equal((await call('/fiiu-admin.html',{actor:'admin'})).status,200);
});

test('registration persists privately, updates by version, and cannot grant acceptance or badges',async t=>{
 const {call,save,db}=await setup(t);
 let response=await save({...answers,email:'spoof@example.test',labStatus:'accepted',attendance:['day1-am']});assert.equal(response.status,200);
 let {registration}=await response.json();assert.equal(registration.email,'member@example.test');assert.equal(registration.labStatus,'none');assert.equal(registration.version,1);
 assert.deepEqual((await(await call('/api/fiiu/registration')).json()).attendance,[]);
 assert.equal((await(await call('/api/fiiu/registration',{actor:'other'})).json()).registration,null);
 assert.equal((await save({...answers,firstName:'Stale'})).status,409);
 response=await save({...answers,registrationId:registration.id,version:1,activities:['day2-pm']});assert.equal(response.status,200);
 registration=(await response.json()).registration;assert.equal(registration.version,2);assert.deepEqual(registration.answers.activities,['day2-pm']);
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_registrations').get().n,1);
 assert.equal((await call('/api/fiiu/registration',{method:'PUT',body:{version:2,...answers},origin:'https://elsewhere.test'})).status,403);
});

test('general choices and public-official applications are validated on the server',async t=>{
 const {save,call}=await setup(t);
 for(const invalid of [{activities:[]},{activities:['workshop-day1']},{activities:['day1-am','unknown']},{privacyAccepted:false},{publicOfficial:'yes'},{age:200},{firstName:''},{applyLab:true}])assert.equal((await save({...answers,...invalid})).status,400,JSON.stringify(invalid));
 assert.equal((await save({...answers,publicOfficial:true,applyLab:true,institution:''})).status,400);
 const response=await save({...answers,activities:[],publicOfficial:true,applyLab:true,institution:'Municipality',position:'Planner'});assert.equal(response.status,200);
 const {registration}=await response.json();assert.equal(registration.labStatus,'pending');
 assert.equal((await call(`/api/admin/fiiu/registrations/${registration.id}`,{method:'PATCH',body:{version:1,labStatus:'accepted'}})).status,403);
 assert.equal((await call(`/api/admin/fiiu/registrations/${registration.id}`,{actor:'admin',method:'PATCH',body:{version:1,labStatus:'accepted'}})).status,200);
 const updated=await save({...answers,registrationId:registration.id,version:2,publicOfficial:true,applyLab:true,institution:'Changed institution',position:'Planner'});
 assert.equal((await updated.json()).registration.labStatus,'pending','eligibility changes require review again');
});

test('concurrent first registrations produce one row and a recoverable conflict',async t=>{
 const {save,db}=await setup(t);
 const results=await Promise.all([save(),save()]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_registrations').get().n,1);
});

test('a form opened for another account cannot save or cancel after the session changes',async t=>{
 const {call,save,users,db}=await setup(t);
 const me=await(await call('/api/fiiu/registration')).json();assert.equal(me.user.id,users.member.id);
 for(const actor of ['member','other']){
  const staleId=actor==='member'?users.other.id:users.member.id;
  const response=await save({...answers,expectedUserId:staleId},actor);
  assert.equal(response.status,409);assert.equal((await response.json()).error,'account changed; reload before continuing');
 }
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_registrations').get().n,0);
 const {registration}=await(await save({...answers,expectedUserId:users.member.id})).json();
 const staleCancel=await call('/api/fiiu/registration',{method:'DELETE',body:{version:registration.version,registrationId:registration.id,expectedUserId:users.other.id}});
 assert.equal(staleCancel.status,409);assert.equal((await(await call('/api/fiiu/registration')).json()).registration.id,registration.id);
 assert.equal((await call('/api/fiiu/registration',{method:'DELETE',body:{version:registration.version,registrationId:registration.id,expectedUserId:users.member.id}})).status,200);
});

test('storage failures never confirm a registration and a later retry can persist once',async t=>{
 let failing=true;
 const {save,call,db}=await setup(t,store=>({...store,async insert(name,record){if(failing&&name==='registrations')throw Object.assign(Error('private provider details'),{status:503,expose:false});return store.insert(name,record);}}));
 const failed=await save();assert.equal(failed.status,503);assert.doesNotMatch(await failed.text(),/private provider details/);
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_registrations').get().n,0);
 failing=false;const saved=await save();assert.equal(saved.status,200);
 const {registration}=await saved.json();assert.equal((await(await call('/api/fiiu/registration')).json()).registration.id,registration.id);
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_registrations').get().n,1);
});

test('a shared venue IP can load the public festival for 300 guests with one retry each while account budgets stay separate',async t=>{
 const {call,save}=await setup(t);
 for(let i=0;i<600;i++){const response=await call('/api/fiiu',{actor:'guest'});assert.equal(response.status,200,`public read ${i+1}`);await response.arrayBuffer();}
 const limited=await call('/api/fiiu',{actor:'guest'});assert.equal(limited.status,429);assert.match(limited.headers.get('retry-after'),/^\d+$/);
 for(let i=0;i<120;i++){const response=await call('/api/fiiu/registration');assert.equal(response.status,200);await response.arrayBuffer();}
 assert.equal((await call('/api/fiiu/registration')).status,429);
 assert.equal((await call('/api/fiiu/registration',{actor:'other'})).status,200);
 assert.equal((await save()).status,200,'read budgets do not block registration writes');
});

test('only staff can confirm eligible attendance and badges are separate from pre-registration',async t=>{
 const {call,save}=await setup(t);const {registration}=await(await save()).json();
 const route=`/api/admin/fiiu/registrations/${registration.id}/attendance`;
 assert.equal((await call(route,{method:'PUT',body:{activityId:'day1-am',attended:true}})).status,403);
 assert.equal((await call(route,{actor:'admin',method:'PUT',body:{activityId:'day2-am',attended:true}})).status,400);
 assert.equal((await call(route,{actor:'admin',method:'PUT',body:{activityId:'day0-lab',attended:true}})).status,400);
 assert.equal((await call(route,{actor:'admin',method:'PUT',body:{activityId:'day1-am',attended:true}})).status,200);
 assert.equal((await call(route,{actor:'admin',method:'PUT',body:{activityId:'day1-am',attended:true}})).status,200);
 let me=await(await call('/api/fiiu/registration')).json();assert.equal(me.attendance.length,1);assert.equal(me.attendance[0].activityId,'day1-am');
 assert.equal((await call(route,{actor:'admin',method:'PUT',body:{activityId:'day1-am',attended:false}})).status,200);
 me=await(await call('/api/fiiu/registration')).json();assert.deepEqual(me.attendance,[]);
});

test('published news and safe external links are managed by staff; drafts stay private',async t=>{
 const {call}=await setup(t);
 const draft={title:'Programme update',body:'Bring water.',status:'draft',kind:'news',url:'https://fiiu.sistemaurbano.org/',activityId:''};
 assert.equal((await call('/api/admin/fiiu/content',{method:'POST',body:draft})).status,403);
 const created=await call('/api/admin/fiiu/content',{actor:'admin',method:'POST',body:draft});assert.equal(created.status,201);const {content}=await created.json();
 assert.equal((await(await call('/api/fiiu',{actor:'guest'})).json()).content.length,0);
 assert.equal((await call(`/api/admin/fiiu/content/${content.id}`,{actor:'admin',method:'PATCH',body:{...draft,version:1,status:'published'}})).status,200);
 assert.equal((await(await call('/api/fiiu',{actor:'guest'})).json()).content[0].title,'Programme update');
 assert.equal((await call('/api/admin/fiiu/config',{actor:'admin',method:'PUT',body:{version:0,registrationOpen:true,workshopsUrl:'javascript:alert(1)'}})).status,400);
 assert.equal((await call('/api/admin/fiiu/config',{actor:'admin',method:'PUT',body:{version:0,registrationOpen:false,workshopsUrl:'https://example.test/workshops'}})).status,200);
 assert.equal((await call('/api/fiiu/registration',{method:'PUT',body:{version:0,...answers}})).status,403);
});

test('staff export escapes formulas; personal export and deletion include festival records',async t=>{
 const {save,call,db}=await setup(t);await save({...answers,firstName:'=HYPERLINK("x")',nationalId:'TEST-ID',accessibility:['mobility']});
 const exported=await(await call('/api/me/export')).json();assert.equal(exported.data.fiiu.registration.answers.nationalId,'TEST-ID');
 const csv=await call('/api/admin/fiiu/export',{actor:'admin'});assert.equal(csv.status,200);assert.match(await csv.text(),/'=HYPERLINK/);
 assert.equal((await call('/api/me',{method:'DELETE',body:{confirmEmail:'member@example.test'}})).status,200);
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_registrations').get().n,0);
});

test('cancellation detects an intervening save and preserves the newer registration',async t=>{
 const {call,save}=await setup(t,store=>({...store,async remove(name,filters){
  if(name==='registrations')await store.update(name,{id:filters.id},{version:filters.version+1});
  return store.remove(name,filters);
 }}));
 const {registration:r}=await(await save()).json();
 assert.equal((await call('/api/fiiu/registration',{method:'DELETE',body:{version:r.version,registrationId:r.id}})).status,409);
 assert.equal((await(await call('/api/fiiu/registration')).json()).registration.version,2);
});

test('a stale form cannot change or cancel a replacement registration with the same version',async t=>{
 const {call,save}=await setup(t);const {registration:a}=await(await save()).json();
 assert.equal((await call('/api/fiiu/registration',{method:'DELETE',body:{version:a.version,registrationId:a.id}})).status,200);
 const {registration:b}=await(await save({...answers,city:'Callao'})).json();assert.notEqual(a.id,b.id);
 assert.equal((await save({...answers,version:a.version,registrationId:a.id})).status,409);
 assert.equal((await call('/api/fiiu/registration',{method:'DELETE',body:{version:a.version,registrationId:a.id}})).status,409);
 assert.equal((await(await call('/api/fiiu/registration')).json()).registration.answers.city,'Callao');
});

test('publication pages include the newest post first and expose all records without duplication',async t=>{
 const {call,db}=await setup(t);const store=createFiiuStore({db});
 for(let i=0;i<201;i++)await store.insert('content',{id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,eventId:'fiiu-2026',data:{title:'Post '+i,body:'',kind:'news',url:'',activityId:''},status:'published',version:1,createdAt:i===200?'2026-09-29T12:00:00.000Z':'2026-09-28T12:00:00.000Z',updatedAt:'2026-09-29T12:00:00.000Z'});
 for(const route of ['/api/fiiu','/api/admin/fiiu/content']){
  const ids=[];let cursor;do{
   const response=await call(route+(cursor?'?cursor='+encodeURIComponent(cursor):''),{actor:'admin'});assert.equal(response.status,200);
   const page=await response.json();if(!ids.length)assert.equal(page.content[0].title,'Post 200');
   ids.push(...page.content.map(c=>c.id));cursor=page.nextCursor;
  }while(cursor);
  assert.equal(ids.length,201);assert.equal(new Set(ids).size,201);
 }
});

test('news filtering happens before pagination so newer materials cannot hide published news',async t=>{
 const {call,db}=await setup(t);const store=createFiiuStore({db});
 for(let i=0;i<102;i++)await store.insert('content',{id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,eventId:'fiiu-2026',data:{title:'Post '+i,body:'',kind:i<2?'news':'material',url:'https://example.test/material',activityId:''},status:i===1?'draft':'published',version:1,createdAt:i<2?'2026-09-28T12:00:00.000Z':'2026-09-29T12:00:00.000Z',updatedAt:'2026-09-29T12:00:00.000Z'});
 const page=await(await call('/api/fiiu?kind=news')).json();
 assert.deepEqual(page.content.map(item=>item.title),['Post 0']);assert.equal(page.nextCursor,null);
 const materials=await(await call('/api/fiiu?kind=material')).json();assert.equal(materials.content.length,100);assert.ok(materials.content.every(item=>item.kind==='material'));
 for(const kind of ['invalid','news,material','news)'])assert.equal((await call('/api/fiiu?kind='+encodeURIComponent(kind))).status,400);
});

test('named workshops and routes accept separate interest-only registrations without claiming form completion',async t=>{
 const {save,call}=await setup(t);
 const externals=FIIU_EVENT.activities.filter(a=>a.registration==='external');
 assert.equal(externals.length,14);assert.ok(externals.every(a=>/^https:\/\/forms\.gle\//.test(a.formUrl)));
 assert.equal(FIIU_EVENT.activities.some(a=>a.id==='workshop-day1'),false);
 const response=await save({...answers,activities:[],externalActivities:['workshop-espacios-comunidad','workshop-espacios-comunidad','route-lima-cromatica'],externalCompleted:true});
 assert.equal(response.status,200);const {registration}=await response.json();
 assert.deepEqual(registration.answers.activities,[]);
 assert.deepEqual(registration.answers.externalActivities,['route-lima-cromatica','workshop-espacios-comunidad']);
 assert.equal(Object.hasOwn(registration.answers,'externalCompleted'),false);
 assert.deepEqual((await(await call('/api/fiiu/registration')).json()).registration.answers.externalActivities,registration.answers.externalActivities);
 const exported=await(await call('/api/admin/fiiu/export',{actor:'admin'})).text();
 assert.match(exported,/externalActivities/);assert.match(exported,/route-lima-cromatica; workshop-espacios-comunidad/);
});

test('required questionnaire and external interest choices are validated server-side including conditional other text',async t=>{
 const {save}=await setup(t);
 const invalid=[{nationalId:''},{gender:''},{age:null},{age:'30'},{accessibility:[]},{motivation:''},{previousAttendance:''},{accessibility:['other'],accessibilityOther:''},{motivation:'other',motivationOther:''},{externalActivities:['day1-am']},{externalActivities:['workshop-day1']},{externalActivities:['invented']},{externalActivities:'route-lima-cromatica'}];
 for(const patch of invalid)assert.equal((await save({...answers,...patch})).status,400,JSON.stringify(patch));
 const result=await save({...answers,accessibility:['other'],accessibilityOther:'Needs quiet area',motivation:'other',motivationOther:'Urban exchange'});
 assert.equal(result.status,200);
 const {registration}=await result.json();assert.equal(registration.answers.accessibilityOther,'Needs quiet area');
 // Support details saved by the first release (optional free text) survive a later save without 'other'.
 const updated=await save({...answers,registrationId:registration.id,version:registration.version,accessibility:['mobility'],accessibilityOther:'  Uses a wheelchair  ',motivationOther:' Also presenting '});
 assert.equal(updated.status,200);const next=(await updated.json()).registration;
 assert.equal(next.answers.accessibilityOther,'Uses a wheelchair');assert.equal(next.answers.motivationOther,'Also presenting');
 for(const patch of [{accessibilityOther:'x'.repeat(501)},{motivationOther:'x'.repeat(501)},{accessibilityOther:42}])assert.equal((await save({...answers,registrationId:next.id,version:next.version,...patch})).status,400,JSON.stringify(patch).slice(0,40));
 const cleared=await save({...answers,registrationId:next.id,version:next.version});assert.equal(cleared.status,200);
 assert.equal((await cleared.json()).registration.answers.accessibilityOther,'','omitted details are saved as empty');
});

test('historical incomplete registrations remain readable, exportable and cancellable with legacy content and attendance',async t=>{
 const {call,db,users}=await setup(t);const store=createFiiuStore({db});
 const old={firstName:'Legacy',lastName:'Fixture',country:'Perú',city:'Lima',profile:'professional',publicOfficial:false,activities:['day1-am'],accessibility:[],privacyAccepted:true};
 const registration=await store.insert('registrations',{id:'10000000-0000-4000-8000-000000000001',eventId:'fiiu-2026',userId:users.member.id,email:'member@example.test',answers:old,labStatus:'none',version:1,createdAt:'2026-09-28T00:00:00Z',updatedAt:'2026-09-28T00:00:00Z'});
 assert.equal((await(await call('/api/fiiu/registration')).json()).registration.id,registration.id);
 assert.equal((await call('/api/admin/fiiu/export',{actor:'admin'})).status,200);
 const draft={title:'Historical workshop materials',body:'',kind:'material',status:'published',url:'https://example.test/legacy',activityId:'workshop-day1'};
 assert.equal((await call('/api/admin/fiiu/content',{actor:'admin',method:'POST',body:draft})).status,201);
 assert.equal((await call(`/api/admin/fiiu/registrations/${registration.id}/attendance`,{actor:'admin',method:'PUT',body:{activityId:'workshop-day1',attended:true}})).status,200);
 assert.equal((await call('/api/fiiu/registration',{method:'DELETE',body:{registrationId:registration.id,version:1}})).status,200);
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_attendance').get().n,0);
});

test('organizer summary covers every registration, distinguishes interests and counts unique people by day without participant data',async t=>{
 const {call,db}=await setup(t);const store=createFiiuStore({db});
 for(let i=0;i<205;i++){
  const user=createUser(db,{fullName:'Summary fixture',email:`summary-${i}@example.test`,passwordHash:'unused',role:'member'});
  const r=await store.insert('registrations',{id:`20000000-0000-4000-8000-${String(i).padStart(12,'0')}`,eventId:'fiiu-2026',userId:user.id,email:user.email,answers:{...answers,activities:['day1-am','day1-pm'],externalActivities:i<10?['workshop-espacios-comunidad','route-lima-cromatica']:[],publicOfficial:i<3,applyLab:i<3,profile:i<5?'student':'professional'},labStatus:i===0?'pending':i===1?'accepted':i===2?'declined':'none',version:1,createdAt:'2026-09-29T00:00:00Z',updatedAt:'2026-09-29T00:00:00Z'});
  if(i<2)for(const activityId of ['day1-am','workshop-espacios-comunidad'])await store.insert('attendance',{id:crypto.randomUUID(),registrationId:r.id,activityId,confirmedBy:null,createdAt:'2026-09-29T00:00:00Z'});
 }
 assert.equal((await call('/api/admin/fiiu/summary',{actor:'guest'})).status,401);
 assert.equal((await call('/api/admin/fiiu/summary')).status,403);
 const response=await call('/api/admin/fiiu/summary',{actor:'admin'});assert.equal(response.status,200);
 const body=await response.json(),s=body.summary;
 assert.equal(s.totalRegistrations,205);assert.equal(s.publicOfficials,3);assert.deepEqual(s.lab,{pending:1,accepted:1,declined:1});
 assert.deepEqual(s.activities.find(a=>a.activityId==='day1-am'),{activityId:'day1-am',registrations:205,externalInterests:0,attendance:2});
 assert.deepEqual(s.activities.find(a=>a.activityId==='workshop-espacios-comunidad'),{activityId:'workshop-espacios-comunidad',registrations:0,externalInterests:10,attendance:2});
 assert.deepEqual(s.days.find(d=>d.date==='2026-10-21'),{date:'2026-10-21',registrations:205,attendance:2});
 assert.deepEqual(s.days.find(d=>d.date==='2026-10-25'),{date:'2026-10-25',registrations:10,attendance:0});
 assert.deepEqual(s.profiles,[{profile:'professional',count:200},{profile:'student',count:5}]);
 assert.doesNotMatch(JSON.stringify(body),/summary-\d|example\.test|firstName|nationalId|TEST-ID|userId/);
});

test('summary tolerates incomplete historical answers and does not double-count duplicate choices',async t=>{
 const {db,users}=await setup(t);const store=createFiiuStore({db});
 const r=await store.insert('registrations',{id:'30000000-0000-4000-8000-000000000001',eventId:'fiiu-2026',userId:users.member.id,email:'fixture@example.test',answers:{activities:['day1-am','day1-am','day0-lab'],externalActivities:['workshop-day1','workshop-day1'],applyLab:'true',publicOfficial:'true',profile:{invalid:true}},labStatus:'none',version:1,createdAt:'2026-09-29T00:00:00Z',updatedAt:'2026-09-29T00:00:00Z'});
 await store.insert('registrations',{id:'30000000-0000-4000-8000-000000000002',eventId:'fiiu-2026',userId:users.other.id,email:'other@example.test',answers:{activities:null,externalActivities:{}},labStatus:'none',version:1,createdAt:'2026-09-29T00:00:00Z',updatedAt:'2026-09-29T00:00:00Z'});
 await store.insert('attendance',{id:crypto.randomUUID(),registrationId:r.id,activityId:'workshop-day1',confirmedBy:null,createdAt:'2026-09-29T00:00:00Z'});
 const catalog=[...FIIU_EVENT.activities,...FIIU_EVENT.legacyActivities];
 const summary=await store.summary('fiiu-2026',catalog);
 assert.equal(summary.totalRegistrations,2);assert.equal(summary.publicOfficials,0);assert.deepEqual(summary.profiles,[{profile:'',count:2}]);
 assert.equal(summary.activities.find(a=>a.activityId==='day0-lab').registrations,0);
 assert.deepEqual(summary.activities.find(a=>a.activityId==='workshop-day1'),{activityId:'workshop-day1',registrations:0,externalInterests:1,attendance:1});
 assert.deepEqual(summary.days.find(d=>d.date==='2026-10-21'),{date:'2026-10-21',registrations:1,attendance:1});
 const empty=await store.summary('different-event',catalog);assert.equal(empty.totalRegistrations,0);assert.ok(empty.activities.every(a=>a.registrations+a.externalInterests+a.attendance===0));
});

test('door check-in has its own per-account budget and never locks the other festival writes',async t=>{
 const {call,save}=await setup(t);const {registration}=await(await save()).json();
 const route=`/api/admin/fiiu/registrations/${registration.id}/attendance`;
 for(let i=0;i<300;i++){const response=await call(route,{actor:'admin',method:'PUT',body:{activityId:'day1-am',attended:i%2===0}});assert.equal(response.status,200,`check-in ${i+1}`);await response.arrayBuffer();}
 assert.equal((await call(route,{actor:'admin',method:'PUT',body:{activityId:'day1-am',attended:true}})).status,429);
 const news={title:'Doors open',body:'',status:'draft',kind:'news',url:'',activityId:''};
 for(let i=0;i<30;i++){const response=await call('/api/admin/fiiu/content',{actor:'admin',method:'POST',body:news});assert.equal(response.status,201,`write ${i+1}`);await response.arrayBuffer();}
 assert.equal((await call('/api/admin/fiiu/content',{actor:'admin',method:'POST',body:news})).status,429,'reviews, settings and publications keep their 30 per minute');
});

test('completing a blank national ID keeps a laboratory decision while a changed ID reopens review',async t=>{
 const {call,save,db,users}=await setup(t);const store=createFiiuStore({db});
 const lab={...answers,activities:[],publicOfficial:true,applyLab:true,institution:'Municipality',position:'Planner'};
 // Shape saved by the first release, when the ID and questionnaire were optional; the organiser accepted it.
 const old=await store.insert('registrations',{id:'40000000-0000-4000-8000-000000000001',eventId:'fiiu-2026',userId:users.member.id,email:'member@example.test',answers:{...lab,nationalId:'',gender:'',age:null,accessibility:[],motivation:'',previousAttendance:''},labStatus:'accepted',version:1,createdAt:'2026-09-28T00:00:00Z',updatedAt:'2026-09-28T00:00:00Z'});
 const completed=await save({...lab,registrationId:old.id,version:1,nationalId:'12345678'});assert.equal(completed.status,200);
 assert.equal((await completed.json()).registration.labStatus,'accepted','filling in the missing ID completes the application');
 assert.equal((await call(`/api/admin/fiiu/registrations/${old.id}/attendance`,{actor:'admin',method:'PUT',body:{activityId:'day0-lab',attended:true}})).status,200);
 const changed=await save({...lab,registrationId:old.id,version:2,nationalId:'87654321'});
 assert.equal((await changed.json()).registration.labStatus,'pending','a different ID is an identity change');
 const {nationalId,...withoutId}=lab;
 assert.equal(applicationStatus(lab,{answers:withoutId,labStatus:'declined'}),'declined');
 assert.equal(applicationStatus({...lab,lastName:'Other'},{answers:{...lab,nationalId:''},labStatus:'accepted'}),'pending');
});

test('a check-in racing the participant cancellation reports the registration as unavailable',async t=>{
 let cancel=false;
 const {call,save,db}=await setup(t,store=>({...store,async find(name,filters,options){
  const rows=await store.find(name,filters,options);
  // The participant cancels right after the organiser's "already confirmed?" lookup.
  if(cancel&&name==='attendance'&&filters.activityId){cancel=false;await store.remove('registrations',{id:filters.registrationId});}
  return rows;
 }}));
 const {registration}=await(await save()).json();cancel=true;
 const response=await call(`/api/admin/fiiu/registrations/${registration.id}/attendance`,{actor:'admin',method:'PUT',body:{activityId:'day1-am',attended:true}});
 assert.equal(response.status,404);assert.equal((await response.json()).error,'registration unavailable');
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_attendance').get().n,0);
});

test('cursors are read case-insensitively and never repeat or skip rows',async t=>{
 const {call,db}=await setup(t);const store=createFiiuStore({db});
 const ids=['1aaaaaaa-0000-4000-8000-000000000000','aaaaaaaa-0000-4000-8000-000000000000','bbbbbbbb-0000-4000-8000-000000000000'],at='2026-09-29T00:00:00.000Z';
 for(const [i,id] of ids.entries()){
  const user=createUser(db,{fullName:'Cursor fixture',email:`cursor-${i}@example.test`,passwordHash:'unused',role:'member'});
  await store.insert('registrations',{id,eventId:'fiiu-2026',userId:user.id,email:user.email,answers,labStatus:'none',version:1,createdAt:at,updatedAt:at});
  await store.insert('content',{id,eventId:'fiiu-2026',data:{title:'Post '+i,body:'',kind:'news',url:'',activityId:''},status:'published',version:1,createdAt:at,updatedAt:at});
 }
 for(const cursor of [ids[0],ids[0].toUpperCase()])assert.deepEqual((await(await call('/api/admin/fiiu/registrations?cursor='+cursor,{actor:'admin'})).json()).registrations.map(r=>r.id),ids.slice(1),cursor);
 for(const cursor of [ids[2],ids[2].toUpperCase()])assert.deepEqual((await(await call('/api/fiiu?cursor='+cursor,{actor:'guest'})).json()).content.map(c=>c.id),[ids[1],ids[0]],cursor);
});

test('the public programme answers HEAD like GET without spending write budgets and refuses other methods',async t=>{
 const {call,save}=await setup(t);
 const head=await call('/api/fiiu',{actor:'guest',method:'HEAD'});assert.equal(head.status,200);assert.match(head.headers.get('content-type'),/application\/json/);assert.equal(await head.text(),'');
 for(let i=0;i<35;i++)assert.equal((await call('/api/fiiu',{method:'HEAD'})).status,200,`HEAD ${i+1}`);
 assert.equal((await save()).status,200,'HEAD is charged as a read, not a write');
 for(const [actor,method] of [['member','POST'],['member','PUT'],['member','DELETE'],['guest','POST']]){const response=await call('/api/fiiu',{actor,method,body:{}});assert.equal(response.status,405,actor+' '+method);assert.equal(response.headers.get('allow'),'GET, HEAD');}
});

test('a draft published later is listed and dated from its first publication, which later edits keep',async t=>{
 const {call,db}=await setup(t);const store=createFiiuStore({db});
 const base={body:'',kind:'news',url:'',activityId:''},pause=()=>new Promise(resolve=>setTimeout(resolve,10));
 const write=async(method,path,body)=>{const response=await call(path,{actor:'admin',method,body});assert.equal(response.status,method==='POST'?201:200,`${method} ${body.title} ${body.status}`);return (await response.json()).content;};
 const feed=async()=>(await(await call('/api/fiiu',{actor:'guest'})).json()).content.map(c=>c.title);
 const a=await write('POST','/api/admin/fiiu/content',{...base,title:'A',status:'draft'});await pause();
 const b=await write('POST','/api/admin/fiiu/content',{...base,title:'B',status:'published'});await pause();
 const published=await write('PATCH',`/api/admin/fiiu/content/${a.id}`,{...base,title:'A',status:'published',version:1});
 assert.ok(a.createdAt<b.createdAt&&b.createdAt<published.createdAt,'the publication time replaces the draft time');
 assert.deepEqual(await feed(),['A','B']);assert.equal(Object.hasOwn(published,'publishedAt'),false);
 await pause();await write('PATCH',`/api/admin/fiiu/content/${a.id}`,{...base,title:'A',status:'archived',version:2});
 await pause();const again=await write('PATCH',`/api/admin/fiiu/content/${a.id}`,{...base,title:'A edited',status:'published',version:3});
 assert.equal(again.createdAt,published.createdAt,'archiving, republishing and editing keep the first publication date');
 assert.deepEqual(await feed(),['A edited','B']);
 // Rows published before the marker existed keep their date as well.
 const legacy=await store.insert('content',{id:'50000000-0000-4000-8000-000000000001',eventId:'fiiu-2026',data:{title:'Legacy',body:'',kind:'news',url:'',activityId:''},status:'published',version:1,createdAt:'2026-01-05T12:00:00.000Z',updatedAt:'2026-01-05T12:00:00.000Z'});
 for(const [status,version] of [['archived',1],['published',2]])assert.equal((await write('PATCH',`/api/admin/fiiu/content/${legacy.id}`,{...base,title:'Legacy',status,version})).createdAt,legacy.createdAt);
 assert.deepEqual(await feed(),['A edited','B','Legacy']);
 assert.equal((await call(`/api/admin/fiiu/content/${a.id}`,{actor:'admin',method:'PATCH',body:{...base,title:'Stale',status:'draft',version:1}})).status,409);
});

test('a publication retried with its editor id is stored once and the retry returns the saved row',async t=>{
 const {call,db}=await setup(t);const store=createFiiuStore({db});const id=crypto.randomUUID();
 const post=body=>call('/api/admin/fiiu/content',{actor:'admin',method:'POST',body});
 const news={id,title:'Doors open 09:00',body:'',status:'published',kind:'news',url:'',activityId:''};
 const first=await post(news);assert.equal(first.status,201);const {content}=await first.json();assert.equal(content.id,id);
 for(const retry of [news,{...news,id:id.toUpperCase(),title:'Edited before the retry'}]){const response=await post(retry);assert.equal(response.status,200);assert.deepEqual((await response.json()).content,content);}
 const racing=crypto.randomUUID();assert.deepEqual((await Promise.all([post({...news,id:racing}),post({...news,id:racing})])).map(r=>r.status).sort(),[200,201]);
 for(const invalid of ['not-a-uuid','',42])assert.equal((await post({...news,id:invalid})).status,400,String(invalid));
 const foreign=await store.insert('content',{id:crypto.randomUUID(),eventId:'another-event',data:{title:'Elsewhere',body:'',kind:'news',url:'',activityId:''},status:'draft',version:1,createdAt:'2026-09-28T12:00:00.000Z',updatedAt:'2026-09-28T12:00:00.000Z'});
 assert.equal((await post({...news,id:foreign.id})).status,409,'another event keeps its row');
 assert.deepEqual({...db.prepare('SELECT event_id,status,version FROM fiiu_content WHERE id=?').get(foreign.id)},{event_id:'another-event',status:'draft',version:1});
 for(const body of [{...news,id:undefined},{...news,id:null}])assert.equal((await post(body)).status,201);
 assert.equal(db.prepare("SELECT count(*) AS n FROM fiiu_content WHERE event_id='fiiu-2026'").get().n,4);
 assert.equal((await(await call('/api/fiiu',{actor:'guest'})).json()).content.filter(c=>c.id===id).length,1);
});

test('kind=materials pages recordings and materials together, newest first, and leaves news out',async t=>{
 const {call,db}=await setup(t);const store=createFiiuStore({db});const rows=[];
 for(let i=0;i<180;i++)rows.push(await store.insert('content',{id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,eventId:'fiiu-2026',data:{title:'Post '+i,body:'',kind:['news','recording','material'][i%3],url:'https://example.test/item',activityId:''},status:i===4?'draft':'published',version:1,createdAt:`2026-09-${10+i%7}T12:00:00.000Z`,updatedAt:'2026-09-29T12:00:00.000Z'}));
 const newest=list=>list.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).map(r=>r.id);
 for(const [route,actor,expected] of [['/api/fiiu','guest',newest(rows.filter(r=>r.status==='published'&&r.data.kind!=='news'))],['/api/admin/fiiu/content','admin',newest(rows.filter(r=>r.data.kind!=='news'))]]){
  const ids=[];let cursor,pages=0;
  do{const response=await call(`${route}?kind=materials${cursor?'&cursor='+cursor:''}`,{actor});assert.equal(response.status,200);const page=await response.json();pages++;
   assert.ok(page.content.every(c=>['recording','material'].includes(c.kind)));ids.push(...page.content.map(c=>c.id));cursor=page.nextCursor;}while(cursor);
  assert.deepEqual(ids,expected,route);assert.equal(pages,2);
 }
 for(const kind of ['materials,news','Materials'])assert.equal((await call('/api/fiiu?kind='+encodeURIComponent(kind))).status,400);
});
