import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser,toApiUser} from '../server/db.js';
import {createCourseStore} from '../server/courses-repository.js';
import {createCourseApi} from '../server/courses-api.js';
import {normalizeCourse} from '../server/courses-domain.js';
import {FIIU_COURSE_PERK,createCoursePerks} from '../server/course-perks.js';

// CSV bodies start with a UTF-8 byte order mark (Excel then reads them as UTF-8); fetch's text() would drop it.
async function parseCsv(response) {
 const bytes=Buffer.from(await response.arrayBuffer());
 assert.deepEqual([...bytes.subarray(0,3)],[0xef,0xbb,0xbf]);
 const text=bytes.toString('utf8',3),rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
  else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell='';}else if(c==='\r'&&text[i+1]==='\n'){row.push(cell);rows.push(row);row=[];cell='';i++;}else cell+=c;
 }
 row.push(cell);rows.push(row);return rows;
}

/* The perk course (its real id) and another course. Ana and Bruno enrolled in September, Bruno at the last instant
   before the boundary; Carla exactly at it and Dora during the festival. Ana and Carla are on the other course too. */
const ENROLLED={ana:'2026-09-05T14:00:00.000Z',bruno:'2026-09-30T23:59:59.999Z',carla:'2026-10-01T00:00:00.000Z',dora:'2026-10-19T15:30:00.000Z'};
const OTHER_COURSE=randomUUID();
async function setup(t,apiOptions={}) {
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const users={};
 for(const [key,fullName,role] of [['staff','Organizer','admin'],['ana','Ana Pérez','member'],['bruno','Bruno Díaz','member'],['carla','Carla Soto','member'],['dora','Dora Ruiz','member']])
  users[key]=toApiUser(createUser(db,{fullName,email:`${key}@example.test`,passwordHash:'test',role}));
 const store=createCourseStore({db}),stamp='2026-09-01T00:00:00.000Z';
 const course=await store.insert('courses',{id:FIIU_COURSE_PERK.courseId,...normalizeCourse({title:'Curso Movilidad Nivel 2',status:'published',enrollmentOpen:false}),version:1,createdAt:stamp,updatedAt:stamp});
 const otherCourse=await store.insert('courses',{id:OTHER_COURSE,...normalizeCourse({title:'Otro curso',status:'published'}),version:1,createdAt:stamp,updatedAt:stamp});
 for(const [key,createdAt] of Object.entries(ENROLLED))await store.insert('enrollments',{id:randomUUID(),courseId:course.id,userId:users[key].id,createdAt});
 for(const key of ['ana','carla'])await store.insert('enrollments',{id:randomUUID(),courseId:otherCourse.id,userId:users[key].id,createdAt:ENROLLED[key]});
 const api=createCourseApi({store,userRepository:{getUserById:async id=>Object.values(users).find(u=>u.id===id),toApiUser:u=>u},sameOrigin:req=>req.headers.origin===`http://${req.headers.host}`,...apiOptions});
 const server=http.createServer(async(req,res)=>{try{if(!await api({req,res,url:new URL(req.url,`http://${req.headers.host}`),user:users[req.headers.cookie]})){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,actor='staff')=>fetch(base+path,{headers:{Cookie:actor,Origin:base}});
 const report=async id=>(await(await call(`/api/admin/courses/${id}/report`)).json()).participants;
 const exported=async(id,type)=>{const response=await call(`/api/admin/courses/${id}/export?type=${type}`);assert.equal(response.status,200);return parseCsv(response);};
 return {users,course,otherCourse,call,report,exported};
}

test('on the perk course the report puts each participant in the September group or From October, by enrolment date',async t=>{
 const {users,course,otherCourse,call,report}=await setup(t);
 assert.deepEqual((await report(course.id)).map(p=>[p.name,p.enrolledAt,p.group]),[
  ['Ana Pérez',ENROLLED.ana,'september'],['Bruno Díaz',ENROLLED.bruno,'september'],['Carla Soto',ENROLLED.carla,'october'],['Dora Ruiz',ENROLLED.dora,'october'],
 ]);
 // Another course reports no group at all, and members still cannot read the report.
 const other=await report(otherCourse.id);
 assert.deepEqual(other.map(p=>p.userId),[users.ana.id,users.carla.id]);assert.ok(other.every(p=>!('group' in p)));
 assert.equal((await call(`/api/admin/courses/${course.id}/report`,'ana')).status,403);
});

test('the participants CSV ends with a group column on the perk course only, and the intake CSV is unchanged',async t=>{
 const {users,course,otherCourse,exported}=await setup(t);
 const rows=await exported(course.id,'participants');
 assert.deepEqual(rows[0],['userId','name','email','enrolledAt','intakeCompleted','group']);
 assert.deepEqual(rows.slice(1).map(row=>[row[0],row[3],row[4],row[5]]),[
  [users.ana.id,ENROLLED.ana,'false','September 2026'],[users.bruno.id,ENROLLED.bruno,'false','September 2026'],[users.carla.id,ENROLLED.carla,'false','From October'],[users.dora.id,ENROLLED.dora,'false','From October'],
 ]);
 const other=await exported(otherCourse.id,'participants');
 assert.deepEqual(other[0],['userId','name','email','enrolledAt','intakeCompleted']);assert.ok(other.slice(1).every(row=>row.length===5));
 assert.equal((await exported(course.id,'intake'))[0].includes('group'),false);
});

test('the group follows the course the perk names, in any letter case',async t=>{
 const {course,otherCourse,report,exported}=await setup(t,{perks:createCoursePerks({perk:{...FIIU_COURSE_PERK,courseId:OTHER_COURSE.toUpperCase()}})});
 assert.ok((await report(course.id)).every(p=>!('group' in p)));assert.equal((await exported(course.id,'participants'))[0].length,5);
 assert.deepEqual((await report(otherCourse.id)).map(p=>p.group),['september','october']);
 assert.deepEqual((await exported(otherCourse.id,'participants')).slice(1).map(row=>row[5]),['September 2026','From October']);
});
