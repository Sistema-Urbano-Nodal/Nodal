(() => {
  'use strict';

  const detail = document.getElementById('detail');
  const inbox = document.getElementById('inbox-list');
  let threadId, projectId, tab, viewVersion = 0;
  let actor, listing, opened, timeline, controls, earlier, renderedStatus, pollRunning = false;
  let lastInbox = '', lastMessages = '', inboxRequest = 0;

  const language = () => window.nodalI18n?.lang || document.documentElement.lang || 'en';
  function t(key, vars = {}) {
    const row = window.nodalMessagesText[key];
    const text = row?.[{ en: 0, es: 1, pt: 2 }[language()]] || row?.[0] || key;
    return text.replace(/\{(\w+)\}/g, (match, name) => String(vars[name] ?? match));
  }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function translate(n, key, vars) {
    n.dataset.msg = key;
    n.msgVars = vars;
    n.textContent = t(key, vars);
    return n;
  }
  const tr = (tag, cls, key, vars) => translate(el(tag, cls), key, vars);
  const named = (tag, cls, name, fallback) => name ? el(tag, cls, name) : tr(tag, cls, fallback);
  function url(args = {}) {
    const query = new URLSearchParams(args);
    return 'messages.html' + (query.size ? '?' + query : '');
  }
  function nav(label, args, cls = 'back') {
    const a = tr('a', cls, label);
    a.href = url(args);
    return a;
  }
  function button(label, cls = 'primary', vars) {
    const b = tr('button', 'button ' + cls, label, vars);
    b.type = 'button';
    return b;
  }
  function feedback(container, key, error = false) {
    const msg = tr('p', error ? 'error' : 'notice', key);
    msg.setAttribute('role', error ? 'alert' : 'status');
    container.replaceChildren(msg);
  }
  const errorKey = (err) => ({
    400: 'invalid', 403: 'unavailable', 404: 'unavailable', 409: 'conflict',
    413: 'invalid', 429: 'rate'
  }[err.status] || 'failed');
  async function api(path, data, signal) {
    const options = { credentials: 'same-origin', cache: 'no-store', signal };
    if (data) Object.assign(options, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    const response = await fetch(path, options);
    if (response.status === 401) {
      location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
    }
    if (!response.ok) throw Object.assign(new Error('Request failed'), { status: response.status });
    return response.json();
  }
  const command = (op, data) => api('/api/workspace', { op, ...data });
  const fetchThread = beforeMessageId => api('/api/workspace?' + new URLSearchParams(
    beforeMessageId ? { threadId, beforeMessageId } : { threadId }));
  const go = (args) => location.assign(url(args));
  function personMeta(person) {
    const meta = el('span', 'meta');
    if (person.role && person.role !== 'Member') meta.append(person.role);
    else meta.append(tr('span', '', 'member'));
    if (person.city) meta.append(' · ' + person.city);
    return meta;
  }
  const activeMembers = () => opened.members.filter(m => m.status === 'active');
  function identity(name, group = false) {
    const initials = (name || '').trim().split(/\s+/).slice(0, 2).map(word => [...word][0] || '').join('').toLocaleUpperCase();
    const icon = el('span', 'avatar' + (group ? ' group' : ''), initials || '·');
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }
  function personIcon(person) {
    const icon = identity(person.name);
    if (person.photoUrl?.startsWith('/api/users/' + encodeURIComponent(person.id) + '/photo?v=')) {
      const photo = el('img');
      photo.alt = '';
      photo.addEventListener('error', () => photo.remove(), { once: true });
      photo.src = person.photoUrl;
      icon.append(photo);
    }
    return icon;
  }
  function section(key) {
    const s = el('section', 'section');
    s.append(tr('h3', '', key));
    return s;
  }
  function disclosure(label, content) {
    const d = el('details', 'disclosure');
    d.append(tr('summary', '', label), content);
    return d;
  }
  function field(form, label, type, limit, required = true) {
    const wrap = el('label', 'field');
    const control = el(type === 'textarea' || type === 'select' ? type : 'input');
    if (control.tagName === 'INPUT') control.type = type;
    if (limit) control.maxLength = limit;
    control.required = required;
    wrap.append(tr('span', '', label), control);
    form.append(wrap);
    return control;
  }
  // A lost response can be retried with the same key while the same form stays open.
  // Editing the payload starts a new operation. The draft stays in the DOM on error.
  function bindWrite(form, label, op, payload, done, idempotent = false) {
    const send = button(label), status = el('div');
    send.type = 'submit';
    form.append(send, status);
    let previous, clientId, pending = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (pending) return;
      const data = payload();
      if (typeof data === 'string') { feedback(status, data, true); return; }
      if (idempotent) {
        const signature = JSON.stringify(data);
        if (signature !== previous) { clientId = crypto.randomUUID(); previous = signature; }
        data.clientId = clientId;
      }
      pending = true;
      send.disabled = true;
      status.replaceChildren();
      try {
        const result = await command(op, data);
        if (form.isConnected) await done(result);
      } catch (err) { feedback(status, errorKey(err), true); }
      finally { pending = false; send.disabled = false; }
    });
  }
  function action(label, cls, op, data, done, confirmKey) {
    const area = el('div'), b = button(label, cls), status = el('div');
    area.append(b, status);
    b.addEventListener('click', async () => {
      if (confirmKey && !window.confirm(t(confirmKey))) return;
      b.disabled = true;
      status.replaceChildren();
      try { await command(op, data); if (area.isConnected) await done(); }
      catch (err) { feedback(status, errorKey(err), true); }
      finally { b.disabled = false; }
    });
    return area;
  }
  function searchPicker(host, addPerson, selectedLabel = () => null, inInbox = false) {
    // Direct recipients are links to a draft or an existing thread. Group pickers select in place.
    const direct = !addPerson;
    const search = field(host, inInbox ? 'searchByName' : direct ? 'to' : 'name', 'search', 160, false);
    search.autocomplete = 'off';
    if (direct) {
      search.className = 'recipient-search';
      search.dataset.msgPlaceholder = 'searchByName';
      search.placeholder = t('searchByName');
    }
    const results = el('div', direct ? 'result-list recipient-list' : 'result-list');
    const heading = direct && !inInbox ? tr('h3', 'recipient-list-heading', 'networkPeople') : null;
    const status = el('p', 'meta');
    status.setAttribute('role', 'status');
    if (heading) { heading.hidden = true; host.append(heading); }
    status.hidden = true;
    host.append(status, results);
    let timer, controller;

    function showStatus(key, error = false) {
      status.hidden = !key;
      status.className = error ? 'error' : 'meta';
      status.setAttribute('role', error ? 'alert' : 'status');
      if (key) translate(status, key);
      else { delete status.dataset.msg; status.textContent = ''; }
    }

    function personRow(person) {
      const row = el(direct ? 'a' : 'button', direct ? 'result recipient-option' : 'result');
      const lines = el('span', 'row-text');
      lines.append(el('strong', 'thread-name', person.name), personMeta(person));
      row.append(personIcon(person), lines);
      if (direct) {
        const existing = listing.threads.find(th => th.kind === 'direct' && th.peerId === person.id);
        row.href = url(existing ? { thread: existing.id } : { to: person.id });
        return row;
      }
      row.type = 'button';
      const selected = selectedLabel(person.id);
      if (selected) { row.disabled = true; row.append(tr('span', 'meta', selected)); }
      row.addEventListener('click', async event => {
        row.disabled = true;
        try {
          await addPerson(person);
        } catch (err) {
          row.disabled = false;
          showStatus(errorKey(err), true);
          return;
        }
        controller?.abort();
        search.value = '';
        results.replaceChildren();
        showStatus();
        if (event.detail === 0 && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
          search.focus({ preventScroll: true });
        }
      });
      return row;
    }

    async function loadPeople(q, signal) {
      try {
        // The directory page can include the viewer, so fetch six to show up to five other members.
        const data = q ? await api('/api/users/search', { q }, signal) : await api('/api/users?limit=6', undefined, signal);
        if (signal.aborted) return;
        const matches = data.users.filter(person => person.id !== actor.id);
        const people = q ? matches : matches.slice(0, 5);
        const otherThreads = inInbox && q ? listing.threads.filter(th =>
          th.name?.toLocaleLowerCase().includes(q.toLocaleLowerCase())
          && !people.some(person => th.peerId === person.id)) : [];
        showStatus(people.length || otherThreads.length ? null : q ? 'noMatches' : 'emptyDirectory');
        if (heading) heading.hidden = Boolean(q) || !people.length;
        results.replaceChildren(...otherThreads.map(threadRow), ...people.map(personRow));
      } catch (err) {
        if (!signal.aborted) showStatus(errorKey(err), true);
      }
    }
    function searchNow() {
      clearTimeout(timer);
      controller?.abort();
      results.replaceChildren();
      if (heading) heading.hidden = true;
      const q = search.value.trim();
      if (inInbox) {
        inbox.hidden = Boolean(q);
        if (!q) { showStatus(); return; }
      }
      if ((q || !direct) && q.length < 2) {
        showStatus(q ? 'shortName' : null);
        return;
      }
      const current = new AbortController();
      controller = current;
      showStatus('loading');
      if (q) timer = setTimeout(() => loadPeople(q, current.signal), 220);
      else loadPeople('', current.signal);
    }
    search.addEventListener('keydown', event => {
      if (event.key === 'Enter') event.preventDefault();
      if (event.key === 'Escape' && inInbox) { search.value = ''; searchNow(); }
    });
    search.addEventListener('input', searchNow);
    if (direct) searchNow();
    return search;
  }
  function inboxDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const today = date.toDateString() === new Date().toDateString();
    return date.toLocaleString(language(), today ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' });
  }
  function threadRow(thread) {
    const link = el('a', 'thread-row');
    link.href = url({ thread: thread.id });
    if (thread.id === threadId) link.setAttribute('aria-current', 'page');
    const group = thread.kind === 'group';
    const lines = el('span', 'row-text');
    const top = el('span', 'thread-top');
    top.append(named('strong', 'thread-name', thread.name, group ? 'privateGroup' : 'accountGone'));
    const last = thread.lastMessage;
    if (last?.createdAt) {
      const time = el('time', 'inbox-date', inboxDate(last.createdAt));
      time.dateTime = last.createdAt;
      top.append(time);
    }
    const preview = el('span', 'thread-snippet');
    if (thread.status === 'blocked') translate(preview, 'blocked');
    else if (last) {
      if (last.authorId === actor.id) preview.append(tr('span', 'snippet-prefix', 'youPrefix'));
      if (last.body) preview.append(last.body);
      else if (last.hasAttachments) preview.append(tr('span', '', 'attachmentPreview'));
    } else translate(preview, thread.status === 'active' ? thread.kind : thread.status);
    if (thread.unread) {
      link.classList.add('is-unread');
      top.append(tr('span', 'unread', 'unread'));
    }
    lines.append(top, preview);
    link.append(group ? identity(thread.name, true) : personIcon({ id: thread.peerId, name: thread.name, photoUrl: thread.photoUrl }), lines);
    return link;
  }
  function paintInbox(force = false) {
    const stamp = JSON.stringify(listing) + threadId;
    if (!force && stamp === lastInbox) return;
    lastInbox = stamp;
    const invitationsOpen = inbox.querySelector('details')?.open;
    inbox.replaceChildren();
    if (listing.threads.length) {
      inbox.append(...listing.threads.map(threadRow));
    } else {
      inbox.append(tr('p', 'inbox-empty', 'noThreads'));
    }
    if (listing.invitations.length) {
      const invites = el('details', 'inbox-invitations');
      invites.open = invitationsOpen ?? !listing.threads.length;
      invites.append(tr('summary', 'inbox-group', 'invitationsCount', { count: listing.invitations.length }));
      for (const invitation of listing.invitations) {
        const card = el('article', 'invitation');
        const buttons = el('div', 'actions');
        buttons.append(action('accept', 'primary', 'accept', { threadId: invitation.id }, () => go({ thread: invitation.id })),
          action('decline', 'quiet', 'decline', { threadId: invitation.id }, refreshInbox));
        card.append(named('strong', 'thread-name', invitation.name, 'privateGroup'), tr('p', 'meta', 'invitedBy', { name: invitation.inviterName }), buttons);
        invites.append(card);
      }
      inbox.append(invites);
    }
  }
  async function refreshInbox() {
    const request = ++inboxRequest;
    const result = await api('/api/workspace');
    if (request !== inboxRequest) return;
    listing = result;
    paintInbox();
  }
  const chatFileTypes = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const chatUuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
  const fileCountLimit = 4, fileBytesLimit = 3 * 1024 * 1024;
  function fileSize(bytes) {
    const unit = bytes < 1024 ? 'byte' : bytes < 1024 * 1024 ? 'kilobyte' : 'megabyte';
    const divisor = unit === 'byte' ? 1 : unit === 'kilobyte' ? 1000 : 1000000;
    return new Intl.NumberFormat(language(), { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 1 }).format(bytes / divisor);
  }
  function sizeLabel(bytes) {
    const n = el('small', 'file-size', fileSize(bytes));
    n.dataset.fileBytes = String(bytes);
    return n;
  }
  const iconPaths = {
    clip: 'm20.5 11.5-8.5 8.5a5.25 5.25 0 0 1-7.42-7.42l8.78-8.78a3.5 3.5 0 0 1 4.95 4.95l-8.78 8.78a1.75 1.75 0 0 1-2.48-2.48l8-8',
    image: 'M5 3.5h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z M3 16l5-5 4.5 4.5 3-3 5.5 5.5 M14.5 8a1.25 1.25 0 1 0 2.5 0 1.25 1.25 0 1 0-2.5 0z',
    send: 'm21 3-7.1 17.8-3.2-7.5L3.2 10 21 3z M10.7 13.3 20 4',
    close: 'M6 6l12 12 M18 6 6 18',
    file: 'M5 3h9l5 5v13H5z M14 3v5h5 M8 12h8 M8 16h6',
  };
  function chatIcon(kind) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'composer-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', iconPaths[kind]);
    svg.append(path);
    return svg;
  }
  function iconButton(kind, key, cls, { shortLabel, vars } = {}) {
    const b = el('button', cls);
    b.type = 'button';
    b.title = t(key, vars);
    b.dataset.chatTitle = key;
    b.msgVars = vars;
    b.append(chatIcon(kind));
    if (shortLabel) {
      const visible = tr('span', 'composer-action-text', shortLabel);
      visible.setAttribute('aria-hidden', 'true');
      b.append(visible);
    }
    b.append(tr('span', 'visually-hidden', key, vars));
    return b;
  }
  function encodeChatFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('File read failed'));
      reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
      reader.readAsDataURL(file);
    });
  }
  function chatComposer(op, destination) {
    const form = el('form', 'form chat-composer');
    const queue = el('div', 'composer-files');
    const bar = el('div', 'composer-bar');
    const pickers = el('div', 'composer-attachments');
    const photo = iconButton('image', 'attachImages', 'attach-image', { shortLabel: 'photoAction' });
    const attach = iconButton('clip', 'attachFiles', 'attach-file', { shortLabel: 'fileAction' });
    const label = tr('label', 'visually-hidden', 'message');
    const input = el('textarea', 'message-input');
    input.id = 'workspace-message-input';
    input.name = 'message';
    input.rows = 1;
    input.maxLength = 4000;
    input.placeholder = t('writeMessage');
    label.htmlFor = input.id;
    const send = iconButton('send', 'send', 'button primary composer-send send-message', { shortLabel: 'sendAction' });
    send.type = 'submit';
    const status = el('div', 'composer-status');
    let files = [], reading = false, sending = false, retryId = null;

    function syncButtons() {
      attach.disabled = photo.disabled = reading || sending;
      send.disabled = reading || sending || (!files.length && !input.value.trim());
      input.readOnly = sending;
      for (const b of queue.querySelectorAll('button')) b.disabled = sending || reading;
    }
    function renderFiles() {
      queue.replaceChildren();
      for (const file of files) {
        const chip = el('div', 'composer-file');
        if (imageTypes.has(file.mime)) {
          const thumb = el('img', 'composer-thumb');
          thumb.alt = '';
          thumb.src = 'data:' + file.mime + ';base64,' + file.data;
          chip.append(thumb);
        } else chip.append(chatIcon('file'));
        const info = el('span', 'file-info');
        info.append(el('span', 'file-name', file.name), sizeLabel(file.size));
        const remove = iconButton('close', 'remove', 'remove-file', { vars: { name: file.name } });
        remove.addEventListener('click', () => {
          files = files.filter(item => item !== file);
          retryId = null;
          status.replaceChildren();
          renderFiles();
          attach.focus({ preventScroll: true });
        });
        chip.append(info, remove); queue.append(chip);
      }
      queue.hidden = !files.length;
      syncButtons();
    }
    async function chooseFiles(items) {
      if (!items.length || sending || reading) return;
      const totalBytes = [...files, ...items].reduce((total, item) => total + item.size, 0);
      if (files.length + items.length > fileCountLimit) { feedback(status, 'tooManyChatFiles', true); return; }
      if (totalBytes > fileBytesLimit) { feedback(status, 'chatFilesTooLarge', true); return; }
      const chosen = [];
      for (const source of items) {
        const ext = source.name.split('.').pop().toLowerCase();
        const mime = Object.hasOwn(chatFileTypes, ext) ? chatFileTypes[ext] : source.type;
        if (!source.name.trim() || source.name.length > 160) { feedback(status, 'chatFileName', true); return; }
        if (!Object.values(chatFileTypes).includes(mime)) { feedback(status, 'chatFileType', true); return; }
        if (!source.size) { feedback(status, 'chatEmptyFile', true); return; }
        chosen.push({ name: source.name, mime, size: source.size, source });
      }
      reading = true;
      syncButtons();
      status.replaceChildren();
      try {
        const prepared = await Promise.all(chosen.map(async ({ source, ...item }) => ({ ...item, data: await encodeChatFile(source) })));
        files.push(...prepared);
        retryId = null;
      } catch { feedback(status, 'chatReadFileError', true); }
      finally { reading = false; renderFiles(); }
    }
    function picker(trigger, accept) {
      const fileInput = el('input', 'chat-file-picker');
      fileInput.type = 'file'; fileInput.hidden = true; fileInput.multiple = true; fileInput.accept = accept;
      trigger.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        const picked = Array.from(fileInput.files || []);
        fileInput.value = '';
        chooseFiles(picked);
      });
      return fileInput;
    }
    const filePicker = picker(attach, Object.keys(chatFileTypes).map(ext => '.' + ext).join(','));
    const imagePicker = picker(photo, [...imageTypes].join(','));
    pickers.append(photo, attach);
    bar.append(label, input, pickers, send);
    form.append(queue, bar, filePicker, imagePicker, status);
    queue.hidden = true;
    input.addEventListener('paste', event => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      const images = Array.from(clipboard.files).filter(file => imageTypes.has(file.type));
      if (!images.length) return;
      if (!clipboard.getData('text/plain')) event.preventDefault();
      chooseFiles(images);
    });
    const carriesFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
    form.addEventListener('dragover', event => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = sending || reading ? 'none' : 'copy';
      form.classList.toggle('is-dragging-files', !sending && !reading);
    });
    form.addEventListener('dragleave', event => {
      if (!form.contains(event.relatedTarget)) form.classList.remove('is-dragging-files');
    });
    form.addEventListener('drop', event => {
      form.classList.remove('is-dragging-files');
      if (!carriesFiles(event)) return;
      event.preventDefault();
      chooseFiles(Array.from(event.dataTransfer.files));
    });
    input.addEventListener('input', () => { retryId = null; status.replaceChildren(); syncButtons(); });
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.shiftKey || event.altKey) return;
      if (!event.ctrlKey && !event.metaKey && !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
      event.preventDefault();
      if (!send.disabled) form.requestSubmit();
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (reading || sending || (!input.value.trim() && !files.length)) return;
      const id = destination.threadId;
      const stillHere = () => form.isConnected && (!id || id === threadId);
      retryId ??= crypto.randomUUID();
      sending = true;
      syncButtons();
      feedback(status, 'sendingChat');
      let result;
      try {
        const payload = { ...destination, body: input.value.trim(), clientId: retryId };
        if (files.length) payload.attachments = files;
        const operation = files.length ? (op === 'direct' ? 'directFiles' : 'sendFiles') : op;
        result = await command(operation, payload);
      } catch (err) {
        if (stillHere()) feedback(status, err.status === 413 ? 'chatUploadLimit' : err.status === 400 && files.length ? 'chatFileRefused' : errorKey(err), true);
      } finally { sending = false; syncButtons(); }
      if (!result || !stillHere()) return;
      // Once the server accepted this send, retrying a failed read must never replay it.
      input.value = '';
      files = []; retryId = null;
      renderFiles(); status.replaceChildren();
      try {
        if (!id) { await navigateConversation({ thread: result.threadId }, true); return; }
        const next = await fetchThread();
        if (!stillHere() || !applyChatPage(next)) return;
        timeline.scrollTop = timeline.scrollHeight;
        await markRead(next.thread);
        await refreshInbox();
      } catch {
        if (stillHere()) feedback(status, 'chatSentRefresh', true);
      }
    });
    syncButtons();
    return form;
  }
  window.nodalI18n?.onChange(() => {
    for (const input of document.querySelectorAll('.message-input')) input.placeholder = t('writeMessage');
    for (const n of document.querySelectorAll('[data-file-bytes]')) n.textContent = fileSize(Number(n.dataset.fileBytes));
  });
  function compose(person) {
    detail.classList.add('chat-view');
    const recipient = el('header', 'selected-recipient');
    const lines = el('div', 'row-text');
    const heading = el('h2'), profile = el('a', 'peer-profile', person.name);
    profile.href = 'profile.html?id=' + encodeURIComponent(person.id);
    heading.append(profile);
    lines.append(heading, personMeta(person));
    recipient.append(personIcon(person), lines);
    const canvas = el('div', 'timeline new-chat-timeline');
    canvas.append(tr('p', 'muted chat-empty first-contact', 'firstContact', { name: person.name }));
    const dock = el('div', 'chat-dock');
    dock.append(chatComposer('direct', { targetId: person.id }));
    detail.append(recipient, canvas, dock);
  }
  function chooseRecipient() {
    const form = el('form', 'form recipient-form');
    form.addEventListener('submit', event => event.preventDefault());
    searchPicker(form);
    detail.append(tr('h2', 'composer-title', 'newMessage'), form);
  }
  function groupForm(preselected) {
    detail.append(tr('h2', '', 'newGroup'));
    const form = el('form', 'form');
    const name = field(form, 'groupName', 'text', 100);
    const selected = new Map();
    if (preselected) selected.set(preselected.id, preselected);
    const chips = el('div', 'chips');
    function paintChips() {
      chips.replaceChildren();
      for (const person of selected.values()) {
        const chip = el('button', 'chip', person.name + ' ×');
        chip.type = 'button';
        chip.dataset.removeName = person.name;
        chip.setAttribute('aria-label', t('remove', { name: person.name }));
        chip.addEventListener('click', () => { selected.delete(person.id); paintChips(); });
        chips.append(chip);
      }
    }
    paintChips();
    const status = el('div');
    form.append(tr('h3', '', 'inviteMembers'), chips);
    searchPicker(form, person => {
      if (selected.size >= 20) { feedback(status, 'tooMany', true); return; }
      selected.set(person.id, person);
      status.replaceChildren();
      paintChips();
    }, id => selected.has(id) && 'alreadySelected');
    form.append(status, tr('p', 'muted', 'sendingAs', { name: actor.fullName }), tr('p', 'muted', 'groupNotice'));
    bindWrite(form, 'createGroup', 'group', () => {
      if (!name.value.trim()) return 'emptyText';
      if (!selected.size) return 'choosePeople';
      return { name: name.value.trim(), targetIds: [...selected.keys()] };
    }, result => go({ thread: result.threadId }), true);
    detail.append(form);
  }
  function chatAttachment(file) {
    if (!chatUuid.test(file.id) || typeof file.name !== 'string') return null;
    const path = '/api/workspace/attachments/' + encodeURIComponent(file.id);
    const image = imageTypes.has(file.mime);
    const a = el('a', image ? 'chat-image' : 'chat-document');
    a.href = image ? path + '?inline=1' : path;
    if (image) {
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      const preview = el('img', 'chat-image-preview');
      preview.alt = ''; preview.loading = 'lazy'; preview.decoding = 'async';
      preview.src = a.href;
      // Keep a usable filename/link in the thread if a preview cannot load.
      preview.addEventListener('error', () => { preview.hidden = true; }, { once: true });
      a.append(preview);
    } else { a.download = file.name; a.append(chatIcon('file')); }
    const caption = el('span', 'file-caption');
    caption.append(el('span', 'file-name', file.name), sizeLabel(file.size));
    a.append(caption);
    return a;
  }
  function localizeChatTime(time) {
    const date = new Date(time.dateTime);
    if (Number.isNaN(date.getTime())) return;
    if (time.classList.contains('chat-day')) {
      const today = new Date(), yesterday = new Date();
      yesterday.setDate(today.getDate() - 1);
      const day = date.toDateString();
      time.textContent = day === today.toDateString() ? t('today') : day === yesterday.toDateString() ? t('yesterday')
        : date.toLocaleDateString(language(), { dateStyle: 'long' });
    } else {
      time.textContent = date.toLocaleTimeString(language(), { timeStyle: 'short' });
    }
    time.title = date.toLocaleString(language(), { dateStyle: 'full', timeStyle: 'short' });
  }
  function messageItem(message) {
    const own = message.authorId === actor.id;
    const bubble = el('article', 'message' + (own ? ' own' : ''));
    bubble.dataset.messageId = message.id;
    const byline = el('div', 'byline');
    const name = own ? tr('b', '', 'you') : named('b', '', message.authorName, 'accountGone');
    const time = el('time', 'chat-time');
    time.dateTime = message.createdAt;
    localizeChatTime(time);
    byline.append(name, time);
    bubble.append(byline);
    if (message.body) bubble.append(el('p', 'message-body', message.body));
    if (message.attachments?.length) {
      const list = el('div', 'message-attachments');
      for (const file of message.attachments) {
        const item = chatAttachment(file);
        if (item) list.append(item);
      }
      bubble.append(list);
    }
    return bubble;
  }
  function paintTimeline(force = false) {
    earlier.hidden = !opened.moreMessages;
    const stamp = JSON.stringify(opened.messages);
    if (!force && stamp === lastMessages) return;
    const nearEnd = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 32;
    lastMessages = stamp;
    if (!opened.messages.length) {
      timeline.replaceChildren(tr('p', 'muted chat-empty', opened.thread.kind === 'group' ? 'noGroupMessages' : 'noMessages'));
      return;
    }
    // Append or prepend around existing bubbles. Already-visible images retain their
    // load state and an attachment link holding keyboard focus remains in the document.
    const existing = new Map([...timeline.children].map(n => [n.dataset.messageId || n.dataset.chatDay, n]));
    const nodes = [];
    let lastDay;
    for (const message of opened.messages) {
      const day = new Date(message.createdAt).toDateString();
      if (day !== lastDay) {
        const separator = existing.get(day) || el('time', 'chat-day');
        separator.dataset.chatDay = day;
        separator.dateTime = message.createdAt;
        localizeChatTime(separator);
        nodes.push(separator);
        lastDay = day;
      }
      const signature = JSON.stringify(message);
      let node = existing.get(message.id);
      if (!node || node.messageSignature !== signature) {
        node = messageItem(message);
        node.messageSignature = signature;
      }
      nodes.push(node);
    }
    const keep = new Set(nodes);
    for (const child of [...timeline.children]) if (!keep.has(child)) child.remove();
    nodes.forEach((node, index) => {
      if (timeline.children[index] !== node) timeline.insertBefore(node, timeline.children[index] || null);
    });
    if (nearEnd || force) timeline.scrollTop = timeline.scrollHeight;
  }
  async function loadEarlier() {
    const view = timeline, more = earlier, id = opened.thread.id;
    const status = document.getElementById('history-status');
    more.disabled = true;
    status.replaceChildren();
    const priorFirst = opened.messages[0]?.id;
    try {
      if (!priorFirst) return;
      const page = await fetchThread(priorFirst);
      if (!view.isConnected || view !== timeline || id !== threadId || priorFirst !== opened.messages[0]?.id) return;
      const height = view.scrollHeight, top = view.scrollTop;
      opened.messages = [...page.messages, ...opened.messages];
      opened.moreMessages = page.moreMessages;
      paintTimeline();
      view.scrollTop = top + view.scrollHeight - height;
    } catch (err) {
      if (view.isConnected && view === timeline && id === threadId) feedback(status, errorKey(err), true);
    } finally { more.disabled = false; }
  }
  function applyChatPage(next) {
    if (!timeline?.isConnected || next.thread.id !== threadId || opened?.thread.id !== threadId
      || next.thread.revision < opened.thread.revision) return false;
    const overlap = opened.messages.findIndex(m => m.id === next.messages[0]?.id);
    if (next.moreMessages && overlap > 0) {
      next.messages = [...opened.messages.slice(0, overlap), ...next.messages];
      next.moreMessages = opened.moreMessages;
    }
    opened = next;
    paintTimeline();
    if (next.thread.status !== renderedStatus) paintChatControls();
    return true;
  }
  async function markRead(thread) {
    if (!thread.unread || document.hidden || !detail.getClientRects().length) return;
    await command('read', { threadId: thread.id, revision: thread.revision });
    const row = listing.threads.find(item => item.id === thread.id);
    if (row && row.revision === thread.revision) {
      row.unread = false;
      paintInbox();
    }
  }
  function paintChatControls() {
    const thread = opened.thread, id = thread.id;
    renderedStatus = thread.status;
    const actions = detail.querySelector('.thread-header-actions');
    actions?.replaceChildren();
    if (thread.status === 'blocked') {
      controls.replaceChildren(tr('p', 'notice', 'blocked'));
      return;
    }
    const outgoing = thread.initiatorId === actor.id;
    const pending = thread.status === 'pending';
    if (pending && outgoing) controls.replaceChildren(tr('p', 'notice', 'waiting'));
    else {
      // A reply in a second window can activate the conversation mid-draft.
      // Keep this composer (and its selected files) while its send permission survives.
      let form = controls.querySelector('form.chat-composer');
      if (form?.dataset.threadId !== id) {
        form = chatComposer('send', { threadId: id });
        form.dataset.threadId = id;
        controls.replaceChildren(form);
      }
      controls.querySelector('.intro-notice')?.remove();
      if (pending) controls.prepend(tr('p', 'notice intro-notice', 'firstReply'));
    }
    if (actions && thread.kind === 'direct') {
      if (thread.status === 'active') actions.append(nav('createGroup', { new: 'group', with: thread.peerId }, 'button secondary'));
      actions.append(action(pending && !outgoing ? 'decline' : 'block', 'quiet', 'block', { threadId: id }, () => {
        if (threadId === id) return navigateConversation({ thread: id }, true);
      }, 'blockWarning'));
    }
  }
  function groupMembers() {
    const invites = el('div', 'form');
    invites.append(tr('p', 'meta', 'sendingAs', { name: actor.fullName }), tr('p', 'muted', 'groupNotice'));
    const inviteKeys = new Map();
    searchPicker(invites, async person => {
      if (!inviteKeys.has(person.id)) inviteKeys.set(person.id, crypto.randomUUID());
      await command('invite', { threadId, targetId: person.id, clientId: inviteKeys.get(person.id) });
      go({ thread: threadId, tab: 'members' });
    }, id => opened.members.some(m => m.id === id) && 'alreadyInvited');
    const addMembers = disclosure('inviteMembers', invites);
    addMembers.classList.add('inline-disclosure', 'group-invitations');
    const roster = el('ul', 'group-roster');
    for (const member of opened.members) {
      const row = el('li', 'person-row');
      row.append(identity(member.name), named('span', 'person-name', member.name, 'accountGone'));
      if (member.status === 'invited') row.append(tr('span', 'meta person-state', 'invited'));
      roster.append(row);
    }
    detail.append(addMembers, roster, action('leave', 'quiet', 'leave', { threadId }, () => go({}),
      activeMembers().length === 1 ? 'lastLeave' : 'confirmLeave'));
  }
  function projectList() {
    const form = el('form', 'form new-project-form');
    const title = field(form, 'projectTitle', 'text', 120), goal = field(form, 'goal', 'textarea', 2000);
    bindWrite(form, 'createProject', 'createProject', () => {
      if (!title.value.trim() || !goal.value.trim()) return 'emptyText';
      return { threadId, title: title.value.trim(), goal: goal.value.trim() };
    }, result => go({ thread: threadId, project: result.projectId }), true);
    const create = disclosure('newProject', form);
    create.classList.add('inline-disclosure', 'new-project');
    create.open = !opened.projects.length;
    detail.append(create);

    const list = el('div', 'project-list');
    for (const project of opened.projects) {
      const a = el('a', 'project-row');
      a.href = url({ thread: threadId, project: project.id });
      const lines = el('span', 'row-text project-row-body');
      lines.append(named('strong', 'thread-name', project.title, 'groupProject'));
      if (project.goal) lines.append(el('span', 'meta', project.goal));
      a.append(lines);
      if (project.steps.length) a.append(tr('span', 'meta project-row-progress', 'stepProgress', {
        done: project.steps.filter(step => step.done).length, total: project.steps.length
      }));
      list.append(a);
    }
    if (list.childElementCount) detail.append(list);
  }
  function safeLink(value) {
    try {
      const parsed = new URL(value);
      return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : '';
    } catch { return ''; }
  }
  function projectDetails(project) {
    const header = el('header', 'project-header');
    const backToGroup = nav('projects', { thread: threadId, tab: 'projects' }, 'back project-breadcrumb');
    translate(backToGroup, opened.thread.name ? 'groupProjects' : 'unnamedGroupProjects', { name: opened.thread.name });
    header.append(backToGroup, named('h2', 'project-title', project.title, 'groupProject'));
    if (project.goal) header.append(el('p', 'prose project-goal', project.goal));

    const ids = { threadId, projectId: project.id };
    const back = () => go({ thread: threadId, project: project.id });
    const doc = el('div', 'project-document');
    const link = safeLink(project.link);
    if (link) {
      const a = tr('a', 'external document-link', 'document');
      a.href = link; a.target = '_blank'; a.rel = 'noopener noreferrer';
      doc.append(a);
    }
    const linkForm = el('form', 'form'), input = field(linkForm, 'url', 'url', 2048, false);
    input.value = link;
    bindWrite(linkForm, 'save', 'link', () => {
      const value = input.value.trim();
      if (value && !safeLink(value)) return 'invalidUrl';
      return { ...ids, link: value };
    }, back);
    const editLink = disclosure(link ? 'editLink' : 'addDocument', linkForm);
    editLink.classList.add('inline-disclosure', 'document-editor');
    doc.append(editLink);
    header.append(doc);
    detail.append(header);

    const tasks = section('steps');
    tasks.classList.add('project-checklist');
    const members = activeMembers();
    const list = el('ul', 'step-list');
    for (const step of project.steps) {
      const item = el('li'), line = el('label', 'step'), check = el('input'), status = el('div');
      check.type = 'checkbox'; check.checked = step.done;
      line.append(check, el('span', 'step-description', step.description));
      const owner = members.find(m => m.id === step.assigneeId);
      if (owner) line.append(named('small', 'meta step-assignee', owner.name, 'accountGone'));
      check.addEventListener('change', async () => {
        const wanted = check.checked;
        check.disabled = true;
        try {
          await command('toggle', { ...ids, stepId: step.id, done: wanted });
          status.replaceChildren();
        } catch (err) { check.checked = !wanted; feedback(status, errorKey(err), true); }
        finally { check.disabled = false; }
      });
      item.append(line, status);
      list.append(item);
    }
    if (list.childElementCount) tasks.append(list);
    const newTask = el('form', 'form step-composer');
    const description = field(newTask, 'description', 'text', 320);
    const assign = field(newTask, 'assigned', 'select', null, false);
    const empty = tr('option', '', 'unassigned'); empty.value = ''; assign.append(empty);
    for (const member of members) {
      const opt = named('option', '', member.name, 'accountGone');
      opt.value = member.id; assign.append(opt);
    }
    bindWrite(newTask, 'add', 'step', () => description.value.trim()
      ? { ...ids, description: description.value.trim(), assigneeId: assign.value || null } : 'emptyText', back, true);
    const addStep = disclosure('addStep', newTask);
    addStep.classList.add('inline-disclosure');
    tasks.append(addStep);

    const updates = section('updates');
    updates.classList.add('project-notes');
    const post = el('form', 'form update-composer'), body = field(post, 'updatePrompt', 'textarea', 4000);
    bindWrite(post, 'post', 'update', () => body.value.trim()
      ? { ...ids, body: body.value.trim() } : 'emptyText', back, true);
    const addUpdate = disclosure('writeUpdate', post);
    addUpdate.classList.add('inline-disclosure');
    updates.append(addUpdate);
    for (const update of [...project.updates].reverse()) {
      const note = el('article', 'project-note');
      const byline = el('header', 'byline note-byline');
      const time = el('time'), date = new Date(update.createdAt);
      time.dateTime = update.createdAt;
      if (!Number.isNaN(date.getTime())) time.textContent = date.toLocaleString(language(), { dateStyle: 'short', timeStyle: 'short' });
      byline.append(identity(update.authorName), named('b', '', update.authorName, 'accountGone'), time);
      note.append(byline, el('p', 'prose', update.body));
      updates.append(note);
    }
    detail.append(tasks, updates);
  }
  function renderThread() {
    const thread = opened.thread;
    if (projectId) {
      const project = opened.projects.find(p => p.id === projectId);
      if (!project) throw Object.assign(new Error('Unknown project'), { status: 404 });
      projectDetails(project); return;
    }
    const header = el('header', 'workspace-thread-header');
    const title = el('div', 'thread-heading');
    title.append(named('h2', '', thread.name, thread.kind === 'group' ? 'privateGroup' : 'accountGone'));
    if (thread.kind === 'group') {
      title.append(tr('p', 'meta', activeMembers().length === 1 ? 'singleGroupMember' : 'groupMemberCount', { count: activeMembers().length }));
    } else {
      title.append(tr('p', 'meta', 'direct'));
    }
    const avatar = thread.kind === 'group' ? identity(thread.name, true) : personIcon({ id: thread.peerId, name: thread.name, photoUrl: thread.photoUrl });
    header.append(avatar, title);
    if (thread.kind === 'direct') {
      const menu = el('details', 'chat-menu');
      const toggle = el('summary', 'chat-menu-toggle');
      const dots = el('span', '', '•••');
      dots.setAttribute('aria-hidden', 'true');
      toggle.append(dots, tr('span', 'visually-hidden', 'conversationOptions'));
      menu.append(toggle, el('div', 'thread-header-actions'));
      if (thread.status !== 'blocked') header.append(menu);
      if (thread.peerId && thread.status !== 'blocked') {
        api('/api/users/' + encodeURIComponent(thread.peerId)).then(({ user }) => {
          if (!header.isConnected || !user) return;
          const profile = el('a', 'peer-profile', user.fullName);
          profile.href = 'profile.html?id=' + encodeURIComponent(thread.peerId);
          title.firstElementChild.replaceChildren(profile);
          title.lastElementChild.replaceWith(personMeta({ role: user.title, city: user.city }));
          avatar.replaceWith(personIcon({ id: user.id, name: user.fullName, photoUrl: user.photoUrl }));
        }).catch(() => { /* A previous contact can have left the directory. */ });
      }
    }
    detail.append(header);
    if (thread.kind === 'group') {
      const tabs = el('nav', 'tabs group-tabs');
      for (const [id, label] of [['chat', 'chat'], ['projects', 'projects'], ['members', 'memberList']]) {
        const a = nav(label, { thread: threadId, tab: id }, 'tab');
        if (id === tab) a.setAttribute('aria-current', 'page');
        tabs.append(a);
      }
      detail.append(tabs);
      if (tab === 'members') { groupMembers(); return; }
      if (tab === 'projects') { projectList(); return; }
    }
    detail.classList.add('chat-view');
    earlier = button('earlier', 'earlier');
    earlier.addEventListener('click', loadEarlier);
    const status = el('div');
    status.id = 'history-status';
    timeline = el('div', 'timeline'); controls = el('div', 'chat-dock');
    timeline.tabIndex = 0;
    timeline.setAttribute('role', 'region');
    timeline.setAttribute('aria-label', t('chat'));
    timeline.dataset.msgAria = 'chat';
    detail.append(earlier, status, timeline, controls);
    paintChatControls(); paintTimeline(true);
  }
  async function poll() {
    if (document.hidden || pollRunning || !actor || !listing) return;
    pollRunning = true;
    const version = viewVersion;
    try {
      await refreshInbox();
      if (version !== viewVersion) return;
      const latest = threadId && listing.threads.find(row => row.id === threadId);
      if (threadId && opened && !latest) {
        timeline = null;
        unavailable({ status: 404 });
        return;
      }
      if (timeline && opened && latest && (latest.revision !== opened.thread.revision || latest.unread)) {
        const next = await fetchThread();
        if (version === viewVersion && applyChatPage(next)) await markRead(next.thread);
      }
    } catch (err) {
      if (version === viewVersion && threadId && (err.status === 403 || err.status === 404)) {
        timeline = null; controls = null; unavailable(err);
      }
    } finally { pollRunning = false; }
  }
  function unavailable(err) {
    detail.classList.remove('chat-view');
    detail.replaceChildren(nav('backInbox', {}, 'back'));
    const status = el('div');
    feedback(status, errorKey(err), true);
    const retry = button('retry', 'secondary');
    retry.addEventListener('click', () => location.reload());
    detail.append(status, retry);
  }
  function localize() {
    document.title = t('messages') + ' · NODAL';
    for (const node of document.querySelectorAll('[data-msg]')) node.textContent = t(node.dataset.msg, node.msgVars);
    for (const chip of document.querySelectorAll('[data-remove-name]')) {
      chip.setAttribute('aria-label', t('remove', { name: chip.dataset.removeName }));
    }
    for (const node of document.querySelectorAll('[data-msg-placeholder]')) node.placeholder = t(node.dataset.msgPlaceholder);
    for (const node of document.querySelectorAll('[data-msg-aria]')) node.setAttribute('aria-label', t(node.dataset.msgAria));
    for (const node of document.querySelectorAll('[data-chat-title]')) node.title = t(node.dataset.chatTitle, node.msgVars);
    for (const time of document.querySelectorAll('time[datetime]')) {
      if (time.classList.contains('inbox-date')) { time.textContent = inboxDate(time.dateTime); continue; }
      if (time.classList.contains('chat-day') || time.classList.contains('chat-time')) { localizeChatTime(time); continue; }
      const date = new Date(time.dateTime);
      if (!Number.isNaN(date.getTime())) time.textContent = date.toLocaleString(language(), { dateStyle: 'short', timeStyle: 'short' });
    }
  }
  async function showView() {
    const version = ++viewVersion;
    const params = new URLSearchParams(location.search);
    const to = params.get('to'), mode = params.get('new');
    threadId = params.get('thread');
    projectId = params.get('project');
    tab = projectId ? 'projects' : params.get('tab') || 'chat';
    document.body.classList.toggle('detail-open', Boolean(threadId || to || mode));
    for (const [id, active] of [['new-message', mode === 'message' || Boolean(to)], ['new-group', mode === 'group']]) {
      const link = document.getElementById(id);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    opened = null; timeline = null; controls = null;
    lastMessages = ''; renderedStatus = null;
    detail.classList.remove('chat-view');
    detail.replaceChildren(tr('p', 'loading-view', 'loading'));
    const existing = to && listing.threads.find(th => th.kind === 'direct' && th.peerId === to);
    if (existing) {
      threadId = existing.id;
      history.replaceState(null, '', url({ thread: threadId }));
    }
    if (!threadId && !to && !mode && window.matchMedia('(min-width: 721px)').matches) {
      threadId = listing.threads[0]?.id;
    }
    paintInbox();
    try {
      if (threadId) {
        const result = await fetchThread();
        if (version !== viewVersion) return;
        opened = result; detail.replaceChildren(); renderThread();
        // A transient read-receipt failure is retried on a later poll.
        await markRead(opened.thread).catch(() => {});
      } else if (to) {
        const { user, self } = await api('/api/users/' + encodeURIComponent(to));
        if (version !== viewVersion) return;
        if (self || !user) throw Object.assign(new Error('Unknown member'), { status: 404 });
        detail.replaceChildren();
        compose({ id: user.id, name: user.fullName, role: user.title, city: user.city, photoUrl: user.photoUrl });
      } else {
        detail.replaceChildren();
        if (mode === 'group') {
          const peer = listing.threads.find(th => th.kind === 'direct' && th.status === 'active' && th.peerId === params.get('with'));
          groupForm(peer && { id: peer.peerId, name: peer.name });
        } else chooseRecipient();
      }
    } catch (err) {
      if (version === viewVersion) { document.body.classList.add('detail-open'); unavailable(err); }
    }
  }
  async function navigateConversation(args, replace = false) {
    const next = url(args);
    const same = new URL(next, location.href).href === location.href;
    if (same && !replace) return;
    if (!same) history[replace ? 'replaceState' : 'pushState'](null, '', next);
    await showView();
    if (args.thread && !listing.threads.some(row => row.id === args.thread)) await refreshInbox().catch(() => {});
  }
  async function start() {
    localize();
    try {
      const [me, received] = await Promise.all([api('/api/auth/me'), api('/api/workspace')]);
      actor = me.user; listing = received;
      document.getElementById('mailbox-owner').textContent = actor.fullName || '';
      const railSearch = searchPicker(document.getElementById('inbox-search'), null, undefined, true);
      document.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const a = event.target.closest('a[href]');
        if (!a || a.target || a.hasAttribute('download')) return;
        const next = new URL(a.href);
        if (next.origin !== location.origin || next.pathname !== location.pathname || next.hash) return;
        event.preventDefault();
        if (railSearch.value) { railSearch.value = ''; railSearch.dispatchEvent(new Event('input')); }
        navigateConversation(Object.fromEntries(next.searchParams)).then(() => {
          if (event.detail !== 0) return;
          const focus = detail.getClientRects().length
            ? detail.querySelector('.message-input,.recipient-search,h2') : railSearch;
          if (focus?.tagName === 'H2') focus.tabIndex = -1;
          focus?.focus({ preventScroll: true });
        });
      });
      window.addEventListener('popstate', showView);
      await showView();
      window.setInterval(poll, 5000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    } catch (err) { document.body.classList.add('detail-open'); unavailable(err); }
  }
  window.nodalI18n?.onChange(localize);
  start();
})();
