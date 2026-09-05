import { COURSE_TABLES, COURSE_SQLITE_SCHEMA, snake } from './courses-schema.js';
import { createSupabaseClients } from './supabase.js';
import { fail } from './courses-domain.js';

const BUCKET = 'course-attachments';
function tableInfo(name) { const info = COURSE_TABLES[name]; if (!info) throw new Error('unknown course table'); return info; }
function checkedFields(info, record) {
  for (const field of Object.keys(record)) if (!info.fields.includes(field)) throw new Error(`unknown course field ${field}`);
  return record;
}
function fromRow(info, row) {
  if (!row) return null;
  return Object.fromEntries(info.fields.map(key => {
    let val = row[snake(key)];
    if (info.json.includes(key) && typeof val === 'string') val = JSON.parse(val);
    if (info.bool?.includes(key)) val = Boolean(val);
    return [key, val];
  }));
}
function toRow(info, record, sqlite) {
  checkedFields(info, record);
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [snake(key),
    sqlite && info.json.includes(key) ? JSON.stringify(value) : sqlite && typeof value === 'boolean' ? Number(value) : value,
  ]));
}
function optionsFor(info, options = {}) {
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('invalid course query limit');
  const order = options.order ?? (info.fields.includes('createdAt') ? ['createdAt','id'] : ['id']);
  for (const field of order) if (!info.fields.includes(field)) throw new Error('invalid course sort');
  if (options.after && !['createdAt,id','id'].includes(order.join(','))) throw new Error('cursor requires stable order');
  return { ...options, order, limit };
}

export function createCourseStore({ db, env = process.env, fetchImpl = fetch, clients } = {}) {
  if (db) {
    db.exec(COURSE_SQLITE_SCHEMA);
    const whereSql = (info, filters, options = {}) => {
      checkedFields(info, filters);
      const parts = [], params = [];
      for (const [key,val] of Object.entries(filters)) {
        parts.push(`${snake(key)} ${val === null ? 'IS NULL' : '= ?'}`);
        if (val !== null) params.push(typeof val === 'boolean' ? Number(val) : val);
      }
      if (options.after?.createdAt) { parts.push('(created_at > ? OR (created_at = ? AND id > ?))'); params.push(options.after.createdAt,options.after.createdAt,options.after.id); }
      else if(options.after) { parts.push('id > ?');params.push(options.after.id); }
      return { sql: parts.length ? ` WHERE ${parts.join(' AND ')}` : '', params };
    };
    return {
      kind: 'sqlite',
      async getMembers(ids) { if(!ids.length)return [];return db.prepare(`SELECT id,full_name AS name,email FROM users WHERE id IN (${ids.map(()=>'?').join(',')})`).all(...ids); },
      async count(name, filters = {}) { const info=tableInfo(name),where=whereSql(info,filters);return db.prepare(`SELECT count(*) AS n FROM ${info.table}${where.sql}`).get(...where.params).n; },
      async find(name, filters = {}, options = {}) {
        const info = tableInfo(name), opts = optionsFor(info,options), where = whereSql(info,filters,opts);
        return db.prepare(`SELECT * FROM ${info.table}${where.sql} ORDER BY ${opts.order.map(snake).join(',')} LIMIT ?`).all(...where.params,opts.limit).map(row => fromRow(info,row));
      },
      async insert(name, record) {
        const info=tableInfo(name), row=toRow(info,record,true), keys=Object.keys(row);
        try { return fromRow(info,db.prepare(`INSERT INTO ${info.table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')}) RETURNING *`).get(...Object.values(row))); }
        catch(err) { if (String(err.message).includes('UNIQUE constraint')) fail('record already exists',409); throw err; }
      },
      async update(name, filters, patch) {
        const info=tableInfo(name), row=toRow(info,patch,true), where=whereSql(info,filters);
        if (!where.sql) throw new Error('scoped update required');
        return fromRow(info,db.prepare(`UPDATE ${info.table} SET ${Object.keys(row).map(key=>`${key} = ?`).join(',')}${where.sql} RETURNING *`).get(...Object.values(row),...where.params));
      },
      async remove(name, filters) {
        const info=tableInfo(name), where=whereSql(info,filters);
        if (!where.sql) throw new Error('scoped deletion required');
        db.prepare(`DELETE FROM ${info.table}${where.sql}`).run(...where.params);
      },
      async putFile(attachment, bytes) { db.prepare('INSERT INTO course_attachment_bytes (id,bytes) VALUES (?,?)').run(attachment.id,bytes); },
      async getFile(attachment) { const row=db.prepare('SELECT bytes FROM course_attachment_bytes WHERE id=?').get(attachment.id); if(!row) fail('file unavailable',404);return Buffer.from(row.bytes); },
      async deleteFile(attachment) { db.prepare('DELETE FROM course_attachment_bytes WHERE id=?').run(attachment.id); },
    };
  }
  const supa = clients ?? createSupabaseClients({env,fetchImpl:(url,args)=>fetchImpl(url,{...args,signal:AbortSignal.timeout(15000)})});
  // Respect the project's PostgREST row cap without silently shortening a page.
  const readPage = async (table, query) => {
    const rows = [], limit = query.limit;
    while (rows.length < limit) {
      const page = await supa.admin.rest(table, {query:{...query,offset:rows.length,limit:limit-rows.length},includeRange:true});
      if (!Array.isArray(page.rows)) fail('course data unavailable',502);
      rows.push(...page.rows);
      const total = page.contentRange?.split('/')[1];
      if (!page.rows.length || (/^\d+$/.test(total ?? '') && rows.length >= Number(total))) break;
    }
    return rows.slice(0,limit);
  };
  const queryFor = (info,filters,options) => {
    checkedFields(info,filters);
    const opts=optionsFor(info,options);
    const query={select:info.fields.map(snake).join(','),order:opts.order.map(key=>`${snake(key)}.asc`).join(','),limit:opts.limit};
    for(const [key,value] of Object.entries(filters)) query[snake(key)] = value === null ? 'is.null' : `eq.${value}`;
    if(opts.after?.createdAt) query.or=`(created_at.gt.${opts.after.createdAt},and(created_at.eq.${opts.after.createdAt},id.gt.${opts.after.id}))`;
    else if(opts.after)query.id=`gt.${opts.after.id}`;
    return query;
  };
  const storage = async (attachment, {method='GET',body}={}) => {
    const credentials=supa.env;
    const url=`${credentials.url}/storage/v1/object/${BUCKET}/${attachment.storagePath.split('/').map(encodeURIComponent).join('/')}`;
    const response=await fetchImpl(url,{method,body,headers:{apikey:credentials.serverKey,Authorization:`Bearer ${credentials.serverKey}`,'Content-Type':attachment.mime,'x-upsert':'false'},signal:AbortSignal.timeout(20000)});
    if(!response.ok) fail('attachment storage unavailable',502);
    return response;
  };
  return {
    kind:'supabase',
    async getMembers(ids) { if(!ids.length)return [];return (await readPage('profiles',{id:`in.(${ids.join(',')})`,select:'id,full_name,email',order:'id.asc',limit:500})).map(row=>({id:row.id,name:row.full_name,email:row.email})); },
    async count(name,filters={}) {
      const info=tableInfo(name),query=queryFor(info,filters,{limit:1});query.select='id';delete query.order;
      const credentials=supa.env;
      const response=await fetchImpl(`${credentials.url}/rest/v1/${info.table}?${new URLSearchParams(query)}`,{method:'HEAD',headers:{apikey:credentials.serverKey,Authorization:`Bearer ${credentials.serverKey}`,Prefer:'count=exact'},signal:AbortSignal.timeout(15000)});
      const total=response.headers.get('content-range')?.split('/')[1];
      if(!response.ok||!/^\d+$/.test(total??''))fail('course totals unavailable',502);
      return Number(total);
    },
    async find(name,filters={},options={}) { const info=tableInfo(name);return (await readPage(info.table,queryFor(info,filters,options))).map(row=>fromRow(info,row)); },
    async insert(name,record) {
      const info=tableInfo(name);
      try { return fromRow(info,(await supa.admin.rest(info.table,{method:'POST',headers:{Prefer:'return=representation'},body:toRow(info,record,false)}))[0]); }
      catch(err) { if(err.code==='23505') fail('record already exists',409);throw err; }
    },
    async update(name,filters,patch) {
      const info=tableInfo(name);if(!Object.keys(filters).length)throw new Error('scoped update required');
      const query=queryFor(info,filters,{});delete query.order;delete query.limit;
      return fromRow(info,(await supa.admin.rest(info.table,{method:'PATCH',query,headers:{Prefer:'return=representation'},body:toRow(info,patch,false)}))[0]);
    },
    async remove(name,filters) {
      const info=tableInfo(name);if(!Object.keys(filters).length)throw new Error('scoped deletion required');
      const query=queryFor(info,filters,{});delete query.order;delete query.limit;
      await supa.admin.rest(info.table,{method:'DELETE',query});
    },
    async putFile(attachment,bytes) { await storage(attachment,{method:'POST',body:bytes}); },
    async getFile(attachment) { return Buffer.from(await (await storage(attachment)).arrayBuffer()); },
    async deleteFile(attachment) {
      const credentials=supa.env;
      const response=await fetchImpl(`${credentials.url}/storage/v1/object/${BUCKET}`,{method:'DELETE',headers:{apikey:credentials.serverKey,Authorization:`Bearer ${credentials.serverKey}`,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[attachment.storagePath]}),signal:AbortSignal.timeout(20000)});
      if(!response.ok) fail('attachment cleanup unavailable',502);
    },
  };
}
