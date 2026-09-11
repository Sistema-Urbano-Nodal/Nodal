import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function startup(mode) {
  const nodes = [];
  const node = (tag = 'div') => {
    const n = { tagName: tag, dataset: {}, children: [], hidden: false, classList: { contains: () => false },
      append(...children) { this.children.push(...children); }, prepend(child) { this.children.unshift(child); },
      after(child) { nodes.push(child); }, setAttribute(k, v) { this[k] = v; }, querySelector() { return null; } };
    nodes.push(n); return n;
  };
  const banner = node(); banner.dataset.pilotBanner = ''; banner.hidden = true;
  const heading = node('strong'); heading.dataset.pilotText = 'prototype'; heading.textContent = 'Course pilot · Prototype'; banner.append(heading);
  const status = node('p'); status.dataset.pilotText = 'loading'; status.textContent = 'Loading…';
  const nav = node('nav');
  const html = node('html'); if (mode !== undefined) html.dataset.pilot = mode;
  let resolveConfig; const pending = new Promise(resolve => { resolveConfig = resolve; });
  const requests = [];
  const ctx = { console, URL, URLSearchParams, Intl, document: { readyState: 'complete', documentElement: html, body: node('body'),
    querySelector(selector) { return selector === '[data-pilot-banner]' ? banner : selector === '.pilot-header nav,.side-nav,.nav-main' ? nav : null; },
    querySelectorAll(selector) { return selector === '[data-pilot-text]' ? nodes.filter(n => n.dataset.pilotText) : []; }, createElement: node },
    fetch: async url => { requests.push(url); return { ok: true, status: 200, json: () => pending }; },
    window: { nodalI18n: { lang: 'pt', onChange() {} } } };
  vm.createContext(ctx);
  for (const name of ['pilot-i18n', 'pilot']) vm.runInContext(readFileSync(new URL(`../web/scripts/${name}.js`, import.meta.url), 'utf8'), ctx);
  return { banner, heading, status, nav, html, requests, resolveConfig, nodes };
}

test('pilot translates labels and exposes navigation before a pending configuration request completes', () => {
  const h = startup();
  assert.equal(h.status.textContent, 'Carregando…');
  assert.equal(h.nav.children[0]?.textContent, 'Cursos');
  assert.equal(h.banner.hidden, false);
});

test('server-provided pilot state reuses the initial banner without a configuration round trip', () => {
  const h = startup('true');
  assert.deepEqual(h.requests, []);
  assert.equal(h.banner.hidden, false);
  assert.equal(h.heading.textContent, 'Piloto de cursos · Protótipo');
  assert.equal(h.nodes.filter(n => n.className === 'pilot-notice').length, 0);
});

test('non-pilot pages keep the banner hidden while still translating immediately', () => {
  const h = startup('false');
  assert.deepEqual(h.requests, []);
  assert.equal(h.banner.hidden, true);
  assert.equal(h.status.textContent, 'Carregando…');
});

test('legacy pages reconcile configuration after showing their initial translated shell', async () => {
  const h = startup();
  h.resolveConfig({ pilotMode: false });
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.html.dataset.pilot, 'false');
  assert.equal(h.banner.hidden, true);
  assert.equal(h.nav.children.length, 1);
});
