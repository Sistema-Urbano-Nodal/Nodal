import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const SCRIPT=readFileSync(new URL('../web/scripts/i18n.js',import.meta.url),'utf8');
// The console's own strings, which the console pages load just before i18n.js.
const CONSOLE=readFileSync(new URL('../web/scripts/i18n-dashboard.js',import.meta.url),'utf8');
// These 223 keys and the home hashes are captured from the runtime dictionaries
// at 6ab93f9, including text created lazily by the original homepage graph.
// One line moved on purpose since: the free plan stopped offering courses on
// 18 Oct 2026 (mem.f1 here, y.f1 in the nonhome hashes), so all four were redone.
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
    "es": "079660e2411ca2fa9e8c0295b913fe7b5fc0f8bf63a8bb726f7bf218e97db9cb",
    "pt": "26f40677f81266699adc35dcfa26089f09b73c8749cbee8a8a79d2910beefda3"
  },
  "nonhome": {
    "es": "c86b92ceabd9185366a45be631735dbd471a7523b0f8d80b43f5042aef21509b",
    "pt": "660dd0cfc74939fb3455bfc0de4269451941b05494d51c4ba9330097561e158d"
  }
};

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function load(page,nodes=[],{withConsole=false}={}){
  const context={document:{body:{dataset:page?{page}:{}},documentElement:{},querySelectorAll:selector=>selector==='[data-i18n]'?nodes:[]},window:{location:{search:''}},localStorage:{getItem(){return null;},setItem(){}},URLSearchParams};
  vm.createContext(context);
  if(withConsole)vm.runInContext(CONSOLE,context);
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
      // With the console strings, as a console page has them; tests/i18n-split.test.js checks the other pages get the rest.
      const{api,dictionaries}=load(page,[],{withConsole:true});api.apply(lang);
      // Later additions have their own translation coverage; preserve the original copy baseline.
      // The publishing desk (ops.*), NODAL news (news.*) and the console's desk link are covered by catalog-ui and news-ui;
      // the membership and account-deletion refusals (October 3 review) by review-fix-5-integration;
      // the console's loading/failure lines and accessible names (d.aria.*) by dashboard-publishing,
      // the catalog's nothing-published state by catalog-ui, and the console's Show more / Show less (d.news.*) and FIIU badges
      // (d.badge.fiiu.*) by dashboard-console-ui, the Learning band's readings from BUC (d.buc.*) by buc-ui, and the
      // Supporter plans' courses line (mem.p7, y.p6) by the plan copy test at the end of this file.
      const later=key=>['nav.privacy','catalog.retry','catalog.moreError','nav.program','nav.community','nav.learn','nav.fiiu','d.nav.publish','y.alreadyMember','d.uc.deleteSubscription','d.greet.hello','d.greet.loading','d.load.failed','catalog.emptyNothingPublished','catalog.nextFiiu','catalog.nextCourses','mem.p7','y.p6'].includes(key)||/^(?:ops|news|d\.aria|d\.news|d\.badge\.fiiu|d\.buc)\./.test(key);
      const actual=Object.entries(dictionaries[lang]).filter(([key])=>!later(key)).sort(([a],[b])=>a.localeCompare(b,'en'));
      assert.equal(hash(actual),SNAPSHOTS.nonhome[lang],String(page));
      assert.equal(api.t('nav.privacy'),lang==='es'?'Política de privacidad':'Política de privacidade');
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
test('landing leader titles, lab chips and accessible names switch language instead of staying English',()=>{
  const html=readFileSync(new URL('../web/pages/index.html',import.meta.url),'utf8');
  const leaders=html.slice(html.indexOf('id="leaderRow"'),html.indexOf('</section>',html.indexOf('id="leaderRow"')));
  assert.equal((leaders.match(/<h3>/g)||[]).length,0,'every leader title carries a key');
  assert.match(leaders,/<a class="leader-card leader-more" href="login\.html\?next=\/dashboard\.html">[\s\S]*?data-i18n="lead\.more"[\s\S]*?<\/a>/,'the green Join card is a real link');
  const logos=html.match(/<div class="logos">([\s\S]*?)<\/div>/)[1];
  assert.equal((logos.match(/<span data-i18n="part\.l\d">/g)||[]).length,6);
  assert.match(html,/<span class="t-num" data-i18n="part\.open">Open<\/span>/);
  assert.match(html,/role="tablist" aria-label="How NODAL works" data-i18n-aria-label="platform\.tabsLabel"/);
  assert.match(html,/id="graph"[^>]+data-i18n-aria-label="graph\.aria"/);
  assert.doesNotMatch(html,/title="Members only"/);
  const keys=['lead.n1','lead.n2','lead.n3','lead.n4','lead.n5','lead.i1','lead.i2','lead.i3','lead.i4','lead.i5','part.l1','part.l2','part.l3','part.l4','part.l5','part.l6','part.open','platform.tabsLabel','graph.aria'];
  for(const key of keys)assert.match(html,new RegExp(`data-i18n(?:-aria-label)?="${key.replace('.','\\.')}"`),key);
  const {api,dictionaries}=load('home');
  for(const lang of ['es','pt'])for(const key of keys)assert.ok(key in dictionaries[lang],`${key} in ${lang}`);
  api.apply('es');assert.equal(api.t('lead.n3'),'Urbanista');assert.equal(api.t('part.l4'),'Co-crear');assert.equal(api.t('graph.aria'),'Red interactiva de actores');
  api.apply('pt');assert.equal(api.t('part.l6'),'Agir');assert.equal(api.t('platform.tabsLabel'),'Como a NODAL funciona');
});
test('the free plans stop offering courses and the Supporter plans list them, in English, Spanish and Portuguese',()=>{
  // [en, es, pt]; English is the markup's own text.
  const COPY={
    'mem.f1':['Open labs and community sessions','Laboratorios abiertos y sesiones comunitarias','Laboratórios abertos e encontros comunitários'],
    'mem.p7':['Supporter courses with the teaching team','Cursos de la membresía con el equipo docente','Cursos da assinatura com a equipe docente'],
    'y.f1':['Community sessions and open resources','Sesiones comunitarias y recursos abiertos','Encontros da comunidade e recursos abertos'],
    'y.p6':['Supporter courses with the teaching team','Cursos de la membresía con el equipo docente','Cursos da assinatura com a equipe docente'],
  };
  const page=name=>readFileSync(new URL('../web/pages/'+name,import.meta.url),'utf8');
  const landing=page('index.html'),payments=page('payments.html');
  // The <ul> of the plan card with exactly this class.
  const list=(html,card)=>{const at=html.indexOf(`<article class="${card}">`);assert.notEqual(at,-1,card);return html.slice(html.indexOf('<ul>',at),html.indexOf('</ul>',at));};
  const keys=part=>[...part.matchAll(/data-i18n="([^"]+)"/g)].map(match=>match[1]);
  for(const [html,free,pro,order] of [[landing,'plan','plan plan-pro',['mem.p1','mem.p2a','mem.p2b','mem.p3','mem.p4','mem.p5','mem.p7','mem.p6']],[payments,'pay-plan','pay-plan pay-plan-pro',['y.p1','y.p2','y.p3','y.p4','y.p5','y.p6']]]){
    assert.doesNotMatch(list(html,free),/course/i,free+': the free plan no longer offers courses');
    assert.deepEqual(keys(list(html,pro)),order,pro);
  }
  for(const [key,[en]] of Object.entries(COPY))assert.ok((key.startsWith('mem.')?landing:payments).includes(`<li data-i18n="${key}">${en}</li>`),key);
  const home=load('home').api,console_=load(undefined,[],{withConsole:true}).api;
  for(const [index,lang] of [[1,'es'],[2,'pt']]){
    home.apply(lang);console_.apply(lang);
    for(const [key,copy] of Object.entries(COPY))assert.equal((key.startsWith('mem.')?home:console_).t(key),copy[index],`${lang} ${key}`);
  }
});
