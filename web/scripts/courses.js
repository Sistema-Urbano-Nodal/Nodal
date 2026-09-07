(() => {
'use strict';
const {t,el,tr,api,status,button,field,select,safeUrl,date,feedback,localized,hasLocalized,dynamic,source,setPageTitle}=window.nodalPilot;
const root=document.getElementById('pilotRoot'),msg=document.getElementById('pilotStatus');
const courseId=new URLSearchParams(location.search).get('id');
let snapshot,activeId,loadSequence=0,navigationSequence=0,navigationPending=false;
let conversations=[],pageActive=true,pendingModuleId=null;
function stopConversations(){conversations.forEach(view=>view.dispose());conversations=[];}
window.addEventListener?.('pagehide',()=>{pageActive=false;conversations.forEach(view=>view.suspend());});
window.addEventListener?.('pageshow',()=>{pageActive=true;conversations.forEach(view=>view.resume());});
const base=()=>'/api/courses/'+encodeURIComponent(courseId);
function textSection(key,record){const section=el('section');section.append(tr('h3',key),source('p',record,key));return section;}
function dates(c){return [date(c.startsOn),date(c.endsOn)].filter(Boolean).join(' – ');}
async function directory(){setPageTitle('courses');const {courses,isAdmin}=await api('/api/courses');document.getElementById('teachingLink').hidden=isAdmin!==true;root.replaceChildren();const hero=el('header','pilot-hero');hero.append(tr('p','courses','pilot-context'),tr('h1','intro'),tr('p','directory'));const list=el('div','pilot-directory');if(!courses.length)list.append(tr('p','emptyCourses','pilot-empty'));courses.forEach(c=>{const row=el('article','pilot-course-row'),meta=el('div'),content=el('div');meta.append(tr('span',c.status,'pilot-tag'),dynamic('div',()=>dates(c),'pilot-date'));content.append(source('h2',c,'title'),source('p',c,'description'));const link=tr('a','open','pilot-button');link.href='course.html?id='+encodeURIComponent(c.id);row.append(meta,content,link);list.append(row);});root.append(hero,list);status(msg,'');}
function intakeForm(data,onClose){let busy=false;const box=el('section','pilot-intake');box.append(tr('h2','intake'),tr('p','private'));const form=el('form','pilot-form');const fields={};['fullName','profession','city','motivation','experience','expectations','caseStudy','digitalFamiliarity'].forEach((key,i)=>{const f=field(key,data?.[key]||'',i<3?'text':'textarea');f.input.maxLength=i<3?160:2000;f.input.required=true;fields[key]=f.input;form.append(f.wrap);});const save=button('saveIntake');save.type='submit';const local=el('p','pilot-status');local.setAttribute('role','status');form.append(save);if(onClose)form.append(button('cancel',()=>{if(!busy)onClose();},true));form.append(local);form.addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;save.disabled=true;form.setAttribute('aria-busy','true');Object.values(fields).forEach(input=>{input.disabled=true;});try{const input=Object.fromEntries(Object.entries(fields).map(([k,n])=>[k,n.value]));await api(base()+'/intake',input,'PUT');await course();}catch(err){status(local,err);}finally{busy=false;save.disabled=false;form.setAttribute('aria-busy','false');Object.values(fields).forEach(input=>{input.disabled=false;});}});box.append(form);return box;}
async function course(){
  const fresh=await api(base());
  stopConversations();navigationSequence++;navigationPending=false;pendingModuleId=null;snapshot=fresh;root.replaceChildren();
  document.getElementById('teachingLink').hidden=!snapshot.isAdmin;
  const c=snapshot.course;setPageTitle(()=>localized(c,'title'));
  const hero=el('header','pilot-hero pilot-course-hero'),back=tr('a','courses');back.href='courses.html';
  const metadata=el('div','pilot-course-meta');metadata.append(back,dynamic('span',()=>dates(c),'pilot-date'));
  hero.append(metadata,source('h1',c,'title'),source('p',c,'description'));root.append(hero);status(msg,'');
  if(!snapshot.enrollment&&!snapshot.isAdmin){
    const enroll=button('enroll',async()=>{if(enroll.disabled)return;enroll.disabled=true;try{await api(base()+'/enroll',{});await course();}catch(err){status(msg,err);enroll.disabled=false;}});
    enroll.disabled=!c.enrollmentOpen;hero.append(c.enrollmentOpen?enroll:tr('p','closed'));renderRoutePreview();return;
  }
  if(!snapshot.intake&&!snapshot.isAdmin){root.append(intakeForm());renderRoutePreview();return;}
  const actions=el('div','pilot-actions');actions.append(tr('span',snapshot.enrollment?'enrolled':'staff','pilot-tag'));
  if(snapshot.intake)actions.append(button('editIntake',()=>{
    const existing=document.getElementById('editIntake');if(existing){existing.remove();return;}
    const box=intakeForm(snapshot.intake,()=>box.remove());box.id='editIntake';hero.after(box);
  },true));hero.append(actions);
  const workspace=el('div','pilot-workspace'),nav=el('nav','pilot-route'),content=el('div','pilot-content'),progress=el('aside','pilot-progress');
  nav.dataset.pilotAria='route';nav.setAttribute('aria-label',t('route'));content.id='moduleContent';
  const general=snapshot.modules.filter(m=>m.kind==='discussion'),sessions=snapshot.modules.filter(m=>m.kind!=='discussion');
  if(general.length){
    const community=el('div','pilot-course-community');community.append(tr('h2','courseCommunity'));
    for(const m of general){const b=button('generalDiscussion',()=>openModule(m.id),true);b.dataset.module=m.id;community.append(b);}
    nav.append(community);
  }
  nav.append(tr('h2','sessions'));const list=el('ol');nav.append(list);
  for(const [index,m] of sessions.entries()){
    const li=el('li'),b=el('button');b.type='button';b.dataset.module=m.id;
    b.append(el('span','pilot-session-number',String(index+1).padStart(2,'0')),source('span',m,'title','pilot-session-title'),dynamic('small',()=>date(m.sessionDate)));
    b.addEventListener('click',()=>openModule(m.id));li.append(b);list.append(li);
  }
  if(!sessions.length)nav.append(tr('p','noModules','pilot-data-note'));
  progress.append(tr('strong',snapshot.intake?'intakeComplete':'staff'),tr('p','accessNote'));nav.append(progress);
  workspace.append(nav,content);root.append(workspace);
  if(!snapshot.modules.length){content.append(tr('p','noModules','pilot-empty'));return;}
  const requested=new URLSearchParams(location.search).get('module');
  await openModule(snapshot.modules.some(m=>m.id===activeId)?activeId:snapshot.modules.some(m=>m.id===requested)?requested:(sessions[0]||general[0]).id);
}
function renderRoutePreview(){
  const box=el('section','pilot-intake');box.append(tr('h2','route'));
  const sessions=snapshot.modules.filter(m=>m.kind!=='discussion');
  sessions.forEach((m,i)=>box.append(dynamic('p',()=>(i+1)+'. '+localized(m,'title')+(m.sessionDate?' — '+date(m.sessionDate):''))));
  if(!sessions.length)box.append(tr('p','noModules'));
  if(snapshot.modules.some(m=>m.kind==='discussion'))box.append(tr('p','generalDiscussion'));
  root.append(box);
}

async function event(kind,moduleId,resourceUrl){try{await api(base()+'/events',{id:crypto.randomUUID(),moduleId,kind,...(resourceUrl?{resourceUrl}:{})},'POST',{redirectOnUnauthorized:false});}catch(err){if(moduleId===activeId)status(msg,err);}}
async function openModule(id){
  const content=document.getElementById('moduleContent');
  // A route click on the current session must not discard its unsent drafts.
  if(content?.dataset.moduleId===id){navigationSequence++;navigationPending=false;pendingModuleId=null;conversations.forEach(view=>view.resume());status(msg,'');return;}
  if(navigationPending&&pendingModuleId===id)return;
  const navigation=++navigationSequence;pendingModuleId=id;
  navigationPending=true;conversations.forEach(view=>view.suspend());status(msg,t('loading'));
  try{
    const {module:m}=await api(base()+'/modules/'+encodeURIComponent(id));if(navigation!==navigationSequence)return;
    navigationPending=false;pendingModuleId=null;stopConversations();activeId=id;const sequence=++loadSequence;
    const url=new URL(location.href);url.searchParams.set('module',id);history.replaceState(null,'',url);
    document.querySelectorAll('[data-module]').forEach(b=>{if(b.dataset.module===id)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
    content.replaceChildren();content.dataset.moduleId=id;const head=el('section','pilot-module-heading');
    if(m.kind!=='discussion')head.append(dynamic('div',()=>date(m.sessionDate),'pilot-date'));
    head.append(source('h2',m,'title'),source('p',m,'description'));content.append(head);
    const materials=el('section','pilot-module-materials');
    if(hasLocalized(m,'objectives'))materials.append(textSection('objectives',m));
    if(hasLocalized(m,'instructions'))materials.append(textSection('instructions',m));
    materials.append(tr('h3','resources'));
    if(!m.resources?.length)materials.append(tr('p','noResources'));
    for(const r of m.resources||[]){
      const href=r.attachmentId?'/api/course-attachments/'+encodeURIComponent(r.attachmentId):safeUrl(r.url);if(!href)continue;
      const row=el('div','pilot-resource'),link=source('a',r,'title');link.href=href;
      if(!r.attachmentId){link.target='_blank';link.rel='noopener noreferrer';}
      link.addEventListener('click',()=>{event(r.kind==='recording'?'recording_open':'content_open',id,r.url||href);showFeedback(r.kind==='recording'?'recording':'content',id);});
      row.append(link,tr('span',r.attachmentId?'downloadFile':r.kind,'pilot-tag'));materials.append(row);
    }
    const discussion=createConversation(id,sequence,'discussion'),assignments=m.kind==='discussion'?null:createConversation(id,sequence,'assignment');
    conversations=[discussion,...(assignments?[assignments]:[])];
    const panes=m.kind==='discussion'?{discussion:discussion.element,materials}:{materials,discussion:discussion.element,assignment:assignments.element};
    const labels={materials:'materialsView',discussion:'discussionView',assignment:'assignmentsView'};
    const tabs=el('div','pilot-tabs pilot-module-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label',t('moduleViews'));tabs.dataset.pilotAria='moduleViews';
    const buttons={};
    async function activate(key){
      for(const [name,pane] of Object.entries(panes)){pane.hidden=name!==key;buttons[name].setAttribute('aria-selected',String(name===key));buttons[name].tabIndex=name===key?0:-1;}
      const current=new URL(location.href);current.searchParams.set('view',key);history.replaceState(null,'',current);
      discussion.setActive(key==='discussion');assignments?.setActive(key==='assignment');
      if(key==='discussion')await discussion.loadInitial();if(key==='assignment')await assignments.loadInitial();
    }
    Object.entries(panes).forEach(([key,pane],index)=>{
      const tab=button(labels[key],()=>activate(key),true);tab.id='module-tab-'+key;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','module-pane-'+key);
      pane.id='module-pane-'+key;pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby',tab.id);
      tab.addEventListener('keydown',e=>{const keys=Object.keys(panes);let next;if(e.key==='ArrowRight')next=keys[(index+1)%keys.length];else if(e.key==='ArrowLeft')next=keys[(index+keys.length-1)%keys.length];else if(e.key==='Home')next=keys[0];else if(e.key==='End')next=keys.at(-1);if(next){e.preventDefault();activate(next);buttons[next].focus();}});
      buttons[key]=tab;tabs.append(tab);
    });
    const feedbackSlot=el('div');feedbackSlot.id='courseFeedback';content.append(tabs,...Object.values(panes),feedbackSlot);showFeedback('course',id);
    status(msg,'');const requested=new URLSearchParams(location.search).get('view');await activate(panes[requested]?requested:'discussion');event('module_open',id);
  }catch(err){if(navigation===navigationSequence){navigationPending=false;pendingModuleId=null;conversations.forEach(view=>view.resume());status(msg,err);}}
}

function createConversation(moduleId,sequence,kind){
  const section=el('section','pilot-discussion'),heading=el('div','pilot-section-heading');
  heading.append(tr('h3',kind==='assignment'?'assignmentsView':'discussionView'));
  const posts=el('div','pilot-post-list'),updates=el('p','pilot-conversation-updates');updates.setAttribute('role','status');updates.setAttribute('aria-live','polite');
  const refresh=button('refreshConversation',()=>loadPosts(true),true),more=button('loadOlder',()=>loadPosts(false),true);more.hidden=true;
  const composer=makeComposer(moduleId,()=>loadPosts(true),{kind});
  heading.append(refresh);section.append(heading,tr('p',kind==='assignment'?'assignmentHelp':'discussionHelp','pilot-data-note'),composer,updates,posts,more);
  let cursor=null,loading=false,refreshPending=false,loaded=false,active=false,disposed=false,baseline=null,timer=null,pollController=null,pollErrors=0,hasUpdates=false;
  const known=new Set();
  const alive=()=>!disposed&&sequence===loadSequence;
  const visible=()=>!navigationPending&&pageActive&&active&&document.visibilityState!=='hidden'&&alive();
  const signature=result=>result.revision??(result.posts?.[0]?.id||'empty');
  function cancelPoll(){if(timer!==null&&typeof clearTimeout==='function')clearTimeout(timer);timer=null;pollController?.abort();pollController=null;}
  function schedule(){if(!visible()||loading||!loaded||hasUpdates||timer!==null||typeof setTimeout!=='function')return;timer=setTimeout(checkUpdates,Math.min(120000,30000*2**pollErrors));}
  async function checkUpdates(){
    timer=null;if(!visible()||pollController)return;
    const controller=typeof AbortController==='function'?new AbortController():null;pollController=controller;
    try{
      const result=await api(base()+'/modules/'+moduleId+'/posts?'+new URLSearchParams({kind,latest:'1'}),undefined,undefined,{signal:controller?.signal,redirectOnUnauthorized:false});
      if(!visible()||controller?.signal.aborted)return;
      pollErrors=0;if(signature(result)!==baseline){hasUpdates=true;status(updates,t('conversationUpdates'));}
    }catch(err){if(!visible()||controller?.signal.aborted||err.name==='AbortError')return;pollErrors=Math.min(2,pollErrors+1);if(err.status===401||err.status===403){hasUpdates=true;status(updates,t('updatesPaused'));}}
    finally{if(pollController===controller)pollController=null;schedule();}
  }
  async function loadPosts(reset){
    if(!alive())return;if(loading){refreshPending=refreshPending||reset;return;}
    loading=true;cancelPoll();more.disabled=true;refresh.disabled=true;
    try{
      const params=new URLSearchParams({kind,order:'desc'});if(!reset&&cursor)params.set('cursor',cursor);
      const result=await api(base()+'/modules/'+moduleId+'/posts?'+params);if(!alive())return;
      if(reset){posts.replaceChildren();known.clear();baseline=signature(result);hasUpdates=false;status(updates,'');status(msg,'');}
      for(const post of result.posts){if(known.has(post.id))continue;known.add(post.id);posts.append(renderPost(post,composer,loadPosts));}
      if(!known.size)posts.append(tr('p',kind==='assignment'?'noAssignments':'noPosts','pilot-empty'));
      cursor=result.nextCursor;more.hidden=!cursor;loaded=true;
    }catch(err){if(!alive())return;status(msg,err);if(!known.size){const retry=button('retry',()=>{retry.remove();return loadPosts(true);},true);posts.append(retry);}}
    finally{loading=false;more.disabled=false;refresh.disabled=false;if(refreshPending&&alive()){refreshPending=false;await loadPosts(true);}schedule();}
  }
  function visibilityChanged(){if(!visible())cancelPoll();else schedule();}
  document.addEventListener('visibilitychange',visibilityChanged);
  return{element:section,suspend:cancelPoll,resume:schedule,loadInitial:()=>loaded?Promise.resolve():loadPosts(true),setActive(value){active=value;if(!active)cancelPoll();else schedule();},dispose(){disposed=true;cancelPoll();document.removeEventListener?.('visibilitychange',visibilityChanged);}};
}

function renderPost(p,composer,reload){const card=el('article','pilot-post'+(p.parentId?' reply':''));card.id='post-'+p.id;card.append(el('strong',null,p.authorName||''));if(p.staff)card.append(tr('span','staff','pilot-tag'));card.append(dynamic('small',()=>new Date(p.createdAt).toLocaleString(window.nodalI18n?.lang||'en')));if(p.parentId){const parent=tr('a','replying');parent.href='#post-'+p.parentId;card.append(el('br'),parent);}card.append(tr('div',p.kind,'pilot-date'),p.deleted?tr('p','deleted'):el('p',null,p.body));const links=el('ul');for(const l of p.links||[]){const href=safeUrl(l.url);if(href){const li=el('li'),a=el('a',null,l.title||l.url);a.href=href;a.target='_blank';a.rel='noopener noreferrer';li.append(a);links.append(li);}}for(const f of p.attachments||[]){const li=el('li'),a=el('a',null,f.name);a.href='/api/course-attachments/'+encodeURIComponent(f.id);li.append(a);links.append(li);}card.append(links);if(!p.deleted)card.append(button('reply',()=>composer.replyTo(p),true));if(snapshot.isAdmin&&!p.deleted)card.append(button('moderate',async()=>{if(!confirm(t('confirmDelete')))return;try{await api('/api/admin/courses/'+courseId+'/posts/'+p.id,{},'DELETE');await reload(true);}catch(err){status(msg,err);}},true));return card;}
function showFeedback(action,moduleId){if(moduleId!==activeId)return;const mount=document.getElementById('courseFeedback');if(!mount)return;mount.replaceChildren(feedback(action,{courseId,moduleId}));if(action!=='course')mount.querySelector('details')?.setAttribute('open','');}
function makeComposer(moduleId,onSaved,options={}){const box=el('details','pilot-composer');box.append(tr('summary',options.kind==='assignment'?'submitAssignment':'startDiscussion'));const form=el('form','pilot-form');const kind=select('kind',['assignment','question'],options.kind==='assignment'?'assignment':'question'),body=field('body','','textarea'),links=field('links','','textarea'),files=field('files','','file'),reply=el('div','pilot-reply-context');body.input.required=true;body.input.maxLength=6000;links.input.maxLength=5000;files.input.multiple=true;files.input.accept='image/jpeg,image/png,image/webp,application/pdf,text/plain';reply.hidden=true;if(options.kind)kind.wrap.hidden=true;const submit=button('post');submit.type='submit';const local=el('p','pilot-status');local.setAttribute('role','status');const extras=el('details','pilot-composer-extras');extras.append(tr('summary','attachExtras'),links.wrap,files.wrap);form.append(reply,kind.wrap,body.wrap,extras,submit,local);box.append(form);let parentId=null,clientId=crypto.randomUUID(),uploaded=[],fileSignature='',busy=false;box.replyTo=p=>{if(busy)return;box.open=true;parentId=p.id;kind.input.disabled=true;reply.replaceChildren(dynamic('span',()=>t('replying')+' '+p.authorName),button('cancel',()=>{if(busy)return;parentId=null;kind.input.disabled=false;reply.hidden=true;},true));reply.hidden=false;body.input.focus();};form.addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;submit.disabled=true;form.setAttribute('aria-busy','true');for(const input of [body.input,links.input,files.input,kind.input])input.disabled=true;try{const chosen=[...files.input.files];if(chosen.length>3||chosen.some(f=>f.size>3*1024*1024||!['image/jpeg','image/png','image/webp','application/pdf','text/plain'].includes(f.type)))throw new Error(t('fileError'));const parsed=links.input.value.split('\n').map(s=>s.trim()).filter(Boolean).map(url=>{const safe=safeUrl(url);if(!safe)throw new Error(t('urlError'));return {title:new URL(safe).hostname,url:safe};});const signature=chosen.map(f=>[f.name,f.size,f.lastModified].join(':')).join('|');if(signature!==fileSignature){uploaded=[];fileSignature=signature;}for(let i=uploaded.length;i<chosen.length;i++){const f=chosen[i],data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error(t('fileError')));reader.readAsDataURL(f);});const result=await api(base()+'/modules/'+moduleId+'/attachments',{name:f.name,mime:f.type,data});uploaded.push(result.attachment.id);}const action=!parentId&&kind.input.value==='assignment'?'assignment':'discussion';await api(base()+'/modules/'+moduleId+'/posts',{kind:parentId?'comment':kind.input.value,body:body.input.value,links:parsed,attachmentIds:uploaded,...(parentId?{parentId}:{}),clientId});form.reset();kind.input.value=options.kind==='assignment'?'assignment':'question';parentId=null;kind.input.disabled=false;reply.hidden=true;uploaded=[];fileSignature='';clientId=crypto.randomUUID();status(local,t('saved'));box.open=false;showFeedback(action,moduleId);await onSaved();}catch(err){status(local,err);}finally{busy=false;submit.disabled=false;form.setAttribute('aria-busy','false');for(const input of [body.input,links.input,files.input])input.disabled=false;kind.input.disabled=Boolean(parentId);}});return box;}
async function start(){try{if(document.body.dataset.page==='course'){if(!courseId)location.replace('courses.html');else await course();}else await directory();}catch(err){status(msg,err);const retry=button('retry',()=>{retry.remove();start();},true);root.append(retry);}}
window.nodalI18n?.onChange(()=>{document.documentElement.lang=window.nodalI18n.lang;});start();
})();
