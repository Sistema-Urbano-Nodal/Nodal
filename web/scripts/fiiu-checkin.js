(() => {
 'use strict';
 // Attendee check-in. The QR code on a session screen opens this page with a (the block) and c (a code that changes every minute).
 // The check-in is sent at once and c then leaves the address bar, so a reload or a shared screenshot of the page cannot reuse it;
 // a reload shows the person's confirmation for that block instead (revisit).
 // Every outcome is one ruled block: a title that takes focus, the block it concerns, and the one next step.
 const Fiiu=window.Fiiu,{t,el,tr,button,link,source,field,api,status,dateNode,limaDate,badges,festivalBadges,shareText,shareControl,certifiable,certificationName,findActivity,countLabel,hoursLine,limaClock,windowNode,newTabNote,checkinCloses}=Fiiu;
 // Page-only strings join the shared dictionary, so t(), tr() and the language switch in fiiu-ui.js handle them like the rest.
 Object.assign(Fiiu.rows,{
  checkinAccount:['Signed in as','Sesión iniciada como','Conectado como'],
  otherAccountHint:['Registered with another email? Sign in with that account.','¿Te inscribiste con otro correo? Inicia sesión con esa cuenta.','Você se inscreveu com outro e-mail? Entre com essa conta.'],
  useOtherAccount:['Use another account','Usar otra cuenta','Usar outra conta'],
  signInBeforeCodeHint:['Sign in first with your NODAL account (the one you registered with, if you did), or create one. Then type the code.','Primero inicia sesión con tu cuenta de NODAL (la de tu inscripción, si te inscribiste) o crea una. Luego escribe el código.','Primeiro entre com sua conta da NODAL (a da sua inscrição, se você se inscreveu) ou crie uma. Depois digite o código.'],
  signInTypedCodeHint:['Use your NODAL account (the one you registered with, if you did) or create one. If the code expires meanwhile, type the new code from the screen.','Usa tu cuenta de NODAL (la de tu inscripción, si te inscribiste) o crea una. Si el código vence mientras tanto, escribe el código nuevo de la pantalla.','Use sua conta da NODAL (a da sua inscrição, se você se inscreveu) ou crie uma. Se o código expirar nesse meio-tempo, digite o código novo da tela.'],
  // What a first scan unlocked. The milestone names are the console's own (d.badge.fiiu.*.name in i18n-dashboard.js, which this page does not load).
  badgeUnlocked:['Badge unlocked:','Insignia desbloqueada:','Insígnia desbloqueada:'],milestoneReached:['Milestone reached:','Hito alcanzado:','Marco alcançado:'],seeInConsole:['See your badges','Ver tus insignias','Ver suas insígnias'],
  // A conference block takes anyone signed in: someone without a registration confirms joining at the door first (the server's walkIn).
  joinAtDoorTitle:['Confirm your attendance','Confirma tu asistencia','Confirme sua presença'],
  joinAtDoorHint:['You are not registered for FIIU yet. Confirm and we register you with this NODAL account and record your attendance. Your name, email and city are shared with the FIIU organising team to manage your participation.','Aún no tienes inscripción al FIIU. Al confirmar, te inscribimos con esta cuenta de NODAL y registramos tu asistencia. Tu nombre, correo y ciudad se comparten con el equipo organizador del FIIU para gestionar tu participación.','Você ainda não tem inscrição no FIIU. Ao confirmar, inscrevemos você com esta conta da NODAL e registramos sua presença. Seu nome, e-mail e cidade são compartilhados com a equipe organizadora do FIIU para gerenciar sua participação.'],
  joinAtDoor:['Confirm attendance','Confirmar asistencia','Confirmar presença'],
  joinedRegistration:['You are now registered for FIIU with this account. Complete your registration on the FIIU page when you can.','Ya tienes inscripción al FIIU con esta cuenta. Complétala en la página del FIIU cuando puedas.','Agora você tem inscrição no FIIU com esta conta. Complete-a na página do FIIU quando puder.'],
  joinedPlan:['This block was added to your registration.','Añadimos este bloque a tu inscripción.','Adicionamos este bloco à sua inscrição.'],
  milestoneFirst:['First activity','Primera actividad','Primeira atividade'],milestoneFour:['Four panels','Cuatro paneles','Quatro painéis'],milestoneConferences:['All five panels','Los cinco paneles','Os cinco painéis'],milestoneFull:['Full FIIU','FIIU completo','FIIU completo'],
 });
 const root=document.getElementById('fiiuCheckinRoot'),message=document.getElementById('fiiuStatus');
 const params=new URLSearchParams(location.search),activityId=params.get('a')||'',code=params.get('c')||'';
 const ID=/^[a-z0-9-]{1,60}$/,CODE=/^[A-Za-z0-9_-]{6,64}$/,SHORT=/^[A-Z0-9]{6}$/,typedCode=value=>String(value).toUpperCase().replace(/[\s-]/g,'');
 // The catalogue gives titles, times and venues, the badges and whether registration is open; the check-in never waits for it to start.
 let festival=null,shown=null;const catalogue=api('/api/fiiu?kind=news').then(data=>{festival=data;},()=>{});
 const find=id=>festival&&id?findActivity(festival.event,id)||null:null,space=()=>document.createTextNode(' ');
 // A result (and a reload) waits briefly for the programme, never for a stalled one: a confirmation then names its block from the answer, takes the
 // hours from it, and gains its badge when the programme lands; a reload without the programme cannot judge the block, so it asks for the code
 // until the programme lands (completeLater).
 const within=(promise,ms)=>typeof setTimeout==='function'?Promise.race([promise,new Promise(resolve=>setTimeout(resolve,ms))]):promise,shortly=ms=>within(catalogue,ms);
 const setTitle=()=>{document.title='NODAL · '+t('checkinPage');};
 function block(titleKey,tone,...nodes){
  const box=el('section','f-checkin'+(tone?' is-'+tone:'')),title=tr('h1',titleKey,'f-checkin-title');title.id='f-checkin-title';title.tabIndex=-1;
  box.setAttribute('aria-labelledby',title.id);box.append(tr('p','checkinPage','f-checkin-kicker'),title,...nodes.filter(Boolean));root.replaceChildren(box,newTabNote());shown=box;return {box,title};
 }
 function about(activity){
  if(!activity)return null;const box=el('div','f-checkin-activity'),when=el('p','f-checkin-when');
  when.append(dateNode(activity.date,'span','short','f-when-day'));if(activity.time)when.append(el('span','',activity.time));
  box.append(source('p',activity.title,'f-checkin-block'),when);if(activity.venue)box.append(source('p',activity.venue,'f-checkin-venue'));return box;
 }
 const hintOf=key=>tr('p',key,'f-checkin-hint'),actions=(...nodes)=>{const box=el('div','f-actions');box.append(...nodes.filter(Boolean));return box;};
 function facts(...pairs){const list=el('dl','f-checkin-facts');for(const [key,value] of pairs){const row=el('div','f-checkin-fact');row.append(tr('dt',key),value);list.append(row);}return list;}
 const dd=(...nodes)=>{const node=el('dd');node.append(...nodes);return node;};
 // The code form is the fallback for phones that cannot read the QR code: it sends the 6-character code shown under it.
 function codeForm(extra={}){
  const form=el('form','f-form f-code-form'),entry=field('checkinCode',{max:9,required:true}),submit=button('checkinSubmit'),problem=el('p','f-status');submit.type='submit';form.noValidate=true;
  entry.input.autocomplete='off';entry.input.spellcheck=false;entry.input.setAttribute('autocapitalize','characters');entry.input.setAttribute('aria-invalid','false');problem.id='f-code-problem';problem.setAttribute('role','status');
  form.append(entry.wrap,submit,problem);form.addEventListener('input',()=>{entry.input.setAttribute('aria-invalid','false');status(problem,'');});
  form.addEventListener('submit',event=>{
   event.preventDefault();const value=typedCode(entry.input.value);
   if(!SHORT.test(value)){entry.input.setAttribute('aria-invalid','true');entry.input.setAttribute('aria-describedby',problem.id);status(problem,Object.assign(Error(t('checkinCodeInvalid')),{key:'checkinCodeInvalid'}));entry.input.focus();return;}
   run({code:value,...extra});
  });
  return form;
 }
 // Check-in has no opening time, so the server refuses a block (outside_window) only once its check-in has closed: the page says so, with the Lima
 // closing time when the server sent it. The server judged the time, so the phone's clock is not consulted. Without the block (a typed code
 // and no programme) the date is shown too.
 function closedLine(activity,data){
  const closesAt=typeof data.closesAt==='number'?data.closesAt:Date.parse(data.closesAt);if(!Number.isFinite(closesAt))return null;
  const line=el('p','f-checkin-window');line.append(windowNode({...(activity||{date:'',time:''}),checkin:{closesAt:new Date(closesAt).toISOString()}},'closed'));return line;
 }
 // The block the server says it recorded, for when the programme has not arrived (or failed): enough to name it and its day.
 const answered=(activity,id)=>activity&&activity.id===id&&typeof activity.title==='string'&&typeof activity.date==='string'?activity:null;
 // A programme that lands after a result was drawn completes it: the block's name, the badge, or the judgement a reload could not make without it.
 // Only a result still on screen is redrawn, and never one whose code form holds typing or the cursor; focus stays on its title.
 function completeLater(result,redraw){
  if(!festival)catalogue.then(()=>{
   const input=result.box.querySelector('input');
   if(!festival||shown!==result.box||input&&(input.value||document.activeElement===input))return;
   const focused=document.activeElement===result.title,next=redraw();if(focused)next.title.focus();
  });
  return result;
 }
 // What this check-in unlocked: the badges earned with it that were not earned without it, by the console's rule (Fiiu.festivalBadges). The page has no
 // registration, which the rule allows, since what is earned follows from the attendance alone. Only a scan that created the attendance unlocks anything
 // (a repeat scan or a reload does not), and nothing is claimed before the programme lands.
 const MILESTONES={'milestone:first':'milestoneFirst','milestone:four':'milestoneFour','milestone:conferences':'milestoneConferences','milestone:full':'milestoneFull'};
 const SHARE_ORDER=['milestone:full','milestone:conferences','milestone:four','milestone:first'];
 function unlockedBy(data,id,attendance){
  if(data.result!=='checked_in'||!festival)return [];
  const earned=list=>festivalBadges(null,list,festival.event).filter(badge=>badge.state==='earned'),before=new Set(earned(attendance.filter(row=>row.activityId!==id)).map(badge=>badge.id));
  return earned(attendance).filter(badge=>!before.has(badge.id)&&(badge.kind==='session'||MILESTONES[badge.id]));
 }
 // The confirmation shows it, with the way to the console's Recognition ledger. The status line says it once for a screen reader, just after the title takes
 // focus: visually hidden, from plain nodes without data-fiiu-text, so a redraw or a language switch never says it again; the block title keeps lang=es
 // there too, so a screen reader reads it with a Spanish voice.
 let told='';
 function unlockedNews(id,unlocked){
  if(!unlocked.length)return null;const box=el('div','f-unlocked'),spoken=el('span','f-sr-only'),text=value=>document.createTextNode(value);
  for(const badge of unlocked){
   const session=badge.kind==='session',key=session?'badgeUnlocked':'milestoneReached',line=el('p','f-unlocked-line');
   line.append(tr('span',key,'f-unlocked-label'),space(),session?source('span',badge.activity.title):tr('span',MILESTONES[badge.id]));box.append(line);
   spoken.append(text(t(key)+' '),session?source('span',badge.activity.title):text(t(MILESTONES[badge.id])),text('. '));
  }
  // One way to share it, the moment people most want to: the furthest milestone this scan reached, else the block itself.
  const shared=SHARE_ORDER.map(id=>unlocked.find(badge=>badge.id===id)).find(Boolean)||unlocked.find(badge=>badge.kind==='session');
  if(shared)box.append(shareControl(()=>shareText(shared,unlocked),null,certifiable(shared)?()=>certificationName(shared):null));
  box.append(link('seeInConsole','dashboard.html#badges','f-text-link'));
  if(told!==id){told=id;Promise.resolve().then(()=>message.replaceChildren(spoken));}
  return box;
 }
 function success(data,body){
  const id=data.activityId||body.activityId,activity=find(id)||answered(data.activity,id),attendance=Array.isArray(data.attendance)?data.attendance:[],record=attendance.find(row=>row.activityId===id),at=Date.parse(data.checkedInAt||record?.createdAt);
  const time=Number.isFinite(at)?el('time','',limaClock(at)):null;if(time)time.dateTime=new Date(at).toISOString();
  // A check-in on another day than the block (any day before it) names that day: "Checked in on Wed 7 Oct at 10:00", since "Registrada a las" only fits a time.
  // Without the block (a reload before the programme) the day is always named, as it cannot be compared.
  const day=time&&(!activity||limaDate(new Date(at))!==activity.date)?limaDate(new Date(at)):'',when=time&&(day?dd(dateNode(day,'span','short','f-when-day'),space(),tr('span','atClock'),space(),time):dd(time));
  let hours=festival?hoursLine(attendance,festival.event):null;
  if(!festival&&Number.isSafeInteger(data.hours?.hours)){hours=el('p','f-hours');hours.append(countLabel(data.hours.hours,'hoursConfirmed','hoursConfirmed'));}
  const earned=festival?el('div','f-badges'):null;if(earned)badges(earned,attendance,festival.event,{heading:'h2'});
  const news=unlockedNews(id,unlockedBy(data,id,attendance));
  // What the scan added first: a registration made at the door, or this block joining the plan.
  const joined=data.joined==='registration'?hintOf('joinedRegistration'):data.joined==='plan'?hintOf('joinedPlan'):null;
  // The account the attendance belongs to, and another one: a phone lent to someone checks in its owner, so the screen says whose check-in it is.
  // Another account comes back to the same code (a scan or a typed one) while it lasts; a reload, which has no code, to the block.
  const account=typeof data.account==='string'&&data.account?['checkinAccount',dd(el('span','',data.account))]:null,pairs=[when&&[day?'checkedInOn':'checkedInAt',when],account].filter(Boolean);
  const next=body.code?returnTo(body):'/fiiu-checkin.html?a='+encodeURIComponent(id);
  return completeLater(block(data.result==='checked_in'?'checkedInTitle':'alreadyCheckedIn','ok',about(activity),pairs.length&&facts(...pairs),joined,news,hours,earned,actions(link('viewRegistration','fiiu.html#registration','f-button'),otherAccount(next))),()=>success(data,body));
 }
 // A refusal drawn before the programme arrived has only the block's id (a typed code, or slow Wi-Fi); the programme names the block later.
 function failure(error,body,account){
  const result=refusal(error,body,account);return body.activityId||error.activityId?completeLater(result,()=>failure(error,body,account)):result;
 }
 function refusal(error,body,account){
  // A typed code names no block, so the block comes from the server's answer when it has one.
  const activity=find(body.activityId||error.activityId),open=typeof error.registrationOpen==='boolean'?error.registrationOpen:festival?.config?.registrationOpen===true,retry=()=>actions(button('retry',()=>run(body)));
  // The registration opens with this block ticked (fiiu.html #add-); the id comes from the answer when the programme has not arrived.
  const id=activity?.id||body.activityId||error.activityId,addHref=id?'fiiu.html#add-'+encodeURIComponent(id):'fiiu.html#registration';
  // Sign-in returns here with the same code, scanned or typed (codes last 5 minutes); if it expired meanwhile, the page says so and offers the code form.
  // A typed code came from someone whose camera could not scan, so their hint points to the screen's new code rather than a fresh scan.
  if(error.status===401)return signIn(activity,returnTo(body),body.activityId?'signInCheckinHint':'signInTypedCodeHint');
  const lab=(activity?.registration??error?.registration)==='application';
  if(error.status===404)return error.walkIn===true&&!lab?joinAtDoor(activity,body,account):unregistered(activity,{open,lab,addHref,account,next:returnTo(body)});
  if(error.code==='lab_not_accepted'||error.code==='not_in_plan')return outsidePlan(activity,{open,lab:lab||error.code==='lab_not_accepted',addHref});
  if(error.code==='outside_window')return ended(activity,error);
  // A code that expired while the person read the door confirmation keeps their yes: the screen's new code joins at once.
  if(error.status===410)return block('codeExpired','warn',about(activity),hintOf('expiredHint'),codeForm(body.join===true?{join:true,language:body.language}:{}));
  if(error.code==='invalid_activity')return block('noCheckin','warn',hintOf('noCheckinHint'),actions(link('viewProgramme','fiiu.html#programme','f-button secondary')));
  if(error.status===400)return block('invalidLink','warn',hintOf('invalidLinkHint'),codeForm());
  // A rate limit, an outage or a lost connection: the same check-in can simply be sent again.
  return block('checkinFailedTitle','error',about(activity),reasonOf(error),retry());
 }
 // The refusals a scan gets from the server, and a reload works out from the registration lookup, read the same either way.
 // The laboratory is not a block anyone can add: only an accepted application checks in, so no refusal for it links to the registration.
 // Someone without a registration may be signed in to another account than the one they registered with (a work and a personal email): the refusal
 // names this account and offers another, so nobody registers twice and splits their hours. account is '' when the lookup did not answer in time.
 const accountFact=account=>account?facts(['checkinAccount',dd(el('span','',account))]):null;
 const unregistered=(activity,{open,lab,addHref,account,next})=>block('notRegistered','warn',about(activity),accountFact(account),
  hintOf(lab?'labNotAcceptedHint':open?'notRegisteredHint':'askDesk'),hintOf('otherAccountHint'),actions(open&&!lab&&link('register',addHref,'f-button'),otherAccount(next)));
 // At a conference block the server registers someone at the door once they say so (join): the block says what that shares and with which account,
 // and still offers another account, so nobody who registered with another email registers twice. The same code goes again (codes last 5 minutes).
 // The privacy policy opens in a new tab, so reading it never costs the code on this one.
 const joinAtDoor=(activity,body,account)=>{
  const privacy=link('privacy','privacy.html','f-text-link');privacy.target='_blank';privacy.rel='noopener';privacy.setAttribute('aria-describedby','f-newtab');
  return block('joinAtDoorTitle','',about(activity),accountFact(account),hintOf('joinAtDoorHint'),hintOf('otherAccountHint'),
   actions(button('joinAtDoor',()=>run({...body,join:true,language:window.nodalI18n?.lang||document.documentElement.lang||''})),privacy,otherAccount(returnTo(body))));
 };
 // Another account means signing out first; sign-in then comes back to next (the same block, and the code while it lasts: 5 minutes, then the code form).
 function otherAccount(next){
  const control=button('useOtherAccount',async()=>{
   if(control.disabled)return;control.disabled=true;
   try{await api('/api/auth/logout',{},'POST');location.assign('/login.html?next='+encodeURIComponent(next));}catch(error){control.disabled=false;status(message,error);}
  },'f-button secondary');
  return control;
 }
 // Where a sign-in comes back to: the same code, with the block when the link named one.
 const returnTo=body=>'/fiiu-checkin.html?'+(body.activityId?'a='+encodeURIComponent(body.activityId)+'&':'')+'c='+encodeURIComponent(body.code);
 const outsidePlan=(activity,{open,lab,addHref})=>lab?block('labNotAccepted','warn',about(activity),hintOf('labNotAcceptedHint')):block('notInPlan','warn',about(activity),hintOf(open?'notInPlanHint':'askDesk'),open&&actions(link('addToRegistration',addHref,'f-button')));
 const ended=(activity,data)=>block('checkinEndedTitle','warn',about(activity),closedLine(activity,data),hintOf('askDesk'));
 function reasonOf(error){const reason=el('p','f-checkin-hint');reason.dataset.fiiuText=!error?.key||error.key==='error'?'checkinError':error.key;reason.textContent=t(reason.dataset.fiiuText);return reason;}
 const signIn=(activity,next,hint)=>block('signInToCheckIn','warn',about(activity),hintOf(hint),actions(link('signin','login.html?next='+encodeURIComponent(next),'f-button')));
 async function run(body){
  const pending=block('checking','',about(find(body.activityId)));pending.box.setAttribute('aria-busy','true');let data,error,account='';
  try{data=await api('/api/fiiu/checkin',body);}catch(err){error=err;}
  // A "not registered" refusal names the signed-in account; like the programme, that lookup holds the result only briefly.
  const who=error?.status===404?api('/api/fiiu/registration').then(reply=>{account=reply.user.email;},()=>{}):null;
  await Promise.all([shortly(1500),who&&within(who,1500)]);const shownNow=(data?success(data,body):failure(error,body,account));shownNow.title.focus();
  // A lookup slower than that names the account once it answers, on the refusal or the door confirmation still on screen.
  if(who&&!account)who.then(()=>{const box=shown;if(!account||!box||box.querySelector('.f-checkin-facts'))return;box.querySelector('.f-checkin-hint')?.before(accountFact(account));});
 }
 // After a check-in the address keeps only a, so a reload (or a phone restoring the tab) lands here without a code, as does a new account back from
 // its confirmation email. A block already in the person's attendance shows its confirmation again; signed out, the page asks for sign-in first;
 // a scan the server would refuse gets that refusal now; only a scan that would go through asks for the screen code.
 async function revisit(id){
  status(message,'loading');let data=null,problem=null;
  try{data=await api('/api/fiiu/registration');}catch(err){problem=err;}
  await shortly(1500);status(message,'');
  // A programme that lands later judges the block from the same lookup, which is not repeated.
  return completeLater(judge(id,data,problem),()=>judge(id,data,problem));
 }
 function judge(id,data,problem){
  const activity=find(id);
  // Signed out (a sign-in link was followed, then Back or a reload): sign in first, coming back to this block.
  if(problem?.status===401)return signIn(activity,'/fiiu-checkin.html?a='+encodeURIComponent(id),'signInScanAgainHint');
  // Only the lookup failed: nothing was sent, and a check-in already made is saved.
  if(problem)return block('checkinLoadFailed','error',about(activity),problem.key==='rate'?reasonOf(problem):hintOf('checkinLoadFailedHint'),actions(button('retry',()=>revisit(id).then(next=>next?.title.focus()))));
  const attendance=Array.isArray(data?.attendance)?data.attendance:[],record=attendance.find(row=>row.activityId===id);
  if(record)return success({result:'already_checked_in',activityId:id,checkedInAt:record.createdAt,attendance,hours:data.hours,account:data.user.email},{activityId:id});
  if(activity?.registration==='external')return block('noCheckin','warn',hintOf('noCheckinHint'),actions(link('viewProgramme','fiiu.html#programme','f-button secondary')));
  // In the server's order: closed (by the server's clock in this answer; an answer without it judges nothing), then no registration, then the plan.
  // Without the programme the block is unknown, so the screen code lets the server judge.
  if(activity){
   const now=Date.parse(data.serverTime),closesAt=checkinCloses(activity),registration=data.registration;
   const open=festival.config?.registrationOpen===true,lab=activity.registration==='application',addHref='fiiu.html#add-'+encodeURIComponent(id);
   if(Number.isFinite(now)&&now>closesAt)return ended(activity,{closesAt});
   // The server's rule: the laboratory needs an accepted application; while registration is open a conference block takes anyone signed in (the
   // scan registers them at the door or adds the block to their plan), and once it closes only a block in the registration.
   const joinable=open&&!lab;
   if(!registration&&!joinable)return unregistered(activity,{open,lab,addHref,account:data.user.email,next:'/fiiu-checkin.html?a='+encodeURIComponent(id)});
   if(registration&&(lab?registration.labStatus!=='accepted':!joinable&&!registration.answers.activities.includes(id)))return outsidePlan(activity,{open,lab,addHref});
  }
  // Signed in for an open block and not yet checked in: the address alone cannot check in, so ask for the screen code.
  return block('scanAgainTitle','warn',about(activity),hintOf('scanAgainHint'),codeForm());
 }
 setTitle();window.nodalI18n?.onChange(setTitle);status(message,'');
 if(activityId||code){
  // A lone c is a typed code back from sign-in; it is sent, then leaves the address bar like a scanned one.
  if(ID.test(activityId)&&CODE.test(code))run({activityId,code});else if(!activityId&&SHORT.test(typedCode(code)))run({code:typedCode(code)});
  else if(ID.test(activityId)&&!code)revisit(activityId);else block('invalidLink','warn',hintOf('invalidLinkHint'),codeForm());
  if(code)history.replaceState?.(null,'',location.pathname+(activityId?'?a='+encodeURIComponent(activityId):''));
 }else{
  // A typed code needs an account, so a signed-out visitor is told before typing one. The session check (a 200 either way, so no console error for
  // guests) never holds the form back, and the note joins the block only while it is still on screen; a code sent signed out still comes back through sign-in.
  const form=codeForm(),entry=block('codeEntry','',hintOf('codeEntryHint'),form);
  api('/api/auth/state').then(state=>{
   if(state.authenticated!==false||shown!==entry.box)return;
   const note=el('div','f-checkin-signin');note.append(hintOf('signInBeforeCodeHint'),actions(link('signin','login.html?next='+encodeURIComponent('/fiiu-checkin.html'),'f-button secondary')));form.before(note);
  },()=>{});
 }
})();
