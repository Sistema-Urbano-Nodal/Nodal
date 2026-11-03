import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/* The organisations card's request window on the landing page (spec: docs/superpowers/specs/2026-11-03-organisation-
   node-requests-design.md, "What visitors see"). node-request.js runs against the real markup of index.html, cut into
   fake elements by id, and the real i18n.js, so a label is the page's own copy in each language. */
const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const HTML = read('web', 'pages', 'index.html');
const between = (html, start, end) => { const at = html.indexOf(start); return at < 0 ? '' : html.slice(at, html.indexOf(end, at) + end.length); };
const CARD = between(HTML, '<article class="plan plan-org">', '</article>');
const DIALOG = between(HTML, '<dialog', '</dialog>');
// Read when a test runs, so a missing script fails each test rather than the whole file.
const script = () => read('web', 'scripts', 'node-request.js');
const TEAM = ['fmuro@sistemaurbano.org', 'malegre@sistemaurbano.org'];
const FIELDS = { name: 'nodeRequestName', organization: 'nodeRequestOrganization', email: 'nodeRequestEmail', phone: 'nodeRequestPhone', message: 'nodeRequestMessage' };

const attributesOf = (source) => Object.fromEntries([...source.matchAll(/([a-z][\w-]*)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, value ?? '']));
function element(html, id) {
  const match = html.match(new RegExp(`<([a-z][a-z0-9]*)\\b([^>]*\\bid="${id}"[^>]*)>`));
  assert.ok(match, `#${id} is in the markup`);
  return { tag: match[1], ...attributesOf(match[2]) };
}

class Element {
  constructor(document, tag, attributes = {}) {
    Object.assign(this, { ownerDocument: document, tagName: tag, attributes: {}, dataset: {}, children: [], listeners: new Map(), own: '', value: '', disabled: false });
    for (const [name, value] of Object.entries(attributes)) this.setAttribute(name, value);
    this.hidden = 'hidden' in attributes;
    this.id = attributes.id || '';
  }
  get textContent() { return this.own + this.children.map((child) => (typeof child === 'string' ? child : child.textContent)).join(''); }
  set textContent(value) { this.children = []; this.own = String(value); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.own = ''; this.children = [...nodes]; }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (match, letter) => letter.toUpperCase())] = String(value);
  }
  getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(handler); }
  dispatch(type) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const handler of this.listeners.get(type) || []) handler(event);
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; }
}
// A modal <dialog> as the browser runs it: Escape fires cancel and, unless refused, closes; close() fires close.
class Dialog extends Element {
  constructor(...args) { super(...args); this.open = false; }
  showModal() { if (this.open) throw new Error('InvalidStateError: the dialog is already open'); this.open = true; }
  close() { if (!this.open) return; this.open = false; this.dispatch('close'); }
  escape() { if (!this.dispatch('cancel').defaultPrevented) this.close(); }
}
// Every start tag of the card and the window becomes an element, with the text that follows it up to the next tag.
function elements(document, html) {
  return [...html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>([^<]*)/g)].map(([, tag, source, text]) => {
    const node = new (tag === 'dialog' ? Dialog : Element)(document, tag, attributesOf(source));
    node.own = text;
    return node;
  });
}

function loadI18n(nodes, lang) {
  // i18n.js finds its nodes with [data-i18n], [data-i18n-aria-label] and the like.
  const select = (selector) => {
    const match = /^\[data-([a-z0-9-]+)\]$/.exec(selector);
    if (!match) return [];
    const key = match[1].replace(/-([a-z])/g, (all, letter) => letter.toUpperCase());
    return nodes.filter((node) => key in node.dataset);
  };
  const context = {
    document: { body: { dataset: { page: 'home' } }, documentElement: {}, querySelectorAll: select },
    window: { location: { search: '' } },
    localStorage: { getItem() { return null; }, setItem() {} },
    URLSearchParams,
    console,
  };
  vm.runInNewContext(read('web', 'scripts', 'i18n.js'), context);
  context.window.nodalI18n.apply(lang);
  return context.window.nodalI18n;
}

const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const answer = (status, payload = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, async json() { return payload; } });
function later() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function mount({ lang = 'en', hash = '', fetchImpl = async () => answer(202, { ok: true }), dialogs = true } = {}) {
  const document = { activeElement: null, createElement: (tag) => new Element(document, tag), getElementById: (id) => byId.get(id) ?? null };
  const nodes = [...elements(document, CARD), ...elements(document, DIALOG)];
  const byId = new Map(nodes.filter((node) => node.id).map((node) => [node.id, node]));
  const form = byId.get('nodeRequestForm');
  if (form) form.reset = () => { for (const node of nodes) if (['input', 'textarea'].includes(node.tagName)) node.value = ''; };
  if (!dialogs && byId.get('nodeRequest')) byId.get('nodeRequest').showModal = undefined;
  const i18n = loadI18n(nodes, lang);
  const location = { pathname: '/', search: '?lang=es', hash };
  const replaced = [];
  const history = { state: { kept: true }, replaceState(state, title, url) { replaced.push({ state, url }); location.hash = ''; } };
  const requests = [];
  const context = {
    document,
    window: { nodalI18n: i18n, location, history },
    fetch: (url, options) => { requests.push({ url, options }); return fetchImpl(url, options); },
    console,
  };
  vm.runInNewContext(script(), context, { filename: 'node-request.js' });
  await settle();
  const $ = (id) => byId.get(id);
  return {
    $, document, nodes, i18n, requests, replaced, location,
    dialog: $('nodeRequest'), form, error: $('nodeRequestError'), send: $('nodeRequestSend'), thanks: $('nodeRequestThanks'),
    labelled: (key) => nodes.find((node) => node.dataset.i18n === key),
    type(values) { for (const [field, value] of Object.entries(values)) $(FIELDS[field]).value = value; },
    typed: () => Object.fromEntries(Object.entries(FIELDS).map(([field, id]) => [field, $(id).value])),
    open() { return $('nodeRequestOpen').dispatch('click'); },
    async submit() { const event = form.dispatch('submit'); await settle(); return event; },
  };
}
const FILLED = { name: ' Ana Pérez ', organization: 'Colectivo Calle Viva', email: 'ana@calleviva.example', phone: '+51 (1) 555-0100', message: 'Queremos un nodo en Arequipa.\nY dar visibilidad a la movilidad activa.' };
const links = (node) => node.children.filter((child) => typeof child !== 'string');

test('the landing page has a third card that links to #nodos and a dialog with every field', () => {
  assert.notEqual(CARD, '', 'the organisations card');
  const open = element(CARD, 'nodeRequestOpen');
  assert.equal(open.tag, 'a');
  assert.equal(open.href, '#nodos', 'a plain link to #nodos without JavaScript');
  assert.equal((HTML.match(/<dialog\b/g) || []).length, 1);
  const dialog = element(DIALOG, 'nodeRequest');
  assert.equal(dialog.tag, 'dialog');
  assert.equal(element(DIALOG, dialog['aria-labelledby']).tag, 'h2', 'the window is named by its heading');
  const form = element(DIALOG, 'nodeRequestForm');
  assert.equal(form.tag, 'form');
  assert.ok('novalidate' in form, 'the server checks the fields; the browser never blocks a submit it would accept');
  assert.equal(form.method, 'dialog', 'a submit the script does not take closes the window instead of putting the fields in a URL');
  const expected = {
    nodeRequestName: { tag: 'input', name: 'name', type: 'text', autocomplete: 'name', required: '' },
    nodeRequestOrganization: { tag: 'input', name: 'organization', type: 'text', autocomplete: 'organization', required: '' },
    nodeRequestEmail: { tag: 'input', name: 'email', type: 'email', autocomplete: 'email', required: '' },
    nodeRequestPhone: { tag: 'input', name: 'phone', type: 'tel', autocomplete: 'tel' },
    nodeRequestMessage: { tag: 'textarea', name: 'message', maxlength: '1000', required: '' },
  };
  for (const [id, want] of Object.entries(expected)) {
    const got = element(DIALOG, id);
    for (const [name, value] of Object.entries(want)) assert.equal(got[name], value, `#${id} ${name}`);
    assert.ok(DIALOG.includes(`<label for="${id}">`), `#${id} has a label`);
    // Only the message mirrors a server limit; the server answers the others by field.
    if (id !== 'nodeRequestMessage') assert.ok(!('maxlength' in got), `#${id} has no maxlength`);
  }
  assert.ok(!('required' in element(DIALOG, 'nodeRequestPhone')), 'the phone is optional');
  assert.deepEqual([...DIALOG.matchAll(/\bname="([a-z]+)"/g)].map((match) => match[1]), ['name', 'organization', 'email', 'phone', 'message', 'website'], 'the spec’s order, then the trap');
  const trap = element(DIALOG, 'nodeRequestWebsite');
  assert.deepEqual([trap.tag, trap.name, trap.type, trap.tabindex, trap.autocomplete], ['input', 'website', 'text', '-1', 'off']);
  assert.match(DIALOG, /<div class="nr-trap" aria-hidden="true">(?:(?!<\/div>)[\s\S])*id="nodeRequestWebsite"/, 'the trap sits in a wrapper screen readers skip');
  assert.match(read('web', 'styles', 'node-request.css'), /\.nr-trap \{[^}]*position: absolute;[^}]*left: -10000px;/, 'and people never see');
  const error = element(DIALOG, 'nodeRequestError');
  assert.deepEqual([error.tag, error.role, 'hidden' in error], ['p', 'alert', true]);
  assert.equal(element(DIALOG, 'nodeRequestSend').type, 'submit');
  const close = element(DIALOG, 'nodeRequestClose');
  assert.deepEqual([close.tag, close.type, close['data-i18n-aria-label']], ['button', 'button', 'mem.org.close']);
  const thanks = between(DIALOG, '<div class="nr-thanks" id="nodeRequestThanks" hidden>', '</div>');
  assert.match(thanks, /<button[^>]*id="nodeRequestDone"[^>]*type="button"/, 'the thank-you has its own close button');
  assert.match(DIALOG, /<a href="privacy\.html"[^>]*data-i18n="nav\.privacy">Privacy policy<\/a>/, 'the privacy line links the policy');
  // The page loads the window's style after the site's and its script after the dictionaries.
  assert.ok(HTML.indexOf('href="styles.css?v=') < HTML.indexOf('href="node-request.css?v=20261103a"'));
  assert.ok(HTML.indexOf('src="i18n.js?v=') < HTML.indexOf('<script defer src="node-request.js?v=20261103a"></script>'));
});

test('the card and the window say the team’s words in Spanish, and English and Portuguese in the same register', () => {
  const es = loadI18n([], 'es'), pt = loadI18n([], 'pt');
  const COPY = {
    'mem.org.name': ['NODAL for organizations', 'Para organizaciones NODAL', 'Para organizações NODAL'],
    'mem.org.tagline': ['Activate a territorial and/or thematic Node', 'Activa un Nodo territorial y/o temático', 'Ative um Nó territorial e/ou temático'],
    'mem.org.p': ['If your organization wants to promote a node in its area of influence and/or help give visibility to an urban issue, contact us to talk it over.', 'Si eres una organización interesada en promover un nodo en tu área de influencia y/o quieres contribuir a dar visibilidad a un tema urbano. Contáctanos para conversar.', 'Se você é uma organização interessada em promover um nó na sua área de influência e/ou quer contribuir para dar visibilidade a um tema urbano, fale com a gente para conversar.'],
    'mem.org.cta': ['Contact us', 'Contáctanos', 'Fale com a gente'],
    'mem.org.intro': ['Tell us who you are and what interests you; we will write back to talk it over.', 'Cuéntanos quién eres y qué te interesa; te escribiremos para conversar.', 'Conte quem você é e o que te interessa; vamos escrever para conversar.'],
    'mem.org.fName': ['Full name', 'Nombre y apellido', 'Nome e sobrenome'],
    'mem.org.fOrg': ['Organization', 'Organización', 'Organização'],
    'mem.org.fEmail': ['Email', 'Correo electrónico', 'E-mail'],
    'mem.org.fPhone': ['Phone', 'Teléfono', 'Telefone'],
    'mem.org.optional': ['(optional)', '(opcional)', '(opcional)'],
    'mem.org.fMessage': ['What are you interested in?', '¿Qué te interesa?', 'O que te interessa?'],
    'mem.org.fMessageHint': ['(Tell us briefly)', '(Cuéntanos brevemente)', '(Conte brevemente)'],
    'mem.org.privacy': ['We use these details only to reply to you.', 'Usamos estos datos solo para responderte.', 'Usamos estes dados apenas para responder a você.'],
    'mem.org.send': ['Send', 'Enviar', 'Enviar'],
    'mem.org.thanks': ['Thank you. We received your message and will write to you soon.', 'Gracias. Recibimos tu mensaje y te escribiremos pronto.', 'Obrigado. Recebemos sua mensagem e vamos escrever para você em breve.'],
    'mem.org.close': ['Close', 'Cerrar', 'Fechar'],
  };
  const markup = CARD + DIALOG;
  for (const [key, [en, esText, ptText]] of Object.entries(COPY)) {
    // English is the markup's own text (the close button's is also its accessible name).
    assert.ok(markup.includes(`data-i18n="${key}">${en}<`), `${key} in English`);
    assert.equal(es.t(key), esText, `${key} in Spanish`);
    assert.equal(pt.t(key), ptText, `${key} in Portuguese`);
  }
  assert.ok(DIALOG.includes('aria-label="Close" data-i18n-aria-label="mem.org.close"'));
  const keys = [...markup.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(keys)].filter((key) => key.startsWith('mem.org.')).sort(), Object.keys(COPY).sort(), 'every key of the card and the window is pinned here');
});

test('opens on Contáctanos and on #nodos, and gives focus back when closed', async () => {
  const page = await mount();
  const opener = page.$('nodeRequestOpen');
  assert.equal(page.dialog.open, false);
  assert.equal(opener.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(page.open().defaultPrevented, true, 'the link does not add #nodos to the address');
  assert.equal(page.dialog.open, true);
  assert.equal(page.document.activeElement, page.$('nodeRequestName'), 'focus goes to the first field');
  page.open();
  assert.equal(page.dialog.open, true, 'a second click while open is harmless');
  page.$('nodeRequestClose').dispatch('click');
  assert.equal(page.dialog.open, false);
  assert.equal(page.document.activeElement, opener, 'focus goes back to Contáctanos');
  assert.deepEqual(page.replaced, [], 'no #nodos, nothing to drop');
  page.open();
  page.dialog.escape();
  assert.equal(page.dialog.open, false, 'Escape closes it');
  assert.equal(page.document.activeElement, opener);

  // The link the team shares: the window is open on arrival, and closing it drops #nodos and keeps the rest.
  const shared = await mount({ hash: '#nodos' });
  assert.equal(shared.dialog.open, true);
  assert.equal(shared.document.activeElement, shared.$('nodeRequestName'));
  shared.dialog.escape();
  assert.equal(shared.document.activeElement, shared.$('nodeRequestOpen'));
  assert.deepEqual(shared.replaced, [{ state: { kept: true }, url: '/?lang=es' }]);
  assert.equal(shared.location.hash, '');
  const other = await mount({ hash: '#membership' });
  assert.equal(other.dialog.open, false, 'another address opens nothing');

  // Without <dialog> the link stays a plain #nodos link.
  const old = await mount({ dialogs: false, hash: '#nodos' });
  assert.equal(old.open().defaultPrevented, false);
  assert.equal(old.dialog.open, false);
  assert.equal(old.$('nodeRequestOpen').getAttribute('aria-haspopup'), null);
  // and the window stays out of sight: only browsers with <dialog> hide a closed one themselves, and a form shown
  // there with no script behind it would send its fields as a GET, into the address bar and the host's logs.
  assert.match(read('web', 'styles', 'node-request.css'), /\.node-request:not\(\[open\]\) \{ display: none; \}/, 'a closed window is hidden without <dialog> too');
});

test('sends one POST with the typed fields and the page language, and thanks', async () => {
  const reply = later();
  const page = await mount({ lang: 'es', fetchImpl: () => reply.promise });
  page.open();
  page.type(FILLED);
  page.$('nodeRequestWebsite').value = '';
  const event = await page.submit();
  assert.equal(event.defaultPrevented, true, 'the page stays');
  assert.equal(page.requests.length, 1);
  const [{ url, options }] = page.requests;
  assert.equal(url, '/api/node-requests');
  assert.equal(options.method, 'POST');
  assert.deepEqual({ ...options.headers }, { 'Content-Type': 'application/json', Accept: 'application/json' });
  // As typed: the server trims and checks.
  assert.deepEqual(JSON.parse(options.body), { ...FILLED, language: 'es', website: '' });
  assert.equal(page.send.disabled, true);
  assert.equal(page.send.textContent, 'Enviando…');
  reply.resolve(answer(202, { ok: true }));
  await settle();
  assert.equal(page.form.hidden, true, 'the form gives way to the thank-you');
  assert.equal(page.thanks.hidden, false);
  assert.equal(page.labelled('mem.org.thanks').textContent, 'Gracias. Recibimos tu mensaje y te escribiremos pronto.');
  assert.equal(page.document.activeElement, page.$('nodeRequestDone'));
  assert.equal(page.error.hidden, true);
  assert.equal(page.send.disabled, false);
  assert.equal(page.send.textContent, 'Enviar');
  assert.deepEqual(Object.values(page.typed()), ['', '', '', '', ''], 'nothing typed stays behind on a shared computer');
  page.$('nodeRequestDone').dispatch('click');
  assert.equal(page.dialog.open, false);
  assert.equal(page.document.activeElement, page.$('nodeRequestOpen'));
  // Opened again, it is a new form.
  page.open();
  assert.deepEqual([page.form.hidden, page.thanks.hidden], [false, true]);
  assert.equal(page.document.activeElement, page.$('nodeRequestName'));

  // The page's language is the one sent, whatever it is when Send is pressed.
  const english = await mount({ lang: 'en' });
  english.i18n.apply('pt');
  english.open();
  english.type(FILLED);
  await english.submit();
  assert.equal(JSON.parse(english.requests[0].options.body).language, 'pt');
  // A filled trap is sent as it is; the server answers it like any other request.
  const bot = await mount();
  bot.open();
  bot.type(FILLED);
  bot.$('nodeRequestWebsite').value = 'https://spam.example';
  await bot.submit();
  assert.equal(JSON.parse(bot.requests[0].options.body).website, 'https://spam.example');
  assert.equal(bot.thanks.hidden, false);
});

test('ignores a second submit while the first is pending', async () => {
  const replies = [];
  const page = await mount({ fetchImpl: () => { const reply = later(); replies.push(reply); return reply.promise; } });
  page.open();
  page.type(FILLED);
  const first = await page.submit();
  const second = await page.submit();
  await page.submit();
  assert.equal(page.requests.length, 1, 'a double click and a slow network send one request');
  assert.equal(second.defaultPrevented, true, 'and a second submit never falls through to the browser');
  assert.equal(first.defaultPrevented, true);
  assert.equal(page.send.disabled, true, 'the button stays disabled until the answer');
  assert.equal(page.send.textContent, 'Sending…');
  replies[0].resolve(answer(400, { error: 'email is invalid', field: 'email' }));
  await settle();
  assert.equal(page.send.disabled, false);
  assert.equal(page.send.textContent, 'Send');
  await page.submit();
  assert.equal(page.requests.length, 2, 'once answered, the visitor can send again');
  // A failed request frees the button too.
  replies[1].reject(new TypeError('Failed to fetch'));
  await settle();
  assert.equal(page.send.disabled, false);
});

test('shows the field error for a 400 and keeps what was typed', async () => {
  const MESSAGES = {
    name: 'Write your full name, up to 120 characters.',
    organization: 'Write the name of your organization, up to 160 characters.',
    email: 'Write a valid email address.',
    phone: 'The phone number can only have digits, spaces and + ( ) -, up to 40 characters.',
    message: 'Tell us what you are interested in, in up to 1000 characters.',
  };
  for (const [field, text] of Object.entries(MESSAGES)) {
    const page = await mount({ fetchImpl: async () => answer(400, { error: `${field} is invalid`, field }) });
    page.open();
    page.type(FILLED);
    await page.submit();
    assert.equal(page.error.hidden, false, field);
    assert.equal(page.error.textContent, text, field);
    assert.equal(page.document.activeElement, page.$(FIELDS[field]), `${field} gets the focus`);
    assert.equal(page.$(FIELDS[field]).getAttribute('aria-invalid'), 'true', field);
    assert.deepEqual(page.typed(), FILLED, `${field}: what was typed stays`);
    assert.deepEqual([page.form.hidden, page.thanks.hidden], [false, true]);
    // The next try starts clean.
    await page.submit();
    assert.equal(page.$(FIELDS[field]).getAttribute('aria-invalid'), 'true', 'still wrong on the second answer');
  }
  const fixed = await mount({ fetchImpl: async (url, options) => (JSON.parse(options.body).email.includes('@') ? answer(202) : answer(400, { field: 'email' })) });
  fixed.open();
  fixed.type({ ...FILLED, email: 'ana' });
  await fixed.submit();
  assert.equal(fixed.$('nodeRequestEmail').getAttribute('aria-invalid'), 'true');
  fixed.type({ email: 'ana@calleviva.example' });
  await fixed.submit();
  assert.equal(fixed.$('nodeRequestEmail').getAttribute('aria-invalid'), null);
  assert.equal(fixed.thanks.hidden, false);

  // No field to point at, or not the API's answer: the service is unavailable, and nothing typed is lost.
  const UNAVAILABLE = 'The service is not available right now. Try again in a few minutes.';
  for (const [name, reply] of [
    ['language', answer(400, { error: 'language is invalid', field: 'language' })],
    ['invalid JSON', answer(400, { error: 'invalid JSON' })],
    ['not JSON', { ok: false, status: 400, headers: { get: () => null }, async json() { throw new SyntaxError('Unexpected token'); } }],
    ['too large', answer(413, { error: 'request body too large' })],
    ['not JSON media', answer(415, { error: 'JSON required' })],
    ['cross-origin', answer(403, { error: 'cross-origin request rejected' })],
    ['storage', answer(503, { error: 'service unavailable' })],
    ['server error', answer(500, {})],
    ['a 200 that is not the API', answer(200, { ok: true })],
  ]) {
    const page = await mount({ fetchImpl: async () => reply });
    page.open();
    page.type(FILLED);
    await page.submit();
    assert.equal(page.error.textContent, UNAVAILABLE, name);
    assert.deepEqual(links(page.error), [], `${name}: no addresses`);
    assert.deepEqual(page.typed(), FILLED, name);
    assert.equal(page.thanks.hidden, true, name);
  }
});

test('shows the team addresses on 429 and when the API is unreachable', async () => {
  for (const [name, fetchImpl, text] of [
    ['too many', async () => answer(429, { error: 'too many requests' }), 'Too many attempts. Try again later, or write to us at fmuro@sistemaurbano.org or malegre@sistemaurbano.org.'],
    ['offline', async () => { throw new TypeError('Failed to fetch'); }, 'We could not send your message from here. Write to us at fmuro@sistemaurbano.org or malegre@sistemaurbano.org.'],
    // A host with no API behind it (a static preview) has no route for the request.
    ['no route', async () => answer(404, {}), 'We could not send your message from here. Write to us at fmuro@sistemaurbano.org or malegre@sistemaurbano.org.'],
    ['no POST', async () => answer(405, {}), 'We could not send your message from here. Write to us at fmuro@sistemaurbano.org or malegre@sistemaurbano.org.'],
  ]) {
    const page = await mount({ fetchImpl });
    page.open();
    page.type(FILLED);
    await page.submit();
    assert.equal(page.error.hidden, false, name);
    assert.equal(page.error.textContent, text, name);
    assert.deepEqual(links(page.error).map((link) => [link.tagName, link.href, link.textContent]), TEAM.map((address) => ['a', `mailto:${address}`, address]), name);
    assert.deepEqual(page.typed(), FILLED, name);
    assert.equal(page.send.disabled, false, name);
  }
  const spanish = await mount({ lang: 'es', fetchImpl: async () => answer(429) });
  spanish.open();
  await spanish.submit();
  assert.equal(spanish.error.textContent, 'Demasiados intentos. Intenta de nuevo más tarde o escríbenos a fmuro@sistemaurbano.org o malegre@sistemaurbano.org.');
});

test('re-renders labels and the shown error when the language changes', async () => {
  const page = await mount({ fetchImpl: async () => answer(400, { error: 'email is invalid', field: 'email' }) });
  page.open();
  page.type(FILLED);
  await page.submit();
  assert.equal(page.error.textContent, 'Write a valid email address.');
  page.i18n.apply('es');
  for (const [key, text] of [['mem.org.fName', 'Nombre y apellido'], ['mem.org.fEmail', 'Correo electrónico'], ['mem.org.fMessage', '¿Qué te interesa?'], ['mem.org.send', 'Enviar'], ['mem.org.tagline', 'Activa un Nodo territorial y/o temático']]) {
    assert.equal(page.labelled(key).textContent, text, key);
  }
  assert.equal(page.$('nodeRequestClose').getAttribute('aria-label'), 'Cerrar');
  assert.equal(page.error.textContent, 'Escribe un correo electrónico válido.');
  assert.equal(page.error.hidden, false);
  page.i18n.apply('pt');
  assert.equal(page.error.textContent, 'Escreva um e-mail válido.');
  assert.equal(page.labelled('mem.org.fName').textContent, 'Nome e sobrenome');
  assert.deepEqual(page.typed(), FILLED, 'nothing typed is lost');
  assert.equal(page.$('nodeRequestEmail').getAttribute('aria-invalid'), 'true');

  // The addresses line keeps its links in the new language.
  const busy = await mount({ fetchImpl: async () => answer(429) });
  busy.open();
  await busy.submit();
  busy.i18n.apply('pt');
  assert.equal(busy.error.textContent, 'Muitas tentativas. Tente novamente mais tarde ou escreva para fmuro@sistemaurbano.org ou malegre@sistemaurbano.org.');
  assert.deepEqual(links(busy.error).map((link) => link.href), TEAM.map((address) => `mailto:${address}`));

  // While the request is on its way, the button says so in the new language, and goes back to Send in it.
  const reply = later();
  const sending = await mount({ fetchImpl: () => reply.promise });
  sending.open();
  sending.type(FILLED);
  await sending.submit();
  assert.equal(sending.send.textContent, 'Sending…');
  sending.i18n.apply('es');
  assert.equal(sending.send.textContent, 'Enviando…');
  assert.equal(sending.send.disabled, true);
  reply.resolve(answer(429));
  await settle();
  assert.equal(sending.send.textContent, 'Enviar');
  assert.match(sending.error.textContent, /^Demasiados intentos\./);
});

test('puts untrusted text on the page as text only', async () => {
  const source = script();
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
  // What the server sends back is never shown: the line is chosen by status and a known field.
  for (const field of ['<img src=x onerror=alert(1)>', 'constructor', '__proto__', 'toString', 'website']) {
    const page = await mount({ fetchImpl: async () => answer(400, { error: '<script>alert(1)</script>', field }) });
    page.open();
    page.type({ ...FILLED, message: '<script>alert(1)</script>' });
    await page.submit();
    assert.equal(page.error.textContent, 'The service is not available right now. Try again in a few minutes.', field);
    assert.ok(page.error.children.every((child) => typeof child === 'string'), field);
    assert.equal(page.document.activeElement, page.$('nodeRequestName'), `${field}: focus stays where it was`);
  }
  // What the visitor typed goes to the server as JSON text and is never written back to the page.
  const typed = await mount({ fetchImpl: async () => answer(400, { field: 'message' }) });
  typed.open();
  typed.type({ ...FILLED, name: '<b onclick=x>Ana</b>', message: '<script>alert(1)</script>\r\nBcc: x@example.test' });
  await typed.submit();
  assert.equal(JSON.parse(typed.requests[0].options.body).message, '<script>alert(1)</script>\r\nBcc: x@example.test');
  for (const node of typed.nodes) assert.doesNotMatch(node.textContent, /<script>|onclick/, node.id || node.tagName);
  // The team's links are built from constants, as elements with text.
  const busy = await mount({ fetchImpl: async () => answer(429) });
  busy.open();
  await busy.submit();
  for (const link of links(busy.error)) {
    assert.ok(link instanceof Element);
    assert.ok(TEAM.includes(link.textContent));
    assert.equal(link.children.length, 0);
  }
});
