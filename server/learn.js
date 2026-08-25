/* learned ranking layer: logistic regression over pair features, trained on
   the network's real feedback — like/message/follow label a pair positive,
   skip labels it negative, a lone view teaches nothing.

   The model is global: one fit, applied to every viewer. That is what makes it
   worth having — it reads what the community responds to rather than what one
   member clicked — and it is also what makes it worth defending. A global model
   trained on whatever arrives is a lever anyone can pull: one account skipping
   its way down the directory can move everybody's ranking. So the evidence is
   gated before it is fitted, no single member can outvote the rest, and the
   classes are balanced so a lopsided set teaches the boundary and not the prior.

   Training is plain batch gradient descent with L2, zero dependencies, and
   fully deterministic for a given store snapshot: examples are visited in
   sorted key order and the model starts from zeros. */

export const POSITIVE_TYPES = new Set(['like', 'message', 'follow']);
/* per class, not in total: a set of 200 follows and one skip is not evidence
   about what a skip looks like, however large it is overall */
export const MIN_EXAMPLES = 4;
/* and from different people — one member's taste is not the network's */
export const MIN_LABELLERS = 3;
/* nobody's feedback counts more than this, so steering the global model costs
   an attacker accounts rather than clicks */
export const MAX_PAIRS_PER_LABELLER = 20;
/* Five features do not need more than this to fit, and the whole point of a
   snapshot-wide model is that it is cheap enough to sit in a request. Sampling
   round-robin across members keeps the set representative — and shrinks any one
   member's share further as the directory grows. */
export const MAX_TRAINING_PAIRS = 2000;
export const TRAINING = { epochs: 300, learningRate: 0.5, l2: 0.01 };
/* even a fully confident model only re-ranks — it never replaces the graph */
export const BLEND = { max: 0.35, confidence: 20 };

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const dot = (w, x) => {
  let sum = 0;
  for (let i = 0; i < w.length; i += 1) sum += w[i] * x[i];
  return sum;
};

const countLabels = (examples) => {
  let positives = 0;
  for (const example of examples) if (example.label === 1) positives += 1;
  return { positives, negatives: examples.length - positives };
};

/* Every engagement pair with an unambiguous outcome, sampled fairly and
   deterministically: at most MAX_PAIRS_PER_LABELLER from any one member, then
   round-robin across members up to MAX_TRAINING_PAIRS. Everything is walked in
   sorted key order, so the same snapshot always yields the same training set —
   which is what lets the recommendation cache stay coherent. */
export function labelledPairs(store) {
  const byLabeller = new Map();
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
    if (!positive && !skipped) continue;
    const mine = byLabeller.get(from) ?? [];
    if (mine.length >= MAX_PAIRS_PER_LABELLER) continue;
    mine.push({ from, to, label: positive ? 1 : 0 });
    byLabeller.set(from, mine);
  }

  const queues = [...byLabeller.keys()].sort().map((from) => byLabeller.get(from));
  const out = [];
  for (let round = 0; out.length < MAX_TRAINING_PAIRS; round += 1) {
    let served = false;
    for (const queue of queues) {
      if (round >= queue.length) continue;
      out.push(queue[round]);
      served = true;
      if (out.length >= MAX_TRAINING_PAIRS) break;
    }
    if (!served) break;
  }
  return out;
}

/* Is this enough independent feedback to fit a model the whole network will be
   ranked by? Both classes need volume and, separately, need to come from
   several different members — otherwise the "network's" model is one person's,
   or one person's plus a rounding error. */
export function hasEnoughEvidence(pairs) {
  const labellers = { 1: new Set(), 0: new Set() };
  const counts = { 1: 0, 0: 0 };
  for (const { from, label } of pairs) {
    if (label !== 1 && label !== 0) continue;
    counts[label] += 1;
    labellers[label].add(from);
  }
  return [1, 0].every((label) => counts[label] >= MIN_EXAMPLES && labellers[label].size >= MIN_LABELLERS);
}

/* examples: [{ features: number[], label: 0|1 }] — returns null when there is
   not enough signal (too few of either class) rather than a model that would
   just memorise its bias. Classes are balanced by weight, so 200 follows and
   6 skips fits the boundary between them instead of predicting "follow". */
export function trainLogistic(examples, { epochs, learningRate, l2 } = TRAINING) {
  if (!Array.isArray(examples) || !examples.length) return null;
  const { positives, negatives } = countLabels(examples);
  if (positives < MIN_EXAMPLES || negatives < MIN_EXAMPLES) return null;
  const dim = examples[0].features.length;
  const weights = new Array(dim).fill(0);
  let bias = 0;
  const n = examples.length;
  const classWeight = { 1: n / (2 * positives), 0: n / (2 * negatives) };
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradient = new Array(dim).fill(0);
    let biasGradient = 0;
    for (const { features, label } of examples) {
      const error = (sigmoid(dot(weights, features) + bias) - label) * classWeight[label];
      for (let i = 0; i < dim; i += 1) gradient[i] += error * features[i];
      biasGradient += error;
    }
    for (let i = 0; i < dim; i += 1) {
      weights[i] -= learningRate * (gradient[i] / n + l2 * weights[i]);
    }
    bias -= learningRate * (biasGradient / n);
  }
  /* the minority class is what the model actually knows about, and it is what
     the blend ramps on — a thousand likes and one skip is still one skip */
  return { weights, bias, examples: n, positives, negatives, support: Math.min(positives, negatives) };
}

export function predictProbability(model, features) {
  return sigmoid(dot(model.weights, features) + model.bias);
}

/* how much say the model gets, given how much of the rarer outcome it has seen */
export function blendWeight(support) {
  if (!support) return 0;
  return BLEND.max * (support / (support + BLEND.confidence));
}
