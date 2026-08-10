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
    startsAt: byId('adminStartsAt'),
    deadlineAt: byId('adminDeadlineAt'),
    endDate: byId('adminEndDate'),
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
  };

  if (Object.values(elements).some((element) => !element)) return;

  const state = {
    items: [],
    current: null,
    conflictCurrent: null,
    catalogController: null,
    interestController: null,
    catalogRequest: 0,
    interestRequest: 0,
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
      deadlineAt: null, endDate: null, sourceUrl: '', sourceVerifiedAt: null,
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

  function serializeEditor(status) {
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
      topics: elements.topics.value.split(/[,\n]/).map(text).filter(Boolean).slice(0, 8),
      startsAt: apiDate(elements.startsAt.value, true),
      deadlineAt: apiDate(elements.deadlineAt.value, true),
      endDate: apiDate(elements.endDate.value),
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
    elements.sourceUrl.value = item.sourceUrl || '';
    elements.sourceVerifiedAt.value = localDate(item.sourceVerifiedAt);
    elements.actionMode.value = item.actionMode || 'none';
    elements.actionUrl.value = item.actionUrl || '';
    elements.featured.checked = Boolean(item.featured);
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

  async function loadCatalog() {
    if (state.catalogController) state.catalogController.abort();
    const controller = new AbortController();
    state.catalogController = controller;
    const sequence = state.catalogRequest + 1;
    state.catalogRequest = sequence;
    const params = new URLSearchParams({ state: 'all', limit: '24' });
    const query = text(elements.query.value);
    if (query) params.set('q', query);
    if (elements.kindFilter.value) params.set('kind', elements.kindFilter.value);
    if (elements.statusFilter.value) params.set('status', elements.statusFilter.value);
    elements.listStatus.textContent = 'Loading catalog records…';
    elements.list.setAttribute('aria-busy', 'true');
    try {
      const { response, data } = await request(`/api/admin/catalog?${params}`, { signal: controller.signal });
      if (sequence !== state.catalogRequest) return;
      if (!response.ok) throw new Error(data.error || `Catalog request failed (${response.status}).`);
      state.items = Array.isArray(data.items) ? data.items : [];
      renderCatalogList();
      elements.listStatus.textContent = state.items.length ? `${state.items.length} records loaded.` : 'No catalog records match these filters.';
    } catch (error) {
      if (error.name === 'AbortError' || sequence !== state.catalogRequest) return;
      state.items = [];
      renderCatalogList();
      elements.listStatus.textContent = error.message || 'Catalog records are unavailable.';
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
    const payload = serializeEditor(status);
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
    const status = state.current?.status || 'draft';
    const item = serializeEditor(status);
    const labels = { en: 'EN · English', es: 'ES · Spanish', pt: 'PT · Portuguese' };
    const cards = Object.entries(item.translations).map(([lang, row]) => {
      const card = create('article', 'admin-preview-card');
      card.append(create('span', 'admin-kicker', labels[lang]));
      card.append(create('h3', null, row.title || 'Untitled'));
      card.append(create('p', 'admin-preview-summary', row.summary || 'No summary entered.'));
      card.append(create('p', null, row.body || 'No body entered.'));
      card.append(create('p', null, row.cta ? `CTA: ${row.cta}` : 'No CTA label entered.'));
      if (item.sourceUrl) {
        const link = create('a', null, item.sourceUrl);
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
    article.append(create('h3', null, interest.member?.name || 'Member name unavailable'));
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
          elements.interestStatus.textContent = 'This interest changed on the server. The queue has been reloaded.';
          await loadInterests();
          return;
        }
        if (!response.ok) throw new Error(data.error || `Update failed (${response.status}).`);
        interest.status = data.interest.status;
        interest.version = data.interest.version;
        elements.interestStatus.textContent = 'Interest status updated.';
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

  async function loadInterests() {
    if (state.interestController) state.interestController.abort();
    const controller = new AbortController();
    state.interestController = controller;
    const sequence = state.interestRequest + 1;
    state.interestRequest = sequence;
    const params = new URLSearchParams({ limit: '24' });
    if (elements.interestFilter.value) params.set('status', elements.interestFilter.value);
    elements.interestStatus.textContent = 'Loading member interests…';
    elements.interestList.setAttribute('aria-busy', 'true');
    try {
      const { response, data } = await request(`/api/admin/interests?${params}`, { signal: controller.signal });
      if (sequence !== state.interestRequest) return;
      if (!response.ok) throw new Error(data.error || `Interest request failed (${response.status}).`);
      const interests = Array.isArray(data.interests) ? data.interests : [];
      elements.interestList.replaceChildren(...interests.map(renderInterest));
      elements.interestList.setAttribute('aria-busy', 'false');
      elements.interestStatus.textContent = interests.length ? `${interests.length} interests loaded.` : 'No member interests match this queue status.';
    } catch (error) {
      if (error.name === 'AbortError' || sequence !== state.interestRequest) return;
      elements.interestList.replaceChildren();
      elements.interestList.setAttribute('aria-busy', 'false');
      elements.interestStatus.textContent = error.message || 'Member interests are unavailable.';
    }
  }

  let filterTimer = null;
  elements.filters.addEventListener('submit', (event) => { event.preventDefault(); loadCatalog(); });
  elements.query.addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(loadCatalog, 250);
  });
  elements.kindFilter.addEventListener('change', loadCatalog);
  elements.statusFilter.addEventListener('change', loadCatalog);
  elements.interestFilter.addEventListener('change', loadInterests);
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

  async function bootstrap() {
    fillEditor(blankRecord());
    await Promise.all([loadCatalog(), loadInterests()]);
  }

  bootstrap();
})();
