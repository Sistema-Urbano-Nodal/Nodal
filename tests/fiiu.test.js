import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDatabase,createUser} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createApp} from '../server/server.js';
import {createFiiuStore} from '../server/fiiu-repository.js';
import {FIIU_EVENT,applicationStatus} from '../server/fiiu-domain.js';
import {createCheckinCodes} from '../server/fiiu-checkin.js';
import {encodeQr,packBits} from '../server/qr.js';
import {sendConfirmations} from '../scripts/send-fiiu-confirmations.js';

const answers={firstName:'Ana',lastName:'Test',country:'Perú',city:'Lima',profile:'professional',publicOfficial:false,activities:['day1-am'],externalActivities:[],nationalId:'TEST-ID',gender:'prefer_not',age:30,accessibility:['none'],motivation:'learn',previousAttendance:'no',privacyAccepted:true};
async function setup(t,wrapStore=store=>store,options={}){
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const cookies={},users={};
 for(const name of ['member','other','admin']){users[name]=createUser(db,{fullName:name,email:`${name}@example.test`,passwordHash:'unused',role:name==='admin'?'admin':'member'});cookies[name]=createSession(db,users[name].id).cookie.split(';')[0];}
 const server=createApp({db,fiiuStore:wrapStore(createFiiuStore({db})),...options});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
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

test('organiser pages send guests to sign-in and show members an organisers-only page with no organiser data or script',async t=>{
 const {call}=await setup(t);
 for(const [page,next] of [['/fiiu-qr.html?a=day1-am','%2Ffiiu-qr.html%3Fa%3Dday1-am'],['/fiiu-admin.html#content','%2Ffiiu-admin.html']]){
  const guest=await call(page,{actor:'guest'});assert.equal(guest.status,302,page);assert.equal(guest.headers.get('location'),`/login.html?next=${next}`);
 }
 for(const page of ['/fiiu-qr.html','/fiiu-qr.html?a=day1-am','/fiiu-admin.html']){
  const member=await call(page);assert.equal(member.status,403,page);
  assert.match(member.headers.get('content-type'),/^text\/html/);assert.equal(member.headers.get('cache-control'),'no-store');
  assert.match(member.headers.get('content-security-policy')||'',/script-src 'self'/);
  const html=await member.text();
  assert.match(html,/data-fiiu-text="organisersOnly"/);
  assert.doesNotMatch(html,/fiiu-admin\.js|fiiu-qr\.js|\/api\/admin|example\.test/,page);
 }
 const head=await call('/fiiu-qr.html',{method:'HEAD'});assert.equal(head.status,403);assert.equal(await head.text(),'');
 // Non-page methods and the other staff pages keep the JSON refusal.
 const post=await call('/fiiu-admin.html',{method:'POST',body:{}});assert.equal(post.status,403);assert.deepEqual(await post.json(),{error:'administrator access required'});
 for(const page of ['/admin.html','/teaching.html']){const r=await call(page);assert.equal(r.status,403,page);assert.deepEqual(await r.json(),{error:'administrator access required'});}
 for(const [page,script] of [['/fiiu-qr.html?a=day1-am','fiiu-qr.js'],['/fiiu-admin.html','fiiu-admin.js']]){
  const admin=await call(page,{actor:'admin'});assert.equal(admin.status,200,page);assert.match(await admin.text(),new RegExp(`src="${script.replace('.','\\.')}\\?v=`));
 }
 // The explanation page itself is harmless static HTML.
 assert.equal((await call('/organisers-only.html',{actor:'guest'})).status,200);
});

test('a scanned check-in link opens the check-in page for everyone, and its sign-in link comes back with the block and the code',async t=>{
 const {call}=await setup(t);
 const page='/fiiu-checkin.html?a=day1-am&c=x';
 // Signed out, the page itself loads (it says "Sign in to check in" for this session) instead of a generic sign-in.
 for(const actor of ['guest','member','admin']){
  const response=await call(page,{actor});assert.equal(response.status,200,actor);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.match(await response.text(),/src="fiiu-checkin\.js\?v=/);
 }
 assert.equal((await call('/fiiu-checkin.html',{actor:'guest'})).status,200,'the code form loads signed out too');
 // The page's sign-in link: login sends a signed-in visitor straight back to the same block and code.
 const back=await call('/login.html?next='+encodeURIComponent(page));assert.equal(back.status,302,'a signed-in visitor of the login page is sent on');
 assert.equal(back.headers.get('location'),page);
 // The check-in itself still needs an account.
 const anonymous=await call('/api/fiiu/checkin',{actor:'guest',method:'POST',body:{activityId:'day1-am',code:'x'.repeat(22)}});
 assert.equal(anonymous.status,401);
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
 const confirmed=await call(route,{actor:'admin',method:'PUT',body:{activityId:'day1-am',attended:true}});assert.equal(confirmed.status,200);
 assert.deepEqual((await confirmed.json()).hours,{minutes:240,hours:4,untimed:[]});
 assert.equal((await call(route,{actor:'admin',method:'PUT',body:{activityId:'day1-am',attended:true}})).status,200);
 let me=await(await call('/api/fiiu/registration')).json();assert.equal(me.attendance.length,1);assert.equal(me.attendance[0].activityId,'day1-am');
 assert.equal(me.attendance[0].method,'staff');assert.deepEqual(me.hours,{minutes:240,hours:4,untimed:[]});
 const detail=await(await call(`/api/admin/fiiu/registrations/${registration.id}`,{actor:'admin'})).json();assert.equal(detail.attendance[0].method,'staff');assert.equal(detail.hours.hours,4);
 assert.equal((await call(route,{actor:'admin',method:'PUT',body:{activityId:'day1-am',attended:false}})).status,200);
 me=await(await call('/api/fiiu/registration')).json();assert.deepEqual(me.attendance,[]);assert.deepEqual(me.hours,{minutes:0,hours:0,untimed:[]});
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
  if(i<2)for(const activityId of ['day1-am','workshop-espacios-comunidad'])await store.insert('attendance',{id:crypto.randomUUID(),registrationId:r.id,activityId,confirmedBy:null,createdAt:i===1&&activityId==='day1-am'?'2026-10-21T14:12:30.500Z':'2026-10-21T14:00:00Z',method:i===0?'qr':'staff'});
 }
 assert.equal((await call('/api/admin/fiiu/summary',{actor:'guest'})).status,401);
 assert.equal((await call('/api/admin/fiiu/summary')).status,403);
 const response=await call('/api/admin/fiiu/summary',{actor:'admin'});assert.equal(response.status,200);
 const body=await response.json(),s=body.summary;
 assert.equal(s.totalRegistrations,205);assert.equal(s.publicOfficials,3);assert.deepEqual(s.lab,{pending:1,accepted:1,declined:1});
 assert.deepEqual([s.attendedPeople,s.qrPeople,s.lastCheckInAt],[2,1,'2026-10-21T14:12:30.500Z'],'one person with two QR check-ins counts once');
 assert.deepEqual(s.activities.find(a=>a.activityId==='day1-am'),{activityId:'day1-am',registrations:205,externalInterests:0,attendance:2,officialAttendance:2});
 assert.deepEqual(s.activities.find(a=>a.activityId==='day1-pm'),{activityId:'day1-pm',registrations:205,externalInterests:0,attendance:0,officialAttendance:0});
 assert.deepEqual(s.activities.find(a=>a.activityId==='workshop-espacios-comunidad'),{activityId:'workshop-espacios-comunidad',registrations:0,externalInterests:10,attendance:2,officialAttendance:2});
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
 assert.deepEqual(summary.activities.find(a=>a.activityId==='workshop-day1'),{activityId:'workshop-day1',registrations:0,externalInterests:1,attendance:1,officialAttendance:0},'a string "true" is not a public official');
 assert.deepEqual(summary.days.find(d=>d.date==='2026-10-21'),{date:'2026-10-21',registrations:1,attendance:1});
 assert.deepEqual([summary.attendedPeople,summary.qrPeople,summary.lastCheckInAt],[1,0,'2026-09-29T00:00:00.000Z']);
 // Attendance outside the catalogue (an activity since removed) counts nowhere.
 await store.insert('attendance',{id:crypto.randomUUID(),registrationId:r.id,activityId:'removed-activity',confirmedBy:null,createdAt:'2026-10-30T00:00:00Z',method:'qr'});
 const again=await store.summary('fiiu-2026',catalog);assert.deepEqual([again.attendedPeople,again.qrPeople,again.lastCheckInAt],[1,0,'2026-09-29T00:00:00.000Z']);
 const empty=await store.summary('different-event',catalog);assert.equal(empty.totalRegistrations,0);assert.ok(empty.activities.every(a=>a.registrations+a.externalInterests+a.attendance+a.officialAttendance===0));
 assert.deepEqual([empty.attendedPeople,empty.qrPeople,empty.lastCheckInAt],[0,0,null]);
});

test('door check-in has its own per-account budget and never locks the other festival writes',async t=>{
 const {call,save}=await setup(t);const {registration}=await(await save()).json();
 const route=`/api/admin/fiiu/registrations/${registration.id}/attendance`;
 for(let i=0;i<300;i++){const response=await call(route,{actor:'admin',method:'PUT',body:{activityId:'day1-am',attended:i%2===0}});assert.equal(response.status,200,`check-in ${i+1}`);await response.arrayBuffer();}
 assert.equal((await call(route,{actor:'admin',method:'PUT',body:{activityId:'day1-am',attended:true}})).status,429);
 const news={title:'Doors open',body:'',status:'draft',kind:'news',url:'',activityId:''};
 for(let i=0;i<30;i++){const response=await call('/api/admin/fiiu/content',{actor:'admin',method:'POST',body:news});assert.equal(response.status,201,`write ${i+1}`);await response.arrayBuffer();}
 assert.equal((await call('/api/admin/fiiu/content',{actor:'admin',method:'POST',body:news})).status,429,'reviews, settings and publications keep their 30 per minute');
 // Attendee scans: 20 a minute per account, without spending the registration or organiser budgets.
 for(let i=0;i<20;i++){const response=await call('/api/fiiu/checkin',{method:'POST',body:{activityId:'day1-am',code:'x'.repeat(22)}});assert.equal(response.status,410,`scan ${i+1}`);await response.arrayBuffer();}
 assert.equal((await call('/api/fiiu/checkin',{method:'POST',body:{activityId:'day1-am',code:'x'.repeat(22)}})).status,429);
 assert.equal((await call('/api/fiiu/checkin',{actor:'other',method:'POST',body:{activityId:'day1-am',code:'x'.repeat(22)}})).status,410,'the budget is per account');
 assert.equal((await save({...answers,registrationId:registration.id,version:1,city:'Callao'})).status,200,'scans never block a registration edit');
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

// Frozen festival clock and fixed secret: the codes the screen would show are computed in the test.
const SECRET='fiiu-test-checkin-secret-0123456789';
function festivalClock(iso){const clock={at:Date.parse(iso),set(value){clock.at=Date.parse(value);}};const codes=createCheckinCodes({secret:SECRET,now:()=>clock.at});return {clock,codes,options:{fiiuCheckin:{secret:SECRET,now:()=>clock.at}}};}
const scan=(call,body,actor='member')=>call('/api/fiiu/checkin',{actor,method:'POST',body});

test('attendees check themselves in with the session QR once, only inside its Lima window and only for blocks in their plan',async t=>{
 const {clock,codes,options}=festivalClock('2026-10-21T14:00:00Z');// 09:00 in Lima
 const {call,save,db,users}=await setup(t,undefined,options);
 const code=()=>codes.current('day1-am').code;
 assert.equal((await scan(call,{activityId:'day1-am',code:code()},'guest')).status,401);
 assert.equal((await call('/api/fiiu/checkin',{method:'POST',body:{activityId:'day1-am',code:code()},origin:'https://elsewhere.test'})).status,403);
 let response=await scan(call,{activityId:'day1-am',code:code()});assert.equal(response.status,404);
 assert.deepEqual(await response.json(),{error:'registration unavailable',code:'not_registered',activityId:'day1-am',registrationOpen:true});
 const {registration}=await(await save()).json();
 // Input checks run before the registration lookup; a second account keeps the member's 20-a-minute scan budget.
 for(const activityId of ['unknown','workshop-espacios-comunidad','route-lima-cromatica','workshop-day1',42]){
  response=await scan(call,{activityId,code:code()},'other');assert.equal(response.status,400,String(activityId));assert.equal((await response.json()).code,'invalid_activity');
 }
 for(const wrong of ['x'.repeat(22),codes.current('day1-pm').code,'','ABCDEF',null,undefined,{}]){
  response=await scan(call,{activityId:'day1-am',code:wrong},'other');assert.equal(response.status,410,JSON.stringify(wrong));assert.equal((await response.json()).code,'expired');
 }
 // A code from six minutes ago has expired; one from four minutes ago still works (checked below).
 const old=code();clock.set('2026-10-21T14:06:00Z');assert.equal((await scan(call,{activityId:'day1-am',code:old})).status,410);
 for(const at of ['2026-10-21T13:29:00Z','2026-10-21T18:31:00Z']){// 08:29 and 13:31 in Lima
  clock.set(at);response=await scan(call,{activityId:'day1-am',code:code()});assert.equal(response.status,409,at);
  assert.deepEqual(await response.json(),{error:'check-in is closed for this activity',code:'outside_window',activityId:'day1-am',opensAt:'2026-10-21T13:30:00.000Z',closesAt:'2026-10-21T18:30:00.000Z',serverTime:new Date(at).toISOString()},'the server says when it judged the scan, so the page never relies on the phone clock');
 }
 // An organiser scanning outside the window rehearses: a valid code says so and records nothing; an old code is still refused.
 clock.set('2026-10-21T13:00:00Z');response=await scan(call,{activityId:'day1-am',code:code()},'admin');assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{result:'rehearsal',activityId:'day1-am',opensAt:'2026-10-21T13:30:00.000Z',closesAt:'2026-10-21T18:30:00.000Z',serverTime:'2026-10-21T13:00:00.000Z'});
 response=await scan(call,{code:codes.current('day1-am').shortCode},'admin');assert.equal((await response.json()).result,'rehearsal','a typed screen code rehearses too');
 const stale=code();clock.set('2026-10-21T13:06:00Z');assert.equal((await scan(call,{activityId:'day1-am',code:stale},'admin')).status,410);
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_attendance').get().n,0);
 clock.set('2026-10-22T00:00:00Z');// 19:00 in Lima: day1-pm is not in this plan
 response=await scan(call,{activityId:'day1-pm',code:codes.current('day1-pm').code});assert.equal(response.status,403);
 assert.deepEqual(await response.json(),{error:'participant is not registered for this activity',code:'not_in_plan',activityId:'day1-pm',registrationOpen:true});
 clock.set('2026-10-21T14:10:00Z');const issued=code();clock.set('2026-10-21T14:14:00Z');
 response=await scan(call,{activityId:'day1-am',code:issued});assert.equal(response.status,201);
 const first=await response.json();
 assert.deepEqual(first,{result:'checked_in',activityId:'day1-am',checkedInAt:'2026-10-21T14:14:00.000Z',method:'qr',attendance:[{activityId:'day1-am',createdAt:'2026-10-21T14:14:00.000Z',method:'qr'}],hours:{minutes:240,hours:4,untimed:[]}});
 assert.deepEqual({...db.prepare('SELECT confirmed_by,method FROM fiiu_attendance').get()},{confirmed_by:users.member.id,method:'qr'});
 clock.set('2026-10-21T14:20:00Z');response=await scan(call,{activityId:'day1-am',code:code()});assert.equal(response.status,200);
 const second=await response.json();assert.equal(second.result,'already_checked_in');assert.equal(second.checkedInAt,first.checkedInAt);
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_attendance').get().n,1);
 const me=await(await call('/api/fiiu/registration')).json();
 assert.deepEqual(me.attendance,[{activityId:'day1-am',createdAt:'2026-10-21T14:14:00.000Z',method:'qr'}]);assert.deepEqual(me.hours,{minutes:240,hours:4,untimed:[]});
 // Staff can still correct a QR check-in; the typed 6-character code then works without the activity id.
 assert.equal((await call(`/api/admin/fiiu/registrations/${registration.id}/attendance`,{actor:'admin',method:'PUT',body:{activityId:'day1-am',attended:false}})).status,200);
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_attendance').get().n,0);
 const short=codes.current('day1-am').shortCode;
 response=await scan(call,{code:`${short.slice(0,3).toLowerCase()}-${short.slice(3)}`});assert.equal(response.status,201);assert.equal((await response.json()).activityId,'day1-am');
 assert.equal((await scan(call,{code:'ZZZZZZ'})).status,410);
});

test('a repeat scan keeps the first confirmation after the window closes, the block leaves the plan or a laboratory application goes back to review',async t=>{
 const {clock,codes,options}=festivalClock('2026-10-21T14:10:00Z');// 09:10 in Lima
 const {call,save,db}=await setup(t,undefined,options);
 const {registration}=await(await save()).json();
 let response=await scan(call,{activityId:'day1-am',code:codes.current('day1-am').code});assert.equal(response.status,201);
 const first=await response.json(),kept={result:'already_checked_in',activityId:'day1-am',checkedInAt:'2026-10-21T14:10:00.000Z',method:'qr',attendance:first.attendance,hours:{minutes:240,hours:4,untimed:[]}};
 // 13:35 in Lima, after the 13:30 close: a fresh code from the screen, which keeps drawing one, still confirms the stored check-in.
 clock.set('2026-10-21T18:35:00Z');response=await scan(call,{activityId:'day1-am',code:codes.current('day1-am').code});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),kept);
 // The typed short code names the block too.
 response=await scan(call,{code:codes.current('day1-am').shortCode});assert.equal(response.status,200);assert.deepEqual(await response.json(),kept);
 // An expired code is still refused: the stored row is only shown to someone holding a valid screen code.
 const old=codes.current('day1-am').code;clock.set('2026-10-21T18:45:00Z');assert.equal((await scan(call,{activityId:'day1-am',code:old})).status,410);
 // The block leaves the plan after the check-in.
 clock.set('2026-10-21T14:30:00Z');
 assert.equal((await save({...answers,activities:['day1-pm'],version:registration.version,registrationId:registration.id})).status,200);
 response=await scan(call,{activityId:'day1-am',code:codes.current('day1-am').code});assert.equal(response.status,200);assert.deepEqual(await response.json(),kept);
 // Someone else, never checked in, still gets the window refusal for the same block.
 const {registration:other}=await(await save(answers,'other')).json();clock.set('2026-10-21T18:35:00Z');assert.equal((await scan(call,{activityId:'day1-am',code:codes.current('day1-am').code},'other')).status,409);
 // The laboratory: accepted, checked in, then an identity edit puts the application back under review.
 clock.set('2026-10-20T15:00:00Z');
 const {registration:lab}=await(await save({...answers,publicOfficial:true,applyLab:true,institution:'Municipality',position:'Planner',version:other.version,registrationId:other.id},'other')).json();
 assert.equal((await call(`/api/admin/fiiu/registrations/${lab.id}`,{actor:'admin',method:'PATCH',body:{version:lab.version,labStatus:'accepted'}})).status,200);
 assert.equal((await scan(call,{activityId:'day0-lab',code:codes.current('day0-lab').code},'other')).status,201);
 const accepted=(await(await call('/api/fiiu/registration',{actor:'other'})).json()).registration;
 const edited=await(await save({...accepted.answers,institution:'Another municipality',version:accepted.version,registrationId:accepted.id},'other')).json();
 assert.equal(edited.registration.labStatus,'pending');
 response=await scan(call,{activityId:'day0-lab',code:codes.current('day0-lab').code},'other');assert.equal(response.status,200);
 assert.deepEqual([(await response.json()).result],['already_checked_in']);
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_attendance').get().n,2,'no repeat scan writes a row');
});

test('the laboratory check-in needs an accepted application and adds no hours until its duration is known',async t=>{
 const {clock,codes,options}=festivalClock('2026-10-20T15:00:00Z');
 const {call,save}=await setup(t,undefined,options);
 const lab={...answers,activities:['day1-am'],publicOfficial:true,applyLab:true,institution:'Municipality',position:'Planner'};
 const {registration}=await(await save(lab)).json();assert.equal(registration.labStatus,'pending');
 const code=()=>codes.current('day0-lab').code;
 let response=await scan(call,{activityId:'day0-lab',code:code()});assert.equal(response.status,403);assert.equal((await response.json()).code,'lab_not_accepted');
 await save(answers,'other');response=await scan(call,{activityId:'day0-lab',code:code()},'other');assert.equal(response.status,403);assert.equal((await response.json()).code,'not_in_plan');
 assert.equal((await call(`/api/admin/fiiu/registrations/${registration.id}`,{actor:'admin',method:'PATCH',body:{version:1,labStatus:'accepted'}})).status,200);
 // Untimed: the whole Lima day of 20 October.
 clock.set('2026-10-21T05:00:01Z');response=await scan(call,{activityId:'day0-lab',code:code()});assert.equal(response.status,409);
 assert.deepEqual([(await response.json()).opensAt],['2026-10-20T05:00:00.000Z']);
 clock.set('2026-10-20T05:00:00Z');response=await scan(call,{activityId:'day0-lab',code:code()});assert.equal(response.status,201);
 assert.deepEqual((await response.json()).hours,{minutes:0,hours:0,untimed:['day0-lab']});
});

test('a QR check-in racing the participant cancellation answers not registered and writes nothing',async t=>{
 let cancel=false;const {codes,options}=festivalClock('2026-10-21T14:00:00Z');
 const {call,save,db}=await setup(t,store=>({...store,async find(name,filters,findOptions){
  const rows=await store.find(name,filters,findOptions);
  if(cancel&&name==='attendance'&&filters.activityId){cancel=false;await store.remove('registrations',{id:filters.registrationId});}
  return rows;
 }}),options);
 await save();cancel=true;
 const response=await scan(call,{activityId:'day1-am',code:codes.current('day1-am').code});
 assert.equal(response.status,404);assert.deepEqual(await response.json(),{error:'registration unavailable',code:'not_registered',activityId:'day1-am',registrationOpen:true});
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_attendance').get().n,0);
});

test('the organiser check-in screen gets a rotating link on the public origin, the window and a count, never participant data',async t=>{
 const {clock,codes,options}=festivalClock('2026-10-21T14:00:30Z');
 const keys=['PUBLIC_BASE_URL','NEXT_PUBLIC_APP_URL','VERCEL_URL'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 t.after(()=>{for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
 for(const k of keys)delete process.env[k];process.env.PUBLIC_BASE_URL='https://nodal.example';
 const encoded=[];
 const {call,save}=await setup(t,undefined,{...options,encodeQr:text=>{encoded.push(text);return {size:3,modules:Uint8Array.from([1,0,0,0,1,0,0,0,1])};}});
 const route='/api/admin/fiiu/checkin?activityId=day1-am';
 assert.equal((await call(route,{actor:'guest'})).status,401);
 assert.equal((await call(route)).status,403);
 for(const id of ['','unknown','workshop-espacios-comunidad','workshop-day1'])assert.equal((await call('/api/admin/fiiu/checkin?activityId='+id,{actor:'admin'})).status,400,id);
 await save();await scan(call,{activityId:'day1-am',code:codes.current('day1-am').code});
 const response=await call(route,{actor:'admin'});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const body=await response.json(),url=new URL(body.url);
 assert.equal(url.origin,'https://nodal.example','never the request Host');assert.equal(url.pathname,'/fiiu-checkin.html');
 assert.equal(url.searchParams.get('a'),'day1-am');assert.equal(url.searchParams.get('c'),body.code);assert.notEqual(codes.verify('day1-am',body.code),null);
 assert.match(body.shortCode,/^[2-9A-HJ-NP-RT-Y]{6}$/);assert.notEqual(codes.verify('day1-am',body.shortCode),null);
 assert.deepEqual({rotatesAt:body.rotatesAt,validUntil:body.validUntil,serverTime:body.serverTime,window:body.window,checkedIn:body.checkedIn,qr:body.qr},
  {rotatesAt:'2026-10-21T14:01:00.000Z',validUntil:'2026-10-21T14:05:00.000Z',serverTime:'2026-10-21T14:00:30.000Z',window:{opensAt:'2026-10-21T13:30:00.000Z',closesAt:'2026-10-21T18:30:00.000Z',open:true},checkedIn:1,qr:{size:3,bits:'iIA='}});
 assert.deepEqual(encoded,[body.url]);
 assert.doesNotMatch(JSON.stringify(body),/member|example\.test|Ana|TEST-ID/);
 clock.set('2026-10-21T14:01:00Z');const next=await(await call(route,{actor:'admin'})).json();
 assert.notEqual(next.code,body.code,'the code rotates every minute');assert.notEqual(codes.verify('day1-am',body.code),null,'the previous code stays valid for a few minutes');
 clock.set('2026-10-22T03:00:00Z');assert.equal((await(await call('/api/admin/fiiu/checkin?activityId=day1-pm',{actor:'admin'})).json()).window.open,false);
 // Outside production, a server without a configured origin links to itself.
 delete process.env.PUBLIC_BASE_URL;const local=await(await call(route,{actor:'admin'})).json();assert.match(local.url,/^http:\/\/127\.0\.0\.1:\d+\/fiiu-checkin\.html\?a=day1-am&c=/);
});

test('without an encoder the check-in screen gets qr null, and FIIU_CHECKIN_NOW moves only a local SQLite clock',async t=>{
 const saved=process.env.FIIU_CHECKIN_NOW;t.after(()=>{if(saved===undefined)delete process.env.FIIU_CHECKIN_NOW;else process.env.FIIU_CHECKIN_NOW=saved;});
 process.env.FIIU_CHECKIN_NOW='2026-10-21T09:15:00-05:00';
 const {call,save}=await setup(t,undefined,{encodeQr:null});
 const screen=await(await call('/api/admin/fiiu/checkin?activityId=day1-am',{actor:'admin'})).json();
 assert.equal(screen.qr,null);assert.equal(screen.window.open,true);
 assert.ok(Math.abs(Date.parse(screen.serverTime)-Date.parse('2026-10-21T14:15:00Z'))<60000,screen.serverTime);
 await save();const response=await scan(call,{activityId:'day1-am',code:screen.code});assert.equal(response.status,201);
 assert.ok((await response.json()).checkedInAt.startsWith('2026-10-21T14:1'),'check-in times follow the rehearsal clock');
});

test('an encoder that cannot draw the link leaves the check-in screen working with qr null',async t=>{
 const {options}=festivalClock('2026-10-21T14:00:30Z');
 const {call}=await setup(t,undefined,{...options,encodeQr:()=>{throw new RangeError('QR text is 300 bytes');}});
 const response=await call('/api/admin/fiiu/checkin?activityId=day1-am',{actor:'admin'});assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.qr,null);assert.match(body.shortCode,/^[2-9A-HJ-NP-RT-Y]{6}$/);assert.ok(body.url);
});

test('by default the check-in screen carries the real QR of its link, packed row-major',async t=>{
 const {options}=festivalClock('2026-10-21T14:00:30Z');
 const {call}=await setup(t,undefined,options);
 const body=await(await call('/api/admin/fiiu/checkin?activityId=day1-am',{actor:'admin'})).json();
 const qr=encodeQr(body.url);
 assert.equal(body.qr.size,qr.size);assert.equal((qr.size-17)%4,0);
 assert.equal(body.qr.bits,packBits(qr));assert.equal(Buffer.from(body.qr.bits,'base64').length,Math.ceil(qr.size*qr.size/8));
});

test('the staff export appends attendance, certificate hours, methods, Lima check-in times per NODAL block and the summary email status',async t=>{
 const {codes,options}=festivalClock('2026-10-21T14:12:00Z');// 09:12 in Lima
 const {call,save}=await setup(t,undefined,options);
 const {registration}=await(await save({...answers,activities:['day1-am','day2-am']})).json();await save(answers,'other');
 assert.equal((await scan(call,{activityId:'day1-am',code:codes.current('day1-am').code})).status,201);
 assert.equal((await call(`/api/admin/fiiu/registrations/${registration.id}/attendance`,{actor:'admin',method:'PUT',body:{activityId:'day2-am',attended:true}})).status,200);
 const text=(await(await call('/api/admin/fiiu/export',{actor:'admin'})).text()).replace(/^﻿/,'');
 const [header,...rows]=text.split('\r\n').map(line=>line.slice(1,-1).split('","'));
 const blocks=['day0-lab','day1-am','day1-pm','day2-am','day2-pm','day3-am'];
 assert.deepEqual(header.slice(22),['attendedActivities','attendedDays','attendedMinutes','certificateHours','checkInMethods',...blocks.map(id=>`checkInLima_${id}`),'confirmationEmail']);
 assert.equal(header.length,34);assert.ok(rows.every(row=>row.length===34));
 const field=(row,name)=>row[header.indexOf(name)],mine=rows.find(row=>row[0]===registration.id),theirs=rows.find(row=>row[0]!==registration.id);
 assert.deepEqual(['attendedActivities','attendedDays','attendedMinutes','certificateHours','checkInMethods','checkInLima_day1-am','checkInLima_day1-pm'].map(name=>field(mine,name)),
  ['day1-am; day2-am','2026-10-21; 2026-10-22','480','8','day1-am:qr; day2-am:staff','2026-10-21 09:12','']);
 assert.match(field(mine,'checkInLima_day2-am'),/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
 assert.deepEqual(['attendedActivities','attendedMinutes','certificateHours','checkInLima_day1-am'].map(name=>field(theirs,name)),['','0','0','']);
 assert.deepEqual(rows.map(row=>field(row,'confirmationEmail')),['none','none'],'no email is sent without a configured sender');
});

// The summary email: an outbox stands in for the SMTP sender. Accounts here use fiiu-inbox.dev, a placeholder outside
// the reserved test and example domains, so they are emailed; example.test accounts are skipped.
async function mailSetup(t,{outcome=()=>({status:'sent',sentAt:'2026-10-02T15:00:00.000Z'}),confirmation,wrapStore,app={}}={}){
 const outbox=[];
 const send=confirmation===null?null:confirmation??(async args=>{outbox.push(structuredClone(args));return outcome(args);});
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const cookies={},users={};
 for(const [name,email,role] of [['ana','ana@fiiu-inbox.dev','member'],['bea','bea@fiiu-inbox.dev','member'],['tester','tester@example.test','member'],['admin','admin@fiiu-inbox.dev','admin']]){users[name]=createUser(db,{fullName:name,email,passwordHash:'unused',role});cookies[name]=createSession(db,users[name].id).cookie.split(';')[0];}
 const store=createFiiuStore({db}),server=createApp({db,fiiuStore:wrapStore?wrapStore(store):store,fiiuConfirmation:send,...app});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,{actor='ana',method='GET',body}={})=>fetch(base+path,{method,headers:{Cookie:cookies[actor],Origin:base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const save=(body={},actor='ana')=>call('/api/fiiu/registration',{actor,method:'PUT',body:{version:0,...answers,...body}});
 return {db,store,call,save,outbox,users,cookies};
}

test('the first registration emails a summary once, to the account address, in the page language, and edits send nothing',async t=>{
 const {call,save,outbox,db}=await mailSetup(t);
 const first=await save({email:'spoof@example.org',language:'pt'});assert.equal(first.status,200);
 const {registration,confirmationEmail}=await first.json();
 assert.equal(confirmationEmail,'sent');assert.equal(registration.version,1,'the email outcome never bumps the version');
 assert.deepEqual([registration.confirmationStatus,registration.confirmationLanguage,registration.confirmationSentAt],['sent','pt','2026-10-02T15:00:00.000Z']);
 assert.equal(outbox.length,1);assert.equal(outbox[0].registration.email,'ana@fiiu-inbox.dev');assert.equal(outbox[0].registration.id,registration.id);assert.equal(outbox[0].language,'pt');
 assert.equal(outbox[0].config.programUrl,'https://canva.link/ficmkatcg9fudwk','the sender gets the live festival settings');
 assert.deepEqual({...db.prepare('SELECT confirmation_status s,confirmation_language l,confirmation_sent_at at,version FROM fiiu_registrations').get()},{s:'sent',l:'pt',at:'2026-10-02T15:00:00.000Z',version:1});
 const edit=await save({registrationId:registration.id,version:1,activities:['day2-pm'],language:'en'});assert.equal(edit.status,200);
 const edited=await edit.json();assert.equal(edited.confirmationEmail,undefined);assert.equal(edited.registration.version,2);assert.equal(edited.registration.confirmationStatus,'sent');assert.equal(outbox.length,1,'edits never email');
 // The status travels with the person's own data and the organiser views.
 assert.equal((await(await call('/api/fiiu/registration')).json()).registration.confirmationStatus,'sent');
 assert.equal((await(await call('/api/me/export')).json()).data.fiiu.registration.confirmationStatus,'sent');
 assert.equal((await(await call(`/api/admin/fiiu/registrations/${registration.id}`,{actor:'admin'})).json()).registration.confirmationSentAt,'2026-10-02T15:00:00.000Z');
 const csvText=await(await call('/api/admin/fiiu/export',{actor:'admin'})).text();assert.match(csvText.split('\r\n')[1],/,"sent"$/);
});

test('the summary language falls back from the page to the site language cookie to Spanish',async t=>{
 const {save,outbox,cookies,call}=await mailSetup(t);
 cookies.ana+='; nodal.lang=en';cookies.bea+='; nodal.lang=xx';
 assert.equal((await save({language:'fr'})).status,200);assert.equal(outbox.at(-1).language,'en');
 assert.equal((await save({},'bea')).status,200);assert.equal(outbox.at(-1).language,'es');
 assert.equal((await(await call('/api/fiiu/registration',{actor:'bea'})).json()).registration.confirmationLanguage,'es');
});

test('an email failure never fails the registration, and each outcome is stored as reported',async t=>{
 for(const [outcome,expected] of [[()=>({status:'failed'}),'failed'],[()=>({status:'uncertain'}),'uncertain'],[()=>{throw Error('mailer bug');},'uncertain'],[()=>({status:'weird'}),'uncertain'],[()=>({status:'sent'}),'sent']]){
  const {save,db}=await mailSetup(t,{outcome});const response=await save();assert.equal(response.status,200,expected);
  const body=await response.json();assert.equal(body.confirmationEmail,expected);assert.equal(body.registration.version,1);
  const row=db.prepare('SELECT confirmation_status s,confirmation_sent_at at FROM fiiu_registrations').get();assert.equal(row.s,expected);assert.equal(Boolean(row.at),expected==='sent','only a sent email has a time');
 }
});

test('no sender, a reserved test address, a closed registration or a failed save send nothing',async t=>{
 const off=await mailSetup(t,{confirmation:null});const plain=await(await off.save()).json();
 assert.equal(plain.confirmationEmail,'none');assert.equal(plain.registration.confirmationStatus,'none');assert.equal(plain.registration.confirmationLanguage,'es');
 const {save,outbox,call}=await mailSetup(t);
 const reserved=await(await save({},'tester')).json();assert.equal(reserved.confirmationEmail,'skipped');assert.equal(outbox.length,0);
 assert.equal((await call('/api/admin/fiiu/config',{actor:'admin',method:'PUT',body:{version:0,registrationOpen:false}})).status,200);
 assert.equal((await save()).status,403);assert.equal(outbox.length,0);
 const broken=await mailSetup(t,{wrapStore:store=>({...store,insert:async(name,record)=>{if(name==='registrations')throw Error('database unavailable');return store.insert(name,record);}})});
 assert.equal((await broken.save()).status,500);assert.equal(broken.outbox.length,0);
 assert.equal((await save({version:3})).status,403,'still closed');
});

test('concurrent first registrations send one email',async t=>{
 const {save,outbox}=await mailSetup(t);
 const results=await Promise.all([save(),save()]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(outbox.length,1);
});

test('registering again after cancelling is limited to three summary emails an hour per account, and the one over it waits for the backfill',async t=>{
 const {save,call,outbox,db,store}=await mailSetup(t);const statuses=[];
 for(let round=0;round<4;round++){
  const {registration}=await(await call('/api/fiiu/registration')).json();
  if(registration)assert.equal((await call('/api/fiiu/registration',{method:'DELETE',body:{version:registration.version,registrationId:registration.id}})).status,200);
  const response=await save();assert.equal(response.status,200);statuses.push((await response.json()).confirmationEmail);
 }
 assert.deepEqual(statuses,['sent','sent','sent','none']);assert.equal(outbox.length,3);
 assert.equal(db.prepare('SELECT confirmation_status s FROM fiiu_registrations').get().s,'none','not skipped for good');
 const listed=[];assert.equal((await sendConfirmations({store,log:line=>listed.push(line)})).listed,1,'the backfill can still send it');
 assert.equal((await(await save({},'bea')).json()).confirmationEmail,'sent','the limit is per account');
});

test('a ceiling across all accounts caps the summary emails an hour, and an account over its own limit never spends it',async t=>{
 const {save,call,outbox,db}=await mailSetup(t,{app:{fiiuEmailLimits:{perAccount:1,overall:2}}});
 const cancel=async actor=>{const {registration}=await(await call('/api/fiiu/registration',{actor})).json();assert.equal((await call('/api/fiiu/registration',{actor,method:'DELETE',body:{version:registration.version,registrationId:registration.id}})).status,200);};
 assert.equal((await(await save()).json()).confirmationEmail,'sent');
 // Ana is over her own limit: her second registration is not emailed and leaves the shared ceiling untouched.
 await cancel('ana');assert.equal((await(await save()).json()).confirmationEmail,'none');
 assert.equal((await(await save({},'bea')).json()).confirmationEmail,'sent');
 assert.equal((await(await save({},'admin')).json()).confirmationEmail,'none','the third account meets the ceiling');
 assert.equal(outbox.length,2);
 assert.deepEqual(db.prepare('SELECT confirmation_status s FROM fiiu_registrations ORDER BY s').all().map(row=>row.s),['none','none','sent']);
});

test('a save that fails before the registration is stored never uses up the account’s summary emails',async t=>{
 let failures=3;
 const {save,outbox,db}=await mailSetup(t,{wrapStore:store=>({...store,insert:async(name,record)=>{if(name==='registrations'&&failures>0){failures--;throw Object.assign(Error('upstream unavailable'),{status:502});}return store.insert(name,record);}})});
 for(let attempt=0;attempt<3;attempt++)assert.equal((await save()).status,502);
 const response=await save();assert.equal(response.status,200);assert.equal((await response.json()).confirmationEmail,'sent');
 assert.equal(outbox.length,1);assert.equal(db.prepare('SELECT confirmation_status s FROM fiiu_registrations').get().s,'sent');
});

test('a registration cancelled while its email is sending still gets an answer, and nothing is recreated',async t=>{
 let db;const setup=await mailSetup(t,{outcome:({registration})=>{db.prepare('DELETE FROM fiiu_registrations WHERE id=?').run(registration.id);return {status:'sent',sentAt:'2026-10-02T15:00:00.000Z'};}});db=setup.db;
 const response=await setup.save();assert.equal(response.status,200);assert.equal((await response.json()).confirmationEmail,'sent');
 assert.equal(db.prepare('SELECT count(*) n FROM fiiu_registrations').get().n,0);
});

test('an edit saved while the email is sending keeps its version, and the email outcome still lands',async t=>{
 let release,started;const gate=new Promise(resolve=>{release=resolve;}),begun=new Promise(resolve=>{started=resolve;});
 const {save,call,db}=await mailSetup(t,{outcome:async()=>{started();await gate;return {status:'sent',sentAt:'2026-10-02T15:00:00.000Z'};}});
 const first=save();await begun;
 const {registration}=await(await call('/api/fiiu/registration')).json();assert.equal(registration.confirmationStatus,'pending');
 assert.equal((await save({registrationId:registration.id,version:1,activities:['day2-am']})).status,200);
 release();assert.equal((await first).status,200);
 assert.deepEqual({...db.prepare('SELECT confirmation_status s,version FROM fiiu_registrations').get()},{s:'sent',version:2});
});

test('a local database made before the summary email gains its columns, and old rows read as none',async t=>{
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const user=createUser(db,{fullName:'Old',email:'old@example.com',passwordHash:'unused'});
 db.exec(`CREATE TABLE fiiu_registrations (id TEXT PRIMARY KEY,event_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,email TEXT NOT NULL,answers TEXT NOT NULL,lab_status TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(event_id,user_id));
  INSERT INTO fiiu_registrations VALUES('r1','fiiu-2026','${user.id}','old@example.com','{}','none',1,'2026-09-29T00:00:00Z','2026-09-29T00:00:00Z');`);
 const store=createFiiuStore({db});createFiiuStore({db});
 const [row]=await store.find('registrations',{id:'r1'});assert.deepEqual([row.confirmationStatus,row.confirmationLanguage,row.confirmationSentAt],['none',null,null]);
 assert.throws(()=>db.prepare("UPDATE fiiu_registrations SET confirmation_status='queued'").run(),/CHECK constraint/);
 assert.throws(()=>db.prepare("UPDATE fiiu_registrations SET confirmation_language='fr'").run(),/CHECK constraint/);
});
