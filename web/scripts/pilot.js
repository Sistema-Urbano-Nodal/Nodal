(() => {
'use strict';
const t=k=>window.pilotI18n?.t(k)||k;
const localizedBindings=new WeakMap();
let titleSource=null;
const language=()=>window.nodalI18n?.lang||'en';
function localized(record,key,lang=language()){
  const value=record?.translations?.[lang]?.[key];
  return typeof value==='string'&&value.trim()?value:String(record?.[key]??'');
}
function hasLocalized(record,key){return Boolean(record?.[key]||Object.values(record?.translations||{}).some(fields=>fields?.[key]?.trim()));}
function bind(node,update){node.dataset.pilotDynamic='true';localizedBindings.set(node,update);update();return node;}
function dynamic(tag,text,cls){const node=el(tag,cls);return bind(node,()=>{node.textContent=text();});}
function source(tag,record,key,cls){return dynamic(tag,()=>localized(record,key),cls);}
function setPageTitle(value){titleSource=typeof value==='function'?value:()=>t(value);document.title=titleSource()+' · NODAL';}

function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function tr(tag,key,cls){const n=el(tag,cls,t(key));n.dataset.pilotText=key;return n;}
function translate(){document.querySelectorAll('[data-pilot-text]').forEach(n=>{n.textContent=t(n.dataset.pilotText);});document.querySelectorAll('[data-pilot-aria]').forEach(n=>n.setAttribute('aria-label',t(n.dataset.pilotAria)));document.querySelectorAll('[data-pilot-placeholder]').forEach(n=>n.setAttribute('placeholder',t(n.dataset.pilotPlaceholder)));document.querySelectorAll('[data-pilot-dynamic]').forEach(n=>localizedBindings.get(n)?.());if(titleSource)document.title=titleSource()+' · NODAL';}
function translatedError(key,statusCode,fieldKey){return Object.assign(new Error(t(key)),{translationKey:key,status:statusCode,fieldKey});}
function requestError(data,statusCode){
  const codes={participant_not_found:'participantNotFound',participant_unconfirmed:'participantUnconfirmed',participant_unavailable:'participantUnavailable',invitation_unavailable:'invitationUnavailable',invitation_uncertain:'invitationUncertain',invitation_rate:'tooManyRequests',invitation_email:'participantEmailError'};
  if(codes[data.code])return Object.assign(translatedError(codes[data.code],statusCode),{code:data.code});
  const detail=String(data.error||'');
  if(/enroll and complete/.test(detail))return translatedError('intakeRequired',statusCode);
  if(/enrollment is closed/.test(detail))return translatedError('closed',statusCode);
  if(/remove the material from module resources/.test(detail))return translatedError('fileStillLinked',statusCode);
  if(/pending uploads must be reconciled/.test(detail))return translatedError('filePending',statusCode);
  if(/parent post unavailable/.test(detail))return translatedError('replyUnavailable',statusCode);
  if(/post identifier is already used/.test(detail))return translatedError('alreadySubmitted',statusCode);
  const field=detail.match(/^(fullName|profession|city|motivation|experience|expectations|caseStudy|digitalFamiliarity|title|description|objectives|instructions|post) (is required|is too long)/);
  if(field)return translatedError(field[2]==='is required'?'requiredField':'longField',statusCode,field[1]==='post'?'body':field[1]);
  return translatedError(({400:'invalidInput',403:'accessDenied',404:'notAvailable',409:'conflict',413:'fileError',415:'fileError',429:'tooManyRequests'})[statusCode]||'error',statusCode);
}
async function api(path,body,method,options={}){
  let res;
  const signal=options.signal||(typeof AbortSignal!=='undefined'&&typeof AbortSignal.timeout==='function'?AbortSignal.timeout(45000):undefined);
  try{res=await fetch(path,{...(body===undefined?{}:{method:method||'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),...(signal?{signal}:{})});}
  catch(error){if(error.name==='AbortError')throw error;if(error.name==='TimeoutError')throw Object.assign(translatedError('requestTimeout'),{name:'TimeoutError'});throw translatedError('connectionError');}
  let data;
  try{data=await res.json();}
  catch(error){
    // A truncated success body cannot confirm that a write completed.
    // Preserve HTTP error handling even when its body is an HTML error page.
    if(res.ok){if(error.name==='AbortError')throw error;if(error.name==='TimeoutError')throw Object.assign(translatedError('requestTimeout'),{name:'TimeoutError'});throw translatedError('connectionError');}
    data={};
  }
  if(res.status===401){if(options.redirectOnUnauthorized!==false)location.assign('/login.html?next='+encodeURIComponent(location.pathname+location.search));throw translatedError('signInRequired',401);}
  if(!res.ok)throw requestError(data,res.status);
  return data;
}
function status(node,error){
  localizedBindings.delete(node);delete node.dataset.pilotDynamic;
  const value=error?.message||error||'';
  const key=error?.translationKey||Object.entries(window.pilotI18n?.rows||{}).find(([,values])=>values.includes(value))?.[0];
  if(key)bind(node,()=>{node.textContent=t(key).replace('{field}',error?.fieldKey?t(error.fieldKey):'');});else node.textContent=value;
  node.classList.toggle('is-error',error instanceof Error);
}

function button(key,fn,secondary=false){const b=tr('button',key,'pilot-button'+(secondary?' secondary':''));b.type='button';if(fn)b.addEventListener('click',fn);return b;}
function field(key,value='',type='text'){const label=tr('span',key);const wrap=el('label');const input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.name=key;if(type==='checkbox')input.checked=!!value;else input.value=value??'';wrap.append(label,input);return {wrap,input};}
function select(key,values,value){const wrap=el('label');wrap.append(tr('span',key));const input=el('select');input.name=key;values.forEach(v=>{const o=tr('option',v);o.value=v;input.append(o);});input.value=value||values[0];wrap.append(input);return{wrap,input};}
function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function date(value){return value?new Intl.DateTimeFormat(window.nodalI18n?.lang||'en',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z')):'';}
function feedback(action,context={}) {
  const box=el('details','pilot-feedback');box.append(tr('summary','feedback_'+action));
  const history=el('details','pilot-feedback-history'),list=el('div'),historyStatus=el('p','pilot-status');
  historyStatus.setAttribute('role','status');
  let loaded=false,loading=false,cursor=null,revision=0,pendingMutations=0;
  const drafts=new Set();box.hasDraft=()=>pendingMutations>0||[...drafts].some(hasDraft=>hasDraft());
  const cards=new Map(),empty=tr('p','noOwnFeedback');
  const more=button('moreFeedback',()=>loadHistory(true),true);more.hidden=true;
  function updateEmpty(){empty.remove();if(!cards.size&&!cursor)list.append(empty);}
  function formFor(record,onSaved,onCancel) {
    let busy=false;const form=el('form'),score=el('fieldset','pilot-rating');score.append(tr('legend','rating'));
    const group='rating-'+crypto.randomUUID(),ratings=[];
    for(let i=1;i<=5;i++) {
      const label=el('label'),input=el('input');input.type='radio';input.name=group;input.value=String(i);input.required=true;
      input.checked=record?.rating===i;input.setAttribute('aria-label',String(i)+' / 5');
      const star=el('span',null,'★');star.setAttribute('aria-hidden','true');label.append(input,star,el('small',null,String(i)));score.append(label);ratings.push(input);
    }
    const comment=field('optional',record?.comment||'','textarea');comment.input.maxLength=2000;comment.input.dataset.pilotAria='optional';comment.input.setAttribute('aria-label',t('optional'));
    const commentDetails=el('details','pilot-feedback-comment');commentDetails.open=Boolean(record?.comment);commentDetails.append(tr('summary','addComment'),comment.wrap);
    const submit=button(record?'saveFeedback':'sendFeedback');submit.type='submit';
    const msg=el('p','pilot-status');msg.setAttribute('role','status');form.append(score,commentDetails,submit);
    const hasDraft=()=>busy||Boolean(record)||ratings.some(input=>input.checked)||Boolean(comment.input.value.trim());drafts.add(hasDraft);
    const cancel=onCancel?button('cancel',()=>{if(!busy){drafts.delete(hasDraft);onCancel();}},true):null;if(cancel)form.append(cancel);form.append(msg);
    form.addEventListener('submit',async e=>{
      e.preventDefault();e.stopPropagation();if(busy)return;
      const selected=ratings.find(input=>input.checked);if(!selected){status(msg,new Error(t('chooseRating')));return;}
      busy=true;form.setAttribute('aria-busy','true');const controls=[...ratings,comment.input,submit,...(cancel?[cancel]:[])];controls.forEach(input=>{input.disabled=true;});
      try {
        const values={rating:Number(selected.value),comment:comment.input.value};
        const payload=record?values:{action,...context,...values};
        const result=await api(record?'/api/feedback/'+encodeURIComponent(record.id):'/api/feedback',payload,record?'PATCH':'POST',{redirectOnUnauthorized:false});
        if(!result.feedback?.id)throw translatedError('connectionError');
        revision++;drafts.delete(hasDraft);onSaved({...record,...payload,createdAt:record?.createdAt||new Date().toISOString(),...result.feedback},form);
      }catch(err){status(msg,err);}
      finally{busy=false;form.setAttribute('aria-busy','false');controls.forEach(input=>{input.disabled=false;});}
    });
    return form;
  }
  function cardFor(record) {
    const card=el('article','pilot-post');
    const meta=el('div','pilot-date');meta.append(tr('strong',record.action),dynamic('small',()=>new Date(record.createdAt).toLocaleString(language())));
    card.append(meta,dynamic('p',()=>t('rating')+': '+record.rating+' / 5'),el('p',null,record.comment||''));
    if(record.courseId){const link=tr('a','feedbackCourseLink');link.href='course.html?'+new URLSearchParams({id:record.courseId,...(record.moduleId?{module:record.moduleId}:{})});card.append(link);}
    const actions=el('div','pilot-actions'),message=el('p','pilot-status');message.setAttribute('role','status');let busy=false;
    const edit=button('editFeedback',()=>{
      if(busy)return;busy=true;actions.hidden=true;
      const editor=formFor(record,(saved)=>replaceCard(record.id,saved),()=>{editor.remove();actions.hidden=false;busy=false;});
      card.append(editor);editor.querySelector('textarea')?.focus();
    },true);
    const remove=button('deleteFeedback',async()=>{
      if(busy||!confirm(t('confirmDeleteFeedback')))return;busy=true;pendingMutations++;edit.disabled=true;remove.disabled=true;
      try{await api('/api/feedback/'+encodeURIComponent(record.id),{},'DELETE',{redirectOnUnauthorized:false});revision++;card.remove();cards.delete(record.id);updateEmpty();status(historyStatus,t('feedbackDeleted'));}
      catch(err){status(message,err);}finally{busy=false;pendingMutations--;edit.disabled=false;remove.disabled=false;}
    },true);
    actions.append(edit,remove);card.append(actions,message);return card;
  }
  function replaceCard(id,record){const previous=cards.get(id),card=cardFor(record);if(previous)previous.replaceWith(card);else list.prepend(card);cards.set(id,card);updateEmpty();}
  function newForm() {
    return formFor(null,(record,form)=>{
      if(loaded)replaceCard(record.id,record);
      form.replaceChildren(tr('p','thanks'),button('anotherFeedback',()=>form.replaceWith(newForm()),true));
    });
  }
  async function loadHistory(append=false) {
    if(loading)return;loading=true;more.disabled=true;status(historyStatus,t('loading'));const startingRevision=revision;
    try {
      const result=await api('/api/feedback'+(append&&cursor?'?'+new URLSearchParams({cursor}):''),undefined,undefined,{redirectOnUnauthorized:false});
      if(!Array.isArray(result.feedback))throw translatedError('connectionError');
      // A response started before an edit/delete must not restore old data.
      if(startingRevision!==revision){status(historyStatus,'');return;}
      for(const record of result.feedback)if(!cards.has(record.id)){const card=cardFor(record);cards.set(record.id,card);list.append(card);}
      loaded=true;cursor=result.nextCursor||null;more.hidden=!cursor;updateEmpty();status(historyStatus,'');
    }catch(err){status(historyStatus,err);}
    finally{loading=false;more.disabled=false;retry.hidden=loaded;}
  }
  const retry=button('retry',()=>loadHistory(Boolean(cursor)),true);retry.hidden=true;
  history.append(tr('summary','myFeedback'),tr('p','myFeedbackHint','pilot-data-note'),list,historyStatus,more,retry);
  history.addEventListener('toggle',()=>{if(history.open&&!loaded)return loadHistory();});
  box.append(newForm(),history);return box;
}
window.nodalPilot={t,el,tr,api,status,button,field,select,safeUrl,date,feedback,localized,hasLocalized,bind,dynamic,source,setPageTitle};
window.nodalI18n?.onChange(translate);
async function setup(){let pilot=true;try{const config=await api('/api/config');pilot=config.pilotMode!==false;}catch{}document.documentElement.dataset.pilot=String(pilot);if(pilot){const notice=el('div','pilot-notice');notice.append(tr('strong','prototype'),tr('span','notice'));const dashboardWork=document.querySelector('.dash-page .work'),header=document.querySelector('.pilot-header,.navbar');if(dashboardWork)dashboardWork.prepend(notice);else if(header)header.after(notice);else document.body.prepend(notice);}
const nav=document.querySelector('.pilot-header nav,.side-nav,.nav-main');if(nav&&!nav.querySelector('[href="courses.html"]')){const a=tr('a','courses',nav.classList.contains('side-nav')?'side-link':'pilot-course-link');a.href='courses.html';nav.append(a);}translate();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
