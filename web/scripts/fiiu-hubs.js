(() => {
 'use strict';
 const {el,tr,link,button,source,api,status,dateNode,timeNode,contentCards,badges,countLabel,nextFor,newTabNote,hoursLine,pulse,talkLink}=window.Fiiu;
 const hub=document.getElementById('fiiuHub'),widget=document.getElementById('fiiuDashboardBody'),message=document.getElementById('fiiuStatus');
 // A link is given as [key, url], or as a node when the caller updates it later.
 function card(title,copy,links,featured=false){const box=el('article','f-hub-card'+(featured?' featured':''));box.append(tr('h2',title),tr('p',copy));const actions=el('div','f-actions');for(const item of links)actions.append(Array.isArray(item)?link(...item):item);box.append(actions);return box;}
 // Hubs list news from the news feed (the unfiltered /api/fiiu page mixes in materials); each feed page also carries the event and the registration settings.
 async function news(container,heading='h3',page=api('/api/fiiu?kind=news')){try{const data=await page;contentCards(container,data.content.slice(0,5),'noNews',heading);container.append(link('allNews','fiiu.html#news','f-text-link'));}catch(err){container.replaceChildren(tr('p','loadError'),button('retry',()=>news(container,heading)));}}
 if(hub){const page=hub.dataset.hub;const intro=el('div','f-hub-intro');intro.append(tr('h1',page+'Title'));if(page==='community')intro.append(tr('p','communityIntro'));hub.append(intro);const grid=el('div','f-hub-grid');hub.append(grid);
  if(page==='community'){
   const register=link('register','fiiu.html'),festival=card('dates','intro',[register,['website','https://fiiu.sistemaurbano.org/']],true);festival.prepend(el('p','f-festival-name','FIIU Fest 11'),tr('span','spanishContent','content-language'));
   grid.append(festival,card('chelas','chelasHint',[['circles','opportunities.html?kind=learning_circle'],['organize','index.html#contact']]),card('events','eventsHint',[['viewProgramme','fiiu.html#programme'],['people','dashboard.html#network']]));
   // Once registration closes, the festival card points to the programme instead; the news page carries the registration settings.
   api('/api/fiiu?kind=news').then(data=>{if(data.config?.registrationOpen===false)register.replaceWith(link('viewProgramme','fiiu.html#programme'));}).catch(()=>{});
  }else if(page==='knowledge')grid.append(card('courses','coursesHint',[['courses','courses.html']],true),card('masterclasses','masterclassesHint',[['browseResources','opportunities.html?kind=resource,case_study']]),card('materials','hubMaterials',[['open','fiiu.html#materials']]));
  else{grid.append(card('resources','resourcesTitle',[['opportunities','opportunities.html?kind=opportunity'],['browseResources','opportunities.html?kind=resource,case_study']],true));const updates=el('section','f-updates');updates.append(tr('h2','news'));const list=el('div','f-news');updates.append(list);hub.append(updates);news(list);}
  hub.append(newTabNote());status(message,'');
 }
 // Dashboard widget: registration state and next step first, then festival news. The h2 in dashboard.html names the festival.
 if(widget){
  const meta=el('p','f-widget-meta'),state=el('div','f-widget-status'),updates=el('section','f-widget-news'),newsHost=el('div','f-news');
  meta.append(tr('span','dates'),tr('span','spanishContent','content-language'));updates.append(tr('h3','news'),newsHost);widget.append(meta,state,updates,newTabNote());
  /* The registration and one news page (which also carries the event and the registration settings) draw the whole block: status, next session,
     badges and hours, then the news. On venue Wi-Fi either read can fail. That shows one error with one retry, which reads both again and redraws
     everything; a retry that redrew only the news used to leave a stale error, a second link to the same page and no next session.
     A refresh on the way back (background) reads behind the drawn block: a phone waking on venue Wi-Fi often fails a read for a moment, and clearing
     first turned a working block into the error box and collapsed it while it read. Only two good reads redraw it, in one step; a failed refresh
     keeps the block and the old loadedAt, so the next return tries again. */
  let loading=false,loadedAt=0;
  /* The live line (fiiu-live.js) for registered people and organisers: what is on, today's check-ins and the live conversations, with a way to the band on
     fiiu.html. It is mounted once and keeps itself up to date; a redraw of the block moves the same node, so it neither reads again nor starts over.
     Without a registration there is none, and no read for it. */
  const liveLine=el('div');liveLine.hidden=true;let live=null,liveNamed=null;
  const stopLive=()=>{live?.stop();live=null;liveLine.hidden=true;liveLine.replaceChildren();};
  const failure=()=>{const box=el('div','f-widget-error'),retry=button('retry',()=>{retry.disabled=true;load();});box.append(tr('p','loadError'),retry);return box;};
  async function load(background=false){
   if(loading)return;loading=true;
   if(!background){state.replaceChildren(tr('p','loading','f-muted'));newsHost.replaceChildren();updates.hidden=false;}
   const [mine,page]=await Promise.allSettled([api('/api/fiiu/registration'),api('/api/fiiu?kind=news')]);
   loading=false;
   if(background&&(mine.status!=='fulfilled'||page.status!=='fulfilled'))return;
   const data=page.status==='fulfilled'?page.value:null;
   if(data){contentCards(newsHost,data.content.slice(0,5),'noNews','h4');newsHost.append(link('allNews','fiiu.html#news','f-text-link'));}
   updates.hidden=!data;
   // Without the registration there is no status to show, so the error stands in for it, with the festival page as the way round.
   if(mine.status!=='fulfilled'){stopLive();state.replaceChildren(failure(),link('registration','fiiu.html','f-text-link'));return;}
   loadedAt=Date.now();
   const me=mine.value,registration=me.registration,chips=el('div','f-widget-chips'),next=el('div','f-widget-next');
   // dashboard.js places the block by this on a phone: first for a registrant, after the greeting for an invitation to register.
   widget.dataset.registered=String(Boolean(registration));
   chips.append(registration?tr('span','statusRegistered','f-pill is-ok'):tr('span','statusNotRegistered','f-pill'));
   if(registration&&registration.labStatus!=='none')chips.append(tr('span',registration.labStatus+'Short','f-pill is-'+registration.labStatus));
   // A registration keeps its way back; without one, the call to action follows the registration settings.
   if(!registration&&!me.isAdmin)stopLive();
   state.replaceChildren(chips,next,liveLine,registration?link('viewRegistration','fiiu.html#registration','f-button'):data?.config?.registrationOpen===false?link('viewProgramme','fiiu.html#programme','f-button'):link('register','fiiu.html#registration','f-button'));
   // The festival-wide General conversation, with its open questions from the public pulse; nothing while none is open. A refresh reads the pulse again.
   const general=el('p','f-widget-general');general.hidden=true;state.append(general);
   pulse({fresh:background}).then(counts=>{const n=counts.open?.get('general');if(!n)return;general.append(talkLink('general',n,'f-text-link f-talk-link f-talk-general','talkGeneral'));general.hidden=false;});
   if(me.isAdmin){
    const admin=el('div','f-widget-admin'),pending=el('span');admin.append(link('admin','fiiu-admin.html#participants','f-button secondary f-admin-link'),pending);state.append(admin);
    api('/api/admin/fiiu/summary').then(data=>{const n=data.summary?.lab?.pending;if(Number.isSafeInteger(n)&&n>0)pending.append(countLabel(n,'pendingReviewOne','pendingReviewMany','f-pill is-pending'));}).catch(()=>{});
   }
   // The status stays; the next session and the badges need the event, so a failed news read puts the block's one retry here.
   if(!data){loadedAt=0;state.append(failure());return;}
   // The line leaves out the session the block names as the person's next (liveNamed, set below), so it never says the same thing twice.
   liveNamed=null;if((registration||me.isAdmin)&&!live&&window.Fiiu.live)live=window.Fiiu.live.mount(liveLine,{compact:true,event:data.event,organiser:Boolean(me.isAdmin),named:()=>liveNamed});
   // The console's Recognition ledger draws its FIIU family from these same two reads, so it makes no request of its own: dashboard.js (loaded before
   // this file) listens on document for this event. Only two good reads hand over, on the first draw and on a refresh; after a failed read the ledger
   // keeps what it shows, and without a registration (null) it shows no festival family.
   if(typeof CustomEvent==='function')document.dispatchEvent?.(new CustomEvent('nodal:fiiu-festival',{detail:{registration,attendance:me.attendance,event:data.event}}));
   if(registration){
    const box=el('div','f-badges');state.append(box);const upcoming=nextFor(registration,data.event);liveNamed=upcoming?.id||null;
    if(upcoming){const line=el('p','f-next');line.append(tr('span','nextForYou','f-next-label'),dateNode(upcoming.date,'span','short','f-next-date'));if(upcoming.time)line.append(timeNode(upcoming.time,'span','f-next-time'));line.append(source('span',upcoming.title,'f-next-title'));if(upcoming.venue)line.append(source('span',upcoming.venue,'f-next-venue'));next.append(line);
     // The next block's session page, with its questions, from the same pulse read as the General link above.
     pulse().then(counts=>{const n=counts.get(upcoming.id);if(n)line.append(talkLink(upcoming.id,n));});}
    // One short line until attendance is confirmed keeps the widget compact; fiiu.html carries the full explanation. Confirmed sessions add their hours.
    badges(box,me.attendance,data.event,{hint:'badgesHintShort'});const hours=hoursLine(me.attendance,data.event);if(hours)box.append(hours);
   }
  }
  load();
  // "Next for you" is worked out when the block is drawn. A phone left on the console between sessions reads it again when it comes back after a while.
  document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='visible'&&loadedAt&&Date.now()-loadedAt>15*60000)return load(true);});
 }
})();
