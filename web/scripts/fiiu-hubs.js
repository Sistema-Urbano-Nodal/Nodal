(() => {
 'use strict';
 const {el,tr,link,button,source,api,status,dateNode,contentCards,badges,countLabel,nextFor,newTabNote}=window.Fiiu;
 const hub=document.getElementById('fiiuHub'),widget=document.getElementById('fiiuDashboardBody'),message=document.getElementById('fiiuStatus');
 function card(title,copy,links,featured=false){const box=el('article','f-hub-card'+(featured?' featured':''));box.append(tr('h2',title),tr('p',copy));const actions=el('div','f-actions');for(const [key,url] of links)actions.append(link(key,url));box.append(actions);return box;}
 // Only the news feed is shown here; the unfiltered /api/fiiu page also carries materials.
 async function news(container,heading='h3'){try{const data=await api('/api/fiiu?kind=news');contentCards(container,data.content.slice(0,5),'noNews',heading);container.append(link('allNews','fiiu.html#news','f-text-link'));}catch(err){container.replaceChildren(tr('p','loadError'),button('retry',()=>news(container,heading)));}}
 if(hub){const page=hub.dataset.hub;const intro=el('div','f-hub-intro');intro.append(tr('h1',page+'Title'));if(page==='community')intro.append(tr('p','communityIntro'));hub.append(intro);const grid=el('div','f-hub-grid');hub.append(grid);
  if(page==='community'){
   const festival=card('dates','intro',[['register','fiiu.html'],['website','https://fiiu.sistemaurbano.org/']],true);festival.prepend(el('p','f-festival-name','FIIU Fest 11'),tr('span','spanishContent','content-language'));grid.append(festival,card('chelas','chelasHint',[['circles','opportunities.html?kind=learning_circle'],['organize','index.html#contact']]),card('events','communityIntro',[['circles','opportunities.html?kind=learning_circle'],['people','dashboard.html#network']]));
  }else if(page==='knowledge')grid.append(card('courses','coursesHint',[['courses','courses.html']],true),card('masterclasses','masterclassesHint',[['browseResources','opportunities.html?kind=resource,case_study']]),card('materials','hubMaterials',[['open','fiiu.html#materials']]));
  else{grid.append(card('resources','resourcesTitle',[['opportunities','opportunities.html?kind=opportunity'],['browseResources','opportunities.html?kind=resource,case_study']],true));const updates=el('section','f-updates');updates.append(tr('h2','news'));const list=el('div','f-news');updates.append(list);hub.append(updates);news(list);}
  hub.append(newTabNote());status(message,'');
 }
 // Dashboard widget: registration state and next step first, then festival news. The h2 in dashboard.html names the festival.
 if(widget){
  const meta=el('p','f-widget-meta'),state=el('div','f-widget-status'),updates=el('section','f-widget-news'),newsHost=el('div','f-news');
  meta.append(tr('span','dates'),tr('span','spanishContent','content-language'));state.append(tr('p','loading','f-muted'));updates.append(tr('h3','news'),newsHost);widget.append(meta,state,updates,newTabNote());news(newsHost,'h4');
  let settled=false;
  api('/api/fiiu/registration').then(async me=>{
   const registration=me.registration,chips=el('div','f-widget-chips'),next=el('div','f-widget-next');
   chips.append(registration?tr('span','statusRegistered','f-pill is-ok'):tr('span','statusNotRegistered','f-pill'));
   if(registration&&registration.labStatus!=='none')chips.append(tr('span',registration.labStatus+'Short','f-pill is-'+registration.labStatus));
   state.replaceChildren(chips,next,link(registration?'viewRegistration':'register','fiiu.html#registration','f-button'));settled=true;
   if(me.isAdmin){
    const admin=el('div','f-widget-admin'),pending=el('span');admin.append(link('admin','fiiu-admin.html#participants','f-button secondary f-admin-link'),pending);state.append(admin);
    api('/api/admin/fiiu/summary').then(data=>{const n=data.summary?.lab?.pending;if(Number.isSafeInteger(n)&&n>0)pending.append(countLabel(n,'pendingReviewOne','pendingReviewMany','f-pill is-pending'));}).catch(()=>{});
   }
   if(registration){
    const box=el('div','f-badges');state.append(box);const data=await api('/api/fiiu'),upcoming=nextFor(registration,data.event);
    if(upcoming){const line=el('p','f-next');line.append(tr('span','nextForYou','f-next-label'),dateNode(upcoming.date,'span','short','f-next-date'));if(upcoming.time)line.append(el('span','f-next-time',upcoming.time));line.append(source('span',upcoming.title,'f-next-title'));next.append(line);}
    // One short line until attendance is confirmed keeps the widget compact; fiiu.html carries the full explanation.
    badges(box,me.attendance,data.event,{hint:'badgesHintShort'});
   }
  }).catch(()=>{const failure=[tr('p','loadError'),link('registration','fiiu.html','f-text-link')];if(settled)state.append(...failure);else state.replaceChildren(...failure);});
 }
})();
