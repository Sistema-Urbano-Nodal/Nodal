import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {readFileSync,readdirSync} from 'node:fs';
import {createDatabase,createUser,deleteUserById} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createRepository} from '../server/repository.js';
import {createApp} from '../server/server.js';
import {snake} from '../server/courses-schema.js';
import {createNewsStore,NEWS_FIELDS} from '../server/news-repository.js';
import {createNewsApi,encodeNewsCursor} from '../server/news-api.js';

const PUBLIC_KEYS=['body','id','pinned','publishedAt','title','url'];
const ADMIN_KEYS=['body','createdAt','id','pinned','publishedAt','status','title','updatedAt','url','version'];
const actors=db=>{
 const users={},cookies={};
 for(const name of ['member','admin','editor']){users[name]=createUser(db,{fullName:name,email:`${name}@example.test`,passwordHash:'unused',role:name==='member'?'member':'admin'});cookies[name]=createSession(db,users[name].id).cookie.split(';')[0];}
 return {users,cookies};
};
const client=(base,cookies)=>{
 const call=(path,{actor='admin',method='GET',body,origin=base}={})=>fetch(base+path,{method,redirect:'manual',headers:{...(cookies[actor]?{Cookie:cookies[actor]}:{}),Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const json=async response=>({status:response.status,body:response.status===204?await response.text():await response.json()});
 return {call,json,
  post:(body,actor='admin')=>call('/api/admin/news',{actor,method:'POST',body:{id:crypto.randomUUID(),title:'News',...body}}).then(json),
  patch:(id,body)=>call(`/api/admin/news/${id}`,{method:'PATCH',body}).then(json),
  feed:(query='',actor='guest')=>call(`/api/news${query}`,{actor}).then(json),
 };
};
// The wiring server.js gives the festival API: the session resolved to an API user, same-origin writes, and a
// top-level catch that answers our own sub-500 wording and masks everything else.
async function setup(t,{rateLimit}={}){
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const repository=createRepository({db}),{users,cookies}=actors(db),store=createNewsStore({db});
 const send=(res,status,body,headers={})=>{const json=typeof body==='object';res.writeHead(status,{'Content-Type':json?'application/json; charset=utf-8':'text/plain; charset=utf-8','Cache-Control':'no-store',...headers});res.end(json?JSON.stringify(body):body);};
 const sameOrigin=req=>{try{return !req.headers.origin||new URL(req.headers.origin).host===req.headers.host;}catch{return false;}};
 const api=createNewsApi({store,sameOrigin,send,rateLimit});
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(`http://127.0.0.1${req.url}`),{user}=await repository.resolveSession(req);
  if(await api({req,res,url,user:user?repository.toApiUser(user):null}))return;
  send(res,404,{error:'unhandled'});
 }catch(err){const status=err.status??500;send(res,status,{error:status>=500?'internal error':err.expose===false?'request failed':err.message});}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 return {db,store,users,cookies,base,...client(base,cookies)};
}
const at=(db,id,column,value)=>db.prepare(`UPDATE nodal_news SET ${column}=? WHERE id=?`).run(value,id);
async function walk(feed,query){const ids=[];let cursor='';do{const page=await feed(`?${query}&cursor=${cursor}`);assert.equal(page.status,200);ids.push(...page.body.items.map(i=>i.id));cursor=page.body.nextCursor??'';}while(cursor);return ids;}

test('news is public to read, while the desk API needs an administrator, same-origin writes and a supported method',async t=>{
 const {call,json,feed,base,cookies}=await setup(t);
 assert.deepEqual(await feed(),{status:200,body:{items:[],nextCursor:null}});
 const head=await call('/api/news',{actor:'guest',method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 for(const method of ['POST','PUT','PATCH','DELETE']){const r=await call('/api/news',{actor:'admin',method,body:{}});assert.equal(r.status,405,method);assert.equal(r.headers.get('allow'),'GET, HEAD');}
 for(const method of ['GET','POST']){
  assert.equal((await call('/api/admin/news',{actor:'guest',method,body:method==='POST'?{title:'x'}:undefined})).status,401);
  assert.equal((await call('/api/admin/news',{actor:'member',method,body:method==='POST'?{title:'x'}:undefined})).status,403);
 }
 assert.equal((await call(`/api/admin/news/${crypto.randomUUID()}`,{actor:'member',method:'DELETE'})).status,403);
 assert.deepEqual(await json(await call('/api/admin/news')),{status:200,body:{items:[],nextCursor:null}});
 assert.equal((await call('/api/admin/news',{method:'HEAD'})).status,200);
 const put=await call('/api/admin/news',{method:'PUT',body:{}});assert.equal(put.status,405);assert.equal(put.headers.get('allow'),'GET, HEAD, POST');
 const one=await call(`/api/admin/news/${crypto.randomUUID()}`);assert.equal(one.status,405);assert.equal(one.headers.get('allow'),'PATCH, DELETE');
 assert.equal((await call('/api/admin/news',{method:'POST',body:{title:'x'},origin:'https://elsewhere.test'})).status,403);
 assert.equal((await call(`/api/admin/news/${crypto.randomUUID()}`,{method:'DELETE',origin:'https://elsewhere.test'})).status,403);
 assert.deepEqual(await json(await call('/api/admin/news/not-an-id',{method:'DELETE'})),{status:400,body:{error:'id is invalid',field:'id'}});
 assert.equal((await call('/api/news/extra',{actor:'guest'})).status,404);
 assert.equal((await call('/api/admin/news/a/b')).status,404);
 assert.equal((await json(await call('/api/newsletter',{actor:'guest'}))).body.error,'unhandled','neighbouring paths are left to the rest of the server');
 const text=await fetch(base+'/api/admin/news',{method:'POST',headers:{Cookie:cookies.admin,Origin:base,'Content-Type':'text/plain'},body:'{}'});assert.equal(text.status,415);
 const broken=await fetch(base+'/api/admin/news',{method:'POST',headers:{Cookie:cookies.admin,Origin:base,'Content-Type':'application/json'},body:'{'});assert.equal(broken.status,400);
});

test('a new item is validated field by field, trimmed and normalised, and a retried save returns the stored row',async t=>{
 const {post,db,users}=await setup(t);
 const invalid=[[{title:''},'title'],[{title:'   '},'title'],[{title:'x'.repeat(161)},'title'],[{title:7},'title'],[{body:'x'.repeat(2001)},'body'],[{body:null},'body'],
  [{url:'http://example.test/'},'url'],[{url:'javascript:alert(1)'},'url'],[{url:'https:example.test'},'url'],[{url:'https://user:pw@example.test/'},'url'],
  [{url:'https://example.test/'.padEnd(501,'x')},'url'],[{url:'not a url'},'url'],[{url:7},'url'],[{status:'archived'},'status'],[{status:null},'status'],[{pinned:'yes'},'pinned'],[{id:'not-a-uuid'},'id']];
 for(const [input,field] of invalid){const r=await post(input);assert.equal(r.status,400,JSON.stringify(input));assert.equal(r.body.field,field,JSON.stringify(input));assert.equal(typeof r.body.error,'string');}
 assert.equal(db.prepare('SELECT count(*) AS n FROM nodal_news').get().n,0);
 const limits=await post({title:'t'.repeat(160),body:'b'.repeat(2000),url:'https://example.test/'.padEnd(500,'x')});assert.equal(limits.status,201,'each limit is inclusive');
 const id=crypto.randomUUID().toUpperCase();
 const created=await post({id,title:'  Lima opens a new route  ',body:'  Details\nhere  ',url:' HTTPS://Example.test/route ',pinned:true,status:'draft',createdBy:'spoof',publishedAt:'2020-01-01T00:00:00.000Z',version:9});
 assert.equal(created.status,201);const {item}=created.body;
 assert.deepEqual(Object.keys(item).sort(),ADMIN_KEYS);
 assert.deepEqual({...item,createdAt:0,updatedAt:0},{id:id.toLowerCase(),title:'Lima opens a new route',body:'Details\nhere',url:'https://example.test/route',pinned:true,status:'draft',publishedAt:null,createdAt:0,updatedAt:0,version:1});
 assert.equal(item.createdAt,item.updatedAt);
 const retry=await post({id,title:'  Lima opens a new route  ',body:'  Details\nhere  ',url:' HTTPS://Example.test/route ',pinned:true,status:'draft'});
 assert.equal(retry.status,200,'an identical retry (its first response was lost) gets the stored row');assert.deepEqual(retry.body.item,item);
 // The lost save was a draft; the editor then changed the title and pressed Publish. The stored draft is not reported
 // as published and the new text is not dropped: the desk gets the stored row as a conflict to resolve.
 for(const change of [{title:'Changed on retry'},{status:'published'},{pinned:false},{body:'Other'},{url:''}]){
  const replay=await post({id,title:'Lima opens a new route',body:'Details\nhere',url:'https://example.test/route',pinned:true,status:'draft',...change});
  assert.equal(replay.status,409,JSON.stringify(change));assert.deepEqual(replay.body,{error:'news item changed; reload before saving',code:'version_conflict',item},JSON.stringify(change));
 }
 assert.equal(db.prepare('SELECT count(*) AS n FROM nodal_news WHERE id=?').get(id.toLowerCase()).n,1);
 assert.equal(db.prepare('SELECT title,status FROM nodal_news WHERE id=?').get(id.toLowerCase()).status,'draft','a refused replay writes nothing');
 assert.equal(db.prepare('SELECT created_by FROM nodal_news WHERE id=?').get(item.id).created_by,users.admin.id,'authorship comes from the session');
 const minimal=await post({id:undefined,title:'Minimal'});assert.equal(minimal.status,201);
 assert.match(minimal.body.item.id,/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[\da-f]{4}-[\da-f]{12}$/);
 assert.deepEqual([minimal.body.item.body,minimal.body.item.url,minimal.body.item.pinned,minimal.body.item.status],['','',false,'draft']);
 const live=(await post({title:'Live',status:'published'})).body.item;assert.equal(live.publishedAt,live.createdAt);
});

test('the public feed lists published items only, pinned first then newest, with stable cursors and bounded pages',async t=>{
 const {post,feed,call,json,db}=await setup(t);
 const make=async(title,{pinned=false,status='published',day})=>{const {item}=(await post({title,pinned,status})).body;if(day)at(db,item.id,'published_at',`2026-10-${String(day).padStart(2,'0')}T12:00:00.000Z`);return item.id;};
 const pinnedOld=await make('Pinned old',{pinned:true,day:1}),pinnedNew=await make('Pinned new',{pinned:true,day:3});
 await make('Pinned draft',{pinned:true,status:'draft'});await make('Draft',{status:'draft'});
 const plain=[];for(let day=2;day<=13;day++)plain.push(await make(`Day ${day}`,{day}));
 const twin=await make('Same moment',{day:13}),[first,second]=[plain.at(-1),twin].sort().reverse();
 const expected=[pinnedNew,pinnedOld,first,second,...plain.slice(0,-1).reverse()];
 const page=await feed();assert.equal(page.status,200);assert.equal(page.body.items.length,10,'ten by default');
 assert.deepEqual(page.body.items.map(i=>i.id),expected.slice(0,10));
 for(const item of page.body.items){assert.deepEqual(Object.keys(item).sort(),PUBLIC_KEYS);assert.equal(typeof item.publishedAt,'string');}
 const rest=await feed(`?cursor=${page.body.nextCursor}`);assert.deepEqual(rest.body.items.map(i=>i.id),expected.slice(10));assert.equal(rest.body.nextCursor,null);
 assert.deepEqual(await walk(feed,'limit=3'),expected,'every published item exactly once, in order');
 assert.deepEqual(await walk(feed,'limit='),expected);
 assert.equal((await feed('?limit=50')).body.items.length,expected.length);assert.equal((await feed('?limit=50')).body.nextCursor,null);
 assert.deepEqual((await feed('?limit=1','member')).body.items.map(i=>i.id),[pinnedNew],'signed-in readers see the same feed');
 for(const limit of ['0','51','abc','1.5','-1','10x','007'])assert.deepEqual(await feed(`?limit=${limit}`),{status:400,body:{error:'limit is invalid',field:'limit'}},limit);
 const forged=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 for(const cursor of ['garbage!',forged([1,'2026-10-01T00:00:00Z']),forged([2,'2026-10-01T00:00:00Z',pinnedOld]),forged([1,'2026-10-01T00:00:00Z,id.gt.0)',pinnedOld]),forged([1,'yesterday',pinnedOld]),forged([1,'2026-10-01T00:00:00Z','x']),forged({}),encodeNewsCursor({createdAt:'2026-10-01T00:00:00.000Z',id:pinnedOld},false)])
  assert.deepEqual(await feed(`?cursor=${encodeURIComponent(cursor)}`),{status:400,body:{error:'cursor is invalid',field:'cursor'}},cursor);
 // A cursor keeps its place when the feed changes between two requests: nothing from page one repeats on page two.
 const head=await feed('?limit=3');
 await make('Breaking',{day:28});await call(`/api/admin/news/${expected[0]}`,{method:'DELETE'});
 const next=await feed(`?limit=3&cursor=${head.body.nextCursor}`);assert.deepEqual(next.body.items.map(i=>i.id),expected.slice(3,6));
 const desk=await json(await call(`/api/admin/news?cursor=${head.body.nextCursor}`));assert.deepEqual(desk.body,{error:'cursor is invalid',field:'cursor'},'feed and desk cursors are not interchangeable');
});

test('the desk lists every item newest written first, in pages of fifty',async t=>{
 const {store,call,json,users}=await setup(t);
 const ids=[];for(let n=0;n<52;n++){const id=crypto.randomUUID(),stamp=new Date(Date.UTC(2026,9,1,0,n)).toISOString();ids.push(id);await store.insert({id,title:`Item ${n}`,body:'',url:'',status:n%2?'published':'draft',pinned:n===0,publishedAt:n%2?stamp:null,createdAt:stamp,updatedAt:stamp,createdBy:users.admin.id,version:1});}
 const page=await json(await call('/api/admin/news?limit=5'));assert.equal(page.status,200);assert.equal(page.body.items.length,50,'the desk page size is fixed');
 assert.deepEqual(page.body.items.map(i=>i.id),ids.slice(2).reverse());
 for(const item of page.body.items)assert.deepEqual(Object.keys(item).sort(),ADMIN_KEYS);
 assert.deepEqual(page.body.items.slice(0,2).map(i=>[i.status,i.publishedAt===null]),[['published',false],['draft',true]]);
 const rest=await json(await call(`/api/admin/news?cursor=${page.body.nextCursor}`));assert.deepEqual(rest.body.items.map(i=>i.id),[ids[1],ids[0]]);assert.equal(rest.body.nextCursor,null);
 assert.equal((await json(await call('/api/admin/news?cursor='))).body.items.length,50);
 assert.deepEqual((await json(await call('/api/admin/news?cursor=nope'))).body,{error:'cursor is invalid',field:'cursor'});
});

test('edits are versioned and partial, publication is stamped once, and a stale editor gets the current item back',async t=>{
 const {post,patch,feed,db}=await setup(t);
 const {item}=(await post({title:'Draft',body:'Body',url:'https://example.test/a'})).body;
 for(const version of [undefined,0,-1,'1',1.5])assert.deepEqual(await patch(item.id,{version,title:'x'}),{status:400,body:{error:'version is required',field:'version'}},String(version));
 assert.deepEqual(await patch(crypto.randomUUID(),{version:1,title:'x'}),{status:404,body:{error:'news item unavailable'}});
 assert.equal((await patch('nope',{version:1})).body.field,'id');
 let r=await patch(item.id,{version:1,title:'  Edited  '});assert.equal(r.status,200);
 assert.deepEqual({...r.body.item,updatedAt:0},{...item,title:'Edited',version:2,updatedAt:0},'omitted fields keep their value');
 assert.ok(r.body.item.updatedAt>=item.updatedAt);
 r=await patch(item.id,{version:1,title:'Stale'});assert.equal(r.status,409);assert.equal(r.body.code,'version_conflict');assert.equal(r.body.item.title,'Edited');assert.equal(r.body.item.version,2);
 assert.equal(typeof r.body.error,'string');assert.deepEqual(Object.keys(r.body.item).sort(),ADMIN_KEYS);
 for(const [input,field] of [[{status:'archived'},'status'],[{title:''},'title'],[{pinned:1},'pinned'],[{url:'http://example.test/'},'url'],[{body:'x'.repeat(2001)},'body']])assert.equal((await patch(item.id,{version:2,...input})).body.field,field);
 assert.equal(db.prepare('SELECT version FROM nodal_news WHERE id=?').get(item.id).version,2,'a rejected edit changes nothing');
 r=await patch(item.id,{version:2,url:''});assert.equal(r.body.item.url,'','a link can be removed');
 r=await patch(item.id,{version:3,status:'published'});const first=r.body.item.publishedAt;assert.equal(typeof first,'string');assert.ok(first>=item.createdAt);
 assert.deepEqual((await feed()).body.items.map(i=>i.title),['Edited']);
 await new Promise(resolve=>setTimeout(resolve,5));
 r=await patch(item.id,{version:4,status:'draft'});assert.equal(r.body.item.publishedAt,first,'unpublishing keeps the first publication time');
 assert.deepEqual((await feed()).body.items,[]);
 r=await patch(item.id,{version:5,status:'published',pinned:true});assert.equal(r.body.item.publishedAt,first,'republishing does not move it up the feed');assert.equal(r.body.item.pinned,true);assert.equal(r.body.item.version,6);
});

test('concurrent edits and retried creates leave one consistent row',async t=>{
 const {post,patch,db}=await setup(t);
 const {item}=(await post({title:'Start'})).body;
 const edits=await Promise.all([patch(item.id,{version:1,title:'A'}),patch(item.id,{version:1,title:'B'})]);
 assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
 const [won,lost]=edits[0].status===200?edits:[edits[1],edits[0]];assert.equal(lost.body.code,'version_conflict');assert.deepEqual(lost.body.item,won.body.item);
 const same={id:crypto.randomUUID(),title:'Once',status:'published'},creates=await Promise.all([post(same),post(same)]);
 assert.deepEqual(creates.map(r=>r.status).sort(),[200,201]);assert.deepEqual(creates[0].body.item,creates[1].body.item);
 assert.equal(db.prepare('SELECT count(*) AS n FROM nodal_news WHERE id=?').get(same.id).n,1);
});

test('deleting is idempotent, and erasing an author keeps their news without the link',async t=>{
 const {post,patch,call,json,feed,db,users}=await setup(t);
 const {item}=(await post({title:'Gone soon',status:'published'})).body;
 assert.deepEqual(await json(await call(`/api/admin/news/${item.id}`,{method:'DELETE'})),{status:204,body:''});
 assert.deepEqual(await json(await call(`/api/admin/news/${item.id}`,{method:'DELETE'})),{status:204,body:''},'a retried deletion is not an error');
 assert.equal((await patch(item.id,{version:1,title:'x'})).status,404);assert.deepEqual((await feed()).body.items,[]);
 const kept=(await post({title:'Kept',status:'published'},'editor')).body.item;
 assert.equal(db.prepare('SELECT created_by FROM nodal_news WHERE id=?').get(kept.id).created_by,users.editor.id);
 assert.ok(deleteUserById(db,users.editor.id));
 assert.equal(db.prepare('SELECT created_by FROM nodal_news WHERE id=?').get(kept.id).created_by,null);
 assert.deepEqual((await feed()).body.items.map(i=>i.id),[kept.id]);
});

test('the rate limit runs after the access guards and a refusal stops before the store',async t=>{
 const seen=[];
 const {call,db}=await setup(t,{rateLimit:(req,res,user,path)=>{seen.push([req.method,path,user?.email??null]);if(req.method!=='POST')return true;res.writeHead(429,{'Retry-After':'7'});res.end('{}');return false;}});
 assert.equal((await call('/api/news',{actor:'guest'})).status,200);
 assert.equal((await call('/api/admin/news',{actor:'member',method:'POST',body:{title:'x'}})).status,403);
 const refused=await call('/api/admin/news',{method:'POST',body:{title:'x'}});assert.equal(refused.status,429);assert.equal(refused.headers.get('retry-after'),'7');
 assert.equal(db.prepare('SELECT count(*) AS n FROM nodal_news').get().n,0);
 assert.deepEqual(seen,[['GET','/api/news',null],['POST','/api/admin/news','admin@example.test']]);
});

test('the SQLite schema is created idempotently and refuses rows the API would reject',()=>{
 const db=createDatabase({filename:':memory:'});
 try{
  createNewsStore({db});createNewsStore({db});
  const row={id:crypto.randomUUID(),title:'Ok',body:'',url:'',status:'draft',pinned:0,published_at:null,created_at:'x',updated_at:'x',created_by:null,version:1};
  const insert=values=>db.prepare(`INSERT INTO nodal_news (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(()=>'?').join(',')})`).run(...Object.values(values));
  insert(row);
  for(const bad of [{title:''},{title:'x'.repeat(161)},{body:'x'.repeat(2001)},{url:'http://example.test/'},{url:'https://'.padEnd(501,'x')},{status:'archived'},{status:'published'},{pinned:2},{version:0}])
   assert.throws(()=>insert({...row,id:crypto.randomUUID(),...bad}),/CHECK constraint/,JSON.stringify(bad));
  assert.throws(()=>insert({...row,id:crypto.randomUUID(),created_by:'nobody'}),/FOREIGN KEY constraint/);
  assert.deepEqual(db.prepare('PRAGMA index_list(nodal_news)').all().map(i=>i.name).filter(n=>n.startsWith('nodal_news_')).sort(),['nodal_news_created_by','nodal_news_public','nodal_news_recent']);
 }finally{db.close();}
});

// In-memory PostgREST for nodal_news: eq/lt/gt leaves inside nested or()/and() trees, multi-column order, limit, a
// response row cap, exact counts (Content-Range) and constraint errors shaped like server/supabase.js responseError().
// Timestamps come back the way PostgreSQL prints them (+00:00), so cursors are exercised in the production format.
function postgrest({cap=Infinity,count=true,afterRead}={}){
 const tables={nodal_news:[]},calls=[],stampKey=key=>key.endsWith('_at');
 const cmp=(key,a,b)=>{if(a===b)return 0;if(a==null)return -1;if(b==null)return 1;const d=stampKey(key)?Date.parse(a)-Date.parse(b):a<b?-1:1;return Math.sign(d);};
 const split=text=>{const out=[];let depth=0,start=0;for(let i=0;i<text.length;i++){if(text[i]==='(')depth++;else if(text[i]===')')depth--;else if(text[i]===','&&!depth){out.push(text.slice(start,i));start=i+1;}}return [...out,text.slice(start)];};
 const leaf=(row,key,expr)=>{const [op,...rest]=expr.split('.'),value=rest.join('.'),actual=row[key]==null?row[key]:String(row[key]);
  if(stampKey(key)&&!Number.isFinite(Date.parse(value)))assert.fail('unparseable timestamp '+value);
  const c=cmp(key,actual,value);return op==='eq'?c===0:op==='lt'?c<0:op==='gt'?c>0:assert.fail('unsupported filter '+expr);};
 const node=(row,text)=>{const m=/^(and|or)\((.*)\)$/.exec(text);if(m)return split(m[2])[m[1]==='and'?'every':'some'](part=>node(row,part));const [key,...expr]=text.split('.');return leaf(row,key,expr.join('.'));};
 const matches=(row,query)=>Object.entries(query).every(([key,expr])=>['select','order','limit'].includes(key)||(key==='or'?node(row,`or${expr}`):leaf(row,key,expr)));
 const sorter=order=>(a,b)=>{for(const part of order.split(',')){const [key,dir]=part.split('.'),c=typeof a[key]==='boolean'?Number(a[key])-Number(b[key]):cmp(key,a[key],b[key]);if(c)return dir==='desc'?-c:c;}return 0;};
 const pg=row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,stampKey(k)&&v?new Date(v).toISOString().replace('Z','+00:00'):v]));
 const error=(code,message)=>Object.assign(Error(message),{status:409,expose:false,code});
 async function rest(table,options={}){
  calls.push({table,...structuredClone(options)});const query=options.query??{};
  if(query.offset!==undefined)assert.fail('the news store must page by keyset, never OFFSET');
  if(!options.method){
   const found=tables[table].filter(row=>matches(row,query)).sort(sorter(query.order??'id.asc'));
   const page=found.slice(0,Math.min(query.limit??Infinity,cap)).map(pg),total=count&&options.headers?.Prefer==='count=exact'?found.length:'*';
   afterRead?.({tables,count:calls.length});
   return options.includeRange?{rows:page,contentRange:page.length?`0-${page.length-1}/${total}`:`*/${total}`}:page;
  }
  if(options.method==='POST'){
   const row=structuredClone(options.body);
   if(tables[table].some(r=>r.id===row.id))throw error('23505','duplicate key value violates unique constraint');
   if(row.created_by==='gone')throw error('23503','insert or update violates foreign key constraint');
   tables[table].push(row);return [pg(row)];
  }
  const hit=tables[table].filter(row=>matches(row,query));
  if(options.method==='PATCH'){hit.forEach(row=>Object.assign(row,structuredClone(options.body)));return hit.map(pg);}
  tables[table]=tables[table].filter(row=>!hit.includes(row));return hit.map(pg);
 }
 return {tables,calls,clients:{admin:{rest}}};
}
const uuid=n=>`${n}0000000-0000-4000-8000-000000000000`;
const row=(n,{pinned=false,status='published',day=1,created=day}={})=>({id:uuid(n),title:'T'+n,body:'',url:'',status,pinned,published_at:status==='published'?`2026-10-${String(day).padStart(2,'0')}T12:00:00.000Z`:null,created_at:`2026-09-${String(created).padStart(2,'0')}T00:00:00.000Z`,updated_at:'2026-09-30T00:00:00.000Z',created_by:null,version:1});

test('Supabase news adapter fills capped feed pages by keyset across the pinned boundary',async()=>{
 const pg=postgrest({cap:2}),calls=pg.calls;
 pg.tables.nodal_news.push(row(1,{pinned:true,day:1}),row(2,{pinned:true,day:5}),row(3,{day:9}),row(4,{day:8}),row(5,{day:8}),row(6,{day:2}),row(7,{status:'draft',pinned:true}),row(8,{status:'draft'}));
 const store=createNewsStore({clients:pg.clients});
 assert.deepEqual((await store.list({published:true,limit:11})).map(r=>r.title),['T2','T1','T3','T5','T4','T6']);
 assert.ok(calls.every(c=>c.query.status==='eq.published'&&c.query.order==='pinned.desc,published_at.desc,id.desc'&&c.headers.Prefer==='count=exact'));
 assert.deepEqual(calls.map(c=>c.query.limit),[11,9,7]);
 assert.equal(calls[0].query.or,undefined);
 assert.equal(calls[1].query.or,`(pinned.eq.false,and(pinned.eq.true,published_at.lt.2026-10-01T12:00:00.000+00:00),and(pinned.eq.true,published_at.eq.2026-10-01T12:00:00.000+00:00,id.lt.${uuid(1)}))`);
 assert.equal(calls[1].query.pinned,undefined,'a pinned cursor still reaches the unpinned items');
 assert.equal(calls[2].query.pinned,'eq.false');assert.equal(calls[2].query.or,`(published_at.lt.2026-10-08T12:00:00.000+00:00,and(published_at.eq.2026-10-08T12:00:00.000+00:00,id.lt.${uuid(5)}))`);
 const first=(await store.list({published:true,limit:2}));
 assert.deepEqual((await store.list({published:true,after:first.at(-1),limit:10})).map(r=>r.title),['T3','T5','T4','T6']);
 for(const item of first)assert.equal(typeof item.pinned,'boolean');
 const desk=postgrest({cap:1});desk.tables.nodal_news.push(row(1,{created:3}),row(2,{created:1,status:'draft'}),row(3,{created:2}));
 assert.deepEqual((await createNewsStore({clients:desk.clients}).list({limit:3})).map(r=>r.title),['T1','T3','T2']);
 assert.ok(desk.calls.every(c=>c.query.order==='created_at.desc,id.desc'&&c.query.status===undefined));
 assert.equal(desk.calls[1].query.or,`(created_at.lt.2026-09-03T00:00:00.000+00:00,and(created_at.eq.2026-09-03T00:00:00.000+00:00,id.lt.${uuid(1)}))`);
});

test('Supabase news reads answer a short page in one request, read on without a count, and reject malformed answers',async()=>{
 const quiet=postgrest();quiet.tables.nodal_news.push(row(1),row(2),row(3));
 assert.equal((await createNewsStore({clients:quiet.clients}).list({published:true,limit:11})).length,3);assert.equal(quiet.calls.length,1,'the usual short page costs one request');
 const uncounted=postgrest({cap:2,count:false});uncounted.tables.nodal_news.push(row(1,{day:3}),row(2,{day:2}),row(3,{day:1}));
 assert.deepEqual((await createNewsStore({clients:uncounted.clients}).list({published:true,limit:11})).map(r=>r.title),['T1','T2','T3']);assert.equal(uncounted.calls.length,3);
 // An item published between two capped requests sorts before the cursor and cannot repeat a row.
 const busy=postgrest({cap:2,afterRead:({tables,count})=>{if(count===1)tables.nodal_news.push(row(9,{day:30}));}});busy.tables.nodal_news.push(row(1,{day:4}),row(2,{day:3}),row(3,{day:2}));
 assert.deepEqual((await createNewsStore({clients:busy.clients}).list({published:true,limit:11})).map(r=>r.title),['T1','T2','T3']);
 const broken=createNewsStore({clients:{admin:{async rest(){return {};}}}});
 for(const call of [()=>broken.list({limit:2}),()=>broken.get(uuid(1)),()=>broken.update(uuid(1),1,{title:'x'}),()=>broken.remove(uuid(1)),()=>broken.insert({id:uuid(1)})])await assert.rejects(call(),error=>error.status===502);
 await assert.rejects(broken.list({limit:101}),/invalid news limit/);
 await assert.rejects(broken.insert({id:uuid(1),author:'x'}),/unknown news field/);
});

test('Supabase news writes map a reused id to 409 and a vanished author to 404, and scope edits by version',async()=>{
 const pg=postgrest(),store=createNewsStore({clients:pg.clients}),record={id:uuid(1),title:'T',body:'',url:'',status:'draft',pinned:false,publishedAt:null,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',createdBy:null,version:1};
 const saved=await store.insert(record);assert.equal(saved.createdAt,'2026-10-01T00:00:00.000+00:00');assert.equal(saved.pinned,false);
 assert.deepEqual(pg.calls.at(-1).body,Object.fromEntries(Object.entries(record).map(([k,v])=>[snake(k),v])),'booleans stay booleans for PostgREST');
 await assert.rejects(store.insert(record),error=>error.status===409);
 await assert.rejects(store.insert({...record,id:uuid(2),createdBy:'gone'}),error=>error.status===404&&error.message==='related record unavailable');
 assert.equal((await store.update(uuid(1),1,{title:'Edited',version:2})).title,'Edited');
 assert.deepEqual(pg.calls.at(-1).query,{id:`eq.${uuid(1)}`,version:'eq.1'});assert.equal(pg.calls.at(-1).headers.Prefer,'return=representation');
 assert.equal(await store.update(uuid(1),1,{title:'Stale',version:2}),null);
 assert.equal((await store.get(uuid(1))).title,'Edited');assert.equal(await store.get(uuid(3)),null);
 assert.equal(await store.remove(uuid(1)),1);assert.deepEqual(pg.calls.at(-1).query,{id:`eq.${uuid(1)}`});assert.equal(await store.remove(uuid(1)),0);
});

test('Supabase-backed news API retries creates idempotently, reports version conflicts and pages the feed in the PostgreSQL timestamp format',async()=>{
 const pg=postgrest({cap:1});
 const api=createNewsApi({store:createNewsStore({clients:pg.clients}),sameOrigin:()=>true,send:(res,status,body,headers={})=>Object.assign(res,{status,body,headers})});
 const admin={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'admin@example.test',permission:'admin'};
 const call=async(method,path,body,user=admin)=>{
  const res={},req={method,headers:body===undefined?{}:{'content-type':'application/json'},async *[Symbol.asyncIterator](){if(body!==undefined)yield Buffer.from(JSON.stringify(body));}};
  try{assert.equal(await api({req,res,url:new URL('http://nodal.test'+path),user}),true);}catch(error){Object.assign(res,{status:error.status??500,body:{error:error.message}});}
  return res;
 };
 const create=async(title,extra={})=>{const res=await call('POST','/api/admin/news',{id:crypto.randomUUID(),title,status:'published',...extra});assert.equal(res.status,201);return res.body.item;};
 const a=await create('A'),b=await create('B',{pinned:true}),c=await create('C');await create('Draft',{status:'draft'});
 const retry=await call('POST','/api/admin/news',{id:a.id,title:'A',status:'published'});assert.equal(retry.status,200);assert.deepEqual(retry.body.item,a);
 const changed=await call('POST','/api/admin/news',{id:a.id,title:'A again',status:'published'});
 assert.deepEqual([changed.status,changed.body.code,changed.body.item.title,changed.body.item.version],[409,'version_conflict','A',1],'different content under a stored id is a conflict');
 assert.equal(pg.tables.nodal_news.length,4);assert.ok(pg.tables.nodal_news.every(r=>r.created_by===admin.id));
 [[a,'2026-10-02'],[b,'2026-10-01'],[c,'2026-10-03']].forEach(([item,day])=>{pg.tables.nodal_news.find(r=>r.id===item.id).published_at=`${day}T09:30:00.000Z`;});
 const ids=[];let cursor='',pages=0;
 do{const page=await call('GET',`/api/news?limit=1&cursor=${cursor}`,undefined,null);assert.equal(page.status,200);ids.push(...page.body.items.map(i=>i.id));
  for(const item of page.body.items){assert.deepEqual(Object.keys(item).sort(),PUBLIC_KEYS);assert.match(item.publishedAt,/\+00:00$/);}
  cursor=page.body.nextCursor??'';pages++;}while(cursor);
 assert.deepEqual(ids,[b.id,c.id,a.id]);assert.equal(pages,3,'the last page carries no follow-up cursor');
 const stale=await call('PATCH',`/api/admin/news/${c.id}`,{version:7,title:'Stale'});
 assert.deepEqual([stale.status,stale.body.code,stale.body.item.title,stale.body.item.version],[409,'version_conflict','C',1]);
 const edited=await call('PATCH',`/api/admin/news/${c.id}`,{version:1,status:'draft'});assert.deepEqual([edited.status,edited.body.item.status,edited.body.item.publishedAt],[200,'draft','2026-10-03T09:30:00.000+00:00']);
 assert.deepEqual([(await call('DELETE',`/api/admin/news/${a.id}`)).status,pg.tables.nodal_news.length],[204,3]);
 assert.equal((await call('GET','/api/admin/news',undefined,{...admin,permission:'member'})).status,403);
 assert.equal((await call('GET','/api/admin/news',undefined,null)).status,401);
});

test('the news migration keeps the table behind the server: RLS on, no browser grants, least service-role privileges',()=>{
 const dir=new URL('../supabase/migrations/',import.meta.url),names=readdirSync(dir).sort(),name=names.find(n=>n.endsWith('_nodal_news.sql'));
 assert.match(name??'',/^\d{14}_nodal_news\.sql$/);assert.ok(name.slice(0,14)>'20260929194059','sorts after the festival migrations');
 const sql=readFileSync(new URL(name,dir),'utf8');
 assert.match(sql,/^BEGIN;[\s\S]+COMMIT;\s*$/);
 assert.match(sql,/CREATE TABLE public\.nodal_news \(/);
 for(const column of NEWS_FIELDS.map(snake))assert.match(sql,new RegExp(`\\n ${column} `),column);
 assert.match(sql,/created_by uuid REFERENCES public\.profiles\(id\) ON DELETE SET NULL/);
 assert.match(sql,/CHECK\(status IN \('draft','published'\)\)/);assert.match(sql,/CHECK\(status='draft' OR published_at IS NOT NULL\)/);
 assert.match(sql,/CREATE INDEX nodal_news_public ON public\.nodal_news\(status,pinned DESC,published_at DESC,id DESC\);/);
 assert.match(sql,/CREATE INDEX nodal_news_created_by ON public\.nodal_news\(created_by\);/);
 assert.match(sql,/ALTER TABLE public\.nodal_news ENABLE ROW LEVEL SECURITY;/);
 assert.match(sql,/REVOKE ALL ON TABLE public\.nodal_news FROM PUBLIC,anon,authenticated;/);
 assert.doesNotMatch(sql,/GRANT[^;]+TO[^;]*\b(?:PUBLIC|anon|authenticated)\b/i);assert.doesNotMatch(sql,/CREATE POLICY/i);
 // Same reading as tests/deploy.test.js effectiveServicePrivileges: a revoke clears, later grants add.
 const privileges=new Set();
 for(const statement of sql.split(';').map(s=>s.replace(/^\s*(?:--[^\n]*\n\s*)*/,'').trim())){
  if(/^REVOKE ALL ON TABLE public\.nodal_news FROM service_role$/i.test(statement))privileges.clear();
  const grant=statement.match(/^GRANT (.+?) ON TABLE public\.nodal_news TO service_role$/i);if(grant)grant[1].split(',').forEach(p=>privileges.add(p.trim().toLowerCase()));
 }
 assert.deepEqual([...privileges].sort(),['delete','insert','select','update']);
});

// Runs once server.js dispatches the news API (the integration step wires it next to the festival API).
const wired=readFileSync(new URL('../server/server.js',import.meta.url),'utf8').includes('createNewsApi');
test('createApp serves the news API with the shared sessions, origin guard and error handling',{skip:!wired&&'server.js does not dispatch the news API yet'},async t=>{
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const {cookies}=actors(db),server=createApp({db});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const {call,json,post,patch,feed}=client(`http://127.0.0.1:${server.address().port}`,cookies);
 assert.deepEqual(await feed(),{status:200,body:{items:[],nextCursor:null}});
 assert.equal((await call('/api/news',{actor:'guest',method:'HEAD'})).status,200);
 assert.equal((await call('/api/admin/news',{actor:'guest'})).status,401);assert.equal((await call('/api/admin/news',{actor:'member'})).status,403);
 assert.equal((await call('/api/admin/news',{method:'POST',body:{title:'x'},origin:'https://elsewhere.test'})).status,403);
 assert.deepEqual(await post({title:''}),{status:400,body:{error:'title is required',field:'title'}});
 const {item}=(await post({title:'Wired',status:'published'})).body;
 assert.deepEqual((await feed()).body.items.map(i=>i.title),['Wired']);
 assert.equal((await patch(item.id,{version:9,title:'x'})).body.code,'version_conflict');
 assert.equal((await patch(crypto.randomUUID(),{version:1,title:'x'})).status,404);
 assert.equal((await json(await call(`/api/admin/news/${item.id}`,{method:'DELETE'}))).status,204);
});
