import test from 'node:test';
import assert from 'node:assert/strict';
import {createTalkApi} from '../server/fiiu-talk-api.js';

/* The conversation memos (server/fiiu-talk-api.js) share a read that is still running, whatever its age, so a slow database
   never gets a second identical read stacked on the first; the time a result is kept counts from when it answered. */

// A store read the test answers by hand: calls counts the reads started; answer and fail settle the oldest one still running.
function manual(){
 const pending=[];let calls=0;
 return {read:()=>{calls++;return new Promise((resolve,reject)=>pending.push({resolve,reject}));},answer:value=>pending.shift().resolve(value),fail:error=>pending.shift().reject(error),get calls(){return calls;}};
}
// Lets the requests run until each waits on a read the test has not answered.
const settle=async()=>{for(let i=0;i<3;i++)await new Promise(resolve=>setImmediate(resolve));};
const Q='22222222-2222-4222-8222-222222222222';
const request=(api,method,path,user)=>api({req:{method,headers:{}},res:{},url:new URL('http://x'+path),user});

test('a slow pulse read is shared until it answers, then kept for a second; a write still drops it and a failure is not kept',async()=>{
 const reads=manual();let t=1000;const sent=[];
 const api=createTalkApi({store:{pulse:reads.read,findMessage:async()=>null},sameOrigin:()=>true,send:(res,status,body)=>sent.push(body),clock:()=>t});
 const get=()=>request(api,'GET','/api/fiiu/pulse',null);
 const first=get();
 t+=3000;const second=get();
 assert.equal(reads.calls,1,'the read still running is shared, however long it takes');
 reads.answer([{id:'q',activityId:'day1-am',revision:7,status:'open'}]);await Promise.all([first,second]);
 assert.deepEqual(sent.map(body=>body.questions),[[['q','day1-am',7,'open']],[['q','day1-am',7,'open']]]);
 t+=999;await get();assert.equal(reads.calls,1,'kept for a second after it answered');
 t+=1;const third=get();assert.equal(reads.calls,2,'then read again');reads.answer([]);await third;
 // A write through this instance drops a read in flight too, so the writer's next poll reads past its write.
 t+=5000;const slow=get();assert.equal(reads.calls,3);
 await request(api,'DELETE',`/api/fiiu/messages/${Q}`,{id:'u',permission:'member'});
 const fresh=get();assert.equal(reads.calls,4);
 reads.answer([{id:'old',activityId:'day1-am',revision:1,status:'open'}]);reads.answer([{id:'new',activityId:'day1-am',revision:2,status:'open'}]);await Promise.all([slow,fresh]);
 await get();assert.equal(reads.calls,4);assert.equal(sent.at(-1).questions[0][0],'new','the dropped read never comes back as the kept one');
 // A failed read is not kept.
 t+=5000;const failed=get();assert.equal(reads.calls,5);reads.fail(Object.assign(Error('upstream timeout'),{status:504}));await assert.rejects(failed);
 const retried=get();assert.equal(reads.calls,6);reads.answer([]);await retried;
});

test('a slow read of a question’s changes is shared by the room until it answers, then kept for 1.5 s',async()=>{
 const rows=manual();let t=1000;const sent=[];
 const store={findRegistration:async()=>({firstName:'Ana',lastName:'Test'}),filesForMessages:async()=>[],messagesSince:rows.read,
  getQuestion:async()=>({id:Q,eventId:'fiiu-2026',activityId:'day1-am',talk:null,body:'¿Qué?',status:'open',revision:10,messageCount:0,version:1,createdAt:'x'})};
 const api=createTalkApi({store,sameOrigin:()=>true,send:(res,status,body)=>sent.push(body),clock:()=>t});
 const get=id=>request(api,'GET',`/api/fiiu/questions/${Q}/messages?since=2`,{id,permission:'member'});
 const first=get('a');await settle();
 t+=3000;const second=get('b');await settle();
 assert.equal(rows.calls,1,'the read still running is shared, however long it takes');
 rows.answer([]);await Promise.all([first,second]);assert.deepEqual(sent.map(body=>body.revision),[10,10]);
 t+=1499;await get('c');assert.equal(rows.calls,1,'kept for 1.5 s after it answered');
 t+=1;const later=get('d');await settle();assert.equal(rows.calls,2,'then read again');rows.answer([]);await later;
});

test('one person’s requests share a registration read still running, and a refusal is still never kept',async()=>{
 const reads=manual();const sent=[];
 const api=createTalkApi({store:{findRegistration:reads.read,listQuestions:async()=>[]},sameOrigin:()=>true,send:(res,status)=>sent.push(status),clock:()=>1000});
 const read=()=>request(api,'GET','/api/fiiu/questions?activityId=day1-am',{id:'u1',permission:'member'});
 const both=[read(),read()];await settle();
 assert.equal(reads.calls,1,'the second request waits for the first one’s read');
 reads.answer(null);await Promise.all(both);assert.deepEqual(sent,[403,403]);
 const again=read();await settle();assert.equal(reads.calls,2,'a refusal is never kept, so registering takes effect at once');
 reads.answer({firstName:'Ana',lastName:'Test'});await again;assert.equal(sent.at(-1),200);
 await read();assert.equal(reads.calls,2,'a registration is kept');
});
