import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CONFIG,FIIU_EVENT} from '../server/fiiu-domain.js';
import {createFiiuHarness,field,flush} from './helpers/fiiu-ui-harness.js';

/* The organiser dashboard (fiiu-admin.js) after the code overview of 16 Nov 2026: the fixes of its staff batch.
   The answers are the dashboard tests' defaults (tests/fiiu-admin-ui.test.js harness), without participants. */
const copy=value=>structuredClone(value);
const programmeItem=activity=>({...activity,description:activity.description??'',edited:false,version:0,original:{title:activity.title,date:activity.date,time:activity.time,venue:activity.venue,description:activity.description??'',sessions:activity.sessions,...(activity.registration==='external'?{formUrl:activity.formUrl}:{})},checkedIn:0});
const summary={totalRegistrations:3,publicOfficials:1,lab:{pending:1,accepted:0,declined:0},activities:[],days:[],profiles:[]};
const counts={none:0,pending:0,sent:0,failed:0,uncertain:0,skipped:0};
function harness({summaryRead=()=>({summary:copy(summary)})}={}){
 return createFiiuHarness(request=>{
  if(request.path==='/api/admin/fiiu/config'&&request.method==='GET')return{event:FIIU_EVENT,config:{...DEFAULT_CONFIG,version:0}};
  if(request.path==='/api/admin/fiiu/confirmations')return{configured:true,counts,dailyCap:150,sentToday:0,resetsAt:'2026-10-03T00:00:00.000Z'};
  if(request.path==='/api/admin/fiiu/questions')return{questions:[]};
  if(request.path==='/api/admin/fiiu/programme')return{activities:FIIU_EVENT.activities.map(programmeItem)};
  if(request.path==='/api/admin/fiiu/notices/closing-party')return{configured:true,counts:{...counts,waiting:0},dailyCap:150,sentToday:0,resetsAt:'2026-10-03T00:00:00.000Z'};
  if(request.path==='/api/admin/fiiu/registrations')return{registrations:[],nextCursor:null};
  if(request.path==='/api/admin/fiiu/summary')return summaryRead(request);
  return{content:[],nextCursor:null};
 },{page:'fiiu-admin'});
}
const editorForm=h=>h.root.querySelector('.f-content-editor').querySelector('form');
const leaveAsks=h=>{let asked=false;for(const listener of h.windowListeners.beforeunload||[])listener({preventDefault(){asked=true;}});return asked;};

test('M61/M141: the dashboard tells the staff bar about unsaved work, and once signed out its leave prompt asks nothing more',async()=>{
 const h=await harness();
 assert.equal(h.ctx.window.nodalUnsaved(),false,'a dashboard just opened has nothing unsaved');
 field(editorForm(h),'title').value='Half-written news';
 assert.equal(h.ctx.window.nodalUnsaved(),true);
 assert.equal(leaveAsks(h),true,'leaving still asks');
 h.ctx.window.nodalSignedOut=true;
 assert.equal(leaveAsks(h),false,'signed out from the staff bar: the session is closed, so the page does not ask a second time');
});

test('M61/M141: a dashboard locked by a 403 reports nothing unsaved, as its leave prompt lets the organiser go',async()=>{
 let deny=false;
 const h=await harness({summaryRead:()=>deny?{status:403,data:{error:'administrator access required'}}:{summary:copy(summary)}});
 field(editorForm(h),'title').value='Unsent news';
 assert.equal(h.ctx.window.nodalUnsaved(),true);
 deny=true;await h.tickTimers();await flush();
 assert.equal(h.ctx.window.nodalUnsaved(),false);
 assert.equal(leaveAsks(h),false);
});
