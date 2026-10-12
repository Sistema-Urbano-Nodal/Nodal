/* navigation, shared by all pages: mobile menu + press glint */
(() => {
  const nav = document.querySelector('.navbar');
  const toggle = document.getElementById('navToggle');
  if (!nav || !toggle) return;
  const setOpen = (open) => {
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  setOpen(nav.classList.contains('open'));
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('open')));
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setOpen(false)));
  /* Picking a language is a menu choice too: the open sheet used to stay over the page (and the sign-in form) with
     its only close control at its bottom. The picked button goes away with the sheet, so focus returns to the toggle. */
  nav.querySelectorAll('.lang-btn').forEach((btn) => btn.addEventListener('click', () => {
    if (!nav.classList.contains('open')) return;
    setOpen(false);
    toggle.focus();
  }));
  nav.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !nav.classList.contains('open')) return;
    event.preventDefault();
    setOpen(false);
    toggle.focus();
  });

  // The toggle names what it opens; the two menu groups get ids when the page gave them none.
  const groups = [['.nav-main', 'navMenuMain'], ['.nav-account', 'navMenuAccount']]
    .map(([selector, id]) => { const group = nav.querySelector(selector); if (group && !group.id) group.id = id; return group?.id; })
    .filter(Boolean);
  if (groups.length) toggle.setAttribute('aria-controls', groups.join(' '));
  // Older headers (payments.html) shipped a toggle named "Menu" in every language.
  if (!toggle.dataset.i18nAriaLabel) {
    toggle.dataset.i18nAriaLabel = 'nav.menuLabel';
    window.nodalI18n?.refresh(toggle);
  }

  /* Keep account navigation stable while the session is loading. Current
     pages ship nav.panel; normalize older markup synchronously as well.
     The protected dashboard route handles sign-in when it is needed. */
  const joinCta = nav.querySelector('[data-i18n="nav.join"]');
  if (joinCta) {
    joinCta.href = '/dashboard.html';
    joinCta.textContent = 'My console';
    joinCta.dataset.i18n = 'nav.panel';
    window.nodalI18n?.refresh(joinCta);
  }

  // wordmark contrast: white while a dark section is under the glass bar, black otherwise
  // (.platform, "How it works", is white since the landing restyle, so it is not listed)
  const darkSections = document.querySelectorAll(
    '.problem, .quote, .membership, .partners, .cta-band, .footer-bottom');
  if (darkSections.length) {
    const checkDark = () => {
      const navH = nav.offsetHeight;
      const overDark = [...darkSections].some((el) => {
        const r = el.getBoundingClientRect();
        return r.top < navH && r.bottom > 0;
      });
      nav.classList.toggle('nav-dark', overDark);
    };
    window.addEventListener('scroll', checkDark, { passive: true });
    window.addEventListener('resize', checkDark, { passive: true });
    checkDark();
  }

  // liquid-glass press glint: light burst centred on the press point
  nav.querySelectorAll('.nav-main a, .nav-account a').forEach((a) => {
    a.addEventListener('pointerdown', (e) => {
      const r = a.getBoundingClientRect();
      a.style.setProperty('--gx', `${e.clientX - r.left}px`);
      a.style.setProperty('--gy', `${e.clientY - r.top}px`);
      a.classList.remove('glint');
      void a.offsetWidth;   // restart the animation
      a.classList.add('glint');
    });
    a.addEventListener('animationend', () => a.classList.remove('glint'));
  });
})();
