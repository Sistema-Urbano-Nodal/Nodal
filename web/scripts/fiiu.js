(() => {
 'use strict';
 const {el,tr,t,source,button,link,field,check,api,status,dateNode,rangeNode,limaDate,contentCards,badges,findActivity,chronological,typeOf,countLabel,nextFor,hint,describe,newTabNote,revealInRow,hoursLine}=window.Fiiu;
 const root=document.getElementById('fiiuRoot'),loadStatus=document.getElementById('fiiuStatus');
 const TYPES=[['conference','conferenceOne','conferenceMany'],['workshop','workshopOne','workshopMany'],['route','routeOne','routeMany'],['lab','labOne','labOne']];
 const CHOICE_NAMES=['activities','externalActivities','applyLab'];
 let festival,me={registration:null,attendance:[],user:null},registrationHost,panelHeading,panelBody,heroHost,programmeHost,openForm=null,officialInput=null,syncForm=null,notice='',dayObserver=null,stepObserver=null,sizeObserver=null,errorSeq=0;
 // choiceInputs maps an activity id to its form checkbox, so programme actions can pre-select it.
 // programmeActions maps an activity id to its programme button, so the button can show that the box is now ticked in the form.
 const choiceInputs=new Map(),programmeActions=new Map(),dayChips=new Map(),visibleDays=new Set();
 // The status line can take focus, so a failed save can move there (fiiu.css keeps focused controls clear of the sticky bars).
 const message=el('p','f-status');message.setAttribute('role','status');message.setAttribute('aria-live','polite');message.tabIndex=-1;
 const panelNotice=el('p','f-status f-notice is-ok');panelNotice.setAttribute('role','status');panelNotice.setAttribute('aria-live','polite');
 const missingAnswers=a=>['country','city','profile','nationalId','gender','motivation','previousAttendance'].filter(k=>!a[k]).length+(Number.isInteger(a.age)?0:1)+(Array.isArray(a.accessibility)&&a.accessibility.length?0:1)+(typeof a.publicOfficial==='boolean'?0:1);
 function jumpTo(input,event){event?.preventDefault?.();if(!input)return;openForm?.();const fold=input.closest?.('details');if(fold)fold.open=true;input.focus();input.scrollIntoView?.({block:'center'});}
 function typeCounts(list){const counts={};for(const activity of list){const type=typeOf(activity);counts[type]=(counts[type]||0)+1;}return TYPES.filter(([type])=>counts[type]).map(([type,one,many])=>countLabel(counts[type],one,many));}
 function renderHero(){
  const event=festival.event,config=festival.config,registration=me.registration,copy=el('div','f-hero-copy'),title=el('h1','f-hero-title'),kicker=el('span','f-kicker');
  kicker.append(el('span','',event.title),source('span',event.city));title.append(kicker,source('span',event.theme,'f-hero-theme'));
  const meta=el('p','f-hero-meta'),counts=el('p','f-hero-counts');
  meta.append(rangeNode(event.startsOn,event.endsOn),tr('span',config.registrationOpen?'registrationOpenNow':'registrationClosedNow',config.registrationOpen?'is-open':''));counts.append(...typeCounts(event.activities));
  copy.append(title,tr('span','spanishContent','content-language'),tr('p','intro','f-hero-intro'),meta,counts);
  if(registration){
   const a=registration.answers,pills=el('p','f-hero-status'),interests=a.externalActivities?.length||0;pills.append(tr('span','statusRegistered','f-pill is-ok'));
   if(a.activities.length)pills.append(countLabel(a.activities.length,'conferenceOne','conferenceMany','f-pill'));
   if(interests)pills.append(countLabel(interests,'interestOne','interestMany','f-pill'));
   if(registration.labStatus!=='none')pills.append(tr('span',registration.labStatus+'Short','f-pill is-'+registration.labStatus));
   if(missingAnswers(a))pills.append(tr('span','actionNeeded','f-pill is-pending'));
   copy.append(pills);
  }
  // Once registration closes, people without one are pointed to the programme instead of a form they cannot send.
  const actions=el('div','f-actions');actions.append(registration?link('viewRegistration','#registration','f-button'):config.registrationOpen?link('register','#registration','f-button'):link('viewProgramme','#programme','f-button'));if(config.programUrl)actions.append(link('officialProgram',config.programUrl));actions.append(link('website',event.website,'f-text-link'));copy.append(actions);
  // The poster repeats the facts row visually, so it is hidden from assistive technology.
  const next=nextFor(registration,event),panel=el('aside','f-date-panel'+(next?' has-next':'')),poster=el('div','f-date-poster'),range=el('strong','f-date-range');poster.setAttribute('aria-hidden','true');
  range.append(el('span','',String(Number(event.startsOn.slice(8)))),el('span','f-date-separator','–'),el('span','',String(Number(event.endsOn.slice(8)))));
  poster.append(range,tr('p','datesMonth','f-date-month'),source('p',event.city,'f-city'));panel.append(poster);
  if(next){const box=el('div','f-next'),when=el('p','f-next-when');when.append(dateNode(next.date,'span','short','f-next-day'));if(next.time)when.append(el('span','f-next-time',next.time));box.append(tr('p','nextForYou','f-next-label'),when,source('p',next.title,'f-next-title'));panel.append(box);}
  heroHost.replaceChildren(copy,panel);
 }
 // One-way shortcut from the programme into the form: it checks the matching box and focuses it, never un-checks.
 // Registrations carry the green check; a saved interest is not a confirmation, so its pill stays neutral.
 function choiceAction(activity,mine,savedKey,addKey,titleId){
  if(mine)return tr('span',savedKey,savedKey==='interestChip'?'f-pill':'f-pill is-ok');
  const input=choiceInputs.get(activity.id);
  if(input){const action=describe(button(addKey,event=>{if(input.disabled)return;openForm?.();input.checked=true;syncForm?.(true);jumpTo(input,event);},'f-button secondary f-small'),titleId);programmeActions.set(activity.id,{action,addKey});syncProgramme();return action;}
  if(!me.user&&festival.config.registrationOpen&&activity.registration==='general')return describe(link('register','#registration','f-text-link'),titleId);
  return null;
 }
 // One-way feedback: a programme button whose form box is ticked says so; clicking it again only returns to that box.
 function syncProgramme(){for(const [id,{action,addKey}] of programmeActions){const input=choiceInputs.get(id),on=Boolean(input?.checked&&!input.disabled),key=on?'choiceAdded':addKey;if(action.dataset.fiiuText===key)continue;action.dataset.fiiuText=key;action.textContent=t(key);action.className='f-button secondary f-small'+(on?' is-added':'');}}
 function labCard(activity,labStatus){
  const card=el('article','f-activity is-lab'),title=source('h4',activity.title);title.id='f-act-'+activity.id+'-title';card.append(title,tr('p','labType','f-lab-type'));
  if(labStatus!=='none'){card.append(tr('p',labStatus+'Short','f-pill is-'+labStatus));return card;}
  if(!festival.config.registrationOpen)return card;
  const apply=describe(link('apply',officialInput?'#f-publicOfficial':'#registration','f-button secondary f-small'),title.id);
  if(officialInput)apply.addEventListener('click',event=>{const lab=choiceInputs.get(activity.id);jumpTo(lab&&!lab.disabled?lab:officialInput,event);});
  card.append(apply);return card;
 }
 function conferenceCard(activity,mine){
  const card=el('article','f-activity is-conference'),rail=el('div','f-time-rail'),body=el('div','f-activity-body'),title=source('h4',activity.title);title.id='f-act-'+activity.id+'-title';
  rail.append(activity.time?el('p','f-time',activity.time):tr('p','timePending','f-muted'),tr('p',activity.period,'f-period'));
  const foot=el('div','f-activity-foot'),action=choiceAction(activity,mine,'statusRegistered','addToRegistration',title.id);body.append(activity.venue?source('p',activity.venue,'f-venue'):tr('p','venuePending','f-muted f-venue'));
  if(activity.sessions.length){const details=el('details','f-sessions'),summary=el('summary'),list=el('ul','f-session-list');summary.append(countLabel(activity.sessions.length,'sessionOne','sessions'));describe(summary,title.id);for(const [time,name] of activity.sessions){const item=el('li');item.append(el('span','f-session-time',time),source('span',name));list.append(item);}details.append(summary,list);foot.append(details);}
  if(action)foot.append(action);if(foot.children.length)body.append(foot);
  // The title comes first in the DOM so heading navigation lands before the time; CSS places the time rail beside it.
  card.append(title,rail,body);return card;
 }
 // A workshop shows its venue and a route its starting point, as a quiet line under the title; an external activity without one shows nothing.
 function venueLine(activity,cls){
  if(!activity.venue)return null;if(typeOf(activity)!=='route')return source('p',activity.venue,cls);
  const line=el('p',cls);line.append(tr('span','startingPoint','f-venue-label'),source('span',' '+activity.venue));return line;
 }
 function typeGroup(type,items,interests){
  const group=el('div','f-type-group'),head=el('div','f-type-head'),list=el('ul','f-compact-list');
  head.append(tr('h4',type),tr('span','external','f-type-note'));
  for(const activity of items){
   const mine=interests.has(activity.id),row=el('li','f-compact'),main=el('div','f-compact-main'),title=source('p',activity.title,'f-compact-title'),where=venueLine(activity,'f-compact-venue'),actions=el('div','f-compact-actions');title.id='f-act-'+activity.id+'-title';
   main.append(title);if(where)main.append(where);
   const action=choiceAction(activity,mine,'interestChip','saveInterest',title.id);if(action)actions.append(action);
   actions.append(describe(link('activityForm',activity.formUrl||festival.event.website,'f-text-link'),title.id));row.append(main,actions);list.append(row);
  }
  group.append(head,list);return group;
 }
 // Marks the day in view (the last one crossing the band under the sticky navigation) and, on narrow screens, scrolls the chip row so that chip stays visible.
 function markDay(){
  const current=[...dayChips.keys()].filter(day=>visibleDays.has(day)).at(-1);
  // While a chip has keyboard focus the row stays where the browser put it, so the focused chip is never scrolled out of view.
  for(const [day,chip] of dayChips){if(day!==current){chip.removeAttribute('aria-current');continue;}if(chip.getAttribute('aria-current')==='true')continue;chip.setAttribute('aria-current','true');const row=chip.parentElement?.parentElement;if(row&&!row.contains(document.activeElement))revealInRow(row,chip);}
 }
 function renderProgramme(){
  const event=festival.event,registration=me.registration,mine=new Set(registration?.answers.activities||[]),interests=new Set(registration?.answers.externalActivities||[]),labStatus=registration?.labStatus||'none';
  const head=el('div','f-section-head'),nav=el('nav','f-day-nav'),navLabel=tr('span','dayNav','f-sr-only'),chips=el('ol','f-day-chips'),sections=[];
  head.append(tr('h2','programmeTitle'),tr('p','programmeHint','f-muted'));
  navLabel.id='f-day-nav-label';nav.setAttribute('aria-labelledby',navLabel.id);nav.append(navLabel,chips);chips.addEventListener('focusin',event=>{const chip=event?.target?.closest?.('a');if(chip)revealInRow(chips,chip);});
  programmeHost.replaceChildren(head,nav);dayChips.clear();visibleDays.clear();programmeActions.clear();
  for(const day of [...new Set(event.activities.map(a=>a.date))].sort()){
   const list=chronological(event.activities.filter(a=>a.date===day)),of=type=>list.filter(a=>typeOf(a)===type);
   const item=el('li'),chip=el('a','f-day-chip');chip.href='#day-'+day;
   chip.append(dateNode(day,'span','weekday','f-day-chip-weekday'),el('span','f-day-chip-num',String(Number(day.slice(8)))));item.append(chip);chips.append(item);dayChips.set(day,chip);
   const section=el('section','f-day'),header=el('header','f-day-head'),blocks=el('div','f-day-blocks');section.id='day-'+day;
   header.append(dateNode(day,'h3'));
   for(const activity of of('lab'))blocks.append(labCard(activity,labStatus));
   for(const activity of of('conference'))blocks.append(conferenceCard(activity,mine.has(activity.id)));
   for(const type of ['workshop','route'])if(of(type).length)blocks.append(typeGroup(type,of(type),interests));
   section.append(header,blocks);programmeHost.append(section);sections.push(section);
  }
  const party=el('aside','f-party');party.append(tr('h3','party'),tr('p','partyHint','f-muted'),festival.config.partyUrl?link('partyRegister',festival.config.partyUrl):link('partyDetails',event.website));programmeHost.append(party);
  if('IntersectionObserver' in window){
   dayObserver??=new IntersectionObserver(entries=>{for(const entry of entries){const day=entry.target.id.slice(4);if(entry.isIntersecting)visibleDays.add(day);else visibleDays.delete(day);}markDay();},{rootMargin:'-180px 0px -60% 0px'});
   dayObserver.disconnect();for(const section of sections)dayObserver.observe(section);
  }
 }
 function itineraryRow(activity,prefix){const row=el('li','f-itinerary-row'),when=el('span','f-itinerary-when'),title=source('span',activity.title,'f-itinerary-title');title.id=prefix+activity.id;when.append(dateNode(activity.date,'span','short','f-itinerary-day'));if(activity.time)when.append(el('span','f-itinerary-time',activity.time));row.append(when,title);return row;}
 function savedSummary(registration,{withBadges=false,prefix='f-it-'}={}){
  const a=registration.answers,event=festival.event,box=el('section','f-saved'),head=el('div','f-saved-head'),heading=tr('h3','saved');box.tabIndex=-1;heading.id=prefix+'saved-heading';box.setAttribute('aria-labelledby',heading.id);
  head.append(heading,el('p','f-saved-who',`${a.firstName} ${a.lastName} · ${registration.email}`));box.append(head);
  // Once registration closes there is no Edit button, so the notice points to the organisers instead.
  if(missingAnswers(a))box.append(tr('p',festival.config.registrationOpen?'incompleteNotice':'incompleteClosedNotice','f-notice is-warning'));
  const split=ids=>{const known=[],unknown=[];for(const id of ids||[]){const activity=findActivity(event,id);if(activity)known.push(activity);else unknown.push(id);}return[chronological(known),unknown];};
  const unknownRow=id=>{const row=el('li','f-itinerary-row');row.append(source('span',id,'f-itinerary-title'));return row;};
  const [registered,unknownActivities]=split(a.activities),plan=el('ol','f-itinerary');
  for(const activity of chronological([...registered,...(registration.labStatus!=='none'?event.activities.filter(x=>x.registration==='application'):[])])){
   const row=itineraryRow(activity,prefix);
   if(activity.registration==='application')row.append(tr('span',registration.labStatus+'Short','f-pill is-'+registration.labStatus),tr('p',registration.labStatus+'Hint','f-muted f-itinerary-note'));
   else row.append(tr('span','statusRegistered','f-pill is-ok'));
   plan.append(row);
  }
  plan.append(...unknownActivities.map(unknownRow));if(plan.children.length)box.append(tr('h4','myPlan'),plan);
  if(a.externalActivities?.length){
   const [interests,unknownInterests]=split(a.externalActivities),list=el('ol','f-itinerary');
   for(const activity of interests){const row=itineraryRow(activity,prefix),where=venueLine(activity,'f-itinerary-venue');row.append(tr('span','interestChip','f-pill'));if(where)row.append(where);if(activity.formUrl)row.append(describe(link('externalFormNext',activity.formUrl,'f-text-link'),prefix+activity.id));list.append(row);}
   list.append(...unknownInterests.map(unknownRow));box.append(tr('h4','externalActivities'),tr('p','externalInterestHint','f-muted'),list);
  }
  box.append(tr('p','savedHint','f-muted'));
  // Badges, then the hours they add up to for the certificate.
  if(withBadges){if(me.attendance.length||limaDate()>=event.startsOn){const badgeBox=el('div','f-badges'),hours=hoursLine(me.attendance,event);badges(badgeBox,me.attendance,event,{heading:'h4'});if(hours)badgeBox.append(hours);box.append(badgeBox);}else box.append(tr('p','badgesHint','f-muted'));}
  return box;
 }
 function renderRegistration(){renderPanel();renderProgramme();renderHero();}
 // A notice is a string key, or {key, email} for "We emailed a summary to <address>.": the sentence follows the language, the address stays as it is.
 // An email that failed or may not arrive is a warning, not the green confirmation.
 function showNotice(value){
  panelNotice.className='f-status f-notice '+(['emailNotSent','emailDelayed'].includes(value)?'is-warning':'is-ok');
  panelNotice.replaceChildren();status(panelNotice,value?.email?'':value);if(!value?.email)return;
  delete panelNotice.dataset.fiiuText;panelNotice.append(tr('span',value.key),el('span','f-notice-email',' '+value.email+'.'));
 }
 // Only the first save answers with the summary email's outcome; nothing is said when email is off, skipped or for an edit.
 // 'failed' means the provider never had it; 'uncertain' (and a send that never reported back) usually still arrives.
 const emailNotice=(outcome,email)=>outcome==='sent'?{key:'emailSent',email}:outcome==='failed'?'emailNotSent':['uncertain','pending'].includes(outcome)?'emailDelayed':'';
 function renderPanel(){
  choiceInputs.clear();openForm=null;officialInput=null;syncForm=null;sizeObserver?.disconnect();stepObserver?.disconnect();status(message,'');panelBody.replaceChildren();showNotice(notice);notice='';
  registrationHost.className='f-registration'+(!me.user||(!festival.config.registrationOpen&&!me.registration)?' is-compact':'');
  if(!me.user){
   // Once registration closes, the guest panel only leads people who already registered back to their registration.
   const open=festival.config.registrationOpen;
   if(!open)panelBody.append(tr('p','closed','f-notice'));
   panelBody.append(open?tr('p','signinHint'):tr('p','signinClosedHint','f-closed-hint'));
   if(open){const list=el('ul','f-checklist');for(const key of ['canConferences','canLab','canInterests'])list.append(tr('li',key));panelBody.append(list,tr('p','formDuration','f-muted'));}
   panelBody.append(link('signin','login.html?next='+encodeURIComponent('/fiiu.html#registration'),'f-button'));if(open)panelBody.append(tr('p','privateHint','f-muted f-guest-privacy'));return;
  }
  const expectedUserId=me.user.id,conflictBox=el('div','f-conflict');let busy=false,saveState='';
  function lock(){
   busy=true;const active=document.activeElement,controls=[...registrationHost.querySelectorAll('input,select,textarea,button')].map(control=>[control,control.disabled]),form=registrationHost.querySelector('form');
   for(const [control] of controls)control.disabled=true;form?.setAttribute('aria-busy','true');
   // Disabling the focused control drops focus to <body>; put it back when the control is usable again.
   return()=>{busy=false;for(const [control,disabled] of controls)control.disabled=disabled;form?.setAttribute('aria-busy','false');if(active?.isConnected&&!active.disabled&&(!document.activeElement||document.activeElement===document.body))active.focus();};
  }
  function accountChanged(){status(message,Object.assign(Error(t('accountChanged')),{key:'accountChanged'}));conflictBox.replaceChildren(button('reloadAccount',()=>location.reload()));}
  async function currentRegistration(){const latest=await api('/api/fiiu/registration');if(latest.user.id!==expectedUserId)throw Object.assign(Error(t('accountChanged')),{key:'accountChanged',status:409});return latest;}
  function reloadSaved(){
   conflictBox.replaceChildren(button('reloadSaved',async()=>{
    if(busy)return;const unlock=lock();
    try{me=await currentRegistration();renderRegistration();(registrationHost.querySelector('.f-saved')||panelHeading).focus();}
    catch(error){if(error.key==='accountChanged')accountChanged();else status(message,error);}
    finally{unlock();}
   },'f-button secondary'));
  }
  const existing=me.registration;let summary=null,firstAnswer=null;
  if(existing){
   summary=savedSummary(existing,{withBadges:true});const actions=el('div','f-actions');
   if(festival.config.registrationOpen)actions.append(button('edit',()=>{openForm();firstAnswer?.focus();}));
   const cancel=button('cancel',async()=>{
    // Cancelling also deletes confirmed attendance, so the question says so once there is some.
    if(busy||!window.confirm(t('cancelConfirm')+(me.attendance.length?' '+t('cancelWithAttendance'):'')))return;
    const unlock=lock();status(message,'saving');conflictBox.replaceChildren();
    try{await api('/api/fiiu/registration',{version:me.registration.version,registrationId:me.registration.id,expectedUserId},'DELETE');notice='cancelled';me.registration=null;me.attendance=[];renderRegistration();panelHeading.focus();}
    catch(error){if(error.key==='accountChanged')accountChanged();else{status(message,error);reloadSaved();}}
    finally{unlock();}
   },'f-button secondary');actions.append(cancel);summary.append(actions);panelBody.append(summary);
  }
  if(!festival.config.registrationOpen){panelBody.append(tr('p','closed','f-notice'),message,conflictBox);return;}
  const a=existing?.answers??{},form=el('form','f-form'),feedback=el('div','f-form-feedback');form.hidden=!!existing;let currentVersion=existing?.version??0,currentId=existing?.id??null;
  // Validation state. localised: controls carrying a message set by onInvalid; customKeys: the "choose one" and accessibility rules; errorNotes: the persistent text cue
  // shown beside each flagged answer (the native bubble fades, and colour alone is not enough). The note sits inside the label, hidden from its name, and describes the control.
  const localised=new WeakMap(),customKeys=new WeakMap(),errorNotes=new Map();
  function flag(control,error){
   control.setAttribute?.('aria-invalid',error?'true':'false');const host=control.closest?.('.f-field,.f-check,.f-activity-choice'),note=errorNotes.get(control);if(!host)return;
   const ids=(control.getAttribute('aria-describedby')||'').split(' ').filter(id=>id&&id!==note?.id);
   if(!error){if(note){note.remove();errorNotes.delete(control);if(ids.length)control.setAttribute('aria-describedby',ids.join(' '));else control.removeAttribute('aria-describedby');}return;}
   const next=error.key?tr('span',error.key,'f-error'):el('span','f-error',error.text||t('requiredField'));next.id=note?.id||'f-err-'+(++errorSeq);next.setAttribute('aria-hidden','true');
   if(note)note.replaceWith(next);else host.append(next);errorNotes.set(control,next);control.setAttribute('aria-describedby',[...ids,next.id].join(' '));
  }
  const clearLocalised=control=>{if(!control)return;if(localised.has(control)){control.setCustomValidity('');localised.delete(control);}flag(control,null);};
  // The submit handler validates, so the accessibility and choose-one rules are reported with every other field in one pass.
  form.noValidate=true;
  // Editing keeps the saved summary (and its Cancel action) one click away; re-rendering discards the draft.
  if(existing){openForm=()=>{form.hidden=false;summary.hidden=true;registrationHost.className='f-registration';feedback.append(message,conflictBox);};form.append(button('backToSaved',()=>{if(busy)return;renderRegistration();registrationHost.querySelector('.f-saved')?.focus();},'f-button secondary f-small f-back'));}
  else openForm=()=>{};
  // Each step: fieldset id, legend key, and the short name shown in the sticky step bar.
  const steps=[['f-step-personal','personal','personal'],['f-step-choices','choices','stepChoices'],['f-step-questions','questionnaire','stepQuestions'],['f-step-consent','consentStep','stepConsent']],stepsNav=el('nav','f-steps'),stepsLabel=tr('span','stepsLabel','f-sr-only'),stepList=el('ol');
  stepsLabel.id='f-steps-label';stepsNav.setAttribute('aria-labelledby',stepsLabel.id);
  const stepLinks=steps.map(([id,,short],i)=>{const item=el('li'),step=el('a','f-step');step.href='#'+id;step.append(tr('span',short));item.append(step);stepList.append(item);return step;});
  // A completed step is described as such; the tick drawn in CSS has no text.
  const stepDone=tr('span','stepDone');stepDone.id='f-step-done';stepDone.hidden=true;stepsNav.append(stepsLabel,stepList,stepDone);
  // The step row stays on one line and scrolls sideways in a narrow panel, as the day nav does: the current or focused step is kept in view.
  const revealStep=()=>{const step=stepLinks.find(link=>link.getAttribute('aria-current')==='step');if(step&&!stepList.contains(document.activeElement))revealInRow(stepList,step);};
  stepList.addEventListener('focusin',event=>{const step=event?.target?.closest?.('a');if(step)revealInRow(stepList,step);});
  const legend=key=>{const node=el('legend');node.append(tr('span',key));return node;};
  const [personal,choices,details,consent]=steps.map(([id],i)=>{const set=el('fieldset',i===2?'f-questionnaire':'');set.id=id;set.append(legend(steps[i][1]));return set;});
  personal.setAttribute('aria-describedby','f-hint-privateHint');personal.append(hint('privateHint'));
  const email=field('email',{value:me.user.email,type:'email'});email.input.readOnly=true;personal.append(email.wrap);
  const grid=el('div','f-fields');
  for(const [key,max] of [['firstName',100],['lastName',120],['country',120],['city',160]]){const f=field(key,{value:a[key]??(key==='city'?me.user.city??'':''),required:true,max});f.input.autocomplete=({firstName:'given-name',lastName:'family-name',country:'country-name',city:'address-level2'})[key];firstAnswer??=f.input;grid.append(f.wrap);}
  const profile=field('profile',{value:a.profile,required:true,options:['student','academic','researcher','professional','entrepreneur','activist','organization','public_official','other']});
  const official=field('publicOfficial',{value:typeof a.publicOfficial==='boolean'?(a.publicOfficial?'yes':'no'):'',required:true,options:['yes','no']});
  // The hint sits inside the label for layout but is hidden from the label text; it is exposed once, as the description.
  const labQuestion=tr('span','labQuestionHint','f-hint');labQuestion.id='f-hint-labQuestionHint';labQuestion.setAttribute('aria-hidden','true');official.wrap.append(labQuestion);official.input.setAttribute('aria-describedby',labQuestion.id);officialInput=official.input;
  for(const f of [profile,official]){f.wrap.className='f-field f-field-wide';grid.append(f.wrap);}personal.append(grid);
  choices.setAttribute('aria-describedby','f-hint-choicesHint');choices.append(hint('choicesHint'));
  const laboratory=el('div','f-laboratory'),apply=check('applyLab','applyLab','yes',a.applyLab),institution=field('institution',{value:a.institution,max:200}),position=field('position',{value:a.position,max:200});
  apply.input.setAttribute('aria-describedby','f-hint-labHint');laboratory.append(apply.wrap,hint('labHint'),institution.wrap,position.wrap);choices.append(laboratory);
  for(const activity of festival.event.activities.filter(x=>x.registration==='application'))choiceInputs.set(activity.id,apply.input);
  // A field that is hidden again also drops its error, so the save bar never reports a problem the person cannot see.
  const syncLab=()=>{laboratory.hidden=official.input.value!=='yes';apply.input.disabled=laboratory.hidden;if(laboratory.hidden)apply.input.checked=false;for(const f of [institution,position]){f.wrap.hidden=laboratory.hidden||!apply.input.checked;f.input.disabled=f.wrap.hidden;f.setRequired(!f.wrap.hidden);if(f.wrap.hidden)clearLocalised(f.input);}};
  institution.input.autocomplete='organization';position.input.autocomplete='organization-title';
  official.input.addEventListener('change',syncLab);apply.input.addEventListener('change',syncLab);
  // A programmatic answer fires no event on the select, so its earlier error is cleared here.
  profile.input.addEventListener('change',()=>{if(profile.input.value==='public_official'&&!official.input.value){official.input.value='yes';clearLocalised(official.input);syncLab();}});
  for(const activity of chronological(festival.event.activities.filter(x=>x.registration==='general'))){
   const label=el('label','f-activity-choice'),input=el('input'),text=el('span','f-choice-text');input.type='checkbox';input.name='activities';input.value=activity.id;input.id='f-act-'+activity.id;input.checked=a.activities?.includes(activity.id)||false;
   text.append(dateNode(activity.date,'span','short','f-choice-day'));if(activity.time)text.append(el('span','f-choice-time',activity.time));text.append(source('span',activity.title,'f-choice-title'));label.append(input,text);choices.append(label);choiceInputs.set(activity.id,input);
  }
  // The programme already lists every workshop and route with a "Save as interest" shortcut, so the form keeps its copy folded until needed.
  const externalBox=el('details','f-external-box'),externalSummary=el('summary'),externalCount=el('span','f-external-count'),externalChoices=el('fieldset','f-external-choices');externalSummary.append(tr('span','externalActivities'),externalCount);
  externalChoices.setAttribute('aria-describedby','f-hint-externalInterestHint');externalChoices.append(tr('legend','externalActivities','f-sr-only'),hint('externalInterestHint'));
  const externals=chronological(festival.event.activities.filter(activity=>activity.registration==='external'));
  for(const day of [...new Set(externals.map(activity=>activity.date))]){
   const group=el('fieldset','f-external-day');group.append(dateNode(day,'legend','long','f-external-day-label'));
   for(const activity of externals.filter(item=>item.date===day)){
    const row=el('div','f-external-choice'),label=el('label','f-check'),input=el('input'),title=source('span',activity.title,'f-choice-title');input.type='checkbox';input.name='externalActivities';input.value=activity.id;input.id='f-act-'+activity.id;input.checked=a.externalActivities?.includes(activity.id)||false;title.id='f-choice-'+activity.id+'-title';
    const meta=el('p','f-external-meta');label.append(input,title);meta.append(tr('span',typeOf(activity)==='route'?'routeType':'workshopType','f-chip'),describe(link('activityForm',activity.formUrl||festival.event.website,'f-text-link'),title.id));row.append(label,meta);group.append(row);choiceInputs.set(activity.id,input);
   }
   externalChoices.append(group);
  }
  externalBox.open=Boolean(a.externalActivities?.length);externalBox.append(externalSummary,externalChoices);choices.append(externalBox);
  const detailGrid=el('div','f-fields'),questions={};
  for(const key of ['nationalId','age']){const f=field(key,{value:a[key]??'',type:key==='age'?'number':'text',max:50,required:true});if(key==='age'){f.input.min='1';f.input.max='120';f.input.step='1';}detailGrid.append(f.wrap);}
  for(const [key,options] of [['gender',['female','male','other','prefer_not']],['motivation',['learn','career','network','explore','other']],['previousAttendance',['all','some','no']]]){questions[key]=field(key,{value:a[key],options,required:true});detailGrid.append(questions[key].wrap);}questions.gender.input.autocomplete='sex';
  const accessOther=field('accessibilityOther',{value:a.accessibilityOther,type:'textarea',max:500}),motivationOther=field('motivationOther',{value:a.motivationOther,type:'textarea',max:500});details.append(detailGrid,motivationOther.wrap);
  const access=el('fieldset','f-access'),accessLegend=el('legend'),accessStar=el('span','f-required',' *'),accessGrid=el('div','f-access-grid');accessStar.setAttribute('aria-hidden','true');accessLegend.append(tr('span','accessibility'),accessStar,tr('span','requiredGroup','f-sr-only'));
  access.setAttribute('aria-describedby','f-hint-accessibilityHint');access.append(accessLegend,hint('accessibilityHint'),accessGrid);
  // aria-invalid is always explicit: without it Chromium exposes empty required selects and checkboxes as invalid before any interaction.
  const valid=(control,key)=>{control.setCustomValidity(key?t(key):'');customKeys.set(control,key);if(!key)flag(control,null);};
  // Text saved without "Other" (the first release asked for it freely) stays shown and is sent again, so a later save never erases it; only "Other" makes it required.
  const syncOther=()=>{for(const [f,needed] of [[accessOther,[...access.querySelectorAll('input')].some(input=>input.value==='other'&&input.checked)],[motivationOther,questions.motivation.input.value==='other']]){const shown=needed||Boolean(String(a[f.input.name]??'').trim());f.wrap.hidden=!shown;f.input.disabled=!shown;f.setRequired(needed);if(!needed)clearLocalised(f.input);}};
  const syncAccess=()=>{const inputs=[...access.querySelectorAll('input')];valid(inputs[0],inputs.some(input=>input.checked)?'':'accessibilityRequired');syncOther();};
  for(const key of ['none','mobility','visual','hearing','communication','other']){const c=check(key,'accessibility',key,a.accessibility?.includes(key));c.input.addEventListener('change',()=>{if(c.input.checked)access.querySelectorAll('input').forEach(input=>{if(input!==c.input&&(key==='none'||input.value==='none'))input.checked=false;});syncAccess();});accessGrid.append(c.wrap);}
  questions.motivation.input.addEventListener('change',syncOther);syncLab();syncOther();
  const privacy=check('privacyAccepted','privacyAccepted','yes',a.privacyAccepted),privacyStar=el('span','f-required',' *');privacy.input.required=true;privacyStar.setAttribute('aria-hidden','true');
  // The star must sit outside the translated span (refresh() rewrites its text), so both share one wrapper.
  const privacyText=el('span','f-check-text');privacyText.append(...[...privacy.wrap.children].slice(1),privacyStar);privacy.wrap.append(privacyText);
  consent.append(access,accessOther.wrap,privacy.wrap,link('privacy','privacy.html','f-text-link'));
  // Client-side "choose one" rule: the custom message sits on the first conference checkbox.
  const syncChoices=()=>{const list=[...form.querySelectorAll('input')].filter(input=>CHOICE_NAMES.includes(input.name)),first=list.find(input=>input.name==='activities')||list[0],any=list.some(input=>input.checked&&!input.disabled);for(const input of list)valid(input,'');if(first)valid(first,any?'':'chooseActivity');};
  function onInvalid(event){
   const control=event.target,validity=control.validity;
   if(validity&&!(validity.customError&&!localised.has(control))){const key=validity.valueMissing?(control.name==='privacyAccepted'?'privacyRequired':'requiredField'):control.name==='age'&&(validity.rangeUnderflow||validity.rangeOverflow||validity.stepMismatch||validity.badInput)?'invalidAge':null;if(key){control.setCustomValidity(t(key));localised.set(control,key);}}
   const key=localised.get(control)||customKeys.get(control);flag(control,key?{key}:{text:control.validationMessage});status(message,'reviewErrors');syncSelection();
  }
  const selection=el('p','f-selection'),submit=button('save'),bar=el('div','f-submit-bar');submit.type='submit';bar.append(selection,submit);
  const checkedCount=name=>[...form.querySelectorAll('input')].filter(input=>input.name===name&&input.checked&&!input.disabled).length;
  // The status line above may be off-screen, so the sticky bar says next to Save when answers are flagged, while a save runs and after one fails.
  const syncSelection=()=>{const n=checkedCount('activities'),m=checkedCount('externalActivities'),parts=[],flagged=[...form.querySelectorAll('input,select,textarea')].some(control=>!control.disabled&&control.getAttribute?.('aria-invalid')==='true');if(n)parts.push(countLabel(n,'conferenceOne','conferenceMany'));if(m)parts.push(countLabel(m,'interestOne','interestMany'));if(checkedCount('applyLab'))parts.push(tr('span','labApplied'));const alert=flagged?'answersNeedAttention':saveState==='failed'?'saveFailed':'';selection.className='f-selection'+(alert?' is-error':'');selection.replaceChildren(...(alert?[tr('span',alert)]:saveState==='saving'?[tr('span','saving')]:parts.length?parts:[tr('span','selectionNone')]));externalCount.replaceChildren(...(m?[countLabel(m,'interestOne','interestMany','f-pill is-ok')]:[]));if(!flagged&&message.dataset.fiiuText==='reviewErrors')status(message,'');};
  const syncSteps=()=>[personal,choices,details,consent].forEach((set,i)=>{
   const controls=[...set.querySelectorAll('input,select,textarea')].filter(control=>!control.disabled);
   let done=controls.filter(control=>control.required).every(control=>control.type==='checkbox'?control.checked:Boolean(String(control.value).trim()));
   if(i===1)done=done&&controls.some(control=>CHOICE_NAMES.includes(control.name)&&control.checked);
   if(i===3)done=done&&controls.some(control=>control.name==='accessibility'&&control.checked);
   stepLinks[i].className='f-step'+(done?' is-done':'');if(done)stepLinks[i].setAttribute('aria-describedby',stepDone.id);else stepLinks[i].removeAttribute('aria-describedby');
  });
  // Re-check the choose-one rule only when a choice changes, so nothing is flagged before the person interacts.
  syncForm=choiceChanged=>{if(choiceChanged)syncChoices();syncSelection();syncSteps();revealStep();syncProgramme();};
  // The steps and their fieldsets share one box, so the sticky step bar leaves with the last step instead of riding down to the save bar.
  const stepped=el('div','f-stepped');stepped.append(stepsNav,personal,choices,details,consent);
  feedback.append(message,conflictBox);form.append(tr('p','formIntro','f-muted f-form-intro'),stepped,feedback,bar);panelBody.append(form);
  // The sticky bars' real heights (language, zoom and the chosen items change them) set the room focused controls keep clear of them (fiiu.css).
  if(typeof ResizeObserver==='function'){sizeObserver=new ResizeObserver(()=>{form.style.setProperty('--f-bar-h',bar.offsetHeight+'px');form.style.setProperty('--f-steps-h',stepsNav.offsetHeight+'px');});sizeObserver.observe(bar);sizeObserver.observe(stepsNav);}
  // The step whose fieldset crosses a band near the top of the viewport is the current one, as in the day navigation.
  if('IntersectionObserver' in window){const sets=[personal,choices,details,consent],inView=new Set();stepObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting)inView.add(entry.target);else inView.delete(entry.target);}const current=sets.find(set=>inView.has(set));if(!current)return;stepLinks.forEach((step,i)=>{if(sets[i]===current)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');});revealStep();},{rootMargin:'-30% 0px -60% 0px'});for(const set of sets)stepObserver.observe(set);}
  for(const control of form.querySelectorAll('input,select,textarea'))control.setAttribute('aria-invalid','false');syncForm();
  if(existing)panelBody.append(message,conflictBox);
  // Form-level listeners only: controls keep their single change listener each.
  form.addEventListener('change',event=>{clearLocalised(event?.target);syncForm(CHOICE_NAMES.includes(event?.target?.name));});
  form.addEventListener('input',event=>{clearLocalised(event?.target);syncForm();});
  form.addEventListener('invalid',onInvalid,true);
  form.addEventListener('submit',async event=>{
   // Stale localised messages are dropped first, so a value set without an event (profile → public official) is re-checked natively.
   event.preventDefault();if(busy)return;for(const control of form.querySelectorAll('input,select,textarea'))clearLocalised(control);syncAccess();syncChoices();syncSelection();
   // Spaces alone are no answer (the server rejects them), so such a field is flagged like an empty one.
   for(const control of form.querySelectorAll('input,textarea'))if(control.required&&!control.disabled&&control.type!=='checkbox'&&control.value!==''&&!String(control.value).trim()){control.setCustomValidity(t('requiredField'));localised.set(control,'requiredField');}
   // The browser focuses the first invalid answer; centring it keeps it and its message clear of both sticky bars.
   if(!form.reportValidity()){const first=document.activeElement;if(first?.getAttribute?.('aria-invalid')==='true')first.scrollIntoView?.({block:'center'});return;}const fd=new FormData(form),payload=Object.fromEntries(fd);
   // language: the summary email after a first registration is written in the language the page is shown in.
   Object.assign(payload,{version:currentVersion,registrationId:currentId,expectedUserId,language:window.nodalI18n?.lang||document.documentElement.lang||'',publicOfficial:fd.get('publicOfficial')==='yes',applyLab:fd.get('applyLab')==='yes',privacyAccepted:fd.get('privacyAccepted')==='yes',activities:fd.getAll('activities'),externalActivities:fd.getAll('externalActivities'),accessibility:fd.getAll('accessibility'),age:fd.get('age')?Number(fd.get('age')):null});
   const unlock=lock();status(message,'saving');conflictBox.replaceChildren();saveState='saving';syncSelection();
   try{const result=await api('/api/fiiu/registration',payload,'PUT');me.registration=result.registration;notice=emailNotice(result.confirmationEmail,result.registration.email);renderRegistration();registrationHost.querySelector('.f-saved')?.focus();}
   catch(error){status(message,error);saveState='failed';syncSelection();
    if(error.key==='accountChanged')accountChanged();
    else if(error.status===409)conflictBox.append(button('viewSaved',async()=>{
     if(busy)return;const release=lock();
     try{const latest=await currentRegistration(),saved=latest.registration&&savedSummary(latest.registration,{prefix:'f-itc-'});
      // The hero and programme follow the version kept for the next save; the form (and choiceInputs) stays as drafted.
      const use=button('useLatest',()=>{if(busy)return;currentVersion=latest.registration?.version??0;currentId=latest.registration?.id??null;me.registration=latest.registration;me.attendance=latest.attendance;conflictBox.replaceChildren();status(message,latest.registration?'latestReplace':'latestCreate');saveState='';syncSelection();renderHero();renderProgramme();submit.focus();});
      conflictBox.replaceChildren(...(saved?[saved]:[]),use);(saved||use).focus();
     }catch(err){if(err.key==='accountChanged')accountChanged();else status(message,err);}
     finally{release();}
    },'f-button secondary'));
    if(error.status===401){const signin=link('signin','login.html?next='+encodeURIComponent('/fiiu.html#registration'));signin.target='_blank';signin.rel='noopener';conflictBox.append(describe(signin));}
    // Save sits in the sticky bar, far from this feedback at the end of the form: focus (and with it the view) moves to the recovery action, or to the message itself.
    (conflictBox.querySelector('button,a')||message).focus();
   }finally{unlock();}
  });
 }
 // News and materials page separately, each on its own cursor, so a run of new materials never pushes the news off the first page.
 // Load more stays focusable while it works (aria-disabled plus a busy guard); on the last page focus moves to the first new item, and feedback sits next to the button.
 // A first page that fails (only materials can: the news page carries the festival itself) leaves the rest of the page working and offers Try again in place.
 function feed(kind,empty,firstPage){
  const section=el('section','f-updates'),list=el('div','f-news'),note=el('p','f-status f-load-more-status'),items=[],fits=item=>(item.kind==='news')===(kind==='news');let cursor=null,loaded=false,busy=false;
  section.id=kind;note.setAttribute('role','status');note.setAttribute('aria-live','polite');
  // Both sections have a Load more button, so each one is described by its own section heading.
  const heading=tr('h2',kind);heading.id='f-'+kind+'-heading';
  const more=describe(button('loadMore',()=>next(()=>api('/api/fiiu?kind='+kind+(cursor?'&cursor='+encodeURIComponent(cursor):'')),true),'f-button secondary f-load-more'),heading.id),label=key=>{more.dataset.fiiuText=key;more.textContent=t(key);};more.hidden=true;
  async function next(read,asked){
   if(busy)return;busy=true;more.setAttribute('aria-disabled','true');if(asked)status(note,'loading');
   try{
    const page=await read(),start=items.length;items.push(...page.content.filter(fits));cursor=page.nextCursor;loaded=true;contentCards(list,items,empty);status(note,'');label('loadMore');more.hidden=!cursor;
    const first=list.children[start]?.querySelector('h3');if(asked&&more.hidden&&first){first.tabIndex=-1;first.focus();}
   }catch(err){status(note,loaded?err:Object.assign(Error(t('loadError')),{key:'loadError'}));if(!loaded)label('retry');more.hidden=false;}
   finally{busy=false;more.removeAttribute('aria-disabled');}
  }
  section.append(heading,list,more,note);next(firstPage,false);return section;
 }
 async function load(){
  status(loadStatus,'loading');root.replaceChildren();
  // Three requests start together: the news page (with the event and settings), the materials page and the person's registration.
  const materials=api('/api/fiiu?kind=materials');materials.catch(()=>{});
  try{
   const [publicData,registrationData]=await Promise.all([api('/api/fiiu?kind=news'),api('/api/fiiu/registration').catch(error=>{if(error.status===401)return{registration:null,attendance:[],user:null};throw error;})]);
   festival=publicData;me=registrationData;
   heroHost=el('section','f-hero');programmeHost=el('section','f-programme');programmeHost.id='programme';
   registrationHost=el('section','f-registration');registrationHost.id='registration';panelHeading=tr('h2','registration');panelHeading.tabIndex=-1;panelBody=el('div','f-panel-body');registrationHost.append(panelHeading,panelNotice,panelBody);
   root.append(heroHost);
   if(me.isAdmin)root.append(link('admin','fiiu-admin.html','f-button secondary f-admin-link'));
   const latest=festival.content.find(item=>item.kind==='news');
   if(latest){const banner=el('a','f-latest');banner.href='#news';banner.append(tr('span','latestUpdate','f-latest-label'),source('span',latest.title,'f-latest-title'));root.append(banner);}
   const layout=el('div','f-layout');layout.append(programmeHost,registrationHost);root.append(layout);
   const updates=el('div','f-updates-grid');updates.append(feed('news','noNews',()=>publicData),feed('materials','noMaterials',()=>materials));layout.append(updates);root.append(newTabNote());
   renderRegistration();status(loadStatus,'');
   const hash=location.hash;
   if(hash==='#f-publicOfficial')jumpTo(officialInput);
   else if(['#registration','#news','#materials','#programme'].includes(hash)||/^#day-\d{4}-\d{2}-\d{2}$/.test(hash))document.querySelector(hash)?.scrollIntoView({block:'start'});
  }catch(error){status(loadStatus,error.key==='error'?Object.assign(Error(t('loadError')),{key:'loadError'}):error);root.append(button('retry',load),newTabNote());}
 }
 load();
})();
