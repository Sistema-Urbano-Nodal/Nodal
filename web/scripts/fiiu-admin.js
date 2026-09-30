(() => {
 'use strict';
 const {rows:strings,t,el,tr,source,button,link,field,check,api,status,dateNode,rangeNode,limaDate,locale,findActivity,chronological,typeOf,countLabel,hint,describe,newTabNote,revealInRow}=window.Fiiu;
 const root=document.getElementById('fiiuAdminRoot'),message=document.getElementById('fiiuStatus');
 let festival,config,records=[],cursor=null,publications=[],contentCursor=null,selectedParticipant=null,shownParticipant=null,detailRequest=0,participantFilter='all',participantQuery='',shownCount=null,updatedAt=null,search=null;
 const detailHost=el('section','f-admin-detail'),listHost=el('div','f-admin-list'),participantsHost=el('section','f-admin-participants'),settingsHost=el('section','f-admin-settings'),contentHost=el('section','f-admin-content'),pillHost=el('div','f-pill-host');
 const summaryHost=el('section','f-admin-summary'),summaryBody=el('div','f-summary-body'),summaryMessage=el('p','f-status'),updated=el('span','f-updated'),resultCount=el('p','f-result-count');let summaryBusy=false;
 for(const node of [summaryMessage,resultCount]){node.setAttribute('role','status');node.setAttribute('aria-live','polite');}
 const summaryRefresh=button('refreshSummary',()=>refreshSummary(),'f-button secondary f-small');
 // Timed refresh can be paused (WCAG 2.2.2); switching it back on catches up at once.
 const autoRefresh=check('autoRefresh','autoRefresh','yes',true);autoRefresh.wrap.className='f-check f-auto-refresh';autoRefresh.input.setAttribute('role','switch');
 autoRefresh.input.addEventListener('change',()=>{if(autoRefresh.input.checked&&festival)return refreshSummary({background:true});});
 const rowButtons=new Map(),rowNodes=new Map(),filterButtons=new Map(),navLinks=new Map(),clearTimers=new WeakMap();
 // Locale-formatted numbers are rebuilt on a language switch: the latest summary and the open editor's counter.
 // lastSummaryKey lets a refresh that brings identical totals leave the tables alone, so a screen reader keeps its place.
 let lastSummary=null,lastSummaryKey='',recount=null;
 const SECTIONS=[['overview','navOverview'],['participants','participants'],['settings','settings'],['content','content']];
 const KINDS={news:'newsKind',recording:'recording',material:'material'},REVIEW={pending:'reviewPending',accepted:'reviewAccepted',declined:'reviewDeclined'};
 const ADMIN_LABEL={profile:'profileAdmin',publicOfficial:'publicOfficialAdmin',applyLab:'applyLabAdmin',institution:'institutionAdmin',previousAttendance:'previousAttendanceAdmin',accessibilityOther:'accessibilityOtherAdmin',motivationOther:'motivationOtherAdmin'};
 const CHOICE_KEYS=['profile','gender','accessibility','motivation','previousAttendance'];
 const norm=value=>String(value??'').toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
 const FILTERS={all:()=>true,labPending:r=>r.labStatus==='pending',labAccepted:r=>r.labStatus==='accepted',publicOfficials:r=>r.answers.publicOfficial===true};
 const byName=(a,b)=>(a.answers.lastName||'').localeCompare(b.answers.lastName||'','es',{sensitivity:'base'})||(a.answers.firstName||'').localeCompare(b.answers.firstName||'','es',{sensitivity:'base'});
 const empty=value=>value===''||value===null||value===undefined||(Array.isArray(value)&&!value.length);
 const setTitle=()=>{document.title='NODAL · '+t('admin');};
 // Summary: two headline figures, the laboratory queue, today's activities during the festival, then day, activity and profile tables.
 // Each day is its own <tbody>, so the day row's scope="rowgroup" covers exactly that day's rows.
 function summaryTable({caption,labelledBy},headings,groups){
  const scroll=el('div','f-summary-scroll'),table=el('table','f-summary-table'),head=el('thead'),heading=el('tr'),name=caption?'f-cap-'+caption:labelledBy;
  if(caption){const node=tr('caption',caption,'f-table-caption');node.id=name;table.append(node);}else table.setAttribute('aria-labelledby',name);
  scroll.id='f-scroll-'+name;scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-labelledby',name);
  headings.forEach((key,i)=>{const cell=el('th',i?'f-num':'');cell.scope='col';if(strings[key+'Short']){const short=tr('span',key+'Short','f-th-short');short.setAttribute('aria-hidden','true');cell.append(tr('span',key,'f-th-full'),short);}else cell.append(tr('span',key));heading.append(cell);});head.append(heading);table.append(head);
  for(const {date,rows} of groups){
   const body=el('tbody');
   if(date){const row=el('tr','f-group'),cell=el('th');cell.colSpan=headings.length;cell.scope='rowgroup';cell.append(dateNode(date,'span','short','f-group-date'));row.append(cell);body.append(row);}
   for(const [label,...values] of rows){const row=el('tr'),cell=el('th');cell.scope='row';cell.append(label);row.append(cell);for(const value of values){const td=el('td','f-num');td.append(value);row.append(td);}body.append(row);}
   table.append(body);
  }
  scroll.append(table);return scroll;
 }
 function byDate(entries){const groups=[];for(const {date,row} of entries){if(!groups.length||groups.at(-1).date!==date)groups.push({date,rows:[]});groups.at(-1).rows.push(row);}return groups;}
 function renderSummary(summary){
  const invalid=()=>Object.assign(new Error(),{key:'error'}),number=new Intl.NumberFormat(locale());
  const count=value=>{if(!Number.isSafeInteger(value)||value<0)throw invalid();return el('span','f-summary-count'+(value?'':' is-zero'),number.format(value));};
  if(!summary||!summary.lab||!Array.isArray(summary.days)||!Array.isArray(summary.activities)||!Array.isArray(summary.profiles))throw invalid();
  // A timed refresh rebuilds these nodes; keep keyboard focus on the equivalent control.
  const active=document.activeElement,refocus=active?.id&&summaryBody.contains?.(active)?active.id:'',event=festival.event;
  const kpi=(key,value)=>{const box=el('div','f-kpi');box.append(tr('p',key),count(value));return box;},attention=el('div','f-attention');
  attention.append(kpi('totalRegistrations',summary.totalRegistrations),kpi('publicOfficials',summary.publicOfficials));
  const lab=el('div','f-lab-card'),bar=el('div','f-lab-bar'),legend=el('ul','f-lab-legend');bar.setAttribute('aria-hidden','true');
  for(const [state,value] of [['pending',summary.lab.pending],['accepted',summary.lab.accepted],['declined',summary.lab.declined]]){const n=count(value),share=el('span','is-'+state),item=el('li','is-'+state);share.style?.setProperty?.('--share',String(value));bar.append(share);item.append(tr('span',REVIEW[state]),n);legend.append(item);}
  lab.append(tr('h3','labApplications'),bar,legend);
  if(summary.lab.pending>0){const review=button('reviewPendingAction',()=>showFilter('labPending'),'f-button secondary f-small');review.id='f-review-pending';lab.append(review);}
  attention.append(lab);
  const stats=new Map(summary.activities.map(row=>[row.activityId,row])),today=limaDate();
  if(today>=event.startsOn&&today<=event.endsOn){
   const box=el('div','f-today'),list=el('ul'),stat=(key,value)=>{const s=el('span','f-today-stat');s.append(tr('span',key),count(value??0));return s;};
   for(const activity of chronological(event.activities.filter(a=>a.date===today))){const row=stats.get(activity.id)||{},item=el('li'),external=activity.registration==='external';item.append(source('span',activity.title,'f-today-title'),stat(external?'interested':'registered',external?row.externalInterests:row.registrations),stat('attended',row.attendance));list.append(item);}
   box.append(tr('h3','todayTitle'),dateNode(today,'p','long','f-today-date'),list);attention.append(box);
  }
  const days=summaryTable({labelledBy:'f-sum-byDay'},['day','peopleWithPlans','attended'],[{rows:summary.days.map(row=>[dateNode(row.date,'span','short','f-row-date'),count(row.registrations),count(row.attendance)])}]);
  // Split by type (lab and conferences vs workshops and routes), each in programme order; ids no longer in the catalogue go last.
  const entries=summary.activities.filter(row=>event.activities.some(a=>a.id===row.activityId)||row.registrations||row.externalInterests||row.attendance).map(row=>({row,activity:findActivity(event,row.activityId)}));
  const order=new Map(chronological(entries.filter(e=>e.activity).map(e=>e.activity)).map((a,i)=>[a.id,i])),rank=e=>e.activity?order.get(e.activity.id):order.size,conferences=[],externals=[];
  for(const {row,activity} of [...entries].sort((a,b)=>rank(a)-rank(b))){
   const [registrations,interests,attendance]=[row.registrations,row.externalInterests,row.attendance].map(count),external=Boolean(activity)&&['workshop','route'].includes(typeOf(activity)),label=el('span','f-row-label');
   if(activity){label.append(source('span',activity.title));if(activity.registration==='application')label.append(tr('span','lab','f-row-meta'));else if(activity.time&&!external)label.append(el('span','f-row-meta',activity.time));}else label.append(el('span','',row.activityId));
   (external?externals:conferences).push({date:activity?.date,row:[label,external?interests:registrations,attendance]});
  }
  const heading=key=>{const h=tr('h3',key);h.id='f-sum-'+key;return h;},col=(...nodes)=>{const box=el('div','f-summary-col');box.append(...nodes);return box;},people=el('div','f-summary-grid'),activities=el('div','f-summary-grid is-activities');
  const profiles=summary.profiles.length?summaryTable({labelledBy:'f-sum-profiles'},['profileAdmin','participantCount'],[{rows:summary.profiles.map(row=>[tr('span',row.profile||'unspecified'),count(row.count)])}]):tr('p','noParticipants','f-muted');
  people.append(col(heading('byDay'),days,tr('p','byDayHint','f-muted f-table-note')),col(heading('profiles'),profiles));
  activities.append(col(summaryTable({caption:'conferencesAndLab'},['activity','registered','attended'],byDate(conferences))),col(summaryTable({caption:'externalActivities'},['activity','interested','attended'],byDate(externals))));
  summaryBody.replaceChildren(attention,people,heading('byActivity'),activities);lastSummary=summary;lastSummaryKey=summaryKey(summary);
  if(refocus)document.getElementById(refocus)?.focus({preventScroll:true});
 }
 // The date is part of the key because "Today at the festival" depends on it.
 const summaryKey=summary=>JSON.stringify(summary)+limaDate();
 function stampUpdated(value=updatedAt){if(!value)return;updatedAt=value;const time=el('time','',new Intl.DateTimeFormat(locale(),{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'America/Lima'}).format(value));time.dateTime=value.toISOString();updated.replaceChildren(tr('span','updatedAt'),document.createTextNode(' '),time);}
 // Timed refreshes run in the background: no disabled button and no "Loading…" line, so the layout never jumps; only failures are shown.
 async function refreshSummary({pending,background=false}={}){
  if(summaryBusy)return;summaryBusy=true;summaryBody.setAttribute('aria-busy','true');const hadFocus=document.activeElement===summaryRefresh;
  if(!background){summaryRefresh.disabled=true;status(summaryMessage,'loading');}
  try{const result=await(pending||api('/api/admin/fiiu/summary').then(data=>({data}),error=>({error})));if(result.error)throw result.error;const next=result.data.summary;if(summaryKey(next)!==lastSummaryKey)renderSummary(next);status(summaryMessage,'');stampUpdated(new Date());}
  catch(error){status(summaryMessage,error);}
  finally{summaryBusy=false;summaryRefresh.disabled=false;summaryBody.setAttribute('aria-busy','false');if(hadFocus)summaryRefresh.focus();}
 }
 function summaryPanel(){const bar=el('div','f-admin-toolbar');bar.append(tr('h2','summaryTitle'),updated,autoRefresh.wrap,summaryRefresh,summaryMessage);summaryHost.id='overview';summaryHost.replaceChildren(bar,summaryBody);return summaryHost;}
 // Feedback: #fiiuStatus is shown as a toast (fiiu.css) so saves are visible wherever the organiser is working.
 function clearLater(node,key){if(typeof setTimeout!=='function')return;clearTimeout(clearTimers.get(node));clearTimers.set(node,setTimeout(()=>{clearTimers.delete(node);if(node.dataset.fiiuText===key)status(node,'');},6000));}
 async function action(control,fn,{feedback=message,conflict=null,done='changesSaved'}={}){
  if(control)control.disabled=true;status(feedback,'saving');conflict?.replaceChildren();
  try{await fn();status(feedback,done);clearLater(feedback,done);}
  catch(err){status(feedback,err);if(err.key==='editorConflict')conflict?.replaceChildren(button('reloadLatest',()=>location.reload(),'f-button secondary f-small'));}
  finally{if(control)control.disabled=false;}
 }
 // Reads say "Loading…" and then clear; they never report "Changes saved.".
 // Disabling the focused control drops focus to <body>; a failed read hands it back.
 async function fetchInto(control,fn){control.disabled=true;status(message,'loading');try{await fn();status(message,'');}catch(err){status(message,err);}finally{control.disabled=false;if(control.isConnected&&(!document.activeElement||document.activeElement===document.body))control.focus();}}
 function lockForm(form,fallback){
  const active=document.activeElement,controls=[...form.querySelectorAll('input,select,textarea,button')].map(control=>[control,control.disabled]);
  for(const [control] of controls)control.disabled=true;form.setAttribute('aria-busy','true');
  // Disabling the focused control drops focus to <body>; return it (or to the re-rendered equivalent) once the form is usable again.
  return()=>{for(const [control,disabled] of controls)control.disabled=disabled;form.setAttribute('aria-busy','false');if(document.activeElement&&document.activeElement!==document.body)return;const target=active?.isConnected?active:fallback?.();if(target&&!target.disabled)target.focus();};
 }
 // Native validation bubbles follow the page language. Any change drops every message, so a field that became optional never stays blocked.
 function localiseValidation(form){
  const reset=()=>{for(const control of form.querySelectorAll('input,select,textarea'))control.setCustomValidity('');};
  form.addEventListener('invalid',event=>{const control=event?.target,validity=control?.validity;if(!validity||validity.customError)return;control.setCustomValidity(t(validity.valueMissing?'requiredField':'adminInvalid'));},true);
  form.addEventListener('input',reset);form.addEventListener('change',reset);
 }
 async function refreshSaved(fn){try{await fn();}catch{throw Object.assign(new Error(),{key:'savedRefreshFailed'});}}
 async function loadContent(more=false,savedForm=null){const page=await api('/api/admin/fiiu/content'+(more&&contentCursor?'?cursor='+encodeURIComponent(contentCursor):''));publications=more?[...publications,...page.content]:page.content;contentCursor=page.nextCursor;
  // A save may finish after the organizer has started editing another post.
  const currentEditor=contentHost.querySelector('.f-content-editor')?.querySelector('form');
  renderContent(more||Boolean(savedForm&&currentEditor!==savedForm));
 }
 async function loadParticipants(more=false){const data=await api('/api/admin/fiiu/registrations'+(more&&cursor?'?cursor='+encodeURIComponent(cursor):''));records=more?[...records,...data.registrations]:data.registrations;cursor=data.nextCursor;renderList();return data.registrations;}
 // Participants: client-side search, filters and name order over the pages loaded so far.
 function filters(){
  const box=el('div','f-admin-filters'),chips=el('div','f-filter-chips'),label=tr('span','filterLabel','f-sr-only');search=field('searchParticipants',{type:'search',max:120});
  search.input.autocomplete='off';search.input.addEventListener('input',()=>{participantQuery=norm(search.input.value.trim());renderList();});
  label.id='f-filter-label';chips.setAttribute('role','group');chips.setAttribute('aria-labelledby',label.id);chips.append(label);
  for(const [key,text] of [['all','filterAll'],['labPending','filterLabPending'],['labAccepted','filterLabAccepted'],['publicOfficials','publicOfficials']]){const chip=button(text,()=>{participantFilter=key;syncFilterChips();renderList();},'f-filter');filterButtons.set(key,chip);chips.append(chip);}
  syncFilterChips();box.append(search.wrap,chips,resultCount);return box;
 }
 function syncFilterChips(){for(const [key,chip] of filterButtons)chip.setAttribute('aria-pressed',String(key===participantFilter));}
 function showFilter(key){participantFilter=key;syncFilterChips();renderList();participantsHost.scrollIntoView?.({block:'start'});filterButtons.get(key)?.focus({preventScroll:true});}
 function markSelected(){for(const [id,row] of rowNodes){const on=id===shownParticipant;row.className='f-participant'+(on?' is-selected':'');row.setAttribute('aria-current',String(on));}}
 function participantRow(r){
  const row=el('li','f-participant'),main=el('div','f-participant-main'),name=el('strong','',`${r.answers.firstName} ${r.answers.lastName}`),meta=el('span','f-participant-meta');
  name.id='f-p-'+r.id;main.append(name,el('span','f-muted',r.email));meta.append(tr('span',r.answers.profile||'unspecified'));
  if(r.createdAt&&Number.isFinite(Date.parse(r.createdAt)))meta.append(dateNode(limaDate(new Date(r.createdAt)),'span','short','f-participant-date'));
  row.append(main,meta);if(r.labStatus!=='none')row.append(tr('span',r.labStatus+'Short','f-pill is-'+r.labStatus));
  const open=button('details',()=>fetchInto(open,()=>openParticipant(r.id)),'f-button secondary f-small');open.setAttribute('aria-describedby',name.id);row.append(open);
  rowButtons.set(r.id,open);rowNodes.set(r.id,row);return row;
 }
 function renderList(){
  listHost.replaceChildren();rowButtons.clear();rowNodes.clear();
  if(!records.length){listHost.append(tr('p','noParticipants'));resultCount.replaceChildren();shownCount=null;}
  else{
   const visible=records.filter(FILTERS[participantFilter]).filter(r=>!participantQuery||norm(`${r.answers.firstName} ${r.answers.lastName} ${r.email}`).includes(participantQuery)).sort(byName);
   if(cursor&&(participantFilter!=='all'||participantQuery))listHost.append(tr('p','showingLoaded','f-muted'));
   if(!visible.length){listHost.append(tr('p','noMatches','f-muted f-empty'));listHost.append(button('showAll',()=>{participantFilter='all';participantQuery='';if(search)search.input.value='';syncFilterChips();renderList();filterButtons.get('all')?.focus();},'f-button secondary f-small f-show-all'));}
   else{const list=el('ul','f-participant-list');for(const r of visible)list.append(participantRow(r));listHost.append(list);markSelected();}
   if(visible.length!==shownCount){shownCount=visible.length;resultCount.replaceChildren(countLabel(shownCount,'participantShownOne','participantShownMany'));}
  }
  // After the last page, focus lands on the first newly loaded row (in list order), or on the section heading when the filters hide them all.
  if(cursor){const more=button('loadMore',()=>fetchInto(more,async()=>{const added=new Set((await loadParticipants(true)).map(r=>r.id)),heading=participantsHost.querySelector('h2'),next=listHost.querySelector('.f-load-more')||[...rowButtons].find(([id])=>added.has(id))?.[1];if(next)next.focus();else if(heading){heading.tabIndex=-1;heading.focus();}}),'f-button secondary f-load-more');more.setAttribute('aria-describedby','f-h-participants');listHost.append(more);}
 }
 // Detail: review first, then attendance by day (the person's own plans and interests first) and every non-empty answer.
 function answerValue(key,value){
  const dd=el('dd');
  if(key==='nationalId'){
   const text=String(value),masked=text.length>4?'•••• '+text.slice(-4):'••••',shown=el('span','f-masked',masked);let visible=false;
   const toggle=button('showId',()=>{visible=!visible;shown.textContent=visible?text:masked;toggle.dataset.fiiuText=visible?'hideId':'showId';toggle.textContent=t(toggle.dataset.fiiuText);},'f-text-link f-reveal');
   toggle.setAttribute('aria-describedby','f-ans-nationalId');dd.append(shown,toggle);return dd;
  }
  for(const v of Array.isArray(value)?value:[value]){const activity=typeof v==='string'&&findActivity(festival.event,v);dd.append(activity?source('span',activity.title):typeof v==='boolean'?tr('span',v?'yes':'no'):CHOICE_KEYS.includes(key)?tr('span',v):el('span','',String(v)));}
  return dd;
 }
 function answerRows(list,answers,keys){for(const key of keys)if(!empty(answers[key])){const dt=tr('dt',ADMIN_LABEL[key]||key);if(key==='nationalId')dt.id='f-ans-nationalId';list.append(dt,answerValue(key,answers[key]));}return list;}
 function reviewCard(r,id){
  const card=el('section','f-review-card'),head=el('div','f-review-head'),review=el('form','f-form'),conflict=el('div','f-conflict');let busy=false;
  head.append(tr('h4','applyLabAdmin'));if(r.labStatus!=='none')head.append(tr('span',r.labStatus+'Short','f-pill is-'+r.labStatus));
  const state=field('review',{value:REVIEW[r.labStatus],options:Object.values(REVIEW),required:true}),save=button('saveReview');save.type='submit';review.append(state.wrap,save,conflict);localiseValidation(review);
  review.addEventListener('submit',async event=>{
   event.preventDefault();if(busy)return;
   const payload={version:r.version,labStatus:{reviewPending:'pending',reviewAccepted:'accepted',reviewDeclined:'declined'}[state.input.value]},unlock=lockForm(review,()=>shownParticipant===id?detailHost.querySelector('.f-review-card')?.querySelector('button'):null);busy=true;
   try{await action(save,async()=>{const result=await api('/api/admin/fiiu/registrations/'+id,payload,'PATCH');Object.assign(r,result.registration);refreshSummary({background:true});await refreshSaved(async()=>{if(selectedParticipant===id)await openParticipant(id,{focus:false});await loadParticipants();});},{conflict});}
   finally{busy=false;unlock();}
  });
  card.append(head,answerRows(el('dl','f-answers-list'),r.answers,['institution','position','publicOfficial']),review);return card;
 }
 function attendanceRow(activity,checked,id,chip){
  const row=el('div','f-attendance-row'),label=el('label','f-check'),input=el('input'),text=el('span','f-attendance-title'),note=el('span','f-inline-status');let pending=false;
  input.type='checkbox';input.checked=checked;note.setAttribute('role','status');text.append(source('span',activity.title));if(activity.time)text.append(el('span','f-attendance-time',activity.time));
  label.append(input,text);row.append(label);if(chip)row.append(chip);row.append(note);
  // Autosave keeps the checkbox focusable: a toggle while a save is pending is undone instead of disabling the control.
  input.addEventListener('change',()=>{
   if(pending){input.checked=!input.checked;return;}
   const wanted=input.checked;pending=true;input.setAttribute('aria-disabled','true');
   return action(null,async()=>{try{await api('/api/admin/fiiu/registrations/'+id+'/attendance',{activityId:activity.id,attended:wanted},'PUT');}catch(err){input.checked=!wanted;throw err;}refreshSummary({background:true});},{feedback:note,done:'attendanceSaved'}).finally(()=>{pending=false;input.removeAttribute('aria-disabled');});
  });
  return row;
 }
 function attendanceFieldset(r,attendance,id){
  const a=r.answers,box=el('fieldset','f-attendance'),note=hint('attendanceHint'),attended=new Set(attendance.map(record=>record.activityId)),interests=new Set(a.externalActivities||[]);
  box.append(tr('legend','attendance'),note);
  // Saved workshop and route interests appear on their day below, marked as interests; say once what that means.
  if(interests.size){const interest=el('p','f-muted f-interest-note');interest.id='f-hint-interest';interest.append(tr('span','interestChip','f-pill'),tr('span','externalInterestAdminHint'));box.append(interest);box.setAttribute('aria-describedby',note.id+' '+interest.id);}else box.setAttribute('aria-describedby',note.id);
  // Interests whose activity left the catalogue are still listed by id, as on the participant's own page.
  for(const id of [...interests].filter(id=>!findActivity(festival.event,id))){const row=el('p','f-attendance-row f-unknown-interest');row.append(el('span','f-attendance-title',id),tr('span','interestChip','f-pill'));box.append(row);}
  const plan=activity=>activity.registration==='external'?interests.has(activity.id)&&'interest':activity.registration==='application'?r.labStatus==='accepted'&&'lab':a.activities.includes(activity.id)&&'registered';
  const own=activity=>attended.has(activity.id)||Boolean(plan(activity)),chip=activity=>({registered:()=>tr('span','statusRegistered','f-pill is-ok'),lab:()=>tr('span','acceptedShort','f-pill is-accepted'),interest:()=>tr('span','interestChip','f-pill')})[plan(activity)]?.();
  const list=chronological([...festival.event.activities,...(festival.event.legacyActivities||[]).filter(activity=>attended.has(activity.id)||interests.has(activity.id))].filter(activity=>activity.registration==='external'||own(activity)));
  for(const date of [...new Set(list.map(activity=>activity.date))]){
   const day=list.filter(activity=>activity.date===date),others=day.filter(activity=>!own(activity)),group=el('div','f-attendance-day'),dayLabel=dateNode(date,'p','long','f-attendance-date');dayLabel.id='f-att-'+date;group.append(dayLabel);
   for(const activity of day.filter(own))group.append(attendanceRow(activity,attended.has(activity.id),id,chip(activity)));
   if(others.length){const more=el('details','f-other');more.append(describe(tr('summary','otherActivities'),dayLabel.id));for(const activity of others)more.append(attendanceRow(activity,false,id));group.append(more);}
   box.append(group);
  }
  return box;
 }
 async function openParticipant(id,{focus=true}={}){
  const request=++detailRequest;selectedParticipant=id;
  const data=await api('/api/admin/fiiu/registrations/'+id);if(request!==detailRequest)return;
  const r=data.registration,a=r.answers,head=el('header','f-detail-head'),who=el('div'),name=el('h3','',`${a.firstName} ${a.lastName}`),answers=el('details','f-answers');
  shownParticipant=id;markSelected();name.id='f-detail-name';who.append(name,el('p','f-muted',r.email));
  head.append(who,button('backToList',()=>(rowButtons.get(id)||search?.input)?.focus(),'f-button secondary f-small f-narrow-only'));
  detailHost.replaceChildren(head);detailHost.tabIndex=-1;detailHost.setAttribute('aria-labelledby',name.id);
  if(a.applyLab)detailHost.append(reviewCard(r,id));
  answers.append(tr('summary','allAnswers'),answerRows(el('dl','f-answers-list'),a,Object.keys(a).filter(key=>!['privacyAccepted','externalActivities'].includes(key))));
  detailHost.append(attendanceFieldset(r,data.attendance,id),answers);
  // Beside the list (wide screens) the page stays put; stacked below it, move the reader to the detail.
  if(focus)detailHost.focus({preventScroll:!window.matchMedia?.('(max-width: 999px)')?.matches});
 }
 function renderRegistrationPill(){const on=config.registrationOpen;pillHost.replaceChildren(link(on?'registrationOpenNow':'registrationClosedNow','#settings','f-pill'+(on?' is-open':'')));}
 function settings(){
  const form=el('form','f-form'),card=el('div','f-switch-card'),links=el('fieldset','f-links'),open=check('registrationOpen','registrationOpen','yes',config.registrationOpen),note=hint('registrationOpenHint'),conflict=el('div','f-conflict');let busy=false;
  open.input.setAttribute('role','switch');open.input.setAttribute('aria-describedby',note.id);card.append(open.wrap,note);links.append(tr('legend','publicLinks'));
  for(const key of ['programUrl','workshopsUrl','routesUrl','partyUrl'])links.append(field(key,{value:config[key],type:'url',max:2000}).wrap);
  const save=button('saveSettings');save.type='submit';form.append(card,links,save,conflict);localiseValidation(form);
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(busy)return;
   if(config.registrationOpen&&!open.input.checked&&!window.confirm(t('closeConfirm'))){open.input.checked=true;open.input.focus();return;}
   const payload={...Object.fromEntries(new FormData(form)),registrationOpen:open.input.checked,version:config.version},unlock=lockForm(form);busy=true;
   try{await action(save,async()=>{const result=await api('/api/admin/fiiu/config',payload,'PUT');config=result.config;renderRegistrationPill();},{conflict});}
   finally{busy=false;unlock();}
  });
  settingsHost.id='settings';settingsHost.replaceChildren(tr('h2','settings'),form);return settingsHost;
 }
 function publicationEditor(record={},onCancel){
  const form=el('form','f-form'),head=el('div','f-editor-head'),conflict=el('div','f-conflict'),counter=el('span','f-counter');let busy=false;
  const setHead=()=>head.replaceChildren(tr('h3',record.id?'editContent':'newContent'),...(record.id&&onCancel?[button('cancelEdit',onCancel,'f-button secondary f-small')]:[]));setHead();
  const title=field('title',{value:record.title,max:180,required:true}),body=field('body',{value:record.body,type:'textarea',max:5000}),url=field('url',{value:record.url,type:'url',max:2000});
  const countBody=()=>{const number=new Intl.NumberFormat(locale());counter.textContent=number.format(body.input.value.length)+' / '+number.format(5000);};counter.id='f-body-counter';body.input.setAttribute('aria-describedby',counter.id);body.input.addEventListener('input',countBody);countBody();recount=countBody;
  const kind=field('kind',{value:record.kind==='news'?'newsKind':record.kind||'newsKind',options:['newsKind','recording','material'],required:true});
  const syncUrl=()=>url.setRequired(kind.input.value!=='newsKind');kind.input.addEventListener('change',syncUrl);syncUrl();
  const selectableActivities=[...festival.event.activities,...(festival.event.legacyActivities||[]).filter(activity=>activity.id===record.activityId)];
  const activity=field('activityId'),select=el('select'),blank=tr('option','choose');select.name='activityId';select.id='f-activityId';blank.value='';select.append(blank);
  for(const a of selectableActivities){const option=source('option',`${a.date.slice(8)}/${a.date.slice(5,7)} · ${a.title}`);option.value=a.id;select.append(option);}
  select.value=record.activityId||'';activity.input.replaceWith(select);
  const save=button('saveContent');save.type='submit';
  form.append(head,title.wrap,body.wrap,counter,url.wrap,kind.wrap,activity.wrap,field('status',{value:record.status||'draft',options:['draft','published','archived'],required:true}).wrap,save,conflict);localiseValidation(form);
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(busy)return;
   const fd=new FormData(form),payload={...Object.fromEntries(fd),kind:kind.input.value==='newsKind'?'news':kind.input.value,version:record.version},created=!record.id;
   const unlock=lockForm(form,()=>[...contentHost.querySelectorAll('.f-pub')].find(row=>record.id&&row.querySelector('h3')?.id==='f-pub-'+record.id)?.querySelector('button')||contentHost.querySelector('.f-content-editor')?.querySelector('input'));busy=true;
   try{await action(save,async()=>{const result=await api('/api/admin/fiiu/content'+(record.id?'/'+record.id:''),payload,record.id?'PATCH':'POST');Object.assign(record,result.content);await refreshSaved(()=>loadContent(false,form));},{conflict});}
   finally{busy=false;unlock();if(created&&record.id)setHead();}
  });return form;
 }
 function publicationRow(record,editor,reset){
  const row=el('article','f-news-item f-pub'),title=source('h3',record.title),meta=el('p','f-pub-meta'),activity=record.activityId&&findActivity(festival.event,record.activityId);
  title.id='f-pub-'+record.id;meta.append(tr('span',record.status,'f-pill is-'+record.status),tr('span',KINDS[record.kind]||'newsKind','f-chip'));
  if(record.updatedAt&&Number.isFinite(Date.parse(record.updatedAt)))meta.append(dateNode(limaDate(new Date(record.updatedAt)),'span','short','f-pub-date'));
  if(activity)meta.append(source('span',activity.title,'f-pub-activity'));
  const edit=button('editContent',()=>{editor.replaceChildren(publicationEditor(record,()=>reset(true)));editor.querySelector('input')?.focus();},'f-button secondary f-small');edit.setAttribute('aria-describedby',title.id);
  row.append(title,meta,edit);return row;
 }
 function renderContent(preserveEditor=false){
  const existing=preserveEditor?contentHost.querySelector('.f-content-editor'):null,editor=existing||el('div','f-content-editor'),layout=el('div','f-content-layout'),list=el('div','f-pub-list');
  const reset=focus=>{editor.replaceChildren(publicationEditor({},()=>reset(true)));if(focus)editor.querySelector('input')?.focus();};
  if(!existing)reset(false);
  for(const record of publications)list.append(publicationRow(record,editor,reset));
  if(!publications.length)list.append(tr('p','noNews','f-muted f-empty'));
  if(contentCursor){const more=button('loadMore',()=>fetchInto(more,async()=>{await loadContent(true);(contentHost.querySelector('.f-load-more')||[...contentHost.querySelectorAll('.f-pub')].at(-1)?.querySelector('button'))?.focus();}),'f-button secondary f-load-more');more.setAttribute('aria-describedby','f-h-content');list.append(more);}
  const heading=tr('h2','content');heading.id='f-h-content';layout.append(editor,list);contentHost.id='content';contentHost.replaceChildren(heading,layout);
 }
 // Page head, section navigation and the current-section marker.
 function adminHead(){
  const event=festival.event,head=el('header','f-admin-head'),title=el('div','f-admin-title'),sub=el('p','f-admin-sub'),side=el('div','f-admin-head-side'),actions=el('div','f-actions'),note=tr('p','exportNote','f-muted f-export-note'),csv=link('export','/api/admin/fiiu/export','f-button secondary');
  note.id='f-export-note';describe(csv,note.id);sub.append(el('span','',event.title),rangeNode(event.startsOn,event.endsOn),source('span',event.city));title.append(tr('h1','admin'),sub);
  actions.append(pillHost,link('viewPublic','fiiu.html','f-text-link'),csv);side.append(actions,note);head.append(title,side);return head;
 }
 function adminNav(){
  const nav=el('nav','f-admin-nav'),label=tr('span','sectionNav','f-sr-only'),list=el('ul');label.id='f-admin-nav-label';nav.setAttribute('aria-labelledby',label.id);
  for(const [id,key] of SECTIONS){const item=el('li'),a=link(key,'#'+id,'');if(id==='overview')a.setAttribute('aria-current','true');navLinks.set(id,a);item.append(a);list.append(item);}
  list.addEventListener('focusin',event=>{const a=event?.target?.closest?.('a');if(a)revealInRow(list,a);});nav.append(label,list);return nav;
 }
 // The section crossing a thin band a third of the way down the viewport is the current one.
 function observeSections(){
  if(!('IntersectionObserver' in window))return;const visible=new Set();
  const observer=new IntersectionObserver(entries=>{
   for(const entry of entries){if(entry.isIntersecting)visible.add(entry.target.id);else visible.delete(entry.target.id);}
   const current=SECTIONS.map(([id])=>id).find(id=>visible.has(id));if(!current)return;
   for(const [id,a] of navLinks){if(id!==current){a.removeAttribute('aria-current');continue;}if(a.getAttribute('aria-current')==='true')continue;a.setAttribute('aria-current','true');const row=a.parentElement?.parentElement;if(row&&!row.contains(document.activeElement))revealInRow(row,a);}
  },{rootMargin:'-35% 0px -64% 0px'});
  for(const section of [summaryHost,participantsHost,settingsHost,contentHost])observer.observe(section);
 }
 async function load(){
  status(message,'loading');const summaryRequest=api('/api/admin/fiiu/summary').then(data=>({data}),error=>({error}));try{const [publicData,settingsData,posts,participantData]=await Promise.all([api('/api/fiiu'),api('/api/admin/fiiu/config'),api('/api/admin/fiiu/content'),api('/api/admin/fiiu/registrations')]);festival=publicData;config=settingsData.config;publications=posts.content;contentCursor=posts.nextCursor;records=participantData.registrations;cursor=participantData.nextCursor;
   const grid=el('div','f-admin-columns');grid.append(listHost,detailHost);detailHost.replaceChildren(tr('p','selectParticipant','f-muted f-detail-empty'));const heading=tr('h2','participants');heading.id='f-h-participants';participantsHost.id='participants';participantsHost.replaceChildren(heading,filters(),grid);
   root.replaceChildren(adminHead(),adminNav(),summaryPanel(),participantsHost,settings(),contentHost,newTabNote());renderRegistrationPill();renderList();renderContent();status(message,'');refreshSummary({pending:summaryRequest});setTitle();observeSections();
   const hash=location.hash;if(SECTIONS.some(([id])=>'#'+id===hash))document.querySelector(hash)?.scrollIntoView({block:'start'});
  }catch(error){status(message,error.key==='error'?Object.assign(Error(t('loadError')),{key:'loadError'}):error);root.replaceChildren(button('retry',load),newTabNote());}
 }
 window.nodalI18n?.onChange(()=>{setTitle();stampUpdated();recount?.();if(lastSummary)renderSummary(lastSummary);});
 setInterval(()=>{if(festival&&autoRefresh.input.checked&&document.visibilityState==='visible')return refreshSummary({background:true});},60000);
 load();
})();
