import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FIIU_EVENT} from '../server/fiiu-domain.js';
import {registrationEmail,createRegistrationConfirmation,isReservedRecipient,EMAIL_ROWS,emailOrigin,safeName} from '../server/fiiu-email.js';
import {startFakeSmtp,parseMessage} from './helpers/fake-smtp.js';
import {createDatabase,createUser} from '../server/db.js';
import {createFiiuStore} from '../server/fiiu-repository.js';
import {sendConfirmations,SAMPLE_REGISTRATION,parseCliArgs} from '../scripts/send-fiiu-confirmations.js';

const origin='https://nodal.example.org';
// Recipients that should be emailed use a placeholder outside the reserved domains (example.com and the like are never
// emailed). Tests only ever deliver to a stub, an outbox or a loopback SMTP server.
const answers={firstName:'Ana',lastName:'Quispe',country:'Perú',city:'Lima',profile:'public_official',publicOfficial:true,applyLab:false,
 activities:['day2-am','day1-pm','day1-am'],externalActivities:['route-arcoiris','workshop-bosques-urbanos'],
 nationalId:'TEST-ID-4471',gender:'prefer_not',age:47,accessibility:['other'],accessibilityOther:'Rampa-secreta-9',motivation:'other',motivationOther:'Motivo-privado-3',previousAttendance:'no',institution:'Muni-Privada-5',position:'Cargo-Privado-6',privacyAccepted:true};
const registration={id:'00000000-0000-4000-8000-000000000009',email:'ana@fiiu-inbox.dev',labStatus:'none',answers};
const config={programUrl:'https://canva.link/ficmkatcg9fudwk'};
const render=(overrides={},language='es',options={})=>registrationEmail({registration:{...registration,...overrides,answers:{...answers,...overrides.answers}},config,language,origin,...options});
const preheader=html=>/<div style="display:none;[^"]*">([^<]*)<\/div>/.exec(html)?.[1];
const visible=html=>html.replace(/<[^>]+>/g,' ').replace(/&rarr;/g,'→').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ');

test('every email string exists in English, Spanish and Portuguese',()=>{
 for(const [key,values] of Object.entries(EMAIL_ROWS))assert.ok(values.length===3&&values.every(value=>typeof value==='string'&&value.trim()),key);
});

test('the subject and wording follow the registration language, with Spanish for anything unknown',()=>{
 assert.equal(render({},'en').subject,'Your FIIU Fest 11 registration');
 assert.equal(render({},'es').subject,'Tu inscripción en FIIU Fest 11');
 assert.equal(render({},'pt').subject,'Sua inscrição no FIIU Fest 11');
 assert.equal(render({},'fr').subject,'Tu inscripción en FIIU Fest 11');assert.equal(render({},undefined).subject,'Tu inscripción en FIIU Fest 11');
 assert.match(render({},'en').text,/^Hi Ana,\n/);assert.match(render({},'es').text,/^Hola, Ana:\n/);assert.match(render({},'pt').text,/^Olá, Ana,\n/);
 assert.match(render({},'en').html,/<html lang="en">/);assert.match(render({},'pt').html,/<html lang="pt">/);
 // Titles stay in Spanish; outside a Spanish email they are marked as such for screen readers and translators.
 assert.match(render({},'en').html,/<span lang="es">El poder de lo local<\/span>/);assert.doesNotMatch(render({},'es').html,/<span lang="es">/);
});

test('conference blocks are listed by Lima date and time with their Spanish title and venue, in programme order',()=>{
 const {text,html}=render({},'es');
 const order=['Miércoles, 21 de octubre','09:00–13:00 · Bloque de conferencias','El poder de lo local','Auditorio MALI, Cercado de Lima',
  '19:00–21:00 · Bloque de conferencias','Intervenir para activar','Auditorio Taulichusco, Museo Metropolitano de Lima',
  'Jueves, 22 de octubre','Cuidar y transformar la ciudad','Auditorio NOS PUCP','Domingo, 25 de octubre','Arcoíris sobre ruedas'];
 // Each part is found after the previous one, from the first day heading on.
 for(const body of [text,visible(html)]){let at=0;for(const part of order){const next=body.indexOf(part,at);assert.ok(next>=at,`${part} after position ${at}`);at=next+part.length;}}
 assert.match(render({},'en').text,/Wednesday 21 October/);assert.match(render({},'pt').text,/Quarta-feira, 21 de outubro/);
 // A block whose venue is not confirmed says so instead of leaving a blank.
 const event={...FIIU_EVENT,activities:FIIU_EVENT.activities.map(a=>a.id==='day1-pm'?{...a,venue:''}:a)};
 for(const [language,phrase] of [['en','Venue to be confirmed'],['es','Lugar por confirmar'],['pt','Local a confirmar']]){
  const email=render({},language,{event});assert.match(email.text,new RegExp(`Intervenir para activar[^\\n]*\\n  ${phrase}`));assert.ok(visible(email.html).includes(phrase));
 }
});

test('the laboratory appears only for an application, with its review status',()=>{
 assert.doesNotMatch(render().text,/Gestión urbana en acción/);
 const pending=render({labStatus:'pending',answers:{applyLab:true}},'en');
 assert.match(pending.text,/Tuesday 20 October\n- Laboratory for public officials\n  Gestión urbana en acción[^\n]*\n  Application under review/);
 assert.ok(pending.text.indexOf('Tuesday 20 October')<pending.text.indexOf('Wednesday 21 October'),'the 20 October laboratory comes first');
 assert.match(render({labStatus:'accepted',answers:{applyLab:true}},'es').text,/Postulación aceptada/);
 assert.match(render({labStatus:'declined',answers:{applyLab:true}},'pt').text,/não foi selecionada/);
});

test('each workshop and route carries its own Google Form and the reminder that only the form confirms the place',()=>{
 for(const language of ['en','es','pt']){
  const {text,html}=render({},language),reminder=EMAIL_ROWS.formReminder[['en','es','pt'].indexOf(language)];
  assert.ok(text.includes(reminder)&&visible(html).includes(reminder),language);
  for(const id of ['workshop-bosques-urbanos','route-arcoiris']){const {formUrl}=FIIU_EVENT.activities.find(a=>a.id===id);assert.ok(text.includes(formUrl)&&html.includes(`href="${formUrl}"`),id);}
 }
 assert.match(render({},'en').text,/Urban route · interest\n  Arcoíris[^\n]*\n  Starting point: Parque Kennedy, Miraflores\n  Complete the Google Form: https:\/\/forms\.gle\/Z36Ds9eAjhoiFAbp7/);
 assert.match(render({},'es').text,/Taller · interés\n  Bosques urbanos[^\n]*\n  MALI, Cercado de Lima\n  Completar el Google Form: https:\/\/forms\.gle\/797LUygbLnP4uYvH6/);
 // Without workshops or routes there is no form of theirs to complete: no next-step box and no form link, but one general
 // line says that workshops and routes are booked through their own Google Form, with a link to the NODAL programme.
 for(const [language,answersOnly] of [['en',{externalActivities:[]}],['es',{externalActivities:[]}],['pt',{externalActivities:[]}],['es',{activities:[],externalActivities:[],applyLab:true}]]){
  const i=['en','es','pt'].indexOf(language),{text,html}=render({labStatus:answersOnly.applyLab?'pending':'none',answers:answersOnly},language);
  assert.doesNotMatch(text+html,/forms\.gle/);assert.ok(!text.includes(EMAIL_ROWS.formTitle[i].toUpperCase())&&!visible(html).includes(EMAIL_ROWS.formTitle[i]),language);
  assert.ok(text.includes(`${EMAIL_ROWS.formGeneral[i]}\n${EMAIL_ROWS.formGeneralLink[i]}: ${origin}/fiiu.html#programme\n`),language);
  assert.ok(visible(html).includes(EMAIL_ROWS.formGeneral[i])&&html.includes(`href="${origin}/fiiu.html#programme"`),language);
  assert.ok(text.indexOf(EMAIL_ROWS.formGeneral[i])<text.indexOf(EMAIL_ROWS.calendarTitle[i].toUpperCase()),'before the calendar');
 }
 // With a workshop or route, the personal reminder replaces the general line.
 for(const language of ['en','es','pt'])assert.ok(!render({},language).text.includes(EMAIL_ROWS.formGeneral[['en','es','pt'].indexOf(language)]),language);
 // Unknown ids and the legacy day-level workshop entries are skipped.
 const legacy=render({answers:{activities:[],externalActivities:['workshop-day1','not-an-activity','route-lima-cromatica']}},'en');
 assert.doesNotMatch(legacy.text,/workshop-day1|not-an-activity|Talleres\n/);assert.match(legacy.text,/Lima cromática/);
});

test('the festival calendar, the registration page and the live programme are linked in both parts',()=>{
 const {text,html}=render({},'es');
 assert.equal(FIIU_EVENT.calendarUrl,'https://calendar.google.com/calendar/u/0/r?cid=c_8f3c079893ebe9931c811d0153dd6877443cfea5087724e9d57d3f0b2a2d6d85%40group.calendar.google.com');
 for(const url of [FIIU_EVENT.calendarUrl,`${origin}/fiiu.html#registration`,config.programUrl,`${origin}/privacy.html`]){assert.ok(text.includes(url),url);assert.ok(html.includes(`href="${url}"`),url);}
 assert.match(text,/El programa puede cambiar: el programa en vivo es la referencia/);
 assert.ok(html.includes('mailto:fiiu@ocupatucalle.com'));
 const noCalendar=render({},'en',{event:{...FIIU_EVENT,calendarUrl:''}});assert.doesNotMatch(noCalendar.text,/calendar\.google|Festival calendar/);
 // Without an HTTPS programme link the live programme is the NODAL page itself.
 const local=registrationEmail({registration,config:{programUrl:'javascript:alert(1)'},language:'en',origin});
 assert.ok(local.text.includes(`${origin}/fiiu.html#programme`));assert.doesNotMatch(local.html,/javascript:/);
});

test('private answers never appear, and the name is escaped and stripped of line breaks',()=>{
 for(const language of ['en','es','pt']){const {subject,text,html}=render({labStatus:'pending',answers:{applyLab:true}},language);
  for(const secret of ['TEST-ID-4471','Rampa-secreta-9','Motivo-privado-3','Muni-Privada-5','Cargo-Privado-6','prefer_not','47','Quispe'])assert.ok(!`${subject}${text}${html}`.includes(secret),`${language}: ${secret}`);}
 const hostile=render({answers:{firstName:'<img src=x onerror=alert(1)>\r\nBcc: x@example.org "Ana"'}},'en');
 assert.doesNotMatch(hostile.html,/<img|onerror=alert\(1\)>/);assert.match(hostile.html,/Hi &lt;img src=x onerror=alert\(1\)&gt; Bcc: x@example\.org &quot;Ana&quot;,/);
 assert.match(hostile.text,/^Hi <img src=x onerror=alert\(1\)> Bcc: x@example\.org "Ana",\n/);assert.equal(hostile.subject,'Your FIIU Fest 11 registration');
 assert.equal(safeName('  Ana\u0000​ María\n'),'Ana María');assert.equal(safeName('x'.repeat(300)).length,100);
 assert.match(render({answers:{firstName:''}},'es').text,/^Hola:\n/);
});

test('the inbox preview line mentions Google Forms only when the email lists one to complete',()=>{
 for(const [i,language] of ['en','es','pt'].entries()){
  assert.equal(preheader(render({},language).html),EMAIL_ROWS.preheader[i],language);
  assert.equal(preheader(render({answers:{externalActivities:[]}},language).html),EMAIL_ROWS.preheaderNoForms[i],language);
  assert.equal(preheader(render({labStatus:'pending',answers:{applyLab:true,activities:[],externalActivities:[]}},language).html),EMAIL_ROWS.preheaderNoForms[i],language);
  assert.doesNotMatch(EMAIL_ROWS.preheaderNoForms[i],/Google Form/);
 }
});

test('a first name with $ patterns is shown exactly as typed',()=>{
 for(const name of ["$'",'$`','$&','$$','$1','Ana $& María']){
  const {text,html}=render({answers:{firstName:name}},'en');
  assert.ok(text.startsWith(`Hi ${name},\n`),name);assert.ok(visible(html).includes(`Hi ${name},`),name);
 }
});

test('email links use only the configured public origin',()=>{
 assert.equal(emailOrigin({PUBLIC_BASE_URL:'https://nodal.example.org/path?x=1'}),'https://nodal.example.org');
 assert.equal(emailOrigin({NEXT_PUBLIC_APP_URL:'https://app.example.org'}),'https://app.example.org');
 assert.equal(emailOrigin({PUBLIC_BASE_URL:'http://localhost:4186'}),'http://localhost:4186');
 for(const env of [{},{VERCEL_URL:'nodal-abc.vercel.app'},{PUBLIC_BASE_URL:'http://nodal.example.org'},{PUBLIC_BASE_URL:'http://localhost:4186',NODE_ENV:'production'},{PUBLIC_BASE_URL:'https://u:p@nodal.example.org'}])assert.equal(emailOrigin(env),null,JSON.stringify(env));
});

test('reserved test and example domains are recognised, the example.com, .net and .org second-level domains included',()=>{
 for(const email of ['a@example.test','a@x.example','a@b.invalid','a@localhost','a@mail.localhost','A@EXAMPLE.TEST.','a@example.com','a@example.net','a@example.org','a@sub.example.com','A@Mail.Example.ORG.'])assert.equal(isReservedRecipient(email),true,email);
 for(const email of ['a@testing.org','a@sistemaurbano.org','a@test.com','a@notexample.com','a@example.com.pe','a@example.co','a@fiiu-inbox.dev'])assert.equal(isReservedRecipient(email),false,email);
});

test('the sender maps every outcome to a status, never throws, and logs no address',async()=>{
 const logs=[],log=line=>logs.push(line),sent=[];
 const transport=outcome=>({loopback:false,async send(message){sent.push(message);if(outcome instanceof Error)throw outcome;return {response:250};}});
 const confirm=transport=>createRegistrationConfirmation({transport,origin,log});
 const args={registration,config,language:'pt'};
 const ok=await confirm(transport())(args);assert.equal(ok.status,'sent');assert.ok(Date.parse(ok.sentAt));
 assert.deepEqual([sent[0].to,sent[0].subject,sent[0].language],['ana@fiiu-inbox.dev','Sua inscrição no FIIU Fest 11','pt']);
 const smtp=(delivery,status)=>Object.assign(Error('SMTP refused'),{name:'SmtpError',delivery,status,stage:'recipient'});
 assert.deepEqual(await confirm(transport(smtp('no',550)))(args),{status:'failed'});
 assert.deepEqual(await confirm(transport(smtp('no',421)))(args),{status:'failed'},'a temporary refusal still means not delivered');
 assert.deepEqual(await confirm(transport(smtp('unknown')))(args),{status:'uncertain'});
 assert.deepEqual(await confirm(transport(Error('socket hang up')))(args),{status:'uncertain'},'an unknown failure cannot rule out delivery');
 const before=sent.length;for(const email of ['ana@example.test','owner@example.org','ana@example.com'])assert.deepEqual(await confirm(transport())({...args,registration:{...registration,email}}),{status:'skipped'},email);assert.equal(sent.length,before);
 assert.ok(logs.length>=3&&logs.every(line=>!/@|Ana/.test(line)),logs.join('\n'));assert.match(logs[0],/failed for registration 00000000-0000-4000-8000-000000000009 at recipient \(SMTP 550\)/);
});

test('the sender is off without configuration, without a public origin, or on a local server pointed at a real provider',()=>{
 const logs=[],log=line=>logs.push(line);
 assert.equal(createRegistrationConfirmation({env:{},log}),null);assert.deepEqual(logs,[]);
 assert.equal(createRegistrationConfirmation({env:{EMAIL_SMTP_URL:'smtps://u:p@smtp.example.org',EMAIL_FROM:'a@example.org'},log}),null,'no public origin');
 assert.equal(createRegistrationConfirmation({env:{EMAIL_SMTP_URL:'smtps://u:p@smtp.example.org',EMAIL_FROM:'a@example.org',PUBLIC_BASE_URL:origin},loopbackOnly:true,log}),null);
 assert.equal(createRegistrationConfirmation({env:{EMAIL_SMTP_URL:'smtp://u:secret@smtp.example.org',EMAIL_FROM:'a@example.org',PUBLIC_BASE_URL:origin},log}),null,'a malformed URL turns email off');
 assert.equal(typeof createRegistrationConfirmation({env:{EMAIL_SMTP_URL:'smtps://u:p@smtp.example.org',EMAIL_FROM:'a@example.org',PUBLIC_BASE_URL:origin},log}),'function');
 assert.equal(typeof createRegistrationConfirmation({env:{EMAIL_SMTP_URL:'smtp://127.0.0.1:2525',EMAIL_FROM:'a@example.org',PUBLIC_BASE_URL:'http://localhost:4186'},loopbackOnly:true,log}),'function');
 assert.equal(logs.length,3);assert.ok(logs.every(line=>/is off/.test(line)&&!/secret|u:p/.test(line)),logs.join('\n'));
});

test('end to end: the summary reaches a local SMTP server as a two-part UTF-8 message',async t=>{
 const smtp=await startFakeSmtp();t.after(smtp.close);
 const confirm=createRegistrationConfirmation({env:{EMAIL_SMTP_URL:`smtp://127.0.0.1:${smtp.port}`,EMAIL_FROM:'FIIU Fest 11 <fiiu@example.org>',PUBLIC_BASE_URL:'http://localhost:4186'},loopbackOnly:true,log:()=>{}});
 assert.equal((await confirm({registration,config,language:'es'})).status,'sent');
 const message=parseMessage(smtp.messages[0].data);
 assert.equal(message.subject,'Tu inscripción en FIIU Fest 11');assert.equal(message.headers.to,'ana@fiiu-inbox.dev');assert.equal(message.headers['reply-to'],'fiiu@ocupatucalle.com');
 assert.equal(message.text,render({},'es').text.replace(/\n/g,'\r\n').replace(origin,'http://localhost:4186').replace(`${origin}/privacy.html`,'http://localhost:4186/privacy.html'));
 assert.match(message.html,/http:\/\/localhost:4186\/fiiu\.html#registration/);
});

test('end to end: a garbled reply after the whole message was sent is uncertain, never a failure a retry would repeat',async t=>{
 const env=port=>({EMAIL_SMTP_URL:`smtp://127.0.0.1:${port}`,EMAIL_FROM:'fiiu@example.org',PUBLIC_BASE_URL:'http://localhost:4186'}),logs=[];
 for(const message of ['OK: queued as 123','250 '+'x'.repeat(70*1024)]){
  const smtp=await startFakeSmtp({reply:{message}});t.after(smtp.close);
  const confirm=createRegistrationConfirmation({env:env(smtp.port),loopbackOnly:true,log:line=>logs.push(line)});
  assert.deepEqual(await confirm({registration,config,language:'es'}),{status:'uncertain'},message.slice(0,20));
 }
 assert.ok(logs.every(line=>/uncertain for registration .* at reply/.test(line)),logs.join('\n'));
});

test('the optional backfill lists by default, then emails each waiting registration once with the same compare-and-set',async t=>{
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());const store=createFiiuStore({db});
 const rows=[['r1','old@fiiu-inbox.dev','none',null],['r2','tester@example.test','none','en'],['r3','retry@fiiu-inbox.dev','failed','pt'],['r4','done@fiiu-inbox.dev','sent','es'],['r5','maybe@fiiu-inbox.dev','uncertain','es']];
 for(const [id,email,confirmationStatus,confirmationLanguage] of rows){const user=createUser(db,{fullName:id,email,passwordHash:'unused'});
  await store.insert('registrations',{id,eventId:'fiiu-2026',userId:user.id,email,answers,labStatus:'none',version:1,createdAt:'2026-09-30T00:00:00Z',updatedAt:'2026-09-30T00:00:00Z',confirmationStatus,confirmationLanguage,confirmationSentAt:null});}
 const statusOf=id=>db.prepare('SELECT confirmation_status s FROM fiiu_registrations WHERE id=?').get(id).s;
 const lines=[],sent=[];
 const confirm=async({registration,language})=>{sent.push([registration.id,language]);assert.equal(statusOf(registration.id),'pending','claimed before sending');return isReservedRecipient(registration.email)?{status:'skipped'}:{status:'sent',sentAt:'2026-10-02T15:00:00.000Z'};};
 const dry=await sendConfirmations({store,log:line=>lines.push(line)});
 assert.equal(dry.listed,2);assert.equal(sent.length,0);assert.deepEqual(rows.map(([id])=>statusOf(id)),['none','none','failed','sent','uncertain'],'a dry run writes nothing');
 assert.ok(lines.every(line=>!/old@|tester@/.test(line)),'addresses are masked');assert.match(lines.join('\n'),/o\*\*\*@fiiu-inbox\.dev/);assert.match(lines.join('\n'),/test address/);
 await assert.rejects(sendConfirmations({store,send:true}),/not configured/);
 const first=await sendConfirmations({store,confirm,send:true,delayMs:0,log:()=>{}});
 assert.deepEqual([first.sent,first.skipped],[1,1]);assert.deepEqual(sent,[['r1','es'],['r2','en']],'the stored language, else Spanish');
 assert.deepEqual(rows.map(([id])=>statusOf(id)),['sent','skipped','failed','sent','uncertain']);
 assert.equal((await sendConfirmations({store,confirm,send:true,delayMs:0,log:()=>{}})).listed,0,'a rerun emails nobody twice');
 const retry=await sendConfirmations({store,confirm,send:true,retryFailed:true,delayMs:0,log:()=>{}});
 assert.equal(retry.sent,1);assert.deepEqual(sent.at(-1),['r3','pt']);assert.equal(statusOf('r5'),'uncertain','uncertain is never retried automatically');
 // The sample used by --test-to is a complete, private-answer-free registration.
 const sample=registrationEmail({registration:{...SAMPLE_REGISTRATION,email:'owner@example.org'},config,language:'es',origin});
 assert.match(sample.text,/Hola, Ana:/);assert.match(sample.text,/Calles para la gente/);assert.match(sample.text,/Postulación en revisión/);
});

test('the backfill command line reads --flag value and --flag=value, and refuses anything else',()=>{
 assert.equal(parseCliArgs([]).limit,Infinity);assert.equal(parseCliArgs(['--limit','5']).limit,5);assert.equal(parseCliArgs(['--limit=5']).limit,5);
 assert.deepEqual(parseCliArgs(['--send','--retry-failed','--limit=2']),{send:true,retryFailed:true,limit:2,testTo:null,language:'es'});
 assert.deepEqual(parseCliArgs(['--test-to=owner@fiiu-inbox.dev','--language','pt']),{send:false,retryFailed:false,limit:Infinity,testTo:'owner@fiiu-inbox.dev',language:'pt'});
 for(const args of [['--limit','0'],['--limit=0'],['--limit','five'],['--limit'],['--limit','-1'],['--limit','2.5'],['--limit=1e3'],['--limit',''],['--limit','--send'],
  ['--send','--test-to=x@fiiu-inbox.dev'],['--test-to','x@fiiu-inbox.dev','--limit','1'],['--test-to','x@fiiu-inbox.dev','--retry-failed'],['--test-to'],['--test-to','not an address'],
  ['--language','pt'],['--test-to','x@fiiu-inbox.dev','--language','fr'],['--sned'],['--send=yes'],['send'],['-s']])
  assert.throws(()=>parseCliArgs(args),Error,JSON.stringify(args));
});

test('end to end: a malformed backfill command sends nothing, and --send --limit=1 sends exactly one',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'nodal-backfill-')),filename=join(dir,'nodal.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const db=createDatabase({filename});t.after(()=>db.close());const store=createFiiuStore({db});
 for(const id of ['r1','r2','r3']){const email=`${id}@fiiu-inbox.dev`,user=createUser(db,{fullName:id,email,passwordHash:'unused'});
  await store.insert('registrations',{id,eventId:'fiiu-2026',userId:user.id,email,answers,labStatus:'none',version:1,createdAt:'2026-09-30T00:00:00Z',updatedAt:'2026-09-30T00:00:00Z',confirmationStatus:'none',confirmationLanguage:'es',confirmationSentAt:null});}
 const smtp=await startFakeSmtp();t.after(smtp.close);
 // Only what the script needs: no Supabase or provider settings leak in from the shell running the tests.
 const env={PATH:process.env.PATH,DATA_BACKEND:'sqlite',DATABASE_PATH:filename,EMAIL_SMTP_URL:`smtp://127.0.0.1:${smtp.port}`,EMAIL_FROM:'fiiu@example.org',PUBLIC_BASE_URL:'http://localhost:4186'};
 const script=fileURLToPath(new URL('../scripts/send-fiiu-confirmations.js',import.meta.url));
 const run=args=>new Promise(resolve=>execFile(process.execPath,[script,...args],{env,timeout:20000},(error,stdout,stderr)=>resolve({code:error?error.code??1:0,stdout,stderr})));
 const statuses=()=>db.prepare('SELECT confirmation_status s FROM fiiu_registrations ORDER BY id').all().map(row=>row.s);
 for(const args of [['--send','--limit','0'],['--send','--limit','five'],['--send','--limit'],['--send','--test-to=owner@fiiu-inbox.dev'],['--send','--test-to','owner@fiiu-inbox.dev'],['--send','--bogus']]){
  const {code,stdout,stderr}=await run(args);
  assert.equal(code,1,JSON.stringify(args));assert.match(stderr,/Nothing was sent/,JSON.stringify(args));assert.doesNotMatch(stdout,/"mode"/);
  assert.equal(smtp.messages.length,0,JSON.stringify(args));assert.deepEqual(statuses(),['none','none','none']);
 }
 const canary=await run(['--send','--limit=1']);
 assert.equal(canary.code,0,canary.stderr);assert.match(canary.stdout,/"mode":"send","listed":1,"sent":1/);
 assert.equal(smtp.messages.length,1);assert.deepEqual(statuses().sort(),['none','none','sent']);
});
