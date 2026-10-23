(() => {
 'use strict';
 // The check-in screen shown at the door (organisers only; the server gates the page). Without ?a= it lists the NODAL blocks. With ?a= it shows that block's
 // rotating QR code, the 6-character code and address for phones that cannot scan, when check-in closes and a live count. It never shows participant data.
 const Fiiu=window.Fiiu,{t,el,tr,button,link,source,api,status,dateNode,checkinActivities,checkinState,windowNode,countLabel,newTabNote,limaDate,locale}=Fiiu;
 // Page-only strings join the shared dictionary, so t(), tr() and the language switch in fiiu-ui.js handle them like the rest.
 Object.assign(Fiiu.rows,{
  qrClosedKicker:['Check-in closed','Registro cerrado','Registro encerrado'],
  // The amber line of a screen opened away from its block's time: {day} is the block's long date, {time} its start, both in Lima.
  qrBlockOnAt:['This block is on {day} at {time}','Este bloque es el {day}, a las {time}','Este bloco é {day}, às {time}'],qrBlockOn:['This block is on {day}','Este bloque es el {day}','Este bloco é {day}'],
 });
 const root=document.getElementById('fiiuQrRoot'),message=document.getElementById('fiiuStatus'),SVG='http://www.w3.org/2000/svg',REFRESH=30000;
 const id=new URLSearchParams(location.search).get('a')||'';
 let festival=null,activity=null,latest=null,timer=null,stopped=false,busy=false,stale=false,ended=false,lock=null,parts=null,offset=0,windows=[];
 // Codes and the closing time are judged by the server's clock. Each answer carries serverTime, so the screen keeps the offset
 // and reads "now" as server time: a presenter laptop whose clock is off (or a local FIIU_CHECKIN_NOW clock) never keeps a code
 // the server already refuses, nor hides one it still accepts.
 const serverNow=()=>Date.now()+offset;
 const setTitle=()=>{document.title='NODAL · '+(activity?activity.title:t('qrTitle'));};
 const time=value=>typeof value==='number'?value:Date.parse(value);
 // Date and time on one line, the venue (often long) on its own, so a wrapped line never starts or ends on a separator.
 function meta(activity,cls,withDate=true){const box=el('div',cls),line=el('p','f-meta-when');if(withDate)line.append(dateNode(activity.date,'span','short','f-when-day'));if(activity.time)line.append(el('span','',activity.time));box.append(line,activity.venue?source('p',activity.venue,'f-meta-venue'):tr('p','venuePending','f-meta-venue'));return box;}
 // Without ?a=: one ruled row per block, by day, each opening its own screen.
 function list(){
  windows=[];const box=el('section','f-qr-list'),head=el('header','f-qr-head'),blocks=checkinActivities(festival.event);head.append(tr('h1','qrTitle'),tr('p','qrListHint','f-muted'));box.append(head);
  for(const date of [...new Set(blocks.map(block=>block.date))]){
   const day=el('section','f-qr-day'),label=dateNode(date,'h2','long','f-qr-day-label'),rows=el('ul','f-qr-rows');label.id='f-qr-day-'+date;day.setAttribute('aria-labelledby',label.id);
   for(const block of blocks.filter(item=>item.date===date)){
    const row=el('li','f-qr-row'),main=el('div','f-qr-row-main'),title=source('p',block.title,'f-qr-row-title'),when=el('p','f-qr-row-window'),open=link('openCheckinScreen','fiiu-qr.html?a='+encodeURIComponent(block.id),'f-button secondary f-small');
    title.id='f-qr-'+block.id;open.setAttribute('aria-describedby',title.id);windows.push({block,when,state:''});main.append(title,meta(block,'f-qr-row-meta',false));row.append(main,when,open);rows.append(row);
   }
   day.append(label,rows);box.append(day);
  }
  box.append(link('admin','fiiu-admin.html#checkin','f-text-link'));root.replaceChildren(box,newTabNote());recheck();
 }
 // A list left open at the desk re-judges each block's check-in on the clock (every 30 s, on a return to the tab and on a language change) and redraws
 // only a closing line whose state changed, so a block that closed never reads open and focus keeps its place.
 function recheck(){for(const row of windows){const state=checkinState(row.block);if(state!==row.state){row.state=state;row.when.replaceChildren(windowNode(row.block,state));}}}
 // The QR code arrives as module bits (row-major, most significant bit first) and is drawn as one SVG path inside a 4-module quiet zone.
 function drawQr(qr){
  const size=qr?.size;if(!Number.isInteger(size)||size<21||size>177||typeof qr.bits!=='string')return null;
  let bytes;try{bytes=Uint8Array.from(atob(qr.bits),c=>c.charCodeAt(0));}catch{return null;}
  if(bytes.length*8<size*size)return null;
  const dark=i=>(bytes[i>>3]>>(7-(i&7)))&1,side=size+8;let d='';
  for(let y=0;y<size;y++)for(let x=0;x<size;){if(!dark(y*size+x)){x++;continue;}let run=1;while(x+run<size&&dark(y*size+x+run))run++;d+=`M${x+4} ${y+4}h${run}v1h-${run}z`;x+=run;}
  const svg=document.createElementNS(SVG,'svg'),back=document.createElementNS(SVG,'rect'),path=document.createElementNS(SVG,'path');
  svg.setAttribute('viewBox',`0 0 ${side} ${side}`);svg.setAttribute('class','f-qr-svg');svg.setAttribute('role','img');svg.setAttribute('aria-label',t('scanToCheckIn'));
  back.setAttribute('width',String(side));back.setAttribute('height',String(side));back.setAttribute('fill','#fff');
  path.setAttribute('d',d);path.setAttribute('fill','#000');path.setAttribute('shape-rendering','crispEdges');svg.append(back,path);return svg;
 }
 // With ?a=: the parts that never change are built once; each refresh replaces only the code, the closing and amber lines and the count, so focus stays on the controls.
 function screen(){
  const box=el('section','f-qr'),stage=el('div','f-qr-stage'),code=el('div','f-qr-code'),side=el('div','f-qr-side'),title=source('h1',activity.title,'f-qr-title');
  const windowLine=el('p','f-qr-window'),when=el('p','f-qr-when'),typed=el('div','f-qr-typed'),address=el('p','f-qr-url'),short=el('p','f-qr-short'),count=el('p','f-qr-count'),controls=el('div','f-actions f-qr-controls');
  const kicker=tr('p','scanToCheckIn','f-qr-kicker'),note=tr('p','codeRotates','f-muted f-qr-note');
  when.hidden=true;count.setAttribute('role','status');count.setAttribute('aria-live','polite');typed.append(tr('p','orTypeCode','f-qr-type-label'),address,short);
  side.append(kicker,title,meta(activity,'f-qr-meta'),windowLine,when,typed,count);stage.append(code,side);
  // Full screen where the browser allows it (not on iPhone); the label follows the state, including Esc.
  if(typeof stage.requestFullscreen==='function'&&document.fullscreenEnabled!==false){
   const full=button('fullScreen',()=>document.fullscreenElement?document.exitFullscreen?.():stage.requestFullscreen()?.catch?.(()=>{}),'f-button');controls.append(full);
   document.addEventListener('fullscreenchange',()=>{const key=document.fullscreenElement?'exitFullScreen':'fullScreen';full.dataset.fiiuText=key;full.textContent=t(key);});
  }
  // A screen may stand at the door, signed in as an organiser: it links nowhere, and f-presenter hides the site menu and the footer (fiiu.css), whose privacy
  // link opens in the same tab. The list keeps its links, the menu and the footer.
  document.body.classList.toggle('f-presenter',true);
  box.append(stage,controls,note);root.replaceChildren(box,newTabNote());parts={code,windowLine,when,address,short,count,typed,kicker,note};
 }
 // A screen takes check-ins for its own block whenever it is open, so one opened for another block (the evening block in the morning, tomorrow's the day
 // before) says in amber when its block is: on another Lima day, or more than an hour before it starts, by the server's clock. The line goes in the hour
 // before the start and stays away once the block is under way; the untimed laboratory counts its day only.
 const START=/^\s*(\d{1,2}):(\d{2})/,HOUR=36e5;
 function awayLine(now){
  const start=START.exec(activity.time||''),clock=start?start[1].padStart(2,'0')+':'+start[2]:'',begins=start?Date.parse(`${activity.date}T${clock}:00-05:00`):NaN;
  if(activity.date===limaDate(new Date(now))&&!(begins-now>HOUR))return '';
  const day=new Intl.DateTimeFormat(locale(),{weekday:'long',day:'numeric',month:'long',timeZone:'America/Lima'}).format(new Date(activity.date+'T12:00:00-05:00'));
  return (start?t('qrBlockOnAt').replace('{time}',clock):t('qrBlockOn')).replace('{day}',day);
 }
 // fresh is false when a language change redraws the last answer: its serverTime is old by then, so the clock offset is kept.
 function show(data,fresh=true){
  if(typeof data?.shortCode!=='string'||typeof data.url!=='string')throw Object.assign(Error(t('error')),{key:'error'});
  const reported=time(data.serverTime);if(fresh&&Number.isFinite(reported))offset=reported-Date.now();
  latest=data;stale=false;const closes=time(data.window?.closesAt),shown=Number.isFinite(closes)?{...activity,checkin:{closesAt:new Date(closes).toISOString()}}:activity;
  // Open or closed, as the server judged it; an answer without that verdict is judged on the server's clock.
  const state=typeof data.window?.open==='boolean'?(data.window.open?'open':'closed'):checkinState(shown,serverNow());
  parts.windowLine.replaceChildren(windowNode(shown,state));
  const away=awayLine(serverNow());parts.when.textContent=away;parts.when.hidden=!away;
  parts.count.replaceChildren(...(Number.isSafeInteger(data.checkedIn)?[countLabel(data.checkedIn,'checkedInOne','checkedInMany')]:[]));
  // Once check-in has closed the server refuses every scan, though it still sends a code: nothing scannable or typeable stays on the projector,
  // the queue reads that check-in closed and where to go, and polling carries on, so a screen opened by mistake (yesterday's block) is plain to see.
  ended=state==='closed';parts.typed.hidden=ended;parts.note.hidden=ended;
  const kicker=ended?'qrClosedKicker':'scanToCheckIn';parts.kicker.dataset.fiiuText=kicker;parts.kicker.textContent=t(kicker);
  if(ended){const notice=el('div','f-qr-closed');notice.append(tr('p','checkinEndedTitle','f-qr-closed-title'),tr('p','askDesk','f-qr-closed-hint'));parts.code.replaceChildren(notice);return;}
  parts.code.replaceChildren(drawQr(data.qr)||tr('p','qrUnavailable','f-qr-missing'));
  // People type the address letter by letter, so the screen shows the short /checkin, which the server sends on to the page.
  let url=data.url;try{url=new URL(data.url).host+'/checkin';}catch{url=data.url.split('?')[0];}
  parts.address.textContent=url;parts.short.textContent=data.shortCode.slice(0,3)+' '+data.shortCode.slice(3);parts.short.setAttribute('aria-label',data.shortCode.split('').join(' '));
 }
 // An expired code is dead in both forms: the QR gives way to the notice and the typed code is hidden, so nobody types it at the door.
 // A closed block shows no code at all, so its notice stays.
 function expire(){stale=true;if(ended)return;parts.code.replaceChildren(tr('p','qrStale','f-qr-missing'));parts.typed.hidden=true;}
 // Losing the session or organiser access hides the code at once and stops polling; nothing on this page needs to survive.
 function stop(kind){
  stopped=true;if(timer!==null)clearInterval(timer);lock?.release?.().catch?.(()=>{});lock=null;parts=null;status(message,'');
  const box=el('section','f-locked'),actions=el('div','f-actions');
  if(kind===401){actions.append(link('adminSignIn','/login.html?next='+encodeURIComponent(location.pathname+location.search),'f-button'));box.append(tr('h1','sessionEnded'),tr('p','qrSignInAgain'),actions);}
  else if(kind===403){actions.append(link('fiiuPage','fiiu.html','f-button'),link('backToConsole','dashboard.html'));box.append(tr('h1','organisersOnly'),tr('p','organisersOnlyHint'),actions);}
  else{actions.append(link('allScreens','fiiu-qr.html','f-button'));box.append(tr('h1','noCheckin'),tr('p','noCheckinHint'),actions);}
  root.replaceChildren(box,newTabNote());
 }
 // pending is the first code, requested together with the programme; later refreshes ask again.
 async function refresh(pending){
  if(stopped||busy)return;busy=true;
  try{show(await (pending||api('/api/admin/fiiu/checkin?activityId='+encodeURIComponent(id))));status(message,'');}
  catch(error){
   if([401,403].includes(error.status))return stop(error.status);if(error.code==='invalid_activity')return stop(400);
   // A failed refresh keeps the last code while it is still accepted; once it has expired the screen says so instead of sending people to a dead code.
   // The screen retries on its own, so a lost connection, an outage or a rate limit says so instead of asking for a retry it has no button for.
   status(message,['error','rate'].includes(error.key)?Object.assign(Error(t('qrRetrying')),{key:'qrRetrying'}):error);if(latest&&parts&&!(serverNow()<time(latest.validUntil)))expire();
  }finally{busy=false;}
 }
 // The screen stays awake while it is shown; the lock is released when the tab is hidden and taken again when it returns.
 function wake(){if(stopped||(lock&&!lock.released)||!globalThis.navigator?.wakeLock)return;navigator.wakeLock.request('screen').then(next=>{if(stopped)next.release?.();else lock=next;},()=>{});}
 async function load(){
  status(message,'loading');
  // The first code does not depend on the programme, so both are asked for at once; a Retry starts a new request, and an unused one is ignored.
  const first=id?api('/api/admin/fiiu/checkin?activityId='+encodeURIComponent(id)):null;first?.catch(()=>{});
  try{festival=await api('/api/fiiu?kind=news');}
  catch(error){status(message,error.key==='error'?Object.assign(Error(t('loadError')),{key:'loadError'}):error);root.replaceChildren(button('retry',load));return;}
  status(message,'');
  if(!id){setTitle();list();timer=setInterval(()=>{if(document.visibilityState==='visible')recheck();},REFRESH);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')recheck();});return;}
  // Only the laboratory and the conference blocks have check-in; any other id gets the explanation, never a code.
  activity=checkinActivities(festival.event).find(block=>block.id===id)||null;setTitle();if(!activity)return stop(400);
  screen();refresh(first);wake();
  timer=setInterval(()=>{if(!stopped&&document.visibilityState==='visible')return refresh();},REFRESH);
  document.addEventListener('visibilitychange',()=>{if(stopped||document.visibilityState!=='visible')return;wake();return refresh();});
 }
 window.nodalI18n?.onChange(()=>{setTitle();recheck();if(latest&&parts){const was=stale;show(latest,false);if(was)expire();}});
 load();
})();
