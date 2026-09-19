(() => {
  'use strict';
  const root = document.documentElement;
  const labels = {en:'Language',es:'Idioma',pt:'Idioma'};
  function apply(value, navigate = false) {
    const lang = ['en','es','pt'].includes(value) ? value : 'en';
    root.lang = lang;
    window.nodalLocale?.save(lang);
    const article = document.querySelector(`article[data-policy-lang="${lang}"]`);
    document.title = `NODAL · ${article.dataset.title}`;
    document.querySelector('[data-policy-label="language"]').setAttribute('aria-label', labels[lang]);
    document.querySelectorAll('[data-lang]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.lang === lang)));
    // Keep the same section when switching languages or opening a saved link.
    const url = new URL(window.location.href);
    if (/^#(?:en|es|pt)-\d+$/.test(url.hash)) url.hash = url.hash.replace(/^#(?:en|es|pt)-/, `#${lang}-`);
    if (url.searchParams.has('lang')) url.searchParams.set('lang', lang);
    try { window.history.replaceState(window.history.state,'',url.pathname + url.search + url.hash); } catch { /* Reading still works with restricted history. */ }
    if (navigate && url.hash) document.getElementById(url.hash.slice(1))?.scrollIntoView();
    window.nodalLocale?.ready?.('privacy');
  }
  document.querySelectorAll('[data-lang]').forEach(button => button.addEventListener('click', () => apply(button.dataset.lang, true)));
  window.addEventListener('pageshow', event => { if(event.persisted)apply(window.nodalLocale?.read()); });
  apply(window.nodalLocale?.read() || root.lang, true);
})();
