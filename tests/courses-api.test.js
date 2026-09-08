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
 return {call,course,module,enter,intake,store,users,db};
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

test('general discussion is unique, gated, immutable in kind and uses existing post rules',async t=>{
 const {call,course,enter,store}=await setup(t);
 const discussions=await store.find('modules',{courseId:course.id,kind:'discussion'});assert.equal(discussions.length,1);
 const module=discussions[0],path=`/api/courses/${course.id}/modules/${module.id}`;
 assert.equal((await call(path+'/posts')).status,403);await enter();
 assert.equal((await call(path+'/posts',{method:'POST',body:{clientId:randomUUID(),kind:'question',body:'Where can we exchange ideas?'}})).status,201);
 assert.equal((await call(path+'/posts',{method:'POST',body:{clientId:randomUUID(),kind:'assignment',body:'Wrong area'}})).status,400);
 assert.equal((await call(`/api/admin/courses/${course.id}/modules`,{actor:'staff',method:'POST',body:{title:'Duplicate',kind:'discussion'}})).status,400);
 assert.equal((await call(`/api/admin/courses/${course.id}/modules/${module.id}`,{actor:'staff',method:'PATCH',body:{version:module.version,kind:'session'}})).status,400);
 assert.equal((await call(`/api/admin/courses/${course.id}/modules/${module.id}`,{method:'PATCH',body:{version:module.version,title:'Student edit'}})).status,403);
 assert.equal((await(await call(path+'/posts?kind=discussion')).json()).posts.length,1);
 assert.equal((await(await call(path+'/posts?kind=assignment')).json()).posts.length,0);
});

test('official material uploads are course-owned, published by versioned resources and never forged from student files',async t=>{
 const {call,course,module,enter,store,users,db}=await setup(t);await enter();
 const path=`/api/admin/courses/${course.id}/modules/${module.id}`,studentPath=path.replace('/admin','');
 const file={name:'Official reading.pdf',mime:'application/pdf',data:Buffer.from('%PDF-1.4 official material').toString('base64')};
 assert.equal((await call(path+'/attachments',{method:'POST',body:file})).status,403);
 const uploaded=await call(path+'/attachments',{actor:'staff',method:'POST',body:file});assert.equal(uploaded.status,201);
 const {attachment}=await uploaded.json();const [row]=await store.find('attachments',{id:attachment.id});assert.equal(row.userId,null);assert.equal(row.purpose,'material');assert.equal(attachment.storagePath,undefined);
 const download=`/api/course-attachments/${attachment.id}`;
 assert.equal((await call(download)).status,404);assert.equal((await call(download,{actor:''})).status,401);
 const studentFile=await(await call(studentPath+'/attachments',{method:'POST',body:file})).json();
 assert.equal((await call(path,{actor:'staff',method:'PATCH',body:{version:1,resources:[{title:'Forged',attachmentId:studentFile.attachment.id}]}})).status,400);
 const resource={title:'Official reading',attachmentId:attachment.id,kind:'reading',translations:{pt:{title:'Leitura oficial'}}};
 const results=await Promise.all([1,2].map(()=>call(path,{actor:'staff',method:'PATCH',body:{version:1,resources:[resource]}})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal((await call(download)).status,200);assert.equal((await call(download,{actor:'other'})).status,403);
 assert.equal((await call(studentPath+'/posts',{method:'POST',body:{clientId:randomUUID(),body:'Forged material',attachmentIds:[attachment.id]}})).status,400);
 await deleteCourseData(store,users.staff.id);db.prepare('DELETE FROM users WHERE id=?').run(users.staff.id);assert.equal((await store.find('attachments',{id:attachment.id})).length,1);assert.equal((await call(download)).status,200);
 assert.equal((await call(path,{actor:'staff',method:'PATCH',body:{version:2,status:'draft'}})).status,200);assert.equal((await call(download)).status,404);
 assert.equal((await call(path,{actor:'staff',method:'PATCH',body:{version:3,status:'published',resources:[]}})).status,200);assert.equal((await call(download)).status,404);
});

test('filtered newest-first history keeps assignment replies, detects changes beyond 30 and moderation',async t=>{
 const {call,course,module,enter,store}=await setup(t);await enter();
 const path=`/api/courses/${course.id}/modules/${module.id}/posts`;
 const assignment=(await(await call(path,{method:'POST',body:{clientId:randomUUID(),kind:'assignment',body:'Task'}})).json()).post;
 const reply=(await(await call(path,{method:'POST',body:{clientId:randomUUID(),kind:'comment',parentId:assignment.id,body:'Task reply'}})).json()).post;
 for(let i=0;i<32;i++){const made=await call(path,{method:'POST',body:{clientId:randomUUID(),kind:'question',body:`Question ${i}`}});assert.equal(made.status,201);const {post}=await made.json();await store.update('posts',{id:post.id},{createdAt:new Date(Date.UTC(2030,0,1,0,0,i)).toISOString()});}
 const assignments=await(await call(path+'?kind=assignment')).json();assert.deepEqual(assignments.posts.map(p=>p.id).sort(),[assignment.id,reply.id].sort());
 const first=await(await call(path+'?kind=discussion&order=desc')).json();assert.equal(first.posts.length,30);assert.equal(first.posts[0].body,'Question 31');
 const second=await(await call(path+'?kind=discussion&order=desc&cursor='+first.nextCursor)).json();assert.equal(second.posts.length,2);assert.equal(new Set([...first.posts,...second.posts].map(p=>p.id)).size,32);
 const latest=await(await call(path+'?latest=1&kind=discussion')).json();assert.equal(latest.posts[0].body,'Question 31');assert.equal(latest.nextCursor,null);
 await call(`/api/admin/courses/${course.id}/posts/${latest.posts[0].id}`,{actor:'staff',method:'DELETE'});
 const moderated=await(await call(path+'?latest=1&kind=discussion')).json();assert.ok(moderated.revision>latest.revision);assert.equal(moderated.posts[0].deleted,true);
});

test('official material erasure is explicit, retryable, and serialized against resource publication',async t=>{
 const {call,course,module,enter,store}=await setup(t);await enter();
 const path=`/api/admin/courses/${course.id}/modules/${module.id}`;
 const upload=await(await call(path+'/attachments',{actor:'staff',method:'POST',body:{name:'Reading.txt',mime:'text/plain',data:Buffer.from('Teaching material').toString('base64')}})).json();
 const id=upload.attachment.id,resource={title:'Reading',attachmentId:id};
 const listed=await(await call(path+'/attachments',{actor:'staff'})).json();assert.equal(listed.attachments[0].id,id);assert.equal(listed.attachments[0].referenced,false);assert.equal(listed.attachments[0].storagePath,undefined);assert.equal((await call(path+'/attachments')).status,403);
 await call(path,{actor:'staff',method:'PATCH',body:{version:1,resources:[resource]}});
 assert.equal((await call(path+'/attachments/'+id,{actor:'staff',method:'DELETE'})).status,409);
 await assert.rejects(store.update('attachments',{id},{status:'deleting'}),{status:409});
 await call(path,{actor:'staff',method:'PATCH',body:{version:2,resources:[]}});
 const deleteFile=store.deleteFile;store.deleteFile=async()=>{throw new Error('Storage unavailable');};
 assert.equal((await call(path+'/attachments/'+id,{actor:'staff',method:'DELETE'})).status,500);
 assert.equal((await store.find('attachments',{id}))[0].status,'deleting');
 assert.equal((await call(`/api/course-attachments/${id}`)).status,404);
 await assert.rejects(store.update('modules',{id:module.id},{resources:[resource]}),{status:409});
 store.deleteFile=deleteFile;assert.equal((await call(path+'/attachments/'+id,{actor:'staff',method:'DELETE'})).status,200);
 assert.equal((await store.find('attachments',{id})).length,0);
});

test('uncertain official uploads remain private and can be reconciled after account deletion',async t=>{
 const {call,course,module,store,users,db}=await setup(t);
 const {reconcileCourseUploads}=await import('../scripts/reconcile-course-uploads.js');
 const put=store.putFile;store.putFile=async(...args)=>{await put(...args);throw new Error('lost response');};
 const path=`/api/admin/courses/${course.id}/modules/${module.id}`;
 assert.equal((await call(path+'/attachments',{actor:'staff',method:'POST',body:{name:'Official.txt',mime:'text/plain',data:Buffer.from('Course-owned').toString('base64')}})).status,500);
 const [pending]=await store.find('attachments',{purpose:'material'});assert.equal(pending.status,'pending');
 assert.equal((await call(`/api/course-attachments/${pending.id}`,{actor:'staff'})).status,404);
 assert.equal((await call(path,{actor:'staff',method:'PATCH',body:{version:1,resources:[{title:'Unfinished',attachmentId:pending.id}]}})).status,400);
 assert.equal((await call(path+'/attachments/'+pending.id,{actor:'staff',method:'DELETE'})).status,409);
 await deleteCourseData(store,users.staff.id);db.prepare('DELETE FROM users WHERE id=?').run(users.staff.id);
 assert.equal((await store.getFile(pending)).toString(),'Course-owned');
 const result=await reconcileCourseUploads(store,{apply:true,now:Date.now()+25*60*60*1000});assert.equal(result.removed,1);
 assert.equal((await store.find('attachments',{id:pending.id})).length,0);
});

test('owners edit only post text and can delete questions, assignments and replies without erasing the thread',async t=>{
 const {call,course,module,enter,store}=await setup(t);await enter();await enter('other');
 const path=`/api/courses/${course.id}/modules/${module.id}/posts`,own=id=>`/api/courses/${course.id}/posts/${id}`;
 const upload=await(await call(path.replace('/posts','/attachments'),{method:'POST',body:{name:'note.txt',mime:'text/plain',data:Buffer.from('Private note').toString('base64')}})).json();
 const posts=[];
 for(const kind of ['question','assignment','comment']){
  const input={clientId:randomUUID(),kind,body:`Original ${kind}`,links:[{title:'Source',url:'https://example.test/source'}],...(kind==='question'?{attachmentIds:[upload.attachment.id]}:{}),...(kind==='comment'?{parentId:posts[0].id}:{})};
  const {post}=await(await call(path,{method:'POST',body:input})).json();posts.push(post);
  assert.equal(post.canEdit,true);assert.equal(post.canDelete,true);
  const [before]=await store.find('posts',{id:post.id});
  const edited=await call(own(post.id),{method:'PATCH',body:{body:`Edited ${kind}`,expectedBody:post.body,userId:'forged',kind:'question',links:[],attachmentIds:[]}});assert.equal(edited.status,200);
  const [after]=await store.find('posts',{id:post.id});assert.deepEqual(after,{...before,body:`Edited ${kind}`});
  assert.equal((await edited.json()).post.canEdit,true);
  assert.equal((await call(own(post.id),{method:'PATCH',body:{body:'Stale',expectedBody:post.body}})).status,409);
  assert.equal((await call(own(post.id),{method:'PATCH',body:{body:'   ',expectedBody:after.body}})).status,400);
  assert.equal((await call(own(post.id),{method:'PATCH',body:{body:'Missing comparison'}})).status,400);
 }
 for(const actor of ['other','staff']){
  const view=await(await call(path,{actor})).json();assert.ok(view.posts.every(p=>!p.canEdit&&!p.canDelete));
  for(const method of ['PATCH','DELETE'])assert.equal((await call(own(posts[0].id),{actor,method,body:{body:'Stolen',expectedBody:'Edited question'}})).status,404);
 }
 const revision=(await(await call(path)).json()).revision;
 assert.equal((await call(own(posts[0].id),{method:'DELETE',body:{}})).status,200);
 let view=await(await call(path)).json();const deleted=view.posts.find(p=>p.id===posts[0].id),reply=view.posts.find(p=>p.id===posts[2].id);
 assert.deepEqual((await(await call(own(deleted.id))).json()).post,deleted);assert.equal(deleted.deleted,true);assert.equal(deleted.canEdit,false);assert.equal(deleted.canDelete,false);assert.equal(deleted.body,'');assert.deepEqual(deleted.attachments,[]);assert.deepEqual(deleted.links,[]);
 assert.equal(reply.body,'Edited comment');assert.equal(reply.parentId,deleted.id);assert.ok(view.revision>revision);
 assert.equal((await call(`/api/course-attachments/${upload.attachment.id}`,{actor:'other'})).status,404);
 assert.equal((await call(own(deleted.id),{method:'PATCH',body:{body:'Resurrection',expectedBody:''}})).status,404);
 for(const post of posts.slice(1))assert.equal((await call(own(post.id),{method:'DELETE',body:{}})).status,200);
});

test('post ownership mutations retain session, origin, course, module and intake gates',async t=>{
 const {call,course,module,enter,store,users}=await setup(t);await enter();
 const {post}=await(await call(`/api/courses/${course.id}/modules/${module.id}/posts`,{method:'POST',body:{clientId:randomUUID(),body:'My question'}})).json();
 const path=`/api/courses/${course.id}/posts/${post.id}`,body={body:'Edited',expectedBody:post.body};
 assert.equal((await call(path,{actor:'',method:'PATCH',body})).status,401);
 assert.equal((await call(path,{method:'DELETE',body:{},origin:'https://evil.test'})).status,403);
 await store.update('modules',{id:module.id},{status:'draft'});assert.equal((await call(path,{method:'PATCH',body})).status,404);
 await store.update('modules',{id:module.id},{status:'published'});await store.remove('intakes',{courseId:course.id,userId:users.student.id});assert.equal((await call(path,{method:'DELETE',body:{}})).status,403);
 await enter();await store.update('courses',{id:course.id},{status:'draft'});assert.equal((await call(path,{method:'PATCH',body})).status,404);
 assert.equal((await store.find('posts',{id:post.id}))[0].body,post.body);
});

test('post compare-and-update rejects concurrent edits and never resurrects a moderated post',async t=>{
 const {call,course,module,enter,store}=await setup(t);await enter();
 const {post}=await(await call(`/api/courses/${course.id}/modules/${module.id}/posts`,{method:'POST',body:{clientId:randomUUID(),body:'Original'}})).json();
 const path=`/api/courses/${course.id}/posts/${post.id}`,update=store.update.bind(store);let release,arrived=0;
 const barrier=new Promise(resolve=>{release=resolve;});
 store.update=async(name,filters,patch)=>{if(name==='posts'&&!patch.deletedAt){if(++arrived===2)release();await barrier;}return update(name,filters,patch);};
 const results=await Promise.all(['A','B'].map(body=>call(path,{method:'PATCH',body:{body,expectedBody:'Original'}})));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const [current]=await store.find('posts',{id:post.id});
 store.update=async(name,filters,patch)=>{if(name==='posts'&&!patch.deletedAt)await update('posts',{id:post.id},{body:'',links:[],attachmentIds:[],deletedAt:new Date().toISOString()});return update(name,filters,patch);};
 assert.equal((await call(path,{method:'PATCH',body:{body:'Resurrection',expectedBody:current.body}})).status,409);
 const [deleted]=await store.find('posts',{id:post.id});assert.equal(deleted.body,'');assert.ok(deleted.deletedAt);
});

test('deleting an intake keeps enrollment, removes only own answers and gates content until resubmission',async t=>{
 const {call,course,module,enter,store,users}=await setup(t);await enter();await enter('other');
 const path=`/api/courses/${course.id}/intake`;
 assert.equal((await call(path,{method:'DELETE',body:{userId:users.other.id}})).status,200);
 assert.equal((await store.find('intakes',{courseId:course.id,userId:users.student.id})).length,0);
 assert.equal((await store.find('intakes',{courseId:course.id,userId:users.other.id})).length,1);
 const detail=await(await call(`/api/courses/${course.id}`)).json();assert.ok(detail.enrollment);assert.equal(detail.enrollment.intakeCompleted,false);assert.equal(detail.intake,null);
 assert.equal((await call(`/api/courses/${course.id}/modules/${module.id}`)).status,403);
 assert.equal((await enter()).status,200);assert.equal((await call(`/api/courses/${course.id}/modules/${module.id}`)).status,200);
});

test('own feedback history is exactly context scoped, paginated and editable after a course closes',async t=>{
 const {call,course,module,enter,store,users}=await setup(t);await enter();
 const context={action:'discussion',courseId:course.id,moduleId:module.id},stamp='2026-09-07T12:00:00.000Z',ids=[];
 for(let i=0;i<23;i++){const id=randomUUID();ids.push(id);await store.insert('feedback',{id,userId:users.student.id,...context,rating:3,comment:'Own '+i,createdAt:stamp});}
 await store.insert('feedback',{id:randomUUID(),userId:users.other.id,...context,rating:1,comment:'Other private feedback',createdAt:stamp});
 await store.insert('feedback',{id:randomUUID(),userId:users.student.id,...context,moduleId:null,rating:1,comment:'Other context',createdAt:stamp});
 await store.update('courses',{id:course.id},{status:'draft'});
 const path='/api/feedback?'+new URLSearchParams(context),firstResponse=await call(path);assert.equal(firstResponse.status,200);const first=await firstResponse.json();
 const second=await(await call(path+'&cursor='+first.nextCursor)).json();assert.equal(first.feedback.length,20);assert.equal(second.feedback.length,3);assert.equal(second.nextCursor,null);
 assert.deepEqual([...first.feedback,...second.feedback].map(f=>f.id),ids.sort().reverse());
 const empty=await(await call('/api/feedback?action=discussion')).json();assert.deepEqual(empty.feedback,[]);
 const allFirst=await(await call('/api/feedback')).json(),allSecond=await(await call('/api/feedback?cursor='+allFirst.nextCursor)).json();assert.equal(allFirst.feedback.length+allSecond.feedback.length,24);assert.ok([...allFirst.feedback,...allSecond.feedback].every(f=>f.userId===users.student.id));
 const id=first.feedback[0].id,recordPath=`/api/feedback/${id}`;
 for(const actor of ['other','staff'])for(const method of ['PATCH','DELETE'])assert.equal((await call(recordPath,{actor,method,body:{rating:5,comment:'Stolen'}})).status,404);
 assert.equal((await call(recordPath,{method:'PATCH',body:{rating:9,comment:'Bad'}})).status,400);
 const changed=await call(recordPath,{method:'PATCH',body:{rating:5,comment:'Correction',userId:users.other.id,action:'profile',courseId:null,moduleId:null}});assert.equal(changed.status,200);
 const updated=(await changed.json()).feedback;assert.equal(updated.userId,users.student.id);assert.equal(updated.courseId,course.id);assert.equal(updated.moduleId,module.id);assert.equal(updated.action,'discussion');assert.equal(updated.rating,5);assert.equal(updated.comment,'Correction');
 assert.equal((await call(recordPath,{method:'DELETE',body:{}})).status,200);assert.equal((await store.find('feedback',{id})).length,0);
 assert.equal((await call(recordPath,{method:'PATCH',body:{rating:4,comment:'Gone'}})).status,404);assert.equal((await call(recordPath,{method:'DELETE',body:{}})).status,404);
 assert.equal((await call('/api/feedback?action=not-real')).status,400);
});


test('intake save racing deletion reports conflict rather than claiming missing answers were saved',async t=>{
 const {call,course,enter,store,intake}=await setup(t);await enter();
 const update=store.update.bind(store);
 store.update=async(name,filter,patch)=>{if(name==='intakes')await store.remove(name,filter);return update(name,filter,patch);};
 assert.equal((await call(`/api/courses/${course.id}/intake`,{method:'PUT',body:{...intake,city:'Updated city'}})).status,409);
 assert.equal((await store.find('intakes',{courseId:course.id})).length,0);
});

test('equal-position sessions use session date before ID while explicit positions still take precedence',async t=>{
 const {call,course,module,store}=await setup(t);
 await store.update('modules',{id:module.id},{id:'10000000-0000-4000-8000-000000000001',position:3,sessionDate:'2026-09-16'});module.id='10000000-0000-4000-8000-000000000001';
 const made=async(title,position,sessionDate)=>(await(await call(`/api/admin/courses/${course.id}/modules`,{actor:'staff',method:'POST',body:{title,position,sessionDate,status:'published'}})).json()).module;
 const earlier=await made('September 14',3,'2026-09-14'),explicit=await made('Explicit first',2,'2026-09-21');
 await store.update('modules',{id:earlier.id},{id:'f0000000-0000-4000-8000-000000000001'});earlier.id='f0000000-0000-4000-8000-000000000001';
 const response=await(await call(`/api/courses/${course.id}`,{actor:'staff'})).json();
 assert.deepEqual(response.modules.filter(m=>m.kind==='session').map(m=>m.id),[explicit.id,earlier.id,module.id]);
});
