import {mailGate,emailOrigin,safeName} from './fiiu-email.js';
import {validAddress} from './mailer.js';
import {limaTime} from './course-final-survey.js';

/* The team notice for an organisation request (server/node-requests-api.js), a Nodo request or, since 9 November 2026,
   a sponsorship (docs/superpowers/specs/2026-11-09-sponsored-memberships-design.md): one Spanish message to each of two
   team members, sent in parallel, with the organisation as Reply-To so a reply goes straight to it. Never throws, never
   retried: the API stores the outcome ('sent' | 'partial' | 'failed' | 'uncertain'); null from the factory is 'off'. */
export const NODE_REQUEST_RECIPIENTS=Object.freeze(['fmuro@sistemaurbano.org','malegre@sistemaurbano.org']);
const oneLine=value=>safeName(value,Infinity);
const LANGUAGES={es:'Español',en:'English',pt:'Português'};
// The memberships range codes (SPONSOR_MEMBERSHIPS in the API) in the team's words.
const RANGES={'1-10':'1 a 10','11-25':'11 a 25','26-50':'26 a 50','50+':'Más de 50',unsure:'Aún no lo saben'};
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

// Single-line fields go through oneLine (safeName without its first-name cap: no CR/LF or bidi tricks, full length); the message keeps its own line breaks.
// A sponsorship adds the community and the range after the phone, and its message is the topic the sponsor cares about.
function noticeMessage(request,origin){
 const sponsorship=request.kind==='sponsorship',deskLink=`${origin}/admin.html#nodes`;
 const opening=sponsorship?'Una organización quiere patrocinar membresías.':'Una organización quiere conversar sobre un Nodo.';
 const rows=[['Nombre',oneLine(request.name)],['Organización',oneLine(request.organization)],['Correo',oneLine(request.email)],['Teléfono',oneLine(request.phone)||'no indicado'],
  ...(sponsorship?[['Comunidad a apoyar',oneLine(request.community)],['Membresías (aprox.)',RANGES[request.memberships]??oneLine(request.memberships)]]:[]),
  ['Idioma',LANGUAGES[request.language]??LANGUAGES.es],['Recibida (hora de Lima)',limaTime(request.createdAt)]];
 const heading=sponsorship?'Tema o desafío urbano:':'Mensaje:',message=String(request.message??'');
 const text=[opening,'',...rows.map(([label,value])=>`${label}: ${value}`),'',heading,message,'',`Verla en el panel: ${deskLink}`].join('\n');
 const html=`<!doctype html><html lang="es"><body><p>${opening}</p><table>${rows.map(([label,value])=>`<tr><th align="left">${label}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</table><p>${heading}</p><p style="white-space:pre-wrap">${escapeHtml(message)}</p><p><a href="${escapeHtml(deskLink)}">Verla en el panel</a></p></body></html>`;
 return {subject:`${sponsorship?'Patrocinio de membresías':'Solicitud de Nodo'}: ${oneLine(request.organization)}`,text,html};
}
// Only a plain stage name, an SMTP status and an error code are logged, never free text.
const describe=err=>`${err?.stage?` at ${err.stage}`:''}${Number.isInteger(err?.status)?` (SMTP ${err.status})`:''}${typeof err?.code==='string'&&/^[A-Z][A-Z0-9_]{1,40}$/.test(err.code)?` [${err.code}]`:''}`;

// async ({request}) → 'sent' | 'partial' | 'failed' | 'uncertain', or null when email is off (the API stores 'off').
export function createNodeRequestNotice({env=process.env,transport,origin=emailOrigin(env),loopbackOnly=false,log=message=>console.warn(message),recipients=NODE_REQUEST_RECIPIENTS}={}){
 const gate=mailGate({env,transport,origin,loopbackOnly,log,label:'Node request email'});if(!gate)return null;
 return async function notify({request}){
  try{
   const message=noticeMessage(request,gate.origin);
   // null, never left out: the transport would fill in its own default Reply-To (the FIIU inbox) and take the replies.
   const replyTo=validAddress(request.email)?{name:oneLine(request.name),address:request.email}:null;
   const results=await Promise.allSettled(recipients.map(to=>gate.transport.send({to,...message,language:'es',fromName:'NODAL',replyTo})));
   const accepted=results.filter(r=>r.status==='fulfilled').length,refused=results.filter(r=>r.status==='rejected');
   const outcome=accepted===results.length?'sent':accepted?'partial':refused.some(r=>r.reason?.delivery!=='no')?'uncertain':'failed';
   if(outcome!=='sent')log(`Node request email ${outcome} for request ${request.id}${refused.map(r=>describe(r.reason)).join(',')}`);
   return outcome;
  }catch{log(`Node request email failed for request ${request?.id} (template)`);return 'failed';}
 };
}
