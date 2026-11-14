/* First-party visit counter: one POST per page view, no cookie, no visitor id. Staff browsers are marked and not counted. */
(() => {
  const KEY = 'nodal.staff';
  try { if (document.currentScript && document.currentScript.hasAttribute('data-staff')) localStorage.setItem(KEY, '1'); } catch (e) { /* storage refused */ }
  if (document.currentScript && document.currentScript.hasAttribute('data-staff')) return;
  try { if (location.pathname === '/login.html') localStorage.removeItem(KEY); } catch (e) { /* storage refused */ }
  let marked = false;
  try { marked = localStorage.getItem(KEY) === '1'; } catch (e) { /* no marker */ }
  if (marked || navigator.webdriver === true || document.prerendering === true) return;
  let r = '';
  try {
    const from = new URL(document.referrer);
    r = from.host === location.host ? 'self' : from.hostname;
  } catch (e) { /* empty or unparseable referrer */ }
  let v = new URLSearchParams(location.search).get('via') || '';
  if (v.length > 20) v = '';
  try {
    fetch('/api/visit', { method: 'POST', keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p: location.pathname, r, v }) }).catch(() => {});
  } catch (e) { /* never reaches the page */ }
})();
