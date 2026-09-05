import test from 'node:test';
import assert from 'node:assert/strict';
import {createCourseStore} from '../server/courses-repository.js';
import {normalizeModule} from '../server/courses-domain.js';

test('Supabase course pages honor smaller server row caps, stable cursors and JSON types',async()=>{
  const calls=[];
  const rows=Array.from({length:35},(_,i)=>({id:String(i).padStart(3,'0'),course_id:'course',created_at:'2026-09-05T00:00:00.000Z',resources:[],status:'published'}));
  const clients={admin:{rest:async(table,args)=>{
    calls.push({table,...args});
    const filtered=rows.filter(row=>!args.query.or||row.id>args.query.or.match(/id.gt.([^)]*)/)[1]);
    const offset=args.query.offset??0;
    return {rows:filtered.slice(offset,offset+Math.min(7,args.query.limit)),contentRange:`${offset}-${Math.min(offset+6,filtered.length-1)}/*`};
  }}};
  const store=createCourseStore({clients});
  const first=await store.find('modules',{courseId:'course',status:'published'},{limit:31,order:['createdAt','id']});
  assert.equal(first.length,31);
  assert.deepEqual(first[0].resources,[]);
  assert.deepEqual(calls.map(call=>call.query.offset),[0,7,14,21,28]);
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
