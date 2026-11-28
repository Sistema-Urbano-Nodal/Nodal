import assert from 'node:assert/strict';
import {once} from 'node:events';
import test from 'node:test';
import {createSession} from '../server/auth.js';
import {createDatabase,createUser} from '../server/db.js';
import {createApp} from '../server/server.js';

const config = {kind:'course', includedEligible:true, regularCents:10000, promoCents:null, capacity:8};
const intake = {fullName:'Member',profession:'Planner',city:'Lima',motivation:'Learn',experience:'Field work',expectations:'Practice',caseStudy:'Station',digitalFamiliarity:'Comfortable'};

async function fixture(t) {
  const db = createDatabase({filename:':memory:'});
  const time = {value:Date.parse('2026-11-28T17:00:00Z')};
  const app = createApp({db, now:()=>time.value, billingEnv:{}});
  const account = (role,name) => {
    const user = createUser(db,{fullName:name, email:name+'@example.test',role,passwordHash:'test'});
    return {id:user.id,email:user.email,cookie:createSession(db,user.id).cookie.split(';')[0]};
  };
  const staff=account('admin','staff'), member=account('member','member'), other=account('member','other');
  app.listen(0,'127.0.0.1'); await once(app,'listening');
  t.after(async()=>{await new Promise(resolve=>app.close(resolve)); db.close();});
  const base='http://127.0.0.1:'+app.address().port;
  async function request(actor,path,method='GET',body,origin=base) {
    return fetch(base+path,{method,headers:{Cookie:actor?.cookie || '',Origin:origin,'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body)});
  }
  async function op(actor,path,method='GET',body,status=200) {
    const result=await request(actor,path,method,body);
    const data=await result.json();
    assert.equal(result.status,status,JSON.stringify({path,method,data}));
    return data;
  }
  async function course(overrides={}) {
    const data=await op(staff,'/api/admin/courses','POST',{title:'Training',startsOn:'2027-04-28',status:'published',...overrides},201);
    const id=data.course.id;
    return {id,admin:'/api/admin/training/'+id,member:'/api/training/'+id,course:'/api/courses/'+id};
  }
  const setTerm=(person,status='active')=>op(staff,'/api/admin/training/membership','PUT',{email:person.email,status,verified:true});
  return {staff,member,other,db,time,request,op,course,setTerm};
}

test('only staff configure real activities and activate the verified 2027 term independently of the lifetime badge',async t=>{
  const {staff,member,other,op,course,request,setTerm}=await fixture(t);
  const c=await course({status:'draft'});
  await op(null,'/api/training','GET',undefined,401);
  await op(member,c.admin+'/offering','GET',undefined,403);
  assert.equal((await request(staff,c.admin+'/offering','PUT',config,'https://other.test')).status,403);
  assert.equal((await op(staff,c.admin+'/offering')).offering,null);
  assert.equal((await op(staff,c.admin+'/offering','PUT',config)).offering.courseId,c.id);
  await op(member,c.member,'GET',undefined,404);
  assert.deepEqual((await op(member,'/api/training')).offerings,[]);
  const old=await course({startsOn:'2026-10-01'});
  await op(staff,old.admin+'/offering','PUT',config,409);
  await op(staff,'/api/admin/membership/founders','POST',{email:member.email},201);
  assert.equal((await op(member,'/api/training')).term.active,false);
  await op(staff,'/api/admin/training/membership','PUT',{email:member.email,status:'active'},400);
  assert.equal((await setTerm(member)).term.active,true);
  assert.equal((await op(staff,'/api/admin/training/membership/lookup','POST',{email:member.email})).term.active,true);
  assert.equal((await op(other,'/api/training')).term.active,false);
  await op(staff,'/api/admin/training/membership/lookup','POST',{email:'unknown@example.test'},404);
});

test('a course reservation grants content only after intake, observes suspension and preserves prior independent enrollments',async t=>{
  const {staff,member,other,db,op,course,request,setTerm,time}=await fixture(t);
  const c=await course();
  const {module}=await op(staff,'/api/admin/courses/'+c.id+'/modules','POST',{title:'Learning session',instructions:'Private session notes',status:'published'},201);
  const classPath=c.course+'/modules/'+module.id;
  await op(other,c.course+'/enroll','POST',{});
  await op(other,c.course+'/intake','PUT',intake);
  await op(staff,c.admin+'/offering','PUT',config);
  const detail=await op(member,c.course);
  assert.equal(detail.trainingConfigured,true);
  assert.equal(detail.modules.find(row=>row.id===module.id).instructions,undefined);
  assert.equal((await op(member,'/api/courses')).courses.find(row=>row.id===c.id).trainingConfigured,true);
  await op(member,c.course+'/enroll','POST',{},403);
  await op(member,c.course+'/intake','PUT',intake,403);
  await op(staff,'/api/admin/courses/'+c.id+'/participants','POST',{email:member.email},409);
  await op(staff,'/api/admin/courses/'+c.id+'/invitations','POST',{email:member.email},409);
  const url=c.member+'/reservations';
  await op(member,url,'POST',{mode:'included'},403);
  await setTerm(member);
  const first=await op(member,url,'POST',{mode:'included'});
  const again=await op(member,url,'POST',{mode:'included'});
  assert.equal(again.reservation.id,first.reservation.id);
  assert.deepEqual(again.used,{course:1,masterclass:0});
  assert.equal(again.term.phase,'early');
  await op(member,classPath,'GET',undefined,403);
  await op(member,c.course+'/intake','PUT',intake);
  assert.equal((await op(member,classPath)).module.instructions,'Private session notes');
  const uploaded=await op(member,classPath+'/attachments','POST',{name:'field.txt',mime:'text/plain',data:Buffer.from('field').toString('base64')},201);
  const file='/api/course-attachments/'+uploaded.attachment.id;
  const delivered=await request(member,file);
  assert.equal(delivered.status,200);
  assert.match(delivered.headers.get('cache-control'),/no-cache/);
  const certId='ab000000-0000-4000-8000-000000000001';
  db.prepare("INSERT INTO course_certificates(id,course_id,user_id,size,storage_path,status,created_at) VALUES(?,?,?,3,?,'ready',?)")
    .run(certId,c.id,member.id,`certificates/${c.id}/${member.id}/${certId}.pdf`,new Date(time.value).toISOString());
  db.prepare('INSERT INTO course_certificate_bytes(id,bytes) VALUES(?,?)').run(certId,Buffer.from('pdf'));
  assert.equal((await request(member,c.course+'/certificate')).status,200);
  await setTerm(member,'suspended');
  assert.equal((await op(member,c.course)).enrollment,null);
  await op(member,c.course+'/enroll','POST',{},403);
  await op(member,c.course+'/intake','PUT',intake,403);
  await op(member,classPath,'GET',undefined,403);
  assert.equal((await request(member,file)).status,403);
  assert.equal((await request(member,c.course+'/certificate')).status,404);
  assert.equal((await op(other,classPath)).module.instructions,'Private session notes');
  await setTerm(member);
  assert.equal((await op(member,classPath)).module.instructions,'Private session notes');
  time.value=Date.parse('2028-01-01T05:00Z');
  await op(member,classPath,'GET',undefined,403);
  assert.equal((await op(other,classPath)).module.instructions,'Private session notes');
});

test('pending additional payment holds a seat at the reviewed quote; only its member can release or staff can confirm',async t=>{
  const {staff,member,other,op,course,setTerm}=await fixture(t);
  const c=await course();
  await op(staff,c.admin+'/offering','PUT',{...config,capacity:1});
  await setTerm(member);
  const url=c.member+'/reservations';
  const reserve=amount=>({mode:'additional',expectedPriceCents:amount});
  const quote=(await op(member,c.member)).quoteCents;
  assert.equal(quote,8000);
  assert.equal((await op(other,c.member)).quoteCents,10000);
  await op(member,url,'POST',{mode:'additional'},400);
  await op(staff,c.admin+'/offering','PUT',{...config,capacity:1,promoCents:6500});
  assert.equal((await op(member,url,'POST',reserve(quote),409)).code,'training_price_changed');
  const first=(await op(member,url,'POST',reserve(6500))).reservation;
  const held=(await op(member,url,'POST',reserve(6500))).reservation;
  assert.equal(first.id,held.id);
  assert.equal(held.status,'pending'); assert.equal(held.priceCents,6500);
  assert.equal((await op(member,c.course)).enrollment,null);
  const roster=await op(staff,c.admin+'/reservations');
  assert.equal(roster.reservations[0].email,member.email);
  assert.equal(roster.reservations[0].id,held.id);
  assert.equal((await op(other,url,'POST',reserve(6500),409)).code,'training_full');
  const confirm=id=>({reservationId:id,email:member.email,expectedPriceCents:6500,verified:true});
  await op(member,c.admin+'/confirm','POST',confirm(first.id),403);
  await op(other,url+'/'+held.id,'DELETE');
  assert.equal((await op(member,c.member)).reservation.id,held.id);
  await op(member,url+'/'+held.id,'DELETE');
  assert.equal((await op(other,c.member)).offering.available,1);
  const next=(await op(member,url,'POST',reserve(6500))).reservation;
  assert.notEqual(next.id,first.id);
  await op(staff,c.admin+'/confirm','POST',confirm(first.id),409);
  await op(member,url+'/'+first.id,'DELETE',undefined,409);
  await op(staff,c.admin+'/confirm','POST',{...confirm(next.id),expectedPriceCents:1},409);
  await op(staff,c.admin+'/confirm','POST',{...confirm(next.id),verified:false},400);
  assert.equal((await op(staff,c.admin+'/confirm','POST',confirm(next.id))).canAccess,true);
  assert.equal((await op(staff,c.admin+'/confirm','POST',confirm(next.id))).reservation.id,next.id);
  await setTerm(member,'suspended');
  assert.equal((await op(member,c.member)).canAccess,true);
  await op(member,url+'/'+next.id,'DELETE',undefined,409);
  const exported=(await op(member,'/api/me/export')).data.training2027;
  assert.equal(exported.term.status,'suspended');
  assert.ok(exported.reservations.some(row=>row.id===next.id && row.priceCents===6500 && row.status==='enrolled'));
});

test('one included seat of each kind is separate from a zero-price activity and from an unpublished or closed activity',async t=>{
  const {staff,member,op,course,setTerm}=await fixture(t);
  await setTerm(member);
  const classes=await Promise.all([course(),course(),course(),course(),course({enrollmentOpen:false})]);
  for(const [i,c] of classes.entries()) {
    await op(staff,c.admin+'/offering','PUT',{...config,kind:i===2?'masterclass':'course',promoCents:i===3?0:null});
  }
  const reserve=(c,mode,status=200)=>op(member,c.member+'/reservations','POST',
    mode==='included'?{mode}:{mode,expectedPriceCents:0},status);
  assert.equal((await reserve(classes[3],'included',409)).code,'training_free_offering');
  const zero=await reserve(classes[3],'additional');
  assert.equal(zero.reservation.status,'enrolled');
  assert.equal(zero.canAccess,true);
  assert.deepEqual(zero.used,{course:0,masterclass:0});
  assert.equal((await reserve(classes[4],'included',409)).code,'training_closed');
  await reserve(classes[0],'included');
  assert.equal((await reserve(classes[1],'included',409)).code,'training_quota_used');
  await reserve(classes[2],'included');
  const catalog=(await op(member,'/api/courses')).training;
  assert.deepEqual(catalog.used,{course:1,masterclass:1});
});

test('the owner of an unpaid hold can release it after the activity is unpublished',async t=>{
  const {staff,member,other,course,op}=await fixture(t);
  const c=await course();
  await op(staff,c.admin+'/offering','PUT',config);
  const {reservation}=await op(member,c.member+'/reservations','POST',{mode:'additional',expectedPriceCents:config.regularCents});
  await op(staff,'/api/admin/courses/'+c.id,'PATCH',{status:'draft',version:1});
  const receipt=c.member+'/reservations/'+reservation.id;
  await op(other,receipt,'DELETE',undefined,404);
  assert.equal((await op(staff,c.admin+'/reservations')).reservations.length,1);
  const released=await op(member,receipt,'DELETE');
  assert.equal(released.reservation,null); assert.equal(released.offering,null);
  assert.equal((await op(staff,c.admin+'/reservations')).reservations.length,0);
});

test('a failed account deletion preserves the term, included access and unpaid hold; a successful retry erases only that member',async t=>{
  const {staff,member,other,db,course,op,setTerm}=await fixture(t);
  const included=await course(), extra=await course();
  for(const c of [included,extra]) await op(staff,c.admin+'/offering','PUT',config);
  await setTerm(member);
  const claim=await op(member,included.member+'/reservations','POST',{mode:'included'});
  await op(member,included.course+'/intake','PUT',intake);
  const hold=await op(member,extra.member+'/reservations','POST',{mode:'additional',expectedPriceCents:8000});
  const otherHold=await op(other,extra.member+'/reservations','POST',{mode:'additional',expectedPriceCents:10000});
  const erase=()=>({confirmEmail:member.email});
  db.exec(`CREATE TEMP TRIGGER fail_account_deletion BEFORE DELETE ON users
    WHEN OLD.email='member@example.test' BEGIN SELECT RAISE(ABORT,'simulated deletion failure'); END;`);
  await op(member,'/api/me','DELETE',erase(),500);
  assert.equal((await op(member,included.member)).reservation.id,claim.reservation.id);
  assert.equal((await op(member,included.course)).enrollment.intakeCompleted,true);
  assert.equal((await op(member,extra.member)).reservation.id,hold.reservation.id);
  assert.equal((await op(member,'/api/training')).term.active,true);
  db.exec('DROP TRIGGER fail_account_deletion');
  assert.equal((await op(member,'/api/me','DELETE',erase())).ok,true);
  await op(member,'/api/auth/me','GET',undefined,401);
  for(const table of ['training_terms_2027','training_reservations_2027','course_enrollments','course_intakes']){
    assert.equal(db.prepare('SELECT count(*) AS n FROM '+table+' WHERE user_id=?').get(member.id).n,0);
  }
  assert.equal((await op(other,extra.member)).reservation.id,otherHold.reservation.id);
  assert.equal((await op(staff,extra.admin+'/reservations')).reservations.length,1);
});
