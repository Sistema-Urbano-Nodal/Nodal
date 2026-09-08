(() => {
  'use strict';
  const host = document.getElementById('locationCheck');
  if (!host) return;
  const { lt } = window.nodalLocationI18n;
  const node = id => document.getElementById(id);
  const current = node('locationCurrent'), check = node('locationCheckNow'), preference = node('locationAutomatic');
  const suggestion = node('locationSuggestion'), proposed = node('locationProposed'), use = node('locationUse'), keep = node('locationKeep');
  const message = node('locationStatus'), cancel = node('locationCancel'), attribution = node('locationAttribution');
  let user = null, enabled = false, lastCheckedDay = '', phase = 'idle', statusKey = '', candidate = null, expectedCity = '';
  let externalSaving = false, accepting = false, blocked = false, visible = false, active = true, generation = 0;
  let controller = null, cancelPosition = null, permissionPending = null;
  const storageKey = () => 'nodal.location-check.v1:' + user.id;
  const day = () => { const now = new Date(); return [now.getFullYear(), now.getMonth() + 1, now.getDate()].join('-'); };
  const busy = () => phase !== 'idle';
  const sameCity = (a, b) => String(a || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase() === String(b || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
  function persist() {
    if (!user) return;
    try { localStorage.setItem(storageKey(), JSON.stringify({ enabled, lastCheckedDay })); } catch { /* Manual checks still work without storage. */ }
  }
  function announceSaving(value) {
    if (accepting === value) return;
    accepting = value;
    window.dispatchEvent(new CustomEvent('nodal:location-saving', { detail: { saving: value } }));
  }
  function stop() {
    generation++; controller?.abort(); controller = null; cancelPosition?.(); cancelPosition = null;
    permissionPending = null; phase = 'idle'; announceSaving(false);
  }
  function render() {
    host.hidden = !user;
    host.querySelectorAll('[data-location-text]').forEach(element => { element.textContent = lt(element.dataset.locationText); });
    if (!user) return;
    current.textContent = lt('current', { city: user.city || lt('missing') });
    preference.checked = enabled; preference.disabled = accepting;
    check.disabled = busy() || externalSaving; check.textContent = lt('check');
    host.setAttribute('aria-busy', String(busy()));
    cancel.hidden = !['locating', 'lookup'].includes(phase);
    suggestion.hidden = !candidate;
    if (candidate) {
      proposed.textContent = lt('suggested', { city: candidate.label });
      use.textContent = lt('use', { city: candidate.name });
      keep.textContent = user.city ? lt('keep', { city: user.city }) : lt('keepUnset');
    }
    use.disabled = busy() || externalSaving || blocked; keep.disabled = accepting;
    attribution.hidden = !candidate;
    const key = phase !== 'idle' ? phase : externalSaving && candidate ? 'profileBusy' : statusKey;
    message.textContent = key ? lt(key, { city: user.city || lt('missing') }) : '';
    message.hidden = !key;
  }
  async function request(path, body) {
    controller = new AbortController();
    const pending = controller, timeout = setTimeout(() => pending.abort(), 20000);
    try {
      const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: pending.signal });
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error('request'), { status: response.status });
      return data;
    } finally { clearTimeout(timeout); if (controller === pending) controller = null; }
  }
  const errorKey = error => error.status === 401 ? 'signIn' : error.status === 429 ? 'rate' : error.status === 409 ? 'conflict' : ['AbortError', 'TimeoutError'].includes(error.name) ? 'timeout' : 'failed';
  function position() {
    return new Promise((resolve, reject) => {
      let finished = false;
      const complete = (fn, value) => { if (finished) return; finished = true; clearTimeout(timeout); cancelPosition = null; fn(value); };
      const timeout = setTimeout(() => complete(reject, { code: 3 }), 15000);
      cancelPosition = () => complete(reject, Object.assign(new Error('cancelled'), { name: 'AbortError' }));
      try { navigator.geolocation.getCurrentPosition(value => complete(resolve, value), error => complete(reject, error), { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 }); }
      catch (error) { complete(reject, error); }
    });
  }
  async function detect() {
    if (!user || busy() || externalSaving || !active) return;
    if (!navigator.geolocation?.getCurrentPosition) { statusKey = 'unsupported'; render(); return; }
    const operation = ++generation, id = user.id;
    candidate = null; blocked = false; statusKey = ''; expectedCity = user.city || ''; phase = 'locating';
    lastCheckedDay = day(); persist(); render();
    try {
      const { coords } = await position();
      if (operation !== generation || user?.id !== id || !active) return;
      const { latitude, longitude, accuracy } = coords || {};
      if (![latitude, longitude, accuracy].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0) { statusKey = 'unavailable'; return; }
      if (accuracy > 10000) { statusKey = 'imprecise'; return; }
      phase = 'lookup'; render();
      // Quantize before leaving the browser. Never store the browser position.
      const result = await request('/api/me/location/suggest', { latitude: Number(latitude.toFixed(2)), longitude: Number(longitude.toFixed(2)), accuracyMeters: Math.ceil(accuracy) });
      if (operation !== generation || user?.id !== id || !active) return;
      const city = result.city;
      if (!city) { statusKey = 'none'; return; }
      if (!['string', 'number'].includes(typeof city.id) || !city.name || !city.label) throw new Error('invalid city');
      if (sameCity(city.label, user.city) || sameCity(city.name, user.city)) { statusKey = 'same'; return; }
      candidate = { id: city.id, name: String(city.name), label: String(city.label) };
    } catch (error) {
      if (operation !== generation || user?.id !== id) return;
      statusKey = error.code === 1 ? 'denied' : error.code === 2 ? 'unavailable' : error.code === 3 ? 'timeout' : errorKey(error);
    } finally { if (operation === generation) { phase = 'idle'; render(); } }
  }
  async function accept() {
    if (!user || !candidate || busy() || blocked || externalSaving || !active) return;
    const operation = ++generation, id = user.id, cityId = candidate.id;
    phase = 'saving'; statusKey = ''; announceSaving(true); render();
    try {
      const result = await request('/api/me/location/accept', { cityId, expectedCity });
      if (operation !== generation || user?.id !== id || !active) return;
      if (result.user?.id !== id || typeof result.user.city !== 'string' || !result.user.city.trim()) throw new Error('invalid profile');
      user = result.user; candidate = null; statusKey = 'updated';
      window.dispatchEvent(new CustomEvent('nodal:location-updated', { detail: { userId: id, city: user.city, location: user.location } }));
    } catch (error) {
      if (operation !== generation || user?.id !== id) return;
      statusKey = errorKey(error); blocked = error.status === 409;
    } finally { if (operation === generation) { phase = 'idle'; announceSaving(false); render(); } }
  }
  async function automatic() {
    if (!user || !enabled || lastCheckedDay === day() || !visible || document.hidden || !active || busy() || externalSaving || permissionPending || !navigator.permissions?.query) return;
    const operation = generation, id = user.id, inquiry = {}; permissionPending = inquiry;
    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      if (operation === generation && user?.id === id && permission.state === 'granted' && enabled && visible && !document.hidden && active && lastCheckedDay !== day()) await detect();
    } catch { /* A manual check can request permission where Permissions API is unavailable. */ }
    finally { if (permissionPending === inquiry) permissionPending = null; }
  }
  preference.addEventListener('change', () => {
    if (accepting) return;
    enabled = preference.checked;
    if (!enabled) { stop(); candidate = null; blocked = false; statusKey = ''; }
    persist(); render(); if (enabled) automatic();
  });
  check.addEventListener('click', detect); use.addEventListener('click', accept);
  keep.addEventListener('click', () => { if (accepting) return; stop(); candidate = null; blocked = false; statusKey = 'unchanged'; lastCheckedDay = day(); persist(); render(); });
  cancel.addEventListener('click', () => { stop(); candidate = null; statusKey = 'unchanged'; render(); });
  const controllerApi = {
    setUser(next) {
      const previousId = user?.id, previousCity = user?.city;
      if (!next?.id) { stop(); user = null; candidate = null; render(); return; }
      if (previousId !== next.id) {
        stop(); user = next; candidate = null; blocked = false; statusKey = ''; enabled = false; lastCheckedDay = ''; externalSaving = false;
        try { const saved = JSON.parse(localStorage.getItem(storageKey()) || 'null'); enabled = saved?.enabled === true; lastCheckedDay = typeof saved?.lastCheckedDay === 'string' ? saved.lastCheckedDay : ''; } catch { /* Start with opt-in off. */ }
      } else {
        user = next;
        if (previousCity !== next.city) { stop(); candidate = null; blocked = false; statusKey = ''; }
      }
      render(); automatic();
    },
    setSaving(value) { externalSaving = Boolean(value); render(); if (!externalSaving) automatic(); },
    get isSaving() { return accepting; },
  };
  window.nodalLocationCheck = controllerApi;
  if (typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); if (visible) automatic(); }, { threshold: 0.1 });
    observer.observe(document.getElementById('network') || host);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) automatic(); });
  window.addEventListener('pagehide', () => { active = false; stop(); candidate = null; statusKey = ''; render(); });
  window.addEventListener('pageshow', () => { active = true; automatic(); });
  window.nodalI18n?.onChange(render); render();
})();
