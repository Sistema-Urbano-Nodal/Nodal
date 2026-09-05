import test from 'node:test';
import assert from 'node:assert/strict';
import * as network from '../server/network-cache.js';

const fixture = () => {
  let revision = 1, reads = 0, graphs = 0;
  let visible = [{ id: 'a' }, { id: 'b' }];
  const repo = {
    getNetworkRevision: async () => String(revision),
    listDirectoryUsers: async () => { reads++; await new Promise(r => setTimeout(r, 3)); return visible; },
    loadGraphStore: async ({ directoryRows }) => { graphs++; return { users: new Map(directoryRows.map(u => [u.id,u])), follows: new Map(), engagement: new Map() }; },
  };
  return { repo, counts: () => [reads, graphs], revoke: () => { visible = [{id:'a'}]; revision++; } };
};

test('200 concurrent viewers share one revision-checked directory and graph snapshot', async () => {
  assert.equal(typeof network.createNetworkSnapshots, 'function');
  const f = fixture();
  const snapshots = network.createNetworkSnapshots(f.repo);
  const values = await Promise.all(Array.from({length:200}, () => snapshots.read({ graph: true })));
  assert.deepEqual(f.counts(), [1,1]);
  assert.ok(values.every(v => v === values[0]));
});

test('a revision change makes withdrawn data unreachable immediately and stale in-flight loads retry', async () => {
  const f = fixture();
  const snapshots = network.createNetworkSnapshots(f.repo);
  await snapshots.read();
  f.revoke();
  assert.deepEqual((await snapshots.read()).rows.map(u => u.id), ['a']);
  const g = fixture();
  const original = g.repo.loadGraphStore;
  g.repo.loadGraphStore = async (...args) => { const value = await original(...args); g.revoke(); g.repo.loadGraphStore = original; return value; };
  assert.deepEqual((await network.createNetworkSnapshots(g.repo).read({ graph: true })).rows.map(u => u.id), ['a']);
});

test('snapshots expire and unsupported revisions fail closed', async () => {
  const f = fixture(); let now = 0;
  const snapshots = network.createNetworkSnapshots(f.repo, {ttlMs:10, now:()=>now});
  await snapshots.read(); now = 11; await snapshots.read();
  assert.deepEqual(f.counts(), [2,0]);
  delete f.repo.getNetworkRevision;
  const unsupported = network.createNetworkSnapshots(f.repo);
  await assert.rejects(unsupported.read(), error => error.status === 503);
});

import { createDatabase, createUser, updateUserProfile, setUserLocation } from '../server/db.js';
import { createRepository } from '../server/repository.js';
import { createSupabaseRepository } from '../server/supabase.js';

test('SQLite revision observes profile consent, graph writes and deletion', async t => {
  const db = createDatabase({filename:':memory:'}); t.after(()=>db.close());
  const repo = createRepository({db});
  assert.equal(typeof repo.getNetworkRevision, 'function');
  const before = await repo.getNetworkRevision();
  const user = createUser(db,{fullName:'Capacity',email:'capacity@test.invalid',passwordHash:'unusable'});
  assert.notEqual(await repo.getNetworkRevision(),before);
  const added = await repo.getNetworkRevision();
  updateUserProfile(db,user.id,{partC:{consent:true}});
  assert.notEqual(await repo.getNetworkRevision(),added);
  const consent = await repo.getNetworkRevision();
  await repo.deleteUserById(user.id);
  assert.notEqual(await repo.getNetworkRevision(),consent);
});

test('Supabase directory and graph read beyond the default first page with bounded ordered queries', async () => {
  const profiles = Array.from({length:501},(_,i)=>({id:`u${i}`,full_name:`Member ${i}`,account_status:'active'}));
  const preferences = profiles.map(p=>({user_id:p.id,data_consent:{directoryPublic:true}}));
  const seen = [];
  const repo = createSupabaseRepository({env:{NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-test',SUPABASE_SECRET_KEY:'secret-test'}, fetchImpl:async url=>{
    const u = new URL(url); const table = u.pathname.split('/').at(-1);
    const values = ({profiles,profile_preferences:preferences,onboarding_responses:[],member_follows:profiles.map(p=>({user_id:'u0',target_user_id:p.id})),member_interactions:[]})[table]||[];
    const limit=Number(u.searchParams.get('limit')||500), offset=Number(u.searchParams.get('offset')||0);
    seen.push([table,limit,offset,u.searchParams.get('order')]);
    return {ok:true,status:200,text:async()=>JSON.stringify(values.slice(offset,offset+limit))};
  }});
  const rows = await repo.listDirectoryUsers();
  assert.equal(rows.length,501);
  const graph = await repo.loadGraphStore({directoryRows:rows});
  assert.equal(graph.users.size,501);
  assert.equal(graph.follows.get('u0').size,501);
  assert.ok(seen.every(x=>x[1]<=500 && x[3]),'every bulk read is ordered and paginated');
  assert.equal(seen.filter(x=>x[0]==='profiles').length,2,'graph reuses supplied directory');
});

import { createApp } from '../server/server.js';
import { createSession } from '../server/auth.js';
import { once } from 'node:events';

test('HTTP viewers share reads but keep personalized map state; another instance withdraws consent immediately', async t => {
  const db = createDatabase({filename:':memory:'}); t.after(()=>db.close());
  const repo = createRepository({db});
  let directoryReads=0, graphReads=0;
  const list = repo.listDirectoryUsers.bind(repo), graph = repo.loadGraphStore.bind(repo);
  repo.listDirectoryUsers=async()=>{directoryReads++;return list();};
  repo.loadGraphStore=async options=>{graphReads++;return graph(options);};
  const accounts = [];
  for (let i=0;i<20;i++) {
    const user=createUser(db,{fullName:`Viewer ${i}`,email:`v${i}@test.invalid`,passwordHash:'unusable'});
    updateUserProfile(db,user.id,{city:i%2?'Lima':'Quito',partC:{consent:true}});
    setUserLocation(db,user.id,{lat:i%2?-12:-0.2,lon:i%2?-77:-78,label:i%2?'Lima':'Quito'});
    accounts.push({id:user.id,cookie:createSession(db,user.id).cookie.split(';')[0]});
  }
  const server=createApp({repository:repo}); server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>server.close()); const base=`http://127.0.0.1:${server.address().port}`;
  const payloads=await Promise.all(accounts.map(async account=>(await fetch(`${base}/api/network/places`,{headers:{cookie:account.cookie}})).json()));
  assert.deepEqual([directoryReads,graphReads],[1,1]);
  payloads.forEach((p,i)=>assert.equal(p.you.city,i%2?'Lima':'Quito'));
  const page=await (await fetch(`${base}/api/users?limit=2`,{headers:{cookie:accounts[0].cookie}})).json();
  assert.equal(page.users.length,2);
  assert.equal(page.total,20);
  assert.ok(page.nextCursor);
  const next=await (await fetch(`${base}/api/users?limit=2&cursor=${page.nextCursor}`,{headers:{cookie:accounts[0].cookie}})).json();
  assert.equal(next.users.length,2);
  assert.ok(next.users.every(u=>!page.users.some(p=>p.id===u.id)));
  const other=createRepository({db});
  await other.updateUserProfile(accounts[1].id,{partC:{consent:false}});
  const fresh=await (await fetch(`${base}/api/network/places`,{headers:{cookie:accounts[0].cookie}})).json();
  assert.equal(fresh.members,19);
  assert.ok(!fresh.places.flatMap(p=>p.people).some(p=>p.id===accounts[1].id));
  const recs=await (await fetch(`${base}/api/recommendations/me`,{headers:{cookie:accounts[0].cookie}})).json();
  assert.ok(!recs.recommendations.some(r=>r.id===accounts[1].id));
});

import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
test('globe polls after 15 seconds with jitter, pauses when hidden and backs off on connection failures', async () => {
  const source=readFileSync(new URL('../web/scripts/globe.js',import.meta.url),'utf8');
  const polling=source.slice(source.indexOf('  const POLL_MS ='),source.indexOf('  const feed ='));
  const scheduling=source.slice(source.indexOf('  function schedule()'),source.indexOf('\n  poll();',source.indexOf('  function schedule()')));
  const delays=[];let calls=0;
  const context=vm.createContext({document:{hidden:false},state:{topic:''},Math,AbortSignal,clearTimeout(){},setTimeout(fn,ms){delays.push(ms);return 1;},fetch:async()=>{calls++;return {status:304};}});
  vm.runInContext(`${polling}\n${scheduling}\nglobalThis.runPoll=poll;globalThis.runSchedule=schedule;`,context);
  await context.runPoll();
  assert.ok(delays[0]>=15000&&delays[0]<=18000);
  context.document.hidden=true;await context.runPoll();context.runSchedule();assert.equal(calls,1);
  context.document.hidden=false;context.fetch=async()=>{throw new Error('network offline');};
  await context.runPoll();assert.ok(delays.at(-1)>=30000,'connection errors back off too');
});

test('Supabase honours a server row cap below the requested page size', async () => {
  const profiles=Array.from({length:251},(_,i)=>({id:`p${i}`,full_name:`P ${i}`,account_status:'active'}));
  const prefs=profiles.map(p=>({user_id:p.id,data_consent:{directoryPublic:true}}));
  const repo=createSupabaseRepository({env:{NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'test-public',SUPABASE_SECRET_KEY:'test-secret'},fetchImpl:async url=>{
    const u=new URL(url),offset=Number(u.searchParams.get('offset')||0);
    const all=({profiles,profile_preferences:prefs,onboarding_responses:[]})[u.pathname.split('/').at(-1)]||[];
    const page=all.slice(offset,offset+100);
    return {ok:true,status:200,headers:new Headers({'content-range':page.length?`${offset}-${offset+page.length-1}/*`:'*/*'}),text:async()=>JSON.stringify(page)};
  }});
  assert.equal((await repo.listDirectoryUsers()).length,251);
});


test('missing revision support rejects asynchronous responses instead of sending withdrawn data', async () => {
  for (const missing of ['method', 'row']) {
    const f = fixture();
    if (missing === 'method') delete f.repo.getNetworkRevision;
    else f.repo.getNetworkRevision = async () => null;
    const snapshots = network.createNetworkSnapshots(f.repo);
    await assert.rejects(snapshots.run(async snapshot => {
      await Promise.resolve(); f.revoke();
      return snapshot.rows;
    }), error => error.status === 503);
  }
  const f = fixture();
  await assert.rejects(network.createNetworkSnapshots(f.repo).run(async snapshot => {
    await Promise.resolve(); f.revoke();
    f.repo.getNetworkRevision = async () => null;
    return snapshot.rows;
  }), error => error.status === 503, 'lost revision support after async construction must fail closed too');
});

test('directory and search stay usable when graph reads exceed the supported cap', async t => {
  const db=createDatabase({filename:':memory:'}); t.after(()=>db.close());
  const repo=createRepository({db});
  const users=[];
  for (const name of ['Directory Viewer','Visible Peer']) {
    const row=createUser(db,{fullName:name,email:`${name.replaceAll(' ','')}@test.invalid`,passwordHash:'unusable'});
    updateUserProfile(db,row.id,{partC:{consent:true}});users.push(row);
  }
  let graphCalls=0;
  repo.loadGraphStore=async()=>{graphCalls++;throw Object.assign(new Error('Network snapshot exceeds supported size'),{status:503});};
  const cookie=createSession(db,users[0].id).cookie.split(';')[0];
  const server=createApp({repository:repo});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const directory=await fetch(`${base}/api/users?limit=1`,{headers:{cookie}});
  assert.equal(directory.status,200);assert.equal((await directory.json()).users.length,1);
  const search=await fetch(`${base}/api/users/search?q=Visible`,{headers:{cookie}});
  assert.equal(search.status,200);assert.equal((await search.json()).users[0].id,users[1].id);
  assert.equal(graphCalls,0,'directory and search must never invoke the graph loader');
  const recs=await fetch(`${base}/api/recommendations/me`,{headers:{cookie}});
  assert.equal(recs.status,503);assert.equal(graphCalls,1);
  assert.equal((await fetch(`${base}/api/users`,{headers:{cookie}})).status,200,'graph failure does not poison the directory snapshot');
});


test('SQLite snapshot revision detects consent withdrawal through an independent database connection', async t => {
  const directory=mkdtempSync(path.join(tmpdir(),'nodal-revision-'));
  const filename=path.join(directory,'network.sqlite');
  const first=createDatabase({filename}),second=createDatabase({filename});
  t.after(()=>{second.close();first.close();rmSync(directory,{recursive:true,force:true});});
  const repo=createRepository({db:first}),other=createRepository({db:second});
  const user=createUser(first,{fullName:'External Writer',email:'external-writer@test.invalid',passwordHash:'unusable'});
  updateUserProfile(first,user.id,{partC:{consent:true}});
  const snapshots=network.createNetworkSnapshots(repo);
  const initial=await snapshots.read();assert.equal(initial.rows.length,1);
  const revision=await repo.getNetworkRevision();
  await other.updateUserProfile(user.id,{partC:{consent:false}});
  assert.notEqual(await repo.getNetworkRevision(),revision,'PRAGMA data_version must observe another connection commit');
  assert.deepEqual((await snapshots.read()).rows,[]);
});
