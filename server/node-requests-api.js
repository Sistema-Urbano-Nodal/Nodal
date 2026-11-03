import {randomUUID} from 'node:crypto';
import {fail,identifier} from './courses-domain.js';
import {bodyJson} from './courses-api.js';
import {validateEmail} from './auth.js';
import {validAddress} from './mailer.js';
import {encodeNewsCursor,decodeNewsCursor} from './news-api.js';

/* Organisation node requests: the landing page's no-account form (spec: docs/superpowers/specs/2026-11-03-organisation-
   node-requests-design.md). A request is stored first, then the team notice (server/node-requests-email.js) runs inside
   the request, bounded by the mailer's timeout, and its outcome is written on the row. */
export const NODE_REQUEST_LIMITS={name:120,organization:160,email:254,phone:40,message:1000,page:24,emailsPerDay:40,retentionMonths:12};
const STATUSES=['new','contacted','closed'],LANGUAGES=['es','en','pt'],QUERY_KEYS=['status','limit','cursor'];
const CHANGED='node request changed; reload before saving';
const invalid=(field,message=`${field} is invalid`)=>{throw Object.assign(new Error(message),{status:400,field});};
const requestId=value=>{try{return identifier(value);}catch{return invalid('id');}};
// Lima keeps UTC-05:00 all year (no DST), so its midnight is a fixed offset from UTC.
const LIMA_MS=5*3600000,DAY_MS=86400000;
export const limaDayStart=ms=>new Date(Math.floor((ms-LIMA_MS)/DAY_MS)*DAY_MS+LIMA_MS).toISOString();
const retentionCutoff=ms=>{const day=new Date(ms);day.setUTCMonth(day.getUTCMonth()-NODE_REQUEST_LIMITS.retentionMonths);return day.toISOString();};
// The desk's view: everything the team needs to answer, not who changed it last.
export const nodeRequestAdminView=({id,name,organization,email,phone,message,language,status,emailStatus,createdAt,updatedAt,version})=>({id,name,organization,email,phone,message,language,status,emailStatus,createdAt,updatedAt,version});

// C0 and C1 controls and the bidi embeddings, overrides and isolates: PostgreSQL refuses a NUL (a 503 for a typo) and
// the others turn the desk's and the team email's text around. Only the message keeps its line breaks and tabs.
const UNSAFE=/[\p{Cc}\u202A-\u202E\u2066-\u2069]/u,UNSAFE_IN_LINES=/(?![\n\r\t])[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;
// Strings are trimmed (and lower-cased when asked) before the length check; a missing or blank required field is
// "required", the rest name what is wrong.
function text(input,field,{required=true,lower=false}={}){
 const value=input[field];
 if(value==null){if(required)invalid(field,`${field} is required`);return '';}
 if(typeof value!=='string')invalid(field,`${field} must be text`);
 const clean=lower?value.trim().toLowerCase():value.trim();
 if(required&&!clean)invalid(field,`${field} is required`);
 if((field==='message'?UNSAFE_IN_LINES:UNSAFE).test(clean))invalid(field,`${field} has a control or text-direction character`);
 if(clean.length>NODE_REQUEST_LIMITS[field])invalid(field,`${field} is too long`);
 return clean;
}
// The fields in the form's order, so the first problem reported is the first one the visitor sees.
function normalizeNodeRequest(input){
 const name=text(input,'name'),organization=text(input,'organization');
 // The mailer's rule too: the team replies through Reply-To, and an address it refuses would leave its default there.
 const email=text(input,'email',{lower:true});if(!validateEmail(email)||!validAddress(email))invalid('email','email is invalid');
 let phone=text(input,'phone',{required:false});
 if(phone&&!/^[0-9+() -]+$/.test(phone))invalid('phone','phone may hold only digits, spaces and + ( ) -');
 // A phone without a digit ("+", "( )") carries nothing to call.
 if(!/\d/.test(phone))phone=null;
 const message=text(input,'message');
 const language=input.language==null?'es':typeof input.language==='string'?input.language.trim():input.language;
 if(!LANGUAGES.includes(language))invalid('language','language must be es, en or pt');
 return {name,organization,email,phone,message,language};
}
// The honeypot: a field people never see. Anything in it but blank text is a bot.
const trapped=({website})=>typeof website==='string'?Boolean(website.trim()):website!=null;
// Logs carry the request id and an error's status only: never an address, a name, a phone or the message.
const reason=err=>Number.isInteger(err?.status)?` (status ${err.status})`:'';

// Public:  POST /api/node-requests {name,organization,email,phone?,message,language?,website?} → 202 {ok:true} (also for a
//          filled honeypot) | 400 {error,field} | 403 | 429 | 503 {error:'service unavailable'} (nothing stored or sent)
// Admin:   GET|HEAD /api/admin/node-requests?status=&limit=&cursor= → 200 {requests:[nodeRequestAdminView], nextCursor|null}
//          PATCH /api/admin/node-requests/:id {status,version} → 200 {request} | 409 {error,code:'version_conflict',request} | 404
//          DELETE /api/admin/node-requests/:id → 204 (also when it was already gone)
// ipAllowed(req,res), emailAllowed(email,res) and adminRateLimit(req,res,user) answer the 429 themselves when they refuse.
export function createNodeRequestApi({store,notify,sameOrigin,send,now=()=>Date.now(),ipAllowed=()=>true,emailAllowed=()=>true,adminRateLimit=()=>true,log=message=>console.warn(message)}){
 const body=req=>bodyJson(req,16384);
 // Closed requests leave 12 calendar months after their last change. Best effort: a failure never fails the request.
 const purge=async()=>{try{await store.purgeClosedBefore(retentionCutoff(now()));}catch(err){log(`Node request purge failed${reason(err)}`);}};
 // 'off' without a notifier (email gated or not configured) or past the day's ceiling, counted in the database so it
 // holds across instances. The count takes in this request's own row (inserted before) and every send still in flight
 // (null), so concurrent requests never email more than 40 a Lima day.
 async function emailOutcome(request){
  if(!notify)return 'off';
  try{if(await store.countEmailedSince(limaDayStart(now()))>NODE_REQUEST_LIMITS.emailsPerDay){log(`Node request email off for request ${request.id}: ${NODE_REQUEST_LIMITS.emailsPerDay} requests already emailed today in Lima`);return 'off';}}
  catch(err){log(`Node request email off for request ${request.id}: the day's count is unavailable${reason(err)}`);return 'off';}
  try{return await notify({request});}catch{log(`Node request email failed for request ${request.id}`);return 'failed';}
 }
 async function accept(req,res){
  if(!sameOrigin(req)){send(res,403,{error:'cross-origin request rejected'});return;}
  if(!ipAllowed(req,res))return;
  const input=await body(req),fields=normalizeNodeRequest(input);
  if(trapped(input)){send(res,202,{ok:true});return;}
  if(!emailAllowed(fields.email,res))return;
  await purge();
  const at=new Date(now()).toISOString();
  let request;
  try{request=await store.insert({id:randomUUID(),...fields,status:'new',emailStatus:null,createdAt:at,updatedAt:at,updatedBy:null,version:1});}
  catch(err){log(`Node request not stored${reason(err)}`);send(res,503,{error:'service unavailable'});return;}
  // Awaited: Vercel gives no work time after the response. The visitor's request is stored whatever happens next.
  const outcome=await emailOutcome(request);
  try{await store.setEmailStatus(request.id,outcome);}catch(err){log(`Node request ${request.id}: the email status '${outcome}' could not be saved${reason(err)}`);}
  send(res,202,{ok:true});
 }
 // Same rules as the Interests queue: known keys once each, a status from the list, at most a page, a valid cursor.
 // The cursor is the news desk's (the last row's createdAt and id), checked strictly before it reaches a PostgREST filter.
 async function page(url){
  const params=url.searchParams;
  if([...params.keys()].some(key=>!QUERY_KEYS.includes(key)))invalid('query','query is invalid');
  const one=key=>{const values=params.getAll(key);if(values.length>1)invalid(key);return values[0];};
  const status=one('status'),rawLimit=one('limit'),cursor=one('cursor');
  if(status!==undefined&&!STATUSES.includes(status))invalid('status');
  if(rawLimit!==undefined&&(!/^[1-9]\d{0,2}$/.test(rawLimit)||Number(rawLimit)>NODE_REQUEST_LIMITS.page))invalid('limit');
  const limit=rawLimit===undefined?NODE_REQUEST_LIMITS.page:Number(rawLimit),after=cursor===undefined?null:decodeNewsCursor(cursor,false);
  await purge();
  // One extra row tells whether another page exists, so the last page never hands out an empty follow-up cursor.
  const rows=await store.list({status:status??null,after,limit:limit+1}),requests=rows.slice(0,limit);
  return {requests:requests.map(nodeRequestAdminView),nextCursor:rows.length>limit?encodeNewsCursor(requests.at(-1),false):null};
 }
 const conflicted=(res,request)=>{send(res,409,{error:CHANGED,code:'version_conflict',request:nodeRequestAdminView(request)});return true;};
 return async({req,res,url,user})=>{
  const path=url.pathname;
  if(!/^\/api\/(?:admin\/)?node-requests(?:\/|$)/.test(path))return false;
  try{
   if(path==='/api/node-requests'){
    if(req.method!=='POST'){send(res,405,{error:'method not allowed'},{Allow:'POST'});return true;}
    await accept(req,res);return true;
   }
   if(!path.startsWith('/api/admin/')){send(res,404,{error:'not found'});return true;}
   if(!user){send(res,401,{error:'sign in required'});return true;}
   if(user.permission!=='admin'){send(res,403,{error:'administrator access required'});return true;}
   if(path==='/api/admin/node-requests'){
    if(!['GET','HEAD'].includes(req.method)){send(res,405,{error:'method not allowed'},{Allow:'GET, HEAD'});return true;}
    send(res,200,await page(url));return true;
   }
   const match=path.match(/^\/api\/admin\/node-requests\/([^/]+)$/);
   if(!match){send(res,404,{error:'not found'});return true;}
   if(!['PATCH','DELETE'].includes(req.method)){send(res,405,{error:'method not allowed'},{Allow:'PATCH, DELETE'});return true;}
   if(!sameOrigin(req)){send(res,403,{error:'cross-origin request rejected'});return true;}
   if(!adminRateLimit(req,res,user))return true;
   const id=requestId(match[1]);
   if(req.method==='DELETE'){await store.remove(id);send(res,204,'');return true;}
   const input=await body(req);
   if(!Number.isSafeInteger(input.version)||input.version<1)invalid('version','version is required');
   if(!STATUSES.includes(input.status))invalid('status','status must be new, contacted or closed');
   const current=await store.get(id);if(!current)fail('node request unavailable',404);
   if(current.version!==input.version)return conflicted(res,current);
   const request=await store.update(id,input.version,{status:input.status,updatedAt:new Date(now()).toISOString(),updatedBy:user.id,version:input.version+1});
   if(request){send(res,200,{request:nodeRequestAdminView(request)});return true;}
   const latest=await store.get(id);if(!latest)fail('node request unavailable',404);return conflicted(res,latest);
  }catch(err){if(err.status===400&&err.field){send(res,400,{error:err.message,field:err.field});return true;}throw err;}
 };
}
