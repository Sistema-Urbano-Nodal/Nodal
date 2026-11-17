import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/* /opportunities.html as the browser runs it: every element of the page exists before catalog.js starts, so the
   listeners exercised here are the ones the script attaches itself. Timers run only when a test says so. */
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pageHtml = read('web/pages/opportunities.html');
const BASE = 'https://nodal.test';
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

class FakeNode {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.shown = true;
    this.hiddenLog = [];
    this.textContent = '';
    this.value = '';
    this.dataset = {};
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.scrolls = 0;
    this.classList = { add() {}, toggle() {} };
  }

  get hidden() { return !this.shown; }
  set hidden(value) { this.shown = !value; this.hiddenLog.push(Boolean(value)); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); }
  querySelectorAll() { return []; }
  scrollIntoView() { this.scrolls += 1; }
  focus() { this.focused = true; }
  // Runs this node's listeners for one event, as the browser would, and waits for what they started.
  dispatch(type, event = {}) {
    return Promise.all((this.listeners[type] || []).map((handler) => handler({
      type, target: this, currentTarget: this, isComposing: false, preventDefault() {}, ...event,
    })));
  }
}

const descendants = (node) => (node?.children || []).flatMap((child) => [child, ...descendants(child)]);

function catalogItem(id, overrides = {}) {
  return {
    id, kind: 'opportunity', title: `Title ${id}`, summary: 'Summary', body: 'Body',
    actionMode: 'interest', interestStatus: null, isClosed: false, ...overrides,
  };
}

// The first page has two listings and a next page; a listing reads as `<lang>: Title <id>` in its detail.
function catalogPage({ search = '', lang = 'en', intl = Intl, list, detail } = {}) {
  const ids = new Map();
  for (const [, tag, before, id, after] of pageHtml.matchAll(/<(\w+)\b([^>]*?)\bid="([^"]+)"([^>]*)>/g)) {
    const node = new FakeNode(tag, id);
    const attributes = `${before} ${after}`;
    node.shown = !/\shidden(?=[\s/>=]|$)/.test(attributes);
    if (tag === 'input') node.type = attributes.match(/\stype="([^"]+)"/)?.[1] || 'text';
    if (tag === 'select') { node.type = 'select-one'; node.value = 'open'; }
    ids.set(id, node);
  }
  const kinds = [...pageHtml.matchAll(/<input type="checkbox" name="kind" value="([^"]+)"/g)].map(([, value]) => {
    const kind = new FakeNode('input');
    Object.assign(kind, { type: 'checkbox', name: 'kind', value, checked: false });
    return kind;
  });
  const form = ids.get('catalogForm');
  form.querySelectorAll = (selector) => (selector.startsWith('input[name="kind"]')
    ? kinds.filter((kind) => !selector.endsWith(':checked') || kind.checked) : []);

  const i18n = { lang, t: (key) => key, onChange(handler) { this.change = handler; } };
  const routeList = list || ((params) => (params.get('cursor') === 'page-2'
    ? { items: [catalogItem('c')], nextCursor: null }
    : { items: [catalogItem('a'), catalogItem('b')], nextCursor: 'page-2' }));
  const routeDetail = detail || ((id, language) => catalogItem(id, { title: `${language}: Title ${id}` }));
  const requests = [];
  const route = (url) => {
    const parsed = new URL(url, BASE);
    if (parsed.pathname === '/api/auth/state') return { authenticated: true };
    if (parsed.pathname === '/api/catalog') return routeList(parsed.searchParams);
    if (parsed.pathname === '/api/me/catalog-interests') return { interests: [], nextCursor: null };
    const one = parsed.pathname.match(/^\/api\/catalog\/([^/]+)$/);
    if (one) return { item: routeDetail(decodeURIComponent(one[1]), parsed.searchParams.get('lang')) };
    throw new Error(`unexpected request ${url}`);
  };

  const timers = new Map();
  let nextTimer = 1;
  const context = {
    AbortController, Date, Intl: intl, URL, URLSearchParams, console, encodeURIComponent,
    setTimeout: (handler) => { const id = nextTimer; nextTimer += 1; timers.set(id, handler); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    fetch: async (url, options = {}) => {
      requests.push({ url, method: options.method || 'GET' });
      const payload = route(url);
      return { ok: true, status: 200, json: async () => payload };
    },
    history: { replaceState() {} },
    matchMedia: () => ({ matches: true }),
    document: { activeElement: null, getElementById: (id) => ids.get(id) ?? null, createElement: (tag) => new FakeNode(tag) },
    location: { pathname: '/opportunities.html', search, hash: '', assign() {} },
    nodalI18n: i18n,
  };
  context.window = context;
  vm.runInNewContext(read('web/scripts/catalog.js'), context, { filename: 'catalog.js' });
  return {
    ids, form, kinds, i18n,
    // The search's own reads: the result list, page by page.
    listReads: () => requests.filter(({ url }) => url.startsWith('/api/catalog?')).map(({ url }) => new URL(url, BASE).searchParams),
    titleButton: (title) => descendants(ids.get('catalogResults')).find((node) => node.className === 'dispatch-title-button' && node.textContent === title),
    runTimers() { const due = [...timers.values()]; timers.clear(); due.forEach((handler) => handler()); },
  };
}

test('leaving a typed search to open a result or load more does not run the search again', async () => {
  const h = catalogPage();
  await flush();
  assert.equal(h.listReads().length, 1);
  const query = h.ids.get('catalogQuery');

  query.value = 'lima';
  await h.form.dispatch('input', { target: query });
  h.runTimers();
  await flush();
  assert.equal(h.listReads().length, 2);
  assert.equal(h.listReads()[1].get('q'), 'lima');

  // A click on a result first takes focus from the field, and the field fires 'change' as it loses it.
  await h.form.dispatch('change', { target: query });
  await h.titleButton('Title a').dispatch('click');
  await flush();
  h.runTimers();
  await flush();
  assert.equal(h.ids.get('catalogDetail').hidden, false, 'the listing just opened stays open');
  assert.equal(h.ids.get('detailTitle').textContent, 'en: Title a');
  assert.notEqual(h.ids.get('catalogDetailStatus').textContent, 'catalog.selectDetail');
  assert.equal(h.listReads().length, 2, 'the same search is not read again');

  // Typing more and then pressing Load more brings the next page instead of being refused while a search waits.
  query.value = 'lima centro';
  await h.form.dispatch('input', { target: query });
  h.runTimers();
  await flush();
  assert.equal(h.listReads().length, 3);
  await h.form.dispatch('change', { target: query });
  await h.ids.get('catalogMore').dispatch('click');
  await flush();
  h.runTimers();
  await flush();
  assert.equal(h.listReads().length, 4);
  assert.equal(h.listReads()[3].get('cursor'), 'page-2');
  assert.equal(h.listReads()[3].get('q'), 'lima centro');
  assert.equal(h.ids.get('catalogResults').children.length, 3);

  // The kind boxes and the state select still search when they change.
  const project = h.kinds.find((kind) => kind.value === 'project');
  project.checked = true;
  await h.form.dispatch('change', { target: project });
  h.runTimers();
  await flush();
  assert.equal(h.listReads().at(-1).get('kind'), 'project');
  h.ids.get('catalogState').value = 'all';
  await h.form.dispatch('change', { target: h.ids.get('catalogState') });
  h.runTimers();
  await flush();
  assert.equal(h.listReads().at(-1).get('state'), 'all');
  assert.equal(h.listReads().length, 6);
});

test('a language switch reads the open listing again where it is and keeps the message being written', async () => {
  const h = catalogPage({ search: '?id=a' });
  await flush();
  const detail = h.ids.get('catalogDetail');
  const message = h.ids.get('catalogInterestMessage');
  assert.equal(detail.hidden, false);
  assert.equal(h.ids.get('detailTitle').textContent, 'en: Title a');
  assert.equal(detail.scrolls, 1);
  message.value = 'I can map the bus stops near my school.';
  detail.hiddenLog.length = 0;

  h.i18n.lang = 'es';
  await h.i18n.change('es');
  await flush();
  assert.equal(h.ids.get('detailTitle').textContent, 'es: Title a');
  assert.equal(message.value, 'I can map the bus stops near my school.');
  assert.equal(detail.hiddenLog.includes(true), false, 'the pane stays on screen while it is read again');
  assert.equal(detail.scrolls, 1, 'the page does not jump back to the pane');
  assert.equal(h.ids.get('catalogInterestForm').hidden, false);

  // Opening another listing still starts with an empty message, brought into view.
  await h.titleButton('Title b').dispatch('click');
  await flush();
  assert.equal(h.ids.get('detailTitle').textContent, 'es: Title b');
  assert.equal(message.value, '');
  assert.equal(detail.scrolls, 2);
});

test('a deadline set on the desk reads as its Lima day for every visitor, and the detail gives its Lima time', async () => {
  // A visitor in São Paulo (UTC−3): a date formatted without a zone falls on their own calendar day.
  const saoPaulo = {
    DateTimeFormat: function DateTimeFormat(lang, options = {}) {
      return new Intl.DateTimeFormat(lang, { timeZone: 'America/Sao_Paulo', ...options });
    },
  };
  const deadlineAt = '2026-12-01T04:59:00.000Z'; // 30 Nov at 23:59 in Lima, as the desk saves a datetime-local
  const startsAt = '2026-11-02T14:00:00.000Z'; // 2 Nov at 09:00 in Lima
  const h = catalogPage({
    lang: 'es',
    intl: saoPaulo,
    list: () => ({ items: [catalogItem('a', { deadlineAt })], nextCursor: null }),
    detail: (id) => catalogItem(id, { deadlineAt, startsAt, endDate: '2026-12-15T23:59:59.999Z', sourceVerifiedAt: '2026-11-01T00:00:00.000Z' }),
  });
  await flush();
  const rail = descendants(h.ids.get('catalogResults')).find((node) => node.className === 'dispatch-deadline');
  assert.equal(rail.textContent, '30 nov 2026');

  await h.titleButton('Title a').dispatch('click');
  await flush();
  const meta = Object.fromEntries(h.ids.get('catalogDetailMeta').children
    .filter((node) => node.className === 'dispatch-meta-item')
    .map((row) => [row.children[0].textContent, row.children[1].textContent]));
  assert.match(meta['catalog.deadline'], /^30 nov 2026, 23:59 GMT[-−]5$/);
  assert.match(meta['catalog.startsAt'], /^2 nov 2026, 9:00 GMT[-−]5$/);
  // Calendar days read the same everywhere and stay days.
  assert.equal(meta['catalog.endDate'], '15 dic 2026');
  assert.equal(meta['catalog.sourceVerified'], '1 nov 2026');
});

test('My interests opens in view, below the results, with focus on its heading', async () => {
  assert.match(pageHtml, /<h2 id="myInterestsTitle" tabindex="-1"/);
  assert.match(read('web/styles/catalog.css'), /#myInterestsTitle:focus/);
  const h = catalogPage();
  await flush();
  const section = h.ids.get('catalogMyInterests');
  const toggle = h.ids.get('catalogMyInterestsToggle');
  assert.equal(toggle.hidden, false);

  await toggle.dispatch('click');
  await flush();
  assert.equal(section.hidden, false);
  assert.equal(section.scrolls, 1);
  assert.equal(h.ids.get('myInterestsTitle').focused, true);

  // Reading the list again in another language leaves the page where it is.
  h.i18n.lang = 'pt';
  await h.i18n.change('pt');
  await flush();
  assert.equal(section.scrolls, 1);
});
