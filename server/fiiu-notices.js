import {randomUUID} from 'node:crypto';
import {EVENT_ID} from './fiiu-domain.js';
import {emailLanguage} from './fiiu-email.js';
import {sendingDay,sentSince,settledSentAt,overCap,twice,BATCH_SIZE,DAILY_CAP} from './fiiu-confirmations.js';

/* One-off festival notices: today only the closing-party announcement, emailed once to every registrant who has not
   added the party (GET/POST /api/admin/fiiu/notices/closing-party in server/fiiu-api.js, one small batch per request,
   like the summary-email backfill in server/fiiu-confirmations.js, whose rules it follows).

   Each person is claimed before their email goes out by inserting their notice row ('pending', sent_at = the attempt's
   start); the row is unique per person and kind, so two organisers, a double click or two server instances never email
   anyone twice: whoever loses the insert skips that person. Who is waiting is judged when the batch runs: a
   registration whose plan lacks the party and who has no notice of this kind. The outcome is written as for the
   summary: 'sent' keeps the provider's time, 'uncertain' the attempt's (it may have gone out), 'failed' and 'skipped'
   none. "Retry failed" claims 'failed' rows back with a compare-and-set; 'uncertain' is never resent. Every send counts
   toward the daily cap the summary emails use, checked again once each person is claimed (see DAILY_CAP). */
export const PARTY_NOTICE={kind:'closing-party',activityId:'closing-party'};
export const NOTICE_STATUSES=['pending','sent','failed','uncertain','skipped'];
const OUTCOMES=['sent','failed','uncertain','skipped'];
const planned=(registration,activityId)=>Array.isArray(registration.answers?.activities)&&registration.answers.activities.includes(activityId);

// Who is waiting, and how many notices are in each state: counted, no private answers downloaded.
export async function noticeCounts(store,{kind,activityId}=PARTY_NOTICE){
 const [waiting,...values]=await Promise.all([store.noticeWaiting(EVENT_ID,{kind,activityId}),...NOTICE_STATUSES.map(status=>store.count('notices',{eventId:EVENT_ID,kind,status}))]);
 return {waiting,...Object.fromEntries(NOTICE_STATUSES.map((status,i)=>[status,values[i]]))};
}
// The panel's picture: the counts and today's use of the shared daily cap.
export async function noticeState(store,{dailyCap=DAILY_CAP,now=Date.now(),notice=PARTY_NOTICE}={}){
 const day=sendingDay(now),[counts,sentToday]=await Promise.all([noticeCounts(store,notice),sentSince(store,day.since)]);
 return {counts,dailyCap,sentToday,resetsAt:day.resetsAt};
}

/* Claims one person, sends their notice and records the outcome. claim: a new row (insert) or, on a retry, the failed row
   read (compare-and-set failed → pending). Returns {status, sentAt}, or null when someone else claimed them first (or
   their account was deleted meanwhile). A sender that throws counts as 'uncertain'. The outcome write matches only this
   claim and is tried twice, since a row left 'pending' is never sent again automatically. A claim that finds today's
   cap passed is put back unsent and answers {status:'capped'}: the new row removed (the person is waiting again), or
   the retried one 'failed' again as it was read. One whose cap count fails is put back the same way and throws. */
async function deliverNotice({store,notify,event,registration,failed,kind,attemptAt,cap}){
 const language=emailLanguage(registration.confirmationLanguage);
 let claimed;
 if(failed)claimed=await store.update('notices',{id:failed.id,status:'failed'},{status:'pending',language,sentAt:attemptAt,updatedAt:attemptAt});
 else try{claimed=await store.insert('notices',{id:randomUUID(),eventId:EVENT_ID,userId:registration.userId,kind,status:'pending',language,sentAt:attemptAt,createdAt:attemptAt,updatedAt:attemptAt});}
 catch(err){if(err.status===409||err.status===404)return null;throw err;}
 if(!claimed)return null;
 const mine={id:claimed.id,status:'pending',sentAt:attemptAt};
 if(await overCap(store,cap,()=>twice(()=>failed?store.update('notices',mine,{status:'failed',language:failed.language,sentAt:failed.sentAt,updatedAt:failed.updatedAt}):store.remove('notices',mine))))return {status:'capped'};
 let outcome;
 try{outcome=await notify({registration,event,language});}catch{outcome={status:'uncertain'};}
 const status=OUTCOMES.includes(outcome?.status)?outcome.status:'uncertain',sentAt=settledSentAt(status,outcome,attemptAt);
 await twice(()=>store.update('notices',mine,{status,sentAt,updatedAt:new Date().toISOString()}));
 return {status,sentAt};
}

/* One panel batch: up to `size` people (fewer when today's cap leaves less room), after the `after` cursor, all sent at
   once. Answers {capped:true, ...} without sending when today's cap is used up, and also, with the outcome counts of
   what it did send, when another sender took the room left before its claims (whoever it put back is still waiting
   for the next pass); otherwise the outcome counts, claimedElsewhere and `next`, the cursor for the following batch
   (null when this pass is done). The main pass walks the waiting registrations by id; retryFailed walks the 'failed'
   notices by id instead, removing the row of anyone who has since added the party or cancelled. */
export async function sendNoticeBatch({store,notify,event,retryFailed=false,after=null,size=BATCH_SIZE,dailyCap=DAILY_CAP,now=Date.now(),notice=PARTY_NOTICE}){
 const day=sendingDay(now),sentToday=await sentSince(store,day.since),room=Math.min(size,dailyCap-sentToday);
 if(room<=0)return {capped:true,dailyCap,sentToday,resetsAt:day.resetsAt};
 const {kind,activityId}=notice;let due,next;
 if(retryFailed){
  const failed=await store.find('notices',{eventId:EVENT_ID,kind,status:'failed'},{after:after??undefined,limit:room});
  const people=await Promise.all(failed.map(async row=>(await store.find('registrations',{eventId:EVENT_ID,userId:row.userId},{limit:1}))[0]??null));
  const rows=failed.map((row,i)=>({failed:row,registration:people[i]})),reachable=({registration})=>Boolean(registration)&&!planned(registration,activityId);
  /* Someone who has since added the party or cancelled can never be retried: their failed row goes (only while still
     'failed', so a claim another pass just made stands), so the panel's failed count and its "Retry failed" are only
     people a retry reaches, and they are waiting again should they drop the party or register anew. A failed send is
     not counted against the cap, and the provider never had it. */
  await Promise.all(rows.filter(row=>!reachable(row)).map(({failed:row})=>store.remove('notices',{id:row.id,status:'failed'})));
  due=rows.filter(reachable);
  next=failed.length===room?failed.at(-1).id:null;
 }else{
  const waiting=await store.noticeAudience(EVENT_ID,{kind,activityId,after,limit:room});
  due=waiting.map(registration=>({registration}));
  next=waiting.length===room?waiting.at(-1).id:null;
 }
 const attemptAt=new Date(now).toISOString(),cap={dailyCap,since:day.since},settled=await Promise.allSettled(due.map(({registration,failed})=>deliverNotice({store,notify,event,registration,failed,kind,attemptAt,cap})));
 const broken=settled.find(result=>result.status==='rejected');if(broken)throw broken.reason;
 const results={sent:0,failed:0,uncertain:0,skipped:0,claimedElsewhere:0};let heldBack=0;
 for(const {value} of settled)if(value?.status==='capped')heldBack++;else results[value===null?'claimedElsewhere':value.status]++;
 if(heldBack)return {capped:true,...results,dailyCap,sentToday:await sentSince(store,day.since),resetsAt:day.resetsAt};
 return {...results,next,dailyCap,sentToday:sentToday+results.sent+results.uncertain,resetsAt:day.resetsAt};
}
