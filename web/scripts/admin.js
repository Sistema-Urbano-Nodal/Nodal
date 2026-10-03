/* Publishing desk: NODAL news, the verified catalog and the interest queue.
   The server validates authorization, publication requirements, optimistic
   versions, and every persisted value; this page only shows what is still
   missing. Copy goes through nodalI18n (ops.* keys); server error text is shown
   exactly as the server sent it. */
(() => {
  'use strict';

  const I18N = window.nodalI18n;
  const t = (key, vars) => (I18N ? I18N.t(key, vars) : key);
  const localeTag = () => ({ en: 'en-GB', es: 'es-ES', pt: 'pt-BR' }[I18N?.lang] ?? 'en-GB');

  const byId = (id) => document.getElementById(id);
  const elements = {
    filters: byId('adminCatalogFilters'),
    query: byId('adminCatalogQuery'),
    kindFilter: byId('adminCatalogKind'),
    statusFilter: byId('adminCatalogStatus'),
    list: byId('adminCatalogList'),
    listStatus: byId('adminCatalogListStatus'),
    catalogMore: byId('adminCatalogMore'),
    editor: byId('adminCatalogEditor'),
    id: byId('adminCatalogId'),
    version: byId('adminCatalogVersion'),
    recordState: byId('adminRecordState'),
    kind: byId('adminKind'),
    subtype: byId('adminSubtype'),
    visibility: byId('adminVisibility'),
    organization: byId('adminOrganization'),
    location: byId('adminLocation'),
    topics: byId('adminTopics'),
    topicsError: byId('adminTopicsError'),
    startsAt: byId('adminStartsAt'),
    deadlineAt: byId('adminDeadlineAt'),
    endDate: byId('adminEndDate'),
    sourceLabel: byId('adminSourceLabel'),
    sourceUrl: byId('adminSourceUrl'),
    sourceVerifiedAt: byId('adminSourceVerifiedAt'),
    actionMode: byId('adminActionMode'),
    actionUrl: byId('adminActionUrl'),
    featured: byId('adminFeatured'),
    newItem: byId('adminNewItem'),
    saveDraft: byId('adminSaveDraft'),
    publish: byId('adminPublish'),
    archive: byId('adminArchive'),
    saveFeature: byId('adminSaveFeature'),
    preview: byId('adminPreview'),
    previewPanel: byId('adminPreviewPanel'),
    previewContent: byId('adminPreviewContent'),
    previewClose: byId('adminPreviewClose'),
    conflictPanel: byId('adminConflictPanel'),
    conflictReload: byId('adminConflictReload'),
    editorStatus: byId('adminEditorStatus'),
    gateList: byId('adminGateList'),
    gateSummary: byId('adminGateSummary'),
    interestFilter: byId('adminInterestFilter'),
    interestList: byId('adminInterestList'),
    interestStatus: byId('adminInterestStatus'),
    interestMore: byId('adminInterestMore'),
    newsNew: byId('adminNewsNew'),
    newsList: byId('adminNewsList'),
    newsListStatus: byId('adminNewsListStatus'),
    newsMore: byId('adminNewsMore'),
    newsEditor: byId('adminNewsEditor'),
    newsEditorTitle: byId('adminNewsEditorTitle'),
    newsState: byId('adminNewsState'),
    newsTitle: byId('adminNewsTitle'),
    newsTitleError: byId('adminNewsTitleError'),
    newsBody: byId('adminNewsBody'),
    newsBodyCount: byId('adminNewsBodyCount'),
    newsBodyError: byId('adminNewsBodyError'),
    newsUrl: byId('adminNewsUrl'),
    newsUrlError: byId('adminNewsUrlError'),
    newsPinned: byId('adminNewsPinned'),
    newsConflict: byId('adminNewsConflict'),
    newsConflictTitle: byId('adminNewsConflictTitle'),
    newsConflictBody: byId('adminNewsConflictBody'),
    newsConflictReload: byId('adminNewsConflictReload'),
    newsConflictOverwrite: byId('adminNewsConflictOverwrite'),
    newsPublish: byId('adminNewsPublish'),
    newsDraft: byId('adminNewsDraft'),
    newsDelete: byId('adminNewsDelete'),
    newsStatus: byId('adminNewsStatus'),
    signOut: byId('adminSignOut'),
    tabNews: byId('adminTabNews'),
    tabCatalog: byId('adminTabCatalog'),
    tabInterests: byId('adminTabInterests'),
    tabList: byId('adminTabList'),
  };

  if (Object.values(elements).some((element) => !element)) return;

  const state = {
    items: [],
    interests: [],
    current: null,
    conflictCurrent: null,
    catalogController: null,
    interestController: null,
    catalogRequest: 0,
    interestRequest: 0,
    catalogCursor: null,
    interestCursor: null,
    catalogFilterKey: null,
    interestFilterKey: null,
    busy: false,
    // Missing fields read as "still to fill" until a Publish attempt, or on a record that is already published.
    gateStrict: false,
  };

  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /* Status lines remember their message so a language switch re-renders them.
     Server error text is shown as sent and is left alone. */
  const messages = new Map();
  function say(node, key, vars) {
    if (key) messages.set(node, [key, vars]);
    else messages.delete(node);
    node.textContent = key ? t(key, vars) : '';
  }
  function sayRaw(node, message) {
    messages.delete(node);
    node.textContent = message;
  }
  /* A button disabled while it works drops keyboard focus to the page. Once the action is over, focus goes
     back to it, or to the fallback when the button has hidden itself. Nothing moves when the action did not
     start from a focused control (a mouse click in Safari) or when focus has already moved on. */
  function restoreFocus(trigger, fallback) {
    if (!trigger || trigger === document.body) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const shown = (node) => node && !node.hidden && !node.disabled && node.getClientRects?.().length !== 0;
    (shown(trigger) ? trigger : fallback)?.focus?.();
  }

  /* An inner list that hides rows below its edge fades there, so a cut row reads as "more below". */
  const markClipped = (list) => list.classList.toggle('is-clipped', list.scrollHeight - list.scrollTop - list.clientHeight > 2);

  const apiError = (data, key, status) => Object.assign(new Error(key), { server: typeof data?.error === 'string' ? data.error : '', key, status });
  function report(node, error, fallback) {
    if (error?.server) sayRaw(node, error.server);
    else if (error?.key) say(node, error.key, { status: error.status });
    else say(node, fallback);
  }

  const text = (value) => String(value ?? '').trim();
  const isHttps = (value) => {
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  };
  const label = (prefix, value) => (value ? t(`${prefix}.${value}`) : '');
  const formatDate = (value) => {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'short', year: 'numeric' }).format(date) : '';
  };
  const localDate = (value, includeTime = false) => {
    if (!value) return '';
    if (!includeTime) {
      const civil = String(value).match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
      if (civil) return civil[1];
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60 * 1000;
    const local = new Date(date.getTime() - offset).toISOString();
    return includeTime ? local.slice(0, 16) : local.slice(0, 10);
  };
  const apiDate = (value, includeTime = false) => {
    if (!value) return null;
    if (!includeTime) return value;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : value;
  };

  async function request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers,
    });
    if (response.status === 401) {
      location.assign('/login.html?next=/admin.html');
      return { response, data: {} };
    }
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  /* ---------------- catalog ---------------- */
  function emptyTranslations() {
    return {
      en: { title: '', summary: '', body: '', cta: '' },
      es: { title: '', summary: '', body: '', cta: '' },
      pt: { title: '', summary: '', body: '', cta: '' },
    };
  }

  function blankRecord() {
    return {
      id: '', version: null, kind: 'resource', subtype: null, status: 'draft', visibility: 'public',
      translations: emptyTranslations(), organization: '', location: '', topics: [], startsAt: null,
      deadlineAt: null, endDate: null, sourceLabel: '', sourceUrl: '', sourceVerifiedAt: null,
      actionMode: 'none', actionUrl: '', featured: false,
    };
  }

  function translation(lang, field) {
    return byId(`admin${field}${lang}`);
  }

  function readTranslation(lang) {
    return {
      title: text(translation(lang, 'Title').value),
      summary: text(translation(lang, 'Summary').value),
      body: text(translation(lang, 'Body').value),
      cta: text(translation(lang, 'Cta').value),
    };
  }

  function readEditorTopics() {
    return elements.topics.value.split(/[,\n]/).map(text).filter(Boolean);
  }

  function validateEditorTopics() {
    const topics = readEditorTopics();
    let error = '';
    if (topics.length > 8) error = 'ops.err.topicsMax';
    else if (topics.some((topic) => topic.length > 60)) error = 'ops.err.topicLength';
    say(elements.topicsError, error);
    elements.topicsError.hidden = !error;
    elements.topics.setAttribute('aria-invalid', String(Boolean(error)));
    if (error) {
      say(elements.editorStatus, 'ops.err.topics');
      return null;
    }
    return topics;
  }

  function serializeEditor(status, topics = readEditorTopics()) {
    const actionMode = elements.actionMode.value;
    return {
      kind: elements.kind.value,
      subtype: elements.kind.value === 'opportunity' ? (elements.subtype.value || null) : null,
      status,
      visibility: elements.visibility.value,
      translations: {
        en: readTranslation('En'),
        es: readTranslation('Es'),
        pt: readTranslation('Pt'),
      },
      organization: text(elements.organization.value),
      location: text(elements.location.value),
      topics,
      startsAt: apiDate(elements.startsAt.value, true),
      deadlineAt: apiDate(elements.deadlineAt.value, true),
      endDate: apiDate(elements.endDate.value),
      sourceLabel: text(elements.sourceLabel.value),
      sourceUrl: text(elements.sourceUrl.value),
      sourceVerifiedAt: apiDate(elements.sourceVerifiedAt.value),
      actionMode,
      actionUrl: actionMode === 'external' ? text(elements.actionUrl.value) : '',
      featured: elements.featured.checked,
    };
  }

  /* The same requirements as the server's publication gate (server/catalog.js),
     listed per language so an editor sees what is left before pressing Publish. */
  const TRANSLATION_FIELDS = [['Title', 'title'], ['Summary', 'summary'], ['Body', 'body'], ['Cta', 'cta']];
  function publicationGaps() {
    const translations = ['En', 'Es', 'Pt'].map((lang) => ({
      lang: lang.toLowerCase(),
      missing: TRANSLATION_FIELDS.filter(([field]) => !text(translation(lang, field).value)).map(([, key]) => key),
    }));
    const value = (name) => text(elements[name].value);
    const record = [];
    if (!value('organization')) record.push('organization');
    if (!value('sourceLabel')) record.push('sourceLabel');
    if (!isHttps(value('sourceUrl'))) record.push('sourceUrl');
    if (!value('sourceVerifiedAt')) record.push('sourceVerifiedAt');
    if (elements.kind.value === 'opportunity' && !value('subtype')) record.push('subtype');
    if (elements.kind.value === 'opportunity' && !value('deadlineAt')) record.push('deadlineAt');
    if (elements.actionMode.value === 'external' && !isHttps(value('actionUrl'))) record.push('actionUrl');
    return { translations, record };
  }

  function renderGate() {
    const { translations, record } = publicationGaps();
    const rows = [
      ...translations.map(({ lang, missing }) => [t(`ops.lang.${lang}`), missing]),
      [t('ops.gate.record'), record],
    ];
    const total = rows.reduce((sum, [, missing]) => sum + missing.length, 0);
    // An untouched record is not an error: until Publish is tried (or the record is live) the gaps read as work left, in muted text.
    const strict = state.gateStrict;
    const gap = strict ? 'is-missing' : 'is-todo';
    elements.gateList.replaceChildren(...rows.map(([name, missing]) => {
      const row = create('li', missing.length ? gap : 'is-ready');
      const fields = missing.map((field) => t(`ops.field.${field}`)).join(', ');
      row.append(create('b', null, name), create('span', null, missing.length
        ? t(strict ? 'ops.gate.missing' : 'ops.gate.todo', { fields })
        : t('ops.gate.complete')));
      return row;
    }));
    const summary = strict
      ? (total === 1 ? 'ops.gate.summaryOne' : 'ops.gate.summary')
      : (total === 1 ? 'ops.gate.todoSummaryOne' : 'ops.gate.todoSummary');
    elements.gateSummary.textContent = total ? t(summary, { n: total }) : t('ops.gate.ready');
    elements.gateSummary.className = `admin-gate-summary ${total ? gap : 'is-ready'}`;
    return total;
  }

  function fillTranslation(lang, row = {}) {
    translation(lang, 'Title').value = row.title || '';
    translation(lang, 'Summary').value = row.summary || '';
    translation(lang, 'Body').value = row.body || '';
    translation(lang, 'Cta').value = row.cta || '';
  }

  function updateConditionalFields() {
    const opportunity = elements.kind.value === 'opportunity';
    elements.subtype.disabled = !opportunity;
    if (!opportunity) elements.subtype.value = '';
    const external = elements.actionMode.value === 'external';
    elements.actionUrl.disabled = !external;
    if (!external) elements.actionUrl.value = '';
    renderGate();
  }

  function renderRecordState() {
    const item = state.current;
    // The status only: a record id is a UUID, kept as a tooltip for staff who need to quote it.
    elements.recordState.textContent = item ? label('ops.status', item.status) : t('ops.record.new');
    elements.recordState.title = item?.id || '';
    elements.recordState.className = `admin-state is-${item?.status || 'new'}`;
    // A new draft has nothing to archive or re-feature, and it already is the blank record "New record" would open.
    elements.newItem.hidden = !item;
    elements.archive.hidden = !item;
    elements.saveFeature.hidden = !item;
  }

  function fillEditor(record) {
    const item = { ...blankRecord(), ...(record || {}), translations: { ...emptyTranslations(), ...(record?.translations || {}) } };
    state.current = item.id ? item : null;
    state.conflictCurrent = null;
    state.gateStrict = item.status === 'published';
    elements.conflictPanel.hidden = true;
    elements.id.value = item.id || '';
    elements.version.textContent = item.version ? String(item.version) : '—';
    renderRecordState();
    elements.kind.value = item.kind;
    elements.subtype.value = item.subtype || '';
    elements.visibility.value = item.visibility;
    elements.organization.value = item.organization || '';
    elements.location.value = item.location || '';
    elements.topics.value = Array.isArray(item.topics) ? item.topics.join(', ') : '';
    elements.startsAt.value = localDate(item.startsAt, true);
    elements.deadlineAt.value = localDate(item.deadlineAt, true);
    elements.endDate.value = localDate(item.endDate);
    elements.sourceLabel.value = item.sourceLabel || '';
    elements.sourceUrl.value = item.sourceUrl || '';
    elements.sourceVerifiedAt.value = localDate(item.sourceVerifiedAt);
    elements.actionMode.value = item.actionMode || 'none';
    elements.actionUrl.value = item.actionUrl || '';
    elements.featured.checked = Boolean(item.featured);
    elements.topicsError.hidden = true;
    say(elements.topicsError, '');
    elements.topics.setAttribute('aria-invalid', 'false');
    fillTranslation('En', item.translations.en);
    fillTranslation('Es', item.translations.es);
    fillTranslation('Pt', item.translations.pt);
    updateConditionalFields();
    renderCatalogList();
    say(elements.editorStatus, item.id ? 'ops.record.loaded' : 'ops.record.ready');
  }

  function catalogLabel(item) {
    return item.translations?.en?.title || item.translations?.es?.title || item.translations?.pt?.title || t('ops.record.untitled');
  }

  function renderCatalogList() {
    // Choosing a record rebuilds the list; the row that held keyboard focus gets it back instead of the page.
    const active = document.activeElement;
    const refocus = active && elements.list.contains?.(active) ? active.dataset?.id : null;
    const nodes = state.items.map((item) => {
      const button = create('button', 'admin-record');
      button.type = 'button';
      button.dataset.id = item.id;
      const selected = item.id === elements.id.value;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-current', String(selected));
      button.append(create('strong', null, catalogLabel(item)));
      button.append(create('span', null, [item.organization, item.location].filter(Boolean).join(' · ') || t('ops.record.noPlace')));
      const meta = create('span', 'admin-record-meta');
      for (const [value, className] of [
        [label('ops.kind', item.kind), ''], [label('ops.status', item.status), `is-${item.status}`],
        [label('ops.visibility', item.visibility), ''], [item.featured ? t('ops.record.featured') : '', ''],
      ]) {
        if (value) meta.append(create('span', className || null, value));
      }
      button.append(meta);
      button.addEventListener('click', () => fillEditor(item));
      return button;
    });
    elements.list.replaceChildren(...nodes);
    elements.list.setAttribute('aria-busy', 'false');
    if (refocus) nodes.find((node) => node.dataset.id === refocus)?.focus({ preventScroll: true });
    markClipped(elements.list);
  }

  function catalogFilterSnapshot() {
    return {
      query: text(elements.query.value),
      kind: text(elements.kindFilter.value),
      status: text(elements.statusFilter.value),
    };
  }

  function filterKey(filters) {
    return JSON.stringify(filters);
  }

  function invalidateCatalogPagination() {
    state.catalogController?.abort();
    state.catalogController = null;
    state.catalogRequest += 1;
    state.catalogCursor = null;
    state.catalogFilterKey = null;
    elements.catalogMore.hidden = true;
    elements.list.setAttribute('aria-busy', 'false');
  }

  async function loadCatalog({ append = false, filters = catalogFilterSnapshot() } = {}) {
    const snapshot = { ...filters };
    const snapshotKey = filterKey(snapshot);
    if (append && (!state.catalogCursor || state.catalogFilterKey !== snapshotKey)) return false;
    const cursor = append ? state.catalogCursor : null;
    if (!append) {
      state.catalogCursor = null;
      state.catalogFilterKey = snapshotKey;
      elements.catalogMore.hidden = true;
    }
    state.catalogController?.abort();
    const controller = new AbortController();
    state.catalogController = controller;
    const sequence = state.catalogRequest + 1;
    state.catalogRequest = sequence;
    const params = new URLSearchParams({ state: 'all', limit: '24' });
    if (cursor) params.set('cursor', cursor);
    if (snapshot.query) params.set('q', snapshot.query);
    if (snapshot.kind) params.set('kind', snapshot.kind);
    if (snapshot.status) params.set('status', snapshot.status);
    say(elements.listStatus, 'ops.catalog.loading');
    elements.list.setAttribute('aria-busy', 'true');
    try {
      const { response, data } = await request(`/api/admin/catalog?${params}`, { signal: controller.signal });
      if (sequence !== state.catalogRequest || state.catalogFilterKey !== snapshotKey
        || filterKey(catalogFilterSnapshot()) !== snapshotKey) return false;
      if (!response.ok) throw apiError(data, 'ops.catalog.failed', response.status);
      const items = Array.isArray(data.items) ? data.items : [];
      state.items = append ? [...state.items, ...items] : items;
      state.catalogCursor = data.nextCursor || null;
      elements.catalogMore.hidden = !state.catalogCursor;
      renderCatalogList();
      if (state.items.length) say(elements.listStatus, state.items.length === 1 ? 'ops.catalog.countOne' : 'ops.catalog.count', { n: state.items.length });
      // With no filter set, an empty list means an empty catalog, not a filter that matched nothing.
      else say(elements.listStatus, snapshot.query || snapshot.kind || snapshot.status ? 'ops.catalog.empty' : 'ops.catalog.none');
      return true;
    } catch (error) {
      if (error.name === 'AbortError' || sequence !== state.catalogRequest || state.catalogFilterKey !== snapshotKey) return false;
      if (!append) {
        state.items = [];
        state.catalogCursor = null;
        elements.catalogMore.hidden = true;
        renderCatalogList();
      }
      report(elements.listStatus, error, 'ops.catalog.unavailable');
      return false;
    } finally {
      if (sequence === state.catalogRequest && state.catalogFilterKey === snapshotKey) {
        elements.list.setAttribute('aria-busy', 'false');
        if (state.catalogController === controller) state.catalogController = null;
      }
    }
  }

  function setBusy(value) {
    state.busy = value;
    for (const button of [elements.saveDraft, elements.publish, elements.archive, elements.saveFeature]) button.disabled = value;
  }

  function showCatalogConflict(current) {
    state.conflictCurrent = current || null;
    elements.conflictPanel.hidden = false;
    say(elements.editorStatus, 'ops.record.conflict');
  }

  async function saveCatalog(status) {
    if (state.busy) return;
    const topics = validateEditorTopics();
    if (!topics) return;
    const payload = serializeEditor(status, topics);
    if (status === 'published' && !state.gateStrict) {
      state.gateStrict = true;
      renderGate();
    }
    const currentId = elements.id.value;
    const version = Number(elements.version.textContent);
    const editing = Boolean(currentId);
    if (editing && (!Number.isInteger(version) || version < 1)) {
      say(elements.editorStatus, 'ops.record.noVersion');
      return;
    }
    const trigger = document.activeElement;
    setBusy(true);
    say(elements.editorStatus, status === 'published' ? 'ops.record.publishing' : status === 'archived' ? 'ops.record.archiving' : 'ops.record.saving');
    try {
      const { response, data } = await request(editing ? `/api/admin/catalog/${encodeURIComponent(currentId)}` : '/api/admin/catalog', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(editing ? { ...payload, version } : payload),
      });
      if (response.status === 409) {
        showCatalogConflict(data.current);
        return;
      }
      if (!response.ok) throw apiError(data, 'ops.record.saveFailed', response.status);
      fillEditor(data.item);
      say(elements.editorStatus, status === 'published' ? 'ops.record.publishedOk' : status === 'archived' ? 'ops.record.archivedOk' : 'ops.record.savedOk');
      await loadCatalog();
    } catch (error) {
      report(elements.editorStatus, error, 'ops.record.notSaved');
    } finally {
      setBusy(false);
      restoreFocus(trigger, elements.publish);
    }
  }

  function renderPreview({ scroll = true } = {}) {
    const topics = validateEditorTopics();
    if (!topics) {
      elements.previewPanel.hidden = true;
      return;
    }
    const status = state.current?.status || 'draft';
    const item = serializeEditor(status, topics);
    const cards = Object.entries(item.translations).map(([lang, row]) => {
      const card = create('article', 'admin-preview-card');
      card.append(create('span', 'admin-kicker', `${lang.toUpperCase()} · ${t(`ops.lang.${lang}`)}`));
      card.append(create('h4', null, row.title || t('ops.preview.untitled')));
      card.append(create('p', 'admin-preview-summary', row.summary || t('ops.preview.noSummary')));
      card.append(create('p', null, row.body || t('ops.preview.noBody')));
      card.append(create('p', null, row.cta ? t('ops.preview.cta', { cta: row.cta }) : t('ops.preview.noCta')));
      if (item.sourceUrl) {
        const link = create('a', null, item.sourceLabel || item.sourceUrl);
        try {
          const url = new URL(item.sourceUrl);
          if (url.protocol === 'https:') { link.href = url.toString(); link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        } catch { /* server validation reports malformed URLs on save */ }
        card.append(link);
      }
      return card;
    });
    elements.previewContent.replaceChildren(...cards);
    elements.previewPanel.hidden = false;
    if (scroll) elements.previewPanel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  /* ---------------- interest queue ---------------- */
  function renderInterest(interest) {
    const article = create('article', 'admin-interest');
    const item = interest.item || {};
    const about = create('div', 'admin-interest-item');
    about.append(create('p', 'admin-interest-item-kind', [label('ops.kind', item.kind), item.organization].filter(Boolean).join(' · ')));
    about.append(create('h3', 'admin-interest-item-title', item.title || t('ops.interest.noItem')));
    const member = create('div', 'admin-interest-member');
    member.append(create('h4', null, interest.member?.name || t('ops.interest.noName')));
    const email = create('a', null, interest.member?.email || t('ops.interest.noEmail'));
    if (interest.member?.email) email.href = `mailto:${encodeURIComponent(interest.member.email)}`;
    member.append(email);
    article.append(about, member, create('p', 'admin-interest-message', interest.message || t('ops.interest.noMessage')));
    const controls = create('div', 'admin-interest-controls');
    const field = create('label');
    field.append(create('span', null, t('ops.interest.queueStatus')));
    const select = create('select');
    for (const status of ['new', 'contacted', 'closed', 'withdrawn']) {
      const option = create('option', null, t(`ops.interest.${status}`));
      option.value = status;
      option.selected = status === interest.status;
      select.append(option);
    }
    field.append(select);
    const save = create('button', 'admin-button', t('ops.interest.update'));
    save.type = 'button';
    save.addEventListener('click', async () => {
      save.disabled = true;
      say(elements.interestStatus, 'ops.interest.updating');
      try {
        const { response, data } = await request(`/api/admin/interests/${encodeURIComponent(interest.id)}`, {
          method: 'PATCH', body: JSON.stringify({ status: select.value, version: interest.version }),
        });
        // A failed queue refresh reports itself; it must not read as a failed update.
        if (response.status === 409) {
          say(elements.interestStatus, 'ops.interest.changed');
          await loadInterests().catch(() => false);
          return;
        }
        if (!response.ok) throw apiError(data, 'ops.interest.updateFailed', response.status);
        interest.status = data.interest.status;
        interest.version = data.interest.version;
        const refreshed = await loadInterests().catch(() => false);
        if (refreshed) say(elements.interestStatus, 'ops.interest.updated');
      } catch (error) {
        report(elements.interestStatus, error, 'ops.interest.notUpdated');
      } finally {
        save.disabled = false;
      }
    });
    controls.append(field, save);
    article.append(controls);
    return article;
  }

  function renderInterestList() {
    elements.interestList.replaceChildren(...state.interests.map(renderInterest));
    elements.interestList.setAttribute('aria-busy', 'false');
  }

  function interestFilterSnapshot() {
    return { status: text(elements.interestFilter.value) };
  }

  function invalidateInterestPagination() {
    state.interestController?.abort();
    state.interestController = null;
    state.interestRequest += 1;
    state.interestCursor = null;
    state.interestFilterKey = null;
    elements.interestMore.hidden = true;
    elements.interestList.setAttribute('aria-busy', 'false');
  }

  async function loadInterests({ append = false, filters = interestFilterSnapshot() } = {}) {
    const snapshot = { ...filters };
    const snapshotKey = filterKey(snapshot);
    if (append && (!state.interestCursor || state.interestFilterKey !== snapshotKey)) return false;
    const cursor = append ? state.interestCursor : null;
    if (!append) {
      state.interestCursor = null;
      state.interestFilterKey = snapshotKey;
      elements.interestMore.hidden = true;
    }
    state.interestController?.abort();
    const controller = new AbortController();
    state.interestController = controller;
    const sequence = state.interestRequest + 1;
    state.interestRequest = sequence;
    const params = new URLSearchParams({ limit: '24' });
    if (snapshot.status) params.set('status', snapshot.status);
    if (cursor) params.set('cursor', cursor);
    say(elements.interestStatus, 'ops.interest.loading');
    elements.interestList.setAttribute('aria-busy', 'true');
    try {
      const { response, data } = await request(`/api/admin/interests?${params}`, { signal: controller.signal });
      if (sequence !== state.interestRequest || state.interestFilterKey !== snapshotKey
        || filterKey(interestFilterSnapshot()) !== snapshotKey) return false;
      if (!response.ok) throw apiError(data, 'ops.interest.failed', response.status);
      const interests = Array.isArray(data.interests) ? data.interests : [];
      state.interests = append ? [...state.interests, ...interests] : interests;
      state.interestCursor = data.nextCursor || null;
      elements.interestMore.hidden = !state.interestCursor;
      renderInterestList();
      if (state.interests.length) say(elements.interestStatus, state.interests.length === 1 ? 'ops.interest.countOne' : 'ops.interest.count', { n: state.interests.length });
      else say(elements.interestStatus, snapshot.status ? 'ops.interest.empty' : 'ops.interest.none');
      return true;
    } catch (error) {
      if (error.name === 'AbortError' || sequence !== state.interestRequest || state.interestFilterKey !== snapshotKey) return false;
      if (!append) {
        state.interests = [];
        state.interestCursor = null;
        elements.interestMore.hidden = true;
        renderInterestList();
      } else elements.interestList.setAttribute('aria-busy', 'false');
      report(elements.interestStatus, error, 'ops.interest.unavailable');
      throw error;
    } finally {
      if (sequence === state.interestRequest && state.interestFilterKey === snapshotKey) {
        elements.interestList.setAttribute('aria-busy', 'false');
        if (state.interestController === controller) state.interestController = null;
      }
    }
  }

  /* ---------------- NODAL news ----------------
     A new post carries a client id, so a retried POST after a lost response
     returns the stored post instead of creating a second one. A retry with
     other content (edited or published after the lost save) comes back as a
     conflict, so the desk never reports a save that did not happen. */
  // crypto.randomUUID needs a secure context; elsewhere the same lowercase v4 form is built from random bytes.
  const uuid = () => globalThis.crypto?.randomUUID?.() || ((bytes) => {
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  })(globalThis.crypto?.getRandomValues?.(new Uint8Array(16)) || Uint8Array.from({ length: 16 }, () => Math.random() * 256));
  const NEWS_LIMITS = { title: 160, body: 2000, url: 500 };
  const NEWS_FIELDS = { title: ['newsTitle', 'newsTitleError'], body: ['newsBody', 'newsBodyError'], url: ['newsUrl', 'newsUrlError'] };
  const news = { items: [], cursor: null, current: null, draftId: uuid(), conflict: null, pending: 'draft', snapshot: '', controller: null, request: 0, busy: false };

  function readNews(status) {
    return {
      title: text(elements.newsTitle.value),
      body: text(elements.newsBody.value),
      url: text(elements.newsUrl.value),
      pinned: elements.newsPinned.checked,
      status,
    };
  }
  const newsDirty = () => JSON.stringify(readNews()) !== news.snapshot;

  function newsFieldError(field, key, raw) {
    const [input, error] = NEWS_FIELDS[field].map((name) => elements[name]);
    if (raw) sayRaw(error, raw);
    else say(error, key);
    error.hidden = !(key || raw);
    input.setAttribute('aria-invalid', String(Boolean(key || raw)));
  }

  function validateNews(payload) {
    const errors = {
      title: !payload.title ? 'ops.news.errTitle' : payload.title.length > NEWS_LIMITS.title ? 'ops.news.errTitleLong' : '',
      body: payload.body.length > NEWS_LIMITS.body ? 'ops.news.errBodyLong' : '',
      url: payload.url && (!isHttps(payload.url) || payload.url.length > NEWS_LIMITS.url) ? 'ops.news.errUrl' : '',
    };
    for (const [field, key] of Object.entries(errors)) newsFieldError(field, key);
    const first = Object.keys(errors).find((field) => errors[field]);
    if (first) elements[NEWS_FIELDS[first][0]].focus();
    return !first;
  }

  // Posts are feminine in ES and PT (publicación, publicação), so the state has its own words, not the catalog's.
  const newsStatus = (item) => t(item.status === 'published' ? 'ops.news.statusPublished' : 'ops.news.statusDraft');

  function newsWhen(item) {
    return formatDate(item.status === 'published' ? item.publishedAt : item.updatedAt || item.createdAt);
  }

  function renderNewsEditor() {
    const item = news.current;
    const published = item?.status === 'published';
    elements.newsEditorTitle.textContent = t(item ? 'ops.news.editTitle' : 'ops.news.newTitle');
    elements.newsState.textContent = item
      ? [newsStatus(item), item.pinned ? t('ops.news.pinned') : '', newsWhen(item)].filter(Boolean).join(' · ')
      : t('ops.news.unsaved');
    elements.newsState.className = `admin-state is-${item?.status || 'new'}`;
    elements.newsPublish.textContent = t(published ? 'ops.news.update' : 'ops.news.publish');
    elements.newsDraft.textContent = t(published ? 'ops.news.unpublish' : 'ops.news.saveDraft');
    elements.newsDelete.hidden = !item;
    // The editor opens on a blank post; "New post" only appears once an existing post is open, as the way back.
    elements.newsNew.hidden = !item;
    elements.newsBodyCount.textContent = `${elements.newsBody.value.length} / ${NEWS_LIMITS.body}`;
  }

  function renderNewsList() {
    const rows = news.items.map((item) => {
      const row = create('li');
      const button = create('button', 'admin-news-item');
      button.type = 'button';
      const selected = item.id === news.current?.id;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-current', String(selected));
      button.append(create('strong', null, item.title || t('ops.record.untitled')));
      const meta = create('span', 'admin-record-meta');
      meta.append(create('span', `is-${item.status}`, newsStatus(item)));
      if (item.pinned) meta.append(create('span', null, t('ops.news.pinned')));
      const when = newsWhen(item);
      if (when) meta.append(create('span', null, when));
      button.append(meta);
      button.addEventListener('click', () => openNews(item));
      row.append(button);
      return row;
    });
    elements.newsList.replaceChildren(...rows);
    elements.newsList.setAttribute('aria-busy', 'false');
    markClipped(elements.newsList);
  }

  function renderNewsCount() {
    const n = news.items.length;
    if (n) say(elements.newsListStatus, n === 1 ? 'ops.news.countOne' : 'ops.news.count', { n });
    else say(elements.newsListStatus, 'ops.news.empty');
  }

  function fillNews(item = null) {
    news.current = item?.id ? { ...item } : null;
    if (!news.current) news.draftId = uuid();
    news.conflict = null;
    elements.newsConflict.hidden = true;
    elements.newsTitle.value = item?.title || '';
    elements.newsBody.value = item?.body || '';
    elements.newsUrl.value = item?.url || '';
    elements.newsPinned.checked = Boolean(item?.pinned);
    for (const field of Object.keys(NEWS_FIELDS)) newsFieldError(field, '');
    news.snapshot = JSON.stringify(readNews());
    renderNewsEditor();
    renderNewsList();
  }

  function openNews(item) {
    if (item.id === news.current?.id) return;
    if (newsDirty() && !window.confirm(t('ops.news.discard'))) return;
    fillNews(item);
    say(elements.newsStatus, 'ops.news.loaded');
    elements.newsTitle.focus();
  }

  function upsertNews(item) {
    const index = news.items.findIndex((entry) => entry.id === item.id);
    if (index === -1) news.items = [item, ...news.items];
    else news.items = news.items.map((entry, position) => (position === index ? item : entry));
    renderNewsCount();
  }

  async function loadNews({ append = false } = {}) {
    if (append && !news.cursor) return false;
    news.controller?.abort();
    const controller = new AbortController();
    news.controller = controller;
    news.request += 1;
    const sequence = news.request;
    const params = new URLSearchParams();
    if (append) params.set('cursor', news.cursor);
    const query = params.toString();
    say(elements.newsListStatus, 'ops.news.loading');
    elements.newsList.setAttribute('aria-busy', 'true');
    try {
      const { response, data } = await request(`/api/admin/news${query ? `?${query}` : ''}`, { signal: controller.signal });
      if (sequence !== news.request) return false;
      if (!response.ok) throw apiError(data, 'ops.news.failed', response.status);
      const items = Array.isArray(data.items) ? data.items.filter((item) => item && typeof item.id === 'string') : [];
      news.items = append ? [...news.items, ...items.filter((item) => !news.items.some((entry) => entry.id === item.id))] : items;
      news.cursor = data.nextCursor || null;
      elements.newsMore.hidden = !news.cursor;
      renderNewsList();
      renderNewsCount();
      return true;
    } catch (error) {
      if (error.name === 'AbortError' || sequence !== news.request) return false;
      report(elements.newsListStatus, error, 'ops.news.unavailable');
      return false;
    } finally {
      if (sequence === news.request) {
        elements.newsList.setAttribute('aria-busy', 'false');
        if (news.controller === controller) news.controller = null;
      }
    }
  }

  function setNewsBusy(value) {
    news.busy = value;
    for (const button of [elements.newsPublish, elements.newsDraft, elements.newsDelete, elements.newsConflictOverwrite]) button.disabled = value;
  }

  // 'edited': someone saved this post since it was opened. 'earlier': a new post's first save reached the server
  // although its answer was lost, and the editor has changed it since.
  const NEWS_CONFLICT_COPY = {
    edited: { newsConflictTitle: 'ops.news.conflictTitle', newsConflictBody: 'ops.news.conflictBody', newsConflictReload: 'ops.news.conflictReload', status: 'ops.news.conflictStatus' },
    earlier: { newsConflictTitle: 'ops.news.earlierTitle', newsConflictBody: 'ops.news.earlierBody', newsConflictReload: 'ops.news.earlierReload', status: 'ops.news.earlierStatus' },
  };
  function showNewsConflict(item, kind = 'edited') {
    news.conflict = item?.id ? item : null;
    const { status, ...copy } = NEWS_CONFLICT_COPY[kind];
    for (const [name, key] of Object.entries(copy)) {
      elements[name].dataset.i18n = key;
      say(elements[name], key);
    }
    elements.newsConflict.hidden = false;
    elements.newsConflictReload.disabled = !news.conflict;
    elements.newsConflictOverwrite.disabled = !news.conflict;
    say(elements.newsStatus, status);
  }

  // Deleted elsewhere: the text stays, and saving creates the post again.
  function newsGone(item) {
    news.items = news.items.filter((entry) => entry.id !== item.id);
    news.current = null;
    news.draftId = uuid();
    news.snapshot = '';
    renderNewsEditor();
    renderNewsList();
    renderNewsCount();
    say(elements.newsStatus, 'ops.news.gone');
  }

  async function saveNews(status) {
    if (news.busy) return false;
    const payload = readNews(status);
    if (!validateNews(payload)) {
      say(elements.newsStatus, 'ops.news.fix');
      return false;
    }
    const current = news.current;
    news.pending = status;
    const trigger = document.activeElement;
    setNewsBusy(true);
    say(elements.newsStatus, status === 'published' ? 'ops.news.publishing' : 'ops.news.saving');
    try {
      const { response, data } = await request(current ? `/api/admin/news/${encodeURIComponent(current.id)}` : '/api/admin/news', {
        method: current ? 'PATCH' : 'POST',
        body: JSON.stringify(current ? { version: current.version, ...payload } : { id: news.draftId, ...payload }),
      });
      if (response.status === 409) {
        showNewsConflict(data.item, current ? 'edited' : 'earlier');
        return false;
      }
      if (response.status === 404 && current) {
        newsGone(current);
        return false;
      }
      if (response.status === 400 && NEWS_FIELDS[data.field]) {
        newsFieldError(data.field, 'ops.news.fix', data.error);
        elements[NEWS_FIELDS[data.field][0]].focus();
        say(elements.newsStatus, 'ops.news.fix');
        return false;
      }
      if (!response.ok || typeof data.item?.id !== 'string') throw apiError(data, 'ops.news.saveFailed', response.status);
      upsertNews(data.item);
      fillNews(data.item);
      // The stored state decides the message, not the button pressed.
      say(elements.newsStatus, data.item.status === 'published' ? 'ops.news.publishedOk' : 'ops.news.savedOk');
      return true;
    } catch (error) {
      report(elements.newsStatus, error, 'ops.news.notSaved');
      return false;
    } finally {
      setNewsBusy(false);
      restoreFocus(trigger, elements.newsTitle);
    }
  }

  async function deleteNews() {
    const current = news.current;
    if (!current || news.busy || !window.confirm(t('ops.news.confirmDelete', { title: current.title }))) return false;
    const trigger = document.activeElement;
    setNewsBusy(true);
    say(elements.newsStatus, 'ops.news.deleting');
    try {
      const { response, data } = await request(`/api/admin/news/${encodeURIComponent(current.id)}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) throw apiError(data, 'ops.news.deleteFailed', response.status);
      news.items = news.items.filter((item) => item.id !== current.id);
      fillNews(null);
      renderNewsCount();
      say(elements.newsStatus, 'ops.news.deleted');
      return true;
    } catch (error) {
      report(elements.newsStatus, error, 'ops.news.notDeleted');
      return false;
    } finally {
      setNewsBusy(false);
      // After a delete the button hides itself, so focus starts the next post in the blank editor.
      restoreFocus(trigger, elements.newsTitle);
    }
  }

  /* ---------------- wiring ---------------- */
  let filterTimer = null;
  function refreshCatalogNow() {
    clearTimeout(filterTimer);
    const filters = catalogFilterSnapshot();
    invalidateCatalogPagination();
    return loadCatalog({ filters });
  }

  function refreshInterestsNow() {
    const filters = interestFilterSnapshot();
    invalidateInterestPagination();
    const refresh = loadInterests({ filters });
    refresh.catch(() => {});
    return refresh;
  }

  elements.filters.addEventListener('submit', (event) => { event.preventDefault(); return refreshCatalogNow(); });
  elements.query.addEventListener('input', () => {
    clearTimeout(filterTimer);
    const filters = catalogFilterSnapshot();
    invalidateCatalogPagination();
    filterTimer = setTimeout(() => loadCatalog({ filters }), 250);
  });
  elements.kindFilter.addEventListener('change', refreshCatalogNow);
  elements.statusFilter.addEventListener('change', refreshCatalogNow);
  elements.interestFilter.addEventListener('change', refreshInterestsNow);
  elements.catalogMore.addEventListener('click', () => loadCatalog({ append: true }));
  elements.interestMore.addEventListener('click', () => loadInterests({ append: true }));
  elements.kind.addEventListener('change', updateConditionalFields);
  elements.actionMode.addEventListener('change', updateConditionalFields);
  elements.newItem.addEventListener('click', () => {
    fillEditor(blankRecord());
    // The button hides itself on a blank record, so focus moves to the editor's first field instead of falling to the page.
    elements.kind.focus();
  });
  elements.saveDraft.addEventListener('click', () => saveCatalog('draft'));
  elements.publish.addEventListener('click', () => saveCatalog('published'));
  elements.archive.addEventListener('click', () => saveCatalog('archived'));
  elements.saveFeature.addEventListener('click', () => saveCatalog(state.current?.status || 'draft'));
  elements.preview.addEventListener('click', () => renderPreview());
  elements.previewClose.addEventListener('click', () => { elements.previewPanel.hidden = true; });
  elements.conflictReload.addEventListener('click', () => {
    if (state.conflictCurrent) fillEditor(state.conflictCurrent);
  });
  elements.editor.addEventListener('submit', (event) => event.preventDefault());
  for (const list of [elements.list, elements.newsList]) list.addEventListener('scroll', () => markClipped(list), { passive: true });
  elements.editor.addEventListener('input', renderGate);
  elements.editor.addEventListener('change', renderGate);

  elements.newsNew.addEventListener('click', () => {
    if (newsDirty() && !window.confirm(t('ops.news.discard'))) return;
    fillNews(null);
    say(elements.newsStatus, 'ops.news.ready');
    elements.newsTitle.focus();
  });
  elements.newsMore.addEventListener('click', () => loadNews({ append: true }));
  elements.newsPublish.addEventListener('click', () => saveNews('published'));
  elements.newsDraft.addEventListener('click', () => saveNews('draft'));
  elements.newsDelete.addEventListener('click', () => deleteNews());
  elements.newsBody.addEventListener('input', renderNewsEditor);
  elements.newsEditor.addEventListener('submit', (event) => event.preventDefault());
  elements.newsConflictReload.addEventListener('click', () => {
    if (!news.conflict) return;
    upsertNews(news.conflict);
    fillNews(news.conflict);
    say(elements.newsStatus, 'ops.news.loaded');
  });
  elements.newsConflictOverwrite.addEventListener('click', () => {
    if (!news.conflict) return;
    // A new post whose earlier save is stored has no current item yet: the stored one becomes it, so this save edits it.
    news.current = { ...(news.current || news.conflict), version: news.conflict.version };
    news.conflict = null;
    elements.newsConflict.hidden = true;
    return saveNews(news.pending);
  });

  elements.signOut.addEventListener('click', async () => {
    elements.signOut.disabled = true;
    say(elements.editorStatus, 'ops.signingOut');
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw apiError({}, 'ops.signOutFailed', response.status);
      location.assign('/login.html');
    } catch (error) {
      elements.signOut.disabled = false;
      report(elements.editorStatus, error, 'ops.signOutUnavailable');
    }
  });

  /* The tab row scrolls sideways when its labels do not fit (phones; tablets in Spanish or Portuguese).
     It is then marked, so CSS fades the edge that hides more tabs. When everything fits, the last tab
     sits at the row's end (8px padding), so its edge tells whether the labels overflow, whatever end
     padding the overflow state adds. */
  let updateTabRow = () => {};
  function watchLayout() {
    const list = elements.tabList;
    const last = list.lastElementChild;
    if (!last?.getBoundingClientRect) return;
    updateTabRow = () => {
      const end = last.getBoundingClientRect().right - list.getBoundingClientRect().left + list.scrollLeft;
      const overflowing = end > list.clientWidth - 8 + 1;
      list.classList.toggle('is-overflowing', overflowing);
      list.classList.toggle('is-scrolled', overflowing && list.scrollLeft > 1);
    };
    list.addEventListener('scroll', updateTabRow, { passive: true });
    document.fonts?.ready?.then(updateTabRow);
    updateTabRow();
    if (!('ResizeObserver' in window)) return;
    new ResizeObserver(updateTabRow).observe(list);
    // The lists' heights follow the window (the catalog index is as tall as the screen), and their fades follow their heights.
    const lists = new ResizeObserver((entries) => entries.forEach((entry) => markClipped(entry.target)));
    lists.observe(elements.list);
    lists.observe(elements.newsList);
  }

  I18N?.onChange(() => {
    for (const [node, [key, vars]] of messages) node.textContent = t(key, vars);
    updateTabRow();
    renderRecordState();
    renderCatalogList();
    renderGate();
    renderInterestList();
    renderNewsList();
    renderNewsEditor();
    if (!elements.previewPanel.hidden) renderPreview({ scroll: false });
  });

  /* The tab row follows the reader, as on the organiser dashboard: the section
     crossing a thin band a third of the way down the screen is the current one.
     The last section is short, so once it is wholly on screen the page has
     reached its end and that tab is marked instead. */
  function trackSections() {
    if (!('IntersectionObserver' in window)) return;
    const tabs = new Map([['news', elements.tabNews], ['catalog', elements.tabCatalog], ['interests', elements.tabInterests]]);
    const sections = [...tabs.keys()].map((id) => byId(id)).filter(Boolean);
    if (sections.length !== tabs.size) return;
    const crossing = new Set();
    let atEnd = false;
    const mark = () => {
      const current = atEnd ? sections.at(-1).id : [...tabs.keys()].find((id) => crossing.has(id));
      if (!current) return;
      for (const [id, tab] of tabs) {
        if (id === current) tab.setAttribute('aria-current', 'true');
        else tab.removeAttribute('aria-current');
      }
    };
    const band = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) crossing.add(entry.target.id);
        else crossing.delete(entry.target.id);
      }
      mark();
    }, { rootMargin: '-35% 0px -64% 0px' });
    for (const section of sections) band.observe(section);
    new IntersectionObserver(([entry]) => {
      atEnd = entry.intersectionRatio > 0.99;
      mark();
    }, { threshold: [0, 1] }).observe(sections.at(-1));
  }

  async function bootstrap() {
    fillEditor(blankRecord());
    fillNews(null);
    trackSections();
    watchLayout();
    await Promise.allSettled([loadNews(), loadCatalog(), loadInterests()]);
  }

  bootstrap();
})();
