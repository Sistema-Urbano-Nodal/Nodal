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
 await store.find('content',{status:'published'},{limit:1,newest:true,kind:'news'});
 assert.equal(calls.at(-1).query['data->>kind'],'eq.news');assert.equal(calls.at(-1).query.status,'eq.published');
});

test('Supabase organizer summary uses one restricted aggregate RPC instead of downloading questionnaires',async()=>{
 const calls=[],summary={totalRegistrations:205,publicOfficials:3,lab:{pending:1,accepted:1,declined:1},activities:[],days:[],profiles:[]};
 const store=createFiiuStore({clients:{admin:{async rest(path,options){calls.push({path,...options});return summary;}}}});
 const catalog=[{id:'day1-am',date:'2026-10-21',registration:'general',title:'Ignored display text',formUrl:'https://example.test'}];
 assert.deepEqual(await store.summary('fiiu-2026',catalog),summary);
 assert.deepEqual(calls,[{path:'rpc/fiiu_event_summary',method:'POST',body:{p_event_id:'fiiu-2026',p_activities:[{id:'day1-am',date:'2026-10-21',registration:'general'}]}}]);
 const broken=createFiiuStore({clients:{admin:{async rest(){return null;}}}});
 await assert.rejects(broken.summary('fiiu-2026',catalog),error=>error.status===502);
});
