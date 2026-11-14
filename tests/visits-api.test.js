import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {request} from 'node:http';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {createDatabase} from '../server/db.js';
import {createApp} from '../server/server.js';
import {createStore} from '../server/store.js';
import {createVisitStore as createVisitStoreFor} from '../server/visits-repository.js';
import {VISIT_PAGES,VISIT_SOURCES,VISIT_VIAS,createVisitApi} from '../server/visits-api.js';

const ROOT=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');
const START='2026-11-14T15:00:00.000Z';
const CHROME='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// Every answer of this route is checked here, in the test that asked: the route never answers 5xx.
const below500=status=>{assert.ok(status<500,`answered ${status}`);return status;};

// The whole server (createApp) on SQLite with an injected clock; hit() posts to /api/visit.
async function setup(t,{options={},limits}={}){
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const clock={at:Date.parse(START)};
 const server=createApp({db,now:()=>clock.at,...(limits?{visitLimits:limits}:{}),...options});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const hit=async(body,{origin=base,type='application/json',ua=CHROME,headers={},method='POST'}={})=>{
  const response=await fetch(`${base}/api/visit`,{method,headers:{...(origin?{Origin:origin}:{}),'Content-Type':type,...(ua===null?{}:{'User-Agent':ua}),...headers},
   body:method==='GET'?undefined:typeof body==='string'?body:JSON.stringify(body)});
  below500(response.status);return response;
 };
 // For what fetch will not send as given: no Origin, or a Sec-Fetch-Site of our choosing.
 const raw=(headers,body='{"p":"/","r":"","v":""}',method='POST')=>new Promise((resolve,reject)=>{
  const req=request(`${base}/api/visit`,{method,headers:Object.fromEntries(Object.entries({'Content-Type':'application/json','User-Agent':CHROME,...headers}).filter(([,value])=>value!==undefined))},res=>{res.resume();res.on('end',()=>resolve(below500(res.statusCode)));});
  req.on('error',reject);req.end(body);
 });
 const rows=()=>db.prepare('SELECT day,kind,page,source,n FROM visit_counts ORDER BY kind DESC,page,source').all().map(Object.values);
 return {db,clock,base,hit,raw,rows};
}
const source=async(h,r,v='')=>{const {hit,rows}=h;await hit({p:'/',r,v});const found=rows().find(row=>row[1]==='arrival');return found?found[3]:null;};

test('exports the page map, the eleven sources and the seven via values',()=>{
 assert.equal(Object.keys(VISIT_PAGES).length,15);assert.equal(new Set(Object.values(VISIT_PAGES)).size,14);
 assert.equal(VISIT_PAGES['/'],'index.html');assert.equal(VISIT_PAGES['/index.html'],'index.html');assert.equal(VISIT_PAGES['/fiiu-talk.html'],undefined);
 assert.deepEqual(VISIT_SOURCES,['direct','search','whatsapp','email','linkedin','instagram','facebook','x','qr','sistemaurbano','other']);
 assert.deepEqual(VISIT_VIAS,['whatsapp','email','linkedin','instagram','facebook','x','qr']);
 for(const page of new Set(Object.values(VISIT_PAGES)))assert.ok(existsSync(path.join(ROOT,'web','pages',page)),page);
});

test('counts a view for an internal move and a view plus an arrival otherwise',async t=>{
 const {hit,rows}=await setup(t);
 assert.equal((await hit({p:'/fundadores.html',r:'self',v:''})).status,204);
 const res=await hit({p:'/fundadores.html',r:'www.google.com',v:''});
 assert.deepEqual([res.status,await res.text(),res.headers.get('cache-control')],[204,'','no-store']);
 assert.deepEqual(rows(),[['2026-11-14','view','fundadores.html','',2],['2026-11-14','arrival','fundadores.html','search',1]]);
});

test('/ and /index.html add to one index.html row, and the session page counts',async t=>{
 const {hit,rows}=await setup(t);
 await hit({p:'/',r:'self',v:''});await hit({p:'/index.html',r:'self',v:''});
 assert.deepEqual(rows(),[['2026-11-14','view','index.html','',2]]);
 await hit({p:'/fiiu-session.html',r:'self',v:''});
 assert.deepEqual(rows(),[['2026-11-14','view','fiiu-session.html','',1],['2026-11-14','view','index.html','',2]]);
});

test('addresses off the list answer 204 and store nothing',async t=>{
 const {hit,rows}=await setup(t);
 for(const p of ['/fiiu-talk.html','/admin.html','/index.html/','/Index.html','/index.html?x=1','/privacy.html','/%69ndex.html','constructor','__proto__','toString'])
  assert.equal((await hit({p,r:'self',v:''})).status,204,p);
 assert.deepEqual(rows(),[]);
});

test('reduces via and referrer to a source',async t=>{
 const cases=[['','','direct'],['','whatsapp','whatsapp'],['',' WhatsApp ','whatsapp'],['www.google.com.pe','','search'],['mail.google.com','','email'],
  ['mail.yahoo.com','','email'],['l.instagram.com','','instagram'],['t.co','','x'],['www.sistemaurbano.org','','sistemaurbano'],['example.org','','other'],
  ['notgoogle.com','','other'],['www.google.com','qr','qr'],['www.google.com','tiktok','search'],['','x'.repeat(500),'direct'],
  ['com.google.android.gm','','email'],['lnkd.in','','linkedin'],['m.facebook.com','','facebook'],['wa.me','','whatsapp'],['www.bing.com','','search'],
  ['https://www.google.com/','','other'],['evil.com/www.google.com','','other'],['no host name','','other']];
 for(const [r,v,expected] of cases){
  const h=await setup(t);
  assert.equal(await source(h,r,v),expected,`${JSON.stringify(r.slice(0,30))} via ${JSON.stringify(v.slice(0,10))}`);
 }
});

test('whatever r holds, only a fixed source is stored',async t=>{
 const {hit,rows}=await setup(t);
 for(const r of ['<script>','A'.repeat(300),'WWW.GOOGLE.COM','com.google.android.gm',"'; DROP TABLE visit_counts;--"])await hit({p:'/',r,v:''});
 const stored=rows().filter(row=>row[1]==='arrival');
 assert.equal(stored.length,3);
 for(const row of stored)assert.ok(VISIT_SOURCES.includes(row[3]),row[3]);
 const before=JSON.stringify(rows());
 assert.equal((await hit({p:'/',r:123,v:''})).status,204);assert.equal((await hit({p:'/'})).status,204);
 assert.equal(JSON.stringify(rows()),before);
});

test('the query, the referrer and the address are never stored',async t=>{
 const {hit,rows}=await setup(t);
 await hit({p:'/',r:'secret.example.org',v:'whatsapp'});await hit({p:'/index.html?token=secret',r:'secret.example.org',v:''});await hit({p:'/',r:'secret.example.org',v:''});
 const text=JSON.stringify(rows());
 for(const forbidden of ['secret','example.org','127.0.0.1','?'])assert.ok(!text.includes(forbidden),forbidden);
});

test('a hit is counted on its Lima day',async t=>{
 const {hit,rows,clock}=await setup(t);
 clock.at=Date.parse('2026-11-15T04:59:59.000Z');await hit({p:'/',r:'self',v:''});
 clock.at=Date.parse('2026-11-15T05:00:00.000Z');await hit({p:'/',r:'self',v:''});
 assert.deepEqual(rows().map(row=>[row[0],row[4]]),[['2026-11-14',1],['2026-11-15',1]]);
});

test('counts in-app browsers and ignores previewers and crawlers',async t=>{
 const {hit,raw,rows,base}=await setup(t);
 for(const ua of ['Mozilla/5.0 (iPhone) Instagram 300.0.0.0','Mozilla/5.0 [FBAN/FBIOS;FBAV/400]','Mozilla/5.0 LinkedInApp','Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'])assert.equal((await hit({p:'/',r:'self',v:''},{ua})).status,204);
 assert.equal(rows()[0][4],4);
 for(const ua of ['facebookexternalhit/1.1','WhatsApp/2.23','Googlebot/2.1','Mozilla/5.0 (compatible; bingbot/2.0)','Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)','TelegramBot (like TwitterBot)','HeadlessChrome',''])assert.equal((await hit({p:'/',r:'self',v:''},{ua})).status,204,String(ua));
 // fetch always sends some User-Agent, so a request with none goes through node:http.
 assert.equal(await raw({Origin:base,'User-Agent':undefined}),204);
 assert.equal(rows()[0][4],4);
});

test('refuses other methods, other origins and other content types',async t=>{
 const {hit,raw,rows}=await setup(t);
 const get=await hit(null,{method:'GET'});assert.equal(get.status,405);assert.equal(get.headers.get('allow'),'POST');assert.deepEqual(await get.json(),{error:'method not allowed'});
 assert.equal(await raw({}),403);
 assert.equal((await hit({p:'/',r:'self',v:''},{origin:'https://evil.example'})).status,403);
 const h=await setup(t);
 for(const [site,expected] of [['cross-site',403],['none',403],['same-origin',204]])assert.equal(await h.raw({Origin:h.base,'Sec-Fetch-Site':site}),expected,site);
 assert.deepEqual(h.rows(),[['2026-11-14','view','index.html','',1],['2026-11-14','arrival','index.html','direct',1]],'only the same-origin one counted');
 assert.equal((await hit({p:'/',r:'self',v:''},{type:'text/plain'})).status,415);
 assert.equal((await hit({p:'/',r:'x'.repeat(2000),v:''})).status,413);
 assert.equal((await hit('[]')).status,400);
 assert.equal((await hit('{nope')).status,400);
 assert.deepEqual(rows(),[]);
});

test('limits one address to 600 a minute',async t=>{
 const {hit,rows}=await setup(t,{limits:{perAddress:3}});
 for(let i=0;i<3;i++)assert.equal((await hit({p:'/',r:'self',v:''})).status,204);
 const res=await hit({p:'/',r:'self',v:''});
 assert.equal(res.status,429);assert.deepEqual(await res.json(),{error:'too many requests'});assert.ok(res.headers.get('retry-after'));
 assert.equal(rows()[0][4],3);
});

test('past the per-instance ceiling it answers 204 and stores nothing',async t=>{
 const {hit,rows}=await setup(t,{limits:{ceiling:2}});
 for(let i=0;i<3;i++)assert.equal((await hit({p:'/',r:'self',v:''})).status,204);
 assert.deepEqual(rows(),[['2026-11-14','view','index.html','',2]]);
});

test('a failing store answers 204, is asked nothing for 60 seconds, and is logged once without the address',async t=>{
 const logged=t.mock.method(console,'error',()=>{});
 let calls=0;
 const visitStore={async count(){calls++;throw Object.assign(new Error('x'),{code:'PGRST202'});}};
 const {hit,clock}=await setup(t,{options:{visitStore}});
 assert.equal((await hit({p:'/',r:'self',v:''})).status,204);assert.equal(calls,1);
 assert.equal((await hit({p:'/',r:'self',v:''})).status,204);assert.equal(calls,1);
 clock.at+=60001;
 assert.equal((await hit({p:'/',r:'self',v:''})).status,204);assert.equal(calls,2);
 const failures=logged.mock.calls.filter(call=>String(call.arguments[0]).startsWith('Visit count failed'));
 assert.equal(failures.length,1);assert.match(failures[0].arguments[0],/^Visit count failed: PGRST202$/);
 assert.ok(!logged.mock.calls.some(call=>call.arguments.some(arg=>String(arg).includes('127.0.0.1'))));
});

test('a missing table answers 204',async t=>{
 const {hit,db}=await setup(t);
 db.exec('DROP TABLE visit_counts');
 assert.equal((await hit({p:'/',r:'self',v:''})).status,204);
});

test('a store that never answers is given up after the write limit',async t=>{
 t.mock.method(console,'error',()=>{});
 const visitStore={count:()=>new Promise(()=>{})};
 const {hit}=await setup(t,{options:{visitStore},limits:{writeMs:50}});
 const started=Date.now();
 assert.equal((await hit({p:'/',r:'self',v:''})).status,204);
 assert.ok(Date.now()-started<1000);
});

test('never resolves a session',async t=>{
 let lookups=0;
 const repository={resolveSession(){lookups++;throw new Error('session service stalled');}};
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const server=createApp({repository,visitStore:createVisitStoreFor({db})});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(`${base}/api/visit`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json','User-Agent':CHROME,Cookie:'nodal_session=stale; nodal_refresh=stale'},body:JSON.stringify({p:'/',r:'self',v:''})});
 below500(response.status);
 assert.equal(response.status,204);assert.equal(lookups,0);
 assert.equal(db.prepare('SELECT n FROM visit_counts').get().n,1);
});

test('an app with no database answers 204',async t=>{
 const server=createApp({store:createStore()});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(`${base}/api/visit`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json','User-Agent':CHROME},body:JSON.stringify({p:'/',r:'self',v:''})});
 below500(response.status);
 assert.equal(response.status,204);
});

test('a return from a payment page counts as a view, not a new arrival',async t=>{
 const {hit,rows}=await setup(t);
 for(const r of ['www.mercadopago.com.pe','mercadopago.com','www.mercadopago.com','www.mercadolibre.com'])assert.equal((await hit({p:'/payments.html',r,v:''})).status,204,r);
 await hit({p:'/fundadores.html',r:'www.mercadopago.com.pe',v:'whatsapp'});
 assert.deepEqual(rows(),[['2026-11-14','view','fundadores.html','',1],['2026-11-14','view','payments.html','',4]]);
 assert.equal(await source(await setup(t),'notmercadopago.com'),'other');
});

// The route on its own, with a request object of our making.
function direct({store=null,ceiling=()=>true,body}={}){
 const sent=[];
 const api=createVisitApi({store,send:(res,status,payload)=>sent.push([status,payload]),sameOrigin:()=>true,now:()=>Date.parse(START),addressAllowed:()=>true,ceilingAllowed:ceiling});
 const req=Object.assign(body??Readable.from([Buffer.from('{"p":"/","r":"self","v":""}')]),{method:'POST',headers:{origin:'http://h.example',host:'h.example','content-type':'application/json','user-agent':CHROME}});
 return {sent,go:()=>api({req,res:{headersSent:false},url:new URL('http://h.example/api/visit')})};
}

test('a body error without a status answers a fixed message',async()=>{
 const body=new Readable({read(){this.destroy(new Error('internal detail /var/secret'));}});
 const {sent,go}=direct({body});
 assert.equal(await go(),true);
 assert.deepEqual(sent,[[400,{error:'bad request'}]]);
});

test('an app without a store spends no ceiling',async()=>{
 let taken=0;
 const {sent,go}=direct({ceiling:()=>{taken++;return true;}});
 await go();
 assert.deepEqual(sent,[[204,'']]);assert.equal(taken,0);
});

test('on Supabase the default store counts through rpc/count_visit',async t=>{
 const keys=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY'];
 const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 t.after(()=>{for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}});
 for(const key of keys)delete process.env[key];
 Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:'https://project.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-test-key',SUPABASE_SECRET_KEY:'server-test-key'});
 const realFetch=globalThis.fetch,calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(!String(url).startsWith('https://project.supabase.co'))return realFetch(url,init);
  calls.push([new URL(url).pathname,JSON.parse(init.body)]);return new Response('',{status:204});
 });
 const server=createApp({repository:{kind:'supabase'},courseStore:null,fiiuStore:null,newsStore:null,nodeRequestStore:null,now:()=>Date.parse(START)});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const response=await realFetch(`${base}/api/visit`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json','User-Agent':CHROME},body:JSON.stringify({p:'/',r:'',v:''})});
 assert.equal(response.status,204);
 assert.deepEqual(calls,[['/rest/v1/rpc/count_visit',{p_hit:{day:'2026-11-14',page:'index.html',arrival:true,source:'direct'}}]]);
});
