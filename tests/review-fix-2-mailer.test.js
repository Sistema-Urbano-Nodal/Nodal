import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createMailTransport} from '../server/mailer.js';

const letter={to:'ana@example.com',subject:'Inscripción',text:'Hola',html:'<p>Hola</p>',language:'es'};
const env={EMAIL_SMTP_URL:'smtp://127.0.0.1:2525',EMAIL_FROM:'a@example.org'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fakeSocket(){
 const socket=new EventEmitter(),writes=[];let destroyed=false;
 Object.assign(socket,{write:data=>{writes.push(data);},end:data=>{if(data)writes.push(data);},destroy(){destroyed=true;}});
 return {socket,writes,destroyed:()=>destroyed};
}
// Feeds complete lines in normal-sized records until the client gives up or `limit` bytes have gone in.
async function stream(socket,settled,line,limit){
 const chunk=Buffer.from(line.repeat(Math.floor(16*1024/line.length)));let fed=0;
 while(!settled()&&fed<limit){socket.emit('data',chunk);fed+=chunk.length;await tick();}
 return fed;
}

test('a reply made of endless continuation lines is cut off at the reply cap, not left to grow until the deadline',async()=>{
 const {socket,writes,destroyed}=fakeSocket();let outcome=null;
 const sent=createMailTransport({env,connect:()=>socket,timeoutMs:5000}).send(letter).then(value=>{outcome={value};},error=>{outcome={error};});
 const fed=await stream(socket,()=>outcome,'220-'+'x'.repeat(60)+'\r\n',1024*1024);await sent;
 assert.ok(outcome.error,'the send fails');
 assert.deepEqual([outcome.error.name,outcome.error.stage,outcome.error.message,outcome.error.delivery],['SmtpError','reply','SMTP reply too long','no']);
 assert.ok(fed<=96*1024,`gave up after ${fed} bytes, well before 1 MB`);
 assert.equal(destroyed(),true);assert.deepEqual(writes,[],'no command is sent on an unfinished greeting');
});

test('an endless reply after the whole message was written is cut off too, and leaves delivery unknown',async()=>{
 // Once the message was handed over, an oversized answer may follow acceptance, so a retry could send a second copy.
 const {socket,writes}=fakeSocket();let outcome=null;
 const sent=createMailTransport({env,connect:()=>socket,timeoutMs:5000}).send(letter).then(value=>{outcome={value};},error=>{outcome={error};});
 for(const reply of ['220 ready\r\n','250 hi\r\n','250 ok\r\n','250 ok\r\n','354 go\r\n']){socket.emit('data',Buffer.from(reply));await tick();}
 assert.match(writes.at(-1),/\r\n\.\r\n$/);
 const fed=await stream(socket,()=>outcome,'250-'+'z'.repeat(60)+'\r\n',1024*1024);await sent;
 assert.deepEqual([outcome.error.stage,outcome.error.message,outcome.error.delivery],['reply','SMTP reply too long','unknown']);
 assert.ok(fed<=96*1024,`gave up after ${fed} bytes`);
});

test('ordinary multi-line replies far below the cap still go through',async()=>{
 const {socket,writes}=fakeSocket();
 const sent=createMailTransport({env,connect:()=>socket,timeoutMs:5000}).send(letter);
 socket.emit('data',Buffer.from(Array.from({length:200},(_,i)=>`220-banner line ${i}\r\n`).join('')+'220 ready\r\n'));await tick();
 socket.emit('data',Buffer.from(Array.from({length:40},(_,i)=>`250-EXTENSION${i}\r\n`).join('')+'250 SMTPUTF8\r\n'));await tick();
 for(const reply of ['250 ok\r\n','250 ok\r\n','354 go\r\n','250 queued\r\n']){socket.emit('data',Buffer.from(reply));await tick();}
 assert.equal((await sent).response,250);assert.equal(writes.at(-1),'QUIT\r\n');
});
