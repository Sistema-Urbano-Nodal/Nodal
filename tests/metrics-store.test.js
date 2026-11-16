import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDatabase} from '../server/db.js';
import {createFiiuStore} from '../server/fiiu-repository.js';
import {createCourseStore} from '../server/courses-repository.js';
import {createNodeRequestStore} from '../server/node-requests-repository.js';
import {createMetricsStore} from '../server/metrics-repository.js';
import {expectedMemberDays,loadSqlite,METRICS_TODAY,sqliteProfile} from './fixtures/metrics-fixture.js';

// The keys metrics_member_days answers (plan, Task 4), in the order both stores write them.
const KEYS={
 days:['entered','profileSaves','follows','interests','registrations','acceptances','founders','orgRequests'],
 now:['admins','basic','city','interests','bio','assessed','directory','acceptors','unbadged','interestsNew','orgRequestsNew','learners','openers','teamRegistrations'],
 d7:['members','profile','network','opportunities','festival','courses','membership'],
 lists:['countries'],
};
// Never process.env: a test env for the Supabase client the store builds from env and fetchImpl.
const ENV={NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'test-public-key',SUPABASE_SECRET_KEY:'test-server-key'};
const json=(status,body)=>new Response(body===undefined?'':JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const sqlite=t=>{const db=createDatabase({filename:':memory:'});t.after(()=>db.close());return db;};
// A recording fetchImpl: answer(url, init) gives the Response.
const recorder=answer=>{const calls=[];return {calls,fetchImpl:async(url,init={})=>{calls.push({url:new URL(url),method:init.method||'GET',headers:init.headers||{},body:init.body,signal:init.signal});return answer(new URL(url),init);}};};

test('the twin answers the fixture',async t=>{
 const db=sqlite(t);
 const fiiuStore=createFiiuStore({db}),courseStore=createCourseStore({db}),nodeRequestStore=createNodeRequestStore({db});
 await loadSqlite({db,fiiuStore,courseStore,nodeRequestStore});
 const store=createMetricsStore({db});
 assert.equal(store.kind,'sqlite');
 const expected=structuredClone(expectedMemberDays);
 expected.days.profileSaves=[];
 Object.assign(expected.active.d7,sqliteProfile.d7);Object.assign(expected.active.d30,sqliteProfile.d30);
 const answer=await store.memberDays(METRICS_TODAY);
 assert.deepEqual(answer,expected);
 assert.deepEqual(answer.lists.countries.map(r=>r[0]),expectedMemberDays.lists.countries.map(r=>r[0]),'byte order of the countries');
 const accounts=await store.accountDays();
 assert.equal(accounts.v,1);
 assert.deepEqual(accounts.days.map(([day,created])=>[day,created]),expectedMemberDays.days.entered);
 assert.ok(accounts.days.every(([,created,confirmed])=>created===confirmed));
});

test('an absent table counts as zero',async t=>{
 const store=createMetricsStore({db:sqlite(t)});
 const answer=await store.memberDays(METRICS_TODAY);
 assert.deepEqual(answer.days.registrations,[]);
 assert.equal(answer.now.learners,0);
 assert.equal(answer.now.orgRequestsNew,0);
 assert.equal(answer.active.d30.festival,0);
 assert.deepEqual(answer.lists.countries,[]);
 assert.deepEqual(await store.accountDays(),{v:1,days:[]});
});

// The slice of one jsonb_build_object( call: from the marker to its closing parenthesis.
function containerSlice(text,marker){
 const at=text.indexOf(marker);assert.ok(at>=0,marker);
 const open=text.indexOf('jsonb_build_object(',at)+'jsonb_build_object'.length;
 for(let i=open,depth=0;i<text.length;i++){
  if(text[i]==='(')depth++;
  else if(text[i]===')'&&--depth===0)return text.slice(open,i+1);
 }
 assert.fail(`unbalanced ${marker}`);
}

test('key parity with the SQL',async t=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261114010000_metrics.sql',import.meta.url),'utf8').replace(/--[^\n]*/g,'');
 const slices={days:containerSlice(sql,"'days', pg_catalog.jsonb_build_object("),now:containerSlice(sql,"'now', pg_catalog.jsonb_build_object("),
  d7:containerSlice(sql,"'d7', (SELECT pg_catalog.jsonb_build_object("),lists:containerSlice(sql,"'lists', pg_catalog.jsonb_build_object(")};
 for(const [container,keys] of Object.entries(KEYS))for(const key of keys)assert.ok(slices[container].includes(`'${key}',`),`${container}.${key}`);
 const answer=await createMetricsStore({db:sqlite(t)}).memberDays(METRICS_TODAY);
 assert.deepEqual(Object.keys(answer.days),KEYS.days);
 assert.deepEqual(Object.keys(answer.now),KEYS.now);
 assert.deepEqual(Object.keys(answer.active.d7),KEYS.d7);
 assert.deepEqual(Object.keys(answer.active.d30),KEYS.d7);
 assert.deepEqual(Object.keys(answer.lists),KEYS.lists);
});

test('asks Supabase for one function call each',async()=>{
 const member={...structuredClone(expectedMemberDays)},account={v:1,days:[['2026-11-14',2,1]]};
 const {calls,fetchImpl}=recorder(url=>json(200,url.pathname.endsWith('metrics_account_days')?account:member));
 const store=createMetricsStore({env:ENV,fetchImpl});
 assert.equal(store.kind,'supabase');
 const signal=new AbortController().signal;
 assert.deepEqual(await store.accountDays({signal}),account);
 assert.deepEqual(calls.map(c=>[c.method,c.url.href]),[['POST','https://project.supabase.co/rest/v1/rpc/metrics_account_days']]);
 assert.equal(calls[0].signal,signal);
 assert.deepEqual(await store.memberDays('2026-11-14',{signal}),member);
 assert.deepEqual([calls[1].method,calls[1].url.href,calls[1].body],['POST','https://project.supabase.co/rest/v1/rpc/metrics_member_days','{"p_today":"2026-11-14"}']);
 assert.equal(calls[1].signal,signal);
 assert.equal(calls.length,2);
 assert.ok(calls.every(c=>c.method!=='GET'));
});

test('refuses an answer of the wrong shape',async()=>{
 for(const [method,args] of [['accountDays',[]],['memberDays',['2026-11-14']]]){
  const {fetchImpl}=recorder(()=>json(200,{v:2,days:[]}));
  await assert.rejects(createMetricsStore({env:ENV,fetchImpl})[method](...args),e=>e.status===502,method);
 }
 const {fetchImpl}=recorder(()=>json(200,{v:1,days:{}}));
 await assert.rejects(createMetricsStore({env:ENV,fetchImpl}).memberDays('2026-11-14'),e=>e.status===502);
});

test('the first reading of a day wins',async t=>{
 const at='2026-11-14T13:36:00.000Z';
 const local=createMetricsStore({db:sqlite(t)});
 assert.equal(await local.saveReading('2026-11-14',at,{a:1},1),true);
 assert.equal(await local.saveReading('2026-11-14','2026-11-14T20:00:00.000Z',{a:2},1),false);
 assert.deepEqual(await local.readings(),[{day:'2026-11-14',takenAt:at,defs:1,figures:{a:1}}]);
 // Supabase: the insert ignores a duplicate and answers the stored rows; [] means another write won.
 const stored=new Map();
 const {calls,fetchImpl}=recorder((url,init)=>{
  if(init.method==='POST'){const [row]=JSON.parse(init.body);if(stored.has(row.day))return json(201,[]);stored.set(row.day,row);return json(201,[row]);}
  return json(200,url.searchParams.has('day')?[]:[...stored.values()]);
 });
 const remote=createMetricsStore({env:ENV,fetchImpl});
 assert.equal(await remote.saveReading('2026-11-14',at,{a:1},1),true);
 assert.equal(await remote.saveReading('2026-11-14',at,{a:2},1),false);
 const posts=calls.filter(c=>c.method==='POST');
 assert.equal(posts.length,2);
 for(const post of posts){
  assert.equal(post.url.pathname,'/rest/v1/metrics_readings');
  assert.equal(post.headers.Prefer,'resolution=ignore-duplicates,return=representation');
 }
 assert.deepEqual(JSON.parse(posts[0].body),[{day:'2026-11-14',taken_at:at,defs:1,figures:{a:1}}]);
 assert.deepEqual(await remote.readings(),[{day:'2026-11-14',takenAt:at,defs:1,figures:{a:1}}]);
});

test('reads every reading past the row cap',async()=>{
 const start=Date.parse('2023-01-01T00:00:00Z');
 const all=Array.from({length:1200},(_,i)=>{const day=new Date(start+i*86400000).toISOString().slice(0,10);return {day,taken_at:`${day}T14:00:00+00:00`,defs:1,figures:{n:i}};});
 const signal=new AbortController().signal;
 const {calls,fetchImpl}=recorder(url=>{
  const q=url.searchParams;
  assert.equal(q.get('order'),'day.asc');
  const after=q.get('day')?.replace(/^gt\./,'');
  // The project's row cap: never more than 1,000 rows, whatever limit is asked.
  const rows=all.filter(r=>!after||r.day>after).slice(0,Math.min(1000,Number(q.get('limit')||Infinity)));
  return json(200,rows);
 });
 const got=await createMetricsStore({env:ENV,fetchImpl}).readings({signal});
 assert.equal(got.length,1200);
 assert.deepEqual(got.map(r=>r.day),all.map(r=>r.day));
 assert.deepEqual(got[1199],{day:all[1199].day,takenAt:all[1199].taken_at,defs:1,figures:{n:1199}});
 assert.equal(calls.at(-1).url.searchParams.get('day'),`gt.${all[1199].day}`,'ends on an empty page');
 assert.ok(calls.every(c=>c.method==='GET'&&c.url.pathname==='/rest/v1/metrics_readings'&&c.signal===signal));
});

test('passes provider errors through',async()=>{
 const cases=[[404,{code:'PGRST202',message:'Could not find the function'}],[404,{code:'42883',message:'function does not exist'}],
  [404,{code:'PGRST205',message:'Could not find the table'}],[404,{code:'42P01',message:'relation does not exist'}],
  [401,{code:'42501',message:'permission denied'}],[503,{message:'unavailable'}],[429,{message:'too many'}]];
 for(const [status,body] of cases){
  const {fetchImpl}=recorder(()=>json(status,body));
  const store=createMetricsStore({env:ENV,fetchImpl});
  for(const call of [()=>store.accountDays(),()=>store.memberDays('2026-11-14'),()=>store.readings(),()=>store.saveReading('2026-11-14','2026-11-14T13:36:00.000Z',{a:1},1)]){
   await assert.rejects(call(),e=>e.status===status&&(body.code?e.code===body.code:true),`${status} ${body.code||''}`);
  }
 }
});
