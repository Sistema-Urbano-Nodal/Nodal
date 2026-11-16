import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

/* The member console's globe (globe.js), run in a fake page: the topic chips, the time scrub, the keyboard and
   the arrivals feed, with a small dictionary so a language switch can be watched. */
const script = (name) => readFileSync(new URL(`../web/scripts/${name}.js`, import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

class Element {
  constructor() {
    this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.style = {};
    this.hidden = false; this.textContent = ''; this.value = ''; this.className = '';
    this.classList = { add() {}, remove() {} };
  }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { if (name === 'hidden') this.hidden = false; else delete this.attributes[name]; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  dispatchEvent(event) { return this.listeners[event.type]?.(event); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 500, height: 500 }; }
  setPointerCapture() {}
}

const DICTIONARY = {
  en: { 'd.globe.allTopics': 'All topics', 'd.topic.mobility': 'Mobility', 'd.globe.today': 'Today', 'd.globe.asOf': 'As of {date}' },
  es: { 'd.globe.allTopics': 'Todos los temas', 'd.topic.mobility': 'Movilidad', 'd.globe.today': 'Hoy', 'd.globe.asOf': 'Hasta {date}' },
  pt: { 'd.globe.allTopics': 'Todos os temas', 'd.topic.mobility': 'Mobilidade', 'd.globe.today': 'Hoje', 'd.globe.asOf': 'Até {date}' },
};
const member = (id, name, joinedAt = '2026-09-01T00:00:00Z') => ({ id, name, role: 'Researcher', linkedin: '', joinedAt });
const city = (name, people, lon = -70) => ({ city: name, label: name, lat: 20, lon, members: people.length, named: people.length, people });
const snapshot = (places, topics = [{ name: 'Mobility', members: places.reduce((n, p) => n + p.members, 0) }]) => ({
  places, links: [], topics, you: { listed: true, hasCity: true, onMap: true, city: places[0]?.city ?? '' },
});
const reply = (data, status = 200) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => `snapshot-${status}` }, json: async () => data });

function harness(initial) {
  const ids = Object.fromEntries(['globeCanvas', 'globeCard', 'globeCity', 'globeLabel', 'globeCount', 'globePeople', 'globeLinks', 'globeEyebrow', 'globeYou', 'globeYouCta', 'globeEmpty', 'globeFeed', 'globeFeedLabel', 'globeTopics', 'globeSince', 'globeSinceLabel', 'globePlay'].map((id) => [id, new Element()]));
  const requests = []; const documentEvents = {}; const languageListeners = [];
  let respond = () => reply(initial);
  ids.globeCanvas.getContext = () => new Proxy({ createRadialGradient: () => ({ addColorStop() {} }) }, { get(target, key) { return target[key] ?? (() => {}); } });
  const i18n = {
    lang: 'en',
    t(key, vars) { return String(DICTIONARY[this.lang][key] ?? key).replace(/\{(\w+)\}/g, (match, name) => (vars && name in vars ? String(vars[name]) : match)); },
    onChange(fn) { languageListeners.push(fn); },
  };
  const window = { IntersectionObserver: true, devicePixelRatio: 1, matchMedia: () => ({ matches: true }), addEventListener() {}, nodalI18n: i18n };
  const document = { hidden: false, getElementById: (id) => ids[id] || null, createElement: () => new Element(), addEventListener(type, listener) { documentEvents[type] = listener; } };
  const context = vm.createContext({
    window, document, console, Event, AbortSignal, performance: { now: () => 1000 },
    IntersectionObserver: class { observe() {} },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    fetch: async (path, options) => { requests.push({ path, headers: options.headers }); return respond(path, options); },
  });
  for (const file of ['globe-geo', 'globe']) vm.runInContext(script(file), context);
  return {
    ids, requests,
    respond(fn) { respond = fn; },
    // a poll as the visibility handler runs one (it skips the wait between polls)
    poll: () => documentEvents.visibilitychange(),
    language(lang) { i18n.lang = lang; languageListeners.forEach((fn) => fn(lang)); },
    chips: () => ids.globeTopics.children,
    chipText: () => ids.globeTopics.children.map((chip) => chip.textContent),
    key: (key) => ids.globeCanvas.dispatchEvent({ type: 'keydown', key, preventDefault() {} }),
    scrubTo(index) { ids.globeSince.value = String(index); ids.globeSince.dispatchEvent({ type: 'input' }); },
  };
}

/* ---------- M93: the chips and the time label follow a language switch ---------- */

test('a language switch rewrites the topic chips and the time label in the new language', async () => {
  const joined = ['2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'];
  const h = harness(snapshot([city('Lima', [member('a', 'Ana', joined[0]), member('b', 'Bea', joined[1])])]));
  await flush();
  assert.deepEqual(h.chipText(), ['All topics', 'Mobility · 2']);
  assert.equal(h.ids.globeSinceLabel.textContent, 'Today');

  // Polls answer 304 while nothing changes, so the switch itself has to redraw them.
  h.language('es');
  assert.deepEqual(h.chipText(), ['Todos los temas', 'Movilidad · 2']);
  assert.equal(h.ids.globeSinceLabel.textContent, 'Hoy');

  // A cut in time is said in the new language, with the date written the way that language writes it.
  h.scrubTo(0);
  const day = (tag) => new Date(joined[0]).toLocaleDateString(tag, { day: 'numeric', month: 'short', year: 'numeric' });
  assert.equal(h.ids.globeSinceLabel.textContent, `Hasta ${day('es-ES')}`);
  h.language('pt');
  assert.equal(h.ids.globeSinceLabel.textContent, `Até ${day('pt-BR')}`);
  assert.equal(h.ids.globeSince.value, '0', 'the switch keeps the cut where the member left it');
  assert.deepEqual(h.chipText(), ['Todos os temas', 'Mobilidade · 2']);
});

test('a globe with nothing to filter, or signed out, stays without chips and time label after a language switch', async () => {
  const quiet = harness(snapshot([city('Lima', [member('a', 'Ana')])], []));
  await flush();
  quiet.language('es');
  assert.equal(quiet.chips().length, 0, 'no topics: not even an "All topics" chip');
  assert.equal(quiet.ids.globeSinceLabel.hidden, true, 'one join date is no timeline');

  const h = harness(snapshot([city('Lima', [member('a', 'Ana', '2026-08-01T00:00:00Z'), member('b', 'Bea')])]));
  await flush();
  h.respond(() => reply({}, 401)); h.poll(); await flush();
  h.language('es');
  assert.equal(h.chips().length, 0);
  assert.equal(h.ids.globeSinceLabel.hidden, true);
  assert.equal(h.ids.globeSinceLabel.textContent, '');
});

test('a lone "All topics" chip, left after the last topic went, follows a language switch too', async () => {
  const lima = [city('Lima', [member('a', 'Ana')])];
  const h = harness(snapshot(lima));
  await flush();
  h.respond(() => reply(snapshot(lima, [])));
  h.poll(); await flush();
  assert.deepEqual(h.chipText(), ['All topics'], 'the chip that clears a filter stays when nobody lists a topic');
  h.language('es');
  assert.deepEqual(h.chipText(), ['Todos los temas']);
});

/* ---------- M96: the arrow keys start from either end ---------- */

test('with no city picked, ArrowLeft opens the last city and ArrowRight the first', async () => {
  const places = ['Lima', 'Bogotá', 'Quito', 'Santiago'].map((name, i) => city(name, [member(`m${i}`, `Member ${i}`)], -80 + i * 5));
  const h = harness(snapshot(places));
  await flush();
  h.key('ArrowLeft');
  assert.equal(h.ids.globeCity.textContent, 'Santiago', 'the last city, not the one before it');
  h.key('ArrowLeft');
  assert.equal(h.ids.globeCity.textContent, 'Quito');
  h.key('ArrowRight'); h.key('ArrowRight');
  assert.equal(h.ids.globeCity.textContent, 'Lima', 'past the last city the steps wrap to the first');

  const fresh = harness(snapshot(places));
  await flush();
  fresh.key('ArrowRight');
  assert.equal(fresh.ids.globeCity.textContent, 'Lima');
});

/* ---------- M142: a filtered answer is not a list of arrivals ---------- */

test('picking a topic and going back to all topics announces nobody, and a real arrival still is', async () => {
  const ana = member('ana', 'Ana'); const bob = member('bob', 'Bob'); const cid = member('cid', 'Cid');
  const everyone = snapshot([city('Boston', [ana, bob]), city('Lima', [cid], -77)]);
  const h = harness(everyone);
  await flush();
  h.respond((path) => reply(path.endsWith('?topic=Mobility') ? snapshot([city('Boston', [ana])]) : everyone));

  h.chips()[1].dispatchEvent({ type: 'click' });   // Mobility: Boston [Ana]
  await flush();
  assert.equal(h.requests.at(-1).path, '/api/network/places?topic=Mobility');
  h.chips()[0].dispatchEvent({ type: 'click' });   // All topics again
  await flush();
  assert.equal(h.requests.at(-1).path, '/api/network/places');
  const feed = () => [h.ids.globeFeed.textContent, ...h.ids.globeFeed.children.map((row) => row.children.map((cell) => cell.textContent).join(' '))].join(' ');
  assert.equal(h.ids.globeFeed.children.length, 0, `nobody joined, yet the feed reads: ${feed()}`);
  assert.equal(h.ids.globeFeed.hidden, true);
  assert.equal(h.ids.globeCard.hidden, true, 'the globe does not spin to a member who was there all along');

  h.respond(() => reply(snapshot([city('Boston', [ana, bob, member('dan', 'Dan')]), city('Lima', [cid], -77)])));
  h.poll();
  await flush();
  assert.match(feed(), /Dan/);
  assert.doesNotMatch(feed(), /Ana|Bob|Cid/);
});

/* ---------- M155: the topic chips say which one is on ---------- */

test('the topic chips tell a screen reader which filter is on, through a pick and a language switch', async () => {
  const everyone = snapshot([city('Lima', [member('a', 'Ana'), member('b', 'Bea')])]);
  const h = harness(everyone);
  await flush();
  const pressed = () => h.chips().map((chip) => chip.getAttribute('aria-pressed'));
  assert.deepEqual(pressed(), ['true', 'false'], 'all topics is the filter on at first');
  h.chips()[1].dispatchEvent({ type: 'click' });
  await flush();
  assert.deepEqual(pressed(), ['false', 'true']);
  assert.match(h.chips()[1].className, /\bis-on\b/, 'the colour and the pressed state agree');
  h.language('es');
  assert.deepEqual(pressed(), ['false', 'true']);
  h.chips()[1].dispatchEvent({ type: 'click' });   // the same chip again turns the filter off
  await flush();
  assert.deepEqual(pressed(), ['true', 'false']);
});
