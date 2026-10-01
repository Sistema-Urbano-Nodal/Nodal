(() => {
 'use strict';
 // Attendee check-in. The QR code on a session screen opens this page with a (the block) and c (a code that changes every minute).
 // The check-in is sent at once and c then leaves the address bar, so a reload or a shared screenshot of the page cannot reuse it;
 // a reload shows the person's confirmation for that block instead (revisit).
 // Every outcome is one ruled block: a title that takes focus, the block it concerns, and the one next step.
 const {t,el,tr,button,link,source,field,api,status,dateNode,limaDate,badges,findActivity,countLabel,hoursLine,limaClock,windowNode,newTabNote}=window.Fiiu;
 const root=document.getElementById('fiiuCheckinRoot'),message=document.getElementById('fiiuStatus');
 const params=new URLSearchParams(location.search),activityId=params.get('a')||'',code=params.get('c')||'';
 const ID=/^[a-z0-9-]{1,60}$/,CODE=/^[A-Za-z0-9_-]{6,64}$/,SHORT=/^[A-Z0-9]{6}$/;
 // The catalogue gives titles, times and venues, the badges and whether registration is open; the check-in never waits for it to start.
 let festival=null;const catalogue=api('/api/fiiu?kind=news').then(data=>{festival=data;},()=>{});
 const find=id=>festival&&id?findActivity(festival.event,id)||null:null,space=()=>document.createTextNode(' ');
 const setTitle=()=>{document.title='NODAL · '+t('checkinPage');};
 function block(titleKey,tone,...nodes){
  const box=el('section','f-checkin'+(tone?' is-'+tone:'')),title=tr('h1',titleKey,'f-checkin-title');title.id='f-checkin-title';title.tabIndex=-1;
  box.setAttribute('aria-labelledby',title.id);box.append(tr('p','checkinPage','f-checkin-kicker'),title,...nodes.filter(Boolean));root.replaceChildren(box,newTabNote());return {box,title};
 }
 function about(activity){
  if(!activity)return null;const box=el('div','f-checkin-activity'),when=el('p','f-checkin-when');
  when.append(dateNode(activity.date,'span','short','f-when-day'));if(activity.time)when.append(el('span','',activity.time));
  box.append(source('p',activity.title,'f-checkin-block'),when);if(activity.venue)box.append(source('p',activity.venue,'f-checkin-venue'));return box;
 }
 const hintOf=key=>tr('p',key,'f-checkin-hint'),actions=(...nodes)=>{const box=el('div','f-actions');box.append(...nodes);return box;};
 function facts(...pairs){const list=el('dl','f-checkin-facts');for(const [key,value] of pairs){const row=el('div','f-checkin-fact');row.append(tr('dt',key),value);list.append(row);}return list;}
 const dd=(...nodes)=>{const node=el('dd');node.append(...nodes);return node;};
 // The code form is the fallback for phones that cannot read the QR code: it sends the 6-character code shown under it.
 function codeForm(){
  const form=el('form','f-form f-code-form'),entry=field('checkinCode',{max:9,required:true}),submit=button('checkinSubmit'),problem=el('p','f-status');submit.type='submit';form.noValidate=true;
  entry.input.autocomplete='off';entry.input.spellcheck=false;entry.input.setAttribute('autocapitalize','characters');entry.input.setAttribute('aria-invalid','false');problem.id='f-code-problem';problem.setAttribute('role','status');
  form.append(entry.wrap,submit,problem);form.addEventListener('input',()=>{entry.input.setAttribute('aria-invalid','false');status(problem,'');});
  form.addEventListener('submit',event=>{
   event.preventDefault();const value=String(entry.input.value).toUpperCase().replace(/[\s-]/g,'');
   if(!SHORT.test(value)){entry.input.setAttribute('aria-invalid','true');entry.input.setAttribute('aria-describedby',problem.id);status(problem,Object.assign(Error(t('checkinCodeInvalid')),{key:'checkinCodeInvalid'}));entry.input.focus();return;}
   run({code:value});
  });
  return form;
 }
 function success(data,body){
  const id=data.activityId||body.activityId,activity=find(id),attendance=Array.isArray(data.attendance)?data.attendance:[],record=attendance.find(row=>row.activityId===id),at=Date.parse(data.checkedInAt||record?.createdAt);
  const time=Number.isFinite(at)?el('time','',limaClock(at)):null;if(time)time.dateTime=new Date(at).toISOString();
  const when=time&&dd(...(activity&&limaDate(new Date(at))!==activity.date?[dateNode(limaDate(new Date(at)),'span','short','f-when-day'),space()]:[]),time);
  let hours=festival?hoursLine(attendance,festival.event):null;
  if(!festival&&Number.isSafeInteger(data.hours?.hours)){hours=el('p','f-hours');hours.append(countLabel(data.hours.hours,'hoursConfirmed','hoursConfirmed'));}
  const earned=festival?el('div','f-badges'):null;if(earned)badges(earned,attendance,festival.event,{heading:'h2'});
  return block(data.result==='checked_in'?'checkedInTitle':'alreadyCheckedIn','ok',about(activity),when&&facts(['checkedInAt',when]),hours,earned,actions(link('viewRegistration','fiiu.html#registration','f-button')));
 }
 function failure(error,body){
  // A typed code names no block, so the block comes from the server's answer when it has one.
  const activity=find(body.activityId||error.activityId),open=typeof error.registrationOpen==='boolean'?error.registrationOpen:festival?.config?.registrationOpen===true,retry=()=>actions(button('retry',()=>run(body)));
  if(error.status===401){
   // Sign-in returns here with the same a and c; if the code expired meanwhile, the page says so and offers the screen code.
   // A typed code names no block and will have changed by then, so sign-in returns to the code form and says a new code is needed.
   if(!body.activityId)return signIn(activity,'/fiiu-checkin.html','signInScanAgainHint');
   return signIn(activity,'/fiiu-checkin.html?a='+encodeURIComponent(body.activityId)+'&c='+encodeURIComponent(body.code),'signInCheckinHint');
  }
  // The laboratory is not a block anyone can add: only an accepted application checks in, so no refusal for it links to the registration.
  const lab=activity?.registration==='application';
  if(error.status===404)return block('notRegistered','warn',about(activity),hintOf(lab?'labNotAcceptedHint':open?'notRegisteredHint':'askDesk'),open&&!lab&&actions(link('register','fiiu.html#registration','f-button')));
  if(error.code==='lab_not_accepted'||(lab&&error.code==='not_in_plan'))return block('labNotAccepted','warn',about(activity),hintOf('labNotAcceptedHint'));
  if(error.code==='not_in_plan')return block('notInPlan','warn',about(activity),hintOf(open?'notInPlanHint':'askDesk'),open&&actions(link('addToRegistration','fiiu.html#registration','f-button')));
  if(error.code==='outside_window'){
   // The server has already judged the time and says when (serverTime), so a phone clock that is off, or a rehearsal clock on the server, cannot turn
   // "closed" into "not open yet". Without serverTime the phone's clock decides which side of the window it fell on (the midpoint absorbs a small error).
   const at=value=>typeof value==='number'?value:Date.parse(value),opensAt=at(error.opensAt),closesAt=at(error.closesAt),judged=at(error.serverTime),known=Number.isFinite(opensAt)&&Number.isFinite(closesAt);
   const early=known&&(Number.isFinite(judged)?judged<opensAt:Date.now()<(opensAt+closesAt)/2);
   const shown=known&&{...(activity||{date:limaDate(new Date(opensAt)),time:''}),checkin:{opensAt:new Date(opensAt).toISOString(),closesAt:new Date(closesAt).toISOString()}};
   return block(early?'checkinNotOpen':'checkinEndedTitle','warn',about(activity),shown&&facts(['checkinWindow',dd(windowNode(shown))]),hintOf(early?'checkinNotOpenHint':'askDesk'));
  }
  if(error.status===410)return block('codeExpired','warn',about(activity),hintOf('expiredHint'),codeForm());
  if(error.code==='invalid_activity')return block('noCheckin','warn',hintOf('noCheckinHint'),actions(link('viewProgramme','fiiu.html#programme','f-button secondary')));
  if(error.status===400)return block('invalidLink','warn',hintOf('invalidLinkHint'),codeForm());
  // A rate limit, an outage or a lost connection: the same check-in can simply be sent again.
  return block('checkinFailedTitle','error',about(activity),reasonOf(error),retry());
 }
 function reasonOf(error){const reason=el('p','f-checkin-hint');reason.dataset.fiiuText=error?.key||'error';reason.textContent=t(reason.dataset.fiiuText);return reason;}
 const signIn=(activity,next,hint)=>block('signInToCheckIn','warn',about(activity),hintOf(hint),actions(link('signin','login.html?next='+encodeURIComponent(next),'f-button')));
 async function run(body){
  const pending=block('checking','',about(find(body.activityId)));pending.box.setAttribute('aria-busy','true');let data,error;
  try{data=await api('/api/fiiu/checkin',body);}catch(err){error=err;}
  await catalogue;(data?success(data,body):failure(error,body)).title.focus();
 }
 // After a check-in the address keeps only a, so a reload (or a phone restoring the tab) lands here without a code.
 // A block already in the person's attendance shows its confirmation again; signed out, the page asks for sign-in first; anything else asks for the screen code.
 async function revisit(id){
  status(message,'loading');let data=null,problem=null;
  try{data=await api('/api/fiiu/registration');}catch(err){problem=err;}
  await catalogue;status(message,'');
  const activity=find(id);
  // Signed out (a sign-in link was followed, then Back or a reload): sign in first, coming back to this block.
  if(problem?.status===401)return signIn(activity,'/fiiu-checkin.html?a='+encodeURIComponent(id),'signInScanAgainHint');
  if(problem)return block('checkinFailedTitle','error',about(activity),reasonOf(problem),actions(button('retry',()=>revisit(id).then(next=>next?.title.focus()))));
  const attendance=Array.isArray(data?.attendance)?data.attendance:[],record=attendance.find(row=>row.activityId===id);
  if(record)return success({result:'already_checked_in',activityId:id,checkedInAt:record.createdAt,attendance,hours:data.hours},{activityId:id});
  if(activity?.registration==='external')return block('noCheckin','warn',hintOf('noCheckinHint'),actions(link('viewProgramme','fiiu.html#programme','f-button secondary')));
  // Signed in with no confirmation for this block: the address alone cannot check in, so ask for the screen code.
  return block('scanAgainTitle','warn',about(activity),hintOf('scanAgainHint'),codeForm());
 }
 setTitle();window.nodalI18n?.onChange(setTitle);status(message,'');
 if(activityId||code){
  if(ID.test(activityId)&&CODE.test(code))run({activityId,code});else if(ID.test(activityId)&&!code)revisit(activityId);else catalogue.then(()=>block('invalidLink','warn',hintOf('invalidLinkHint'),codeForm()));
  if(code)history.replaceState?.(null,'',location.pathname+(activityId?'?a='+encodeURIComponent(activityId):''));
 }else catalogue.then(()=>block('codeEntry','',hintOf('codeEntryHint'),codeForm()));
})();
