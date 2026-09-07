import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase, createUser } from '../server/db.js';
import { createCourseStore } from '../server/courses-repository.js';
import { normalizeCourse, normalizeModule, normalizeIntake, decodeAttachment, csv } from '../server/courses-domain.js';
import {reconcileCourseUploads} from '../scripts/reconcile-course-uploads.js';

test('course domain validates dates, required intake, safe materials and binary files', () => {
  assert.throws(() => normalizeCourse({title:'Mobility',startsOn:'2026-02-31'}), /date/);
  assert.throws(() => normalizeModule({title:'Module',resources:[{title:'Bad',url:'javascript:alert(1)'}]}), /HTTPS/);
  assert.throws(() => normalizeIntake({fullName:'Member'}), /profession/);
  assert.throws(() => decodeAttachment({name:'photo.png',mime:'image/png',data:Buffer.from('<script>x</script>').toString('base64')}), /match/);
  assert.throws(() => decodeAttachment({name:'x.svg',mime:'image/svg+xml',data:'PHN2Zz4='}), /type/);
  assert.match(csv([['name','comment'],['=cmd','line\n"quote"']]), /"'=cmd"/);
});

test('pending upload reconciliation is dry by default, waits a day, and retains records on cleanup failure',async()=>{
 const fresh={id:'fresh',createdAt:new Date().toISOString()},stale={id:'stale',createdAt:'2026-01-01T00:00:00.000Z'};
 const rows=[stale,fresh],removed=[];
 const store={find:async(_name,_filters,{after})=>after?[]:rows,deleteFile:async()=>{},remove:async(_name,{id})=>removed.push(id)};
 assert.deepEqual(await reconcileCourseUploads(store),{examined:2,stale:1,removed:0,dryRun:true});
 assert.deepEqual(removed,[]);
 await reconcileCourseUploads(store,{apply:true});assert.deepEqual(removed,['stale']);
 store.deleteFile=async()=>{throw new Error('Storage unavailable');};
 await assert.rejects(reconcileCourseUploads(store,{apply:true}),/Storage unavailable/);
 assert.deepEqual(removed,['stale']);
});

test('course store persists enrollment, private intake and version guarded module changes', async t => {
  const db=createDatabase({filename:':memory:'}); t.after(()=>db.close());
  const user=createUser(db,{fullName:'Student',email:'student@example.test',passwordHash:'test'});
  const store=createCourseStore({db});
  const now=new Date().toISOString();
  const course=await store.insert('courses',{id:randomUUID(),...normalizeCourse({title:'Mobility',status:'published',startsOn:'2026-09-09'}),version:1,createdAt:now,updatedAt:now});
  await store.insert('enrollments',{id:randomUUID(),courseId:course.id,userId:user.id,createdAt:now});
  assert.equal((await store.find('enrollments',{courseId:course.id})).length,1);
  const answers=normalizeIntake({fullName:'Student',profession:'Planner',city:'Lima',motivation:'Learn',experience:'Some',expectations:'Practice',caseStudy:'Station',digitalFamiliarity:'Comfortable'});
  await store.insert('intakes',{id:randomUUID(),courseId:course.id,userId:user.id,answers,updatedAt:now});
  assert.equal((await store.find('intakes',{userId:user.id}))[0].answers.city,'Lima');
  const module=await store.insert('modules',{id:randomUUID(),courseId:course.id,...normalizeModule({title:'First session'}),version:1,createdAt:now,updatedAt:now});
  assert.equal((await store.update('modules',{id:module.id,version:1},{title:'Updated',version:2})).title,'Updated');
  assert.equal(await store.update('modules',{id:module.id,version:1},{title:'Stale',version:2}),null);
});

test('course store keyset reads never omit tied timestamps', async t => {
  const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
  const store=createCourseStore({db}); const stamp=new Date().toISOString();
  for(let i=0;i<35;i++) await store.insert('courses',{id:randomUUID(),...normalizeCourse({title:`Course ${i}`}),version:1,createdAt:stamp,updatedAt:stamp});
  const first=await store.find('courses',{}, {limit:30});
  const second=await store.find('courses',{}, {limit:30,after:{createdAt:first.at(-1).createdAt,id:first.at(-1).id}});
  assert.equal(new Set([...first,...second].map(x=>x.id)).size,35);
});

test('legacy SQLite upgrade preserves personal bytes, backfills discussion once and keeps ownership constraints',async t=>{
 const {COURSE_SQLITE_SCHEMA}=await import('../server/courses-schema.js');
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const legacy=COURSE_SQLITE_SCHEMA.replace(/ kind TEXT NOT NULL DEFAULT 'session'.*?\n/,'').replace(/ thread_kind TEXT NOT NULL DEFAULT 'discussion'.*?\n/,'').replace(/\n purpose TEXT NOT NULL DEFAULT 'post'.*?\n/,'\n').replace('user_id TEXT REFERENCES users(id) ON DELETE RESTRICT','user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT').replace("'pending','ready','deleting'","'pending','ready'");
 db.exec(legacy);
 const user=createUser(db,{fullName:'Legacy',email:'legacy@example.test',passwordHash:'unused'}),courseId=randomUUID(),moduleId=randomUUID(),fileId=randomUUID(),stamp=new Date().toISOString();
 db.prepare("INSERT INTO pilot_courses(id,title,status,created_at,updated_at)VALUES(?,'Legacy course','published',?,?)").run(courseId,stamp,stamp);
 db.prepare("INSERT INTO course_modules(id,course_id,title,status,position,created_at,updated_at)VALUES(?,?,'Legacy session','published',1,?,?)").run(moduleId,courseId,stamp,stamp);
 db.prepare("INSERT INTO course_attachments(id,course_id,module_id,user_id,name,mime,size,storage_path,status,created_at)VALUES(?,?,?,?,'old.txt','text/plain',3,'old/object','ready',?)").run(fileId,courseId,moduleId,user.id,stamp);
 db.prepare('INSERT INTO course_attachment_bytes(id,bytes)VALUES(?,?)').run(fileId,Buffer.from('old'));
 const store=createCourseStore({db});createCourseStore({db});
 assert.equal(await store.count('modules',{courseId,kind:'discussion'}),1);
 assert.equal((await store.find('modules',{id:moduleId}))[0].kind,'session');
 const [file]=await store.find('attachments',{id:fileId});assert.equal(file.purpose,'post');assert.equal((await store.getFile(file)).toString(),'old');
 assert.throws(()=>db.prepare('DELETE FROM users WHERE id=?').run(user.id),/FOREIGN KEY/);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});


test('attachment quota and course foreign-key lookups use the course-owner index',t=>{
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());createCourseStore({db});
 const columns=db.prepare('PRAGMA index_info(course_attachments_course_owner)').all().map(c=>c.name);
 assert.deepEqual(columns,['course_id','user_id']);
 for(const clause of ['course_id=? AND user_id IS NULL','course_id=? AND user_id=?','course_id=?']) {
  const params=clause.includes('user_id=?')?['course','member']:['course'];
  const plan=db.prepare('EXPLAIN QUERY PLAN SELECT id FROM course_attachments WHERE '+clause).all(...params);
  assert.ok(plan.some(row=>row.detail.includes('USING INDEX course_attachments_course_owner')),JSON.stringify(plan));
 }
});
