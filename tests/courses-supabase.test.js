import test from 'node:test';
import assert from 'node:assert/strict';
import {createCourseStore} from '../server/courses-repository.js';
import {normalizeModule} from '../server/courses-domain.js';

test('Supabase course pages honor smaller server row caps, stable cursors and JSON types',async()=>{
  const calls=[];
  const rows=Array.from({length:35},(_,i)=>({id:String(i).padStart(3,'0'),course_id:'course',created_at:'2026-09-05T00:00:00.000Z',resources:[],status:'published'}));
  const clients={admin:{rest:async(table,args)=>{
    calls.push({table,...args});
    // Every row shares created_at, so both the caller's cursor (or) and the store's keyset (and) reduce to id order.
    const filtered=rows.filter(row=>['or','and'].every(key=>!args.query[key]||row.id>args.query[key].match(/id.gt.([^)]*)/)[1]));
    const offset=args.query.offset??0;
    return {rows:filtered.slice(offset,offset+Math.min(7,args.query.limit)),contentRange:`${offset}-${Math.min(offset+6,filtered.length-1)}/*`};
  }}};
  const store=createCourseStore({clients});
  const first=await store.find('modules',{courseId:'course',status:'published'},{limit:31,order:['createdAt','id']});
  assert.equal(first.length,31);
  assert.deepEqual(first.map(row=>row.id),rows.slice(0,31).map(row=>row.id),'no row repeated or skipped');
  assert.deepEqual(first[0].resources,[]);
  // Follow-ups continue after the last row (keyset), never by OFFSET.
  assert.ok(calls.every(call=>call.query.offset===undefined));
  assert.deepEqual(calls.map(call=>call.query.and?.match(/id.gt.([^)]*)\)/)[1]),[undefined,'006','013','020','027']);
  assert.deepEqual(calls.map(call=>call.query.limit),[31,24,17,10,3]);
  const next=await store.find('modules',{courseId:'course'},{limit:31,after:{createdAt:first.at(-1).createdAt,id:first.at(-1).id}});
  assert.deepEqual(next.map(row=>row.id),['031','032','033','034']);
  assert.ok(calls.every(call=>call.includeRange&&call.query.course_id==='eq.course'));
});

test('Supabase writes retain JSON arrays and guarded version filters, and uniqueness conflicts become 409',async()=>{
  const calls=[];
  const store=createCourseStore({clients:{admin:{rest:async(table,args)=>{
    calls.push({table,...args});
    if(args.body.title==='Duplicate')throw Object.assign(new Error('duplicate'),{code:'23505'});
    return args.method==='PATCH'?[]:[{...args.body,id:'module'}];
  }}}});
  const module=normalizeModule({title:'Observation',resources:[{title:'Slides',kind:'slides',url:'https://example.test/slides'}]});
  const saved=await store.insert('modules',module);
  assert.deepEqual(saved.resources,module.resources);
  assert.ok(Array.isArray(calls[0].body.resources));
  assert.equal(await store.update('modules',{id:'module',courseId:'course',version:1},{title:'Updated',version:2}),null);
  assert.equal(calls[1].query.version,'eq.1');
  assert.equal(calls[1].query.course_id,'eq.course');
  assert.equal(calls[1].query.limit,undefined);
  await assert.rejects(store.insert('modules',{...module,title:'Duplicate'}),{status:409});
});

test('Supabase totals and private storage use server credentials and preserve binary bytes',async()=>{
  const calls=[];
  const bytes=Buffer.from([0,255,12,33]);
  const clients={env:{url:'https://project.supabase.co',serverKey:'test-service-key'},admin:{}};
  const store=createCourseStore({clients,fetchImpl:async(url,args)=>{
    calls.push({url,...args});
    if(args.method==='HEAD')return new Response(null,{headers:{'content-range':'0-0/742'}});
    if(args.method==='GET')return new Response(bytes);
    return new Response('{}');
  }});
  assert.equal(await store.count('enrollments',{courseId:'course'}),742);
  assert.equal(calls[0].headers.Prefer,'count=exact');
  const attachment={storagePath:'member/file',mime:'image/png'};
  await store.putFile(attachment,bytes);
  assert.deepEqual(await store.getFile(attachment),bytes);
  await store.deleteFile(attachment);
  assert.ok(calls.every(call=>call.headers.Authorization==='Bearer test-service-key'));
  assert.match(calls[1].url,/\/storage\/v1\/object\/course-attachments\/member\/file$/);
  assert.equal(calls[1].headers['x-upsert'],'false');
  assert.deepEqual(JSON.parse(calls.at(-1).body),{prefixes:['member/file']});
  const failing=createCourseStore({clients,fetchImpl:async()=>new Response('',{status:503})});
  await assert.rejects(failing.count('enrollments'),{status:502});
  await assert.rejects(failing.deleteFile(attachment),{status:502});
});

test('Supabase descending filtered post cursor uses both timestamp and ID, and material conflicts are retryable',async()=>{
 const calls=[];
 const store=createCourseStore({clients:{admin:{rest:async(table,args)=>{
  calls.push({table,...args});
  if(args.method==='PATCH')throw Object.assign(new Error('material publication raced cleanup'),{code:'23514'});
  return {rows:[],contentRange:'*/0'};
 }}}});
 const stamp='2026-09-07T12:00:00.000Z';
 await store.find('posts',{moduleId:'module',threadKind:'assignment'},{desc:true,limit:31,after:{createdAt:stamp,id:'post'}});
 assert.equal(calls[0].query.order,'created_at.desc,id.desc');
 assert.equal(calls[0].query.thread_kind,'eq.assignment');
 assert.equal(calls[0].query.or,`(created_at.lt.${stamp},and(created_at.eq.${stamp},id.lt.post))`);
 await assert.rejects(store.update('modules',{id:'module',version:2},{resources:[]}),{status:409});
});

test('Supabase owner post compare-and-update sends long Unicode text in JSON rather than URL filters',async()=>{
 const calls=[],oldBody='界'.repeat(6000),newBody='界'.repeat(5999)+'新';
 const store=createCourseStore({clients:{admin:{rest:async(path,args)=>{calls.push({path,...args});return[{id:'post',course_id:'course',user_id:'owner',body:args.body.p_body,links:[],attachment_ids:[],deleted_at:null}];}}}});
 const post=await store.editPost({id:'post',courseId:'course',userId:'owner',expectedBody:oldBody,body:newBody});
 assert.equal(post.body,newBody);assert.equal(post.userId,'owner');assert.equal(calls[0].path,'rpc/edit_own_course_post');assert.equal(calls[0].method,'POST');assert.equal(calls[0].query,undefined);
 assert.deepEqual(calls[0].body,{p_id:'post',p_course_id:'course',p_user_id:'owner',p_expected_body:oldBody,p_body:newBody});
});

test('Supabase discussion attachment batches stay scoped and complete across provider row caps',async()=>{
 const ids=Array.from({length:5},(_,i)=>`abcdef00-0000-4000-8000-${String(i).padStart(12,'0')}`),calls=[];
 const rows=ids.map(id=>({id,course_id:'course',module_id:'module',user_id:'member',status:'ready',name:'File',mime:'text/plain',size:1}));
 const store=createCourseStore({clients:{admin:{rest:async(table,{query})=>{calls.push({table,query});const after=query.and?.match(/id.gt.([^)]*)\)/)?.[1];return{rows:rows.filter(row=>!after||row.id>after).slice(0,Math.min(2,query.limit)),contentRange:'*/5'};}}}});
 const attachments=await store.getPostAttachments({ids:[...ids,ids[0].toUpperCase()],courseId:'course',moduleId:'module'});
 assert.deepEqual(attachments.map(a=>a.id),ids);assert.equal(calls.length,3);assert.deepEqual(calls.map(({query})=>query.and),[undefined,`(id.gt.${ids[1]})`,`(id.gt.${ids[3]})`]);
 assert.ok(calls.every(({table,query})=>table==='course_attachments'&&query.course_id==='eq.course'&&query.module_id==='eq.module'&&query.status==='eq.ready'&&query.id===`in.(${ids.join(',')})`));
 assert.equal(calls[0].query.limit,5);assert.deepEqual(await store.getPostAttachments({ids:[],courseId:'course',moduleId:'module'}),[]);assert.equal(calls.length,3);
 await assert.rejects(store.getPostAttachments({ids:Array.from({length:91},(_,i)=>String(i)),courseId:'course',moduleId:'module'}),/batch/);
});

test('Supabase certificates use the private bucket under certificates/ only, as PDFs, with the server key',async()=>{
 const calls=[],bytes=Buffer.from('%PDF-1.4 certificate');
 const clients={env:{url:'https://project.supabase.co',serverKey:'test-service-key'},admin:{}};
 const store=createCourseStore({clients,fetchImpl:async(url,args)=>{calls.push({url,...args});return args.method==='GET'?new Response(bytes):new Response('[]');}});
 const [course,member,id]=['c0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000003'];
 const path=`certificates/${course}/${member}/${id}.pdf`,certificate={id,storagePath:path,mime:'text/html'};
 await store.putCertificate(certificate,bytes);
 assert.deepEqual(await store.getCertificate(certificate),bytes);
 await store.deleteCertificate(certificate);
 assert.deepEqual(calls.map(call=>call.method),['POST','GET','DELETE']);
 for(const call of calls.slice(0,2)) {
  assert.equal(call.url,`https://project.supabase.co/storage/v1/object/course-attachments/${path}`);
  // The stored type is always PDF, whatever the record says, and an upload never overwrites an object.
  assert.equal(call.headers['Content-Type'],'application/pdf');assert.equal(call.headers['x-upsert'],'false');
 }
 assert.equal(calls[2].url,'https://project.supabase.co/storage/v1/object/course-attachments');
 assert.deepEqual(JSON.parse(calls[2].body),{prefixes:[path]});
 assert.ok(calls.every(call=>call.headers.Authorization==='Bearer test-service-key'&&call.headers.apikey==='test-service-key'));
 // A record outside certificates/ (a post or material file in the same bucket) is never touched.
 for(const storagePath of ['member/file',`certificates/${course}/../${id}.pdf`,`certificates/${course}/${member}/${id}.txt`,`certificates/course/member/${id}.pdf`,path.toUpperCase(),undefined])
  for(const operation of ['putCertificate','getCertificate','deleteCertificate'])await assert.rejects(store[operation]({id:'x',storagePath},bytes),/invalid certificate path/);
 assert.equal(calls.length,3);
 const failing=createCourseStore({clients,fetchImpl:async()=>new Response('',{status:503})});
 await assert.rejects(failing.putCertificate(certificate,bytes),{status:502});
 await assert.rejects(failing.deleteCertificate(certificate),{status:502});
});

test('Supabase survey rows, unique update conflicts and organiser flags',async()=>{
 const calls=[];
 const store=createCourseStore({clients:{admin:{rest:async(table,args)=>{
  calls.push({table,...args});
  if(args.method==='PATCH')throw Object.assign(new Error('duplicate key value violates unique constraint "course_certificates_one_ready"'),{code:'23505'});
  if(table==='profiles')return {rows:[{id:'a',full_name:'Ana',email:'ana@example.test',app_role:'admin'},{id:'b',full_name:null,email:'b@example.test',app_role:'member'}],contentRange:'0-1/2'};
  return {rows:[{id:'r',course_id:'course',user_id:'member',answers:{overall:'buena'},submitted_at:null,created_at:'2026-10-10T15:00:00.000Z',updated_at:'2026-10-10T15:00:00.000Z'}],contentRange:'0-0/1'};
 }}}});
 // A second 'ready' certificate for one person is a conflict the route answers as certificate_changed.
 await assert.rejects(store.update('certificates',{id:'new',status:'pending'},{status:'ready'}),{status:409,message:'record already exists'});
 assert.deepEqual(calls[0].query,{id:'eq.new',status:'eq.pending',select:'id,course_id,user_id,size,storage_path,status,created_at'});
 const [row]=await store.find('surveys',{courseId:'course',userId:'member',submittedAt:null},{limit:1});
 assert.deepEqual(row,{id:'r',courseId:'course',userId:'member',answers:{overall:'buena'},submittedAt:null,createdAt:'2026-10-10T15:00:00.000Z',updatedAt:'2026-10-10T15:00:00.000Z'});
 assert.equal(calls[1].table,'course_survey_responses');assert.equal(calls[1].query.submitted_at,'is.null');assert.equal(calls[1].query.select,'id,course_id,user_id,answers,submitted_at,created_at,updated_at');
 // Members carry whether they are organisers, so survey counts and certificates leave administrators out.
 assert.deepEqual(await store.getMembers(['a','b']),[{id:'a',name:'Ana',email:'ana@example.test',staff:true},{id:'b',name:null,email:'b@example.test',staff:false}]);
 assert.equal(calls[2].query.select,'id,full_name,email,app_role');
});
