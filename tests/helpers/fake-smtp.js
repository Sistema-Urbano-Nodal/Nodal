import net from 'node:net';
import {once} from 'node:events';

/* A loopback SMTP server for tests and local previews. It speaks just enough ESMTP for server/mailer.js: a greeting,
   a multi-line EHLO reply, AUTH PLAIN (checked against `credentials` when given), MAIL, RCPT, DATA with transparency
   (a leading ".." becomes "."), RSET, NOOP and QUIT. Every client line lands in `transcript` and every accepted
   message in `messages` as {from, to, data}.
   reply: {greeting, ehlo, auth, mail, rcpt, data, message} overrides one reply ("550 5.1.1 no such user");
   hang: 'greeting' | 'message' stops answering at that point, to exercise timeouts. */
export async function startFakeSmtp({credentials=null,reply={},hang=null,onMessage=null,port=0}={}){
 const transcript=[],messages=[],sockets=new Set();
 const server=net.createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
  let buffer='',inData=false,data=[],from=null,to=[];
  const say=line=>{if(!socket.destroyed)socket.write(line+'\r\n');};
  const answer=(name,fallback)=>say(reply[name]??fallback);
  if(hang!=='greeting')answer('greeting','220 fake.test ESMTP ready');
  socket.on('data',chunk=>{
   buffer+=chunk.toString('utf8');
   for(let i=buffer.indexOf('\r\n');i!==-1;i=buffer.indexOf('\r\n')){
    const line=buffer.slice(0,i);buffer=buffer.slice(i+2);
    if(inData){
     if(line!=='.'){data.push(line.startsWith('..')?line.slice(1):line);continue;}
     inData=false;const message={from,to:[...to],data:data.join('\r\n')+'\r\n'};data=[];
     if(hang==='message')continue;
     const refusal=reply.message;if(!refusal||refusal.startsWith('2')){messages.push(message);onMessage?.(message);}
     answer('message','250 2.0.0 OK queued as FAKE1');continue;
    }
    transcript.push(line);
    const verb=line.split(' ')[0].toUpperCase();
    if(verb==='EHLO'||verb==='HELO')answer('ehlo',verb==='EHLO'?'250-fake.test greets you\r\n250-SIZE 35882577\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME':'250 fake.test');
    else if(verb==='AUTH'){
     const [,mechanism,encoded]=line.split(' ');const [,user,pass]=Buffer.from(encoded??'','base64').toString('utf8').split('\0');
     if(reply.auth)say(reply.auth);
     else if(mechanism!=='PLAIN'||(credentials&&(user!==credentials.user||pass!==credentials.pass)))say('535 5.7.8 Authentication credentials invalid');
     else say('235 2.7.0 Accepted');
    }
    else if(verb==='MAIL'){from=/<([^>]*)>/.exec(line)?.[1]??null;to=[];answer('mail','250 2.1.0 OK');}
    else if(verb==='RCPT'){to.push(/<([^>]*)>/.exec(line)?.[1]);answer('rcpt','250 2.1.5 OK');}
    else if(verb==='DATA'){if(reply.data)say(reply.data);else{inData=true;say('354 End data with <CR><LF>.<CR><LF>');}}
    else if(verb==='RSET'||verb==='NOOP')say('250 2.0.0 OK');
    else if(verb==='QUIT'){say('221 2.0.0 Bye');socket.end();}
    else say('502 5.5.2 Command not recognised');
   }
  });
 });
 server.listen(port,'127.0.0.1');await once(server,'listening');
 return {port:server.address().port,transcript,messages,
  close:()=>new Promise(resolve=>{for(const socket of sockets)socket.destroy();server.close(()=>resolve());})};
}

// Decodes one accepted message: headers (unfolded, by lower-case name) and the base64 text/html parts.
export function parseMessage(data){
 const [head,...rest]=data.split('\r\n\r\n'),body=rest.join('\r\n\r\n'),headers={};
 for(const line of head.replace(/\r\n[ \t]/g,' ').split('\r\n')){const i=line.indexOf(':');headers[line.slice(0,i).toLowerCase()]=line.slice(i+1).trim();}
 const boundary=/boundary="([^"]+)"/.exec(headers['content-type']??'')?.[1],parts={};
 for(const chunk of boundary?body.split(`--${boundary}`).slice(1,-1):[]){
  const [partHead,...partBody]=chunk.replace(/^\r\n/,'').split('\r\n\r\n');const type=/Content-Type: ([^;\r\n]+)/i.exec(partHead)?.[1];
  parts[type]=Buffer.from(partBody.join('\r\n\r\n').replace(/\s+/g,''),'base64').toString('utf8');
 }
 const subject=(headers.subject??'').replace(/=\?UTF-8\?B\?([^?]*)\?=\s*/gi,(m,b64)=>Buffer.from(b64,'base64').toString('utf8'));
 return {headers,subject,text:parts['text/plain']??'',html:parts['text/html']??''};
}
