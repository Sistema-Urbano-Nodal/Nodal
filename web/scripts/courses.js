(() => {
'use strict';
const {t,el,tr,api,status,button,field,select,safeUrl,recordingPreview,date,limaDate,feedback,localized,hasLocalized,bind,dynamic,source,setPageTitle}=window.nodalPilot;
const root=document.getElementById('pilotRoot'),msg=document.getElementById('pilotStatus');
const courseId=new URLSearchParams(location.search).get('id');
let snapshot,activeId,loadSequence=0,navigationSequence=0,navigationPending=false;
let conversations=[],recordings=[],pageActive=true,pendingModuleId=null;
function stopConversations(){conversations.forEach(view=>view.dispose());conversations=[];recordings.forEach(view=>view.close());recordings=[];}
window.addEventListener?.('pagehide',()=>{pageActive=false;conversations.forEach(view=>view.suspend());recordings.forEach(view=>view.close());});
window.addEventListener?.('pageshow',()=>{pageActive=true;conversations.forEach(view=>view.resume());});
const base=()=>'/api/courses/'+encodeURIComponent(courseId);
function textSection(key,record){const section=el('section');section.append(tr('h3',key),source('p',record,key));return section;}
function dates(c){return [date(c.startsOn),date(c.endsOn)].filter(Boolean).join(' – ');}
async function directory(){setPageTitle('courses');const {courses,isAdmin}=await api('/api/courses');document.getElementById('teachingLink').hidden=isAdmin!==true;root.replaceChildren();const hero=el('header','pilot-hero');hero.append(tr('p','courses','pilot-context'),tr('h1','intro'),tr('p','directory'));const list=el('div','pilot-directory');if(!courses.length)list.append(tr('p','emptyCourses','pilot-empty'));courses.forEach(c=>{const row=el('article','pilot-course-row'),meta=el('div'),content=el('div');meta.append(tr('span',c.status,'pilot-tag'),dynamic('div',()=>dates(c),'pilot-date'));if(c.enrollmentOpen===false)meta.append(tr('div','closed','pilot-date'));content.append(source('h2',c,'title'),source('p',c,'description'));const link=tr('a','open','pilot-button');link.href='course.html?id='+encodeURIComponent(c.id);row.append(meta,content,link);list.append(row);});root.append(hero,list);status(msg,'');}
function intakeForm(data,onClose){let busy=false;const box=el('section','pilot-intake');box.append(tr('h2','intake'),tr('p','private'));const form=el('form','pilot-form');const fields={};['fullName','profession','city','motivation','experience','expectations','caseStudy','digitalFamiliarity'].forEach((key,i)=>{const f=field(key,data?.[key]||'',i<3?'text':'textarea');f.input.maxLength=i<3?160:2000;f.input.required=true;fields[key]=f.input;form.append(f.wrap);});const save=button('saveIntake');save.type='submit';const local=el('p','pilot-status');local.setAttribute('role','status');form.append(save);if(onClose)form.append(button('cancel',()=>{if(!busy)onClose();},true));form.append(local);form.addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;save.disabled=true;form.setAttribute('aria-busy','true');Object.values(fields).forEach(input=>{input.disabled=true;});try{const input=Object.fromEntries(Object.entries(fields).map(([k,n])=>[k,n.value]));await api(base()+'/intake',input,'PUT',{redirectOnUnauthorized:false});await course();}catch(err){status(local,err);}finally{busy=false;save.disabled=false;form.setAttribute('aria-busy','false');Object.values(fields).forEach(input=>{input.disabled=false;});}});box.append(form);return box;}
async function course(fresh){
  fresh=fresh||await api(base(),undefined,undefined,{redirectOnUnauthorized:!snapshot});
  stopConversations();navigationSequence++;navigationPending=false;pendingModuleId=null;snapshot=fresh;root.replaceChildren();
  document.getElementById('teachingLink').hidden=!snapshot.isAdmin;
  const c=snapshot.course;setPageTitle(()=>localized(c,'title'));
  const hero=el('header','pilot-hero pilot-course-hero'),back=tr('a','courses');back.href='courses.html';
  const metadata=el('div','pilot-course-meta');metadata.append(back,dynamic('span',()=>dates(c),'pilot-date'));
  hero.append(metadata,source('h1',c,'title'),source('p',c,'description'));root.append(hero);status(msg,'');
  if(!snapshot.enrollment&&!snapshot.isAdmin){
    // Closed courses keep their route preview but offer no way in.
    if(!c.enrollmentOpen){const closed=el('div','pilot-actions');closed.append(tr('strong','closed'),tr('span','closedNote'));hero.append(closed);renderRoutePreview();return;}
    const enroll=button('enroll',async()=>{if(enroll.disabled)return;enroll.disabled=true;try{await api(base()+'/enroll',{});await course();}catch(err){if(err.code==='enrollment_closed')return course({...snapshot,course:{...c,enrollmentOpen:false}});status(msg,err);enroll.disabled=false;}});
    hero.append(enroll);renderRoutePreview();return;
  }
  // The final survey comes before the intake gate: an enrolled person without a course form answers it too.
  appendSurvey();
  if(!snapshot.intake&&!snapshot.isAdmin){root.append(intakeForm());renderRoutePreview();return;}
  const actions=el('div','pilot-actions');actions.append(tr('span',snapshot.enrollment?'enrolled':'staff','pilot-tag'));
  if(snapshot.intake){
    let deleting=false;
    const edit=button('editIntake',()=>{
      if(deleting)return;
      const existing=document.getElementById('editIntake');
      if(existing){if(existing.querySelector('form')?.getAttribute('aria-busy')!=='true')existing.remove();return;}
      const box=intakeForm(snapshot.intake,()=>box.remove());box.id='editIntake';hero.after(box);
    },true);
    const remove=button('deleteIntake',async()=>{
      if(deleting||document.getElementById('editIntake')?.querySelector('form')?.getAttribute('aria-busy')==='true')return;
      if(!confirm(t('confirmDeleteIntake')))return;
      deleting=true;edit.disabled=true;remove.disabled=true;
      try{
        await api(base()+'/intake',{},'DELETE',{redirectOnUnauthorized:false});
        await course({...snapshot,intake:null});status(msg,t('intakeDeleted'));
      }catch(err){status(msg,err);}finally{deleting=false;edit.disabled=false;remove.disabled=false;}
    },true);
    actions.append(edit,remove);
  }
  hero.append(actions);
  const workspace=el('div','pilot-workspace'),nav=el('nav','pilot-route'),content=el('div','pilot-content'),progress=el('aside','pilot-progress');
  nav.dataset.pilotAria='route';nav.setAttribute('aria-label',t('route'));content.id='moduleContent';
  const general=snapshot.modules.filter(m=>m.kind==='discussion'),sessions=snapshot.modules.filter(m=>m.kind!=='discussion');
  if(general.length){
    const community=el('div','pilot-course-community');community.append(tr('h2','courseCommunity'));
    for(const m of general){const b=button('generalDiscussion',()=>openModule(m.id),true);b.dataset.module=m.id;community.append(b);}
    nav.append(community);
  }
  nav.append(tr('h2','sessions'));const list=el('ol');nav.append(list);
  for(const [index,m] of sessions.entries()){
    const li=el('li'),b=el('button');b.type='button';b.dataset.module=m.id;
    b.append(el('span','pilot-session-number',String(index+1).padStart(2,'0')),source('span',m,'title','pilot-session-title'),dynamic('small',()=>date(m.sessionDate)));
    b.addEventListener('click',()=>openModule(m.id));li.append(b);list.append(li);
  }
  if(!sessions.length)nav.append(tr('p','noModules','pilot-data-note'));
  progress.append(tr('strong',snapshot.intake?'intakeComplete':'staff'),tr('p','accessNote'));nav.append(progress);
  workspace.append(nav,content);root.append(workspace);
  if(!snapshot.modules.length){content.append(tr('p','noModules','pilot-empty'));return;}
  const requested=new URLSearchParams(location.search).get('module');
  await openModule(snapshot.modules.some(m=>m.id===activeId)?activeId:snapshot.modules.some(m=>m.id===requested)?requested:(sessions[0]||general[0]).id);
}
function renderRoutePreview(){
  const box=el('section','pilot-intake');box.append(tr('h2','route'));
  const sessions=snapshot.modules.filter(m=>m.kind!=='discussion');
  sessions.forEach((m,i)=>box.append(dynamic('p',()=>(i+1)+'. '+localized(m,'title')+(m.sessionDate?' — '+date(m.sessionDate):''))));
  if(!sessions.length)box.append(tr('p','noModules'));
  if(snapshot.modules.some(m=>m.kind==='discussion'))box.append(tr('p','generalDiscussion'));
  root.append(box);
}

/* The final survey of one course (server/course-final-survey.js, docs/implementation/course-final-survey.md). The server
   decides every state (open, closed, organiser preview, sent, certificate) and sends the approved Spanish wording, which
   stays Spanish content (lang=es) in any interface language; only the chrome around it is translated. One controller
   owns the section across course() re-renders, so answers typed on screen 2 survive them, and every state the server
   returns is written back to snapshot.finalSurvey. */
let surveyView=null,surveyIds=0,topicOrder=null,surveyLinkHandled=false;
const SURVEY_STATE_CODES=['survey_locked','survey_submitted','survey_closed','survey_unavailable','survey_not_started','survey_changed'];
const surveyPhase=s=>s.preview?(s.open?'preview':'previewClosed'):s.response?.submittedAt?'sent':!s.open?'closed':s.response?'started':'new';
const surveyKey=s=>[surveyPhase(s),s.certificate||'',s.response?.submittedAt||''].join('|');
function appendSurvey(){
  const state=snapshot.finalSurvey;if(!state){surveyView=null;return;}
  if(surveyView?.key!==surveyKey(state))surveyView=createSurvey(state);else surveyView.update(state);
  root.append(surveyView.node);
  // The organiser's reminder link (course.html?id=…&encuesta=1) opens the form once; the address then drops it.
  if(!surveyLinkHandled&&new URLSearchParams(location.search).get('encuesta')==='1'){
    surveyLinkHandled=true;const url=new URL(location.href);url.searchParams.delete('encuesta');history.replaceState(null,'',url);
    surveyView.expand?.(false);surveyView.heading.focus();
  }
}
// One question, or one row of a grid: a fieldset whose error line every control points to with aria-describedby.
function surveyBlock(text,{number,help,optional,row}={}){
  const id='survey-q'+(++surveyIds),node=el('fieldset',row?'pilot-survey-row':'pilot-survey-question'),legend=el('legend'),label=el('span',null,(number?number+'. ':'')+text);
  label.lang='es';label.id=id+'-label';legend.append(label);if(optional)legend.append(tr('span','surveyOptional','pilot-survey-optional'));node.append(legend);
  const hint=help?el('p','pilot-survey-help',help):null,error=el('p','pilot-survey-error');
  if(hint){hint.lang='es';hint.id=id+'-help';node.append(hint);}
  error.id=id+'-error';error.hidden=true;node.append(error);
  // `notes` describe the controls too: the help line, and a note under the options (question 12).
  const block={id,node,label,controls:[],notes:hint?[hint]:[],invalid:false};
  block.describe=()=>{const ids=[...block.notes.map(n=>n.id),block.invalid?error.id:''].filter(Boolean).join(' ');for(const target of [node,...block.controls]){if(ids)target.setAttribute('aria-describedby',ids);else target.removeAttribute('aria-describedby');}};
  block.fail=(key,n,invalid=block.controls)=>{block.invalid=true;error.hidden=false;bind(error,()=>{error.textContent=t(key).replace('{n}',n??'');});invalid.forEach(c=>c.setAttribute('aria-invalid','true'));block.describe();};
  block.clear=()=>{if(!block.invalid)return;block.invalid=false;error.hidden=true;delete error.dataset.pilotDynamic;error.textContent='';block.controls.forEach(c=>c.removeAttribute('aria-invalid'));block.describe();};
  return block;
}
function surveyChoices(block,name,type,options,columns,onChange){
  const list=el('div','pilot-survey-options'+(columns?' cols-'+options.length:''));
  const items=options.map(option=>{
    const label=el('label','pilot-survey-option'),input=el('input'),text=el('span',null,option.label);
    input.type=type;input.name=name;input.value=option.id;text.lang='es';text.id='survey-o'+(++surveyIds);label.append(input,text);list.append(label);block.controls.push(input);
    input.addEventListener('change',()=>onChange?onChange(input):block.clear());return {option,label,input,text};
  });
  block.node.append(list);block.describe();
  return {items,value:()=>items.find(i=>i.input.checked)?.input.value||'',values:()=>items.filter(i=>i.input.checked).map(i=>i.input.value)};
}
// Question 8 asks for a random order with 'Otro' last; it is drawn once per page, so a re-render keeps it.
function surveyShuffle(options,last){
  if(!topicOrder){const ids=options.map(o=>o.id).filter(id=>id!==last);for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}topicOrder=last?[...ids,last]:ids;}
  return topicOrder.map(id=>options.find(o=>o.id===id)).filter(Boolean);
}
function surveyPart(section){const part=el('section','pilot-survey-part'),title=el('h3',null,section.id+' · '+section.title);title.lang='es';part.append(title);return part;}
function createSurvey(initial){
  let state=initial,busy=false,screens={},area=null,opener=null,consent=null,named=null,texts={};
  const node=el('section','pilot-closeout'),heading=tr('h2','finalSurvey'),body=el('div'),live=el('p','pilot-status');
  node.id='encuestaFinal';heading.id='encuestaFinalTitle';heading.tabIndex=-1;node.setAttribute('aria-labelledby',heading.id);
  live.setAttribute('role','status');live.setAttribute('aria-live','polite');node.append(heading,live,body);
  const view={key:surveyKey(state),node,heading,expand:null,certificate:null,update(next){accept(next);syncName();}};
  const alive=()=>surveyView===view,closedOn=()=>limaDate(state.lastDay+'T12:00:00Z',{day:'numeric',month:'long'});
  function accept(next){state=next;snapshot.finalSurvey=next;view.key=surveyKey(next);}
  function polite(){const line=el('p','pilot-status');line.setAttribute('role','status');line.setAttribute('aria-live','polite');return line;}
  function stepLine(n){const step=dynamic('p',()=>t('surveyStep').replace('{n}',n),'pilot-survey-step');step.tabIndex=-1;return step;}
  function render(){
    screens={};consent=named=null;texts={};view.expand=null;view.certificate=null;body.replaceChildren();
    const phase=surveyPhase(state);
    if(phase==='sent'){renderSent();return;}
    if(state.preview)body.append(tr('p','surveyPreview','pilot-survey-note'));
    if(!state.open){body.append(dynamic('p',()=>t('surveyClosedOn').replace('{date}',closedOn()),'pilot-closeout-lead'));return;}
    const intro=el('p','pilot-closeout-intro',state.survey.intro),language=el('p','pilot-survey-note');intro.lang='es';
    bind(language,()=>{language.textContent=t('surveyInSpanish');language.hidden=(window.nodalI18n?.lang||'en')==='es';});
    opener=button(state.preview?'previewSurvey':phase==='started'?'resumeSurvey':'startSurvey',()=>show(surveyPhase(state)==='started'?2:1));opener.className+=' pilot-plate';
    area=el('div','pilot-survey-screens');area.hidden=true;body.append(intro,language,opener,area);
    view.expand=focus=>show(surveyPhase(state)==='started'?2:1,focus);
  }
  function renderSent(){
    const mine=tr('h3','myCertificate','pilot-certificate-title'),line=el('p','pilot-certificate');mine.id='encuestaFinalCertificate';mine.tabIndex=-1;view.certificate=mine;
    body.append(dynamic('p',()=>t('surveySentOn').replace('{date}',limaDate(state.response.submittedAt,{day:'numeric',month:'long',year:'numeric'})),'pilot-closeout-lead'),mine,line);
    if(state.certificate==='ready'){const link=tr('a','downloadCertificate','pilot-button pilot-plate');link.href=base()+'/certificate';line.append(tr('strong','certificateReady','pilot-certificate-state is-ready'));body.append(link);return;}
    const note=el('p','pilot-survey-note'),mail=el('a',null,state.contactEmail);mail.href='mailto:'+state.contactEmail;
    line.append(tr('strong','certificatePreparing','pilot-certificate-state is-preparing'));note.append(tr('span','certificatePreparingNote'),' ',mail);body.append(note);
  }
  function show(n,focus=true){screens[n]??=n===1?screenOne():screenTwo();area.replaceChildren(screens[n].form);area.hidden=false;opener.hidden=true;if(focus)screens[n].step.focus();}
  // A refusal that means the state moved on (closed, sent elsewhere, locked) re-reads it; the rest of the page stays.
  async function reload(error,local){
    let fresh=null;
    try{fresh=await api(base(),undefined,undefined,{redirectOnUnauthorized:false});}catch{/* The refusal itself still explains what happened. */}
    if(!alive())return;
    if(fresh&&!fresh.finalSurvey){snapshot.finalSurvey=undefined;surveyView=null;node.remove();status(msg,error);return;}
    if(fresh&&surveyKey(fresh.finalSurvey)!==view.key){accept(fresh.finalSurvey);render();status(live,error);heading.focus();return;}
    if(fresh)view.update(fresh.finalSurvey);
    status(local,error);
  }
  function syncConsent(){
    if(!consent)return;const written=Boolean(texts[consent.after]?.value.trim());consent.block.node.hidden=!written;
    if(!written){consent.choice.items.forEach(i=>{i.input.checked=false;});consent.block.clear();}
  }
  // "Sí, como:" is followed by the exact name the message would be published under, and is not offered without one.
  function syncName(){if(!named)return;named.text.textContent=named.option.label+' '+state.publishAs;named.label.hidden=!state.publishAs;if(!state.publishAs)named.input.checked=false;}
  function screenOne(){
    const section=state.survey.sections.find(s=>s.questions.some(q=>q.screen===1)),q=section.questions.find(x=>x.screen===1);
    const form=el('form','pilot-survey'),step=stepLine(1),part=surveyPart(section),block=surveyBlock(q.label,{number:q.number}),choice=surveyChoices(block,'survey-'+q.id,'radio',q.options,true);
    const next=button('surveyContinue'),local=polite(),end=el('div','pilot-survey-submit');next.type='submit';next.className+=' pilot-plate';form.noValidate=true;
    part.append(block.node);end.append(tr('p','surveyLockWarning','pilot-survey-note'),next,local);form.append(step,part,end);
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy)return;const overall=choice.value();
      if(!overall){block.fail('surveyChooseOne');choice.items[0].input.focus();return;}
      // The organiser preview moves on without saving anything.
      if(state.preview){show(2);return;}
      busy=true;next.disabled=true;form.setAttribute('aria-busy','true');next.dataset.pilotText='surveySaving';next.textContent=t('surveySaving');status(local,'');
      try{const result=await api(base()+'/survey/start',{overall},'PUT',{redirectOnUnauthorized:false});if(!alive())return;accept(result.finalSurvey);show(2);}
      catch(err){if(SURVEY_STATE_CODES.includes(err.code))await reload(err,local);else status(local,err);}
      finally{busy=false;next.disabled=false;form.setAttribute('aria-busy','false');next.dataset.pilotText='surveyContinue';next.textContent=t('surveyContinue');}
    });
    return {form,step};
  }
  function screenTwo(){
    const form=el('form','pilot-survey'),step=stepLine(2),checks=[],reads=[],end=el('div','pilot-survey-submit'),local=polite();form.noValidate=true;
    form.append(step,tr('p','surveyLockedNote','pilot-survey-locked'));
    for(const section of state.survey.sections){
      const questions=section.questions.filter(q=>q.screen!==1);if(!questions.length)continue;
      const part=surveyPart(section);for(const q of questions)part.append(surveyQuestion(q,section,checks,reads,local));form.append(part);
    }
    let send=null;
    if(state.preview)end.append(tr('p','surveyPreview','pilot-survey-note'));else{send=button('surveySubmit');send.type='submit';send.className+=' pilot-plate';end.append(send);}
    end.append(local);form.append(end);syncConsent();syncName();
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy||!send)return;
      const invalid=checks.map(check=>check()).filter(Boolean);
      if(invalid.length){status(local,new Error(t('surveyRequiredSummary')));invalid[0].focus();return;}
      const answers={};reads.forEach(read=>read(answers));
      busy=true;send.disabled=true;form.setAttribute('aria-busy','true');send.dataset.pilotText='surveySending';send.textContent=t('surveySending');status(local,'');
      try{
        const result=await api(base()+'/survey',{answers,publishAs:state.publishAs},'POST',{redirectOnUnauthorized:false});if(!alive())return;
        accept(result.finalSurvey);render();status(live,t('surveyThanks'));view.certificate?.focus();
      }catch(err){
        if(err.code==='survey_invalid'){const target=checks.find(check=>check.id===err.field)?.mark();status(local,err);target?.focus();}
        else if(SURVEY_STATE_CODES.includes(err.code))await reload(err,local);
        else status(local,err);
      }finally{busy=false;send.disabled=false;form.setAttribute('aria-busy','false');send.dataset.pilotText='surveySubmit';send.textContent=t('surveySubmit');}
    });
    return {form,step};
  }
  /* One question of screen 2. checks validate in question order (each returns the control to focus), reads fill the
     answers, and local is the screen's polite status line. */
  function surveyQuestion(q,section,checks,reads,local){
    const optional=!q.required&&!q.requiredWith&&!/opcional/i.test(section.title),name='survey-'+q.id;
    const block=surveyBlock(q.label,{number:q.number,help:q.help,optional});
    // A missing 'other' text marks only that field; the choice above it is valid.
    const check=(test,target,owner=block)=>checks.push(Object.assign(()=>{const key=test();if(key){owner.clear();owner.fail(key,undefined,key==='surveyOtherRequired'?[target()]:undefined);return target();}owner.clear();return null;},{id:q.id,mark:()=>{owner.fail('surveyInvalidAnswer');return target();}}));
    const text=(tag,cls)=>{const input=el(tag,cls);if(tag==='input')input.type='text';input.name=name;input.setAttribute('aria-labelledby',block.label.id);block.controls.push(input);block.node.append(input);block.describe();return input;};
    const otherText=(field,maxLength,labelledBy)=>{const input=el('input','pilot-survey-other');input.type='text';input.name='survey-'+field;input.maxLength=maxLength;input.hidden=true;input.setAttribute('aria-labelledby',labelledBy);input.addEventListener('input',()=>block.clear());block.controls.push(input);return input;};
    if(q.type==='grid'){
      // A grid is one question of several required rows; each row is its own fieldset, a block of options on a phone.
      block.node.className+=' pilot-survey-grid';
      const rows=q.rows.map(row=>{
        const part=surveyBlock(row.label,{row:true}),choice=surveyChoices(part,name+'-'+row.id,'radio',row.options,true);block.node.append(part.node);
        check(()=>choice.value()?'':'surveyRequiredQuestion',()=>part.controls[0],part);return [row.id,choice];
      });
      reads.push(answers=>{answers[q.id]=Object.fromEntries(rows.map(([id,choice])=>[id,choice.value()]));});
    }else if(q.type==='single'){
      // An optional choice (question 9) can go back to blank: a radio group cannot be unticked on its own.
      const clearable=!q.required&&!q.requiredWith;let reset=null;
      const choice=surveyChoices(block,name,'radio',q.options,q.options.length===5,clearable?()=>{block.clear();reset.hidden=false;}:undefined);
      if(clearable){reset=button('surveyClearChoice',()=>{choice.items.forEach(i=>{i.input.checked=false;});reset.hidden=true;block.clear();choice.items[0].input.focus();},true);reset.className+=' pilot-survey-clear';reset.hidden=true;block.node.append(reset);}
      if(q.note){const note=el('p','pilot-survey-help',q.note);note.lang='es';note.id=block.id+'-note';block.node.append(note);block.notes.push(note);block.describe();}
      if(q.requiredWith){
        // Question 12 is asked only about a message that was actually written.
        consent={block,choice,after:q.requiredWith};named=choice.items.find(i=>i.option.publishAs)||null;
        check(()=>!block.node.hidden&&!choice.value()?'surveyRequiredQuestion':'',()=>choice.items.find(i=>!i.label.hidden).input);
        reads.push(answers=>{answers[q.id]=block.node.hidden?'':choice.value();});
      }else{check(()=>q.required&&!choice.value()?'surveyRequiredQuestion':'',()=>choice.items[0].input);reads.push(answers=>{answers[q.id]=choice.value();});}
    }else if(q.type==='multi'){
      const last=q.other?.option,limit=()=>t('surveyMaxChoices').replace('{n}',q.max);let extra=null;
      const choice=surveyChoices(block,name,'checkbox',q.shuffle?surveyShuffle(q.options,last):q.options,false,input=>{
        /* An extra tick is undone where it happened. Focus stays on the box, so the polite status line says why too
           (and lets it go with the next change); the boxes are not marked invalid for a notice. */
        if(input.checked&&choice.values().length>q.max){input.checked=false;block.clear();block.fail('surveyMaxChoices',q.max,[]);local.classList.toggle('is-error',false);bind(local,()=>{local.textContent=limit();});return;}
        block.clear();if(local.textContent===limit())status(local,'');if(extra)extra.hidden=!choice.values().includes(last);
      });
      if(last){
        const item=choice.items.find(i=>i.option.id===last);extra=otherText(q.other.field,q.other.maxLength,item.text.id);item.label.after(extra);block.describe();
        check(()=>choice.values().includes(last)&&!extra.value.trim()?'surveyOtherRequired':'',()=>extra);
      }
      reads.push(answers=>{answers[q.id]=choice.values();if(last)answers[q.other.field]=choice.values().includes(last)?extra.value:'';});
    }else if(q.type==='text'){
      const input=text(q.multiline?'textarea':'input','pilot-survey-text');input.maxLength=q.maxLength;texts[q.id]=input;
      input.addEventListener('input',()=>{block.clear();syncConsent();});reads.push(answers=>{answers[q.id]=input.value;});
    }else if(q.type==='integer'){
      const input=text('input','pilot-survey-age'),value=()=>input.value.trim();input.inputMode='numeric';input.autocomplete='off';input.maxLength=String(q.max).length;input.setAttribute('aria-required','true');
      input.addEventListener('input',()=>block.clear());
      check(()=>!value()?(q.required?'surveyRequiredQuestion':''):/^\d+$/.test(value())&&Number(value())>=q.min&&Number(value())<=q.max?'':'surveyAgeInvalid',()=>input);
      reads.push(answers=>{if(value())answers[q.id]=Number(value());});
    }else if(q.type==='select'){
      const input=el('select','pilot-survey-select'),blank=tr('option','surveyChooseCountry'),last=q.other?.option;let extra=null,otherItem=null;
      blank.value='';input.name=name;input.setAttribute('aria-labelledby',block.label.id);input.setAttribute('aria-required','true');input.append(blank);
      for(const option of q.options){const item=el('option',null,option.label);item.value=option.id;item.lang='es';item.id='survey-o'+(++surveyIds);if(option.id===last)otherItem=item;input.append(item);}
      block.controls.push(input);block.node.append(input);
      if(otherItem){extra=otherText(q.other.field,q.other.maxLength,block.label.id+' '+otherItem.id);block.node.append(extra);}
      block.describe();input.addEventListener('change',()=>{block.clear();if(extra)extra.hidden=input.value!==last;});
      check(()=>!input.value?(q.required?'surveyRequiredQuestion':''):extra&&input.value===last&&!extra.value.trim()?'surveyOtherRequired':'',()=>extra&&input.value===last?extra:input);
      reads.push(answers=>{answers[q.id]=input.value;if(last)answers[q.other.field]=input.value===last?extra.value:'';});
    }
    return block.node;
  }
  render();return view;
}

async function event(kind,moduleId,resourceUrl){try{await api(base()+'/events',{id:crypto.randomUUID(),moduleId,kind,...(resourceUrl?{resourceUrl}:{})},'POST',{redirectOnUnauthorized:false});}catch(err){if(moduleId===activeId)status(msg,err);}}
async function openModule(id){
  const content=document.getElementById('moduleContent');
  // A route click on the current session must not discard its unsent drafts.
  if(content?.dataset.moduleId===id){navigationSequence++;navigationPending=false;pendingModuleId=null;conversations.forEach(view=>view.resume());status(msg,'');return;}
  if(navigationPending&&pendingModuleId===id)return;
  const navigation=++navigationSequence;pendingModuleId=id;
  navigationPending=true;conversations.forEach(view=>view.suspend());status(msg,t('loading'));
  try{
    const {module:m}=await api(base()+'/modules/'+encodeURIComponent(id),undefined,undefined,{redirectOnUnauthorized:false});if(navigation!==navigationSequence)return;
    navigationPending=false;pendingModuleId=null;stopConversations();activeId=id;const sequence=++loadSequence;
    const url=new URL(location.href);url.searchParams.set('module',id);history.replaceState(null,'',url);
    document.querySelectorAll('[data-module]').forEach(b=>{if(b.dataset.module===id)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
    content.replaceChildren();content.dataset.moduleId=id;const head=el('section','pilot-module-heading');
    if(m.kind!=='discussion')head.append(dynamic('div',()=>date(m.sessionDate),'pilot-date'));
    head.append(source('h2',m,'title'),source('p',m,'description'));content.append(head);
    const materials=el('section','pilot-module-materials');
    if(hasLocalized(m,'objectives'))materials.append(textSection('objectives',m));
    materials.append(tr('h3','resources'));
    const activityFiles=(m.resources||[]).filter(r=>r.kind==='activity'&&m.kind!=='discussion');
    const materialFiles=(m.resources||[]).filter(r=>!activityFiles.includes(r));
    if(!materialFiles.length)materials.append(tr('p','noResources'));
    function appendResource(container,r){
      const href=r.attachmentId?'/api/course-attachments/'+encodeURIComponent(r.attachmentId):safeUrl(r.url);if(!href)return;
      const row=el('div','pilot-resource'),link=source('a',r,'title');link.href=href;
      if(!r.attachmentId){link.target='_blank';link.rel='noopener noreferrer';}
      const opened=()=>{event(r.kind==='recording'?'recording_open':'content_open',id,r.url||href);showFeedback(r.kind==='recording'?'recording':'content',id);};
      link.addEventListener('click',opened);
      row.append(link,tr('span',r.attachmentId?'downloadFile':r.kind,'pilot-tag'));container.append(row);
      if(r.kind==='recording'&&!r.attachmentId){const preview=recordingPreview(r,opened);if(preview){container.append(preview.element);recordings.push(preview);}}
    }
    materialFiles.forEach(r=>appendResource(materials,r));
    const discussion=createConversation(id,sequence,'discussion'),assignments=m.kind==='discussion'?null:createConversation(id,sequence,'assignment');
    if(assignments){
      const activity=el('div','pilot-assignment-instructions');
      if(hasLocalized(m,'instructions'))activity.append(textSection('instructions',m));
      if(activityFiles.length){activity.append(tr('h3','activityResources'));activityFiles.forEach(r=>appendResource(activity,r));}
      if(activity.children.length)assignments.element.prepend(activity);
    }else if(hasLocalized(m,'instructions'))discussion.element.prepend(textSection('instructions',m));
    conversations=[discussion,...(assignments?[assignments]:[])];
    const panes=m.kind==='discussion'?{discussion:discussion.element,materials}:{materials,discussion:discussion.element,assignment:assignments.element};
    const labels={materials:'materialsView',discussion:'discussionView',assignment:'assignmentsView'};
    const tabs=el('div','pilot-tabs pilot-module-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',t('moduleViews'));tabs.dataset.pilotAria='moduleViews';
    const buttons={};
    async function activate(key){
      if(key!=='materials')recordings.forEach(view=>view.close());
      for(const [name,pane] of Object.entries(panes)){pane.hidden=name!==key;buttons[name].setAttribute('aria-selected',String(name===key));buttons[name].tabIndex=name===key?0:-1;}
      const current=new URL(location.href);current.searchParams.set('view',key);history.replaceState(null,'',current);
      discussion.setActive(key==='discussion');assignments?.setActive(key==='assignment');
      if(key==='discussion')await discussion.loadInitial();if(key==='assignment')await assignments.loadInitial();
    }
    Object.entries(panes).forEach(([key,pane],index)=>{
      const tab=button(labels[key],()=>activate(key),true);tab.id='module-tab-'+key;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','module-pane-'+key);
      pane.id='module-pane-'+key;pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',tab.id);
      tab.addEventListener('keydown',e=>{const keys=Object.keys(panes);let next;if(e.key==='ArrowRight')next=keys[(index+1)%keys.length];else if(e.key==='ArrowLeft')next=keys[(index+keys.length-1)%keys.length];else if(e.key==='Home')next=keys[0];else if(e.key==='End')next=keys.at(-1);if(next){e.preventDefault();activate(next);buttons[next].focus();}});
      buttons[key]=tab;tabs.append(tab);
    });
    const feedbackSlot=el('div');feedbackSlot.id='courseFeedback';content.append(tabs,...Object.values(panes),feedbackSlot);showFeedback('course',id);
    status(msg,'');const requested=new URLSearchParams(location.search).get('view');await activate(Object.hasOwn(panes,requested)?requested:'discussion');event('module_open',id);
  }catch(err){if(navigation===navigationSequence){navigationPending=false;pendingModuleId=null;conversations.forEach(view=>view.resume());status(msg,err);}}
}

function createConversation(moduleId,sequence,kind){
  const section=el('section','pilot-discussion'),heading=el('div','pilot-section-heading');
  heading.append(tr('h3',kind==='assignment'?'assignmentsView':'discussionView'));
  const posts=el('div','pilot-post-list'),updates=el('p','pilot-conversation-updates');updates.setAttribute('role','status');updates.setAttribute('aria-live','polite');
  const refresh=button('refreshConversation',()=>loadPosts(true),true),more=button('loadOlder',()=>loadPosts(false),true);more.hidden=true;
  const composer=makeComposer(moduleId,()=>loadPosts(true),{kind});
  heading.append(refresh);section.append(heading,tr('p',kind==='assignment'?'assignmentHelp':'discussionHelp','pilot-data-note'),composer,updates,posts,more);
  let cursor=null,loading=false,refreshPending=false,loaded=false,active=false,disposed=false,baseline=null,timer=null,pollController=null,pollErrors=0,hasUpdates=false;
  const known=new Set();
  const alive=()=>!disposed&&sequence===loadSequence;
  const visible=()=>!navigationPending&&pageActive&&active&&document.visibilityState!=='hidden'&&alive();
  const signature=result=>result.revision??(result.posts?.[0]?.id||'empty');
  function syncReplyLinks(){
    const liveIds=new Set([...posts.children].filter(card=>card.isLivePost?.()).map(card=>card.id.slice(5)));
    for(const card of posts.children)card.showParentLink?.(liveIds.has(card.parentPostId));
  }
  function cancelPoll(){if(timer!==null&&typeof clearTimeout==='function')clearTimeout(timer);timer=null;pollController?.abort();pollController=null;}
  function schedule(){if(!visible()||loading||!loaded||hasUpdates||timer!==null||typeof setTimeout!=='function')return;timer=setTimeout(checkUpdates,Math.min(120000,30000*2**pollErrors));}
  async function checkUpdates(){
    timer=null;if(!visible()||pollController)return;
    const controller=typeof AbortController==='function'?new AbortController():null;pollController=controller;
    try{
      const result=await api(base()+'/modules/'+moduleId+'/posts?'+new URLSearchParams({kind,latest:'1'}),undefined,undefined,{signal:controller?.signal,redirectOnUnauthorized:false});
      if(!visible()||controller?.signal.aborted)return;
      pollErrors=0;if(signature(result)!==baseline){hasUpdates=true;status(updates,t('conversationUpdates'));}
    }catch(err){if(!visible()||controller?.signal.aborted||err.name==='AbortError')return;pollErrors=Math.min(2,pollErrors+1);if(err.status===401||err.status===403){hasUpdates=true;status(updates,t('updatesPaused'));}}
    finally{if(pollController===controller)pollController=null;schedule();}
  }
  async function loadPosts(reset,notice){
    if(!alive())return;syncReplyLinks();if(loading){refreshPending=refreshPending||reset;return;}
    loading=true;cancelPoll();more.disabled=true;refresh.disabled=true;
    try{
      const params=new URLSearchParams({kind,order:'desc'});if(!reset&&cursor)params.set('cursor',cursor);
      const result=await api(base()+'/modules/'+moduleId+'/posts?'+params,undefined,undefined,{redirectOnUnauthorized:false});if(!alive())return;
      if(!Array.isArray(result.posts))throw new Error(t('error'));
      const drafts=new Map(reset?[...posts.children].filter(card=>card.hasDraft?.()).map(card=>[card.id.slice(5),card]):[]);
      // A draft absent from this page may be older or deleted. Check its own
      // version before preserving the editor so removed text is not republished.
      await Promise.all([...drafts].filter(([id])=>!result.posts.some(post=>post.id===id)).map(async([id,card])=>{
        try{const current=await api(base()+'/posts/'+encodeURIComponent(id),undefined,undefined,{redirectOnUnauthorized:false});if(alive()&&card.hasDraft()&&current.post?.id===id)card.updatePost(current.post);}catch{/* Preserve unsaved text if its current version is unavailable. */}
      }));
      if(!alive())return;
      for(const [id,card] of drafts)if(!card.hasDraft())drafts.delete(id);
      if(reset){posts.replaceChildren();known.clear();baseline=signature(result);hasUpdates=false;status(updates,notice?t(notice):'');status(msg,'');}
      for(const post of result.posts){
        if(post.deleted){drafts.get(post.id)?.updatePost(post);continue;}
        if(known.has(post.id))continue;known.add(post.id);
        const existing=drafts.get(post.id);
        if(existing){existing.updatePost(post);posts.append(existing);drafts.delete(post.id);}else posts.append(renderPost(post,composer,loadPosts,alive));
      }
      for(const [id,card] of drafts){posts.append(card);known.add(id);}
      syncReplyLinks();
      posts.querySelector('.pilot-empty')?.remove();
      if(!known.size)posts.append(tr('p',kind==='assignment'?'noAssignments':'noPosts','pilot-empty'));
      cursor=result.nextCursor;more.hidden=!cursor;loaded=true;
    }catch(err){if(!alive())return;status(msg,err);if(!known.size){const retry=button('retry',()=>{retry.remove();return loadPosts(true);},true);posts.append(retry);}}
    finally{loading=false;more.disabled=false;refresh.disabled=false;if(refreshPending&&alive()){refreshPending=false;await loadPosts(true);}schedule();}
  }
  function visibilityChanged(){if(!visible())cancelPoll();else schedule();}
  document.addEventListener('visibilitychange',visibilityChanged);
  return{element:section,suspend:cancelPoll,resume:schedule,loadInitial:()=>loaded?Promise.resolve():loadPosts(true),setActive(value){active=value;if(!active)cancelPoll();else schedule();},dispose(){disposed=true;cancelPoll();document.removeEventListener?.('visibilitychange',visibilityChanged);}};
}

function renderPost(initial,composer,reload,alive){
  let p=initial,editor=null,busy=false;
  const card=el('article','pilot-post'+(p.parentId?' reply':''));card.id='post-'+p.id;
  card.isLivePost=()=>!p.deleted;
  const author=el('strong',null,p.authorName||''),staffTag=tr('span','staff','pilot-tag');staffTag.hidden=!p.staff;card.append(author,staffTag);
  card.append(dynamic('small',()=>new Date(p.createdAt).toLocaleString(window.nodalI18n?.lang||'en')));
  if(p.parentId){const parent=tr('a','replying'),line=el('br');parent.href='#post-'+p.parentId;card.parentPostId=p.parentId;card.showParentLink=visible=>{parent.hidden=!visible;line.hidden=!visible;};card.append(line,parent);}
  const body=el('p'),links=el('ul'),actions=el('div','pilot-post-actions'),local=el('p','pilot-status');local.setAttribute('role','status');
  card.append(tr('div',p.kind,'pilot-date'),body,links,actions,local);
  const reply=button('reply',()=>{if(!busy)composer.replyTo(p);},true);
  const edit=button('editPost',()=>{
    if(busy||editor||!p.canEdit||!alive())return;
    const form=el('form','pilot-form pilot-post-editor'),text=field('body',p.body,'textarea');text.input.required=true;text.input.maxLength=6000;
    const save=button('savePost');save.type='submit';
    const cancel=button('cancel',()=>{if(!busy)closeEditor();},true);
    const review=button('refreshPostVersion',async()=>{
      if(busy||!editor||!alive())return;setBusy(true);
      try{
        const result=await api(base()+'/posts/'+encodeURIComponent(p.id),undefined,undefined,{redirectOnUnauthorized:false});if(!alive()||!editor)return;
        if(!result.post||result.post.id!==p.id)throw new Error(t('error'));
        card.updatePost(result.post);
        if(!p.deleted&&p.canEdit){editor.expectedBody=p.body;editor.blocked=false;review.hidden=true;showCurrent();status(local,t('postEditConflict'));}
      }catch(err){status(local,err);}finally{setBusy(false);}
    },true);review.hidden=true;
    const comparison=el('div','pilot-post-current'),currentText=el('p');comparison.hidden=true;comparison.append(tr('strong','postCurrentText'),currentText);
    const controls=el('div','pilot-post-edit-actions');controls.append(save,cancel,review);
    form.append(tr('p','postEditHint','pilot-data-note'),text.wrap,comparison,controls);card.append(form);
    editor={form,input:text.input,save,cancel,review,comparison,currentText,expectedBody:p.body,blocked:false};edit.hidden=true;
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy||!editor||editor.blocked||!alive())return;
      if(!editor.input.value.trim()){status(local,new Error(t('postEditEmpty')));editor.input.focus();return;}
      if(editor.input.value.length>6000){status(local,new Error(t('longField').replace('{field}',t('body'))));return;}
      const input={body:editor.input.value,expectedBody:editor.expectedBody};setBusy(true);
      try{
        const result=await api(base()+'/posts/'+encodeURIComponent(p.id),input,'PATCH',{redirectOnUnauthorized:false});if(!alive())return;
        if(!result.post||result.post.id!==p.id)throw new Error(t('error'));
        closeEditor();card.updatePost(result.post);status(local,t('saved'));await reload(true,'saved');
      }catch(err){
        if(!alive())return;
        if(err.status===409&&editor){editor.blocked=true;editor.review.hidden=false;status(local,t('postEditConflict'));}
        else status(local,err);
      }finally{setBusy(false);}
    });
    status(local,'');text.input.focus();
  },true);
  const remove=button('deleteOwnPost',async()=>{
    if(busy||!p.canDelete||!alive()||!confirm(t('confirmDeleteOwnPost')))return;setBusy(true);
    try{
      await api(base()+'/posts/'+encodeURIComponent(p.id),{},'DELETE',{redirectOnUnauthorized:false});if(!alive())return;
      closeEditor();card.remove();await reload(true,'postDeleted');
    }catch(err){if(alive())status(local,err);}finally{setBusy(false);}
  },true);
  const moderate=button('moderate',async()=>{
    if(busy||!alive()||!confirm(t('confirmDelete')))return;setBusy(true);
    try{await api('/api/admin/courses/'+courseId+'/posts/'+p.id,{},'DELETE',{redirectOnUnauthorized:false});if(alive()){closeEditor();card.remove();await reload(true);}}catch(err){if(alive())status(local,err);}finally{setBusy(false);}
  },true);
  actions.append(reply,edit,remove,moderate);
  function showCurrent(){if(editor){editor.comparison.hidden=p.deleted;editor.currentText.textContent=p.deleted?'':p.body;}}
  function closeEditor(){if(editor){editor.form.remove();editor=null;}edit.hidden=!p.canEdit;if(p.deleted)card.remove();}
  function setBusy(value){
    busy=value;card.setAttribute('aria-busy',String(value));for(const control of [reply,edit,remove,moderate])control.disabled=value;
    if(editor){editor.form.setAttribute('aria-busy',String(value));for(const control of [editor.input,editor.cancel,editor.review])control.disabled=value;editor.save.disabled=value||editor.blocked;}
  }
  card.hasDraft=()=>Boolean(editor);
  card.updatePost=next=>{
    p=next;author.textContent=p.deleted?'':p.authorName||'';staffTag.hidden=p.deleted||!p.staff;body.textContent=p.deleted?'':p.body;
    links.replaceChildren();
    if(!p.deleted){
      for(const l of p.links||[]){const href=safeUrl(l.url);if(href){const li=el('li'),a=el('a',null,l.title||l.url);a.href=href;a.target='_blank';a.rel='noopener noreferrer';li.append(a);links.append(li);}}
      for(const f of p.attachments||[]){const li=el('li'),a=el('a',null,f.name);a.href='/api/course-attachments/'+encodeURIComponent(f.id);li.append(a);links.append(li);}
    }
    reply.hidden=p.deleted;edit.hidden=p.deleted||!p.canEdit||Boolean(editor);remove.hidden=p.deleted||!p.canDelete;moderate.hidden=p.deleted||!snapshot.isAdmin||p.canDelete;
    if(editor&&(p.deleted||!p.canEdit)){editor.blocked=true;editor.review.hidden=true;showCurrent();status(local,t('postEditRemoved'));}
    else if(editor&&p.body!==editor.expectedBody){editor.blocked=true;editor.review.hidden=false;showCurrent();status(local,t('postEditConflict'));}
    setBusy(busy);
  };
  card.updatePost(p);return card;
}
function showFeedback(action,moduleId){if(moduleId!==activeId)return;const mount=document.getElementById('courseFeedback');if(!mount||[...mount.children].some(box=>box.hasDraft?.()))return;mount.replaceChildren(feedback(action,{courseId,moduleId}));if(action!=='course')mount.querySelector('details')?.setAttribute('open','');}
/* A contribution whose response was lost keeps its clientId, so resending it unchanged returns the saved post. An edited
   resend under that id is refused as alreadySubmitted; the composer then takes a fresh id (keeping its uploads) so the
   next submit can post the edited text without a page reload. */
function makeComposer(moduleId,onSaved,options={}){const box=el('details','pilot-composer');box.append(tr('summary',options.kind==='assignment'?'submitAssignment':'startDiscussion'));const form=el('form','pilot-form');const kind=select('kind',['assignment','question'],options.kind==='assignment'?'assignment':'question'),body=field('body','','textarea'),links=field('links','','textarea'),files=field('files','','file'),reply=el('div','pilot-reply-context');body.input.required=true;body.input.maxLength=6000;links.input.maxLength=5000;files.input.multiple=true;files.input.accept='image/jpeg,image/png,image/webp,application/pdf,text/plain';reply.hidden=true;if(options.kind)kind.wrap.hidden=true;const submit=button('post');submit.type='submit';const local=el('p','pilot-status');local.setAttribute('role','status');const extras=el('details','pilot-composer-extras');extras.append(tr('summary','attachExtras'),links.wrap,files.wrap);form.append(reply,kind.wrap,body.wrap,extras,submit,local);box.append(form);let parentId=null,clientId=crypto.randomUUID(),uploaded=[],fileSignature='',busy=false;box.replyTo=p=>{if(busy)return;box.open=true;parentId=p.id;kind.input.disabled=true;reply.replaceChildren(dynamic('span',()=>t('replying')+' '+p.authorName),button('cancel',()=>{if(busy)return;parentId=null;kind.input.disabled=false;reply.hidden=true;},true));reply.hidden=false;body.input.focus();};form.addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;submit.disabled=true;form.setAttribute('aria-busy','true');for(const input of [body.input,links.input,files.input,kind.input])input.disabled=true;try{const chosen=[...files.input.files];if(chosen.length>3||chosen.some(f=>f.size>3*1024*1024||!['image/jpeg','image/png','image/webp','application/pdf','text/plain'].includes(f.type)))throw new Error(t('fileError'));const parsed=links.input.value.split('\n').map(s=>s.trim()).filter(Boolean).map(url=>{const safe=safeUrl(url);if(!safe)throw new Error(t('urlError'));return {title:new URL(safe).hostname,url:safe};});const signature=chosen.map(f=>[f.name,f.size,f.lastModified].join(':')).join('|');if(signature!==fileSignature){uploaded=[];fileSignature=signature;}for(let i=uploaded.length;i<chosen.length;i++){const f=chosen[i],data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error(t('fileError')));reader.readAsDataURL(f);});const result=await api(base()+'/modules/'+moduleId+'/attachments',{name:f.name,mime:f.type,data},'POST',{redirectOnUnauthorized:false});uploaded.push(result.attachment.id);}const action=!parentId&&kind.input.value==='assignment'?'assignment':'discussion';await api(base()+'/modules/'+moduleId+'/posts',{kind:parentId?'comment':kind.input.value,body:body.input.value,links:parsed,attachmentIds:uploaded,...(parentId?{parentId}:{}),clientId},'POST',{redirectOnUnauthorized:false});form.reset();kind.input.value=options.kind==='assignment'?'assignment':'question';parentId=null;kind.input.disabled=false;reply.hidden=true;uploaded=[];fileSignature='';clientId=crypto.randomUUID();status(local,t('saved'));box.open=false;showFeedback(action,moduleId);await onSaved();}catch(err){if(err.status===409&&err.translationKey==='alreadySubmitted')clientId=crypto.randomUUID();status(local,err);}finally{busy=false;submit.disabled=false;form.setAttribute('aria-busy','false');for(const input of [body.input,links.input,files.input])input.disabled=false;kind.input.disabled=Boolean(parentId);}});return box;}
async function start(){status(msg,t('loading'));try{if(document.body.dataset.page==='course'){if(!courseId)location.replace('courses.html');else await course();}else await directory();}catch(err){status(msg,err);const retry=button('retry',()=>{retry.remove();start();},true);root.append(retry);}}
window.nodalI18n?.onChange(()=>{document.documentElement.lang=window.nodalI18n.lang;});start();
})();
