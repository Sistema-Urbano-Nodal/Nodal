import test from 'node:test';
import assert from 'node:assert/strict';
import {FIIU_EVENT} from '../server/fiiu-domain.js';
import {createFiiuHarness,key,field,flush,content} from './helpers/fiiu-ui-harness.js';

const CODE='Ab3dEf6hIj9kLm2nOp5qRs';
const publicData=(registrationOpen=true)=>({event:FIIU_EVENT,config:{registrationOpen,programUrl:''},content:[],nextCursor:null});
// A clock frozen at one Lima moment, for the page and the formatters alike.
const frozen=iso=>{const at=Date.parse(iso);return class extends Date{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}};};
async function page(answer,{search=`?a=day1-am&c=${CODE}`,registrationOpen=true,now='2026-10-21T09:12:00-05:00'}={}){
 return createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?publicData(registrationOpen):answer(request),{page:'fiiu-checkin',search,context:{Date:frozen(now)}});
}
const result=h=>h.root.querySelector('.f-checkin'),title=h=>result(h).querySelector('h1');
const posts=h=>h.requests.filter(request=>request.method==='POST');
const attendance=[{activityId:'day1-am',createdAt:'2026-10-21T14:12:00.000Z',method:'qr'}];
const checkedIn={status:201,data:{result:'checked_in',activityId:'day1-am',checkedInAt:'2026-10-21T14:12:00.000Z',method:'qr',attendance,hours:{minutes:240,hours:4,untimed:[]}}};

test('a scanned code checks in at once, then leaves the address bar, and the result shows the block, the time, the badge and the hours',async()=>{
 const h=await page(()=>checkedIn),box=result(h);
 assert.deepEqual(posts(h).map(request=>[request.path,request.body]),[['/api/fiiu/checkin',{activityId:'day1-am',code:CODE}]]);
 assert.deepEqual(h.replaced,['/fiiu-checkin.html?a=day1-am'],'c is stripped and a kept');assert.equal(h.ctx.location.search,'?a=day1-am');
 assert.equal(title(h).dataset.fiiuText,'checkedInTitle');assert.equal(box.className,'f-checkin is-ok');assert.equal(title(h).focused,true,'the outcome is announced by moving focus to it');
 assert.match(content(box.querySelector('.f-checkin-activity')),/El poder de lo local/);assert.match(content(box.querySelector('.f-checkin-activity')),/Auditorio MALI/);
 const time=box.querySelector('.f-checkin-facts');assert.ok(key(time,'checkedInAt'));assert.match(content(time),/09:12/,'the check-in time is Lima time');
 assert.match(content(box.querySelector('.f-badges')),/✓ El poder de lo local/);
 const hours=box.querySelector('.f-hours');assert.ok(key(hours,'hoursConfirmed'));assert.match(content(hours),/\b4\b/);
 assert.equal(key(box,'viewRegistration').href,'fiiu.html#registration');assert.equal(h.message.dataset.fiiuText,'');
});

test('a second scan says the person was already checked in, with the first check-in time',async()=>{
 const h=await page(()=>({status:200,data:{...checkedIn.data,result:'already_checked_in'}}));
 assert.equal(title(h).dataset.fiiuText,'alreadyCheckedIn');assert.match(content(result(h).querySelector('.f-checkin-facts')),/09:12/);
});

test('while the check-in is on its way the page says so, and nothing else waits for the programme',async()=>{
 let finish;const h=await page(()=>new Promise(resolve=>{finish=resolve;}));
 assert.equal(title(h).dataset.fiiuText,'checking');assert.equal(result(h)['aria-busy'],'true');
 finish(checkedIn);await flush();assert.equal(title(h).dataset.fiiuText,'checkedInTitle');
});

test('an expired code asks for a fresh scan and offers the screen code',async()=>{
 const h=await page(()=>({status:410,data:{error:'check-in code expired',code:'expired'}}));
 assert.equal(title(h).dataset.fiiuText,'codeExpired');assert.ok(key(result(h),'expiredHint'));assert.ok(field(result(h),'checkinCode'));
});

// No outcome is ever an organiser test run: what an organiser sees is what an attendee sees.
const TEST_WORDING=/rehears|organi[sz]er|organización|organização|nothing was recorded|no se registró nada|nada foi registrado|This code works|Este código funciona|not opened yet|aún no está abierto|ainda não abriu/i;
const languages=(h,check)=>{for(const lang of ['en','es','pt']){h.lang(lang);check(lang);}};

test('a check-in days before the session is confirmed with the real message and its Lima date and time, in every language',async()=>{
 const early=[{activityId:'day1-am',createdAt:'2026-10-07T15:00:00.000Z',method:'qr'}];
 const h=await page(()=>({status:201,data:{result:'checked_in',activityId:'day1-am',checkedInAt:'2026-10-07T15:00:00.000Z',method:'qr',attendance:early,hours:{minutes:240,hours:4,untimed:[]}}}),{now:'2026-10-07T10:00:00-05:00'});
 const box=result(h);assert.equal(title(h).dataset.fiiuText,'checkedInTitle');assert.equal(box.className,'f-checkin is-ok');
 const when=box.querySelector('.f-checkin-facts');assert.ok(key(when,'checkedInOn'),'a day is named, so the label is "on", not "at"');assert.equal(key(when,'checkedInAt'),undefined);assert.equal(when.querySelector('.f-when-day').dataset.fiiuDate,'2026-10-07','the scan day differs from the block day, so it is shown');assert.match(content(when),/10:00/);
 assert.match(content(box.querySelector('.f-badges')),/✓ El poder de lo local/);assert.match(content(box.querySelector('.f-hours')),/\b4\b/);
 languages(h,lang=>{
  assert.equal(title(h).textContent,{en:'You’re checked in',es:'Tu asistencia quedó registrada',pt:'Sua presença foi registrada'}[lang]);
  // The fact reads as a sentence: the day after "on / el / em", the time after "at / a las / às", never "a las Mié".
  assert.match(content(when).trim(),{en:/^Checked in on\s+Wed 7 Oct\s+at\s+10:00$/,es:/^Registrada el\s+Mié, 7 oct\.\s+a las\s+10:00$/,pt:/^Registrada em\s+Qua\., 7 de out\.\s+às\s+10:00$/}[lang]);
  assert.doesNotMatch(content(h.root),TEST_WORDING,lang);
 });
 // Nor is any organiser-test or not-open-yet wording left in the strings, in any language.
 const strings=Object.entries(h.ctx.window.Fiiu.rows);
 assert.deepEqual(strings.filter(([name,texts])=>/rehearsal|NotOpen/.test(name)||texts.some(text=>/rehears|organiser test|prueba de organización|teste de organização|nothing was recorded|no se registró nada|nada foi registrado|This code works|not opened yet|aún no está abierto|ainda não abriu/i.test(text))).map(([name])=>name),[]);
});

test('reloading after an early check-in shows the same dated confirmation, while a same-day one keeps "Checked in at"',async()=>{
 const early=[{activityId:'day1-am',createdAt:'2026-10-07T15:00:00.000Z',method:'qr'}];
 const h=await page(request=>request.path==='/api/fiiu/registration'?{registration:{id:'r1',version:1,answers:{activities:['day1-am']}},attendance:early,hours:{minutes:240,hours:4,untimed:[]},user:{id:'u1',email:'member@example.test'}}:assert.fail('a reload sends no check-in'),{search:'?a=day1-am',now:'2026-10-09T18:00:00-05:00'});
 assert.equal(title(h).dataset.fiiuText,'alreadyCheckedIn');const when=result(h).querySelector('.f-checkin-facts');
 languages(h,lang=>assert.match(content(when).trim(),{en:/^Checked in on\s+Wed 7 Oct\s+at\s+10:00$/,es:/^Registrada el\s+Mié, 7 oct\.\s+a las\s+10:00$/,pt:/^Registrada em\s+Qua\., 7 de out\.\s+às\s+10:00$/}[lang]));
 const same=await page(()=>checkedIn),fact=result(same).querySelector('.f-checkin-facts');assert.equal(fact.querySelector('.f-when-day'),null);
 languages(same,lang=>assert.match(content(fact).trim(),{en:/^Checked in at\s+09:12$/,es:/^Registrada a las\s+09:12$/,pt:/^Registrada às\s+09:12$/}[lang]));
});

test('an answer the page does not know, such as an old organiser test result, is never shown as one',async()=>{
 const h=await page(()=>({status:200,data:{result:'rehearsal',activityId:'day1-am',opensAt:'2026-10-21T13:30:00.000Z',closesAt:'2026-10-21T18:30:00.000Z',serverTime:'2026-10-01T15:00:00.000Z'}}),{now:'2026-10-01T10:00:00-05:00'});
 assert.equal(title(h).dataset.fiiuText,'checkinFailedTitle');assert.ok(key(result(h),'retry'));assert.equal(result(h).querySelector('.f-badges'),null);
 languages(h,lang=>assert.doesNotMatch(content(h.root),TEST_WORDING,lang));
});

test('once a block’s check-in has closed the page says so with the Lima closing time, whatever the phone’s clock says',async()=>{
 // The phone still reads that morning; the server judged the scan after the 13:30 close.
 const closed={code:'outside_window',activityId:'day1-am',closesAt:'2026-10-21T18:30:00.000Z',serverTime:'2026-10-21T18:31:00.000Z'};
 const h=await page(()=>({status:409,data:closed}),{now:'2026-10-21T07:00:00-05:00'}),box=result(h),line=box.querySelector('.f-checkin-window');
 assert.equal(title(h).dataset.fiiuText,'checkinEndedTitle');assert.equal(box.className,'f-checkin is-warn');assert.ok(key(box,'askDesk'));
 assert.ok(key(line,'checkinClosedAt'));assert.ok(key(line,'limaTime'));assert.equal(line.querySelector('.f-window-day'),null,'it closes on the block’s own day');
 assert.equal(line.querySelector('.f-window').className,'f-window is-closed');
 languages(h,lang=>{
  assert.match(content(line),{en:/Check-in closed at\s+13:30\s+Lima time/,es:/El registro cerró a las\s+13:30\s+hora de Lima/,pt:/O registro fechou às\s+13:30\s+horário de Lima/}[lang]);
  assert.doesNotMatch(content(h.root),TEST_WORDING,lang);
 });
 // The laboratory has no time yet: it closed at the end of 20 October, even for a phone still reading 30 September.
 const lab=await page(()=>({status:409,data:{code:'outside_window',activityId:'day0-lab',closesAt:'2026-10-21T05:00:00.000Z',serverTime:'2026-10-21T14:10:00.000Z'}}),{search:`?a=day0-lab&c=${CODE}`,now:'2026-09-30T10:00:00-05:00'});
 assert.equal(title(lab).dataset.fiiuText,'checkinEndedTitle');assert.ok(key(result(lab),'askDesk'));
 languages(lab,lang=>assert.match(content(result(lab).querySelector('.f-checkin-window')),{en:/Check-in closed at the end of the day, Lima time/,es:/El registro cerró al final del día, hora de Lima/,pt:/O registro fechou no fim do dia, horário de Lima/}[lang]));
});

test('a closed answer never reads as "not open yet", even one from an older server that sent an opening time',async()=>{
 // An older server's refusal before its opening time; and one without any time at all.
 const older=await page(()=>({status:409,data:{code:'outside_window',activityId:'day1-am',opensAt:'2026-10-21T13:30:00.000Z',closesAt:'2026-10-21T18:30:00.000Z',serverTime:'2026-10-21T13:00:00.000Z'}}),{now:'2026-10-21T08:00:00-05:00'});
 assert.equal(title(older).dataset.fiiuText,'checkinEndedTitle');assert.ok(key(result(older),'askDesk'));assert.match(content(result(older).querySelector('.f-checkin-window')),/13:30/);
 assert.doesNotMatch(content(result(older)),/08:30/,'no opening time is shown');
 const bare=await page(()=>({status:409,data:{code:'outside_window',activityId:'day1-am'}}));
 assert.equal(title(bare).dataset.fiiuText,'checkinEndedTitle');assert.equal(result(bare).querySelector('.f-checkin-window'),null);assert.ok(key(result(bare),'askDesk'));
 for(const h of [older,bare])languages(h,lang=>assert.doesNotMatch(content(h.root),TEST_WORDING,lang));
 // A typed code names no block, and without the programme the closing line carries its own date.
 const typed=await createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?{status:503,data:{}}:{status:409,data:{code:'outside_window',activityId:'day1-am',closesAt:'2026-10-21T18:30:00.000Z'}},{page:'fiiu-checkin',search:''});
 const form=result(typed).querySelector('form');field(form,'checkinCode').value='K7M4PX';form.listeners.submit({preventDefault(){}});await flush();
 assert.equal(title(typed).dataset.fiiuText,'checkinEndedTitle');assert.equal(result(typed).querySelector('.f-window-day').dataset.fiiuDate,'2026-10-21');
});

test('someone without a registration is sent to register while registration is open, and to the desk once it closes',async()=>{
 const open=await page(()=>({status:404,data:{code:'not_registered',activityId:'day1-am',registrationOpen:true}}));
 assert.equal(title(open).dataset.fiiuText,'notRegistered');assert.ok(key(result(open),'notRegisteredHint'));assert.equal(key(result(open),'register').href,'fiiu.html#add-day1-am','the form opens with this block ticked');
 const closed=await page(()=>({status:404,data:{code:'not_registered',activityId:'day1-am',registrationOpen:false}}));
 assert.ok(key(result(closed),'askDesk'));assert.equal(key(result(closed),'register'),undefined);
 const race=await page(()=>({status:404,data:{error:'registration unavailable'}}),{registrationOpen:false});
 assert.equal(title(race).dataset.fiiuText,'notRegistered','a registration cancelled mid-request reads the same, from the page settings');assert.ok(key(result(race),'askDesk'));
});

test('a block outside the person’s plan links to their registration while it is open; a lab application not yet accepted says so',async()=>{
 const plan=await page(()=>({status:403,data:{code:'not_in_plan',activityId:'day1-am',registrationOpen:true}}));
 assert.equal(title(plan).dataset.fiiuText,'notInPlan');assert.ok(key(result(plan),'notInPlanHint'));assert.equal(key(result(plan),'addToRegistration').href,'fiiu.html#add-day1-am','the form opens with this block ticked');
 const closed=await page(()=>({status:403,data:{code:'not_in_plan',activityId:'day1-am',registrationOpen:false}}));
 assert.equal(key(result(closed),'addToRegistration'),undefined);assert.ok(key(result(closed),'askDesk'));
 const lab=await page(()=>({status:403,data:{code:'lab_not_accepted',activityId:'day0-lab'}}),{search:`?a=day0-lab&c=${CODE}`});
 assert.equal(title(lab).dataset.fiiuText,'labNotAccepted');assert.ok(key(result(lab),'labNotAcceptedHint'));assert.match(content(result(lab)),/Gestión urbana en acción/);
});

test('the laboratory cannot be added from the registration, so no laboratory refusal links there',async()=>{
 const lab={search:`?a=day0-lab&c=${CODE}`,now:'2026-10-20T10:00:00-05:00'};
 // Someone who did not apply (the server says not_in_plan) reads the laboratory rule and the desk, not "add it to your registration".
 const notApplied=await page(()=>({status:403,data:{code:'not_in_plan',activityId:'day0-lab',registrationOpen:true}}),lab);
 assert.equal(title(notApplied).dataset.fiiuText,'labNotAccepted');assert.ok(key(result(notApplied),'labNotAcceptedHint'));
 assert.equal(key(result(notApplied),'addToRegistration'),undefined);assert.equal(key(result(notApplied),'notInPlanHint'),undefined);
 // Without any registration, the title says so but the hint is the laboratory rule, with no register link either.
 const unregistered=await page(()=>({status:404,data:{code:'not_registered',activityId:'day0-lab',registrationOpen:true}}),lab);
 assert.equal(title(unregistered).dataset.fiiuText,'notRegistered');assert.ok(key(result(unregistered),'labNotAcceptedHint'));
 assert.equal(key(result(unregistered),'register'),undefined);assert.equal(key(result(unregistered),'notRegisteredHint'),undefined);
 // A conference block keeps its add-and-scan-again path.
 const block=await page(()=>({status:404,data:{code:'not_registered',activityId:'day1-am',registrationOpen:true}}));
 assert.equal(key(result(block),'register').href,'fiiu.html#add-day1-am');
 // Without the programme (it failed, or is still on its way after the short wait) the refusal itself names the laboratory.
 for(const [status,code] of [[403,'not_in_plan'],[404,'not_registered']]){
  const bare=await createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?{status:503,data:{}}:{status,data:{code,activityId:'day0-lab',registration:'application',registrationOpen:true}},{page:'fiiu-checkin',search:lab.search,context:{Date:frozen(lab.now)}});
  assert.ok(key(result(bare),'labNotAcceptedHint'),code);
  assert.equal(key(result(bare),'register'),undefined,code);assert.equal(key(result(bare),'addToRegistration'),undefined,code);
 }
});

test('a signed-out scan gets a sign-in link that comes back with the same block and code',async()=>{
 const h=await page(()=>({status:401,data:{error:'sign in required'}}));
 assert.equal(title(h).dataset.fiiuText,'signInToCheckIn');assert.ok(key(result(h),'signInCheckinHint'));
 assert.equal(key(result(h),'signin').href,'login.html?next='+encodeURIComponent(`/fiiu-checkin.html?a=day1-am&c=${CODE}`));
 assert.deepEqual(h.replaced,['/fiiu-checkin.html?a=day1-am'],'the address bar still drops the code');
});

test('a rate limit or a lost connection offers to send the same check-in again',async()=>{
 let replies=[{status:429,data:{error:'too many requests'}},()=>{throw TypeError('Failed to fetch');},checkedIn];
 const h=await page(()=>{const next=replies.shift();return typeof next==='function'?next():next;});
 assert.equal(title(h).dataset.fiiuText,'checkinFailedTitle');assert.equal(result(h).className,'f-checkin is-error');assert.ok(key(result(h),'rate'));
 await key(result(h),'retry').listeners.click();assert.ok(key(result(h),'checkinError'));assert.equal(key(result(h),'error'),undefined,'no form copy ("your answers are still here") on a page without a form');
 await key(result(h),'retry').listeners.click();assert.equal(title(h).dataset.fiiuText,'checkedInTitle');
 assert.ok(posts(h).every(request=>request.body.code===CODE&&request.body.activityId==='day1-am'));assert.equal(posts(h).length,3);
});

test('workshops and routes have no check-in, and an incomplete link sends nothing',async()=>{
 const external=await page(()=>({status:400,data:{code:'invalid_activity'}}),{search:`?a=workshop-calles-gente&c=${CODE}`});
 assert.equal(title(external).dataset.fiiuText,'noCheckin');assert.ok(key(result(external),'noCheckinHint'));
 const registration=(rows=[])=>({registration:{id:'r1',version:1,answers:{activities:['day1-am']}},attendance:rows,hours:{minutes:0,hours:0,untimed:[]},user:{id:'u1',email:'member@example.test'}});
 const partial=await page(request=>request.method==='GET'&&request.path==='/api/fiiu/registration'?registration():assert.fail('nothing is sent for an incomplete link'),{search:'?a=day1-am'});
 assert.equal(title(partial).dataset.fiiuText,'scanAgainTitle');assert.ok(key(result(partial),'scanAgainHint'));assert.match(content(result(partial).querySelector('.f-checkin-activity')),/El poder de lo local/,'the block is named');
 assert.ok(field(result(partial),'checkinCode'));assert.deepEqual(partial.replaced,[]);assert.equal(posts(partial).length,0);
 const workshop=await page(request=>request.path==='/api/fiiu/registration'?registration():assert.fail(),{search:'?a=workshop-calles-gente'});
 assert.equal(title(workshop).dataset.fiiuText,'noCheckin','a workshop address never asks for a code');assert.equal(field(result(workshop),'checkinCode'),undefined);
 const malformed=await page(()=>assert.fail('a malformed block id asks the server nothing'),{search:'?a=Day_1'});
 assert.equal(title(malformed).dataset.fiiuText,'invalidLink');assert.equal(malformed.requests.length,1,'only the programme');
});

test('signed out, a reload or Back after the code left the address asks for sign-in and comes back to the same block',async()=>{
 // The scan showed "Sign in to check in" and dropped c; the person reloads, or presses Back from the sign-in page.
 const h=await page(request=>request.path==='/api/fiiu/registration'?{status:401,data:{error:'sign in required'}}:assert.fail('nothing is sent without a code'),{search:'?a=day1-am'});
 assert.equal(title(h).dataset.fiiuText,'signInToCheckIn');assert.equal(result(h).className,'f-checkin is-warn');assert.ok(key(result(h),'signInScanAgainHint'));
 assert.match(content(result(h).querySelector('.f-checkin-activity')),/El poder de lo local/,'the block is still named');
 assert.equal(key(result(h),'signin').href,'login.html?next='+encodeURIComponent('/fiiu-checkin.html?a=day1-am'));
 assert.equal(field(result(h),'checkinCode'),undefined,'no code form before sign-in');assert.equal(posts(h).length,0);assert.equal(h.message.dataset.fiiuText,'');
 // Any other failure to read the registration offers to try again rather than claiming the link is incomplete.
 let replies=[{status:503,data:{error:'unavailable'}},{registration:{id:'r1',version:1,answers:{activities:['day1-am']}},attendance,hours:{minutes:240,hours:4,untimed:[]},user:{id:'u1',email:'member@example.test'}}];
 const down=await page(request=>request.path==='/api/fiiu/registration'?replies.shift():assert.fail(),{search:'?a=day1-am'});
 assert.equal(title(down).dataset.fiiuText,'checkinLoadFailed','only the lookup failed: it never says the check-in did not go through');assert.ok(key(result(down),'checkinLoadFailedHint'));assert.equal(key(result(down),'error'),undefined);assert.equal(posts(down).length,0);
 await key(result(down),'retry').listeners.click();await flush();
 assert.equal(title(down).dataset.fiiuText,'alreadyCheckedIn');assert.equal(title(down).focused,true);
});

test('a typed code sent signed out is kept through sign-in, which comes back and sends it, then drops it from the address',async()=>{
 // Codes are accepted for 5 minutes, so the code typed before sign-in usually still works after it; an expired one gets the code form.
 const h=await page(()=>({status:401,data:{error:'sign in required'}}),{search:''});
 const form=result(h).querySelector('form');field(form,'checkinCode').value='k7m-4px';form.listeners.submit({preventDefault(){}});await flush();
 // Someone who typed the code could not scan it, so the hint points to the screen's new code rather than a fresh scan.
 assert.equal(title(h).dataset.fiiuText,'signInToCheckIn');assert.ok(key(result(h),'signInTypedCodeHint'));assert.equal(key(result(h),'signInCheckinHint'),undefined);assert.equal(key(result(h),'signInScanAgainHint'),undefined);
 languages(h,lang=>{
  assert.match(content(key(result(h),'signInTypedCodeHint')),{en:/type the new code from the screen\.$/,es:/escribe el código nuevo de la pantalla\.$/,pt:/digite o código novo da tela\.$/}[lang]);
  assert.doesNotMatch(content(result(h)),/scan|escane/i,lang);
 });
 assert.equal(key(result(h),'signin').href,'login.html?next='+encodeURIComponent('/fiiu-checkin.html?c=K7M4PX'));
 // Back from sign-in, the lone code is sent at once and leaves the address bar, like a scanned one.
 for(const sent of ['K7M4PX','k7m-4px']){
  const back=await page(()=>checkedIn,{search:'?c='+encodeURIComponent(sent)});
  assert.deepEqual(posts(back).map(request=>request.body),[{code:'K7M4PX'}]);assert.equal(title(back).dataset.fiiuText,'checkedInTitle');
  assert.deepEqual(back.replaced,['/fiiu-checkin.html']);
 }
 const expired=await page(()=>({status:410,data:{error:'check-in code expired',code:'expired'}}),{search:'?c=K7M4PX'});
 assert.equal(title(expired).dataset.fiiuText,'codeExpired');assert.ok(field(result(expired),'checkinCode'));
 // Anything else in c alone is still an incomplete link, and nothing is sent.
 const broken=await page(()=>assert.fail('nothing is sent'),{search:'?c=K7M4'});assert.equal(title(broken).dataset.fiiuText,'invalidLink');assert.equal(posts(broken).length,0);
});

test('signed out, the bare code page says sign-in comes first before anything is typed, and keeps the form',async()=>{
 const guest=await page(request=>request.path==='/api/auth/state'?{authenticated:false}:assert.fail('nothing is sent before a code is typed'),{search:''});
 const box=result(guest),form=box.querySelector('form');
 assert.equal(title(guest).dataset.fiiuText,'codeEntry');assert.ok(key(box,'signInBeforeCodeHint'));
 assert.equal(key(box,'signin').href,'login.html?next='+encodeURIComponent('/fiiu-checkin.html'));
 assert.ok(box.children.indexOf(key(box,'signInBeforeCodeHint').parent)<box.children.indexOf(form),'above the code form');assert.ok(field(form,'checkinCode'));
 languages(guest,lang=>assert.match(content(key(box,'signInBeforeCodeHint')),{en:/^Sign in first/,es:/^Primero inicia sesión/,pt:/^Primeiro entre/}[lang]));
 // Signed in, or when the lookup fails, the page is just the code form.
 for(const reply of [{authenticated:true},{status:503,data:{error:'unavailable'}},{}]){
  const h=await page(request=>request.path==='/api/auth/state'?reply:assert.fail(),{search:''});
  assert.equal(key(result(h),'signInBeforeCodeHint'),undefined);assert.equal(key(result(h),'signin'),undefined);assert.ok(field(result(h),'checkinCode'));
 }
 // A lookup that answers after the code was sent never adds to the result.
 let answer;const late=await page(request=>request.path==='/api/auth/state'?new Promise(resolve=>{answer=resolve;}):checkedIn,{search:''});
 const entry=result(late).querySelector('form');field(entry,'checkinCode').value='K7M4PX';entry.listeners.submit({preventDefault(){}});await flush();
 answer({authenticated:false});await flush();
 assert.equal(title(late).dataset.fiiuText,'checkedInTitle');assert.equal(key(result(late),'signInBeforeCodeHint'),undefined);
});

test('reloading the page after a check-in shows the confirmation again instead of an incomplete link',async()=>{
 // The address after a check-in is ?a=day1-am; a pull-to-refresh or a restored tab loads it again.
 const h=await page(request=>request.path==='/api/fiiu/registration'&&request.method==='GET'?{registration:{id:'r1',version:1,answers:{activities:['day1-am']}},attendance,hours:{minutes:240,hours:4,untimed:[]},user:{id:'u1',email:'member@example.test'}}:assert.fail('a reload sends no check-in'),{search:'?a=day1-am'});
 const box=result(h);
 assert.equal(title(h).dataset.fiiuText,'alreadyCheckedIn');assert.equal(box.className,'f-checkin is-ok');assert.equal(posts(h).length,0);
 assert.match(content(box.querySelector('.f-checkin-facts')),/09:12/,'the first check-in time, in Lima');
 assert.match(content(box.querySelector('.f-badges')),/✓ El poder de lo local/);assert.match(content(box.querySelector('.f-hours')),/\b4\b/);
 assert.equal(key(box,'viewRegistration').href,'fiiu.html#registration');assert.equal(h.message.dataset.fiiuText,'');assert.deepEqual(h.replaced,[]);
 // Another block on the same address is not confirmed by this one.
 const other=await page(request=>request.path==='/api/fiiu/registration'?{registration:{id:'r1',version:1,answers:{activities:['day1-am','day1-pm']}},attendance,hours:{minutes:240,hours:4,untimed:[]},user:{id:'u1',email:'member@example.test'}}:assert.fail(),{search:'?a=day1-pm'});
 assert.equal(title(other).dataset.fiiuText,'scanAgainTitle');
});

test('without a link the page asks for the 6-character screen code, checks it before sending, and shows the block the server names',async()=>{
 const h=await page(({body})=>({status:201,data:{...checkedIn.data,activityId:'day1-pm',attendance:[{activityId:'day1-pm',createdAt:'2026-10-22T00:05:00.000Z',method:'qr'}],echo:body}}),{search:''});
 assert.equal(title(h).dataset.fiiuText,'codeEntry');const form=result(h).querySelector('form'),input=field(form,'checkinCode');assert.equal(form.noValidate,true);
 input.value='ab1';form.listeners.submit({preventDefault(){}});
 assert.equal(posts(h).length,0,'a malformed code is not sent');assert.equal(input['aria-invalid'],'true');assert.equal(form.querySelector('.f-status').dataset.fiiuText,'checkinCodeInvalid');
 form.listeners.input();assert.equal(input['aria-invalid'],'false');
 input.value=' k7m-4px ';form.listeners.submit({preventDefault(){}});await flush();
 assert.deepEqual(posts(h).map(request=>request.body),[{code:'K7M4PX'}],'the typed code alone is sent, normalised');
 assert.equal(title(h).dataset.fiiuText,'checkedInTitle');assert.match(content(result(h).querySelector('.f-checkin-activity')),/Intervenir para activar/);
 assert.match(content(result(h).querySelector('.f-hours')),/\b2\b/,'the evening block counts two hours');
});

test('participation badges follow the programme, whatever order the store returns the attendance in',async()=>{
 // Attendance ids are random UUIDs, so the API order is arbitrary: a 22 October workshop, the 22 October morning, then the 20 October laboratory.
 const rows=[{activityId:'workshop-calles-gente',createdAt:'2026-10-22T20:00:00.000Z',method:'staff'},{activityId:'day2-am',createdAt:'2026-10-22T14:05:00.000Z',method:'qr'},{activityId:'day0-lab',createdAt:'2026-10-20T15:00:00.000Z',method:'qr'}];
 const h=await page(request=>request.path==='/api/fiiu/registration'?{registration:{id:'r1',version:1,answers:{activities:['day2-am'],applyLab:true},labStatus:'accepted'},attendance:rows,hours:{minutes:240,hours:4,untimed:['day0-lab']},user:{id:'u1',email:'member@example.test'}}:assert.fail(),{search:'?a=day0-lab',now:'2026-10-22T16:00:00-05:00'});
 assert.equal(title(h).dataset.fiiuText,'alreadyCheckedIn');
 assert.deepEqual(result(h).querySelectorAll('.f-badge').map(node=>node.textContent.slice(2,24)),['Gestión urbana en acci','Cuidar y transformar l','Calles para la gente: ']);
});

test('a lookup held back by a rate limit on reload keeps its wait-a-minute hint',async()=>{
 const h=await page(request=>request.path==='/api/fiiu/registration'?{status:429,data:{error:'too many requests'}}:assert.fail(),{search:'?a=day1-am'});
 assert.equal(title(h).dataset.fiiuText,'checkinLoadFailed');assert.ok(key(result(h),'rate'));assert.equal(key(result(h),'checkinLoadFailedHint'),undefined);assert.ok(key(result(h),'retry'));
});

test('the code form never waits for the programme, with no link or an incomplete one',async()=>{
 // Only the session lookup behind the sign-in note goes out (and is not waited for); no check-in is sent before a code is typed.
 const stalled=search=>createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'||request.path==='/api/auth/state'?new Promise(()=>{}):assert.fail('nothing is sent before a code is typed'),{page:'fiiu-checkin',search});
 const entry=await stalled('');assert.equal(title(entry).dataset.fiiuText,'codeEntry');assert.ok(field(result(entry),'checkinCode'));assert.equal(entry.message.dataset.fiiuText,'');
 const broken=await stalled('?c=x');assert.equal(title(broken).dataset.fiiuText,'invalidLink');assert.ok(field(result(broken),'checkinCode'));
});

test('a stalled programme holds the check-in result only briefly: the result shows with the hours from the answer',async()=>{
 const waits=[];const h=await createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?new Promise(()=>{}):checkedIn,{page:'fiiu-checkin',search:`?a=day1-am&c=${CODE}`,context:{Date:frozen('2026-10-21T09:12:00-05:00'),setTimeout:(fn,ms)=>{waits.push(ms);fn();}}});
 assert.deepEqual(waits,[1500]);assert.equal(title(h).dataset.fiiuText,'checkedInTitle');assert.equal(title(h).focused,true);
 assert.match(content(result(h).querySelector('.f-hours')),/\b4\b/);assert.equal(result(h).querySelector('.f-checkin-activity'),null,'an older answer without the block leaves it unnamed');
});

test('on slow Wi-Fi the confirmation names its block and day from the answer, and fills in the badge once the programme arrives',async()=>{
 const block={id:'day1-am',title:'El poder de lo local',date:'2026-10-21',time:'09:00–13:00',venue:'Auditorio MALI, Cercado de Lima'};
 // Checked in on 12 October for the 21 October block; the programme is still on its way.
 const early=[{activityId:'day1-am',createdAt:'2026-10-12T17:44:00.000Z',method:'qr'}],answer={status:200,data:{result:'already_checked_in',activityId:'day1-am',checkedInAt:'2026-10-12T17:44:00.000Z',method:'qr',attendance:early,hours:{minutes:240,hours:4,untimed:[]},activity:block}};
 let arrive;const programme=new Promise(resolve=>{arrive=resolve;});
 const h=await createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?programme:answer,{page:'fiiu-checkin',search:`?a=day1-am&c=${CODE}`,context:{Date:frozen('2026-10-12T12:44:00-05:00'),setTimeout:(fn)=>fn()}});
 let box=result(h);assert.equal(title(h).dataset.fiiuText,'alreadyCheckedIn');assert.equal(title(h).focused,true);
 assert.match(content(box.querySelector('.f-checkin-activity')),/El poder de lo local/);assert.match(content(box.querySelector('.f-checkin-activity')),/Auditorio MALI/);
 const when=box.querySelector('.f-checkin-facts');assert.ok(key(when,'checkedInOn'),'the scan day differs from the block day, so it is named');assert.equal(when.querySelector('.f-when-day').dataset.fiiuDate,'2026-10-12');
 assert.match(content(box.querySelector('.f-hours')),/\b4\b/);assert.equal(box.querySelector('.f-badges'),null);
 // The programme lands: the same confirmation, now with its badge, replaces the first one.
 arrive(publicData());await flush();box=result(h);
 assert.equal(title(h).dataset.fiiuText,'alreadyCheckedIn');assert.match(content(box.querySelector('.f-checkin-activity')),/El poder de lo local/);assert.match(content(box.querySelector('.f-badges')),/✓ El poder de lo local/);
 // A result whose code form holds typing is not redrawn when the programme lands, so the code being typed is kept.
 let late;const slow=await createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?new Promise(resolve=>{late=resolve;}):{status:410,data:{error:'check-in code expired',code:'expired'}},{page:'fiiu-checkin',search:`?a=day1-am&c=${CODE}`,context:{setTimeout:(fn)=>fn()}});
 const input=field(result(slow),'checkinCode');input.value='K7M';late(publicData());await flush();assert.equal(field(result(slow),'checkinCode'),input);assert.equal(input.value,'K7M');
});

test('on slow Wi-Fi a refusal for a typed code names its block once the programme arrives',async()=>{
 const typed=async answer=>{
  let arrive;const h=await createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?new Promise(resolve=>{arrive=resolve;}):request.path==='/api/fiiu/registration'?{status:503,data:{}}:answer,{page:'fiiu-checkin',search:'',context:{Date:frozen('2026-10-21T22:00:00-05:00'),setTimeout:fn=>fn()}});
  const form=result(h).querySelector('form');field(form,'checkinCode').value='K7M4PX';form.listeners.submit({preventDefault(){}});await flush();return {h,arrive};
 };
 for(const [answer,titleKey] of [[{status:404,data:{code:'not_registered',activityId:'day1-pm',registrationOpen:true}},'notRegistered'],[{status:403,data:{code:'not_in_plan',activityId:'day1-pm',registrationOpen:true}},'notInPlan'],[{status:409,data:{code:'outside_window',activityId:'day1-pm',closesAt:'2026-10-22T02:30:00.000Z'}},'checkinEndedTitle']]){
  const {h,arrive}=await typed(answer);
  assert.equal(title(h).dataset.fiiuText,titleKey);assert.equal(result(h).querySelector('.f-checkin-activity'),null,'only the id is known yet');
  h.ctx.document.activeElement=title(h);arrive(publicData());await flush();
  assert.equal(title(h).dataset.fiiuText,titleKey);assert.match(content(result(h).querySelector('.f-checkin-activity')),/Intervenir para activar/,titleKey);assert.equal(title(h).focused,true,'focus stays on the title');
  assert.equal(h.requests.filter(request=>request.method==='POST').length,1,'nothing is sent again');
 }
 // A programme that fails leaves the refusal as it was.
 const {h,arrive}=await typed({status:403,data:{code:'not_in_plan',activityId:'day1-pm',registrationOpen:true}}),shown=result(h);
 arrive({status:503,data:{}});await flush();assert.equal(result(h),shown);
});

test('a reload shown before the programme arrived says what a scan would once it lands, unless its code form is in use',async()=>{
 const reloaded=async(registration,{status}={})=>{
  let arrive;const reply=status?{status,data:{error:'sign in required'}}:{registration,attendance:[],hours:{minutes:0,hours:0,untimed:[]},user:{id:'u1',email:'beto@example.test'},serverTime:'2026-10-21T14:12:00.000Z'};
  const h=await createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?new Promise(resolve=>{arrive=resolve;}):request.path==='/api/fiiu/registration'?reply:assert.fail(request.path),{page:'fiiu-checkin',search:'?a=day1-pm',context:{Date:frozen('2026-10-21T09:12:00-05:00'),setTimeout:fn=>fn()}});
  return {h,arrive};
 };
 const plan={id:'r1',version:1,answers:{activities:['day1-am']}};
 // Without the programme the block could not be judged, so the code was asked for; the programme shows it is outside the plan.
 let {h,arrive}=await reloaded(plan);assert.equal(title(h).dataset.fiiuText,'scanAgainTitle');assert.equal(result(h).querySelector('.f-checkin-activity'),null);
 arrive(publicData());await flush();
 assert.equal(title(h).dataset.fiiuText,'notInPlan');assert.equal(key(result(h),'addToRegistration').href,'fiiu.html#add-day1-pm');assert.equal(field(result(h),'checkinCode'),undefined);
 assert.match(content(result(h).querySelector('.f-checkin-activity')),/Intervenir para activar/);assert.equal(h.requests.filter(request=>request.path==='/api/fiiu/registration').length,1,'the lookup is not repeated');
 // A block the person can check in to keeps asking for the code, now naming it; so does sign-in.
 ({h,arrive}=await reloaded({...plan,answers:{activities:['day1-pm']}}));arrive(publicData());await flush();
 assert.equal(title(h).dataset.fiiuText,'scanAgainTitle');assert.match(content(result(h).querySelector('.f-checkin-activity')),/Intervenir para activar/);
 ({h,arrive}=await reloaded(null,{status:401}));assert.equal(title(h).dataset.fiiuText,'signInToCheckIn');arrive(publicData());await flush();
 assert.equal(title(h).dataset.fiiuText,'signInToCheckIn');assert.match(content(result(h).querySelector('.f-checkin-activity')),/Intervenir para activar/);
 // A code being typed, or a field holding the cursor, is never taken away.
 ({h,arrive}=await reloaded(plan));let input=field(result(h),'checkinCode');input.value='K7';arrive(publicData());await flush();
 assert.equal(title(h).dataset.fiiuText,'scanAgainTitle');assert.equal(field(result(h),'checkinCode'),input);assert.equal(input.value,'K7');
 ({h,arrive}=await reloaded(plan));input=field(result(h),'checkinCode');h.ctx.document.activeElement=input;arrive(publicData());await flush();
 assert.equal(field(result(h),'checkinCode'),input);
});

test('a reload waits for the programme only briefly once the registration has answered',async()=>{
 const waits=[];const reply={registration:{id:'r1',version:1,answers:{activities:['day1-am']}},attendance,hours:{minutes:240,hours:4,untimed:[]},user:{id:'u1',email:'member@example.test'}};
 const h=await createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?new Promise(()=>{}):request.path==='/api/fiiu/registration'?reply:assert.fail(),{page:'fiiu-checkin',search:'?a=day1-am',context:{Date:frozen('2026-10-21T09:30:00-05:00'),setTimeout:(fn,ms)=>{waits.push(ms);fn();}}});
 assert.deepEqual(waits,[1500]);assert.equal(title(h).dataset.fiiuText,'alreadyCheckedIn');assert.equal(h.message.dataset.fiiuText,'');assert.match(content(result(h).querySelector('.f-hours')),/\b4\b/);
 // The block is unknown until the programme arrives, so the check-in day is named rather than a bare "at 09:12".
 const when=result(h).querySelector('.f-checkin-facts');assert.ok(key(when,'checkedInOn'));assert.equal(when.querySelector('.f-when-day').dataset.fiiuDate,'2026-10-21');
});

test('without the programme, a refusal for a typed code still links to the block the server names',async()=>{
 const h=await createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?{status:503,data:{}}:{status:403,data:{code:'not_in_plan',activityId:'day1-pm',registrationOpen:true}},{page:'fiiu-checkin',search:''});
 const form=result(h).querySelector('form');field(form,'checkinCode').value='K7M4PX';form.listeners.submit({preventDefault(){}});await flush();
 assert.equal(title(h).dataset.fiiuText,'notInPlan');assert.equal(key(result(h),'addToRegistration').href,'fiiu.html#add-day1-pm');
});

test('a reload says what a scan would: closed by the server’s clock, not registered, not in the plan or a laboratory place not confirmed, and only otherwise asks for the code',async()=>{
 const own=(activities=['day1-am'],extra={})=>({id:'r1',version:1,answers:{activities},...extra});
 const lookup=(registration=own(),serverTime='2026-10-21T14:12:00.000Z')=>({registration,attendance:[],hours:{minutes:0,hours:0,untimed:[]},user:{id:'u1',email:'beto@example.test'},...(serverTime?{serverTime}:{})});
 const reload=(reply,{search='?a=day1-am',...options}={})=>page(request=>request.path==='/api/fiiu/registration'&&request.method==='GET'?reply:assert.fail('a reload sends no check-in'),{search,...options});
 // 14:00 in Lima by the server's clock, half an hour after the 13:30 close, while the phone still reads that morning.
 const closed=await reload(lookup(own(),'2026-10-21T19:00:00.000Z'),{now:'2026-10-21T08:00:00-05:00'});
 assert.equal(title(closed).dataset.fiiuText,'checkinEndedTitle');assert.equal(result(closed).className,'f-checkin is-warn');assert.ok(key(result(closed),'askDesk'));
 assert.match(content(result(closed).querySelector('.f-checkin-window')),/13:30/);assert.equal(field(result(closed),'checkinCode'),undefined,'no code form for a closed block');assert.equal(posts(closed).length,0);
 // As on the server, closed comes before anything about the registration.
 assert.equal(title(await reload(lookup(null,'2026-10-21T19:00:00.000Z'))).dataset.fiiuText,'checkinEndedTitle');
 // Only the server's clock judges: a phone reading after the close, or an older answer without the server's time, still gets the code form.
 for(const late of [await reload(lookup(),{now:'2026-10-21T20:00:00-05:00'}),await reload(lookup(own(),null),{now:'2026-10-21T20:00:00-05:00'})]){
  assert.equal(title(late).dataset.fiiuText,'scanAgainTitle');assert.ok(field(result(late),'checkinCode'));
 }
 // No registration: the same refusal as a scan, with the register link while registration is open and the desk once it closes.
 const none=await reload(lookup(null));
 assert.equal(title(none).dataset.fiiuText,'notRegistered');assert.ok(key(result(none),'notRegisteredHint'));assert.equal(key(result(none),'register').href,'fiiu.html#add-day1-am');
 assert.equal(field(result(none),'checkinCode'),undefined,'no "scan again" for someone the server would refuse');
 const late=await reload(lookup(null),{registrationOpen:false});assert.equal(title(late).dataset.fiiuText,'notRegistered');assert.ok(key(result(late),'askDesk'));assert.equal(key(result(late),'register'),undefined);
 // A block outside the plan links to the registration with it ticked.
 const plan=await reload(lookup(),{search:'?a=day1-pm'});
 assert.equal(title(plan).dataset.fiiuText,'notInPlan');assert.ok(key(result(plan),'notInPlanHint'));assert.equal(key(result(plan),'addToRegistration').href,'fiiu.html#add-day1-pm');assert.equal(field(result(plan),'checkinCode'),undefined);
 // The laboratory needs an accepted application; a pending one says so, an accepted one is asked for the code.
 const lab={search:'?a=day0-lab',now:'2026-10-20T10:00:00-05:00'},labTime='2026-10-20T15:00:00.000Z';
 const pending=await reload(lookup(own(['day1-am'],{answers:{activities:['day1-am'],applyLab:true},labStatus:'pending'}),labTime),lab);
 assert.equal(title(pending).dataset.fiiuText,'labNotAccepted');assert.ok(key(result(pending),'labNotAcceptedHint'));assert.equal(key(result(pending),'addToRegistration'),undefined);
 const unregisteredLab=await reload(lookup(null,labTime),lab);assert.equal(title(unregisteredLab).dataset.fiiuText,'notRegistered');assert.ok(key(result(unregisteredLab),'labNotAcceptedHint'));assert.equal(key(result(unregisteredLab),'register'),undefined);
 const accepted=await reload(lookup(own(['day1-am'],{answers:{activities:['day1-am'],applyLab:true},labStatus:'accepted'}),labTime),lab);
 assert.equal(title(accepted).dataset.fiiuText,'scanAgainTitle');assert.ok(field(result(accepted),'checkinCode'));
 // A registered person on an open block in their plan is the one asked to scan again.
 const ready=await reload(lookup());assert.equal(title(ready).dataset.fiiuText,'scanAgainTitle');assert.ok(key(result(ready),'scanAgainHint'));
});

test('a “not registered” refusal names the signed-in account and offers another one, which signs out and comes back to the same block and code',async()=>{
 const refusal=(registrationOpen=true)=>({status:404,data:{code:'not_registered',activityId:'day1-am',registrationOpen}});
 const lookup={registration:null,attendance:[],hours:{minutes:0,hours:0,untimed:[]},user:{id:'u2',email:'carla.someone.with.a.long.address@example.test'},serverTime:'2026-10-21T14:12:00.000Z'};
 const scanned=(answer=refusal(),account=lookup,options={})=>page(request=>request.path==='/api/fiiu/checkin'?answer:request.path==='/api/fiiu/registration'?account:request.path==='/api/auth/logout'?{ok:true}:assert.fail(request.path),options);
 const h=await scanned(),box=result(h);
 assert.equal(title(h).dataset.fiiuText,'notRegistered');assert.equal(title(h).focused,true);
 const fact=box.querySelector('.f-checkin-facts');assert.ok(key(fact,'checkinAccount'));assert.match(content(fact),/carla\.someone\.with\.a\.long\.address@example\.test/,'the whole address, on the person’s own phone');
 assert.ok(key(box,'notRegisteredHint'));assert.ok(key(box,'otherAccountHint'));
 const register=key(box,'register'),other=key(box,'useOtherAccount');
 assert.equal(register.href,'fiiu.html#add-day1-am');assert.equal(register.className,'f-button','registering stays the main action');assert.equal(other.className,'f-button secondary');
 languages(h,lang=>{
  assert.match(content(fact).trim(),{en:/^Signed in as\s+carla/,es:/^Sesión iniciada como\s+carla/,pt:/^Conectado como\s+carla/}[lang]);
  assert.equal(content(other).trim(),{en:'Use another account',es:'Usar otra cuenta',pt:'Usar outra conta'}[lang]);
  assert.match(content(key(box,'otherAccountHint')),{en:/another email/,es:/otro correo/,pt:/outro e-mail/}[lang]);
 });
 await other.listeners.click();
 assert.deepEqual(h.requests.filter(request=>request.path==='/api/auth/logout').map(request=>request.method),['POST'],'signs out first');
 assert.deepEqual(h.assigned,['/login.html?next='+encodeURIComponent(`/fiiu-checkin.html?a=day1-am&c=${CODE}`)],'sign-in comes back with the block and the code');
 // Once registration has closed the desk is the way, and another account still is.
 const closed=await scanned(refusal(false));assert.ok(key(result(closed),'askDesk'));assert.equal(key(result(closed),'register'),undefined);assert.ok(key(result(closed),'useOtherAccount'));
 // Without the account (the lookup failed) the refusal still offers another one.
 const unknown=await scanned(refusal(),{status:503,data:{error:'unavailable'}});
 assert.equal(title(unknown).dataset.fiiuText,'notRegistered');assert.equal(result(unknown).querySelector('.f-checkin-facts'),null);assert.ok(key(result(unknown),'useOtherAccount'));
 // A failed sign-out says so and leaves the button usable; nothing navigates.
 const stuck=await page(request=>request.path==='/api/fiiu/checkin'?refusal():request.path==='/api/fiiu/registration'?lookup:{status:503,data:{error:'unavailable'}});
 const again=key(result(stuck),'useOtherAccount');await again.listeners.click();
 assert.deepEqual(stuck.assigned,[]);assert.equal(again.disabled,false);assert.equal(stuck.message.dataset.fiiuText,'error');
 // Someone with a registration is on the right account: a block outside the plan names no account.
 const plan=await scanned({status:403,data:{code:'not_in_plan',activityId:'day1-am',registrationOpen:true}});
 assert.equal(key(result(plan),'useOtherAccount'),undefined);assert.equal(plan.requests.filter(request=>request.path==='/api/fiiu/registration').length,0,'and asks nothing more');
 // A reload uses the lookup it already made, and comes back to the block.
 const reload=await page(request=>request.path==='/api/fiiu/registration'?lookup:request.path==='/api/auth/logout'?{ok:true}:assert.fail(request.path),{search:'?a=day1-am'});
 assert.equal(title(reload).dataset.fiiuText,'notRegistered');assert.match(content(result(reload).querySelector('.f-checkin-facts')),/carla\.someone/);
 assert.equal(reload.requests.filter(request=>request.path==='/api/fiiu/registration').length,1);
 await key(result(reload),'useOtherAccount').listeners.click();assert.deepEqual(reload.assigned,['/login.html?next='+encodeURIComponent('/fiiu-checkin.html?a=day1-am')]);
});

test('the account lookup behind a refusal holds the result only briefly',async()=>{
 const waits=[];const h=await createFiiuHarness(request=>request.path==='/api/fiiu?kind=news'?publicData():request.path==='/api/fiiu/registration'?new Promise(()=>{}):{status:404,data:{code:'not_registered',activityId:'day1-am',registrationOpen:true}},{page:'fiiu-checkin',search:`?a=day1-am&c=${CODE}`,context:{Date:frozen('2026-10-21T09:12:00-05:00'),setTimeout:(fn,ms)=>{waits.push(ms);fn();}}});
 assert.ok(waits.length&&waits.every(ms=>ms<=1500),String(waits));assert.equal(title(h).dataset.fiiuText,'notRegistered');assert.equal(title(h).focused,true);
 assert.equal(result(h).querySelector('.f-checkin-facts'),null);assert.ok(key(result(h),'useOtherAccount'));
});
