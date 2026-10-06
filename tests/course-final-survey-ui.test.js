import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import {SURVEY,FINAL_SURVEY} from '../server/course-final-survey.js';

// The participant section of courses.js and the organiser tab of teaching.js, driven by the server's real survey wording.
const script=name=>readFileSync(new URL('../web/scripts/'+name+'.js',import.meta.url),'utf8');
let focused=null;
class Node {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.listeners={};this.hidden=false;this.textContent='';this.value='';this.files=[];this.classList={toggle(){}};}
 append(...nodes){nodes.forEach(n=>{if(typeof n==='object')n.parent=this;this.children.push(n);});}
 prepend(...nodes){nodes.forEach(n=>n.parent=this);this.children.unshift(...nodes);}
 after(node){const p=this.parent;if(p){node.parent=p;p.children.splice(p.children.indexOf(this)+1,0,node);}}
 replaceChildren(...nodes){this.children=[];this.append(...nodes);}
 setAttribute(k,v){this[k]=v;}
 getAttribute(k){return this[k]??null;}
 removeAttribute(k){delete this[k];}
 addEventListener(k,f){this.listeners[k]=f;}
 querySelectorAll(selector){return descendants(this).filter(n=>selector==='input,textarea,select,button'?['input','textarea','select','button'].includes(n.tagName):selector==='button'?n.tagName==='button':selector==='[data-pilot-text]'?n.dataset.pilotText:selector==='[data-module]'?n.dataset.module:selector==='[data-pilot-dynamic]'?n.dataset.pilotDynamic:selector==='[data-pilot-placeholder]'?n.dataset.pilotPlaceholder:selector==='[data-pilot-aria]'?n.dataset.pilotAria:selector[0]==='.'?n.className?.split(' ').includes(selector.slice(1)):false);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 replaceWith(node){if(this.parent){node.parent=this.parent;this.parent.children.splice(this.parent.children.indexOf(this),1,node);}}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
 // Like a browser (Chromium checked): a disabled control cannot take focus, and disabling the focused one drops it to the body.
 focus(){if(!this.disabled)focused=this;}
 get disabled(){return this.isDisabled===true;}
 set disabled(value){this.isDisabled=Boolean(value);if(value&&focused===this)focused=null;}
 reset(){descendants(this).filter(n=>n.tagName==='input'||n.tagName==='textarea').forEach(n=>{n.value='';n.files=[];});}
}
const descendants=node=>(node.children||[]).flatMap(n=>typeof n==='object'?[n,...descendants(n)]:[]);
const content=n=>[n.textContent,...(n.children||[]).map(content)].join(' ');
// What a person sees: hidden nodes and everything inside them are left out.
const visible=n=>n.hidden?'':[n.textContent,...(n.children||[]).filter(c=>typeof c==='object').map(visible)].join(' ');
const flush=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));};
function harness(respond,{page='course',search='?id=c1'}={}){
 focused=null;
 const body=new Node('body');body.dataset.page=page;const html=new Node('html');const ids={};for(const id of ['pilotRoot','pilotStatus','teachingLink']){const n=new Node();n.id=id;ids[id]=n;body.append(n);}
 const requests=[],listeners=[],replaced=[];
 const document={body,documentElement:html,readyState:'loading',createElement:t=>new Node(t),getElementById:id=>ids[id]||descendants(body).find(n=>n.id===id),querySelector:()=>null,querySelectorAll:s=>body.querySelectorAll(s),visibilityState:'visible',addEventListener(){},removeEventListener(){},
  // A focused control that is disabled or removed from the page leaves focus on the body, as in a browser.
  get activeElement(){return focused&&!focused.disabled&&descendants(body).includes(focused)?focused:body;}};
 const ctx={document,console,Intl,URL,URLSearchParams,Error,Date,Promise,crypto:{randomUUID:()=>'00000000-0000-4000-8000-000000000001'},history:{replaceState(_s,_t,url){replaced.push(String(url));}},location:{pathname:'/'+page+'.html',search,href:'https://nodal.test/'+page+'.html'+search,assign(){},replace(){}},fetch:async(path,opts)=>{requests.push({path,body:opts?.body?JSON.parse(opts.body):undefined,method:opts?.method});const result=await respond(path,opts);return{ok:result.status===undefined||result.status<400,status:result.status||200,json:async()=>JSON.parse(JSON.stringify(result.data??result))};},window:{addEventListener(){},nodalI18n:{lang:'en',onChange:f=>listeners.push(f)}}};
 vm.createContext(ctx);for(const file of ['pilot-i18n','pilot'])vm.runInContext(script(file),ctx);
 return{ctx,body,ids,requests,replaced,run:name=>vm.runInContext(script(name),ctx),lang:lang=>{ctx.window.nodalI18n.lang=lang;listeners.forEach(f=>f());},section:()=>document.getElementById('encuestaFinal')};
}
const course={id:'c1',title:'Curso Movilidad Nivel 2',description:'Curso',status:'published',enrollmentOpen:false};
const SURVEY_JSON=JSON.parse(JSON.stringify(SURVEY));
const STARTED='2026-10-10T15:00:00.000Z',SENT='2026-10-12T15:42:00.000Z';
// GET /api/courses/:id's finalSurvey, in each state the server sends.
const open=(patch={})=>({closesAt:FINAL_SURVEY.closesAt,lastDay:'2026-10-23',open:true,contactEmail:FINAL_SURVEY.contactEmail,preview:false,response:null,certificate:null,publishAs:'Ana Pérez, Arquitecta',survey:SURVEY_JSON,...patch});
const started=(patch={})=>open({response:{startedAt:STARTED,submittedAt:null},...patch});
const sent=certificate=>({closesAt:FINAL_SURVEY.closesAt,lastDay:'2026-10-23',open:true,contactEmail:FINAL_SURVEY.contactEmail,preview:false,response:{startedAt:STARTED,submittedAt:SENT},certificate,publishAs:''});
const closed=(patch={})=>({closesAt:FINAL_SURVEY.closesAt,lastDay:'2026-10-23',open:false,contactEmail:FINAL_SURVEY.contactEmail,preview:false,response:null,certificate:null,publishAs:'',...patch});
const coursePayload=(finalSurvey,patch={})=>({course,modules:[],enrollment:{},intake:{fullName:'Ana Pérez',profession:'Arquitecta'},isAdmin:false,...(finalSurvey?{finalSurvey}:{}),...patch});
function participant(states,{search,write}={}){
 let current=states;const h=harness(async(path,opts)=>{
  if(opts?.method&&write){const reply=await write(path,opts,JSON.parse(opts.body||'{}'));if(reply!==undefined)return reply;}
  return coursePayload(typeof current==='function'?current():current);
 },{search});
 h.run('courses');return{...h,setState:value=>{current=value;}};
}
const inputs=(node,name)=>descendants(node).filter(n=>n.name===name);
const findKey=(node,key)=>descendants(node).find(n=>n.dataset.pilotText===key);
const choose=(node,name,value)=>{const input=inputs(node,name).find(n=>n.value===value);assert.ok(input,name+'='+value);input.checked=true;input.listeners.change?.();return input;};
const type=(node,name,value)=>{const input=inputs(node,name)[0];assert.ok(input,name);input.value=value;input.listeners.input?.();return input;};
const pickOption=(node,name,value)=>{const input=inputs(node,name)[0];input.value=value;input.listeners.change?.();return input;};
const form=node=>descendants(node).find(n=>n.tagName==='form'&&n.className==='pilot-survey');
const submit=node=>form(node).listeners.submit({preventDefault(){}});
const ASPECTS=['content','teachers','fieldwork','schedule','access','materials','value'];
function answerRequired(section){
 choose(section,'survey-overallWithoutSchedule','muy_buena');
 for(const row of ASPECTS)choose(section,'survey-aspects-'+row,row==='fieldwork'?'no_aplica':'satisfecho');
 choose(section,'survey-pace-difficulty','adecuado');choose(section,'survey-pace-sessions','insuficiente');choose(section,'survey-pace-sessionLength','adecuada');
 choose(section,'survey-application','bastante');choose(section,'survey-gender','female');type(section,'survey-age','34');pickOption(section,'survey-country','PE');
}
async function onScreenTwo(options){const h=participant(started(),options);await flush();await findKey(h.section(),'resumeSurvey').listeners.click();return h;}

test('members without the survey key, and any other course, render no survey section',async()=>{
 const h=participant(null);await flush();
 assert.equal(h.section(),undefined);assert.doesNotMatch(content(h.body),/Encuesta|Final survey/);
 assert.equal(h.requests.some(r=>r.path.includes('/survey')),false);
});

test('an open survey shows the approved intro and a call to action, and opens screen 1 with question 1 alone',async()=>{
 const h=participant(open());await flush();const section=h.section();
 assert.equal(findKey(section,'finalSurvey').textContent,'Final survey');
 const intro=descendants(section).find(n=>n.className==='pilot-closeout-intro');assert.equal(intro.textContent,SURVEY.intro);assert.equal(intro.lang,'es');
 assert.match(visible(section),/This survey is in Spanish/);assert.equal(form(section),undefined);
 await findKey(section,'startSurvey').listeners.click();
 const screen=form(section);assert.ok(screen);assert.equal(findKey(section,'startSurvey').hidden,true);
 assert.match(visible(screen),/Step 1 of 2/);assert.match(visible(screen),/A · Experiencia general/);
 assert.match(visible(screen),/1\. En general, ¿cómo calificarías tu experiencia con el curso\?/);
 assert.deepEqual(inputs(screen,'survey-overall').map(n=>n.value),['deficiente','regular','buena','muy_buena','excelente']);
 assert.equal(descendants(screen).filter(n=>n.tagName==='input').length,5,'nothing but question 1');
 assert.match(visible(screen),/After you continue, this answer can no longer be changed/);
 assert.equal(focused?.className,'pilot-survey-step','focus moves to the opened screen');
 h.lang('es');assert.match(visible(screen),/Después de continuar, esta respuesta ya no se podrá cambiar\./);assert.match(visible(screen),/Paso 1 de 2/);
 assert.doesNotMatch(visible(section),/La encuesta está en español/,'the language note is only for EN and PT');
});

test('continuing without an answer explains it next to the question and sends nothing',async()=>{
 const h=participant(open());await flush();const section=h.section();await findKey(section,'startSurvey').listeners.click();
 await submit(section);
 assert.equal(h.requests.some(r=>r.method==='PUT'),false);
 const radios=inputs(section,'survey-overall'),error=descendants(section).find(n=>n.className==='pilot-survey-error'&&!n.hidden);
 assert.equal(error.textContent,'Choose an option to continue.');
 assert.ok(radios.every(r=>r['aria-invalid']==='true'&&r['aria-describedby'].split(' ').includes(error.id)));
 assert.equal(error.parent['aria-describedby'],error.id,'the fieldset points to the error too');
 assert.equal(focused,radios[0]);
 h.lang('pt');assert.equal(error.textContent,'Escolha uma opção para continuar.');
 choose(section,'survey-overall','regular');assert.equal(error.hidden,true);assert.ok(radios.every(r=>r['aria-invalid']===undefined));
});

test('Continuar saves question 1, then screen 2 says it was saved without showing the answer and cannot change it',async()=>{
 const h=participant(open(),{write:(path,opts,body)=>path.endsWith('/survey/start')?{finalSurvey:started()}:undefined});await flush();
 const section=h.section();await findKey(section,'startSurvey').listeners.click();choose(section,'survey-overall','buena');await submit(section);
 const put=h.requests.find(r=>r.method==='PUT');assert.equal(put.path,'/api/courses/c1/survey/start');assert.deepEqual(put.body,{overall:'buena'});
 const screen=form(section);
 assert.match(visible(screen),/Step 2 of 2/);assert.match(visible(screen),/Your first answer is saved and can no longer be changed/);
 assert.equal(inputs(h.body,'survey-overall').length,0,'question 1 has no control left');
 assert.doesNotMatch(content(screen),/1\. En general|Your answer|Tu respuesta/);
 assert.equal(focused?.className,'pilot-survey-step');
 // The new state is kept in the snapshot: a re-render from it opens screen 2 again, never screen 1.
 assert.match(visible(screen),/2\. Ahora, dejando de lado/);assert.match(visible(screen),/15\. País de residencia/);
});

test('a refused start explains it and re-reads the state without reloading the rest of the page',async()=>{
 let state=open();const h=participant(()=>state,{write:path=>{if(path.endsWith('/survey/start')){state=started();return{status:409,data:{error:'the first answer is already saved',code:'survey_locked'}};}}});await flush();
 const section=h.section();await findKey(section,'startSurvey').listeners.click();choose(section,'survey-overall','excelente');await submit(section);
 assert.match(visible(h.section()),/Your first answer was already saved and can no longer be changed/);
 assert.ok(findKey(h.section(),'resumeSurvey'));assert.equal(h.section(),section,'the same section is updated in place');
 assert.equal(h.requests.filter(r=>r.path==='/api/courses/c1').length,2);
});

test('screen 2 shows every approved question with the right controls, and the optional tags only where needed',async()=>{
 const h=await onScreenTwo();const screen=form(h.section()),text=visible(screen);
 for(const section of SURVEY.sections)assert.match(text,new RegExp(section.id+' · '+section.title.replace(/[()]/g,'\\$&')));
 for(const q of SURVEY.sections.flatMap(s=>s.questions).filter(q=>q.screen===2&&q.id!=='testimonialConsent'))assert.ok(text.includes(q.number+'. '+q.label),q.label);
 for(const row of ASPECTS)assert.deepEqual(inputs(screen,'survey-aspects-'+row).map(n=>n.value),['muy_insatisfecho','insatisfecho','neutral','satisfecho','muy_satisfecho','no_aplica']);
 assert.equal(inputs(screen,'survey-pace-difficulty').length,5);assert.equal(inputs(screen,'survey-pace-sessions').length,3);assert.equal(inputs(screen,'survey-pace-sessionLength').length,3);
 // Each grid row is its own fieldset nested in the question's fieldset (a block on a phone).
 const grid=descendants(screen).find(n=>n.className==='pilot-survey-question pilot-survey-grid');assert.equal(descendants(grid).filter(n=>n.className==='pilot-survey-row').length,7);
 assert.equal(grid.tagName,'fieldset');assert.ok(descendants(grid).filter(n=>n.className==='pilot-survey-row').every(n=>n.tagName==='fieldset'&&n.children[0].tagName==='legend'));
 assert.equal(inputs(screen,'survey-improvements')[0].tagName,'textarea');assert.equal(inputs(screen,'survey-improvements')[0].maxLength,3000);
 assert.equal(inputs(screen,'survey-mostUseful')[0].maxLength,300);assert.equal(inputs(screen,'survey-testimonial')[0].maxLength,2000);
 assert.match(text,/Por ejemplo: contenido, metodología, ejercicio práctico, organización\./);assert.match(text,/No es necesario para tu certificado\./);
 assert.match(text,/Elige hasta 3\./);assert.match(text,/Elige hasta 2\./);
 assert.equal(descendants(screen).filter(n=>n.dataset.pilotText==='surveyOptional').length,2,'only questions 6 and 7: sections C and D say opcional already');
 const country=inputs(screen,'survey-country')[0];assert.equal(country.tagName,'select');
 assert.deepEqual(country.children.map(o=>o.textContent),['Choose a country','Perú','Argentina','Bolivia','Brasil','Chile','Colombia','Costa Rica','Cuba','Ecuador','El Salvador','Guatemala','Honduras','México','Nicaragua','Panamá','Paraguay','Puerto Rico','República Dominicana','Uruguay','Venezuela','España','Estados Unidos','Otro (¿cuál?)']);
 assert.deepEqual(inputs(screen,'survey-gender').map(n=>n.value),['female','male','other','prefer_not']);
 // Every survey control is named survey-…, so it never collides with the course form or a post composer.
 assert.ok(descendants(screen).filter(n=>['input','textarea','select'].includes(n.tagName)).every(n=>n.name.startsWith('survey-')));
 // Spanish content carries lang=es; the chrome around it does not.
 assert.ok(descendants(screen).filter(n=>n.tagName==='legend').every(n=>n.children[0].lang==='es'));
 assert.equal(findKey(screen,'surveyLockedNote').lang,undefined);assert.equal(findKey(screen,'surveySubmit').tagName,'button');
 h.lang('es');assert.match(visible(screen),/Enviar encuesta/);assert.match(visible(screen),/Contenido de las sesiones/);
 h.lang('pt');assert.match(visible(screen),/Enviar pesquisa/);assert.match(visible(screen),/Califica los siguientes aspectos del curso\./);assert.match(visible(screen),/Escolha um país/);
});

test('sending with required answers missing marks each one, announces a summary, focuses the first and sends nothing',async()=>{
 const h=await onScreenTwo();const section=h.section();
 choose(section,'survey-overallWithoutSchedule','buena');choose(section,'survey-aspects-content','neutral');
 await submit(section);
 assert.equal(h.requests.some(r=>r.method==='POST'),false);
 const errors=descendants(section).filter(n=>n.className==='pilot-survey-error'&&!n.hidden);
 // 6 aspects rows, 3 pace rows, application, gender, age and country.
 assert.equal(errors.length,13);assert.ok(errors.every(n=>n.textContent==='This question is required.'));
 const summary=descendants(section).find(n=>n.role==='status'&&n.textContent==='Some required questions are missing. Check the ones marked below.');
 assert.equal(summary.textContent,'Some required questions are missing. Check the ones marked below.');assert.equal(summary.role,'status');assert.equal(summary['aria-live'],'polite');
 assert.equal(focused,inputs(section,'survey-aspects-teachers')[0],'focus goes to the first unanswered row');
 assert.equal(inputs(section,'survey-aspects-content')[0]['aria-invalid'],undefined);assert.equal(inputs(section,'survey-aspects-teachers')[0]['aria-invalid'],'true');
 type(section,'survey-age','30.5');pickOption(section,'survey-country','other');await submit(section);
 assert.ok(errors.some(n=>n.textContent==='Enter your age as a whole number.'));assert.ok(descendants(section).some(n=>!n.hidden&&n.textContent==='Write which one.'));
 const countryOther=inputs(section,'survey-countryOther')[0];assert.equal(countryOther.hidden,false);assert.equal(countryOther['aria-invalid'],'true');assert.equal(inputs(section,'survey-country')[0]['aria-invalid'],undefined,'the chosen country itself is valid');
 h.lang('es');assert.ok(descendants(section).some(n=>!n.hidden&&n.textContent==='Esta pregunta es obligatoria.'));assert.match(visible(section),/Faltan preguntas obligatorias\. Revisa las marcadas abajo\./);
});

test('question 8 is shuffled once with Otro last, allows three choices and asks which other topic',async()=>{
 const h=participant(started());vm.runInContext('Math.random=()=>0',h.ctx);await flush();await findKey(h.section(),'resumeSurvey').listeners.click();const section=h.section();
 const order=inputs(section,'survey-topics').map(n=>n.value),original=SURVEY.sections[2].questions[0].options.map(o=>o.id);
 assert.equal(order.at(-1),'other');assert.notDeepEqual(order,original);assert.deepEqual([...order].sort(),[...original].sort());
 const other=inputs(section,'survey-topicsOther')[0];assert.equal(other.hidden,true);assert.equal(other.maxLength,160);
 choose(section,'survey-topics',order[0]);choose(section,'survey-topics',order[1]);choose(section,'survey-topics','other');assert.equal(other.hidden,false);
 const fourth=choose(section,'survey-topics',order[2]);assert.equal(fourth.checked,false,'a fourth topic is refused');
 assert.ok(descendants(section).some(n=>!n.hidden&&n.textContent==='You already chose 3. Uncheck one to choose another.'));
 assert.ok(inputs(section,'survey-topics').every(n=>!n.disabled),'nothing leaves the tab order');
 // Focus stays on the box, so the screen's polite status line says why too; no box is marked invalid for a notice.
 const notice=descendants(form(section)).find(n=>n.role==='status');assert.equal(notice['aria-live'],'polite');
 assert.equal(notice.textContent,'You already chose 3. Uncheck one to choose another.');assert.ok(inputs(section,'survey-topics').every(n=>n['aria-invalid']===undefined));
 h.lang('es');assert.equal(notice.textContent,'Ya elegiste 3. Desmarca una para elegir otra.');h.lang('en');
 // The next change lets the notice go, there and under the question.
 const firstTopic=inputs(section,'survey-topics').find(n=>n.value===order[0]);firstTopic.checked=false;firstTopic.listeners.change();
 assert.equal(notice.textContent,'');assert.equal(visible(section).includes('You already chose 3.'),false);
 choose(section,'survey-topics',order[0]);
 choose(section,'survey-valued','redes');choose(section,'survey-valued','recursos');assert.equal(choose(section,'survey-valued','conocimiento').checked,false);
 answerRequired(section);await submit(section);assert.equal(h.requests.some(r=>r.method==='POST'),false);assert.equal(focused,other);
});

test('question 12 appears only for a written message, names the exact publication name and is then required',async()=>{
 const h=await onScreenTwo();const section=h.section(),consent=descendants(section).find(n=>n.tagName==='fieldset'&&content(n).includes('12. ¿Podemos publicar'));
 assert.equal(consent.hidden,true);
 type(section,'survey-testimonial','   ');assert.equal(consent.hidden,true,'blank text is no message');
 type(section,'survey-testimonial','Me encantó el ejercicio de campo.');assert.equal(consent.hidden,false);
 assert.match(visible(consent),/Sí, como: Ana Pérez, Arquitecta/);assert.match(visible(consent),/Sí, de forma anónima/);assert.match(visible(consent),/No, es solo para el equipo/);
 assert.match(visible(consent),/Podemos acortarlo o corregir la ortografía sin cambiar su sentido\. Si cambias de opinión, escríbenos a observatorio@limacomovamos\.org y lo retiramos\./);
 // The note under the options describes the group and each option, so it is read while choosing.
 const note=descendants(consent).find(n=>n.textContent.startsWith('Podemos acortarlo'));assert.ok(note.id);assert.equal(note.lang,'es');
 assert.ok([consent,...inputs(section,'survey-testimonialConsent')].every(n=>n['aria-describedby']===note.id));
 answerRequired(section);await submit(section);assert.equal(h.requests.some(r=>r.method==='POST'),false);assert.equal(focused,inputs(section,'survey-testimonialConsent')[0]);
 const error=descendants(consent).find(n=>n.className==='pilot-survey-error');assert.equal(error.hidden,false);
 assert.ok([consent,...inputs(section,'survey-testimonialConsent')].every(n=>n['aria-describedby']===note.id+' '+error.id),'the note stays next to the error');
 choose(section,'survey-testimonialConsent','named');type(section,'survey-testimonial','');
 assert.equal(consent.hidden,true);assert.ok(inputs(section,'survey-testimonialConsent').every(n=>!n.checked),'emptying the message clears the choice');
});

test('optional question 9 can go back to blank, with a clear button shown only while a format is chosen',async()=>{
 const h=await onScreenTwo({write:path=>path.endsWith('/survey')?{finalSurvey:sent('preparing')}:undefined});const section=h.section();
 assert.equal(descendants(section).filter(n=>n.dataset.pilotText==='surveyClearChoice').length,1,'question 9 is the only optional single choice');
 const reset=findKey(section,'surveyClearChoice'),formats=inputs(section,'survey-format');
 assert.equal(reset.tagName,'button');assert.equal(reset.type,'button');assert.match(content(reset.parent),/9\. ¿Qué formato prefieres/);assert.equal(reset.hidden,true);
 choose(section,'survey-format','hibrido');assert.equal(reset.hidden,false);assert.equal(reset.textContent,'Clear selection');
 reset.focus();reset.listeners.click();
 assert.ok(formats.every(n=>!n.checked));assert.equal(reset.hidden,true);assert.equal(focused,formats[0],'focus stays in the question');
 h.lang('es');assert.equal(reset.textContent,'Borrar selección');h.lang('pt');assert.equal(reset.textContent,'Limpar seleção');
 answerRequired(section);await submit(section);
 assert.equal(h.requests.find(r=>r.method==='POST').body.answers.format,'');
});

test('without any name to publish under, "Sí, como:" is not offered',async()=>{
 const h=participant(started({publishAs:''}));await flush();await findKey(h.section(),'resumeSurvey').listeners.click();
 type(h.section(),'survey-testimonial','Gracias');
 const options=inputs(h.section(),'survey-testimonialConsent');assert.equal(options.find(n=>n.value==='named').parent.hidden,true);
 assert.ok(options.filter(n=>n.value!=='named').every(n=>!n.parent.hidden));assert.doesNotMatch(visible(h.section()),/Sí, como:/);
});

test('a complete send posts typed answers with the publication name and shows Mi certificado',async()=>{
 const h=await onScreenTwo({write:path=>path.endsWith('/survey')?{finalSurvey:sent('ready')}:undefined});const section=h.section();
 answerRequired(section);type(section,'survey-mostUseful','El trabajo de campo');choose(section,'survey-topics','seguridad_vial');choose(section,'survey-topics','other');type(section,'survey-topicsOther','Logística urbana');
 choose(section,'survey-format','hibrido');type(section,'survey-testimonial','Muy útil');choose(section,'survey-testimonialConsent','named');
 await submit(section);
 const post=h.requests.find(r=>r.method==='POST');assert.equal(post.path,'/api/courses/c1/survey');assert.equal(post.body.publishAs,'Ana Pérez, Arquitecta');
 assert.deepEqual(post.body.answers,{overallWithoutSchedule:'muy_buena',aspects:{content:'satisfecho',teachers:'satisfecho',fieldwork:'no_aplica',schedule:'satisfecho',access:'satisfecho',materials:'satisfecho',value:'satisfecho'},pace:{difficulty:'adecuado',sessions:'insuficiente',sessionLength:'adecuada'},application:'bastante',mostUseful:'El trabajo de campo',improvements:'',topics:['seguridad_vial','other'],topicsOther:'Logística urbana',format:'hibrido',valued:[],testimonial:'Muy útil',testimonialConsent:'named',gender:'female',age:34,country:'PE',countryOther:''});
 assert.equal('overall' in post.body.answers,false);
 assert.equal(form(section),undefined);assert.match(visible(section),/Thank you\. Your survey was sent\./);assert.match(visible(section),/Sent on October 12, 2026\./);
 assert.equal(findKey(section,'myCertificate').textContent,'My certificate');assert.equal(focused,findKey(section,'myCertificate'));
 assert.equal(findKey(section,'certificateReady').className,'pilot-certificate-state is-ready');
 const download=findKey(section,'downloadCertificate');assert.equal(download.href,'/api/courses/c1/certificate');assert.equal(download.tagName,'a');
 h.lang('es');assert.match(visible(section),/Mi certificado/);assert.match(visible(section),/Listo/);assert.match(visible(section),/Enviada el 12 de octubre de 2026\./);assert.match(visible(section),/Descargar mi certificado \(PDF\)/);
});

test('a sent survey without a certificate yet says it is being prepared, with the contact address',async()=>{
 const h=participant(sent('preparing'));await flush();const section=h.section();
 assert.equal(form(section),undefined);assert.equal(findKey(section,'downloadCertificate'),undefined);
 h.lang('es');assert.match(visible(section),/Se está preparando/);assert.match(visible(section),/Vuelve a esta página en unos días\. Consultas:/);
 const mail=descendants(section).find(n=>n.href==='mailto:observatorio@limacomovamos.org');assert.equal(mail.textContent,'observatorio@limacomovamos.org');
});

test('after 23 October the form is closed: one line, no form, no buttons',async()=>{
 const h=participant(closed());await flush();const section=h.section();
 assert.match(visible(section),/The survey closed on October 23\./);assert.equal(descendants(section).some(n=>['form','button','input'].includes(n.tagName)),false);
 h.lang('es');assert.match(visible(section),/La encuesta cerró el 23 de octubre\./);h.lang('pt');assert.match(visible(section),/A pesquisa foi encerrada em 23 de outubro\./);
 // A person who sent it before the close keeps the certificate.
 const kept=participant({...sent('ready'),open:false});await flush();assert.ok(findKey(kept.section(),'downloadCertificate'));
});

test('organisers get a read-only preview: the screens move locally and nothing can be sent',async()=>{
 const h=participant(open({preview:true,publishAs:'Flavia Muro'}));await flush();const section=h.section();
 assert.match(visible(section),/Organiser preview: answers are not sent\./);
 await findKey(section,'previewSurvey').listeners.click();choose(section,'survey-overall','buena');await submit(section);
 assert.equal(h.requests.some(r=>r.method),false,'no request at all');
 assert.match(visible(form(section)),/Step 2 of 2/);assert.equal(findKey(form(section),'surveySubmit'),undefined);
 assert.match(visible(form(section)),/Organiser preview: answers are not sent\./);
 answerRequired(section);await submit(section);assert.equal(h.requests.some(r=>r.method),false);
 const after=participant(closed({preview:true}));await flush();
 assert.match(visible(after.section()),/The survey closed on October 23\./);assert.match(visible(after.section()),/Organiser preview/);assert.equal(form(after.section()),undefined);
 assert.equal(findKey(after.section(),'previewSurvey'),undefined);
});

test('the admin course page shows the preview to organisers who are not enrolled',async()=>{
 const h=harness(()=>coursePayload(open({preview:true}),{enrollment:null,intake:null,isAdmin:true}));h.run('courses');await flush();
 assert.ok(h.section());assert.ok(findKey(h.section(),'previewSurvey'));assert.equal(findKey(h.section(),'startSurvey'),undefined);
});

test('an enrolled member without a course form gets the survey before the intake form',async()=>{
 const fresh=harness(()=>coursePayload(open(),{intake:null}));fresh.run('courses');await flush();
 const children=fresh.ids.pilotRoot.children,survey=children.findIndex(n=>n.id==='encuestaFinal'),intake=children.findIndex(n=>n.className==='pilot-intake');
 assert.ok(survey>0&&intake>survey,'hero, survey, then the intake form');
 // Intake and survey controls never share a name.
 assert.equal(inputs(fresh.body,'experience').length,1);assert.equal(inputs(fresh.body,'survey-overall').length,0);
});

test('re-rendering the course keeps the open screen, typed answers, question 8 order and refreshes the publication name',async()=>{
 let state=started();const h=harness((path,opts)=>path.endsWith('/intake')?{intake:{fullName:'Ana Pérez Soto'}}:coursePayload(state),{});
 vm.runInContext('Math.random=()=>0.42',h.ctx);h.run('courses');await flush();await findKey(h.section(),'resumeSurvey').listeners.click();
 const section=h.section(),screen=form(section),age=type(section,'survey-age','41'),order=inputs(section,'survey-topics').map(n=>n.value);
 choose(section,'survey-aspects-value','muy_satisfecho');type(section,'survey-testimonial','Gracias por todo');
 // Saving the course form re-renders the whole course from a fresh read.
 state=started({publishAs:'Ana Pérez Soto, Arquitecta'});
 await findKey(h.body,'editIntake').listeners.click();const intake=descendants(h.body).find(n=>n.tagName==='form'&&inputs(n,'profession').length);await intake.listeners.submit({preventDefault(){}});await flush();
 assert.equal(h.section(),section);assert.equal(form(h.section()),screen);assert.equal(inputs(h.body,'survey-age')[0],age);assert.equal(age.value,'41');
 assert.equal(inputs(h.body,'survey-aspects-value').find(n=>n.value==='muy_satisfecho').checked,true);
 assert.deepEqual(inputs(h.body,'survey-topics').map(n=>n.value),order);
 assert.match(visible(section),/Sí, como: Ana Pérez Soto, Arquitecta/);
});

test('deleting the course form after sending re-renders from the stored state, never the open form again',async()=>{
 const h=await onScreenTwo({write:(path,opts)=>path.endsWith('/survey')?{finalSurvey:sent('preparing')}:opts.method==='DELETE'?{ok:true}:undefined});h.ctx.confirm=()=>true;
 answerRequired(h.section());await submit(h.section());assert.ok(findKey(h.section(),'certificatePreparing'));
 await findKey(h.body,'deleteIntake').listeners.click();await flush();
 assert.ok(findKey(h.section(),'certificatePreparing'));assert.equal(findKey(h.section(),'resumeSurvey'),undefined);assert.equal(form(h.section()),undefined);
});

test('refusals on send: a changed name keeps every answer, a closed survey or one sent elsewhere switches the state',async()=>{
 let state=started(),reply=null;const h=participant(()=>state,{write:path=>path.endsWith('/survey')?reply():undefined});await flush();await findKey(h.section(),'resumeSurvey').listeners.click();
 const section=h.section(),screen=form(section);answerRequired(section);type(section,'survey-testimonial','Un mensaje');choose(section,'survey-testimonialConsent','named');
 reply=()=>{state=started({publishAs:'Ana P., Urbanista'});return{status:409,data:{error:'the publication name changed',code:'survey_changed'}};};
 await submit(section);
 assert.equal(form(h.section()),screen);assert.equal(inputs(section,'survey-age')[0].value,'34');assert.match(visible(section),/Sí, como: Ana P\., Urbanista/);
 assert.match(visible(screen),/Your name or profession changed/);
 reply=()=>{state=closed();return{status:403,data:{error:'the survey is closed',code:'survey_closed'}};};
 await submit(section);assert.equal(form(h.section()),undefined);assert.match(visible(h.section()),/The survey is closed\./);assert.match(visible(h.section()),/The survey closed on October 23\./);
 assert.equal(focused,findKey(h.section(),'finalSurvey'));
});

test('a refused answer named by the server is marked on its question, and a network failure keeps everything',async()=>{
 let reply;const h=await onScreenTwo({write:path=>path.endsWith('/survey')?reply():undefined});const section=h.section(),screen=form(section);answerRequired(section);
 reply=()=>({status:400,data:{error:'invalid survey answer',code:'survey_invalid',field:'age'}});await submit(section);
 assert.equal(inputs(section,'survey-age')[0]['aria-invalid'],'true');assert.equal(focused,inputs(section,'survey-age')[0]);assert.match(visible(screen),/Check your answers: one is missing or not valid\./);
 reply=()=>{throw new TypeError('offline');};await submit(section);
 assert.equal(form(h.section()),screen);assert.equal(inputs(section,'survey-age')[0].value,'34');assert.match(visible(screen),/Connection interrupted/);assert.equal(findKey(screen,'surveySubmit').disabled,false);
});

test('the reminder link opens the form once and leaves the address',async()=>{
 const h=participant(started(),{search:'?id=c1&encuesta=1'});await flush();
 assert.ok(form(h.section()));assert.match(visible(form(h.section())),/Step 2 of 2/);assert.equal(focused,findKey(h.section(),'finalSurvey'));
 assert.equal(h.replaced[0],'https://nodal.test/course.html?id=c1');
 const fresh=participant(open(),{search:'?id=c1&encuesta=1'});await flush();assert.match(visible(form(fresh.section())),/Step 1 of 2/);
});

test('every interface key the survey section renders exists in English, Spanish and Portuguese',async()=>{
 const keys=new Set();const collect=node=>descendants(node).forEach(n=>{if(n.dataset.pilotText)keys.add(n.dataset.pilotText);});
 for(const state of [open(),closed(),sent('ready'),sent('preparing'),open({preview:true}),closed({preview:true})]){const h=participant(state);await flush();collect(h.section());}
 const h=await onScreenTwo();await submit(h.section());collect(h.section());
 const rows=h.ctx.window.pilotI18n.rows;
 for(const key of keys)assert.ok(rows[key]?.length===3&&rows[key].every(v=>typeof v==='string'&&v.trim()),key);
 for(const key of ['surveyRequiredQuestion','surveyRequiredSummary','surveyOtherRequired','surveyAgeInvalid','surveyMaxChoices','surveyClearChoice','surveyChooseOne','surveyInvalidAnswer','surveyThanks','surveySentOn','surveyClosedOn','surveyStep','surveySaving','surveySending'])assert.ok(rows[key],key);
});

/* The organiser tab of teaching.js. */
const people=[
 {userId:'u-ana',name:'Ana Pérez',email:'ana.perez@example.com',enrolledAt:'2026-09-01T00:00:00Z',startedAt:STARTED,submittedAt:SENT,certificate:{id:'cert-1',size:900,createdAt:'2026-10-13T14:00:00.000Z'}},
 {userId:'u-bruno',name:'Bruno Díaz',email:'Bruno@Example.com ',enrolledAt:'2026-09-01T00:00:00Z',startedAt:STARTED,submittedAt:null,certificate:null},
 {userId:'u-carla',name:'Carla Soto',email:'carla@example.com',enrolledAt:'2026-09-01T00:00:00Z',startedAt:null,submittedAt:null,certificate:null},
 {userId:'u-nomail',name:'Sin Correo',email:null,enrolledAt:'2026-09-01T00:00:00Z',startedAt:null,submittedAt:null,certificate:null},
];
const statusList=(patch={})=>({closesAt:FINAL_SURVEY.closesAt,lastDay:'2026-10-23',open:true,contactEmail:FINAL_SURVEY.contactEmail,total:4,answered:1,started:1,certificates:1,participants:people,...patch});
const pdf=(name,stamp=1,body='JVBERi0xLjQK')=>({name,size:200,lastModified:stamp,type:'application/pdf',body});
function organiser({finalSurvey=open({preview:true}),write,list=()=>statusList()}={}){
 const h=harness(async(path,opts)=>{
  if(opts?.method){const reply=await write?.(path,opts,JSON.parse(opts.body||'{}'));return reply??{certificate:{id:'new'},replaced:false};}
  if(path==='/api/admin/courses')return{courses:[course]};
  if(path.endsWith('/report'))return{summary:{enrolled:4},participants:[],feedback:[],invitations:[]};
  if(path.endsWith('/final-survey'))return list();
  return{course,modules:[],...(finalSurvey?{finalSurvey}:{})};
 },{page:'teaching',search:''});
 h.ctx.FileReader=class{readAsDataURL(file){this.result='data:application/pdf;base64,'+file.body;this.onload();}};h.ctx.confirm=()=>true;
 h.run('teaching');return{...h,pane:()=>h.ctx.document.getElementById('staff-pane-finalSurvey'),tab:()=>h.ctx.document.getElementById('staff-tab-finalSurvey')};
}
const writes=h=>h.requests.filter(r=>r.method);
const rowOf=(pane,name)=>descendants(pane).find(n=>n.tagName==='tr'&&content(n).includes(name));

test('courses without the survey get no survey tab and never read the survey list',async()=>{
 const h=organiser({finalSurvey:null});await flush();
 assert.equal(h.tab(),undefined);assert.equal(h.pane(),undefined);assert.equal(h.requests.some(r=>r.path.includes('final-survey')),false);
});

test('the survey tab sits after Participants, loads on first opening and lists only participants with their status',async()=>{
 const h=organiser();await flush();
 const tabs=descendants(h.body).find(n=>n.className==='pilot-tabs');assert.deepEqual(tabs.children.map(n=>n.id),['staff-tab-responses','staff-tab-participants','staff-tab-finalSurvey','staff-tab-courseSetup']);
 assert.equal(h.pane().hidden,true);assert.equal(h.requests.some(r=>r.path.includes('final-survey')),false,'nothing is read before the tab opens');
 h.tab().listeners.click();await flush();h.tab().listeners.click();await flush();
 assert.equal(h.requests.filter(r=>r.path==='/api/admin/courses/c1/final-survey').length,1);assert.equal(h.pane().hidden,false);
 const pane=h.pane();assert.match(visible(pane),/Answered: 1 of 4 · Certificates uploaded: 1/);assert.match(visible(pane),/Started without finishing: 1/);
 // Counts read as 'label: n', so a count of one is never put in the plural ('1 certificates uploaded').
 assert.doesNotMatch(visible(pane),/\b1 (?:certificates|started)\b/);assert.match(visible(pane),/Open until the end of October 23 \(Lima time\)\./);
 assert.match(visible(rowOf(pane,'Ana Pérez')),/Answered/);assert.match(visible(rowOf(pane,'Ana Pérez')),/Oct 12, 2026/);assert.match(visible(rowOf(pane,'Ana Pérez')),/Uploaded/);
 assert.match(visible(rowOf(pane,'Bruno Díaz')),/Started \(question 1 only\)/);assert.match(visible(rowOf(pane,'Bruno Díaz')),/Missing/);
 assert.match(visible(rowOf(pane,'Carla Soto')),/Not yet/);
 assert.ok(descendants(pane).some(n=>n.href==='/api/admin/courses/c1/export?type=survey'));assert.ok(descendants(pane).some(n=>n.href==='/api/admin/courses/c1/export?type=survey-status'));
 assert.equal(inputs(pane,'survey-reminder-link')[0].value,'https://nodal.test/course.html?id=c1&encuesta=1');assert.equal(inputs(pane,'survey-reminder-link')[0].readOnly,true);
 const download=descendants(rowOf(pane,'Ana Pérez')).find(n=>n.tagName==='a');assert.equal(download.href,'/api/admin/courses/c1/certificates/u-ana');assert.equal(download['aria-label'],'Download the certificate of Ana Pérez');
 assert.equal(findKey(rowOf(pane,'Bruno Díaz'),'uploadCertificate')['aria-label'],'Upload the certificate PDF of Bruno Díaz');
 assert.equal(findKey(rowOf(pane,'Ana Pérez'),'replaceCertificate')['aria-label'],'Replace the certificate of Ana Pérez');
 h.lang('es');assert.match(visible(pane),/Respondieron: 1 de 4 · Certificados subidos: 1/);assert.match(visible(pane),/Empezaron sin terminar: 1/);assert.doesNotMatch(visible(pane),/\b1 (?:certificados|empezaron)\b/);assert.match(visible(rowOf(pane,'Bruno Díaz')),/Empezó \(solo pregunta 1\)/);assert.match(visible(rowOf(pane,'Carla Soto')),/Todavía no/);
 assert.equal(findKey(rowOf(pane,'Ana Pérez'),'deleteCertificate')['aria-label'],'Eliminar el certificado de Ana Pérez');
 const closedList=organiser({list:()=>statusList({open:false})});await flush();closedList.tab().listeners.click();await flush();assert.match(visible(closedList.pane()),/The survey closed on October 23\./);
 const empty=organiser({list:()=>statusList({total:0,answered:0,started:0,certificates:0,participants:[]})});await flush();empty.tab().listeners.click();await flush();assert.match(visible(empty.pane()),/No enrollments yet\./);
});

test('one certificate is checked in the browser, uploaded as a PDF, replaced and deleted only after confirmation',async()=>{
 const h=organiser();await flush();h.tab().listeners.click();await flush();const pane=h.pane();
 const picker=inputs(pane,'survey-certificate-u-bruno')[0];assert.equal(picker.hidden,true);assert.equal(picker.accept,'application/pdf,.pdf');
 // The organiser works from the keyboard: the pressed button is disabled while busy, which drops focus to the page.
 const pressed=findKey(rowOf(pane,'Bruno Díaz'),'uploadCertificate');pressed.focus();
 picker.files=[pdf('not-a-pdf.pdf',1,'aGVsbG8=')];picker.listeners.change();await flush();
 assert.equal(writes(h).length,0);assert.match(visible(pane),/The file must be a PDF of up to 3 MB\./);assert.equal(focused,pressed,'a refused file gives focus back too');
 picker.files=[{...pdf('big.pdf'),size:3*1024*1024+1}];picker.listeners.change();await flush();assert.equal(writes(h).length,0);
 picker.files=[pdf('bruno.pdf')];picker.listeners.change();await flush();
 const put=writes(h)[0];assert.equal(put.method,'PUT');assert.equal(put.path,'/api/admin/courses/c1/certificates/u-bruno');assert.deepEqual(put.body,{mime:'application/pdf',data:'JVBERi0xLjQK'});
 assert.match(visible(h.pane()),/Certificate uploaded\./);assert.equal(h.requests.filter(r=>r.path.endsWith('/final-survey')).length,2,'the list is read again');
 const redrawn=findKey(rowOf(h.pane(),'Bruno Díaz'),'uploadCertificate');assert.notEqual(redrawn,pressed);
 assert.equal(focused,redrawn,'focus returns to the same row once its button is enabled again');assert.equal(redrawn.disabled,false);
 h.ctx.confirm=()=>false;await findKey(rowOf(h.pane(),'Ana Pérez'),'deleteCertificate').listeners.click();assert.equal(writes(h).filter(r=>r.method==='DELETE').length,0);
 h.ctx.confirm=()=>true;findKey(rowOf(h.pane(),'Ana Pérez'),'deleteCertificate').focus();await findKey(rowOf(h.pane(),'Ana Pérez'),'deleteCertificate').listeners.click();await flush();
 assert.equal(writes(h).find(r=>r.method==='DELETE').path,'/api/admin/courses/c1/certificates/u-ana');assert.match(visible(h.pane()),/Certificate deleted\./);
 assert.equal(focused,findKey(rowOf(h.pane(),'Ana Pérez'),'replaceCertificate'),'after a delete focus lands on the same row');
 // Focus the organiser has moved elsewhere meanwhile stays where it is.
 const elsewhere=inputs(h.pane(),'survey-reminder-link')[0];
 findKey(rowOf(h.pane(),'Carla Soto'),'uploadCertificate').focus();const carla=inputs(h.pane(),'survey-certificate-u-carla')[0];carla.files=[pdf('carla.pdf')];carla.listeners.change();elsewhere.focus();await flush();
 assert.equal(focused,elsewhere);
});

test('bulk upload matches file names to emails, lists strangers and duplicates, and sends one PDF per person without names',async()=>{
 let confirmText='';const h=organiser();await flush();h.ctx.confirm=text=>{confirmText=text;return true;};h.tab().listeners.click();await flush();
 const pane=h.pane(),files=inputs(pane,'survey-certificate-files')[0];assert.equal(files.multiple,true);
 files.files=[pdf('ANA.Perez@Example.com.pdf'),pdf('nadie@x.pdf'),pdf('bruno@example.com.pdf',2),pdf('BRUNO@EXAMPLE.COM.PDF',3),pdf('carla@example.com.pdf'),pdf('carla@example.com (1).pdf'),pdf('.pdf')];
 files.listeners.change();
 // Before anything is sent the organiser sees who each file goes to.
 assert.match(visible(pane),/ANA\.Perez@Example\.com\.pdf → Ana Pérez/);assert.match(visible(pane),/replaces the current certificate/);assert.match(visible(pane),/carla@example\.com\.pdf → Carla Soto/);
 assert.equal(writes(h).length,0);
 findKey(pane,'uploadCertificates').focus();await findKey(pane,'uploadCertificates').listeners.click();await flush();
 assert.equal(focused,findKey(pane,'uploadCertificates'),'focus is back on the button once the run ends');
 assert.equal(confirmText,'People who already have a certificate: 1. Replace their certificates with the new files?');
 assert.deepEqual(writes(h).map(r=>r.path),['/api/admin/courses/c1/certificates/u-ana','/api/admin/courses/c1/certificates/u-carla']);
 assert.ok(writes(h).every(r=>JSON.stringify(Object.keys(r.body))===JSON.stringify(['mime','data'])),'file names never travel');
 const report=descendants(pane).find(n=>n.className==='pilot-bulk-report');
 assert.match(visible(pane),/Uploaded: 2\./);
 assert.match(visible(report),/No participant with this email:.*nadie@x\.pdf/s);assert.match(visible(report),/carla@example\.com \(1\)\.pdf/);
 assert.match(visible(report),/More than one file for the same email \(not uploaded\):.*bruno@example\.com\.pdf.*BRUNO@EXAMPLE\.COM\.PDF/s);
 assert.equal(h.requests.some(r=>r.path.includes('nadie')||r.path.includes('u-bruno')),false);
});

test('bulk upload stops on a rate limit and a second press continues with the files not yet sent',async()=>{
 let limited=true;const h=organiser({write:path=>path.endsWith('/u-carla')&&limited?{status:429,data:{error:'too many requests'}}:undefined});await flush();h.tab().listeners.click();await flush();
 const pane=h.pane(),files=inputs(pane,'survey-certificate-files')[0];files.files=[pdf('bruno@example.com.pdf'),pdf('carla@example.com.pdf'),pdf('nope.pdf',9,'aGVsbG8=')];
 await findKey(pane,'uploadCertificates').listeners.click();await flush();
 assert.deepEqual(writes(h).map(r=>r.path.split('/').at(-1)),['u-bruno','u-carla']);assert.match(visible(pane),/Upload stopped\. Press Upload certificates again to continue with the rest\./);assert.match(visible(pane),/Uploaded: 1\./);
 limited=false;await findKey(pane,'uploadCertificates').listeners.click();await flush();
 assert.deepEqual(writes(h).map(r=>r.path.split('/').at(-1)),['u-bruno','u-carla','u-carla'],'bruno is not sent twice');
 await findKey(pane,'uploadCertificates').listeners.click();await flush();assert.equal(writes(h).length,3);assert.match(visible(pane),/These files were already uploaded/);
 // A file the server refuses is reported and the run goes on.
 const refusing=organiser({write:path=>path.endsWith('/u-bruno')?{status:400,data:{error:'a PDF of up to 3 MB is required',code:'certificate_invalid'}}:undefined});await flush();refusing.tab().listeners.click();await flush();
 inputs(refusing.pane(),'survey-certificate-files')[0].files=[pdf('bruno@example.com.pdf'),pdf('carla@example.com.pdf'),{...pdf('ana.perez@example.com.pdf'),body:'aGVsbG8='}];
 await findKey(refusing.pane(),'uploadCertificates').listeners.click();await flush();
 assert.deepEqual(writes(refusing).map(r=>r.path.split('/').at(-1)),['u-bruno','u-carla']);
 assert.match(visible(refusing.pane()),/Not uploaded:.*bruno@example\.com\.pdf.*The file must be a PDF of up to 3 MB\..*ana\.perez@example\.com\.pdf/s);assert.match(visible(refusing.pane()),/Uploaded: 1\./);
});

test('every interface key of the organiser tab exists in English, Spanish and Portuguese',async()=>{
 const h=organiser();await flush();h.tab().listeners.click();await flush();
 const files=inputs(h.pane(),'survey-certificate-files')[0];files.files=[pdf('ana.perez@example.com.pdf'),pdf('x@y.pdf'),pdf('bruno@example.com.pdf'),pdf('bruno@example.com.pdf',4)];files.listeners.change();
 const rows=h.ctx.window.pilotI18n.rows,keys=new Set(descendants(h.body).map(n=>n.dataset.pilotText).filter(Boolean));
 for(const key of ['bulkMatched','bulkReplaces','bulkUnmatched','bulkDuplicate','bulkUnmatchedHint','finalSurvey','surveyColumn'])assert.ok(keys.has(key),key);
 for(const key of [...keys,'surveyCounts','surveyStartedCount','surveyClosesOn','bulkProgress','bulkDone','bulkStopped','bulkFailed','bulkNothing','bulkAlreadyUploaded','confirmReplaceCertificates','confirmDeleteCertificate','certificateSaved','certificateDeleted','downloadCertificateOf','uploadCertificateFor','replaceCertificateFor','deleteCertificateFor','certificateFileOf'])
  assert.ok(rows[key]?.length===3&&rows[key].every(v=>typeof v==='string'&&v.trim()),key);
});
