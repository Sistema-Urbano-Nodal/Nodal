import {
  addFollowDb,
  applyStripeEvent,
  createDatabase,
  createUser,
  deleteExpiredSessions,
  deleteUserById,
  exportUserData,
  getSubscriptionStatus,
  getUserByEmail,
  getUserById,
  listDirectoryUsers,
  setUserLocation,
  loadGraphStore,
  recordInteractionDb,
  toApiUser,
  updateUserProfile,
} from './db.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionUser,
  hashPassword,
  verifyPassword,
} from './auth.js';
import { createSupabaseRepository, dataBackend } from './supabase.js';

function createSqliteRepository(db, { ownsDb = false } = {}) {
  return {
    kind: 'sqlite',
    database: db,
    cleanupExpiredSessions() {
      deleteExpiredSessions(db);
    },
    async resolveSession(req) {
      return { user: getSessionUser(db, req), cookies: [] };
    },
    async signup({ fullName, email, password, env = process.env }) {
      if (getUserByEmail(db, email)) {
        return { status: 409, error: 'signup could not be completed', cookies: [] };
      }
      const user = createUser(db, { fullName, email, passwordHash: await hashPassword(password) });
      const session = createSession(db, user.id, { env });
      return { status: 201, user: toApiUser(user), cookies: [session.cookie] };
    },
    async login({ email, password, env = process.env }) {
      const user = getUserByEmail(db, email);
      if (!user || user.account_status !== 'active' || !(await verifyPassword(password, user.password_hash))) {
        return { status: 401, error: 'invalid email or password', cookies: [] };
      }
      const session = createSession(db, user.id, { env });
      return { status: 200, user: toApiUser(user), cookies: [session.cookie] };
    },
    async logout(req, env = process.env) {
      destroySession(db, req);
      return { status: 200, cookies: [clearSessionCookie(env)] };
    },
    toApiUser,
    async getUserById(id) {
      return getUserById(db, id);
    },
    async updateUserProfile(id, patch) {
      return updateUserProfile(db, id, patch);
    },
    async setUserLocation(id, point) {
      return setUserLocation(db, id, point);
    },
    async listDirectoryUsers() {
      return listDirectoryUsers(db);
    },
    async loadGraphStore({ viewerId } = {}) {
      return loadGraphStore(db, { viewerId });
    },
    async addFollow(from, to) {
      return addFollowDb(db, from, to);
    },
    async recordInteraction(from, to, type) {
      return recordInteractionDb(db, from, to, type);
    },
    async exportUserData(userId) {
      return exportUserData(db, userId);
    },
    async deleteUserById(userId) {
      return deleteUserById(db, userId);
    },
    async getSubscriptionStatus(userId) {
      return getSubscriptionStatus(db, userId);
    },
    async applyStripeEvent(args) {
      return applyStripeEvent(db, args);
    },
    close() {
      if (ownsDb) db.close();
    },
  };
}

export function createRepository({ db, store, env = process.env, fetchImpl = fetch } = {}) {
  if (db) return createSqliteRepository(db, { ownsDb: false });
  if (store) return null;
  if (dataBackend(env) === 'supabase') return createSupabaseRepository({ env, fetchImpl });
  return createSqliteRepository(createDatabase(), { ownsDb: true });
}
