(() => {
'use strict';
const {t,el,tr,api,status,button,field,select,date,limaDate,bind,dynamic,source,setPageTitle}=window.nodalPilot;
const root=document.getElementById('pilotRoot'),msg=document.getElementById('pilotStatus');
let courses=[],selectedId=null,workspace,selectionVersion=0;
const endpoint=id=>'/api/admin/courses'+(id?'/'+id:'');
// Publication status plus a closed-enrollment marker, re-read on language change.
const courseState=(c,cls)=>dynamic(cls?'span':'small',()=>t(c.status)+(c.enrollmentOpen===false?' · '+t('closed'):''),cls);
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
  let resourceInputs=[],refreshFiles=()=>{},uploadBusy=false,saveBusy=false;
  if(module&&record){const moduleKind=el('p','pilot-data-note');moduleKind.append(tr('span','moduleKind'),el('span',null,': '),tr('strong',record.kind||'session'));form.append(moduleKind);}
  if(module){
    const resources=el('div'),rows=el('div');resources.append(tr('h3','resources'));
    function add(r={}){
      if(r.attachmentId&&resourceInputs.some(entry=>entry.attachmentId===r.attachmentId))return;
      const row=el('div','pilot-resource-edit'),title=field('title',r.title||''),url=field('url',r.url||'','url'),kind=select('kind',['slides','reading','link','recording','activity'],r.kind||'link');
      title.input.required=true;url.input.required=!r.attachmentId;title.input.maxLength=180;url.input.maxLength=2000;
      const translated=translationEditor(r,['title']),details=el('details');details.append(tr('summary','translations'),translated.section);
      const entry={title:title.input,url:url.input,attachmentId:r.attachmentId,kind:kind.input,translations:translated.value};resourceInputs.push(entry);
      row.append(title.wrap);
      if(r.attachmentId){const download=tr('a','downloadFile');download.href='/api/course-attachments/'+encodeURIComponent(r.attachmentId);row.append(download);}else row.append(url.wrap);
      row.append(kind.wrap,details,button('remove',()=>{row.remove();resourceInputs=resourceInputs.filter(x=>x!==entry);},true));rows.append(row);
    }
    for(const resource of record?.resources||[])add(resource);
    resources.append(rows,button('addResource',()=>add(),true));
    const manager=el('details','pilot-file-manager');manager.append(tr('summary','manageFiles'),tr('p','officialFileNotice','pilot-data-note'));
    const file=field('officialFile','','file');file.input.accept='image/jpeg,image/png,image/webp,application/pdf,text/plain';
    const fileStatus=el('p','pilot-status');fileStatus.setAttribute('role','status');const library=el('div','pilot-file-library');
    const upload=button('uploadFile',async()=>{
      if(saveBusy||uploadBusy)return;
      if(!record?.id){status(fileStatus,t('saveModuleFirst'));return;}
      const chosen=file.input.files?.[0];
      if(!chosen||chosen.size>3*1024*1024||!['image/jpeg','image/png','image/webp','application/pdf','text/plain'].includes(chosen.type)){status(fileStatus,t('officialFileError'));return;}
      uploadBusy=true;upload.disabled=true;submit.disabled=true;
      try{
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error(t('officialFileError')));reader.readAsDataURL(chosen);});
        const {attachment}=await api(endpoint(courseId)+'/modules/'+record.id+'/attachments',{name:chosen.name,mime:chosen.type,data});
        add({title:attachment.name,attachmentId:attachment.id,kind:'reading'});file.input.value='';status(fileStatus,t('fileReadyToSave'));await refreshFiles();
      }catch(err){status(fileStatus,err);}finally{uploadBusy=false;upload.disabled=false;submit.disabled=false;}
    },true);
    const reloadFiles=button('refreshFiles',()=>refreshFiles(),true);
    refreshFiles=async()=>{
      if(!manager.open)return;
      if(!record?.id){status(fileStatus,t('saveModuleFirst'));return;}
      reloadFiles.disabled=true;
      try{
        const result=await api(endpoint(courseId)+'/modules/'+record.id+'/attachments');library.replaceChildren();
        for(const attachment of result.attachments||[]){
          const row=el('div','pilot-managed-file'),name=el('a',null,attachment.name);name.href='/api/course-attachments/'+encodeURIComponent(attachment.id);
          const inDraft=resourceInputs.some(r=>r.attachmentId===attachment.id);
          row.append(name,tr('span',attachment.referenced?'filePublished':'fileUnlinked','pilot-tag'));
          if(!inDraft&&attachment.status==='ready')row.append(button('useFile',()=>{add({title:attachment.name,attachmentId:attachment.id,kind:'reading'});status(fileStatus,t('fileReadyToSave'));refreshFiles();},true));
          if(!attachment.referenced&&!inDraft&&['ready','deleting'].includes(attachment.status))row.append(button('deleteFile',async()=>{
            if(!confirm(t('confirmDeleteFile')))return;
            try{await api(endpoint(courseId)+'/modules/'+record.id+'/attachments/'+attachment.id,{},'DELETE');await refreshFiles();status(fileStatus,t('fileDeleted'));}catch(err){status(fileStatus,err);}
          },true));
          library.append(row);
        }
        if(!result.attachments?.length)library.append(tr('p','noUploadedFiles','pilot-data-note'));
      }catch(err){status(fileStatus,err);}finally{reloadFiles.disabled=false;}
    };
    manager.addEventListener('toggle',()=>{if(manager.open)refreshFiles();});
    manager.append(file.wrap,upload,fileStatus,reloadFiles,library);resources.append(manager);form.append(resources);
  }

  const submit=button(record?'save':module?'newModule':'newCourse');submit.type='submit';
  const local=el('p','pilot-status');local.setAttribute('role','status');form.append(submit,local);
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(uploadBusy||saveBusy)return;saveBusy=true;form.setAttribute('aria-busy','true');
    const controls=[...form.querySelectorAll('input,textarea,select,button')].map(input=>({input,disabled:Boolean(input.disabled)}));
    for(const {input} of controls)input.disabled=true;
    try{
      const body=Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value]));
      body.translations=translations.value();if(record)body.version=record.version;
      if(module){body.resources=resourceInputs.map(r=>({title:r.title.value,...(r.attachmentId?{attachmentId:r.attachmentId}:{url:r.url.value}),kind:r.kind.value,translations:r.translations()}));if(body.resources.some(r=>!r.attachmentId&&!window.nodalPilot.safeUrl(r.url)))throw new Error(t('urlError'));}
      const path=module?endpoint(courseId)+'/modules'+(record?'/'+record.id:''):endpoint(record?.id);
      const result=await api(path,body,record?'PATCH':'POST'),saved=result.course||result.module;if(record)Object.assign(record,saved);else record=saved;submit.dataset.pilotText='save';submit.textContent=t('save');status(local,t('saved'));await onSaved(saved);await refreshFiles();
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
    }finally{saveBusy=false;form.setAttribute('aria-busy','false');for(const {input,disabled} of controls)input.disabled=disabled;}
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

function participantView(data,id,version,notice,onRefresh,closed=false){
  const section=el('section'),heading=el('div','pilot-section-heading');
  heading.append(tr('h2','participants'),csvLink(id,'participants','downloadParticipants'));
  section.append(heading);
  const add=el('details','pilot-participant-add');add.append(tr('summary','addParticipant'));
  const form=el('form','pilot-form pilot-participant-form'),email=field('participantEmail','','email');
  email.input.name='email';email.input.required=true;email.input.maxLength=254;email.input.autocomplete='email';email.input.setAttribute('autocapitalize','none');email.input.spellcheck=false;
  const hint=tr('p','addParticipantHint','pilot-data-note');hint.id='participant-add-hint';email.input.setAttribute('aria-describedby',hint.id);
  const submit=button('addParticipant');submit.type='submit';
  const invite=button('sendInvitation',()=>mutate(true),true);invite.hidden=true;
  const actions=el('div','pilot-participant-actions');actions.append(submit,invite);
  const local=el('p','pilot-status');local.setAttribute('role','status');local.setAttribute('aria-live','polite');
  if(notice)status(local,t(notice));
  const invitationButtons=[];let busy=false;
  const current=()=>version===selectionVersion&&selectedId===id;
  function setBusy(value,sending){
    busy=value;form.setAttribute('aria-busy',String(value));email.input.disabled=value;submit.disabled=value;invite.disabled=value;
    for(const b of invitationButtons)b.disabled=value;
    const target=sending?invite:submit;target.dataset.pilotText=value?(sending?'sendingInvitation':'addingParticipant'):(sending?'sendInvitation':'addParticipant');target.textContent=t(target.dataset.pilotText);
  }
  async function mutate(sending=false,address=email.input.value.trim()){
    if(busy||!current())return;
    email.input.value=address;
    if(!address||!email.input.checkValidity()){email.input.reportValidity();return;}
    setBusy(true,sending);status(local,'');
    try{
      // api() applies its own 45 s limit where the browser supports AbortSignal.timeout (not Safari before 16).
      const result=await api(endpoint(id)+(sending?'/invitations':'/participants'),{email:address},'POST');
      if(!current())return;
      if(!['invited','enrolled','already_enrolled'].includes(result.result))throw new Error(t(sending?'invitationUncertain':'participantAddUncertain'));
      const key=result.result==='invited'?'invitationSent':result.result==='already_enrolled'?'participantAlreadyEnrolled':'participantAdded';
      status(local,t(key));
      await onRefresh(key);
    }catch(err){
      if(!current())return;
      status(local,err.name==='TimeoutError'||err.name==='AbortError'?new Error(t(sending?'invitationUncertain':'participantAddUncertain')):err);
      if(!sending&&['participant_not_found','participant_unconfirmed'].includes(err.code))invite.hidden=false;
    }finally{setBusy(false,sending);}
  }
  email.input.addEventListener('input',()=>{invite.hidden=true;status(local,'');});
  form.addEventListener('submit',event=>{event.preventDefault();return mutate(false);});
  form.append(hint,email.wrap,actions);add.append(form);
  // A closed course admits no one: staff reopen Enrollment open in Course setup.
  section.append(closed?tr('div','participantsClosed','pilot-participant-add'):add,local);
  const invitations=(data.invitations||[]).filter(item=>!item.acceptedAt);
  if(invitations.length){
    const pending=el('section','pilot-invitations');pending.append(tr('h3','pendingInvitations'),tr('p','invitationIntakeNote','pilot-data-note'));
    const list=el('ul','pilot-invitation-list');
    for(const invitation of invitations){
      const row=el('li'),details=el('div','pilot-invitation-person');
      details.append(el('strong',null,invitation.email),tr('span',({sent:'invitationDeliverySent',failed:'invitationDeliveryFailed',uncertain:'invitationDeliveryUncertain',pending:'invitationDeliveryPending'})[invitation.deliveryStatus]||'invitationDeliveryPending','pilot-data-note'));
      row.append(details);list.append(row);
      if(closed)continue;
      const resend=button('resendInvitation',()=>{email.input.value=invitation.email;add.open=true;return mutate(true,invitation.email);},true);invitationButtons.push(resend);
      row.append(resend);
    }
    pending.append(list);section.append(pending);
  }
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

/* The final survey of Curso Movilidad Nivel 2 (docs/implementation/course-final-survey.md): who answered, their
   certificates and the two CSVs. The server lists enrolled participants only: administrators are organisers and are
   left out of every count. Bulk PDFs are matched to people here in the browser, so their file names, which are
   emails, never travel; one PDF goes per request because the hosting caps request bodies near 4.5 MB. */
const CERTIFICATE_LIMIT=3*1024*1024;
const normalized=value=>String(value??'').trim().normalize('NFC').toLowerCase();
const fill=(key,values)=>Object.entries(values).reduce((text,[name,value])=>text.split('{'+name+'}').join(String(value)),t(key));
function say(node,key,values={}){node.classList.toggle('is-error',false);bind(node,()=>{node.textContent=fill(key,values);});return node;}
function labelled(node,key,name){bind(node,()=>node.setAttribute('aria-label',fill(key,{name})));return node;}
function matchCertificates(files,people){
  const byEmail=new Map(people.filter(p=>normalized(p.email)).map(p=>[normalized(p.email),p])),found=new Map(),unmatched=[];
  for(const file of files){const person=byEmail.get(normalized(file.name).replace(/\.pdf$/,''));if(person)found.set(person,[...(found.get(person)||[]),file]);else unmatched.push(file);}
  const matched=[],duplicates=[];for(const [person,group] of found){if(group.length===1)matched.push({person,file:group[0]});else duplicates.push(...group);}
  return {matched,duplicates,unmatched};
}
// The same checks as the server, so a wrong file fails before it is sent: at most 3 MB and a body that starts with %PDF-.
function readCertificate(file){
  const invalid=()=>Object.assign(new Error(t('certificateInvalid')),{translationKey:'certificateInvalid',code:'certificate_invalid',local:true});
  return new Promise((resolve,reject)=>{
    if(!file||file.size>CERTIFICATE_LIMIT){reject(invalid());return;}
    const reader=new FileReader();reader.onload=()=>{const data=String(reader.result).split(',')[1]||'';if(/^JVBERi[0-3]/.test(data))resolve(data);else reject(invalid());};reader.onerror=()=>reject(invalid());reader.readAsDataURL(file);
  });
}
function finalSurveyView(id,version){
  const pane=el('section','pilot-survey-admin'),heading=el('div','pilot-section-heading'),exports=el('div','pilot-survey-exports');
  exports.append(csvLink(id,'survey','downloadSurveyResponses'),csvLink(id,'survey-status','downloadSurveyStatus'));heading.append(tr('h2','finalSurvey'),exports);
  const summary=el('div','pilot-survey-summary'),local=el('p','pilot-status');local.setAttribute('role','status');local.setAttribute('aria-live','polite');
  const reminder=field('surveyReminderLink',new URL('course.html?'+new URLSearchParams({id,encuesta:'1'}),location.href).href);reminder.wrap.className='pilot-survey-reminder';reminder.input.name='survey-reminder-link';reminder.input.readOnly=true;
  reminder.input.addEventListener('focus',()=>reminder.input.select?.());
  const bulk=el('details','pilot-file-manager pilot-survey-bulk'),files=field('certificateFiles','','file'),start=button('uploadCertificates',()=>uploadAll()),progress=el('p','pilot-status'),report=el('div','pilot-bulk-report');
  files.input.name='survey-certificate-files';files.input.multiple=true;files.input.accept='application/pdf,.pdf';start.className+=' pilot-plate';progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');
  bulk.append(tr('summary','bulkCertificates'),tr('p','bulkCertificatesHint','pilot-data-note'),files.wrap,start,progress,report);
  const table=el('div','pilot-table-wrap');table.append(tr('p','loading','pilot-empty'));
  pane.append(heading,summary,local,reminder.wrap,tr('p','surveyReminderNote','pilot-data-note'),bulk,table);
  let data=null,busy=false,requested=false,actions=[],focusable=new Map();const sent=new Set();
  const current=()=>version===selectionVersion&&selectedId===id,fileKey=file=>[file.name,file.size,file.lastModified].join(':');
  const certificatePath=userId=>endpoint(id)+'/certificates/'+encodeURIComponent(userId);
  function setBusy(value){busy=value;pane.setAttribute('aria-busy',String(value));start.disabled=value;for(const control of actions)control.disabled=value;}
  async function load(){
    try{const result=await api(endpoint(id)+'/final-survey',undefined,undefined,{redirectOnUnauthorized:false});if(!current())return false;data=result;render();return true;}
    catch(err){if(current()){status(local,err);if(!data)table.replaceChildren(button('retry',()=>load(),true));}return false;}
  }
  function render(){
    const day=()=>limaDate(data.lastDay+'T12:00:00Z',{day:'numeric',month:'long'});
    summary.replaceChildren(dynamic('p',()=>fill('surveyCounts',{answered:data.answered,total:data.total,certificates:data.certificates}),'pilot-survey-counts'));
    if(data.started)summary.append(dynamic('p',()=>fill('surveyStartedCount',{started:data.started}),'pilot-survey-line'));
    summary.append(dynamic('p',()=>fill(data.open?'surveyClosesOn':'surveyClosedOn',{date:day()}),'pilot-survey-line'));
    actions=[];focusable=new Map();
    if(!data.participants.length){table.replaceChildren(tr('p','noParticipants','pilot-empty'));return;}
    const grid=el('table','pilot-table'),head=el('tr'),thead=el('thead'),rows=el('tbody');
    ['participant','surveyColumn','certificateColumn','actionsColumn'].forEach(k=>head.append(tr('th',k)));thead.append(head);grid.append(thead,rows);
    const when=(value,options)=>{const time=dynamic('time',()=>limaDate(value,options),'pilot-response-date');time.dateTime=value;return time;};
    for(const p of data.participants){
      const row=el('tr'),who=el('td','pilot-response-person'),answer=el('td'),certificate=el('td'),controls=el('td','pilot-survey-actions'),name=p.name||p.email;
      who.append(el('strong',null,p.name||''),el('div','pilot-response-email',p.email||''));
      if(p.submittedAt)answer.append(tr('span','surveyAnswered','pilot-survey-done'),when(p.submittedAt,{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}));
      else answer.append(tr('span',p.startedAt?'surveyStartedOnly':'surveyNotYet','pilot-survey-pending'));
      if(p.certificate){const view=labelled(tr('a','downloadCertificateFile','pilot-survey-file'),'downloadCertificateOf',name);view.href=certificatePath(p.userId);certificate.append(tr('span','certificateUploaded','pilot-survey-done'),when(p.certificate.createdAt,{day:'numeric',month:'short'}),view);}
      else certificate.append(tr('span','certificateMissing','pilot-survey-pending'));
      const picker=labelled(el('input'),'certificateFileOf',name);picker.type='file';picker.accept='application/pdf,.pdf';picker.name='survey-certificate-'+p.userId;picker.hidden=true;
      const upload=labelled(button(p.certificate?'replaceCertificate':'uploadCertificate',()=>{if(!busy)picker.click?.();},true),p.certificate?'replaceCertificateFor':'uploadCertificateFor',name);
      picker.addEventListener('change',()=>{const file=picker.files?.[0];picker.value='';if(file)uploadOne(p,file);});
      controls.append(picker,upload);actions.push(upload);focusable.set(p.userId,upload);
      if(p.certificate){const remove=labelled(button('deleteCertificate',()=>removeOne(p),true),'deleteCertificateFor',name);controls.append(remove);actions.push(remove);}
      row.append(who,answer,certificate,controls);rows.append(row);
    }
    table.replaceChildren(grid);setBusy(busy);
  }
  // After a change the table is drawn again.
  async function refresh(key){if(await load())status(local,t(key));}
  /* The pressed button is disabled while busy (and a row's is replaced by the redraw), so focus falls to the page.
     Once the controls are enabled again it returns to that button, or to the same person's row, unless the organiser
     has moved it meanwhile. */
  function refocus(target){const active=document.activeElement;if(current()&&(!active||active===document.body))target?.focus();}
  async function uploadOne(p,file){
    if(busy)return;setBusy(true);status(local,'');
    try{const pdf=await readCertificate(file);await api(certificatePath(p.userId),{mime:'application/pdf',data:pdf},'PUT',{redirectOnUnauthorized:false});if(current())await refresh('certificateSaved');}
    catch(err){if(current())status(local,err);}finally{setBusy(false);refocus(focusable.get(p.userId));}
  }
  async function removeOne(p){
    if(busy||!confirm(t('confirmDeleteCertificate')))return;setBusy(true);status(local,'');
    try{await api(certificatePath(p.userId),{},'DELETE',{redirectOnUnauthorized:false});if(current())await refresh('certificateDeleted');}
    catch(err){if(current())status(local,err);}finally{setBusy(false);refocus(focusable.get(p.userId));}
  }
  function fileList(key,items,line){const box=el('div');box.append(tr('p',key,'pilot-bulk-heading'));const list=el('ul');items.forEach(item=>list.append(line(item)));box.append(list);return box;}
  // Before anything is sent, each file is shown next to the person it would go to; duplicates and strangers are listed apart.
  function showPlan({matched,duplicates,unmatched}){
    report.replaceChildren();
    if(matched.length)report.append(fileList('bulkMatched',matched,({person,file})=>{const item=el('li');item.append(el('span',null,file.name+' → '+(person.name||person.email)));if(person.certificate)item.append(tr('span','bulkReplaces','pilot-bulk-note'));return item;}));
    if(duplicates.length)report.append(fileList('bulkDuplicate',duplicates,file=>el('li',null,file.name)));
    if(unmatched.length)report.append(fileList('bulkUnmatched',unmatched,file=>el('li',null,file.name)),tr('p','bulkUnmatchedHint','pilot-data-note'));
  }
  files.input.addEventListener('change',()=>{status(progress,'');if(data)showPlan(matchCertificates([...(files.input.files||[])],data.participants));});
  async function uploadAll(){
    if(busy||!data)return;
    const plan=matchCertificates([...(files.input.files||[])],data.participants),todo=plan.matched.filter(({file})=>!sent.has(fileKey(file)));showPlan(plan);
    if(!todo.length){status(progress,new Error(t(plan.matched.length?'bulkAlreadyUploaded':'bulkNothing')));return;}
    const replacing=todo.filter(({person})=>person.certificate).length;
    if(replacing&&!confirm(fill('confirmReplaceCertificates',{n:replacing})))return;
    const failed=[];let uploaded=0,stopped=null;setBusy(true);
    try{
      for(const [index,{person,file}] of todo.entries()){
        if(!current())return;say(progress,'bulkProgress',{current:index+1,total:todo.length});
        try{const pdf=await readCertificate(file);await api(certificatePath(person.userId),{mime:'application/pdf',data:pdf},'PUT',{redirectOnUnauthorized:false});sent.add(fileKey(file));uploaded++;}
        catch(err){
          // A refusal of one file is reported and the rest go on; anything else (session, rate limit, outage) stops the run.
          if(err.local||(/^certificate_/.test(err.code||'')&&[400,404,409,413].includes(err.status)))failed.push({file,err});else{stopped=err;break;}
        }
      }
    }finally{setBusy(false);refocus(start);}
    if(!current())return;
    say(progress,'bulkDone',{uploaded});report.replaceChildren();
    if(stopped){const reason=el('p','pilot-status');status(reason,stopped);report.append(reason,tr('p','bulkStopped','pilot-status is-error'));}
    if(failed.length)report.append(fileList('bulkFailed',failed,({file,err})=>{const item=el('li'),reason=el('span');status(reason,err);item.append(el('span',null,file.name+' — '),reason);return item;}));
    if(plan.duplicates.length)report.append(fileList('bulkDuplicate',plan.duplicates,file=>el('li',null,file.name)));
    if(plan.unmatched.length)report.append(fileList('bulkUnmatched',plan.unmatched,file=>el('li',null,file.name)),tr('p','bulkUnmatchedHint','pilot-data-note'));
    await load();
  }
  // Read on first opening of the tab, never for a course without the survey.
  return {element:pane,open(){if(!requested){requested=true;load().then(ok=>{if(!ok)requested=false;});}}};
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

async function showCourse(id,selected='responses',participantNotice=null){
  const version=++selectionVersion;selectedId=id;status(msg,t('loading'));
  try{
    const [{course,modules,finalSurvey},data]=await Promise.all([api('/api/courses/'+id),api(endpoint(id)+'/report')]);
    if(version!==selectionVersion)return;
    workspace.replaceChildren();
    const header=el('header','pilot-teaching-course');
    const title=el('div');title.append(courseState(course,'pilot-tag'),source('h2',course,'title'));
    const view=tr('a','open','pilot-text-link');view.href='course.html?id='+id;header.append(title,view);workspace.append(header);
    const tabs=el('div','pilot-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',t('teaching'));
    tabs.dataset.pilotAria='teaching';
    let paneClosed=course.enrollmentOpen===false;
    const updateCourse=async saved=>{
      Object.assign(course,saved);
      title.replaceChildren(courseState(course,'pilot-tag'),source('h2',course,'title'));
      courses=courses.map(item=>item.id===course.id?{...item,...saved}:item);
      await refreshList(false);
      if((course.enrollmentOpen===false)!==paneClosed)await refreshParticipants();
    };
    let activity=activityView(data,id);
    async function refreshParticipants(notice){
      try{
        const fresh=await api(endpoint(id)+'/report');
        if(version!==selectionVersion||selectedId!==id)return;
        paneClosed=course.enrollmentOpen===false;
        const previous=panes.participants,next=participantView(fresh,id,version,notice,refreshParticipants,paneClosed);
        next.id=previous.id;next.setAttribute('role','tabpanel');next.setAttribute('aria-labelledby','staff-tab-participants');next.hidden=previous.hidden;
        previous.replaceWith(next);panes.participants=next;
        const nextActivity=activityView(fresh,id);nextActivity.open=activity.open;activity.replaceWith(nextActivity);activity=nextActivity;
        status(msg,'');
      }catch(error){if(version===selectionVersion&&selectedId===id)status(msg,new Error(t('participantListRefreshError')));}
    }
    // The course page sends finalSurvey only for the one course that has the survey, so only that course gets the tab.
    const survey=finalSurvey?finalSurveyView(id,version):null;
    const panes={responses:responseView(data.feedback,id),participants:participantView(data,id,version,participantNotice,refreshParticipants,paneClosed),...(survey?{finalSurvey:survey.element}:{}),courseSetup:setupView(course,modules,id,updateCourse)};
    const buttons={};
    function activate(key){
      for(const name of Object.keys(panes)){
        panes[name].hidden=name!==key;buttons[name].setAttribute('aria-selected',String(name===key));buttons[name].tabIndex=name===key?0:-1;
      }
      if(key==='finalSurvey')survey.open();
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
    workspace.append(tabs,...Object.values(panes),activity);activate(selected);
    document.querySelectorAll('#staffCourses button').forEach(b=>{if(b.dataset.course===id)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    status(msg,'');
  }catch(err){if(version===selectionVersion)status(msg,err);}
}

async function refreshList(fetchLatest=true){
  if(fetchLatest)({courses}=await api(endpoint()));const list=document.getElementById('staffCourses');list.replaceChildren();
  courses.forEach(c=>{
    const b=el('button','pilot-course-select');b.type='button';b.dataset.course=c.id;
    b.append(source('span',c,'title'),courseState(c));b.addEventListener('click',()=>showCourse(c.id));
    if(c.id===selectedId)b.setAttribute('aria-current','page');list.append(b);
  });
}
async function allFeedback(){
  const version=++selectionVersion;
  try{const data=await api('/api/admin/feedback');if(version!==selectionVersion)return;workspace.replaceChildren(responseView(data.feedback,null));}
  catch(err){if(version===selectionVersion)status(msg,err);}
}
async function start(){status(msg,t('loading'));
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
