/* navigation, shared by all pages: mobile menu + press glint */
(() => {
  const nav = document.querySelector('.navbar');
  const toggle = document.getElementById('navToggle');
  if (!nav || !toggle) return;
  toggle.addEventListener('click', () => nav.classList.toggle('open'));
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => nav.classList.remove('open')));

  /* A signed-in member should not be invited to join. The pill's link already
     lands on the console (login.html forwards an authenticated visitor), so
     only the label lies — swap its key and let i18n re-translate. The English
     text is set here first: apply() captures it as the key's EN value, the
     way it captures every other label from the page. */
  const joinCta = nav.querySelector('[data-i18n="nav.join"]');
  if (joinCta) {
    fetch('/api/auth/state')
      .then((res) => (res.ok ? res.json() : null))
      .then((state) => {
        if (!state?.authenticated) return;
        joinCta.textContent = 'My console';
        joinCta.dataset.i18n = 'nav.panel';
        window.nodalI18n?.apply(window.nodalI18n.lang);
      })
      .catch(() => { /* signed-out or static mode: the invitation stands */ });
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
