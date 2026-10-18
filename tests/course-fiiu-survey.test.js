import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser,toApiUser} from '../server/db.js';
import {createCourseStore} from '../server/courses-repository.js';
import {createCourseApi} from '../server/courses-api.js';
import {normalizeCourse} from '../server/courses-domain.js';
import {FINAL_SURVEY} from '../server/course-final-survey.js';
import {FIIU_COURSE_PERK,createCoursePerks} from '../server/course-perks.js';

/* The final survey and its certificates stay with the September group of the perk course
   (docs/superpowers/specs/2026-10-18-course-fiiu-access-design.md, "Final survey and certificates"). */
const OPEN_AT=Date.parse('2026-10-20T15:00:00.000Z'),CLOSES=Date.parse(FINAL_SURVEY.closesAt);
const pdf=text=>Buffer.from(`%PDF-1.4\n${text}\n%%EOF`);
const upload=bytes=>({mime:'application/pdf',data:bytes.toString('base64')});
const ANSWERS=Object.freeze({
 overallWithoutSchedule:'muy_buena',
 aspects:{content:'satisfecho',teachers:'muy_satisfecho',fieldwork:'no_aplica',schedule:'insatisfecho',access:'neutral',materials:'satisfecho',value:'satisfecho'},
 pace:{difficulty:'adecuado',sessions:'insuficiente',sessionLength:'adecuada'},
 application:'bastante',topics:[],valued:[],testimonial:'',gender:'female',age:34,country:'PE',
});
// Around the boundary: the last September instant, the first October one, a festival-week joiner, and staff enrolled in October.
const ENROLLED={ana:'2026-09-05T14:00:00.000Z',bruno:'2026-09-30T23:59:59.999Z',carla:'2026-10-01T00:00:00.000Z',dario:'2026-10-20T14:00:00.000Z',staff:'2026-10-02T00:00:00.000Z'};
const emails=text=>[...text.matchAll(/\b[a-z]+@example\.test/g)].map(match=>match[0]);

async function setup(t,{enrollmentOpen=false,perkCourse}={}) {
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const users={};
 for(const [key,fullName,role] of [['staff','Organizer','admin'],['ana','Ana Pérez','member'],['bruno','Bruno Díaz','member'],['carla','Carla Soto','member'],['dario','Darío Ríos','member']])
  users[key]=toApiUser(createUser(db,{fullName,email:`${key}@example.test`,passwordHash:'test',role}));
 const store=createCourseStore({db}),stamp='2026-09-01T00:00:00.000Z';
 const course=await store.insert('courses',{id:randomUUID(),...normalizeCourse({title:'Curso Movilidad Nivel 2',status:'published',enrollmentOpen}),version:1,createdAt:stamp,updatedAt:stamp});
 for(const [key,createdAt] of Object.entries(ENROLLED))await store.insert('enrollments',{id:randomUUID(),courseId:course.id,userId:users[key].id,createdAt});
 for(const key of ['ana','carla'])await store.insert('intakes',{id:randomUUID(),courseId:course.id,userId:users[key].id,answers:{fullName:users[key].fullName,profession:'Arquitecta'},updatedAt:stamp});
 const clock={now:OPEN_AT};
 const api=createCourseApi({store,userRepository:{getUserById:async id=>Object.values(users).find(u=>u.id===id),toApiUser:u=>u},sameOrigin:req=>req.headers.origin===`http://${req.headers.host}`,
  finalSurvey:{...FINAL_SURVEY,courseId:course.id},clock:()=>clock.now,perks:createCoursePerks({perk:{...FIIU_COURSE_PERK,courseId:perkCourse??course.id}})});
 const server=http.createServer(async(req,res)=>{try{if(!await api({req,res,url:new URL(req.url,`http://${req.headers.host}`),user:users[req.headers.cookie]})){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,{actor='ana',method='GET',body}={})=>fetch(base+path,{method,headers:{Cookie:actor,Origin:base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const json=async(...args)=>{const response=await call(...args);return {status:response.status,body:await response.json()};};
 const p=`/api/courses/${course.id}`,admin=`/api/admin/courses/${course.id}`;
 const page=async actor=>(await json(p,{actor})).body;
 const start=(actor,overall='buena')=>json(p+'/survey/start',{actor,method:'PUT',body:{overall}});
 const submit=actor=>json(p+'/survey',{actor,method:'POST',body:{answers:structuredClone(ANSWERS)}});
 const put=(actor,key)=>json(`${admin}/certificates/${users[key].id}`,{actor,method:'PUT',body:upload(pdf(key))});
 const bytesRows=()=>db.prepare('SELECT count(*) AS n FROM course_certificate_bytes').get().n;
 return {store,users,course,clock,call,json,p,admin,page,start,submit,put,bytesRows};
}
const refusal=response=>[response.status,response.body.code];

test('a new joiner gets no survey on the perk course, and start and submit answer 403 survey_unavailable',async t=>{
 const {store,course,clock,json,p,page,start,submit}=await setup(t);
 for(const actor of ['carla','dario']) {
  const body=await page(actor);
  assert.ok(body.enrollment,actor);assert.equal('finalSurvey' in body,false,actor);
  assert.deepEqual(refusal(await start(actor)),[403,'survey_unavailable'],actor);
  assert.deepEqual(refusal(await submit(actor)),[403,'survey_unavailable'],actor);
  assert.deepEqual(refusal(await json(p+'/certificate',{actor})),[404,'certificate_unavailable'],actor);
 }
 // Carla completed the course form: the course is hers, the survey is not.
 assert.equal((await page('carla')).enrollment.intakeCompleted,true);
 assert.equal(await store.count('surveys',{courseId:course.id}),0);
 // The September group, up to its last instant, answers as before; staff keep the preview whenever they enrolled.
 for(const actor of ['ana','bruno']) {
  const state=(await page(actor)).finalSurvey;
  assert.equal(state.preview,false,actor);assert.ok(state.survey,actor);
  assert.equal((await start(actor)).status,200,actor);assert.equal((await submit(actor)).status,200,actor);
 }
 assert.equal((await page('staff')).finalSurvey.preview,true);
 // After the close a new joiner is still told the survey is not theirs, not that it closed.
 clock.now=CLOSES;
 assert.deepEqual(refusal(await start('carla')),[403,'survey_unavailable']);
 assert.equal('finalSurvey' in await page('carla'),false);
});

test('the organiser cannot upload a certificate for a new joiner',async t=>{
 const {store,users,course,json,admin,put,bytesRows}=await setup(t);
 for(const key of ['carla','dario'])assert.deepEqual(refusal(await put('staff',key)),[404,'certificate_not_enrolled'],key);
 assert.equal(await store.count('certificates',{courseId:course.id}),0);assert.equal(bytesRows(),0);
 assert.deepEqual(refusal(await json(`${admin}/certificates/${users.carla.id}`,{actor:'staff'})),[404,'certificate_unavailable']);
 for(const key of ['ana','bruno'])assert.equal((await put('staff',key)).status,201,key);
 assert.equal(await store.count('certificates',{courseId:course.id,status:'ready'}),2);
});

test('the organiser roster, CSVs and counts hold the September group only',async t=>{
 const {store,users,course,call,json,admin,start,submit,put}=await setup(t);
 await start('ana');await submit('ana');await start('bruno');await put('staff','ana');
 // A later joiner's response cannot be made through the API; one stored another way is still left out.
 const at='2026-10-20T15:00:00.000Z';
 await store.insert('surveys',{id:randomUUID(),courseId:course.id,userId:users.dario.id,answers:{overall:'buena',...structuredClone(ANSWERS)},submittedAt:at,createdAt:at,updatedAt:at});
 const status=await json(admin+'/final-survey',{actor:'staff'});
 assert.equal(status.status,200);
 assert.deepEqual([status.body.total,status.body.answered,status.body.started,status.body.certificates],[2,1,1,1]);
 assert.deepEqual(status.body.participants.map(person=>person.email),['ana@example.test','bruno@example.test']);
 const responses=await call(admin+'/export?type=survey',{actor:'staff'});
 assert.equal(responses.status,200);assert.deepEqual(emails(await responses.text()),['ana@example.test']);
 const reminders=await call(admin+'/export?type=survey-status',{actor:'staff'});
 assert.equal(reminders.status,200);assert.deepEqual(emails(await reminders.text()),['ana@example.test','bruno@example.test']);
});

test('the September boundary holds with enrolment reopened, and only on the perk course',async t=>{
 const reopened=await setup(t,{enrollmentOpen:true});
 assert.equal((await reopened.page('carla')).course.enrollmentOpen,true);
 assert.equal('finalSurvey' in await reopened.page('carla'),false);
 assert.deepEqual(refusal(await reopened.start('carla')),[403,'survey_unavailable']);
 assert.deepEqual(refusal(await reopened.put('staff','dario')),[404,'certificate_not_enrolled']);
 assert.equal((await reopened.json(reopened.admin+'/final-survey',{actor:'staff'})).body.total,2);
 // When the survey's course is not the perk course, an October enrolment takes the survey as before.
 const elsewhere=await setup(t,{perkCourse:randomUUID()});
 assert.ok((await elsewhere.page('carla')).finalSurvey.survey);
 assert.equal((await elsewhere.start('carla')).status,200);assert.equal((await elsewhere.submit('carla')).status,200);
 assert.equal((await elsewhere.put('staff','dario')).status,201);
 assert.equal((await elsewhere.json(elsewhere.admin+'/final-survey',{actor:'staff'})).body.total,4);
});

test('the course page reads no survey state for a new joiner or an undated enrolment',async()=>{
 const COURSE='10000000-0000-4000-8000-000000000001',SEPTEMBER='10000000-0000-4000-8000-000000000003',OCTOBER='10000000-0000-4000-8000-000000000004',UNDATED='10000000-0000-4000-8000-000000000005';
 const enrolled={[SEPTEMBER]:'2026-09-05T14:00:00.000Z',[OCTOBER]:'2026-10-01T00:00:00.000Z',[UNDATED]:undefined};
 const calls=[];
 const store={find:async(name,filter)=>{calls.push(name);if(name==='courses')return[{id:filter.id,status:'published',title:'Course'}];if(name==='enrollments')return filter.userId in enrolled?[{userId:filter.userId,courseId:filter.courseId,createdAt:enrolled[filter.userId]}]:[];if(name==='intakes')return[{answers:{fullName:'Ana',profession:'Arquitecta'}}];return[];},getMembers:async()=>{calls.push('members');return[];}};
 const api=createCourseApi({store,finalSurvey:{...FINAL_SURVEY,courseId:COURSE},clock:()=>OPEN_AT,perks:createCoursePerks({perk:{...FIIU_COURSE_PERK,courseId:COURSE}})});
 const view=async user=>{calls.length=0;const result={};await api({req:{method:'GET',headers:{}},res:{writeHead:status=>{result.status=status;},end:body=>{result.body=JSON.parse(body);}},url:new URL('/api/courses/'+COURSE,'https://nodal.test'),user});return {...result,reads:[...calls].sort()};};
 const september=await view({id:SEPTEMBER,permission:'member'});
 assert.deepEqual(september.reads,['certificates','courses','enrollments','intakes','modules','surveys']);assert.ok(september.body.finalSurvey);
 for(const id of [OCTOBER,UNDATED]) {
  const later=await view({id,permission:'member'});
  assert.equal(later.status,200,id);assert.equal('finalSurvey' in later.body,false,id);
  assert.deepEqual(later.reads,['courses','enrollments','intakes','modules'],id);
 }
});
