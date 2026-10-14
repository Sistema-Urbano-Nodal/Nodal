import {createHash,randomUUID} from 'node:crypto';
import {fail,identifier,csv,attachmentFilename,encodeCursor,decodeCursor} from './courses-domain.js';
import {bodyJson,createByteBudget,matchesEtag,DOWNLOAD_LIMITS} from './courses-api.js';
import {EVENT_ID,FIIU_EVENT} from './fiiu-domain.js';
import {packBits} from './qr.js';
import {TALK_LIMITS,talkActivity,normalizeQuestion,normalizeMessage,decodeTalkFile,namesFor,questionView,messageView,goneView,activityView} from './fiiu-talk-domain.js';

// The page keeps a viewer's unsent text in the tab under this name, so the next person signing in on a shared phone never gets it. A digest, not the
// id: a conversation read never carries user ids.
const draftKey=userId=>createHash('sha256').update('nodal-talk-draft:'+userId).digest('base64url').slice(0,16);

/* FIIU block conversations over HTTP. The pulse is the one public route: ids, blocks, revisions and statuses, the same
   for everyone, so the CDN answers the 4-second polls of a full auditorium (one venue address) and a phone fetches
   messages only when its question's revision moved. Everything else needs a festival registration or an organiser. */
const PULSE_CACHE='public, max-age=0, s-maxage=2, stale-while-revalidate=4';
const PULSE_MS=1000,MEMO_MS=60000,MEMO_MAX=5000,UPLOAD_GRACE_MS=10*60000,RETRY_MS=10*60000,CHANGES_MS=1500,CHANGES_MAX=200;
const STALE_READY_MS=30*60000,STALE_PENDING_MS=60*60000,THUMBS_MAX=200,THUMBS_BYTES=20*1024*1024;
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
 // GET only: a HEAD would read the bytes from Storage (the thumbnail's type comes from them) to send none.
 ['file',/^\/api\/fiiu\/files\/([^/]+)$/,['GET']],
 ['adminQuestions',/^\/api\/admin\/fiiu\/questions$/,['GET','HEAD','POST']],
 ['adminQuestion',/^\/api\/admin\/fiiu\/questions\/([^/]+)$/,['PATCH']],
 ['hidden',/^\/api\/admin\/fiiu\/messages\/([^/]+)\/hidden$/,['PUT','DELETE']],
 ['export',/^\/api\/admin\/fiiu\/questions\/([^/]+)\/export$/,['GET','HEAD']],
 ['qr',/^\/api\/admin\/fiiu\/questions\/([^/]+)\/qr$/,['GET','HEAD']],
];
const routeOf=path=>{for(const [name,pattern,methods] of ROUTES){const m=path.match(pattern);if(m)return {name,param:m[1],methods};}return null;};
/* Each write spends its own per-account budget (server.js): a busy chat never blocks likes or moderation. So do file
   reads, so a photo-heavy chat (or the projector and the chat open on one organiser account) never runs the 'read'
   budget its sync polls need out on thumbnails; the byte budget still caps what they download. */
const kindOf=(name,read)=>read?(name==='file'?'file':'read'):{messages:'message',upload:'upload',like:'like',hidden:'moderate'}[name]??'write';

export async function exportTalkData(store,userId){
 const [messages,files,likedMessageIds]=await Promise.all([store.userMessages(userId),store.userFiles(userId),store.userLikes(userId)]);
 const questions=new Map();
 for(const id of new Set(messages.map(m=>m.questionId)))questions.set(id,await store.getQuestion(id));
 return {
  // A question hidden since is an organiser's draft again (its text may be rewritten for a later session), which no
  // participant route shows; the id still ties the messages together.
  messages:messages.map(m=>({id:m.id,questionId:m.questionId,question:questions.get(m.questionId)?.status==='hidden'?'':questions.get(m.questionId)?.body??'',body:m.body,createdAt:m.createdAt,deleted:Boolean(m.deletedAt),hidden:Boolean(m.hiddenAt)})),
  // Storage paths are internal.
  files:files.map(({id,messageId,name,mime,size,createdAt})=>({id,messageId,name,mime,size,createdAt})),
  likedMessageIds,
 };
}
const busy=()=>fail('An upload is in progress. Try again in a few minutes.',409);
// deleteTalkData's refusal, touching nothing, so the account deletion can run every check before erasing anything.
export async function assertTalkDataDeletable(store,userId,{now=Date.now()}={}){
 const files=await store.userFiles(userId);
 if(files.some(f=>f.status==='pending'&&now-Date.parse(f.createdAt)<UPLOAD_GRACE_MS))busy();
 return files;
}
/* Before the account goes: its files (object, then row, so a Storage failure stops here and the deletion can be
   retried), then the text and names of its messages (the conversation keeps a 'deleted message' placeholder), then its
   likes. An upload under way could reach Storage after its row is gone, where nothing would find it again, so a recent
   pending upload refuses for those few minutes; an older one is abandoned and cleared like the rest. */
export async function deleteTalkData(store,userId,{now=Date.now()}={}){
 const files=await assertTalkDataDeletable(store,userId,{now});
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
// programme: the festival programme as organisers edited it (server/fiiu-programme.js, memoised per instance).
export function createTalkApi({store,sameOrigin,send,rateLimit=()=>true,downloads=createByteBudget(DOWNLOAD_LIMITS),encodeQr=null,publicOrigin=()=>fail('public base URL is not configured',503),clock=Date.now,log=console.error,programme={event:async()=>FIIU_EVENT}}){
 const now=()=>new Date(clock()).toISOString();
 // A block's title, venue or talks never stop a conversation: if the edits cannot be read, the built-in programme serves.
 const eventOf=async()=>{try{return await programme.event();}catch(error){log('festival programme unavailable:',errorText(error));return FIIU_EVENT;}};
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
 /* Deleted messages are gone for everyone. Hidden ones are gone for participants except their author, who keeps
    seeing it marked so they can still delete it (the privacy policy promises that); organisers see them all marked. */
 const shownTo=(m,{viewer,organiser})=>!m.deletedAt&&(organiser||!m.hiddenAt||m.userId===viewer);
 // The files of every message someone may be shown, by message.
 async function filesOf(rows){
  const ids=rows.filter(m=>!m.deletedAt).map(m=>m.id),byMessage=new Map();
  if(ids.length)for(const f of await store.filesForMessages(ids))byMessage.set(f.messageId,[...(byMessage.get(f.messageId)??[]),f]);
  return byMessage;
 }
 // liked: the viewer's likes among the rows, or null for an answer shared between viewers (no like field at all).
 const viewsOf=(rows,files,{viewer,organiser,liked=null})=>rows.map(m=>shownTo(m,{viewer,organiser})?messageView(m,{viewer,organiser,files:files.get(m.id)??[],liked:liked?liked.has(m.id):null}):goneView(m));
 // A page of messages for one viewer, with their likes.
 async function views(rows,{viewer,organiser}){
  const ids=rows.filter(m=>shownTo(m,{viewer,organiser})).map(m=>m.id);
  const [files,liked]=ids.length?await Promise.all([filesOf(rows),store.likedAmong(viewer,ids)]):[new Map(),new Set()];
  return {liked,list:viewsOf(rows,files,{viewer,organiser,liked})};
 }
 const viewOf=async(message,user,organiser)=>(await views([message],{viewer:user.id,organiser})).list[0];
 /* The pulse moves for a whole room at once, so its phones ask for the same changes within a second or two. The part
    of a since answer they share (the question, the changed rows and their files) is read once per instance for 1.5 s
    per question, revision and audience, and concurrent requests share the read in flight; each viewer's answer is then
    built from it in memory (whose message it is, an author's own hidden one), which is why it carries no likes of the
    viewer's. A write through this instance drops the entries, so its author's next poll reads past it. Being up to
    1.5 s behind is safe: the answer's revision is that of its rows, so a later pulse asks again from there. */
 const changesMemo=new Map();
 function changesSince(id,from,organiser){
  const key=`${id}:${from}:${organiser?'organiser':'participant'}`,t=clock(),hit=changesMemo.get(key);
  if(hit&&t-hit.at<CHANGES_MS)return hit.promise;
  changesMemo.delete(key);
  const entry={at:t,promise:(async()=>{
   const q=await questionFor(id,organiser),revision=Number(q.revision);
   // A revision from the future (another database, a reset) or more changes than one answer holds: reload.
   if(from>revision)return {q,reset:true,revision};
   const rows=await store.messagesSince(q.id,from,{limit:TALK_LIMITS.changes+1});
   if(rows.length>TALK_LIMITS.changes)return {q,reset:true,revision};
   /* A message written after the question was read is already here, so the page need not fetch it again. A close or an
      edit may have landed between the two reads, though, and the page trusts the question this answer carries; when a row
      is newer than the question, the question is read again so the two never disagree. */
   const top=Math.max(revision,...rows.map(m=>Number(m.seq)));
   const [shown,files]=await Promise.all([top>revision?questionFor(id,organiser):q,filesOf(rows)]);
   return {q:shown,rows,files,revision:top};
  })()};
  changesMemo.set(key,entry);
  // Oldest first: expired entries, then any over the cap.
  for(const [k,old] of changesMemo){if(t-old.at<CHANGES_MS&&changesMemo.size<=CHANGES_MAX)break;changesMemo.delete(k);}
  entry.promise.catch(()=>{if(changesMemo.get(key)===entry)changesMemo.delete(key);});
  return entry.promise;
 }
 /* A withdrawn message takes its files with it: ready → deleting, the objects, then the row (which also returns them to
    the person's allowance). The withdrawal already happened, so a failure is logged, not reported; the row stays
    'deleting', which is never served and is cleared with the account. */
 async function releaseFiles(messageId){
  for(const file of await store.filesForMessages([messageId])){
   try{const claimed=await store.setFileStatus(file.id,'ready','deleting');if(!claimed)continue;await store.deleteBytes(claimed);await store.removeFile(claimed.id);}
   catch(error){log('festival file cleanup failed:',file.id,errorText(error));}
  }
 }
 /* Uploads that never reached a message (an answer lost, so the page uploaded again; a draft dropped, refused or lost
    to a reload) would hold the person's festival allowance for good, and their bytes would stay in Storage until the
    account goes. So the uploader's stale ones go before each new reservation: a ready, unattached file after 30
    minutes (a draft kept open longer gets file_unavailable and uploads again), a pending one after an hour (an upload
    that died mid-way; a live one ends within the function's time limit). The claim is a compare-and-set on the
    unattached state, so a file a send attaches meanwhile is kept. A failure is logged; the upload goes on. */
 async function releaseStale(userId){
  const t=clock();
  for(const file of await store.userFiles(userId)){
   const age=t-Date.parse(file.createdAt);
   if(!(file.status==='ready'&&!file.messageId&&age>STALE_READY_MS||file.status==='pending'&&age>STALE_PENDING_MS))continue;
   try{const claimed=await store.setFileStatus(file.id,file.status,'deleting',{unattached:true});if(!claimed)continue;await store.deleteBytes(claimed);await store.removeFile(claimed.id);}
   catch(error){log('festival upload release failed:',file.id,errorText(error));}
  }
 }
 /* A photo posted in a full room is drawn on every phone within a tick, and the answer is private (no CDN), so
    thumbnails are kept per instance: at most 200 and 20 MB, least recently used first, a read in flight shared. A
    file id never names other bytes, and the access check runs before for every request. Full images (up to 3 MB,
    opened one at a time) are read each time. */
 const thumbs=new Map();let thumbBytes=0;
 const trimThumbs=()=>{for(const [id,old] of thumbs){if(thumbs.size<=THUMBS_MAX&&thumbBytes<=THUMBS_BYTES)break;thumbs.delete(id);thumbBytes-=old.size;}};
 function thumbnail(file){
  const hit=thumbs.get(file.id);
  if(hit){thumbs.delete(file.id);thumbs.set(file.id,hit);return hit.bytes;}
  const entry={size:0,bytes:store.getBytes(file,'thumb')};
  thumbs.set(file.id,entry);trimThumbs();
  // Counted once it arrives, and only while still held; a failed read is not kept.
  entry.bytes.then(bytes=>{if(thumbs.get(file.id)!==entry)return;entry.size=bytes.length;thumbBytes+=bytes.length;trimThumbs();},()=>{if(thumbs.get(file.id)===entry)thumbs.delete(file.id);});
  return entry.bytes;
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
    const {organiser}=await access(user),activity=talkActivity(url.searchParams.get('activityId'),await eventOf());
    if(!activity){send(res,400,{error:'invalid activity',code:'invalid_activity'});return true;}
    const rows=await store.listQuestions(EVENT_ID,{activityId:activity.id,includeHidden:organiser});
    send(res,200,{activity:activityView(activity),questions:rows.map(q=>questionView(q,{organiser}))});return true;
   }
   if(name==='question'){
    // The question is read first: its revision is the baseline the page syncs from, so a message written meanwhile is
    // fetched again rather than missed. liked seeds the page's own like state, which since answers do not carry.
    const {organiser}=await access(user),q=await questionFor(param,organiser);
    const [event,page]=await Promise.all([eventOf(),store.latestMessages(q.id,{includeHidden:organiser,ownHidden:user.id,limit:TALK_LIMITS.page})]),activity=talkActivity(q.activityId,event);
    const {list,liked}=await views(page.rows,{viewer:user.id,organiser});
    send(res,200,{question:questionView(q,{organiser}),activity:activity?activityView(activity):null,messages:list,liked:[...liked],
     before:page.more?encodeCursor(page.rows[0]):null,revision:Number(q.revision),me:{draftKey:draftKey(user.id),organiser,canPost:q.status==='open'}});
    return true;
   }
   if(name==='messages'&&read){
    const {organiser}=await access(user),since=url.searchParams.get('since'),before=url.searchParams.get('before');
    if(since!==null){
     if(!/^\d{1,15}$/.test(since))fail('invalid revision');
     /* The question rides along every answer, so an edit of its text or talk, or a close, that lands in the same sync
        as message changes still reaches the page and the projector. */
     const {q,reset,revision,rows,files}=await changesSince(identifier(param),Number(since),organiser),question=questionView(q,{organiser});
     if(reset){send(res,200,{reset:true,revision,question});return true;}
     send(res,200,{revision,question,changes:viewsOf(rows,files,{viewer:user.id,organiser})});return true;
    }
    const q=await questionFor(param,organiser);
    if(before!==null){
     const cursor=decodeCursor(before);if(!cursor)fail('invalid cursor');
     const page=await store.latestMessages(q.id,{includeHidden:organiser,ownHidden:user.id,before:cursor,limit:TALK_LIMITS.page});
     send(res,200,{messages:(await views(page.rows,{viewer:user.id,organiser})).list,before:page.more?encodeCursor(page.rows[0]):null});return true;
    }
    fail('since or before is required');
   }
   if(name==='messages'){
    const {organiser,registration}=await access(user,{names:true}),q=await questionFor(param,organiser);
    const input=normalizeMessage(await body(req));
    /* The phone keeps one clientId per draft, so a send whose answer was lost comes back as the same message. Only an
       identical retry is answered that way. A retry is answered even once the question has closed, since the message
       was sent while it was open; one deleted since answers with its gone view (the page drops the pending row). */
    const reused=()=>failCode('client id already used for another message',409,'client_id_reused');
    /* Two requests of one draft can both be attaching (a retry while the first is still running), so an attach that
       moves fewer files than asked is a failure only if the files did not end up on this message after all. */
    const attachedTo=async messageId=>{const got=new Set((await store.filesForMessages([messageId])).map(f=>f.id));return input.fileIds.every(id=>got.has(id));};
    const replay=async old=>{
     if(old.questionId!==q.id)reused();
     // Deleting blanks the body, so it is not compared.
     if(old.deletedAt){send(res,200,{message:goneView(old)});return true;}
     if(old.body!==input.body)reused();
     const attached=new Set((await store.filesForMessages([old.id])).map(f=>f.id)),missing=input.fileIds.filter(id=>!attached.has(id));
     if([...attached].some(id=>!input.fileIds.includes(id)))reused();
     let row=old;
     if(missing.length){
      /* Attaching only finishes the original send, a request that stopped between the insert and the attach: never
         past the close or a moderator, never onto a message that already has its files, never long after. Otherwise
         a reused clientId would slip new files into an old or reviewed message. */
      // A refused finish must not leave an empty message on everyone's screen: one with no text and no files is withdrawn.
      const refuse=async problem=>{if(!old.body&&!attached.size)await store.updateMessage({id:old.id,userId:user.id,deletedAt:null},{body:'',deletedAt:now()});problem();};
      if(q.status!=='open')await refuse(()=>failCode('this conversation is closed',403,'question_closed'));
      if(old.hiddenAt||attached.size||!(clock()-Date.parse(old.createdAt)<RETRY_MS))await refuse(reused);
      if(await store.attachFiles(missing,old.id,user.id)!==missing.length&&!await attachedTo(old.id))reused();
      // The attach restamped the message, so the answer carries the seq peers will sync.
      row=await store.findMessage(old.id)??old;
     }
     send(res,200,{message:await viewOf(row,user,organiser)});return true;
    };
    const old=await store.findMessageByClient(user.id,input.clientId);if(old)return await replay(old);
    if(q.status!=='open')failCode('this conversation is closed',403,'question_closed');
    const files=input.fileIds.length?await store.filesByIds(input.fileIds):[];
    if(files.length!==input.fileIds.length||files.some(f=>f.userId!==user.id||f.eventId!==EVENT_ID||f.status!=='ready'||f.messageId))fileUnavailable(400);
    let message;
    try{message=await store.insertMessage({id:randomUUID(),questionId:q.id,userId:user.id,...namesFor(user,registration),organiser,body:input.body,clientId:input.clientId,createdAt:now()});}
    catch(err){const raced=err.status===409&&await store.findMessageByClient(user.id,input.clientId);if(!raced)throw err;return await replay(raced);}
    /* The attach is a compare-and-set. A retry of this draft may have attached the files first, and then the message is
       sent; if another post of this person's took a file in between, this one is withdrawn. */
    if(input.fileIds.length){
     if(await store.attachFiles(input.fileIds,message.id,user.id)!==input.fileIds.length&&!await attachedTo(message.id)){
      // The withdrawn copy gives up its clientId, so a Retry of this draft is a new send rather than a replay of the gone copy.
      await store.updateMessage({id:message.id,userId:user.id},{body:'',deletedAt:now(),clientId:randomUUID()});await releaseFiles(message.id);fileUnavailable(400);
     }
     // The attach restamped the message (so peers that synced it without its files fetch it again): send that seq.
     message=await store.findMessage(message.id)??message;
    }
    /* Built from what this request holds rather than read back: the files are exactly the ones checked above, and a
       new message carries no like of its author's (own_message refuses one). */
    send(res,201,{message:messageView(message,{viewer:user.id,organiser,files,liked:false})});return true;
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
    await releaseStale(user.id);
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
    // The file is read beside the registration; its message and question (for someone else's file) depend on it.
    const fileId=identifier(param),[{organiser},file]=await Promise.all([access(user),store.findFile(fileId)]);
    if(!file||file.status!=='ready'||file.eventId!==EVENT_ID||!(organiser||file.userId===user.id||await shownToPeers(file)))fileUnavailable(404);
    // A file without a thumbnail (a PDF, or a photo the phone could not decode) answers ?size=thumb with itself.
    const thumb=url.searchParams.get('size')==='thumb'&&Boolean(file.thumbSize);
    // An id never names other bytes, so the browser keeps the file privately and revalidates for free.
    const etag=`"${file.id}${thumb?'-thumb':''}"`,caching={'Cache-Control':'private, max-age=86400, immutable',ETag:etag,Vary:'Cookie'};
    if(matchesEtag(req.headers['if-none-match'],etag)){send(res,304,'',caching);return true;}
    // Organisers moderate and project every conversation, so like the course teaching team they are not budgeted.
    const budget=organiser?{ok:true}:downloads.take(`download:${user.id}`,thumb?file.thumbSize:file.size,clock());
    if(!budget.ok){send(res,429,{error:'download limit reached; try again later',code:'download_rate'},{'Retry-After':String(budget.retryAfter)});return true;}
    const bytes=await (thumb?thumbnail(file):store.getBytes(file,'full')),filename=attachmentFilename(file.name,file.mime);
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
    const input=await body(req),question=normalizeQuestion(input,null,await eventOf()),id=input.id==null?randomUUID():identifier(input.id);
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
    const next=normalizeQuestion(input,current,await eventOf());
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
    const block=talkActivity(q.activityId,await eventOf())?.title??q.activityId;
    const rows=[CSV_HEADER,...messages.map(m=>[q.body,block,q.talk??'',limaTime(m.createdAt),m.authorFull||m.authorName,emails.get(m.userId)??'',Boolean(m.organiser),m.body,(names.get(m.id)??[]).join('; '),Number(m.likeCount),Boolean(m.hiddenAt),Boolean(m.deletedAt)])];
    send(res,200,csv(rows),{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="fiiu-conversation-${q.id.slice(0,8)}.csv"`});return true;
   }
   // name==='qr': the projector's join code, for the configured origin (never the Host header in production).
   const q=await store.getQuestion(identifier(param));if(!q||q.eventId!==EVENT_ID)unavailable();
   const link=`${originFor(req)}/fiiu-talk.html?q=${q.id}`;
   send(res,200,{url:link,qr:qrOf(link)});return true;
  }catch(err){
   // Somebody else's error text (expose: false, as a backend adapter marks it) goes to the global handler, which hides it.
   if(typeof err?.code==='string'&&/^[a-z_]+$/.test(err.code)&&err.status>=400&&err.status<500&&err.expose!==false&&!res.headersSent){send(res,err.status,{error:err.message,code:err.code});return true;}
   throw err;
  /* A like answer already carries its count and state, so a like (the busiest write in a full room) keeps the shared since
     answers rather than make every poll that follows read again. */
  }finally{if(wrote){pulseMemo=null;if(name!=='like')changesMemo.clear();}}
 };
}
