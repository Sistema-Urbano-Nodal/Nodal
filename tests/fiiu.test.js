import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDatabase,createUser} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createApp} from '../server/server.js';
import {createFiiuStore} from '../server/fiiu-repository.js';

const answers={firstName:'Ana',lastName:'Test',country:'Perú',city:'Lima',profile:'professional',publicOfficial:false,activities:['day1-am'],privacyAccepted:true};
async function setup(t,wrapStore=store=>store){
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const cookies={},users={};
 for(const name of ['member','other','admin']){users[name]=createUser(db,{fullName:name,email:`${name}@example.test`,passwordHash:'unused',role:name==='admin'?'admin':'member'});cookies[name]=createSession(db,users[name].id).cookie.split(';')[0];}
 const server=createApp({db,fiiuStore:wrapStore(createFiiuStore({db}))});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,{actor='member',method='GET',body,origin=base}={})=>fetch(base+path,{method,redirect:'manual',headers:{...(cookies[actor]?{Cookie:cookies[actor]}:{}),Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const save=(body=answers,actor='member')=>call('/api/fiiu/registration',{actor,method:'PUT',body:{version:0,...body}});
 return {db,call,save,users};
}

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
