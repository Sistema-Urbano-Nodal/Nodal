import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const script = readFileSync(new URL('../web/scripts/overview-return.js', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../web/pages/dashboard.html', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../web/scripts/dashboard.js', import.meta.url), 'utf8');
const origin = 'https://nodal.example';

function page({dashboardPage = false, paths = [], referrer = '', legacy = false, current = paths.length - 1, crypto} = {}) {
  const events = {}, visits = [], requests = [], root = {
    hidden: dashboardPage,
    hasAttribute() { return this.hidden; },
    toggleAttribute(name, value) { this.hidden = value; },
  };
  const document = {documentElement: root, referrer, addEventListener: (name, fn) => { events[name] = fn; }};
  const history = {length: 4, back: () => visits.push('back')};
  const location = {origin, pathname: dashboardPage ? '/dashboard.html' : '/messages.html', search: '',
    href: origin + (dashboardPage ? '/dashboard.html' : '/messages.html'), assign: url => visits.push(url),
    replace: url => visits.push(url), reload: () => visits.push('reload')};
  const entries = paths.map((path, index) => ({key: 'k' + index, index, url: path ? origin + path : null}));
  const navigation = {entries: () => entries, currentEntry: entries[current],
    traverseTo(key) { visits.push(key); return {committed: Promise.resolve()}; }};
  const window = {crypto, navigation: legacy ? null : navigation, addEventListener(name, fn) {
    const earlier = events[name];
    events[name] = earlier ? event => { earlier(event); return fn(event); } : fn;
  }};
  const fetch = (path, options) => new Promise(resolve => requests.push({path, options, respond(status, body, stamp = 'v1') {
    resolve({ok: status === 200, status, headers: {get: () => stamp}, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0)});
  }}));
  vm.runInNewContext(script, {window, document, location, history, URL, URLSearchParams, fetch});
  function click(path = '/dashboard.html', overrides = {}) {
    let canceled = false;
    const anchor = {href: origin + path, hasAttribute: () => false};
    events.click({button: 0, target: {closest: () => anchor}, preventDefault() { canceled = true; }, ...overrides});
    return canceled;
  }
  return {events, window, root, requests, visits, click, navigation, history};
}

test('Overview links return to the latest dashboard in this tab, across a thread and an opaque intermediate history entry', () => {
  const h = page({paths: ['/dashboard.html', '/dashboard.html#network', null, '/messages.html?thread=4']});
  assert.ok(h.click());
  assert.deepEqual(h.visits, ['k1']);
  assert.equal(h.click('/dashboard.html#assessment'), false);
  assert.equal(h.click('/dashboard.html', {ctrlKey:true}), false);
  assert.equal(h.click('/dashboard.html', {defaultPrevented:true}), false);
  assert.equal(page({paths:['/dashboard.html','/login.html','/messages.html']}).click(), false);
  assert.equal(page({paths:['/profile.html','/messages.html']}).click(), false);
  const legacy = page({legacy:true, referrer:origin+'/dashboard.html'});
  assert.ok(legacy.click());
  assert.deepEqual(legacy.visits,['back']);
  legacy.history.length++;
  assert.equal(legacy.click(), false);
});

test('a canceled history traversal leaves unsaved work on the current page', async () => {
  const h = page({paths:['/dashboard.html','/messages.html']});
  h.navigation.traverseTo = () => ({committed:Promise.reject(Object.assign(new Error(), {name:'AbortError'}))});
  assert.ok(h.click());
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.visits,[]);
});

test('ordinary links reuse exact profiles in forward history without crossing account boundaries', () => {
  const h = page({paths:['/dashboard.html', '/profile.html?id=other', '/profile.html?lang=pt'], current:0, dashboardPage:true});
  assert.equal(h.click('/profile.html'), true);
  assert.deepEqual(h.visits,['k2']);
  assert.equal(h.click('/profile.html?id=else'), false);
  assert.equal(h.click('/profile.html?id=other'), true);
  assert.deepEqual(h.visits,['k2','k1']);
  assert.ok(h.click('/dashboard.html'));
  assert.deepEqual(h.visits,['k2','k1'], 'clicking the current section must not start a fresh document');
});

test('pointer and click share a single confirmation while the current view stays visible', async () => {
  const h=page({paths:['/dashboard.html','/messages.html'], crypto:{randomUUID:()=>'10000000-0000-4000-8000-000000000000'}});
  const link={href:origin+'/dashboard.html',hasAttribute:()=>false};
  h.events.pointerover({target:{closest:()=>link}});
  h.events.focusin({target:{closest:()=>link}});
  assert.ok(h.click());
  assert.equal(h.requests.length,1);
  assert.deepEqual(h.visits,[]);
  h.requests[0].respond(200,{stamp:'v1'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.visits,['k0']);
});

async function readyDashboard() {
  const h=page({dashboardPage:true});
  h.requests[0].respond(200,{user:{id:'owner'}});
  await h.window.nodalMemberSession;
  return h;
}

test('a restored dashboard reuses its confirmed member, and never reveals another session', async () => {
  assert.match(dashboard, /<html[^>]*data-overview-pending[^>]*\binert\b/);
  const h=await readyDashboard();
  h.window.nodalDashboard={resume:user=>user.id==='owner'};
  await h.events.pageshow({persisted:false});
  assert.equal(h.requests.length,1);
  h.events.pagehide();
  const restoring=h.events.pageshow({persisted:true});
  assert.ok(h.root.inert && h.root.hidden);
  assert.equal(h.requests[1].path,'/api/auth/view?scope=dashboard');
  assert.equal(h.requests[1].options.cache,'no-store');
  h.requests[1].respond(200,{stamp:'v1'});await restoring;
  assert.ok(!h.root.inert && !h.root.hidden);
  h.events.pagehide();
  const wrong=h.events.pageshow({persisted:true});
  h.requests[2].respond(200,{stamp:'v2'});await new Promise(resolve=>setImmediate(resolve));
  h.requests[3].respond(200,{user:{id:'other'}},'v2');await wrong;
  assert.deepEqual(h.visits,['reload']);assert.ok(h.root.inert && h.root.hidden);
  const signedOut=h.events.pageshow({persisted:true});
  h.requests[4].respond(401,{});await signedOut;
  assert.deepEqual(h.visits,['reload','/login.html?next=%2Fdashboard.html']);
  assert.ok(h.root.inert && h.root.hidden);
});

test('a response from an earlier visit cannot reveal a dashboard that has since left the screen', async () => {
  const h=await readyDashboard();
  h.window.nodalDashboard={resume:()=>true};
  h.events.pagehide();const stale=h.events.pageshow({persisted:true});h.events.pagehide();
  h.requests[1].respond(200,{stamp:'v1'});await stale;
  assert.ok(h.root.inert && h.root.hidden);
  const error=h.events.pageshow({persisted:true});h.requests[2].respond(503,{});await error;
  assert.deepEqual(h.visits,['reload']);assert.ok(h.root.inert && h.root.hidden);
});

test('return refresh preserves unchanged UI and unsaved profile edits while revalidating identity and role', () => {
  const start=dashboardSource.indexOf('  let dashboardPermission;');
  const end=dashboardSource.indexOf('  async function init()',start);
  const context={window:{}, freshPaints:0};
  vm.createContext(context);
  vm.runInContext(`let U={id:'u',city:'Lima'}, profileWrites=0, needsSave=false, confirmedCity='Lima';const state={};
    const normalizeApiUser=({id,city})=>({id,city}), byId=()=>({hidden:!needsSave}), applyAll=()=>freshPaints++;
    ${dashboardSource.slice(start,end)}; dashboardPermission='member';`,context);
  const current={id:'u',city:'Lima',permission:'member'};
  const resume=context.window.nodalDashboard.resume;
  assert.equal(resume(current),true);
  assert.equal(context.freshPaints,0);
  assert.equal(resume({...current,id:'someone else'}),false);
  assert.equal(resume({...current,permission:'admin'}),false);
  vm.runInContext('needsSave=true',context);
  assert.equal(resume({...current,city:'Cusco'}),true);
  assert.equal(context.freshPaints,0);
  vm.runInContext('needsSave=false',context);
  assert.equal(resume({...current,city:'Cusco'}),true);
  assert.equal(context.freshPaints,1);
});
