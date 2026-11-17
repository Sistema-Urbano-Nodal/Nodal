import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

/* course.html and courses.html as tests/courses-ui.test.js runs them: pilot-i18n.js, pilot.js and then courses.js on a
   small DOM, with every request answered by `respond`. */
const script = (name) => readFileSync(new URL(`../web/scripts/${name}.js`, import.meta.url), 'utf8');
class Node {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.hidden = false; this.textContent = ''; this.value = ''; this.files = []; this.classList = { toggle() {} }; }
  append(...nodes) { nodes.forEach((n) => { if (typeof n === 'object') { detach(n); n.parent = this; } this.children.push(n); }); }
  prepend(...nodes) { nodes.forEach((n) => { detach(n); n.parent = this; }); this.children.unshift(...nodes); }
  after(node) { const p = this.parent; if (p) { detach(node); node.parent = p; p.children.splice(p.children.indexOf(this) + 1, 0, node); } }
  get firstElementChild() { return this.children.find((n) => typeof n === 'object') || null; }
  get nextElementSibling() { const siblings = this.parent?.children.filter((n) => typeof n === 'object') || [], at = siblings.indexOf(this); return at < 0 ? null : siblings[at + 1] || null; }
  replaceChildren(...nodes) { this.children.forEach((n) => { if (typeof n === 'object') n.parent = null; }); this.children = []; this.append(...nodes); }
  setAttribute(k, v) { this[k] = v; }
  getAttribute(k) { return this[k] ?? null; }
  removeAttribute(k) { delete this[k]; }
  addEventListener(k, f) { this.listeners[k] = f; }
  querySelectorAll(selector) {
    return descendants(this).filter((n) => (selector === '[data-pilot-text]' ? n.dataset.pilotText : selector === '[data-pilot-dynamic]' ? n.dataset.pilotDynamic
      : selector === '[data-pilot-placeholder]' ? n.dataset.pilotPlaceholder : selector === '[data-pilot-aria]' ? n.dataset.pilotAria
        : selector === '[data-module]' ? n.dataset.module : selector[0] === '.' ? n.className?.split(' ').includes(selector.slice(1)) : n.tagName === selector));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  replaceWith(node) { if (this.parent) { node.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this), 1, node); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((n) => n !== this); this.parent = null; }
  focus() { this.focused = true; }
  scrollIntoView() {}
  reset() { descendants(this).filter((n) => n.tagName === 'input' || n.tagName === 'textarea').forEach((n) => { n.value = ''; n.files = []; }); }
}
const descendants = (node) => (node.children || []).flatMap((n) => (typeof n === 'object' ? [n, ...descendants(n)] : []));
const detach = (node) => { if (node.parent) node.parent.children = node.parent.children.filter((n) => n !== node); };
const content = (n) => [n.textContent, ...(n.children || []).map(content)].join(' ');
const flush = async () => { for (let i = 0; i < 15; i += 1) await new Promise((r) => setImmediate(r)); };
const findKey = (node, key) => descendants(node).find((n) => n.dataset.pilotText === key);

function harness(respond, { page = 'courses', search = '' } = {}) {
  const body = new Node('body'); body.dataset.page = page;
  const ids = {};
  for (const id of ['pilotRoot', 'pilotStatus', 'teachingLink']) { const n = new Node(); n.id = id; ids[id] = n; body.append(n); }
  const requests = [], listeners = [];
  const document = {
    body, documentElement: new Node('html'), readyState: 'loading', visibilityState: 'visible', createElement: (tag) => new Node(tag),
    getElementById: (id) => ids[id] || descendants(body).find((n) => n.id === id), querySelector: () => null,
    querySelectorAll: (selector) => body.querySelectorAll(selector), addEventListener() {}, removeEventListener() {},
  };
  const ctx = {
    document, console, Intl, URL, URLSearchParams, Error, Date, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    history: { replaceState() {} },
    location: { pathname: `/${page}.html`, search, href: `https://nodal.test/${page}.html${search}`, assign() {}, replace() {} },
    fetch: async (path, opts) => {
      requests.push({ path, method: opts?.method });
      const result = await respond(path, opts);
      return { ok: result.status === undefined || result.status < 400, status: result.status || 200, json: async () => result.data ?? result };
    },
    window: { addEventListener() {}, nodalI18n: { lang: 'en', onChange: (f) => listeners.push(f) } },
  };
  vm.createContext(ctx);
  for (const file of ['pilot-i18n', 'pilot']) vm.runInContext(script(file), ctx);
  return {
    ctx, body, ids, requests,
    run: (name) => vm.runInContext(script(name), ctx),
    lang: (lang) => { ctx.window.nodalI18n.lang = lang; listeners.forEach((f) => f()); },
  };
}

const course = { id: 'c1', title: 'Curso Movilidad', description: 'Desc', startsOn: '2026-09-09', endsOn: '2026-09-21', status: 'published', enrollmentOpen: true };
// An enrolled member's course with one session, whose conversation `posts` answers.
const enrolledCourse = (posts) => (path, opts) => {
  if (path.endsWith('/events')) return { ok: true };
  if (path.split('?')[0].endsWith('/posts')) return posts(path, opts);
  if (path.endsWith('/modules/m1')) return { module: { id: 'm1', title: 'Session', resources: [] } };
  if (path === '/api/courses/c1') return { course, modules: [{ id: 'm1', title: 'Session' }], enrollment: {}, intake: { fullName: 'Member' }, isAdmin: false };
  return { ok: true };
};


test('an empty conversation that keeps failing to load offers one Try again, however often it is refreshed', async () => {
  let offline = true;
  const h = harness(enrolledCourse(() => (offline ? { status: 503, data: { error: 'Discussion unavailable' } } : { posts: [], nextCursor: null, revision: 'r1' })),
    { page: 'course', search: '?id=c1' });
  h.run('courses'); await flush();
  const pane = h.ctx.document.getElementById('module-pane-discussion');
  const retries = () => descendants(pane).filter((n) => n.dataset.pilotText === 'retry' && !n.hidden);
  assert.equal(retries().length, 1);

  // Still offline, the member presses Refresh conversation twice.
  for (let i = 0; i < 2; i += 1) { await findKey(pane, 'refreshConversation').listeners.click(); await flush(); }
  assert.equal(retries().length, 1);

  offline = false;
  await retries()[0].listeners.click(); await flush();
  assert.equal(retries().length, 0);
  assert.match(content(pane), /Start the conversation/);
});

test('a feedback form without a star says so in the interface language instead of leaving it to the browser', async () => {
  const h = harness(() => ({ feedback: { id: 'saved' } }));
  h.lang('pt');
  const box = h.ctx.window.nodalPilot.feedback('matching');
  h.body.append(box);
  const form = descendants(box).find((n) => n.tagName === 'form');
  // As a browser submits: unless the form opts out of validation, a required star left empty stops the submit event, and
  // the browser shows its own bubble, in the browser's language, on a radio that cannot be seen.
  const unanswered = descendants(form).some((n) => n.required && n.type === 'radio' && !descendants(form).some((m) => m.name === n.name && m.checked));
  if (form.noValidate || !unanswered) await form.listeners.submit({ preventDefault() {}, stopPropagation() {} });
  assert.match(content(box), /Escolha uma avaliação de 1 a 5\./);
  assert.equal(h.requests.length, 0);
});
