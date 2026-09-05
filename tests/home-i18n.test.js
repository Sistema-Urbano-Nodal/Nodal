import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const SCRIPT=readFileSync(new URL('../web/scripts/i18n.js',import.meta.url),'utf8');
// These 223 keys and the home hashes are captured from the runtime dictionaries
// at 6ab93f9, including text created lazily by the original homepage graph.
const HOME_KEYS=[
  "about.eyebrow",
  "about.lead1",
  "about.lead2",
  "about.leadHl",
  "about.p1",
  "about.p2",
  "cta.btn",
  "cta.p",
  "cta.title",
  "foot.old",
  "foot.rights",
  "foot.touch",
  "graph.axis",
  "graph.hint",
  "graph.n.academia.ask",
  "graph.n.academia.c",
  "graph.n.academia.k1",
  "graph.n.academia.k2",
  "graph.n.academia.k3",
  "graph.n.academia.t",
  "graph.n.architect.ask",
  "graph.n.architect.c",
  "graph.n.architect.k1",
  "graph.n.architect.k2",
  "graph.n.architect.k3",
  "graph.n.architect.t",
  "graph.n.business.ask",
  "graph.n.business.c",
  "graph.n.business.k1",
  "graph.n.business.k2",
  "graph.n.business.k3",
  "graph.n.business.t",
  "graph.n.citygov.ask",
  "graph.n.citygov.c",
  "graph.n.citygov.k1",
  "graph.n.citygov.k2",
  "graph.n.citygov.k3",
  "graph.n.citygov.t",
  "graph.n.civil.ask",
  "graph.n.civil.c",
  "graph.n.civil.k1",
  "graph.n.civil.k2",
  "graph.n.civil.k3",
  "graph.n.civil.t",
  "graph.n.community.ask",
  "graph.n.community.c",
  "graph.n.community.k1",
  "graph.n.community.k2",
  "graph.n.community.k3",
  "graph.n.community.t",
  "graph.n.economist.ask",
  "graph.n.economist.c",
  "graph.n.economist.k1",
  "graph.n.economist.k2",
  "graph.n.economist.k3",
  "graph.n.economist.t",
  "graph.n.investor.ask",
  "graph.n.investor.c",
  "graph.n.investor.k1",
  "graph.n.investor.k2",
  "graph.n.investor.k3",
  "graph.n.investor.t",
  "graph.n.media.ask",
  "graph.n.media.c",
  "graph.n.media.k1",
  "graph.n.media.k2",
  "graph.n.media.k3",
  "graph.n.media.t",
  "graph.n.mobility.ask",
  "graph.n.mobility.c",
  "graph.n.mobility.k1",
  "graph.n.mobility.k2",
  "graph.n.mobility.k3",
  "graph.n.mobility.t",
  "graph.n.ngo.ask",
  "graph.n.ngo.c",
  "graph.n.ngo.k1",
  "graph.n.ngo.k2",
  "graph.n.ngo.k3",
  "graph.n.ngo.t",
  "graph.n.project.ask",
  "graph.n.project.c",
  "graph.n.project.k1",
  "graph.n.project.k2",
  "graph.n.project.k3",
  "graph.n.project.t",
  "graph.n.researcher.ask",
  "graph.n.researcher.c",
  "graph.n.researcher.k1",
  "graph.n.researcher.k2",
  "graph.n.researcher.k3",
  "graph.n.researcher.t",
  "graph.tabAsks",
  "graph.tabConnects",
  "graph.tabContacts",
  "hero.building",
  "hero.collabMark",
  "hero.collabPost",
  "hero.collabPre",
  "hero.cta1",
  "hero.cta2",
  "hero.infra",
  "hero.sub",
  "how.foot",
  "how.lead1",
  "how.lead2",
  "how.lead3",
  "how.s1",
  "how.s2",
  "how.s3",
  "how.s4",
  "how.s5",
  "how.s6",
  "insight.eyebrow",
  "insight.foot1",
  "insight.foot2",
  "insight.footHl",
  "insight.s1",
  "insight.s2",
  "insight.s3",
  "insight.s4",
  "insight.title",
  "lead.eyebrow",
  "lead.more",
  "lead.moreP",
  "lead.r1",
  "lead.r2",
  "lead.r3",
  "lead.r4",
  "lead.r5",
  "lead.title",
  "match.proj",
  "match.role",
  "match.tag1",
  "match.tag2",
  "match.tag3",
  "match.why",
  "mem.eyebrow",
  "mem.f1",
  "mem.f2",
  "mem.f3",
  "mem.f4",
  "mem.f5a",
  "mem.f5b",
  "mem.flag",
  "mem.freeCta",
  "mem.freeName",
  "mem.freePrice",
  "mem.p1",
  "mem.p2a",
  "mem.p2b",
  "mem.p3",
  "mem.p4",
  "mem.p5",
  "mem.p6",
  "mem.proCta",
  "mem.proName",
  "mem.proPrice",
  "mem.title",
  "nav.join",
  "nav.knowledge",
  "nav.network",
  "nav.opportunities",
  "nav.panel",
  "nav.profile",
  "nav.resources",
  "part.eyebrow",
  "part.t1",
  "part.t2",
  "part.t3",
  "part.title",
  "plat.tab1",
  "plat.tab2",
  "plat.tab3",
  "platform.edge",
  "platform.eyebrow",
  "platform.i1",
  "platform.i2",
  "platform.i3",
  "platform.node",
  "platform.title",
  "problem.c1p",
  "problem.c1t",
  "problem.c2p",
  "problem.c2t",
  "problem.c3p",
  "problem.c3t",
  "problem.eyebrow",
  "problem.foot1",
  "problem.foot2",
  "problem.title",
  "profile.b1s",
  "profile.b1t",
  "profile.b2s",
  "profile.b2t",
  "profile.cta",
  "profile.eyebrow",
  "profile.p",
  "profile.title",
  "quote.cap",
  "quote.hl",
  "quote.p1",
  "quote.p2",
  "res.eyebrow",
  "res.link",
  "res.r1p",
  "res.r1t",
  "res.r2p",
  "res.r2t",
  "res.r3p",
  "res.r3t",
  "res.title",
  "step.p1",
  "step.p2",
  "step.p3",
  "step.t1",
  "step.t2",
  "step.t3",
  "ticker.t1",
  "ticker.t2",
  "ticker.t3",
  "ticker.t4",
  "ticker.t5"
];
const SNAPSHOTS={
  "home": {
    "es": "853f02d6acabeefabad1e5b100ed35f1a9616b9871871e7e9e0d72b113d1e8c6",
    "pt": "77b244c716beb1956f020d7a452cb20727334b3beed4468028834c7ce83a40f0"
  },
  "nonhome": {
    "es": "bdb99eba47e951a598eb1ab91b2a0e746c68d7a4980a0700169d50977bbb76f6",
    "pt": "f31575be665935bfa608a66e89b65e4a045a4b7003fd647b059622d85602edcf"
  }
};

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function load(page,nodes=[]){
  const context={document:{body:{dataset:page?{page}:{}},documentElement:{},querySelectorAll:selector=>selector==='[data-i18n]'?nodes:[]},window:{location:{search:''}},localStorage:{getItem(){return null;},setItem(){}},URLSearchParams};
  vm.createContext(context);
  // Snapshot the resolved dictionaries after every normal assignment. This
  // catches duplicate-key overrides that source-key scans cannot detect.
  vm.runInContext(SCRIPT.replace('const listeners = new Set();','window.dictionaryForTest = DICT; const listeners = new Set();'),context);
  return{api:context.window.nodalI18n,dictionaries:context.window.dictionaryForTest};
}
for(const lang of ['es','pt']){
  test('original homepage runtime copy matches 6ab93f9 in '+lang,()=>{
    const {api}=load('home');api.apply(lang);
    assert.equal(hash(HOME_KEYS.map(key=>[key,api.t(key)])),SNAPSHOTS.home[lang]);
    assert.equal(api.t('nav.opportunities'),'Programas');
    assert.equal(api.t('graph.n.architect.k2'),lang==='es'?'Especialistas en vivienda · 8':'Especialistas em moradia · 8');
    assert.match(api.t('quote.p1'),lang==='es'?/Los proyectos no fracasan/:/Projetos não fracassam/);
  });
  test('nonhome catalog and console dictionaries remain unchanged in '+lang,()=>{
    for(const page of [undefined,'dashboard','course','opportunities']){
      const{api,dictionaries}=load(page);api.apply(lang);
      const actual=Object.entries(dictionaries[lang]).sort(([a],[b])=>a.localeCompare(b,'en'));
      assert.equal(hash(actual),SNAPSHOTS.nonhome[lang],String(page));
      assert.equal(api.t('nav.opportunities'),lang==='es'?'Trabajo abierto':'Trabalhos abertos');
      assert.notEqual(api.t('catalog.title'),'catalog.title');assert.notEqual(api.t('d.nav.overview'),'d.nav.overview');
    }
  });
}
test('home overrides preserve current operational recommendation states',()=>{
  const home=load('home'),other=load('dashboard');
  const keys=Object.keys(other.dictionaries.es).filter(key=>key.startsWith('recs.'));
  assert.ok(keys.length>20);
  for(const lang of ['en','es','pt']){home.api.apply(lang);other.api.apply(lang);for(const key of keys)assert.equal(home.api.t(key),other.api.t(key),lang+': '+key);}
});
test('original markup and lazy graph labels switch ES/PT and restore captured English',()=>{
  const hero={dataset:{i18n:'hero.sub'},textContent:'Original English introduction'};
  const nodes=[hero],{api}=load('home',nodes);api.apply('pt');assert.match(hero.textContent,/A NODAL conecta pessoas/);
  const graph={dataset:{i18n:'graph.n.project.k2'},textContent:'Start from real needs and lived experience'};nodes.push(graph);
  api.apply('es');assert.match(hero.textContent,/NODAL conecta personas/);assert.equal(graph.textContent,'Empieza desde necesidades reales y experiencia vivida');
  api.apply('en');assert.equal(hero.textContent,'Original English introduction');assert.equal(graph.textContent,'Start from real needs and lived experience');
});
