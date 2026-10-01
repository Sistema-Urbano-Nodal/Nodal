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

// app.js returns before the graph when the page has no #graph, so the price
// slot and the Supporter button are the only nodes it touches here.
async function landing({ lang = 'en', fetchImpl }) {
  const price = { textContent: 'Soon!' };
  const cta = { removed: false, hidden: true, remove() { this.removed = true; } };
  const nodes = new Map([['[data-billing-price]', price], ['[data-billing-cta]', cta]]);
  const document = {
    querySelector: (selector) => (selector === '[data-billing-cta]' && cta.removed ? null : nodes.get(selector) ?? null),
    querySelectorAll: () => [],
    getElementById: () => null,
  };
  const i18n = loadI18n(lang);
  const seen = [];
  const context = { document, window: { nodalI18n: i18n }, fetch: async (...args) => { seen.push(price.textContent); return fetchImpl(...args); }, console };
  vm.runInNewContext(APP, context, { filename: 'app.js' });
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  return { price, cta, i18n, seenBeforeFetch: seen[0] };
}

const json = (payload) => async () => ({ ok: true, status: 200, async json() { return payload; } });
const SOON = { en: 'Soon!', es: '¡Pronto!', pt: 'Em breve!' };

test('a closed checkout shows the localised "Soon!" and drops the Supporter button', async () => {
  for (const lang of ['en', 'es', 'pt']) {
    // Production on 2026-09-30: a label is configured, but the pilot keeps checkout closed.
    const page = await landing({ lang, fetchImpl: json({ checkout: false, cycles: { monthly: { amount: 'US$10', per: '/ month' } } }) });
    assert.equal(page.price.textContent, SOON[lang], lang);
    assert.equal(page.seenBeforeFetch, SOON[lang], `${lang} readers see the translated fallback before the request returns`);
    assert.equal(page.cta.removed, true, lang);
  }
  const sentinel = await landing({ fetchImpl: json({ checkout: false, cycles: { monthly: { amount: 'Soon', per: '' } } }) });
  assert.equal(sentinel.price.textContent, 'Soon!');
  assert.equal(sentinel.cta.removed, true);
});

test('an open checkout prints the configured amount and keeps the Supporter button', async () => {
  const config = { checkout: true, cycles: { monthly: { amount: 'US$10', per: '/ month' } } };
  const en = await landing({ fetchImpl: json(config) });
  assert.equal(en.price.textContent, 'US$10 / month');
  assert.equal(en.cta.removed, false);
  assert.equal(en.cta.hidden, false, 'the button shipped hidden appears only once checkout is confirmed open');
  const es = await landing({ lang: 'es', fetchImpl: json(config) });
  assert.equal(es.price.textContent, 'US$10 / mes');
  assert.equal(es.cta.removed, false);
  // A server without the flag (older deploy) is treated as closed.
  const legacy = await landing({ fetchImpl: json({ cycles: { monthly: { amount: 'US$10', per: '/ month' } } }) });
  assert.equal(legacy.price.textContent, 'Soon!');
  assert.equal(legacy.cta.removed, true);
});

test('a failed or refused billing request keeps the localised "Soon!" and drops the button', async () => {
  for (const lang of ['en', 'pt']) {
    const offline = await landing({ lang, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
    assert.equal(offline.price.textContent, SOON[lang]);
    assert.equal(offline.cta.removed, true);
  }
  const refused = await landing({ fetchImpl: async () => ({ ok: false, status: 500, async json() { return { checkout: true, cycles: { monthly: { amount: 'US$10' } } }; } }) });
  assert.equal(refused.price.textContent, 'Soon!');
  assert.equal(refused.cta.removed, true);
});

test('the landing markup carries no price and ships the Supporter button hidden until checkout is confirmed', () => {
  const html = read('web', 'pages', 'index.html');
  // Hidden in the markup: without JavaScript, and while /api/billing/config is in flight, no button leads to a closed checkout.
  assert.match(html, /<a class="btn btn-primary" href="payments\.html" data-billing-cta hidden data-i18n="mem\.proCta">/);
  // .btn sets display, so the stylesheet must let the hidden attribute win.
  assert.match(read('web', 'styles', 'styles.css'), /\.btn\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
  assert.match(html, /<p class="price" data-billing-price>Soon!<\/p>/);
  assert.doesNotMatch(html, /US\$\s?\d+|\$\s?\d+\s?(?:USD|\/)/);
  for (const page of ['index.html', 'payments.html', 'dashboard.html', 'profile.html']) {
    assert.doesNotMatch(read('web', 'pages', page), /US\$\s?\d/, `${page} must not hardcode a price`);
  }
  assert.doesNotMatch(read('web', 'scripts', 'i18n.js'), /US\$\s?\d/);
});
