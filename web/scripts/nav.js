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
  nav.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !nav.classList.contains('open')) return;
    event.preventDefault();
    setOpen(false);
    toggle.focus();
  });

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
  const darkSections = document.querySelectorAll(
    '.problem, .platform, .quote, .membership, .partners, .cta-band, .footer-bottom');
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
