import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, addFollow, recordInteraction, getEngagement } from '../server/store.js';
import {
  recommend, traversalScores, buildAdjacency, DECAY,
  WEIGHTS, cityScore, complementScore, LINKEDIN_BOOST,
  pairFeatures, skipPenalty, trainMatchModel, SKIP_DAMP,
} from '../server/engine.js';

test('recommendations exclude self and already-followed users', () => {
  const store = createStore();
  const recs = recommend(store, 'you');
  const ids = recs.map((r) => r.id);
  assert.ok(!ids.includes('you'));
  assert.ok(!ids.includes('diego'));   // already followed
  assert.ok(!ids.includes('lucas'));   // already followed
});

test('flavia tops recommendations for the demo user', () => {
  const store = createStore();
  const recs = recommend(store, 'you');
  assert.ok(recs.length > 0);
  assert.equal(recs[0].id, 'flavia');
  assert.ok(recs[0].matchPct > recs.at(-1).matchPct);
});

test('reasons carry shared interests and mutual connections', () => {
  const store = createStore();
  const flavia = recommend(store, 'you').find((r) => r.id === 'flavia');
  assert.ok(flavia.reasons.sharedInterests.includes('transport'));
  assert.ok(flavia.reasons.mutualConnections >= 1);
  assert.equal(flavia.reasons.sameCity, true);
});

test('BFS decay: nearer nodes outscore distant ones on a uniform chain', () => {
  const mk = (id) => ({ id, name: id, role: '', city: '', interests: ['x'], active: ['am'] });
  const store = createStore({
    users: [mk('a'), mk('b'), mk('c'), mk('d')],
    follows: { a: ['b'], b: ['c'], c: ['d'], d: [] },
    interactions: [],
  });
  const scores = traversalScores(store, buildAdjacency(store), 'a');
  assert.ok(scores.get('c') > scores.get('d'), 'depth-2 node should outscore depth-3 node');
});

test('decay constant shapes contributions', () => {
  assert.ok(DECAY > 0 && DECAY < 1);
});

test('following a user removes them and reshuffles the ranking', () => {
  const store = createStore();
  const before = recommend(store, 'you').map((r) => r.id);
  assert.ok(before.includes('flavia'));
  addFollow(store, 'you', 'flavia');
  const after = recommend(store, 'you').map((r) => r.id);
  assert.ok(!after.includes('flavia'));
});

test('recommend returns null for unknown users', () => {
  const store = createStore();
  assert.equal(recommend(store, 'ghost'), null);
});

const DAY = 24 * 60 * 60 * 1000;

test('WEIGHTS sum to 1', () => {
  const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum ${sum}`);
});

test('cityScore: 1 for same city, 0 otherwise', () => {
  assert.equal(cityScore({ city: 'Lima' }, { city: 'Lima' }), 1);
  assert.equal(cityScore({ city: 'Mococa, São Paulo, Brazil' }, { city: 'mococa, sao paulo, brazil' }), 1);
  assert.equal(cityScore({ city: 'Lima' }, { city: 'CDMX' }), 0);
});

test('complementScore is symmetric and keyword-based', () => {
  const res = { role: 'Urban Mobility Researcher' };
  const eng = { role: 'Civil Engineer' };
  const lead = { role: 'Community Leader' };
  assert.equal(complementScore(res, eng), 1);
  assert.equal(complementScore(eng, res), 1);
  assert.equal(complementScore(res, res), 0);
  assert.equal(complementScore({ role: 'City Planner' }, lead), 1);
});

test('engagement decays with a 30-day half-life', () => {
  const mk = (id) => ({ id, name: id, role: 'x', city: 'L', interests: [], active: [] });
  const store = createStore({ users: [mk('a'), mk('b')], follows: {}, interactions: [] });
  const t0 = 1_700_000_000_000;
  recordInteraction(store, 'a', 'b', 'like', t0);              // weight 3
  assert.ok(Math.abs(getEngagement(store, 'a', 'b', t0) - 3) < 1e-9);
  assert.ok(Math.abs(getEngagement(store, 'a', 'b', t0 + 30 * DAY) - 1.5) < 1e-9);
  assert.ok(Math.abs(getEngagement(store, 'a', 'b', t0 + 60 * DAY) - 0.75) < 1e-9);
});

test('candidates with linkedin get the verifiability boost', () => {
  const seed = {
    users: [
      { id: 'you', name: 'You', role: 'Civic Designer', city: 'Lima', interests: ['transport'], active: ['am'] },
      { id: 'p1', name: 'P1', role: 'Architect', city: 'Quito', interests: ['transport'], active: ['am'] },
      { id: 'p2', name: 'P2', role: 'Architect', city: 'Quito', interests: ['transport'], active: ['am'], linkedin: 'https://www.linkedin.com/in/p2' },
    ],
    follows: { you: [], p1: [], p2: [] },
    interactions: [],
  };
  const recs = recommend(createStore(seed), 'you');
  const p1 = recs.find((r) => r.id === 'p1');
  const p2 = recs.find((r) => r.id === 'p2');
  assert.ok(p1 && p2, 'both candidates surface');
  assert.ok(Math.abs(p2.score / p1.score - LINKEDIN_BOOST) < 1e-6);
  assert.equal(p2.reasons.hasLinkedin, true);
  assert.equal(p1.reasons.hasLinkedin, false);
});

test('reasons carry complementaryRole and sameCity', () => {
  const recs = recommend(createStore(), 'you');     // default seed
  assert.ok(recs.length > 0);
  for (const r of recs) {
    assert.ok('sameCity' in r.reasons);
    assert.ok('complementaryRole' in r.reasons);
    assert.ok(r.reasons.complementaryRole === null || typeof r.reasons.complementaryRole === 'string');
  }
});

test('matching crosses languages: Portuguese profile meets English profile', () => {
  const seed = {
    users: [
      { id: 'you', name: 'Você', role: 'Investigadora Urbana', city: 'São Paulo', interests: ['transporte', 'pesquisa'], active: ['am'] },
      { id: 'peer', name: 'Peer', role: 'Transport Engineer', city: 'Sao Paulo', interests: ['transport', 'research'], active: ['am'] },
      { id: 'far', name: 'Far', role: 'Chef', city: 'Quito', interests: ['gastronomia'], active: ['pm'] },
    ],
    follows: { you: [], peer: [], far: [] },
    interactions: [],
  };
  const recs = recommend(createStore(seed), 'you');
  const peer = recs.find((r) => r.id === 'peer');
  assert.ok(peer, 'cross-language peer surfaces');
  assert.equal(recs[0].id, 'peer');
  // shared interests are reported in the viewer's own words
  assert.deepEqual(peer.reasons.sharedInterests, ['transporte', 'pesquisa']);
  assert.equal(peer.reasons.sameCity, true, 'accented and plain city names match');
  assert.equal(peer.reasons.complementaryRole, 'Transport Engineer');
});

test('skipping a candidate demotes them without banishing them', () => {
  const baseline = recommend(createStore(), 'you');
  assert.equal(baseline[0].id, 'flavia');

  const store = createStore();
  recordInteraction(store, 'you', 'flavia', 'skip');
  recordInteraction(store, 'you', 'flavia', 'skip');
  const recs = recommend(store, 'you');
  const flavia = recs.find((r) => r.id === 'flavia');
  assert.ok(flavia, 'a skipped member can still resurface');
  assert.notEqual(recs[0].id, 'flavia', 'two fresh skips push the old top pick down');
  assert.ok(flavia.score < baseline[0].score);
});

test('skipPenalty decays back toward 1 with the engagement half-life', () => {
  const store = createStore();
  const t0 = 1_700_000_000_000;
  recordInteraction(store, 'you', 'flavia', 'skip', t0);
  const fresh = skipPenalty(store, 'you', 'flavia', t0);
  assert.ok(Math.abs(fresh - SKIP_DAMP) < 1e-9, 'one fresh skip applies the full damp');
  const later = skipPenalty(store, 'you', 'flavia', t0 + 90 * DAY);
  assert.ok(later > fresh && later < 1, 'the damp fades but has not vanished');
  assert.equal(skipPenalty(store, 'you', 'diego', t0), 1, 'no skips, no damp');
});

test('pairFeatures are profile signals in 0..1 and exclude engagement', () => {
  const store = createStore();
  const adj = buildAdjacency(store);
  const features = pairFeatures(store, adj, 'you', 'flavia');
  assert.equal(features.length, 5);
  for (const f of features) assert.ok(f >= 0 && f <= 1, `feature out of range: ${f}`);
  // engagement is excluded by design: piling on likes must not move the features
  recordInteraction(store, 'you', 'flavia', 'like');
  assert.deepEqual(pairFeatures(store, adj, 'you', 'flavia'), features);
});

test('the demo seed alone does not activate learning (positives only)', () => {
  const store = createStore();
  assert.equal(trainMatchModel(store, buildAdjacency(store)), null);
});

test('learned layer amplifies what the network actually likes', () => {
  const mk = (id, city) => ({ id, name: id, role: 'Member', city, interests: ['data'], active: ['am'] });
  const seed = (interactions) => ({
    users: [
      mk('you', 'Lima'),
      mk('l1', 'Lima'), mk('l2', 'Lima'),          // liked: same city as the viewer
      mk('s1', 'Quito'), mk('s2', 'Bogota'),       // skipped: elsewhere
      mk('same', 'Lima'), mk('other', 'Cusco'),    // fresh candidates
    ],
    follows: { you: [], l1: [], l2: [], s1: [], s2: [], same: [], other: [] },
    interactions,
  });
  const daysAgo = (d) => Date.now() - d * 24 * 60 * 60 * 1000;
  const trained = createStore(seed([
    { from: 'you', to: 'l1', type: 'like', at: daysAgo(1) },
    { from: 'you', to: 'l2', type: 'like', at: daysAgo(2) },
    { from: 'you', to: 's1', type: 'skip', at: daysAgo(1) },
    { from: 'you', to: 's2', type: 'skip', at: daysAgo(2) },
  ]));
  const cold = createStore(seed([]));

  const ratioOf = (recs) => {
    const same = recs.find((r) => r.id === 'same');
    const other = recs.find((r) => r.id === 'other');
    assert.ok(same && other, 'both fresh candidates surface');
    return same.score / other.score;
  };
  const coldRatio = ratioOf(recommend(cold, 'you'));
  const trainedRatio = ratioOf(recommend(trained, 'you'));
  assert.ok(coldRatio > 1, 'heuristics already prefer the same-city candidate');
  assert.ok(
    trainedRatio > coldRatio,
    `feedback should widen the gap: cold ${coldRatio}, trained ${trainedRatio}`,
  );
});
