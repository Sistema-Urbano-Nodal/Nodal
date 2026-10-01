import {createSupabaseClients} from './supabase.js';
import {fail} from './courses-domain.js';
import {snake} from './courses-schema.js';

// NODAL-wide news. The CHECKs repeat the API's limits so a bug there cannot store what the desk would reject;
// supabase/migrations/*_nodal_news.sql declares the same table for production.
export const NEWS_SQLITE_SCHEMA=`
CREATE TABLE IF NOT EXISTS nodal_news (
 id TEXT PRIMARY KEY,title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),body TEXT NOT NULL CHECK(length(body)<=2000),
 url TEXT NOT NULL CHECK(url='' OR (substr(url,1,8)='https://' AND length(url)<=500)),
 status TEXT NOT NULL CHECK(status IN ('draft','published')),pinned INTEGER NOT NULL CHECK(pinned IN (0,1)),
 published_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 version INTEGER NOT NULL CHECK(version>0),CHECK(status='draft' OR published_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS nodal_news_public ON nodal_news(status,pinned DESC,published_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS nodal_news_recent ON nodal_news(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS nodal_news_created_by ON nodal_news(created_by);
`;
export const NEWS_FIELDS=['id','title','body','url','status','pinned','publishedAt','createdAt','updatedAt','createdBy','version'];
const checked=record=>{for(const k of Object.keys(record))if(!NEWS_FIELDS.includes(k))throw Error('unknown news field');return record;};
const from=row=>row?Object.fromEntries(NEWS_FIELDS.map(k=>[k,k==='pinned'?Boolean(row.pinned):row[snake(k)]??null])):null;
const to=(record,sqlite)=>Object.fromEntries(Object.entries(checked(record)).map(([k,v])=>[snake(k),sqlite&&typeof v==='boolean'?Number(v):v]));
// A reused id is a conflict the API resolves as an idempotent retry; a vanished author (account erased mid-request) is a 404.
const conflict=err=>{if(err.code==='23505'||/UNIQUE constraint/.test(err.message))fail('news item already exists',409);if(err.code==='23503'||/FOREIGN KEY constraint/.test(err.message))fail('related record unavailable',404);throw err;};
const SELECT=NEWS_FIELDS.map(snake).join(',');
// The public feed reads pinned items first, then the newest publication; the desk reads the newest written first.
// `after` is the last row of the previous page ({pinned,publishedAt,id} or {createdAt,id}); the API validates it.
export function createNewsStore({db,env=process.env,clients,fetchImpl=fetch}={}){
 if(db)db.exec(NEWS_SQLITE_SCHEMA);
 const supa=db?null:clients??createSupabaseClients({env,fetchImpl});
 const keyset=(published,{pinned,publishedAt,createdAt,id})=>!published?{or:`(created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id}))`}
  :pinned?{or:`(pinned.eq.false,and(pinned.eq.true,published_at.lt.${publishedAt}),and(pinned.eq.true,published_at.eq.${publishedAt},id.lt.${id}))`}
  :{pinned:'eq.false',or:`(published_at.lt.${publishedAt},and(published_at.eq.${publishedAt},id.lt.${id}))`};
 return {
  kind:db?'sqlite':'supabase',
  async list({published=false,after=null,limit=10}={}){
   if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('invalid news limit');
   if(db){
    const parts=published?["status='published'"]:[],params=[];
    if(after&&published){parts.push('(pinned<? OR (pinned=? AND (published_at<? OR (published_at=? AND id<?))))');params.push(+after.pinned,+after.pinned,after.publishedAt,after.publishedAt,after.id);}
    else if(after){parts.push('(created_at<? OR (created_at=? AND id<?))');params.push(after.createdAt,after.createdAt,after.id);}
    return db.prepare(`SELECT * FROM nodal_news${parts.length?' WHERE '+parts.join(' AND '):''} ORDER BY ${published?'pinned DESC,published_at DESC':'created_at DESC'},id DESC LIMIT ?`).all(...params,limit).map(from);
   }
   const query={select:SELECT,order:published?'pinned.desc,published_at.desc,id.desc':'created_at.desc,id.desc',...(published?{status:'eq.published'}:{})};
   // Fill a logical page across a smaller provider row cap, as the festival store does: each follow-up continues from
   // the last row (keyset, never OFFSET) and is sent only when the exact count says the short page was capped.
   const rows=[];let cursor=after?keyset(published,after):{};
   while(rows.length<limit){
    const want=limit-rows.length,page=await supa.admin.rest('nodal_news',{query:{...query,...cursor,limit:want},includeRange:true,...(want>1?{headers:{Prefer:'count=exact'}}:{})});
    if(!Array.isArray(page?.rows))fail('news unavailable',502);rows.push(...page.rows.map(from));
    if(page.rows.length===want||!page.rows.length||page.rows.length>=Number(page.contentRange?.split('/')[1]))break;
    cursor=keyset(published,rows.at(-1));
   }
   return rows;
  },
  async get(id){
   if(db)return from(db.prepare('SELECT * FROM nodal_news WHERE id=?').get(id));
   const rows=await supa.admin.rest('nodal_news',{query:{select:SELECT,id:`eq.${id}`,limit:1}});
   if(!Array.isArray(rows))fail('news unavailable',502);return from(rows[0]);
  },
  async insert(record){const row=to(record,!!db),keys=Object.keys(row);try{
   if(db)return from(db.prepare(`INSERT INTO nodal_news (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')}) RETURNING *`).get(...Object.values(row)));
   const result=await supa.admin.rest('nodal_news',{method:'POST',headers:{Prefer:'return=representation'},body:row});if(!result?.[0])fail('news save unavailable',502);return from(result[0]);
  }catch(err){conflict(err);}},
  // Conditional on the version the editor loaded; null means another save (or a deletion) won.
  async update(id,version,patch){const row=to(patch,!!db);
   if(db)return from(db.prepare(`UPDATE nodal_news SET ${Object.keys(row).map(k=>`${k}=?`).join(',')} WHERE id=? AND version=? RETURNING *`).get(...Object.values(row),id,version));
   const result=await supa.admin.rest('nodal_news',{method:'PATCH',query:{id:`eq.${id}`,version:`eq.${version}`},headers:{Prefer:'return=representation'},body:row});
   if(!Array.isArray(result))fail('news save unavailable',502);return from(result[0]);
  },
  async remove(id){
   if(db)return db.prepare('DELETE FROM nodal_news WHERE id=?').run(id).changes;
   const deleted=await supa.admin.rest('nodal_news',{method:'DELETE',headers:{Prefer:'return=representation'},query:{id:`eq.${id}`}});
   if(!Array.isArray(deleted))fail('news deletion unavailable',502);return deleted.length;
  },
 };
}
