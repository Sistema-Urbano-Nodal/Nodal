import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../web/scripts/fiiu-ui.js',import.meta.url),'utf8');
function apiFor(response){
 const context={window:{nodalI18n:{lang:'en',onChange(){}}},document:{documentElement:{lang:'en'},querySelectorAll:()=>[]},fetch:async()=>response,AbortSignal,Error,Intl,Date};
 vm.runInNewContext(source,context);return context.window.Fiiu.api;
}
test('festival errors retain HTTP recovery guidance when hosting returns HTML',async()=>{
 // A 403 page is the host's, not NODAL's refusal of the account: see the firewall test below.
 for(const [status,key] of [[401,'unauthorized'],[409,'conflict'],[429,'rate'],[503,'error']]){
  const api=apiFor(new Response('<html>hosting error</html>',{status}));
  await assert.rejects(api('/api/fiiu/registration'),error=>error.status===status&&error.key===key);
 }
});
test('a firewall challenge reads as a failed request with the wait it asks for, never as a refusal of the account',async()=>{
 // Vercel's Security Checkpoint: an HTML page, marked x-vercel-mitigated, answering every request from a flagged address (a venue's Wi-Fi) for a minute or two.
 const checkpoint=(status=403,headers={})=>new Response('<!DOCTYPE html><title>Vercel Security Checkpoint</title>',{status,headers:{'Content-Type':'text/html','x-vercel-mitigated':'challenge','Retry-After':'30',...headers}});
 for(const [path,body] of [['/api/fiiu/checkin',{activityId:'day1-am',code:'x'}],['/api/fiiu/registration',{version:1}],['/api/fiiu/live',undefined]]){
  await assert.rejects(apiFor(checkpoint())(path,body,body&&path==='/api/fiiu/registration'?'PUT':undefined),error=>error.key==='error'&&error.status===undefined&&error.blocked===true&&error.retryAfter===30&&error.message==='We could not complete the request. Your answers are still here. Try again.',path);
 }
 // Any answer the firewall marks is its own, JSON or not, refusal or rate limit; a wait past two minutes is read as two minutes, and one that is not a number of seconds is left out.
 await assert.rejects(apiFor(new Response(JSON.stringify({error:'blocked'}),{status:403,headers:{'x-vercel-mitigated':'deny'}}))('/api/fiiu/live'),error=>error.key==='error'&&error.status===undefined&&!('retryAfter' in error));
 await assert.rejects(apiFor(checkpoint(429,{'Retry-After':'3600'}))('/api/fiiu/pulse'),error=>error.key==='error'&&error.status===undefined&&error.retryAfter===120);
 await assert.rejects(apiFor(checkpoint(403,{'Retry-After':'Wed, 21 Oct 2026 15:00:00 GMT'}))('/api/fiiu/live'),error=>error.key==='error'&&!('retryAfter' in error));
 // An unmarked 403 that is not NODAL's JSON (a proxy's page, an empty body) is not a refusal either.
 for(const response of [new Response('<html>Forbidden</html>',{status:403}),new Response('',{status:403}),Response.json({},{status:403}),Response.json([],{status:403})]){
  await assert.rejects(apiFor(response)('/api/fiiu/live'),error=>error.key==='error'&&error.status===undefined&&error.blocked===true);
 }
 // NODAL's own refusals still speak for the account.
 await assert.rejects(apiFor(Response.json({error:'administrator access required'},{status:403}))('/api/admin/fiiu/summary'),error=>error.key==='forbidden'&&error.status===403);
 await assert.rejects(apiFor(Response.json({error:'festival registration required',code:'not_registered'},{status:403}))('/api/fiiu/live'),error=>error.key==='forbidden'&&error.status===403&&error.code==='not_registered');
 await assert.rejects(apiFor(Response.json({error:'registration is closed'},{status:403}))('/api/fiiu/registration',{version:1},'PUT'),error=>error.key==='closed'&&error.status===403);
});
test('account-switch conflicts have distinct guidance from stale registration versions',async()=>{
 const api=apiFor(Response.json({error:'account changed; reload before continuing'},{status:409}));
 await assert.rejects(api('/api/fiiu/registration',{},'PUT'),error=>error.status===409&&error.key==='accountChanged');
});
test('registration writes require a confirmed record with the expected identity and revision',async()=>{
 const body={version:1,registrationId:'registration-a',expectedUserId:'account-a'};
 const registration={id:'registration-a',userId:'account-a',version:2,answers:{activities:['day1-am']}};
 for(const data of [{},null,{registration:null},{registration:{...registration,id:'different'}},{registration:{...registration,version:1}},{registration:{...registration,userId:'account-b'}}]){
  await assert.rejects(apiFor(Response.json(data))('/api/fiiu/registration',body,'PUT'),error=>error.key==='error');
 }
 assert.equal((await apiFor(Response.json({registration}))('/api/fiiu/registration',body,'PUT')).registration.id,'registration-a');
 // A first registration also reports the summary email's outcome; the extra fields are accepted as they are.
 const first=await apiFor(Response.json({registration:{...registration,confirmationStatus:'sent',confirmationSentAt:'2026-10-02T15:00:00.000Z'},confirmationEmail:'sent'}))('/api/fiiu/registration',body,'PUT');
 assert.equal(first.confirmationEmail,'sent');assert.equal(first.registration.confirmationStatus,'sent');
 await assert.rejects(apiFor(Response.json({}))('/api/fiiu/registration',body,'DELETE'),error=>error.key==='error');
 assert.equal((await apiFor(Response.json({ok:true}))('/api/fiiu/registration',body,'DELETE')).ok,true);
});

test('an unreadable registration response cannot be mistaken for no saved registration',async()=>{
 for(const data of [{},{user:{id:'a',email:'a@example.test'},attendance:[]},{registration:null,user:{},attendance:[]}]){
  await assert.rejects(apiFor(Response.json(data))('/api/fiiu/registration'),error=>error.key==='error');
 }
 const me={registration:null,user:{id:'a',email:'a@example.test'},attendance:[]};
 assert.equal((await apiFor(Response.json(me))('/api/fiiu/registration')).registration,null);
});

test('saving external interests requires the response to confirm those same interests',async()=>{
 const body={version:0,expectedUserId:'account-a',externalActivities:['workshop-a']};
 const registration={id:'registration-a',userId:'account-a',version:1,answers:{activities:[]}};
 for(const externalActivities of [undefined,{},[],['workshop-b']])await assert.rejects(apiFor(Response.json({registration:{...registration,answers:{activities:[],externalActivities}}}))('/api/fiiu/registration',body,'PUT'),error=>error.key==='error');
 const confirmed={...registration,answers:{activities:[],externalActivities:['workshop-a']}};
 assert.equal((await apiFor(Response.json({registration:confirmed}))('/api/fiiu/registration',body,'PUT')).registration.id,'registration-a');
});

test('check-in refusals keep the server reason, and 410 reads as an expired code',async()=>{
 const refusal=async(status,data)=>{try{await apiFor(Response.json(data,{status}))('/api/fiiu/checkin',{activityId:'day1-am',code:'x'});}catch(error){return error;}assert.fail('the request must fail');};
 const closed=await refusal(409,{code:'outside_window',activityId:'day1-am',closesAt:'2026-10-21T18:30:00.000Z',serverTime:'2026-10-21T18:31:00.000Z'});
 assert.deepEqual([closed.status,closed.code,closed.activityId,closed.closesAt],[409,'outside_window','day1-am','2026-10-21T18:30:00.000Z']);
 const missing=await refusal(404,{code:'not_registered',registrationOpen:false});assert.equal(missing.code,'not_registered');assert.equal(missing.registrationOpen,false);
 const expired=await refusal(410,{code:'expired'});assert.equal(expired.key,'expired');assert.equal(expired.status,410);
 const plain=await refusal(403,{error:'cross-origin request rejected'});assert.equal(plain.code,undefined);assert.equal(plain.key,'forbidden');
});

test('a check-in answer must say what happened, and a registration read accepts the extra hours and method fields',async()=>{
 await assert.rejects(apiFor(Response.json({ok:true}))('/api/fiiu/checkin',{code:'K7M4PX'}),error=>error.key==='error');
 // The organiser test result is gone: an older server answering it reads as a failed check-in, never as a success.
 await assert.rejects(apiFor(Response.json({result:'rehearsal',activityId:'day1-am'}))('/api/fiiu/checkin',{code:'K7M4PX'}),error=>error.key==='error');
 for(const result of ['checked_in','already_checked_in'])assert.equal((await apiFor(Response.json({result,activityId:'day1-am',attendance:[]},{status:result==='checked_in'?201:200}))('/api/fiiu/checkin',{code:'K7M4PX'})).result,result);
 const me={registration:null,user:{id:'a',email:'a@example.test'},attendance:[{activityId:'day1-am',createdAt:'2026-10-21T14:12:00.000Z',method:'qr'}],hours:{minutes:240,hours:4,untimed:[]}};
 assert.equal((await apiFor(Response.json(me))('/api/fiiu/registration')).hours.hours,4);
});
