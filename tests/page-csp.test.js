import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {createApp} from '../server/server.js';
import {createDatabase,createUser} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {SERVER_PAGES,STATIC_PAGES} from '../scripts/build-static.js';

const ROOT=path.resolve(import.meta.dirname,'..');
const read=name=>readFileSync(path.join(ROOT,'web','pages',name),'utf8');
const META=/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/i;
/* In Chromium a CSP <meta> in the head stops the preload scanner, so every stylesheet, font and deferred script
   waited for the blocking locale.js: one more round trip on each cold load. The server sends the same policy, plus
   frame-ancestors, as a header on every page it serves, so those pages carry no meta. The CDN copies
   (opportunities, privacy) get only frame-ancestors from vercel.json and keep theirs; so does the home page. */
const KEEPS_META=new Set([...STATIC_PAGES,'index.html']);

async function boot(t){
  const db=createDatabase({filename:':memory:'});
  const cookies={};
  for(const role of ['member','admin']){
    const user=createUser(db,{fullName:`CSP ${role}`,email:`csp-${role}@example.test`,passwordHash:'unusable',role});
    cookies[role]=createSession(db,user.id).cookie.split(';')[0];
  }
  // Outside the course pilot so payments.html is served rather than redirected.
  const server=createApp({db,pilotMode:false});
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const get=(page,actor)=>fetch(`${base}/${page}`,{redirect:'manual',headers:actor?{Cookie:cookies[actor]}:{}});
  return {get};
}

function directives(header){
  const map=new Map();
  for(const part of String(header||'').split(';').map(value=>value.trim()).filter(Boolean)){const [name,...sources]=part.split(/\s+/);map.set(name,sources);}
  return map;
}

test('every page is either served by the server or copied to the CDN',()=>{
  const all=readdirSync(path.join(ROOT,'web/pages')).filter(name=>name.endsWith('.html')).sort();
  assert.deepEqual([...SERVER_PAGES,...STATIC_PAGES].sort(),all);
});

test('server pages get their policy from the header and carry no CSP meta that would stall the preload scanner',async t=>{
  const {get}=await boot(t);
  for(const page of SERVER_PAGES){
    // Sign-in sends a signed-in visitor on, and the staff pages need an organiser.
    let response=await get(page,page==='login.html'?null:'admin');
    if(response.status>=300&&response.status<400)response=await get(page,null);
    assert.equal(response.status,200,page);
    assert.match(response.headers.get('content-type'),/^text\/html/,page);
    const policy=directives(response.headers.get('content-security-policy'));
    for(const [name,value] of [['default-src',"'self'"],['script-src',"'self'"],['style-src',"'self'"],['font-src',"'self'"],['connect-src',"'self'"],['object-src',"'none'"],['base-uri',"'self'"],['form-action',"'self'"],['frame-ancestors',"'none'"]])
      assert.deepEqual(policy.get(name),[value],`${page}: ${name}`);
    assert.deepEqual(policy.get('img-src'),["'self'",'data:'],page);
    const html=await response.text();
    if(KEEPS_META.has(page))assert.match(html,META,page);
    else{assert.doesNotMatch(read(page),META,`${page} must not carry a CSP meta`);assert.doesNotMatch(html,META,page);}
  }
});

/* Chromium keeps no no-store page in the back/forward cache, so Back from a conversation rebuilt the whole programme
   and dropped the attendee at the top. These two pages are the same HTML for everyone; who is signed in only shows in
   the no-store API answers the scripts read afterwards. */
test('the festival programme and conversation pages may be kept for Back, and carry no member data',async t=>{
  const {get}=await boot(t);
  for(const page of ['fiiu.html','fiiu-talk.html']){
    const bodies=[];
    for(const actor of [null,'member','admin']){
      const response=await get(page,actor);
      assert.equal(response.status,200,`${page} ${actor}`);
      assert.equal(response.headers.get('cache-control'),'private, no-cache',`${page}: revalidated, never shared, but not no-store`);
      bodies.push(await response.text());
    }
    assert.equal(bodies[1],bodies[0],`${page}: a member gets the guest's bytes`);assert.equal(bodies[2],bodies[0],page);
    assert.equal(bodies[0],read(page),`${page} is served exactly as written`);
    assert.doesNotMatch(bodies[0],/csp-(?:member|admin)|example\.test/,page);
  }
  // Pages that are personal, or that answer differently by role, stay out of every cache.
  for(const [page,actor] of [['fiiu-checkin.html','member'],['dashboard.html','member'],['fiiu-admin.html','admin'],['fiiu-admin.html','member'],['login.html',null],['index.html',null]]){
    const response=await get(page,actor);
    assert.equal(response.headers.get('cache-control'),'no-store',`${page} ${actor}`);await response.arrayBuffer();
  }
});

test('pages that keep a CSP meta keep the full policy in it',()=>{
  for(const page of KEEPS_META){
    const meta=read(page).match(META)?.[0];
    assert.ok(meta,`${page}: the CDN serves it with only frame-ancestors, so the meta is its policy`);
    const policy=directives(meta.match(/content="([^"]+)"/)[1]);
    for(const [name,value] of [['default-src',"'self'"],['script-src',"'self'"],['style-src',"'self'"],['font-src',"'self'"],['object-src',"'none'"],['base-uri',"'self'"]])
      assert.deepEqual(policy.get(name),[value],`${page}: ${name}`);
  }
});
