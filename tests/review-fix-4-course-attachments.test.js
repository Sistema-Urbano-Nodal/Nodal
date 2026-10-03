import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createApp} from '../server/server.js';
import {createCourseStore} from '../server/courses-repository.js';
import {setupCoursePilot} from '../scripts/setup-course-pilot.js';
import {decodeAttachment,attachmentFilename} from '../server/courses-domain.js';

const textData=Buffer.from('Field notes').toString('base64');
const RLO='‮';

// courses-1: the stored (and downloaded) name kept the uploader's extension and Unicode format characters, so a peer
// could be handed 'grades.hta', 'x.url' or 'page.html' from the NODAL origin, or a name that displays as '.txt'.
test('an uploaded file is named with the extension of its checked type and without control or format characters',()=>{
 const named=(name,mime='text/plain',data=textData)=>decodeAttachment({name,mime,data}).name;
 for(const [name,expected] of [['grades.hta','grades.hta.txt'],['x.url','x.url.txt'],['run.bat','run.bat.txt'],['page.html','page.html.txt'],['notes','notes.txt'],
  [`notes${RLO}txt.hta`,'notes_txt.hta.txt'],['report​.txt','report_.txt'],['a⁦b⁩.txt','a_b_.txt'],['line break.txt','line_break.txt'],
  ['grades.hta.','grades.hta.txt'],['grades.hta . ','grades.hta.txt'],['..\\..\\boot.ini','.._.._boot.ini.txt'],['field.TXT','field.TXT'],['field.txt','field.txt']])assert.equal(named(name),expected,JSON.stringify(name));
 const png=Buffer.from([137,80,78,71,13,10,26,10,0,0]).toString('base64'),jpeg=Buffer.from([255,216,255,0]).toString('base64'),pdf=Buffer.from('%PDF-1.4 x').toString('base64');
 assert.equal(named('photo.html','image/png',png),'photo.html.png');assert.equal(named('photo.PNG','image/png',png),'photo.PNG');
 assert.equal(named('photo.jpeg','image/jpeg',jpeg),'photo.jpeg');assert.equal(named('photo.jpg','image/jpeg',jpeg),'photo.jpg');assert.equal(named('photo.svg','image/jpeg',jpeg),'photo.svg.jpg');
 assert.equal(named('Official reading.pdf','application/pdf',pdf),'Official reading.pdf');assert.equal(named('reading.pdf.exe','application/pdf',pdf),'reading.pdf.exe.pdf');
 // The 160-character limit still holds once the extension is added, without splitting a character.
 const long=named('é'.repeat(154)+'.hta');assert.ok(long.length<=160);assert.ok(long.endsWith('.txt'));assert.ok(!/[\uD800-\uDFFF]/.test(long.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g,'')));
 const emoji=named('😀'.repeat(80));assert.ok(emoji.length<=160);assert.ok(emoji.endsWith('😀.txt'),'surrogate pairs stay whole');
 // Validation is unchanged.
 assert.throws(()=>decodeAttachment({name:'',mime:'text/plain',data:textData}),/filename is required/);
 assert.throws(()=>decodeAttachment({name:'x.svg',mime:'image/svg+xml',data:'PHN2Zz4='}),/type/);
 assert.throws(()=>decodeAttachment({name:'x.txt',mime:['text/plain'],data:textData}),/type/);
 // The same rule is exported for serving rows stored before it.
 assert.equal(attachmentFilename(`grades${RLO}txt.hta`,'text/plain'),'grades_txt.hta.txt');assert.equal(attachmentFilename('x','application/octet-stream'),'x.bin');
});

test('end to end: a peer downloads a participant’s upload under its type’s extension with no bidi override',async t=>{
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const store=createCourseStore({db}),course=await setupCoursePilot(store);
 const module=(await store.find('modules',{courseId:course.id,kind:'session'}))[0];
 const server=createApp({db,pilotMode:true});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`,cookies={};
 const call=(actor,path,method='GET',body)=>fetch(base+path,{method,headers:{Cookie:cookies[actor],Origin:base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 for(const actor of ['author','peer']){
  const user=createUser(db,{fullName:actor,email:`${actor}@example.test`,passwordHash:'unused'});cookies[actor]=createSession(db,user.id).cookie.split(';')[0];
  assert.ok((await call(actor,`/api/courses/${course.id}/enroll`,'POST',{})).ok);
  assert.ok((await call(actor,`/api/courses/${course.id}/intake`,'PUT',{fullName:actor,profession:'Planner',city:'Lima',motivation:'Learn',experience:'Some',expectations:'Practice',caseStudy:'Station',digitalFamiliarity:'Comfortable'})).ok);
 }
 const prefix=`/api/courses/${course.id}/modules/${module.id}`;
 for(const [name,saved] of [['grades.hta','grades.hta.txt'],[`notes${RLO}txt.hta`,'notes_txt.hta.txt']]){
  const upload=await call('author',prefix+'/attachments','POST',{name,mime:'text/plain',data:textData});assert.equal(upload.status,201);
  const {attachment}=await upload.json();assert.equal(attachment.name,saved);
  assert.equal((await call('author',prefix+'/posts','POST',{clientId:randomUUID(),kind:'question',body:'See attached',attachmentIds:[attachment.id]})).status,201);
  const download=await call('peer',`/api/course-attachments/${attachment.id}`);assert.equal(download.status,200);
  const disposition=download.headers.get('content-disposition');
  assert.equal(disposition,`attachment; filename="${saved}"; filename*=UTF-8''${encodeURIComponent(saved)}`);
  assert.doesNotMatch(disposition,/%E2%80%AE/i);
 }
});
