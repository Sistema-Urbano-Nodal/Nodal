import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser,toApiUser} from '../server/db.js';
import {createCourseStore} from '../server/courses-repository.js';
import {createCourseApi} from '../server/courses-api.js';
import {normalizeCourse,normalizeLinks,normalizeModule} from '../server/courses-domain.js';
import {FIIU_COURSE_PERK} from '../server/course-perks.js';

// Items ticked "September group only" (docs/superpowers/specs/2026-10-18-course-fiiu-access-design.md).
const SEPTEMBER='2026-09-05T15:00:00.000Z',OCTOBER='2026-10-18T15:00:00.000Z';
const INTAKE={fullName:'Ana',profession:'Planner',city:'Lima',motivation:'Learn',experience:'Some',expectations:'Practice',caseStudy:'Station',digitalFamiliarity:'Comfortable'};
const EVERY_ITEM=['Class recording','Reading','Field photos','Slides'],OPEN_ITEMS=['Reading','Slides'];

async function setup(t) {
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const users={};for(const [key,role] of [['staff','admin'],['september','member'],['joiner','member']])users[key]=toApiUser(createUser(db,{fullName:key,email:`${key}@example.test`,passwordHash:'test',role}));
 const store=createCourseStore({db});
 const api=createCourseApi({store,userRepository:{getUserById:async id=>Object.values(users).find(u=>u.id===id),toApiUser:u=>u},sameOrigin:req=>req.headers.origin===`http://${req.headers.host}`});
 const server=http.createServer(async(req,res)=>{try{if(!await api({req,res,url:new URL(req.url,`http://${req.headers.host}`),user:users[req.headers.cookie]})){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,{actor='joiner',method='GET',body,headers={}}={})=>fetch(base+path,{method,headers:{Cookie:actor,Origin:base,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
 /* A closed course with one session, as production holds it, plus one person who joined in October. The teaching team
    ticks a recording and a file through the workspace routes; a reading and the slides stay open. */
 async function course(id) {
  await store.insert('courses',{id,...normalizeCourse({title:'Curso Movilidad Nivel 2',status:'published',enrollmentOpen:false}),version:1,createdAt:SEPTEMBER,updatedAt:SEPTEMBER});
  for(const [key,createdAt] of [['september',SEPTEMBER],['joiner',OCTOBER]]) {
   await store.insert('enrollments',{id:randomUUID(),courseId:id,userId:users[key].id,createdAt});
   await store.insert('intakes',{id:randomUUID(),courseId:id,userId:users[key].id,answers:INTAKE,updatedAt:createdAt});
  }
  const made=await call(`/api/admin/courses/${id}/modules`,{actor:'staff',method:'POST',body:{title:'Session 1',status:'published',resources:[{title:'Class recording',url:'https://example.test/recording',kind:'recording',septemberOnly:true},{title:'Reading',url:'https://example.test/reading',kind:'reading'}]}});
  assert.equal(made.status,201);let {module}=await made.json();
  const files=[];
  for(const name of ['field-photos.pdf','slides.pdf']) {
   const uploaded=await call(`/api/admin/courses/${id}/modules/${module.id}/attachments`,{actor:'staff',method:'POST',body:{name,mime:'application/pdf',data:Buffer.from('%PDF-1.4 '+name).toString('base64')}});
   assert.equal(uploaded.status,201);files.push((await uploaded.json()).attachment);
  }
  const saved=await call(`/api/admin/courses/${id}/modules/${module.id}`,{actor:'staff',method:'PATCH',body:{version:module.version,resources:[...module.resources,{title:'Field photos',attachmentId:files[0].id,kind:'reading',septemberOnly:true},{title:'Slides',attachmentId:files[1].id,kind:'slides'}]}});
  assert.equal(saved.status,200);({module}=await saved.json());
  return {id,module,photos:files[0],slides:files[1]};
 }
 return {call,store,course};
}
const titles=resources=>resources.map(resource=>resource.title);

test('only module materials carry the September group tick, and only as true',()=>{
 const [ticked,open]=normalizeLinks([{title:'Class recording',url:'https://example.test/rec',kind:'recording',septemberOnly:true},{title:'Slides',url:'https://example.test/slides',kind:'slides',septemberOnly:false}],true);
 assert.deepEqual(ticked,{title:'Class recording',url:'https://example.test/rec',kind:'recording',septemberOnly:true});
 assert.equal('septemberOnly' in open,false,'an open item stores no tick');
 assert.equal('septemberOnly' in normalizeLinks([{title:'Slides',url:'https://example.test/slides'}],true)[0],false);
 for(const value of ['true',1,null,{}])assert.throws(()=>normalizeLinks([{title:'Slides',url:'https://example.test/slides',septemberOnly:value}],true),/septemberOnly must be true or false/);
 // A contribution's links are not course materials, so they never keep a tick.
 assert.deepEqual(normalizeLinks([{title:'Link',url:'https://example.test/x',septemberOnly:true}]),[{title:'Link',url:'https://example.test/x'}]);
 // Saving a session without sending its materials keeps the stored ticks.
 assert.equal(normalizeModule({title:'Renamed'},{title:'Session',resources:[ticked]}).resources[0].septemberOnly,true);
});

test('a new joiner on the perk course gets neither ticked item in the course page or the session',async t=>{
 const {call,store,course}=await setup(t);
 const perk=await course(FIIU_COURSE_PERK.courseId),other=await course(randomUUID());
 const views=async(actor,{id,module})=>{
  const page=await(await call(`/api/courses/${id}`,{actor})).json(),session=await(await call(`/api/courses/${id}/modules/${module.id}`,{actor})).json();
  return [titles(page.modules.find(m=>m.id===module.id).resources),titles(session.module.resources)];
 };
 assert.deepEqual(await views('joiner',perk),[OPEN_ITEMS,OPEN_ITEMS]);
 for(const actor of ['september','staff'])assert.deepEqual(await views(actor,perk),[EVERY_ITEM,EVERY_ITEM],actor);
 // Only the perk course has a September group: elsewhere an October enrolment sees everything.
 assert.deepEqual(await views('joiner',other),[EVERY_ITEM,EVERY_ITEM]);
 // The stored session keeps every item and both ticks.
 const [stored]=await store.find('modules',{id:perk.module.id});
 assert.deepEqual(stored.resources.map(r=>[r.title,r.septemberOnly===true]),[['Class recording',true],['Reading',false],['Field photos',true],['Slides',false]]);
});

test('a ticked file answers 404 to a new joiner before any cache validation, and stays open to the September group and staff',async t=>{
 const {call,course}=await setup(t);const {photos,slides}=await course(FIIU_COURSE_PERK.courseId);
 const file=id=>`/api/course-attachments/${id}`;
 for(const headers of [{},{'If-None-Match':'*'},{'If-None-Match':`"${photos.id}"`}]) {
  const refused=await call(file(photos.id),{headers});
  assert.equal(refused.status,404,JSON.stringify(headers));assert.deepEqual(await refused.json(),{error:'file unavailable'});
 }
 const open=await call(file(slides.id));assert.equal(open.status,200);assert.match(await open.text(),/slides\.pdf/);
 assert.equal((await call(file(photos.id),{actor:'september',headers:{'If-None-Match':`"${photos.id}"`}})).status,304);
 for(const actor of ['september','staff']) {
  const served=await call(file(photos.id),{actor});assert.equal(served.status,200,actor);assert.match(await served.text(),/field-photos\.pdf/);
 }
});

test('a new joiner cannot record opening a ticked item, and the September group can',async t=>{
 const {call,course}=await setup(t);const {id,module,photos,slides}=await course(FIIU_COURSE_PERK.courseId);
 const open=(actor,kind,resourceUrl)=>call(`/api/courses/${id}/events`,{actor,method:'POST',body:{moduleId:module.id,kind,resourceUrl}});
 for(const [kind,url] of [['recording_open','https://example.test/recording'],['content_open',`/api/course-attachments/${photos.id}`]]) {
  const refused=await open('joiner',kind,url);
  assert.equal(refused.status,400,url);assert.deepEqual(await refused.json(),{error:'resource is not in this module'});
  assert.equal((await open('september',kind,url)).status,200,url);
 }
 for(const url of ['https://example.test/reading',`/api/course-attachments/${slides.id}`])assert.equal((await open('joiner','content_open',url)).status,200,url);
});

test('the tick holds after enrolment reopens, and only staff learn which course has a September group',async t=>{
 const {call,store,course}=await setup(t);const perk=await course(FIIU_COURSE_PERK.courseId),other=await course(randomUUID());
 await store.update('courses',{id:perk.id},{enrollmentOpen:true});
 assert.deepEqual(titles((await(await call(`/api/courses/${perk.id}/modules/${perk.module.id}`)).json()).module.resources),OPEN_ITEMS);
 for(const path of [`/api/courses/${perk.id}`,`/api/admin/courses/${perk.id}`])assert.equal((await(await call(path,{actor:'staff'})).json()).perkCourse,true,path);
 for(const [actor,id] of [['staff',other.id],['joiner',perk.id],['september',perk.id]])assert.equal('perkCourse' in await(await call(`/api/courses/${id}`,{actor})).json(),false,actor);
});
