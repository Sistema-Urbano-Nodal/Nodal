/* First-party visit counter: one POST per page view, no cookie, no visitor id. Staff browsers are marked and not counted. */
(() => {
  const KEY = 'nodal.staff';
  try { if (document.currentScript && document.currentScript.hasAttribute('data-staff')) localStorage.setItem(KEY, '1'); } catch (e) { /* storage refused */ }
  if (document.currentScript && document.currentScript.hasAttribute('data-staff')) return;
  try { if (location.pathname === '/login.html') localStorage.removeItem(KEY); } catch (e) { /* storage refused */ }
  let marked = false;
  try { marked = localStorage.getItem(KEY) === '1'; } catch (e) { /* no marker */ }
  if (marked || navigator.webdriver === true) return;
  const send = () => {
    let r = '';
    try {
      const from = new URL(document.referrer);
      r = from.host === location.host ? 'self' : from.hostname;
    } catch (e) { /* empty or unparseable referrer */ }
    // A reload or a back/forward navigation keeps the first referrer: a view, not a new arrival.
    try {
      const type = performance.getEntriesByType('navigation')[0].type;
      if (type === 'reload' || type === 'back_forward') r = 'self';
    } catch (e) { /* no Navigation Timing */ }
    let v = new URLSearchParams(location.search).get('via') || '';
    if (v.length > 20) v = '';
    try {
      fetch('/api/visit', { method: 'POST', keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p: location.pathname, r, v }) }).catch(() => {});
    } catch (e) { /* never reaches the page */ }
  };
  // A prerendered page counts only once the visitor opens it.
  if (document.prerendering === true) {
    try { document.addEventListener('prerenderingchange', send, { once: true }); } catch (e) { /* no prerendering events */ }
    return;
  }
  send();
})();
