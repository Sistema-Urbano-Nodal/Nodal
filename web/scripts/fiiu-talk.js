(() => {
 'use strict';
 // Festival conversations. ?q= opens one organiser question on a FIIU block with its live chat; ?a= lists a block's questions and opens a single one at once.
 // Live updates poll the public, CDN-cached pulse every 4 s and fetch only the changes since the shown revision, then patch rows in place: the composer,
 // focus and scroll position are never rebuilt. People registered for the festival and organisers take part; anyone else is told how to.
 // Organisers also hide and unhide messages here, and ?q=…&present=1 gives them a projector view of the question with a QR code to join.
 const Fiiu=window.Fiiu,{t,el,tr,button,link,source,api,status,dateNode,limaClock,limaDate,newTabNote,locale}=Fiiu;
 // Page-only strings join the shared dictionary, so t(), tr() and the language switch in fiiu-ui.js handle them like the rest.
 Object.assign(Fiiu.rows,{
  talkPage:['Conversation','Conversación','Conversa'],talkQuestions:['Questions on this block','Preguntas de este bloque','Perguntas deste bloco'],talkOtherQuestions:['More questions on this block','Más preguntas de este bloque','Mais perguntas deste bloco'],
  talkEmpty:['No messages yet. Be the first to answer.','Todavía no hay mensajes. Sé la primera persona en responder.','Ainda não há mensagens. Seja a primeira pessoa a responder.'],
  talkEmptyBlock:['No questions yet for this block.','Todavía no hay preguntas para este bloque.','Ainda não há perguntas para este bloco.'],
  talkPlaceholder:['Write your answer…','Escribe tu respuesta…','Escreva sua resposta…'],talkSend:['Send','Enviar','Enviar'],talkSending:['Sending…','Enviando…','Enviando…'],talkNotSent:['Not sent','No enviado','Não enviada'],talkRetry:['Retry','Reintentar','Tentar de novo'],talkYou:['You','Tú','Você'],
  talkAttach:['Add image or PDF','Adjuntar imagen o PDF','Anexar imagem ou PDF'],talkRemoveFile:['Remove','Quitar','Remover'],talkUploading:['Uploading {current} of {total}…','Subiendo {current} de {total}…','Enviando {current} de {total}…'],
  talkFileType:['Use JPG, PNG, WebP or PDF.','Usa JPG, PNG, WebP o PDF.','Use JPG, PNG, WebP ou PDF.'],talkFileSize:['Each file can be up to 3 MB.','Cada archivo puede pesar hasta 3 MB.','Cada arquivo pode ter até 3 MB.'],
  talkTooManyFiles:['Up to 3 files per message.','Hasta 3 archivos por mensaje.','Até 3 arquivos por mensagem.'],
  talkAllowance:['You have reached the festival upload limit (30 files or 30 MB).','Llegaste al límite de archivos del festival (30 archivos o 30 MB).','Você atingiu o limite de arquivos do festival (30 arquivos ou 30 MB).'],
  talkCharsLeft:['{n} characters left','Quedan {n} caracteres','Restam {n} caracteres'],talkCharLeft:['1 character left','Queda 1 carácter','Resta 1 caractere'],talkCharsOver:['{n} characters over the limit','{n} caracteres por encima del límite','{n} caracteres acima do limite'],
  talkTooLong:['Your answer is over 1,000 characters. Shorten it to send it.','Tu respuesta pasa de 1000 caracteres. Acórtala para enviarla.','Sua resposta passa de 1.000 caracteres. Encurte-a para enviar.'],
  talkLike:['Like','Me gusta','Curtir'],talkLikes:['{n} likes','{n} me gusta','{n} curtidas'],talkLikeOne:['1 like','1 me gusta','1 curtida'],talkDelete:['Delete','Eliminar','Apagar'],
  talkDeleteConfirm:['Delete this message for everyone?','¿Eliminar este mensaje para todas las personas?','Apagar esta mensagem para todos?'],talkOrganiser:['FIIU organisers','Organización FIIU','Organização FIIU'],
  talkClosed:['This conversation is closed. You can still read it.','Esta conversación está cerrada. Puedes seguir leyéndola.','Esta conversa está encerrada. Você ainda pode lê-la.'],talkClosedChip:['Closed','Cerrada','Encerrada'],
  talkUnavailable:['This conversation isn’t available.','Esta conversación no está disponible.','Esta conversa não está disponível.'],
  talkSignIn:['Sign in to join the conversation','Inicia sesión para participar','Entre para participar da conversa'],
  talkSignInHint:['Conversations are open to people registered for FIIU Fest 11.','Las conversaciones están abiertas a las personas inscritas en el FIIU Fest 11.','As conversas são abertas a quem se inscreveu no FIIU Fest 11.'],
  talkRegister:['Register for FIIU to join','Inscríbete en el FIIU para participar','Inscreva-se no FIIU para participar'],talkRegisterHint:['Registering is free and takes two minutes.','La inscripción es gratuita y toma dos minutos.','A inscrição é gratuita e leva dois minutos.'],
  talkNew:['New messages ↓','Mensajes nuevos ↓','Novas mensagens ↓'],
  talkNewOne:['1 new answer from {author}','1 respuesta nueva de {author}','1 nova resposta de {author}'],talkNewMany:['{n} new answers','{n} respuestas nuevas','{n} novas respostas'],
  talkDeleted:['Message deleted','Mensaje eliminado','Mensagem apagada'],talkLoadEarlier:['Load earlier messages','Cargar mensajes anteriores','Carregar mensagens anteriores'],
  talkPaused:['Live updates paused. Reconnecting…','Actualizaciones en pausa. Reconectando…','Atualizações pausadas. Reconectando…'],
  talkPausedOffline:['No connection. Updates come back on their own once you have signal.','Sin conexión. Las actualizaciones vuelven solas cuando recuperes la señal.','Sem conexão. As atualizações voltam sozinhas quando o sinal voltar.'],
  talkOffline:['No connection. Try again once you have signal.','Sin conexión. Inténtalo de nuevo cuando tengas señal.','Sem conexão. Tente de novo quando tiver sinal.'],
  talkOfflineSend:['No connection. Your message is still here: tap Retry once you have signal.','Sin conexión. Tu mensaje sigue aquí: toca Reintentar cuando vuelvas a tener señal.','Sem conexão. Sua mensagem continua aqui: toque em Tentar de novo quando tiver sinal.'],
  talkHide:['Hide','Ocultar','Ocultar'],talkUnhide:['Unhide','Mostrar','Mostrar'],talkHidden:['Hidden','Oculto','Oculta'],talkHiddenForYou:['Hidden by the organisers','Oculto por la organización','Ocultada pela organização'],talkBackToBlock:['All questions on this block','Todas las preguntas de este bloque','Todas as perguntas deste bloco'],
  talkOpenFull:['Open full image','Abrir imagen completa','Abrir imagem completa'],talkError:['Something went wrong. Try again.','Algo salió mal. Inténtalo de nuevo.','Algo deu errado. Tente de novo.'],
  talkRate:['Too many messages at once. Wait a moment and try again.','Demasiados mensajes seguidos. Espera un momento e inténtalo de nuevo.','Muitas mensagens de uma vez. Aguarde um momento e tente de novo.'],
  talkReused:['This message could not be finished. Retry to send it as a new message.','No se pudo terminar de enviar este mensaje. Reintenta para enviarlo como un mensaje nuevo.','Não foi possível terminar de enviar esta mensagem. Tente de novo para enviá-la como uma nova mensagem.'],
  talkNotRegistered:['You need a FIIU registration to take part.','Necesitas una inscripción en el FIIU para participar.','Você precisa de uma inscrição no FIIU para participar.'],
  talkPresent:['Projector view','Vista de proyección','Modo de projeção'],talkLatest:['Latest','Recientes','Recentes'],talkTop:['Most liked','Con más me gusta','Mais curtidas'],talkFullscreen:['Full screen','Pantalla completa','Tela cheia'],
  talkScanToJoin:['Scan to join the conversation','Escanea para unirte a la conversación','Escaneie para entrar na conversa'],
  talkScanToRead:['Scan to read the conversation','Escanea para leer la conversación','Escaneie para ler a conversa'],talkOpensSoon:['The conversation opens soon','La conversación se abrirá en breve','A conversa será aberta em breve'],
  // A question is feminine in Spanish and Portuguese (la pregunta, a pergunta), a message masculine in Spanish (el mensaje): each gets its own chip.
  talkHiddenQuestion:['Hidden','Oculta','Oculta'],
  talkEmptyClosed:['This question closed without answers.','Esta pregunta se cerró sin respuestas.','Esta pergunta foi encerrada sem respostas.'],
  talkEmptyHidden:['No messages yet. Participants can answer once the question opens.','Todavía no hay mensajes. Se podrá responder cuando la pregunta se abra.','Ainda não há mensagens. Será possível responder quando a pergunta for aberta.'],
  talkNextOpen:['Answer the open question','Responder la pregunta abierta','Responder à pergunta aberta'],
  talkDraftKept:['Your unsent answer:','Tu respuesta sin enviar:','Sua resposta não enviada:'],talkDiscardDraft:['Discard','Descartar','Descartar'],
 });
 const root=document.getElementById('fiiuTalkRoot'),message=document.getElementById('fiiuStatus');
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,ID=/^[a-z0-9-]{1,60}$/;
 const LIMIT=1000,FILES=3,MAX=3*1024*1024,THUMB=100*1024,POLL=4000,WATCH_MS=8000,WATCH_FOR=2*3600000,NEAR=120,NAME=120,UPLOAD_MS=120000,TYPES=['image/jpeg','image/png','image/webp','application/pdf'],IMAGES=TYPES.slice(0,3);
 // The projector: answers on screen at most, the question length above which its headline steps down so they still fit, and the room left under the
 // last row of answers.
 const WALL=12,LONG=160,FIT_MARGIN=8,SVG='http://www.w3.org/2000/svg';
 // A file refused for what it is (type, size, the festival allowance), or a sender without a registration, is the draft's problem: the row goes and the
 // composer says why, since Retry cannot help.
 const DRAFT=['talkFileType','talkFileSize','talkAllowance','talkTooManyFiles','talkNotRegistered'];
 let question=null,activity=null,me={organiser:false,canPost:false},before=null,known=0,parts=null,composer=null;
 let timer=null,busy=false,failures=0,nextAt=0,watcher=null,dockObserver=null;
 // present: the address asked for the projector (?q=…&present=1); wall: its parts while an organiser is shown it; order: 'latest' or 'top'.
 let present=false,wall=null,order='latest',lock=null,waking=false;
 // liked: the messages this viewer likes. Changes carry no liked flag (one answer serves every viewer), so the page keeps its own: seeded by each full read,
 // then moved by its own likes. liking: the outcome each like on its way will show, by message.
 const views=new Map(),rowsById=new Map(),attempts=new Map(),uploads=new Map(),liked=new Set(),liking=new Map(),moderating=new Set();
 const problem=key=>Object.assign(Error(t(key)),{key});
 const fill=(key,vars)=>t(key).replace(/\{(\w+)\}/g,(all,name)=>name in vars?String(vars[name]):all);
 // Text with a number in it keeps its key and values, so a language switch can rewrite it (refresh() in fiiu-ui.js only knows plain keys).
 function setCount(node,key,vars={}){node.dataset.talkKey=key;node.dataset.talkVars=JSON.stringify(vars);node.textContent=fill(key,vars);return node;}
 const counted=(tag,cls,key,vars)=>setCount(el(tag,cls+' f-talk-n'),key,vars);
 const sizeText=bytes=>bytes<1048576?Math.max(1,Math.round(bytes/1024))+' KB':new Intl.NumberFormat(locale(),{maximumFractionDigits:1}).format(bytes/1048576)+' MB';
 const sizeNode=bytes=>{const node=el('span','f-talk-size',sizeText(bytes));node.dataset.talkSize=String(bytes);return node;};
 const codePoints=text=>[...text].length;
 const setTitle=()=>{document.title='NODAL · '+t(wall?'talkPresent':'talkPage');};
 // The server's refusal codes, each with its own explanation; anything else is "Something went wrong" (a Map, so no code can name an Object property).
 const CODES=new Map(Object.entries({upload_allowance:'talkAllowance',file_type:'talkFileType',too_many_files:'talkTooManyFiles',file_size:'talkFileSize',question_closed:'talkClosed',not_registered:'talkNotRegistered',client_id_reused:'talkReused'}));
 // api() reports a request that never got an answer (no signal, a timeout, a captive portal's page) as key 'error' with no status: a lost connection.
 const keyOf=error=>error?.status===429?'talkRate':CODES.get(error?.code)||(error?.status===413?'talkFileSize':error?.status===401?'unauthorized':/^talk[A-Z]/.test(error?.key||'')?error.key:error?.key==='error'&&!error.status?'talkOffline':'talkError');
 const PAUSED=['talkPaused','talkPausedOffline'];
 const isOpen=()=>question?.status==='open';
 // Whether focus is inside a node; harness nodes and old browsers may lack contains().
 const holds=node=>{const active=document.activeElement;return Boolean(node&&active&&active!==document.body&&node.contains?.(active));};
 // A key-labelled node switched to another key keeps following the language switch (refresh() in fiiu-ui.js rewrites data-fiiu-text).
 function rekey(node,key){if(node&&node.dataset.fiiuText!==key){node.dataset.fiiuText=key;node.textContent=t(key);}}
 const emptyKey=()=>question?.status==='closed'?'talkEmptyClosed':question?.status==='hidden'?'talkEmptyHidden':'talkEmpty';
 // One polite status, built with the page and never shown, says what a screen reader would otherwise miss. The same text again gets a trailing
 // no-break space, so it is read again. It carries no key: a language switch must not repeat the last announcement.
 function announce(text){const live=parts?.live;if(live)live.textContent=live.textContent===text?text+'\u00a0':text;}
 // A half-typed answer is kept for the tab (sessionStorage), per question: a close, a sign-in round trip or a reload brings it back. Storage can be
 // blocked or full, so every access is guarded and the draft then stays on screen only. It is kept per viewer too: on a shared phone, or after "Use
 // another account", the next person never sees, or posts under their own name, what someone else typed.
 const DRAFTS='nodal.talkDraft.';
 const slot=(prefix,id)=>me.draftKey&&id?prefix+me.draftKey+'.'+id:'';
 function storedDraft(id){const name=slot(DRAFTS,id);if(!name)return '';try{return globalThis.sessionStorage?.getItem(name)||'';}catch{return '';}}
 function keepDraft(){
  const name=slot(DRAFTS,question?.id),text=composer?.textarea.value||'';if(!name)return;
  try{if(text.trim())globalThis.sessionStorage?.setItem(name,text);else globalThis.sessionStorage?.removeItem(name);}catch{/* Without storage the draft stays on screen only. */}
 }
 // A message handed to its row is kept the same way, with its clientId, until the server confirms or refuses it: a reload, or a phone that drops the
 // tab while offline, draws it again as not sent, and Retry is still the same message (one the server already has comes back, not a second copy).
 // Text only: a photo cannot come back after a reload, and its text alone under the same clientId would be refused as another message.
 const UNSENT='nodal.talkUnsent.';
 function keepUnsent(){
  const name=slot(UNSENT,question?.id);if(!name)return;const list=[...attempts.values()].filter(item=>!item.files.length).map(({clientId,body})=>({clientId,body}));
  try{if(list.length)globalThis.sessionStorage?.setItem(name,JSON.stringify(list));else globalThis.sessionStorage?.removeItem(name);}catch{/* The rows stay on screen only. */}
 }
 function restoreUnsent(){
  const name=slot(UNSENT,question.id);if(!name)return;
  let list;try{list=JSON.parse(globalThis.sessionStorage?.getItem(name)||'[]');}catch{list=[];}
  for(const item of Array.isArray(list)?list:[]){
   if(!UUID.test(String(item?.clientId))||typeof item.body!=='string'||!item.body.trim()||attempts.has(item.clientId))continue;
   const attempt={clientId:item.clientId,body:item.body,files:[],sig:item.body+'\n',state:'failed',row:null};attempt.row=pendingRow(attempt,true);attempts.set(attempt.clientId,attempt);
  }
 }
 function uuid(){
  if(typeof globalThis.crypto?.randomUUID==='function')return globalThis.crypto.randomUUID();
  const b=globalThis.crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const hex=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
 }

 // Scrolling: the page itself scrolls, and its bottom is where the conversation ends (the dock at rest on the screen's bottom edge), not the end of the
 // document: the site footer stays below, reached by scrolling on, instead of taking a fifth of a small phone under the composer. A reader within
 // 120 px of that end, or past it, follows new messages; anyone higher up gets the pill instead. Without the conversation, the document's end.
 function end(){
  const s=document.scrollingElement,box=parts?.box?.getBoundingClientRect?.();if(!s)return 0;
  return box?Math.max(0,Math.round(box.bottom+s.scrollTop-(window.innerHeight||s.clientHeight))):s.scrollHeight-s.clientHeight;
 }
 function nearBottom(){const s=document.scrollingElement;return !s||s.scrollTop>=end()-NEAR;}
 // Whether the reader follows the end when the chat grows without a new message (a failed send's taller row, a taller dock): a move to the end says
 // yes, and after that the reader's own scrolling decides. A smooth move still on its way down follows; scrolling up, away from the end, stops it.
 let following=true,lastTop=0;
 function track(){const s=document.scrollingElement;if(!s)return;const top=s.scrollTop;following=nearBottom()||(following&&top>=lastTop);lastTop=top;}
 // The first paint jumps; later moves follow the page's scroll-behavior, which fiiu-talk.css turns off for reduced motion. Older Safari rejects 'instant'.
 function toBottom(smooth){
  const s=document.scrollingElement;if(!s)return;const top=parts?.box?.getBoundingClientRect?end():s.scrollHeight;following=true;
  if(!smooth&&typeof window.scrollTo==='function'){try{window.scrollTo({top,behavior:'instant'});lastTop=s.scrollTop;return;}catch{/* falls through */}}s.scrollTop=top;lastTop=s.scrollTop;
 }
 // The chat grew under a reader who follows it (a taller dock with a paused line, a status, a kept draft or a longer answer): the end moved down, and
 // the reader goes with it, so the last message does not slide under the dock. Anyone reading higher up, or past the end on the footer, stays.
 function keepEnd(){const s=document.scrollingElement;if(s&&parts&&following&&s.scrollTop<end())toBottom(false);}
 function updateEmpty(){if(parts)parts.empty.hidden=parts.log.children.length>0;}
 // apply() reports each row it adds; afterwards the page follows them, or raises the pill when the reader is elsewhere (always follows your own).
 // Other people's new rows are announced once per patch (one per poll), so a busy room is not read out row by row; likes and edits replace rows and
 // say nothing, which is why the log itself is not a live region.
 function patch(apply){
  const near=nearBottom(),others=[];let added=false,own=false;
  apply((view,isNew)=>{if(isNew){added=true;own||=Boolean(view.mine);if(!view.mine)others.push(view);}});
  updateEmpty();if(!added||!parts)return;
  if(others.length)announce(others.length===1?fill('talkNewOne',{author:others[0].author||''}):fill('talkNewMany',{n:others.length}));
  if(near||own){parts.pill.hidden=true;toBottom(true);}else parts.pill.hidden=false;
 }

 // https and http addresses become links; everything else, markup included, stays text. innerHTML is never used.
 const URLS=/(https?:\/\/[^\s<>"]+)/g,TRAIL=/[.,;:!?)\]}'»”]+$/;
 function linkify(text){
  const p=el('p','f-talk-body');p.translate=true;
  String(text).split(URLS).forEach((part,i)=>{
   if(!part)return;if(i%2===0){p.append(document.createTextNode(part));return;}
   const trail=TRAIL.exec(part)?.[0]||'',href=part.slice(0,part.length-trail.length);let url=null;try{url=new URL(href);}catch{url=null;}
   if(!url||!['http:','https:'].includes(url.protocol)){p.append(document.createTextNode(part));return;}
   // Not f-talk-link: that class is the shared conversation entry link, with a speech-bubble glyph and a tall touch target.
   const a=el('a','f-talk-url',href);a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-describedby','f-newtab');p.append(a);if(trail)p.append(document.createTextNode(trail));
  });
  return p;
 }
 // Lima time; a message from another Lima day adds its short date.
 function when(value){
  const at=new Date(value),node=el('time','f-talk-time');if(!Number.isFinite(at.getTime()))return node;node.dateTime=at.toISOString();
  const day=limaDate(at);if(day===limaDate(new Date()))node.textContent=limaClock(at);else node.append(dateNode(day,'span','short','f-talk-day'),document.createTextNode(' '+limaClock(at)));return node;
 }
 // Images open full size in a new tab from a lazy thumbnail (the server serves the full image when there is none); PDFs download.
 function filesOf(files){
  const box=el('div','f-talk-files');
  for(const file of files){
   const href='/api/fiiu/files/'+encodeURIComponent(file.id);
   if(/^image\//.test(file.mime)){
    const a=el('a','f-talk-image'),img=el('img');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-describedby','f-newtab');
    img.src=href+'?size=thumb';img.loading='lazy';img.decoding='async';img.alt=file.name||'';if(Number.isInteger(file.width)&&Number.isInteger(file.height)){img.width=file.width;img.height=file.height;}
    a.append(img,tr('span','talkOpenFull','f-sr-only'));box.append(a);
   }else{const a=el('a','f-talk-file');a.href=href;a.append(el('span','f-talk-file-kind','PDF'),el('span','f-talk-file-name',file.name||'PDF'),sizeNode(Number(file.size)||0));box.append(a);}
  }
  return box;
 }
 // A like on its way shows its outcome at once over the row's state from the server, which stays as the server last described it until the answer.
 function likeShown(m){
  const want=liking.get(m.id),count=m.likeCount||0;
  return want===undefined||want===Boolean(m.liked)?{liked:Boolean(m.liked),likeCount:count}:{liked:want,likeCount:Math.max(0,count+(want?1:-1))};
 }
 function likeButton(m){
  const b=el('button','f-talk-like'),shown=likeShown(m);b.type='button';b.setAttribute('aria-pressed',String(shown.liked));b.setAttribute('aria-describedby','f-talk-m-'+m.id);b.disabled=!isOpen();
  b.append(tr('span','talkLike','f-talk-like-label'),el('span','f-talk-like-n',String(shown.likeCount)));b.addEventListener('click',()=>toggleLike(m.id));return b;
 }
 function messageRow(m){
  const row=el('li','f-talk-msg'+(m.mine?' is-mine':'')+(m.hidden?' is-hidden':'')),meta=el('p','f-talk-meta'),actions=el('div','f-talk-actions');
  // The meta line (author, labels, time) describes the row's buttons, so "Delete" or "Like" says whose message it acts on.
  row.dataset.id=m.id;row.dataset.seq=String(m.seq??'');meta.id='f-talk-m-'+m.id;meta.append(el('strong','f-talk-author',m.author||''));
  if(me.organiser&&m.authorFull&&m.authorFull!==m.author)meta.append(el('span','f-talk-full',m.authorFull));
  // Organisers see every hidden message; a participant sees only their own, told who hid it.
  if(m.organiser)meta.append(tr('span','talkOrganiser','f-talk-org'));if(m.hidden)meta.append(tr('span',me.organiser?'talkHidden':'talkHiddenForYou','f-talk-flag'));
  meta.append(when(m.createdAt));row.append(meta);if(m.body)row.append(linkify(m.body));if(m.files.length)row.append(filesOf(m.files));
  // Your own message and a hidden one show their likes as text: nobody likes their own, and the server refuses a like on a hidden one.
  if(m.mine||m.hidden){if(m.likeCount>0)actions.append(counted('span','f-talk-likes',m.likeCount===1?'talkLikeOne':'talkLikes',{n:m.likeCount}));}
  else actions.append(likeButton(m));
  // Your own message can be deleted even once the question is closed, or the organisers hid it.
  if(m.mine)actions.append(button('talkDelete',()=>erase(m.id),'f-talk-delete f-talk-act'));
  if(me.organiser)actions.append(button(m.hidden?'talkUnhide':'talkHide',()=>moderate(m.id),'f-talk-hide f-talk-act'));
  for(const control of actions.querySelectorAll('.f-talk-act'))control.setAttribute('aria-describedby',meta.id);
  row.append(actions);return row;
 }
 // Rows stay in (createdAt, id) order with messages still being sent last. A replaced row hands focus to the same control in its successor:
 // each row control's first class names it (f-talk-like, f-talk-delete, f-talk-hide, the last also for Unhide).
 const later=(a,b)=>Boolean(a)&&(a.createdAt>b.createdAt||(a.createdAt===b.createdAt&&a.id>b.id));
 const normal=view=>({...view,files:Array.isArray(view.files)?view.files:[]});
 function setLiked(id,on){if(on)liked.add(id);else liked.delete(id);const view=views.get(id);if(view)view.liked=on;}
 // A view without a liked flag (every ?since= change) keeps the one the page has.
 function upsert(view){
  if(typeof view.liked==='boolean')setLiked(view.id,view.liked);
  const next={...normal(view),liked:liked.has(view.id)},node=messageRow(next),old=rowsById.get(next.id);views.set(next.id,next);rowsById.set(next.id,node);
  if(old){const active=document.activeElement,cls=active&&old.contains?.(active)?String(active.className||'').split(' ')[0]:'';old.replaceWith(node);if(cls)node.querySelector('.'+cls)?.focus();return false;}
  const after=[...parts.log.children].find(child=>child.dataset.pending==='1'||later(views.get(child.dataset.id),next));if(after)after.before(node);else parts.log.append(node);return true;
 }
 function drop(id){rowsById.get(id)?.remove();rowsById.delete(id);views.delete(id);}

 // The header and the dock (pill, then the composer or the closed note) are built once per question and updated in place.
 function whenLine(a){const line=el('p','f-talk-when');line.append(dateNode(a.date,'span','short','f-talk-day'));if(a.time)line.append(el('span','',a.time));if(a.venue)line.append(source('span',a.venue,'f-talk-venue'));return line;}
 function blockHead(a){return a?[tr('p','talkPage','f-talk-kicker'),source('h1',a.title,'f-talk-title'),whenLine(a)]:[tr('p','talkPage','f-talk-kicker')];}
 function renderHead(){
  const nodes=blockHead(activity);if(question.talk)nodes.push(source('p',question.talk,'f-talk-talk'));if(question.status==='hidden')nodes.push(tr('p','talkHiddenQuestion','f-talk-flag'));
  nodes.push(source('blockquote',question.body,'f-talk-question'));if(parts.more)nodes.push(parts.more);parts.head.replaceChildren(...nodes);
 }
 function questionList(list){
  const ul=el('ul','f-talk-list');
  for(const q of list){const li=el('li'),a=el('a','f-talk-pick');a.href='fiiu-talk.html?q='+encodeURIComponent(q.id);a.append(source('span',q.body,'f-talk-pick-body'));if(q.talk)a.append(source('span',q.talk,'f-talk-pick-talk'));
   if(q.status!=='open')a.append(tr('span',q.status==='hidden'?'talkHiddenQuestion':'talkClosedChip','f-talk-flag'));li.append(a);ul.append(li);}
  return ul;
 }
 // A block's questions as the pulse sees them (ids and statuses, hidden ones left out, as the pulse leaves them out), to notice a change cheaply.
 const blockSig=pairs=>pairs.filter(([,state])=>state!=='hidden').map(([id,state])=>id+':'+state).sort().join(' ');
 // The other questions on the block. Redrawn when they change, the list keeps its open state, and its focus moves to the new summary.
 function showSiblings(list){
  if(!parts||!Array.isArray(list))return;const others=sorted(list.filter(q=>q?.id&&q.id!==question.id)),was=parts.more,focused=holds(was);
  parts.siblings=others;parts.listSig=blockSig(others.map(q=>[q.id,q.status]));parts.more=null;
  if(others.length){const more=el('details','f-talk-more');more.open=Boolean(was?.open);more.append(tr('summary','talkOtherQuestions'),questionList(others),link('talkBackToBlock','fiiu-talk.html?a='+encodeURIComponent(question.activityId),'f-text-link'));parts.more=more;}
  renderHead();renderDock();if(focused)parts.more?.querySelector('summary')?.focus();
 }
 function renderDock(){
  if(!parts)return;const state=isOpen()&&me.canPost?'composer':question.status==='closed'?'closed':'none',was=parts.dockState;
  // Only a change of state touches the dock: moving the composer would drop its focus and the phone keyboard with it.
  if(was!==state){
   const inside=holds(parts.dock);parts.dockState=state;
   parts.dock.replaceChildren(parts.pill,parts.note,...(state==='composer'?[ensureComposer().form]:state==='closed'?[parts.closed]:[]));
   if(state==='composer')restoreDraft();
   // A close while someone types keeps them in the dock, on the note, which reads itself; anyone else hears it from the status line. A reopen hands
   // focus left in the dock back to the composer.
   if(was&&state!=='composer'){if(inside)(state==='closed'?parts.closedNote:parts.log).focus();else if(state==='closed')announce(t('talkClosed'));}
   else if(was&&inside)composer.textarea.focus();
  }
  // The closed note leads to the block's open question, if there is one, and keeps an unsent answer readable (and copyable) under it.
  if(state==='closed'){
   const open=(parts.siblings||[]).find(q=>q.status==='open'),draft=composer?.textarea.value.trim()||storedDraft(question.id).trim();
   parts.next.hidden=!open;if(open)parts.next.href='fiiu-talk.html?q='+encodeURIComponent(open.id);parts.draft.hidden=!draft;parts.draftText.value=draft;
  }
 }
 // Discarding a kept draft clears it from the composer and the tab; focus on the button, which goes with it, moves to the closed note.
 function discardDraft(){
  const inside=holds(parts?.draft);if(composer){composer.textarea.value='';updateLeft();grow();}keepDraft();
  if(!parts)return;parts.draft.hidden=true;parts.draftText.value='';if(inside)parts.closedNote.focus();
 }
 function setStatus(state){
  if(!question||!(parts||wall))return;question.status=state;me.canPost=state==='open';if(wall)return renderWallHead();renderHead();renderDock();rekey(parts.empty,emptyKey());
  for(const node of rowsById.values()){const like=node.querySelector('.f-talk-like');if(like)like.disabled=state!=='open';}
 }
 function build(){
  const box=el('section','f-talk'),head=el('header','f-talk-head'),earlier=button('talkLoadEarlier',()=>loadEarlier(),'f-button secondary f-talk-earlier'),log=el('ol','f-talk-log'),empty=tr('p','talkEmpty','f-talk-empty'),dock=el('div','f-talk-dock');
  const pill=button('talkNew',()=>{pill.hidden=true;toBottom(true);},'f-talk-new');pill.hidden=true;
  const live=el('p','f-sr-only f-talk-live');live.setAttribute('role','status');
  // The dock's own status line, kept through every dock state: paused updates, and errors when there is no composer to show them. The page's status
  // sits at the top, far above a reader the chat keeps at the bottom.
  const note=el('p','f-talk-status f-talk-note');note.setAttribute('role','status');
  // The closed state: the note (focusable, so a close while typing can keep focus there) and an unsent draft under it, in a read-only box whose
  // "select all" stays inside it, so the whole answer can be copied on a phone.
  const closed=el('div','f-talk-closedbox'),closedNote=tr('p','talkClosed','f-talk-closed'),draft=el('div','f-talk-draft'),draftLabel=tr('label','talkDraftKept','f-talk-draft-label'),draftText=el('textarea','f-talk-input f-talk-draft-text');
  const next=link('talkNextOpen','#','f-button f-talk-next');next.hidden=true;
  // Discard drops the kept draft for good, so a reader done with it gets the dock's room back, here and whenever the question is opened again in the tab.
  const draftHead=el('div','f-talk-draft-head'),discard=button('talkDiscardDraft',()=>discardDraft(),'f-talk-act f-talk-discard');draftHead.append(draftLabel,discard);
  closedNote.tabIndex=-1;draftText.id='f-talk-draft';draftText.readOnly=true;draftText.rows=2;draftLabel.htmlFor=draftText.id;draft.append(draftHead,draftText);draft.hidden=true;closed.append(closedNote,next,draft);
  log.setAttribute('role','log');log.setAttribute('aria-live','off');log.setAttribute('aria-label',t('talkPage'));log.tabIndex=-1;dock.append(pill);box.append(head,earlier,log,empty,dock,live);
  root.replaceChildren(box,newTabNote());parts={box,head,earlier,log,empty,dock,pill,live,note,closed,closedNote,next,draft,draftText,more:null,dockState:''};
  // The stylesheet keeps focused message controls clear of the sticky dock by its measured height, which grows with chips, a status and six lines; a
  // reader at the end follows its growth (the first measure only sets the height).
  dockObserver?.disconnect();dockObserver=null;
  if(typeof ResizeObserver==='function'){
   let last=null;
   dockObserver=new ResizeObserver(()=>{const height=dock.offsetHeight;box.style?.setProperty?.('--f-talk-dock-h',height+'px');if(last!==null&&height>last)keepEnd();last=height;});dockObserver.observe(dock);
  }
 }
 // A reload of the same question (a reset, or a status the pulse cannot carry) rebuilds the rows but keeps the header nodes, the composer and its draft.
 function show(data){
  const again=question?.id===data.question.id;
  question={...data.question};activity=data.activity||activity;me={draftKey:/^[\w-]{1,64}$/.test(String(data.me?.draftKey))?data.me.draftKey:'',organiser:Boolean(data.me?.organiser),canPost:data.me?.canPost!==false&&question.status==='open'};
  before=typeof data.before==='string'?data.before:null;known=Number(data.revision)||Number(question.revision)||0;
  liked.clear();seedLiked(data);
  // The projector is for organisers; anyone else who opens its address gets the chat.
  if(present&&me.organiser)return showWall(data,again);
  unwall();const same=Boolean(parts)&&again;
  if(!same)build();renderHead();rowsById.clear();views.clear();parts.log.replaceChildren();
  for(const view of Array.isArray(data.messages)?data.messages:[])if(view?.id)upsert(view);
  restoreUnsent();for(const attempt of attempts.values())if(attempt.row)parts.log.append(attempt.row);
  parts.earlier.hidden=!before;parts.log.setAttribute('aria-label',t('talkPage'));renderDock();rekey(parts.empty,emptyKey());updateEmpty();setTitle();if(!same)toBottom(false);
 }

 // A full read (the question, or earlier messages) may also list the ids of the messages this viewer likes.
 function seedLiked(data){for(const id of Array.isArray(data?.liked)?data.liked:[])if(typeof id==='string')liked.add(id);}

 // Access states replace the page; polling stops until a question is shown again.
 function halt(){if(timer!==null)clearInterval(timer);timer=null;question=null;parts=null;dockObserver?.disconnect();dockObserver=null;unwatch();unwall();}
 // A page with nothing live to follow (a block's list, or a question this viewer cannot see yet) watches the public, CDN-cached pulse every 8 s while
 // the tab is visible, for two hours at most, and acts once its part of the pulse changes. Opening anything stops it.
 function watch(changed,act){
  unwatch();const w={until:Date.now()+WATCH_FOR,busy:false};
  w.timer=setInterval(async()=>{
   if(watcher!==w||w.busy||document.visibilityState!=='visible')return;if(Date.now()>w.until)return unwatch();w.busy=true;
   try{const data=await api('/api/fiiu/pulse'),list=(Array.isArray(data?.questions)?data.questions:[]).filter(Array.isArray);if(watcher===w&&changed(list)){unwatch();await act();}}
   catch{/* The next round asks again. */}finally{w.busy=false;}
  },WATCH_MS);
  watcher=w;
 }
 function unwatch(){if(watcher)clearInterval(watcher.timer);watcher=null;}
 // Focus that was on the page (in the composer, say) moves to the heading that replaces it, which also reads the new state out.
 function block(title,hint,...actions){
  const inside=holds(root);halt();const box=el('section','f-locked f-talk-locked'),row=el('div','f-actions'),heading=tr('h1',title);heading.tabIndex=-1;row.append(...actions);box.append(heading,...(hint?[tr('p',hint)]:[]),row);
  root.replaceChildren(box,newTabNote());status(message,'');setTitle();if(inside)heading.focus();
 }
 // A page that redraws itself (a question that opened by itself, a block's list that changed) gives focus that was on the old page to the new one, which
 // reads the change out: the same link if it is still listed; in a chat, the composer, else the closed note, else the conversation; else the heading.
 // Not the chat's heading: its header is redrawn when the other questions arrive.
 async function redraw(act){
  const active=document.activeElement,inside=holds(root),href=inside?active.getAttribute?.('href'):null;await act();if(!inside||holds(root))return;
  const same=href?[...root.querySelectorAll('a')].find(a=>a.getAttribute?.('href')===href):null;if(same)return same.focus();
  if(parts){const target=parts.dockState==='composer'?composer.textarea:parts.dockState==='closed'?parts.closedNote:parts.log;return target.focus(target===parts.log?{preventScroll:true}:undefined);}
  const heading=root.querySelector('h1');if(heading){heading.tabIndex=-1;heading.focus();}
 }
 // A question hidden from this viewer (not opened yet, or hidden since) opens by itself once the pulse lists it, with the composer and its draft:
 // people who scanned the projector early are not stranded.
 function unavailable(){
  block('talkUnavailable','',activity?link('talkBackToBlock','fiiu-talk.html?a='+encodeURIComponent(activity.id),'f-button secondary'):link('viewProgramme','fiiu.html#programme','f-button secondary'));
  const q=new URLSearchParams(location.search).get('q')||'';if(UUID.test(q))watch(list=>list.some(item=>item[0]===q),()=>redraw(start));
 }
 // An outage is reported as one, never as "signed out" (the fiiu.js rule).
 function access(error){
  if(error?.status===401)return block('talkSignIn','talkSignInHint',link('signin','login.html?next='+encodeURIComponent(location.pathname+location.search),'f-button'));
  if(error?.status===403&&error.code==='not_registered')return block('talkRegister','talkRegisterHint',link('register','fiiu.html#registration','f-button'));
  if(error?.status===404||error?.status===400)return unavailable();
  return block(keyOf(error)==='talkRate'?'talkRate':'talkError','',button('retry',()=>start()));
 }

 // Polling. A tick is skipped while the tab is hidden, while one is running and during the backoff after errors (4 s doubling to at most 60 s).
 function startPolling(){if(timer===null)timer=setInterval(()=>tick(),POLL);}
 async function tick(){
  if(!question||busy||document.visibilityState!=='visible'||Date.now()<nextAt)return;
  busy=true;const id=question.id;
  try{
   // The public pulse leaves hidden questions out, so an organiser reading one asks for its changes directly.
   if(me.organiser&&question.status==='hidden')await changes(id);
   else{
    const pulse=await api('/api/fiiu/pulse'),list=(Array.isArray(pulse.questions)?pulse.questions:[]).filter(Array.isArray),entry=list.find(item=>item[0]===id);
    if(question?.id!==id)return;
    // Gone from the pulse: hidden since it was opened. Reading it again says so (or, for an organiser, shows it hidden).
    if(!entry)await reload(id);
    // The pulse only says that something moved past the page's revision. Its status is never applied: the CDN can serve one seconds old, and the
    // changes answer carries the question as it is now.
    else if(Number(entry[2])>known)await changes(id);
    if(!wall&&question?.id===id)await followBlock(list).catch(()=>{});
   }
   failures=0;nextAt=0;paused(null);
   if(wall?.qr==='failed'&&Date.now()>=wall.qrAt)loadQr(id);
  }catch(error){
   if([401,403,404].includes(error?.status))return access(error);
   failures++;nextAt=Date.now()+Math.min(60000,POLL*2**failures);paused(keyOf(error)==='talkOffline'?'talkPausedOffline':'talkPaused');
  }finally{busy=false;}
 }
 // The chat says it is paused in its dock; the projector, which has none, at the top of its page.
 function paused(key){const node=parts?.note||message;if(key)status(node,key);else if(PAUSED.includes(node.dataset.fiiuText))status(node,'');}
 // The other questions on the block follow the pulse: once their ids or statuses change (one opened, closed or hidden), the list is read again, once.
 // The pulse is compared with the pulse it last acted on, so a CDN copy a few seconds older than the list cannot make every poll read it. A list that
 // failed to load with the question is unknown, and every poll asks for it until one arrives.
 async function followBlock(list){
  if(!parts)return;const id=question.id,sig=blockSig(list.filter(item=>item[1]===question.activityId&&item[0]!==id).map(item=>[item[0],item[3]]));
  if(sig===(parts.pulseSig??parts.listSig)){parts.pulseSig=sig;return;}
  const data=await api('/api/fiiu/questions?activityId='+encodeURIComponent(question.activityId));
  if(question?.id===id&&parts){parts.pulseSig=sig;showSiblings(data.questions);}
 }
 async function changes(id){
  const data=await api('/api/fiiu/questions/'+encodeURIComponent(id)+'/messages?since='+known);if(question?.id!==id)return;
  if(data.reset)return reload(id);
  // Every answer carries the question as it is now, so an edit or a close lands even when messages moved in the same window. It goes first, so rows
  // drawn below already know whether the question is open.
  applyQuestion(data.question);
  const list=Array.isArray(data.changes)?data.changes:[];
  // The projector keeps every change, older ones included: a like on an early answer can lift it into Most liked.
  if(wall){for(const change of list)if(change?.id){if(change.gone)views.delete(change.id);else views.set(change.id,normal(change));}renderWall();}
  else{
   // While earlier pages are not loaded, a change to a message older than the first loaded row (a like or an unhide bumps its seq) waits for
   // "Load earlier", which brings it fresh: shown now it would sit out of context above the gap and raise the pill with nothing new below.
   const first=before?views.get([...parts.log.children].find(child=>child.dataset.id)?.dataset.id):null;
   patch(note=>{for(const change of list){if(!change?.id)continue;if(change.gone)drop(change.id);else if(!(first&&!rowsById.has(change.id)&&later(first,change)))note(change,upsert(change));}});
  }
  if(Number.isFinite(data.revision))known=Math.max(known,data.revision);
 }
 // The header is redrawn only when something in it changed, so a focused "More questions" summary keeps its focus on the other answers.
 function applyQuestion(fresh){
  if(!question||fresh?.id!==question.id||typeof fresh.body!=='string')return;
  // An answer older than the question on screen (one in flight across a close, or another instance's shared copy) never undoes it.
  const revision=Number(fresh.revision);if(Number.isFinite(revision)){if(revision<Number(question.revision||0))return;question.revision=revision;}
  const talk=fresh.talk??null,edited=fresh.body!==question.body||talk!==(question.talk??null);if(edited)Object.assign(question,{body:fresh.body,talk});
  if(['open','closed','hidden'].includes(fresh.status)&&fresh.status!==question.status)setStatus(fresh.status);else if(edited&&(wall||parts))(wall?renderWallHead:renderHead)();
 }
 async function reload(id){const data=await api('/api/fiiu/questions/'+encodeURIComponent(id));if(question?.id===id&&data?.question?.id)show(data);}
 // A refusal says the question closed before any sync did: it closes at once, and the question is read again (that read is never shared) so its
 // revision is the close's, and an older answer still on its way cannot bring the composer back.
 function closedByServer(){
  setStatus('closed');const id=question?.id;if(!id)return;
  api('/api/fiiu/questions/'+encodeURIComponent(id)).then(data=>{if(question?.id===id)applyQuestion(data?.question);},()=>{});
 }

 // Composer: text up to 1,000 characters (counted as the server counts them, in code points) and up to 3 images or PDFs.
 function ensureComposer(){
  if(composer)return composer;
  const form=el('form','f-talk-composer'),label=tr('label','talkPlaceholder','f-sr-only'),textarea=el('textarea','f-talk-input'),input=el('input'),chips=el('ul','f-talk-chips'),tools=el('div','f-talk-tools');
  const attach=button('talkAttach',()=>input.click(),'f-talk-act f-talk-attach'),send=tr('button','talkSend','f-button f-talk-send'),left=el('span','f-talk-left f-talk-n'),state=el('p','f-talk-status');
  form.noValidate=true;textarea.id='f-talk-text';textarea.name='body';textarea.rows=2;textarea.maxLength=2*LIMIT;textarea.placeholder=t('talkPlaceholder');label.htmlFor=textarea.id;
  input.type='file';input.multiple=true;input.accept=TYPES.join(',');input.hidden=true;input.tabIndex=-1;send.type='submit';left.hidden=true;chips.hidden=true;state.setAttribute('role','status');
  tools.append(attach,chips,left);form.append(label,textarea,send,tools,input,state);
  composer={form,textarea,input,chips,left,state,send,files:[]};
  textarea.addEventListener('input',()=>{updateLeft();grow();keepDraft();});
  textarea.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();return submit();}});
  input.addEventListener('change',()=>{choose([...(input.files||[])]);input.value='';});
  form.addEventListener('submit',event=>{event.preventDefault();return submit();});
  return composer;
 }
 // The composer serves one question per page; the first time it shows for it, an empty one takes the draft kept for the tab.
 function restoreDraft(){
  const c=composer,id=question?.id;if(!c||!id||c.draftFor===id)return;c.draftFor=id;
  if(!c.textarea.value){const text=storedDraft(id);if(text){c.textarea.value=text;updateLeft();grow();}}
 }
 // field-sizing grows the box where supported; elsewhere its height follows the text, and the stylesheet's max-height stops it at six lines.
 function grow(){const box=composer.textarea;if(!box.style||globalThis.CSS?.supports?.('field-sizing','content'))return;box.style.height='auto';box.style.height=box.scrollHeight+'px';}
 function updateLeft(){
  const n=LIMIT-codePoints(composer.textarea.value.trim());composer.left.hidden=n>=100;
  if(n<100)setCount(composer.left,n<0?'talkCharsOver':n===1?'talkCharLeft':'talkCharsLeft',{n:Math.abs(n)});
 }
 const say=value=>status(composer.state,value);
 const typeOf=file=>file.type||({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',pdf:'application/pdf'})[String(file.name).split('.').pop().toLowerCase()]||'';
 // Checked before any work: the count, the type, and a PDF's size (an image is resized, so its size is judged after).
 function choose(files){
  if(!files.length)return;if(composer.files.length+files.length>FILES)return say(problem('talkTooManyFiles'));
  for(const file of files){const type=typeOf(file);if(!TYPES.includes(type))return say(problem('talkFileType'));if(type==='application/pdf'&&file.size>MAX)return say(problem('talkFileSize'));}
  composer.files.push(...files);renderChips();say('');
 }
 function renderChips(){
  const c=composer;c.chips.replaceChildren();c.chips.hidden=!c.files.length;
  c.files.forEach((file,i)=>{
   const chip=el('li','f-talk-chip'),name=el('span','f-talk-chip-name',file.name);name.id='f-talk-chip-'+i;
   const remove=button('talkRemoveFile',()=>{c.files.splice(i,1);renderChips();c.textarea.focus();},'f-talk-act');remove.setAttribute('aria-describedby',name.id);chip.append(name,sizeNode(file.size),remove);c.chips.append(chip);
  });
 }

 // Images are redrawn on the phone: a JPEG of at most 1600 px and a thumbnail of at most 480 px (which also drops location and camera data).
 // Bytes travel as base64 read with FileReader, since the CSP allows no blob: URLs.
 const read=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>{const url=String(reader.result);resolve(url.slice(url.indexOf(',')+1));};reader.onerror=()=>reject(reader.error||Error('read'));reader.readAsDataURL(blob);});
 function scaled(bitmap,edge){
  const scale=Math.min(1,edge/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  // JPEG has no transparency: without a white ground a transparent PNG turns black.
  const g=canvas.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,canvas.width,canvas.height);g.drawImage(bitmap,0,0,canvas.width,canvas.height);return canvas;
 }
 // The server shortens a file name over 160 characters; one over 120 is cut here already, by whole characters and keeping its extension, so the name
 // people see in the chat is the one they sent.
 function fitName(name,fallback){
  const full=String(name??'').trim()||fallback;if(full.length<=NAME)return full;
  const dot=full.lastIndexOf('.'),ext=dot>0&&full.length-dot<=10?full.slice(dot):'';let stem='';
  for(const ch of full.slice(0,full.length-ext.length)){if(stem.length+ch.length+ext.length>NAME)break;stem+=ch;}
  return stem+ext;
 }
 const jpeg=(canvas,quality)=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('encode')),'image/jpeg',quality));
 async function prepareFile(file){
  const type=typeOf(file);
  if(type==='application/pdf'){if(file.size>MAX)throw problem('talkFileSize');return {name:fitName(file.name,'file.pdf'),mime:type,data:await read(file)};}
  if(!/^image\//.test(type))throw problem('talkFileType');
  let full,thumb=null,width,height;
  try{
   const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
   try{const big=scaled(bitmap,1600),small=scaled(bitmap,480);width=big.width;height=big.height;full=await jpeg(big,0.85);let blob=await jpeg(small,0.7);if(blob.size>THUMB)blob=await jpeg(small,0.5);if(blob.size<=THUMB)thumb={blob,width:small.width,height:small.height};}
   finally{bitmap.close?.();}
  }catch{
   // HEIC on Chrome or a damaged file: an allowed image the browser cannot redraw goes as it is, without a thumbnail, while it fits.
   if(!IMAGES.includes(type))throw problem('talkFileType');if(file.size>MAX)throw problem('talkFileSize');
   return {name:fitName(file.name,'image'),mime:type,data:await read(file)};
  }
  if(full.size>MAX)throw problem('talkFileSize');
  const payload={name:fitName((String(file.name).replace(/\.[^.]*$/,'')||'image')+'.jpg','image.jpg'),mime:'image/jpeg',data:await read(full),width,height};
  if(thumb)payload.thumb={mime:'image/jpeg',data:await read(thumb.blob),width:thumb.width,height:thumb.height};
  return payload;
 }
 // An upload is remembered by name, size and date from the moment it starts, so neither a retry nor the same file sent again while it travels uploads
 // it twice. An upload has two minutes, not the 20 s of the JSON calls: a 3 MB PDF is about 4 MB of base64, which a phone sharing the venue's Wi-Fi may
 // need over half a minute to send.
 const fileKey=file=>[file.name,file.size,file.lastModified].join(':');
 function upload(file){
  const id=fileKey(file);if(uploads.has(id))return uploads.get(id);
  const sending=(async()=>{const data=await api('/api/fiiu/files',await prepareFile(file),'POST',{timeout:UPLOAD_MS});if(typeof data?.file?.id!=='string')throw problem('talkError');return data.file.id;})();
  uploads.set(id,sending);sending.catch(()=>{if(uploads.get(id)===sending)uploads.delete(id);});return sending;
 }

 // Sending. Each draft has a clientId: the server stores one message per clientId, so a retry after a lost answer never posts it twice.
 function stateNode(key,vars){return vars?counted('span','f-talk-state',key,vars):tr('span',key,'f-talk-state');}
 function mark(row,key,vars){row.querySelector('.f-talk-state')?.replaceWith(stateNode(key,vars));}
 function pendingRow(attempt,failed=false){
  const row=el('li','f-talk-msg is-mine '+(failed?'is-failed':'is-pending')),meta=el('p','f-talk-meta');row.dataset.pending='1';
  meta.append(tr('strong','talkYou','f-talk-author'),stateNode(failed?'talkNotSent':'talkSending'));row.append(meta);if(attempt.body)row.append(linkify(attempt.body));
  if(attempt.files.length){const list=el('ul','f-talk-pending-files');for(const file of attempt.files)list.append(el('li','',file.name));row.append(list);}
  // Discard lets go of one that cannot go anywhere: a question closed since, or a file the festival will not take.
  if(failed){const actions=el('div','f-talk-actions');actions.append(button('talkRetry',()=>deliver(attempt),'f-talk-act f-talk-retry'),button('talkDiscardDraft',()=>discard(attempt),'f-talk-act'));row.append(actions);}
  return row;
 }
 // Sending hands the draft to its row and empties the composer at once, as chat apps do: what is typed next is a new message, and a photo still
 // uploading is never sent again with it. The row keeps the content, and Retry when it fails.
 function clearComposer(){const c=composer;c.textarea.value='';c.files=[];renderChips();updateLeft();grow();keepDraft();}
 function submit(){
  const c=composer,body=c.textarea.value.trim(),files=[...c.files];
  if(!body&&!files.length){c.textarea.focus();return;}
  if(codePoints(body)>LIMIT){say(problem('talkTooLong'));c.textarea.focus();return;}
  // The same draft typed again is the same message: a failed one is retried with its clientId, and one on its way is already in its row.
  const sig=body+'\n'+files.map(fileKey).join('|'),same=[...attempts.values()].find(item=>item.sig===sig);if(same?.state==='sending'){clearComposer();return;}
  let attempt=same?.state==='failed'?same:null;if(!attempt){attempt={clientId:uuid(),body,files,sig,state:'new',row:null};attempts.set(attempt.clientId,attempt);keepUnsent();}
  clearComposer();return deliver(attempt);
 }
 function discard(attempt){
  if(attempt.state==='sending')return;attempts.delete(attempt.clientId);keepUnsent();for(const file of attempt.files)uploads.delete(fileKey(file));
  attempt.row?.remove();attempt.row=null;updateEmpty();if(composer&&parts?.dockState==='composer')composer.textarea.focus();
 }
 // A Retry can come from a row restored on a question that has closed since, where there is no composer: its news goes to the dock's status line.
 const tell=value=>status(composer&&parts?.dockState==='composer'?composer.state:parts?.note||message,value);
 async function deliver(attempt){
  if(attempt.state==='sending'||!parts)return;attempt.state='sending';const row=pendingRow(attempt),id=question.id;
  if(attempt.row)attempt.row.replaceWith(row);else parts.log.append(row);attempt.row=row;updateEmpty();toBottom(true);tell('');
  try{
   const fileIds=[];
   for(const [i,file] of attempt.files.entries()){mark(row,'talkUploading',{current:i+1,total:attempt.files.length});fileIds.push(await upload(file));}
   mark(row,'talkSending');
   const data=await api('/api/fiiu/questions/'+encodeURIComponent(id)+'/messages',{clientId:attempt.clientId,body:attempt.body,fileIds});
   if(typeof data?.message?.id!=='string')throw problem('talkError');
   attempts.delete(attempt.clientId);keepUnsent();for(const file of attempt.files)uploads.delete(fileKey(file));row.remove();attempt.row=null;
   // A retry can find the message deleted since it was stored: it was delivered, so the draft goes as for any send, and no row is drawn for it.
   if(question?.id===id&&parts)patch(note=>{if(data.message.gone)drop(data.message.id);else note(data.message,upsert(data.message));});
   const c=composer;if(!c)return;
   const active=document.activeElement;if(!active||active===document.body||c.form.contains?.(active))c.textarea.focus();
  }catch(error){
   const key=keyOf(error);
   /* The draft goes back to the composer to be fixed. When something new was typed or attached there meanwhile, it stays as a failed row instead,
      with its text and Discard, so nothing is lost. */
   const c=composer;
   if(DRAFT.includes(key)&&c&&!c.textarea.value.trim()&&!c.files.length){
    attempts.delete(attempt.clientId);keepUnsent();row.remove();attempt.row=null;updateEmpty();
    c.textarea.value=attempt.body;c.files=[...attempt.files];renderChips();updateLeft();grow();keepDraft();
    tell(problem(key));return;
   }
   // A file the server no longer accepts for this message is uploaded again on the next try.
   if(error?.code==='file_unavailable')for(const file of attempt.files)uploads.delete(fileKey(file));
   /* The copy stored under this clientId can no longer be finished (it stopped before its files and the question closed, a moderator hid it, or
      the retry came too late): the next try is a new message, with its files uploaded again. */
   if(error?.code==='client_id_reused'){attempts.delete(attempt.clientId);attempt.clientId=uuid();attempts.set(attempt.clientId,attempt);keepUnsent();for(const file of attempt.files)uploads.delete(fileKey(file));}
   // The failed row is taller than the sending one (its Retry) and the composer gains a status line: a reader still following (the send took them to
   // the end) stays at the end, so the message and its Retry are above the dock instead of under it.
   attempt.state='failed';const failed=pendingRow(attempt,true);row.replaceWith(failed);attempt.row=failed;tell(problem(key==='talkOffline'?'talkOfflineSend':key));keepEnd();
   if(error?.code==='question_closed')closedByServer();
  }
 }
 // Errors from likes, deletions and moderation show next to the composer, or in the dock's status line when there is none (a closed or hidden
 // question); the next action that works clears that line, unless it says updates are paused.
 function notify(error){tell(problem(keyOf(error)));}
 function settled(){const node=parts?.note;if(node&&node.dataset.fiiuText&&!PAUSED.includes(node.dataset.fiiuText))status(node,'');}
 function paintLike(id){
  const view=views.get(id),like=rowsById.get(id)?.querySelector('.f-talk-like');if(!view||!like)return;const shown=likeShown(view);
  like.setAttribute('aria-pressed',String(shown.liked));like.querySelector('.f-talk-like-n').textContent=String(shown.likeCount);
 }
 // A like shows at once and the server's answer then wins. A failure shows the row as the server last described it, which may be a count a sync brought
 // while the like was on its way, never the count seen before the tap. One request per message at a time.
 async function toggleLike(id){
  const view=views.get(id);if(!view||view.mine||view.hidden||liking.has(id)||!isOpen())return;const was=Boolean(view.liked);liking.set(id,!was);paintLike(id);
  try{
   const data=await api('/api/fiiu/messages/'+encodeURIComponent(id)+'/like',{},was?'DELETE':'PUT');
   setLiked(id,Boolean(data.liked));const now=views.get(id);if(now)now.likeCount=Math.max(0,Number(data.likeCount)||0);settled();
  }catch(error){
   // 404: hidden or deleted a moment ago, which the next sync would also say.
   if(error?.status===404){gone(id,false);return;}
   notify(error);if(error?.code==='question_closed')closedByServer();
  }finally{liking.delete(id);paintLike(id);}
 }
 async function erase(id){
  if(!window.confirm(t('talkDeleteConfirm')))return;
  try{await api('/api/fiiu/messages/'+encodeURIComponent(id),{},'DELETE');settled();gone(id);}
  catch(error){if(error?.status===404)gone(id);else notify(error);}
 }
 // A row that goes while focus is in it hands focus to the next message's first control, else the previous one's, else the composer (or the log), and
 // the status line says it was deleted (not for a like refused because the message was hidden). The target is picked after the request, since a poll
 // may have replaced the rows meanwhile.
 function gone(id,tell=true){
  const row=rowsById.get(id);if(!row||!parts){patch(()=>drop(id));return;}
  const list=[...parts.log.children],i=list.indexOf(row),active=document.activeElement,lost=!active||active===document.body||holds(row);
  const control=node=>[...(node?.querySelectorAll('button,a')||[])].find(item=>!item.disabled&&!item.hidden),target=control(list[i+1])||control(list[i-1])||(parts.dockState==='composer'?composer.textarea:parts.log);
  patch(()=>drop(id));if(lost)target.focus(target===parts.log?{preventScroll:true}:undefined);if(tell)announce(t('talkDeleted'));
 }
 // Organisers hide (PUT) and unhide (DELETE), one request per message at a time; the answer replaces the row, which stays on their screen, greyed.
 // A message its author deleted meanwhile just leaves the screen.
 async function moderate(id){
  const view=views.get(id);if(!view||moderating.has(id))return;moderating.add(id);
  try{const data=await api('/api/admin/fiiu/messages/'+encodeURIComponent(id)+'/hidden',{},view.hidden?'DELETE':'PUT');settled();if(data?.message?.id&&parts)patch(note=>note(data.message,upsert(data.message)));}
  catch(error){if(error?.status===404)gone(id);else notify(error);}
  finally{moderating.delete(id);}
 }
 async function loadEarlier(){
  if(!before||!parts)return;const control=parts.earlier,id=question.id,first=parts.log.children[0];control.disabled=true;
  try{
   const data=await api('/api/fiiu/questions/'+encodeURIComponent(id)+'/messages?before='+encodeURIComponent(before));if(question?.id!==id)return;seedLiked(data);
   for(const view of Array.isArray(data.messages)?data.messages:[])if(view?.id&&!rowsById.has(view.id))upsert(view);
   before=typeof data.before==='string'?data.before:null;const active=document.activeElement,lost=!before&&(!active||active===document.body||holds(control));
   control.hidden=!before;updateEmpty();first?.scrollIntoView?.({block:'start'});
   // The last page takes its button away: focus moves to the newest message it brought, without moving the page again.
   if(lost){const list=[...parts.log.children],newest=list[first?list.indexOf(first)-1:list.length-1];if(newest){newest.tabIndex=-1;newest.focus({preventScroll:true});}}
  }catch(error){notify(error);}finally{control.disabled=false;}
 }

 // Projector (?q=…&present=1, organisers only): the question as the headline, a QR code to join and the 12 latest or most liked answers, for the room's
 // screen. It follows the chat's poll, and has no composer, likes or moderation.
 function buildWall(){
  const box=el('section','f-talk-wall'),head=el('header','f-talk-wall-head'),code=el('div','f-talk-wall-code'),tools=el('div','f-talk-wall-tools'),sorts=el('div','f-talk-sorts'),feed=el('ol','f-talk-wall-feed'),empty=tr('p','talkEmpty','f-talk-wall-empty');
  const switches=[['latest','talkLatest'],['top','talkTop']].map(([mode,label])=>{const b=button(label,()=>{order=mode;renderWall();},'f-talk-sort');b.dataset.sort=mode;return b;});sorts.append(...switches);tools.append(sorts);
  // Full screen takes the whole page where the browser allows it (not on iPhone); the label follows the state, Esc included (fullscreenchange, below).
  let full=null;
  if(document.fullscreenEnabled!==false&&typeof document.documentElement?.requestFullscreen==='function'){full=button('talkFullscreen',()=>document.fullscreenElement?document.exitFullscreen?.():document.documentElement.requestFullscreen?.()?.catch?.(()=>{}),'f-button secondary f-talk-full');tools.append(full);}
  // The empty square holds the code's place, so the headline does not jump when it arrives.
  code.append(el('div','f-talk-wall-qr'));box.append(head,code,tools,feed,empty);root.replaceChildren(box);parts=null;dockObserver?.disconnect();dockObserver=null;document.body.classList.add('f-talk-present');
  wall={head,code,feed,empty,switches,full,svg:null,address:'',qr:'loading',qrAt:0,cards:new Map()};
  document.fonts?.ready?.then(()=>fitWall(),()=>{});
 }
 function renderWallHead(){
  const nodes=activity?[source('p',activity.title,'f-talk-wall-block'),whenLine(activity)]:[];if(question.talk)nodes.push(source('p',question.talk,'f-talk-talk'));
  if(question.status!=='open')nodes.push(tr('p',question.status==='hidden'?'talkHiddenQuestion':'talkClosedChip','f-talk-flag'));rekey(wall.empty,emptyKey());
  // The headline is 3 to 5 % of the screen's width; a long question steps down so the answers still fit under it.
  nodes.push(source('h1',question.body,'f-talk-wall-question'+(codePoints(question.body)>LONG?' is-long':'')));wall.head.replaceChildren(...nodes);paintCode();fitWall();
 }
 // An answer on the projector: the name, the organiser label and its likes, then the text (four lines at most, in the stylesheet) and thumbnails.
 function wallCard(m){
  const card=el('li','f-talk-wall-msg'),meta=el('p','f-talk-wall-meta');card.dataset.id=m.id;meta.append(el('strong','f-talk-author',m.author||''));if(m.organiser)meta.append(tr('span','talkOrganiser','f-talk-org'));
  if(m.likeCount>0)meta.append(counted('span','f-talk-wall-likes',m.likeCount===1?'talkLikeOne':'talkLikes',{n:m.likeCount}));card.append(meta);
  if(m.body){const text=el('p','f-talk-wall-body',m.body);text.translate=true;card.append(text);}
  if(m.files.length){
   const box=el('div','f-talk-wall-files');
   for(const file of m.files){
    if(!/^image\//.test(file.mime)){box.append(el('span','f-talk-wall-file','PDF · '+(file.name||'')));continue;}
    // A thumbnail without known dimensions changes the card's height when it arrives, so the wall is fitted again.
    const img=el('img');img.src='/api/fiiu/files/'+encodeURIComponent(file.id)+'?size=thumb';img.alt=file.name||'';img.decoding='async';img.addEventListener('load',()=>fitWall());if(Number.isInteger(file.width)&&Number.isInteger(file.height)){img.width=file.width;img.height=file.height;}box.append(img);
   }
   card.append(box);
  }
  return card;
 }
 // Latest is newest first; Most liked sorts by likes, then newest. Hidden messages (organisers receive them) never reach the room.
 const newest=(a,b)=>later(a,b)?-1:later(b,a)?1:0;
 function renderWall(){
  if(!wall)return;const list=[...views.values()].filter(view=>!view.hidden).sort(order==='top'?(a,b)=>(b.likeCount||0)-(a.likeCount||0)||newest(a,b):newest).slice(0,WALL),cards=new Map();
  // A card is rebuilt only when its message changed (a new seq); the others move as they are, so their thumbnails are not fetched again.
  for(const m of list){const id=m.id+':'+m.seq;cards.set(id,wall.cards.get(id)||wallCard(m));}
  wall.cards=cards;wall.feed.replaceChildren(...cards.values());wall.empty.hidden=list.length>0;
  for(const b of wall.switches)b.setAttribute('aria-pressed',String(b.dataset.sort===order));fitWall();
 }
 // A projector has no scrolling, so the room sees whole answers only: after each draw, and when the screen changes size or goes full screen, every row
 // of cards that would cross the screen's bottom edge is left out (rows, so none is left half full). The first row stays even on a screen too short for
 // it, rather than an empty wall; the one-column layout an organiser checks on a phone scrolls, and keeps them all.
 function fitWall(){
  if(!wall)return;const list=[...wall.feed.children];for(const card of list)card.hidden=false;
  if(!list.length||window.matchMedia?.('(max-width:900px)').matches)return;
  const s=document.scrollingElement,limit=(window.innerHeight||s?.clientHeight||0)-FIT_MARGIN,y=s?.scrollTop||0,box=card=>card.getBoundingClientRect?.();
  const cut=list.find(card=>{const b=box(card);return b&&b.bottom+y>limit;});if(!cut)return;
  const first=box(list[0]).top,from=box(cut).top>first?box(cut).top:box(list.find(card=>box(card).top>first)||cut).top;
  if(from>first)for(const card of list)if(box(card).top>=from)card.hidden=true;
 }
 // The join code arrives as module bits (row-major, most significant bit first) and is drawn as one SVG path inside a 4-module quiet zone. This copies
 // drawQr from fiiu-qr.js on purpose: the check-in screen is on the festival's critical path, so this page neither imports from it nor changes it.
 function drawQr(qr){
  const size=qr?.size;if(!Number.isInteger(size)||size<21||size>177||typeof qr.bits!=='string')return null;
  let bytes;try{bytes=Uint8Array.from(atob(qr.bits),c=>c.charCodeAt(0));}catch{return null;}
  if(bytes.length*8<size*size)return null;
  const dark=i=>(bytes[i>>3]>>(7-(i&7)))&1,side=size+8;let d='';
  for(let y=0;y<size;y++)for(let x=0;x<size;){if(!dark(y*size+x)){x++;continue;}let run=1;while(x+run<size&&dark(y*size+x+run))run++;d+=`M${x+4} ${y+4}h${run}v1h-${run}z`;x+=run;}
  const svg=document.createElementNS(SVG,'svg'),back=document.createElementNS(SVG,'rect'),path=document.createElementNS(SVG,'path');
  svg.setAttribute('viewBox',`0 0 ${side} ${side}`);svg.setAttribute('class','f-talk-qr-svg');svg.setAttribute('role','img');svg.setAttribute('aria-label',t('talkScanToJoin'));
  back.setAttribute('width',String(side));back.setAttribute('height',String(side));back.setAttribute('fill','#fff');
  path.setAttribute('d',d);path.setAttribute('fill','#000');path.setAttribute('shape-rendering','crispEdges');svg.append(back,path);return svg;
 }
 // Under the code, an address people can type from their seat: the block's (?a=), which lists its questions and opens this one when it is the only one.
 // The code itself carries the exact ?q= address. The server's origin (PUBLIC_BASE_URL) wins; without an answer, this page's own.
 function typedAddress(url){try{const at=new URL(url);return at.host+at.pathname+'?a='+encodeURIComponent(question.activityId);}catch{return '';}}
 async function loadQr(id){
  if(!wall)return;wall.qr='loading';let data=null,failed=false;
  try{data=await api('/api/admin/fiiu/questions/'+encodeURIComponent(id)+'/qr');}catch{failed=true;}
  if(!wall||question?.id!==id)return;
  // A failed request is tried again by the poll once a minute. A code the encoder could not draw is final: the room keeps the question, the answers
  // and the address.
  const svg=drawQr(data?.qr),address=typedAddress(typeof data?.url==='string'?data.url:location.href);Object.assign(wall,{svg,address,qr:failed?'failed':'done',qrAt:Date.now()+60000});
  paintCode();fitWall();
 }
 // The code says what scanning gives: joining an open question, reading a closed one. A hidden question shows no code and no address yet (they would
 // find nothing), only that it opens soon; the code comes back when it opens. renderWallHead() repaints it on every change of status.
 function paintCode(){
  if(!wall)return;const state=question?.status;
  if(state==='hidden'){wall.code.replaceChildren(tr('p','talkOpensSoon','f-talk-wall-scan'));wall.code.hidden=false;return;}
  if(wall.qr==='loading')return;const label=state==='closed'?'talkScanToRead':'talkScanToJoin',{svg,address}=wall;svg?.setAttribute('aria-label',t(label));
  wall.code.replaceChildren(...(svg?[tr('p',label,'f-talk-wall-scan'),svg]:[]),...(address?[el('p','f-talk-wall-url',address)]:[]));wall.code.hidden=!svg&&!address;
 }
 function showWall(data,again){
  if(!wall||!again){buildWall();loadQr(question.id);}
  views.clear();rowsById.clear();for(const view of Array.isArray(data.messages)?data.messages:[])if(view?.id)views.set(view.id,normal(view));
  renderWallHead();renderWall();setTitle();
 }
 // Leaving the projector (for an access state, or the chat once someone is no longer an organiser) gives back the page's layout and the screen lock.
 function unwall(){if(!wall)return;wall=null;document.body.classList.remove('f-talk-present');lock?.release?.()?.catch?.(()=>{});lock=null;}
 // The projector keeps the screen awake. Browsers drop the lock while the tab is hidden, so it is asked for again when the tab returns.
 function wake(){
  if(!wall||waking||(lock&&!lock.released)||!globalThis.navigator?.wakeLock)return;waking=true;
  navigator.wakeLock.request('screen').then(next=>{if(wall)lock=next;else next.release?.();},()=>{}).finally(()=>{waking=false;});
 }

 // Questions open first, then newest.
 const sorted=list=>[...list].sort((a,b)=>(a.status==='open'?0:1)-(b.status==='open'?0:1)||String(b.createdAt).localeCompare(String(a.createdAt)));
 // A block's list follows the pulse too: a question opened, closed or hidden reads it again (quietly, keeping the list on a failure), and a block left
 // with one question opens it, as a first load does. That is the address the projector shows people to type.
 function watchBlock(id,last){watch(list=>{const now=blockSig(list.filter(item=>item[1]===id).map(item=>[item[0],item[3]]));if(now===last)return false;last=now;return true;},()=>redraw(()=>openBlock(id,last)));}
 async function openBlock(id,seen){
  unwatch();const refresh=seen!==undefined;if(!refresh)status(message,'loading');let data;
  try{data=await api('/api/fiiu/questions?activityId='+encodeURIComponent(id));}catch(error){return refresh?watchBlock(id,null):access(error);}
  status(message,'');activity=data.activity||null;const list=sorted(Array.isArray(data.questions)?data.questions.filter(q=>q?.id):[]);
  if(list.length===1){history.replaceState(null,'',location.pathname+'?q='+encodeURIComponent(list[0].id));return openQuestion(list[0].id,list);}
  const box=el('section','f-talk f-talk-block'),head=el('header','f-talk-head');head.append(...blockHead(activity));box.append(head);
  if(list.length)box.append(tr('h2','talkQuestions','f-talk-subhead'),questionList(list));
  else{const actions=el('div','f-actions');actions.append(link('viewProgramme','fiiu.html#programme','f-button secondary'));box.append(tr('p','talkEmptyBlock','f-talk-empty'),actions);}
  root.replaceChildren(box,newTabNote());setTitle();watchBlock(id,seen??blockSig(list.map(q=>[q.id,q.status])));
 }
 async function openQuestion(id,list=null){
  unwatch();status(message,'loading');let data;
  try{data=await api('/api/fiiu/questions/'+encodeURIComponent(id));}catch(error){return access(error);}
  status(message,'');if(!data?.question?.id)return access(null);
  show(data);startPolling();if(wall)return wake();
  if(list)showSiblings(list);else api('/api/fiiu/questions?activityId='+encodeURIComponent(question.activityId)).then(result=>{if(question?.id===data.question.id)showSiblings(result.questions);},()=>{});
 }
 function start(){
  unwatch();const params=new URLSearchParams(location.search),q=params.get('q')||'',a=params.get('a')||'';
  // The projector shows one question (?q=), never a block's list.
  present=UUID.test(q)&&params.get('present')==='1';
  setTitle();if(UUID.test(q))return openQuestion(q);if(!q&&ID.test(a))return openBlock(a);status(message,'');unavailable();
 }

 // A language switch: refresh() in fiiu-ui.js rewrites the plain keys; the numbers, sizes and attributes are rewritten here.
 function relabel(){
  // The composer's counter has no key until it first shows (updateLeft() below relabels it); without this guard t(undefined) would stop the switch here.
  setTitle();root.querySelectorAll('.f-talk-n').forEach(node=>{if(node.dataset.talkKey)setCount(node,node.dataset.talkKey,JSON.parse(node.dataset.talkVars||'{}'));});
  root.querySelectorAll('.f-talk-size').forEach(node=>{node.textContent=sizeText(Number(node.dataset.talkSize));});
  if(parts)parts.log.setAttribute('aria-label',t('talkPage'));if(composer){composer.textarea.placeholder=t('talkPlaceholder');updateLeft();}
  wall?.svg?.setAttribute('aria-label',t(question?.status==='closed'?'talkScanToRead':'talkScanToJoin'));
 }
 window.nodalI18n?.onChange(relabel);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')return;wake();nextAt=0;return tick();});
 // Back online, the chat asks at once instead of waiting out a backoff that can reach a minute.
 window.addEventListener('online',()=>{nextAt=0;return tick();});
 document.addEventListener('fullscreenchange',()=>{fitWall();const full=wall?.full;if(!full)return;const name=document.fullscreenElement?'exitFullScreen':'talkFullscreen';full.dataset.fiiuText=name;full.textContent=t(name);});
 window.addEventListener('resize',()=>fitWall());
 window.addEventListener('scroll',()=>{track();if(parts&&!parts.pill.hidden&&nearBottom())parts.pill.hidden=true;},{passive:true});
 start();
})();
