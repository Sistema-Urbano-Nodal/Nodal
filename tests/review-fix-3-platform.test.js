import test from 'node:test';
import assert from 'node:assert/strict';
import {createNetworkSnapshots} from '../server/network-cache.js';
import {createCourseStore} from '../server/courses-repository.js';
import {validatePassword,PASSWORD_MAX_BYTES} from '../server/auth.js';
import {createSupabaseRepository} from '../server/supabase.js';
import {createDatabase,createUser} from '../server/db.js';
import {createFiiuStore} from '../server/fiiu-repository.js';
import {sendConfirmations,DAILY_CAP} from '../server/fiiu-confirmations.js';

/* Regressions for the network snapshot TTL (performance-1), the extra empty course page request (database-4), the
   72-byte provider password limit (auth-8) and the daily cap in the command-line FIIU backfill (email-qr-scripts-4). */

function networkFixture() {
 let revision=1,reads=0,graphs=0;
 const repo={
  getNetworkRevision:async()=>String(revision),
  listDirectoryUsers:async()=>{reads++;return [{id:'a'},{id:'b'}];},
  loadGraphStore:async({directoryRows})=>{graphs++;return {users:new Map(directoryRows.map(u=>[u.id,u])),follows:new Map(),engagement:new Map()};},
 };
 return {repo,counts:()=>[reads,graphs],bump:()=>{revision++;}};
}

test('performance-1: an unchanged revision keeps the directory and graph across globe polls',async()=>{
 const f=networkFixture();let clock=0;
 const snapshots=createNetworkSnapshots(f.repo,{now:()=>clock});
 const first=await snapshots.read({graph:true});
 // The globe polls every 15 s plus jitter, so every poll lands after the old 15 s TTL.
 for(const at of [16_000,33_000,50_000,5*60_000]){clock=at;await snapshots.run(async snapshot=>snapshot.graph);}
 assert.deepEqual(f.counts(),[1,1],'no table is read again while the revision stands');
 // Derived per-snapshot work (the places payload, which drains the geocoding backlog) still renews.
 clock=5*60_000+16_000;const renewed=await snapshots.read({graph:true});
 assert.notEqual(renewed,first);assert.equal(renewed.rows,first.rows);assert.equal(renewed.graph,first.graph);
 // A write anywhere in the network is visible on the next request.
 f.bump();const changed=await snapshots.read({graph:true});
 assert.notEqual(changed.rows,first.rows);assert.deepEqual(f.counts(),[2,2]);
 // A long backstop still rereads data the revision says is unchanged.
 clock+=10*60_000;await snapshots.read();assert.deepEqual(f.counts(),[3,2]);
});

test('database-4: a short course page costs one PostgREST request; a capped page continues by keyset',async()=>{
 const rows=Array.from({length:5},(_,i)=>({id:`0000000${i}-0000-4000-8000-000000000000`,course_id:'course',module_id:'module',created_at:'2026-09-07T12:00:00.000Z',body:`Post ${i}`,links:[],attachment_ids:[]}));
 const calls=[];let cap=1000;
 const store=createCourseStore({clients:{admin:{rest:async(table,args)=>{
  calls.push(args);
  const after=args.query.and?.match(/id\.gt\.([^)]*)\)/)?.[1],offset=args.query.offset??0;
  const matching=rows.filter(row=>!after||row.id>after),page=matching.slice(offset,offset+Math.min(cap,args.query.limit));
  return {rows:page,contentRange:`${offset}-${offset+page.length-1}/${args.headers?.Prefer==='count=exact'?matching.length:'*'}`};
 }}}});
 const few=await store.find('posts',{moduleId:'module'},{limit:31});
 assert.equal(few.length,5);assert.equal(calls.length,1,'no second, empty request');
 assert.equal(calls[0].headers.Prefer,'count=exact');
 calls.length=0;cap=2;
 const capped=await store.find('posts',{moduleId:'module'},{limit:31});
 assert.deepEqual(capped.map(row=>row.id),rows.map(row=>row.id));assert.equal(calls.length,3);
 assert.ok(calls.every(call=>call.query.offset===undefined),'never OFFSET');
 assert.deepEqual(calls.map(call=>call.headers?.Prefer),['count=exact',undefined,undefined],'counted once');
 assert.match(calls[1].query.and,new RegExp(`created_at\\.gt\\.2026-09-07T12:00:00\\.000Z.*id\\.gt\\.${rows[1].id}`));
 // A single-row lookup never asks for a count.
 calls.length=0;cap=1000;await store.find('posts',{id:rows[0].id},{limit:1});
 assert.equal(calls.length,1);assert.equal(calls[0].headers,undefined);
});

test('auth-8: passwords over 72 bytes are refused before any one-time provider token is spent',async()=>{
 assert.equal(PASSWORD_MAX_BYTES,72);
 assert.equal(validatePassword('a'.repeat(72)),true);
 assert.equal(validatePassword('a'.repeat(73)),false);
 assert.equal(validatePassword('x'.repeat(100)),false,'a long password-manager password');
 assert.equal(validatePassword('é'.repeat(36)),true);assert.equal(validatePassword('é'.repeat(37)),false,'74 bytes in 37 characters');
 assert.equal(validatePassword('😀'.repeat(18)),true);assert.equal(validatePassword('😀'.repeat(19)),false);
 assert.equal(validatePassword('short'),false);
 const calls=[];
 const repo=createSupabaseRepository({env:{NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-test-key',SUPABASE_SECRET_KEY:'server-test-key',PUBLIC_BASE_URL:'https://nodal.example'},fetchImpl:async url=>{calls.push(String(url));return new Response('{}');}});
 const long='Ünïcödé-pässwörd-'.repeat(5);assert.ok(long.length<=160&&Buffer.byteLength(long)>72);
 const invitation=await repo.completeCourseInvitation({tokenHash:'a'.repeat(40),password:long,fullName:'Student Name',authorize:async()=>true,enroll:async()=>[]});
 assert.equal(invitation.status,400);
 const recovery=await repo.completePasswordRecovery({req:{headers:{}},code:'one-use-code',password:long});
 assert.equal(recovery.status,400);assert.equal(recovery.code,'recovery_password_length');
 assert.deepEqual(calls,[],'neither the invitation hash nor the recovery code reached the provider');
});

test('email-qr-scripts-4: the command-line backfill stops at the daily cap the dashboard enforces',async t=>{
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());const store=createFiiuStore({db});
 const today=new Date().toISOString();let n=0;
 const register=async(confirmationStatus,confirmationSentAt=null)=>{const id=`r${String(++n).padStart(4,'0')}`,email=`${id}@fiiu-inbox.dev`,user=createUser(db,{fullName:id,email,passwordHash:'unused'});
  await store.insert('registrations',{id,eventId:'fiiu-2026',userId:user.id,email,answers:{firstName:'Ana'},labStatus:'none',version:1,createdAt:today,updatedAt:today,confirmationStatus,confirmationLanguage:'es',confirmationSentAt});return id;};
 for(let i=0;i<DAILY_CAP-1;i++)await register('sent',today);
 const waiting=[await register('none'),await register('none'),await register('none')];
 const sent=[],confirm=async({registration})=>{sent.push(registration.id);return {status:'sent',sentAt:new Date().toISOString()};};
 const first=await sendConfirmations({store,confirm,send:true,delayMs:0,log:()=>{}});
 assert.deepEqual(sent,[waiting[0]],'one send left today');
 assert.equal(first.capped,true);assert.equal(first.sent,1);assert.equal(first.listed,1);assert.equal(first.sentToday,DAILY_CAP);assert.equal(first.dailyCap,DAILY_CAP);
 assert.equal(first.resetsAt,new Date(new Date(today).setUTCHours(24,0,0,0)).toISOString());
 const statusOf=id=>db.prepare('SELECT confirmation_status s FROM fiiu_registrations WHERE id=?').get(id).s;
 assert.deepEqual(waiting.map(statusOf),['sent','none','none'],'the rest wait for tomorrow');
 // A dry run still lists everyone waiting; it sends nothing.
 assert.equal((await sendConfirmations({store,log:()=>{}})).listed,2);
 // Tomorrow the cap has room again.
 const tomorrow=()=>Date.now()+864e5;
 const next=await sendConfirmations({store,confirm,send:true,delayMs:0,log:()=>{},clock:tomorrow});
 assert.equal(next.capped,undefined);assert.equal(next.sent,2);
 // An explicit override is the operator's to make.
 await register('none');
 const forced=await sendConfirmations({store,confirm,send:true,delayMs:0,log:()=>{},ignoreCap:true});
 assert.equal(forced.sent,1);assert.equal(forced.capped,undefined);
});
