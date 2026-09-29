(() => {
 'use strict';
 const {el,tr,source,button,link,field,check,api,status,dateNode}=window.Fiiu;
 const root=document.getElementById('fiiuAdminRoot'),message=document.getElementById('fiiuStatus');let festival,config,records=[],cursor=null,publications=[],contentCursor=null;
 const detailHost=el('section','f-admin-detail'),listHost=el('div','f-admin-list'),contentHost=el('section','f-admin-content');
 const info=(key,value)=>{const p=el('p');p.append(tr('strong',key),document.createTextNode(': '+(Array.isArray(value)?value.join(', '):value??'')));return p;};
 async function action(control,fn,feedback=message){control.disabled=true;status(feedback,'saving');try{await fn();status(feedback,'changesSaved');}catch(err){status(feedback,err);}finally{control.disabled=false;}}
 async function loadContent(more=false){const page=await api('/api/admin/fiiu/content'+(more&&contentCursor?'?cursor='+encodeURIComponent(contentCursor):''));publications=more?[...publications,...page.content]:page.content;contentCursor=page.nextCursor;renderContent(more);}
 async function loadParticipants(more=false){const data=await api('/api/admin/fiiu/registrations'+(more&&cursor?'?cursor='+encodeURIComponent(cursor):''));records=more?[...records,...data.registrations]:data.registrations;cursor=data.nextCursor;renderList();}
 function renderList(){
  listHost.replaceChildren();if(!records.length)listHost.append(tr('p','noParticipants'));
  for(const r of records){const row=el('div','f-participant');row.append(el('strong','',`${r.answers.firstName} ${r.answers.lastName}`),el('span','f-muted',r.email));if(r.labStatus!=='none')row.append(tr('span',r.labStatus,'f-tag'));const open=button('details',()=>action(open,()=>openParticipant(r.id)),'f-button secondary');row.append(open);listHost.append(row);}
  if(cursor){const more=button('loadMore',()=>action(more,()=>loadParticipants(true)));listHost.append(more);}
 }
 async function openParticipant(id){
  const data=await api('/api/admin/fiiu/registrations/'+id),r=data.registration;detailHost.replaceChildren();detailHost.tabIndex=-1;
  detailHost.append(el('h3','',`${r.answers.firstName} ${r.answers.lastName}`),info('email',r.email));
  const answers=el('details');answers.append(tr('summary','details'));for(const [key,value] of Object.entries(r.answers))if(key!=='privacyAccepted'){const row=el('p');row.append(tr('strong',key),document.createTextNode(': '));const values=Array.isArray(value)?value:[value];values.forEach((v,i)=>{if(i)row.append(document.createTextNode(', '));const activity=festival.event.activities.find(a=>a.id===v);row.append(activity?source('span',activity.title):typeof v==='boolean'?tr('span',v?'yes':'no'):['profile','gender','accessibility','motivation','previousAttendance'].includes(key)&&v?tr('span',v):el('span','',String(v??'')));});answers.append(row);}detailHost.append(answers);
  if(r.answers.applyLab){
   const review=el('form','f-form');review.append(tr('h4','review'));const state=field('review',{value:{pending:'reviewPending',accepted:'reviewAccepted',declined:'reviewDeclined'}[r.labStatus],options:['reviewPending','reviewAccepted','reviewDeclined'],required:true});review.append(state.wrap);
   const save=button('saveReview');save.type='submit';review.append(save);review.addEventListener('submit',event=>{event.preventDefault();action(save,async()=>{await api('/api/admin/fiiu/registrations/'+id,{version:r.version,labStatus:{reviewPending:'pending',reviewAccepted:'accepted',reviewDeclined:'declined'}[state.input.value]},'PATCH');await openParticipant(id);await loadParticipants();});});detailHost.append(review);
  }
  const attendance=el('fieldset');attendance.append(tr('legend','attendance'),tr('p','attendanceHint','f-muted'));
  for(const activity of festival.event.activities){
   const eligible=activity.registration==='external'||(activity.id==='day0-lab'?r.labStatus==='accepted':r.answers.activities.includes(activity.id));
   const attended=data.attendance.some(a=>a.activityId===activity.id);if(!eligible&&!attended)continue;
   const label=el('label','f-check'),input=el('input');input.type='checkbox';input.checked=attended;
   const title=el('span');title.append(dateNode(activity.date,'span'),document.createTextNode(' — '),source('span',activity.title));label.append(input,title);
   input.addEventListener('change',()=>{const wanted=input.checked;action(input,async()=>{try{await api('/api/admin/fiiu/registrations/'+id+'/attendance',{activityId:activity.id,attended:wanted},'PUT');}catch(err){input.checked=!wanted;throw err;}});});attendance.append(label);
  }
  detailHost.append(attendance);detailHost.focus();
 }
 function settings(){
  const section=el('section','f-admin-settings');section.append(tr('h2','settings'));const form=el('form','f-form'),open=check('registrationOpen','registrationOpen','yes',config.registrationOpen);form.append(open.wrap);
  for(const key of ['programUrl','workshopsUrl','routesUrl','partyUrl'])form.append(field(key,{value:config[key],type:'url',max:2000}).wrap);
  const save=button('saveSettings');save.type='submit';form.append(save);
  form.addEventListener('submit',event=>{event.preventDefault();action(save,async()=>{const fd=new FormData(form),result=await api('/api/admin/fiiu/config',{...Object.fromEntries(fd),registrationOpen:open.input.checked,version:config.version},'PUT');config=result.config;});});section.append(form);return section;
 }
 function publicationEditor(record={}){
  const form=el('form','f-form');form.append(tr('h3',record.id?'editContent':'newContent'));
  for(const [key,type,max] of [['title','text',180],['body','textarea',5000],['url','url',2000]])form.append(field(key,{value:record[key],type,max,required:key==='title'}).wrap);
  const kind=field('kind',{value:record.kind==='news'?'newsKind':record.kind||'newsKind',options:['newsKind','recording','material'],required:true});form.append(kind.wrap);
  const syncUrl=()=>{form.elements.url.required=kind.input.value!=='newsKind';};kind.input.addEventListener('change',syncUrl);syncUrl();
  const activity=field('activityId');const select=el('select');select.name='activityId';const blank=tr('option','choose');blank.value='';select.append(blank);for(const a of festival.event.activities){const option=source('option',a.date+' — '+a.title);option.value=a.id;select.append(option);}select.value=record.activityId||'';activity.input.replaceWith(select);form.append(activity.wrap);
  form.append(field('status',{value:record.status||'draft',options:['draft','published','archived'],required:true}).wrap);
  const save=button('saveContent');save.type='submit';form.append(save);
  form.addEventListener('submit',event=>{event.preventDefault();action(save,async()=>{const fd=new FormData(form),payload={...Object.fromEntries(fd),kind:kind.input.value==='newsKind'?'news':kind.input.value,version:record.version};await api('/api/admin/fiiu/content'+(record.id?'/'+record.id:''),payload,record.id?'PATCH':'POST');await loadContent();});});return form;
 }
 function renderContent(preserveEditor=false){const existing=preserveEditor?contentHost.querySelector('.f-content-editor'):null;const editor=existing||el('div','f-content-editor');if(!existing)editor.append(publicationEditor());contentHost.replaceChildren(tr('h2','content'),editor);
  for(const record of publications){const row=el('article','f-news-item');row.append(source('h3',record.title),tr('p',record.status),button('editContent',()=>{editor.replaceChildren(publicationEditor(record));editor.querySelector('input')?.focus();},'f-button secondary'));contentHost.append(row);}
  if(contentCursor){const more=button('loadMore',()=>action(more,()=>loadContent(true)));contentHost.append(more);}
 }
 async function load(){
  status(message,'loading');try{const [publicData,settingsData,posts]=await Promise.all([api('/api/fiiu'),api('/api/admin/fiiu/config'),api('/api/admin/fiiu/content')]);festival=publicData;config=settingsData.config;publications=posts.content;contentCursor=posts.nextCursor;root.replaceChildren();
   root.append(tr('h1','admin'),link('back','fiiu.html'),link('export','/api/admin/fiiu/export'));
   const participants=el('section','f-admin-participants');participants.append(tr('h2','participants'));const grid=el('div','f-admin-columns');grid.append(listHost,detailHost);participants.append(grid);root.append(participants,settings(),contentHost);await loadParticipants();renderContent();status(message,'');
  }catch(error){status(message,error);root.replaceChildren(button('retry',load));}
 }
 load();
})();
