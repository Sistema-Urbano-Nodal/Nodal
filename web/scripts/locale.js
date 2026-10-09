/* Runs in the head, before any page content can paint. Keep this small: the
   translation dictionaries and application code still load with defer. */
(() => {
  'use strict';
  const KEY = 'nodal.lang', CHOSEN = 'nodal.lang.chosen';
  const supported = value => ['en', 'es', 'pt'].includes(value);
  const root = document.documentElement;

  function cookie(name) {
    try {
      return document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(name + '='))?.slice(name.length + 1);
    } catch { /* storage can be disabled altogether */ }
  }

  // A language the visitor picked: a saved choice, else a ?lang link. Saves from
  // before choices were marked also hold the automatic 'en', so an unmarked 'en'
  // does not count.
  function chosen() {
    let saved, marked;
    try { saved = localStorage.getItem(KEY); marked = localStorage.getItem(CHOSEN) === '1'; } catch { /* cookie fallback */ }
    if (!supported(saved)) saved = cookie(KEY);
    if (supported(saved) && (saved !== 'en' || marked || cookie(CHOSEN) === '1')) return saved;
    const requested = new URLSearchParams(window.location.search).get('lang');
    return supported(requested) ? requested : null;
  }

  // Nothing picked yet: follow the browser (Lima phones report es-PE or es-419).
  function preferred() {
    try {
      if (typeof navigator === 'undefined') return null;
      const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
      return tags.map(tag => String(tag || '').slice(0, 2).toLowerCase()).find(supported) || null;
    } catch { return null; }
  }

  const read = () => chosen() || preferred() || 'en';

  // Only explicit choices are saved, always with the marker.
  function save(value) {
    const language = supported(value) ? value : 'en';
    const attributes = `; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`;
    try { localStorage.setItem(KEY, language); localStorage.setItem(CHOSEN, '1'); } catch { /* cookie fallback */ }
    try {
      document.cookie = `${CHOSEN}=1${attributes}`;
      document.cookie = `${KEY}=${language}${attributes}`;
    } catch { /* the current page still works without persistence */ }
    return language;
  }

  function reveal() { delete root.dataset.localePending; }
  const translated = new Set();
  const translators = new Set(['i18n', 'pilot', 'recovery-i18n', 'invitation-i18n']);
  function ready(name) {
    translated.add(name);
    // Deferred translators see the complete document. Release only when every
    // translator used by this page has applied its initial text; unrelated
    // application scripts (including the globe) must not hold up first paint.
    if (document.readyState === 'loading') return;
    const required = [...document.querySelectorAll('script[src]')]
      .map(node => node.getAttribute('src').split('?')[0].split('/').pop().replace(/\.js$/, ''))
      .filter(file => translators.has(file));
    if (required.every(file => translated.has(file))) reveal();
  }
  window.nodalLocale = { read, save, ready, chosen };
  root.lang = read();
  if (root.lang !== 'en') root.dataset.localePending = 'true';
  // Fall back to the readable shell if a translation script fails to download.
  document.addEventListener('DOMContentLoaded', reveal, { once: true });
  window.addEventListener('pagehide', () => { root.dataset.localePending = 'true'; });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      // Restoring re-applies; setLanguage saves, so the browser default skips it.
      const language = read();
      window.nodalI18n?.apply(language, { persist: false });
      if (chosen()) window.nodalInvitationI18n?.setLanguage(language);
    }
    reveal();
  });
})();
