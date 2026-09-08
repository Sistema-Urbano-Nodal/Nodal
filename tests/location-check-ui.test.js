import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL('../web/' + file, import.meta.url), 'utf8');
const member = { id: 'u1', city: 'Lima, Peru', location: { lat: -12.04, lon: -77.03 }, partC: { consent: false } };
const city = { id: 'Q100', name: 'Boston', label: 'Boston, Massachusetts, United States', countryCode: 'US', lat: 42.36, lon: -71.06 };
const coordinates = { latitude: 42.360123, longitude: -71.058883, accuracy: 230.2 };
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function harness({ respond, saved = {}, storageFailure = false, permission = 'prompt', geolocation = true } = {}) {
  const nodes = {}, listeners = {}, windowListeners = {}, changes = [], requests = [], positions = [], events = [], timers = new Map();
  const storage = new Map(Object.entries(saved)); let timerId = 0, observer, timestamp = Date.UTC(2026, 8, 8, 16), permissionReads = 0;
  for (const id of ['locationCheck', 'locationCurrent', 'locationCheckNow', 'locationAutomatic', 'locationSuggestion', 'locationProposed', 'locationUse', 'locationKeep', 'locationStatus', 'locationCancel', 'locationAttribution', 'network']) nodes[id] = {
    id, hidden: false, disabled: false, checked: false, textContent: '', dataset: {}, listeners: {},
    setAttribute(key, value) { this[key] = value; }, addEventListener(type, fn) { this.listeners[type] = fn; },
    querySelectorAll() { return Object.values(nodes).filter(n => n.dataset.locationText); },
  };
  nodes.locationAttribution.dataset.locationText = 'source';
  class MockDate extends Date { constructor(...args) { super(...(args.length ? args : [timestamp])); } static now() { return timestamp; } }
  const document = { hidden: false, getElementById: id => nodes[id], addEventListener: (type, fn) => { listeners[type] = fn; } };
  const context = {
    Date: MockDate, AbortController, console,
    localStorage: { getItem(key) { if (storageFailure) throw new Error('blocked'); return storage.get(key) || null; }, setItem(key, value) { if (storageFailure) throw new Error('blocked'); storage.set(key, value); } },
    navigator: { permissions: { async query() { permissionReads++; return { state: typeof permission === 'function' ? await permission() : permission }; } }, ...(geolocation ? { geolocation: { getCurrentPosition(success, failure, options) { positions.push({ success, failure, options }); } } } : {}) },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    IntersectionObserver: class { constructor(callback) { observer = callback; } observe() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    document,
    window: { nodalI18n: { lang: 'en', onChange: fn => changes.push(fn) }, addEventListener: (type, fn) => { windowListeners[type] = fn; }, dispatchEvent(event) { events.push(event); windowListeners[event.type]?.(event); } },
    fetch: async (path, options) => {
      const body = JSON.parse(options.body); requests.push({ path, options, body });
      const result = respond ? await respond(path, body, options) : path.endsWith('/suggest') ? { city, attribution: 'GeoDB' } : { user: { ...member, city: city.label, location: { lat: city.lat, lon: city.lon } } };
      return { ok: !result.status || result.status < 400, status: result.status || 200, json: async () => result.data ?? result };
    },
  };
  vm.createContext(context);vm.runInContext(read('scripts/location-i18n.js'), context);vm.runInContext(read('scripts/location-check.js'), context);
  const api = context.window.nodalLocationCheck;
  return { nodes, requests, positions, events, storage, timers, context, api, permissionReads: () => permissionReads,
    click: id => nodes[id].listeners.click(), geo: (value = coordinates) => positions.at(-1).success({ coords: value }), geoError: code => positions.at(-1).failure({ code }),
    optIn(value) { nodes.locationAutomatic.checked = value; nodes.locationAutomatic.listeners.change(); },
    view(value) { observer([{ isIntersecting: value }]); }, hidden(value) { document.hidden = value; listeners.visibilitychange(); },
    nextDay() { timestamp += 86400000; }, language(value) { context.window.nodalI18n.lang = value; changes.forEach(fn => fn()); },
    async suggest() { const pending = this.click('locationCheckNow'); this.geo(); await pending; },
  };
}

test('location checking is opt-in and a checkbox never requests browser permission', async () => {
  const h = harness();assert.equal(h.nodes.locationCheck.hidden, true);h.api.setUser(member);h.view(true);await flush();
  assert.equal(h.nodes.locationAutomatic.checked, false);assert.equal(h.positions.length, 0);assert.equal(h.permissionReads(), 0);
  h.optIn(true);await flush();assert.equal(h.permissionReads(), 1);assert.equal(h.positions.length, 0);assert.equal(h.requests.length, 0);
  assert.deepEqual(JSON.parse(h.storage.get('nodal.location-check.v1:u1')), { enabled: true, lastCheckedDay: '' });
});

test('manual check sends approximate coordinates only and decline makes no profile write', async () => {
  const h = harness();h.api.setUser(member);await h.suggest();
  assert.deepEqual(h.requests[0].body, { latitude: 42.36, longitude: -71.06, accuracyMeters: 231 });
  assert.equal(h.positions[0].options.enableHighAccuracy, false);assert.equal(h.positions[0].options.timeout, 12000);
  assert.equal(h.nodes.locationSuggestion.hidden, false);assert.match(h.nodes.locationProposed.textContent, /Approximate city: Boston/);
  h.click('locationKeep');assert.equal(h.requests.length, 1);assert.equal(h.events.length, 0);assert.match(h.nodes.locationCurrent.textContent, /Lima/);assert.equal(h.nodes.locationSuggestion.hidden, true);
  const stored = JSON.parse(h.storage.get('nodal.location-check.v1:u1'));assert.deepEqual(Object.keys(stored).sort(), ['enabled', 'lastCheckedDay']);assert.doesNotMatch(JSON.stringify([...h.storage]), /latitude|longitude|Boston|Lima|accuracy/);
});

test('accept waits for persistence and emits confirmed city before releasing the profile save interlock', async () => {
  let finish;const h = harness({ respond: path => path.endsWith('/suggest') ? { city } : new Promise(resolve => { finish = resolve; }) });h.api.setUser(member);await h.suggest();
  const pending = h.click('locationUse');await h.click('locationUse');await h.click('locationCheckNow');
  assert.equal(h.requests.length, 2);assert.equal(h.api.isSaving, true);assert.equal(h.nodes.locationKeep.disabled, true);assert.equal(h.nodes.locationAutomatic.disabled, true);assert.match(h.nodes.locationCurrent.textContent, /Lima/);
  assert.deepEqual(h.requests[1].body, { cityId: 'Q100', expectedCity: 'Lima, Peru' });assert.deepEqual(h.events.map(e => e.type), ['nodal:location-saving']);
  finish({ user: { ...member, city: city.label, location: { lat: city.lat, lon: city.lon } } });await pending;
  assert.deepEqual(h.events.map(e => [e.type, e.detail.saving]), [['nodal:location-saving', true], ['nodal:location-updated', undefined], ['nodal:location-saving', false]]);
  assert.equal(h.events[1].detail.userId, 'u1');assert.equal(h.events[1].detail.city, city.label);assert.equal('partC' in h.events[1].detail, false);assert.equal(member.partC.consent, false);
  assert.equal(h.api.isSaving, false);assert.match(h.nodes.locationCurrent.textContent, /Boston/);assert.equal(h.nodes.locationSuggestion.hidden, true);
});

test('profile saves block acceptance and failed acceptance keeps the suggestion for retry', async () => {
  let fail = true;const h = harness({ respond: path => path.endsWith('/suggest') ? { city } : fail ? { status: 503 } : { user: { ...member, city: city.label } } });h.api.setUser(member);await h.suggest();
  h.api.setSaving(true);await h.click('locationUse');assert.equal(h.requests.length, 1);assert.match(h.nodes.locationStatus.textContent, /other profile changes/);
  h.api.setSaving(false);await h.click('locationUse');assert.equal(h.nodes.locationSuggestion.hidden, false);assert.equal(h.nodes.locationUse.disabled, false);assert.match(h.nodes.locationCurrent.textContent, /Lima/);assert.equal(h.events.some(e => e.type === 'nodal:location-updated'), false);
  fail = false;await h.click('locationUse');assert.match(h.nodes.locationCurrent.textContent, /Boston/);
});

test('session expiry and city conflicts show local feedback without falsely changing the profile', async () => {
  for (const status of [401, 409, 429]) {
    const h = harness({ respond: path => path.endsWith('/suggest') ? { city } : { status } });h.api.setUser(member);await h.suggest();await h.click('locationUse');
    assert.equal(h.nodes.locationSuggestion.hidden, false);assert.equal(h.nodes.locationUse.disabled, status === 409);assert.equal(h.events.some(e => e.type === 'nodal:location-updated'), false);
    h.language('pt');assert.match(h.nodes.locationStatus.textContent, status === 401 ? /Entre novamente/ : status === 409 ? /outra sessão/ : /Muitas verificações/);
  }
});

test('automatic checks run only once per day in the visible map with existing browser permission', async () => {
  const h = harness({ permission: 'granted', saved: { 'nodal.location-check.v1:u1': '{"enabled":true,"lastCheckedDay":""}' } });h.api.setUser(member);await flush();assert.equal(h.positions.length, 0);
  h.hidden(true);h.view(true);await flush();assert.equal(h.positions.length, 0);h.hidden(false);await flush();assert.equal(h.positions.length, 1);h.geo();await flush();
  h.view(false);h.view(true);h.hidden(true);h.hidden(false);await flush();assert.equal(h.positions.length, 1);
  h.nextDay();h.view(true);await flush();assert.equal(h.positions.length, 2);h.geo();await flush();
  await h.suggest();assert.equal(h.positions.length, 3, 'manual check is allowed after the daily automatic check');
});

test('location preference is isolated per user and malformed or blocked storage stays usable', async () => {
  const h = harness({ saved: { 'nodal.location-check.v1:u1': '{"enabled":true,"lastCheckedDay":""}' } });h.api.setUser(member);assert.equal(h.nodes.locationAutomatic.checked, true);
  h.api.setUser({ ...member, id: 'u2' });assert.equal(h.nodes.locationAutomatic.checked, false);assert.equal(h.positions.length, 0);h.optIn(true);assert.equal(JSON.parse(h.storage.get('nodal.location-check.v1:u2')).enabled, true);
  for (const options of [{ storageFailure: true }, { saved: { 'nodal.location-check.v1:u1': 'bad JSON' } }]) { const q = harness(options);q.api.setUser(member);assert.equal(q.nodes.locationAutomatic.checked, false);await q.suggest();assert.equal(q.nodes.locationSuggestion.hidden, false); }
});

test('disabling checks, cancelling, leaving, or switching user ignores a late browser position', async () => {
  for (const action of ['disable', 'cancel', 'user', 'leave']) {
    const h = harness();h.api.setUser(member);h.optIn(true);const pending = h.click('locationCheckNow');
    if (action === 'disable') h.optIn(false);else if (action === 'cancel') h.click('locationCancel');else if (action === 'user') h.api.setUser({ ...member, id: 'u2' });else h.context.window.dispatchEvent({ type: 'pagehide' });
    h.geo();await pending;assert.equal(h.requests.length, 0, action);assert.equal(h.nodes.locationSuggestion.hidden, true);assert.equal(h.nodes.locationCheck['aria-busy'], 'false');
  }
});

test('late city lookup cannot restore a suggestion after profile city changes', async () => {
  let finish;const h = harness({ respond: () => new Promise(resolve => { finish = resolve; }) });h.api.setUser(member);const pending = h.click('locationCheckNow');h.geo();await flush();
  h.api.setUser({ ...member, city: 'Paris, France' });finish({ city });await pending;assert.equal(h.nodes.locationSuggestion.hidden, true);assert.match(h.nodes.locationCurrent.textContent, /Paris/);assert.equal(h.requests.length, 1);
});

test('browser errors, broad accuracy and empty city lookup do not create an offer or profile write', async () => {
  for (const [code, expected] of [[1, /access is off/], [2, /unavailable/], [3, /too long/]]) { const h = harness();h.api.setUser(member);const pending = h.click('locationCheckNow');h.geoError(code);await pending;assert.match(h.nodes.locationStatus.textContent, expected);assert.equal(h.requests.length, 0); }
  const broad = harness();broad.api.setUser(member);const pending = broad.click('locationCheckNow');broad.geo({ ...coordinates, accuracy: 10001 });await pending;assert.match(broad.nodes.locationStatus.textContent, /too broad/);assert.equal(broad.requests.length, 0);
  const noCity = harness({ respond: () => ({ city: null }) });noCity.api.setUser(member);await noCity.suggest();assert.match(noCity.nodes.locationStatus.textContent, /could not identify/);assert.equal(noCity.nodes.locationSuggestion.hidden, true);
  const unsupported = harness({ geolocation: false });unsupported.api.setUser(member);await unsupported.click('locationCheckNow');assert.match(unsupported.nodes.locationStatus.textContent, /cannot check/);
});

test('same-city suggestions and translated active states preserve the current profile', async () => {
  const h = harness({ respond: () => ({ city: { ...city, name: 'Lima', label: member.city } }) });h.api.setUser(member);await h.suggest();assert.match(h.nodes.locationStatus.textContent, /matches Lima/);assert.equal(h.nodes.locationSuggestion.hidden, true);assert.equal(h.events.length, 0);
  const q = harness();q.api.setUser(member);const pending = q.click('locationCheckNow');q.language('pt');assert.match(q.nodes.locationStatus.textContent, /Verificando/);q.geo();await pending;q.language('es');assert.match(q.nodes.locationProposed.textContent, /Ciudad aproximada/);assert.match(q.nodes.locationUse.textContent, /^Usar Boston/);assert.equal(q.requests.length, 1);
});

test('location and API timeouts clear busy state without losing an acceptance candidate', async () => {
  const browser = harness();browser.api.setUser(member);const detection = browser.click('locationCheckNow');[...browser.timers.values()].find(timer => timer.ms === 15000).fn();await detection;
  assert.equal(browser.nodes.locationCheck['aria-busy'], 'false');assert.equal(browser.requests.length, 0);assert.match(browser.nodes.locationStatus.textContent, /too long/);
  const h = harness({ respond: (path, body, options) => path.endsWith('/suggest') ? { city } : new Promise((resolve, reject) => { options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }) });
  h.api.setUser(member);await h.suggest();const pending = h.click('locationUse');[...h.timers.values()].find(timer => timer.ms === 20000).fn();await pending;
  assert.equal(h.nodes.locationSuggestion.hidden, false);assert.equal(h.nodes.locationUse.disabled, false);assert.equal(h.api.isSaving, false);assert.match(h.nodes.locationStatus.textContent, /too long/);assert.equal(h.events.some(e => e.type === 'nodal:location-updated'), false);
});

test('location markup and dynamic copy have all EN/ES/PT translations and no background watcher', () => {
  const h = harness(), rows = h.context.window.nodalLocationI18n.rows, markup = read('pages/dashboard.html'), source = read('scripts/location-check.js');
  for (const [key, values] of Object.entries(rows)) assert.ok(values.length === 3 && values.every(value => typeof value === 'string' && value.trim()), key);
  for (const match of markup.matchAll(/data-location-text="([^"]+)"/g)) assert.ok(rows[match[1]], match[1]);
  for (const match of source.matchAll(/\blt\('([^']+)'/g)) assert.ok(rows[match[1]], match[1]);
  assert.doesNotMatch(source, /watchPosition/);assert.ok(markup.indexOf('location-check.js?') < markup.indexOf('dashboard.js?'));
  assert.match(markup, /id="locationAutomatic" aria-describedby="locationAutomaticHint locationPrivacy"/);
});
