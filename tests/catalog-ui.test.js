import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const index = () => read('web', 'pages', 'index.html');
const catalogPage = () => read('web', 'pages', 'opportunities.html');
const catalogScript = () => read('web', 'scripts', 'catalog.js');
const i18n = () => read('web', 'scripts', 'i18n.js');

function dictionaryKeys(source, name) {
  const start = source.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `${name} dictionary is missing`);
  let depth = 0;
  let end = start;
  for (let cursor = source.indexOf('{', start); cursor < source.length; cursor += 1) {
    if (source[cursor] === '{') depth += 1;
    if (source[cursor] === '}') depth -= 1;
    if (depth === 0) { end = cursor; break; }
  }
  return new Set([...source.slice(start, end + 1).matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1]));
}

test('landing leads with the approved promise and evidence-first section order', () => {
  const html = index();
  assert.match(html, />Find the people and opportunities to turn urban knowledge into action\.</);

  const order = [...html.matchAll(/data-landing-section="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(order, ['hero', 'actions', 'open-work', 'cases', 'problem', 'how', 'membership', 'final-cta']);

  const source = i18n();
  assert.match(source, /'hero\.promise': 'Encuentra a las personas y las oportunidades para convertir el conocimiento urbano en acción\.'/);
  assert.match(source, /'hero\.promise': 'Encontre as pessoas e as oportunidades para transformar o conhecimento urbano em ação\.'/);
});

test('landing proof regions are API targets and fabricated social proof is absent', () => {
  const html = index();
  for (const id of ['landingOpenWork', 'landingOpenWorkStatus', 'landingCases', 'landingCasesStatus']) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} must be present`);
  }
  assert.doesNotMatch(html, /class="leader-card|class="quote|active nodes|nodos activos|nós ativos/i);
  assert.doesNotMatch(html.replace(/<[^>]*>/g, ''), /[“”«»][^\n]{12,}[“”«»]/);

  const graph = html.match(/<div class="gc-pool"[\s\S]*?<\/div>\s*<\/div>\s*<\/section>/)?.[0] ?? '';
  assert.ok(graph, 'illustrative graph role descriptions must remain');
  assert.match(html, /data-i18n="graph\.illustrative"/);
  assert.doesNotMatch(graph, /\b\d+\b|gc-ask/);

  const translations = i18n();
  assert.doesNotMatch(translations, /active nodes|nodos activos|nós ativos|quote\.|graph\.n\.[\w]+\.ask/);
});

test('catalog page exposes the complete public and member workflow', () => {
  const html = catalogPage();
  for (const kind of ['opportunity', 'project', 'learning_circle', 'resource', 'case_study']) {
    assert.match(html, new RegExp(`value="${kind}"`), `${kind} filter is missing`);
  }
  for (const id of [
    'catalogForm', 'catalogQuery', 'catalogTopic', 'catalogLocation', 'catalogState',
    'catalogResults', 'catalogStatus', 'catalogDetail', 'catalogDetailStatus',
    'catalogInterestForm', 'catalogInterestMessage', 'catalogInterestDisclosure',
    'catalogMyInterests', 'catalogMyInterestsStatus',
  ]) assert.match(html, new RegExp(`id="${id}"`), `${id} must be present`);
  assert.match(html, /<option value="open"/);
  assert.match(html, /<option value="all"/);
});

test('catalog client keeps network states honest, safe, and race-free', () => {
  const source = catalogScript();
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /URLSearchParams/);
  assert.match(source, /setTimeout\([^,]+,\s*300\)/);
  assert.match(source, /\/api\/auth\/state/);
  assert.match(source, /\/api\/me\/catalog-interests/);
  assert.match(source, /method:\s*'PUT'/);
  assert.match(source, /method:\s*'DELETE'/);
  assert.match(source, /credentials:\s*'same-origin'/);
  assert.match(source, /textContent/);
  assert.match(source, /window\.nodalI18n\.onChange/);
  assert.doesNotMatch(source, /demo|fallbackItem|sampleItem|mockItem/i);
});

test('every catalog client target exists on a page that loads it', () => {
  const pages = [index(), catalogPage()];
  assert.ok(pages.every((html) => /<script[^>]+src="catalog\.js/.test(html)));
  const ids = new Set(pages.flatMap((html) => [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])));
  const references = new Set([
    ...catalogScript().matchAll(/getElementById\(\s*'([^']+)'/g),
  ].map((match) => match[1]));
  for (const id of references) assert.ok(ids.has(id), `catalog.js target #${id} is absent`);
});

test('catalog dynamic and visible states resolve in EN, ES, and PT', () => {
  const source = i18n();
  const english = dictionaryKeys(source, 'DASH_EN');
  const spanish = new Set([...dictionaryKeys(source, 'ES'), ...dictionaryKeys(source, 'DASH_ES')]);
  const portuguese = new Set([...dictionaryKeys(source, 'PT'), ...dictionaryKeys(source, 'DASH_PT')]);
  for (const html of [index(), catalogPage()]) {
    for (const match of html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) english.add(match[1]);
  }
  const used = new Set([...catalogScript().matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1]));
  const requiredStates = [
    'catalog.loading', 'catalog.empty', 'catalog.error', 'catalog.detailLoading',
    'catalog.detailUnavailable', 'catalog.closed', 'catalog.sourceVerified',
    'catalog.externalAction', 'catalog.interestDisclosure', 'catalog.interestSuccess',
    'catalog.interestWithdrawn', 'catalog.interestsEmpty', 'catalog.interestsError',
    'catalog.status.new', 'catalog.status.contacted', 'catalog.status.closed', 'catalog.status.withdrawn',
  ];
  requiredStates.forEach((key) => used.add(key));
  for (const key of used) {
    assert.ok(english.has(key), `${key} missing in English`);
    assert.ok(spanish.has(key), `${key} missing in Spanish`);
    assert.ok(portuguese.has(key), `${key} missing in Portuguese`);
  }
});
