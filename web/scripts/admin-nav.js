// The staff bar's own words and sign-out. It keeps its labels here, not in i18n.js, so it works on pages that never load the desk dictionary.
(() => {
  const nav = document.querySelector('[data-staff-nav]');
  if (!nav) return;
  const WORDS = {
    home: ['Metrics', 'Indicadores', 'Indicadores'],
    desk: ['Publishing', 'Publicación', 'Publicação'],
    festival: ['Festival', 'Festival', 'Festival'],
    courses: ['Courses', 'Cursos', 'Cursos'],
    signOut: ['Sign out', 'Cerrar sesión', 'Sair'],
    aria: ['Administration', 'Administración', 'Administração'],
    signingOut: ['Signing out…', 'Cerrando sesión…', 'Saindo…'],
    failed: ['Sign out failed.', 'No se pudo cerrar la sesión.', 'Não foi possível sair.'],
  };
  const status = nav.querySelector('[data-staff-status]');
  let line = '';
  const word = (key) => WORDS[key][{ es: 1, pt: 2 }[document.documentElement.lang] || 0];
  const paint = () => {
    for (const el of nav.querySelectorAll('[data-staff]')) if (WORDS[el.dataset.staff]) el.textContent = word(el.dataset.staff);
    nav.setAttribute('aria-label', word('aria'));
    if (status) status.textContent = line ? word(line) : '';
  };
  const button = [...nav.querySelectorAll('[data-staff]')].find((el) => el.dataset.staff === 'signOut');
  button?.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    line = 'signingOut';
    paint();
    let ok = false;
    try {
      ok = (await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } })).ok;
    } catch { ok = false; }
    if (!ok) {
      button.disabled = false;
      line = 'failed';
      paint();
      return;
    }
    try { localStorage.removeItem('nodal.staff'); } catch { /* storage refused: the session is closed anyway */ }
    location.assign('/login.html');
  });
  paint();
  document.addEventListener('DOMContentLoaded', () => window.nodalI18n?.onChange(paint), { once: true });
})();
