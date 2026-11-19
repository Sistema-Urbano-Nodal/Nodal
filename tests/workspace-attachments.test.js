import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import jpeg from 'jpeg-js';
import { normalizeWorkspaceAttachments } from '../server/workspace-attachments.js';
import { createHostedWorkspace } from '../server/workspace-api.js';
import { createApp } from '../server/server.js';
import { createSession } from '../server/auth.js';
import { createDatabase, createUser, updateUserProfile } from '../server/db.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPwzrQFAAH0APKlyI4jAAAAAElFTkSuQmCC','base64');
const word = readFileSync(new URL('./fixtures/workspace-example.docx',import.meta.url));
const docx='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const file = (name,mime,bytes) => ({name,mime,size:bytes.length,data:bytes.toString('base64')});
function blankPdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 100 100] >>'];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index,object] of objects.entries()) {
    offsets.push(text.length);
    text += (index+1)+' 0 obj\n'+object+'\nendobj\n';
  }
  const start = text.length;
  text += 'xref\n0 4\n0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) text += String(offset).padStart(10,'0')+' 00000 n \n';
  return Buffer.from(text+'trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF\n');
}
const pdf = blankPdf();

test('file sends reach a version-aware hosted operation and never fall back to sending text', async t => {
  const db = createDatabase({ filename: ':memory:' });
  const calls = [];
  const store = createHostedWorkspace({ admin: { rest: async (path, { body }) => {
    calls.push(body);
    return body.p_op === 'direct' || body.p_op === 'send'
      ? { threadId: randomUUID() }
      : { error: 'Unknown workspace operation', status: 400 };
  } } });
  const server = createApp({ db, workspaceStore: store });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const actor = createUser(db, { fullName: 'Ana', email: 'ana@example.test', city: 'Lima', passwordHash: 'unused' });
  const cookie = createSession(db, actor.id).cookie.split(';')[0];
  const post = data => fetch(origin + '/api/workspace', {
    method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const attachments = [file('route.png', 'image/png', png)];
  for (const [op, target] of [['direct', 'targetId'], ['send', 'threadId']]) {
    const data = { body: 'Route attached', [target]: randomUUID(), clientId: randomUUID() };
    const fileOp = op + 'Files';
    for (const requested of [op, fileOp]) {
      const before = calls.length;
      assert.equal((await post({ op: requested, ...data, attachments })).status, 400);
      assert.equal(calls.length, before + 1);
      assert.deepEqual(calls.at(-1), { p_actor: actor.id, p_op: fileOp, p_data: { ...data, attachments } });
    }
    const before = calls.length;
    assert.equal((await post({ op: fileOp, ...data })).status, 400);
    assert.equal((await post({ op: fileOp, ...data, attachments: [] })).status, 400);
    assert.equal(calls.length, before);
    assert.equal((await post({ op, ...data, attachments: [] })).status, 200);
    assert.deepEqual(calls.at(-1), { p_actor: actor.id, p_op: op, p_data: data });
  }
});

test('workspace uploads validate content, canonical encoding, filenames, count and aggregate bytes',async()=>{
  const csv=file('survey"\n/summary','text/csv',Buffer.from('city,visits\nLima,2'));
  const image=file('Portrait.JPEG','image/jpeg',jpeg.encode({width:1,height:1,data:Buffer.from([210,30,40,255])}).data);
  const files=[csv,image,file('note','application/pdf',pdf),file('report',docx,word)];
  const saved=await normalizeWorkspaceAttachments(files);
  assert.deepEqual(saved.map(f=>f.name),['survey"__summary.csv','Portrait.JPEG','note.pdf','report.docx']);
  assert.deepEqual(await normalizeWorkspaceAttachments([file('map.png','image/png',png)]),[file('map.png','image/png',png)]);
  await assert.rejects(normalizeWorkspaceAttachments([...files,files[0]]),{status:400});
  for(const bad of [
    {...csv,size:csv.size-1},{...csv,data:csv.data.slice(0,-1)+'!'},
    file('photo.png','image/png',png.subarray(0,24)),file('report.docx',docx,pdf),
    file('report.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',word),
    file('fake.pdf','application/pdf',Buffer.from('Hello')),file('binary.txt','text/plain',Buffer.from([1,3,0,255])),
    {...csv,mime:['text/csv']},
  ])await assert.rejects(normalizeWorkspaceAttachments([bad]),{status:400});
  const nearLimit=file('long.txt','text/plain',Buffer.alloc(3*1024*1024,65));
  assert.equal((await normalizeWorkspaceAttachments([nearLimit]))[0].size,nearLimit.size);
  await assert.rejects(normalizeWorkspaceAttachments([nearLimit,csv]),{status:413});
});

test('signed-in attachment-only messages share private files with current members and export them to the author',async t=>{
  const db=createDatabase({filename:':memory:'}), server=createApp({db});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  const origin='http://127.0.0.1:'+server.address().port;
  const [ana,bob,carla]=['Ana','Bob','Carla'].map(name=>{
    const {id}=createUser(db,{fullName:name,email:name+'@example.test',passwordHash:'unused',city:'Lima'});
    updateUserProfile(db,id,{partC:{consent:true}});
    return {id,cookie:createSession(db,id).cookie.split(';')[0]};
  });
  const request=(user,path,data,headers={})=>fetch(origin+path,{method:data?'POST':'GET',headers:{
    ...(user?{Cookie:user.cookie}:{}),Origin:origin,'Content-Type':'application/json',...headers
  },body:data&&JSON.stringify(data)});
  async function ok(user,path,data) {
    const r=await request(user,path,data), value=await r.json();
    assert.equal(r.status,200,JSON.stringify(value));
    return value;
  }
  const post=(user,body)=>ok(user,'/api/workspace',body);
  const open=(user,room)=>ok(user,'/api/workspace?threadId='+room);
  const group=await post(ana,{op:'group',name:'Fieldwork',targetIds:[bob.id],clientId:randomUUID()});
  const img=file('Tránsito.png','image/png',png);
  const send={op:'send',...group,body:'',clientId:randomUUID(),attachments:[img,file('Notes.txt','text/plain',Buffer.alloc(36000,65))]};
  await post(ana,send);
  await post(ana,send);
  assert.equal((await request(bob,'/api/workspace?threadId='+group.threadId)).status,404);
  const history=await open(ana,group.threadId);
  assert.equal(history.messages.length,1);
  assert.equal(history.messages[0].body,'');
  const media=history.messages[0].attachments;
  assert.equal(media.length,2);
  assert.equal(media[0].data,undefined);
  const imgUrl='/api/workspace/attachments/'+media[0].id;
  const exportUrl='/api/me/export/attachments/'+media[0].id;
  assert.equal((await request(null,imgUrl)).status,401);
  assert.equal((await request(bob,imgUrl)).status,404);
  assert.equal((await request(carla,imgUrl)).status,404);
  await post(bob,{op:'accept',...group});
  const inline=await request(bob,imgUrl+'?inline=1');
  assert.equal(inline.status,200);
  assert.equal(inline.headers.get('content-type'),'image/png');
  assert.match(inline.headers.get('cache-control'),/no-store/);
  assert.equal(inline.headers.get('x-content-type-options'),'nosniff');
  assert.match(inline.headers.get('content-disposition'),/^inline;.*filename\*=UTF-8''Tr%C3%A1nsito\.png$/);
  assert.deepEqual(Buffer.from(await inline.arrayBuffer()),png);
  const textDownload=await request(bob,'/api/workspace/attachments/'+media[1].id+'?inline=1');
  assert.match(textDownload.headers.get('content-disposition'),/^attachment;/);
  assert.equal((await request(bob,exportUrl)).status,404);
  await post(ana,{op:'leave',...group});
  assert.equal((await request(ana,imgUrl)).status,404);
  const own=await request(ana,exportUrl);
  assert.equal(own.status,200);
  assert.deepEqual(Buffer.from(await own.arrayBuffer()),png);

  const intro={op:'direct',targetId:bob.id,clientId:randomUUID(),body:'',attachments:[img]};
  const direct=await post(carla,intro);
  assert.equal((await open(bob,direct.threadId)).messages[0].attachments.length,1);
  assert.equal((await request(carla,'/api/workspace',{...intro,clientId:randomUUID(),attachments:[]})).status,400);
  assert.equal((await request(carla,'/api/workspace',{op:'read',...direct,revision:1,attachments:[img]})).status,400);
  assert.equal((await request(carla,'/api/workspace',intro,{Origin:'https://elsewhere.invalid'})).status,403);
  assert.equal((await request(ana,'/api/workspace',{op:'send',...group,clientId:randomUUID(),body:'',attachments:[file('large.txt','text/plain',Buffer.alloc(3300000,65))]})).status,413);
});
