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
