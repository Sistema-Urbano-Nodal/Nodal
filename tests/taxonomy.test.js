import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInterestIdf,
  canonicalInterest,
  canonicalSimilarity,
  canonicalInterestSet,
  CLUSTER_CREDIT,
  interestSimilarity,
  PEER_AFFINITY,
  professionScore,
  professionsOf,
  rolesComplement,
  sharedInterestLabels,
} from '../server/taxonomy.js';

test('professionsOf reads titles in Portuguese, Spanish and English', () => {
  assert.ok(professionsOf('Engenheira Civil').has('engineering'));
  assert.ok(professionsOf('Ingeniero de Transporte').has('engineering'));
  assert.ok(professionsOf('Ingeniero de Transporte').has('mobility'));
  assert.ok(professionsOf('Urbanista').has('planning'));
  assert.ok(professionsOf('Antropóloga').has('socialscience'));
  assert.ok(professionsOf('Investigadora Urbana').has('research'));
  assert.ok(professionsOf('Pesquisadora').has('research'));
  assert.ok(professionsOf('Diseñador Urbano').has('design'));
});

test('discipline stems only match at word boundaries', () => {
  // "candidata" contains "data" mid-word and must not read as data work
  assert.equal(professionsOf('Candidata').size, 0);
  assert.ok(professionsOf('Data Scientist').has('technology'));
  assert.ok(professionsOf('Analista de Datos').has('technology'));
});

test('professionScore grades: complement 1, peer 0.5, unrelated 0', () => {
  assert.equal(professionScore('Investigadora Urbana', 'Ingeniero Civil'), 1);
  assert.equal(professionScore('Urbanista', 'Líder Comunitária'), 1);
  assert.equal(professionScore('City Planner', 'Urbanista'), PEER_AFFINITY);
  assert.equal(professionScore('Chef de Cuisine', 'Urban Economist'), 0);
  // symmetric
  assert.equal(
    professionScore('Engenheira Civil', 'Pesquisadora'),
    professionScore('Pesquisadora', 'Engenheira Civil'),
  );
});

test('rolesComplement is strict about complements: peers are not complements', () => {
  assert.equal(rolesComplement('City Planner', 'Urbanista'), false);
  assert.equal(rolesComplement('City Planner', 'Community Leader'), true);
});

test('a title that claims every discipline claims none', () => {
  /* profession affinity peaks on ANY complementary pair, so a keyword salad
     would otherwise score the maximum against the entire directory */
  const salad = 'Data Clima Transit Econom Design Lider Govern Ambient Engenh Arquitet Urbanist';
  assert.ok(salad.length <= 80, 'fits the title column, so it is reachable');
  assert.equal(professionsOf(salad).size, 0);
  const roles = ['Civil Engineer', 'City Planner', 'Community Leader', 'Urban Economist', 'Data Scientist'];
  for (const role of roles) assert.equal(professionScore(salad, role), 0);
  // an honest crossover keeps working
  assert.deepEqual([...professionsOf('Ingeniero de Transporte')], ['engineering', 'mobility']);
  assert.equal(professionScore('Ingeniero de Transporte', 'City Planner'), 1);
});

test('prototype keys typed as interests score nothing and pollute nothing', () => {
  for (const key of ['__proto__', 'constructor', 'toString']) {
    assert.equal(interestSimilarity([key], ['transport']), 0);
    assert.equal(interestSimilarity([key], ['data']), 0);
  }
  assert.equal(interestSimilarity(['__proto__'], ['constructor']), 0);
  assert.equal(Object.keys(Object.prototype).length, 0);
});

test('canonicalInterest collapses synonyms across languages', () => {
  assert.equal(canonicalInterest('Transporte'), 'transport');
  assert.equal(canonicalInterest('Mobilidade Urbana'), 'transport');
  assert.equal(canonicalInterest('Vivienda'), 'housing');
  assert.equal(canonicalInterest('habitação'), 'housing');
  assert.equal(canonicalInterest('Políticas Públicas'), 'public policy');
  // unknown interests pass through normalised instead of vanishing
  assert.equal(canonicalInterest('Astronomia Urbana'), 'astronomia urbana');
});

test('interestSimilarity treats cross-language synonyms as exact matches', () => {
  assert.equal(interestSimilarity(['transporte'], ['transport']), 1);
  assert.equal(interestSimilarity(['Habitação', 'Pesquisa'], ['vivienda', 'research']), 1);
});

test('related interests earn partial credit through clusters', () => {
  const related = interestSimilarity(['civic tech'], ['data']);       // both technology
  const exact = interestSimilarity(['data'], ['data']);
  const unrelated = interestSimilarity(['data'], ['culture']);
  assert.ok(related > 0, 'same-cluster interests should score above zero');
  assert.ok(related < exact, 'related credit stays below an exact match');
  assert.equal(related, CLUSTER_CREDIT / 2);
  assert.equal(unrelated, 0);
});

test('IDF makes a rare shared interest count more than a ubiquitous one', () => {
  const users = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `u${i}`, interests: ['data'] })),
    { id: 'a', interests: ['data', 'housing'] },
    { id: 'b', interests: ['data', 'housing'] },
  ];
  const idf = buildInterestIdf(users);
  assert.ok(idf('housing') > idf('data'), 'rarer tag carries the higher weight');
  const viaRare = canonicalSimilarity(new Set(['housing']), new Set(['housing', 'data']), idf);
  const viaCommon = canonicalSimilarity(new Set(['data']), new Set(['data', 'housing']), idf);
  assert.ok(viaRare > viaCommon, 'sharing the rare interest should score higher');
});

test('canonicalSimilarity is symmetric, bounded, and empty-safe', () => {
  /* The cluster pairing weighs a related pair by the LOWER of the two IDFs,
     which is only observably symmetric when the two tags carry different
     weights — build the corpus so they do, or the assertion below compares an
     expression with itself and any asymmetry walks straight through. */
  const idf = buildInterestIdf([
    ...Array.from({ length: 6 }, (_, i) => ({ id: `common${i}`, interests: ['data'] })),
    { id: 'x', interests: ['transport', 'data', 'housing'] },
    { id: 'y', interests: ['civic tech', 'housing'] },
  ]);
  assert.ok(idf('civic tech') > idf('data'), 'the cluster partners must differ in weight');
  const A = canonicalInterestSet(['transport', 'data', 'housing']);
  const B = canonicalInterestSet(['civic tech', 'housing']);
  const ab = canonicalSimilarity(A, B, idf);
  const ba = canonicalSimilarity(B, A, idf);
  assert.ok(Math.abs(ab - ba) < 1e-12, `asymmetric: ${ab} vs ${ba}`);
  assert.ok(ab > 0 && ab <= 1);
  assert.equal(canonicalSimilarity(new Set(), new Set(), idf), 0);
});

test('sharedInterestLabels answers in the viewer\'s own words', () => {
  const labels = sharedInterestLabels(['Transporte', 'habitação', 'cultura'], ['transport', 'housing']);
  assert.deepEqual(labels, ['Transporte', 'habitação']);
});
