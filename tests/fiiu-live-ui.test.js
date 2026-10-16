import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {FIIU_EVENT} from '../server/fiiu-domain.js';
import {createFiiuHarness,key,field,descendants,content,flush,Node} from './helpers/fiiu-ui-harness.js';

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
// Signing in from the band's line comes back to the band.
const SIGN_IN='login.html?next='+encodeURIComponent('/fiiu.html#en-vivo');
const running=h=>h.timers.filter(timer=>!timer.cleared);
const linkTo=(node,text)=>node.querySelectorAll('a').find(a=>a.textContent===text);
// fiiu-ui.js then fiiu-live.js, as the pages load them, with Fiiu.live.mount on a host of the test's own. time: a Date class (see clock) in place of when.
async function band(respond,{when=DURING,time,sessionLink,...options}={}){
 const h=await createFiiuHarness(request=>request.path==='/api/fiiu/live'?respond(request):{status:404,data:{error:'not found'}},{page:'fiiu-live',context:{Date:time||frozen(when)}});
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
 // A guest the page knows (known: 401), and an account the server finds without a registration (403).
 for(const [status,options] of [[401,{known:()=>401}],[403,{}]]){
  const h=await band(()=>({status,data:{error:'no',code:status===403?'not_registered':undefined}}),options);
  assert.equal(h.host.hidden,false);const line=h.host.querySelector('.f-live-prompt');assert.ok(line);
  const go=key(line,'liveRegister');assert.equal(go.tagName,'a');assert.equal(go.href,'#registration');
  assert.equal(h.host.querySelectorAll('.f-live-part').length,0);assert.equal(running(h).length,0,'no refresh without access');
  h.lang('es');assert.equal(key(line,'liveRegister').textContent,'Inscríbete para ver el FIIU en vivo');
  const compact=await band(()=>({status,data:{error:'no'}}),{compact:true,...options});assert.equal(compact.host.hidden,true);assert.equal(compact.host.children.length,0);assert.equal(running(compact).length,0);
 }
 // Once registration closes, a guest is asked to sign in with a registered account, and a signed-in one without a registration sees nothing.
 const guest=await band(()=>LIVE(),{registrationOpen:false,known:()=>401});assert.equal(key(guest.host,'liveSignIn').href,SIGN_IN);assert.equal(key(guest.host,'liveRegister'),undefined);
 const member=await band(()=>({status:403,data:{error:'no',code:'not_registered'}}),{registrationOpen:false});assert.equal(member.host.hidden,true);
});

test('a 401 the page did not expect (a session that ended, a sign-out in another tab) asks to sign in again and come back to the band, not to register',async()=>{
 for(const registrationOpen of [true,false]){
  const h=await band(()=>({status:401,data:{error:'sign in required'}}),{registrationOpen});
  const go=key(h.host,'liveSignIn');assert.ok(go,String(registrationOpen));assert.equal(go.tagName,'a');assert.equal(go.href,SIGN_IN);assert.equal(key(h.host,'liveRegister'),undefined);assert.equal(running(h).length,0);
 }
 // fiiu.html: a registered person's page, whose panel still shows the registration, gets 401 from the live read.
 const page=await festivalPage(()=>({status:401,data:{error:'sign in required'}}),{me:{user,registration:saved,attendance:[],isAdmin:false}});
 const line=byId(page.root,'en-vivo');assert.ok(page.root.querySelector('.f-saved'),'the panel shows the registration');
 assert.equal(key(line,'liveSignIn').href,SIGN_IN);assert.equal(key(line,'liveRegister'),undefined);
 page.lang('es');assert.equal(key(line,'liveSignIn').textContent,'Inicia sesión con tu cuenta inscrita para ver el FIIU en vivo');
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
 // No block named on the 21st: the festival is not over, the closing party is still to come.
 answer=LIVE({conversations:[],now:null,next:null});await h.tickTimers();await flush();assert.equal(key(h.host,'liveDone'),undefined);assert.ok(linkTo(h.host,activity('closing-party').title));
});

test('the band never announces its refreshes: no live region anywhere in it',async()=>{
 for(const answer of [()=>LIVE(),()=>({status:403,data:{error:'no'}})]){
  const h=await band(answer);await h.tickTimers();await flush();
  for(const node of [h.host,...descendants(h.host)]){assert.equal(node['aria-live'],undefined,node.tagName);assert.ok(!['status','alert','log'].includes(node.role),node.tagName);assert.notEqual(node.getAttribute('role'),'status');}
 }
});

test('a newest answer from another day carries its day before its time, also once midnight passes in Lima',async()=>{
 const talk=LIVE().conversations[0],yesterday={...talk,latest:{...talk.latest,createdAt:'2026-10-21T03:40:00.000Z'}},time=clock(DURING);
 const h=await band(()=>LIVE({conversations:[yesterday,{...talk,questionId:Q3}]}),{time:time.Date}),said=()=>h.host.querySelectorAll('.f-live-latest');
 const [old,fresh]=said(),day=old.querySelector('.f-live-day');
 assert.ok(day,'22:40 the evening before is not 22:40 today');assert.equal(day.dataset.fiiuDate,'2026-10-20');assert.equal(old.querySelector('.f-live-at').textContent,'22:40');
 assert.ok(old.children.indexOf(day)<old.children.indexOf(old.querySelector('.f-live-at')),'the day comes before the time');
 assert.equal(fresh.querySelector('.f-live-day'),null,'an answer from today shows its time alone');
 // 00:30 on 22 Oct: the answer of 10:28 is yesterday's now.
 time.advance(14*3600000);await h.tickTimers();await flush();assert.equal(said()[1].querySelector('.f-live-day')?.dataset.fiiuDate,'2026-10-21');
});

test('the band builds its links with Fiiu.sessionLink when the page has it',async()=>{
 const h=await band(()=>LIVE(),{sessionLink:(activityId,questionId)=>'session/'+activityId+(questionId?'/'+questionId:'')});
 assert.equal(linkTo(h.host,'El poder de lo local').href,'session/day1-am');assert.equal(linkTo(h.host,'¿Qué te llevas de esta charla?').href,'session/day1-am/'+Q1);
});

// fiiu.html: fiiu-ui.js, fiiu-live.js, then fiiu.js, which mounts the band once it knows who is reading.
const user={id:'00000000-0000-4000-8000-000000000001',email:'ana@example.test',name:'Ana Test',city:'Lima'};
const answers={firstName:'Ana',lastName:'Test',country:'Perú',city:'Lima',profile:'professional',publicOfficial:false,applyLab:false,activities:['day1-am'],externalActivities:[],gender:'prefer_not',age:30,accessibility:['none'],motivation:'learn',previousAttendance:'no',privacyAccepted:true};
const saved={userId:user.id,id:'00000000-0000-4000-8000-000000000002',version:1,email:user.email,answers,labStatus:'none'};
const festival=(config={},content=[])=>({event:FIIU_EVENT,config:{registrationOpen:true,programUrl:'https://canva.link/ficmkatcg9fudwk',...config},content,nextCursor:null});
// content: the feed's items; context adds globals of the page: the address (location, see at), sessionStorage, scrollTo and navigation timing for Back and reload.
async function festivalPage(liveRead,{me=null,when=DURING,config,content,write=()=>({status:503,data:{error:'unavailable'}}),context={}}={}){
 const h=await createFiiuHarness(request=>request.method!=='GET'?write(request):request.path==='/api/fiiu/live'?liveRead(request):request.path.startsWith('/api/fiiu?kind=')?festival(config,content):request.path==='/api/fiiu/pulse'?{questions:[]}:request.path==='/api/fiiu/registration'?(me||{status:401,data:{error:'sign in required'}}):{status:404,data:{error:'not found'}},{page:'fiiu-live',context:{Date:frozen(when),...context}});
 vm.runInContext(read('fiiu'),h.ctx);await flush();return h;
}
const paths=h=>h.requests.map(request=>request.path);
const at=hash=>({location:{hash,search:'',pathname:'/fiiu.html'}});
// A live read that answers when the test says so (after the page has landed); the reads after it answer the same at once.
const later=()=>{let answer,given;const first=new Promise(resolve=>{answer=resolve;});return{read:()=>given??first,answer:value=>{given=value;answer(value);}};};
// Records the nodes scrollIntoView lands on, and lets document.querySelector find a node by its id as a browser does (as tests/fiiu-ui.test.js does).
function watchScrolls(){
 const seen=[],{scrollIntoView,querySelectorAll}=Node.prototype;
 Node.prototype.scrollIntoView=function(){seen.push(this);};
 Node.prototype.querySelectorAll=function(selector){return /^#[\w-]+$/.test(selector)?descendants(this).filter(node=>node.id===selector.slice(1)):querySelectorAll.call(this,selector);};
 return{seen,restore(){Node.prototype.scrollIntoView=scrollIntoView;Node.prototype.querySelectorAll=querySelectorAll;}};
}
const byId=(node,id)=>descendants(node).find(child=>child.id===id);

test('the festival page carries the band under its hero, as #en-vivo, read once the registration is known',async()=>{
 const news=[{id:'n1',kind:'news',title:'Cambio de sala para el bloque del jueves',body:'Sala B',url:'',createdAt:'2026-10-20T12:00:00.000Z'}];
 const h=await festivalPage(()=>LIVE(),{me:{user,registration:saved,attendance:[],isAdmin:true},content:news});
 const live=byId(h.root,'en-vivo');assert.equal(live.tagName,'section');assert.match(live.className,/\bf-live\b/);assert.equal(live.hidden,false);assert.ok(key(live,'liveNow'));
 // The page's title comes first: the hero (with the h1), the organiser link and the latest news under it, the band, then the programme and the panel.
 const part=node=>/\bf-hero\b/.test(node.className)?'hero':node.dataset.fiiuText==='admin'?'admin':/\bf-latest\b/.test(node.className)?'latest':node===live?'band':/\bf-layout\b/.test(node.className)?'layout':null;
 assert.deepEqual(h.root.children.map(part).filter(Boolean),['hero','admin','latest','band','layout']);
 assert.deepEqual(descendants(h.root).filter(node=>/^h[12]$/.test(node.tagName)).map(node=>node.tagName).slice(0,2),['h1','h2'],'headings in order: the page’s h1, then the band’s h2');
 assert.ok(paths(h).indexOf('/api/fiiu/live')>paths(h).indexOf('/api/fiiu/registration'),'the band waits for the registration read');assert.equal(paths(h).filter(path=>path==='/api/fiiu/live').length,1);
 // A guest during the festival sees the one line, pointing to the registration panel; once registration closes, to sign in.
 const guest=await festivalPage(()=>({status:401,data:{error:'sign in required'}}));assert.ok(key(byId(guest.root,'en-vivo'),'liveRegister'));
 const closed=await festivalPage(()=>({status:401,data:{error:'sign in required'}}),{config:{registrationOpen:false}});assert.ok(key(byId(closed.root,'en-vivo'),'liveSignIn'));
 // Before the festival a participant's page does not ask; an organiser's shows the preview.
 const early=await festivalPage(()=>LIVE(),{me:{user,registration:saved,attendance:[],isAdmin:false},when:BEFORE});assert.equal(paths(early).includes('/api/fiiu/live'),false);assert.equal(byId(early.root,'en-vivo').hidden,true);
 const organiser=await festivalPage(()=>LIVE(),{me:{user,registration:null,attendance:[],isAdmin:true},when:BEFORE});assert.ok(key(byId(organiser.root,'en-vivo'),'livePreview'));
});

test('cancelling or saving a registration on the page brings the band in step at once',async()=>{
 let registered=true;
 const h=await festivalPage(()=>registered?LIVE():{status:403,data:{error:'no',code:'not_registered'}},{me:{user,registration:saved,attendance:[],isAdmin:false},write:request=>{if(request.method==='DELETE'){registered=false;return{ok:true};}return{status:503,data:{error:'unavailable'}};}});
 const live=byId(h.root,'en-vivo');assert.ok(key(live,'liveNow'));
 await key(h.root,'cancel').listeners.click();await flush();
 assert.ok(key(live,'liveRegister'),'the band gives way to the line as the registration goes');assert.equal(paths(h).filter(path=>path==='/api/fiiu/live').length,1,'the page knows the answer, so it does not ask');
 assert.equal(h.timers.filter(timer=>!timer.cleared&&timer.delay===30000).length,0,'and the band stops reading');
 // A redraw that changes nothing about the registration asks nothing.
 h.lang('es');await flush();assert.equal(paths(h).filter(path=>path==='/api/fiiu/live').length,1);
});

test('a guest’s page and an unregistered account’s page show the line without asking the server',async()=>{
 const guest=await festivalPage(()=>({status:401,data:{error:'sign in required'}}));assert.ok(key(byId(guest.root,'en-vivo'),'liveRegister'));assert.equal(paths(guest).includes('/api/fiiu/live'),false);
 const member=await festivalPage(()=>({status:403,data:{error:'no'}}),{me:{user,registration:null,attendance:[],isAdmin:false}});assert.ok(key(byId(member.root,'en-vivo'),'liveRegister'));assert.equal(paths(member).includes('/api/fiiu/live'),false);
 // A registration read that failed knows nothing: the band asks.
 const unknown=await festivalPage(()=>LIVE(),{me:{status:503,data:{error:'unavailable'}}});assert.ok(paths(unknown).includes('/api/fiiu/live'));assert.ok(key(byId(unknown.root,'en-vivo'),'liveNow'));
 // The module side: known() is asked at every read, so access granted later (a registration saved on the page) reads at once.
 let known=403;const h=await band(()=>LIVE(),{known:()=>known});assert.equal(reads(h),0);assert.ok(key(h.host,'liveRegister'));
 known=null;await h.live.refresh();await flush();assert.equal(reads(h),1);assert.ok(key(h.host,'liveNow'));
});

test('the band tells its page when it first draws (the band, its line or nothing), once, and not for a read that failed',async()=>{
 let calls=0,fail=true;const h=await band(()=>fail?{status:503,data:{error:'unavailable'}}:LIVE(),{onFirstDraw:()=>{calls++;}});
 assert.equal(calls,0,'a failed read draws nothing');
 fail=false;await h.tickTimers();await flush();assert.equal(h.host.hidden,false);assert.equal(calls,1);
 await h.tickTimers();await flush();h.lang('es');assert.equal(calls,1,'once: refreshes and a language switch are not a first draw');
 for(const [name,respond,options] of [['refused',()=>({status:403,data:{error:'no'}}),{}],['inactive',()=>({active:false,generatedAt:DURING}),{}],['known guest',()=>LIVE(),{known:()=>401}],['before the festival',()=>LIVE(),{when:BEFORE}]]){
  let n=0;await band(respond,{...options,onFirstDraw:()=>{n++;}});assert.equal(n,1,name);
 }
 // A band stopped before its read answers never reports.
 let n=0,finish;const stopped=await band(()=>new Promise(resolve=>{finish=resolve;}),{onFirstDraw:()=>{n++;}});stopped.live.stop();finish(LIVE());await flush();assert.equal(n,0);
});

test('a link that lands on the panel, a block to add, the programme or the saved place lands there again once the band first draws above it, unless the reader has moved',async()=>{
 // only(node): for each scroll so far, whether it landed on that node.
 const scrolls=watchScrolls(),registered={user,registration:saved,attendance:[],isAdmin:false},only=node=>scrolls.seen.map(seen=>seen===node);
 try{
  // "Ver mi inscripción" in the console: the panel once the registration is drawn, and again once the band has moved it down. A refresh never scrolls.
  let live=later();const h=await festivalPage(live.read,{me:registered,context:at('#registration')});
  const panel=byId(h.root,'registration');assert.deepEqual(only(panel),[true]);assert.equal(byId(h.root,'en-vivo').hidden,true);
  live.answer(LIVE());await flush();assert.equal(byId(h.root,'en-vivo').hidden,false);assert.deepEqual(only(panel),[true,true]);
  await h.tickTimers();await flush();assert.equal(scrolls.seen.length,2,'a refresh never scrolls');
  // The check-in refusal's "Añadir a mi inscripción": the block's box, ticked and focused, comes back into view, focused.
  scrolls.seen.length=0;live=later();const add=await festivalPage(live.read,{me:registered,context:at('#add-day1-pm')});
  const box=descendants(add.root).find(node=>node.name==='activities'&&node.value==='day1-pm');assert.equal(box.checked,true);assert.equal(box.focused,true);assert.deepEqual(only(box),[true]);
  box.focused=false;live.answer(LIVE());await flush();assert.deepEqual(only(box),[true,true]);assert.equal(box.focused,true);assert.equal(box.checked,true);
  // The programme: once at once, once after the registration redraw, once after the band.
  scrolls.seen.length=0;live=later();const programme=await festivalPage(live.read,{me:registered,context:at('#programme')});
  const target=byId(programme.root,'programme');assert.deepEqual(only(target),[true,true]);live.answer(LIVE());await flush();assert.deepEqual(only(target),[true,true,true]);
  // Back or a reload: the saved place again, instantly.
  const storage=new Map([['fiiu.place:/fiiu.html','2080']]),places=[];live=later();
  await festivalPage(live.read,{me:registered,context:{...at(''),sessionStorage:{getItem:name=>storage.get(name)??null,setItem:(name,value)=>storage.set(name,String(value)),removeItem:name=>storage.delete(name)},scrollTo:options=>places.push({...options}),performance:{getEntriesByType:kind=>kind==='navigation'?[{type:'reload'}]:[]}}});
  assert.deepEqual(places,[{top:2080,behavior:'instant'}]);live.answer(LIVE());await flush();assert.deepEqual(places,[{top:2080,behavior:'instant'},{top:2080,behavior:'instant'}]);
  // Someone who scrolled, tapped or typed before the band came stays where they went.
  for(const type of ['wheel','touchstart','pointerdown','keydown']){
   scrolls.seen.length=0;live=later();const moved=await festivalPage(live.read,{me:registered,context:at('#registration')});
   for(const listener of moved.windowListeners[type]||[])listener({type});live.answer(LIVE());await flush();assert.equal(scrolls.seen.length,1,type);
  }
  // A band that stays hidden moves nothing, so nothing lands again; nor does a page opened without a place to land.
  scrolls.seen.length=0;live=later();await festivalPage(live.read,{me:registered,context:at('#registration')});live.answer({active:false,generatedAt:DURING});await flush();assert.equal(scrolls.seen.length,1);
  scrolls.seen.length=0;live=later();await festivalPage(live.read,{me:registered,context:at('')});live.answer(LIVE());await flush();assert.equal(scrolls.seen.length,0);
 }finally{scrolls.restore();}
});

test('a link to the band (the console’s “Ver en vivo”) lands on it once it shows, the line a guest sees included',async()=>{
 const scrolls=watchScrolls();
 try{
  const live=later(),h=await festivalPage(live.read,{me:{user,registration:saved,attendance:[],isAdmin:false},context:at('#en-vivo')}),strip=byId(h.root,'en-vivo');
  assert.equal(scrolls.seen.includes(strip),false,'not while it is hidden');
  live.answer(LIVE());await flush();assert.deepEqual(scrolls.seen.map(node=>node===strip),[true]);
  scrolls.seen.length=0;const guest=await festivalPage(()=>({status:401,data:{error:'sign in required'}}),{context:at('#en-vivo')});
  assert.ok(key(byId(guest.root,'en-vivo'),'liveRegister'));assert.equal(scrolls.seen.at(-1),byId(guest.root,'en-vivo'));
  // Without the band (an inactive answer) the page stays at the top.
  scrolls.seen.length=0;await festivalPage(()=>({active:false,generatedAt:DURING}),{me:{user,registration:saved,attendance:[],isAdmin:false},context:at('#en-vivo')});assert.equal(scrolls.seen.length,0);
 }finally{scrolls.restore();}
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
// Registered for day2-am only, so the block's "next for you" is not the session under way.
const elsewhere=()=>({user,registration:{...saved,answers:{...answers,activities:['day2-am']}},attendance:[],isAdmin:false});

test('the console’s festival block carries one live line for a registered person: what is on, today’s check-ins, the live conversations and a way to the band',async()=>{
 const h=await consoleBlock(feed(elsewhere));
 const line=h.line();assert.ok(line,'the line is in the block');assert.match(line.className,/\bis-compact\b/);assert.equal(line.hidden,false);
 const title=key(line,'liveTitle');assert.equal(title.tagName,'h3','under the block’s h2');
 // The line's host is a plain div, which may not carry a label (ARIA 1.2 prohibits aria-labelledby on the generic role); its h3 names it.
 assert.equal(line.tagName,'div');assert.equal(line['aria-labelledby'],undefined);assert.equal(line.role,undefined);
 assert.ok(key(line,'liveNow'));const session=linkTo(line,'El poder de lo local');assert.equal(session.href,'fiiu-session.html?a=day1-am');assert.match(content(line),/09:00–13:00/);
 assert.match(content(line),/87\s+check-ins today/);assert.match(content(line),/2\s+live conversations/);
 const open=key(line,'liveOpen');assert.equal(open.tagName,'a');assert.equal(open.href,'fiiu.html#en-vivo');
 assert.equal(line.querySelectorAll('.f-live-part').length,0,'one line, not the band');assert.equal(h.requests.filter(path=>path==='/api/fiiu/live').length,1);
 // The status keeps its button and the General link; the line follows as its own group under its h3, before the badges and their heading.
 const general=await consoleBlock(path=>path==='/api/fiiu/pulse'?{questions:[['eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01','general',1,'open']]}:feed(elsewhere)(path));
 const order=['statusRegistered','nextForYou','viewRegistration','talkGeneral','liveTitle','badges'].map(name=>descendants(general.widget).indexOf(key(general.widget,name)));
 assert.ok(order.every(at=>at>=0),JSON.stringify(order));assert.deepEqual([...order].sort((a,b)=>a-b),order);
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

test('the three most active conversations show; the rest fold under one control that stays open across refreshes',async()=>{
 const talk=(n,over={})=>({...LIVE().conversations[0],questionId:'dddddddd-dddd-4ddd-8ddd-dddddddddd'+String(n).padStart(2,'0'),body:'Pregunta '+n,...over});
 let answer=LIVE({conversations:[1,2,3,4,5].map(n=>talk(n))});const h=await band(()=>answer);
 const list=h.host.querySelector('.f-live-talk-list'),more=h.host.querySelector('.f-live-more');
 assert.equal(list.children.filter(node=>node.tagName==='li').length,3);assert.ok(more);assert.equal(more.tagName,'details');assert.ok(!more.open,'folded at first');
 assert.equal(more.querySelector('summary').textContent,'2 more conversations');assert.deepEqual(more.querySelectorAll('.f-live-talk').map(item=>item.querySelector('a').textContent),['Pregunta 4','Pregunta 5']);
 assert.equal(linkTo(more,'Pregunta 5').href,'fiiu-session.html?a=day1-am&q='+talk(5).questionId);
 more.open=true;answer=LIVE({conversations:[talk(6),...[1,2,3,4].map(n=>talk(n))]});await h.tickTimers();await flush();
 assert.equal(h.host.querySelector('.f-live-more').open,true,'a reader who opened it keeps it open');assert.equal(h.host.querySelector('.f-live-talk-list').querySelector('a').textContent,'Pregunta 6');
 h.lang('es');assert.equal(h.host.querySelector('.f-live-more').querySelector('summary').textContent,'2 conversaciones más');
 answer=LIVE({conversations:[1,2,3,4].map(n=>talk(n))});await h.tickTimers();await flush();assert.equal(h.host.querySelector('.f-live-more').querySelector('summary').textContent,'1 conversación más');
 answer=LIVE();await h.tickTimers();await flush();assert.equal(h.host.querySelector('.f-live-more'),null,'three or fewer: nothing to fold');
});

test('the console line counts every open conversation, past the five the live read lists, from the public pulse',async()=>{
 const talk=n=>({...LIVE().conversations[0],questionId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee'+String(n).padStart(2,'0'),body:'Pregunta '+n});
 // The pulse lists every question that is not hidden: n open ones (one of them General) and a closed one.
 const pulseOf=n=>({questions:[...Array.from({length:n},(_,i)=>[talk(i+1).questionId,i?'day1-am':'general',i+1,'open']),['ffffffff-ffff-4fff-8fff-ffffffffffff','day2-am',20,'closed']]});
 let questions=pulseOf(7),listed=[1,2,3,4,5];
 const h=await consoleBlock(path=>path==='/api/fiiu/pulse'?questions:feed(elsewhere,()=>LIVE({conversations:listed.map(talk)}))(path));
 const pulses=()=>h.requests.filter(path=>path==='/api/fiiu/pulse').length,tick=async()=>{await Promise.all(h.timers.filter(timer=>!timer.cleared).map(timer=>timer.callback()));await flush();};
 assert.match(content(h.line()),/7\s+live conversations/);assert.equal(pulses(),1,'the first count shares the block’s own pulse read');
 questions=pulseOf(6);await tick();assert.match(content(h.line()),/6\s+live conversations/,'each refresh at the cap reads it again');assert.equal(pulses(),2);
 // A pulse that fails or lags never counts fewer than the live read lists.
 questions={status:503,data:{error:'unavailable'}};await tick();assert.match(content(h.line()),/6\s+live conversations/,'a failed pulse keeps the count shown');
 questions=pulseOf(3);await tick();assert.match(content(h.line()),/5\s+live conversations/);
 // Below the cap the list is the whole count, and the pulse is not read for it.
 listed=[1,2];const before=pulses();await tick();assert.match(content(h.line()),/2\s+live conversations/);assert.equal(pulses(),before);
 // Back at the cap later, the pulse is read fresh, not taken from when the block was drawn.
 listed=[1,2,3,4,5];questions=pulseOf(8);await tick();assert.match(content(h.line()),/8\s+live conversations/);assert.equal(pulses(),before+1);
});

test('the console line does not repeat the session the block already names as the person’s next; it names the festival’s next one instead',async()=>{
 // Ana's plan has day1-am, under way at 10:30: the block already says so, so the live line moves on to day1-pm.
 const h=await consoleBlock(feed(registered));const line=h.line();
 assert.match(content(key(h.widget,'nextForYou').parent),/El poder de lo local/);
 assert.equal(linkTo(line,'El poder de lo local'),undefined);assert.ok(key(line,'liveNext'));assert.equal(linkTo(line,activity('day1-pm').title).href,'fiiu-session.html?a=day1-pm');
 // With no other block named by the server, the line moves on to the programme's next timed item (the closing party), and keeps its counts and its way to the band.
 const only=await consoleBlock(feed(registered,()=>LIVE({next:null})));assert.equal(key(only.line(),'liveNow'),undefined);assert.equal(key(only.line(),'liveDone'),undefined);assert.ok(linkTo(only.line(),activity('closing-party').title));assert.match(content(only.line()),/87\s+check-ins today/);assert.ok(key(only.line(),'liveOpen'));
 // Someone whose plan has another block sees the session under way.
 const other=await consoleBlock(feed(elsewhere));assert.ok(linkTo(other.line(),'El poder de lo local'));
});

// The server names check-in blocks only; the last, day3-am, ends on 23 Oct at 13:00, and the routes (24–25 Oct) and the closing party (25 Oct from 17:00) follow.
test('after the last conference the band and the console line name the closing party, never that the festival’s sessions are over while anything is to come',async()=>{
 const party=activity('closing-party'),empty=()=>LIVE({now:null,next:null}),SATURDAY_MORNING='2026-10-24T16:00:00.000Z';
 // Saturday 24 Oct, 11:00 in Lima: the party is next that evening, shown by its start.
 const h=await band(empty,{when:SATURDAY_MORNING}),when=h.host.querySelector('.f-live-when');
 assert.equal(key(h.host,'liveDone'),undefined);assert.ok(key(when,'liveNext'));assert.equal(linkTo(when,party.title).href,'fiiu-session.html?a=closing-party');
 assert.equal(when.querySelector('.f-live-day'),null,'the party is that same Saturday, so only its start shows');assert.equal(when.querySelector('.f-live-time')?.dataset.fiiuTime,'17:00');
 // The console line too; for someone the block already tells about the party, the line keeps its counts and says nothing about the sessions.
 const line=await consoleBlock(feed(registered,empty),{when:SATURDAY_MORNING});assert.equal(key(line.line(),'liveDone'),undefined);assert.ok(linkTo(line.line(),party.title));
 const going=()=>({user,registration:{...saved,answers:{...answers,activities:['day1-am','closing-party']}},attendance:[],isAdmin:false});
 const own=await consoleBlock(feed(going,empty),{when:SATURDAY_MORNING});assert.equal(key(own.line(),'liveDone'),undefined);assert.equal(linkTo(own.line(),party.title),undefined);assert.match(content(own.line()),/87\s+check-ins today/);
 // 24 Oct, 18:00: the party is under way. It takes no check-in, so no count is shown for it.
 const on=await band(empty,{when:'2026-10-24T23:00:00.000Z'}),now=on.host.querySelector('.f-live-when');
 assert.ok(key(now,'liveNow'));assert.ok(linkTo(now,party.title));assert.equal(now.querySelector('.f-live-count'),null);assert.equal(key(on.host,'liveDone'),undefined);
 // A server's next block still comes first when it starts before the party.
 const lab=await band(()=>LIVE({now:null,next:{activity:activity('day2-am')}}));assert.ok(linkTo(lab.host,activity('day2-am').title));assert.equal(linkTo(lab.host,party.title),undefined);
 // Only routes left, none of them timed: nothing to name as now or next, and still no "over".
 const routesOnly={...FIIU_EVENT,activities:FIIU_EVENT.activities.filter(a=>a.id!=='closing-party')};
 const routes=await band(empty,{when:SATURDAY_MORNING,event:routesOnly});assert.equal(key(routes.host,'liveDone'),undefined);assert.equal(routes.host.querySelector('.f-live-when'),null);assert.ok(routes.host.querySelector('.f-live-talks'));
 // Once the last item is over (an organiser's preview the day after), the band says so.
 const after=await band(empty,{when:'2026-10-26T15:00:00.000Z',organiser:true});assert.ok(key(after.host,'liveDone'));
 const afterLine=await consoleBlock(feed(()=>({user,registration:null,attendance:[],isAdmin:true}),empty),{when:'2026-10-26T15:00:00.000Z'});assert.ok(key(afterLine.line(),'liveDone'));
});

// document.activeElement as a browser keeps it: the node focused last while it is still in the page, else the body; contains() as the DOM answers it.
function watchFocus(h){
 let active=null;const {focus}=Node.prototype;
 Node.prototype.focus=function(...args){focus.apply(this,args);active=this;};
 Node.prototype.contains=function(node){return node===this||descendants(this).includes(node);};
 Object.defineProperty(h.ctx.document,'activeElement',{configurable:true,get:()=>active&&descendants(h.body).includes(active)?active:h.body});
 return{restore(){Node.prototype.focus=focus;delete Node.prototype.contains;}};
}

test('a new answer in a listed conversation changes its line in place, and a redraw gives focus back to the folded conversations’ control',async()=>{
 const talk=(n,over={})=>({...LIVE().conversations[0],questionId:'dddddddd-dddd-4ddd-8ddd-dddddddddd'+String(n).padStart(2,'0'),body:'Pregunta '+n,...over});
 let answer=LIVE({conversations:[1,2,3,4,5].map(n=>talk(n))});const h=await band(()=>answer),focus=watchFocus(h);
 try{
  const more=h.host.querySelector('.f-live-more'),summary=more.querySelector('summary'),first=linkTo(h.host,'Pregunta 1');more.open=true;summary.focus();
  // Beto answers the first question: its newest line changes where it is, so the links, the fold and the focus on its control stay put.
  answer=LIVE({conversations:[talk(1,{messageCount:13,latest:{author:'Beto R.',body:'Más árboles en la avenida.',likeCount:0,createdAt:'2026-10-21T15:30:10.000Z'}}),...[2,3,4,5].map(n=>talk(n))]});
  await h.tickTimers();await flush();
  assert.equal(linkTo(h.host,'Pregunta 1'),first,'the same link');assert.equal(h.host.querySelector('.f-live-more'),more,'the same fold');assert.equal(h.ctx.document.activeElement,summary,'focus stays on its control');
  assert.match(content(first.parent),/Beto R\./);assert.match(content(first.parent),/Más árboles en la avenida\./);assert.match(content(first.parent),/13\s+answers/);
  // A conversation that joins the list rebuilds it: focus comes back to the new control, which stays open.
  answer=LIVE({conversations:[talk(6),...[1,2,3,4].map(n=>talk(n))]});await h.tickTimers();await flush();
  const again=h.host.querySelector('.f-live-more');assert.notEqual(again,more);assert.equal(again.open,true);assert.equal(h.ctx.document.activeElement,again.querySelector('summary'));
 }finally{focus.restore();}
});

// The content under the band as a browser lays it out: base px from the viewport top plus the band's height (10 px a node, nothing while hidden). A browser
// with scroll anchoring (anchored) moves the page itself, so that content stays where it was. scrolls: the page moves the band asks for.
function underBand(h,{base=-2000,anchored=false}={}){
 const below=new Node('div'),scrolls=[],height=()=>h.host.hidden?0:descendants(h.host).length*10,start=height();h.host.nextElementSibling=below;
 below.getBoundingClientRect=()=>({top:base+(anchored?start:height())});h.ctx.window.scrollBy=options=>scrolls.push({...options});return{scrolls,height};
}

test('when the band grows, shrinks or goes above where the person is reading, the page moves with it on a browser that does not keep the place itself',async()=>{
 // Safari on iPhone has no scroll anchoring: someone reading the panel far below the band's one line sees it become the whole band.
 let known=403,active=true;const h=await band(()=>active?LIVE():{active:false,generatedAt:DURING},{known:()=>known}),page=underBand(h),line=page.height();
 known=null;await h.live.refresh();await flush();const full=page.height();assert.ok(full>line);
 assert.deepEqual(page.scrolls,[{top:full-line,behavior:'instant'}],'down by as much as the band grew');
 active=false;await h.tickTimers();await flush();assert.deepEqual(page.scrolls.at(-1),{top:-full,behavior:'instant'},'and back up when it goes');
 // A browser that keeps the place itself (scroll anchoring) is left to it; so is a reader above the band or looking at it.
 for(const options of [{anchored:true},{base:120}]){
  let refused=403;const other=await band(()=>LIVE(),{known:()=>refused}),seen=underBand(other,options);refused=null;await other.live.refresh();await flush();assert.deepEqual(seen.scrolls,[],JSON.stringify(options));
 }
});

test('after saving a first registration on the festival page, the confirmation comes back into view once the band has drawn above it, unless the person has moved',async()=>{
 const fill=form=>{for(const input of descendants(form).filter(node=>node.name)){const value={...answers,nationalId:'TEST123'}[input.name];if(value!==undefined){if(input.type==='checkbox')input.checked=Array.isArray(value)?value.includes(input.value):value===true;else input.value=String(value);}}field(form,'publicOfficial').value='no';};
 const scrolls=watchScrolls();
 try{
  for(const moved of [false,true]){
   const live=later(),h=await festivalPage(live.read,{me:{user,registration:null,attendance:[],isAdmin:false},write:()=>({status:200,data:{registration:saved}})}),focus=watchFocus(h);
   try{
   assert.ok(key(byId(h.root,'en-vivo'),'liveRegister'));const form=h.root.querySelector('form');fill(form);
   await form.listeners.submit({preventDefault(){}});const confirmation=h.root.querySelector('.f-saved');assert.equal(confirmation.focused,true);
   // The band reads now that the person may: it draws above the panel once its answer comes.
   scrolls.seen.length=0;if(moved)for(const listener of h.windowListeners.touchstart||[])listener({type:'touchstart'});
   live.answer(LIVE());await flush();assert.ok(key(byId(h.root,'en-vivo'),'liveNow'));
   assert.deepEqual(scrolls.seen.map(node=>node===confirmation),moved?[]:[true],moved?'someone who moved stays where they went':'the confirmation again');
   }finally{focus.restore();}
  }
 }finally{scrolls.restore();}
});

test('the band’s session titles and questions read as links: underlined like the page’s other text links, thicker on hover',()=>{
 const css=readFileSync(new URL('../web/styles/fiiu.css',import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,''),rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([,list,body])=>({list:list.trim(),body}));
 const body=selector=>rules.filter(rule=>rule.list.split(/,(?![^()]*\))/).includes(selector)).map(rule=>rule.body).join(';');
 for(const name of ['.f-live-session-title','.f-live-question']){
  assert.match(body('.f-shell '+name),/text-decoration:underline;text-decoration-thickness:1px/,name);
  assert.ok(rules.some(rule=>/^\.f-shell :is\([^)]*\)(:hover)$/.test(rule.list)&&rule.list.includes(name)&&/text-decoration-thickness:2px/.test(rule.body)),name+' on hover');
 }
});
