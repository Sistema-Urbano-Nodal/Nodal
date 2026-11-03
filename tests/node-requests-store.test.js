import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createDatabase,createUser} from '../server/db.js';
import {createNodeRequestStore,NODE_REQUEST_FIELDS} from '../server/node-requests-repository.js';

const uuid=n=>`${n}0000000-0000-4000-8000-000000000000`;
const record=(n,over={})=>({id:uuid(n),name:'Ana',organization:'Colectivo '+n,email:'ana@example.test',phone:null,message:'Hola',language:'es',status:'new',emailStatus:null,
 createdAt:`2026-10-${String(n).padStart(2,'0')}T10:00:00.000Z`,updatedAt:`2026-10-${String(n).padStart(2,'0')}T10:00:00.000Z`,updatedBy:null,version:1,...over});
const sqlite=t=>{const db=createDatabase({filename:':memory:'});t.after(()=>db.close());return {db,store:createNodeRequestStore({db})};};

test('stores, reads and lists node requests newest first, by page',async t=>{
 const {store}=sqlite(t);
 assert.deepEqual(NODE_REQUEST_FIELDS,['id','name','organization','email','phone','message','language','status','emailStatus','createdAt','updatedAt','updatedBy','version']);
 assert.equal(store.kind,'sqlite');
 for(const n of [3,1,2])assert.deepEqual(await store.insert(record(n)),record(n));
 // Two requests in the same instant are ordered by id, descending.
 await store.insert(record(4,{createdAt:record(3).createdAt}));
 assert.deepEqual(await store.get(uuid(2)),record(2));assert.equal(await store.get(uuid(9)),null);
 const first=await store.list({limit:2});assert.deepEqual(first.map(r=>r.id),[uuid(4),uuid(3)]);
 const second=await store.list({after:{createdAt:first.at(-1).createdAt,id:first.at(-1).id},limit:2});assert.deepEqual(second.map(r=>r.id),[uuid(2),uuid(1)]);
 assert.deepEqual(await store.list({after:{createdAt:second.at(-1).createdAt,id:second.at(-1).id},limit:2}),[]);
 await assert.rejects(store.list({limit:0}),/invalid node request limit/);
 await assert.rejects(store.insert({...record(5),extra:1}),/unknown node request field/);
 await assert.rejects(store.insert(record(1)),error=>error.status===409);
});

test('filters the list by status',async t=>{
 const {store}=sqlite(t);
 await store.insert(record(1,{status:'closed'}));await store.insert(record(2));await store.insert(record(3,{status:'contacted'}));await store.insert(record(4,{status:'closed'}));
 assert.deepEqual((await store.list({status:'closed',limit:10})).map(r=>r.id),[uuid(4),uuid(1)]);
 assert.deepEqual((await store.list({status:'new',limit:10})).map(r=>r.id),[uuid(2)]);
 assert.deepEqual((await store.list({status:'closed',after:{createdAt:record(4).createdAt,id:uuid(4)},limit:10})).map(r=>r.id),[uuid(1)]);
});

test('update is a compare-and-swap on version',async t=>{
 const {store,db}=sqlite(t),admin=createUser(db,{fullName:'Admin',email:'admin@example.test',passwordHash:'unused',role:'admin'});
 await store.insert(record(1));
 const done=await store.update(uuid(1),1,{status:'contacted',updatedAt:'2026-10-05T00:00:00.000Z',updatedBy:admin.id,version:2});
 assert.deepEqual([done.status,done.version,done.updatedBy,done.updatedAt],['contacted',2,admin.id,'2026-10-05T00:00:00.000Z']);
 assert.equal(await store.update(uuid(1),1,{status:'closed',version:2}),null,'stale version');
 assert.equal((await store.get(uuid(1))).status,'contacted','row unchanged');
 assert.equal(await store.update(uuid(9),1,{status:'closed',version:2}),null,'missing');
 await store.setEmailStatus(uuid(1),'sent');
 const after=await store.get(uuid(1));assert.deepEqual([after.emailStatus,after.version],['sent',2],'the email outcome keeps the version');
 db.prepare('DELETE FROM users WHERE id=?').run(admin.id);assert.equal((await store.get(uuid(1))).updatedBy,null,'a vanished administrator is cleared');
});

test('counts every request not marked off since a time, sends still in flight (null) included',async t=>{
 const {store}=sqlite(t);
 await store.insert(record(1,{emailStatus:'sent'}));await store.insert(record(2,{emailStatus:'off'}));await store.insert(record(3));
 await store.insert(record(4,{emailStatus:'uncertain'}));await store.insert(record(5,{emailStatus:'failed'}));await store.insert(record(6,{emailStatus:'partial'}));
 assert.equal(await store.countEmailedSince('2026-10-01T00:00:00.000Z'),5,'everything but off, the null of request 3 included');
 assert.equal(await store.countEmailedSince('2026-10-05T10:00:00.000Z'),2,'the boundary instant counts');
 assert.equal(await store.countEmailedSince('2026-11-01T00:00:00.000Z'),0);
});

test('purges only closed requests older than the cutoff',async t=>{
 const {store}=sqlite(t),cutoff='2026-10-10T00:00:00.000Z';
 await store.insert(record(1,{status:'closed',updatedAt:'2026-10-09T00:00:00.000Z'}));
 await store.insert(record(2,{status:'closed',updatedAt:cutoff}));
 await store.insert(record(3,{status:'closed',updatedAt:'2026-10-11T00:00:00.000Z'}));
 await store.insert(record(4,{status:'contacted',updatedAt:'2026-01-01T00:00:00.000Z'}));
 await store.insert(record(5,{updatedAt:'2026-01-01T00:00:00.000Z'}));
 assert.equal(await store.purgeClosedBefore(cutoff),1);
 assert.deepEqual((await store.list({limit:10})).map(r=>r.id).sort(),[uuid(2),uuid(3),uuid(4),uuid(5)]);
 assert.equal(await store.purgeClosedBefore(cutoff),0);
});

test('remove of a missing request is not an error',async t=>{
 const {store}=sqlite(t);await store.insert(record(1));
 assert.equal(await store.remove(uuid(1)),undefined);assert.equal(await store.get(uuid(1)),null);
 assert.equal(await store.remove(uuid(1)),undefined);
});

test('the CHECKs refuse an oversized message and an unknown status',async t=>{
 const {store}=sqlite(t);
 await assert.rejects(store.insert(record(1,{message:'x'.repeat(1001)})),/CHECK constraint/);
 await assert.rejects(store.insert(record(2,{message:''})),/CHECK constraint/);
 await assert.rejects(store.insert(record(3,{status:'archived'})),/CHECK constraint/);
 await assert.rejects(store.insert(record(4,{language:'fr'})),/CHECK constraint/);
 await assert.rejects(store.insert(record(5,{emailStatus:'maybe'})),/CHECK constraint/);
 await assert.rejects(store.insert(record(6,{name:'x'.repeat(121)})),/CHECK constraint/);
 assert.equal((await store.insert(record(7,{message:'x'.repeat(1000)}))).message.length,1000);
 await store.insert(record(8));await assert.rejects(store.update(uuid(8),1,{status:'archived',version:2}),/CHECK constraint/);
 assert.deepEqual(await store.list({limit:10}).then(rows=>rows.map(r=>r.id)),[uuid(8),uuid(7)]);
});

// In-memory PostgREST for node_requests: eq/lt/gte/neq/is/not.is leaves inside and()/or() trees, order, limit and exact
// counts, with timestamps printed the way PostgreSQL does (+00:00) and the table's own CHECKs for the status enum.
function postgrest(){
 const rows=[],calls=[],stamp=key=>key.endsWith('_at');
 const cmp=(key,a,b)=>a===b?0:a==null?-1:b==null?1:Math.sign(stamp(key)?Date.parse(a)-Date.parse(b):a<b?-1:1);
 const split=text=>{const out=[];let depth=0,start=0;for(let i=0;i<text.length;i++){if(text[i]==='(')depth++;else if(text[i]===')')depth--;else if(text[i]===','&&!depth){out.push(text.slice(start,i));start=i+1;}}return [...out,text.slice(start)];};
 const leaf=(row,key,expr)=>{
  if(expr==='is.null')return row[key]==null;
  if(expr==='not.is.null')return row[key]!=null;
  const [op,...rest]=expr.split('.'),value=rest.join('.'),actual=row[key]==null?null:String(row[key]);
  if(actual===null&&op!=='eq')return false;const c=cmp(key,actual,value);
  return op==='eq'?c===0:op==='neq'?c!==0:op==='lt'?c<0:op==='gte'?c>=0:assert.fail('unsupported filter '+expr);};
 const node=(row,text)=>{const m=/^(and|or)\((.*)\)$/.exec(text);if(m)return split(m[2])[m[1]==='and'?'every':'some'](part=>node(row,part));const [key,...expr]=text.split('.');return leaf(row,key,expr.join('.'));};
 const matches=(row,query)=>Object.entries(query).every(([key,expr])=>['select','order','limit'].includes(key)||(key==='or'||key==='and'?node(row,`${key}${expr}`):leaf(row,key,expr)));
 const sorter=order=>(a,b)=>{for(const part of order.split(',')){const [key,dir]=part.split('.'),c=cmp(key,a[key],b[key]);if(c)return dir==='desc'?-c:c;}return 0;};
 const pg=row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,stamp(k)&&v?new Date(v).toISOString().replace('Z','+00:00'):v]));
 const error=(code,message)=>Object.assign(Error(message),{status:409,expose:false,code});
 async function rest(table,options={}){
  assert.equal(table,'node_requests');calls.push(structuredClone(options));const query=options.query??{};
  if(query.offset!==undefined)assert.fail('never OFFSET');
  if(!options.method){
   const found=rows.filter(row=>matches(row,query)).sort(sorter(query.order??'id.asc')),page=found.slice(0,query.limit??Infinity).map(pg);
   return options.includeRange?{rows:page,contentRange:`${page.length?`0-${page.length-1}`:'*'}/${options.headers?.Prefer==='count=exact'?found.length:'*'}`}:page;
  }
  if(options.method==='POST'){
   const row=structuredClone(options.body);
   if(rows.some(r=>r.id===row.id))throw error('23505','duplicate key value violates unique constraint');
   if(!['new','contacted','closed'].includes(row.status))throw error('23514','violates check constraint');
   rows.push(row);return [pg(row)];
  }
  const hit=rows.filter(row=>matches(row,query));
  if(options.method==='PATCH'){hit.forEach(row=>Object.assign(row,structuredClone(options.body)));return hit.map(pg);}
  for(const row of hit)rows.splice(rows.indexOf(row),1);return hit.map(pg);
 }
 return {rows,calls,clients:{admin:{rest}}};
}
const snakeRow=r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),v]));
const pgStamp=iso=>iso.replace('Z','+00:00');

test('the Supabase store inserts, reads and pages node requests newest first by keyset',async()=>{
 const pg=postgrest(),store=createNodeRequestStore({clients:pg.clients});
 assert.equal(store.kind,'supabase');
 const saved=await store.insert(record(1));
 assert.deepEqual(saved,{...record(1),createdAt:pgStamp(record(1).createdAt),updatedAt:pgStamp(record(1).updatedAt)});
 assert.deepEqual(pg.calls.at(-1).body,snakeRow(record(1)));assert.equal(pg.calls.at(-1).method,'POST');assert.equal(pg.calls.at(-1).headers.Prefer,'return=representation');
 await assert.rejects(store.insert(record(1)),error=>error.status===409);
 await assert.rejects(store.insert(record(2,{status:'archived'})),error=>error.code==='23514');
 for(const n of [2,3,4])await store.insert(record(n,n===3?{status:'closed'}:{}));
 assert.equal((await store.get(uuid(2))).id,uuid(2));assert.equal(await store.get(uuid(9)),null);
 assert.deepEqual(pg.calls.at(-1).query,{select:'id,name,organization,email,phone,message,language,status,email_status,created_at,updated_at,updated_by,version',id:`eq.${uuid(9)}`,limit:1});
 const first=await store.list({limit:2});assert.deepEqual(first.map(r=>r.id),[uuid(4),uuid(3)]);
 assert.equal(pg.calls.at(-1).query.order,'created_at.desc,id.desc');assert.equal(pg.calls.at(-1).query.limit,2);assert.equal(pg.calls.at(-1).query.or,undefined);
 const second=await store.list({after:first.at(-1),limit:2});assert.deepEqual(second.map(r=>r.id),[uuid(2),uuid(1)]);
 assert.equal(pg.calls.at(-1).query.or,`(created_at.lt.${pgStamp(record(3).createdAt)},and(created_at.eq.${pgStamp(record(3).createdAt)},id.lt.${uuid(3)}))`);
 assert.deepEqual((await store.list({status:'closed',limit:5})).map(r=>r.id),[uuid(3)]);assert.equal(pg.calls.at(-1).query.status,'eq.closed');
 await assert.rejects(store.list({limit:101}),/invalid node request limit/);
});

test('the Supabase store updates on the version it loaded, records the email outcome, counts, purges and removes',async()=>{
 const pg=postgrest(),store=createNodeRequestStore({clients:pg.clients});
 await store.insert(record(1));
 assert.equal((await store.update(uuid(1),1,{status:'contacted',updatedAt:'2026-10-05T00:00:00.000Z',updatedBy:null,version:2})).status,'contacted');
 const patch=pg.calls.at(-1);assert.deepEqual(patch.query,{id:`eq.${uuid(1)}`,version:'eq.1'});assert.equal(patch.headers.Prefer,'return=representation');
 assert.deepEqual(patch.body,{status:'contacted',updated_at:'2026-10-05T00:00:00.000Z',updated_by:null,version:2});
 assert.equal(await store.update(uuid(1),1,{status:'closed',version:2}),null);assert.equal((await store.get(uuid(1))).status,'contacted');
 assert.equal(await store.setEmailStatus(uuid(1),'sent'),undefined);
 assert.deepEqual(pg.calls.at(-1).query,{id:`eq.${uuid(1)}`});assert.deepEqual(pg.calls.at(-1).body,{email_status:'sent'});assert.equal((await store.get(uuid(1))).version,2);
 await store.insert(record(2,{emailStatus:'off'}));await store.insert(record(3));await store.insert(record(4,{emailStatus:'failed'}));
 // Everything but off: request 3 (null, its send still in flight) counts; PostgreSQL's neq alone would drop the null.
 assert.equal(await store.countEmailedSince('2026-10-01T00:00:00.000Z'),3);
 const count=pg.calls.at(-1);assert.equal(count.headers.Prefer,'count=exact');assert.equal(count.query.created_at,'gte.2026-10-01T00:00:00.000Z');
 assert.equal(count.query.or,'(email_status.is.null,email_status.neq.off)');assert.equal(count.query.and,undefined);
 assert.equal(await store.countEmailedSince('2026-10-02T00:00:00.000Z'),2);assert.equal(await store.countEmailedSince('2026-11-01T00:00:00.000Z'),0);
 await store.insert(record(5,{status:'closed',updatedAt:'2026-01-01T00:00:00.000Z'}));await store.insert(record(6,{status:'closed',updatedAt:'2026-10-20T00:00:00.000Z'}));await store.insert(record(7,{updatedAt:'2026-01-01T00:00:00.000Z'}));
 assert.equal(await store.purgeClosedBefore('2026-06-01T00:00:00.000Z'),1);
 assert.deepEqual(pg.calls.at(-1).query,{status:'eq.closed',updated_at:'lt.2026-06-01T00:00:00.000Z'});assert.equal(pg.calls.at(-1).method,'DELETE');
 assert.deepEqual(pg.rows.map(r=>r.id).sort(),[1,2,3,4,6,7].map(uuid));
 assert.equal(await store.remove(uuid(1)),undefined);assert.deepEqual(pg.calls.at(-1).query,{id:`eq.${uuid(1)}`});assert.equal(await store.remove(uuid(1)),undefined);
 const broken=createNodeRequestStore({clients:{admin:{async rest(){return {};}}}});
 for(const call of [()=>broken.get(uuid(1)),()=>broken.list({limit:2}),()=>broken.update(uuid(1),1,{version:2}),()=>broken.setEmailStatus(uuid(1),'sent'),()=>broken.countEmailedSince('x'),()=>broken.remove(uuid(1)),()=>broken.purgeClosedBefore('x'),()=>broken.insert(record(1))])
  await assert.rejects(call(),error=>error.status===502);
});

test('the node_requests migration is server-only, additive and documented',()=>{
 const dir=new URL('../supabase/migrations/',import.meta.url),names=readdirSync(dir).sort(),name='20261103000000_node_requests.sql';
 assert.ok(names.includes(name));assert.ok(name>'20261023000000_founder_badge.sql','sorts after the founder badge');
 const raw=readFileSync(new URL(name,dir),'utf8');
 assert.match(raw,/npx --no-install supabase db query --linked -f supabase\/migrations\/20261103000000_node_requests\.sql/);
 assert.match(raw,/supabase migration repair --status applied 20261103000000/);
 assert.match(raw,/Never `db push`/);assert.match(raw,/BEFORE pushing `main`/);
 const header=raw.slice(0,raw.indexOf('BEGIN;'));
 for(const where of ['POST /api/node-requests','Nodos band'])assert.ok(header.includes(where),where);
 assert.match(header,/POST \/api\/node-requests answers 503/,'the POST failure status is promised next to the route');
 const statements=raw.replace(/--[^\n]*/g,'').split(';').map(part=>part.replace(/\s+/g,' ').trim()).filter(Boolean);
 assert.equal(statements[0],'BEGIN');assert.equal(statements.at(-1),'COMMIT');
 const table=statements.find(s=>/^CREATE TABLE public\.node_requests /i.test(s));assert.ok(table,'the table');
 for(const part of ['id uuid PRIMARY KEY DEFAULT gen_random_uuid()','name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 120)','organization text NOT NULL CHECK(char_length(organization) BETWEEN 1 AND 160)',
  'email text NOT NULL CHECK(char_length(email)<=254)','phone text CHECK(phone IS NULL OR char_length(phone)<=40)','message text NOT NULL CHECK(char_length(message) BETWEEN 1 AND 1000)',
  "language text NOT NULL CHECK(language IN ('es','en','pt'))","status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','closed'))",
  "email_status text CHECK(email_status IS NULL OR email_status IN ('sent','partial','failed','uncertain','off'))",'created_at timestamptz NOT NULL DEFAULT now()','updated_at timestamptz NOT NULL DEFAULT now()',
  'updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL','version integer NOT NULL DEFAULT 1 CHECK(version>0)'])assert.ok(table.includes(part),part);
 assert.ok(statements.includes('CREATE INDEX node_requests_recent ON public.node_requests(created_at DESC,id DESC)'));
 assert.ok(statements.includes('CREATE INDEX node_requests_status ON public.node_requests(status,created_at DESC,id DESC)'));
 assert.ok(statements.some(s=>/^CREATE TRIGGER \w+ BEFORE UPDATE ON public\.node_requests FOR EACH ROW EXECUTE FUNCTION public\.set_updated_at\(\)$/.test(s)),'set_updated_at trigger');
 assert.ok(statements.includes('ALTER TABLE public.node_requests ENABLE ROW LEVEL SECURITY'));
 assert.ok(statements.includes('REVOKE ALL ON TABLE public.node_requests FROM PUBLIC,anon,authenticated,service_role'));
 assert.ok(statements.includes('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.node_requests TO service_role'));
 assert.ok(!statements.some(s=>/^CREATE POLICY/i.test(s)),'no client policy');
 assert.equal(statements.length,10,'nothing else');
});
