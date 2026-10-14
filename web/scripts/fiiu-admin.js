(() => {
 'use strict';
 const {rows:strings,t,el,tr,source,button,link,field,check,api,status,dateNode,rangeNode,limaDate,locale,findActivity,chronological,typeOf,countLabel,hint,describe,newTabNote,revealInRow,minutesOf,hoursOf,hoursText,checkinState,checkinActivities,limaClock,windowNode}=window.Fiiu;
 // The Conversations section's strings, and the attendance tick's failures, live here, since only this page shows them (the chat page keeps its own).
 // {n} is filled in by this script, so a language switch re-renders those counts.
 Object.assign(strings,{
  conversations:['Conversations','Conversaciones','Conversas'],
  conversationsHint:['Post a question on a block or to the whole festival, as a conversation or a 1–10 rating. Registered participants answer in a live chat.','Publica una pregunta en un bloque o para todo el festival, como conversación o valoración del 1 al 10. Las personas inscritas responden en un chat en vivo.','Publique uma pergunta em um bloco ou para todo o festival, como conversa ou avaliação de 1 a 10. As pessoas inscritas respondem em um chat ao vivo.'],
  newQuestion:['New question','Nueva pregunta','Nova pergunta'],questionBlock:['Block','Bloque','Bloco'],questionTalk:['Talk (optional)','Charla (opcional)','Palestra (opcional)'],questionNoTalk:['The whole block','Todo el bloque','O bloco inteiro'],
  questionText:['Question','Pregunta','Pergunta'],publishNow:['Publish now','Publicar ahora','Publicar agora'],saveHidden:['Save hidden','Guardar oculta','Salvar oculta'],saveQuestion:['Save question','Guardar pregunta','Salvar pergunta'],
  questionStatus:['Status','Estado','Status'],questionOpen:['Open','Abierta','Aberta'],questionClosed:['Closed','Cerrada','Fechada'],questionHidden:['Hidden','Oculta','Oculta'],
  openChat:['Open chat','Abrir chat','Abrir chat'],present:['Present','Proyectar','Projetar'],downloadCsv:['Download CSV','Descargar CSV','Baixar CSV'],editQuestion:['Edit','Editar','Editar'],
  questionMessages:['{n} messages','{n} mensajes','{n} mensagens'],questionMessagesOne:['1 message','1 mensaje','1 mensagem'],
  questionPeople:['{n} people','{n} personas','{n} pessoas'],questionPeopleOne:['1 person','1 persona','1 pessoa'],
  questionLikes:['{n} likes','{n} me gusta','{n} curtidas'],questionLikesOne:['1 like','1 me gusta','1 curtida'],
  noQuestions:['No questions yet.','Aún no hay preguntas.','Ainda não há perguntas.'],questionSaved:['Question saved','Pregunta guardada','Pergunta salva'],
  closeQuestionConfirm:['Close this question? People can still read it but not answer.','¿Cerrar esta pregunta? Las personas podrán leerla, pero ya no responder.','Fechar esta pergunta? As pessoas ainda poderão lê-la, mas não responder.'],
  hideQuestionConfirm:['Hide this question? It disappears from phones and the projector until you open it again.','¿Ocultar esta pregunta? Dejará de verse en los teléfonos y en la proyección hasta que la vuelvas a abrir.','Ocultar esta pergunta? Ela deixa de aparecer nos celulares e na projeção até você abri-la de novo.'],
  questionsLoadError:['The questions could not be loaded.','No se pudieron cargar las preguntas.','Não foi possível carregar as perguntas.'],
  questionLatest:['Latest saved version:','Versión guardada actual:','Versão salva atual:'],
  // General, the festival-wide space, and the question types. Scores are only ever totals: no one, organisers included, sees who gave which.
  questionGeneral:['General (whole festival)','General (todo el festival)','Geral (todo o festival)'],
  questionKind:['Type','Tipo','Tipo'],questionKindChat:['Conversation','Conversación','Conversa'],questionKindRating:['Rating 1–10','Valoración 1–10','Avaliação 1–10'],
  questionKindHint:['A rating asks people to tap a number from 1 to 10, and they can still comment. Scores are anonymous: everyone, organisers included, sees only the totals.','Una valoración pide tocar un número del 1 al 10, y también se puede comentar. Las valoraciones son anónimas: todos, también la organización, ven solo los totales.','Uma avaliação pede para tocar um número de 1 a 10, e também é possível comentar. As avaliações são anônimas: todos, inclusive a organização, veem apenas os totais.'],
  questionKindLocked:['The type cannot change once the question is saved.','El tipo no puede cambiar una vez guardada la pregunta.','O tipo não pode mudar depois que a pergunta é salva.'],
  ratingAverage:['Average','Promedio','Média'],ratingPeopleOne:['1 person rated','1 persona valoró','1 pessoa avaliou'],ratingPeopleMany:['{n} people rated','{n} personas valoraron','{n} pessoas avaliaram'],
  ratingNone:['No ratings yet','Aún no hay valoraciones','Ainda não há avaliações'],ratingBars:['Ratings from 1 to 10','Valoraciones del 1 al 10','Avaliações de 1 a 10'],
  ratingBarOne:['1 person chose {score}','1 persona eligió {score}','1 pessoa escolheu {score}'],ratingBarMany:['{n} people chose {score}','{n} personas eligieron {score}','{n} pessoas escolheram {score}'],
  ratingCsv:['Download counts (CSV)','Descargar conteos (CSV)','Baixar contagens (CSV)'],
  // The party in the totals and the participant list: people register for it, so it counts registrations, with no attendance or hours.
  blocksAndParty:['Conferences, laboratory and party','Conferencias, laboratorio y fiesta','Conferências, laboratório e festa'],
  filterBlock:['Block','Bloque','Bloco'],filterAllBlocks:['All blocks','Todos los bloques','Todos os blocos'],
  attendanceSignIn:['Attendance not saved: your session ended.','No se guardó la asistencia: tu sesión terminó.','A presença não foi salva: sua sessão terminou.'],
  attendanceNotSaved:['Attendance not saved. Check the connection and tick it again.','No se guardó la asistencia. Revisa la conexión y vuelve a marcarla.','A presença não foi salva. Verifique a conexão e marque de novo.'],
  // The Programme section: each block's details as organisers edit them. "From" and the kind labels sit before data, so they need no {placeholders}.
  programmeSection:['Programme','Programa','Programação'],
  pgHint:['Edit the details of each block. Changes reach the festival page within a minute; adding or removing a block still needs the NODAL team.','Edita los detalles de cada bloque. Los cambios llegan a la página del festival en menos de un minuto; para añadir o quitar un bloque, escribe al equipo de NODAL.','Edite os detalhes de cada bloco. As alterações chegam à página do festival em menos de um minuto; para adicionar ou remover um bloco, fale com a equipe NODAL.'],
  pgUntimed:['Untimed','Sin horario','Sem horário'],pgFrom:['From','Desde las','A partir das'],
  pgConference:['Conference','Conferencia','Conferência'],pgLab:['Laboratory','Laboratorio','Laboratório'],pgParty:['Party','Fiesta','Festa'],pgWorkshop:['Workshop','Taller','Oficina'],pgRoute:['Route','Ruta','Roteiro'],
  pgEdited:['Edited','Editado','Editado'],pgEdit:['Edit','Editar','Editar'],
  pgTitle:['Title','Título','Título'],pgDate:['Date','Fecha','Data'],pgStart:['Start time','Hora de inicio','Horário de início'],pgEnd:['End time','Hora de fin','Horário de término'],pgEndOptional:['End time (optional)','Hora de fin (opcional)','Horário de término (opcional)'],
  pgTimeHintCheckin:['Give a start and an end, or leave both empty for a block without a set time. Check-in and certificate hours follow these times.','Indica inicio y fin, o deja ambas vacías para un bloque sin horario fijo. El registro de asistencia y las horas del certificado siguen estos horarios.','Informe início e término, ou deixe os dois vazios para um bloco sem horário definido. O registro de presença e as horas do certificado seguem esses horários.'],
  pgTimeHintFree:['The end time is optional: a start alone reads “From 17:00”.','La hora de fin es opcional: solo con el inicio se lee «Desde las 17:00».','O horário de término é opcional: só com o início aparece “A partir das 17:00”.'],
  pgVenue:['Venue','Lugar','Local'],pgDescription:['Description (optional)','Descripción (opcional)','Descrição (opcional)'],
  pgSessions:['Schedule','Agenda','Agenda'],pgSessionsHint:['One line per talk or moment: a time, free text such as “19:00 onwards”, and a title.','Una línea por charla o momento: un horario, en texto libre como «19:00 en adelante», y un título.','Uma linha por palestra ou momento: um horário, em texto livre como “19:00 em diante”, e um título.'],
  pgSessionTime:['Time','Horario','Horário'],pgSessionTitle:['Title','Título','Título'],pgLine:['Line','Línea','Linha'],
  pgAddLine:['Add line','Añadir línea','Adicionar linha'],pgMoveUp:['Move up','Subir','Subir'],pgMoveDown:['Move down','Bajar','Descer'],pgRemoveLine:['Remove','Quitar','Remover'],
  pgFormUrl:['Activity form link (https://)','Enlace del formulario de la actividad (https://)','Link do formulário da atividade (https://)'],
  pgSave:['Save block','Guardar bloque','Salvar bloco'],pgCancel:['Cancel','Cancelar','Cancelar'],pgRestore:['Restore original','Restaurar el original','Restaurar o original'],
  pgRestoreConfirm:['Restore this block’s original details? The changes saved here are removed for everyone.','¿Restaurar los datos originales de este bloque? Los cambios guardados aquí se eliminan para todos.','Restaurar os dados originais deste bloco? As alterações salvas aqui são removidas para todos.'],
  pgRestored:['Original restored','Original restaurado','Original restaurado'],
  pgDiscard:['Discard your unsaved changes to this block?','¿Descartar los cambios sin guardar de este bloque?','Descartar as alterações não salvas deste bloco?'],
  pgStartRequired:['Add a start time.','Añade una hora de inicio.','Adicione um horário de início.'],pgEndRequired:['Add an end time, or leave both times empty.','Añade una hora de fin o deja ambas vacías.','Adicione um horário de término ou deixe os dois vazios.'],
  pgEndAfterStart:['The end time must be after the start time.','La hora de fin debe ser posterior a la de inicio.','O horário de término deve ser depois do de início.'],
  pgInvalidTitle:['Write a title of up to 200 characters, on one line.','Escribe un título de hasta 200 caracteres, en una sola línea.','Escreva um título de até 200 caracteres, em uma só linha.'],
  pgInvalidDate:['Choose a date between 20 and 25 October.','Elige una fecha entre el 20 y el 25 de octubre.','Escolha uma data entre 20 e 25 de outubro.'],
  pgInvalidTime:['Check the times: the end must come after the start, and a conference block or the laboratory needs both times or none.','Revisa los horarios: el fin debe ser posterior al inicio, y un bloque de conferencias o el laboratorio necesita ambas horas o ninguna.','Revise os horários: o término deve vir depois do início, e um bloco de conferências ou o laboratório precisa dos dois horários ou de nenhum.'],
  pgInvalidVenue:['Write the venue in up to 200 characters, on one line.','Escribe el lugar en hasta 200 caracteres, en una sola línea.','Escreva o local em até 200 caracteres, em uma só linha.'],
  pgInvalidDescription:['Shorten the description to 1,500 characters.','Acorta la descripción a 1500 caracteres.','Reduza a descrição para 1.500 caracteres.'],
  pgInvalidSessions:['Check the schedule: up to 12 lines, each with a title of up to 180 characters, and times of up to 40 characters.','Revisa la agenda: hasta 12 líneas, cada una con un título de hasta 180 caracteres, y horarios de hasta 40 caracteres.','Revise a agenda: até 12 linhas, cada uma com um título de até 180 caracteres, e horários de até 40 caracteres.'],
  pgInvalidFormUrl:['Enter the activity form link, starting with https://.','Escribe el enlace del formulario, empezando por https://.','Informe o link do formulário, começando com https://.'],
  pgNotFound:['This block is no longer in the programme. Reload the page.','Este bloque ya no está en el programa. Recarga la página.','Este bloco não está mais na programação. Recarregue a página.'],
  pgHoursWarningOne:['1 person has checked in to this block. Their certificate hours will follow the new time.','1 persona registró su asistencia en este bloque. Sus horas del certificado seguirán el nuevo horario.','1 pessoa registrou presença neste bloco. As horas do certificado vão seguir o novo horário.'],
  pgHoursWarningMany:['{n} people have checked in to this block. Their certificate hours will follow the new time.','{n} personas registraron su asistencia en este bloque. Sus horas del certificado seguirán el nuevo horario.','{n} pessoas registraram presença neste bloco. As horas do certificado vão seguir o novo horário.'],
  pgWindowWarning:['This block’s day has started: a new date or time moves its check-in at once.','El día de este bloque ya empezó: una nueva fecha u hora mueve su registro de asistencia de inmediato.','O dia deste bloco já começou: uma nova data ou horário muda o registro de presença na hora.'],
  pgLoadError:['The programme could not be loaded.','No se pudo cargar el programa.','Não foi possível carregar a programação.'],pgEmptyValue:['(empty)','(vacío)','(vazio)'],
  // The party announcement, under the party's row; its sent, failed and progress lines are the summary emails' own (fiiu-ui.js).
  noticeTitle:['Announce the party','Anunciar la fiesta','Anunciar a festa'],
  noticeHint:['One email to each registrant who has not added the closing party yet, with its details and a button to add it. Each person gets it once, in the language they registered in (Spanish otherwise).','Un correo a cada persona inscrita que aún no añadió la fiesta de cierre, con sus detalles y un botón para añadirla. Cada persona lo recibe una sola vez, en el idioma en que se inscribió (si no, en español).','Um e-mail para cada pessoa inscrita que ainda não adicionou a festa de encerramento, com os detalhes e um botão para adicioná-la. Cada pessoa o recebe uma única vez, no idioma em que se inscreveu (se não, em espanhol).'],
  noticeWaitingOne:['1 registrant has not added the party','1 persona inscrita no ha añadido la fiesta','1 pessoa inscrita não adicionou a festa'],noticeWaitingMany:['{n} registrants have not added the party','{n} personas inscritas no han añadido la fiesta','{n} pessoas inscritas não adicionaram a festa'],
  noticeNoneWaiting:['Nobody is waiting for the announcement','Nadie espera el anuncio','Ninguém aguarda o anúncio'],
  noticeLeftOne:['1 left today','queda 1 hoy','resta 1 hoje'],noticeLeftMany:['{n} left today','quedan {n} hoy','restam {n} hoje'],
  noticeSendOne:['Announce the party to 1 person','Anunciar la fiesta a 1 persona','Anunciar a festa para 1 pessoa'],noticeSendMany:['Announce the party to {n} people','Anunciar la fiesta a {n} personas','Anunciar a festa para {n} pessoas'],
  noticeConfirmHint:['The announcement goes out now, a few emails at a time. You can stop at any time.','El anuncio sale ahora, unos pocos correos a la vez. Puedes detener el envío en cualquier momento.','O anúncio sai agora, alguns e-mails por vez. Você pode parar o envio a qualquer momento.'],
  noticeCap:['Today’s limit of {cap} emails is reached (summary and sign-up emails included). Sending can continue after {time} Lima time.','Se alcanzó el límite de hoy: {cap} correos (incluidos los de resumen e inscripción). Se puede seguir enviando después de las {time}, hora de Lima.','O limite de hoje foi atingido: {cap} e-mails (incluindo os de resumo e de inscrição). O envio pode continuar depois das {time}, horário de Lima.'],
  noticeOff:['Emails are off, so the announcement cannot be sent. To turn them on, set EMAIL_SMTP_URL and EMAIL_FROM (and PUBLIC_BASE_URL) in Vercel for Production, then redeploy.','Los correos están desactivados, así que el anuncio no se puede enviar. Para activarlos, configura EMAIL_SMTP_URL y EMAIL_FROM (y PUBLIC_BASE_URL) en Vercel para Production y vuelve a desplegar.','Os e-mails estão desativados, então o anúncio não pode ser enviado. Para ativá-los, defina EMAIL_SMTP_URL e EMAIL_FROM (e PUBLIC_BASE_URL) na Vercel para Production e publique de novo.'],
  noticeLoadError:['The announcement status could not be loaded.','No se pudo cargar el estado del anuncio.','Não foi possível carregar o status do anúncio.'],
  // The summary emails' cap line: the party announcement now counts toward the same daily limit (the shared backfillCap names sign-up emails only).
  summaryCap:['Today’s limit of {cap} emails is reached (sign-up emails and the party announcement included). Sending can continue after {time} Lima time.','Se alcanzó el límite de hoy: {cap} correos (incluidos los de inscripción y el anuncio de la fiesta). Se puede seguir enviando después de las {time}, hora de Lima.','O limite de hoje foi atingido: {cap} e-mails (incluindo os de inscrição e o anúncio da festa). O envio pode continuar depois das {time}, horário de Lima.'],
  // The settings keep one public link, the programme's.
  publicLink:['Link shown on the public page','Enlace que se muestra en la página pública','Link exibido na página pública']
 });
 const root=document.getElementById('fiiuAdminRoot'),message=document.getElementById('fiiuStatus');
 let festival,config,records=[],cursor=null,filling=null,listStale=false,publications=[],contentCursor=null,selectedParticipant=null,shownParticipant=null,detailRequest=0,participantFilter='all',participantQuery='',participantWords=[],participantBlock='',blockFilter=null,shownCount=null,updatedAt=null,search=null,searchTimer=null,setAside=null;
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
 // So does a settings link typed but not saved (the availability switch saves on its own).
 // And so does an open programme block with changes.
 window.addEventListener?.('beforeunload',event=>{if(locked)return;const editor=currentEditor();if(hasText(setAside)||(editor?.isNew?hasText(editor.draft()):editor?.dirty())||questionDraft()||settingsDirty()||programmeDraft()){event.preventDefault();event.returnValue='';}});
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
 const SECTIONS=[['overview','navOverview'],['checkin','checkIn'],['participants','participants'],['settings','settings'],['programme','programmeSection'],['content','content'],['conversations','conversations']];
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
  // Split by type (lab, conferences and the party vs workshops and routes), each in programme order; ids no longer in the catalogue go last.
  // The party takes registrations but no check-in, so its attendance and hours read as not applicable.
  const entries=summary.activities.filter(row=>event.activities.some(a=>a.id===row.activityId)||row.registrations||row.externalInterests||row.attendance).map(row=>({row,activity:findActivity(event,row.activityId)}));
  const order=new Map(chronological(entries.filter(e=>e.activity).map(e=>e.activity)).map((a,i)=>[a.id,i])),rank=e=>e.activity?order.get(e.activity.id):order.size,conferences=[],externals=[],none=()=>el('span','f-summary-count is-zero','–');let party=false;
  for(const {row,activity} of [...entries].sort((a,b)=>rank(a)-rank(b))){
   const [registrations,interests,attendance]=[row.registrations,row.externalInterests,row.attendance].map(count),kind=activity?blockKind(activity):'',external=['workshop','route'].includes(kind),label=el('span','f-row-label');
   if(kind==='party')party=true;
   if(activity){label.append(source('span',activity.title));if(activity.registration==='application')label.append(tr('span','lab','f-row-meta'));else if(kind==='party')label.append(tr('span','pgParty','f-row-meta'));else if(activity.time&&!external)label.append(el('span','f-row-meta',activity.time));}else label.append(el('span','',row.activityId));
   const venue=activity?.venue?source('span',activity.venue,'f-row-venue'):activity?tr('span','venuePending','f-muted'):el('span','');
   (external?externals:conferences).push({date:activity?.date,row:external?[label,venue,interests,attendance]:kind==='party'?[label,venue,registrations,none(),none()]:[label,venue,registrations,attendance,hours(row.attendance*minutesOf(activity)/60)]});
  }
  const heading=key=>{const h=tr('h3',key);h.id='f-sum-'+key;return h;},col=(...nodes)=>{const box=el('div','f-summary-col');box.append(...nodes);return box;},people=el('div','f-summary-grid'),activities=el('div','f-summary-stack');
  // Largest profiles first; equal counts keep the server's alphabetical order.
  const profiles=summary.profiles.length?summaryTable({labelledBy:'f-sum-profiles',cls:'is-profiles'},['profileAdmin','participantCount','share'],[{rows:[...summary.profiles].sort((a,b)=>b.count-a.count).map(row=>[tr('span',row.profile||'unspecified'),count(row.count),el('span','f-summary-share',total?percent.format(row.count/total):'–')])}]):tr('p','noParticipants','f-muted');
  people.append(col(heading('byDay'),days,tr('p','byDayHint','f-muted f-table-note')),col(heading('profiles'),profiles));
  activities.append(summaryTable({caption:party?'blocksAndParty':'conferencesAndLab'},['activity','venue','registered','attended','hours'],byDate(conferences)),summaryTable({caption:'externalActivities'},['activity','venue','interested','attended'],byDate(externals)));
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
  try{const result=await(pending||api('/api/admin/fiiu/summary').then(data=>({data}),error=>({error})));if(result.error)throw result.error;const next=result.data.summary,before=lastSummary?.totalRegistrations;if(summaryKey(next)!==lastSummaryKey)renderSummary(next);else renderCheckin(next);syncCheckins(next);status(summaryMessage,'');stampUpdated(new Date());resume();
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
  // checkinActivities leaves out only workshops and routes; the party (a register-only block) takes no check-in either.
  if(!festival)return;const stats=new Map((summary?.activities||[]).map(row=>[row.activityId,row])),blocks=checkinActivities(festival.event).filter(takesCheckin),states=blocks.map(activity=>checkinState(activity));
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
  for(const pass of emailPasses)pass.lock();
  questions=null;newQuestion=null;questionRows.clear();questionLayout='';programme=null;programmeRows.clear();programmeLayout='';
  for(const host of [listHost,detailHost,participantsHost,summaryBody,checkinBody,settingsHost,contentHost,editorHost,pubList,resultCount,conversationsHost,questionEditorHost,questionList,questionAlert,programmeHost,programmeList,programmeAlert])host.replaceChildren();
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
 // An error toast clears after 12 s. An expired session's message, in the toast or on the row where it happened (an attendance tick),
 // carries its own sign-in link instead, so the organiser can act from where they are.
 function reportError(feedback,err){status(feedback,err);if(err?.status===401)feedback.append(document.createTextNode(' '),signInLink());else if(feedback===message)clearLater(message,message.dataset.fiiuText,12000);}
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
  // Filtering waits for a pause in typing, so a long list is not re-rendered on every keystroke. Each word may match anywhere, so a given name
  // and a surname find "Ana María Gonzales" in either order.
  search.input.autocomplete='off';search.input.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{const query=norm(search.input.value.trim());if(query===participantQuery)return;participantQuery=query;participantWords=query.split(/\s+/).filter(Boolean);renderList();},120);});
  label.id='f-filter-label';chips.setAttribute('role','group');chips.setAttribute('aria-labelledby',label.id);chips.append(label);
  for(const [key,text] of [['all','filterAll'],['labPending','filterLabPending'],['labAccepted','filterLabAccepted'],['publicOfficials','publicOfficials']]){const chip=button(text,()=>{participantFilter=key;syncFilterChips();renderList();},'f-filter');filterButtons.set(key,chip);chips.append(chip);}
  // The block filter lists every block people register for (the conference blocks and the party) and combines with the chips and the search.
  const block=field('filterBlock'),every=tr('option','filterAllBlocks');blockFilter=el('select');blockFilter.name='participantBlock';blockFilter.id='f-participantBlock';every.value='';blockFilter.append(every);
  for(const a of chronological(festival.event.activities.filter(activity=>['general','social'].includes(activity.registration)))){const option=source('option',blockLabel(a));option.value=a.id;blockFilter.append(option);}
  block.input.replaceWith(blockFilter);blockFilter.addEventListener('change',()=>{participantBlock=blockFilter.value;renderList();});
  syncFilterChips();box.append(search.wrap,block.wrap,chips,resultCount);return box;
 }
 const blockLabel=a=>`${a.date.slice(8)}/${a.date.slice(5,7)} · ${a.title}`;
 function clearBlock(){participantBlock='';if(blockFilter)blockFilter.value='';}
 function syncFilterChips(){for(const [key,chip] of filterButtons)chip.setAttribute('aria-pressed',String(key===participantFilter));}
 // A shortcut shows its whole filter: a search left in the box, or still waiting for its pause, is cleared.
 function clearSearch(){globalThis.clearTimeout?.(searchTimer);participantQuery='';participantWords=[];if(search)search.input.value='';}
 function showFilter(key){participantFilter=key;clearSearch();clearBlock();syncFilterChips();renderList();participantsHost.scrollIntoView?.({block:'start'});filterButtons.get(key)?.focus({preventScroll:true});}
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
   const visible=records.filter(FILTERS[participantFilter]).filter(r=>!participantBlock||r.answers.activities?.includes(participantBlock)).filter(r=>{const searchKey=searchKeys.get(r);return participantWords.every(word=>searchKey.includes(word));});
   // While the other pages load in the background a filtered view says so; "Load more" is left only when that load stopped on an error.
   if(cursor&&(participantFilter!=='all'||participantQuery||participantBlock))listHost.append(tr('p',filling?'loading':'showingLoaded','f-muted'));
   if(!visible.length){listHost.append(tr('p','noMatches','f-muted f-empty'));listHost.append(button('showAll',()=>{participantFilter='all';clearSearch();clearBlock();syncFilterChips();renderList();filterButtons.get('all')?.focus();},'f-button secondary f-small f-show-all'));}
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
  // A failed save undoes the tick and says so on the row: the shared messages speak of drafts a tick does not have. An outage and a server
  // error read the same (the page cannot tell them apart); the status travels on, so an ended session still shows its notice.
  input.addEventListener('change',()=>{
   if(pending){input.checked=!input.checked;return;}
   const wanted=input.checked;pending=true;input.setAttribute('aria-disabled','true');
   return action(null,async()=>{let result;try{result=await api('/api/admin/fiiu/registrations/'+id+'/attendance',{activityId:activity.id,attended:wanted},'PUT');}catch(err){input.checked=!wanted;const k=err?.status===401?'attendanceSignIn':err?.key==='error'?'attendanceNotSaved':'';throw k?Object.assign(Error(t(k)),{key:k,status:err.status}):err;}saved?.(activity,wanted,result?.attendance);refreshSummary({background:true});},{feedback:note,done:'attendanceSaved'}).finally(()=>{pending=false;input.removeAttribute('aria-disabled');});
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
  // The party takes no check-in, so it has no tick here (the answers below list it).
  const list=chronological([...festival.event.activities,...(festival.event.legacyActivities||[]).filter(activity=>attended.has(activity.id)||interests.has(activity.id))].filter(activity=>activity.registration!=='social'&&(activity.registration==='external'||own(activity))));
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
  const changed=shownParticipant!==id;updateRecord(r);shownParticipant=id;markSelected();name.id='f-detail-name';who.append(name,el('p','f-muted',r.email),emailStatusLine(r));
  head.append(who,button('backToList',()=>(rowButtons.get(id)||search?.input)?.focus(),'f-button secondary f-small f-narrow-only'));
  // Beside the list the panel scrolls on its own (fiiu.css): another person starts at the top, with their name above the ticks, instead of at the
  // previous person's place. Re-reading the same person (after a review save) keeps the place.
  detailHost.replaceChildren(head);if(changed)detailHost.scrollTop=0;detailHost.tabIndex=-1;detailHost.setAttribute('aria-labelledby',name.id);
  if(a.applyLab)detailHost.append(reviewCard(r,id));
  answers.append(tr('summary','allAnswers'),answerRows(el('dl','f-answers-list'),a,Object.keys(a).filter(key=>!['privacyAccepted','externalActivities'].includes(key))));
  detailHost.append(attendanceFieldset(r,data.attendance,id),answers);
  // Beside the list (wide, tall screens, where it is sticky; fiiu.css) the page stays put; stacked below it or on a short screen, its top goes just under the section nav.
  if(focus){const beside=window.matchMedia?.('(min-width: 1000px) and (min-height: 641px)')?.matches;if(!beside)detailHost.scrollIntoView?.({block:'start'});detailHost.focus({preventScroll:true});}
 }
 function renderRegistrationPill(){const on=config.registrationOpen;pillHost.replaceChildren(link(on?'registrationOpenNow':'registrationClosedNow','#settings','f-pill'+(on?' is-open':'')));}
 // The link fields on screen; leaving the page while one differs from the saved settings asks first.
 let linkInputs=[];
 // The saved settings a save sends back. An older record may still hold the party link the settings no longer have; it is left behind, not sent.
 const savedSettings=()=>Object.fromEntries(Object.entries(config).filter(([name])=>name!=='partyUrl'));
 function settingsDirty(){return linkInputs.some(input=>input.value!==(config?.[input.name]??''));}
 function settings(){
  const form=el('form','f-form'),card=el('div','f-switch-card'),links=el('fieldset','f-links'),open=check('registrationOpen','registrationOpen','yes',config.registrationOpen),note=hint('registrationOpenHint'),conflict=el('div','f-conflict'),switchNote=el('p','f-inline-status'),switchConflict=el('div','f-conflict');let busy=false,pending=false;
  open.input.setAttribute('role','switch');open.input.setAttribute('aria-describedby',note.id);switchNote.setAttribute('role','status');card.append(open.wrap,note,switchNote,switchConflict);links.append(tr('legend','publicLink'));
  // The public page shows only the programme link: each workshop and route carries its own form link, and the party registers through NODAL.
  linkInputs=['programUrl'].map(key=>{const link=field(key,{value:config[key],type:'url',max:2000});links.append(link.wrap);return link.input;});
  const save=button('saveSettings');save.type='submit';form.append(card,links,save,conflict);localiseValidation(form);
  // The switch saves on its own, as a switch implies (and as attendance ticks do), so the header pill and the public page follow at once. Closing
  // asks first; a failed save puts it back to what is saved. Its save carries only the availability: links typed but not yet saved wait for Save.
  // It stays focusable while saving (a toggle meanwhile is undone) and Save waits for it.
  open.input.addEventListener('change',()=>{
   if(pending){open.input.checked=!open.input.checked;return;}
   const wanted=open.input.checked;if(config.registrationOpen&&!wanted&&!window.confirm(t('closeConfirm'))){open.input.checked=true;return;}
   pending=true;open.input.setAttribute('aria-disabled','true');
   return action(save,async()=>{try{config=(await api('/api/admin/fiiu/config',{...savedSettings(),registrationOpen:wanted,version:config.version},'PUT')).config;}catch(err){open.input.checked=config.registrationOpen;throw err;}finally{renderRegistrationPill();}},{feedback:switchNote,conflict:switchConflict,reload:reloadSwitch}).finally(()=>{pending=false;open.input.removeAttribute('aria-disabled');});
  });
  // The switch's own conflict re-reads the settings for the switch alone: links typed and not yet saved stay in their fields, waiting for Save.
  async function reloadSwitch(){
   config=(await api('/api/admin/fiiu/config')).config;open.input.checked=config.registrationOpen;renderRegistrationPill();
   status(switchNote,'');switchConflict.replaceChildren();open.input.focus();
  }
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(busy||pending)return;
   // Saved settings the form does not show (the older workshop and route links) go back unchanged, and so does the saved availability.
   const payload={...savedSettings(),...Object.fromEntries(new FormData(form)),registrationOpen:config.registrationOpen,version:config.version},unlock=lockForm(form);busy=true;
   // The server saves each link as its URL parser writes it (https://Example.org becomes https://example.org/), so the fields take the saved
   // values back: what shows is what is saved, and leaving afterwards does not ask about changes that are already saved.
   try{await action(save,async()=>{const result=await api('/api/admin/fiiu/config',payload,'PUT');config=result.config;for(const input of linkInputs)input.value=config[input.name]??'';renderRegistrationPill();},{conflict,reload:reloadSettings});}
   finally{busy=false;unlock();}
  });
  settingsHost.id='settings';settingsHost.replaceChildren(tr('h2','settings'),form,summaryEmails.host);return settingsHost;
 }
 async function reloadSettings(){config=(await api('/api/admin/fiiu/config')).config;renderRegistrationPill();settings();settingsHost.querySelector('input')?.focus();}
 // Email passes: the summary emails (people the first-registration email did not reach, because they registered before it existed or while sending
 // was off or over its limit) and the party announcement (registrants who have not added the closing party). One press sends batch after batch (the
 // server sends a few per request and claims each row before its email goes out, so a double click or a second organiser never emails anyone twice)
 // until the pass is done, stopped, or today's cap, which both share, is reached. Plain lines and one press-plate button; Retry, Cancel and Stop
 // are text buttons. Interpolated text carries no data-fiiu-text, so the language switch re-renders it here instead of overwriting the numbers.
 const EMAIL_STATES=['pending','sent','failed','uncertain','skipped'],TALLY=['sent','failed','uncertain','skipped','claimedElsewhere'];
 const fill=(key,values={})=>t(key).replace(/\{(\w+)\}/g,(match,name)=>values[name]??match),nf=n=>new Intl.NumberFormat(locale()).format(n);
 const plural=(base,n)=>fill(n===1?base+'One':base+'Many',{n:nf(n)});
 /* Send swaps itself for Confirm, and Confirm for Stop, with focus on the new button, so a second press meant for the
    first one would land on the next: a double click, Enter pressed twice or held down. A press is ignored for
    BACKFILL_SETTLE_MS after the buttons change (longer than an ordinary double click), and a held Enter or Space does
    not repeat; other held keys (Tab, arrows) move on as usual. (A call without an event comes from code.) */
 const BACKFILL_SETTLE_MS=600;
 // id names the block; endpoint answers GET with the state (configured, counts, dailyCap, sentToday, resetsAt) and POST with one batch. waiting is the
 // counts key of the people still to email; keys holds the block's own wording. The summary emails' batches also say how many are left after their
 // cursor (remaining); the announcement's counts say who is still waiting. left adds what is left of today's cap to the counts line; active says
 // whether the block is on the page at all; level is its heading's, one below the heading it sits under.
 function emailPass({id,endpoint,waiting,keys,remaining=false,left=false,active=()=>true,level='h3'}){
  const host=el('div','f-backfill'+(id==='backfill'?'':' f-'+id)),heading=tr(level,keys.title),hintNode=tr('p',keys.hint,'f-muted f-section-hint'),line=el('p','f-backfill-line'),note=el('p','f-backfill-note'),actions=el('div','f-backfill-actions');
  heading.id='f-h-'+id;host.setAttribute('role','group');host.setAttribute('aria-labelledby',heading.id);note.setAttribute('role','status');note.setAttribute('aria-live','polite');host.append(heading,hintNode,line,note,actions);
  // state: the last GET; ask: the pass waiting for its confirmation; run: the pass under way; result: how the last one ended; asking: Send's read is out.
  let state=null,loadFailed=false,ask=null,run=null,result=null,shownAt=0,asking=false;
  const validCounts=counts=>Boolean(counts)&&[waiting,...EMAIL_STATES].every(k=>Number.isSafeInteger(counts[k])&&counts[k]>=0);
  const validBatch=data=>TALLY.every(k=>Number.isSafeInteger(data[k])&&data[k]>=0)&&(!remaining||(Number.isSafeInteger(data.remaining)&&data.remaining>=0))&&(data.next===null||typeof data.next==='string')&&validCounts(data.counts);
  // One button per action, made once and kept: a progress update leaves the focused Stop button in place instead of rebuilding it.
  const buttons=new Map(),handlers={send:()=>askFor('send'),retry:()=>askFor('retry'),confirm:()=>start(ask),cancel:()=>{const mode=ask;ask=null;render(mode);},stop:()=>stop(),reload:()=>load('reload')};
  function textButton(text,action,cls='f-backfill-link'){
   let b=buttons.get(action);
   if(!b){
    b=el('button');b.type='button';b.dataset.action=action;
    b.addEventListener('click',event=>{if(event&&Date.now()-shownAt<BACKFILL_SETTLE_MS)return;handlers[action]();});
    b.addEventListener('keydown',event=>{if(event?.repeat&&['Enter',' '].includes(event.key))event.preventDefault();});
    buttons.set(action,b);
   }
   b.className=cls;b.textContent=text;return b;
  }
  // Confirm names the number waiting now, not at page load: people register all day and sign-up emails use the shared cap, so Send reads the state
  // again first. A press while that read is out is ignored; a read that fails, or finds nobody to email or the cap reached, asks nothing. The read
  // shows (Loading… and aria-busy) for as long as it is out: on a slow connection a press that seems to do nothing invites more presses, and one
  // that comes after the settle time would land on Confirm without the number being read.
  async function askFor(mode){
   if(asking||run)return;asking=true;result=null;host.setAttribute('aria-busy','true');render();let fresh;
   try{fresh=await load();}finally{asking=false;host.setAttribute('aria-busy','false');}
   if(fresh&&!locked&&!run&&state.configured&&!capReached()&&(mode==='retry'?state.counts.failed:state.counts[waiting]))ask=mode;
   render(ask?'confirm':undefined);
  }
  const capReached=()=>Number.isSafeInteger(state?.dailyCap)&&Number.isSafeInteger(state?.sentToday)&&state.sentToday>=state.dailyCap;
  // Today's cap has reset (19:00 Lima) since the page last asked: the minute timer asks again, so the buttons come back without a reload.
  const capLifted=()=>capReached()&&!run&&!ask&&Date.now()>=Date.parse(state.resetsAt);
  const capText=()=>fill(keys.cap,{cap:nf(state?.dailyCap??0),time:Number.isFinite(Date.parse(state?.resetsAt))?limaClock(Date.parse(state.resetsAt)):'19:00'});
  const leftToday=()=>Number.isSafeInteger(state?.dailyCap)&&Number.isSafeInteger(state?.sentToday)?Math.max(0,state.dailyCap-state.sentToday):null;
  function tallyText({sent,failed,uncertain,skipped}){return [fill('backfillDone',{sent:nf(sent),failed:nf(failed)}),...(uncertain?[plural('backfillUncertain',uncertain)]:[]),...(skipped?[plural('backfillSkipped',skipped)]:[])].join(' · ');}
  function resultText({end,tally}){
   const handled=tally.sent+tally.failed+tally.uncertain+tally.skipped,base=tallyText(tally);
   if(end==='done')return base+(tally.failed?' — '+t('backfillDoneRetry'):'');
   if(end==='stopped')return t('backfillStopped')+' '+base;
   const reason={cap:capText(),session:t('backfillSignIn'),error:t('backfillError')}[end]||'';
   return handled?base+'. '+reason:reason;
  }
  function progressText(pass){
   const parts=[fill('backfillProgress',{sent:nf(pass.tally.sent),total:nf(Math.max(pass.total,pass.tally.sent))}),...(pass.tally.failed?[fill('backfillFailed',{n:nf(pass.tally.failed)})]:[])];
   return parts.join(' · ')+(pass.stopping?' — '+t('backfillStopping'):pass.waiting?' — '+t('backfillPausing'):'…');
  }
  // focus names the action to focus after this render; otherwise focus that was on a replaced button moves to the first action, or the heading.
  function render(focus){
   if(locked)return;
   const counts=state?.counts,shown=[];let text,status='',error=false;
   hintNode.hidden=Boolean(state&&!state.configured);
   if(!state){text=t(loadFailed?keys.loadError:'loading');if(loadFailed)shown.push(textButton(t('retry'),'reload'));}
   else if(!state.configured)text=t(keys.off);
   else{
    const rest=left?leftToday():null;
    text=[counts[waiting]?plural(keys.waiting,counts[waiting]):t(keys.noneWaiting),plural('backfillSent',counts.sent),...(counts.failed?[fill('backfillFailed',{n:nf(counts.failed)})]:[]),...(counts.uncertain+counts.pending?[plural('backfillUncertain',counts.uncertain+counts.pending)]:[]),...(counts.skipped?[plural('backfillSkipped',counts.skipped)]:[]),...(rest===null?[]:[plural('noticeLeft',rest)])].join(' · ');
    if(run){status=progressText(run);shown.push(textButton(t('backfillStop'),'stop'));}
    else if(ask){
     const n=ask==='retry'?counts.failed:counts[waiting];status=t(keys.confirmHint);
     shown.push(textButton(plural('backfillConfirm',n),'confirm','f-button'),textButton(t('backfillCancel'),'cancel'));
    }
    else{
     if(asking)status=t('loading');
     else if(result){status=resultText(result);error=['session','error'].includes(result.end);}
     else if(loadFailed){status=t(keys.loadError);error=true;}
     if(capReached()&&(counts[waiting]||counts.failed)){if(result?.end!=='cap'&&!asking)status=(status?status+' ':'')+capText();}
     else{
      if(counts[waiting])shown.push(textButton(plural(keys.send,counts[waiting]),'send','f-button'));
      if(counts.failed)shown.push(textButton(fill('backfillRetry',{n:nf(counts.failed)}),'retry'));
     }
    }
   }
   line.textContent=text;note.textContent=status;note.classList.toggle('is-error',error);
   // The buttons are swapped only when the set changes; focus on one that leaves moves to the first remaining action, or the heading.
   const current=[...actions.children],changed=current.length!==shown.length||current.some((b,i)=>b!==shown[i]);
   const hadFocus=Boolean(focus)||(changed&&Boolean(actions.contains?.(document.activeElement)));
   if(changed){actions.replaceChildren(...shown);shownAt=Date.now();}
   if(hadFocus){const target=shown.find(b=>b.dataset.action===focus)||shown[0];if(target)target.focus();else{heading.tabIndex=-1;heading.focus();}}
  }
  // Says whether the state was read.
  async function load(focus){
   if(locked||!active())return false;
   try{
    const data=await api(endpoint);
    if(typeof data.configured!=='boolean'||!validCounts(data.counts))throw Object.assign(Error(t('error')),{key:'error'});
    state=data;loadFailed=false;resume();
   }catch(error){if(guard(error))return false;loadFailed=true;}
   render(focus);return !loadFailed;
  }
  function stop(){const pass=run;if(!pass||pass.stopping)return;pass.stopping=true;pass.wake?.();render('stop');}
  // One batch, posted here rather than through api(), which keeps only a refusal's code: a batch that sent some emails and then reached the shared
  // daily cap answers 429 with its outcomes (sent, failed, uncertain, skipped, claimedElsewhere) beside the cap's fields, and the refusal carries them.
  async function post(body){
   let response,data;const signal=typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(20000):undefined;
   try{response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),...(signal?{signal}:{})});data=await response.json().catch(()=>null);}
   catch{throw Object.assign(Error(t('error')),{key:'error'});}
   if(!response.ok)throw Object.assign(Error(t('error')),{key:'error',status:response.status,code:typeof data?.code==='string'?data.code:undefined,...(TALLY.every(k=>Number.isSafeInteger(data?.[k])&&data[k]>=0)?{outcome:Object.fromEntries(TALLY.map(k=>[k,data[k]]))}:{})});
   if(!data||typeof data!=='object'||Array.isArray(data))throw Object.assign(Error(t('error')),{key:'error'});
   return data;
  }
  // One pass: POST after POST with the previous answer's cursor until nothing is left, Stop, an error or today's cap. A plain 429 (the
  // organiser write budget) pauses half a minute and carries on, at most five times in a row.
  async function start(mode){
   if(run||!state)return;
   const pass=run={total:mode==='retry'?state.counts.failed:state.counts[waiting],tally:Object.fromEntries(TALLY.map(k=>[k,0])),stopping:false,waiting:false,wake:null};
   ask=null;result=null;render('stop');
   let after=null,pauses=0,finished=false,end='done';
   try{
    while(!pass.stopping&&!locked){
     let data;
     try{data=await post({retryFailed:mode==='retry',...(after?{after}:{})});}
     catch(error){
      // Stop pressed while this request was out: a plain 429 sent nothing, so the pass ends now instead of pausing first.
      if(error.status===429&&error.code!=='daily_cap'&&pass.stopping)break;
      if(error.status===429&&error.code!=='daily_cap'&&pauses<5&&typeof setTimeout==='function'){pauses++;pass.waiting=true;render();await new Promise(resolve=>{pass.wake=resolve;setTimeout(resolve,30000);});pass.waiting=false;pass.wake=null;render();continue;}
      throw error;
     }
     pauses=0;if(!validBatch(data))throw Object.assign(Error(t('error')),{key:'error'});
     for(const k of TALLY)pass.tally[k]+=data[k];
     // What this pass still has to do: its own outcomes so far plus what is left, as the server says after the cursor or as the counts still wait.
     const handled=pass.tally.sent+pass.tally.failed+pass.tally.uncertain+pass.tally.skipped;
     pass.total=remaining?handled+data.remaining:mode==='retry'?Math.max(pass.total,handled):handled+data.counts[waiting];
     state={...state,counts:data.counts,...(Number.isSafeInteger(data.sentToday)?{sentToday:data.sentToday}:{})};resume();
     if(!data.next||(remaining&&!data.remaining)){finished=true;break;}
     after=data.next;render();
    }
    if(!finished&&pass.stopping)end='stopped';
   }catch(error){
    if(guard(error)){run=null;return;}
    // What the batch that met the cap sent still counts in this pass's report.
    if(error.code==='daily_cap'&&error.outcome)for(const k of TALLY)pass.tally[k]+=error.outcome[k];
    end=error.code==='daily_cap'?'cap':error.code==='email_not_configured'?'off':error.status===401?'session':'error';
    if(end==='off')state={...state,configured:false};
   }
   run=null;result=end==='off'?null:{end,tally:pass.tally};render();
   // The counts behind the buttons and the overview from the server; the other block's cap counter has moved too.
   refreshSummary({background:true});await Promise.all(emailPasses.map(other=>other===self?load():other.running()?null:other.load()));
  }
  const self={host,render,load,running:()=>Boolean(run),
   // The minute timer: once the cap has reset, a pass that ended at the cap leaves no stale message, and the state is read again.
   tick(){if(!capLifted())return null;if(result?.end==='cap')result=null;return load();},
   lock(){if(run){run.stopping=true;run.wake?.();}state=null;ask=result=null;line.textContent=note.textContent='';actions.replaceChildren();}};
  return self;
 }
 const summaryEmails=emailPass({id:'backfill',endpoint:'/api/admin/fiiu/confirmations',waiting:'none',remaining:true,keys:{title:'backfillTitle',hint:'backfillHint',waiting:'backfillWaiting',noneWaiting:'backfillNoneWaiting',send:'backfillSend',confirmHint:'backfillConfirmHint',cap:'summaryCap',off:'backfillOff',loadError:'backfillLoadError'}});
 // The announcement sits under the party's row in the Programme section, so it is read only when the programme has the party; its heading is an
 // h4, a part of the party's day (an h3).
 const partyNotice=emailPass({id:'party-notice',endpoint:'/api/admin/fiiu/notices/closing-party',waiting:'waiting',left:true,level:'h4',active:()=>Boolean(festival&&findActivity(festival.event,'closing-party')),keys:{title:'noticeTitle',hint:'noticeHint',waiting:'noticeWaiting',noneWaiting:'noticeNoneWaiting',send:'noticeSend',confirmHint:'noticeConfirmHint',cap:'noticeCap',off:'noticeOff',loadError:'noticeLoadError'}});
 const emailPasses=[summaryEmails,partyNotice];
 // Programme: every block's details as organisers edit them (the server keeps one row per edited block, with its own version); adding or removing a block is
 // still a code change. Blocks are grouped by day in programme order; each row is built once (programmeRows, by id) and updated in place, and one block's
 // form is open at a time, under its row.
 const programmeHost=el('section','f-admin-programme'),programmeList=el('div','f-programme-list'),programmeAlert=el('div','f-question-alert'),programmeRows=new Map();
 let programme=null,programmeFailed=false,programmeLayout='';
 // The party is a "social" block: people add it to their registration, but it takes no check-in and counts no hours.
 const blockKind=activity=>activity.registration==='social'?'party':typeOf(activity),takesCheckin=activity=>['general','application'].includes(activity?.registration);
 const BLOCK_KINDS={conference:'pgConference',lab:'pgLab',party:'pgParty',workshop:'pgWorkshop',route:'pgRoute'},DESCRIPTION_MAX=1500,SCHEDULE_MAX=12;
 // Each refusal the server explains with a code gets its own message beside the form.
 const PROGRAMME_CODES={invalid_title:'pgInvalidTitle',invalid_date:'pgInvalidDate',invalid_time:'pgInvalidTime',invalid_venue:'pgInvalidVenue',invalid_description:'pgInvalidDescription',invalid_sessions:'pgInvalidSessions',invalid_form_url:'pgInvalidFormUrl'};
 const refusal=err=>{const k=err?.status===400?PROGRAMME_CODES[err.code]:err?.status===404?'pgNotFound':'';return k?Object.assign(Error(t(k)),{key:k,status:err.status,code:err.code}):err;};
 // The form opens on every field, so a block it could not fill (a schedule line that is not a time and a title, say) reads as a failed read.
 const isLine=line=>Array.isArray(line)&&line.length===2&&line.every(part=>typeof part==='string');
 const validBlock=a=>Boolean(a)&&typeof a.id==='string'&&typeof a.title==='string'&&typeof a.date==='string'&&typeof a.time==='string'&&typeof a.venue==='string'&&['string','undefined'].includes(typeof a.description)&&Array.isArray(a.sessions)&&a.sessions.every(isLine)&&Number.isSafeInteger(a.version)&&a.version>=0;
 const isEdited=a=>Boolean(a.edited)||a.version>0;
 // '09:00–13:00' is a start and an end, '17:00' a start only (the party, workshops and routes may have one), '' no set time.
 const splitTime=time=>{const m=/^(\d{2}:\d{2})(?:\s*[–-]\s*(\d{2}:\d{2}))?$/.exec(time||'');return m?[m[1],m[2]||'']:['',''];};
 const timeParts=time=>!time?[tr('span','pgUntimed')]:/[–-]/.test(time)?[el('span','',time)]:[tr('span','pgFrom'),document.createTextNode(' '+time)];
 function programmeDraft(){return [...programmeRows.values()].some(entry=>entry.editor?.dirty());}
 async function readProgramme(){const data=await api('/api/admin/fiiu/programme');if(!Array.isArray(data.activities)||!data.activities.every(validBlock))throw Object.assign(Error(t('error')),{key:'error'});return data.activities;}
 // Read with the dashboard: a failure keeps the dashboard and offers Try again here. Later reads come from a conflict's reload, block by block.
 async function refreshProgramme({pending}={}){
  if(locked)return;
  try{const result=await(pending||readProgramme().then(list=>({list}),error=>({error})));if(result.error)throw result.error;if(locked)return;programme=result.list;programmeFailed=false;resume();}
  catch(error){if(guard(error))return;programmeFailed=true;}
  renderProgramme();
 }
 // A saved, restored or re-read block replaces its row and the dashboard's copy of the programme, so the totals, check-in and conversation headings name it as saved.
 function applyBlock(item){
  programme=(programme||[]).map(a=>a.id===item.id?item:a);
  const {version,original,checkedIn,...block}=item;festival.event={...festival.event,activities:festival.event.activities.map(a=>a.id===block.id?{...a,...block}:a)};
  // Every block picker on the page names it as saved: the participant filter, the new question's and the open publication editor's.
  const pickers=[blockFilter,...[newQuestion?.form,editorHost.querySelector('form')].flatMap(form=>form?[...form.querySelectorAll('select')].filter(select=>select.name==='activityId'):[])];
  for(const select of pickers)for(const option of select?.children||[])if(option.value===block.id)option.textContent=blockLabel(block);
  renderProgramme();lastCheckinKey='';if(lastSummary)renderSummary(lastSummary);else renderCheckin();questionLayout='';renderQuestions();
 }
 function renderProgramme(){
  if(locked||!festival)return;programmeAlert.hidden=!programmeFailed;
  if(!programmeFailed)programmeAlert.replaceChildren();
  // A read that works removes Try again with the alert; focus that went with it moves to the section's heading, as in Conversations.
  else if(!programmeAlert.children.length){const retry=button('retry',()=>fetchInto(retry,async()=>{const list=await readProgramme();if(locked)return;programme=list;programmeFailed=false;renderProgramme();if(!document.activeElement||document.activeElement===document.body){const heading=programmeHost.querySelector('h2');if(heading){heading.tabIndex=-1;heading.focus();}}}),'f-button secondary f-small');programmeAlert.replaceChildren(tr('span','pgLoadError'),retry);}
  if(!programme){programmeList.replaceChildren(...(programmeFailed?[]:[tr('p','loading','f-muted')]));programmeLayout='';return;}
  const sorted=chronological(programme);
  for(const a of sorted){const entry=programmeRows.get(a.id)||programmeEntry(a.id);entry.record=a;entry.update();}
  // The same blocks on the same days are only updated, so a save never moves focus or the open form.
  const layout=JSON.stringify(sorted.map(a=>[a.date,a.id]));if(layout===programmeLayout)return;programmeLayout=layout;
  const active=document.activeElement,refocus=active?.id&&programmeList.contains?.(active)?active.id:'',days=[];
  for(const a of sorted){if(days.at(-1)?.date!==a.date)days.push({date:a.date,rows:[]});days.at(-1).rows.push(programmeRows.get(a.id).row);}
  programmeList.replaceChildren(...days.map(({date,rows})=>{const day=el('div','f-programme-day'),heading=dateNode(date,'h3','long','f-programme-date'),list=el('ul','f-programme-blocks');heading.id='f-pgd-'+date;list.setAttribute('aria-labelledby',heading.id);list.append(...rows);day.append(heading,list);return day;}));
  if(refocus)document.getElementById(refocus)?.focus({preventScroll:true});
 }
 // One row per block: its time, title, kind and Edited pill, then Edit; the form opens in the slot under them and the row's note says how a save went.
 function programmeEntry(id){
  const row=el('li','f-programme-row'),view=el('div','f-programme-view'),when=el('span','f-programme-time'),main=el('div','f-programme-main'),title=source('span','','f-programme-title'),meta=el('span','f-programme-meta'),slot=el('div','f-programme-slot'),note=el('p','f-inline-status');
  const entry={row,slot,note,record:null,editor:null};title.id='f-pg-'+id;note.setAttribute('role','status');
  const edit=entry.edit=button('pgEdit',()=>openProgrammeEdit(entry),'f-button secondary f-small');edit.id=title.id+'-edit';describe(edit,title.id);
  // The party's announcement sits directly under its row.
  main.append(title,meta);view.append(when,main,edit);row.append(view,slot,note,...(id==='closing-party'?[partyNotice.host]:[]));
  entry.update=()=>{const a=entry.record,kind=blockKind(a);row.className='f-programme-row is-'+kind;when.replaceChildren(...timeParts(a.time));title.textContent=a.title;meta.replaceChildren(tr('span',BLOCK_KINDS[kind],'f-programme-kind'),...(isEdited(a)?[tr('span','pgEdited','f-pill is-edited')]:[]));};
  programmeRows.set(id,entry);return entry;
 }
 // Opening another block with unsaved changes asks first; draft carries what a conflict's reload keeps (see programmeEditor).
 function openProgrammeEdit(entry,focus=true,draft=null){
  const open=[...programmeRows.values()].find(other=>other.editor&&other!==entry);
  if(open){if(open.editor.dirty()&&!window.confirm(t('pgDiscard')))return;closeProgrammeEdit(open,false);}
  closeProgrammeEdit(entry,false);entry.editor=programmeEditor(entry,draft);entry.slot.replaceChildren(entry.editor.form);entry.edit.hidden=true;status(entry.note,'');
  if(focus)entry.editor.form.querySelector('input')?.focus();
 }
 function closeProgrammeEdit(entry,focus=true){if(!entry.editor)return;entry.slot.replaceChildren();entry.editor=null;entry.edit.hidden=false;if(focus)entry.edit.focus();}
 // The block's form: title, date (within the festival), start and end, venue, description, schedule lines and, for workshops and routes, the form link.
 // A block that takes check-in (a conference block, the laboratory) has both times or neither; the party, workshops and routes may have a start only.
 // draft: after a conflict, the fields changed here (kept) to put over the latest version, and the version they started from (base).
 function programmeEditor(entry,draft=null){
  const start=entry.record,checkin=takesCheckin(start),external=start.registration==='external',prefix='f-pg-'+start.id,event=festival.event;
  const form=el('form','f-form f-programme-form'),buttons=el('div','f-programme-buttons'),conflict=el('div','f-conflict');let busy=false;
  const editor={form,version:start.version};
  const input=(key,name,options)=>{const f=field(key,options);f.input.name=name;f.input.id=prefix+'-'+name;return f;};
  const title=input('pgTitle','title',{value:start.title,required:true,max:200}),date=input('pgDate','date',{value:start.date,type:'date',required:true});date.input.min=event.startsOn;date.input.max=event.endsOn;
  const [startAt,endAt]=splitTime(start.time),from=input('pgStart','start',{value:startAt,type:'time'}),to=input(checkin?'pgEnd':'pgEndOptional','end',{value:endAt,type:'time'});
  const times=el('div','f-programme-times'),timeHint=tr('p',checkin?'pgTimeHintCheckin':'pgTimeHintFree','f-muted f-programme-hint');timeHint.id=prefix+'-time-hint';times.append(from.wrap,to.wrap);
  const venue=input('pgVenue','venue',{value:start.venue,max:200}),description=input('pgDescription','description',{value:start.description||'',type:'textarea',max:DESCRIPTION_MAX}),counter=el('span','f-counter');
  counter.id=prefix+'-counter';const count=()=>{counter.textContent=nf(description.input.value.length)+' / '+nf(DESCRIPTION_MAX);};description.input.addEventListener('input',count);
  const link=external?input('pgFormUrl','formUrl',{value:start.formUrl||'',type:'url',required:true,max:2000}):null;
  // Schedule lines: a free-text time and a title each, numbered by place; the first cannot move up, the last cannot move down, twelve at most.
  // A line's title is offered as a question's talk in Conversations, which takes 180 characters (fiiu_questions.talk), so the line takes no more.
  const schedule=el('fieldset','f-programme-schedule'),lineList=el('ol','f-programme-lines'),lines=[];let lineCount=0;
  const addLine=button('pgAddLine',()=>{const line=newLine('','');lines.push(line);layoutLines();line.when.input.focus();},'f-button secondary f-small');
  function newLine(time,name){
   const item=el('li','f-programme-line'),label=el('p','f-programme-line-label'),tools=el('div','f-programme-line-tools'),when=field('pgSessionTime',{value:time,max:40}),what=field('pgSessionTitle',{value:name,max:180,required:true}),line={item,label,when,what};
   label.id=prefix+'-line'+(++lineCount);when.input.name='sessionTime';what.input.name='sessionTitle';when.input.id=label.id+'-time';what.input.id=label.id+'-title';item.setAttribute('role','group');item.setAttribute('aria-labelledby',label.id);
   line.up=button('pgMoveUp',()=>moveLine(line,-1),'f-line-button');line.down=button('pgMoveDown',()=>moveLine(line,1),'f-line-button');line.remove=button('pgRemoveLine',()=>dropLine(line),'f-line-button');
   for(const b of [line.up,line.down,line.remove])describe(b,label.id);tools.append(line.up,line.down,line.remove);item.append(label,when.wrap,what.wrap,tools);return line;
  }
  function layoutLines(){lines.forEach((line,i)=>{line.label.replaceChildren(tr('span','pgLine'),document.createTextNode(' '+(i+1)));line.up.disabled=i===0;line.down.disabled=i===lines.length-1;});lineList.replaceChildren(...lines.map(line=>line.item));addLine.disabled=lines.length>=SCHEDULE_MAX;}
  // Moving re-attaches the lines, which drops focus; it returns to the moved line's button, or to its other one once the line reaches an end.
  function moveLine(line,step){const i=lines.indexOf(line),j=i+step;if(j<0||j>=lines.length)return;[lines[i],lines[j]]=[lines[j],lines[i]];layoutLines();const same=step<0?line.up:line.down;(same.disabled?(step<0?line.down:line.up):same).focus();}
  function dropLine(line){const i=lines.indexOf(line);lines.splice(i,1);layoutLines();const next=lines[i]||lines[i-1];(next?next.what.input:addLine).focus();}
  const setLines=list=>{lines.length=0;for(const [time,name] of list)lines.push(newLine(time,name));layoutLines();};setLines(start.sessions);
  // raw: the fields as typed; values: what a save sends, the two times joined as the server writes them.
  const raw=()=>({title:title.input.value,date:date.input.value,start:from.input.value,end:to.input.value,venue:venue.input.value,description:description.input.value,sessions:lines.map(line=>[line.when.input.value,line.what.input.value]),...(link?{formUrl:link.input.value}:{})});
  const timeOf=(a,b)=>a&&b?`${a}–${b}`:a||(b?'–'+b:'');
  const values=()=>{const typed=raw();return {title:typed.title,date:typed.date,time:timeOf(typed.start,typed.end),venue:typed.venue,description:typed.description,sessions:typed.sessions,...(link?{formUrl:typed.formUrl}:{})};};
  // Warnings before Save: certificate hours follow a check-in block's times, and a block whose Lima day has started moves its check-in at once.
  const warnings=el('div','f-programme-warnings'),hours=el('p','f-programme-warning'),dayStarted=tr('p','pgWindowWarning','f-programme-warning');warnings.setAttribute('aria-live','polite');warnings.append(hours,dayStarted);
  const warn=()=>{const moved=checkin&&(date.input.value!==start.date||timeOf(from.input.value,to.input.value)!==start.time),people=Number.isSafeInteger(start.checkedIn)?start.checkedIn:0;hours.hidden=!(moved&&people>0);hours.textContent=hours.hidden?'':plural('pgHoursWarning',people);dayStarted.hidden=!(moved&&limaDate()>=start.date);};
  const syncTimes=()=>{to.setRequired(checkin&&Boolean(from.input.value));from.setRequired(Boolean(to.input.value));warn();};
  for(const control of [date.input,from.input,to.input])for(const type of ['input','change'])control.addEventListener(type,syncTimes);
  const opened=raw(),initial=JSON.stringify(values()),latest={};
  // Reopened after a conflict: the latest version with the fields changed here put back, so it still counts as unsaved. Where the other organiser
  // changed the same field, their saved value is shown under it to compare.
  if(draft){
   const set={title:v=>{title.input.value=v;},date:v=>{date.input.value=v;},start:v=>{from.input.value=v;},end:v=>{to.input.value=v;},venue:v=>{venue.input.value=v;},description:v=>{description.input.value=v;},sessions:setLines,formUrl:v=>{if(link)link.input.value=v;}};
   for(const [name,value] of Object.entries(draft.kept))set[name]?.(value);
   for(const name of new Set(Object.keys(draft.kept).map(name=>['start','end'].includes(name)?'time':name))){
    const value=start[name];if(JSON.stringify(value??'')===JSON.stringify(draft.base[name]??''))continue;
    const note=el('p','f-question-latest'),shown=name==='date'?[dateNode(value,'span','short')]:name==='time'?timeParts(value):name==='sessions'?[source('span',value.map(([time,what])=>time?time+' '+what:what).join(' · '))]:[source('span',value)];
    note.id=prefix+'-latest-'+name;note.append(tr('span','questionLatest','f-question-latest-label'),document.createTextNode(' '),...(value?.length?shown:[tr('span','pgEmptyValue')]));latest[name]=note;
   }
  }
  const describeBy=(control,...ids)=>{const list=ids.filter(Boolean);if(list.length)control.setAttribute('aria-describedby',list.join(' '));};
  describeBy(title.input,latest.title?.id);describeBy(date.input,latest.date?.id);for(const f of [from,to])describeBy(f.input,timeHint.id,latest.time?.id);describeBy(venue.input,latest.venue?.id);describeBy(description.input,counter.id,latest.description?.id);if(link)describeBy(link.input,latest.formUrl?.id);
  const after=name=>latest[name]?[latest[name]]:[];
  schedule.append(tr('legend','pgSessions'),tr('p','pgSessionsHint','f-muted f-programme-hint'),lineList,...after('sessions'),addLine);
  const save=button('pgSave',null,'f-button');save.type='submit';buttons.append(save,button('pgCancel',()=>closeProgrammeEdit(entry),'f-button secondary f-small'));
  // The two times are one field: a start or an end changed here keeps both, so the form never pairs this end with the other organiser's start.
  const reload=async()=>{const typed=raw(),kept=Object.fromEntries(Object.entries(typed).filter(([name,value])=>JSON.stringify(value)!==JSON.stringify(opened[name])));if('start' in kept||'end' in kept)Object.assign(kept,{start:typed.start,end:typed.end});await reloadBlock(start.id);status(entry.note,'');openProgrammeEdit(entry,true,{kept,base:start});};
  // Restoring deletes the edit, after a confirmation; the row then shows the built-in values.
  if(isEdited(start)){
   const restore=button('pgRestore',async()=>{
    if(busy||!window.confirm(t('pgRestoreConfirm')))return;const unlock=lockForm(form,()=>entry.edit);busy=true;
    try{await action(restore,async()=>{let result;try{result=await api('/api/admin/fiiu/programme/'+encodeURIComponent(start.id)+'?version='+editor.version,{},'DELETE');}catch(err){throw refusal(err);}if(!validBlock(result?.activity)||result.activity.id!==start.id)throw Object.assign(Error(t('error')),{key:'error'});closeProgrammeEdit(entry);applyBlock(result.activity);},{feedback:entry.note,conflict,reload,done:'pgRestored'});}
    finally{busy=false;unlock();}
   },'f-text-link f-programme-restore');
   buttons.append(restore);
  }
  form.append(title.wrap,...after('title'),date.wrap,...after('date'),times,timeHint,...after('time'),venue.wrap,...after('venue'),description.wrap,counter,...after('description'),schedule,...(link?[link.wrap,...after('formUrl')]:[]),warnings,buttons,conflict);
  localiseValidation(form);count();syncTimes();
  // A day typed into the date's segments can fall outside the festival (min and max only limit the picker). The browser then stops the save before
  // the submit handler runs, and the form's generic message would name required fields and links: the date's own message replaces it.
  date.input.addEventListener('invalid',()=>{const validity=date.input.validity;if(validity?.rangeOverflow||validity?.rangeUnderflow)date.input.setCustomValidity(t('pgInvalidDate'));});
  // Saving sends every field with the version the form started from. A refusal keeps the form open with everything typed.
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(busy)return;
   const a=from.input.value,b=to.input.value;
   for(const control of [title.input,...lines.map(line=>line.what.input)])control.setCustomValidity(control.value.trim()?'':t('requiredField'));
   from.input.setCustomValidity(!a&&b?t('pgStartRequired'):'');to.input.setCustomValidity(a&&b&&b<=a?t('pgEndAfterStart'):checkin&&a&&!b?t('pgEndRequired'):'');
   if(!form.reportValidity())return;
   const payload={...values(),version:editor.version},unlock=lockForm(form,()=>entry.editor?.form.querySelector('input')||entry.edit);busy=true;
   try{await action(save,async()=>{let result;try{result=await api('/api/admin/fiiu/programme/'+encodeURIComponent(start.id),payload,'PUT');}catch(err){throw refusal(err);}if(!validBlock(result?.activity)||result.activity.id!==start.id)throw Object.assign(Error(t('error')),{key:'error'});closeProgrammeEdit(entry);applyBlock(result.activity);},{feedback:entry.note,conflict,reload});}
   finally{busy=false;unlock();}
  });
  return Object.assign(editor,{dirty:()=>JSON.stringify(values())!==initial,recount:()=>{count();warn();},warn});
 }
 // A block's check-in count comes with the programme read, which runs at load, with a save and with a conflict's reload; the totals bring a newer one
 // with every refresh and attendance tick. That count goes onto the block, so an open form's hours warning names everyone checked in so far.
 function syncCheckins(summary){
  if(!programme)return;const counts=new Map(summary.activities.map(row=>[row.activityId,row.attendance]));
  for(const a of programme){const n=counts.get(a.id);if(Number.isSafeInteger(n)&&n>=0)a.checkedIn=n;}
  for(const entry of programmeRows.values())entry.editor?.warn();
 }
 // "Reload the latest version" re-reads the programme and takes only this block from it, so other rows keep what they show.
 async function reloadBlock(id){const latest=(await readProgramme()).find(a=>a.id===id);if(!latest)throw Object.assign(Error(t('pgNotFound')),{key:'pgNotFound'});if(locked)return;applyBlock(latest);}
 function programmePanel(){const heading=tr('h2','programmeSection');heading.id='f-h-programme';programmeHost.id='programme';programmeAlert.setAttribute('role','status');programmeHost.replaceChildren(heading,tr('p','pgHint','f-muted f-section-hint'),programmeAlert,programmeList);renderProgramme();return programmeHost;}
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
 // A rating question carries its ten totals (index 0 for a score of 1); anything else there reads as a failed read, never as numbers.
 const validTotals=counts=>Array.isArray(counts)&&counts.length===10&&counts.every(n=>Number.isSafeInteger(n)&&n>=0),isRating=q=>q?.kind==='rating';
 const validQuestion=q=>Boolean(q)&&typeof q.id==='string'&&typeof q.activityId==='string'&&Number.isSafeInteger(q.version)&&QUESTION_STATUSES.some(([value])=>value===q.status)&&[undefined,'chat','rating'].includes(q.kind)&&(q.ratingCounts==null||validTotals(q.ratingCounts));
 const countText=(base,n)=>n===1?t(base+'One'):fill(base,{n:nf(n)});
 function questionDraft(){return Boolean(newQuestion?.dirty())||[...questionRows.values()].some(entry=>entry.editor?.dirty());}
 async function readQuestions(){const data=await api('/api/admin/fiiu/questions');if(!Array.isArray(data.questions)||!data.questions.every(validQuestion))throw Object.assign(Error(t('error')),{key:'error'});return data.questions;}
 // A read that started before one of this page's saves can land after it: the newer local version wins, and a question created meanwhile stays.
 function mergeQuestions(list){const known=new Map((questions||[]).map(q=>[q.id,q])),merged=list.map(q=>{const old=known.get(q.id);known.delete(q.id);return old&&old.version>q.version?{...old,stats:q.stats??old.stats,ratingCounts:q.ratingCounts??old.ratingCounts}:q;});return [...merged,...known.values()];}
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
  const order=new Map(chronological(festival.event.activities).map((a,i)=>[a.id,i])),rank=q=>q.activityId==='general'?-1:order.get(q.activityId)??order.size;
  const sorted=[...questions].sort((a,b)=>rank(a)-rank(b)||a.activityId.localeCompare(b.activityId)||String(a.createdAt).localeCompare(String(b.createdAt)));
  for(const q of sorted){const entry=questionRows.get(q.id)||questionEntry(q.id);entry.record=q;entry.update();}
  // The same questions in the same places are only updated, so a timed refresh never moves focus or an open edit.
  const layout=JSON.stringify(sorted.map(q=>[q.activityId,q.id]));if(layout===questionLayout)return;questionLayout=layout;
  const active=document.activeElement,refocus=active?.id&&questionList.contains?.(active)?active.id:'',groups=[];
  for(const q of sorted){if(groups.at(-1)?.activityId!==q.activityId)groups.push({activityId:q.activityId,rows:[]});groups.at(-1).rows.push(questionRows.get(q.id).row);}
  questionList.replaceChildren(...groups.map(({activityId,rows})=>{
   const group=el('div','f-question-group'),heading=el('h3','f-question-block'),list=el('ul','f-questions'),activity=findActivity(festival.event,activityId);heading.id='f-qb-'+activityId;
   if(activityId==='general')heading.append(tr('span','questionGeneral'));else if(activity)heading.append(dateNode(activity.date,'span','short','f-question-day'),source('span',activity.title));else heading.append(el('span','',activityId));
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
  const edit=entry.edit=button('editQuestion',()=>openQuestionEdit(entry),'f-button secondary f-small'),chat=link('openChat','fiiu-talk.html?q='+path,'f-text-link'),present=link('present','fiiu-talk.html?q='+path+'&present=1','f-text-link');
  // The chat and the projector open in new tabs, so moderating never leaves a draft behind here; the CSV is fetched like the registrations
  // export, so an ended session, a rate limit or an outage is reported here instead of a cancelled download.
  const csv=button('downloadCsv',()=>fetchInto(csv,()=>downloadExport('/api/admin/fiiu/questions/'+path+'/export','fiiu-conversation.csv')),'f-text-link');
  // A rating question also shows its totals, and offers them as a CSV built here from the totals on the page.
  const totals=el('div','f-rating'),counts=button('ratingCsv',()=>downloadRating(entry.record),'f-text-link');
  edit.id=text.id+'-edit';for(const a of [chat,present]){a.target='_blank';a.rel='noopener';}for(const node of [edit,chat,present,csv,counts])describe(node,text.id);
  links.append(edit,chat,present,csv,counts);controls.append(label,group,links);view.append(text,meta,totals);row.append(view,controls,note,conflict);
  entry.update=()=>{
   const q=entry.record,stats=q.stats||{},count=(base,n)=>el('span','f-question-count',countText(base,Number.isSafeInteger(n)&&n>=0?n:0));row.className='f-question is-'+q.status;text.textContent=q.body;
   meta.replaceChildren(...(q.talk?[source('span',q.talk,'f-question-talk')]:[]),count('questionMessages',stats.messages??q.messageCount),count('questionPeople',stats.people),count('questionLikes',stats.likes),...(isRating(q)?[tr('span','questionKindRating','f-chip f-question-kind')]:[]));
   totals.hidden=counts.hidden=!isRating(q);if(isRating(q))ratingTotals(totals,q.ratingCounts);else totals.replaceChildren();
   for(const [value,choice] of entry.buttons)choice.setAttribute('aria-pressed',String(value===q.status));
  };
  questionRows.set(id,entry);return entry;
 }
 // A rating's totals: the average to one decimal and how many rated, over a strip of ten counts. The drawn counts, bars and scores are hidden from
 // assistive technology, which hears one sentence per score instead ("4 people chose 10"). Before any answer it says so instead.
 function ratingTotals(box,counts){
  const list=validTotals(counts)?counts:Array(10).fill(0),people=list.reduce((sum,n)=>sum+n,0);
  if(!people){box.replaceChildren(tr('p','ratingNone','f-muted f-rating-none'));return;}
  const average=list.reduce((sum,n,i)=>sum+n*(i+1),0)/people,top=Math.max(...list),line=el('p','f-rating-line'),bars=el('ol','f-rating-bars');
  line.append(tr('span','ratingAverage'),document.createTextNode(' '),el('strong','f-rating-average',new Intl.NumberFormat(locale(),{minimumFractionDigits:1,maximumFractionDigits:1}).format(average)),document.createTextNode(' · '),el('span','',plural('ratingPeople',people)));
  bars.setAttribute('aria-label',t('ratingBars'));
  list.forEach((n,i)=>{
   const item=el('li','f-rating-step'+(n?'':' is-zero')),shown=[el('span','f-rating-count',nf(n)),el('span','f-rating-bar'),el('span','f-rating-score',String(i+1))];
   for(const node of shown)node.setAttribute('aria-hidden','true');shown[1].style?.setProperty?.('--share',String(n/top));
   item.append(...shown,el('span','f-sr-only',fill(n===1?'ratingBarOne':'ratingBarMany',{n:nf(n),score:String(i+1)})));bars.append(item);
  });
  box.replaceChildren(line,bars);
 }
 // The counts CSV: score,count for 1 to 10, saved like the server's CSVs (a byte-order mark, so spreadsheets read it as UTF-8, and CRLF lines).
 function downloadRating(q){
  const list=validTotals(q.ratingCounts)?q.ratingCounts:Array(10).fill(0),rows=['score,count',...list.map((n,i)=>`${i+1},${n}`)];
  try{saveFile(new Blob(['\uFEFF'+rows.join('\r\n')],{type:'text/csv;charset=utf-8'}),'fiiu-rating-'+q.id.slice(0,8)+'.csv');}catch{reportError(message,Object.assign(Error(t('error')),{key:'error'}));}
 }
 // The switch stays focusable while a change saves (a press meanwhile is ignored), so focus never drops to the page. Closing asks first;
 // a conflict offers the latest version, which re-reads the list.
 async function setQuestionStatus(entry,next){
  const q=entry.record;if(entry.busy||q.status===next)return;
  if(next==='closed'&&!window.confirm(t('closeQuestionConfirm')))return;
  // Hiding takes a live or answered question off every phone and the projector at once; a prepared one hides without asking.
  if(next==='hidden'&&(q.status==='open'||(q.stats?.messages??q.messageCount??0)>0)&&!window.confirm(t('hideQuestionConfirm')))return;
  entry.busy=true;entry.group.setAttribute('aria-busy','true');
  const reload=async()=>{await reloadQuestions();entry.conflict.replaceChildren();status(entry.note,'');entry.buttons.get(entry.record.status)?.focus();};
  // An edit of this question that started from the version this change replaces moves to the new one, so saving it is no conflict with itself.
  try{await action(null,async()=>{const result=await api('/api/admin/fiiu/questions/'+encodeURIComponent(q.id),{version:q.version,status:next},'PATCH');if(!validQuestion(result.question))throw Object.assign(Error(t('error')),{key:'error'});if(entry.editor?.version===q.version)entry.editor.version=result.question.version;upsertQuestion(result.question);},{feedback:entry.note,conflict:entry.conflict,reload,done:'questionSaved'});}
  finally{entry.busy=false;entry.group.setAttribute('aria-busy','false');}
 }
 function openQuestionEdit(entry,focus=true,draft=null){if(entry.editor)closeQuestionEdit(entry,false);entry.editor=questionEditor(entry,draft);entry.view.replaceWith(entry.editor.form);entry.edit.hidden=true;if(focus)entry.editor.form.querySelector('textarea')?.focus();}
 function closeQuestionEdit(entry,focus=true){if(!entry.editor)return;entry.editor.form.replaceWith(entry.view);entry.editor=null;entry.edit.hidden=false;if(focus)entry.edit.focus();}
 // One form for a new question and for an edit of a saved one, whose block cannot change. A new question keeps one id across retries (as a new
 // publication does), so a save whose answer was lost gets the stored question back instead of a duplicate; the id is renewed once it saves.
 // draft: what an edit that met a conflict had typed ({body, talk}) and the record it started from (base); see send's reload.
 function questionEditor(entry=null,draft=null){
  const start=entry?.record,isNew=!start,prefix=isNew?'f-qn':'f-qe-'+start.id,form=el('form','f-form f-question-form'),counter=el('span','f-counter'),buttons=el('div','f-question-buttons'),conflict=el('div','f-conflict');let busy=false,draftId=null;
  // version is the one an edit started from; a status change made on this page meanwhile moves it along (setQuestionStatus).
  const editor={form,version:start?.version};
  const block=el('select'),talkField=field('questionTalk'),talk=el('select'),text=field('questionText',{type:'textarea',max:QUESTION_MAX,required:true,value:start?.body});
  talk.name='talk';talk.id=prefix+'-talk';talkField.input.replaceWith(talk);text.input.name='body';text.input.id=prefix+'-text';counter.id=prefix+'-counter';text.input.setAttribute('aria-describedby',counter.id);
  // The talk choice lists the block's talks and is hidden for a block without any. An edit keeps a saved (or kept draft) talk the programme no
  // longer lists, so saving the text alone never drops it.
  const fillTalks=(activityId,value='',keep=[])=>{
   const names=(findActivity(festival.event,activityId)?.sessions||[]).map(([,name])=>name),none=tr('option','questionNoTalk');none.value='';for(const name of keep)if(name&&!names.includes(name))names.push(name);
   talk.replaceChildren(none,...names.map(name=>{const option=source('option',name);option.value=name;return option;}));talk.value=names.includes(value)?value:'';talkField.wrap.hidden=!names.length;
  };
  const count=()=>{const number=new Intl.NumberFormat(locale());counter.textContent=number.format(text.input.value.length)+' / '+number.format(QUESTION_MAX);};text.input.addEventListener('input',count);count();
  // The type is chosen once, when the question is created: a conversation (the default) or a 1–10 rating. An edit shows it and cannot change it.
  let kinds=[];const kindOf=()=>kinds.find(choice=>choice.checked)?.value||'chat';
  if(isNew){
   // General, the whole festival's space, comes before the blocks; it has no talks.
   const blockField=field('questionBlock',{required:true}),blank=tr('option','choose'),general=tr('option','questionGeneral');block.name='activityId';block.id=prefix+'-block';block.required=true;blank.value='';general.value='general';block.append(blank,general);
   for(const a of chronological(festival.event.activities)){const option=source('option',`${a.date.slice(8)}/${a.date.slice(5,7)} · ${a.title}`);option.value=a.id;block.append(option);}
   blockField.input.replaceWith(block);block.addEventListener('change',()=>fillTalks(block.value,talk.value));
   const choice=el('fieldset','f-kind-choice'),kindHint=tr('p','questionKindHint','f-muted f-kind-hint');kindHint.id=prefix+'-kind-hint';choice.append(tr('legend','questionKind'));
   kinds=[['chat','questionKindChat'],['rating','questionKindRating']].map(([value,key])=>{const wrap=el('label','f-check'),input=el('input');input.type='radio';input.name='kind';input.value=value;input.id=prefix+'-kind-'+value;input.checked=value==='chat';wrap.append(input,tr('span',key));choice.append(wrap);return input;});
   kinds[1].setAttribute('aria-describedby',kindHint.id);choice.append(kindHint);form.append(tr('h3','newQuestion'),blockField.wrap,choice);
  }
  else{const locked=el('p','f-muted f-kind-locked');locked.append(tr('span',isRating(start)?'questionKindRating':'questionKindChat','f-question-kind'),document.createTextNode(' · '),tr('span','questionKindLocked'));form.append(locked);}
  fillTalks(start?.activityId||'',start?.talk||'',isNew?[]:[start.talk]);
  const values=()=>({body:text.input.value.trim(),talk:talk.value||null}),initial=JSON.stringify(values());
  // Reopened on the latest version after a conflict, the edit keeps what was typed (so it still counts as unsaved). When the other change touched
  // the text or the talk, not just the status, the latest saved version is shown under the field to compare.
  let latest=null;
  if(draft){
   text.input.value=draft.body;fillTalks(start.activityId,draft.talk,[start.talk,draft.talk]);count();
   if(draft.base.body!==start.body||(draft.base.talk||null)!==(start.talk||null)){
    latest=el('p','f-question-latest');latest.id=prefix+'-latest';latest.append(tr('span','questionLatest','f-question-latest-label'),document.createTextNode(' '),source('span',start.body),...(start.talk?[document.createTextNode(' · '),source('span',start.talk)]:[]));
    text.input.setAttribute('aria-describedby',counter.id+' '+latest.id);
   }
  }
  const send=async(state,control)=>{
   if(busy)return;text.input.setCustomValidity(values().body?'':t('requiredField'));if(!form.reportValidity())return;
   const payload=isNew?{id:draftId??=uuid(),activityId:block.value,kind:kindOf(),...values(),status:state}:{version:editor.version,...values()},unlock=lockForm(form,()=>isNew?text.input:entry.edit);busy=true;
   // After a conflict on a new question (its id was saved, with other text, by a send whose answer was lost) the list shows the saved one and the
   // draft stays, with a new id for a deliberate second question; an edit reopens on the latest version with its typed text and talk kept.
   const reload=isNew?async()=>{await reloadQuestions();draftId=null;conflict.replaceChildren();text.input.focus();}:async()=>{const kept={body:text.input.value,talk:talk.value,base:start};await reloadQuestions();openQuestionEdit(entry,true,kept);};
   try{await action(control,async()=>{
    const result=await api('/api/admin/fiiu/questions'+(isNew?'':'/'+encodeURIComponent(start.id)),payload,isNew?'POST':'PATCH');if(!validQuestion(result.question))throw Object.assign(Error(t('error')),{key:'error'});
    if(isNew){draftId=null;text.input.value='';count();}else closeQuestionEdit(entry);
    upsertQuestion(result.question);
   },{conflict,reload,done:'questionSaved'});}
   finally{busy=false;unlock();}
  };
  if(isNew){const publish=button('publishNow',()=>send('open',publish),'f-button'),hidden=button('saveHidden',()=>send('hidden',hidden),'f-button secondary');buttons.append(publish,hidden);}
  else{const save=button('saveQuestion',()=>send(null,save),'f-button');buttons.append(save,button('cancelEdit',()=>closeQuestionEdit(entry),'f-button secondary f-small'));}
  form.append(talkField.wrap,text.wrap,counter,...(latest?[latest]:[]),buttons,conflict);localiseValidation(form);form.addEventListener('submit',event=>event.preventDefault());
  return Object.assign(editor,{recount:count,dirty:()=>isNew?Boolean(values().body):JSON.stringify(values())!==initial});
 }
 function conversationsPanel(){
  const heading=tr('h2','conversations'),layout=el('div','f-conversations-layout'),side=el('div','f-question-side');heading.id='f-h-conversations';conversationsHost.id='conversations';
  newQuestion=questionEditor();questionEditorHost.replaceChildren(newQuestion.form);questionAlert.setAttribute('role','status');side.append(questionAlert,questionList);layout.append(questionEditorHost,side);
  conversationsHost.replaceChildren(heading,tr('p','conversationsHint','f-muted f-section-hint'),layout);renderQuestions();return conversationsHost;
 }
 // Page head, section navigation and the current-section marker.
 function adminHead(){
  const event=festival.event,head=el('header','f-admin-head'),title=el('div','f-admin-title'),sub=el('p','f-admin-sub'),side=el('div','f-admin-head-side'),actions=el('div','f-actions'),note=tr('p','exportNote','f-muted f-export-note'),csv=button('export',()=>fetchInto(csv,()=>downloadExport()),'f-button secondary');
  note.id='f-export-note';describe(csv,note.id);sub.append(el('span','',event.title),rangeNode(event.startsOn,event.endsOn),source('span',event.city));title.append(tr('h1','admin'),sub);
  // The public page opens in a new tab, so checking a post never leaves an unsaved draft behind.
  const view=link('viewPublic','fiiu.html','f-text-link');view.target='_blank';view.rel='noopener';describe(view);
  actions.append(pillHost,view,csv);side.append(actions,note);head.append(title,side);return head;
 }
 // The CSVs (registrations, and each question's answers) are fetched rather than linked, so an expired session, a rate limit or an outage is reported here instead of replacing the dashboard.
 // Safari before 16 has no AbortSignal.timeout; there the download runs without the time limit.
 async function downloadExport(url='/api/admin/fiiu/export',fallback='fiiu-registrations.csv'){
  const failed=key=>Object.assign(Error(t(key)),{key});let blob,name;
  try{const response=await fetch(url,{signal:globalThis.AbortSignal?.timeout?.(60000)});if(!response.ok)throw Object.assign(failed(({401:'unauthorized',403:'forbidden',429:'rate'})[response.status]||'error'),{status:response.status});name=/filename="([^"]+)"/.exec(response.headers.get('Content-Disposition')||'')?.[1];blob=await response.blob();}
  catch(err){throw err?.key?err:failed('error');}
  saveFile(blob,name||fallback);
 }
 // Hands the browser a file to save: a temporary link to the file, clicked and removed; the file's address is released a minute later.
 function saveFile(blob,name){const href=URL.createObjectURL(blob),a=el('a');a.href=href;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),60000);}
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
  for(const section of [summaryHost,checkinHost,participantsHost,settingsHost,programmeHost,contentHost,conversationsHost])observer.observe(section);
 }
 // A section link (#participants, kept through a reload or a return from sign-in) is reached once the sections above it have filled in: the totals,
 // the questions, the summary emails and the other participant pages push it down by thousands of pixels. One instant jump (html scrolls smoothly,
 // which would aim at the old place); someone who already scrolled, tapped or typed is left where they are, and later refreshes never scroll.
 const sectionHosts=()=>({overview:summaryHost,checkin:checkinHost,participants:participantsHost,settings:settingsHost,programme:programmeHost,content:contentHost,conversations:conversationsHost});
 const sectionId=location.hash.slice(1),wantsSection=SECTIONS.some(([id])=>id===sectionId);let movedOn=false;
 if(wantsSection){
  // The browser's own restoration would put a reload back where it was in a far shorter page; the section is the place to be.
  if(globalThis.history)history.scrollRestoration='manual';
  for(const type of ['wheel','touchstart','pointerdown','keydown'])window.addEventListener?.(type,()=>{movedOn=true;},{once:true,passive:true});
 }
 function reachSection(filled){if(wantsSection)Promise.allSettled(filled).then(()=>{if(!movedOn&&!locked)sectionHosts()[sectionId]?.scrollIntoView({block:'start',behavior:'instant'});});}
 async function load(){
  status(message,'loading');const summaryRequest=api('/api/admin/fiiu/summary').then(data=>({data}),error=>({error})),questionsRequest=readQuestions().then(list=>({list}),error=>({error})),programmeRequest=readProgramme().then(list=>({list}),error=>({error}));try{const [settingsData,posts,participantData]=await Promise.all([api('/api/admin/fiiu/config'),api('/api/admin/fiiu/content'),api('/api/admin/fiiu/registrations')]);festival={event:settingsData.event};config=settingsData.config;publications=posts.content;contentCursor=posts.nextCursor;setRecords(participantData.registrations);cursor=participantData.nextCursor;
   const grid=el('div','f-admin-columns');grid.append(listHost,detailHost);detailHost.replaceChildren(tr('p','selectParticipant','f-muted f-detail-empty'));const heading=tr('h2','participants');heading.id='f-h-participants';participantsHost.id='participants';participantsHost.replaceChildren(heading,filters(),grid);
   root.replaceChildren(adminHead(),sessionNotice,adminNav(),summaryPanel(),checkinPanel(),participantsHost,settings(),programmePanel(),contentPanel(),conversationsPanel(),newTabNote());renderRegistrationPill();
   const filled=[readParticipants()];renderList();status(message,'');filled.push(refreshSummary({pending:summaryRequest}),refreshQuestions({pending:questionsRequest}),refreshProgramme({pending:programmeRequest}));for(const pass of emailPasses){pass.render();filled.push(pass.load());}setTitle();observeSections();
   reachSection(filled);
  }catch(error){
   // Signed out before the dashboard loaded: sign in and come straight back. Signed in without organiser access: the organisers-only state, with no Retry.
   if(error.status===401){status(message,'');location.assign(signInUrl());return;}
   if(guard(error))return;
   status(message,error.key==='error'?Object.assign(Error(t('loadError')),{key:'loadError'}):error);root.replaceChildren(button('retry',load),newTabNote());
  }
 }
 // Rows on screen are translated in place; rows kept for later filters are rebuilt in the new language.
 window.nodalI18n?.onChange(()=>{
  // fiiu-ui retranslates #fiiuStatus and the row notes through textContent, which drops the expired session's sign-in link.
  for(const node of [message,...root.querySelectorAll('.f-inline-status')])if(['unauthorized','attendanceSignIn'].includes(node.dataset.fiiuText)&&!node.querySelector('a'))node.append(document.createTextNode(' '),signInLink());
  if(locked)return;rowCache=new WeakMap();setTitle();stampUpdated();recount?.();for(const pass of emailPasses)pass.render();newQuestion?.recount();for(const entry of questionRows.values())entry.editor?.recount();for(const entry of programmeRows.values())entry.editor?.recount();renderQuestions();if(lastSummary)renderSummary(lastSummary);else renderCheckin();});
 timer=setInterval(()=>{
  if(!festival||locked||sessionLost||document.visibilityState!=='visible')return;
  // An email block whose cap has reset reads its state again (a pass that ended at the cap leaves no stale message behind).
  // The question totals follow the summary totals, so a lost session the summary finds pauses them too.
  return Promise.all([...emailPasses.map(pass=>pass.tick()).filter(Boolean),...(autoRefresh.input.checked?[refreshSummary({background:true}).then(()=>refreshQuestions({background:true}))]:[])]);
 },60000);
 load();
})();
