import {randomUUID} from 'node:crypto';
import {fail,identifier,csv} from './courses-domain.js';
import {bodyJson} from './courses-api.js';
import {EVENT_ID,FIIU_EVENT,LEGACY_FIIU_ACTIVITIES,configView,normalizeRegistration,applicationStatus,version,normalizeContent,contentView,normalizeConfig,canAttend,checkinWindow,attendanceHours,isCheckinActivity,normalizeProgrammeEdit} from './fiiu-domain.js';
import {createProgramme,mergeActivity} from './fiiu-programme.js';
import {createCheckinCodes} from './fiiu-checkin.js';
import {packBits} from './qr.js';
import {isReservedRecipient,EMAIL_LANGUAGES} from './fiiu-email.js';
import {parseCookies} from './auth.js';
import {confirmationState,confirmationCounts,sendConfirmationBatch,deliverConfirmation,BATCH_SIZE,DAILY_CAP} from './fiiu-confirmations.js';
import {noticeState,noticeCounts,noticeClosed,sendNoticeBatch,PARTY_NOTICE} from './fiiu-notices.js';
const now=()=>new Date().toISOString();
const attendanceView=({activityId,createdAt,method})=>({activityId,createdAt,method});
// CSV check-in times are Lima wall-clock time (UTC-05:00 all year), e.g. '2026-10-21 09:12'.
const limaTime=value=>{const t=Date.parse(value??'');return Number.isFinite(t)?new Date(t-5*3600000).toISOString().slice(0,16).replace('T',' '):'';};
// The injected encoder returns {size, modules} (row-major 0/1) or already-packed {size, bits}; the browser receives
// base64 bits, row-major, most significant bit first.
const qrView=qr=>typeof qr?.bits==='string'?{size:qr.size,bits:qr.bits}:{size:qr.size,bits:packBits(qr)};
// Bind an open browser form to the account that loaded it. Ownership is still
// derived from the session; older clients can omit this additional guard.
function sameAccount(input,user){if(input.expectedUserId!==undefined&&input.expectedUserId!==user.id)fail('account changed; reload before continuing',409);}
const body=req=>bodyJson(req,24576);
/* The 429 a summary or party batch answers at today's cap: the cap, today's count, when it resets, the counts, and the
   outcomes of what this batch did send before it stopped (another sender may have taken the room left between its
   claims; all 0 when nothing went out), so the panel's report of the pass counts those emails too. */
const capReply=(error,batch,counts)=>({error,code:'daily_cap',dailyCap:batch.dailyCap,sentToday:batch.sentToday,resetsAt:batch.resetsAt,counts,
 ...Object.fromEntries(['sent','failed','uncertain','skipped','claimedElsewhere'].map(k=>[k,batch[k]??0]))});
// The person's festival data for the account export: the registration, attendance and the one-off notices sent to them.
export async function exportFiiuData(store,userId){
 const [registration,notices]=await Promise.all([store.find('registrations',{eventId:EVENT_ID,userId},{limit:1}).then(rows=>rows[0]??null),store.find('notices',{eventId:EVENT_ID,userId})]);
 const attendance=registration?await store.find('attendance',{registrationId:registration.id}):[];
 return {registration,attendance:attendance.map(attendanceView),notices:notices.map(({kind,status,sentAt})=>({kind,status,sentAt}))};
}
// A block's built-in values, which "Restore original" brings back.
const originalOf=({title,date,time,venue,description='',sessions,registration,formUrl})=>({title,date,time,venue,description,sessions,...(registration==='external'?{formUrl}:{})});
// The summary email's language: the page's own (sent with the registration), else the site language cookie, else Spanish.
export function registrationLanguage(input,req){
 if(EMAIL_LANGUAGES.includes(input?.language))return input.language;
 const cookie=parseCookies(req?.headers?.cookie??'').get('nodal.lang');
 return EMAIL_LANGUAGES.includes(cookie)?cookie:'es';
}
// checkin: {secret, now} for the rotating codes (tests freeze the clock); publicOrigin: the configured site origin (a
// string or a function of the request) that check-in links point to, never the Host header in production.
// confirmation: async ({registration, config, language, event}) => {status, sentAt?}, the registration summary email (see
// server/fiiu-email.js), or null when email is off; emailAllowed(user) spends one send from the account's hourly
// allowance and the server-wide ceiling, and answers false when either is used up. backfill: {batchSize, dailyCap,
// now} for the organiser's "Send the summary" and "Announce the party" buttons (server/fiiu-confirmations.js,
// server/fiiu-notices.js); tests shrink them. partyNotice: async ({registration, event, language}) => {status, sentAt?},
// the closing-party announcement (server/fiiu-email.js), or null when email is off. programme: the merged programme
// (server/fiiu-programme.js), shared with the conversations so one save clears one memo.
export function createFiiuApi({store,sameOrigin,send,rateLimit=()=>true,checkin={},encodeQr=null,publicOrigin=()=>fail('public base URL is not configured',503),confirmation=null,emailAllowed=()=>true,backfill={},partyNotice=null,programme=createProgramme({store})}){
 const {batchSize=BATCH_SIZE,dailyCap=DAILY_CAP,now:today=()=>Date.now()}=backfill;
 // A link the encoder cannot draw (say, an unusually long configured origin) leaves the screen its typed address and short code.
 const qrOf=link=>{if(!encodeQr)return null;try{return qrView(encodeQr(link));}catch{return null;}};
 const one=async(name,filters)=>(await store.find(name,filters,{limit:1}))[0]??null;
 const codes=createCheckinCodes(checkin),clock=codes.now;
 const originFor=req=>(typeof publicOrigin==='function'?publicOrigin(req):publicOrigin)||fail('public base URL is not configured',503);
 // One row per person and block, shared by the staff checkbox and the QR check-in. An existing row is kept as it is
 // (its time and method stay the first confirmation's). The participant may cancel between the registration lookup
 // and the insert; the store reports that lost parent as 404. known: the person's attendance rows this request already
 // read (the QR check-in), which then stand in for the lookup before the insert and the re-read after it.
 async function recordAttendance(registration,activity,{by,method,at=now(),known=null}){
  const filters={registrationId:registration.id,activityId:activity.id},reread=()=>store.find('attendance',{registrationId:registration.id});
  if(known?known.some(a=>a.activityId===activity.id):await one('attendance',filters))return {created:false,attendance:known??await reread()};
  let row;try{row=await store.insert('attendance',{id:randomUUID(),...filters,confirmedBy:by,createdAt:at,method});}catch(err){if(err.status===404)fail('registration unavailable',404);if(err.status!==409||!await one('attendance',filters))throw err;return {created:false,attendance:await reread()};}
  return {created:true,attendance:known?[...known,row]:await reread()};
 }
 /* A failed party announcement to someone who has just added the party or cancelled can never be retried: it goes now,
    so the organisers' failed count and its "Retry failed" are only people a retry reaches, and the person is waiting
    again should they drop the party or register anew. Only while 'failed' (a send under way stands; the cap never
    counts a failed one). It never fails the participant's save: a lost write is settled by the next retry pass. */
 const plansParty=answers=>Array.isArray(answers?.activities)&&answers.activities.includes(PARTY_NOTICE.activityId);
 const planned=(registration,activityId)=>Array.isArray(registration.answers?.activities)&&registration.answers.activities.includes(activityId);
 /* Someone with a NODAL account but no festival registration who confirms at a conference block's door: the registration
    holds what the account already has (name, email, city) and that block, marked walkIn so the organisers can tell; the
    festival page then asks them to complete the rest. No summary email at the door, which would hold the check-in up to
    8 seconds: it stays 'none', so the organisers' "Send the summary" reaches them. A registration made meanwhile (a
    second tap, another tab) stands instead. */
 async function registerAtDoor(user,activityId,input,req){
  const [firstName='',...rest]=String(user.name??'').trim().split(/\s+/),at=now();
  // No privacyAccepted: the tap agreed to share these three, so the form still asks before the private answers are added.
  const answers={firstName:firstName.slice(0,100),lastName:rest.join(' ').slice(0,120),country:'',city:String(user.city??'').trim().slice(0,160),activities:[activityId],externalActivities:[],accessibility:[],applyLab:false,walkIn:true};
  let registration=null;
  try{registration=await store.insert('registrations',{id:randomUUID(),eventId:EVENT_ID,userId:user.id,email:user.email,answers,labStatus:'none',version:1,createdAt:at,updatedAt:at,confirmationStatus:confirmation&&isReservedRecipient(user.email)?'skipped':'none',confirmationLanguage:registrationLanguage(input,req),confirmationSentAt:null});}
  catch(err){if(err.status!==409)throw err;}
  if(registration)return {registration,joined:'registration'};
  registration=await one('registrations',{eventId:EVENT_ID,userId:user.id});
  if(!registration)fail('registration changed; scan again',409);
  return {registration,joined:null};
 }
 // A conference block scanned at its door joins the person's plan, so the plan, the organisers' block lists and the
 // summary agree with the attendance. A save racing it (another tab) is read again and keeps its answers.
 // byDesk: an organiser's tick, remembered in deskAdded so unticking it takes the block out again (dropFromPlan).
 async function addToPlan(registration,activityId,{byDesk=false}={}){
  for(let attempt=0;attempt<3;attempt++){
   const activities=[...new Set([...(Array.isArray(registration.answers?.activities)?registration.answers.activities:[]),activityId])].sort();
   const desk=byDesk?{deskAdded:[...new Set([...deskAdded(registration),activityId])].sort()}:{};
   const saved=await store.update('registrations',{id:registration.id,userId:registration.userId,version:registration.version},{answers:{...registration.answers,activities,...desk},version:registration.version+1,updatedAt:now()});
   if(saved)return saved;
   registration=await one('registrations',{eventId:EVENT_ID,userId:registration.userId});
   if(!registration)fail('registration unavailable',404);
   if(planned(registration,activityId))return registration;
  }
  fail('registration changed; scan again',409);
 }
 /* A block the desk added (deskAdded) leaves the plan when its tick is undone, so a mistaken tick leaves nothing behind
    while the person cannot edit their registration; a block they chose themselves stays. Their own save drops the list. */
 const deskAdded=registration=>Array.isArray(registration.answers?.deskAdded)?registration.answers.deskAdded:[];
 async function dropFromPlan(registration,activityId){
  for(let attempt=0;attempt<3;attempt++){
   if(!deskAdded(registration).includes(activityId))return registration;
   const without=list=>list.filter(id=>id!==activityId),answers={...registration.answers,activities:without(registration.answers.activities??[]),deskAdded:without(deskAdded(registration))};
   const saved=await store.update('registrations',{id:registration.id,userId:registration.userId,version:registration.version},{answers,version:registration.version+1,updatedAt:now()});
   if(saved)return saved;
   registration=await one('registrations',{eventId:EVENT_ID,userId:registration.userId});
   if(!registration)fail('registration unavailable',404);
  }
  fail('registration changed; reload before saving',409);
 }
 const dropFailedNotice=async userId=>{try{await store.remove('notices',{eventId:EVENT_ID,userId,kind:PARTY_NOTICE.kind,status:'failed'});}catch{/* see above */}};
 const config=async()=>{const row=await one('config',{id:EVENT_ID});return {...configView(row?.data),version:row?.version??0};};
 /* The programme as it stands, organisers' edits included: the event, every activity a stored id may name (legacy ones
    too) for hours and the export, and the blocks that take a check-in, whose windows follow their current times. */
 const live=async()=>{const event=await programme.event();return {event,all:[...event.activities,...LEGACY_FIIU_ACTIVITIES],checkin:event.activities.filter(isCheckinActivity)};};
 // A block as the organiser editor lists it: current values, the edit's version (0: none), the built-in values and,
 // for a block that takes a check-in, how many people checked in (an edit to its time changes their hours).
 const programmeItem=async(activity,row)=>({...mergeActivity(activity,row),version:row?.version??0,original:originalOf(activity),checkedIn:isCheckinActivity(activity)?await store.count('attendance',{activityId:activity.id}):0});
 const publications=async(url,onlyPublished)=>{
  // kind=materials lists recordings and materials together, with the same newest-first cursor as the other kinds.
  const kind=url.searchParams.get('kind')||undefined;
  if(kind&&!['news','recording','material','materials'].includes(kind))fail('invalid publication kind');
  const cursor=url.searchParams.get('cursor'),previous=cursor?await one('content',{id:identifier(cursor),eventId:EVENT_ID}):null;
  if(cursor&&!previous)fail('invalid content cursor');
  const rows=await store.find('content',{eventId:EVENT_ID,...(onlyPublished?{status:'published'}:{})},{kind,newest:true,after:previous?.id,afterCreatedAt:previous?.createdAt,limit:100});
  return {content:rows.map(contentView),nextCursor:rows.length===100?rows.at(-1).id:null};
 };
 return async({req,res,url,user})=>{
  const path=url.pathname;
  if(!/^\/api\/(?:fiiu(?:\/|$)|admin\/fiiu(?:\/|$))/.test(path))return false;
  const staff=path.startsWith('/api/admin/'),read=['GET','HEAD'].includes(req.method);
  // The public programme is read-only; HEAD is answered like GET (Node sends no body for it).
  if(path==='/api/fiiu'&&!read){send(res,405,{error:'method not allowed'},{Allow:'GET, HEAD'});return true;}
  if(path!=='/api/fiiu'&&!user){send(res,401,{error:'sign in required'});return true;}
  if(staff&&user.permission!=='admin'){send(res,403,{error:'administrator access required'});return true;}
  if(!read&&!sameOrigin(req)){send(res,403,{error:'cross-origin request rejected'});return true;}
  if(!rateLimit(req,res,user,path))return true;
  if(path==='/api/fiiu'){
   const [settings,page,{event}]=await Promise.all([config(),publications(url,true),live()]);
   // The same answer for everyone and no cookies: the CDN serves repeat reads (a door rush on one venue address), at most ~15 s old.
   send(res,200,{event,config:settings,...page},{'Cache-Control':'public, max-age=0, s-maxage=15, stale-while-revalidate=60'});return true;
  }
  if(path==='/api/fiiu/registration'){
   // serverTime is the check-in clock (FIIU_CHECKIN_NOW in a rehearsal), so the check-in page judges a closed block on a reload as a scan would, never by the phone.
   if(req.method==='GET'){const [data,{all}]=await Promise.all([exportFiiuData(store,user.id),live()]);send(res,200,{...data,hours:attendanceHours(data.attendance,all),user:{id:user.id,name:user.name,email:user.email,city:user.city},isAdmin:user.permission==='admin',serverTime:new Date(clock()).toISOString()});return true;}
   if(req.method==='PUT'){
    const [settings,input,existing]=await Promise.all([config(),body(req),one('registrations',{eventId:EVENT_ID,userId:user.id})]);
    if(!settings.registrationOpen)fail('registration is closed',403);
    // A registration made at a block's door keeps that mark once its person completes it, for the organisers' list and export.
    sameAccount(input,user);const expected=version(input.version),answers={...normalizeRegistration(input),...(existing?.answers?.walkIn===true?{walkIn:true}:{})};
    if((existing?.version??0)!==expected||(existing?.id??null)!==(input.registrationId??null))fail('registration changed; reload before saving',409);
    const patch={email:user.email,answers,labStatus:applicationStatus(answers,existing),version:expected+1,updatedAt:now()};
    if(existing){
     // Edits never email: the summary goes out once, after the first registration.
     const registration=await store.update('registrations',{id:existing.id,userId:user.id,version:expected},patch);
     if(!registration)fail('registration changed; reload before saving',409);
     if(plansParty(answers)&&!plansParty(existing.answers))await dropFailedNotice(user.id);
     send(res,200,{registration});return true;
    }
    // A first registration is stored 'none', then its summary goes out the way the organiser dashboard's "Send the
    // summary" button sends one (deliverConfirmation): a compare-and-set claim 'none' → 'pending' on that status alone,
    // so the version (and with it an edit saved from another tab meanwhile) is never disturbed, the send, and the
    // outcome. So a lost answer to the insert, or a failure before the claim, leaves 'none', which the button (or the
    // backfill script) can still send, rather than a 'pending' that nothing retries. The send is awaited because the
    // hosting gives no work time after the response; the mailer caps it at 8 seconds, and its outcome never fails the
    // registration. Reserved test domains are 'skipped' for good. The sending allowance is spent only once the insert
    // succeeded, so a failed save never uses it up; a registration over the limit simply stays 'none'. The claim
    // stamps confirmation_sent_at, so the organisers' daily cap counts the send while it is under way and, if it ends
    // 'uncertain', afterwards (server/fiiu-confirmations.js).
    const language=registrationLanguage(input,req);
    const confirmationStatus=confirmation&&isReservedRecipient(user.email)?'skipped':'none';
    let registration=await store.insert('registrations',{id:randomUUID(),eventId:EVENT_ID,userId:user.id,...patch,createdAt:now(),confirmationStatus,confirmationLanguage:language,confirmationSentAt:null});
    if(!registration)fail('registration changed; reload before saving',409);
    if(confirmation&&confirmationStatus==='none'&&emailAllowed(user)){
     // null: an organiser's batch claimed the row first and is sending it. A throw: the claim or the outcome write
     // failed, and the row says so ('none' or 'pending'). Either way this response reports the email as 'pending'.
     let delivered=null;try{delivered=await deliverConfirmation({store,confirm:confirmation,config:settings,event:(await live()).event,registration,attemptAt:now()});}catch{/* see above */}
     registration={...registration,confirmationStatus:delivered?.status??'pending',confirmationSentAt:delivered?.sentAt??null};
    }
    send(res,200,{registration,confirmationEmail:registration.confirmationStatus});return true;
   }
   if(req.method==='DELETE'){
    const [input,existing]=await Promise.all([body(req),one('registrations',{eventId:EVENT_ID,userId:user.id})]);sameAccount(input,user);const expected=version(input.version);
    if((existing?.version??0)!==expected||(existing?.id??null)!==(input.registrationId??null))fail('registration changed; reload before cancelling',409);
    if(existing){if(!await store.remove('registrations',{id:existing.id,userId:user.id,version:expected}))fail('registration changed; reload before cancelling',409);await dropFailedNotice(user.id);}
    send(res,200,{ok:true});return true;
   }
  }
  if(path==='/api/fiiu/checkin'&&req.method==='POST'){
   // Self check-in from the session QR (or its 6-character code). Only the lab and the conference blocks qualify.
   const [input,{all,checkin:blocks}]=await Promise.all([body(req),live()]),t=clock(),reply=(status,payload)=>{send(res,status,payload);return true;};
   const expired=()=>reply(410,{error:'check-in code expired',code:'expired'});
   let activity;
   if(input.activityId===undefined||input.activityId===null||input.activityId===''){activity=codes.find(input.code,blocks)?.activity;if(!activity)return expired();}
   else{activity=blocks.find(a=>a.id===input.activityId);if(!activity)return reply(400,{error:'invalid activity',code:'invalid_activity'});if(codes.verify(activity.id,input.code)===null)return expired();}
   const span=checkinWindow(activity),activityId=activity.id;
   // The confirmation names the block it recorded (as the programme stands), so the page can say which one even before, or without, the programme.
   const block={id:activityId,title:activity.title,date:activity.date,time:activity.time??'',venue:activity.venue??''};
   // joined: what this scan added before checking in ('registration' at the door, 'plan' for the block), so the page can say so.
   // account: the signed-in email the attendance belongs to, so a phone lent to someone else says whose check-in this is.
   const confirmed=(created,attendance,joined=null)=>{const row=attendance.find(a=>a.activityId===activityId);return reply(created?201:200,{result:created?'checked_in':'already_checked_in',activityId,checkedInAt:row?.createdAt??null,method:row?.method??null,attendance:attendance.map(attendanceView),hours:attendanceHours(attendance,all),activity:block,account:user.email,...(joined?{joined}:{})});};
   const registrationOpen=async()=>(await config()).registrationOpen;
   const notRegistered=async()=>reply(404,{error:'registration unavailable',code:'not_registered',activityId,registration:activity.registration,registrationOpen:await registrationOpen()});
   let registration=await one('registrations',{eventId:EVENT_ID,userId:user.id});
   // A repeat scan keeps the first confirmation whatever changed since: check-in may have closed, the block may have
   // left the plan, or an edited laboratory application may be back under review. The valid screen code is still required.
   const existing=registration?await store.find('attendance',{registrationId:registration.id}):[];
   if(existing.some(a=>a.activityId===activityId))return confirmed(false,existing);
   // No opening time: a scan days before the block is recorded like one at the door, organisers' included. Once check-in
   // closes everyone is refused; the server judges the time and serverTime says when, whatever the phone's clock says.
   if(t>Date.parse(span.closesAt))return reply(409,{error:'check-in is closed for this activity',code:'outside_window',activityId,...span,serverTime:new Date(t).toISOString()});
   // While registration is open, a conference block takes anyone with a NODAL account: without a festival registration
   // the page first says what joining shares (walkIn), then join registers them at the door; a block missing from a plan
   // joins it. Once the organisers close registration, only blocks in a registration check in, as their switch says. The
   // laboratory always takes only an accepted application.
   let joined=null;
   if(activity.registration==='general'&&!(registration&&planned(registration,activityId))&&await registrationOpen()){
    if(!registration){
     if(input.join!==true)return reply(404,{error:'registration unavailable',code:'not_registered',activityId,registration:activity.registration,registrationOpen:true,walkIn:true});
     ({registration,joined}=await registerAtDoor(user,activityId,input,req));
    }
    if(!planned(registration,activityId)){registration=await addToPlan(registration,activityId);joined??='plan';}
   }
   if(!registration)return notRegistered();
   if(!canAttend(registration,activity))return reply(403,{error:'participant is not registered for this activity',code:activity.registration==='application'&&registration.answers?.applyLab===true?'lab_not_accepted':'not_in_plan',activityId,registration:activity.registration,registrationOpen:await registrationOpen()});
   let result;try{result=await recordAttendance(registration,activity,{by:user.id,method:'qr',at:new Date(t).toISOString(),known:existing});}catch(err){if(err.status===404)return notRegistered();throw err;}
   return confirmed(result.created,result.attendance,joined);
  }
  if(path==='/api/admin/fiiu/checkin'&&read){
   // The presenter screen: the current code and link, never participant data. Polled every 30 seconds per screen,
   // so the count is a single counted query rather than the full summary.
   const activity=(await live()).checkin.find(a=>a.id===url.searchParams.get('activityId'));
   if(!activity){send(res,400,{error:'invalid activity',code:'invalid_activity'});return true;}
   const current=codes.current(activity.id),span=checkinWindow(activity),t=clock();
   const link=`${originFor(req)}/fiiu-checkin.html?a=${encodeURIComponent(activity.id)}&c=${current.code}`;
   send(res,200,{activityId:activity.id,url:link,code:current.code,shortCode:current.shortCode,rotatesAt:current.rotatesAt,validUntil:current.validUntil,serverTime:new Date(t).toISOString(),
    window:{...span,open:t<=Date.parse(span.closesAt)},checkedIn:await store.count('attendance',{activityId:activity.id}),qr:qrOf(link)});
   return true;
  }
  if(path==='/api/admin/fiiu/config'){
   if(req.method==='GET'){const [{event},settings]=await Promise.all([live(),config()]);send(res,200,{event,config:settings});return true;}
   if(req.method==='PUT'){
    const input=await body(req),expected=version(input.version),data=normalizeConfig(input);
    const row=expected?await store.update('config',{id:EVENT_ID,version:expected},{data,version:expected+1}):await store.insert('config',{id:EVENT_ID,data,version:1});
    if(!row)fail('configuration changed; reload before saving',409);send(res,200,{config:{...row.data,version:row.version}});return true;
   }
  }
  if(path==='/api/admin/fiiu/confirmations'){
   // The summary email for people the first-registration send did not reach, sent from the organiser dashboard one
   // small batch per request (the page asks for the next one): each row is claimed with a compare-and-set before its
   // email goes out, so concurrent organisers or a double click never email anyone twice. retryFailed sends the
   // 'failed' rows instead of the 'none' ones; `after` is the previous answer's `next` cursor.
   if(read){send(res,200,{configured:Boolean(confirmation),...await confirmationState(store,{dailyCap,now:today()})});return true;}
   if(req.method==='POST'){
    const input=await body(req);
    if(input.retryFailed!==undefined&&typeof input.retryFailed!=='boolean')fail('invalid retryFailed');
    const after=input.after===undefined||input.after===null?null:identifier(input.after);
    if(!confirmation){send(res,503,{error:'email is not configured',code:'email_not_configured'});return true;}
    const batch=await sendConfirmationBatch({store,confirm:confirmation,event:(await live()).event,retryFailed:input.retryFailed===true,after,size:batchSize,dailyCap,now:today()});
    const counts=await confirmationCounts(store);
    if(batch.capped){send(res,429,capReply('daily summary email limit reached',batch,counts));return true;}
    send(res,200,{...batch,counts});return true;
   }
  }
  if(path==='/api/admin/fiiu/notices/closing-party'){
   // The closing-party announcement, once to every registrant who has not added the party, one small batch per request
   // as the summary button sends (server/fiiu-notices.js); it shares the summary emails' daily cap.
   // Closed once the party starts or while registration is closed (noticeClosed): read with the state, refused before any claim.
   const closed=async at=>{const [{event},settings]=await Promise.all([live(),config()]);return {event,closed:noticeClosed({event,registrationOpen:settings.registrationOpen,now:at})};};
   if(read){const at=today(),[state,{closed:shut}]=await Promise.all([noticeState(store,{dailyCap,now:at}),closed(at)]);send(res,200,{configured:Boolean(partyNotice),...state,closed:shut});return true;}
   if(req.method==='POST'){
    const input=await body(req);
    if(input.retryFailed!==undefined&&typeof input.retryFailed!=='boolean')fail('invalid retryFailed');
    const after=input.after===undefined||input.after===null?null:identifier(input.after);
    if(!partyNotice){send(res,503,{error:'email is not configured',code:'email_not_configured'});return true;}
    const at=today(),{event,closed:shut}=await closed(at);
    if(shut){send(res,409,{error:'the announcement is closed',code:'notice_closed',closed:shut,counts:await noticeCounts(store)});return true;}
    const batch=await sendNoticeBatch({store,notify:partyNotice,event,retryFailed:input.retryFailed===true,after,size:batchSize,dailyCap,now:at});
    const counts=await noticeCounts(store);
    if(batch.capped){send(res,429,capReply('daily email limit reached',batch,counts));return true;}
    send(res,200,{...batch,counts});return true;
   }
  }
  if(path==='/api/admin/fiiu/summary'&&req.method==='GET'){
   // The summary tags every ticked block 'general' (the Postgres function too), so the party joins the catalogue as one.
   send(res,200,{summary:await store.summary(EVENT_ID,(await live()).all.map(a=>a.registration==='social'?{...a,registration:'general'}:a))});return true;
  }
  if(path==='/api/admin/fiiu/registrations'&&req.method==='GET'){
   const cursor=url.searchParams.get('cursor'),after=cursor?identifier(cursor):undefined;
   const registrations=await store.find('registrations',{eventId:EVENT_ID},{after,limit:200});
   send(res,200,{registrations,nextCursor:registrations.length===200?registrations.at(-1).id:null});return true;
  }
  if(path==='/api/admin/fiiu/export'&&req.method==='GET'){
   // Attendance columns follow the registration columns, so existing spreadsheets keep their column positions:
   // what each person attended, certificate minutes and rounded hours, how each block was confirmed, and one Lima
   // check-in time per NODAL block. confirmationEmail (the summary email's status), then registeredAtDoor, then registeredAtLima (registeredAt, which stays
   // UTC, in the check-in columns' Lima time), then hoursPending (the attended blocks without a time yet, so their hours count 0), come last for the same reason.
   const {all,checkin:nodal}=await live(),blocks=nodal.map(a=>a.id);
   const rows=[['registrationId','email','firstName','lastName','country','city','profile','publicOfficial','activities','externalActivities','labStatus','institution','position','nationalId','gender','age','accessibility','accessibilityOther','motivation','motivationOther','previousAttendance','registeredAt','attendedActivities','attendedDays','attendedMinutes','certificateHours','checkInMethods',...blocks.map(id=>`checkInLima_${id}`),'confirmationEmail','registeredAtDoor','registeredAtLima','hoursPending']];let after;
   const list=value=>Array.isArray(value)?value.join('; '):'';
   const attended=new Map(),order=id=>{const i=all.findIndex(a=>a.id===id);return i<0?all.length:i;};
   do{const page=await store.find('attendance',{},{after});for(const row of page)attended.set(row.registrationId,[...(attended.get(row.registrationId)??[]),row]);after=page.length===200?page.at(-1).id:null;}while(after);
   do{const page=await store.find('registrations',{eventId:EVENT_ID},{after});for(const r of page){
    const a=r.answers,done=(attended.get(r.id)??[]).sort((x,y)=>order(x.activityId)-order(y.activityId)||(x.activityId<y.activityId?-1:1)),hours=attendanceHours(done,all),byId=new Map(done.map(x=>[x.activityId,x]));
    const days=[...new Set(done.map(x=>all.find(y=>y.id===x.activityId)?.date).filter(Boolean))].sort();
    rows.push([r.id,r.email,a.firstName,a.lastName,a.country,a.city,a.profile,a.publicOfficial,list(a.activities),list(a.externalActivities),r.labStatus,a.institution,a.position,a.nationalId,a.gender,a.age,list(a.accessibility),a.accessibilityOther,a.motivation,a.motivationOther,a.previousAttendance,r.createdAt,
     list(done.map(x=>x.activityId)),list(days),hours.minutes,hours.hours,list(done.map(x=>`${x.activityId}:${x.method??'staff'}`)),...blocks.map(id=>limaTime(byId.get(id)?.createdAt)),r.confirmationStatus??'none',a.walkIn===true,limaTime(r.createdAt),list(hours.untimed)]);
   }after=page.length===200?page.at(-1).id:null;}while(after);
   send(res,200,csv(rows),{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="fiiu-2026-registrations.csv"'});return true;
  }
  let match=path.match(/^\/api\/admin\/fiiu\/registrations\/([^/]+)(\/attendance)?$/);
  if(match){
   let registration=await one('registrations',{id:identifier(match[1]),eventId:EVENT_ID});if(!registration)fail('registration unavailable',404);
   if(!match[2]&&req.method==='GET'){const [attendance,{all}]=await Promise.all([store.find('attendance',{registrationId:registration.id}),live()]);send(res,200,{registration,attendance,hours:attendanceHours(attendance,all)});return true;}
   if(!match[2]&&req.method==='PATCH'){
    const input=await body(req),expected=version(input.version);
    if(!registration.answers.publicOfficial||!registration.answers.applyLab||!['pending','accepted','declined'].includes(input.labStatus))fail('invalid laboratory review');
    const updated=await store.update('registrations',{id:registration.id,version:expected},{labStatus:input.labStatus,version:expected+1,updatedAt:now()});
    if(!updated)fail('registration changed; reload before reviewing',409);send(res,200,{registration:updated});return true;
   }
   if(match[2]&&req.method==='PUT'){
    const [input,{all}]=await Promise.all([body(req),live()]),activity=all.find(a=>a.id===input.activityId);
    if(!activity||typeof input.attended!=='boolean')fail('invalid attendance');
    // A conference block outside the plan joins it: organisers confirm attendance from their own records, also once
    // registration is closed (a scan outside the plan still needs it open).
    if(input.attended&&activity.registration==='general'&&!planned(registration,activity.id))registration=await addToPlan(registration,activity.id,{byDesk:true});
    if(input.attended&&!canAttend(registration,activity))fail('participant is not registered for this activity');
    // Unticking removes the row whichever way it was recorded, so staff can correct a QR check-in.
    if(!input.attended){await store.remove('attendance',{registrationId:registration.id,activityId:activity.id});await dropFromPlan(registration,activity.id);}
    const attendance=input.attended?(await recordAttendance(registration,activity,{by:user.id,method:'staff'})).attendance:await store.find('attendance',{registrationId:registration.id});
    send(res,200,{attendance,hours:attendanceHours(attendance,all)});return true;
   }
  }
  match=path.match(/^\/api\/admin\/fiiu\/programme(?:\/([^/]+))?$/);
  if(match)try{
   // Organisers edit the details of the built-in blocks, never their id, period or kind (registrations, check-ins and
   // conversations point at those). One row per edited block with its own version: 0 creates it, an old version is a
   // conflict answered with the block as it now stands, and DELETE restores the built-in values.
   if(match[1]===undefined&&read){
    const byId=new Map((await programme.rows()).map(row=>[row.id,row]));
    send(res,200,{activities:await Promise.all(FIIU_EVENT.activities.map(activity=>programmeItem(activity,byId.get(activity.id))))});return true;
   }
   const activity=match[1]===undefined?null:FIIU_EVENT.activities.find(a=>a.id===match[1]);
   if(match[1]!==undefined&&['PUT','DELETE'].includes(req.method)&&!activity)fail('activity unavailable',404);
   const current=()=>one('programme',{id:activity.id,eventId:EVENT_ID});
   const conflict=async row=>{send(res,409,{error:'programme changed; reload before saving',code:'programme_conflict',activity:await programmeItem(activity,row)});return true;};
   if(activity&&req.method==='PUT'){
    const input=await body(req),expected=version(input.version),data=normalizeProgrammeEdit(activity,input),existing=await current();
    if((existing?.version??0)!==expected)return conflict(existing);
    const patch={data,version:expected+1,updatedBy:user.id,updatedAt:now()};let row=null;
    if(expected)row=await store.update('programme',{id:activity.id,eventId:EVENT_ID,version:expected},patch);
    else try{row=await store.insert('programme',{id:activity.id,eventId:EVENT_ID,...patch});}catch(err){if(err.status!==409)throw err;}
    // Cleared whatever happened: a lost race means the programme changed too.
    programme.clear();
    if(!row)return conflict(await current());
    send(res,200,{activity:await programmeItem(activity,row)});return true;
   }
   if(activity&&req.method==='DELETE'){
    const raw=url.searchParams.get('version')??'',expected=version(/^\d{1,9}$/.test(raw)?Number(raw):undefined);
    const removed=expected?await store.remove('programme',{id:activity.id,eventId:EVENT_ID,version:expected}):0;
    programme.clear();
    if(!removed){const existing=await current();if(existing||expected)return conflict(existing);}
    send(res,200,{activity:await programmeItem(activity,null)});return true;
   }
  }catch(err){
   // The editor explains each refusal by its code (invalid_title, invalid_time…).
   if(err?.status===400&&typeof err.code==='string'&&/^invalid_[a-z_]+$/.test(err.code)&&!res.headersSent){send(res,400,{error:err.message,code:err.code});return true;}
   throw err;
  }
  if(path==='/api/admin/fiiu/content'){
   if(req.method==='GET'){send(res,200,await publications(url,false));return true;}
   if(req.method==='POST'){
    // The editor may send a UUID made once per new publication and reuse it on retry: a save whose response was lost
    // then returns the stored row instead of publishing twice. Only an identical retry is answered that way; different
    // content or status under a stored id (edited, or published, after the lost save) is a conflict, so the editor keeps
    // its form instead of reporting a save that did not happen (as the NODAL news desk does). Ids held by another event
    // are never reused or changed.
    const input=await body(req),publication=normalizeContent(input),id=input.id==null?randomUUID():identifier(input.id),stamp=now();
    let content;try{content=await store.insert('content',{id,eventId:EVENT_ID,...publication,...(publication.status==='published'?{data:{...publication.data,publishedAt:stamp}}:{}),version:1,createdAt:stamp,updatedAt:stamp});}
    catch(err){
     const existing=input.id!=null&&err.status===409&&await one('content',{id,eventId:EVENT_ID});if(!existing)throw err;
     if(existing.status!==publication.status||Object.keys(publication.data).some(k=>existing.data?.[k]!==publication.data[k])){send(res,409,{error:'content changed; reload before saving',content:contentView(existing)});return true;}
     send(res,200,{content:contentView(existing)});return true;
    }
    send(res,201,{content:contentView(content)});return true;
   }
  }
  match=path.match(/^\/api\/admin\/fiiu\/content\/([^/]+)$/);
  if(match&&req.method==='PATCH'){
   const input=await body(req),expected=version(input.version),id=identifier(match[1]),next=normalizeContent(input),current=await one('content',{id,eventId:EVENT_ID});
   if(current?.version!==expected)fail('content changed; reload before saving',409);
   // Feeds are ordered and dated by createdAt, so a publication's first move to 'published' restamps it: a draft written
   // earlier then appears, and is dated, where it went public. data.publishedAt remembers that moment across later edits,
   // archiving and republishing (rows published before the marker existed keep their createdAt). No schema change needed.
   const stamp=now(),first=next.status==='published'&&current.status!=='published'&&!current.data.publishedAt;
   const publishedAt=first?stamp:current.data.publishedAt||(current.status==='published'?current.createdAt:undefined);
   const content=await store.update('content',{id,eventId:EVENT_ID,version:expected},{...next,data:{...next.data,...(publishedAt?{publishedAt}:{})},...(first?{createdAt:stamp}:{}),version:expected+1,updatedAt:stamp});
   if(!content)fail('content changed; reload before saving',409);send(res,200,{content:contentView(content)});return true;
  }
  send(res,404,{error:'not found'});return true;
 };
}
