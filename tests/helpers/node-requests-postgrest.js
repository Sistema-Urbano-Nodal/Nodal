import assert from 'node:assert/strict';

/* An in-memory PostgREST for node_requests, behind createNodeRequestStore({clients}) in the store and API tests:
   eq/lt/gte/neq/is/not.is leaves inside and()/or() trees, select, order, limit and exact counts, the table's status
   and kind CHECKs, and the defaults of kind, community and memberships. Timestamps are compared to the microsecond and printed the way PostgreSQL's to_json does (+00:00, the
   fraction's trailing zeros dropped), so cursors and filters are exercised in the production format. */
const STAMP=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;
export const micros=value=>{const m=STAMP.exec(value);assert.ok(m,`a timestamp: ${value}`);return BigInt(Date.parse(m[1]+m[3]))*1000n+BigInt((m[2]??'').padEnd(6,'0'));};
export const pgStamp=value=>{const us=micros(value),fraction=String(us%1000000n).padStart(6,'0').replace(/0+$/,'');
 return `${new Date(Number(us/1000000n)*1000).toISOString().slice(0,19)}${fraction?`.${fraction}`:''}+00:00`;};

export function nodeRequestsPostgrest(){
 const rows=[],calls=[],stamp=key=>key.endsWith('_at');
 const cmp=(key,a,b)=>a===b?0:a==null?-1:b==null?1:stamp(key)?(micros(a)<micros(b)?-1:micros(a)>micros(b)?1:0):a<b?-1:1;
 const split=text=>{const out=[];let depth=0,start=0;for(let i=0;i<text.length;i++){if(text[i]==='(')depth++;else if(text[i]===')')depth--;else if(text[i]===','&&!depth){out.push(text.slice(start,i));start=i+1;}}return [...out,text.slice(start)];};
 const leaf=(row,key,expr)=>{
  if(expr==='is.null')return row[key]==null;
  if(expr==='not.is.null')return row[key]!=null;
  const [op,...rest]=expr.split('.'),value=rest.join('.'),actual=row[key]==null?null:String(row[key]);
  if(actual===null&&op!=='eq')return false;const c=cmp(key,actual,value);
  return op==='eq'?c===0:op==='neq'?c!==0:op==='lt'?c<0:op==='gte'?c>=0:assert.fail('unsupported filter '+expr);};
 const node=(row,text)=>{const m=/^(and|or)\((.*)\)$/.exec(text);if(m)return split(m[2])[m[1]==='and'?'every':'some'](part=>node(row,part));const [key,...expr]=text.split('.');return leaf(row,key,expr.join('.'));};
 const matches=(row,query)=>Object.entries(query).every(([key,expr])=>['select','order','limit'].includes(key)||(key==='or'||key==='and'?node(row,`${key}${expr}`):leaf(row,key,expr)));
 const sorter=order=>(a,b)=>{for(const part of order.split(',')){const [key,dir]=part.split('.'),c=cmp(key,a[key],b[key]);if(c)return dir==='desc'?-c:c;}return 0;};
 // The representation: only the selected columns (every column without select), timestamps as PostgreSQL prints them.
 const pg=(row,select)=>Object.fromEntries((select?select.split(','):Object.keys(row)).map(k=>{assert.ok(k in row,`unknown column ${k}`);return [k,stamp(k)&&row[k]?pgStamp(row[k]):row[k]];}));
 const error=(code,message)=>Object.assign(Error(message),{status:409,expose:false,code});
 async function rest(table,options={}){
  assert.equal(table,'node_requests');calls.push(structuredClone(options));const query=options.query??{};
  if(query.offset!==undefined)assert.fail('never OFFSET');
  if(!options.method){
   const found=rows.filter(row=>matches(row,query)).sort(sorter(query.order??'id.asc')),page=found.slice(0,query.limit??Infinity).map(row=>pg(row,query.select));
   return options.includeRange?{rows:page,contentRange:`${page.length?`0-${page.length-1}`:'*'}/${options.headers?.Prefer==='count=exact'?found.length:'*'}`}:page;
  }
  if(options.method==='POST'){
   const row=structuredClone(options.body);
   if(rows.some(r=>r.id===row.id))throw error('23505','duplicate key value violates unique constraint');
   // PostgreSQL's defaults for the columns an older insert leaves out, then its CHECKs.
   row.kind??='node';row.community??=null;row.memberships??=null;
   if(!['new','contacted','closed'].includes(row.status)||!['node','sponsorship'].includes(row.kind))throw error('23514','violates check constraint');
   rows.push(row);return [pg(row,query.select)];
  }
  const hit=rows.filter(row=>matches(row,query));
  if(options.method==='PATCH'){hit.forEach(row=>Object.assign(row,structuredClone(options.body)));return hit.map(row=>pg(row,query.select));}
  assert.equal(options.method,'DELETE');
  for(const row of hit)rows.splice(rows.indexOf(row),1);return hit.map(row=>pg(row,query.select));
 }
 return {rows,calls,clients:{admin:{rest}}};
}
