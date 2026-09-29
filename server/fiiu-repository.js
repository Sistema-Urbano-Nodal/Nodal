import {createSupabaseClients} from './supabase.js';
import {fail} from './courses-domain.js';
import {snake} from './courses-schema.js';

export const FIIU_SQLITE_SCHEMA=`
CREATE TABLE IF NOT EXISTS fiiu_registrations (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 email TEXT NOT NULL,answers TEXT NOT NULL,lab_status TEXT NOT NULL CHECK(lab_status IN ('none','pending','accepted','declined')),
 version INTEGER NOT NULL CHECK(version>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(event_id,user_id)
);
CREATE INDEX IF NOT EXISTS fiiu_registration_user ON fiiu_registrations(user_id);
CREATE INDEX IF NOT EXISTS fiiu_registration_page ON fiiu_registrations(event_id,id);
CREATE TABLE IF NOT EXISTS fiiu_attendance (
 id TEXT PRIMARY KEY,registration_id TEXT NOT NULL REFERENCES fiiu_registrations(id) ON DELETE CASCADE,
 activity_id TEXT NOT NULL,confirmed_by TEXT REFERENCES users(id) ON DELETE SET NULL,created_at TEXT NOT NULL,UNIQUE(registration_id,activity_id)
);
CREATE INDEX IF NOT EXISTS fiiu_attendance_confirmer ON fiiu_attendance(confirmed_by);
CREATE TABLE IF NOT EXISTS fiiu_config (id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0));
CREATE TABLE IF NOT EXISTS fiiu_content (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL,data TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('draft','published','archived')),
 version INTEGER NOT NULL CHECK(version>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS fiiu_content_page ON fiiu_content(event_id,status,id);
CREATE INDEX IF NOT EXISTS fiiu_content_recent ON fiiu_content(event_id,created_at DESC,id DESC);
`;
const TABLES={
 registrations:{name:'fiiu_registrations',fields:['id','eventId','userId','email','answers','labStatus','version','createdAt','updatedAt'],json:['answers']},
 attendance:{name:'fiiu_attendance',fields:['id','registrationId','activityId','confirmedBy','createdAt'],json:[]},
 config:{name:'fiiu_config',fields:['id','data','version'],json:['data']},
 content:{name:'fiiu_content',fields:['id','eventId','data','status','version','createdAt','updatedAt'],json:['data']},
};
const info=name=>{if(!TABLES[name])throw Error('unknown festival table');return TABLES[name];};
const checked=(table,record)=>{for(const k of Object.keys(record))if(!table.fields.includes(k))throw Error('unknown festival field');return record;};
const from=(table,row)=>row?Object.fromEntries(table.fields.map(k=>[k,table.json.includes(k)&&typeof row[snake(k)]==='string'?JSON.parse(row[snake(k)]):row[snake(k)]])):null;
const to=(table,record,sqlite)=>Object.fromEntries(Object.entries(checked(table,record)).map(([k,v])=>[snake(k),sqlite&&table.json.includes(k)?JSON.stringify(v):v]));
const conflict=err=>{if(err.code==='23505'||/UNIQUE constraint/.test(err.message))fail('record changed; reload before saving',409);throw err;};
export function createFiiuStore({db,env=process.env,clients,fetchImpl=fetch}={}){
 if(db)db.exec(FIIU_SQLITE_SCHEMA);
 const supa=db?null:clients??createSupabaseClients({env,fetchImpl:(url,args)=>fetchImpl(url,{...args,signal:AbortSignal.timeout(15000)})});
 function where(table,filters,after){
  checked(table,filters);const entries=Object.entries(filters),params=entries.map(([,v])=>v);
  const parts=entries.map(([k])=>`${snake(k)}=?`);if(after){parts.push('id>?');params.push(after);}
  return {sql:parts.length?' WHERE '+parts.join(' AND '):'',params};
 }
 return {
  async find(name,filters={}, {after,limit=200,newest=false,afterCreatedAt}={}){
   const table=info(name);checked(table,filters);if(!Number.isInteger(limit)||limit<1||limit>200)throw Error('invalid festival limit');
   if(newest&&name!=='content')throw Error('recent order is only supported for content');
   if(db){const w=where(table,filters,newest?null:after);
    if(newest&&after){w.sql+=(w.sql?' AND ':' WHERE ')+'(created_at<? OR (created_at=? AND id<?))';w.params.push(afterCreatedAt,afterCreatedAt,after);}
    return db.prepare(`SELECT * FROM ${table.name}${w.sql} ORDER BY ${newest?'created_at DESC,id DESC':'id'} LIMIT ?`).all(...w.params,limit).map(row=>from(table,row));}
   const query={select:table.fields.map(snake).join(','),order:newest?'created_at.desc,id.desc':'id.asc',limit,...Object.fromEntries(Object.entries(filters).map(([k,v])=>[snake(k),`eq.${v}`]))};
   if(after){if(newest)query.or=`(created_at.lt.${afterCreatedAt},and(created_at.eq.${afterCreatedAt},id.lt.${after}))`;else query.id=`gt.${after}`;}
   // Fill logical pages even when the provider has a smaller response cap.
   const rows=[];while(rows.length<limit){const page=await supa.admin.rest(table.name,{query:{...query,offset:rows.length,limit:limit-rows.length}});if(!Array.isArray(page))fail('festival data unavailable',502);rows.push(...page);if(!page.length)break;}
   return rows.map(row=>from(table,row));
  },
  async insert(name,record){const table=info(name),row=to(table,record,!!db),keys=Object.keys(row);try{
   if(db)return from(table,db.prepare(`INSERT INTO ${table.name} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')}) RETURNING *`).get(...Object.values(row)));
   const result=await supa.admin.rest(table.name,{method:'POST',headers:{Prefer:'return=representation'},body:row});if(!result?.[0])fail('festival save unavailable',502);return from(table,result[0]);
  }catch(err){conflict(err);}},
  async update(name,filters,patch){const table=info(name),row=to(table,patch,!!db);if(!Object.keys(filters).length)throw Error('scoped update required');checked(table,filters);
   if(db){const w=where(table,filters);return from(table,db.prepare(`UPDATE ${table.name} SET ${Object.keys(row).map(k=>`${k}=?`).join(',')}${w.sql} RETURNING *`).get(...Object.values(row),...w.params));}
   const result=await supa.admin.rest(table.name,{method:'PATCH',query:Object.fromEntries(Object.entries(filters).map(([k,v])=>[snake(k),`eq.${v}`])),headers:{Prefer:'return=representation'},body:row});return from(table,result?.[0]);
  },
  async remove(name,filters){const table=info(name);if(!Object.keys(filters).length)throw Error('scoped deletion required');checked(table,filters);
   if(db){const w=where(table,filters);return db.prepare(`DELETE FROM ${table.name}${w.sql}`).run(...w.params).changes;}
   const deleted=await supa.admin.rest(table.name,{method:'DELETE',headers:{Prefer:'return=representation'},query:Object.fromEntries(Object.entries(filters).map(([k,v])=>[snake(k),`eq.${v}`]))});
   if(!Array.isArray(deleted))fail('festival deletion unavailable',502);return deleted.length;
  },
 };
}
