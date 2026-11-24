import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createDatabase,createUser,updateUserProfile} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createRepository} from '../server/repository.js';
import {createApp} from '../server/server.js';
import {createSupabaseRepository} from '../server/supabase.js';

async function fixture(t) {
  const db = createDatabase({filename:':memory:'});
  const repository = createRepository({db});
  const server = createApp({db,repository});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); db.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  function account(name) {
    const user = createUser(db,{email:name.toLowerCase()+'@example.test',fullName:name,passwordHash:'unused'});
    const cookie = createSession(db,user.id).cookie.split(';')[0];
    return {id:user.id,cookie};
  }
  const get = (path,member,extra={}) => fetch(base+path,{headers:{...(member ? {Cookie:member.cookie} : {}),...extra}});
  return {db,repository,account,get};
}

test('local view confirmation fingerprints the full current-member projection and carries no profile fields', async t => {
  const {db,repository,account,get} = await fixture(t);
  const ana = account('Ana'), bilal = account('Bilal');
  const options = [];
  const resolve = repository.resolveSession;
  repository.resolveSession = (req,opts) => { options.push(opts); return resolve(req,opts); };
  const me = await get('/api/auth/me',ana,{'X-Nodal-View':'1'});
  const user = (await me.json()).user;
  const expected = createHash('sha256').update(JSON.stringify(user)).digest('hex');
  assert.equal(me.headers.get('X-Nodal-View-Stamp'),expected);
  const endpoint = '/api/auth/view?scope=dashboard';
  const view = await get(endpoint,ana);
  assert.equal(view.headers.get('cache-control'),'no-store');
  assert.deepEqual(await view.json(),{stamp:expected,directoryRevision:null});
  assert.notEqual((await (await get(endpoint,bilal)).json()).stamp,expected);
  updateUserProfile(db,ana.id,{partC:{bio:'Changed off the dashboard'}});
  assert.notEqual((await (await get(endpoint,ana)).json()).stamp,expected);
  assert.ok(options.every(opt=>opt.authorizationOnly===false),'partial authorization rows cannot confirm a rendered profile');
});

test('only a member-specific navigation handoff can be cached briefly; denied, rotated and invalid requests stay uncached', async t => {
  const {account,repository,get} = await fixture(t);
  const me = account('Mina');
  const path = '/api/auth/view?scope=dashboard&check='+randomUUID();
  const check = await get(path,me);
  assert.equal(check.status,200);
  assert.equal(check.headers.get('cache-control'),'private, max-age=5, must-revalidate');
  assert.equal(check.headers.get('cdn-cache-control'),'no-store');
  assert.equal(check.headers.get('vary'),'Cookie, Authorization');
  for (const [url,member,status] of [[path,null,401],['/api/auth/view?scope=other&check='+randomUUID(),me,400],['/api/auth/view?scope=profile&check=wrong',me,200]]) {
    const response=await get(url,member);
    assert.equal(response.status,status);
    assert.equal(response.headers.get('cache-control'),'no-store');
  }
  const resolve=repository.resolveSession;
  repository.resolveSession=async (req,opts)=>({...await resolve(req,opts),cookies:['test-rotation=1; HttpOnly']});
  const rotated=await get(path,me);
  assert.ok(rotated.headers.has('set-cookie'));
  assert.equal(rotated.headers.get('cache-control'),'no-store');
});

test('profile sidebar revision matches settled directory rows, changes after a withdrawal and is absent for an unstable read', async t => {
  const {db,repository,account,get} = await fixture(t);
  const viewer=account('Pedro'), peer=account('Eva');
  updateUserProfile(db,peer.id,{partC:{consent:true}});
  const list=()=>get('/api/users?limit=5',viewer);
  const view=async()=>(await (await get('/api/auth/view?scope=profile',viewer)).json()).directoryRevision;
  const first=await list();
  const stamp=first.headers.get('X-Nodal-Directory-Revision');
  assert.ok(stamp);
  assert.equal(await view(),stamp);
  assert.ok((await first.json()).users.some(u=>u.id===peer.id));
  updateUserProfile(db,peer.id,{partC:{consent:false}});
  const next=await list();
  assert.notEqual(next.headers.get('X-Nodal-Directory-Revision'),stamp);
  assert.equal(next.headers.get('X-Nodal-Directory-Revision'),await view());
  assert.ok(!(await next.json()).users.some(u=>u.id===peer.id));
  let r=0;
  repository.getNetworkRevision=async()=>String(++r);
  const unstable=await list();
  assert.equal(unstable.status,200);
  assert.equal(unstable.headers.get('X-Nodal-Directory-Revision'),null);
  repository.getNetworkRevision=async()=>null;
  assert.equal(await view(),null);
});

test('hosted returns verify the session and revision without loading preferences or onboarding again', async t => {
  const id = randomUUID();
  const state = {revision:11, permission:'member', allowed:true, changeDuringRead:false};
  const calls = [];
  const repository = createSupabaseRepository({
    env: {NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-test',SUPABASE_SECRET_KEY:'server-test'},
    fetchImpl: async rawUrl => {
      const path = new URL(rawUrl).pathname;
      const key = path.split('/').at(-1);
      calls.push(key);
      if (path.startsWith('/auth/')) {
        return state.allowed ? Response.json({id,email:'member@example.test'}) : Response.json({message:'invalid'}, {status:401});
      }
      if (key === 'network_revision') return Response.json(state.revision == null ? [] : [{revision:state.revision}]);
      if (key === 'profiles') {
        if (state.changeDuringRead) { state.revision++; state.changeDuringRead = false; }
        return Response.json([{id,full_name:'Member',app_role:state.permission,account_status:'active'}]);
      }
      if (key === 'profile_preferences') return Response.json([{user_id:id}]);
      if (key === 'onboarding_responses') return Response.json([{user_id:id,skills:['Planning']}]);
      throw Error('Unexpected route '+path);
    },
  });
  const server = createApp({repository,courseStore:null,fiiuStore:null,workspaceStore:null,newsStore:null,
    nodeRequestStore:null,visitStore:null,metricsStore:null});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); });
  const base = 'http://127.0.0.1:'+server.address().port;
  const claims = Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  const cookie = 'nodal_session=stub.'+claims+'.stub; nodal_refresh=refresh-stub';
  const get = (path,headers={}) => fetch(base+path,{headers:{Cookie:cookie,...headers}});
  const marked = {'X-Nodal-View':'1'};
  const me = () => get('/api/auth/me',marked);
  const stamp = response => response.headers.get('x-nodal-view-stamp');
  const view = () => get('/api/auth/view?scope=profile').then(r=>r.json());
  const takeCalls = () => calls.splice(0);
  const fullRead = ['user','network_revision','profiles','profile_preferences','onboarding_responses'];

  const ordinary = await get('/api/auth/me');
  assert.equal(ordinary.status,200);
  assert.equal(stamp(ordinary),null);
  assert.deepEqual(takeCalls(),['user','profiles','profile_preferences','onboarding_responses']);

  const initial = await me();
  const first = stamp(initial);
  assert.match(first,/^[a-f0-9]{64}$/);
  assert.deepEqual((await initial.json()).user.skills,['Planning']);
  assert.deepEqual(takeCalls(),fullRead);
  assert.deepEqual(await view(),{stamp:first,directoryRevision:'db:11'});
  assert.deepEqual(takeCalls(),['user','profiles','network_revision']);

  state.permission = 'admin';
  assert.notEqual((await view()).stamp,first);
  state.permission = 'member';
  state.changeDuringRead = true;
  const racing = await me();
  assert.equal(stamp(racing),first,'a bundle read while data changes retains the earlier revision');
  assert.notEqual((await view()).stamp,stamp(racing));
  state.revision = null;
  assert.equal(stamp(await me()),null);
  assert.deepEqual(await view(),{stamp:null,directoryRevision:null});
  takeCalls();

  state.allowed = false;
  for (const path of ['/api/auth/me','/api/auth/view?scope=dashboard']) {
    assert.equal((await get(path,marked)).status,401);
    assert.deepEqual(takeCalls(),['user','token'],'a rejected auth pair cannot start a table read');
    assert.equal((await fetch(base+path,{headers:marked})).status,401);
    assert.deepEqual(takeCalls(),[]);
  }
});
