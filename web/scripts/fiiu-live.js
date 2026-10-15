(() => {
 'use strict';
 /* The festival live window, from GET /api/fiiu/live: the session under way and the next one, the conversations people are in, how many people have earned
    each badge and the day's numbers. Only registered people and organisers may read it (the server answers 401 signed out, 403 without a registration),
    and every allowed reader gets the same answer, rebuilt at most every 15 s per server instance. fiiu.html shows it as a band at the top of the page
    (#en-vivo), the console's festival block as one compact line (Fiiu.live.mount(host,{compact:true})).
    It reads every 30 s while the tab is visible, pauses while it is hidden and reads at once on return. A refresh is silent: no live region (it would
    speak every 30 s), and when only numbers changed they change in place, so the links, focus and a screen reader's place stay put. A read that fails on
    venue Wi-Fi keeps the last view and the next tick tries again. Outside the festival dates only organisers read it, marked as a preview. */
 const Fiiu=window.Fiiu,{t,el,tr,link,source,api,dateNode,timeNode,limaDate,limaClock,locale,countLabel}=Fiiu;
 Object.assign(Fiiu.rows,{
  liveTitle:['Live','En vivo','Ao vivo'],livePreview:['Preview','Vista previa','Pré-visualização'],liveUpdated:['Updated','Actualizado','Atualizado'],
  liveNow:['Now','Ahora','Agora'],liveNext:['Up next','A continuación','A seguir'],liveDone:['The festival’s sessions are over.','Las sesiones del festival terminaron.','As sessões do festival terminaram.'],
  // Count labels follow the number (fiiu-ui.js countLabel): "87 personas registraron su asistencia".
  liveCheckedInOne:['person checked in','persona registró su asistencia','pessoa registrou presença'],liveCheckedInMany:['people checked in','personas registraron su asistencia','pessoas registraram presença'],
  liveTalks:['Live conversations','Conversaciones en vivo','Conversas ao vivo'],liveNoTalks:['No conversation is open right now.','Ahora no hay conversaciones abiertas.','Agora não há conversas abertas.'],
  liveAnswerOne:['answer','respuesta','resposta'],liveAnswerMany:['answers','respuestas','respostas'],liveGeneral:['FIIU General','FIIU General','FIIU Geral'],
  // Rating questions are 1 to 10; {avg} and {n} are filled in here, so a language switch redraws them.
  liveRating:['Average {avg} from {n} people','Promedio {avg} de {n} personas','Média {avg} de {n} pessoas'],liveRatingOne:['Average {avg} from 1 person','Promedio {avg} de 1 persona','Média {avg} de 1 pessoa'],
  liveRatingNone:['No ratings yet','Todavía no hay valoraciones','Ainda não há avaliações'],
  // The milestone names are the console's Recognition ledger's (i18n-dashboard.js d.badge.fiiu.*).
  liveBadges:['Badges','Insignias','Insígnias'],liveBadgesHint:['People who have earned each one','Personas que ya obtuvieron cada una','Pessoas que já conquistaram cada uma'],
  liveBadgeFirst:['First session','Primera sesión','Primeira sessão'],liveBadgeThree:['Three sessions','Tres sesiones','Três sessões'],liveBadgeConferences:['All five conferences','Las cinco conferencias','As cinco conferências'],liveBadgeLab:['Laboratory','Laboratorio','Laboratório'],
  livePulse:['The festival today','El festival hoy','O festival hoje'],livePulseRegistered:['People registered','Personas inscritas','Pessoas inscritas'],livePulseToday:['Check-ins today','Asistencias hoy','Presenças hoje'],
  livePulseTotal:['Check-ins so far','Asistencias en total','Presenças no total'],livePulseMessages:['Messages','Mensajes','Mensagens'],livePulseRatings:['Ratings','Valoraciones','Avaliações'],
  liveRegister:['Register to follow FIIU live','Inscríbete para ver el FIIU en vivo','Inscreva-se para acompanhar o FIIU ao vivo'],
  liveSignIn:['Sign in with your registered account to follow FIIU live','Inicia sesión con tu cuenta inscrita para ver el FIIU en vivo','Entre com a sua conta inscrita para acompanhar o FIIU ao vivo'],
  liveOpen:['View live','Ver en vivo','Ver ao vivo'],liveTodayOne:['check-in today','asistencia hoy','presença hoje'],liveTodayMany:['check-ins today','asistencias hoy','presenças hoje'],
  liveTalkOne:['live conversation','conversación en vivo','conversa ao vivo'],liveTalkMany:['live conversations','conversaciones en vivo','conversas ao vivo'],
  liveMoreOne:['1 more conversation','1 conversación más','Mais 1 conversa'],liveMoreMany:['{n} more conversations','{n} conversaciones más','Mais {n} conversas'],
 });
 // The three most active conversations show; the others (the server sends five at most) fold under one control, so the band leaves room for the page.
 const REFRESH=30000,SHOWN=3;
 // fiiu-ui.js builds the session page's address (Fiiu.sessionLink); the same address is built here while a page loads an older fiiu-ui.js.
 const sessionLink=(activityId,questionId)=>(Fiiu.sessionLink||((a,q)=>'fiiu-session.html?a='+encodeURIComponent(a)+(q?'&q='+encodeURIComponent(q):'')))(activityId,questionId);
 const formats=new Map(),format=(id,options)=>{const k=locale()+'|'+id;if(!formats.has(k))formats.set(k,new Intl.NumberFormat(locale(),options));return formats.get(k);};
 const number=n=>format('n').format(n),average=n=>format('avg',{minimumFractionDigits:1,maximumFractionDigits:1}).format(n);
 const fill=(key,values)=>t(key).replace(/\{(\w+)\}/g,(match,name)=>values[name]??match);
 // The answer is checked as it is drawn: a missing or odd field draws as nothing or zero instead of breaking the band.
 const count=n=>Number.isSafeInteger(n)&&n>=0?n:0;
 const slot=item=>{const a=item?.activity;return a&&typeof a.id==='string'&&typeof a.title==='string'&&typeof a.date==='string'?item:null;};
 const talks=list=>(Array.isArray(list)?list:[]).filter(c=>c&&typeof c.questionId==='string'&&typeof c.activityId==='string'&&typeof c.body==='string');
 const rating=r=>{const n=count(r?.count);return n&&Number.isFinite(r.average)?fill(n===1?'liveRatingOne':'liveRating',{avg:average(r.average),n:number(n)}):t('liveRatingNone');};
 // Everything but the numbers: while it stays the same, a refresh only rewrites the numbers.
 const shape=(d,compact,preview,named)=>JSON.stringify([locale(),compact,preview,named,slot(d.now)?.activity||null,slot(d.next)?.activity||null,Number.isFinite(Date.parse(d.generatedAt)),
  talks(d.conversations).map(c=>[c.questionId,c.activityId,c.activityTitle,c.body,c.kind,c.latest?[c.latest.author,c.latest.body,c.latest.createdAt]:null])]);
 // A node's text, read through its children (a count is a number and its label).
 const text=node=>node.children.length?[...node.children].map(text).join(''):node.textContent;
 // keys collects the nodes that hold a number, by a name that stays the same from one read to the next.
 function build(d,{compact,preview,named},keys){
  const keep=(node,id)=>{keys.set(id,node);return node;},tally=(id,n,one,many,cls)=>keep(countLabel(count(n),one,many,cls),id);
  const now=slot(d.now),next=slot(d.next),list=talks(d.conversations),pulse=d.pulse||{},badges=d.badges||{},today=limaDate();
  const head=el('div','f-live-head'),title=tr(compact?'h3':'h2','liveTitle','f-live-title');title.id=compact?'f-live-line-title':'f-live-title';head.append(title);
  if(preview)head.append(tr('span','livePreview','f-live-preview'));
  // A date only when the next session is on another day; the venue is left to the session page on the console.
  const when=(meta,a,later)=>{if(later&&a.date!==today)meta.append(dateNode(a.date,'span','short','f-live-day'));if(a.time)meta.append(timeNode(a.time,'span','f-live-time'));};
  if(compact){
   // A session the block already names (the person's next one) is not repeated: the line moves on to the festival's next.
   const item=[now,next].find(slotted=>slotted&&slotted.activity.id!==named)||null,line=el('p','f-live-line'),counts=el('p','f-live-counts');
   if(item){const name=source('a',item.activity.title,'f-live-session-title');name.href=sessionLink(item.activity.id);line.append(tr('span',item===now?'liveNow':'liveNext','f-live-label'));when(line,item.activity,item!==now);line.append(name);}
   else if(!now&&!next)line.append(tr('span','liveDone'));
   counts.append(tally('today',pulse.checkedInToday,'liveTodayOne','liveTodayMany'),tally('talks',list.length,'liveTalkOne','liveTalkMany'));
   return [head,...(line.children.length?[line]:[]),counts,link('liveOpen','fiiu.html#en-vivo','f-text-link f-live-open')];
  }
  const at=Date.parse(d.generatedAt);
  if(Number.isFinite(at)){const updated=el('p','f-live-updated');updated.append(tr('span','liveUpdated'),document.createTextNode(' '),keep(el('span','f-live-clock',limaClock(new Date(at))),'updated'));head.append(updated);}
  const session=(label,item,id)=>{
   const a=item.activity,box=el('div','f-live-session'),name=source('a',a.title,'f-live-session-title'),meta=el('p','f-live-meta');name.href=sessionLink(a.id);
   when(meta,a,label==='liveNext');box.append(tr('h3',label,'f-live-label'),name);if(meta.children.length)box.append(meta);if(a.venue)box.append(source('p',a.venue,'f-live-venue'));
   if(label==='liveNow')box.append(tally(id,item.checkedIn,'liveCheckedInOne','liveCheckedInMany','f-count f-live-count'));return box;
  };
  const sessions=el('section','f-live-part f-live-when');
  if(now)sessions.append(session('liveNow',now,'now'));if(next)sessions.append(session('liveNext',next,'next'));if(!now&&!next)sessions.append(tr('h3','liveNow','f-live-label'),tr('p','liveDone','f-muted'));
  // Each conversation opens its question inside its session page, with its newest answer (a rating question: its average).
  const chats=el('section','f-live-part f-live-talks');chats.append(tr('h3','liveTalks','f-live-label'));
  if(!list.length)chats.append(tr('p','liveNoTalks','f-muted'));
  else{
   const items=el('ol','f-live-talk-list'),rest=el('ol','f-live-talk-list');
   for(const [i,c] of list.entries()){
    const item=el('li','f-live-talk'),question=source('a',c.body,'f-live-question'),where=el('p','f-live-meta');question.href=sessionLink(c.activityId,c.questionId);
    where.append(c.activityId==='general'?tr('span','liveGeneral'):source('span',c.activityTitle||''),tally('answers:'+c.questionId,c.messageCount,'liveAnswerOne','liveAnswerMany'));item.append(question,where);
    if(c.kind==='rating')item.append(keep(el('p','f-live-rating',rating(c.rating)),'rating:'+c.questionId));
    else if(c.latest&&typeof c.latest.body==='string'){const said=el('p','f-live-latest'),time=Date.parse(c.latest.createdAt);said.append(el('strong','f-live-author',c.latest.author||''));if(Number.isFinite(time))said.append(el('span','f-live-at',limaClock(new Date(time))));said.append(el('span','f-live-said',c.latest.body));item.append(said);}
    (i<SHOWN?items:rest).append(item);
   }
   chats.append(items);
   if(rest.children.length){const more=el('details','f-live-more'),n=rest.children.length;more.append(el('summary','',n===1?t('liveMoreOne'):fill('liveMoreMany',{n:number(n)})),rest);rest.setAttribute('start',String(SHOWN+1));chats.append(more);}
  }
  const figures=(cls,heading,rows,hint)=>{
   const part=el('section','f-live-part '+cls),items=el('ul','f-live-figures');part.append(tr('h3',heading,'f-live-label'));if(hint)part.append(tr('p',hint,'f-live-hint'));
   for(const [id,label,n] of rows){const item=el('li','f-live-figure');item.append(tr('span',label,'f-live-figure-label'),keep(el('b','f-live-value',number(count(n))),id));items.append(item);}
   part.append(items);return part;
  };
  const grid=el('div','f-live-grid');
  grid.append(sessions,chats,
   figures('f-live-badges','liveBadges',[['badge:first','liveBadgeFirst',badges.first],['badge:three','liveBadgeThree',badges.three],['badge:conferences','liveBadgeConferences',badges.conferences],['badge:lab','liveBadgeLab',badges.lab]],'liveBadgesHint'),
   figures('f-live-pulse','livePulse',[['pulse:registered','livePulseRegistered',pulse.registered],['pulse:today','livePulseToday',pulse.checkedInToday],['pulse:total','livePulseTotal',pulse.checkedInTotal],['pulse:messages','livePulseMessages',pulse.messages],['pulse:ratings','livePulseRatings',pulse.ratings]]));
  return [head,grid];
 }
 // event: the festival (its startsOn and endsOn, in Lima); organiser: the reader is one, so the window opens before and after the dates as a preview.
 // registrationOpen: whether the line for people without access invites them to register or, once registration closes, to sign in with a registered account.
 // named: the id of a session the host already shows (the console's "next for you"), read at each draw, which the compact line leaves out.
 // known: the answer the page already knows, asked before every read: 401 for a guest, 403 for an account without a registration. Such a page shows
 // its line without asking the server (the festival page knows from its registration read); null asks.
 // onFirstDraw: called once, after the first answer is drawn (the band, the line or nothing; a failed read draws nothing). The band goes in above the
 // festival page's programme, panel and feeds when its read answers, so the page lands a link (#registration, #add-<block>, a saved place) again then.
 function mount(host,{compact=false,event=null,organiser=false,registrationOpen=true,named=()=>null,known=()=>null,onFirstDraw=null}={}){
  let timer=null,stopped=false,busy=false,shownSig='',shownKeys=new Map(),last=null,first=onFirstDraw;
  host.className='f-live'+(compact?' is-compact':'');host.hidden=true;
  const inDates=()=>{const today=limaDate();return !event||(today>=event.startsOn&&today<=event.endsOn);};
  const pause=()=>{if(timer!==null){clearInterval(timer);timer=null;}};
  const follow=()=>{if(timer===null&&!stopped&&document.visibilityState!=='hidden')timer=setInterval(read,REFRESH);};
  const hide=()=>{host.hidden=true;host.replaceChildren();host.removeAttribute?.('aria-labelledby');shownSig='';shownKeys=new Map();};
  const drawn=()=>{const call=first;first=null;call?.();};
  function show(d){
   const preview=!inDates(),skip=compact?named()||null:null,sig=shape(d,compact,preview,skip),keys=new Map(),tree=build(d,{compact,preview,named:skip},keys);
   if(sig===shownSig){for(const [id,node] of keys){const old=shownKeys.get(id);if(!old||text(old)===text(node))continue;if(node.children.length)old.replaceChildren(...[...node.children]);else old.textContent=node.textContent;}}
   else{
    // A redraw gives focus back to the same link when it was on one in the band, and keeps the folded conversations open for a reader who opened them.
    const focused=document.activeElement,mark=host.contains?.(focused)?focused.getAttribute?.('href'):null,opened=Boolean(host.querySelector('.f-live-more')?.open);
    host.replaceChildren(...tree);shownKeys=keys;shownSig=sig;const more=host.querySelector('.f-live-more');if(more&&opened)more.open=true;
    if(mark)[...host.querySelectorAll('a')].find(a=>a.getAttribute('href')===mark)?.focus({preventScroll:true});
   }
   host.setAttribute('aria-labelledby',compact?'f-live-line-title':'f-live-title');host.hidden=false;
  }
  // Without access the festival page shows one line during the festival; the console shows nothing.
  function prompt(status){
   const key=registrationOpen?'liveRegister':status===401?'liveSignIn':'';
   if(compact||!key||!inDates()){hide();return;}
   const line=el('p','f-live-prompt');line.append(tr('span','liveTitle','f-live-label'),link(key,'#registration','f-text-link'));
   host.replaceChildren(line);host.removeAttribute?.('aria-labelledby');shownSig='prompt';shownKeys=new Map();host.hidden=false;
  }
  async function read(){
   if(stopped||busy)return;
   if(!organiser&&!inDates()){pause();hide();drawn();return;}
   const refused=known();if(refused===401||refused===403){last=null;pause();prompt(refused);drawn();return;}
   busy=true;
   try{
    const d=await api('/api/fiiu/live');if(stopped)return;if(!d||typeof d.active!=='boolean')throw Error('live');
    if(!d.active){last=null;pause();hide();}
    else{last=d;show(d);follow();}
    drawn();
   }
   catch(error){if(stopped)return;if(error?.status===401||error?.status===403){last=null;pause();prompt(error.status);drawn();return;}follow();}
   finally{busy=false;}
  }
  document.addEventListener?.('visibilitychange',()=>{if(stopped)return;if(document.visibilityState==='hidden')pause();else read();});
  // Numbers, averages and the {n} phrases are drawn in the reader's language, so a switch redraws the band from the last answer.
  window.nodalI18n?.onChange?.(()=>{if(!stopped&&last&&!host.hidden)show(last);});
  read();
  return{refresh:read,stop(){stopped=true;pause();}};
 }
 Fiiu.live={mount};
})();
