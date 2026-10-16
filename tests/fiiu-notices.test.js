import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createApp} from '../server/server.js';
import {createFiiuStore} from '../server/fiiu-repository.js';
import {FIIU_EVENT} from '../server/fiiu-domain.js';
import {mergeProgramme} from '../server/fiiu-programme.js';
import {partyEmail,createPartyNotice,EMAIL_ROWS} from '../server/fiiu-email.js';
import {noticeState,noticeCounts,sendNoticeBatch} from '../server/fiiu-notices.js';
import {sendConfirmationBatch,confirmationState,sendConfirmations} from '../server/fiiu-confirmations.js';

/* The one-off closing-party announcement (server/fiiu-notices.js): every registrant who has not added the party gets it
   once. Recipients use fiiu-inbox.dev, a placeholder outside the reserved test domains; example.test ones are skipped. */
const NOW=Date.parse('2026-10-14T18:00:00.000Z'),origin='https://nodal.example.org';
const answers={firstName:'Ana',lastName:'Test',country:'Perú',city:'Lima',profile:'professional',publicOfficial:false,activities:['day1-am'],externalActivities:[],nationalId:'TEST-ID',gender:'prefer_not',age:30,accessibility:['none'],motivation:'learn',previousAttendance:'no',privacyAccepted:true};
function local(t){const db=createDatabase({filename:':memory:'});t.after(()=>db.close());return {db,store:createFiiuStore({db})};}
// Registrations in id order (the batch cursor's order); each person may carry a notice already.
async function people(db,store,rows){
 const made=[];
 for(const [i,{email,activities=['day1-am'],language=null,notice=null,noticeSentAt=null,summary='sent',summarySentAt=null}] of rows.entries()){
  const user=createUser(db,{fullName:'Person '+i,email,passwordHash:'unused'}),id=`10000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
  await store.insert('registrations',{id,eventId:'fiiu-2026',userId:user.id,email,answers:{...answers,activities},labStatus:'none',version:1,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',confirmationStatus:summary,confirmationLanguage:language,confirmationSentAt:summarySentAt});
  if(notice)await store.insert('notices',{id:randomUUID(),eventId:'fiiu-2026',userId:user.id,kind:'closing-party',status:notice,language:'es',sentAt:noticeSentAt,createdAt:'2026-10-13T00:00:00.000Z',updatedAt:'2026-10-13T00:00:00.000Z'});
  made.push({id,userId:user.id,email});
 }
 return made;
}
const noticeOf=(db,userId)=>{const row=db.prepare('SELECT status,sent_at AS sentAt,language FROM fiiu_notices WHERE user_id=?').get(userId);return row?{...row}:null;};
const outbox=(outcome=({registration})=>/@example\.test$/.test(registration.email)?{status:'skipped'}:{status:'sent',sentAt:'2026-10-14T18:00:05.000Z'})=>{const sent=[];const notify=async args=>{sent.push(args);return outcome(args);};return {sent,notify};};
async function sendAll(options){const batches=[];let after=null;for(;;){const batch=await sendNoticeBatch({...options,after});batches.push(batch);if(batch.capped||!batch.next)return batches;after=batch.next;}}

test('the announcement goes once to each registrant who has not added the party and has no notice yet, in their language',async t=>{
 const {db,store}=local(t);
 const [pt,es,withParty,tester,sent,pending,uncertain,skipped,failed]=await people(db,store,[
  {email:'pt@fiiu-inbox.dev',language:'pt'},{email:'es@fiiu-inbox.dev'},{email:'party@fiiu-inbox.dev',activities:['day1-am','closing-party']},{email:'tester@example.test',language:'en'},
  {email:'sent@fiiu-inbox.dev',notice:'sent',noticeSentAt:'2026-10-13T12:00:00.000Z'},{email:'pending@fiiu-inbox.dev',notice:'pending',noticeSentAt:'2026-10-13T12:00:00.000Z'},
  {email:'maybe@fiiu-inbox.dev',notice:'uncertain',noticeSentAt:'2026-10-13T12:00:00.000Z'},{email:'skip@example.test',notice:'skipped'},{email:'failed@fiiu-inbox.dev',notice:'failed'}]);
 assert.deepEqual(await noticeState(store,{now:NOW}),{counts:{waiting:3,pending:1,sent:1,failed:1,uncertain:1,skipped:1},dailyCap:150,sentToday:0,resetsAt:'2026-10-15T00:00:00.000Z'},'yesterday’s notices do not count today');
 const {sent:mail,notify}=outbox(),event=mergeProgramme([]);
 const batches=await sendAll({store,notify,event,size:2,now:NOW});
 assert.deepEqual(batches.map(b=>[b.sent,b.skipped,b.claimedElsewhere]),[[2,0,0],[0,1,0]]);assert.equal(batches[0].next,es.id);assert.equal(batches.at(-1).next,null);
 assert.deepEqual(mail.map(m=>[m.registration.email,m.language]),[['pt@fiiu-inbox.dev','pt'],['es@fiiu-inbox.dev','es'],['tester@example.test','en']]);
 assert.ok(mail.every(m=>m.event===event),'the sender gets the programme as it stands');
 assert.deepEqual(noticeOf(db,pt.userId),{status:'sent',sentAt:'2026-10-14T18:00:05.000Z',language:'pt'});
 assert.deepEqual(noticeOf(db,tester.userId),{status:'skipped',sentAt:null,language:'en'});
 assert.equal(noticeOf(db,withParty.userId),null,'someone who added the party is never announced to');
 for(const [person,status] of [[sent,'sent'],[pending,'pending'],[uncertain,'uncertain'],[skipped,'skipped'],[failed,'failed']])assert.equal(noticeOf(db,person.userId).status,status);
 assert.deepEqual((await noticeCounts(store)),{waiting:0,pending:1,sent:3,failed:1,uncertain:1,skipped:2});
 const again=await sendAll({store,notify,event,now:NOW});assert.deepEqual(again.map(b=>[b.sent,b.next]),[[0,null]]);assert.equal(mail.length,3,'a second press emails nobody');
 // Eligibility is judged when the batch runs: someone who takes the party out of their plan is waiting again (never
 // announced to before), and someone already announced to stays done whatever they change.
 const plan=(id,activities)=>db.prepare("UPDATE fiiu_registrations SET answers=json_set(answers,'$.activities',json(?)) WHERE id=?").run(JSON.stringify(activities),id);
 plan(withParty.id,['day1-am']);plan(es.id,['closing-party']);
 assert.equal((await noticeCounts(store)).waiting,1);
 assert.deepEqual((await sendAll({store,notify,event,now:NOW})).map(b=>b.sent),[1]);assert.equal(mail.at(-1).registration.email,'party@fiiu-inbox.dev');
});

test('each person is claimed before the email goes out, so two batches at once, or a double click, email everyone exactly once',async t=>{
 const {db,store:base}=local(t);
 // Both batches read the same waiting people before either claims one: the claim alone decides.
 let arrived=0,open;const barrier=new Promise(resolve=>{open=resolve;});
 const store={...base,noticeAudience:async(...args)=>{const rows=await base.noticeAudience(...args);if(arrived<2){if(++arrived===2)open();await barrier;}return rows;}};
 const crowd=await people(db,base,Array.from({length:4},(_,i)=>({email:`race${i}@fiiu-inbox.dev`})));
 const seen=[];const notify=async({registration})=>{
  const row=noticeOf(db,crowd.find(p=>p.id===registration.id).userId);assert.deepEqual([row.status,row.sentAt],['pending','2026-10-14T18:00:00.000Z'],'claimed, and counted against the cap, while the email is under way');
  seen.push(registration.id);return {status:'sent',sentAt:'2026-10-14T18:00:03.000Z'};};
 const results=await Promise.all([sendNoticeBatch({store,notify,event:FIIU_EVENT,now:NOW}),sendNoticeBatch({store,notify,event:FIIU_EVENT,now:NOW})]);
 assert.equal(seen.length,4);assert.equal(new Set(seen).size,4,'each person once');
 assert.equal(results[0].sent+results[1].sent,4);assert.equal(results[0].claimedElsewhere+results[1].claimedElsewhere,4,'the other batch loses every claim');
 assert.ok(crowd.every(p=>noticeOf(db,p.userId).status==='sent'));
});

test('outcomes: sent keeps the provider’s time, uncertain the attempt’s, failed none; retrying sends the failed ones only, once',async t=>{
 const {db,store}=local(t);
 const [ok,slow,thrown,bounce,later]=await people(db,store,[{email:'ok@fiiu-inbox.dev'},{email:'slow@fiiu-inbox.dev'},{email:'thrown@fiiu-inbox.dev'},{email:'bounce@fiiu-inbox.dev'},{email:'later@fiiu-inbox.dev'}]);
 const outcome=({registration})=>({'ok@fiiu-inbox.dev':{status:'sent',sentAt:'2026-10-14T18:00:09.000Z'},'slow@fiiu-inbox.dev':{status:'uncertain'},'bounce@fiiu-inbox.dev':{status:'failed'},'later@fiiu-inbox.dev':{status:'failed'}})[registration.email]??(()=>{throw Error('socket hang up');})();
 const {sent:mail,notify}=outbox(outcome);
 const batch=await sendNoticeBatch({store,notify,event:FIIU_EVENT,size:5,now:NOW});
 assert.deepEqual([batch.sent,batch.uncertain,batch.failed,batch.sentToday],[1,2,2,3]);
 assert.deepEqual([ok,slow,thrown,bounce].map(p=>noticeOf(db,p.userId)).map(n=>[n.status,n.sentAt]),[['sent','2026-10-14T18:00:09.000Z'],['uncertain','2026-10-14T18:00:00.000Z'],['uncertain','2026-10-14T18:00:00.000Z'],['failed',null]]);
 // Someone whose announcement failed and who has since added the party is not emailed again.
 db.prepare("UPDATE fiiu_registrations SET answers=json_set(answers,'$.activities',json('[\"closing-party\"]')) WHERE id=?").run(later.id);
 const retry=outbox();
 const passes=await sendAll({store,notify:retry.notify,event:FIIU_EVENT,retryFailed:true,size:1,now:NOW});
 assert.deepEqual(retry.sent.map(m=>m.registration.email),['bounce@fiiu-inbox.dev'],'only the failed one still waiting; uncertain is never resent');
 assert.equal(passes.reduce((n,b)=>n+b.sent,0),1);assert.equal(noticeOf(db,bounce.userId).status,'sent');
 assert.equal(noticeOf(db,later.userId),null,'their failed row goes, so no failed one is left to offer a retry for');assert.equal((await noticeCounts(store)).failed,0);
 assert.equal(mail.length,5);
 // Should they take the party out again, they are waiting once more, like anyone never announced to.
 db.prepare("UPDATE fiiu_registrations SET answers=json_set(answers,'$.activities',json('[\"day1-am\"]')) WHERE id=?").run(later.id);
 assert.equal((await noticeCounts(store)).waiting,1);
 assert.equal((await sendNoticeBatch({store,notify:outbox(()=>({status:'failed'})).notify,event:FIIU_EVENT,now:NOW})).failed,1);assert.equal(noticeOf(db,later.userId).status,'failed');
 // A failed row another sender claims between the read and the claim is left to it (compare-and-set failed → pending).
 const racing={...store,find:async(name,filters,options)=>{const rows=await store.find(name,filters,options);if(name==='notices'&&filters.status==='failed')db.prepare("UPDATE fiiu_notices SET status='pending' WHERE status='failed'").run();return rows;}};
 const lost=await sendNoticeBatch({store:racing,notify:retry.notify,event:FIIU_EVENT,retryFailed:true,now:NOW});
 assert.deepEqual([lost.sent,lost.claimedElsewhere,retry.sent.length],[0,1,1]);
});

test('a retry settles the failed notices nobody can be retried for, someone who has since added the party or cancelled, so the failed count is only people a retry reaches',async t=>{
 const {db,store}=local(t);
 const [joined,cancelled,still]=await people(db,store,[{email:'joined@fiiu-inbox.dev',notice:'failed'},{email:'cancelled@fiiu-inbox.dev',notice:'failed'},{email:'still@fiiu-inbox.dev',notice:'failed'}]);
 db.prepare("UPDATE fiiu_registrations SET answers=json_set(answers,'$.activities',json('[\"closing-party\"]')) WHERE id=?").run(joined.id);
 // The notice row outlives the registration: it belongs to the account (the cancel route removes the registration this way).
 assert.equal(await store.remove('registrations',{id:cancelled.id,userId:cancelled.userId,version:1}),1);
 assert.equal((await noticeCounts(store)).failed,3);
 const {sent:mail,notify}=outbox(),passes=await sendAll({store,notify,event:FIIU_EVENT,retryFailed:true,size:2,now:NOW});
 assert.deepEqual(mail.map(m=>m.registration.email),['still@fiiu-inbox.dev']);assert.deepEqual([passes.reduce((n,b)=>n+b.sent,0),passes.reduce((n,b)=>n+b.failed,0),passes.at(-1).next],[1,0,null]);
 assert.deepEqual([joined,cancelled].map(p=>noticeOf(db,p.userId)),[null,null]);assert.equal(noticeOf(db,still.userId).status,'sent');
 assert.deepEqual(await noticeCounts(store),{waiting:0,pending:0,sent:1,failed:0,uncertain:0,skipped:0},'no failed one is left, and the person with the party is not waiting');
 assert.deepEqual((await sendAll({store,notify,event:FIIU_EVENT,retryFailed:true,now:NOW})).map(b=>[b.sent,b.next]),[[0,null]]);assert.equal(mail.length,1);
});

test('a retry whose cleanup of an unreachable failed row fails still sends to everyone it can reach, and the row waits for the next pass',async t=>{
 const {db,store}=local(t);
 const [joined,still]=await people(db,store,[{email:'joined@fiiu-inbox.dev',notice:'failed'},{email:'still@fiiu-inbox.dev',notice:'failed'}]);
 db.prepare("UPDATE fiiu_registrations SET answers=json_set(answers,'$.activities',json('[\"closing-party\"]')) WHERE id=?").run(joined.id);
 // A Supabase 5xx or timeout on the DELETE of the stale row.
 const flaky={...store,remove:async(name,...args)=>{if(name==='notices')throw Object.assign(Error('festival deletion unavailable'),{status:502});return store.remove(name,...args);}};
 const {sent:mail,notify}=outbox(),batch=await sendNoticeBatch({store:flaky,notify,event:FIIU_EVENT,retryFailed:true,now:NOW});
 assert.deepEqual(mail.map(m=>m.registration.email),['still@fiiu-inbox.dev']);assert.deepEqual([batch.sent,batch.failed,batch.next],[1,0,null]);
 assert.equal(noticeOf(db,still.userId).status,'sent');assert.equal(noticeOf(db,joined.userId).status,'failed','left for the next retry pass');
 await sendNoticeBatch({store,notify,event:FIIU_EVENT,retryFailed:true,now:NOW});
 assert.equal(noticeOf(db,joined.userId),null,'the next pass settles it');assert.equal(mail.length,1);
});

test('summary emails and party notices share one daily cap, counted from every send that may have reached the provider',async t=>{
 const {db,store}=local(t);
 await people(db,store,[{email:'summary-today@fiiu-inbox.dev',summarySentAt:'2026-10-14T01:00:00.000Z'},{email:'summary-waiting@fiiu-inbox.dev',summary:'none'},
  ...Array.from({length:4},(_,i)=>({email:`n${i}@fiiu-inbox.dev`}))]);
 const {sent:mail,notify}=outbox();
 const first=await sendNoticeBatch({store,notify,event:FIIU_EVENT,dailyCap:3,now:NOW});
 assert.deepEqual([first.sent,first.sentToday],[2,3],'one summary already went out today, so two notices fit');
 const capped=await sendNoticeBatch({store,notify,event:FIIU_EVENT,dailyCap:3,after:first.next,now:NOW});
 assert.deepEqual(capped,{capped:true,dailyCap:3,sentToday:3,resetsAt:'2026-10-15T00:00:00.000Z'});assert.equal(mail.length,2);
 const summaries=await sendConfirmationBatch({store,confirm:async()=>assert.fail('over the cap'),dailyCap:3,now:NOW});assert.equal(summaries.capped,true,'the summary button sees the notices');
 assert.equal((await confirmationState(store,{dailyCap:3,now:NOW})).sentToday,3);assert.equal((await noticeState(store,{dailyCap:3,now:NOW})).sentToday,3);
 // The next UTC day there is room again.
 const tomorrow=await sendNoticeBatch({store,notify,event:FIIU_EVENT,dailyCap:3,after:first.next,now:Date.parse('2026-10-15T00:00:01.000Z')});assert.deepEqual([tomorrow.sent,tomorrow.sentToday],[3,3]);
});

test('a claim that finds the cap filled by a sender that got in first is put back unsent: notices, their retries, summaries and the script alike',async t=>{
 const {db,store}=local(t);
 const [first,retried,summary]=await people(db,store,[{email:'first@fiiu-inbox.dev'},{email:'retried@fiiu-inbox.dev',notice:'failed'},{email:'summary@fiiu-inbox.dev',summary:'none',activities:['closing-party']},
  ...[0,1,2].map(i=>({email:`rival${i}@fiiu-inbox.dev`,summary:'failed',activities:['closing-party']}))]);
 // Another organiser's summary batch claims three people just before each claim here: today's cap of three is full.
 const rivals=on=>db.prepare("UPDATE fiiu_registrations SET confirmation_status=?,confirmation_sent_at=? WHERE email LIKE 'rival%'").run(on?'pending':'failed',on?'2026-10-14T17:59:59.000Z':null);
 const racing={...store,insert:async(...args)=>{rivals(true);return store.insert(...args);},update:async(...args)=>{rivals(true);return store.update(...args);}};
 const summaryOf=()=>({...db.prepare('SELECT confirmation_status AS status,confirmation_sent_at AS sentAt,confirmation_language AS language FROM fiiu_registrations WHERE id=?').get(summary.id)});
 const mail=[],send=async({registration})=>{mail.push(registration.email);return {status:'sent',sentAt:'2026-10-14T18:00:05.000Z'};};
 assert.deepEqual(await sendNoticeBatch({store:racing,notify:send,event:FIIU_EVENT,dailyCap:3,now:NOW}),{capped:true,sent:0,failed:0,uncertain:0,skipped:0,claimedElsewhere:0,dailyCap:3,sentToday:3,resetsAt:'2026-10-15T00:00:00.000Z'});
 assert.equal(noticeOf(db,first.userId),null,'no notice row is left behind: still waiting');
 rivals(false);assert.equal((await sendNoticeBatch({store:racing,notify:send,event:FIIU_EVENT,retryFailed:true,dailyCap:3,now:NOW})).capped,true);
 assert.deepEqual(noticeOf(db,retried.userId),{status:'failed',sentAt:null,language:'es'},'the failed row is back as it was, for the next retry');
 rivals(false);assert.equal((await sendConfirmationBatch({store:racing,confirm:send,event:FIIU_EVENT,dailyCap:3,now:NOW})).capped,true);
 assert.deepEqual(summaryOf(),{status:'none',sentAt:null,language:null},'the summary is back to waiting, its language unset as before');
 rivals(false);const script=await sendConfirmations({store:racing,confirm:send,send:true,delayMs:0,log:()=>{},dailyCap:3,clock:()=>NOW});
 assert.deepEqual([script.capped,script.listed,script.sent,script.sentToday],[true,0,0,3]);assert.deepEqual(summaryOf(),{status:'none',sentAt:null,language:null});
 assert.deepEqual(mail,[],'nobody is emailed over the cap');
 // Once the cap has room, each of them goes out as usual.
 rivals(false);
 assert.equal((await sendNoticeBatch({store,notify:send,event:FIIU_EVENT,dailyCap:3,now:NOW})).sent,1);
 assert.equal((await sendNoticeBatch({store,notify:send,event:FIIU_EVENT,retryFailed:true,dailyCap:3,now:NOW})).sent,1);
 assert.equal((await sendConfirmationBatch({store,confirm:send,event:FIIU_EVENT,dailyCap:3,now:NOW})).sent,1);
 assert.deepEqual(mail,['first@fiiu-inbox.dev','retried@fiiu-inbox.dev','summary@fiiu-inbox.dev']);
});

test('a claim whose cap count fails is put back unsent before the error goes on, so the next pass sends it: notices, their retries and summaries alike',async t=>{
 const {db,store}=local(t);
 const [first,retried,summary]=await people(db,store,[{email:'first@fiiu-inbox.dev'},{email:'retried@fiiu-inbox.dev',notice:'failed'},{email:'summary@fiiu-inbox.dev',summary:'none',activities:['closing-party']}]);
 // The batch's own two counts of today's total pass; the next one, made once the person is claimed, fails (a Supabase 5xx or timeout).
 const flaky=()=>{let n=0;return {...store,count:async(...args)=>{if(++n===3)throw Object.assign(Error('festival data unavailable'),{status:502});return store.count(...args);}};};
 const summaryOf=()=>({...db.prepare('SELECT confirmation_status AS status,confirmation_sent_at AS sentAt,confirmation_language AS language FROM fiiu_registrations WHERE id=?').get(summary.id)});
 const mail=[],send=async({registration})=>{mail.push(registration.email);return {status:'sent',sentAt:'2026-10-14T18:00:05.000Z'};};
 await assert.rejects(sendNoticeBatch({store:flaky(),notify:send,event:FIIU_EVENT,now:NOW}),/festival data unavailable/);
 assert.equal(noticeOf(db,first.userId),null,'no pending row is left behind: still waiting, and not counted against the cap');
 await assert.rejects(sendNoticeBatch({store:flaky(),notify:send,event:FIIU_EVENT,retryFailed:true,now:NOW}),/festival data unavailable/);
 assert.deepEqual(noticeOf(db,retried.userId),{status:'failed',sentAt:null,language:'es'},'the failed row is back as it was, for the next retry');
 await assert.rejects(sendConfirmationBatch({store:flaky(),confirm:send,event:FIIU_EVENT,now:NOW}),/festival data unavailable/);
 assert.deepEqual(summaryOf(),{status:'none',sentAt:null,language:null},'the summary is back to waiting');
 assert.deepEqual(mail,[]);assert.equal((await noticeState(store,{now:NOW})).sentToday,0);
 assert.equal((await sendNoticeBatch({store,notify:send,event:FIIU_EVENT,now:NOW})).sent,1);
 assert.equal((await sendNoticeBatch({store,notify:send,event:FIIU_EVENT,retryFailed:true,now:NOW})).sent,1);
 assert.equal((await sendConfirmationBatch({store,confirm:send,event:FIIU_EVENT,now:NOW})).sent,1);
 assert.deepEqual(mail,['first@fiiu-inbox.dev','retried@fiiu-inbox.dev','summary@fiiu-inbox.dev']);
});

test('party passes and the summary button running at once never pass the shared cap together',async t=>{
 const {db,store:base}=local(t);
 // All three read today's total before any of them claims, as overlapping requests near the cap do.
 let arrived=0,open;const barrier=new Promise(resolve=>{open=resolve;});
 const store={...base,count:async(...args)=>{const n=await base.count(...args);if(arrived<6){if(++arrived===6)open();await barrier;}return n;}};
 const crowd=await people(db,base,[...Array.from({length:8},(_,i)=>({email:`n${i}@fiiu-inbox.dev`})),...Array.from({length:4},(_,i)=>({email:`s${i}@fiiu-inbox.dev`,summary:'none',activities:['closing-party']}))]);
 const mail=[],send=async({registration})=>{mail.push(registration.email);return {status:'sent',sentAt:'2026-10-14T18:00:05.000Z'};};
 const answers=await Promise.all([sendNoticeBatch({store,notify:send,event:FIIU_EVENT,dailyCap:3,now:NOW}),sendNoticeBatch({store,notify:send,event:FIIU_EVENT,dailyCap:3,after:crowd[3].id,now:NOW}),
  sendConfirmationBatch({store,confirm:send,event:FIIU_EVENT,dailyCap:3,now:NOW})]);
 const {sentToday}=await noticeState(base,{dailyCap:3,now:NOW});
 assert.ok(sentToday<=3,`${sentToday} sends counted today`);assert.equal(mail.length,sentToday,'every email that went out is counted, and nothing else');
 assert.ok(answers.every(answer=>answer.capped||answer.sent===3),'a batch that put anyone back answers capped');
 assert.equal(db.prepare("SELECT count(*) AS n FROM fiiu_notices WHERE status<>'sent'").get().n,0,'whoever was put back has no notice row, so is still waiting');
 assert.equal(db.prepare("SELECT count(*) AS n FROM fiiu_registrations WHERE confirmation_status NOT IN ('sent','none')").get().n,0,'and no summary is stuck pending');
});

test('the party email names the party as the programme has it, with its day, start, session lines, venue and a link to add it, in three languages',()=>{
 const addUrl=`${origin}/fiiu.html#add-closing-party`;
 for(const [language,subject,day,from,heading] of [
  ['es','¡Fiesta de cierre y Chelas Urbanas! · FIIU Fest 11','Sábado, 24 de octubre','Desde las 17:00','Ven a la fiesta de cierre'],
  ['en','Closing party: ¡Fiesta de cierre y Chelas Urbanas! · FIIU Fest 11','Saturday 24 October','From 17:00','Come to the closing party'],
  ['pt','Festa de encerramento: ¡Fiesta de cierre y Chelas Urbanas! · FIIU Fest 11','Sábado, 24 de outubro','A partir das 17:00','Venha para a festa de encerramento']]){
  const email=partyEmail({event:FIIU_EVENT,language,origin});
  assert.equal(email.subject,subject,language);
  for(const part of ['¡Fiesta de cierre y Chelas Urbanas!',`${day} · ${from}`,'17:00–19:00','Chelas Urbanas','19:00 en adelante','Fiesta de cierre','La Vermut Bar, Av. Francisco Bolognesi 235, Barranco 15063',addUrl,`${origin}/privacy.html`])
   assert.ok(email.text.includes(part),`${language} text: ${part}`);
  assert.match(email.html,new RegExp(`<html lang="${language}">`));assert.ok(email.html.includes(`href="${addUrl}"`),language);assert.ok(email.html.includes(heading),language);
  assert.ok(email.html.includes(EMAIL_ROWS.partyAdd[['en','es','pt'].indexOf(language)]),language);
  assert.ok(email.html.includes(`${origin}/assets/email/nodal-lockup.png`),'the same lockup as the summary');
  assert.doesNotMatch(email.html,/border-left|<script|https:\/\/fonts\./);
 }
 assert.equal(partyEmail({event:FIIU_EVENT,language:'fr',origin}).subject,'¡Fiesta de cierre y Chelas Urbanas! · FIIU Fest 11','Spanish for anything unknown');
 // Built from the merged programme: an organiser's edit shows, escaped in the HTML, with the description's line breaks.
 const event=mergeProgramme([{id:'closing-party',data:{title:'Fiesta <final> & cierre',date:'2026-10-24',time:'18:00–23:00',venue:'Otro bar',description:'Trae tu DNI.\nHay música.',sessions:[['18:00','Brindis']]},version:3}]);
 const edited=partyEmail({event,language:'es',origin});
 assert.equal(edited.subject,'Fiesta <final> & cierre · FIIU Fest 11');
 for(const part of ['Sábado, 24 de octubre · 18:00–23:00','Otro bar','18:00','Brindis','Trae tu DNI.\nHay música.'])assert.ok(edited.text.includes(part),part);
 assert.doesNotMatch(edited.text,/Chelas Urbanas|Vermut/);
 assert.ok(edited.html.includes('Fiesta &lt;final&gt; &amp; cierre'));assert.doesNotMatch(edited.html,/<final>/);assert.ok(edited.html.includes('Trae tu DNI.<br>Hay música.'));
 assert.throws(()=>partyEmail({event:{...FIIU_EVENT,activities:FIIU_EVENT.activities.filter(a=>a.id!=='closing-party')},language:'es',origin}),/closing party/);
});

test('the party notice sender is off where the summary is off, skips test addresses, maps every outcome and logs no address',async()=>{
 const logs=[],log=line=>logs.push(line),sent=[];
 assert.equal(createPartyNotice({env:{},log}),null);
 assert.equal(createPartyNotice({env:{VERCEL:'1',VERCEL_ENV:'preview',EMAIL_SMTP_URL:'smtp://u:p@smtp.example.org:587',EMAIL_FROM:'a@b.dev',PUBLIC_BASE_URL:origin},log}),null);
 assert.equal(logs.at(-1),'FIIU party notice is off outside Vercel Production');
 assert.equal(createPartyNotice({transport:{loopback:false,send(){}},origin,loopbackOnly:true,log}),null);assert.match(logs.at(-1),/^FIIU party notice is off: a local SQLite server/);
 assert.equal(createPartyNotice({transport:{loopback:true,send(){}},origin:null,log}),null);assert.match(logs.at(-1),/PUBLIC_BASE_URL/);
 const transport=failure=>({loopback:true,async send(message){sent.push(message);if(failure)throw failure;}});
 const registration={id:'10000000-0000-4000-8000-000000000001',email:'ana@fiiu-inbox.dev'};
 const ok=await createPartyNotice({transport:transport(),origin,log})({registration,event:FIIU_EVENT,language:'pt'});
 assert.equal(ok.status,'sent');assert.ok(Date.parse(ok.sentAt));
 assert.deepEqual([sent[0].to,sent[0].subject,sent[0].language],['ana@fiiu-inbox.dev','Festa de encerramento: ¡Fiesta de cierre y Chelas Urbanas! · FIIU Fest 11','pt']);assert.match(sent[0].text,/fiiu\.html#add-closing-party/);
 const smtp=delivery=>Object.assign(Error('SMTP refused'),{delivery,status:550,stage:'recipient'});
 assert.deepEqual(await createPartyNotice({transport:transport(smtp('no')),origin,log})({registration,event:FIIU_EVENT,language:'es'}),{status:'failed'});
 assert.equal(logs.at(-1),`FIIU party notice failed for registration ${registration.id} at recipient (SMTP 550)`);
 assert.deepEqual(await createPartyNotice({transport:transport(Error('socket hang up')),origin,log})({registration,event:FIIU_EVENT,language:'es'}),{status:'uncertain'});
 const before=sent.length;
 assert.deepEqual(await createPartyNotice({transport:transport(),origin,log})({registration:{...registration,email:'ana@example.test'},event:FIIU_EVENT,language:'es'}),{status:'skipped'});assert.equal(sent.length,before);
 assert.deepEqual(await createPartyNotice({transport:transport(),origin,log})({registration,event:{...FIIU_EVENT,activities:[]},language:'es'}),{status:'failed'},'a programme without the party fails before anything is sent');
 assert.equal(logs.at(-1),`FIIU party notice failed for registration ${registration.id} (template)`);
 assert.ok(logs.every(line=>!/@/.test(line)),logs.join('\n'));
});

async function app(t,{notice,backfill={now:()=>NOW},wrap=store=>store}={}){
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());const store=createFiiuStore({db}),cookies={};
 for(const [name,role] of [['member','member'],['admin','admin']])cookies[name]=createSession(db,createUser(db,{fullName:name,email:`${name}@fiiu-inbox.dev`,passwordHash:'unused',role}).id).cookie.split(';')[0];
 const server=createApp({db,fiiuStore:wrap(store),fiiuConfirmation:null,fiiuPartyNotice:notice,fiiuBackfill:backfill});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,{actor='admin',method='GET',body,origin=base}={})=>fetch(base+path,{method,headers:{...(cookies[actor]?{Cookie:cookies[actor]}:{}),Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 return {db,store,call};
}

test('organisers announce the party from the panel batch by batch, with the programme as it stands, until nobody is left',async t=>{
 const {sent:mail,notify}=outbox();
 const {db,store,call}=await app(t,{notice:notify});
 await people(db,store,Array.from({length:6},(_,i)=>({email:`p${i}@fiiu-inbox.dev`,...(i===5?{activities:['closing-party']}:{})})));
 assert.deepEqual(await(await call('/api/admin/fiiu/notices/closing-party')).json(),{configured:true,counts:{waiting:5,pending:0,sent:0,failed:0,uncertain:0,skipped:0},dailyCap:150,sentToday:0,resetsAt:'2026-10-15T00:00:00.000Z'});
 // The organisers renamed the party: the announcement says so.
 const party=FIIU_EVENT.activities.find(a=>a.id==='closing-party');
 assert.equal((await call('/api/admin/fiiu/programme/closing-party',{method:'PUT',body:{title:'Fiesta final',date:party.date,time:party.time,venue:party.venue,description:'',sessions:party.sessions,version:0}})).status,200);
 const batches=[];let after=null;
 for(;;){const response=await call('/api/admin/fiiu/notices/closing-party',{method:'POST',body:after?{after}:{}});assert.equal(response.status,200);const batch=await response.json();batches.push(batch);if(!batch.next)break;after=batch.next;}
 assert.deepEqual(batches.map(b=>b.sent),[4,1]);assert.deepEqual(batches.at(-1).counts,{waiting:0,pending:0,sent:5,failed:0,uncertain:0,skipped:0});assert.equal(batches.at(-1).sentToday,5);
 assert.deepEqual(Object.keys(batches[0]).sort(),['claimedElsewhere','counts','dailyCap','failed','next','resetsAt','sent','sentToday','skipped','uncertain']);
 assert.equal(mail.length,5);assert.ok(mail.every(m=>m.event.activities.find(a=>a.id==='closing-party').title==='Fiesta final'));
 // Retry with nothing failed sends nothing.
 assert.equal((await(await call('/api/admin/fiiu/notices/closing-party',{method:'POST',body:{retryFailed:true}})).json()).sent,0);
});

test('the announcement is for organisers only, same-origin, validated, answers 503 while email is off and 429 at the daily cap',async t=>{
 const off=await app(t,{notice:null});await people(off.db,off.store,[{email:'one@fiiu-inbox.dev'}]);
 assert.equal((await(await off.call('/api/admin/fiiu/notices/closing-party')).json()).configured,false);
 const refused=await off.call('/api/admin/fiiu/notices/closing-party',{method:'POST',body:{}});
 assert.equal(refused.status,503);assert.deepEqual(await refused.json(),{error:'email is not configured',code:'email_not_configured'});
 const {sent:mail,notify}=outbox();
 const {db,store,call}=await app(t,{notice:notify,backfill:{now:()=>NOW,dailyCap:1}});await people(db,store,[{email:'one@fiiu-inbox.dev'},{email:'two@fiiu-inbox.dev'}]);
 for(const [actor,status] of [['member',403],['guest',401]]){
  assert.equal((await call('/api/admin/fiiu/notices/closing-party',{actor})).status,status,actor);
  assert.equal((await call('/api/admin/fiiu/notices/closing-party',{actor,method:'POST',body:{}})).status,status,actor);
 }
 assert.equal((await call('/api/admin/fiiu/notices/closing-party',{method:'POST',body:{},origin:'https://attacker.example'})).status,403);
 for(const body of [{retryFailed:'yes'},{after:'not-an-id'},{after:42}])assert.equal((await call('/api/admin/fiiu/notices/closing-party',{method:'POST',body})).status,400,JSON.stringify(body));
 assert.equal(mail.length,0);
 const first=await call('/api/admin/fiiu/notices/closing-party',{method:'POST',body:{}});assert.equal(first.status,200);
 const capped=await call('/api/admin/fiiu/notices/closing-party',{method:'POST',body:{after:(await first.json()).next}});assert.equal(capped.status,429);
 assert.deepEqual(await capped.json(),{error:'daily email limit reached',code:'daily_cap',dailyCap:1,sentToday:1,resetsAt:'2026-10-15T00:00:00.000Z',counts:{waiting:1,pending:0,sent:1,failed:0,uncertain:0,skipped:0},sent:0,failed:0,uncertain:0,skipped:0,claimedElsewhere:0});
 assert.equal(mail.length,1);
 assert.equal((await call('/api/admin/fiiu/notices/other-kind',{method:'POST',body:{}})).status,404);
});

test('a party batch another sender stops at today’s cap answers 429 with the announcements it did send, for the panel’s report',async t=>{
 let inserts=0,rival=null;
 // The batch's fourth claim waits while a summary email takes the last place left today.
 const wrap=base=>({...base,insert:async(name,row)=>{if(name==='notices'&&++inserts===4){await new Promise(resolve=>setTimeout(resolve,50));await base.update('registrations',{id:rival.id},{confirmationStatus:'pending',confirmationSentAt:new Date(NOW).toISOString()});}return base.insert(name,row);}});
 const {sent:mail,notify}=outbox(),{db,store,call}=await app(t,{notice:notify,backfill:{now:()=>NOW,dailyCap:4},wrap});
 [rival]=await people(db,store,[{email:'rival@fiiu-inbox.dev',activities:['closing-party'],summary:'none'},...Array.from({length:6},(_,i)=>({email:`p${i}@fiiu-inbox.dev`}))]);
 const response=await call('/api/admin/fiiu/notices/closing-party',{method:'POST',body:{}});assert.equal(response.status,429);
 assert.deepEqual(await response.json(),{error:'daily email limit reached',code:'daily_cap',dailyCap:4,sentToday:4,resetsAt:'2026-10-15T00:00:00.000Z',counts:{waiting:3,pending:0,sent:3,failed:0,uncertain:0,skipped:0},sent:3,failed:0,uncertain:0,skipped:0,claimedElsewhere:0});
 assert.deepEqual(mail.map(m=>m.registration.email),['p0@fiiu-inbox.dev','p1@fiiu-inbox.dev','p2@fiiu-inbox.dev']);
});

test('a failed announcement goes as soon as its person adds the party or cancels, so the panel never offers a retry nobody can get',async t=>{
 const {db,store,call}=await app(t,{notice:outbox().notify});
 const register=async actor=>{const response=await call('/api/fiiu/registration',{actor,method:'PUT',body:{version:0,...answers}});assert.equal(response.status,200);return (await response.json()).registration;};
 const fail=async ({userId})=>store.insert('notices',{id:randomUUID(),eventId:'fiiu-2026',userId,kind:'closing-party',status:'failed',language:'es',sentAt:null,createdAt:'2026-10-14T17:00:00.000Z',updatedAt:'2026-10-14T17:00:00.000Z'});
 const [member,admin]=[await register('member'),await register('admin')];await fail(member);await fail(admin);
 const failedCount=async()=>(await(await call('/api/admin/fiiu/notices/closing-party')).json()).counts.failed;
 assert.equal(await failedCount(),2);
 const edit=activities=>call('/api/fiiu/registration',{actor:'member',method:'PUT',body:{...answers,activities,version:member.version,registrationId:member.id}});
 assert.equal((await edit(['day1-am','day1-pm'])).status,200);assert.equal(noticeOf(db,member.userId).status,'failed','still without the party: the retry is still theirs');member.version++;
 assert.equal((await edit(['day1-am','closing-party'])).status,200);assert.equal(noticeOf(db,member.userId),null);
 assert.equal((await call('/api/fiiu/registration',{actor:'admin',method:'DELETE',body:{version:admin.version,registrationId:admin.id}})).status,200);assert.equal(noticeOf(db,admin.userId),null);
 assert.equal(await failedCount(),0);
});

test('the local database keeps notices as the migration does: one per person and kind, gone with the account',async t=>{
 const {db,store}=local(t);
 assert.deepEqual(db.prepare('PRAGMA table_info(fiiu_notices)').all().map(c=>c.name),['id','event_id','user_id','kind','status','language','sent_at','created_at','updated_at']);
 const [person]=await people(db,store,[{email:'one@fiiu-inbox.dev',notice:'sent',noticeSentAt:'2026-10-14T00:00:00.000Z'}]);
 await assert.rejects(store.insert('notices',{id:randomUUID(),eventId:'fiiu-2026',userId:person.userId,kind:'closing-party',status:'pending',language:'es',sentAt:null,createdAt:'x',updatedAt:'x'}),err=>err.status===409,'one per person and kind');
 for(const [column,value] of [['kind','other'],['status','queued'],['language','fr']])
  assert.throws(()=>db.prepare(`UPDATE fiiu_notices SET ${column}=?`).run(value),/CHECK constraint/,column);
 db.prepare('DELETE FROM users WHERE id=?').run(person.userId);
 assert.equal(db.prepare('SELECT count(*) AS n FROM fiiu_notices').get().n,0);
});
