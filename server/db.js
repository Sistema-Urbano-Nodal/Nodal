import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { recordInteraction } from './store.js';
import {
  decodeCatalogCursor,
  decodeCatalogInterestCursor,
  encodeCatalogCursor,
  encodeCatalogInterestCursor,
  isCatalogItemClosed,
  validateCatalogInterestMessage,
  validateCatalogDraft,
  validateCatalogPublication,
} from './catalog.js';
import {
  DEFAULT_INDICATORS,
  DEFAULT_PART_C,
  canApplyForMentor,
  cleanIndicators,
  cleanRequests,
  cleanTopics,
  normalizeIndicators,
  normalizePartC,
} from './profile-policy.js';

const ROOT = path.resolve(import.meta.dirname, '..');

const nowIso = () => new Date().toISOString();
const envInt = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const MAX_INTERACTION_EVENTS_PER_PAIR = envInt('MAX_INTERACTION_EVENTS_PER_PAIR', 50);

export function defaultDatabasePath(env = process.env) {
  if (env.NODE_ENV === 'production' && !env.DATABASE_PATH) {
    throw new Error('DATABASE_PATH is required in production');
  }
  return env.DATABASE_PATH || path.join(ROOT, 'data', 'nodal.sqlite');
}

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        account_status TEXT NOT NULL DEFAULT 'active',
        title TEXT NOT NULL DEFAULT '',
        city TEXT NOT NULL DEFAULT '',
        interests_json TEXT NOT NULL DEFAULT '[]',
        active_json TEXT NOT NULL DEFAULT '[]',
        linkedin TEXT NOT NULL DEFAULT '',
        topics_json TEXT NOT NULL DEFAULT '[]',
        skills_json TEXT NOT NULL DEFAULT '[]',
        indicators_json TEXT NOT NULL DEFAULT '{"leadership":"No","transmission":"No"}',
        part_c_json TEXT NOT NULL DEFAULT '{"bio":"","linkedin":"","portfolio":"","references":"","availability":"","consent":false}',
        requests_json TEXT NOT NULL DEFAULT '{}',
        mentor_applied INTEGER NOT NULL DEFAULT 0,
        assessed INTEGER NOT NULL DEFAULT 0,
        notif_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        CHECK (length(trim(full_name)) > 0),
        CHECK (role IN ('member', 'admin')),
        CHECK (account_status IN ('active', 'disabled', 'pending'))
      );

      CREATE UNIQUE INDEX users_email_unique_idx ON users(lower(email));
      CREATE INDEX users_status_idx ON users(account_status);

      CREATE TRIGGER users_updated_at
      AFTER UPDATE ON users
      FOR EACH ROW
      BEGIN
        UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
      END;

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX sessions_token_hash_idx ON sessions(token_hash);
      CREATE INDEX sessions_expires_idx ON sessions(expires_at);

      CREATE TABLE follows (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (user_id, target_user_id),
        CHECK (user_id <> target_user_id)
      );

      CREATE TABLE interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        CHECK (from_user_id <> to_user_id),
        CHECK (type IN ('view', 'like', 'skip', 'message', 'follow'))
      );
      CREATE INDEX interactions_pair_idx ON interactions(from_user_id, to_user_id, created_at);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stripe_customer_id TEXT NOT NULL DEFAULT '',
        stripe_subscription_id TEXT NOT NULL DEFAULT '',
        stripe_checkout_session_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        current_period_end TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        CHECK (status IN ('pending', 'active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'))
      );
      CREATE INDEX subscriptions_user_idx ON subscriptions(user_id);
      CREATE UNIQUE INDEX subscriptions_stripe_subscription_idx
        ON subscriptions(stripe_subscription_id)
        WHERE stripe_subscription_id <> '';
      CREATE UNIQUE INDEX subscriptions_checkout_session_idx
        ON subscriptions(stripe_checkout_session_id)
        WHERE stripe_checkout_session_id <> '';

      CREATE TRIGGER subscriptions_updated_at
      AFTER UPDATE ON subscriptions
      FOR EACH ROW
      BEGIN
        UPDATE subscriptions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = OLD.id;
      END;
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE subscriptions
        ADD COLUMN stripe_latest_event_created INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE stripe_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        event_created INTEGER NOT NULL DEFAULT 0,
        processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX stripe_events_type_idx ON stripe_events(type, event_created);
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE subscriptions
        ADD COLUMN stripe_latest_event_rank INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE subscriptions
        ADD COLUMN stripe_latest_event_id TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    /* Where a member's city actually is. Resolved by the server when the city
       changes and stored with the profile, so drawing the map needs no
       geocoder at read time. Never written from a request body: a client that
       could set these could drop its pin on any address it liked. */
    version: 5,
    sql: `
      ALTER TABLE users ADD COLUMN city_lat REAL;
      ALTER TABLE users ADD COLUMN city_lon REAL;
      ALTER TABLE users ADD COLUMN city_label TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    version: 6,
    sql: `
      CREATE TABLE catalog_items (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        subtype TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        visibility TEXT NOT NULL DEFAULT 'public',
        translations_json TEXT NOT NULL DEFAULT '{}',
        organization TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        topics_json TEXT NOT NULL DEFAULT '[]',
        starts_at TEXT,
        deadline_at TEXT,
        end_date TEXT,
        source_url TEXT NOT NULL DEFAULT '',
        source_verified_at TEXT,
        action_mode TEXT NOT NULL DEFAULT 'none',
        action_url TEXT NOT NULL DEFAULT '',
        featured INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        published_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        CHECK (kind IN ('opportunity', 'project', 'learning_circle', 'resource', 'case_study')),
        CHECK (subtype IS NULL OR subtype IN ('job', 'consulting', 'grant', 'open_call', 'fellowship', 'other')),
        CHECK (status IN ('draft', 'published', 'archived')),
        CHECK (visibility IN ('public', 'members')),
        CHECK (action_mode IN ('external', 'interest', 'none')),
        CHECK (featured IN (0, 1)),
        CHECK (version > 0)
      );
      CREATE INDEX catalog_items_listing_idx ON catalog_items(status, visibility, featured DESC, deadline_at ASC, published_at DESC, id ASC);
      CREATE INDEX catalog_items_created_by_idx ON catalog_items(created_by);
      CREATE INDEX catalog_items_updated_by_idx ON catalog_items(updated_by);
      CREATE INDEX catalog_items_published_by_idx ON catalog_items(published_by);

      CREATE TABLE catalog_interests (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'new',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (user_id, item_id),
        CHECK (status IN ('new', 'contacted', 'closed', 'withdrawn')),
        CHECK (version > 0),
        CHECK (length(message) <= 1000)
      );
      CREATE INDEX catalog_interests_item_id_idx ON catalog_interests(item_id);
      CREATE INDEX catalog_interests_user_id_idx ON catalog_interests(user_id, updated_at DESC, id ASC);
      CREATE INDEX catalog_interests_queue_idx ON catalog_interests(status, updated_at ASC, id ASC);
      CREATE INDEX catalog_interests_updated_by_idx ON catalog_interests(updated_by);
    `,
  },
  {
    version: 7,
    sql: `
      ALTER TABLE catalog_items
        ADD COLUMN source_label TEXT NOT NULL DEFAULT '';
    `,
  },
];

function runMigrations(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, nowIso());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export function createDatabase({ filename = defaultDatabasePath(), migrate = true } = {}) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  if (migrate) runMigrations(db);
  return db;
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

const json = (value) => JSON.stringify(value ?? null);

function isDirectoryVisible(row) {
  return normalizePartC(parseJson(row.part_c_json, DEFAULT_PART_C)).consent === true;
}

export function toApiUser(row) {
  if (!row) return null;
  const topics = parseJson(row.topics_json, []);
  const interests = parseJson(row.interests_json, []);
  const partC = normalizePartC(parseJson(row.part_c_json, DEFAULT_PART_C));
  const linkedin = partC.linkedin || row.linkedin || '';
  return {
    id: row.id,
    fullName: row.full_name,
    name: row.full_name,
    email: row.email,
    permission: row.role,
    accountStatus: row.account_status,
    role: row.title || 'Member',
    title: row.title || 'Member',
    city: row.city,
    interests,
    active: parseJson(row.active_json, []),
    linkedin,
    topics,
    skills: parseJson(row.skills_json, []),
    indicators: normalizeIndicators(parseJson(row.indicators_json, DEFAULT_INDICATORS)),
    partC,
    requests: parseJson(row.requests_json, {}),
    mentorApplied: Boolean(row.mentor_applied),
    assessed: Boolean(row.assessed),
    notifRead: Boolean(row.notif_read),
    createdAt: row.created_at,
    location: Number.isFinite(row.city_lat) && Number.isFinite(row.city_lon)
      ? { lat: row.city_lat, lon: row.city_lon, label: row.city_label || row.city }
      : null,
    updatedAt: row.updated_at,
  };
}

function toGraphUser(row) {
  const user = toApiUser(row);
  if (!user) return null;
  const topicInterests = user.topics.map((t) => String(t.name || t).toLowerCase()).filter(Boolean);
  return {
    id: user.id,
    name: user.fullName,
    role: user.title,
    city: user.city,
    interests: user.interests.length ? user.interests : topicInterests,
    active: user.active,
    linkedin: user.linkedin,
  };
}

export function getUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function getUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email);
}

export function createUser(db, { fullName, email, passwordHash, role = 'member', title = '', city = '' }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO users (
      id, full_name, email, password_hash, role, title, city,
      indicators_json, part_c_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    fullName.trim(),
    email.trim().toLowerCase(),
    passwordHash,
    role,
    title.trim(),
    city.trim(),
    json(DEFAULT_INDICATORS),
    json(DEFAULT_PART_C),
  );
  return getUserById(db, id);
}

export function updateUserProfile(db, id, patch) {
  const current = toApiUser(getUserById(db, id));
  if (!current) return null;
  const nextPartC = 'partC' in patch ? normalizePartC(patch.partC, current.partC) : current.partC;
  const nextTopics = 'topics' in patch ? cleanTopics(patch.topics, current.topics) : current.topics;
  const nextIndicators = 'indicators' in patch ? cleanIndicators(patch.indicators) : current.indicators;
  const nextAssessed = 'assessed' in patch ? Boolean(patch.assessed) : current.assessed;
  const canApplyMentor = canApplyForMentor({
    assessed: nextAssessed,
    topics: nextTopics,
    indicators: nextIndicators,
  });
  const allowed = {
    fullName: ['full_name', (v) => String(v).trim().slice(0, 80)],
    title: ['title', (v) => String(v).trim().slice(0, 80)],
    city: ['city', (v) => String(v).trim().slice(0, 60)],
    interests: ['interests_json', (v) => json(Array.isArray(v) ? v.map(String).slice(0, 12) : [])],
    active: ['active_json', (v) => json(Array.isArray(v) ? v.map(String).slice(0, 6) : [])],
    linkedin: ['linkedin', (v) => String(v || '').trim().slice(0, 220)],
    topics: ['topics_json', () => json(nextTopics)],
    skills: ['skills_json', (v) => json(Array.isArray(v) ? v.slice(0, 12) : [])],
    indicators: ['indicators_json', () => json(nextIndicators)],
    partC: ['part_c_json', () => json(nextPartC)],
    requests: ['requests_json', (v) => json(cleanRequests(v, current.requests, nextPartC))],
    mentorApplied: ['mentor_applied', (v) => (current.mentorApplied || (v && canApplyMentor) ? 1 : 0)],
    assessed: ['assessed', (v) => (v ? 1 : 0)],
    notifRead: ['notif_read', (v) => (v ? 1 : 0)],
  };
  const assignments = [];
  const values = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in allowed)) continue;
    const [column, clean] = allowed[key];
    assignments.push(`${column} = ?`);
    values.push(clean(value));
  }
  if (!assignments.length) return getUserById(db, id);
  values.push(id);
  db.prepare(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
  return getUserById(db, id);
}

function listActiveUsers(db) {
  return db.prepare("SELECT * FROM users WHERE account_status = 'active' ORDER BY created_at ASC").all();
}

/* Deliberately separate from updateUserProfile, whose allow-list is driven by
   the request body. Only server-resolved coordinates ever land here. */
export function setUserLocation(db, id, point) {
  db.prepare('UPDATE users SET city_lat = ?, city_lon = ?, city_label = ? WHERE id = ?')
    .run(point?.lat ?? null, point?.lon ?? null, point?.label ?? '', id);
  return getUserById(db, id);
}

export function listDirectoryUsers(db) {
  return listActiveUsers(db).filter(isDirectoryVisible);
}

export function loadGraphStore(db, { viewerId } = {}) {
  const rows = listActiveUsers(db).filter((row) => row.id === viewerId || isDirectoryVisible(row));
  const users = new Map(rows.map((row) => [row.id, toGraphUser(row)]));
  const follows = new Map([...users.keys()].map((id) => [id, new Set()]));
  for (const row of db.prepare('SELECT user_id, target_user_id FROM follows').all()) {
    if (follows.has(row.user_id) && users.has(row.target_user_id)) {
      follows.get(row.user_id).add(row.target_user_id);
    }
  }
  const store = { users, follows, engagement: new Map() };
  for (const row of db.prepare('SELECT from_user_id, to_user_id, type, created_at FROM interactions ORDER BY created_at ASC').all()) {
    if (!users.has(row.from_user_id) || !users.has(row.to_user_id)) continue;
    recordInteraction(store, row.from_user_id, row.to_user_id, row.type, Date.parse(row.created_at));
  }
  return store;
}

export function addFollowDb(db, from, to) {
  const before = db.prepare('SELECT 1 FROM follows WHERE user_id = ? AND target_user_id = ?').get(from, to);
  db.prepare('INSERT OR IGNORE INTO follows (user_id, target_user_id) VALUES (?, ?)').run(from, to);
  if (!before) recordInteractionDb(db, from, to, 'follow');
  return !before;
}

export function recordInteractionDb(db, from, to, type) {
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO interactions (from_user_id, to_user_id, type, created_at) VALUES (?, ?, ?, ?)')
      .run(from, to, type, nowIso());
    db.prepare(`
      DELETE FROM interactions
      WHERE id IN (
        SELECT id
        FROM interactions
        WHERE from_user_id = ? AND to_user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT -1 OFFSET ?
      )
    `).run(from, to, MAX_INTERACTION_EVENTS_PER_PAIR);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function deleteExpiredSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
}

function cleanSubscriptionStatus(value) {
  const status = String(value || 'pending');
  return ['pending', 'active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'].includes(status)
    ? status
    : 'pending';
}

function subscriptionToApi(row) {
  if (!row) return { status: 'none', active: false };
  const active = ['active', 'trialing'].includes(row.status);
  return {
    status: row.status,
    active,
    currentPeriodEnd: row.current_period_end || null,
    updatedAt: row.updated_at,
  };
}

function getSubscriptionByUserId(db, userId) {
  return db.prepare(`
    SELECT * FROM subscriptions
    WHERE user_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(userId);
}

export function getSubscriptionStatus(db, userId) {
  return subscriptionToApi(getSubscriptionByUserId(db, userId));
}

function catalogItemFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    subtype: row.subtype,
    status: row.status,
    visibility: row.visibility,
    translations: parseJson(row.translations_json, {}),
    organization: row.organization,
    location: row.location,
    topics: parseJson(row.topics_json, []),
    startsAt: row.starts_at,
    deadlineAt: row.deadline_at,
    endDate: row.end_date,
    sourceLabel: row.source_label,
    sourceUrl: row.source_url,
    sourceVerifiedAt: row.source_verified_at,
    actionMode: row.action_mode,
    actionUrl: row.action_url,
    featured: Boolean(row.featured),
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    publishedBy: row.published_by,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function catalogInterestFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    itemId: row.item_id,
    userId: row.user_id,
    message: row.message,
    status: row.status,
    version: row.version,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function interestSortTuple(interest) {
  return [interest.updatedAt, interest.id];
}

function compareInterestTuples(left, right, direction) {
  if (left[0] !== right[0]) {
    const ascending = left[0] < right[0] ? -1 : 1;
    return direction === 'desc' ? -ascending : ascending;
  }
  if (left[1] === right[1]) return 0;
  return left[1] < right[1] ? -1 : 1;
}

function attachCatalogItems(db, interests) {
  if (!interests.length) return interests;
  const itemIds = [...new Set(interests.map((interest) => interest.itemId))];
  const placeholders = itemIds.map(() => '?').join(', ');
  const items = new Map(db.prepare(`SELECT * FROM catalog_items WHERE id IN (${placeholders})`).all(...itemIds)
    .map(catalogItemFromRow).map((item) => [item.id, item]));
  return interests.map((interest) => ({ ...interest, item: items.get(interest.itemId) || null }));
}

function catalogSortTuple(item) {
  return [item.featured ? 1 : 0, item.deadlineAt || '\uffff', item.publishedAt || '', item.id];
}

function compareCatalogTuples(left, right) {
  if (left[0] !== right[0]) return right[0] - left[0];
  for (let index = 1; index < left.length; index += 1) {
    if (left[index] === right[index]) continue;
    if (index === 2) return left[index] > right[index] ? -1 : 1;
    return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function visibleCatalogItem(item, viewer) {
  if (viewer?.permission === 'admin') return true;
  if (item.status !== 'published') return false;
  return item.visibility === 'public' || Boolean(viewer?.id);
}

function matchesCatalogQuery(item, query = {}) {
  if (query.status && item.status !== String(query.status).trim()) return false;
  const kinds = String(query.kind || '').split(',').map((part) => part.trim()).filter(Boolean);
  if (kinds.length && !kinds.includes(item.kind)) return false;
  if (query.subtype && item.subtype !== query.subtype) return false;
  if (query.topic && !item.topics.some((topic) => topic.toLowerCase() === String(query.topic).trim().toLowerCase())) return false;
  if (query.location && !item.location.toLowerCase().includes(String(query.location).trim().toLowerCase())) return false;
  if (query.featured !== undefined && String(query.featured) !== String(item.featured)) return false;
  if (query.state !== 'all' && isCatalogItemClosed(item)) return false;
  if (query.q) {
    const term = String(query.q).trim().toLowerCase();
    const text = [
      ...Object.values(item.translations).flatMap((translation) => [translation.title, translation.summary, translation.body]),
      item.organization,
      item.location,
      ...item.topics,
    ].join(' ').toLowerCase();
    if (term && !text.includes(term)) return false;
  }
  return true;
}

function catalogConflict() {
  return Object.assign(new Error('catalog item changed by another editor'), { code: 'CATALOG_VERSION_CONFLICT', status: 409 });
}

function writeCatalogItem(db, id, input, actorId, current = null) {
  const item = input.status === 'published' ? validateCatalogPublication(input) : validateCatalogDraft(input);
  const now = nowIso();
  const publishing = item.status === 'published' && current?.status !== 'published';
  const publishedAt = publishing ? now : (current?.published_at || null);
  const publishedBy = publishing ? actorId : (current?.published_by || null);
  if (!current) {
    db.prepare(`
      INSERT INTO catalog_items (
        id, kind, subtype, status, visibility, translations_json, organization, location, topics_json,
        starts_at, deadline_at, end_date, source_label, source_url, source_verified_at, action_mode, action_url, featured,
        version, created_by, updated_by, published_by, published_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
    `).run(
      id, item.kind, item.subtype, item.status, item.visibility, json(item.translations), item.organization, item.location, json(item.topics),
      item.startsAt, item.deadlineAt, item.endDate, item.sourceLabel, item.sourceUrl, item.sourceVerifiedAt, item.actionMode, item.actionUrl, Number(item.featured),
      actorId, actorId, publishedBy, publishedAt, now, now,
    );
    return catalogItemFromRow(db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(id));
  }
  const result = db.prepare(`
    UPDATE catalog_items SET
      kind = ?, subtype = ?, status = ?, visibility = ?, translations_json = ?, organization = ?, location = ?, topics_json = ?,
      starts_at = ?, deadline_at = ?, end_date = ?, source_label = ?, source_url = ?, source_verified_at = ?, action_mode = ?, action_url = ?, featured = ?,
      version = version + 1, updated_by = ?, published_by = ?, published_at = ?, updated_at = ?
    WHERE id = ? AND version = ?
  `).run(
    item.kind, item.subtype, item.status, item.visibility, json(item.translations), item.organization, item.location, json(item.topics),
    item.startsAt, item.deadlineAt, item.endDate, item.sourceLabel, item.sourceUrl, item.sourceVerifiedAt, item.actionMode, item.actionUrl, Number(item.featured),
    actorId, publishedBy, publishedAt, now, id, current.version,
  );
  if (!result.changes) throw catalogConflict();
  return catalogItemFromRow(db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(id));
}

export function createCatalogItem(db, input, actorId) {
  return writeCatalogItem(db, randomUUID(), input, actorId);
}

export function updateCatalogItem(db, id, input, version, actorId) {
  const current = db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(id);
  if (!current) return null;
  if (Number(version) !== current.version) throw catalogConflict();
  db.exec('BEGIN');
  try {
    const updated = writeCatalogItem(db, id, input, actorId, current);
    db.exec('COMMIT');
    return updated;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function listCatalogItems(db, query = {}, viewer = null) {
  const cursor = query.cursor ? decodeCatalogCursor(query.cursor) : null;
  const limit = Math.min(Math.max(Number(query.limit) || 24, 1), 24);
  const items = db.prepare('SELECT * FROM catalog_items').all()
    .map(catalogItemFromRow)
    .filter((item) => visibleCatalogItem(item, viewer))
    .filter((item) => matchesCatalogQuery(item, query))
    .sort((left, right) => compareCatalogTuples(catalogSortTuple(left), catalogSortTuple(right)))
    .filter((item) => !cursor || compareCatalogTuples(catalogSortTuple(item), cursor) > 0);
  const page = items.slice(0, limit);
  return { items: page, nextCursor: items.length > page.length ? encodeCatalogCursor(catalogSortTuple(page.at(-1))) : null };
}

export function getCatalogItem(db, id, viewer = null) {
  const item = catalogItemFromRow(db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(id));
  return item && visibleCatalogItem(item, viewer) ? item : null;
}

export function upsertCatalogInterest(db, itemId, userId, message) {
  const item = getCatalogItem(db, itemId, { id: userId, permission: 'member' });
  if (!item || item.actionMode !== 'interest') throw Object.assign(new Error('catalog item does not accept interest'), { status: 404 });
  const cleanMessage = validateCatalogInterestMessage(message);
  const existing = db.prepare('SELECT * FROM catalog_interests WHERE item_id = ? AND user_id = ?').get(itemId, userId);
  if (existing?.status === 'new' && existing.message === cleanMessage) return catalogInterestFromRow(existing);
  const now = nowIso();
  db.exec('BEGIN');
  try {
    if (existing) {
      db.prepare('UPDATE catalog_interests SET message = ?, status = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?')
        .run(cleanMessage, 'new', now, userId, existing.id);
    } else {
      db.prepare('INSERT INTO catalog_interests (id, item_id, user_id, message, status, version, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)')
        .run(randomUUID(), itemId, userId, cleanMessage, 'new', now, now, userId);
    }
    const result = catalogInterestFromRow(db.prepare('SELECT * FROM catalog_interests WHERE item_id = ? AND user_id = ?').get(itemId, userId));
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function withdrawCatalogInterest(db, itemId, userId) {
  const existing = db.prepare('SELECT status FROM catalog_interests WHERE item_id = ? AND user_id = ?').get(itemId, userId);
  if (!existing) return false;
  if (existing.status === 'withdrawn') return true;
  const result = db.prepare('UPDATE catalog_interests SET status = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE item_id = ? AND user_id = ?')
    .run('withdrawn', nowIso(), userId, itemId, userId);
  return result.changes > 0;
}

export function getCatalogInterest(db, itemId, userId) {
  return catalogInterestFromRow(db.prepare('SELECT * FROM catalog_interests WHERE item_id = ? AND user_id = ?').get(itemId, userId));
}

export function getCatalogInterestById(db, id) {
  return catalogInterestFromRow(db.prepare('SELECT * FROM catalog_interests WHERE id = ?').get(id));
}

export function listCatalogInterestsForUser(db, userId, query = {}) {
  const cursor = query.cursor ? decodeCatalogInterestCursor(query.cursor) : null;
  const limit = Math.min(Math.max(Number(query.limit) || 24, 1), 24);
  const rows = db.prepare('SELECT * FROM catalog_interests WHERE user_id = ?').all(userId).map(catalogInterestFromRow)
    .sort((left, right) => compareInterestTuples(interestSortTuple(left), interestSortTuple(right), 'desc'))
    .filter((interest) => !cursor || compareInterestTuples(interestSortTuple(interest), cursor, 'desc') > 0);
  const page = rows.slice(0, limit);
  return {
    interests: attachCatalogItems(db, page),
    nextCursor: rows.length > page.length ? encodeCatalogInterestCursor(interestSortTuple(page.at(-1))) : null,
  };
}

export function listAdminInterests(db, query = {}) {
  const cursor = query.cursor ? decodeCatalogInterestCursor(query.cursor) : null;
  const limit = Math.min(Math.max(Number(query.limit) || 24, 1), 24);
  const values = [];
  let where = '';
  if (query.status) { where = 'WHERE status = ?'; values.push(String(query.status)); }
  const rows = db.prepare(`SELECT * FROM catalog_interests ${where}`).all(...values).map(catalogInterestFromRow)
    .sort((left, right) => compareInterestTuples(interestSortTuple(left), interestSortTuple(right), 'asc'))
    .filter((interest) => !cursor || compareInterestTuples(interestSortTuple(interest), cursor, 'asc') > 0);
  const page = rows.slice(0, limit);
  return {
    interests: attachCatalogItems(db, page),
    nextCursor: rows.length > page.length ? encodeCatalogInterestCursor(interestSortTuple(page.at(-1))) : null,
  };
}

export function updateCatalogInterest(db, id, patch = {}, version, actorId) {
  const current = db.prepare('SELECT * FROM catalog_interests WHERE id = ?').get(id);
  if (!current) return null;
  if (Number(version) !== current.version) throw catalogConflict();
  const status = patch.status === undefined ? current.status : String(patch.status).trim();
  if (!['new', 'contacted', 'closed', 'withdrawn'].includes(status)) throw new Error('interest status is invalid');
  const result = db.prepare('UPDATE catalog_interests SET status = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND version = ?')
    .run(status, nowIso(), actorId, id, current.version);
  if (!result.changes) throw catalogConflict();
  return catalogInterestFromRow(db.prepare('SELECT * FROM catalog_interests WHERE id = ?').get(id));
}

export function exportUserData(db, userId) {
  const row = getUserById(db, userId);
  if (!row) return null;
  return {
    exportedAt: nowIso(),
    user: toApiUser(row),
    follows: db.prepare('SELECT target_user_id AS targetUserId, created_at AS createdAt FROM follows WHERE user_id = ? ORDER BY created_at ASC').all(userId),
    followers: db.prepare('SELECT user_id AS userId, created_at AS createdAt FROM follows WHERE target_user_id = ? ORDER BY created_at ASC').all(userId),
    interactions: db.prepare(`
      SELECT to_user_id AS toUserId, type, created_at AS createdAt
      FROM interactions
      WHERE from_user_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(userId),
    catalogInterests: db.prepare(`
      SELECT id, item_id AS itemId, message, status, version, created_at AS createdAt, updated_at AS updatedAt
      FROM catalog_interests WHERE user_id = ? ORDER BY created_at ASC, id ASC
    `).all(userId),
    subscription: getSubscriptionStatus(db, userId),
  };
}

export function deleteUserById(db, userId) {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return result.changes > 0;
}

function getSubscriptionByStripeId(db, stripeSubscriptionId) {
  if (!stripeSubscriptionId) return null;
  return db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?').get(stripeSubscriptionId);
}

function stripeEventIsNewer(row, { eventCreated, eventRank, eventId }) {
  const current = [
    Number(row.stripe_latest_event_created) || 0,
    Number(row.stripe_latest_event_rank) || 0,
    String(row.stripe_latest_event_id || ''),
  ];
  const incoming = [Number(eventCreated) || 0, Number(eventRank) || 0, String(eventId || '')];
  for (let index = 0; index < current.length; index += 1) {
    if (incoming[index] === current[index]) continue;
    return incoming[index] > current[index];
  }
  return false;
}

export function applyStripeEvent(db, {
  eventId,
  eventType,
  eventCreated = 0,
  eventRank = 0,
  userId = null,
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  stripeCheckoutSessionId = null,
  status = 'pending',
  currentPeriodEnd = null,
}) {
  const cleanEventId = String(eventId || '').trim().slice(0, 120);
  if (!cleanEventId) throw new Error('Stripe event id is required');
  const duplicate = db.prepare('SELECT 1 FROM stripe_events WHERE id = ?').get(cleanEventId);
  if (duplicate) return userId ? getSubscriptionStatus(db, userId) : null;

  db.exec('BEGIN');
  try {
    const subscriptionId = String(stripeSubscriptionId || '').trim();
    const checkoutId = String(stripeCheckoutSessionId || '').trim();
    const cleanUserId = String(userId || '').trim();
    const existing = (subscriptionId && getSubscriptionByStripeId(db, subscriptionId))
      || (checkoutId && db.prepare('SELECT * FROM subscriptions WHERE stripe_checkout_session_id = ?').get(checkoutId))
      || (cleanUserId && getSubscriptionByUserId(db, cleanUserId));
    const finalUserId = existing?.user_id || cleanUserId;
    const incoming = {
      eventCreated: Number(eventCreated) || 0,
      eventRank: Number(eventRank) || 0,
      eventId: cleanEventId,
    };

    if (finalUserId && (!existing || stripeEventIsNewer(existing, incoming))) {
      if (existing) {
        db.prepare(`
          UPDATE subscriptions
          SET user_id = ?, stripe_customer_id = ?, stripe_subscription_id = ?,
              stripe_checkout_session_id = ?, status = ?, current_period_end = ?,
              stripe_latest_event_created = ?, stripe_latest_event_rank = ?,
              stripe_latest_event_id = ?
          WHERE id = ?
        `).run(
          finalUserId,
          String(stripeCustomerId || existing.stripe_customer_id || ''),
          String(stripeSubscriptionId || existing.stripe_subscription_id || ''),
          String(stripeCheckoutSessionId || existing.stripe_checkout_session_id || ''),
          cleanSubscriptionStatus(status),
          String(currentPeriodEnd || existing.current_period_end || ''),
          incoming.eventCreated,
          incoming.eventRank,
          incoming.eventId,
          existing.id,
        );
      } else {
        db.prepare(`
          INSERT INTO subscriptions (
            id, user_id, stripe_customer_id, stripe_subscription_id,
            stripe_checkout_session_id, status, current_period_end,
            stripe_latest_event_created, stripe_latest_event_rank, stripe_latest_event_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          randomUUID(),
          finalUserId,
          String(stripeCustomerId || ''),
          subscriptionId,
          checkoutId,
          cleanSubscriptionStatus(status),
          String(currentPeriodEnd || ''),
          incoming.eventCreated,
          incoming.eventRank,
          incoming.eventId,
        );
      }
    }

    db.prepare('INSERT INTO stripe_events (id, type, event_created) VALUES (?, ?, ?)')
      .run(cleanEventId, String(eventType || 'unknown').slice(0, 120), incoming.eventCreated);
    db.exec('COMMIT');
    return finalUserId ? getSubscriptionStatus(db, finalUserId) : null;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
