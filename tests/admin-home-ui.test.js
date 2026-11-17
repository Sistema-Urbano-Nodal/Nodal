import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { TEXTS, LEAD, LEAD_SECOND, TRACKED, INDICATORS, FAMILIES, DEFS, ROUTE, SERIES_INDICATOR, PAIRS } from '../server/metrics-catalog.js';

/* The admin home's script (web/scripts/admin-home.js) in a vm context. The page's markup becomes a tree of fake nodes,
   so the script's moves, re-orders and selector queries act on it as they would in a browser; the real i18n.js runs
   after it; fetch is a recording stub answering a fixture built from the catalogue, shaped as GET /api/admin/metrics
   answers it (server/metrics-api.js: the computed figures, then texts, lead, tracked, route, seriesIndicator and pairs).
   No clock is read: every date comes from the fixture. What a browser would lay out (the column count, heights, widths)
   comes from the test. */
const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const SCRIPT = () => read('web', 'scripts', 'admin-home.js');
const STYLE = () => read('web', 'styles', 'admin-home.css');
const SVG = 'http://www.w3.org/2000/svg';

// An SVG element's className is an object ({ baseVal }), as in a browser.
const classesOf = (node) => String((typeof node.className === 'object' ? node.className?.baseVal : node.className) || '').split(/\s+/).filter(Boolean);
const camel = (name) => name.replace(/-([a-z0-9])/g, (match, letter) => letter.toUpperCase());

class FakeNode {
  constructor(tag = '', measure = () => 0) {
    this.tagName = tag;
    this.id = '';
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.className = '';
    this.textContent = '';
    this.dataset = {};
    this.children = [];
    this.parent = null;
    this.listeners = new Map();
    this.replaced = 0;
    this.clicked = 0;
    this.scrollLeft = 0;
    this.measure = measure;
    const node = this;
    this.classList = {
      add: (...names) => { node.className = [...new Set([...classesOf(node), ...names])].join(' '); },
      remove: (...names) => { node.className = classesOf(node).filter((name) => !names.includes(name)).join(' '); },
      toggle: (name, force) => { const on = force === undefined ? !classesOf(node).includes(name) : Boolean(force); node.classList[on ? 'add' : 'remove'](name); return on; },
      contains: (name) => classesOf(node).includes(name),
    };
    // Custom properties and order reach the stylesheet through the CSSOM; the test reads them back from here.
    this.style = { setProperty(name, value) { this[name] = String(value); }, removeProperty(name) { delete this[name]; } };
  }

  get elements() { return this.children.filter((child) => child && typeof child === 'object'); }
  get lastElementChild() { return this.elements.at(-1) ?? null; }
  get previousElementSibling() { const siblings = this.parent ? this.parent.elements : []; return siblings[siblings.indexOf(this) - 1] ?? null; }
  get scrollWidth() { return this.measure(this, 'scrollWidth'); }
  get clientWidth() { return this.measure(this, 'clientWidth'); }
  get offsetLeft() { return this.measure(this, 'offsetLeft'); }
  getBoundingClientRect() { return { width: this.measure(this, 'width'), height: this.measure(this, 'height') }; }
  // A node put somewhere else leaves its old place, as in the DOM.
  append(...nodes) { for (const node of nodes) { if (node && typeof node === 'object') { node.remove(); node.parent = this; } this.children.push(node); } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.replaced += 1; for (const child of this.elements) child.parent = null; this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this); this.parent = null; }
  after(...nodes) {
    const parent = this.parent;
    if (!parent) return;
    for (const node of nodes) node.remove();
    parent.children.splice(parent.children.indexOf(this) + 1, 0, ...nodes);
    for (const node of nodes) node.parent = parent;
  }
  contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; }
  setAttribute(name, value) { if (name === 'class') this.className = String(value); else if (name === 'id') this.id = String(value); else this[name] = String(value); }
  getAttribute(name) { return this[name] ?? null; }
  removeAttribute(name) { delete this[name]; }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  matches(selector) { return matches(this, compound(selector)); }
  querySelectorAll(selector) { return select(this, selector); }
  querySelector(selector) { return select(this, selector)[0] ?? null; }
  click() { this.clicked += 1; return this.listeners.get('click')?.(); }
}
/* An SVG element as a browser makes it: its class is an attribute, and className is an SVGAnimatedString that drops an
   assignment (a non-strict script assigning it fails silently), so only setAttribute('class', …) gives it a class. */
class FakeSvgNode extends FakeNode {
  constructor(tag, measure) {
    super(tag, measure);
    this.attributes = new Map();
  }
  get className() { return { baseVal: this.attributes?.get('class') ?? '' }; }
  set className(value) { /* read-only in a browser */ }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  removeAttribute(name) { this.attributes.delete(name); }
}
const descendants = (node) => (node?.children || []).flatMap((child) => (child && typeof child === 'object' ? [child, ...descendants(child)] : []));

/* As much of CSS selectors as the script and i18n.js use: compound selectors (tag, #id, .class, [attr], [attr=value])
   joined by descendant spaces. */
function compound(text) {
  const part = { tag: '', id: '', classes: [], attributes: [] };
  for (const [token] of text.matchAll(/\[[^\]]+\]|[#.]?[\w-]+/g)) {
    if (token.startsWith('[')) { const [, name, value] = /^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/.exec(token); part.attributes.push([name, value]); }
    else if (token.startsWith('#')) part.id = token.slice(1);
    else if (token.startsWith('.')) part.classes.push(token.slice(1));
    else part.tag = token.toLowerCase();
  }
  return part;
}
const attributeOf = (node, name) => {
  if (name.startsWith('data-')) return node.dataset[camel(name.slice(5))];
  if (node instanceof FakeSvgNode) return node.getAttribute(name);
  return node[name === 'class' ? 'className' : name];
};
function matches(node, part) {
  return (!part.tag || String(node.tagName).toLowerCase() === part.tag) && (!part.id || node.id === part.id)
    && part.classes.every((name) => classesOf(node).includes(name))
    && part.attributes.every(([name, value]) => { const found = attributeOf(node, name); return value === undefined ? found !== undefined && found !== null && found !== false : String(found) === value; });
}
function select(scope, selector) {
  const chain = selector.trim().split(/\s+/).map(compound);
  return descendants(scope).filter((node) => {
    if (!matches(node, chain.at(-1))) return false;
    let at = node.parent;
    for (let i = chain.length - 2; i >= 0; i -= 1) {
      while (at && !matches(at, chain[i])) at = at.parent;
      if (!at) return false;
      at = at.parent;
    }
    return true;
  });
}

// The page's body as fake nodes: tags, ids, classes, data-* and other attributes, hidden, and each element's own text.
const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'wbr']);
function setAttributes(node, text) {
  for (const [, name, value] of text.matchAll(/([^\s=/]+)(?:="([^"]*)")?/g)) {
    if (name === 'class') node.className = value;
    else if (name === 'id') node.id = value;
    else if (name === 'hidden') node.hidden = true;
    else if (name.startsWith('data-')) node.dataset[camel(name.slice(5))] = value ?? '';
    else node[name] = value ?? '';
  }
}
function parseBody(html, create) {
  const [, attributes, inner] = /<body([^>]*)>([\s\S]*)<\/body>/.exec(html);
  const body = create('body');
  setAttributes(body, attributes);
  const stack = [body];
  for (const [, closing, tag, attrs, text] of inner.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"]|"[^"]*")*)>|([^<]+)/g)) {
    const top = stack.at(-1);
    if (text !== undefined) { top.textContent = `${top.textContent} ${text}`.replace(/\s+/g, ' ').trim(); continue; }
    if (closing) { while (stack.length > 1 && stack.pop().tagName !== tag.toLowerCase()); continue; }
    const node = create(tag.toLowerCase());
    setAttributes(node, attrs);
    top.append(node);
    if (!VOID.has(node.tagName) && !/\/\s*$/.test(attrs)) stack.push(node);
  }
  return body;
}

/* The text a node holds, its strings included, as a reader meets it. closed() leaves the definitions out, as the screen
   shows a family until its "Cómo se cuenta" is pressed. */
function textOf(node, defs) {
  const parts = [];
  const walk = (at) => {
    if (typeof at === 'string') { parts.push(at); return; }
    if (!at || (!defs && classesOf(at).includes('home-def'))) return;
    parts.push(at.textContent || '');
    for (const child of at.children) walk(child);
  };
  walk(node);
  return parts.join(' ').replace(/\s+/g, ' ').replace(/ ([,)])/g, '$1').trim();
}
const rendered = (node) => textOf(node, true);
const closed = (node) => textOf(node, false);
// The text exactly as a browser joins it, nothing added between nodes: a space a sentence needs must be in its strings.
const flat = (node) => (typeof node === 'string' ? node : (node.textContent || '') + node.children.map(flat).join(''));
const byKey = (node, key) => descendants(node).find((child) => child.dataset.key === key);
const byList = (node, key) => descendants(node).find((child) => child.dataset.list === key);
const bySeries = (node, name) => descendants(node).find((child) => child.dataset.series === name);
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
const memoryStorage = (entries = {}) => {
  const data = new Map(Object.entries(entries));
  return { data, getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => { data.set(key, String(value)); }, removeItem: (key) => { data.delete(key); } };
};

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
   neighbour signups.new 7, signups.confirmed 106, activity.members 67 / 17). The route's stops: 105, 106, 108, 110,
   114, 115 and 67. */
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
    route: ROUTE,
    seriesIndicator: SERIES_INDICATOR,
    pairs: PAIRS,
  });
}
const indicator = (answer, key) => answer.families.flatMap((f) => f.indicators).find((ind) => ind.key === key);

/* lang: the page language at evaluation (locale.js sets it before the deferred scripts run). get(url), post() and
   download(url) answer fetch; each defaults to the fixture, {saved: false} and a 500. cols and gap stand for what the
   stylesheet gives the family columns (--cols, the column's row gap; setCols changes the first, as a new width does);
   measure(node, what) for a browser's layout figure (height, width, offsetLeft, scrollWidth, clientWidth: 0 when not
   given). storage stands for localStorage: 'throws' is storage the browser blocks, null none at all. resized(width)
   calls the page's ResizeObserver as a new width of the families would, a frame runs at once, and fonts.resolve()
   says the fonts have loaded. */
function home({ lang = 'es', answer = fixture(), get, post, download, cols = 1, gap = 0, measure = () => 0, storage = memoryStorage() } = {}) {
  let columnCount = cols;
  const created = [];
  const node = (tag) => new FakeNode(tag, measure);
  const body = parseBody(read('web', 'pages', 'admin-home.html'), node);
  const ids = new Map(descendants(body).filter((n) => n.id).map((n) => [n.id, n]));
  const documentElement = node('html');
  documentElement.lang = lang;
  documentElement.append(body);
  const document = node('#document');
  document.append(documentElement);
  Object.assign(document, {
    documentElement,
    body,
    title: '',
    getElementById: (id) => ids.get(id) ?? null,
    createElement: (tag) => { const made = node(tag); created.push(made); return made; },
    createElementNS: (namespace, tag) => { const made = namespace === SVG ? new FakeSvgNode(tag, measure) : node(tag); made.namespaceURI = namespace; created.push(made); return made; },
  });
  const fonts = deferred();
  document.fonts = { ready: fonts.promise };
  let observed = null;
  const calls = [];
  const fetch = (url, init = {}) => {
    calls.push({ url, init });
    if (url === '/api/admin/metrics/readings') return post ? post() : Promise.resolve(response({ saved: false, day: answer.limaDay }));
    if (url.startsWith('/api/admin/metrics/export')) return download ? download(url) : Promise.resolve(response({}, 500));
    return get ? get(url) : Promise.resolve(response(answer));
  };
  const printed = [];
  const windowListeners = new Map();
  const context = {
    document, fetch, console, setTimeout, clearTimeout, URLSearchParams,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    location: { search: '' },
    nodalLocale: { read: () => lang, save() {}, chosen: () => false },
    addEventListener: (name, handler) => windowListeners.set(name, handler),
    print: () => printed.push(true),
    getComputedStyle: (target) => ({ getPropertyValue: (name) => (name === '--cols' && target === ids.get('homeBlocks') ? ` ${columnCount}` : ''), rowGap: `${gap}px` }),
    ResizeObserver: class { constructor(callback) { observed = callback; } observe() {} },
    requestAnimationFrame: (callback) => callback(),
  };
  if (storage === 'throws') Object.defineProperty(context, 'localStorage', { get() { throw new Error('SecurityError: the storage is blocked'); } });
  else if (storage) context.localStorage = storage;
  context.window = context;
  vm.runInNewContext(SCRIPT(), context, { filename: 'admin-home.js' });
  vm.runInNewContext(read('web', 'scripts', 'i18n.js'), context, { filename: 'i18n.js' });
  const id = (name) => ids.get(name);
  return {
    ids, id, calls, created, printed, document, context, fonts,
    setCols: (n) => { columnCount = n; },
    resized: (width) => observed([{ contentRect: { width } }]),
    skip: select(body, '.admin-skip')[0],
    gets: () => calls.filter((c) => c.url.startsWith('/api/admin/metrics') && !c.url.startsWith('/api/admin/metrics/')),
    posts: () => calls.filter((c) => c.url === '/api/admin/metrics/readings'),
    ready: () => document.listeners.get('DOMContentLoaded')?.(),
    apply: (next) => context.window.nodalI18n.apply(next, { persist: false }),
    fire: (name) => windowListeners.get(name)?.(),
    // The families in the order a reader meets them: down each column, then across.
    sections: () => select(id('homeBlocks'), 'section.home-block[data-family]'),
    section: (family) => select(id('homeBlocks'), `section.home-block[data-family=${family}]`)[0],
    stops: () => select(id('homeRoute'), 'li.home-stop'),
    columns: () => id('homeBlocks').elements.map((column) => column.elements.map((block) => block.dataset.family ?? block.id)),
  };
}

const IN30 = { es: 'en 30 días', en: 'in 30 days', pt: 'em 30 dias' };
const IN7 = { es: 'en 7 días', en: 'in 7 days', pt: 'em 7 dias' };
const HOW = { es: 'Cómo se cuenta', en: 'How it is counted', pt: 'Como se conta' };
const SOURCE = { es: 'Fuente', en: 'Source', pt: 'Fonte' };
const LIMITS = { es: 'Límites', en: 'Limits', pt: 'Limites' };
const ROUTE_NOTE = 'Conteos por etapa, no tasas de paso: una etapa no siempre contiene a la siguiente.';

test('the chrome is painted from the page language at evaluation', () => {
  const page = home({ get: () => new Promise(() => {}) });
  assert.equal(page.id('homeTitle').textContent, 'Indicadores de NODAL');
  assert.equal(page.skip.textContent, 'Saltar al contenido');
  assert.equal(page.id('homePrint').textContent, 'Imprimir o guardar como PDF');
  assert.equal(page.id('homeRefresh').textContent, 'Actualizar');
  assert.equal(page.id('homeRetry').textContent, 'Reintentar');
  assert.equal(page.id('homePrintHead').textContent, 'NODAL · Reporte de indicadores');
  // The downloads stand under one visible label; each also carries a full name that holds its visible words.
  assert.equal(page.id('homeCsvLabel').textContent, 'Descargar CSV:');
  const downloads = ['homeCsv', 'homeMonthsCsv', 'homeReadingsCsv'];
  assert.deepEqual(downloads.map((name) => [page.id(name).textContent, page.id(name)['aria-label']]), [
    ['Indicadores', 'Descargar indicadores (CSV)'], ['Por mes', 'Descargar cifras por mes (CSV)'], ['Lecturas', 'Descargar lecturas guardadas (CSV)'],
  ]);
  for (const lang of ['en', 'pt']) {
    const other = home({ lang, get: () => new Promise(() => {}) });
    for (const name of downloads) {
      const button = other.id(name);
      assert.ok(button['aria-label'].toLowerCase().includes(button.textContent.toLowerCase()), `${lang} ${name}: ${button['aria-label']}`);
    }
  }
  assert.equal(page.id('homeCompare').textContent, 'Comparar meses');
  assert.equal(page.id('homeCompare').hidden, true);
  assert.equal(page.id('homeReadingsCsv').hidden, true);
  assert.equal(page.id('homeTop').hidden, true, 'no figure stands before the first answer');
  assert.equal(page.gets().length, 1);
  assert.equal(page.gets()[0].url, '/api/admin/metrics');
  assert.equal(page.gets()[0].init.credentials, 'same-origin');
});

for (const lang of ['es', 'en', 'pt']) {
  test(`renders the members' path, the other lead figures and every family in the page language (${lang})`, async () => {
    const answer = fixture();
    const page = home({ lang, answer });
    await flush();
    const words = TEXTS[lang];
    const name = (key, field) => (field === 'total' ? words.indicators[key].name : `${words.indicators[key].name} ${(field === 'd7' ? IN7 : IN30)[lang]}`);
    // The route: one stop per catalogue stop, in its order, each with its own count and its name with the window.
    const stops = page.stops();
    assert.deepEqual(stops.map((stop) => stop.dataset.key), ROUTE.map(([key]) => key));
    for (const [i, [key, field]] of ROUTE.entries()) {
      assert.equal(select(stops[i], '.home-stop-n')[0].textContent, String(indicator(answer, key)[field]), key);
      assert.equal(select(stops[i], '.home-stop-name')[0].textContent, name(key, field), key);
    }
    // A stop's second lines are its lead entry's seconds that are not stops themselves: the 7 days under the accounts
    // (the confirmed accounts are a stop), the 7 days under the 30-day members, none under the basic profile.
    const mores = (key) => select(stops[ROUTE.findIndex(([k]) => k === key)], 'span.home-stop-more[data-key]').map((line) => closed(line));
    assert.deepEqual(mores('signups.accounts'), [`7 ${words.indicators['signups.new'].name} ${IN7[lang]}`]);
    assert.deepEqual(mores('activity.members'), [`17 ${IN7[lang]}`]);
    assert.deepEqual(mores('profiles.basic'), []);
    // As a browser joins them: the figure and its words are one sentence, never "17en 7 días".
    assert.equal(flat(select(stops[6], '.home-stop-more')[0]), `17 ${IN7[lang]}`);
    assert.equal(flat(select(stops[0], 'span.home-stop-more[data-key=signups.new]')[0]), `7 ${words.indicators['signups.new'].name} ${IN7[lang]}`);
    // Beside the route: the lead figures that are not stops, each with its own second lines.
    const lead = page.id('homeLead');
    const others = answer.lead.filter(({ key, field }) => !ROUTE.some(([k, f]) => k === key && f === field)).map((entry) => entry.key);
    assert.deepEqual(others, ['visits.arrivals', 'memberships.founders']);
    assert.deepEqual(lead.elements.map((item) => [item.tagName, item.className, item.dataset.key]), others.map((key) => ['div', 'home-lead-item', key]));
    assert.deepEqual(byKey(lead, 'memberships.founders').elements.map((line) => closed(line)), [`121 ${words.indicators['memberships.founders'].name}`, `122 ${words.indicators['memberships.acceptances'].name}`]);
    // Each line of each of them, the figure first, then its name with the window: the main figure, then every second
    // line that is not a stop of the path.
    for (const { key, field, second } of answer.lead.filter((entry) => others.includes(entry.key))) {
      const lines = byKey(lead, key).elements.map((line) => closed(line));
      const expected = [[key, field], ...second.filter(([k, f]) => !ROUTE.some(([stop, at]) => stop === k && at === f))];
      assert.equal(lines.length, expected.length, key);
      expected.forEach(([k, f], i) => assert.ok(lines[i].startsWith(`${indicator(answer, k)[f]} ${name(k, f)}`), `${key}: ${lines[i]}`));
    }
    // Every family in the catalogue's order, inside the columns, each with a toggle that names it and every
    // definition once, under its own row or list, with its source and its limits.
    const sections = page.sections();
    assert.deepEqual(sections.map((section) => section.dataset.family), FAMILIES);
    assert.ok(sections.every((section) => section.parent.classList.contains('home-col')));
    for (const section of sections) {
      const family = section.dataset.family;
      const title = select(section, 'h2.home-block-title')[0];
      assert.equal(title.textContent, words.families[family]);
      assert.equal(section['aria-labelledby'], title.id);
      const toggle = select(section, 'button.home-how')[0];
      assert.equal(rendered(toggle), `${HOW[lang]} (${words.families[family]})`);
      assert.equal(toggle['aria-expanded'], 'false');
      assert.equal(toggle['aria-controls'], section.id);
      assert.equal(select(section, `ul.home-figs[aria-labelledby=${title.id}]`).length, 1, `${family} figures`);
      const defs = select(section, '.home-def');
      assert.deepEqual(defs.map((def) => def.dataset.def).sort(), INDICATORS.filter((ind) => ind.family === family).map((ind) => ind.key).sort(), family);
      for (const def of defs) {
        const { definition, source, caveat } = words.indicators[def.dataset.def];
        for (const part of [definition, `${SOURCE[lang]}: ${source}`, `${LIMITS[lang]}: ${caveat}`]) assert.ok(rendered(def).includes(part), `${def.dataset.def}: ${part}`);
      }
    }
    if (lang === 'es') {
      assert.equal(page.id('homeAsOf').textContent, 'Datos al 14 nov 2026, 08:36 (hora de Lima)');
      // Both windows, the 30 days first; the days without new accounts stand at the route's first stop instead.
      assert.deepEqual(page.id('homeWindows').elements.map((span) => rendered(span)), ['Últimos 30 días: 16 oct–14 nov', 'Últimos 7 días: 8–14 nov']);
      const silence = select(stops[0], '.home-silence')[0];
      assert.equal(rendered(silence), '19 días sin cuentas nuevas (última: 26 oct)');
      assert.equal(select(silence, '.home-num')[0].textContent, '19', 'the count of days is a figure');
      const pending = page.id('homePending');
      assert.equal(pending.hidden, false);
      assert.equal(select(pending, 'h2')[0].textContent, 'Por atender');
      assert.deepEqual(select(pending, 'a').map((a) => a.href), ['admin.html#interests', 'admin.html#nodes', 'fiiu-admin.html']);
      assert.deepEqual(select(page.id('homeBlocks'), 'a').map((a) => [a.href, a.textContent]), [['fiiu-admin.html', 'Ver en Festival'], ['teaching.html', 'Ver en Cursos']]);
      assert.equal(page.id('homeStatus').textContent, '');
      assert.equal(page.id('homeTop').hidden, false);
    }
  });
}

test('a zero is 0 and a failure is a dash with its reason', async () => {
  const answer = fixture();
  indicator(answer, 'signups.team').total = 0;
  delete indicator(answer, 'profiles.bio').total;
  indicator(answer, 'profiles.bio').state = 'unavailable';
  delete indicator(answer, 'festival.hours').total;
  indicator(answer, 'festival.hours').state = 'not_activated';
  delete indicator(answer, 'festival.qrPeople').total;
  indicator(answer, 'festival.qrPeople').state = 'not_activated';
  const page = home({ answer });
  await flush();
  const blocks = page.id('homeBlocks');
  const zero = select(byKey(blocks, 'signups.team'), '.home-num')[0];
  assert.equal(zero.textContent, '0', 'the zero is printed');
  assert.match(zero.className, /\bis-zero\b/);
  const bio = byKey(blocks, 'profiles.bio');
  assert.equal(closed(bio), '— Con biografía No disponible en este momento');
  assert.equal(select(bio, '.home-fig-more')[0].textContent, 'No disponible en este momento');
  assert.doesNotMatch(closed(bio), /\d/);
  assert.equal(count(closed(page.section('festival')), 'Aún no está activado en la base de datos'), 1);
  assert.equal(closed(byKey(blocks, 'festival.hours')), '— Horas de asistencia');

  for (const [since, heading] of [[null, 'Aún no hay visitas contadas'], ['2026-11-17', 'Se cuenta desde el 17 nov 2026']]) {
    const quiet = fixture();
    quiet.visitsSince = since;
    for (const ind of quiet.families.find((family) => family.key === 'visits').indicators) { for (const f of ['d30', 'd7', 'items']) delete ind[f]; ind.state = 'not_yet_counted'; }
    // What the server sends then: no month of either visit series.
    quiet.months.series.views = {};
    quiet.months.series.arrivals = {};
    const visits = home({ answer: quiet });
    await flush();
    const block = visits.section('visits');
    // The reason is said once for the block: neither series says it again where its chart would stand.
    assert.equal(count(closed(block), heading), 1, closed(block));
    assert.equal(select(block, '.home-chart').length, 0);
    assert.doesNotMatch(closed(byKey(block, 'visits.views')), /\d/);
    if (!since) assert.doesNotMatch(rendered(block), /Se cuenta desde el/);
  }
});

test('the lead, the route and the tracking rows come from the answer', async () => {
  const answer = fixture();
  answer.lead = answer.lead.slice().reverse().slice(0, 3);
  answer.tracked = ['courses.enrolled', 'signups.accounts'];
  // The one reading was saved before signups.accounts was tracked.
  answer.readings = { today: true, months: [{ month: '2026-11', day: '2026-11-14', defs: DEFS, figures: { 'courses.enrolled': 21 } }] };
  const page = home({ answer });
  await flush();
  // Founders, the 30-day members and the basic profile: only the founders are not a stop of the path.
  assert.deepEqual(page.id('homeLead').elements.map((g) => g.dataset.key), ['memberships.founders']);
  const reading = select(page.id('homeTracking'), 'details.home-reading')[0];
  assert.deepEqual(select(reading, 'li.home-fig[data-key]').map((row) => [row.dataset.key, closed(row)]), [['courses.enrolled', '21 Participantes'], ['signups.accounts', '— Cuentas']]);
  // A key the reading lacks is a dash, never 0.
  assert.equal(closed(byKey(reading, 'signups.accounts')), '— Cuentas');
  assert.equal(select(byKey(reading, 'signups.accounts'), '.home-dash').length, 1);
  assert.equal(select(page.id('homeTracking'), 'tr[data-key]').length, 0, 'one reading is a list, not a table');

  const empty = fixture();
  empty.lead = [];
  empty.tracked = [];
  empty.readings = { today: true, months: [{ month: '2026-11', day: '2026-11-14', defs: DEFS, figures: {} }] };
  const bare = home({ answer: empty });
  await flush();
  assert.equal(bare.id('homeLead').elements.length, 0);
  assert.equal(bare.id('homeLead').hidden, true);
  assert.equal(select(bare.id('homeTracking'), '[data-key]').length, 0);
  assert.equal(bare.id('homeStatus').textContent, '');

  const source = SCRIPT();
  assert.ok(!source.includes("'profiles.basic'"));
  assert.ok(!source.includes("'memberships.acceptors'"));
  // The path, the indicator of each month series and the pairs are the answer's (server/metrics-catalog.js), never a copy.
  assert.doesNotMatch(source, /MOCK_|'signups\.(?:confirmed|entered|new)'|'profiles\.(?:assessed|directory)'|'activity\.members'|'courses\.survey/);
});

test('a visit figure younger than its window says since when it is counted', async () => {
  // The counter began on 1 Nov: inside the 30 days (from 16 Oct), before the 7 days (from 8 Nov).
  const answer = fixture();
  answer.lead = [{ key: 'visits.arrivals', field: 'd30', second: [['visits.views', 'd7']] }, ...answer.lead.slice(1)];
  const page = home({ answer });
  await flush();
  const [main, second] = byKey(page.id('homeLead'), 'visits.arrivals').elements;
  assert.equal(closed(main), '52 Llegadas en 30 días Se cuenta desde el 1 nov 2026');
  assert.equal(closed(second), '1 Páginas vistas en 7 días', 'the 7 days are all counted');
  assert.doesNotMatch(rendered(page.id('homeRoute')), /Se cuenta desde/, 'only visit figures');
  const views = byList(page.id('homeBlocks'), 'memberships.views');
  const [title, def, note] = views.elements;
  assert.equal(title.textContent, 'Vistas de Fundadores y de la página de pago en 30 días');
  assert.ok(def.classList.contains('home-def'), 'the note follows the list\'s definition');
  assert.deepEqual([note.className, note.textContent], ['home-note', 'Se cuenta desde el 1 nov 2026']);
  // The Visitas block says it once, under its head.
  assert.equal(count(closed(page.section('visits')), 'Se cuenta desde el 1 nov 2026'), 1);

  const old = fixture();
  old.visitsSince = '2026-10-16';
  const whole = home({ answer: old });
  await flush();
  assert.equal(closed(byKey(whole.id('homeLead'), 'visits.arrivals').elements[0]), '52 Llegadas en 30 días');
  assert.doesNotMatch(closed(byList(whole.id('homeBlocks'), 'memberships.views')), /Se cuenta desde/);
  const en = home({ lang: 'en', answer: fixture() });
  await flush();
  assert.match(closed(byKey(en.id('homeLead'), 'visits.arrivals').elements[0]), /Counted since Nov 1, 2026$/);
});

test('a lead figure that could not be computed is a dash with its reason', async () => {
  const answer = fixture();
  const founders = indicator(answer, 'memberships.founders');
  for (const f of ['total', 'd30', 'd7']) delete founders[f];
  founders.state = 'unavailable';
  const page = home({ answer });
  await flush();
  const [main] = byKey(page.id('homeLead'), 'memberships.founders').elements;
  assert.equal(closed(main), `— ${TEXTS.es.indicators['memberships.founders'].name} No disponible en este momento`);
  assert.equal(select(main, '.home-dash').length, 1);
});

test('the festival registrations say how many are the team\'s', async () => {
  const answer = fixture();
  indicator(answer, 'festival.registrations').team = 2;
  const page = home({ answer });
  await flush();
  const total = indicator(answer, 'festival.registrations').total;
  assert.equal(closed(byKey(page.id('homeBlocks'), 'festival.registrations')), `${total} Inscripciones (incluye 2 del equipo)`);
  assert.equal(flat(select(byKey(page.id('homeBlocks'), 'festival.registrations'), '.home-fig-name')[0]), 'Inscripciones (incluye 2 del equipo)');
  page.ready();
  page.apply('en');
  await flush();
  assert.ok(closed(byKey(page.id('homeBlocks'), 'festival.registrations')).includes('(includes 2 from the team)'));
  page.apply('pt');
  await flush();
  assert.ok(closed(byKey(page.id('homeBlocks'), 'festival.registrations')).includes('(inclui 2 da equipe)'));
  for (const team of [0, undefined]) {
    const none = fixture();
    indicator(none, 'festival.registrations').team = team;
    const bare = home({ answer: none });
    await flush();
    assert.equal(closed(byKey(bare.id('homeBlocks'), 'festival.registrations')), `${total} Inscripciones`);
  }
});

test('a list names its window, ranks its rows on its own scale, and an empty list is a zero', async () => {
  const answer = fixture();
  indicator(answer, 'visits.sources').items = [];
  indicator(answer, 'signups.new').daysSince = 1;
  const page = home({ answer });
  await flush();
  const blocks = page.id('homeBlocks');
  assert.equal(closed(byList(blocks, 'visits.sources')), 'De dónde llegan en 30 días 0');
  assert.equal(select(byList(blocks, 'visits.sources'), 'p.home-fig .home-num')[0].textContent, '0');
  assert.equal(closed(byList(blocks, 'visits.topPages')), 'Páginas más vistas en 30 días 40 Inicio 12 FIIU Fest');
  assert.match(closed(byList(blocks, 'activity.kinds')), /^Actividad por tipo en 30 días 4 perfil/);
  assert.match(closed(byList(blocks, 'festival.countries')), /^País \(respuesta de inscripción\) 335 Perú/, 'a total list has no window');
  // A row: the figure, the label, a bar on the list's own scale (its largest row); figure and label are real text.
  const list = select(byList(blocks, 'visits.topPages'), 'ol.home-rank')[0];
  assert.equal(list['aria-labelledby'], select(byList(blocks, 'visits.topPages'), 'h3')[0].id);
  const [first, second] = list.elements;
  assert.deepEqual(first.elements.map((n) => [n.className, n.textContent]), [['home-num', '40'], ['home-rank-label', 'Inicio'], ['home-rank-bar', '']]);
  assert.equal(first.elements[2]['aria-hidden'], 'true');
  assert.deepEqual([first, second].map((row) => row.elements[2].style['--f']), ['1.0000', '0.3000']);
  assert.ok(rendered(page.id('homeRoute')).includes('1 día sin cuentas nuevas (última: 26 oct)'), rendered(page.id('homeRoute')));
  for (const section of page.sections()) assert.equal(select(section, 'ul.home-figs')[0]['aria-labelledby'], select(section, 'h2')[0].id, section.dataset.family);
  const views = select(byKey(blocks, 'visits.views'), '.home-def')[0];
  assert.ok(rendered(views).includes('Límites: No dice cuántas personas fueron.'), rendered(views));
  assert.doesNotMatch(rendered(blocks), /No dice: No dice/);
});

test('a day with a new account says no days without one', async () => {
  const answer = fixture();
  indicator(answer, 'signups.new').daysSince = 0;
  indicator(answer, 'signups.new').last = '2026-11-14';
  const page = home({ answer });
  await flush();
  assert.equal(select(page.id('homeRoute'), '.home-silence').length, 0);
  assert.doesNotMatch(rendered(page.id('homeRoute')), /sin cuentas nuevas/);
  assert.deepEqual(page.id('homeWindows').elements.map((span) => rendered(span)), ['Últimos 30 días: 16 oct–14 nov', 'Últimos 7 días: 8–14 nov']);
});

test('lists are labelled after the fact', async () => {
  const page = home();
  await flush();
  const blocks = page.id('homeBlocks');
  const types = closed(byList(blocks, 'festival.profileTypes'));
  for (const part of ['1 otros (menos de 3)', '34 otro', '82 profesional']) assert.ok(types.includes(part), types);
  const countries = closed(byList(blocks, 'festival.countries'));
  for (const part of ['335 Perú', '4 <b>x</b>', '2 otros (menos de 3)']) assert.ok(countries.includes(part), countries);
  assert.equal(page.created.filter((n) => n.tagName === 'b').length, 0);
  assert.ok(closed(byList(blocks, 'visits.sources')).includes('20 directo'));
  // The kinds count the 7 days too: said after each label, in real text.
  const kinds = byList(blocks, 'activity.kinds');
  assert.equal(closed(kinds), 'Actividad por tipo en 30 días 4 perfil (guardó su perfil o marcó avisos como leídos), 1 en 7 días 2 red, 0 en 7 días');
  const [comma, more] = select(kinds, '.home-rank-label')[0].children;
  assert.deepEqual([comma, more.className], [', ', 'home-rank-more']);
});

test('several courses label each course row from courseNames, and one course is named once', async () => {
  const answer = fixture();
  answer.courseNames = { a: 'Curso A', b: 'Curso B' };
  for (const ind of answer.families.find((f) => f.key === 'courses').indicators) if (ind.items) ind.items = [{ key: 'a', n: 4 }, { key: 'b', n: 6 }];
  const page = home({ answer });
  await flush();
  const enrolled = byList(page.id('homeBlocks'), 'courses.enrolled');
  assert.equal(enrolled.className, 'home-list');
  const text = closed(enrolled);
  assert.ok(text.includes('4 Curso A') && text.includes('6 Curso B'), text);
  assert.doesNotMatch(closed(page.section('courses')), /Un curso:/);

  const one = home();
  await flush();
  const courses = one.section('courses');
  assert.equal(count(closed(courses), 'Un curso: Movilidad Nivel 2'), 1);
  assert.equal(select(courses, '.home-list').length, 0, 'one course: no list repeats its total');
});

test('a language change re-renders without a request', async () => {
  const page = home();
  await flush();
  page.ready();
  const figures = () => [...page.stops(), ...page.id('homeLead').elements].map((g) => closed(g).match(/\d+/g).join(','));
  const before = figures();
  page.apply('pt');
  await flush();
  assert.equal(page.id('homeTitle').textContent, 'Indicadores da NODAL');
  assert.ok(rendered(page.id('homeRoute')).includes(TEXTS.pt.indicators['signups.accounts'].name));
  assert.deepEqual(figures(), before);
  assert.ok(page.sections().every((section) => rendered(select(section, 'button.home-how')[0]).startsWith('Como se conta')));
  assert.equal(page.id('homeCsvLabel').textContent, 'Baixar CSV:');
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
  // One reading is today's figures again: folded behind one click, with its month, the day it was read and a row per
  // tracked key.
  assert.equal(select(tracking, 'th[data-month]').length, 0);
  const reading = select(tracking, 'details.home-reading')[0];
  assert.equal(reading.open, false);
  assert.equal(select(reading, 'summary')[0].textContent, 'Ver la lectura de nov 2026');
  const read = rendered(select(reading, '.home-read')[0]);
  assert.ok(read.includes('nov 2026') && read.includes('leído el 14'), read);
  assert.deepEqual(select(reading, 'li.home-fig[data-key]').map((r) => r.dataset.key), TRACKED);
  assert.equal(closed(byKey(reading, 'signups.accounts')), '105 Cuentas');
  assert.equal(closed(byKey(reading, 'activity.members.d30')), '67 Miembros con actividad en 30 días');
  assert.equal(closed(byKey(reading, 'activity.members.d7')), '17 Miembros con actividad en 7 días');
  assert.equal(page.calls.length, 2);
  assert.equal(page.id('homeReadingsCsv').hidden, false);
  assert.equal(page.id('homeCompare').hidden, true, 'one month has nothing to compare');
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
    assert.equal(other.id('homeReadingsCsv').hidden, true);
    // The month series stand in their families, not here.
    assert.ok(closed(other.section('signups')).includes('Cuentas nuevas, por mes jul 9'));
    assert.equal(select(other.id('homeTracking'), '.home-chart').length, 0);
  }

  const earlier = fixture();
  earlier.readings.months = [{ month: '2026-11', day: '2026-11-03', defs: DEFS, figures: { 'signups.accounts': 90 } }];
  const replaced = home({ answer: earlier, post: () => Promise.resolve(response({ saved: true, day: '2026-11-14' })) });
  await flush();
  const text = rendered(replaced.id('homeTracking'));
  assert.ok(text.includes('leído el 14') && !text.includes('leído el 3'), text);
  assert.equal(select(replaced.id('homeTracking'), 'details.home-reading').length, 1);
  assert.equal(select(replaced.id('homeTracking'), 'th[data-month]').length, 0);
});

test('two readings or more make the month table, grouped by family; the month series stand in their families', async () => {
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
  // The table runs under the families, across the page, and the tools offer the jump to it.
  assert.equal(tracking.previousElementSibling, page.id('homeBlocks'));
  assert.equal(tracking.classList.contains('home-block'), false);
  assert.equal(page.id('homeCompare').hidden, false);
  const heads = select(tracking, 'th[data-month]');
  assert.deepEqual(heads.map((h) => h.dataset.month), ['2026-11', '2026-12']);
  assert.ok(rendered(heads[0]).includes('nov 2026') && rendered(heads[0]).includes('leído el 14'));
  assert.ok(rendered(heads[1]).includes('dic 2026') && rendered(heads[1]).includes('leído el 2'));
  assert.ok(rendered(heads[0]).includes('leído con definiciones anteriores'));
  assert.ok(!rendered(heads[1]).includes('leído con definiciones anteriores'));
  assert.equal(select(tracking, 'h2')[0].id, 'homeTrackingTitle');
  assert.equal(tracking['aria-labelledby'], 'homeTrackingTitle');
  assert.equal(closed(select(tracking, '.home-tracking-head .home-note')[0]), 'La última lectura guardada de cada mes, para comparar los meses.');
  const corner = select(tracking, 'th.home-corner')[0];
  assert.deepEqual([corner.scope, closed(corner)], ['col', 'Indicador']);
  // One group per family with a row-group head, the rows in TRACKED order.
  assert.deepEqual(select(tracking, 'tbody').map((group) => closed(select(group, 'th[scope=rowgroup]')[0])), ['Registros', 'Perfiles', 'Actividad', 'Membresías', 'Festival', 'Cursos']);
  assert.ok(select(tracking, 'th[scope=rowgroup]').every((th) => th.colspan === '3'));
  assert.deepEqual(select(tracking, 'tr[data-key]').map((r) => r.dataset.key), TRACKED);
  assert.ok(select(tracking, 'tr[data-key] th').every((th) => th.scope === 'row'));
  // A reading saved before a key existed prints a dash, never a 0 or a blank, and the note under the table says why.
  assert.deepEqual(select(byKey(tracking, 'signups.confirmed'), 'td').map((cell) => closed(cell)), ['—', '110']);
  assert.deepEqual(select(byKey(tracking, 'profiles.city'), 'td').map((cell) => closed(cell)), ['0', '—']);
  assert.ok(rendered(tracking).includes('—: no se leía ese mes'));
  assert.ok(rendered(tracking).includes('Lecturas desde nov 2026.'));
  assert.ok(!rendered(tracking).includes('undefined'));
  // The table scrolls inside the Seguimiento region, named apart from it, as a group (not a second region). The name is
  // the group's alone: the table inside repeats neither it nor the region's.
  const scroller = select(tracking, '.home-scroll')[0];
  assert.deepEqual([scroller.tabindex, scroller.role, scroller['aria-label']], ['0', 'group', 'Tabla por mes']);
  const table = select(scroller, 'table')[0];
  assert.deepEqual([table['aria-labelledby'], table['aria-label'], select(table, 'caption').length], [undefined, undefined, 0]);
  // Two months or more: a chart in the indicator's family; one month: said on its row; in a state: its reason.
  const accounts = bySeries(page.section('signups'), 'accounts');
  assert.equal(closed(accounts), 'Cuentas nuevas, por mes jul 9 ago 0 sept 43 oct 473 nov 0');
  assert.deepEqual(select(accounts, '.home-month-bar').map((bar) => bar.style['--f']), ['0.0190', '0.0000', '0.0909', '1.0000', '0.0000']);
  // Each chart is a list named by its title, its bars hidden from a screen reader; the stylesheet gets its months. A
  // chart that fits its column is no group: its name is said once, by its list.
  for (const chart of select(page.section('signups'), '.home-chart')) {
    assert.equal(select(chart, 'ol.home-months')[0]['aria-labelledby'], select(chart, 'h3')[0].id, chart.dataset.series);
    const box = select(chart, '.home-months-box')[0];
    assert.deepEqual([box.role, box['aria-labelledby']], [undefined, undefined], chart.dataset.series);
    assert.ok(select(chart, '.home-month-bar').every((bar) => bar['aria-hidden'] === 'true'), chart.dataset.series);
  }
  assert.equal(select(accounts, 'ol.home-months')[0].style['--n'], '5');
  assert.equal(select(page.section('signups'), '.home-charts')[0].style['--months'], '5');
  const registrations = bySeries(page.section('festival'), 'registrations');
  assert.ok(registrations.classList.contains('is-missing'));
  assert.equal(closed(registrations), 'Inscripciones al festival, por mes — No disponible en este momento');
  assert.equal(flat(select(registrations, '.home-chart-why')[0]), '— No disponible en este momento');
  assert.equal(closed(select(byKey(page.section('visits'), 'visits.views'), '.home-fig-more')[0]), '1 en 7 días, 40 en nov 2026');
  assert.equal(select(tracking, '.home-chart').length, 0, 'no series is left over for Seguimiento');
  assert.equal(page.posts().length, 0);
});

test('a month table with every key in every reading has no note about dashes', async () => {
  const answer = fixture();
  const figures = Object.fromEntries(TRACKED.map((key) => [key, 1]));
  answer.readings = { today: true, months: [{ month: '2026-11', day: '2026-11-14', defs: DEFS, figures }, { month: '2026-12', day: '2026-12-02', defs: DEFS, figures }] };
  const page = home({ answer });
  await flush();
  const tracking = page.id('homeTracking');
  assert.equal(select(tracking, 'th[data-month]').length, 2);
  assert.equal(select(tracking, '.home-dash').length, 0);
  assert.ok(!rendered(tracking).includes('no se leía ese mes'), rendered(tracking));
});

test('a month table wider than the screen opens on its latest whole months', async () => {
  const answer = fixture();
  const months = ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04'];
  answer.readings = { today: true, months: months.map((month) => ({ month, day: `${month}-02`, defs: DEFS, figures: { 'signups.accounts': 100 } })) };
  // A 160px names column, then a 140px column per month.
  const layout = (scrollWidth) => (node, what) => {
    if (node.classList.contains('home-scroll')) return { scrollWidth, clientWidth: 580 }[what] ?? 0;
    if (node.classList.contains('home-corner')) return what === 'width' ? 160 : 0;
    return node.dataset.month && what === 'offsetLeft' ? 160 + 140 * months.indexOf(node.dataset.month) : 0;
  };
  const wide = home({ answer, measure: layout(1000) });
  await flush();
  // 420px of months beside the names: the last three fit whole, so the first of them starts right after the names.
  const exact = select(wide.id('homeTracking'), '.home-scroll')[0];
  assert.equal(exact.scrollLeft, 420);
  assert.equal(exact.style['--tail'], undefined, 'an exact fit needs no room after the last month');
  const fits = home({ answer: structuredClone(answer), measure: layout(580) });
  await flush();
  assert.equal(select(fits.id('homeTracking'), '.home-scroll')[0].scrollLeft, 0);

  // 360px beside the names: two months fit whole and 80px are left. The scroll reaches only 480px, which would show
  // 80px of the month before beside the names; the table gets those 80px after its last month instead, and the first
  // whole month starts right after the names.
  let clientWidth = 520;
  const loose = (node, what) => {
    if (node.classList.contains('home-scroll')) return { scrollWidth: 1000, clientWidth }[what] ?? 0;
    return layout(1000)(node, what);
  };
  const phone = home({ answer: structuredClone(answer), measure: loose });
  await flush();
  const scroller = select(phone.id('homeTracking'), '.home-scroll')[0];
  assert.equal(scroller.scrollLeft, 560);
  assert.equal(scroller.style['--tail'], '80px');
  // Placed before the fonts loaded, it is placed again once they have, from no room: by their measures three months
  // now fit whole.
  clientWidth = 580;
  phone.fonts.resolve();
  await flush();
  assert.equal(scroller.scrollLeft, 420);
  assert.equal(scroller.style['--tail'], undefined);
  // A new width places it again too: two months fit whole, with the 80px after the last one.
  clientWidth = 520;
  phone.resized(900);
  assert.equal(scroller.scrollLeft, 560);
  assert.equal(scroller.style['--tail'], '80px');
});

test('a month series that crosses a year names each year once', async () => {
  const answer = fixture();
  answer.months.series.accounts = { '2026-11': 1, '2026-12': 2, '2027-01': 3 };
  const page = home({ answer });
  await flush();
  const chart = bySeries(page.section('signups'), 'accounts');
  assert.ok(select(chart, 'ol.home-months')[0].classList.contains('has-years'));
  assert.deepEqual(select(chart, '.home-month-year').map((year) => year.textContent), ['2026', '2027']);
  assert.deepEqual(select(chart, 'li.home-month').map((month) => select(month, '.home-month-year').length), [1, 0, 1]);
  assert.equal(closed(chart), 'Cuentas nuevas, por mes nov 2026 1 dic 2 ene 2027 3');
  // The row of charts makes room for a year; a series inside one year names none.
  assert.ok(select(page.section('signups'), '.home-charts')[0].classList.contains('has-years'));
  const entered = bySeries(page.section('signups'), 'entered');
  assert.equal(select(entered, 'ol.home-months')[0].classList.contains('has-years'), false);
  assert.equal(select(entered, '.home-month-year').length, 0);
  // Only the months drawn count: thirteen months from dec 2026 draw the twelve of 2027, which cross no year.
  const later = fixture();
  later.months.series.accounts = Object.fromEntries(['2026-12', ...Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, '0')}`)].map((month, i) => [month, i + 1]));
  const year = home({ answer: later });
  await flush();
  const drawn = bySeries(year.section('signups'), 'accounts');
  assert.equal(select(drawn, 'li.home-month').length, 12);
  assert.ok(closed(drawn).startsWith('Cuentas nuevas, por mes ene 2 feb 3'), closed(drawn));
  assert.equal(select(drawn, 'ol.home-months')[0].classList.contains('has-years'), false);
  assert.equal(select(drawn, '.home-month-year').length, 0);
  assert.equal(select(year.section('signups'), '.home-charts')[0].classList.contains('has-years'), false);
});

test('a month chart draws the latest twelve months, as wide as their widest figure, and scrolls when wider than its column', async () => {
  // Thirteen months, July 2026 to July 2027: the oldest (12.000 in Spanish, six characters) is left to the CSV.
  const months = Array.from({ length: 13 }, (_, i) => `${2026 + Math.floor((6 + i) / 12)}-${String(((6 + i) % 12) + 1).padStart(2, '0')}`);
  assert.deepEqual([months[0], months[12]], ['2026-07', '2027-07']);
  const answer = fixture();
  answer.months.series.accounts = Object.fromEntries(months.map((month, i) => [month, i === 0 ? 12000 : 1000 + i]));
  let column = 358;
  // The accounts chart's box: twelve 50px months (600px) in a 358px column, until the column changes. A month's
  // offsetLeft is read from the box.
  const accountsBox = (node) => { let at = node; while (at && !at.dataset.title) at = at.parent; return at?.dataset.title === 'home-s-accounts'; };
  const measure = (node, what) => {
    if (node.dataset.title === 'home-s-accounts') return { scrollWidth: 600, clientWidth: column }[what] ?? 0;
    if (what === 'offsetLeft' && node.classList.contains('home-month') && accountsBox(node)) return 50 * node.parent.elements.indexOf(node);
    return 0;
  };
  const page = home({ answer, measure });
  await flush();
  const chart = bySeries(page.section('signups'), 'accounts');
  const list = select(chart, 'ol.home-months')[0];
  assert.equal(select(list, 'li.home-month').length, 12);
  assert.equal(list.style['--n'], '12');
  assert.equal(list.style['--mw'], '4', 'the widest figure drawn: 1012, four characters');
  assert.ok(closed(chart).startsWith('Cuentas nuevas, por mes ago 2026 1001 sept 1002'), closed(chart));
  assert.ok(!closed(chart).includes('12.000'));
  assert.equal(select(list, '.home-month-bar').at(-1).style['--f'], '1.0000', 'the scale is the months drawn');
  const row = select(page.section('signups'), '.home-charts')[0];
  assert.deepEqual([row.style['--months'], row.style['--mw'], row.classList.contains('has-years')], ['12', '4', true]);
  // Wider than its column: a named group the keyboard reaches, opened on its latest whole months. The last seven fit
  // (350px from the sixth month's start): the scroll reaches only 242px, so the box gets 8px after the last month and
  // no sliver of the month before shows at its left edge. The box says the chart's name; its list does not say it again.
  const box = select(chart, '.home-months-box')[0];
  assert.equal(list.parent, box);
  assert.deepEqual([box.tabindex, box.role, box['aria-labelledby'], box.scrollLeft, box.style['--tail']], ['0', 'group', 'home-s-accounts', 250, '8px']);
  assert.equal(list['aria-labelledby'], undefined);
  const entered = select(bySeries(page.section('signups'), 'entered'), '.home-months-box')[0];
  assert.deepEqual([entered.tabindex, entered.role], [undefined, undefined], 'a chart that fits is no stop for the keyboard');
  assert.equal(select(entered, 'ol.home-months')[0]['aria-labelledby'], 'home-s-entered');
  // Placed again once the fonts have loaded: by their measures it now fits, so it is no stop, and its list names it.
  column = 640;
  page.fonts.resolve();
  await flush();
  assert.deepEqual([box.tabindex, box.role, box['aria-labelledby'], box.style['--tail'], list['aria-labelledby']], [undefined, undefined, undefined, undefined, 'home-s-accounts']);
  // A new width places it again too: the last eight months fit whole from 200px, which the scroll reaches, so it needs
  // no room after them, and the box takes the name back from its list.
  column = 400;
  page.resized(1000);
  assert.deepEqual([box.tabindex, box.role, box['aria-labelledby'], box.scrollLeft, box.style['--tail'], list['aria-labelledby']], ['0', 'group', 'home-s-accounts', 200, undefined, undefined]);
  // In English the same figures are five characters ("1,012").
  const en = home({ lang: 'en', answer: structuredClone(answer) });
  await flush();
  assert.equal(select(bySeries(en.section('signups'), 'accounts'), 'ol.home-months')[0].style['--mw'], '5');
  assert.equal(select(en.section('signups'), '.home-charts')[0].style['--mw'], '5');
});

test('the route draws every stop on one scale and dots the segment into a stop that is not one more step', async () => {
  const page = home();
  await flush();
  const stops = page.stops();
  const list = select(page.id('homeRoute'), 'ol.home-stops')[0];
  assert.deepEqual([list.style['--stops'], list.style['--digits']], ['7', '3']);
  assert.equal(list['aria-labelledby'], 'homeRouteTitle');
  assert.equal(select(page.id('homeRoute'), 'h2')[0].id, 'homeRouteTitle');
  // One scale: each column is its stop's own count over the largest stop (115, the directory), never a share of the
  // stop before.
  assert.deepEqual(stops.map((stop) => select(stop, '.home-stop-bar')[0].style['--f']), ['0.9130', '0.9217', '0.9391', '0.9565', '0.9913', '1.0000', '0.5826']);
  assert.ok(stops.every((stop) => select(stop, '.home-stop-bar')[0]['aria-hidden'] === 'true'));
  // The stop before each 'apart' stop dots its segment; the 30-day stop is the window.
  assert.deepEqual(stops.map((stop) => stop.classList.contains('to-apart')), [false, false, false, false, true, true, false]);
  assert.deepEqual(stops.map((stop) => stop.classList.contains('is-window')), [false, false, false, false, false, false, true]);
  // Each node is an SVG ring that a screen reader skips, its class set as an SVG element takes one.
  const nodes = stops.map((stop) => select(stop, 'svg')[0]);
  assert.ok(nodes.every((svg) => svg.namespaceURI === SVG && svg.getAttribute('class') === 'home-stop-node' && svg.getAttribute('aria-hidden') === 'true'), 'svg nodes');
  assert.ok(nodes.every((svg) => svg.elements.length === 1 && svg.elements[0].tagName === 'circle'));
  // A stop's second lines run right under the stops that have none (three at most): the accounts' over three stops.
  const wide = select(stops[0], '.home-stop-mores')[0];
  assert.ok(wide.classList.contains('is-wide'));
  assert.equal(wide.style['--span'], '3');
  // The caption says what the path is not; the key, a sample of the dotted line and the answer's own sentence for it.
  const note = select(page.id('homeRoute'), 'p.home-route-note')[0];
  assert.equal(rendered(note), `${ROUTE_NOTE} ${TEXTS.es.routeApart}`);
  assert.equal(flat(note), `${ROUTE_NOTE} ${TEXTS.es.routeApart}`);
  const key = select(note, '.home-route-key')[0];
  assert.equal(select(key, '.home-key-dash')[0]['aria-hidden'], 'true');
  assert.equal(flat(key), TEXTS.es.routeApart);
  // The sample and the sentence's first word never part at a line end: they stand together in one unbroken span.
  const lead = select(key, '.home-key-lead')[0];
  assert.equal(lead.parent, key);
  assert.equal(lead.elements[0].className, 'home-key-dash');
  assert.equal(flat(lead), TEXTS.es.routeApart.split(' ')[0]);

  const said = fixture();
  said.texts.es.routeApart = 'Otra frase del servidor.';
  const other = home({ answer: said });
  await flush();
  assert.equal(flat(select(other.id('homeRoute'), '.home-route-key')[0]), 'Otra frase del servidor.');
  assert.equal(flat(select(other.id('homeRoute'), '.home-key-lead')[0]), 'Otra');
  const word = fixture();
  word.texts.es.routeApart = ' Punteado ';
  const single = home({ answer: word });
  await flush();
  assert.equal(flat(select(single.id('homeRoute'), '.home-route-key')[0]), 'Punteado');
  // Without the answer's sentence there is no key; the segments stay dotted.
  for (const missing of [undefined, '', '   ']) {
    const answer = fixture();
    if (missing === undefined) delete answer.texts.es.routeApart;
    else answer.texts.es.routeApart = missing;
    const bare = home({ answer });
    await flush();
    assert.equal(rendered(select(bare.id('homeRoute'), 'p.home-route-note')[0]), ROUTE_NOTE);
    assert.equal(select(bare.id('homeRoute'), '.home-route-key').length, 0);
    assert.deepEqual(bare.stops().map((stop) => stop.classList.contains('to-apart')), [false, false, false, false, true, true, false]);
  }
  // A path of its own: the stop before its 'apart' stop dots the segment; a path with none has no dotted segment and no key.
  const short = fixture();
  short.route = [['signups.accounts', 'total'], ['profiles.directory', 'total', 'apart'], ['profiles.basic', 'total']];
  const three = home({ answer: short });
  await flush();
  assert.deepEqual(three.stops().map((stop) => [stop.dataset.key, stop.classList.contains('to-apart')]), [['signups.accounts', true], ['profiles.directory', false], ['profiles.basic', false]]);
  assert.equal(select(three.id('homeRoute'), 'ol.home-stops')[0].style['--stops'], '3');
  const straight = fixture();
  straight.route = [['signups.accounts', 'total'], ['signups.confirmed', 'total']];
  const two = home({ answer: straight });
  await flush();
  assert.ok(two.stops().every((stop) => !stop.classList.contains('to-apart')));
  assert.equal(select(two.id('homeRoute'), '.home-route-key').length, 0);
  // A lead figure that the new path does not carry stands beside it again.
  assert.deepEqual(two.id('homeLead').elements.map((item) => item.dataset.key), ['visits.arrivals', 'profiles.basic', 'activity.members', 'memberships.founders']);
  // Five-digit counts shrink every figure to the longest one.
  const big = fixture();
  indicator(big, 'signups.accounts').total = 12345;
  const large = home({ answer: big });
  await flush();
  assert.equal(select(large.id('homeRoute'), 'ol.home-stops')[0].style['--digits'], '6');
  assert.equal(select(large.stops()[0], '.home-stop-n')[0].textContent, '12.345');
});

test('a stop that could not be counted says why where its column would stand, and only once', async () => {
  const answer = fixture();
  for (const key of ['signups.accounts', 'signups.new']) {
    const ind = indicator(answer, key);
    for (const f of ['total', 'd30', 'd7', 'last', 'daysSince']) delete ind[f];
    ind.state = 'unavailable';
  }
  const page = home({ answer });
  await flush();
  const [accounts] = page.stops();
  assert.equal(select(accounts, '.home-stop-n')[0].textContent, '—');
  assert.equal(select(accounts, '.home-stop-why')[0].textContent, 'No disponible en este momento');
  assert.equal(select(accounts, '.home-stop-bar')[0].style['--f'], undefined);
  assert.equal(closed(select(accounts, 'span.home-stop-more[data-key=signups.new]')[0]), '— Cuentas nuevas en 7 días', 'the same reason is not said twice');
  assert.equal(select(page.stops()[5], '.home-stop-bar')[0].style['--f'], '1.0000', 'the scale is the largest stop counted');

  const other = fixture();
  const ind = indicator(other, 'signups.new');
  for (const f of ['d30', 'd7', 'last', 'daysSince']) delete ind[f];
  ind.state = 'not_activated';
  const second = home({ answer: other });
  await flush();
  assert.equal(closed(select(second.stops()[0], 'span.home-stop-more[data-key=signups.new]')[0]), '— Cuentas nuevas en 7 días Aún no está activado en la base de datos');
  assert.equal(flat(select(second.stops()[0], 'span.home-stop-more[data-key=signups.new]')[0]), '— Cuentas nuevas en 7 días Aún no está activado en la base de datos');
});

test('an answer without a path keeps every lead figure in a row beside the queues', async () => {
  for (const route of [undefined, [], null, 'stops']) {
    const answer = fixture();
    if (route === undefined) delete answer.route;
    else answer.route = route;
    const page = home({ answer });
    await flush();
    assert.equal(page.id('homeRoute').hidden, true, String(route));
    assert.ok(page.id('homeTop').classList.contains('no-route'));
    assert.equal(page.stops().length, 0);
    const lead = page.id('homeLead');
    assert.equal(lead.hidden, false);
    assert.deepEqual(lead.elements.map((item) => item.dataset.key), answer.lead.map((entry) => entry.key));
    assert.deepEqual(byKey(lead, 'signups.accounts').elements.map((line) => closed(line)), ['105 Cuentas', '7 Cuentas nuevas en 7 días', '106 Con correo confirmado']);
    // The days without new accounts go back under the windows.
    assert.deepEqual(page.id('homeWindows').elements.map((span) => rendered(span)), ['Últimos 30 días: 16 oct–14 nov', 'Últimos 7 días: 8–14 nov', '19 días sin cuentas nuevas (última: 26 oct)']);
    assert.equal(page.id('homeStatus').textContent, '');
    assert.equal(page.sections().length, FAMILIES.length);
  }
  // A later answer with a path draws it again.
  let next = fixture();
  delete next.route;
  const page = home({ get: () => Promise.resolve(response(next)) });
  await flush();
  next = fixture();
  page.id('homeRefresh').click();
  await flush();
  assert.equal(page.id('homeRoute').hidden, false);
  assert.equal(page.id('homeTop').classList.contains('no-route'), false);
  assert.equal(page.stops().length, ROUTE.length);
});

test('an answer that does not say which indicator each month series splits keeps every series in Seguimiento', async () => {
  for (const map of [undefined, null, [], 'views']) {
    const answer = fixture();
    if (map === undefined) delete answer.seriesIndicator;
    else answer.seriesIndicator = map;
    answer.months.series.registrations = { state: 'unavailable' };
    const page = home({ answer });
    await flush();
    assert.equal(page.sections().flatMap((section) => select(section, '.home-chart')).length, 0, String(map));
    const tracking = page.id('homeTracking');
    assert.deepEqual(select(tracking, '.home-chart').map((chart) => chart.dataset.series), ['accounts', 'entered', 'registrations', 'views', 'arrivals']);
    assert.equal(closed(bySeries(tracking, 'registrations')), 'Inscripciones al festival, por mes — No disponible en este momento');
    assert.equal(closed(bySeries(tracking, 'views')), 'Páginas vistas, por mes nov 40');
    // No row says a month it was not given.
    assert.equal(closed(select(byKey(page.section('visits'), 'visits.views'), '.home-fig-more')[0]), '1 en 7 días');
  }
});

test('the survey pair is one row while both totals are there, and two rows otherwise', async () => {
  const answer = fixture();
  indicator(answer, 'courses.surveyAnswered').total = 9;
  indicator(answer, 'courses.surveyTotal').total = 17;
  const page = home({ answer });
  await flush();
  const courses = page.section('courses');
  const pair = select(courses, 'li.home-pair')[0];
  assert.deepEqual([pair.dataset.key, pair.dataset.of], ['courses.surveyAnswered', 'courses.surveyTotal']);
  assert.equal(closed(pair), '9 de 17 Encuesta final: respondieron');
  // Both definitions under it, each named.
  assert.deepEqual(select(pair, '.home-def').map((def) => def.dataset.def), ['courses.surveyAnswered', 'courses.surveyTotal']);
  assert.deepEqual(select(pair, '.home-def-name').map((strong) => strong.textContent), ['Encuesta final: respondieron. ', 'Encuesta final: personas. ']);
  assert.equal(byKey(courses, 'courses.surveyTotal'), undefined, 'the whole is not a row of its own');
  const rows = select(courses, 'ul.home-figs')[0].elements.map((row) => row.dataset.key);
  assert.equal(rows.indexOf('courses.surveyAnswered'), rows.indexOf('courses.comments') + 1, 'it stands where the whole stands');

  for (const [change, total, answered] of [
    [(a) => { delete a.pairs; }, '17 Encuesta final: personas', '9 Encuesta final: respondieron'],
    [(a) => { a.pairs = 'courses'; }, '17 Encuesta final: personas', '9 Encuesta final: respondieron'],
    [(a) => { const ind = indicator(a, 'courses.surveyTotal'); delete ind.total; ind.state = 'unavailable'; }, '— Encuesta final: personas No disponible en este momento', '9 Encuesta final: respondieron'],
    [(a) => { const ind = indicator(a, 'courses.surveyAnswered'); delete ind.total; ind.state = 'unavailable'; }, '17 Encuesta final: personas', '— Encuesta final: respondieron No disponible en este momento'],
  ]) {
    const apart = structuredClone(answer);
    change(apart);
    const two = home({ answer: apart });
    await flush();
    const block = two.section('courses');
    assert.equal(select(block, 'li.home-pair').length, 0);
    assert.deepEqual([closed(byKey(block, 'courses.surveyTotal')), closed(byKey(block, 'courses.surveyAnswered'))], [total, answered]);
  }
});

test('activity by kind says a week with nothing in any kind once, and the 7 days of each kind otherwise', async () => {
  const quiet = fixture();
  indicator(quiet, 'activity.kinds').items = [{ key: 'profile', n: 119, d7: 0 }, { key: 'network', n: 9, d7: 0 }, { key: 'opportunities', n: 0, d7: 0 }];
  const page = home({ answer: quiet });
  await flush();
  const kinds = () => byList(page.id('homeBlocks'), 'activity.kinds');
  // One muted line under the title (after its definition), before the rows; no row repeats "0 en 7 días".
  assert.deepEqual(kinds().elements.map((n) => [n.tagName, n.className]), [['h3', 'home-sub'], ['div', 'home-def'], ['p', 'home-note home-none-week'], ['ol', 'home-rank']]);
  assert.equal(select(kinds(), '.home-rank-more').length, 0);
  assert.equal(closed(kinds()), 'Actividad por tipo en 30 días 0 en 7 días en todos los tipos 119 perfil (guardó su perfil o marcó avisos como leídos) 9 red 0 oportunidades');
  page.ready();
  for (const [lang, line] of [['en', '0 in 7 days for every kind'], ['pt', '0 em 7 dias em todos os tipos']]) {
    page.apply(lang);
    await flush();
    assert.deepEqual(select(kinds(), 'p.home-none-week').map((p) => p.textContent), [line]);
  }
  // One kind with something in the 7 days: every row says its own, the zeros too, and there is no line.
  const busy = fixture();
  indicator(busy, 'activity.kinds').items = [{ key: 'profile', n: 119, d7: 0 }, { key: 'network', n: 9, d7: 2 }, { key: 'opportunities', n: 0, d7: 0 }];
  const week = home({ answer: busy });
  await flush();
  const list = byList(week.id('homeBlocks'), 'activity.kinds');
  assert.equal(select(list, '.home-none-week').length, 0);
  assert.equal(closed(list), 'Actividad por tipo en 30 días 119 perfil (guardó su perfil o marcó avisos como leídos), 0 en 7 días 9 red, 2 en 7 días 0 oportunidades, 0 en 7 días');
  // A row without its 7 days: the others still say theirs, and there is no line.
  const partial = fixture();
  indicator(partial, 'activity.kinds').items = [{ key: 'profile', n: 119, d7: 0 }, { key: 'network', n: 9 }];
  const some = home({ answer: partial });
  await flush();
  const rows = byList(some.id('homeBlocks'), 'activity.kinds');
  assert.equal(select(rows, '.home-none-week').length, 0);
  assert.equal(closed(rows), 'Actividad por tipo en 30 días 119 perfil (guardó su perfil o marcó avisos como leídos), 0 en 7 días 9 red');
  // A list that never counts the 7 days says nothing of them.
  assert.equal(select(byList(some.id('homeBlocks'), 'visits.topPages'), '.home-none-week').length, 0);
});

test('every queue is a link, and the waiting ones lead the top', async () => {
  const calm = fixture();
  calm.pending = { interests: 0, orgRequests: 0, lab: 0 };
  const quiet = home({ answer: calm });
  await flush();
  const top = quiet.id('homeTop');
  assert.deepEqual(top.elements.map((node) => node.id), ['homeRoute', 'homeLead', 'homePending']);
  assert.equal(top.classList.contains('is-waiting'), false);
  const pending = quiet.id('homePending');
  assert.equal(select(pending, 'h2')[0].textContent, 'Nada por atender');
  // The section is named by its heading, under the id the markup gives it.
  assert.equal(select(pending, 'h2')[0].id, 'homePendingTitle');
  assert.equal(pending['aria-labelledby'], 'homePendingTitle');
  assert.equal(select(pending, 'ul.home-queues')[0]['aria-labelledby'], select(pending, 'h2')[0].id);
  assert.deepEqual(select(pending, 'li').map((li) => [li.className, closed(li), select(li, 'a')[0].href]), [
    ['', '0 Solicitudes de interés', 'admin.html#interests'],
    ['', '0 Solicitudes de organizaciones', 'admin.html#nodes'],
    ['', '0 Postulaciones al laboratorio', 'fiiu-admin.html'],
  ]);
  // Something waiting comes first, on the page and for the keyboard; a refresh that empties the queues puts them back
  // after the path.
  let next = fixture();
  const page = home({ get: () => Promise.resolve(response(next)) });
  await flush();
  assert.deepEqual(page.id('homeTop').elements.map((node) => node.id), ['homePending', 'homeRoute', 'homeLead']);
  assert.ok(page.id('homeTop').classList.contains('is-waiting'));
  assert.equal(select(page.id('homePending'), 'h2')[0].textContent, 'Por atender');
  assert.deepEqual(select(page.id('homePending'), 'li').map((li) => li.classList.contains('is-waiting')), [false, true, true]);
  next = structuredClone(calm);
  page.id('homeRefresh').click();
  await flush();
  assert.deepEqual(page.id('homeTop').elements.map((node) => node.id), ['homeRoute', 'homeLead', 'homePending']);
  assert.equal(page.id('homeTop').classList.contains('is-waiting'), false);
  // A queue the answer could not read is a dash with its reason, still a link; the others say theirs.
  const partial = fixture();
  partial.pending = { interests: 1 };
  const one = home({ answer: partial });
  await flush();
  assert.equal(select(one.id('homePending'), 'h2')[0].textContent, 'Por atender');
  assert.deepEqual(select(one.id('homePending'), 'a').map((a) => [a.href, closed(a)]), [
    ['admin.html#interests', '1 Solicitudes de interés'],
    ['admin.html#nodes', '— Solicitudes de organizaciones No disponible en este momento'],
    ['fiiu-admin.html', '— Postulaciones al laboratorio No disponible en este momento'],
  ]);
  // The festival part failed (its deadline passed): the lab queue is unknown, so nothing claims that none waits.
  const late = fixture();
  late.pending = { interests: 0, orgRequests: 0, lab: null };
  for (const ind of late.families.find((family) => family.key === 'festival').indicators) { for (const f of ['total', 'd30', 'd7', 'items', 'team']) delete ind[f]; ind.state = 'unavailable'; }
  late.unavailable = [{ part: 'festival', reason: 'timeout' }];
  const slow = home({ answer: late });
  await flush();
  const queues = slow.id('homePending');
  assert.equal(select(queues, 'h2')[0].textContent, 'Por atender');
  assert.equal(slow.id('homeTop').classList.contains('is-waiting'), false, 'nothing known waits');
  const lab = select(queues, 'li')[2];
  assert.equal(closed(lab), '— Postulaciones al laboratorio No disponible en este momento');
  // The name and its reason are one line beside the figure's own cell.
  assert.equal(flat(select(lab, '.home-fig-body')[0]), 'Postulaciones al laboratorio No disponible en este momento');
  assert.equal(select(lab, 'a')[0].href, 'fiiu-admin.html');
  assert.equal(select(lab, '.home-dash').length, 1);
  assert.equal(lab.className, '');
  // A festival not activated has no lab queue to read: the two others are all there is, and they are calm.
  const off = fixture();
  off.pending = { interests: 0, orgRequests: 0, lab: null };
  for (const ind of off.families.find((family) => family.key === 'festival').indicators) { for (const f of ['total', 'd30', 'd7', 'items', 'team']) delete ind[f]; ind.state = 'not_activated'; }
  off.notActivated = ['festival'];
  const unset = home({ answer: off });
  await flush();
  assert.equal(select(unset.id('homePending'), 'h2')[0].textContent, 'Nada por atender');
  assert.deepEqual(select(unset.id('homePending'), 'a').map((a) => a.href), ['admin.html#interests', 'admin.html#nodes']);
  // With no queue known the queues are gone.
  const unknown = fixture();
  delete unknown.pending;
  const none = home({ answer: unknown });
  await flush();
  assert.equal(none.id('homePending').hidden, true);
  assert.equal(none.id('homePending').elements.length, 0);
  assert.equal(none.id('homeTop').classList.contains('is-waiting'), false);
});

test('"Cómo se cuenta" opens a family\'s definitions under their rows, and they stay open across a re-render', async () => {
  const page = home();
  await flush();
  const visits = page.section('visits');
  const toggle = select(visits, 'button.home-how')[0];
  assert.equal(visits.classList.contains('is-explained'), false);
  toggle.click();
  assert.ok(visits.classList.contains('is-explained'));
  assert.equal(toggle['aria-expanded'], 'true');
  assert.equal(rendered(toggle), 'Ocultar (Visitas)');
  assert.equal(select(toggle, '.admin-sr')[0].textContent, ' (Visitas)');
  assert.equal(select(byKey(visits, 'visits.views'), '.home-def').length, 1, 'each definition sits in the row it explains');
  page.ready();
  page.apply('en');
  await flush();
  const again = page.section('visits');
  assert.notEqual(again, visits, 'the family was drawn again');
  assert.ok(again.classList.contains('is-explained'));
  assert.equal(rendered(select(again, 'button.home-how')[0]), 'Hide (Visits)');
  assert.ok(page.sections().filter((section) => section !== again).every((section) => !section.classList.contains('is-explained')));
  select(again, 'button.home-how')[0].click();
  assert.equal(again.classList.contains('is-explained'), false);
  assert.equal(rendered(select(again, 'button.home-how')[0]), 'How it is counted (Visits)');
});

// The cut the page should take: of every contiguous cut of the families into the columns, the one whose tallest column
// is shortest, the most even ends deciding between cuts within 24px of it.
function bestCut(heights, cols, gap) {
  const n = heights.length;
  const cuts = [];
  const walk = (start, left, bounds) => {
    if (left === 1) { cuts.push([...bounds, n]); return; }
    for (let end = start + 1; end <= n - left + 1; end += 1) walk(end, left - 1, [...bounds, end]);
  };
  walk(0, Math.min(cols, n), [0]);
  const scored = cuts.map((bounds) => {
    const totals = bounds.slice(1).map((end, c) => heights.slice(bounds[c], end).reduce((sum, h) => sum + h, 0) + gap * (end - bounds[c] - 1));
    return { bounds, tallest: Math.max(...totals), spread: Math.max(...totals) - Math.min(...totals) };
  });
  const least = Math.min(...scored.map((option) => option.tallest));
  return scored.filter((option) => option.tallest <= least + 24).sort((a, b) => a.spread - b.spread)[0].bounds;
}
const HEIGHTS = { visits: 400, signups: 380, profiles: 300, activity: 520, memberships: 610, festival: 700, courses: 820 };
const tall = (heights) => (node, what) => (what === 'height' ? heights[node.dataset.family] ?? 0 : 0);

test('the families keep the catalogue\'s order down the columns, cut where the tallest column is shortest', async () => {
  const heights = { visits: 900, signups: 700, profiles: 300, activity: 500, memberships: 450, festival: 1000, courses: 650 };
  const page = home({ cols: 3, gap: 24, measure: tall(heights) });
  await flush();
  assert.deepEqual(bestCut(FAMILIES.map((family) => heights[family]), 3, 24), [0, 2, 5, 7]);
  // Seguimiento, a few lines while there is one reading or none, closes the shortest column.
  assert.deepEqual(page.columns(), [['visits', 'signups'], ['profiles', 'activity', 'memberships', 'homeTracking'], ['festival', 'courses']]);
  assert.ok(page.id('homeBlocks').elements.every((column) => column.className === 'home-col'));
  // Print and one column read them in the catalogue's order.
  assert.deepEqual(page.sections().map((section) => section.style.order), ['0', '1', '2', '3', '4', '5', '6']);
  assert.equal(page.id('homeTracking').style.order, '7');
  // Two cuts with the same tallest column: the one with the most even ends.
  const tie = home({ cols: 3, gap: 24, measure: tall(HEIGHTS) });
  await flush();
  assert.deepEqual(bestCut(FAMILIES.map((family) => HEIGHTS[family]), 3, 24), [0, 3, 5, 7]);
  assert.deepEqual(tie.columns(), [['visits', 'signups', 'profiles', 'homeTracking'], ['activity', 'memberships'], ['festival', 'courses']]);
  // Two columns, and one: the same order, cut again.
  const narrow = home({ cols: 2, gap: 24, measure: tall(HEIGHTS) });
  await flush();
  const [cut] = [bestCut(FAMILIES.map((family) => HEIGHTS[family]), 2, 24)];
  assert.deepEqual(narrow.columns().map((column) => column.filter((name) => name !== 'homeTracking')), [FAMILIES.slice(0, cut[1]), FAMILIES.slice(cut[1])]);
  const single = home({ cols: 1, measure: tall(HEIGHTS) });
  await flush();
  assert.deepEqual(single.columns(), [[...FAMILIES, 'homeTracking']]);
});

test('twelve families in three columns weigh the 55 contiguous cuts, no more', async () => {
  const answer = fixture();
  for (let i = 1; i <= 5; i += 1) answer.families.push({ key: `extra${i}`, indicators: [{ key: `extra${i}.figure`, total: i }] });
  const keys = answer.families.map((family) => family.key);
  const list = [300, 520, 410, 380, 600, 450, 700, 250, 330, 280, 390, 310];
  const heights = Object.fromEntries(keys.map((key, i) => [key, list[i]]));
  const page = home({ answer, cols: 3, gap: 24, measure: tall(heights) });
  // Each cut the page weighs is an option it pushes ({ tallest, spread, bounds }); count them while the answer is laid out.
  const prototype = vm.runInContext('Array.prototype', page.context);
  const push = prototype.push;
  let weighed = 0;
  prototype.push = function (...items) { weighed += items.filter((item) => Array.isArray(item?.bounds)).length; return push.apply(this, items); };
  try { await flush(); } finally { prototype.push = push; }
  assert.equal(weighed, 55);
  const cut = bestCut(list, 3, 24);
  assert.deepEqual(page.columns().map((column) => column.filter((name) => name !== 'homeTracking')), [keys.slice(0, cut[1]), keys.slice(cut[1], cut[2]), keys.slice(cut[2])]);
});

test('a cut within 24px of the shortest tallest column wins when its ends are more even', async () => {
  const heights = { visits: 320, signups: 540, profiles: 340, activity: 240, memberships: 260, festival: 560, courses: 680 };
  // [0, 3, 6, 7] has the shortest tallest column (1248px, spread 568); [0, 2, 5, 7] is 16px taller, spread 380.
  assert.deepEqual(bestCut(FAMILIES.map((family) => heights[family]), 3, 24), [0, 2, 5, 7]);
  const page = home({ cols: 3, gap: 24, measure: tall(heights), storage: null });
  await flush();
  assert.deepEqual(page.columns().map((column) => column.filter((name) => name !== 'homeTracking')), [['visits', 'signups'], ['profiles', 'activity', 'memberships'], ['festival', 'courses']]);
});

test('a remembered cut is kept within 120px of the best even where 15% is less', async () => {
  // Short columns: the best cut [0, 4, 7] has a 592px column; the remembered [0, 3, 7] one of 692px, 100px over. 15%
  // would allow 88.8px, the 120px floor allows it.
  const heights = { visits: 200, signups: 100, profiles: 100, activity: 120, memberships: 100, festival: 160, courses: 240 };
  assert.deepEqual(bestCut(FAMILIES.map((family) => heights[family]), 2, 24), [0, 4, 7]);
  const storage = memoryStorage({ 'nodal.home.cuts': JSON.stringify({ '2:7': [0, 3, 7] }) });
  const page = home({ cols: 2, gap: 24, measure: tall(heights), storage });
  await flush();
  assert.deepEqual(page.columns().map((column) => column.filter((name) => name !== 'homeTracking')), [['visits', 'signups', 'profiles'], ['activity', 'memberships', 'festival', 'courses']]);
  assert.deepEqual(JSON.parse(storage.data.get('nodal.home.cuts')), { '2:7': [0, 3, 7] });
});

test('a new width or the loaded fonts lay the columns out again, and the same width does not', async () => {
  const page = home({ cols: 3, gap: 24, measure: tall(HEIGHTS), storage: null });
  await flush();
  assert.equal(page.columns().length, 3);
  // The stylesheet now gives two columns (the window narrowed past 1180px): the observer lays them out again.
  page.setCols(2);
  page.resized(1000);
  const cut = bestCut(FAMILIES.map((family) => HEIGHTS[family]), 2, 24);
  assert.deepEqual(page.columns().map((column) => column.filter((name) => name !== 'homeTracking')), [FAMILIES.slice(0, cut[1]), FAMILIES.slice(cut[1])]);
  assert.ok(page.id('homeBlocks').elements.every((column) => column.className === 'home-col'));
  // The same width again: nothing is laid out.
  const replaced = page.id('homeBlocks').replaced;
  page.setCols(3);
  page.resized(1000);
  assert.equal(page.id('homeBlocks').replaced, replaced);
  assert.equal(page.columns().length, 2);
  // The fonts load: the columns are measured and cut again.
  page.fonts.resolve();
  await flush();
  assert.equal(page.columns().length, 3);
  assert.deepEqual(page.sections().map((section) => section.dataset.family), FAMILIES);
});

test('the columns are measured with every definition closed, so opening one never moves a family', async () => {
  // A family whose definitions are open is 900px taller, except while #homeBlocks measures with them closed.
  const blocksOf = (node) => { let at = node; while (at && at.id !== 'homeBlocks') at = at.parent; return at; };
  const measure = (node, what) => {
    if (what !== 'height' || !node.dataset.family) return 0;
    const open = node.classList.contains('is-explained') && !blocksOf(node)?.classList.contains('is-measuring');
    return HEIGHTS[node.dataset.family] + (open ? 900 : 0);
  };
  // Measured open, Festival would take another cut.
  assert.notDeepEqual(bestCut(FAMILIES.map((family) => HEIGHTS[family] + (family === 'festival' ? 900 : 0)), 3, 24), bestCut(FAMILIES.map((family) => HEIGHTS[family]), 3, 24));
  const page = home({ cols: 3, gap: 24, measure, storage: null });
  await flush();
  const before = page.columns();
  select(page.section('festival'), 'button.home-how')[0].click();
  assert.ok(page.section('festival').classList.contains('is-explained'));
  page.ready();
  page.apply('pt');
  await flush();
  assert.ok(page.section('festival').classList.contains('is-explained'), 'still open after the re-render');
  assert.deepEqual(page.columns(), before);
  assert.equal(page.id('homeBlocks').classList.contains('is-measuring'), false);
});

test('a remembered cut is kept while its tallest column stays near the best, and replaced when it does not', async () => {
  // [0, 4, 5, 7] leaves a 1672px column: 128px over the best cut's 1544px, inside max(15%, 120px) = 232px.
  const near = memoryStorage({ 'nodal.home.cuts': JSON.stringify({ '3:7': [0, 4, 5, 7], '2:7': [0, 3, 7] }) });
  const kept = home({ cols: 3, gap: 24, measure: tall(HEIGHTS), storage: near });
  await flush();
  const remembered = [['visits', 'signups', 'profiles', 'activity'], ['memberships', 'homeTracking'], ['festival', 'courses']];
  assert.deepEqual(kept.columns(), remembered);
  assert.deepEqual(JSON.parse(near.data.get('nodal.home.cuts')), { '3:7': [0, 4, 5, 7], '2:7': [0, 3, 7] });
  // The families stay put across a language change.
  kept.ready();
  kept.apply('pt');
  await flush();
  assert.deepEqual(kept.columns(), remembered);
  // [0, 3, 6, 7] would leave a 1878px column, 334px over: the best cut takes its place and is remembered instead.
  const far = memoryStorage({ 'nodal.home.cuts': JSON.stringify({ '3:7': [0, 3, 6, 7], '2:7': [0, 3, 7] }) });
  const moved = home({ cols: 3, gap: 24, measure: tall(HEIGHTS), storage: far });
  await flush();
  const best = [['visits', 'signups', 'profiles', 'homeTracking'], ['activity', 'memberships'], ['festival', 'courses']];
  assert.deepEqual(moved.columns(), best);
  assert.deepEqual(JSON.parse(far.data.get('nodal.home.cuts')), { '3:7': [0, 3, 5, 7], '2:7': [0, 3, 7] });
  // A first visit, a cut for another layout and stored rubbish all take the best cut, and remember it.
  for (const held of [undefined, JSON.stringify({ '3:7': [0, 9] }), 'not json', 'null']) {
    const storage = memoryStorage(held === undefined ? {} : { 'nodal.home.cuts': held });
    const page = home({ cols: 3, gap: 24, measure: tall(HEIGHTS), storage });
    await flush();
    assert.deepEqual(page.columns(), best, String(held));
    assert.deepEqual(JSON.parse(storage.data.get('nodal.home.cuts'))['3:7'], [0, 3, 5, 7]);
  }
});

test('the page lays its columns out the same without storage, or with storage that throws', async () => {
  const best = [['visits', 'signups', 'profiles', 'homeTracking'], ['activity', 'memberships'], ['festival', 'courses']];
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota exceeded'); } };
  const reads = { getItem() { throw new Error('denied'); }, setItem() {} };
  for (const storage of ['throws', null, throwing, reads]) {
    const page = home({ cols: 3, gap: 24, measure: tall(HEIGHTS), storage });
    await flush();
    assert.deepEqual(page.columns(), best, String(storage));
    assert.equal(page.sections().length, FAMILIES.length);
    assert.equal(page.id('homeStatus').textContent, '');
    assert.equal(page.posts().length, 1);
    page.ready();
    page.apply('en');
    await flush();
    assert.deepEqual(page.columns(), best);
    assert.equal(page.id('homeTitle').textContent, 'NODAL metrics');
  }
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
    // A 200 that is not the answer.
    [() => Promise.resolve(response({})), 'failed'],
  ]) {
    const gate = deferred();
    let n = 0;
    const page = home({ get: () => { n += 1; return n === 1 ? first() : gate.promise; } });
    await flush();
    assert.equal(page.id('homeStatus').textContent, STATUS[row]);
    assert.equal(page.id('homeRetry').hidden, false);
    assert.equal(page.id('homeSignIn').hidden, true);
    assert.equal(page.sections().length, 0);
    assert.equal(page.id('homeTop').hidden, true);
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
    assert.equal(page.sections().length, FAMILIES.length);
    assert.equal(page.id('homeTop').hidden, false);
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
  assert.ok(rendered(page.id('homeRoute')).includes('105'));
  assert.equal(page.sections().length, FAMILIES.length);
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
  assert.equal(link.parent, null, 'and taken away again');
  assert.equal(ok.id('homeCsv').disabled, false);

  for (const [status, row] of [[401, 'expired'], [429, 'tooMany']]) {
    const page = home({ download: () => Promise.resolve(response({ error: 'x' }, status)) });
    await flush();
    await page.id('homeCsv').click();
    await flush();
    assert.equal(page.id('homeStatus').textContent, STATUS[row]);
    assert.equal(page.created.filter((n) => n.tagName === 'a' && n.clicked).length, 0);
    assert.equal(page.sections().length, FAMILIES.length);
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
    assert.equal(empty.sections().length, 0);
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

  // The CSV comes in the page's language, and a double click asks once.
  const english = home({ download: () => Promise.resolve(response('', 200, { 'content-disposition': `attachment; filename="${name}"` })) });
  await flush();
  english.ready();
  english.apply('en');
  await flush();
  english.id('homeCsv').click();
  english.id('homeCsv').click();
  await flush();
  const exports = english.calls.filter((c) => c.url.startsWith('/api/admin/metrics/export'));
  assert.deepEqual(exports.map((c) => c.url), ['/api/admin/metrics/export?table=indicators&lang=en']);
  assert.equal(english.created.filter((n) => n.tagName === 'a' && n.clicked).length, 1);

  const months = home({ download: () => Promise.resolve(response('', 200, { 'content-disposition': 'attachment; filename="nodal-indicadores-por-mes-2026-11-14.csv"' })) });
  await flush();
  assert.equal(months.id('homeMonthsCsv').textContent, 'Por mes');
  await months.id('homeMonthsCsv').click();
  await flush();
  assert.equal(months.calls.find((c) => c.url.startsWith('/api/admin/metrics/export')).url, '/api/admin/metrics/export?table=months&lang=es');

  const readings = home({ download: () => Promise.resolve(response('', 200, { 'content-disposition': 'attachment; filename="nodal-indicadores-lecturas-2026-11-14.csv"' })) });
  await flush();
  await readings.id('homeReadingsCsv').click();
  await flush();
  assert.equal(readings.calls.find((c) => c.url.startsWith('/api/admin/metrics/export')).url, '/api/admin/metrics/export?table=readings&lang=es');
});

test('printing opens every definition and the folded reading, then puts each back as it was', async () => {
  const answer = fixture();
  answer.readings = { today: true, months: [{ month: '2026-11', day: '2026-11-14', defs: DEFS, figures: { 'signups.accounts': 105 } }] };
  const page = home({ answer });
  await flush();
  const sections = page.sections();
  const toggles = sections.map((section) => select(section, 'button.home-how')[0]);
  toggles[2].click();
  const reading = select(page.id('homeTracking'), 'details.home-reading')[0];
  assert.equal(reading.open, false);
  page.fire('beforeprint');
  assert.ok(sections.every((section) => section.classList.contains('is-explained')));
  assert.ok(toggles.every((toggle) => toggle['aria-expanded'] === 'true'));
  assert.equal(reading.open, true);
  page.fire('afterprint');
  assert.deepEqual(sections.map((section) => section.classList.contains('is-explained')), sections.map((_, i) => i === 2));
  assert.deepEqual(toggles.map((toggle) => toggle['aria-expanded']), toggles.map((_, i) => String(i === 2)));
  assert.equal(reading.open, false);
  // Printing changed nothing the reader had opened: the next render opens the same family.
  page.ready();
  page.apply('pt');
  await flush();
  assert.deepEqual(page.sections().map((section) => section.classList.contains('is-explained')), sections.map((_, i) => i === 2));
  page.id('homePrint').click();
  assert.equal(page.printed.length, 1);
});

test('the folded reading the reader opened stays open across a re-render', async () => {
  const answer = fixture();
  answer.readings = { today: true, months: [{ month: '2026-11', day: '2026-11-14', defs: DEFS, figures: { 'signups.accounts': 105 } }] };
  const page = home({ answer });
  await flush();
  const reading = select(page.id('homeTracking'), 'details.home-reading')[0];
  assert.equal(reading.open, false);
  reading.open = true;
  reading.listeners.get('toggle')();
  page.ready();
  page.apply('pt');
  await flush();
  const again = select(page.id('homeTracking'), 'details.home-reading')[0];
  assert.notEqual(again, reading, 'the reading was drawn again');
  assert.equal(again.open, true);
  assert.equal(select(again, 'summary')[0].textContent, 'Ver a leitura de nov. de 2026');
  // Folded again by the reader, it stays folded.
  again.open = false;
  again.listeners.get('toggle')();
  page.apply('en');
  await flush();
  assert.equal(select(page.id('homeTracking'), 'details.home-reading')[0].open, false);
});

// A length in px (rem and em at the desk's 16px).
const pixels = (value) => { const m = /^(-?[\d.]+)(px|rem|em)$/.exec(value.trim()); return m ? Number(m[1]) * (m[2] === 'px' ? 1 : 16) : null; };
// The innermost rules of a stylesheet (inside @media too): [selectors, declarations].
const rules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].split(',').map((selector) => selector.trim()), m[2]]);
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
  // The page's CSP refuses inline styles: sizes go through the CSSOM, the route's nodes are built as SVG elements.
  assert.doesNotMatch(js, /\.style\s*=[^=]|setAttribute\('style'|cssText/);
  assert.match(js, /createElementNS\(SVG, 'svg'\)/);
  const css = STYLE().replace(/\/\*[\s\S]*?\*\//g, '');
  // No thick left bar, whatever the order of the values or the unit.
  for (const m of css.matchAll(/border(?:-left|-inline-start|-inline)?(?:-width)?\s*:\s*([^;}]+)/g)) {
    assert.doesNotMatch(m[1], /\b(?:medium|thick)\b/, m[0]);
    for (const token of m[1].split(/\s+/)) { const length = pixels(token); if (length !== null) assert.ok(length < 3, m[0]); }
  }
  // Text never below .875rem: every size, and the floor of each clamp(). The route's figure is min(clamp(…), calc(…)):
  // its clamp() floor counts, and calc() only fits five digits to their stop.
  let route = 0;
  for (const m of css.matchAll(/font-size\s*:\s*([^;}]+)/g)) {
    const value = m[1].trim();
    if (value === 'inherit') continue;
    const fitted = /^min\((clamp\([^)]*\)),\s*calc\(.+\)\)$/.exec(value);
    if (fitted) route += 1;
    const floor = /^clamp\(([^,]+),/.exec(fitted ? fitted[1] : value)?.[1] ?? value;
    assert.ok(pixels(floor) >= 14, m[0]);
  }
  assert.equal(route, 1, 'only the route\'s figure is fitted to its stop');
  // No tinted tiles: no beige, no background on a family, a lead item or a column.
  assert.ok(!css.includes('--beige'));
  for (const [selectors, body] of rules(css)) {
    if (selectors.some((selector) => /(?:^|\s)\.home-(?:block|lead-item|col)$/.test(selector))) assert.doesNotMatch(body, /background/, selectors.join());
  }
  assert.doesNotMatch(css, /box-shadow/);
  assert.doesNotMatch(css, /border-radius/);
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/g)) assert.equal(m[1].trim(), 'inherit');
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  assert.ok(css.includes('@media (max-width: 640px)'));
  // 44px targets on a phone, and on any touch screen whatever its width; a wrapped block head keeps them apart.
  for (const media of ['@media (max-width: 640px)', '@media (pointer: coarse)']) {
    const touch = rules(block(css, css.indexOf(media)));
    const has = (selector, declaration) => touch.some(([selectors, body]) => selectors.includes(selector) && declaration.test(body));
    for (const selector of ['#homeMain .admin-textbutton', '.home-see', '.home-compare', '.home-actions a', '.home-queue']) assert.ok(has(selector, /min-height:\s*44px/), `${media} ${selector}`);
    assert.ok(has('.home-reading > summary', /min-height:\s*44px/), media);
    assert.ok(has('.home-block-head', /row-gap:\s*12px/), `${media}: wrapped head targets touch, never overlap`);
    assert.ok(has('.home-block-head .home-see', /margin-block:\s*-6px/), media);
    assert.ok(!touch.some(([selectors, body]) => selectors.includes('.home-block-head .home-see') && /margin(?:-left|-inline-start)?\s*:/.test(body)), `${media}: "Ver en" keeps its margin-left: auto`);
    assert.ok(has('.home-queue', /align-content:\s*center/), `${media}: a queue's lines are centred in its target`);
  }
  // A queue that wraps keeps its figure on its name's first line: no rule centres the figure between the lines.
  assert.ok(!rules(css).some(([selectors, body]) => selectors.some((selector) => /\.home-queue$/.test(selector)) && /align-items:\s*center/.test(body)));
  // A lead item's lines stand at its top, never spread over a stretched row.
  assert.ok(rules(css).some(([selectors, body]) => selectors.includes('.home-lead-item') && /align-content:\s*start/.test(body)));
  // A month column is never narrower than its widest figure (--mw) or a month's name, and a year's label is two whole
  // line boxes with its padding and rule, so every month stands on one baseline.
  assert.match(css, /\.home-months\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--n, 5\), minmax\(var\(--col\), 3\.25rem\)\)/);
  assert.match(css, /--col:\s*max\(2rem, calc\(var\(--mw, 3\) \* \.6125rem \+ 2px\)\)/);
  assert.match(css, /\.home-charts\s*\{[^}]*calc\(var\(--months, 5\) \* max\(2\.5rem, var\(--col\)\)\)/);
  assert.match(css, /\.home-months\.has-years \.home-month-label\s*\{\s*min-height:\s*calc\(2\.5em \+ 4px\)/);
  assert.match(css, /\.home-months-box\s*\{[^}]*padding-inline-end:\s*var\(--tail, 0px\)[^}]*overflow-x:\s*auto/);
  assert.match(css, /\.home-charts\.has-years, \.home-months\.has-years\s*\{\s*--col:\s*max\(2\.125rem,/);
  assert.match(css, /\.home-scroll\s*\{[^}]*padding-inline-end:\s*var\(--tail, 0px\)/);
  assert.match(css, /\.home-key-lead\s*\{\s*white-space:\s*nowrap/);
  // The columns are measured with every definition closed: the rule comes after the one that opens them.
  const explained = css.search(/\.home-block\.is-explained \.home-def\s*\{/);
  const measuring = css.search(/\.home-blocks\.is-measuring \.home-def\s*\{\s*display:\s*none/);
  assert.ok(explained >= 0 && measuring > explained, 'is-measuring hides the definitions after is-explained shows them');
  const print = block(css, css.indexOf('@media print'));
  assert.ok(css.includes('@media print'));
  for (const selector of ['.navbar', '.staff-nav', 'button', '#homePending', '.home-tools']) assert.ok(print.includes(selector), selector);
  // A family's rows in the month table never continue on a page without their label.
  assert.ok(rules(print).some(([selectors, body]) => selectors.includes('.home-tracking-table tbody') && selectors.includes('.home-tracking-table tr') && /break-inside:\s*avoid/.test(body)));
  assert.ok(rules(print).some(([selectors, body]) => selectors.includes('.home-group') && /break-after:\s*avoid/.test(body)));
  assert.ok(rules(print).some(([selectors, body]) => selectors.includes('.home-tracking-head') && /break-inside:\s*avoid/.test(body) && /break-after:\s*avoid/.test(body)));
  assert.match(print, /#homePrintHead\s*\{[^}]*display:\s*block/);
  assert.match(print, /\.home-def\s*\{[^}]*display:\s*block\s*!important/);
  // The route turns down the left edge only on a narrow screen: printed, it runs across at any paper width.
  const narrow = [...css.matchAll(/@media([^{]+)\{/g)].filter((m) => !/print/.test(m[1]) && /\.home-stop\b|\.home-stops\b|\.home-stop-/.test(block(css, m.index)));
  assert.ok(narrow.length >= 2, 'the spine has its rules');
  for (const m of narrow) assert.match(m[1].trim(), /^screen and \(max-width: \d+px\)$/, m[1]);
  assert.match(print, /\.home-stops\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--stops/);
});
