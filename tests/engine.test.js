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

test('a rare shared interest outranks one everybody lists', () => {
  /* the IDF has a unit test, but nothing checked it survives the trip into
     recommend() — drop it from the engine and every interest weighs the same */
  const mk = (id, interests) => ({ id, name: id, role: 'Member', city: 'Lima', interests, active: ['am'] });
  const crowd = Array.from({ length: 8 }, (_, i) => mk(`c${i}`, ['data']));
  const users = [
    mk('you', ['data', 'housing']),
    mk('common', ['data']),      // shares the interest the whole directory lists
    mk('rare', ['housing']),     // shares the one almost nobody does
    ...crowd,
  ];
  const store = createStore({
    users,
    follows: Object.fromEntries(users.map((u) => [u.id, []])),
    interactions: [],
  });
  const recs = recommend(store, 'you', { limit: 50 });
  const rare = recs.find((r) => r.id === 'rare');
  const common = recs.find((r) => r.id === 'common');
  assert.ok(rare && common, 'both candidates surface');
  assert.ok(
    rare.score > common.score,
    `sharing the rare interest should rank higher: rare ${rare.score}, common ${common.score}`,
  );
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

test('someone else skipping a candidate never promotes them', () => {
  const mk = (id) => ({ id, name: id, role: 'Member', city: 'Lima', interests: ['data'], active: ['am'] });
  const seed = () => ({
    users: [mk('v'), mk('m'), mk('a'), mk('r')],
    follows: { v: ['m'], m: ['a', 'r'], a: [], r: [] },
    interactions: [],
  });
  /* scores are relative to the best candidate, so what moves is a's standing
     against its twin r — which is what the deck actually shows */
  const standing = (store) => {
    const recs = recommend(store, 'v', { limit: 10 });
    return recs.find((x) => x.id === 'a').score / recs.find((x) => x.id === 'r').score;
  };
  const baseline = standing(createStore(seed()));
  assert.equal(baseline, 1, 'the twins start level');

  const skipped = createStore(seed());
  recordInteraction(skipped, 'm', 'a', 'skip');
  assert.ok(
    standing(skipped) <= baseline,
    'a rejection must not push a candidate up the way a like does',
  );

  const liked = createStore(seed());
  recordInteraction(liked, 'm', 'a', 'like');
  assert.ok(standing(liked) > baseline, 'a like still counts');
});

test('traversal takes the strongest path, not the last one declared', () => {
  const mk = (id, city, interests) => ({ id, name: id, role: 'M', city, interests, active: ['am'] });
  const users = () => [
    mk('s', 'Lima', ['data']), mk('a', 'Lima', ['data']),
    mk('b', 'Quito', ['x']), mk('c', 'Lima', ['data']), mk('d', 'Bogota', ['y']),
  ];
  /* s reaches c through a (a strong edge) and through b (a weak one); d then
     hangs off c. The same graph, declared either way round, must score alike. */
  const viaA = createStore({ users: users(), follows: { s: ['a', 'b'], a: ['c'], b: ['c'], c: ['d'], d: [] }, interactions: [] });
  const viaB = createStore({ users: users(), follows: { s: ['b', 'a'], a: ['c'], b: ['c'], c: ['d'], d: [] }, interactions: [] });
  const score = (store) => traversalScores(store, buildAdjacency(store), 's').get('d');
  assert.equal(score(viaA), score(viaB), 'follow declaration order must not change the ranking');
});

test('one call reads one clock: engagement and skips age together', () => {
  const mk = (id) => ({ id, name: id, role: 'M', city: 'Lima', interests: ['data'], active: ['am'] });
  const store = createStore({
    users: [mk('v'), mk('x'), mk('y')],
    follows: { v: [], x: [], y: [] },
    interactions: [],
  });
  const t0 = 1_700_000_000_000;
  recordInteraction(store, 'v', 'x', 'view', t0);
  const standing = (now) => {
    const recs = recommend(store, 'v', { now, limit: 10 });
    return recs.find((r) => r.id === 'x').score / recs.find((r) => r.id === 'y').score;
  };
  assert.ok(standing(t0) > 1, 'a fresh view lifts x above its twin');
  assert.ok(
    standing(t0 + 365 * DAY) < standing(t0),
    'a year-old view must not still weigh like a fresh one',
  );
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

/* Several members each liking someone in their own city and passing on someone
   far away — the shape the global model is meant to pick up. */
function cityPreferenceSeed(interactions) {
  const mk = (id, city) => ({ id, name: id, role: 'Member', city, interests: ['data'], active: ['am'] });
  const voters = ['v1', 'v2', 'v3', 'v4'];
  const users = [
    mk('you', 'Lima'),
    mk('same', 'Lima'), mk('other', 'Cusco'),          // the fresh candidates
    ...voters.map((id) => mk(id, 'Lima')),
    ...voters.flatMap((id) => [mk(`${id}near`, 'Lima'), mk(`${id}far`, 'Quito')]),
  ];
  return {
    users,
    follows: Object.fromEntries(users.map((u) => [u.id, []])),
    interactions: interactions(voters),
  };
}

test('learned layer amplifies what the network actually likes', () => {
  const daysAgo = (d) => Date.now() - d * 24 * 60 * 60 * 1000;
  const trained = createStore(cityPreferenceSeed((voters) => voters.flatMap((who, i) => [
    { from: who, to: `${who}near`, type: 'like', at: daysAgo(i + 1) },
    { from: who, to: `${who}far`, type: 'skip', at: daysAgo(i + 1) },
  ])));
  const cold = createStore(cityPreferenceSeed(() => []));

  const ratioOf = (recs) => {
    const same = recs.find((r) => r.id === 'same');
    const other = recs.find((r) => r.id === 'other');
    assert.ok(same && other, 'both fresh candidates surface');
    return same.score / other.score;
  };
  const coldRatio = ratioOf(recommend(cold, 'you', { limit: 50 }));
  const trainedRatio = ratioOf(recommend(trained, 'you', { limit: 50 }));
  assert.ok(coldRatio > 1, 'heuristics already prefer the same-city candidate');
  assert.ok(
    trainedRatio > coldRatio,
    `feedback should widen the gap: cold ${coldRatio}, trained ${trainedRatio}`,
  );
});

test('modelKey reuses one fit per snapshot instead of retraining per viewer', () => {
  const daysAgo = (d) => Date.now() - d * 24 * 60 * 60 * 1000;
  const feedback = (voters) => voters.flatMap((who, i) => [
    { from: who, to: `${who}near`, type: 'like', at: daysAgo(i + 1) },
    { from: who, to: `${who}far`, type: 'skip', at: daysAgo(i + 1) },
  ]);
  const trained = createStore(cityPreferenceSeed(feedback));
  const key = `test-snapshot-${Date.now()}`;
  const first = recommend(trained, 'you', { limit: 50, modelKey: key });

  /* strip the training data but keep the same key: a fresh fit would find no
     evidence and fall back to heuristics, so identical scores prove reuse */
  const stripped = createStore(cityPreferenceSeed(() => []));
  const viaMemo = recommend(stripped, 'you', { limit: 50, modelKey: key });
  const untrained = recommend(stripped, 'you', { limit: 50 });
  assert.notDeepEqual(
    untrained.map((r) => r.score),
    viaMemo.map((r) => r.score),
    'the memoised model should still be shaping the stripped snapshot',
  );
  assert.deepEqual(first.map((r) => r.id), viaMemo.map((r) => r.id));
});

test('one account cannot train the ranking the whole network is served', () => {
  /* the same feedback as above, all of it from a single member */
  const daysAgo = (d) => Date.now() - d * 24 * 60 * 60 * 1000;
  const solo = createStore(cityPreferenceSeed((voters) => voters.flatMap((who, i) => [
    { from: 'v1', to: `${who}near`, type: 'like', at: daysAgo(i + 1) },
    { from: 'v1', to: `${who}far`, type: 'skip', at: daysAgo(i + 1) },
  ])));
  assert.equal(
    trainMatchModel(solo, buildAdjacency(solo)),
    null,
    'one member labelling both sides is an opinion, not the network',
  );
});
