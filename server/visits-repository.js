import {createSupabaseClients} from './supabase.js';
import {fail} from './courses-domain.js';

// Daily visit totals (spec: docs/superpowers/specs/2026-11-14-admin-front-door-metrics-design.md, "R1. Visit counter"):
// per Lima day, kind, page key and source, never a visitor. The CHECKs repeat the production table's, which
// supabase/migrations/20261114000000_visit_counts.sql declares.
export const VISIT_COUNTS_SQLITE_SCHEMA=`
CREATE TABLE IF NOT EXISTS visit_counts (
 day TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('view','arrival')),
 page TEXT NOT NULL CHECK(length(page) BETWEEN 1 AND 80),
 source TEXT NOT NULL CHECK(length(source)<=20),
 n INTEGER NOT NULL CHECK(n>0),PRIMARY KEY(day,kind,page,source)
);
`;
// The one place the 2-second write limit is written: the Supabase request aborts on it (the client would otherwise hold
// the socket 15 s) and the visit route's timer defaults to it.
export const VISIT_WRITE_MS=2000;
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function createVisitStore({db,env=process.env,clients,fetchImpl=fetch}={}){
 if(db)db.exec(VISIT_COUNTS_SQLITE_SCHEMA);
 const supa=db?null:clients??createSupabaseClients({env,fetchImpl});
 const bump=db?db.prepare("INSERT INTO visit_counts (day,kind,page,source,n) VALUES (?,?,?,?,1) ON CONFLICT(day,kind,page,source) DO UPDATE SET n=n+1"):null;
 return {
  kind:db?'sqlite':'supabase',
  async count(hit){
   if(db){
    db.exec('BEGIN');
    try{
     bump.run(hit.day,'view',hit.page,'');
     if(hit.arrival)bump.run(hit.day,'arrival',hit.page,hit.source);
     db.exec('COMMIT');
    }catch(err){db.exec('ROLLBACK');throw err;}
    return;
   }
   await supa.admin.rest('rpc/count_visit',{method:'POST',body:{p_hit:hit},signal:AbortSignal.timeout(VISIT_WRITE_MS)});
  },
  async totals(fromDay,toDay){
   if(db){
    const days=db.prepare("SELECT day,sum(CASE WHEN kind='view' THEN n ELSE 0 END) AS views,sum(CASE WHEN kind='arrival' THEN n ELSE 0 END) AS arrivals FROM visit_counts GROUP BY day ORDER BY day").all().map(r=>[r.day,r.views,r.arrivals]);
    const tally=(kind,column)=>Object.fromEntries(db.prepare(`SELECT ${column} AS k,sum(n) AS n FROM visit_counts WHERE kind=? AND day BETWEEN ? AND ? GROUP BY ${column} ORDER BY n DESC,${column}`).all(kind,fromDay,toDay).map(r=>[r.k,r.n]));
    return {v:1,days,pages:tally('view','page'),sources:tally('arrival','source')};
   }
   const answer=await supa.admin.rest('rpc/visit_totals',{method:'POST',body:{p_range:{from:fromDay,to:toDay}}});
   if(!plain(answer)||answer.v!==1||!Array.isArray(answer.days)||!plain(answer.pages)||!plain(answer.sources))fail('visit totals unavailable',502);
   return answer;
  }
 };
}
