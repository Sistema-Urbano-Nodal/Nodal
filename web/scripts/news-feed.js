/* NODAL news: the network-wide posts staff publish from the publishing desk,
   pinned first and then newest, rendered into every [data-nodal-news] block
   (the member console's context column and the community page).
   Options on the block: data-nodal-news-limit (posts per page, 1–20),
   data-nodal-news-heading (h2–h6 for post titles, default h3),
   data-nodal-news-more (offer the next page) and data-nodal-news-all (a link
   to the full list). Post text is set with textContent only; a link is shown
   only for an https URL and opens in a new tab with rel=noopener. The block
   stays hidden while there is nothing to show, including on static hosting
   with no API. Markup classes are the festival news ones (fiiu.css), so both
   kinds of news read the same. */
(() => {
  'use strict';
  const hosts = [...document.querySelectorAll('[data-nodal-news]')];
  if (!hosts.length) return;

  const I18N = window.nodalI18n;
  const t = (key) => (I18N ? I18N.t(key) : key);
  const LOCALES = { en: 'en-GB', es: 'es-ES', pt: 'pt-BR' };
  const language = () => Object.hasOwn(LOCALES, I18N?.lang) ? I18N.lang : 'en';
  const unavailable = {
    en: { missing: 'This post is no longer available.', error: 'This post could not be loaded. Reload the page to try again.' },
    es: { missing: 'Esta publicación ya no está disponible.', error: 'No se pudo cargar esta publicación. Recarga la página para intentarlo de nuevo.' },
    pt: { missing: 'Esta publicação não está mais disponível.', error: 'Não foi possível carregar esta publicação. Recarregue a página para tentar novamente.' },
  };
  const formats = new Map();
  function dateText(value) {
    const date = typeof value === 'string' && value ? new Date(value) : null;
    if (!date || !Number.isFinite(date.getTime())) return '';
    const locale = LOCALES[I18N?.lang] || 'en-GB';
    if (!formats.has(locale)) formats.set(locale, new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }));
    return formats.get(locale).format(date);
  }
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function httpsUrl(value) {
    if (typeof value !== 'string' || !value) return '';
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : '';
    } catch { return ''; }
  }
  const time = (value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  // The API already sends pinned first, then newest; sorting again keeps an appended page in that order.
  const ordered = (items) => [...items].sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true) || time(b.publishedAt) - time(a.publishedAt));
  const valid = (item) => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.title === 'string' && item.title.trim();

  function feed(host) {
    const limit = Math.min(Math.max(Number.parseInt(host.dataset.nodalNewsLimit, 10) || 5, 1), 20);
    const heading = /^h[2-6]$/.test(host.dataset.nodalNewsHeading || '') ? host.dataset.nodalNewsHeading : 'h3';
    const allHref = host.dataset.nodalNewsAll || '';
    const state = { items: [], cursor: null, loading: false, settled: false };
    const linkedId = host.id === 'nodal-news' ? new URLSearchParams(window.location?.search).get('news') : null;
    let linkedPost = null, linkedMessage = '', readingLinked = Boolean(linkedId);
    const list = el('div', 'f-news nodal-news-list');
    const more = 'nodalNewsMore' in host.dataset ? el('button', 'f-button secondary nodal-news-more') : null;
    const all = allHref ? el('a', 'f-text-link nodal-news-all') : null;
    if (more) {
      more.type = 'button';
      more.addEventListener('click', () => load(state.cursor));
    }
    if (all) all.href = allHref;
    host.append(list, ...[more, all].filter(Boolean));

    function post(item) {
      const article = el('article', 'f-news-item');
      const meta = el('p', 'f-news-meta');
      if (item.pinned === true) meta.append(el('span', 'f-news-pinned', t('news.pinned')));
      const when = dateText(item.publishedAt);
      if (when) {
        const stamp = el('time', 'f-news-date', when);
        stamp.dateTime = item.publishedAt;
        meta.append(stamp);
      }
      if (meta.children.length) article.append(meta);
      article.append(el(heading, 'f-news-title', item.title));
      if (typeof item.body === 'string' && item.body.trim()) article.append(el('p', 'f-news-body', item.body));
      const url = httpsUrl(item.url);
      if (url) {
        const link = el('a', 'f-text-link', t('news.open'));
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', `${t('news.open')}: ${item.title} (${t('news.newTab')})`);
        article.append(link);
      }
      return article;
    }

    function render() {
      const rows = ordered(state.items);
      const selected = linkedPost || rows.find(item => item.id === linkedId);
      const displayed = selected ? [selected, ...rows.filter(item => item.id !== selected.id)] : rows;
      const notice = linkedMessage && !selected ? el('p', 'f-status', unavailable[language()][linkedMessage]) : null;
      list.replaceChildren(...(notice ? [notice] : []), ...displayed.map(post));
      host.hidden = !notice && displayed.length === 0;
      if (more) {
        more.textContent = t('news.more');
        more.hidden = !state.cursor;
        more.disabled = state.loading;
      }
      if (all) all.textContent = t('news.all');
      // The block ships hidden, so a link to it (community.html#nodal-news from the console) finds nothing to jump to
      // while the page loads. Once the first page is shown, go to it once; a later page or a language change never scrolls.
      if (!state.settled && !state.loading && !readingLinked) {
        state.settled = true;
        if (!host.hidden && host.id && window.location?.hash === `#${host.id}`) host.scrollIntoView({ block: 'start' });
      }
    }

    async function loadLinked() {
      if (!linkedId) return;
      try {
        if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(linkedId)) {
          linkedMessage = 'missing';
          return;
        }
        const response = await fetch('/api/news/' + encodeURIComponent(linkedId), { headers: { Accept: 'application/json' } });
        if (response.status === 404) { linkedMessage = 'missing'; return; }
        if (!response.ok) throw Error('news unavailable');
        const { item } = await response.json();
        if (!valid(item) || item.id !== linkedId.toLowerCase()) throw Error('invalid news item');
        linkedPost = item;
      } catch {
        linkedMessage = 'error';
      } finally {
        readingLinked = false;
        render();
      }
    }

    async function load(cursor = null) {
      if (state.loading) return;
      state.loading = true;
      if (more) more.disabled = true;
      try {
        const params = new URLSearchParams({ limit: String(limit) });
        if (cursor) params.set('cursor', cursor);
        const response = await fetch(`/api/news?${params}`, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`news ${response.status}`);
        const data = await response.json();
        const items = Array.isArray(data?.items) ? data.items.filter(valid) : [];
        const seen = new Set(state.items.map((item) => item.id));
        state.items = cursor ? [...state.items, ...items.filter((item) => !seen.has(item.id))] : items;
        state.cursor = typeof data.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null;
      } catch {
        // No API (static hosting) or a failed page: keep what is already shown.
      } finally {
        state.loading = false;
        render();
      }
    }

    return { load, loadLinked, render };
  }

  // The member manages only their own address. A failed read never shows a guessed subscription state.
  for (const section of document.querySelectorAll('[data-news-email]')) {
    const [heading, description, button, status] = section.children;
    const copy = {
      en: { heading: 'Email updates', description: 'Choose whether to receive an email when NODAL publishes news or featured public opportunities. You can change this here at any time.', subscribe: 'Subscribe', unsubscribe: 'Unsubscribe', on: 'Subscribed.', off: 'Subscription off.', error: 'We could not confirm your preference.', retry: 'Try again', login: 'Sign in to manage email updates' },
      es: { heading: 'Novedades por correo', description: 'Elige si quieres recibir un correo cuando NODAL publique noticias u oportunidades públicas destacadas. Puedes cambiarlo aquí cuando quieras.', subscribe: 'Suscribirme', unsubscribe: 'Darme de baja', on: 'Suscripción activa.', off: 'Suscripción desactivada.', error: 'No pudimos confirmar tu preferencia.', retry: 'Volver a intentar', login: 'Iniciar sesión para gestionar los avisos' },
      pt: { heading: 'Novidades por e-mail', description: 'Escolha se deseja receber um e-mail quando a NODAL publicar notícias ou oportunidades públicas em destaque. Você pode alterar esta opção aqui a qualquer momento.', subscribe: 'Inscrever-me', unsubscribe: 'Cancelar inscrição', on: 'Inscrição ativa.', off: 'Inscrição desativada.', error: 'Não foi possível confirmar sua preferência.', retry: 'Tentar novamente', login: 'Entrar para gerenciar os avisos' },
    };
    const login = el('a', 'f-text-link');
    section.append(login);
    let enabled = false, view = 'loading';
    const render = () => {
      if (view === 'loading') return;
      const words = copy[language()];
      heading.textContent = words.heading;
      description.textContent = words.description;
      button.hidden = view === 'guest';
      button.textContent = view === 'error' ? words.retry : enabled ? words.unsubscribe : words.subscribe;
      status.textContent = view === 'error' ? words.error : view === 'guest' ? '' : enabled ? words.on : words.off;
      login.hidden = view !== 'guest';
      login.href = '/login.html?' + new URLSearchParams({ next: '/community.html#news-email', lang: language() });
      login.textContent = words.login;
      const wasHidden = section.hidden;
      section.hidden = false;
      if (wasHidden && window.location?.hash === '#news-email') section.scrollIntoView({ block: 'start' });
    };
    async function update(options) {
      button.disabled = true;
      try {
        const response = await fetch('/api/news/email-preference', options);
        if (response.status === 401) { view = 'guest'; return; }
        if (!response.ok) throw Error('preference unavailable');
        const data = await response.json();
        if (typeof data.enabled !== 'boolean') throw Error('invalid preference');
        enabled = data.enabled;
        view = 'ready';
      } catch {
        view = 'error';
      } finally {
        button.disabled = false;
        render();
      }
    }
    button.addEventListener('click', () => update(view === 'ready' ? {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !enabled, language: language() }),
    } : undefined));
    update();
    I18N?.onChange(render);
  }

  const feeds = hosts.map(feed);
  feeds.forEach((entry) => { entry.load(); entry.loadLinked(); });
  I18N?.onChange(() => feeds.forEach((entry) => entry.render()));
})();
