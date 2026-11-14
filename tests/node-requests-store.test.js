import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createDatabase,createUser} from '../server/db.js';
import {createNodeRequestStore,NODE_REQUEST_FIELDS} from '../server/node-requests-repository.js';
import {nodeRequestsPostgrest as postgrest,pgStamp} from './helpers/node-requests-postgrest.js';

const uuid=n=>`${n}0000000-0000-4000-8000-000000000000`;
const record=(n,over={})=>({id:uuid(n),kind:'node',name:'Ana',organization:'Colectivo '+n,email:'ana@example.test',phone:null,community:null,memberships:null,message:'Hola',language:'es',status:'new',emailStatus:null,
 createdAt:`2026-10-${String(n).padStart(2,'0')}T10:00:00.000Z`,updatedAt:`2026-10-${String(n).padStart(2,'0')}T10:00:00.000Z`,updatedBy:null,version:1,...over});
const sqlite=t=>{const db=createDatabase({filename:':memory:'});t.after(()=>db.close());return {db,store:createNodeRequestStore({db})};};

test('stores, reads and lists node requests newest first, by page',async t=>{
 const {store}=sqlite(t);
 assert.deepEqual(NODE_REQUEST_FIELDS,['id','kind','name','organization','email','phone','community','memberships','message','language','status','emailStatus','createdAt','updatedAt','updatedBy','version']);
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

const snakeRow=r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),v]));

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
 assert.deepEqual(pg.calls.at(-1).query,{select:'id,kind,name,organization,email,phone,community,memberships,message,language,status,email_status,created_at,updated_at,updated_by,version',id:`eq.${uuid(9)}`,limit:1});
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
 // The writes that need no row back ask for the id only: no name, address or message on the wire.
 assert.deepEqual(pg.calls.at(-1).query,{select:'id',id:`eq.${uuid(1)}`});assert.equal(pg.calls.at(-1).headers.Prefer,'return=representation');assert.deepEqual(pg.calls.at(-1).body,{email_status:'sent'});assert.equal((await store.get(uuid(1))).version,2);
 await store.insert(record(2,{emailStatus:'off'}));await store.insert(record(3));await store.insert(record(4,{emailStatus:'failed'}));
 // Everything but off: request 3 (null, its send still in flight) counts; PostgreSQL's neq alone would drop the null.
 assert.equal(await store.countEmailedSince('2026-10-01T00:00:00.000Z'),3);
 const count=pg.calls.at(-1);assert.equal(count.headers.Prefer,'count=exact');assert.equal(count.query.created_at,'gte.2026-10-01T00:00:00.000Z');
 assert.equal(count.query.or,'(email_status.is.null,email_status.neq.off)');assert.equal(count.query.and,undefined);
 assert.equal(await store.countEmailedSince('2026-10-02T00:00:00.000Z'),2);assert.equal(await store.countEmailedSince('2026-11-01T00:00:00.000Z'),0);
 await store.insert(record(5,{status:'closed',updatedAt:'2026-01-01T00:00:00.000Z'}));await store.insert(record(6,{status:'closed',updatedAt:'2026-10-20T00:00:00.000Z'}));await store.insert(record(7,{updatedAt:'2026-01-01T00:00:00.000Z'}));
 assert.equal(await store.purgeClosedBefore('2026-06-01T00:00:00.000Z'),1);
 assert.deepEqual(pg.calls.at(-1).query,{select:'id',status:'eq.closed',updated_at:'lt.2026-06-01T00:00:00.000Z'});assert.equal(pg.calls.at(-1).method,'DELETE');
 assert.deepEqual(pg.rows.map(r=>r.id).sort(),[1,2,3,4,6,7].map(uuid));
 assert.equal(await store.remove(uuid(1)),undefined);assert.deepEqual(pg.calls.at(-1).query,{select:'id',id:`eq.${uuid(1)}`});assert.equal(await store.remove(uuid(1)),undefined);
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
 // Only an admin change restarts the purge clock: not the email outcome, nor ON DELETE SET NULL of updated_by.
 assert.ok(statements.includes('CREATE TRIGGER node_requests_updated_at BEFORE UPDATE OF status, version ON public.node_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()'),'set_updated_at trigger');
 assert.ok(statements.includes('ALTER TABLE public.node_requests ENABLE ROW LEVEL SECURITY'));
 assert.ok(statements.includes('REVOKE ALL ON TABLE public.node_requests FROM PUBLIC,anon,authenticated,service_role'));
 assert.ok(statements.includes('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.node_requests TO service_role'));
 assert.ok(!statements.some(s=>/^CREATE POLICY/i.test(s)),'no client policy');
 assert.equal(statements.length,10,'nothing else');
});

// Sponsorship requests (spec: docs/superpowers/specs/2026-11-09-sponsored-memberships-design.md, "Storage").
const sponsor=(n,over={})=>record(n,{kind:'sponsorship',community:'Ciclistas de Lima',memberships:'11-25',...over});

test('rows written without kind are Nodo rows',async t=>{
 const {db,store}=sqlite(t);
 // What the code live before this release inserts: none of the new columns.
 db.prepare('INSERT INTO node_requests (id,name,organization,email,message,language,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
  .run(uuid(1),'Ana','Colectivo','ana@example.test','Hola','es','2026-10-01T10:00:00.000Z','2026-10-01T10:00:00.000Z');
 const row=await store.get(uuid(1));
 assert.deepEqual([row.kind,row.community,row.memberships],['node',null,null]);
});

test('stores a sponsorship and refuses a mixed row',async t=>{
 const {store}=sqlite(t);
 assert.deepEqual(await store.insert(sponsor(1)),sponsor(1));
 for(const code of ['1-10','26-50','50+','unsure'])assert.equal((await store.insert(sponsor(2+['1-10','26-50','50+','unsure'].indexOf(code),{memberships:code}))).memberships,code);
 assert.equal((await store.insert(sponsor(6,{community:'x'.repeat(200)}))).community.length,200);
 await assert.rejects(store.insert(record(7,{community:'Ciclistas'})),/CHECK constraint/,'a Nodo row with a community');
 await assert.rejects(store.insert(record(8,{memberships:'1-10'})),/CHECK constraint/,'a Nodo row with a range');
 await assert.rejects(store.insert(sponsor(9,{memberships:null})),/CHECK constraint/,'a sponsorship without a range');
 await assert.rejects(store.insert(sponsor(10,{community:null})),/CHECK constraint/,'a sponsorship without a community');
 await assert.rejects(store.insert(sponsor(11,{community:''})),/CHECK constraint/);
 await assert.rejects(store.insert(sponsor(12,{memberships:'5'})),/CHECK constraint/);
 await assert.rejects(store.insert(sponsor(13,{community:'x'.repeat(201)})),/CHECK constraint/);
 await assert.rejects(store.insert(record(14,{kind:'patrocinio'})),/CHECK constraint/);
});

test('filters by kind and status together, by page',async t=>{
 const {store}=sqlite(t);
 await store.insert(sponsor(1));await store.insert(record(2));await store.insert(sponsor(3,{status:'closed'}));await store.insert(sponsor(4));await store.insert(record(5));
 assert.deepEqual((await store.list({kind:'node',limit:10})).map(r=>r.id),[uuid(5),uuid(2)]);
 const first=await store.list({kind:'sponsorship',status:'new',limit:1});assert.deepEqual(first.map(r=>r.id),[uuid(4)]);
 const next=await store.list({kind:'sponsorship',status:'new',after:first.at(-1),limit:1});assert.deepEqual(next.map(r=>r.id),[uuid(1)]);
 assert.deepEqual(await store.list({kind:'sponsorship',status:'new',after:next.at(-1),limit:1}),[]);
 const pg=postgrest(),remote=createNodeRequestStore({clients:pg.clients});
 for(const row of [sponsor(1),record(2),sponsor(3,{status:'closed'})])await remote.insert(row);
 assert.deepEqual((await remote.list({kind:'sponsorship',status:'new',limit:5})).map(r=>r.id),[uuid(1)]);
 assert.equal(pg.calls.at(-1).query.kind,'eq.sponsorship');assert.equal(pg.calls.at(-1).query.status,'eq.new');
 assert.equal((await remote.list({limit:5}),pg.calls.at(-1).query.kind),undefined,'no kind, no filter');
});

test('the fake PostgREST fills the defaults and refuses an unknown kind, as PostgreSQL does',async()=>{
 const pg=postgrest(),store=createNodeRequestStore({clients:pg.clients});
 await assert.rejects(store.insert(record(1,{kind:'patrocinio'})),error=>error.code==='23514');
 const {kind,community,memberships,...old}=record(2);
 await pg.clients.admin.rest('node_requests',{method:'POST',body:snakeRow(old)});
 const row=await store.get(uuid(2));assert.deepEqual([row.kind,row.community,row.memberships],['node',null,null]);
});

test('upgrades an existing local table in place',async t=>{
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 // NODE_REQUESTS_SQLITE_SCHEMA as released on 4 November 2026, before requests had a kind.
 db.exec(`CREATE TABLE IF NOT EXISTS node_requests (
 id TEXT PRIMARY KEY,name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),organization TEXT NOT NULL CHECK(length(organization) BETWEEN 1 AND 160),
 email TEXT NOT NULL CHECK(length(email)<=254),phone TEXT CHECK(phone IS NULL OR length(phone)<=40),message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 1000),
 language TEXT NOT NULL CHECK(language IN ('es','en','pt')),status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','closed')),
 email_status TEXT CHECK(email_status IS NULL OR email_status IN ('sent','partial','failed','uncertain','off')),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0)
);`);
 db.prepare('INSERT INTO node_requests (id,name,organization,email,message,language,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
  .run(uuid(1),'Ana','Colectivo','ana@example.test','Hola','es','2026-10-01T10:00:00.000Z','2026-10-01T10:00:00.000Z');
 const store=createNodeRequestStore({db});
 const old=await store.get(uuid(1));assert.deepEqual([old.kind,old.community,old.memberships],['node',null,null]);
 assert.deepEqual(await store.insert(sponsor(2)),sponsor(2));
 await assert.rejects(store.insert(record(3,{community:'Ciclistas'})),/CHECK constraint/,'the tying check holds on an upgraded table');
 await assert.rejects(store.insert(sponsor(4,{memberships:'5'})),/CHECK constraint/);
 assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='node_requests_kind'").get(),'the kind index');
 // A second store on the same database changes nothing.
 assert.equal((await createNodeRequestStore({db}).get(uuid(2))).kind,'sponsorship');
});

test('the node_request_kinds migration is additive, server-only and documented',()=>{
 const dir=new URL('../supabase/migrations/',import.meta.url),names=readdirSync(dir).sort(),name='20261109000000_node_request_kinds.sql';
 assert.ok(names.includes(name));assert.ok(name>'20261103000000_node_requests.sql');
 const raw=readFileSync(new URL(name,dir),'utf8'),header=raw.slice(0,raw.indexOf('BEGIN;'));
 assert.match(header,/npx --no-install supabase db query --linked -f supabase\/migrations\/20261109000000_node_request_kinds\.sql/);
 assert.match(header,/supabase migration repair --status applied 20261109000000/);
 assert.match(header,/Never `db push`/);assert.match(header,/BEFORE pushing `main`/);
 assert.match(header,/POST \/api\/node-requests answers 503/);assert.ok(header.includes('band fails to load'));
 const statements=raw.replace(/--[^\n]*/g,'').split(';').map(part=>part.replace(/\s+/g,' ').trim()).filter(Boolean);
 assert.deepEqual(statements,['BEGIN',
  "ALTER TABLE public.node_requests ADD COLUMN kind text NOT NULL DEFAULT 'node' CHECK(kind IN ('node','sponsorship')), ADD COLUMN community text, ADD COLUMN memberships text, "+
  "ADD CONSTRAINT node_requests_kind_fields CHECK((kind='node' AND community IS NULL AND memberships IS NULL) OR (kind='sponsorship' AND community IS NOT NULL AND memberships IS NOT NULL AND char_length(community) BETWEEN 1 AND 200 AND memberships IN ('1-10','11-25','26-50','50+','unsure')))",
  'CREATE INDEX node_requests_kind ON public.node_requests(kind,created_at DESC,id DESC)','COMMIT']);
});
