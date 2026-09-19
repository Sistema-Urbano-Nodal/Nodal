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
  window.nodalLocale = { read, save, ready };
  root.lang = read();
  if (root.lang !== 'en') root.dataset.localePending = 'true';
  // Fall back to the readable shell if a translation script fails to download.
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
