/* fundadores: the join page of the Founder Membership 2027 (/fundadores.html). The page carries its text in each
   language (fundadores.css shows the one on <html lang>), so this script only names the tab and decides the closing
   action from GET /api/billing/config: while sign-ups are open ('open'), the button to the payments page, which
   sends a signed-out visitor to sign in and back; once the offer has ended ('ended'), a line that says so; otherwise
   (not open yet, no answer, static hosting), a line that sign-ups open soon. The button ships hidden and is removed
   wherever it would lead nowhere; nothing shows while the request is in flight. Text is set with textContent only. */
(() => {
  'use strict';
  const TITLES = {
    es: 'Nodal Fundadores · Membresía Fundador 2027',
    en: 'Nodal Fundadores · Founder Membership 2027',
    pt: 'Nodal Fundadores · Membresia Fundador 2027',
  };
  const LINES = {
    ended: {
      es: 'La oferta Membresía Fundador 2027 cerró el 31 de diciembre de 2026.',
      en: 'The Founder Membership 2027 offer closed on 31 December 2026.',
      pt: 'A oferta Membresia Fundador 2027 foi encerrada em 31 de dezembro de 2026.',
    },
    soon: {
      es: 'Las inscripciones abren pronto.',
      en: 'Sign-ups open soon.',
      pt: 'As inscrições abrem em breve.',
    },
  };
  // The Spanish text is the team's; any other language the page cannot show reads as it.
  const language = (value) => (Object.hasOwn(TITLES, value) ? value : 'es');

  function nameTab() {
    document.title = TITLES[language(document.documentElement.lang)];
  }

  function render(config) {
    const state = config && typeof config === 'object' ? config.state : null;
    // The page offers both ways to pay, so it sends people on only while both are on sale; one link alone reads as soon.
    const offered = new Set((Array.isArray(config?.options) ? config.options : []).map((option) => option?.id));
    if (state === 'open' && offered.has('once') && offered.has('installments')) {
      document.querySelectorAll('[data-fund-join]').forEach((link) => { link.hidden = false; });
      return;
    }
    document.querySelectorAll('[data-fund-join]').forEach((link) => link.remove());
    const lines = LINES[state === 'ended' ? 'ended' : 'soon'];
    document.querySelectorAll('[data-fund-state]').forEach((slot) => {
      slot.textContent = lines[language(slot.dataset.fundState)];
      slot.hidden = false;
    });
  }

  nameTab();
  // i18n.js sets <html lang> before it tells its subscribers, on a click and on a page restored from the cache.
  window.nodalI18n?.onChange(nameTab);

  fetch('/api/billing/config', { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then(render);
})();
