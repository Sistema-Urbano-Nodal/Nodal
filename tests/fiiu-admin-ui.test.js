import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {DEFAULT_CONFIG,FIIU_EVENT} from '../server/fiiu-domain.js';
import {createFiiuHarness,key,field,flush,content} from './helpers/fiiu-ui-harness.js';

const participant=(id,firstName)=>({id,eventId:'fiiu-2026',userId:'user-'+id,email:firstName.toLowerCase()+'@example.test',version:1,labStatus:'pending',createdAt:'2026-09-29T12:00:00.000Z',updatedAt:'2026-09-29T12:00:00.000Z',answers:{firstName,lastName:'Test',country:'Perú',city:'Lima',profile:'public_official',publicOfficial:true,applyLab:true,institution:'City Council',position:'Planner',activities:['day1-am'],privacyAccepted:true}});
const copy=value=>structuredClone(value);
const summary={totalRegistrations:237,publicOfficials:64,lab:{pending:18,accepted:12,declined:2},activities:[{activityId:'day1-am',registrations:121,externalInterests:0,attendance:0}],days:[{date:'2026-10-21',registrations:157,attendance:0}],profiles:[{profile:'student',count:48}]};
// The summary-email block's state (GET /api/admin/fiiu/confirmations); by default nobody is waiting.
const emailCounts=(over={})=>({none:0,pending:0,sent:0,failed:0,uncertain:0,skipped:0,...over});
const emailState=(over={})=>({configured:true,counts:emailCounts(),dailyCap:150,sentToday:0,resetsAt:'2026-10-03T00:00:00.000Z',...over});
async function harness(respond,{participants=[],summaryRead=()=>({summary:copy(summary)}),configRead=()=>({config:{...DEFAULT_CONFIG,version:0}}),confirmationsRead=()=>emailState(),context={}}={}){
 return createFiiuHarness(request=>{
  if(request.path==='/api/fiiu')return{event:FIIU_EVENT,config:DEFAULT_CONFIG,content:[],nextCursor:null};
  if(request.path==='/api/admin/fiiu/config'&&request.method==='GET')return configRead(request);
  if(request.path==='/api/admin/fiiu/confirmations'&&request.method==='GET')return confirmationsRead(request);
  if(request.path==='/api/admin/fiiu/registrations')return{registrations:copy(participants),nextCursor:null};
  if(request.path==='/api/admin/fiiu/summary')return summaryRead(request);
  return respond(request);
 },{page:'fiiu-admin',context});
}
async function submit(form){form.listeners.submit({preventDefault(){}});await flush();}
const detailTitle=h=>h.root.querySelector('.f-admin-detail').querySelector('h3')?.textContent;
const detailButton=(h,index)=>key(h.root.querySelectorAll('.f-participant')[index],'details');
const participantNames=h=>h.root.querySelectorAll('.f-participant').map(row=>row.querySelector('strong').textContent);
const publicationTitles=h=>h.root.querySelectorAll('.f-pub').map(row=>row.querySelector('h3').textContent);
const editorForm=h=>h.root.querySelector('.f-content-editor').querySelector('form');
const unavailable={status:503,data:{error:'unavailable'}};
// The lightweight DOM has no timers: debounced work waits here until a test runs it.
function fakeTimers(h){
 const queue=new Map();let last=0;
 h.ctx.setTimeout=(callback,delay)=>{queue.set(++last,{callback,delay});return last;};h.ctx.clearTimeout=id=>{queue.delete(id);};
 return{delays:()=>[...queue.values()].map(timer=>timer.delay),run(){const due=[...queue.values()];queue.clear();for(const timer of due)timer.callback();}};
}
const type=(input,value)=>{input.value=value;input.listeners.input();};

test('editing historical publications preserves only their existing legacy activity and sends it when saving',async()=>{
 for(const legacy of FIIU_EVENT.legacyActivities){
  const post={id:'legacy-post',version:1,title:'Existing workshop material',body:'',url:'https://example.test/material',kind:'material',status:'published',activityId:legacy.id};
  const h=await harness(({method,body})=>method==='GET'?{content:[copy(post)],nextCursor:null}:{content:{...post,...body,version:post.version+1}});
  await key(h.root.querySelector('.f-news-item'),'editContent').listeners.click();
  const form=h.root.querySelector('.f-content-editor').querySelector('form'),select=field(form,'activityId');
  // The lightweight DOM permits values without matching options; check both.
  assert.deepEqual(select.children.filter(option=>FIIU_EVENT.legacyActivities.some(activity=>activity.id===option.value)).map(option=>option.value),[legacy.id]);
  assert.equal(select.value,legacy.id);
  field(form,'title').value='Corrected historical material';await submit(form);
  const writes=h.requests.filter(request=>request.method!=='GET');assert.equal(writes.length,1);
  assert.equal(writes[0].method,'PATCH');assert.equal(writes[0].path,'/api/admin/fiiu/content/'+post.id);
  assert.equal(writes[0].body.activityId,legacy.id);assert.equal(writes[0].body.title,'Corrected historical material');assert.equal(writes[0].body.version,1);
 }
});

test('new publication activity choices exclude all historical activities',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null})),select=field(h.root.querySelector('.f-content-editor'),'activityId');
 assert.equal(select.value,'');assert.deepEqual(select.children.map(option=>option.value),['',...FIIU_EVENT.activities.map(activity=>activity.id)]);
});

test('a new publication sends one lowercase UUID across retries, so a retry after a lost response gets the saved row instead of a duplicate',async()=>{
 const rows=new Map();let lose=true;
 const h=await harness(({method,body})=>{
  if(method==='GET')return{content:[],nextCursor:null};
  // As on the server: an id it already holds returns that row instead of inserting another.
  if(!rows.has(body.id))rows.set(body.id,{...body,version:1,createdAt:'2026-09-29T12:00:00.000Z'});
  if(lose){lose=false;throw Error('connection reset after the insert');}
  return{content:copy(rows.get(body.id))};
 });
 const form=editorForm(h);field(form,'title').value='Programme update';
 await submit(form);assert.equal(h.message.dataset.fiiuText,'error');assert.equal(field(form,'title').value,'Programme update');
 await submit(form);assert.equal(h.message.dataset.fiiuText,'changesSaved');
 const [first,retry]=h.requests.filter(request=>request.method==='POST').map(request=>request.body.id);
 assert.match(first,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,'without crypto.randomUUID the id is still a lowercase v4 UUID');
 assert.equal(retry,first,'the retry reuses the id');assert.equal(rows.size,1,'no duplicate publication');
 assert.deepEqual(publicationTitles(h),['Programme update']);assert.ok(key(h.root.querySelector('.f-content-editor'),'newContent'));
 h.ctx.crypto={randomUUID:()=>'0f8fad5b-d9cb-469f-a165-70867728950e'};
 const next=editorForm(h);field(next,'title').value='Second update';await submit(next);
 assert.equal(h.requests.filter(request=>request.method==='POST').at(-1).body.id,'0f8fad5b-d9cb-469f-a165-70867728950e','the next new publication gets its own id, from crypto.randomUUID when available');
 assert.equal(rows.size,2);assert.deepEqual(publicationTitles(h),['Second update','Programme update']);
});

test('retrying a laboratory review after a failed detail refresh uses the version returned by the successful save',async()=>{
 const registration=participant('participant-a','Ana');let detailReads=0;
 const h=await harness(({path,method,body})=>{
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(method==='GET')return ++detailReads===2?unavailable:{registration:copy(registration),attendance:[]};
  if(body.version!==registration.version)return{status:409,data:{error:'registration changed'}};
  Object.assign(registration,{labStatus:body.labStatus,version:registration.version+1});return{registration:copy(registration)};
 },{participants:[registration]});
 await detailButton(h,0).listeners.click();const form=h.root.querySelector('.f-admin-detail').querySelector('form');
 field(form,'review').value='reviewAccepted';await submit(form);assert.equal(registration.labStatus,'accepted');
 const refreshMessage=h.message.dataset.fiiuText;
 field(form,'review').value='reviewDeclined';await submit(form);
 assert.equal(registration.labStatus,'declined','a second review must use the committed version even when its refresh failed');
 assert.equal(registration.version,3);assert.deepEqual(h.requests.filter(request=>request.method==='PATCH').map(request=>request.body.version),[1,2]);
 assert.equal(refreshMessage,'savedRefreshFailed');
});

test('a slow participant detail response cannot replace the participant selected more recently',async()=>{
 const ana=participant('participant-a','Ana'),bruno=participant('participant-b','Bruno'),pending=new Map();
 const h=await harness(({path})=>path==='/api/admin/fiiu/content'?{content:[],nextCursor:null}:new Promise(resolve=>pending.set(path,resolve)),{participants:[ana,bruno]});
 const older=detailButton(h,0).listeners.click(),latest=detailButton(h,1).listeners.click();
 pending.get('/api/admin/fiiu/registrations/participant-b')({registration:copy(bruno),attendance:[]});await latest;
 assert.equal(detailTitle(h),'Bruno Test');
 pending.get('/api/admin/fiiu/registrations/participant-a')({registration:copy(ana),attendance:[]});await older;
 assert.equal(detailTitle(h),'Bruno Test','the newer selection must remain visible after an older request finishes');
});

test('a pending review save does not reopen its participant after the organizer selects someone else',async()=>{
 const ana=participant('participant-a','Ana'),bruno=participant('participant-b','Bruno');let finishSave;
 const h=await harness(({path,method})=>{
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(method==='PATCH')return new Promise(resolve=>{finishSave=resolve;});
  return{registration:copy(path.endsWith('participant-a')?ana:bruno),attendance:[]};
 },{participants:[ana,bruno]});
 await detailButton(h,0).listeners.click();const form=h.root.querySelector('.f-admin-detail').querySelector('form');
 field(form,'review').value='reviewAccepted';form.listeners.submit({preventDefault(){}});
 await detailButton(h,1).listeners.click();assert.equal(detailTitle(h),'Bruno Test');
 finishSave({registration:{...copy(ana),labStatus:'accepted',version:2}});await flush();
 assert.equal(detailTitle(h),'Bruno Test','refreshing a saved review must not change the current participant selection');
});

test('publication saving locks its fields, ignores repeated submission and preserves the draft after failure',async()=>{
 let finishSave;
 const h=await harness(({method})=>method==='GET'?{content:[],nextCursor:null}:new Promise(resolve=>{finishSave=resolve;}));
 const form=h.root.querySelector('.f-content-editor').querySelector('form'),title=field(form,'title'),activity=field(form,'activityId');
 title.value='Programme correction';activity.disabled=true;
 form.listeners.submit({preventDefault(){}});form.listeners.submit({preventDefault(){}});
 assert.equal(h.requests.filter(request=>request.method==='POST').length,1,'one pending publication must have only one creation request');
 assert.equal(title.disabled,true,'typing must not appear possible when successful refresh would discard it');
 assert.ok(form.querySelectorAll('input,select,textarea,button').every(control=>control.disabled));
 assert.equal(form['aria-busy'],'true');
 finishSave(unavailable);await flush();
 assert.equal(title.value,'Programme correction');assert.equal(title.disabled,false);
 assert.equal(activity.disabled,true,'previously disabled fields must remain disabled after recovery');
 assert.equal(key(form,'saveContent').disabled,false);assert.equal(form['aria-busy'],'false');
});

test('finishing an older publication save preserves a newer selected editor and its unsaved text',async()=>{
 const existing={id:'published-a',version:1,title:'Existing announcement',body:'',kind:'news',status:'published',activityId:'',url:''};let finishSave;
 const h=await harness(({method,body})=>method==='POST'?new Promise(resolve=>{finishSave=()=>resolve({content:{...body,version:1}});}):{content:[copy(existing)],nextCursor:null});
 const older=editorForm(h);field(older,'title').value='New announcement';older.listeners.submit({preventDefault(){}});
 await key(h.root.querySelector('.f-news-item'),'editContent').listeners.click();
 const newer=editorForm(h);field(newer,'title').value='Unsaved correction to existing announcement';
 finishSave();await flush();
 assert.equal(editorForm(h),newer,'the earlier save must not replace the editor selected while it was saving');
 assert.equal(field(newer,'title').value,'Unsaved correction to existing announcement');assert.equal(field(newer,'title').disabled,false);
 assert.deepEqual(publicationTitles(h),['New announcement','Existing announcement']);
 key(h.root.querySelector('.f-content-editor'),'cancelEdit').listeners.click();
 assert.equal(field(editorForm(h),'title').value,'','the draft saved meanwhile does not come back as a new draft');
});

test('organizer participant loading does not wait for a slow public programme response',async()=>{
 let finishProgramme;
 const h=await createFiiuHarness(({path})=>{
  if(path==='/api/fiiu')return new Promise(resolve=>{finishProgramme=()=>resolve({event:FIIU_EVENT,config:DEFAULT_CONFIG,content:[],nextCursor:null});});
  if(path==='/api/admin/fiiu/config')return{config:DEFAULT_CONFIG};
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(path==='/api/admin/fiiu/registrations')return{registrations:[],nextCursor:null};
  if(path==='/api/admin/fiiu/summary')return{summary:copy(summary)};
  throw Error('Unexpected request');
 },{page:'fiiu-admin'});
 assert.ok(h.requests.some(request=>request.path==='/api/admin/fiiu/registrations'),'the independent participant read should already be in flight');
 finishProgramme();await flush();assert.ok(key(h.root,'noParticipants'));
 assert.equal(h.requests.filter(request=>request.path==='/api/admin/fiiu/registrations').length,1);
});

test('settings stay locked while saving so the displayed availability matches the submitted value',async()=>{
 let finishSave;
 const h=await harness(({method,body})=>method==='GET'?{content:[],nextCursor:null}:new Promise(resolve=>{finishSave=()=>resolve({config:{...body,version:body.version+1}});}));
 const form=h.root.querySelector('.f-admin-settings').querySelector('form'),open=field(form,'registrationOpen'),programme=field(form,'programUrl');
 open.checked=false;programme.value='https://example.test/programme';
 form.listeners.submit({preventDefault(){}});form.listeners.submit({preventDefault(){}});
 const writes=h.requests.filter(request=>request.method==='PUT');
 assert.equal(writes.length,1,'a pending settings save must ignore repeat submission');
 assert.equal(writes[0].body.registrationOpen,false);assert.equal(writes[0].body.programUrl,'https://example.test/programme');
 assert.ok(form.querySelectorAll('input,select,textarea,button').every(control=>control.disabled),'availability and links must not appear editable while their earlier values are being saved');
 assert.equal(form['aria-busy'],'true');
 finishSave();await flush();
 assert.equal(open.checked,false);assert.equal(open.disabled,false);assert.equal(programme.disabled,false);
 assert.equal(form['aria-busy'],'false');assert.equal(h.message.dataset.fiiuText,'changesSaved');
 open.checked=true;form.listeners.submit({preventDefault(){}});
 const next=h.requests.filter(request=>request.method==='PUT')[1];
 assert.equal(next.body.registrationOpen,true);assert.equal(next.body.version,1,'the next edit must use the saved configuration version');
 finishSave();await flush();
});

test('a failed settings save keeps the draft and restores each previous disabled state',async()=>{
 let finishSave;
 const h=await harness(({method})=>method==='GET'?{content:[],nextCursor:null}:new Promise(resolve=>{finishSave=resolve;}));
 const form=h.root.querySelector('.f-admin-settings').querySelector('form'),open=field(form,'registrationOpen'),programme=field(form,'programUrl'),party=field(form,'partyUrl');
 open.checked=false;programme.value='https://example.test/corrected-programme';party.disabled=true;
 form.listeners.submit({preventDefault(){}});
 assert.equal(programme.disabled,true);assert.equal(open.disabled,true);
 finishSave(unavailable);await flush();
 assert.equal(open.checked,false);assert.equal(programme.value,'https://example.test/corrected-programme');
 assert.equal(open.disabled,false);assert.equal(programme.disabled,false);assert.equal(party.disabled,true);
 assert.equal(key(form,'saveSettings').disabled,false);assert.equal(form['aria-busy'],'false');assert.equal(h.message.dataset.fiiuText,'error');
});

for(const failure of ['mutation','refresh'])test(`laboratory review keeps its selection locked until ${failure} failure and then permits retry`,async()=>{
 const registration=participant('participant-a','Ana');let finishSave,finishRefresh,detailReads=0;
 const h=await harness(({path,method})=>{
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(method==='PATCH')return new Promise(resolve=>{finishSave=resolve;});
  if(++detailReads===1)return{registration:copy(registration),attendance:[]};
  return new Promise(resolve=>{finishRefresh=resolve;});
 },{participants:[registration]});
 await detailButton(h,0).listeners.click();
 const form=h.root.querySelector('.f-admin-detail').querySelector('form'),review=field(form,'review');review.value='reviewAccepted';
 form.listeners.submit({preventDefault(){}});form.listeners.submit({preventDefault(){}});
 assert.equal(h.requests.filter(request=>request.method==='PATCH').length,1,'one review must have only one in-flight mutation');
 assert.equal(review.disabled,true,'a pending save must not discard a later review choice');assert.equal(form['aria-busy'],'true');
 if(failure==='mutation')finishSave(unavailable);
 else{
  finishSave({registration:{...copy(registration),labStatus:'accepted',version:2}});await flush();
  assert.equal(review.disabled,true,'the choice must remain locked during the refresh that replaces its form');
  finishRefresh(unavailable);
 }
 await flush();
 assert.equal(review.value,'reviewAccepted');assert.equal(review.disabled,false);assert.equal(key(form,'saveReview').disabled,false);assert.equal(form['aria-busy'],'false');
 assert.equal(h.message.dataset.fiiuText,failure==='mutation'?'error':'savedRefreshFailed');
});

test('organizer totals use the server summary instead of counting the loaded participant page',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{participants:[participant('a','Ana')]});
 const dashboard=h.root.querySelector('.f-admin-summary');assert.ok(dashboard);
 assert.match(content(dashboard),/237/);assert.match(content(dashboard),/157/);assert.match(content(dashboard),/121/);assert.match(content(dashboard),/48/);
 assert.ok(key(dashboard,'publicOfficials'));assert.ok(key(dashboard,'externalActivities'));assert.ok(key(dashboard,'profiles'));
 assert.equal(h.requests.filter(request=>request.path==='/api/admin/fiiu/summary').length,1);
});

test('summary refresh prevents overlapping requests and leaves organizer drafts intact',async()=>{
 let reads=0,finishRefresh;
 const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>++reads===1?{summary:copy(summary)}:new Promise(resolve=>{finishRefresh=resolve;})});
 const form=h.root.querySelector('.f-content-editor').querySelector('form'),settings=h.root.querySelector('.f-admin-settings').querySelector('form');field(form,'title').value='Unsaved programme update';field(settings,'programUrl').value='https://example.test/unsaved';
 const refresh=key(h.root.querySelector('.f-admin-summary'),'refreshSummary');assert.ok(refresh);
 const pending=refresh.listeners.click(),duplicate=refresh.listeners.click();assert.equal(reads,2);assert.equal(refresh.disabled,true);
 finishRefresh({summary:{...copy(summary),totalRegistrations:238}});await Promise.all([pending,duplicate]);
 assert.equal(h.root.querySelector('.f-content-editor').querySelector('form'),form);assert.equal(field(form,'title').value,'Unsaved programme update');assert.equal(field(settings,'programUrl').value,'https://example.test/unsaved');
 assert.match(content(h.root.querySelector('.f-admin-summary')),/238/);assert.equal(refresh.disabled,false);
});

test('an unavailable summary leaves participant and publication controls usable and can retry independently',async()=>{
 let reads=0;const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>++reads===1?unavailable:{summary:copy(summary)}});
 assert.ok(h.root.querySelector('.f-content-editor'));assert.ok(h.root.querySelector('.f-admin-settings'));
 const dashboard=h.root.querySelector('.f-admin-summary');assert.ok(dashboard);assert.ok(key(dashboard,'error'));
 await key(dashboard,'refreshSummary').listeners.click();assert.match(content(dashboard),/237/);assert.equal(h.requests.filter(request=>request.path==='/api/admin/fiiu/registrations').length,1);
});

test('a slow summary does not hold up the organizer editing controls',async()=>{
 let finish;const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>new Promise(resolve=>{finish=resolve;})});
 assert.ok(h.root.querySelector('.f-content-editor'),'the organizer can work while totals are still loading');
 assert.ok(h.root.querySelector('.f-admin-settings'));
 finish({summary:copy(summary)});await flush();assert.match(content(h.root.querySelector('.f-admin-summary')),/237/);
});

test('automatic totals refresh only while visible and never overlap or replace organizer drafts',async()=>{
 let reads=0,finish;const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>++reads===1?{summary:copy(summary)}:new Promise(resolve=>{finish=resolve;})});
 assert.equal(h.timers.length,1,'one refresh schedule should be installed');assert.equal(h.timers[0].delay,60000);
 const form=h.root.querySelector('.f-content-editor').querySelector('form');field(form,'title').value='Unsent publication draft';
 h.visible(false);await h.tickTimers();assert.equal(reads,1,'background tabs must not poll');
 h.visible(true);const pending=h.tickTimers();assert.equal(reads,2);
 await h.tickTimers();await key(h.root.querySelector('.f-admin-summary'),'refreshSummary').listeners.click();assert.equal(reads,2,'manual and timed refreshes must share the same in-flight guard');
 finish({summary:{...copy(summary),totalRegistrations:239}});await pending;
 assert.match(content(h.root.querySelector('.f-admin-summary')),/239/);assert.equal(h.root.querySelector('.f-content-editor').querySelector('form'),form);assert.equal(field(form,'title').value,'Unsent publication draft');
});

test('opening participant details reports loading, never a save',async()=>{
 const h=await harness(({path})=>path==='/api/admin/fiiu/content'?{content:[],nextCursor:null}:{registration:copy(participant('participant-a','Ana')),attendance:[]},{participants:[participant('participant-a','Ana')]});
 const opening=detailButton(h,0).listeners.click();assert.equal(h.message.dataset.fiiuText,'loading');
 await opening;assert.notEqual(h.message.dataset.fiiuText,'changesSaved');assert.equal(h.message.dataset.fiiuText,'');assert.equal(detailTitle(h),'Ana Test');
});

test('participant search and lab filters narrow the loaded rows without new requests',async()=>{
 const ana=participant('participant-a','Ana'),bruno={...participant('participant-b','Bruno'),labStatus:'accepted'},carla={...participant('participant-c','Carla'),labStatus:'none',answers:{...participant('participant-c','Carla').answers,publicOfficial:false,applyLab:false}};
 const h=await harness(()=>({content:[],nextCursor:null}),{participants:[carla,bruno,ana]});
 const rows=()=>participantNames(h),reads=h.requests.length,timers=fakeTimers(h);
 assert.deepEqual(rows(),['Ana Test','Bruno Test','Carla Test'],'rows are ordered by name, not by id');
 const search=field(h.root,'searchParticipants');type(search,'bru');timers.run();assert.deepEqual(rows(),['Bruno Test']);
 type(search,'BRÚ');timers.run();assert.deepEqual(rows(),['Bruno Test'],'search ignores case and accents');
 type(search,'nobody');timers.run();assert.equal(rows().length,0);assert.ok(key(h.root,'noMatches'));
 type(search,'');timers.run();
 const pending=key(h.root,'filterLabPending');pending.listeners.click();assert.deepEqual(rows(),['Ana Test']);assert.equal(pending['aria-pressed'],'true');assert.equal(key(h.root,'filterAll')['aria-pressed'],'false');
 key(h.root,'filterLabAccepted').listeners.click();assert.deepEqual(rows(),['Bruno Test']);
 key(h.root.querySelector('.f-admin-filters'),'publicOfficials').listeners.click();assert.deepEqual(rows(),['Ana Test','Bruno Test']);
 key(h.root,'filterAll').listeners.click();assert.equal(rows().length,3);assert.equal(h.requests.length,reads);
});

test('the summary review shortcut shows only pending applications',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{participants:[{...participant('participant-b','Bruno'),labStatus:'accepted'},participant('participant-a','Ana')]});
 key(h.root.querySelector('.f-admin-summary'),'reviewPendingAction').listeners.click();
 assert.deepEqual(h.root.querySelectorAll('.f-participant').map(row=>row.querySelector('strong').textContent),['Ana Test']);
 assert.equal(key(h.root,'filterLabPending')['aria-pressed'],'true');assert.equal(key(h.root,'filterLabPending').focused,true);
});

test('activity totals are split into conference and interest tables in programme order',async()=>{
 const split={...copy(summary),activities:[{activityId:'route-amancaes',registrations:0,externalInterests:3,attendance:0},{activityId:'day2-am',registrations:7,externalInterests:0,attendance:1},{activityId:'workshop-day1',registrations:0,externalInterests:2,attendance:0},{activityId:'day1-am',registrations:121,externalInterests:0,attendance:0}]};
 const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>({summary:copy(split)})});
 const dashboard=h.root.querySelector('.f-admin-summary'),tables=dashboard.querySelectorAll('table'),caption=table=>table.querySelector('caption')?.dataset.fiiuText;
 const conferences=tables.find(table=>caption(table)==='conferencesAndLab'),interests=tables.find(table=>caption(table)==='externalActivities');
 assert.ok(conferences);assert.ok(interests);assert.ok(key(dashboard,'externalActivities'));
 const titles=table=>table.querySelectorAll('tbody').flatMap(body=>body.querySelectorAll('tr')).filter(row=>row.className!=='f-group').map(row=>content(row.children[0]).trim().split(/\s+/).slice(0,3).join(' '));
 const conferenceIds=['day1-am','day2-am'].map(id=>FIIU_EVENT.activities.find(a=>a.id===id).title.split(/\s+/).slice(0,3).join(' '));
 assert.deepEqual(titles(conferences).filter(title=>conferenceIds.includes(title)),conferenceIds,'Wednesday before Thursday, whatever the server order');
 const interestTitles=['workshop-day1','route-amancaes'].map(id=>[...FIIU_EVENT.legacyActivities,...FIIU_EVENT.activities].find(a=>a.id===id).title.split(/\s+/).slice(0,3).join(' '));
 assert.deepEqual(titles(interests),interestTitles,'a legacy workshop with interest joins the workshop table, before the Saturday route');
 assert.equal(conferences.querySelectorAll('tbody')[0].querySelector('.f-group').children[0].scope,'rowgroup');
 assert.match(content(conferences),/121/);assert.match(content(interests),/3/);
});

test('closing registration asks first and a declined confirmation saves nothing',async()=>{
 const h=await harness(({method,body})=>method==='GET'?{content:[],nextCursor:null}:{config:{...body,version:body.version+1}});
 const form=h.root.querySelector('.f-admin-settings').querySelector('form'),open=field(form,'registrationOpen');let asked=0;
 assert.equal(open.role,'switch');h.ctx.window.confirm=()=>{asked++;return false;};
 open.checked=false;await submit(form);assert.equal(asked,1);assert.equal(open.checked,true,'a declined close keeps registration open');
 assert.equal(h.requests.filter(request=>request.method==='PUT').length,0);
 h.ctx.window.confirm=()=>{asked++;return true;};open.checked=false;await submit(form);
 assert.equal(asked,2);assert.equal(h.requests.filter(request=>request.method==='PUT')[0].body.registrationOpen,false);assert.equal(h.message.dataset.fiiuText,'changesSaved');
 assert.equal(key(h.root.querySelector('.f-admin-head'),'registrationClosedNow')?.href,'#settings');
});

test('participant detail masks the national ID, skips empty answers and autosaves attendance without disabling it',async()=>{
 const ana=participant('participant-a','Ana');Object.assign(ana.answers,{nationalId:'12345678',accessibility:['none'],accessibilityOther:'',externalActivities:['route-amancaes']});let finishAttendance;
 const h=await harness(({path,method})=>{
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(method==='PUT')return new Promise(resolve=>{finishAttendance=resolve;});
  return{registration:copy(ana),attendance:[]};
 },{participants:[ana]});
 await detailButton(h,0).listeners.click();const detail=h.root.querySelector('.f-admin-detail');
 assert.match(content(detail),/•••• 5678/);assert.doesNotMatch(content(detail),/12345678/);
 key(detail,'showId').listeners.click();assert.match(content(detail),/12345678/);assert.ok(key(detail,'hideId'));
 assert.equal(key(detail,'accessibilityOtherAdmin'),undefined,'empty answers are not listed');assert.equal(detail.querySelector('form'),detail.querySelector('.f-review-card').querySelector('form'));
 const row=detail.querySelectorAll('.f-attendance-row').find(node=>key(node,'statusRegistered')),input=row.querySelector('input'),note=row.querySelector('.f-inline-status');
 input.checked=true;const saving=input.listeners.change();assert.equal(input.disabled,false);assert.equal(input['aria-disabled'],'true');
 input.checked=false;input.listeners.change();assert.equal(input.checked,true,'a toggle while saving is undone');assert.equal(h.requests.filter(request=>request.method==='PUT').length,1);
 finishAttendance({ok:true});await saving;assert.equal(note.dataset.fiiuText,'attendanceSaved');assert.equal(input['aria-disabled'],undefined);
 assert.deepEqual(h.requests.find(request=>request.method==='PUT').body,{activityId:'day1-am',attended:true});
 assert.ok(detail.querySelectorAll('.f-attendance-row').some(node=>key(node,'interestChip')),'saved interests are listed with the person’s own plans');
});

test('cancelling a publication edit restores a blank new-publication form',async()=>{
 const post={id:'post-a',version:1,title:'Existing announcement',body:'',url:'',kind:'news',status:'published',activityId:'',updatedAt:'2026-09-29T12:00:00.000Z'};
 const h=await harness(({method})=>method==='GET'?{content:[copy(post)],nextCursor:null}:{content:copy(post)});
 const item=h.root.querySelector('.f-news-item');assert.ok(key(item,'published'));assert.ok(key(item,'newsKind'));
 key(item,'editContent').listeners.click();const editor=h.root.querySelector('.f-content-editor');
 assert.equal(field(editor,'title').value,'Existing announcement');key(editor,'cancelEdit').listeners.click();
 assert.equal(field(editor,'title').value,'');assert.ok(key(editor,'newContent'));assert.equal(key(editor,'cancelEdit'),undefined);assert.equal(field(editor,'title').focused,true);
});

test('filtered views over a partial participant list say so, and loading more reads the next page once',async()=>{
 const ana=participant('participant-a','Ana'),bruno={...participant('participant-b','Bruno'),labStatus:'accepted'};
 const h=await createFiiuHarness(({path})=>{
  if(path==='/api/fiiu')return{event:FIIU_EVENT,config:DEFAULT_CONFIG,content:[],nextCursor:null};
  if(path==='/api/admin/fiiu/config')return{config:{...DEFAULT_CONFIG,version:0}};
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(path==='/api/admin/fiiu/summary')return{summary:copy(summary)};
  if(path==='/api/admin/fiiu/registrations')return{registrations:[copy(ana)],nextCursor:'page-2'};
  if(path==='/api/admin/fiiu/registrations?cursor=page-2')return{registrations:[copy(bruno)],nextCursor:null};
  throw Error('Unexpected request '+path);
 },{page:'fiiu-admin'});
 assert.equal(key(h.root,'showingLoaded'),undefined,'the unfiltered list needs no partial-results note');
 key(h.root,'filterLabAccepted').listeners.click();assert.ok(key(h.root,'showingLoaded'));assert.ok(key(h.root,'noMatches'));
 await key(h.root.querySelector('.f-admin-list'),'loadMore').listeners.click();
 assert.equal(h.requests.filter(request=>request.path.startsWith('/api/admin/fiiu/registrations')).length,2);
 assert.deepEqual(h.root.querySelectorAll('.f-participant').map(row=>row.querySelector('strong').textContent),['Bruno Test']);
 assert.equal(key(h.root,'showingLoaded'),undefined);assert.equal(key(h.root.querySelector('.f-admin-list'),'loadMore'),undefined);assert.equal(h.message.dataset.fiiuText,'');
});

test('timed totals refresh in the background: the button stays usable, nothing says Loading and only failures are shown',async()=>{
 let reads=0,finish;const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>++reads===1?{summary:copy(summary)}:new Promise(resolve=>{finish=resolve;})});
 const dashboard=h.root.querySelector('.f-admin-summary'),refresh=key(dashboard,'refreshSummary'),body=dashboard.children[1];
 assert.ok(key(dashboard,'updatedAt'),'a successful load stamps the update time');
 const pending=h.tickTimers();assert.equal(reads,2);assert.equal(refresh.disabled,false);assert.equal(key(dashboard,'loading'),undefined);assert.equal(body['aria-busy'],'true');
 finish(unavailable);await pending;assert.ok(key(dashboard,'error'));assert.equal(body['aria-busy'],'false');assert.match(content(dashboard),/237/,'the last good totals stay visible');
});

test('a live language switch reformats locale-dependent numbers and keeps short table headings in sync',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}));const counter=h.root.querySelector('.f-counter'),dashboard=h.root.querySelector('.f-admin-summary');
 assert.equal(counter.textContent,'0 / 5,000');const short=key(dashboard,'registeredShort');assert.ok(short);assert.equal(short['aria-hidden'],'true');assert.ok(key(short.parent,'registered'));
 h.lang('pt');assert.equal(counter.textContent,'0 / 5.000');assert.match(content(h.root.querySelector('.f-admin-summary')),/237/);
});

test('timed totals can be paused, and a refresh that brings identical totals leaves the tables in place',async()=>{
 let reads=0;const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>{reads++;return{summary:copy(summary)};}});
 const dashboard=h.root.querySelector('.f-admin-summary'),table=()=>dashboard.querySelector('table'),before=table();
 await h.tickTimers();assert.equal(reads,2);assert.equal(table(),before,'identical totals must not rebuild the tables under a screen reader');assert.ok(key(dashboard,'updatedAt'));
 const toggle=field(dashboard,'autoRefresh');assert.equal(toggle.checked,true);assert.equal(toggle.role,'switch');assert.ok(key(dashboard,'autoRefresh'));
 toggle.checked=false;toggle.listeners.change();await h.tickTimers();assert.equal(reads,2,'a paused refresh does not poll');
 toggle.checked=true;await toggle.listeners.change();assert.equal(reads,3,'switching it back on catches up at once');
 await key(dashboard,'refreshSummary').listeners.click();assert.equal(reads,4,'manual refresh still works');assert.equal(h.timers.length,1);
});

test('participant detail lists interests whose activity left the catalogue and names each day of other activities',async()=>{
 const ana=participant('participant-a','Ana');ana.answers.externalActivities=['route-amancaes','retired-workshop-2025'];
 const h=await harness(({path})=>path==='/api/admin/fiiu/content'?{content:[],nextCursor:null}:{registration:copy(ana),attendance:[]},{participants:[ana]});
 await detailButton(h,0).listeners.click();const detail=h.root.querySelector('.f-admin-detail');
 assert.match(content(detail.querySelector('.f-attendance')),/retired-workshop-2025/);
 const others=detail.querySelectorAll('summary').filter(node=>node.dataset.fiiuText==='otherActivities'),dates=new Set(detail.querySelectorAll('.f-attendance-date').map(node=>node.id));
 assert.ok(others.length>=2);assert.equal(new Set(others.map(node=>node['aria-describedby'])).size,others.length,'each disclosure is described by its own day');
 assert.ok(others.every(node=>dates.has(node['aria-describedby'])));
});

test('an empty filtered list offers a reset that shows everyone again',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{participants:[participant('participant-a','Ana')]});
 key(h.root,'filterLabAccepted').listeners.click();assert.ok(key(h.root,'noMatches'));
 key(h.root.querySelector('.f-admin-list'),'showAll').listeners.click();
 assert.equal(h.root.querySelectorAll('.f-participant').length,1);assert.equal(key(h.root,'filterAll')['aria-pressed'],'true');assert.equal(key(h.root,'filterAll').focused,true);
 assert.equal(key(h.root.querySelector('.f-admin-list'),'showAll'),undefined);
});

test('loading the last participant page moves focus to the first new row, not back to the search box',async()=>{
 const ana=participant('participant-a','Ana'),bruno=participant('participant-b','Bruno');
 const h=await createFiiuHarness(({path})=>{
  if(path==='/api/fiiu')return{event:FIIU_EVENT,config:DEFAULT_CONFIG,content:[],nextCursor:null};
  if(path==='/api/admin/fiiu/config')return{config:{...DEFAULT_CONFIG,version:0}};
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(path==='/api/admin/fiiu/summary')return{summary:copy(summary)};
  if(path==='/api/admin/fiiu/registrations')return{registrations:[copy(bruno)],nextCursor:'page-2'};
  if(path==='/api/admin/fiiu/registrations?cursor=page-2')return{registrations:[copy(ana)],nextCursor:null};
  throw Error('Unexpected request '+path);
 },{page:'fiiu-admin'});
 await key(h.root.querySelector('.f-admin-list'),'loadMore').listeners.click();
 assert.equal(detailButton(h,0).focused,true,'Ana, loaded last, sorts first and receives focus');assert.notEqual(field(h.root,'searchParticipants').focused,true);
});

test('saving an edited publication returns focus to that publication in the list',async()=>{
 const post={id:'post-a',version:1,title:'Existing announcement',body:'',url:'',kind:'news',status:'published',activityId:''};
 const h=await harness(({method,body})=>method==='GET'?{content:[copy(post)],nextCursor:null}:{content:{...post,...body,version:2}});
 await key(h.root.querySelector('.f-news-item'),'editContent').listeners.click();const form=h.root.querySelector('.f-content-editor').querySelector('form');
 field(form,'title').value='Corrected announcement';await submit(form);
 assert.equal(key(h.root.querySelector('.f-pub'),'editContent').focused,true);assert.ok(key(h.root.querySelector('.f-content-editor'),'newContent'));
});

test('organiser forms show validation messages in the page language and drop them once an answer changes',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}));h.lang('es');
 const form=h.root.querySelector('.f-content-editor').querySelector('form'),title=field(form,'title'),url=field(form,'url');
 title.validity={valueMissing:true};form.listeners.invalid({target:title});assert.equal(title.validationMessage,h.ctx.window.Fiiu.t('requiredField'));
 url.validity={typeMismatch:true};form.listeners.invalid({target:url});assert.equal(url.validationMessage,h.ctx.window.Fiiu.t('adminInvalid'));
 form.listeners.input({target:title});assert.equal(title.validationMessage,'');assert.equal(url.validationMessage,'');
});

test('a laboratory review updates its row in place and keeps every page loaded with Load more',async()=>{
 const people={a:participant('a','Ana'),b:participant('b','Bruno'),c:participant('c','Carla')};
 const h=await createFiiuHarness(({path,method,body})=>{
  if(path==='/api/fiiu')return{event:FIIU_EVENT,config:DEFAULT_CONFIG,content:[],nextCursor:null};
  if(path==='/api/admin/fiiu/config')return{config:{...DEFAULT_CONFIG,version:0}};
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(path==='/api/admin/fiiu/summary')return{summary:copy(summary)};
  if(path==='/api/admin/fiiu/registrations')return{registrations:[copy(people.a)],nextCursor:'a'};
  if(path==='/api/admin/fiiu/registrations?cursor=a')return{registrations:[copy(people.b),copy(people.c)],nextCursor:null};
  const person=people[path.split('/').pop()];
  if(method==='PATCH'){Object.assign(person,{labStatus:body.labStatus,version:person.version+1});return{registration:copy(person)};}
  return{registration:copy(person),attendance:[]};
 },{page:'fiiu-admin'});
 const list=()=>h.root.querySelector('.f-admin-list'),pageReads=()=>h.requests.filter(request=>/^\/api\/admin\/fiiu\/registrations(\?|$)/.test(request.path)).length;
 key(h.root,'filterLabPending').listeners.click();await key(list(),'loadMore').listeners.click();
 assert.deepEqual(participantNames(h),['Ana Test','Bruno Test','Carla Test']);assert.equal(pageReads(),2);
 await detailButton(h,1).listeners.click();const form=h.root.querySelector('.f-review-card').querySelector('form');
 field(form,'review').value='reviewAccepted';await submit(form);assert.equal(h.message.dataset.fiiuText,'changesSaved');
 assert.deepEqual(participantNames(h),['Ana Test','Carla Test'],'Carla, loaded with Load more and still pending, stays; accepted Bruno leaves the pending view');
 assert.equal(pageReads(),2,'no page is read again');assert.equal(key(list(),'loadMore'),undefined);assert.equal(key(list(),'showingLoaded'),undefined);
 assert.equal(detailTitle(h),'Bruno Test');assert.ok(key(h.root.querySelector('.f-review-card'),'acceptedShort'),'the detail shows the saved review');
 key(h.root,'filterAll').listeners.click();const bruno=h.root.querySelectorAll('.f-participant')[1];
 assert.ok(key(bruno,'acceptedShort'),'the list row shows the saved review');assert.equal(bruno.className,'f-participant is-selected');
});

test('saving a publication updates the list in place and keeps every page loaded with Load more',async()=>{
 const posts={new1:{id:'new1',version:1,title:'Newest news',body:'',url:'',kind:'news',status:'published',activityId:''},old1:{id:'old1',version:1,title:'Old material',body:'',url:'https://example.test/material',kind:'material',status:'published',activityId:''}};
 const h=await harness(({path,method,body})=>{
  if(method==='POST')return{content:{...body,version:1}};
  if(path==='/api/admin/fiiu/content')return{content:[copy(posts.new1)],nextCursor:'new1'};
  if(path==='/api/admin/fiiu/content?cursor=new1')return{content:[copy(posts.old1)],nextCursor:null};
  const post=posts[path.split('/').pop()];Object.assign(post,body,{version:post.version+1});return{content:copy(post)};
 });
 const section=()=>h.root.querySelector('.f-admin-content'),listReads=()=>h.requests.filter(request=>request.method==='GET'&&request.path.startsWith('/api/admin/fiiu/content')).length;
 await key(section(),'loadMore').listeners.click();assert.deepEqual(publicationTitles(h),['Newest news','Old material']);
 await key(h.root.querySelectorAll('.f-pub')[1],'editContent').listeners.click();
 field(editorForm(h),'title').value='Old material (corrected)';await submit(editorForm(h));
 assert.deepEqual(publicationTitles(h),['Newest news','Old material (corrected)'],'the older page stays and shows the saved title');
 field(editorForm(h),'title').value='Brand new';await submit(editorForm(h));
 assert.deepEqual(publicationTitles(h),['Brand new','Newest news','Old material (corrected)'],'a new publication joins the top of the list');
 assert.equal(key(section(),'loadMore'),undefined);assert.equal(listReads(),2,'saving never re-reads the list');
});

test('an editor opened during a save keeps its own version, so saving it gets the conflict; reloading brings in only that publication',async()=>{
 const server={id:'p1',version:1,title:'Venue: Hall A',body:'Opening at 9:00',kind:'news',status:'published',activityId:'',url:''};let gate=null,asked=0;
 const h=await harness(({method,body})=>{
  if(method==='GET')return{content:[copy(server)],nextCursor:null};
  if(body.version!==server.version)return{status:409,data:{error:'content changed; reload before saving'}};
  const apply=()=>{Object.assign(server,{title:body.title,body:body.body,version:server.version+1});return{content:copy(server)};};
  if(!gate)return apply();const wait=gate;gate=null;return wait.then(apply);
 });
 h.ctx.window.confirm=()=>{asked++;return true;};
 await key(h.root.querySelector('.f-pub'),'editContent').listeners.click();
 const first=editorForm(h);field(first,'title').value='Venue CHANGED: Hall B';
 let release;gate=new Promise(resolve=>{release=resolve;});first.listeners.submit({preventDefault(){}});await flush();
 key(h.root.querySelector('.f-pub'),'editContent').listeners.click();
 const second=editorForm(h);assert.equal(field(second,'title').value,'Venue: Hall A');
 release();await flush();
 assert.equal(server.version,2);assert.deepEqual(publicationTitles(h),['Venue CHANGED: Hall B']);assert.equal(editorForm(h),second,'the newer editor stays open');
 field(second,'body').value='Opening at 9:00. Bring ID.';await submit(second);
 assert.equal(h.message.dataset.fiiuText,'editorConflict');assert.equal(server.title,'Venue CHANGED: Hall B','the first save is not silently reverted');
 assert.deepEqual(h.requests.filter(request=>request.method==='PATCH').map(request=>request.body.version),[1,1]);
 await key(second,'reloadLatest').listeners.click();
 const latest=editorForm(h);assert.notEqual(latest,second);assert.equal(field(latest,'title').value,'Venue CHANGED: Hall B');assert.equal(field(latest,'title').focused,true);
 assert.equal(h.reloads(),0,'only that publication is re-read, not the page');assert.equal(h.message.dataset.fiiuText,'');
 field(latest,'body').value='Opening at 9:00. Bring ID.';await submit(latest);
 assert.deepEqual({title:server.title,body:server.body,version:server.version},{title:'Venue CHANGED: Hall B',body:'Opening at 9:00. Bring ID.',version:3});
 assert.equal(asked,1,'leaving the first edit while it had unsaved changes asked first');
});

test('writes during an in-flight totals refresh get exactly one more refresh once it lands',async()=>{
 const base=participant('participant-a','Ana'),ana={...base,labStatus:'none',answers:{...base.answers,publicOfficial:false,applyLab:false,activities:['day1-am','day2-am']}};
 let reads=0;const pending=[];
 const h=await harness(({path,method})=>{
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(method==='PUT')return{attendance:[]};
  return{registration:copy(ana),attendance:[]};
 },{participants:[ana],summaryRead:()=>++reads===1?{summary:copy(summary)}:new Promise(resolve=>pending.push(resolve))});
 await detailButton(h,0).listeners.click();
 const boxes=h.root.querySelector('.f-admin-detail').querySelectorAll('.f-attendance-row').filter(row=>key(row,'statusRegistered')).map(row=>row.querySelector('input'));assert.equal(boxes.length,2);
 const tick=h.tickTimers();assert.equal(reads,2,'the timed refresh is in flight');
 for(const box of boxes){box.checked=true;await box.listeners.change();}
 assert.equal(reads,2,'the writes wait for the refresh in flight instead of overlapping it');
 pending[0]({summary:copy(summary)});await tick;await flush();
 assert.equal(reads,3,'one more refresh runs after the one in flight');
 pending[1]({summary:{...copy(summary),totalRegistrations:238}});await flush();
 assert.match(content(h.root.querySelector('.f-admin-summary')),/238/);assert.equal(reads,3,'and only one for both writes');
});

test('reloading the latest settings after a conflict re-reads only the settings and leaves other drafts alone',async()=>{
 let reads=0;
 const h=await harness(({method})=>method==='GET'?{content:[],nextCursor:null}:{status:409,data:{error:'configuration changed; reload before saving'}},{configRead:()=>({config:++reads===1?{...DEFAULT_CONFIG,version:0}:{...DEFAULT_CONFIG,partyUrl:'https://example.test/party-latest',version:3}})});
 const draft=editorForm(h);field(draft,'title').value='Unsaved room change';
 const form=h.root.querySelector('.f-admin-settings').querySelector('form');field(form,'partyUrl').value='https://example.test/party-mine';await submit(form);
 assert.equal(h.message.dataset.fiiuText,'editorConflict');
 await key(form,'reloadLatest').listeners.click();
 const fresh=h.root.querySelector('.f-admin-settings').querySelector('form');
 assert.notEqual(fresh,form);assert.equal(field(fresh,'partyUrl').value,'https://example.test/party-latest');assert.equal(field(fresh,'registrationOpen').focused,true);
 assert.equal(h.reloads(),0,'the page is not reloaded');assert.equal(h.message.dataset.fiiuText,'');
 assert.equal(editorForm(h),draft);assert.equal(field(draft,'title').value,'Unsaved room change','an unrelated draft survives');
 await submit(fresh);assert.equal(h.requests.filter(request=>request.method==='PUT').at(-1).body.version,3,'the next save uses the version just read');
});

test('reloading the latest review after a conflict re-reads only that participant',async()=>{
 const ana=participant('participant-a','Ana');let reads=0;
 const h=await harness(({path,method})=>{
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(method==='PATCH')return{status:409,data:{error:'registration changed; reload before reviewing'}};
  return{registration:++reads===1?copy(ana):{...copy(ana),labStatus:'declined',version:2},attendance:[]};
 },{participants:[ana]});
 const draft=editorForm(h);field(draft,'title').value='Unsaved announcement';
 await detailButton(h,0).listeners.click();const form=h.root.querySelector('.f-review-card').querySelector('form');
 field(form,'review').value='reviewAccepted';await submit(form);assert.equal(h.message.dataset.fiiuText,'editorConflict');
 await key(form,'reloadLatest').listeners.click();
 const fresh=h.root.querySelector('.f-review-card').querySelector('form');
 assert.notEqual(fresh,form);assert.equal(field(fresh,'review').value,'reviewDeclined','the review shows what the other organiser saved');assert.equal(field(fresh,'review').focused,true);
 assert.ok(key(h.root.querySelector('.f-participant'),'declinedShort'),'the list row is brought up to date too');
 assert.equal(h.reloads(),0);assert.equal(field(draft,'title').value,'Unsaved announcement');
 field(fresh,'review').value='reviewAccepted';await submit(fresh);
 assert.deepEqual(h.requests.filter(request=>request.method==='PATCH').map(request=>request.body.version),[1,2],'the next save uses the version just read');
});

test('editing a publication sets an unsaved new draft aside: Cancel, or saving the edit, brings it back',async()=>{
 const post={id:'p1',version:1,title:'Existing news',body:'',url:'',kind:'news',status:'published',activityId:''};let asked=0;
 const h=await harness(({method,body})=>method==='GET'?{content:[copy(post)],nextCursor:null}:{content:{...post,...body,version:2}});h.ctx.window.confirm=()=>{asked++;return true;};
 const editor=()=>h.root.querySelector('.f-content-editor'),draft={title:'Unsaved new post',body:'Two paragraphs, not saved yet',kind:'material',url:'https://example.test/slides'};
 for(const [name,value] of Object.entries(draft))field(editor(),name).value=value;
 key(h.root.querySelector('.f-pub'),'editContent').listeners.click();
 assert.equal(asked,0,'a new draft is set aside, not discarded');assert.equal(field(editor(),'title').value,'Existing news');
 key(editor(),'cancelEdit').listeners.click();
 assert.ok(key(editor(),'newContent'));assert.equal(field(editor(),'title').focused,true);
 for(const [name,value] of Object.entries(draft))assert.equal(field(editor(),name).value,value,name+' comes back after Cancel');
 key(h.root.querySelector('.f-pub'),'editContent').listeners.click();field(editor(),'title').value='Existing news, corrected';await submit(editorForm(h));
 assert.deepEqual(publicationTitles(h),['Existing news, corrected']);assert.ok(key(editor(),'newContent'));
 for(const [name,value] of Object.entries(draft))assert.equal(field(editor(),name).value,value,name+' comes back after saving the edit');
 assert.equal(asked,0);
});

test('replacing an edited publication that has unsaved changes asks first',async()=>{
 const posts=[{id:'p1',version:1,title:'First',body:'',url:'',kind:'news',status:'published',activityId:''},{id:'p2',version:1,title:'Second',body:'',url:'',kind:'news',status:'draft',activityId:''}];let answer=false,asked=0;
 const h=await harness(()=>({content:copy(posts),nextCursor:null}));h.ctx.window.confirm=message=>{asked++;assert.ok(message);return answer;};
 const edit=index=>key(h.root.querySelectorAll('.f-pub')[index],'editContent').listeners.click(),title=()=>field(editorForm(h),'title');
 edit(0);edit(1);assert.equal(asked,0,'an unchanged edit is replaced without asking');assert.equal(title().value,'Second');
 title().value='Second, half corrected';edit(0);
 assert.equal(asked,1);assert.equal(title().value,'Second, half corrected','declining keeps the unsaved edit');
 answer=true;edit(0);assert.equal(asked,2);assert.equal(title().value,'First');
});

test('the registrations CSV downloads through fetch, and a failed export is reported without leaving the dashboard',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null})),timers=fakeTimers(h),events=[],signals=[],fetchPage=h.ctx.fetch,createElement=h.ctx.document.createElement;let reply;
 h.ctx.URL={createObjectURL:blob=>{events.push(['object URL',blob]);return 'blob:nodal/export';},revokeObjectURL:href=>events.push(['revoked',href])};
 // The lightweight DOM has no link clicks or node removal; record them instead.
 h.ctx.document.createElement=tag=>{const node=createElement(tag);if(tag==='a')Object.assign(node,{click(){events.push(['download',this.href,this.download,this.parent===h.body]);},remove(){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}});return node;};
 h.ctx.fetch=async(path,options)=>{if(path!=='/api/admin/fiiu/export')return fetchPage(path,options);signals.push(options.signal);return reply();};
 const csv=key(h.root.querySelector('.f-admin-head'),'export');
 assert.equal(csv.tagName,'button');assert.equal(csv.href,undefined,'no link that would navigate the dashboard tab');assert.equal(csv['aria-describedby'],'f-export-note','the privacy note still describes it');
 const failure=code=>async()=>({ok:false,status:code,headers:{get:()=>'application/json'},blob:async()=>{throw Error('not a CSV');}});
 for(const [code,shown] of [[401,'unauthorized'],[429,'rate'],[502,'error']]){reply=failure(code);await csv.listeners.click();assert.equal(h.message.dataset.fiiuText,shown);assert.equal(csv.disabled,false);}
 reply=async()=>{throw TypeError('Failed to fetch');};await csv.listeners.click();assert.equal(h.message.dataset.fiiuText,'error');
 assert.equal(events.length,0,'nothing is downloaded when the export fails');assert.ok(h.root.querySelector('.f-admin-head'),'the dashboard stays');
 const file={type:'text/csv'};reply=async()=>({ok:true,status:200,headers:{get:name=>name==='Content-Disposition'?'attachment; filename="fiiu-2026-registrations.csv"':'text/csv; charset=utf-8'},blob:async()=>file});
 const downloading=csv.listeners.click();assert.equal(csv.disabled,true);assert.equal(h.message.dataset.fiiuText,'loading');await downloading;
 assert.deepEqual(events,[['object URL',file],['download','blob:nodal/export','fiiu-2026-registrations.csv',true]]);
 assert.equal(h.body.children.some(node=>node.tagName==='a'),false,'the temporary link is removed');assert.equal(h.message.dataset.fiiuText,'');
 assert.deepEqual(timers.delays(),[60000]);timers.run();assert.deepEqual(events.at(-1),['revoked','blob:nodal/export']);
 assert.ok(signals.every(signal=>signal instanceof AbortSignal),'each export has a time limit where the browser supports one');
 h.ctx.AbortSignal={};await csv.listeners.click();
 assert.equal(signals.at(-1),undefined);assert.deepEqual(events.at(-1),['download','blob:nodal/export','fiiu-2026-registrations.csv',true],'Safari before 16, without AbortSignal.timeout, still downloads');
});

test('settings edit only the links the public page shows and send the other saved links back unchanged',async()=>{
 const saved={...DEFAULT_CONFIG,version:4,workshopsUrl:'https://example.test/workshops',routesUrl:'https://example.test/routes'};
 const h=await harness(({method,body})=>method==='GET'?{content:[],nextCursor:null}:{config:{...body,version:body.version+1}},{configRead:()=>({config:copy(saved)})});
 const form=h.root.querySelector('.f-admin-settings').querySelector('form');
 assert.deepEqual(form.querySelectorAll('input').filter(input=>input.type==='url').map(input=>input.name),['programUrl','partyUrl']);
 field(form,'partyUrl').value='https://example.test/party';await submit(form);
 const body=h.requests.find(request=>request.method==='PUT').body;
 assert.equal(body.partyUrl,'https://example.test/party');assert.equal(body.programUrl,saved.programUrl);assert.equal(body.version,4);
 assert.equal(body.workshopsUrl,saved.workshopsUrl);assert.equal(body.routesUrl,saved.routesUrl);
});

test('a finished totals refresh returns focus to Refresh only when focus was lost, not after the organiser moved on',async()=>{
 let reads=0,finish;const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>++reads===1?{summary:copy(summary)}:new Promise(resolve=>{finish=resolve;})});
 const refresh=key(h.root.querySelector('.f-admin-summary'),'refreshSummary'),searchBox=field(h.root,'searchParticipants'),doc=h.ctx.document;
 doc.activeElement=refresh;let running=refresh.listeners.click();doc.activeElement=searchBox;refresh.focused=false;
 finish({summary:copy(summary)});await running;assert.notEqual(refresh.focused,true,'focus stays in the search box the organiser moved to');
 doc.activeElement=refresh;running=h.tickTimers();doc.activeElement=searchBox;
 finish({summary:copy(summary)});await running;assert.notEqual(refresh.focused,true,'a timed refresh does not pull focus back either');
 doc.activeElement=refresh;running=refresh.listeners.click();doc.activeElement=doc.body;
 finish({summary:copy(summary)});await running;assert.equal(refresh.focused,true,'focus that fell to the page body returns to Refresh');
});

test('participant search waits for a pause in typing, then shows rows already built without sorting or normalising the list again',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{participants:['Carla','Bruno','Ana'].map((name,i)=>participant('participant-'+i,name))});
 const timers=fakeTimers(h),search=field(h.root,'searchParticipants'),rows=()=>h.root.querySelectorAll('.f-participant'),before=rows();
 const prototype=vm.runInContext('String.prototype',h.ctx),{localeCompare,normalize}=prototype;let compared=0,normalised=0;
 prototype.localeCompare=function(...args){compared++;return localeCompare.apply(this,args);};prototype.normalize=function(...args){normalised++;return normalize.apply(this,args);};
 try{
  type(search,'b');type(search,'br');type(search,'bru');
  assert.equal(rows().length,3,'nothing is filtered while the organiser is still typing');assert.deepEqual(timers.delays(),[120]);
  timers.run();assert.deepEqual(participantNames(h),['Bruno Test']);assert.equal(rows()[0],before[1],'the existing row is shown again, not rebuilt');
  type(search,'');timers.run();assert.ok(rows().length===3&&rows().every((row,i)=>row===before[i]),'clearing the search re-attaches the same rows');
  assert.equal(compared,0,'typing never sorts the list again');assert.equal(normalised,2,'only each query is normalised; record keys were computed when they loaded');
 }finally{Object.assign(prototype,{localeCompare,normalize});}
});

test('participant search matches a capital I even where the default locale lowercases it to a dotless ı',async()=>{
 const isabel=participant('participant-i','Isabel');isabel.answers.lastName='Díaz';
 const h=await harness(()=>({content:[],nextCursor:null}),{participants:[isabel,participant('participant-b','Bruno')]}),timers=fakeTimers(h);
 const prototype=vm.runInContext('String.prototype',h.ctx),{toLocaleLowerCase}=prototype;
 // Safari with Turkish as the preferred language lowercases I to ı when no locale is given.
 prototype.toLocaleLowerCase=function(){return String(this).replace(/I/g,'ı').toLowerCase();};
 try{type(field(h.root,'searchParticipants'),'ISABEL DIAZ');timers.run();assert.deepEqual(participantNames(h),['Isabel Díaz']);}
 finally{prototype.toLocaleLowerCase=toLocaleLowerCase;}
});

// Check-in, hours and access. The fuller summary carries the newer fields; the original fixture above lacks them, as before the migration.
const checkinSummary={...copy(summary),attendedPeople:41,qrPeople:33,lastCheckInAt:'2026-10-21T14:40:00.000Z',
 activities:[{activityId:'day1-am',registrations:121,externalInterests:0,attendance:30,officialAttendance:10},{activityId:'day1-pm',registrations:80,externalInterests:0,attendance:20,officialAttendance:5},{activityId:'workshop-calles-gente',registrations:0,externalInterests:9,attendance:2,officialAttendance:0}],
 days:[{date:'2026-10-20',registrations:20,attendance:0},{date:'2026-10-21',registrations:157,attendance:35},{date:'2026-10-22',registrations:90,attendance:0}]};
const frozen=iso=>{const at=Date.parse(iso);return class extends Date{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}};};
const festivalDay={Date:frozen('2026-10-21T10:00:00-05:00')};
const figures=h=>h.root.querySelector('.f-figures'),figureFor=(h,name)=>figures(h).children.find(node=>key(node,name));

test('the overview is one figure strip: registrations, officials, checked in with QR scans, hours with the officials’ share, and the lab queue over two tracks',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>({summary:copy(checkinSummary)}),context:festivalDay});
 assert.deepEqual(figures(h).children.map(node=>node.children[0].dataset.fiiuText),['totalRegistrations','publicOfficials','checkedIn','hoursTitle','labApplications']);
 assert.match(content(figureFor(h,'publicOfficials')),/27%/);assert.ok(key(figureFor(h,'publicOfficials'),'shareOfRegistrations'));
 assert.match(content(figureFor(h,'checkedIn')),/41/);assert.match(content(figureFor(h,'checkedIn')),/33/);assert.ok(key(figureFor(h,'checkedIn'),'byQr'));
 const hours=figureFor(h,'hoursTitle');assert.match(content(hours),/160 h/,'30 morning check-ins × 4 h + 20 evening × 2 h; the workshop adds none');assert.ok(key(hours,'officialsHours'));assert.match(content(hours),/50 h/);
 assert.equal(figures(h).children.at(-1).className,'f-figure f-lab-card');
 assert.ok(key(h.root.querySelector('.f-admin-toolbar'),'lastCheckIn'));assert.match(content(h.root.querySelector('.f-admin-toolbar')),/09:40/,'the last check-in is in Lima time');
});

test('figures whose fields are absent are left out, and before the festival the check-in figure already counts, since check-in has no opening time',async()=>{
 const old=await harness(()=>({content:[],nextCursor:null}));
 assert.equal(figureFor(old,'checkedIn'),undefined,'no attendedPeople, no figure');assert.ok(figureFor(old,'hoursTitle'));assert.equal(key(figureFor(old,'hoursTitle'),'officialsHours'),undefined);
 assert.equal(key(old.root.querySelector('.f-admin-toolbar'),'lastCheckIn'),undefined);
 const early=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>({summary:{...copy(checkinSummary),attendedPeople:0,qrPeople:0}}),context:{Date:frozen('2026-09-30T10:00:00-05:00')}});
 assert.match(content(figureFor(early,'checkedIn')),/\b0\b/);assert.ok(key(figureFor(early,'checkedIn'),'byQr'));
 const ahead=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>({summary:{...copy(checkinSummary),attendedPeople:3,qrPeople:3}}),context:{Date:frozen('2026-10-07T10:00:00-05:00')}});
 assert.match(content(figureFor(ahead,'checkedIn')),/\b3\b/,'people who checked in ahead of the festival are counted');
});

test('the day ledger has checked-in and hours columns and marks today with aria-current="date"',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>({summary:copy(checkinSummary)}),context:festivalDay});
 const ledger=h.root.querySelector('.f-summary-body').querySelectorAll('table').find(table=>table.className.includes('is-ledger'));
 assert.deepEqual(ledger.querySelector('thead').querySelectorAll('th').map(cell=>cell.children[0].dataset.fiiuText),['day','peopleWithPlans','attended','hours']);
 const rows=ledger.querySelector('tbody').querySelectorAll('tr'),today=rows.filter(row=>row['aria-current']==='date');
 assert.equal(today.length,1);assert.equal(today[0],rows[1]);assert.ok(key(today[0],'today'));assert.match(content(today[0]),/157/);assert.match(content(today[0]),/160 h/);
 assert.equal(key(rows[0],'today'),undefined);
 const profiles=h.root.querySelector('.f-summary-body').querySelectorAll('table').find(table=>table.className.includes('is-profiles'));
 assert.ok(key(profiles.querySelector('thead'),'share'));assert.match(content(profiles),/20%/,'48 of 237 students');
});

test('activity tables stack, the conference table adds venue and hours, and workshops keep their interest count',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>({summary:copy(checkinSummary)})});
 const tables=h.root.querySelector('.f-summary-stack').children.map(scroll=>scroll.children[0]),caption=table=>table.querySelector('caption').dataset.fiiuText;
 assert.deepEqual(tables.map(caption),['conferencesAndLab','externalActivities']);
 assert.deepEqual(tables[0].querySelector('thead').querySelectorAll('th').map(cell=>cell.children[0].dataset.fiiuText),['activity','venue','registered','attended','hours']);
 const morning=tables[0].querySelectorAll('tr').find(row=>/El poder de lo local/.test(content(row)));assert.match(content(morning),/Auditorio MALI/);assert.match(content(morning),/120 h/);
 assert.deepEqual(tables[1].querySelector('thead').querySelectorAll('th').map(cell=>cell.children[0].dataset.fiiuText),['activity','venue','interested','attended']);
});

test('the check-in section lists the six NODAL blocks by day with closing time, venue, live count and a screen link, and no workshops or routes',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>({summary:copy(checkinSummary)}),context:festivalDay});
 const section=h.root.querySelector('.f-admin-checkin');assert.equal(section.id,'checkin');assert.ok(key(section,'checkIn'));
 assert.ok(h.root.querySelector('.f-admin-nav').querySelectorAll('a').some(a=>a.href==='#checkin'));
 const links=section.querySelectorAll('a').filter(a=>a.dataset.fiiuText==='openCheckinScreen');
 assert.deepEqual(links.map(a=>a.href),['day0-lab','day1-am','day1-pm','day2-am','day2-pm','day3-am'].map(id=>'fiiu-qr.html?a='+id));
 assert.equal(links[1].target,'_blank');assert.equal(links[1]['aria-describedby'],'f-ck-day1-am f-newtab');
 const row=links[1].parent.parent;assert.match(content(row),/Check-in open until\s+13:30\s+Lima time/);assert.doesNotMatch(content(row),/08:30/);assert.match(content(row),/Auditorio MALI/);assert.match(content(row),/\b30\b/);
 // Stacked on a phone the column headings are hidden: the closing line names itself, and the count carries its own (otherwise hidden) unit.
 assert.equal(key(row,'checkinClosing'),undefined,'no column label in the row');
 assert.ok(row.querySelector('.f-col-checkinClosing').querySelector('.f-window'),'the closing line sits in the closing column');
 const count=row.querySelector('.f-summary-count');assert.match(count.textContent,/^30$/);assert.equal(key(count,'checkedInMany').className,'f-cell-unit');
 assert.doesNotMatch(content(section),/Calles para la gente/);assert.equal(key(section,'allScreens').href,'fiiu-qr.html');
 // From 800px the headings show: the column names the closing time, not a window.
 const head=section.querySelector('thead');assert.deepEqual(head.querySelectorAll('th').map(cell=>cell.children[0].dataset.fiiuText),['block','venue','checkinClosing','attended','openCheckinScreen']);
 for(const lang of ['en','es','pt']){h.lang(lang);const shown=h.root.querySelector('.f-admin-checkin').querySelector('thead');assert.equal(key(shown,'checkinClosing').textContent,{en:'Check-in closes',es:'Cierre del registro',pt:'Encerramento do registro'}[lang]);assert.doesNotMatch(content(shown),/window|Horario|Horário/i,lang);}
});

test('participant detail shows sessions and certificate hours, and how and when each block was confirmed, recomputed after a toggle',async()=>{
 const ana=participant('participant-a','Ana');ana.answers.activities=['day1-am','day1-pm'];
 const recorded=[{activityId:'day1-am',createdAt:'2026-10-21T14:12:00.000Z',method:'qr'}];
 const h=await harness(({path,method,body})=>{
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(method==='PUT')return{attendance:[...recorded,{activityId:body.activityId,createdAt:'2026-10-22T00:40:00.000Z',method:'staff'}]};
  return{registration:copy(ana),attendance:copy(recorded),hours:{minutes:240,hours:4,untimed:[]}};
 },{participants:[ana]});
 await detailButton(h,0).listeners.click();const fieldset=h.root.querySelector('.f-attendance'),totals=fieldset.querySelector('.f-attendance-total');
 assert.equal(fieldset.children[1],totals,'the totals sit right under the legend');assert.ok(key(totals,'attendedOne'));assert.ok(key(totals,'certificateHourMany'));assert.match(content(totals),/\b1\b.*\b4\b/);
 const rows=fieldset.querySelectorAll('.f-attendance-row'),morning=rows.find(row=>/El poder de lo local/.test(content(row))),evening=rows.find(row=>/Intervenir para activar/.test(content(row)));
 assert.ok(key(morning.querySelector('.f-attendance-method'),'methodQr'));assert.match(content(morning.querySelector('.f-attendance-method')),/09:12/);
 assert.equal(evening.querySelector('.f-attendance-method').children.length,0,'nothing is shown for a block not yet confirmed');
 const box=evening.querySelector('input');box.checked=true;await box.listeners.change();
 assert.ok(key(evening.querySelector('.f-attendance-method'),'methodTeam'));assert.match(content(evening.querySelector('.f-attendance-method')),/19:40/);
 assert.ok(key(totals,'attendedMany'));assert.match(content(totals),/\b2\b.*\b6\b/,'two sessions, 4 h + 2 h');
});

test('a 403 when the dashboard loads shows the organisers-only state with no Retry and no participant data',async()=>{
 const deny={status:403,data:{error:'administrator access required'}};
 const h=await createFiiuHarness(({path})=>path==='/api/fiiu'?{event:FIIU_EVENT,config:DEFAULT_CONFIG,content:[],nextCursor:null}:path==='/api/admin/fiiu/registrations'?{registrations:[participant('a','Ana')],nextCursor:null}:deny,{page:'fiiu-admin'});
 assert.ok(key(h.root,'organisersOnly'));assert.ok(key(h.root,'organisersOnlyHint'));assert.equal(key(h.root,'retry'),undefined);
 assert.equal(key(h.root,'fiiuPage').href,'fiiu.html');assert.equal(key(h.root,'backToConsole').href,'dashboard.html');
 assert.equal(h.root.querySelectorAll('.f-participant').length,0);assert.doesNotMatch(content(h.root),/ana@example/);
 const before=h.requests.length;await h.tickTimers();assert.equal(h.requests.length,before,'no polling once locked');
});

test('a 401 when the dashboard loads goes to sign-in and comes back to this page',async()=>{
 const h=await createFiiuHarness(({path})=>path==='/api/fiiu'?{event:FIIU_EVENT,config:DEFAULT_CONFIG,content:[],nextCursor:null}:{status:401,data:{error:'sign in required'}},{page:'fiiu-admin'});
 assert.deepEqual(h.assigned,['/login.html?next=%2Ffiiu-admin.html']);assert.equal(key(h.root,'retry'),undefined);
});

test('access lost during a timed refresh clears participants and answers from the page and stops further requests',async()=>{
 const ana=participant('participant-a','Ana');Object.assign(ana.answers,{nationalId:'12345678'});let deny=false;
 const h=await harness(({path})=>path==='/api/admin/fiiu/content'?{content:[],nextCursor:null}:{registration:copy(ana),attendance:[]},{participants:[ana],summaryRead:()=>deny?{status:403,data:{error:'administrator access required'}}:{summary:copy(summary)}});
 await detailButton(h,0).listeners.click();assert.ok(h.root.querySelector('.f-admin-detail'));
 deny=true;await h.tickTimers();
 assert.ok(key(h.root,'organisersOnly'));assert.equal(h.root.querySelectorAll('.f-participant').length,0);assert.equal(h.root.querySelector('.f-admin-detail'),null);assert.doesNotMatch(content(h.root),/Ana|5678/);
 assert.equal(h.timers[0].cleared,true,'the refresh schedule is cleared');
 const before=h.requests.length;h.lang('es');await h.tickTimers();assert.equal(h.requests.length,before);assert.ok(key(h.root,'organisersOnly'));
});

test('an expired session keeps every draft, shows a sign-in link in a new tab and pauses timed refreshes until a request works again',async()=>{
 let reads=0,signedOut=false;
 const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>{reads++;return signedOut?{status:401,data:{error:'sign in required'}}:{summary:copy(summary)};}});
 const draft=editorForm(h);field(draft,'title').value='Unsaved announcement';const notice=h.root.querySelector('.f-session-notice');assert.equal(notice.hidden,true);
 signedOut=true;await h.tickTimers();assert.equal(notice.hidden,false);assert.equal(reads,2);
 const signin=key(notice,'adminSignIn');assert.equal(signin.href,'/login.html?next=%2Ffiiu-admin.html');assert.equal(signin.target,'_blank');
 assert.equal(editorForm(h),draft);assert.equal(field(draft,'title').value,'Unsaved announcement');assert.deepEqual(h.assigned,[]);
 await h.tickTimers();assert.equal(reads,2,'timed refreshes pause while signed out');
 signedOut=false;await key(h.root.querySelector('.f-admin-summary'),'refreshSummary').listeners.click();assert.equal(notice.hidden,true,'a request that works again clears the notice');
 await h.tickTimers();assert.equal(reads,4,'and timed refreshes resume');
});

test('identical totals still let a block’s check-in close on the next refresh',async()=>{
 let now=Date.parse('2026-10-21T13:20:00-05:00');const Clock=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>({summary:copy(checkinSummary)}),context:{Date:Clock}});
 const row=()=>h.root.querySelector('.f-admin-checkin').querySelectorAll('tr').find(node=>/El poder de lo local/.test(content(node)));
 assert.ok(key(row(),'checkinOpenUntil'),'13:20 is before the 13:30 close');const table=h.root.querySelector('.f-summary-body').querySelector('table');
 now=Date.parse('2026-10-21T13:31:00-05:00');await h.tickTimers();
 assert.ok(key(row(),'checkinClosedAt'));assert.equal(row().querySelector('.f-window').className,'f-window is-closed');
 assert.equal(h.root.querySelector('.f-summary-body').querySelector('table'),table,'the overview tables were not rebuilt');
});

test('the check-in section marks only closed blocks, so the blocks still to come stay plain, in every language',async()=>{
 // 22 October, 10:00 in Lima: the laboratory and both 21 October blocks have closed; the 22 October morning is under way and the rest are ahead.
 const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>({summary:copy(checkinSummary)}),context:{Date:frozen('2026-10-22T10:00:00-05:00')}});
 const section=h.root.querySelector('.f-admin-checkin'),windows=section.querySelectorAll('.f-window');
 assert.deepEqual(windows.map(node=>node.className),['f-window is-closed','f-window is-closed','f-window is-closed','f-window is-open','f-window is-open','f-window is-open']);
 assert.deepEqual(windows.map(node=>node.children[0].dataset.fiiuText),['checkinClosedAllDay','checkinClosedAt','checkinClosedAt','checkinOpenUntil','checkinOpenUntil','checkinOpenUntil']);
 for(const lang of ['en','es','pt']){
  h.lang(lang);const [lab,morning,,today]=h.root.querySelector('.f-admin-checkin').querySelectorAll('.f-window');
  assert.match(content(morning),{en:/Check-in closed at\s+13:30\s+Lima time/,es:/El registro cerró a las\s+13:30\s+hora de Lima/,pt:/O registro fechou às\s+13:30\s+horário de Lima/}[lang]);
  assert.match(content(today),{en:/Check-in open until\s+13:30\s+Lima time/,es:/Registro abierto hasta las\s+13:30\s+hora de Lima/,pt:/Registro aberto até\s+13:30\s+horário de Lima/}[lang]);
  assert.match(content(lab),{en:/Check-in closed at the end of the day, Lima time/,es:/El registro cerró al final del día, hora de Lima/,pt:/O registro fechou no fim do dia, horário de Lima/}[lang]);
  assert.doesNotMatch(content(h.root.querySelector('.f-admin-checkin')),/rehears|organi[sz]er test|not opened yet|08:30/i,lang);
 }
 // Before the festival every block is open and none is marked.
 const early=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>({summary:copy(checkinSummary)}),context:{Date:frozen('2026-10-07T10:00:00-05:00')}});
 assert.ok(early.root.querySelector('.f-admin-checkin').querySelectorAll('.f-window').every(node=>node.className==='f-window is-open'));
});

test('participant detail says in one plain line what happened to the summary email, with the Lima time once sent',async()=>{
 const line=async record=>{
  const h=await harness(({path})=>path==='/api/admin/fiiu/content'?{content:[],nextCursor:null}:{registration:copy(record),attendance:[]},{participants:[record]});
  await detailButton(h,0).listeners.click();return h.root.querySelector('.f-admin-detail').querySelector('.f-email-status');
 };
 const ana=participant('participant-a','Ana');
 const sent=await line({...ana,confirmationStatus:'sent',confirmationSentAt:'2026-10-02T19:32:00.000Z'});
 assert.ok(key(sent,'emailStatus')&&key(sent,'emailStatusSent'));assert.match(content(sent),/Summary email:\s+sent\s+·\s+\S.*\s14:32/);
 for(const [status,expected] of [['failed','emailStatusFailed'],['uncertain','emailStatusUncertain'],['pending','emailStatusUncertain'],['skipped','emailStatusSkipped'],['none','emailStatusNone'],[undefined,'emailStatusNone']]){
  const node=await line({...ana,confirmationStatus:status});assert.ok(key(node,expected),String(status));assert.doesNotMatch(content(node),/·/,'no time unless sent');
 }
});

// Summary emails: the block under "Registration and links" that sends the summary to earlier registrations, batch by batch.
const backfillBlock=h=>h.root.querySelector('.f-backfill');
const backfillLine=h=>h.root.querySelector('.f-backfill-line').textContent;
const backfillNote=h=>h.root.querySelector('.f-backfill-note').textContent;
const backfillButtons=h=>backfillBlock(h).querySelectorAll('button');
const backfillAction=(h,name)=>backfillButtons(h).find(b=>b.dataset.action===name);
const press=async(h,name)=>{const b=backfillAction(h,name);assert.ok(b,`no ${name} button`);b.listeners.click();await flush();};
const posts=h=>h.requests.filter(r=>r.path==='/api/admin/fiiu/confirmations'&&r.method==='POST');
const batch=(over={})=>({sent:0,failed:0,uncertain:0,skipped:0,claimedElsewhere:0,remaining:0,next:null,dailyCap:150,sentToday:0,resetsAt:'2026-10-03T00:00:00.000Z',counts:emailCounts(),...over});
// A response the test releases by hand, to look at the page while a batch is in flight.
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

test('the summary email block says who is waiting, offers one press-plate button and a retry for failures',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{confirmationsRead:()=>emailState({counts:emailCounts({none:46,sent:31,failed:2})})});
 const block=backfillBlock(h);assert.ok(h.root.querySelector('.f-admin-settings').children.includes(block),'inside Registration and links');
 assert.ok(key(block,'backfillTitle'));assert.equal(key(block,'backfillHint').hidden,false);
 assert.equal(backfillLine(h),'46 registrations have not received the summary email · 31 sent · 2 failed');assert.equal(backfillNote(h),'');
 assert.deepEqual(backfillButtons(h).map(b=>[b.dataset.action,b.textContent,b.className]),[['send','Send the summary to 46 people','f-button'],['retry','Retry failed (2)','f-backfill-link']],'one press-plate button');
 // The numbers follow the language switch.
 h.lang('es');assert.equal(backfillLine(h),'46 inscripciones no han recibido el correo de resumen · 31 enviados · 2 con error');assert.equal(backfillAction(h,'send').textContent,'Enviar el resumen a 46 personas');
 h.lang('pt');assert.equal(backfillAction(h,'retry').textContent,'Tentar de novo os com erro (2)');assert.doesNotMatch(content(block),/\{n\}/);
});

test('the summary email block: singular forms, nobody waiting, email off, the daily cap and a failed read',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{confirmationsRead:()=>emailState({counts:emailCounts({none:1,sent:1,uncertain:1,skipped:1})})});
 assert.equal(backfillLine(h),'1 registration has not received the summary email · 1 sent · 1 may not have arrived · 1 test address skipped');
 assert.equal(backfillAction(h,'send').textContent,'Send the summary to 1 person');assert.equal(backfillAction(h,'retry'),undefined);
 const reload=next=>harness(()=>({content:[],nextCursor:null}),{confirmationsRead:()=>next});
 let r=await reload(emailState({counts:emailCounts({sent:77,pending:1,uncertain:1,skipped:3})}));
 assert.equal(backfillLine(r),'No registration is waiting for the summary email · 77 sent · 2 may not have arrived · 3 test addresses skipped');assert.equal(backfillButtons(r).length,0);
 r=await reload(emailState({configured:false,counts:emailCounts({none:46})}));
 assert.match(backfillLine(r),/^Summary emails are off\. To turn them on, set EMAIL_SMTP_URL and EMAIL_FROM/);assert.equal(backfillButtons(r).length,0,'no button while email is off');assert.equal(key(backfillBlock(r),'backfillHint').hidden,true,'one line');
 r=await reload(emailState({counts:emailCounts({none:5,sent:150}),sentToday:150}));
 assert.equal(backfillButtons(r).length,0);assert.equal(backfillNote(r),'Today’s limit of 150 summary emails is reached (sign-up emails included). Sending can continue after 19:00 Lima time.');
 let fail=true;r=await harness(()=>({content:[],nextCursor:null}),{confirmationsRead:()=>fail?{status:503,data:{error:'unavailable'}}:emailState({counts:emailCounts({none:2})})});
 assert.equal(backfillLine(r),'The summary email status could not be loaded.');assert.equal(content(r.message).trim(),'','the rest of the page is unaffected');
 fail=false;await press(r,'reload');assert.equal(backfillLine(r),'2 registrations have not received the summary email · 0 sent');assert.ok(backfillAction(r,'send'));
 // Anything malformed reads as a failed read, never as numbers.
 r=await harness(()=>({content:[],nextCursor:null}),{confirmationsRead:()=>({configured:true,counts:{none:'46'}})});assert.equal(backfillLine(r),'The summary email status could not be loaded.');
});

test('sending asks for an in-page confirmation, then sends batch after batch with live progress and a plain summary',async()=>{
 let state=emailState({counts:emailCounts({none:6})});const second=deferred();
 const h=await harness(request=>{
  if(request.path!=='/api/admin/fiiu/confirmations')return{content:[],nextCursor:null};
  if(posts(h).length===1)return batch({sent:4,remaining:2,next:'id-4',sentToday:4,counts:emailCounts({none:2,sent:4})});
  return second.promise;
 },{confirmationsRead:()=>state});
 const window=h.ctx.window;let asked=0;window.confirm=()=>{asked++;return true;};
 await press(h,'send');
 assert.equal(posts(h).length,0,'the first click only asks');assert.equal(asked,0,'no browser dialog');
 assert.equal(backfillNote(h),'The summary goes out now, a few emails at a time. You can stop at any time.');
 const confirm=backfillAction(h,'confirm');assert.equal(confirm.textContent,'Confirm: send 6 emails');assert.equal(confirm.className,'f-button');assert.equal(confirm.focused,true);assert.ok(backfillAction(h,'cancel'));assert.equal(backfillAction(h,'send'),undefined);
 const summaries=h.requests.filter(r=>r.path==='/api/admin/fiiu/summary').length;
 confirm.listeners.click();confirm.listeners.click();await flush();
 assert.equal(backfillNote(h),'Sent 4 of 6…');assert.equal(backfillAction(h,'stop').focused,true);assert.equal(backfillAction(h,'send'),undefined);
 assert.equal(backfillLine(h),'2 registrations have not received the summary email · 4 sent','the counts follow each batch');
 assert.deepEqual(posts(h).map(r=>r.body),[{retryFailed:false},{retryFailed:false,after:'id-4'}],'one pass despite the double click, the second batch after the first one’s cursor');
 state=emailState({counts:emailCounts({sent:5,failed:1}),sentToday:5});
 second.resolve(batch({sent:1,failed:1,remaining:0,next:null,sentToday:5,counts:emailCounts({sent:5,failed:1})}));await flush();
 assert.equal(posts(h).length,2);assert.equal(backfillNote(h),'Sent 5 · Failed 1 — you can retry the failed ones');
 assert.equal(backfillLine(h),'No registration is waiting for the summary email · 5 sent · 1 failed');
 assert.deepEqual(backfillButtons(h).map(b=>b.dataset.action),['retry']);
 assert.ok(h.requests.filter(r=>r.path==='/api/admin/fiiu/summary').length>summaries,'the overview is refreshed');
});

test('a second press meant for Send or Confirm never lands on the button that replaced it',async()=>{
 let now=Date.parse('2026-10-02T15:00:00.000Z');const Clock=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const inFlight=deferred();
 const h=await harness(request=>request.path==='/api/admin/fiiu/confirmations'?inFlight.promise:{content:[],nextCursor:null},{confirmationsRead:()=>emailState({counts:emailCounts({none:6})}),context:{Date:Clock}});
 // A person's press: a click event with its click count (0 from the keyboard).
 const click=async(name,detail=1)=>{backfillAction(h,name).listeners.click({detail});await flush();};
 now+=5000;await click('send');assert.ok(backfillAction(h,'confirm'),'the first press asks for confirmation');
 await click('confirm',0);now+=100;await click('confirm',0);assert.equal(posts(h).length,0,'Enter pressed again straight away does not confirm');
 const held=key=>{let prevented=false;backfillAction(h,'confirm').listeners.keydown({key,repeat:true,preventDefault(){prevented=true;}});return prevented;};
 assert.equal(held('Enter'),true,'a held Enter does not repeat onto Confirm');assert.equal(held(' '),true);assert.equal(held('Tab'),false,'a held Tab still moves on');
 now+=1000;await click('confirm');assert.equal(posts(h).length,1,'a deliberate press confirms');assert.ok(backfillAction(h,'stop'));
 await click('stop',0);assert.notEqual(backfillNote(h),'Sent 0 of 6 — stopping after this batch…','a second Confirm press does not stop the pass');
 now+=1000;await click('stop');assert.equal(backfillNote(h),'Sent 0 of 6 — stopping after this batch…');
 inFlight.resolve(batch({sent:4,remaining:2,next:'id-4',sentToday:4,counts:emailCounts({none:2,sent:4})}));await flush();
});

test('a dashboard left open at the daily cap offers the buttons again once the cap resets at 19:00 Lima',async()=>{
 let now=Date.parse('2026-10-02T23:30:00.000Z');const Clock=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 let state=emailState({counts:emailCounts({none:5,sent:150}),sentToday:150,resetsAt:'2026-10-03T00:00:00.000Z'});
 const h=await harness(()=>({content:[],nextCursor:null}),{confirmationsRead:()=>state,context:{Date:Clock}});
 const reads=()=>h.requests.filter(r=>r.path==='/api/admin/fiiu/confirmations'&&r.method==='GET').length,before=reads();
 assert.equal(backfillButtons(h).length,0);await h.tickTimers();assert.equal(reads(),before,'nothing to ask before the reset');
 now=Date.parse('2026-10-03T00:00:30.000Z');state=emailState({counts:emailCounts({none:5,sent:150}),resetsAt:'2026-10-04T00:00:00.000Z'});
 await h.tickTimers();await flush();assert.equal(reads(),before+1);assert.equal(backfillAction(h,'send').textContent,'Send the summary to 5 people');assert.equal(backfillNote(h),'');
 await h.tickTimers();assert.equal(reads(),before+1,'asked once, not every minute');
});

test('a pass that ended at the cap leaves no stale cap message once the buttons come back',async()=>{
 let now=Date.parse('2026-10-02T23:30:00.000Z');const Clock=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 let state=emailState({counts:emailCounts({none:8})});
 const h=await harness(request=>request.path==='/api/admin/fiiu/confirmations'?(state=emailState({counts:emailCounts({none:4,sent:150}),sentToday:150}),{status:429,data:{error:'daily summary email limit reached',code:'daily_cap'}}):{content:[],nextCursor:null},{confirmationsRead:()=>state,context:{Date:Clock}});
 await press(h,'send');await press(h,'confirm');assert.match(backfillNote(h),/limit of 150/);
 now=Date.parse('2026-10-03T00:01:00.000Z');state=emailState({counts:emailCounts({none:4,sent:150}),resetsAt:'2026-10-04T00:00:00.000Z'});
 await h.tickTimers();await flush();assert.equal(backfillNote(h),'');assert.equal(backfillAction(h,'send').textContent,'Send the summary to 4 people');
});

test('Stop finishes the batch in flight and sends no more; Cancel sends nothing',async()=>{
 let state=emailState({counts:emailCounts({none:10})});const first=deferred();
 const h=await harness(request=>request.path==='/api/admin/fiiu/confirmations'?first.promise:{content:[],nextCursor:null},{confirmationsRead:()=>state});
 await press(h,'send');await press(h,'cancel');
 assert.equal(posts(h).length,0);assert.equal(backfillAction(h,'send').focused,true);assert.equal(backfillNote(h),'');
 await press(h,'send');await press(h,'confirm');assert.equal(backfillNote(h),'Sent 0 of 10…');
 await press(h,'stop');assert.equal(backfillNote(h),'Sent 0 of 10 — stopping after this batch…');
 state=emailState({counts:emailCounts({none:6,sent:4}),sentToday:4});
 first.resolve(batch({sent:4,remaining:6,next:'id-4',sentToday:4,counts:emailCounts({none:6,sent:4})}));await flush();
 assert.equal(posts(h).length,1,'nothing after Stop');assert.equal(backfillNote(h),'Stopped. Sent 4 · Failed 0');
 assert.equal(backfillAction(h,'send').textContent,'Send the summary to 6 people','the rest can be sent later');
});

test('Retry failed sends only the failed ones, after its own confirmation',async()=>{
 let state=emailState({counts:emailCounts({sent:9,failed:2})});
 const h=await harness(request=>{if(request.path!=='/api/admin/fiiu/confirmations')return{content:[],nextCursor:null};state=emailState({counts:emailCounts({sent:11})});return batch({sent:2,remaining:0,next:'id-2',sentToday:11,counts:emailCounts({sent:11})});},{confirmationsRead:()=>state});
 assert.deepEqual(backfillButtons(h).map(b=>b.dataset.action),['retry']);
 await press(h,'retry');assert.equal(backfillAction(h,'confirm').textContent,'Confirm: send 2 emails');
 await press(h,'confirm');
 assert.deepEqual(posts(h).map(r=>r.body),[{retryFailed:true}]);assert.equal(backfillNote(h),'Sent 2 · Failed 0');assert.equal(backfillButtons(h).length,0);
});

test('the summary run reports the daily cap, email turned off, a lost session, a failed request and a lost organiser role',async()=>{
 // The first batch goes through; answer(state) gives the second. state.signedOut makes every later read a 401 too, as after a real sign-out.
 const signedOut={status:401,data:{error:'sign in required'}};
 const run=async answer=>{
  let calls=0;const state={value:emailState({counts:emailCounts({none:8})}),signedOut:false};
  const h=await harness(request=>{if(request.path!=='/api/admin/fiiu/confirmations')return{content:[],nextCursor:null};calls++;return calls===1?batch({sent:4,remaining:4,next:'id-4',sentToday:4,counts:emailCounts({none:4,sent:4})}):answer(state);},
   {confirmationsRead:()=>state.signedOut?signedOut:state.value,summaryRead:()=>state.signedOut?signedOut:{summary:copy(summary)}});
  await press(h,'send');await press(h,'confirm');return h;
 };
 let h=await run(state=>{state.value=emailState({counts:emailCounts({none:4,sent:150}),sentToday:150});return {status:429,data:{error:'daily summary email limit reached',code:'daily_cap'}};});
 assert.equal(backfillNote(h),'Sent 4 · Failed 0. Today’s limit of 150 summary emails is reached (sign-up emails included). Sending can continue after 19:00 Lima time.');
 assert.equal(backfillAction(h,'send'),undefined,'no button until tomorrow');assert.equal(posts(h).length,2);
 h=await run(state=>{state.value=emailState({configured:false,counts:emailCounts({none:4,sent:4})});return {status:503,data:{error:'email is not configured',code:'email_not_configured'}};});
 assert.match(backfillLine(h),/^Summary emails are off/);assert.equal(backfillButtons(h).length,0);assert.equal(backfillNote(h),'');
 h=await run(state=>{state.signedOut=true;return signedOut;});
 assert.equal(backfillNote(h),'Sent 4 · Failed 0. Sign in again, then press the button to continue.');assert.equal(h.root.querySelector('.f-session-notice').hidden,false,'the page’s sign-in notice');
 h=await run(()=>({status:500,data:{error:'internal error'}}));
 assert.equal(backfillNote(h),'Sent 4 · Failed 0. The sending stopped because a request failed. Nobody is emailed twice: press the button again to continue.');assert.ok(backfillAction(h,'send'),'press again to continue');
 h=await run(()=>({status:200,data:{sent:'4'}}));assert.match(backfillNote(h),/The sending stopped because a request failed/,'a malformed answer stops the pass');
 h=await run(()=>({status:403,data:{error:'administrator access required'}}));
 assert.ok(key(h.root,'organisersOnly'),'the page locks');assert.equal(h.root.querySelector('.f-backfill'),null);
 const before=h.requests.length;h.lang('es');await h.tickTimers();assert.equal(h.requests.length,before);
});

test('a busy write budget pauses the summary run half a minute and carries on; Stop ends the pause',async()=>{
 let calls=0,state=emailState({counts:emailCounts({none:5})});
 const h=await harness(request=>{
  if(request.path!=='/api/admin/fiiu/confirmations')return{content:[],nextCursor:null};
  calls++;if(calls===1)return {status:429,data:{error:'too many requests'}};
  state=emailState({counts:emailCounts({sent:5}),sentToday:5});return batch({sent:5,remaining:0,next:null,sentToday:5,counts:emailCounts({sent:5})});
 },{confirmationsRead:()=>state});
 const timers=fakeTimers(h);
 await press(h,'send');await press(h,'confirm');
 assert.equal(backfillNote(h),'Sent 0 of 5 — pausing half a minute for the request limit…');assert.deepEqual(timers.delays(),[30000],'the wait the note announces');
 h.lang('es');assert.equal(backfillNote(h),'Enviados 0 de 5 — pausa de medio minuto por el límite de solicitudes…');
 h.lang('pt');assert.equal(backfillNote(h),'Enviados 0 de 5 — pausa de meio minuto pelo limite de solicitações…');h.lang('en');
 timers.run();await flush();
 assert.equal(posts(h).length,2);assert.equal(backfillNote(h),'Sent 5 · Failed 0');
 // Stop during a pause ends the run at once.
 const again=await harness(request=>request.path==='/api/admin/fiiu/confirmations'?{status:429,data:{error:'too many requests'}}:{content:[],nextCursor:null},{confirmationsRead:()=>emailState({counts:emailCounts({none:3})})});
 fakeTimers(again);await press(again,'send');await press(again,'confirm');await press(again,'stop');
 assert.equal(posts(again).length,1);assert.equal(backfillNote(again),'Stopped. Sent 0 · Failed 0');
});

test('Stop pressed while a request is out, which then meets the busy write budget, ends the run at once with no pause',async()=>{
 const first=deferred();
 const h=await harness(request=>request.path==='/api/admin/fiiu/confirmations'?first.promise:{content:[],nextCursor:null},{confirmationsRead:()=>emailState({counts:emailCounts({none:9})})});
 const timers=fakeTimers(h);
 await press(h,'send');await press(h,'confirm');await press(h,'stop');
 assert.equal(backfillNote(h),'Sent 0 of 9 — stopping after this batch…');
 first.resolve({status:429,data:{error:'too many requests'}});await flush();
 assert.deepEqual(timers.delays(),[],'no half-minute pause after Stop');assert.equal(posts(h).length,1);
 assert.equal(backfillNote(h),'Stopped. Sent 0 · Failed 0');assert.equal(backfillAction(h,'stop'),undefined);
 assert.equal(backfillAction(h,'send').textContent,'Send the summary to 9 people','the button is back straight away');
});
