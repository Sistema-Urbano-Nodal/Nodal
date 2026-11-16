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
import {createVisitStore} from '../server/visits-repository.js';
import {FINAL_SURVEY} from '../server/course-final-survey.js';
import {DEFS,FAMILIES,INDICATORS,LEAD,LEAD_SECOND,TRACKED,TEXTS,MONTH_SERIES} from '../server/metrics-catalog.js';
import {windowsFor,figuresOf} from '../server/metrics-domain.js';
import {loadSqlite,expectedMemberDays,sqliteProfile} from './fixtures/metrics-fixture.js';

const START='2026-11-14T13:36:00.000Z';
const MINUTE=60000;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
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

test('counts on seeded rows',async t=>{
 const {get,own}=await setup(t,{fixture:true});
 for(const day of ['2026-11-10','2026-11-13'])await own.visit.count({day,page:'index.html',arrival:true,source:'search'});
 const {body}=await get();
 assert.deepEqual(body.unavailable,[]);assert.deepEqual(body.notActivated,[]);
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
 assert.deepEqual(body.pending,{interests:expectedMemberDays.now.interestsNew,orgRequests:expectedMemberDays.now.orgRequestsNew,lab:0});
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
 let calls=0;
 const {get,clock}=await setup(t,{metricsStore:({metrics})=>wrap(metrics,{memberDays:async(today,options,real)=>{calls++;await pause(30);return real(today,options);}})});
 assert.equal((await get()).status,200);assert.equal(calls,1);
 clock.at+=10000;
 assert.equal((await get()).status,200);assert.equal(calls,1,'10 seconds later: the memo');
 clock.at=Date.parse(START)+5*MINUTE+1;
 await get();assert.equal(calls,2,'5 minutes and 1 ms later: computed again');
 await Promise.all([get(),get()]);assert.equal(calls,2,'two at once inside the memo');
 clock.at+=5*MINUTE+1;
 const both=await Promise.all([get(),get()]);
 assert.equal(calls,3,'two at once share one computation');
 assert.deepEqual(both[0].body,both[1].body);
 await get('/api/admin/metrics?fresh=1');assert.equal(calls,4,'fresh=1 skips the memo');
});

test('limits',async t=>{
 const {call}=await setup(t);
 for(let i=0;i<60;i++)assert.equal((await call('/api/admin/metrics')).status,200,`GET ${i+1}`);
 const refused=await call('/api/admin/metrics');
 assert.equal(refused.status,429);assert.ok(Number(refused.headers.get('retry-after'))>0);
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
 let calls=0;
 const slow=({metrics})=>wrap(metrics,{memberDays:async(today,options,real)=>{calls++;await pause(30);return real(today,options);}});
 const {call,get}=await setup(t,{metricsStore:slow});
 await get();assert.equal(calls,1);
 assert.deepEqual(await (await call('/api/admin/metrics/readings',{method:'POST'})).json(),{saved:true,day:'2026-11-14'});
 assert.equal(calls,1,'the POST read the memo');
 calls=0;
 const other=await setup(t,{metricsStore:slow});
 const [post,read]=await Promise.all([other.call('/api/admin/metrics/readings',{method:'POST'}).then(r=>r.json()),other.get()]);
 assert.deepEqual(post,{saved:true,day:'2026-11-14'});
 assert.equal(read.status,200);
 assert.equal(calls,1,'one computation for both');
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
