import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../server/server.js';

async function fixture(t,{fail=false}={}){
 const calls=[];
 const repository={resolveSession:async()=>({user:null,cookies:[]}),signup:async body=>{calls.push({action:'signup',...body});return fail?{status:409,error:'account unavailable'}:{status:202,requiresEmailConfirmation:true,cookies:[]};},login:async body=>{calls.push({action:'login',...body});return fail?{status:401,error:'invalid email or password'}:{status:200,user:{id:'verified-member'},cookies:[]};},requestPasswordRecovery:async()=>({status:202,cookies:[]})};
 const server=createApp({repository});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(action,email,headers={},patch={})=>{
  const response=await fetch(base+'/api/auth/'+action,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...headers},body:JSON.stringify({email,password:'valid-password',fullName:'Class participant',...patch})});
  await response.arrayBuffer();return response;
 };
 return{calls,call,base};
}

// Sign-ups stop at 200 an hour per instance (SIGNUP_EMAIL_HOURLY_LIMIT): each can send a confirmation email,
// and the project's 300-an-hour email quota also carries recovery links and invitations.
test('one classroom IP supports 200 signups, 300 sign-ins and retry headroom before its 801st request is blocked',async t=>{
 const {call,calls}=await fixture(t);
 for(let i=0;i<200;i++){
  assert.equal((await call('signup',`student-${i}@example.test`)).status,202,`signup ${i}`);
  assert.equal((await call('login',`student-${i}@example.test`)).status,200,`login ${i}`);
 }
 // Classmates who registered before class sign in too.
 for(let i=0;i<100;i++)assert.equal((await call('login',`registered-${i}@example.test`)).status,200,`registered ${i}`);
 // One extra attempt for 300 of those accounts fits both classroom and account budgets.
 for(let i=0;i<300;i++)assert.equal((await call('login',i<200?`student-${i}@example.test`:`registered-${i-200}@example.test`)).status,200,`retry ${i}`);
 assert.equal(calls.length,800);
 const limited=await call('login','new-person@example.test');assert.equal(limited.status,429);assert.match(limited.headers.get('retry-after'),/^\d+$/);assert.equal(calls.length,800);
});

test('failed attempts share a normalized email budget across IPs and preserve separate signup/login limits',async t=>{
 const old=process.env.TRUST_PROXY;process.env.TRUST_PROXY='true';t.after(()=>{if(old===undefined)delete process.env.TRUST_PROXY;else process.env.TRUST_PROXY=old;});
 const {call,calls}=await fixture(t,{fail:true});
 // Sign-up: every attempt for one address counts, from any IP, since each can email that inbox.
 for(let i=0;i<10;i++)assert.equal((await call('signup',i%2?' CLASS@EXAMPLE.TEST ':'class@example.test',{'X-Real-IP':`203.0.113.${i}`})).status,409);
 assert.equal((await call('signup','Class@Example.Test',{'X-Real-IP':'203.0.113.99'})).status,429);
 // Sign-in: wrong passwords count per requester, so a stranger's guesses never lock the owner out,
 // and across all requesters up to a looser shared ceiling (AUTH_ACCOUNT_RATE_LIMIT, 50).
 for(let i=0;i<10;i++)assert.equal((await call('login',i%2?' CLASS@EXAMPLE.TEST ':'class@example.test',{'X-Real-IP':'198.51.100.7'})).status,401);
 assert.equal((await call('login','Class@Example.Test',{'X-Real-IP':'198.51.100.7'})).status,429);
 for(let i=0;i<40;i++)assert.equal((await call('login','class@example.test',{'X-Real-IP':`203.0.113.${i}`})).status,401);
 assert.equal((await call('login','Class@Example.Test',{'X-Real-IP':'203.0.113.99'})).status,429);
 assert.equal(calls.length,60);assert.ok(calls.every(call=>call.email==='class@example.test'));
});

test('malformed submissions spend IP budget but do not lock a valid account or reach the repository',async t=>{
 const {call,calls}=await fixture(t);
 for(let i=0;i<12;i++)assert.equal((await call('signup','member@example.test',{}, {password:'short'})).status,400);
 assert.equal(calls.length,0);assert.equal((await call('signup','member@example.test')).status,202);
 for(let i=0;i<787;i++)assert.equal((await call('login','not-an-email')).status,401);
 assert.equal((await call('login','fresh@example.test')).status,429);assert.equal(calls.length,1);
});

test('untrusted forwarded headers cannot rotate the shared IP ceiling',async t=>{
 // Off Vercel (whose proxy is trusted by default): the build runs these tests with VERCEL=1 set.
 const old=process.env.TRUST_PROXY,oldVercel=process.env.VERCEL;delete process.env.TRUST_PROXY;delete process.env.VERCEL;t.after(()=>{if(old!==undefined)process.env.TRUST_PROXY=old;if(oldVercel!==undefined)process.env.VERCEL=oldVercel;});
 const {call,calls}=await fixture(t);
 for(let i=0;i<800;i++)assert.equal((await call('login',`person-${i}@example.test`,{'X-Real-IP':`192.0.2.${i}`,'X-Forwarded-For':`192.0.2.${i}`})).status,200);
 assert.equal((await call('login','extra@example.test',{'X-Real-IP':'198.51.100.100','X-Forwarded-For':'198.51.100.100'})).status,429);assert.equal(calls.length,800);
});

test('trusted proxy uses the observed final hop while recovery retains its strict IP budget',async t=>{
 const old=process.env.TRUST_PROXY;process.env.TRUST_PROXY='true';t.after(()=>{if(old===undefined)delete process.env.TRUST_PROXY;else process.env.TRUST_PROXY=old;});
 const {call}=await fixture(t);
 for(let i=0;i<800;i++)assert.equal((await call('login',`class-${i}@example.test`,{'X-Forwarded-For':`192.0.2.${i}, 203.0.113.7`})).status,200);
 assert.equal((await call('login','extra@example.test',{'X-Forwarded-For':'198.51.100.99, 203.0.113.7'})).status,429);
 for(let i=0;i<10;i++)assert.equal((await call('recovery/request',`recovery-${i}@example.test`,{'X-Forwarded-For':`192.0.2.${i}, 203.0.113.7`})).status,202);
 assert.equal((await call('recovery/request','more@example.test',{'X-Forwarded-For':'198.51.100.99, 203.0.113.7'})).status,429);
});
