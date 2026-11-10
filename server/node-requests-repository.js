import {createSupabaseClients} from './supabase.js';
import {fail} from './courses-domain.js';
import {snake} from './courses-schema.js';

// Organisation node requests from the landing page's no-account form. The CHECKs repeat the API's limits so a bug there
// cannot store what the desk would reject; supabase/migrations/*_node_requests.sql declares the same table for production.
// kind, community and memberships came on 9 November 2026 (sponsorship requests): a Nodo row has neither sponsor field,
// a sponsorship row has both (IS NOT NULL spelled out: a CHECK that comes out NULL passes). A table created before then is upgraded in place by upgradeKinds below.
const KIND_FIELDS="(kind='node' AND community IS NULL AND memberships IS NULL) OR (kind='sponsorship' AND community IS NOT NULL AND memberships IS NOT NULL AND length(community) BETWEEN 1 AND 200 AND memberships IN ('1-10','11-25','26-50','50+','unsure'))";
export const NODE_REQUESTS_SQLITE_SCHEMA=`
CREATE TABLE IF NOT EXISTS node_requests (
 id TEXT PRIMARY KEY,kind TEXT NOT NULL DEFAULT 'node' CHECK(kind IN ('node','sponsorship')),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),organization TEXT NOT NULL CHECK(length(organization) BETWEEN 1 AND 160),
 email TEXT NOT NULL CHECK(length(email)<=254),phone TEXT CHECK(phone IS NULL OR length(phone)<=40),community TEXT,memberships TEXT,
 message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 1000),
 language TEXT NOT NULL CHECK(language IN ('es','en','pt')),status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','closed')),
 email_status TEXT CHECK(email_status IS NULL OR email_status IN ('sent','partial','failed','uncertain','off')),
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 CHECK(${KIND_FIELDS})
);
CREATE INDEX IF NOT EXISTS node_requests_recent ON node_requests(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS node_requests_status ON node_requests(status,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS node_requests_updated_by ON node_requests(updated_by);
`;
// SQLite adds a column at a time and has no ADD CONSTRAINT, so the check that ties the sponsor fields to the kind rides
// on the last column added (a column's CHECK may name the others); every existing row is a Nodo row and passes it.
function upgradeKinds(db){
 const columns=new Set(db.prepare('PRAGMA table_info(node_requests)').all().map(c=>c.name));
 if(!columns.has('kind'))db.exec("ALTER TABLE node_requests ADD COLUMN kind TEXT NOT NULL DEFAULT 'node' CHECK(kind IN ('node','sponsorship'))");
 if(!columns.has('community'))db.exec('ALTER TABLE node_requests ADD COLUMN community TEXT');
 if(!columns.has('memberships'))db.exec(`ALTER TABLE node_requests ADD COLUMN memberships TEXT CHECK(${KIND_FIELDS})`);
 db.exec('CREATE INDEX IF NOT EXISTS node_requests_kind ON node_requests(kind,created_at DESC,id DESC)');
}
export const NODE_REQUEST_FIELDS=['id','kind','name','organization','email','phone','community','memberships','message','language','status','emailStatus','createdAt','updatedAt','updatedBy','version'];
const checked=record=>{for(const k of Object.keys(record))if(!NODE_REQUEST_FIELDS.includes(k))throw Error('unknown node request field');return record;};
const from=row=>row?Object.fromEntries(NODE_REQUEST_FIELDS.map(k=>[k,row[snake(k)]??null])):null;
const to=record=>Object.fromEntries(Object.entries(checked(record)).map(([k,v])=>[snake(k),v]));
// A reused id is a conflict the API resolves as an idempotent retry.
const conflict=err=>{if(err.code==='23505'||/UNIQUE constraint/.test(err.message))fail('node request already exists',409);throw err;};
const SELECT=NODE_REQUEST_FIELDS.map(snake).join(',');
// The desk reads the newest first, optionally of one status and one kind; `after` is the last row of the previous page ({createdAt,id}), which the API validates.
export function createNodeRequestStore({db,env=process.env,clients,fetchImpl=fetch}={}){
 if(db){db.exec(NODE_REQUESTS_SQLITE_SCHEMA);upgradeKinds(db);}
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
  async list({status=null,kind=null,after=null,limit}={}){
   if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('invalid node request limit');
   if(db){
    const parts=[],params=[];
    if(status){parts.push('status=?');params.push(status);}
    if(kind){parts.push('kind=?');params.push(kind);}
    if(after){parts.push('(created_at<? OR (created_at=? AND id<?))');params.push(after.createdAt,after.createdAt,after.id);}
    return db.prepare(`SELECT * FROM node_requests${parts.length?' WHERE '+parts.join(' AND '):''} ORDER BY created_at DESC,id DESC LIMIT ?`).all(...params,limit).map(from);
   }
   const query={select:SELECT,order:'created_at.desc,id.desc',limit,...(status?{status:`eq.${status}`}:{}),...(kind?{kind:`eq.${kind}`}:{}),
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
  // The outcome of the team email, written after the attempt ends; it is not an admin change, so the version and the
  // purge clock (updated_at) stay. The writes below ask for the id back only: no name, address or message on the wire.
  async setEmailStatus(id,emailStatus){
   if(db){db.prepare('UPDATE node_requests SET email_status=? WHERE id=?').run(emailStatus,id);return;}
   const result=await supa.admin.rest('node_requests',{method:'PATCH',query:{select:'id',id:`eq.${id}`},headers:{Prefer:'return=representation'},body:{email_status:emailStatus}});
   if(!Array.isArray(result))fail('node request save unavailable',502);
  },
  // The daily email budget: every request since `iso` not marked 'off', the null of a send still in flight included, so
  // a burst across instances cannot slip past it. A null left by a failed setEmailStatus counts too: the safe side.
  async countEmailedSince(iso){
   if(db)return db.prepare("SELECT count(*) AS n FROM node_requests WHERE created_at>=? AND (email_status IS NULL OR email_status<>'off')").get(iso).n;
   // neq alone would drop the nulls (PostgreSQL's three-valued logic), hence the or().
   const page=await supa.admin.rest('node_requests',{query:{select:'id',created_at:`gte.${iso}`,or:'(email_status.is.null,email_status.neq.off)',limit:1},includeRange:true,headers:{Prefer:'count=exact'}});
   const total=Number(page?.contentRange?.split('/')[1]);if(!Array.isArray(page?.rows)||!Number.isInteger(total))fail('node requests unavailable',502);return total;
  },
  async remove(id){
   if(db){db.prepare('DELETE FROM node_requests WHERE id=?').run(id);return;}
   const deleted=await supa.admin.rest('node_requests',{method:'DELETE',headers:{Prefer:'return=representation'},query:{select:'id',id:`eq.${id}`}});
   if(!Array.isArray(deleted))fail('node request deletion unavailable',502);
  },
  async purgeClosedBefore(iso){
   if(db)return db.prepare("DELETE FROM node_requests WHERE status='closed' AND updated_at<?").run(iso).changes;
   const deleted=await supa.admin.rest('node_requests',{method:'DELETE',headers:{Prefer:'return=representation'},query:{select:'id',status:'eq.closed',updated_at:`lt.${iso}`}});
   if(!Array.isArray(deleted))fail('node request deletion unavailable',502);return deleted.length;
  },
 };
}
