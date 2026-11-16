import {DEFS,FAMILIES,INDICATORS,LEAD,LEAD_SECOND,TRACKED,TEXTS} from './metrics-catalog.js';
import {FIRST_MONTH,READING_PARTS,limaDay,windowsFor,sumSeries,foldCountries,smallGroups,validPart} from './metrics-domain.js';
import {festivalSummary,festivalHours} from './fiiu-summary.js';
import {courseSummary,COURSE_SUMMARY_KEYS} from './courses-api.js';
import {FINAL_SURVEY,finalSurveyCounts} from './course-final-survey.js';

/* The admin home's figures (spec: docs/superpowers/specs/2026-11-14-admin-front-door-metrics-design.md, "R3. The home").
   GET /api/admin/metrics computes six parts in parallel, each able to fail alone (accounts, members, festival, courses,
   visits, readings), and answers 200 with what it has: an indicator whose part failed carries a state and no figure.
   The answer is language-neutral (keys and numbers; a typed country as {text, n}); the catalogue's texts, lead row and
   tracked rows travel beside it, attached after the memo. */

// The catalogue's constants, built once: the same objects on every answer, never part of the memo or of a reading.
const LEAD_ROW=Object.freeze(LEAD.map(([key,field])=>Object.freeze({key,field,second:LEAD_SECOND[key]??[]})));
const CATALOGUE=Object.freeze({texts:TEXTS,lead:LEAD_ROW,tracked:TRACKED});

const NOT_ACTIVATED_CODES=new Set(['PGRST202','42883','PGRST205','42P01']);
const SIGNAL_PARTS=new Set(['accounts','members','readings','visits']);
const KINDS=Object.keys(TEXTS.es.lists.kinds);
const MEMBERSHIP_PAGES=['fundadores.html','payments.html'];
const DAY_MS=86400000;
const DEADLINE=Symbol('deadline');
const isNum=v=>typeof v==='number'&&Number.isFinite(v);
const offStore=part=>Object.assign(new Error(`metrics ${part} store off`),{status:503});

/* A failed part's state, in the brief's order: not activated; refused (reported once per instance and part); its own
   deadline or a TimeoutError/AbortError; an outage (5xx, 429, upstream set, a store that is off); anything else, reported.
   rest turns an abort into {status: 503, upstream: 'AbortError'}, so the deadline is judged by its own timer firing. */
function classify(error,timedOut){
 const code=String(error?.code??'');
 if(NOT_ACTIVATED_CODES.has(code))return {state:'not_activated'};
 if(code==='42501')return {state:'unavailable',reason:'refused',report:'once'};
 if(timedOut||error===DEADLINE||['TimeoutError','AbortError'].includes(error?.name))return {state:'unavailable',reason:'timeout'};
 const status=Number(error?.status);
 if(status>=500||status===429||error?.upstream)return {state:'unavailable',reason:'error'};
 return {state:'unavailable',reason:'error',report:'always'};
}

/* Runs one part against its deadline. accounts, members, readings and visits hand the signal to rest; festival and
   courses only race the timer (their stores set their own signals). The timer is cleared in finally either way. */
async function runPart(name,fn,deadlineMs){
 const controller=SIGNAL_PARTS.has(name)?new AbortController():null;
 let timer,fired=false;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{fired=true;controller?.abort();reject(DEADLINE);},deadlineMs);});
 try{return {name,state:'ok',value:await Promise.race([(async()=>fn(controller?.signal))(),deadline])};}
 catch(error){return {name,error,...classify(error,fired)};}
 finally{clearTimeout(timer);}
}

const pairs=(rows,i)=>Array.isArray(rows)?rows.map(row=>[row[0],Number(row[i])||0]):null;
const dayCount=(from,to)=>Math.round((Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`))/DAY_MS);
const topItems=(object,max=Infinity)=>Object.entries(object??{}).map(([key,n])=>({key,n:Number(n)||0}))
 .sort((a,b)=>b.n-a.n||(a.key<b.key?-1:a.key>b.key?1:0)).slice(0,max);
const sum=(list,field)=>(list??[]).reduce((total,row)=>total+(Number(row?.[field])||0),0);
const fields=(series,which)=>series?Object.fromEntries(which.map(f=>[f,series[f]])):null;

// What each indicator reads from its part's value: an object of fields, or null when its own source is missing.
function readers({accounts,members,festival,courses,visits,day}){
 const days=members?.days,now=members?.now,active=members?.active;
 const memberSeries=key=>Array.isArray(days?.[key])?sumSeries(pairs(days[key],1),day):null;
 const nowValue=key=>isNum(now?.[key])?{total:now[key]}:null;
 const created=accounts?sumSeries(pairs(accounts.days,1),day):null,confirmed=accounts?sumSeries(pairs(accounts.days,2),day):null;
 const views=visits?sumSeries(pairs(visits.days,1),day):null,arrivals=visits?sumSeries(pairs(visits.days,2),day):null;
 const summary=festival?.summary,activities=Array.isArray(summary?.activities)?summary.activities:null;
 const courseTotal=key=>courses?{total:courses.list.reduce((t,c)=>t+(Number(courses.summaries[c.id]?.[key])||0),0),
  items:courses.list.map(c=>({key:c.id,n:Number(courses.summaries[c.id]?.[key])||0}))}:null;
 const survey=key=>isNum(courses?.survey?.[key])?{total:courses.survey[key]}:null;
 const out={
  'visits.views':()=>fields(views,['d30','d7']),
  'visits.arrivals':()=>fields(arrivals,['d30','d7']),
  'visits.topPages':()=>visits?{items:topItems(visits.pages,10)}:null,
  'visits.sources':()=>visits?{items:topItems(visits.sources).filter(item=>item.n>0)}:null,
  'signups.accounts':()=>created?{total:created.total}:null,
  'signups.confirmed':()=>confirmed?{total:confirmed.total}:null,
  'signups.new':()=>created?{d30:created.d30,d7:created.d7,last:created.last,daysSince:created.last?dayCount(created.last,day):null}:null,
  'signups.entered':()=>fields(memberSeries('entered'),['total','d30','d7']),
  'signups.team':()=>nowValue('admins'),
  'profiles.saved':()=>fields(memberSeries('profileSaves'),['total']),
  'activity.members':()=>isNum(active?.d30?.members)&&isNum(active?.d7?.members)?{d30:active.d30.members,d7:active.d7.members}:null,
  'activity.kinds':()=>KINDS.every(k=>isNum(active?.d30?.[k])&&isNum(active?.d7?.[k]))?{items:KINDS.map(k=>({key:k,n:active.d30[k],d7:active.d7[k]}))}:null,
  'activity.follows':()=>fields(memberSeries('follows'),['total','d30','d7']),
  'activity.interests':()=>fields(memberSeries('interests'),['total','d30','d7']),
  'memberships.founders':()=>fields(memberSeries('founders'),['total','d30','d7']),
  'memberships.acceptances':()=>fields(memberSeries('acceptances'),['total','d30','d7']),
  'memberships.acceptors':()=>nowValue('acceptors'),
  'memberships.unbadged':()=>nowValue('unbadged'),
  'memberships.orgRequests':()=>fields(memberSeries('orgRequests'),['total']),
  'memberships.views':()=>visits?{items:MEMBERSHIP_PAGES.map(key=>({key,n:Number(visits.pages?.[key])||0}))}:null,
  'festival.registrations':()=>isNum(summary?.totalRegistrations)?{total:summary.totalRegistrations,...(isNum(now?.teamRegistrations)?{team:now.teamRegistrations}:{})}:null,
  'festival.blockRegistrations':()=>activities?{total:sum(activities,'registrations')}:null,
  'festival.attendances':()=>activities?{total:sum(activities,'attendance')}:null,
  'festival.attendedPeople':()=>isNum(summary?.attendedPeople)?{total:summary.attendedPeople}:null,
  'festival.qrPeople':()=>isNum(summary?.qrPeople)?{total:summary.qrPeople}:null,
  'festival.hours':()=>activities&&festival.event?{total:festivalHours(summary,festival.event)}:null,
  'festival.labApplications':()=>summary?.lab&&typeof summary.lab==='object'?{total:['pending','accepted','declined'].reduce((t,k)=>t+(Number(summary.lab[k])||0),0)}:null,
  'festival.profileTypes':()=>Array.isArray(summary?.profiles)?{items:smallGroups(summary.profiles.map(p=>({key:p.profile,n:p.count})))}:null,
  'festival.countries':()=>Array.isArray(members?.lists?.countries)?{items:foldCountries(members.lists.countries)}:null,
  'courses.surveyTotal':()=>survey('total'),
  'courses.surveyAnswered':()=>survey('answered'),
  'courses.certificates':()=>survey('certificates'),
  'courses.learners':()=>nowValue('learners'),
  'courses.openers':()=>nowValue('openers'),
 };
 for(const key of ['basic','city','interests','bio','assessed','directory'])out[`profiles.${key}`]=()=>nowValue(key);
 for(const key of COURSE_SUMMARY_KEYS)out[`courses.${key}`]=()=>courseTotal(key);
 return out;
}

// Months from FIRST_MONTH to the current one; a visit month before the first counted day is absent, never 0.
function monthsOf(series,state){
 if(state!=='ok')return {state};
 return series?{...series.months}:{state:'unavailable'};
}

/* One computation of the whole answer (without texts, lead and tracked): what the memo, the export and the POST share.
   deps: {store, visitStore, fiiuStore, fiiuProgramme, courseStore, deadlineMs, onFailure(part, outcome)}. */
export async function computeAnswer(deps,at){
 const {store,visitStore,fiiuStore,fiiuProgramme,courseStore,deadlineMs=6000,onFailure=()=>{}}=deps;
 const day=limaDay(at),windows=windowsFor(day);
 const parts={
  accounts:signal=>{if(!store)throw offStore('accounts');return store.accountDays({signal});},
  members:signal=>{if(!store)throw offStore('members');return store.memberDays(day,{signal});},
  festival:async()=>{
   if(!fiiuStore||!fiiuProgramme)throw offStore('festival');
   return festivalSummary({store:fiiuStore,programme:fiiuProgramme});
  },
  courses:async()=>{
   if(!courseStore)throw offStore('courses');
   const list=(await courseStore.find('courses',{},{limit:100})).map(({id,title})=>({id,title}));
   const [summaries,survey]=await Promise.all([
    Promise.all(list.map(c=>courseSummary(courseStore,c.id))),
    // The status route answers only for the survey's course (server/course-final-survey.js).
    list.some(c=>c.id===FINAL_SURVEY.courseId)?finalSurveyCounts({store:courseStore,courseId:FINAL_SURVEY.courseId}):null,
   ]);
   return {list,summaries:Object.fromEntries(list.map((c,i)=>[c.id,summaries[i]])),survey};
  },
  visits:async signal=>{
   if(!visitStore)throw offStore('visits');
   const value=await visitStore.totals(windows.d30.from,day,{signal});
   if(!validPart('visits',value))throw Object.assign(new Error('metrics visits unavailable'),{status:502});
   return value;
  },
  readings:signal=>{if(!store)throw offStore('readings');return store.readings({signal});},
 };
 const results=await Promise.all(READING_PARTS.map(name=>runPart(name,parts[name],deadlineMs)));
 const byName=Object.fromEntries(results.map(r=>[r.name,r]));
 const states={},unavailable=[],notActivated=[];
 for(const r of results){
  states[r.name]=r.state;
  if(r.state==='not_activated')notActivated.push(r.name);
  else if(r.state!=='ok'){unavailable.push({part:r.name,reason:r.reason});onFailure(r.name,r);}
 }
 const value=name=>states[name]==='ok'?byName[name].value:null;
 const visits=value('visits');
 const visitsSince=visits?(visits.days.find(row=>(Number(row[1])||0)+(Number(row[2])||0)>0)?.[0]??null):null;
 // Visits before their first counted day are not counted, not zero.
 if(visits&&(visitsSince===null||visitsSince>day))states.visits='not_yet_counted';
 const read=readers({accounts:value('accounts'),members:value('members'),festival:value('festival'),courses:value('courses'),visits:states.visits==='ok'?visits:null,day});
 const families=FAMILIES.map(key=>({key,indicators:INDICATORS.filter(ind=>ind.family===key).map(ind=>{
  const base={key:ind.key,...(ind.vocabulary?{vocabulary:ind.vocabulary}:{})};
  if(states[ind.part]!=='ok')return {...base,state:states[ind.part]};
  const got=read[ind.key]();
  return got?{...base,...got}:{...base,state:'unavailable'};
 })}));
 const members=value('members'),accounts=value('accounts');
 const series=(rows,i)=>Array.isArray(rows)?sumSeries(pairs(rows,i),day):null;
 let views={},arrivals={};
 if(states.visits==='ok'){
  const first=visitsSince.slice(0,7),cut=months=>Object.fromEntries(Object.entries(months).filter(([month])=>month>=first));
  views=cut(series(visits.days,1).months);arrivals=cut(series(visits.days,2).months);
 }else if(states.visits!=='not_yet_counted')views=arrivals={state:states.visits};
 const months={from:FIRST_MONTH,series:{
  accounts:monthsOf(accounts&&series(accounts.days,1),states.accounts),
  entered:monthsOf(members&&series(members.days?.entered,1),states.members),
  registrations:monthsOf(members&&series(members.days?.registrations,1),states.members),
  views,arrivals,
 }};
 let readings;
 if(states.readings==='ok'){
  const list=Array.isArray(byName.readings.value)?byName.readings.value:[],latest=new Map();
  for(const r of list)latest.set(String(r.day).slice(0,7),r); // oldest first: the last one of a month wins
  readings={today:list.some(r=>r.day===day),months:[...latest].sort(([a],[b])=>a<b?-1:1).map(([month,r])=>({month,day:r.day,defs:r.defs,figures:r.figures}))};
 }else readings={today:false,months:[],state:states.readings};
 const summary=value('festival')?.summary;
 const pending={
  interests:isNum(members?.now?.interestsNew)?members.now.interestsNew:null,
  orgRequests:isNum(members?.now?.orgRequestsNew)?members.now.orgRequestsNew:null,
  lab:isNum(summary?.lab?.pending)?summary.lab.pending:null,
 };
 const courseNames=Object.fromEntries((value('courses')?.list??[]).map(c=>[c.id,c.title]));
 return {asOf:new Date(at).toISOString(),limaDay:day,defs:DEFS,windows,families,courseNames,months,readings,pending,visitsSince,unavailable,notActivated};
}

// Complete: every part answered (visits not yet counted is an answer). Only a complete answer is kept 5 minutes or saved.
export const answerComplete=answer=>answer.unavailable.length===0&&answer.notActivated.length===0;

/* GET /api/admin/metrics[?fresh=1] → 200 the answer above with texts, lead and tracked | 401 | 403 | 405 | 429.
   rateLimit(req,res,user,'read'|'heavy') answers the 429 itself; report(error, part) gets each refused part (once per
   instance and part) and each unexpected throw. */
export function createMetricsApi({store,visitStore,fiiuStore,fiiuProgramme,courseStore,sameOrigin,send,now=()=>Date.now(),rateLimit=()=>true,
 report=async()=>false,deadlineMs=6000,memoMs=300000,partialMemoMs=30000}){
 const refused=new Set();
 const onFailure=(part,{error,report:when})=>{
  if(!when||(when==='once'&&refused.has(part)))return;
  if(when==='once')refused.add(part);
  const err=error instanceof Error?error:new Error(`metrics ${part} unavailable`);
  try{Promise.resolve(report(err,part)).catch(()=>{});}catch{/* reporting never fails the answer */}
 };
 const deps={store,visitStore,fiiuStore,fiiuProgramme,courseStore,deadlineMs,onFailure};
 // A promise memo (as server/fiiu-programme.js): concurrent requests share one computation; its lifetime is chosen when
 // it settles, and it never serves another Lima day's figures.
 let memo=null;
 function current({fresh=false}={}){
  const t=now(),day=limaDay(t);
  if(!fresh&&memo&&memo.day===day&&t<memo.until)return memo.promise;
  const entry={day,until:Infinity,promise:null};
  entry.promise=computeAnswer(deps,t).then(answer=>{entry.until=t+(answerComplete(answer)?memoMs:partialMemoMs);return answer;},
   error=>{if(memo===entry)memo=null;throw error;});
  memo=entry;
  return entry.promise;
 }
 return async({req,res,url,user})=>{
  const path=url.pathname;
  if(path!=='/api/admin/metrics'&&!path.startsWith('/api/admin/metrics/'))return false;
  if(!user){send(res,401,{error:'sign in required'});return true;}
  if(user.permission!=='admin'){send(res,403,{error:'administrator access required'});return true;}
  if(path!=='/api/admin/metrics'){send(res,404,{error:'not found'});return true;}
  if(!['GET','HEAD'].includes(req.method)){send(res,405,{error:'method not allowed'},{Allow:'GET, HEAD'});return true;}
  const fresh=url.searchParams.get('fresh')==='1';
  if(!rateLimit(req,res,user,'read'))return true;
  if(fresh&&!rateLimit(req,res,user,'heavy'))return true;
  let answer;
  try{answer=await current({fresh});}
  catch(error){onFailure('answer',{error,report:'always'});send(res,503,{error:'metrics unavailable'});return true;}
  send(res,200,{...answer,...CATALOGUE});
  return true;
 };
}
