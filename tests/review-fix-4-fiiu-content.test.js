import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createApp} from '../server/server.js';
import {createFiiuStore} from '../server/fiiu-repository.js';

async function setup(t){
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const admin=createUser(db,{fullName:'Organiser',email:'organiser@example.test',passwordHash:'unused',role:'admin'});
 const cookie=createSession(db,admin.id).cookie.split(';')[0];
 const server=createApp({db,fiiuStore:createFiiuStore({db})});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=body=>fetch(base+'/api/admin/fiiu/content',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const feed=async()=>(await(await fetch(base+'/api/fiiu')).json()).content;
 return {db,post,feed};
}

// fiiu-2: the editor reuses its draft id when a save's response was lost. A retry carrying different content or a
// different status must not be answered as saved, or the editor wipes the form and the edits (and a publish) are lost.
test('a retried publication create returns the stored row only when it matches, and answers 409 with the stored row otherwise',async t=>{
 const {db,post,feed}=await setup(t);const id=randomUUID();
 const draft={id,title:'Draft titel',body:'',status:'draft',kind:'news',url:'',activityId:''};
 const first=await post(draft);assert.equal(first.status,201);const {content:stored}=await first.json();

 // The identical retry (the id in any case) still gets the stored row back, so nothing is published twice.
 for(const retry of [draft,{...draft,id:id.toUpperCase()}]){const response=await post(retry);assert.equal(response.status,200);assert.deepEqual((await response.json()).content,stored);}

 // Edited, published, or both after the lost response: a conflict that hands back what is stored.
 for(const changed of [{...draft,title:'Final title'},{...draft,status:'published'},{...draft,title:'Final title',status:'published'},{...draft,body:'Doors open at nine'},{...draft,kind:'material',url:'https://example.org/slides'},{...draft,activityId:'day1-am'}]){
  const response=await post(changed);assert.equal(response.status,409,JSON.stringify(changed));
  const body=await response.json();assert.equal(body.error,'content changed; reload before saving');assert.deepEqual(body.content,stored);
 }
 assert.deepEqual({...db.prepare('SELECT status,version FROM fiiu_content WHERE id=?').get(id)},{status:'draft',version:1},'the stored row is untouched');
 assert.equal((await feed()).length,0,'nothing was published behind the editor’s back');

 // A published create retried unchanged still answers 200 (its stored publishedAt marker is not part of the comparison).
 const published={...draft,id:randomUUID(),title:'Doors open 09:00',status:'published'};
 assert.equal((await post(published)).status,201);assert.equal((await post(published)).status,200);
 assert.equal((await feed()).length,1);
});
