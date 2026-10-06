import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser,toApiUser} from '../server/db.js';
import {createCourseStore} from '../server/courses-repository.js';
import {createCourseApi} from '../server/courses-api.js';
import {normalizeCourse} from '../server/courses-domain.js';
import {exportCourseData,deleteCourseData} from '../server/courses-privacy.js';
import {FINAL_SURVEY,SURVEY,normalizeSurveyStart,normalizeSurveyAnswers,publishName,limaTime} from '../server/course-final-survey.js';
import {reconcileCourseCertificates,reconcileCourseUploads} from '../scripts/reconcile-course-uploads.js';

// The real deadline, read from the module: every test sets the injected clock around it, never the real date.
const CLOSES=Date.parse(FINAL_SURVEY.closesAt),OPEN_AT=Date.parse('2026-10-10T15:00:00.000Z');
const INTRO='Gracias por participar en el Curso Movilidad Urbana Sostenible – Nivel 02. Esta encuesta toma unos 5 minutos. Al enviarla se habilita tu certificado. Lo que respondas no cambia tu certificado: solo nos ayuda a mejorar. Tus respuestas quedan asociadas a tu cuenta. Solo el equipo de NODAL las ve de forma individual; las y los docentes reciben resultados agrupados. Puedes responderla hasta el 23 de octubre.';
const pdf=text=>Buffer.from(`%PDF-1.4\n${text}\n%%EOF`);
const upload=bytes=>({mime:'application/pdf',data:bytes.toString('base64')});
const ANSWERS=Object.freeze({
 overallWithoutSchedule:'muy_buena',
 aspects:{content:'satisfecho',teachers:'muy_satisfecho',fieldwork:'no_aplica',schedule:'insatisfecho',access:'neutral',materials:'satisfecho',value:'satisfecho'},
 pace:{difficulty:'adecuado',sessions:'insuficiente',sessionLength:'adecuada'},
 application:'bastante',mostUseful:'El trabajo de campo',improvements:'Más sesiones prácticas',
 topics:['seguridad_vial','other'],topicsOther:'Logística urbana',format:'hibrido',valued:['redes'],
 testimonial:'',gender:'female',age:34,country:'PE',
});
const answersWith=(patch={})=>({...structuredClone(ANSWERS),...patch});
const without=(key)=>{const copy=structuredClone(ANSWERS);delete copy[key];return copy;};
const fieldOf=fn=>{try{fn();}catch(error){assert.equal(error.code,'survey_invalid');assert.equal(error.status,400);return error.field;}assert.fail('expected an invalid answer');};
// CSV bodies start with a UTF-8 byte order mark (Excel then reads them as UTF-8); fetch's text() would drop it.
async function parseCsv(response) {
 const bytes=Buffer.from(await response.arrayBuffer());
 assert.deepEqual([...bytes.subarray(0,3)],[0xef,0xbb,0xbf]);
 const text=bytes.toString('utf8',3),rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
  else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell='';}else if(c==='\r'&&text[i+1]==='\n'){row.push(cell);rows.push(row);row=[];cell='';i++;}else cell+=c;
 }
 row.push(cell);rows.push(row);return rows;
}

async function setup(t,{downloadLimits}={}) {
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const users={};
 for(const [key,fullName,role] of [['staff','Organizer','admin'],['teacher','Docente','admin'],['ana','Ana Pérez','member'],['bruno','Bruno Díaz','member'],['carla','Carla Soto','member'],['nameless','Placeholder','member'],['outsider','Outsider','member']])
  users[key]=toApiUser(createUser(db,{fullName,email:`${key}@example.test`,passwordHash:'test',role}));
 const store=createCourseStore({db}),stamp='2026-09-01T00:00:00.000Z';
 /* A Supabase profile may have no full name (SQLite requires one), and its session name then falls back to the
    email's local part: Q12 must never offer that derived name. */
 const getMembers=store.getMembers;store.getMembers=async ids=>(await getMembers(ids)).map(m=>m.id===users.nameless.id?{...m,name:null}:m);
 users.nameless.fullName='nameless';
 const course=await store.insert('courses',{id:randomUUID(),...normalizeCourse({title:'Curso Movilidad Nivel 2',status:'published',enrollmentOpen:false}),version:1,createdAt:stamp,updatedAt:stamp});
 const otherCourse=await store.insert('courses',{id:randomUUID(),...normalizeCourse({title:'Otro curso',status:'published'}),version:1,createdAt:stamp,updatedAt:stamp});
 for(const key of ['teacher','ana','bruno','carla','nameless'])await store.insert('enrollments',{id:randomUUID(),courseId:course.id,userId:users[key].id,createdAt:stamp});
 await store.insert('enrollments',{id:randomUUID(),courseId:otherCourse.id,userId:users.ana.id,createdAt:stamp});
 const intake={fullName:'Ana Pérez',profession:'Arquitecta',city:'Lima',motivation:'Aprender',experience:'Alguna',expectations:'Practicar',caseStudy:'Estación',digitalFamiliarity:'Cómoda'};
 await store.insert('intakes',{id:randomUUID(),courseId:course.id,userId:users.ana.id,answers:intake,updatedAt:stamp});
 const clock={now:OPEN_AT},logs=[];
 const api=createCourseApi({store,userRepository:{getUserById:async id=>Object.values(users).find(u=>u.id===id),toApiUser:u=>u},sameOrigin:req=>req.headers.origin===`http://${req.headers.host}`,
  finalSurvey:{...FINAL_SURVEY,courseId:course.id},clock:()=>clock.now,log:(...args)=>logs.push(args),...(downloadLimits?{downloadLimits}:{})});
 const server=http.createServer(async(req,res)=>{try{if(!await api({req,res,url:new URL(req.url,`http://${req.headers.host}`),user:users[req.headers.cookie]})){res.writeHead(404);res.end();}}catch(e){res.writeHead(e.status??500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,{actor='ana',method='GET',body,origin=base}={})=>fetch(base+path,{method,headers:{Cookie:actor,Origin:origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const json=async(...args)=>{const response=await call(...args);return {status:response.status,body:await response.json()};};
 const p=`/api/courses/${course.id}`,admin=`/api/admin/courses/${course.id}`;
 const snapshot=async actor=>(await json(p,{actor})).body.finalSurvey;
 const start=(actor,overall='buena')=>json(p+'/survey/start',{actor,method:'PUT',body:{overall}});
 const submit=(actor,answers=answersWith(),publishAs)=>json(p+'/survey',{actor,method:'POST',body:{answers,...(publishAs===undefined?{}:{publishAs})}});
 const put=(actor,key,body)=>json(`${admin}/certificates/${users[key].id}`,{actor,method:'PUT',body});
 const bytesRows=()=>db.prepare('SELECT count(*) AS n FROM course_certificate_bytes').get().n;
 return {db,store,users,course,otherCourse,clock,logs,call,json,p,admin,snapshot,start,submit,put,bytesRows,intake};
}

test('the survey definition is the approved Spanish wording, in order, with unique option ids and no chrome',()=>{
 assert.equal(SURVEY.intro,INTRO);
 assert.deepEqual(SURVEY.sections.map(s=>[s.id,s.title]),[['A','Experiencia general'],['B','El curso'],['C','Próximos cursos (opcional)'],['D','Testimonio (opcional)'],['E','Sobre ti']]);
 const questions=SURVEY.sections.flatMap(s=>s.questions);
 assert.deepEqual(questions.map(q=>q.number),Array.from({length:15},(_,i)=>i+1));
 assert.deepEqual(questions.filter(q=>q.screen===1).map(q=>q.id),['overall']);
 assert.deepEqual(questions.filter(q=>q.required===true).map(q=>q.number),[1,2,3,4,5,13,14,15]);
 const q=Object.fromEntries(questions.map(question=>[question.id,question]));
 assert.equal(q.overall.label,'En general, ¿cómo calificarías tu experiencia con el curso?');
 assert.deepEqual(q.overall.options.map(o=>o.label),['Deficiente','Regular','Buena','Muy buena','Excelente']);
 assert.deepEqual(q.overallWithoutSchedule.options,q.overall.options);
 assert.equal(q.overallWithoutSchedule.label,'Ahora, dejando de lado la confusión de horarios y fechas del inicio del curso, ¿cómo calificarías tu experiencia con el curso?');
 assert.deepEqual(q.aspects.rows.map(r=>r.label),['Contenido de las sesiones','Claridad de las y los docentes','Ejercicio práctico (observación en campo y registro fotográfico)','Comunicación de fechas y horarios','Avisos y enlaces para entrar a las sesiones','Facilidad para encontrar materiales y grabaciones en NODAL','Relación calidad-precio']);
 for(const row of q.aspects.rows)assert.deepEqual(row.options.map(o=>o.label),['Muy insatisfecho/a','Insatisfecho/a','Neutral','Satisfecho/a','Muy satisfecho/a','No aplica o no participé']);
 assert.equal(q.pace.label,'¿Cómo te parecieron…?');
 assert.deepEqual(q.pace.rows.map(r=>[r.label,r.options.map(o=>o.label)]),[['Nivel de dificultad',['Demasiado básico','Algo básico','Adecuado','Algo avanzado','Demasiado avanzado']],['Número de sesiones',['Insuficiente','Adecuado','Excesivo']],['Duración de cada sesión',['Demasiado corta','Adecuada','Demasiado larga']]]);
 assert.deepEqual(q.application.options.map(o=>o.label),['Nada','Poco','Algo','Bastante','Mucho']);
 assert.equal(q.improvements.help,'Por ejemplo: contenido, metodología, ejercicio práctico, organización.');
 assert.equal(q.topics.options.length,12);assert.equal(q.topics.max,3);assert.equal(q.topics.help,'Elige hasta 3.');assert.equal(q.topics.shuffle,true);
 assert.deepEqual(q.topics.options.at(-1),{id:'other',label:'Otro (¿cuál?)'});assert.equal(q.topics.other.field,'topicsOther');
 assert.equal(q.topics.options[0].label,'Movilidad urbana sostenible – Nivel avanzado');
 assert.deepEqual(q.format.options.map(o=>o.label),['Sincrónico (en vivo)','Asincrónico (grabado, a tu ritmo)','Híbrido (grabaciones + sesiones en vivo)','Sin preferencia']);
 assert.equal(q.valued.max,2);assert.equal(q.valued.help,'Elige hasta 2.');
 assert.equal(q.testimonial.help,'No es necesario para tu certificado.');
 assert.equal(q.testimonialConsent.label,'¿Podemos publicar tu mensaje en la web y redes de NODAL / Sistema Urbano?');
 assert.deepEqual(q.testimonialConsent.options.map(o=>o.label),['Sí, como:','Sí, de forma anónima','No, es solo para el equipo']);
 assert.equal(q.testimonialConsent.note,'Podemos acortarlo o corregir la ortografía sin cambiar su sentido. Si cambias de opinión, escríbenos a observatorio@limacomovamos.org y lo retiramos.');
 assert.deepEqual(q.gender.options,[{id:'female',label:'Mujer'},{id:'male',label:'Hombre'},{id:'other',label:'Otro'},{id:'prefer_not',label:'Prefiero no responder'}]);
 assert.deepEqual([q.age.label,q.age.min,q.age.max],['Edad',1,120]);
 // Flat list: Perú, the rest of Latin America alphabetically, Spain, the United States, then 'Otro'.
 assert.deepEqual(q.country.options.map(o=>o.label),['Perú','Argentina','Bolivia','Brasil','Chile','Colombia','Costa Rica','Cuba','Ecuador','El Salvador','Guatemala','Honduras','México','Nicaragua','Panamá','Paraguay','Puerto Rico','República Dominicana','Uruguay','Venezuela','España','Estados Unidos','Otro (¿cuál?)']);
 assert.equal(q.country.other.field,'countryOther');
 for(const question of questions)for(const list of [question.options,...(question.rows??[]).map(r=>r.options)].filter(Boolean))assert.equal(new Set(list.map(o=>o.id)).size,list.length,question.id);
 // Interface chrome (placeholders, buttons, errors) belongs to the page's translations, not to the survey.
 assert.doesNotMatch(JSON.stringify(SURVEY),/placeholder|Elige un país|América Latina|Otros países/);
 assert.ok(Object.isFrozen(SURVEY.sections[1].questions[0].rows[0].options[0]));
});

test('answers are validated against the definition and rebuilt from known keys only',()=>{
 for(const id of ['deficiente','regular','buena','muy_buena','excelente'])assert.deepEqual(normalizeSurveyStart({overall:id}),{overall:id});
 for(const overall of ['Buena','',undefined,null,4,'__proto__','constructor','toString'])assert.equal(fieldOf(()=>normalizeSurveyStart({overall})),'overall');
 const stored=normalizeSurveyAnswers({...answersWith({overall:'deficiente',extra:'dropped',mostUseful:'  El trabajo de campo  '})},{publishAs:'Ana Pérez, Arquitecta'});
 assert.deepEqual(stored,{...structuredClone(ANSWERS),topics:['seguridad_vial','other'],testimonialConsent:'',testimonialName:'',countryOther:''});
 assert.equal('overall' in stored,false,'the first answer never comes from the final submission');
 for(const key of ['overallWithoutSchedule','aspects','pace','application','gender','age','country'])assert.equal(fieldOf(()=>normalizeSurveyAnswers(without(key))),key);
 for(const bad of [null,[],'answers'])assert.equal(fieldOf(()=>normalizeSurveyAnswers(bad)),'answers');
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({aspects:{...ANSWERS.aspects,value:undefined}}))),'aspects');
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({aspects:Object.values(ANSWERS.aspects)}))),'aspects');
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({aspects:JSON.parse(JSON.stringify({...ANSWERS.aspects,content:'constructor'}))}))),'aspects');
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({pace:{...ANSWERS.pace,sessions:'adecuada'}}))),'pace');
 assert.equal(normalizeSurveyAnswers(answersWith({aspects:Object.fromEntries(Object.keys(ANSWERS.aspects).map(k=>[k,'no_aplica']))})).aspects.value,'no_aplica');
 for(const age of [0,121,30.5,'30',null,Number.NaN])assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({age}))),'age');
 for(const age of [1,120])assert.equal(normalizeSurveyAnswers(answersWith({age})).age,age);
 for(const gender of ['Mujer','F','other ',''])assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({gender}))),'gender');
 for(const gender of ['female','male','other','prefer_not'])assert.equal(normalizeSurveyAnswers(answersWith({gender})).gender,gender);
 // Checkbox caps, known ids, duplicates and the definition's order.
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({topics:['vivienda','seguridad_vial','modos_activos','innovacion_social']}))),'topics');
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({topics:['vivienda','teleportation']}))),'topics');
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({topics:'vivienda'}))),'topics');
 assert.deepEqual(normalizeSurveyAnswers(answersWith({topics:['vivienda','vivienda','transporte_publico'],topicsOther:'ignored'})).topics,['transporte_publico','vivienda']);
 assert.equal(normalizeSurveyAnswers(answersWith({topics:['vivienda'],topicsOther:'ignored'})).topicsOther,'');
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({topics:['other'],topicsOther:'  '}))),'topics');
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({valued:['redes','recursos','conocimiento']}))),'valued');
 assert.deepEqual(normalizeSurveyAnswers(answersWith({valued:['redes','conocimiento']})).valued,['conocimiento','redes']);
 assert.deepEqual(normalizeSurveyAnswers(answersWith({topics:undefined,valued:undefined,format:undefined})).topics,[]);
 assert.equal(normalizeSurveyAnswers(answersWith({format:''})).format,'');
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({format:'presencial'}))),'format');
 // Q12 is required only with a message, and naming needs a name.
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({testimonial:'Muy bueno'}),{publishAs:'Ana'})),'testimonialConsent');
 assert.deepEqual(normalizeSurveyAnswers(answersWith({testimonial:'',testimonialConsent:'named'}),{publishAs:'Ana'}).testimonialConsent,'');
 const named=normalizeSurveyAnswers(answersWith({testimonial:' Muy bueno ',testimonialConsent:'named',testimonialName:'Forged'}),{publishAs:'Ana Pérez, Arquitecta'});
 assert.deepEqual([named.testimonial,named.testimonialConsent,named.testimonialName],['Muy bueno','named','Ana Pérez, Arquitecta']);
 assert.equal(normalizeSurveyAnswers(answersWith({testimonial:'Muy bueno',testimonialConsent:'anonymous'}),{publishAs:'Ana'}).testimonialName,'');
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({testimonial:'Muy bueno',testimonialConsent:'named'}),{publishAs:''})),'testimonialConsent');
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({country:'other'}))),'country');
 assert.deepEqual(normalizeSurveyAnswers(answersWith({country:'other',countryOther:' Canadá '})).countryOther,'Canadá');
 assert.equal(normalizeSurveyAnswers(answersWith({country:'AR',countryOther:'ignored'})).countryOther,'');
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({country:'Perú'}))),'country');
 // Texts: bounded, strings only, and never a NUL (PostgreSQL jsonb refuses it).
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({mostUseful:'x'.repeat(301)}))),'mostUseful');
 assert.equal(normalizeSurveyAnswers(answersWith({mostUseful:'x'.repeat(300)})).mostUseful.length,300);
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({improvements:'x'.repeat(3001)}))),'improvements');
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({testimonial:'x'.repeat(2001)}))),'testimonial');
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({mostUseful:'a\u0000b'}))),'mostUseful');
 assert.equal(fieldOf(()=>normalizeSurveyAnswers(answersWith({improvements:['list']}))),'improvements');
 // Validation errors name a question, never what was written.
 try{normalizeSurveyAnswers(answersWith({mostUseful:'secret text '.repeat(40)}));}catch(error){assert.doesNotMatch(error.message,/secret/);}
});

test('the publication name comes from the course form, else from the profile full name only',()=>{
 assert.equal(publishName({fullName:' Ana Pérez ',profession:'Arquitecta'},'Ana P.'),'Ana Pérez, Arquitecta');
 assert.equal(publishName({fullName:'Ana Pérez',profession:''}),'Ana Pérez');
 assert.equal(publishName(null,' Bruno Díaz '),'Bruno Díaz');
 assert.equal(publishName(null,null),'');assert.equal(publishName(undefined),'');
 assert.equal(limaTime('2026-10-24T04:59:00.000Z'),'2026-10-23 23:59');assert.equal(limaTime(null),'');
});

test('only enrolled participants get the form; organisers get a read-only preview; other courses get nothing',async t=>{
 const {otherCourse,clock,call,json,p,snapshot,start,submit,store,course}=await setup(t);
 assert.equal('finalSurvey' in (await json(p,{actor:'outsider'})).body,false);
 assert.equal('finalSurvey' in (await json(`/api/courses/${otherCourse.id}`)).body,false);
 for(const [suffix,method,body] of [['/survey/start','PUT',{overall:'buena'}],['/survey','POST',{answers:ANSWERS}],['/certificate','GET']]) {
  const refused=await json(`/api/courses/${otherCourse.id}${suffix}`,{method,body});
  assert.deepEqual([refused.status,refused.body.code],[404,'survey_unavailable'],suffix);
 }
 const state=await snapshot('ana');
 assert.deepEqual({...state,survey:undefined},{closesAt:'2026-10-24T05:00:00Z',lastDay:'2026-10-23',open:true,contactEmail:'observatorio@limacomovamos.org',preview:false,response:null,certificate:null,publishAs:'Ana Pérez, Arquitecta',survey:undefined});
 assert.deepEqual(state.survey,JSON.parse(JSON.stringify(SURVEY)));
 // Enrolment closed and no course form: the survey still opens, with the profile name to publish under.
 const bruno=(await json(p,{actor:'bruno'})).body;
 assert.equal(bruno.course.enrollmentOpen,false);assert.equal(bruno.intake,null);assert.equal(bruno.finalSurvey.publishAs,'Bruno Díaz');assert.ok(bruno.finalSurvey.survey);
 assert.equal((await snapshot('nameless')).publishAs,'');
 for(const actor of ['staff','teacher']) {
  const preview=await snapshot(actor);
  assert.equal(preview.preview,true,actor);assert.equal(preview.open,true);assert.equal(preview.response,null);assert.equal(preview.certificate,null);assert.ok(preview.survey);
  for(const response of [await start(actor),await submit(actor)])assert.deepEqual([response.status,response.body.code],[403,'survey_unavailable'],actor);
 }
 const outsider=await start('outsider');assert.deepEqual([outsider.status,outsider.body.code],[403,'survey_unavailable']);
 assert.equal((await call(p+'/survey/start',{actor:'',method:'PUT',body:{overall:'buena'}})).status,401);
 assert.equal((await call(p+'/survey/start',{method:'PUT',body:{overall:'buena'},origin:'https://evil.test'})).status,403);
 assert.equal(await store.count('surveys',{courseId:course.id}),0);
 // After the close the preview shows the closed state, not a live-looking form.
 clock.now=CLOSES;
 const closed=await snapshot('staff');
 assert.deepEqual([closed.preview,closed.open,'survey' in closed,closed.publishAs],[true,false,false,'']);
 const refused=await start('staff');assert.deepEqual([refused.status,refused.body.code],[403,'survey_unavailable']);
});

test('the first answer locks once saved and a response is submitted exactly once',async t=>{
 const {store,course,users,json,p,snapshot,start,submit}=await setup(t);
 assert.deepEqual([(await submit('carla')).status,(await submit('carla')).body.code],[409,'survey_not_started']);
 const invalidStart=await start('ana','Buena');assert.deepEqual([invalidStart.status,invalidStart.body.code,invalidStart.body.field],[400,'survey_invalid','overall']);
 const first=await start('ana','buena');
 assert.equal(first.status,200);assert.equal(first.body.finalSurvey.response.submittedAt,null);assert.ok(first.body.finalSurvey.response.startedAt);assert.ok(first.body.finalSurvey.survey);
 // Screen 2 says only that the first answer was saved; its value is never sent back.
 assert.doesNotMatch(JSON.stringify(first.body.finalSurvey.response),/buena/);
 assert.equal((await start('ana','buena')).status,200,'the same answer again is a retry');
 const locked=await start('ana','excelente');assert.deepEqual([locked.status,locked.body.code],[409,'survey_locked']);
 assert.equal(await store.count('surveys',{courseId:course.id,userId:users.ana.id}),1);
 assert.equal((await store.find('surveys',{userId:users.ana.id}))[0].answers.overall,'buena');
 const resumed=await snapshot('ana');assert.ok(resumed.response.startedAt);assert.equal(resumed.response.submittedAt,null);assert.ok(resumed.survey);
 const sent=await submit('ana',answersWith({overall:'deficiente'}));
 assert.equal(sent.status,200);
 assert.deepEqual({...sent.body.finalSurvey,response:undefined},{closesAt:FINAL_SURVEY.closesAt,lastDay:'2026-10-23',open:true,contactEmail:FINAL_SURVEY.contactEmail,preview:false,response:undefined,certificate:'preparing',publishAs:''});
 assert.ok(sent.body.finalSurvey.response.submittedAt);
 const [row]=await store.find('surveys',{userId:users.ana.id});
 assert.equal(row.answers.overall,'buena','the locked first answer is kept');assert.equal(row.answers.gender,'female');assert.equal(row.submittedAt,sent.body.finalSurvey.response.submittedAt);
 for(const again of [await submit('ana'),await start('ana','buena')])assert.deepEqual([again.status,again.body.code],[409,'survey_submitted']);
 const after=(await json(p)).body.finalSurvey;assert.equal(after.certificate,'preparing');assert.equal('survey' in after,false);
});

test('Q12 and the demographic questions are enforced by the server',async t=>{
 const {store,users,start,submit}=await setup(t);
 for(const actor of ['ana','bruno','nameless'])assert.equal((await start(actor)).status,200);
 const cases=[
  [answersWith({testimonial:'Un curso excelente'}),undefined,400,'testimonialConsent'],
  [without('gender'),undefined,400,'gender'],[answersWith({age:'34'}),undefined,400,'age'],[answersWith({age:34.5}),undefined,400,'age'],
  [without('country'),undefined,400,'country'],[answersWith({country:'other'}),undefined,400,'country'],
  [answersWith({topics:['vivienda','seguridad_vial','modos_activos','innovacion_social']}),undefined,400,'topics'],
  [answersWith({valued:['redes','recursos','conocimiento']}),undefined,400,'valued'],
  [answersWith({aspects:{...ANSWERS.aspects,value:''}}),undefined,400,'aspects'],
 ];
 for(const [answers,publishAs,status,field] of cases){const response=await submit('bruno',answers,publishAs);assert.deepEqual([response.status,response.body.code,response.body.field],[status,'survey_invalid',field],field);}
 const notAnObject=await submit('bruno',[]);assert.deepEqual([notAnObject.status,notAnObject.body.field],[400,'answers']);
 // The stored name is exactly the one shown: a different one is a conflict.
 const named=answersWith({testimonial:'Un curso excelente',testimonialConsent:'named'});
 const changed=await submit('bruno',named,'Someone else');assert.deepEqual([changed.status,changed.body.code],[409,'survey_changed']);
 assert.equal((await submit('bruno',named)).body.code,'survey_changed','a missing name is a conflict too');
 assert.equal((await submit('bruno',named,'Bruno Díaz')).status,200);
 assert.equal((await store.find('surveys',{userId:users.bruno.id}))[0].answers.testimonialName,'Bruno Díaz');
 // No name to publish under: naming is refused, anonymity is fine.
 const unnamed=await submit('nameless',named,'');assert.deepEqual([unnamed.status,unnamed.body.field],[400,'testimonialConsent']);
 assert.equal((await submit('nameless',answersWith({testimonial:'Un curso excelente',testimonialConsent:'anonymous'}))).status,200);
 // A course-form edit between showing and sending the name is caught.
 const intake=(await store.find('intakes',{userId:users.ana.id}))[0];
 await store.update('intakes',{id:intake.id},{answers:{...intake.answers,profession:'Urbanista'}});
 assert.equal((await submit('ana',named,'Ana Pérez, Arquitecta')).body.code,'survey_changed');
 assert.equal((await submit('ana',named,'Ana Pérez, Urbanista')).status,200);
});

test('the form closes at the end of 23 October in Lima, and certificates stay downloadable afterwards',async t=>{
 const {clock,snapshot,start,submit,put,call,p}=await setup(t);
 clock.now=CLOSES-1;
 assert.equal((await snapshot('ana')).open,true);
 assert.equal((await start('ana')).status,200);assert.equal((await submit('ana')).status,200);
 assert.equal((await start('bruno')).status,200);
 clock.now=CLOSES;
 const closed=await snapshot('carla');assert.deepEqual([closed.open,'survey' in closed,closed.response,closed.certificate],[false,false,null,null]);
 const startedOnly=await snapshot('bruno');assert.deepEqual([startedOnly.open,'survey' in startedOnly,startedOnly.certificate],[false,false,null]);assert.ok(startedOnly.response.startedAt);
 for(const response of [await start('carla'),await submit('bruno')])assert.deepEqual([response.status,response.body.code],[403,'survey_closed']);
 assert.equal((await snapshot('ana')).certificate,'preparing');
 assert.equal((await put('staff','ana',upload(pdf('Ana')))).status,201);
 assert.equal((await snapshot('ana')).certificate,'ready');
 const file=await call(p+'/certificate');assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),pdf('Ana'));
 clock.now=CLOSES+60*24*60*60*1000;
 assert.equal((await call(p+'/certificate')).status,200,'still downloadable long after the close');
});

test('certificates are PDFs for participants only, downloadable by their owner, replaceable and deletable',async t=>{
 const {store,users,course,call,json,p,admin,snapshot,start,submit,put,bytesRows}=await setup(t,{downloadLimits:[{windowMs:60000,bytes:30}]});
 for(const key of ['outsider','teacher','staff']){const refused=await put('staff',key,upload(pdf('x')));assert.deepEqual([refused.status,refused.body.code],[404,'certificate_not_enrolled'],key);}
 const invalid=[[{mime:'text/plain',data:Buffer.from('text').toString('base64')},400],[upload(Buffer.from('<html>not a pdf</html>')),400],[{mime:'application/pdf',data:'***'},400],[{mime:'application/pdf'},400],[upload(Buffer.concat([pdf(''),Buffer.alloc(3*1024*1024)])),413]];
 for(const [body,status] of invalid){const refused=await put('staff','ana',body);assert.deepEqual([refused.status,refused.body.code],[status,'certificate_invalid']);}
 assert.equal(await store.count('certificates',{courseId:course.id}),0);assert.equal(bytesRows(),0);
 const first=await put('staff','ana',upload(pdf('first')));
 assert.equal(first.status,201);assert.equal(first.body.replaced,false);
 assert.deepEqual(Object.keys(first.body.certificate).sort(),['createdAt','id','size','userId']);assert.equal(first.body.certificate.userId,users.ana.id);assert.equal(first.body.certificate.size,pdf('first').length);
 // Before the survey is sent the certificate is not shown or served.
 assert.equal((await snapshot('ana')).certificate,null);
 const early=await json(p+'/certificate');assert.deepEqual([early.status,early.body.code],[404,'certificate_unavailable']);
 await start('ana');await submit('ana');
 assert.equal((await snapshot('ana')).certificate,'ready');
 const file=await call(p+'/certificate');
 assert.equal(file.status,200);
 assert.equal(file.headers.get('content-type'),'application/pdf');
 assert.equal(file.headers.get('content-disposition'),`attachment; filename="certificado-curso-movilidad-nivel-2.pdf"; filename*=UTF-8''certificado-curso-movilidad-nivel-2.pdf`);
 assert.equal(file.headers.get('cache-control'),'private, no-store');assert.equal(file.headers.get('etag'),null);
 assert.equal(file.headers.get('content-security-policy'),"default-src 'none'; sandbox");assert.equal(file.headers.get('x-content-type-options'),'nosniff');
 assert.deepEqual(Buffer.from(await file.arrayBuffer()),pdf('first'));
 // The download budget applies to members (the first file of a window always fits).
 const limited=await json(p+'/certificate');assert.deepEqual([limited.status,limited.body.code],[429,'download_rate']);
 // Nobody else reaches it: members only ever have their own route, organisers their own.
 assert.equal((await call(p+'/certificate',{actor:'bruno'})).status,404);
 assert.equal((await call(p+'/certificate',{actor:'outsider'})).status,404);
 const adminFile=await call(`${admin}/certificates/${users.ana.id}`,{actor:'staff'});assert.equal(adminFile.status,200);assert.deepEqual(Buffer.from(await adminFile.arrayBuffer()),pdf('first'));
 // The organiser's copy is named after the person (ASCII, never the email), so two downloads never collide.
 assert.equal(adminFile.headers.get('content-disposition'),`attachment; filename="certificado-curso-movilidad-nivel-2-ana-perez.pdf"; filename*=UTF-8''certificado-curso-movilidad-nivel-2-ana-perez.pdf`);
 assert.equal(adminFile.headers.get('cache-control'),'private, no-store');assert.equal(adminFile.headers.get('content-security-policy'),"default-src 'none'; sandbox");
 assert.equal((await put('staff','nameless',upload(pdf('n')))).status,201);
 const namelessFile=await call(`${admin}/certificates/${users.nameless.id}`,{actor:'staff'});
 assert.match(namelessFile.headers.get('content-disposition'),new RegExp(`^attachment; filename="certificado-curso-movilidad-nivel-2-${users.nameless.id.slice(0,8)}\\.pdf"`));assert.doesNotMatch(namelessFile.headers.get('content-disposition'),/@|nameless/);
 assert.equal((await json(`${admin}/certificates/${users.nameless.id}`,{actor:'staff',method:'DELETE'})).status,200);
 assert.equal((await call(`${admin}/certificates/${users.bruno.id}`,{actor:'staff'})).status,404);
 assert.equal((await call(`${admin}/certificates/not-an-id`,{actor:'staff'})).status,400);
 // A replacement is a new row and object; exactly one ready certificate and one stored file remain.
 const second=await put('staff','ana',upload(pdf('second')));
 assert.equal(second.status,201);assert.equal(second.body.replaced,true);assert.notEqual(second.body.certificate.id,first.body.certificate.id);
 const rows=await store.find('certificates',{userId:users.ana.id});
 assert.deepEqual(rows.map(r=>[r.id,r.status]),[[second.body.certificate.id,'ready']]);
 assert.equal(rows[0].storagePath,`certificates/${course.id}/${users.ana.id}/${second.body.certificate.id}.pdf`);
 assert.equal(bytesRows(),1);
 assert.deepEqual(Buffer.from(await(await call(`${admin}/certificates/${users.ana.id}`,{actor:'staff'})).arrayBuffer()),pdf('second'));
 assert.equal((await call(`${admin}/certificates/${users.ana.id}`,{actor:'staff',method:'DELETE',origin:'https://evil.test'})).status,403);
 assert.equal((await call(`${admin}/certificates/${users.ana.id}`,{actor:'staff',method:'PUT',body:upload(pdf('x')),origin:'https://evil.test'})).status,403);
 const removed=await json(`${admin}/certificates/${users.ana.id}`,{actor:'staff',method:'DELETE'});
 assert.deepEqual([removed.status,removed.body],[200,{ok:true}]);
 assert.equal(await store.count('certificates',{userId:users.ana.id}),0);assert.equal(bytesRows(),0);
 assert.equal((await snapshot('ana')).certificate,'preparing');
 const gone=await json(`${admin}/certificates/${users.ana.id}`,{actor:'staff',method:'DELETE'});assert.deepEqual([gone.status,gone.body.code],[404,'certificate_unavailable']);
});

test('a concurrent replacement keeps one ready certificate and the loser cleans up after itself',async t=>{
 const {store,users,course,put,bytesRows}=await setup(t);
 assert.equal((await put('staff','ana',upload(pdf('first')))).status,201);
 // Another organiser's replacement becomes ready between this upload's two steps.
 const update=store.update.bind(store);let raced;
 store.update=async(name,filters,patch)=>{
  if(name==='certificates'&&patch.status==='ready'&&!raced){
   raced={id:randomUUID(),courseId:course.id,userId:users.ana.id,size:5,status:'ready',createdAt:new Date().toISOString()};
   raced.storagePath=`certificates/${course.id}/${users.ana.id}/${raced.id}.pdf`;
   await store.insert('certificates',raced);await store.putCertificate(raced,pdf('winner'));
  }
  return update(name,filters,patch);
 };
 const lost=await put('staff','ana',upload(pdf('loser')));
 assert.deepEqual([lost.status,lost.body.code],[409,'certificate_changed']);
 const rows=await store.find('certificates',{userId:users.ana.id});
 assert.deepEqual(rows.map(r=>[r.id,r.status]),[[raced.id,'ready']]);
 assert.equal(bytesRows(),1);assert.deepEqual(await store.getCertificate(raced),pdf('winner'));
 // The store reports the unique conflict as 409, not as a failure.
 const extra={id:randomUUID(),courseId:course.id,userId:users.ana.id,size:5,status:'pending',createdAt:new Date().toISOString()};
 await store.insert('certificates',{...extra,storagePath:`certificates/${course.id}/${users.ana.id}/${extra.id}.pdf`});
 await assert.rejects(update('certificates',{id:extra.id},{status:'ready'}),{status:409});
});

test('a replacement that fails other than by a unique conflict puts the old certificate back',async t=>{
 const {store,users,clock,logs,call,p,start,submit,put,bytesRows}=await setup(t);
 await start('ana');await submit('ana');
 const first=await put('staff','ana',upload(pdf('first')));assert.equal(first.status,201);
 const update=store.update.bind(store),dayLater=clock.now+25*60*60*1000;
 const statuses=async()=>(await store.find('certificates',{userId:users.ana.id})).map(r=>[r.id===first.body.certificate.id?'old':'new',r.status]).sort();
 // The one matching update fails without a unique conflict; `applied` makes it land in the database first.
 const failOnce=(when,applied)=>{let failed=false;store.update=async(name,filters,patch)=>{
  if(failed||name!=='certificates'||!when(filters,patch))return update(name,filters,patch);
  failed=true;if(applied)await update(name,filters,patch);throw new Error('fetch timeout');
 };};
 const promotion=(filters,patch)=>filters.status==='pending'&&patch.status==='ready',demotion=(filters,patch)=>patch.status==='deleting';
 const download=async()=>{const file=await call(p+'/certificate');assert.equal(file.status,200);return Buffer.from(await file.arrayBuffer());};
 // The promotion of the new file times out, or the old row's demotion lands but its answer is lost.
 for(const [when,applied] of [[promotion,false],[demotion,true]]) {
  failOnce(when,applied);
  const failed=await put('staff','ana',upload(pdf('second')));store.update=update;
  assert.equal(failed.status,500);
  assert.deepEqual(await statuses(),[['new','pending'],['old','ready']],'the old certificate is ready again; the new row waits for reconciliation');
  assert.deepEqual(await download(),pdf('first'));
  // Reconciliation leaves the ready one alone and removes the pending one once it is a day old.
  await reconcileCourseCertificates(store,{apply:true,now:dayLater});
  assert.deepEqual(await statuses(),[['old','ready']]);assert.equal(bytesRows(),1);assert.deepEqual(await download(),pdf('first'));
 }
 // A promotion that landed but whose answer was lost: the new file is ready and reconciliation finishes the old one.
 failOnce(promotion,true);
 assert.equal((await put('staff','ana',upload(pdf('third')))).status,500);store.update=update;
 assert.deepEqual(await statuses(),[['new','ready'],['old','deleting']]);assert.deepEqual(await download(),pdf('third'));
 await reconcileCourseCertificates(store,{apply:true,now:clock.now});
 assert.deepEqual(await statuses(),[['new','ready']]);assert.equal(bytesRows(),1);
 assert.deepEqual(logs,[],'the unique conflict while putting the old row back is expected, not logged');
});

test('organiser routes refuse members and signed-out requests, and their member-path twins answer nothing',async t=>{
 const {store,users,call,p,admin}=await setup(t);
 const routes=[['/final-survey','GET'],['/export?type=survey','GET'],['/export?type=survey-status','GET'],[`/certificates/${users.ana.id}`,'GET'],[`/certificates/${users.ana.id}`,'PUT',upload(pdf('x'))],[`/certificates/${users.ana.id}`,'DELETE']];
 for(const [suffix,method,body] of routes) {
  assert.equal((await call(admin+suffix,{actor:'ana',method,body})).status,403,`member ${method} ${suffix}`);
  assert.equal((await call(admin+suffix,{actor:'',method,body})).status,401,`signed out ${method} ${suffix}`);
  // The same suffix under the member prefix is not an organiser route.
  const twin=await call(p+suffix,{actor:'ana',method,body});
  assert.equal(twin.status,404,`member path ${method} ${suffix}`);
  assert.doesNotMatch(await twin.text(),/ana@example|Ana Pérez/);
 }
 assert.equal(await store.count('certificates'),0);
});

test('organisers see participants only, with every answer in the response CSV and a reminder list',async t=>{
 const {store,users,course,otherCourse,clock,json,call,admin,start,submit,put}=await setup(t);
 clock.now=Date.parse('2026-10-12T15:42:00.000Z');
 await start('ana','muy_buena');
 await submit('ana',answersWith({testimonial:'=HYPERLINK("https://evil.test","clic")',testimonialConsent:'named',topics:['other','vivienda'],topicsOther:'+Logística'}),'Ana Pérez, Arquitecta');
 clock.now=Date.parse('2026-10-13T02:05:00.000Z');
 await start('bruno','regular');await submit('bruno',answersWith({country:'other',countryOther:'Canadá',gender:'prefer_not',age:61,valued:[],topics:[]}));
 await start('carla','excelente');
 await put('staff','ana',upload(pdf('Ana')));
 // The enrolled administrator is an organiser: not counted, not listed, never in a CSV.
 const status=await json(admin+'/final-survey',{actor:'staff'});
 assert.equal(status.status,200);
 assert.deepEqual({...status.body,participants:undefined},{closesAt:FINAL_SURVEY.closesAt,lastDay:'2026-10-23',open:true,contactEmail:FINAL_SURVEY.contactEmail,total:4,answered:2,started:1,certificates:1,participants:undefined});
 assert.deepEqual(status.body.participants.map(p=>p.email),['nameless@example.test','ana@example.test','bruno@example.test','carla@example.test']);
 const ana=status.body.participants.find(p=>p.userId===users.ana.id);
 assert.deepEqual(Object.keys(ana).sort(),['certificate','email','enrolledAt','name','startedAt','submittedAt','userId']);
 assert.equal(ana.submittedAt,'2026-10-12T15:42:00.000Z');assert.deepEqual(Object.keys(ana.certificate).sort(),['createdAt','id','size']);
 const carla=status.body.participants.find(p=>p.userId===users.carla.id);assert.ok(carla.startedAt);assert.equal(carla.submittedAt,null);assert.equal(carla.certificate,null);
 assert.equal(status.body.participants.some(p=>p.userId===users.teacher.id),false);
 const responses=await call(admin+'/export?type=survey',{actor:'staff'});
 assert.equal(responses.status,200);assert.match(responses.headers.get('content-disposition'),/encuesta-final-respuestas\.csv/);assert.match(responses.headers.get('content-type'),/^text\/csv/);
 const [header,...rows]=await parseCsv(responses);
 assert.equal(rows.length,2,'one row per submitted response');
 const col=name=>{const index=header.findIndex(h=>h===name||h.startsWith(name));assert.ok(index>=0,name);return index;};
 assert.deepEqual(header.slice(0,5),['Nombre','Correo','Enviada (hora de Lima)','P1 En general, ¿cómo calificarías tu experiencia con el curso?','P1 (1-5)']);
 assert.equal(header.length,32);
 const [anaRow,brunoRow]=rows;
 assert.deepEqual([anaRow[0],anaRow[1],anaRow[2],anaRow[3],anaRow[4]],['Ana Pérez','ana@example.test','2026-10-12 10:42','Muy buena','4']);
 assert.equal(brunoRow[2],'2026-10-12 21:05','UTC 02:05 is 21:05 the evening before in Lima');
 assert.equal(anaRow[col('P2 (1-5)')],'4');assert.equal(anaRow[col('P3 Relación calidad-precio')],'Satisfecho/a');assert.equal(anaRow[col('P3 Ejercicio práctico')],'No aplica o no participé');
 assert.equal(anaRow[col('P4 Número de sesiones')],'Insuficiente');assert.equal(anaRow[col('P5 (1-5)')],'4');
 assert.equal(anaRow[col('P8 ')],'Vivienda y desarrollo urbano inclusivo; Otro (¿cuál?)');
 assert.equal(anaRow[col('P8 Otro tema')],"'+Logística",'formula-leading text is neutralised');
 assert.equal(anaRow[col('P11 ')],`'=HYPERLINK("https://evil.test","clic")`);
 assert.equal(anaRow[col('P12 ¿Podemos')],'Sí, como:');assert.equal(anaRow[col('P12 Publicar como')],'Ana Pérez, Arquitecta');
 assert.deepEqual([anaRow[col('P13 Género')],anaRow[col('P14 Edad')],anaRow[col('P15 País de residencia')]],['Mujer','34','Perú']);
 assert.deepEqual([brunoRow[col('P13 Género')],brunoRow[col('P14 Edad')],brunoRow[col('P15 País de residencia')],brunoRow[col('P15 Otro país')],brunoRow[col('P12 ¿Podemos')]],['Prefiero no responder','61','Otro (¿cuál?)','Canadá','']);
 const statusCsv=await call(admin+'/export?type=survey-status',{actor:'staff'});
 assert.match(statusCsv.headers.get('content-disposition'),/encuesta-final-estado\.csv/);
 const [statusHeader,...statusRows]=await parseCsv(statusCsv);
 assert.deepEqual(statusHeader,['Nombre','Nombre en el formulario del curso','Correo','Encuesta','Fecha de respuesta (hora de Lima)','Certificado subido']);
 assert.deepEqual(statusRows,[['','','nameless@example.test','Todavía no','','no'],['Ana Pérez','Ana Pérez','ana@example.test','Respondió','2026-10-12 10:42','sí'],['Bruno Díaz','','bruno@example.test','Respondió','2026-10-12 21:05','no'],['Carla Soto','','carla@example.test','Empezó (solo pregunta 1)','','no']]);
 // Another course has no survey, and its existing exports are untouched.
 const other=`/api/admin/courses/${otherCourse.id}`;
 for(const path of ['/final-survey','/export?type=survey','/export?type=survey-status']){const refused=await json(other+path,{actor:'staff'});assert.deepEqual([refused.status,refused.body.code],[404,'survey_unavailable'],path);}
 assert.equal((await call(other+'/export?type=participants',{actor:'staff'})).status,200);
 assert.equal((await call(admin+'/export?type=unknown',{actor:'staff'})).status,400);
 assert.equal(await store.count('surveys',{courseId:course.id}),3);
});

test('a failed clean-up of a replaced certificate keeps its row for reconciliation and logs no personal data',async t=>{
 const {store,users,logs,put,start,submit,bytesRows}=await setup(t);
 await start('ana');await submit('ana',answersWith({testimonial:'Mensaje privado',testimonialConsent:'team'}));
 const first=await put('staff','ana',upload(pdf('first')));
 const remove=store.deleteCertificate;store.deleteCertificate=async()=>{throw new Error('Storage unavailable');};
 const second=await put('staff','ana',upload(pdf('second')));
 store.deleteCertificate=remove;
 assert.equal(second.status,201);assert.equal(second.body.replaced,true);
 const rows=await store.find('certificates',{userId:users.ana.id});
 assert.deepEqual(rows.map(r=>[r.id,r.status]).sort(),[[first.body.certificate.id,'deleting'],[second.body.certificate.id,'ready']].sort());
 assert.deepEqual(logs,[['course certificate cleanup failed:',first.body.certificate.id,'Storage unavailable']]);
 assert.doesNotMatch(JSON.stringify(logs),/@|Ana|Pérez|privado|certificates\//);
 // Reconciliation finishes it; a fresh pending upload is left alone and a day-old one goes.
 const now=Date.now();
 const pending=async createdAt=>{const id=randomUUID(),row={id,courseId:rows[0].courseId,userId:users.ana.id,size:5,storagePath:`certificates/${rows[0].courseId}/${users.ana.id}/${id}.pdf`,status:'pending',createdAt};await store.insert('certificates',row);await store.putCertificate(row,pdf('p'));return row;};
 const stale=await pending(new Date(now-25*60*60*1000).toISOString()),fresh=await pending(new Date(now-60*1000).toISOString());
 assert.deepEqual(await reconcileCourseCertificates(store,{now}),{pending:1,pendingRemoved:0,deleting:1,deletingRemoved:0,dryRun:true});
 assert.equal(bytesRows(),4,'a dry run changes nothing');
 const failing={...store,find:store.find.bind(store),remove:store.remove.bind(store),deleteCertificate:async()=>{throw new Error('Storage unavailable');}};
 await assert.rejects(reconcileCourseCertificates(failing,{apply:true,now}),/Storage unavailable/);
 assert.equal(await store.count('certificates',{userId:users.ana.id}),4,'a Storage failure keeps every row');
 assert.deepEqual(await reconcileCourseCertificates(store,{apply:true,now}),{pending:1,pendingRemoved:1,deleting:1,deletingRemoved:1,dryRun:false});
 assert.deepEqual((await store.find('certificates',{userId:users.ana.id})).map(r=>r.id).sort(),[second.body.certificate.id,fresh.id].sort());
 assert.equal(bytesRows(),2);assert.equal((await store.find('certificates',{id:stale.id})).length,0);
 // Certificates never touch the attachment reconciliation, whose result keeps its shape.
 assert.deepEqual(await reconcileCourseUploads(store,{now}),{examined:0,stale:0,removed:0,deleting:0,deletingRemoved:0,orphaned:0,orphansRemoved:0,dryRun:true});
});

test('the account export carries the survey and certificates, and erasure removes them with their files',async t=>{
 const {db,store,users,course,start,submit,put,bytesRows}=await setup(t);
 await start('ana');await submit('ana');
 const {body:{certificate}}=await put('staff','ana',upload(pdf('Ana')));
 const exported=await exportCourseData(store,users.ana.id);
 assert.equal(exported.surveys.length,1);assert.equal(exported.surveys[0].answers.gender,'female');assert.equal(exported.surveys[0].answers.overall,'buena');
 assert.deepEqual(exported.certificates.map(c=>[c.id,c.status,c.storagePath]),[[certificate.id,'ready',undefined]]);
 // Neither the account nor the course can go while a certificate row tracks a file.
 assert.throws(()=>db.prepare('DELETE FROM users WHERE id=?').run(users.ana.id),/FOREIGN KEY/);
 assert.throws(()=>db.prepare('DELETE FROM pilot_courses WHERE id=?').run(course.id),/FOREIGN KEY/);
 // An upload in progress refuses erasure before anything is removed; an old abandoned one does not.
 const id=randomUUID(),createdAt=new Date().toISOString();
 await store.insert('certificates',{id,courseId:course.id,userId:users.ana.id,size:5,storagePath:`certificates/${course.id}/${users.ana.id}/${id}.pdf`,status:'pending',createdAt});
 await assert.rejects(deleteCourseData(store,users.ana.id,{now:Date.parse(createdAt)+60*1000}),{status:409});
 assert.equal(await store.count('certificates',{userId:users.ana.id}),2);assert.equal(await store.count('surveys',{userId:users.ana.id}),1);assert.equal(bytesRows(),1);
 await deleteCourseData(store,users.ana.id,{now:Date.parse(createdAt)+60*60*1000});
 assert.equal(await store.count('certificates',{userId:users.ana.id}),0);assert.equal(await store.count('surveys',{userId:users.ana.id}),0);assert.equal(bytesRows(),0);
 db.prepare('DELETE FROM users WHERE id=?').run(users.ana.id);
 // A response left by an account deleted outside the app path goes with the account.
 await start('bruno');db.prepare('DELETE FROM users WHERE id=?').run(users.bruno.id);
 assert.equal(await store.count('surveys',{courseId:course.id}),0);
});

test('the course page reads survey state only for enrolled members of the survey course',async()=>{
 const COURSE='10000000-0000-4000-8000-000000000001',OTHER='10000000-0000-4000-8000-000000000009',STAFF='10000000-0000-4000-8000-000000000002',MEMBER='10000000-0000-4000-8000-000000000003';
 const calls=[];
 const store={find:async(name,filter)=>{calls.push(name);if(name==='courses')return[{id:filter.id,status:'published',title:'Course'}];if(name==='enrollments')return filter.userId===MEMBER?[{userId:MEMBER,courseId:filter.courseId}]:[];if(name==='intakes')return filter.userId===MEMBER?[{answers:{fullName:'Ana',profession:'Arquitecta'}}]:[];return[];},getMembers:async()=>{calls.push('members');return[];}};
 const api=createCourseApi({store,finalSurvey:{...FINAL_SURVEY,courseId:COURSE},clock:()=>OPEN_AT});
 const view=async(id,user)=>{calls.length=0;const result={};await api({req:{method:'GET',headers:{}},res:{writeHead:status=>{result.status=status;},end:body=>{result.body=JSON.parse(body);}},url:new URL('/api/courses/'+id,'https://nodal.test'),user});return {...result,reads:[...calls].sort()};};
 const member=await view(COURSE,{id:MEMBER,permission:'member'});
 assert.deepEqual(member.reads,['certificates','courses','enrollments','intakes','modules','surveys']);assert.equal(member.body.finalSurvey.publishAs,'Ana, Arquitecta');
 for(const [id,user] of [[OTHER,{id:MEMBER,permission:'member'}],[COURSE,{id:STAFF,permission:'admin'}],[COURSE,{id:STAFF,permission:'member'}]])
  assert.deepEqual((await view(id,user)).reads,['courses','enrollments','intakes','modules']);
});

test('the rollout order, the published-course requirement and the privacy row are documented',async()=>{
 const {readFileSync}=await import('node:fs');
 const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
 const deployment=read('DEPLOYMENT.md'),notes=read('docs/implementation/course-final-survey.md');
 for(const text of [deployment,notes]) {
  assert.ok(text.includes('20261006004500_course_final_survey.sql'),'names the migration');
  assert.match(text,/before the code deploys|Do not deploy the code first/,'migration before deploy');
  assert.match(text,/Keep the course published/,'the course must stay published for certificates to stay downloadable');
 }
 assert.match(deployment,/supabase migration repair --status applied 20261006004500/);
 for(const [file,row] of [['en','| Course final survey and certificate |'],['es','| Encuesta final y certificado del curso |'],['pt-BR','| Pesquisa final e certificado do curso |']])
  assert.ok(read(`docs/privacy/privacy-policy.${file}.md`).includes(row),file);
});
