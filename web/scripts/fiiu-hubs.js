(() => {
 'use strict';
 const {el,tr,link,button,api,status,contentCards,badges}=window.Fiiu;
 const hub=document.getElementById('fiiuHub'),widget=document.getElementById('fiiuDashboardBody'),message=document.getElementById('fiiuStatus');
 function card(title,copy,links,featured=false){const box=el('article','f-hub-card'+(featured?' featured':''));box.append(tr('h2',title),tr('p',copy));const actions=el('div','f-actions');for(const [key,url] of links)actions.append(link(key,url));box.append(actions);return box;}
 async function news(container){try{const data=await api('/api/fiiu?kind=news');contentCards(container,data.content.slice(0,5));container.append(link('news','fiiu.html#news','f-text-link'));}catch(err){container.replaceChildren(tr('p','error'),button('retry',()=>news(container)));}}
 if(hub){const page=hub.dataset.hub;const intro=el('div','f-hub-intro');intro.append(tr('h1',page+'Title'));if(page==='community')intro.append(tr('p','communityIntro'));hub.append(intro);const grid=el('div','f-hub-grid');hub.append(grid);
  if(page==='community'){
   const festival=card('dates','intro',[['register','fiiu.html'],['website','https://fiiu.sistemaurbano.org/']],true);festival.prepend(el('p','f-festival-name','FIIU Fest 11'),tr('span','spanishContent','content-language'));grid.append(festival,card('chelas','chelasHint',[['circles','opportunities.html?kind=learning_circle'],['organize','index.html#contact']]),card('events','communityIntro',[['circles','opportunities.html?kind=learning_circle'],['people','dashboard.html#network']]));
  }else if(page==='knowledge')grid.append(card('courses','coursesHint',[['courses','courses.html']],true),card('masterclasses','masterclassesHint',[['browseResources','opportunities.html?kind=resource,case_study']]),card('materials','noMaterials',[['open','fiiu.html#materials']]));
  else{grid.append(card('resources','resourcesTitle',[['opportunities','opportunities.html?kind=opportunity'],['browseResources','opportunities.html?kind=resource,case_study']],true));const updates=el('section','f-updates');updates.append(tr('h2','news'));const list=el('div','f-news');updates.append(list);hub.append(updates);news(list);}
  status(message,'');
 }
 if(widget){
  const eventLanguage=el('p');eventLanguage.append(tr('span','spanishContent','content-language'));widget.append(eventLanguage,link('registration','fiiu.html','f-button'));const registration=el('div'),newsHost=el('div','f-news');widget.append(registration,newsHost);news(newsHost);
  api('/api/fiiu/registration').then(async me=>{if(me.registration){registration.append(tr('p','saved','f-tag'));if(me.registration.labStatus!=='none')registration.append(tr('p',me.registration.labStatus));const box=el('div');registration.append(box);const data=await api('/api/fiiu');badges(box,me.attendance,data.event);}if(me.isAdmin)registration.append(link('admin','fiiu-admin.html','f-text-link'));}).catch(()=>{registration.append(tr('p','error'),link('registration','fiiu.html','f-text-link'));});
 }
})();
