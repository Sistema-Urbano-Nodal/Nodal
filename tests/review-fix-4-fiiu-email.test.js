import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegistrationConfirmation} from '../server/fiiu-email.js';
import {createMailTransport} from '../server/mailer.js';
import {startFakeSmtp} from './helpers/fake-smtp.js';

const origin='https://nodal.example.org';
const registration={id:'00000000-0000-4000-8000-000000000009',email:'ana@fiiu-inbox.dev',labStatus:'none',
 answers:{firstName:'Ana',lastName:'Quispe',country:'Perú',city:'Lima',profile:'professional',publicOfficial:false,activities:['day1-am'],externalActivities:[]}};
const config={programUrl:'https://canva.link/ficmkatcg9fudwk'};
// Gmail-shaped settings; nothing here opens a connection (the transport connects only when a message is sent).
const gmail={EMAIL_SMTP_URL:'smtps://fiiu%40example.org:app-password@smtp.gmail.com:465',EMAIL_FROM:'FIIU <fiiu@example.org>',PUBLIC_BASE_URL:origin,NODE_ENV:'production'};

// config-deps-2: "Production scope only" for the Gmail credentials was a documentation rule. A Preview deployment
// (unreviewed branch code, possibly on the production database) must never get a live sender.
test('the summary email is off on every Vercel deployment except Production, whatever mail settings it was given',()=>{
 for(const VERCEL_ENV of ['preview','development',undefined,'']){
  const logs=[],env={...gmail,VERCEL:'1',...(VERCEL_ENV===undefined?{}:{VERCEL_ENV})};
  assert.equal(createRegistrationConfirmation({env,log:line=>logs.push(line)}),null,String(VERCEL_ENV));
  assert.deepEqual(logs,['FIIU confirmation email is off outside Vercel Production']);
 }
 assert.equal(typeof createRegistrationConfirmation({env:{...gmail,VERCEL:'1',VERCEL_ENV:'production'},log:()=>{}}),'function','Production keeps its sender');
 assert.equal(typeof createRegistrationConfirmation({env:gmail,log:()=>{}}),'function','a server outside Vercel is unaffected');
 // An injected transport (tests, local tooling) is not an environment decision.
 assert.equal(typeof createRegistrationConfirmation({env:{VERCEL:'1',VERCEL_ENV:'preview'},transport:{send:async()=>{}},origin,log:()=>{}}),'function');
});

// email-qr-scripts-3: the failure line named only the stage, so a wrong port, a DNS typo and a refused connection
// all logged the same line. The transport's error code is an identifier and is now appended.
test('a failed send logs the transport error code when it is a plain identifier, and nothing else from the error',async()=>{
 const logs=[];
 const failing=error=>createRegistrationConfirmation({transport:{send:async()=>{throw error;}},origin,log:line=>logs.push(line)});
 for(const code of ['ENOTFOUND','ECONNREFUSED','ERR_TLS_CERT_ALTNAME_INVALID']){
  assert.deepEqual(await failing(Object.assign(Error('connect failed'),{stage:'connection',delivery:'no',code}))({registration,config,language:'es'}),{status:'failed'});
  assert.equal(logs.at(-1),`FIIU confirmation email failed for registration ${registration.id} at connection [${code}]`);
 }
 assert.deepEqual(await failing(Object.assign(Error('timed out'),{stage:'timeout',delivery:'unknown',code:'ETIMEDOUT'}))({registration,config,language:'es'}),{status:'uncertain'});
 assert.equal(logs.at(-1),`FIIU confirmation email uncertain for registration ${registration.id} at timeout [ETIMEDOUT]`);
 // Anything that is not a plain identifier stays out of the log, as do the message and the address.
 for(const code of ['550 user ana@fiiu-inbox.dev unknown','lowercase',42,'X'.repeat(60)]){
  await failing(Object.assign(Error('ana@fiiu-inbox.dev refused'),{stage:'recipient',status:550,delivery:'no',code}))({registration,config,language:'es'});
  assert.equal(logs.at(-1),`FIIU confirmation email failed for registration ${registration.id} at recipient (SMTP 550)`,String(code));
 }
 assert.ok(logs.every(line=>!line.includes('fiiu-inbox.dev')));
});

test('end to end: implicit TLS against a plaintext SMTP port logs the TLS error code',async t=>{
 const smtp=await startFakeSmtp();t.after(smtp.close);
 const env={EMAIL_SMTP_URL:`smtps://127.0.0.1:${smtp.port}`,EMAIL_FROM:'fiiu@fiiu-inbox.dev',PUBLIC_BASE_URL:'http://localhost:4186'};
 const logs=[],confirm=createRegistrationConfirmation({env,transport:createMailTransport({env,timeoutMs:2000}),log:line=>logs.push(line)});
 assert.deepEqual(await confirm({registration,config,language:'en'}),{status:'failed'});
 assert.equal(smtp.messages.length,0);
 assert.match(logs.at(-1),new RegExp(`^FIIU confirmation email failed for registration ${registration.id} at connection \\[ERR_SSL_[A-Z0-9_]+\\]$`));
});
