import {createSupabaseClients} from './supabase.js';
import {fail} from './courses-domain.js';
import {snake} from './courses-schema.js';
import {createObjectStorage} from './object-storage.js';
import {TALK_LIMITS} from './fiiu-talk-domain.js';
import {FIIU_SQLITE_SCHEMA} from './fiiu-repository.js';

/* Local mirror of 20261011120000_fiiu_conversations.sql. The triggers keep each question's revision (what the pulse
   publishes) and stamp every changed message with it as seq (attaching its files included), so the since-sync and the
   counters stay right on every write path, the account-deletion cascade included. recursive_triggers is off, and the update triggers watch named
   columns, never seq or revision, so their own writes cannot fire them again. As on profiles in Postgres, deleting an
   account blanks its messages first, so a deletion path that skips the application's scrub still leaves no text. */
export const FIIU_TALK_SQLITE_SCHEMA=`
CREATE TABLE IF NOT EXISTS fiiu_questions (id TEXT PRIMARY KEY,event_id TEXT NOT NULL,activity_id TEXT NOT NULL,talk TEXT,body TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('open','closed','hidden')),revision INTEGER NOT NULL DEFAULT 0,message_count INTEGER NOT NULL DEFAULT 0,
 created_by TEXT REFERENCES users(id) ON DELETE SET NULL,version INTEGER NOT NULL CHECK(version>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS fiiu_questions_activity ON fiiu_questions(event_id,activity_id,created_at);
CREATE TABLE IF NOT EXISTS fiiu_messages (id TEXT PRIMARY KEY,question_id TEXT NOT NULL REFERENCES fiiu_questions(id) ON DELETE RESTRICT,
 user_id TEXT REFERENCES users(id) ON DELETE SET NULL,author_name TEXT NOT NULL,author_full TEXT NOT NULL,organiser INTEGER NOT NULL DEFAULT 0,
 body TEXT NOT NULL,client_id TEXT NOT NULL,like_count INTEGER NOT NULL DEFAULT 0 CHECK(like_count>=0),seq INTEGER NOT NULL DEFAULT 0,
 hidden_at TEXT,hidden_by TEXT REFERENCES users(id) ON DELETE SET NULL,deleted_at TEXT,created_at TEXT NOT NULL,UNIQUE(user_id,client_id));
CREATE INDEX IF NOT EXISTS fiiu_messages_changes ON fiiu_messages(question_id,seq);
CREATE INDEX IF NOT EXISTS fiiu_messages_page ON fiiu_messages(question_id,created_at,id);
CREATE TABLE IF NOT EXISTS fiiu_message_likes (message_id TEXT NOT NULL REFERENCES fiiu_messages(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(message_id,user_id));
CREATE TABLE IF NOT EXISTS fiiu_files (id TEXT PRIMARY KEY,event_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 message_id TEXT REFERENCES fiiu_messages(id) ON DELETE RESTRICT,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,width INTEGER,height INTEGER,
 thumb_size INTEGER,storage_path TEXT NOT NULL UNIQUE,status TEXT NOT NULL CHECK(status IN ('pending','ready','deleting')),created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS fiiu_files_user ON fiiu_files(user_id);
CREATE INDEX IF NOT EXISTS fiiu_files_message ON fiiu_files(message_id);
CREATE TABLE IF NOT EXISTS fiiu_file_bytes (file_id TEXT NOT NULL REFERENCES fiiu_files(id) ON DELETE CASCADE,variant TEXT NOT NULL CHECK(variant IN ('full','thumb')),bytes BLOB NOT NULL,PRIMARY KEY(file_id,variant));
CREATE TRIGGER IF NOT EXISTS fiiu_message_insert AFTER INSERT ON fiiu_messages BEGIN
 UPDATE fiiu_questions SET revision=revision+1,message_count=message_count+(NEW.hidden_at IS NULL AND NEW.deleted_at IS NULL) WHERE id=NEW.question_id;
 UPDATE fiiu_messages SET seq=(SELECT revision FROM fiiu_questions WHERE id=NEW.question_id) WHERE id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS fiiu_message_change AFTER UPDATE OF body,hidden_at,deleted_at,like_count,author_name,user_id ON fiiu_messages
 WHEN NEW.body IS NOT OLD.body OR NEW.hidden_at IS NOT OLD.hidden_at OR NEW.deleted_at IS NOT OLD.deleted_at OR NEW.like_count IS NOT OLD.like_count OR NEW.author_name IS NOT OLD.author_name OR NEW.user_id IS NOT OLD.user_id BEGIN
 UPDATE fiiu_questions SET revision=revision+1,message_count=message_count+(NEW.hidden_at IS NULL AND NEW.deleted_at IS NULL)-(OLD.hidden_at IS NULL AND OLD.deleted_at IS NULL) WHERE id=NEW.question_id;
 UPDATE fiiu_messages SET seq=(SELECT revision FROM fiiu_questions WHERE id=NEW.question_id) WHERE id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS fiiu_like_insert AFTER INSERT ON fiiu_message_likes BEGIN UPDATE fiiu_messages SET like_count=like_count+1 WHERE id=NEW.message_id; END;
CREATE TRIGGER IF NOT EXISTS fiiu_like_delete AFTER DELETE ON fiiu_message_likes BEGIN UPDATE fiiu_messages SET like_count=max(0,like_count-1) WHERE id=OLD.message_id; END;
CREATE TRIGGER IF NOT EXISTS fiiu_question_change AFTER UPDATE OF body,talk,status ON fiiu_questions
 WHEN NEW.body IS NOT OLD.body OR NEW.talk IS NOT OLD.talk OR NEW.status IS NOT OLD.status BEGIN UPDATE fiiu_questions SET revision=revision+1 WHERE id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS fiiu_file_attached AFTER UPDATE OF message_id ON fiiu_files WHEN NEW.message_id IS NOT NULL AND NEW.message_id IS NOT OLD.message_id BEGIN
 UPDATE fiiu_questions SET revision=revision+1 WHERE id=(SELECT question_id FROM fiiu_messages WHERE id=NEW.message_id);
 UPDATE fiiu_messages SET seq=(SELECT q.revision FROM fiiu_questions q JOIN fiiu_messages m ON m.question_id=q.id WHERE m.id=NEW.message_id) WHERE id=NEW.message_id; END;
CREATE TRIGGER IF NOT EXISTS fiiu_messages_account_erasure BEFORE DELETE ON users BEGIN
 UPDATE fiiu_messages SET body='',author_name='',author_full='',deleted_at=coalesce(deleted_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE user_id=OLD.id; END;
`;
const TABLES={
 questions:{name:'fiiu_questions',fields:['id','eventId','activityId','talk','body','status','revision','messageCount','createdBy','version','createdAt','updatedAt']},
 messages:{name:'fiiu_messages',fields:['id','questionId','userId','authorName','authorFull','organiser','body','clientId','likeCount','seq','hiddenAt','hiddenBy','deletedAt','createdAt']},
 files:{name:'fiiu_files',fields:['id','eventId','userId','messageId','name','mime','size','width','height','thumbSize','storagePath','status','createdAt']},
};
const {questions:QT,messages:MT,files:FT}=TABLES;
const QUESTION_PATCH=['body','talk','status','updatedAt'],FILE_STATUSES=['pending','ready','deleting'],VARIANTS=['full','thumb'];
// Postgres answers timestamptz as '…+00:00' with up to microseconds; records carry the UTC ISO form the app writes
// (and SQLite stores), so cursors made from either backend look the same and pass decodeCursor.
const TIMES=new Set(['createdAt','updatedAt','hiddenAt','deletedAt']);
const utc=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():value;
const checked=(table,record)=>{for(const k of Object.keys(record))if(!table.fields.includes(k))throw Error('unknown festival field');return record;};
const from=(table,row,pg=false)=>row?Object.fromEntries(table.fields.map(k=>{const v=row[snake(k)];return [k,k==='organiser'?Boolean(v):pg&&TIMES.has(k)?utc(v):v];})):null;
// An undefined field is absent, as JSON.stringify makes it for Supabase: the column default on insert, untouched on
// update. SQLite would otherwise refuse to bind it, so a thumbSize left undefined for a PDF works the same on both.
const to=(table,record,sqlite)=>Object.fromEntries(Object.entries(checked(table,record)).filter(([,v])=>v!==undefined).map(([k,v])=>[snake(k),sqlite&&typeof v==='boolean'?Number(v):v]));
// The chat pages translate refusals by code; a reused id means the client must reload, a missing parent is a 404.
// The message insert trigger copies seq from the question's revision, so an unknown question fails NOT NULL on seq
// before its foreign key is checked, on both backends. A NOT NULL failure on any other column is a bug and stays raw.
const failCode=(message,status,code)=>{try{fail(message,status);}catch(err){throw Object.assign(err,{code});}};
const ORPHAN=/NOT NULL constraint failed: fiiu_messages\.seq|null value in column "seq"/;
const conflict=err=>{
 if(err.code==='23505'||/UNIQUE constraint/.test(err.message))failCode('record changed; reload before saving',409,'conflict');
 if(err.code==='23503'||/FOREIGN KEY constraint/.test(err.message)||ORPHAN.test(err.message))fail('related record unavailable',404);
 throw err;
};
const allowance=()=>failCode('festival upload allowance reached',413,'upload_allowance');
const storage=()=>fail('attachment storage unavailable',502);
// Polls and pages are bounded: the caller asks one row over its page (100, or 200 changes) to learn whether more exist.
const capped=(limit,max=TALK_LIMITS.changes+1)=>{if(!Number.isInteger(limit)||limit<1)throw Error('invalid festival limit');return Math.min(limit,max);};
const revisionOf=since=>{if(!Number.isSafeInteger(since)||since<0)fail('invalid revision');return since;};
const chunks=(list,size=100)=>{const unique=[...new Set(list)],out=[];for(let i=0;i<unique.length;i+=size)out.push(unique.slice(i,i+size));return out;};
// Account erasure leaves a message's user_id NULL, and the organiser export still asks for its author's email.
const accounts=ids=>ids.filter(id=>typeof id==='string');
const variantOf=variant=>{if(!VARIANTS.includes(variant))throw Error('invalid file variant');return variant;};

export function createTalkStore({db,env=process.env,clients,fetchImpl=fetch}={}){
 if(db)return sqliteTalk(db);
 const supa=clients??createSupabaseClients({env,fetchImpl:(url,args)=>fetchImpl(url,{...args,signal:AbortSignal.timeout(15000)})});
 return supabaseTalk(supa,fetchImpl);
}

function sqliteTalk(db){
 // Registrations are the FIIU store's table (IF NOT EXISTS, so the two stores may start in either order).
 db.exec(FIIU_SQLITE_SCHEMA);db.exec(FIIU_TALK_SQLITE_SCHEMA);
 const get=(sql,...params)=>db.prepare(sql).get(...params),all=(sql,...params)=>db.prepare(sql).all(...params),run=(sql,...params)=>db.prepare(sql).run(...params).changes;
 const marks=list=>list.map(()=>'?').join(',');
 // Re-read after writes: RETURNING shows the row before the AFTER triggers stamped seq and revision.
 const byId=(table,id)=>from(table,get(`SELECT * FROM ${table.name} WHERE id=?`,id));
 const insert=(table,record)=>{const row=to(table,record,true),keys=Object.keys(row);
  try{db.prepare(`INSERT INTO ${table.name} (${keys.join(',')}) VALUES (${marks(keys)})`).run(...Object.values(row));}catch(err){conflict(err);}
  return byId(table,record.id);};
 const where=(table,filters)=>{checked(table,filters);const parts=[],params=[];
  for(const [k,v] of Object.entries(filters)){if(v===null)parts.push(`${snake(k)} IS NULL`);else{parts.push(`${snake(k)}=?`);params.push(typeof v==='boolean'?Number(v):v);}}
  return {sql:parts.length?' WHERE '+parts.join(' AND '):'',params};};
 const among=(ids,query)=>chunks(ids).flatMap(chunk=>query(chunk));
 return {
  kind:'sqlite',
  // fiiu_registrations belongs to the FIIU store; conversations only read the name fields and the email from it.
  async findRegistration(eventId,userId){
   const row=get("SELECT id,email,json_extract(answers,'$.firstName') AS first_name,json_extract(answers,'$.lastName') AS last_name FROM fiiu_registrations WHERE event_id=? AND user_id=?",eventId,userId);
   return row?{id:row.id,email:row.email,firstName:String(row.first_name??''),lastName:String(row.last_name??'')}:null;
  },
  async registrationEmails(eventId,userIds){
   return new Map(among(accounts(userIds),chunk=>all(`SELECT user_id,email FROM fiiu_registrations WHERE event_id=? AND user_id IN (${marks(chunk)})`,eventId,...chunk)).map(r=>[r.user_id,r.email]));
  },
  async insertQuestion(record){return insert(QT,{...record,version:1,updatedAt:record.createdAt});},
  async getQuestion(id){return byId(QT,id);},
  async listQuestions(eventId,{activityId,includeHidden=false}={}){
   const params=[eventId];let sql='SELECT * FROM fiiu_questions WHERE event_id=?';
   if(activityId!==undefined){sql+=' AND activity_id=?';params.push(activityId);}
   if(!includeHidden)sql+=" AND status<>'hidden'";
   return all(sql+' ORDER BY created_at,id',...params).map(r=>from(QT,r));
  },
  async updateQuestion(id,version,patch){
   if(!Number.isSafeInteger(version)||version<1)fail('invalid version');
   for(const k of Object.keys(patch))if(!QUESTION_PATCH.includes(k))throw Error('unknown festival field');
   const row=to(QT,patch,true),keys=Object.keys(row);
   const hit=get(`UPDATE fiiu_questions SET ${[...keys.map(k=>`${k}=?`),'version=version+1'].join(',')} WHERE id=? AND version=? RETURNING id`,...Object.values(row),id,version);
   return hit?byId(QT,hit.id):null;
  },
  async pulse(eventId){return all("SELECT id,activity_id,revision,status FROM fiiu_questions WHERE event_id=? AND status<>'hidden' ORDER BY created_at,id",eventId).map(r=>({id:r.id,activityId:r.activity_id,revision:r.revision,status:r.status}));},
  async questionStats(eventId){
   return new Map(all(`SELECT m.question_id,count(DISTINCT m.user_id) AS people,coalesce(sum(m.like_count),0) AS likes FROM fiiu_messages m JOIN fiiu_questions q ON q.id=m.question_id
    WHERE q.event_id=? AND m.hidden_at IS NULL AND m.deleted_at IS NULL GROUP BY m.question_id`,eventId).map(r=>[r.question_id,{people:r.people,likes:r.likes}]));
  },
  async insertMessage(record){return insert(MT,record);},
  async findMessage(id){return byId(MT,id);},
  async findMessageByClient(userId,clientId){return from(MT,get('SELECT * FROM fiiu_messages WHERE user_id=? AND client_id=?',userId,clientId));},
  // ownHidden: the reader's id, whose own hidden messages come too (marked for them by the API).
  async latestMessages(questionId,{includeHidden=false,ownHidden=null,before=null,limit=TALK_LIMITS.page}={}){
   const n=capped(limit,TALK_LIMITS.changes),params=[questionId];let sql='SELECT * FROM fiiu_messages WHERE question_id=? AND deleted_at IS NULL';
   if(!includeHidden){sql+=ownHidden?' AND (hidden_at IS NULL OR user_id=?)':' AND hidden_at IS NULL';if(ownHidden)params.push(ownHidden);}
   if(before){sql+=' AND (created_at<? OR (created_at=? AND id<?))';params.push(before.createdAt,before.createdAt,before.id);}
   const rows=all(sql+' ORDER BY created_at DESC,id DESC LIMIT ?',...params,n+1).map(r=>from(MT,r));
   return {rows:rows.slice(0,n).reverse(),more:rows.length>n};
  },
  async messagesSince(questionId,since,{limit=TALK_LIMITS.changes+1}={}){
   return all('SELECT * FROM fiiu_messages WHERE question_id=? AND seq>? ORDER BY seq LIMIT ?',questionId,revisionOf(since),capped(limit)).map(r=>from(MT,r));
  },
  async updateMessage(filters,patch){
   if(!filters?.id)throw Error('scoped update required');
   const row=to(MT,patch,true),keys=Object.keys(row),w=where(MT,filters);if(!keys.length)throw Error('empty festival update');
   let hit;try{hit=get(`UPDATE fiiu_messages SET ${keys.map(k=>`${k}=?`).join(',')}${w.sql} RETURNING id`,...Object.values(row),...w.params);}catch(err){conflict(err);}
   return hit?byId(MT,hit.id):null;
  },
  async allMessages(questionId){return all('SELECT * FROM fiiu_messages WHERE question_id=? ORDER BY created_at,id',questionId).map(r=>from(MT,r));},
  async userMessages(userId){return all('SELECT * FROM fiiu_messages WHERE user_id=? ORDER BY created_at,id',userId).map(r=>from(MT,r));},
  async scrubUserMessages(userId,at){return run("UPDATE fiiu_messages SET body='',author_name='',author_full='',deleted_at=coalesce(deleted_at,?) WHERE user_id=?",at,userId);},
  async like(messageId,userId,at){
   try{return run('INSERT INTO fiiu_message_likes (message_id,user_id,created_at) VALUES (?,?,?) ON CONFLICT(message_id,user_id) DO NOTHING',messageId,userId,at)===1;}catch(err){conflict(err);}
  },
  async unlike(messageId,userId){return run('DELETE FROM fiiu_message_likes WHERE message_id=? AND user_id=?',messageId,userId)>0;},
  async likedAmong(userId,messageIds){return new Set(among(messageIds,chunk=>all(`SELECT message_id FROM fiiu_message_likes WHERE user_id=? AND message_id IN (${marks(chunk)})`,userId,...chunk)).map(r=>r.message_id));},
  async userLikes(userId){return all('SELECT message_id FROM fiiu_message_likes WHERE user_id=? ORDER BY created_at,message_id',userId).map(r=>r.message_id);},
  async removeUserLikes(userId){return run('DELETE FROM fiiu_message_likes WHERE user_id=?',userId);},
  async reserveFile(record){
   const row=to(FT,{...record,status:'pending'},true),keys=Object.keys(row);
   // No await between the count and the insert: BEGIN IMMEDIATE takes the write lock, which also serialises other
   // connections to this database file, so two uploads cannot both squeeze under the allowance.
   db.exec('BEGIN IMMEDIATE');
   try{
    const usage=get('SELECT count(*) AS n,coalesce(sum(size),0) AS bytes FROM fiiu_files WHERE user_id=? AND event_id=?',record.userId,record.eventId);
    if(usage.n>=TALK_LIMITS.quotaFiles||usage.bytes+record.size>TALK_LIMITS.quotaBytes)allowance();
    db.prepare(`INSERT INTO fiiu_files (${keys.join(',')}) VALUES (${marks(keys)})`).run(...Object.values(row));
    db.exec('COMMIT');
   }catch(err){db.exec('ROLLBACK');conflict(err);}
   return byId(FT,record.id);
  },
  // unattached: only while no message holds the file, so a release never takes one a send attached meanwhile.
  async setFileStatus(id,fromStatus,toStatus,{unattached=false}={}){
   if(!FILE_STATUSES.includes(fromStatus)||!FILE_STATUSES.includes(toStatus))throw Error('invalid file status');
   return from(FT,get(`UPDATE fiiu_files SET status=? WHERE id=? AND status=?${unattached?' AND message_id IS NULL':''} RETURNING *`,toStatus,id,fromStatus));
  },
  async findFile(id){return byId(FT,id);},
  async filesByIds(ids){return among(ids,chunk=>all(`SELECT * FROM fiiu_files WHERE id IN (${marks(chunk)}) ORDER BY created_at,id`,...chunk)).map(r=>from(FT,r));},
  async filesForMessages(messageIds){return among(messageIds,chunk=>all(`SELECT * FROM fiiu_files WHERE status='ready' AND message_id IN (${marks(chunk)}) ORDER BY created_at,id`,...chunk)).map(r=>from(FT,r));},
  async attachFiles(ids,messageId,userId){
   return among(ids,chunk=>[run(`UPDATE fiiu_files SET message_id=? WHERE id IN (${marks(chunk)}) AND user_id=? AND status='ready' AND message_id IS NULL`,messageId,...chunk,userId)]).reduce((a,b)=>a+b,0);
  },
  async userFiles(userId,{limit}={}){
   return (limit===undefined?all('SELECT * FROM fiiu_files WHERE user_id=? ORDER BY created_at,id',userId):all('SELECT * FROM fiiu_files WHERE user_id=? ORDER BY created_at,id LIMIT ?',userId,capped(limit))).map(r=>from(FT,r));
  },
  async removeFile(id){return run('DELETE FROM fiiu_files WHERE id=?',id);},
  // Storage refuses a second put (x-upsert false) and a missing object with object-storage.js's 502, so the local
  // bytes answer the same: the API decides from the file row (status, thumbSize), never from a refused read.
  async putBytes(file,variant,bytes){const kind=variantOf(variant);try{run('INSERT INTO fiiu_file_bytes (file_id,variant,bytes) VALUES (?,?,?)',file.id,kind,bytes);}catch(err){if(/constraint failed/.test(err.message))storage();throw err;}},
  async getBytes(file,variant){const row=get('SELECT bytes FROM fiiu_file_bytes WHERE file_id=? AND variant=?',file.id,variantOf(variant));if(!row)storage();return Buffer.from(row.bytes);},
  async deleteBytes(file){run('DELETE FROM fiiu_file_bytes WHERE file_id=?',file.id);},
 };
}

// Stored paths are the server's own fiiu/<userId>/<fileId>; anything else (a '..' segment, another prefix) is never sent
// to Storage, whose bucket also holds course files and certificates.
const STORAGE_PATH=/^fiiu\/[\w-]+\/[\w-]+$/;
// In-lists and the cursor are PostgREST syntax, so their values are plain tokens: a comma or a bracket cannot add a filter.
const TOKEN=/^[\w-]+$/,TIME=/^[\w:.+-]+$/;
function supabaseTalk(supa,fetchImpl){
 const objects=createObjectStorage({env:supa.env,fetchImpl,bucket:'course-attachments'});
 const unavailable=()=>fail('festival conversation data unavailable',502);
 const select=table=>table.fields.map(snake).join(',');
 const eqs=filters=>Object.fromEntries(Object.entries(filters).map(([k,v])=>[snake(k),v===null?'is.null':`eq.${v}`]));
 const token=id=>{if(typeof id!=='string'||!TOKEN.test(id))throw Error('invalid festival identifier');return id;};
 const list=ids=>`in.(${ids.map(token).join(',')})`;
 const read=async(table,query)=>{const rows=await supa.admin.rest(table,{query});if(!Array.isArray(rows))unavailable();return rows;};
 const write=async(table,{headers,...options})=>{
  let rows;try{rows=await supa.admin.rest(table,{...options,headers:{Prefer:'return=representation',...headers}});}catch(err){conflict(err);}
  if(!Array.isArray(rows))unavailable();return rows;};
 /* Everything for one person or one question, 200 rows a request. The first request asks for the exact count, so the
    usual short read is one round trip; follow-ups continue after the last row by (created_at, key) rather than OFFSET,
    so a write between requests cannot repeat or skip rows. Without a count, read on until an empty page. `and` carries
    the keyset so it never meets a caller's own filters. A short page alone never ends the read, even for the bounded
    pulse and file reads: the project's max-rows setting may cap pages below 200, and the count rides in the same
    request (as in the course and FIIU stores). */
 const readAll=async(table,query,key='id')=>{
  const rows=[];let cursor={},total=null,first=true;
  for(;;){
   const page=await supa.admin.rest(table,{query:{...query,...cursor,order:`created_at.asc,${key}.asc`,limit:200},includeRange:true,...(first?{headers:{Prefer:'count=exact'}}:{})});
   if(!Array.isArray(page?.rows))unavailable();rows.push(...page.rows);
   const counted=Number(page.contentRange?.split('/')[1]);if(first&&Number.isSafeInteger(counted))total=counted;first=false;
   if(!page.rows.length||(total!==null&&rows.length>=total))return rows;
   const last=page.rows.at(-1);cursor={and:`(or(created_at.gt.${last.created_at},and(created_at.eq.${last.created_at},${key}.gt.${last[key]})))`};
  }
 };
 const one=async(table,filters)=>from(table,(await read(table.name,{select:select(table),...eqs(filters),limit:1}))[0],true);
 const objectPath=(file,variant)=>{
  if(typeof file?.storagePath!=='string'||!STORAGE_PATH.test(file.storagePath))throw Error('invalid festival file path');
  return variantOf(variant)==='thumb'?`${file.storagePath}.thumb`:file.storagePath;
 };
 return {
  kind:'supabase',
  // Only the two name fields travel, through JSON paths: the questionnaire (national ID included) stays in the database.
  async findRegistration(eventId,userId){
   const [row]=await read('fiiu_registrations',{select:'id,email,first_name:answers->>firstName,last_name:answers->>lastName',event_id:`eq.${eventId}`,user_id:`eq.${userId}`,limit:1});
   return row?{id:row.id,email:row.email,firstName:String(row.first_name??''),lastName:String(row.last_name??'')}:null;
  },
  async registrationEmails(eventId,userIds){
   const out=new Map();
   for(const chunk of chunks(accounts(userIds)))for(const row of await read('fiiu_registrations',{select:'user_id,email',event_id:`eq.${eventId}`,user_id:list(chunk),limit:chunk.length}))out.set(row.user_id,row.email);
   return out;
  },
  async insertQuestion(record){const [row]=await write(QT.name,{method:'POST',body:to(QT,{...record,version:1,updatedAt:record.createdAt})});if(!row)unavailable();return from(QT,row,true);},
  async getQuestion(id){return one(QT,{id});},
  async listQuestions(eventId,{activityId,includeHidden=false}={}){
   return (await readAll(QT.name,{select:select(QT),event_id:`eq.${eventId}`,...(activityId!==undefined?{activity_id:`eq.${activityId}`}:{}),...(includeHidden?{}:{status:'neq.hidden'})})).map(r=>from(QT,r,true));
  },
  async updateQuestion(id,version,patch){
   if(!Number.isSafeInteger(version)||version<1)fail('invalid version');
   for(const k of Object.keys(patch))if(!QUESTION_PATCH.includes(k))throw Error('unknown festival field');
   const [row]=await write(QT.name,{method:'PATCH',query:{id:`eq.${id}`,version:`eq.${version}`},body:{...to(QT,patch,false),version:version+1}});
   return from(QT,row,true);
  },
  async pulse(eventId){
   return (await readAll(QT.name,{select:'id,activity_id,revision,status,created_at',event_id:`eq.${eventId}`,status:'neq.hidden'})).map(r=>({id:r.id,activityId:r.activity_id,revision:Number(r.revision),status:r.status}));
  },
  async questionStats(eventId){
   const rows=await supa.admin.rest('rpc/fiiu_question_stats',{method:'POST',body:{p_event_id:eventId}});if(!Array.isArray(rows))unavailable();
   return new Map(rows.map(r=>[r.question_id,{people:Number(r.people),likes:Number(r.likes)}]));
  },
  async insertMessage(record){const [row]=await write(MT.name,{method:'POST',body:to(MT,record,false)});if(!row)unavailable();return from(MT,row,true);},
  async findMessage(id){return one(MT,{id});},
  async findMessageByClient(userId,clientId){return one(MT,{userId,clientId});},
  // The author filter rides in `and`, so it never meets the cursor's `or`.
  async latestMessages(questionId,{includeHidden=false,ownHidden=null,before=null,limit=TALK_LIMITS.page}={}){
   const hidden=includeHidden?{}:ownHidden?{and:`(or(hidden_at.is.null,user_id.eq.${token(ownHidden)}))`}:{hidden_at:'is.null'};
   const n=capped(limit,TALK_LIMITS.changes),query={select:select(MT),question_id:`eq.${questionId}`,deleted_at:'is.null',...hidden,order:'created_at.desc,id.desc',limit:n+1};
   if(before){
    if(typeof before.createdAt!=='string'||!TIME.test(before.createdAt)||typeof before.id!=='string'||!TOKEN.test(before.id))fail('invalid cursor');
    query.or=`(created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id}))`;
   }
   const rows=(await read(MT.name,query)).map(r=>from(MT,r,true));
   return {rows:rows.slice(0,n).reverse(),more:rows.length>n};
  },
  async messagesSince(questionId,since,{limit=TALK_LIMITS.changes+1}={}){
   return (await read(MT.name,{select:select(MT),question_id:`eq.${questionId}`,seq:`gt.${revisionOf(since)}`,order:'seq.asc',limit:capped(limit)})).map(r=>from(MT,r,true));
  },
  async updateMessage(filters,patch){
   if(!filters?.id)throw Error('scoped update required');checked(MT,filters);const body=to(MT,patch,false);if(!Object.keys(body).length)throw Error('empty festival update');
   const [row]=await write(MT.name,{method:'PATCH',query:eqs(filters),body});
   return from(MT,row,true);
  },
  async allMessages(questionId){return (await readAll(MT.name,{select:select(MT),question_id:`eq.${questionId}`})).map(r=>from(MT,r,true));},
  async userMessages(userId){return (await readAll(MT.name,{select:select(MT),user_id:`eq.${userId}`})).map(r=>from(MT,r,true));},
  // PostgREST has no coalesce, so already deleted messages keep their time in a first request and live ones get `at` in
  // the second; in that order no row is counted twice.
  async scrubUserMessages(userId,at){
   const blank={body:'',author_name:'',author_full:''};
   const old=await write(MT.name,{method:'PATCH',query:{user_id:`eq.${userId}`,deleted_at:'not.is.null',select:'id'},body:blank});
   const live=await write(MT.name,{method:'PATCH',query:{user_id:`eq.${userId}`,deleted_at:'is.null',select:'id'},body:{...blank,deleted_at:at}});
   return old.length+live.length;
  },
  async like(messageId,userId,at){
   const rows=await write('fiiu_message_likes',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:{message_id:messageId,user_id:userId,created_at:at}});
   return rows.length===1;
  },
  async unlike(messageId,userId){return (await write('fiiu_message_likes',{method:'DELETE',query:{message_id:`eq.${messageId}`,user_id:`eq.${userId}`,select:'message_id'}})).length>0;},
  async likedAmong(userId,messageIds){
   const out=new Set();
   for(const chunk of chunks(messageIds))for(const row of await read('fiiu_message_likes',{select:'message_id',user_id:`eq.${userId}`,message_id:list(chunk),limit:chunk.length}))out.add(row.message_id);
   return out;
  },
  async userLikes(userId){return (await readAll('fiiu_message_likes',{select:'message_id,created_at',user_id:`eq.${userId}`},'message_id')).map(r=>r.message_id);},
  async removeUserLikes(userId){return (await write('fiiu_message_likes',{method:'DELETE',query:{user_id:`eq.${userId}`,select:'message_id'}})).length;},
  // The RPC's trigger serialises one person's reservations and raises PFU01 over the allowance (pending files count).
  async reserveFile(record){
   let rows;
   try{rows=await supa.admin.rest('rpc/reserve_fiiu_file',{method:'POST',body:{p_file:to(FT,{...record,status:'pending'},false)}});}
   // A deadlock or serialisation failure left nothing behind, so the page may simply send the upload again.
   catch(err){if(err.code==='PFU01')allowance();if(['40P01','40001'].includes(err.code))failCode('upload changed; retry',409,'conflict');conflict(err);}
   if(!rows?.[0])unavailable();return from(FT,rows[0],true);
  },
  async setFileStatus(id,fromStatus,toStatus,{unattached=false}={}){
   if(!FILE_STATUSES.includes(fromStatus)||!FILE_STATUSES.includes(toStatus))throw Error('invalid file status');
   return from(FT,(await write(FT.name,{method:'PATCH',query:{id:`eq.${id}`,status:`eq.${fromStatus}`,...(unattached?{message_id:'is.null'}:{})},body:{status:toStatus}}))[0],true);
  },
  async findFile(id){return one(FT,{id});},
  async filesByIds(ids){
   const rows=[];for(const chunk of chunks(ids))rows.push(...await read(FT.name,{select:select(FT),id:list(chunk),order:'created_at.asc,id.asc',limit:chunk.length}));
   return rows.map(r=>from(FT,r,true));
  },
  async filesForMessages(messageIds){
   const rows=[];for(const chunk of chunks(messageIds))rows.push(...await readAll(FT.name,{select:select(FT),message_id:list(chunk),status:'eq.ready'}));
   return rows.map(r=>from(FT,r,true));
  },
  // Compare-and-set: only the poster's own ready, unattached files move, so a double post cannot share one file.
  async attachFiles(ids,messageId,userId){
   let total=0;
   for(const chunk of chunks(ids))total+=(await write(FT.name,{method:'PATCH',query:{id:list(chunk),user_id:`eq.${userId}`,status:'eq.ready',message_id:'is.null',select:'id'},body:{message_id:messageId}})).length;
   return total;
  },
  async userFiles(userId,{limit}={}){
   const query={select:select(FT),user_id:`eq.${userId}`};
   return (limit===undefined?await readAll(FT.name,query):await read(FT.name,{...query,order:'created_at.asc,id.asc',limit:capped(limit)})).map(r=>from(FT,r,true));
  },
  async removeFile(id){return (await write(FT.name,{method:'DELETE',query:{id:`eq.${id}`,select:'id'}})).length;},
  // Thumbnails are small JPEGs (or WebP) from the phone; the server sets the served type, so the stored one is nominal.
  async putBytes(file,variant,bytes){await objects.put(objectPath(file,variant),variant==='thumb'?'image/jpeg':file.mime,bytes);},
  async getBytes(file,variant){return objects.get(objectPath(file,variant));},
  async deleteBytes(file){await objects.remove([objectPath(file,'full'),objectPath(file,'thumb')]);},
 };
}
