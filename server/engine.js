/* recommendation engine: weighted node graph + collaborative filtering +
   a learned re-ranking layer. Pure functions over a store snapshot — no
   mutation, fully testable.

   Edge weight blends six signals (all normalised to 0..1):
     shared interests (canonical across pt/es/en, IDF-weighted, with partial
     credit for related interests) · mutual connections · engagement history ·
     activity overlap · same city · profession affinity (complementary
     disciplines score highest, peers score half)
   Personalised score per candidate combines:
     BFS graph traversal with per-hop decay, direct affinity, and user-user CF —
     then a logistic model trained on the network's real likes and skips blends
     in (confidence-ramped), and recent skips damp the candidate. */

import { getEngagement, decayedTypeCount } from './store.js';
import {
  buildInterestIdf,
  canonicalInterestSet,
  canonicalSimilarity,
  normalizeText,
  professionScore,
  rolesComplement,
  sharedInterestLabels,
} from './taxonomy.js';
import {
  blendWeight, hasEnoughEvidence, labelledPairs, predictProbability, trainLogistic,
} from './learn.js';

/* NOTE: the "How matching works" tab on the landing page displays these
   weights — keep index.html's sig-bars in sync when changing them */
export const WEIGHTS = { interests: 0.30, mutuals: 0.20, engagement: 0.20, activity: 0.10, city: 0.10, complement: 0.10 };
export const DECAY = 0.5;        // score multiplier per extra hop
export const MAX_DEPTH = 3;
export const LINKEDIN_BOOST = 1.05;   // verifiability prior on the final score
export const SKIP_DAMP = 0.6;    // score multiplier per (decayed) recent skip
const MIX = { traversal: 0.45, direct: 0.30, cf: 0.25 };

export const cityScore = (a, b) => {
  const ca = normalizeText(a.city);
  const cb = normalizeText(b.city);
  return ca && ca === cb ? 1 : 0;
};

/* binary complement flag for the "why this match" line; the graded
   profession affinity lives in edgeWeight via professionScore */
export function complementScore(a, b) {
  return rolesComplement(a.role, b.role) ? 1 : 0;
}

const jaccard = (a, b) => {
  const A = new Set(a), B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
};

/* per-snapshot derived data the hot paths reuse: canonical interest sets, the
   IDF built over the whole member base, and the one clock the whole scoring
   pass reads — engagement decay and skip decay have to agree on "now", or a
   single call ages its two halves differently */
function engineContext(store, now = Date.now()) {
  const interestSets = new Map();
  for (const [id, user] of store.users) interestSets.set(id, canonicalInterestSet(user.interests));
  return { interestSets, idf: buildInterestIdf(store.users.values()), now };
}

const EMPTY_SET = new Set();

function interestScore(ctx, a, b) {
  return canonicalSimilarity(
    ctx.interestSets.get(a) ?? EMPTY_SET,
    ctx.interestSets.get(b) ?? EMPTY_SET,
    ctx.idf,
  );
}

/* undirected adjacency from the directed follow edges */
export function buildAdjacency(store) {
  const adj = new Map([...store.users.keys()].map((id) => [id, new Set()]));
  for (const [from, tos] of store.follows) {
    for (const to of tos) {
      adj.get(from)?.add(to);
      adj.get(to)?.add(from);
    }
  }
  return adj;
}

function mutualScore(adj, a, b) {
  const na = adj.get(a), nb = adj.get(b);
  if (!na?.size || !nb?.size) return 0;
  let common = 0;
  for (const n of na) if (nb.has(n) && n !== a && n !== b) common += 1;
  return common / Math.sqrt(na.size * nb.size);
}

export function edgeWeight(store, adj, a, b, ctx = engineContext(store)) {
  const ua = store.users.get(a), ub = store.users.get(b);
  const engagement = getEngagement(store, a, b, ctx.now);
  return (
    WEIGHTS.interests  * interestScore(ctx, a, b) +
    WEIGHTS.mutuals    * mutualScore(adj, a, b) +
    WEIGHTS.engagement * (engagement / (engagement + 3)) +   // saturating
    WEIGHTS.activity   * jaccard(ua.active, ub.active) +
    WEIGHTS.city       * cityScore(ua, ub) +
    WEIGHTS.complement * professionScore(ua.role, ub.role)
  );
}

/* layered BFS from src: each node reached at depth d contributes
   bestPathScore(parent) * edgeWeight(parent, node) * DECAY^(d-1),
   summed over parents so multi-path candidates rank higher */
export function traversalScores(store, adj, src, ctx = engineContext(store)) {
  const scores = new Map();
  const best = new Map([[src, 1]]);
  let frontier = [src];
  for (let depth = 1; depth <= MAX_DEPTH && frontier.length; depth += 1) {
    const next = new Map();
    for (const u of frontier) {
      for (const v of adj.get(u) ?? []) {
        if (v === src) continue;
        const contribution = best.get(u) * edgeWeight(store, adj, u, v, ctx) * DECAY ** (depth - 1);
        scores.set(v, (scores.get(v) ?? 0) + contribution);
        /* Compare against the layer being built, not against `best` — `best`
           has no entry for v at this depth yet, so testing it made every
           parent overwrite the last and left whichever parent happened to be
           declared last as v's "best" path. The strongest parent wins. */
        if (!next.has(v) || contribution > next.get(v)) next.set(v, contribution);
      }
    }
    for (const [v, s] of next) if (!best.has(v)) best.set(v, s);
    frontier = [...next.keys()];
  }
  return scores;
}

/* user-user collaborative filtering: people similar to src "vote" for
   whoever they follow, weighted by similarity */
export function cfScores(store, src, ctx = engineContext(store)) {
  const myFollows = store.follows.get(src);
  const scores = new Map();
  for (const [otherId] of store.users) {
    if (otherId === src) continue;
    const followSim = jaccard([...myFollows], [...store.follows.get(otherId)]);
    const sim = 0.5 * followSim + 0.5 * interestScore(ctx, src, otherId);
    if (sim === 0) continue;
    for (const t of store.follows.get(otherId)) {
      if (t === src || myFollows.has(t)) continue;
      scores.set(t, (scores.get(t) ?? 0) + sim);
    }
  }
  return scores;
}

/* profile-level features for the learned layer. Deliberately excludes the
   engagement signal: a liked pair always carries its own like, so training on
   engagement would only teach "you like whom you liked". */
export function pairFeatures(store, adj, a, b, ctx = engineContext(store)) {
  const ua = store.users.get(a), ub = store.users.get(b);
  return [
    interestScore(ctx, a, b),
    mutualScore(adj, a, b),
    jaccard(ua.active, ub.active),
    cityScore(ua, ub),
    professionScore(ua.role, ub.role),
  ];
}

/* one global model over the labelled pairs in the snapshot: the whole
   network's feedback teaches which profile signals predict a like here.
   Returns null (heuristics only) until several different members have supplied
   enough of both outcomes — a model the entire directory is ranked by should
   not be fittable by one account with a grudge. */
export function trainMatchModel(store, adj, ctx = engineContext(store)) {
  const pairs = labelledPairs(store);
  if (!hasEnoughEvidence(pairs)) return null;
  return trainLogistic(pairs.map(({ from, to, label }) => ({
    features: pairFeatures(store, adj, from, to, ctx),
    label,
  })));
}

/* skips talk: each recent skip of a candidate multiplies their score by
   SKIP_DAMP, and the count decays with the engagement half-life so a
   passed-over profile can resurface months later */
export function skipPenalty(store, viewer, candidate, now = Date.now()) {
  const skips = decayedTypeCount(store, viewer, candidate, 'skip', now);
  return skips > 0 ? SKIP_DAMP ** skips : 1;
}

const normalize = (m) => {
  const max = Math.max(0, ...m.values());
  if (max === 0) return m;
  return new Map([...m].map(([k, v]) => [k, v / max]));
};

export function recommend(store, userId, { limit = 6, now = Date.now() } = {}) {
  const me = store.users.get(userId);
  if (!me) return null;
  const adj = buildAdjacency(store);
  const ctx = engineContext(store, now);
  const following = store.follows.get(userId);

  const traversal = normalize(traversalScores(store, adj, userId, ctx));
  const cf = normalize(cfScores(store, userId, ctx));
  const direct = normalize(new Map(
    [...store.users.keys()]
      .filter((id) => id !== userId)
      .map((id) => [id, edgeWeight(store, adj, userId, id, ctx)]),
  ));

  const model = trainMatchModel(store, adj, ctx);
  const blend = model ? blendWeight(model.support) : 0;

  const candidates = [];
  for (const [id, user] of store.users) {
    if (id === userId || following.has(id)) continue;
    const graphScore =
      MIX.traversal * (traversal.get(id) ?? 0) +
      MIX.direct    * (direct.get(id) ?? 0) +
      MIX.cf        * (cf.get(id) ?? 0);
    if (graphScore <= 0) continue;
    candidates.push({ id, user, graphScore });
  }

  /* The graph mixture only reaches 1 for a viewer who has all three components,
     and a member who follows nobody has neither traversal nor CF — their scores
     top out at MIX.direct. The model's probability spans 0..1 for everyone, so
     the two are put on one scale before they meet: otherwise `blend` hands the
     model several times the say it names, and on a cold-start viewer it decides
     the ranking outright. Dividing through by the best candidate keeps the
     spread this viewer actually has. */
  const topGraphScore = Math.max(0, ...candidates.map((c) => c.graphScore));

  const results = [];
  for (const { id, user, graphScore } of candidates) {
    let score = topGraphScore > 0 ? graphScore / topGraphScore : 0;
    if (blend > 0) {
      const probability = predictProbability(model, pairFeatures(store, adj, userId, id, ctx));
      score = (1 - blend) * score + blend * probability;
    }
    score *= skipPenalty(store, userId, id, ctx.now);
    if (user.linkedin) score *= LINKEDIN_BOOST;

    const shared = sharedInterestLabels(me.interests, user.interests);
    let mutuals = 0;
    for (const n of adj.get(id)) if (following.has(n)) mutuals += 1;

    results.push({
      id,
      name: user.name,
      role: user.role,
      city: user.city,
      interests: user.interests,
      score: Number(score.toFixed(4)),
      reasons: {
        sharedInterests: shared,
        mutualConnections: mutuals,
        sameCity: cityScore(user, me) === 1,
        complementaryRole: complementScore(me, user) ? user.role : null,
        hasLinkedin: Boolean(user.linkedin),
      },
    });
  }
  results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  // match strength is relative to the best candidate (presentation, not probability)
  const top = results[0]?.score || 1;
  for (const r of results) r.matchPct = Math.round(99 * (r.score / top));
  return results.slice(0, limit);
}
