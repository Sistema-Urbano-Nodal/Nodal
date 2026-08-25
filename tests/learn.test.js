import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, recordInteraction } from '../server/store.js';
import {
  BLEND,
  blendWeight,
  labelledPairs,
  MIN_EXAMPLES,
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

test('trainLogistic separates the classes it was shown', () => {
  const examples = [
    { features: [0.9, 0.8], label: 1 },
    { features: [0.8, 0.9], label: 1 },
    { features: [0.7, 0.7], label: 1 },
    { features: [0.1, 0.2], label: 0 },
    { features: [0.2, 0.1], label: 0 },
    { features: [0.1, 0.1], label: 0 },
  ];
  const model = trainLogistic(examples);
  assert.ok(model, 'two classes and enough examples should train');
  const positive = predictProbability(model, [0.85, 0.85]);
  const negative = predictProbability(model, [0.1, 0.15]);
  assert.ok(positive > 0.6, `positive-looking pair should score high, got ${positive}`);
  assert.ok(negative < 0.4, `negative-looking pair should score low, got ${negative}`);
});

test('training is deterministic for a given input', () => {
  const examples = [
    { features: [1, 0], label: 1 },
    { features: [0.9, 0.1], label: 1 },
    { features: [0, 1], label: 0 },
    { features: [0.1, 0.9], label: 0 },
  ];
  assert.deepEqual(trainLogistic(examples), trainLogistic(examples));
});

test('trainLogistic refuses to pretend: single class or too few examples', () => {
  const positives = Array.from({ length: 6 }, () => ({ features: [1], label: 1 }));
  assert.equal(trainLogistic(positives), null);
  const tiny = [
    { features: [1], label: 1 },
    { features: [0], label: 0 },
  ];
  assert.ok(tiny.length < MIN_EXAMPLES);
  assert.equal(trainLogistic(tiny), null);
});

test('blendWeight ramps with evidence and never exceeds its cap', () => {
  assert.equal(blendWeight(0), 0);
  assert.ok(blendWeight(4) < blendWeight(40));
  assert.ok(blendWeight(10_000) < BLEND.max);
  assert.ok(blendWeight(BLEND.confidence) - BLEND.max / 2 < 1e-12);
});
