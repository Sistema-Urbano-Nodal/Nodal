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
  const detail=String(data.error||'');
  if(/enroll and complete/.test(detail))return translatedError('intakeRequired',statusCode);
  if(/enrollment is closed/.test(detail))return translatedError('closed',statusCode);
  if(/parent post unavailable/.test(detail))return translatedError('replyUnavailable',statusCode);
  if(/post identifier is already used/.test(detail))return translatedError('alreadySubmitted',statusCode);
  const field=detail.match(/^(fullName|profession|city|motivation|experience|expectations|caseStudy|digitalFamiliarity|title|description|objectives|instructions|post) (is required|is too long)/);
  if(field)return translatedError(field[2]==='is required'?'requiredField':'longField',statusCode,field[1]==='post'?'body':field[1]);
  return translatedError(({400:'invalidInput',403:'accessDenied',404:'notAvailable',409:'conflict',413:'fileError',415:'fileError',429:'tooManyRequests'})[statusCode]||'error',statusCode);
}
async function api(path,body,method){
  let res;
  try{res=await fetch(path,body===undefined?undefined:{method:method||'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
  catch{throw translatedError('connectionError');}
  const data=await res.json().catch(()=>({}));
  if(res.status===401){location.assign('/login.html?next='+encodeURIComponent(location.pathname+location.search));throw translatedError('signInRequired',401);}
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
function feedback(action,context={}){const box=el('details','pilot-feedback');box.append(tr('summary','feedback_'+action));const form=el('form');const score=el('fieldset','pilot-rating');score.append(tr('legend','rating'));const group='rating-'+crypto.randomUUID();const ratings=[];for(let i=1;i<=5;i++){const label=el('label'),input=el('input');input.type='radio';input.name=group;input.value=String(i);input.required=true;input.setAttribute('aria-label',String(i)+' / 5');const star=el('span',null,'★');star.setAttribute('aria-hidden','true');label.append(input,star,el('small',null,String(i)));score.append(label);ratings.push(input);}const comment=field('optional','','textarea');comment.input.maxLength=2000;const commentDetails=el('details','pilot-feedback-comment');commentDetails.append(tr('summary','addComment'),comment.wrap);const submit=button('sendFeedback');submit.type='submit';const msg=el('p','pilot-status');msg.setAttribute('role','status');form.append(score,commentDetails,submit,msg);form.addEventListener('submit',async e=>{e.preventDefault();e.stopPropagation();const selected=ratings.find(input=>input.checked);if(!selected){status(msg,new Error(t('chooseRating')));return;}submit.disabled=true;try{await api('/api/feedback',{action,...context,rating:Number(selected.value),comment:comment.input.value});form.replaceChildren(tr('p','thanks'));}catch(err){status(msg,err);submit.disabled=false;}});box.append(form);return box;}
window.nodalPilot={t,el,tr,api,status,button,field,select,safeUrl,date,feedback,localized,hasLocalized,bind,dynamic,source,setPageTitle};
window.nodalI18n?.onChange(translate);
async function setup(){let pilot=true;try{const config=await api('/api/config');pilot=config.pilotMode!==false;}catch{}document.documentElement.dataset.pilot=String(pilot);if(pilot){const notice=el('div','pilot-notice');notice.append(tr('strong','prototype'),tr('span','notice'));const dashboardWork=document.querySelector('.dash-page .work'),header=document.querySelector('.pilot-header,.navbar');if(dashboardWork)dashboardWork.prepend(notice);else if(header)header.after(notice);else document.body.prepend(notice);}
const nav=document.querySelector('.pilot-header nav,.side-nav,.nav-main');if(nav&&!nav.querySelector('[href="courses.html"]')){const a=tr('a','courses',nav.classList.contains('side-nav')?'side-link':'pilot-course-link');a.href='courses.html';nav.append(a);}translate();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
