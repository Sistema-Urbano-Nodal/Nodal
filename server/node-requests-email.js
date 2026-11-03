import {mailGate,emailOrigin,safeName} from './fiiu-email.js';
import {validAddress} from './mailer.js';
import {limaTime} from './course-final-survey.js';

/* The team notice for an organisation node request (server/node-requests-api.js): one Spanish message to each of two
   team members, sent in parallel, with the organisation as Reply-To so a reply goes straight to it. Never throws, never
   retried: the API stores the outcome ('sent' | 'partial' | 'failed' | 'uncertain'); null from the factory is 'off'. */
export const NODE_REQUEST_RECIPIENTS=Object.freeze(['fmuro@sistemaurbano.org','malegre@sistemaurbano.org']);
const oneLine=value=>safeName(value,Infinity);
const LANGUAGES={es:'Español',en:'English',pt:'Português'};
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

// Single-line fields go through oneLine (safeName without its first-name cap: no CR/LF or bidi tricks, full length); the message keeps its own line breaks.
function noticeMessage(request,origin){
 const deskLink=`${origin}/admin.html#nodes`;
 const rows=[['Nombre',oneLine(request.name)],['Organización',oneLine(request.organization)],['Correo',oneLine(request.email)],
  ['Teléfono',oneLine(request.phone)||'no indicado'],['Idioma',LANGUAGES[request.language]??LANGUAGES.es],['Recibida (hora de Lima)',limaTime(request.createdAt)]];
 const message=String(request.message??'');
 const text=['Una organización pidió ser parte de NODAL.','',...rows.map(([label,value])=>`${label}: ${value}`),'','Mensaje:',message,'',`Verla en el panel: ${deskLink}`].join('\n');
 const html=`<!doctype html><html lang="es"><body><p>Una organización pidió ser parte de NODAL.</p><table>${rows.map(([label,value])=>`<tr><th align="left">${label}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</table><p>Mensaje:</p><p style="white-space:pre-wrap">${escapeHtml(message)}</p><p><a href="${escapeHtml(deskLink)}">Verla en el panel</a></p></body></html>`;
 return {subject:`Solicitud de Nodo: ${oneLine(request.organization)}`,text,html};
}
// Only a plain stage name, an SMTP status and an error code are logged, never free text.
const describe=err=>`${err?.stage?` at ${err.stage}`:''}${Number.isInteger(err?.status)?` (SMTP ${err.status})`:''}${typeof err?.code==='string'&&/^[A-Z][A-Z0-9_]{1,40}$/.test(err.code)?` [${err.code}]`:''}`;

// async ({request}) → 'sent' | 'partial' | 'failed' | 'uncertain', or null when email is off (the API stores 'off').
export function createNodeRequestNotice({env=process.env,transport,origin=emailOrigin(env),loopbackOnly=false,log=message=>console.warn(message),recipients=NODE_REQUEST_RECIPIENTS}={}){
 const gate=mailGate({env,transport,origin,loopbackOnly,log,label:'Node request email'});if(!gate)return null;
 return async function notify({request}){
  try{
   const message=noticeMessage(request,gate.origin);
   const replyTo=validAddress(request.email)?{name:oneLine(request.name),address:request.email}:undefined;
   const results=await Promise.allSettled(recipients.map(to=>gate.transport.send({to,...message,language:'es',fromName:'NODAL',...(replyTo?{replyTo}:{})})));
   const accepted=results.filter(r=>r.status==='fulfilled').length,refused=results.filter(r=>r.status==='rejected');
   const outcome=accepted===results.length?'sent':accepted?'partial':refused.some(r=>r.reason?.delivery!=='no')?'uncertain':'failed';
   if(outcome!=='sent')log(`Node request email ${outcome} for request ${request.id}${refused.map(r=>describe(r.reason)).join(',')}`);
   return outcome;
  }catch{log(`Node request email failed for request ${request?.id} (template)`);return 'failed';}
 };
}
