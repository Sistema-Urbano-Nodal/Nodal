/* Keep already-open member pages in browser history. Only a short-lived, cookie-bound
   confirmation can be reused across a link click; member data stays in its own document. */
(() => {
  'use strict';
  const root = document.documentElement;
  const nav = window.navigation;
  const scopes = new Map([['/dashboard.html', 'dashboard'], ['/profile.html', 'profile']]);
  const scope = scopes.get(location.pathname);
  const boundary = new Set(['/login.html', '/reset-password.html', '/accept-invitation.html']);
  const handoffKey = 'nodal.member-return';
  const handoffMs = 4000;
  let hint, clickVersion = 0;

  function confirmation(surface, nonce = '') {
    const query = '/api/auth/view?scope=' + surface + (nonce ? '&check=' + nonce : '');
    const options = {credentials: 'same-origin', cache: nonce ? 'default' : 'no-store'};
    if (nonce && window.AbortSignal?.timeout) options.signal = window.AbortSignal.timeout(3000);
    return fetch(query, options);
  }
  function storedHint() {
    try {
      const data = JSON.parse(sessionStorage.getItem(handoffKey));
      sessionStorage.removeItem(handoffKey);
      if (data?.entry === nav?.currentEntry?.key && Date.now() - data.at < handoffMs
          && /^[\da-f-]{36}$/.test(data.nonce)) return data.nonce;
    } catch { /* Unavailable storage simply means a fresh confirmation. */ }
    return '';
  }

  if (scope && root.hasAttribute('data-overview-pending')) {
    let visit = 0;
    let stamp = '';
    let viewer;
    const mask = on => { root.toggleAttribute('data-overview-pending', on); root.inert = on; };
    const signIn = () => location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
    async function readViewer() {
      const response = await fetch('/api/auth/me', {cache: 'no-store', headers: {'X-Nodal-View': '1'}});
      if (response.status === 401) { signIn(); throw Error('authentication required'); }
      if (!response.ok) throw Error('member unavailable');
      const data = await response.json();
      return {data, stamp: response.headers.get('X-Nodal-View-Stamp')};
    }
    window.nodalMemberSession = readViewer().then(result => {
      viewer = result.data.user;
      stamp = result.stamp;
      return result.data;
    });
    // Consumers report their own loading errors, including when this script finishes before they initialize.
    window.nodalMemberSession.catch(() => { window.nodalMemberSession = null; });
    window.addEventListener('pagehide', () => { ++visit; mask(true); });
    window.addEventListener('pageshow', async event => {
      if (!event.persisted) return;
      const current = ++visit;
      mask(true);
      try {
        const response = await confirmation(scope, storedHint());
        if (current !== visit) return;
        if (response.status === 401) { signIn(); return; }
        if (!response.ok) throw Error('confirmation unavailable');
        const state = await response.json();
        if (current !== visit) return;
        if (!viewer || !stamp || stamp !== state.stamp) {
          const result = await readViewer();
          if (current !== visit) return;
          viewer = result.data.user;
          stamp = result.stamp;
        }
        const page = scope === 'profile' ? window.nodalProfile : window.nodalDashboard;
        const allowed = await page?.resume(viewer, state.directoryRevision);
        if (current !== visit) return;
        if (allowed) mask(false);
        else location.reload();
      } catch (error) {
        if (current === visit && error.message !== 'authentication required') location.reload();
      }
    });
    mask(false);
  }

  // Account pages can also return to one another, including a profile in forward history
  // after returning from it to Overview. Match the member ID, filters and explicit language.
  function destination(event) {
    const link = event.target.closest?.('a[href]');
    if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return null;
    const url = new URL(link.href);
    if (url.origin !== location.origin || !scopes.has(url.pathname) || url.hash) return null;
    return url;
  }
  function matches(prior, target) {
    if (prior.pathname !== target.pathname) return false;
    const query = new URLSearchParams(prior.search);
    // A plain menu link keeps the language the member already chose in this tab.
    if (!target.searchParams.has('lang')) query.delete('lang');
    query.sort();
    const requested = new URLSearchParams(target.search); requested.sort();
    return query.toString() === requested.toString();
  }
  function findEntry(target) {
    if (!nav?.currentEntry) return null;
    const entries = nav.entries(), current = nav.currentEntry.index;
    for (const direction of [-1, 1]) {
      for (let i = current + direction; i >= 0 && i < entries.length; i += direction) {
        const entry = entries[i];
        if (!entry.url) continue;
        const prior = new URL(entry.url);
        if (prior.origin !== location.origin || boundary.has(prior.pathname)) break;
        if (matches(prior, target)) return entry;
      }
    }
    return null;
  }
  function prepare(entry, target) {
    if (hint?.entry === entry.key && Date.now() - hint.at < handoffMs) return hint;
    if (!window.crypto?.randomUUID) return null;
    const next = {entry: entry.key, at: Date.now(), nonce: window.crypto.randomUUID()};
    // Consume the small response so the browser can reuse it on the destination, varying on its actual cookies.
    next.ready = confirmation(scopes.get(target.pathname), next.nonce)
      .then(async response => { await response.arrayBuffer(); return response.ok; }).catch(() => false);
    hint = next;
    return next;
  }
  function anticipate(event) {
    const target = destination(event);
    const entry = target && findEntry(target);
    // The profile sidebar includes other members' directory consent. Validate it at
    // activation, so a member who opts out while the pointer rests on a link stays hidden.
    if (entry && target.pathname !== '/profile.html') prepare(entry, target);
  }
  document.addEventListener('pointerover', anticipate);
  document.addEventListener('focusin', anticipate);
  window.addEventListener('pagehide', () => { ++clickVersion; hint = null; });
  const landingLength = history.length;
  document.addEventListener('click', event => {
    const version = ++clickVersion;
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = destination(event);
    if (!target) return;
    if (scope && matches(new URL(location.href), target)) {
      event.preventDefault();
      return;
    }
    const entry = findEntry(target);
    if (!entry) {
      if (!nav?.currentEntry && document.referrer && history.length > 1 && history.length === landingLength) {
        const previous = new URL(document.referrer);
        if (previous.origin === location.origin && matches(previous, target)) { event.preventDefault(); history.back(); }
      }
      return;
    }
    event.preventDefault();
    const traverse = () => nav.traverseTo(entry.key).committed.catch(error => {
      if (error.name !== 'AbortError') location.assign(target.href);
    });
    const prepared = prepare(entry, target);
    if (!prepared) { traverse(); return; }
    // On a slow connection keep the current page visible until this transition is ready.
    prepared.ready.then(ok => {
      if (version !== clickVersion) return;
      if (ok && Date.now() - prepared.at < handoffMs) {
        try { sessionStorage.setItem(handoffKey, JSON.stringify({entry: entry.key, at: prepared.at, nonce: prepared.nonce})); }
        catch { /* The destination can check directly. */ }
      }
      traverse();
    });
  });
})();
