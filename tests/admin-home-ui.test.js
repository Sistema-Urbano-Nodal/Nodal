import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { TEXTS, LEAD, LEAD_SECOND, TRACKED, INDICATORS, FAMILIES, DEFS } from '../server/metrics-catalog.js';

/* The admin home's script (web/scripts/admin-home.js) in a vm context: the page's ids as fake nodes, the real i18n.js
   run after it, and fetch a recording stub answering a fixture built from the catalogue, shaped as GET
   /api/admin/metrics answers it (server/metrics-api.js). No clock is read: every date comes from the fixture. */
const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const SCRIPT = () => read('web', 'scripts', 'admin-home.js');
const STYLE = () => read('web', 'styles', 'admin-home.css');

class FakeNode {
  constructor(tag = '') {
    this.tagName = tag;
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.className = '';
    this.textContent = '';
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.replaced = 0;
    this.clicked = 0;
    this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  }

  append(...nodes) { for (const node of nodes) { if (node && typeof node === 'object') node.parent = this; this.children.push(node); } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.replaced += 1; for (const child of this.children) if (child && typeof child === 'object') child.parent = null; this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this); this.parent = null; }
  setAttribute(name, value) { this[name] = String(value); }
  getAttribute(name) { return this[name] ?? null; }
  removeAttribute(name) { delete this[name]; }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  click() { this.clicked += 1; return this.listeners.get('click')?.(); }
}
const descendants = (node) => (node?.children || []).flatMap((child) => (child && typeof child === 'object' ? [child, ...descendants(child)] : []));
const rendered = (node) => [node?.textContent || '', ...(node?.children || []).map(rendered)].join(' ').replace(/\s+/g, ' ').trim();
const byKey = (node, key) => descendants(node).find((child) => child.dataset.key === key);
const byList = (node, key) => descendants(node).find((child) => child.dataset.list === key);
const count = (text, part) => text.split(part).length - 1;
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const response = (payload, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  async json() { if (payload instanceof Error) throw payload; return structuredClone(payload); },
  async blob() { return { size: 3, type: 'text/csv' }; },
});

const COURSE = 'curso-movilidad-2';
function itemsFor(ind, total) {
  return ({
    'visits.topPages': [{ key: 'index.html', n: 40 }, { key: 'fiiu.html', n: 12 }],
    'visits.sources': [{ key: 'direct', n: 20 }, { key: 'whatsapp', n: 5 }],
    'activity.kinds': [{ key: 'profile', n: 4, d7: 1 }, { key: 'network', n: 2, d7: 0 }],
    'memberships.views': [{ key: 'fundadores.html', n: 7 }, { key: 'payments.html', n: 3 }],
    'festival.profileTypes': [{ key: 'professional', n: 82 }, { key: 'other', n: 34 }, { key: '_other', n: 1 }],
    'festival.countries': [{ text: 'Perú', n: 335 }, { text: '<b>x</b>', n: 4 }, { key: '_other', n: 2 }],
  })[ind.key] ?? [{ key: COURSE, n: total }];
}

/* Every indicator computed: total = 100 + order, 30 days = 50 + order, 7 days = order (signups.accounts 105, its 7-day
   neighbour signups.new 7, signups.confirmed 106, activity.members 67 / 17). */
function fixture() {
  const families = FAMILIES.map((family) => ({
    key: family,
    indicators: INDICATORS.filter((ind) => ind.family === family).map((ind) => {
      const out = { key: ind.key, ...(ind.vocabulary ? { vocabulary: ind.vocabulary } : {}) };
      if (ind.fields.includes('total')) out.total = 100 + ind.order;
      if (ind.fields.includes('d30')) out.d30 = 50 + ind.order;
      if (ind.fields.includes('d7')) out.d7 = ind.order;
      if (ind.fields.includes('items')) out.items = itemsFor(ind, out.total);
      if (ind.key === 'signups.new') Object.assign(out, { last: '2026-10-26', daysSince: 19 });
      return out;
    }),
  }));
  return structuredClone({
    asOf: '2026-11-14T13:36:00.000Z',
    limaDay: '2026-11-14',
    defs: DEFS,
    windows: { d7: { from: '2026-11-08', to: '2026-11-14' }, d30: { from: '2026-10-16', to: '2026-11-14' } },
    families,
    courseNames: { [COURSE]: 'Movilidad Nivel 2' },
    months: {
      from: '2026-07',
      series: {
        accounts: { '2026-07': 9, '2026-08': 0, '2026-09': 43, '2026-10': 473, '2026-11': 0 },
        entered: { '2026-07': 8, '2026-08': 0, '2026-09': 40, '2026-10': 438, '2026-11': 0 },
        registrations: { '2026-07': 0, '2026-08': 0, '2026-09': 120, '2026-10': 255, '2026-11': 0 },
        views: { '2026-11': 40 },
        arrivals: { '2026-11': 12 },
      },
    },
    readings: { today: false, months: [] },
    pending: { interests: 0, orgRequests: 2, lab: 3 },
    visitsSince: '2026-11-01',
    unavailable: [],
    notActivated: [],
    texts: TEXTS,
    lead: LEAD.map(([key, field]) => ({ key, field, second: LEAD_SECOND[key] ?? [] })),
    tracked: TRACKED,
  });
}
const indicator = (answer, key) => answer.families.flatMap((f) => f.indicators).find((ind) => ind.key === key);

/* lang: the page language at evaluation (locale.js sets it before the deferred scripts run). get(url), post() and
   download(url) answer fetch; each defaults to the fixture, {saved: false} and a 500. */
function home({ lang = 'es', answer = fixture(), get, post, download } = {}) {
  const ids = new Map([...read('web', 'pages', 'admin-home.html').matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], new FakeNode(match[1])]));
  for (const id of ['homeRetry', 'homeSignIn', 'homePending', 'homeReadingsCsv']) ids.get(id).hidden = true;
  const created = [];
  const documentListeners = new Map();
  const windowListeners = new Map();
  const documentElement = new FakeNode('html');
  documentElement.lang = lang;
  const skip = new FakeNode('a');
  const body = new FakeNode('body');
  body.dataset.page = 'admin-home';
  const document = {
    documentElement,
    body,
    title: '',
    getElementById: (id) => ids.get(id) ?? null,
    createElement: (tag) => { const node = new FakeNode(tag); created.push(node); return node; },
    querySelector: (selector) => (selector === '.admin-skip' ? skip : null),
    querySelectorAll: () => [],
    addEventListener: (name, handler) => documentListeners.set(name, handler),
  };
  const calls = [];
  const fetch = (url, init = {}) => {
    calls.push({ url, init });
    if (url === '/api/admin/metrics/readings') return post ? post() : Promise.resolve(response({ saved: false, day: answer.limaDay }));
    if (url.startsWith('/api/admin/metrics/export')) return download ? download(url) : Promise.resolve(response({}, 500));
    return get ? get(url) : Promise.resolve(response(answer));
  };
  const printed = [];
  const context = {
    document, fetch, console, setTimeout, clearTimeout, URLSearchParams,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
    location: { search: '' },
    nodalLocale: { read: () => lang, save() {}, chosen: () => false },
    addEventListener: (name, handler) => windowListeners.set(name, handler),
    print: () => printed.push(true),
  };
  context.window = context;
  vm.runInNewContext(SCRIPT(), context, { filename: 'admin-home.js' });
  vm.runInNewContext(read('web', 'scripts', 'i18n.js'), context, { filename: 'i18n.js' });
  const id = (name) => ids.get(name);
  return {
    ids, id, calls, created, printed, skip, document,
    gets: () => calls.filter((c) => c.url.startsWith('/api/admin/metrics') && !c.url.startsWith('/api/admin/metrics/')),
    posts: () => calls.filter((c) => c.url === '/api/admin/metrics/readings'),
    ready: () => documentListeners.get('DOMContentLoaded')?.(),
    apply: (next) => context.window.nodalI18n.apply(next, { persist: false }),
    fire: (name) => windowListeners.get(name)?.(),
  };
}

test('the chrome is painted from the page language at evaluation', () => {
  const page = home({ get: () => new Promise(() => {}) });
  assert.equal(page.id('homeTitle').textContent, 'Indicadores de NODAL');
  assert.equal(page.skip.textContent, 'Saltar al contenido');
  assert.equal(page.id('homeCsv').textContent, 'Descargar CSV');
  assert.equal(page.id('homePrint').textContent, 'Imprimir o guardar como PDF');
  assert.equal(page.id('homeRefresh').textContent, 'Actualizar');
  assert.equal(page.id('homeRetry').textContent, 'Reintentar');
  assert.equal(page.id('homeReadingsCsv').textContent, 'Descargar lecturas CSV');
  assert.equal(page.id('homePrintHead').textContent, 'NODAL · Reporte de indicadores');
  assert.equal(page.gets().length, 1);
  assert.equal(page.gets()[0].url, '/api/admin/metrics');
  assert.equal(page.gets()[0].init.credentials, 'same-origin');
});

for (const lang of ['es', 'en', 'pt']) {
  test(`renders the five lead numbers and every block in the page language (${lang})`, async () => {
    const answer = fixture();
    const page = home({ lang, answer });
    await flush();
    const words = TEXTS[lang];
    const lead = page.id('homeLead');
    assert.deepEqual(lead.children.map((group) => group.dataset.key), answer.lead.map((entry) => entry.key));
    for (const [i, { key, field, second }] of answer.lead.entries()) {
      const text = rendered(lead.children[i]);
      assert.ok(text.includes(String(indicator(answer, key)[field])), `${key} ${text}`);
      assert.ok(text.includes(words.indicators[key].name), `${key} name`);
      assert.equal(lead.children[i].children.length, 1 + second.length, `${key} lines`);
      for (const [j, [k, f]] of second.entries()) {
        const line = rendered(lead.children[i].children[1 + j]);
        assert.ok(line.includes(String(indicator(answer, k)[f])) && line.includes(words.indicators[k].name), `${key} second ${line}`);
      }
    }
    const accounts = lead.children[answer.lead.findIndex((e) => e.key === 'signups.accounts')];
    assert.match(rendered(accounts.children[1]), new RegExp(`^7 ${words.indicators['signups.new'].name}`));
    assert.match(rendered(accounts.children[2]), new RegExp(`^106 ${words.indicators['signups.confirmed'].name}`));

    const blocks = page.id('homeBlocks');
    assert.deepEqual(blocks.children.map((block) => block.dataset.family), FAMILIES);
    for (const [i, family] of FAMILIES.entries()) {
      const block = blocks.children[i];
      assert.ok(rendered(block).includes(words.families[family]), family);
      const details = descendants(block).filter((node) => node.tagName === 'details');
      assert.equal(details.length, 1, `${family} details`);
      const summary = details[0].children.find((node) => node.tagName === 'summary');
      assert.equal(summary.textContent, { es: 'Cómo se cuenta', en: 'How it is counted', pt: 'Como se conta' }[lang]);
      const how = rendered(details[0]);
      for (const ind of INDICATORS.filter((x) => x.family === family)) {
        const { name, definition, source, caveat } = words.indicators[ind.key];
        for (const part of [name, definition, source, caveat]) assert.ok(how.includes(part), `${ind.key}: ${part}`);
      }
    }
    if (lang === 'es') {
      assert.equal(page.id('homeAsOf').textContent, 'Datos al 14 nov 2026, 08:36 (hora de Lima)');
      const windows = rendered(page.id('homeWindows'));
      for (const part of ['Últimos 7 días: 8–14 nov', 'Últimos 30 días: 16 oct–14 nov', '19 días sin cuentas nuevas (última: 26 oct)']) assert.ok(windows.includes(part), windows);
      const pending = page.id('homePending');
      assert.equal(pending.hidden, false);
      assert.ok(rendered(pending).startsWith('Por atender'));
      assert.deepEqual(descendants(pending).filter((n) => n.tagName === 'a').map((a) => a.href), ['admin.html#interests', 'admin.html#nodes', 'fiiu-admin.html']);
      const links = descendants(blocks).filter((n) => n.tagName === 'a');
      assert.deepEqual(links.map((a) => [a.href, a.textContent]), [['fiiu-admin.html', 'Ver en Festival'], ['teaching.html', 'Ver en Cursos']]);
      assert.equal(page.id('homeStatus').textContent, '');
    }
  });
}

test('a zero is 0 and a failure is a dash with its reason', async () => {
  const answer = fixture();
  indicator(answer, 'signups.team').total = 0;
  for (const key of ['total']) delete indicator(answer, 'profiles.bio')[key];
  indicator(answer, 'profiles.bio').state = 'unavailable';
  delete indicator(answer, 'festival.hours').total;
  indicator(answer, 'festival.hours').state = 'not_activated';
  delete indicator(answer, 'festival.qrPeople').total;
  indicator(answer, 'festival.qrPeople').state = 'not_activated';
  const page = home({ answer });
  await flush();
  const blocks = page.id('homeBlocks');
  const zero = descendants(byKey(blocks, 'signups.team')).find((n) => n.textContent === '0');
  assert.ok(zero, 'the zero is printed');
  assert.match(zero.className, /\bis-zero\b/);
  const bio = rendered(byKey(blocks, 'profiles.bio'));
  assert.match(bio, /— No disponible en este momento/);
  assert.doesNotMatch(bio, /\d/);
  const festival = rendered(blocks.children[FAMILIES.indexOf('festival')]);
  assert.equal(count(festival, 'Aún no está activado en la base de datos'), 1);
  assert.match(rendered(byKey(blocks, 'festival.hours')), /—/);

  for (const [since, heading] of [[null, 'Aún no hay visitas contadas'], ['2026-11-17', 'Se cuenta desde el 17 nov 2026']]) {
    const quiet = fixture();
    quiet.visitsSince = since;
    for (const ind of quiet.families[0].indicators) { for (const f of ['d30', 'd7', 'items']) delete ind[f]; ind.state = 'not_yet_counted'; }
    const visits = home({ answer: quiet });
    await flush();
    const block = visits.id('homeBlocks').children[0];
    assert.ok(rendered(block).includes(heading), rendered(block));
    assert.doesNotMatch(rendered(byKey(block, 'visits.views')), /\d/);
    if (!since) assert.doesNotMatch(rendered(block), /Se cuenta desde el/);
  }
});

test('the lead row and the tracking rows come from the answer', async () => {
  const answer = fixture();
  answer.lead = answer.lead.slice().reverse().slice(0, 3);
  answer.tracked = ['courses.enrolled', 'signups.accounts'];
  answer.readings = { today: true, months: [{ month: '2026-11', day: '2026-11-14', defs: DEFS, figures: { 'courses.enrolled': 21, 'signups.accounts': 525 } }] };
  const page = home({ answer });
  await flush();
  assert.deepEqual(page.id('homeLead').children.map((g) => g.dataset.key), answer.lead.map((e) => e.key));
  const rows = descendants(page.id('homeTracking')).filter((n) => n.tagName === 'tr' && n.dataset.key);
  assert.deepEqual(rows.map((r) => r.dataset.key), ['courses.enrolled', 'signups.accounts']);

  const empty = fixture();
  empty.lead = [];
  empty.tracked = [];
  empty.readings = { today: true, months: [{ month: '2026-11', day: '2026-11-14', defs: DEFS, figures: {} }] };
  const bare = home({ answer: empty });
  await flush();
  assert.equal(bare.id('homeLead').children.length, 0);
  assert.equal(descendants(bare.id('homeTracking')).filter((n) => n.tagName === 'tr' && n.dataset.key).length, 0);
  assert.equal(bare.id('homeStatus').textContent, '');

  const source = SCRIPT();
  assert.ok(!source.includes("'profiles.basic'"));
  assert.ok(!source.includes("'memberships.acceptors'"));
});

test('a visit figure younger than its window says since when it is counted', async () => {
  // The counter began on 1 Nov: inside the 30 days (from 16 Oct), before the 7 days (from 8 Nov).
  const answer = fixture();
  answer.lead = [{ key: 'visits.arrivals', field: 'd30', second: [['visits.views', 'd7']] }, ...answer.lead.slice(1)];
  const page = home({ answer });
  await flush();
  const [arrivals, accounts] = page.id('homeLead').children;
  assert.match(rendered(arrivals.children[0]), /^52 Llegadas · 30 días Se cuenta desde el 1 nov 2026$/);
  assert.equal(rendered(arrivals.children[1]), '1 Páginas vistas · 7 días', 'the 7 days are all counted');
  assert.doesNotMatch(rendered(accounts), /Se cuenta desde/, 'only visit figures');
  const views = rendered(byList(page.id('homeBlocks'), 'memberships.views'));
  assert.match(views, /· 30 días/);
  assert.match(views, /Se cuenta desde el 1 nov 2026$/);

  const old = fixture();
  old.visitsSince = '2026-10-16';
  const whole = home({ answer: old });
  await flush();
  assert.equal(rendered(whole.id('homeLead').children[0].children[0]), '52 Llegadas · 30 días');
  assert.doesNotMatch(rendered(byList(whole.id('homeBlocks'), 'memberships.views')), /Se cuenta desde/);
  const en = home({ lang: 'en', answer: fixture() });
  await flush();
  assert.match(rendered(en.id('homeLead').children[0].children[0]), /Counted since Nov 1, 2026$/);
});

test('the festival registrations say how many are the team\'s', async () => {
  const answer = fixture();
  indicator(answer, 'festival.registrations').team = 2;
  const page = home({ answer });
  await flush();
  const total = indicator(answer, 'festival.registrations').total;
  assert.equal(rendered(byKey(page.id('homeBlocks'), 'festival.registrations')), `Inscripciones (incluye 2 del equipo) ${total}`);
  page.ready();
  page.apply('en');
  await flush();
  assert.ok(rendered(byKey(page.id('homeBlocks'), 'festival.registrations')).includes('(includes 2 from the team)'));
  page.apply('pt');
  await flush();
  assert.ok(rendered(byKey(page.id('homeBlocks'), 'festival.registrations')).includes('(inclui 2 da equipe)'));
  for (const team of [0, undefined]) {
    const none = fixture();
    indicator(none, 'festival.registrations').team = team;
    const bare = home({ answer: none });
    await flush();
    assert.equal(rendered(byKey(bare.id('homeBlocks'), 'festival.registrations')), `Inscripciones ${total}`);
  }
});

test('a list names its window, and an empty list is a zero', async () => {
  const answer = fixture();
  indicator(answer, 'visits.sources').items = [];
  indicator(answer, 'signups.new').daysSince = 1;
  const page = home({ answer });
  await flush();
  const blocks = page.id('homeBlocks');
  assert.equal(rendered(byList(blocks, 'visits.sources')), 'De dónde llegan · 30 días 0');
  assert.match(rendered(byList(blocks, 'visits.topPages')), /^Páginas más vistas · 30 días Inicio 40 · FIIU Fest 12$/);
  assert.match(rendered(byList(blocks, 'activity.kinds')), /^Actividad por tipo · 30 días perfil/);
  assert.match(rendered(byList(blocks, 'festival.countries')), /^País \(respuesta de inscripción\) Perú 335/, 'a total list has no window');
  // Label and number are joined by real text, never by a stylesheet.
  const [first] = byList(blocks, 'visits.topPages').children.filter((n) => n && n.className === 'home-item');
  assert.deepEqual(first.children.map((n) => (typeof n === 'string' ? n : n.textContent)), ['Inicio', ' ', '40']);
  assert.ok(byList(blocks, 'visits.topPages').children.some((n) => n && n.className === 'home-sep' && n.textContent === ' · '));
  assert.doesNotMatch(STYLE(), /\.home-item[^{]*::before/);
  assert.ok(rendered(page.id('homeWindows')).includes('1 día sin cuentas nuevas (última: 26 oct)'), rendered(page.id('homeWindows')));
  for (const block of blocks.children) {
    const table = descendants(block).find((n) => n.tagName === 'table');
    const title = descendants(block).find((n) => n.tagName === 'h2');
    if (table) assert.equal(table['aria-labelledby'], title.id, block.dataset.family);
  }
  const how = rendered(descendants(blocks).find((n) => n.tagName === 'details'));
  assert.ok(how.includes('Límites: No dice cuántas personas fueron.'), how.slice(0, 400));
  assert.doesNotMatch(how, /No dice: No dice/);
});

test('lists are labelled after the fact', async () => {
  const page = home();
  await flush();
  const blocks = page.id('homeBlocks');
  const types = rendered(byList(blocks, 'festival.profileTypes'));
  assert.ok(types.includes('otros (menos de 3) 1'), types);
  assert.ok(types.includes('otro 34'), types);
  assert.ok(types.includes('profesional 82'), types);
  const countries = rendered(byList(blocks, 'festival.countries'));
  assert.ok(countries.includes('Perú 335'), countries);
  assert.ok(countries.includes('<b>x</b> 4'), countries);
  assert.equal(page.created.filter((n) => n.tagName === 'b').length, 0);
  assert.ok(rendered(byList(blocks, 'visits.sources')).includes('directo 20'));
});

test('several courses label each course row from courseNames', async () => {
  const answer = fixture();
  answer.courseNames = { a: 'Curso A', b: 'Curso B' };
  for (const ind of answer.families.find((f) => f.key === 'courses').indicators) if (ind.items) ind.items = [{ key: 'a', n: 4 }, { key: 'b', n: 6 }];
  const page = home({ answer });
  await flush();
  const enrolled = rendered(byList(page.id('homeBlocks'), 'courses.enrolled'));
  assert.ok(enrolled.includes('Curso A 4') && enrolled.includes('Curso B 6'), enrolled);
});

test('a language change re-renders without a request', async () => {
  const page = home();
  await flush();
  page.ready();
  const before = page.id('homeLead').children.map((g) => rendered(g).match(/\d+/g).join(','));
  page.apply('pt');
  await flush();
  assert.equal(page.id('homeTitle').textContent, 'Indicadores da NODAL');
  assert.ok(rendered(page.id('homeLead')).includes(TEXTS.pt.indicators['signups.accounts'].name));
  assert.deepEqual(page.id('homeLead').children.map((g) => rendered(g).match(/\d+/g).join(',')), before);
  assert.ok(rendered(page.id('homeBlocks')).includes('Como se conta'));
  assert.equal(page.calls.length, 2);
  assert.equal(page.gets().length, 1);
  assert.equal(page.posts().length, 1);
});

test('a language change during the first load neither repeats the request nor the reading', async () => {
  const gate = deferred();
  const page = home({ get: () => gate.promise });
  page.ready();
  page.apply('en');
  page.apply('pt');
  await flush();
  assert.equal(page.id('homeBlocks').replaced, 0);
  gate.resolve(response(fixture()));
  await flush();
  assert.equal(page.gets().length, 1);
  assert.equal(page.posts().length, 1);
  assert.equal(page.id('homeBlocks').replaced, 1);
  assert.ok(rendered(page.id('homeBlocks')).includes('Como se conta'));
  assert.equal(page.id('homeTitle').textContent, 'Indicadores da NODAL');
});

test('the reading is sent only when today has none and the answer is complete', async () => {
  const today = fixture();
  today.readings.today = true;
  const done = home({ answer: today });
  await flush();
  assert.equal(done.posts().length, 0);

  const notSaved = (part) => `La lectura de hoy aún no se guardó. Falta: ${part}. Se guardará al abrir esta página con todos los datos.`;
  for (const [change, part] of [
    [(a) => { a.unavailable = [{ part: 'courses', reason: 'timeout' }]; }, 'cursos'],
    [(a) => { a.notActivated = ['members']; }, 'datos de miembros'],
    [(a) => { a.notActivated = ['members']; a.unavailable = [{ part: 'accounts', reason: 'error' }]; }, 'cuentas, datos de miembros'],
  ]) {
    const answer = fixture();
    change(answer);
    const page = home({ answer });
    await flush();
    assert.equal(page.posts().length, 0);
    assert.ok(rendered(page.id('homeTracking')).includes(notSaved(part)), rendered(page.id('homeTracking')));
  }

  const page = home();
  await flush();
  assert.equal(page.posts().length, 1);
  const [{ init }] = page.posts();
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'same-origin');
  assert.equal(init.body, undefined);

  const rejected = home({ post: () => Promise.reject(new Error('offline')) });
  await flush();
  rejected.ready();
  rejected.apply('en');
  rejected.id('homeRefresh').click();
  await flush();
  assert.equal(rejected.gets().length, 2);
  assert.equal(rejected.posts().length, 1);
  assert.equal(rejected.id('homeStatus').textContent, '');
  assert.ok(!rendered(rejected.id('homeTracking')).includes('read on day'));

  // A page left open into the next Lima day sends that day's reading on its next refresh, once.
  let day = '2026-11-14';
  const open = home({ get: () => { const next = fixture(); next.limaDay = day; return Promise.resolve(response(next)); },
    post: () => Promise.resolve(response({ saved: false, day })) });
  await flush();
  open.id('homeRefresh').click();
  await flush();
  assert.equal(open.posts().length, 1, 'the same day: no second reading');
  day = '2026-11-15';
  open.id('homeRefresh').click();
  await flush();
  assert.equal(open.posts().length, 2, 'the next Lima day: its own reading');
  open.id('homeRefresh').click();
  await flush();
  assert.equal(open.posts().length, 2);
});

test('a saved reading appears in Seguimiento at once', async () => {
  const answer = fixture();
  const page = home({ answer, post: () => Promise.resolve(response({ saved: true, day: '2026-11-14' })) });
  await flush();
  const tracking = page.id('homeTracking');
  const heads = descendants(tracking).filter((n) => n.tagName === 'th' && n.dataset.month);
  assert.deepEqual(heads.map((h) => h.dataset.month), ['2026-11']);
  assert.ok(rendered(heads[0]).includes('nov 2026') && rendered(heads[0]).includes('leído el 14'), rendered(heads[0]));
  const rows = descendants(tracking).filter((n) => n.tagName === 'tr' && n.dataset.key);
  assert.deepEqual(rows.map((r) => r.dataset.key), TRACKED);
  assert.ok(rendered(byKey(tracking, 'signups.accounts')).endsWith('105'));
  assert.ok(rendered(byKey(tracking, 'activity.members.d30')).endsWith('67'));
  assert.ok(rendered(byKey(tracking, 'activity.members.d7')).endsWith('17'));
  assert.equal(page.calls.length, 2);
  assert.equal(page.id('homeReadingsCsv').hidden, false);
  page.ready();
  page.apply('pt');
  await flush();
  assert.ok(rendered(page.id('homeTracking')).includes('lido no dia 14'));
  assert.equal(page.calls.length, 2);

  for (const post of [
    () => Promise.resolve(response({ saved: false, day: '2026-11-14' })),
    () => Promise.reject(new Error('offline')),
    () => Promise.resolve(response({ saved: true, day: '2026-11-15' })),
  ]) {
    const other = home({ post });
    await flush();
    const text = rendered(other.id('homeTracking'));
    assert.ok(!text.includes('leído el'), text);
    assert.ok(text.includes('Aún no hay lecturas guardadas.'), text);
    assert.ok(text.includes('Cuentas nuevas') && text.includes('jul 9'), text);
  }

  const earlier = fixture();
  earlier.readings.months = [{ month: '2026-11', day: '2026-11-03', defs: DEFS, figures: { 'signups.accounts': 90 } }];
  const replaced = home({ answer: earlier, post: () => Promise.resolve(response({ saved: true, day: '2026-11-14' })) });
  await flush();
  const text = rendered(replaced.id('homeTracking'));
  assert.ok(text.includes('leído el 14') && !text.includes('leído el 3'), text);
  assert.equal(descendants(replaced.id('homeTracking')).filter((n) => n.tagName === 'th' && n.dataset.month).length, 1);
});

test('tracking shows one column per month that has a reading', async () => {
  const answer = fixture();
  answer.defs = 2;
  answer.readings = { today: true, months: [
    { month: '2026-11', day: '2026-11-14', defs: 1, figures: { 'signups.accounts': 90, 'profiles.city': 0 } },
    { month: '2026-12', day: '2026-12-02', defs: 2, figures: { 'signups.accounts': 120, 'signups.confirmed': 110 } },
  ] };
  answer.months.series.registrations = { state: 'unavailable' };
  const page = home({ answer });
  await flush();
  const tracking = page.id('homeTracking');
  const heads = descendants(tracking).filter((n) => n.tagName === 'th' && n.dataset.month);
  assert.deepEqual(heads.map((h) => h.dataset.month), ['2026-11', '2026-12']);
  assert.ok(rendered(heads[0]).includes('nov 2026') && rendered(heads[0]).includes('leído el 14'));
  assert.ok(rendered(heads[1]).includes('dic 2026') && rendered(heads[1]).includes('leído el 2'));
  assert.ok(rendered(heads[0]).includes('leído con definiciones anteriores'));
  assert.ok(!rendered(heads[1]).includes('leído con definiciones anteriores'));
  const rows = descendants(tracking).filter((n) => n.tagName === 'tr' && n.dataset.key);
  assert.deepEqual(rows.map((r) => r.dataset.key), TRACKED);
  // a reading without a key leaves the cell blank
  const confirmed = byKey(tracking, 'signups.confirmed').children.filter((n) => n.tagName === 'td');
  assert.equal(rendered(confirmed[0]), '');
  assert.equal(rendered(confirmed[1]), '110');
  const city = byKey(tracking, 'profiles.city').children.filter((n) => n.tagName === 'td');
  assert.equal(rendered(city[0]), '0');
  assert.ok(rendered(tracking).includes('Lecturas desde nov 2026.'));
  assert.ok(!rendered(tracking).includes('undefined'));

  const series = (name) => rendered(descendants(tracking).find((n) => n.dataset.series === name));
  assert.match(series('accounts'), /^Cuentas nuevas jul 9 · ago 0 · sept 43 · oct 473 · nov 0$/);
  const scroller = descendants(tracking).find((n) => n.className === 'home-scroll');
  assert.deepEqual([scroller.tabindex, scroller.role, scroller['aria-label']], ['0', 'region', 'Seguimiento']);
  assert.equal(series('registrations'), 'Inscripciones al festival — No disponible en este momento');
  assert.match(series('views'), /^Páginas vistas nov 40$/);
  assert.equal(page.posts().length, 0);
});

const STATUS = {
  failed: 'No se pudieron cargar los indicadores.',
  tooMany: 'Demasiadas solicitudes. Espera un minuto e inténtalo de nuevo.',
  expired: 'Tu sesión terminó. Inicia sesión de nuevo.',
  denied: 'Tu cuenta ya no tiene acceso de administración.',
  notHere: 'Los indicadores no están disponibles en esta instalación.',
};

test('the whole answer failed', async () => {
  for (const [first, row] of [
    [() => Promise.reject(new Error('offline')), 'failed'],
    [() => Promise.resolve(response({ error: 'x' }, 500)), 'failed'],
    [() => Promise.resolve(response(new SyntaxError('not json'))), 'failed'],
    [() => Promise.resolve(response({ error: 'slow down' }, 429)), 'tooMany'],
    [() => Promise.resolve(response({ error: 'x' }, 503)), 'failed'],
  ]) {
    const gate = deferred();
    let n = 0;
    const page = home({ get: () => { n += 1; return n === 1 ? first() : gate.promise; } });
    await flush();
    assert.equal(page.id('homeStatus').textContent, STATUS[row]);
    assert.equal(page.id('homeRetry').hidden, false);
    assert.equal(page.id('homeSignIn').hidden, true);
    assert.equal(page.id('homeBlocks').children.length, 0);
    page.id('homeRetry').click();
    assert.equal(page.id('homeRetry').disabled, true);
    assert.equal(page.id('homeStatus').textContent, 'Cargando…', 'a retry says it is working');
    page.id('homeRetry').click();
    assert.equal(page.gets().length, 2);
    assert.equal(page.gets()[1].url, '/api/admin/metrics');
    gate.resolve(response(fixture()));
    await flush();
    assert.equal(page.id('homeRetry').disabled, false);
    assert.equal(page.id('homeRetry').hidden, true);
    assert.equal(page.id('homeStatus').textContent, '');
    assert.equal(page.id('homeBlocks').children.length, FAMILIES.length);
  }

  const expired = home({ get: () => Promise.resolve(response({ error: 'sign in required' }, 401)) });
  await flush();
  assert.equal(expired.id('homeStatus').textContent, STATUS.expired);
  assert.equal(expired.id('homeSignIn').hidden, false);
  assert.equal(expired.id('homeSignIn').href, 'login.html?next=%2Fadmin-home.html');
  assert.equal(expired.id('homeRetry').hidden, true);

  const denied = home({ get: () => Promise.resolve(response({ error: 'administrator access required' }, 403)) });
  await flush();
  assert.equal(denied.id('homeStatus').textContent, STATUS.denied);
  assert.equal(denied.id('homeRetry').hidden, true, 'a retry could never succeed');
  assert.equal(denied.id('homeSignIn').hidden, true);

  const missing = home({ get: () => Promise.resolve(response({ error: 'not found' }, 404)) });
  await flush();
  assert.equal(missing.id('homeStatus').textContent, STATUS.notHere);
  assert.equal(missing.id('homeRetry').hidden, true);
  assert.equal(missing.posts().length, 0);
});

test('Refresh asks for fresh figures', async () => {
  const gate = deferred();
  let n = 0;
  const page = home({ get: () => { n += 1; return n === 1 ? Promise.resolve(response(fixture())) : gate.promise; } });
  await flush();
  page.id('homeRefresh').click();
  assert.equal(page.gets()[1].url, '/api/admin/metrics?fresh=1');
  assert.equal(page.id('homeRefresh').disabled, true);
  gate.resolve(response({ error: 'slow down' }, 429));
  await flush();
  assert.equal(page.id('homeRefresh').disabled, false);
  assert.equal(page.id('homeStatus').textContent, STATUS.tooMany);
  assert.ok(rendered(page.id('homeLead')).includes('105'));
  assert.equal(page.id('homeBlocks').children.length, FAMILIES.length);
});

test('the CSV is fetched as a blob and failures are said on the page', async () => {
  const name = 'nodal-indicadores-2026-11-14.csv';
  const ok = home({ download: () => Promise.resolve(response('', 200, { 'content-disposition': `attachment; filename="${name}"` })) });
  await flush();
  await ok.id('homeCsv').click();
  await flush();
  const exportCall = ok.calls.find((c) => c.url.startsWith('/api/admin/metrics/export'));
  assert.equal(exportCall.url, '/api/admin/metrics/export?table=indicators&lang=es');
  assert.equal(exportCall.init.credentials, 'same-origin');
  const link = ok.created.find((n) => n.tagName === 'a' && n.download === name);
  assert.ok(link, 'a download link was made');
  assert.equal(link.href, 'blob:test');
  assert.equal(link.clicked, 1);
  assert.equal(ok.id('homeCsv').disabled, false);

  for (const [status, row] of [[401, 'expired'], [429, 'tooMany']]) {
    const page = home({ download: () => Promise.resolve(response({ error: 'x' }, status)) });
    await flush();
    await page.id('homeCsv').click();
    await flush();
    assert.equal(page.id('homeStatus').textContent, STATUS[row]);
    assert.equal(page.created.filter((n) => n.tagName === 'a' && n.clicked).length, 0);
    assert.equal(page.id('homeBlocks').children.length, FAMILIES.length);
    if (status === 401) assert.equal(page.id('homeSignIn').hidden, false);
  }

  // A later success takes back what the failed download said.
  let status = 401;
  const again = home({ download: () => Promise.resolve(status === 200 ? response('', 200, { 'content-disposition': `attachment; filename="${name}"` }) : response({ error: 'x' }, status)) });
  await flush();
  await again.id('homeCsv').click();
  await flush();
  assert.equal(again.id('homeStatus').textContent, STATUS.expired);
  assert.equal(again.id('homeSignIn').hidden, false);
  status = 200;
  await again.id('homeCsv').click();
  await flush();
  assert.equal(again.id('homeStatus').textContent, '');
  assert.equal(again.id('homeSignIn').hidden, true);
  // What a failed refresh said is not a download's to clear.
  const stale = home({ get: (url) => Promise.resolve(url.includes('fresh') ? response({ error: 'slow down' }, 429) : response(fixture())),
    download: () => Promise.resolve(response('', 200, { 'content-disposition': `attachment; filename="${name}"` })) });
  await flush();
  stale.id('homeRefresh').click();
  await flush();
  await stale.id('homeCsv').click();
  await flush();
  assert.equal(stale.id('homeStatus').textContent, STATUS.tooMany);

  // On a page whose first load failed, a download that works after one that failed gives the retry button its words back.
  for (const failure of [() => Promise.resolve(response({ error: 'x' }, 429)), () => Promise.reject(new Error('offline'))]) {
    let works = false;
    const gate = deferred();
    let gets = 0;
    const empty = home({ get: () => { gets += 1; return gets === 1 ? Promise.resolve(response({ error: 'x' }, 500)) : gate.promise; },
      download: () => (works ? Promise.resolve(response('', 200, { 'content-disposition': `attachment; filename="${name}"` })) : failure()) });
    await flush();
    assert.equal(empty.id('homeStatus').textContent, STATUS.failed);
    assert.equal(empty.id('homeRetry').hidden, false);
    // Twice: the status kept is the one from before the first failure, not a failed download's own.
    for (let i = 0; i < 2; i += 1) { await empty.id('homeCsv').click(); await flush(); }
    works = true;
    await empty.id('homeCsv').click();
    await flush();
    assert.equal(empty.created.filter((n) => n.tagName === 'a' && n.clicked).length, 1);
    assert.equal(empty.id('homeStatus').textContent, STATUS.failed, 'the load failure is said again');
    assert.equal(empty.id('homeRetry').hidden, false);
    assert.equal(empty.id('homeBlocks').children.length, 0);
    // A retry that works leaves nothing of it behind, and a later download keeps the status empty.
    empty.id('homeRetry').click();
    gate.resolve(response(fixture()));
    await flush();
    assert.equal(empty.id('homeStatus').textContent, '');
    await empty.id('homeCsv').click();
    await flush();
    assert.equal(empty.id('homeStatus').textContent, '');
    assert.equal(empty.id('homeRetry').hidden, true);
  }

  const months = home({ download: () => Promise.resolve(response('', 200, { 'content-disposition': 'attachment; filename="nodal-indicadores-por-mes-2026-11-14.csv"' })) });
  await flush();
  assert.equal(months.id('homeMonthsCsv').textContent, 'Descargar por mes CSV');
  await months.id('homeMonthsCsv').click();
  await flush();
  assert.equal(months.calls.find((c) => c.url.startsWith('/api/admin/metrics/export')).url, '/api/admin/metrics/export?table=months&lang=es');

  const readings = home({ download: () => Promise.resolve(response('', 200, { 'content-disposition': 'attachment; filename="nodal-indicadores-lecturas-2026-11-14.csv"' })) });
  await flush();
  await readings.id('homeReadingsCsv').click();
  await flush();
  assert.equal(readings.calls.find((c) => c.url.startsWith('/api/admin/metrics/export')).url, '/api/admin/metrics/export?table=readings&lang=es');
});

test('printing opens every definition and closes them again', async () => {
  const page = home();
  await flush();
  const details = descendants(page.id('homeBlocks')).filter((n) => n.tagName === 'details');
  assert.equal(details.length, FAMILIES.length);
  details[2].open = true;
  page.fire('beforeprint');
  assert.ok(details.every((d) => d.open));
  page.fire('afterprint');
  assert.deepEqual(details.map((d) => d.open), details.map((_, i) => i === 2));
  page.id('homePrint').click();
  assert.equal(page.printed.length, 1);
});

function block(css, start) {
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return '';
}

test('source rules', () => {
  const js = SCRIPT();
  assert.doesNotMatch(js, /(?<![\w$])t\(/);
  assert.doesNotMatch(js, /function t\b/);
  assert.doesNotMatch(js, /'(?:ops|d|p|y)\./);
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML/);
  const css = STYLE().replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/border-left(?:-width)?\s*:\s*([\d.]+)px/g)) assert.ok(Number(m[1]) < 3, m[0]);
  assert.doesNotMatch(css, /box-shadow/);
  assert.doesNotMatch(css, /border-radius/);
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/g)) assert.equal(m[1].trim(), 'inherit');
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  assert.ok(css.includes('@media (max-width: 640px)'));
  const print = block(css, css.indexOf('@media print'));
  assert.ok(css.includes('@media print'));
  for (const selector of ['.navbar', '.staff-nav', 'button', '#homePending']) assert.ok(print.includes(selector), selector);
  assert.match(print, /#homePrintHead\s*\{[^}]*display:\s*block/);
});
