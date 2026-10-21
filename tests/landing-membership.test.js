import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const APP = read('web', 'scripts', 'app.js');
const I18N = read('web', 'scripts', 'i18n.js');

// The real dictionaries, loaded as the landing page loads them (data-page="home").
function loadI18n(lang) {
  const context = {
    document: { body: { dataset: { page: 'home' } }, documentElement: {}, querySelectorAll: () => [] },
    window: { location: { search: '' } },
    localStorage: { getItem() { return null; }, setItem() {} },
    URLSearchParams,
    console,
  };
  vm.runInNewContext(I18N, context);
  context.window.nodalI18n.apply(lang);
  return context.window.nodalI18n;
}

// app.js returns before the graph when the page has no #graph, so the membership card is all it touches here. Every
// element it asks for is handed out and kept, so a test sees everything it writes, wherever it writes it.
async function landing({ lang = 'en', fetchImpl }) {
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { selector, textContent: '', hidden: true, removed: false, remove() { this.removed = true; } });
    return nodes.get(selector);
  };
  const document = {
    querySelector: (selector) => (nodes.get(selector)?.removed ? null : node(selector)),
    querySelectorAll: () => [],
    getElementById: () => null,
  };
  const i18n = loadI18n(lang);
  const context = { document, window: { nodalI18n: i18n }, fetch: fetchImpl, console };
  vm.runInNewContext(APP, context, { filename: 'app.js' });
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  return { note: node('[data-billing-state]'), nodes: [...nodes.values()], i18n };
}

// The /api/billing/config answers of docs/superpowers/specs/2026-10-21-nodal-fundadores-design.md.
const OFFER = { name: 'Membresía Fundador 2027', version: 'FUNDADORES-2027-v1', endsAt: '2027-01-01T05:00:00.000Z' };
const ONCE = { id: 'once', amount: 'S/ 499' };
const TWICE = { id: 'installments', amount: 'S/ 550', each: 'S/ 275', count: 2, monthsApart: 2 };
const FUNDADORES = { checkout: true, provider: 'mercadopago', state: 'open', offer: OFFER, annual: { amount: 'S/ 499', per: '' }, options: [ONCE, TWICE], contact: { email: 'membresia@sistemaurbano.org', complaintsUrl: 'https://reclamos.example.pe' } };
const CLOSED = (state) => ({ checkout: false, provider: null, state, offer: OFFER, annual: { amount: 'Soon', per: '' }, options: [], contact: null });

const json = (payload) => async () => ({ ok: true, status: 200, async json() { return payload; } });
const ENDED = { en: 'Offer closed', es: 'Oferta cerrada', pt: 'Oferta encerrada' };
// Eve audit #17: while sign-ups are not open yet, or the settings cannot be read, the card says so instead of leaving a card with no button.
const SOON = { en: 'Sign-ups open soon', es: 'Las inscripciones abren pronto', pt: 'As inscrições abrem em breve' };
// Every answer the card may get: open with both options, with one of them, the shape before the Founder Membership, closed, ended, refused, offline.
const ANSWERS = {
  open: json(FUNDADORES),
  installmentsOnly: json({ ...FUNDADORES, annual: { amount: 'S/ 550', per: '' }, options: [TWICE] }),
  onceOnly: json({ ...FUNDADORES, options: [ONCE] }),
  legacy: json({ checkout: true, annual: { amount: 'S/ 240', per: '/ year' } }),
  soon: json(CLOSED('soon')),
  ended: json(CLOSED('ended')),
  refused: async () => ({ ok: false, status: 500, async json() { return { checkout: true, annual: { amount: 'S/ 240' } }; } }),
  offline: async () => { throw new TypeError('Failed to fetch'); },
};

// 20 Oct 2026, the team: the amount on the landing card "es muy alto y asusta". The card names the Founder Membership and what
// it supports, and the prices stay on the payments page, next to their conditions.
test('the Founder Membership card shows no amount in any state, whatever the offer says', async () => {
  for (const [name, fetchImpl] of Object.entries(ANSWERS)) {
    for (const lang of ['en', 'es', 'pt']) {
      const page = await landing({ lang, fetchImpl });
      for (const written of page.nodes) assert.doesNotMatch(written.textContent, /S\/|US\$|\d/, `${name} ${lang}: ${written.selector}`);
      page.i18n.apply(lang === 'en' ? 'es' : 'en');
      for (const written of page.nodes) assert.doesNotMatch(written.textContent, /S\/|US\$|\d/, `${name} ${lang} after a language switch`);
    }
  }
});

/* 21 Oct 2026, the team's landing text: the card leads to the join page (/fundadores.html), which explains the benefits and the
   payment options and has the only button to the payments page. So the card has one way in, in every state, and app.js
   touches only its note. */
test('in every state the card’s one button leads to the join page, and app.js never touches it', async () => {
  for (const name of Object.keys(ANSWERS)) {
    const page = await landing({ fetchImpl: ANSWERS[name] });
    // The note is the only part of the card it looks up (.gc-pool is the graph's copy, which it reads for its labels).
    assert.deepEqual(page.nodes.map((written) => written.selector).filter((selector) => selector !== '.gc-pool'), ['[data-billing-state]'], `${name}: app.js looks up only the note`);
  }
  const code = APP.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(code, /data-billing-cta|fundadores\.html|mem\.fund\.join|payments\.html/, 'app.js has no button to show or remove');
});

test('once the offer has ended the card says so in the reader’s language, and while sign-ups are open it has no note', async () => {
  for (const lang of ['en', 'es', 'pt']) {
    const ended = await landing({ lang, fetchImpl: ANSWERS.ended });
    assert.equal(ended.note.textContent, ENDED[lang], lang);
    assert.equal(ended.note.hidden, false, lang);
  }
  const page = await landing({ fetchImpl: ANSWERS.ended });
  page.i18n.apply('pt');
  assert.equal(page.note.textContent, ENDED.pt, 'the note follows a language switch');
  for (const name of ['open', 'installmentsOnly', 'onceOnly', 'legacy']) {
    const other = await landing({ fetchImpl: ANSWERS[name] });
    assert.equal(other.note.hidden, true, name);
    assert.equal(other.note.textContent, '', name);
  }
});

test('before sign-ups open, or when the settings cannot be read, the card says sign-ups open soon, never a price', async () => {
  for (const name of ['soon', 'refused', 'offline']) {
    for (const lang of ['en', 'es', 'pt']) {
      const page = await landing({ lang, fetchImpl: ANSWERS[name] });
      assert.equal(page.note.textContent, SOON[lang], `${name} ${lang}`);
      assert.equal(page.note.hidden, false, `${name} ${lang}`);
    }
  }
  // A server without the flag (older deploy) is treated as closed, as its button is.
  const unflagged = await landing({ fetchImpl: json({ annual: { amount: 'S/ 240', per: '/ year' } }) });
  assert.equal(unflagged.note.textContent, SOON.en);
  const page = await landing({ lang: 'es', fetchImpl: ANSWERS.soon });
  page.i18n.apply('pt');
  assert.equal(page.note.textContent, SOON.pt, 'the note follows a language switch');
  // A language switch while the settings are still on their way says nothing yet.
  let answer;
  const waiting = await landing({ fetchImpl: () => new Promise((resolve) => { answer = resolve; }) });
  waiting.i18n.apply('es');
  assert.equal(waiting.note.hidden, true);
  assert.equal(waiting.note.textContent, '');
  answer({ ok: true, status: 200, async json() { return CLOSED('ended'); } });
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waiting.note.textContent, ENDED.es);
});

test('the landing card is the Founder Membership: its name, what it supports, its benefits and a button to the join page', () => {
  const html = read('web', 'pages', 'index.html');
  const card = html.slice(html.indexOf('<article class="plan plan-pro">'), html.indexOf('</article>', html.indexOf('<article class="plan plan-pro">')));
  // Where the price used to be, the line on what the membership supports.
  assert.match(card, /<header><h3 data-i18n="mem\.fund\.name">Founder Membership<\/h3><p class="price" data-i18n="mem\.fund\.tagline">Supporting the community's growth<\/p><p class="plan-note" data-billing-state hidden><\/p><\/header>/);
  const keys = [...card.matchAll(/data-i18n="(mem\.fund\.[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(keys, ['mem.fund.flag', 'mem.fund.name', 'mem.fund.tagline', 'mem.fund.connect', 'mem.fund.connectText', 'mem.fund.find', 'mem.fund.findText', 'mem.fund.learn', 'mem.fund.learnText', 'mem.fund.visible', 'mem.fund.visibleText', 'mem.fund.early', 'mem.fund.discount', 'mem.fund.join']);
  assert.doesNotMatch(card, /Supporter|Supporting membership|mem\.p\d|mem\.proName|mem\.proCta|data-billing-price|data-billing-split/);
  const es = loadI18n('es'), pt = loadI18n('pt');
  for (const [key, en, esText, ptText] of [
    ['mem.fund.name', 'Founder Membership', 'Membresía Fundador', 'Membresia Fundador'],
    ['mem.fund.tagline', 'Supporting the community\'s growth', 'Apoyo al crecimiento de la comunidad', 'Apoio ao crescimento da comunidade'],
    // The join page is "Nodal Fundadores", the name of the team's landing text; the membership it sells keeps its name.
    ['mem.fund.join', 'Join Nodal Fundadores', 'Únete a Nodal Fundadores', 'Junte-se ao Nodal Fundadores'],
    // Early access starts when the first payment is approved (terms, section 8), not when it is made.
    ['mem.fund.early', 'Early access from the approval of your first payment until 31 December 2026', 'Acceso anticipado desde la aprobación de tu primer pago hasta el 31 de diciembre de 2026', 'Acesso antecipado desde a aprovação do primeiro pagamento até 31 de dezembro de 2026'],
  ]) {
    assert.ok(card.includes(`data-i18n="${key}">${en}<`), `${key} in English`);
    assert.equal(es.t(key), esText, `${key} in Spanish`);
    assert.equal(pt.t(key), ptText, `${key} in Portuguese`);
  }
  for (const [key, text] of [['mem.fund.connect', 'Conecta:'], ['mem.fund.find', 'Encuentra oportunidades:'], ['mem.fund.learn', 'Aprende:'], ['mem.fund.visible', 'Haz visible tu trabajo:']]) assert.equal(es.t(key), text, key);
  for (const key of keys) for (const [lang, api] of [['es', es], ['pt', pt]]) assert.notEqual(api.t(key), key, `${key} in ${lang}`);
});

test('the card ends on its one button, always shown, to the public join page', () => {
  const html = read('web', 'pages', 'index.html');
  const card = html.slice(html.indexOf('<article class="plan plan-pro">'), html.indexOf('</article>', html.indexOf('<article class="plan plan-pro">')));
  // No hidden attribute: the join page explains the offer in every state, and the terms are one link away from it.
  assert.match(card, /<\/ul>\s*<a class="btn btn-primary" href="fundadores\.html" data-i18n="mem\.fund\.join">Join Nodal Fundadores<\/a>\s*$/);
  assert.equal((card.match(/<a\b/g) || []).length, 1, 'one way in');
  assert.doesNotMatch(card, /data-billing-cta|plan-terms|payments\.html|terminos-fundadores/);
  assert.match(read('web', 'pages', 'fundadores.html'), /href="terminos-fundadores\.html"/);
});

test('the landing markup carries no price', () => {
  const html = read('web', 'pages', 'index.html');
  assert.doesNotMatch(html, /US\$\s?\d+|\$\s?\d+\s?(?:USD|\/)/);
  // The prices of the Founder Membership come from the server's terms version, never from the markup or the dictionaries,
  // and the landing card prints none of them.
  for (const page of ['index.html', 'payments.html', 'dashboard.html', 'profile.html']) {
    assert.doesNotMatch(read('web', 'pages', page), /US\$\s?\d|S\/\s?\d/, `${page} must not hardcode a price`);
  }
  for (const file of ['i18n.js', 'i18n-dashboard.js', 'app.js', 'payments.js']) assert.doesNotMatch(read('web', 'scripts', file), /US\$\s?\d|S\/\s?\d/, `${file} must not hardcode a price`);
  assert.doesNotMatch(APP, /annual|amount|options|mem\.fund\.split|mem\.priceSoon/, 'app.js reads no price from the offer');
});
