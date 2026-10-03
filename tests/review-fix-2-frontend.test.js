import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const script = name => readFileSync(new URL(`../web/scripts/${name}.js`, import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
// Safari 15 (and so every iOS 15 browser) has AbortSignal, but not AbortSignal.timeout.
class Safari15AbortSignal {}

class Element {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.style = {}; this.hidden = false; this.textContent = ''; this.value = ''; this.classList = { add() {}, remove() {}, toggle() {} }; }
  append(...nodes) { for (const node of nodes) { if (typeof node === 'object') node.parent = this; this.children.push(node); } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  setAttribute(key, value) { this[key] = value; }
  removeAttribute(key) { if (key === 'hidden') this.hidden = false; else delete this[key]; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  dispatchEvent(event) { return this.listeners[event.type]?.(event); }
  setPointerCapture() {}
  focus() {}
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 500, height: 500 }; }
}

/* ---------- course invitation acceptance ---------- */
function invitation({ AbortSignalImpl }) {
  const nodes = {}, listeners = {}, requests = [];
  for (const id of ['invitationForm', 'recoveryMessage', 'invitationTitle', 'invitationName', 'invitationPassword', 'invitationConfirm', 'invitationSubmit', 'invitationSignIn']) nodes[id] = new Element(id === 'invitationForm' ? 'form' : 'div');
  nodes.invitationForm.hidden = true;
  const document = { readyState: 'loading', documentElement: {}, getElementById: id => nodes[id] || null, querySelector: () => null, querySelectorAll: () => [], addEventListener: (type, fn) => { listeners[type] = fn; } };
  const ctx = vm.createContext({
    document, URLSearchParams, AbortSignal: AbortSignalImpl, window: {}, location: { hash: '#token_hash=' + 'a'.repeat(56), search: '' },
    history: { replaceState() {} }, localStorage: { getItem: () => null, setItem() {} },
    fetch: async (path, options) => { requests.push({ path, options }); return { json: async () => ({ passwordChanged: true, courseIds: ['00000000-0000-4000-8000-000000000001'] }) }; },
  });
  vm.runInContext(script('accept-invitation'), ctx); vm.runInContext(script('invitation-i18n'), ctx); listeners.DOMContentLoaded();
  nodes.invitationName.value = 'New Member'; nodes.invitationPassword.value = 'a secure password'; nodes.invitationConfirm.value = 'a secure password';
  return { nodes, requests, submit: () => nodes.invitationForm.listeners.submit({ preventDefault() {} }) };
}

test('an invitee on iOS 15 can still set a password and join: the request goes out without AbortSignal.timeout', async () => {
  const h = invitation({ AbortSignalImpl: Safari15AbortSignal });
  await h.submit();
  assert.equal(h.requests.length, 1, 'the completion request is sent');
  assert.equal(h.requests[0].path, '/api/auth/course-invitation/complete');
  assert.equal(h.requests[0].options.signal, undefined);
  assert.equal(h.nodes.recoveryMessage.dataset.invitationText, 'done', 'not "invitation_uncertain"');
  // A browser with the API keeps its 45 s limit.
  const modern = invitation({ AbortSignalImpl: AbortSignal });
  await modern.submit();
  assert.ok(modern.requests[0].options.signal instanceof AbortSignal);
});

/* ---------- the dashboard globe ---------- */
const member = (id, name) => ({ id, name, role: 'Researcher', linkedin: '', joinedAt: '2026-09-01T00:00:00Z' });
const snapshot = { places: [{ city: 'Boston', label: 'Boston', lat: 20, lon: -70, members: 1, named: 1, people: [member('a', 'Ana')] }, { city: 'Lima', label: 'Lima', lat: -12, lon: -77, members: 1, named: 1, people: [member('b', 'Ben')] }], links: [], topics: [], you: null };

function globe({ reducedMotion = true, AbortSignalImpl = AbortSignal } = {}) {
  const ids = Object.fromEntries(['globeCanvas', 'globeCard', 'globeCity', 'globeLabel', 'globeCount', 'globePeople', 'globeLinks', 'globeEyebrow', 'globeYou', 'globeYouCta', 'globeEmpty', 'globeFeed', 'globeFeedLabel', 'globeTopics', 'globeSince', 'globeSinceLabel', 'globePlay'].map(id => [id, new Element()]));
  const requests = [], frames = new Map(), documentEvents = {}, windowEvents = {}, mediaListeners = [];
  let frameId = 0, requested = 0, now = 1000;
  const drawing = new Proxy({ createRadialGradient: () => ({ addColorStop() {} }) }, { get(target, key) { return target[key] ?? (() => {}); } });
  ids.globeCanvas.getContext = () => drawing;
  const motion = { matches: reducedMotion, addEventListener: (type, fn) => mediaListeners.push(fn) };
  const window = { devicePixelRatio: 1, matchMedia: () => motion, addEventListener(type, fn) { windowEvents[type] = fn; }, nodalI18n: { lang: 'en', t: key => key, onChange() {} } };
  const document = { hidden: false, getElementById: id => ids[id] || null, createElement: tag => new Element(tag), addEventListener(type, fn) { documentEvents[type] = fn; } };
  const context = vm.createContext({
    window, document, console, Event, AbortSignal: AbortSignalImpl, performance: { now: () => now },
    IntersectionObserver: class { observe() {} },
    requestAnimationFrame: callback => { requested += 1; const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    fetch: async (path, options) => { requests.push({ path, options }); return { status: 200, ok: true, headers: { get: () => 'etag-1' }, json: async () => snapshot }; },
  });
  for (const file of ['globe-geo', 'globe']) vm.runInContext(script(file), context);
  return {
    ids, requests, motion, mediaListeners, windowEvents,
    requested: () => requested,
    // Runs every frame that is due, as the browser would on its next paint.
    paint() { const due = [...frames.entries()]; frames.clear(); now += 16; for (const [, callback] of due) callback(now); return due.length; },
    pending: () => frames.size,
  };
}

test('the globe still polls the network on iOS 15, where AbortSignal.timeout does not exist', async () => {
  const h = globe({ AbortSignalImpl: Safari15AbortSignal });
  await flush();
  assert.equal(h.requests.length, 1, 'the first poll reaches /api/network/places');
  assert.equal(h.requests[0].path, '/api/network/places');
  assert.equal(h.requests[0].options.signal, undefined);
  assert.equal(h.ids.globeEmpty.hidden, true, 'the places are drawn, not left empty');
  const modern = globe();
  await flush();
  assert.ok(modern.requests[0].options.signal instanceof AbortSignal, 'browsers with the API keep the 20 s limit');
});

test('with reduced motion the globe is painted once and repainted only when something changes', async () => {
  const h = globe({ reducedMotion: true });
  await flush();
  assert.equal(h.paint() >= 1, true, 'the first picture is drawn');
  assert.equal(h.pending(), 0, 'no frame is queued for an image that does not move');
  const before = h.requested();
  for (let i = 0; i < 5; i++) h.paint();
  assert.equal(h.requested(), before, 'idle frames are not requested at display rate');
  // Something changes: stepping to the next city repaints once, then the loop rests again.
  h.ids.globeCanvas.dispatchEvent({ type: 'keydown', key: 'ArrowRight', preventDefault() {} });
  assert.equal(h.pending(), 1);
  h.paint();
  assert.equal(h.pending(), 0);
  // Several changes before the next paint share one frame.
  h.ids.globeCanvas.dispatchEvent({ type: 'pointerleave' });
  h.windowEvents.resize();
  assert.equal(h.pending(), 1);
  h.paint();
  // Turning reduced motion off brings the spin back.
  h.motion.matches = false;
  h.mediaListeners.forEach(fn => fn());
  h.paint(); h.paint();
  assert.equal(h.pending(), 1, 'an animated globe keeps its loop running');
});

test('without reduced motion the globe keeps spinning frame after frame', async () => {
  const h = globe({ reducedMotion: false });
  await flush();
  for (let i = 0; i < 4; i++) { h.paint(); assert.equal(h.pending(), 1); }
});

/* ---------- Export my data ---------- */
test('Export my data releases its blob URL after the download has started, not in the same tick', async () => {
  const source = script('dashboard');
  const start = source.indexOf("    uc.exportData?.addEventListener('click'");
  const end = source.indexOf('    uc.deleteAccount?.addEventListener', start);
  assert.ok(start > 0 && end > start, 'the export handler is where the test expects it');
  const events = [], timers = [];
  let handler;
  const link = { click: () => events.push('click'), remove: () => events.push('remove') };
  const context = vm.createContext({
    uc: { exportData: { addEventListener: (type, fn) => { handler = fn; } }, error: { hidden: true, textContent: '' } },
    api: async () => ({ data: { profile: { name: 'Ana' } } }),
    Blob: class { constructor(parts, options) { this.parts = parts; this.type = options.type; } },
    URL: { createObjectURL: () => { events.push('create'); return 'blob:nodal/export'; }, revokeObjectURL: url => events.push(`revoke ${url}`) },
    document: { createElement: () => link, body: { appendChild: node => { events.push('append'); return node; } } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    t: key => key, JSON,
  });
  vm.runInContext(source.slice(start, end), context);
  await handler();
  assert.deepEqual(events, ['create', 'append', 'click', 'remove'], 'the URL is still valid when click() returns');
  assert.equal(link.download, 'nodal-member-data.json');
  assert.equal(timers.length, 1);
  assert.ok(timers[0].ms >= 30000, 'long enough for a slow WebKit download to begin');
  timers[0].fn();
  assert.equal(events.at(-1), 'revoke blob:nodal/export', 'and it is released afterwards');
});
