import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {FIIU_EVENT} from '../server/fiiu-domain.js';
import {createFiiuHarness,key,descendants,content,flush,Node} from './helpers/fiiu-ui-harness.js';

/* The live window (web/scripts/fiiu-live.js) against a stubbed GET /api/fiiu/live, in the shape the spec gives (section 3): the band at the top of
   fiiu.html and the compact line in the console's festival block. Lane A serves the real route; these tests only pin what the page does with it. */
const read=name=>readFileSync(new URL('../web/scripts/'+name+'.js',import.meta.url),'utf8');
// A Date frozen at one instant: new Date() and Date.now() answer it, new Date(value) still parses.
const frozen=iso=>{const fixed=Date.parse(iso);return class extends Date{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};};
// 10:30 in Lima on 21 Oct, during the first conference block; 15 Oct is before the festival.
const DURING='2026-10-21T15:30:00.000Z',BEFORE='2026-10-15T15:00:00.000Z';
const Q1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',Q2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',Q3='cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
const activity=id=>{const a=FIIU_EVENT.activities.find(item=>item.id===id);return{id:a.id,title:a.title,date:a.date,time:a.time,venue:a.venue};};
const LIVE=(over={})=>({active:true,generatedAt:'2026-10-21T15:29:40.000Z',
 now:{activity:activity('day1-am'),checkedIn:87},next:{activity:activity('day1-pm')},
 sessions:[{activityId:'day0-lab',checkedIn:12},{activityId:'day1-am',checkedIn:87}],
 conversations:[
  {questionId:Q1,activityId:'day1-am',activityTitle:'El poder de lo local',body:'¿Qué te llevas de esta charla?',kind:'chat',messageCount:12,latest:{author:'María G.',body:'Que la ciudad se hace entre vecinos.',likeCount:3,createdAt:'2026-10-21T15:28:00.000Z'},rating:null},
  {questionId:Q2,activityId:'general',activityTitle:'General',body:'¿Cómo valoras el festival hasta ahora?',kind:'rating',messageCount:2,latest:null,rating:{average:7.8,count:18}},
 ],
 badges:{first:120,three:14,conferences:0,lab:9},
 pulse:{registered:540,checkedInToday:87,checkedInTotal:99,messages:1234,ratings:18},...over});
const reads=h=>h.requests.filter(request=>request.path==='/api/fiiu/live').length;
const running=h=>h.timers.filter(timer=>!timer.cleared);
const linkTo=(node,text)=>node.querySelectorAll('a').find(a=>a.textContent===text);
// fiiu-ui.js then fiiu-live.js, as the pages load them, with Fiiu.live.mount on a host of the test's own.
async function band(respond,{when=DURING,sessionLink,...options}={}){
 const h=await createFiiuHarness(request=>request.path==='/api/fiiu/live'?respond(request):{status:404,data:{error:'not found'}},{page:'fiiu-live',context:{Date:frozen(when)}});
 if(sessionLink)h.ctx.window.Fiiu.sessionLink=sessionLink;
 const host=new Node('section');h.body.append(host);const live=h.ctx.window.Fiiu.live.mount(host,{event:FIIU_EVENT,...options});await flush();
 return{...h,host,live};
}

test('the band shows what is under way and next, the live conversations, the badge counts and the day’s numbers from one read',async()=>{
 const h=await band(()=>LIVE());
 assert.equal(reads(h),1);assert.equal(h.requests[0].method,'GET');assert.equal(h.host.hidden,false);assert.match(h.host.className,/\bf-live\b/);
 const title=key(h.host,'liveTitle');assert.equal(title.tagName,'h2');assert.equal(h.host['aria-labelledby'],title.id);
 // Ahora: the block under way, its time and venue and how many checked in, its title opening its session page.
 const now=h.host.querySelector('.f-live-when');assert.ok(key(now,'liveNow'));
 const session=linkTo(now,'El poder de lo local');assert.equal(session.href,'fiiu-session.html?a=day1-am');assert.equal(session.lang,'es');
 assert.match(content(now),/09:00–13:00/);assert.match(content(now),/Auditorio MALI/);assert.match(content(now),/87\s+people checked in/);
 // A continuación: the next block to start.
 assert.ok(key(now,'liveNext'));assert.equal(linkTo(now,activity('day1-pm').title).href,'fiiu-session.html?a=day1-pm');
 // The conversations, each opening its question inside its session page.
 const talks=h.host.querySelector('.f-live-talks');assert.ok(key(talks,'liveTalks'));const items=talks.querySelectorAll('.f-live-talk');assert.equal(items.length,2);
 const first=linkTo(items[0],'¿Qué te llevas de esta charla?');assert.equal(first.href,'fiiu-session.html?a=day1-am&q='+Q1);assert.equal(first.lang,'es');
 assert.match(content(items[0]),/El poder de lo local/);assert.match(content(items[0]),/12\s+answers/);assert.match(content(items[0]),/María G\./);assert.match(content(items[0]),/Que la ciudad se hace entre vecinos\./);
 assert.equal(linkTo(items[1],'¿Cómo valoras el festival hasta ahora?').href,'fiiu-session.html?a=general&q='+Q2);
 assert.ok(key(items[1],'liveGeneral'),'General is named in the reader’s language');assert.match(content(items[1]),/Average 7\.8 from 18 people/);
 // Insignias and El festival hoy: counts only.
 const badges=h.host.querySelector('.f-live-badges');assert.ok(key(badges,'liveBadges'));
 for(const [label,n] of [['liveBadgeFirst','120'],['liveBadgeThree','14'],['liveBadgeConferences','0'],['liveBadgeLab','9']])assert.equal(key(badges,label).parent.querySelector('.f-live-value').textContent,n,label);
 const pulse=h.host.querySelector('.f-live-pulse');assert.ok(key(pulse,'livePulse'));
 for(const [label,n] of [['livePulseRegistered','540'],['livePulseToday','87'],['livePulseTotal','99'],['livePulseMessages','1,234'],['livePulseRatings','18']])assert.equal(key(pulse,label).parent.querySelector('.f-live-value').textContent,n,label);
 // Headings in order: the band's h2, then an h3 per part.
 assert.deepEqual(descendants(h.host).filter(node=>/^h\d$/.test(node.tagName)).map(node=>node.tagName),['h2','h3','h3','h3','h3','h3']);
 assert.equal(key(h.host,'livePreview'),undefined,'no preview mark during the festival');
});

test('the band speaks the reader’s language, numbers and averages included, and every string has English, Spanish and Portuguese',async()=>{
 const h=await band(()=>LIVE());
 h.lang('pt');assert.match(content(h.host),/1\.234/);assert.match(content(h.host),/Média 7,8 de 18 pessoas/);assert.equal(key(h.host,'liveNow').textContent,'Agora');assert.match(content(h.host),/87\s+pessoas registraram presença/);
 h.lang('es');assert.match(content(h.host),/Promedio 7\.8 de 18 personas/);assert.equal(key(h.host,'liveNow').textContent,'Ahora');assert.equal(key(h.host,'liveNext').textContent,'A continuación');assert.equal(key(h.host,'liveTitle').textContent,'En vivo');
 assert.match(content(h.host),/12\s+respuestas/);
 const rows=h.ctx.window.Fiiu.rows,names=Object.keys(rows).filter(name=>name.startsWith('live'));assert.ok(names.length>=25);
 for(const name of names){assert.equal(rows[name].length,3,name);assert.ok(rows[name].every(text=>typeof text==='string'&&text.trim()),name);}
 const one=await band(()=>LIVE({now:{activity:activity('day1-am'),checkedIn:1},conversations:[{...LIVE().conversations[1],rating:{average:9,count:1}}]}));
 assert.match(content(one.host),/1\s+person checked in/);assert.match(content(one.host),/Average 9\.0 from 1 person/);
 const none=await band(()=>LIVE({conversations:[{...LIVE().conversations[1],rating:{average:0,count:0}}]}));assert.match(content(none.host),/No ratings yet/);
});

test('organisers see the band outside the festival dates marked as a preview; nobody else asks for it then',async()=>{
 const preview=await band(()=>LIVE(),{when:BEFORE,organiser:true});
 assert.equal(reads(preview),1);assert.equal(preview.host.hidden,false);const mark=key(preview.host,'livePreview');assert.ok(mark);assert.equal(mark.parent,key(preview.host,'liveTitle').parent,'the mark sits with the heading');
 preview.lang('es');assert.equal(key(preview.host,'livePreview').textContent,'Vista previa');
 const participant=await band(()=>LIVE(),{when:BEFORE});
 assert.equal(reads(participant),0,'before the festival a participant’s page does not ask');assert.equal(participant.host.hidden,true);assert.equal(running(participant).length,0);
 const after=await band(()=>LIVE(),{when:'2026-10-26T15:00:00.000Z'});assert.equal(reads(after),0);assert.equal(after.host.hidden,true);
});

test('an inactive answer hides the band and stops the refresh',async()=>{
 let active=true;const h=await band(()=>active?LIVE():{active:false,generatedAt:'2026-10-21T15:30:00.000Z'});
 assert.equal(h.host.hidden,false);assert.equal(running(h).length,1);
 active=false;await h.tickTimers();await flush();
 assert.equal(h.host.hidden,true);assert.equal(h.host.children.length,0);assert.equal(running(h).length,0);
});

test('without a registration the festival page shows one line to register, the console nothing, and neither keeps asking',async()=>{
 for(const status of [401,403]){
  const h=await band(()=>({status,data:{error:'no',code:status===403?'not_registered':undefined}}));
  assert.equal(h.host.hidden,false);const line=h.host.querySelector('.f-live-prompt');assert.ok(line);
  const go=key(line,'liveRegister');assert.equal(go.tagName,'a');assert.equal(go.href,'#registration');
  assert.equal(h.host.querySelectorAll('.f-live-part').length,0);assert.equal(running(h).length,0,'no refresh without access');
  h.lang('es');assert.equal(key(line,'liveRegister').textContent,'Inscríbete para ver el FIIU en vivo');
  const compact=await band(()=>({status,data:{error:'no'}}),{compact:true});assert.equal(compact.host.hidden,true);assert.equal(compact.host.children.length,0);assert.equal(running(compact).length,0);
 }
 // Once registration closes, a signed-out reader is asked to sign in with a registered account, and a signed-in one without a registration sees nothing.
 const guest=await band(()=>({status:401,data:{error:'sign in required'}}),{registrationOpen:false});assert.ok(key(guest.host,'liveSignIn'));assert.equal(key(guest.host,'liveRegister'),undefined);
 const member=await band(()=>({status:403,data:{error:'no',code:'not_registered'}}),{registrationOpen:false});assert.equal(member.host.hidden,true);
});

test('the band reads every 30 s while the tab is visible, pauses while hidden and reads at once on return; a failed read keeps what it shows',async()=>{
 let fail=false;const h=await band(()=>fail?{status:503,data:{error:'unavailable'}}:LIVE());
 assert.deepEqual(running(h).map(timer=>timer.delay),[30000]);
 await h.tickTimers();await flush();assert.equal(reads(h),2);
 await h.visible(false);assert.equal(running(h).length,0,'paused while hidden');await h.tickTimers();assert.equal(reads(h),2);
 await h.visible(true);await flush();assert.equal(reads(h),3,'an immediate read on return');assert.deepEqual(running(h).map(timer=>timer.delay),[30000]);
 fail=true;await h.tickTimers();await flush();assert.equal(reads(h),4);
 assert.equal(h.host.hidden,false);assert.ok(linkTo(h.host,'El poder de lo local'),'venue Wi-Fi failing a read leaves the last view');assert.equal(running(h).length,1,'and the next tick tries again');
 // A read still on its way is not doubled by a tick or a return.
 let finish;fail=false;const slow=await band(()=>new Promise(resolve=>{finish=resolve;}));
 await slow.tickTimers();await slow.visible(false);await slow.visible(true);assert.equal(reads(slow),1);finish(LIVE());await flush();assert.equal(slow.host.hidden,false);
 // stop() ends it for good.
 h.live.stop();await h.visible(false);await h.visible(true);await flush();assert.equal(reads(h),4);assert.equal(running(h).length,0);
});

test('a refresh with new numbers changes them in place; a new conversation rebuilds the list',async()=>{
 let answer=LIVE();const h=await band(()=>answer);
 const session=linkTo(h.host,'El poder de lo local'),question=linkTo(h.host,'¿Qué te llevas de esta charla?');
 answer=LIVE({now:{activity:activity('day1-am'),checkedIn:88},pulse:{...LIVE().pulse,messages:1240},conversations:[{...LIVE().conversations[0],messageCount:13},{...LIVE().conversations[1],rating:{average:7.9,count:19}}]});
 await h.tickTimers();await flush();
 assert.equal(linkTo(h.host,'El poder de lo local'),session,'the same link stays, so focus and a screen reader’s place stay too');assert.equal(linkTo(h.host,'¿Qué te llevas de esta charla?'),question);
 assert.match(content(h.host.querySelector('.f-live-when')),/88\s+people checked in/);assert.match(content(h.host.querySelector('.f-live-talks')),/13\s+answers/);assert.match(content(h.host),/Average 7\.9 from 19 people/);
 assert.equal(key(h.host,'livePulseMessages').parent.querySelector('.f-live-value').textContent,'1,240');
 answer=LIVE({conversations:[{...LIVE().conversations[0],questionId:Q3,body:'¿Qué cambiarías en tu barrio?'},...LIVE().conversations]});await h.tickTimers();await flush();
 assert.equal(h.host.querySelectorAll('.f-live-talk').length,3);assert.equal(linkTo(h.host,'¿Qué cambiarías en tu barrio?').href,'fiiu-session.html?a=day1-am&q='+Q3);
 // Nothing open: the part says so.
 answer=LIVE({conversations:[],now:null});await h.tickTimers();await flush();assert.ok(key(h.host,'liveNoTalks'));assert.equal(key(h.host,'liveNow'),undefined);assert.ok(key(h.host,'liveNext'));
 answer=LIVE({conversations:[],now:null,next:null});await h.tickTimers();await flush();assert.ok(key(h.host,'liveDone'));
});

test('the band never announces its refreshes: no live region anywhere in it',async()=>{
 for(const answer of [()=>LIVE(),()=>({status:403,data:{error:'no'}})]){
  const h=await band(answer);await h.tickTimers();await flush();
  for(const node of [h.host,...descendants(h.host)]){assert.equal(node['aria-live'],undefined,node.tagName);assert.ok(!['status','alert','log'].includes(node.role),node.tagName);assert.notEqual(node.getAttribute('role'),'status');}
 }
});

test('the band builds its links with Fiiu.sessionLink when the page has it',async()=>{
 const h=await band(()=>LIVE(),{sessionLink:(activityId,questionId)=>'session/'+activityId+(questionId?'/'+questionId:'')});
 assert.equal(linkTo(h.host,'El poder de lo local').href,'session/day1-am');assert.equal(linkTo(h.host,'¿Qué te llevas de esta charla?').href,'session/day1-am/'+Q1);
});

// fiiu.html: fiiu-ui.js, fiiu-live.js, then fiiu.js, which mounts the band once it knows who is reading.
const user={id:'00000000-0000-4000-8000-000000000001',email:'ana@example.test',name:'Ana Test',city:'Lima'};
const answers={firstName:'Ana',lastName:'Test',country:'Perú',city:'Lima',profile:'professional',publicOfficial:false,applyLab:false,activities:['day1-am'],externalActivities:[],gender:'prefer_not',age:30,accessibility:['none'],motivation:'learn',previousAttendance:'no',privacyAccepted:true};
const saved={userId:user.id,id:'00000000-0000-4000-8000-000000000002',version:1,email:user.email,answers,labStatus:'none'};
const festival=(config={})=>({event:FIIU_EVENT,config:{registrationOpen:true,programUrl:'https://canva.link/ficmkatcg9fudwk',...config},content:[],nextCursor:null});
async function festivalPage(liveRead,{me=null,when=DURING,config,write=()=>({status:503,data:{error:'unavailable'}})}={}){
 const h=await createFiiuHarness(request=>request.method!=='GET'?write(request):request.path==='/api/fiiu/live'?liveRead(request):request.path.startsWith('/api/fiiu?kind=')?festival(config):request.path==='/api/fiiu/pulse'?{questions:[]}:request.path==='/api/fiiu/registration'?(me||{status:401,data:{error:'sign in required'}}):{status:404,data:{error:'not found'}},{page:'fiiu-live',context:{Date:frozen(when)}});
 vm.runInContext(read('fiiu'),h.ctx);await flush();return h;
}
const paths=h=>h.requests.map(request=>request.path);

test('the festival page carries the band at its top, as #en-vivo, read once the registration is known',async()=>{
 const h=await festivalPage(()=>LIVE(),{me:{user,registration:saved,attendance:[],isAdmin:false}});
 const live=h.root.children[0];assert.equal(live.tagName,'section');assert.equal(live.id,'en-vivo');assert.match(live.className,/\bf-live\b/);assert.equal(live.hidden,false);
 assert.match(h.root.children[1].className,/\bf-hero\b/,'the hero follows the band');assert.ok(key(live,'liveNow'));
 assert.ok(paths(h).indexOf('/api/fiiu/live')>paths(h).indexOf('/api/fiiu/registration'),'the band waits for the registration read');assert.equal(paths(h).filter(path=>path==='/api/fiiu/live').length,1);
 // A guest during the festival sees the one line, pointing to the registration panel; once registration closes, to sign in.
 const guest=await festivalPage(()=>({status:401,data:{error:'sign in required'}}));assert.ok(key(guest.root.children[0],'liveRegister'));
 const closed=await festivalPage(()=>({status:401,data:{error:'sign in required'}}),{config:{registrationOpen:false}});assert.ok(key(closed.root.children[0],'liveSignIn'));
 // Before the festival a participant's page does not ask; an organiser's shows the preview.
 const early=await festivalPage(()=>LIVE(),{me:{user,registration:saved,attendance:[],isAdmin:false},when:BEFORE});assert.equal(paths(early).includes('/api/fiiu/live'),false);assert.equal(early.root.children[0].hidden,true);
 const organiser=await festivalPage(()=>LIVE(),{me:{user,registration:null,attendance:[],isAdmin:true},when:BEFORE});assert.ok(key(organiser.root.children[0],'livePreview'));
});

test('cancelling or saving a registration on the page brings the band in step at once',async()=>{
 let registered=true;
 const h=await festivalPage(()=>registered?LIVE():{status:403,data:{error:'no',code:'not_registered'}},{me:{user,registration:saved,attendance:[],isAdmin:false},write:request=>{if(request.method==='DELETE'){registered=false;return{ok:true};}return{status:503,data:{error:'unavailable'}};}});
 const live=h.root.children[0];assert.ok(key(live,'liveNow'));
 await key(h.root,'cancel').listeners.click();await flush();
 assert.equal(paths(h).filter(path=>path==='/api/fiiu/live').length,2,'one read as the registration goes');assert.ok(key(live,'liveRegister'));
 // A redraw that changes nothing about the registration asks nothing.
 h.lang('es');await flush();assert.equal(paths(h).filter(path=>path==='/api/fiiu/live').length,2);
});

test('fiiu.html and the console load fiiu-live.js after fiiu-ui.js and before the script that mounts it, and it is served and built',()=>{
 const page=name=>readFileSync(new URL('../web/pages/'+name,import.meta.url),'utf8');
 for(const [name,mounter] of [['fiiu.html','fiiu.js'],['dashboard.html','fiiu-hubs.js']]){
  const html=page(name),scripts=[...html.matchAll(/<script\b([^>]*)\bsrc="([^"?]+)\?v=[^"]+"/g)].map(m=>({attrs:m[1],file:m[2]})),at=file=>scripts.findIndex(script=>script.file===file);
  assert.ok(at('fiiu-live.js')>at('fiiu-ui.js')&&at('fiiu-ui.js')>=0,name+': after fiiu-ui.js');assert.ok(at('fiiu-live.js')<at(mounter),name+': before '+mounter);
  assert.match(scripts[at('fiiu-live.js')].attrs,/\bdefer\b/,name);
 }
 const server=readFileSync(new URL('../server/server.js',import.meta.url),'utf8'),build=readFileSync(new URL('../scripts/build-static.js',import.meta.url),'utf8'),vercel=JSON.parse(readFileSync(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.match(server,/const STATIC_SCRIPTS = new Set\(\[[^\]]*'fiiu-live\.js'/);assert.match(build,/STATIC_SCRIPTS = \[[\s\S]*?'fiiu-live\.js'/);
 assert.ok(vercel.headers.some(route=>route.source.endsWith('.js')&&new RegExp('^'+route.source+'$').test('/fiiu-live.js')),'vercel.json caches it like the other scripts');
});

// The console's festival block (dashboard.html): fiiu-ui.js, fiiu-live.js, then fiiu-hubs.js, drawing into #fiiuDashboardBody. clock.advance moves time on.
function clock(iso){let at=Date.parse(iso);const Clock=class extends Date{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}};return{Date:Clock,advance:ms=>{at+=ms;}};}
async function consoleBlock(respond,{when=DURING}={}){
 const body=new Node('body'),widget=new Node(),requests=[],timers=[],listeners={},time=clock(when);body.append(widget);
 const document={body,visibilityState:'visible',documentElement:{lang:'en'},getElementById:id=>id==='fiiuDashboardBody'?widget:null,createElement:tag=>new Node(tag),createTextNode:value=>Object.assign(new Node('text'),{textContent:value}),querySelectorAll:selector=>body.querySelectorAll(selector),addEventListener:(type,listener)=>{(listeners[type]??=[]).push(listener);}};
 const ctx={document,window:{nodalI18n:{lang:'en',onChange(){}}},Intl,Date:time.Date,Error,AbortSignal,URL,URLSearchParams,setInterval:(callback,delay)=>timers.push({callback,delay}),clearInterval:id=>{if(timers[id-1])timers[id-1].cleared=true;},
  fetch:async path=>{requests.push(path);const result=await respond(path);return{ok:!result.status||result.status<400,status:result.status||200,json:async()=>result.data??result};}};
 vm.createContext(ctx);for(const name of ['fiiu-ui','fiiu-live','fiiu-hubs'])vm.runInContext(read(name),ctx);await flush();
 const visible=async()=>{await Promise.all((listeners.visibilitychange||[]).map(listener=>listener({type:'visibilitychange'})));await flush();};
 return{widget,requests,timers,advance:time.advance,visible,line:()=>widget.querySelector('.f-live')};
}
const feed=(me,live=()=>LIVE())=>path=>path==='/api/fiiu/live'?live():path==='/api/fiiu?kind=news'?festival():path==='/api/fiiu/registration'?me():path==='/api/fiiu/pulse'?{questions:[]}:path==='/api/admin/fiiu/summary'?{summary:{lab:{pending:0}}}:{status:404,data:{error:'not found'}};
const registered=()=>({user,registration:saved,attendance:[],isAdmin:false});

test('the console’s festival block carries one live line for a registered person: what is on, today’s check-ins, the live conversations and a way to the band',async()=>{
 const h=await consoleBlock(feed(registered));
 const line=h.line();assert.ok(line,'the line is in the block');assert.match(line.className,/\bis-compact\b/);assert.equal(line.hidden,false);
 const title=key(line,'liveTitle');assert.equal(title.tagName,'h3','under the block’s h2');assert.equal(line['aria-labelledby'],title.id);
 assert.ok(key(line,'liveNow'));const session=linkTo(line,'El poder de lo local');assert.equal(session.href,'fiiu-session.html?a=day1-am');assert.match(content(line),/09:00–13:00/);
 assert.match(content(line),/87\s+check-ins today/);assert.match(content(line),/2\s+live conversations/);
 const open=key(line,'liveOpen');assert.equal(open.tagName,'a');assert.equal(open.href,'fiiu.html#en-vivo');
 assert.equal(line.querySelectorAll('.f-live-part').length,0,'one line, not the band');assert.equal(h.requests.filter(path=>path==='/api/fiiu/live').length,1);
 // It sits with the person's status, after the next session and before the registration button.
 const order=['statusRegistered','liveTitle','viewRegistration'].map(name=>descendants(h.widget).indexOf(key(h.widget,name)));assert.deepEqual([...order].sort((a,b)=>a-b),order);
 // With nothing on now, the next session, with its day when it is another day.
 const later=await consoleBlock(feed(registered,()=>LIVE({now:null,next:{activity:activity('day2-am')}})));assert.ok(key(later.line(),'liveNext'));assert.ok(later.line().querySelector('.f-live-day'));
});

test('the console shows no live line without a registration, and no read for it; an organiser gets it, as a preview outside the dates',async()=>{
 const none=await consoleBlock(feed(()=>({user,registration:null,attendance:[],isAdmin:false})));
 assert.equal(none.requests.includes('/api/fiiu/live'),false);assert.ok(!none.line()||none.line().hidden);assert.equal(key(none.widget,'liveTitle'),undefined);
 const organiser=await consoleBlock(feed(()=>({user,registration:null,attendance:[],isAdmin:true})),{when:BEFORE});
 assert.ok(organiser.requests.includes('/api/fiiu/live'));assert.ok(key(organiser.line(),'livePreview'));
 const early=await consoleBlock(feed(registered),{when:BEFORE});assert.equal(early.requests.includes('/api/fiiu/live'),false,'a participant’s console waits for the festival');
 // An answer the person may not read draws nothing in the console.
 const refused=await consoleBlock(feed(registered,()=>({status:403,data:{error:'no',code:'not_registered'}})));assert.equal(refused.line().hidden,true);assert.equal(refused.line().children.length,0);
});

test('a background refresh of the block keeps the same live line without reading it twice, and a cancelled registration ends it',async()=>{
 let me=registered();const h=await consoleBlock(feed(()=>me));const line=h.line(),reads=()=>h.requests.filter(path=>path==='/api/fiiu/live').length;
 h.advance(16*60000);await h.visible();
 assert.equal(h.line(),line,'the same node, moved into the redrawn block');assert.equal(line.hidden,false);assert.equal(reads(),2,'only the line’s own read on return');
 me={user,registration:null,attendance:[],isAdmin:false};h.advance(16*60000);await h.visible();
 assert.equal(key(h.widget,'liveTitle'),undefined,'gone with the registration');const before=reads();await Promise.all(h.timers.filter(timer=>!timer.cleared).map(timer=>timer.callback()));assert.equal(reads(),before,'and it stops reading');
});
