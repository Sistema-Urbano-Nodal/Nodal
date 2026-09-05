(() => {
'use strict';
const {t,el,tr,api,status,button,field,select,date,feedback,localized,bind,dynamic,source,setPageTitle}=window.nodalPilot;
const root=document.getElementById('pilotRoot'),msg=document.getElementById('pilotStatus');
let courses=[],selectedId=null,workspace,selectionVersion=0;
const endpoint=id=>'/api/admin/courses'+(id?'/'+id:'');
function translationEditor(record,keys){
  const section=el('section','pilot-translation-editor');
  const locale=select('translationLanguage',['en','es','pt'],window.nodalI18n?.lang||'en');
  const panes={},inputs={};
  section.append(locale.wrap,tr('p','translationHint','pilot-data-note'));
  for(const lang of ['en','es','pt']){
    const pane=el('div','pilot-form');inputs[lang]={};
    for(const key of keys){
      const f=field(key,record?.translations?.[lang]?.[key]||'',key==='title'?'text':'textarea');
      f.input.name='translations.'+lang+'.'+key;f.input.maxLength=key==='title'?180:key==='instructions'?10000:6000;
      f.input.dataset.pilotPlaceholder='translationPlaceholder';f.input.setAttribute('placeholder',t('translationPlaceholder'));
      inputs[lang][key]=f.input;pane.append(f.wrap);
    }
    panes[lang]=pane;section.append(pane);
  }
  function show(){for(const [lang,pane] of Object.entries(panes))pane.hidden=lang!==locale.input.value;}
  locale.input.addEventListener('change',show);
  let previousLanguage;
  bind(section,()=>{
    const current=window.nodalI18n?.lang||'en';
    if(current!==previousLanguage){locale.input.value=current;previousLanguage=current;}
    show();
  });
  return{section,value:()=>Object.fromEntries(Object.entries(inputs).map(([lang,fields])=>[lang,Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value]))]))};
}

function makeEditor(record,module,courseId,onSaved){
  const form=el('form','pilot-form'),inputs={};
  const contentKeys=module?['title','description','objectives','instructions']:['title','description'];
  const original=el('details','pilot-editor-original');original.open=!record;
  original.append(tr('summary','sourceContent'));const originalFields=el('div','pilot-form');original.append(originalFields);
  for(const key of contentKeys){
    const f=field(key,record?.[key]||'',key==='title'?'text':'textarea');
    f.input.required=key==='title';f.input.maxLength=key==='title'?180:key==='instructions'?10000:6000;
    inputs[key]=f.input;originalFields.append(f.wrap);
  }
  const translations=translationEditor(record,contentKeys);
  const grid=el('div','pilot-form-grid');
  for(const key of module?['sessionDate','position']:['startsOn','endsOn','enrollmentOpen']){
    const type=key==='position'?'number':key==='enrollmentOpen'?'checkbox':'date';
    const f=field(key,record?.[key]??(key==='position'?1:key==='enrollmentOpen'?true:''),type);
    if(type==='number'){f.input.min=1;f.input.max=100;}
    inputs[key]=f.input;grid.append(f.wrap);
  }
  const state=select('status',module?['draft','published']:['draft','published','archived'],record?.status||'draft');inputs.status=state.input;
  form.append(original,translations.section,grid,state.wrap);
  let resourceInputs=[];
  if(module){
    const resources=el('div'),rows=el('div');resources.append(tr('h3','resources'));
    function add(r={}){
      const row=el('div','pilot-resource-edit'),title=field('title',r.title||''),url=field('url',r.url||'','url'),kind=select('kind',['slides','reading','link','recording'],r.kind||'link');
      title.input.required=true;url.input.required=true;title.input.maxLength=180;url.input.maxLength=2000;
      const translated=translationEditor(r,['title']),details=el('details');details.append(tr('summary','translations'),translated.section);
      const entry={title:title.input,url:url.input,kind:kind.input,translations:translated.value};resourceInputs.push(entry);
      row.append(title.wrap,url.wrap,kind.wrap,details,button('remove',()=>{row.remove();resourceInputs=resourceInputs.filter(x=>x!==entry);},true));rows.append(row);
    }
    for(const resource of record?.resources||[])add(resource);
    resources.append(rows,button('addResource',()=>add(),true));form.append(resources);
  }
  const submit=button(record?'save':module?'newModule':'newCourse');submit.type='submit';
  const local=el('p','pilot-status');local.setAttribute('role','status');form.append(submit,local);
  form.addEventListener('submit',async e=>{
    e.preventDefault();submit.disabled=true;
    try{
      const body=Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value]));
      body.translations=translations.value();if(record)body.version=record.version;
      if(module){body.resources=resourceInputs.map(r=>({title:r.title.value,url:r.url.value,kind:r.kind.value,translations:r.translations()}));if(body.resources.some(r=>!window.nodalPilot.safeUrl(r.url)))throw new Error(t('urlError'));}
      const path=module?endpoint(courseId)+'/modules'+(record?'/'+record.id:''):endpoint(record?.id);
      const result=await api(path,body,record?'PATCH':'POST'),saved=result.course||result.module;if(record)Object.assign(record,saved);else record=saved;submit.dataset.pilotText='save';submit.textContent=t('save');status(local,t('saved'));await onSaved(saved);
    }catch(err){
      status(local,err);
      if(err.status===409&&!form.querySelector('[data-reload]')){
        const reload=button('reload',async()=>{
          reload.disabled=true;
          try{
            const result=await api(module?'/api/courses/'+courseId+'/modules/'+record.id:'/api/courses/'+record.id);
            const fresh=result.module||result.course;
            form.replaceWith(makeEditor(fresh,module,courseId,onSaved));await onSaved(fresh);
          }catch(error){status(local,error);reload.disabled=false;}
        },true);reload.dataset.reload='true';form.append(reload);
      }
    }finally{submit.disabled=false;}
  });
  return form;
}

function csvLink(id,type,key){
  const a=tr('a',key,'pilot-export-link');
  a.href=id?endpoint(id)+'/export?type='+type:'/api/admin/feedback/export';
  return a;
}

function feedbackTable(records){
  const table=el('table','pilot-table pilot-feedback-table'),head=el('tr');
  ['participant','feedbackAction','rating','feedbackComment'].forEach(k=>head.append(tr('th',k)));
  const thead=el('thead'),body=el('tbody');thead.append(head);table.append(thead,body);
  for(const f of records){
    const row=el('tr'),who=el('td','pilot-response-person'),action=el('td');
    if(f.name)who.append(el('strong',null,f.name));
    if(f.email)who.append(el('div','pilot-response-email',f.email));
    action.append(tr('span',f.action),dynamic('time',()=>new Date(f.createdAt).toLocaleString(window.nodalI18n?.lang||'en'),'pilot-response-date'));
    const rating=el('td','pilot-response-rating');rating.append(el('strong',null,String(f.rating)),el('span',null,' / 5'));
    row.append(who,action,rating,el('td','pilot-response-comment',f.comment||''));body.append(row);
  }
  return table;
}

function responseView(records,courseId){
  const section=el('section','pilot-response-view');
  const heading=el('div','pilot-section-heading');heading.append(tr('h2',courseId?'responses':'allFeedback'),csvLink(courseId,'feedback','downloadAll'));
  const controls=el('div','pilot-response-filters'),search=field('searchResponses','','search');
  const actions=['allActions',...new Set(records.map(f=>f.action))];
  const action=select('feedbackAction',actions,'allActions');controls.append(search.wrap,action.wrap);
  const results=el('div','pilot-table-wrap');
  function render(){
    const term=search.input.value.trim().toLocaleLowerCase();
    const filtered=records.filter(f=>(action.input.value==='allActions'||f.action===action.input.value)&&[f.name,f.email,f.comment].some(v=>String(v||'').toLocaleLowerCase().includes(term)));
    results.replaceChildren(filtered.length?feedbackTable(filtered):tr('p',records.length?'noMatchingResponses':'noFeedback','pilot-empty'));
  }
  search.input.addEventListener('input',render);action.input.addEventListener('change',render);
  section.append(heading,controls,results,tr('p','limitNote','pilot-data-note'));render();return section;
}

function participantView(data,id){
  const section=el('section'),heading=el('div','pilot-section-heading');
  heading.append(tr('h2','participants'),csvLink(id,'participants','downloadParticipants'));
  section.append(heading);
  const wrap=el('div','pilot-table-wrap'),table=el('table','pilot-table'),head=el('tr');
  ['participant','enrolled','intakeResponses'].forEach(k=>head.append(tr('th',k)));table.append(head);
  for(const p of data.participants){
    const row=el('tr'),who=el('td');who.append(el('strong',null,p.name||''),el('div','pilot-response-email',p.email||''));
    row.append(who,dynamic('td',()=>new Date(p.enrolledAt).toLocaleDateString(window.nodalI18n?.lang||'en')));
    const intake=el('td');
    if(p.intake){
      const details=el('details','pilot-intake-response'),dl=el('dl');details.append(tr('summary','intakeResponses'));
      for(const key of ['fullName','profession','city','motivation','experience','expectations','caseStudy','digitalFamiliarity'])dl.append(tr('dt',key),el('dd',null,p.intake[key]||''));
      details.append(dl);intake.append(details);
    }else intake.append(tr('span','pending'));
    row.append(intake);table.append(row);
  }
  wrap.append(table);section.append(data.participants.length?wrap:tr('p','noParticipants','pilot-empty'));
  const footer=el('div','pilot-section-footer');footer.append(csvLink(id,'intake','intakeResponses'),tr('p','private','pilot-data-note'));section.append(footer);return section;
}

function activityView(data,id){
  const box=el('details','pilot-activity-summary');box.append(tr('summary','activityDetails'));
  const metrics=el('dl','pilot-metrics');
  for(const [key,value] of Object.entries(data.summary)){
    const row=el('div');row.append(tr('dt',key==='enrolled'?'participants':key),el('dd',null,String(value)));metrics.append(row);
  }
  box.append(metrics,tr('p','accessNote','pilot-data-note'),csvLink(id,'activity','export'));return box;
}

function setupView(course,modules,id,onCourseSaved){
  const pane=el('section','pilot-setup');
  const courseDetails=el('details','pilot-editor-section');
  courseDetails.append(tr('summary','courseSetup'),makeEditor(course,false,null,onCourseSaved));
  pane.append(courseDetails,tr('h2','sessions'));
  function moduleEditor(initial=null){
    const details=el('details','pilot-editor-section'),summary=el('summary');
    let current=initial,created=false;
    function updateSummary(){
      summary.replaceChildren(source('span',current,'title'),dynamic('small',()=>date(current.sessionDate)),tr('span',current.status,'pilot-tag'));
    }
    if(current)updateSummary();else summary.append(tr('span','newModule'));
    details.append(summary,makeEditor(initial,true,id,saved=>{
      if(current)Object.assign(current,saved);else current=saved;
      updateSummary();
      if(!initial&&!created){created=true;pane.append(moduleEditor());}
    }));
    return details;
  }
  for(const module of modules)pane.append(moduleEditor(module));
  pane.append(moduleEditor());return pane;
}

async function showCourse(id,selected='responses'){
  const version=++selectionVersion;selectedId=id;status(msg,t('loading'));
  try{
    const [{course,modules},data]=await Promise.all([api('/api/courses/'+id),api(endpoint(id)+'/report')]);
    if(version!==selectionVersion)return;
    workspace.replaceChildren();
    const header=el('header','pilot-teaching-course');
    const title=el('div');title.append(tr('span',course.status,'pilot-tag'),source('h2',course,'title'));
    const view=tr('a','open','pilot-text-link');view.href='course.html?id='+id;header.append(title,view);workspace.append(header);
    const tabs=el('div','pilot-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',t('teaching'));
    tabs.dataset.pilotAria='teaching';
    const updateCourse=async saved=>{
      Object.assign(course,saved);
      title.replaceChildren(tr('span',course.status,'pilot-tag'),source('h2',course,'title'));
      courses=courses.map(item=>item.id===course.id?{...item,...saved}:item);
      await refreshList(false);
    };
    const panes={responses:responseView(data.feedback,id),participants:participantView(data,id),courseSetup:setupView(course,modules,id,updateCourse)};
    const buttons={};
    function activate(key){
      for(const name of Object.keys(panes)){
        panes[name].hidden=name!==key;buttons[name].setAttribute('aria-selected',String(name===key));buttons[name].tabIndex=name===key?0:-1;
      }
    }
    Object.entries(panes).forEach(([key,pane],index)=>{
      const b=button(key,()=>activate(key),true);b.id='staff-tab-'+key;b.setAttribute('role','tab');b.setAttribute('aria-controls','staff-pane-'+key);
      pane.id='staff-pane-'+key;pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',b.id);
      b.addEventListener('keydown',e=>{
        const keys=Object.keys(panes);let next;
        if(e.key==='ArrowRight')next=keys[(index+1)%keys.length];
        else if(e.key==='ArrowLeft')next=keys[(index+keys.length-1)%keys.length];
        else if(e.key==='Home')next=keys[0];else if(e.key==='End')next=keys.at(-1);
        if(next){e.preventDefault();activate(next);buttons[next].focus();}
      });
      buttons[key]=b;tabs.append(b);
    });
    workspace.append(tabs,...Object.values(panes),activityView(data,id));activate(selected);
    document.querySelectorAll('#staffCourses button').forEach(b=>{if(b.dataset.course===id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    status(msg,'');
  }catch(err){if(version===selectionVersion)status(msg,err);}
}

async function refreshList(fetchLatest=true){
  if(fetchLatest)({courses}=await api(endpoint()));const list=document.getElementById('staffCourses');list.replaceChildren();
  courses.forEach(c=>{
    const b=el('button','pilot-course-select');b.type='button';b.dataset.course=c.id;
    b.append(source('span',c,'title'),tr('small',c.status));b.addEventListener('click',()=>showCourse(c.id));
    if(c.id===selectedId)b.setAttribute('aria-current','page');list.append(b);
  });
}
async function allFeedback(){
  const version=++selectionVersion;
  try{const data=await api('/api/admin/feedback');if(version!==selectionVersion)return;workspace.replaceChildren(responseView(data.feedback,null));}
  catch(err){if(version===selectionVersion)status(msg,err);}
}
async function start(){
  setPageTitle('teaching');
  try{
    ({courses}=await api(endpoint()));document.getElementById('teachingLink').hidden=false;root.replaceChildren();
    const hero=el('header','pilot-hero pilot-teaching-hero');hero.append(tr('h1','teaching'),tr('p','teachingIntro'));
    const layout=el('div','pilot-staff-layout'),nav=el('aside','pilot-staff-nav'),list=el('div','pilot-staff-list');list.id='staffCourses';workspace=el('div','pilot-staff-work');
    const create=button('newCourse',()=>{
      selectionVersion++;selectedId=null;workspace.replaceChildren();const section=el('section','pilot-setup');
      section.append(tr('h2','newCourse'),makeEditor(null,false,null,async c=>{await refreshList();await showCourse(c.id,'courseSetup');}));workspace.append(section);
    },true);
    nav.append(tr('h2','courses'),list,button('allFeedback',allFeedback,true),create);layout.append(nav,workspace);root.append(hero,layout);
    await refreshList(false);if(courses.length)await showCourse(courses[0].id);else create.click();status(msg,'');
  }catch(err){status(msg,err);}
}
start();
})();
