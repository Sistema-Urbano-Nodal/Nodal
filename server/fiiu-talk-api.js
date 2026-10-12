import {randomUUID} from 'node:crypto';
import {fail,identifier,csv,attachmentFilename,encodeCursor,decodeCursor} from './courses-domain.js';
import {bodyJson,createByteBudget,matchesEtag,DOWNLOAD_LIMITS} from './courses-api.js';
import {EVENT_ID} from './fiiu-domain.js';
import {packBits} from './qr.js';
import {TALK_LIMITS,talkActivity,normalizeQuestion,normalizeMessage,decodeTalkFile,namesFor,questionView,messageView,goneView,activityView} from './fiiu-talk-domain.js';

/* FIIU block conversations over HTTP. The pulse is the one public route: ids, blocks, revisions and statuses, the same
   for everyone, so the CDN answers the 4-second polls of a full auditorium (one venue address) and a phone fetches
   messages only when its question's revision moved. Everything else needs a festival registration or an organiser. */
const PULSE_CACHE='public, max-age=0, s-maxage=2, stale-while-revalidate=4';
const PULSE_MS=1000,MEMO_MS=60000,MEMO_MAX=5000,UPLOAD_GRACE_MS=10*60000;
const CSV_HEADER=['question','block','talk','createdAtLima','author','email','organiser','text','files','likes','hidden','deleted'];
// The chat pages translate refusals by code (see fiiu-talk-domain.js); the global handler would drop it, so it is sent here.
const failCode=(message,status,code)=>{try{fail(message,status);}catch(err){throw Object.assign(err,{code});}};
const unavailable=()=>failCode('question unavailable',404,'question_unavailable');
const messageUnavailable=()=>failCode('message unavailable',404,'message_unavailable');
const fileUnavailable=status=>failCode('file unavailable',status,'file_unavailable');
const errorText=error=>error instanceof Error?error.message:String(error??'unknown error');
// CSV times are Lima wall-clock time (UTC-05:00 all year), as in the registration export.
const limaTime=value=>{const t=Date.parse(value??'');return Number.isFinite(t)?new Date(t-5*3600000).toISOString().slice(0,16).replace('T',' '):'';};
// The encoder returns {size, modules} (row-major 0/1) or already-packed {size, bits}, as on the check-in screen.
const qrView=qr=>typeof qr?.bits==='string'?{size:qr.size,bits:qr.bits}:{size:qr.size,bits:packBits(qr)};
const body=req=>bodyJson(req,24576);
// A 3 MB file is ~4 MiB of base64; the 100 KB thumbnail and the JSON around them fit in the extra 160 KiB.
const uploadBody=req=>bodyJson(req,4*1024*1024+160*1024);
// Thumbnails are the phone's JPEG or WebP; the stored row only says one exists, so the type comes from the bytes.
const thumbType=bytes=>bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'image/webp':'image/jpeg';
const ROUTES=[
 ['pulse',/^\/api\/fiiu\/pulse$/,['GET','HEAD']],
 ['questions',/^\/api\/fiiu\/questions$/,['GET','HEAD']],
 ['question',/^\/api\/fiiu\/questions\/([^/]+)$/,['GET','HEAD']],
 ['messages',/^\/api\/fiiu\/questions\/([^/]+)\/messages$/,['GET','HEAD','POST']],
 ['message',/^\/api\/fiiu\/messages\/([^/]+)$/,['DELETE']],
 ['like',/^\/api\/fiiu\/messages\/([^/]+)\/like$/,['PUT','DELETE']],
 ['upload',/^\/api\/fiiu\/files$/,['POST']],
 ['file',/^\/api\/fiiu\/files\/([^/]+)$/,['GET','HEAD']],
 ['adminQuestions',/^\/api\/admin\/fiiu\/questions$/,['GET','HEAD','POST']],
 ['adminQuestion',/^\/api\/admin\/fiiu\/questions\/([^/]+)$/,['PATCH']],
 ['hidden',/^\/api\/admin\/fiiu\/messages\/([^/]+)\/hidden$/,['PUT','DELETE']],
 ['export',/^\/api\/admin\/fiiu\/questions\/([^/]+)\/export$/,['GET','HEAD']],
 ['qr',/^\/api\/admin\/fiiu\/questions\/([^/]+)\/qr$/,['GET','HEAD']],
];
const routeOf=path=>{for(const [name,pattern,methods] of ROUTES){const m=path.match(pattern);if(m)return {name,param:m[1],methods};}return null;};
// Each write spends its own per-account budget (server.js): a busy chat never blocks likes or moderation.
const kindOf=(name,read)=>read?'read':{messages:'message',upload:'upload',like:'like',hidden:'moderate'}[name]??'write';

export async function exportTalkData(store,userId){
 const [messages,files,likedMessageIds]=await Promise.all([store.userMessages(userId),store.userFiles(userId),store.userLikes(userId)]);
 const questions=new Map();
 for(const id of new Set(messages.map(m=>m.questionId)))questions.set(id,await store.getQuestion(id));
 return {
  messages:messages.map(m=>({id:m.id,questionId:m.questionId,question:questions.get(m.questionId)?.body??'',body:m.body,createdAt:m.createdAt,deleted:Boolean(m.deletedAt),hidden:Boolean(m.hiddenAt)})),
  // Storage paths are internal.
  files:files.map(({id,messageId,name,mime,size,createdAt})=>({id,messageId,name,mime,size,createdAt})),
  likedMessageIds,
 };
}
/* Before the account goes: its files (object, then row, so a Storage failure stops here and the deletion can be
   retried), then the text and names of its messages (the conversation keeps a 'deleted message' placeholder), then its
   likes. An upload under way could reach Storage after its row is gone, where nothing would find it again, so a recent
   pending upload refuses for those few minutes; an older one is abandoned and cleared like the rest. */
export async function deleteTalkData(store,userId,{now=Date.now()}={}){
 const busy=()=>fail('An upload is in progress. Try again in a few minutes.',409);
 const files=await store.userFiles(userId);
 if(files.some(f=>f.status==='pending'&&now-Date.parse(f.createdAt)<UPLOAD_GRACE_MS))busy();
 for(const file of files){
  const claimed=file.status==='deleting'?file:await store.setFileStatus(file.id,file.status,'deleting');
  if(!claimed)continue;
  await store.deleteBytes(claimed);await store.removeFile(claimed.id);
 }
 // A file that changed state under us (an upload finishing) would block the account's deletion; ask for a retry.
 if((await store.userFiles(userId,{limit:1})).length)busy();
 await store.scrubUserMessages(userId,new Date(now).toISOString());
 await store.removeUserLikes(userId);
}

// publicOrigin: the configured site origin (a string or a function of the request) the projector QR points to.
// downloads: the byte budget shared with the course files (server.js), so one account cannot double its Storage egress.
export function createTalkApi({store,sameOrigin,send,rateLimit=()=>true,downloads=createByteBudget(DOWNLOAD_LIMITS),encodeQr=null,publicOrigin=()=>fail('public base URL is not configured',503),clock=Date.now,log=console.error}){
 const now=()=>new Date(clock()).toISOString();
 const qrOf=link=>{if(!encodeQr)return null;try{return qrView(encodeQr(link));}catch{return null;}};
 const originFor=req=>(typeof publicOrigin==='function'?publicOrigin(req):publicOrigin)||fail('public base URL is not configured',503);
 /* Registered means a fiiu_registrations row. A full room polls together, so a positive answer is kept for 60 seconds
    (cancelling ends access within that window); a refusal is never kept, so registering takes effect at once. Organisers
    pass without one; their registration is read only to name their messages. */
 const memo=new Map();
 async function registrationOf(userId){
  const t=clock(),hit=memo.get(userId);
  if(hit&&t-hit.at<MEMO_MS)return hit.registration;
  memo.delete(userId);
  const registration=await store.findRegistration(EVENT_ID,userId);
  if(registration){memo.set(userId,{at:t,registration});if(memo.size>MEMO_MAX)memo.delete(memo.keys().next().value);}
  return registration;
 }
 async function access(user,{names=false}={}){
  const organiser=user.permission==='admin',registration=organiser&&!names?null:await registrationOf(user.id);
  if(!organiser&&!registration)failCode('festival registration required',403,'not_registered');
  return {organiser,registration};
 }
 /* One read per second per instance backs the CDN up if it misses, and concurrent requests share the read in flight.
    A write through this instance drops it, so the writer's own next poll sees the change. */
 let pulseMemo=null;
 function pulse(){
  const t=clock();
  if(pulseMemo&&t-pulseMemo.at<PULSE_MS)return pulseMemo.promise;
  const entry={at:t,promise:store.pulse(EVENT_ID).then(rows=>({questions:rows.map(q=>[q.id,q.activityId,Number(q.revision),q.status])}))};
  pulseMemo=entry;entry.promise.catch(()=>{if(pulseMemo===entry)pulseMemo=null;});
  return entry.promise;
 }
 // Hidden questions are prepared drafts: organisers preview them, everyone else gets the same answer as for no question.
 async function questionFor(id,organiser){
  const q=await store.getQuestion(identifier(id));
  if(!q||q.eventId!==EVENT_ID||(q.status==='hidden'&&!organiser))unavailable();
  return q;
 }
 // Deleted messages are gone for everyone and hidden ones for participants; organisers see hidden ones marked.
 async function views(rows,{viewer,organiser}){
  const shown=m=>!m.deletedAt&&(organiser||!m.hiddenAt),ids=rows.filter(shown).map(m=>m.id);
  const [files,liked]=ids.length?await Promise.all([store.filesForMessages(ids),store.likedAmong(viewer,ids)]):[[],new Set()];
  const byMessage=new Map();for(const f of files)byMessage.set(f.messageId,[...(byMessage.get(f.messageId)??[]),f]);
  return {liked,list:rows.map(m=>shown(m)?messageView(m,{viewer,organiser,files:byMessage.get(m.id)??[],liked:liked.has(m.id)}):goneView(m))};
 }
 const viewOf=async(message,user,organiser)=>(await views([message],{viewer:user.id,organiser})).list[0];
 /* A withdrawn message takes its files with it: ready → deleting, the objects, then the row (which also returns them to
    the person's allowance). The withdrawal already happened, so a failure is logged, not reported; the row stays
    'deleting', which is never served and is cleared with the account. */
 async function releaseFiles(messageId){
  for(const file of await store.filesForMessages([messageId])){
   try{const claimed=await store.setFileStatus(file.id,'ready','deleting');if(!claimed)continue;await store.deleteBytes(claimed);await store.removeFile(claimed.id);}
   catch(error){log('festival file cleanup failed:',file.id,errorText(error));}
  }
 }
 // Another person's file is shown only while its message and question are.
 async function shownToPeers(file){
  if(!file.messageId)return false;
  const message=await store.findMessage(file.messageId);
  if(!message||message.hiddenAt||message.deletedAt)return false;
  const q=await store.getQuestion(message.questionId);
  return Boolean(q)&&q.status!=='hidden';
 }
 return async({req,res,url,user})=>{
  const path=url.pathname,route=routeOf(path);
  // Anything else under /api/fiiu and /api/admin/fiiu is the FIIU API's.
  if(!route)return false;
  const read=['GET','HEAD'].includes(req.method),{name,param}=route;
  // Only a write that passed the gates drops the pulse memo, so refused requests cannot turn every poll into a read.
  let wrote=false;
  try{
   if(name==='pulse'){
    // Sessionless (server.js), never rate limited: venue Wi-Fi puts hundreds of phones behind one address.
    if(!read){send(res,405,{error:'method not allowed'},{Allow:'GET, HEAD'});return true;}
    send(res,200,await pulse(),{'Cache-Control':PULSE_CACHE});return true;
   }
   if(!user){send(res,401,{error:'sign in required'});return true;}
   if(path.startsWith('/api/admin/')&&user.permission!=='admin'){send(res,403,{error:'administrator access required'});return true;}
   if(!route.methods.includes(req.method)){send(res,405,{error:'method not allowed'},{Allow:route.methods.join(', ')});return true;}
   if(!read&&!sameOrigin(req)){send(res,403,{error:'cross-origin request rejected'});return true;}
   if(!rateLimit(req,res,user,path,kindOf(name,read)))return true;
   wrote=!read;
   if(name==='questions'){
    const {organiser}=await access(user),activity=talkActivity(url.searchParams.get('activityId'));
    if(!activity){send(res,400,{error:'invalid activity',code:'invalid_activity'});return true;}
    const rows=await store.listQuestions(EVENT_ID,{activityId:activity.id,includeHidden:organiser});
    send(res,200,{activity:activityView(activity),questions:rows.map(q=>questionView(q,{organiser}))});return true;
   }
   if(name==='question'){
    // The question is read first: its revision is the baseline the page syncs from, so a message written meanwhile is
    // fetched again rather than missed.
    const {organiser}=await access(user),q=await questionFor(param,organiser),activity=talkActivity(q.activityId);
    const page=await store.latestMessages(q.id,{includeHidden:organiser,limit:TALK_LIMITS.page});
    send(res,200,{question:questionView(q,{organiser}),activity:activity?activityView(activity):null,messages:(await views(page.rows,{viewer:user.id,organiser})).list,
     before:page.more?encodeCursor(page.rows[0]):null,revision:Number(q.revision),me:{organiser,canPost:q.status==='open'}});
    return true;
   }
   if(name==='messages'&&read){
    const {organiser}=await access(user),q=await questionFor(param,organiser);
    const since=url.searchParams.get('since'),before=url.searchParams.get('before');
    if(since!==null){
     if(!/^\d{1,15}$/.test(since))fail('invalid revision');
     const from=Number(since),revision=Number(q.revision);
     // A revision from the future (another database, a reset) or more changes than one answer holds: reload.
     if(from>revision){send(res,200,{reset:true,revision});return true;}
     const rows=await store.messagesSince(q.id,from,{limit:TALK_LIMITS.changes+1});
     if(rows.length>TALK_LIMITS.changes){send(res,200,{reset:true,revision});return true;}
     const {list,liked}=await views(rows,{viewer:user.id,organiser});
     // A message written after the question was read is already here, so the page need not fetch it again.
     send(res,200,{revision:Math.max(revision,...rows.map(m=>Number(m.seq))),changes:list,liked:[...liked]});return true;
    }
    if(before!==null){
     const cursor=decodeCursor(before);if(!cursor)fail('invalid cursor');
     const page=await store.latestMessages(q.id,{includeHidden:organiser,before:cursor,limit:TALK_LIMITS.page});
     send(res,200,{messages:(await views(page.rows,{viewer:user.id,organiser})).list,before:page.more?encodeCursor(page.rows[0]):null});return true;
    }
    fail('since or before is required');
   }
   if(name==='messages'){
    const {organiser,registration}=await access(user,{names:true}),q=await questionFor(param,organiser);
    const input=normalizeMessage(await body(req));
    /* The phone keeps one clientId per draft, so a send whose answer was lost comes back as the same message. Only an
       identical retry is answered that way; a request that stopped between the insert and the attach is finished. A
       retry is answered even once the question has closed, since the message was sent while it was open. */
    const replay=async old=>{
     if(old.questionId!==q.id||old.body!==input.body||old.deletedAt)failCode('client id already used for another message',409,'client_id_reused');
     const attached=new Set((await store.filesForMessages([old.id])).map(f=>f.id)),missing=input.fileIds.filter(id=>!attached.has(id));
     if([...attached].some(id=>!input.fileIds.includes(id))||(missing.length&&await store.attachFiles(missing,old.id,user.id)!==missing.length))failCode('client id already used for another message',409,'client_id_reused');
     send(res,200,{message:await viewOf(old,user,organiser)});return true;
    };
    const old=await store.findMessageByClient(user.id,input.clientId);if(old)return await replay(old);
    if(q.status!=='open')failCode('this conversation is closed',403,'question_closed');
    const files=input.fileIds.length?await store.filesByIds(input.fileIds):[];
    if(files.length!==input.fileIds.length||files.some(f=>f.userId!==user.id||f.eventId!==EVENT_ID||f.status!=='ready'||f.messageId))fileUnavailable(400);
    let message;
    try{message=await store.insertMessage({id:randomUUID(),questionId:q.id,userId:user.id,...namesFor(user,registration),organiser,body:input.body,clientId:input.clientId,createdAt:now()});}
    catch(err){const raced=err.status===409&&await store.findMessageByClient(user.id,input.clientId);if(!raced)throw err;return await replay(raced);}
    // The attach is a compare-and-set; another post of this person's took a file in between, so this one is withdrawn.
    if(input.fileIds.length&&await store.attachFiles(input.fileIds,message.id,user.id)!==input.fileIds.length){
     await store.updateMessage({id:message.id,userId:user.id},{body:'',deletedAt:now()});await releaseFiles(message.id);fileUnavailable(400);
    }
    send(res,201,{message:await viewOf(message,user,organiser)});return true;
   }
   if(name==='message'){
    // Authorship alone: people can withdraw what they wrote whatever the question's state, even after cancelling.
    const message=await store.findMessage(identifier(param));
    if(!message||message.userId!==user.id||message.deletedAt)messageUnavailable();
    if(!await store.updateMessage({id:message.id,userId:user.id,deletedAt:null},{body:'',deletedAt:now()}))messageUnavailable();
    await releaseFiles(message.id);
    send(res,200,{ok:true});return true;
   }
   if(name==='like'){
    const {organiser}=await access(user),message=await store.findMessage(identifier(param));
    const q=message&&!message.deletedAt&&!message.hiddenAt?await store.getQuestion(message.questionId):null;
    if(!q||q.eventId!==EVENT_ID||(q.status==='hidden'&&!organiser))messageUnavailable();
    if(message.userId===user.id)failCode('you cannot like your own message',403,'own_message');
    if(q.status!=='open')failCode('this conversation is closed',403,'question_closed');
    // Idempotent on both backends (one row per person and message), so two devices never double count.
    const liked=req.method==='PUT';
    if(liked)await store.like(message.id,user.id,now());else await store.unlike(message.id,user.id);
    send(res,200,{likeCount:Number((await store.findMessage(message.id))?.likeCount??0),liked});return true;
   }
   if(name==='upload'){
    await access(user);
    let input;try{input=decodeTalkFile(await uploadBody(req));}catch(err){if(err.status===413&&!err.code)Object.assign(err,{code:'file_size'});throw err;}
    const id=randomUUID();
    const file=await store.reserveFile({id,eventId:EVENT_ID,userId:user.id,name:input.name,mime:input.mime,size:input.size,width:input.width,height:input.height,thumbSize:input.thumb?.size??null,storagePath:`fiiu/${user.id}/${id}`,createdAt:now()});
    try{await store.putBytes(file,'full',input.bytes);if(input.thumb)await store.putBytes(file,'thumb',input.thumb.bytes);}
    catch(err){
     // Nothing refers to the reservation yet, so it goes, with whatever reached Storage, rather than spend the allowance.
     // If that fails too, the row is cleared with the account (an old pending upload no longer blocks it).
     try{if(await store.setFileStatus(id,'pending','deleting')){await store.deleteBytes(file);await store.removeFile(id);}}catch(cleanup){log('festival upload cleanup failed:',id,errorText(cleanup));}
     throw err;
    }
    await store.setFileStatus(id,'pending','ready');
    send(res,201,{file:{id,name:file.name,mime:file.mime,size:file.size,width:file.width??null,height:file.height??null,thumb:Boolean(input.thumb)}});return true;
   }
   if(name==='file'){
    const {organiser}=await access(user),file=await store.findFile(identifier(param));
    if(!file||file.status!=='ready'||file.eventId!==EVENT_ID||!(organiser||file.userId===user.id||await shownToPeers(file)))fileUnavailable(404);
    // A file without a thumbnail (a PDF, or a photo the phone could not decode) answers ?size=thumb with itself.
    const thumb=url.searchParams.get('size')==='thumb'&&Boolean(file.thumbSize);
    // An id never names other bytes, so the browser keeps the file privately and revalidates for free.
    const etag=`"${file.id}${thumb?'-thumb':''}"`,caching={'Cache-Control':'private, max-age=86400, immutable',ETag:etag,Vary:'Cookie'};
    if(matchesEtag(req.headers['if-none-match'],etag)){send(res,304,'',caching);return true;}
    // Organisers moderate and project every conversation, so like the course teaching team they are not budgeted.
    const budget=organiser?{ok:true}:downloads.take(`download:${user.id}`,thumb?file.thumbSize:file.size,clock());
    if(!budget.ok){send(res,429,{error:'download limit reached; try again later',code:'download_rate'},{'Retry-After':String(budget.retryAfter)});return true;}
    const bytes=await store.getBytes(file,thumb?'thumb':'full'),filename=attachmentFilename(file.name,file.mime);
    // Images open in the tab; PDFs download, because Chrome refuses its PDF viewer under a sandbox CSP.
    const disposition=file.mime==='application/pdf'?'attachment':'inline';
    send(res,200,bytes,{...caching,'Content-Type':thumb?thumbType(bytes):file.mime,'Content-Disposition':`${disposition}; filename="${filename.replace(/[^a-zA-Z0-9._ -]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
     'Content-Security-Policy':"default-src 'none'; sandbox",'Content-Length':String(bytes.length)});
    return true;
   }
   if(name==='adminQuestions'&&read){
    const [rows,stats]=await Promise.all([store.listQuestions(EVENT_ID,{includeHidden:true}),store.questionStats(EVENT_ID)]);
    send(res,200,{questions:rows.map(q=>({...questionView(q,{organiser:true}),stats:{messages:Number(q.messageCount),people:Number(stats.get(q.id)?.people??0),likes:Number(stats.get(q.id)?.likes??0)}}))});return true;
   }
   if(name==='adminQuestions'){
    /* The dashboard sends a UUID made once per draft and reuses it on retry, as the publication editor does: a save
       whose answer was lost returns the stored question. Different content under that id (edited, opened or closed
       since) is a conflict, so the form is kept instead of reporting a save that did not happen. */
    const input=await body(req),question=normalizeQuestion(input),id=input.id==null?randomUUID():identifier(input.id);
    let row;
    try{row=await store.insertQuestion({id,eventId:EVENT_ID,...question,createdBy:user.id,createdAt:now()});}
    catch(err){
     const existing=input.id!=null&&err.status===409&&await store.getQuestion(id);if(!existing||existing.eventId!==EVENT_ID)throw err;
     const same=['activityId','talk','body','status'].every(k=>(existing[k]??null)===(question[k]??null));
     send(res,same?200:409,{...(same?{}:{error:'question changed; reload before saving'}),question:questionView(existing,{organiser:true})});return true;
    }
    send(res,201,{question:questionView(row,{organiser:true})});return true;
   }
   if(name==='adminQuestion'){
    const input=await body(req);
    if(!Number.isSafeInteger(input.version)||input.version<1)fail('version is required');
    const current=await store.getQuestion(identifier(param));if(!current||current.eventId!==EVENT_ID)unavailable();
    const conflict=row=>{send(res,409,{error:'question changed; reload before saving',question:questionView(row,{organiser:true})});return true;};
    if(current.version!==input.version)return conflict(current);
    const next=normalizeQuestion(input,current);
    const row=await store.updateQuestion(current.id,input.version,{body:next.body,talk:next.talk,status:next.status,updatedAt:now()});
    if(!row){const latest=await store.getQuestion(current.id);if(!latest)unavailable();return conflict(latest);}
    send(res,200,{question:questionView(row,{organiser:true})});return true;
   }
   if(name==='hidden'){
    // Hiding twice keeps the first hider and time; the triggers move the revision, so participants lose it on their next poll.
    const message=await store.findMessage(identifier(param));if(!message||message.deletedAt)messageUnavailable();
    const hide=req.method==='PUT';
    const row=hide===Boolean(message.hiddenAt)?message:await store.updateMessage({id:message.id,deletedAt:null},hide?{hiddenAt:now(),hiddenBy:user.id}:{hiddenAt:null,hiddenBy:null});
    if(!row)messageUnavailable();
    send(res,200,{message:await viewOf(row,user,true)});return true;
   }
   if(name==='export'){
    // One row per message, withdrawn and hidden ones included (flagged); csv() neutralises formulas in what people wrote.
    const q=await store.getQuestion(identifier(param));if(!q||q.eventId!==EVENT_ID)unavailable();
    const messages=await store.allMessages(q.id);
    const [files,emails]=await Promise.all([messages.length?store.filesForMessages(messages.map(m=>m.id)):[],store.registrationEmails(EVENT_ID,messages.map(m=>m.userId))]);
    const names=new Map();for(const f of files)names.set(f.messageId,[...(names.get(f.messageId)??[]),attachmentFilename(f.name,f.mime)]);
    const block=talkActivity(q.activityId)?.title??q.activityId;
    const rows=[CSV_HEADER,...messages.map(m=>[q.body,block,q.talk??'',limaTime(m.createdAt),m.authorFull||m.authorName,emails.get(m.userId)??'',Boolean(m.organiser),m.body,(names.get(m.id)??[]).join('; '),Number(m.likeCount),Boolean(m.hiddenAt),Boolean(m.deletedAt)])];
    send(res,200,csv(rows),{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="fiiu-conversation-${q.id.slice(0,8)}.csv"`});return true;
   }
   // name==='qr': the projector's join code, for the configured origin (never the Host header in production).
   const q=await store.getQuestion(identifier(param));if(!q||q.eventId!==EVENT_ID)unavailable();
   const link=`${originFor(req)}/fiiu-talk.html?q=${q.id}`;
   send(res,200,{url:link,qr:qrOf(link)});return true;
  }catch(err){
   if(typeof err?.code==='string'&&/^[a-z_]+$/.test(err.code)&&err.status>=400&&err.status<500&&!res.headersSent){send(res,err.status,{error:err.message,code:err.code});return true;}
   throw err;
  }finally{if(wrote)pulseMemo=null;}
 };
}
