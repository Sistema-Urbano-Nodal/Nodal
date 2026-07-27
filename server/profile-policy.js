export const DEFAULT_PART_C = {
  bio: '',
  linkedin: '',
  portfolio: '',
  references: '',
  availability: '',
  consent: false,
};

export const DEFAULT_INDICATORS = { leadership: 'No', transmission: 'No' };

const INDICATOR_VALUES = {
  leadership: new Set(['No', 'Once or twice', 'Regularly']),
  transmission: new Set(['No', 'Informally', 'Formally']),
};
const REQUEST_KEYS = new Set(['knowledge', 'project', 'territory', 'community']);

/* Part C is stored as one JSON blob, so whatever the body puts in it is what
   gets written. Spreading the request wholesale meant a member could park
   arbitrary keys and arbitrary-length strings in their own row and have them
   served back to every other member through the directory. Only the fields the
   form actually has are kept, each capped at the length its column expects. */
const PART_C_TEXT_LIMITS = {
  bio: 2000,
  linkedin: 220,
  portfolio: 500,
  references: 500,
  availability: 120,
};

export function normalizePartC(value, current = DEFAULT_PART_C) {
  const incoming = value && typeof value === 'object' ? value : {};
  const merged = { ...DEFAULT_PART_C, ...current, ...incoming };
  const out = {};
  for (const [key, max] of Object.entries(PART_C_TEXT_LIMITS)) {
    out[key] = String(merged[key] ?? '').slice(0, max);
  }
  out.consent = merged.consent === true;
  /* absent means named — an older profile predates the opt-out and never
     asked to be hidden, so the key is only carried once it has been set */
  if ('listName' in merged) out.listName = merged.listName !== false;
  return out;
}

export function normalizeIndicators(value) {
  return { ...DEFAULT_INDICATORS, ...(value && typeof value === 'object' ? value : {}) };
}

export function cleanIndicators(value) {
  const merged = normalizeIndicators(value);
  return Object.fromEntries(Object.entries(DEFAULT_INDICATORS).map(([key, fallback]) => {
    const candidate = String(merged[key] ?? fallback);
    return [key, INDICATOR_VALUES[key].has(candidate) ? candidate : fallback];
  }));
}

export function cleanTopics(value, currentTopics = []) {
  const previous = new Map(currentTopics.map((topic) => [String(topic.name || topic).trim().toLowerCase(), topic]));
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item) => {
    const rawName = typeof item === 'object' && item ? item.name : item;
    const name = String(rawName ?? '').trim().slice(0, 80);
    if (!name) return null;
    const prior = previous.get(name.toLowerCase()) ?? {};
    const priorValidated = Number(prior.validatedAt) || 0;
    const priorEndorsed = Number(prior.endorsedAt) || 0;
    const requestedLevel = Number(item?.level) || 1;
    const maxSelfAssignedLevel = priorValidated >= 4 ? 4 : 3;
    return {
      name,
      level: Math.min(Math.max(1, requestedLevel), maxSelfAssignedLevel),
      validatedAt: priorValidated,
      endorsedAt: priorEndorsed,
    };
  }).filter(Boolean);
}

export function cleanRequests(value, currentRequests = {}, nextPartC = DEFAULT_PART_C) {
  const incoming = value && typeof value === 'object' ? value : {};
  const out = {};
  for (const key of REQUEST_KEYS) {
    const alreadyRequested = currentRequests[key] === true;
    const requested = incoming[key] === true;
    if (key === 'project') {
      const hasDepthProfile = ['bio', 'linkedin', 'portfolio', 'references', 'availability']
        .every((field) => String(nextPartC[field] ?? '').trim() !== '');
      out[key] = alreadyRequested || (requested && hasDepthProfile);
    } else {
      out[key] = alreadyRequested || requested;
    }
  }
  return out;
}

export function canApplyForMentor({ assessed, topics, indicators }) {
  const maxTopicLevel = Math.max(0, ...topics.map((topic) => Number(topic.level) || 0));
  return Boolean(assessed) && maxTopicLevel >= 3 && indicators.transmission !== 'No';
}
