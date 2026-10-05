import {randomUUID} from 'node:crypto';
import {fail,identifier,csv} from './courses-domain.js';
import {bodyJson} from './courses-api.js';
import {EVENT_ID,FIIU_EVENT,ALL_FIIU_ACTIVITIES,CHECKIN_ACTIVITIES,DEFAULT_CONFIG,normalizeRegistration,applicationStatus,version,normalizeContent,contentView,normalizeConfig,canAttend,checkinWindow,attendanceHours} from './fiiu-domain.js';
import {createCheckinCodes} from './fiiu-checkin.js';
import {packBits} from './qr.js';
import {isReservedRecipient,EMAIL_LANGUAGES} from './fiiu-email.js';
import {parseCookies} from './auth.js';
import {confirmationState,confirmationCounts,sendConfirmationBatch,deliverConfirmation,BATCH_SIZE,DAILY_CAP} from './fiiu-confirmations.js';
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
export async function exportFiiuData(store,userId){
 const registration=(await store.find('registrations',{eventId:EVENT_ID,userId},{limit:1}))[0]??null;
 const attendance=registration?await store.find('attendance',{registrationId:registration.id}):[];
 return {registration,attendance:attendance.map(attendanceView)};
}
// The summary email's language: the page's own (sent with the registration), else the site language cookie, else Spanish.
export function registrationLanguage(input,req){
 if(EMAIL_LANGUAGES.includes(input?.language))return input.language;
 const cookie=parseCookies(req?.headers?.cookie??'').get('nodal.lang');
 return EMAIL_LANGUAGES.includes(cookie)?cookie:'es';
}
// checkin: {secret, now} for the rotating codes (tests freeze the clock); publicOrigin: the configured site origin (a
// string or a function of the request) that check-in links point to, never the Host header in production.
// confirmation: async ({registration, config, language}) => {status, sentAt?}, the registration summary email (see
// server/fiiu-email.js), or null when email is off; emailAllowed(user) spends one send from the account's hourly
// allowance and the server-wide ceiling, and answers false when either is used up. backfill: {batchSize, dailyCap,
// now} for the organiser's "Send the summary" button (server/fiiu-confirmations.js); tests shrink them.
export function createFiiuApi({store,sameOrigin,send,rateLimit=()=>true,checkin={},encodeQr=null,publicOrigin=()=>fail('public base URL is not configured',503),confirmation=null,emailAllowed=()=>true,backfill={}}){
 const {batchSize=BATCH_SIZE,dailyCap=DAILY_CAP,now:today=()=>Date.now()}=backfill;
 // A link the encoder cannot draw (say, an unusually long configured origin) leaves the screen its typed address and short code.
 const qrOf=link=>{if(!encodeQr)return null;try{return qrView(encodeQr(link));}catch{return null;}};
 const one=async(name,filters)=>(await store.find(name,filters,{limit:1}))[0]??null;
 const codes=createCheckinCodes(checkin),clock=codes.now;
 const originFor=req=>(typeof publicOrigin==='function'?publicOrigin(req):publicOrigin)||fail('public base URL is not configured',503);
 // One row per person and block, shared by the staff checkbox and the QR check-in. An existing row is kept as it is
 // (its time and method stay the first confirmation's). The participant may cancel between the registration lookup
 // and the insert; the store reports that lost parent as 404.
 async function recordAttendance(registration,activity,{by,method,at=now()}){
  const filters={registrationId:registration.id,activityId:activity.id};let created=false;
  if(!await one('attendance',filters)){try{await store.insert('attendance',{id:randomUUID(),...filters,confirmedBy:by,createdAt:at,method});created=true;}catch(err){if(err.status===404)fail('registration unavailable',404);if(err.status!==409||!await one('attendance',filters))throw err;}}
  return {created,attendance:await store.find('attendance',{registrationId:registration.id})};
 }
 const config=async()=>{const row=await one('config',{id:EVENT_ID});return {...DEFAULT_CONFIG,...row?.data,version:row?.version??0};};
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
   const [settings,page]=await Promise.all([config(),publications(url,true)]);
   send(res,200,{event:FIIU_EVENT,config:settings,...page});return true;
  }
  if(path==='/api/fiiu/registration'){
   if(req.method==='GET'){const data=await exportFiiuData(store,user.id);send(res,200,{...data,hours:attendanceHours(data.attendance),user:{id:user.id,name:user.name,email:user.email,city:user.city},isAdmin:user.permission==='admin'});return true;}
   if(req.method==='PUT'){
    const settings=await config();if(!settings.registrationOpen)fail('registration is closed',403);
    const input=await body(req);sameAccount(input,user);const expected=version(input.version),answers=normalizeRegistration(input);
    const existing=await one('registrations',{eventId:EVENT_ID,userId:user.id});
    if((existing?.version??0)!==expected||(existing?.id??null)!==(input.registrationId??null))fail('registration changed; reload before saving',409);
    const patch={email:user.email,answers,labStatus:applicationStatus(answers,existing),version:expected+1,updatedAt:now()};
    if(existing){
     // Edits never email: the summary goes out once, after the first registration.
     const registration=await store.update('registrations',{id:existing.id,userId:user.id,version:expected},patch);
     if(!registration)fail('registration changed; reload before saving',409);
     send(res,200,{registration});return true;
    }
    // A first registration is stored 'none', then its summary goes out the way the organiser dashboard's "Send the
    // summary" button sends one (deliverConfirmation): a compare-and-set claim 'none' → 'pending' on that status alone,
    // so the version (and with it an edit saved from another tab meanwhile) is never disturbed, the send, and the
    // outcome. So 'pending' always means a send was started: a lost answer to the insert, or a failure before the
    // claim, leaves 'none', which the button (or the backfill script) can still send. The send is awaited because the
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
     let delivered=null;try{delivered=await deliverConfirmation({store,confirm:confirmation,config:settings,registration,attemptAt:now()});}catch{/* see above */}
     registration={...registration,confirmationStatus:delivered?.status??'pending',confirmationSentAt:delivered?.sentAt??null};
    }
    send(res,200,{registration,confirmationEmail:registration.confirmationStatus});return true;
   }
   if(req.method==='DELETE'){
    const input=await body(req);sameAccount(input,user);const expected=version(input.version),existing=await one('registrations',{eventId:EVENT_ID,userId:user.id});
    if((existing?.version??0)!==expected||(existing?.id??null)!==(input.registrationId??null))fail('registration changed; reload before cancelling',409);
    if(existing&&!await store.remove('registrations',{id:existing.id,userId:user.id,version:expected}))fail('registration changed; reload before cancelling',409);
    send(res,200,{ok:true});return true;
   }
  }
  if(path==='/api/fiiu/checkin'&&req.method==='POST'){
   // Self check-in from the session QR (or its 6-character code). Only the lab and the conference blocks qualify.
   const input=await body(req),t=clock(),reply=(status,payload)=>{send(res,status,payload);return true;};
   const expired=()=>reply(410,{error:'check-in code expired',code:'expired'});
   let activity;
   if(input.activityId===undefined||input.activityId===null||input.activityId===''){activity=codes.find(input.code,CHECKIN_ACTIVITIES)?.activity;if(!activity)return expired();}
   else{activity=CHECKIN_ACTIVITIES.find(a=>a.id===input.activityId);if(!activity)return reply(400,{error:'invalid activity',code:'invalid_activity'});if(codes.verify(activity.id,input.code)===null)return expired();}
   const span=checkinWindow(activity),activityId=activity.id;
   const confirmed=(created,attendance)=>{const row=attendance.find(a=>a.activityId===activityId);return reply(created?201:200,{result:created?'checked_in':'already_checked_in',activityId,checkedInAt:row?.createdAt??null,method:row?.method??null,attendance:attendance.map(attendanceView),hours:attendanceHours(attendance)});};
   const registrationOpen=async()=>(await config()).registrationOpen;
   const notRegistered=async()=>reply(404,{error:'registration unavailable',code:'not_registered',activityId,registrationOpen:await registrationOpen()});
   const registration=await one('registrations',{eventId:EVENT_ID,userId:user.id});
   // A repeat scan keeps the first confirmation whatever changed since: the window may have closed, the block may have
   // left the plan, or an edited laboratory application may be back under review. The valid screen code is still required.
   if(registration&&await one('attendance',{registrationId:registration.id,activityId}))return confirmed(false,await store.find('attendance',{registrationId:registration.id}));
   // The server judges the time; serverTime tells the page which side of the window it fell on, whatever the phone's clock says.
   const closed=t<Date.parse(span.opensAt)||t>Date.parse(span.closesAt);
   // An organiser rehearsing the screen outside the session: the code is proven valid and nothing is recorded.
   if(closed&&user.permission==='admin')return reply(200,{result:'rehearsal',activityId,...span,serverTime:new Date(t).toISOString()});
   if(closed)return reply(409,{error:'check-in is closed for this activity',code:'outside_window',activityId,...span,serverTime:new Date(t).toISOString()});
   if(!registration)return notRegistered();
   if(!canAttend(registration,activity))return reply(403,{error:'participant is not registered for this activity',code:activity.registration==='application'&&registration.answers?.applyLab===true?'lab_not_accepted':'not_in_plan',activityId,registrationOpen:await registrationOpen()});
   let result;try{result=await recordAttendance(registration,activity,{by:user.id,method:'qr',at:new Date(t).toISOString()});}catch(err){if(err.status===404)return notRegistered();throw err;}
   return confirmed(result.created,result.attendance);
  }
  if(path==='/api/admin/fiiu/checkin'&&read){
   // The presenter screen: the current code and link, never participant data. Polled every 30 seconds per screen,
   // so the count is a single counted query rather than the full summary.
   const activity=CHECKIN_ACTIVITIES.find(a=>a.id===url.searchParams.get('activityId'));
   if(!activity){send(res,400,{error:'invalid activity',code:'invalid_activity'});return true;}
   const current=codes.current(activity.id),span=checkinWindow(activity),t=clock();
   const link=`${originFor(req)}/fiiu-checkin.html?a=${encodeURIComponent(activity.id)}&c=${current.code}`;
   send(res,200,{activityId:activity.id,url:link,code:current.code,shortCode:current.shortCode,rotatesAt:current.rotatesAt,validUntil:current.validUntil,serverTime:new Date(t).toISOString(),
    window:{...span,open:t>=Date.parse(span.opensAt)&&t<=Date.parse(span.closesAt)},checkedIn:await store.count('attendance',{activityId:activity.id}),qr:qrOf(link)});
   return true;
  }
  if(path==='/api/admin/fiiu/config'){
   if(req.method==='GET'){send(res,200,{config:await config()});return true;}
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
    const batch=await sendConfirmationBatch({store,confirm:confirmation,retryFailed:input.retryFailed===true,after,size:batchSize,dailyCap,now:today()});
    const counts=await confirmationCounts(store);
    if(batch.capped){send(res,429,{error:'daily summary email limit reached',code:'daily_cap',dailyCap:batch.dailyCap,sentToday:batch.sentToday,resetsAt:batch.resetsAt,counts});return true;}
    send(res,200,{...batch,counts});return true;
   }
  }
  if(path==='/api/admin/fiiu/summary'&&req.method==='GET'){
   send(res,200,{summary:await store.summary(EVENT_ID,ALL_FIIU_ACTIVITIES)});return true;
  }
  if(path==='/api/admin/fiiu/registrations'&&req.method==='GET'){
   const cursor=url.searchParams.get('cursor'),after=cursor?identifier(cursor):undefined;
   const registrations=await store.find('registrations',{eventId:EVENT_ID},{after,limit:100});
   send(res,200,{registrations,nextCursor:registrations.length===100?registrations.at(-1).id:null});return true;
  }
  if(path==='/api/admin/fiiu/export'&&req.method==='GET'){
   // Attendance columns follow the registration columns, so existing spreadsheets keep their column positions:
   // what each person attended, certificate minutes and rounded hours, how each block was confirmed, and one Lima
   // check-in time per NODAL block. confirmationEmail (the summary email's status) comes last for the same reason.
   const blocks=CHECKIN_ACTIVITIES.map(a=>a.id);
   const rows=[['registrationId','email','firstName','lastName','country','city','profile','publicOfficial','activities','externalActivities','labStatus','institution','position','nationalId','gender','age','accessibility','accessibilityOther','motivation','motivationOther','previousAttendance','registeredAt','attendedActivities','attendedDays','attendedMinutes','certificateHours','checkInMethods',...blocks.map(id=>`checkInLima_${id}`),'confirmationEmail']];let after;
   const list=value=>Array.isArray(value)?value.join('; '):'';
   const attended=new Map(),order=id=>{const i=ALL_FIIU_ACTIVITIES.findIndex(a=>a.id===id);return i<0?ALL_FIIU_ACTIVITIES.length:i;};
   do{const page=await store.find('attendance',{},{after});for(const row of page)attended.set(row.registrationId,[...(attended.get(row.registrationId)??[]),row]);after=page.length===200?page.at(-1).id:null;}while(after);
   do{const page=await store.find('registrations',{eventId:EVENT_ID},{after});for(const r of page){
    const a=r.answers,done=(attended.get(r.id)??[]).sort((x,y)=>order(x.activityId)-order(y.activityId)||(x.activityId<y.activityId?-1:1)),hours=attendanceHours(done),byId=new Map(done.map(x=>[x.activityId,x]));
    const days=[...new Set(done.map(x=>ALL_FIIU_ACTIVITIES.find(y=>y.id===x.activityId)?.date).filter(Boolean))].sort();
    rows.push([r.id,r.email,a.firstName,a.lastName,a.country,a.city,a.profile,a.publicOfficial,list(a.activities),list(a.externalActivities),r.labStatus,a.institution,a.position,a.nationalId,a.gender,a.age,list(a.accessibility),a.accessibilityOther,a.motivation,a.motivationOther,a.previousAttendance,r.createdAt,
     list(done.map(x=>x.activityId)),list(days),hours.minutes,hours.hours,list(done.map(x=>`${x.activityId}:${x.method??'staff'}`)),...blocks.map(id=>limaTime(byId.get(id)?.createdAt)),r.confirmationStatus??'none']);
   }after=page.length===200?page.at(-1).id:null;}while(after);
   send(res,200,csv(rows),{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="fiiu-2026-registrations.csv"'});return true;
  }
  let match=path.match(/^\/api\/admin\/fiiu\/registrations\/([^/]+)(\/attendance)?$/);
  if(match){
   const registration=await one('registrations',{id:identifier(match[1]),eventId:EVENT_ID});if(!registration)fail('registration unavailable',404);
   if(!match[2]&&req.method==='GET'){const attendance=await store.find('attendance',{registrationId:registration.id});send(res,200,{registration,attendance,hours:attendanceHours(attendance)});return true;}
   if(!match[2]&&req.method==='PATCH'){
    const input=await body(req),expected=version(input.version);
    if(!registration.answers.publicOfficial||!registration.answers.applyLab||!['pending','accepted','declined'].includes(input.labStatus))fail('invalid laboratory review');
    const updated=await store.update('registrations',{id:registration.id,version:expected},{labStatus:input.labStatus,version:expected+1,updatedAt:now()});
    if(!updated)fail('registration changed; reload before reviewing',409);send(res,200,{registration:updated});return true;
   }
   if(match[2]&&req.method==='PUT'){
    const input=await body(req),activity=ALL_FIIU_ACTIVITIES.find(a=>a.id===input.activityId);
    if(!activity||typeof input.attended!=='boolean')fail('invalid attendance');
    if(input.attended&&!canAttend(registration,activity))fail('participant is not registered for this activity');
    // Unticking removes the row whichever way it was recorded, so staff can correct a QR check-in.
    if(!input.attended)await store.remove('attendance',{registrationId:registration.id,activityId:activity.id});
    const attendance=input.attended?(await recordAttendance(registration,activity,{by:user.id,method:'staff'})).attendance:await store.find('attendance',{registrationId:registration.id});
    send(res,200,{attendance,hours:attendanceHours(attendance)});return true;
   }
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
