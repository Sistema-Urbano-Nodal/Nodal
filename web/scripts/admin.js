/* Protected catalog operations workspace. The server validates authorization,
   publication requirements, optimistic versions, and every persisted value. */
(() => {
  'use strict';

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
    interestFilter: byId('adminInterestFilter'),
    interestList: byId('adminInterestList'),
    interestStatus: byId('adminInterestStatus'),
    interestMore: byId('adminInterestMore'),
    signOut: byId('adminSignOut'),
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
  };

  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const text = (value) => String(value ?? '').trim();
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
      return { response, data: { error: 'Sign in required.' } };
    }
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

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
    if (topics.length > 8) error = 'Enter at most 8 topics.';
    else if (topics.some((topic) => topic.length > 60)) error = 'Each topic must contain at most 60 characters.';
    elements.topicsError.textContent = error;
    elements.topicsError.hidden = !error;
    elements.topics.setAttribute('aria-invalid', String(Boolean(error)));
    if (error) {
      elements.editorStatus.textContent = 'Fix the topic list before previewing or saving.';
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
  }

  function fillEditor(record) {
    const item = { ...blankRecord(), ...(record || {}), translations: { ...emptyTranslations(), ...(record?.translations || {}) } };
    state.current = item.id ? item : null;
    state.conflictCurrent = null;
    elements.conflictPanel.hidden = true;
    elements.id.value = item.id || '';
    elements.version.textContent = item.version ? String(item.version) : '—';
    elements.recordState.textContent = item.id ? `${item.status} · ${item.id}` : 'New draft';
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
    elements.topicsError.textContent = '';
    elements.topics.setAttribute('aria-invalid', 'false');
    fillTranslation('En', item.translations.en);
    fillTranslation('Es', item.translations.es);
    fillTranslation('Pt', item.translations.pt);
    updateConditionalFields();
    renderCatalogList();
    elements.editorStatus.textContent = item.id ? 'Record loaded. Edits are not saved until you choose an action.' : 'New draft ready.';
  }

  function catalogLabel(item) {
    return item.translations?.en?.title || item.translations?.es?.title || item.translations?.pt?.title || 'Untitled draft';
  }

  function renderCatalogList() {
    const nodes = state.items.map((item) => {
      const button = create('button', 'admin-record');
      button.type = 'button';
      button.classList.toggle('is-selected', item.id === elements.id.value);
      button.append(create('strong', null, catalogLabel(item)));
      button.append(create('span', null, [item.organization, item.location].filter(Boolean).join(' · ') || 'Organization and place not set'));
      const meta = create('span', 'admin-record-meta');
      for (const value of [item.kind?.replaceAll('_', ' '), item.status, item.visibility, item.featured ? 'featured' : '']) {
        if (value) meta.append(create('i', null, value));
      }
      button.append(meta);
      button.addEventListener('click', () => fillEditor(item));
      return button;
    });
    elements.list.replaceChildren(...nodes);
    elements.list.setAttribute('aria-busy', 'false');
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
    elements.listStatus.textContent = 'Loading catalog records…';
    elements.list.setAttribute('aria-busy', 'true');
    try {
      const { response, data } = await request(`/api/admin/catalog?${params}`, { signal: controller.signal });
      if (sequence !== state.catalogRequest || state.catalogFilterKey !== snapshotKey
        || filterKey(catalogFilterSnapshot()) !== snapshotKey) return false;
      if (!response.ok) throw new Error(data.error || `Catalog request failed (${response.status}).`);
      const items = Array.isArray(data.items) ? data.items : [];
      state.items = append ? [...state.items, ...items] : items;
      state.catalogCursor = data.nextCursor || null;
      elements.catalogMore.hidden = !state.catalogCursor;
      renderCatalogList();
      elements.listStatus.textContent = state.items.length ? `${state.items.length} records loaded.` : 'No catalog records match these filters.';
      return true;
    } catch (error) {
      if (error.name === 'AbortError' || sequence !== state.catalogRequest || state.catalogFilterKey !== snapshotKey) return false;
      if (!append) {
        state.items = [];
        state.catalogCursor = null;
        elements.catalogMore.hidden = true;
        renderCatalogList();
      }
      elements.listStatus.textContent = error.message || 'Catalog records are unavailable.';
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
    elements.editorStatus.textContent = 'Save stopped: another editor changed this record. Your unsaved content is preserved.';
  }

  async function saveCatalog(status) {
    if (state.busy) return;
    const topics = validateEditorTopics();
    if (!topics) return;
    const payload = serializeEditor(status, topics);
    const currentId = elements.id.value;
    const version = Number(elements.version.textContent);
    const editing = Boolean(currentId);
    if (editing && (!Number.isInteger(version) || version < 1)) {
      elements.editorStatus.textContent = 'Reload this record before saving because its version is missing.';
      return;
    }
    setBusy(true);
    elements.editorStatus.textContent = status === 'published' ? 'Validating and publishing…' : status === 'archived' ? 'Archiving record…' : 'Saving draft…';
    try {
      const { response, data } = await request(editing ? `/api/admin/catalog/${encodeURIComponent(currentId)}` : '/api/admin/catalog', {
        method: editing ? 'PATCH' : 'POST',
        body: JSON.stringify(editing ? { ...payload, version } : payload),
      });
      if (response.status === 409) {
        showCatalogConflict(data.current);
        return;
      }
      if (!response.ok) throw new Error(data.error || `Save failed (${response.status}).`);
      fillEditor(data.item);
      elements.editorStatus.textContent = status === 'published' ? 'Published successfully.' : status === 'archived' ? 'Archived. The record remains in editorial history.' : 'Draft saved.';
      await loadCatalog();
    } catch (error) {
      elements.editorStatus.textContent = error.message || 'The record could not be saved.';
    } finally {
      setBusy(false);
    }
  }

  function renderPreview() {
    const topics = validateEditorTopics();
    if (!topics) {
      elements.previewPanel.hidden = true;
      return;
    }
    const status = state.current?.status || 'draft';
    const item = serializeEditor(status, topics);
    const labels = { en: 'EN · English', es: 'ES · Spanish', pt: 'PT · Portuguese' };
    const cards = Object.entries(item.translations).map(([lang, row]) => {
      const card = create('article', 'admin-preview-card');
      card.append(create('span', 'admin-kicker', labels[lang]));
      card.append(create('h3', null, row.title || 'Untitled'));
      card.append(create('p', 'admin-preview-summary', row.summary || 'No summary entered.'));
      card.append(create('p', null, row.body || 'No body entered.'));
      card.append(create('p', null, row.cta ? `CTA: ${row.cta}` : 'No CTA label entered.'));
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
    elements.previewPanel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  function renderInterest(interest) {
    const article = create('article', 'admin-interest');
    const item = interest.item || {};
    article.append(create('p', 'admin-interest-item-kind', [item.kind?.replaceAll('_', ' '), item.organization].filter(Boolean).join(' · ')));
    article.append(create('h3', 'admin-interest-item-title', item.title || 'Catalog item unavailable'));
    if (item.itemId) article.append(create('p', 'admin-interest-item-id', item.itemId));
    article.append(create('h4', null, interest.member?.name || 'Member name unavailable'));
    const email = create('a', null, interest.member?.email || 'Email unavailable');
    if (interest.member?.email) email.href = `mailto:${interest.member.email}`;
    article.append(email);
    article.append(create('p', null, interest.message || 'No member message.'));
    const controls = create('div', 'admin-interest-controls');
    const label = create('label');
    label.append(create('span', null, 'Queue status'));
    const select = create('select');
    for (const status of ['new', 'contacted', 'closed', 'withdrawn']) {
      const option = create('option', null, status.charAt(0).toUpperCase() + status.slice(1));
      option.value = status;
      option.selected = status === interest.status;
      select.append(option);
    }
    label.append(select);
    const save = create('button', 'admin-button admin-button-quiet', 'Update');
    save.type = 'button';
    save.addEventListener('click', async () => {
      save.disabled = true;
      elements.interestStatus.textContent = 'Updating interest status…';
      try {
        const { response, data } = await request(`/api/admin/interests/${encodeURIComponent(interest.id)}`, {
          method: 'PATCH', body: JSON.stringify({ status: select.value, version: interest.version }),
        });
        if (response.status === 409) {
          elements.interestStatus.textContent = 'This interest changed on the server. Reloading the queue…';
          await loadInterests();
          return;
        }
        if (!response.ok) throw new Error(data.error || `Update failed (${response.status}).`);
        interest.status = data.interest.status;
        interest.version = data.interest.version;
        const refreshed = await loadInterests();
        if (refreshed) elements.interestStatus.textContent = 'Interest status updated. The active queue filter has been reapplied.';
      } catch (error) {
        elements.interestStatus.textContent = error.message || 'Interest status could not be updated.';
      } finally {
        save.disabled = false;
      }
    });
    controls.append(label, save);
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
    elements.interestStatus.textContent = 'Loading member interests…';
    elements.interestList.setAttribute('aria-busy', 'true');
    try {
      const { response, data } = await request(`/api/admin/interests?${params}`, { signal: controller.signal });
      if (sequence !== state.interestRequest || state.interestFilterKey !== snapshotKey
        || filterKey(interestFilterSnapshot()) !== snapshotKey) return false;
      if (!response.ok) throw new Error(data.error || `Interest request failed (${response.status}).`);
      const interests = Array.isArray(data.interests) ? data.interests : [];
      state.interests = append ? [...state.interests, ...interests] : interests;
      state.interestCursor = data.nextCursor || null;
      elements.interestMore.hidden = !state.interestCursor;
      renderInterestList();
      elements.interestStatus.textContent = state.interests.length ? `${state.interests.length} interests loaded.` : 'No member interests match this queue status.';
      return true;
    } catch (error) {
      if (error.name === 'AbortError' || sequence !== state.interestRequest || state.interestFilterKey !== snapshotKey) return false;
      if (!append) {
        state.interests = [];
        state.interestCursor = null;
        elements.interestMore.hidden = true;
        renderInterestList();
      } else elements.interestList.setAttribute('aria-busy', 'false');
      elements.interestStatus.textContent = error.message || 'Member interests are unavailable.';
      throw error;
    } finally {
      if (sequence === state.interestRequest && state.interestFilterKey === snapshotKey) {
        elements.interestList.setAttribute('aria-busy', 'false');
        if (state.interestController === controller) state.interestController = null;
      }
    }
  }

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
  elements.newItem.addEventListener('click', () => fillEditor(blankRecord()));
  elements.saveDraft.addEventListener('click', () => saveCatalog('draft'));
  elements.publish.addEventListener('click', () => saveCatalog('published'));
  elements.archive.addEventListener('click', () => saveCatalog('archived'));
  elements.saveFeature.addEventListener('click', () => saveCatalog(state.current?.status || 'draft'));
  elements.preview.addEventListener('click', renderPreview);
  elements.previewClose.addEventListener('click', () => { elements.previewPanel.hidden = true; });
  elements.conflictReload.addEventListener('click', () => {
    if (state.conflictCurrent) fillEditor(state.conflictCurrent);
  });
  elements.editor.addEventListener('submit', (event) => event.preventDefault());
  elements.signOut.addEventListener('click', async () => {
    elements.signOut.disabled = true;
    elements.editorStatus.textContent = 'Signing out…';
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Sign out failed (${response.status}).`);
      location.assign('/login.html');
    } catch (error) {
      elements.signOut.disabled = false;
      elements.editorStatus.textContent = error.message || 'Sign out failed.';
    }
  });

  async function bootstrap() {
    fillEditor(blankRecord());
    await Promise.allSettled([loadCatalog(), loadInterests()]);
  }

  bootstrap();
})();
