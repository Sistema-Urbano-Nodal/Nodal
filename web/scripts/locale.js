/* Runs in the head, before any page content can paint. Keep this small: the
   translation dictionaries and application code still load with defer. */
(() => {
  'use strict';
  const KEY = 'nodal.lang';
  const supported = value => ['en', 'es', 'pt'].includes(value);
  const root = document.documentElement;

  function read() {
    let saved;
    try { saved = localStorage.getItem(KEY); } catch { /* cookie fallback */ }
    if (supported(saved)) return saved;
    try {
      const cookie = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(KEY + '='));
      saved = cookie?.slice(KEY.length + 1);
    } catch { /* storage can be disabled altogether */ }
    if (supported(saved)) return saved;
    const requested = new URLSearchParams(window.location.search).get('lang');
    return supported(requested) ? requested : 'en';
  }

  function save(value) {
    const language = supported(value) ? value : 'en';
    try { localStorage.setItem(KEY, language); } catch { /* cookie fallback */ }
    try {
      document.cookie = `${KEY}=${language}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === 'https:' ? '; Secure' : ''}`;
    } catch { /* the current page still works without persistence */ }
    return language;
  }

  function reveal() { delete root.dataset.localePending; }
  window.nodalLocale = { read, save };
  root.lang = read();
  if (root.lang !== 'en') root.dataset.localePending = 'true';
  // Deferred scripts and synchronous DOMContentLoaded handlers finish before
  // the browser paints. No API, geolocation, font or image request is awaited.
  // This also releases the shell if a translation script fails to download.
  document.addEventListener('DOMContentLoaded', reveal, { once: true });
  window.addEventListener('pagehide', () => { root.dataset.localePending = 'true'; });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      const language = read();
      window.nodalI18n?.apply(language);
      window.nodalInvitationI18n?.setLanguage(language);
    }
    reveal();
  });
})();
