import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser,toApiUser} from '../server/db.js';
import {createCourseStore} from '../server/courses-repository.js';
import {createCourseApi,FEEDBACK_LIMIT} from '../server/courses-api.js';

/* Regressions for the course review findings: attachment download caching and budget (courses-2), files released with
   a withdrawn post (courses-3), authors withdrawing their own posts after losing access (courses-4), bounded feedback
   and deduplicated activity events (courses-5), the revision-only update poll (courses-8) and logged participant
   failures (courses-9). */
async function setup(t,{api:apiOptions={},repository={}}={}) {
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const users={};for(const [key,role] of [['staff','admin'],['student','member'],['other','member']]) users[key]=toApiUser(createUser(db,{fullName:key,email:`${key}@example.test`,passwordHash:'test',role}));
 const store=createCourseStore({db}),logs=[];
 const api=createCourseApi({store,userRepository:{getUserById:async id=>Object.values(users).find(u=>u.id===id),toApiUser:u=>u,...repository},sameOrigin:req=>req.headers.origin===`http://${req.headers.host}`,log:(...args)=>logs.push(args),...apiOptions});
 const server=http.createServer(async(req,res)=>{try{if(!await api({req,res,url:new URL(req.url,`http://${req.headers.host}`),user:users[req.headers.cookie]})){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,{actor='student',method='GET',body,headers={}}={})=>fetch(base+path,{method,headers:{Cookie:actor,Origin:base,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const {course}=await(await call('/api/admin/courses',{actor:'staff',method:'POST',body:{title:'Movilidad',status:'published',startsOn:'2026-09-09'}})).json();
 const {module}=await(await call(`/api/admin/courses/${course.id}/modules`,{actor:'staff',method:'POST',body:{title:'First session',status:'published',resources:[{title:'Slides',url:'https://example.test/slides',kind:'slides'}]}})).json();
 const intake={fullName:'Student',profession:'Planner',city:'Lima',motivation:'Learn',experience:'Beginner',expectations:'Practice',caseStudy:'Station',digitalFamiliarity:'Comfortable'};
 const enter=async(actor='student')=>{await call(`/api/courses/${course.id}/enroll`,{actor,method:'POST',body:{}});return call(`/api/courses/${course.id}/intake`,{actor,method:'PUT',body:intake});};
 const modulePath=`/api/courses/${course.id}/modules/${module.id}`;
 const upload=async(content,actor='student',name='note.txt')=>{
  const response=await call(modulePath+'/attachments',{actor,method:'POST',body:{name,mime:'text/plain',data:Buffer.from(content).toString('base64')}});
  assert.equal(response.status,201);return (await response.json()).attachment;
 };
 const post=async(attachmentIds=[],actor='student')=>{
  const response=await call(modulePath+'/posts',{actor,method:'POST',body:{clientId:randomUUID(),kind:'question',body:'With a file',attachmentIds}});
  assert.equal(response.status,201);return (await response.json()).post;
 };
 return {call,course,module,modulePath,enter,store,users,db,logs,upload,post};
}

test('courses-2: downloads are privately cacheable by id, revalidate without Storage and spend a byte budget',async t=>{
 const f=await setup(t);await f.enter();await f.enter('other');
 const file=await f.upload('Field observation');await f.post([file.id]);
 let reads=0;const getFile=f.store.getFile;f.store.getFile=async(...args)=>{reads++;return getFile(...args);};
 const download=`/api/course-attachments/${file.id}`;
 const first=await f.call(download,{actor:'other'});
 assert.equal(first.status,200);assert.equal(await first.text(),'Field observation');
 assert.equal(first.headers.get('cache-control'),'private, max-age=86400, immutable');
 assert.equal(first.headers.get('etag'),`"${file.id}"`);
 const again=await f.call(download,{actor:'other',headers:{'If-None-Match':`W/"other", "${file.id}"`}});
 assert.equal(again.status,304);assert.equal(await again.text(),'');assert.equal(again.headers.get('etag'),`"${file.id}"`);
 assert.equal(reads,1,'a revalidation never reads Storage');
 // Access is still checked before any 304: a viewer without access learns nothing from a matching tag.
 await f.call(`/api/courses/${f.course.id}/intake`,{actor:'other',method:'DELETE'});
 assert.equal((await f.call(download,{actor:'other',headers:{'If-None-Match':`"${file.id}"`}})).status,403);
});

test('courses-2: one account cannot loop 3 MB downloads past the default budget',async t=>{
 const f=await setup(t);await f.enter();
 const big=await f.upload(Buffer.alloc(3*1024*1024,7).toString('latin1'),'student','big.txt');
 let served=0,limited=null;
 for(let i=0;i<40&&!limited;i++){
  const response=await f.call(`/api/course-attachments/${big.id}`);
  if(response.status===429)limited=response;else{assert.equal(response.status,200);served+=(await response.arrayBuffer()).byteLength;}
 }
 assert.ok(limited,'the loop is stopped');assert.ok(served<=64*1024*1024,`served ${served} bytes`);
 assert.ok(Number(limited.headers.get('retry-after'))>0);assert.equal((await limited.json()).code,'download_rate');
 // The budget is per account: another viewer is unaffected.
 assert.equal((await f.call(`/api/course-attachments/${big.id}`,{actor:'staff'})).status,200);
});

test('courses-2: the teaching team reviewing a class’s files is never stopped by the member download budget',async t=>{
 const f=await setup(t);await f.enter();
 const big=await f.upload(Buffer.alloc(3*1024*1024,7).toString('latin1'),'student','big.txt');
 for(let i=0;i<25;i++){
  const response=await f.call(`/api/course-attachments/${big.id}`,{actor:'staff'});
  assert.equal(response.status,200,`staff download ${i}`);await response.arrayBuffer();
 }
});

test('courses-3: withdrawing a post removes its files from storage, downloads, reposts and the allowance',async t=>{
 const f=await setup(t);await f.enter();await f.enter('other');
 const file=await f.upload('Private note'),own=await f.post([file.id]);
 assert.equal((await f.call(`/api/course-attachments/${file.id}`,{actor:'other'})).status,200);
 assert.equal(await f.store.count('attachments',{userId:f.users.student.id}),1);
 assert.equal((await f.call(`/api/courses/${f.course.id}/posts/${own.id}`,{method:'DELETE'})).status,200);
 assert.equal(await f.store.count('attachments',{userId:f.users.student.id}),0,'the upload allowance is returned');
 await assert.rejects(f.store.getFile(file),{status:404});
 for(const actor of ['student','staff','other'])assert.equal((await f.call(`/api/course-attachments/${file.id}`,{actor})).status,404,actor);
 const repost=await f.call(f.modulePath+'/posts',{method:'POST',body:{clientId:randomUUID(),kind:'question',body:'Again',attachmentIds:[file.id]}});
 assert.equal(repost.status,400);

 // Staff moderation releases the author's file too, so it cannot be put back by reposting it.
 const moderatedFile=await f.upload('Moderated'),moderated=await f.post([moderatedFile.id]);
 assert.equal((await f.call(`/api/admin/courses/${f.course.id}/posts/${moderated.id}`,{actor:'staff',method:'DELETE'})).status,200);
 assert.equal((await f.store.find('attachments',{id:moderatedFile.id})).length,0);
 assert.equal((await f.call(f.modulePath+'/posts',{method:'POST',body:{clientId:randomUUID(),kind:'question',body:'Back',attachmentIds:[moderatedFile.id]}})).status,400);
 assert.equal((await f.call(`/api/course-attachments/${moderatedFile.id}`,{actor:'other'})).status,404);
});

test('courses-3: a file another live post still shows stays, and a Storage failure is left for reconciliation',async t=>{
 const f=await setup(t);await f.enter();await f.enter('other');
 const shared=await f.upload('Shared'),first=await f.post([shared.id]),second=await f.post([shared.id]);
 assert.equal((await f.call(`/api/courses/${f.course.id}/posts/${first.id}`,{method:'DELETE'})).status,200);
 assert.equal((await f.store.find('attachments',{id:shared.id}))[0].status,'ready');
 assert.equal((await f.call(`/api/course-attachments/${shared.id}`,{actor:'other'})).status,200);
 assert.equal((await f.call(`/api/courses/${f.course.id}/posts/${second.id}`,{method:'DELETE'})).status,200);
 assert.equal((await f.store.find('attachments',{id:shared.id})).length,0);

 const stuck=await f.upload('Stuck'),withStuck=await f.post([stuck.id]);
 const deleteFile=f.store.deleteFile;f.store.deleteFile=async()=>{throw new Error('Storage unavailable');};
 assert.equal((await f.call(`/api/courses/${f.course.id}/posts/${withStuck.id}`,{method:'DELETE'})).status,200,'the withdrawal itself succeeded');
 f.store.deleteFile=deleteFile;
 assert.equal((await f.store.find('attachments',{id:stuck.id}))[0].status,'deleting');
 assert.equal((await f.call(`/api/course-attachments/${stuck.id}`)).status,404);
 assert.ok(f.logs.some(([message,id])=>/attachment cleanup failed/.test(message)&&id===stuck.id));
});

test('courses-4: authors read and withdraw their own posts after deleting the intake, unpublishing or archiving',async t=>{
 const f=await setup(t);await f.enter();
 const [a,b,c,d]=[await f.post(),await f.post(),await f.post(),await f.post()];
 const own=id=>`/api/courses/${f.course.id}/posts/${id}`;
 await f.call(`/api/courses/${f.course.id}/intake`,{method:'DELETE'});
 assert.equal((await f.call(own(a.id),{method:'PATCH',body:{body:'Edit',expectedBody:a.body}})).status,403,'editing keeps the intake gate');
 assert.equal((await f.call(own(a.id))).status,200);
 assert.equal((await f.call(own(a.id),{method:'DELETE'})).status,200);
 await f.enter();await f.store.update('modules',{id:f.module.id},{status:'draft'});
 assert.equal((await f.call(own(b.id),{method:'PATCH',body:{body:'Edit',expectedBody:b.body}})).status,404,'editing keeps the module gate');
 assert.equal((await f.call(own(b.id),{method:'DELETE'})).status,200);
 await f.store.update('modules',{id:f.module.id},{status:'published'});await f.store.update('courses',{id:f.course.id},{status:'archived'});
 assert.equal((await f.call(own(c.id),{method:'PATCH',body:{body:'Edit',expectedBody:c.body}})).status,404,'editing keeps the course gate');
 const read=await f.call(own(c.id));assert.equal(read.status,200);assert.equal((await read.json()).post.canDelete,true);
 assert.equal((await f.call(own(c.id),{method:'DELETE'})).status,200);
 for(const id of [a.id,b.id,c.id]){const [row]=await f.store.find('posts',{id});assert.ok(row.deletedAt);assert.equal(row.body,'');}
 // Ownership is the whole authorisation: nobody else can withdraw or read it this way.
 assert.equal((await f.call(own(d.id),{actor:'other',method:'DELETE'})).status,404);
 assert.equal((await f.call(own(d.id),{actor:'other'})).status,404);
 assert.equal((await f.call(own(a.id),{method:'DELETE'})).status,404,'already withdrawn');
 assert.equal((await f.store.find('posts',{id:d.id}))[0].deletedAt,null);
});

test('courses-5: stored feedback is capped per account and repeated opens within an hour are one event',async t=>{
 const f=await setup(t);await f.enter();
 const stamp=new Date().toISOString();
 for(let i=0;i<FEEDBACK_LIMIT;i++)await f.store.insert('feedback',{id:randomUUID(),userId:f.users.other.id,action:'profile',courseId:null,moduleId:null,rating:3,comment:`c${i}`,createdAt:stamp});
 const capped=await f.call('/api/feedback',{actor:'other',method:'POST',body:{action:'profile',rating:4,comment:'x'.repeat(2000)}});
 assert.equal(capped.status,409);assert.equal((await capped.json()).code,'feedback_limit');assert.equal(await f.store.count('feedback',{userId:f.users.other.id}),FEEDBACK_LIMIT);
 assert.equal((await f.call('/api/feedback',{method:'POST',body:{action:'profile',rating:4}})).status,201,'other accounts are unaffected');
 const own=(await(await f.call('/api/feedback?action=profile',{actor:'other'})).json()).feedback[0];
 assert.equal((await f.call(`/api/feedback/${own.id}`,{actor:'other',method:'DELETE'})).status,200);
 assert.equal((await f.call('/api/feedback',{actor:'other',method:'POST',body:{action:'profile',rating:4}})).status,201,'deleting one frees a place');

 const hour=()=>new Date().toISOString().slice(0,13),startHour=hour();
 for(let i=0;i<3;i++){
  const response=await f.call(`/api/courses/${f.course.id}/events`,{method:'POST',body:{id:randomUUID(),moduleId:f.module.id,kind:'module_open'}});
  assert.equal(response.status,200);
 }
 assert.equal((await f.call(`/api/courses/${f.course.id}/events`,{method:'POST',body:{moduleId:f.module.id,kind:'content_open',resourceUrl:'https://example.test/slides'}})).status,200,'the client id is optional');
 // Three opens within one UTC hour are one row (two if the loop happened to straddle the hour).
 const opens=await f.store.count('events',{userId:f.users.student.id,kind:'module_open'});
 if(hour()===startHour)assert.equal(opens,1);else assert.ok(opens<=2);
 assert.equal(await f.store.count('events',{userId:f.users.student.id,kind:'content_open'}),1);
 const report=await(await f.call(`/api/admin/courses/${f.course.id}/report`,{actor:'staff'})).json();
 assert.equal(report.summary.moduleOpens,opens);assert.equal(report.summary.contentOpens,1);
 assert.equal((await f.call(`/api/courses/${f.course.id}/events`,{method:'POST',body:{id:'not-an-id',moduleId:f.module.id,kind:'module_open'}})).status,400);
});

test('courses-8: the latest=1 update poll answers the revision without reading posts or files',async t=>{
 const f=await setup(t);await f.enter();
 const file=await f.upload('Attached');await f.post([file.id]);
 const reads=[];const find=f.store.find,getPostAttachments=f.store.getPostAttachments;
 f.store.find=async(name,...args)=>{reads.push(name);return find.call(f.store,name,...args);};
 f.store.getPostAttachments=async(...args)=>{reads.push('getPostAttachments');return getPostAttachments.call(f.store,...args);};
 const poll=await(await f.call(f.modulePath+'/posts?kind=discussion&latest=1')).json();
 assert.deepEqual(Object.keys(poll),['revision']);
 assert.equal(reads.includes('posts'),false);assert.equal(reads.includes('getPostAttachments'),false);
 const page=await(await f.call(f.modulePath+'/posts?kind=discussion&order=desc')).json();
 assert.equal(page.revision,poll.revision);assert.equal(page.posts.length,1);
 assert.equal((await f.call(f.modulePath+'/posts?kind=nope&latest=1')).status,400);
});

test('courses-9: participant and invitation failures are logged without the address and keep their response codes',async t=>{
 const failing={findCourseAccount:async()=>null,sendCourseInvitation:async()=>{throw Object.assign(new Error('SMTP misconfigured'),{status:500});}};
 const f=await setup(t,{repository:failing});
 const invited=await f.call(`/api/admin/courses/${f.course.id}/invitations`,{actor:'staff',method:'POST',body:{email:'invitee@example.test'}});
 assert.equal(invited.status,503);assert.equal((await invited.json()).code,'invitation_uncertain');
 const logged=f.logs.find(([message])=>/course participant request failed/.test(message));
 assert.ok(logged);assert.deepEqual(logged.slice(1,3),['invitation_uncertain',503]);
 assert.doesNotMatch(JSON.stringify(f.logs),/invitee@example\.test/);
 // The provider's own error is logged as the cause, with any address it quotes masked.
 assert.match(logged.join(' '),/SMTP misconfigured/);
 const quoting={findCourseAccount:async()=>null,sendCourseInvitation:async({email})=>{throw Object.assign(new Error(`Email address "${email}" is invalid`),{status:400,code:'email_address_invalid'});}};
 const q=await setup(t,{repository:quoting});
 assert.equal((await q.call(`/api/admin/courses/${q.course.id}/invitations`,{actor:'staff',method:'POST',body:{email:'quoted@example.test'}})).status,503);
 const quoted=q.logs.find(([message])=>/course participant request failed/.test(message));
 assert.ok(quoted);assert.match(quoted.join(' '),/Email address "<address>" is invalid/);assert.ok(quoted.includes('email_address_invalid'));
 assert.doesNotMatch(JSON.stringify(q.logs),/quoted@example\.test/);

 const broken=await setup(t,{repository:{findCourseAccount:async()=>{throw new TypeError('lookup is not a function');}}});
 const added=await broken.call(`/api/admin/courses/${broken.course.id}/participants`,{actor:'staff',method:'POST',body:{email:'someone@example.test'}});
 assert.equal(added.status,503);assert.equal((await added.json()).code,'participant_unavailable');
 const unexpected=broken.logs.find(([message])=>/course participant request failed/.test(message));
 assert.ok(unexpected);assert.match(unexpected.join(' '),/lookup is not a function/);

 // An expected refusal (4xx with its own code) is not an operational error and stays out of the log.
 const quiet=await setup(t,{repository:{findCourseAccount:async()=>null}});
 assert.equal((await quiet.call(`/api/admin/courses/${quiet.course.id}/participants`,{actor:'staff',method:'POST',body:{email:'missing@example.test'}})).status,404);
 assert.equal(quiet.logs.length,0);
});
