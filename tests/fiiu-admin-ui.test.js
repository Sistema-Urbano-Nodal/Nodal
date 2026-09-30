import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {DEFAULT_CONFIG,FIIU_EVENT} from '../server/fiiu-domain.js';
import {createFiiuHarness,key,field,flush,content} from './helpers/fiiu-ui-harness.js';

const participant=(id,firstName)=>({id,eventId:'fiiu-2026',userId:'user-'+id,email:firstName.toLowerCase()+'@example.test',version:1,labStatus:'pending',createdAt:'2026-09-29T12:00:00.000Z',updatedAt:'2026-09-29T12:00:00.000Z',answers:{firstName,lastName:'Test',country:'Perú',city:'Lima',profile:'public_official',publicOfficial:true,applyLab:true,institution:'City Council',position:'Planner',activities:['day1-am'],privacyAccepted:true}});
const copy=value=>structuredClone(value);
const summary={totalRegistrations:237,publicOfficials:64,lab:{pending:18,accepted:12,declined:2},activities:[{activityId:'day1-am',registrations:121,externalInterests:0,attendance:0}],days:[{date:'2026-10-21',registrations:157,attendance:0}],profiles:[{profile:'student',count:48}]};
async function harness(respond,{participants=[],summaryRead=()=>({summary:copy(summary)}),configRead=()=>({config:{...DEFAULT_CONFIG,version:0}})}={}){
 return createFiiuHarness(request=>{
  if(request.path==='/api/fiiu')return{event:FIIU_EVENT,config:DEFAULT_CONFIG,content:[],nextCursor:null};
  if(request.path==='/api/admin/fiiu/config'&&request.method==='GET')return configRead(request);
  if(request.path==='/api/admin/fiiu/registrations')return{registrations:copy(participants),nextCursor:null};
  if(request.path==='/api/admin/fiiu/summary')return summaryRead(request);
  return respond(request);
 },{page:'fiiu-admin'});
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
