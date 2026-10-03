import {FIIU_EVENT} from './fiiu-domain.js';
import {createMailTransport,validAddress} from './mailer.js';

/* The FIIU registration summary, emailed after a person's first registration (server/fiiu-api.js; edits send nothing),
   in the language they registered in. It repeats only what they chose: conference blocks, the laboratory application and
   the workshop and route interests with each Google Form, never the private answers (national ID, age, gender,
   accessibility, motivation, institution or role). Activity titles and venues stay in Spanish, as in the programme. */
export const EMAIL_LANGUAGES=['en','es','pt'];
export const EMAIL_ROWS={
 subject:['Your FIIU Fest 11 registration','Tu inscripción en FIIU Fest 11','Sua inscrição no FIIU Fest 11'],
 // The inbox preview line: it mentions Google Forms only when the email lists one to complete.
 preheader:['Your activities, the Google Forms still to complete and the festival calendar.','Tus actividades, los Google Forms que faltan y el calendario del festival.','Suas atividades, os Google Forms que faltam e o calendário do festival.'],
 preheaderNoForms:['Your activities and the festival calendar.','Tus actividades y el calendario del festival.','Suas atividades e o calendário do festival.'],
 heading:['Your registration is saved','Tu inscripción está guardada','Sua inscrição está salva'],
 greeting:['Hi {name},','Hola, {name}:','Olá, {name},'],greetingPlain:['Hi,','Hola:','Olá,'],
 intro:['Your registration for FIIU Fest 11 is saved in NODAL. Here is what you chose, day by day.','Tu inscripción en FIIU Fest 11 quedó guardada en NODAL. Este es el resumen de lo que elegiste, día por día.','Sua inscrição no FIIU Fest 11 está salva na NODAL. Este é o resumo do que você escolheu, dia a dia.'],
 dates:['Lima, 20–25 October 2026','Lima, 20–25 de octubre de 2026','Lima, 20–25 de outubro de 2026'],
 formTitle:['Next step: complete each Google Form','Siguiente paso: completa cada Google Form','Próximo passo: preencha cada Google Form'],
 formReminder:['Your place in a workshop or urban route is confirmed only after you complete that activity’s Google Form. Saving it as an interest in NODAL does not reserve a place.','Tu lugar en un taller o una ruta urbana solo se confirma cuando completas el Google Form de esa actividad. Guardarla como interés en NODAL no reserva tu lugar.','Sua vaga em uma oficina ou roteiro urbano só é confirmada depois que você preenche o Google Form da atividade. Salvá-la como interesse na NODAL não reserva a vaga.'],
 activities:['Your activities','Tus actividades','Suas atividades'],
 spanishTitles:['Activity titles and venues are in Spanish, as in the festival programme.','Los títulos y lugares están en español, como en el programa del festival.','Os títulos e locais estão em espanhol, como na programação do festival.'],
 conference:['Conference block','Bloque de conferencias','Bloco de conferências'],
 lab:['Laboratory for public officials','Laboratorio para funcionarios','Laboratório para gestores públicos'],
 workshop:['Workshop · interest','Taller · interés','Oficina · interesse'],route:['Urban route · interest','Ruta urbana · interés','Roteiro urbano · interesse'],
 venuePending:['Venue to be confirmed','Lugar por confirmar','Local a confirmar'],
 startingPoint:['Starting point:','Punto de inicio:','Ponto de partida:'],
 formLink:['Complete the Google Form','Completar el Google Form','Preencher o Google Form'],
 // Without a workshop or route interest, one general line still says how those places are booked.
 formGeneral:['Workshops and urban routes have their own registration: complete the Google Form for each activity from the programme.','Los talleres y las rutas urbanas tienen inscripción aparte: completa el Google Form de cada actividad desde el programa.','As oficinas e os roteiros urbanos têm inscrição à parte: preencha o Google Form de cada atividade a partir da programação.'],
 formGeneralLink:['See the workshops and routes','Ver los talleres y las rutas','Ver as oficinas e os roteiros'],
 labPending:['Application under review. The organising team will post the decision on your FIIU page in NODAL.','Postulación en revisión. El equipo organizador publicará la decisión en tu página del FIIU en NODAL.','Candidatura em análise. A equipe organizadora publicará a decisão na sua página do FIIU na NODAL.'],
 labAccepted:['Application accepted: your place in the laboratory is confirmed.','Postulación aceptada: tu lugar en el laboratorio está confirmado.','Candidatura aceita: sua vaga no laboratório está confirmada.'],
 labDeclined:['Your application was not selected this time. Your other choices are unchanged.','Tu postulación no fue seleccionada esta vez. Tus demás elecciones no cambian.','Sua candidatura não foi selecionada desta vez. Suas demais escolhas continuam iguais.'],
 calendarTitle:['Festival calendar','Calendario del festival','Calendário do festival'],
 calendarText:['Add the shared FIIU calendar to your Google Calendar to keep every session at hand.','Agrega el calendario compartido del FIIU a tu Google Calendar para tener todas las sesiones a mano.','Adicione o calendário compartilhado do FIIU ao seu Google Agenda para ter todas as sessões à mão.'],
 calendarLink:['Add the FIIU calendar','Agregar el calendario del FIIU','Adicionar o calendário do FIIU'],
 manageTitle:['Review or change your registration','Revisa o cambia tu inscripción','Revise ou altere sua inscrição'],
 manageText:['Sign in to NODAL with this email address to review, update or cancel your registration.','Inicia sesión en NODAL con este correo para revisar, actualizar o cancelar tu inscripción.','Entre na NODAL com este e-mail para revisar, atualizar ou cancelar sua inscrição.'],
 manageLink:['Open my FIIU registration','Abrir mi inscripción al FIIU','Abrir minha inscrição no FIIU'],
 programmeNote:['The programme may change: the live programme is the reference for times and venues. Times are in Lima, and admission is subject to each venue’s capacity.','El programa puede cambiar: el programa en vivo es la referencia de horarios y lugares. Los horarios son de Lima y el ingreso depende del aforo de cada espacio.','A programação pode mudar: a programação ao vivo é a referência de horários e locais. Os horários são de Lima e a entrada depende da capacidade de cada espaço.'],
 programmeLink:['View the live programme','Ver el programa en vivo','Ver a programação ao vivo'],
 questions:['Questions? Reply to this email or write to {contact}.','¿Preguntas? Responde a este correo o escribe a {contact}.','Dúvidas? Responda a este e-mail ou escreva para {contact}.'],
 footer:['You are receiving this email because you registered for FIIU Fest 11 with your NODAL account.','Recibes este correo porque te inscribiste en FIIU Fest 11 con tu cuenta de NODAL.','Você recebe este e-mail porque se inscreveu no FIIU Fest 11 com sua conta NODAL.'],
 privacy:['Privacy policy','Política de privacidad','Política de privacidade'],
};
const LOCALES={en:'en-GB',es:'es-PE',pt:'pt-BR'};
/* Recipients on the reserved test and example domains are never emailed: the .test, .example, .invalid and .localhost
   TLDs and the example.com, example.net and example.org second-level domains (RFC 2606, RFC 6761), with any
   subdomain. The example domains publish a null MX, so a message to them only bounces against the sender. */
export function isReservedRecipient(email){const domain=String(email??'').split('@').pop().toLowerCase().replace(/\.$/,'');return /(?:^|\.)(?:test|example|invalid|localhost|example\.(?:com|net|org))$/.test(domain);}
export const emailLanguage=value=>EMAIL_LANGUAGES.includes(value)?value:'es';
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
// A first name made safe for any context it lands in: no control characters (CR/LF included), single spaces, 100 characters.
export const safeName=value=>String(value??'').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu,' ').replace(/\s+/g,' ').trim().slice(0,100);
const httpsLink=value=>{try{const url=new URL(String(value??''));return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}};
// Email links point at the configured public origin only (never Host, Referer or VERCEL_URL): https, or plain http on
// a loopback host outside production.
export function emailOrigin(env=process.env){
 try{
  const url=new URL(env.PUBLIC_BASE_URL||env.NEXT_PUBLIC_APP_URL||'');
  if(url.username||url.password||(url.protocol!=='https:'&&!(env.NODE_ENV!=='production'&&url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))return null;
  return url.origin;
 }catch{return null;}
}
const PERIODS=['lab','morning','evening','workshop','route'];
const rank=activity=>{const i=PERIODS.indexOf(activity.period);return i<0?PERIODS.length:i;};
// The same order as the festival page: by day, then lab, morning, evening, workshops, routes, then start time.
const chronological=list=>[...list].sort((a,b)=>a.date.localeCompare(b.date)||rank(a)-rank(b)||(a.time||'').localeCompare(b.time||''));
const cap=(text,locale)=>text?text.charAt(0).toLocaleUpperCase(locale)+text.slice(1):text;
const longDate=(value,lang)=>cap(new Intl.DateTimeFormat(LOCALES[lang],{weekday:'long',day:'numeric',month:'long',timeZone:FIIU_EVENT.timeZone}).format(new Date(`${value}T12:00:00-05:00`)),LOCALES[lang]);

// What the person chose, in programme order, from the current catalogue only (unknown and legacy ids are skipped).
function chosenItems(registration,event){
 const a=registration.answers??{},conferences=new Set(Array.isArray(a.activities)?a.activities:[]),interests=new Set(Array.isArray(a.externalActivities)?a.externalActivities:[]);
 const lab=a.applyLab===true||['pending','accepted','declined'].includes(registration.labStatus);
 return chronological(event.activities.filter(activity=>activity.registration==='general'?conferences.has(activity.id):activity.registration==='application'?lab:activity.registration==='external'&&interests.has(activity.id)));
}
function itemView(activity,registration,row){
 const kind=activity.registration==='general'?'conference':activity.registration==='application'?'lab':activity.period==='route'?'route':'workshop';
 const status=kind==='lab'?row({pending:'labPending',accepted:'labAccepted',declined:'labDeclined'}[registration.labStatus]||'labPending'):'';
 // Conference blocks always say where (or that the venue is not confirmed yet); the laboratory leaves an unknown venue out, as the page does.
 const venue=activity.venue||(kind==='conference'?row('venuePending'):''),prefix=activity.venue&&kind==='route'?row('startingPoint'):'';
 return {kind,label:[activity.time,row(kind)].filter(Boolean).join(' · '),title:activity.title,venue,prefix,venueIsSpanish:Boolean(activity.venue),status,formUrl:['workshop','route'].includes(kind)?httpsLink(activity.formUrl):''};
}

const FONT="Montserrat,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK='#25341f',DARK='#3D5C38',MUTED='#5c6857';
/* {subject, html, text}. registration: the stored row (email, answers, labStatus); config: the festival settings
   (programUrl); origin: the public site origin for the links back to NODAL. */
export function registrationEmail({registration,config={},language,origin,event=FIIU_EVENT}){
 const lang=emailLanguage(language),i=EMAIL_LANGUAGES.indexOf(lang),row=key=>EMAIL_ROWS[key][i];
 const name=safeName(registration.answers?.firstName),greeting=name?row('greeting').replace('{name}',()=>name):row('greetingPlain');
 const items=chosenItems(registration,event).map(activity=>({date:activity.date,...itemView(activity,registration,row)}));
 const days=[...new Set(items.map(item=>item.date))].map(date=>({date,label:longDate(date,lang),items:items.filter(item=>item.date===date)}));
 const needsForms=items.some(item=>item.formUrl);
 const registrationUrl=`${origin}/fiiu.html#registration`,privacyUrl=`${origin}/privacy.html`,workshopsUrl=`${origin}/fiiu.html#programme`;
 const programmeUrl=httpsLink(config.programUrl)||`${origin}/fiiu.html#programme`,calendarUrl=httpsLink(event.calendarUrl);
 const contact=validAddress(event.contact)?event.contact:'';
 const subject=row('subject');

 // Plain text: the same content and every URL written out.
 const text=[
  greeting,'',row('intro'),`${event.title} · ${event.theme} · ${row('dates')}`,'',
  ...(needsForms?[row('formTitle').toUpperCase(),row('formReminder'),'']:[]),
  row('activities').toUpperCase(),...(lang==='es'?[]:[row('spanishTitles')]),'',
  ...days.flatMap(day=>[day.label,...day.items.flatMap(item=>[`- ${item.label}`,`  ${item.title}`,...(item.venue?[`  ${[item.prefix,item.venue].filter(Boolean).join(' ')}`]:[]),...(item.status?[`  ${item.status}`]:[]),...(item.formUrl?[`  ${row('formLink')}: ${item.formUrl}`]:[])]),'']),
  ...(needsForms?[]:[row('formGeneral'),`${row('formGeneralLink')}: ${workshopsUrl}`,'']),
  ...(calendarUrl?[row('calendarTitle').toUpperCase(),row('calendarText'),calendarUrl,'']:[]),
  row('manageTitle').toUpperCase(),row('manageText'),registrationUrl,'',
  row('programmeNote'),`${row('programmeLink')}: ${programmeUrl}`,'',
  ...(contact?[row('questions').replace('{contact}',()=>contact),'']:[]),
  '--',row('footer'),`${row('privacy')}: ${privacyUrl}`,'',
 ].join('\n');

 // HTML: one 600px column of tables with inline styles, which Gmail, Outlook and Apple Mail all render; no images,
 // no tracking. Titles and venues from the programme carry lang="es" when the email is in another language.
 const es=value=>lang==='es'?escapeHtml(value):`<span lang="es">${escapeHtml(value)}</span>`;
 const p=(content,style='')=>`<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:${INK};${style}">${content}</p>`;
 const h2=content=>`<h2 style="margin:0 0 8px;font-family:${FONT};font-size:17px;line-height:1.3;color:${DARK};">${content}</h2>`;
 const button=(href,label,primary=true)=>`<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0 24px;"><tr><td style="border-radius:6px;background:${primary?DARK:'#ffffff'};${primary?'':`border:1px solid ${DARK};`}"><a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1.2;color:${primary?'#ffffff':DARK};text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a></td></tr></table>`;
 const itemHtml=item=>`<tr><td style="padding:0 0 18px;">`
  +`<p style="margin:0 0 2px;font-size:12px;line-height:1.4;letter-spacing:.06em;text-transform:uppercase;color:${MUTED};">${escapeHtml(item.label)}</p>`
  +`<p style="margin:0;font-size:15px;line-height:1.45;font-weight:700;color:${INK};">${es(item.title)}</p>`
  +(item.venue?`<p style="margin:2px 0 0;font-size:14px;line-height:1.45;color:#46543f;">${item.prefix?escapeHtml(item.prefix)+' ':''}${item.venueIsSpanish?es(item.venue):escapeHtml(item.venue)}</p>`:'')
  +(item.status?`<p style="margin:4px 0 0;font-size:14px;line-height:1.45;color:${INK};">${escapeHtml(item.status)}</p>`:'')
  +(item.formUrl?`<p style="margin:6px 0 0;font-size:14px;line-height:1.45;"><a href="${escapeHtml(item.formUrl)}" style="color:${DARK};font-weight:700;text-decoration:underline;">${escapeHtml(row('formLink'))} &rarr;</a></p>`:'')
  +`</td></tr>`;
 const dayHtml=day=>`<tr><td style="padding:8px 0 10px;font-size:15px;line-height:1.3;font-weight:700;color:${DARK};">${escapeHtml(day.label)}</td></tr>${day.items.map(itemHtml).join('')}`;
 const body=[
  p(escapeHtml(greeting)),p(escapeHtml(row('intro'))),
  ...(needsForms?[`<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;"><tr><td style="padding:16px 18px;background:#eef6ec;border-radius:6px;">`
   +`<p style="margin:0 0 6px;font-size:15px;line-height:1.4;font-weight:700;color:${DARK};">${escapeHtml(row('formTitle'))}</p>`
   +`<p style="margin:0;font-size:14px;line-height:1.55;color:${INK};">${escapeHtml(row('formReminder'))}</p></td></tr></table>`]:[]),
  h2(escapeHtml(row('activities'))),...(lang==='es'?[]:[p(escapeHtml(row('spanishTitles')),`font-size:13px;color:${MUTED};margin-bottom:12px;`)]),
  `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 12px;font-family:${FONT};">${days.map(dayHtml).join('')}</table>`,
  ...(needsForms?[]:[p(`${escapeHtml(row('formGeneral'))} <a href="${escapeHtml(workshopsUrl)}" style="color:${DARK};font-weight:700;">${escapeHtml(row('formGeneralLink'))}</a>`,'font-size:14px;margin-bottom:24px;')]),
  ...(calendarUrl?[h2(escapeHtml(row('calendarTitle'))),p(escapeHtml(row('calendarText')),'margin-bottom:8px;'),button(calendarUrl,row('calendarLink'),false)]:[]),
  h2(escapeHtml(row('manageTitle'))),p(escapeHtml(row('manageText')),'margin-bottom:8px;'),button(registrationUrl,row('manageLink')),
  p(`${escapeHtml(row('programmeNote'))} <a href="${escapeHtml(programmeUrl)}" style="color:${DARK};font-weight:700;">${escapeHtml(row('programmeLink'))}</a>`,`font-size:14px;color:#46543f;`),
  ...(contact?[p(escapeHtml(row('questions')).replace('{contact}',()=>`<a href="mailto:${escapeHtml(contact)}" style="color:${DARK};">${escapeHtml(contact)}</a>`),'font-size:14px;margin:0;')]:[]),
 ].join('\n');
 const html=`<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F2ECEC;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F2ECEC;">${escapeHtml(row(needsForms?'preheader':'preheaderNoForms'))}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F2ECEC;"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border-radius:8px;font-family:${FONT};">
<tr><td style="padding:24px 32px 22px;background:${DARK};border-radius:8px 8px 0 0;">
<p style="margin:0 0 8px;font-size:12px;line-height:1.4;letter-spacing:.12em;text-transform:uppercase;color:#ADDEA8;">NODAL · ${escapeHtml(event.title)} · ${escapeHtml(row('dates'))}</p>
<h1 style="margin:0;font-family:${FONT};font-size:24px;line-height:1.25;font-weight:700;color:#ffffff;">${escapeHtml(row('heading'))}</h1>
</td></tr>
<tr><td style="height:4px;line-height:4px;font-size:4px;background:#59BC53;">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 28px;font-family:${FONT};">
${body}
</td></tr>
</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;"><tr><td style="padding:16px 32px 0;font-family:${FONT};font-size:12px;line-height:1.5;color:#6e7a69;">
${escapeHtml(row('footer'))} <a href="${escapeHtml(privacyUrl)}" style="color:#6e7a69;">${escapeHtml(row('privacy'))}</a>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
 return {subject,html,text};
}

/* The sender the API calls on a first registration: async ({registration, config, language}) → {status, sentAt?},
   never throwing. 'sent' once the provider accepted the message; 'failed' when it cannot have it (a refusal, an
   unreachable server, a timeout before the message was handed over), so a later retry cannot duplicate it;
   'uncertain' when the whole message went out without a final answer; 'skipped' for reserved test domains.
   null (the feature is off) without EMAIL_SMTP_URL/EMAIL_FROM or a configured public origin, or when a local
   server (loopbackOnly) is pointed at anything but a loopback mail catcher. log receives one line without addresses. */
export function createRegistrationConfirmation({env=process.env,transport,origin=emailOrigin(env),loopbackOnly=false,log=message=>console.warn(message)}={}){
 if(transport===undefined){try{transport=createMailTransport({env});}catch(err){log(`FIIU confirmation email is off: ${err.message}`);return null;}}
 if(!transport)return null;
 if(loopbackOnly&&!transport.loopback){log('FIIU confirmation email is off: a local SQLite server only sends to a loopback mail catcher');return null;}
 if(!origin){log('FIIU confirmation email is off: PUBLIC_BASE_URL is not configured');return null;}
 return async function confirm({registration,config,language}){
  if(isReservedRecipient(registration.email))return {status:'skipped'};
  let message;
  try{message=registrationEmail({registration,config,language,origin});}
  catch{log(`FIIU confirmation email failed for registration ${registration.id} (template)`);return {status:'failed'};}
  try{await transport.send({to:registration.email,...message,language:emailLanguage(language)});return {status:'sent',sentAt:new Date().toISOString()};}
  catch(err){
   const status=err?.delivery==='no'?'failed':'uncertain';
   log(`FIIU confirmation email ${status} for registration ${registration.id}${err?.stage?` at ${err.stage}`:''}${Number.isInteger(err?.status)?` (SMTP ${err.status})`:''}`);
   return {status};
  }
 };
}
