import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeRequestNotice,NODE_REQUEST_RECIPIENTS} from '../server/node-requests-email.js';
import {smtpError,createMailTransport,DEFAULT_REPLY_TO} from '../server/mailer.js';
import {startFakeSmtp,parseMessage} from './helpers/fake-smtp.js';

const origin='https://nodal.example.org';
const request={id:'00000000-0000-4000-8000-0000000000a1',name:'Ana Quispe',organization:'Colectivo Ciudad Viva',email:'ana@colectivo-inbox.dev',phone:'+51 999 111 222',
 message:'Queremos un Nodo en Arequipa.\nGracias.',language:'pt',status:'new',emailStatus:null,createdAt:'2026-11-03T15:07:00.000Z'};
const smtpEnv=port=>({EMAIL_SMTP_URL:`smtp://127.0.0.1:${port}`,EMAIL_FROM:'Equipo <equipo@example.org>',PUBLIC_BASE_URL:'http://localhost:4186'});
const stub=(behaviour)=>{const sent=[];return {sent,send:async message=>{sent.push(message);return behaviour(message,sent.length);}};};

test('is off outside Vercel Production and without mail settings',()=>{
 const logs=[],log=line=>logs.push(line);
 assert.equal(createNodeRequestNotice({env:{VERCEL:'1',VERCEL_ENV:'preview',EMAIL_SMTP_URL:'smtps://u:p@smtp.example.org',EMAIL_FROM:'a@example.org',PUBLIC_BASE_URL:origin},log}),null);
 assert.deepEqual(logs,['Node request email is off outside Vercel Production']);
 assert.equal(createNodeRequestNotice({env:{},log}),null);
 assert.equal(typeof createNodeRequestNotice({transport:stub(()=>({})),origin,log}),'function');
 assert.deepEqual([...NODE_REQUEST_RECIPIENTS],['fmuro@sistemaurbano.org','malegre@sistemaurbano.org']);assert.ok(Object.isFrozen(NODE_REQUEST_RECIPIENTS));
});

test('sends one message to each team address with the organisation as Reply-To and NODAL as sender',async t=>{
 const smtp=await startFakeSmtp();t.after(smtp.close);
 const notify=createNodeRequestNotice({env:smtpEnv(smtp.port),loopbackOnly:true,log:()=>{}});
 assert.equal(await notify({request}),'sent');
 assert.equal(smtp.messages.length,2);
 const messages=smtp.messages.map(m=>parseMessage(m.data));
 assert.deepEqual(messages.map(m=>m.headers.to).sort(),[...NODE_REQUEST_RECIPIENTS].sort());
 for(const message of messages){
  assert.equal(message.headers['reply-to'],'"Ana Quispe" <ana@colectivo-inbox.dev>');
  assert.match(message.headers.from,/^"NODAL" <equipo@example\.org>$/);
  assert.equal(message.subject,'Solicitud de Nodo: Colectivo Ciudad Viva');
  for(const body of [message.text,message.html]){
   for(const part of ['Colectivo Ciudad Viva','ana@colectivo-inbox.dev','+51 999 111 222','Português','2026-11-03 10:07','http://localhost:4186/admin.html#nodes'])assert.ok(body.includes(part),part);
  }
  assert.ok(message.text.includes('Queremos un Nodo en Arequipa.\nGracias.')||message.text.includes('Queremos un Nodo en Arequipa.\r\nGracias.'));
  // The organisation wants to talk about a node, not to join NODAL.
  assert.match(message.text,/^Una organización quiere conversar sobre un Nodo\.\r?\n/);
  assert.ok(message.html.includes('<p>Una organización quiere conversar sobre un Nodo.</p>'));
  for(const body of [message.text,message.html])assert.doesNotMatch(body,/pidió ser parte/);
 }
});

// The API refuses such an address, but the notice must not lean on that: left out, the mailer's own Reply-To (the
// FIIU inbox by default) would take the team's replies. Through the real transport, so the header itself is checked.
test('says "no indicado" without a phone and writes no Reply-To at all for an address the mailer rejects',async t=>{
 const smtp=await startFakeSmtp();t.after(smtp.close);
 for(const [env,fallback] of [[{...smtpEnv(smtp.port),EMAIL_REPLY_TO:'Equipo FIIU <fiiu-team@example.org>'},'fiiu-team@example.org'],[smtpEnv(smtp.port),DEFAULT_REPLY_TO]]){
  assert.equal(createMailTransport({env}).replyTo.address,fallback,'the configured default the notice must not fall back to');
  const notify=createNodeRequestNotice({env,loopbackOnly:true,log:()=>{}});smtp.messages.length=0;
  for(const email of ['ana@colectivo.pe;','josé@muni.pe','not an address'])assert.equal(await notify({request:{...request,phone:null,email}}),'sent',email);
  assert.equal(smtp.messages.length,6);
  for(const raw of smtp.messages){
   const message=parseMessage(raw.data);
   assert.equal(message.headers['reply-to'],undefined,'no Reply-To header');assert.ok(!raw.data.includes(fallback),fallback);
   assert.match(message.text,/Teléfono: no indicado/);assert.match(message.headers.from,/^"NODAL" </);
  }
  assert.deepEqual(smtp.messages.slice(0,2).map(m=>m.to[0]).sort(),[...NODE_REQUEST_RECIPIENTS].sort());
 }
 const transport=stub(()=>({}));await createNodeRequestNotice({transport,origin,log:()=>{}})({request:{...request,email:'not an address'}});
 assert.ok(transport.sent.every(m=>m.replyTo===null),'replyTo is null, not left out, so the transport cannot fill in its default');
});

test('reports partial, uncertain and failed outcomes',async()=>{
 const refuse=delivery=>smtpError('x',{stage:delivery==='no'?'recipient':'message',status:delivery==='no'?550:250,delivery});
 const outcome=async(behaviour)=>{const logs=[];const notify=createNodeRequestNotice({transport:stub(behaviour),origin,log:line=>logs.push(line)});return {result:await notify({request}),logs};};
 assert.deepEqual((await outcome(()=>({}))).logs,[]);
 const partial=await outcome((m,n)=>{if(n===2)throw refuse('no');return {};});
 assert.equal(partial.result,'partial');assert.equal(partial.logs.length,1);
 const uncertain=await outcome((m,n)=>{throw refuse(n===1?'no':'unknown');});
 assert.equal(uncertain.result,'uncertain');assert.equal(uncertain.logs.length,1);
 const failed=await outcome(()=>{throw refuse('no');});
 assert.equal(failed.result,'failed');assert.equal(failed.logs.length,1);
 assert.equal((await outcome(()=>{throw new Error('boom');})).result,'uncertain');
});

test('sends both messages in parallel, so two slow sends cost one timeout',async()=>{
 let started=0,release;const gate=new Promise(resolve=>{release=resolve;});
 const transport={send:async()=>{started++;await gate;return {};}};
 const pending=createNodeRequestNotice({transport,origin,log:()=>{}})({request});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(started,2);release();assert.equal(await pending,'sent');
});

test('keeps a CR/LF or emoji organisation name to one subject line and escapes html',async t=>{
 const smtp=await startFakeSmtp();t.after(smtp.close);
 const notify=createNodeRequestNotice({env:smtpEnv(smtp.port),loopbackOnly:true,log:()=>{}});
 const organization='Ciudad 🌳\r\nBcc: evil@example.org <script>alert(1)</script>';
 assert.equal(await notify({request:{...request,organization,name:'Ana\r\nBcc: x@example.org',message:'<script>alert(2)</script>'}}),'sent');
 const [first]=smtp.messages;const message=parseMessage(first.data);
 assert.ok(!/\r\nBcc:/i.test(first.data.split('\r\n\r\n')[0]));
 assert.ok(!/[\r\n]/.test(message.subject));assert.ok(message.subject.startsWith('Solicitud de Nodo: Ciudad 🌳'));
 assert.ok(message.html.includes('&lt;script&gt;alert(2)&lt;/script&gt;'));assert.ok(!message.html.includes('<script>'));
 assert.ok(message.text.includes('<script>alert(2)</script>'));
});

test('never logs an address, name or message',async()=>{
 const logs=[];
 const err=Object.assign(smtpError('refused ana@colectivo-inbox.dev',{stage:'recipient',status:550}),{code:'EREFUSED'});
 const notify=createNodeRequestNotice({transport:stub(()=>{throw err;}),origin,log:line=>logs.push(line)});
 assert.equal(await notify({request}),'failed');
 assert.equal(logs.length,1);assert.match(logs[0],new RegExp(request.id));assert.match(logs[0],/at recipient \(SMTP 550\)/);
 for(const secret of ['ana@','colectivo','Quispe','Ciudad Viva','Arequipa','sistemaurbano'])assert.ok(!logs[0].includes(secret),secret);
});

test('carries every validated field in full, past the 100 characters a first name is cut to',async()=>{
 const long={...request,name:'N'.repeat(120),organization:'O'.repeat(160),email:`${'a'.repeat(60)}@${'b'.repeat(58)}.org`};
 const transport=stub(()=>({}));
 assert.equal(await createNodeRequestNotice({transport,origin,log:()=>{}})({request:long}),'sent');
 for(const message of transport.sent){
  assert.equal(message.subject,`Solicitud de Nodo: ${long.organization}`);
  for(const body of [message.text,message.html]){
   assert.ok(body.includes(`Nombre: ${long.name}`)||body.includes(`>${long.name}<`),'name');
   assert.ok(body.includes(long.organization),'organization');assert.ok(body.includes(long.email),'email');
  }
  assert.equal(message.replyTo.name,long.name);assert.equal(message.replyTo.address,long.email);
 }
});
