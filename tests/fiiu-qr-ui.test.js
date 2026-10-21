import test from 'node:test';
import assert from 'node:assert/strict';
import {FIIU_EVENT} from '../server/fiiu-domain.js';
import {createFiiuHarness,key,descendants,content,flush} from './helpers/fiiu-ui-harness.js';
import {readFileSync} from 'node:fs';

// A 21-module grid: the whole first row dark and the bottom-right module dark, packed row-major, most significant bit first.
function bits(size,dark){const bytes=Buffer.alloc(Math.ceil(size*size/8));for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(dark(x,y)){const i=y*size+x;bytes[i>>3]|=0x80>>(i&7);}return bytes.toString('base64');}
const qr={size:21,bits:bits(21,(x,y)=>y===0||(x===20&&y===20))};
const later=new Date(Date.now()+5*60000).toISOString(),earlier=new Date(Date.now()-60000).toISOString();
const screen=(extra={})=>({activityId:'day1-am',url:'https://nodal.example/fiiu-checkin.html?a=day1-am&c=Ab3dEf6hIj9kLm2nOp5qRs',code:'Ab3dEf6hIj9kLm2nOp5qRs',shortCode:'K7M4PX',rotatesAt:later,validUntil:later,window:{closesAt:'2026-10-21T18:30:00.000Z',open:true},checkedIn:12,qr,...extra});
// A clock frozen at one Lima moment, for the page and the formatters alike.
const frozen=iso=>{const at=Date.parse(iso);return class extends Date{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}};};
async function page(answer,{search='?a=day1-am',now}={}){
 return createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?{event:FIIU_EVENT,config:{registrationOpen:true},content:[],nextCursor:null}:answer(request),{page:'fiiu-qr',search,...(now?{context:{Date:frozen(now)}}:{})});
}
const TEST_WORDING=/rehears|organi[sz]er test|nothing was recorded|not opened yet|aún no está abierto|ainda não abriu/i;
const reads=h=>h.requests.filter(request=>request.path.startsWith('/api/admin/fiiu/checkin')).length;

test('without a block the page lists the NODAL blocks by day, each opening its own screen, and nothing for workshops or routes',async()=>{
 const h=await page(()=>assert.fail('the list needs no organiser data'),{search:''});
 assert.ok(key(h.root,'qrTitle'));const rows=h.root.querySelectorAll('.f-qr-row');
 assert.deepEqual(rows.map(row=>key(row,'openCheckinScreen').href),['day0-lab','day1-am','day1-pm','day2-am','day2-pm','day3-am'].map(id=>'fiiu-qr.html?a='+id));
 assert.doesNotMatch(content(h.root),/Calles para la gente|Lima cromática/);assert.equal(h.requests.length,1);
 assert.match(content(rows[1]),/13:30/);assert.doesNotMatch(content(rows[1]),/08:30/,'no opening time');assert.equal(key(h.root,'admin').href,'fiiu-admin.html#checkin');
});

test('the list says until when each block takes check-ins, open on any earlier day, and marks only the closed ones, in every language',async()=>{
 // 22 October, 10:00 in Lima: the lab and the 21 October blocks have closed; the rest are open, even those days ahead.
 const h=await page(()=>assert.fail('the list needs no organiser data'),{search:'',now:'2026-10-22T10:00:00-05:00'}),rows=h.root.querySelectorAll('.f-qr-row');
 const windows=rows.map(row=>row.querySelector('.f-window'));
 assert.deepEqual(windows.map(node=>node.className.split(' ')[1]),['is-closed','is-closed','is-closed','is-open','is-open','is-open']);
 assert.deepEqual(windows.map(node=>node.children[0].dataset.fiiuText),['checkinClosedAllDay','checkinClosedAt','checkinClosedAt','checkinOpenUntil','checkinOpenUntil','checkinOpenUntil']);
 for(const lang of ['en','es','pt']){
  h.lang(lang);
  assert.match(content(windows[1]),{en:/Check-in closed at\s+13:30\s+Lima time/,es:/El registro cerró a las\s+13:30\s+hora de Lima/,pt:/O registro fechou às\s+13:30\s+horário de Lima/}[lang]);
  assert.match(content(windows[4]),{en:/Check-in open until\s+21:30\s+Lima time/,es:/Registro abierto hasta las\s+21:30\s+hora de Lima/,pt:/Registro aberto até\s+21:30\s+horário de Lima/}[lang]);
  assert.match(content(windows[0]),{en:/Check-in closed at the end of the day, Lima time/,es:/El registro cerró al final del día, hora de Lima/,pt:/O registro fechou no fim do dia, horário de Lima/}[lang]);
  assert.doesNotMatch(content(h.root),TEST_WORDING,lang);
 }
 // Two weeks before the festival every block, the laboratory included, is open.
 const before=await page(()=>assert.fail(),{search:'',now:'2026-10-07T10:00:00-05:00'});
 assert.ok(before.root.querySelectorAll('.f-window').every(node=>node.className==='f-window is-open'));
 assert.ok(key(before.root.querySelectorAll('.f-qr-row')[0],'checkinOpenAllDay'));
});

test('a list left open at the desk re-judges each block every 30 seconds, on a return to the tab and on a language change, without reading again or moving focus',async()=>{
 let now=Date.parse('2026-10-21T13:29:40-05:00');class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const h=await createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?{event:FIIU_EVENT,config:{registrationOpen:true},content:[],nextCursor:null}:assert.fail('the list needs no organiser data'),{page:'fiiu-qr',search:'',context:{Date:Clock}}),rows=h.root.querySelectorAll('.f-qr-row'),open=rows.map(row=>key(row,'openCheckinScreen'));
 const states=()=>h.root.querySelectorAll('.f-window').map(node=>node.className.split(' ')[1]);
 assert.deepEqual(states(),['is-closed','is-open','is-open','is-open','is-open','is-open']);
 assert.equal(h.timers.length,1);assert.equal(h.timers[0].delay,30000);
 // 'El poder de lo local' stops taking check-ins at 13:30: the next tick says so.
 now=Date.parse('2026-10-21T13:30:18-05:00');await h.tickTimers();
 assert.deepEqual(states(),['is-closed','is-closed','is-open','is-open','is-open','is-open']);assert.ok(key(rows[1],'checkinClosedAt'));
 // A hidden tab waits; showing it again catches up at once, the next morning included.
 now=Date.parse('2026-10-22T10:00:00-05:00');await h.visible(false);await h.tickTimers();assert.equal(states()[2],'is-open','a hidden list does not redraw');
 await h.visible(true);assert.deepEqual(states(),['is-closed','is-closed','is-closed','is-open','is-open','is-open']);
 // A language change redraws in the new language, on the clock of that moment.
 now=Date.parse('2026-10-22T13:31:00-05:00');h.lang('es');assert.equal(states()[3],'is-closed');assert.match(content(rows[3]),/El registro cerró a las\s+13:30\s+hora de Lima/);h.lang('en');
 assert.deepEqual(h.root.querySelectorAll('.f-qr-row').map(row=>key(row,'openCheckinScreen')),open,'the rows and their links stay, so focus keeps its place');
 assert.equal(h.requests.length,1,'judged on the clock, with no new read');
});

test('a block screen draws the code as one SVG path inside a 4-module quiet zone, with the typed fallback, the window and the live count',async()=>{
 const h=await page(()=>screen()),stage=h.root.querySelector('.f-qr-stage'),svg=descendants(stage).find(node=>node.tagName==='svg');
 assert.equal(h.requests.find(request=>request.path.startsWith('/api/admin/')).path,'/api/admin/fiiu/checkin?activityId=day1-am');
 assert.equal(svg.namespaceURI,'http://www.w3.org/2000/svg');assert.equal(svg.viewBox,'0 0 29 29');assert.equal(svg.role,'img');
 const [back,path]=svg.children;assert.equal(back.tagName,'rect');assert.equal(back.fill,'#fff');assert.equal(back.width,'29');
 assert.equal(svg.children.filter(node=>node.tagName==='path').length,1,'one path for every dark module');
 assert.equal(path.d,'M4 4h21v1h-21zM24 24h1v1h-1z','runs of dark modules merge, offset by the quiet zone');assert.equal(path['shape-rendering'],'crispEdges');assert.equal(path.fill,'#000');
 assert.match(content(stage.querySelector('h1')),/El poder de lo local/);assert.match(content(stage.querySelector('.f-qr-meta')),/Auditorio MALI/);
 const line=stage.querySelector('.f-qr-window');assert.match(content(line),/Check-in open until\s+13:30\s+Lima time/);assert.doesNotMatch(content(line),/08:30/);
 assert.equal(line.querySelector('.f-window').className,'f-window is-open');
 assert.equal(stage.querySelector('.f-qr-url').textContent,'nodal.example/checkin','the address to type is the short one (the server redirects it to the page) and carries no code');
 assert.equal(stage.querySelector('.f-qr-short').textContent,'K7M 4PX','the short code is grouped 3 + 3');
 const count=stage.querySelector('.f-qr-count');assert.equal(count.role,'status');assert.match(content(count),/\b12\b/);assert.ok(key(count,'checkedInMany'));
 assert.doesNotMatch(content(h.root),/@|nationalId|Ab3dEf6h/,'no participant data and no raw code text on the screen');
});

test('the screen refreshes every 30 seconds only while visible, catches up when shown again, and keeps the screen awake',async()=>{
 let n=0;const h=await page(()=>screen({checkedIn:12+n++}));
 assert.equal(h.timers.length,1);assert.equal(h.timers[0].delay,30000);assert.equal(reads(h),1);
 await h.tickTimers();assert.equal(reads(h),2);assert.match(content(h.root.querySelector('.f-qr-count')),/\b13\b/);
 await h.visible(false);await h.tickTimers();assert.equal(reads(h),2,'a hidden screen does not poll');
 await h.visible(true);await flush();assert.equal(reads(h),3,'showing it again refreshes at once');
 assert.equal(h.locks[0].type,'screen');
});

test('Full screen asks for the stage and the label follows the state',async()=>{
 const h=await page(()=>screen()),full=key(h.root,'fullScreen'),stage=h.root.querySelector('.f-qr-stage');
 await full.listeners.click();assert.equal(h.ctx.document.fullscreenElement,stage);assert.equal(full.dataset.fiiuText,'exitFullScreen');
 await full.listeners.click();assert.equal(h.ctx.document.fullscreenElement,null);assert.equal(full.dataset.fiiuText,'fullScreen');
});

test('losing organiser access hides the code, stops polling and releases the screen',async()=>{
 let deny=false;const h=await page(()=>deny?{status:403,data:{error:'administrator access required'}}:screen());
 deny=true;await h.tickTimers();
 assert.ok(key(h.root,'organisersOnly'));assert.equal(h.root.querySelector('.f-qr-stage'),null);assert.equal(descendants(h.root).some(node=>node.tagName==='svg'),false);
 assert.equal(key(h.root,'fiiuPage').href,'fiiu.html');assert.equal(key(h.root,'backToConsole').href,'dashboard.html');assert.equal(h.locks[0].lock.released,true);
 const before=reads(h);await h.tickTimers();await h.visible(true);assert.equal(reads(h),before,'no request after access is lost');
});

test('an ended session hides the code and links to sign-in with the way back',async()=>{
 const h=await page(()=>({status:401,data:{error:'sign in required'}}));
 assert.ok(key(h.root,'sessionEnded'));assert.equal(key(h.root,'adminSignIn').href,'/login.html?next='+encodeURIComponent('/fiiu-qr.html?a=day1-am'));
 assert.equal(h.root.querySelector('.f-qr-stage'),null);await h.tickTimers();assert.equal(reads(h),1);
});

test('workshops and routes have no screen: the page explains and never shows a code',async()=>{
 // The first code is asked for with the programme, before the page knows the block; the server refuses it for an external activity, and nothing more is asked.
 const h=await page(()=>({status:400,data:{error:'invalid activity',code:'invalid_activity'}}),{search:'?a=workshop-calles-gente'});
 assert.ok(key(h.root,'noCheckin'));assert.equal(key(h.root,'allScreens').href,'fiiu-qr.html');assert.equal(h.root.querySelector('.f-qr-stage'),null);assert.equal(descendants(h.root).some(node=>node.tagName==='svg'),false);
 assert.ok(reads(h)<=1);assert.equal(h.timers.length,0);
});

test('the first code is asked for together with the programme, and read once',async()=>{
 let finish;const h=await createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?new Promise(resolve=>{finish=resolve;}):screen(),{page:'fiiu-qr',search:'?a=day1-am'});
 assert.deepEqual(h.requests.map(request=>request.path).sort(),['/api/admin/fiiu/checkin?activityId=day1-am','/api/fiiu?kind=news'],'the code does not wait for the programme');
 finish({event:FIIU_EVENT,config:{registrationOpen:true},content:[],nextCursor:null});await flush();
 assert.equal(reads(h),1);assert.ok(descendants(h.root.querySelector('.f-qr-code')).some(node=>node.tagName==='svg'));assert.equal(h.root.querySelector('.f-qr-short').textContent,'K7M 4PX');
});

test('a programme that fails offers Try again, which asks for a fresh code; a failed first code is never an unhandled rejection',async()=>{
 const unhandled=[],note=reason=>unhandled.push(reason);process.on('unhandledRejection',note);
 try{
  let down=true;const h=await createFiiuHarness(request=>down?{status:503,data:{error:'unavailable'}}:request.path==='/api/fiiu?kind=news'?{event:FIIU_EVENT,config:{registrationOpen:true},content:[],nextCursor:null}:screen(),{page:'fiiu-qr',search:'?a=day1-am'});
  await flush();assert.ok(key(h.root,'retry'));assert.equal(h.message.dataset.fiiuText,'loadError');assert.equal(reads(h),1);
  down=false;await key(h.root,'retry').listeners.click();await flush();
  assert.equal(reads(h),2,'Retry asks for a new code instead of reusing the failed one');assert.ok(descendants(h.root.querySelector('.f-qr-code')).some(node=>node.tagName==='svg'));
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(unhandled,[]);
 }finally{process.off('unhandledRejection',note);}
});

test('a failed refresh keeps a code that is still accepted, and replaces an expired one with a notice',async()=>{
 let reply=()=>screen();const h=await page(()=>reply());
 reply=()=>({status:503,data:{error:'unavailable'}});await h.tickTimers();
 assert.ok(descendants(h.root.querySelector('.f-qr-code')).some(node=>node.tagName==='svg'),'a code still inside its validity stays');
 assert.equal(h.message.dataset.fiiuText,'qrRetrying','the screen says it retries on its own, not that answers are still here');assert.equal(h.root.querySelector('.f-qr-typed').hidden,false);
 reply=()=>screen({validUntil:earlier});await h.tickTimers();reply=()=>({status:503,data:{error:'unavailable'}});await h.tickTimers();
 assert.ok(key(h.root.querySelector('.f-qr-code'),'qrStale'));assert.equal(h.root.querySelector('.f-qr-typed').hidden,true,'the dead short code is hidden too');
 // A language change redraws the screen in the new language, never the expired code.
 h.lang('es');assert.ok(key(h.root.querySelector('.f-qr-code'),'qrStale'));assert.equal(descendants(h.root.querySelector('.f-qr-code')).some(node=>node.tagName==='svg'),false);assert.equal(h.root.querySelector('.f-qr-typed').hidden,true);
 assert.match(content(h.root.querySelector('.f-qr-window')),/Registro abierto hasta las/);h.lang('en');
 reply=()=>screen({qr:null});await h.tickTimers();assert.ok(key(h.root.querySelector('.f-qr-code'),'qrUnavailable'),'without a drawable code the address and short code still work');
 assert.equal(h.root.querySelector('.f-qr-short').textContent,'K7M 4PX');assert.equal(h.root.querySelector('.f-qr-typed').hidden,false,'a fresh code shows the typed fallback again');
});

test('a language change keeps the clock offset from the last answer, so a dead code is still caught on the next failed refresh',async()=>{
 const minute=60000,start=Date.now(),at=offset=>new Date(start+offset).toISOString();let now=start;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 // Server clock 10 minutes ahead; the last good code is accepted for 2 more minutes of server time, then the connection drops for good.
 let reply=()=>screen({serverTime:at(10*minute),validUntil:at(12*minute)});
 const h=await createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?{event:FIIU_EVENT,config:{registrationOpen:true},content:[],nextCursor:null}:reply(),{page:'fiiu-qr',search:'?a=day1-am',context:{Date:Clock}});
 reply=()=>({status:503,data:{error:'unavailable'}});now=start+3*minute;h.lang('es');await h.tickTimers();
 assert.ok(key(h.root.querySelector('.f-qr-code'),'qrStale'),'three minutes on, by the server clock, the code has expired');assert.equal(h.root.querySelector('.f-qr-typed').hidden,true);
});

test('the screen reads time from the server, so a presenter clock that is off never keeps a refused code or hides a valid one',async()=>{
 const minute=60000,real=Date.now(),at=offset=>new Date(real+offset).toISOString();
 // Presenter clock 10 minutes slow: by the server's clock this code stopped being accepted 5 minutes ago.
 let reply=()=>screen({serverTime:at(10*minute),validUntil:at(5*minute)});const slow=await page(()=>reply());
 reply=()=>({status:503,data:{error:'unavailable'}});await slow.tickTimers();
 assert.ok(key(slow.root.querySelector('.f-qr-code'),'qrStale'),'the dead code is replaced by the notice');
 // Presenter clock 10 minutes fast: the server still accepts this code for 4 minutes, so a failed refresh keeps it.
 reply=()=>screen({serverTime:at(-10*minute),validUntil:at(-6*minute)});const fast=await page(()=>reply());
 reply=()=>({status:503,data:{error:'unavailable'}});await fast.tickTimers();
 assert.ok(descendants(fast.root.querySelector('.f-qr-code')).some(node=>node.tagName==='svg'),'a code the server still accepts stays up');
 // A server clock ahead of the laptop (a local FIIU_CHECKIN_NOW): the 20 October laboratory has closed in server time, though not yet on the laptop.
 const ahead=Date.parse('2026-10-21T14:10:00.000Z');
 const lab=await page(()=>screen({activityId:'day0-lab',serverTime:new Date(ahead).toISOString(),validUntil:new Date(ahead+5*minute).toISOString(),window:{closesAt:'2026-10-21T05:00:00.000Z',open:false}}),{search:'?a=day0-lab',now:'2026-10-07T10:00:00-05:00'});
 assert.ok(key(lab.root.querySelector('.f-qr-window'),'checkinClosedAllDay'),'closed by the server clock, not open by the laptop clock');
 // Without the server's verdict the server's clock decides: a block that closes later is open, one that closed is closed.
 const later=await page(()=>screen({serverTime:at(0),window:{closesAt:at(3600000)}}));
 assert.ok(key(later.root.querySelector('.f-qr-window'),'checkinOpenUntil'));
 const over=await page(()=>screen({serverTime:at(0),window:{closesAt:at(-60000)}}));
 assert.ok(key(over.root.querySelector('.f-qr-window'),'checkinClosedAt'));
});

test('the block screen says until when check-in is open, and when it closed once it has, in every language',async()=>{
 let reply=()=>screen({serverTime:'2026-10-07T15:00:00.000Z'});const h=await page(()=>reply()),line=()=>h.root.querySelector('.f-qr-window');
 for(const lang of ['en','es','pt']){
  h.lang(lang);assert.match(content(line()),{en:/Check-in open until\s+13:30\s+Lima time/,es:/Registro abierto hasta las\s+13:30\s+hora de Lima/,pt:/Registro aberto até\s+13:30\s+horário de Lima/}[lang]);
  assert.doesNotMatch(content(h.root),TEST_WORDING,lang);
 }
 reply=()=>screen({serverTime:'2026-10-21T18:31:00.000Z',window:{closesAt:'2026-10-21T18:30:00.000Z',open:false}});await h.tickTimers();
 assert.equal(line().querySelector('.f-window').className,'f-window is-closed');
 for(const lang of ['en','es','pt']){
  h.lang(lang);assert.match(content(line()),{en:/Check-in closed at\s+13:30\s+Lima time/,es:/El registro cerró a las\s+13:30\s+hora de Lima/,pt:/O registro fechou às\s+13:30\s+horário de Lima/}[lang]);
 }
});

test('once check-in has closed the screen drops the QR code and the typed code for a large notice, and keeps it through refreshes and language changes',async()=>{
 // The server still sends a valid code after the close, but refuses every scan of it: nothing scannable may stay on the projector.
 let reply=()=>screen({serverTime:'2026-10-21T18:31:00.000Z',window:{closesAt:'2026-10-21T18:30:00.000Z',open:false}});const h=await page(()=>reply());
 const stage=h.root.querySelector('.f-qr-stage'),slot=()=>h.root.querySelector('.f-qr-code'),svg=()=>descendants(slot()).some(node=>node.tagName==='svg');
 const closedNow=()=>{
  assert.equal(svg(),false,'no QR code');assert.equal(h.root.querySelector('.f-qr-typed').hidden,true,'no address or short code to type');
  assert.ok(key(slot(),'checkinEndedTitle'));assert.ok(key(slot(),'askDesk'));assert.equal(key(slot(),'allScreens'),undefined,'no way to the other screens from the door');
  assert.equal(stage.querySelector('.f-qr-kicker').dataset.fiiuText,'qrClosedKicker','the kicker no longer says scan');
  assert.equal(h.root.querySelector('.f-qr-note').hidden,true,'nor "keep this screen open"');
  assert.match(content(h.root.querySelector('.f-qr-count')),/\b12\b/,'the final count stays for the organisers');
  assert.equal(h.root.querySelector('.f-qr-window').querySelector('.f-window').className,'f-window is-closed');
 };
 closedNow();
 for(const lang of ['en','es','pt']){
  h.lang(lang);closedNow();
  assert.match(content(slot()),{en:/Check-in for this block has closed\s+Ask the registration desk for help\./,es:/El registro de este bloque ya cerró\s+Pide ayuda en la mesa de registro\./,pt:/O registro deste bloco já encerrou\s+Peça ajuda na mesa de credenciamento\./}[lang]);
  assert.match(content(stage.querySelector('.f-qr-kicker')),{en:/^Check-in closed$/,es:/^Registro cerrado$/,pt:/^Registro encerrado$/}[lang]);
 }
 // Polling carries on, so the closed state survives the next answer and a failed refresh with an expired code.
 await h.tickTimers();closedNow();
 reply=()=>({status:503,data:{error:'unavailable'}});await h.tickTimers();closedNow();assert.equal(key(slot(),'qrStale'),undefined);
 // Without the server's verdict the server's clock decides the same way.
 reply=()=>screen({serverTime:'2026-10-21T18:31:00.000Z',window:{closesAt:'2026-10-21T18:30:00.000Z'}});await h.tickTimers();closedNow();
 // An open answer (a closing time moved later) brings the code back.
 reply=()=>screen({serverTime:'2026-10-21T18:31:00.000Z',window:{closesAt:'2026-10-21T19:30:00.000Z',open:true}});await h.tickTimers();
 assert.equal(svg(),true);assert.equal(h.root.querySelector('.f-qr-typed').hidden,false);assert.equal(stage.querySelector('.f-qr-kicker').dataset.fiiuText,'scanToCheckIn');
 assert.equal(h.root.querySelector('.f-qr-note').hidden,false);assert.equal(key(slot(),'checkinEndedTitle'),undefined);
});

// The door: a block screen may stand where the queue can reach it, signed in as an organiser. It offers no way back to the other screens or the
// organiser pages, and the site menu goes away (the body's f-presenter class); the list, used by the team, keeps its links and the menu.
// The body's class list is recorded from the moment the programme arrives, which is when the page draws a screen or the list.
async function door(answer,search){
 let finish;const added=new Set();
 const h=await createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?new Promise(resolve=>{finish=resolve;}):answer(request),{page:'fiiu-qr',search});
 h.body.classList={add:name=>added.add(name),remove:name=>added.delete(name),toggle:(name,on)=>{if(on??!added.has(name))added.add(name);else added.delete(name);return added.has(name);},contains:name=>added.has(name)};
 finish({event:FIIU_EVENT,config:{registrationOpen:true},content:[],nextCursor:null});await flush();return Object.assign(h,{added});
}

test('a block screen links nowhere and hides the site menu, open or closed, in every language, while the list keeps its links',async()=>{
 let reply=()=>screen();const h=await door(()=>reply(),'?a=day1-am');
 const nowhere=()=>{
  assert.deepEqual(h.root.querySelectorAll('a').map(a=>a.href),[],'no link on the screen');
  for(const name of ['allScreens','admin','backToConsole'])assert.equal(key(h.root,name),undefined,name);
 };
 assert.ok(h.root.querySelector('.f-qr-stage'));assert.ok(key(h.root,'fullScreen'),'full screen stays');assert.ok(h.added.has('f-presenter'),'the site menu goes away');nowhere();
 reply=()=>screen({serverTime:'2026-10-21T18:31:00.000Z',window:{closesAt:'2026-10-21T18:30:00.000Z',open:false}});await h.tickTimers();
 assert.ok(key(h.root.querySelector('.f-qr-code'),'checkinEndedTitle'));assert.ok(key(h.root.querySelector('.f-qr-code'),'askDesk'));
 for(const lang of ['en','es','pt']){h.lang(lang);nowhere();}
 assert.ok(h.added.has('f-presenter'));
 const css=readFileSync(new URL('../web/styles/fiiu.css',import.meta.url),'utf8');
 assert.match(css,/\.f-page\.f-presenter>\.navbar\{display:none\}/,'presenter mode hides the site menu');
 // The list is for the team: it keeps its screens, the organiser dashboard and the site menu.
 const list=await door(()=>assert.fail('the list needs no organiser data'),'');
 assert.equal(list.added.has('f-presenter'),false);assert.equal(key(list.root,'admin').href,'fiiu-admin.html#checkin');
 assert.equal(list.root.querySelectorAll('.f-qr-row').length,6);
 // A link to a block that has no screen still leads back to the list.
 const none=await door(()=>({status:400,data:{error:'invalid activity',code:'invalid_activity'}}),'?a=workshop-calles-gente');
 assert.equal(key(none.root,'allScreens').href,'fiiu-qr.html');
});

test('the list says a screen goes on a projector or a tablet held by the team, never left alone, as it is signed in as an organiser, in every language',async()=>{
 const h=await page(()=>assert.fail('the list needs no organiser data'),{search:''}),hint=()=>content(key(h.root,'qrListHint'));
 for(const lang of ['en','es','pt']){
  h.lang(lang);
  assert.match(hint(),{en:/projector, or on a tablet held by a staff member/,es:/proyector o en una tablet que sostenga alguien del equipo/,pt:/projetor ou em um tablet segurado por alguém da equipe/}[lang]);
  assert.match(hint(),{en:/signed in with an organiser account.*never leave it unattended/,es:/sesión iniciada con una cuenta de organización.*nunca lo dejes sin supervisión/,pt:/conectado com uma conta da organização.*nunca o deixe sem supervisão/}[lang]);
  assert.match(hint(),{en:/no participant data/,es:/datos de participantes/,pt:/dados de participantes/}[lang]);
 }
});
