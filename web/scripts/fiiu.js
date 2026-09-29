(() => {
 'use strict';
 const {el,tr,t,source,button,link,field,check,api,status,dateNode,contentCards,badges}=window.Fiiu;
 const root=document.getElementById('fiiuRoot'),loadStatus=document.getElementById('fiiuStatus');
 let festival,me={registration:null,attendance:[],user:null},registrationHost;
 function programme(){
  const section=el('section','f-programme');section.id='programme';section.append(tr('h2','programmeTitle'),tr('p','programmeHint','f-muted'));
  for(const day of [...new Set(festival.event.activities.map(a=>a.date))].sort()){
   const row=el('section','f-day');row.append(dateNode(day,'h3'));const blocks=el('div','f-day-blocks');
   for(const activity of festival.event.activities.filter(a=>a.date===day)){
    const article=el('article','f-activity');article.append(tr('p',activity.period,'f-period'),source('h4',activity.title));
    if(activity.time)article.append(el('p','f-time',activity.time));else article.append(tr('p','timePending','f-muted'));
    if(activity.venue)article.append(source('p',activity.venue,'f-muted'));else article.append(tr('p','venuePending','f-muted'));
    if(activity.sessions.length){const details=el('details'),summary=tr('summary','details'),list=el('ul','f-session-list');for(const [time,title] of activity.sessions)list.append(source('li',`${time}  ${title}`));details.append(summary,list);article.append(details);}
    if(activity.registration==='external')article.append(link('external',festival.config[activity.linkKey]||festival.event.website,'f-text-link'));
    else article.append(link(activity.registration==='application'?'applyLab':'register','#registration','f-text-link'));
    blocks.append(article);
   }
   row.append(blocks);section.append(row);
  }
  return section;
 }
 function savedSummary(registration){
  const box=el('section','f-saved');box.tabIndex=-1;box.append(tr('h3','saved'),el('p','',`${registration.answers.firstName} ${registration.answers.lastName} · ${registration.email}`),tr('p','savedHint'));
  const list=el('ul');for(const id of registration.answers.activities){const a=festival.event.activities.find(x=>x.id===id);const li=el('li');li.append(dateNode(a.date,'span'),document.createTextNode(' — '),source('span',a.title));list.append(li);}box.append(list);
  if(registration.labStatus!=='none')box.append(tr('p',registration.labStatus,'f-application-status'));
  return box;
 }
 function renderRegistration(){
  registrationHost.replaceChildren(tr('h2','registration'));
  const message=el('p','f-status');message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  if(!me.user){registrationHost.append(tr('p','signinHint'),link('signin','login.html?next='+encodeURIComponent('/fiiu.html#registration'),'f-button'));return;}
  const existing=me.registration;
  if(existing){
   const summary=savedSummary(existing),actions=el('div','f-actions');
   if(festival.config.registrationOpen)actions.append(button('edit',()=>{form.hidden=false;summary.hidden=true;form.querySelector('input')?.focus();}));
   const cancel=button('cancel',async()=>{
    if(!window.confirm(t('cancelConfirm')))return;
    cancel.disabled=true;
    try{await api('/api/fiiu/registration',{version:me.registration.version,registrationId:me.registration.id},'DELETE');me.registration=null;me.attendance=[];renderRegistration();}
    catch(error){status(message,error);cancel.disabled=false;}
   },'f-button secondary');actions.append(cancel);summary.append(actions);registrationHost.append(summary);
  }
  const badgeBox=el('div','f-badges');if(existing){badges(badgeBox,me.attendance,festival.event);registrationHost.append(badgeBox);}
  if(!festival.config.registrationOpen){registrationHost.append(tr('p','closed','f-notice'),message);return;}
  const a=existing?.answers??{},form=el('form','f-form');form.hidden=!!existing;let currentVersion=existing?.version??0,currentId=existing?.id??null;
  const personal=el('fieldset');personal.append(tr('legend','personal'));
  personal.append(tr('p','privateHint','f-muted'));
  const email=field('email',{value:me.user.email,type:'email'});email.input.readOnly=true;personal.append(email.wrap);
  const grid=el('div','f-fields');
  for(const [key,max] of [['firstName',100],['lastName',120],['country',120],['city',160]]){const f=field(key,{value:a[key]??(key==='city'?me.user.city??'':''),required:true,max});f.input.autocomplete=({firstName:'given-name',lastName:'family-name',country:'country-name',city:'address-level2'})[key];grid.append(f.wrap);}
  const profile=field('profile',{value:a.profile,required:true,options:['student','academic','researcher','professional','entrepreneur','activist','organization','public_official','other']});grid.append(profile.wrap);
  const official=field('publicOfficial',{value:typeof a.publicOfficial==='boolean'?(a.publicOfficial?'yes':'no'):'',required:true,options:['yes','no']});grid.append(official.wrap);personal.append(grid);
  const choices=el('fieldset');choices.append(tr('legend','choices'),tr('p','programmeHint','f-muted'));
  for(const activity of festival.event.activities.filter(x=>x.registration==='general')){
   const label=el('label','f-activity-choice'),input=el('input');input.type='checkbox';input.name='activities';input.value=activity.id;input.checked=a.activities?.includes(activity.id)||false;
   const text=el('span');text.append(dateNode(activity.date,'strong'),source('span',`${activity.time} · ${activity.title}`));label.append(input,text);choices.append(label);
  }
  const laboratory=el('div','f-laboratory'),apply=check('applyLab','applyLab','yes',a.applyLab),institution=field('institution',{value:a.institution,max:200}),position=field('position',{value:a.position,max:200});
  laboratory.append(apply.wrap,tr('p','labHint','f-muted'),institution.wrap,position.wrap);choices.append(laboratory);
  const syncLab=()=>{laboratory.hidden=official.input.value!=='yes';apply.input.disabled=laboratory.hidden;if(laboratory.hidden)apply.input.checked=false;for(const f of [institution,position]){f.wrap.hidden=laboratory.hidden||!apply.input.checked;f.input.disabled=f.wrap.hidden;f.input.required=!f.wrap.hidden;}};
  official.input.addEventListener('change',syncLab);apply.input.addEventListener('change',syncLab);syncLab();
  const optional=el('details','f-optional');optional.append(tr('summary','optionalDetails'));const optionalGrid=el('div','f-fields');
  for(const key of ['nationalId','age']){const f=field(key,{value:a[key]??'',type:key==='age'?'number':'text',max:50});if(key==='age'){f.input.min='1';f.input.max='120';f.input.step='1';}optionalGrid.append(f.wrap);}
  for(const [key,options] of [['gender',['female','male','other','prefer_not']],['motivation',['learn','career','network','explore','other']],['previousAttendance',['all','some','no']]])optionalGrid.append(field(key,{value:a[key],options}).wrap);
  optional.append(optionalGrid);const access=el('fieldset');access.append(tr('legend','accessibility'));
  for(const key of ['none','mobility','visual','hearing','communication','other']){const c=check(key,'accessibility',key,a.accessibility?.includes(key));c.input.addEventListener('change',()=>{if(c.input.checked)access.querySelectorAll('input').forEach(input=>{if(input!==c.input&&(key==='none'||input.value==='none'))input.checked=false;});});access.append(c.wrap);}
  optional.append(access,field('accessibilityOther',{value:a.accessibilityOther,type:'textarea',max:500}).wrap,field('motivationOther',{value:a.motivationOther,type:'textarea',max:500}).wrap);
  const privacy=check('privacyAccepted','privacyAccepted','yes',a.privacyAccepted);privacy.input.required=true;
  const conflictBox=el('div','f-conflict');
  const submit=button('save');submit.type='submit';
  form.append(personal,choices,optional,privacy.wrap,link('privacy','privacy.html','f-text-link'),message,conflictBox,submit);registrationHost.append(form);
  if(existing)registrationHost.append(message);
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(!form.reportValidity())return;const fd=new FormData(form),payload=Object.fromEntries(fd);
   Object.assign(payload,{version:currentVersion,registrationId:currentId,publicOfficial:fd.get('publicOfficial')==='yes',applyLab:fd.get('applyLab')==='yes',privacyAccepted:fd.get('privacyAccepted')==='yes',activities:fd.getAll('activities'),accessibility:fd.getAll('accessibility'),age:fd.get('age')?Number(fd.get('age')):null});
   submit.disabled=true;status(message,'saving');conflictBox.replaceChildren();
   try{const result=await api('/api/fiiu/registration',payload,'PUT');me.registration=result.registration;renderRegistration();registrationHost.querySelector('.f-saved')?.focus();}
   catch(error){status(message,error);
    if(error.status===409)conflictBox.append(button('viewSaved',async()=>{
     try{const latest=await api('/api/fiiu/registration');conflictBox.replaceChildren();if(latest.registration)conflictBox.append(savedSummary(latest.registration));
      conflictBox.append(button('useLatest',()=>{currentVersion=latest.registration?.version??0;currentId=latest.registration?.id??null;me.registration=latest.registration;conflictBox.replaceChildren();status(message,'');}));
     }catch(err){status(message,err);}
    },'f-button secondary'));
    if(error.status===401){const signin=link('signin','login.html?next='+encodeURIComponent('/fiiu.html#registration'));signin.target='_blank';signin.rel='noopener';conflictBox.append(signin);}
   }finally{submit.disabled=false;}
  });
 }
 async function load(){
  status(loadStatus,'loading');root.replaceChildren();
  try{
   festival=await api('/api/fiiu');
   const auth=await api('/api/auth/state');
   if(auth.authenticated)me=await api('/api/fiiu/registration');
   const hero=el('section','f-hero'),intro=el('div','f-hero-copy');intro.append(el('p','f-festival-name','FIIU Fest 11'),tr('span','spanishContent','content-language'),source('h1',festival.event.theme),tr('p','intro'),tr('p','languageHint','f-muted'));
   const actions=el('div','f-actions');actions.append(link('register','#registration','f-button'),link('website',festival.event.website));intro.append(actions);
   const date=el('aside','f-date-panel'),range=el('strong','f-date-range');range.setAttribute('aria-hidden','true');range.append(el('span','','20'),el('span','f-date-separator','–'),el('span','','25'));date.append(range,tr('p','dates'),source('h2',festival.event.city));if(festival.config.programUrl)date.append(link('officialProgram',festival.config.programUrl,'f-text-link'));hero.append(intro,date);root.append(hero);
   if(me.isAdmin)root.append(link('admin','fiiu-admin.html','f-text-link f-admin-link'));
   const layout=el('div','f-layout');registrationHost=el('section','f-registration');registrationHost.id='registration';layout.append(programme(),registrationHost);root.append(layout);renderRegistration();
   const separate=el('section','f-separate');separate.append(tr('h2','external'),tr('p','externalHint'));const externalActions=el('div','f-actions');for(const [key,label] of [['workshopsUrl','workshop'],['routesUrl','route'],['partyUrl','party']])externalActions.append(link(label,festival.config[key]||festival.event.website));separate.append(externalActions);root.append(separate);
   const feeds=[];for(const [title,isNews,empty] of [['news',true,'noNews'],['materials',false,'noMaterials']]){const section=el('section','f-updates');section.id=title;section.append(tr('h2',title));const list=el('div','f-news');contentCards(list,festival.content.filter(x=>(x.kind==='news')===isNews),empty);section.append(list);root.append(section);feeds.push({list,isNews,empty});}
   const more=button('loadMore',async()=>{more.disabled=true;try{const page=await api('/api/fiiu?cursor='+encodeURIComponent(festival.nextCursor));festival.content.push(...page.content);festival.nextCursor=page.nextCursor;for(const feed of feeds)contentCards(feed.list,festival.content.filter(x=>(x.kind==='news')===feed.isNews),feed.empty);more.hidden=!page.nextCursor;status(loadStatus,'');}catch(err){status(loadStatus,err);}finally{more.disabled=false;}});more.hidden=!festival.nextCursor;root.append(more);
   status(loadStatus,'');if(['#registration','#news','#materials'].includes(location.hash))document.querySelector(location.hash)?.scrollIntoView({block:'start'});
  }catch(error){status(loadStatus,error);root.append(button('retry',load));}
 }
 load();
})();
