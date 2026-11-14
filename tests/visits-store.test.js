import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createDatabase} from '../server/db.js';
import {createVisitStore,VISIT_COUNTS_SQLITE_SCHEMA,VISIT_WRITE_MS} from '../server/visits-repository.js';

const HIT={day:'2026-11-14',page:'index.html',arrival:true,source:'search'},VIEW={...HIT,arrival:false,source:''};
const rows=db=>db.prepare('SELECT day,kind,page,source,n FROM visit_counts ORDER BY kind DESC,page,source').all().map(Object.values);
const sqlite=t=>{const db=createDatabase({filename:':memory:'});t.after(()=>db.close());return {db,store:createVisitStore({db})};};
const dir=new URL('../supabase/migrations/',import.meta.url),name='20261114000000_visit_counts.sql';

test('counts a view and, for an arrival, its source, adding to the same daily rows',async t=>{
 const {db,store}=sqlite(t);
 await store.count(HIT);await store.count(HIT);await store.count(VIEW);
 assert.deepEqual(rows(db),[['2026-11-14','view','index.html','',3],['2026-11-14','arrival','index.html','search',2]]);
 assert.equal(store.kind,'sqlite');
 assert.equal(VISIT_WRITE_MS,2000);assert.equal(typeof VISIT_COUNTS_SQLITE_SCHEMA,'string');
});

test('totals gives every day of the table, and pages and sources for the range',async t=>{
 const {store}=sqlite(t),empty=createDatabase({filename:':memory:'});t.after(()=>empty.close());
 // 13 Nov: index 1 arrival (direct); 14 Nov: index 2 arrivals (search), fundadores 1 view; 1 Oct: index 1 arrival (qr)
 await store.count({day:'2026-11-13',page:'index.html',arrival:true,source:'direct'});
 await store.count(HIT);await store.count(HIT);
 await store.count({...VIEW,page:'fundadores.html'});
 await store.count({day:'2026-10-01',page:'index.html',arrival:true,source:'qr'});
 assert.deepEqual(await store.totals('2026-11-13','2026-11-14'),{v:1,
  days:[['2026-10-01',1,1],['2026-11-13',1,1],['2026-11-14',3,2]],
  pages:{'index.html':3,'fundadores.html':1},sources:{direct:1,search:2}});
 assert.deepEqual(await createVisitStore({db:empty}).totals('2026-11-13','2026-11-14'),{v:1,days:[],pages:{},sources:{}});
});

test('the local table refuses what the production table refuses',t=>{
 const {db}=sqlite(t),ins=db.prepare('INSERT INTO visit_counts (day,kind,page,source,n) VALUES (?,?,?,?,?)');
 ins.run('2026-11-14','view','index.html','',1);
 for(const args of [['2026-11-14','view','index.html','x',0],['2026-11-14','click','index.html','',1],['2026-11-14','view','','',1],
  ['2026-11-14','view','p'.repeat(81),'',1],['2026-11-14','arrival','index.html','s'.repeat(21),1]])assert.throws(()=>ins.run(...args),/CHECK constraint/,args.join('|'));
});

test('on Supabase each method is one rpc call and the table is never read',async()=>{
 const calls=[],answer={v:1,days:[['2026-11-14',3,2]],pages:{'index.html':3},sources:{search:2}};let reply=answer;
 const clients={admin:{async rest(path,{method,body,signal}={}){calls.push({path,method,body,signal});return path==='rpc/visit_totals'?reply:null;}}};
 const store=createVisitStore({clients});
 assert.equal(store.kind,'supabase');
 await store.count(HIT);
 assert.deepEqual([calls[0].path,calls[0].method,calls[0].body],['rpc/count_visit','POST',{p_hit:HIT}]);
 assert.ok(calls[0].signal instanceof AbortSignal,'its own 2-second limit, not the client default of 15');
 assert.deepEqual(await store.totals('2026-11-01','2026-11-14'),answer);
 assert.deepEqual(calls.slice(1).map(c=>[c.path,c.method,c.body]),[['rpc/visit_totals','POST',{p_range:{from:'2026-11-01',to:'2026-11-14'}}]]);
 assert.ok(calls.every(c=>!c.path.startsWith('visit_counts')));
 for(const bad of [null,{...answer,v:2},{...answer,days:{}},{...answer,pages:[]},{...answer,sources:null},{...answer,pages:'x'}]){
  reply=bad;await assert.rejects(store.totals('2026-11-01','2026-11-14'),e=>e.status===502&&/visit totals unavailable/.test(e.message));
 }
});

const raw=()=>readFileSync(new URL(name,dir),'utf8');
const statementsOf=text=>text.replace(/--[^\n]*/g,'').split(/;\s*(?:\n|$)/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);

test('the visit_counts migration is one transaction, server-only and documented',()=>{
 const names=readdirSync(dir).sort();
 assert.ok(names.includes(name));assert.ok(name>'20261109000000_node_request_kinds.sql');
 const text=raw(),header=text.slice(0,text.indexOf('BEGIN;'));
 assert.match(header,/npx --no-install supabase db query --linked -f supabase\/migrations\/20261114000000_visit_counts\.sql/);
 assert.match(header,/supabase migration repair --status applied 20261114000000/);
 assert.match(header,/Never `db push`/);assert.match(header,/BEFORE pushing `main`/);
 assert.ok(header.includes('POST /api/visit answers 204 and counts nothing'));
 const statements=statementsOf(text);
 assert.equal(statements[0],'BEGIN');assert.equal(statements.at(-1),'COMMIT');
 assert.ok(text.includes('CREATE TABLE public.visit_counts'));
 assert.ok(text.includes('ALTER TABLE public.visit_counts ENABLE ROW LEVEL SECURITY'));
 assert.ok(!/CREATE POLICY/i.test(text));
 for(const fn of ['count_visit','visit_totals']){
  const def=statements.find(s=>s.startsWith(`CREATE FUNCTION public.${fn}(`));assert.ok(def,fn);
  assert.ok(def.includes('SECURITY INVOKER'),fn);assert.ok(def.includes("SET search_path = ''"),fn);
  assert.ok(def.includes(fn==='count_visit'?'VOLATILE':'STABLE'),fn);
 }
 assert.ok(!/SECURITY DEFINER/i.test(text));assert.ok(!/auth\./.test(text.replace(/--[^\n]*/g,'')));
});

const allStatements=readdirSync(dir).filter(n=>n.endsWith('.sql')).sort()
 .flatMap(n=>readFileSync(new URL(n,dir),'utf8').replace(/--[^\n]*/g,'').split(';').map(part=>part.replace(/\s+/g,' ').trim()).filter(Boolean));
const list=text=>text.split(',').map(item=>item.trim().toLowerCase());
function stateFor(kind,object,role){
 let state='default';
 for(const statement of allStatements){
  const revoke=statement.match(new RegExp(`^revoke (?:all(?: privileges)?|[a-z, ]+) on (?:${kind} )?(.+?) from (.+)$`,'i'));
  const grant=statement.match(new RegExp(`^grant (.+?) on (?:${kind} )?(.+?) to (.+)$`,'i'));
  if(revoke&&list(revoke[1]).includes(object)&&list(revoke[2]).some(r=>r===role||r==='public'))state=/^revoke all/i.test(statement)?'revoked':'partial';
  else if(grant&&list(grant[2]).includes(object)&&list(grant[3]).includes(role))state='granted';
 }
 return state;
}

test('grants: the browser roles hold nothing, the server exactly what it uses',()=>{
 for(const role of ['anon','authenticated']){
  assert.equal(stateFor('table','public.visit_counts',role),'revoked',`table ${role}`);
  for(const fn of ['public.count_visit(jsonb)','public.visit_totals(jsonb)'])assert.equal(stateFor('function',fn,role),'revoked',`${fn} ${role}`);
 }
 assert.equal(stateFor('table','public.visit_counts','service_role'),'granted');
 for(const fn of ['public.count_visit(jsonb)','public.visit_totals(jsonb)'])assert.equal(stateFor('function',fn,'service_role'),'granted',fn);
 const own=statementsOf(raw());
 assert.ok(own.includes('GRANT SELECT, INSERT, UPDATE ON TABLE public.visit_counts TO service_role'));
 assert.ok(!own.some(s=>/^GRANT /i.test(s)&&/visit_counts/.test(s)&&/DELETE|TRUNCATE/i.test(s)),'no DELETE or TRUNCATE');
});

test('DEPLOYMENT.md applies the visit_counts migration before main, outside the Founder sections',()=>{
 const deployment=readFileSync(new URL('../DEPLOYMENT.md',import.meta.url),'utf8');
 const start=deployment.indexOf('## Visit counter: one migration before `main`');assert.ok(start>0);
 const end=deployment.indexOf('\n## ',start+1),step=deployment.slice(start,end);
 for(const [from,to] of [['## Founder Membership acceptances','## Founder badge'],['## Founder badge','## Supabase Setup']]){
  const a=deployment.indexOf(from),b=deployment.indexOf(to);assert.ok(start<a||start>=b,`outside ${from}`);
 }
 assert.ok(step.includes('npx --no-install supabase db query --linked -f supabase/migrations/20261114000000_visit_counts.sql'));
 assert.ok(step.includes('npx --no-install supabase migration repair --status applied 20261114000000'));
 assert.match(step,/before pushing `main`/);assert.ok(step.includes('/api/visit'));
 assert.ok(step.includes('docs/ops/2026-11-14-visit-counts-check.sql'));
});

test('the ops files: one read-only check, and a correction that fails until a day is typed',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const strip=sql=>sql.replace(/--[^\n]*/g,'').split(';').map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
 const check=strip(read('docs/ops/2026-11-14-visit-counts-check.sql'));
 assert.equal(check.length,1);assert.match(check[0],/^select /i);
 assert.doesNotMatch(check[0].replace(/'[^']*'/g,"''"),/\b(insert|update|delete|truncate|alter|drop|grant|revoke|create)\b/i);   // quoted text emptied first: the privilege names below are literals, not statements
 for(const alias of ['rls_on','browser_grants','functions_invoker','functions_closed','migration_row','last_7_days'])assert.match(check[0],new RegExp(` as ${alias}\\b`));
 assert.match(read('docs/ops/2026-11-14-visit-counts-check.sql'),/npx --no-install supabase db query --linked -f docs\/ops\/2026-11-14-visit-counts-check\.sql/);
 const correct=strip(read('docs/ops/2026-11-14-visit-counts-correct.sql'));
 assert.equal(correct.length,1);assert.ok(correct[0].includes("'<YYYY-MM-DD>'::date"),'fails on the cast until edited');
 assert.match(correct[0],/^delete from public\.visit_counts where day = /i);assert.match(correct[0],/ returning /i);
});
