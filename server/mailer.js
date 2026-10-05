import net from 'node:net';
import tls from 'node:tls';
import {randomBytes} from 'node:crypto';

/* A small SMTP submission client for NODAL's transactional email (the FIIU registration summary), with no
   dependencies. One message per connection over implicit TLS (smtps://, port 465) with certificate verification,
   AUTH PLAIN, and one overall deadline. It works with a Google Workspace or Gmail app password and with SMTP relays
   such as Resend. Plain smtp:// is accepted only for a loopback host outside production: tests and local mail
   catchers. Configuration (server-only):
     EMAIL_SMTP_URL  smtps://user:password@host:465 (percent-encode reserved characters in the user and password)
     EMAIL_FROM      "Display name <address>" or a bare address
     EMAIL_REPLY_TO  optional, defaults to fiiu@ocupatucalle.com
   Errors never carry the URL, the password, an address or the message: only the stage, the SMTP reply code and
   whether the provider may already have the message. */
export const SMTP_TIMEOUT_MS=8000,DEFAULT_REPLY_TO='fiiu@ocupatucalle.com';
const LOOPBACK=new Set(['localhost','127.0.0.1','::1']),MAX_REPLY_BYTES=64*1024;
// A deliberately plain address: dot-atom local part and a dotted DNS name. Anything else (spaces, brackets, quotes,
// CR/LF) is refused before it can reach a header or an SMTP command.
const ADDRESS=/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
export const validAddress=value=>typeof value==='string'&&value.length<=254&&ADDRESS.test(value);
/* delivery: 'no' while the provider cannot have accepted the message (a refusal, or a connection lost before the
   end of DATA); 'unknown' once the whole message was handed over without a final, well-formed answer (a timeout, a
   lost connection, or a malformed or oversized reply). permanent: a 5xx reply. */
export const smtpError=(message,{stage,status,delivery='no',code}={})=>Object.assign(new Error(message),{name:'SmtpError',stage,status,permanent:status>=500,delivery,code,expose:false});

// "Name <address>", "\"Name\" <address>" or a bare address.
export function parseMailbox(value){
 const raw=String(value??'').trim();
 if(/[\r\n]/.test(raw))return null;
 const m=/^(?:"((?:[^"\\]|\\.)*)"|([^<>"]*?))\s*<([^<>\s]+)>$/.exec(raw);
 const name=m?(m[1]!==undefined?m[1].replace(/\\(.)/g,'$1'):m[2]).trim():'',address=m?m[3]:raw;
 return validAddress(address)?{name,address}:null;
}
const ASCII=/^[\x20-\x7e]*$/;
// RFC 2047 encoded words (UTF-8, base64), each at most 75 characters and never splitting a character, folded with
// CRLF + space. Printable ASCII is left as it is.
export function encodeWords(text){
 const value=String(text??'').replace(/[\r\n\t]+/g,' ');
 if(ASCII.test(value))return value;
 const words=[];let chunk='';
 for(const ch of value){if(Buffer.byteLength(chunk+ch)>45){words.push(chunk);chunk='';}chunk+=ch;}
 if(chunk)words.push(chunk);
 return words.map(word=>`=?UTF-8?B?${Buffer.from(word,'utf8').toString('base64')}?=`).join('\r\n ');
}
export function formatMailbox({name,address}){
 if(!name)return address;
 return ASCII.test(name)?`"${name.replace(/["\\]/g,'\\$&')}" <${address}>`:`${encodeWords(name)} <${address}>`;
}
// RFC 5322 date in UTC, e.g. "Fri, 02 Oct 2026 21:05:09 +0000".
export const rfc5322Date=(date=new Date())=>date.toUTCString().replace(/GMT$/,'+0000');
const base64Lines=text=>Buffer.from(String(text).replace(/\r?\n/g,'\r\n'),'utf8').toString('base64').replace(/.{76}(?=.)/g,'$&\r\n');
// SMTP transparency (RFC 5321 4.5.2): a line that starts with "." gets one more.
export const dotStuff=data=>data.replace(/(^|\r\n)\./g,'$1..');

// The full RFC 5322 message: multipart/alternative with base64 UTF-8 text and HTML parts, CRLF line ends.
export function buildMessage({from,to,replyTo,subject,text,html,language,date=new Date(),messageId}){
 if(!validAddress(to))throw smtpError('invalid recipient address',{stage:'message'});
 const boundary=`nodal-${randomBytes(12).toString('hex')}`;
 const headers=[
  `From: ${formatMailbox(from)}`,`To: ${to}`,...(replyTo?[`Reply-To: ${formatMailbox(replyTo)}`]:[]),
  `Subject: ${encodeWords(subject)}`,`Date: ${rfc5322Date(date)}`,`Message-ID: ${messageId}`,'MIME-Version: 1.0',
  // RFC 3834: an automatic message, so well-behaved autoresponders stay quiet.
  'Auto-Submitted: auto-generated',...(/^[a-z]{2}$/.test(language??'')?[`Content-Language: ${language}`]:[]),
  `Content-Type: multipart/alternative; boundary="${boundary}"`,
 ];
 const part=(type,body)=>[`--${boundary}`,`Content-Type: ${type}; charset=UTF-8`,'Content-Transfer-Encoding: base64','',base64Lines(body)];
 return [...headers,'',...part('text/plain',text),...(html?part('text/html',html):[]),`--${boundary}--`,''].join('\r\n');
}

const hostOf=url=>url.hostname.replace(/^\[|\]$/g,'');
// Reads the env once. null when EMAIL_SMTP_URL or EMAIL_FROM is missing (the feature is off); throws a message
// without secrets when either is malformed.
export function smtpConfig(env=process.env){
 const raw=String(env.EMAIL_SMTP_URL??'').trim(),fromValue=String(env.EMAIL_FROM??'').trim();
 if(!raw||!fromValue)return null;
 let url;try{url=new URL(raw);}catch{throw Error('EMAIL_SMTP_URL is not a valid URL');}
 const host=hostOf(url),loopback=LOOPBACK.has(host);
 if(!host)throw Error('EMAIL_SMTP_URL needs a host');
 if(url.protocol!=='smtps:'&&!(url.protocol==='smtp:'&&loopback&&env.NODE_ENV!=='production'))throw Error('EMAIL_SMTP_URL must use smtps:// (implicit TLS, usually port 465)');
 let user,pass;try{user=decodeURIComponent(url.username);pass=decodeURIComponent(url.password);}catch{throw Error('EMAIL_SMTP_URL has a malformed user or password');}
 const from=parseMailbox(fromValue);if(!from)throw Error('EMAIL_FROM must be an address or "Name <address>"');
 const replyTo=parseMailbox(String(env.EMAIL_REPLY_TO??'').trim()||DEFAULT_REPLY_TO);if(!replyTo)throw Error('EMAIL_REPLY_TO must be an address or "Name <address>"');
 return {host,port:Number(url.port)||(url.protocol==='smtps:'?465:25),secure:url.protocol==='smtps:',loopback,user,pass,from,replyTo};
}

// Reply reader over one socket: CRLF lines, multi-line replies ("250-..." until "250 ..."), oldest reply first.
// Everything received and not yet read (the partial line, the reply being assembled and any queued replies) is
// held to MAX_REPLY_BYTES, so a peer streaming endless "250-" continuation lines, or replies nobody asked for, is
// cut off instead of growing memory until the deadline.
function replies(socket){
 let buffer='',lines=[],failure=null,waiting=null,held=0,replyBytes=0;const queue=[];
 const settle=()=>{if(!waiting||(!queue.length&&!failure))return;const {resolve,reject}=waiting;waiting=null;if(queue.length){const reply=queue.shift();held-=reply.bytes;resolve(reply);}else reject(failure);};
 const fail=err=>{failure??=err;settle();};
 const tooLong=()=>{fail(smtpError('SMTP reply too long',{stage:'reply'}));socket.destroy();};
 socket.on('data',chunk=>{
  if(failure)return;
  buffer+=chunk.toString('latin1');
  if(held+buffer.length>MAX_REPLY_BYTES){tooLong();return;}
  for(let i=buffer.indexOf('\n');i!==-1;i=buffer.indexOf('\n')){
   const line=buffer.slice(0,i).replace(/\r$/,'');buffer=buffer.slice(i+1);
   const m=/^(\d{3})(?:([ -]).*)?$/.exec(line);
   if(!m||(lines.length&&lines[0].slice(0,3)!==m[1])){fail(smtpError('SMTP reply malformed',{stage:'reply'}));socket.destroy();return;}
   held+=i+1;replyBytes+=i+1;
   if(held>MAX_REPLY_BYTES){tooLong();return;}
   lines.push(line);if(m[2]!=='-'){queue.push({code:Number(m[1]),lines,bytes:replyBytes});lines=[];replyBytes=0;}
  }
  settle();
 });
 socket.on('error',err=>fail(err));
 socket.on('close',()=>fail(Object.assign(Error('SMTP connection closed'),{code:'ECONNRESET'})));
 return ()=>new Promise((resolve,reject)=>{waiting={resolve,reject};settle();});
}

/* {send({to, subject, text, html, language})} → {messageId, response}, or null when the env does not configure
   email. connect(options) opens the socket; tests replace it (options: host, port, servername, secure). */
export function createMailTransport({env=process.env,connect=null,timeoutMs=SMTP_TIMEOUT_MS,clientName='[127.0.0.1]'}={}){
 const config=smtpConfig(env);if(!config)return null;
 const open=connect??(({host,port,servername,secure})=>secure?tls.connect({host,port,servername,minVersion:'TLSv1.2'}):net.connect({host,port}));
 const messageDomain=config.from.address.split('@')[1];
 async function send({to,subject,text,html,language,replyTo=config.replyTo}){
  const messageId=`<${randomBytes(16).toString('hex')}@${messageDomain}>`;
  const message=buildMessage({from:config.from,to,replyTo,subject,text,html,language,messageId});
  // SNI only for names: an IP literal is not a valid server name.
  const socket=open({host:config.host,port:config.port,servername:net.isIP(config.host)?undefined:config.host,secure:config.secure});
  // flushed: whether the whole message, its final "." included, left this process (null until it is written). The
  // provider can have the message only then; a write that errors, or that the socket's end cancels, means it cannot.
  let flushed=null,finished=false,timer;
  const deadline=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(smtpError('SMTP timed out',{stage:'timeout',code:'ETIMEDOUT'})),timeoutMs);});
  const dialogue=(async()=>{
   const read=replies(socket);
   const expect=async(stage,codes)=>{const reply=await read();if(!codes.includes(reply.code))throw smtpError(`SMTP ${stage} refused (${reply.code})`,{stage,status:reply.code,delivery:stage==='message'&&reply.code<400?'unknown':'no'});return reply;};
   const command=(line,stage,codes)=>{socket.write(line+'\r\n');return expect(stage,codes);};
   await expect('greeting',[220]);
   await command(`EHLO ${clientName}`,'ehlo',[250]);
   if(config.user||config.pass)await command(`AUTH PLAIN ${Buffer.from(`\0${config.user}\0${config.pass}`,'utf8').toString('base64')}`,'auth',[235]);
   await command(`MAIL FROM:<${config.from.address}>`,'sender',[250]);
   await command(`RCPT TO:<${to}>`,'recipient',[250,251]);
   await command('DATA','data',[354]);
   flushed=new Promise(resolve=>socket.write(dotStuff(message)+'.\r\n',err=>resolve(!err)));
   const accepted=await expect('message',[250]);
   finished=true;socket.end('QUIT\r\n');
   return {messageId,response:accepted.code};
  })();
  try{return await Promise.race([dialogue,deadline]);}
  catch(err){
   // Ending the socket first cancels a write still under way, so its callback says whether the message got out. A
   // callback that never comes (a socket that does not report writes) counts as handed over: a retry could send a
   // second copy, so "unknown" is the safe side.
   socket.destroy();
   let wait;const handedOver=flushed!==null&&await Promise.race([flushed,new Promise(resolve=>{wait=setTimeout(resolve,250,true);})]);clearTimeout(wait);
   if(err?.name==='SmtpError'){
    // A garbled or oversized answer, or silence, once the whole message was written may follow the provider's
    // acceptance, so it must not read as "not delivered".
    if(['reply','timeout'].includes(err.stage))err.delivery=handedOver?'unknown':'no';
    throw err;
   }
   throw smtpError('SMTP connection failed',{stage:'connection',delivery:handedOver?'unknown':'no',code:typeof err?.code==='string'?err.code:undefined});
  }
  finally{
   clearTimeout(timer);
   // After QUIT the server closes the connection; one that lingers is cut after a second without holding the process.
   if(finished)setTimeout(()=>socket.destroy(),1000).unref?.();else socket.destroy();
  }
 }
 return {from:config.from,replyTo:config.replyTo,loopback:config.loopback,send};
}
