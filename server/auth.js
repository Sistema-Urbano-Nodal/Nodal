import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getUserById } from './db.js';

const scrypt = promisify(scryptCb);
const COOKIE = 'nodal_session';
const SESSION_DAYS = 7;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const fromB64 = (value) => Buffer.from(value, 'base64url');

export function validateEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 160;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password, encoded) {
  const parts = String(encoded || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltText, hashText] = parts;
  const expected = fromB64(hashText);
  const actual = await scrypt(password, fromB64(saltText), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function parseCookies(header = '') {
  const out = new Map();
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    try {
      out.set(part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim()));
    } catch {
      // Treat malformed cookie values as absent instead of failing the request.
    }
  }
  return out;
}

export function tokenHash(token) {
  return createHash('sha256').update(token).digest('base64url');
}

function cookieSecure(env = process.env) {
  return env.COOKIE_SECURE === 'true' || env.NODE_ENV === 'production';
}

export function sessionCookie(token, { env = process.env, maxAge = SESSION_DAYS * 24 * 60 * 60 } = {}) {
  const secure = cookieSecure(env) ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

export function clearSessionCookie(env = process.env) {
  return sessionCookie('', { env, maxAge: 0 });
}

export function createSession(db, userId, { env = process.env } = {}) {
  const token = b64(randomBytes(32));
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), userId, tokenHash(token), expiresAt);
  return { token, cookie: sessionCookie(token, { env }), expiresAt };
}

export function destroySession(db, req) {
  const token = parseCookies(req.headers.cookie).get(COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

export function getSessionUser(db, req) {
  const token = parseCookies(req.headers.cookie).get(COOKIE);
  if (!token) return null;
  const row = db.prepare(`
    SELECT user_id FROM sessions
    WHERE token_hash = ? AND expires_at > ?
  `).get(tokenHash(token), new Date().toISOString());
  if (!row) return null;
  const user = getUserById(db, row.user_id);
  if (!user || user.account_status !== 'active') return null;
  return user;
}
