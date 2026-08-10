/* Public catalog client. API records are rendered only with explicit DOM
   creation and textContent; an unavailable or empty service stays honest. */
(() => {
  'use strict';

  const I18N = window.nodalI18n;
  const t = (key, vars) => I18N?.t(key, vars) ?? key;
  const byId = (id) => document.getElementById(id);
  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const clear = (node) => node?.replaceChildren();
  const jsonRequest = (url, options = {}) => fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    ...options,
  });
  const kindKey = (kind) => `catalog.kind.${kind}`;
  const statusKey = (status) => `catalog.status.${status}`;

  function safeHttps(value) {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' ? parsed.href : '';
    } catch { return ''; }
  }

  function safeLocalNext() {
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/opportunities.html';
  }

  function redirectToLogin() {
    window.location.assign(`/login.html?next=${encodeURIComponent(safeLocalNext())}`);
  }

  function dateText(value) {
    if (!value) return t('catalog.noDeadline');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('catalog.noDeadline');
    return new Intl.DateTimeFormat(I18N?.lang || 'en', { dateStyle: 'medium' }).format(date);
  }

  function addMeta(container, label, value) {
    if (!value) return;
    const item = create('span', 'dispatch-meta-item');
    item.append(create('strong', '', label), document.createTextNode(` ${value}`));
    container.append(item);
  }

  function officialAnchor(item, compact = false) {
    const href = safeHttps(item.actionUrl || item.sourceUrl);
    if (!href) return null;
    const anchor = create('a', compact ? 'dispatch-action' : 'btn btn-primary', item.cta || t('catalog.externalAction'));
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.setAttribute('aria-label', `${item.cta || t('catalog.externalAction')} · ${t('catalog.opensNewTab')}`);
    return anchor;
  }

  function renderDispatch(item, onSelect) {
    const row = create('article', `dispatch-row${item.isClosed ? ' is-closed' : ''}`);
    const rail = create('div', 'dispatch-rail');
    rail.append(create('span', 'dispatch-state', t(item.isClosed ? 'catalog.closed' : 'catalog.open')),
      create('span', 'dispatch-deadline', dateText(item.deadlineAt || item.endDate)));

    const main = create('div', 'dispatch-main');
    const kind = create('p', 'dispatch-kind', t(kindKey(item.kind)));
    const title = create('h3', 'dispatch-title');
    if (onSelect) {
      const button = create('button', 'dispatch-title-button', item.title);
      button.type = 'button';
      button.addEventListener('click', () => onSelect(item.id));
      title.append(button);
    } else title.textContent = item.title;
    main.append(kind, title, create('p', 'dispatch-summary', item.summary || ''));
    const meta = create('div', 'dispatch-meta');
    addMeta(meta, t('catalog.organization'), item.organization);
    addMeta(meta, t('catalog.location'), item.location);
    main.append(meta);

    const source = create('div', 'dispatch-source');
    source.append(create('span', 'source-stamp', t('catalog.sourceVerified')),
      create('span', 'source-date', dateText(item.sourceVerifiedAt)));
    const action = item.actionMode === 'external' ? officialAnchor(item, true) : null;
    if (action && !item.isClosed) source.append(action);
    if (onSelect) {
      const details = create('button', 'dispatch-details', t('catalog.viewDetails'));
      details.type = 'button';
      details.addEventListener('click', () => onSelect(item.id));
      source.append(details);
    }
    row.append(rail, main, source);
    return row;
  }

  function renderCase(item, onSelect) {
    const article = create('article', 'case-record');
    article.append(create('p', 'dispatch-kind', t(kindKey(item.kind))), create('h3', '', item.title),
      create('p', '', item.summary || ''));
    const meta = create('div', 'dispatch-meta');
    addMeta(meta, t('catalog.organization'), item.organization);
    addMeta(meta, t('catalog.location'), item.location);
    article.append(meta, create('span', 'source-stamp', t('catalog.sourceVerified')));
    if (onSelect) {
      const button = create('button', 'catalog-text-button', t('catalog.viewDetails'));
      button.type = 'button';
      button.addEventListener('click', () => onSelect(item.id));
      article.append(button);
    } else {
      const link = create('a', 'catalog-text-link', t('catalog.viewDetails'));
      link.href = `opportunities.html?id=${encodeURIComponent(item.id)}`;
      article.append(link);
    }
    return article;
  }

  let landingController;
  async function loadLandingRegion({ container, status, params, emptyKey, cases = false }) {
    if (!container || !status) return;
    status.textContent = t(cases ? 'catalog.loadingCases' : 'catalog.loading');
    container.setAttribute('aria-busy', 'true');
    try {
      const response = await jsonRequest(`/api/catalog?${params}`,
        { signal: landingController.signal });
      if (!response.ok) throw new Error('catalog read failed');
      const payload = await response.json();
      clear(container);
      payload.items.forEach((item) => container.append(cases ? renderCase(item) : renderDispatch(item)));
      status.textContent = payload.items.length ? '' : t(emptyKey);
    } catch (error) {
      if (error.name !== 'AbortError') {
        clear(container);
        status.textContent = t(cases ? 'catalog.casesError' : 'catalog.error');
      }
    } finally { container.setAttribute('aria-busy', 'false'); }
  }

  async function loadLanding() {
    const open = byId('landingOpenWork');
    const cases = byId('landingCases');
    if (!open && !cases) return;
    landingController?.abort();
    landingController = new AbortController();
    const lang = encodeURIComponent(I18N?.lang || 'en');
    await Promise.all([
      loadLandingRegion({ container: open, status: byId('landingOpenWorkStatus'), params: `lang=${lang}&kind=opportunity%2Cproject%2Clearning_circle%2Cresource&featured=true&state=open&limit=4`, emptyKey: 'catalog.empty' }),
      loadLandingRegion({ container: cases, status: byId('landingCasesStatus'), params: `lang=${lang}&kind=case_study&state=all&limit=3`, emptyKey: 'catalog.casesEmpty', cases: true }),
    ]);
  }

  let authenticated = false;
  async function loadAuthState() {
    try {
      const response = await jsonRequest('/api/auth/state');
      authenticated = response.ok && Boolean((await response.json()).authenticated);
    } catch { authenticated = false; }
    const primary = byId('heroPrimary');
    const secondary = byId('heroSecondary');
    if (primary && secondary && authenticated) {
      primary.href = 'opportunities.html?view=interests';
      primary.textContent = t('catalog.myInterests');
      secondary.href = 'opportunities.html';
      secondary.textContent = t('hero.browse');
    }
    const toggle = byId('catalogMyInterestsToggle');
    if (toggle) toggle.hidden = !authenticated;
  }

  const page = {
    form: byId('catalogForm'), results: byId('catalogResults'), status: byId('catalogStatus'),
    detail: byId('catalogDetail'), detailStatus: byId('catalogDetailStatus'),
    more: byId('catalogMore'), selectedId: null, nextCursor: null,
    listController: null, detailController: null, debounce: null,
  };

  function filterParams({ cursor = false } = {}) {
    const params = new URLSearchParams();
    params.set('lang', I18N?.lang || 'en');
    if (!page.form) return params;
    const kinds = [...page.form.querySelectorAll('input[name="kind"]:checked')].map((input) => input.value);
    if (kinds.length) params.set('kind', kinds.join(','));
    for (const [name, id] of [['q', 'catalogQuery'], ['topic', 'catalogTopic'], ['location', 'catalogLocation']]) {
      const value = byId(id)?.value.trim();
      if (value) params.set(name, value);
    }
    params.set('state', byId('catalogState')?.value === 'all' ? 'all' : 'open');
    params.set('limit', '12');
    if (cursor && page.nextCursor) params.set('cursor', page.nextCursor);
    return params;
  }

  function updateBrowserQuery() {
    const params = filterParams();
    params.delete('lang');
    params.delete('limit');
    if (page.selectedId) params.set('id', page.selectedId);
    const query = params.toString();
    history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }

  function readBrowserQuery() {
    if (!page.form) return;
    const params = new URLSearchParams(window.location.search);
    const kinds = new Set((params.get('kind') || '').split(',').filter(Boolean));
    page.form.querySelectorAll('input[name="kind"]').forEach((input) => { input.checked = kinds.has(input.value); });
    byId('catalogQuery').value = params.get('q') || '';
    byId('catalogTopic').value = params.get('topic') || '';
    byId('catalogLocation').value = params.get('location') || '';
    byId('catalogState').value = params.get('state') === 'all' ? 'all' : 'open';
    page.selectedId = params.get('id');
  }

  async function loadResults({ append = false } = {}) {
    if (!page.form || !page.results || !page.status) return;
    page.listController?.abort();
    page.listController = new AbortController();
    page.status.textContent = t('catalog.loading');
    page.results.setAttribute('aria-busy', 'true');
    try {
      const response = await jsonRequest(`/api/catalog?${filterParams({ cursor: append })}`, { signal: page.listController.signal });
      if (!response.ok) throw new Error('catalog read failed');
      const payload = await response.json();
      if (!append) clear(page.results);
      payload.items.forEach((item) => page.results.append(renderDispatch(item, selectDetail)));
      page.nextCursor = payload.nextCursor;
      page.more.hidden = !page.nextCursor;
      page.status.textContent = page.results.children.length ? t('catalog.resultsReady', { n: page.results.children.length }) : t('catalog.empty');
    } catch (error) {
      if (error.name !== 'AbortError') {
        if (!append) clear(page.results);
        page.status.textContent = t('catalog.error');
      }
    } finally { page.results.setAttribute('aria-busy', 'false'); }
  }

  function detailMeta(item) {
    const box = byId('catalogDetailMeta');
    clear(box);
    addMeta(box, t('catalog.organization'), item.organization);
    addMeta(box, t('catalog.location'), item.location);
    addMeta(box, t('catalog.deadline'), dateText(item.deadlineAt || item.endDate));
    if (item.topics?.length) addMeta(box, t('catalog.topics'), item.topics.join(' · '));
    box.append(create('span', 'source-stamp', t('catalog.sourceVerified')));
  }

  function renderDetail(item) {
    byId('catalogDetailKind').textContent = t(kindKey(item.kind));
    byId('detailTitle').textContent = item.title;
    byId('catalogDetailSummary').textContent = item.summary || '';
    byId('catalogDetailBody').textContent = item.body || '';
    detailMeta(item);
    const actions = byId('catalogDetailActions');
    clear(actions);
    const sourceHref = safeHttps(item.sourceUrl);
    if (sourceHref) {
      const source = create('a', 'catalog-text-link', t('catalog.openSource'));
      source.href = sourceHref; source.target = '_blank'; source.rel = 'noopener noreferrer';
      actions.append(source);
    }
    const official = item.actionMode === 'external' && !item.isClosed ? officialAnchor(item) : null;
    if (official) actions.append(official);

    const form = byId('catalogInterestForm');
    const disclosure = byId('catalogInterestDisclosure');
    const withdraw = byId('catalogWithdrawInterest');
    const canInterest = item.actionMode === 'interest' && !item.isClosed;
    form.hidden = !canInterest && item.interestStatus !== 'new' && item.interestStatus !== 'contacted';
    disclosure.hidden = !canInterest;
    withdraw.hidden = !['new', 'contacted'].includes(item.interestStatus);
    form.dataset.itemId = item.id;
    byId('catalogInterestMessage').value = '';
    byId('catalogInterestStatus').textContent = item.interestStatus ? t(statusKey(item.interestStatus)) : (item.isClosed ? t('catalog.closed') : '');
    page.detail.hidden = false;
    page.detailStatus.textContent = '';
  }

  async function selectDetail(id) {
    if (!page.detail || !page.detailStatus) return;
    page.selectedId = id;
    updateBrowserQuery();
    page.detailController?.abort();
    page.detailController = new AbortController();
    page.detail.hidden = true;
    page.detailStatus.textContent = t('catalog.detailLoading');
    try {
      const response = await jsonRequest(`/api/catalog/${encodeURIComponent(id)}?lang=${encodeURIComponent(I18N?.lang || 'en')}`, { signal: page.detailController.signal });
      if (!response.ok) throw new Error('detail unavailable');
      renderDetail((await response.json()).item);
      page.detail.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    } catch (error) {
      if (error.name !== 'AbortError') page.detailStatus.textContent = t('catalog.detailUnavailable');
    }
  }

  function closeDetail() {
    page.selectedId = null;
    page.detail.hidden = true;
    page.detailStatus.textContent = t('catalog.selectDetail');
    updateBrowserQuery();
  }

  async function submitInterest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const itemId = form.dataset.itemId;
    const message = byId('catalogInterestMessage').value.trim();
    const status = byId('catalogInterestStatus');
    if (!authenticated) { redirectToLogin(); return; }
    status.textContent = t('catalog.interestSending');
    const response = await jsonRequest(`/api/catalog/${encodeURIComponent(itemId)}/interest`, { method: 'PUT', body: JSON.stringify({ message }) });
    if (response.status === 401) { redirectToLogin(); return; }
    if (!response.ok) { status.textContent = t('catalog.interestError'); return; }
    status.textContent = t('catalog.interestSuccess');
    await selectDetail(itemId);
  }

  async function withdrawInterest() {
    const itemId = byId('catalogInterestForm').dataset.itemId;
    const status = byId('catalogInterestStatus');
    const response = await jsonRequest(`/api/catalog/${encodeURIComponent(itemId)}/interest`, { method: 'DELETE' });
    if (response.status === 401) { redirectToLogin(); return; }
    if (!response.ok) { status.textContent = t('catalog.interestError'); return; }
    status.textContent = t('catalog.interestWithdrawn');
    await selectDetail(itemId);
  }

  async function loadMyInterests() {
    const section = byId('catalogMyInterests');
    const status = byId('catalogMyInterestsStatus');
    const list = byId('catalogMyInterestsList');
    if (!section || !status || !list) return;
    section.hidden = false;
    status.textContent = t('catalog.loadingInterests');
    clear(list);
    try {
      const response = await jsonRequest(`/api/me/catalog-interests?lang=${encodeURIComponent(I18N?.lang || 'en')}&limit=24`);
      if (response.status === 401) { redirectToLogin(); return; }
      if (!response.ok) throw new Error('interests failed');
      const interests = (await response.json()).interests;
      const detailed = await Promise.all(interests.map(async (interest) => {
        const detail = await jsonRequest(`/api/catalog/${encodeURIComponent(interest.itemId)}?lang=${encodeURIComponent(I18N?.lang || 'en')}`);
        return detail.ok ? { interest, item: (await detail.json()).item } : { interest, item: null };
      }));
      detailed.forEach(({ interest, item }) => {
        const article = create('article', 'interest-record');
        article.append(create('span', `interest-status status-${interest.status}`, t(statusKey(interest.status))),
          create('h3', '', item?.title || t('catalog.detailUnavailable')),
          create('p', '', interest.message || ''));
        if (item) {
          const button = create('button', 'catalog-text-button', t('catalog.viewDetails'));
          button.type = 'button';
          button.addEventListener('click', () => { section.hidden = true; selectDetail(item.id); });
          article.append(button);
        }
        list.append(article);
      });
      status.textContent = interests.length ? '' : t('catalog.interestsEmpty');
    } catch { status.textContent = t('catalog.interestsError'); }
  }

  function runFilters() {
    page.selectedId = null;
    page.nextCursor = null;
    closeDetail();
    loadResults();
  }

  function debounceFilters() {
    clearTimeout(page.debounce);
    page.debounce = setTimeout(runFilters, 300);
  }

  function initCatalogPage() {
    if (!page.form || !page.results) return;
    readBrowserQuery();
    page.form.addEventListener('submit', (event) => { event.preventDefault(); runFilters(); });
    page.form.addEventListener('input', debounceFilters);
    page.form.addEventListener('change', debounceFilters);
    page.more.addEventListener('click', () => loadResults({ append: true }));
    byId('catalogDetailClose').addEventListener('click', closeDetail);
    byId('catalogInterestForm').addEventListener('submit', submitInterest);
    byId('catalogWithdrawInterest').addEventListener('click', withdrawInterest);
    byId('catalogMyInterestsToggle').addEventListener('click', loadMyInterests);
    byId('catalogMyInterestsClose').addEventListener('click', () => { byId('catalogMyInterests').hidden = true; });
    loadResults();
    if (page.selectedId) selectDetail(page.selectedId);
    if (new URLSearchParams(window.location.search).get('view') === 'interests') loadMyInterests();
  }

  function refetchForLanguage() {
    loadAuthState();
    loadLanding();
    if (page.form) {
      loadResults();
      if (page.selectedId) selectDetail(page.selectedId);
      if (!byId('catalogMyInterests').hidden) loadMyInterests();
    }
  }

  window.nodalI18n.onChange(refetchForLanguage);
  loadAuthState();
  loadLanding();
  initCatalogPage();
})();
