(() => {
 'use strict';
 // Attendee check-in. The QR code on a session screen opens this page with a (the block) and c (a code that changes every minute).
 // The check-in is sent at once and c then leaves the address bar, so a reload or a shared screenshot of the page cannot reuse it;
 // a reload shows the person's confirmation for that block instead (revisit).
 // Every outcome is one ruled block: a title that takes focus, the block it concerns, and the one next step.
 const Fiiu=window.Fiiu,{t,el,tr,button,link,source,field,api,status,dateNode,limaDate,badges,findActivity,countLabel,hoursLine,limaClock,windowNode,newTabNote,checkinCloses}=Fiiu;
 // Page-only strings join the shared dictionary, so t(), tr() and the language switch in fiiu-ui.js handle them like the rest.
 Object.assign(Fiiu.rows,{
  checkinAccount:['Signed in as','Sesión iniciada como','Conectado como'],
  otherAccountHint:['Registered with another email? Sign in with that account.','¿Te inscribiste con otro correo? Inicia sesión con esa cuenta.','Você se inscreveu com outro e-mail? Entre com essa conta.'],
  useOtherAccount:['Use another account','Usar otra cuenta','Usar outra conta'],
  signInBeforeCodeHint:['Sign in first, with the account you registered with. Then type the code.','Primero inicia sesión con la cuenta con la que te inscribiste. Luego escribe el código.','Primeiro entre com a conta com que você se inscreveu. Depois digite o código.'],
 });
 const root=document.getElementById('fiiuCheckinRoot'),message=document.getElementById('fiiuStatus');
 const params=new URLSearchParams(location.search),activityId=params.get('a')||'',code=params.get('c')||'';
 const ID=/^[a-z0-9-]{1,60}$/,CODE=/^[A-Za-z0-9_-]{6,64}$/,SHORT=/^[A-Z0-9]{6}$/,typedCode=value=>String(value).toUpperCase().replace(/[\s-]/g,'');
 // The catalogue gives titles, times and venues, the badges and whether registration is open; the check-in never waits for it to start.
 let festival=null,shown=null;const catalogue=api('/api/fiiu?kind=news').then(data=>{festival=data;},()=>{});
 const find=id=>festival&&id?findActivity(festival.event,id)||null:null,space=()=>document.createTextNode(' ');
 // A result (and a reload) waits briefly for the programme, never for a stalled one: a confirmation then names its block from the answer, takes the
 // hours from it, and gains its badge when the programme lands; a reload without the programme cannot judge the block, so it asks for the code.
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
 function codeForm(){
  const form=el('form','f-form f-code-form'),entry=field('checkinCode',{max:9,required:true}),submit=button('checkinSubmit'),problem=el('p','f-status');submit.type='submit';form.noValidate=true;
  entry.input.autocomplete='off';entry.input.spellcheck=false;entry.input.setAttribute('autocapitalize','characters');entry.input.setAttribute('aria-invalid','false');problem.id='f-code-problem';problem.setAttribute('role','status');
  form.append(entry.wrap,submit,problem);form.addEventListener('input',()=>{entry.input.setAttribute('aria-invalid','false');status(problem,'');});
  form.addEventListener('submit',event=>{
   event.preventDefault();const value=typedCode(entry.input.value);
   if(!SHORT.test(value)){entry.input.setAttribute('aria-invalid','true');entry.input.setAttribute('aria-describedby',problem.id);status(problem,Object.assign(Error(t('checkinCodeInvalid')),{key:'checkinCodeInvalid'}));entry.input.focus();return;}
   run({code:value});
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
 function success(data,body){
  const id=data.activityId||body.activityId,activity=find(id)||answered(data.activity,id),attendance=Array.isArray(data.attendance)?data.attendance:[],record=attendance.find(row=>row.activityId===id),at=Date.parse(data.checkedInAt||record?.createdAt);
  const time=Number.isFinite(at)?el('time','',limaClock(at)):null;if(time)time.dateTime=new Date(at).toISOString();
  // A check-in on another day than the block (any day before it) names that day: "Checked in on Wed 7 Oct at 10:00", since "Registrada a las" only fits a time.
  const day=time&&activity&&limaDate(new Date(at))!==activity.date?limaDate(new Date(at)):'',when=time&&(day?dd(dateNode(day,'span','short','f-when-day'),space(),tr('span','atClock'),space(),time):dd(time));
  let hours=festival?hoursLine(attendance,festival.event):null;
  if(!festival&&Number.isSafeInteger(data.hours?.hours)){hours=el('p','f-hours');hours.append(countLabel(data.hours.hours,'hoursConfirmed','hoursConfirmed'));}
  const earned=festival?el('div','f-badges'):null;if(earned)badges(earned,attendance,festival.event,{heading:'h2'});
  const result=block(data.result==='checked_in'?'checkedInTitle':'alreadyCheckedIn','ok',about(activity),when&&facts([day?'checkedInOn':'checkedInAt',when]),hours,earned,actions(link('viewRegistration','fiiu.html#registration','f-button')));
  // A programme that lands later completes the confirmation (the badge, and the block if the answer had none). Only this block is redrawn, as it
  // has no form to lose, and only while it is still shown; focus stays on its title.
  if(!festival)catalogue.then(()=>{if(!festival||shown!==result.box)return;const focused=document.activeElement===result.title,next=success(data,body);if(focused)next.title.focus();});
  return result;
 }
 function failure(error,body,account){
  // A typed code names no block, so the block comes from the server's answer when it has one.
  const activity=find(body.activityId||error.activityId),open=typeof error.registrationOpen==='boolean'?error.registrationOpen:festival?.config?.registrationOpen===true,retry=()=>actions(button('retry',()=>run(body)));
  // The registration opens with this block ticked (fiiu.html #add-); the id comes from the answer when the programme has not arrived.
  const id=activity?.id||body.activityId||error.activityId,addHref=id?'fiiu.html#add-'+encodeURIComponent(id):'fiiu.html#registration';
  // Sign-in returns here with the same code, scanned or typed (codes last 5 minutes); if it expired meanwhile, the page says so and offers the code form.
  if(error.status===401)return signIn(activity,returnTo(body),'signInCheckinHint');
  const lab=(activity?.registration??error?.registration)==='application';
  if(error.status===404)return unregistered(activity,{open,lab,addHref,account,next:returnTo(body)});
  if(error.code==='lab_not_accepted'||error.code==='not_in_plan')return outsidePlan(activity,{open,lab:lab||error.code==='lab_not_accepted',addHref});
  if(error.code==='outside_window')return ended(activity,error);
  if(error.status===410)return block('codeExpired','warn',about(activity),hintOf('expiredHint'),codeForm());
  if(error.code==='invalid_activity')return block('noCheckin','warn',hintOf('noCheckinHint'),actions(link('viewProgramme','fiiu.html#programme','f-button secondary')));
  if(error.status===400)return block('invalidLink','warn',hintOf('invalidLinkHint'),codeForm());
  // A rate limit, an outage or a lost connection: the same check-in can simply be sent again.
  return block('checkinFailedTitle','error',about(activity),reasonOf(error),retry());
 }
 // The refusals a scan gets from the server, and a reload works out from the registration lookup, read the same either way.
 // The laboratory is not a block anyone can add: only an accepted application checks in, so no refusal for it links to the registration.
 // Someone without a registration may be signed in to another account than the one they registered with (a work and a personal email): the refusal
 // names this account and offers another, so nobody registers twice and splits their hours. account is '' when the lookup did not answer in time.
 const unregistered=(activity,{open,lab,addHref,account,next})=>block('notRegistered','warn',about(activity),account&&facts(['checkinAccount',dd(el('span','',account))]),
  hintOf(lab?'labNotAcceptedHint':open?'notRegisteredHint':'askDesk'),hintOf('otherAccountHint'),actions(open&&!lab&&link('register',addHref,'f-button'),otherAccount(next)));
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
  await Promise.all([shortly(1500),who&&within(who,1500)]);(data?success(data,body):failure(error,body,account)).title.focus();
 }
 // After a check-in the address keeps only a, so a reload (or a phone restoring the tab) lands here without a code, as does a new account back from
 // its confirmation email. A block already in the person's attendance shows its confirmation again; signed out, the page asks for sign-in first;
 // a scan the server would refuse gets that refusal now; only a scan that would go through asks for the screen code.
 async function revisit(id){
  status(message,'loading');let data=null,problem=null;
  try{data=await api('/api/fiiu/registration');}catch(err){problem=err;}
  await shortly(1500);status(message,'');
  const activity=find(id);
  // Signed out (a sign-in link was followed, then Back or a reload): sign in first, coming back to this block.
  if(problem?.status===401)return signIn(activity,'/fiiu-checkin.html?a='+encodeURIComponent(id),'signInScanAgainHint');
  // Only the lookup failed: nothing was sent, and a check-in already made is saved.
  if(problem)return block('checkinLoadFailed','error',about(activity),problem.key==='rate'?reasonOf(problem):hintOf('checkinLoadFailedHint'),actions(button('retry',()=>revisit(id).then(next=>next?.title.focus()))));
  const attendance=Array.isArray(data?.attendance)?data.attendance:[],record=attendance.find(row=>row.activityId===id);
  if(record)return success({result:'already_checked_in',activityId:id,checkedInAt:record.createdAt,attendance,hours:data.hours},{activityId:id});
  if(activity?.registration==='external')return block('noCheckin','warn',hintOf('noCheckinHint'),actions(link('viewProgramme','fiiu.html#programme','f-button secondary')));
  // In the server's order: closed (by the server's clock in this answer; an answer without it judges nothing), then no registration, then the plan.
  // Without the programme the block is unknown, so the screen code lets the server judge.
  if(activity){
   const now=Date.parse(data.serverTime),closesAt=checkinCloses(activity),registration=data.registration;
   const open=festival.config?.registrationOpen===true,lab=activity.registration==='application',addHref='fiiu.html#add-'+encodeURIComponent(id);
   if(Number.isFinite(now)&&now>closesAt)return ended(activity,{closesAt});
   if(!registration)return unregistered(activity,{open,lab,addHref,account:data.user.email,next:'/fiiu-checkin.html?a='+encodeURIComponent(id)});
   // The server's rule (canAttend): a conference block must be in the plan, the laboratory needs an accepted application.
   if(activity.registration==='general'?!registration.answers.activities.includes(id):lab&&registration.labStatus!=='accepted')return outsidePlan(activity,{open,lab,addHref});
  }
  // Signed in, registered for an open block and not yet checked in: the address alone cannot check in, so ask for the screen code.
  return block('scanAgainTitle','warn',about(activity),hintOf('scanAgainHint'),codeForm());
 }
 setTitle();window.nodalI18n?.onChange(setTitle);status(message,'');
 if(activityId||code){
  // A lone c is a typed code back from sign-in; it is sent, then leaves the address bar like a scanned one.
  if(ID.test(activityId)&&CODE.test(code))run({activityId,code});else if(!activityId&&SHORT.test(typedCode(code)))run({code:typedCode(code)});
  else if(ID.test(activityId)&&!code)revisit(activityId);else block('invalidLink','warn',hintOf('invalidLinkHint'),codeForm());
  if(code)history.replaceState?.(null,'',location.pathname+(activityId?'?a='+encodeURIComponent(activityId):''));
 }else{
  // A typed code needs an account, so a signed-out visitor is told before typing one. The lookup never holds the form back, and the note joins
  // the block only while it is still on screen; a code sent signed out anyway still comes back through sign-in.
  const form=codeForm(),entry=block('codeEntry','',hintOf('codeEntryHint'),form);
  api('/api/fiiu/registration').catch(error=>{
   if(error.status!==401||shown!==entry.box)return;
   const note=el('div','f-checkin-signin');note.append(hintOf('signInBeforeCodeHint'),actions(link('signin','login.html?next='+encodeURIComponent('/fiiu-checkin.html'),'f-button secondary')));form.before(note);
  });
 }
})();
