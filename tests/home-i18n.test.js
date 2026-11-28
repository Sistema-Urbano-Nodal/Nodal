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
// On 20 Oct 2026 the landing card stopped printing a price, so its slot's copy (mem.priceSoon,
// y.perMonth, y.perYear) left the dictionaries, and Portuguese calls the paid plan a membresia,
// not an assinatura (res.link here, d.nav.membership in the console), so the Spanish and
// Portuguese nonhome hashes and the Portuguese home hash were redone; tests/fundadores-copy.test.js
// pins those lines.
// On 21 Oct 2026 the console's locked "Founding Member" badge (d.badge.founding.*), whose "by invitation" and
// "founding price" contradicted the Founder Membership, became the first cohort's (eve audit #19), so the two nonhome
// hashes were redone; only those three lines moved, and tests/dashboard-console-ui.test.js pins them.
// On 22 Oct 2026 the console's account-deletion prompt gained the Founder Membership's pending-payment line and its
// refusals their own lines (d.uc.deletePrompt, deleteEmailMismatch, deleteUploading, deleteCertificateUploading), so the
// two nonhome hashes were redone; only those four keys moved, and tests/dashboard-account-errors.test.js pins them.
// On 24 Oct 2026 the deletion prompt (d.uc.deletePrompt) added that a FIIU registration, attendance and certificate hours
// go with the account, so the two nonhome hashes were redone; only that key moved, and the same test pins it.
// On 16 Nov 2026 the code overview's console fixes changed console copy, so the two nonhome hashes were redone. Only these
// keys moved, pinned by tests/overview-console-dashboard.test.js unless named otherwise: d.spine.profileTodo (the route's
// first stop before Part A is done), d.save.cityKept and d.save.close (a city changed in another tab or on another device),
// d.uc.deleteReconciling (a deletion refused for a course upload, pinned by tests/dashboard-account-errors.test.js),
// d.search.directoryUnavailable (a People search that failed), d.eyebrow.assessmentOne (one topic, in the singular),
// d.search.catalogEmpty (reworded so it reads right around any scope's name) and p.signalsSelf (which signals other members
// see on your profile, pinned by tests/profile-ui.test.js). Keys nothing used left both dictionaries the same day: the
// retired Supporting membership page and checkout lines (y.* other than y.free, y.freeName, y.f1-f4, y.faq and y.fund.*,
// which payments.html uses), the old globe panel's d.globe.title/sub/hint/working/roles, d.search.regional and the
// d.badge.sharer/connector/consistent.scope lines the .req lines replaced.
// On 16 Nov 2026 the sign-up hint (a.hint) gained the upper limit sign-up already enforced (8–72), in the invitation page's
// words; only that key moved, and tests/overview-forms-signup-hint.test.js pins it. The two nonhome hashes were redone once
// for both changes when they were merged, and again that day when the homepage catalog's last keys (hero.browse,
// catalog.loadingCases, catalog.casesEmpty, catalog.casesError) left with the loader that read them.
// On 19 Nov 2026 the account-update section got its own heading and scoped read action.
// Only d.notif.account, d.notif.clear and d.notif.clearDone changed in the ES/PT nonhome snapshots.
// On 28 Nov 2026 the homepage copy was shortened. Shared nonhome dictionaries keep their original snapshots.
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
    "es": "81a9d8ccc226ecc84368543dad76b069a50107f9059b22db23e73ea4f6af67bb",
    "pt": "76c45d4beb558bd906c2b0b0fcef89a866f2fe9a6d8ef63edecd11cc3943325c"
  },
  "nonhome": {
    "es": "810c24a455bf737c5d5f75c8151bf695ff476d3ec542fca87e9560b390384492",
    "pt": "8399ef83dc34131448d60d434e24355a429853c4ee8ac05fdcc715696b1824f2"
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
const profilePhotoKeys = new Set([
  'p.photoAdd','p.photoChange','p.photoRemove','p.photoSave','p.photoCancel','p.photoPreparing','p.photoPreview',
  'p.photoUploading','p.photoRemoving','p.photoSaved','p.photoRemoved','p.photoInvalid','p.photoFailed','p.photoWait',
]);
for(const lang of ['es','pt']){
  test('homepage runtime copy matches its reviewed snapshot in '+lang,()=>{
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
      // the account-deletion refusal (October 3 review) by review-fix-5-integration;
      // the console's loading/failure lines, accessible names (d.aria.*) and staff group label (d.nav.team) by dashboard-publishing,
      // the catalog's nothing-published state by catalog-ui, and the console's Show more / Show less (d.news.*) and FIIU badges
      // (d.badge.fiiu.*) by dashboard-console-ui, the console's readings from BUC under Community paths (d.buc.*) by buc-ui, and the
      // console's two-character name refusal (d.uc.errNameShort) just below and by dashboard-console-ui, and the Founder Membership 2027
      // (y.fund.* on the payments page, mem.fund.* on the landing card) by payments-links-ui, landing-membership and the plan copy
      // test at the end of this file. The Supporter courses lines (mem.p7, y.p6) and the Mercado Pago links page (y.mp.*) they replaced are gone.
      const later=key=>profilePhotoKeys.has(key)||['nav.privacy','catalog.retry','catalog.moreError','nav.program','nav.community','nav.learn','nav.fiiu','d.nav.publish','d.nav.team','d.nav.messages','p.groupVisibility','d.nav.messagesUnread','d.search.message','d.search.messageTo','d.uc.deleteSubscription','d.greet.hello','d.greet.loading','d.load.failed','catalog.emptyNothingPublished','catalog.nextFiiu','catalog.nextCourses','d.uc.errNameShort','page.community.title','page.knowledge.title','page.resources.title'].includes(key)||/^(?:ops|news|d\.aria|d\.news|d\.badge\.fiiu|d\.buc|y\.fund|mem\.fund)\./.test(key);
      const actual=Object.entries(dictionaries[lang]).filter(([key])=>!later(key)).sort(([a],[b])=>a.localeCompare(b,'en'));
      assert.equal(hash(actual),SNAPSHOTS.nonhome[lang],String(page));
      const accountLabels = ['d.notif.account','d.notif.clear','d.notif.clearDone'].map(key=>api.t(key));
      assert.deepEqual(accountLabels,lang==='es'
        ? ['Novedades de la cuenta','Marcar las novedades como leídas','Novedades leídas']
        : ['Novidades da conta','Marcar as novidades como lidas','Novidades lidas']);
      for (const key of profilePhotoKeys) assert.ok(dictionaries[lang][key],key+' has '+lang+' copy');
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
  const nodes=[hero],{api}=load('home',nodes);api.apply('pt');assert.match(hero.textContent,/Conheça pessoas da América Latina/);
  const graph={dataset:{i18n:'graph.n.project.k2'},textContent:'Start from real needs and lived experience'};nodes.push(graph);
  api.apply('es');assert.match(hero.textContent,/Conoce a personas de América Latina/);assert.equal(graph.textContent,'Empieza desde necesidades reales y experiencia vivida');
  api.apply('en');assert.equal(hero.textContent,'Original English introduction');assert.equal(graph.textContent,'Start from real needs and lived experience');
});
test('the linked resource headings and the interactive graph labels are available in three languages',()=>{
  const html=readFileSync(new URL('../web/pages/index.html',import.meta.url),'utf8');
  const {api}=load('home');
  for(const [key,route,en,es,pt] of [
    ['res.r1t','courses.html','Courses','Cursos','Cursos'],
    ['res.r2t','opportunities.html?kind=resource,case_study','Library','Biblioteca','Biblioteca'],
    ['res.r3t','opportunities.html?kind=opportunity','Opportunities','Oportunidades','Oportunidades'],
  ]){
    assert.ok(html.includes(`href="${route}" data-i18n="${key}">${en}</a>`));
    api.apply('es');assert.equal(api.t(key),es);
    api.apply('pt');assert.equal(api.t(key),pt);
  }
  assert.match(html,/role="tablist" aria-label="How NODAL works" data-i18n-aria-label="platform\.tabsLabel"/);
  assert.match(html,/id="graph"[^>]+data-i18n-aria-label="graph\.aria"/);
  assert.doesNotMatch(html,/title="Members only"/);
  api.apply('es');assert.equal(api.t('graph.aria'),'Red interactiva de actores');
  api.apply('pt');assert.equal(api.t('platform.tabsLabel'),'Como a NODAL funciona');
});
test('the free plans offer no courses and the Founder Membership lists its own benefits, in English, Spanish and Portuguese',()=>{
  // [en, es, pt]; English is the markup's own text.
  const COPY={
    'mem.f1':['Open labs and community sessions','Laboratorios abiertos y sesiones comunitarias','Laboratórios abertos e encontros comunitários'],
    // Early access starts when the first payment is approved (terms, section 8).
    'mem.fund.early':['Early access from the approval of your first payment until 31 December 2026','Acceso anticipado desde la aprobación de tu primer pago hasta el 31 de diciembre de 2026','Acesso antecipado desde a aprovação do primeiro pagamento até 31 de dezembro de 2026'],
    'y.f1':['Community sessions and open resources','Sesiones comunitarias y recursos abiertos','Encontros da comunidade e recursos abertos'],
  };
  const page=name=>readFileSync(new URL('../web/pages/'+name,import.meta.url),'utf8');
  const landing=page('index.html'),payments=page('payments.html');
  // The first <ul> after the opening tag that carries this attribute text.
  const list=(html,mark)=>{const at=html.indexOf(mark);assert.notEqual(at,-1,mark);return html.slice(html.indexOf('<ul',at),html.indexOf('</ul>',at));};
  const keys=part=>[...part.matchAll(/data-i18n="([^"]+)"/g)].map(match=>match[1]);
  // Since 21 Oct 2026 the paid membership is the Founder Membership 2027: the landing card lists its four pillars, early access and
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
test('the hero ends on collaborative urbanism, highlighted, and the approach section explains it, in English, Spanish and Portuguese',()=>{
  // Keep the team's emphasis on collaborative urbanism in the shorter introduction and its own section.
  const COPY={
    'hero.subPre':['Meet peers across Latin America and explore opportunities in ', 'Conoce a personas de América Latina y explora convocatorias de ', 'Conheça pessoas da América Latina e encontre editais de '],
    'hero.subMark':['collaborative urbanism','urbanismo colaborativo','urbanismo colaborativo'],
    'hero.subPost':['.','.','.'],
    'uc.eyebrow':['Our approach','Nuestro enfoque','Nossa abordagem'],
    'uc.title':['Collaborative urbanism','Urbanismo colaborativo','Urbanismo colaborativo'],
    'uc.p':['Who should help redesign a street? Sistema Urbano brings residents, local governments and practitioners together to compare what they see and decide what to try.', '¿Quién debería participar en el rediseño de una calle? Sistema Urbano reúne a vecinos, municipios y profesionales para comparar lo que observan y decidir juntos qué probar.', 'Quem deve participar do redesenho de uma rua? O Sistema Urbano reúne moradores, prefeituras e profissionais para comparar o que observam e decidir o que testar.'],
  };
  const html=readFileSync(new URL('../web/pages/index.html',import.meta.url),'utf8');
  const hero=html.slice(html.indexOf('<p class="hero-sub">'),html.indexOf('</p>',html.indexOf('<p class="hero-sub">')));
  assert.equal(hero,`<p class="hero-sub"><span data-i18n="hero.subPre">${COPY['hero.subPre'][0]}</span><mark data-i18n="hero.subMark">${COPY['hero.subMark'][0]}</mark><span data-i18n="hero.subPost">.</span>`);
  assert.doesNotMatch(html,/data-i18n="hero\.sub"/,'the old single-key introduction is gone');
  const at=id=>html.indexOf(`id="${id}"`);
  assert.ok(at('membership')<at('urbanismo')&&at('urbanismo')<at('platform'),'the approach follows the membership choices, before the interactive network');
  const section=html.slice(html.lastIndexOf('<section',at('urbanismo')),html.indexOf('</section>',at('urbanismo')));
  for(const key of ['uc.eyebrow','uc.title','uc.p'])assert.ok(section.includes(`data-i18n="${key}">${COPY[key][0]}<`),key);
  assert.match(section,/<span class="hl" data-i18n="uc\.title">/,'the title is highlighted like the other section leads');
  const css=readFileSync(new URL('../web/styles/styles.css',import.meta.url),'utf8');
  assert.match(css,/\.hero-sub mark\s*\{/,'the hero highlight has its own style, not the browser yellow');
  const home=load('home').api;
  for(const [index,lang] of [[1,'es'],[2,'pt']]){home.apply(lang);for(const [key,copy] of Object.entries(COPY))assert.equal(home.t(key),copy[index],`${lang} ${key}`);}
});
