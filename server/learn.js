/* learned ranking layer: logistic regression over pair features, trained on
   the network's real feedback — like/message/follow label a pair positive,
   skip labels it negative, a lone view teaches nothing.

   Training is plain batch gradient descent with L2, zero dependencies, and
   fully deterministic for a given store snapshot: examples are visited in
   sorted key order and the model starts from zeros. The engine blends the
   model's probability into the heuristic score with a confidence ramp, so a
   handful of interactions nudge the ranking and a silent network leaves the
   heuristics untouched. */

export const POSITIVE_TYPES = new Set(['like', 'message', 'follow']);
export const MIN_EXAMPLES = 4;                       // below this, don't pretend to learn
export const TRAINING = { epochs: 300, learningRate: 0.5, l2: 0.01 };
/* even a fully confident model only re-ranks — it never replaces the graph */
export const BLEND = { max: 0.35, confidence: 20 };

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const dot = (w, x) => {
  let sum = 0;
  for (let i = 0; i < w.length; i += 1) sum += w[i] * x[i];
  return sum;
};

/* every engagement pair with an unambiguous outcome, in deterministic order */
export function labelledPairs(store) {
  const out = [];
  for (const key of [...store.engagement.keys()].sort()) {
    const [from, to] = key.split('->');
    if (!store.users.has(from) || !store.users.has(to)) continue;
    let positive = false;
    let skipped = false;
    for (const event of store.engagement.get(key)) {
      if (POSITIVE_TYPES.has(event.type)) positive = true;
      else if (event.type === 'skip') skipped = true;
    }
    /* a skip followed by a like reads as a like — people change their minds */
    if (positive) out.push({ from, to, label: 1 });
    else if (skipped) out.push({ from, to, label: 0 });
  }
  return out;
}

/* examples: [{ features: number[], label: 0|1 }] — returns null when there is
   not enough signal (too few examples, or only one class) rather than a model
   that would just memorise its bias */
export function trainLogistic(examples, { epochs, learningRate, l2 } = TRAINING) {
  if (!Array.isArray(examples) || examples.length < MIN_EXAMPLES) return null;
  const positives = examples.reduce((n, e) => n + (e.label === 1 ? 1 : 0), 0);
  if (positives === 0 || positives === examples.length) return null;
  const dim = examples[0].features.length;
  const weights = new Array(dim).fill(0);
  let bias = 0;
  const n = examples.length;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradient = new Array(dim).fill(0);
    let biasGradient = 0;
    for (const { features, label } of examples) {
      const error = sigmoid(dot(weights, features) + bias) - label;
      for (let i = 0; i < dim; i += 1) gradient[i] += error * features[i];
      biasGradient += error;
    }
    for (let i = 0; i < dim; i += 1) {
      weights[i] -= learningRate * (gradient[i] / n + l2 * weights[i]);
    }
    bias -= learningRate * (biasGradient / n);
  }
  return { weights, bias, examples: n };
}

export function predictProbability(model, features) {
  return sigmoid(dot(model.weights, features) + model.bias);
}

/* how much say the model gets, given how much it has seen */
export function blendWeight(exampleCount) {
  if (!exampleCount) return 0;
  return BLEND.max * (exampleCount / (exampleCount + BLEND.confidence));
}
