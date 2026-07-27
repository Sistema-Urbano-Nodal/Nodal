/* NODAL server: static site + authenticated API.
   Zero dependencies — run with `node server/server.js` (PORT, DATABASE_PATH, REDIS_URL optional). */

import http from 'node:http';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { addFollow, recordInteraction } from './store.js';
import { recommend } from './engine.js';
import { createCache, MemoryCache } from './cache.js';
import {
  paymentsConfig, createCheckoutSession, verifyStripeWebhook, CYCLES,
} from './payments.js';
import { validateEmail, validatePassword } from './auth.js';
import { createRepository } from './repository.js';
import { dataBackend, resolveSupabaseEnv } from './supabase.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const WEB_ROOT = path.join(ROOT, 'web');
const envInt = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const REC_TTL_MS = 5 * 60 * 1000;                 // 5-minute cache, per spec
const ID_RE = /^[a-z0-9-]{1,40}$/;
const API_INTERACTION_TYPES = new Set(['skip']);
const MAX_BODY = 32 * 1024;
const PRIVATE_PAGES = new Set(['/dashboard.html', '/profile.html', '/payments.html']);
const STATIC_PAGES = new Set(['index.html', 'login.html', 'dashboard.html', 'profile.html', 'payments.html']);
const STATIC_SCRIPTS = new Set(['app.js', 'auth.js', 'coastline.js', 'dashboard.js', 'globe.js', 'i18n.js', 'nav.js', 'payments.js', 'profile.js', 'recs.js', 'script.js']);
const STATIC_STYLES = new Set(['styles.css', 'dashboard.css']);
const STATIC_ASSETS = new Set(['latam-map.webp', 'nodal-community.webp', 'nodal-wordmark.webp']);
const AUTH_RATE_WINDOW_MS = 5 * 60 * 1000;
const AUTH_RATE_LIMIT = envInt('AUTH_RATE_LIMIT', 10);
const INTERACTION_RATE_WINDOW_MS = 60 * 1000;
const INTERACTION_RATE_LIMIT = envInt('INTERACTION_RATE_LIMIT', 60);
const CITY_SEARCH_MIN_QUERY = 2;
const MEMBER_SEARCH_MIN_QUERY = 2;
const MEMBER_SEARCH_LIMIT = 8;
const MEMBER_SEARCH_WINDOW_MS = 60 * 1000;
const MEMBER_SEARCH_RATE_LIMIT = envInt('MEMBER_SEARCH_RATE_LIMIT', 40);
const PLACE_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // a city does not move
/* Only the geocoding is expensive, and that is cached for a month. The roll-up
   is cached just long enough to absorb a burst of polls without putting an
   arrival behind a wall — a new member must not wait half a minute to appear. */
const NETWORK_TTL_MS = 3 * 1000;
const CITY_SEARCH_MAX_QUERY = 80;
const CITY_SEARCH_LIMIT = envInt('CITY_SEARCH_LIMIT', 8);
const CITY_SEARCH_CACHE_MS = 24 * 60 * 60 * 1000;
const CITY_SEARCH_MIN_INTERVAL_MS = envInt('CITY_SEARCH_MIN_INTERVAL_MS', 1000);
const CITY_SEARCH_BASE_URL = process.env.CITY_SEARCH_URL || 'https://geodb-free-service.wirefreethought.com/v1/geo/cities';
const CITY_SEARCH_ATTRIBUTION = 'GeoDB Cities';
const STATIC_CACHE_CONTROL = 'public, max-age=3600, stale-while-revalidate=86400';
const CITY_ADDRESS_KEYS = ['city', 'town', 'village', 'municipality', 'hamlet', 'county', 'city_district'];
const BASE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function securityHeaders(headers = {}) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Origin-Agent-Cluster': '?1',
    ...headers,
  };
  if (process.env.NODE_ENV === 'production') {
    h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  return h;
}

function contentSecurityPolicy(env = process.env) {
  const directives = [...BASE_CSP];
  if (env.NODE_ENV === 'production') directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

function htmlSecurityHeaders(headers = {}) {
  return securityHeaders({ 'Content-Security-Policy': contentSecurityPolicy(), ...headers });
}

function safeNext(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/dashboard.html';
  if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return '/dashboard.html';
  try {
    const parsed = new URL(value, 'https://nodal.local');
    if (parsed.origin !== 'https://nodal.local') return '/dashboard.html';
    const normalized = path.posix.normalize(parsed.pathname);
    if (!normalized.startsWith('/') || normalized.startsWith('//')) return '/dashboard.html';
    return `${normalized}${parsed.search}${parsed.hash}`;
  } catch {
    return '/dashboard.html';
  }
}

function canonicalPathname(pathname) {
  try {
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes('\0')) return null;
    const normalized = path.posix.normalize(decoded);
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  } catch {
    return null;
  }
}

function createWindowRateLimiter({ windowMs, limit }) {
  const buckets = new Map();
  return {
    take(key, now = Date.now()) {
      const bucket = buckets.get(key);
      if (!bucket || now >= bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true, retryAfter: 0 };
      }
      if (bucket.count >= limit) {
        return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
      }
      bucket.count += 1;
      return { ok: true, retryAfter: 0 };
    },
  };
}

function clientIp(req) {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (forwarded) return forwarded.slice(0, 80);
  }
  return req.socket.remoteAddress || 'unknown';
}

function publicBaseUrl(env = process.env) {
  const vercelUrl = String(env.VERCEL_URL ?? '').trim();
  const configured = env.PUBLIC_BASE_URL || env.NEXT_PUBLIC_APP_URL || (vercelUrl ? `https://${vercelUrl}` : '');
  if (!configured) {
    throw Object.assign(new Error('public base URL is required when payments are configured'), { status: 500 });
  }
  try {
    const url = new URL(configured);
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (!url.hostname || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))) {
      throw new Error('invalid base URL');
    }
    return url.origin;
  } catch {
    throw Object.assign(new Error('public base URL is invalid'), { status: 500 });
  }
}

function readRequiredEnv(env, key, { productionRequired = false } = {}) {
  const value = String(env[key] ?? '').trim();
  if (!value && productionRequired) throw new Error(`${key} is required in production`);
  return value;
}

/* Shown wherever a price would go while launch pricing is not announced yet.
   A period ("/ month") is only meaningful next to a real amount, so the
   period is suppressed until a price label is actually configured. */
const PRICE_UNANNOUNCED = 'Soon';

export function publicBillingConfig(env = process.env) {
  const productionRequired = env.NODE_ENV === 'production';
  const monthlyAmount = readRequiredEnv(env, 'SUBSCRIPTION_PRICE_MONTHLY_LABEL', { productionRequired });
  const annualAmount = readRequiredEnv(env, 'SUBSCRIPTION_PRICE_ANNUAL_LABEL', { productionRequired });
  return {
    cycles: {
      monthly: {
        label: env.SUBSCRIPTION_MONTHLY_LABEL || 'Monthly',
        amount: monthlyAmount || PRICE_UNANNOUNCED,
        per: monthlyAmount ? (env.SUBSCRIPTION_MONTHLY_PERIOD || '') : '',
        note: env.SUBSCRIPTION_MONTHLY_NOTE || 'Cancel anytime.',
        renews: env.SUBSCRIPTION_MONTHLY_RENEWS || 'Every month, until you cancel',
        badge: env.SUBSCRIPTION_MONTHLY_BADGE || '',
      },
      annual: {
        label: env.SUBSCRIPTION_ANNUAL_LABEL || 'Annual',
        amount: annualAmount || PRICE_UNANNOUNCED,
        per: annualAmount ? (env.SUBSCRIPTION_ANNUAL_PERIOD || '') : '',
        note: env.SUBSCRIPTION_ANNUAL_NOTE || '',
        renews: env.SUBSCRIPTION_ANNUAL_RENEWS || 'Every 12 months, until you cancel',
        badge: env.SUBSCRIPTION_ANNUAL_BADGE || '',
      },
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safeErrorMessage = (err) => (err instanceof Error ? err.message : String(err || 'unknown error'));

function cleanCityQuery(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, CITY_SEARCH_MAX_QUERY);
}

function cityNameFromAddress(address = {}, fallback = '') {
  for (const key of CITY_ADDRESS_KEYS) {
    const value = String(address[key] || '').trim();
    if (value) return value;
  }
  return String(fallback || '').trim();
}

function cityResultFromPlace(place) {
  if (place?.city || (place?.name && place?.countryCode)) {
    const name = String(place.city || place.name || '').trim();
    if (!name) return null;
    const region = String(place.region || '').trim();
    const country = String(place.country || '').trim();
    const label = [...new Set([name, region, country].filter(Boolean))].join(', ');
    return {
      name,
      label: label || name,
      region,
      country,
      countryCode: String(place.countryCode || '').toUpperCase(),
      lat: Number(place.latitude) || null,
      lon: Number(place.longitude) || null,
      source: 'geodb',
    };
  }

  const address = place?.address || {};
  const name = cityNameFromAddress(address, place?.name);
  if (!name) return null;
  const region = String(address.state || address.region || address.county || '').trim();
  const country = String(address.country || '').trim();
  const label = [...new Set([name, region, country].filter(Boolean))].join(', ');
  return {
    name,
    label: label || name,
    region,
    country,
    countryCode: String(address.country_code || '').toUpperCase(),
    lat: Number(place.lat) || null,
    lon: Number(place.lon) || null,
    source: 'openstreetmap',
  };
}

export function createCitySearch({
  fetchImpl = fetch,
  baseUrl = CITY_SEARCH_BASE_URL,
  minIntervalMs = CITY_SEARCH_MIN_INTERVAL_MS,
  now = Date.now,
  wait = sleep,
  env = process.env,
} = {}) {
  const cache = new Map();
  let lastRequestAt = 0;
  return {
    async search(query, acceptLanguage = '') {
      const q = cleanCityQuery(query);
      if (q.length < CITY_SEARCH_MIN_QUERY) return { cities: [], attribution: CITY_SEARCH_ATTRIBUTION };
      const lang = String(acceptLanguage || '').slice(0, 120);
      const cacheKey = `${q.toLowerCase()}|${lang.toLowerCase()}`;
      const cached = cache.get(cacheKey);
      if (cached && cached.expires > now()) return cached.value;

      const elapsed = now() - lastRequestAt;
      if (minIntervalMs > 0 && elapsed < minIntervalMs) await wait(minIntervalMs - elapsed);
      lastRequestAt = now();

      const url = new URL(baseUrl);
      url.searchParams.set('limit', String(Math.min(Math.max(CITY_SEARCH_LIMIT, 1), 20)));
      url.searchParams.set('namePrefix', q);
      url.searchParams.set('sort', '-population');
      url.searchParams.set('types', 'CITY');
      if (env.CITY_SEARCH_CONTACT_EMAIL) url.searchParams.set('email', env.CITY_SEARCH_CONTACT_EMAIL);

      const headers = {
        Accept: 'application/json',
        'Accept-Language': lang || 'en,pt;q=0.9,es;q=0.8',
        'User-Agent': env.CITY_SEARCH_USER_AGENT || 'NODAL city search/1.0',
      };
      const appUrl = env.PUBLIC_BASE_URL || env.NEXT_PUBLIC_APP_URL;
      if (appUrl) headers.Referer = appUrl;

      const res = await fetchImpl(url, { headers });
      if (!res.ok) throw new Error(`city provider returned ${res.status}`);
      const payload = await res.json();
      const rows = Array.isArray(payload?.data) ? payload.data : payload;
      const seen = new Set();
      const cities = (Array.isArray(rows) ? rows : [])
        .map(cityResultFromPlace)
        .filter(Boolean)
        .filter((city) => {
          const key = city.label.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      const value = { cities, attribution: CITY_SEARCH_ATTRIBUTION };
      cache.set(cacheKey, { value, expires: now() + CITY_SEARCH_CACHE_MS });
      return value;
    },
  };
}

export function validateRuntimeConfig(env = process.env) {
  const backend = dataBackend(env);
  if (env.NODE_ENV === 'production') {
    if (backend === 'sqlite' && !env.DATABASE_PATH) throw new Error('DATABASE_PATH is required in production');
    if (env.COOKIE_SECURE === 'false') throw new Error('COOKIE_SECURE must not be false in production');
    publicBaseUrl(env);
  }
  if (backend === 'supabase') resolveSupabaseEnv(env, { requireServer: true });
  paymentsConfig(env);
  if (env.NODE_ENV === 'production' && env.PAYMENTS_MODE === 'live') publicBillingConfig(env);
}

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object';
  const payload = isObj ? JSON.stringify(body) : body;
  const responseHeaders = securityHeaders({
    'Content-Type': isObj ? 'application/json; charset=utf-8' : headers['Content-Type'] || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.writeHead(status, responseHeaders);
  res.end(payload);
}

function redirect(res, location) {
  res.writeHead(302, securityHeaders({
    Location: location,
    'Cache-Control': 'no-store',
  }));
  res.end();
}

/* CSRF guard for state-changing requests: same-origin only */
function sameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (origin) {
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  }
  return true;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/.test(req.headers['content-type'] ?? '')) {
      reject(Object.assign(new Error('expected application/json'), { status: 415 }));
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); reject(Object.assign(new Error('body too large'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch { reject(Object.assign(new Error('invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function readRawBody(req, { max = 128 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        req.destroy();
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function stripeTimestampToIso(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : '';
}

async function recordStripeEvent(repository, event) {
  const object = event?.data?.object;
  if (!object || typeof object !== 'object') return;
  const rank = {
    'checkout.session.completed': 10,
    'customer.subscription.updated': 20,
    'customer.subscription.deleted': 30,
  }[event.type];
  if (!rank) return;
  const mutation = {
    eventId: String(event.id || ''),
    eventType: String(event.type || ''),
    eventCreated: Number(event.created) || 0,
    eventRank: rank,
    stripeCustomerId: String(object.customer || ''),
    stripeSubscriptionId: null,
    stripeCheckoutSessionId: null,
    currentPeriodEnd: null,
  };
  if (event.type === 'checkout.session.completed') {
    const userId = String(object.client_reference_id || object.metadata?.nodal_user_id || '');
    if (!userId || !(await repository.getUserById(userId))) return;
    const paid = object.payment_status === 'paid' || object.payment_status === 'no_payment_required';
    await repository.applyStripeEvent({
      ...mutation,
      userId,
      stripeSubscriptionId: String(object.subscription || ''),
      stripeCheckoutSessionId: String(object.id || ''),
      status: paid ? 'active' : 'pending',
    });
    return;
  }
  const metadataUserId = String(object.metadata?.nodal_user_id || '');
  const userId = metadataUserId && await repository.getUserById(metadataUserId) ? metadataUserId : null;
  await repository.applyStripeEvent({
    ...mutation,
    userId,
    stripeSubscriptionId: String(object.id || ''),
    status: event.type === 'customer.subscription.deleted' ? 'canceled' : object.status,
    currentPeriodEnd: stripeTimestampToIso(object.current_period_end),
  });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function graphFingerprint(graph) {
  const state = {
    users: [...graph.users.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, user]) => [id, stableValue(user)]),
    follows: [...graph.follows.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, targets]) => [id, [...targets].sort()]),
    engagement: [...graph.engagement.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([edge, events]) => [edge, [...events].map(stableValue).sort((a, b) => a.at - b.at || a.w - b.w)]),
  };
  return createHash('sha256').update(JSON.stringify(state)).digest('base64url').slice(0, 24);
}

function sanitizeProfilePatch(body) {
  if (!body || typeof body !== 'object') throw Object.assign(new Error('invalid profile payload'), { status: 400 });
  if ('fullName' in body && String(body.fullName).trim().length < 2) {
    throw Object.assign(new Error('full name is required'), { status: 400 });
  }
  const li = body.partC?.linkedin ?? body.linkedin ?? '';
  if (li && !/^https:\/\/(www\.)?linkedin\.com\/(in|company)\/[A-Za-z0-9_-]+/.test(String(li))) {
    throw Object.assign(new Error('LinkedIn link must use https://linkedin.com/in/...'), { status: 400 });
  }
  const portfolio = body.partC?.portfolio ?? '';
  if (portfolio && !/^https?:\/\/\S+\.\S+/.test(String(portfolio))) {
    throw Object.assign(new Error('portfolio link must start with http:// or https://'), { status: 400 });
  }
  return body;
}

function requireAuth(res, user) {
  if (user) return true;
  send(res, 401, { error: 'authentication required' });
  return false;
}

function resolveUserId(param, sessionUser, useDb) {
  if (param === 'me') return sessionUser?.id ?? null;
  if (!useDb) return param;
  return sessionUser?.id === param ? param : null;
}

/* Takes the canonical path — already decoded and normalised by
   canonicalPathname — so the private-page check and the file lookup can never
   disagree, and nothing is decoded a second time. */
async function serveStatic(req, res, canonical) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, { error: 'method not allowed' }); return; }

  const filePath = staticSourcePath(canonical);
  if (!filePath) { send(res, 404, { error: 'not found' }); return; }

  const type = MIME[path.extname(filePath).toLowerCase()];
  if (!type) { send(res, 404, { error: 'not found' }); return; }

  try {
    const data = await fs.readFile(filePath);
    const headers = type.startsWith('text/html') ? htmlSecurityHeaders() : securityHeaders();
    res.writeHead(200, {
      ...headers,
      'Content-Type': type,
      'Cache-Control': type.startsWith('text/html') ? 'no-store' : STATIC_CACHE_CONTROL,
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

export function staticSourcePath(pathname) {
  const rel = pathname === '/' ? 'index.html' : String(pathname || '').replace(/^\/+/, '');
  if (STATIC_PAGES.has(rel)) return path.join(WEB_ROOT, 'pages', rel);
  if (STATIC_SCRIPTS.has(rel)) return path.join(WEB_ROOT, 'scripts', rel);
  if (STATIC_STYLES.has(rel)) return path.join(WEB_ROOT, 'styles', rel);
  if (rel.startsWith('assets/')) {
    const name = rel.slice('assets/'.length);
    if (STATIC_ASSETS.has(name)) return path.join(WEB_ROOT, 'assets', 'optimized', name);
  }
  return null;
}

export function createApp({
  store,
  db,
  cache = new MemoryCache(),
  payments = { config: paymentsConfig(), fetchImpl: fetch },
  citySearch = createCitySearch(),
  repository = createRepository({ db, store }),
} = {}) {
  const useDb = Boolean(repository);
  const authLimiter = createWindowRateLimiter({ windowMs: AUTH_RATE_WINDOW_MS, limit: AUTH_RATE_LIMIT });
  const interactionLimiter = createWindowRateLimiter({ windowMs: INTERACTION_RATE_WINDOW_MS, limit: INTERACTION_RATE_LIMIT });
  // each search walks the whole directory, so it is bounded per member
  const searchLimiter = createWindowRateLimiter({ windowMs: MEMBER_SEARCH_WINDOW_MS, limit: MEMBER_SEARCH_RATE_LIMIT });
  const cacheKey = (id, graph) => `rec:v2:${id}:${graphFingerprint(graph)}`;
  if (repository?.cleanupExpiredSessions) repository.cleanupExpiredSessions();

  const server = http.createServer(async (req, res) => {
    try {
      /* A request target starting with // parses as an absolute URL and throws
         the base away: "//" throws outright (a 500 on a trivially reachable
         path) and "//host/x" resolves to host with pathname /x. Concatenating
         keeps the base authoritative, so these become ordinary paths that
         canonicalPathname normalises or rejects. */
      const url = new URL(`http://127.0.0.1${req.url.startsWith('/') ? '' : '/'}${req.url}`);
      const { pathname } = url;
      const canonical = canonicalPathname(pathname);
      const isApiRequest = pathname.startsWith('/api/');
      const pageNeedsSession = !isApiRequest
        && canonical
        && (PRIVATE_PAGES.has(canonical) || canonical === '/login.html');
      const session = useDb && (isApiRequest || pageNeedsSession)
        ? await repository.resolveSession(req)
        : { user: null, cookies: [] };
      const sessionUser = session.user;
      if (session.cookies?.length) res.setHeader('Set-Cookie', session.cookies);

      if (!pathname.startsWith('/api/')) {
        if (!canonical) { send(res, 400, { error: 'bad path' }); return; }
        if (useDb && PRIVATE_PAGES.has(canonical) && !sessionUser) {
          redirect(res, `/login.html?next=${encodeURIComponent(canonical)}`);
          return;
        }
        if (useDb && canonical === '/login.html' && sessionUser) {
          redirect(res, safeNext(url.searchParams.get('next')));
          return;
        }
        await serveStatic(req, res, canonical);
        return;
      }

      if (req.method === 'GET' && pathname === '/api/health') { send(res, 200, { ok: true }); return; }

      if (req.method === 'GET' && pathname === '/api/billing/config') {
        send(res, 200, publicBillingConfig());
        return;
      }

      if (req.method === 'GET' && pathname === '/api/cities') {
        if (useDb && !requireAuth(res, sessionUser)) return;
        try {
          send(res, 200, await citySearch.search(url.searchParams.get('q'), req.headers['accept-language']));
        } catch {
          send(res, 200, { cities: [], attribution: CITY_SEARCH_ATTRIBUTION });
        }
        return;
      }

      if (useDb && req.method === 'GET' && pathname === '/api/auth/state') {
        send(res, 200, { authenticated: Boolean(sessionUser) });
        return;
      }

      if (useDb && req.method === 'POST' && pathname === '/api/auth/signup') {
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-origin request rejected' }); return; }
        const rate = authLimiter.take(`signup:${clientIp(req)}`);
        if (!rate.ok) {
          send(res, 429, { error: 'too many authentication attempts' }, { 'Retry-After': String(rate.retryAfter) });
          return;
        }
        const body = await readJsonBody(req);
        const fullName = String(body.fullName ?? body.name ?? '').trim();
        const email = String(body.email ?? '').trim().toLowerCase();
        const password = String(body.password ?? '');
        if (fullName.length < 2) { send(res, 400, { error: 'full name is required' }); return; }
        if (!validateEmail(email)) { send(res, 400, { error: 'valid email is required' }); return; }
        if (!validatePassword(password)) { send(res, 400, { error: 'password must be at least 8 characters' }); return; }
        let result;
        try {
          result = await repository.signup({ fullName, email, password, env: process.env });
        } catch (err) {
          if (err?.status === 429) {
            send(res, 429, { error: 'Confirmation email is temporarily unavailable. Please try again later.' });
            return;
          }
          if (Number.isInteger(err?.status) && err.status >= 400) {
            send(res, err.status < 500 ? err.status : 502, {
              error: 'Account creation could not be completed. If you already confirmed your email, sign in.',
            });
            return;
          }
          throw err;
        }
        if (result.error) { send(res, result.status, { error: result.error }); return; }
        send(res, result.status, {
          user: result.user,
          requiresEmailConfirmation: Boolean(result.requiresEmailConfirmation),
        }, result.cookies?.length ? { 'Set-Cookie': result.cookies } : {});
        return;
      }

      if (useDb && req.method === 'POST' && pathname === '/api/auth/login') {
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-origin request rejected' }); return; }
        const rate = authLimiter.take(`login:${clientIp(req)}`);
        if (!rate.ok) {
          send(res, 429, { error: 'too many authentication attempts' }, { 'Retry-After': String(rate.retryAfter) });
          return;
        }
        const body = await readJsonBody(req);
        const email = String(body.email ?? '').trim().toLowerCase();
        const password = String(body.password ?? '');
        if (!validateEmail(email)) { send(res, 401, { error: 'invalid email or password' }); return; }
        const result = await repository.login({ email, password, env: process.env });
        if (result.error) { send(res, result.status, { error: result.error }); return; }
        send(res, result.status, { user: result.user }, result.cookies?.length ? { 'Set-Cookie': result.cookies } : {});
        return;
      }

      if (useDb && req.method === 'POST' && pathname === '/api/auth/logout') {
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-origin request rejected' }); return; }
        const result = await repository.logout(req, process.env);
        send(res, 200, { ok: true }, result.cookies?.length ? { 'Set-Cookie': result.cookies } : {});
        return;
      }

      if (useDb && req.method === 'GET' && pathname === '/api/auth/me') {
        if (!requireAuth(res, sessionUser)) return;
        send(res, 200, { user: repository.toApiUser(sessionUser) });
        return;
      }

      if (useDb && req.method === 'GET' && pathname === '/api/me/export') {
        if (!requireAuth(res, sessionUser)) return;
        send(res, 200, { data: await repository.exportUserData(sessionUser.id) });
        return;
      }

      if (useDb && req.method === 'DELETE' && pathname === '/api/me') {
        if (!requireAuth(res, sessionUser)) return;
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-origin request rejected' }); return; }
        const body = await readJsonBody(req);
        if (String(body.confirmEmail || '').trim().toLowerCase() !== String(sessionUser.email).toLowerCase()) {
          send(res, 400, { error: 'account deletion requires email confirmation' });
          return;
        }
        await repository.deleteUserById(sessionUser.id);
        const result = await repository.logout(req, process.env);
        send(res, 200, { ok: true }, result.cookies?.length ? { 'Set-Cookie': result.cookies } : {});
        return;
      }

      if (useDb && req.method === 'GET' && pathname === '/api/billing/status') {
        if (!requireAuth(res, sessionUser)) return;
        send(res, 200, { subscription: await repository.getSubscriptionStatus(sessionUser.id) });
        return;
      }

      if (useDb && req.method === 'PATCH' && pathname === '/api/me') {
        if (!requireAuth(res, sessionUser)) return;
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-origin request rejected' }); return; }
        const patch = sanitizeProfilePatch(await readJsonBody(req));
        const user = await repository.updateUserProfile(sessionUser.id, patch);
        send(res, 200, { user: repository.toApiUser(user) });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/users') {
        if (useDb) {
          if (!requireAuth(res, sessionUser)) return;
          send(res, 200, {
            users: (await repository.listDirectoryUsers()).map((row) => {
              const user = repository.toApiUser(row);
              return { id: user.id, name: user.fullName, role: user.title, city: user.city, interests: user.interests, linkedin: user.linkedin };
            }),
          });
          return;
        }
        send(res, 200, { users: [...store.users.values()].map(({ id, name, role, city, interests }) => ({ id, name, role, city, interests })) });
        return;
      }

      /* The globe's data. Groups the directory by city and resolves each city
         to real coordinates through the same provider the profile form uses,
         so a member in any city on Earth lands in the right place — not only
         the ones someone thought to hardcode. Coordinates are cached for a
         month because cities do not move; the roll-up is cached for thirty
         seconds so a new member still shows up while you are watching. */
      if (useDb && req.method === 'GET' && pathname === '/api/network/places') {
        if (!requireAuth(res, sessionUser)) return;
        const cached = await cache.get(`network:places:v1:${sessionUser.id}`);
        if (cached) {
          send(res, 200, cached, { 'X-Cache': 'HIT', 'Content-Type': 'application/json; charset=utf-8' });
          return;
        }
        const rows = await repository.listDirectoryUsers();
        const groups = new Map();
        let viewerCity = '';
        let viewerListed = false;
        for (const row of rows) {
          const user = repository.toApiUser(row);
          if (user.id === sessionUser.id) { viewerListed = true; viewerCity = String(user.city || '').trim(); }
          const city = String(user.city || '').trim();
          if (!city) continue;
          const key = city.toLowerCase();
          if (!groups.has(key)) groups.set(key, { city, members: [] });
          groups.get(key).members.push({
            id: user.id, name: user.fullName, role: user.title, linkedin: user.linkedin || '',
          });
        }

        const places = [];
        for (const group of groups.values()) {
          const cacheKey = `place:v1:${group.city.toLowerCase()}`;
          let point = null;
          const remembered = await cache.get(cacheKey);
          if (remembered) {
            try { point = JSON.parse(remembered); } catch { point = null; }
          }
          if (!point) {
            try {
              const found = await citySearch.search(group.city, req.headers['accept-language']);
              const best = (found.cities || []).find((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
              if (best) point = { lat: best.lat, lon: best.lon, label: best.label || group.city };
            } catch { /* provider down: the city simply has no pin this round */ }
            if (point) await cache.set(cacheKey, JSON.stringify(point), PLACE_TTL_MS);
          }
          if (!point) continue;
          places.push({
            city: group.city,
            label: point.label,
            lat: point.lat,
            lon: point.lon,
            members: group.members.length,
            /* Name, role, a link to the member card and LinkedIn if they added
               one — every field the directory already publishes to signed-in
               members. Email is never here: knowing an address is how you find
               someone, not something the map hands out. */
            people: group.members.slice(0, 12).map((m) => ({
              id: m.id, name: m.name, role: m.role, linkedin: m.linkedin,
            })),
          });
        }
        /* Three different situations, three different things to tell someone:
           not in the directory at all, in it but with no city, or in it with a
           city the provider could not place. */
        const placed = new Set(places.map((p) => p.city.toLowerCase()));
        const payload = {
          members: places.reduce((n, p) => n + p.members, 0),
          places,
          you: {
            listed: viewerListed,
            hasCity: viewerCity !== '',
            onMap: viewerListed && viewerCity !== '' && placed.has(viewerCity.toLowerCase()),
            city: viewerCity,
          },
        };
        await cache.set(`network:places:v1:${sessionUser.id}`, JSON.stringify(payload), NETWORK_TTL_MS);
        send(res, 200, payload, { 'X-Cache': 'MISS' });
        return;
      }

      /* Directory search. Members opt in through Part C consent; everyone else
         stays unlisted. Name, role and city match on substring; email must match
         in full — so you can reach someone whose address you already know
         without the endpoint ever disclosing an address. */
      if (useDb && req.method === 'GET' && pathname === '/api/users/search') {
        if (!requireAuth(res, sessionUser)) return;
        const rate = searchLimiter.take(sessionUser.id);
        if (!rate.ok) {
          send(res, 429, { error: 'too many searches' }, { 'Retry-After': String(rate.retryAfter) });
          return;
        }
        const raw = String(url.searchParams.get('q') || '').trim().slice(0, CITY_SEARCH_MAX_QUERY);
        const q = raw.toLowerCase();
        if (q.length < MEMBER_SEARCH_MIN_QUERY) { send(res, 200, { users: [] }); return; }
        const rows = await repository.listDirectoryUsers();
        const users = rows
          .filter((row) => row.id !== sessionUser.id)
          .map((row) => ({ row, user: repository.toApiUser(row) }))
          .filter(({ row, user }) => {
            const haystack = `${user.fullName} ${user.title} ${user.city}`.toLowerCase();
            return haystack.includes(q) || String(row.email || '').toLowerCase() === q;
          })
          .slice(0, MEMBER_SEARCH_LIMIT)
          .map(({ user }) => ({ id: user.id, name: user.fullName, role: user.title, city: user.city }));
        send(res, 200, { users });
        return;
      }

      let m = pathname.match(/^\/api\/users\/([^/]+)$/);
      if (useDb && m && req.method === 'GET') {
        if (!requireAuth(res, sessionUser)) return;
        const id = m[1];
        if (!ID_RE.test(id)) { send(res, 400, { error: 'invalid user id' }); return; }
        const row = await repository.getUserById(id);
        if (!row) { send(res, 404, { error: 'unknown user' }); return; }
        const user = repository.toApiUser(row);
        const self = id === sessionUser.id;
        // same rule as listDirectoryUsers, without reading every profile to answer it
        const inDirectory = user?.partC?.consent === true && user?.accountStatus === 'active';
        if (!self && !inDirectory) { send(res, 404, { error: 'unknown user' }); return; }
        // a member card carries only what the directory is meant to show
        send(res, 200, {
          user: self ? user : {
            id: user.id,
            fullName: user.fullName,
            title: user.title,
            city: user.city,
            interests: user.interests,
            topics: user.topics,
            assessed: user.assessed,
            linkedin: user.linkedin,
            createdAt: user.createdAt,
            partC: { bio: user.partC?.bio || '', linkedin: user.linkedin, availability: user.partC?.availability || '', consent: true, portfolio: '', references: '' },
          },
          self,
        });
        return;
      }

      m = pathname.match(/^\/api\/recommendations\/([^/]+)$/);
      if (m && req.method === 'GET') {
        if (useDb && !requireAuth(res, sessionUser)) return;
        const userId = resolveUserId(m[1], sessionUser, useDb);
        if (!userId) { send(res, 403, { error: 'forbidden user scope' }); return; }
        if (!ID_RE.test(userId)) { send(res, 400, { error: 'invalid user id' }); return; }
        const activeStore = useDb ? await repository.loadGraphStore({ viewerId: userId }) : store;
        if (!activeStore.users.has(userId)) { send(res, 404, { error: 'unknown user' }); return; }

        const key = cacheKey(userId, activeStore);
        const cached = await cache.get(key);
        if (cached) {
          send(res, 200, cached, { 'X-Cache': 'HIT', 'Content-Type': 'application/json; charset=utf-8' });
          return;
        }

        const recommendations = recommend(activeStore, userId) ?? [];
        const payload = { userId, generatedAt: new Date().toISOString(), recommendations };
        await cache.set(key, JSON.stringify(payload), REC_TTL_MS);
        send(res, 200, payload, { 'X-Cache': 'MISS' });
        return;
      }

      m = pathname.match(/^\/api\/users\/([^/]+)\/(follow|interactions)$/);
      if (m && req.method === 'POST') {
        if (useDb && !requireAuth(res, sessionUser)) return;
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-origin request rejected' }); return; }
        const userId = resolveUserId(m[1], sessionUser, useDb);
        const action = m[2];
        if (!userId) { send(res, 403, { error: 'forbidden user scope' }); return; }
        const activeStore = useDb ? await repository.loadGraphStore({ viewerId: userId }) : store;
        if (!ID_RE.test(userId) || !activeStore.users.has(userId)) { send(res, 404, { error: 'unknown user' }); return; }

        const body = await readJsonBody(req);
        const targetId = body.targetId;
        if (typeof targetId !== 'string' || !ID_RE.test(targetId) || !activeStore.users.has(targetId) || targetId === userId) {
          send(res, 400, { error: 'invalid targetId' });
          return;
        }

        if (action === 'follow') {
          if (useDb) await repository.addFollow(userId, targetId);
          else addFollow(store, userId, targetId);
        } else {
          if (!API_INTERACTION_TYPES.has(body.type)) { send(res, 400, { error: 'invalid interaction type' }); return; }
          const rate = interactionLimiter.take(userId);
          if (!rate.ok) {
            send(res, 429, { error: 'too many interaction events' }, { 'Retry-After': String(rate.retryAfter) });
            return;
          }
          if (useDb) await repository.recordInteraction(userId, targetId, body.type);
          else recordInteraction(store, userId, targetId, body.type);
        }

        // graph changed — both parties' recommendations are stale
        await cache.del(cacheKey(userId, activeStore), cacheKey(targetId, activeStore));
        send(res, 200, { ok: true, userId, targetId, action });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/checkout') {
        if (useDb && !requireAuth(res, sessionUser)) return;
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-origin request rejected' }); return; }
        const body = await readJsonBody(req);
        if (body.plan !== 'membership' || !CYCLES.has(body.cycle)) {
          send(res, 400, { error: 'invalid plan or cycle' });
          return;
        }
        if (!payments.config) { send(res, 501, { error: 'payments not configured' }); return; }
        let origin;
        try {
          origin = publicBaseUrl();
        } catch (err) {
          send(res, err.status ?? 500, { error: err.message });
          return;
        }
        const session = await createCheckoutSession({
          cycle: body.cycle,
          origin,
          user: useDb ? repository.toApiUser(sessionUser) : { id: 'local', email: '' },
        }, payments.config, payments.fetchImpl);
        send(res, 200, session);
        return;
      }

      if (useDb && req.method === 'POST' && pathname === '/api/stripe/webhook') {
        if (!payments.config?.webhookSecret) { send(res, 503, { error: 'payments webhook not configured' }); return; }
        const payload = await readRawBody(req);
        let event;
        try {
          event = verifyStripeWebhook(payload, req.headers['stripe-signature'], payments.config.webhookSecret);
        } catch (err) {
          send(res, err.status ?? 400, { error: err.message });
          return;
        }
        await recordStripeEvent(repository, event);
        send(res, 200, { received: true });
        return;
      }

      send(res, 404, { error: 'not found' });
    } catch (err) {
      const status = err.status ?? 500;
      if (status >= 500) console.error('request error:', safeErrorMessage(err));
      if (!res.headersSent) send(res, status, { error: status >= 500 ? 'internal error' : safeErrorMessage(err) });
      else res.end();
    }
  });
  if (repository?.close) server.on('close', () => repository.close());
  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  process.on('unhandledRejection', (err) => console.error('unhandled rejection:', safeErrorMessage(err)));
  process.on('uncaughtException', (err) => { console.error('uncaught exception:', safeErrorMessage(err)); process.exit(1); });

  validateRuntimeConfig();
  const port = Number(process.env.PORT || 4173);
  const cache = await createCache();
  createApp({ cache }).listen(port, () => {
    console.log(`NODAL serving site + API on http://localhost:${port}`);
  });
}
