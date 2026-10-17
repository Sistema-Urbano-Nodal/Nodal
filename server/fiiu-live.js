import {EVENT_ID,FIIU_EVENT,LIMA_OFFSET,isCheckinActivity} from './fiiu-domain.js';
import {talkActivity} from './fiiu-talk-domain.js';

/* The festival live window (GET /api/fiiu/live, server/fiiu-talk-api.js): the block under way and the next one, the
   open conversations, how many people reached each badge milestone, and the day's numbers. Registered people and
   organisers get the same answer, built at most once every 15 s per instance (concurrent requests share the build in
   flight), so a full room polling every 30 s costs the stores a few reads a minute rather than one set per phone.
   Counts only: no person's id, registration, attendance or name, except a message author's display name ("María G."),
   which registered people already see in the chats. */
export const LIVE_TTL_MS=15000;
// Lima keeps UTC-05:00 all year (fiiu-domain.js), so a fixed offset gives its date and wall-clock minutes.
const LIMA_MS=5*3600000;
const limaDay=t=>new Date(t-LIMA_MS).toISOString().slice(0,10);
const limaMinutes=t=>{const d=new Date(t-LIMA_MS);return d.getUTCHours()*60+d.getUTCMinutes();};
// The client's rules (web/scripts/fiiu-ui.js underway and nextFor): '09:00–13:00' runs from 09:00 until 13:00 Lima time;
// an untimed block (the laboratory, until its hours are known) has no start, so it is never under way, only next, until
// its day ends.
const START=/^\s*(\d{1,2}):(\d{2})\s*(?:[–-]|$)/,END=/[–-]\s*(\d{1,2}):(\d{2})\s*$/;
const startOf=a=>{const m=START.exec(a.time||'');return m?Number(m[1])*60+Number(m[2]):null;};
const endOf=a=>{const m=END.exec(a.time||'');return m?Number(m[1])*60+Number(m[2]):1440;};
// Programme order as the pages show it: date, then period, then time (fiiu-ui.js chronological).
const PERIODS=['lab','morning','evening','workshop','route','party'];
const rank=a=>{const i=PERIODS.indexOf(a.period);return i<0?PERIODS.length:i;};
const chronological=list=>[...list].sort((a,b)=>a.date.localeCompare(b.date)||rank(a)-rank(b)||(a.time||'').localeCompare(b.time||''));
const blockView=({id,title,date,time,venue})=>({id,title,date,time:time??'',venue:venue??''});
// At most max code points (never half an emoji), ending in an ellipsis when cut.
const cut=(value,max)=>{const chars=[...String(value??'')];return chars.length<=max?chars.join(''):chars.slice(0,max-1).join('').trimEnd()+'…';};
// A rating's totals hold scores 1 to 10, score 1 first.
const totals=counts=>Array.from({length:10},(_,i)=>Number(counts?.[i]??0));
function ratingOf(counts){
 const list=totals(counts),count=list.reduce((a,b)=>a+b,0);
 return {average:count?Math.round(list.reduce((sum,n,i)=>sum+n*(i+1),0)/count*10)/10:null,count};
}
// The open questions whose latest answer is read for each build; a festival opens a handful at a time, so the cap only
// bounds the reads should many be left open (the quietest, by revision, are left out).
const OPEN_READ_MAX=30,CONVERSATIONS=5;
const errorText=error=>error instanceof Error?error.message:String(error??'unknown error');

/* The badge milestones, exactly as Fiiu.festivalBadges (web/scripts/fiiu-ui.js) earns them, from a person's attended
   activity ids alone: a first activity (any of the programme or the legacy days except the closing party, which never
   takes a check-in; an id the programme does not know is none), four of the five panel (conference) blocks, all five,
   and Full FIIU: all five, two workshops and two routes, counted by kind as Fiiu.typeOf counts them. The laboratory has
   its own badge and no milestone. tests/fixtures/fiiu-badge-cases.json holds the cases both rules are tested against. */
const FULL_WORKSHOPS=2,FULL_ROUTES=2;
export function festivalMilestones(attended,event=FIIU_EVENT){
 const ids=new Set(attended),current=event.activities.filter(a=>!a.legacy);
 const done=[...event.activities,...(event.legacyActivities||[])].filter(a=>a.registration!=='social'&&ids.has(a.id));
 const external=period=>done.filter(a=>!['application','general'].includes(a.registration)&&(a.period==='route')===(period==='route')).length;
 const conferences=current.filter(a=>a.registration==='general'),panels=conferences.filter(a=>ids.has(a.id)).length;
 const all=conferences.length>0&&panels===conferences.length;
 return {first:done.length>=1,four:conferences.length>0&&panels>=Math.min(4,conferences.length),conferences:all,
  full:all&&external('workshop')>=FULL_WORKSHOPS&&external('route')>=FULL_ROUTES};
}

// fiiuStore: server/fiiu-repository.js; talkStore: server/fiiu-talk-repository.js; programme: the merged programme
// (server/fiiu-programme.js), so organisers' edits to titles, times and venues show here too.
export function createLive({fiiuStore,talkStore,programme={event:async()=>FIIU_EVENT},clock=Date.now,ttlMs=LIVE_TTL_MS,log=console.error}){
 // Every attendance row, 200 a page by id (the export reads them the same way). Only fiiu-2026 registrations exist, so
 // the rows are this festival's.
 async function attendance(){
  const rows=[];
  for(let after;;){const page=await fiiuStore.find('attendance',{},{after,limit:200});rows.push(...page);if(page.length<200)return rows;after=page.at(-1).id;}
 }
 // The newest answer still shown to participants: never a hidden or withdrawn one.
 const latestOf=async q=>(await talkStore.latestMessages(q.id,{limit:1})).rows.at(-1)??null;
 async function build(t){
  // listQuestions leaves hidden questions out (organisers' drafts), and with them their messages and scores.
  const [event,rows,registered,questions]=await Promise.all([programme.event(),attendance(),fiiuStore.count('registrations',{eventId:EVENT_ID}),talkStore.listQuestions(EVENT_ID)]);
  const today=limaDay(t),minutes=limaMinutes(t),midnight=Date.parse(`${today}T00:00:00${LIMA_OFFSET}`);
  /* Check-ins are rows of a block that can take one: the party never does, and an unknown id is no block. The day's
     numbers count check-ins, not people (one person at the morning and the evening block is two), and the band says
     so ("Asistencias hoy"); people are the milestone counts, first among them everyone with a check-in. */
  const known=new Set([...event.activities,...(event.legacyActivities||[])].filter(a=>a.registration!=='social').map(a=>a.id));
  const byActivity=new Map(),byPerson=new Map();let checkedInToday=0,checkedInTotal=0;
  for(const row of rows){
   if(!known.has(row.activityId))continue;
   checkedInTotal++;if(Date.parse(row.createdAt)>=midnight)checkedInToday++;
   byActivity.set(row.activityId,(byActivity.get(row.activityId)??0)+1);
   byPerson.set(row.registrationId,[...(byPerson.get(row.registrationId)??[]),row.activityId]);
  }
  const badges={first:0,four:0,conferences:0,full:0};
  for(const ids of byPerson.values()){const reached=festivalMilestones(ids,event);for(const k of Object.keys(badges))if(reached[k])badges[k]++;}
  const sessions=chronological(event.activities.filter(isCheckinActivity));
  const underway=a=>{const start=startOf(a);return start!==null&&a.date===today&&start<=minutes&&minutes<endOf(a);};
  const upcoming=a=>{const start=startOf(a);return a.date>today||(a.date===today&&(start===null?minutes<endOf(a):start>minutes));};
  const now=sessions.find(underway),next=sessions.find(a=>!underway(a)&&upcoming(a));
  /* The open questions, most recently active first: the newest visible answer, else when the question was last opened
     or edited (a rating question's scores leave no time behind), ties by revision. */
  const open=questions.filter(q=>q.status==='open').sort((a,b)=>Number(b.revision)-Number(a.revision)).slice(0,OPEN_READ_MAX);
  const latest=await Promise.all(open.map(latestOf));
  const activeAt=(q,m)=>Math.max(Date.parse(m?.createdAt??'')||0,Date.parse(q.updatedAt??q.createdAt??'')||0);
  const conversations=open.map((q,i)=>({q,m:latest[i],at:activeAt(q,latest[i])})).sort((a,b)=>b.at-a.at||Number(b.q.revision)-Number(a.q.revision)).slice(0,CONVERSATIONS)
   .map(({q,m})=>{const kind=q.kind??'chat';return {questionId:q.id,activityId:q.activityId,activityTitle:talkActivity(q.activityId,event)?.title??null,body:cut(q.body,180),kind,messageCount:Number(q.messageCount),
    latest:m?{author:m.authorName,body:cut(m.body,140),likeCount:Number(m.likeCount??0),createdAt:m.createdAt}:null,rating:kind==='rating'?ratingOf(q.ratingCounts):null};});
  return {
   festival:today>=event.startsOn&&today<=event.endsOn,generatedAt:new Date(t).toISOString(),
   now:now?{activity:blockView(now),checkedIn:byActivity.get(now.id)??0}:null,next:next?{activity:blockView(next)}:null,
   sessions:sessions.map(a=>({activityId:a.id,checkedIn:byActivity.get(a.id)??0})),conversations,badges,
   // Visible answers and scores of every question participants can open, closed ones included.
   pulse:{registered:Number(registered),checkedInToday,checkedInTotal,messages:questions.reduce((n,q)=>n+Number(q.messageCount??0),0),
    ratings:questions.filter(q=>(q.kind??'chat')==='rating').reduce((n,q)=>n+totals(q.ratingCounts).reduce((a,b)=>a+b,0),0)},
  };
 }
 /* A failed build serves the last view for the rest of its window (its generatedAt says how old it is), so an outage
    is not retried by every request; without one it fails, and the next request tries again. Builds are numbered and
    only one started after the build behind the last view replaces it: a slow store finishes them in any order, and an
    older view finishing late would bring back what a newer one no longer shows. */
 let memo=null,last=null,started=0,lastBuild=0;
 function shared(){
  const t=clock();if(memo&&t-memo.at<ttlMs)return memo.promise;
  const n=++started;
  const entry={at:t,promise:build(t).then(view=>{if(n>lastBuild){last=view;lastBuild=n;}return view;},error=>{if(!last)throw error;log('festival live view unavailable:',errorText(error));return last;})};
  memo=entry;entry.promise.catch(()=>{if(memo===entry)memo=null;});
  return entry.promise;
 }
 return {
  // active: the festival's dates in Lima, or an organiser, who previews the window before and after them.
  async read(user){const {festival,...view}=await shared();return {active:festival||user?.permission==='admin',...view};},
  /* After a write that takes something out of the conversations (a hide, a withdrawal, a question hidden, closed or
     edited, an account deleted), so this instance never shows it again; other instances catch up within their 15 s.
     The last view, and any build already under way, may hold what was taken out, so neither is the outage fallback:
     a build failing right after a takedown fails (phones keep the view they drew) until one started since succeeds. */
  clear(){memo=null;last=null;lastBuild=started;},
 };
}
