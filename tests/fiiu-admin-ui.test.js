import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CONFIG,FIIU_EVENT} from '../server/fiiu-domain.js';
import {createFiiuHarness,key,field,flush} from './helpers/fiiu-ui-harness.js';

const participant=(id,firstName)=>({id,eventId:'fiiu-2026',userId:'user-'+id,email:firstName.toLowerCase()+'@example.test',version:1,labStatus:'pending',createdAt:'2026-09-29T12:00:00.000Z',updatedAt:'2026-09-29T12:00:00.000Z',answers:{firstName,lastName:'Test',country:'Perú',city:'Lima',profile:'public_official',publicOfficial:true,applyLab:true,institution:'City Council',position:'Planner',activities:['day1-am'],privacyAccepted:true}});
const copy=value=>structuredClone(value);
async function harness(respond,{participants=[]}={}){
 return createFiiuHarness(request=>{
  if(request.path==='/api/fiiu')return{event:FIIU_EVENT,config:DEFAULT_CONFIG,content:[],nextCursor:null};
  if(request.path==='/api/admin/fiiu/config')return{config:{...DEFAULT_CONFIG,version:0}};
  if(request.path==='/api/admin/fiiu/registrations')return{registrations:copy(participants),nextCursor:null};
  return respond(request);
 },{page:'fiiu-admin'});
}
async function submit(form){form.listeners.submit({preventDefault(){}});await flush();}
const detailTitle=h=>h.root.querySelector('.f-admin-detail').querySelector('h3')?.textContent;
const detailButton=(h,index)=>key(h.root.querySelectorAll('.f-participant')[index],'details');
const unavailable={status:503,data:{error:'unavailable'}};

test('retrying a saved publication after a failed list refresh updates that publication instead of creating a duplicate',async()=>{
 const publications=[];let listReads=0;
 const h=await harness(({path,method,body})=>{
  if(method==='GET')return ++listReads===2?unavailable:{content:copy(publications),nextCursor:null};
  if(method==='POST'){
   const row={...body,id:'publication-'+(publications.length+1),version:1,createdAt:'2026-09-29T12:00:00.000Z',updatedAt:'2026-09-29T12:00:00.000Z'};publications.push(row);return{content:copy(row)};
  }
  const row=publications.find(item=>path==='/api/admin/fiiu/content/'+item.id);
  if(!row||row.version!==body.version)return{status:409,data:{error:'content changed'}};
  Object.assign(row,body,{version:row.version+1});return{content:copy(row)};
 });
 const form=h.root.querySelector('.f-content-editor').querySelector('form');field(form,'title').value='Original announcement';
 await submit(form);assert.equal(publications.length,1);assert.equal(key(form,'saveContent').disabled,false);
 const refreshMessage=h.message.dataset.fiiuText;
 field(form,'title').value='Corrected announcement';await submit(form);
 assert.equal(publications.length,1,'retrying a successful creation must not insert a second publication');
 assert.equal(publications[0].title,'Corrected announcement');assert.equal(publications[0].version,2);
 assert.deepEqual(h.requests.filter(request=>request.method!=='GET').map(request=>request.method),['POST','PATCH']);
 assert.equal(refreshMessage,'savedRefreshFailed','a failed refresh must not imply that the save failed');
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
 const existing={id:'published-a',version:1,title:'Existing announcement',body:'',kind:'news',status:'published',activityId:'',url:''};
 let finishSave,finishRefresh,reads=0;
 const h=await harness(({method,body})=>{
  if(method==='POST')return new Promise(resolve=>{finishSave=()=>resolve({content:{...body,id:'created-b',version:1}});});
  if(++reads===1)return{content:[copy(existing)],nextCursor:null};
  return new Promise(resolve=>{finishRefresh=()=>resolve({content:[copy(existing)],nextCursor:null});});
 });
 const older=h.root.querySelector('.f-content-editor').querySelector('form');field(older,'title').value='New announcement';
 older.listeners.submit({preventDefault(){}});finishSave();await flush();
 await key(h.root.querySelector('.f-news-item'),'editContent').listeners.click();
 const newer=h.root.querySelector('.f-content-editor').querySelector('form');field(newer,'title').value='Unsaved correction to existing announcement';
 finishRefresh();await flush();
 assert.equal(h.root.querySelector('.f-content-editor').querySelector('form'),newer,'the earlier save must not replace the editor selected during its refresh');
 assert.equal(field(newer,'title').value,'Unsaved correction to existing announcement');
 assert.equal(field(newer,'title').disabled,false);
});

test('organizer participant loading does not wait for a slow public programme response',async()=>{
 let finishProgramme;
 const h=await createFiiuHarness(({path})=>{
  if(path==='/api/fiiu')return new Promise(resolve=>{finishProgramme=()=>resolve({event:FIIU_EVENT,config:DEFAULT_CONFIG,content:[],nextCursor:null});});
  if(path==='/api/admin/fiiu/config')return{config:DEFAULT_CONFIG};
  if(path==='/api/admin/fiiu/content')return{content:[],nextCursor:null};
  if(path==='/api/admin/fiiu/registrations')return{registrations:[],nextCursor:null};
  throw Error('Unexpected request');
 },{page:'fiiu-admin'});
 assert.ok(h.requests.some(request=>request.path==='/api/admin/fiiu/registrations'),'the independent participant read should already be in flight');
 finishProgramme();await flush();assert.ok(key(h.root,'noParticipants'));
 assert.equal(h.requests.filter(request=>request.path==='/api/admin/fiiu/registrations').length,1);
});
