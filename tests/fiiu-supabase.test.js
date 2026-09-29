import test from 'node:test';
import assert from 'node:assert/strict';
import {createFiiuStore} from '../server/fiiu-repository.js';

test('Supabase festival adapter fills capped pages and scopes versioned writes and deletion',async()=>{
 const calls=[],rows=[{id:'a',event_id:'fiiu-2026',answers:{city:'Lima'},version:1},{id:'b',event_id:'fiiu-2026',answers:{city:'Callao'},version:1}];
 const clients={admin:{async rest(table,options){calls.push({table,...options});if(!options.method)return rows.slice(options.query.offset,options.query.offset+1);if(options.method==='DELETE')return [];return [rows[0]];}}};
 const store=createFiiuStore({clients});
 assert.deepEqual((await store.find('registrations',{userId:'owner'},{limit:3})).map(r=>r.answers.city),['Lima','Callao']);
 assert.deepEqual(calls.map(c=>c.query.offset),[0,1,2]);assert.ok(calls.every(c=>c.query.user_id==='eq.owner'));
 await store.update('registrations',{id:'a',userId:'owner',version:1},{version:2,answers:{city:'Cusco'}});
 assert.deepEqual(calls.at(-1).query,{id:'eq.a',user_id:'eq.owner',version:'eq.1'});assert.deepEqual(calls.at(-1).body.answers,{city:'Cusco'});
 assert.equal(await store.remove('registrations',{id:'a',userId:'owner',version:1}),0);
 assert.equal(calls.at(-1).headers.Prefer,'return=representation');assert.equal(calls.at(-1).query.version,'eq.1');
 await store.find('content',{status:'published'},{limit:1,newest:true,after:'a',afterCreatedAt:'2026-09-28T12:00:00+00:00'});
 assert.equal(calls.at(-1).query.order,'created_at.desc,id.desc');assert.equal(calls.at(-1).query.or,'(created_at.lt.2026-09-28T12:00:00+00:00,and(created_at.eq.2026-09-28T12:00:00+00:00,id.lt.a))');
});
