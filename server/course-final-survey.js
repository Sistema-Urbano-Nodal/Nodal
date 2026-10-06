import {newId, identifier, decodeAttachment} from './courses-domain.js';

/* The final survey and certificates of one course, Curso Movilidad Nivel 2 (docs/implementation/course-final-survey.md).
   It is not a survey builder: the approved Spanish wording lives here once, the server validates against it, the
   organiser CSVs take their headers and labels from it, and GET /api/courses/:id hands it to the page, which renders
   it as content (never through the interface translations). The course and the clock are injectable, so tests never
   depend on the real date. The form closes at the end of 23 October 2026 in Lima (UTC-05:00 all year, no DST). */
export const FINAL_SURVEY = Object.freeze({
  courseId:'72e3cc56-a506-4a1b-97b5-9333e8d283ca',
  closesAt:'2026-10-24T05:00:00Z',
  contactEmail:'observatorio@limacomovamos.org',
  certificateFilename:'certificado-curso-movilidad-nivel-2.pdf',
});
const LIMA_OFFSET_MS=5*60*60*1000;
// 'YYYY-MM-DD HH:MM' in Lima, for the organiser CSVs.
export const limaTime = iso => iso ? new Date(Date.parse(iso)-LIMA_OFFSET_MS).toISOString().slice(0,16).replace('T',' ') : '';
// The last civil day the form is open, in Lima: 2026-10-23 for the close at 2026-10-24T05:00:00Z.
const lastDayOf = closesAt => new Date(Date.parse(closesAt)-LIMA_OFFSET_MS-1).toISOString().slice(0,10);
// A certificate upload still 'pending' this recently may yet land in Storage, so account erasure waits for it.
export const CERTIFICATE_UPLOAD_GRACE_MS=15*60*1000;

const deepFreeze = value => { if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value);}return value; };
const options = list => list.map(([id,label]) => ({id,label}));
const EXPERIENCE = options([['deficiente','Deficiente'],['regular','Regular'],['buena','Buena'],['muy_buena','Muy buena'],['excelente','Excelente']]);
const SATISFACTION = options([['muy_insatisfecho','Muy insatisfecho/a'],['insatisfecho','Insatisfecho/a'],['neutral','Neutral'],['satisfecho','Satisfecho/a'],['muy_satisfecho','Muy satisfecho/a'],['no_aplica','No aplica o no participé']]);
/* The approved survey, exactly as worded. Question shapes, for the page:
   - single: one of `options` (radio); grid: one answer per row, each row with its own `options` (Q3 and Q4);
   - multi: up to `max` of `options` (checkboxes), `shuffle` asks for a random order with the `other` option last;
   - text: `maxLength`, `multiline` for a textarea; integer: `min`..`max`; select: one of `options` (a list);
   - `other: {option, field, maxLength}`: choosing that option requires a text answer under the key `field`;
   - Q1 alone is `screen: 1`; Q12 is required only when Q11 has text (`requiredWith`), and its option with
     `publishAs: true` is shown followed by the snapshot's publishAs, the exact name that would be published.
   `help` and `note` texts belong to the approved content too. Section titles are shown as '<id> · <title>'. */
export const SURVEY = deepFreeze({
  intro:'Gracias por participar en el Curso Movilidad Urbana Sostenible – Nivel 02. Esta encuesta toma unos 5 minutos. Al enviarla se habilita tu certificado. Lo que respondas no cambia tu certificado: solo nos ayuda a mejorar. Tus respuestas quedan asociadas a tu cuenta. Solo el equipo de NODAL las ve de forma individual; las y los docentes reciben resultados agrupados. Puedes responderla hasta el 23 de octubre.',
  sections:[
    {id:'A',title:'Experiencia general',questions:[
      {id:'overall',number:1,type:'single',required:true,screen:1,label:'En general, ¿cómo calificarías tu experiencia con el curso?',options:EXPERIENCE},
      {id:'overallWithoutSchedule',number:2,type:'single',required:true,screen:2,label:'Ahora, dejando de lado la confusión de horarios y fechas del inicio del curso, ¿cómo calificarías tu experiencia con el curso?',options:EXPERIENCE},
    ]},
    {id:'B',title:'El curso',questions:[
      {id:'aspects',number:3,type:'grid',required:true,screen:2,label:'Califica los siguientes aspectos del curso.',rows:[
        ['content','Contenido de las sesiones'],['teachers','Claridad de las y los docentes'],['fieldwork','Ejercicio práctico (observación en campo y registro fotográfico)'],
        ['schedule','Comunicación de fechas y horarios'],['access','Avisos y enlaces para entrar a las sesiones'],['materials','Facilidad para encontrar materiales y grabaciones en NODAL'],
        ['value','Relación calidad-precio'],
      ].map(([id,label])=>({id,label,options:SATISFACTION}))},
      {id:'pace',number:4,type:'grid',required:true,screen:2,label:'¿Cómo te parecieron…?',rows:[
        {id:'difficulty',label:'Nivel de dificultad',options:options([['demasiado_basico','Demasiado básico'],['algo_basico','Algo básico'],['adecuado','Adecuado'],['algo_avanzado','Algo avanzado'],['demasiado_avanzado','Demasiado avanzado']])},
        {id:'sessions',label:'Número de sesiones',options:options([['insuficiente','Insuficiente'],['adecuado','Adecuado'],['excesivo','Excesivo']])},
        {id:'sessionLength',label:'Duración de cada sesión',options:options([['demasiado_corta','Demasiado corta'],['adecuada','Adecuada'],['demasiado_larga','Demasiado larga']])},
      ]},
      {id:'application',number:5,type:'single',required:true,screen:2,label:'¿Qué tanto crees que podrás aplicar lo aprendido en tu trabajo, tus estudios o tu territorio?',options:options([['nada','Nada'],['poco','Poco'],['algo','Algo'],['bastante','Bastante'],['mucho','Mucho']])},
      {id:'mostUseful',number:6,type:'text',required:false,screen:2,multiline:false,maxLength:300,label:'¿Qué fue lo más útil del curso para ti?'},
      {id:'improvements',number:7,type:'text',required:false,screen:2,multiline:true,maxLength:3000,label:'¿Qué mejorarías para una próxima edición?',help:'Por ejemplo: contenido, metodología, ejercicio práctico, organización.'},
    ]},
    {id:'C',title:'Próximos cursos (opcional)',questions:[
      {id:'topics',number:8,type:'multi',required:false,screen:2,max:3,shuffle:true,label:'¿Qué temas te gustaría que NODAL ofrezca en próximos cursos?',help:'Elige hasta 3.',
        other:{option:'other',field:'topicsOther',maxLength:160},
        options:options([['movilidad_avanzado','Movilidad urbana sostenible – Nivel avanzado'],['transporte_publico','Transporte público'],['seguridad_vial','Seguridad vial'],['modos_activos','Modos activos o no motorizados'],['espacio_publico','Espacio público y diseño urbano'],['participacion_ciudadana','Participación ciudadana'],['vivienda','Vivienda y desarrollo urbano inclusivo'],['planificacion','Planificación urbana y ordenamiento territorial'],['cambio_climatico','Cambio climático y ciudades resilientes'],['economia_urbana','Economía urbana y desarrollo local'],['innovacion_social','Innovación social'],['other','Otro (¿cuál?)']])},
      {id:'format',number:9,type:'single',required:false,screen:2,label:'¿Qué formato prefieres para tus próximos cursos?',options:options([['sincronico','Sincrónico (en vivo)'],['asincronico','Asincrónico (grabado, a tu ritmo)'],['hibrido','Híbrido (grabaciones + sesiones en vivo)'],['sin_preferencia','Sin preferencia']])},
      {id:'valued',number:10,type:'multi',required:false,screen:2,max:2,label:'¿Qué te sería más valioso de NODAL?',help:'Elige hasta 2.',options:options([['conocimiento','Conocimiento (cursos, materiales, metodologías)'],['recursos','Recursos (herramientas, guías, datos, asesoría)'],['redes','Redes (conexiones con profesionales, gobiernos, universidades)'],['oportunidades','Oportunidades (becas, convocatorias, mentorías, visibilidad)']])},
    ]},
    {id:'D',title:'Testimonio (opcional)',questions:[
      {id:'testimonial',number:11,type:'text',required:false,screen:2,multiline:true,maxLength:2000,label:'¿Quieres dejarnos un mensaje sobre el curso que podamos compartir?',help:'No es necesario para tu certificado.'},
      {id:'testimonialConsent',number:12,type:'single',required:false,requiredWith:'testimonial',screen:2,label:'¿Podemos publicar tu mensaje en la web y redes de NODAL / Sistema Urbano?',
        note:'Podemos acortarlo o corregir la ortografía sin cambiar su sentido. Si cambias de opinión, escríbenos a observatorio@limacomovamos.org y lo retiramos.',
        options:[{id:'named',label:'Sí, como:',publishAs:true},{id:'anonymous',label:'Sí, de forma anónima'},{id:'team',label:'No, es solo para el equipo'}]},
    ]},
    {id:'E',title:'Sobre ti',questions:[
      {id:'gender',number:13,type:'single',required:true,screen:2,label:'Género',options:options([['female','Mujer'],['male','Hombre'],['other','Otro'],['prefer_not','Prefiero no responder']])},
      {id:'age',number:14,type:'integer',required:true,screen:2,min:1,max:120,label:'Edad'},
      {id:'country',number:15,type:'select',required:true,screen:2,label:'País de residencia',other:{option:'other',field:'countryOther',maxLength:120},
        options:options([['PE','Perú'],['AR','Argentina'],['BO','Bolivia'],['BR','Brasil'],['CL','Chile'],['CO','Colombia'],['CR','Costa Rica'],['CU','Cuba'],['EC','Ecuador'],['SV','El Salvador'],['GT','Guatemala'],['HN','Honduras'],['MX','México'],['NI','Nicaragua'],['PA','Panamá'],['PY','Paraguay'],['PR','Puerto Rico'],['DO','República Dominicana'],['UY','Uruguay'],['VE','Venezuela'],['ES','España'],['US','Estados Unidos'],['other','Otro (¿cuál?)']])},
    ]},
  ],
});
const QUESTIONS=Object.fromEntries(SURVEY.sections.flatMap(section=>section.questions).map(question=>[question.id,question]));

/* Refusals carry a stable code for the page (and the field id of an invalid answer, never its value). Messages are
   fixed English: nothing a person wrote, their name or their email reaches an error, a response or a log line. */
const refuse = (status,code,message,field) => { throw Object.assign(new Error(message),{status,code,field,refusal:true}); };
const invalid = field => refuse(400,'survey_invalid','invalid survey answer',field);
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
// Own keys only, so '__proto__' or 'constructor' can never stand in for an answer.
const own = (object,key) => plain(object) && Object.hasOwn(object,key) ? object[key] : undefined;
const blank = value => value === undefined || value === null || value === '';
function pick(value,list,field,required=true) {
  if(blank(value)&&!required)return '';
  if(typeof value!=='string'||!list.some(option=>option.id===value))invalid(field);
  return value;
}
function words(value,field,max) {
  if(value===undefined||value===null)return '';
  // PostgreSQL cannot store U+0000 in jsonb.
  if(typeof value!=='string'||value.includes('\u0000'))invalid(field);
  const clean=value.trim();if(clean.length>max)invalid(field);
  return clean;
}
function several(value,list,max,field) {
  if(value===undefined||value===null)return [];
  if(!Array.isArray(value)||value.some(id=>typeof id!=='string'||!list.some(option=>option.id===id)))invalid(field);
  const chosen=new Set(value);if(chosen.size>max)invalid(field);
  return list.filter(option=>chosen.has(option.id)).map(option=>option.id);
}
const grid = (value,question) => { if(!plain(value))invalid(question.id);return Object.fromEntries(question.rows.map(row=>[row.id,pick(own(value,row.id),row.options,question.id)])); };
const withOther = (chosen,input,question) => chosen ? (words(own(input,question.other.field),question.id,question.other.maxLength)||invalid(question.id)) : '';

export function normalizeSurveyStart(input) { return {overall:pick(own(input,'overall'),QUESTIONS.overall.options,'overall')}; }
/* The complete screen-2 answers, rebuilt from known keys only (anything else is dropped). Q1 is never taken from
   here: it was stored by the start route and is locked. `publishAs` is the name the person was shown in Q12. */
export function normalizeSurveyAnswers(input,{publishAs=''}={}) {
  if(!plain(input))invalid('answers');
  // Checked in question order, so a refusal names the first invalid question.
  const value=key=>own(input,key),q=QUESTIONS,answers={};
  answers.overallWithoutSchedule=pick(value('overallWithoutSchedule'),q.overallWithoutSchedule.options,'overallWithoutSchedule');
  answers.aspects=grid(value('aspects'),q.aspects);answers.pace=grid(value('pace'),q.pace);
  answers.application=pick(value('application'),q.application.options,'application');
  answers.mostUseful=words(value('mostUseful'),'mostUseful',q.mostUseful.maxLength);answers.improvements=words(value('improvements'),'improvements',q.improvements.maxLength);
  answers.topics=several(value('topics'),q.topics.options,q.topics.max,'topics');answers.topicsOther=withOther(answers.topics.includes('other'),input,q.topics);
  answers.format=pick(value('format'),q.format.options,'format',false);
  answers.valued=several(value('valued'),q.valued.options,q.valued.max,'valued');
  answers.testimonial=words(value('testimonial'),'testimonial',q.testimonial.maxLength);
  answers.testimonialConsent=answers.testimonial?pick(value('testimonialConsent'),q.testimonialConsent.options,'testimonialConsent'):'';
  // Consent to be named needs a name to publish under.
  if(answers.testimonialConsent==='named'&&!publishAs)invalid('testimonialConsent');
  answers.testimonialName=answers.testimonialConsent==='named'?publishAs:'';
  answers.gender=pick(value('gender'),q.gender.options,'gender');
  answers.age=value('age');if(!Number.isInteger(answers.age)||answers.age<q.age.min||answers.age>q.age.max)invalid('age');
  answers.country=pick(value('country'),q.country.options,'country');answers.countryOther=withOther(answers.country==='other',input,q.country);
  return answers;
}
/* The name Q12 offers to publish under: the course form's full name and profession, or without a course form the
   profile's own full name (never a name derived from the email address), without a profession. */
export function publishName(intake,profileName='') {
  const clean=value=>typeof value==='string'?value.trim():'';
  return clean(intake?.fullName)?[clean(intake.fullName),clean(intake.profession)].filter(Boolean).join(', '):clean(profileName);
}

const label = (question,id) => question.options.find(option=>option.id===id)?.label ?? '';
const score = (question,id) => { const index=question.options.findIndex(option=>option.id===id);return index<0?'':index+1; };
const RESPONSE_COLUMNS=[
  [`P1 ${QUESTIONS.overall.label}`,a=>label(QUESTIONS.overall,a.overall)],['P1 (1-5)',a=>score(QUESTIONS.overall,a.overall)],
  [`P2 ${QUESTIONS.overallWithoutSchedule.label}`,a=>label(QUESTIONS.overallWithoutSchedule,a.overallWithoutSchedule)],['P2 (1-5)',a=>score(QUESTIONS.overallWithoutSchedule,a.overallWithoutSchedule)],
  ...['aspects','pace'].flatMap(id=>QUESTIONS[id].rows.map(row=>[`P${QUESTIONS[id].number} ${row.label}`,a=>label(row,a[id]?.[row.id])])),
  [`P5 ${QUESTIONS.application.label}`,a=>label(QUESTIONS.application,a.application)],['P5 (1-5)',a=>score(QUESTIONS.application,a.application)],
  [`P6 ${QUESTIONS.mostUseful.label}`,a=>a.mostUseful],[`P7 ${QUESTIONS.improvements.label}`,a=>a.improvements],
  [`P8 ${QUESTIONS.topics.label}`,a=>(a.topics??[]).map(id=>label(QUESTIONS.topics,id)).join('; ')],['P8 Otro tema',a=>a.topicsOther],
  [`P9 ${QUESTIONS.format.label}`,a=>label(QUESTIONS.format,a.format)],
  [`P10 ${QUESTIONS.valued.label}`,a=>(a.valued??[]).map(id=>label(QUESTIONS.valued,id)).join('; ')],
  [`P11 ${QUESTIONS.testimonial.label}`,a=>a.testimonial],
  [`P12 ${QUESTIONS.testimonialConsent.label}`,a=>label(QUESTIONS.testimonialConsent,a.testimonialConsent)],['P12 Publicar como',a=>a.testimonialName],
  ['P13 Género',a=>label(QUESTIONS.gender,a.gender)],['P14 Edad',a=>a.age],['P15 País de residencia',a=>label(QUESTIONS.country,a.country)],['P15 Otro país',a=>a.countryOther],
];
// Rows for csv(): one per submitted response of a participant, oldest first, with the Spanish option labels.
export const surveyResponsesCsv = people => [
  ['Nombre','Correo','Enviada (hora de Lima)',...RESPONSE_COLUMNS.map(([header])=>header)],
  ...people.filter(p=>p.response?.submittedAt).sort((a,b)=>a.response.submittedAt.localeCompare(b.response.submittedAt))
    .map(p=>[p.name,p.email,limaTime(p.response.submittedAt),...RESPONSE_COLUMNS.map(([,read])=>read(p.response.answers??{}))]),
];
const surveyStatus = p => p.response?.submittedAt ? 'Respondió' : p.response ? 'Empezó (solo pregunta 1)' : 'Todavía no';
// The reminder list: every participant, with the name typed in the course form (certificates are printed from it).
export const surveyStatusCsv = people => [
  ['Nombre','Nombre en el formulario del curso','Correo','Encuesta','Fecha de respuesta (hora de Lima)','Certificado subido'],
  ...people.map(p=>[p.name,p.formName,p.email,surveyStatus(p),limaTime(p.response?.submittedAt),p.certificate?'sí':'no']),
];

/* The organiser's copy carries the person's profile name, so two downloads never share a file name; the participant's
   own copy keeps the fixed one. ASCII only (accents dropped), so the header needs no escaping; no email, ever. */
const slug = value => String(value??'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60).replace(/^-+|-+$/g,'');
const personalFilename = (filename,name,userId) => filename.replace(/\.pdf$/,'')+'-'+(slug(name)||userId.slice(0,8))+'.pdf';

export function createFinalSurvey({store,send,bodyJson,findOne,all,membersForRows,downloads,isStaff,sendCsv,config=FINAL_SURVEY,clock=Date.now,log=console.error}) {
  const surveyCourse=config.courseId.toLowerCase(),closes=Date.parse(config.closesAt),lastDay=lastDayOf(config.closesAt);
  const isOpen=()=>clock()<closes,stamp=()=>new Date(clock()).toISOString();
  const errorText=error=>error instanceof Error?error.message:String(error??'unknown error');
  const base=()=>({closesAt:config.closesAt,lastDay,open:isOpen(),contactEmail:config.contactEmail});
  async function publishAsFor(user,access) {
    return access.intake?publishName(access.intake):publishName(null,(await store.getMembers([user.id]))[0]?.name);
  }
  /* What a participant sees. Q1's value is never sent back: screen 2 says only that the first answer was saved.
     The survey itself travels only while it can still be answered. */
  async function participantState(user,access,row,ready) {
    const state=base(),submitted=Boolean(row?.submittedAt),answering=state.open&&!submitted;
    return {...state,preview:false,response:row?{startedAt:row.createdAt,submittedAt:row.submittedAt??null}:null,
      certificate:submitted?(ready?'ready':'preparing'):null,publishAs:answering?await publishAsFor(user,access):'',...(answering?{survey:SURVEY}:{})};
  }
  /* GET /api/courses/:id adds this for the survey course only. Administrators are organisers: they get a read-only
     preview (the closed state after the deadline) and never the form. Members who are not enrolled get nothing. */
  async function snapshot({courseId,user,access}) {
    if(courseId!==surveyCourse)return null;
    if(isStaff(user)){const state=base();return {...state,preview:true,response:null,certificate:null,publishAs:state.open?publishName(access.intake,user.fullName):'',...(state.open?{survey:SURVEY}:{})};}
    if(!access.enrollment)return null;
    const [row,ready]=await Promise.all([findOne('surveys',{courseId,userId:user.id}),findOne('certificates',{courseId,userId:user.id,status:'ready'})]);
    return participantState(user,access,row,ready);
  }
  // Enrolled people who are not administrators, with their response, ready certificate and course-form name.
  async function roster(courseId,{forms=false}={}) {
    const [enrollments,responses,certificates,intakes]=await Promise.all([all('enrollments',{courseId}),all('surveys',{courseId}),all('certificates',{courseId,status:'ready'}),forms?all('intakes',{courseId}):[]]);
    const members=await membersForRows(enrollments),byUser=rows=>new Map(rows.map(row=>[row.userId,row]));
    const response=byUser(responses),certificate=byUser(certificates),intake=byUser(intakes);
    return enrollments.filter(e=>!members.get(e.userId)?.staff).map(e=>({userId:e.userId,name:members.get(e.userId)?.name??'',email:members.get(e.userId)?.email??'',enrolledAt:e.createdAt,
      formName:intake.get(e.userId)?.answers?.fullName??'',response:response.get(e.userId)??null,certificate:certificate.get(e.userId)??null}))
      .sort((a,b)=>a.name.localeCompare(b.name,'es')||a.email.localeCompare(b.email,'es'));
  }
  async function sendPdf(res,certificate,name=config.certificateFilename) {
    const bytes=await store.getCertificate(certificate);
    // The URL stays the same when an organiser replaces the file, so nothing is cached.
    send(res,200,bytes,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Length':String(bytes.length)});
  }
  // Best effort: a Storage failure keeps the row for scripts/reconcile-course-uploads.js and logs only its id.
  async function discard(certificate,status) {
    try { await store.deleteCertificate(certificate);await store.remove('certificates',{id:certificate.id,status}); }
    catch(error) { log('course certificate cleanup failed:',certificate.id,errorText(error)); }
  }
  // Best effort after a failed replacement. A unique conflict means the new certificate did become ready.
  async function restore(rows) {
    for(const old of rows) {
      try { await store.update('certificates',{id:old.id,status:'deleting'},{status:'ready'}); }
      catch(error) { if(error.status!==409)log('course certificate restore failed:',old.id,errorText(error)); }
    }
  }
  async function upload(req,res,courseId,userId) {
    const input=await bodyJson(req,4*1024*1024+4096);
    const [enrollment,member]=await Promise.all([findOne('enrollments',{courseId,userId}),store.getMembers([userId]).then(rows=>rows[0])]);
    if(!enrollment||!member||member.staff)refuse(404,'certificate_not_enrolled','this person is not a participant of this course');
    if(input.mime!=='application/pdf'||typeof input.data!=='string')refuse(400,'certificate_invalid','a PDF of up to 3 MB is required');
    let file;
    try { file=decodeAttachment({name:'certificado.pdf',mime:'application/pdf',data:input.data}); }
    catch(error) { if(!error.status||error.status>=500)throw error;refuse(error.status===413?413:400,'certificate_invalid','a PDF of up to 3 MB is required'); }
    const id=newId(),certificate={id,courseId,userId,size:file.size,storagePath:`certificates/${courseId}/${userId}/${id}.pdf`,status:'pending',createdAt:stamp()};
    await store.insert('certificates',certificate);
    // A failed response does not prove Storage rejected the object: the row stays 'pending' for reconciliation.
    await store.putCertificate(certificate,file.bytes);
    /* A replacement is a new row and a new object. The old one leaves 'ready' first, so the partial unique index
       (one ready certificate per person) only refuses a concurrent replacement, which then cleans up after itself. */
    const replaced=[];let ready=null;
    try {
      // Counted before its update, so a row whose update failed after the database applied it is put back too.
      for(const old of await all('certificates',{courseId,userId,status:'ready'})){replaced.push(old);if(!await store.update('certificates',{id:old.id,status:'ready'},{status:'deleting'}))replaced.pop();}
      try { ready=await store.update('certificates',{id,status:'pending'},{status:'ready'}); } catch(error) { if(error.status!==409)throw error; }
    } catch(error) {
      /* Any other failure (a timeout, a dropped connection, a 5xx) would leave the person without a ready certificate,
         and reconciliation removes 'deleting' rows at once: the old one goes back to 'ready' first. The new row stays
         'pending' for reconciliation, since its promotion may have landed after all. */
      await restore(replaced);throw error;
    }
    if(!ready)await discard(certificate,'pending');
    for(const old of replaced)await discard(old,'deleting');
    if(!ready)refuse(409,'certificate_changed','the certificate changed; reload and try again');
    send(res,201,{certificate:{userId,id,size:file.size,createdAt:certificate.createdAt},replaced:replaced.length>0});
  }
  async function route({req,res,url,user,access,courseId,suffix,adminPath}) {
    const method=req.method,certificatePath=adminPath?suffix.match(/^\/certificates\/([^/]+)$/):null,exportType=adminPath&&suffix==='/export'&&method==='GET'?url.searchParams.get('type'):null;
    // Member and organiser routes are claimed only on their own prefix, so a member path never reaches organiser data.
    const name=!adminPath?(suffix==='/survey/start'&&method==='PUT'?'start':suffix==='/survey'&&method==='POST'?'submit':suffix==='/certificate'&&method==='GET'?'download':null)
      :suffix==='/final-survey'&&method==='GET'?'status':['survey','survey-status'].includes(exportType)?exportType
        :certificatePath&&['GET','PUT','DELETE'].includes(method)?`certificate-${method}`:null;
    if(!name)return false;
    if(adminPath&&!isStaff(user))refuse(403,'admin_required','administrator access required');
    if(courseId!==surveyCourse)refuse(404,'survey_unavailable','survey unavailable');
    if(['start','submit'].includes(name)) {
      if(isStaff(user)||!access.enrollment)refuse(403,'survey_unavailable','the survey is for enrolled participants');
      if(!isOpen())refuse(403,'survey_closed','the survey is closed');
      const body=await bodyJson(req),filters={courseId,userId:user.id};
      if(name==='start') {
        const {overall}=normalizeSurveyStart(body);
        let row=await findOne('surveys',filters);
        if(!row) {
          const at=stamp();
          try { row=await store.insert('surveys',{id:newId(),...filters,answers:{overall},submittedAt:null,createdAt:at,updatedAt:at}); }
          catch(error) { if(error.status!==409)throw error;row=await findOne('surveys',filters);if(!row)throw error; }
        }
        if(row.submittedAt)refuse(409,'survey_submitted','the survey was already sent');
        // Answer 1 is locked once saved; the same answer again is a retry.
        if(row.answers?.overall!==overall)refuse(409,'survey_locked','the first answer is already saved');
        send(res,200,{finalSurvey:await participantState(user,access,row,null)});return true;
      }
      const row=await findOne('surveys',filters);
      if(!row)refuse(409,'survey_not_started','answer the first question first');
      if(row.submittedAt)refuse(409,'survey_submitted','the survey was already sent');
      const publishAs=await publishAsFor(user,access);
      const answers=normalizeSurveyAnswers(own(body,'answers'),{publishAs});
      // The stored name must be the one the person saw; a course-form edit in between changes it.
      if(answers.testimonialConsent==='named'&&own(body,'publishAs')!==publishAs)refuse(409,'survey_changed','the publication name changed');
      const at=stamp();
      const saved=await store.update('surveys',{id:row.id,...filters,submittedAt:null},{answers:{overall:row.answers.overall,...answers},submittedAt:at,updatedAt:at});
      if(!saved)refuse(409,'survey_submitted','the survey was already sent');
      send(res,200,{finalSurvey:await participantState(user,access,saved,await findOne('certificates',{...filters,status:'ready'}))});return true;
    }
    if(name==='download') {
      // Only the viewer's own file: there is no user parameter, and it needs their own submitted response.
      const filters={courseId,userId:user.id};
      const [row,certificate]=await Promise.all([findOne('surveys',filters),findOne('certificates',{...filters,status:'ready'})]);
      if(!row?.submittedAt||!certificate)refuse(404,'certificate_unavailable','certificate unavailable');
      const budget=isStaff(user)?{ok:true}:downloads.take(`download:${user.id}`,certificate.size);
      if(!budget.ok){send(res,429,{error:'download limit reached; try again later',code:'download_rate'},{'Retry-After':String(budget.retryAfter)});return true;}
      await sendPdf(res,certificate);return true;
    }
    if(name==='status') {
      const people=await roster(courseId),view=({response,certificate,formName,...person})=>({...person,startedAt:response?.createdAt??null,submittedAt:response?.submittedAt??null,certificate:certificate?{id:certificate.id,size:certificate.size,createdAt:certificate.createdAt}:null});
      send(res,200,{...base(),total:people.length,answered:people.filter(p=>p.response?.submittedAt).length,started:people.filter(p=>p.response&&!p.response.submittedAt).length,certificates:people.filter(p=>p.certificate).length,participants:people.map(view)});
      return true;
    }
    if(name==='survey'){sendCsv(res,'encuesta-final-respuestas',surveyResponsesCsv(await roster(courseId)));return true;}
    if(name==='survey-status'){sendCsv(res,'encuesta-final-estado',surveyStatusCsv(await roster(courseId,{forms:true})));return true;}
    const userId=identifier(certificatePath[1]);
    if(method==='PUT'){await upload(req,res,courseId,userId);return true;}
    const current=await findOne('certificates',{courseId,userId,status:'ready'});
    if(!current)refuse(404,'certificate_unavailable','certificate unavailable');
    if(method==='GET'){await sendPdf(res,current,personalFilename(config.certificateFilename,(await store.getMembers([userId]))[0]?.name,userId));return true;}
    if(!await store.update('certificates',{id:current.id,status:'ready'},{status:'deleting'}))refuse(409,'certificate_changed','the certificate changed; reload and try again');
    // A Storage failure answers 502 and leaves the row 'deleting': never downloadable, finished by reconciliation.
    await store.deleteCertificate(current);await store.remove('certificates',{id:current.id,status:'deleting'});
    send(res,200,{ok:true});return true;
  }
  async function handle(context) {
    try { return await route(context); }
    catch(error) {
      if(!error.refusal)throw error;
      send(context.res,error.status,{error:error.message,code:error.code,...(error.field?{field:error.field}:{})});return true;
    }
  }
  return {snapshot,handle};
}
