import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const index = () => read('web', 'pages', 'index.html');
const catalogPage = () => read('web', 'pages', 'opportunities.html');
const catalogScript = () => read('web', 'scripts', 'catalog.js');
const catalogStyles = () => read('web', 'styles', 'catalog.css');
const appScript = () => read('web', 'scripts', 'app.js');
const adminPage = () => read('web', 'pages', 'admin.html');
const adminScript = () => read('web', 'scripts', 'admin.js');
const adminStyles = () => read('web', 'styles', 'admin.css');
const i18n = () => read('web', 'scripts', 'i18n.js');

class FakeNode {
  constructor(id = '') {
    this.id = id;
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.dataset = {};
    this.children = [];
    this.style = {};
    this.listeners = new Map();
    this.classList = { add() {}, toggle() {} };
  }

  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this[name] = value; }
  getAttribute(name) { return this[name] ?? null; }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  scrollIntoView() {}
  focus() { this.focused = true; }
  getBoundingClientRect() { return {}; }
}

function descendants(node) {
  const result = [];
  for (const child of node?.children || []) {
    if (child && typeof child === 'object') {
      result.push(child, ...descendants(child));
    }
  }
  return result;
}

function renderedText(node) {
  return [node?.textContent || '', ...(node?.children || []).map(renderedText)].join(' ');
}

const response = (payload, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  async json() { return payload; },
});

function deferredResponse(signal, { honorAbort = true } = {}) {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  if (honorAbort) {
    signal?.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  }
  return { promise, resolve, reject };
}

function catalogHarness(fetchImpl, { intl = Intl, assumeAuthenticated = true } = {}) {
  const ids = new Map();
  for (const id of [
    'catalogDetail', 'catalogDetailStatus', 'catalogDetailKind', 'detailTitle',
    'catalogDetailSummary', 'catalogDetailBody', 'catalogDetailMeta',
    'catalogDetailActions', 'catalogInterestForm', 'catalogInterestDisclosure', 'catalogInterestSignIn',
    'catalogInterestCompose', 'catalogWithdrawInterest', 'catalogInterestSubmit', 'catalogInterestMessage', 'catalogInterestStatus',
    'catalogMyInterests', 'catalogMyInterestsStatus', 'catalogMyInterestsList',
  ]) ids.set(id, new FakeNode(id));
  ids.get('catalogDetail').hidden = true;
  ids.get('catalogInterestSignIn').hidden = true;
  ids.get('catalogInterestForm').dataset.itemId = 'item-1';

  const i18nState = {
    lang: 'en',
    t: (key) => key,
    onChange(handler) { this.change = handler; },
  };
  const document = {
    getElementById: (id) => ids.get(id) ?? null,
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (text) => ({ textContent: text }),
  };
  const context = {
    AbortController,
    Date,
    Intl: intl,
    URL,
    URLSearchParams,
    clearTimeout,
    console,
    document,
    encodeURIComponent,
    fetch: fetchImpl,
    history: { replaceState() {} },
    matchMedia: () => ({ matches: true }),
    setTimeout,
  };
  context.window = context;
  context.window.document = document;
  const location = {
    pathname: '/opportunities.html', search: '', hash: '', assigned: '',
    assign(value) { this.assigned = value; },
  };
  context.window.location = location;
  context.window.nodalI18n = i18nState;

  const instrumented = catalogScript().replace(
    /\n\}\)\(\);\s*$/,
    `\nwindow.__catalogTest = { dateText, renderDispatch, renderDetail, selectDetail, closeDetail, runFilters, debounceFilters, refetchForLanguage, loadAuthState, loadResults, loadLanding, submitInterest, withdrawInterest, loadMyInterests, page, setAuthenticated(value) { authenticated = value; } };\n})();`,
  );
  vm.runInNewContext(instrumented, context, { filename: 'catalog.js' });
  if (assumeAuthenticated) context.window.__catalogTest.setAuthenticated(true);
  return { api: context.window.__catalogTest, ids, i18nState, location };
}

function mountCatalogList(harness) {
  for (const id of ['catalogForm', 'catalogResults', 'catalogStatus', 'catalogMore', 'catalogRetry', 'resultsTitle', 'catalogQuery', 'catalogTopic', 'catalogLocation', 'catalogState']) {
    harness.ids.set(id, new FakeNode(id));
  }
  harness.ids.get('catalogState').value = 'open';
  harness.ids.get('catalogRetry').hidden = true;
  Object.assign(harness.api.page, {
    form: harness.ids.get('catalogForm'),
    results: harness.ids.get('catalogResults'),
    status: harness.ids.get('catalogStatus'),
    more: harness.ids.get('catalogMore'),
  });
}

function mountLandingCatalog(harness) {
  for (const id of ['landingOpenWork', 'landingOpenWorkStatus', 'landingCases', 'landingCasesStatus']) {
    harness.ids.set(id, new FakeNode(id));
  }
}

// The real dictionaries (non-home pages), optionally applying markup nodes on a language switch.
function deskI18n(lang = 'en', nodes = []) {
  const pick = (attribute) => nodes.filter((node) => node.dataset[attribute]);
  const document = {
    body: { dataset: {} },
    documentElement: new FakeNode('html'),
    querySelectorAll: (selector) => ({
      '[data-i18n]': pick('i18n'), '[data-i18n-placeholder]': pick('i18nPlaceholder'), '[data-i18n-aria-label]': pick('i18nAriaLabel'),
    })[selector] || [],
  };
  const context = { URLSearchParams, document, console, localStorage: { getItem() { return null; }, setItem() {} }, location: { search: '' } };
  context.window = context;
  vm.runInNewContext(i18n(), context, { filename: 'i18n.js' });
  context.window.nodalI18n.apply(lang);
  return context.window.nodalI18n;
}

function adminHarness(fetchImpl = () => Promise.reject(new Error('network must not run in the editor unit test')), { lang = 'en', confirm = () => true } = {}) {
  const ids = new Map([...adminPage().matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], new FakeNode(match[1])]));
  const document = {
    getElementById: (id) => ids.get(id) ?? null,
    createElement: (tag) => new FakeNode(tag),
  };
  const confirms = [];
  const i18nApi = deskI18n(lang);
  const context = {
    AbortController,
    Date,
    URL,
    URLSearchParams,
    clearTimeout,
    crypto: globalThis.crypto,
    document,
    encodeURIComponent,
    fetch: fetchImpl,
    location: { assigned: '', assign(value) { this.assigned = value; } },
    matchMedia: () => ({ matches: true }),
    nodalI18n: i18nApi,
    confirm: (message) => { confirms.push(message); return confirm(message); },
    setTimeout,
  };
  context.window = context;
  const source = adminScript();
  const instrumented = source.replace(
    /\n  bootstrap\(\);\s*\n\}\)\(\);\s*$/,
    `\n  window.__adminTest = { localDate, serializeEditor, validateEditorTopics, renderPreview, saveCatalog, loadCatalog, loadInterests, renderInterest, showCatalogConflict, state, conflict: () => state.conflictCurrent, renderGate, publicationGaps, fillEditor, loadNews, saveNews, deleteNews, fillNews, news, bootstrap };\n})();`,
  );
  assert.notEqual(instrumented, source, 'admin test hook must replace bootstrap without changing production source');
  vm.runInNewContext(instrumented, context, { filename: 'admin.js' });
  return { api: context.window.__adminTest, ids, location: context.location, i18n: i18nApi, confirms };
}

function dashboardSearchHarness(apiImpl) {
  let nextTimerId = 1;
  const timers = new Map();
  const setTimer = (callback) => {
    const id = nextTimerId;
    nextTimerId += 1;
    timers.set(id, callback);
    return id;
  };
  const clearTimer = (id) => timers.delete(id);
  const runNextTimer = () => {
    const entry = timers.entries().next().value;
    assert.ok(entry, 'expected a pending dashboard search timer');
    const [id, callback] = entry;
    timers.delete(id);
    return callback();
  };

  class SearchChip extends FakeNode {
    constructor(scope, active = false) {
      super(scope);
      this.dataset.scope = scope;
      this.textContent = scope;
      this.classes = new Set(active ? ['chip', 'is-on'] : ['chip']);
      this.classList = {
        contains: (name) => this.classes.has(name),
        toggle: (name, force) => {
          const enabled = force === undefined ? !this.classes.has(name) : Boolean(force);
          if (enabled) this.classes.add(name); else this.classes.delete(name);
          return enabled;
        },
      };
    }
  }

  const searchInput = new FakeNode('searchInput');
  const searchPop = new FakeNode('searchPop');
  searchPop.hidden = true;
  const chips = [
    new SearchChip('People', true),
    new SearchChip('Projects'),
    new SearchChip('Knowledge'),
    new SearchChip('Opportunities'),
  ];
  const chipHost = new FakeNode('searchChips');
  chipHost.querySelectorAll = (selector) => (selector === '.chip' ? chips : []);
  chipHost.querySelector = (selector) => (selector === '.chip.is-on'
    ? chips.find((chip) => chip.classList.contains('is-on')) || null
    : null);

  const byId = (id) => ({ searchInput, searchPop, searchChips: chipHost }[id] || null);
  const el = (tag, cls, text) => {
    const node = new FakeNode(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const source = read('web', 'scripts', 'dashboard.js');
  const start = source.indexOf('  const CATALOG_SCOPE_KINDS');
  const end = source.indexOf('  /* ================= notifications', start);
  assert.ok(start >= 0 && end > start, 'dashboard search block must remain discoverable');
  const block = source.slice(start, end);
  const context = {
    AbortController,
    URLSearchParams,
    api: apiImpl,
    byId,
    clearTimeout: clearTimer,
    el,
    encodeURIComponent,
    I18N: { lang: 'en' },
    setTimeout: setTimer,
    t: (key) => key,
  };
  context.globalThis = context;
  vm.runInNewContext(`${block}\n;globalThis.__dashboardSearchTest = { runSearch };`, context, { filename: 'dashboard-search.js' });

  return {
    api: context.__dashboardSearchTest,
    input: searchInput,
    pop: searchPop,
    pendingTimers: () => timers.size,
    runNextTimer,
    activate(scope) {
      const chip = chips.find((candidate) => candidate.dataset.scope === scope);
      assert.ok(chip, `unknown dashboard scope ${scope}`);
      return chip.listeners.get('click')();
    },
  };
}

function i18nHarness({ titleKey, titleText, descriptionKey, descriptionText }) {
  const title = new FakeNode('title');
  title.dataset.i18n = titleKey;
  title.textContent = titleText;
  const description = new FakeNode('description');
  description.dataset.i18nContent = descriptionKey;
  description.setAttribute('content', descriptionText);
  const graph = new FakeNode('graph');
  graph.dataset.i18nAriaLabel = 'graph.title';
  graph.setAttribute('aria-label', 'Illustrative role graph');
  const node = new FakeNode('node');
  node.dataset.i18nAriaLabel = 'graph.n.citygov.t';
  node.setAttribute('aria-label', 'City government');
  const close = new FakeNode('close');
  close.dataset.i18nAriaLabel = 'graph.close';
  close.setAttribute('aria-label', 'Close');
  const interestSignIn = new FakeNode('interest-sign-in');
  interestSignIn.dataset.i18n = 'catalog.signInToExpressInterest';
  interestSignIn.textContent = 'Sign in to express interest';
  const documentElement = new FakeNode('html');
  const document = {
    documentElement,
    querySelectorAll(selector) {
      return {
        '[data-i18n]': [title, interestSignIn],
        '[data-i18n-placeholder]': [],
        '[data-i18n-content]': [description],
        '[data-i18n-aria-label]': [graph, node, close],
        '.lang-btn': [],
      }[selector] || [];
    },
  };
  const context = {
    URLSearchParams,
    document,
    localStorage: { getItem() { return null; }, setItem() {} },
    location: { search: '' },
  };
  context.window = context;
  vm.runInNewContext(i18n(), context, { filename: 'i18n.js' });
  return { api: context.window.nodalI18n, title, description, graph, node, close, interestSignIn, documentElement };
}

function catalogItem(id = 'item-1', overrides = {}) {
  return {
    id,
    kind: 'opportunity',
    title: `Title ${id}`,
    summary: 'Summary',
    body: 'Body',
    actionMode: 'interest',
    interestStatus: null,
    isClosed: false,
    ...overrides,
  };
}

function dictionaryKeys(source, name) {
  const match = source.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?^  \\});`, 'm'));
  assert.ok(match, `${name} dictionary is missing`);
  // Read the object itself: keys may share a line and values may contain braces.
  return new Set(Object.keys(vm.runInNewContext(`(${match[1]})`)));
}

const optionalLandingTargets = new Set([
  'landingOpenWork', 'landingOpenWorkStatus', 'landingCases', 'landingCasesStatus', 'heroPrimary', 'heroSecondary',
]);

test('homepage preserves the original network story and section order', () => {
  const html = index();
  assert.match(html, /<body data-page="home">/);
  assert.match(html, /data-i18n="hero\.building">A living network</);
  assert.match(html, /data-i18n="hero\.infra">for Latin America’s|data-i18n="hero\.infra">for Latin America's/);
  const order = [...html.matchAll(/<section\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ['home', 'fiiu', 'about', 'problem', 'insight', 'platform', 'profile', 'membership', 'knowledge', 'resources', 'partners']);
  assert.doesNotMatch(html, /(?:src|href)="(?:catalog|courses|pilot(?:-i18n)?)\.(?:js|css)/);
});

test('catalog head and shared graph accessibility labels follow EN, ES, and PT', () => {
  for (const [html, page, english] of [
    [catalogPage(), 'catalog', {
      title: 'NODAL · Open work',
      description: 'Browse verified urban opportunities, projects, learning circles, resources and case studies in NODAL.',
    }],
  ]) {
    assert.match(html, new RegExp(`<title data-i18n="page\\.${page}\\.title">`));
    assert.match(html, new RegExp(`<meta[^>]+data-i18n-content="page\\.${page}\\.description"`));
    const harness = i18nHarness({
      titleKey: `page.${page}.title`, titleText: english.title,
      descriptionKey: `page.${page}.description`, descriptionText: english.description,
    });
    harness.api.apply('es');
    assert.notEqual(harness.title.textContent, english.title);
    assert.notEqual(harness.description.getAttribute('content'), english.description);
    assert.equal(harness.interestSignIn.textContent, 'Inicia sesión para expresar interés');
    assert.equal(harness.documentElement.lang, 'es');
    harness.api.apply('pt');
    assert.notEqual(harness.title.textContent, english.title);
    assert.notEqual(harness.description.getAttribute('content'), english.description);
    assert.equal(harness.interestSignIn.textContent, 'Entre para expressar interesse');
    assert.equal(harness.documentElement.lang, 'pt');
  }

  const landing = index();
  assert.match(landing, /<title>NODAL · Nodos Urbanos de América Latina<\/title>/);
  assert.match(landing, /id="graph"[^>]+aria-label="Interactive network of actors"/);
  const source = appScript();
  assert.match(source, /g\.setAttribute\('data-i18n-aria-label',\s*`graph\.n\.\$\{n\.id\}\.t`\)/);
  assert.match(source, /close\.setAttribute\('aria-label',\s*t\('graph\.close'\)\)/);
  assert.doesNotMatch(source, /close\.setAttribute\('aria-label',\s*'Close'\)/);

  const graphHarness = i18nHarness({
    titleKey: 'page.landing.title', titleText: 'NODAL · Urban knowledge into action',
    descriptionKey: 'page.landing.description', descriptionText: 'Landing description',
  });
  graphHarness.api.apply('es');
  assert.equal(graphHarness.graph.getAttribute('aria-label'), 'Roles ilustrativos en una colaboración urbana');
  assert.equal(graphHarness.node.getAttribute('aria-label'), 'Gobierno municipal');
  assert.equal(graphHarness.close.getAttribute('aria-label'), 'Cerrar');
  graphHarness.api.apply('pt');
  assert.equal(graphHarness.graph.getAttribute('aria-label'), 'Papéis ilustrativos em uma colaboração urbana');
  assert.equal(graphHarness.node.getAttribute('aria-label'), 'Governo municipal');
  assert.equal(graphHarness.close.getAttribute('aria-label'), 'Fechar');
});

test('legacy landing catalog widgets are optional and absent widgets issue no catalog reads', async () => {
  for (const id of optionalLandingTargets) assert.doesNotMatch(index(), new RegExp(`id="${id}"`));
  assert.match(catalogPage(), /<script[^>]+src="catalog\.js/);
  const requests = [];
  const harness = catalogHarness((url) => {
    requests.push(url);
    assert.equal(url, '/api/auth/state');
    return Promise.resolve(response({ authenticated: true }));
  });
  // Script startup checks authentication even when no landing widgets are mounted.
  assert.deepEqual(requests, ['/api/auth/state']);
  await harness.api.loadLanding();
  assert.deepEqual(requests, ['/api/auth/state']);
  assert.equal(await harness.api.loadAuthState(), true);
  assert.deepEqual(requests, ['/api/auth/state', '/api/auth/state']);
  const source = catalogScript();
  assert.match(source, /if \(!open && !cases\) return/);
  assert.match(source, /if \(!container \|\| !status\) return/);
  assert.match(source, /if \(primary && secondary && authenticated\)/);
});

test('landing restores the live recommendation deck as an honest translated state', () => {
  const html = index();
  assert.match(html, /id="matchStack"/);
  assert.match(html, /class="match-card/);
  assert.match(html, /data-i18n="match\.role"/);
  assert.match(html, /<script[^>]+src="recs\.js/);
  const deck = html.match(/<div[^>]+id="matchStack"[\s\S]*?<\/article>\s*<\/div>/)?.[0] || '';
  assert.match(deck, /class="match-name"[^>]*>Sign in to connect</);
  assert.doesNotMatch(deck, /data-user|member-id|@[\w.-]+|Urban (?:planner|leader)|member since/i, 'static sign-in UI must not pose as a member record');
});

test('landing dispatches always link safely to details and detail metadata uses source-backed localized actions', () => {
  const harness = catalogHarness((url) => {
    if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
    throw new Error(`unexpected request ${url}`);
  });
  const internal = catalogItem('internal-item', {
    subtype: 'grant', cta: 'Join this call', sourceLabel: 'Official call page', sourceUrl: 'https://example.test/source',
    startsAt: '2030-05-21T00:00:00.000Z', deadlineAt: '2030-05-20T00:00:00.000Z', endDate: '2030-05-30T23:59:59.999Z',
  });
  const landingRow = harness.api.renderDispatch(internal);
  assert.ok(descendants(landingRow).some((node) => node.href === 'opportunities.html?id=internal-item'));
  const externalRow = harness.api.renderDispatch({ ...internal, id: 'external-item', actionMode: 'external', actionUrl: 'https://example.test/apply' });
  const externalLinks = descendants(externalRow).filter((node) => node.href);
  assert.ok(externalLinks.some((node) => node.href === 'opportunities.html?id=external-item'));
  assert.ok(externalLinks.some((node) => node.href === 'https://example.test/apply'));

  harness.api.renderDetail(internal);
  const meta = renderedText(harness.ids.get('catalogDetailMeta'));
  for (const key of ['catalog.subtype.grant', 'catalog.startsAt', 'catalog.deadline', 'catalog.endDate']) assert.match(meta, new RegExp(key.replaceAll('.', '\\.')));
  const source = descendants(harness.ids.get('catalogDetailActions')).find((node) => node.href === 'https://example.test/source');
  assert.equal(source?.textContent, 'Official call page');
  assert.equal(harness.ids.get('catalogInterestSubmit').textContent, 'Join this call');
});

test('anonymous internal-interest detail requires sign-in before composing and preserves a safe item permalink', async () => {
  const harness = catalogHarness((url) => {
    if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: false }));
    throw new Error(`unexpected request ${url}`);
  }, { assumeAuthenticated: false });
  await harness.api.loadAuthState();
  harness.location.search = '?kind=opportunity&q=housing&topic=climate';
  harness.location.hash = '#detail';
  harness.api.renderDetail(catalogItem('internal-anon', { cta: 'Join this call' }));

  assert.equal(harness.ids.get('catalogInterestDisclosure').hidden, false);
  assert.equal(harness.ids.get('catalogInterestForm').hidden, true);
  assert.equal(harness.ids.get('catalogInterestCompose').hidden, true);
  assert.equal(harness.ids.get('catalogInterestSignIn').hidden, false);
  assert.equal(harness.ids.get('catalogInterestSignIn').textContent, 'catalog.signInToExpressInterest');
  const expectedNext = '/opportunities.html?kind=opportunity&q=housing&topic=climate&id=internal-anon#detail';
  assert.equal(harness.ids.get('catalogInterestSignIn').href, `/login.html?next=${encodeURIComponent(expectedNext)}`);

  harness.location.pathname = '//outside.example';
  harness.location.search = '?next=https://outside.example';
  harness.location.hash = '';
  harness.api.renderDetail(catalogItem('safe-fallback'));
  assert.equal(harness.ids.get('catalogInterestSignIn').href,
    `/login.html?next=${encodeURIComponent('/opportunities.html?id=safe-fallback')}`);
});

test('authenticated internal-interest detail exposes the item composer and hides sign-in', async () => {
  const harness = catalogHarness((url) => {
    if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
    throw new Error(`unexpected request ${url}`);
  }, { assumeAuthenticated: false });
  await harness.api.loadAuthState();
  harness.api.renderDetail(catalogItem('internal-member', { cta: 'Join this call' }));

  assert.equal(harness.ids.get('catalogInterestForm').hidden, false);
  assert.equal(harness.ids.get('catalogInterestCompose').hidden, false);
  assert.equal(harness.ids.get('catalogInterestSubmit').textContent, 'Join this call');
  assert.equal(harness.ids.get('catalogInterestSignIn').hidden, true);
});

test('detail rendered during auth lookup stays non-composable and updates when authentication resolves', async () => {
  let authReads = 0;
  let currentAuth;
  const harness = catalogHarness((url, options = {}) => {
    if (url === '/api/auth/state') {
      authReads += 1;
      if (authReads === 1) return new Promise(() => {});
      currentAuth = deferredResponse(options.signal, { honorAbort: false });
      return currentAuth.promise;
    }
    throw new Error(`unexpected request ${url}`);
  }, { assumeAuthenticated: false });

  const authLoad = harness.api.loadAuthState();
  harness.api.renderDetail(catalogItem('late-auth', { cta: 'Contribute now' }));
  assert.equal(harness.ids.get('catalogInterestForm').hidden, true);
  assert.equal(harness.ids.get('catalogInterestCompose').hidden, true);
  assert.equal(harness.ids.get('catalogInterestSignIn').hidden, true, 'pending auth must not guess that the visitor is anonymous');
  assert.equal(harness.ids.get('catalogInterestMessage').value, '');

  currentAuth.resolve(response({ authenticated: true }));
  await authLoad;
  assert.equal(harness.ids.get('catalogInterestForm').hidden, false);
  assert.equal(harness.ids.get('catalogInterestCompose').hidden, false);
  assert.equal(harness.ids.get('catalogInterestSubmit').textContent, 'Contribute now');
  assert.equal(harness.ids.get('catalogInterestSignIn').hidden, true);
});

test('programmatic anonymous interest submission redirects without issuing a PUT', async () => {
  const calls = [];
  const harness = catalogHarness((url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: false }));
    throw new Error(`unexpected request ${options.method || 'GET'} ${url}`);
  }, { assumeAuthenticated: false });
  await harness.api.loadAuthState();
  harness.location.search = '?kind=opportunity';
  harness.api.renderDetail(catalogItem('programmatic-anon'));
  harness.ids.get('catalogInterestMessage').value = 'A message that must not be submitted before sign-in.';

  await harness.api.submitInterest({ preventDefault() {}, currentTarget: harness.ids.get('catalogInterestForm') });

  assert.equal(calls.some((call) => call.method === 'PUT'), false);
  assert.equal(harness.location.assigned,
    `/login.html?next=${encodeURIComponent('/opportunities.html?kind=opportunity&id=programmatic-anon')}`);
});

test('catalog details keep historical withdrawal visible without offering an ineligible internal submission', () => {
  const harness = catalogHarness((url) => {
    if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
    throw new Error(`unexpected request ${url}`);
  });
  for (const item of [
    catalogItem('changed-none', { actionMode: 'none', interestStatus: 'new', cta: 'Old internal action' }),
    catalogItem('changed-external', { actionMode: 'external', actionUrl: 'https://example.test/apply', interestStatus: 'contacted', cta: 'Apply externally' }),
    catalogItem('changed-closed', { actionMode: 'interest', interestStatus: 'new', isClosed: true, cta: 'Old internal action' }),
  ]) {
    harness.api.renderDetail(item);
    assert.equal(harness.ids.get('catalogInterestForm').hidden, false, item.id);
    assert.equal(harness.ids.get('catalogInterestCompose').hidden, true, item.id);
    assert.equal(harness.ids.get('catalogInterestSubmit').disabled, true, item.id);
    assert.equal(harness.ids.get('catalogWithdrawInterest').hidden, false, item.id);
    assert.equal(harness.ids.get('catalogInterestStatus').textContent, `catalog.status.${item.interestStatus}`, item.id);
  }
});

test('catalog civil dates do not shift to the previous day in São Paulo', () => {
  const formatOptions = [];
  class SaoPauloDateTimeFormat {
    constructor(_lang, options) { this.options = options; formatOptions.push(options); }
    format(value) {
      const date = this.options.timeZone === 'UTC' ? value : new Date(value.getTime() - (3 * 60 * 60 * 1000));
      return date.toISOString().slice(0, 10);
    }
  }
  const harness = catalogHarness((url) => {
    if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
    throw new Error(`unexpected request ${url}`);
  }, { intl: { DateTimeFormat: SaoPauloDateTimeFormat } });
  assert.equal(harness.api.dateText('2030-05-01T00:00:00.000Z', { civil: true }), '2030-05-01');
  assert.equal(harness.api.dateText('2030-05-01'), '2030-05-01');
  assert.equal(harness.api.dateText('2030-05-01T00:00:00.000Z'), '2030-05-01');
  assert.equal(harness.api.dateText('2030-05-31T23:59:59.999Z'), '2030-05-31');
  assert.equal(formatOptions.at(-1).timeZone, 'UTC');

  const admin = adminHarness();
  assert.equal(admin.api.localDate('2030-05-01T00:00:00.000Z'), '2030-05-01');
  assert.equal(admin.api.localDate('2030-05-31T23:59:59.999Z'), '2030-05-31');
});

test('detail clears the mobile header and renders metadata as readable rows at every size', () => {
  const css = catalogStyles();
  const mobileStart = css.indexOf('@media (max-width: 720px)');
  const mobileEnd = css.indexOf('@media (prefers-reduced-motion: reduce)', mobileStart);
  const mobile = css.slice(mobileStart, mobileEnd);
  assert.notEqual(mobileStart, -1);
  assert.match(mobile, /#catalogDetail\s*\{[^}]*scroll-margin-top:\s*(?:calc\([^}]+\)|[\d.]+rem)/s,
    'detail scrollIntoView needs a sticky-header offset at 390px');
  assert.match(css, /\.catalog-detail-meta\s*\{[^}]*display:\s*grid[^}]*gap:/s);
  assert.match(css, /\.catalog-detail-meta \.dispatch-meta-item\s*\{[^}]*display:\s*grid/s);

  const harness = catalogHarness((url) => {
    if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
    throw new Error(`unexpected request ${url}`);
  });
  harness.api.renderDetail(catalogItem('mobile-detail', {
    subtype: 'grant', organization: 'Organização urbana', location: 'São Paulo',
    startsAt: '2030-05-21T00:00:00.000Z', deadlineAt: '2030-05-20T00:00:00.000Z', endDate: '2030-05-30T23:59:59.999Z',
  }));
  const rows = harness.ids.get('catalogDetailMeta').children
    .filter((node) => node.className === 'dispatch-meta-item');
  assert.ok(rows.length >= 6);
  for (const row of rows) {
    assert.ok(row.children.some((node) => node.className === 'dispatch-meta-value'), 'metadata values need a layout target separate from their label');
  }
});

test('catalog page exposes the complete public and member workflow', () => {
  const html = catalogPage();
  for (const kind of ['opportunity', 'project', 'learning_circle', 'resource', 'case_study']) {
    assert.match(html, new RegExp(`value="${kind}"`), `${kind} filter is missing`);
  }
  for (const id of [
    'catalogForm', 'catalogQuery', 'catalogTopic', 'catalogLocation', 'catalogState',
    'catalogResults', 'catalogStatus', 'catalogDetail', 'catalogDetailStatus',
    'catalogInterestForm', 'catalogInterestCompose', 'catalogInterestMessage', 'catalogInterestDisclosure',
    'catalogInterestSignIn', 'catalogInterestSubmit', 'catalogMyInterests', 'catalogMyInterestsStatus',
  ]) assert.match(html, new RegExp(`id="${id}"`), `${id} must be present`);
  assert.match(html, /<option value="open"/);
  assert.match(html, /<option value="all"/);
  assert.doesNotMatch(html, /src="script\.js/);
  for (const publicHtml of [index(), html]) {
    for (const key of ['nav.mainLabel', 'nav.accountLabel', 'nav.languageLabel', 'nav.menuLabel']) {
      assert.match(publicHtml, new RegExp(`data-i18n-aria-label="${key.replace('.', '\\.')}"`));
    }
  }
});

test('editorial email links preserve address delimiters as address text', () => {
  const h = adminHarness();
  const address = 'member?bcc=other%40example.test#tag@example.test';
  const card = h.api.renderInterest({member:{name:'Member',email:address},item:{},status:'new'});
  const link = descendants(card).find(node => node.href?.startsWith('mailto:'));
  const uri = new URL(link.href);
  assert.equal(uri.search, '');
  assert.equal(uri.hash, '');
  assert.equal(decodeURIComponent(uri.pathname), address);
  assert.equal(link.textContent, address);
});

test('landing logo script tolerates pages without a headline and preserves real brand navigation', () => {
  const svg = new FakeNode('net');
  const brand = new FakeNode('brand');
  brand.href = 'index.html';
  const document = {
    readyState: 'complete',
    getElementById: (id) => ({ net: svg, brand }[id] ?? null),
    createElementNS: () => new FakeNode(),
    querySelector: () => null,
    addEventListener() {},
  };
  const context = { document, window: {}, requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {} };
  assert.doesNotThrow(() => vm.runInNewContext(read('web', 'scripts', 'script.js'), context));
  let prevented = false;
  brand.listeners.get('click')({ currentTarget: brand, preventDefault() { prevented = true; } });
  assert.equal(prevented, false, 'a brand link to index.html must navigate normally');
});

test('catalog filters and language ignore abort-ignoring stale success and failure', async (t) => {
  for (const transition of ['filter', 'language']) {
    for (const outcome of ['success', 'failure']) {
      await t.test(`${transition} keeps the newest results after late ${outcome}`, async () => {
        let oldRequest;
        const harness = catalogHarness((url, options = {}) => {
          if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
          const parsed = new URL(url, 'https://nodal.test');
          const isOld = transition === 'filter'
            ? parsed.searchParams.get('q') === 'old'
            : parsed.searchParams.get('lang') === 'en';
          if (isOld) {
            oldRequest = deferredResponse(options.signal, { honorAbort: false });
            return oldRequest.promise;
          }
          return Promise.resolve(response({ items: [catalogItem('new', { title: 'Newest result' })], nextCursor: 'new-next' }));
        });
        mountCatalogList(harness);

        if (transition === 'filter') harness.ids.get('catalogQuery').value = 'old';
        const stale = harness.api.loadResults();
        if (transition === 'filter') harness.ids.get('catalogQuery').value = 'new';
        else harness.i18nState.lang = 'pt';
        await harness.api.loadResults();

        if (outcome === 'success') {
          oldRequest.resolve(response({ items: [catalogItem('old', { title: 'Stale result' })], nextCursor: 'old-next' }));
        } else oldRequest.reject(new Error('late stale transport failure'));
        await stale;

        assert.match(renderedText(harness.ids.get('catalogResults')), /Newest result/);
        assert.doesNotMatch(renderedText(harness.ids.get('catalogResults')), /Stale result/);
        assert.equal(harness.api.page.nextCursor, 'new-next');
        assert.notEqual(harness.ids.get('catalogStatus').textContent, 'catalog.error');
      });
    }
  }
});

test('catalog filter synchronously invalidates an abort-ignoring append without clearing current busy state', async () => {
  let appendRequest;
  let filteredRequest;
  const harness = catalogHarness((url, options = {}) => {
    if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
    const parsed = new URL(url, 'https://nodal.test');
    if (parsed.searchParams.get('cursor') === 'old-cursor') {
      appendRequest = deferredResponse(options.signal, { honorAbort: false });
      return appendRequest.promise;
    }
    if (parsed.searchParams.get('q') === 'new') {
      filteredRequest = deferredResponse(options.signal, { honorAbort: false });
      return filteredRequest.promise;
    }
    throw new Error(`unexpected request ${url}`);
  });
  mountCatalogList(harness);
  harness.api.page.nextCursor = 'old-cursor';
  harness.ids.get('catalogResults').append(harness.api.renderDispatch(catalogItem('base', { title: 'Base result' })));

  const staleAppend = harness.api.loadResults({ append: true });
  harness.ids.get('catalogQuery').value = 'new';
  const currentFilter = harness.api.runFilters();
  assert.equal(harness.api.page.nextCursor, null, 'filter changes must synchronously clear the old cursor');

  appendRequest.resolve(response({ items: [catalogItem('old-page', { title: 'Late appended result' })], nextCursor: null }));
  await staleAppend;
  assert.equal(harness.ids.get('catalogResults').getAttribute('aria-busy'), 'true', 'a stale finally must not clear current busy state');

  filteredRequest.resolve(response({ items: [catalogItem('filtered', { title: 'Filtered result' })], nextCursor: null }));
  await currentFilter;
  assert.match(renderedText(harness.ids.get('catalogResults')), /Filtered result/);
  assert.doesNotMatch(renderedText(harness.ids.get('catalogResults')), /Late appended result|Base result/);
  assert.equal(harness.ids.get('catalogResults').getAttribute('aria-busy'), 'false');
});

test('catalog language change synchronously invalidates the prior language cursor before an append can start', async () => {
  let firstPage;
  const catalogUrls = [];
  const harness = catalogHarness((url, options = {}) => {
    if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
    if (url.startsWith('/api/catalog?')) {
      catalogUrls.push(url);
      if (catalogUrls.length === 1) {
        firstPage = deferredResponse(options.signal, { honorAbort: false });
        return firstPage.promise;
      }
      return Promise.resolve(response({ items: [catalogItem('pt', { title: 'Página portuguesa' })], nextCursor: null }));
    }
    throw new Error(`unexpected request ${url}`);
  });
  mountCatalogList(harness);
  harness.api.page.nextCursor = 'english-cursor';
  harness.ids.get('catalogMore').hidden = false;
  harness.i18nState.lang = 'pt';

  const languageRefresh = harness.api.refetchForLanguage();
  assert.equal(harness.api.page.nextCursor, null, 'language changes must clear the old cursor before awaiting the new first page');
  assert.equal(harness.ids.get('catalogMore').hidden, true, 'Load More must be unavailable during a language reset');

  await harness.api.loadResults({ append: true });
  assert.equal(catalogUrls.some((url) => new URL(url, 'https://nodal.test').searchParams.has('cursor')), false,
    'even a programmatic append during the transition must not mix the old language cursor');
  assert.equal(catalogUrls.length, 1, 'append must not restart the first page');
  firstPage.resolve(response({ items: [catalogItem('pt', { title: 'Página portuguesa' })], nextCursor: null }));
  await languageRefresh;
  assert.match(renderedText(harness.ids.get('catalogResults')), /Página portuguesa/);
  assert.doesNotMatch(renderedText(harness.ids.get('catalogResults')), /Late English page/);
});

test('landing catalog regions ignore abort-ignoring language races and stale finalizers', async (t) => {
  for (const outcome of ['success', 'failure']) {
    await t.test(`Portuguese landing survives stale English ${outcome}`, async () => {
      const requests = new Map();
      const harness = catalogHarness((url, options = {}) => {
        if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
        const parsed = new URL(url, 'https://nodal.test');
        const key = `${parsed.searchParams.get('lang')}:${parsed.searchParams.get('kind') === 'case_study' ? 'cases' : 'open'}`;
        const request = deferredResponse(options.signal, { honorAbort: false });
        requests.set(key, request);
        return request.promise;
      });
      mountLandingCatalog(harness);

      const english = harness.api.loadLanding();
      harness.i18nState.lang = 'pt';
      const portuguese = harness.api.loadLanding();

      const oldOpen = requests.get('en:open');
      if (outcome === 'success') oldOpen.resolve(response({ items: [catalogItem('en-open', { title: 'English open' })], nextCursor: null }));
      else oldOpen.reject(new Error('stale English open failure'));
      await Promise.resolve();
      assert.equal(harness.ids.get('landingOpenWork').getAttribute('aria-busy'), 'true', 'stale landing finally must not clear current busy state');

      requests.get('pt:open').resolve(response({ items: [catalogItem('pt-open', { title: 'Trabalho português' })], nextCursor: null }));
      requests.get('pt:cases').resolve(response({ items: [catalogItem('pt-case', { kind: 'case_study', title: 'Caso português' })], nextCursor: null }));
      await portuguese;

      const oldCases = requests.get('en:cases');
      if (outcome === 'success') oldCases.resolve(response({ items: [catalogItem('en-case', { kind: 'case_study', title: 'English case' })], nextCursor: null }));
      else oldCases.reject(new Error('stale English cases failure'));
      await english;

      assert.match(renderedText(harness.ids.get('landingOpenWork')), /Trabalho português/);
      assert.match(renderedText(harness.ids.get('landingCases')), /Caso português/);
      assert.doesNotMatch(renderedText(harness.ids.get('landingOpenWork')), /English open/);
      assert.doesNotMatch(renderedText(harness.ids.get('landingCases')), /English case/);
      assert.equal(harness.ids.get('landingOpenWorkStatus').textContent, '');
      assert.equal(harness.ids.get('landingCasesStatus').textContent, '');
    });
  }
});

test('close and filter state survive abort-ignoring stale detail success and failure', async (t) => {
  for (const action of ['close', 'filter']) {
    for (const outcome of ['success', 'failure']) {
      await t.test(`${action} ignores late ${outcome}`, async () => {
        let request;
        const harness = catalogHarness((url, options = {}) => {
          if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
          request = deferredResponse(options.signal, { honorAbort: false });
          return request.promise;
        });

        const loading = harness.api.selectDetail('item-1');
        if (action === 'close') harness.api.closeDetail();
        else harness.api.runFilters();
        if (outcome === 'success') request.resolve(response({ item: catalogItem() }));
        else request.reject(new Error('late transport failure'));
        await loading;

        assert.equal(harness.ids.get('catalogDetail').hidden, true);
        assert.equal(harness.ids.get('catalogDetailStatus').textContent, 'catalog.selectDetail');
      });
    }
  }
});

test('detail language changes survive abort-ignoring stale success and failure', async (t) => {
  for (const outcome of ['success', 'failure']) {
    await t.test(`new language survives late old-language ${outcome}`, async () => {
      let english;
      const harness = catalogHarness((url, options = {}) => {
        if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
        if (url.includes('lang=en')) {
          english = deferredResponse(options.signal, { honorAbort: false });
          return english.promise;
        }
        if (url.includes('lang=pt')) {
          return Promise.resolve(response({ item: catalogItem('item-1', { title: 'Português' }) }));
        }
        throw new Error(`unexpected request ${url}`);
      });

      const oldLanguage = harness.api.selectDetail('item-1');
      harness.i18nState.lang = 'pt';
      await harness.api.selectDetail('item-1');
      if (outcome === 'success') {
        english.resolve(response({ item: catalogItem('item-1', { title: 'English' }) }));
      } else english.reject(new Error('late old-language failure'));
      await oldLanguage;

      assert.equal(harness.ids.get('detailTitle').textContent, 'Português');
      assert.equal(harness.ids.get('catalogDetail').hidden, false);
      assert.equal(harness.ids.get('catalogDetailStatus').textContent, '');
    });
  }
});

test('My interests language refetch survives abort-ignoring stale success and failure', async (t) => {
  for (const outcome of ['success', 'failure']) {
    await t.test(`Portuguese interests survive late English ${outcome}`, async () => {
      let english;
      let catalogDetailRequested = false;
      const harness = catalogHarness((url, options = {}) => {
        if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
        if (url.includes('/api/me/catalog-interests?lang=en')) {
          english = deferredResponse(options.signal, { honorAbort: false });
          return english.promise;
        }
        if (url.includes('/api/me/catalog-interests?lang=pt')) {
          return Promise.resolve(response({ interests: [{ itemId: 'pt', status: 'new', message: '', item: catalogItem('pt', { title: 'Português' }) }], nextCursor: null }));
        }
        if (url.includes('/api/catalog/')) catalogDetailRequested = true;
        throw new Error(`unexpected request ${url}`);
      });

      const oldRender = harness.api.loadMyInterests();
      harness.i18nState.lang = 'pt';
      await harness.api.loadMyInterests();
      if (outcome === 'success') {
        english.resolve(response({ interests: [{ itemId: 'en', status: 'new', message: '', item: catalogItem('en', { title: 'English' }) }], nextCursor: null }));
      } else english.reject(new Error('late English interests failure'));
      await oldRender;

      const titles = harness.ids.get('catalogMyInterestsList').children
        .map((article) => article.children.find((node) => node.id === 'h3')?.textContent)
        .filter(Boolean);
      assert.deepEqual(titles, ['Português']);
      assert.equal(harness.ids.get('catalogMyInterestsStatus').textContent, '');
      assert.equal(catalogDetailRequested, false);
    });
  }
});

test('My interests drains cursor pages from enriched responses without public detail N+1 reads', async () => {
  const calls = [];
  const harness = catalogHarness((url) => {
    if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
    calls.push(url);
    if (url.includes('cursor=next-owned')) {
      return Promise.resolve(response({ interests: [{ itemId: 'two', status: 'contacted', message: '', item: catalogItem('two') }], nextCursor: null }));
    }
    if (url.includes('/api/me/catalog-interests?lang=en')) {
      return Promise.resolve(response({ interests: [{ itemId: 'one', status: 'new', message: '', item: catalogItem('one') }], nextCursor: 'next-owned' }));
    }
    throw new Error(`unexpected request ${url}`);
  });
  await harness.api.loadMyInterests();
  assert.equal(harness.ids.get('catalogMyInterestsList').children.length, 2);
  assert.ok(calls.some((url) => url.includes('cursor=next-owned')));
  assert.equal(calls.some((url) => url.includes('/api/catalog/')), false);
});

test('My interests keeps active unpublished tombstones withdrawable without public detail access', async (t) => {
  for (const activeStatus of ['new', 'contacted']) {
    await t.test(activeStatus, async () => {
      const calls = [];
      let interestsRead = 0;
      const harness = catalogHarness((url, options = {}) => {
        if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
        calls.push({ url, method: options.method || 'GET' });
        if (url.includes('/api/me/catalog-interests?lang=en')) {
          interestsRead += 1;
          const active = interestsRead === 1;
          return Promise.resolve(response({
            interests: [{
              itemId: 'unpublished-item',
              status: active ? activeStatus : 'withdrawn',
              message: 'Keep my history.',
              item: null,
            }],
            nextCursor: null,
          }));
        }
        if (url === '/api/catalog/unpublished-item/interest' && options.method === 'DELETE') {
          return Promise.resolve(response({ interest: { itemId: 'unpublished-item', status: 'withdrawn', message: 'Keep my history.' } }));
        }
        throw new Error(`unexpected request ${options.method || 'GET'} ${url}`);
      });

      await harness.api.loadMyInterests();
      const firstCard = harness.ids.get('catalogMyInterestsList').children[0];
      assert.equal(firstCard.children[0].textContent, `catalog.status.${activeStatus}`);
      assert.equal(firstCard.children[1].textContent, 'catalog.detailUnavailable');
      assert.equal(firstCard.children[2].textContent, 'Keep my history.');
      const withdraw = descendants(firstCard).find((node) => node.textContent === 'catalog.withdraw');
      assert.ok(withdraw, 'an active tombstone needs a direct withdrawal action');
      await withdraw.listeners.get('click')({ currentTarget: withdraw });

      assert.ok(calls.some((call) => call.url === '/api/catalog/unpublished-item/interest' && call.method === 'DELETE'));
      assert.equal(calls.some((call) => call.url.includes('/api/catalog/unpublished-item?')), false, 'unpublished detail must not be requested');
      assert.equal(harness.ids.get('catalogMyInterestsStatus').textContent, 'catalog.interestWithdrawn');
      const updatedWithdraw = descendants(harness.ids.get('catalogMyInterestsList').children[0])
        .find((node) => node.textContent === 'catalog.withdraw');
      assert.equal(updatedWithdraw.hidden, true);
    });
  }
});

test('interest writes report transport failures and preserve successful feedback', async (t) => {
  await t.test('PUT rejection becomes an honest error', async () => {
    const harness = catalogHarness((url) => {
      if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
      return Promise.reject(new Error('offline'));
    });
    await harness.api.loadAuthState();
    harness.api.renderDetail(catalogItem('item-1'));
    await assert.doesNotReject(harness.api.submitInterest({
      preventDefault() {},
      currentTarget: harness.ids.get('catalogInterestForm'),
    }));
    assert.equal(harness.ids.get('catalogInterestStatus').textContent, 'catalog.interestError');
  });

  await t.test('DELETE rejection becomes an honest error', async () => {
    const harness = catalogHarness((url) => {
      if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
      return Promise.reject(new Error('offline'));
    });
    await harness.api.loadAuthState();
    harness.api.renderDetail(catalogItem('item-1'));
    await assert.doesNotReject(harness.api.withdrawInterest());
    assert.equal(harness.ids.get('catalogInterestStatus').textContent, 'catalog.interestError');
  });

  await t.test('PUT success remains explicit without a detail refresh', async () => {
    const harness = catalogHarness((url, options = {}) => {
      if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
      if (options.method === 'PUT') return Promise.resolve(response({ interest: { status: 'new' } }));
      return Promise.resolve(response({ item: catalogItem('item-1', { interestStatus: 'new' }) }));
    });
    await harness.api.loadAuthState();
    harness.api.renderDetail(catalogItem('item-1'));
    await harness.api.submitInterest({ preventDefault() {}, currentTarget: harness.ids.get('catalogInterestForm') });
    assert.equal(harness.ids.get('catalogInterestStatus').textContent, 'catalog.interestSuccess');
  });

  await t.test('DELETE success remains explicit without a detail refresh', async () => {
    const harness = catalogHarness((url, options = {}) => {
      if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
      if (options.method === 'DELETE') return Promise.resolve(response({ interest: { status: 'withdrawn' } }));
      return Promise.resolve(response({ item: catalogItem('item-1', { interestStatus: 'withdrawn' }) }));
    });
    await harness.api.loadAuthState();
    harness.api.renderDetail(catalogItem('item-1'));
    await harness.api.withdrawInterest();
    assert.equal(harness.ids.get('catalogInterestStatus').textContent, 'catalog.interestWithdrawn');
  });
});

test('kind filter focus is drawn on the visible control', () => {
  assert.match(read('web', 'styles', 'catalog.css'), /\.kind-fieldset input:focus-visible\s*\+\s*span\s*\{[^}]*outline:/s);
});

test('catalog client keeps network states honest, safe, and race-free', () => {
  const source = catalogScript();
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /URLSearchParams/);
  assert.match(source, /setTimeout\([^,]+,\s*300\)/);
  assert.match(source, /\/api\/auth\/state/);
  assert.match(source, /\/api\/me\/catalog-interests/);
  assert.match(source, /method:\s*'PUT'/);
  assert.match(source, /method:\s*'DELETE'/);
  assert.match(source, /credentials:\s*'same-origin'/);
  assert.match(source, /textContent/);
  assert.match(source, /window\.nodalI18n\.onChange/);
  assert.doesNotMatch(source, /demo|fallbackItem|sampleItem|mockItem/i);
});

test('every required catalog client target exists on a page that loads it', () => {
  const pages = [catalogPage()];
  assert.doesNotMatch(index(), /<script[^>]+src="catalog\.js/);
  assert.ok(pages.every((html) => /<script[^>]+src="catalog\.js/.test(html)));
  const ids = new Set(pages.flatMap((html) => [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])));
  const references = new Set([
    ...catalogScript().matchAll(/(?:getElementById|byId)\(\s*'([^']+)'/g),
  ].map((match) => match[1]));
  for (const id of references) assert.ok(ids.has(id) || optionalLandingTargets.has(id), `catalog.js target #${id} is absent`);
});

test('catalog dynamic and visible states resolve in EN, ES, and PT', () => {
  const source = i18n();
  const english = dictionaryKeys(source, 'DASH_EN');
  const spanish = new Set([...dictionaryKeys(source, 'ES'), ...dictionaryKeys(source, 'DASH_ES')]);
  const portuguese = new Set([...dictionaryKeys(source, 'PT'), ...dictionaryKeys(source, 'DASH_PT')]);
  for (const html of [catalogPage()]) {
    for (const match of html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) english.add(match[1]);
  }
  const used = new Set([...catalogScript().matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1]));
  const requiredStates = [
    'catalog.loading', 'catalog.empty', 'catalog.error', 'catalog.detailLoading',
    'catalog.detailUnavailable', 'catalog.closed', 'catalog.sourceVerified',
    'catalog.externalAction', 'catalog.interestDisclosure', 'catalog.interestSuccess',
    'catalog.interestWithdrawn', 'catalog.interestsEmpty', 'catalog.interestsError',
    'catalog.signInToExpressInterest',
    'catalog.status.new', 'catalog.status.contacted', 'catalog.status.closed', 'catalog.status.withdrawn',
    'nav.mainLabel', 'nav.accountLabel', 'nav.languageLabel', 'nav.menuLabel',
  ];
  requiredStates.forEach((key) => used.add(key));
  for (const key of used) {
    assert.ok(english.has(key), `${key} missing in English`);
    assert.ok(spanish.has(key), `${key} missing in Spanish`);
    assert.ok(portuguese.has(key), `${key} missing in Portuguese`);
  }
});

test('admin workspace exposes a complete trilingual editor without destructive controls', () => {
  const html = adminPage();
  for (const id of [
    'adminCatalogFilters', 'adminCatalogQuery', 'adminCatalogKind', 'adminCatalogStatus',
    'adminCatalogList', 'adminCatalogListStatus', 'adminCatalogMore', 'adminCatalogEditor', 'adminCatalogId',
    'adminCatalogVersion', 'adminKind', 'adminSubtype', 'adminVisibility',
    'adminOrganization', 'adminLocation', 'adminTopics', 'adminStartsAt', 'adminDeadlineAt',
    'adminTopicsError', 'adminEndDate', 'adminSourceLabel', 'adminSourceUrl', 'adminSourceVerifiedAt', 'adminActionMode',
    'adminActionUrl', 'adminFeatured', 'adminSaveDraft', 'adminPublish', 'adminArchive',
    'adminPreview', 'adminConflictReload', 'adminEditorStatus', 'adminPreviewPanel',
    'adminInterestFilter', 'adminInterestList', 'adminInterestStatus', 'adminInterestMore', 'adminSignOut',
  ]) assert.match(html, new RegExp(`id="${id}"`), `${id} must be present`);

  for (const lang of ['En', 'Es', 'Pt']) {
    for (const field of ['Title', 'Summary', 'Body', 'Cta']) {
      assert.match(html, new RegExp(`id="admin${field}${lang}"`), `${field} ${lang} input is missing`);
    }
  }
  assert.doesNotMatch(html, /hard[- ]?delete|delete catalog|id="adminDelete"/i);
  assert.match(html, /<script[^>]+src="admin\.js/);
  assert.match(html, /<link[^>]+href="admin\.css/);
  assert.match(adminStyles(), /@media \(max-width: 820px\)[\s\S]*?\.admin-topbar nav a[\s\S]*?display:\s*none/);
  assert.match(adminStyles(), /@media \(max-width: 820px\)[\s\S]*?#adminSignOut[\s\S]*?display:/);
  // An empty record list reserves no blank band once the index stacks above the editor on phones.
  assert.match(adminStyles(), /\.admin-record-list:empty \{ min-height: 0; \}/);
});

test('admin client serializes translations atomically and preserves edits on stale versions', () => {
  const source = adminScript();
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(source, /credentials:\s*'same-origin'/);
  assert.match(source, /\/api\/admin\/catalog/);
  assert.match(source, /\/api\/admin\/interests/);
  assert.match(source, /status\s*===\s*409/);
  assert.match(source, /new URLSearchParams/);
  // Catalog records are archived, never deleted; only a NODAL news post can be deleted.
  assert.deepEqual([...source.matchAll(/request\(([^,]+), \{ method: 'DELETE' \}\)/g)].map((match) => match[1]), ['`/api/admin/news/${encodeURIComponent(current.id)}`']);
  assert.doesNotMatch(source, /\/api\/admin\/catalog[^\n]*'DELETE'/);

  for (const lang of ['en', 'es', 'pt']) {
    const upper = `${lang.charAt(0).toUpperCase()}${lang.slice(1)}`;
    assert.match(source, new RegExp(`${lang}:\\s*readTranslation\\('${upper}'\\)`));
  }
  assert.match(source, /showCatalogConflict\(data\.current/);
  assert.match(source, /adminConflictReload/);
  assert.match(source, /replaceChildren/);
  assert.match(source, /textContent/);

  const harness = adminHarness();
  const set = (id, value) => { harness.ids.get(id).value = value; };
  set('adminKind', 'opportunity');
  set('adminSubtype', 'grant');
  set('adminVisibility', 'members');
  set('adminOrganization', 'Operator-entered organization');
  set('adminLocation', 'Operator-entered place');
  set('adminTopics', 'mobility, housing');
  set('adminStartsAt', '2026-09-01T09:00');
  set('adminDeadlineAt', '2026-09-30T18:00');
  set('adminEndDate', '2026-12-31');
  set('adminSourceLabel', 'Official grant page');
  set('adminSourceUrl', 'https://source.example/item');
  set('adminSourceVerifiedAt', '2026-08-10');
  set('adminActionMode', 'external');
  set('adminActionUrl', 'https://action.example/apply');
  harness.ids.get('adminFeatured').checked = true;
  for (const lang of ['En', 'Es', 'Pt']) {
    set(`adminTitle${lang}`, `Title ${lang}`);
    set(`adminSummary${lang}`, `Summary ${lang}`);
    set(`adminBody${lang}`, `Body ${lang}`);
    set(`adminCta${lang}`, `CTA ${lang}`);
  }

  const payload = JSON.parse(JSON.stringify(harness.api.serializeEditor('published')));
  assert.deepEqual(Object.keys(payload.translations), ['en', 'es', 'pt']);
  assert.deepEqual(payload.translations.pt, { title: 'Title Pt', summary: 'Summary Pt', body: 'Body Pt', cta: 'CTA Pt' });
  assert.equal(payload.status, 'published');
  assert.equal(payload.actionUrl, 'https://action.example/apply');
  assert.equal(payload.sourceLabel, 'Official grant page');
  assert.deepEqual(payload.topics, ['mobility', 'housing']);

  set('adminTitleEn', 'Unsaved operator wording');
  harness.ids.get('adminConflictPanel').hidden = true;
  const current = { id: 'record-1', version: 8, translations: { en: { title: 'Server wording' } } };
  harness.api.showCatalogConflict(current);
  assert.equal(harness.ids.get('adminTitleEn').value, 'Unsaved operator wording');
  assert.equal(harness.ids.get('adminConflictPanel').hidden, false);
  assert.equal(harness.api.conflict().version, 8);
  assert.ok(harness.ids.get('adminConflictReload').listeners.has('click'), 'explicit reload control must own conflict replacement');
});

test('admin workspace validates topics before preview or writes, paginates both queues, reloads filtered updates, and signs out', async () => {
  const requests = [];
  let catalogPage = 0;
  let interestPage = 0;
  let interestReloaded = false;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/auth/logout') return response({ ok: true });
    if (url.startsWith('/api/admin/catalog?')) {
      catalogPage += 1;
      return catalogPage === 1
        ? response({ items: [{ id: 'record-1', kind: 'resource', status: 'draft', visibility: 'public', translations: { en: { title: 'First' } } }], nextCursor: 'catalog-next' })
        : response({ items: [{ id: 'record-2', kind: 'project', status: 'published', visibility: 'public', translations: { en: { title: 'Second' } } }], nextCursor: null });
    }
    if (url.startsWith('/api/admin/interests?')) {
      interestPage += 1;
      if (interestReloaded) return response({ interests: [], nextCursor: null });
      return interestPage === 1
        ? response({ interests: [{ id: 'interest-1', version: 1, status: 'new', message: 'Hello', member: { name: 'Member', email: 'member@example.test' }, item: { itemId: 'record-1', title: 'First', kind: 'resource', organization: 'NODAL' } }], nextCursor: 'interest-next' })
        : response({ interests: [{ id: 'interest-2', version: 1, status: 'new', message: '', member: { name: 'Other', email: 'other@example.test' }, item: { itemId: 'record-2', title: 'Second', kind: 'project', organization: 'Cities' } }], nextCursor: null });
    }
    if (url === '/api/admin/interests/interest-1' && options.method === 'PATCH') {
      interestReloaded = true;
      return response({ interest: { id: 'interest-1', version: 2, status: 'contacted' } });
    }
    if (url === '/api/admin/catalog' && options.method === 'POST') return response({ item: {} }, { ok: true, status: 201 });
    throw new Error(`unexpected request ${url}`);
  };
  const harness = adminHarness(fetchImpl);

  harness.ids.get('adminTopics').value = Array.from({ length: 9 }, (_, index) => `topic-${index}`).join(', ');
  harness.api.renderPreview();
  assert.equal(harness.ids.get('adminPreviewPanel').hidden, true);
  assert.equal(harness.ids.get('adminTopicsError').hidden, false);
  await harness.api.saveCatalog('draft');
  assert.equal(requests.some((entry) => entry.url === '/api/admin/catalog'), false);
  harness.ids.get('adminTopics').value = 'x'.repeat(61);
  assert.equal(harness.api.validateEditorTopics(), null);

  harness.ids.get('adminTopics').value = 'mobility';
  await harness.api.loadCatalog();
  await harness.ids.get('adminCatalogMore').listeners.get('click')();
  assert.equal(harness.api.state.items.length, 2);
  assert.equal(harness.ids.get('adminCatalogMore').hidden, true);
  assert.ok(requests.some((entry) => entry.url.includes('cursor=catalog-next')));

  harness.ids.get('adminInterestFilter').value = 'new';
  await harness.api.loadInterests();
  assert.match(renderedText(harness.ids.get('adminInterestList')), /First/);
  await harness.ids.get('adminInterestMore').listeners.get('click')();
  assert.equal(harness.ids.get('adminInterestList').children.length, 2);
  assert.ok(requests.some((entry) => entry.url.includes('cursor=interest-next')));

  const firstCard = harness.ids.get('adminInterestList').children[0];
  const select = descendants(firstCard).find((node) => node.id === 'select');
  const update = descendants(firstCard).find((node) => node.textContent === 'Update');
  select.value = 'contacted';
  await update.listeners.get('click')();
  assert.equal(harness.ids.get('adminInterestList').children.length, 0, 'updated records must disappear when they no longer match the active filter');

  await harness.ids.get('adminSignOut').listeners.get('click')();
  const logout = requests.find((entry) => entry.url === '/api/auth/logout');
  assert.equal(logout.options.method, 'POST');
  assert.equal(logout.options.credentials, 'same-origin');
  assert.equal(harness.location.assigned, '/login.html');
});

test('admin filter changes synchronously invalidate old catalog and interest cursors and late pages', async () => {
  let catalogAppend;
  let catalogFiltered;
  let catalogAppendFailure = false;
  let interestAppend;
  let interestFiltered;
  const requests = [];
  const fetchImpl = (url, options = {}) => {
    requests.push(url);
    const parsed = new URL(url, 'https://nodal.test');
    if (parsed.pathname === '/api/admin/catalog') {
      if (parsed.searchParams.get('cursor') === 'catalog-old') {
        catalogAppend = deferredResponse(options.signal, { honorAbort: false });
        return catalogAppend.promise;
      }
      if (parsed.searchParams.get('cursor') === 'catalog-project') {
        catalogAppendFailure = true;
        return Promise.reject(new Error('append unavailable'));
      }
      if (parsed.searchParams.get('kind') === 'project') {
        catalogFiltered = deferredResponse(options.signal, { honorAbort: false });
        return catalogFiltered.promise;
      }
      return Promise.resolve(response({ items: [{ id: 'catalog-old-1', translations: { en: { title: 'Old catalog' } } }], nextCursor: 'catalog-old' }));
    }
    if (parsed.pathname === '/api/admin/interests') {
      if (parsed.searchParams.get('cursor') === 'interest-old') {
        interestAppend = deferredResponse(options.signal, { honorAbort: false });
        return interestAppend.promise;
      }
      if (parsed.searchParams.get('status') === 'contacted') {
        interestFiltered = deferredResponse(options.signal, { honorAbort: false });
        return interestFiltered.promise;
      }
      return Promise.resolve(response({ interests: [{ id: 'interest-old-1', status: 'new', item: { title: 'Old interest' }, member: {} }], nextCursor: 'interest-old' }));
    }
    throw new Error(`unexpected request ${url}`);
  };
  const harness = adminHarness(fetchImpl);

  await harness.api.loadCatalog();
  const oldCatalogAppend = harness.ids.get('adminCatalogMore').listeners.get('click')();
  harness.ids.get('adminCatalogKind').value = 'project';
  const newCatalog = harness.ids.get('adminCatalogKind').listeners.get('change')();
  assert.equal(harness.api.state.catalogCursor, null, 'a changed filter must synchronously clear the old catalog cursor');
  assert.equal(harness.ids.get('adminCatalogMore').hidden, true);
  catalogFiltered.resolve(response({ items: [{ id: 'catalog-project-1', translations: { en: { title: 'Project result' } } }], nextCursor: 'catalog-project' }));
  await newCatalog;
  catalogAppend.resolve(response({ items: [{ id: 'catalog-old-2', translations: { en: { title: 'Late old catalog page' } } }], nextCursor: null }));
  await oldCatalogAppend;
  assert.deepEqual(harness.api.state.items.map((item) => item.id), ['catalog-project-1']);
  assert.ok(requests.some((url) => url.includes('kind=project') && !url.includes('cursor=catalog-old')));

  await harness.ids.get('adminCatalogMore').listeners.get('click')();
  assert.equal(catalogAppendFailure, true);
  assert.equal(harness.ids.get('adminCatalogList').getAttribute('aria-busy'), 'false');

  harness.ids.get('adminInterestFilter').value = 'new';
  await harness.api.loadInterests();
  const oldInterestAppend = harness.ids.get('adminInterestMore').listeners.get('click')();
  harness.ids.get('adminInterestFilter').value = 'contacted';
  const newInterests = harness.ids.get('adminInterestFilter').listeners.get('change')();
  assert.equal(harness.api.state.interestCursor, null, 'a changed queue filter must synchronously clear the old interest cursor');
  assert.equal(harness.ids.get('adminInterestMore').hidden, true);
  interestFiltered.resolve(response({ interests: [{ id: 'interest-contacted-1', status: 'contacted', item: { title: 'Contacted result' }, member: {} }], nextCursor: null }));
  await newInterests;
  interestAppend.resolve(response({ interests: [{ id: 'interest-old-2', status: 'new', item: { title: 'Late old queue page' }, member: {} }], nextCursor: null }));
  await oldInterestAppend;
  assert.deepEqual(harness.api.state.interests.map((interest) => interest.id), ['interest-contacted-1']);
  assert.ok(requests.some((url) => url.includes('status=contacted') && !url.includes('cursor=interest-old')));
});

test('successful interest update preserves the honest error from a failed filtered queue refresh', async () => {
  let queueReads = 0;
  const fetchImpl = async (url, options = {}) => {
    if (url.startsWith('/api/admin/interests?')) {
      queueReads += 1;
      if (queueReads === 1) {
        return response({ interests: [{
          id: 'interest-1', version: 1, status: 'new', message: 'Hello', member: { name: 'Member', email: 'member@example.test' },
          item: { itemId: 'catalog-1', title: 'Catalog item', kind: 'resource', organization: 'NODAL' },
        }], nextCursor: null });
      }
      throw new Error('queue refresh unavailable');
    }
    if (url === '/api/admin/interests/interest-1' && options.method === 'PATCH') {
      return response({ interest: { id: 'interest-1', version: 2, status: 'contacted' } });
    }
    throw new Error(`unexpected request ${url}`);
  };
  const harness = adminHarness(fetchImpl);
  harness.ids.get('adminInterestFilter').value = 'new';
  await harness.api.loadInterests();
  const card = harness.ids.get('adminInterestList').children[0];
  const select = descendants(card).find((node) => node.id === 'select');
  const update = descendants(card).find((node) => node.textContent === 'Update');
  select.value = 'contacted';
  await update.listeners.get('click')();
  // The refresh failure is reported in the reader's language, never as a failed update.
  assert.equal(harness.ids.get('adminInterestStatus').textContent, 'Member interests are unavailable.');
  assert.doesNotMatch(harness.ids.get('adminInterestStatus').textContent, /reapplied|updated\./i);
});

test('dashboard cancels a pending People debounce before entering a catalog scope', async () => {
  const calls = [];
  const harness = dashboardSearchHarness(async (url) => {
    calls.push(url);
    if (url.startsWith('/api/users/search?')) return { users: [{ id: 'person-1', name: 'Late person' }] };
    if (url.startsWith('/api/catalog?')) return { items: [{ id: 'project-1', title: 'Current project', kind: 'project' }] };
    throw new Error(`unexpected request ${url}`);
  });
  harness.input.value = 'housing';
  harness.api.runSearch();
  assert.equal(harness.pendingTimers(), 1);

  harness.activate('Projects');
  assert.equal(harness.pendingTimers(), 1, 'switching scope must replace, not retain, the People timer');
  await harness.runNextTimer();

  assert.equal(calls.some((url) => url.startsWith('/api/users/search?')), false);
  const catalogCalls = calls.filter((url) => url.startsWith('/api/catalog?'));
  assert.equal(catalogCalls.length, 1);
  assert.equal(new URL(catalogCalls[0], 'https://nodal.test').searchParams.get('kind'), 'project');
  assert.match(renderedText(harness.pop), /Current project/);
  assert.equal(harness.pop.children[0].href, 'opportunities.html?id=project-1');
});

test('dashboard ignores an abort-insensitive People response after entering a catalog scope', async (t) => {
  for (const outcome of ['success', 'failure']) await t.test(`late People ${outcome}`, async () => {
    let resolvePeople;
    let rejectPeople;
    let peopleSignal;
    const peopleResponse = new Promise((resolve, reject) => {
      resolvePeople = resolve;
      rejectPeople = reject;
    });
    const harness = dashboardSearchHarness((url, options = {}) => {
      if (url.startsWith('/api/users/search?')) {
        peopleSignal = options.signal;
        return peopleResponse;
      }
      if (url.startsWith('/api/catalog?')) {
        return Promise.resolve({ items: [{ id: 'project-1', title: 'Current project', kind: 'project' }] });
      }
      throw new Error(`unexpected request ${url}`);
    });
    harness.input.value = 'housing';
    harness.api.runSearch();
    const pendingPeople = harness.runNextTimer();

    harness.activate('Projects');
    assert.equal(peopleSignal.aborted, true, 'scope change must abort the active People request');
    await harness.runNextTimer();
    assert.match(renderedText(harness.pop), /Current project/);

    if (outcome === 'success') resolvePeople({ users: [{ id: 'person-1', name: 'Late person' }] });
    else rejectPeople(new Error('late directory unavailable'));
    await pendingPeople;
    assert.match(renderedText(harness.pop), /Current project/, 'late People completion must not repaint catalog truth');
    assert.doesNotMatch(renderedText(harness.pop), /Late person|d\.search\.catalogEmpty/);
    assert.equal(harness.pop.children[0].href, 'opportunities.html?id=project-1');
  });
});

test('dashboard catalog scopes use the public API while People remains consent-gated', () => {
  const source = read('web', 'scripts', 'dashboard.js');
  assert.doesNotMatch(source, /function catalogue\(|d\.find\.[pko]\d/);
  assert.match(source, /Projects:\s*'project'/);
  assert.match(source, /Knowledge:\s*'learning_circle,resource,case_study'/);
  assert.match(source, /Opportunities:\s*'opportunity'/);
  assert.match(source, /\/api\/catalog\?/);
  assert.match(source, /new URLSearchParams\(\{\s*id:\s*item\.id\s*\}\)/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /catalogTimer\s*=\s*setTimeout\([\s\S]*?\},\s*220\);/);
  assert.match(source, /\/api\/users\/search\?q=/, 'People must keep the consent-filtered directory API');
  assert.match(source, /d\.search\.catalogSearching/);
  assert.match(source, /d\.search\.catalogUnavailable/);
  assert.match(source, /d\.search\.catalogEmpty/);
  assert.match(source, /catalogReady\s*=\s*false/);
  assert.match(source, /catalogReady\s*&&\s*catalogScope\s*===\s*scope/);
});

test('recommendation asynchronous states are translated and never synthesize records', () => {
  const source = read('web', 'scripts', 'recs.js');
  for (const key of [
    'recs.loading.title', 'recs.loading.role', 'recs.loading.why',
    'recs.empty.title', 'recs.empty.role', 'recs.empty.why',
    'recs.auth.title', 'recs.auth.role', 'recs.auth.why',
    'recs.unavailable.title', 'recs.unavailable.role', 'recs.unavailable.why',
    'recs.retry',
  ]) assert.match(source, new RegExp(`t\\('${key.replaceAll('.', '\\.')}'`), `${key} must be translated at render time`);
  assert.doesNotMatch(source, /title:\s*'(?:No matches yet|Sign in to match)'/);
  assert.doesNotMatch(source, /demo|fallbackRecommendation|sampleRecommendation|mockRecommendation/i);
});

test('dashboard catalog and recommendation states resolve in EN, ES, and PT', () => {
  const source = i18n();
  const english = dictionaryKeys(source, 'DASH_EN');
  const spanish = dictionaryKeys(source, 'DASH_ES');
  const portuguese = dictionaryKeys(source, 'DASH_PT');
  const required = [
    'd.search.catalogSearching', 'd.search.catalogUnavailable', 'd.search.catalogEmpty',
    'catalog.startsAt', 'catalog.endDate', 'catalog.subtype.grant',
    'recs.loading.title', 'recs.loading.role', 'recs.loading.why',
    'recs.empty.title', 'recs.empty.role', 'recs.empty.why',
    'recs.auth.title', 'recs.auth.role', 'recs.auth.why',
    'recs.unavailable.title', 'recs.unavailable.role', 'recs.unavailable.why',
    'recs.retry', 'recs.match', 'recs.mutual.one', 'recs.mutual.many',
    'recs.sameCity', 'recs.complementaryRole',
  ];
  for (const key of required) {
    assert.ok(english.has(key), `${key} missing in English`);
    assert.ok(spanish.has(key), `${key} missing in Spanish`);
    assert.ok(portuguese.has(key), `${key} missing in Portuguese`);
  }
});


test('catalog pagination ignores repeat clicks and retry preserves the loaded page and cursor', async () => {
  let pending;
  const reads = [];
  const h = catalogHarness((url, options = {}) => {
    if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
    reads.push(url);
    pending = deferredResponse(options.signal, { honorAbort: false });
    return pending.promise;
  });
  mountCatalogList(h);
  h.api.page.nextCursor = 'page-two';
  h.ids.get('catalogResults').append(h.api.renderDispatch(catalogItem('first', { title: 'First listing' })));
  const first = h.api.loadResults({ append: true });
  assert.equal(h.ids.get('catalogMore').disabled, true);
  await h.api.loadResults({ append: true });
  assert.equal(reads.length, 1, 'repeat clicks must not restart pagination');
  pending.reject(new Error('offline'));
  await first;
  assert.match(renderedText(h.ids.get('catalogResults')), /First listing/);
  assert.equal(h.ids.get('catalogRetry').hidden, false);
  const retry = h.ids.get('catalogRetry').onclick();
  assert.equal(new URL(reads.at(-1), 'https://nodal.test').searchParams.get('cursor'), 'page-two');
  pending.resolve(response({ items: [catalogItem('second', { title: 'Second listing' })], nextCursor: null }));
  await retry;
  assert.equal(h.ids.get('catalogResults').children.length, 2);
  assert.match(renderedText(h.ids.get('catalogResults')), /First listing.*Second listing/);
  assert.equal(h.ids.get('catalogRetry').hidden, true);
  assert.equal(h.ids.get('catalogMore').hidden, true);
});

test('failed catalog searches can be retried with the same filters', async () => {
  const reads = [];
  const h = catalogHarness(url => {
    if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
    reads.push(url);
    return reads.length === 1 ? Promise.reject(new Error('offline'))
      : Promise.resolve(response({ items: [catalogItem('found')], nextCursor: null }));
  });
  mountCatalogList(h);
  h.ids.get('catalogQuery').value = 'housing';
  h.ids.get('catalogLocation').value = 'Lima';
  await h.api.loadResults();
  assert.equal(h.ids.get('catalogRetry').hidden, false);
  await h.ids.get('catalogRetry').onclick();
  assert.equal(reads[0], reads[1]);
  assert.equal(h.ids.get('catalogResults').children.length, 1);
  assert.equal(h.ids.get('catalogRetry').hidden, true);
});

test('applying filters cancels the queued typing search', async () => {
  let reads = 0;
  const h = catalogHarness(url => {
    if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
    reads++;
    return Promise.resolve(response({ items: [], nextCursor: null }));
  });
  mountCatalogList(h);
  h.api.debounceFilters();
  await h.api.runFilters();
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(reads, 1);
});

test('details focus their heading and close returns to the connected listing trigger', async () => {
  const h = catalogHarness(url => Promise.resolve(response(url === '/api/auth/state'
    ? { authenticated: true } : { item: catalogItem('focus-item') })));
  const trigger = new FakeNode('listing-button');
  trigger.isConnected = true;
  await h.api.selectDetail('focus-item', trigger);
  assert.equal(h.ids.get('detailTitle').focused, true);
  h.api.closeDetail({ restoreFocus: true });
  assert.equal(trigger.focused, true);
  assert.equal(h.ids.get('catalogDetail').hidden, true);
});

test('interest updates lock repeated writes, preserve failed drafts and avoid a follow-up detail read', async () => {
  let pending;
  const writes = [];
  const h = catalogHarness((url, options = {}) => {
    if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
    writes.push({ url, options });
    pending = deferredResponse();
    return pending.promise;
  });
  await h.api.loadAuthState();
  h.api.renderDetail(catalogItem('item-1'));
  const message = h.ids.get('catalogInterestMessage');
  message.value = 'I can contribute to this project.';
  const event = { preventDefault() {}, currentTarget: h.ids.get('catalogInterestForm') };
  const first = h.api.submitInterest(event);
  assert.equal(h.ids.get('catalogInterestSubmit').disabled, true);
  assert.equal(h.ids.get('catalogWithdrawInterest').disabled, true);
  assert.equal(message.readOnly, true);
  await h.api.submitInterest(event);
  await h.api.withdrawInterest();
  assert.equal(writes.length, 1);
  pending.reject(new Error('offline'));
  await first;
  assert.equal(message.value, 'I can contribute to this project.');
  assert.equal(message.readOnly, false);
  assert.equal(h.ids.get('catalogInterestSubmit').disabled, false);
  const retry = h.api.submitInterest(event);
  pending.resolve(response({ interest: { status: 'new' } }));
  await retry;
  assert.equal(writes.length, 2, 'successful writes must not reload details');
  assert.equal(message.value, '');
  assert.equal(h.ids.get('catalogInterestStatus').textContent, 'catalog.interestSuccess');
  assert.equal(h.ids.get('catalogWithdrawInterest').hidden, false);
});

test('late interest success or failure cannot reopen a closed detail or overwrite another listing', async t => {
  for (const transition of ['close', 'another']) for (const outcome of ['success', 'failure']) {
    await t.test(`${transition}: ${outcome}`, async () => {
      let write;
      const reads = [];
      const h = catalogHarness((url, options = {}) => {
        if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
        if (options.method === 'PUT') { write = deferredResponse(); return write.promise; }
        reads.push(url);
        return Promise.resolve(response({ item: catalogItem('other') }));
      });
      await h.api.loadAuthState();
      h.api.renderDetail(catalogItem('item-1'));
      const pending = h.api.submitInterest({ preventDefault() {}, currentTarget: h.ids.get('catalogInterestForm') });
      if (transition === 'close') h.api.closeDetail();
      else {
        await h.api.selectDetail('other');
        h.ids.get('catalogInterestMessage').value = 'New listing draft';
      }
      const previous = h.ids.get('catalogInterestStatus').textContent;
      if (outcome === 'success') write.resolve(response({ interest: { status: 'new' } }));
      else write.reject(new Error('late error'));
      await pending;
      assert.equal(reads.length, transition === 'close' ? 0 : 1);
      assert.equal(h.ids.get('catalogInterestStatus').textContent, previous);
      if (transition === 'close') assert.equal(h.ids.get('catalogDetail').hidden, true);
      else {
        assert.equal(h.api.page.detailItem.id, 'other');
        assert.equal(h.ids.get('catalogInterestMessage').value, 'New listing draft');
        assert.equal(h.ids.get('catalogInterestSubmit').disabled, false);
      }
    });
  }
});

/* ---------------- Publishing desk ---------------- */

test('publishing desk links every editor, keeps the review queue and loads the translator first', () => {
  const html = adminPage();
  for (const id of ['news', 'catalog', 'interests']) assert.match(html, new RegExp(`<section class="admin-band" id="${id}"`), `${id} section`);
  for (const href of ['#news', '#catalog', 'fiiu-admin.html#content', 'teaching.html', '#interests']) {
    assert.match(html, new RegExp(`<li><a href="${href.replace('.', '\\.')}"><strong data-i18n="ops\\.index\\.`), `${href} desk link`);
  }
  assert.match(html, /<title data-i18n="ops\.pageTitle">NODAL · Publishing desk<\/title>/);
  assert.match(html, /<h1 data-i18n="ops\.title">Publishing desk<\/h1>/);
  for (const lang of ['en', 'es', 'pt']) assert.match(html, new RegExp(`class="lang-btn" data-lang="${lang}"`));
  // locale.js runs in the head before paint; i18n.js must precede admin.js so nodalI18n exists when the desk renders.
  const order = ['<script src="locale.js', '<script defer src="i18n.js', '<script defer src="admin.js'].map((tag) => html.indexOf(tag));
  assert.ok(order.every((position, index) => position > 0 && (index === 0 || position > order[index - 1])), `script order ${order}`);
  assert.match(html, /<link rel="stylesheet" href="locale\.css/);
  assert.doesNotMatch(html, /\sstyle="|<script>(?!<\/script>)/, 'CSP forbids inline styles and scripts');
  for (const id of ['adminNewsList', 'adminNewsTitle', 'adminNewsBody', 'adminNewsUrl', 'adminNewsPinned', 'adminNewsPublish', 'adminNewsDraft',
    'adminNewsDelete', 'adminNewsConflict', 'adminNewsConflictReload', 'adminNewsConflictOverwrite', 'adminGate', 'adminGateList', 'adminGateSummary']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} must be present`);
  }
  assert.match(html, /id="adminNewsTitle" maxlength="160"/);
  assert.match(html, /id="adminNewsBody" maxlength="2000"/);
  assert.match(html, /id="adminNewsUrl" type="url" inputmode="url" maxlength="500"/);
  // Status lines are written by admin.js; a data-i18n on them would be reset to "Loading…" on every language switch.
  for (const id of ['adminNewsListStatus', 'adminCatalogListStatus', 'adminInterestStatus', 'adminEditorStatus', 'adminNewsStatus', 'adminRecordState', 'adminNewsState']) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"[^>]*data-i18n=`), `${id} is runtime text`);
  }
});

test('publishing desk uses the NODAL ruled sheet: press-plate buttons, no cards, no thick left bars', () => {
  const css = adminStyles();
  for (const colour of ['#59bc53', '#addea8', '#3d5c38', '#f2ecec']) assert.match(css, new RegExp(colour, 'i'), `official colour ${colour}`);
  assert.match(css, /font-family:\s*Montserrat/);
  assert.match(css, /\.admin-button\s*\{[^}]*border-radius:\s*7px/);
  assert.match(css, /\.admin-button-accent\s*\{[^}]*box-shadow:\s*4px 4px 0 var\(--ink\)/);
  assert.doesNotMatch(css, /border-left:\s*(?:[3-9]|\d{2,})px/, 'no thick left accent bars');
  assert.doesNotMatch(css, /#cbe66f|#e76f51|#497f89/i, 'the old off-brand acid, coral and teal are gone');
  assert.doesNotMatch(css, /box-shadow:\s*7px 7px/, 'no floating card shadows');
  assert.match(css, /--f-sp-1:\s*4px[\s\S]*--f-sp-7:\s*clamp\(32px,\s*4vw,\s*60px\)[\s\S]*--f-fs-hint:\s*\.8125rem/, 'same density scale as fiiu.css');
  // No control below a 24px target and no body copy below the old 12.8px inputs.
  for (const match of css.matchAll(/min-height:\s*(\d+)px/g)) assert.ok(Number(match[1]) >= 24, `min-height ${match[1]}px`);
  assert.match(css, /input, select, textarea\s*\{[^}]*font-size:\s*(?:1rem|15px|\.9375rem)/);
});

test('publishing desk chrome switches to Spanish and Portuguese and every key resolves', () => {
  const html = adminPage();
  const nodes = [...html.matchAll(/<(\w+)[^>]*?data-i18n="([^"]+)"[^>]*>([^<]*)</g)].map(([, tag, key, value]) => {
    const node = new FakeNode(tag);
    node.dataset.i18n = key;
    node.textContent = value.replace(/&amp;/g, '&');
    return node;
  });
  const placeholders = [...html.matchAll(/placeholder="([^"]*)"[^>]*data-i18n-placeholder="([^"]+)"/g)].map(([, value, key]) => {
    const node = new FakeNode('input');
    node.dataset.i18nPlaceholder = key;
    node.setAttribute('placeholder', value);
    return node;
  });
  const api = deskI18n('en', [...nodes, ...placeholders]);
  const text = (key) => nodes.find((node) => node.dataset.i18n === key).textContent;
  api.apply('es');
  assert.equal(text('ops.title'), 'Mesa de publicación');
  assert.equal(text('ops.news.new'), 'Nueva publicación');
  assert.equal(text('ops.index.festival'), 'Noticias del festival');
  assert.equal(text('ops.kind.case_study'), 'Caso de estudio');
  assert.equal(placeholders[0].getAttribute('placeholder'), 'Título, organización, tema');
  api.apply('pt');
  assert.equal(text('ops.title'), 'Mesa de publicação');
  assert.equal(text('ops.index.courses'), 'Cursos');
  assert.equal(text('ops.news.fieldPinned'), 'Fixar no topo');
  api.apply('en');
  assert.equal(text('ops.title'), 'Publishing desk');

  // Every literal ops.* key admin.js asks for, plus the families it builds from record values.
  const literal = [...new Set([...adminScript().matchAll(/'(ops\.[\w.]+\.[\w]+)'/g)].map((match) => match[1]))];
  const families = [
    ...['opportunity', 'project', 'learning_circle', 'resource', 'case_study'].map((kind) => `ops.kind.${kind}`),
    ...['draft', 'published', 'archived'].map((status) => `ops.status.${status}`),
    'ops.visibility.public', 'ops.visibility.members', 'ops.lang.en', 'ops.lang.es', 'ops.lang.pt',
    ...['new', 'contacted', 'closed', 'withdrawn'].map((status) => `ops.interest.${status}`),
    ...['title', 'summary', 'body', 'cta', 'organization', 'sourceLabel', 'sourceUrl', 'sourceVerifiedAt', 'subtype', 'deadlineAt', 'actionUrl'].map((field) => `ops.field.${field}`),
  ];
  assert.ok(literal.length > 80, `expected the desk copy to be keyed, found ${literal.length}`);
  for (const lang of ['en', 'es', 'pt']) {
    const dictionary = deskI18n(lang);
    for (const key of [...literal, ...families]) assert.notEqual(dictionary.t(key), key, `${key} missing in ${lang}`);
  }
});

function newsItem(id, overrides = {}) {
  return { id, title: `Post ${id}`, body: 'Body', url: '', pinned: false, status: 'published', publishedAt: '2026-09-30T15:00:00.000Z', createdAt: '2026-09-30T14:00:00.000Z', updatedAt: '2026-09-30T15:00:00.000Z', version: 1, ...overrides };
}

test('desk lists NODAL news with pagination and creates a post idempotently with a client id', async () => {
  const requests = [];
  let failFirstPost = true;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url === '/api/admin/news') {
      if (options.method === 'POST') {
        if (failFirstPost) { failFirstPost = false; throw new TypeError('Failed to fetch'); }
        const body = JSON.parse(options.body);
        return response({ item: newsItem(body.id, { ...body, version: 1, publishedAt: '2026-10-01T12:00:00.000Z' }) }, { status: 201 });
      }
      return response({ items: [newsItem('n1', { pinned: true, version: 3 })], nextCursor: 'news-2' });
    }
    if (url === '/api/admin/news?cursor=news-2') return response({ items: [newsItem('n1'), newsItem('n2', { status: 'draft', publishedAt: null })], nextCursor: null });
    throw new Error(`unexpected request ${url}`);
  };
  const h = adminHarness(fetchImpl);
  h.api.fillNews(null);
  await h.api.loadNews();
  assert.equal(h.ids.get('adminNewsMore').hidden, false);
  assert.equal(h.ids.get('adminNewsListStatus').textContent, '1 post');
  await h.ids.get('adminNewsMore').listeners.get('click')();
  assert.deepEqual([...h.api.news.items.map((item) => item.id)], ['n1', 'n2'], 'a repeated id on the next page is not listed twice');
  assert.equal(h.ids.get('adminNewsMore').hidden, true);
  const rows = renderedText(h.ids.get('adminNewsList')).replace(/\s+/g, ' ');
  const sept30 = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date('2026-09-30T15:00:00.000Z'));
  assert.ok(rows.includes(`Post n1 Published Pinned ${sept30}`), rows);
  assert.match(rows, /Post n2 Draft/);
  for (const request of requests) assert.equal(request.options.credentials, 'same-origin');

  const set = (id, value) => { h.ids.get(id).value = value; };
  set('adminNewsTitle', '  Course closed  ');
  set('adminNewsBody', 'The first course is full.\nThe next one opens in November.');
  set('adminNewsUrl', 'https://nodal.example/courses');
  h.ids.get('adminNewsPinned').checked = true;
  assert.equal(await h.api.saveNews('published'), false);
  assert.equal(h.ids.get('adminNewsStatus').textContent, 'The post could not be saved. Your text is still here.');
  assert.equal(h.ids.get('adminNewsTitle').value, '  Course closed  ');
  assert.equal(await h.api.saveNews('published'), true);
  const posts = requests.filter((request) => request.options.method === 'POST');
  assert.equal(posts.length, 2);
  const [first, second] = posts.map((request) => JSON.parse(request.options.body));
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(second.id, first.id, 'a retry reuses the client id so the server can answer with the stored post');
  assert.deepEqual(second, { id: first.id, title: 'Course closed', body: 'The first course is full.\nThe next one opens in November.', url: 'https://nodal.example/courses', pinned: true, status: 'published' });
  assert.equal(posts[1].options.headers['Content-Type'], 'application/json');
  assert.equal(h.api.news.items[0].id, first.id, 'the new post leads the list');
  assert.equal(h.api.news.current.id, first.id);
  assert.equal(h.ids.get('adminNewsDelete').hidden, false);
  assert.equal(h.ids.get('adminNewsPublish').textContent, 'Save and keep published');
  assert.equal(h.ids.get('adminNewsDraft').textContent, 'Move to drafts');
  assert.equal(h.ids.get('adminNewsStatus').textContent, 'Published. Members see it now.');
  assert.equal(h.ids.get('adminNewsListStatus').textContent, '3 posts');

  h.api.fillNews(null);
  assert.notEqual(h.api.news.draftId, first.id, 'a new post gets a fresh client id');
});

test('a new post whose lost save reached the server is never reported as published from the stored draft', async () => {
  const requests = [];
  let reply;
  const h = adminHarness(async (url, options = {}) => {
    requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    return reply(url, options);
  });
  h.api.fillNews(null);
  const set = (id, value) => { h.ids.get(id).value = value; };
  set('adminNewsTitle', 'Old title');
  // The draft is stored, but its answer is lost (a 504 or a dropped connection after the write).
  reply = () => { throw new TypeError('Failed to fetch'); };
  assert.equal(await h.api.saveNews('draft'), false);
  const id = requests[0].body.id;
  const stored = newsItem(id, { title: 'Old title', status: 'draft', publishedAt: null, version: 1 });

  // An identical retry gets the stored row back: the message follows what is stored.
  reply = () => response({ item: stored });
  assert.equal(await h.api.saveNews('draft'), true);
  assert.equal(h.ids.get('adminNewsStatus').textContent, 'Saved as a draft. Members do not see it.');

  // The same lost save, then an edit and Publish: the server answers with the stored draft as a conflict.
  h.api.fillNews(null);
  set('adminNewsTitle', 'Old title');
  reply = () => { throw new TypeError('Failed to fetch'); };
  await h.api.saveNews('draft');
  const second = requests.at(-1).body.id;
  set('adminNewsTitle', 'New title');
  reply = () => response({ error: 'news item changed; reload before saving', code: 'version_conflict', item: { ...stored, id: second } }, { ok: false, status: 409 });
  assert.equal(await h.api.saveNews('published'), false);
  assert.equal(requests.at(-1).options.method, 'POST');
  assert.equal(requests.at(-1).body.id, second, 'the retry reuses the client id');
  assert.equal(h.ids.get('adminNewsConflict').hidden, false);
  assert.equal(h.ids.get('adminNewsConflictTitle').textContent, 'An earlier save of this post already reached NODAL.');
  assert.equal(h.ids.get('adminNewsConflictTitle').dataset.i18n, 'ops.news.earlierTitle', 'a language switch keeps this copy');
  assert.equal(h.ids.get('adminNewsConflictReload').textContent, 'Load the saved version');
  assert.equal(h.ids.get('adminNewsStatus').textContent, 'Not saved: an earlier save of this post is stored with other content.');
  assert.notEqual(h.ids.get('adminNewsStatus').textContent, 'Published. Members see it now.');
  assert.equal(h.ids.get('adminNewsTitle').value, 'New title', 'the edit is kept, not replaced by the stored title');

  // Saving over it edits the stored post at its version, and only a stored publication says Published.
  reply = (url, options) => response({ item: { ...stored, id: second, ...JSON.parse(options.body), publishedAt: '2026-10-01T12:00:00.000Z', version: 2 } });
  await h.ids.get('adminNewsConflictOverwrite').listeners.get('click')();
  assert.equal(requests.at(-1).options.method, 'PATCH');
  assert.equal(requests.at(-1).url, `/api/admin/news/${second}`);
  assert.deepEqual(requests.at(-1).body, { version: 1, title: 'New title', body: '', url: '', pinned: false, status: 'published' });
  assert.equal(h.ids.get('adminNewsStatus').textContent, 'Published. Members see it now.');
  assert.equal(h.api.news.current.version, 2);

  // A later edit conflict uses the ordinary copy again.
  reply = () => response({ code: 'version_conflict', item: { ...stored, id: second, version: 3, title: 'Theirs' } }, { ok: false, status: 409 });
  await h.api.saveNews('published');
  assert.equal(h.ids.get('adminNewsConflictTitle').textContent, 'Someone else changed this post.');
  assert.equal(h.ids.get('adminNewsStatus').textContent, 'Not saved: someone else changed this post.');
});

test('desk news states agree in gender in Spanish and Portuguese', () => {
  const expected = { es: ['Publicada · Fijada', 'Borrador'], pt: ['Publicada · Fixada', 'Rascunho'] };
  for (const lang of ['es', 'pt']) {
    const h = adminHarness(undefined, { lang });
    h.api.news.items = [newsItem('n1', { pinned: true }), newsItem('n2', { status: 'draft', publishedAt: null })];
    h.api.fillNews(h.api.news.items[0]);
    assert.ok(h.ids.get('adminNewsState').textContent.startsWith(expected[lang][0]), h.ids.get('adminNewsState').textContent);
    const rows = renderedText(h.ids.get('adminNewsList')).replace(/\s+/g, ' ');
    assert.match(rows, new RegExp(`Post n1 ${expected[lang][0].replace(' · ', ' ')}`), rows);
    assert.match(rows, new RegExp(`Post n2 ${expected[lang][1]}`), rows);
  }
});

test('desk validates news before writing and shows server field errors as sent', async () => {
  const requests = [];
  const h = adminHarness(async (url, options = {}) => {
    requests.push({ url, options });
    return response({ error: 'url must be at most 500 characters', field: 'url' }, { ok: false, status: 400 });
  });
  h.api.fillNews(null);
  assert.equal(await h.api.saveNews('draft'), false);
  assert.equal(h.ids.get('adminNewsTitleError').textContent, 'Write a title.');
  assert.equal(h.ids.get('adminNewsTitleError').hidden, false);
  assert.equal(h.ids.get('adminNewsTitle').focused, true);
  h.ids.get('adminNewsTitle').value = 'Title';
  for (const bad of ['http://plain.example', 'javascript:alert(1)', `https://x.example/${'a'.repeat(500)}`]) {
    h.ids.get('adminNewsUrl').value = bad;
    assert.equal(await h.api.saveNews('draft'), false);
    assert.equal(h.ids.get('adminNewsUrlError').textContent, 'Use a full https:// link of up to 500 characters, or leave it empty.');
  }
  h.ids.get('adminNewsBody').value = 'x'.repeat(2001);
  h.ids.get('adminNewsUrl').value = '';
  assert.equal(await h.api.saveNews('draft'), false);
  assert.equal(h.ids.get('adminNewsBodyError').textContent, 'Keep the text to 2000 characters.');
  assert.equal(h.ids.get('adminNewsUrlError').hidden, true);
  assert.equal(requests.length, 0, 'invalid posts never reach the server');

  h.ids.get('adminNewsBody').value = 'Fine';
  h.ids.get('adminNewsUrl').value = 'https://nodal.example/ok';
  assert.equal(await h.api.saveNews('draft'), false);
  assert.equal(requests.length, 1);
  assert.equal(h.ids.get('adminNewsUrlError').textContent, 'url must be at most 500 characters');
  assert.equal(h.ids.get('adminNewsUrlError').hidden, false);
  assert.equal(h.ids.get('adminNewsStatus').textContent, 'Check the highlighted fields.');
});

test('desk news edits send the version, survive conflicts and deletions elsewhere', async () => {
  const requests = [];
  let reply;
  const h = adminHarness(async (url, options = {}) => {
    requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    return reply(url, options);
  });
  h.api.news.items = [newsItem('n1', { version: 4, title: 'Original' })];
  h.api.fillNews(h.api.news.items[0]);
  h.ids.get('adminNewsTitle').value = 'Mine';

  reply = () => response({ code: 'version_conflict', item: newsItem('n1', { version: 5, title: 'Theirs' }) }, { ok: false, status: 409 });
  assert.equal(await h.api.saveNews('published'), false);
  assert.equal(requests[0].url, '/api/admin/news/n1');
  assert.equal(requests[0].options.method, 'PATCH');
  assert.deepEqual(requests[0].body, { version: 4, title: 'Mine', body: 'Body', url: '', pinned: false, status: 'published' });
  assert.equal(h.ids.get('adminNewsConflict').hidden, false);
  assert.equal(h.ids.get('adminNewsTitle').value, 'Mine', 'a conflict keeps the editor text');
  assert.equal(h.ids.get('adminNewsStatus').textContent, 'Not saved: someone else changed this post.');

  reply = (url, options) => response({ item: newsItem('n1', { ...JSON.parse(options.body), version: 6 }) });
  await h.ids.get('adminNewsConflictOverwrite').listeners.get('click')();
  assert.equal(requests[1].body.version, 5, 'overwriting uses the version the server reported');
  assert.equal(requests[1].body.status, 'published');
  assert.equal(h.ids.get('adminNewsConflict').hidden, true);
  assert.equal(h.api.news.current.version, 6);
  assert.equal(h.api.news.items[0].title, 'Mine');

  h.ids.get('adminNewsTitle').value = 'Mine again';
  reply = () => response({ code: 'version_conflict', item: newsItem('n1', { version: 7, title: 'Theirs again' }) }, { ok: false, status: 409 });
  await h.api.saveNews('draft');
  h.ids.get('adminNewsConflictReload').listeners.get('click')();
  assert.equal(h.ids.get('adminNewsTitle').value, 'Theirs again');
  assert.equal(h.api.news.current.version, 7);
  assert.equal(h.ids.get('adminNewsConflict').hidden, true);

  h.ids.get('adminNewsTitle').value = 'Rescued';
  reply = () => response({ error: 'not found' }, { ok: false, status: 404 });
  assert.equal(await h.api.saveNews('draft'), false);
  assert.equal(h.api.news.current, null);
  assert.equal(h.api.news.items.length, 0);
  assert.equal(h.ids.get('adminNewsTitle').value, 'Rescued', 'the text survives a deletion elsewhere');
  assert.equal(h.ids.get('adminNewsDelete').hidden, true);
  reply = (url, options) => response({ item: newsItem(JSON.parse(options.body).id, { title: 'Rescued', status: 'draft' }) }, { status: 201 });
  await h.api.saveNews('draft');
  assert.equal(requests.at(-1).options.method, 'POST');
  assert.equal(requests.at(-1).url, '/api/admin/news');
});

test('desk deletes a news post only after confirmation and guards unsaved edits', async () => {
  const requests = [];
  let answer = false;
  const h = adminHarness(async (url, options = {}) => {
    requests.push({ url, options });
    return { ok: true, status: 204, async json() { throw new SyntaxError('no body'); } };
  }, { confirm: () => answer });
  h.api.news.items = [newsItem('n1', { title: 'Old news' }), newsItem('n2')];
  h.api.fillNews(h.api.news.items[0]);

  assert.equal(await h.api.deleteNews(), false);
  assert.equal(requests.length, 0, 'a cancelled confirmation sends nothing');
  assert.match(h.confirms[0], /Delete “Old news”\?/);

  // Switching posts with unsaved text asks first.
  h.ids.get('adminNewsBody').value = 'Unsaved change';
  const rowButton = (index) => h.ids.get('adminNewsList').children[index].children[0];
  rowButton(1).listeners.get('click')();
  assert.equal(h.api.news.current.id, 'n1', 'declining keeps the unsaved edit');
  answer = true;
  rowButton(1).listeners.get('click')();
  assert.equal(h.api.news.current.id, 'n2');
  h.api.fillNews(h.api.news.items[0]);

  assert.equal(await h.api.deleteNews(), true);
  assert.equal(requests[0].url, '/api/admin/news/n1');
  assert.equal(requests[0].options.method, 'DELETE');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.deepEqual([...h.api.news.items.map((item) => item.id)], ['n2']);
  assert.equal(h.api.news.current, null);
  assert.equal(h.ids.get('adminNewsTitle').value, '');
  assert.equal(h.ids.get('adminNewsStatus').textContent, 'Post deleted.');
});

test('catalog editor lists what is still missing before publishing, in the reader language', () => {
  const h = adminHarness();
  h.api.fillEditor(null);
  const set = (id, value) => { h.ids.get(id).value = value; };
  const rows = () => [...h.ids.get('adminGateList').children.map((row) => renderedText(row).trim().replace(/\s+/g, ' '))];
  assert.equal(h.api.renderGate(), 16);
  assert.equal(h.ids.get('adminGateSummary').textContent, '16 fields missing before publishing');
  for (const lang of ['En', 'Es', 'Pt']) for (const field of ['Title', 'Summary', 'Body', 'Cta']) set(`admin${field}${lang}`, `${field} ${lang}`);
  set('adminSummaryEs', '');
  set('adminCtaPt', '  ');
  set('adminOrganization', 'NODAL');
  set('adminSourceLabel', 'Official page');
  set('adminSourceUrl', 'http://insecure.example');
  set('adminKind', 'opportunity');
  set('adminActionMode', 'external');
  h.api.renderGate();
  assert.deepEqual(rows(), [
    'English Complete',
    'Spanish Missing: Summary',
    'Portuguese Missing: CTA label',
    'Record Missing: Verified source URL, Verified on, Opportunity subtype, Deadline, External action URL',
  ]);
  assert.equal(h.api.publicationGaps().record.length, 5);
  set('adminSummaryEs', 'Resumen');
  set('adminCtaPt', 'Inscrever');
  set('adminSourceUrl', 'https://official.example');
  set('adminSourceVerifiedAt', '2026-09-30');
  set('adminSubtype', 'grant');
  set('adminDeadlineAt', '2026-10-30T18:00');
  set('adminActionUrl', 'https://official.example/apply');
  assert.equal(h.api.renderGate(), 0);
  assert.equal(h.ids.get('adminGateSummary').textContent, 'Ready to publish');
  assert.equal(h.ids.get('adminGateSummary').className, 'admin-gate-summary is-ready');

  set('adminSourceVerifiedAt', '');
  h.i18n.apply('es');
  assert.equal(h.ids.get('adminGateSummary').textContent, 'Falta 1 campo para publicar');
  assert.match(rows().at(-1), /^Registro Falta: Verificada el$/);
  h.i18n.apply('pt');
  assert.equal(rows()[0], 'Inglês Completo');
});

test('desk runtime copy follows the language switch, including status lines and record rows', async () => {
  const h = adminHarness(async (url) => {
    if (url.startsWith('/api/admin/catalog?')) return response({ items: [{ id: 'record-1', kind: 'learning_circle', status: 'draft', visibility: 'members', featured: true, translations: { es: { title: 'Círculo' } } }], nextCursor: null });
    throw new Error(`unexpected request ${url}`);
  }, { lang: 'es' });
  await h.api.loadCatalog();
  assert.equal(h.ids.get('adminCatalogListStatus').textContent, '1 registro cargado.');
  const listText = () => renderedText(h.ids.get('adminCatalogList')).replace(/\s+/g, ' ');
  assert.match(listText(), /Círculo Sin organización ni lugar Círculo de aprendizaje Borrador Miembros Destacado/);
  h.i18n.apply('pt');
  assert.equal(h.ids.get('adminCatalogListStatus').textContent, '1 registro carregado.');
  assert.match(listText(), /Círculo de aprendizagem Rascunho Membros Destaque/);
  h.api.fillEditor({ id: 'record-1', version: 2, status: 'published', translations: {} });
  assert.equal(h.ids.get('adminRecordState').textContent, 'Publicado · record-1');
  h.i18n.apply('en');
  assert.equal(h.ids.get('adminRecordState').textContent, 'Published · record-1');
  assert.equal(h.ids.get('adminEditorStatus').textContent, 'Record loaded. Edits are not saved until you choose an action.');
});
