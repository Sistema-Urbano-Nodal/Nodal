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
      list.replaceChildren(...ordered(state.items).map(post));
      host.hidden = state.items.length === 0;
      if (more) {
        more.textContent = t('news.more');
        more.hidden = !state.cursor;
        more.disabled = state.loading;
      }
      if (all) all.textContent = t('news.all');
      // The block ships hidden, so a link to it (community.html#nodal-news from the console) finds nothing to jump to
      // while the page loads. Once the first page is shown, go to it once; a later page or a language change never scrolls.
      if (!state.settled && !state.loading) {
        state.settled = true;
        if (!host.hidden && host.id && window.location?.hash === `#${host.id}`) host.scrollIntoView({ block: 'start' });
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

    return { load, render };
  }

  const feeds = hosts.map(feed);
  feeds.forEach((entry) => entry.load());
  I18N?.onChange(() => feeds.forEach((entry) => entry.render()));
})();
