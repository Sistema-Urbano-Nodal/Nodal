import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {once} from 'node:events';
import {createDatabase,createUser} from '../server/db.js';
import {createCourseStore} from '../server/courses-repository.js';

const stamp='2026-09-09T00:00:00.000Z';
async function fixture(t,filename=':memory:') {
 const db=createDatabase({filename});t.after(()=>db.close());
 const store=createCourseStore({db});
 const person=createUser(db,{fullName:'Quota participant',email:'quota@example.test',passwordHash:'fixture'});
 const other=createUser(db,{fullName:'Other participant',email:'other-quota@example.test',passwordHash:'fixture'});
 const courses=[];
 for(let i=0;i<2;i++)courses.push(await store.insert('courses',{id:randomUUID(),title:'Quota course',description:'',status:'published',createdAt:stamp,updatedAt:stamp}));
 const modules=await Promise.all(courses.map(course=>store.find('modules',{courseId:course.id,kind:'discussion'},{limit:1})));
 const attachment=(overrides={})=>({id:randomUUID(),courseId:courses[0].id,moduleId:modules[0][0].id,userId:person.id,purpose:'post',name:'quota.txt',mime:'text/plain',size:3*1024*1024,storagePath:randomUUID(),status:'pending',createdAt:stamp,...overrides});
 return{db,store,person,other,courses,modules,attachment};
}

test('upload reservations count pending bytes and enforce separate course/owner quotas',async t=>{
 const {store,other,courses,modules,attachment}=await fixture(t);
 for(let i=0;i<10;i++)await store.reserveAttachment(attachment());
 await assert.rejects(store.reserveAttachment(attachment({size:1})),{status:413});
 assert.equal(await store.count('attachments'),10);
 assert.equal((await store.reserveAttachment(attachment({userId:other.id}))).status,'pending');
 assert.equal((await store.reserveAttachment(attachment({courseId:courses[1].id,moduleId:modules[1][0].id}))).status,'pending');
 for(let i=0;i<10;i++)await store.reserveAttachment(attachment({userId:null,purpose:'material'}));
 await assert.rejects(store.reserveAttachment(attachment({userId:null,purpose:'material',size:1})),{status:413});
});

test('the hundredth reservation is allowed, failed reservations roll back, and cleanup frees quota',async t=>{
 const {store,attachment}=await fixture(t);
 const first=await store.reserveAttachment(attachment({size:1,status:'ready'}));
 assert.equal(first.status,'pending');
 await assert.rejects(store.reserveAttachment({...first}),{status:409});
 for(let i=1;i<100;i++)await store.reserveAttachment(attachment({size:1}));
 await assert.rejects(store.reserveAttachment(attachment({size:1})),{status:413});
 assert.equal(await store.count('attachments'),100);
 await store.remove('attachments',{id:first.id});
 await store.reserveAttachment(attachment({size:1}));
 assert.equal(await store.count('attachments'),100);
});

test('separate SQLite connections racing for the final bytes cannot both reserve',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'nodal-quota-test-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const filename=join(dir,'quota.sqlite'),{store,attachment}=await fixture(t,filename);
 for(let i=0;i<9;i++)await store.reserveAttachment(attachment());
 const barrier=new SharedArrayBuffer(4),workers=[];
 for(let i=0;i<2;i++) {
  const worker=new Worker(new URL('./fixtures/course-upload-quota-worker.js',import.meta.url),{workerData:{filename,barrier,attachment:attachment()}});
  t.after(()=>worker.terminate());workers.push(worker);
  assert.deepEqual((await once(worker,'message'))[0],{ready:true});
 }
 const results=workers.map(async worker=>(await once(worker,'message'))[0]);
 Atomics.store(new Int32Array(barrier),0,1);Atomics.notify(new Int32Array(barrier),0);
 const outcomes=await Promise.all(results);
 assert.deepEqual(outcomes.map(result=>result.status).sort(),[201,413]);
 const files=await store.find('attachments',{}, {limit:100});
 assert.equal(files.length,10);assert.equal(files.reduce((sum,file)=>sum+file.size,0),30*1024*1024);
});

test('Supabase reservations use the private-quota RPC and preserve safe error semantics',async()=>{
 const record={id:randomUUID(),courseId:randomUUID(),moduleId:randomUUID(),userId:null,purpose:'material',name:'guide.txt',mime:'text/plain',size:1,storagePath:'courses/file',status:'pending',createdAt:stamp};
 const calls=[];let code;
 const store=createCourseStore({clients:{admin:{rest:async(path,args)=>{
  calls.push({path,...args});if(code)throw Object.assign(new Error('database failure'),{code});
  return[{...args.body.p_attachment}];
 }}}});
 assert.equal((await store.reserveAttachment(record)).userId,null);
 assert.equal(calls[0].path,'rpc/reserve_course_attachment');assert.equal(calls[0].method,'POST');
 assert.equal(calls[0].body.p_attachment.course_id,record.courseId);assert.equal(calls[0].body.p_attachment.status,'pending');
 for(const [failure,status] of [['PCA01',413],['23505',409],['40001',409],['40P01',409]]) {
  code=failure;await assert.rejects(store.reserveAttachment(record),{status});
 }
});
