(() => {
  'use strict';

  const detail = document.getElementById('detail');
  const inbox = document.getElementById('inbox-list');
  const params = new URLSearchParams(location.search);
  const threadId = params.get('thread');
  const projectId = params.get('project');
  const tab = projectId ? 'projects' : params.get('tab') || 'chat';
  let actor, listing, opened, timeline, controls, earlier, renderedStatus, pollRunning = false;
  let lastInbox = '', lastMessages = '';

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
        await done(result);
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
      try { await command(op, data); await done(); }
      catch (err) { feedback(status, errorKey(err), true); }
      finally { b.disabled = false; }
    });
    return area;
  }
  function searchPicker(host, addPerson, selectedLabel = () => null) {
    const search = field(host, 'name', 'search', 160, false);
    search.autocomplete = 'off';
    const results = el('div', 'result-list');
    const status = el('p', 'meta');
    status.setAttribute('role', 'status');
    host.append(status, results);
    let timer, controller;
    search.addEventListener('keydown', event => {
      if (event.key === 'Enter') event.preventDefault();
    });
    function searchNow() {
      clearTimeout(timer);
      controller?.abort();
      results.replaceChildren();
      status.className = 'meta';
      status.setAttribute('role', 'status');
      const q = search.value.trim();
      if (q.length < 2) {
        if (q.length) translate(status, 'shortName');
        else { delete status.dataset.msg; status.textContent = ''; }
        return;
      }
      const current = new AbortController();
      controller = current;
      translate(status, 'loading');
      timer = setTimeout(async () => {
        try {
          const result = await api('/api/users/search', { q }, current.signal);
          if (current.signal.aborted) return;
          const people = result.users || [];
          delete status.dataset.msg;
          status.textContent = '';
          if (!people.length) translate(status, 'noMatches');
          for (const person of people) {
            const row = el('button', 'result');
            row.type = 'button';
            const lines = el('span', 'row-text');
            lines.append(el('strong', 'thread-name', person.name), personMeta(person));
            row.append(identity(person.name), lines);
            const selected = selectedLabel(person.id);
            if (selected) {
              row.disabled = true;
              row.append(tr('span', 'meta', selected));
            }
            row.addEventListener('click', async () => {
              row.disabled = true;
              try {
                await addPerson(person);
              } catch (err) {
                row.disabled = false;
                status.className = 'error';
                status.setAttribute('role', 'alert');
                translate(status, errorKey(err));
                return;
              }
              controller?.abort();
              search.value = '';
              results.replaceChildren();
              search.focus();
            });
            results.append(row);
          }
        } catch (err) {
          if (err.name !== 'AbortError' && !current.signal.aborted) translate(status, errorKey(err));
        }
      }, 220);
    }
    search.addEventListener('input', searchNow);
    return search;
  }
  function paintInbox(force = false) {
    const stamp = JSON.stringify(listing);
    if (!force && stamp === lastInbox) return;
    lastInbox = stamp;
    inbox.replaceChildren();
    if (listing.invitations.length) {
      inbox.append(tr('h3', 'inbox-group', 'invitations'));
      for (const invitation of listing.invitations) {
        const card = el('article', 'invitation');
        const buttons = el('div', 'actions');
        buttons.append(action('accept', 'primary', 'accept', { threadId: invitation.id }, () => go({ thread: invitation.id })),
          action('decline', 'quiet', 'decline', { threadId: invitation.id }, refreshInbox));
        card.append(named('strong', 'thread-name', invitation.name, 'privateGroup'), tr('p', 'meta', 'invitedBy', { name: invitation.inviterName }), buttons);
        inbox.append(card);
      }
    }
    if (!listing.threads.length) { inbox.append(tr('p', 'inbox-empty', 'noThreads')); return; }
    if (listing.invitations.length) inbox.append(tr('h3', 'inbox-group', 'conversations'));
    for (const thread of listing.threads) {
      const a = el('a', 'thread-row'), lines = el('span', 'row-text');
      a.href = url({ thread: thread.id });
      if (thread.id === threadId) a.setAttribute('aria-current', 'page');
      const fallback = thread.kind === 'group' ? 'privateGroup' : 'accountGone';
      const label = thread.status === 'active' ? thread.kind : thread.status;
      lines.append(named('strong', 'thread-name', thread.name, fallback), tr('span', 'meta', label));
      a.append(identity(thread.name, thread.kind === 'group'), lines);
      if (thread.unread) a.append(tr('span', 'unread', 'unread'));
      inbox.append(a);
    }
  }
  async function refreshInbox() {
    listing = await api('/api/workspace');
    paintInbox();
  }
  function compose(person) {
    detail.append(tr('p', 'meta', 'newMessage'), el('h2', '', person.name), personMeta(person));
    const form = el('form', 'form');
    const input = field(form, 'message', 'textarea', 4000);
    form.append(tr('p', 'meta', 'sendingAs', { name: actor.fullName }));
    bindWrite(form, 'send', 'direct', () => {
      const body = input.value.trim();
      return body ? { targetId: person.id, body } : 'emptyText';
    }, result => go({ thread: result.threadId }), true);
    detail.append(form);
  }
  function chooseRecipient() {
    detail.append(tr('h2', '', 'findPerson'), tr('p', 'muted', 'findHint'));
    const area = el('div', 'form');
    searchPicker(area, person => go({ to: person.id }));
    detail.append(area);
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
  function messageItem(message) {
    const own = message.authorId === actor.id;
    const bubble = el('article', 'message' + (own ? ' own' : ''));
    const byline = el('div', 'byline');
    const name = own ? tr('b', '', 'you') : el('b', '', message.authorName || t('accountGone'));
    const time = el('time');
    time.dateTime = message.createdAt;
    const date = new Date(message.createdAt);
    if (!Number.isNaN(date.getTime())) time.textContent = date.toLocaleString(language(), { dateStyle: 'short', timeStyle: 'short' });
    byline.append(name, time);
    bubble.append(byline, el('p', '', message.body));
    return bubble;
  }
  function paintTimeline(force = false) {
    earlier.hidden = !opened.moreMessages;
    const stamp = JSON.stringify(opened.messages);
    if (!force && stamp === lastMessages) return;
    const nearEnd = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 32;
    lastMessages = stamp;
    timeline.replaceChildren(...opened.messages.map(messageItem));
    if (!opened.messages.length) timeline.append(tr('p', 'muted', opened.thread.kind === 'group' ? 'noGroupMessages' : 'noMessages'));
    if (nearEnd || force) timeline.scrollTop = timeline.scrollHeight;
  }
  async function loadEarlier() {
    earlier.disabled = true;
    document.getElementById('history-status').replaceChildren();
    const priorFirst = opened.messages[0]?.id;
    try {
      if (!priorFirst) return;
      const page = await fetchThread(priorFirst);
      if (priorFirst !== opened.messages[0]?.id) return;
      const height = timeline.scrollHeight;
      const top = timeline.scrollTop;
      opened.messages = [...page.messages, ...opened.messages];
      opened.moreMessages = page.moreMessages;
      paintTimeline();
      timeline.scrollTop = top + timeline.scrollHeight - height;
    } catch (err) {
      feedback(document.getElementById('history-status'), errorKey(err), true);
    } finally { earlier.disabled = false; }
  }
  async function markRead(thread) {
    if (!thread.unread || document.hidden) return;
    await command('read', { threadId, revision: thread.revision });
    const row = listing.threads.find(item => item.id === threadId);
    if (row && row.revision === thread.revision) {
      row.unread = false;
      paintInbox();
    }
  }
  function paintChatControls() {
    controls.replaceChildren();
    const thread = opened.thread;
    renderedStatus = thread.status;
    if (thread.status === 'blocked') { controls.append(tr('p', 'notice', 'blocked')); return; }
    const outgoing = thread.initiatorId === actor.id;
    if (thread.status === 'pending' && outgoing) controls.append(tr('p', 'notice', 'waiting'));
    else {
      const form = el('form', 'form');
      if (thread.status === 'pending') form.append(tr('p', 'notice', 'firstReply'));
      const message = field(form, 'message', 'textarea', 4000);
      bindWrite(form, 'send', 'send', () => message.value.trim()
        ? { threadId, body: message.value.trim() } : 'emptyText', () => go({ thread: threadId }), true);
      controls.append(form);
    }
    if (thread.kind === 'direct') {
      const actions = el('div', 'actions section');
      if (thread.status === 'active') actions.append(nav('createGroup', { new: 'group', with: thread.peerId }, 'button secondary'));
      const decline = thread.status === 'pending' && !outgoing;
      actions.append(action(decline ? 'decline' : 'block', 'quiet', 'block', { threadId }, () => go({ thread: threadId }), 'blockWarning'));
      controls.append(actions);
    }
  }
  function groupMembers() {
    const roster = section('memberList');
    for (const member of opened.members) {
      const row = el('div', 'person-row');
      row.append(el('span', '', member.name || t('accountGone')), tr('span', 'meta', member.status));
      roster.append(row);
    }
    const invites = section('inviteMembers');
    invites.append(tr('p', 'muted', 'groupNotice'), tr('p', 'meta', 'sendingAs', { name: actor.fullName }));
    const inviteKeys = new Map();
    searchPicker(invites, async person => {
      if (!inviteKeys.has(person.id)) inviteKeys.set(person.id, crypto.randomUUID());
      await command('invite', { threadId, targetId: person.id, clientId: inviteKeys.get(person.id) });
      go({ thread: threadId, tab: 'members' });
    }, id => opened.members.some(m => m.id === id) && 'alreadyInvited');
    detail.append(roster, invites, action('leave', 'secondary', 'leave', { threadId }, () => go({}),
      activeMembers().length === 1 ? 'lastLeave' : 'confirmLeave'));
  }
  function projectList() {
    detail.append(tr('h3', '', 'projects'));
    const list = el('div');
    for (const project of opened.projects) {
      const a = el('a', 'project-row');
      a.href = url({ thread: threadId, project: project.id });
      const lines = el('span', 'row-text');
      lines.append(named('strong', 'thread-name', project.title, 'groupProject'), el('span', 'meta', project.goal));
      a.append(lines); list.append(a);
    }
    if (!opened.projects.length) list.append(tr('p', 'muted', 'noProjects'));
    const form = el('form', 'form');
    const title = field(form, 'projectTitle', 'text', 120), goal = field(form, 'goal', 'textarea', 2000);
    bindWrite(form, 'createProject', 'createProject', () => {
      if (!title.value.trim() || !goal.value.trim()) return 'emptyText';
      return { threadId, title: title.value.trim(), goal: goal.value.trim() };
    }, result => go({ thread: threadId, project: result.projectId }), true);
    const create = disclosure('newProject', form);
    create.open = !opened.projects.length;
    detail.append(list, create);
  }
  function safeLink(value) {
    try {
      const parsed = new URL(value);
      return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : '';
    } catch { return ''; }
  }
  function projectDetails(project) {
    const backToGroup = nav('projects', { thread: threadId, tab: 'projects' });
    translate(backToGroup, opened.thread.name ? 'groupProjects' : 'unnamedGroupProjects', { name: opened.thread.name });
    detail.append(backToGroup, named('h2', '', project.title, 'groupProject'), el('p', 'prose', project.goal));
    const ids = { threadId, projectId: project.id };
    const back = () => go({ thread: threadId, project: project.id });
    const doc = section('document');
    const link = safeLink(project.link);
    if (link) {
      const a = el('a', 'external', link);
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
    doc.append(disclosure(link ? 'editLink' : 'pin', linkForm));
    detail.append(doc);
    const tasks = section('steps');
    const members = activeMembers();
    if (!project.steps.length) tasks.append(tr('p', 'muted', 'noSteps'));
    for (const step of project.steps) {
      const line = el('label', 'step'), check = el('input'), status = el('div');
      check.type = 'checkbox'; check.checked = step.done;
      line.append(check, el('span', '', step.description));
      const owner = members.find(m => m.id === step.assigneeId);
      if (owner) line.append(el('small', 'meta', owner.name));
      check.addEventListener('change', async () => {
        const wanted = check.checked;
        check.disabled = true;
        try {
          await command('toggle', { ...ids, stepId: step.id, done: wanted });
          status.replaceChildren();
        } catch (err) { check.checked = !wanted; feedback(status, errorKey(err), true); }
        finally { check.disabled = false; }
      });
      tasks.append(line, status);
    }
    const newTask = el('form', 'form');
    const description = field(newTask, 'description', 'text', 320);
    const assign = field(newTask, 'assigned', 'select', null, false);
    const empty = tr('option', '', 'unassigned'); empty.value = ''; assign.append(empty);
    for (const member of members) {
      const opt = el('option', '', member.name);
      opt.value = member.id; assign.append(opt);
    }
    bindWrite(newTask, 'addStep', 'step', () => description.value.trim()
      ? { ...ids, description: description.value.trim(), assigneeId: assign.value || null } : 'emptyText', back, true);
    tasks.append(disclosure('addStep', newTask));
    const updates = section('updates');
    if (!project.updates.length) updates.append(tr('p', 'muted', 'noUpdates'));
    for (const update of project.updates) updates.append(messageItem(update));
    const post = el('form', 'form'), body = field(post, 'updateText', 'textarea', 4000);
    bindWrite(post, 'post', 'update', () => body.value.trim()
      ? { ...ids, body: body.value.trim() } : 'emptyText', back, true);
    updates.append(post);
    detail.append(tasks, updates);
  }
  function renderThread() {
    const thread = opened.thread;
    if (projectId) {
      const project = opened.projects.find(p => p.id === projectId);
      if (!project) throw Object.assign(new Error('Unknown project'), { status: 404 });
      projectDetails(project); return;
    }
    detail.append(tr('p', 'meta', thread.kind), named('h2', '', thread.name, thread.kind === 'group' ? 'privateGroup' : 'accountGone'));
    if (thread.kind === 'group') {
      const tabs = el('nav', 'tabs');
      for (const [id, label] of [['chat', 'chat'], ['members', 'memberList'], ['projects', 'projects']]) {
        const a = nav(label, { thread: threadId, tab: id }, 'tab');
        if (id === tab) a.setAttribute('aria-current', 'page');
        tabs.append(a);
      }
      detail.append(tabs);
      if (tab === 'members') { groupMembers(); return; }
      if (tab === 'projects') { projectList(); return; }
    }
    earlier = button('earlier', 'secondary');
    earlier.addEventListener('click', loadEarlier);
    const status = el('div');
    status.id = 'history-status';
    timeline = el('div', 'timeline'); controls = el('div', 'form');
    detail.append(earlier, status, timeline, controls);
    paintTimeline(true); paintChatControls();
  }
  async function poll() {
    if (document.hidden || pollRunning || !actor || !listing) return;
    pollRunning = true;
    try {
      await refreshInbox();
      const latest = threadId && listing.threads.find(row => row.id === threadId);
      if (threadId && !latest) {
        timeline = null;
        unavailable({ status: 404 });
        return;
      }
      if (threadId && timeline && (latest.revision !== opened.thread.revision || latest.unread)) {
        const next = await fetchThread();
        // Keep pages the reader already opened when the latest two pages overlap.
        const overlap = opened.messages.findIndex(m => m.id === next.messages[0]?.id);
        if (next.moreMessages && overlap > 0) {
          next.messages = [...opened.messages.slice(0, overlap), ...next.messages];
          next.moreMessages = opened.moreMessages;
        }
        opened = next;
        paintTimeline();
        if (next.thread.status !== renderedStatus) paintChatControls();
        await markRead(next.thread);
      }
    } catch (err) {
      if (err.status === 403 || err.status === 404) {
        if (threadId) { timeline = null; controls = null; unavailable(err); }
      }
    } finally { pollRunning = false; }
  }
  function unavailable(err) {
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
    for (const time of document.querySelectorAll('time[datetime]')) {
      const date = new Date(time.dateTime);
      if (!Number.isNaN(date.getTime())) time.textContent = date.toLocaleString(language(), { dateStyle: 'short', timeStyle: 'short' });
    }
  }
  async function start() {
    localize();
    const to = params.get('to'), mode = params.get('new');
    document.body.classList.toggle('detail-open', Boolean(threadId || to || mode));
    try {
      const [me, received] = await Promise.all([api('/api/auth/me'), api('/api/workspace')]);
      actor = me.user; listing = received;
      paintInbox(); detail.replaceChildren();
      if ((threadId || to || mode) && !projectId) detail.append(nav('backInbox', {}, 'back mobile-back'));
      if (threadId) {
        opened = await fetchThread();
        renderThread();
        await markRead(opened.thread);
      } else if (to) {
        const existing = listing.threads.find(th => th.kind === 'direct' && th.peerId === to);
        if (existing) { location.replace(url({ thread: existing.id })); return; }
        const { user, self } = await api('/api/users/' + encodeURIComponent(to));
        if (self || !user) throw Object.assign(new Error('Unknown member'), { status: 404 });
        compose({ id: user.id, name: user.fullName, role: user.title, city: user.city });
      } else if (mode === 'group') {
        const peer = listing.threads.find(th => th.kind === 'direct' && th.status === 'active' && th.peerId === params.get('with'));
        groupForm(peer && { id: peer.peerId, name: peer.name });
      } else chooseRecipient();
      window.setInterval(poll, 12000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
    } catch (err) { unavailable(err); }
  }
  window.nodalI18n?.onChange(localize);
  start();
})();
