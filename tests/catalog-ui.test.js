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

function catalogHarness(fetchImpl) {
  const ids = new Map();
  for (const id of [
    'catalogDetail', 'catalogDetailStatus', 'catalogDetailKind', 'detailTitle',
    'catalogDetailSummary', 'catalogDetailBody', 'catalogDetailMeta',
    'catalogDetailActions', 'catalogInterestForm', 'catalogInterestDisclosure',
    'catalogWithdrawInterest', 'catalogInterestSubmit', 'catalogInterestMessage', 'catalogInterestStatus',
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
    `\nwindow.__catalogTest = { renderDispatch, renderDetail, selectDetail, closeDetail, runFilters, submitInterest, withdrawInterest, loadMyInterests, page, setAuthenticated(value) { authenticated = value; } };\n})();`,
  );
  vm.runInNewContext(instrumented, context, { filename: 'catalog.js' });
  context.window.__catalogTest.setAuthenticated(true);
  return { api: context.window.__catalogTest, ids, i18nState };
}

function adminHarness(fetchImpl = () => Promise.reject(new Error('network must not run in the editor unit test'))) {
  const ids = new Map([...adminPage().matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], new FakeNode(match[1])]));
  const document = {
    getElementById: (id) => ids.get(id) ?? null,
    createElement: (tag) => new FakeNode(tag),
  };
  const context = {
    AbortController,
    Date,
    URL,
    URLSearchParams,
    clearTimeout,
    document,
    encodeURIComponent,
    fetch: fetchImpl,
    location: { assigned: '', assign(value) { this.assigned = value; } },
    matchMedia: () => ({ matches: true }),
    setTimeout,
  };
  context.window = context;
  const source = adminScript();
  const instrumented = source.replace(
    /\n  bootstrap\(\);\s*\n\}\)\(\);\s*$/,
    `\n  window.__adminTest = { serializeEditor, validateEditorTopics, renderPreview, saveCatalog, loadCatalog, loadInterests, renderInterest, showCatalogConflict, state, conflict: () => state.conflictCurrent };\n})();`,
  );
  assert.notEqual(instrumented, source, 'admin test hook must replace bootstrap without changing production source');
  vm.runInNewContext(instrumented, context, { filename: 'admin.js' });
  return { api: context.window.__adminTest, ids, location: context.location };
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

test('landing restores the live recommendation deck as an honest translated state', () => {
  const html = index();
  assert.match(html, /id="matchStack"/);
  assert.match(html, /class="match-card/);
  assert.match(html, /data-i18n="recs\.loading\.title"/);
  assert.match(html, /<script[^>]+src="recs\.js/);
  const deck = html.match(/<div[^>]+id="matchStack"[\s\S]*?<\/article>\s*<\/div>/)?.[0] || '';
  assert.match(deck, /class="match-name"[^>]*>Finding live matches</);
  assert.doesNotMatch(deck, /data-user|member-id|@[\w.-]+|Urban (?:planner|leader)|member since/i, 'static loading UI must not pose as a member record');
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

test('catalog page exposes the complete public and member workflow', () => {
  const html = catalogPage();
  for (const kind of ['opportunity', 'project', 'learning_circle', 'resource', 'case_study']) {
    assert.match(html, new RegExp(`value="${kind}"`), `${kind} filter is missing`);
  }
  for (const id of [
    'catalogForm', 'catalogQuery', 'catalogTopic', 'catalogLocation', 'catalogState',
    'catalogResults', 'catalogStatus', 'catalogDetail', 'catalogDetailStatus',
    'catalogInterestForm', 'catalogInterestMessage', 'catalogInterestDisclosure',
    'catalogInterestSubmit', 'catalogMyInterests', 'catalogMyInterestsStatus',
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
});

test('admin client serializes translations atomically and preserves edits on stale versions', () => {
  const source = adminScript();
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(source, /credentials:\s*'same-origin'/);
  assert.match(source, /\/api\/admin\/catalog/);
  assert.match(source, /\/api\/admin\/interests/);
  assert.match(source, /status\s*===\s*409/);
  assert.match(source, /new URLSearchParams/);
  assert.doesNotMatch(source, /method:\s*'DELETE'/);

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
