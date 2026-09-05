import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser,toApiUser} from '../server/db.js';
import {createCourseStore} from '../server/courses-repository.js';
import {createCourseApi} from '../server/courses-api.js';
import {deleteCourseData} from '../server/courses-privacy.js';

async function setup(t) {
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const users={};for(const [key,role] of [['staff','admin'],['student','member'],['other','member']]) users[key]=toApiUser(createUser(db,{fullName:key,email:`${key}@example.test`,passwordHash:'test',role}));
 const store=createCourseStore({db});
 const api=createCourseApi({store,userRepository:{getUserById:async id=>Object.values(users).find(u=>u.id===id),toApiUser:u=>u},sameOrigin:req=>req.headers.origin===`http://${req.headers.host}`});
 const server=http.createServer(async(req,res)=>{try{if(!await api({req,res,url:new URL(req.url,`http://${req.headers.host}`),user:users[req.headers.cookie]})){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,{actor='student',method='GET',body,origin=base}={})=>fetch(base+path,{method,headers:{Cookie:actor,Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const created=await call('/api/admin/courses',{actor:'staff',method:'POST',body:{title:'Movilidad',status:'published',startsOn:'2026-09-09'}});assert.equal(created.status,201);
 const {course}=await created.json();
 const made=await call(`/api/admin/courses/${course.id}/modules`,{actor:'staff',method:'POST',body:{title:'First session',status:'published',resources:[{title:'Slides',url:'https://example.test/slides',kind:'slides'}]}});assert.equal(made.status,201);
 const {module}=await made.json();
 const intake={fullName:'Student',profession:'Planner',city:'Lima',motivation:'Learn',experience:'Beginner',expectations:'Practice',caseStudy:'Station',digitalFamiliarity:'Comfortable'};
 const enter=async(actor='student')=>{await call(`/api/courses/${course.id}/enroll`,{actor,method:'POST',body:{}});return call(`/api/courses/${course.id}/intake`,{actor,method:'PUT',body:intake});};
 return {call,course,module,enter,intake,store,users};
}

test('enrollment/intake gates, private answers, drafts and staff authorization',async t=>{
 const {call,course,module,enter,store}=await setup(t);
 await store.update('modules',{id:module.id},{translations:{pt:{title:'Sessão pública',description:'Descrição restrita',objectives:'Objetivos privados',instructions:'Instruções privadas'}}});
 assert.equal((await call('/api/courses',{actor:''})).status,401);
 assert.equal((await call('/api/admin/courses')).status,403);
 let detail=await (await call(`/api/courses/${course.id}`)).json();assert.equal(detail.enrollment,null);assert.equal(detail.modules[0].resources,undefined);
 assert.deepEqual(detail.modules[0].translations,{pt:{title:'Sessão pública'}});
 const path=`/api/courses/${course.id}/modules/${module.id}`;
 assert.equal((await call(path)).status,403);
 assert.equal((await call(`/api/courses/${course.id}/enroll`,{method:'POST',body:{},origin:'https://evil.test'})).status,403);
 const a=await (await call(`/api/courses/${course.id}/enroll`,{method:'POST',body:{}})).json();
 const b=await (await call(`/api/courses/${course.id}/enroll`,{method:'POST',body:{}})).json();assert.equal(a.enrollment.id,b.enrollment.id);
 assert.equal((await call(path)).status,403);
 assert.equal((await enter()).status,200);
 assert.equal((await call(path)).status,200);
 assert.equal((await(await call(path)).json()).module.translations.pt.instructions,'Instruções privadas');
 detail=await(await call(`/api/courses/${course.id}`,{actor:'other'})).json();assert.equal(detail.intake,null);
 const draft=await(await call(`/api/admin/courses/${course.id}/modules`,{actor:'staff',method:'POST',body:{title:'Hidden'}})).json();
 assert.equal((await call(`/api/courses/${course.id}/modules/${draft.module.id}`)).status,404);
 assert.equal((await call(`/api/admin/courses/${course.id}/report`)).status,403);
});

test('assignment, private upload, reply, idempotency, moderation and staff report persist',async t=>{
 const {call,course,module,enter}=await setup(t);await enter();
 const path=`/api/courses/${course.id}/modules/${module.id}`;
 const upload=await call(path+'/attachments',{method:'POST',body:{name:'field.txt',mime:'text/plain',data:Buffer.from('Field observation').toString('base64')}});assert.equal(upload.status,201);
 const {attachment}=await upload.json();
 assert.equal((await call(`/api/course-attachments/${attachment.id}`,{actor:'other'})).status,403);
 await enter('other');assert.equal((await call(`/api/course-attachments/${attachment.id}`,{actor:'other'})).status,404);
 const body={clientId:randomUUID(),kind:'assignment',body:'Station access',attachmentIds:[attachment.id]};
 const first=await call(path+'/posts',{method:'POST',body});assert.equal(first.status,201);const {post}=await first.json();
 assert.equal((await (await call(path+'/posts',{method:'POST',body})).json()).post.id,post.id);
 const file=await call(`/api/course-attachments/${attachment.id}`,{actor:'other'});assert.equal(file.status,200);assert.equal(await file.text(),'Field observation');
 const stolen=await call(path+'/posts',{actor:'other',method:'POST',body:{...body,clientId:randomUUID()}});assert.equal(stolen.status,400);
 const reply=await call(path+'/posts',{actor:'staff',method:'POST',body:{clientId:randomUUID(),kind:'comment',body:'Useful observation',parentId:post.id}});assert.equal(reply.status,201);assert.equal((await reply.json()).post.staff,true);
 assert.equal((await(await call(path+'/posts')).json()).posts.length,2);
 await call('/api/feedback',{method:'POST',body:{action:'assignment',courseId:course.id,moduleId:module.id,rating:4,comment:'Easy'}});
 const event={id:randomUUID(),moduleId:module.id,kind:'content_open',resourceUrl:'https://example.test/slides'};
 await call(`/api/courses/${course.id}/events`,{method:'POST',body:event});await call(`/api/courses/${course.id}/events`,{method:'POST',body:event});
 let report=await(await call(`/api/admin/courses/${course.id}/report`,{actor:'staff'})).json();assert.equal(report.summary.assignments,1);assert.equal(report.summary.comments,1);assert.equal(report.summary.contentOpens,1);assert.equal(report.feedback.length,1);
 const exported=await call(`/api/admin/courses/${course.id}/export?type=intake`,{actor:'staff'});assert.match(await exported.text(),/Lima/);
 assert.equal((await call(`/api/admin/courses/${course.id}/posts/${post.id}`,{actor:'staff',method:'DELETE'})).status,200);
 const posts=(await(await call(path+'/posts')).json()).posts;assert.equal(posts[0].body,'');assert.equal(posts[0].deleted,true);assert.equal(posts[1].parentId,post.id);
 assert.equal((await call(`/api/course-attachments/${attachment.id}`,{actor:'other'})).status,404);
});

test('version conflicts, forged events and invalid feedback fail without writes',async t=>{
 const {call,course,module,enter}=await setup(t);await enter();
 assert.equal((await call(`/api/admin/courses/${course.id}`,{actor:'staff',method:'PATCH',body:{version:1,title:'Updated'}})).status,200);
 assert.equal((await call(`/api/admin/courses/${course.id}`,{actor:'staff',method:'PATCH',body:{version:1,title:'Stale'}})).status,409);
 assert.equal((await call('/api/feedback',{method:'POST',body:{action:'course',rating:9}})).status,400);
 assert.equal((await call(`/api/courses/${course.id}/events`,{method:'POST',body:{id:randomUUID(),moduleId:module.id,kind:'recording_open',resourceUrl:'https://evil.test/fake'}})).status,400);
 assert.equal((await call(`/api/courses/${course.id}/modules/${module.id}/posts?cursor=invalid`)).status,400);
});

test('uncertain upload response retains cleanup metadata and cannot be published or erased prematurely',async t=>{
 const {call,course,module,enter,store,users}=await setup(t);await enter();
 const put=store.putFile;
 store.putFile=async(...args)=>{await put(...args);throw new Error('response lost after storage committed');};
 const path=`/api/courses/${course.id}/modules/${module.id}`;
 const response=await call(path+'/attachments',{method:'POST',body:{name:'private.txt',mime:'text/plain',data:Buffer.from('Private observation').toString('base64')}});
 assert.equal(response.status,500);
 const [pending]=await store.find('attachments',{userId:users.student.id});
 assert.equal(pending.status,'pending');assert.equal((await store.getFile(pending)).toString(),'Private observation');
 assert.equal((await call(`/api/course-attachments/${pending.id}`)).status,404);
 assert.equal((await call(path+'/posts',{method:'POST',body:{clientId:randomUUID(),kind:'assignment',body:'Cannot publish unfinished upload',attachmentIds:[pending.id]}})).status,400);
 await assert.rejects(deleteCourseData(store,users.student.id),{status:409});
 assert.equal((await store.find('attachments',{id:pending.id})).length,1);
});

test('staff feedback exports include all rows beyond the display limit and intake stays private',async t=>{
 const {call,course,enter,store,users}=await setup(t);await enter();
 const stamp=new Date().toISOString();
 for(let i=0;i<503;i++)await store.insert('feedback',{id:randomUUID(),userId:users.student.id,action:'course',courseId:course.id,moduleId:null,rating:4,comment:`response-${i}`,createdAt:stamp});
 const shown=await(await call('/api/admin/feedback',{actor:'staff'})).json();
 assert.equal(shown.feedback.length,500);assert.equal(shown.truncated,true);
 for(const path of ['/api/admin/feedback/export',`/api/admin/courses/${course.id}/export?type=feedback`]) {
   const exported=await(await call(path,{actor:'staff'})).text();
   assert.equal(exported.split('\r\n').length,504);
   assert.match(exported,/response-502/);
   assert.equal((await call(path)).status,403);
 }
});
