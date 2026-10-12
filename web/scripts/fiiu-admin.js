(() => {
 'use strict';
 const {rows:strings,t,el,tr,source,button,link,field,check,api,status,dateNode,rangeNode,limaDate,locale,findActivity,chronological,typeOf,countLabel,hint,describe,newTabNote,revealInRow,minutesOf,hoursOf,hoursText,checkinState,checkinActivities,limaClock,windowNode}=window.Fiiu;
 // The Conversations section's strings live here, since only this page shows them (the chat page keeps its own). {n} is filled in by this script,
 // so a language switch re-renders those counts.
 Object.assign(strings,{
  conversations:['Conversations','Conversaciones','Conversas'],
  conversationsHint:['Post a question on a block. Registered participants answer in a live chat.','Publica una pregunta en un bloque. Las personas inscritas responden en un chat en vivo.','Publique uma pergunta em um bloco. As pessoas inscritas respondem em um chat ao vivo.'],
  newQuestion:['New question','Nueva pregunta','Nova pergunta'],questionBlock:['Block','Bloque','Bloco'],questionTalk:['Talk (optional)','Charla (opcional)','Palestra (opcional)'],questionNoTalk:['The whole block','Todo el bloque','O bloco inteiro'],
  questionText:['Question','Pregunta','Pergunta'],publishNow:['Publish now','Publicar ahora','Publicar agora'],saveHidden:['Save hidden','Guardar oculta','Salvar oculta'],saveQuestion:['Save question','Guardar pregunta','Salvar pergunta'],
  questionStatus:['Status','Estado','Status'],questionOpen:['Open','Abierta','Aberta'],questionClosed:['Closed','Cerrada','Fechada'],questionHidden:['Hidden','Oculta','Oculta'],
  openChat:['Open chat','Abrir chat','Abrir chat'],present:['Present','Proyectar','Projetar'],downloadCsv:['Download CSV','Descargar CSV','Baixar CSV'],editQuestion:['Edit','Editar','Editar'],
  questionMessages:['{n} messages','{n} mensajes','{n} mensagens'],questionMessagesOne:['1 message','1 mensaje','1 mensagem'],
  questionPeople:['{n} people','{n} personas','{n} pessoas'],questionPeopleOne:['1 person','1 persona','1 pessoa'],
  questionLikes:['{n} likes','{n} me gusta','{n} curtidas'],questionLikesOne:['1 like','1 me gusta','1 curtida'],
  noQuestions:['No questions yet.','Aún no hay preguntas.','Ainda não há perguntas.'],questionSaved:['Question saved','Pregunta guardada','Pergunta salva'],
  closeQuestionConfirm:['Close this question? People can still read it but not answer.','¿Cerrar esta pregunta? Las personas podrán leerla, pero ya no responder.','Fechar esta pergunta? As pessoas ainda poderão lê-la, mas não responder.'],
  questionsLoadError:['The questions could not be loaded.','No se pudieron cargar las preguntas.','Não foi possível carregar as perguntas.']
 });
 const root=document.getElementById('fiiuAdminRoot'),message=document.getElementById('fiiuStatus');
 let festival,config,records=[],cursor=null,filling=null,listStale=false,publications=[],contentCursor=null,selectedParticipant=null,shownParticipant=null,detailRequest=0,participantFilter='all',participantQuery='',shownCount=null,updatedAt=null,search=null,searchTimer=null,setAside=null;
 const detailHost=el('section','f-admin-detail'),listHost=el('div','f-admin-list'),participantsHost=el('section','f-admin-participants'),settingsHost=el('section','f-admin-settings'),contentHost=el('section','f-admin-content'),pillHost=el('div','f-pill-host'),editorHost=el('div','f-content-editor'),pubList=el('div','f-pub-list');
 const summaryHost=el('section','f-admin-summary'),summaryBody=el('div','f-summary-body'),summaryMessage=el('p','f-status'),updated=el('span','f-updated'),lastScan=el('span','f-updated'),resultCount=el('p','f-result-count');let summaryBusy=false,summaryRerun=false;
 const checkinHost=el('section','f-admin-checkin'),checkinBody=el('div','f-checkin-body');let lastCheckinKey='';
 // Conversations: questions is null until the first read lands; each question's row is built once (questionRows, by id) and updated in place.
 const conversationsHost=el('section','f-admin-conversations'),questionEditorHost=el('div','f-question-editor'),questionList=el('div','f-question-list'),questionAlert=el('div','f-question-alert'),questionRows=new Map();
 let questions=null,questionsFailed=false,questionsBusy=false,questionLayout='',newQuestion=null;
 // Access: a 403 locks the page (participant data leaves the DOM and polling stops); a 401 keeps every draft, shows a sign-in link and pauses timed refreshes until a request succeeds again.
 let locked=false,sessionLost=false,timer=null,sectionObserver=null;
 // Leaving the page (a nav link, a reload) with an unsaved publication asks first: an edit with changes, or a new one with any text, open or set aside.
 // The same goes for a new question with text and a question edit with changes.
 const hasText=draft=>Boolean(draft&&(draft.title||draft.body||draft.url));
 window.addEventListener?.('beforeunload',event=>{if(locked)return;const editor=currentEditor();if(hasText(setAside)||(editor?.isNew?hasText(editor.draft()):editor?.dirty())||questionDraft()){event.preventDefault();event.returnValue='';}});
 const signInUrl=()=>'/login.html?next='+encodeURIComponent(location.pathname+location.hash),sessionNotice=el('p','f-notice is-warning f-session-notice');sessionNotice.hidden=true;sessionNotice.setAttribute('role','alert');
 const signInLink=()=>{const a=link('adminSignIn',signInUrl(),'f-text-link');a.target='_blank';a.rel='noopener';return describe(a);};
 // Once the dashboard is up, a tap dismisses the toast; "Loading…" and "Saving…" stay until their request ends.
 message.addEventListener('click',event=>{if(event?.target?.closest?.('a')||!root.querySelector('.f-admin-head')||['loading','saving',''].includes(message.dataset.fiiuText))return;status(message,'');});
 for(const node of [summaryMessage,resultCount]){node.setAttribute('role','status');node.setAttribute('aria-live','polite');}
 const summaryRefresh=button('refreshSummary',()=>refreshSummary(),'f-button secondary f-small');
 // Timed refresh can be paused (WCAG 2.2.2); switching it back on catches up at once.
 const autoRefresh=check('autoRefresh','autoRefresh','yes',true);autoRefresh.wrap.className='f-check f-auto-refresh';autoRefresh.input.setAttribute('role','switch');
 autoRefresh.input.addEventListener('change',()=>{if(autoRefresh.input.checked&&festival)return refreshSummary({background:true});});
 const rowButtons=new Map(),rowNodes=new Map(),filterButtons=new Map(),navLinks=new Map(),clearTimers=new WeakMap(),searchKeys=new WeakMap(),editors=new WeakMap();let rowCache=new WeakMap();
 // Locale-formatted numbers are rebuilt on a language switch: the latest summary and the open editor's counter.
 // lastSummaryKey lets a refresh that brings identical totals leave the tables alone, so a screen reader keeps its place.
 let lastSummary=null,lastSummaryKey='',recount=null;
 const SECTIONS=[['overview','navOverview'],['checkin','checkIn'],['participants','participants'],['settings','settings'],['content','content'],['conversations','conversations']];
 // Columns that hold text rather than counts; the action column's heading is read out but not shown.
 const TEXT_COLUMNS=new Set(['venue','checkinClosing']),HIDDEN_HEADINGS=new Set(['openCheckinScreen']);
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
   // Check-in has no opening time, so the count shows before the festival too.
   figure('checkedIn',big(count(summary.attendedPeople)),...(Number.isSafeInteger(summary.qrPeople)&&summary.qrPeople>=0?[note(countLabel(summary.qrPeople,'byQr','byQr'))]:[]));
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
 // Identical totals leave the tables alone; the check-in section still re-checks each block, whose check-in closes with the clock.
 // A refresh asked for while one is in flight (after a write, or a timer tick) runs once more when it lands, so the totals include that write.
 async function refreshSummary({pending,background=false}={}){
  if(locked)return;if(summaryBusy){summaryRerun=true;return;}summaryBusy=true;summaryBody.setAttribute('aria-busy','true');const hadFocus=document.activeElement===summaryRefresh;
  if(!background){summaryRefresh.disabled=true;status(summaryMessage,'loading');}
  try{const result=await(pending||api('/api/admin/fiiu/summary').then(data=>({data}),error=>({error})));if(result.error)throw result.error;const next=result.data.summary,before=lastSummary?.totalRegistrations;if(summaryKey(next)!==lastSummaryKey)renderSummary(next);else renderCheckin(next);status(summaryMessage,'');stampUpdated(new Date());resume();
   // A new total (a walk-in registration, a cancellation) re-reads the participant list once every page is in.
   if(Number.isSafeInteger(before)&&next.totalRegistrations!==before)listStale=true;
   if(listStale&&!cursor&&!filling){listStale=false;if(next.totalRegistrations!==records.length)readParticipants(true);}}
  catch(error){if(!guard(error))status(summaryMessage,error);}
  // Disabling the button drops focus to <body>; hand it back only if the organiser has not moved on meanwhile.
  finally{summaryBusy=false;summaryRefresh.disabled=false;summaryBody.setAttribute('aria-busy','false');if(hadFocus&&(!document.activeElement||document.activeElement===document.body))summaryRefresh.focus();if(summaryRerun){summaryRerun=false;refreshSummary({background:true});}}
 }
 function summaryPanel(){const bar=el('div','f-admin-toolbar');bar.append(tr('h2','summaryTitle'),lastScan,updated,autoRefresh.wrap,summaryRefresh,summaryMessage);summaryHost.id='overview';summaryHost.replaceChildren(bar,summaryBody);return summaryHost;}
 // Check-in: the NODAL blocks by day, each with when its check-in closes, venue, live count and the screen to show at the door (a separate admin page without
 // participant data). The section is rebuilt only when a count, a block's check-in closing or the language changes, so a focused link keeps its place.
 function checkedInCell(n,number){const cell=el('span','f-summary-count'+(n?'':' is-zero'),number.format(n));cell.append(document.createTextNode(' '),tr('span',n===1?'checkedInOne':'checkedInMany','f-cell-unit'));return cell;}
 function renderCheckin(summary=lastSummary){
  if(!festival)return;const stats=new Map((summary?.activities||[]).map(row=>[row.activityId,row])),blocks=checkinActivities(festival.event),states=blocks.map(activity=>checkinState(activity));
  const key=JSON.stringify([blocks.map(a=>stats.get(a.id)?.attendance??null),states,locale()]);if(key===lastCheckinKey)return;lastCheckinKey=key;
  const active=document.activeElement,refocus=active?.id&&checkinBody.contains?.(active)?active.id:'',number=new Intl.NumberFormat(locale());
  const rows=blocks.map((activity,i)=>{
   const label=el('span','f-row-label'),title=source('span',activity.title),open=link('openCheckinScreen','fiiu-qr.html?a='+encodeURIComponent(activity.id),'f-button secondary f-small'),attended=stats.get(activity.id)?.attendance;
   title.id='f-ck-'+activity.id;label.append(title,activity.registration==='application'?tr('span','lab','f-row-meta'):el('span','f-row-meta',activity.time));
   open.id='f-ck-open-'+activity.id;open.target='_blank';open.rel='noopener';describe(open,title.id);
   // The closing line names itself ("Check-in open until 13:30"), so it needs no label when the rows stack on a phone; the count carries its unit there.
   // Only a closed block is marked (fiiu.css): every block still to come is open, and marking each one would only add noise.
   return {date:activity.date,row:[label,activity.venue?source('span',activity.venue,'f-row-venue'):tr('span','venuePending','f-muted'),windowNode(activity,states[i]),Number.isSafeInteger(attended)?checkedInCell(attended,number):el('span','f-summary-count is-zero','–'),open]};
  });
  checkinBody.replaceChildren(summaryTable({labelledBy:'f-h-checkin',cls:'is-checkin'},['block','venue','checkinClosing','attended','openCheckinScreen'],byDate(rows)));
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
  questions=null;newQuestion=null;questionRows.clear();questionLayout='';
  for(const host of [listHost,detailHost,participantsHost,summaryBody,checkinBody,settingsHost,contentHost,editorHost,pubList,resultCount,conversationsHost,questionEditorHost,questionList,questionAlert])host.replaceChildren();
  status(message,'');const box=el('section','f-locked'),actions=el('div','f-actions');actions.append(link('fiiuPage','fiiu.html','f-button'),link('backToConsole','dashboard.html'));box.append(tr('h1','organisersOnly'),tr('p','organisersOnlyHint'),actions);root.replaceChildren(box);
 }
 function guard(error){
  if(locked)return true;if(error?.status===403){lockOut();return true;}
  if(error?.status===401&&!sessionLost){sessionLost=true;sessionPanel();sessionNotice.hidden=false;}
  return false;
 }
 function resume(){if(!sessionLost)return;sessionLost=false;sessionNotice.hidden=true;}
 function sessionPanel(){sessionNotice.replaceChildren(tr('span','adminSignInAgain'),document.createTextNode(' '),signInLink());return sessionNotice;}
 // Feedback: #fiiuStatus is shown as a toast (fiiu.css) so saves are visible wherever the organiser is working.
 function clearLater(node,key,delay=6000){if(typeof setTimeout!=='function')return;clearTimeout(clearTimers.get(node));clearTimers.set(node,setTimeout(()=>{clearTimers.delete(node);if(node.dataset.fiiuText===key)status(node,'');},delay));}
 // An error toast clears after 12 s; an expired session's carries its own sign-in link instead, so the organiser can act from where they are.
 function reportError(feedback,err){status(feedback,err);if(feedback!==message)return;if(err?.status===401)message.append(document.createTextNode(' '),signInLink());else clearLater(message,message.dataset.fiiuText,12000);}
 // "Reload the latest version" re-reads only the record that changed into its form; other unsaved drafts on the page stay.
 async function action(control,fn,{feedback=message,conflict=null,reload=null,done='changesSaved'}={}){
  if(control)control.disabled=true;status(feedback,'saving');conflict?.replaceChildren();
  try{await fn();status(feedback,done);clearLater(feedback,done);resume();}
  catch(err){if(guard(err))return;reportError(feedback,err);if(err.key==='editorConflict'&&conflict&&reload){const latest=button('reloadLatest',()=>fetchInto(latest,reload),'f-button secondary f-small');conflict.replaceChildren(latest);}}
  finally{if(control)control.disabled=false;}
 }
 // Reads say "Loading…" and then clear; they never report "Changes saved.".
 // Disabling the focused control drops focus to <body>; a failed read hands it back.
 async function fetchInto(control,fn){control.disabled=true;status(message,'loading');try{await fn();status(message,'');resume();}catch(err){if(!guard(err))reportError(message,err);}finally{control.disabled=false;if(control.isConnected&&(!document.activeElement||document.activeElement===document.body))control.focus();}}
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
 // Loaded participants are kept in name order (one per id, the later copy winning), each with its normalised search key, so a search only filters.
 function setRecords(list){records=[...new Map(list.map(r=>[r.id,r])).values()].sort(byName);for(const r of records)if(!searchKeys.has(r))searchKeys.set(r,norm(`${r.answers.firstName} ${r.answers.lastName} ${r.email}`));}
 // A saved review, or a detail read that finds a newer version, replaces just that row: every loaded page stays.
 function updateRecord(registration){const old=records.find(r=>r.id===registration.id);if(!old||old.version===registration.version)return;setRecords(records.map(r=>r===old?{...old,...registration}:r));renderList();}
 async function loadMoreParticipants(){const data=await api('/api/admin/fiiu/registrations?cursor='+encodeURIComponent(cursor));setRecords([...records,...data.registrations]);cursor=data.nextCursor;renderList();return data.registrations;}
 // After the first page the rest load in the background, so search and filters cover everyone; fresh re-reads the whole list (a changed total), keeping each row
 // whose version is unchanged. One read at a time, the list re-rendered once at the end; a failed read leaves "Load more" (or the next changed total) to carry on.
 function readParticipants(fresh=false){
  if(filling||locked||!(fresh||cursor))return filling;
  filling=(async()=>{
   const read=[];let next=fresh?null:cursor;
   try{
    do{const data=await api('/api/admin/fiiu/registrations'+(next?'?cursor='+encodeURIComponent(next):''));if(locked)return;next=data.nextCursor;if(fresh)read.push(...data.registrations);else{setRecords([...records,...data.registrations]);cursor=next;}}while(next&&!locked);
    if(fresh){const old=new Map(records.map(r=>[r.id,r]));setRecords(read.map(r=>{const o=old.get(r.id);return o&&o.version>=r.version?o:r;}));cursor=null;}
   }catch(err){if(!guard(err)&&fresh)listStale=true;}
   finally{filling=null;if(!locked)renderListKeepingFocus();}
  })();return filling;
 }
 // A background re-render keeps keyboard focus on the same person's button, or on the same list control.
 function renderListKeepingFocus(){const active=document.activeElement,id=[...rowButtons].find(([,b])=>b===active)?.[0],key=!id&&listHost.contains?.(active)?active.dataset?.fiiuText:'';renderList();const target=id?rowButtons.get(id):key&&[...listHost.querySelectorAll('button')].find(b=>b.dataset.fiiuText===key);if(target&&target!==document.activeElement)target.focus({preventScroll:true});}
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
   // While the other pages load in the background a filtered view says so; "Load more" is left only when that load stopped on an error.
   if(cursor&&(participantFilter!=='all'||participantQuery))listHost.append(tr('p',filling?'loading':'showingLoaded','f-muted'));
   if(!visible.length){listHost.append(tr('p','noMatches','f-muted f-empty'));listHost.append(button('showAll',()=>{participantFilter='all';participantQuery='';if(search)search.input.value='';syncFilterChips();renderList();filterButtons.get('all')?.focus();},'f-button secondary f-small f-show-all'));}
   else{const list=el('ul','f-participant-list');for(const r of visible)list.append(participantRow(r));listHost.append(list);markSelected();}
   if(visible.length!==shownCount){shownCount=visible.length;resultCount.replaceChildren(countLabel(shownCount,'participantShownOne','participantShownMany'));}
  }
  // After the last page, focus lands on the first newly loaded row (in list order), or on the section heading when the filters hide them all.
  if(cursor&&!filling){const more=button('loadMore',()=>fetchInto(more,async()=>{const added=new Set((await loadMoreParticipants()).map(r=>r.id)),heading=participantsHost.querySelector('h2'),next=listHost.querySelector('.f-load-more')||[...rowButtons].find(([id])=>added.has(id))?.[1];if(next)next.focus();else if(heading){heading.tabIndex=-1;heading.focus();}}),'f-button secondary f-load-more');more.setAttribute('aria-describedby','f-h-participants');listHost.append(more);}
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
 // A registration cancelled since the list loaded leaves the list, and the detail if it is shown, with its own message.
 function registrationGone(id,current){
  records=records.filter(r=>r.id!==id);if(shownParticipant===id){shownParticipant=null;detailHost.replaceChildren(tr('p','selectParticipant','f-muted f-detail-empty'));detailHost.removeAttribute('aria-labelledby');}
  renderListKeepingFocus();if(current)search?.input.focus();return Object.assign(Error(t('registrationGone')),{key:'registrationGone'});
 }
 // While another person's detail loads, the one on screen is dimmed and inert, so a tick or a review cannot go to the wrong person.
 async function openParticipant(id,{focus=true}={}){
  const request=++detailRequest,switching=shownParticipant!==null&&shownParticipant!==id;selectedParticipant=id;
  if(switching){detailHost.inert=true;detailHost.setAttribute('aria-busy','true');}
  let data;
  try{data=await api('/api/admin/fiiu/registrations/'+id);}
  catch(err){const current=request===detailRequest,gone=err?.status===404&&registrationGone(id,current);if(current)selectedParticipant=shownParticipant;throw gone||err;}
  finally{if(request===detailRequest){detailHost.inert=false;detailHost.setAttribute('aria-busy','false');}}
  if(request!==detailRequest)return;
  const r=data.registration,a=r.answers,head=el('header','f-detail-head'),who=el('div'),name=el('h3','',`${a.firstName} ${a.lastName}`),answers=el('details','f-answers');
  updateRecord(r);shownParticipant=id;markSelected();name.id='f-detail-name';who.append(name,el('p','f-muted',r.email),emailStatusLine(r));
  head.append(who,button('backToList',()=>(rowButtons.get(id)||search?.input)?.focus(),'f-button secondary f-small f-narrow-only'));
  detailHost.replaceChildren(head);detailHost.tabIndex=-1;detailHost.setAttribute('aria-labelledby',name.id);
  if(a.applyLab)detailHost.append(reviewCard(r,id));
  answers.append(tr('summary','allAnswers'),answerRows(el('dl','f-answers-list'),a,Object.keys(a).filter(key=>!['privacyAccepted','externalActivities'].includes(key))));
  detailHost.append(attendanceFieldset(r,data.attendance,id),answers);
  // Beside the list (wide, tall screens, where it is sticky; fiiu.css) the page stays put; stacked below it or on a short screen, its top goes just under the section nav.
  if(focus){const beside=window.matchMedia?.('(min-width: 1000px) and (min-height: 641px)')?.matches;if(!beside)detailHost.scrollIntoView?.({block:'start'});detailHost.focus({preventScroll:true});}
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
 // Conversations: a question on a block (optionally tied to one of its talks) opens a live chat on fiiu-talk.html for registered participants;
 // organisers moderate there. The new-question form sits beside the questions, which are grouped by block in programme order.
 const QUESTION_STATUSES=[['open','questionOpen'],['closed','questionClosed'],['hidden','questionHidden']],QUESTION_MAX=500;
 const validQuestion=q=>Boolean(q)&&typeof q.id==='string'&&typeof q.activityId==='string'&&Number.isSafeInteger(q.version)&&QUESTION_STATUSES.some(([value])=>value===q.status);
 const countText=(base,n)=>n===1?t(base+'One'):fill(base,{n:nf(n)});
 function questionDraft(){return Boolean(newQuestion?.dirty())||[...questionRows.values()].some(entry=>entry.editor?.dirty());}
 async function readQuestions(){const data=await api('/api/admin/fiiu/questions');if(!Array.isArray(data.questions)||!data.questions.every(validQuestion))throw Object.assign(Error(t('error')),{key:'error'});return data.questions;}
 // A read that started before one of this page's saves can land after it: the newer local version wins, and a question created meanwhile stays.
 function mergeQuestions(list){const known=new Map((questions||[]).map(q=>[q.id,q])),merged=list.map(q=>{const old=known.get(q.id);known.delete(q.id);return old&&old.version>q.version?{...old,stats:q.stats??old.stats}:q;});return [...merged,...known.values()];}
 // A save answers with the question without its totals; the row keeps the ones it had until the next read.
 function upsertQuestion(q){const old=questions?.find(x=>x.id===q.id),next={...old,...q,stats:q.stats??old?.stats??{messages:q.messageCount??0,people:0,likes:0}};questions=old?questions.map(x=>x===old?next:x):[...(questions||[]),next];renderQuestions();}
 // Retry and "Reload the latest version" report a failure where the organiser pressed.
 async function reloadQuestions(){const list=await readQuestions();if(locked)return;questions=mergeQuestions(list);questionsFailed=false;renderQuestions();}
 // On load and with the minute refresh (after the totals, so it never races their sign-in check): a failure keeps the last list and offers Try again
 // instead of failing the dashboard.
 async function refreshQuestions({pending,background=false}={}){
  if(locked||questionsBusy||(background&&sessionLost))return;questionsBusy=true;
  try{const result=await(pending||readQuestions().then(list=>({list}),error=>({error})));if(result.error)throw result.error;if(locked)return;questions=mergeQuestions(result.list);questionsFailed=false;resume();}
  catch(error){if(guard(error))return;questionsFailed=true;}
  finally{questionsBusy=false;}
  renderQuestions();
 }
 function renderQuestions(){
  if(locked||!festival)return;questionAlert.hidden=!questionsFailed;
  if(!questionsFailed)questionAlert.replaceChildren();
  else if(!questionAlert.children.length){const retry=button('retry',()=>fetchInto(retry,async()=>{await reloadQuestions();if(!document.activeElement||document.activeElement===document.body){const heading=conversationsHost.querySelector('h2');if(heading){heading.tabIndex=-1;heading.focus();}}}),'f-button secondary f-small');questionAlert.replaceChildren(tr('span','questionsLoadError'),retry);}
  if(!questions||!questions.length){questionList.replaceChildren(...(questions?[tr('p','noQuestions','f-muted f-empty')]:questionsFailed?[]:[tr('p','loading','f-muted')]));questionLayout='';return;}
  const order=new Map(chronological(festival.event.activities).map((a,i)=>[a.id,i])),rank=q=>order.get(q.activityId)??order.size;
  const sorted=[...questions].sort((a,b)=>rank(a)-rank(b)||a.activityId.localeCompare(b.activityId)||String(a.createdAt).localeCompare(String(b.createdAt)));
  for(const q of sorted){const entry=questionRows.get(q.id)||questionEntry(q.id);entry.record=q;entry.update();}
  // The same questions in the same places are only updated, so a timed refresh never moves focus or an open edit.
  const layout=JSON.stringify(sorted.map(q=>[q.activityId,q.id]));if(layout===questionLayout)return;questionLayout=layout;
  const active=document.activeElement,refocus=active?.id&&questionList.contains?.(active)?active.id:'',groups=[];
  for(const q of sorted){if(groups.at(-1)?.activityId!==q.activityId)groups.push({activityId:q.activityId,rows:[]});groups.at(-1).rows.push(questionRows.get(q.id).row);}
  questionList.replaceChildren(...groups.map(({activityId,rows})=>{
   const group=el('div','f-question-group'),heading=el('h3','f-question-block'),list=el('ul','f-questions'),activity=findActivity(festival.event,activityId);heading.id='f-qb-'+activityId;
   if(activity)heading.append(dateNode(activity.date,'span','short','f-question-day'),source('span',activity.title));else heading.append(el('span','',activityId));
   list.setAttribute('aria-labelledby',heading.id);list.append(...rows);group.append(heading,list);return group;
  }));
  if(refocus)document.getElementById(refocus)?.focus({preventScroll:true});
 }
 // One ruled row per question: its text, talk and totals, the Open / Closed / Hidden switch, then Edit and the links. update() redraws it from entry.record.
 function questionEntry(id){
  const row=el('li','f-question'),view=el('div','f-question-view'),text=source('p','','f-question-text'),meta=el('p','f-question-meta'),controls=el('div','f-question-controls'),group=el('div','f-segmented'),label=tr('span','questionStatus','f-sr-only'),links=el('div','f-question-links'),note=el('p','f-inline-status'),conflict=el('div','f-conflict');
  const entry={row,view,note,conflict,group,record:null,editor:null,busy:false,buttons:new Map()},path=encodeURIComponent(id);
  text.id='f-q-'+id;label.id=text.id+'-status';group.setAttribute('role','group');group.setAttribute('aria-labelledby',label.id);note.setAttribute('role','status');
  for(const [value,key] of QUESTION_STATUSES){const choice=button(key,()=>setQuestionStatus(entry,value),'f-filter');choice.id=text.id+'-'+value;entry.buttons.set(value,choice);group.append(choice);}
  const edit=entry.edit=button('editQuestion',()=>openQuestionEdit(entry),'f-button secondary f-small'),chat=link('openChat','fiiu-talk.html?q='+path,'f-text-link'),present=link('present','fiiu-talk.html?q='+path+'&present=1','f-text-link'),csv=link('downloadCsv','/api/admin/fiiu/questions/'+path+'/export','f-text-link');
  // The chat and the projector open in new tabs, so moderating never leaves a draft behind here; the CSV is a download, so a refused or failed
  // export never replaces the dashboard.
  edit.id=text.id+'-edit';for(const a of [chat,present]){a.target='_blank';a.rel='noopener';}csv.download='';for(const node of [edit,chat,present,csv])describe(node,text.id);
  links.append(edit,chat,present,csv);controls.append(label,group,links);view.append(text,meta);row.append(view,controls,note,conflict);
  entry.update=()=>{
   const q=entry.record,stats=q.stats||{},count=(base,n)=>el('span','f-question-count',countText(base,Number.isSafeInteger(n)&&n>=0?n:0));row.className='f-question is-'+q.status;text.textContent=q.body;
   meta.replaceChildren(...(q.talk?[source('span',q.talk,'f-question-talk')]:[]),count('questionMessages',stats.messages??q.messageCount),count('questionPeople',stats.people),count('questionLikes',stats.likes));
   for(const [value,choice] of entry.buttons)choice.setAttribute('aria-pressed',String(value===q.status));
  };
  questionRows.set(id,entry);return entry;
 }
 // The switch stays focusable while a change saves (a press meanwhile is ignored), so focus never drops to the page. Closing asks first;
 // a conflict offers the latest version, which re-reads the list.
 async function setQuestionStatus(entry,next){
  const q=entry.record;if(entry.busy||q.status===next)return;
  if(next==='closed'&&!window.confirm(t('closeQuestionConfirm')))return;
  entry.busy=true;entry.group.setAttribute('aria-busy','true');
  const reload=async()=>{await reloadQuestions();entry.conflict.replaceChildren();status(entry.note,'');entry.buttons.get(entry.record.status)?.focus();};
  // An edit of this question that started from the version this change replaces moves to the new one, so saving it is no conflict with itself.
  try{await action(null,async()=>{const result=await api('/api/admin/fiiu/questions/'+encodeURIComponent(q.id),{version:q.version,status:next},'PATCH');if(!validQuestion(result.question))throw Object.assign(Error(t('error')),{key:'error'});if(entry.editor?.version===q.version)entry.editor.version=result.question.version;upsertQuestion(result.question);},{feedback:entry.note,conflict:entry.conflict,reload,done:'questionSaved'});}
  finally{entry.busy=false;entry.group.setAttribute('aria-busy','false');}
 }
 function openQuestionEdit(entry,focus=true){if(entry.editor)closeQuestionEdit(entry,false);entry.editor=questionEditor(entry);entry.view.replaceWith(entry.editor.form);entry.edit.hidden=true;if(focus)entry.editor.form.querySelector('textarea')?.focus();}
 function closeQuestionEdit(entry,focus=true){if(!entry.editor)return;entry.editor.form.replaceWith(entry.view);entry.editor=null;entry.edit.hidden=false;if(focus)entry.edit.focus();}
 // One form for a new question and for an edit of a saved one, whose block cannot change. A new question keeps one id across retries (as a new
 // publication does), so a save whose answer was lost gets the stored question back instead of a duplicate; the id is renewed once it saves.
 function questionEditor(entry=null){
  const start=entry?.record,isNew=!start,prefix=isNew?'f-qn':'f-qe-'+start.id,form=el('form','f-form f-question-form'),counter=el('span','f-counter'),buttons=el('div','f-question-buttons'),conflict=el('div','f-conflict');let busy=false,draftId=null;
  // version is the one an edit started from; a status change made on this page meanwhile moves it along (setQuestionStatus).
  const editor={form,version:start?.version};
  const block=el('select'),talkField=field('questionTalk'),talk=el('select'),text=field('questionText',{type:'textarea',max:QUESTION_MAX,required:true,value:start?.body});
  talk.name='talk';talk.id=prefix+'-talk';talkField.input.replaceWith(talk);text.input.name='body';text.input.id=prefix+'-text';counter.id=prefix+'-counter';text.input.setAttribute('aria-describedby',counter.id);
  // The talk choice lists the block's talks and is hidden for a block without any. An edit keeps a saved talk the programme no longer lists, so saving
  // the text alone never drops it.
  const fillTalks=(activityId,value='',keep=false)=>{
   const names=(findActivity(festival.event,activityId)?.sessions||[]).map(([,name])=>name),none=tr('option','questionNoTalk');none.value='';if(keep&&value&&!names.includes(value))names.push(value);
   talk.replaceChildren(none,...names.map(name=>{const option=source('option',name);option.value=name;return option;}));talk.value=names.includes(value)?value:'';talkField.wrap.hidden=!names.length;
  };
  const count=()=>{const number=new Intl.NumberFormat(locale());counter.textContent=number.format(text.input.value.length)+' / '+number.format(QUESTION_MAX);};text.input.addEventListener('input',count);count();
  if(isNew){
   const blockField=field('questionBlock',{required:true}),blank=tr('option','choose');block.name='activityId';block.id=prefix+'-block';block.required=true;blank.value='';block.append(blank);
   for(const a of chronological(festival.event.activities)){const option=source('option',`${a.date.slice(8)}/${a.date.slice(5,7)} · ${a.title}`);option.value=a.id;block.append(option);}
   blockField.input.replaceWith(block);block.addEventListener('change',()=>fillTalks(block.value,talk.value));form.append(tr('h3','newQuestion'),blockField.wrap);
  }
  fillTalks(start?.activityId||'',start?.talk||'',!isNew);
  const values=()=>({body:text.input.value.trim(),talk:talk.value||null}),initial=JSON.stringify(values());
  const send=async(state,control)=>{
   if(busy)return;text.input.setCustomValidity(values().body?'':t('requiredField'));if(!form.reportValidity())return;
   const payload=isNew?{id:draftId??=uuid(),activityId:block.value,...values(),status:state}:{version:editor.version,...values()},unlock=lockForm(form,()=>isNew?text.input:entry.edit);busy=true;
   // After a conflict on a new question (its id was saved, with other text, by a send whose answer was lost) the list shows the saved one and the
   // draft stays, with a new id for a deliberate second question; an edit reopens on the latest version.
   const reload=isNew?async()=>{await reloadQuestions();draftId=null;conflict.replaceChildren();text.input.focus();}:async()=>{await reloadQuestions();openQuestionEdit(entry);};
   try{await action(control,async()=>{
    const result=await api('/api/admin/fiiu/questions'+(isNew?'':'/'+encodeURIComponent(start.id)),payload,isNew?'POST':'PATCH');if(!validQuestion(result.question))throw Object.assign(Error(t('error')),{key:'error'});
    if(isNew){draftId=null;text.input.value='';count();}else closeQuestionEdit(entry);
    upsertQuestion(result.question);
   },{conflict,reload,done:'questionSaved'});}
   finally{busy=false;unlock();}
  };
  if(isNew){const publish=button('publishNow',()=>send('open',publish),'f-button'),hidden=button('saveHidden',()=>send('hidden',hidden),'f-button secondary');buttons.append(publish,hidden);}
  else{const save=button('saveQuestion',()=>send(null,save),'f-button');buttons.append(save,button('cancelEdit',()=>closeQuestionEdit(entry),'f-button secondary f-small'));}
  form.append(talkField.wrap,text.wrap,counter,buttons,conflict);localiseValidation(form);form.addEventListener('submit',event=>event.preventDefault());
  return Object.assign(editor,{recount:count,dirty:()=>isNew?Boolean(values().body):JSON.stringify(values())!==initial});
 }
 function conversationsPanel(){
  const heading=tr('h2','conversations'),layout=el('div','f-conversations-layout'),side=el('div','f-question-side');heading.id='f-h-conversations';conversationsHost.id='conversations';
  newQuestion=questionEditor();questionEditorHost.replaceChildren(newQuestion.form);questionAlert.setAttribute('role','status');side.append(questionAlert,questionList);layout.append(questionEditorHost,side);
  conversationsHost.replaceChildren(heading,tr('p','conversationsHint','f-muted f-section-hint'),layout);renderQuestions();return conversationsHost;
 }
 // Page head, section navigation and the current-section marker.
 function adminHead(){
  const event=festival.event,head=el('header','f-admin-head'),title=el('div','f-admin-title'),sub=el('p','f-admin-sub'),side=el('div','f-admin-head-side'),actions=el('div','f-actions'),note=tr('p','exportNote','f-muted f-export-note'),csv=button('export',()=>fetchInto(csv,downloadExport),'f-button secondary');
  note.id='f-export-note';describe(csv,note.id);sub.append(el('span','',event.title),rangeNode(event.startsOn,event.endsOn),source('span',event.city));title.append(tr('h1','admin'),sub);
  // The public page opens in a new tab, so checking a post never leaves an unsaved draft behind.
  const view=link('viewPublic','fiiu.html','f-text-link');view.target='_blank';view.rel='noopener';describe(view);
  actions.append(pillHost,view,csv);side.append(actions,note);head.append(title,side);return head;
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
  for(const section of [summaryHost,checkinHost,participantsHost,settingsHost,contentHost,conversationsHost])observer.observe(section);
 }
 async function load(){
  status(message,'loading');const summaryRequest=api('/api/admin/fiiu/summary').then(data=>({data}),error=>({error})),questionsRequest=readQuestions().then(list=>({list}),error=>({error}));try{const [settingsData,posts,participantData]=await Promise.all([api('/api/admin/fiiu/config'),api('/api/admin/fiiu/content'),api('/api/admin/fiiu/registrations')]);festival={event:settingsData.event};config=settingsData.config;publications=posts.content;contentCursor=posts.nextCursor;setRecords(participantData.registrations);cursor=participantData.nextCursor;
   const grid=el('div','f-admin-columns');grid.append(listHost,detailHost);detailHost.replaceChildren(tr('p','selectParticipant','f-muted f-detail-empty'));const heading=tr('h2','participants');heading.id='f-h-participants';participantsHost.id='participants';participantsHost.replaceChildren(heading,filters(),grid);
   root.replaceChildren(adminHead(),sessionNotice,adminNav(),summaryPanel(),checkinPanel(),participantsHost,settings(),contentPanel(),conversationsPanel(),newTabNote());renderRegistrationPill();readParticipants();renderList();status(message,'');refreshSummary({pending:summaryRequest});refreshQuestions({pending:questionsRequest});renderBackfill();loadBackfill();setTitle();observeSections();
   const hash=location.hash;if(SECTIONS.some(([id])=>'#'+id===hash))document.querySelector(hash)?.scrollIntoView({block:'start'});
  }catch(error){
   // Signed out before the dashboard loaded: sign in and come straight back. Signed in without organiser access: the organisers-only state, with no Retry.
   if(error.status===401){status(message,'');location.assign(signInUrl());return;}
   if(guard(error))return;
   status(message,error.key==='error'?Object.assign(Error(t('loadError')),{key:'loadError'}):error);root.replaceChildren(button('retry',load),newTabNote());
  }
 }
 // Rows on screen are translated in place; rows kept for later filters are rebuilt in the new language.
 window.nodalI18n?.onChange(()=>{
  // fiiu-ui retranslates #fiiuStatus through textContent, which drops the expired session's sign-in link.
  if(message.dataset.fiiuText==='unauthorized'&&!message.querySelector('a'))message.append(document.createTextNode(' '),signInLink());
  if(locked)return;rowCache=new WeakMap();setTitle();stampUpdated();recount?.();renderBackfill();newQuestion?.recount();for(const entry of questionRows.values())entry.editor?.recount();renderQuestions();if(lastSummary)renderSummary(lastSummary);else renderCheckin();});
 timer=setInterval(()=>{
  if(!festival||locked||sessionLost||document.visibilityState!=='visible')return;
  // A pass that ended at the cap leaves yesterday's tally and cap message behind; the fresh state replaces them.
  const lifted=capLifted();if(lifted&&backfillResult?.end==='cap')backfillResult=null;
  // The question totals follow the summary totals, so a lost session the summary finds pauses them too.
  return Promise.all([...(lifted?[loadBackfill()]:[]),...(autoRefresh.input.checked?[refreshSummary({background:true}).then(()=>refreshQuestions({background:true}))]:[])]);
 },60000);
 load();
})();
