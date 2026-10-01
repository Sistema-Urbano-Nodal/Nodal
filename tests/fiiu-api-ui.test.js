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
 for(const [status,key] of [[401,'unauthorized'],[403,'forbidden'],[409,'conflict'],[429,'rate'],[503,'error']]){
  const api=apiFor(new Response('<html>hosting error</html>',{status}));
  await assert.rejects(api('/api/fiiu/registration'),error=>error.status===status&&error.key===key);
 }
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
 const window=await refusal(409,{code:'outside_window',activityId:'day1-am',opensAt:'2026-10-21T13:30:00.000Z',closesAt:'2026-10-21T18:30:00.000Z'});
 assert.deepEqual([window.status,window.code,window.activityId,window.opensAt,window.closesAt],[409,'outside_window','day1-am','2026-10-21T13:30:00.000Z','2026-10-21T18:30:00.000Z']);
 const missing=await refusal(404,{code:'not_registered',registrationOpen:false});assert.equal(missing.code,'not_registered');assert.equal(missing.registrationOpen,false);
 const expired=await refusal(410,{code:'expired'});assert.equal(expired.key,'expired');assert.equal(expired.status,410);
 const plain=await refusal(403,{error:'cross-origin request rejected'});assert.equal(plain.code,undefined);assert.equal(plain.key,'forbidden');
});

test('a check-in answer must say what happened, and a registration read accepts the extra hours and method fields',async()=>{
 await assert.rejects(apiFor(Response.json({ok:true}))('/api/fiiu/checkin',{code:'K7M4PX'}),error=>error.key==='error');
 for(const result of ['checked_in','already_checked_in'])assert.equal((await apiFor(Response.json({result,activityId:'day1-am',attendance:[]},{status:result==='checked_in'?201:200}))('/api/fiiu/checkin',{code:'K7M4PX'})).result,result);
 const me={registration:null,user:{id:'a',email:'a@example.test'},attendance:[{activityId:'day1-am',createdAt:'2026-10-21T14:12:00.000Z',method:'qr'}],hours:{minutes:240,hours:4,untimed:[]}};
 assert.equal((await apiFor(Response.json(me))('/api/fiiu/registration')).hours.hours,4);
});
