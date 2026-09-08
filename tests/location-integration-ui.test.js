import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../web/scripts/${name}.js`, import.meta.url), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i=0;i<5;i++) await new Promise(r=>setImmediate(r)); };
const events = () => ({ listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, emit(type, detail) { for (const fn of this.listeners[type] || []) fn({detail}); } });

function profileHarness() {
  const src=read('dashboard'), start=src.indexOf('  /* Profile saves are serialized'), end=src.indexOf('  const stageOf');
  assert.ok(start>0&&end>start);
  const window=events(), requests=[], saving=[], profiles=[];
  window.nodalLocationCheck={setSaving:v=>saving.push(v),setUser:u=>profiles.push({...u})};
  const context={window, U:{id:'me',city:'Mococa',role:'Researcher',topics:[],partC:{consent:false}},confirmedCity:'Mococa',state:{},Promise,
    api:async(path,opts)=>{requests.push(JSON.parse(opts.body));return{user:{...context.U}};},
    serializeUser:u=>({...u}),normalizeApiUser:u=>u,applyAll:()=>{},document:{getElementById:()=>null},partCCount:()=>0,partCTotal:5,
    CustomEvent:class {constructor(type,opts){this.type=type;this.detail=opts.detail;}},
  };
  window.dispatchEvent=e=>window.emit(e.type,e.detail);
  vm.createContext(context);
  vm.runInContext(src.slice(src.indexOf('  function serializeUser'),src.indexOf('  /* ================= model')),context);
  vm.runInContext(src.slice(start,end),context);
  return {context,window,requests,saving,profiles,save:()=>vm.runInContext('saveProfile()',context)};
}

test('profile edits queued during location acceptance save the confirmed city and keep other edits',async()=>{
  const h=profileHarness();
  h.window.emit('nodal:location-saving',{saving:true});
  h.context.U.role='Updated researcher';
  const saved=h.save();await flush();assert.equal(h.requests.length,0);
  h.window.emit('nodal:location-updated',{userId:'me',city:'Cambridge, Massachusetts, United States',location:{lat:42.37,lon:-71.11}});
  h.window.emit('nodal:location-saving',{saving:false});await saved;
  assert.equal(h.requests.length,1);assert.equal(Object.hasOwn(h.requests[0],'city'),false);
  assert.equal(h.context.U.city,'Cambridge, Massachusetts, United States');
  assert.equal(h.requests[0].title,'Updated researcher');assert.equal(h.requests[0].partC.consent,false);
  assert.equal(h.saving.at(-1),false);
});

test('a profile edit queued behind a city save uses the new confirmed baseline without losing edits',async()=>{
  const h=profileHarness(),first=deferred();let count=0;
  h.context.api=async(path,opts)=>{h.requests.push(JSON.parse(opts.body));if(++count===1)return first.promise;return {user:{...h.context.U}};};
  h.context.U.city='Cambridge';const citySave=h.save();await flush();
  h.context.U.role='New role';const roleSave=h.save();await flush();assert.equal(h.requests.length,1);
  first.resolve({user:{...h.context.U,role:'Researcher'}});await citySave;await roleSave;
  assert.equal(h.requests[0].expectedCity,'Mococa');assert.equal(h.requests[0].city,'Cambridge');
  assert.equal(h.requests[1].title,'New role');assert.equal(Object.hasOwn(h.requests[1],'city'),false);
  assert.equal(h.context.U.city,'Cambridge');assert.equal(h.context.U.role,'New role');assert.equal(h.saving.at(-1),false);
});

test('an accepted location event cannot replace another account profile',()=>{
  const h=profileHarness();h.window.emit('nodal:location-updated',{userId:'other',city:'Paris'});
  assert.equal(h.context.U.city,'Mococa');assert.equal(h.requests.length,0);
});

test('a profile editor opened during acceptance follows the confirmed city without undoing it',()=>{
  const h=profileHarness(),field={value:'Mococa',disabled:false};
  h.context.document.getElementById=id=>id==='ucCity'?field:null;
  h.window.emit('nodal:location-saving',{saving:true});assert.equal(field.disabled,true);
  h.window.emit('nodal:location-updated',{userId:'me',city:'Cambridge'});
  h.window.emit('nodal:location-saving',{saving:false});
  assert.equal(field.value,'Cambridge');assert.equal(field.disabled,false);
  field.value='An intentional city edit';
  h.window.emit('nodal:location-updated',{userId:'me',city:'Boston'});
  assert.equal(field.value,'An intentional city edit');
});

test('unrelated profile saves omit the city so another tab cannot undo an accepted move',()=>{
  const src=read('dashboard'),start=src.indexOf('  function serializeUser'),end=src.indexOf('  /* ================= model');
  const ctx={confirmedCity:'Mococa',state:{notifRead:false}};vm.createContext(ctx);vm.runInContext(src.slice(start,end),ctx);
  ctx.user={name:'Member',city:'Mococa',topics:[],partC:{consent:false}};
  let patch=vm.runInContext('serializeUser(user)',ctx);assert.equal(Object.hasOwn(patch,'city'),false);
  ctx.user.city='Cambridge';patch=vm.runInContext('serializeUser(user)',ctx);
  assert.equal(patch.city,'Cambridge');assert.equal(patch.expectedCity,'Mococa');
});

test('globe discards an old response and immediately refetches after a city update',async()=>{
  const src=read('globe'),start=src.indexOf('  /* The globe polls'),end=src.indexOf('  const feed =');
  assert.ok(start>0&&end>start);
  const old=deferred(),calls=[],renders=[],window=events();
  const data=city=>({places:[{name:city,people:[]}],links:[],topics:[],you:{city}});
  const reply=city=>({ok:true,status:200,headers:{get:()=>city},json:async()=>data(city)});
  const ctx={window,document:{hidden:false,getElementById:()=>null},state:{topic:'',picked:-1},AbortSignal,
    fetch:async(path,opts)=>{calls.push({path,headers:opts.headers});return calls.length===1?old.promise:reply('Cambridge');},
    mergePlaces:d=>{renders.push(d.you.city);ctx.FULL=d;ctx.PLACES=d.places;},FULL:{},PLACES:[],started:false,
    renderTopics:()=>{},renderTimeline:()=>{},sayWhereYouStand:()=>{},showCount:()=>{},newcomers:()=>[],normalise:s=>s,
    schedule:()=>{},showPlace:()=>{},spinTo:()=>{},performance:{now:()=>0},clearTimeout:()=>{},setTimeout:fn=>{queueMicrotask(fn);return 1;},
  };
  vm.createContext(ctx);vm.runInContext(src.slice(start,end),ctx);
  const first=vm.runInContext('poll()',ctx);await flush();
  window.emit('nodal:profile-location-changed',{userId:'me'});old.resolve(reply('Mococa'));await first;await flush();
  assert.equal(calls.length,2);assert.equal(calls[1].headers['If-None-Match'],undefined);
  assert.deepEqual(renders,['Cambridge']);
});
