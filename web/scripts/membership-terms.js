/* membership-terms: the commercial terms of Nodal Fundadores (/terminos-fundadores.html) name a contact email and a
   Libro de Reclamaciones that the team sets in the environment (MEMBERSHIP_CONTACT_EMAIL, MEMBERSHIP_COMPLAINTS_URL).
   GET /api/billing/config answers them as `contact` ({email, complaintsUrl}, or null until both are set). Each field
   on the page says "pendiente de publicación" until this script finds a value it trusts; values only ever become
   text and attributes. */
(() => {
  'use strict';
  // The server checks both settings; the page checks again before making either one a link.
  const EMAIL = /^[A-Za-z0-9._+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}$/;
  const email = (value) => (typeof value === 'string' && value.length <= 254 && EMAIL.test(value) ? value : null);
  const complaintsUrl = (value) => {
    if (typeof value !== 'string' || !value.startsWith('https://')) return null;
    try { const url = new URL(value); return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : null; } catch { return null; }
  };

  function mailLink(address) {
    const link = document.createElement('a');
    link.href = `mailto:${address}`;
    link.textContent = address;
    return link;
  }

  function complaintsLink(href) {
    const link = document.createElement('a'), note = document.createElement('span');
    link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = 'Abrir el Libro de Reclamaciones';
    note.className = 'terms-hidden'; note.textContent = ' (se abre en una pestaña nueva)';
    link.append(note);
    return link;
  }

  function fill(contact) {
    if (!contact || typeof contact !== 'object') return;
    const address = email(contact.email), href = complaintsUrl(contact.complaintsUrl);
    for (const slot of document.querySelectorAll('[data-terms-contact]')) {
      const kind = slot.dataset.termsContact;
      if (kind === 'email' && address) slot.replaceChildren(mailLink(address));
      if (kind === 'complaints' && href) slot.replaceChildren(complaintsLink(href));
    }
  }

  fetch('/api/billing/config', { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => fill(data?.contact))
    .catch(() => { /* Offline or static hosting: every field keeps saying it is pending. */ });
})();
