// The staff bar's own words and sign-out. It keeps its labels here, not in i18n.js, so it works on pages that never load the desk dictionary.
// A tool with unsaved work says so through window.nodalUnsaved(), and the bar asks before it closes the session, while a save
// can still work. Once signed out it sets window.nodalSignedOut, so the tool's own leave prompt does not ask a second time.
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
    unsaved: ['Sign out and discard your unsaved changes?', '¿Cerrar sesión y descartar los cambios sin guardar?', 'Sair e descartar as alterações não salvas?'],
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
    let unsaved = true;
    try { unsaved = Boolean(window.nodalUnsaved?.()); } catch { /* a tool that cannot tell is asked about, never signed out silently */ }
    if (unsaved && !window.confirm(word('unsaved'))) return;
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
    window.nodalSignedOut = true;
    location.assign('/login.html');
  });
  paint();
  document.addEventListener('DOMContentLoaded', () => window.nodalI18n?.onChange(paint), { once: true });
})();
