/* match deck: live ranked profiles for the authenticated user.
   Like → follow (server invalidates both caches); skip → recorded interaction. */
(() => {
  'use strict';

  const I18N = window.nodalI18n;
  const t = (key, vars) => (I18N ? I18N.t(key, vars) : key);
  const stack = document.getElementById('matchStack');
  const card = stack && stack.querySelector('.match-card');
  if (!card) return;

  const els = {
    initial: card.querySelector('.leader-initial'),
    name:    card.querySelector('.match-name'),
    role:    card.querySelector('.match-role'),
    tags:    card.querySelector('.tags'),
    why:     card.querySelector('.match-why'),
    skip:    card.querySelector('.m-skip'),
    like:    card.querySelector('.m-like'),
  };
  if (Object.values(els).some((el) => !el)) return;

  let deck = [];
  let idx = 0;
  let live = false;
  let needsAuth = false;
  let needsRetry = false;
  let messageMode = '';

  const fling = (dir, after) => {
    card.style.transform = `translateX(${dir * 120}%) rotate(${dir * 12}deg)`;
    card.style.opacity = '0';
    setTimeout(() => {
      card.style.transition = 'none';
      card.style.transform = `translateX(${-dir * 30}%)`;
      if (after) after();
      requestAnimationFrame(() => {
        card.style.transition = 'transform .45s cubic-bezier(.2,.8,.2,1), opacity .45s ease';
        card.style.transform = 'none';
        card.style.opacity = '1';
      });
    }, 380);
  };

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function show(p) {
    messageMode = '';
    els.initial.textContent = p.name.charAt(0).toUpperCase();
    els.name.textContent = p.name;
    els.role.textContent = `${p.role} · ${p.city}`;
    els.tags.replaceChildren(...p.interests.slice(0, 3).map((i) => {
      const span = document.createElement('span');
      span.textContent = cap(i);
      return span;
    }));
    const shared = (p.reasons?.sharedInterests || []).slice(0, 2).map(cap).join(' · ');
    const mutuals = Number(p.reasons?.mutualConnections || 0);
    const extras = [];
    if (p.reasons?.sameCity) extras.push(t('recs.sameCity'));
    if (p.reasons?.complementaryRole) extras.push(t('recs.complementaryRole'));
    els.why.textContent = t('recs.match', { pct: p.matchPct }) +
      (shared ? ` · ${shared}` : '') +
      (mutuals ? ` · ${t(mutuals === 1 ? 'recs.mutual.one' : 'recs.mutual.many', { n: mutuals })}` : '') +
      (extras.length ? ` · ${extras.join(' · ')}` : '');
    els.skip.setAttribute('aria-label', t('recs.skip'));
    els.like.setAttribute('aria-label', t('recs.connect'));
  }

  function showMessage({ title, role, tags = [], why, auth = false, retry = false }) {
    live = false;
    needsAuth = auth;
    needsRetry = retry;
    els.initial.textContent = title.charAt(0).toUpperCase();
    els.name.textContent = title;
    els.role.textContent = role;
    els.tags.replaceChildren(...tags.map((t) => {
      const span = document.createElement('span');
      span.textContent = t;
      return span;
    }));
    els.why.textContent = why;
    els.skip.disabled = true;
    els.like.disabled = !(auth || retry);
    els.skip.setAttribute('aria-label', t('recs.skip'));
    els.like.setAttribute('aria-label', auth ? t('recs.signIn') : retry ? t('recs.retry') : t('recs.connect'));
  }

  function showState(mode) {
    messageMode = mode;
    const states = {
      loading: {
        title: t('recs.loading.title'), role: t('recs.loading.role'), why: t('recs.loading.why'),
        tags: [t('recs.tag.profile'), t('recs.tag.network'), t('recs.tag.live')],
      },
      empty: {
        title: t('recs.empty.title'), role: t('recs.empty.role'), why: t('recs.empty.why'),
        tags: [t('recs.tag.profile'), t('recs.tag.network'), t('recs.tag.soon')],
      },
      auth: {
        title: t('recs.auth.title'), role: t('recs.auth.role'), why: t('recs.auth.why'), auth: true,
        tags: [t('recs.tag.account'), t('recs.tag.profile'), t('recs.tag.matches')],
      },
      unavailable: {
        title: t('recs.unavailable.title'), role: t('recs.unavailable.role'), why: t('recs.unavailable.why'), retry: true,
        tags: [t('recs.tag.live'), t('recs.tag.retry')],
      },
    };
    showMessage(states[mode]);
    messageMode = mode;
  }

  async function api(path, body) {
    const res = await fetch(path, body ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } : undefined);
    if (res.status === 401) throw Object.assign(new Error('auth required'), { code: 'auth' });
    if (!res.ok) throw new Error(`api ${res.status}`);
    return res.json();
  }

  async function load() {
    const state = await api('/api/auth/state');
    if (!state.authenticated) throw Object.assign(new Error('auth required'), { code: 'auth' });
    const data = await api('/api/recommendations/me');
    if (!Array.isArray(data.recommendations) || data.recommendations.length === 0) {
      showState('empty');
      return;
    }
    deck = data.recommendations;
    idx = 0;
    live = true;
    needsAuth = false;
    needsRetry = false;
    els.skip.disabled = false;
    els.like.disabled = false;
    show(deck[idx]);
  }

  function advance() {
    idx += 1;
    if (idx < deck.length) show(deck[idx]);
    else startLoad();   // deck spent — caches were invalidated, re-rank
  }

  function act(kind) {
    if (needsAuth) { location.assign('/login.html?next=/dashboard.html'); return; }
    if (needsRetry) { startLoad(); return; }
    if (!live || !deck[idx]) return;
    const target = deck[idx].id;
    const req = kind === 'like'
      ? api('/api/users/me/follow', { targetId: target })
      : api('/api/users/me/interactions', { targetId: target, type: 'skip' });
    req.catch(() => {});
    advance();
  }

  els.skip.addEventListener('click', () => fling(-1, () => act('skip')));
  els.like.addEventListener('click', () => fling(1, () => act('like')));

  function startLoad() {
    showState('loading');
    load().catch((err) => showState(err.code === 'auth' ? 'auth' : 'unavailable'));
  }

  I18N?.onChange(() => {
    if (live && deck[idx]) show(deck[idx]);
    else if (messageMode) showState(messageMode);
  });

  startLoad();
})();
