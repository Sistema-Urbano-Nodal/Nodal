import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser,toApiUser} from '../server/db.js';
import {createCourseStore} from '../server/courses-repository.js';
import {createCourseApi} from '../server/courses-api.js';
import {encodeCursor} from '../server/courses-domain.js';
import {setupCoursePilot} from '../scripts/setup-course-pilot.js';

// The September conversation of the perk course stays with the September group
// (docs/superpowers/specs/2026-10-18-course-fiiu-access-design.md, "Posts: hidden by date, by thread").
const SEPTEMBER='2026-09-07T12:00:00.000Z',OCTOBER='2026-10-18T12:00:00.000Z';
const intake={fullName:'Member',profession:'Planner',city:'Lima',motivation:'Learn',experience:'Some',expectations:'Practice',caseStudy:'Station',digitalFamiliarity:'Comfortable'};

// The pilot shell is the perk course; the API keeps its default perks (no FIIU store), as createApp({fiiuStore:null}) does.
async function setup(t) {
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const users={};for(const [key,role] of [['staff','admin'],['september','member'],['joiner','member'],['peer','member'],['late','member']]) users[key]=toApiUser(createUser(db,{fullName:key,email:`${key}@example.test`,passwordHash:'test',role}));
 const store=createCourseStore({db}),course=await setupCoursePilot(store);
 await store.update('courses',{id:course.id},{enrollmentOpen:false});
 const api=createCourseApi({store,userRepository:{getUserById:async id=>Object.values(users).find(u=>u.id===id),toApiUser:u=>u},sameOrigin:req=>req.headers.origin===`http://${req.headers.host}`});
 const server=http.createServer(async(req,res)=>{try{if(!await api({req,res,url:new URL(req.url,`http://${req.headers.host}`),user:users[req.headers.cookie]})){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,{actor='joiner',method='GET',body,headers={}}={})=>fetch(base+path,{method,headers:{Cookie:actor,Origin:base,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 // September learners enrolled before 1 October; the joiner and the peer since, as FIIU registrants will.
 for(const [key,createdAt] of [['september',SEPTEMBER],['joiner',OCTOBER],['peer',OCTOBER]]) {
  await store.insert('enrollments',{id:randomUUID(),courseId:course.id,userId:users[key].id,createdAt});
  await store.insert('intakes',{id:randomUUID(),courseId:course.id,userId:users[key].id,answers:intake,updatedAt:createdAt});
 }
 const [module]=await store.find('modules',{courseId:course.id,kind:'session'},{order:['position','sessionDate','id'],limit:1});
 const prefix=`/api/courses/${course.id}/modules/${module.id}`;
 const post=(actor,createdAt,fields={})=>store.insert('posts',{id:randomUUID(),courseId:course.id,moduleId:module.id,userId:users[actor].id,authorName:actor,staff:actor==='staff',clientId:randomUUID(),parentId:null,kind:fields.parentId?'comment':'question',threadKind:'discussion',body:`${actor} at ${createdAt}`,links:[],attachmentIds:[],deletedAt:null,createdAt,...fields});
 const upload=async(actor,text)=>{const response=await call(prefix+'/attachments',{actor,method:'POST',body:{name:'notes.txt',mime:'text/plain',data:Buffer.from(text).toString('base64')}});assert.equal(response.status,201);return (await response.json()).attachment;};
 const ids=async(actor,query='')=>{const response=await call(prefix+'/posts'+query,{actor});assert.equal(response.status,200);return (await response.json()).posts.map(p=>p.id);};
 const download=(id,actor,headers={})=>call(`/api/course-attachments/${id}`,{actor,headers});
 const reply=(parentId,actor='joiner')=>call(prefix+'/posts',{actor,method:'POST',body:{clientId:randomUUID(),kind:'comment',body:'A reply',parentId}});
 return {call,course,module,prefix,post,upload,ids,download,reply,store,users};
}
// A September thread with an October teaching-team reply and a reply under that, and an October thread.
async function conversation({post,upload}) {
 const [septemberFile,staffFile,octoberFile]=[await upload('september','September photo'),await upload('staff','Teaching notes'),await upload('september','October answer')];
 const september=await post('september','2026-09-10T15:00:00.000Z',{attachmentIds:[septemberFile.id]});
 const lastSeptember=await post('september','2026-09-30T23:59:59.999Z');
 const teaching=await post('staff','2026-10-05T10:00:00.000Z',{parentId:september.id,attachmentIds:[staffFile.id]});
 const nested=await post('september','2026-10-06T10:00:00.000Z',{parentId:teaching.id});
 const first=await post('staff','2026-10-01T00:00:00.000Z');
 const answer=await post('september','2026-10-03T10:00:00.000Z',{parentId:first.id,attachmentIds:[octoberFile.id]});
 return {septemberFile,staffFile,octoberFile,september,lastSeptember,teaching,nested,first,answer};
}

test('a new joiner never receives a September post, a reply under one, or their files, and cannot answer them',async t=>{
 const context=await setup(t),{ids,download,reply,post,upload,store}=context;
 const c=await conversation(context);
 for(const actor of ['joiner','peer']) {
  assert.deepEqual(await ids(actor),[c.first.id,c.answer.id]);
  assert.deepEqual(await ids(actor,'?kind=discussion&order=desc'),[c.answer.id,c.first.id]);
 }
 // September learners and the teaching team see everything, as today.
 for(const actor of ['september','staff'])assert.deepEqual(await ids(actor),[c.september.id,c.lastSeptember.id,c.first.id,c.answer.id,c.teaching.id,c.nested.id]);
 // Neither a cached copy nor a guessed ETag reveals a hidden file: the refusal comes before the 304.
 for(const file of [c.septemberFile,c.staffFile])for(const headers of [{},{'If-None-Match':'*'},{'If-None-Match':`"${file.id}"`}]) {
  const refused=await download(file.id,'joiner',headers);assert.equal(refused.status,404);assert.deepEqual(await refused.json(),{error:'file unavailable'});
 }
 const shown=await download(c.octoberFile.id,'joiner');assert.equal(shown.status,200);assert.equal(await shown.text(),'October answer');
 assert.equal((await download(c.octoberFile.id,'joiner',{'If-None-Match':shown.headers.get('etag')})).status,304);
 assert.equal((await download(c.staffFile.id,'september')).status,200);assert.equal((await download(c.septemberFile.id,'staff')).status,200);
 // A missing parent and a hidden one get the same refusal, whoever wrote the hidden post.
 const missing=await reply(randomUUID());assert.equal(missing.status,400);const refusal=await missing.json();assert.deepEqual(refusal,{error:'parent post unavailable'});
 for(const parentId of [c.september.id,c.teaching.id,c.nested.id]){const refused=await reply(parentId);assert.equal(refused.status,400);assert.deepEqual(await refused.json(),refusal);}
 assert.equal((await reply(c.answer.id)).status,201);
 assert.equal((await reply(c.september.id,'september')).status,201);assert.equal((await reply(c.teaching.id,'staff')).status,201);
 // A new joiner's own file stays theirs even under a hidden thread; it is hidden from the other new joiners only.
 const own=await upload('joiner','Mine');await post('joiner','2026-10-07T10:00:00.000Z',{parentId:c.september.id,attachmentIds:[own.id]});
 assert.equal((await download(own.id,'joiner')).status,200);assert.equal((await download(own.id,'peer')).status,404);assert.equal((await download(own.id,'september')).status,200);
 // A file its owner also shows in an October post is shown there.
 await post('september','2026-10-08T10:00:00.000Z',{attachmentIds:[c.septemberFile.id]});
 assert.equal((await download(c.septemberFile.id,'peer')).status,200);
 // Withdrawing the September post does not release the replies under it.
 await store.update('posts',{id:c.september.id},{body:'',attachmentIds:[],deletedAt:OCTOBER});
 const listed=await ids('peer');assert.ok(listed.includes(c.answer.id));assert.ok(![c.teaching.id,c.nested.id].some(id=>listed.includes(id)));
 assert.equal((await download(c.staffFile.id,'peer')).status,404);assert.equal((await reply(c.teaching.id,'peer')).status,400);
});

test('new joiners get full pages of October posts, and a page followed only by hidden posts has no next page',async t=>{
 const {call,prefix,post,store}=await setup(t);
 const root=await post('september','2026-09-08T00:00:00.000Z'),visible=[];
 // 75 October posts. The first 30 are visible, so the first batch holds exactly 30 visible posts and the page still
 // reads on for a 31st; after them, two in every five answer the September thread and are hidden.
 for(let i=0;i<75;i++){const createdAt=new Date(Date.UTC(2026,9,2,0,0,i)).toISOString();if(i>=30&&i%5<2)await post('staff',createdAt,{parentId:root.id});else visible.push(await post('september',createdAt));}
 const page=async(actor,query)=>{const response=await call(prefix+'/posts?kind=discussion'+query,{actor});assert.equal(response.status,200);return response.json();};
 for(const [order,expected] of [['',visible],['&order=desc',[...visible].reverse()]]) {
  const first=await page('joiner',order);
  assert.deepEqual(first.posts.map(p=>p.id),expected.slice(0,30).map(p=>p.id));assert.equal(first.nextCursor,encodeCursor(expected[29]));
  const second=await page('joiner',order+'&cursor='+first.nextCursor);
  assert.deepEqual(second.posts.map(p=>p.id),expected.slice(30).map(p=>p.id));assert.equal(second.nextCursor,null);
 }
 for(const actor of ['september','staff']){const first=await page(actor,'');assert.equal(first.posts.length,30);assert.equal(first.posts[0].id,root.id);assert.ok(first.nextCursor);}
 // Withdraw every visible post after the 30th: only hidden posts follow the page, so "load more" is not offered.
 for(const row of visible.slice(30))await store.update('posts',{id:row.id},{deletedAt:OCTOBER});
 for(const order of ['','&order=desc']){const only=await page('joiner',order);assert.equal(only.posts.length,30);assert.equal(only.nextCursor,null);}
});

test('the poll reads no posts, and only a new joiner\'s page reads the module conversation, once',async t=>{
 const {call,course,module,prefix,post,store}=await setup(t);
 const root=await post('september','2026-09-08T00:00:00.000Z');await post('staff','2026-10-02T00:00:00.000Z',{parentId:root.id});
 const reads=[],find=store.find;store.find=async(name,filters,options)=>{reads.push({name,filters,options});return find(name,filters,options);};
 const request=async(actor,query)=>{reads.length=0;const response=await call(prefix+'/posts'+query,{actor});assert.equal(response.status,200);return response.json();};
 for(const actor of ['joiner','september','staff']) {
  const poll=await request(actor,'?latest=1&kind=discussion');
  assert.deepEqual(Object.keys(poll),['revision']);assert.deepEqual(reads.map(r=>r.name).sort(),['courses','enrollments','intakes','modules']);
 }
 for(const actor of ['september','staff']){const listed=await request(actor,'?kind=discussion');assert.equal(listed.posts.length,2);assert.equal(reads.filter(r=>r.name==='posts').length,1);}
 const listed=await request('joiner','?kind=discussion');assert.deepEqual(listed.posts,[]);assert.equal(listed.nextCursor,null);
 const posts=reads.filter(r=>r.name==='posts');
 assert.deepEqual(posts.filter(r=>r.options.limit!==31).map(r=>r.filters),[{courseId:course.id,moduleId:module.id,deletedAt:null}]);
});

test('after enrolment reopens, members who join and earlier new joiners still see the conversation from October only',async t=>{
 const context=await setup(t),{call,course,ids,download,reply,store}=context;
 const c=await conversation(context);
 await store.update('courses',{id:course.id},{enrollmentOpen:true});
 assert.equal((await call(`/api/courses/${course.id}/enroll`,{actor:'late',method:'POST',body:{}})).status,200);
 assert.equal((await call(`/api/courses/${course.id}/intake`,{actor:'late',method:'PUT',body:intake})).status,200);
 for(const actor of ['joiner','late']) {
  assert.deepEqual(await ids(actor),[c.first.id,c.answer.id]);
  assert.equal((await download(c.septemberFile.id,actor,{'If-None-Match':'*'})).status,404);
  assert.equal((await reply(c.teaching.id,actor)).status,400);
 }
 assert.deepEqual(await ids('september'),[c.september.id,c.lastSeptember.id,c.first.id,c.answer.id,c.teaching.id,c.nested.id]);
});

test('other courses keep the whole conversation for members who joined in October',async t=>{
 const {call,store,users}=await setup(t);
 const {course}=await(await call('/api/admin/courses',{actor:'staff',method:'POST',body:{title:'Other course',status:'published'}})).json();
 const {module}=await(await call(`/api/admin/courses/${course.id}/modules`,{actor:'staff',method:'POST',body:{title:'Session',status:'published'}})).json();
 await store.insert('enrollments',{id:randomUUID(),courseId:course.id,userId:users.joiner.id,createdAt:OCTOBER});
 await store.insert('intakes',{id:randomUUID(),courseId:course.id,userId:users.joiner.id,answers:intake,updatedAt:OCTOBER});
 const old=await store.insert('posts',{id:randomUUID(),courseId:course.id,moduleId:module.id,userId:users.staff.id,authorName:'staff',staff:true,clientId:randomUUID(),parentId:null,kind:'question',threadKind:'discussion',body:'September question',links:[],attachmentIds:[],deletedAt:null,createdAt:SEPTEMBER});
 const path=`/api/courses/${course.id}/modules/${module.id}/posts`;
 assert.deepEqual((await(await call(path)).json()).posts.map(p=>p.id),[old.id]);
 assert.equal((await call(path,{method:'POST',body:{clientId:randomUUID(),kind:'comment',body:'A reply',parentId:old.id}})).status,201);
});
