import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser,toApiUser} from '../server/db.js';
import {createCourseStore} from '../server/courses-repository.js';
import {createCourseParticipants} from '../server/course-participants.js';
import {createCourseApi} from '../server/courses-api.js';
import {deleteCourseData,exportCourseData} from '../server/courses-privacy.js';
import {Readable} from 'node:stream';

async function fixture(t) {
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const staff=toApiUser(createUser(db,{fullName:'Teacher',email:'teacher@example.test',passwordHash:'test',role:'admin'}));
 const student=toApiUser(createUser(db,{fullName:'Student',email:'student@example.test',passwordHash:'test'}));
 const store=createCourseStore({db}),time=new Date().toISOString();
 const course=await store.insert('courses',{id:randomUUID(),title:'Mobility',description:'',translations:{},status:'published',startsOn:'',endsOn:'',enrollmentOpen:false,version:1,createdAt:time,updatedAt:time});
 const accounts=new Map([[student.email,{id:student.id,email:student.email,name:student.name,confirmed:true,active:true}]]);
 const sent=[];
 const repo={findCourseAccount:async email=>accounts.get(email)??null,sendCourseInvitation:async({email})=>{
   sent.push(email);const user=createUser(db,{fullName:'Invitee',email,passwordHash:'test'});return {id:user.id,email};
 }};
 const participants=createCourseParticipants({store,userRepository:repo});
 return {db,staff,student,store,course,accounts,sent,repo,participants};
}

test('admin enrollment is normalized, idempotent across races and never fabricates intake or sends email',async t=>{
 const f=await fixture(t),{participants,course,student,store,sent}=f;
 const results=await Promise.all([1,2,3].map(()=>participants.add(course,' STUDENT@example.test ')));
 assert.equal(results.filter(r=>r.result==='enrolled').length,1);
 assert.equal(await store.count('enrollments',{courseId:course.id,userId:student.id}),1);
 assert.equal(await store.count('intakes',{}),0);assert.equal(sent.length,0);
 assert.equal((await participants.add(course,student.email)).result,'already_enrolled');
 await assert.rejects(participants.add({...course,status:'draft'},student.email),{code:'participant_course_unavailable'});
 for(const email of ['',null,'bad','a'.repeat(260)+'@example.test'])await assert.rejects(participants.add(course,email),{code:'participant_email'});
 await assert.rejects(participants.add(course,'missing@example.test'),{code:'participant_not_found'});
 f.accounts.get(student.email).confirmed=false;await assert.rejects(participants.add(course,student.email),{code:'participant_unconfirmed'});
 f.accounts.get(student.email).active=false;await assert.rejects(participants.add(course,student.email),{code:'participant_unavailable'});
});

test('invites remain pending until verified ownership and preserve intake gating',async t=>{
 const {participants,store,course,staff,sent}=await fixture(t);
 const result=await participants.invite(course,'new@example.test',staff.id);
 assert.equal(result.result,'invited');assert.equal(result.invitation.deliveryStatus,'sent');assert.deepEqual(sent,['new@example.test']);
 assert.equal(await store.count('enrollments',{}),0);
 const auth={id:result.invitation.userId,email:'new@example.test',email_confirmed_at:new Date().toISOString(),is_anonymous:false};
 for(const wrong of [{...auth,id:randomUUID()},{...auth,email:'other@example.test'},{...auth,email_confirmed_at:null},{...auth,is_anonymous:true}])assert.equal(await participants.authorize(wrong),false);
 assert.equal(await participants.authorize(auth),true);
 assert.deepEqual(await participants.accept(auth),[course.id]);
 assert.equal(await store.count('enrollments',{courseId:course.id,userId:auth.id}),1);
 assert.equal(await store.count('intakes',{}),0);
 assert.equal(await participants.authorize(auth),false);
 assert.equal((await store.find('invitations',{id:result.invitation.id}))[0].acceptedAt!==null,true);
});

test('concurrent sends are reserved once and provider uncertainty stays retryable',async t=>{
 const {participants,store,course,staff,repo,sent}=await fixture(t);
 const settled=await Promise.allSettled([1,2,3].map(()=>participants.invite(course,'once@example.test',staff.id)));
 assert.equal(sent.length,1);assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);
 assert.ok(settled.filter(r=>r.status==='rejected').every(r=>r.reason.code==='invitation_rate'));
 repo.sendCourseInvitation=async()=>{throw new Error('response lost');};
 await assert.rejects(participants.invite(course,'unknown@example.test',staff.id),{code:'invitation_uncertain'});
 const row=(await store.find('invitations',{email:'unknown@example.test'}))[0];assert.equal(row.deliveryStatus,'uncertain');
 await assert.rejects(participants.invite(course,row.email,staff.id),{code:'invitation_rate'});
 await store.update('invitations',{id:row.id},{updatedAt:new Date(Date.now()-61000).toISOString()});
 repo.sendCourseInvitation=async()=>{throw Object.assign(new Error('provider reject'),{status:422});};
 await assert.rejects(participants.invite(course,row.email,staff.id),{code:'invitation_unavailable'});
 assert.equal((await store.find('invitations',{id:row.id}))[0].deliveryStatus,'uncertain');
 await assert.rejects(participants.invite(course,'never-sent@example.test',staff.id),{code:'invitation_unavailable'});
 assert.equal((await store.find('invitations',{email:'never-sent@example.test'}))[0].deliveryStatus,'failed');
});

test('a provider-rejected resend preserves the still-valid first invitation',async t=>{
 const {participants,store,course,staff,repo}=await fixture(t);
 const {invitation}=await participants.invite(course,'retry@example.test',staff.id);
 const owner={id:invitation.userId,email:invitation.email,email_confirmed_at:new Date().toISOString()};
 assert.equal(await participants.authorize(owner),true);
 await store.update('invitations',{id:invitation.id},{updatedAt:new Date(Date.now()-61000).toISOString()});
 repo.sendCourseInvitation=async()=>{throw Object.assign(new Error('cooldown'),{status:429});};
 await assert.rejects(participants.invite(course,invitation.email,staff.id),{code:'invitation_unavailable'});
 assert.equal((await store.find('invitations',{id:invitation.id}))[0].deliveryStatus,'sent');
 assert.equal(await participants.authorize(owner),true);
});

test('course enrollment API requires admin and same origin; members see no invitation data or ungated materials',async t=>{
 const {store,course,staff,student,repo}=await fixture(t);
 const api=createCourseApi({store,userRepository:repo,sameOrigin:req=>req.headers.origin==='https://nodal.test'});
 async function call(path,user,method='POST',input={email:student.email},origin='https://nodal.test') {
   const req=Readable.from([Buffer.from(JSON.stringify(input))]);Object.assign(req,{method,headers:{origin,'content-type':'application/json'}});
   const result={};const res={writeHead:(status,headers)=>Object.assign(result,{status,headers}),end:body=>{result.body=JSON.parse(body);}};
   await api({req,res,url:new URL(path,'https://nodal.test'),user});return result;
 }
 const path=`/api/admin/courses/${course.id}/participants`;
 assert.equal((await call(path,null)).status,401);
 assert.equal((await call(path,student)).status,403);
 assert.equal((await call(path,staff,'POST',{},'https://evil.test')).status,403);
 const missing=await call(path,staff,'POST',{email:'missing@example.test'});assert.equal(missing.status,404);assert.equal(missing.body.code,'participant_not_found');
 assert.equal((await call(path,staff)).status,201);
 const detail=await call(`/api/courses/${course.id}`,student,'GET');assert.equal(detail.body.enrollment.intakeCompleted,false);assert.equal(detail.body.intake,null);assert.equal(detail.body.invitations,undefined);
 assert.equal((await call(`/api/admin/courses/${course.id}/report`,student,'GET')).status,403);
 const report=await call(`/api/admin/courses/${course.id}/report`,staff,'GET');assert.equal(report.body.participants.length,1);
});

test('invitation records follow target account privacy deletion',async t=>{
 const {store,course,staff,student,db}=await fixture(t),time=new Date().toISOString();
 await store.insert('invitations',{id:randomUUID(),courseId:course.id,email:student.email,userId:null,createdBy:staff.id,deliveryStatus:'uncertain',acceptedAt:null,createdAt:time,updatedAt:time});
 const exported=await exportCourseData(store,student.id);assert.equal(exported.invitations.length,1);
 await deleteCourseData(store,student.id);assert.equal(await store.count('invitations',{email:student.email}),0);
 // A send can finish after app cleanup. Final deletion must erase even an
 // invitation which never received its target user ID from the provider.
 await store.insert('invitations',{id:randomUUID(),courseId:course.id,email:student.email,userId:null,createdBy:staff.id,deliveryStatus:'uncertain',acceptedAt:null,createdAt:time,updatedAt:time});
 db.prepare('DELETE FROM users WHERE id=?').run(student.id);
 assert.equal(await store.count('invitations',{email:student.email}),0);
});
