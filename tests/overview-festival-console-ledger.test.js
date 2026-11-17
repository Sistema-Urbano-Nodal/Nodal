import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {FIIU_EVENT} from '../server/fiiu-domain.js';
import {Node,flush,content} from './helpers/fiiu-ui-harness.js';

/* The console's festival block (web/scripts/fiiu-hubs.js) checks once a minute, during the festival, whether what it drew has moved on. A block's
   check-in closing (30 minutes after it ends) is such a move even when the next block stays the same: the Recognition ledger (dashboard.js) then
   stops offering a block the member missed, so the festival block reads again and hands the ledger fresh data. */

const user={id:'00000000-0000-4000-8000-000000000001',email:'ana@example.test',name:'Ana Test',city:'Lima'};
const registration={userId:user.id,id:'00000000-0000-4000-8000-000000000002',version:1,email:user.email,labStatus:'none',answers:{firstName:'Ana',lastName:'Test',activities:['day1-am','day1-pm'],externalActivities:[]}};
const feed={event:FIIU_EVENT,config:{registrationOpen:true},content:[],nextCursor:null};

// The block on the console with a page clock at iso; tick(iso) moves the clock on and runs the once-a-minute check. events: the hand-offs to the ledger.
async function consoleBlock(iso){
 let at=Date.parse(iso);const Clock=class extends Date{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}};
 const body=new Node('body'),host=new Node(),requests=[],events=[],timers=[];body.append(host);
 const document={body,documentElement:{lang:'en'},visibilityState:'visible',getElementById:id=>id==='fiiuDashboardBody'?host:null,createElement:tag=>new Node(tag),querySelectorAll:selector=>body.querySelectorAll(selector),addEventListener(){},dispatchEvent:event=>{events.push(event);return true;}};
 const CustomEvent=class{constructor(type,init={}){this.type=type;this.detail=init.detail;}};
 const context=vm.createContext({document,CustomEvent,window:{nodalI18n:{lang:'en',onChange(){}}},Intl,Date:Clock,Error,AbortSignal,
  setInterval:(callback,delay)=>timers.push({callback,delay}),clearInterval:id=>{if(timers[id-1])timers[id-1].cleared=true;},
  fetch:async url=>{requests.push(url);const result=url==='/api/fiiu/registration'?{user,registration,attendance:[],isAdmin:false}:url==='/api/fiiu?kind=news'?feed:{questions:[]};return{ok:true,status:200,json:async()=>result};}});
 for(const name of ['fiiu-ui','fiiu-hubs'])vm.runInContext(readFileSync(new URL(`../web/scripts/${name}.js`,import.meta.url),'utf8'),context);
 await flush();
 const tick=async next=>{at=Date.parse(next);await Promise.all(timers.filter(timer=>!timer.cleared).map(timer=>timer.callback()));await flush();};
 return {host,events,timers,tick,reads:()=>requests.filter(url=>url==='/api/fiiu/registration').length};
}

test('a missed block’s check-in closing makes the console block read again and hand the ledger fresh data, though its next block stays the same',async()=>{
 // Wed 21 Oct, 13:10 in Lima: the morning block (09:00–13:00) ended without a check-in and takes them until 13:30; the evening block is next.
 const w=await consoleBlock('2026-10-21T13:10:00-05:00'),next=()=>content(w.host.querySelector('.f-next').querySelector('.f-next-title')).trim();
 assert.equal(w.reads(),1);assert.equal(w.events.length,1);assert.deepEqual(w.timers.map(timer=>timer.delay),[60000]);assert.match(next(),/^Intervenir para activar/);
 await w.tick('2026-10-21T13:29:00-05:00');assert.equal(w.reads(),1,'a minute with nothing new reads nothing');
 await w.tick('2026-10-21T13:31:00-05:00');
 assert.equal(w.reads(),2,'the morning block’s check-in has closed');assert.equal(w.events.length,2,'and the ledger gets the data to say so');
 assert.equal(w.events[1].type,'nodal:fiiu-festival');assert.match(next(),/^Intervenir para activar/,'the next block is still the evening one');
 await w.tick('2026-10-21T13:32:00-05:00');assert.equal(w.reads(),2,'once only');assert.equal(w.timers.length,1,'redraws do not stack checks');
});
