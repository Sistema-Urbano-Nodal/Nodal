(() => {
 'use strict';
 const {rows:strings,t,el,tr,source,button,link,field,check,api,status,dateNode,rangeNode,limaDate,locale,findActivity,chronological,typeOf,countLabel,hint,describe,newTabNote,revealInRow,minutesOf,hoursOf,hoursText,checkinState,checkinActivities,limaClock,windowNode}=window.Fiiu;
 const root=document.getElementById('fiiuAdminRoot'),message=document.getElementById('fiiuStatus');
 let festival,config,records=[],cursor=null,publications=[],contentCursor=null,selectedParticipant=null,shownParticipant=null,detailRequest=0,participantFilter='all',participantQuery='',shownCount=null,updatedAt=null,search=null,searchTimer=null,setAside=null;
 const detailHost=el('section','f-admin-detail'),listHost=el('div','f-admin-list'),participantsHost=el('section','f-admin-participants'),settingsHost=el('section','f-admin-settings'),contentHost=el('section','f-admin-content'),pillHost=el('div','f-pill-host'),editorHost=el('div','f-content-editor'),pubList=el('div','f-pub-list');
 const summaryHost=el('section','f-admin-summary'),summaryBody=el('div','f-summary-body'),summaryMessage=el('p','f-status'),updated=el('span','f-updated'),lastScan=el('span','f-updated'),resultCount=el('p','f-result-count');let summaryBusy=false,summaryRerun=false;
 const checkinHost=el('section','f-admin-checkin'),checkinBody=el('div','f-checkin-body');let lastCheckinKey='';
 // Access: a 403 locks the page (participant data leaves the DOM and polling stops); a 401 keeps every draft, shows a sign-in link and pauses timed refreshes until a request succeeds again.
 let locked=false,sessionLost=false,timer=null,sectionObserver=null;
 const signInUrl=()=>'/login.html?next='+encodeURIComponent(location.pathname+location.hash),sessionNotice=el('p','f-notice is-warning f-session-notice');sessionNotice.hidden=true;sessionNotice.setAttribute('role','alert');
 for(const node of [summaryMessage,resultCount]){node.setAttribute('role','status');node.setAttribute('aria-live','polite');}
 const summaryRefresh=button('refreshSummary',()=>refreshSummary(),'f-button secondary f-small');
 // Timed refresh can be paused (WCAG 2.2.2); switching it back on catches up at once.
 const autoRefresh=check('autoRefresh','autoRefresh','yes',true);autoRefresh.wrap.className='f-check f-auto-refresh';autoRefresh.input.setAttribute('role','switch');
 autoRefresh.input.addEventListener('change',()=>{if(autoRefresh.input.checked&&festival)return refreshSummary({background:true});});
 const rowButtons=new Map(),rowNodes=new Map(),filterButtons=new Map(),navLinks=new Map(),clearTimers=new WeakMap(),searchKeys=new WeakMap(),editors=new WeakMap();let rowCache=new WeakMap();
 // Locale-formatted numbers are rebuilt on a language switch: the latest summary and the open editor's counter.
 // lastSummaryKey lets a refresh that brings identical totals leave the tables alone, so a screen reader keeps its place.
 let lastSummary=null,lastSummaryKey='',recount=null;
 const SECTIONS=[['overview','navOverview'],['checkin','checkIn'],['participants','participants'],['settings','settings'],['content','content']];
 // Columns that hold text rather than counts; the action column's heading is read out but not shown.
 const TEXT_COLUMNS=new Set(['venue','checkinWindow']),HIDDEN_HEADINGS=new Set(['openCheckinScreen']);
 const KINDS={news:'newsKind',recording:'recording',material:'material'},REVIEW={pending:'reviewPending',accepted:'reviewAccepted',declined:'reviewDeclined'};
 const ADMIN_LABEL={profile:'profileAdmin',publicOfficial:'publicOfficialAdmin',applyLab:'applyLabAdmin',institution:'institutionAdmin',previousAttendance:'previousAttendanceAdmin',accessibilityOther:'accessibilityOtherAdmin',motivationOther:'motivationOtherAdmin'};
 const CHOICE_KEYS=['profile','gender','accessibility','motivation','previousAttendance'];
 const norm=value=>String(value??'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
 const FILTERS={all:()=>true,labPending:r=>r.labStatus==='pending',labAccepted:r=>r.labStatus==='accepted',publicOfficials:r=>r.answers.publicOfficial===true};
 // One collator for every name comparison; the list is sorted when its records change, never per keystroke.
 const collator=new Intl.Collator('es',{sensitivity:'base'}),byName=(a,b)=>collator.compare(a.answers.lastName||'',b.answers.lastName||'')||collator.compare(a.answers.firstName||'',b.answers.firstName||'');
 // crypto.randomUUID needs a secure context; elsewhere the same lowercase v4 form is built from random bytes.
 const uuid=()=>globalThis.crypto?.randomUUID?.()||(bytes=>{bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');})(globalThis.crypto?.getRandomValues?.(new Uint8Array(16))||Uint8Array.from({length:16},()=>Math.random()*256));
 const empty=value=>value===''||value===null||value===undefined||(Array.isArray(value)&&!value.length);
 const setTitle=()=>{document.title='NODAL · '+t('admin');};
 // Summary: two headline figures, the laboratory queue, today's activities during the festival, then day, activity and profile tables.
 // Each day is its own <tbody>, so the day row's scope="rowgroup" covers exactly that day's rows.
 function summaryTable({caption,labelledBy,cls=''},headings,groups){
  const scroll=el('div','f-summary-scroll'),table=el('table','f-summary-table'+(cls?' '+cls:'')),head=el('thead'),heading=el('tr'),name=caption?'f-cap-'+caption:labelledBy,column=i=>!i?'':TEXT_COLUMNS.has(headings[i])?'f-col-text f-col-'+headings[i]:HIDDEN_HEADINGS.has(headings[i])?'f-col-action':'f-num';
  if(caption){const node=tr('caption',caption,'f-table-caption');node.id=name;table.append(node);}else table.setAttribute('aria-labelledby',name);
  scroll.id='f-scroll-'+name;scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-labelledby',name);
  headings.forEach((key,i)=>{const cell=el('th',column(i));cell.scope='col';if(HIDDEN_HEADINGS.has(key))cell.append(tr('span',key,'f-sr-only'));else if(strings[key+'Short']){const short=tr('span',key+'Short','f-th-short');short.setAttribute('aria-hidden','true');cell.append(tr('span',key,'f-th-full'),short);}else cell.append(tr('span',key));heading.append(cell);});head.append(heading);table.append(head);
  for(const {date,rows} of groups){
   const body=el('tbody');
   if(date){const row=el('tr','f-group'),cell=el('th');cell.colSpan=headings.length;cell.scope='rowgroup';cell.append(dateNode(date,'span','short','f-group-date'));row.append(cell);body.append(row);}
   // A row may carry current (today's day row is aria-current="date").
   for(const cells of rows){const [label,...values]=cells,row=el('tr'),cell=el('th');cell.scope='row';cell.append(label);row.append(cell);if(cells.current)row.setAttribute('aria-current',cells.current);values.forEach((value,i)=>{const td=el('td',column(i+1));td.append(value);row.append(td);});body.append(row);}
   table.append(body);
  }
  scroll.append(table);return scroll;
 }
 function byDate(entries){const groups=[];for(const {date,row} of entries){if(!groups.length||groups.at(-1).date!==date)groups.push({date,rows:[]});groups.at(-1).rows.push(row);}return groups;}
 function renderSummary(summary){
  const invalid=()=>Object.assign(new Error(),{key:'error'}),number=new Intl.NumberFormat(locale()),percent=new Intl.NumberFormat(locale(),{style:'percent',maximumFractionDigits:0});
  const count=value=>{if(!Number.isSafeInteger(value)||value<0)throw invalid();return el('span','f-summary-count'+(value?'':' is-zero'),number.format(value));};
  const hours=value=>el('span','f-summary-count'+(value?'':' is-zero'),hoursText(value)),space=()=>document.createTextNode(' ');
  if(!summary||!summary.lab||!Array.isArray(summary.days)||!Array.isArray(summary.activities)||!Array.isArray(summary.profiles))throw invalid();
  // A timed refresh rebuilds these nodes; keep keyboard focus on the equivalent control.
  const active=document.activeElement,refocus=active?.id&&summaryBody.contains?.(active)?active.id:'',event=festival.event,today=limaDate(),total=summary.totalRegistrations;
  // Hours: each confirmed attendance counts its block's scheduled length. The server sends the counts, the catalogue the lengths.
  // attendedPeople, qrPeople, lastCheckInAt and officialAttendance are newer fields: a figure or line whose field is absent is left out.
  let minutes=0,officialMinutes=0,officials=false;const dayMinutes=new Map();
  for(const row of summary.activities){
   const activity=findActivity(event,row.activityId),length=minutesOf(activity);count(row.attendance);minutes+=row.attendance*length;if(activity)dayMinutes.set(activity.date,(dayMinutes.get(activity.date)||0)+row.attendance*length);
   if(row.officialAttendance!==undefined){count(row.officialAttendance);officials=true;officialMinutes+=row.officialAttendance*length;}
  }
  // One ruled strip of figures; the laboratory queue takes two tracks and the track count follows the figures shown, so no track is left empty.
  const figures=el('div','f-figures'),note=(...nodes)=>{const p=el('p','f-figure-note');p.append(...nodes);return p;},big=node=>{node.className+=' f-figure-value';return node;};
  const figure=(key,...nodes)=>{const box=el('div','f-figure');box.append(tr('p',key,'f-figure-label'),...nodes);figures.append(box);return box;};
  figure('totalRegistrations',big(count(total)));
  figure('publicOfficials',big(count(summary.publicOfficials)),...(total?[note(el('span','',percent.format(summary.publicOfficials/total)+' '),tr('span','shareOfRegistrations'))]:[]));
  if(summary.attendedPeople!==undefined){
   const people=big(count(summary.attendedPeople)),before=today<event.startsOn&&!summary.attendedPeople;
   if(before)figure('checkedIn',note(tr('span','checkinOpensOn'),space(),dateNode(event.startsOn,'span','short','f-when-day')));
   else figure('checkedIn',people,...(Number.isSafeInteger(summary.qrPeople)&&summary.qrPeople>=0?[note(countLabel(summary.qrPeople,'byQr','byQr'))]:[]));
  }
  figure('hoursTitle',big(hours(minutes/60)),...(officials?[note(tr('span','officialsHours'),space(),el('span','',hoursText(officialMinutes/60)))]:[]));
  const lab=el('div','f-figure f-lab-card'),bar=el('div','f-lab-bar'),legend=el('ul','f-lab-legend');bar.setAttribute('aria-hidden','true');
  for(const [state,value] of [['pending',summary.lab.pending],['accepted',summary.lab.accepted],['declined',summary.lab.declined]]){const n=count(value),share=el('span','is-'+state),item=el('li','is-'+state);share.style?.setProperty?.('--share',String(value));bar.append(share);item.append(tr('span',REVIEW[state]),n);legend.append(item);}
  // The legend and the review shortcut share one line, so the queue is no taller than the figures beside it.
  const labRow=el('div','f-lab-row');labRow.append(legend);lab.append(tr('h3','labApplications','f-figure-label'),bar,labRow);
  if(summary.lab.pending>0){const review=button('reviewPendingAction',()=>showFilter('labPending'),'f-lab-review');review.id='f-review-pending';labRow.append(review);}
  figures.append(lab);figures.style?.setProperty?.('--f-tracks',String(figures.children.length+1));
  const last=Date.parse(summary.lastCheckInAt);
  if(Number.isFinite(last)){const time=el('time','',limaClock(last));time.dateTime=new Date(last).toISOString();lastScan.replaceChildren(tr('span','lastCheckIn'),space(),...(limaDate(new Date(last))===today?[]:[dateNode(limaDate(new Date(last)),'span','short','f-when-day'),space()]),time);}else lastScan.replaceChildren();
  // Day ledger: one row per festival day, today's marked with aria-current="date" and the word Today.
  const days=summaryTable({labelledBy:'f-sum-byDay',cls:'is-ledger'},['day','peopleWithPlans','attended','hours'],[{rows:summary.days.map(row=>{
   const label=el('span','f-row-day'),current=row.date===today;label.append(dateNode(row.date,'span','short','f-row-date'));if(current)label.append(tr('span','today','f-row-today'));
   return Object.assign([label,count(row.registrations),count(row.attendance),hours((dayMinutes.get(row.date)||0)/60)],current?{current:'date'}:{});
  })}]);
  // Split by type (lab and conferences vs workshops and routes), each in programme order; ids no longer in the catalogue go last.
  const entries=summary.activities.filter(row=>event.activities.some(a=>a.id===row.activityId)||row.registrations||row.externalInterests||row.attendance).map(row=>({row,activity:findActivity(event,row.activityId)}));
  const order=new Map(chronological(entries.filter(e=>e.activity).map(e=>e.activity)).map((a,i)=>[a.id,i])),rank=e=>e.activity?order.get(e.activity.id):order.size,conferences=[],externals=[];
  for(const {row,activity} of [...entries].sort((a,b)=>rank(a)-rank(b))){
   const [registrations,interests,attendance]=[row.registrations,row.externalInterests,row.attendance].map(count),external=Boolean(activity)&&['workshop','route'].includes(typeOf(activity)),label=el('span','f-row-label');
   if(activity){label.append(source('span',activity.title));if(activity.registration==='application')label.append(tr('span','lab','f-row-meta'));else if(activity.time&&!external)label.append(el('span','f-row-meta',activity.time));}else label.append(el('span','',row.activityId));
   const venue=activity?.venue?source('span',activity.venue,'f-row-venue'):activity?tr('span','venuePending','f-muted'):el('span','');
   (external?externals:conferences).push({date:activity?.date,row:external?[label,venue,interests,attendance]:[label,venue,registrations,attendance,hours(row.attendance*minutesOf(activity)/60)]});
  }
  const heading=key=>{const h=tr('h3',key);h.id='f-sum-'+key;return h;},col=(...nodes)=>{const box=el('div','f-summary-col');box.append(...nodes);return box;},people=el('div','f-summary-grid'),activities=el('div','f-summary-stack');
  // Largest profiles first; equal counts keep the server's alphabetical order.
  const profiles=summary.profiles.length?summaryTable({labelledBy:'f-sum-profiles',cls:'is-profiles'},['profileAdmin','participantCount','share'],[{rows:[...summary.profiles].sort((a,b)=>b.count-a.count).map(row=>[tr('span',row.profile||'unspecified'),count(row.count),el('span','f-summary-share',total?percent.format(row.count/total):'–')])}]):tr('p','noParticipants','f-muted');
  people.append(col(heading('byDay'),days,tr('p','byDayHint','f-muted f-table-note')),col(heading('profiles'),profiles));
  activities.append(summaryTable({caption:'conferencesAndLab'},['activity','venue','registered','attended','hours'],byDate(conferences)),summaryTable({caption:'externalActivities'},['activity','venue','interested','attended'],byDate(externals)));
  summaryBody.replaceChildren(figures,people,heading('byActivity'),activities);lastSummary=summary;lastSummaryKey=summaryKey(summary);renderCheckin(summary);
  if(refocus)document.getElementById(refocus)?.focus({preventScroll:true});
 }
 // The date is part of the key because the ledger marks today.
 const summaryKey=summary=>JSON.stringify(summary)+limaDate();
 function stampUpdated(value=updatedAt){if(!value)return;updatedAt=value;const time=el('time','',new Intl.DateTimeFormat(locale(),{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'America/Lima'}).format(value));time.dateTime=value.toISOString();updated.replaceChildren(tr('span','updatedAt'),document.createTextNode(' '),time);}
 // Timed refreshes run in the background: no disabled button and no "Loading…" line, so the layout never jumps; only failures are shown.
 // Identical totals leave the tables alone; the check-in section still re-checks its windows, which open and close with the clock.
 // A refresh asked for while one is in flight (after a write, or a timer tick) runs once more when it lands, so the totals include that write.
 async function refreshSummary({pending,background=false}={}){
  if(locked)return;if(summaryBusy){summaryRerun=true;return;}summaryBusy=true;summaryBody.setAttribute('aria-busy','true');const hadFocus=document.activeElement===summaryRefresh;
  if(!background){summaryRefresh.disabled=true;status(summaryMessage,'loading');}
  try{const result=await(pending||api('/api/admin/fiiu/summary').then(data=>({data}),error=>({error})));if(result.error)throw result.error;const next=result.data.summary;if(summaryKey(next)!==lastSummaryKey)renderSummary(next);else renderCheckin(next);status(summaryMessage,'');stampUpdated(new Date());resume();}
  catch(error){if(!guard(error))status(summaryMessage,error);}
  // Disabling the button drops focus to <body>; hand it back only if the organiser has not moved on meanwhile.
  finally{summaryBusy=false;summaryRefresh.disabled=false;summaryBody.setAttribute('aria-busy','false');if(hadFocus&&(!document.activeElement||document.activeElement===document.body))summaryRefresh.focus();if(summaryRerun){summaryRerun=false;refreshSummary({background:true});}}
 }
 function summaryPanel(){const bar=el('div','f-admin-toolbar');bar.append(tr('h2','summaryTitle'),lastScan,updated,autoRefresh.wrap,summaryRefresh,summaryMessage);summaryHost.id='overview';summaryHost.replaceChildren(bar,summaryBody);return summaryHost;}
 // Check-in: the NODAL blocks by day, each with its window, venue, live count and the screen to show at the door (a separate admin page without participant data).
 // The section is rebuilt only when a count, a window state or the language changes, so a focused link keeps its place.
 function checkedInCell(n,number){const cell=el('span','f-summary-count'+(n?'':' is-zero'),number.format(n));cell.append(document.createTextNode(' '),tr('span',n===1?'checkedInOne':'checkedInMany','f-cell-unit'));return cell;}
 function renderCheckin(summary=lastSummary){
  if(!festival)return;const stats=new Map((summary?.activities||[]).map(row=>[row.activityId,row])),blocks=checkinActivities(festival.event),states=blocks.map(activity=>checkinState(activity));
  const key=JSON.stringify([blocks.map(a=>stats.get(a.id)?.attendance??null),states,locale()]);if(key===lastCheckinKey)return;lastCheckinKey=key;
  const active=document.activeElement,refocus=active?.id&&checkinBody.contains?.(active)?active.id:'',number=new Intl.NumberFormat(locale());
  const rows=blocks.map((activity,i)=>{
   const label=el('span','f-row-label'),title=source('span',activity.title),when=el('span','f-window-cell'),open=link('openCheckinScreen','fiiu-qr.html?a='+encodeURIComponent(activity.id),'f-button secondary f-small'),attended=stats.get(activity.id)?.attendance;
   title.id='f-ck-'+activity.id;label.append(title,activity.registration==='application'?tr('span','lab','f-row-meta'):el('span','f-row-meta',activity.time));
   // The column heading is hidden when the rows stack on a phone (fiiu.css), so the window and the count carry their own label there.
   when.append(tr('span','checkinWindow','f-window-label f-cell-label'),windowNode(activity));if(states[i]!=='upcoming')when.append(tr('span',states[i]==='open'?'checkinOpenNow':'checkinClosedNow','f-window-state is-'+states[i]));
   open.id='f-ck-open-'+activity.id;open.target='_blank';open.rel='noopener';describe(open,title.id);
   return {date:activity.date,row:[label,activity.venue?source('span',activity.venue,'f-row-venue'):tr('span','venuePending','f-muted'),when,Number.isSafeInteger(attended)?checkedInCell(attended,number):el('span','f-summary-count is-zero','–'),open]};
  });
  checkinBody.replaceChildren(summaryTable({labelledBy:'f-h-checkin',cls:'is-checkin'},['block','venue','checkinWindow','attended','openCheckinScreen'],byDate(rows)));
  if(refocus)document.getElementById(refocus)?.focus({preventScroll:true});
 }
 function checkinPanel(){
  const head=el('div','f-admin-toolbar'),heading=tr('h2','checkIn'),all=link('allScreens','fiiu-qr.html','f-text-link');heading.id='f-h-checkin';all.target='_blank';all.rel='noopener';describe(all);
  head.append(heading,all);checkinHost.id='checkin';checkinHost.replaceChildren(head,tr('p','checkInHint','f-muted f-section-hint'),checkinBody);lastCheckinKey='';renderCheckin();return checkinHost;
 }
 // Losing organiser access mid-session (role removed, or another account signed in) clears every participant answer from the page and stops polling.
 function lockOut(){
  locked=true;if(timer!==null)clearInterval(timer);sectionObserver?.disconnect();records=[];publications=[];rowCache=new WeakMap();lastSummary=null;selectedParticipant=shownParticipant=null;
  if(backfillRun){backfillRun.stopping=true;backfillRun.wake?.();}backfill=null;backfillAsk=backfillResult=null;backfillLine.textContent=backfillNote.textContent='';backfillActions.replaceChildren();
  for(const host of [listHost,detailHost,participantsHost,summaryBody,checkinBody,settingsHost,contentHost,editorHost,pubList,resultCount])host.replaceChildren();
  status(message,'');const box=el('section','f-locked'),actions=el('div','f-actions');actions.append(link('fiiuPage','fiiu.html','f-button'),link('backToConsole','dashboard.html'));box.append(tr('h1','organisersOnly'),tr('p','organisersOnlyHint'),actions);root.replaceChildren(box);
 }
 function guard(error){
  if(locked)return true;if(error?.status===403){lockOut();return true;}
  if(error?.status===401&&!sessionLost){sessionLost=true;sessionPanel();sessionNotice.hidden=false;}
  return false;
 }
 function resume(){if(!sessionLost)return;sessionLost=false;sessionNotice.hidden=true;}
 function sessionPanel(){const signin=link('adminSignIn',signInUrl(),'f-text-link');signin.target='_blank';signin.rel='noopener';describe(signin);sessionNotice.replaceChildren(tr('span','adminSignInAgain'),document.createTextNode(' '),signin);return sessionNotice;}
 // Feedback: #fiiuStatus is shown as a toast (fiiu.css) so saves are visible wherever the organiser is working.
 function clearLater(node,key){if(typeof setTimeout!=='function')return;clearTimeout(clearTimers.get(node));clearTimers.set(node,setTimeout(()=>{clearTimers.delete(node);if(node.dataset.fiiuText===key)status(node,'');},6000));}
 // "Reload the latest version" re-reads only the record that changed into its form; other unsaved drafts on the page stay.
 async function action(control,fn,{feedback=message,conflict=null,reload=null,done='changesSaved'}={}){
  if(control)control.disabled=true;status(feedback,'saving');conflict?.replaceChildren();
  try{await fn();status(feedback,done);clearLater(feedback,done);resume();}
  catch(err){if(guard(err))return;status(feedback,err);if(err.key==='editorConflict'&&conflict&&reload){const latest=button('reloadLatest',()=>fetchInto(latest,reload),'f-button secondary f-small');conflict.replaceChildren(latest);}}
  finally{if(control)control.disabled=false;}
 }
 // Reads say "Loading…" and then clear; they never report "Changes saved.".
 // Disabling the focused control drops focus to <body>; a failed read hands it back.
 async function fetchInto(control,fn){control.disabled=true;status(message,'loading');try{await fn();status(message,'');resume();}catch(err){if(!guard(err))status(message,err);}finally{control.disabled=false;if(control.isConnected&&(!document.activeElement||document.activeElement===document.body))control.focus();}}
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
 // Loaded participants are kept in name order, each with its normalised search key, so a search only filters.
 function setRecords(list){records=[...list].sort(byName);for(const r of records)if(!searchKeys.has(r))searchKeys.set(r,norm(`${r.answers.firstName} ${r.answers.lastName} ${r.email}`));}
 // A saved review, or a detail read that finds a newer version, replaces just that row: pages added with "Load more" stay.
 function updateRecord(registration){const old=records.find(r=>r.id===registration.id);if(!old||old.version===registration.version)return;setRecords(records.map(r=>r===old?{...old,...registration}:r));renderList();}
 async function loadMoreParticipants(){const data=await api('/api/admin/fiiu/registrations?cursor='+encodeURIComponent(cursor));setRecords([...records,...data.registrations]);cursor=data.nextCursor;renderList();return data.registrations;}
 async function loadMoreContent(){const page=await api('/api/admin/fiiu/content?cursor='+encodeURIComponent(contentCursor));publications=[...publications,...page.content];contentCursor=page.nextCursor;renderContent();}
 // Participants: client-side search, filters and name order over the pages loaded so far.
 function filters(){
  const box=el('div','f-admin-filters'),chips=el('div','f-filter-chips'),label=tr('span','filterLabel','f-sr-only');search=field('searchParticipants',{type:'search',max:120});
  // Filtering waits for a pause in typing, so a long list is not re-rendered on every keystroke.
  search.input.autocomplete='off';search.input.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{const query=norm(search.input.value.trim());if(query===participantQuery)return;participantQuery=query;renderList();},120);});
  label.id='f-filter-label';chips.setAttribute('role','group');chips.setAttribute('aria-labelledby',label.id);chips.append(label);
  for(const [key,text] of [['all','filterAll'],['labPending','filterLabPending'],['labAccepted','filterLabAccepted'],['publicOfficials','publicOfficials']]){const chip=button(text,()=>{participantFilter=key;syncFilterChips();renderList();},'f-filter');filterButtons.set(key,chip);chips.append(chip);}
  syncFilterChips();box.append(search.wrap,chips,resultCount);return box;
 }
 function syncFilterChips(){for(const [key,chip] of filterButtons)chip.setAttribute('aria-pressed',String(key===participantFilter));}
 function showFilter(key){participantFilter=key;syncFilterChips();renderList();participantsHost.scrollIntoView?.({block:'start'});filterButtons.get(key)?.focus({preventScroll:true});}
 function markSelected(){for(const [id,row] of rowNodes){const on=id===shownParticipant;row.className='f-participant'+(on?' is-selected':'');row.setAttribute('aria-current',String(on));}}
 // Each loaded record's row is built once (again after a language switch); searching and filtering re-attach it.
 function participantRow(r){
  let cached=rowCache.get(r);
  if(!cached){
   const row=el('li','f-participant'),main=el('div','f-participant-main'),name=el('strong','',`${r.answers.firstName} ${r.answers.lastName}`),meta=el('span','f-participant-meta');
   name.id='f-p-'+r.id;main.append(name,el('span','f-muted',r.email));meta.append(tr('span',r.answers.profile||'unspecified'));
   if(r.createdAt&&Number.isFinite(Date.parse(r.createdAt)))meta.append(dateNode(limaDate(new Date(r.createdAt)),'span','short','f-participant-date'));
   row.append(main,meta);if(r.labStatus!=='none')row.append(tr('span',r.labStatus+'Short','f-pill is-'+r.labStatus));
   const open=button('details',()=>fetchInto(open,()=>openParticipant(r.id)),'f-button secondary f-small');open.setAttribute('aria-describedby',name.id);row.append(open);
   rowCache.set(r,cached={row,open});
  }
  rowButtons.set(r.id,cached.open);rowNodes.set(r.id,cached.row);return cached.row;
 }
 function renderList(){
  listHost.replaceChildren();rowButtons.clear();rowNodes.clear();
  if(!records.length){listHost.append(tr('p','noParticipants'));resultCount.replaceChildren();shownCount=null;}
  else{
   const visible=records.filter(FILTERS[participantFilter]).filter(r=>!participantQuery||searchKeys.get(r).includes(participantQuery));
   if(cursor&&(participantFilter!=='all'||participantQuery))listHost.append(tr('p','showingLoaded','f-muted'));
   if(!visible.length){listHost.append(tr('p','noMatches','f-muted f-empty'));listHost.append(button('showAll',()=>{participantFilter='all';participantQuery='';if(search)search.input.value='';syncFilterChips();renderList();filterButtons.get('all')?.focus();},'f-button secondary f-small f-show-all'));}
   else{const list=el('ul','f-participant-list');for(const r of visible)list.append(participantRow(r));listHost.append(list);markSelected();}
   if(visible.length!==shownCount){shownCount=visible.length;resultCount.replaceChildren(countLabel(shownCount,'participantShownOne','participantShownMany'));}
  }
  // After the last page, focus lands on the first newly loaded row (in list order), or on the section heading when the filters hide them all.
  if(cursor){const more=button('loadMore',()=>fetchInto(more,async()=>{const added=new Set((await loadMoreParticipants()).map(r=>r.id)),heading=participantsHost.querySelector('h2'),next=listHost.querySelector('.f-load-more')||[...rowButtons].find(([id])=>added.has(id))?.[1];if(next)next.focus();else if(heading){heading.tabIndex=-1;heading.focus();}}),'f-button secondary f-load-more');more.setAttribute('aria-describedby','f-h-participants');listHost.append(more);}
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
   try{await action(save,async()=>{const result=await api('/api/admin/fiiu/registrations/'+id,payload,'PATCH');Object.assign(r,result.registration);updateRecord(result.registration);refreshSummary({background:true});await refreshSaved(async()=>{if(selectedParticipant===id)await openParticipant(id,{focus:false});});},{conflict,reload:async()=>{await openParticipant(id,{focus:false});if(shownParticipant===id)detailHost.querySelector('.f-review-card')?.querySelector('select')?.focus();}});}
   finally{busy=false;unlock();}
  });
  card.append(head,answerRows(el('dl','f-answers-list'),r.answers,['institution','position','publicOfficial']),review);return card;
 }
 // Each confirmed row says how and when: "QR 09:12" for a self check-in, "Team 09:40" for one ticked here (with the date when it was not the block's own day).
 function methodNote(activity,record){
  if(!record)return [];const at=Date.parse(record.createdAt),day=Number.isFinite(at)?limaDate(new Date(at)):'';
  return [tr('span',record.method==='qr'?'methodQr':'methodTeam'),...(Number.isFinite(at)?[document.createTextNode(' '),...(day!==activity.date?[dateNode(day,'span','short','f-when-day'),document.createTextNode(' ')]:[]),el('span','',limaClock(at))]:[])];
 }
 function attendanceRow(activity,checked,id,chip,{records,saved}={}){
  const row=el('div','f-attendance-row'),label=el('label','f-check'),input=el('input'),text=el('span','f-attendance-title'),note=el('span','f-inline-status'),how=el('span','f-attendance-method');let pending=false;
  input.type='checkbox';input.checked=checked;note.setAttribute('role','status');text.append(source('span',activity.title));if(activity.time)text.append(el('span','f-attendance-time',activity.time));
  how.replaceChildren(...methodNote(activity,records?.get(activity.id)));row.method=()=>how.replaceChildren(...methodNote(activity,records?.get(activity.id)));
  label.append(input,text);row.append(label,how);if(chip)row.append(chip);row.append(note);
  // Autosave keeps the checkbox focusable: a toggle while a save is pending is undone instead of disabling the control.
  input.addEventListener('change',()=>{
   if(pending){input.checked=!input.checked;return;}
   const wanted=input.checked;pending=true;input.setAttribute('aria-disabled','true');
   return action(null,async()=>{let result;try{result=await api('/api/admin/fiiu/registrations/'+id+'/attendance',{activityId:activity.id,attended:wanted},'PUT');}catch(err){input.checked=!wanted;throw err;}saved?.(activity,wanted,result?.attendance);refreshSummary({background:true});},{feedback:note,done:'attendanceSaved'}).finally(()=>{pending=false;input.removeAttribute('aria-disabled');});
  });
  return row;
 }
 function attendanceFieldset(r,attendance,id){
  const a=r.answers,box=el('fieldset','f-attendance'),note=hint('attendanceHint'),attended=new Set(attendance.map(record=>record.activityId)),interests=new Set(a.externalActivities||[]);
  // Under the legend: sessions attended and certificate hours, recomputed from each save's response (or from the change itself when the response has no list).
  const records=new Map(attendance.map(record=>[record.activityId,record])),totals=el('p','f-attendance-total'),rows=[];
  const sum=()=>{const h=hoursOf([...records.values()],festival.event);totals.replaceChildren(countLabel(h.sessions,'attendedOne','attendedMany'),countLabel(h.hours,'certificateHourOne','certificateHourMany'),...(h.untimed.some(activityId=>findActivity(festival.event,activityId)?.registration==='application')?[tr('span','labHoursPending','f-muted')]:[]));};
  const saved=(activity,wanted,list)=>{if(Array.isArray(list)){records.clear();for(const record of list)records.set(record.activityId,record);}else if(wanted)records.set(activity.id,{activityId:activity.id,method:'staff',createdAt:new Date().toISOString()});else records.delete(activity.id);sum();for(const row of rows)row.method();};
  const rowFor=(activity,checked,chip)=>{const row=attendanceRow(activity,checked,id,chip,{records,saved});rows.push(row);return row;};
  sum();box.append(tr('legend','attendance'),totals,note);
  // Saved workshop and route interests appear on their day below, marked as interests; say once what that means.
  if(interests.size){const interest=el('p','f-muted f-interest-note');interest.id='f-hint-interest';interest.append(tr('span','interestChip','f-pill'),tr('span','externalInterestAdminHint'));box.append(interest);box.setAttribute('aria-describedby',note.id+' '+interest.id);}else box.setAttribute('aria-describedby',note.id);
  // Interests whose activity left the catalogue are still listed by id, as on the participant's own page.
  for(const id of [...interests].filter(id=>!findActivity(festival.event,id))){const row=el('p','f-attendance-row f-unknown-interest');row.append(el('span','f-attendance-title',id),tr('span','interestChip','f-pill'));box.append(row);}
  const plan=activity=>activity.registration==='external'?interests.has(activity.id)&&'interest':activity.registration==='application'?r.labStatus==='accepted'&&'lab':a.activities.includes(activity.id)&&'registered';
  const own=activity=>attended.has(activity.id)||Boolean(plan(activity)),chip=activity=>({registered:()=>tr('span','statusRegistered','f-pill is-ok'),lab:()=>tr('span','acceptedShort','f-pill is-accepted'),interest:()=>tr('span','interestChip','f-pill')})[plan(activity)]?.();
  const list=chronological([...festival.event.activities,...(festival.event.legacyActivities||[]).filter(activity=>attended.has(activity.id)||interests.has(activity.id))].filter(activity=>activity.registration==='external'||own(activity)));
  for(const date of [...new Set(list.map(activity=>activity.date))]){
   const day=list.filter(activity=>activity.date===date),others=day.filter(activity=>!own(activity)),group=el('div','f-attendance-day'),dayLabel=dateNode(date,'p','long','f-attendance-date');dayLabel.id='f-att-'+date;group.append(dayLabel);
   for(const activity of day.filter(own))group.append(rowFor(activity,attended.has(activity.id),chip(activity)));
   if(others.length){const more=el('details','f-other');more.append(describe(tr('summary','otherActivities'),dayLabel.id));for(const activity of others)more.append(rowFor(activity,false));group.append(more);}
   box.append(group);
  }
  return box;
 }
 // One plain line under the address: what happened to the summary email sent after the first registration ('pending'
 // is a send that never reported back, so it reads like 'uncertain'), with the Lima date and time once it was sent.
 function emailStatusLine(r){
  const state={sent:'Sent',failed:'Failed',uncertain:'Uncertain',pending:'Uncertain',skipped:'Skipped'}[r.confirmationStatus]||'None',line=el('p','f-muted f-email-status'),at=Date.parse(r.confirmationSentAt??'');
  line.append(tr('span','emailStatus'),document.createTextNode(' '),tr('span','emailStatus'+state));
  if(state==='Sent'&&Number.isFinite(at))line.append(document.createTextNode(' · '),dateNode(limaDate(new Date(at)),'span','short','f-email-day'),document.createTextNode(' '),el('span','',limaClock(at)));
  return line;
 }
 async function openParticipant(id,{focus=true}={}){
  const request=++detailRequest;selectedParticipant=id;
  const data=await api('/api/admin/fiiu/registrations/'+id);if(request!==detailRequest)return;
  const r=data.registration,a=r.answers,head=el('header','f-detail-head'),who=el('div'),name=el('h3','',`${a.firstName} ${a.lastName}`),answers=el('details','f-answers');
  updateRecord(r);shownParticipant=id;markSelected();name.id='f-detail-name';who.append(name,el('p','f-muted',r.email),emailStatusLine(r));
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
  // The public page shows only these two links; each workshop and route carries its own form link.
  for(const key of ['programUrl','partyUrl'])links.append(field(key,{value:config[key],type:'url',max:2000}).wrap);
  const save=button('saveSettings');save.type='submit';form.append(card,links,save,conflict);localiseValidation(form);
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(busy)return;
   if(config.registrationOpen&&!open.input.checked&&!window.confirm(t('closeConfirm'))){open.input.checked=true;open.input.focus();return;}
   // Saved settings the form does not show (the older workshop and route links) go back unchanged.
   const payload={...config,...Object.fromEntries(new FormData(form)),registrationOpen:open.input.checked,version:config.version},unlock=lockForm(form);busy=true;
   try{await action(save,async()=>{const result=await api('/api/admin/fiiu/config',payload,'PUT');config=result.config;renderRegistrationPill();},{conflict,reload:reloadSettings});}
   finally{busy=false;unlock();}
  });
  settingsHost.id='settings';settingsHost.replaceChildren(tr('h2','settings'),form,backfillHost);return settingsHost;
 }
 async function reloadSettings(){config=(await api('/api/admin/fiiu/config')).config;renderRegistrationPill();settings();settingsHost.querySelector('input')?.focus();}
 // Summary emails: people the first-registration email did not reach (registered before it existed, or while sending was off or over its
 // limit) get it from here. One press sends batch after batch (the server sends a few per request and claims each row before its email
 // goes out, so a double click or a second organiser never emails anyone twice) until the pass is done, stopped, or today's cap is reached.
 // Plain lines and one press-plate button; Retry, Cancel and Stop are text buttons. Interpolated text carries no data-fiiu-text, so the
 // language switch re-renders it here instead of overwriting the numbers.
 const backfillHost=el('div','f-backfill'),backfillHeading=tr('h3','backfillTitle'),backfillHint=tr('p','backfillHint','f-muted f-section-hint'),backfillLine=el('p','f-backfill-line'),backfillNote=el('p','f-backfill-note'),backfillActions=el('div','f-backfill-actions');
 backfillHeading.id='f-h-backfill';backfillHost.setAttribute('role','group');backfillHost.setAttribute('aria-labelledby',backfillHeading.id);backfillNote.setAttribute('role','status');backfillNote.setAttribute('aria-live','polite');
 backfillHost.append(backfillHeading,backfillHint,backfillLine,backfillNote,backfillActions);
 // backfill: the last GET (configured, counts, dailyCap, sentToday, resetsAt); backfillAsk: the pass waiting for its confirmation; backfillRun: the pass under way; backfillResult: how the last one ended.
 let backfill=null,backfillLoadFailed=false,backfillAsk=null,backfillRun=null,backfillResult=null;
 const EMAIL_STATES=['none','pending','sent','failed','uncertain','skipped'],TALLY=['sent','failed','uncertain','skipped','claimedElsewhere'];
 const validCounts=counts=>Boolean(counts)&&EMAIL_STATES.every(k=>Number.isSafeInteger(counts[k])&&counts[k]>=0);
 const validBatch=data=>TALLY.every(k=>Number.isSafeInteger(data[k])&&data[k]>=0)&&Number.isSafeInteger(data.remaining)&&data.remaining>=0&&(data.next===null||typeof data.next==='string')&&validCounts(data.counts);
 const fill=(key,values={})=>t(key).replace(/\{(\w+)\}/g,(match,name)=>values[name]??match),nf=n=>new Intl.NumberFormat(locale()).format(n);
 const plural=(base,n)=>fill(n===1?base+'One':base+'Many',{n:nf(n)});
 // One button per action, made once and kept: a progress update leaves the focused Stop button in place instead of rebuilding it.
 const backfillButtons=new Map(),backfillHandlers={send:()=>askBackfill('send'),retry:()=>askBackfill('retry'),confirm:()=>runBackfill(backfillAsk),cancel:()=>{const mode=backfillAsk;backfillAsk=null;renderBackfill(mode);},stop:()=>stopBackfill(),reload:()=>loadBackfill('reload')};
 /* Send swaps itself for Confirm, and Confirm for Stop, with focus on the new button, so a second press meant for the
    first one would land on the next: a double click, Enter pressed twice or held down. A press is ignored for
    BACKFILL_SETTLE_MS after the buttons change (longer than an ordinary double click), and a held Enter or Space does
    not repeat; other held keys (Tab, arrows) move on as usual. (A call without an event comes from code.) */
 const BACKFILL_SETTLE_MS=600;let backfillShownAt=0;
 function textButton(text,action,cls='f-backfill-link'){
  let b=backfillButtons.get(action);
  if(!b){
   b=el('button');b.type='button';b.dataset.action=action;
   b.addEventListener('click',event=>{if(event&&Date.now()-backfillShownAt<BACKFILL_SETTLE_MS)return;backfillHandlers[action]();});
   b.addEventListener('keydown',event=>{if(event?.repeat&&['Enter',' '].includes(event.key))event.preventDefault();});
   backfillButtons.set(action,b);
  }
  b.className=cls;b.textContent=text;return b;
 }
 function askBackfill(mode){backfillAsk=mode;backfillResult=null;renderBackfill('confirm');}
 const capReached=()=>Number.isSafeInteger(backfill?.dailyCap)&&Number.isSafeInteger(backfill?.sentToday)&&backfill.sentToday>=backfill.dailyCap;
 // Today's cap has reset (19:00 Lima) since the page last asked: the minute timer asks again, so the buttons come back without a reload.
 const capLifted=()=>capReached()&&!backfillRun&&!backfillAsk&&Date.now()>=Date.parse(backfill.resetsAt);
 const capText=()=>fill('backfillCap',{cap:nf(backfill?.dailyCap??0),time:Number.isFinite(Date.parse(backfill?.resetsAt))?limaClock(Date.parse(backfill.resetsAt)):'19:00'});
 function tallyText({sent,failed,uncertain,skipped}){return [fill('backfillDone',{sent:nf(sent),failed:nf(failed)}),...(uncertain?[plural('backfillUncertain',uncertain)]:[]),...(skipped?[plural('backfillSkipped',skipped)]:[])].join(' · ');}
 function resultText({end,tally}){
  const handled=tally.sent+tally.failed+tally.uncertain+tally.skipped,base=tallyText(tally);
  if(end==='done')return base+(tally.failed?' — '+t('backfillDoneRetry'):'');
  if(end==='stopped')return t('backfillStopped')+' '+base;
  const reason={cap:capText(),session:t('backfillSignIn'),error:t('backfillError')}[end]||'';
  return handled?base+'. '+reason:reason;
 }
 function progressText(run){
  const parts=[fill('backfillProgress',{sent:nf(run.tally.sent),total:nf(Math.max(run.total,run.tally.sent))}),...(run.tally.failed?[fill('backfillFailed',{n:nf(run.tally.failed)})]:[])];
  return parts.join(' · ')+(run.stopping?' — '+t('backfillStopping'):run.waiting?' — '+t('backfillPausing'):'…');
 }
 // focus names the action to focus after this render; otherwise focus that was on a replaced button moves to the first action, or the heading.
 function renderBackfill(focus){
  if(locked)return;
  const counts=backfill?.counts,actions=[];let line,note='',error=false;
  backfillHint.hidden=Boolean(backfill&&!backfill.configured);
  if(!backfill){line=t(backfillLoadFailed?'backfillLoadError':'loading');if(backfillLoadFailed)actions.push(textButton(t('retry'),'reload'));}
  else if(!backfill.configured)line=t('backfillOff');
  else{
   line=[counts.none?plural('backfillWaiting',counts.none):t('backfillNoneWaiting'),plural('backfillSent',counts.sent),...(counts.failed?[fill('backfillFailed',{n:nf(counts.failed)})]:[]),...(counts.uncertain+counts.pending?[plural('backfillUncertain',counts.uncertain+counts.pending)]:[]),...(counts.skipped?[plural('backfillSkipped',counts.skipped)]:[])].join(' · ');
   if(backfillRun){note=progressText(backfillRun);actions.push(textButton(t('backfillStop'),'stop'));}
   else if(backfillAsk){
    const n=backfillAsk==='retry'?counts.failed:counts.none;note=t('backfillConfirmHint');
    actions.push(textButton(plural('backfillConfirm',n),'confirm','f-button'),textButton(t('backfillCancel'),'cancel'));
   }
   else{
    if(backfillResult){note=resultText(backfillResult);error=['session','error'].includes(backfillResult.end);}
    if(capReached()&&(counts.none||counts.failed)){if(backfillResult?.end!=='cap')note=(note?note+' ':'')+capText();}
    else{
     if(counts.none)actions.push(textButton(plural('backfillSend',counts.none),'send','f-button'));
     if(counts.failed)actions.push(textButton(fill('backfillRetry',{n:nf(counts.failed)}),'retry'));
    }
   }
  }
  backfillLine.textContent=line;backfillNote.textContent=note;backfillNote.classList.toggle('is-error',error);
  // The buttons are swapped only when the set changes; focus on one that leaves moves to the first remaining action, or the heading.
  const current=[...backfillActions.children],changed=current.length!==actions.length||current.some((b,i)=>b!==actions[i]);
  const hadFocus=Boolean(focus)||(changed&&Boolean(backfillActions.contains?.(document.activeElement)));
  if(changed){backfillActions.replaceChildren(...actions);backfillShownAt=Date.now();}
  if(hadFocus){const target=actions.find(b=>b.dataset.action===focus)||actions[0];if(target)target.focus();else{backfillHeading.tabIndex=-1;backfillHeading.focus();}}
 }
 async function loadBackfill(focus){
  if(locked)return;
  try{
   const data=await api('/api/admin/fiiu/confirmations');
   if(typeof data.configured!=='boolean'||!validCounts(data.counts))throw Object.assign(Error(t('error')),{key:'error'});
   backfill=data;backfillLoadFailed=false;resume();
  }catch(error){if(guard(error))return;backfillLoadFailed=true;}
  renderBackfill(focus);
 }
 function stopBackfill(){const run=backfillRun;if(!run||run.stopping)return;run.stopping=true;run.wake?.();renderBackfill('stop');}
 // One pass: POST after POST with the previous answer's cursor until nothing is left, Stop, an error or today's cap. A plain 429 (the
 // organiser write budget) pauses half a minute and carries on, at most five times in a row.
 async function runBackfill(mode){
  if(backfillRun||!backfill)return;
  const run=backfillRun={total:mode==='retry'?backfill.counts.failed:backfill.counts.none,tally:Object.fromEntries(TALLY.map(k=>[k,0])),stopping:false,waiting:false,wake:null};
  backfillAsk=null;backfillResult=null;renderBackfill('stop');
  let after=null,pauses=0,finished=false,end='done';
  try{
   while(!run.stopping&&!locked){
    let data;
    try{data=await api('/api/admin/fiiu/confirmations',{retryFailed:mode==='retry',...(after?{after}:{})},'POST');}
    catch(error){
     // Stop pressed while this request was out: a plain 429 sent nothing, so the pass ends now instead of pausing first.
     if(error.status===429&&error.code!=='daily_cap'&&run.stopping)break;
     if(error.status===429&&error.code!=='daily_cap'&&pauses<5&&typeof setTimeout==='function'){pauses++;run.waiting=true;renderBackfill();await new Promise(resolve=>{run.wake=resolve;setTimeout(resolve,30000);});run.waiting=false;run.wake=null;renderBackfill();continue;}
     throw error;
    }
    pauses=0;if(!validBatch(data))throw Object.assign(Error(t('error')),{key:'error'});
    for(const k of TALLY)run.tally[k]+=data[k];
    // What this pass still has to do: its own outcomes so far plus what the server says is left after the cursor.
    run.total=run.tally.sent+run.tally.failed+run.tally.uncertain+run.tally.skipped+data.remaining;
    backfill={...backfill,counts:data.counts,...(Number.isSafeInteger(data.sentToday)?{sentToday:data.sentToday}:{})};resume();
    if(!data.next||!data.remaining){finished=true;break;}
    after=data.next;renderBackfill();
   }
   if(!finished&&run.stopping)end='stopped';
  }catch(error){
   if(guard(error)){backfillRun=null;return;}
   end=error.code==='daily_cap'?'cap':error.code==='email_not_configured'?'off':error.status===401?'session':'error';
   if(end==='off')backfill={...backfill,configured:false};
  }
  backfillRun=null;backfillResult=end==='off'?null:{end,tally:run.tally};renderBackfill();
  // The counts behind the buttons, and the overview, from the server.
  refreshSummary({background:true});await loadBackfill();
 }
 // Content: one editor beside the list. Editing a publication sets an unsaved new-publication draft aside; Cancel, or saving that edit, brings it back.
 const currentEditor=()=>editors.get(editorHost.querySelector('form'));
 function showEditor(form,focus){editorHost.replaceChildren(form);if(focus)form.querySelector('input')?.focus();}
 function newEditor(focus=false){const draft=setAside;setAside=null;showEditor(publicationEditor(draft||{}),focus);}
 function editPublication(record){const current=currentEditor();if(current?.isNew)setAside=current.draft();else if(current?.dirty()&&!window.confirm(t(strings.discardEdit?'discardEdit':'cancelEdit')))return;showEditor(publicationEditor(record),true);}
 function upsertPublication(content){publications=publications.some(p=>p.id===content.id)?publications.map(p=>p.id===content.id?content:p):[content,...publications];renderContent();}
 // A save updates the list in place, keeping every loaded page. The editor that saved gives way to the set-aside draft or a blank form; a draft set aside while it was being saved does not come back.
 function savedPublication(form,content,draftId){if(editorHost.querySelector('form')===form)newEditor();else if(draftId&&setAside?.draftId===draftId)setAside=null;upsertPublication(content);}
 async function reloadPublication(id,form){
  let next=null,latest;do{const page=await api('/api/admin/fiiu/content'+(next?'?cursor='+encodeURIComponent(next):''));latest=page.content.find(p=>p.id===id);next=page.nextCursor;}while(!latest&&next);
  if(!latest)throw Object.assign(Error(t('error')),{key:'error'});
  upsertPublication(latest);if(editorHost.querySelector('form')===form)showEditor(publicationEditor(latest),true);
 }
 // Each editor works on its own copy, so only the editor that saved moves to the new version; any other editor still gets the conflict.
 function publicationEditor(start={}){
  const record={...start},isNew=!record.id,form=el('form','f-form'),head=el('div','f-editor-head'),conflict=el('div','f-conflict'),counter=el('span','f-counter');let busy=false,draftId=start.draftId||null;
  head.append(tr('h3',isNew?'newContent':'editContent'));if(!isNew)head.append(button('cancelEdit',()=>newEditor(true),'f-button secondary f-small'));
  const title=field('title',{value:record.title,max:180,required:true}),body=field('body',{value:record.body,type:'textarea',max:5000}),url=field('url',{value:record.url,type:'url',max:2000});
  const countBody=()=>{const number=new Intl.NumberFormat(locale());counter.textContent=number.format(body.input.value.length)+' / '+number.format(5000);};counter.id='f-body-counter';body.input.setAttribute('aria-describedby',counter.id);body.input.addEventListener('input',countBody);countBody();recount=countBody;
  const kind=field('kind',{value:record.kind==='news'?'newsKind':record.kind||'newsKind',options:['newsKind','recording','material'],required:true});
  const syncUrl=()=>url.setRequired(kind.input.value!=='newsKind');kind.input.addEventListener('change',syncUrl);syncUrl();
  const selectableActivities=[...festival.event.activities,...(festival.event.legacyActivities||[]).filter(activity=>activity.id===record.activityId)];
  const activity=field('activityId'),select=el('select'),blank=tr('option','choose');select.name='activityId';select.id='f-activityId';blank.value='';select.append(blank);
  for(const a of selectableActivities){const option=source('option',`${a.date.slice(8)}/${a.date.slice(5,7)} · ${a.title}`);option.value=a.id;select.append(option);}
  select.value=record.activityId||'';activity.input.replaceWith(select);
  const publish=field('status',{value:record.status||'draft',options:['draft','published','archived'],required:true}),save=button('saveContent');save.type='submit';
  form.append(head,title.wrap,body.wrap,counter,url.wrap,kind.wrap,activity.wrap,publish.wrap,save,conflict);localiseValidation(form);
  const values=()=>({title:title.input.value,body:body.input.value,url:url.input.value,kind:kind.input.value==='newsKind'?'news':kind.input.value,activityId:select.value,status:publish.input.value}),initial=JSON.stringify(values());
  editors.set(form,{isNew,dirty:()=>JSON.stringify(values())!==initial,draft:()=>({...values(),draftId})});
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(busy)return;
   // A new publication keeps one id across retries, so retrying after a lost response gets the saved row back instead of a duplicate.
   const payload={...Object.fromEntries(new FormData(form)),kind:values().kind,version:record.version,...(record.id?{}:{id:draftId??=uuid()})};
   const unlock=lockForm(form,()=>[...contentHost.querySelectorAll('.f-pub')].find(row=>record.id&&row.querySelector('h3')?.id==='f-pub-'+record.id)?.querySelector('button')||editorHost.querySelector('input'));busy=true;
   try{await action(save,async()=>{const result=await api('/api/admin/fiiu/content'+(record.id?'/'+record.id:''),payload,record.id?'PATCH':'POST');Object.assign(record,result.content);savedPublication(form,result.content,draftId);},{conflict,reload:record.id?()=>reloadPublication(record.id,form):null});}
   finally{busy=false;unlock();}
  });return form;
 }
 function publicationRow(record){
  const row=el('article','f-news-item f-pub'),title=source('h3',record.title),meta=el('p','f-pub-meta'),activity=record.activityId&&findActivity(festival.event,record.activityId);
  title.id='f-pub-'+record.id;meta.append(tr('span',record.status,'f-pill is-'+record.status),tr('span',KINDS[record.kind]||'newsKind','f-chip'));
  if(record.updatedAt&&Number.isFinite(Date.parse(record.updatedAt)))meta.append(dateNode(limaDate(new Date(record.updatedAt)),'span','short','f-pub-date'));
  if(activity)meta.append(source('span',activity.title,'f-pub-activity'));
  const edit=button('editContent',()=>editPublication(record),'f-button secondary f-small');edit.setAttribute('aria-describedby',title.id);
  row.append(title,meta,edit);return row;
 }
 // Only the list is rebuilt; the editor stays in place, so a refresh never moves focus out of a draft.
 function renderContent(){
  pubList.replaceChildren(...publications.map(record=>publicationRow(record)));
  if(!publications.length)pubList.append(tr('p','noNews','f-muted f-empty'));
  if(contentCursor){const more=button('loadMore',()=>fetchInto(more,async()=>{await loadMoreContent();(contentHost.querySelector('.f-load-more')||[...contentHost.querySelectorAll('.f-pub')].at(-1)?.querySelector('button'))?.focus();}),'f-button secondary f-load-more');more.setAttribute('aria-describedby','f-h-content');pubList.append(more);}
 }
 function contentPanel(){const heading=tr('h2','content'),layout=el('div','f-content-layout');heading.id='f-h-content';layout.append(editorHost,pubList);contentHost.id='content';contentHost.replaceChildren(heading,layout);setAside=null;newEditor();renderContent();return contentHost;}
 // Page head, section navigation and the current-section marker.
 function adminHead(){
  const event=festival.event,head=el('header','f-admin-head'),title=el('div','f-admin-title'),sub=el('p','f-admin-sub'),side=el('div','f-admin-head-side'),actions=el('div','f-actions'),note=tr('p','exportNote','f-muted f-export-note'),csv=button('export',()=>fetchInto(csv,downloadExport),'f-button secondary');
  note.id='f-export-note';describe(csv,note.id);sub.append(el('span','',event.title),rangeNode(event.startsOn,event.endsOn),source('span',event.city));title.append(tr('h1','admin'),sub);
  actions.append(pillHost,link('viewPublic','fiiu.html','f-text-link'),csv);side.append(actions,note);head.append(title,side);return head;
 }
 // The CSV is fetched rather than linked, so an expired session, a rate limit or an outage is reported here instead of replacing the dashboard.
 // Safari before 16 has no AbortSignal.timeout; there the download runs without the time limit.
 async function downloadExport(){
  const failed=key=>Object.assign(Error(t(key)),{key});let blob,name;
  try{const response=await fetch('/api/admin/fiiu/export',{signal:globalThis.AbortSignal?.timeout?.(60000)});if(!response.ok)throw Object.assign(failed(({401:'unauthorized',403:'forbidden',429:'rate'})[response.status]||'error'),{status:response.status});name=/filename="([^"]+)"/.exec(response.headers.get('Content-Disposition')||'')?.[1];blob=await response.blob();}
  catch(err){throw err?.key?err:failed('error');}
  const href=URL.createObjectURL(blob),a=el('a');a.href=href;a.download=name||'fiiu-registrations.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),60000);
 }
 function adminNav(){
  const nav=el('nav','f-admin-nav'),label=tr('span','sectionNav','f-sr-only'),list=el('ul');label.id='f-admin-nav-label';nav.setAttribute('aria-labelledby',label.id);
  for(const [id,key] of SECTIONS){const item=el('li'),a=link(key,'#'+id,'');if(id==='overview')a.setAttribute('aria-current','true');navLinks.set(id,a);item.append(a);list.append(item);}
  list.addEventListener('focusin',event=>{const a=event?.target?.closest?.('a');if(a)revealInRow(list,a);});nav.append(label,list);return nav;
 }
 // The section crossing a thin band a third of the way down the viewport is the current one.
 function observeSections(){
  if(!('IntersectionObserver' in window))return;const visible=new Set();
  const observer=sectionObserver=new IntersectionObserver(entries=>{
   for(const entry of entries){if(entry.isIntersecting)visible.add(entry.target.id);else visible.delete(entry.target.id);}
   const current=SECTIONS.map(([id])=>id).find(id=>visible.has(id));if(!current)return;
   for(const [id,a] of navLinks){if(id!==current){a.removeAttribute('aria-current');continue;}if(a.getAttribute('aria-current')==='true')continue;a.setAttribute('aria-current','true');const row=a.parentElement?.parentElement;if(row&&!row.contains(document.activeElement))revealInRow(row,a);}
  },{rootMargin:'-35% 0px -64% 0px'});
  for(const section of [summaryHost,checkinHost,participantsHost,settingsHost,contentHost])observer.observe(section);
 }
 async function load(){
  status(message,'loading');const summaryRequest=api('/api/admin/fiiu/summary').then(data=>({data}),error=>({error}));try{const [publicData,settingsData,posts,participantData]=await Promise.all([api('/api/fiiu'),api('/api/admin/fiiu/config'),api('/api/admin/fiiu/content'),api('/api/admin/fiiu/registrations')]);festival=publicData;config=settingsData.config;publications=posts.content;contentCursor=posts.nextCursor;setRecords(participantData.registrations);cursor=participantData.nextCursor;
   const grid=el('div','f-admin-columns');grid.append(listHost,detailHost);detailHost.replaceChildren(tr('p','selectParticipant','f-muted f-detail-empty'));const heading=tr('h2','participants');heading.id='f-h-participants';participantsHost.id='participants';participantsHost.replaceChildren(heading,filters(),grid);
   root.replaceChildren(adminHead(),sessionNotice,adminNav(),summaryPanel(),checkinPanel(),participantsHost,settings(),contentPanel(),newTabNote());renderRegistrationPill();renderList();status(message,'');refreshSummary({pending:summaryRequest});renderBackfill();loadBackfill();setTitle();observeSections();
   const hash=location.hash;if(SECTIONS.some(([id])=>'#'+id===hash))document.querySelector(hash)?.scrollIntoView({block:'start'});
  }catch(error){
   // Signed out before the dashboard loaded: sign in and come straight back. Signed in without organiser access: the organisers-only state, with no Retry.
   if(error.status===401){status(message,'');location.assign(signInUrl());return;}
   if(guard(error))return;
   status(message,error.key==='error'?Object.assign(Error(t('loadError')),{key:'loadError'}):error);root.replaceChildren(button('retry',load),newTabNote());
  }
 }
 // Rows on screen are translated in place; rows kept for later filters are rebuilt in the new language.
 window.nodalI18n?.onChange(()=>{if(locked)return;rowCache=new WeakMap();setTitle();stampUpdated();recount?.();renderBackfill();if(lastSummary)renderSummary(lastSummary);else renderCheckin();});
 timer=setInterval(()=>{
  if(!festival||locked||sessionLost||document.visibilityState!=='visible')return;
  // A pass that ended at the cap leaves yesterday's tally and cap message behind; the fresh state replaces them.
  const lifted=capLifted();if(lifted&&backfillResult?.end==='cap')backfillResult=null;
  return Promise.all([...(lifted?[loadBackfill()]:[]),...(autoRefresh.input.checked?[refreshSummary({background:true})]:[])]);
 },60000);
 load();
})();
