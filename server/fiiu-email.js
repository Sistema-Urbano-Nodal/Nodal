import {emailLetter,INK,COPY,MUTED,FOREST,LEAF,MINT} from './email-letter.js';
import {FIIU_EVENT} from './fiiu-domain.js';
import {createMailTransport,validAddress} from './mailer.js';

/* The FIIU registration summary, emailed after a person's first registration (server/fiiu-api.js; edits send nothing),
   in the language they registered in. It repeats only what they chose: conference blocks, the laboratory application and
   the closing party, the workshop and route interests with each Google Form, never the private answers (national ID, age, gender,
   accessibility, motivation, institution or role). Activity titles and venues stay in Spanish, as in the programme.
   The closing-party announcement (partyEmail) shares its letter. */
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
 party:['Closing party','Fiesta de cierre','Festa de encerramento'],
 // A start without an end (the party): "From 17:00".
 from:['From {time}','Desde las {time}','A partir das {time}'],
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
 signoff:['See you in Lima,','Nos vemos en Lima,','Nos vemos em Lima,'],team:['The NODAL team','El equipo de NODAL','Equipe NODAL'],
 footer:['You are receiving this email because you registered for FIIU Fest 11 with your NODAL account.','Recibes este correo porque te inscribiste en FIIU Fest 11 con tu cuenta de NODAL.','Você recebe este e-mail porque se inscreveu no FIIU Fest 11 com sua conta NODAL.'],
 privacy:['Privacy policy','Política de privacidad','Política de privacidade'],
 // The closing-party announcement (partyEmail): {title} is the party's title as the programme has it.
 partySubject:['Closing party: {title} · {event}','{title} · {event}','Festa de encerramento: {title} · {event}'],
 partyPreheader:['Add the closing party to your FIIU registration.','Agrega la fiesta de cierre a tu inscripción del FIIU.','Adicione a festa de encerramento à sua inscrição no FIIU.'],
 partyHeading:['Come to the closing party','Ven a la fiesta de cierre','Venha para a festa de encerramento'],
 partyIntro:['FIIU Fest 11 ends with a party, and you are invited. It is not in your registration yet: add it so the organisers know you are coming.','El FIIU Fest 11 cierra con una fiesta y te invitamos. Todavía no está en tu inscripción: agrégala para que el equipo organizador sepa que vienes.','O FIIU Fest 11 termina com uma festa, e queremos você lá. Ela ainda não está na sua inscrição: adicione-a para que a equipe organizadora saiba que você vem.'],
 partyNote:['Adding it takes a moment and helps the organisers plan. The party has no check-in and does not add certificate hours.','Agregarla toma un momento y ayuda al equipo organizador a prepararla. La fiesta no tiene registro de asistencia ni suma horas al certificado.','Adicioná-la leva um instante e ajuda a equipe organizadora a se preparar. A festa não tem registro de presença nem soma horas ao certificado.'],
 partyAdd:['Add it to my registration','Añadir a mi inscripción','Adicionar à minha inscrição'],
 partyFooter:['You are receiving this one-off email because you registered for FIIU Fest 11 with your NODAL account.','Recibes este correo único porque te inscribiste en FIIU Fest 11 con tu cuenta de NODAL.','Você recebe este e-mail único porque se inscreveu no FIIU Fest 11 com sua conta NODAL.'],
};
const LOCALES={en:'en-GB',es:'es-PE',pt:'pt-BR'};
/* Recipients on the reserved test and example domains are never emailed: the .test, .example, .invalid and .localhost
   TLDs and the example.com, example.net and example.org second-level domains (RFC 2606, RFC 6761), with any
   subdomain. The example domains publish a null MX, so a message to them only bounces against the sender. */
export function isReservedRecipient(email){const domain=String(email??'').split('@').pop().toLowerCase().replace(/\.$/,'');return /(?:^|\.)(?:test|example|invalid|localhost|example\.(?:com|net|org))$/.test(domain);}
export const emailLanguage=value=>EMAIL_LANGUAGES.includes(value)?value:'es';
// A first name made safe for any context it lands in: control characters (CR/LF included) and line breaks become
// spaces, and invisible format characters (bidi overrides among them) are dropped, except the joiners and emoji tags that
// spell names and emoji (ZWNJ, ZWJ, U+E0020–E007F); single spaces, at most `max` characters (100 for a first name; pass Infinity for a field validated elsewhere), never half of one. A name
// with nothing visible left is empty, so the plain greeting is used.
export const safeName=(value,max=100)=>{
 const name=[...String(value??'').replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu,' ').replace(/(?![\u200C\u200D\u{E0020}-\u{E007F}])\p{Cf}/gu,'').replace(/\s+/g,' ').trim()].slice(0,max).join('');
 return /[^\p{Cf}\s]/u.test(name)?name:'';
};
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
const PERIODS=['lab','morning','evening','workshop','route','party'];
const rank=activity=>{const i=PERIODS.indexOf(activity.period);return i<0?PERIODS.length:i;};
// The same order as the festival page: by day, then lab, morning, evening, workshops, routes, the party, then start time.
const chronological=list=>[...list].sort((a,b)=>a.date.localeCompare(b.date)||rank(a)-rank(b)||(a.time||'').localeCompare(b.time||''));
const cap=(text,locale)=>text?text.charAt(0).toLocaleUpperCase(locale)+text.slice(1):text;
const longDate=(value,lang)=>cap(new Intl.DateTimeFormat(LOCALES[lang],{weekday:'long',day:'numeric',month:'long',timeZone:FIIU_EVENT.timeZone}).format(new Date(`${value}T12:00:00-05:00`)),LOCALES[lang]);

// What the person chose, in programme order, from the current catalogue only (unknown and legacy ids are skipped).
// The conference blocks and the party are both ticked in answers.activities.
function chosenItems(registration,event){
 const a=registration.answers??{},ticked=new Set(Array.isArray(a.activities)?a.activities:[]),interests=new Set(Array.isArray(a.externalActivities)?a.externalActivities:[]);
 const lab=a.applyLab===true||['pending','accepted','declined'].includes(registration.labStatus);
 return chronological(event.activities.filter(activity=>['general','social'].includes(activity.registration)?ticked.has(activity.id):activity.registration==='application'?lab:activity.registration==='external'&&interests.has(activity.id)));
}
// A block's time as the email shows it: a range as it is, a start alone as "From 17:00".
export const timeLabel=(time,row)=>time&&!/[–-]/.test(time)?row('from').replace('{time}',()=>time):time||'';
function itemView(activity,registration,row){
 const kind=activity.registration==='general'?'conference':activity.registration==='application'?'lab':activity.registration==='social'?'party':activity.period==='route'?'route':'workshop';
 const status=kind==='lab'?row({pending:'labPending',accepted:'labAccepted',declined:'labDeclined'}[registration.labStatus]||'labPending'):'';
 // Conference blocks always say where (or that the venue is not confirmed yet); the laboratory leaves an unknown venue out, as the page does.
 const venue=activity.venue||(kind==='conference'?row('venuePending'):''),prefix=activity.venue&&kind==='route'?row('startingPoint'):'';
 return {kind,label:[timeLabel(activity.time,row),row(kind)].filter(Boolean).join(' · '),title:activity.title,venue,prefix,venueIsSpanish:Boolean(activity.venue),status,formUrl:['workshop','route'].includes(kind)?httpsLink(activity.formUrl):''};
}

/* The email is a letter from the NODAL team on the festival's beige paper, in the site's own voice: the NODAL lockup and
   the FIIU date plate (20–25, month, Lima, Perú) as a letterhead, plain prose with the Google Form step marked by the
   landing page's mint highlighter, the itinerary as a plan sheet with a time rail and no rules, the landing's
   press-plate button and a sign-off. No boxes, bands, chips or dividing lines. Montserrat where the reader has it,
   tuned for Arial (no web font is loaded: the site self-hosts Montserrat and never calls Google). */
const festivalDate=(value,lang,options)=>new Intl.DateTimeFormat(LOCALES[lang],{...options,timeZone:FIIU_EVENT.timeZone}).format(new Date(`${value}T12:00:00-05:00`));

/* The letter's parts in one language, shared by the registration summary and the one-off notices (partyEmail).
   HTML: tables and inline styles on every element (bgcolor too, for Outlook), so Gmail, Outlook and Apple Mail draw
   the same letter; the two <style> blocks only add the phone layout and an Apple Mail dark palette (c-* classes).
   Titles and venues from the programme carry lang="es" when the email is in another language. Outlook for Windows
   reads mso-line-height-rule only when it comes before line-height; after it, a line height under the font's own
   (the date plate, the 4px press-plate cells) falls back to "at least" and grows. */
function letterKit(lang,origin,event){
 const i=EMAIL_LANGUAGES.indexOf(lang),row=key=>EMAIL_ROWS[key][i];
 const kit=emailLetter(lang,origin);
 const {e,type,p,lockup}=kit;
 /* The letterhead: the lockup on the left (its alt text set in large ink type, so the email still opens with NODAL when
    images are blocked; the light-on-dark version replaces it in dark mode) and the FIIU date plate on the right. The
    lockup is fixed and "20–25" cannot wrap, so the inline sizes (44px plate, 24px gutters: what a client that drops
    the <style> blocks shows) keep the letter within a 360px phone; the phone query narrows them to fit 320px and the
    wide query restores the full 52px plate and 32px gutters where there is room. */
 const [startDay,endDay]=[event.startsOn,event.endsOn].map(date=>festivalDate(date,lang,{day:'numeric'}));
 const letterhead=`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>`
  +`<td valign="top" style="padding:0;">${lockup}</td>`
  +`<td valign="top" align="right" style="padding:0 0 0 12px;text-align:right;">`
  +`<p class="c-ink" style="margin:0;${type(13,18,700,INK)}">${e(event.title)}</p>`
  +`<p class="c-ink num" style="margin:4px 0 0;${type(44,44,800,INK,'letter-spacing:-1px;white-space:nowrap;')}">${e(startDay)}<span style="color:${LEAF};font-weight:400;">&ndash;</span>${e(endDay)}</p>`
  +`<p class="c-ink" style="margin:6px 0 0;${type(13,18,700,INK)}">${e(festivalDate(event.startsOn,lang,{month:'long',year:'numeric'}))}</p>`
  +`<p class="c-forest" style="margin:0;${type(13,18,600,FOREST)}">${e(event.city)}</p>`
  +`</td></tr></table>`;

 // How every letter ends: the sign-off, who sends it, why the reader gets it (footerKey) and the privacy policy.
 const signature=footerKey=>[
  p(e(row('signoff')),{margin:'0'}),p(e(row('team')),{weight:700,color:INK,cls:'c-ink',margin:'0'}),
  p('NODAL &middot; Nodos Urbanos de Am&eacute;rica Latina',{size:12,lh:18,weight:700,color:MUTED,cls:'c-muted',margin:'48px 0 4px'}),
  p(`${e(row(footerKey))} <a class="c-muted" href="${e(`${origin}/privacy.html`)}" style="color:${MUTED};text-decoration:underline;">${e(row('privacy'))}</a>`,{size:12,lh:18,color:MUTED,cls:'c-muted',margin:'0'}),
 ];

 return {...kit,letterhead,signature};
}

/* {subject, html, text}. registration: the stored row (email, answers, labStatus); config: the festival settings
   (programUrl); origin: the public site origin for the links back to NODAL and the logo. */
export function registrationEmail({registration,config={},language,origin,event=FIIU_EVENT}){
 const lang=emailLanguage(language),i=EMAIL_LANGUAGES.indexOf(lang),row=key=>EMAIL_ROWS[key][i];
 const name=safeName(registration.answers?.firstName),greeting=name?row('greeting').replace('{name}',()=>name):row('greetingPlain');
 const items=chosenItems(registration,event).map(activity=>({date:activity.date,time:timeLabel(activity.time,row),...itemView(activity,registration,row)}));
 const days=[...new Set(items.map(item=>item.date))].map(date=>({date,label:longDate(date,lang),items:items.filter(item=>item.date===date)}));
 const needsForms=items.some(item=>item.formUrl);
 const registrationUrl=`${origin}/fiiu.html#registration`,privacyUrl=`${origin}/privacy.html`,workshopsUrl=`${origin}/fiiu.html#programme`;
 const programmeUrl=httpsLink(config.programUrl)||`${origin}/fiiu.html#programme`,calendarUrl=httpsLink(event.calendarUrl);
 const contact=validAddress(event.contact)?event.contact:'';
 const subject=row('subject');

 // Plain text: the same content and every URL written out, signed like the HTML letter.
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
  row('signoff'),row('team'),'',
  '--',row('footer'),`${row('privacy')}: ${privacyUrl}`,'',
 ].join('\n');

 const {e,f,type,es,p,a,runIn,pressPlate,outline,letterhead,signature,document}=letterKit(lang,origin,event);
 /* The itinerary as the FIIU page's plan sheet: day names in ink, then a time rail (time, then the kind of activity)
    beside the title and venue. On a phone the rail folds into one line above the title, joined by the hidden " · ". */
 const kind=(label,top)=>`<p class="c-forest" style="margin:${top}px 0 0;${type(12,17,600,FOREST)}">${e(label)}</p>`;
 const itemHtml=item=>`<tr><td class="rail" width="120" valign="top" style="width:120px;padding:0 16px 18px 0;">`
  +(item.time?`<p class="c-ink" style="margin:0;${type(14,21,700,INK,/\s/.test(item.time)?'':'white-space:nowrap;')}">${e(item.time)}</p><span class="sep c-muted" style="display:none;mso-hide:all;color:${MUTED};${f}font-size:12px;"> · </span>${kind(row(item.kind),0)}`:kind(row(item.kind),3))
  +`</td><td class="main" valign="top" style="padding:0 0 18px;">`
  +`<p class="c-ink" style="margin:0;${type(16,22,700,INK)}">${es(item.title)}</p>`
  +(item.venue?`<p class="c-muted" style="margin:2px 0 0;${type(14,21,400,MUTED)}">${item.prefix?`<span style="font-weight:600;">${e(item.prefix)}</span> `:''}${item.venueIsSpanish?es(item.venue):e(item.venue)}</p>`:'')
  +(item.status?`<p class="c-forest" style="margin:4px 0 0;${type(14,21,600,FOREST)}">${e(item.status)}</p>`:'')
  +(item.formUrl?`<p style="margin:6px 0 0;${type(14,21,700,FOREST)}">${a(item.formUrl,`${e(row('formLink'))}&nbsp;&rarr;`)}</p>`:'')
  +`</td></tr>`;
 const dayHtml=(day,n)=>`<tr><td colspan="2" style="padding:${n?28:16}px 0 12px;"><p class="c-ink" style="margin:0;${type(18,24,800,INK)}">${e(day.label)}</p></td></tr>${day.items.map(itemHtml).join('')}`;

 const body=[
  letterhead,
  `<h1 class="c-ink h1" style="margin:44px 0 20px;${type(32,38,800,INK,'letter-spacing:-0.5px;')}">${e(row('heading'))}</h1>`,
  p(e(greeting)),p(e(row('intro'))),
  // The one thing to act on, said as a sentence under the landing page's mint highlighter rather than boxed.
  ...(needsForms?[p(`<strong class="c-ink" style="font-weight:700;color:${INK};"><span class="hl" style="background-color:${MINT};color:${INK};padding:1px 4px;-webkit-box-decoration-break:clone;box-decoration-break:clone;">${e(row('formTitle'))}.</span></strong> ${e(row('formReminder'))}`)]:[]),
  `<h2 class="c-ink" style="margin:40px 0 ${lang==='es'?8:4}px;${type(22,28,800,INK)}">${e(row('activities'))}</h2>`,
  ...(lang==='es'?[]:[p(e(row('spanishTitles')),{size:13,lh:19,color:MUTED,cls:'c-muted',margin:'0 0 4px'})]),
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${days.map(dayHtml).join('')}</table>`,
  ...(needsForms?[]:[p(`${e(row('formGeneral'))} ${a(workshopsUrl,e(row('formGeneralLink')))}`,{size:15,lh:24,margin:'8px 0 0'})]),
  ...(calendarUrl?[p(runIn(row('calendarTitle'))+e(row('calendarText')),{margin:'36px 0 14px'}),outline(calendarUrl,row('calendarLink'))]:[]),
  p(runIn(row('manageTitle'))+e(row('manageText')),{margin:'32px 0 14px'}),pressPlate(registrationUrl,row('manageLink')),
  p(`${e(row('programmeNote'))} ${a(programmeUrl,e(row('programmeLink')))}`,{size:14,lh:22,color:MUTED,cls:'c-muted',margin:`40px 0 ${contact?16:28}px`}),
  ...(contact?[p(e(row('questions')).replace('{contact}',()=>a(`mailto:${contact}`,e(contact))),{size:14,lh:22,margin:'0 0 28px'})]:[]),
  ...signature('footer'),
 ].join('\n');
 return {subject,html:document({subject,preheader:row(needsForms?'preheader':'preheaderNoForms'),body}),text};
}

/* The closing-party announcement (server/fiiu-notices.js), sent once to registrants who have not added the party: the
   party as the programme has it (organisers' edits included), its day and start, session lines, venue and
   description, and a button that opens the registration with the party ticked. Same letter as the summary; it names
   nobody, so it carries no personal data. */
export function partyEmail({event=FIIU_EVENT,language,origin}){
 const lang=emailLanguage(language),i=EMAIL_LANGUAGES.indexOf(lang),row=key=>EMAIL_ROWS[key][i];
 const party=event.activities.find(activity=>activity.id==='closing-party');if(!party)throw new Error('the closing party is not in the programme');
 const when=[longDate(party.date,lang),timeLabel(party.time,row)].filter(Boolean).join(' · ');
 const sessions=Array.isArray(party.sessions)?party.sessions:[],description=String(party.description??'');
 const addUrl=`${origin}/fiiu.html#add-closing-party`,privacyUrl=`${origin}/privacy.html`,contact=validAddress(event.contact)?event.contact:'';
 const subject=row('partySubject').replace('{title}',()=>party.title).replace('{event}',()=>event.title);
 const text=[
  row('greetingPlain'),'',row('partyIntro'),'',
  party.title,when,...(party.venue?[party.venue]:[]),...(lang==='es'?[]:[row('spanishTitles')]),'',
  ...(sessions.length?[...sessions.map(([time,title])=>`- ${[time,title].filter(Boolean).join(' · ')}`),'']:[]),
  ...(description?[description,'']:[]),
  row('partyNote'),`${row('partyAdd')}: ${addUrl}`,'',
  ...(contact?[row('questions').replace('{contact}',()=>contact),'']:[]),
  row('signoff'),row('team'),'',
  '--',row('partyFooter'),`${row('privacy')}: ${privacyUrl}`,'',
 ].join('\n');
 const {e,type,es,p,a,pressPlate,letterhead,signature,document}=letterKit(lang,origin,event);
 // The session lines on the same time rail as the summary's itinerary; free-text times ("19:00 en adelante") may wrap.
 const sessionHtml=([time,title])=>`<tr><td class="rail" width="120" valign="top" style="width:120px;padding:0 16px 10px 0;"><p class="c-ink" style="margin:0;${type(14,21,700,INK)}">${es(time)}</p></td>`
  +`<td class="main" valign="top" style="padding:0 0 10px;"><p class="c-copy" style="margin:0;${type(16,22,400,COPY)}">${es(title)}</p></td></tr>`;
 const body=[
  letterhead,
  `<h1 class="c-ink h1" style="margin:44px 0 20px;${type(32,38,800,INK,'letter-spacing:-0.5px;')}">${e(row('partyHeading'))}</h1>`,
  p(e(row('greetingPlain'))),p(e(row('partyIntro'))),
  `<h2 class="c-ink" style="margin:36px 0 6px;${type(22,28,800,INK)}">${es(party.title)}</h2>`,
  p(e(when),{size:15,lh:22,weight:700,color:FOREST,cls:'c-forest',margin:'0 0 2px'}),
  ...(party.venue?[p(es(party.venue),{size:15,lh:22,color:MUTED,cls:'c-muted',margin:'0 0 4px'})]:[]),
  ...(lang==='es'?[]:[p(e(row('spanishTitles')),{size:13,lh:19,color:MUTED,cls:'c-muted',margin:'0 0 4px'})]),
  ...(sessions.length?[`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0;">${sessions.map(sessionHtml).join('')}</table>`]:[]),
  ...(description?[p(es(description).replace(/\n/g,'<br>'),{margin:'16px 0 0'})]:[]),
  p(e(row('partyNote')),{margin:'32px 0 14px'}),pressPlate(addUrl,row('partyAdd')),
  ...(contact?[p(e(row('questions')).replace('{contact}',()=>a(`mailto:${contact}`,e(contact))),{size:14,lh:22,margin:'40px 0 28px'})]:[]),
  ...signature('partyFooter'),
 ].join('\n');
 return {subject,html:document({subject,preheader:row('partyPreheader'),body}),text};
}

/* Whether a sender may run: {transport, origin}, or null (off) with one log line saying why. Off without
   EMAIL_SMTP_URL/EMAIL_FROM or a configured public origin, when a local server (loopbackOnly) is pointed at anything
   but a loopback mail catcher, or on any Vercel deployment other than Production: a Preview runs unreviewed branch
   code and may share the production database, so even if the mail credentials are scoped to it by mistake it never
   emails registrants. Shared by the summary and the notices. */
export function mailGate({env,transport,origin,loopbackOnly,log,label}){
 if(transport===undefined&&env.VERCEL&&env.VERCEL_ENV!=='production'){log(`${label} is off outside Vercel Production`);return null;}
 if(transport===undefined){try{transport=createMailTransport({env});}catch(err){log(`${label} is off: ${err.message}`);return null;}}
 if(!transport)return null;
 if(loopbackOnly&&!transport.loopback){log(`${label} is off: a local SQLite server only sends to a loopback mail catcher`);return null;}
 if(!origin){log(`${label} is off: PUBLIC_BASE_URL is not configured`);return null;}
 return {transport,origin};
}
/* One message to one registrant, never throwing: 'sent' once the provider accepted it; 'failed' when it cannot have it
   (a refusal, an unreachable server, a timeout before the message was handed over), so a later retry cannot duplicate
   it; 'uncertain' when the whole message went out without a final answer; 'skipped' for reserved test domains, and
   'failed' when the message cannot be built. log receives one line without addresses. */
async function deliver({transport,registration,language,build,log,label}){
 if(isReservedRecipient(registration.email))return {status:'skipped'};
 let message;
 try{message=build();}
 catch{log(`${label} failed for registration ${registration.id} (template)`);return {status:'failed'};}
 try{await transport.send({to:registration.email,...message,language:emailLanguage(language)});return {status:'sent',sentAt:new Date().toISOString()};}
 catch(err){
  const status=err?.delivery==='no'?'failed':'uncertain';
  // The transport's error code (ENOTFOUND, ECONNREFUSED, ERR_SSL_WRONG_VERSION_NUMBER…) tells a DNS typo from a wrong
  // port or a TLS mismatch in the logs; only a plain identifier is logged, never free text.
  const code=typeof err?.code==='string'&&/^[A-Z][A-Z0-9_]{1,40}$/.test(err.code)?` [${err.code}]`:'';
  log(`${label} ${status} for registration ${registration.id}${err?.stage?` at ${err.stage}`:''}${Number.isInteger(err?.status)?` (SMTP ${err.status})`:''}${code}`);
  return {status};
 }
}

// The sender the API calls on a first registration: async ({registration, config, language, event}) → {status, sentAt?}.
export function createRegistrationConfirmation({env=process.env,transport,origin=emailOrigin(env),loopbackOnly=false,log=message=>console.warn(message)}={}){
 const gate=mailGate({env,transport,origin,loopbackOnly,log,label:'FIIU confirmation email'});if(!gate)return null;
 return async function confirm({registration,config,language,event}){
  return deliver({transport:gate.transport,registration,language,log,label:'FIIU confirmation email',build:()=>registrationEmail({registration,config,language,origin:gate.origin,...(event?{event}:{})})});
 };
}
// The closing-party announcement's sender (server/fiiu-notices.js): async ({registration, event, language}) → {status, sentAt?}.
export function createPartyNotice({env=process.env,transport,origin=emailOrigin(env),loopbackOnly=false,log=message=>console.warn(message)}={}){
 const gate=mailGate({env,transport,origin,loopbackOnly,log,label:'FIIU party notice'});if(!gate)return null;
 return async function notify({registration,event,language}){
  return deliver({transport:gate.transport,registration,language,log,label:'FIIU party notice',build:()=>partyEmail({event,language,origin:gate.origin})});
 };
}
