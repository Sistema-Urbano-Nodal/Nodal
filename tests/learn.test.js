import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, recordInteraction } from '../server/store.js';
import {
  BLEND,
  blendWeight,
  hasEnoughEvidence,
  labelledPairs,
  MAX_PAIRS_PER_LABELLER,
  MAX_TRAINING_PAIRS,
  MIN_EXAMPLES,
  MIN_LABELLERS,
  predictProbability,
  trainLogistic,
} from '../server/learn.js';

const mk = (id) => ({ id, name: id, role: '', city: '', interests: [], active: [] });
const emptyStore = (ids) => createStore({ users: ids.map(mk), follows: {}, interactions: [] });

test('labelledPairs: positive beats skip, views teach nothing', () => {
  const store = emptyStore(['a', 'b', 'c', 'd', 'e']);
  const t0 = 1_700_000_000_000;
  recordInteraction(store, 'a', 'b', 'like', t0);
  recordInteraction(store, 'a', 'c', 'skip', t0);
  recordInteraction(store, 'a', 'd', 'view', t0);
  recordInteraction(store, 'a', 'e', 'skip', t0);
  recordInteraction(store, 'a', 'e', 'like', t0 + 1);   // changed their mind
  const byPair = new Map(labelledPairs(store).map((p) => [`${p.from}->${p.to}`, p.label]));
  assert.equal(byPair.get('a->b'), 1);
  assert.equal(byPair.get('a->c'), 0);
  assert.equal(byPair.get('a->e'), 1, 'a later like overrides an earlier skip');
  assert.ok(!byPair.has('a->d'), 'a lone view is ambiguous and trains nothing');
});

test('labelledPairs skips pairs pointing outside the snapshot', () => {
  const store = emptyStore(['a', 'b']);
  recordInteraction(store, 'a', 'b', 'like');
  store.engagement.set('a->ghost', [{ w: 3, at: Date.now(), type: 'like' }]);
  assert.deepEqual(labelledPairs(store).map((p) => p.to), ['b']);
});

const spread = (n, base, label) => Array.from({ length: n }, (_, i) => ({
  features: base.map((v) => v + (i % 3) * 0.02),
  label,
}));

test('trainLogistic separates the classes it was shown', () => {
  const model = trainLogistic([...spread(5, [0.8, 0.8], 1), ...spread(5, [0.1, 0.1], 0)]);
  assert.ok(model, 'enough of both classes should train');
  const positive = predictProbability(model, [0.85, 0.85]);
  const negative = predictProbability(model, [0.1, 0.15]);
  assert.ok(positive > 0.6, `positive-looking pair should score high, got ${positive}`);
  assert.ok(negative < 0.4, `negative-looking pair should score low, got ${negative}`);
});

test('training is deterministic for a given input', () => {
  const examples = [...spread(5, [1, 0], 1), ...spread(5, [0, 1], 0)];
  assert.deepEqual(trainLogistic(examples), trainLogistic(examples));
});

test('trainLogistic refuses to pretend: it needs both classes, in volume', () => {
  assert.equal(trainLogistic(spread(20, [1], 1)), null, 'one class teaches nothing');
  assert.equal(trainLogistic([]), null);
  const lopsided = [...spread(200, [0.5], 1), ...spread(MIN_EXAMPLES - 1, [0.1], 0)];
  assert.equal(trainLogistic(lopsided), null, 'volume in one class does not substitute for the other');
});

test('a lopsided set fits the boundary, not the prior', () => {
  /* 200 positives and 5 negatives: an unbalanced fit would answer "positive"
     to everything, which is exactly what makes it useless as a re-ranker */
  const model = trainLogistic([...spread(200, [0.9], 1), ...spread(5, [0.1], 0)]);
  assert.ok(model);
  assert.ok(
    predictProbability(model, [0.1]) < 0.5,
    'a negative-looking pair must not inherit the majority class',
  );
  assert.ok(predictProbability(model, [0.9]) > 0.5);
});

test('model support is the minority class, so one skip cannot pass for evidence', () => {
  const model = trainLogistic([...spread(200, [0.9], 1), ...spread(6, [0.1], 0)]);
  assert.equal(model.support, 6, 'a thousand likes and six skips is six skips of evidence');
  assert.ok(blendWeight(model.support) < blendWeight(model.examples));
});

test('blendWeight ramps with evidence and never exceeds its cap', () => {
  assert.equal(blendWeight(0), 0);
  assert.ok(blendWeight(4) < blendWeight(40));
  assert.ok(blendWeight(10_000) < BLEND.max);
  assert.ok(blendWeight(BLEND.confidence) - BLEND.max / 2 < 1e-12);
});

test('one member cannot flood the training set', () => {
  const store = emptyStore(['spammer', ...Array.from({ length: 40 }, (_, i) => `m${i}`)]);
  for (let i = 0; i < 40; i += 1) recordInteraction(store, 'spammer', `m${i}`, 'skip');
  const mine = labelledPairs(store).filter((p) => p.from === 'spammer');
  assert.equal(mine.length, MAX_PAIRS_PER_LABELLER, 'the cap bounds one account, not the network');
});

test('the training set is bounded and sampled fairly across members', () => {
  const members = Array.from({ length: 400 }, (_, i) => `m${i}`);
  const store = emptyStore(members);
  for (const from of members) {
    for (let k = 0; k < 10; k += 1) recordInteraction(store, from, `m${(members.indexOf(from) + k + 1) % 400}`, 'like');
  }
  const pairs = labelledPairs(store);
  assert.ok(pairs.length <= MAX_TRAINING_PAIRS, `bounded, got ${pairs.length}`);
  const perMember = new Map();
  for (const { from } of pairs) perMember.set(from, (perMember.get(from) ?? 0) + 1);
  // 4000 eligible pairs into 2000 slots: everyone is served before anyone is served twice
  assert.equal(perMember.size, 400, 'every member is represented');
  assert.ok(Math.max(...perMember.values()) - Math.min(...perMember.values()) <= 1, 'shares stay even');
});

test('sampling is deterministic for a given snapshot', () => {
  const members = Array.from({ length: 30 }, (_, i) => `m${i}`);
  const store = emptyStore(members);
  const t0 = 1_700_000_000_000;
  for (const from of members) {
    for (let k = 0; k < 5; k += 1) {
      recordInteraction(store, from, `m${(Number(from.slice(1)) + k + 1) % 30}`, k % 2 ? 'like' : 'skip', t0);
    }
  }
  assert.deepEqual(labelledPairs(store), labelledPairs(store));
});

test('evidence must come from several members, not one busy account', () => {
  const pairsFrom = (from, n, label) =>
    Array.from({ length: n }, (_, i) => ({ from, to: `t${from}${i}`, label }));
  assert.equal(
    hasEnoughEvidence([...pairsFrom('solo', 10, 1), ...pairsFrom('solo', 10, 0)]),
    false,
    'one member labelling both sides is one opinion, not a network',
  );
  assert.equal(
    hasEnoughEvidence([
      ...pairsFrom('a', 10, 1), ...pairsFrom('b', 10, 1), ...pairsFrom('c', 10, 1),
      ...pairsFrom('d', 10, 0), ...pairsFrom('e', 10, 0),
    ]),
    false,
    `negatives from fewer than ${MIN_LABELLERS} members are not enough`,
  );
  const broad = ['a', 'b', 'c'].flatMap((who) => [...pairsFrom(who, 2, 1), ...pairsFrom(who, 2, 0)]);
  assert.equal(hasEnoughEvidence(broad), true);
});
