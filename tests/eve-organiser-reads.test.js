import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDatabase,createUser} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createApp} from '../server/server.js';
import {createFiiuStore} from '../server/fiiu-repository.js';

/* At the 09:00 door rush one organiser account runs two or three desk devices, the dashboards and the QR screens
   at once, and their /api/admin/fiiu/* reads outran the 120 a minute every account gets. Platform administrators
   read those through a budget of their own; members keep theirs. */
async function setup(t){
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const cookies={};
 for(const name of ['member','admin']){const user=createUser(db,{fullName:name,email:`${name}@example.test`,passwordHash:'unused',role:name==='admin'?'admin':'member'});cookies[name]=createSession(db,user.id).cookie.split(';')[0];}
 const server=createApp({db,fiiuStore:createFiiuStore({db})});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 return (path,actor='admin')=>fetch(base+path,{redirect:'manual',headers:{Cookie:cookies[actor]}});
}
const drain=async response=>{await response.arrayBuffer();return response.status;};

test('an organiser account reads the festival desk 600 times a minute, presenter polls included, on a budget of its own',async t=>{
 const call=await setup(t);
 const reads=['/api/admin/fiiu/summary','/api/admin/fiiu/registrations','/api/admin/fiiu/config','/api/admin/fiiu/checkin?activityId=not-a-block'];
 for(let i=0;i<600;i++){const path=reads[i%reads.length];assert.notEqual(await drain(await call(path)),429,`organiser read ${i+1} (${path})`);}
 const limited=await call('/api/admin/fiiu/summary');assert.equal(limited.status,429);assert.match(limited.headers.get('retry-after'),/^\d+$/);await limited.arrayBuffer();
 assert.equal(await drain(await call('/api/admin/fiiu/checkin?activityId=not-a-block')),429,'the presenter poll shares the organiser budget');
 // The organiser's own member reads and the full export keep the per-account budget, untouched by the desk.
 assert.equal(await drain(await call('/api/fiiu/registration')),200);
 assert.equal(await drain(await call('/api/admin/fiiu/export')),200);
});

test('members keep 120 festival reads a minute and the full export stays on that budget',async t=>{
 const call=await setup(t);
 for(let i=0;i<120;i++)assert.equal(await drain(await call('/api/fiiu/registration','member')),200,`member read ${i+1}`);
 assert.equal(await drain(await call('/api/fiiu/registration','member')),429);
 assert.equal(await drain(await call('/api/admin/fiiu/summary','member')),403,'members never reach the organiser reads');
 for(let i=0;i<120;i++)assert.equal(await drain(await call('/api/admin/fiiu/export')),200,`export ${i+1}`);
 assert.equal(await drain(await call('/api/admin/fiiu/export')),429);
 assert.equal(await drain(await call('/api/admin/fiiu/summary')),200,'the export never spends the desk budget');
});
