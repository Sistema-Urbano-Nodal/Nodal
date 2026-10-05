import {EVENT_ID,DEFAULT_CONFIG} from './fiiu-domain.js';
import {isReservedRecipient,emailLanguage} from './fiiu-email.js';

/* Sending the FIIU registration summary to people the first-registration email did not reach: confirmation_status
   'none' (registered before the email existed, while it was off, or over the hourly sending limit) and, on request,
   'failed'. Shared by the organiser dashboard (GET/POST /api/admin/fiiu/confirmations in server/fiiu-api.js, one small
   batch per request) and scripts/send-fiiu-confirmations.js (the whole list in one run).

   Every send first claims its row with a compare-and-set on the status it was read with ('none' → 'pending', or
   'failed' → 'pending' on a retry), so two organisers clicking at once, a double click, a rerun of the script or the
   script and the dashboard together never email anyone twice: whoever loses the claim skips that row. 'failed' means
   the provider cannot have the message, so retrying it is safe; 'uncertain' (and a 'pending' that never reported back)
   is never retried. The email goes out in the language stored with the registration, else Spanish; reserved test
   addresses end as 'skipped'. */
export const CONFIRMATION_STATUSES=['none','pending','sent','failed','uncertain','skipped'];
const OUTCOMES=['sent','failed','uncertain','skipped'];
// One dashboard request sends at most BATCH_SIZE emails, concurrently, each under the mailer's 8-second cap, so a
// request ends well inside the hosting's function time limit; the page asks for the next batch.
export const BATCH_SIZE=4;
/* Summary emails a UTC day, sign-up ones included: the dashboard stops sending once this many have gone out today.
   Counted in the database, so every server instance sees the same total, from every send that may have reached the
   provider: confirmation_sent_at is stamped when a send starts (the row turns 'pending') and is kept for 'sent' (as
   the time the provider accepted it) and 'uncertain'; only 'failed' and 'skipped', which the provider cannot have,
   clear it. So a slow mail server that leaves every send 'uncertain' still uses up the cap. Gmail allows about 500
   messages in any 24 hours for the whole account (sign-up, password and summary emails together); two UTC days back
   to back can put twice the cap inside 24 hours, still under that. Two organisers sending at the same moment can pass
   the cap by at most one batch each, and a registration cancelled the same day takes its email out of the count
   (its row is deleted). Sign-ups themselves are never held back by it. */
export const DAILY_CAP=150;
// The states whose confirmation_sent_at marks a send that may have reached the provider.
export const ATTEMPTED=['sent','uncertain','pending'];

export const maskEmail=email=>{const [name,domain]=String(email).split('@');return `${name.slice(0,1)}***@${domain??''}`;};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// The live festival settings the email links to (programme URL and the like).
export async function festivalConfig(store){
 const row=(await store.find('config',{id:EVENT_ID},{limit:1}))[0];
 return {...DEFAULT_CONFIG,...row?.data};
}

/* Claims one registration from the status it was read with, sends its summary and records the outcome. Shared by the
   first registration (server/fiiu-api.js), the dashboard batches and the script. Returns {status, sentAt} (status
   'sent', 'failed', 'uncertain' or 'skipped'), or null when someone else claimed the row first. A sender that throws
   counts as 'uncertain'. The outcome write is tried twice, since a row left 'pending' is never sent again
   automatically: after a 'failed' send that would mean nobody ever gets the email. It matches only this claim (its
   'pending' and the attemptAt it stamped), so a retry whose first try did land, after which a "Retry failed" pass
   may have claimed the row again, never overwrites that newer send. A failed claim, or an outcome write that fails
   twice, throws; the row then stays as it was, or 'pending'. No row matches the outcome write when the registration
   was cancelled meanwhile, and nothing is recreated. The claim stamps confirmation_sent_at with attemptAt so the daily
   cap counts the send from the moment it starts (see DAILY_CAP and settledSentAt). */
export async function deliverConfirmation({store,confirm,config,registration,attemptAt=new Date().toISOString()}){
 const language=emailLanguage(registration.confirmationLanguage);
 const claimed=await store.update('registrations',{id:registration.id,confirmationStatus:registration.confirmationStatus},{confirmationStatus:'pending',confirmationLanguage:language,confirmationSentAt:attemptAt});
 if(!claimed)return null;
 let outcome;
 try{outcome=await confirm({registration:claimed,config,language});}catch{outcome={status:'uncertain'};}
 const status=OUTCOMES.includes(outcome?.status)?outcome.status:'uncertain',sentAt=settledSentAt(status,outcome,attemptAt);
 const record=()=>store.update('registrations',{id:registration.id,confirmationStatus:'pending',confirmationSentAt:attemptAt},{confirmationStatus:status,confirmationSentAt:sentAt});
 try{await record();}catch{await pause(250);await record();}
 return {status,sentAt};
}
// confirmation_sent_at once a send settles: the provider's acceptance time for 'sent', the attempt's start for
// 'uncertain' (it may have gone out, so it keeps counting against the daily cap), none for 'failed' or 'skipped'.
export const settledSentAt=(status,outcome,attemptAt)=>status==='sent'?outcome?.sentAt??new Date().toISOString():status==='uncertain'?attemptAt:null;

// How many registrations are in each summary-email state: one exact count per state, no rows downloaded.
export async function confirmationCounts(store){
 const values=await Promise.all(CONFIRMATION_STATUSES.map(confirmationStatus=>store.count('registrations',{eventId:EVENT_ID,confirmationStatus})));
 return Object.fromEntries(CONFIRMATION_STATUSES.map((status,i)=>[status,values[i]]));
}

// The UTC day `now` falls in: its start, and when the next one begins (19:00 in Lima).
export function sendingDay(now=Date.now()){
 const start=new Date(now);start.setUTCHours(0,0,0,0);
 return {since:start.toISOString(),resetsAt:new Date(start.getTime()+864e5).toISOString()};
}
// Sends since `since` that may have reached the provider: accepted, uncertain or still under way.
export const sentSince=(store,since)=>store.count('registrations',{eventId:EVENT_ID},{atLeast:{confirmationSentAt:since},oneOf:{confirmationStatus:ATTEMPTED}});

// The dashboard's picture: the state counts and today's use of the daily cap.
export async function confirmationState(store,{dailyCap=DAILY_CAP,now=Date.now()}={}){
 const day=sendingDay(now),[counts,sentToday]=await Promise.all([confirmationCounts(store),sentSince(store,day.since)]);
 return {counts,dailyCap,sentToday,resetsAt:day.resetsAt};
}

/* One dashboard batch: up to `size` registrations still at 'none' (or 'failed' with retryFailed), after the `after`
   cursor in id order, all sent at once. Answers {capped:true, ...} without sending anything when today's cap is used
   up; otherwise the outcome counts, `claimedElsewhere` (rows another sender claimed first), `next` (the cursor for the
   following batch, null when this was the last) and `remaining` (rows of that state still after the cursor). The
   cursor keeps a retry pass from picking the rows that just failed again, and ends every pass. */
export async function sendConfirmationBatch({store,confirm,retryFailed=false,after=null,size=BATCH_SIZE,dailyCap=DAILY_CAP,now=Date.now()}){
 const day=sendingDay(now),sentToday=await sentSince(store,day.since),room=Math.min(size,dailyCap-sentToday);
 if(room<=0)return {capped:true,dailyCap,sentToday,resetsAt:day.resetsAt};
 const confirmationStatus=retryFailed?'failed':'none';
 const [due,config]=await Promise.all([store.find('registrations',{eventId:EVENT_ID,confirmationStatus},{after:after??undefined,limit:room}),festivalConfig(store)]);
 const attemptAt=new Date(now).toISOString(),settled=await Promise.allSettled(due.map(registration=>deliverConfirmation({store,confirm,config,registration,attemptAt})));
 const broken=settled.find(result=>result.status==='rejected');if(broken)throw broken.reason;
 const results={sent:0,failed:0,uncertain:0,skipped:0,claimedElsewhere:0};
 for(const {value} of settled)results[value===null?'claimedElsewhere':value.status]++;
 const next=due.length===room?due.at(-1).id:null;
 const remaining=next?await store.count('registrations',{eventId:EVENT_ID,confirmationStatus},{after:next}):0;
 return {...results,remaining,next,dailyCap,sentToday:sentToday+results.sent+results.uncertain,resetsAt:day.resetsAt};
}

/* The command-line backfill (scripts/send-fiiu-confirmations.js): lists every registration still at 'none' (and
   'failed' with retryFailed) and, with send, emails them one at a time, delayMs apart. A dry run writes nothing and
   masks the addresses. Sending honours the same daily cap as the dashboard, counted again before every email (the
   dashboard may be sending too, and a long run can cross into the next UTC day): once today's sends reach it the run
   stops and answers capped: true with the cap, today's count and when it resets. ignoreCap (the script's
   --ignore-cap) is the operator's explicit override, since Gmail's ~500 a day also carries sign-up and password mail. */
export async function sendConfirmations({store,confirm=null,send=false,retryFailed=false,limit=Infinity,delayMs=1000,log=console.log,dailyCap=DAILY_CAP,ignoreCap=false,clock=Date.now}){
 if(send&&!confirm)throw new Error('Email is not configured: set EMAIL_SMTP_URL, EMAIL_FROM and PUBLIC_BASE_URL.');
 const config=await festivalConfig(store);
 const due=[];
 for(const confirmationStatus of retryFailed?['none','failed']:['none']){
  let after;
  do{
   const page=await store.find('registrations',{eventId:EVENT_ID,confirmationStatus},{after,limit:200});
   due.push(...page);
   after=page.length===200?page.at(-1).id:null;
  }while(after);
 }
 const results={listed:0,sent:0,failed:0,uncertain:0,skipped:0,claimedElsewhere:0};
 for(const registration of due.slice(0,limit)){
  if(!send){results.listed++;log(`${registration.id}  ${registration.createdAt}  ${emailLanguage(registration.confirmationLanguage)}  ${maskEmail(registration.email)}${isReservedRecipient(registration.email)?'  (test address: would be skipped)':''}`);continue;}
  if(!ignoreCap){
   const day=sendingDay(clock()),sentToday=await sentSince(store,day.since);
   if(sentToday>=dailyCap)return {...results,capped:true,dailyCap,sentToday,resetsAt:day.resetsAt};
  }
  results.listed++;
  const delivered=await deliverConfirmation({store,confirm,config,registration});
  if(delivered===null){results.claimedElsewhere++;continue;}
  results[delivered.status]++;
  log(`${registration.id}  ${delivered.status}`);
  if(delayMs)await pause(delayMs);
 }
 return results;
}
