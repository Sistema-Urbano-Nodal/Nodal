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
