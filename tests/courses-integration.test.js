import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createApp} from '../server/server.js';
import {createCourseStore} from '../server/courses-repository.js';
import {setupCoursePilot} from '../scripts/setup-course-pilot.js';
import {deleteCourseData} from '../server/courses-privacy.js';

test('real application protects pilot pages, disables checkout, exports and erases course data and bytes',async t=>{
  const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
  const store=createCourseStore({db});
  const course=await setupCoursePilot(store);
  await setupCoursePilot(store);
  assert.equal(await store.count('modules',{courseId:course.id,kind:'session'}),4);
  const module=(await store.find('modules',{courseId:course.id,kind:'session'}))[0];
  const member=createUser(db,{fullName:'Participant',email:'participant@example.test',passwordHash:'unused'});
  const cookie=createSession(db,member.id).cookie.split(';')[0];
  const server=createApp({db,pilotMode:true});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(path,method='GET',body)=>fetch(base+path,{method,redirect:'manual',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  assert.deepEqual(await(await fetch(base+'/api/config')).json(),{pilotMode:true});
  for(const page of ['course','courses','teaching'])assert.equal((await fetch(base+`/${page}.html`,{redirect:'manual'})).status,302);
  assert.equal((await call('/teaching.html')).status,403);
  assert.equal((await call('/payments.html')).headers.get('location'),'/courses.html');
  assert.equal((await call('/api/checkout','POST',{})).status,409);
  await call(`/api/courses/${course.id}/enroll`,'POST',{});
  await call(`/api/courses/${course.id}/intake`,'PUT',{fullName:'Participant',profession:'Planner',city:'Lima',motivation:'Learn',experience:'Some',expectations:'Practice',caseStudy:'Station',digitalFamiliarity:'Comfortable'});
  const prefix=`/api/courses/${course.id}/modules/${module.id}`;
  const {attachment}=await(await call(prefix+'/attachments','POST',{name:'note.txt',mime:'text/plain',data:Buffer.from('Observation').toString('base64')})).json();
  const {post}=await(await call(prefix+'/posts','POST',{clientId:randomUUID(),kind:'assignment',body:'Observation at station',attachmentIds:[attachment.id]})).json();
  const file=await call(`/api/course-attachments/${attachment.id}`);
  assert.equal(await file.text(),'Observation');assert.match(file.headers.get('content-disposition'),/^attachment/);
  await call('/api/feedback','POST',{action:'assignment',rating:5,courseId:course.id,moduleId:module.id});
  // The pilot course is the final-survey course. Its routes follow the real deadline, so the response and the
  // certificate are seeded directly: this test must pass on any date.
  const stamp=new Date().toISOString(),certificateId=randomUUID();
  await store.insert('surveys',{id:randomUUID(),courseId:course.id,userId:member.id,answers:{overall:'buena',gender:'prefer_not',age:40,country:'PE'},submittedAt:stamp,createdAt:stamp,updatedAt:stamp});
  const certificate=await store.insert('certificates',{id:certificateId,courseId:course.id,userId:member.id,size:12,storagePath:`certificates/${course.id}/${member.id}/${certificateId}.pdf`,status:'ready',createdAt:stamp});
  await store.putCertificate(certificate,Buffer.from('%PDF-1.4 cert'));
  // Downloading one's own certificate does not depend on the deadline; organiser routes stay closed to members.
  const pdf=await call(`/api/courses/${course.id}/certificate`);
  assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.equal(pdf.headers.get('x-frame-options'),'DENY');
  assert.equal(pdf.headers.get('cache-control'),'private, no-store');assert.equal(await pdf.text(),'%PDF-1.4 cert');
  for(const path of ['final-survey','export?type=survey',`certificates/${member.id}`])assert.equal((await call(`/api/admin/courses/${course.id}/${path}`)).status,403,path);
  assert.equal((await fetch(`${base}/api/courses/${course.id}/certificate`)).status,401);
  const {data:exported}=await(await call('/api/me/export')).json();
  assert.equal(exported.coursePilot.intakes[0].answers.city,'Lima');
  assert.equal(exported.coursePilot.attachments[0].storagePath,undefined);
  assert.equal(exported.coursePilot.surveys[0].answers.gender,'prefer_not');
  assert.deepEqual(exported.coursePilot.certificates.map(c=>[c.id,c.status,c.storagePath]),[[certificateId,'ready',undefined]]);
  assert.equal((await call('/api/me','DELETE',{confirmEmail:member.email})).status,200);
  assert.equal(await store.count('intakes',{userId:member.id}),0);
  assert.equal(await store.count('feedback',{userId:member.id}),0);
  assert.equal(await store.count('attachments',{userId:member.id}),0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM course_attachment_bytes').get().n,0);
  assert.equal(await store.count('surveys',{userId:member.id}),0);
  assert.equal(await store.count('certificates',{userId:member.id}),0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM course_certificate_bytes').get().n,0);
  const removed=(await store.find('posts',{id:post.id}))[0];
  assert.equal(removed.userId,null);assert.equal(removed.body,'');assert.equal(removed.authorName,'');
});

test('database account deletion scrubs late posts atomically and refuses unresolved private uploads',async t=>{
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const store=createCourseStore({db}),course=await setupCoursePilot(store),module=(await store.find('modules',{courseId:course.id,kind:'session'}))[0];
 const user=createUser(db,{fullName:'Departing member',email:'departing@example.test',passwordHash:'unused'});
 await deleteCourseData(store,user.id);
 // A previously authorized request lands after the app-level scrub.
 const post=await store.insert('posts',{id:randomUUID(),courseId:course.id,moduleId:module.id,userId:user.id,authorName:user.full_name,staff:false,clientId:randomUUID(),parentId:null,kind:'question',body:'Late private content',links:[],attachmentIds:[],deletedAt:null,createdAt:new Date().toISOString()});
 const attachment=await store.insert('attachments',{id:randomUUID(),courseId:course.id,moduleId:module.id,userId:user.id,name:'pending.txt',mime:'text/plain',size:5,storagePath:'test/pending',status:'pending',createdAt:new Date().toISOString()});
 assert.throws(()=>db.prepare('DELETE FROM users WHERE id=?').run(user.id),/FOREIGN KEY/);
 await store.remove('attachments',{id:attachment.id});
 // A course certificate row restricts account deletion the same way, until erasure removes it with its file.
 const certificateId=randomUUID();
 await store.insert('certificates',{id:certificateId,courseId:course.id,userId:user.id,size:5,storagePath:`certificates/${course.id}/${user.id}/${certificateId}.pdf`,status:'ready',createdAt:new Date().toISOString()});
 assert.throws(()=>db.prepare('DELETE FROM users WHERE id=?').run(user.id),/FOREIGN KEY/);
 await store.remove('certificates',{id:certificateId});
 db.prepare('DELETE FROM users WHERE id=?').run(user.id);
 const tombstone=(await store.find('posts',{id:post.id}))[0];
 assert.equal(tombstone.body,'');assert.equal(tombstone.authorName,'');assert.equal(tombstone.userId,null);
});
