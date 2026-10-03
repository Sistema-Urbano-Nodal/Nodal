import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {EventEmitter} from 'node:events';
import {createMailTransport,smtpConfig,parseMailbox,encodeWords,dotStuff,buildMessage,validAddress} from '../server/mailer.js';
import {startFakeSmtp,parseMessage} from './helpers/fake-smtp.js';

const env=(port,extra={})=>({EMAIL_SMTP_URL:`smtp://nodal%40example.org:app%20pass%3Aword@127.0.0.1:${port}`,EMAIL_FROM:'FIIU Fest 11 · NODAL <fiiu@example.org>',...extra});
// QUIT follows the accepted message without holding up the sender, so the server sees it a moment later.
const quitSeen=async smtp=>{for(let i=0;i<100&&!smtp.transcript.includes('QUIT');i++)await new Promise(resolve=>setTimeout(resolve,5));};
const letter={to:'ana@example.com',subject:'Tu inscripción en FIIU Fest 11',text:'Hola, Ana:\n.una línea que empieza con punto\n..y otra',html:'<p>Hola, <b>Ana</b></p>',language:'es'};

test('the transport is off without EMAIL_SMTP_URL and EMAIL_FROM, and refuses plain SMTP to anything but loopback outside production',()=>{
 assert.equal(createMailTransport({env:{}}),null);
 assert.equal(createMailTransport({env:{EMAIL_SMTP_URL:'smtps://u:p@smtp.example.org:465'}}),null,'no sender address, no email');
 assert.equal(createMailTransport({env:{EMAIL_FROM:'a@example.org'}}),null);
 const ok=smtpConfig({EMAIL_SMTP_URL:'smtps://me%40gmail.com:abcd%20efgh@smtp.gmail.com',EMAIL_FROM:'NODAL <me@gmail.com>'});
 assert.deepEqual([ok.host,ok.port,ok.secure,ok.user,ok.pass,ok.from.address,ok.replyTo.address],['smtp.gmail.com',465,true,'me@gmail.com','abcd efgh','me@gmail.com','fiiu@ocupatucalle.com']);
 for(const url of ['smtp://u:p@smtp.example.org:587','smtp://u:p@10.0.0.5:25','http://u:p@smtp.example.org','not a url'])
  assert.throws(()=>smtpConfig({EMAIL_SMTP_URL:url,EMAIL_FROM:'a@example.org'}),/EMAIL_SMTP_URL/,url);
 assert.throws(()=>smtpConfig({EMAIL_SMTP_URL:'smtp://127.0.0.1:2525',EMAIL_FROM:'a@example.org',NODE_ENV:'production'}),/smtps/);
 assert.equal(smtpConfig({EMAIL_SMTP_URL:'smtp://127.0.0.1:2525',EMAIL_FROM:'a@example.org'}).loopback,true);
 assert.throws(()=>smtpConfig({EMAIL_SMTP_URL:'smtps://h.example.org',EMAIL_FROM:'Bad\r\nBcc: x@y.org <a@example.org>'}),/EMAIL_FROM/);
 assert.throws(()=>smtpConfig({EMAIL_SMTP_URL:'smtps://h.example.org',EMAIL_FROM:'a@example.org',EMAIL_REPLY_TO:'not an address'}),/EMAIL_REPLY_TO/);
 // Configuration errors never repeat the secret-bearing URL.
 try{smtpConfig({EMAIL_SMTP_URL:'smtp://user:s3cret@smtp.example.org',EMAIL_FROM:'a@example.org'});assert.fail('expected a refusal');}catch(err){assert.doesNotMatch(err.message,/s3cret|user/);}
});

test('smtps connects with TLS to the configured host with SNI and certificate verification left on',async()=>{
 let options;const transport=createMailTransport({env:{EMAIL_SMTP_URL:'smtps://u:p@smtp.example.org',EMAIL_FROM:'a@example.org'},timeoutMs:50,connect:o=>{options=o;const socket=new net.Socket();setImmediate(()=>socket.destroy());return socket;}});
 await assert.rejects(transport.send(letter),err=>err.delivery==='no');
 assert.deepEqual(options,{host:'smtp.example.org',port:465,servername:'smtp.example.org',secure:true});
 const source=await import('node:fs').then(fs=>fs.readFileSync(new URL('../server/mailer.js',import.meta.url),'utf8'));
 assert.doesNotMatch(source,/rejectUnauthorized/,'certificate verification is never switched off');
});

test('a message goes through greeting, EHLO, AUTH PLAIN, MAIL, RCPT, DATA and QUIT, with dot-stuffing and UTF-8 parts',async t=>{
 const smtp=await startFakeSmtp({credentials:{user:'nodal@example.org',pass:'app pass:word'}});t.after(smtp.close);
 const result=await createMailTransport({env:env(smtp.port)}).send(letter);
 assert.equal(result.response,250);assert.match(result.messageId,/^<[0-9a-f]{32}@example\.org>$/);await quitSeen(smtp);
 assert.deepEqual(smtp.transcript.map(line=>line.split(' ')[0]),['EHLO','AUTH','MAIL','RCPT','DATA','QUIT']);
 assert.equal(smtp.transcript[1],'AUTH PLAIN '+Buffer.from('\0nodal@example.org\0app pass:word').toString('base64'));
 assert.equal(smtp.transcript[2],'MAIL FROM:<fiiu@example.org>');assert.equal(smtp.transcript[3],'RCPT TO:<ana@example.com>');
 const [message]=smtp.messages,parsed=parseMessage(message.data);
 assert.deepEqual([message.from,message.to],['fiiu@example.org',['ana@example.com']]);
 assert.equal(parsed.subject,letter.subject);assert.match(parsed.headers.subject,/^=\?UTF-8\?B\?/,'a non-ASCII subject is RFC 2047 encoded');
 assert.equal(parsed.headers.to,'ana@example.com');assert.equal(parsed.headers['reply-to'],'fiiu@ocupatucalle.com');
 assert.match(parsed.headers.from,/^=\?UTF-8\?B\?.+\?= <fiiu@example\.org>$/);assert.equal(parsed.headers['message-id'],result.messageId);
 assert.match(parsed.headers.date,/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} \+0000$/);
 assert.equal(parsed.headers['content-language'],'es');assert.equal(parsed.headers['auto-submitted'],'auto-generated');
 assert.equal(parsed.text,letter.text.replace(/\n/g,'\r\n'),'lines starting with a dot arrive intact');assert.equal(parsed.html,letter.html);
 assert.ok(message.data.split('\r\n').every(line=>line.length<=998),'no line over the SMTP limit');
});

test('dot-stuffing doubles every leading dot, the first line included',()=>{
 assert.equal(dotStuff('.a\r\nb\r\n.\r\n..c\r\nd.e'),'..a\r\nb\r\n..\r\n...c\r\nd.e');
 // The built message is all CRLF, so the stream the server reads ends with the single terminator only.
 const raw=buildMessage({from:{name:'',address:'a@example.org'},to:'b@example.com',subject:'S',text:'.x\n.',html:'',messageId:'<1@example.org>'});
 assert.doesNotMatch(raw.replace(/\r\n/g,''),/\n/);assert.ok(raw.endsWith('\r\n'));
});

test('multi-line replies are read whole, even split across packets, so the next command waits for the final line',async()=>{
 const socket=new EventEmitter(),writes=[];Object.assign(socket,{write:data=>{writes.push(data);},end:data=>{if(data)writes.push(data);},destroy(){}});
 const tick=()=>new Promise(resolve=>setImmediate(resolve)),commands=()=>writes.map(w=>w.split(' ')[0].trim());
 const sent=createMailTransport({env:{EMAIL_SMTP_URL:'smtp://127.0.0.1:2525',EMAIL_FROM:'a@example.org'},connect:()=>socket}).send(letter);
 socket.emit('data',Buffer.from('220-fake.test first line\r\n220-second'));await tick();assert.deepEqual(writes,[],'no command before the greeting ends');
 socket.emit('data',Buffer.from(' line\r\n220 ready\r\n'));await tick();assert.deepEqual(commands(),['EHLO']);
 socket.emit('data',Buffer.from('250-fake.test\r\n250-AU'));await tick();assert.deepEqual(commands(),['EHLO']);
 socket.emit('data',Buffer.from('TH PLAIN\r\n250 8BITMIME\r\n'));await tick();assert.deepEqual(commands(),['EHLO','MAIL'],'no AUTH without credentials');
 for(const [reply,next] of [['250 OK\r\n','RCPT'],['250 OK\r\n','DATA'],['354 go\r\n',null]]){socket.emit('data',Buffer.from(reply));await tick();if(next)assert.equal(commands().at(-1),next);}
 assert.match(writes.at(-1),/\r\n\.\r\n$/,'the message ends with the terminator');
 socket.emit('data',Buffer.from('250 2.0.0 queued\r\n'));assert.equal((await sent).response,250);assert.equal(writes.at(-1),'QUIT\r\n');
 // A reply line without a code is a protocol error, not a hang.
 const broken=new EventEmitter();Object.assign(broken,{write(){},end(){},destroy(){}});
 const failed=createMailTransport({env:{EMAIL_SMTP_URL:'smtp://127.0.0.1:2525',EMAIL_FROM:'a@example.org'},connect:()=>broken}).send(letter);
 broken.emit('data',Buffer.from('hello there\r\n'));await assert.rejects(failed,err=>err.stage==='reply'&&err.delivery==='no');
});

test('a 5xx refusal is permanent and a 4xx temporary; neither leaves the provider holding the message, and errors carry no secrets',async t=>{
 for(const [reply,status,permanent,stage] of [[{auth:'535 5.7.8 Username and Password not accepted for nodal@example.org'},535,true,'auth'],[{rcpt:'550 5.1.1 <ana@example.com> does not exist'},550,true,'recipient'],[{mail:'421 4.7.0 Try again later'},421,false,'sender'],[{message:'451 4.3.0 Mail server temporarily rejected message'},451,false,'message'],[{message:'554 5.7.1 Message rejected'},554,true,'message']]){
  const smtp=await startFakeSmtp({reply});t.after(smtp.close);
  await assert.rejects(createMailTransport({env:env(smtp.port)}).send(letter),err=>{
   assert.deepEqual([err.name,err.status,err.permanent,err.stage,err.delivery,err.expose],['SmtpError',status,permanent,stage,'no',false],JSON.stringify(reply));
   assert.doesNotMatch(`${err.message} ${JSON.stringify(err)}`,/app|word|ana@|nodal@|Hola|example\.com/);return true;
  });
  assert.equal(smtp.messages.length,0);
 }
});

test('one overall deadline: a silent server fails before the message, and silence after it leaves delivery unknown',async t=>{
 const quiet=await startFakeSmtp({hang:'greeting'});t.after(quiet.close);
 let started=Date.now();
 await assert.rejects(createMailTransport({env:env(quiet.port),timeoutMs:150}).send(letter),err=>err.stage==='timeout'&&err.delivery==='no'&&err.code==='ETIMEDOUT');
 assert.ok(Date.now()-started<1000);
 const afterData=await startFakeSmtp({hang:'message'});t.after(afterData.close);started=Date.now();
 await assert.rejects(createMailTransport({env:env(afterData.port),timeoutMs:150}).send(letter),err=>err.stage==='timeout'&&err.delivery==='unknown');
 assert.ok(Date.now()-started<1000);
 // Nothing listening: refused at once, not delivered.
 const closed=await startFakeSmtp();const port=closed.port;await closed.close();
 await assert.rejects(createMailTransport({env:env(port)}).send(letter),err=>err.stage==='connection'&&err.delivery==='no'&&err.code==='ECONNREFUSED');
});

test('a malformed or oversized reply is "not delivered" before DATA ends, and "unknown" once the whole message was written',async t=>{
 for(const [reply,stage] of [[{greeting:'hello there'},'greeting'],[{rcpt:'250 '+'x'.repeat(70*1024)},'recipient']]){
  const smtp=await startFakeSmtp({reply});t.after(smtp.close);
  await assert.rejects(createMailTransport({env:env(smtp.port)}).send(letter),err=>err.stage==='reply'&&err.delivery==='no',stage);
 }
 // The server takes the full message, then answers the final "." without a reply code, or with a 70 KB line.
 for(const message of ['OK: queued as 123','250 '+'x'.repeat(70*1024)]){
  const smtp=await startFakeSmtp({reply:{message}});t.after(smtp.close);
  await assert.rejects(createMailTransport({env:env(smtp.port)}).send(letter),err=>err.name==='SmtpError'&&err.stage==='reply'&&err.delivery==='unknown',message.slice(0,20));
  assert.ok(smtp.transcript.includes('DATA'),'the whole message was written before the reply');
 }
});

test('addresses and headers cannot be injected',async t=>{
 for(const bad of ['ana@example.com\r\nBcc: x@example.org','ana@example.com>','<ana@example.com>','ana @example.com','ana@localhost','"ana"@example.com',''])assert.equal(validAddress(bad),false,JSON.stringify(bad));
 assert.equal(validAddress('ana.maría@example.com'),false,'non-ASCII local parts are refused rather than mangled');
 assert.equal(validAddress('ana+fiiu@mail.example.com'),true);
 assert.deepEqual(parseMailbox('"Equipo \\"FIIU\\"" <fiiu@example.org>'),{name:'Equipo "FIIU"',address:'fiiu@example.org'});
 assert.equal(parseMailbox('Name <fiiu@example.org>\r\nBcc: x@example.org'),null);
 assert.equal(encodeWords('Line\r\nBcc: x@example.org'),'Line Bcc: x@example.org','CR and LF never survive into a header');
 const long=encodeWords('Inscripción '.repeat(12));assert.ok(long.split('\r\n ').every(word=>word.length<=75&&/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/.test(word)));
 assert.equal(long.split('\r\n ').map(word=>Buffer.from(word.slice(10,-2),'base64').toString('utf8')).join(''),'Inscripción '.repeat(12),'no character is split across words');
 const smtp=await startFakeSmtp();t.after(smtp.close);
 await assert.rejects(createMailTransport({env:env(smtp.port)}).send({...letter,to:'ana@example.com\r\nRCPT TO:<x@example.org>'}),err=>err.stage==='message'&&err.delivery==='no');
 assert.equal(smtp.transcript.length,0,'an invalid recipient never opens a connection');
 await createMailTransport({env:env(smtp.port)}).send({...letter,subject:'Hi\r\nBcc: x@example.org'});
 const parsed=parseMessage(smtp.messages[0].data);assert.equal(parsed.headers.bcc,undefined);assert.equal(parsed.subject,'Hi Bcc: x@example.org');
});
