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
  scrollIntoView() {}
  getBoundingClientRect() { return {}; }
}

const response = (payload, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  async json() { return payload; },
});

function deferredResponse(signal) {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  signal?.addEventListener('abort', () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    reject(error);
  }, { once: true });
  return { promise, resolve, reject };
}

function catalogHarness(fetchImpl) {
  const ids = new Map();
  for (const id of [
    'catalogDetail', 'catalogDetailStatus', 'catalogDetailKind', 'detailTitle',
    'catalogDetailSummary', 'catalogDetailBody', 'catalogDetailMeta',
    'catalogDetailActions', 'catalogInterestForm', 'catalogInterestDisclosure',
    'catalogWithdrawInterest', 'catalogInterestMessage', 'catalogInterestStatus',
    'catalogMyInterests', 'catalogMyInterestsStatus', 'catalogMyInterestsList',
  ]) ids.set(id, new FakeNode(id));
  ids.get('catalogDetail').hidden = true;
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
    Intl,
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
  context.window.location = { pathname: '/opportunities.html', search: '', hash: '', assign() {} };
  context.window.nodalI18n = i18nState;

  const instrumented = catalogScript().replace(
    /\n\}\)\(\);\s*$/,
    `\nwindow.__catalogTest = { selectDetail, closeDetail, runFilters, submitInterest, withdrawInterest, loadMyInterests, page, setAuthenticated(value) { authenticated = value; } };\n})();`,
  );
  vm.runInNewContext(instrumented, context, { filename: 'catalog.js' });
  context.window.__catalogTest.setAuthenticated(true);
  return { api: context.window.__catalogTest, ids, i18nState };
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
  const start = source.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `${name} dictionary is missing`);
  let depth = 0;
  let end = start;
  for (let cursor = source.indexOf('{', start); cursor < source.length; cursor += 1) {
    if (source[cursor] === '{') depth += 1;
    if (source[cursor] === '}') depth -= 1;
    if (depth === 0) { end = cursor; break; }
  }
  return new Set([...source.slice(start, end + 1).matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1]));
}

test('landing leads with the approved promise and evidence-first section order', () => {
  const html = index();
  assert.match(html, />Find the people and opportunities to turn urban knowledge into action\.</);

  const order = [...html.matchAll(/data-landing-section="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ['hero', 'actions', 'open-work', 'cases', 'problem', 'how', 'membership', 'final-cta']);

  const source = i18n();
  assert.match(source, /'hero\.promise': 'Encuentra a las personas y las oportunidades para convertir el conocimiento urbano en acción\.'/);
  assert.match(source, /'hero\.promise': 'Encontre as pessoas e as oportunidades para transformar o conhecimento urbano em ação\.'/);
});

test('landing proof regions are API targets and fabricated social proof is absent', () => {
  const html = index();
  for (const id of ['landingOpenWork', 'landingOpenWorkStatus', 'landingCases', 'landingCasesStatus']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} must be present`);
  }
  assert.doesNotMatch(html, /class="leader-card|class="quote|active nodes|nodos activos|nós ativos/i);
  assert.doesNotMatch(html.replace(/<[^>]*>/g, ''), /[“”«»][^\n]{12,}[“”«»]/);

  const graph = html.match(/<div class="gc-pool"[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/)?.[0] ?? '';
  assert.ok(graph, 'illustrative graph role descriptions must remain');
  assert.match(html, /data-i18n="graph\.illustrative"/);
  assert.doesNotMatch(graph, /\b\d+\b|gc-ask/);

  const translations = i18n();
  assert.doesNotMatch(translations, /active nodes|nodos activos|nós ativos|quote\.|graph\.n\.[\w]+\.ask/);
});

test('catalog page exposes the complete public and member workflow', () => {
  const html = catalogPage();
  for (const kind of ['opportunity', 'project', 'learning_circle', 'resource', 'case_study']) {
    assert.match(html, new RegExp(`value="${kind}"`), `${kind} filter is missing`);
  }
  for (const id of [
    'catalogForm', 'catalogQuery', 'catalogTopic', 'catalogLocation', 'catalogState',
    'catalogResults', 'catalogStatus', 'catalogDetail', 'catalogDetailStatus',
    'catalogInterestForm', 'catalogInterestMessage', 'catalogInterestDisclosure',
    'catalogMyInterests', 'catalogMyInterestsStatus',
  ]) assert.match(html, new RegExp(`id="${id}"`), `${id} must be present`);
  assert.match(html, /<option value="open"/);
  assert.match(html, /<option value="all"/);
  assert.doesNotMatch(html, /src="script\.js/);
  for (const key of ['nav.mainLabel', 'nav.accountLabel', 'nav.languageLabel', 'nav.menuLabel']) {
    assert.match(html, new RegExp(`data-i18n-aria-label="${key.replace('.', '\\.')}"`));
  }
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
  const context = { document, requestAnimationFrame() {}, setTimeout() {} };
  assert.doesNotThrow(() => vm.runInNewContext(read('web', 'scripts', 'script.js'), context));
  let prevented = false;
  brand.listeners.get('click')({ currentTarget: brand, preventDefault() { prevented = true; } });
  assert.equal(prevented, false, 'a brand link to index.html must navigate normally');
});

test('closing a detail and changing filters abort stale detail responses', async () => {
  const requests = [];
  const harness = catalogHarness((url, options = {}) => {
    if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
    const pending = deferredResponse(options.signal);
    requests.push(pending);
    return pending.promise;
  });

  const closing = harness.api.selectDetail('item-1');
  harness.api.closeDetail();
  requests[0].resolve(response({ item: catalogItem() }));
  await closing;
  assert.equal(harness.ids.get('catalogDetail').hidden, true);

  const filtering = harness.api.selectDetail('item-2');
  harness.api.runFilters();
  requests[1].resolve(response({ item: catalogItem('item-2') }));
  await filtering;
  assert.equal(harness.ids.get('catalogDetail').hidden, true);
});

test('My interests language refetch aborts the older language render', async () => {
  let english;
  const harness = catalogHarness((url, options = {}) => {
    if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
    if (url.includes('/api/me/catalog-interests?lang=en')) {
      english = deferredResponse(options.signal);
      return english.promise;
    }
    if (url.includes('/api/me/catalog-interests?lang=pt')) {
      return Promise.resolve(response({ interests: [{ itemId: 'pt', status: 'new', message: '' }] }));
    }
    if (url.includes('/api/catalog/pt?lang=pt')) {
      return Promise.resolve(response({ item: catalogItem('pt', { title: 'Português' }) }));
    }
    if (url.includes('/api/catalog/en?lang=en')) {
      return Promise.resolve(response({ item: catalogItem('en', { title: 'English' }) }));
    }
    throw new Error(`unexpected request ${url}`);
  });

  const oldRender = harness.api.loadMyInterests();
  harness.i18nState.lang = 'pt';
  const currentRender = harness.api.loadMyInterests();
  await currentRender;
  english.resolve(response({ interests: [{ itemId: 'en', status: 'new', message: '' }] }));
  await oldRender;

  const titles = harness.ids.get('catalogMyInterestsList').children
    .map((article) => article.children.find((node) => node.id === 'h3')?.textContent)
    .filter(Boolean);
  assert.deepEqual(titles, ['Português']);
  assert.equal(harness.ids.get('catalogMyInterestsStatus').textContent, '');
});

test('interest writes report transport failures and preserve successful feedback', async (t) => {
  await t.test('PUT rejection becomes an honest error', async () => {
    const harness = catalogHarness((url) => {
      if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
      return Promise.reject(new Error('offline'));
    });
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
    await assert.doesNotReject(harness.api.withdrawInterest());
    assert.equal(harness.ids.get('catalogInterestStatus').textContent, 'catalog.interestError');
  });

  await t.test('PUT success remains explicit after the detail refresh', async () => {
    const harness = catalogHarness((url, options = {}) => {
      if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
      if (options.method === 'PUT') return Promise.resolve(response({ interest: { status: 'new' } }));
      return Promise.resolve(response({ item: catalogItem('item-1', { interestStatus: 'new' }) }));
    });
    await harness.api.submitInterest({ preventDefault() {}, currentTarget: harness.ids.get('catalogInterestForm') });
    assert.equal(harness.ids.get('catalogInterestStatus').textContent, 'catalog.interestSuccess');
  });

  await t.test('DELETE success remains explicit after the detail refresh', async () => {
    const harness = catalogHarness((url, options = {}) => {
      if (url === '/api/auth/state') return Promise.resolve(response({ authenticated: true }));
      if (options.method === 'DELETE') return Promise.resolve(response({ interest: { status: 'withdrawn' } }));
      return Promise.resolve(response({ item: catalogItem('item-1', { interestStatus: 'withdrawn' }) }));
    });
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

test('every catalog client target exists on a page that loads it', () => {
  const pages = [index(), catalogPage()];
  assert.ok(pages.every((html) => /<script[^>]+src="catalog\.js/.test(html)));
  const ids = new Set(pages.flatMap((html) => [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])));
  const references = new Set([
    ...catalogScript().matchAll(/getElementById\(\s*'([^']+)'/g),
  ].map((match) => match[1]));
  for (const id of references) assert.ok(ids.has(id), `catalog.js target #${id} is absent`);
});

test('catalog dynamic and visible states resolve in EN, ES, and PT', () => {
  const source = i18n();
  const english = dictionaryKeys(source, 'DASH_EN');
  const spanish = new Set([...dictionaryKeys(source, 'ES'), ...dictionaryKeys(source, 'DASH_ES')]);
  const portuguese = new Set([...dictionaryKeys(source, 'PT'), ...dictionaryKeys(source, 'DASH_PT')]);
  for (const html of [index(), catalogPage()]) {
    for (const match of html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) english.add(match[1]);
  }
  const used = new Set([...catalogScript().matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1]));
  const requiredStates = [
    'catalog.loading', 'catalog.empty', 'catalog.error', 'catalog.detailLoading',
    'catalog.detailUnavailable', 'catalog.closed', 'catalog.sourceVerified',
    'catalog.externalAction', 'catalog.interestDisclosure', 'catalog.interestSuccess',
    'catalog.interestWithdrawn', 'catalog.interestsEmpty', 'catalog.interestsError',
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
