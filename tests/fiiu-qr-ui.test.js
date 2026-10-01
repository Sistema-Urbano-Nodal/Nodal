import test from 'node:test';
import assert from 'node:assert/strict';
import {FIIU_EVENT} from '../server/fiiu-domain.js';
import {createFiiuHarness,key,descendants,content,flush} from './helpers/fiiu-ui-harness.js';

// A 21-module grid: the whole first row dark and the bottom-right module dark, packed row-major, most significant bit first.
function bits(size,dark){const bytes=Buffer.alloc(Math.ceil(size*size/8));for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(dark(x,y)){const i=y*size+x;bytes[i>>3]|=0x80>>(i&7);}return bytes.toString('base64');}
const qr={size:21,bits:bits(21,(x,y)=>y===0||(x===20&&y===20))};
const later=new Date(Date.now()+5*60000).toISOString(),earlier=new Date(Date.now()-60000).toISOString();
const screen=(extra={})=>({activityId:'day1-am',url:'https://nodal.example/fiiu-checkin.html?a=day1-am&c=Ab3dEf6hIj9kLm2nOp5qRs',code:'Ab3dEf6hIj9kLm2nOp5qRs',shortCode:'K7M4PX',rotatesAt:later,validUntil:later,window:{opensAt:'2026-10-21T13:30:00.000Z',closesAt:'2026-10-21T18:30:00.000Z',open:true},checkedIn:12,qr,...extra});
async function page(answer,{search='?a=day1-am'}={}){
 return createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?{event:FIIU_EVENT,config:{registrationOpen:true},content:[],nextCursor:null}:answer(request),{page:'fiiu-qr',search});
}
const reads=h=>h.requests.filter(request=>request.path.startsWith('/api/admin/fiiu/checkin')).length;

test('without a block the page lists the NODAL blocks by day, each opening its own screen, and nothing for workshops or routes',async()=>{
 const h=await page(()=>assert.fail('the list needs no organiser data'),{search:''});
 assert.ok(key(h.root,'qrTitle'));const rows=h.root.querySelectorAll('.f-qr-row');
 assert.deepEqual(rows.map(row=>key(row,'openCheckinScreen').href),['day0-lab','day1-am','day1-pm','day2-am','day2-pm','day3-am'].map(id=>'fiiu-qr.html?a='+id));
 assert.doesNotMatch(content(h.root),/Calles para la gente|Lima cromática/);assert.equal(h.requests.length,1);
 assert.match(content(rows[1]),/08:30–13:30/);assert.equal(key(h.root,'admin').href,'fiiu-admin.html#checkin');
});

test('a block screen draws the code as one SVG path inside a 4-module quiet zone, with the typed fallback, the window and the live count',async()=>{
 const h=await page(()=>screen()),stage=h.root.querySelector('.f-qr-stage'),svg=descendants(stage).find(node=>node.tagName==='svg');
 assert.equal(h.requests.find(request=>request.path.startsWith('/api/admin/')).path,'/api/admin/fiiu/checkin?activityId=day1-am');
 assert.equal(svg.namespaceURI,'http://www.w3.org/2000/svg');assert.equal(svg.viewBox,'0 0 29 29');assert.equal(svg.role,'img');
 const [back,path]=svg.children;assert.equal(back.tagName,'rect');assert.equal(back.fill,'#fff');assert.equal(back.width,'29');
 assert.equal(svg.children.filter(node=>node.tagName==='path').length,1,'one path for every dark module');
 assert.equal(path.d,'M4 4h21v1h-21zM24 24h1v1h-1z','runs of dark modules merge, offset by the quiet zone');assert.equal(path['shape-rendering'],'crispEdges');assert.equal(path.fill,'#000');
 assert.match(content(stage.querySelector('h1')),/El poder de lo local/);assert.match(content(stage.querySelector('.f-qr-meta')),/Auditorio MALI/);
 assert.match(content(stage.querySelector('.f-qr-window')),/08:30–13:30/);assert.ok(key(stage,'checkinOpenNow'));
 assert.equal(stage.querySelector('.f-qr-url').textContent,'nodal.example/fiiu-checkin.html','the address to type carries no code');
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

test('workshops and routes have no screen: the page explains and asks the server for nothing',async()=>{
 const h=await page(()=>assert.fail('no code for an external activity'),{search:'?a=workshop-calles-gente'});
 assert.ok(key(h.root,'noCheckin'));assert.equal(key(h.root,'allScreens').href,'fiiu-qr.html');assert.equal(reads(h),0);assert.equal(h.timers.length,0);
});

test('a failed refresh keeps a code that is still accepted, and replaces an expired one with a notice',async()=>{
 let reply=()=>screen();const h=await page(()=>reply());
 reply=()=>({status:503,data:{error:'unavailable'}});await h.tickTimers();
 assert.ok(descendants(h.root.querySelector('.f-qr-code')).some(node=>node.tagName==='svg'),'a code still inside its validity stays');assert.equal(h.message.dataset.fiiuText,'error');
 reply=()=>screen({validUntil:earlier});await h.tickTimers();reply=()=>({status:503,data:{error:'unavailable'}});await h.tickTimers();
 assert.ok(key(h.root.querySelector('.f-qr-code'),'qrStale'));
 reply=()=>screen({qr:null});await h.tickTimers();assert.ok(key(h.root.querySelector('.f-qr-code'),'qrUnavailable'),'without a drawable code the address and short code still work');
 assert.equal(h.root.querySelector('.f-qr-short').textContent,'K7M 4PX');
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
 // A rehearsal clock three weeks ahead: the 20 October laboratory window has closed in server time, though not yet on the laptop.
 const rehearsal=Date.parse('2026-10-21T14:10:00.000Z');
 const lab=await page(()=>screen({activityId:'day0-lab',serverTime:new Date(rehearsal).toISOString(),validUntil:new Date(rehearsal+5*minute).toISOString(),window:{opensAt:'2026-10-20T05:00:00.000Z',closesAt:'2026-10-21T05:00:00.000Z',open:false}}),{search:'?a=day0-lab'});
 assert.ok(key(lab.root.querySelector('.f-qr-window'),'checkinClosedNow'),'closed by the server clock, not "upcoming" by the laptop clock');
 // Without serverTime (an older server) the laptop clock is the fallback, as before.
 const legacy=await page(()=>screen({serverTime:undefined,window:{opensAt:new Date(real+3600000).toISOString(),closesAt:new Date(real+7200000).toISOString(),open:false}}));
 assert.equal(key(legacy.root.querySelector('.f-qr-window'),'checkinClosedNow'),undefined,'a window opening later on that clock shows no state');
});
