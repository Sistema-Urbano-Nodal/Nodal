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
 assert.ok(key(hidden.root,'talkUnavailable'));assert.ok(links(hidden.root).some(a=>a.href==='fiiu.html#programme'));assert.equal(hidden.timers.length,0);
 // An outage is an error with a retry, never "signed out".
 let calls=0;const down=await page({['GET /api/fiiu/questions/'+Q]:()=>calls++?thread():{status:503,data:{}}});
 assert.ok(key(down.root,'talkError'));assert.equal(key(down.root,'talkSignIn'),undefined);
 await key(down.root,'retry').listeners.click();await flush();assert.ok(down.root.querySelector('.f-talk-log'));assert.equal(down.timers.length,1);
 const broken=await page({},{search:'?q=nope'});assert.ok(key(broken.root,'talkUnavailable'));assert.equal(broken.requests.length,0,'a malformed address asks the server nothing');
});

test('a message appears at once as sending; a failure keeps the draft and offers Retry with the same clientId; success shows the server row',async()=>{
 const answers=[later(),later()];let n=0;
 const h=await page({['POST '+MESSAGES]:()=>answers[n++].promise});
 const text=composer(h).querySelector('textarea');text.value='  Me llevo la idea de barrio  ';text.focus();
 submit(h);await flush();
 submit(h);await flush();assert.equal(sent(h,'POST',MESSAGES).length,1,'a second tap while sending posts nothing');assert.equal(rows(h).filter(node=>node.dataset.pending).length,1);
 const pending=rows(h).at(-1);assert.ok(classes(pending).includes('is-pending'));assert.ok(key(pending,'talkSending'));assert.equal(content(pending.querySelector('.f-talk-body')).trim(),'Me llevo la idea de barrio');
 answers[0].resolve({status:503,data:{error:'unavailable'}});await flush();
 const failed=rows(h).at(-1);assert.ok(classes(failed).includes('is-failed'));assert.ok(key(failed,'talkNotSent'));assert.ok(key(failed,'talkRetry'));
 assert.equal(text.value,'  Me llevo la idea de barrio  ','the draft survives a failure');assert.equal(composer(h).querySelector('.f-talk-status').dataset.fiiuText,'talkError');
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
 const h=await page({['POST '+MESSAGES]:()=>posts++?{status:200,data:{message:mine}}:{status:503,data:{}},'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',revision,'open']]}),['GET '+MESSAGES+'?since=3']:{revision:4,changes:[mine],liked:[]}});
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
  ['GET '+MESSAGES+'?since=3']:{revision:5,changes:[message(M3,{body:'Nuevo',createdAt:'2026-10-21T14:06:00.000Z',seq:4}),{id:M1,seq:5,gone:true}],liked:[]}});
 const text=composer(h).querySelector('textarea');text.value='borrador';text.focus();
 await h.tickTimers();assert.equal(sent(h,'GET','/api/fiiu/pulse').length,1);assert.equal(sent(h,'GET',/since=/).length,0,'an unchanged revision fetches nothing');
 revision=5;await h.tickTimers();assert.equal(sent(h,'GET',/since=/).length,1);
 assert.deepEqual(rows(h).map(node=>node.dataset.id),[M3,M2],'the new message takes its place by time and the gone one leaves');
 assert.equal(text.value,'borrador');assert.equal(text.focused,true);assert.ok(descendants(h.root).includes(text),'the composer is the same element');
 await h.tickTimers();assert.equal(sent(h,'GET',/since=/).length,1,'the known revision moved to 5');
 await h.visible(false);await h.tickTimers();assert.equal(sent(h,'GET','/api/fiiu/pulse').length,3,'a hidden tab does not poll');
 await h.visible(true);await flush();assert.equal(sent(h,'GET','/api/fiiu/pulse').length,4,'coming back polls at once');
});

test('a failing pulse backs off exponentially, says updates are paused, and recovers',async()=>{
 const Clock=clock();let up=false;
 const h=await page({'GET /api/fiiu/pulse':()=>up?{questions:[[Q,'day1-am',3,'open']]}:{status:503,data:{}}},{context:{Date:Clock}});
 const pulses=()=>sent(h,'GET','/api/fiiu/pulse').length;
 await h.tickTimers();assert.equal(pulses(),1);assert.equal(h.message.dataset.fiiuText,'talkPaused');
 Clock.advance(8000);await h.tickTimers();assert.equal(pulses(),2,'8 s after the first failure');
 Clock.advance(8000);await h.tickTimers();assert.equal(pulses(),2,'after 2 failures the next try waits 16 s');
 Clock.advance(8000);up=true;await h.tickTimers();assert.equal(pulses(),3);assert.equal(h.message.textContent,'');
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
  ['GET '+MESSAGES+'?since=3']:{revision:4,changes:[message(M3,{seq:4,createdAt:'2026-10-21T14:10:00.000Z'})],liked:[]},
  ['GET '+MESSAGES+'?since=4']:{revision:5,changes:[message(M4,{seq:5,createdAt:'2026-10-21T14:11:00.000Z'})],liked:[]}});
 const scroller={scrollHeight:3000,scrollTop:0,clientHeight:800};h.ctx.document.scrollingElement=scroller;
 const pill=h.root.querySelector('.f-talk-new');assert.equal(pill.hidden,true);assert.equal(pill['aria-live'],'polite');assert.equal(pill.dataset.fiiuText,'talkNew');
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
});

test('a closed question is readable without a composer or likes, and a pulse that closes it removes the composer',async()=>{
 const h=await page({['GET /api/fiiu/questions/'+Q]:thread({question:{status:'closed'},me:{canPost:false},messages:[message(M1,{seq:1}),message(M2,{mine:true,seq:2})]}),'GET /api/fiiu/pulse':{questions:[[Q,'day1-am',3,'closed']]}});
 assert.equal(composer(h),null);assert.ok(key(h.root,'talkClosed'));assert.equal(row(h,M1).querySelector('.f-talk-like').disabled,true);
 assert.ok(key(row(h,M2),'talkDelete'),'your own message can still be deleted');
 let state='open';
 const live=await page({['GET /api/fiiu/questions/'+Q]:()=>thread({question:{status:state,revision:4},me:{canPost:state==='open'},revision:4}),'GET /api/fiiu/pulse':()=>({questions:[[Q,'day1-am',state==='open'?3:4,state]]}),['GET '+MESSAGES+'?since=3']:{revision:4,changes:[],liked:[]}});
 assert.ok(composer(live));assert.equal(row(live,M1).querySelector('.f-talk-like').disabled,false);
 state='closed';await live.tickTimers();
 assert.equal(composer(live),null);assert.ok(key(live.root,'talkClosed'));assert.equal(row(live,M1).querySelector('.f-talk-like').disabled,true);
 const closing=await page({['POST '+MESSAGES]:{status:403,data:{error:'question closed',code:'question_closed'}}});
 composer(closing).querySelector('textarea').value='Tarde';submit(closing);await flush();
 assert.equal(composer(closing),null,'a refusal because it closed switches the page to closed');assert.ok(key(closing.root,'talkClosed'));
});

test('a block address lists its questions open first, opens a single one at once, and says when there are none',async()=>{
 const older=question({id:Q2,status:'closed',body:'¿Primera pregunta?',talk:null,createdAt:'2026-10-21T13:00:00.000Z'});
 const h=await page({'GET /api/fiiu/questions?activityId=day1-am':{activity:ACTIVITY,questions:[older,question()]}},{search:'?a=day1-am'});
 assert.deepEqual(links(h.root).filter(a=>a.href.startsWith('fiiu-talk.html?q=')).map(a=>a.href),['fiiu-talk.html?q='+Q,'fiiu-talk.html?q='+Q2]);
 assert.ok(key(h.root,'talkQuestions'));assert.ok(key(h.root,'talkClosedChip'),'a closed question says so');assert.equal(h.root.querySelector('h1').textContent,'El poder de lo local');
 assert.equal(h.replaced.length,0);assert.equal(h.timers.length,0);
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

const SPANISH={talkPage:'Conversación',talkEmpty:'Todavía no hay mensajes. Sé la primera persona en responder.',talkPlaceholder:'Escribe tu respuesta…',talkSend:'Enviar',talkOrganiser:'Organización FIIU',
 talkClosed:'Esta conversación está cerrada. Puedes seguir leyéndola.',talkSignIn:'Inicia sesión para participar',talkRegister:'Inscríbete en el FIIU para participar',talkNew:'Mensajes nuevos ↓'};
const REQUIRED=['talkPage','talkQuestions','talkOtherQuestions','talkEmpty','talkPlaceholder','talkSend','talkSending','talkNotSent','talkRetry','talkAttach','talkRemoveFile','talkUploading','talkFileType','talkFileSize','talkTooManyFiles','talkAllowance','talkCharsLeft',
 'talkLike','talkLikes','talkDelete','talkDeleteConfirm','talkOrganiser','talkClosed','talkUnavailable','talkSignIn','talkSignInHint','talkRegister','talkRegisterHint','talkNew','talkLoadEarlier','talkPaused','talkHide','talkUnhide','talkHidden','talkBackToBlock','talkOpenFull','talkError','talkRate','talkEmptyBlock'];

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
