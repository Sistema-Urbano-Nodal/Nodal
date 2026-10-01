import {randomUUID} from 'node:crypto';
import {fail,identifier} from './courses-domain.js';
import {bodyJson} from './courses-api.js';

export const NEWS_LIMITS={title:160,body:2000,url:500,page:10,maxPage:50,adminPage:50};
const now=()=>new Date().toISOString();
const CHANGED='news item changed; reload before saving';
// Validation errors name the field so the desk can mark it; createNewsApi answers them as 400 {error, field}.
const invalid=(field,message=`${field} is invalid`)=>{throw Object.assign(new Error(message),{status:400,field});};
const newsId=(value,field='id')=>{try{return identifier(value);}catch{return invalid(field);}};
function newsUrl(value){
 if(typeof value!=='string')invalid('url','url must be text');
 const raw=value.trim();if(!raw)return '';
 if(raw.length>NEWS_LIMITS.url)invalid('url','url is too long');
 let parsed;try{parsed=new URL(raw);}catch{invalid('url','url must be an https:// address');}
 if(!/^https:\/\//i.test(raw)||parsed.protocol!=='https:'||parsed.username||parsed.password||!parsed.hostname)invalid('url','url must be a public https:// address');
 if(parsed.href.length>NEWS_LIMITS.url)invalid('url','url is too long');
 return parsed.href;
}
const NEWS_DEFAULTS={title:'',body:'',url:'',pinned:false,status:'draft'};
// A new item starts from the defaults; a PATCH starts from the stored row, so omitted fields keep their value.
export function normalizeNews(input,current=NEWS_DEFAULTS){
 const pick=k=>input[k]===undefined?current[k]:input[k],title=pick('title'),body=pick('body'),pinned=pick('pinned'),status=pick('status');
 if(typeof title!=='string')invalid('title','title must be text');
 const cleanTitle=title.trim();if(!cleanTitle)invalid('title','title is required');if(cleanTitle.length>NEWS_LIMITS.title)invalid('title','title is too long');
 if(typeof body!=='string')invalid('body','body must be text');
 const cleanBody=body.trim();if(cleanBody.length>NEWS_LIMITS.body)invalid('body','body is too long');
 if(typeof pinned!=='boolean')invalid('pinned','pinned must be true or false');
 if(!['draft','published'].includes(status))invalid('status','status must be draft or published');
 return {title:cleanTitle,body:cleanBody,url:newsUrl(pick('url')),pinned,status};
}
// Neither view carries created_by: authorship stays in the database for accountability and account erasure.
export const newsView=({id,title,body,url,pinned,publishedAt})=>({id,title,body,url,pinned,publishedAt});
export const newsAdminView=({id,title,body,url,pinned,status,publishedAt,createdAt,updatedAt,version})=>({id,title,body,url,pinned,status,publishedAt,createdAt,updatedAt,version});
// Cursors carry the last row's sort key, not just its id, so an edit between two page requests cannot move the
// boundary. The timestamp lands inside a PostgREST filter, so only a strict timestamp and a UUID are accepted.
const STAMP=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const stamp=value=>{if(typeof value!=='string'||!STAMP.test(value)||!Number.isFinite(Date.parse(value)))throw Error('bad stamp');return value;};
export const encodeNewsCursor=(row,published)=>Buffer.from(JSON.stringify(published?[row.pinned?1:0,row.publishedAt,row.id]:[row.createdAt,row.id])).toString('base64url');
export function decodeNewsCursor(raw,published){
 try{
  if(!/^[A-Za-z0-9_-]{1,300}$/.test(raw))throw Error('bad cursor');
  const parts=JSON.parse(Buffer.from(raw,'base64url').toString('utf8'));
  if(!Array.isArray(parts)||parts.length!==(published?3:2))throw Error('bad cursor');
  if(!published)return {createdAt:stamp(parts[0]),id:identifier(parts[1])};
  if(parts[0]!==0&&parts[0]!==1)throw Error('bad cursor');
  return {pinned:parts[0]===1,publishedAt:stamp(parts[1]),id:identifier(parts[2])};
 }catch{return invalid('cursor');}
}
// Public:  GET|HEAD /api/news?cursor=&limit=   → 200 {items:[newsView], nextCursor|null}  (published, pinned first, newest)
// Admin:   GET|HEAD /api/admin/news?cursor=    → 200 {items:[newsAdminView], nextCursor|null} (all, newest written first)
//          POST /api/admin/news {id?,title,body,url,pinned,status} → 201 {item}; an existing id answers 200 {item} for an identical
//          retry and 409 {error,code:'version_conflict',item} when the content differs
//          PATCH /api/admin/news/:id {version,...fields} → 200 {item} | 409 {error,code:'version_conflict',item} | 404
//          DELETE /api/admin/news/:id → 204 (also when it was already gone)
export function createNewsApi({store,sameOrigin,send,rateLimit=()=>true}){
 const body=req=>bodyJson(req,32768);
 const page=async(url,published)=>{
  const cursor=url.searchParams.get('cursor')||'',rawLimit=published?url.searchParams.get('limit')||'':'';
  if(rawLimit&&(!/^[1-9]\d{0,2}$/.test(rawLimit)||Number(rawLimit)>NEWS_LIMITS.maxPage))invalid('limit');
  const limit=rawLimit?Number(rawLimit):published?NEWS_LIMITS.page:NEWS_LIMITS.adminPage;
  // One extra row tells whether another page exists, so the last page never hands out an empty follow-up cursor.
  const rows=await store.list({published,after:cursor?decodeNewsCursor(cursor,published):null,limit:limit+1}),items=rows.slice(0,limit);
  return {items:items.map(published?newsView:newsAdminView),nextCursor:rows.length>limit?encodeNewsCursor(items.at(-1),published):null};
 };
 const conflicted=(res,item)=>{send(res,409,{error:CHANGED,code:'version_conflict',item:newsAdminView(item)});return true;};
 return async({req,res,url,user})=>{
  const path=url.pathname;
  if(!/^\/api\/(?:admin\/)?news(?:\/|$)/.test(path))return false;
  const staff=path.startsWith('/api/admin/'),read=['GET','HEAD'].includes(req.method);
  // The public feed is read-only; HEAD is answered like GET (Node sends no body for it).
  if(path==='/api/news'&&!read){send(res,405,{error:'method not allowed'},{Allow:'GET, HEAD'});return true;}
  if(staff&&!user){send(res,401,{error:'sign in required'});return true;}
  if(staff&&user.permission!=='admin'){send(res,403,{error:'administrator access required'});return true;}
  if(!read&&!sameOrigin(req)){send(res,403,{error:'cross-origin request rejected'});return true;}
  if(!rateLimit(req,res,user,path))return true;
  try{
   if(path==='/api/news'){send(res,200,await page(url,true));return true;}
   if(path==='/api/admin/news'){
    if(read){send(res,200,await page(url,false));return true;}
    if(req.method!=='POST'){send(res,405,{error:'method not allowed'},{Allow:'GET, HEAD, POST'});return true;}
    // The desk makes one UUID per new item and reuses it on retry: a save whose response was lost then returns the
    // stored row instead of publishing twice. Only an identical retry is answered that way; different content under
    // a stored id (edited, or published, after the lost save) is a version conflict, so the desk never reports a
    // save that did not happen.
    const input=await body(req),fields=normalizeNews(input),id=input.id==null?randomUUID():newsId(input.id),at=now();
    let item;try{item=await store.insert({id,...fields,publishedAt:fields.status==='published'?at:null,createdAt:at,updatedAt:at,createdBy:user.id,version:1});}
    catch(err){
     const existing=input.id!=null&&err.status===409&&await store.get(id);if(!existing)throw err;
     if(Object.keys(fields).some(k=>existing[k]!==fields[k]))return conflicted(res,existing);
     send(res,200,{item:newsAdminView(existing)});return true;
    }
    send(res,201,{item:newsAdminView(item)});return true;
   }
   const match=path.match(/^\/api\/admin\/news\/([^/]+)$/);
   if(match){
    if(!['PATCH','DELETE'].includes(req.method)){send(res,405,{error:'method not allowed'},{Allow:'PATCH, DELETE'});return true;}
    const id=newsId(match[1]);
    if(req.method==='DELETE'){await store.remove(id);send(res,204,'');return true;}
    const input=await body(req);
    if(!Number.isSafeInteger(input.version)||input.version<1)invalid('version','version is required');
    const current=await store.get(id);if(!current)fail('news item unavailable',404);
    if(current.version!==input.version)return conflicted(res,current);
    // publishedAt is stamped on the first move to 'published' and kept through unpublishing and republishing.
    const fields=normalizeNews(input,current),at=now();
    const item=await store.update(id,input.version,{...fields,...(fields.status==='published'&&!current.publishedAt?{publishedAt:at}:{}),updatedAt:at,version:input.version+1});
    if(item){send(res,200,{item:newsAdminView(item)});return true;}
    const latest=await store.get(id);if(!latest)fail('news item unavailable',404);return conflicted(res,latest);
   }
   send(res,404,{error:'not found'});return true;
  }catch(err){if(err.status===400&&err.field){send(res,400,{error:err.message,field:err.field});return true;}throw err;}
 };
}
