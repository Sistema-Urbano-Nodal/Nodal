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
  async summary(eventId,activities){
   // Aggregate inside the database: the organizer never needs every private
   // questionnaire merely to render event totals. The catalog is server-owned.
   const catalog=activities.map(({id,date,registration})=>({id,date,registration}));
   if(!db){
    const result=await supa.admin.rest('rpc/fiiu_event_summary',{method:'POST',body:{p_event_id:eventId,p_activities:catalog}});
    if(!result||typeof result!=='object'||!Number.isSafeInteger(result.totalRegistrations)||!Array.isArray(result.activities)||!Array.isArray(result.days)||!Array.isArray(result.profiles))fail('festival summary unavailable',502);
    return result;
   }
   const rows=db.prepare(`WITH
    r AS (SELECT id,answers,lab_status FROM fiiu_registrations WHERE event_id=?),
    catalog AS (SELECT json_extract(value,'$.id') AS activity_id,json_extract(value,'$.date') AS date,json_extract(value,'$.registration') AS registration FROM json_each(?)),
    selections AS (
     SELECT r.id,j.value AS activity_id,'registration' AS kind,'general' AS registration FROM r,json_each(CASE WHEN json_type(r.answers,'$.activities')='array' THEN json_extract(r.answers,'$.activities') ELSE '[]' END) AS j
     UNION ALL SELECT r.id,j.value,'interest','external' FROM r,json_each(CASE WHEN json_type(r.answers,'$.externalActivities')='array' THEN json_extract(r.answers,'$.externalActivities') ELSE '[]' END) AS j
     UNION ALL SELECT id,'day0-lab','registration','application' FROM r WHERE json_type(answers,'$.applyLab')='true'
    ), valid_selections AS (
     SELECT DISTINCT s.id,s.activity_id,s.kind FROM selections s JOIN catalog c ON c.activity_id=s.activity_id
     WHERE s.registration=c.registration
    ), attended AS (SELECT a.registration_id AS id,a.activity_id FROM fiiu_attendance a JOIN r ON r.id=a.registration_id)
    SELECT 'total' AS metric,'' AS key,count(*) AS n FROM r
    UNION ALL SELECT 'official','',count(*) FROM r WHERE json_type(answers,'$.publicOfficial')='true'
    UNION ALL SELECT 'lab',lab_status,count(*) FROM r WHERE lab_status IN ('pending','accepted','declined') GROUP BY lab_status
    UNION ALL SELECT 'profile',CASE WHEN json_type(answers,'$.profile')='text' THEN json_extract(answers,'$.profile') ELSE '' END,count(*) FROM r GROUP BY 2
    UNION ALL SELECT kind,activity_id,count(DISTINCT id) FROM valid_selections GROUP BY kind,activity_id
    UNION ALL SELECT 'attendance',activity_id,count(DISTINCT id) FROM attended GROUP BY activity_id
    UNION ALL SELECT 'day-registration',c.date,count(DISTINCT s.id) FROM valid_selections s JOIN catalog c ON c.activity_id=s.activity_id GROUP BY c.date
    UNION ALL SELECT 'day-attendance',c.date,count(DISTINCT a.id) FROM attended a JOIN catalog c ON c.activity_id=a.activity_id GROUP BY c.date
   `).all(eventId,JSON.stringify(catalog));
   const count=(metric,key='')=>rows.find(row=>row.metric===metric&&row.key===key)?.n??0;
   return {totalRegistrations:count('total'),publicOfficials:count('official'),lab:{pending:count('lab','pending'),accepted:count('lab','accepted'),declined:count('lab','declined')},
    activities:catalog.map(({id})=>({activityId:id,registrations:count('registration',id),externalInterests:count('interest',id),attendance:count('attendance',id)})),
    days:[...new Set(catalog.map(a=>a.date))].sort().map(date=>({date,registrations:count('day-registration',date),attendance:count('day-attendance',date)})),
    profiles:rows.filter(row=>row.metric==='profile').map(row=>({profile:row.key,count:row.n})).sort((a,b)=>a.profile<b.profile?-1:a.profile>b.profile?1:0),
   };
  },
  async find(name,filters={}, {after,limit=200,newest=false,afterCreatedAt,kind}={}){
   const table=info(name);checked(table,filters);if(!Number.isInteger(limit)||limit<1||limit>200)throw Error('invalid festival limit');
   if(newest&&name!=='content')throw Error('recent order is only supported for content');
   if(kind&&(name!=='content'||!['news','recording','material'].includes(kind)))throw Error('invalid publication kind');
   if(db){const w=where(table,filters,newest?null:after);
    if(kind){w.sql+=(w.sql?' AND ':' WHERE ')+"json_extract(data,'$.kind')=?";w.params.push(kind);}
    if(newest&&after){w.sql+=(w.sql?' AND ':' WHERE ')+'(created_at<? OR (created_at=? AND id<?))';w.params.push(afterCreatedAt,afterCreatedAt,after);}
    return db.prepare(`SELECT * FROM ${table.name}${w.sql} ORDER BY ${newest?'created_at DESC,id DESC':'id'} LIMIT ?`).all(...w.params,limit).map(row=>from(table,row));}
   const query={select:table.fields.map(snake).join(','),order:newest?'created_at.desc,id.desc':'id.asc',limit,...Object.fromEntries(Object.entries(filters).map(([k,v])=>[snake(k),`eq.${v}`]))};
   if(kind)query['data->>kind']=`eq.${kind}`;
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
