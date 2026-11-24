(() => {
  'use strict';

  const mount = document.querySelector('[data-workspace-notifications]');
  if (!mount || mount.querySelector('.workspace-bell')) return;

  const words = {
    heading: ['Notifications', 'Notificaciones', 'Notificações'],
    openInbox: ['Open Messages', 'Abrir mensajes', 'Abrir mensagens'],
    empty: ['No unread notifications.', 'No tienes notificaciones sin leer.', 'Você não tem notificações não lidas.'],
    news: ['NODAL news · {title}', 'Noticias de NODAL · {title}', 'Notícias da NODAL · {title}'],
    opportunity: ['Featured opportunity · {title}', 'Oportunidad destacada · {title}', 'Oportunidade em destaque · {title}'],
    loading: ['Loading notifications…', 'Cargando notificaciones…', 'Carregando notificações…'],
    error: ['Couldn’t update notifications.', 'No se pudieron actualizar las notificaciones.', 'Não foi possível atualizar as notificações.'],
    retry: ['Try again', 'Reintentar', 'Tentar novamente'],
    direct: ['{name} sent you a message.', '{name} te envió un mensaje.', '{name} enviou uma mensagem para você.'],
    directUnknown: ['You received a direct message.', 'Recibiste un mensaje directo.', 'Você recebeu uma mensagem direta.'],
    group: ['{name} wrote in {group}.', '{name} escribió en {group}.', '{name} enviou uma mensagem em {group}.'],
    groupUnknown: ['New message in {group}.', 'Nuevo mensaje en {group}.', 'Nova mensagem em {group}.'],
    unnamedGroup: ['a private group', 'un grupo privado', 'um grupo privado'],
    invitation: ['{name} invited you to join {group}.', '{name} te invitó a unirte a {group}.', '{name} convidou você para participar de {group}.'],
    invitationUnknown: ['You were invited to join {group}.', 'Recibiste una invitación para unirte a {group}.', 'Você recebeu um convite para participar de {group}.'],
    several: ['{count} new notifications.', 'Tienes {count} notificaciones nuevas.', 'Você tem {count} novas notificações.'],
    dismiss: ['Dismiss notification', 'Ocultar notificación', 'Dispensar notificação'],
  };
  const language = () => window.nodalI18n?.lang || document.documentElement.lang || 'en';
  function t(key, data = {}) {
    const text = words[key][{ en: 0, es: 1, pt: 2 }[language()]] || words[key][0];
    return text.replace(/\{(\w+)\}/g, (_, k) => String(data[k]));
  }
  function el(tag, cls) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }
  const paths = {
    bell: 'M5 16.5c1.2-1.6 1.4-3 1.4-6.2a5.6 5.6 0 0 1 11.2 0c0 3.2.2 4.6 1.4 6.2l.6 1H4.4l.6-1z M9.8 20.1a2.6 2.6 0 0 0 4.4 0 M12 3V2',
    message: 'M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8L5 21v-3.5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z M7.5 9H16 M7.5 13h5.5',
    invitation: 'M13.4 8a3.6 3.6 0 1 1-7.2 0 3.6 3.6 0 0 1 7.2 0z M3 19.5v-1a6.8 6.8 0 0 1 12.1-4.2 M19 12v7 M15.5 15.5h7',
    news: 'M4 4h14v14a2 2 0 0 0 4 0V8h-4 M4 4v14a2 2 0 0 0 2 2h14 M7 8h8 M7 12h8 M7 16h5',
    opportunity: 'M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M3 8h18v12H3z M3 12c5 3 13 3 18 0 M10 13h4v3h-4z',
    close: 'm6 6 12 12 M18 6 6 18',
  };
  function icon(kind) {
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', paths[kind]); svg.append(path);
    return svg;
  }

  const extra = mount.querySelector('[data-workspace-extra]');
  const widget = el('div', 'workspace-bell');
  const button = mount.querySelector('[data-workspace-trigger]') || el('button');
  button.classList.add('workspace-bell-button');
  button.type = 'button';
  button.removeAttribute('data-i18n-aria-label');
  button.setAttribute('aria-expanded', 'false');
  const badge = el('span', 'workspace-bell-count');
  badge.setAttribute('aria-hidden', 'true'); badge.hidden = true;
  button.replaceChildren(icon('bell'), badge);
  const panel = el('section', 'workspace-bell-panel');
  panel.id = 'workspace-notifications-panel'; panel.hidden = true;
  panel.setAttribute('popover', 'manual');
  button.setAttribute('aria-controls', panel.id);
  const heading = el('h2', 'workspace-bell-title'); heading.id = 'workspace-notifications-title';
  panel.setAttribute('aria-labelledby', heading.id);
  const list = el('ul', 'workspace-bell-list'), status = el('p', 'workspace-bell-status');
  const retry = el('button', 'workspace-bell-retry'); retry.type = 'button'; retry.hidden = true;
  const inbox = el('a', 'workspace-bell-inbox'); inbox.href = '/messages.html';
  const live = el('span', 'workspace-bell-live');
  live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
  const toast = el('div', 'workspace-bell-toast');
  toast.hidden = true; toast.setAttribute('popover', 'manual');
  const target = el('a', 'workspace-bell-toast-action'), multiple = el('button', 'workspace-bell-toast-action');
  multiple.type = 'button';
  const dismiss = el('button', 'workspace-bell-dismiss'); dismiss.type = 'button'; dismiss.append(icon('close'));
  toast.append(icon('bell'), target, multiple, dismiss);
  panel.append(heading, list, status, retry);
  if (extra) panel.append(extra);
  panel.append(inbox); widget.append(button, panel, live, toast); mount.append(widget);

  const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
  const editorial = item => item.type === 'news' || item.type === 'opportunity';
  const noticeKey = item => item.type + ':' + item.id;
  function validItem(item) {
    if (!item || !uuid.test(item.id)) return false;
    if (item.type === 'news') return typeof item.title === 'string' && Boolean(item.title.trim());
    if (item.type === 'opportunity') return ['en', 'es', 'pt'].some(lang => typeof item.title?.[lang] === 'string' && item.title[lang].trim());
    return ['message', 'invitation'].includes(item.type) && uuid.test(item.threadId) && ['direct', 'group'].includes(item.threadKind);
  }
  function validSummary(value) {
    return Number.isSafeInteger(value?.total) && value.total >= 0 && Array.isArray(value.items)
      && value.items.length <= 20 && value.items.length <= value.total && value.items.every(validItem)
      && (value.workspaceTotal === undefined ? !value.items.some(editorial)
        : Number.isSafeInteger(value.workspaceTotal) && value.workspaceTotal >= 0 && value.workspaceTotal <= value.total);
  }
  function itemText(item) {
    if (item.type === 'news') return t('news', { title: item.title });
    if (item.type === 'opportunity') {
      const title = [language(), 'es', 'en', 'pt'].map(lang => item.title[lang]).find(s => typeof s === 'string' && s.trim());
      return t('opportunity', { title });
    }
    const name = item.actorName || '', group = item.groupName || t('unnamedGroup');
    const type = item.type === 'invitation' ? 'invitation' : item.threadKind;
    return t(type + (name ? '' : 'Unknown'), { name, group });
  }
  function itemLink(item) {
    if (item.type === 'news') return '/community.html?news=' + item.id + '#nodal-news';
    if (item.type === 'opportunity') return '/opportunities.html?id=' + item.id;
    return '/messages.html?' + new URLSearchParams({ [item.type === 'invitation' ? 'invite' : 'thread']: item.threadId });
  }
  // Keep link navigation native, including when the member opens the item in another tab.
  function markEditorialRead(item, event) {
    if (!item || !editorial(item) || event.defaultPrevented || (event.type === 'auxclick' && event.button !== 1)) return;
    fetch('/api/workspace/notifications/read', {
      method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: item.type, id: item.id }),
    }).then(response => { if (response.ok) refresh(true); }).catch(() => {});
  }
  function alreadyViewing(item) {
    if (editorial(item) || location.pathname !== '/messages.html') return false;
    const params = new URLSearchParams(location.search);
    if (item.type === 'invitation') return params.get('invite') === item.threadId;
    if (params.has('project') || (params.get('tab') || 'chat') !== 'chat') return false;
    if (params.get('thread') === item.threadId) return true;
    // The wide inbox initially opens its first thread without changing the address.
    if (!document.querySelector('.detail.chat-view')?.getClientRects().length) return false;
    return document.querySelector('.thread-row[aria-current="page"]')?.getAttribute('href') === 'messages.html?thread=' + item.threadId;
  }
  let notices = [], toastTimer;
  function hideToast() {
    clearTimeout(toastTimer); notices = [];
    if (!toast.hidden) { toast.hidePopover?.(); toast.hidden = true; }
  }
  function expireToast() {
    clearTimeout(toastTimer);
    if (!toast.hidden && !toast.contains(document.activeElement) && !toast.matches(':hover')) toastTimer = setTimeout(hideToast, 8000);
  }
  function paintToast() {
    dismiss.setAttribute('aria-label', t('dismiss')); dismiss.title = t('dismiss');
    if (!notices.length) return;
    const single = notices.length === 1;
    target.hidden = !single; multiple.hidden = single;
    if (single) { target.href = itemLink(notices[0]); target.textContent = itemText(notices[0]); }
    else multiple.textContent = t('several', { count: notices.length });
  }
  function showToast(fresh) {
    notices = fresh; paintToast();
    if (toast.hidden) { toast.hidden = false; toast.showPopover?.(); }
    expireToast();
  }
  dismiss.addEventListener('click', event => { hideToast(); if (!event.detail) button.focus(); });
  function openToastItem(event) {
    markEditorialRead(notices[0], event);
    if (event.type !== 'auxclick' || event.button === 1) hideToast();
  }
  target.addEventListener('click', openToastItem);
  target.addEventListener('auxclick', openToastItem);
  multiple.addEventListener('click', () => { open(); (list.querySelector('a') || inbox).focus(); });
  toast.addEventListener('pointerenter', () => clearTimeout(toastTimer));
  toast.addEventListener('pointerleave', expireToast);
  toast.addEventListener('focusin', () => clearTimeout(toastTimer));
  toast.addEventListener('focusout', event => { if (!toast.contains(event.relatedTarget)) setTimeout(expireToast, 0); });

  let summary, failed = false, signedOut = false, signature, lastCount;
  const seen = new Set();
  function publishCount(count) {
    if (count === lastCount) return;
    lastCount = count;
    mount.dataset.workspaceCount = String(count);
    document.dispatchEvent(new CustomEvent('nodal:workspace-count', { detail: { count } }));
  }
  function renderList() {
    const focused = document.activeElement, focusKey = list.contains(focused) && focused.dataset.notice;
    const rows = (summary?.items || []).map(item => {
      const li = el('li'), link = el('a', 'workspace-bell-item');
      link.dataset.notice = editorial(item) ? noticeKey(item) : item.threadId;
      if (editorial(item)) {
        const openItem = event => markEditorialRead(item, event);
        link.addEventListener('click', openItem);
        link.addEventListener('auxclick', openItem);
      }
      link.href = itemLink(item);
      const mark = el('span', 'workspace-bell-mark');
      mark.append(icon(item.type)); link.append(mark);
      const text = el('span', 'workspace-bell-copy');
      const line = el('span'); line.textContent = itemText(item); text.append(line);
      if (item.createdAt) {
        const date = new Date(item.createdAt);
        if (Number.isFinite(date.getTime())) {
          const time = el('time'); time.dateTime = item.createdAt;
          time.textContent = date.toLocaleString(language(), date.toDateString() === new Date().toDateString()
            ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' });
          time.title = date.toLocaleString(language()); text.append(time);
        }
      }
      link.append(text); li.append(link); return li;
    });
    list.replaceChildren(...rows);
    if (focusKey && !panel.hidden) (list.querySelector('[data-notice="' + focusKey + '"]') || inbox).focus({ preventScroll: true });
  }
  function render() {
    const count = summary?.total || 0;
    badge.textContent = count > 99 ? '99+' : String(count); badge.hidden = !count;
    button.title = t('heading');
    button.setAttribute('aria-label', count ? t('heading') + ' (' + count + ')' : t('heading'));
    heading.textContent = t('heading'); inbox.textContent = t('openInbox'); retry.textContent = t('retry');
    status.hidden = !failed && Boolean(count);
    status.textContent = failed ? t('error') : summary ? t('empty') : t('loading');
    if (!failed && document.activeElement === retry && !panel.hidden) inbox.focus({ preventScroll: true });
    retry.hidden = !failed; renderList(); paintToast();
  }
  function accept(next) {
    // When the 20-row window shrinks, an older alert exposed by a read is not a new delivery.
    const capped = summary && summary.total > summary.items.length;
    const previousFloor = capped ? Date.parse(summary.items.at(-1)?.createdAt) : NaN;
    const fresh = next.items.filter(item => item.createdAt && !seen.has(noticeKey(item))
      && (!capped || !Number.isFinite(previousFloor) || Date.parse(item.createdAt) >= previousFloor)
      && !alreadyViewing(item));
    if (notices.length) {
      notices = notices.filter(notice => next.items.some(item => noticeKey(item) === noticeKey(notice)) && !alreadyViewing(notice));
      if (notices.length) paintToast(); else hideToast();
    }
    if (summary && fresh.length && !document.hidden) {
      live.textContent = fresh.length === 1 ? itemText(fresh[0]) : t('several', { count: fresh.length });
      if (panel.hidden) showToast(fresh);
    }
    for (const item of next.items) seen.add(noticeKey(item));
    // Keep enough recent ids for paging changes without storing activity on the device.
    if (seen.size > 160) {
      const current = new Set(next.items.map(noticeKey));
      for (const id of seen) { if (seen.size <= 100) break; if (!current.has(id)) seen.delete(id); }
    }
    const stamp = JSON.stringify(next);
    const repaint = failed || signature !== stamp;
    summary = next; failed = false; signature = stamp;
    widget.hidden = false;
    if (repaint) render();
    publishCount(next.workspaceTotal ?? next.total);
  }

  let timer, busy = false, refreshNeeded = false, lastRequest = 0, delay = 30000;
  function schedule() {
    clearTimeout(timer);
    if (!document.hidden && !signedOut) timer = setTimeout(refresh, delay);
  }
  async function refresh(force = false) {
    if (document.hidden || signedOut) return;
    if (busy) { if (force) refreshNeeded = true; return; }
    clearTimeout(timer); busy = true; lastRequest = Date.now();
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 12000);
    try {
      const response = await fetch('/api/workspace/notifications?editorial=1', { credentials: 'same-origin', cache: 'no-store', signal: abort.signal });
      if (response.status === 401 || response.status === 403) {
        signedOut = true; summary = null; signature = null; seen.clear();
        live.textContent = ''; hideToast(); close(false); widget.hidden = true; render(); publishCount(0);
      } else {
        if (!response.ok) throw new Error('Notification request failed');
        const next = await response.json();
        if (!validSummary(next)) throw new Error('Unknown notification format');
        if (!refreshNeeded) accept(next);
        delay = 30000;
      }
    } catch {
      if (!failed && !signedOut) { failed = true; render(); }
      delay = Math.min(delay * 2, 120000);
    } finally {
      busy = false; clearTimeout(timeout);
      if (refreshNeeded) { refreshNeeded = false; refresh(); } else schedule();
    }
  }

  function position() {
    if (panel.hidden) return;
    const box = button.getBoundingClientRect(), gap = 8, edge = 10;
    const width = Math.min(360, window.innerWidth - edge * 2);
    const below = window.innerHeight - box.bottom - gap - edge, above = box.top - gap - edge;
    const openBelow = below >= Math.min(280, above);
    panel.style.width = width + 'px';
    panel.style.left = Math.max(edge, Math.min(box.right - width, window.innerWidth - width - edge)) + 'px';
    panel.style.top = openBelow ? Math.max(edge, box.bottom + gap) + 'px' : 'auto';
    panel.style.bottom = openBelow ? 'auto' : Math.max(edge, window.innerHeight - box.top + gap) + 'px';
    panel.style.maxHeight = Math.max(80, openBelow ? below : above) + 'px';
  }
  function open() {
    if (!panel.hidden || signedOut) return;
    hideToast();
    panel.hidden = false; panel.showPopover?.(); position();
    button.setAttribute('aria-expanded', 'true');
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    if (!busy && Date.now() - lastRequest > 5000) refresh();
  }
  function close(restoreFocus) {
    if (panel.hidden) return;
    panel.hidePopover?.(); panel.hidden = true; button.setAttribute('aria-expanded', 'false');
    window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true);
    if (restoreFocus) button.focus({ preventScroll: true });
  }
  button.addEventListener('click', () => panel.hidden ? open() : close(false));
  button.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); open(); (list.querySelector('a') || inbox).focus(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); close(true); }
    else if (event.key === 'Escape' && !toast.hidden) {
      if (toast.contains(document.activeElement)) button.focus();
      hideToast();
    }
  });
  document.addEventListener('click', event => {
    if (!panel.hidden && (!widget.contains(event.target) || event.target.closest('a[href]'))) close(false);
  });
  document.addEventListener('focusin', event => { if (!panel.hidden && !widget.contains(event.target)) close(false); });
  retry.addEventListener('click', () => refresh(true));
  document.addEventListener('nodal:workspace-changed', () => refresh(true));
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (!document.hidden) refresh();
  });
  window.nodalI18n?.onChange(render);
  render(); refresh();
})();
