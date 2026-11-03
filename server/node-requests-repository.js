import {createSupabaseClients} from './supabase.js';
import {fail} from './courses-domain.js';
import {snake} from './courses-schema.js';

// Organisation node requests from the landing page's no-account form. The CHECKs repeat the API's limits so a bug there
// cannot store what the desk would reject; supabase/migrations/*_node_requests.sql declares the same table for production.
export const NODE_REQUESTS_SQLITE_SCHEMA=`
CREATE TABLE IF NOT EXISTS node_requests (
 id TEXT PRIMARY KEY,name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),organization TEXT NOT NULL CHECK(length(organization) BETWEEN 1 AND 160),
 email TEXT NOT NULL CHECK(length(email)<=254),phone TEXT CHECK(phone IS NULL OR length(phone)<=40),message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 1000),
 language TEXT NOT NULL CHECK(language IN ('es','en','pt')),status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','closed')),
 email_status TEXT CHECK(email_status IS NULL OR email_status IN ('sent','partial','failed','uncertain','off')),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE INDEX IF NOT EXISTS node_requests_recent ON node_requests(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS node_requests_status ON node_requests(status,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS node_requests_updated_by ON node_requests(updated_by);
`;
export const NODE_REQUEST_FIELDS=['id','name','organization','email','phone','message','language','status','emailStatus','createdAt','updatedAt','updatedBy','version'];
const checked=record=>{for(const k of Object.keys(record))if(!NODE_REQUEST_FIELDS.includes(k))throw Error('unknown node request field');return record;};
const from=row=>row?Object.fromEntries(NODE_REQUEST_FIELDS.map(k=>[k,row[snake(k)]??null])):null;
const to=record=>Object.fromEntries(Object.entries(checked(record)).map(([k,v])=>[snake(k),v]));
// A reused id is a conflict the API resolves as an idempotent retry.
const conflict=err=>{if(err.code==='23505'||/UNIQUE constraint/.test(err.message))fail('node request already exists',409);throw err;};
const SELECT=NODE_REQUEST_FIELDS.map(snake).join(',');
// The desk reads the newest first; `after` is the last row of the previous page ({createdAt,id}), which the API validates.
export function createNodeRequestStore({db,env=process.env,clients,fetchImpl=fetch}={}){
 if(db)db.exec(NODE_REQUESTS_SQLITE_SCHEMA);
 const supa=db?null:clients??createSupabaseClients({env,fetchImpl});
 return {
  kind:db?'sqlite':'supabase',
  async insert(record){const row=to(record),keys=Object.keys(row);try{
   if(db)return from(db.prepare(`INSERT INTO node_requests (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')}) RETURNING *`).get(...Object.values(row)));
   const result=await supa.admin.rest('node_requests',{method:'POST',headers:{Prefer:'return=representation'},body:row});if(!result?.[0])fail('node request save unavailable',502);return from(result[0]);
  }catch(err){conflict(err);}},
  async get(id){
   if(db)return from(db.prepare('SELECT * FROM node_requests WHERE id=?').get(id));
   const rows=await supa.admin.rest('node_requests',{query:{select:SELECT,id:`eq.${id}`,limit:1}});
   if(!Array.isArray(rows))fail('node requests unavailable',502);return from(rows[0]);
  },
  async list({status=null,after=null,limit}={}){
   if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('invalid node request limit');
   if(db){
    const parts=[],params=[];
    if(status){parts.push('status=?');params.push(status);}
    if(after){parts.push('(created_at<? OR (created_at=? AND id<?))');params.push(after.createdAt,after.createdAt,after.id);}
    return db.prepare(`SELECT * FROM node_requests${parts.length?' WHERE '+parts.join(' AND '):''} ORDER BY created_at DESC,id DESC LIMIT ?`).all(...params,limit).map(from);
   }
   const query={select:SELECT,order:'created_at.desc,id.desc',limit,...(status?{status:`eq.${status}`}:{}),
    ...(after?{or:`(created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id}))`}:{})};
   const rows=await supa.admin.rest('node_requests',{query});
   if(!Array.isArray(rows))fail('node requests unavailable',502);return rows.map(from);
  },
  // Conditional on the version the admin loaded; null means another change (or a deletion) won.
  async update(id,version,patch){const row=to(patch);
   if(db)return from(db.prepare(`UPDATE node_requests SET ${Object.keys(row).map(k=>`${k}=?`).join(',')} WHERE id=? AND version=? RETURNING *`).get(...Object.values(row),id,version));
   const result=await supa.admin.rest('node_requests',{method:'PATCH',query:{id:`eq.${id}`,version:`eq.${version}`},headers:{Prefer:'return=representation'},body:row});
   if(!Array.isArray(result))fail('node request save unavailable',502);return from(result[0]);
  },
  // The outcome of the team email, written after the attempt ends; it is not an admin change, so the version stays.
  async setEmailStatus(id,emailStatus){
   if(db){db.prepare('UPDATE node_requests SET email_status=? WHERE id=?').run(emailStatus,id);return;}
   const result=await supa.admin.rest('node_requests',{method:'PATCH',query:{id:`eq.${id}`},headers:{Prefer:'return=representation'},body:{email_status:emailStatus}});
   if(!Array.isArray(result))fail('node request save unavailable',502);
  },
  // The daily email budget: requests whose send was attempted (anything but null or 'off') since `iso`.
  async countEmailedSince(iso){
   if(db)return db.prepare("SELECT count(*) AS n FROM node_requests WHERE created_at>=? AND email_status IS NOT NULL AND email_status<>'off'").get(iso).n;
   const page=await supa.admin.rest('node_requests',{query:{select:'id',created_at:`gte.${iso}`,and:'(email_status.not.is.null,email_status.neq.off)',limit:1},includeRange:true,headers:{Prefer:'count=exact'}});
   const total=Number(page?.contentRange?.split('/')[1]);if(!Array.isArray(page?.rows)||!Number.isInteger(total))fail('node requests unavailable',502);return total;
  },
  async remove(id){
   if(db){db.prepare('DELETE FROM node_requests WHERE id=?').run(id);return;}
   const deleted=await supa.admin.rest('node_requests',{method:'DELETE',headers:{Prefer:'return=representation'},query:{id:`eq.${id}`}});
   if(!Array.isArray(deleted))fail('node request deletion unavailable',502);
  },
  async purgeClosedBefore(iso){
   if(db)return db.prepare("DELETE FROM node_requests WHERE status='closed' AND updated_at<?").run(iso).changes;
   const deleted=await supa.admin.rest('node_requests',{method:'DELETE',headers:{Prefer:'return=representation'},query:{status:'eq.closed',updated_at:`lt.${iso}`}});
   if(!Array.isArray(deleted))fail('node request deletion unavailable',502);return deleted.length;
  },
 };
}
