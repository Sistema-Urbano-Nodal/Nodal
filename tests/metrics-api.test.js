import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDatabase,createUser} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createApp} from '../server/server.js';
import {createStore} from '../server/store.js';
import {createFiiuStore} from '../server/fiiu-repository.js';
import {createCourseStore} from '../server/courses-repository.js';
import {createNodeRequestStore} from '../server/node-requests-repository.js';
import {createTalkStore} from '../server/fiiu-talk-repository.js';
import {createMetricsStore} from '../server/metrics-repository.js';
import {computeAnswer} from '../server/metrics-api.js';
import {createVisitStore} from '../server/visits-repository.js';
import {FINAL_SURVEY} from '../server/course-final-survey.js';
import {DEFS,FAMILIES,INDICATORS,LEAD,LEAD_SECOND,TRACKED,TEXTS,MONTH_SERIES,ROUTE,SERIES_INDICATOR,PAIRS} from '../server/metrics-catalog.js';
import {windowsFor,figuresOf} from '../server/metrics-domain.js';
import {loadSqlite,freezeUserClock,expectedMemberDays,sqliteProfile} from './fixtures/metrics-fixture.js';

const START='2026-11-14T13:36:00.000Z';
const MINUTE=60000;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
/* Two requests inside one computation, without a timer: after arm(), memberDays waits until the API has let two
   requests in (it asks rateLimit for 'read' once per request, before the computation), then answers. Unarmed, it answers at once. */
function together(){
 const state={calls:0,seen:0,gate:null,wait:null};
 return {state,arm(){state.seen=0;state.gate=deferred();state.wait=state.gate.promise;},
  options:{rateLimit:(req,res,user,kind)=>{if(kind==='read'&&++state.seen===2)state.gate?.resolve();return true;}},
  // Only the first computation after arm() waits; a later one (fresh=1, another day) answers at once.
  store:({metrics})=>wrap(metrics,{memberDays:async(today,options,real)=>{state.calls++;const wait=state.wait;state.wait=null;await wait;return real(today,options);}})};
}
// A store double: the real one with some methods replaced (each replacement gets the real method as its last argument).
const wrap=(real,over)=>{
 const out=Object.create(null);
 for(const key of Object.keys(real))out[key]=typeof real[key]==='function'?real[key].bind(real):real[key];
 for(const [key,fn] of Object.entries(over))out[key]=(...args)=>fn(...args,real[key]?.bind(real));
 return out;
};
const reject=fields=>async()=>{throw Object.assign(new Error('stub failure'),fields);};

/* The whole server (createApp) on SQLite with users `member` and `admin` and the clock injected. Each store option is a
   function of the stores this harness builds on the app's database ({db, fiiu, course, nodeRequest, talk, metrics,
   visit}), so a test can hand the app a double of any of them; null switches one off. */
async function setup(t,{metricsStore,fiiuStore,courseStore,visitStore,metricsOptions={},errorReport,fixture=false,start=START,report}={}){
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const users={},cookies={};
 for(const name of ['member','admin']){
  users[name]=createUser(db,{fullName:name,email:`${name}@example.test`,passwordHash:'unused',role:name});
  cookies[name]=createSession(db,users[name].id).cookie.split(';')[0];
  // Outside both windows, so the seeded figures are the fixture's own.
  db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run('2026-07-01T15:00:00.000Z',users[name].id);
 }
 // That UPDATE fired users_updated_at, which stamps the wall clock: this test database drops the trigger and gives both
 // accounts a fixed updated_at, so neither is ever "profile activity", whatever day the tests run.
 freezeUserClock(db);
 db.prepare('UPDATE users SET updated_at = ?').run('2026-07-01T15:00:00.000Z');
 const own={db,fiiu:createFiiuStore({db}),course:createCourseStore({db}),nodeRequest:createNodeRequestStore({db})};
 own.talk=createTalkStore({db});own.visit=createVisitStore({db});own.metrics=createMetricsStore({db});
 const pick=(option,fallback)=>option===undefined?fallback:option===null?null:option(own);
 const reports=[];
 const clock={at:Date.parse(start)};
 const options={db,now:()=>clock.at,fiiuStore:pick(fiiuStore,own.fiiu),courseStore:pick(courseStore,own.course),nodeRequestStore:own.nodeRequest,
  visitStore:pick(visitStore,own.visit),metricsStore:pick(metricsStore,own.metrics),
  metricsOptions:{...(report===false?{}:{report:async(error,part)=>{reports.push({message:error.message,part});return true;}}),...metricsOptions}};
 if(options.fiiuStore)options.talkStore=own.talk;else options.talkStore=null;
 if(errorReport)options.errorReport=errorReport;
 if(fixture)own.ids=await loadSqlite({db,fiiuStore:own.fiiu,courseStore:own.course,nodeRequestStore:own.nodeRequest,talkStore:own.talk});
 const server=createApp(options);
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 // raw sends a body as given (with headers overriding the JSON content type); body is sent as JSON.
 const call=(path,{actor='admin',method='GET',body,raw,headers={},origin=base}={})=>fetch(base+path,{method,redirect:'manual',
  headers:{...(cookies[actor]?{Cookie:cookies[actor]}:{}),Origin:origin,'Content-Type':'application/json',...headers},
  body:raw!==undefined?raw:body===undefined?undefined:JSON.stringify(body)});
 const get=async(path='/api/admin/metrics',options)=>{const response=await call(path,options);return {status:response.status,headers:response.headers,body:await response.json()};};
 return {db,own,clock,users,base,call,get,reports};
}
const indicator=(body,key)=>body.families.flatMap(f=>f.indicators).find(i=>i.key===key);
const byPart=part=>INDICATORS.filter(i=>i.part===part).map(i=>i.key);

test('is for administrators',async t=>{
 const {call,get}=await setup(t);
 assert.equal((await call('/api/admin/metrics',{actor:'guest'})).status,401);
 assert.deepEqual(await get('/api/admin/metrics',{actor:'member'}).then(r=>[r.status,r.body]),[403,{error:'administrator access required'}]);
 const post=await call('/api/admin/metrics',{method:'POST',body:{}});
 assert.equal(post.status,405);
 assert.equal((await call('/api/admin/metricsx')).status,404);
});

test('answers the whole shape in three languages',async t=>{
 const {get}=await setup(t);
 const {status,headers,body}=await get();
 assert.equal(status,200);
 assert.equal(body.limaDay,'2026-11-14');
 assert.equal(body.asOf,START);
 assert.equal(body.defs,DEFS);assert.equal(body.defs,1);
 assert.deepEqual(body.windows,windowsFor('2026-11-14'));
 assert.deepEqual(body.families.map(f=>f.key),FAMILIES);
 const keys=body.families.flatMap(f=>f.indicators.map(i=>i.key));
 assert.deepEqual([...keys].sort(),INDICATORS.map(i=>i.key).sort());
 assert.equal(new Set(keys).size,keys.length);
 assert.deepEqual(Object.keys(body.texts),['es','en','pt']);
 assert.deepEqual(body.unavailable,[]);assert.deepEqual(body.notActivated,[]);
 assert.equal(headers.get('cache-control'),'no-store');
 assert.deepEqual(body.lead,LEAD.map(([key,field])=>({key,field,second:LEAD_SECOND[key]??[]})));
 assert.deepEqual(body.lead.map(l=>l.key),['visits.arrivals','signups.accounts','profiles.basic','activity.members','memberships.founders']);
 assert.deepEqual(body.lead[1],{key:'signups.accounts',field:'total',second:[['signups.new','d7'],['signups.confirmed','total']]});
 assert.deepEqual(body.tracked,TRACKED);
 assert.equal(body.tracked.length,22);
 // The lists the home is laid out by, as keys: the members' path, the indicator of each month series, the nested pairs.
 assert.deepEqual(body.route,ROUTE);
 assert.deepEqual(body.seriesIndicator,SERIES_INDICATOR);
 assert.deepEqual(body.pairs,PAIRS);
 for(const lang of ['es','en','pt'])assert.match(body.texts[lang].routeApart,/\S/,lang);
 // The page looks item labels up by vocabulary: one list indicator of each.
 for(const [key,vocabulary] of [['visits.topPages','pages'],['visits.sources','sources'],['activity.kinds','kinds'],['festival.profileTypes','profileTypes']]){
  assert.equal(indicator(body,key).vocabulary,vocabulary,key);
 }
 assert.deepEqual(Object.keys(body.months.series),['accounts','entered','registrations','views','arrivals']);
 assert.equal(body.months.from,'2026-07');
 assert.deepEqual(body.readings,{today:false,months:[]});
 assert.deepEqual(Object.keys(body.pending),['interests','orgRequests','lab']);
});

test('the memoised data holds no display word',async t=>{
 const {get}=await setup(t,{fixture:true});
 const {body}=await get();
 delete body.texts;
 assert.doesNotMatch(JSON.stringify(body),/Perfil|Cuentas|otros|Other|Outros|Visitas/);
 for(const item of indicator(body,'festival.countries').items){
  assert.ok(Object.keys(item).sort().join()===['n','text'].join()||Object.keys(item).sort().join()===['key','n'].join(),JSON.stringify(item));
  if('text' in item)assert.equal(typeof item.text,'string');
 }
 assert.ok(indicator(body,'festival.countries').items.some(item=>'text' in item),'a typed country travels as {text, n}');
});

// The catalogue's texts and lists are attached by the GET after the memo: the computed answer (what the memo, the export
// and the POST share) holds none of them.
test('the catalogue travels beside the computed answer, never inside it',async()=>{
 const answer=await computeAnswer({deadlineMs:1000},Date.parse(START));
 assert.deepEqual(answer.unavailable.map(u=>u.part),['accounts','members','festival','courses','visits','readings']);
 for(const key of ['texts','lead','tracked','route','seriesIndicator','pairs'])assert.ok(!(key in answer),key);
});

/* Every indicator on the fixture's rows (tests/fixtures/metrics-fixture.js), worked by hand: the eight fixture accounts
   plus the harness's two (one admin), made in July. A figure read from the wrong place shows here. */
const COURSE=FINAL_SURVEY.courseId,perCourse=n=>({total:n,items:[{key:COURSE,n}]});
const SEEDED={
 'visits.views':{d30:2,d7:2},
 'visits.arrivals':{d30:2,d7:2},
 'visits.topPages':{items:[{key:'index.html',n:2}]},
 'visits.sources':{items:[{key:'search',n:2}]},
 'signups.accounts':{total:10},
 'signups.confirmed':{total:10}, // the local copy has no confirmation: equal to accounts
 'signups.new':{d30:4,d7:2,last:'2026-11-14',daysSince:0}, // m3 m4 m5 m6; m5 m6
 'signups.entered':{total:10,d30:4,d7:2},
 'signups.team':{total:3}, // a1, a2 and the harness's admin
 'profiles.basic':{total:4}, // a1 m1 m4 m5
 'profiles.city':{total:5}, // a1 m1 m3 m4 m5
 'profiles.interests':{total:5}, // a1 m1 m2 m4 m5
 'profiles.bio':{total:3}, // a1 m1 m5
 'profiles.assessed':{total:3}, // a1 m1 m4
 'profiles.directory':{total:4}, // a1 m1 m2 m5; m3 consents but is disabled
 'profiles.saved':{total:0}, // production only
 'activity.members':{d30:6,d7:5}, // m2 did nothing in the 7 days
 'activity.kinds':{items:[{key:'profile',n:3,d7:2},{key:'network',n:5,d7:3},{key:'opportunities',n:3,d7:1},{key:'festival',n:6,d7:4},{key:'courses',n:6,d7:2},{key:'membership',n:1,d7:1}]},
 'activity.follows':{total:5,d30:3,d7:2}, // one of the five is dated after the day
 'activity.interests':{total:5,d30:3,d7:2}, // six rows, one withdrawn
 'memberships.founders':{total:2,d30:2,d7:1},
 'memberships.acceptances':{total:4,d30:2,d7:1},
 'memberships.acceptors':{total:3}, // m1, m5 and the acceptance whose account is gone
 'memberships.unbadged':{total:2}, // m5 and the one whose account is gone
 'memberships.orgRequests':{total:3},
 'memberships.views':{items:[{key:'fundadores.html',n:0},{key:'payments.html',n:0}]},
 'festival.registrations':{total:8,team:2},
 'festival.blockRegistrations':{total:0}, // no registration ticks a block
 'festival.attendances':{total:5},
 'festival.attendedPeople':{total:4}, // m3 m4 m5 a1
 'festival.qrPeople':{total:3}, // m4 m5 a1; m3 was checked in by staff
 'festival.hours':{total:20}, // five attendances of four-hour mornings
 'festival.labApplications':{total:2}, // one pending, one accepted
 'festival.profileTypes':{items:[{key:'student',n:3},{key:'_other',n:5}]}, // organization 2, academic 1, professional 1, blank 1
 'festival.countries':{items:[{text:'Perú',n:5},{key:'_other',n:3}]}, // Colombia 1, Lima 1, blank 1
 'courses.enrolled':perCourse(5),
 'courses.intakeCompleted':perCourse(0),
 'courses.moduleOpens':perCourse(3),
 'courses.contentOpens':perCourse(1),
 'courses.recordingOpens':perCourse(1),
 'courses.assignments':perCourse(0),
 'courses.comments':perCourse(3), // four comments, one deleted
 'courses.surveyTotal':{total:3}, // m1 m2 m3: m4 joined in November
 'courses.surveyAnswered':{total:1}, // m3
 'courses.certificates':{total:0},
 'courses.learners':{total:4},
 'courses.openers':{total:3},
};

test('counts on seeded rows',async t=>{
 const {get,own}=await setup(t,{fixture:true});
 for(const day of ['2026-11-10','2026-11-13'])await own.visit.count({day,page:'index.html',arrival:true,source:'search'});
 const {body}=await get();
 assert.deepEqual(body.unavailable,[]);assert.deepEqual(body.notActivated,[]);
 assert.deepEqual(Object.keys(SEEDED),INDICATORS.map(i=>i.key),'one expected row per indicator');
 const got=Object.fromEntries(body.families.flatMap(f=>f.indicators).map(({key,vocabulary,...figures})=>{void vocabulary;return [key,figures];}));
 assert.deepEqual(got,SEEDED);
 // The member figures are the stores' own (the same rows answer PostgreSQL in tests/metrics-postgres.test.js).
 const now=expectedMemberDays.now;
 for(const [key,field] of [['signups.team','admins'],['profiles.basic','basic'],['profiles.city','city'],['profiles.interests','interests'],['profiles.bio','bio'],
  ['profiles.assessed','assessed'],['profiles.directory','directory'],['memberships.acceptors','acceptors'],['courses.learners','learners'],['courses.openers','openers']]){
  assert.equal(SEEDED[key].total,now[field]+(field==='admins'?1:0),key);
 }
 assert.equal(body.pending.lab,1,'pending only, not every application');
 // Eight fixture accounts and the harness's two.
 assert.equal(indicator(body,'signups.accounts').total,10);
 assert.equal(indicator(body,'signups.entered').d30,4);
 const kinds=indicator(body,'activity.kinds').items;
 assert.equal(kinds.length,6);
 const want=kind=>({key:kind,n:kind==='profile'?sqliteProfile.d30.profile:expectedMemberDays.active.d30[kind],d7:kind==='profile'?sqliteProfile.d7.profile:expectedMemberDays.active.d7[kind]});
 assert.deepEqual(kinds,['profile','network','opportunities','festival','courses','membership'].map(want));
 assert.equal(indicator(body,'memberships.unbadged').total,expectedMemberDays.now.unbadged);
 assert.deepEqual(indicator(body,'festival.countries').items,[{text:'Perú',n:5},{key:'_other',n:3}]);
 const registrations=Object.values(body.months.series.registrations).reduce((a,b)=>a+b,0);
 assert.equal(registrations,indicator(body,'festival.registrations').total);
 assert.equal(indicator(body,'festival.registrations').total,8);
 assert.equal(indicator(body,'festival.registrations').team,2);
 const staffEnrolments=1; // a1
 assert.equal(indicator(body,'courses.enrolled').total-staffEnrolments,indicator(body,'courses.learners').total);
 assert.deepEqual(body.courseNames,{[FINAL_SURVEY.courseId]:'Curso de movilidad urbana'});
 assert.deepEqual(indicator(body,'courses.enrolled').items,[{key:FINAL_SURVEY.courseId,n:5}]);
 assert.equal(body.visitsSince,'2026-11-10');
 assert.deepEqual(indicator(body,'visits.arrivals'),{key:'visits.arrivals',d30:2,d7:2});
 assert.deepEqual(body.pending,{interests:expectedMemberDays.now.interestsNew,orgRequests:expectedMemberDays.now.orgRequestsNew,lab:1});
 assert.deepEqual(body.months.series,{accounts:{'2026-07':3,'2026-08':0,'2026-09':2,'2026-10':2,'2026-11':3},entered:{'2026-07':3,'2026-08':0,'2026-09':2,'2026-10':2,'2026-11':3},
  registrations:{'2026-07':0,'2026-08':0,'2026-09':4,'2026-10':3,'2026-11':1},views:{'2026-11':2},arrivals:{'2026-11':2}});
});

/* No reader takes another's figure. The seeded rows above repeat small counts (two 4s, three 3s...), so there a reader
   pointed at a neighbour's source can still pass. Here computeAnswer is fed stub stores in which every source field
   carries its own value, each indicator must show the value planted in its own source (the table in
   .superpowers/sdd/2026-11-14-admin-r3-metrics-home/constraints.md, "Indicator keys"), and the test itself proves that
   no two expected numbers are equal: a later edit cannot bring a coincidence back. */
test('every indicator reads its own source: no two planted figures are equal',async()=>{
 const AT=Date.parse(START); // Lima day 2026-11-14: the 30 days start on 16 Oct, the 7 days on 8 Nov
 // One per-day series from one number: before both windows, inside the 30 days only, inside the 7 days.
 const OLD='2026-08-03',MID='2026-10-20',RECENT='2026-11-10';
 const rows=(...ns)=>[OLD,MID,RECENT].map((day,i)=>[day,...ns.map(n=>n*[10000,100,1][i])]);
 const sums=n=>({total:n*10101,d30:n*101,d7:n});
 // Field values: the primes from 101 up, each handed out once.
 const isPrime=n=>{for(let d=2;d*d<=n;d++)if(n%d===0)return false;return true;};
 let last=100;
 const plant=()=>{do last++;while(!isPrime(last));return last;};
 const planted=names=>Object.fromEntries(names.map(name=>[name,plant()]));
 const KIND_NAMES=['profile','network','opportunities','festival','courses','membership'];
 const S={created:11,confirmed:13,views:17,arrivals:19,entered:23,profileSaves:29,follows:31,interests:37,founders:41,acceptances:43,orgRequests:47,registrations:53};
 const now=planted(['admins','basic','city','interests','bio','assessed','directory','acceptors','unbadged','learners','openers','teamRegistrations','interestsNew','orgRequestsNew']);
 const active={d30:planted(['members',...KIND_NAMES]),d7:planted(['members',...KIND_NAMES])};
 const countries=[['Perú',plant()],['Colombia',plant()]];
 const members={v:1,days:Object.fromEntries(['entered','profileSaves','follows','interests','founders','acceptances','orgRequests','registrations'].map(k=>[k,rows(S[k])])),now,active,lists:{countries}};
 // Twelve pages: the ten most seen are listed, and the two membership pages are not among them.
 const pages={...planted(['index.html','fiiu.html','courses.html','network.html','profile.html','login.html','about.html','map.html','privacy.html','terms.html']),'fundadores.html':61,'payments.html':59};
 const sources={...planted(['search','direct','social']),qr:0};
 const visits={v:1,days:[MID,RECENT].map((day,i)=>[day,S.views*[100,1][i],S.arrivals*[100,1][i]]),pages,sources};
 // Three blocks: two take a check-in (90 and 240 minutes), the workshop does not, so its attendance earns no hours.
 const event={activities:[{id:'talk',registration:'general',minutes:90},{id:'lab',registration:'application',minutes:240},{id:'workshop',registration:'external',minutes:60}]};
 const summary={...planted(['totalRegistrations','attendedPeople','qrPeople']),
  activities:[{activityId:'talk',registrations:plant(),attendance:120},{activityId:'lab',registrations:plant(),attendance:150},{activityId:'workshop',registrations:plant(),attendance:170}],
  lab:planted(['pending','accepted','declined']),profiles:[{profile:'student',count:plant()},{profile:'academic',count:plant()}]};
 const OTHER='00000000-0000-4000-8000-000000000002';
 const SUMMARY_KEYS=['enrolled','intakeCompleted','moduleOpens','contentOpens','recordingOpens','assignments','comments'];
 const counts={[COURSE]:planted(SUMMARY_KEYS),[OTHER]:planted(SUMMARY_KEYS)};
 // The survey course's roster: 13 September participants, 7 answered, 3 only started, 5 certificates ready.
 const roster=Array.from({length:13},(_,i)=>({id:`e${i}`,courseId:COURSE,userId:`u${i}`,createdAt:`2026-09-${String(i+1).padStart(2,'0')}T15:00:00.000Z`}));
 const tables={
  courses:()=>[{id:COURSE,title:'Survey course'},{id:OTHER,title:'Other course'}],
  enrollments:f=>f.courseId===COURSE?roster:[],
  surveys:f=>f.courseId===COURSE?roster.slice(0,10).map((e,i)=>({id:`s${i}`,userId:e.userId,createdAt:e.createdAt,submittedAt:i<7?'2026-10-20T15:00:00.000Z':null})):[],
  certificates:f=>f.courseId===COURSE&&f.status==='ready'?roster.slice(0,5).map((e,i)=>({id:`c${i}`,userId:e.userId,createdAt:e.createdAt})):[],
 };
 const countKey={enrollments:()=>'enrolled',intakes:()=>'intakeCompleted',events:f=>({module_open:'moduleOpens',content_open:'contentOpens',recording_open:'recordingOpens'})[f.kind],
  posts:f=>({assignment:'assignments',comment:'comments'})[f.kind]};
 const failures=[];
 const answer=await computeAnswer({
  store:{accountDays:async()=>({v:1,days:rows(S.created,S.confirmed)}),memberDays:async()=>members,readings:async()=>[]},
  visitStore:{totals:async()=>visits},
  fiiuStore:{summary:async()=>summary},fiiuProgramme:{event:async()=>event},
  // The counts are planted apart from the roster on purpose: what a summary shows and what the survey shows are different sources.
  courseStore:{find:async(name,filters)=>tables[name](filters),count:async(name,filters)=>counts[filters.courseId][countKey[name](filters)],getMembers:async ids=>ids.map(id=>({id,staff:false}))},
  onFailure:(part,outcome)=>failures.push([part,String(outcome.error)]),
 },AT);
 assert.deepEqual(failures,[]);assert.deepEqual(answer.unavailable,[]);assert.deepEqual(answer.notActivated,[]);

 const total=n=>({total:n}),desc=items=>[...items].sort((a,b)=>b.n-a.n);
 const perCourses=key=>({total:counts[COURSE][key]+counts[OTHER][key],items:[{key:COURSE,n:counts[COURSE][key]},{key:OTHER,n:counts[OTHER][key]}]});
 const [talk,lab,workshop]=summary.activities;
 const window=n=>({d30:n*101,d7:n});
 const PLANTED={
  'visits.views':window(S.views),
  'visits.arrivals':window(S.arrivals),
  'visits.topPages':{items:desc(Object.entries(pages).filter(([page])=>!['fundadores.html','payments.html'].includes(page)).map(([key,n])=>({key,n})))},
  'visits.sources':{items:desc(['search','direct','social'].map(key=>({key,n:sources[key]})))},
  'signups.accounts':total(sums(S.created).total),
  'signups.confirmed':total(sums(S.confirmed).total),
  'signups.new':{...window(S.created),last:RECENT,daysSince:4},
  'signups.entered':sums(S.entered),
  'signups.team':total(now.admins),
  'profiles.basic':total(now.basic),
  'profiles.city':total(now.city),
  'profiles.interests':total(now.interests),
  'profiles.bio':total(now.bio),
  'profiles.assessed':total(now.assessed),
  'profiles.directory':total(now.directory),
  'profiles.saved':total(sums(S.profileSaves).total),
  'activity.members':{d30:active.d30.members,d7:active.d7.members},
  'activity.kinds':{items:KIND_NAMES.map(key=>({key,n:active.d30[key],d7:active.d7[key]}))},
  'activity.follows':sums(S.follows),
  'activity.interests':sums(S.interests),
  'memberships.founders':sums(S.founders),
  'memberships.acceptances':sums(S.acceptances),
  'memberships.acceptors':total(now.acceptors),
  'memberships.unbadged':total(now.unbadged),
  'memberships.orgRequests':total(sums(S.orgRequests).total),
  'memberships.views':{items:[{key:'fundadores.html',n:61},{key:'payments.html',n:59}]},
  'festival.registrations':{total:summary.totalRegistrations,team:now.teamRegistrations},
  'festival.blockRegistrations':total(talk.registrations+lab.registrations+workshop.registrations),
  'festival.attendances':total(440), // 120 + 150 + 170
  'festival.attendedPeople':total(summary.attendedPeople),
  'festival.qrPeople':total(summary.qrPeople),
  'festival.hours':total(780), // 120 x 90 min + 150 x 240 min = 46 800 min
  'festival.labApplications':total(summary.lab.pending+summary.lab.accepted+summary.lab.declined),
  'festival.profileTypes':{items:desc(summary.profiles.map(p=>({key:p.profile,n:p.count})))},
  'festival.countries':{items:desc(countries.map(([text,n])=>({text,n})))},
  ...Object.fromEntries(SUMMARY_KEYS.map(key=>[`courses.${key}`,perCourses(key)])),
  'courses.surveyTotal':total(13),
  'courses.surveyAnswered':total(7),
  'courses.certificates':total(5),
  'courses.learners':total(now.learners),
  'courses.openers':total(now.openers),
 };
 assert.deepEqual(Object.keys(PLANTED),INDICATORS.map(i=>i.key),'one planted row per indicator');
 // Each figure the catalogue promises is planted, so none is left out of the comparison below.
 for(const ind of INDICATORS)for(const field of ind.fields)assert.ok(field in PLANTED[ind.key],`${ind.key} ${field}`);
 const got=Object.fromEntries(answer.families.flatMap(f=>f.indicators).map(({key,vocabulary,...figures})=>{void vocabulary;return [key,figures];}));
 for(const key of Object.keys(PLANTED))assert.deepEqual(got[key],PLANTED[key],key);
 assert.deepEqual(answer.pending,{interests:now.interestsNew,orgRequests:now.orgRequestsNew,lab:summary.lab.pending});

 /* Pairwise distinct: every number an indicator shows (totals, windows, the team's share, days since, list rows) and
    every planted number no indicator shows whole (the pending counts, the registrations series, each lab state, each
    block's registrations and attendance, the survey's "started"). Two equal ones would let a swapped reader pass. */
 const seen=new Map();
 const claim=(value,where)=>{
  assert.equal(Number.isInteger(value),true,`${where} is a whole number`);
  assert.equal(seen.has(value),false,`${where} and ${seen.get(value)} are both ${value}`);
  seen.set(value,where);
 };
 const walk=(value,where)=>{
  if(typeof value==='number')claim(value,where);
  else if(Array.isArray(value))value.forEach((item,i)=>walk(item,`${where}[${item?.key??item?.text??i}]`));
  else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value))if(k!=='key'&&k!=='text'&&k!=='last')walk(v,`${where}.${k}`);
 };
 walk(PLANTED,'shown');
 walk({pendingInterests:now.interestsNew,pendingOrgRequests:now.orgRequestsNew,registrationsSeries:sums(S.registrations),lab:summary.lab,
  blocks:summary.activities.map(a=>({key:a.activityId,registrations:a.registrations,attendance:a.attendance})),surveyStarted:3},'planted');
 assert.ok(seen.size>=100,`${seen.size} distinct figures`);
});

test('agrees with the tools',async t=>{
 const {get}=await setup(t,{fixture:true});
 const {body}=await get();
 const panel=(await get('/api/admin/fiiu/summary')).body.summary;
 assert.equal(indicator(body,'festival.registrations').total,panel.totalRegistrations);
 assert.equal(indicator(body,'festival.attendedPeople').total,panel.attendedPeople);
 assert.equal(indicator(body,'festival.attendances').total,panel.activities.reduce((n,a)=>n+a.attendance,0));
 const survey=await get(`/api/admin/courses/${FINAL_SURVEY.courseId}/final-survey`);
 assert.equal(survey.status,200);
 assert.equal(indicator(body,'courses.surveyTotal').total,survey.body.total);
 assert.equal(indicator(body,'courses.surveyAnswered').total,survey.body.answered);
 assert.equal(indicator(body,'courses.certificates').total,survey.body.certificates);
});

test('memoises for five minutes and shares one computation',async t=>{
 const pair=together(),{state}=pair;
 const {get,clock}=await setup(t,{metricsStore:pair.store,metricsOptions:pair.options});
 assert.equal((await get()).status,200);assert.equal(state.calls,1);
 clock.at+=10000;
 assert.equal((await get()).status,200);assert.equal(state.calls,1,'10 seconds later: the memo');
 clock.at=Date.parse(START)+5*MINUTE+1;
 await get();assert.equal(state.calls,2,'5 minutes and 1 ms later: computed again');
 await Promise.all([get(),get()]);assert.equal(state.calls,2,'two at once inside the memo');
 clock.at+=5*MINUTE+1;
 pair.arm(); // the computation ends only once both requests are in
 const both=await Promise.all([get(),get()]);
 assert.equal(state.calls,3,'two at once share one computation');
 assert.deepEqual(both[0].body,both[1].body);
 await get('/api/admin/metrics?fresh=1');assert.equal(state.calls,4,'fresh=1 skips the memo');
});

test('limits',async t=>{
 const {call}=await setup(t);
 for(let i=0;i<60;i++)assert.equal((await call('/api/admin/metrics')).status,200,`GET ${i+1}`);
 const refused=await call('/api/admin/metrics');
 assert.equal(refused.status,429);assert.ok(Number(refused.headers.get('retry-after'))>0);
 const exports=await setup(t);
 for(let i=0;i<60;i++)assert.equal((await exports.call('/api/admin/metrics/export?table=months&lang=es')).status,200,`export ${i+1}`);
 const late=await exports.call('/api/admin/metrics/export?table=months&lang=es');
 assert.equal(late.status,429);assert.ok(Number(late.headers.get('retry-after'))>0);
 assert.equal(late.headers.get('content-disposition'),null);
 const other=await setup(t);
 for(let i=0;i<6;i++)assert.equal((await other.call('/api/admin/metrics?fresh=1')).status,200,`fresh ${i+1}`);
 assert.equal((await other.call('/api/admin/metrics?fresh=1')).status,429);
 assert.equal((await other.call('/api/admin/metrics')).status,200);
});

test('each state: members not activated',async t=>{
 let code;
 const {get,clock}=await setup(t,{metricsStore:({metrics})=>wrap(metrics,{memberDays:async()=>{throw Object.assign(new Error('missing'),{code});}})});
 for(const each of ['PGRST202','42883','PGRST205','42P01']){
  code=each;clock.at+=MINUTE;
  const {status,body}=await get();
  assert.equal(status,200);
  assert.deepEqual(body.notActivated,['members'],each);assert.deepEqual(body.unavailable,[]);
  for(const key of byPart('members')){const ind=indicator(body,key);assert.equal(ind.state,'not_activated',key);assert.equal('total' in ind,false);}
  assert.equal(body.pending.interests,null);assert.equal(body.pending.orgRequests,null);
  assert.equal(typeof indicator(body,'signups.accounts').total,'number','the other blocks stay filled');
  assert.equal(typeof indicator(body,'festival.registrations').total,'number');
  assert.deepEqual(body.months.series.entered,{state:'not_activated'});
 }
});

test('each state: accounts unavailable, outage and refused',async t=>{
 let fields;
 const {get,clock,reports}=await setup(t,{metricsStore:({metrics})=>wrap(metrics,{accountDays:async()=>{throw Object.assign(new Error('stub failure'),fields);}})});
 for(const each of [{status:503},{status:500},{status:429},{status:503,upstream:'TimeoutError'}]){
  fields=each;clock.at+=MINUTE;
  const {status,body}=await get();
  assert.equal(status,200);
  assert.deepEqual(body.unavailable,[{part:'accounts',reason:'error'}],JSON.stringify(each));
  assert.deepEqual(body.months.series.accounts,{state:'unavailable'});
  assert.equal(indicator(body,'signups.accounts').state,'unavailable');
  assert.equal(typeof indicator(body,'profiles.city').total,'number');
 }
 assert.deepEqual(reports,[],'an outage is not reported');
 fields={code:'42501',status:403};
 for(let i=0;i<3;i++){
  const {body}=await get('/api/admin/metrics?fresh=1');
  assert.deepEqual(body.unavailable,[{part:'accounts',reason:'refused'}]);
 }
 assert.equal(reports.length,1,'refused: one report per instance and part');
 assert.equal(reports[0].part,'accounts');
});

test('each state: no festival store',async t=>{
 const {get}=await setup(t,{fiiuStore:null});
 const {status,body}=await get();
 assert.equal(status,200);
 assert.deepEqual(body.unavailable,[{part:'festival',reason:'error'}]);
 assert.equal(indicator(body,'festival.registrations').state,'unavailable');
 assert.equal(body.pending.lab,null);
 assert.equal(typeof indicator(body,'festival.countries').items,'object','countries come from members');
});

test('each state: the courses part misses its deadline',async t=>{
 const {get,own}=await setup(t,{courseStore:({course})=>wrap(course,{count:()=>new Promise(()=>{})}),metricsOptions:{deadlineMs:50}});
 await own.course.insert('courses',{id:FINAL_SURVEY.courseId,title:'Curso de movilidad urbana',status:'published',createdAt:START,updatedAt:START});
 const timers=()=>process.getActiveResourcesInfo().filter(kind=>kind==='Timeout').length;
 const before=timers(),started=performance.now();
 const {status,body}=await get();
 assert.equal(status,200);
 assert.ok(performance.now()-started<1000);
 assert.deepEqual(body.unavailable,[{part:'courses',reason:'timeout'}]);
 assert.equal(indicator(body,'courses.enrolled').state,'unavailable');
 assert.equal(timers(),before,'every part timer is cleared');
});

test('each state: a TimeoutError from the course store',async t=>{
 const {get}=await setup(t,{courseStore:({course})=>wrap(course,{find:async()=>{throw new DOMException('slow','TimeoutError');}})});
 const {body}=await get();
 assert.deepEqual(body.unavailable,[{part:'courses',reason:'timeout'}]);
});

test('each state: an unexpected throw',async t=>{
 const {call,reports}=await setup(t,{metricsStore:({metrics})=>wrap(metrics,{memberDays:()=>{throw new Error('boom');}})});
 const response=await call('/api/admin/metrics'),text=await response.text();
 assert.equal(response.status,200);
 assert.deepEqual(JSON.parse(text).unavailable,[{part:'members',reason:'error'}]);
 assert.deepEqual(reports,[{message:'boom',part:'members'}]);
 assert.doesNotMatch(text,/boom/);
});

test('each state: a part that answers rows of the wrong shape fails alone',async t=>{
 for(const [part,over,filled] of [
  ['accounts',{accountDays:async()=>({v:1,days:[['2026-11-14','7',7]]})},'profiles.city'],
  ['accounts',{accountDays:async()=>({v:1,days:[['2026-11-14',Number.NaN,1]]})},'profiles.city'],
  ['accounts',{accountDays:async()=>({v:1,days:[['14/11/2026',1,1]]})},'profiles.city'],
  ['members',{memberDays:async(today,options,real)=>{const value=await real(today,options);value.days.entered=[['2026-11-14',null]];return value;}},'signups.accounts'],
 ]){
  const {get,call,own,reports}=await setup(t,{metricsStore:({metrics})=>wrap(metrics,over)});
  const {status,body}=await get();
  assert.equal(status,200,part);
  assert.deepEqual(body.unavailable,[{part,reason:'error'}]);
  for(const key of byPart(part)){const ind=indicator(body,key);assert.equal(ind.state,'unavailable',key);assert.equal('total' in ind||'d30' in ind,false,key);}
  assert.equal(typeof indicator(body,filled).total,'number','the other blocks stay filled');
  assert.deepEqual(body.months.series[part==='accounts'?'accounts':'entered'],{state:'unavailable'});
  assert.doesNotMatch(JSON.stringify(body.families),/NaN|"7"/);
  assert.deepEqual(reports,[],'a wrong shape is an outage of that part');
  assert.deepEqual(await (await call('/api/admin/metrics/readings',{method:'POST'})).json(),{saved:false,day:'2026-11-14'});
  assert.deepEqual(await own.metrics.readings(),[]);
 }
 const visits=await setup(t,{visitStore:()=>({kind:'sqlite',count:async()=>{},totals:async()=>({v:1,days:[['2026-11-10','5',2]],pages:{},sources:{}})})});
 const {status,body}=await visits.get();
 assert.equal(status,200);
 assert.deepEqual(body.unavailable,[{part:'visits',reason:'error'}]);
 assert.equal(indicator(body,'visits.views').state,'unavailable');
 assert.equal(body.visitsSince,null);
 assert.deepEqual(body.months.series.views,{state:'unavailable'});
 assert.equal(typeof indicator(body,'signups.accounts').total,'number');
});

test('each state: no visit counted yet',async t=>{
 const {get}=await setup(t,{visitStore:()=>({kind:'sqlite',count:async()=>{},totals:async()=>({v:1,days:[],pages:{},sources:{}})})});
 const {body}=await get();
 assert.equal(body.visitsSince,null);
 const views=indicator(body,'visits.views');
 assert.equal(views.state,'not_yet_counted');assert.equal('d30' in views,false);
 assert.doesNotMatch(JSON.stringify(views),/:0/);
 for(const key of byPart('visits'))assert.equal(indicator(body,key).state,'not_yet_counted',key);
 assert.deepEqual(body.notActivated,[]);assert.deepEqual(body.unavailable,[]);
 assert.deepEqual(body.months.series.views,{});assert.deepEqual(body.months.series.arrivals,{});
});

test('a failed part reaches error reporting through the app',async t=>{
 let failure=()=>{throw new Error('boom');};
 const reports=[];
 const {get,clock}=await setup(t,{report:false,errorReport:{enabled:true,report:async(error,context)=>{reports.push({message:error.message,...context});return true;}},
  metricsStore:({metrics})=>wrap(metrics,{memberDays:()=>failure()})});
 const original=console.error;console.error=()=>{};t.after(()=>{console.error=original;});
 assert.equal((await get()).status,200);
 assert.deepEqual(reports,[{message:'boom',method:'GET',route:'/api/admin/metrics',status:503}]);
 reports.length=0;failure=reject({status:503});clock.at+=MINUTE;
 assert.equal((await get()).status,200);
 assert.deepEqual(reports,[]);
});

test('an indicator whose own source is missing does not blank its part',async t=>{
 const {get,call,own,reports}=await setup(t,{
  courseStore:({course})=>wrap(course,{find:async(name,filters,options,real)=>(await real(name,filters,options)).filter(row=>name!=='courses'||row.id!==FINAL_SURVEY.courseId)}),
  fiiuStore:({fiiu})=>wrap(fiiu,{summary:async(eventId,activities,real)=>{const {attendedPeople,qrPeople,...rest}=await real(eventId,activities);void attendedPeople;void qrPeople;return rest;}}),
 });
 const {body}=await get();
 const missing=['courses.surveyTotal','courses.surveyAnswered','courses.certificates','festival.attendedPeople','festival.qrPeople'];
 for(const key of missing){const ind=indicator(body,key);assert.equal(ind.state,'unavailable',key);assert.equal('total' in ind,false,key);}
 assert.equal(typeof indicator(body,'courses.enrolled').total,'number');
 assert.equal(typeof indicator(body,'festival.registrations').total,'number');
 assert.deepEqual(body.unavailable,[]);assert.deepEqual(body.notActivated,[]);
 assert.deepEqual(reports,[]);
 // The reading (Task 8's POST) leaves the five out and keeps the rest.
 const figures=figuresOf(body.families.flatMap(f=>f.indicators));
 for(const key of missing)assert.equal(key in figures,false,key);
 assert.equal(typeof figures['courses.enrolled'],'number');
 const post=await call('/api/admin/metrics/readings',{method:'POST'});
 assert.deepEqual(await post.json(),{saved:true,day:'2026-11-14'});
 const [row]=await own.metrics.readings();
 assert.deepEqual(row.figures,figures);
});

test('a partial result is kept 30 seconds',async t=>{
 let failures=1,memberCalls=0;
 const {get,clock}=await setup(t,{metricsStore:({metrics})=>wrap(metrics,{
  accountDays:async(options,real)=>{if(failures-->0)throw Object.assign(new Error('down'),{status:503});return real(options);},
  memberDays:async(today,options,real)=>{memberCalls++;return real(today,options);},
 })});
 assert.deepEqual((await get()).body.unavailable,[{part:'accounts',reason:'error'}]);
 clock.at+=29000;
 assert.deepEqual((await get()).body.unavailable,[{part:'accounts',reason:'error'}]);assert.equal(memberCalls,1,'29 s: the memo');
 clock.at+=2000;
 assert.deepEqual((await get()).body.unavailable,[]);assert.equal(memberCalls,2,'31 s: computed again, complete');
});

test('the visit read can be cut short',async()=>{
 const calls=[];
 const clients={admin:{async rest(path,options={}){calls.push({path,options});return {v:1,days:[],pages:{},sources:{}};}}};
 const store=createVisitStore({clients}),signal=new AbortController().signal;
 await store.totals('2026-10-16','2026-11-14',{signal});
 assert.equal(calls[0].options.signal,signal);
 await store.totals('2026-10-16','2026-11-14');
 assert.deepEqual(calls[1],{path:'rpc/visit_totals',options:{method:'POST',body:{p_range:{from:'2026-10-16',to:'2026-11-14'}}}},'R1\'s own call');
});

test('visits are summed from the day series',async t=>{
 const ranges=[];
 const {get}=await setup(t,{visitStore:()=>({kind:'sqlite',count:async()=>{},totals:async(from,to,options)=>{ranges.push([from,to,options?.signal instanceof AbortSignal]);
  return {v:1,days:[['2026-10-20',10,4],['2026-11-10',5,2]],pages:{'index.html':12,'fundadores.html':3},sources:{search:4,direct:2,qr:0}};}})});
 const {body}=await get();
 assert.deepEqual(ranges,[['2026-10-16','2026-11-14',true]]);
 assert.deepEqual(indicator(body,'visits.views'),{key:'visits.views',d30:15,d7:5});
 assert.deepEqual(indicator(body,'visits.arrivals'),{key:'visits.arrivals',d30:6,d7:2});
 assert.equal(body.visitsSince,'2026-10-20');
 assert.deepEqual(body.months.series.views,{'2026-10':10,'2026-11':5});
 assert.deepEqual(body.months.series.arrivals,{'2026-10':4,'2026-11':2});
 assert.deepEqual(indicator(body,'visits.topPages').items,[{key:'index.html',n:12},{key:'fundadores.html',n:3}]);
 assert.deepEqual(indicator(body,'visits.sources').items,[{key:'search',n:4},{key:'direct',n:2}]);
 assert.deepEqual(indicator(body,'memberships.views').items,[{key:'fundadores.html',n:3},{key:'payments.html',n:0}]);
});

test('no database, no API',async t=>{
 const server=createApp({store:createStore()});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/admin/metrics`);
 assert.equal(response.status,404);
});

test('the readings table down',async t=>{
 const {get}=await setup(t,{fixture:true,metricsStore:({metrics})=>wrap(metrics,{readings:reject({status:503})})});
 const {status,body}=await get();
 assert.equal(status,200);
 assert.deepEqual(body.readings,{today:false,months:[],state:'unavailable'});
 assert.deepEqual(body.unavailable,[{part:'readings',reason:'error'}]);
 for(const ind of body.families.flatMap(f=>f.indicators)){
  if(ind.key.startsWith('visits.')||ind.key==='memberships.views')continue; // no visit counted in the fixture
  assert.equal(ind.state,undefined,ind.key);
 }
});

test('the readings of each month: the latest one, and whether today has one',async t=>{
 const {get,own}=await setup(t);
 await own.metrics.saveReading('2026-10-30','2026-10-30T14:00:00.000Z',{'signups.accounts':5},1);
 await own.metrics.saveReading('2026-10-31','2026-10-31T14:00:00.000Z',{'signups.accounts':6},1);
 await own.metrics.saveReading('2026-11-14','2026-11-14T13:00:00.000Z',{'signups.accounts':7},1);
 const {body}=await get();
 assert.deepEqual(body.readings,{today:true,months:[
  {month:'2026-10',day:'2026-10-31',defs:1,figures:{'signups.accounts':6}},
  {month:'2026-11',day:'2026-11-14',defs:1,figures:{'signups.accounts':7}},
 ]});
});

/* Task 8: the CSV export and the daily reading. */
const q=text=>`"${String(text).replaceAll('"','""')}"`;
const row=cells=>cells.map(q).join(',');
// A small reader for csv()'s output: every cell quoted, rows joined by CRLF.
const cellsOf=line=>[...line.matchAll(/"((?:[^"]|"")*)"/g)].map(m=>m[1].replaceAll('""','"'));
async function download(call,path,options){
 const response=await call(path,options);
 // Read the bytes: fetch's text() would drop the byte order mark.
 const text=Buffer.from(await response.arrayBuffer()).toString('utf8');
 return {status:response.status,headers:response.headers,text,lines:text.replace(/^﻿/,'').split('\r\n')};
}
const lineOf=(lines,key)=>lines.find(line=>line.startsWith(`${q(key)},`));
const savedRow=async own=>(await own.metrics.readings());

test('the export is for administrators and needs both parameters',async t=>{
 const {call}=await setup(t);
 const path='/api/admin/metrics/export';
 assert.equal((await call(`${path}?table=indicators&lang=es`,{actor:'guest'})).status,401);
 assert.equal((await call(`${path}?table=indicators&lang=es`,{actor:'member'})).status,403);
 for(const query of ['?lang=es','?table=&lang=es','?table=people&lang=es','?table=indicators','?table=indicators&lang=fr','?table=indicators&lang=',
  '?table=indicators&lang=es&lang=en','?table=indicators&table=months&lang=es']){
  const response=await call(path+query);
  assert.equal(response.status,400,query);
  assert.match(response.headers.get('content-type'),/application\/json/,query);
 }
 const post=await call(`${path}?table=indicators&lang=es`,{method:'POST',body:{}});
 assert.equal(post.status,405);
 assert.equal((await call('/api/admin/metrics/readings')).status,405,'the reading is a POST');
});

test('indicators CSV, byte for byte',async t=>{
 const {call,get}=await setup(t,{fixture:true});
 const {body}=await get();
 const es=await download(call,'/api/admin/metrics/export?table=indicators&lang=es');
 assert.equal(es.status,200);
 assert.equal(es.headers.get('content-type'),'text/csv; charset=utf-8');
 assert.equal(es.headers.get('content-disposition'),'attachment; filename="nodal-indicadores-2026-11-14.csv"');
 assert.equal(es.headers.get('cache-control'),'no-store');
 assert.ok(es.text.startsWith('﻿'),'the byte order mark');
 assert.equal(TEXTS.es.csv.indicators.length,11);
 assert.equal(es.lines[0],row(TEXTS.es.csv.indicators));
 const accounts=TEXTS.es.indicators['signups.accounts'];
 assert.equal(accounts.name,'Cuentas');
 assert.equal(lineOf(es.lines,'signups.accounts'),row(['signups.accounts','ok','Registros','Cuentas',String(indicator(body,'signups.accounts').total),'','',
  accounts.definition,accounts.source,accounts.caveat,'2026-11-14 08:36']));
 // One row per indicator, in the catalogue's order, then its list items under it.
 const keys=es.lines.slice(1).map(line=>cellsOf(line)[0]);
 assert.deepEqual(keys.filter(key=>!key.includes('#')),INDICATORS.map(i=>i.key));
 const peru=cellsOf(lineOf(es.lines,'festival.countries#Perú'));
 assert.deepEqual(peru.slice(0,7),['festival.countries#Perú','ok','Festival','Perú','5','','']);
 assert.deepEqual(cellsOf(lineOf(es.lines,'festival.countries#_other')).slice(3,5),[TEXTS.es.lists.reserved._other,'3']);
 // Answers given by fewer than three people never leave the server apart: one row for them all.
 for(const small of ['organization','academic','professional','_none'])assert.equal(lineOf(es.lines,`festival.profileTypes#${small}`),undefined,small);
 assert.deepEqual(cellsOf(lineOf(es.lines,'festival.profileTypes#_other')).slice(3,5),[TEXTS.es.lists.reserved._other,'5']);
 const student=indicator(body,'festival.profileTypes').items.find(item=>item.key==='student');
 assert.ok(student,'the fixture has a student group');
 assert.deepEqual(cellsOf(lineOf(es.lines,'festival.profileTypes#student')).slice(0,7),
  ['festival.profileTypes#student','ok','Festival',TEXTS.es.lists.profileTypes.student,String(student.n),'','']);
 const profile=indicator(body,'activity.kinds').items.find(item=>item.key==='profile');
 assert.deepEqual(cellsOf(lineOf(es.lines,'activity.kinds#profile')).slice(3,7),[TEXTS.es.lists.kinds.profile,'',String(profile.n),String(profile.d7)]);
 assert.deepEqual(cellsOf(lineOf(es.lines,`courses.enrolled#${FINAL_SURVEY.courseId}`)).slice(3,5),['Curso de movilidad urbana','5']);
 const pt=await download(call,'/api/admin/metrics/export?table=indicators&lang=pt');
 assert.equal(pt.lines[0],row(TEXTS.pt.csv.indicators));
 assert.notEqual(pt.lines[0],es.lines[0]);
 assert.equal(cellsOf(lineOf(pt.lines,'signups.accounts'))[7],TEXTS.pt.indicators['signups.accounts'].definition);
 const stable=lines=>lines.slice(1).map(line=>cellsOf(line).slice(0,2));
 assert.deepEqual(stable(pt.lines),stable(es.lines),'key and state do not change with the language');
});

test('a failed part is written in words',async t=>{
 const notActivated=await setup(t,{metricsStore:({metrics})=>wrap(metrics,{memberDays:reject({code:'42P01'})})});
 const one=await download(notActivated.call,'/api/admin/metrics/export?table=indicators&lang=es');
 const city=cellsOf(lineOf(one.lines,'profiles.city'));
 assert.equal(city[1],'not_activated');
 assert.equal(city[4],'Aún no está activado en la base de datos');
 assert.ok(!one.lines.some(line=>line.startsWith('"festival.countries#')),'a failed list has no item rows');
 assert.equal(cellsOf(lineOf(one.lines,'activity.kinds'))[5],'Aún no está activado en la base de datos');

 const down=await setup(t,{metricsStore:({metrics})=>wrap(metrics,{accountDays:reject({status:503})})});
 const two=await download(down.call,'/api/admin/metrics/export?table=indicators&lang=es');
 const fresh=cellsOf(lineOf(two.lines,'signups.new'));
 assert.equal(fresh[1],'unavailable');
 assert.deepEqual(fresh.slice(4,7),['','No disponible en este momento','No disponible en este momento']);
 assert.equal(cellsOf(lineOf(two.lines,'signups.accounts'))[4],'No disponible en este momento');

 const empty=await setup(t,{visitStore:()=>({kind:'sqlite',count:async()=>{},totals:async()=>({v:1,days:[],pages:{},sources:{}})})});
 const views=cellsOf(lineOf((await download(empty.call,'/api/admin/metrics/export?table=indicators&lang=es')).lines,'visits.views'));
 assert.equal(views[1],'not_yet_counted');
 assert.deepEqual(views.slice(5,7),['Aún no hay visitas contadas','Aún no hay visitas contadas']);

 const later=await setup(t,{visitStore:()=>({kind:'sqlite',count:async()=>{},totals:async()=>({v:1,days:[['2026-11-17',3,1]],pages:{},sources:{}})})});
 const lines=(await download(later.call,'/api/admin/metrics/export?table=indicators&lang=es')).lines;
 const since=cellsOf(lineOf(lines,'visits.views'));
 assert.equal(since[1],'not_yet_counted');
 assert.deepEqual(since.slice(5,7),['Se cuenta desde el 17 nov 2026','Se cuenta desde el 17 nov 2026']);
 assert.equal(cellsOf(lineOf((await download(later.call,'/api/admin/metrics/export?table=indicators&lang=en')).lines,'visits.views'))[5],'Counted since Nov 17, 2026');
});

test('the formula guard holds',async t=>{
 const {call,own}=await setup(t);
 await own.course.insert('courses',{id:'c-formula',title:'=HYPERLINK("x")',status:'published',createdAt:START,updatedAt:START});
 const {text,lines}=await download(call,'/api/admin/metrics/export?table=indicators&lang=es');
 assert.ok(lines.some(line=>line.startsWith('"courses.enrolled#c-formula","ok","Cursos","\'=HYPERLINK(""x"")","0"')),text);
 assert.ok(!text.includes(',"=HYPERLINK'),'no cell starts with the formula');
});

test('months CSV',async t=>{
 const {call}=await setup(t);
 const {status,headers,lines}=await download(call,'/api/admin/metrics/export?table=months&lang=es');
 assert.equal(status,200);
 assert.equal(headers.get('content-disposition'),'attachment; filename="nodal-indicadores-por-mes-2026-11-14.csv"');
 assert.equal(lines[0],row(TEXTS.es.csv.months));
 assert.equal(TEXTS.es.csv.months.length,1+MONTH_SERIES.length);
 assert.deepEqual(lines.slice(1).map(line=>cellsOf(line)[0]),['2026-07','2026-08','2026-09','2026-10','2026-11']);
 // The harness's two accounts were made in July; no visit has been counted yet; a zero prints as 0.
 assert.deepEqual(cellsOf(lines[1]).slice(0,2),['2026-07','2']);
 assert.equal(cellsOf(lines[1])[3],'0');
 for(const line of lines.slice(1))assert.deepEqual(cellsOf(line).slice(4),['Aún no hay visitas contadas','Aún no hay visitas contadas']);

 const failed=await setup(t,{metricsStore:({metrics})=>wrap(metrics,{memberDays:reject({status:503})})});
 const down=(await download(failed.call,'/api/admin/metrics/export?table=months&lang=es')).lines;
 for(const line of down.slice(1)){
  const cells=cellsOf(line);
  assert.deepEqual(cells.slice(2,4),['No disponible en este momento','No disponible en este momento'],line);
 }

 const counted=await setup(t,{visitStore:()=>({kind:'sqlite',count:async()=>{},totals:async()=>({v:1,days:[['2026-10-20',10,4],['2026-11-10',5,2]],pages:{},sources:{}})})});
 const rows=(await download(counted.call,'/api/admin/metrics/export?table=months&lang=es')).lines.slice(1).map(cellsOf);
 for(const cells of rows.slice(0,3))assert.deepEqual(cells.slice(4),['Se cuenta desde el 20 oct 2026','Se cuenta desde el 20 oct 2026'],cells[0]);
 assert.deepEqual(rows[3].slice(4),['10','4']);
 assert.deepEqual(rows[4].slice(4),['5','2']);
});

test('readings CSV',async t=>{
 const {call,own}=await setup(t);
 await own.metrics.saveReading('2026-10-30','2026-10-30T14:00:00.000Z',{'signups.accounts':5,'activity.kinds.profile.d7':2},1);
 await own.metrics.saveReading('2026-11-14','2026-11-14T13:36:00.000Z',{'signups.accounts':7,'courses.openers':0},1);
 const {status,headers,lines}=await download(call,'/api/admin/metrics/export?table=readings&lang=es');
 assert.equal(status,200);
 assert.equal(headers.get('content-disposition'),'attachment; filename="nodal-indicadores-lecturas-2026-11-14.csv"');
 const head=cellsOf(lines[0]);
 assert.deepEqual(head.slice(0,3),TEXTS.es.csv.readings);
 const keys=head.slice(3);
 assert.equal(keys.length,63);
 assert.equal(new Set(keys).size,63);
 assert.deepEqual(keys.slice(0,4),['signups.accounts','signups.confirmed','signups.new.d30','signups.new.d7']);
 assert.ok(keys.every(key=>!key.startsWith('visits.')&&!key.startsWith('memberships.views')));
 assert.deepEqual(keys.filter(key=>key.startsWith('activity.kinds.')).slice(0,2),['activity.kinds.profile.d30','activity.kinds.profile.d7']);
 assert.equal(keys.at(-1),'courses.openers');
 assert.equal(lines.length,3,'one row per saved day');
 const first=cellsOf(lines[1]),second=cellsOf(lines[2]);
 assert.deepEqual(first.slice(0,3),['2026-10-30','2026-10-30 09:00','1']);
 const at=key=>3+keys.indexOf(key);
 assert.equal(first[at('signups.accounts')],'5');
 assert.equal(first[at('activity.kinds.profile.d7')],'2');
 assert.equal(second[at('courses.openers')],'0','a zero prints as 0');
 assert.equal(TEXTS.pt.csv.readings.length,3);
});

test('a reading without a key leaves the cell blank',async t=>{
 const {call,own}=await setup(t);
 await own.metrics.saveReading('2026-10-30','2026-10-30T14:00:00.000Z',{'signups.accounts':5},1);
 const {lines}=await download(call,'/api/admin/metrics/export?table=readings&lang=es');
 const keys=cellsOf(lines[0]).slice(3),cells=cellsOf(lines[1]);
 assert.equal(cells[3+keys.indexOf('profiles.saved')],'');
 assert.ok(lines[1].includes(',"",'),'an empty quoted cell');
 assert.ok(!cells.slice(3).some(cell=>cell==='undefined'||cell==='null'));
 assert.equal(cells.slice(3).filter(cell=>cell!=='').length,1);
});

test('the readings CSV with its table down',async t=>{
 const {call}=await setup(t,{metricsStore:({metrics})=>wrap(metrics,{readings:reject({status:503})})});
 const response=await call('/api/admin/metrics/export?table=readings&lang=es');
 assert.equal(response.status,503);
 assert.match(response.headers.get('content-type'),/application\/json/);
 assert.equal(response.headers.get('content-disposition'),null);
 assert.deepEqual(await response.json(),{error:'metrics unavailable'});
});

test('a reading the store cannot save',async t=>{
 const {call,get,own,reports}=await setup(t,{metricsStore:({metrics})=>wrap(metrics,{saveReading:reject({status:503})})});
 const post=await call('/api/admin/metrics/readings',{method:'POST'});
 assert.equal(post.status,503);
 assert.deepEqual(await post.json(),{error:'metrics unavailable'});
 assert.deepEqual(own.db.prepare('SELECT day FROM metrics_readings').all(),[]);
 assert.deepEqual(reports,[],'an outage is not reported');
 const {status,body}=await get();
 assert.equal(status,200);
 assert.equal(body.readings.today,false);
 assert.deepEqual(body.unavailable,[]);
});

test('a saved reading that cannot be read fails the readings alone',async t=>{
 const {get,call,own}=await setup(t);
 own.db.prepare('INSERT INTO metrics_readings (day,taken_at,defs,figures) VALUES (?,?,?,?)').run('2026-11-01','2026-11-01T14:00:00.000Z',1,'{"signups.accounts":');
 await assert.rejects(own.metrics.readings(),error=>error.status===502&&error.message==='metrics readings unavailable');
 const {status,body}=await get();
 assert.equal(status,200);
 assert.deepEqual(body.readings,{today:false,months:[],state:'unavailable'});
 assert.deepEqual(body.unavailable,[{part:'readings',reason:'error'}]);
 assert.equal(typeof indicator(body,'signups.accounts').total,'number');
 const response=await call('/api/admin/metrics/export?table=readings&lang=es');
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:'metrics unavailable'});
});

test('saves the first complete reading of the day',async t=>{
 const {call,get,own}=await setup(t,{fixture:true});
 const {body}=await get();
 const post=await call('/api/admin/metrics/readings',{method:'POST'});
 assert.equal(post.status,200);
 assert.deepEqual(await post.json(),{saved:true,day:'2026-11-14'});
 const saved=await savedRow(own);
 assert.equal(saved.length,1);
 const [reading]=saved;
 assert.equal(reading.day,'2026-11-14');
 assert.equal(reading.defs,1);
 assert.equal(reading.takenAt,START);
 const expected=figuresOf(body.families.flatMap(f=>f.indicators));
 assert.deepEqual(reading.figures,expected);
 const keys=Object.keys(reading.figures);
 assert.equal(keys.length,63);
 assert.ok(keys.every(key=>!key.startsWith('visits.')&&!key.startsWith('memberships.views')));
 assert.ok(Object.values(reading.figures).every(Number.isInteger),'numbers only, no list text');
 const again=await call('/api/admin/metrics/readings',{method:'POST'});
 assert.deepEqual(await again.json(),{saved:false,day:'2026-11-14'});
 assert.deepEqual(await savedRow(own),saved,'the first reading wins');
 assert.equal((await get()).body.readings.today,true);
});

test('the reading ignores its body',async t=>{
 const json=await setup(t,{fixture:true});
 const {body}=await json.get();
 const expected=figuresOf(body.families.flatMap(f=>f.indicators));
 const one=await json.call('/api/admin/metrics/readings',{method:'POST',body:{figures:{'signups.accounts':1}}});
 assert.equal(one.status,200);
 assert.deepEqual((await savedRow(json.own))[0].figures,expected);
 const plain=await setup(t,{fixture:true});
 const two=await plain.call('/api/admin/metrics/readings',{method:'POST',raw:'x',headers:{'Content-Type':'text/plain'}});
 assert.equal(two.status,200);
 assert.deepEqual(await two.json(),{saved:true,day:'2026-11-14'});
 assert.deepEqual((await savedRow(plain.own))[0].figures,expected);
});

test('the reading refuses another origin and limits',async t=>{
 const {call,own}=await setup(t);
 const evil=await call('/api/admin/metrics/readings',{method:'POST',origin:'https://evil.example'});
 assert.equal(evil.status,403);
 assert.deepEqual(await savedRow(own),[]);
 assert.equal((await call('/api/admin/metrics/readings',{method:'POST',actor:'guest'})).status,401);
 assert.equal((await call('/api/admin/metrics/readings',{method:'POST',actor:'member'})).status,403);
 assert.deepEqual(await savedRow(own),[]);
 for(let i=0;i<6;i++)assert.equal((await call('/api/admin/metrics/readings',{method:'POST'})).status,200,`POST ${i+1}`);
 const refused=await call('/api/admin/metrics/readings',{method:'POST'});
 assert.equal(refused.status,429);
 assert.ok(Number(refused.headers.get('retry-after'))>0);
});

test('never saves a partial answer',async t=>{
 for(const failure of [{accountDays:reject({status:503})},{memberDays:reject({code:'PGRST202'})},{readings:reject({status:503})}]){
  let saves=0;
  const {call,own}=await setup(t,{metricsStore:({metrics})=>wrap(metrics,{...failure,saveReading:async(...args)=>{saves++;return args.at(-1)(...args.slice(0,-1));}})});
  const post=await call('/api/admin/metrics/readings',{method:'POST'});
  assert.equal(post.status,200);
  assert.deepEqual(await post.json(),{saved:false,day:'2026-11-14'},Object.keys(failure)[0]);
  assert.equal(saves,0,Object.keys(failure)[0]);
  assert.deepEqual(await own.db.prepare('SELECT day FROM metrics_readings').all(),[]);
 }
 const {call}=await setup(t,{courseStore:null});
 assert.deepEqual(await (await call('/api/admin/metrics/readings',{method:'POST'})).json(),{saved:false,day:'2026-11-14'});
});

test('the reading uses the memo or the shared computation',async t=>{
 const first=together();
 const {call,get}=await setup(t,{metricsStore:first.store,metricsOptions:first.options});
 await get();assert.equal(first.state.calls,1);
 assert.deepEqual(await (await call('/api/admin/metrics/readings',{method:'POST'})).json(),{saved:true,day:'2026-11-14'});
 assert.equal(first.state.calls,1,'the POST read the memo');
 const pair=together();
 const other=await setup(t,{metricsStore:pair.store,metricsOptions:pair.options});
 pair.arm(); // the computation ends only once the POST and the GET are both in
 const [post,read]=await Promise.all([other.call('/api/admin/metrics/readings',{method:'POST'}).then(r=>r.json()),other.get()]);
 assert.deepEqual(post,{saved:true,day:'2026-11-14'});
 assert.equal(read.status,200);
 assert.equal(pair.state.calls,1,'one computation for both');
});

test('never saves one day\'s figures under the next day',async t=>{
 const days=[];
 const {call,get,own,clock}=await setup(t,{start:'2026-11-15T04:59:00.000Z',metricsStore:({metrics})=>wrap(metrics,{memberDays:async(today,options,real)=>{days.push(today);return real(today,options);}})});
 assert.equal((await get()).body.limaDay,'2026-11-14');
 assert.deepEqual(days,['2026-11-14']);
 clock.at=Date.parse('2026-11-15T05:00:30.000Z');
 const post=await call('/api/admin/metrics/readings',{method:'POST'});
 assert.deepEqual(await post.json(),{saved:true,day:'2026-11-15'});
 assert.deepEqual(days,['2026-11-14','2026-11-15'],'computed again for the new day');
 const saved=await savedRow(own);
 assert.deepEqual(saved.map(r=>[r.day,r.takenAt]),[['2026-11-15','2026-11-15T05:00:30.000Z']]);
});
