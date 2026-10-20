import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {DEFAULT_CONFIG,FIIU_EVENT} from '../server/fiiu-domain.js';
import {createFiiuHarness,key,field,flush,content,descendants,Node} from './helpers/fiiu-ui-harness.js';

const participant=(id,firstName)=>({id,eventId:'fiiu-2026',userId:'user-'+id,email:firstName.toLowerCase()+'@example.test',version:1,labStatus:'pending',createdAt:'2026-09-29T12:00:00.000Z',updatedAt:'2026-09-29T12:00:00.000Z',answers:{firstName,lastName:'Test',country:'Perú',city:'Lima',profile:'public_official',publicOfficial:true,applyLab:true,institution:'City Council',position:'Planner',activities:['day1-am'],privacyAccepted:true}});
const copy=value=>structuredClone(value);
// The settings as the dashboard sends them back: the party link left the settings (the party registers through NODAL now), so no save carries it.
const SETTINGS=Object.fromEntries(Object.entries(DEFAULT_CONFIG).filter(([name])=>name!=='partyUrl'));
// The closing party, as the server sends it in the programme (a register-only "social" block): until the server's programme has it, the dashboard is fed
// the programme with it in place, after the conference blocks and before the workshops, as lane A adds it.
const PARTY={id:'closing-party',date:'2026-10-25',period:'party',registration:'social',title:'¡Fiesta de cierre y Chelas Urbanas!',time:'17:00',venue:'La Vermut Bar, Av. Francisco Bolognesi 235, Barranco 15063',sessions:[['17:00–19:00','Chelas Urbanas'],['19:00 en adelante','Fiesta de cierre']],description:'',edited:false};
const firstExternal=FIIU_EVENT.activities.findIndex(activity=>activity.registration==='external');
const EVENT=FIIU_EVENT.activities.some(activity=>activity.id===PARTY.id)?FIIU_EVENT:{...FIIU_EVENT,activities:[...FIIU_EVENT.activities.slice(0,firstExternal),PARTY,...FIIU_EVENT.activities.slice(firstExternal)]};
// GET /api/admin/fiiu/programme: each block with its version (0 while unedited), its built-in values and its check-in count.
const programmeItem=(activity,over={})=>({...activity,description:activity.description??'',edited:false,version:0,original:{title:activity.title,date:activity.date,time:activity.time,venue:activity.venue,description:activity.description??'',sessions:activity.sessions,...(activity.registration==='external'?{formUrl:activity.formUrl}:{})},checkedIn:0,...over});
const programmeItems=(over={})=>EVENT.activities.map(activity=>programmeItem(activity,over[activity.id]));
const summary={totalRegistrations:237,publicOfficials:64,lab:{pending:18,accepted:12,declined:2},activities:[{activityId:'day1-am',registrations:121,externalInterests:0,attendance:0}],days:[{date:'2026-10-21',registrations:157,attendance:0}],profiles:[{profile:'student',count:48}]};
// The summary-email block's state (GET /api/admin/fiiu/confirmations); by default nobody is waiting.
const emailCounts=(over={})=>({none:0,pending:0,sent:0,failed:0,uncertain:0,skipped:0,...over});
const emailState=(over={})=>({configured:true,counts:emailCounts(),dailyCap:150,sentToday:0,resetsAt:'2026-10-03T00:00:00.000Z',...over});
// The party announcement's state (GET /api/admin/fiiu/notices/closing-party): waiting counts the registrants without the party and without a notice.
const noticeCounts=(over={})=>({waiting:0,pending:0,sent:0,failed:0,uncertain:0,skipped:0,...over});
const noticeState=(over={})=>({configured:true,counts:noticeCounts(),dailyCap:150,sentToday:0,resetsAt:'2026-10-03T00:00:00.000Z',...over});
// The conversation questions (GET /api/admin/fiiu/questions); by default there are none.
async function harness(respond,{participants=[],nextCursor=null,summaryRead=()=>({summary:copy(summary)}),configRead=()=>({config:{...DEFAULT_CONFIG,version:0}}),confirmationsRead=()=>emailState(),questionsRead=()=>({questions:[]}),programmeRead=()=>({activities:programmeItems()}),noticesRead=()=>noticeState(),context={}}={}){
 return createFiiuHarness(request=>{
  // The dashboard reads the programme and its first settings, version included, from its own per-account read, never the public /api/fiiu.
  if(request.path==='/api/fiiu')throw Error('the dashboard must not depend on the public, CDN-cached programme read');
  if(request.path==='/api/admin/fiiu/config'&&request.method==='GET')return{event:EVENT,...configRead(request)};
  if(request.path==='/api/admin/fiiu/confirmations'&&request.method==='GET')return confirmationsRead(request);
  if(request.path==='/api/admin/fiiu/questions'&&request.method==='GET')return questionsRead(request);
  if(request.path==='/api/admin/fiiu/programme'&&request.method==='GET')return programmeRead(request);
  if(request.path==='/api/admin/fiiu/notices/closing-party'&&request.method==='GET')return noticesRead(request);
  if(request.path==='/api/admin/fiiu/registrations')return{registrations:copy(participants),nextCursor};
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
const type=(input,value)=>{input.value=value;input.listeners.input?.();};

test('editing historical publications preserves only their existing legacy activity and sends it when saving',async()=>{
 for(const legacy of EVENT.legacyActivities){
  const post={id:'legacy-post',version:1,title:'Existing workshop material',body:'',url:'https://example.test/material',kind:'material',status:'published',activityId:legacy.id};
  const h=await harness(({method,body})=>method==='GET'?{content:[copy(post)],nextCursor:null}:{content:{...post,...body,version:post.version+1}});
  await key(h.root.querySelector('.f-news-item'),'editContent').listeners.click();
  const form=h.root.querySelector('.f-content-editor').querySelector('form'),select=field(form,'activityId');
  // The lightweight DOM permits values without matching options; check both.
  assert.deepEqual(select.children.filter(option=>EVENT.legacyActivities.some(activity=>activity.id===option.value)).map(option=>option.value),[legacy.id]);
  assert.equal(select.value,legacy.id);
  field(form,'title').value='Corrected historical material';await submit(form);
  const writes=h.requests.filter(request=>request.method!=='GET');assert.equal(writes.length,1);
  assert.equal(writes[0].method,'PATCH');assert.equal(writes[0].path,'/api/admin/fiiu/content/'+post.id);
  assert.equal(writes[0].body.activityId,legacy.id);assert.equal(writes[0].body.title,'Corrected historical material');assert.equal(writes[0].body.version,1);
 }
});

test('new publication activity choices exclude all historical activities',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null})),select=field(h.root.querySelector('.f-content-editor'),'activityId');
 assert.equal(select.value,'');assert.deepEqual(select.children.map(option=>option.value),['',...EVENT.activities.map(activity=>activity.id)]);
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

test('organizer participant loading does not wait for a slow programme and settings response',async()=>{
 let finishProgramme;
 const h=await createFiiuHarness(({path})=>{
  if(path==='/api/admin/fiiu/config')return new Promise(resolve=>{finishProgramme=()=>resolve({event:EVENT,config:DEFAULT_CONFIG});});
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(path==='/api/admin/fiiu/registrations')return{registrations:[],nextCursor:null};
  if(path==='/api/admin/fiiu/summary')return{summary:copy(summary)};
  throw Error('Unexpected request');
 },{page:'fiiu-admin'});
 assert.ok(h.requests.some(request=>request.path==='/api/admin/fiiu/registrations'),'the independent participant read should already be in flight');
 finishProgramme();await flush();assert.ok(key(h.root,'noParticipants'));
 assert.equal(h.requests.filter(request=>request.path==='/api/admin/fiiu/registrations').length,1);
});

test('saving the links stays locked while saving, sends the saved availability with them, and the next save uses the saved version',async()=>{
 let finishSave;
 const h=await harness(({method,body})=>method==='GET'?{content:[],nextCursor:null}:new Promise(resolve=>{finishSave=()=>resolve({config:{...body,version:body.version+1}});}));
 const form=h.root.querySelector('.f-admin-settings').querySelector('form'),open=field(form,'registrationOpen'),programme=field(form,'programUrl');
 programme.value='https://example.test/programme';
 form.listeners.submit({preventDefault(){}});form.listeners.submit({preventDefault(){}});
 const writes=h.requests.filter(request=>request.method==='PUT');
 assert.equal(writes.length,1,'a pending settings save must ignore repeat submission');
 assert.equal(writes[0].body.registrationOpen,true,'the saved availability goes with the links');assert.equal(writes[0].body.programUrl,'https://example.test/programme');
 assert.ok(form.querySelectorAll('input,select,textarea,button').every(control=>control.disabled),'availability and links must not appear editable while their earlier values are being saved');
 assert.equal(form['aria-busy'],'true');
 finishSave();await flush();
 assert.equal(open.checked,true);assert.equal(open.disabled,false);assert.equal(programme.disabled,false);
 assert.equal(form['aria-busy'],'false');assert.equal(h.message.dataset.fiiuText,'changesSaved');
 programme.value='https://example.test/programme-2';form.listeners.submit({preventDefault(){}});
 const next=h.requests.filter(request=>request.method==='PUT')[1];
 assert.equal(next.body.programUrl,'https://example.test/programme-2');assert.equal(next.body.version,1,'the next edit must use the saved configuration version');
 finishSave();await flush();
});

test('a failed settings save keeps the draft and restores each previous disabled state',async()=>{
 let finishSave;
 const h=await harness(({method})=>method==='GET'?{content:[],nextCursor:null}:new Promise(resolve=>{finishSave=resolve;}));
 // A control that was disabled before the save (here one added for the test) stays disabled after it.
 const form=h.root.querySelector('.f-admin-settings').querySelector('form'),open=field(form,'registrationOpen'),programme=field(form,'programUrl'),party=Object.assign(new Node('input'),{name:'extra',disabled:true});form.append(party);
 programme.value='https://example.test/corrected-programme';
 form.listeners.submit({preventDefault(){}});
 assert.equal(programme.disabled,true);assert.equal(open.disabled,true);
 finishSave(unavailable);await flush();
 assert.equal(open.checked,true);assert.equal(programme.value,'https://example.test/corrected-programme');
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

test('opening details on a stacked or short screen brings the detail’s top under the section nav; beside the list the page stays put',async()=>{
 const ana=participant('participant-a','Ana');
 const h=await harness(({path})=>path==='/api/admin/fiiu/content'?{content:[],nextCursor:null}:{registration:copy(ana),attendance:[]},{participants:[ana]});
 const detail=h.root.querySelector('.f-admin-detail'),scrolls=[],focuses=[],queries=[];let beside=false;
 detail.scrollIntoView=options=>scrolls.push(options);detail.focus=options=>focuses.push(options);h.ctx.window.matchMedia=query=>{queries.push(query);return{matches:beside};};
 await detailButton(h,0).listeners.click();
 assert.equal(scrolls.length,1);assert.equal(scrolls[0].block,'start');assert.equal(focuses.length,1);assert.equal(focuses[0].preventScroll,true,'the focus itself never scrolls');
 assert.deepEqual(queries,['(min-width: 1000px) and (min-height: 641px)'],'the same condition that makes the detail sticky');
 beside=true;await detailButton(h,0).listeners.click();
 assert.equal(scrolls.length,1,'beside the list nothing scrolls');assert.equal(focuses.length,2);assert.equal(focuses[1].preventScroll,true);
});

test('while another person’s details load, the detail on screen is dimmed and inert; a failed switch makes it live again',async()=>{
 const ana=participant('participant-a','Ana'),bruno=participant('participant-b','Bruno');let hold=null,anaReads=0;
 const h=await harness(({path,method,body})=>{
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(method==='PATCH'){Object.assign(ana,{labStatus:body.labStatus,version:ana.version+1});return{registration:copy(ana)};}
  if(path.endsWith('participant-b'))return hold.promise;
  anaReads++;return{registration:copy(ana),attendance:[]};
 },{participants:[ana,bruno]});
 const detail=h.root.querySelector('.f-admin-detail');
 await detailButton(h,0).listeners.click();assert.equal(detailTitle(h),'Ana Test');assert.notEqual(detail.inert,true);
 hold=deferred();const opening=detailButton(h,1).listeners.click();
 assert.equal(detail.inert,true);assert.equal(detail['aria-busy'],'true');assert.equal(detailTitle(h),'Ana Test','Ana stays on screen, out of reach, until Bruno arrives');
 hold.resolve({registration:copy(bruno),attendance:[]});await opening;
 assert.equal(detail.inert,false);assert.equal(detail['aria-busy'],'false');assert.equal(detailTitle(h),'Bruno Test');
 await detailButton(h,0).listeners.click();hold=deferred();const failing=detailButton(h,1).listeners.click();assert.equal(detail.inert,true);
 hold.resolve(unavailable);await failing;
 assert.equal(detail.inert,false);assert.equal(detail['aria-busy'],'false');assert.equal(detailTitle(h),'Ana Test');assert.equal(h.message.dataset.fiiuText,'error');
 const reads=anaReads,form=h.root.querySelector('.f-review-card').querySelector('form');field(form,'review').value='reviewAccepted';await submit(form);
 assert.equal(anaReads,reads+1,'a review saved on Ana after the failed switch still refreshes her detail');assert.ok(key(h.root.querySelector('.f-review-card'),'acceptedShort'));
});

test('an error toast clears after 12 seconds or on a tap, an expired session’s carries a sign-in link, and a tap never hides Saving…',async()=>{
 const ana=participant('participant-a','Ana');let reply=unavailable;
 const h=await harness(({path})=>path==='/api/admin/fiiu/content'?{content:[],nextCursor:null}:reply,{participants:[ana]}),timers=fakeTimers(h);
 await detailButton(h,0).listeners.click();assert.equal(h.message.dataset.fiiuText,'error');assert.deepEqual(timers.delays(),[12000]);
 timers.run();assert.equal(h.message.dataset.fiiuText,'','the error clears on its own');
 await detailButton(h,0).listeners.click();assert.equal(h.message.dataset.fiiuText,'error');
 h.message.listeners.click({target:h.message});assert.equal(h.message.dataset.fiiuText,'','a tap dismisses it');timers.run();
 reply={status:401,data:{error:'sign in required'}};await detailButton(h,0).listeners.click();
 assert.equal(h.message.dataset.fiiuText,'unauthorized');const signin=key(h.message,'adminSignIn');assert.ok(signin,'the toast carries the sign-in link');
 assert.equal(signin.href,'/login.html?next=%2Ffiiu-admin.html');assert.equal(signin.target,'_blank');assert.equal(signin['aria-describedby'],'f-newtab');
 assert.deepEqual(timers.delays(),[],'it stays until the organiser acts');
 // A browser's retranslation through textContent removes the link; the fake DOM keeps children, so empty it as the browser would.
 h.message.children.length=0;h.lang('es');assert.equal(descendants(h.message).filter(node=>node.dataset.fiiuText==='adminSignIn').length,1,'a language switch puts the sign-in link back');
 h.lang('en');assert.equal(descendants(h.message).filter(node=>node.dataset.fiiuText==='adminSignIn').length,1,'and never adds a second one');
 h.ctx.window.Fiiu.status(h.message,'saving');h.message.listeners.click({target:h.message});assert.equal(h.message.dataset.fiiuText,'saving','a tap never hides Saving…');
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
 const conferenceIds=['day1-am','day2-am'].map(id=>EVENT.activities.find(a=>a.id===id).title.split(/\s+/).slice(0,3).join(' '));
 assert.deepEqual(titles(conferences).filter(title=>conferenceIds.includes(title)),conferenceIds,'Wednesday before Thursday, whatever the server order');
 const interestTitles=['workshop-day1','route-amancaes'].map(id=>[...EVENT.legacyActivities,...EVENT.activities].find(a=>a.id===id).title.split(/\s+/).slice(0,3).join(' '));
 assert.deepEqual(titles(interests),interestTitles,'a legacy workshop with interest joins the workshop table, before the Saturday route');
 assert.equal(conferences.querySelectorAll('tbody')[0].querySelector('.f-group').children[0].scope,'rowgroup');
 assert.match(content(conferences),/121/);assert.match(content(interests),/3/);
});

test('the availability switch saves on its own: closing asks first, a declined close changes nothing, unsaved links stay out of it and the header pill follows',async()=>{
 const h=await harness(({method,body})=>method==='GET'?{content:[],nextCursor:null}:{config:{...body,version:body.version+1}});
 const form=h.root.querySelector('.f-admin-settings').querySelector('form'),open=field(form,'registrationOpen'),note=h.root.querySelector('.f-switch-card').querySelector('.f-inline-status'),puts=()=>h.requests.filter(request=>request.method==='PUT');let asked=0;
 assert.equal(open.role,'switch');assert.equal(note.role,'status');h.ctx.window.confirm=message=>{asked++;assert.equal(message,h.ctx.window.Fiiu.t('closeConfirm'));return false;};
 open.checked=false;await open.listeners.change();assert.equal(asked,1);assert.equal(open.checked,true,'a declined close keeps registration open');assert.equal(puts().length,0);
 field(form,'programUrl').value='https://example.test/programme-unsaved';
 h.ctx.window.confirm=()=>{asked++;return true;};open.checked=false;await open.listeners.change();
 assert.equal(asked,2);assert.equal(puts().length,1);
 assert.deepEqual(puts()[0].body,{...SETTINGS,registrationOpen:false,version:0},'only the availability changes; the typed link waits for its own Save');
 assert.equal(note.dataset.fiiuText,'changesSaved');assert.equal(key(h.root.querySelector('.f-admin-head'),'registrationClosedNow')?.href,'#settings','the header pill says closed at once');
 assert.equal(field(form,'programUrl').value,'https://example.test/programme-unsaved');
 open.checked=true;await open.listeners.change();assert.equal(asked,2,'reopening never asks');
 assert.deepEqual(puts().at(-1).body,{...SETTINGS,registrationOpen:true,version:1});assert.ok(key(h.root.querySelector('.f-admin-head'),'registrationOpenNow'));
 await submit(form);
 assert.deepEqual(puts().at(-1).body,{...SETTINGS,programUrl:'https://example.test/programme-unsaved',registrationOpen:true,version:2},'Save sends the link with the saved availability and version');
});

test('closing registration says plainly that registered people cannot add blocks either, so nobody is checked in to a block outside their registration',async()=>{
 // The server refuses every registration edit while closed, and a check-in (scan or desk) needs the block in the registration.
 const h=await harness(()=>({content:[],nextCursor:null})),t=name=>h.ctx.window.Fiiu.t(name),card=h.root.querySelector('.f-switch-card');
 for(const [lang,words] of [['en',[/new people/i,/add blocks to their registration/,/checked in to a block/,/at the desk/,/saved registrations stay/i]],['es',[/nadie nuevo/i,/añadir bloques a su inscripción/,/registrar (su )?asistencia en un bloque/,/mesa de registro/,/inscripciones guardadas se mantienen/]],['pt',[/novas pessoas/i,/adicionar blocos à sua inscrição/,/registrar (a )?presença em um bloco/,/mesa de credenciamento/,/inscrições salvas continuam/]]]){
  h.lang(lang);for(const name of ['closeConfirm','registrationOpenHint'])for(const word of words)assert.match(t(name),word,lang+' '+name);
  assert.equal(key(card,'registrationOpenHint').textContent,t('registrationOpenHint'),'the hint under the switch follows the language');
 }
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

test('a background page read that fails leaves Load more: filtered views say the list is partial, and a press reads the next page once',async()=>{
 const ana=participant('participant-a','Ana'),bruno={...participant('participant-b','Bruno'),labStatus:'accepted'};let fail=true;
 const h=await createFiiuHarness(({path})=>{
  if(path==='/api/admin/fiiu/config')return{event:EVENT,config:DEFAULT_CONFIG};
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(path==='/api/admin/fiiu/summary')return{summary:copy(summary)};
  if(path==='/api/admin/fiiu/registrations')return{registrations:[copy(ana)],nextCursor:'page-2'};
  if(path==='/api/admin/fiiu/registrations?cursor=page-2'){if(fail){fail=false;return unavailable;}return{registrations:[copy(bruno)],nextCursor:null};}
  throw Error('Unexpected request '+path);
 },{page:'fiiu-admin'});
 const pageReads=()=>h.requests.filter(request=>request.path.startsWith('/api/admin/fiiu/registrations')).length;
 assert.equal(pageReads(),2,'the next page was read in the background');assert.equal(h.message.dataset.fiiuText,'','a failed background read shows no toast');
 assert.equal(key(h.root,'showingLoaded'),undefined,'the unfiltered list needs no partial-results note');assert.ok(key(h.root.querySelector('.f-admin-list'),'loadMore'));
 key(h.root,'filterLabAccepted').listeners.click();assert.ok(key(h.root,'showingLoaded'));assert.ok(key(h.root,'noMatches'));
 await key(h.root.querySelector('.f-admin-list'),'loadMore').listeners.click();
 assert.equal(pageReads(),3,'one press, one read');
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

test('loading the last participant page with Load more moves focus to the first new row, not back to the search box',async()=>{
 const ana=participant('participant-a','Ana'),bruno=participant('participant-b','Bruno');let fail=true;
 const h=await createFiiuHarness(({path})=>{
  if(path==='/api/admin/fiiu/config')return{event:EVENT,config:DEFAULT_CONFIG};
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(path==='/api/admin/fiiu/summary')return{summary:copy(summary)};
  if(path==='/api/admin/fiiu/registrations')return{registrations:[copy(bruno)],nextCursor:'page-2'};
  // The background read fails once, so Load more is offered.
  if(path==='/api/admin/fiiu/registrations?cursor=page-2'){if(fail){fail=false;return unavailable;}return{registrations:[copy(ana)],nextCursor:null};}
  throw Error('Unexpected request '+path);
 },{page:'fiiu-admin'});
 await key(h.root.querySelector('.f-admin-list'),'loadMore').listeners.click();
 assert.equal(detailButton(h,0).focused,true,'Ana, loaded last, sorts first and receives focus');assert.notEqual(field(h.root,'searchParticipants').focused,true);
});

test('the other participant pages load in the background, so search and filters cover everyone without a press',async()=>{
 const ana=participant('participant-a','Ana'),bruno=participant('participant-b','Bruno'),carla={...participant('participant-c','Carla'),labStatus:'accepted'},second=deferred();
 const h=await harness(({path})=>{
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(path==='/api/admin/fiiu/registrations?cursor=page-2')return second.promise;
  if(path==='/api/admin/fiiu/registrations?cursor=page-3')return{registrations:[copy(carla),copy(ana)],nextCursor:null};
  throw Error('Unexpected request '+path);
 },{participants:[ana],nextCursor:'page-2'});
 const list=()=>h.root.querySelector('.f-admin-list'),timers=fakeTimers(h),reads=()=>h.requests.filter(request=>request.path.startsWith('/api/admin/fiiu/registrations')).length;
 assert.equal(reads(),2,'the second page is already being read');assert.equal(key(list(),'loadMore'),undefined,'no Load more while the rest loads');
 key(h.root,'filterLabAccepted').listeners.click();assert.ok(key(list(),'loading'),'a filtered view says more people are on their way');assert.equal(key(list(),'showingLoaded'),undefined);
 key(h.root,'filterAll').listeners.click();const open=detailButton(h,0);h.ctx.document.activeElement=open;
 second.resolve({registrations:[copy(bruno)],nextCursor:'page-3'});await flush();
 assert.equal(reads(),3);assert.deepEqual(participantNames(h),['Ana Test','Bruno Test','Carla Test'],'Ana, read twice, is listed once');
 assert.notEqual(detailButton(h,0),open,'Ana’s row was rebuilt from the later copy');assert.equal(detailButton(h,0).focused,true,'focus follows Ana to it');
 assert.equal(key(list(),'loadMore'),undefined);assert.equal(key(list(),'loading'),undefined);
 type(field(h.root,'searchParticipants'),'carla');timers.run();assert.deepEqual(participantNames(h),['Carla Test'],'a search finds someone from the last page');
 assert.equal(reads(),3,'and reads nothing more');assert.equal(h.message.dataset.fiiuText,'');
});

test('a new registration total re-reads the participant list, so a walk-in can be found; unchanged rows stay as they are',async()=>{
 const ana=participant('participant-a','Ana'),people=[ana];let total=237;
 const h=await harness(()=>({content:[],nextCursor:null}),{participants:people,summaryRead:()=>({summary:{...copy(summary),totalRegistrations:total}})});
 const timers=fakeTimers(h),reads=()=>h.requests.filter(request=>request.path.startsWith('/api/admin/fiiu/registrations')).length,row=h.root.querySelector('.f-participant');
 await h.tickTimers();await flush();assert.equal(reads(),1,'the same total reads nothing');
 people.push(participant('participant-b','Bruno'));total=238;await h.tickTimers();await flush();
 assert.equal(reads(),2,'a new total re-reads the list once');assert.deepEqual(participantNames(h),['Ana Test','Bruno Test']);assert.equal(h.root.querySelector('.f-participant'),row,'Ana’s unchanged row is kept');
 type(field(h.root,'searchParticipants'),'bruno');timers.run();assert.deepEqual(participantNames(h),['Bruno Test']);
 await h.tickTimers();await flush();assert.equal(reads(),2,'and does not read again while the total holds');
});

test('opening a registration cancelled since the list loaded removes its row and says so',async()=>{
 const ana=participant('participant-a','Ana'),bruno=participant('participant-b','Bruno');let cancelled=false;
 const h=await harness(({path})=>{
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(path.endsWith('participant-b'))return cancelled?{status:404,data:{error:'registration unavailable'}}:{registration:copy(bruno),attendance:[]};
  return{registration:copy(ana),attendance:[]};
 },{participants:[ana,bruno]});
 await detailButton(h,0).listeners.click();cancelled=true;await detailButton(h,1).listeners.click();
 assert.deepEqual(participantNames(h),['Ana Test'],'the cancelled row leaves the list');assert.equal(h.message.dataset.fiiuText,'registrationGone');
 assert.equal(detailTitle(h),'Ana Test','the detail on screen stays');assert.equal(field(h.root,'searchParticipants').focused,true,'focus goes to the search box');
 h.lang('es');assert.equal(h.message.textContent,'Esta inscripción fue cancelada y ya no está en la lista.');h.lang('en');
 // The person on screen is the one cancelled: the detail goes too.
 const again=await harness(({path})=>path==='/api/admin/fiiu/content'?{content:[],nextCursor:null}:cancelled?{status:404,data:{error:'registration unavailable'}}:{registration:copy(ana),attendance:[]},{participants:[ana]});
 cancelled=false;await detailButton(again,0).listeners.click();assert.equal(detailTitle(again),'Ana Test');
 cancelled=true;await detailButton(again,0).listeners.click();
 assert.equal(again.root.querySelectorAll('.f-participant').length,0);assert.equal(detailTitle(again),undefined);assert.ok(key(again.root.querySelector('.f-admin-detail'),'selectParticipant'));
 assert.equal(again.message.dataset.fiiuText,'registrationGone');
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

test('a laboratory review updates its row in place and keeps every page loaded in the background',async()=>{
 const people={a:participant('a','Ana'),b:participant('b','Bruno'),c:participant('c','Carla')};
 const h=await createFiiuHarness(({path,method,body})=>{
  if(path==='/api/admin/fiiu/config')return{event:EVENT,config:DEFAULT_CONFIG};
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(path==='/api/admin/fiiu/summary')return{summary:copy(summary)};
  if(path==='/api/admin/fiiu/registrations')return{registrations:[copy(people.a)],nextCursor:'a'};
  if(path==='/api/admin/fiiu/registrations?cursor=a')return{registrations:[copy(people.b),copy(people.c)],nextCursor:null};
  const person=people[path.split('/').pop()];
  if(method==='PATCH'){Object.assign(person,{labStatus:body.labStatus,version:person.version+1});return{registration:copy(person)};}
  return{registration:copy(person),attendance:[]};
 },{page:'fiiu-admin'});
 const list=()=>h.root.querySelector('.f-admin-list'),pageReads=()=>h.requests.filter(request=>/^\/api\/admin\/fiiu\/registrations(\?|$)/.test(request.path)).length;
 key(h.root,'filterLabPending').listeners.click();
 assert.deepEqual(participantNames(h),['Ana Test','Bruno Test','Carla Test']);assert.equal(pageReads(),2);assert.equal(key(list(),'loadMore'),undefined);
 await detailButton(h,1).listeners.click();const form=h.root.querySelector('.f-review-card').querySelector('form');
 field(form,'review').value='reviewAccepted';await submit(form);assert.equal(h.message.dataset.fiiuText,'changesSaved');
 assert.deepEqual(participantNames(h),['Ana Test','Carla Test'],'Carla, from the second page and still pending, stays; accepted Bruno leaves the pending view');
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
 const h=await harness(({method})=>method==='GET'?{content:[],nextCursor:null}:{status:409,data:{error:'configuration changed; reload before saving'}},{configRead:()=>({config:++reads===1?{...DEFAULT_CONFIG,version:0}:{...DEFAULT_CONFIG,programUrl:'https://example.test/programme-latest',version:3}})});
 const settingsReads=()=>h.requests.filter(request=>request.path==='/api/admin/fiiu/config'&&request.method==='GET').length;
 assert.equal(settingsReads(),1,'the first settings, version included, come with the dashboard read');
 const draft=editorForm(h);field(draft,'title').value='Unsaved room change';
 const form=h.root.querySelector('.f-admin-settings').querySelector('form');field(form,'programUrl').value='https://example.test/programme-mine';await submit(form);
 assert.equal(h.message.dataset.fiiuText,'editorConflict');
 await key(form,'reloadLatest').listeners.click();
 const fresh=h.root.querySelector('.f-admin-settings').querySelector('form');
 assert.notEqual(fresh,form);assert.equal(field(fresh,'programUrl').value,'https://example.test/programme-latest');assert.equal(field(fresh,'registrationOpen').focused,true);
 assert.equal(h.reloads(),0,'the page is not reloaded');assert.equal(h.message.dataset.fiiuText,'');assert.equal(settingsReads(),2);
 assert.equal(editorForm(h),draft);assert.equal(field(draft,'title').value,'Unsaved room change','an unrelated draft survives');
 await submit(fresh);assert.equal(h.requests.filter(request=>request.method==='PUT').at(-1).body.version,3,'the next save uses the version just read');
});

test('a conflict on the availability switch reloads the switch alone, so links typed and not yet saved stay for Save',async()=>{
 let reads=0;
 const h=await harness(({method})=>method==='GET'?{content:[],nextCursor:null}:{status:409,data:{error:'configuration changed; reload before saving'}},{configRead:()=>({config:++reads===1?{...DEFAULT_CONFIG,version:0}:{...DEFAULT_CONFIG,registrationOpen:false,programUrl:'https://example.test/programme-latest',version:3}})});
 const form=h.root.querySelector('.f-admin-settings').querySelector('form'),open=field(form,'registrationOpen'),card=h.root.querySelector('.f-switch-card');
 field(form,'programUrl').value='https://example.test/programme-typed';h.ctx.window.confirm=()=>true;
 open.checked=false;await open.listeners.change();
 assert.equal(open.checked,true,'the refused switch shows what is saved');
 await key(card,'reloadLatest').listeners.click();
 assert.equal(h.root.querySelector('.f-admin-settings').querySelector('form'),form,'the form is not rebuilt');
 assert.equal(field(form,'programUrl').value,'https://example.test/programme-typed','the typed link stays');
 assert.equal(open.checked,false,'the switch shows the latest availability');assert.equal(open.focused,true);
 assert.ok(key(h.root.querySelector('.f-admin-head'),'registrationClosedNow'));assert.equal(key(card,'reloadLatest'),undefined);
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

test('leaving the page with an unsaved publication asks first, and the public page opens in a new tab',async()=>{
 const post={id:'p1',version:1,title:'Existing news',body:'',url:'',kind:'news',status:'published',activityId:''};
 const h=await harness(()=>({content:[copy(post)],nextCursor:null}));
 const leave=()=>{let prevented=false;const event={preventDefault(){prevented=true;}};for(const listener of h.windowListeners.beforeunload)listener(event);return prevented&&event.returnValue==='';};
 assert.equal(h.windowListeners.beforeunload.length,1);assert.equal(leave(),false,'a blank editor lets the page go');
 field(editorForm(h),'title').value='Half-written news';assert.equal(leave(),true,'an unsaved new publication asks first');
 key(h.root.querySelector('.f-pub'),'editContent').listeners.click();assert.equal(leave(),true,'set aside while another publication is open, it still counts');
 key(h.root.querySelector('.f-content-editor'),'cancelEdit').listeners.click();assert.equal(field(editorForm(h),'title').value,'Half-written news');assert.equal(leave(),true,'brought back by Cancel, it still counts');
 field(editorForm(h),'title').value='';assert.equal(leave(),false);
 key(h.root.querySelector('.f-pub'),'editContent').listeners.click();assert.equal(leave(),false,'an unchanged edit lets the page go');
 field(editorForm(h),'title').value='Existing news, corrected';assert.equal(leave(),true,'a changed edit asks first');
 const view=key(h.root.querySelector('.f-admin-head'),'viewPublic');assert.equal(view.href,'fiiu.html');assert.equal(view.target,'_blank');assert.equal(view.rel,'noopener');assert.equal(view['aria-describedby'],'f-newtab');
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
 assert.deepEqual(timers.delays(),[12000,60000],'the last failure’s toast clear, then the revoke');timers.run();assert.deepEqual(events.at(-1),['revoked','blob:nodal/export']);assert.equal(h.message.dataset.fiiuText,'','the stale clear leaves the toast alone');
 assert.ok(signals.every(signal=>signal instanceof AbortSignal),'each export has a time limit where the browser supports one');
 h.ctx.AbortSignal={};await csv.listeners.click();
 assert.equal(signals.at(-1),undefined);assert.deepEqual(events.at(-1),['download','blob:nodal/export','fiiu-2026-registrations.csv',true],'Safari before 16, without AbortSignal.timeout, still downloads');
});

test('settings edit only the programme link the public page shows, send the other saved links back unchanged and never send a party link',async()=>{
 // An older saved record may still hold a party link; the party now registers through NODAL, so it is not shown and not sent back.
 const saved={...DEFAULT_CONFIG,version:4,workshopsUrl:'https://example.test/workshops',routesUrl:'https://example.test/routes',partyUrl:'https://example.test/old-party'};
 const h=await harness(({method,body})=>method==='GET'?{content:[],nextCursor:null}:{config:{...body,version:body.version+1}},{configRead:()=>({config:copy(saved)})});
 const form=h.root.querySelector('.f-admin-settings').querySelector('form');
 assert.deepEqual(form.querySelectorAll('input').filter(input=>input.type==='url').map(input=>input.name),['programUrl']);assert.equal(key(form,'partyUrl'),undefined);
 const legend=form.querySelector('legend');assert.equal(legend.dataset.fiiuText,'publicLink','one link, so the legend is singular');assert.equal(legend.textContent,'Link shown on the public page');
 h.lang('es');assert.equal(legend.textContent,'Enlace que se muestra en la página pública');h.lang('pt');assert.equal(legend.textContent,'Link exibido na página pública');h.lang('en');
 field(form,'programUrl').value='https://example.test/programme';await submit(form);
 const body=h.requests.find(request=>request.method==='PUT').body;
 assert.equal('partyUrl' in body,false);assert.equal(body.programUrl,'https://example.test/programme');assert.equal(body.version,4);
 const open=field(form,'registrationOpen');h.ctx.window.confirm=()=>true;open.checked=false;await open.listeners.change();assert.equal('partyUrl' in h.requests.filter(request=>request.method==='PUT').at(-1).body,false,'nor does the switch');
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
 const h=await createFiiuHarness(({path})=>path==='/api/admin/fiiu/config'?{event:EVENT,config:DEFAULT_CONFIG}:path==='/api/admin/fiiu/registrations'?{registrations:[participant('a','Ana')],nextCursor:null}:deny,{page:'fiiu-admin'});
 assert.ok(key(h.root,'organisersOnly'));assert.ok(key(h.root,'organisersOnlyHint'));assert.equal(key(h.root,'retry'),undefined);
 assert.equal(key(h.root,'fiiuPage').href,'fiiu.html');assert.equal(key(h.root,'backToConsole').href,'dashboard.html');
 assert.equal(h.root.querySelectorAll('.f-participant').length,0);assert.doesNotMatch(content(h.root),/ana@example/);
 const before=h.requests.length;await h.tickTimers();assert.equal(h.requests.length,before,'no polling once locked');
});

test('a 401 when the dashboard loads goes to sign-in and comes back to this page',async()=>{
 const h=await createFiiuHarness(({path})=>path==='/api/admin/fiiu/config'?{event:EVENT,config:DEFAULT_CONFIG}:{status:401,data:{error:'sign in required'}},{page:'fiiu-admin'});
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
 const asked=h.requests.length;await h.tickTimers();assert.equal(reads,3,'while signed out the minute only tries the totals once');assert.equal(h.requests.length,asked+1,'and nothing else polls');
 signedOut=false;await key(h.root.querySelector('.f-admin-summary'),'refreshSummary').listeners.click();assert.equal(notice.hidden,true,'a request that works again clears the notice');
 await h.tickTimers();assert.equal(reads,5,'and timed refreshes resume');
});

test('once the organiser signs in again in the other tab, the dashboard recovers by itself: coming back to the tab, or the next minute, tries the totals once',async()=>{
 let reads=0,signedOut=false;
 const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>{reads++;return signedOut?{status:401,data:{error:'sign in required'}}:{summary:copy(summary)};}});
 const notice=h.root.querySelector('.f-session-notice'),questionReads=()=>h.requests.filter(request=>request.path==='/api/admin/fiiu/questions').length,focus=()=>Promise.all((h.windowListeners.focus||[]).map(listener=>listener({type:'focus'})));
 signedOut=true;await h.tickTimers();assert.equal(notice.hidden,false);assert.equal(reads,2);const asked=questionReads();
 // Still signed out: the minute tries the totals once, and nothing else polls.
 await h.tickTimers();assert.equal(reads,3);assert.equal(notice.hidden,false);assert.equal(questionReads(),asked,'the questions wait for the session');
 // Back from signing in: the tab shows again and takes focus at once, and one read clears the notice and brings the questions back.
 await h.visible(false);signedOut=false;await Promise.all([h.visible(true),focus()]);await flush();
 assert.equal(reads,4,'one read for both events');assert.equal(notice.hidden,true,'the notice clears on its own');assert.equal(questionReads(),asked+1);
 // A working session sends nothing extra on a return to the tab.
 await h.visible(true);await focus();await flush();assert.equal(reads,4);
 // Signed in again while this tab stays in view (on another device, say): the next minute finds it.
 signedOut=true;await h.tickTimers();assert.equal(notice.hidden,false);signedOut=false;await h.tickTimers();await flush();
 assert.equal(notice.hidden,true);await h.tickTimers();assert.equal(reads,7,'and timed refreshes carry on');
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
 // The cap is shared with the party announcement, so the summary block says that both count toward it.
 assert.equal(backfillButtons(r).length,0);assert.equal(backfillNote(r),'Today’s limit of 150 emails is reached (sign-up emails and the party announcement included). Sending can continue after 19:00 Lima time.');
 r.lang('es');assert.equal(backfillNote(r),'Se alcanzó el límite de hoy: 150 correos (incluidos los de inscripción y el anuncio de la fiesta). Se puede seguir enviando después de las 19:00, hora de Lima.');
 r.lang('pt');assert.equal(backfillNote(r),'O limite de hoje foi atingido: 150 e-mails (incluindo os de inscrição e o anúncio da festa). O envio pode continuar depois das 19:00, horário de Lima.');r.lang('en');
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
 assert.equal(backfillNote(h),'Sent 4 · Failed 0. Today’s limit of 150 emails is reached (sign-up emails and the party announcement included). Sending can continue after 19:00 Lima time.');
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

// Conversations: organiser questions on festival blocks (GET/POST /api/admin/fiiu/questions, PATCH /api/admin/fiiu/questions/:id).
const QUESTION_ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const question=(over={})=>({id:QUESTION_ID,activityId:'day1-am',talk:'¡Bienvenidos al FIIU 11!',body:'¿Qué te llevas de esta charla?',status:'open',revision:3,messageCount:4,createdAt:'2026-10-21T14:00:00.000Z',version:1,stats:{messages:4,people:3,likes:7},...over});
const conversations=h=>h.root.querySelector('.f-admin-conversations');
const questionForm=h=>conversations(h).querySelector('.f-question-editor').querySelector('form');
const questionRows=h=>conversations(h).querySelectorAll('.f-question');
const questionWrites=h=>h.requests.filter(request=>request.path.startsWith('/api/admin/fiiu/questions')&&request.method!=='GET');
const questionReads=h=>h.requests.filter(request=>request.path==='/api/admin/fiiu/questions'&&request.method==='GET').length;
const select=async(node,value)=>{node.value=value;await node.listeners.change?.();};
const CONVERSATION_KEYS=['conversations','conversationsHint','newQuestion','questionBlock','questionTalk','questionNoTalk','questionText','publishNow','saveHidden','saveQuestion','questionStatus','questionOpen','questionClosed','questionHidden','openChat','present','downloadCsv','editQuestion','questionMessages','questionMessagesOne','questionPeople','questionPeopleOne','questionLikes','questionLikesOne','noQuestions','questionSaved','closeQuestionConfirm','hideQuestionConfirm','questionsLoadError'];

test('the Conversations section follows News and materials, with its own heading, hint and nav entry, in three languages',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}));
 const section=conversations(h);assert.equal(section.id,'conversations');assert.ok(key(section,'conversations'));assert.ok(key(section,'conversationsHint'));assert.ok(key(section,'noQuestions'));
 assert.deepEqual(h.root.children.filter(node=>node.tagName==='section').map(node=>node.id),['overview','checkin','participants','settings','programme','content','conversations']);
 const nav=h.root.querySelector('.f-admin-nav').querySelectorAll('a');assert.deepEqual(nav.map(a=>a.href).slice(-2),['#content','#conversations']);assert.equal(nav.at(-1).dataset.fiiuText,'conversations');
 assert.equal(questionReads(h),1,'the questions are read once, with the rest of the dashboard');
 const rows=h.ctx.window.Fiiu.rows;for(const name of CONVERSATION_KEYS){assert.equal(rows[name]?.length,3,name);assert.ok(rows[name].every(text=>typeof text==='string'&&text.trim()),name);}
 for(const name of ['questionMessages','questionPeople','questionLikes'])assert.ok(rows[name].every(text=>text.includes('{n}')),name);
 h.lang('es');assert.equal(key(conversations(h),'conversations').textContent,'Conversaciones');h.lang('pt');assert.equal(key(conversations(h),'conversations').textContent,'Conversas');
});

test('questions are grouped by block in programme order, each with its talk, counts and status, and the counts follow the language',async()=>{
 const later='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',other='cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
 const h=await harness(()=>({content:[],nextCursor:null}),{questionsRead:()=>({questions:[
  question({id:other,activityId:'day2-am',talk:null,body:'¿Cómo cuidamos la ciudad?',createdAt:'2026-10-21T13:00:00.000Z',stats:{messages:0,people:0,likes:0}}),
  question(),
  question({id:later,talk:null,body:'Una pregunta preparada',status:'hidden',createdAt:'2026-10-21T15:00:00.000Z',stats:{messages:1,people:1,likes:1}}),
 ]})});
 const groups=conversations(h).querySelectorAll('.f-question-group');assert.equal(groups.length,2);
 assert.match(content(groups[0].querySelector('h3')),/El poder de lo local/);assert.match(content(groups[1].querySelector('h3')),/Cuidar y transformar la ciudad/);
 const rows=questionRows(h);assert.deepEqual(rows.map(row=>row.querySelector('.f-question-text').textContent),['¿Qué te llevas de esta charla?','Una pregunta preparada','¿Cómo cuidamos la ciudad?']);
 assert.equal(rows[0].querySelector('.f-question-text').lang,'es');assert.match(content(rows[0]),/¡Bienvenidos al FIIU 11!/);assert.equal(rows[1].querySelector('.f-question-talk'),null);
 assert.match(content(rows[0]),/4 messages.*3 people.*7 likes/);assert.match(content(rows[1]),/1 message.*1 person.*1 like\b/);assert.match(content(rows[2]),/0 messages.*0 people.*0 likes/);
 assert.equal(key(rows[0],'questionOpen')['aria-pressed'],'true');assert.equal(key(rows[0],'questionHidden')['aria-pressed'],'false');
 assert.equal(key(rows[1],'questionHidden')['aria-pressed'],'true');assert.match(rows[1].className,/\bis-hidden\b/);
 const group=key(rows[0],'questionOpen').parent;assert.equal(group.role,'group');assert.equal(group['aria-labelledby'],key(rows[0],'questionStatus').id);
 h.lang('es');assert.match(content(questionRows(h)[0]),/4 mensajes.*3 personas.*7 me gusta/);assert.match(content(questionRows(h)[1]),/1 mensaje.*1 persona.*1 me gusta/);
 h.lang('pt');assert.match(content(questionRows(h)[0]),/4 mensagens.*3 pessoas.*7 curtidas/);
});

test('a new question is posted with one UUID across retries; once saved the text clears and the list shows it, and the next draft gets its own id',async()=>{
 let fail=true;const saved=[];
 const h=await harness(({method,path,body})=>{
  if(path==='/api/admin/fiiu/questions'&&method==='POST'){saved.push(body);if(fail){fail=false;return unavailable;}return{status:201,data:{question:{id:body.id,activityId:body.activityId,talk:body.talk,body:body.body,status:body.status,revision:0,messageCount:0,createdAt:'2026-10-11T15:00:00.000Z',version:1}}};}
  return{content:[],nextCursor:null};
 });
 const form=questionForm(h),block=field(form,'activityId');assert.ok(key(conversations(h),'newQuestion'));
 // General first, then every current block, in programme order, labelled as the publication editor labels them; no historical activities.
 assert.deepEqual(new Set(block.children.map(option=>option.value)),new Set(['','general',...EVENT.activities.map(activity=>activity.id)]));assert.equal(block.children[1].value,'general');
 const dates=block.children.slice(2).map(option=>EVENT.activities.find(activity=>activity.id===option.value).date);assert.deepEqual(dates,[...dates].sort());
 assert.equal(block.children.find(option=>option.value==='day1-am').textContent,'21/10 · El poder de lo local');assert.equal(block.required,true);
 await select(block,'day1-am');await select(field(form,'talk'),'¡Bienvenidos al FIIU 11!');
 const text=field(form,'body');assert.equal(text.tagName,'textarea');assert.equal(text.maxLength,500);type(text,'  ¿Qué te llevas?  ');
 assert.equal(form.querySelector('.f-counter').textContent,'19 / 500');assert.equal(text['aria-describedby'],form.querySelector('.f-counter').id);
 await key(form,'publishNow').listeners.click();
 assert.equal(h.message.dataset.fiiuText,'error');assert.equal(text.value,'  ¿Qué te llevas?  ','the draft survives a failed save');assert.equal(questionRows(h).length,0);
 await key(form,'publishNow').listeners.click();
 assert.match(saved[0].id,UUID);assert.equal(saved[1].id,saved[0].id,'the retry reuses the id, so a lost response never makes a second question');
 assert.deepEqual(saved[1],{id:saved[0].id,activityId:'day1-am',kind:'chat',talk:'¡Bienvenidos al FIIU 11!',body:'¿Qué te llevas?',status:'open'});
 assert.equal(h.message.dataset.fiiuText,'questionSaved');assert.equal(text.value,'','the text clears');assert.equal(form.querySelector('.f-counter').textContent,'0 / 500');
 const rows=questionRows(h);assert.equal(rows.length,1);assert.equal(rows[0].querySelector('.f-question-text').textContent,'¿Qué te llevas?');assert.match(content(rows[0]),/0 messages/);
 assert.equal(key(conversations(h),'noQuestions'),undefined);
 type(text,'Una pregunta para más tarde');await key(form,'saveHidden').listeners.click();
 assert.notEqual(saved.at(-1).id,saved[0].id,'a new draft gets a new id');assert.match(saved.at(-1).id,UUID);assert.equal(saved.at(-1).status,'hidden');
 assert.equal(questionRows(h).length,2);assert.equal(key(questionRows(h)[1],'questionHidden')['aria-pressed'],'true');
 // A blank or space-only question, or no block, is stopped in the browser.
 const before=saved.length;type(text,'   ');await key(form,'publishNow').listeners.click();assert.equal(saved.length,before);assert.equal(text.validationMessage,'Answer this question to continue.');
 type(text,'Otra');await select(block,'');await key(form,'publishNow').listeners.click();assert.equal(saved.length,before);
});

test('the talk choice appears only for blocks with talks and lists that block’s talks',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}));
 const form=questionForm(h),block=field(form,'activityId'),talk=field(form,'talk');
 assert.equal(talk.parent.hidden,true,'no block chosen yet');assert.equal(talk.required,undefined);
 await select(block,'day1-pm');assert.equal(talk.parent.hidden,true,'an evening block has no talks');
 await select(block,'day2-am');assert.equal(talk.parent.hidden,false);
 assert.deepEqual(talk.children.map(option=>option.value),['',...EVENT.activities.find(activity=>activity.id==='day2-am').sessions.map(([,name])=>name)]);
 assert.equal(talk.children[0].dataset.fiiuText,'questionNoTalk');
 await select(talk,'Hacer ciudad en alianza');await select(block,'day3-am');assert.equal(talk.value,'','a talk from another block is not kept');
 await select(block,'');assert.equal(talk.parent.hidden,true);
});

// Finding 13: the talk choice followed the programme as the page loaded it, so a talk renamed since (here, in the Programme section) kept its old name
// in the list and the question was refused with an unrelated message.
const WELCOME='¡Bienvenidos al FIIU 11!',RENAMED='¡Bienvenidas y bienvenidos al FIIU 11!';
const DAY1_TALKS=EVENT.activities.find(activity=>activity.id==='day1-am').sessions;
const renamedDay1=()=>programmeItems({'day1-am':{sessions:DAY1_TALKS.map(([time,name])=>[time,name===WELCOME?RENAMED:name]),edited:true,version:1}});
test('renaming a talk in the Programme section refills the new question’s talk choice, and a talk chosen before it says it changed',async()=>{
 const h=await harness(request=>request.method==='PUT'?savedBlock(request):{content:[],nextCursor:null});
 const form=questionForm(h),block=field(form,'activityId'),talk=field(form,'talk');
 await select(block,'day1-am');await select(talk,WELCOME);type(field(form,'body'),'¿Qué te llevas?');
 const edit=await openBlock(h,'day1-am');type(field(edit.querySelectorAll('.f-programme-line')[0],'sessionTitle'),RENAMED);await submit(edit);
 assert.deepEqual(talk.children.map(option=>option.value),['',RENAMED,...DAY1_TALKS.slice(1).map(([,name])=>name)],'the list offers the talk under its new name');
 assert.equal(talk.value,'','the old name is not kept');assert.equal(field(form,'body').value,'¿Qué te llevas?','the typed question stays');
 const note=key(form,'questionTalkChanged');assert.ok(note);assert.equal(note.hidden,false);assert.equal(talk['aria-describedby'],note.id);
 await select(talk,RENAMED);assert.equal(note.hidden,true,'choosing again clears the note');assert.equal(talk['aria-describedby'],undefined);
 // A save of another block leaves this form's choice alone.
 const other=await openBlock(h,'day2-am');type(field(other,'venue'),'Otra sala');await submit(other);assert.equal(talk.value,RENAMED);assert.equal(note.hidden,true);
});

test('a talk renamed by another organiser is refused with its own message; the block is read again so the new name can be chosen',async()=>{
 let renamed=false;const posts=[];
 const h=await harness(({method,path,body})=>{
  if(path==='/api/admin/fiiu/questions'&&method==='POST'){posts.push(body);if(body.talk===WELCOME){renamed=true;return{status:400,data:{error:'invalid talk',code:'invalid_talk'}};}if(body.activityId==='gone')return{status:400,data:{error:'invalid activity',code:'invalid_activity'}};return{status:201,data:{question:{id:body.id,activityId:body.activityId,talk:body.talk,body:body.body,status:body.status,revision:0,messageCount:0,createdAt:'2026-10-21T15:00:00.000Z',version:1}}};}
  return{content:[],nextCursor:null};
 },{programmeRead:()=>({activities:renamed?renamedDay1():programmeItems()})});
 const form=questionForm(h),block=field(form,'activityId'),talk=field(form,'talk');
 await select(block,'day1-am');await select(talk,WELCOME);type(field(form,'body'),'¿Qué te llevas?');
 await key(form,'publishNow').listeners.click();await flush();
 assert.equal(h.message.dataset.fiiuText,'questionTalkChanged','not the required-fields and HTTPS message');assert.equal(programmeReads(h),2,'the programme is read again');
 assert.ok(talk.children.some(option=>option.value===RENAMED));assert.ok(!talk.children.some(option=>option.value===WELCOME));assert.equal(key(form,'questionTalkChanged').hidden,false);
 assert.equal(field(form,'body').value,'¿Qué te llevas?');assert.equal(questionRows(h).length,0);
 assert.match(content(blockRow(h,'day1-am')),/El poder de lo local/,'the Programme section has the block as read');
 await select(talk,RENAMED);await key(form,'publishNow').listeners.click();await flush();
 assert.equal(posts.at(-1).talk,RENAMED);assert.equal(posts.at(-1).id,posts[0].id,'the same question, sent again');assert.equal(questionRows(h).length,1);assert.equal(h.message.dataset.fiiuText,'questionSaved');
 const rows=h.ctx.window.Fiiu.rows;for(const name of ['questionTalkChanged','questionBlockChanged']){assert.equal(rows[name]?.length,3,name);assert.ok(rows[name].every(text=>typeof text==='string'&&text.trim()),name);}
 h.lang('es');assert.equal(rows.questionTalkChanged[1],'Esta charla cambió en el programa; vuelve a elegirla.');
 // A block that left the programme gets its own message too.
 const gone=Object.assign(h.ctx.document.createElement('option'),{value:'gone',textContent:'gone'});block.append(gone);await select(block,'gone');type(field(form,'body'),'Otra pregunta');
 await key(form,'publishNow').listeners.click();await flush();assert.equal(h.message.dataset.fiiuText,'questionBlockChanged');
});


test('a status change sends the version; a conflict offers Reload the latest version, which re-reads the list',async()=>{
 let current=question();
 const h=await harness(({method,body})=>{
  if(method==='PATCH'){if(body.version!==current.version)return{status:409,data:{error:'question changed; reload before saving',question:current}};current={...current,status:body.status,version:current.version+1};const{stats,...view}=current;return{question:view};}
  return{content:[],nextCursor:null};
 },{questionsRead:()=>({questions:[copy(current)]})});
 const row=()=>questionRows(h)[0],note=()=>row().querySelector('.f-inline-status');
 await key(row(),'questionHidden').listeners.click();
 assert.deepEqual(questionWrites(h).map(({method,path,body})=>({method,path,body})),[{method:'PATCH',path:'/api/admin/fiiu/questions/'+QUESTION_ID,body:{version:1,status:'hidden'}}]);
 assert.equal(key(row(),'questionHidden')['aria-pressed'],'true');assert.equal(key(row(),'questionOpen')['aria-pressed'],'false');assert.match(row().className,/\bis-hidden\b/);
 assert.equal(note().dataset.fiiuText,'questionSaved');assert.match(content(row()),/4 messages.*3 people.*7 likes/,'counts stay when the answer carries none');
 await key(row(),'questionHidden').listeners.click();assert.equal(questionWrites(h).length,1,'the current status sends nothing');
 // Another organiser reopens it meanwhile: this dashboard still holds version 2.
 current={...current,status:'open',version:5};const reads=questionReads(h);
 await key(row(),'questionOpen').listeners.click();
 assert.equal(questionWrites(h).at(-1).body.version,2);assert.equal(note().dataset.fiiuText,'editorConflict');
 const latest=key(row(),'reloadLatest');assert.ok(latest,'a conflict offers the latest version');
 await latest.listeners.click();
 assert.equal(questionReads(h),reads+1);assert.equal(key(row(),'questionOpen')['aria-pressed'],'true');assert.equal(key(row(),'reloadLatest'),undefined);assert.equal(note().dataset.fiiuText,'');
 await key(row(),'questionHidden').listeners.click();assert.equal(questionWrites(h).at(-1).body.version,5,'the next change uses the version just read');assert.equal(note().dataset.fiiuText,'questionSaved');
});

test('closing or hiding a live question asks first; declining sends nothing, and reopening or hiding a prepared one never asks',async()=>{
 let current=question(),asked=[],answer=false;
 const h=await harness(({method,body})=>{if(method==='PATCH'){current={...current,status:body.status,version:current.version+1};return{question:current};}return{content:[],nextCursor:null};},{questionsRead:()=>({questions:[copy(current)]})});
 h.ctx.window.confirm=message=>{asked.push(message);return answer;};
 const row=()=>questionRows(h)[0];
 await key(row(),'questionClosed').listeners.click();assert.deepEqual(asked,['Close this question? People can still read it but not answer.']);assert.equal(questionWrites(h).length,0);assert.equal(key(row(),'questionOpen')['aria-pressed'],'true');
 answer=true;await key(row(),'questionClosed').listeners.click();assert.equal(asked.length,2);assert.deepEqual(questionWrites(h).at(-1).body,{version:1,status:'closed'});assert.equal(key(row(),'questionClosed')['aria-pressed'],'true');
 await key(row(),'questionOpen').listeners.click();assert.equal(asked.length,2,'reopening never asks');
 // An open question is on phones and the projector: hiding it asks, and a declined hide sends nothing.
 answer=false;await key(row(),'questionHidden').listeners.click();assert.equal(asked.at(-1),'Hide this question? It disappears from phones and the projector until you open it again.');assert.deepEqual(questionWrites(h).map(request=>request.body.status),['closed','open']);
 answer=true;await key(row(),'questionHidden').listeners.click();assert.deepEqual(questionWrites(h).map(request=>request.body.status),['closed','open','hidden']);
 // A prepared question (closed, with no answers) hides without asking.
 const prepared=await harness(({method,body})=>method==='PATCH'?{question:{...question({status:'closed',stats:{messages:0,people:0,likes:0}}),status:body.status,version:2}}:{content:[],nextCursor:null},{questionsRead:()=>({questions:[question({status:'closed',stats:{messages:0,people:0,likes:0}})]})});
 let silent=0;prepared.ctx.window.confirm=()=>{silent++;return true;};
 await key(questionRows(prepared)[0],'questionHidden').listeners.click();assert.equal(silent,0);assert.deepEqual(questionWrites(prepared).map(request=>request.body.status),['hidden']);
});

test('editing a question keeps its block, pre-fills the text and talk and saves both with the version; Cancel restores the row',async()=>{
 let current=question();
 const h=await harness(({method,body})=>{if(method==='PATCH'){current={...current,...body,version:current.version+1};return{question:current};}return{content:[],nextCursor:null};},{questionsRead:()=>({questions:[copy(current)]})});
 const row=()=>questionRows(h)[0];
 await key(row(),'editQuestion').listeners.click();
 let form=row().querySelector('form');assert.ok(form);assert.equal(field(form,'activityId'),undefined,'the block cannot change');
 assert.equal(field(form,'body').value,'¿Qué te llevas de esta charla?');assert.equal(field(form,'talk').value,'¡Bienvenidos al FIIU 11!');assert.equal(field(form,'body').focused,true);
 assert.notEqual(field(form,'body').id,field(questionForm(h),'body').id,'the edit form’s ids differ from the new-question form’s');
 type(field(form,'body'),'Changed, then cancelled');await key(form,'cancelEdit').listeners.click();
 assert.equal(row().querySelector('form'),null);assert.equal(row().querySelector('.f-question-text').textContent,'¿Qué te llevas de esta charla?');assert.equal(key(row(),'editQuestion').focused,true);assert.equal(questionWrites(h).length,0);
 await key(row(),'editQuestion').listeners.click();form=row().querySelector('form');
 assert.equal(field(form,'body').value,'¿Qué te llevas de esta charla?','a cancelled edit does not come back');
 type(field(form,'body'),'¿Qué idea te llevas?');await select(field(form,'talk'),'');await key(form,'saveQuestion').listeners.click();
 assert.deepEqual(questionWrites(h).map(({method,path,body})=>({method,path,body})),[{method:'PATCH',path:'/api/admin/fiiu/questions/'+QUESTION_ID,body:{version:1,body:'¿Qué idea te llevas?',talk:null}}]);
 assert.equal(row().querySelector('form'),null);assert.equal(row().querySelector('.f-question-text').textContent,'¿Qué idea te llevas?');assert.equal(row().querySelector('.f-question-talk'),null);
 assert.equal(h.message.dataset.fiiuText,'questionSaved');
 await key(row(),'editQuestion').listeners.click();type(field(row().querySelector('form'),'body'),'Otra vez');await key(row().querySelector('form'),'saveQuestion').listeners.click();
 assert.equal(questionWrites(h).at(-1).body.version,2,'the next edit uses the saved version');
});

test('leaving the page with a question draft or a changed question edit asks first',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{questionsRead:()=>({questions:[question()]})});
 const leave=()=>{let prevented=false;const event={preventDefault(){prevented=true;}};for(const listener of h.windowListeners.beforeunload)listener(event);return prevented&&event.returnValue==='';};
 assert.equal(leave(),false);const text=field(questionForm(h),'body');
 type(text,'Half a question');assert.equal(leave(),true,'a question draft with text asks first');
 type(text,'   ');assert.equal(leave(),false,'spaces are not a draft');type(text,'');
 await select(field(questionForm(h),'activityId'),'day1-am');assert.equal(leave(),false,'a block alone is not a draft');
 await key(questionRows(h)[0],'editQuestion').listeners.click();assert.equal(leave(),false,'an unchanged edit lets the page go');
 const edit=questionRows(h)[0].querySelector('form');type(field(edit,'body'),'Half-corrected question');assert.equal(leave(),true,'a changed edit asks first');
 await key(edit,'cancelEdit').listeners.click();assert.equal(leave(),false);
});

test('losing organiser access empties the Conversations section, whether the summary or the questions read reports it',async()=>{
 for(const source of ['summary','questions']){
  let deny=false;const denied={status:403,data:{error:'administrator access required'}};
  const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>deny&&source==='summary'?denied:{summary:copy(summary)},questionsRead:()=>deny&&source==='questions'?denied:{questions:[question()]}});
  const host=conversations(h);assert.equal(questionRows(h).length,1);type(field(questionForm(h),'body'),'Unsent question');
  deny=true;await h.tickTimers();await flush();
  assert.equal(host.children.length,0,source);assert.ok(key(h.root,'organisersOnly'),source);assert.doesNotMatch(content(h.root),/Qué te llevas|Unsent question/,source);
  const leave=()=>{let prevented=false;for(const listener of h.windowListeners.beforeunload)listener({preventDefault(){prevented=true;}});return prevented;};assert.equal(leave(),false,'a locked page lets the organiser go');
  const before=h.requests.length;await h.tickTimers();assert.equal(h.requests.length,before,source);
 }
});

test('each question links to its chat and projector in a new tab, and offers its CSV as a button that never leaves the dashboard',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{questionsRead:()=>({questions:[question()]})});
 const row=questionRows(h)[0],text=row.querySelector('.f-question-text');assert.equal(text.id,'f-q-'+QUESTION_ID);
 const chat=key(row,'openChat'),present=key(row,'present'),csv=key(row,'downloadCsv');
 assert.equal(chat.tagName,'a');assert.equal(chat.href,'fiiu-session.html?q='+QUESTION_ID);assert.equal(present.href,'fiiu-session.html?q='+QUESTION_ID+'&present=1');
 for(const a of [chat,present]){assert.equal(a.target,'_blank');assert.equal(a.rel,'noopener');assert.equal(a['aria-describedby'],text.id+' f-newtab');}
 assert.equal(csv.tagName,'button');assert.equal(csv.type,'button');assert.equal(csv.href,undefined,'fetched, so a failure is reported instead of a cancelled download');assert.equal(csv['aria-describedby'],text.id);
 assert.equal(key(row,'editQuestion')['aria-describedby'],text.id);
});

test('an unavailable questions read leaves the dashboard working and offers a retry; the minute refresh updates counts in place, only while visible and switched on',async()=>{
 let fail=true,current=question();
 const h=await harness(()=>({content:[],nextCursor:null}),{questionsRead:()=>fail?unavailable:{questions:[copy(current)]}});
 const section=conversations(h);assert.ok(h.root.querySelector('.f-admin-summary'));assert.ok(h.root.querySelector('.f-content-editor'));assert.ok(questionForm(h),'a question can still be written');
 assert.ok(key(section,'questionsLoadError'));assert.equal(key(section,'noQuestions'),undefined,'an outage is not reported as an empty list');
 fail=false;await key(section,'retry').listeners.click();
 assert.equal(key(section,'questionsLoadError'),undefined);assert.equal(questionRows(h).length,1);assert.match(content(questionRows(h)[0]),/4 messages/);
 const row=questionRows(h)[0],chat=key(row,'openChat');current={...current,stats:{messages:9,people:5,likes:12},messageCount:9,revision:8};
 await h.tickTimers();assert.equal(questionReads(h),3);assert.equal(questionRows(h)[0],row,'the row is updated in place');assert.equal(key(row,'openChat'),chat);assert.match(content(row),/9 messages.*5 people.*12 likes/);
 h.visible(false);await h.tickTimers();assert.equal(questionReads(h),3,'a background tab does not poll');h.visible(true);
 const toggle=field(h.root.querySelector('.f-admin-summary'),'autoRefresh');toggle.checked=false;toggle.listeners.change();await h.tickTimers();assert.equal(questionReads(h),3,'paused timed refresh leaves the questions too');
 fail=true;toggle.checked=true;await h.tickTimers();assert.ok(key(section,'questionsLoadError'));assert.equal(questionRows(h)[0],row,'a failed refresh keeps the last list');
});

test('a status change made here while the same question is being edited does not turn saving that edit into a conflict, but another organiser’s change does',async()=>{
 let current=question();
 const h=await harness(({method,body})=>{
  if(method==='PATCH'){if(body.version!==current.version)return{status:409,data:{error:'question changed; reload before saving',question:current}};current={...current,...body,version:current.version+1};return{question:current};}
  return{content:[],nextCursor:null};
 },{questionsRead:()=>({questions:[copy(current)]})});
 const row=()=>questionRows(h)[0];
 await key(row(),'editQuestion').listeners.click();type(field(row().querySelector('form'),'body'),'Edited while hiding');
 await key(row(),'questionHidden').listeners.click();assert.equal(current.version,2);
 await key(row().querySelector('form'),'saveQuestion').listeners.click();
 assert.deepEqual(questionWrites(h).map(request=>request.body.version),[1,2]);assert.equal(h.message.dataset.fiiuText,'questionSaved');assert.equal(row().querySelector('.f-question-text').textContent,'Edited while hiding');
 // Another organiser's change, learnt from the minute refresh, still meets the conflict.
 await key(row(),'editQuestion').listeners.click();type(field(row().querySelector('form'),'body'),'Second edit');
 current={...current,status:'open',version:9};await h.tickTimers();assert.equal(key(row(),'questionOpen')['aria-pressed'],'true');
 await key(row().querySelector('form'),'saveQuestion').listeners.click();
 assert.equal(questionWrites(h).at(-1).body.version,3);assert.equal(h.message.dataset.fiiuText,'editorConflict');assert.ok(key(row().querySelector('form'),'reloadLatest'));
 await key(row().querySelector('form'),'reloadLatest').listeners.click();
 const form=row().querySelector('form');assert.equal(field(form,'body').value,'Second edit','the edit reopens on the latest version with the typed text kept');assert.equal(field(form,'body').focused,true);
 await key(form,'saveQuestion').listeners.click();assert.deepEqual(questionWrites(h).at(-1).body,{version:9,body:'Second edit',talk:'¡Bienvenidos al FIIU 11!'});
});

// The organiser at work: reaching a section from its link, the detail panel, door check-in on phones, search, the availability switch,
// failed ticks, a question edit's conflict and a question's CSV.
const leavePrompt=h=>{let prevented=false;for(const listener of h.windowListeners.beforeunload)listener({preventDefault(){prevented=true;}});return prevented;};
const at=hash=>({location:{hash,search:'',pathname:'/fiiu-admin.html',assign(){},reload(){}}});

test('opening the dashboard at a section link scrolls there once, after the sections above it have filled in, and never yanks an organiser who already moved',async()=>{
 const scrolls=[],original=Node.prototype.scrollIntoView;
 Node.prototype.scrollIntoView=function(options){scrolls.push({id:this.id,options:{...options}});};
 try{
  const totals=deferred(),list=deferred(),to=id=>scrolls.filter(scroll=>scroll.id===id);
  const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>totals.promise,questionsRead:()=>list.promise,context:at('#participants')});
  assert.deepEqual(to('participants'),[],'nothing moves while the overview is still empty');
  assert.equal(h.ctx.history.scrollRestoration,'manual','the browser does not restore an old position the late render would then shift');
  totals.resolve({summary:copy(summary)});await flush();assert.deepEqual(to('participants'),[],'the questions are still on their way');
  list.resolve({questions:[question()]});await flush();
  assert.deepEqual(to('participants'),[{id:'participants',options:{block:'start',behavior:'instant'}}],'one jump, not a smooth scroll to a stale position');
  await h.tickTimers();await flush();assert.equal(to('participants').length,1,'timed refreshes never scroll again');
  for(const type of ['wheel','touchstart','pointerdown','keydown']){
   const late=deferred(),again=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>late.promise,context:at('#settings')});
   for(const listener of again.windowListeners[type]||[])listener({type});
   late.resolve({summary:copy(summary)});await flush();assert.equal(to('settings').length,0,type+' before the data landed keeps the organiser where they are');
  }
  const plain=await harness(()=>({content:[],nextCursor:null}),{context:at('#f-p-anything')});
  assert.equal(scrolls.length,1,'a hash that is not a section scrolls nothing');assert.notEqual(plain.ctx.history.scrollRestoration,'manual');
 }finally{Node.prototype.scrollIntoView=original;}
});

test('switching to another person starts the detail panel at the top, so their name shows above the ticks; refreshing the same person keeps the place',async()=>{
 const ana=participant('participant-a','Ana'),bruno=participant('participant-b','Bruno');
 const h=await harness(({path,method,body})=>{
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(method==='PATCH'){Object.assign(ana,{labStatus:body.labStatus,version:ana.version+1});return{registration:copy(ana)};}
  return{registration:copy(path.endsWith('participant-b')?bruno:ana),attendance:[]};
 },{participants:[ana,bruno]});
 h.ctx.window.matchMedia=()=>({matches:true});const detail=h.root.querySelector('.f-admin-detail');
 await detailButton(h,0).listeners.click();detail.scrollTop=196;
 await detailButton(h,1).listeners.click();assert.equal(detailTitle(h),'Bruno Test');assert.equal(detail.scrollTop,0,'not Ana’s scroll position');
 await detailButton(h,0).listeners.click();assert.equal(detail.scrollTop,0);detail.scrollTop=150;
 const form=h.root.querySelector('.f-review-card').querySelector('form');field(form,'review').value='reviewAccepted';await submit(form);
 assert.equal(detailTitle(h),'Ana Test');assert.equal(detail.scrollTop,150,'a save that re-reads the same person keeps the place');
});

test('on touch screens the attendance rows, the other-activities disclosure, filters, section nav, review shortcut and small buttons are at least 44px tall, with body-size row text',()=>{
 const css=readFileSync(new URL('../web/styles/fiiu.css',import.meta.url),'utf8'),coarse=css.split('\n').filter(line=>line.startsWith('@media(pointer:coarse)')).join('\n');
 assert.match(coarse,/\.f-attendance-row \.f-check\{min-height:44px;margin:0;padding:10px 0;font-size:1rem\}/,'padding rather than centring, so a two-line title keeps its box by the first line');
 assert.match(coarse,/\.f-attendance-row \.f-check input\{width:24px;height:24px;margin-top:0\}/);
 assert.match(coarse,/\.f-attendance-row>:is\(\.f-pill,\.f-inline-status,\.f-attendance-method\)\{margin-left:34px\}/,'the notes under a row stay in line with its title');
 assert.match(coarse,/\.f-page \.f-other>summary\{min-height:44px;padding:12px 0;font-size:1rem\}/,'the same text size as the rows it opens');
 assert.match(coarse,/\.f-page\[data-page="fiiu-admin"\] :is\(\.f-filter,\.f-admin-nav a,\.f-lab-review,\.f-button\.f-small\)\{min-height:44px\}/);
 assert.match(coarse,/\.f-admin-nav\{padding:4px 0\}/,'the stuck nav stays 53px tall, so the scroll padding under it still fits');
});

test('participant search matches every word anywhere in the name or email, so a given name and a surname find someone in either order',async()=>{
 const ana={...participant('participant-a','Ana'),email:'agonzales@muni.example'},beto={...participant('participant-b','Beto'),email:'bq@example.test'};
 ana.answers={...ana.answers,firstName:'Ana María',lastName:'Gonzales'};beto.answers={...beto.answers,firstName:'Beto',lastName:'Quispe'};
 const h=await harness(()=>({content:[],nextCursor:null}),{participants:[beto,ana]}),timers=fakeTimers(h),search=field(h.root,'searchParticipants');
 for(const [query,names] of [['Ana Gonzales',['Ana María Gonzales']],['gonzales ana',['Ana María Gonzales']],['Quispe Beto',['Beto Quispe']],['  maría   GONZÁLES ',['Ana María Gonzales']],['muni ana',['Ana María Gonzales']],['Ana Quispe',[]]]){
  type(search,query);timers.run();assert.deepEqual(participantNames(h),names,query);
 }
});

test('the pending-review shortcut clears a search left in the box, including one still waiting for its pause in typing',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{participants:[{...participant('participant-b','Bruno'),labStatus:'accepted'},participant('participant-a','Ana')]});
 const timers=fakeTimers(h),search=field(h.root,'searchParticipants'),review=()=>key(h.root.querySelector('.f-admin-summary'),'reviewPendingAction').listeners.click();
 type(search,'bruno');timers.run();assert.deepEqual(participantNames(h),['Bruno Test']);
 review();assert.deepEqual(participantNames(h),['Ana Test'],'every pending application shows');assert.equal(search.value,'');assert.equal(key(h.root,'noMatches'),undefined);
 key(h.root,'filterAll').listeners.click();type(search,'bru');review();timers.run();
 assert.deepEqual(participantNames(h),['Ana Test'],'the search typed just before does not come back');assert.equal(search.value,'');
});

test('a switch save that fails puts the switch back and says so beside it; a conflict offers the latest settings; a toggle while saving is undone',async()=>{
 let reply=unavailable,reads=0;
 const h=await harness(({method})=>method==='GET'?{content:[],nextCursor:null}:reply,{configRead:()=>({config:++reads===1?{...DEFAULT_CONFIG,version:0}:{...DEFAULT_CONFIG,registrationOpen:false,version:4}})});
 const card=()=>h.root.querySelector('.f-switch-card'),open=()=>field(card(),'registrationOpen'),note=()=>card().querySelector('.f-inline-status'),pill=name=>key(h.root.querySelector('.f-admin-head'),name);
 open().checked=false;await open().listeners.change();
 assert.equal(open().checked,true,'the switch shows what is saved');assert.equal(note().dataset.fiiuText,'error');assert.ok(pill('registrationOpenNow'));
 reply={status:409,data:{error:'configuration changed; reload before saving'}};open().checked=false;await open().listeners.change();
 assert.equal(open().checked,true);assert.equal(note().dataset.fiiuText,'editorConflict');
 await key(card(),'reloadLatest').listeners.click();
 assert.equal(open().checked,false,'the latest settings show another organiser closed it');assert.ok(pill('registrationClosedNow'));assert.equal(open().focused,true);
 const save=key(h.root.querySelector('.f-admin-settings'),'saveSettings'),before=h.requests.filter(request=>request.method==='PUT').length;let finish;
 reply=new Promise(resolve=>{finish=resolve;});open().checked=true;const saving=open().listeners.change();
 assert.equal(open().disabled,false,'the switch keeps focus while saving');assert.equal(open()['aria-disabled'],'true');assert.equal(save.disabled,true,'the links wait for it');
 open().checked=false;open().listeners.change();assert.equal(open().checked,true,'a toggle while saving is undone');
 assert.equal(h.requests.filter(request=>request.method==='PUT').length,before+1);assert.equal(h.requests.at(-1).body.version,4,'the version just read');
 finish({config:{...DEFAULT_CONFIG,registrationOpen:true,version:5}});await saving;
 assert.equal(open()['aria-disabled'],undefined);assert.equal(save.disabled,false);assert.ok(pill('registrationOpenNow'));assert.equal(note().dataset.fiiuText,'changesSaved');
});

test('leaving the page with a typed link not yet saved asks first; the switch, which saves itself, never does',async()=>{
 // Like the server (normalizeConfig), the reply stores each link as new URL(link).href.
 const normal=body=>Object.fromEntries(Object.entries(body).map(([name,value])=>[name,name.endsWith('Url')&&value?new URL(value).href:value]));
 const h=await harness(({method,body})=>method==='GET'?{content:[],nextCursor:null}:{config:{...normal(body),version:body.version+1}});
 const form=h.root.querySelector('.f-admin-settings').querySelector('form'),open=field(form,'registrationOpen'),programme=field(form,'programUrl');
 open.checked=false;await open.listeners.change();assert.equal(leavePrompt(h),false);
 programme.value='https://example.test/programme-new';assert.equal(leavePrompt(h),true,'an unsaved link asks first');
 programme.value=DEFAULT_CONFIG.programUrl;assert.equal(leavePrompt(h),false,'typed back as saved, it lets the page go');
 programme.value='https://example.test/programme-new';await submit(form);assert.equal(leavePrompt(h),false,'saved');
 programme.value='https://Example.test';await submit(form);
 assert.equal(programme.value,'https://example.test/','the field shows the link as the server saved it');assert.equal(leavePrompt(h),false,'a link the server tidied is still saved');
});

test('a failed attendance tick says the attendance was not saved: an ended session puts a sign-in link on the row, an outage asks to tick again',async()=>{
 const ana=participant('participant-a','Ana');let reply;
 const h=await harness(({path,method})=>{
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(method==='PUT')return reply();
  return{registration:copy(ana),attendance:[]};
 },{participants:[ana]});
 await detailButton(h,0).listeners.click();
 const row=h.root.querySelector('.f-admin-detail').querySelectorAll('.f-attendance-row').find(node=>key(node,'statusRegistered')),input=row.querySelector('input'),note=row.querySelector('.f-inline-status');
 const tick=async()=>{input.checked=true;await input.listeners.change();};
 reply=()=>{throw TypeError('Failed to fetch');};await tick();
 assert.equal(input.checked,false,'the tick is undone');assert.equal(note.dataset.fiiuText,'attendanceNotSaved');assert.equal(note.querySelector('a'),null);
 reply=()=>unavailable;await tick();assert.equal(note.dataset.fiiuText,'attendanceNotSaved','a server error reads the same: the page cannot tell them apart');
 reply=()=>({status:429,data:{error:'too many requests'}});await tick();assert.equal(note.dataset.fiiuText,'rate');
 reply=()=>({status:401,data:{error:'sign in required'}});await tick();
 assert.equal(input.checked,false);assert.equal(note.dataset.fiiuText,'attendanceSignIn');
 const signin=key(note,'adminSignIn');assert.ok(signin,'the sign-in link is on the row');assert.equal(signin.target,'_blank');assert.equal(signin.href,'/login.html?next=%2Ffiiu-admin.html');
 assert.equal(h.root.querySelector('.f-session-notice').hidden,false,'the page notice shows too');assert.equal(h.message.dataset.fiiuText,'','no toast on top of it');
 note.children.length=0;h.lang('es');assert.equal(descendants(note).filter(node=>node.dataset.fiiuText==='adminSignIn').length,1,'a language switch puts the link back');
 h.lang('en');assert.equal(descendants(note).filter(node=>node.dataset.fiiuText==='adminSignIn').length,1,'and never adds a second one');
 const rows=h.ctx.window.Fiiu.rows;for(const name of ['attendanceSignIn','attendanceNotSaved'])assert.ok(rows[name]?.length===3&&rows[name].every(text=>text.trim()),name);
 assert.equal(rows.attendanceSignIn[1],'No se guardó la asistencia: tu sesión terminó.');assert.equal(rows.attendanceNotSaved[1],'No se guardó la asistencia. Revisa la conexión y vuelve a marcarla.');
});

test('a tick refused for a block outside the person’s plan says so on the row, and a tick on a registration cancelled meanwhile takes it out of the list and the detail',async()=>{
 const ana=participant('participant-a','Ana'),bruno=participant('participant-b','Bruno');let reply;
 const h=await harness(({path,method})=>{
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(method==='PUT')return reply();
  return{registration:copy(path.endsWith('participant-b')?bruno:ana),attendance:[]};
 },{participants:[ana,bruno]});
 await detailButton(h,0).listeners.click();
 const row=h.root.querySelector('.f-admin-detail').querySelectorAll('.f-attendance-row').find(node=>key(node,'statusRegistered')),input=row.querySelector('input'),note=row.querySelector('.f-inline-status');
 const tick=async()=>{input.checked=true;await input.listeners.change();};
 // The plan changed since the detail opened: the server refuses the tick, and the row says why instead of speaking of required fields and links.
 reply=()=>({status:400,data:{error:'participant is not registered for this activity'}});await tick();
 assert.equal(input.checked,false,'the tick is undone');assert.equal(note.dataset.fiiuText,'attendanceNotRegistered');
 for(const [lang,text] of [['es','No se guardó la asistencia: esta persona no está inscrita en este bloque.'],['pt','A presença não foi salva: esta pessoa não está inscrita neste bloco.'],['en','Attendance not saved: this person is not registered for this block.']]){h.lang(lang);assert.equal(note.textContent,text,lang);}
 // Cancelled since the detail opened: no retry can work, so it goes the way opening it would, and the toast says so, since the row has left the page.
 reply=()=>({status:404,data:{error:'registration unavailable'}});await tick();
 assert.deepEqual(participantNames(h),['Bruno Test'],'the cancelled row leaves the list');assert.equal(detailTitle(h),undefined,'and the detail goes');assert.ok(key(h.root.querySelector('.f-admin-detail'),'selectParticipant'));
 assert.equal(h.message.dataset.fiiuText,'registrationGone');assert.equal(field(h.root,'searchParticipants').focused,true,'focus goes to the search box');
 // A tick still out when the organiser moved on to someone else: the cancelled row leaves the list, and the person on screen and the focus stay.
 let answer;const again=await harness(({path,method})=>{
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(method==='PUT')return new Promise(resolve=>{answer=resolve;});
  return{registration:copy(path.endsWith('participant-b')?bruno:ana),attendance:[]};
 },{participants:[ana,bruno]});
 await detailButton(again,0).listeners.click();const box=again.root.querySelector('.f-admin-detail').querySelectorAll('.f-attendance-row').find(node=>key(node,'statusRegistered')).querySelector('input');
 box.checked=true;const pending=box.listeners.change();await flush();await detailButton(again,1).listeners.click();assert.equal(detailTitle(again),'Bruno Test');
 answer({status:404,data:{error:'registration unavailable'}});await pending;
 assert.deepEqual(participantNames(again),['Bruno Test']);assert.equal(detailTitle(again),'Bruno Test');assert.equal(again.message.dataset.fiiuText,'registrationGone');assert.notEqual(field(again.root,'searchParticipants').focused,true);
});

test('reloading after a question edit conflict keeps the typed text and talk on the latest version, and shows the other organiser’s text when that changed',async()=>{
 let current=question();
 const h=await harness(({method,body})=>{
  if(method==='PATCH'){if(body.version!==current.version)return{status:409,data:{error:'question changed; reload before saving'}};current={...current,...body,version:current.version+1};const{stats,...view}=current;return{question:view};}
  return{content:[],nextCursor:null};
 },{questionsRead:()=>({questions:[copy(current)]})});
 const row=()=>questionRows(h)[0],form=()=>row().querySelector('form'),typed='¿Qué intervención de acupuntura urbana harías en tu cuadra? (texto corregido)';
 await key(row(),'editQuestion').listeners.click();type(field(form(),'body'),typed);await select(field(form(),'talk'),'');
 // Another organiser only closes it.
 current={...current,status:'closed',version:2};
 await key(form(),'saveQuestion').listeners.click();assert.equal(h.message.dataset.fiiuText,'editorConflict');
 await key(form(),'reloadLatest').listeners.click();
 assert.equal(field(form(),'body').value,typed,'the typed text stays');assert.equal(field(form(),'talk').value,'','and so does the talk choice');
 assert.equal(field(form(),'body').focused,true);assert.equal(form().querySelector('.f-counter').textContent,typed.length+' / 500');
 assert.equal(form().querySelector('.f-question-latest'),null,'the text was not changed elsewhere: nothing to compare');
 assert.equal(key(row(),'questionClosed')['aria-pressed'],'true','the row shows the other organiser’s status');assert.equal(leavePrompt(h),true,'the kept draft still guards leaving');
 await key(form(),'saveQuestion').listeners.click();
 assert.deepEqual(questionWrites(h).at(-1).body,{version:2,body:typed,talk:null});assert.equal(h.message.dataset.fiiuText,'questionSaved');
 // A real text conflict: the draft stays in the field and the latest saved text is shown under it.
 await key(row(),'editQuestion').listeners.click();type(field(form(),'body'),'Mi versión');
 current={...current,body:'La versión de otra organizadora',talk:'¡Bienvenidos al FIIU 11!',version:7};
 await key(form(),'saveQuestion').listeners.click();await key(form(),'reloadLatest').listeners.click();
 assert.equal(field(form(),'body').value,'Mi versión');assert.equal(field(form(),'talk').value,'');
 const latest=form().querySelector('.f-question-latest');assert.ok(latest);assert.ok(key(latest,'questionLatest'));
 assert.match(content(latest),/La versión de otra organizadora/);assert.match(content(latest),/¡Bienvenidos al FIIU 11!/);
 assert.ok(field(form(),'body')['aria-describedby'].split(' ').includes(latest.id),'read out with the field');
 const rows=h.ctx.window.Fiiu.rows;assert.equal(rows.questionLatest?.length,3);
 await key(form(),'saveQuestion').listeners.click();assert.equal(questionWrites(h).at(-1).body.version,7);assert.equal(row().querySelector('.f-question-text').textContent,'Mi versión');
});

test('a question’s CSV downloads through fetch, and an ended session, a busy server or an outage is reported in the dashboard',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{questionsRead:()=>({questions:[question()]})}),events=[],fetchPage=h.ctx.fetch,createElement=h.ctx.document.createElement;let reply;
 fakeTimers(h);h.ctx.URL={createObjectURL:blob=>{events.push(['object URL',blob]);return 'blob:nodal/q';},revokeObjectURL(){}};
 h.ctx.document.createElement=tag=>{const node=createElement(tag);if(tag==='a')Object.assign(node,{click(){events.push(['download',this.href,this.download]);},remove(){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}});return node;};
 const path='/api/admin/fiiu/questions/'+QUESTION_ID+'/export',failure=code=>async()=>({ok:false,status:code,headers:{get:()=>'application/json'},blob:async()=>{throw Error('not a CSV');}});
 h.ctx.fetch=async(url,options)=>url===path?reply():fetchPage(url,options);
 const csv=key(questionRows(h)[0],'downloadCsv');
 reply=failure(401);await csv.listeners.click();
 assert.equal(h.message.dataset.fiiuText,'unauthorized');assert.ok(key(h.message,'adminSignIn'),'with the sign-in link');assert.equal(h.root.querySelector('.f-session-notice').hidden,false);
 for(const [code,shown] of [[429,'rate'],[502,'error']]){reply=failure(code);await csv.listeners.click();assert.equal(h.message.dataset.fiiuText,shown);assert.equal(csv.disabled,false);}
 assert.equal(events.length,0,'nothing is downloaded when the export fails');
 const file={type:'text/csv'};reply=async()=>({ok:true,status:200,headers:{get:name=>name==='Content-Disposition'?'attachment; filename="fiiu-conversation-aaaaaaaa.csv"':'text/csv'},blob:async()=>file});
 await csv.listeners.click();assert.deepEqual(events,[['object URL',file],['download','blob:nodal/q','fiiu-conversation-aaaaaaaa.csv']]);
 reply=async()=>({ok:true,status:200,headers:{get:()=>null},blob:async()=>file});await csv.listeners.click();assert.equal(events.at(-1)[2],'fiiu-conversation.csv','a fallback name when the server gives none');
});

// Programme: the organiser programme routes (GET /api/admin/fiiu/programme, PUT and DELETE /api/admin/fiiu/programme/:id) as the server serves them.
const programmeSection=h=>h.root.querySelector('.f-admin-programme');
const blockRow=(h,id)=>programmeSection(h).querySelectorAll('.f-programme-row').find(row=>row.querySelector('.f-programme-title')?.id==='f-pg-'+id);
const blockForm=(h,id)=>blockRow(h,id).querySelector('form');
const openBlock=async(h,id)=>{key(blockRow(h,id),'pgEdit').listeners.click();await flush();return blockForm(h,id);};
const programmeWrites=h=>h.requests.filter(request=>request.path.startsWith('/api/admin/fiiu/programme/'));
const programmeReads=h=>h.requests.filter(request=>request.path==='/api/admin/fiiu/programme'&&request.method==='GET').length;
const lineValues=form=>form.querySelectorAll('.f-programme-line').map(line=>[field(line,'sessionTime').value,field(line,'sessionTitle').value]);
// A PUT that saves: the block as sent, edited, one version on.
const savedBlock=({path,body})=>{const id=decodeURIComponent(path.split('/').pop()),{version,...fields}=body;return{activity:programmeItem(EVENT.activities.find(activity=>activity.id===id),{...fields,edited:true,version:version+1})};};
const PROGRAMME_KEYS=['programmeSection','pgHint','pgUntimed','pgFrom','pgConference','pgLab','pgParty','pgWorkshop','pgRoute','pgEdited','pgEdit','pgTitle','pgDate','pgStart','pgEnd','pgEndOptional','pgTimeHintCheckin','pgTimeHintFree','pgVenue','pgDescription','pgSessions','pgSessionsHint','pgSessionTime','pgSessionTitle','pgLine','pgAddLine','pgMoveUp','pgMoveDown','pgRemoveLine','pgFormUrl','pgSave','pgCancel','pgRestore','pgRestoreConfirm','pgRestored','pgDiscard','pgStartRequired','pgEndRequired','pgEndAfterStart','pgInvalidTitle','pgInvalidDate','pgInvalidTime','pgInvalidVenue','pgInvalidDescription','pgInvalidSessions','pgInvalidFormUrl','pgNotFound','pgHoursWarningOne','pgHoursWarningMany','pgWindowWarning','pgLoadError','pgEmptyValue'];

test('the Programme section sits between Registration and links and Conversations, with its own nav entry, and #programme reaches it',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}));
 assert.deepEqual(h.root.children.filter(node=>node.tagName==='section').map(node=>node.id),['overview','checkin','participants','settings','programme','content','conversations']);
 const nav=h.root.querySelector('.f-admin-nav').querySelectorAll('a').map(a=>a.href);assert.deepEqual(nav.slice(nav.indexOf('#settings'),nav.indexOf('#settings')+2),['#settings','#programme']);
 const section=programmeSection(h);assert.equal(section.id,'programme');assert.ok(key(section,'programmeSection'));assert.ok(key(section,'pgHint'));assert.equal(programmeReads(h),1,'read once, with the rest of the dashboard');
 const rows=h.ctx.window.Fiiu.rows;for(const name of PROGRAMME_KEYS){assert.equal(rows[name]?.length,3,name);assert.ok(rows[name].every(text=>typeof text==='string'&&text.trim()),name);}
 for(const name of ['pgHoursWarningOne','pgHoursWarningMany'])assert.ok(rows[name].every(text=>name.endsWith('One')||text.includes('{n}')),name);
 h.lang('es');assert.equal(key(section,'programmeSection').textContent,'Programa');h.lang('pt');assert.equal(key(section,'programmeSection').textContent,'Programação');
 const scrolls=[],original=Node.prototype.scrollIntoView;Node.prototype.scrollIntoView=function(){scrolls.push(this.id);};
 try{await harness(()=>({content:[],nextCursor:null}),{context:at('#programme')});await flush();assert.deepEqual(scrolls,['programme']);}finally{Node.prototype.scrollIntoView=original;}
});

test('programme rows are grouped by day in programme order, each with its time, title, kind and an Edited pill, in three languages',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{programmeRead:()=>({activities:programmeItems({'day2-pm':{title:'Título editado',edited:true,version:2}})})});
 const days=programmeSection(h).querySelectorAll('.f-programme-day');
 assert.deepEqual(days.map(day=>day.querySelector('h3').dataset.fiiuDate),['2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25']);
 const ids=day=>day.querySelectorAll('.f-programme-title').map(node=>node.id.slice('f-pg-'.length));
 assert.deepEqual(ids(days[1]).slice(0,2),['day1-am','day1-pm'],'the conference blocks first, morning then evening');assert.ok(ids(days[1]).slice(2).every(id=>id.startsWith('workshop-')));
 assert.equal(ids(days[4]).at(-1),'closing-party','the party closes Saturday, after its routes');
 assert.equal(days[1].querySelector('ul')['aria-labelledby'],days[1].querySelector('h3').id);
 const time=id=>content(blockRow(h,id).querySelector('.f-programme-time')).replace(/\s+/g,' ').trim();
 assert.equal(time('day1-am'),'09:00–13:00');assert.equal(time('day0-lab'),'Untimed');assert.equal(time('closing-party'),'From 17:00');
 for(const [id,kind] of [['day1-am','pgConference'],['day0-lab','pgLab'],['closing-party','pgParty'],['workshop-calles-gente','pgWorkshop'],['route-amancaes','pgRoute']])assert.ok(key(blockRow(h,id),kind),id);
 assert.ok(key(blockRow(h,'day2-pm'),'pgEdited'));assert.equal(blockRow(h,'day2-pm').querySelector('.f-programme-title').textContent,'Título editado');
 assert.equal(programmeSection(h).querySelectorAll('.f-programme-row').filter(row=>key(row,'pgEdited')).length,1,'only the edited block is marked');
 const title=blockRow(h,'day1-am').querySelector('.f-programme-title');assert.equal(title.lang,'es','block texts are the organisers’ Spanish');
 const edit=key(blockRow(h,'day1-am'),'pgEdit');assert.equal(edit['aria-describedby'],title.id);
 h.lang('es');assert.equal(time('closing-party'),'Desde las 17:00');assert.equal(time('day0-lab'),'Sin horario');assert.equal(key(blockRow(h,'closing-party'),'pgParty').textContent,'Fiesta');
 h.lang('pt');assert.equal(time('closing-party'),'A partir das 17:00');
});

test('Edit opens one form under the row with every field; the end time is optional only for the party, workshops and routes',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}));
 const form=await openBlock(h,'day1-am'),row=blockRow(h,'day1-am');
 assert.ok(form);assert.equal(key(row,'pgEdit').hidden,true,'the row’s Edit gives way to the form');assert.equal(field(form,'title').focused,true);
 assert.equal(field(form,'title').value,'El poder de lo local');assert.equal(field(form,'title').required,true);assert.equal(field(form,'title').maxLength,200);
 const date=field(form,'date');assert.equal(date.type,'date');assert.equal(date.value,'2026-10-21');assert.equal(date.min,'2026-10-20');assert.equal(date.max,'2026-10-25');
 const start=field(form,'start'),end=field(form,'end');assert.equal(start.type,'time');assert.equal(end.type,'time');assert.equal(start.value,'09:00');assert.equal(end.value,'13:00');
 assert.equal(end.required,true,'a conference block with a start needs an end');assert.ok(key(form,'pgTimeHintCheckin'));
 type(start,'');type(end,'');assert.equal(end.required,false,'or no time at all, untimed like the laboratory');assert.equal(start.required,false);
 type(end,'12:00');assert.equal(start.required,true,'an end needs a start');
 assert.equal(field(form,'venue').value,'Auditorio MALI, Cercado de Lima');assert.equal(field(form,'venue').maxLength,200);
 const description=field(form,'description');assert.equal(description.tagName,'textarea');assert.equal(description.maxLength,1500);
 type(description,'Línea uno\nLínea dos');assert.equal(form.querySelector('.f-counter').textContent,'19 / 1,500');assert.equal(description['aria-describedby'],form.querySelector('.f-counter').id);
 assert.equal(field(form,'formUrl'),undefined,'only workshops and routes carry a form link');assert.equal(key(form,'pgRestore'),undefined,'nothing to restore on an unedited block');
 assert.deepEqual(lineValues(form),EVENT.activities.find(activity=>activity.id==='day1-am').sessions);
 const party=await openBlock(h,'closing-party');assert.equal(blockForm(h,'day1-am'),null,'one form at a time');
 assert.equal(field(party,'start').value,'17:00');assert.equal(field(party,'end').value,'');assert.equal(field(party,'end').required,false,'the party may have a start only');assert.ok(key(party,'pgEndOptional'));assert.ok(key(party,'pgTimeHintFree'));
 const workshop=await openBlock(h,'workshop-calles-gente'),link=field(workshop,'formUrl');
 assert.equal(link.type,'url');assert.equal(link.required,true);assert.equal(link.value,EVENT.activities.find(activity=>activity.id==='workshop-calles-gente').formUrl);
 // Field ids are the block's own, so no two controls on the page share one.
 assert.ok(descendants(workshop).filter(node=>['input','textarea'].includes(node.tagName)).every(node=>node.id?.startsWith('f-pg-workshop-calles-gente-')));
});

test('schedule lines can be added up to twelve, removed and moved, each move keeping focus on the line’s own button',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}));
 const form=await openBlock(h,'day1-am'),lines=()=>form.querySelectorAll('.f-programme-line'),add=key(form,'pgAddLine');
 const [first,second,third]=EVENT.activities.find(activity=>activity.id==='day1-am').sessions;
 assert.equal(key(lines()[0],'pgMoveUp').disabled,true);assert.equal(key(lines()[2],'pgMoveDown').disabled,true);assert.equal(key(lines()[1],'pgMoveUp').disabled,false);
 assert.match(content(lines()[1].querySelector('.f-programme-line-label')),/Line\s+2/);assert.equal(lines()[1].role,'group');assert.equal(lines()[1]['aria-labelledby'],lines()[1].querySelector('.f-programme-line-label').id);
 const up=key(lines()[1],'pgMoveUp');up.listeners.click();
 assert.deepEqual(lineValues(form),[second,first,third]);assert.notEqual(up.focused,true,'the first line cannot move up: focus goes to its Move down');assert.equal(key(lines()[0],'pgMoveDown').focused,true);
 key(lines()[0],'pgMoveDown').listeners.click();assert.deepEqual(lineValues(form),[first,second,third]);
 key(lines()[1],'pgRemoveLine').listeners.click();assert.deepEqual(lineValues(form),[first,third]);assert.equal(field(lines()[1],'sessionTitle').focused,true,'focus moves to the next line');
 add.listeners.click();assert.equal(lines().length,3);assert.deepEqual(lineValues(form).at(-1),['','']);assert.equal(field(lines()[2],'sessionTime').focused,true);
 assert.equal(field(lines()[2],'sessionTime').maxLength,40);assert.equal(field(lines()[2],'sessionTitle').required,true);
 // A session title is offered as a question's talk in Conversations, which takes 180 characters, so the line takes no more; the refusal says so.
 assert.equal(field(lines()[2],'sessionTitle').maxLength,180);
 assert.ok(h.ctx.window.Fiiu.rows.pgInvalidSessions.every(text=>/\b180\b/.test(text)),'in every language');
 while(lines().length<12)add.listeners.click();assert.equal(add.disabled,true,'twelve lines at most');
 key(lines()[11],'pgRemoveLine').listeners.click();assert.equal(add.disabled,false);
 for(let i=lines().length;i>0;i--)key(lines()[0],'pgRemoveLine').listeners.click();assert.equal(lines().length,0);assert.equal(add.focused,true,'with no line left, focus goes to Add line');
});

test('Save sends every field with the version, says Changes saved, marks the row Edited, closes the form and updates the rest of the dashboard',async()=>{
 const h=await harness(request=>request.method==='PUT'?savedBlock(request):{content:[],nextCursor:null},{summaryRead:()=>({summary:copy(checkinSummary)})});
 const form=await openBlock(h,'day1-am');
 type(field(form,'title'),'El poder de lo local, renovado');type(field(form,'start'),'10:00');type(field(form,'end'),'14:00');type(field(form,'venue'),'Auditorio MALI');type(field(form,'description'),'Ingreso libre.\nTraer DNI.');
 type(field(form.querySelectorAll('.f-programme-line')[0],'sessionTime'),'10:00–11:00');
 await submit(form);
 const [put]=programmeWrites(h);assert.equal(put.method,'PUT');assert.equal(put.path,'/api/admin/fiiu/programme/day1-am');
 const [,second,third]=EVENT.activities.find(activity=>activity.id==='day1-am').sessions;
 assert.deepEqual(put.body,{title:'El poder de lo local, renovado',date:'2026-10-21',time:'10:00–14:00',venue:'Auditorio MALI',description:'Ingreso libre.\nTraer DNI.',sessions:[['10:00–11:00','¡Bienvenidos al FIIU 11!'],second,third],version:0});
 const row=blockRow(h,'day1-am');assert.equal(row.querySelector('form'),null,'the form closes');assert.equal(key(row,'pgEdit').hidden,false);assert.equal(key(row,'pgEdit').focused,true);
 assert.equal(row.querySelector('.f-inline-status').dataset.fiiuText,'changesSaved');assert.ok(key(row,'pgEdited'));
 assert.equal(row.querySelector('.f-programme-title').textContent,'El poder de lo local, renovado');assert.match(content(row.querySelector('.f-programme-time')),/10:00–14:00/);
 assert.match(content(h.root.querySelector('.f-admin-checkin')),/El poder de lo local, renovado/,'the check-in section names the block as saved');
 assert.match(content(h.root.querySelector('.f-admin-summary')),/El poder de lo local, renovado/,'and so do the totals');
 await openBlock(h,'day1-am');assert.equal(field(blockForm(h,'day1-am'),'title').value,'El poder de lo local, renovado','the form opens on the saved values');assert.ok(key(blockForm(h,'day1-am'),'pgRestore'));
 type(field(blockForm(h,'day1-am'),'venue'),'Otra sala');await submit(blockForm(h,'day1-am'));assert.equal(programmeWrites(h).at(-1).body.version,1,'the next save uses the saved version');
 // A workshop sends its form link; the party sends a start-only time.
 const workshop=await openBlock(h,'workshop-calles-gente');type(field(workshop,'formUrl'),'https://forms.gle/nuevo');await submit(workshop);
 assert.equal(programmeWrites(h).at(-1).body.formUrl,'https://forms.gle/nuevo');assert.equal(programmeWrites(h).at(-1).body.time,'');
 const party=await openBlock(h,'closing-party');type(field(party,'start'),'18:00');await submit(party);assert.equal(programmeWrites(h).at(-1).body.time,'18:00');assert.equal('formUrl' in programmeWrites(h).at(-1).body,false);
});

test('the browser stops a blank title, an end before its start, a lone end, a conference start without an end and a date outside the festival, and sends nothing',async()=>{
 const h=await harness(request=>request.method==='PUT'?savedBlock(request):{content:[],nextCursor:null});
 const form=await openBlock(h,'day1-am'),start=field(form,'start'),end=field(form,'end'),title=field(form,'title');
 type(title,'   ');await submit(form);assert.equal(title.validationMessage,'Answer this question to continue.');type(title,'Título');
 type(end,'08:00');await submit(form);assert.equal(end.validationMessage,'The end time must be after the start time.');
 type(end,'');await submit(form);assert.equal(end.validationMessage,'Add an end time, or leave both times empty.');
 type(start,'');type(end,'12:00');await submit(form);assert.equal(start.validationMessage,'Add a start time.');
 // A day typed outside the festival (a date's segments take any day; min and max only limit the picker) gets the date's own message. The browser
 // checks min and max before the submit handler runs: 'invalid' reaches the form first (its capture listener) and then the date, and the
 // bubble shows the message the date has after both. A change reaches the form, which drops every message.
 type(start,'09:00');type(end,'13:00');const date=field(form,'date');
 const invalid=validity=>{date.validity=validity;form.listeners.invalid({target:date});date.listeners.invalid?.({target:date});return date.validationMessage;};
 const change=value=>{type(date,value);form.listeners.input();};
 change('2026-10-26');assert.equal(invalid({rangeOverflow:true}),'Choose a date between 20 and 25 October.');await submit(form);
 change('2026-10-19');h.lang('es');assert.equal(invalid({rangeUnderflow:true}),'Elige una fecha entre el 20 y el 25 de octubre.');h.lang('en');
 change('');assert.equal(invalid({valueMissing:true}),'Answer this question to continue.','an empty date keeps the required message');
 assert.equal(programmeWrites(h).length,0);
 change('2026-10-21');date.validity={valid:true};type(start,'');type(end,'');await submit(form);assert.equal(programmeWrites(h).length,1,'no time at all is a valid untimed block');assert.equal(programmeWrites(h)[0].body.time,'');
});

test('each refusal code shows its own message beside the form and keeps everything typed',async()=>{
 let reply;const h=await harness(request=>request.method==='PUT'?reply:{content:[],nextCursor:null});
 const form=await openBlock(h,'day2-am'),note=blockRow(h,'day2-am').querySelector('.f-inline-status');type(field(form,'title'),'Título a medias');
 const codes={invalid_title:'pgInvalidTitle',invalid_date:'pgInvalidDate',invalid_time:'pgInvalidTime',invalid_venue:'pgInvalidVenue',invalid_description:'pgInvalidDescription',invalid_sessions:'pgInvalidSessions',invalid_form_url:'pgInvalidFormUrl'};
 for(const [code,shown] of Object.entries(codes)){
  reply={status:400,data:{error:code.replace(/_/g,' '),code}};await submit(form);
  assert.equal(note.dataset.fiiuText,shown,code);assert.equal(blockForm(h,'day2-am'),form,'the form stays open');assert.equal(field(form,'title').value,'Título a medias');assert.equal(field(form,'title').disabled,false);
 }
 reply={status:404,data:{error:'not found'}};await submit(form);assert.equal(note.dataset.fiiuText,'pgNotFound');
 h.lang('es');assert.equal(note.textContent,'Este bloque ya no está en el programa. Recarga la página.');
});

test('a conflict offers Reload the latest version, which takes the other organiser’s block but keeps the fields changed here',async()=>{
 let current=programmeItem(EVENT.activities.find(activity=>activity.id==='day2-am'));
 const h=await harness(request=>{
  if(request.method==='PUT'){if(request.body.version!==current.version)return{status:409,data:{error:'programme changed',code:'programme_conflict',activity:current}};return savedBlock(request);}
  return{content:[],nextCursor:null};
 },{programmeRead:()=>({activities:programmeItems().map(item=>item.id===current.id?copy(current):item)})});
 const form=await openBlock(h,'day2-am');type(field(form,'venue'),'Mi sede');type(field(form,'description'),'Mi descripción');
 // Another organiser saves the title and the venue meanwhile.
 current={...current,title:'Título de otra organizadora',venue:'Su sede',edited:true,version:2};
 await submit(form);const row=blockRow(h,'day2-am');assert.equal(row.querySelector('.f-inline-status').dataset.fiiuText,'editorConflict');
 const reads=programmeReads(h),reload=key(form,'reloadLatest');assert.ok(reload,'a conflict offers the latest version');await reload.listeners.click();
 assert.equal(programmeReads(h),reads+1,'only the programme is read again');
 const fresh=blockForm(h,'day2-am');assert.notEqual(fresh,form);
 assert.equal(field(fresh,'title').value,'Título de otra organizadora','a field changed only elsewhere takes the latest value');
 assert.equal(field(fresh,'venue').value,'Mi sede');assert.equal(field(fresh,'description').value,'Mi descripción','fields changed here are kept');
 const notes=fresh.querySelectorAll('.f-question-latest');assert.equal(notes.length,1,'the latest saved value is shown only where both changed');assert.match(content(notes[0]),/Su sede/);
 assert.ok(field(fresh,'venue')['aria-describedby'].split(' ').includes(notes[0].id));
 assert.equal(row.querySelector('.f-inline-status').dataset.fiiuText,'');assert.ok(key(row,'pgEdited'),'the row shows the other organiser’s save');assert.equal(leavePrompt(h),true,'the kept changes still guard leaving');
 await submit(fresh);assert.deepEqual({...programmeWrites(h).at(-1).body,sessions:undefined},{title:'Título de otra organizadora',date:'2026-10-22',time:'09:00–13:00',venue:'Mi sede',description:'Mi descripción',sessions:undefined,version:2});
 assert.equal(blockForm(h,'day2-am'),null);
});

test('after a conflict the two times stay together: a start or an end changed here keeps both, so the form never mixes them with the other organiser’s',async()=>{
 let current=programmeItem(EVENT.activities.find(activity=>activity.id==='day2-am'));
 const h=await harness(request=>{
  if(request.method==='PUT'){if(request.body.version!==current.version)return{status:409,data:{error:'programme changed',code:'programme_conflict',activity:current}};return savedBlock(request);}
  return{content:[],nextCursor:null};
 },{programmeRead:()=>({activities:programmeItems().map(item=>item.id===current.id?copy(current):item)})});
 const form=await openBlock(h,'day2-am');assert.equal(field(form,'start').value,'09:00');type(field(form,'end'),'14:00');
 // Another organiser moves the block to the afternoon meanwhile.
 current={...current,time:'15:00–19:00',edited:true,version:1};
 await submit(form);await key(form,'reloadLatest').listeners.click();
 const fresh=blockForm(h,'day2-am');
 assert.deepEqual([field(fresh,'start').value,field(fresh,'end').value],['09:00','14:00'],'the time typed here, whole: never 15:00–14:00, which nobody chose');
 const notes=fresh.querySelectorAll('.f-question-latest');assert.equal(notes.length,1,'the other organiser’s time is shown to compare');assert.match(content(notes[0]),/15:00–19:00/);
 assert.ok(field(fresh,'start')['aria-describedby'].split(' ').includes(notes[0].id));assert.ok(field(fresh,'end')['aria-describedby'].split(' ').includes(notes[0].id));
 await submit(fresh);assert.equal(programmeWrites(h).at(-1).body.time,'09:00–14:00');assert.equal(programmeWrites(h).at(-1).body.version,1);assert.equal(blockForm(h,'day2-am'),null,'saved, not blocked by an end before its start');
});

test('a saved block’s new title and date reach every block picker on the page: the participant filter, the new question’s and the publication editor’s',async()=>{
 const h=await harness(request=>request.method==='PUT'?savedBlock(request):{content:[],nextCursor:null});
 const pickers=()=>[field(h.root.querySelector('.f-admin-filters'),'participantBlock'),field(questionForm(h),'activityId'),field(editorForm(h),'activityId')];
 const label=select=>select.children.find(option=>option.value==='day1-am')?.textContent;
 assert.deepEqual(pickers().map(label),Array(3).fill('21/10 · El poder de lo local'));
 const form=await openBlock(h,'day1-am');type(field(form,'title'),'El poder de lo local, renovado');type(field(form,'date'),'2026-10-22');await submit(form);
 assert.deepEqual(pickers().map(label),Array(3).fill('22/10 · El poder de lo local, renovado'));
});

test('Restore original asks first, sends DELETE with the version and shows the built-in values',async()=>{
 const built=EVENT.activities.find(activity=>activity.id==='day1-pm');let asked=0,answer=false;
 const h=await harness(request=>request.method==='DELETE'?{activity:programmeItem(built)}:{content:[],nextCursor:null},{programmeRead:()=>({activities:programmeItems({'day1-pm':{title:'Título editado',venue:'Otra sede',edited:true,version:3}})})});
 h.ctx.window.confirm=message=>{asked++;assert.equal(message,h.ctx.window.Fiiu.t('pgRestoreConfirm'));return answer;};
 const form=await openBlock(h,'day1-pm'),restore=key(form,'pgRestore');assert.ok(restore);
 await restore.listeners.click();assert.equal(asked,1);assert.equal(programmeWrites(h).length,0,'declining sends nothing');assert.equal(blockForm(h,'day1-pm'),form);
 answer=true;await restore.listeners.click();
 assert.deepEqual(programmeWrites(h).map(({method,path})=>[method,path]),[['DELETE','/api/admin/fiiu/programme/day1-pm?version=3']]);
 const row=blockRow(h,'day1-pm');assert.equal(row.querySelector('form'),null);assert.equal(key(row,'pgEdited'),undefined);assert.equal(row.querySelector('.f-programme-title').textContent,built.title);
 assert.equal(row.querySelector('.f-inline-status').dataset.fiiuText,'pgRestored');
 const again=await openBlock(h,'day1-pm');assert.equal(field(again,'venue').value,built.venue);assert.equal(key(again,'pgRestore'),undefined);
});

test('a block with check-ins warns that hours follow a new date or time, and a block whose day has started warns that its check-in moves',async()=>{
 // The totals agree with the programme read: whichever lands last gives the block its count.
 const h=await harness(()=>({content:[],nextCursor:null}),{programmeRead:()=>({activities:programmeItems({'day1-am':{checkedIn:12},'closing-party':{checkedIn:0}})}),summaryRead:()=>({summary:{...copy(summary),activities:[{activityId:'day1-am',registrations:121,externalInterests:0,attendance:12}]}}),context:festivalDay});
 const form=await openBlock(h,'day1-am'),warnings=form.querySelectorAll('.f-programme-warning'),shown=()=>warnings.filter(node=>!node.hidden).map(node=>node.dataset.fiiuText||node.textContent);
 assert.deepEqual(shown(),[],'no warning before a change');
 type(field(form,'venue'),'Otra sala');assert.deepEqual(shown(),[],'a venue change moves nothing');
 type(field(form,'end'),'14:00');
 assert.deepEqual(shown(),['12 people have checked in to this block. Their certificate hours will follow the new time.','pgWindowWarning']);
 assert.equal(form.querySelector('.f-programme-warnings')['aria-live'],'polite');
 h.lang('es');assert.equal(shown()[0],'12 personas registraron su asistencia en este bloque. Sus horas del certificado seguirán el nuevo horario.');h.lang('en');
 type(field(form,'end'),'13:00');assert.deepEqual(shown(),[],'back as saved, no warning');
 type(field(form,'date'),'2026-10-22');assert.equal(shown().length,2,'a new date warns too');
 const later=await openBlock(h,'day3-am');type(field(later,'end'),'12:00');assert.deepEqual(later.querySelectorAll('.f-programme-warning').filter(node=>!node.hidden),[],'a later block with no check-ins moves without a warning');
 const party=await openBlock(h,'closing-party');type(field(party,'start'),'18:00');assert.deepEqual(party.querySelectorAll('.f-programme-warning').filter(node=>!node.hidden),[],'the party takes no check-in');
});

test('the hours warning counts check-ins made after the page loaded: each totals refresh updates it, under an open form too, and a save brings the block’s own count',async()=>{
 let attended=0;const totals=()=>({summary:{...copy(summary),activities:[{activityId:'day1-am',registrations:121,externalInterests:0,attendance:attended}]}});
 const h=await harness(request=>request.method==='PUT'?{activity:{...savedBlock(request).activity,checkedIn:9}}:{content:[],nextCursor:null},{summaryRead:totals});
 const hours=form=>form.querySelector('.f-programme-warning');
 let form=await openBlock(h,'day1-am');type(field(form,'end'),'14:00');assert.equal(hours(form).hidden,true,'nobody has checked in when the page loads');
 // People check in by QR while the form is open; the minute refresh brings the totals.
 attended=3;await h.tickTimers();await flush();
 assert.equal(hours(form).hidden,false);assert.equal(hours(form).textContent,'3 people have checked in to this block. Their certificate hours will follow the new time.');
 await key(form,'pgCancel').listeners.click();form=await openBlock(h,'day1-am');type(field(form,'end'),'14:00');assert.match(hours(form).textContent,/^3 people/,'a form opened later starts from the latest totals');
 // A save answers with the block's count at that moment, newer than the last totals.
 type(field(form,'end'),'13:00');type(field(form,'venue'),'Otra sala');await submit(form);
 form=await openBlock(h,'day1-am');type(field(form,'end'),'14:00');assert.match(hours(form).textContent,/^9 people/);
 // An unticked attendance lowers it again with the next totals.
 attended=0;await h.tickTimers();await flush();assert.equal(hours(form).hidden,true);
});

test('opening another block with unsaved changes asks first, Cancel closes the form, and leaving the page with changes asks too',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}));let asked=0,answer=false;h.ctx.window.confirm=message=>{asked++;assert.equal(message,h.ctx.window.Fiiu.t('pgDiscard'));return answer;};
 let form=await openBlock(h,'day1-am');assert.equal(leavePrompt(h),false,'an unchanged form lets the page go');
 await openBlock(h,'day1-pm');assert.equal(asked,0,'an unchanged form is replaced without asking');assert.equal(blockForm(h,'day1-am'),null);
 await key(blockForm(h,'day1-pm'),'pgCancel').listeners.click();assert.equal(blockForm(h,'day1-pm'),null);assert.equal(key(blockRow(h,'day1-pm'),'pgEdit').focused,true);
 form=await openBlock(h,'day1-am');type(field(form,'title'),'Cambio sin guardar');assert.equal(leavePrompt(h),true);
 await openBlock(h,'day1-pm');assert.equal(asked,1);assert.equal(blockForm(h,'day1-am'),form,'declining keeps the unsaved form');assert.equal(field(form,'title').value,'Cambio sin guardar');assert.equal(blockForm(h,'day1-pm'),null);
 answer=true;await openBlock(h,'day1-pm');assert.equal(asked,2);assert.equal(blockForm(h,'day1-am'),null);assert.ok(blockForm(h,'day1-pm'));assert.equal(leavePrompt(h),false);
});

test('an unavailable programme read leaves the dashboard working and offers a retry in the section, which hands focus to the heading once it works',async()=>{
 let fail=true;const h=await harness(()=>({content:[],nextCursor:null}),{programmeRead:()=>fail?unavailable:{activities:programmeItems()}});
 const section=programmeSection(h);assert.ok(key(section,'pgLoadError'));assert.equal(section.querySelectorAll('.f-programme-row').length,0);
 assert.equal(h.message.dataset.fiiuText,'','the page toast is not used');assert.ok(h.root.querySelector('.f-admin-summary'));assert.ok(questionForm(h));
 // Anything malformed reads as a failed read.
 const odd=await harness(()=>({content:[],nextCursor:null}),{programmeRead:()=>({activities:[{id:'day1-am'}]})});assert.ok(key(programmeSection(odd),'pgLoadError'));
 // So does a block whose fields the form could not open on: a schedule line that is not a time and a title, a venue or a description that is not text.
 for(const over of [{sessions:[null]},{sessions:[['09:00']]},{sessions:[['09:00',3]]},{sessions:[['09:00','Charla','extra']]},{venue:null},{description:5}]){
  const bad=await harness(()=>({content:[],nextCursor:null}),{programmeRead:()=>({activities:programmeItems({'day1-am':over})})});
  assert.ok(key(programmeSection(bad),'pgLoadError'),JSON.stringify(over));assert.equal(programmeSection(bad).querySelectorAll('.f-programme-row').length,0,JSON.stringify(over));
 }
 // A block without a description (an older server) still opens.
 const plain=await harness(()=>({content:[],nextCursor:null}),{programmeRead:()=>({activities:programmeItems().map(({description,...item})=>item)})});
 assert.equal(key(programmeSection(plain),'pgLoadError'),undefined);assert.equal(field(await openBlock(plain,'day1-am'),'description').value,'');
 fail=false;await key(section,'retry').listeners.click();
 assert.equal(key(section,'pgLoadError'),undefined);assert.equal(section.querySelectorAll('.f-programme-row').length,EVENT.activities.length);
 // Try again leaves with the alert, so focus goes to the section's heading instead of falling to the page.
 const heading=section.querySelector('h2');assert.equal(heading.id,'f-h-programme');assert.equal(heading.focused,true);assert.equal(heading.tabIndex,-1);
});

test('losing organiser access empties the Programme section and stops guarding its unsaved form',async()=>{
 let deny=false;const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>deny?{status:403,data:{error:'administrator access required'}}:{summary:copy(summary)}});
 const form=await openBlock(h,'day1-am');type(field(form,'title'),'Sin guardar');deny=true;await h.tickTimers();await flush();
 assert.ok(key(h.root,'organisersOnly'));assert.equal(programmeSection(h),null);assert.equal(h.root.querySelector('.f-programme-row'),null);assert.equal(leavePrompt(h),false);
});

test('the check-in section leaves out the party, which takes no check-in',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>({summary:copy(checkinSummary)}),context:festivalDay});
 const links=h.root.querySelector('.f-admin-checkin').querySelectorAll('a').filter(a=>a.dataset.fiiuText==='openCheckinScreen');
 assert.equal(links.some(a=>a.href.includes('closing-party')),false);assert.doesNotMatch(content(h.root.querySelector('.f-admin-checkin')),/Fiesta de cierre/);
});

test('the organiser CSS is the stylesheet’s last block: 44px touch targets, and no fixed width that would push a 360px phone sideways',()=>{
 const css=readFileSync(new URL('../web/styles/fiiu.css',import.meta.url),'utf8'),marker='/* Organiser: programme, party announcement, ratings */',at=css.indexOf(marker);
 assert.ok(at>0);assert.equal(css.indexOf(marker,at+1),-1,'one block');const block=css.slice(at);
 assert.match(block,/@media\(pointer:coarse\)\{\.f-shell :is\(\.f-line-button,\.f-programme-restore,\.f-party-notice \.f-backfill-link[^)]*\)\{min-height:44px;min-width:44px;text-align:center\}/,'44px wide too: Subir and Bajar are narrower than that');
 // One programme link is left in the settings, so the links fieldset is one column on wide screens instead of half of two.
 assert.match(block,/@media\(min-width:1000px\)\{\.f-admin-settings \.f-links\{grid-template-columns:minmax\(0,1fr\);max-width:\d+px\}\}/);
 // Widths that only apply past a breakpoint, caps (max-width) and tracks clamped to the column (min(100%,…)) never widen a phone page.
 const loose=block.replace(/@media\([^)]*\)/g,'').replace(/min\(100%,\d+px\)/g,'').replace(/max-width:\d+px/g,'');
 assert.doesNotMatch(loose,/(?:min-width|[{;]width|flex-basis|grid-template-columns|inline-size)\s*:[^;}]*\b\d{3,}px/,'no fixed width of 100px or more');assert.doesNotMatch(block,/border-left:\s*[3-9]px/,'no thick left accent bar');
});

// The party announcement (GET and POST /api/admin/fiiu/notices/closing-party), under the party's row in the Programme section: the summary-email
// controller, given the announcement's endpoint and wording.
const NOTICES='/api/admin/fiiu/notices/closing-party';
const noticeBlock=h=>blockRow(h,'closing-party')?.querySelector('.f-party-notice');
const noticeLine=h=>noticeBlock(h).querySelector('.f-backfill-line').textContent;
const noticeNote=h=>noticeBlock(h).querySelector('.f-backfill-note').textContent;
const noticeButtons=h=>noticeBlock(h).querySelectorAll('button');
const noticeAction=(h,name)=>noticeButtons(h).find(b=>b.dataset.action===name);
const pressNotice=async(h,name)=>{const b=noticeAction(h,name);assert.ok(b,`no ${name} button`);b.listeners.click();await flush();};
const noticePosts=h=>h.requests.filter(r=>r.path===NOTICES&&r.method==='POST');
const noticeBatch=(over={})=>({sent:0,failed:0,uncertain:0,skipped:0,claimedElsewhere:0,next:null,dailyCap:150,sentToday:0,resetsAt:'2026-10-03T00:00:00.000Z',counts:noticeCounts(),...over});
const NOTICE_KEYS=['noticeTitle','noticeHint','noticeWaitingOne','noticeWaitingMany','noticeNoneWaiting','noticeLeftOne','noticeLeftMany','noticeSendOne','noticeSendMany','noticeConfirmHint','noticeCap','noticeOff','noticeLoadError'];

test('under the party’s row, Announce the party says who is waiting, how many went out and how many are left today, in three languages',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{noticesRead:()=>noticeState({counts:noticeCounts({waiting:120,sent:30,failed:2}),sentToday:40})});
 const block=noticeBlock(h),row=blockRow(h,'closing-party');assert.ok(block);assert.ok(row.children.includes(block),'directly in the party’s row');
 assert.equal(programmeSection(h).querySelectorAll('.f-party-notice').length,1,'no other block has one');
 assert.ok(key(block,'noticeTitle'));assert.equal(key(block,'noticeTitle').tagName,'h4','a part of its day, whose heading is an h3');assert.equal(programmeSection(h).querySelector('.f-programme-date').tagName,'h3');
 assert.equal(h.root.querySelector('.f-admin-settings').querySelector('.f-backfill').querySelector('h3').dataset.fiiuText,'backfillTitle','the summary emails keep their h3 under the settings’ h2');
 assert.equal(key(block,'noticeHint').hidden,false);assert.equal(block.role,'group');assert.equal(block['aria-labelledby'],key(block,'noticeTitle').id);
 assert.equal(noticeLine(h),'120 registrants have not added the party · 30 sent · 2 failed · 110 left today');assert.equal(noticeNote(h),'');
 assert.deepEqual(noticeButtons(h).map(b=>[b.dataset.action,b.textContent,b.className]),[['send','Announce the party to 120 people','f-button'],['retry','Retry failed (2)','f-backfill-link']]);
 h.lang('es');assert.equal(noticeLine(h),'120 personas inscritas no han añadido la fiesta · 30 enviados · 2 con error · quedan 110 hoy');assert.equal(noticeAction(h,'send').textContent,'Anunciar la fiesta a 120 personas');
 h.lang('pt');assert.equal(noticeLine(h),'120 pessoas inscritas não adicionaram a festa · 30 enviados · 2 com erro · restam 110 hoje');
 const rows=h.ctx.window.Fiiu.rows;for(const name of NOTICE_KEYS){assert.equal(rows[name]?.length,3,name);assert.ok(rows[name].every(text=>typeof text==='string'&&text.trim()),name);}
 h.lang('en');const one=await harness(()=>({content:[],nextCursor:null}),{noticesRead:()=>noticeState({counts:noticeCounts({waiting:1,sent:1}),sentToday:149})});
 assert.equal(noticeLine(one),'1 registrant has not added the party · 1 sent · 1 left today');assert.equal(noticeAction(one,'send').textContent,'Announce the party to 1 person');
 const none=await harness(()=>({content:[],nextCursor:null}),{noticesRead:()=>noticeState({counts:noticeCounts({sent:80,skipped:2}),sentToday:80})});
 assert.equal(noticeLine(none),'Nobody is waiting for the announcement · 80 sent · 2 test addresses skipped · 70 left today');assert.equal(noticeButtons(none).length,0);
 // The summary emails keep their own block, under the settings.
 assert.ok(h.root.querySelector('.f-admin-settings').children.includes(h.root.querySelector('.f-backfill')));
});

test('announcing asks first with the number waiting, then sends batch after batch from the previous cursor until there is no next one',async()=>{
 let state=noticeState({counts:noticeCounts({waiting:6})});const second=deferred();
 const h=await harness(request=>{
  if(request.path!==NOTICES)return{content:[],nextCursor:null};
  if(noticePosts(h).length===1)return noticeBatch({sent:4,next:'reg-4',sentToday:4,counts:noticeCounts({waiting:2,sent:4})});
  return second.promise;
 },{noticesRead:()=>state});
 let asked=0;h.ctx.window.confirm=()=>{asked++;return true;};
 await pressNotice(h,'send');
 assert.equal(noticePosts(h).length,0,'the first press only asks');assert.equal(asked,0,'in the page, not a browser dialog');
 assert.equal(noticeNote(h),'The announcement goes out now, a few emails at a time. You can stop at any time.');
 const confirm=noticeAction(h,'confirm');assert.equal(confirm.textContent,'Confirm: send 6 emails');assert.equal(confirm.focused,true);assert.ok(noticeAction(h,'cancel'));
 confirm.listeners.click();confirm.listeners.click();await flush();
 assert.equal(noticeNote(h),'Sent 4 of 6…');assert.equal(noticeAction(h,'stop').focused,true);
 assert.equal(noticeLine(h),'2 registrants have not added the party · 4 sent · 146 left today','the counts follow each batch');
 assert.deepEqual(noticePosts(h).map(r=>r.body),[{retryFailed:false},{retryFailed:false,after:'reg-4'}],'one pass despite the double click, the second batch after the first one’s cursor');
 state=noticeState({counts:noticeCounts({sent:5,failed:1}),sentToday:6});
 second.resolve(noticeBatch({sent:1,failed:1,next:null,sentToday:6,counts:noticeCounts({sent:5,failed:1})}));await flush();
 assert.equal(noticePosts(h).length,2,'no next cursor: the pass is done');assert.equal(noticeNote(h),'Sent 5 · Failed 1 — you can retry the failed ones');
 assert.equal(noticeLine(h),'Nobody is waiting for the announcement · 5 sent · 1 failed · 144 left today');assert.deepEqual(noticeButtons(h).map(b=>b.dataset.action),['retry']);
 assert.equal(h.requests.some(r=>r.path==='/api/admin/fiiu/confirmations'&&r.method==='POST'),false,'the summary emails are untouched');
});

test('Send asks the server again before Confirm, so the number confirmed is the number waiting now, with today’s cap as it stands',async()=>{
 let state=noticeState({counts:noticeCounts({waiting:3})});
 const h=await harness(request=>request.path===NOTICES?noticeBatch({sent:4,next:null,sentToday:14,counts:noticeCounts({sent:4})}):{content:[],nextCursor:null},{noticesRead:()=>state});
 const reads=()=>h.requests.filter(r=>r.path===NOTICES&&r.method==='GET').length,before=reads();
 assert.equal(noticeAction(h,'send').textContent,'Announce the party to 3 people');
 // A fourth person registers without the party, and sign-up emails use some of today's cap, after the page loaded.
 state=noticeState({counts:noticeCounts({waiting:4}),sentToday:10});
 await pressNotice(h,'send');assert.equal(reads(),before+1);
 assert.equal(noticeAction(h,'confirm').textContent,'Confirm: send 4 emails');assert.equal(noticeAction(h,'confirm').focused,true);
 assert.equal(noticeLine(h),'4 registrants have not added the party · 0 sent · 140 left today');
 await pressNotice(h,'confirm');assert.equal(noticeNote(h),'Sent 4 · Failed 0');
 // Nobody left to email by the press: nothing to confirm. At the cap: its message, nothing to confirm.
 state=noticeState({counts:noticeCounts({waiting:2})});const gone=await harness(()=>({content:[],nextCursor:null}),{noticesRead:()=>state});
 state=noticeState({counts:noticeCounts({sent:2})});await pressNotice(gone,'send');assert.equal(noticeAction(gone,'confirm'),undefined);assert.equal(noticeButtons(gone).length,0);assert.match(noticeLine(gone),/^Nobody is waiting/);
 state=noticeState({counts:noticeCounts({waiting:2})});const full=await harness(()=>({content:[],nextCursor:null}),{noticesRead:()=>state});
 state=noticeState({counts:noticeCounts({waiting:2}),sentToday:150});await pressNotice(full,'send');assert.equal(noticeAction(full,'confirm'),undefined);assert.match(noticeNote(full),/^Today’s limit of 150 emails is reached/);
 // A failed read says so and asks nothing; Send stays to try again.
 state=noticeState({counts:noticeCounts({waiting:2})});const flaky=await harness(()=>({content:[],nextCursor:null}),{noticesRead:()=>state});
 state=unavailable;await pressNotice(flaky,'send');assert.equal(noticeAction(flaky,'confirm'),undefined);assert.equal(noticeNote(flaky),'The announcement status could not be loaded.');assert.ok(noticeAction(flaky,'send'));
 assert.equal(noticeBlock(flaky)['aria-busy'],'false');
 // A second press while the read is out reads once. Meanwhile the block says it is reading (a language switch keeps that), so a slow read does
 // not look like a press that did nothing and invite more presses, which could land on Confirm once it appears.
 const read=deferred();state=read.promise;const slow=flaky,count=()=>slow.requests.filter(r=>r.path===NOTICES&&r.method==='GET').length,at=count();
 noticeAction(slow,'send').listeners.click();noticeAction(slow,'send').listeners.click();await flush();assert.equal(count(),at+1);
 assert.equal(noticeNote(slow),'Loading…');assert.equal(noticeBlock(slow)['aria-busy'],'true');assert.equal(noticeAction(slow,'confirm'),undefined);
 slow.lang('es');assert.equal(noticeNote(slow),'Cargando…');slow.lang('pt');assert.equal(noticeNote(slow),'Carregando…');slow.lang('en');
 read.resolve(noticeState({counts:noticeCounts({waiting:5})}));await flush();assert.equal(noticeAction(slow,'confirm').textContent,'Confirm: send 5 emails');assert.equal(noticeNote(slow),'The announcement goes out now, a few emails at a time. You can stop at any time.');
 assert.equal(noticeBlock(slow)['aria-busy'],'false');
 // A read that finds nobody waiting leaves no Loading… behind.
 assert.equal(noticeNote(gone),'');assert.equal(noticeBlock(gone)['aria-busy'],'false');
 // Retry failed and the summary emails, which share the controller, read again too.
 let summaryState=emailState({counts:emailCounts({none:2,failed:1})});const both=await harness(()=>({content:[],nextCursor:null}),{confirmationsRead:()=>summaryState});
 summaryState=emailState({counts:emailCounts({none:7,failed:3})});await press(both,'retry');assert.equal(backfillAction(both,'confirm').textContent,'Confirm: send 3 emails');
 await press(both,'cancel');await press(both,'send');assert.equal(backfillAction(both,'confirm').textContent,'Confirm: send 7 emails');
});

test('Stop ends the announcement after the batch in flight, Cancel sends nothing, and Retry failed resends only the failed ones',async()=>{
 let state=noticeState({counts:noticeCounts({waiting:10})});const first=deferred();
 const h=await harness(request=>request.path===NOTICES?first.promise:{content:[],nextCursor:null},{noticesRead:()=>state});
 await pressNotice(h,'send');await pressNotice(h,'cancel');assert.equal(noticePosts(h).length,0);assert.equal(noticeAction(h,'send').focused,true);
 await pressNotice(h,'send');await pressNotice(h,'confirm');assert.equal(noticeNote(h),'Sent 0 of 10…');
 await pressNotice(h,'stop');assert.equal(noticeNote(h),'Sent 0 of 10 — stopping after this batch…');
 state=noticeState({counts:noticeCounts({waiting:6,sent:4}),sentToday:4});first.resolve(noticeBatch({sent:4,next:'reg-4',sentToday:4,counts:noticeCounts({waiting:6,sent:4})}));await flush();
 assert.equal(noticePosts(h).length,1,'nothing after Stop');assert.equal(noticeNote(h),'Stopped. Sent 4 · Failed 0');assert.equal(noticeAction(h,'send').textContent,'Announce the party to 6 people');
 let retried=noticeState({counts:noticeCounts({sent:9,failed:2})});
 const r=await harness(request=>{if(request.path!==NOTICES)return{content:[],nextCursor:null};retried=noticeState({counts:noticeCounts({sent:11})});return noticeBatch({sent:2,next:null,sentToday:11,counts:noticeCounts({sent:11})});},{noticesRead:()=>retried});
 assert.deepEqual(noticeButtons(r).map(b=>b.dataset.action),['retry']);await pressNotice(r,'retry');assert.equal(noticeAction(r,'confirm').textContent,'Confirm: send 2 emails');
 await pressNotice(r,'confirm');assert.deepEqual(noticePosts(r).map(request=>request.body),[{retryFailed:true}]);assert.equal(noticeNote(r),'Sent 2 · Failed 0');assert.equal(noticeButtons(r).length,0);
});

test('the announcement reports the shared daily cap with its reset time, email turned off, a failed read and a lost organiser role',async()=>{
 const capped=await harness(()=>({content:[],nextCursor:null}),{noticesRead:()=>noticeState({counts:noticeCounts({waiting:5,sent:20}),sentToday:150})});
 assert.equal(noticeButtons(capped).length,0);assert.equal(noticeNote(capped),'Today’s limit of 150 emails is reached (summary and sign-up emails included). Sending can continue after 19:00 Lima time.');
 assert.match(noticeLine(capped),/· 0 left today$/);
 let state=noticeState({counts:noticeCounts({waiting:8})});
 const h=await harness(request=>{if(request.path!==NOTICES)return{content:[],nextCursor:null};state=noticeState({counts:noticeCounts({waiting:8}),sentToday:150});return{status:429,data:{error:'daily email limit reached',code:'daily_cap',dailyCap:150,sentToday:150,resetsAt:'2026-10-03T00:00:00.000Z',counts:noticeCounts({waiting:8})}};},{noticesRead:()=>state});
 await pressNotice(h,'send');await pressNotice(h,'confirm');
 assert.match(noticeNote(h),/^Today’s limit of 150 emails is reached/);assert.equal(noticeAction(h,'send'),undefined,'no button until the cap resets');
 // Sending was switched off after the page loaded: the POST says so, and so does the state read after it.
 let configured=true;const off=await harness(request=>{if(request.path!==NOTICES)return{content:[],nextCursor:null};configured=false;return{status:503,data:{error:'email is not configured',code:'email_not_configured'}};},{noticesRead:()=>noticeState({configured,counts:noticeCounts({waiting:3})})});
 await pressNotice(off,'send');await pressNotice(off,'confirm');assert.match(noticeLine(off),/^Emails are off, so the announcement cannot be sent\./);assert.equal(noticeButtons(off).length,0);assert.equal(key(noticeBlock(off),'noticeHint').hidden,true);
 const unset=await harness(()=>({content:[],nextCursor:null}),{noticesRead:()=>noticeState({configured:false,counts:noticeCounts({waiting:3})})});assert.match(noticeLine(unset),/^Emails are off/);assert.equal(noticeButtons(unset).length,0);
 let fail=true;const failed=await harness(()=>({content:[],nextCursor:null}),{noticesRead:()=>fail?unavailable:noticeState({counts:noticeCounts({waiting:2})})});
 assert.equal(noticeLine(failed),'The announcement status could not be loaded.');assert.equal(content(failed.message).trim(),'');
 fail=false;await pressNotice(failed,'reload');assert.equal(noticeLine(failed),'2 registrants have not added the party · 0 sent · 150 left today');
 const odd=await harness(()=>({content:[],nextCursor:null}),{noticesRead:()=>({configured:true,counts:{waiting:'2'}})});assert.equal(noticeLine(odd),'The announcement status could not be loaded.','anything malformed reads as a failed read');
 const lost=await harness(request=>request.path===NOTICES?{status:403,data:{error:'administrator access required'}}:{content:[],nextCursor:null},{noticesRead:()=>noticeState({counts:noticeCounts({waiting:3})})});
 await pressNotice(lost,'send');await pressNotice(lost,'confirm');assert.ok(key(lost.root,'organisersOnly'));assert.equal(lost.root.querySelector('.f-party-notice'),null);
});

test('a batch that sends some emails and then reaches the shared daily cap counts them in the pass’s report, for the announcement and the summary emails',async()=>{
 // The 429 keeps its cap fields and adds the batch's own outcomes.
 const capped=(counts,outcome)=>({status:429,data:{error:'daily email limit reached',code:'daily_cap',dailyCap:150,sentToday:150,resetsAt:'2026-10-03T00:00:00.000Z',counts,sent:0,failed:0,uncertain:0,skipped:0,claimedElsewhere:0,...outcome}});
 let state=noticeState({counts:noticeCounts({waiting:6}),sentToday:146});
 const h=await harness(request=>{if(request.path!==NOTICES)return{content:[],nextCursor:null};state=noticeState({counts:noticeCounts({waiting:2,sent:3,failed:1}),sentToday:150});return capped(noticeCounts({waiting:2,sent:3,failed:1}),{sent:3,failed:1});},{noticesRead:()=>state});
 await pressNotice(h,'send');await pressNotice(h,'confirm');
 assert.equal(noticeNote(h),'Sent 3 · Failed 1. Today’s limit of 150 emails is reached (summary and sign-up emails included). Sending can continue after 19:00 Lima time.','the first batch’s emails are in the report');
 assert.equal(noticeAction(h,'send'),undefined,'no button until the cap resets');
 // Summary emails: a full batch, then one that met the cap after two.
 let summaryState=emailState({counts:emailCounts({none:8})}),calls=0;
 const s=await harness(request=>{
  if(request.path!=='/api/admin/fiiu/confirmations')return{content:[],nextCursor:null};
  if(++calls===1)return batch({sent:4,remaining:4,next:'id-4',sentToday:146,counts:emailCounts({none:4,sent:4})});
  summaryState=emailState({counts:emailCounts({none:2,sent:6}),sentToday:150});return capped(emailCounts({none:2,sent:6}),{sent:2,uncertain:1});
 },{confirmationsRead:()=>summaryState});
 await press(s,'send');await press(s,'confirm');
 assert.equal(backfillNote(s),'Sent 6 · Failed 0 · 1 may not have arrived. Today’s limit of 150 emails is reached (sign-up emails and the party announcement included). Sending can continue after 19:00 Lima time.');
 // An answer without the numbers, or with malformed ones, adds nothing.
 for(const outcome of [{sent:undefined},{sent:'3'},{failed:-1}]){
  state=noticeState({counts:noticeCounts({waiting:6})});
  const odd=await harness(request=>request.path===NOTICES?capped(noticeCounts({waiting:6}),{sent:3,...outcome}):{content:[],nextCursor:null},{noticesRead:()=>state});
  await pressNotice(odd,'send');await pressNotice(odd,'confirm');assert.match(noticeNote(odd),/^Today’s limit of 150 emails is reached/,JSON.stringify(outcome));
 }
});

test('a finished pass re-reads the other email block, since summary emails and the announcement share the daily cap',async()=>{
 const h=await harness(request=>{
  if(request.path===NOTICES)return noticeBatch({sent:3,next:null,sentToday:3,counts:noticeCounts({sent:3})});
  if(request.path==='/api/admin/fiiu/confirmations')return batch({sent:2,remaining:0,next:null,sentToday:5,counts:emailCounts({sent:2})});
  return{content:[],nextCursor:null};
 },{noticesRead:()=>noticeState({counts:noticeCounts({waiting:3})}),confirmationsRead:()=>emailState({counts:emailCounts({none:2})})});
 // Send reads its own block again before Confirm (see above); the reads counted here are the ones after the pass.
 const reads=path=>h.requests.filter(r=>r.path===path&&r.method==='GET').length;
 await pressNotice(h,'send');const summaryReads=reads('/api/admin/fiiu/confirmations'),noticeReads=reads(NOTICES);
 await pressNotice(h,'confirm');assert.equal(reads('/api/admin/fiiu/confirmations'),summaryReads+1,'the summary block learns the new count');assert.equal(reads(NOTICES),noticeReads+1);
 await press(h,'send');const after=reads(NOTICES);await press(h,'confirm');assert.equal(reads(NOTICES),after+1,'and the other way round');
});

// General and rating questions: activityId 'general' is accepted wherever a block id is; question views carry kind ('chat' or 'rating') and, for
// ratings, ratingCounts (ten totals, index 0 for a score of 1).
const RATING_ID='dddddddd-dddd-4ddd-8ddd-ddddddddddd4';
const rating=(over={})=>question({id:RATING_ID,activityId:'general',talk:null,body:'¿Cómo calificas el FIIU 11?',kind:'rating',ratingCounts:[0,0,0,0,1,0,2,3,0,4],stats:{messages:2,people:2,likes:0},...over});
const C4_KEYS=['questionGeneral','questionKind','questionKindChat','questionKindRating','questionKindHint','questionKindLocked','ratingAverage','ratingPeopleOne','ratingPeopleMany','ratingNone','ratingBars','ratingBarOne','ratingBarMany','ratingCsv','blocksAndParty','filterBlock','filterAllBlocks'];

test('the block picker starts with General (whole festival), which has no talks, and General questions come first under their own heading',async()=>{
 const saved=[];
 const h=await harness(({method,path,body})=>{
  if(path==='/api/admin/fiiu/questions'&&method==='POST'){saved.push(body);return{status:201,data:{question:{...body,revision:0,messageCount:0,createdAt:'2026-10-13T15:00:00.000Z',version:1}}};}
  return{content:[],nextCursor:null};
 },{questionsRead:()=>({questions:[question(),question({id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',activityId:'general',talk:null,body:'¿Qué barrio te inspira?'})]})});
 const form=questionForm(h),block=field(form,'activityId'),general=block.children[1];
 assert.equal(general.value,'general');assert.equal(general.dataset.fiiuText,'questionGeneral');assert.equal(general.textContent,'General (whole festival)');
 await select(block,'general');assert.equal(field(form,'talk').parent.hidden,true,'the whole festival has no talks');
 type(field(form,'body'),'¿Qué te llevas del festival?');await key(form,'publishNow').listeners.click();
 assert.deepEqual({...saved[0],id:undefined},{id:undefined,activityId:'general',kind:'chat',talk:null,body:'¿Qué te llevas del festival?',status:'open'});
 const groups=conversations(h).querySelectorAll('.f-question-group');assert.equal(groups.length,2);
 assert.ok(key(groups[0].querySelector('h3'),'questionGeneral'),'General first');assert.match(content(groups[1].querySelector('h3')),/El poder de lo local/);
 assert.equal(groups[0].querySelectorAll('.f-question').length,2,'the new question joins its group');
 const rows=h.ctx.window.Fiiu.rows;for(const name of C4_KEYS){assert.equal(rows[name]?.length,3,name);assert.ok(rows[name].every(text=>typeof text==='string'&&text.trim()),name);}
 h.lang('es');assert.equal(general.textContent,'General (todo el festival)');assert.equal(key(groups[0].querySelector('h3'),'questionGeneral').textContent,'General (todo el festival)');
});

test('a new question is a Conversation or a Rating 1–10, sent as kind; a saved question shows its type and offers no way to change it',async()=>{
 const saved=[];let current=rating();
 const h=await harness(({method,path,body})=>{
  if(path==='/api/admin/fiiu/questions'&&method==='POST'){saved.push(body);return{status:201,data:{question:{...body,ratingCounts:body.kind==='rating'?Array(10).fill(0):null,revision:0,messageCount:0,createdAt:'2026-10-13T15:00:00.000Z',version:1}}};}
  if(method==='PATCH'){current={...current,...body,version:current.version+1};return{question:current};}
  return{content:[],nextCursor:null};
 },{questionsRead:()=>({questions:[copy(current)]})});
 const form=questionForm(h),choice=form.querySelector('.f-kind-choice'),radios=choice.querySelectorAll('input');
 assert.equal(choice.tagName,'fieldset');assert.ok(key(choice,'questionKind'));assert.ok(key(choice,'questionKindHint'));
 assert.deepEqual(radios.map(input=>[input.type,input.name,input.value,input.checked]),[['radio','kind','chat',true],['radio','kind','rating',false]],'Conversation is the default');
 assert.deepEqual(radios.map(input=>input.parent.querySelector('span').dataset.fiiuText),['questionKindChat','questionKindRating']);
 assert.equal(radios[1]['aria-describedby'],key(choice,'questionKindHint').id,'the hint explains the rating');
 radios[0].checked=false;radios[1].checked=true;await select(field(form,'activityId'),'day2-am');type(field(form,'body'),'¿Qué nota le das a este bloque?');await key(form,'publishNow').listeners.click();
 assert.equal(saved[0].kind,'rating');assert.equal(saved[0].activityId,'day2-am');
 const created=questionRows(h).find(row=>row.querySelector('.f-question-text').textContent==='¿Qué nota le das a este bloque?');assert.ok(key(created,'questionKindRating'),'the row says it is a rating');assert.ok(key(created,'ratingNone'));
 const row=questionRows(h).find(node=>node.querySelector('.f-question-text').id==='f-q-'+RATING_ID);await key(row,'editQuestion').listeners.click();
 const edit=row.querySelector('form');assert.equal(edit.querySelectorAll('input').filter(input=>input.type==='radio').length,0,'no way to change the type');
 const locked=edit.querySelector('.f-kind-locked');assert.ok(key(locked,'questionKindRating'));assert.ok(key(locked,'questionKindLocked'));
 type(field(edit,'body'),'¿Cómo calificas el FIIU 11, del 1 al 10?');await key(edit,'saveQuestion').listeners.click();
 assert.deepEqual(questionWrites(h).at(-1).body,{version:1,body:'¿Cómo calificas el FIIU 11, del 1 al 10?',talk:null},'an edit never sends the type');
 const chat=await harness(()=>({content:[],nextCursor:null}),{questionsRead:()=>({questions:[question()]})});
 assert.equal(key(questionRows(chat)[0],'questionKindRating'),undefined);assert.notEqual(key(questionRows(chat)[0],'ratingCsv')?.hidden,false,'a conversation has no counts to download');assert.equal(questionRows(chat)[0].querySelector('.f-rating').hidden,true);
});

test('a rating question’s row shows the average to one decimal, how many rated and a 1–10 strip read out as counts; without answers it says No ratings yet',async()=>{
 let current=rating();const h=await harness(()=>({content:[],nextCursor:null}),{questionsRead:()=>({questions:[copy(current)]})});
 const row=questionRows(h)[0],box=row.querySelector('.f-rating');
 assert.match(content(box.querySelector('.f-rating-line')),/Average\s+8\.3\s+·\s+10 people rated/,'(5 + 2×7 + 3×8 + 4×10) / 10');
 const bars=box.querySelector('ol');assert.equal(bars['aria-label'],'Ratings from 1 to 10');assert.equal(bars.children.length,10);
 const spoken=bars.children.map(item=>item.querySelector('.f-sr-only').textContent);
 assert.deepEqual([spoken[0],spoken[4],spoken[9]],['0 people chose 1','1 person chose 5','4 people chose 10']);
 assert.ok(bars.children.every(item=>item.children.filter(node=>node.className!=='f-sr-only').every(node=>node['aria-hidden']==='true')),'the drawn counts, bars and scores are hidden from assistive technology, which hears the sentence');
 assert.equal(bars.children[9].querySelector('.f-rating-count').textContent,'4');assert.equal(bars.children[9].querySelector('.f-rating-score').textContent,'10');
 h.lang('es');assert.match(content(row.querySelector('.f-rating-line')),/Promedio\s+8\.3\s+·\s+10 personas valoraron/);assert.equal(row.querySelector('.f-rating').querySelector('ol').children[4].querySelector('.f-sr-only').textContent,'1 persona eligió 5');
 h.lang('pt');assert.match(content(row.querySelector('.f-rating-line')),/Média\s+8,3\s+·\s+10 pessoas avaliaram/);h.lang('en');
 // The minute refresh brings new totals into the same row.
 current={...current,ratingCounts:[0,0,0,0,0,0,0,0,0,1],revision:9};await h.tickTimers();
 assert.equal(questionRows(h)[0],row);assert.match(content(row.querySelector('.f-rating-line')),/Average\s+10\.0\s+·\s+1 person rated/);
 current={...current,ratingCounts:Array(10).fill(0)};await h.tickTimers();assert.ok(key(row,'ratingNone'));assert.equal(row.querySelector('.f-rating').querySelector('ol'),null);
 // A malformed strip reads as a failed read, never as numbers.
 const odd=await harness(()=>({content:[],nextCursor:null}),{questionsRead:()=>({questions:[rating({ratingCounts:[1,2,3]})]})});assert.ok(key(conversations(odd),'questionsLoadError'));
});

test('Download counts (CSV) saves score,count rows 1 to 10 through the panel’s download path',async()=>{
 const h=await harness(()=>({content:[],nextCursor:null}),{questionsRead:()=>({questions:[rating()]})}),events=[],createElement=h.ctx.document.createElement;fakeTimers(h);
 h.ctx.Blob=class{constructor(parts,options){this.text=parts.join('');this.type=options.type;}};
 h.ctx.URL={createObjectURL:blob=>{events.push(['object URL',blob]);return 'blob:nodal/rating';},revokeObjectURL(){}};
 h.ctx.document.createElement=tag=>{const node=createElement(tag);if(tag==='a')Object.assign(node,{click(){events.push(['download',this.href,this.download]);},remove(){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}});return node;};
 const csv=key(questionRows(h)[0],'ratingCsv');assert.equal(csv.tagName,'button');assert.equal(csv['aria-describedby'],'f-q-'+RATING_ID);
 await csv.listeners.click();
 const [[,file],[,href,name]]=events;assert.equal(href,'blob:nodal/rating');assert.equal(name,'fiiu-rating-dddddddd.csv');assert.equal(file.type,'text/csv;charset=utf-8');
 assert.equal(file.text,'﻿score,count\r\n1,0\r\n2,0\r\n3,0\r\n4,0\r\n5,1\r\n6,0\r\n7,2\r\n8,3\r\n9,0\r\n10,4');
 assert.equal(h.requests.some(request=>request.path.includes('/export')),false,'the counts are already on the page');
});

test('the party counts in the activity totals by registrations only, takes no attendance tick, and the participant list filters by block',async()=>{
 const withParty={...copy(checkinSummary),activities:[...checkinSummary.activities,{activityId:'closing-party',registrations:45,externalInterests:0,attendance:0}]};
 const ana=participant('participant-a','Ana'),beto=participant('participant-b','Beto'),carla=participant('participant-c','Carla');
 ana.answers.activities=['day1-am','closing-party'];beto.answers.activities=['closing-party'];carla.answers.activities=['day2-am'];
 const h=await harness(({path})=>path==='/api/admin/fiiu/content'?{content:[],nextCursor:null}:{registration:copy(ana),attendance:[]},{participants:[ana,beto,carla],summaryRead:()=>({summary:copy(withParty)})});
 const tables=h.root.querySelector('.f-summary-stack').children.map(scroll=>scroll.children[0]);
 assert.equal(tables[0].querySelector('caption').dataset.fiiuText,'blocksAndParty');
 const party=tables[0].querySelectorAll('tr').find(row=>/Fiesta de cierre/.test(content(row)));assert.ok(party,'the party is in the registrations table');
 assert.ok(key(party,'pgParty'));assert.match(content(party),/\b45\b/);assert.deepEqual(party.children.slice(3).map(cell=>cell.textContent||content(cell).trim()),['–','–'],'no attendance and no hours');
 assert.doesNotMatch(content(tables[1]),/Fiesta de cierre/,'not among the workshop and route interests');
 // Without a party row the table keeps its name.
 const plain=await harness(()=>({content:[],nextCursor:null}),{summaryRead:()=>({summary:copy(checkinSummary)})});assert.equal(plain.root.querySelector('.f-summary-stack').children[0].children[0].querySelector('caption').dataset.fiiuText,'conferencesAndLab');
 await detailButton(h,0).listeners.click();const detail=h.root.querySelector('.f-admin-detail');
 assert.equal(detail.querySelectorAll('.f-attendance-row').some(row=>/Fiesta de cierre/.test(content(row))),false,'no tick for the party');assert.match(content(detail.querySelector('.f-answers')),/Fiesta de cierre/,'it is listed with the answers');
 const filter=field(h.root.querySelector('.f-admin-filters'),'participantBlock');assert.equal(filter.tagName,'select');assert.ok(key(filter.parent,'filterBlock'));
 assert.deepEqual(filter.children.map(option=>option.value),['',...EVENT.activities.filter(activity=>['general','social'].includes(activity.registration)).map(activity=>activity.id)],'every block people register for, the party last');
 assert.equal(filter.children[0].dataset.fiiuText,'filterAllBlocks');
 await select(filter,'closing-party');assert.deepEqual(participantNames(h),['Ana Test','Beto Test']);assert.match(content(h.root.querySelector('.f-result-count')),/2/);
 key(h.root,'filterLabPending').listeners.click();assert.deepEqual(participantNames(h),['Ana Test','Beto Test'],'with the other filters');
 await select(filter,'day2-am');assert.deepEqual(participantNames(h),['Carla Test']);
 await select(filter,'day3-am');assert.ok(key(h.root,'noMatches'));key(h.root,'showAll').listeners.click();assert.equal(filter.value,'','Show everyone clears the block too');assert.equal(participantNames(h).length,3);
 await select(filter,'closing-party');key(h.root.querySelector('.f-admin-summary'),'reviewPendingAction').listeners.click();assert.equal(filter.value,'','a shortcut shows its whole filter');
});
