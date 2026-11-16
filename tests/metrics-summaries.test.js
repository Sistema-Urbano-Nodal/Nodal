import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser,toApiUser} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createApp} from '../server/server.js';
import {createFiiuStore} from '../server/fiiu-repository.js';
import {createProgramme} from '../server/fiiu-programme.js';
import {FIIU_EVENT} from '../server/fiiu-domain.js';
import {festivalSummary,festivalHours,summaryCatalogue} from '../server/fiiu-summary.js';
import {createCourseStore} from '../server/courses-repository.js';
import {createCourseApi,courseSummary,COURSE_SUMMARY_KEYS} from '../server/courses-api.js';
import {normalizeCourse} from '../server/courses-domain.js';
import {FINAL_SURVEY,finalSurveyCounts,allRows,ALL_ROWS_MAX} from '../server/course-final-survey.js';
import {FIIU_COURSE_PERK,createCoursePerks} from '../server/course-perks.js';

const answers={firstName:'Ana',lastName:'Test',country:'Perú',city:'Lima',profile:'professional',publicOfficial:false,activities:['day1-am'],externalActivities:[],nationalId:'TEST-ID',gender:'prefer_not',age:30,accessibility:['none'],motivation:'learn',previousAttendance:'no',privacyAccepted:true};

test('the festival summary the home reads is the panel\'s own',async t=>{
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const admin=createUser(db,{fullName:'admin',email:'admin@example.test',passwordHash:'unused',role:'admin'});
 const member=createUser(db,{fullName:'member',email:'member@example.test',passwordHash:'unused',role:'member'});
 const cookie=user=>createSession(db,user.id).cookie.split(';')[0];
 const store=createFiiuStore({db}),server=createApp({db,fiiuStore:store});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,user,options={})=>fetch(base+path,{...options,headers:{Cookie:cookie(user),Origin:base,'Content-Type':'application/json'}});
 const saved=await call('/api/fiiu/registration',member,{method:'PUT',body:JSON.stringify({version:0,...answers,activities:['closing-party']})});
 assert.equal(saved.status,200);
 const panel=(await(await call('/api/admin/fiiu/summary',admin)).json()).summary;
 const {summary,event}=await festivalSummary({store,programme:createProgramme({store})});
 assert.deepEqual(summary,panel);
 assert.ok(summary.activities.find(a=>a.activityId==='closing-party'));
 assert.ok(event.activities.length>0);
 assert.ok(summaryCatalogue(event).every(a=>a.registration!=='social'));
});

test('festival hours follow the browser\'s rule',()=>{
 const event=structuredClone(FIIU_EVENT);
 const row=(activityId,attendance)=>({activityId,registrations:0,externalInterests:0,attendance,officialAttendance:attendance});
 const summary={activities:[row('day1-am',2),row('workshop-espacios-comunidad',2),row('day0-lab',1)]};
 assert.equal(festivalHours(summary,event),8,'only the check-in blocks count, the lab has no length');
 event.activities.find(a=>a.id==='day1-am').minutes=null;
 assert.equal(festivalHours(summary,event),0,'a block without minutes adds nothing');
 assert.equal(festivalHours({activities:[row('day1-am',1)]},FIIU_EVENT),4);
 assert.equal(festivalHours({activities:[]},FIIU_EVENT),0);
});

async function courseFixture(t,{enrolled}) {
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const users={};
 for(const [key,role] of [['staff','admin'],['ana','member'],['bruno','member'],['carla','member'],['dario','member'],['elena','member']])
  users[key]=toApiUser(createUser(db,{fullName:`Person ${key}`,email:`${key}@example.test`,passwordHash:'test',role}));
 const store=createCourseStore({db}),stamp='2026-09-01T00:00:00.000Z';
 const course=await store.insert('courses',{id:randomUUID(),...normalizeCourse({title:'Curso',status:'published'}),version:1,createdAt:stamp,updatedAt:stamp});
 for(const [key,createdAt] of Object.entries(enrolled))await store.insert('enrollments',{id:randomUUID(),courseId:course.id,userId:users[key].id,createdAt});
 return {db,users,store,course};
}
const SEPT='2026-09-05T14:00:00.000Z';

test('the course summary is the report\'s own',async t=>{
 const {users,store,course}=await courseFixture(t,{enrolled:{ana:SEPT,bruno:SEPT}});
 const stamp='2026-09-06T00:00:00.000Z';
 await store.insert('intakes',{id:randomUUID(),courseId:course.id,userId:users.ana.id,answers:{fullName:'Ana'},updatedAt:stamp});
 const api=createCourseApi({store,userRepository:{getUserById:async id=>Object.values(users).find(u=>u.id===id),toApiUser:u=>u},sameOrigin:()=>true});
 const server=http.createServer(async(req,res)=>{try{if(!await api({req,res,url:new URL(req.url,`http://${req.headers.host}`),user:users.staff})){res.writeHead(404);res.end();}}catch(e){res.writeHead(500);res.end(e.message);}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const report=await(await fetch(`http://127.0.0.1:${server.address().port}/api/admin/courses/${course.id}/report`)).json();
 const own=await courseSummary(store,course.id);
 assert.deepEqual(own,report.summary);
 assert.deepEqual(Object.keys(own),COURSE_SUMMARY_KEYS);
 assert.deepEqual(Object.keys(report.summary),COURSE_SUMMARY_KEYS);
 assert.equal(own.enrolled,2);assert.equal(own.intakeCompleted,1);
});

test('survey counts equal the status route',async t=>{
 const {users,store,course}=await courseFixture(t,{enrolled:{staff:'2026-10-02T00:00:00.000Z',ana:SEPT,bruno:SEPT,carla:SEPT,dario:'2026-10-02T00:00:00.000Z'}});
 const at='2026-10-20T15:00:00.000Z';
 await store.insert('surveys',{id:randomUUID(),courseId:course.id,userId:users.ana.id,answers:{overall:'buena'},submittedAt:at,createdAt:at,updatedAt:at});
 await store.insert('surveys',{id:randomUUID(),courseId:course.id,userId:users.bruno.id,answers:{overall:'buena'},submittedAt:null,createdAt:at,updatedAt:at});
 await store.insert('certificates',{id:randomUUID(),courseId:course.id,userId:users.carla.id,size:4,storagePath:'certificates/x.pdf',status:'ready',createdAt:at});
 const perks=createCoursePerks({perk:{...FIIU_COURSE_PERK,courseId:course.id}});
 const counts=await finalSurveyCounts({store,courseId:course.id,perks});
 assert.deepEqual(counts,{total:3,answered:1,started:1,certificates:1});
 const api=createCourseApi({store,userRepository:{getUserById:async id=>Object.values(users).find(u=>u.id===id),toApiUser:u=>u},sameOrigin:()=>true,finalSurvey:{...FINAL_SURVEY,courseId:course.id},perks});
 const server=http.createServer(async(req,res)=>{try{if(!await api({req,res,url:new URL(req.url,`http://${req.headers.host}`),user:users.staff})){res.writeHead(404);res.end();}}catch(e){res.writeHead(500);res.end(e.message);}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const status=await(await fetch(`http://127.0.0.1:${server.address().port}/api/admin/courses/${course.id}/final-survey`)).json();
 assert.deepEqual({total:status.total,answered:status.answered,started:status.started,certificates:status.certificates},counts);
 const text=JSON.stringify(counts);
 assert.doesNotMatch(text,/@|Person|ana|bruno/);
});

test('the shared pager keeps its ceiling',async()=>{
 assert.equal(ALL_ROWS_MAX,50000);
 let read=0;
 const store={find:async(name,filters,{limit})=>Array.from({length:limit},()=>({id:`id-${read++}`,createdAt:'2026-01-01T00:00:00.000Z'}))};
 await assert.rejects(allRows(store,'events',{}),error=>error.status===503&&error.message==='course data exceeds supported size');
 assert.equal(read,50001);
 read=0;
 assert.equal((await allRows(store,'events',{},10)).length,10);
});
