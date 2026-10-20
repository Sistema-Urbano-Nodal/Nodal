import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

const SCRIPT=readFileSync(new URL('../web/scripts/i18n.js',import.meta.url),'utf8');
// The console's own strings, which the console pages load just before i18n.js.
const CONSOLE=readFileSync(new URL('../web/scripts/i18n-dashboard.js',import.meta.url),'utf8');
// These 228 keys and the home hashes are captured from the runtime dictionaries
// at 6ab93f9, including text created lazily by the original homepage graph.
// One line moved on purpose since: the free plan stopped offering courses on
// 18 Oct 2026 (mem.f1 here, y.f1 in the nonhome hashes), so all four were redone.
// On 19 Oct 2026 Prof. Mariana's copy split the hero introduction (hero.sub) into
// hero.subPre/subMark/subPost and added the collaborative urbanism section (uc.*),
// so the two home hashes were redone again; the last test in this file pins that copy.
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
  "hero.subMark",
  "hero.subPost",
  "hero.subPre",
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
  "ticker.t5",
  "uc.eyebrow",
  "uc.p",
  "uc.title"
];
const SNAPSHOTS={
  "home": {
    "es": "8f807c4cefb324403d44b67c05022bb4a92a4ca75cb17254535a161422967118",
    "pt": "97309857d91b9c450abdb8fe71c341a395330f0c696f87d31c27767656ee8c1d"
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
      // console's two-character name refusal (d.uc.errNameShort) just below and by dashboard-console-ui, and Nodal Fundadores 2027
      // (y.fund.* on the payments page, mem.fund.* on the landing card) by payments-links-ui, landing-membership and the plan copy
      // test at the end of this file. The Supporter courses lines (mem.p7, y.p6) and the Mercado Pago links page (y.mp.*) they replaced are gone.
      const later=key=>['nav.privacy','catalog.retry','catalog.moreError','nav.program','nav.community','nav.learn','nav.fiiu','d.nav.publish','y.alreadyMember','d.uc.deleteSubscription','d.greet.hello','d.greet.loading','d.load.failed','catalog.emptyNothingPublished','catalog.nextFiiu','catalog.nextCourses','d.uc.errNameShort'].includes(key)||/^(?:ops|news|d\.aria|d\.news|d\.badge\.fiiu|d\.buc|y\.fund|mem\.fund)\./.test(key);
      const actual=Object.entries(dictionaries[lang]).filter(([key])=>!later(key)).sort(([a],[b])=>a.localeCompare(b,'en'));
      assert.equal(hash(actual),SNAPSHOTS.nonhome[lang],String(page));
      assert.equal(api.t('nav.privacy'),lang==='es'?'Política de privacidad':'Política de privacidade');
      assert.equal(api.t('d.uc.errNameShort'),lang==='es'?'Escribe tu nombre con al menos 2 caracteres.':'Digite seu nome com pelo menos 2 caracteres.');
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
  const hero={dataset:{i18n:'hero.subPre'},textContent:'Original English introduction'};
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
test('the free plans offer no courses and Nodal Fundadores lists its own benefits, in English, Spanish and Portuguese',()=>{
  // [en, es, pt]; English is the markup's own text.
  const COPY={
    'mem.f1':['Open labs and community sessions','Laboratorios abiertos y sesiones comunitarias','Laboratórios abertos e encontros comunitários'],
    'mem.fund.early':['Early access from your first payment until 31 December 2026','Acceso anticipado desde tu primer pago hasta el 31 de diciembre de 2026','Acesso antecipado desde o primeiro pagamento até 31 de dezembro de 2026'],
    'y.f1':['Community sessions and open resources','Sesiones comunitarias y recursos abiertos','Encontros da comunidade e recursos abertos'],
  };
  const page=name=>readFileSync(new URL('../web/pages/'+name,import.meta.url),'utf8');
  const landing=page('index.html'),payments=page('payments.html');
  // The first <ul> after the opening tag that carries this attribute text.
  const list=(html,mark)=>{const at=html.indexOf(mark);assert.notEqual(at,-1,mark);return html.slice(html.indexOf('<ul',at),html.indexOf('</ul>',at));};
  const keys=part=>[...part.matchAll(/data-i18n="([^"]+)"/g)].map(match=>match[1]);
  // Since 21 Oct 2026 the paid membership is Nodal Fundadores 2027: the landing card lists its four pillars, early access and
  // the discount on further courses; the payments page lists the seven benefits of the terms (payments-links-ui checks those).
  assert.doesNotMatch(list(landing,'<article class="plan">'),/course/i,'the landing free plan offers no courses');
  assert.doesNotMatch(list(payments,'id="gratis"'),/course/i,'the payments page free access offers no courses');
  assert.deepEqual(keys(list(landing,'<article class="plan plan-pro">')).filter(key=>!/Text$/.test(key)),['mem.fund.connect','mem.fund.find','mem.fund.learn','mem.fund.visible','mem.fund.early','mem.fund.discount']);
  assert.ok(landing.includes(`<li data-i18n="mem.f1">${COPY['mem.f1'][0]}</li>`)&&landing.includes(`<li data-i18n="mem.fund.early">${COPY['mem.fund.early'][0]}</li>`));
  assert.ok(payments.includes(`<li data-i18n="y.f1">${COPY['y.f1'][0]}</li>`));
  const home=load('home').api,console_=load(undefined,[],{withConsole:true}).api;
  for(const [index,lang] of [[1,'es'],[2,'pt']]){
    home.apply(lang);console_.apply(lang);
    for(const [key,copy] of Object.entries(COPY))assert.equal((key.startsWith('mem.')?home:console_).t(key),copy[index],`${lang} ${key}`);
  }
});
test('the hero ends on collaborative urbanism, highlighted, and a section after Why it matters explains it, in English, Spanish and Portuguese',()=>{
  // Prof. Mariana's copy, 19 Oct 2026. [en, es, pt]; English is the markup's own text.
  const COPY={
    'hero.subPre':['NODAL connects people, knowledge, data and institutions so urban talent across the region can learn, co-create and activate real projects in their cities through ','NODAL conecta personas, conocimiento, datos e instituciones para que el talento urbano de la región pueda aprender, colaborar y activar proyectos reales en sus ciudades a través del ','A NODAL conecta pessoas, conhecimento, dados e instituições para que o talento urbano da região possa aprender, colaborar e ativar projetos reais em suas cidades por meio do '],
    'hero.subMark':['collaborative urbanism','urbanismo colaborativo','urbanismo colaborativo'],
    'hero.subPost':['.','.','.'],
    'uc.eyebrow':['Our approach','Nuestro enfoque','Nossa abordagem'],
    'uc.title':['Collaborative urbanism','Urbanismo colaborativo','Urbanismo colaborativo'],
    'uc.p':['Collaborative urbanism transforms the way we make cities: it connects knowledge, talent and resources that today work in isolation and turns them into a collective power for transformation. Because cities do not change through better ideas alone, but when people have the connections, the tools and the capacity to act together. Its principle is simple: the more you share, contribute and help others grow, the more opportunities you create for yourself and the greater your collective capacity to transform our cities.','El urbanismo colaborativo transforma la manera en que hacemos ciudad: conecta conocimientos, talentos y recursos que hoy actúan de forma aislada para convertirlos en poder colectivo de transformación. Porque las ciudades no cambian solamente con mejores ideas, sino cuando las personas tienen las conexiones, las herramientas y la capacidad de actuar juntas. Su principio es simple: cuanto más compartes, contribuyes y ayudas a otros a crecer, más oportunidades generas para ti y mayor es tu capacidad colectiva de transformar nuestras ciudades.','O urbanismo colaborativo transforma a maneira como fazemos cidade: conecta conhecimentos, talentos e recursos que hoje atuam de forma isolada para transformá-los em poder coletivo de transformação. Porque as cidades não mudam apenas com ideias melhores, mas quando as pessoas têm as conexões, as ferramentas e a capacidade de agir juntas. Seu princípio é simples: quanto mais você compartilha, contribui e ajuda os outros a crescer, mais oportunidades gera para si e maior é a sua capacidade coletiva de transformar nossas cidades.'],
  };
  const html=readFileSync(new URL('../web/pages/index.html',import.meta.url),'utf8');
  const hero=html.slice(html.indexOf('<p class="hero-sub">'),html.indexOf('</p>',html.indexOf('<p class="hero-sub">')));
  assert.equal(hero,`<p class="hero-sub"><span data-i18n="hero.subPre">${COPY['hero.subPre'][0]}</span><mark data-i18n="hero.subMark">${COPY['hero.subMark'][0]}</mark><span data-i18n="hero.subPost">.</span>`);
  assert.doesNotMatch(html,/data-i18n="hero\.sub"/,'the old single-key introduction is gone');
  const at=id=>html.indexOf(`id="${id}"`);
  assert.ok(at('problem')<at('urbanismo')&&at('urbanismo')<at('insight'),'the section sits between Why it matters and Community paths');
  const section=html.slice(html.lastIndexOf('<section',at('urbanismo')),html.indexOf('</section>',at('urbanismo')));
  for(const key of ['uc.eyebrow','uc.title','uc.p'])assert.ok(section.includes(`data-i18n="${key}">${COPY[key][0]}<`),key);
  assert.match(section,/<span class="hl" data-i18n="uc\.title">/,'the title is highlighted like the other section leads');
  const css=readFileSync(new URL('../web/styles/styles.css',import.meta.url),'utf8');
  assert.match(css,/\.hero-sub mark\s*\{/,'the hero highlight has its own style, not the browser yellow');
  const home=load('home').api;
  for(const [index,lang] of [[1,'es'],[2,'pt']]){home.apply(lang);for(const [key,copy] of Object.entries(COPY))assert.equal(home.t(key),copy[index],`${lang} ${key}`);}
});
