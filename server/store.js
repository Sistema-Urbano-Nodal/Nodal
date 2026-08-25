/* in-memory user graph: nodes are members, edges are follows + engagement.
   The store is the single mutable surface — the engine only reads it. */

const ENGAGEMENT_WEIGHT = { view: 1, skip: 0.5, like: 3, message: 4, follow: 3 };
const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;   // engagement halves every 30 days

export function seedData() {
  /* personas mirror the ones on the site; `you` is the demo session user
     the landing page requests recommendations for */
  const users = [
    { id: 'you',     name: 'You',          role: 'Civic Designer',             city: 'Lima',       interests: ['transport', 'community engagement', 'public policy', 'research'], active: ['am', 'eve'] },
    { id: 'flavia',  name: 'Flavia Muro',  role: 'Urban Mobility Researcher',  city: 'Lima',       interests: ['transport', 'research', 'public policy', 'community engagement'], active: ['am', 'eve'], linkedin: 'https://www.linkedin.com/in/flavia-muro' },
    { id: 'diego',   name: 'Diego A.',     role: 'Mobility Engineer',          city: 'Lima',       interests: ['transport', 'engineering', 'data'],                                active: ['am', 'pm'], linkedin: 'https://www.linkedin.com/in/diego-mobility' },
    { id: 'sofia',   name: 'Sofía M.',     role: 'City Planner',               city: 'CDMX',       interests: ['planning', 'housing', 'public policy'],                            active: ['am', 'pm'] },
    { id: 'lucas',   name: 'Lucas O.',     role: 'Civic Technologist',         city: 'São Paulo',  interests: ['data', 'civic tech', 'community engagement'],                      active: ['pm', 'eve'] },
    { id: 'valeria', name: 'Valeria C.',   role: 'Urban Economist',            city: 'Santiago',   interests: ['economics', 'public policy', 'data'],                              active: ['am', 'eve'], linkedin: 'https://www.linkedin.com/in/valeria-c-econ' },
    { id: 'mariana', name: 'Mariana R.',   role: 'Urban Researcher',           city: 'Bogotá',     interests: ['research', 'housing', 'community engagement'],                     active: ['am', 'pm'], linkedin: 'https://www.linkedin.com/in/mariana-r-urban' },
    { id: 'camila',  name: 'Camila T.',    role: 'Community Leader',           city: 'Bogotá',     interests: ['community engagement', 'housing'],                                 active: ['eve'] },
    { id: 'rafael',  name: 'Rafael S.',    role: 'Civil Engineer',             city: 'São Paulo',  interests: ['engineering', 'construction'],                                     active: ['am', 'pm'] },
    { id: 'ines',    name: 'Inés D.',      role: 'Architect',                  city: 'Montevideo', interests: ['design', 'housing', 'planning'],                                   active: ['pm'] },
    { id: 'tomas',   name: 'Tomás V.',     role: 'Transport Engineer',         city: 'Santiago',   interests: ['transport', 'engineering', 'data'],                                active: ['am', 'pm'], linkedin: 'https://www.linkedin.com/in/tomas-v-transport' },
    { id: 'paula',   name: 'Paula N.',     role: 'Anthropologist',             city: 'CDMX',       interests: ['research', 'community engagement'],                                active: ['pm', 'eve'] },
  ];

  const follows = {
    you:     ['diego', 'lucas'],
    flavia:  ['diego', 'mariana', 'camila', 'valeria'],
    diego:   ['flavia', 'tomas', 'rafael'],
    sofia:   ['ines', 'paula', 'mariana'],
    lucas:   ['rafael', 'camila', 'valeria'],
    valeria: ['tomas', 'sofia'],
    mariana: ['camila', 'sofia'],
    camila:  ['mariana', 'lucas'],
    rafael:  ['diego', 'tomas'],
    ines:    ['sofia'],
    tomas:   ['diego', 'valeria'],
    paula:   ['sofia', 'mariana'],
  };

  const daysAgo = (d) => Date.now() - d * 24 * 60 * 60 * 1000;
  const interactions = [
    { from: 'you',    to: 'flavia',  type: 'view',    at: daysAgo(2) },
    { from: 'you',    to: 'flavia',  type: 'like',    at: daysAgo(2) },
    { from: 'you',    to: 'valeria', type: 'view',    at: daysAgo(9) },
    { from: 'diego',  to: 'flavia',  type: 'message', at: daysAgo(5) },
    { from: 'lucas',  to: 'camila',  type: 'message', at: daysAgo(21) },
    { from: 'flavia', to: 'mariana', type: 'like',    at: daysAgo(45) },
  ];

  return { users, follows, interactions };
}

export function createStore(seed = seedData()) {
  const store = {
    users: new Map(seed.users.map((u) => [u.id, u])),
    follows: new Map(seed.users.map((u) => [u.id, new Set(seed.follows[u.id] ?? [])])),
    engagement: new Map(),
  };
  for (const { from, to, type, at } of seed.interactions) recordInteraction(store, from, to, type, at);
  return store;
}

const edgeKey = (a, b) => `${a}->${b}`;

const MAX_EVENTS_PER_PAIR = 50;   // older events are ~fully decayed anyway

export function recordInteraction(store, from, to, type, at = Date.now()) {
  const w = ENGAGEMENT_WEIGHT[type];
  if (w === undefined) throw new Error(`unknown interaction type: ${type}`);
  const k = edgeKey(from, to);
  const events = store.engagement.get(k) ?? [];
  /* the type rides along so the learned layer can label pairs and the engine
     can treat a skip as a negative signal, not just faint attention */
  events.push({ w, at, type });
  if (events.length > MAX_EVENTS_PER_PAIR) events.splice(0, events.length - MAX_EVENTS_PER_PAIR);
  store.engagement.set(k, events);
}

/* recency-weighted engagement: each event decays exponentially from `at` */
export function getEngagement(store, a, b, now = Date.now()) {
  const events = store.engagement.get(edgeKey(a, b));
  if (!events) return 0;
  let total = 0;
  for (const { w, at } of events) total += w * 2 ** (-(now - at) / HALF_LIFE_MS);
  return total;
}

/* decayed count of one interaction type on the a→b edge: a fresh event counts
   ~1, one from a half-life ago counts ~0.5. Lets a skip fade instead of
   banishing someone forever. */
export function decayedTypeCount(store, a, b, type, now = Date.now()) {
  const events = store.engagement.get(edgeKey(a, b));
  if (!events) return 0;
  let total = 0;
  for (const event of events) {
    if (event.type === type) total += 2 ** (-(now - event.at) / HALF_LIFE_MS);
  }
  return total;
}

export function addFollow(store, from, to) {
  const set = store.follows.get(from);
  if (!set) throw new Error(`unknown user: ${from}`);
  if (!store.follows.has(to)) throw new Error(`unknown user: ${to}`);
  const isNew = !set.has(to);
  set.add(to);
  if (isNew) recordInteraction(store, from, to, 'follow');
  return isNew;
}
