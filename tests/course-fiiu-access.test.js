import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser,toApiUser} from '../server/db.js';
import {createCourseStore} from '../server/courses-repository.js';
import {createCourseApi} from '../server/courses-api.js';
import {normalizeCourse} from '../server/courses-domain.js';
import {createCoursePerks,FIIU_COURSE_PERK} from '../server/course-perks.js';

// The perk course (closed), another closed course and an open one; the perk is pointed at the first.
const PERK='30000000-0000-4000-8000-000000000001',CLOSED='30000000-0000-4000-8000-000000000002',OPEN='30000000-0000-4000-8000-000000000003';
const SEPTEMBER='2026-09-08T15:00:00.000Z';
const closed={error:'enrollment is closed',code:'enrollment_closed'};

async function setup(t,{fiiu=true}={}) {
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const users={};for(const [key,role] of [['staff','admin'],['learner','member'],['member','member'],['outsider','member']]) users[key]=toApiUser(createUser(db,{fullName:key,email:`${key}@example.test`,passwordHash:'test',role}));
 const store=createCourseStore({db});
 // The festival store as the perk reads it: registrations by event and account; cancelling removes the row.
 const fiiuState={registrations:[],reads:[],broken:false};
 const fiiuStore={find:async(name,filters,options)=>{
  fiiuState.reads.push({name,filters,options});
  if(fiiuState.broken)throw Object.assign(new Error('festival data unavailable'),{status:503});
  return fiiuState.registrations.filter(row=>Object.entries(filters).every(([key,value])=>row[key]===value)).slice(0,options?.limit??Infinity);
 }};
 const register=(user,createdAt,eventId=FIIU_COURSE_PERK.eventId)=>fiiuState.registrations.push({id:randomUUID(),eventId,userId:users[user].id,createdAt});
 const logged=[];
 const api=createCourseApi({store,userRepository:{getUserById:async id=>Object.values(users).find(u=>u.id===id),toApiUser:u=>u},sameOrigin:req=>req.headers.origin===`http://${req.headers.host}`,log:(...args)=>logged.push(args),
  perks:createCoursePerks({fiiuStore:fiiu?fiiuStore:null,perk:{...FIIU_COURSE_PERK,courseId:PERK}})});
 const server=http.createServer(async(req,res)=>{try{if(!await api({req,res,url:new URL(req.url,`http://${req.headers.host}`),user:users[req.headers.cookie]})){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,{actor='member',method='GET',body,origin=base}={})=>fetch(base+path,{method,headers:{Cookie:actor,Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 for(const [id,title,enrollmentOpen] of [[PERK,'Movilidad',false],[CLOSED,'Closed',false],[OPEN,'Open',true]]) await store.insert('courses',{id,...normalizeCourse({title,status:'published',enrollmentOpen}),version:1,createdAt:SEPTEMBER,updatedAt:SEPTEMBER});
 // The September group: enrolled before the course closed.
 await store.insert('enrollments',{id:randomUUID(),courseId:PERK,userId:users.learner.id,createdAt:SEPTEMBER});
 const detail=async(id,actor)=>(await call(`/api/courses/${id}`,{actor})).json();
 const enroll=(id,actor)=>call(`/api/courses/${id}/enroll`,{actor,method:'POST',body:{}});
 const list=async actor=>Object.fromEntries((await(await call('/api/courses',{actor})).json()).courses.map(course=>[course.id,course]));
 return {call,store,users,fiiuState,register,logged,detail,enroll,list};
}

test('a FIIU Fest 11 registrant joins the closed perk course, and only that course',async t=>{
 const {call,store,users,fiiuState,register,detail,enroll}=await setup(t);
 // Supabase's form of the last microsecond before the deadline.
 register('member','2026-10-26T04:59:59.999999+00:00');
 const preview=await detail(PERK,'member');
 assert.equal(preview.course.enrollmentOpen,false);assert.equal(preview.enrollment,null);assert.equal(preview.join,'fiiu');
 assert.deepEqual(fiiuState.reads,[{name:'registrations',filters:{eventId:'fiiu-2026',userId:users.member.id},options:{limit:1}}]);
 // Another closed course keeps today's answer, without a festival read.
 assert.equal((await detail(CLOSED,'member')).join,undefined);
 const other=await enroll(CLOSED,'member');assert.equal(other.status,403);assert.deepEqual(await other.json(),closed);
 assert.equal(fiiuState.reads.length,1);
 const joined=await enroll(PERK,'member');assert.equal(joined.status,200);
 const {enrollment}=await joined.json();assert.equal(enrollment.courseId,PERK);assert.equal(enrollment.userId,users.member.id);assert.equal(enrollment.intakeCompleted,false);
 // Joining again answers the same enrolment, as for any member.
 const again=await enroll(PERK,'member');assert.equal(again.status,200);assert.equal((await again.json()).enrollment.id,enrollment.id);
 const member=await detail(PERK,'member');assert.equal(member.enrollment.id,enrollment.id);assert.equal(member.join,undefined);
 // The join leads to the intake form, as on an open course.
 const intake={fullName:'Member',profession:'Planner',city:'Lima',motivation:'Learn',experience:'Beginner',expectations:'Practice',caseStudy:'Station',digitalFamiliarity:'Comfortable'};
 assert.equal((await call(`/api/courses/${PERK}/intake`,{method:'PUT',body:intake})).status,200);
 assert.equal((await store.find('enrollments',{courseId:PERK})).length,2);assert.equal((await store.find('enrollments',{courseId:CLOSED})).length,0);
});

test('a late, foreign, cancelled or missing registration leaves the closed course closed',async t=>{
 const cases=[
  ['at the deadline',[['2026-10-26T05:00:00Z']]],
  ['one second after it, as Supabase writes it',[['2026-10-26T05:00:01.000000+00:00']]],
  ['for another event',[['2026-10-10T12:00:00.000Z','fiiu-2025']]],
  ['none',[]],
 ];
 for(const [label,rows] of cases) {
  const {store,register,detail,enroll}=await setup(t);
  for(const [createdAt,eventId] of rows)register('member',createdAt,eventId);
  assert.equal((await detail(PERK,'member')).join,'supporters',label);
  const refused=await enroll(PERK,'member');assert.equal(refused.status,403,label);assert.deepEqual(await refused.json(),closed,label);
  // Only the September learner's enrolment.
  assert.equal((await store.find('enrollments',{courseId:PERK})).length,1,label);
 }
 // Cancelling the registration (the festival store removes the row) takes the offer away before joining.
 const {store,users,fiiuState,register,detail,enroll}=await setup(t);
 register('member','2026-10-17T14:03:22.123456+00:00');assert.equal((await detail(PERK,'member')).join,'fiiu');
 fiiuState.registrations.length=0;
 assert.equal((await detail(PERK,'member')).join,'supporters');
 const refused=await enroll(PERK,'member');assert.equal(refused.status,403);assert.deepEqual(await refused.json(),closed);
 assert.equal((await store.find('enrollments',{userId:users.member.id})).length,0);
});

test('staff and a server without the festival store get no perk',async t=>{
 const {store,users,fiiuState,register,detail,enroll,list}=await setup(t);
 register('staff','2026-10-17T14:03:22.123456+00:00');
 const staff=await detail(PERK,'staff');assert.equal(staff.join,undefined);assert.equal(staff.enrollment,null);
 assert.equal((await list('staff'))[PERK].join,undefined);
 const refused=await enroll(PERK,'staff');assert.equal(refused.status,403);assert.deepEqual(await refused.json(),closed);
 assert.deepEqual(fiiuState.reads,[]);
 assert.equal((await store.find('enrollments',{userId:users.staff.id})).length,0);

 const bare=await setup(t,{fiiu:false});
 bare.register('member','2026-10-17T14:03:22.123456+00:00');
 assert.equal((await bare.detail(PERK,'member')).join,'supporters');assert.equal((await bare.list('member'))[PERK].join,'supporters');
 const none=await bare.enroll(PERK,'member');assert.equal(none.status,403);assert.deepEqual(await none.json(),closed);
 assert.deepEqual(bare.fiiuState.reads,[]);
});

test('a failed festival read keeps the preview and fails the join, which a retry completes',async t=>{
 const {store,users,fiiuState,register,logged,detail,enroll,list}=await setup(t);
 register('member','2026-10-17T14:03:22.123456+00:00');fiiuState.broken=true;
 const preview=await detail(PERK,'member');assert.equal(preview.join,'supporters');assert.equal(preview.course.id,PERK);
 assert.equal(logged.length,1);assert.match(logged[0].join(' '),/festival data unavailable/);
 assert.equal((await list('member'))[PERK].join,'supporters');assert.equal(logged.length,2);
 const failed=await enroll(PERK,'member');assert.equal(failed.status,503);
 assert.equal((await store.find('enrollments',{userId:users.member.id})).length,0);
 fiiuState.broken=false;
 assert.equal((await enroll(PERK,'member')).status,200);
 assert.equal((await store.find('enrollments',{userId:users.member.id})).length,1);
});

test('reopening enrolment restores open joining for everyone, without festival reads',async t=>{
 const {call,fiiuState,detail,enroll,list}=await setup(t);
 assert.equal((await call(`/api/admin/courses/${PERK}`,{actor:'staff',method:'PATCH',body:{version:1,enrollmentOpen:true}})).status,200);
 const preview=await detail(PERK,'outsider');assert.equal(preview.course.enrollmentOpen,true);assert.equal(preview.join,undefined);
 assert.equal((await list('outsider'))[PERK].join,undefined);
 assert.equal((await enroll(PERK,'outsider')).status,200);
 assert.equal((await detail(PERK,'outsider')).enrollment.courseId,PERK);
 assert.deepEqual(fiiuState.reads,[]);
});

test('the course list says who is enrolled and how the closed perk course is joined, with at most one festival read',async t=>{
 const {store,users,fiiuState,register,detail,enroll,list}=await setup(t);
 await store.insert('enrollments',{id:randomUUID(),courseId:OPEN,userId:users.learner.id,createdAt:SEPTEMBER});
 register('member','2026-10-17T14:03:22.123456+00:00');
 const shape=courses=>Object.fromEntries(Object.entries(courses).map(([id,course])=>[id,{enrolled:course.enrolled,join:course.join}]));
 assert.deepEqual(shape(await list('learner')),{[PERK]:{enrolled:true,join:undefined},[CLOSED]:{enrolled:false,join:undefined},[OPEN]:{enrolled:true,join:undefined}});
 assert.deepEqual(fiiuState.reads,[]);
 assert.equal((await detail(PERK,'learner')).join,undefined);assert.deepEqual(fiiuState.reads,[]);
 assert.deepEqual(shape(await list('member')),{[PERK]:{enrolled:false,join:'fiiu'},[CLOSED]:{enrolled:false,join:undefined},[OPEN]:{enrolled:false,join:undefined}});
 assert.equal(fiiuState.reads.length,1);
 assert.deepEqual(shape(await list('outsider')),{[PERK]:{enrolled:false,join:'supporters'},[CLOSED]:{enrolled:false,join:undefined},[OPEN]:{enrolled:false,join:undefined}});
 assert.equal(fiiuState.reads.length,2);
 assert.deepEqual(shape(await list('staff')),{[PERK]:{enrolled:false,join:undefined},[CLOSED]:{enrolled:false,join:undefined},[OPEN]:{enrolled:false,join:undefined}});
 assert.equal(fiiuState.reads.length,2);
 assert.equal((await enroll(PERK,'member')).status,200);
 assert.deepEqual(shape(await list('member'))[PERK],{enrolled:true,join:undefined});
 assert.equal(fiiuState.reads.length,3);
});
