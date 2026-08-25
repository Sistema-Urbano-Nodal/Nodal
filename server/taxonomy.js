/* profession & interest taxonomy — the vocabulary layer under the engine.

   Members type their own titles and interests, in Portuguese, Spanish or
   English. This module maps that free text onto canonical disciplines and
   interest tags so "Engenheira Civil", "Ingeniero Civil" and "Civil Engineer"
   score as the same profession, and "transporte" matches "transport".

   Everything here is pure and deterministic: string in, score out. */

export const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLowerCase();

/* ---------------------------------------------------------------- professions

   Disciplines are matched by accent-free stems that must start at a word
   boundary, so "datos" reads as data work but "candidata" does not. */

const DISCIPLINES = {
  research:      ['research', 'investigad', 'pesquisad', 'cientist', 'scientist', 'academic'],
  engineering:   ['engineer', 'engenh', 'ingenier'],
  architecture:  ['architect', 'arquitet', 'arquitect'],
  design:        ['design', 'disen', 'projetist'],
  planning:      ['planner', 'planning', 'urbanist', 'planejad', 'planejament', 'planificad'],
  community:     ['community', 'comunit', 'comunid', 'social work', 'organizer', 'organizad', 'leader', 'lider', 'facilitad'],
  economics:     ['economist', 'econom'],
  technology:    ['technolog', 'tecnolog', 'developer', 'desenvolved', 'programad', 'software', 'data', 'dados', 'datos', 'analyst', 'analist'],
  policy:        ['policy', 'policymaker', 'public administration', 'gestor', 'gestao', 'gestion', 'govern', 'servidor'],
  socialscience: ['anthropolog', 'antropolog', 'sociolog', 'geograph', 'geograf'],
  environment:   ['environment', 'ambient', 'sustain', 'sustent', 'ecolog', 'climat', 'clima'],
  mobility:      ['mobility', 'mobilid', 'movilid', 'transport', 'transit'],
};

/* discipline pairs that historically need each other on urban projects */
const COMPLEMENT_PAIRS = [
  ['research', 'engineering'], ['research', 'technology'], ['research', 'design'], ['research', 'policy'],
  ['planning', 'community'], ['planning', 'economics'], ['planning', 'socialscience'],
  ['planning', 'technology'], ['planning', 'environment'],
  ['architecture', 'community'], ['architecture', 'engineering'],
  ['engineering', 'community'], ['engineering', 'environment'],
  ['mobility', 'planning'], ['mobility', 'policy'], ['mobility', 'community'],
  ['policy', 'economics'], ['policy', 'technology'], ['policy', 'community'],
  ['economics', 'technology'],
  ['community', 'socialscience'], ['community', 'technology'],
  ['environment', 'policy'],
];

const COMPLEMENT_KEYS = new Set(COMPLEMENT_PAIRS.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));

/* peers share language and problems; complements unblock each other's work */
export const PEER_AFFINITY = 0.5;

function hasStem(text, stem) {
  let i = text.indexOf(stem);
  while (i !== -1) {
    if (i === 0 || !/[a-z0-9]/.test(text[i - 1])) return true;
    i = text.indexOf(stem, i + 1);
  }
  return false;
}

/* roles repeat across the whole graph on every request, so parses are kept */
const professionCache = new Map();
const PROFESSION_CACHE_MAX = 500;
/* A title names what you do. Two disciplines is an honest crossover ("Ingeniero
   de Transporte" is engineering and mobility); past three it is not a title but
   a list, and since profession affinity peaks on ANY complementary pair, a
   member who claims ten disciplines scores the maximum against everyone. Such a
   title is read as unstated rather than as universal. */
const MAX_DISCIPLINES = 3;

export function professionsOf(role) {
  const text = normalizeText(role);
  if (!text) return new Set();
  const cached = professionCache.get(text);
  if (cached) return cached;
  let found = new Set();
  for (const [discipline, stems] of Object.entries(DISCIPLINES)) {
    if (stems.some((stem) => hasStem(text, stem))) found.add(discipline);
  }
  if (found.size > MAX_DISCIPLINES) found = new Set();
  /* drop the oldest entry rather than the whole table: a directory with more
     distinct titles than this would otherwise run permanently cold */
  if (professionCache.size >= PROFESSION_CACHE_MAX) {
    professionCache.delete(professionCache.keys().next().value);
  }
  professionCache.set(text, found);
  return found;
}

export const areComplementary = (a, b) => COMPLEMENT_KEYS.has(`${a}|${b}`);

/* graded profession affinity in 0..1: complementary disciplines score 1,
   shared disciplines score PEER_AFFINITY, unrelated ones score 0 */
export function professionScore(roleA, roleB) {
  const A = professionsOf(roleA);
  const B = professionsOf(roleB);
  if (!A.size || !B.size) return 0;
  let best = 0;
  for (const x of A) {
    for (const y of B) {
      if (areComplementary(x, y)) return 1;
      if (x === y) best = PEER_AFFINITY;
    }
  }
  return best;
}

/* binary complement check — kept separate from professionScore because a
   peer (same discipline) is a good match but not a complementary one */
export function rolesComplement(roleA, roleB) {
  const A = professionsOf(roleA);
  const B = professionsOf(roleB);
  for (const x of A) for (const y of B) if (areComplementary(x, y)) return true;
  return false;
}

/* ----------------------------------------------------------------- interests

   Free-text interests collapse onto canonical tags across languages, and the
   tags group into clusters so near-misses ("civic tech" vs "data") still earn
   partial credit. */

const INTEREST_SYNONYMS = {
  transport: ['transport', 'transporte', 'transportation', 'transit', 'transito',
    'mobility', 'mobilidade', 'movilidad', 'urban mobility', 'mobilidade urbana', 'movilidad urbana'],
  housing: ['housing', 'habitacao', 'vivienda', 'moradia'],
  research: ['research', 'pesquisa', 'investigacion', 'investigacao'],
  'public policy': ['public policy', 'politica publica', 'politicas publicas', 'policy', 'politica urbana'],
  data: ['data', 'dados', 'datos', 'data science', 'ciencia de dados', 'ciencia de datos',
    'open data', 'dados abertos', 'datos abiertos'],
  'community engagement': ['community engagement', 'engajamento comunitario', 'community', 'comunidade', 'comunidad',
    'participacao', 'participacion', 'participacao social', 'participacion ciudadana', 'participacao cidada'],
  planning: ['planning', 'planejamento', 'planificacion', 'urban planning', 'planejamento urbano',
    'planificacion urbana', 'urbanism', 'urbanismo'],
  economics: ['economics', 'economia', 'urban economics', 'economia urbana'],
  engineering: ['engineering', 'engenharia', 'ingenieria'],
  'civic tech': ['civic tech', 'civictech', 'tecnologia civica', 'govtech', 'technology', 'tecnologia'],
  environment: ['environment', 'meio ambiente', 'medio ambiente', 'sustainability', 'sustentabilidade',
    'sustentabilidad', 'climate', 'clima', 'resilience', 'resiliencia'],
  design: ['design', 'urban design', 'desenho urbano', 'diseno urbano', 'diseno'],
  construction: ['construction', 'construcao', 'construccion', 'obras'],
  culture: ['culture', 'cultura'],
  governance: ['governance', 'governanca', 'gobernanza'],
};

const CANONICAL_INTEREST = new Map();
for (const [canonical, synonyms] of Object.entries(INTEREST_SYNONYMS)) {
  for (const synonym of synonyms) CANONICAL_INTEREST.set(normalizeText(synonym), canonical);
}

/* null-prototype: the keys are member-typed interest text, and a plain object
   would answer to "__proto__" and "constructor" with something truthy */
const INTEREST_CLUSTERS = Object.assign(Object.create(null), {
  transport: 'mobility',
  data: 'technology',
  'civic tech': 'technology',
  housing: 'built environment',
  planning: 'built environment',
  design: 'built environment',
  construction: 'built environment',
  engineering: 'built environment',
  'public policy': 'governance',
  economics: 'governance',
  governance: 'governance',
  'community engagement': 'community',
  culture: 'community',
  environment: 'environment',
});

/* a related-but-different interest earns half the credit of an exact match */
export const CLUSTER_CREDIT = 0.5;

export function canonicalInterest(raw) {
  const text = normalizeText(raw);
  if (!text) return '';
  return CANONICAL_INTEREST.get(text) ?? text;
}

export const canonicalInterestSet = (list) => new Set(
  (Array.isArray(list) ? list : []).map(canonicalInterest).filter(Boolean),
);

const clusterOf = (tag) => INTEREST_CLUSTERS[tag] ?? null;

/* IDF over the member base: a rare shared interest says more about two people
   than one everybody lists. Returns a lookup usable as the `idf` argument of
   interestSimilarity. */
export function buildInterestIdf(users) {
  const df = new Map();
  let n = 0;
  for (const user of users) {
    n += 1;
    for (const tag of canonicalInterestSet(user?.interests)) df.set(tag, (df.get(tag) ?? 0) + 1);
  }
  return (tag) => {
    const d = df.get(tag) ?? 0;
    return d > 0 ? Math.log(1 + n / d) : 1;
  };
}

/* IDF-weighted soft Jaccard over canonical sets. Exact matches count in
   full; leftover interests from the same cluster pair up greedily (in sorted
   order, so the score is symmetric) at CLUSTER_CREDIT. Always in 0..1. */
export function canonicalSimilarity(A, B, idf = () => 1) {
  if (!A.size && !B.size) return 0;
  let shared = 0;
  let union = 0;
  const restA = [];
  const restB = [];
  for (const tag of A) {
    union += idf(tag);
    if (B.has(tag)) shared += idf(tag);
    else restA.push(tag);
  }
  for (const tag of B) {
    if (A.has(tag)) continue;
    union += idf(tag);
    restB.push(tag);
  }
  if (union <= 0) return 0;
  restA.sort();
  restB.sort();
  const used = new Set();
  let related = 0;
  for (const ta of restA) {
    const cluster = clusterOf(ta);
    if (!cluster) continue;
    for (const tb of restB) {
      if (used.has(tb) || clusterOf(tb) !== cluster) continue;
      related += CLUSTER_CREDIT * Math.min(idf(ta), idf(tb));
      used.add(tb);
      break;
    }
  }
  return (shared + related) / union;
}

export function interestSimilarity(a, b, idf = () => 1) {
  return canonicalSimilarity(canonicalInterestSet(a), canonicalInterestSet(b), idf);
}

/* shared interests for the "why this match" line — returned in the viewer's
   own words, matched on canonical form so "transporte" meets "transport" */
export function sharedInterestLabels(mine, theirs) {
  const theirTags = canonicalInterestSet(theirs);
  const seen = new Set();
  const labels = [];
  for (const label of Array.isArray(mine) ? mine : []) {
    const tag = canonicalInterest(label);
    if (tag && theirTags.has(tag) && !seen.has(tag)) {
      seen.add(tag);
      labels.push(label);
    }
  }
  return labels;
}
