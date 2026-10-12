import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createFiiuHarness,descendants,key,flush,content} from './helpers/fiiu-ui-harness.js';

const Q='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',Q2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const M1='10000000-0000-4000-8000-000000000001',M2='10000000-0000-4000-8000-000000000002',M3='10000000-0000-4000-8000-000000000003',M4='10000000-0000-4000-8000-000000000004';
const F1='f0000000-0000-4000-8000-000000000001',F2='f0000000-0000-4000-8000-000000000002';
const CLIENT='cccccccc-cccc-4ccc-8ccc-000000000000';
const ACTIVITY={id:'day1-am',title:'El poder de lo local',date:'2026-10-21',time:'09:00–13:00',venue:'Auditorio MALI, Cercado de Lima',sessions:[['09:00–10:00','¡Bienvenidos al FIIU 11!']],registration:'general',period:'morning'};
const question=(over={})=>({id:Q,activityId:'day1-am',talk:'¡Bienvenidos al FIIU 11!',body:'¿Qué te llevas de esta mañana?',status:'open',revision:3,messageCount:2,createdAt:'2026-10-21T13:55:00.000Z',...over});
const message=(id,over={})=>({id,author:'Ana T.',organiser:false,mine:false,body:'Hola a todas',files:[],likeCount:0,liked:false,createdAt:'2026-10-21T14:05:00.000Z',seq:1,...over});
const thread=(over={})=>({question:question(over.question),activity:ACTIVITY,messages:over.messages??[message(M1,{seq:1}),message(M2,{author:'Flavia R.',organiser:true,body:'Bienvenidas',createdAt:'2026-10-21T14:07:00.000Z',seq:2})],before:over.before??null,revision:over.revision??3,me:{organiser:false,canPost:true,...over.me}});
// A ?since= answer as the server sends it: the changes, then the question as it is now (its text, talk and status ride on every answer).
const since=(revision,changes=[],over={})=>({revision,changes,question:question({revision,...over})});
// Changes carry no liked flag: one answer serves every viewer, and the page keeps its own.
const bare=view=>{const {liked,...rest}=view;return rest;};
// A clock frozen at one Lima moment (the festival's first morning) that a test can move forward.
const clock=(iso='2026-10-21T09:30:00-05:00')=>{let at=Date.parse(iso);return class extends Date{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}static advance(ms){at+=ms;}};};
// routes answer 'METHOD path'; a function answer gets the request. Unknown requests are 404s, so a stray call shows up as a failure.
async function page(routes={},{search='?q='+Q,context={}}={}){
 let n=0;const table={['GET /api/fiiu/questions/'+Q]:thread(),['GET /api/fiiu/questions?activityId=day1-am']:{activity:ACTIVITY,questions:[question()]},'GET /api/fiiu/pulse':{questions:[[Q,'day1-am',3,'open']]},...routes};
 return createFiiuHarness(request=>{const answer=table[request.method+' '+request.path];return answer===undefined?{status:404,data:{error:'not found'}}:typeof answer==='function'?answer(request):answer;},
  {page:'fiiu-talk',search,context:{Date:clock(),crypto:{randomUUID:()=>'cccccccc-cccc-4ccc-8ccc-'+String(n++).padStart(12,'0')},...context}});
}
const rows=h=>h.root.querySelectorAll('.f-talk-msg');
const row=(h,id)=>rows(h).find(node=>node.dataset.id===id);
const composer=h=>h.root.querySelector('.f-talk-composer');
const classes=node=>node.className.split(' ');
const sent=(h,method,path)=>h.requests.filter(request=>request.method===method&&(path instanceof RegExp?path.test(request.path):request.path===path));
const submit=h=>composer(h).listeners.submit({preventDefault(){}});
const later=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const links=node=>node.querySelectorAll('a');
const MESSAGES='/api/fiiu/questions/'+Q+'/messages';
// After a refusal that says the question closed, the page reads it again: the first read is the page load, the next ones see the close.
const closesOnRefusal=()=>{let reads=0;return ()=>reads++?thread({question:{status:'closed',revision:4},me:{canPost:false},revision:4}):thread();};

test('the chat shows the block, the talk and the question, then the messages oldest first with the organiser label and Lima times',async()=>{
 const yesterday=message(M3,{body:'Llegué temprano',createdAt:'2026-10-20T20:00:00.000Z',seq:1});
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({messages:[yesterday,message(M1,{seq:2}),message(M2,{author:'Flavia R.',organiser:true,body:'Bienvenidas',createdAt:'2026-10-21T14:07:00.000Z',seq:3})]})});
 const box=h.root.querySelector('.f-talk');
 assert.equal(box.querySelector('h1').textContent,'El poder de lo local');
 const when=box.querySelector('.f-talk-when');assert.equal(when.querySelector('[data-fiiu-date]').dataset.fiiuDate,'2026-10-21');assert.match(content(when),/09:00–13:00/);assert.match(content(when),/Auditorio MALI/);
 assert.equal(box.querySelector('.f-talk-talk').textContent,'¡Bienvenidos al FIIU 11!');
 const quote=box.querySelector('.f-talk-question');assert.equal(quote.tagName,'blockquote');assert.equal(quote.textContent,'¿Qué te llevas de esta mañana?');
 const log=box.querySelector('.f-talk-log');assert.equal(log.tagName,'ol');assert.equal(log.role,'log');assert.equal(log['aria-live'],'off');assert.equal(log['aria-label'],'Conversation');
 assert.deepEqual(rows(h).map(node=>node.dataset.id),[M3,M1,M2]);assert.equal(row(h,M1).dataset.seq,'2');
 assert.equal(key(row(h,M1),'talkOrganiser'),undefined);assert.ok(key(row(h,M2),'talkOrganiser'),'an organiser message carries the FIIU organisers label');
 const time=row(h,M1).querySelector('time');assert.equal(time.textContent,'09:05','Lima time, UTC−5');assert.equal(time.dateTime,'2026-10-21T14:05:00.000Z');
 assert.equal(row(h,M1).querySelector('[data-fiiu-date]'),null,'a message from today shows the time only');
 assert.equal(row(h,M3).querySelector('time').querySelector('[data-fiiu-date]').dataset.fiiuDate,'2026-10-20','an older message adds its Lima date');assert.match(content(row(h,M3).querySelector('time')),/15:00/);
 assert.equal(box.querySelector('.f-talk-empty').hidden,true);assert.equal(box.querySelector('.f-talk-earlier').hidden,true);
 assert.equal(h.ctx.document.title,'NODAL · Conversation');assert.equal(h.message.textContent,'');
 assert.equal(h.timers.length,1);assert.equal(h.timers[0].delay,4000);
 assert.ok(h.root.querySelectorAll('span').some(node=>node.id==='f-newtab'),'links that open a new tab are described');
});

test('an empty conversation invites the first answer',async()=>{
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({messages:[]})});
 assert.equal(h.root.querySelector('.f-talk-empty').hidden,false);assert.ok(key(h.root,'talkEmpty'));
});

test('a guest is asked to sign in and come back, an account without a registration to register, and a hidden question is unavailable',async()=>{
 const guest=await page({['GET /api/fiiu/questions/'+Q]:{status:401,data:{error:'sign in required'}}});
 assert.ok(key(guest.root,'talkSignIn'));assert.ok(key(guest.root,'talkSignInHint'));
 assert.equal(links(guest.root).find(a=>a.href.startsWith('login.html')).href,'login.html?next='+encodeURIComponent('/fiiu-talk.html?q='+Q));
 assert.equal(guest.timers.length,0,'nothing polls before access is settled');
 const outsider=await page({['GET /api/fiiu/questions/'+Q]:{status:403,data:{error:'festival registration required',code:'not_registered'}}});
 assert.ok(key(outsider.root,'talkRegister'));assert.ok(key(outsider.root,'talkRegisterHint'));assert.ok(links(outsider.root).some(a=>a.href==='fiiu.html#registration'));
 const hidden=await page({['GET /api/fiiu/questions/'+Q]:{status:404,data:{error:'not found',code:'question_unavailable'}}});
 assert.ok(key(hidden.root,'talkUnavailable'));assert.ok(links(hidden.root).some(a=>a.href==='fiiu.html#programme'));
 assert.deepEqual(hidden.timers.map(timer=>timer.delay),[8000],'a hidden question only watches the public pulse, slowly');
 // An outage is an error with a retry, never "signed out".
 let calls=0;const down=await page({['GET /api/fiiu/questions/'+Q]:()=>calls++?thread():{status:503,data:{}}});
 assert.ok(key(down.root,'talkError'));assert.equal(key(down.root,'talkSignIn'),undefined);
 await key(down.root,'retry').listeners.click();await flush();assert.ok(down.root.querySelector('.f-talk-log'));assert.equal(down.timers.length,1);
 const broken=await page({},{search:'?q=nope'});assert.ok(key(broken.root,'talkUnavailable'));assert.equal(broken.requests.length,0,'a malformed address asks the server nothing');
});

test('a message appears at once as sending and leaves the composer; a failure keeps it in its row with Retry and the same clientId; success shows the server row',async()=>{
 const answers=[later(),later()];let n=0;
 const h=await page({['POST '+MESSAGES]:()=>answers[n++].promise});
 const text=composer(h).querySelector('textarea');text.value='  Me llevo la idea de barrio  ';text.focus();
 submit(h);await flush();assert.equal(text.value,'','the composer empties at once');
 submit(h);await flush();assert.equal(sent(h,'POST',MESSAGES).length,1,'a second tap while sending posts nothing');assert.equal(rows(h).filter(node=>node.dataset.pending).length,1);
 const pending=rows(h).at(-1);assert.ok(classes(pending).includes('is-pending'));assert.ok(key(pending,'talkSending'));assert.equal(content(pending.querySelector('.f-talk-body')).trim(),'Me llevo la idea de barrio');
 answers[0].resolve({status:503,data:{error:'unavailable'}});await flush();
 const failed=rows(h).at(-1);assert.ok(classes(failed).includes('is-failed'));assert.ok(key(failed,'talkNotSent'));assert.ok(key(failed,'talkRetry'));
 assert.equal(content(failed.querySelector('.f-talk-body')).trim(),'Me llevo la idea de barrio','the failed row keeps the message');assert.equal(text.value,'');assert.equal(composer(h).querySelector('.f-talk-status').dataset.fiiuText,'talkError');
 text.focused=false;key(failed,'talkRetry').listeners.click();await flush();
 assert.ok(classes(rows(h).at(-1)).includes('is-pending'),'a retry shows the sending state again');
 answers[1].resolve({status:201,data:{message:message(M3,{mine:true,body:'Me llevo la idea de barrio',createdAt:'2026-10-21T14:20:00.000Z',seq:4})}});await flush();
 const posts=sent(h,'POST',MESSAGES);
 assert.deepEqual(posts.map(request=>request.body),[{clientId:CLIENT,body:'Me llevo la idea de barrio',fileIds:[]},{clientId:CLIENT,body:'Me llevo la idea de barrio',fileIds:[]}],'the retry repeats the same clientId and content');
 assert.deepEqual(rows(h).map(node=>node.dataset.id),[M1,M2,M3]);assert.ok(classes(row(h,M3)).includes('is-mine'));assert.ok(!classes(row(h,M3)).includes('is-pending'));
 assert.equal(text.value,'');assert.equal(text.focused,true,'focus returns to the composer');assert.equal(composer(h).querySelector('.f-talk-status').textContent,'');
 assert.equal(row(h,M3).querySelector('.f-talk-like'),null,'your own message has no like button');assert.ok(key(row(h,M3),'talkDelete'));
});

test('a message that reached the server before its answer was lost appears once after Retry',async()=>{
 let revision=3,posts=0;
 const mine=message(M3,{mine:true,body:'Una vez',createdAt:'2026-10-21T14:20:00.000Z',seq:4});
 const h=await page({['POST '+MESSAGES]:()=>posts++?{status:200,data:{message:mine}}:{status:503,data:{}},'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),['GET '+MESSAGES+'?since=3']:since(4,[mine])});
 composer(h).querySelector('textarea').value='Una vez';submit(h);await flush();
 assert.ok(classes(rows(h).at(-1)).includes('is-failed'));
 revision=4;await h.tickTimers();assert.ok(row(h,M3),'the poll brings the message the server kept');
 await key(rows(h).find(node=>classes(node).includes('is-failed')),'talkRetry').listeners.click();await flush();
 assert.deepEqual(sent(h,'POST',MESSAGES).map(request=>request.body.clientId),[CLIENT,CLIENT]);
 assert.deepEqual(rows(h).map(node=>node.dataset.id),[M1,M2,M3],'one row, no pending or failed copy');
 assert.equal(composer(h).querySelector('textarea').value,'');
});

test('Ctrl or Command with Enter sends, an empty draft sends nothing, and the counter appears near the limit',async()=>{
 const h=await page({['POST '+MESSAGES]:request=>({status:201,data:{message:message(M3,{mine:true,body:request.body.body,seq:4})}})});
 const text=composer(h).querySelector('textarea'),left=composer(h).querySelector('.f-talk-left');
 text.value='   ';await text.listeners.keydown({key:'Enter',ctrlKey:true,preventDefault(){}});await flush();assert.equal(sent(h,'POST',MESSAGES).length,0);
 text.value='x'.repeat(950);text.listeners.input();assert.equal(left.hidden,false);assert.equal(left.textContent,'50 characters left');
 text.value='😀'.repeat(999);text.listeners.input();assert.equal(left.textContent,'1 character left','an emoji counts once, as the server counts code points');
 text.value='😀'.repeat(1001);text.listeners.input();submit(h);await flush();assert.equal(sent(h,'POST',MESSAGES).length,0,'over the limit nothing is sent');assert.equal(composer(h).querySelector('.f-talk-status').dataset.fiiuText,'talkTooLong');
 text.value='Hola';text.listeners.input();assert.equal(left.hidden,true);
 await text.listeners.keydown({key:'Enter',metaKey:true,preventDefault(){}});await flush();assert.equal(sent(h,'POST',MESSAGES).length,1);
});

test('polling asks for changes only when the pulse moves, patches rows in place and leaves the draft and focus alone',async()=>{
 let revision=3;
 const h=await page({'GET /api/fiiu/pulse':()=>({questions:[[Q2,'day1-am',9,'open'],[Q,'day1-am',revision,'open']]}),
  ['GET '+MESSAGES+'?since=3']:since(5,[message(M3,{body:'Nuevo',createdAt:'2026-10-21T14:06:00.000Z',seq:4}),{id:M1,seq:5,gone:true}])});
 const text=composer(h).querySelector('textarea');text.value='borrador';text.focus();
 await h.tickTimers();assert.equal(sent(h,'GET','/api/fiiu/pulse').length,1);assert.equal(sent(h,'GET',/since=/).length,0,'an unchanged revision fetches nothing');
 revision=5;await h.tickTimers();assert.equal(sent(h,'GET',/since=/).length,1);
 assert.deepEqual(rows(h).map(node=>node.dataset.id),[M3,M2],'the new message takes its place by time and the gone one leaves');
 assert.equal(text.value,'borrador');assert.equal(text.focused,true);assert.ok(descendants(h.root).includes(text),'the composer is the same element');
 await h.tickTimers();assert.equal(sent(h,'GET',/since=/).length,1,'the known revision moved to 5');
 await h.visible(false);await h.tickTimers();assert.equal(sent(h,'GET','/api/fiiu/pulse').length,3,'a hidden tab does not poll');
 await h.visible(true);await flush();assert.equal(sent(h,'GET','/api/fiiu/pulse').length,4,'coming back polls at once');
});

test('a failing pulse backs off exponentially, says in the dock that updates are paused, and recovers',async()=>{
 const Clock=clock();let up=false;
 const h=await page({'GET /api/fiiu/pulse':()=>up?{questions:[[Q,'day1-am',3,'open']]}:{status:503,data:{}}},{context:{Date:Clock}});
 const pulses=()=>sent(h,'GET','/api/fiiu/pulse').length;
 const paused=()=>h.root.querySelector('.f-talk-dock').querySelector('.f-talk-note');
 await h.tickTimers();assert.equal(pulses(),1);assert.equal(paused().dataset.fiiuText,'talkPaused');
 Clock.advance(8000);await h.tickTimers();assert.equal(pulses(),2,'8 s after the first failure');
 Clock.advance(8000);await h.tickTimers();assert.equal(pulses(),2,'after 2 failures the next try waits 16 s');
 Clock.advance(8000);up=true;await h.tickTimers();assert.equal(pulses(),3);assert.equal(paused().textContent,'');
 await h.tickTimers();assert.equal(pulses(),4,'success resets the backoff');
});

test('a reset reloads the conversation and keeps the draft; a question that leaves the pulse becomes unavailable and polling stops',async()=>{
 let loads=0,pulse=[[Q,'day1-am',4,'open']];
 const h=await page({['GET /api/fiiu/questions/'+Q]:()=>{loads++;return loads===3?{status:404,data:{code:'question_unavailable'}}:thread({revision:loads===2?250:3,messages:loads===2?[message(M4,{seq:250})]:undefined});},
  'GET /api/fiiu/pulse':()=>({questions:pulse}),['GET '+MESSAGES+'?since=3']:{reset:true,revision:250}});
 const text=composer(h).querySelector('textarea');text.value='sigo escribiendo';text.focus();
 await h.tickTimers();assert.equal(loads,2);assert.deepEqual(rows(h).map(node=>node.dataset.id),[M4]);
 assert.equal(composer(h).querySelector('textarea'),text,'the same composer');assert.equal(text.value,'sigo escribiendo');assert.equal(text.focused,true);
 pulse=[];await h.tickTimers();assert.equal(loads,3);assert.ok(key(h.root,'talkUnavailable'));
 assert.ok(links(h.root).some(a=>a.href==='fiiu-talk.html?a=day1-am'),'the way back names the block');assert.equal(h.timers[0].cleared,true);
});

test('new messages below the fold raise the pill instead of scrolling, and near the bottom the page follows them',async()=>{
 let revision=3;
 const h=await page({'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),
  ['GET '+MESSAGES+'?since=3']:since(4,[message(M3,{seq:4,createdAt:'2026-10-21T14:10:00.000Z'})]),
  ['GET '+MESSAGES+'?since=4']:since(5,[message(M4,{seq:5,createdAt:'2026-10-21T14:11:00.000Z'})])});
 const scroller={scrollHeight:3000,scrollTop:0,clientHeight:800};h.ctx.document.scrollingElement=scroller;
 const pill=h.root.querySelector('.f-talk-new');assert.equal(pill.hidden,true);assert.equal(pill.dataset.fiiuText,'talkNew');
 revision=4;await h.tickTimers();assert.equal(pill.hidden,false);assert.equal(scroller.scrollTop,0,'a reader higher up stays where they are');
 pill.listeners.click();assert.equal(pill.hidden,true);assert.equal(scroller.scrollTop,3000);
 scroller.scrollTop=2150;revision=5;await h.tickTimers();assert.equal(pill.hidden,true);assert.equal(scroller.scrollTop,3000,'near the bottom the page follows');
});

test('earlier messages load above the first page',async()=>{
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({before:'cursor-1'}),['GET '+MESSAGES+'?before=cursor-1']:{messages:[message(M3,{createdAt:'2026-10-21T13:58:00.000Z',seq:0})],before:null}});
 const earlier=h.root.querySelector('.f-talk-earlier');assert.equal(earlier.hidden,false);
 await earlier.listeners.click();await flush();
 assert.deepEqual(rows(h).map(node=>node.dataset.id),[M3,M1,M2]);assert.equal(earlier.hidden,true);
});

test('a like on a message older than the loaded page changes nothing on screen until earlier messages are loaded',async()=>{
 let revision=3;const old=over=>message(M3,{body:'Llegué temprano',createdAt:'2026-10-21T13:58:00.000Z',...over});
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({before:'cursor-1'}),'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),
  ['GET '+MESSAGES+'?since=3']:since(4,[old({likeCount:1,seq:4})]),
  ['GET '+MESSAGES+'?since=4']:since(5,[message(M4,{seq:5,createdAt:'2026-10-21T14:10:00.000Z'})]),
  ['GET '+MESSAGES+'?before=cursor-1']:{messages:[old({likeCount:1,seq:4})],before:null}});
 const scroller={scrollHeight:3000,scrollTop:0,clientHeight:800};h.ctx.document.scrollingElement=scroller;const pill=h.root.querySelector('.f-talk-new');
 revision=4;await h.tickTimers();
 assert.deepEqual(rows(h).map(node=>node.dataset.id),[M1,M2],'no row out of context above the gap');assert.equal(pill.hidden,true,'nothing new is below');assert.equal(scroller.scrollTop,0);
 revision=5;await h.tickTimers();assert.equal(sent(h,'GET',MESSAGES+'?since=4').length,1,'the known revision still moved');
 assert.deepEqual(rows(h).map(node=>node.dataset.id),[M1,M2,M4]);assert.equal(pill.hidden,false,'a really new message still raises the pill');
 await h.root.querySelector('.f-talk-earlier').listeners.click();await flush();
 assert.deepEqual(rows(h).map(node=>node.dataset.id),[M3,M1,M2,M4]);assert.match(content(row(h,M3)),/Llegué temprano/);
});

test('a like shows at once, the server count wins, a failure reverts it, and your own messages show their count without a button',async()=>{
 const put=later();
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({messages:[message(M1,{likeCount:1,seq:1}),message(M2,{mine:true,likeCount:2,seq:2})]}),
  ['PUT /api/fiiu/messages/'+M1+'/like']:()=>put.promise,['DELETE /api/fiiu/messages/'+M1+'/like']:{status:503,data:{}}});
 const like=row(h,M1).querySelector('.f-talk-like'),count=()=>like.querySelector('.f-talk-like-n').textContent;
 assert.equal(like['aria-pressed'],'false');assert.equal(count(),'1');assert.ok(key(like,'talkLike'));
 like.listeners.click();await flush();assert.equal(like['aria-pressed'],'true');assert.equal(count(),'2','optimistic');
 like.listeners.click();await flush();assert.equal(sent(h,'PUT','/api/fiiu/messages/'+M1+'/like').length,1,'a second tap waits for the first');
 put.resolve({likeCount:5,liked:true});await flush();assert.equal(count(),'5','the server count wins');assert.equal(row(h,M1).querySelector('.f-talk-like'),like,'patched in place');
 await like.listeners.click();await flush();assert.equal(sent(h,'DELETE','/api/fiiu/messages/'+M1+'/like').length,1);
 assert.equal(like['aria-pressed'],'true');assert.equal(count(),'5','a failure reverts');assert.equal(composer(h).querySelector('.f-talk-status').dataset.fiiuText,'talkError');
 assert.equal(row(h,M2).querySelector('.f-talk-like'),null);assert.match(content(row(h,M2)),/2 likes/);
});

test('deleting your own message asks first, then removes it',async()=>{
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({messages:[message(M1,{mine:true,seq:1})]}),['DELETE /api/fiiu/messages/'+M1]:{ok:true}});
 h.ctx.window.confirm=()=>false;await key(row(h,M1),'talkDelete').listeners.click();await flush();assert.equal(sent(h,'DELETE','/api/fiiu/messages/'+M1).length,0);assert.ok(row(h,M1));
 let asked='';h.ctx.window.confirm=text=>{asked=text;return true;};await key(row(h,M1),'talkDelete').listeners.click();await flush();
 assert.equal(asked,'Delete this message for everyone?');assert.equal(row(h,M1),undefined);assert.equal(h.root.querySelector('.f-talk-empty').hidden,false);
});

const file=(name,type,size)=>({name,type,size,lastModified:1});
const b64=text=>Buffer.from(text).toString('base64');
// FileReader as the page uses it: readAsDataURL, then onload with a data: URL (blob: URLs are forbidden by the CSP).
class Reader{readAsDataURL(blob){this.result=`data:${blob.type};base64,`+b64(blob.label||blob.name);this.onload();}}
const choose=(h,files)=>{const input=composer(h).querySelector('input');input.files=files;input.listeners.change();};
const composerStatus=h=>composer(h).querySelector('.f-talk-status').dataset.fiiuText;
const chips=h=>composer(h).querySelectorAll('.f-talk-chip');

test('choosing files checks the count, the type and the PDF size before any work',async()=>{
 const h=await page(),input=composer(h).querySelector('input');
 assert.equal(input.type,'file');assert.equal(input.multiple,true);assert.equal(input.accept,'image/jpeg,image/png,image/webp,application/pdf');assert.equal(input.hidden,true);assert.ok(key(composer(h),'talkAttach'));
 choose(h,[1,2,3,4].map(i=>file(`foto${i}.jpg`,'image/jpeg',1000)));assert.equal(composerStatus(h),'talkTooManyFiles');assert.equal(chips(h).length,0);
 choose(h,[file('notas.txt','text/plain',10)]);assert.equal(composerStatus(h),'talkFileType');
 choose(h,[file('foto.heic','image/heic',10)]);assert.equal(composerStatus(h),'talkFileType');
 choose(h,[file('grande.pdf','application/pdf',4*1024*1024)]);assert.equal(composerStatus(h),'talkFileSize');
 choose(h,[file('programa.pdf','application/pdf',1000),file('foto.jpg','image/jpeg',5*1024*1024)]);assert.equal(chips(h).length,2);assert.equal(composer(h).querySelector('.f-talk-status').textContent,'');
 choose(h,[file('a.png','image/png',1),file('b.png','image/png',1)]);assert.equal(composerStatus(h),'talkTooManyFiles','3 files per message in total');assert.equal(chips(h).length,2);
 key(chips(h)[0],'talkRemoveFile').listeners.click();assert.equal(chips(h).length,1);assert.match(content(chips(h)[0]),/foto\.jpg/);
});

test('a photo the browser cannot decode is refused over 3 MB and sent as it is under, without a thumbnail',async()=>{
 const broken={createImageBitmap:async()=>{throw new Error('cannot decode');},FileReader:Reader};
 const big=await page({},{context:broken});
 big.ctx.document.createElement=(make=>tag=>tag==='canvas'?assert.fail('nothing is drawn'):make(tag))(big.ctx.document.createElement);
 const text=composer(big).querySelector('textarea');text.value='Mira esto';choose(big,[file('enorme.jpg','image/jpeg',4*1024*1024)]);
 submit(big);await flush();
 assert.equal(composerStatus(big),'talkFileSize');assert.equal(big.requests.filter(request=>request.method==='POST').length,0,'nothing is sent');
 assert.equal(rows(big).filter(node=>node.dataset.pending).length,0,'no pending or failed row is left');assert.equal(text.value,'Mira esto');assert.equal(chips(big).length,1,'the draft keeps its file');
 const small=await page({'POST /api/fiiu/files':{status:201,data:{file:{id:F1,name:'foto.jpg',mime:'image/jpeg',size:2097152,width:null,height:null,thumb:false}}},['POST '+MESSAGES]:{status:201,data:{message:message(M3,{mine:true,body:'',files:[{id:F1,name:'foto.jpg',mime:'image/jpeg',size:2097152,width:null,height:null,thumb:false}],seq:4})}}},{context:broken});
 choose(small,[file('foto.jpg','image/jpeg',2*1024*1024)]);submit(small);await flush();
 assert.deepEqual(sent(small,'POST','/api/fiiu/files').map(request=>request.body),[{name:'foto.jpg',mime:'image/jpeg',data:b64('foto.jpg')}]);
 assert.deepEqual(sent(small,'POST',MESSAGES)[0].body,{clientId:CLIENT,body:'',fileIds:[F1]});
 const image=row(small,M3).querySelector('.f-talk-image');assert.equal(image.href,'/api/fiiu/files/'+F1);assert.equal(image.target,'_blank');
 const img=image.querySelector('img');assert.equal(img.src,'/api/fiiu/files/'+F1+'?size=thumb');assert.equal(img.loading,'lazy');assert.equal(img.alt,'foto.jpg');
 assert.equal(chips(small).length,0,'the sent file leaves the draft');
});

test('a decoded photo is redrawn on white as a JPEG of at most 1600 px with a thumbnail of at most 480 px under 100 KB',async()=>{
 const drawn=[],opened=[];
 const canvas=()=>({width:0,height:0,getContext:()=>({set fillStyle(value){drawn.push('fill '+value);},fillRect(){drawn.push('rect');},drawImage(image,x,y,w,hgt){drawn.push(`draw ${w}x${hgt}`);}}),
  toBlob(callback,type,quality){callback({type,size:quality===0.7?150*1024:quality===0.5?60*1024:400*1024,label:`${this.width}x${this.height}@${quality}`});}});
 const h=await page({'POST /api/fiiu/files':request=>({status:201,data:{file:{id:request.body.mime==='application/pdf'?F2:F1,name:request.body.name,mime:request.body.mime,size:1,width:request.body.width??null,height:request.body.height??null,thumb:Boolean(request.body.thumb)}}}),
  ['POST '+MESSAGES]:{status:201,data:{message:message(M3,{mine:true,body:'Fotos',seq:4,files:[{id:F1,name:'foto.jpg',mime:'image/jpeg',size:409600,width:1600,height:1200,thumb:true},{id:F2,name:'programa.pdf',mime:'application/pdf',size:1258291,width:null,height:null,thumb:false}]})}}},
  {context:{createImageBitmap:async(source,options)=>{opened.push(options);return {width:4000,height:3000,close(){}};},FileReader:Reader}});
 h.ctx.document.createElement=(make=>tag=>tag==='canvas'?canvas():make(tag))(h.ctx.document.createElement);
 composer(h).querySelector('textarea').value='Fotos';choose(h,[file('foto.png','image/png',6*1024*1024),file('programa.pdf','application/pdf',1258291)]);submit(h);await flush();
 assert.equal(opened.length,1);assert.equal(opened[0].imageOrientation,'from-image','the photo is turned upright before it is redrawn');
 assert.deepEqual(drawn.slice(0,3),['fill #fff','rect','draw 1600x1200'],'white first, so transparency does not turn black');
 const [photo,pdf]=sent(h,'POST','/api/fiiu/files').map(request=>request.body);
 assert.deepEqual(photo,{name:'foto.jpg',mime:'image/jpeg',data:b64('1600x1200@0.85'),width:1600,height:1200,thumb:{mime:'image/jpeg',data:b64('480x360@0.5'),width:480,height:360}},'a thumbnail over 100 KB is encoded again at 0.5');
 assert.deepEqual(pdf,{name:'programa.pdf',mime:'application/pdf',data:b64('programa.pdf')});
 assert.deepEqual(sent(h,'POST',MESSAGES)[0].body.fileIds,[F1,F2]);
 const shown=row(h,M3);assert.equal(shown.querySelector('img').width,1600);assert.equal(shown.querySelector('img').height,1200);
 const pdfLink=shown.querySelector('.f-talk-file');assert.equal(pdfLink.href,'/api/fiiu/files/'+F2);assert.match(content(pdfLink),/programa\.pdf/);assert.match(content(pdfLink),/1\.2 MB/);
});

test('uploads show their progress, are not repeated by a retry, and the festival allowance is explained',async()=>{
 const message3=message(M3,{mine:true,body:'',seq:4});let posts=0;const upload=later();
 const h=await page({'POST /api/fiiu/files':()=>upload.promise,['POST '+MESSAGES]:()=>posts++?{status:201,data:{message:message3}}:{status:503,data:{}}},{context:{createImageBitmap:async()=>{throw new Error('x');},FileReader:Reader}});
 choose(h,[file('a.jpg','image/jpeg',1000)]);submit(h);await flush();
 assert.equal(rows(h).at(-1).querySelector('.f-talk-state').textContent,'Uploading 1 of 1…');
 upload.resolve({status:201,data:{file:{id:F1,name:'a.jpg',mime:'image/jpeg',size:1000,width:null,height:null,thumb:false}}});await flush();
 assert.ok(classes(rows(h).at(-1)).includes('is-failed'));
 await key(rows(h).at(-1),'talkRetry').listeners.click();await flush();
 assert.equal(sent(h,'POST','/api/fiiu/files').length,1,'the retry reuses the uploaded file');assert.deepEqual(sent(h,'POST',MESSAGES).map(request=>request.body.fileIds),[[F1],[F1]]);assert.ok(row(h,M3));
 const full=await page({'POST /api/fiiu/files':{status:413,data:{error:'festival upload allowance reached',code:'upload_allowance'}}},{context:{createImageBitmap:async()=>{throw new Error('x');},FileReader:Reader}});
 choose(full,[file('a.jpg','image/jpeg',1000)]);submit(full);await flush();
 assert.equal(composerStatus(full),'talkAllowance');assert.equal(sent(full,'POST',MESSAGES).length,0);assert.equal(rows(full).filter(node=>node.dataset.pending).length,0);
});

test('https and http addresses become links that open in a new tab, and nothing else does',async()=>{
 const body='Mira https://example.org/a?b=1. Y javascript:alert(1) o <img src=x onerror=alert(1)> (http://x.test)';
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({messages:[message(M1,{body})]})});
 const text=row(h,M1).querySelector('.f-talk-body');
 assert.deepEqual(links(text).map(a=>[a.href,a.target,a.rel,a.textContent]),[['https://example.org/a?b=1','_blank','noopener noreferrer','https://example.org/a?b=1'],['http://x.test/','_blank','noopener noreferrer','http://x.test']]);
 assert.equal(text.children.map(node=>node.textContent).join(''),body,'every character is kept, in order');
 assert.equal(descendants(text).filter(node=>node.tagName==='img').length,0,'markup in a message stays text');
 assert.ok(links(text).every(a=>!/^javascript:/i.test(a.href)));
 // f-talk-link is the shared conversation entry link (a speech-bubble glyph and a tall touch target); a URL in a message must not look like one.
 assert.deepEqual(links(text).map(a=>a.className),['f-talk-url','f-talk-url']);
});

test('a closed question is readable without a composer or likes, and a sync that closes it removes the composer',async()=>{
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({question:{status:'closed'},me:{canPost:false},messages:[message(M1,{seq:1}),message(M2,{mine:true,seq:2})]}),'GET /api/fiiu/pulse':{questions:[[Q,'day1-am',3,'closed']]}});
 assert.equal(composer(h),null);assert.ok(key(h.root,'talkClosed'));assert.equal(row(h,M1).querySelector('.f-talk-like').disabled,true);
 assert.ok(key(row(h,M2),'talkDelete'),'your own message can still be deleted');
 let state='open';
 // Closing bumps the question's revision, so the pulse moves past the page, which asks for the changes; their answer carries the closed question.
 const live=await page({['GET /api/fiiu/questions/'+Q]:()=>thread({question:{status:state,revision:state==='open'?3:4},me:{canPost:state==='open'},revision:state==='open'?3:4}),'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',state==='open'?3:4,state]]}),['GET '+MESSAGES+'?since=3']:since(4,[],{status:'closed'})});
 assert.ok(composer(live));assert.equal(row(live,M1).querySelector('.f-talk-like').disabled,false);
 state='closed';await live.tickTimers();
 assert.equal(composer(live),null);assert.ok(key(live.root,'talkClosed'));assert.equal(row(live,M1).querySelector('.f-talk-like').disabled,true);
 const closing=await page({['GET /api/fiiu/questions/'+Q]:closesOnRefusal(),['POST '+MESSAGES]:{status:403,data:{error:'question closed',code:'question_closed'}}});
 composer(closing).querySelector('textarea').value='Tarde';submit(closing);await flush();
 assert.equal(composer(closing),null,'a refusal because it closed switches the page to closed');assert.ok(key(closing.root,'talkClosed'));
});

test('a pulse the CDN cached before the question closed does not bring the composer back',async()=>{
 // The pulse can be seconds old: it only says that something moved past the page's revision, and its status is never applied.
 const closing=await page({['GET /api/fiiu/questions/'+Q]:closesOnRefusal(),['POST '+MESSAGES]:{status:403,data:{error:'question closed',code:'question_closed'}}});
 composer(closing).querySelector('textarea').value='Tarde';submit(closing);await flush();assert.equal(composer(closing),null);
 await closing.tickTimers();assert.equal(composer(closing),null,'the stale open pulse at the shown revision is ignored');assert.ok(key(closing.root,'talkClosed'));
 assert.equal(sent(closing,'GET',/since=/).length,0);
 const fresh=await page({['GET /api/fiiu/questions/'+Q]:thread({question:{status:'closed',revision:4},me:{canPost:false},revision:4})});
 await fresh.tickTimers();assert.equal(composer(fresh),null,'a first load that says closed wins over an older pulse that says open');assert.equal(row(fresh,M1).querySelector('.f-talk-like').disabled,true);
});

test('a refused send reads the question again, so an answer computed before the close cannot reopen the composer',async()=>{
 // The first read is the page load; after the refusal the page reads the question again and gets the close's revision.
 let reads=0;const loaded=thread(),closed=thread({question:{status:'closed',revision:5},me:{canPost:false},revision:5});
 const h=await page({['GET /api/fiiu/questions/'+Q]:()=>reads++?closed:loaded,['POST '+MESSAGES]:{status:403,data:{error:'question closed',code:'question_closed'}},
  'GET /api/fiiu/pulse':{questions:[[Q,'day1-am',5,'open']]},['GET '+MESSAGES+'?since=3']:since(4,[],{status:'open'})});
 composer(h).querySelector('textarea').value='Tarde';submit(h);await flush();
 assert.equal(composer(h),null);assert.equal(reads,2,'the question was read again after the refusal');
 await h.tickTimers();await flush();
 assert.equal(sent(h,'GET',/since=3/).length,1,'the pulse moved, so the page synced');
 assert.equal(composer(h),null,'an answer older than the close is ignored');assert.ok(key(h.root,'talkClosed'));
});

test('a block address lists its questions open first, opens a single one at once, and says when there are none',async()=>{
 const older=question({id:Q2,status:'closed',body:'¿Primera pregunta?',talk:null,createdAt:'2026-10-21T13:00:00.000Z'});
 const h=await page({'GET /api/fiiu/questions?activityId=day1-am':{activity:ACTIVITY,questions:[older,question()]}},{search:'?a=day1-am'});
 assert.deepEqual(links(h.root).filter(a=>a.href.startsWith('fiiu-talk.html?q=')).map(a=>a.href),['fiiu-talk.html?q='+Q,'fiiu-talk.html?q='+Q2]);
 assert.ok(key(h.root,'talkQuestions'));assert.ok(key(h.root,'talkClosedChip'),'a closed question says so');assert.equal(h.root.querySelector('h1').textContent,'El poder de lo local');
 assert.equal(h.replaced.length,0);assert.deepEqual(h.timers.map(timer=>timer.delay),[8000],'the list watches the public pulse, slowly');
 const one=await page({},{search:'?a=day1-am'});
 assert.deepEqual(one.replaced,['/fiiu-talk.html?q='+Q]);assert.ok(one.root.querySelector('.f-talk-log'));assert.equal(sent(one,'GET','/api/fiiu/questions?activityId=day1-am').length,1,'the list is not asked for twice');
 const none=await page({'GET /api/fiiu/questions?activityId=day1-am':{activity:ACTIVITY,questions:[]}},{search:'?a=day1-am'});
 assert.ok(key(none.root,'talkEmptyBlock'));assert.ok(links(none.root).some(a=>a.href==='fiiu.html#programme'));
 const unknown=await page({'GET /api/fiiu/questions?activityId=nope':{status:400,data:{error:'invalid activity',code:'invalid_activity'}}},{search:'?a=nope'});assert.ok(key(unknown.root,'talkUnavailable'));
 const siblings=await page({'GET /api/fiiu/questions?activityId=day1-am':{activity:ACTIVITY,questions:[question(),older]}});
 const more=siblings.root.querySelector('.f-talk-more');assert.equal(more.tagName,'details');assert.ok(key(more,'talkOtherQuestions'));
 assert.deepEqual(links(more).map(a=>a.href),['fiiu-talk.html?q='+Q2,'fiiu-talk.html?a=day1-am'],'the other question, then the whole block');
});

test('organisers get Hide on each message and the full name; members do not',async()=>{
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({me:{organiser:true},messages:[message(M1,{authorFull:'Ana Test',hidden:false}),message(M2,{authorFull:'Bea Ruiz',hidden:true,seq:2})]})});
 assert.ok(key(row(h,M1),'talkHide'));assert.ok(key(row(h,M2),'talkUnhide'));assert.match(content(row(h,M1)),/Ana Test/);
 const member=await page();assert.equal(key(member.root,'talkHide'),undefined);
});

test('a row replaced by a poll or by moderation keeps focus on the same control, not the first one',async()=>{
 let revision=3;const mine=over=>message(M1,{mine:true,authorFull:'Flavia Rojas',...over});
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({me:{organiser:true},messages:[mine({seq:1})]}),'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),
  ['GET '+MESSAGES+'?since=3']:since(4,[mine({likeCount:1,seq:4})]),['PUT /api/admin/fiiu/messages/'+M1+'/hidden']:{message:mine({likeCount:1,hidden:true,seq:5})}});
 // The harness has no focus tracking: the test names the focused control and lets the old row answer contains().
 const focusOn=(control)=>{const old=row(h,M1);old.contains=node=>descendants(old).includes(node);h.ctx.document.activeElement=control;};
 focusOn(key(row(h,M1),'talkHide'));revision=4;await h.tickTimers();
 assert.match(content(row(h,M1)),/1 like/,'the row was replaced');assert.equal(key(row(h,M1),'talkHide').focused,true,'Hide keeps focus');assert.notEqual(key(row(h,M1),'talkDelete').focused,true);
 focusOn(key(row(h,M1),'talkHide'));await key(row(h,M1),'talkHide').listeners.click();await flush();
 assert.equal(key(row(h,M1),'talkUnhide').focused,true,'hiding hands focus to Unhide');assert.notEqual(key(row(h,M1),'talkDelete').focused,true);
});

test('an organiser reading a hidden question follows its edits from the changes answers, without reading it again',async()=>{
 let revision=3,body='¿Qué te llevas?';
 const h=await page({['GET /api/fiiu/questions/'+Q]:()=>thread({question:{status:'hidden',body},me:{organiser:true}}),
  ['GET '+MESSAGES+'?since=3']:()=>since(revision,[],{status:'hidden',body}),['GET '+MESSAGES+'?since=4']:()=>since(4,[],{status:'hidden',body})});
 const reads=()=>sent(h,'GET','/api/fiiu/questions/'+Q).length;
 await h.tickTimers();await h.tickTimers();assert.equal(sent(h,'GET',/since=3$/).length,2);
 assert.equal(sent(h,'GET','/api/fiiu/pulse').length,0,'the public pulse leaves hidden questions out');
 revision=4;body='¿Qué te llevas de esta mañana?';await h.tickTimers();
 assert.equal(h.root.querySelector('.f-talk-question').textContent,'¿Qué te llevas de esta mañana?');assert.ok(key(h.root.querySelector('.f-talk-head'),'talkHiddenQuestion'));
 await h.tickTimers();assert.equal(sent(h,'GET',/since=4$/).length,1);assert.equal(reads(),1,'each answer carries the question, so it is never read again');
});

test('an organiser on a hidden question sees it open, with the answers that arrived in the same sync',async()=>{
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({question:{status:'hidden'},me:{organiser:true}}),'GET /api/fiiu/pulse':{questions:[[Q,'day1-am',5,'open']]},
  ['GET '+MESSAGES+'?since=3']:since(5,[message(M3,{body:'Primera',createdAt:'2026-10-21T14:10:00.000Z',authorFull:'Ana Test',hidden:false,seq:5})],{status:'open'})});
 assert.equal(composer(h),null);assert.ok(key(h.root.querySelector('.f-talk-head'),'talkHiddenQuestion'));assert.equal(row(h,M1).querySelector('.f-talk-like').disabled,true);
 await h.tickTimers();
 assert.ok(row(h,M3));assert.ok(composer(h),'the composer appears');assert.equal(key(h.root.querySelector('.f-talk-head'),'talkHiddenQuestion'),undefined);assert.equal(row(h,M1).querySelector('.f-talk-like').disabled,false);
 await h.tickTimers();assert.equal(sent(h,'GET','/api/fiiu/pulse').length,1,'an open question follows the pulse again');assert.equal(sent(h,'GET',/since=/).length,1);
});

test('a question edit that shares a sync with an answer reaches the header, and the question is not read again',async()=>{
 let revision=3;
 const h=await page({'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),
  ['GET '+MESSAGES+'?since=3']:since(5,[message(M3,{body:'Nuevo',createdAt:'2026-10-21T14:10:00.000Z',seq:5})],{body:'¿Qué ciudad te llevas de esta mañana?',talk:'Ciudades que cuidan'})});
 const text=composer(h).querySelector('textarea');text.value='borrador';text.focus();
 revision=5;await h.tickTimers();
 assert.ok(row(h,M3));assert.equal(h.root.querySelector('.f-talk-question').textContent,'¿Qué ciudad te llevas de esta mañana?');assert.equal(h.root.querySelector('.f-talk-talk').textContent,'Ciudades que cuidan');
 assert.equal(sent(h,'GET','/api/fiiu/questions/'+Q).length,1,'the answer carried the question');assert.equal(text.value,'borrador');assert.equal(text.focused,true);
});

test('a close that shares a sync with a like closes the chat even under a stale pulse, and a reopen brings the composer back',async()=>{
 let entry=[Q,'day1-am',4,'open'];
 const h=await page({'GET /api/fiiu/pulse':()=>({questions:[entry]}),
  ['GET '+MESSAGES+'?since=3']:since(5,[message(M1,{likeCount:1,seq:4})],{status:'closed'}),['GET '+MESSAGES+'?since=5']:since(6,[],{status:'open'})});
 await h.tickTimers();
 assert.equal(composer(h),null);assert.ok(key(h.root,'talkClosed'));assert.equal(row(h,M1).querySelector('.f-talk-like').disabled,true);assert.match(content(row(h,M1)),/1/);
 entry=[Q,'day1-am',5,'closed'];await h.tickTimers();assert.equal(sent(h,'GET',/since=/).length,1,'nothing is newer than the page');
 entry=[Q,'day1-am',6,'open'];await h.tickTimers();
 assert.ok(composer(h));assert.equal(key(h.root,'talkClosed'),undefined);assert.equal(row(h,M1).querySelector('.f-talk-like').disabled,false);
});

const SPANISH={talkPage:'Conversación',talkEmpty:'Todavía no hay mensajes. Sé la primera persona en responder.',talkPlaceholder:'Escribe tu respuesta…',talkSend:'Enviar',talkOrganiser:'Organización FIIU',
 talkClosed:'Esta conversación está cerrada. Puedes seguir leyéndola.',talkSignIn:'Inicia sesión para participar',talkRegister:'Inscríbete en el FIIU para participar',talkNew:'Mensajes nuevos ↓'};
const REQUIRED=['talkPage','talkQuestions','talkOtherQuestions','talkEmpty','talkPlaceholder','talkSend','talkSending','talkNotSent','talkRetry','talkAttach','talkRemoveFile','talkUploading','talkFileType','talkFileSize','talkTooManyFiles','talkAllowance','talkCharsLeft',
 'talkLike','talkLikes','talkDelete','talkDeleteConfirm','talkOrganiser','talkClosed','talkUnavailable','talkSignIn','talkSignInHint','talkRegister','talkRegisterHint','talkNew','talkLoadEarlier','talkPaused','talkHide','talkUnhide','talkHidden','talkBackToBlock','talkOpenFull','talkError','talkRate','talkEmptyBlock',
 'talkPresent','talkLatest','talkTop','talkFullscreen','talkScanToJoin','talkHiddenForYou','talkReused','talkNotRegistered'];

test('every chat string has English, Spanish and Portuguese, the Spanish follows the plan, and a language switch relabels the page',async()=>{
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({messages:[message(M1,{mine:true,likeCount:3})]})}),strings=h.ctx.window.Fiiu.rows;
 const talk=Object.entries(strings).filter(([name])=>name.startsWith('talk'));
 for(const [name,texts] of talk)assert.ok(Array.isArray(texts)&&texts.length===3&&texts.every(text=>typeof text==='string'&&text.trim()),name);
 assert.deepEqual(REQUIRED.filter(name=>!strings[name]),[]);
 const used=[...readFileSync(new URL('../web/scripts/fiiu-talk.js',import.meta.url),'utf8').matchAll(/'(talk[A-Z]\w*)'/g)].map(match=>match[1]);
 assert.deepEqual([...new Set(used)].filter(name=>!strings[name]),[],'every key the page uses resolves');
 assert.deepEqual(Object.fromEntries(Object.keys(SPANISH).map(name=>[name,strings[name][1]])),SPANISH);
 assert.equal(strings.talkCharsLeft[1].includes('{n}'),true);assert.equal(strings.talkUploading[2].includes('{current}')&&strings.talkUploading[2].includes('{total}'),true);
 const text=composer(h).querySelector('textarea');text.value='x'.repeat(990);text.listeners.input();
 h.lang('es');
 assert.equal(h.ctx.document.title,'NODAL · Conversación');assert.equal(text.placeholder,'Escribe tu respuesta…');assert.equal(h.root.querySelector('.f-talk-log')['aria-label'],'Conversación');
 assert.equal(composer(h).querySelector('.f-talk-left').textContent,'Quedan 10 caracteres');assert.match(content(row(h,M1)),/3 me gusta/);
 h.lang('pt');assert.match(content(row(h,M1)),/3 curtidas/);
});

test('a language switch with an empty composer relabels the placeholder, the file sizes and the log',async()=>{
 const pdf={id:F2,name:'programa.pdf',mime:'application/pdf',size:1258291,width:null,height:null,thumb:false};
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({messages:[message(M1,{files:[pdf]})]})});
 const text=composer(h).querySelector('textarea'),size=()=>row(h,M1).querySelector('.f-talk-size').textContent;
 assert.equal(composer(h).querySelector('.f-talk-left').hidden,true,'the counter is not shown yet');assert.equal(size(),'1.2 MB');
 h.lang('pt');
 assert.equal(text.placeholder,'Escreva sua resposta…');assert.equal(size(),'1,2 MB','sizes follow the language’s number format');
 assert.equal(h.root.querySelector('.f-talk-log')['aria-label'],'Conversa');assert.equal(h.ctx.document.title,'NODAL · Conversa');
 assert.equal(composer(h).querySelector('.f-talk-left').hidden,true,'the hidden counter stays hidden');
 h.lang('es');assert.equal(text.placeholder,'Escribe tu respuesta…');
});

// Organiser moderation on the chat page.
test('an organiser hides a message with PUT and unhides it with DELETE; a hidden message stays on the organiser’s screen, greyed with the Hidden chip',async()=>{
 let revision=3;const hide=later();const ana=over=>message(M1,{authorFull:'Ana Test',hidden:false,...over}),bea=over=>message(M2,{author:'Bea R.',authorFull:'Bea Ruiz',hidden:false,createdAt:'2026-10-21T14:07:00.000Z',...over});
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({me:{organiser:true},messages:[ana({seq:1}),bea({seq:2})]}),
  ['PUT /api/admin/fiiu/messages/'+M1+'/hidden']:()=>hide.promise,['DELETE /api/admin/fiiu/messages/'+M1+'/hidden']:{message:ana({seq:5})},
  'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),['GET '+MESSAGES+'?since=3']:since(6,[ana({seq:5}),bea({hidden:true,seq:6})]),
  ['DELETE /api/admin/fiiu/messages/'+M2+'/hidden']:{status:404,data:{error:'not found'}}});
 const text=composer(h).querySelector('textarea');text.value='borrador';
 assert.ok(key(row(h,M1),'talkHide'));assert.ok(!classes(row(h,M1)).includes('is-hidden'));assert.equal(key(row(h,M1),'talkHidden'),undefined);
 key(row(h,M1),'talkHide').listeners.click();key(row(h,M1),'talkHide').listeners.click();await flush();
 assert.equal(sent(h,'PUT','/api/admin/fiiu/messages/'+M1+'/hidden').length,1,'a second tap waits for the first');
 hide.resolve({message:ana({hidden:true,seq:4})});await flush();
 assert.ok(classes(row(h,M1)).includes('is-hidden'));assert.ok(key(row(h,M1),'talkHidden'),'the Hidden chip');assert.ok(key(row(h,M1),'talkUnhide'));assert.equal(key(row(h,M1),'talkHide'),undefined);
 assert.match(content(row(h,M1)),/Hola a todas/,'the organiser still reads it');
 await key(row(h,M1),'talkUnhide').listeners.click();await flush();
 assert.equal(sent(h,'DELETE','/api/admin/fiiu/messages/'+M1+'/hidden').length,1);
 assert.ok(!classes(row(h,M1)).includes('is-hidden'));assert.equal(key(row(h,M1),'talkHidden'),undefined);assert.ok(key(row(h,M1),'talkHide'));
 // The server sends organisers full views of hidden messages in since results, so a message hidden from another screen stays here, marked.
 revision=6;await h.tickTimers();
 assert.deepEqual(rows(h).map(node=>node.dataset.id),[M1,M2]);assert.ok(classes(row(h,M2)).includes('is-hidden'));assert.ok(key(row(h,M2),'talkHidden'));assert.ok(key(row(h,M2),'talkUnhide'));
 assert.equal(text.value,'borrador','moderation never touches the draft');
 // A message its author deleted meanwhile is gone: unhiding it removes the row instead of showing an error.
 await key(row(h,M2),'talkUnhide').listeners.click();await flush();
 assert.equal(row(h,M2),undefined);assert.equal(composer(h).querySelector('.f-talk-status').textContent,'');
});

test('a member sees no moderation controls, and a message an organiser hides leaves the member’s screen within one poll',async()=>{
 let revision=3;
 const h=await page({'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),['GET '+MESSAGES+'?since=3']:since(4,[{id:M1,seq:4,gone:true}])});
 assert.equal(key(h.root,'talkHide'),undefined);assert.equal(key(h.root,'talkUnhide'),undefined);assert.equal(h.root.querySelectorAll('.f-talk-hide').length,0);
 const text=composer(h).querySelector('textarea');text.value='a medio escribir';text.focus();
 revision=4;await h.tickTimers();
 assert.deepEqual(rows(h).map(node=>node.dataset.id),[M2]);assert.equal(text.value,'a medio escribir');assert.equal(text.focused,true);
 assert.equal(h.requests.filter(request=>request.path.startsWith('/api/admin/')).length,0);
});

// The review round: likes kept between syncs, authors' hidden messages, replayed sends, upload limits and refusals by code.
test('a sync keeps the liked state the page knows, since changes carry no liked flag',async()=>{
 let revision=3;const bea=over=>message(M2,{author:'Bea R.',createdAt:'2026-10-21T14:07:00.000Z',...over});
 // The first read names what you liked in its liked list, as well as (or instead of) each message's flag.
 const h=await page({['GET /api/fiiu/questions/'+Q]:{...thread({messages:[bare(message(M1,{likeCount:2,seq:1})),bea({likeCount:1,liked:false,seq:2})]}),liked:[M1]},
  'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),['PUT /api/fiiu/messages/'+M2+'/like']:{likeCount:2,liked:true},
  ['GET '+MESSAGES+'?since=3']:since(4,[bare(message(M1,{likeCount:3,seq:4}))]),['GET '+MESSAGES+'?since=4']:since(5,[bare(bea({likeCount:2,seq:5}))])});
 const pressed=id=>row(h,id).querySelector('.f-talk-like')['aria-pressed'],count=id=>row(h,id).querySelector('.f-talk-like-n').textContent;
 assert.equal(pressed(M1),'true','seeded from the liked list');assert.equal(pressed(M2),'false');
 revision=4;await h.tickTimers();assert.equal(pressed(M1),'true','a change without the flag keeps it');assert.equal(count(M1),'3');
 await row(h,M2).querySelector('.f-talk-like').listeners.click();await flush();assert.equal(pressed(M2),'true');
 revision=5;await h.tickTimers();assert.equal(pressed(M2),'true','your like survives the next sync');assert.equal(count(M2),'2');
});

test('your own message hidden by the organisers stays on your screen, greyed with its chip and Delete, and you can delete it',async()=>{
 let revision=3;const mine=over=>message(M1,{mine:true,likeCount:1,seq:1,...over});
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({messages:[mine({hidden:true}),message(M2,{author:'Bea R.',createdAt:'2026-10-21T14:07:00.000Z',seq:2})]}),
  'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),['GET '+MESSAGES+'?since=3']:since(4,[mine({hidden:false,seq:4})]),['GET '+MESSAGES+'?since=4']:since(5,[mine({hidden:true,seq:5})]),
  ['DELETE /api/fiiu/messages/'+M1]:{ok:true}});
 const hidden=row(h,M1);
 assert.ok(classes(hidden).includes('is-hidden'));assert.ok(key(hidden,'talkHiddenForYou'),'the author is told why');assert.equal(key(hidden,'talkHidden'),undefined);
 assert.equal(hidden.querySelector('.f-talk-like'),null);assert.ok(key(hidden,'talkDelete'));assert.equal(key(hidden,'talkUnhide'),undefined,'a participant cannot unhide');
 assert.equal(h.ctx.window.Fiiu.t('talkHiddenForYou'),'Hidden by the organisers');
 revision=4;await h.tickTimers();assert.ok(!classes(row(h,M1)).includes('is-hidden'));assert.equal(key(row(h,M1),'talkHiddenForYou'),undefined);
 revision=5;await h.tickTimers();assert.ok(key(row(h,M1),'talkHiddenForYou'),'hidden again, still on the author’s screen');
 await key(row(h,M1),'talkDelete').listeners.click();await flush();
 assert.equal(sent(h,'DELETE','/api/fiiu/messages/'+M1).length,1);assert.equal(row(h,M1),undefined);
});

test('a Retry answered with the message already removed clears the draft and leaves no row behind',async()=>{
 let posts=0;
 const h=await page({['POST '+MESSAGES]:()=>posts++?{status:200,data:{message:{id:M3,seq:5,gone:true}}}:{status:503,data:{}}});
 const text=composer(h).querySelector('textarea');text.value='Se fue';submit(h);await flush();
 await key(rows(h).find(node=>classes(node).includes('is-failed')),'talkRetry').listeners.click();await flush();
 assert.deepEqual(rows(h).map(node=>node.dataset.id),[M1,M2],'no blank row and no pending or failed copy');
 assert.equal(text.value,'','it was delivered, then removed');assert.equal(composerStatus(h),'');
});

test('a Retry refused because its earlier copy can no longer be finished keeps the row, and the next try is a new message with its files uploaded again',async()=>{
 let posts=0,uploads=0;const answers=[{status:503,data:{}},{status:409,data:{error:'client id already used for another message',code:'client_id_reused'}},{status:201,data:{message:message(M3,{mine:true,body:'Otra vez',createdAt:'2026-10-21T14:20:00.000Z',seq:6})}}];
 const h=await page({'POST /api/fiiu/files':()=>({status:201,data:{file:{id:[F1,F2][uploads++],name:'a.jpg',mime:'image/jpeg',size:1000,width:null,height:null,thumb:false}}}),['POST '+MESSAGES]:()=>answers[posts++]},
  {context:{createImageBitmap:async()=>{throw new Error('x');},FileReader:Reader}});
 const text=composer(h).querySelector('textarea'),failed=()=>rows(h).find(node=>classes(node).includes('is-failed'));
 text.value='Otra vez';choose(h,[file('a.jpg','image/jpeg',1000)]);submit(h);await flush();
 await key(failed(),'talkRetry').listeners.click();await flush();
 assert.ok(failed(),'still Not sent, with Retry');assert.match(content(failed()),/Otra vez/,'the row keeps the message');assert.equal(text.value,'');assert.equal(composerStatus(h),'talkReused');
 await key(failed(),'talkRetry').listeners.click();await flush();
 const posted=sent(h,'POST',MESSAGES).map(request=>request.body);
 assert.equal(posted[1].clientId,posted[0].clientId,'a plain Retry repeats the clientId');assert.notEqual(posted[2].clientId,posted[1].clientId,'after the refusal, a new one');
 assert.deepEqual(posted.map(body=>body.fileIds),[[F1],[F1],[F2]],'the earlier copy took its files with it, so they are uploaded again');
 assert.deepEqual(rows(h).map(node=>node.dataset.id),[M1,M2,M3]);assert.equal(text.value,'');
});

test('uploads get two minutes before they are abandoned, every other request keeps the 20 s limit',async()=>{
 const limits=[];let upload=null;
 const h=await page({'POST /api/fiiu/files':()=>{upload=limits.at(-1);return {status:201,data:{file:{id:F2,name:'programa.pdf',mime:'application/pdf',size:1000,width:null,height:null,thumb:false}}};},
  ['POST '+MESSAGES]:{status:201,data:{message:message(M3,{mine:true,body:'',seq:4})}}},{context:{FileReader:Reader,AbortSignal:{timeout:ms=>{limits.push(ms);return {ms};}}}});
 choose(h,[file('programa.pdf','application/pdf',3*1024*1024)]);submit(h);await flush();
 assert.equal(upload,120000);assert.ok(row(h,M3));assert.deepEqual(limits.filter(ms=>ms!==20000),[120000],'only the upload waits longer');assert.ok(limits.length>=3);
});

test('a file name over 120 characters is shortened before upload, keeping its extension and whole characters',async()=>{
 const names=[],drawn=()=>({width:0,height:0,getContext:()=>({set fillStyle(value){},fillRect(){},drawImage(){}}),toBlob(callback,type){callback({type,size:1000,label:'jpeg'});}});
 const answer={'POST /api/fiiu/files':request=>{names.push(request.body.name);return {status:201,data:{file:{id:F1,name:request.body.name,mime:request.body.mime,size:1,width:null,height:null,thumb:false}}};},['POST '+MESSAGES]:{status:201,data:{message:message(M3,{mine:true,body:'',seq:4})}}};
 const long='Informe de la mesa de trabajo sobre movilidad urbana y espacio público en Lima Metropolitana, versión revisada por el equipo organizador';
 const raw=await page(answer,{context:{createImageBitmap:async()=>{throw new Error('x');},FileReader:Reader}});
 choose(raw,[file(long+'.pdf','application/pdf',1000),file('😀'.repeat(100)+'.png','image/png',1000),file('corto.pdf','application/pdf',10)]);submit(raw);await flush();
 assert.equal(names[0].length,120);assert.ok(names[0].endsWith('.pdf'));assert.ok(names[0].startsWith('Informe de la mesa'));
 assert.equal(names[1],'😀'.repeat(58)+'.png','an emoji is never cut in half');assert.equal(names[2],'corto.pdf','a short name is sent as it is');
 const redrawn=await page(answer,{context:{createImageBitmap:async()=>({width:800,height:600,close(){}}),FileReader:Reader}});
 redrawn.ctx.document.createElement=(make=>tag=>tag==='canvas'?drawn():make(tag))(redrawn.ctx.document.createElement);
 choose(redrawn,[file(long+'.png','image/png',1000)]);submit(redrawn);await flush();
 assert.equal(names[3].length,120);assert.ok(names[3].endsWith('.jpg'),'a redrawn photo is a JPEG');assert.ok(sent(raw,'POST',MESSAGES).length&&sent(redrawn,'POST',MESSAGES).length);
});

test('a failed like shows the row as the server last described it, including a count a sync brought meanwhile',async()=>{
 let revision=3;const put=later();
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({messages:[message(M1,{likeCount:4,seq:1}),message(M2,{mine:true,createdAt:'2026-10-21T14:07:00.000Z',seq:2})]}),
  'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),['GET '+MESSAGES+'?since=3']:since(4,[bare(message(M1,{likeCount:5,seq:4}))]),['PUT /api/fiiu/messages/'+M1+'/like']:()=>put.promise});
 const like=()=>row(h,M1).querySelector('.f-talk-like'),count=()=>like().querySelector('.f-talk-like-n').textContent;
 like().listeners.click();await flush();assert.equal(count(),'5','optimistic');assert.equal(like()['aria-pressed'],'true');
 revision=4;await h.tickTimers();assert.equal(like()['aria-pressed'],'true','the like on its way still shows after the row is replaced');
 put.resolve({status:429,data:{error:'too many requests'}});await flush();
 assert.equal(count(),'5','the count the sync brought, not the 4 seen before the tap');assert.equal(like()['aria-pressed'],'false');assert.equal(composerStatus(h),'talkRate');
});

test('organisers get no Like on a hidden message, which shows its count instead, and reopening the question does not add one',async()=>{
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({question:{status:'closed'},me:{organiser:true,canPost:false},messages:[message(M1,{authorFull:'Ana Test',hidden:false,seq:1}),message(M2,{author:'Bea R.',authorFull:'Bea Ruiz',hidden:true,likeCount:2,createdAt:'2026-10-21T14:07:00.000Z',seq:2})]}),
  'GET /api/fiiu/pulse':{questions:[[Q,'day1-am',4,'open']]},['GET '+MESSAGES+'?since=3']:since(4,[],{status:'open'})});
 assert.equal(row(h,M2).querySelector('.f-talk-like'),null);assert.match(content(row(h,M2)),/2 likes/);assert.ok(key(row(h,M2),'talkUnhide'));assert.ok(key(row(h,M2),'talkHidden'));
 await h.tickTimers();
 assert.ok(composer(h),'reopened');assert.equal(row(h,M1).querySelector('.f-talk-like').disabled,false);assert.equal(row(h,M2).querySelector('.f-talk-like'),null);
});

test('a like on a message removed a moment ago takes the row away without an error, and one refused as closed closes the chat',async()=>{
 const h=await page({['PUT /api/fiiu/messages/'+M1+'/like']:{status:404,data:{error:'message unavailable',code:'message_unavailable'}}});
 await row(h,M1).querySelector('.f-talk-like').listeners.click();await flush();
 assert.equal(row(h,M1),undefined);assert.equal(composer(h).querySelector('.f-talk-status').textContent,'','no error');assert.deepEqual(rows(h).map(node=>node.dataset.id),[M2]);
 const closed=await page({['GET /api/fiiu/questions/'+Q]:closesOnRefusal(),['PUT /api/fiiu/messages/'+M1+'/like']:{status:403,data:{error:'this conversation is closed',code:'question_closed'}}});
 await row(closed,M1).querySelector('.f-talk-like').listeners.click();await flush();
 assert.equal(composer(closed),null);assert.ok(key(closed.root,'talkClosed'));assert.equal(row(closed,M1).querySelector('.f-talk-like').disabled,true);assert.equal(row(closed,M1).querySelector('.f-talk-like')['aria-pressed'],'false');
});

test('refusals of a send say what happened in the person’s language, and only those Retry can fix keep a Retry',async()=>{
 const cases=[
  ['message',{status:429,data:{error:'too many requests'}},'talkRate',true],
  ['message',{status:403,data:{error:'festival registration required',code:'not_registered'}},'talkNotRegistered',false],
  ['message',{status:409,data:{error:'client id already used for another message',code:'client_id_reused'}},'talkReused',true],
  ['file',{status:413,data:{error:'festival upload allowance reached',code:'upload_allowance'}},'talkAllowance',false],
  ['file',{status:400,data:{error:'unsupported file type',code:'file_type'}},'talkFileType',false],
  ['file',{status:413,data:{error:'file exceeds 3 MB',code:'file_size'}},'talkFileSize',false],
 ];
 for(const [where,answer,expected,retry] of cases){
  const h=await page({'POST /api/fiiu/files':where==='file'?answer:{status:201,data:{file:{id:F1,name:'a.pdf',mime:'application/pdf',size:1,width:null,height:null,thumb:false}}},['POST '+MESSAGES]:where==='message'?answer:{status:500,data:{}}},{context:{FileReader:Reader}});
  const text=composer(h).querySelector('textarea');text.value='Hola';if(where==='file')choose(h,[file('a.pdf','application/pdf',1000)]);submit(h);await flush();
  // What Retry can fix stays in its row; what it cannot goes back to the composer to be fixed.
  assert.equal(composerStatus(h),expected,expected);assert.equal(text.value,retry?'':'Hola',expected);
  const failed=rows(h).find(node=>classes(node).includes('is-failed'));assert.equal(Boolean(failed),retry,expected+(retry?' keeps Retry':' leaves no row'));if(failed)assert.match(content(failed),/Hola/);
 }
 const h=await page({['POST '+MESSAGES]:{status:403,data:{error:'festival registration required',code:'not_registered'}}});
 composer(h).querySelector('textarea').value='Hola';submit(h);await flush();h.lang('es');
 assert.equal(composer(h).querySelector('.f-talk-status').textContent,'Necesitas una inscripción en el FIIU para participar.');
});

// The projector view (?present=1).
function bits(size,dark){const bytes=Buffer.alloc(Math.ceil(size*size/8));for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(dark(x,y)){const i=y*size+x;bytes[i>>3]|=0x80>>(i&7);}return bytes.toString('base64');}
const QR={size:21,bits:bits(21,(x,y)=>y===0||(x===20&&y===20))},JOIN='https://nodal.example/fiiu-talk.html?q='+Q,QR_PATH='/api/admin/fiiu/questions/'+Q+'/qr';
const M5='10000000-0000-4000-8000-000000000005';
// The projector as an organiser. The first question read waits until the test has given the document what the harness lacks: a class list that records
// the projector class and, unless fullscreen is false, full screen on the root element.
async function projector(routes={},over={},{fullscreen=true,search='?q='+Q+'&present=1',context={}}={}){
 const gate=later(),added=new Set(),read=routes['GET /api/fiiu/questions/'+Q]??(()=>thread({...over,me:{organiser:true,...over.me}}));
 const h=await page({['GET '+QR_PATH]:{url:JOIN,qr:QR},...routes,['GET /api/fiiu/questions/'+Q]:request=>gate.promise.then(()=>typeof read==='function'?read(request):read)},{search,context});
 h.body.classList={add:name=>added.add(name),remove:name=>added.delete(name),toggle(){},contains:name=>added.has(name)};
 if(fullscreen)h.ctx.document.documentElement.requestFullscreen=async function(){h.ctx.document.fullscreenElement=this;await h.fire('fullscreenchange');};
 gate.resolve();await flush();return Object.assign(h,{added});
}
const cards=h=>h.root.querySelectorAll('.f-talk-wall-msg');
const order=h=>cards(h).map(node=>node.dataset.id);
const WALL=[message(M1,{likeCount:5,seq:1,authorFull:'Ana Test',hidden:false}),
 message(M2,{author:'Flavia R.',organiser:true,body:'Bienvenidas',createdAt:'2026-10-21T14:07:00.000Z',likeCount:1,seq:2,authorFull:'Flavia Rojas',hidden:false}),
 message(M3,{author:'Bea R.',body:'Con foto',createdAt:'2026-10-21T14:09:00.000Z',seq:3,authorFull:'Bea Ruiz',hidden:false,files:[{id:F1,name:'foto.jpg',mime:'image/jpeg',size:1000,width:1600,height:1200,thumb:true}]}),
 message(M4,{body:'Fuera de tono',createdAt:'2026-10-21T14:10:00.000Z',seq:4,authorFull:'Otro Nombre',hidden:true})];

test('the projector shows the question large with a join QR and the latest answers, without a composer, likes or moderation, and Most liked reorders them',async()=>{
 const h=await projector({},{messages:WALL});
 assert.equal(sent(h,'GET',QR_PATH).length,1);assert.ok(h.added.has('f-talk-present'),'the page switches to the projector layout');
 const wall=h.root.querySelector('.f-talk-wall');assert.ok(wall);
 const headline=wall.querySelector('.f-talk-wall-question');assert.equal(headline.tagName,'h1');assert.equal(headline.textContent,'¿Qué te llevas de esta mañana?');
 assert.match(content(wall.querySelector('.f-talk-wall-head')),/El poder de lo local/);assert.match(content(wall.querySelector('.f-talk-wall-head')),/¡Bienvenidos al FIIU 11!/);
 const svgs=h.root.querySelectorAll('svg');assert.equal(svgs.length,1);const svg=svgs[0];
 assert.equal(svg.viewBox,'0 0 29 29','a 4-module quiet zone around 21 modules');assert.equal(svg.role,'img');assert.equal(svg['aria-label'],'Scan to join the conversation');
 const paths=svg.querySelectorAll('path');assert.equal(paths.length,1,'the code is one path');assert.equal(paths[0].d,'M4 4h21v1h-21zM24 24h1v1h-1z');
 assert.ok(key(wall,'talkScanToJoin'));
 assert.equal(wall.querySelector('.f-talk-wall-url').textContent,'nodal.example/fiiu-talk.html?a=day1-am','under the code, the block address people can type');
 assert.equal(composer(h),null);assert.equal(h.root.querySelectorAll('form').length,0);assert.equal(h.root.querySelectorAll('.f-talk-like').length,0);
 assert.equal(key(h.root,'talkHide'),undefined);assert.equal(key(h.root,'talkUnhide'),undefined);assert.equal(key(h.root,'talkDelete'),undefined);assert.equal(h.root.querySelector('.f-talk-log'),null);
 assert.deepEqual(order(h),[M3,M2,M1],'latest first, and the hidden message is not projected');
 const card=id=>cards(h).find(node=>node.dataset.id===id);
 assert.ok(key(card(M2),'talkOrganiser'));assert.match(content(card(M1)),/5 likes/);assert.match(content(card(M1)),/Hola a todas/);assert.doesNotMatch(content(card(M1)),/Ana Test/,'only the display name');
 const img=card(M3).querySelector('img');assert.equal(img.src,'/api/fiiu/files/'+F1+'?size=thumb');assert.equal(img.alt,'foto.jpg');assert.equal(img.width,1600);
 const latest=key(wall,'talkLatest'),top=key(wall,'talkTop');assert.equal(latest['aria-pressed'],'true');assert.equal(top['aria-pressed'],'false');
 top.listeners.click();assert.deepEqual(order(h),[M1,M2,M3],'most liked first');assert.equal(top['aria-pressed'],'true');assert.equal(latest['aria-pressed'],'false');
 latest.listeners.click();assert.deepEqual(order(h),[M3,M2,M1]);
 assert.equal(sent(h,'GET','/api/fiiu/questions?activityId=day1-am').length,0,'no list of the other questions');
 assert.equal(h.ctx.document.title,'NODAL · Projector view');
});

test('the projector follows the poll: a new answer leads, a removed one leaves, at most 12 show, and closing the question says so',async()=>{
 const many=Array.from({length:14},(_,i)=>message('20000000-0000-4000-8000-'+String(i).padStart(12,'0'),{body:'Respuesta '+i,createdAt:new Date(Date.parse('2026-10-21T14:00:00.000Z')+i*60000).toISOString(),seq:i+1}));
 let revision=14,state='open';
 const h=await projector({'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,state]]}),
  ['GET '+MESSAGES+'?since=14']:since(16,[message(M5,{body:'La última',createdAt:'2026-10-21T14:30:00.000Z',likeCount:2,seq:15}),{id:many[13].id,seq:16,gone:true}]),
  ['GET '+MESSAGES+'?since=16']:since(17,[],{status:'closed'})},{messages:many,revision:14,question:{revision:14}});
 assert.equal(order(h).length,12);assert.equal(order(h)[0],many[13].id);assert.equal(order(h)[11],many[2].id);
 const kept=cards(h).find(node=>node.dataset.id===many[12].id);
 revision=16;await h.tickTimers();
 assert.equal(order(h)[0],M5);assert.ok(!order(h).includes(many[13].id));assert.equal(order(h).length,12);assert.equal(order(h)[11],many[2].id,'one arrived and one left');
 assert.equal(cards(h).find(node=>node.dataset.id===many[12].id),kept,'an unchanged answer keeps its element, so its image is not fetched again');
 key(h.root,'talkTop').listeners.click();assert.equal(order(h)[0],M5,'the only liked answer leads Most liked');
 revision=17;state='closed';await h.tickTimers();
 assert.ok(key(h.root.querySelector('.f-talk-wall-head'),'talkClosedChip'));assert.equal(composer(h),null,'closing never brings a composer to the projector');
 const hidden=await projector({['GET '+MESSAGES+'?since=3']:since(3,[],{status:'hidden'})},{question:{status:'hidden'}});
 assert.ok(key(hidden.root.querySelector('.f-talk-wall-head'),'talkHiddenQuestion'),'the organiser sees the room cannot open it yet');
 await hidden.tickTimers();assert.equal(sent(hidden,'GET','/api/fiiu/pulse').length,0,'the pulse leaves hidden questions out');assert.equal(sent(hidden,'GET',MESSAGES+'?since=3').length,1);
});

test('present=1 for a member renders the normal chat and asks for no QR',async()=>{
 const h=await page({},{search:'?q='+Q+'&present=1'});
 assert.ok(composer(h));assert.ok(h.root.querySelector('.f-talk-log'));assert.equal(h.root.querySelector('.f-talk-wall'),null);
 assert.equal(sent(h,'GET',QR_PATH).length,0);assert.equal(h.requests.filter(request=>request.path.startsWith('/api/admin/')).length,0);assert.equal(h.locks.length,0);
 assert.equal(h.ctx.document.title,'NODAL · Conversation');
 const organiser=await page({['GET /api/fiiu/questions/'+Q]:thread({me:{organiser:true}})});
 assert.ok(composer(organiser),'an organiser without present=1 gets the chat');assert.equal(sent(organiser,'GET',QR_PATH).length,0);
});

test('the projector keeps the screen awake, takes the lock again after the tab returns, and lets it go when the session ends',async()=>{
 let revision=3;
 const h=await projector({'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),['GET '+MESSAGES+'?since=3']:{status:401,data:{error:'sign in required'}}});
 assert.equal(h.locks.length,1);assert.equal(h.locks[0].type,'screen');
 await h.visible(true);await flush();assert.equal(h.locks.length,1,'a lock still held is not asked for twice');
 h.locks[0].lock.released=true;await h.visible(true);await flush();assert.equal(h.locks.length,2,'the browser let it go while hidden, so it is taken again');
 revision=4;await h.tickTimers();
 assert.ok(key(h.root,'talkSignIn'));assert.equal(h.root.querySelector('.f-talk-wall'),null);assert.equal(h.added.has('f-talk-present'),false,'the page leaves the projector layout');
 assert.equal(h.locks[1].lock.released,true);await h.visible(true);await flush();assert.equal(h.locks.length,2);
});

test('Full screen covers the whole page and its label follows the state; a browser without it shows no button',async()=>{
 const h=await projector(),full=key(h.root,'talkFullscreen');assert.ok(full);
 await full.listeners.click();assert.equal(h.ctx.document.fullscreenElement,h.ctx.document.documentElement);assert.equal(full.dataset.fiiuText,'exitFullScreen');assert.equal(full.textContent,'Exit full screen');
 await full.listeners.click();assert.equal(h.ctx.document.fullscreenElement,null);assert.equal(full.dataset.fiiuText,'talkFullscreen');
 const bare=await projector({},{},{fullscreen:false});assert.equal(key(bare.root,'talkFullscreen'),undefined);assert.ok(bare.root.querySelector('.f-talk-wall'));
});

test('without a QR the projector keeps the question, the address and the answers, and a failed request is tried again a minute later',async()=>{
 const Clock=clock();let up=false;
 const none=await projector({['GET '+QR_PATH]:{url:JOIN,qr:null}},{},{context:{Date:Clock}});
 assert.equal(none.root.querySelectorAll('svg').length,0);assert.equal(key(none.root,'talkScanToJoin'),undefined,'no "scan" without a code');
 assert.equal(none.root.querySelector('.f-talk-wall-url').textContent,'nodal.example/fiiu-talk.html?a=day1-am');
 Clock.advance(60000);await none.tickTimers();await flush();assert.equal(sent(none,'GET',QR_PATH).length,1,'a code the server could not draw is not asked for again');
 const Later=clock();
 const down=await projector({['GET '+QR_PATH]:()=>up?{url:JOIN,qr:QR}:{status:503,data:{error:'unavailable'}}},{},{context:{Date:Later}});
 assert.equal(down.root.querySelectorAll('svg').length,0);assert.equal(down.root.querySelector('.f-talk-wall-code').hidden,true);assert.equal(cards(down).length,2);assert.ok(down.root.querySelector('.f-talk-wall-question'));
 up=true;await down.tickTimers();await flush();assert.equal(sent(down,'GET',QR_PATH).length,1,'not before a minute has passed');
 Later.advance(60000);await down.tickTimers();await flush();
 assert.equal(sent(down,'GET',QR_PATH).length,2);assert.equal(down.root.querySelectorAll('svg').length,1);assert.equal(down.root.querySelector('.f-talk-wall-code').hidden,false);
 Later.advance(60000);await down.tickTimers();await flush();assert.equal(sent(down,'GET',QR_PATH).length,2,'a drawn code stays');
 const broken=await projector({['GET '+QR_PATH]:{url:JOIN,qr:{size:21,bits:'AAAA'}}});assert.equal(broken.root.querySelectorAll('svg').length,0,'too few bits draw nothing');
});

test('a language switch relabels the projector',async()=>{
 const h=await projector({},{messages:[message(M1,{likeCount:3})]});
 h.lang('es');
 assert.equal(h.ctx.document.title,'NODAL · Vista de proyección');assert.equal(h.root.querySelector('svg')['aria-label'],'Escanea para unirte a la conversación');
 assert.equal(key(h.root,'talkTop').textContent,'Con más me gusta');assert.equal(key(h.root,'talkScanToJoin').textContent,'Escanea para unirte a la conversación');assert.match(content(cards(h)[0]),/3 me gusta/);
 h.lang('pt');assert.equal(key(h.root,'talkLatest').textContent,'Recentes');assert.equal(key(h.root,'talkFullscreen').textContent,'Tela cheia');
});

test('the projector headline follows a question edit that arrives with answers',async()=>{
 let revision=3;
 const h=await projector({'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),
  ['GET '+MESSAGES+'?since=3']:since(5,[message(M3,{body:'Nueva',createdAt:'2026-10-21T14:10:00.000Z',seq:5})],{body:'¿Qué ciudad imaginas?',talk:null})});
 revision=5;await h.tickTimers();
 assert.equal(order(h)[0],M3);assert.equal(h.root.querySelector('.f-talk-wall-question').textContent,'¿Qué ciudad imaginas?');
 assert.equal(h.root.querySelector('.f-talk-wall-head').querySelector('.f-talk-talk'),null,'the talk was taken off');
});

// Round 3: the composer hands each draft to its row, drafts outlive closes and reloads, and the page follows its block.
test('sending empties the composer at once, so a caption typed while a photo uploads is a new text message and the photo is uploaded once',async()=>{
 const upload=later();let n=0;
 const h=await page({'POST /api/fiiu/files':()=>upload.promise,['POST '+MESSAGES]:request=>({status:201,data:{message:message('30000000-0000-4000-8000-00000000000'+n++,{mine:true,body:request.body.body,createdAt:'2026-10-21T14:2'+n+':00.000Z',seq:4+n})}})},
  {context:{createImageBitmap:async()=>{throw new Error('x');},FileReader:Reader}});
 const text=composer(h).querySelector('textarea'),photo=file('feria.jpg','image/jpeg',1000);
 choose(h,[photo]);submit(h);await flush();
 assert.equal(text.value,'');assert.equal(chips(h).length,0,'the photo left the composer with its message');assert.equal(composer(h).querySelector('.f-talk-chips').hidden,true);
 assert.equal(rows(h).at(-1).querySelector('.f-talk-state').textContent,'Uploading 1 of 1…');
 text.value='Esta es la feria de mi barrio';text.listeners.input();submit(h);await flush();
 assert.equal(text.value,'');assert.deepEqual(sent(h,'POST',MESSAGES).map(request=>request.body.fileIds),[[]],'the caption goes on its own, without the photo');
 // The very same draft again while it is on its way is already in its row: the composer empties and nothing new is sent.
 choose(h,[photo]);submit(h);await flush();assert.equal(chips(h).length,0);assert.equal(rows(h).filter(node=>node.dataset.pending).length,1);
 // The same photo in another message while its first upload runs waits for that upload instead of sending the bytes twice.
 text.value='Otra vez la foto';choose(h,[photo]);submit(h);await flush();
 upload.resolve({status:201,data:{file:{id:F1,name:'feria.jpg',mime:'image/jpeg',size:1000,width:null,height:null,thumb:false}}});await flush();
 assert.equal(sent(h,'POST','/api/fiiu/files').length,1,'one upload');
 assert.deepEqual(sent(h,'POST',MESSAGES).map(request=>[request.body.body,request.body.fileIds]),[['Esta es la feria de mi barrio',[]],['',[F1]],['Otra vez la foto',[F1]]]);
});

test('a refusal Retry cannot fix puts the draft back in an empty composer; a draft typed meanwhile is never overwritten',async()=>{
 const refuse={status:403,data:{error:'festival registration required',code:'not_registered'}};
 const h=await page({['POST '+MESSAGES]:refuse});
 const text=composer(h).querySelector('textarea');text.value='Hola';submit(h);assert.equal(text.value,'','handed to its row at once');await flush();
 assert.equal(text.value,'Hola');assert.equal(composerStatus(h),'talkNotRegistered');
 const answer=later(),busy=await page({['POST '+MESSAGES]:()=>answer.promise});
 const box=composer(busy).querySelector('textarea');box.value='Primero';submit(busy);await flush();box.value='Otra cosa';
 answer.resolve(refuse);await flush();assert.equal(box.value,'Otra cosa');assert.equal(composerStatus(busy),'talkNotRegistered');
});

// sessionStorage as the page uses it; broken() is a browser that blocks site data, where every call throws.
const memoryStore=(seed={})=>{const items=new Map(Object.entries(seed));return {items,getItem:name=>items.has(name)?items.get(name):null,setItem:(name,value)=>{items.set(name,String(value));},removeItem:name=>{items.delete(name);}};};
const blocked={getItem(){throw new Error('denied');},setItem(){throw new Error('denied');},removeItem(){throw new Error('denied');}};
// The harness tracks no focus: a test names the focused element, and contains() answers for it.
const focusInside=(h,node)=>{h.ctx.document.activeElement=node;for(const box of [h.root,...descendants(h.root)])box.contains=child=>child===box||descendants(box).includes(child);};
const DRAFT_KEY='nodal.talkDraft.'+Q;

test('a half-typed answer is kept per question for the tab, so a reload or a sign-in round trip brings it back, and sending drops it',async()=>{
 const sessionStorage=memoryStore();
 const h=await page({['POST '+MESSAGES]:{status:201,data:{message:message(M3,{mine:true,body:'Mi borrador',seq:4})}}},{context:{sessionStorage}});
 const text=composer(h).querySelector('textarea');text.value='Mi borrador';text.listeners.input();
 assert.equal(sessionStorage.items.get(DRAFT_KEY),'Mi borrador');
 const again=await page({},{context:{sessionStorage}});
 assert.equal(composer(again).querySelector('textarea').value,'Mi borrador','the reloaded page restores it');
 submit(h);assert.equal(sessionStorage.items.has(DRAFT_KEY),false,'a sent draft is not restored again');
 text.value='   ';text.listeners.input();assert.equal(sessionStorage.items.has(DRAFT_KEY),false,'an empty composer stores nothing');
 // A refusal that puts the draft back stores it again.
 const refused=await page({['POST '+MESSAGES]:{status:403,data:{error:'festival registration required',code:'not_registered'}}},{context:{sessionStorage}});
 const box=composer(refused).querySelector('textarea');box.value='Sin inscripción';submit(refused);await flush();assert.equal(sessionStorage.items.get(DRAFT_KEY),'Sin inscripción');
 const denied=await page({},{context:{sessionStorage:blocked}});const typed=composer(denied).querySelector('textarea');typed.value='Hola';typed.listeners.input();
 assert.equal(typed.value,'Hola','without storage the draft stays on screen');
});

test('a close while someone types keeps the draft readable under the closed note, moves focus to the note, and a reopen gives the composer back with it',async()=>{
 let state='open',revision=3;
 const routes={'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,state]]}),['GET '+MESSAGES+'?since=3']:since(4,[],{status:'closed'}),['GET '+MESSAGES+'?since=4']:since(5,[],{status:'open'})};
 const h=await page(routes);
 const text=composer(h).querySelector('textarea');text.value='En mi barrio cambiaría el giro';text.listeners.input();focusInside(h,text);
 revision=4;state='closed';await h.tickTimers();
 const dock=h.root.querySelector('.f-talk-dock'),note=key(dock,'talkClosed');
 assert.equal(composer(h),null);assert.equal(note.focused,true,'focus stays in the dock, on the note');assert.equal(note.tabIndex,-1);
 assert.ok(key(dock,'talkDraftKept'));const kept=dock.querySelector('.f-talk-draft-text');assert.equal(kept.value,'En mi barrio cambiaría el giro','the draft can still be read and copied');assert.equal(kept.readOnly,true);
 assert.equal(h.root.querySelector('.f-talk-live').textContent,'','a focused note reads itself, so nothing is said twice');
 revision=5;state='open';await h.tickTimers();
 assert.equal(composer(h).querySelector('textarea'),text);assert.equal(text.value,'En mi barrio cambiaría el giro');
 // Someone reading the conversation, not typing, hears the close from the status line.
 const reader=await page({...routes,['GET '+MESSAGES+'?since=3']:since(4,[],{status:'closed'})});revision=4;state='closed';await reader.tickTimers();
 const live=reader.root.querySelector('.f-talk-live');assert.equal(live.textContent,'This conversation is closed. You can still read it.');assert.equal(live.role,'status');
 assert.equal(reader.root.querySelector('.f-talk-draft').hidden,true,'no draft, no draft block');
 // A first load on a closed question announces nothing.
 const closed=await page({['GET /api/fiiu/questions/'+Q]:thread({question:{status:'closed'},me:{canPost:false}})});assert.equal(closed.root.querySelector('.f-talk-live').textContent,'');
});

test('a sign-in asked for by a poll takes focus to its heading, and the draft is waiting when the person comes back',async()=>{
 const sessionStorage=memoryStore();let revision=3;
 const h=await page({'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),['GET '+MESSAGES+'?since=3']:{status:401,data:{error:'sign in required'}}},{context:{sessionStorage}});
 const text=composer(h).querySelector('textarea');text.value='Casi termino';text.listeners.input();focusInside(h,text);
 revision=4;await h.tickTimers();
 const heading=key(h.root,'talkSignIn');assert.equal(heading.focused,true);assert.equal(heading.tabIndex,-1);
 const back=await page({},{context:{sessionStorage}});assert.equal(composer(back).querySelector('textarea').value,'Casi termino');
});

test('an empty question says it closed without answers, or for organisers that it is not open yet, and a question’s Hidden chip agrees with pregunta',async()=>{
 const closed=await page({['GET /api/fiiu/questions/'+Q]:thread({question:{status:'closed'},me:{canPost:false},messages:[]})});
 const empty=closed.root.querySelector('.f-talk-empty');assert.equal(empty.hidden,false);assert.equal(empty.dataset.fiiuText,'talkEmptyClosed');
 closed.lang('es');assert.equal(empty.textContent,'Esta pregunta se cerró sin respuestas.');
 let revision=3;
 const live=await page({['GET /api/fiiu/questions/'+Q]:thread({messages:[]}),'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),['GET '+MESSAGES+'?since=3']:since(4,[],{status:'closed'})});
 assert.equal(live.root.querySelector('.f-talk-empty').dataset.fiiuText,'talkEmpty');revision=4;await live.tickTimers();
 assert.equal(live.root.querySelector('.f-talk-empty').dataset.fiiuText,'talkEmptyClosed','a close re-keys the empty line');
 const hidden=await page({['GET /api/fiiu/questions/'+Q]:thread({question:{status:'hidden'},me:{organiser:true},messages:[]})});
 assert.equal(hidden.root.querySelector('.f-talk-empty').dataset.fiiuText,'talkEmptyHidden');
 const chip=key(hidden.root.querySelector('.f-talk-head'),'talkHiddenQuestion');assert.ok(chip);hidden.lang('es');assert.equal(chip.textContent,'Oculta');
 const block=await page({'GET /api/fiiu/questions?activityId=day1-am':{activity:ACTIVITY,questions:[question(),question({id:Q2,status:'hidden'})]}},{search:'?a=day1-am'});
 assert.ok(key(block.root,'talkHiddenQuestion'));assert.equal(key(block.root,'talkHidden'),undefined,'Oculto stays for messages');
 const wall=await projector({},{question:{status:'closed'},messages:[]});assert.equal(wall.root.querySelector('.f-talk-wall-empty').dataset.fiiuText,'talkEmptyClosed');
});

const note=h=>h.root.querySelector('.f-talk-dock').querySelector('.f-talk-note');
const offline=()=>{throw new Error('offline');};

test('paused updates show in the dock where the reader is, a lost connection is named, and coming back online polls at once',async()=>{
 let up=false;
 const h=await page({'GET /api/fiiu/pulse':()=>up?{questions:[[Q,'day1-am',3,'open']]}:offline(),['POST '+MESSAGES]:offline,['PUT /api/fiiu/messages/'+M1+'/like']:offline});
 await h.tickTimers();
 assert.equal(note(h).dataset.fiiuText,'talkPausedOffline');assert.equal(note(h).role,'status');assert.equal(h.message.textContent,'','not at the top of the page, far above the reader');
 const text=composer(h).querySelector('textarea');text.value='Mensaje sin conexión';submit(h);await flush();
 assert.equal(composerStatus(h),'talkOfflineSend','the send says the connection failed and that Retry will work');assert.ok(rows(h).find(node=>classes(node).includes('is-failed')));
 await row(h,M1).querySelector('.f-talk-like').listeners.click();await flush();assert.equal(composerStatus(h),'talkOffline');
 up=true;const pulses=sent(h,'GET','/api/fiiu/pulse').length;
 await Promise.all((h.windowListeners.online||[]).map(listener=>listener({type:'online'})));
 assert.equal(sent(h,'GET','/api/fiiu/pulse').length,pulses+1,'back online, the page asks at once instead of waiting out the backoff');assert.equal(note(h).textContent,'');
 const down=await page({'GET /api/fiiu/pulse':{status:503,data:{}}});await down.tickTimers();assert.equal(note(down).dataset.fiiuText,'talkPaused','a server outage is not called a lost connection');
 h.lang('es');assert.equal(h.ctx.window.Fiiu.t('talkOfflineSend'),'Sin conexión. Tu mensaje sigue aquí: toca Reintentar cuando vuelvas a tener señal.');
});

test('without a composer, a failed Hide shows its error in the dock, and the next action that works clears it',async()=>{
 let fail=true;const ana=over=>message(M1,{authorFull:'Ana Test',hidden:false,...over});
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({question:{status:'closed'},me:{organiser:true,canPost:false},messages:[ana({seq:1})]}),
  ['PUT /api/admin/fiiu/messages/'+M1+'/hidden']:()=>fail?{status:503,data:{}}:{message:ana({hidden:true,seq:4})}});
 await key(row(h,M1),'talkHide').listeners.click();await flush();
 assert.equal(note(h).dataset.fiiuText,'talkError');assert.equal(note(h).textContent,'Something went wrong. Try again.');assert.equal(h.message.textContent,'','not at the top of the page');
 fail=false;await key(row(h,M1),'talkHide').listeners.click();await flush();assert.equal(note(h).textContent,'');assert.ok(classes(row(h,M1)).includes('is-hidden'));
});

const LIST='/api/fiiu/questions?activityId=day1-am';

test('when the question closes and another on its block opens, the other questions follow the pulse and the closed note leads to the open one',async()=>{
 let pulse=[[Q,'day1-am',3,'open']],list=[question()];
 const h=await page({'GET /api/fiiu/pulse':()=>({questions:pulse}),['GET '+LIST]:()=>({activity:ACTIVITY,questions:list}),['GET '+MESSAGES+'?since=3']:since(4,[],{status:'closed'})});
 assert.equal(h.root.querySelector('.f-talk-more'),null);await h.tickTimers();assert.equal(sent(h,'GET',LIST).length,1,'an unchanged block is not read again');
 const fresh=question({id:Q2,body:'¿Y mañana?',createdAt:'2026-10-21T15:00:00.000Z'});
 pulse=[[Q2,'day1-am',1,'open'],[Q,'day1-am',4,'closed'],['cccccccc-cccc-4ccc-8ccc-cccccccccccc','day2-am',7,'open']];list=[fresh,question({status:'closed',revision:4})];
 await h.tickTimers();
 assert.equal(sent(h,'GET',LIST).length,2,'one read for the change');assert.equal(composer(h),null);
 assert.deepEqual(links(h.root.querySelector('.f-talk-more')).map(a=>a.href),['fiiu-talk.html?q='+Q2,'fiiu-talk.html?a=day1-am']);
 const next=key(h.root.querySelector('.f-talk-dock'),'talkNextOpen');assert.equal(next.hidden,false);assert.equal(next.href,'fiiu-talk.html?q='+Q2);
 await h.tickTimers();await h.tickTimers();assert.equal(sent(h,'GET',LIST).length,2,'the same pulse reads nothing more');
 pulse=[[Q2,'day1-am',2,'closed'],[Q,'day1-am',4,'closed']];list=[question({id:Q2,status:'closed'}),question({status:'closed',revision:4})];await h.tickTimers();
 assert.equal(sent(h,'GET',LIST).length,3);assert.equal(next.hidden,true,'no open question, no link');
 h.lang('es');assert.equal(next.textContent,'Responder la pregunta abierta');
});

test('organisers see hidden questions in the block list, which the public pulse leaves out, without reading the list on every poll',async()=>{
 const draft=question({id:Q2,status:'hidden',body:'Borrador'});
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({question:{status:'closed'},me:{organiser:true,canPost:false}}),['GET '+LIST]:{activity:ACTIVITY,questions:[question({status:'closed'}),draft]}});
 await h.tickTimers();await h.tickTimers();assert.equal(sent(h,'GET',LIST).length,1);
 assert.equal(key(h.root.querySelector('.f-talk-dock'),'talkNextOpen').hidden,true,'a hidden question is no way forward');
});

test('a block page follows the pulse: an empty block opens its question by itself, and a list picks up a new one without a reload',async()=>{
 let pulse=[],list=[];
 const h=await page({'GET /api/fiiu/pulse':()=>({questions:pulse}),['GET '+LIST]:()=>({activity:ACTIVITY,questions:list})},{search:'?a=day1-am'});
 assert.ok(key(h.root,'talkEmptyBlock'));assert.equal(h.timers.length,1);assert.equal(h.timers[0].delay,8000,'a slow watch of the public pulse');
 await h.tickTimers();assert.equal(sent(h,'GET',LIST).length,1,'nothing changed');
 pulse=[['cccccccc-cccc-4ccc-8ccc-cccccccccccc','day2-am',7,'open']];await h.tickTimers();assert.equal(sent(h,'GET',LIST).length,1,'another block changes nothing here');
 await h.visible(false);pulse=[[Q,'day1-am',3,'open']];list=[question()];const pulses=sent(h,'GET','/api/fiiu/pulse').length;await h.tickTimers();
 assert.equal(sent(h,'GET','/api/fiiu/pulse').length,pulses,'a hidden tab does not watch');
 await h.visible(true);await h.tickTimers();await flush();
 assert.deepEqual(h.replaced,['/fiiu-talk.html?q='+Q],'the single question opens, as on a first load');assert.ok(composer(h));
 assert.equal(h.timers[0].cleared,true,'the watch stops');assert.equal(h.timers.filter(timer=>!timer.cleared).length,1,'the chat polls instead');
 const Q3='dddddddd-dddd-4ddd-8ddd-dddddddddddd',older=question({id:Q3,status:'closed',body:'¿Primera?',createdAt:'2026-10-21T13:00:00.000Z'});
 pulse=[[Q,'day1-am',3,'open'],[Q3,'day1-am',2,'closed']];list=[question(),older];
 const many=await page({'GET /api/fiiu/pulse':()=>({questions:pulse}),['GET '+LIST]:()=>({activity:ACTIVITY,questions:list})},{search:'?a=day1-am'});
 await many.tickTimers();assert.equal(sent(many,'GET',LIST).length,1);
 pulse=[...pulse,[Q2,'day1-am',1,'open']];list=[...list,question({id:Q2,body:'¿Otra?',createdAt:'2026-10-21T15:00:00.000Z'})];
 await many.tickTimers();await flush();
 assert.deepEqual(links(many.root).filter(a=>a.href.startsWith('fiiu-talk.html?q=')).map(a=>a.href),['fiiu-talk.html?q='+Q2,'fiiu-talk.html?q='+Q,'fiiu-talk.html?q='+Q3],'the new question joins the list');
 assert.equal(many.message.textContent,'','a refresh shows no loading line');
});

test('a question not open to this viewer keeps watching the pulse and opens by itself, draft and all, once the organisers open it',async()=>{
 const Clock=clock();let reads=0,shown=false,pulse=[];
 const h=await page({['GET /api/fiiu/questions/'+Q]:()=>{reads++;return shown?thread():{status:404,data:{error:'not found',code:'question_unavailable'}};},'GET /api/fiiu/pulse':()=>({questions:pulse})},{context:{Date:Clock}});
 assert.ok(key(h.root,'talkUnavailable'));assert.equal(h.timers.length,1);await h.tickTimers();assert.equal(reads,1,'still not in the pulse');
 shown=true;pulse=[[Q,'day1-am',3,'open']];await h.tickTimers();await flush();
 assert.equal(reads,2);assert.ok(composer(h),'opened by itself');assert.equal(h.timers[0].cleared,true);
 // Hidden again while someone types: the same composer comes back with the draft once the question is open again.
 const text=composer(h).querySelector('textarea');text.value='Mi borrador';text.listeners.input();
 shown=false;pulse=[];await h.tickTimers();assert.ok(key(h.root,'talkUnavailable'));
 shown=true;pulse=[[Q,'day1-am',4,'open']];await h.tickTimers();await flush();
 assert.equal(composer(h).querySelector('textarea'),text);assert.equal(text.value,'Mi borrador');
 // The watch ends after two hours.
 shown=false;pulse=[];await h.tickTimers();const watch=h.timers.at(-1);assert.equal(watch.cleared,undefined);
 Clock.advance(2*3600000+1);await h.tickTimers();assert.equal(watch.cleared,true);
});

// Accessibility: focus clear of the dock and never lost, announcements, and row controls that say whose message they act on.
test('the page measures the sticky dock for the stylesheet, so a focused message control is scrolled clear of it',async()=>{
 const observers=[];class ResizeObserver{constructor(callback){this.callback=callback;this.targets=[];this.disconnected=false;observers.push(this);}observe(node){this.targets.push(node);}disconnect(){this.disconnected=true;}}
 let revision=3;
 const h=await page({'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),['GET '+MESSAGES+'?since=3']:{status:401,data:{error:'sign in required'}}},{context:{ResizeObserver}});
 const box=h.root.querySelector('.f-talk'),dock=box.querySelector('.f-talk-dock'),set={};box.style={setProperty:(name,value)=>{set[name]=value;}};
 assert.equal(observers.length,1);assert.deepEqual(observers[0].targets,[dock]);
 dock.offsetHeight=154;observers[0].callback();assert.equal(set['--f-talk-dock-h'],'154px');
 revision=4;await h.tickTimers();assert.equal(observers[0].disconnected,true,'a page that leaves the chat lets the dock go');
 const css=readFileSync(new URL('../web/styles/fiiu-talk.css',import.meta.url),'utf8');
 assert.match(css,/\.f-talk-log :is\(a,button,\[tabindex\]\)[^{]*\{scroll-margin-bottom:calc\(var\(--f-talk-dock-h,140px\) \+ 16px\)\}/);
 assert.match(css,/@media\(max-height:480px\)\{[^\n]*\.f-talk-dock\{position:static\}/,'on a landscape phone or at high zoom the dock stops covering the chat');
 assert.doesNotMatch(css,/is-hidden[^{]*\.f-talk-body[^{]*\{opacity/,'hidden messages stay readable for the organisers deciding on them');
});

test('deleting a message moves focus to the next message, else the previous one, else the composer, and says it was deleted',async()=>{
 const mine=(id,over)=>message(id,{mine:true,...over});
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({messages:[mine(M1,{seq:1}),message(M2,{author:'Bea R.',createdAt:'2026-10-21T14:07:00.000Z',seq:2}),mine(M3,{createdAt:'2026-10-21T14:09:00.000Z',seq:3})]}),
  ['DELETE /api/fiiu/messages/'+M1]:{ok:true},['DELETE /api/fiiu/messages/'+M3]:{ok:true}});
 const like=row(h,M2).querySelector('.f-talk-like');
 await key(row(h,M1),'talkDelete').listeners.click();await flush();
 assert.equal(row(h,M1),undefined);assert.equal(like.focused,true,'the next message');assert.equal(h.root.querySelector('.f-talk-live').textContent,'Message deleted');
 like.focused=false;await key(row(h,M3),'talkDelete').listeners.click();await flush();
 assert.equal(like.focused,true,'the last one hands focus back to the previous message');assert.equal(h.root.querySelector('.f-talk-live').textContent,'Message deleted ','the same news is said again');
 const only=await page({['GET /api/fiiu/questions/'+Q]:thread({messages:[mine(M1,{seq:1})]}),['DELETE /api/fiiu/messages/'+M1]:{ok:true}});
 await key(row(only,M1),'talkDelete').listeners.click();await flush();assert.equal(composer(only).querySelector('textarea').focused,true,'with no message left, the composer');
});

test('the last page of earlier messages hands focus to the newest of them before its button goes',async()=>{
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({before:'cursor-1'}),['GET '+MESSAGES+'?before=cursor-1']:{messages:[message(M4,{createdAt:'2026-10-21T13:57:00.000Z',seq:0}),message(M3,{createdAt:'2026-10-21T13:58:00.000Z',seq:0})],before:null}});
 const earlier=h.root.querySelector('.f-talk-earlier');await earlier.listeners.click();await flush();
 assert.equal(earlier.hidden,true);assert.equal(row(h,M3).tabIndex,-1);assert.equal(row(h,M3).focused,true);assert.notEqual(row(h,M4).focused,true);
});

test('answers from other people are announced once per poll, your own and a reload are not, and the pill is no longer a live region',async()=>{
 let revision=3;const beto=(id,minute,over)=>message(id,{author:'Beto Q.',createdAt:`2026-10-21T14:${minute}:00.000Z`,...over});
 const h=await page({'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),
  ['GET '+MESSAGES+'?since=3']:since(4,[beto(M3,10,{seq:4})]),['GET '+MESSAGES+'?since=4']:since(6,[beto(M4,11,{seq:5}),beto(M5,12,{author:'Carla V.',seq:6})]),
  ['GET '+MESSAGES+'?since=6']:since(7,[message('10000000-0000-4000-8000-000000000006',{mine:true,createdAt:'2026-10-21T14:13:00.000Z',seq:7}),beto(M3,10,{likeCount:2,seq:8})].map(view=>({...view,seq:Math.max(view.seq,7)})))});
 const live=h.root.querySelector('.f-talk-live'),pill=h.root.querySelector('.f-talk-new');
 assert.equal(pill['aria-live'],undefined);assert.equal(live.textContent,'','the first load says nothing');
 revision=4;await h.tickTimers();assert.equal(live.textContent,'1 new answer from Beto Q.');
 revision=6;await h.tickTimers();assert.equal(live.textContent,'2 new answers');
 revision=7;await h.tickTimers();assert.equal(live.textContent,'2 new answers','your own message and a like say nothing');
 h.lang('es');assert.equal(h.ctx.window.Fiiu.t('talkNewOne'),'1 respuesta nueva de {author}');
});

test('like, delete and hide buttons are described by their message’s author and time',async()=>{
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({me:{organiser:true},messages:[message(M1,{authorFull:'Ana Test',hidden:false,seq:1}),message(M2,{mine:true,authorFull:'Flavia Rojas',hidden:false,createdAt:'2026-10-21T14:07:00.000Z',seq:2})]})});
 const meta=row(h,M1).querySelector('.f-talk-meta');assert.equal(meta.id,'f-talk-m-'+M1);
 assert.equal(row(h,M1).querySelector('.f-talk-like')['aria-describedby'],meta.id);assert.equal(key(row(h,M1),'talkHide')['aria-describedby'],meta.id);
 assert.equal(key(row(h,M2),'talkDelete')['aria-describedby'],'f-talk-m-'+M2);
});

test('following the chat stops where the conversation ends, so the footer stays below the docked composer',async()=>{
 let revision=3;
 const h=await page({'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),['GET '+MESSAGES+'?since=3']:since(4,[message(M3,{seq:4,createdAt:'2026-10-21T14:10:00.000Z'})]),
  ['GET '+MESSAGES+'?since=4']:since(5,[message(M4,{seq:5,createdAt:'2026-10-21T14:11:00.000Z'})])});
 // The document is 3000 px tall on an 800 px screen; the conversation (its dock included) ends at 2700, above the shell's padding and the footer.
 const scroller={scrollHeight:3000,scrollTop:1850,clientHeight:800};h.ctx.document.scrollingElement=scroller;
 h.root.querySelector('.f-talk').getBoundingClientRect=()=>({bottom:2700-scroller.scrollTop});const pill=h.root.querySelector('.f-talk-new');
 revision=4;await h.tickTimers();assert.equal(scroller.scrollTop,1900,'the dock’s bottom on the screen’s bottom, not the end of the document');assert.equal(pill.hidden,true);
 scroller.scrollTop=2200;revision=5;await h.tickTimers();assert.equal(pill.hidden,true,'a reader who scrolled on to the footer still counts as following');
});
