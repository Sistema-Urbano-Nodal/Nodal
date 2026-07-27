import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { recordInteraction } from './store.js';
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
