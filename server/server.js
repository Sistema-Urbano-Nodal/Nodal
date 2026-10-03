/* NODAL server: static site + authenticated API.
   Zero dependencies — run with `node server/server.js` (PORT, DATABASE_PATH, REDIS_URL optional). */

import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { addFollow, recordInteraction } from './store.js';
import { recommend } from './engine.js';
import { createCache, MemoryCache } from './cache.js';
import { createNetworkSnapshots } from './network-cache.js';
import { createCourseStore } from './courses-repository.js';
import { createCourseApi } from './courses-api.js';
import { createFiiuStore } from './fiiu-repository.js';
import { createFiiuApi, exportFiiuData } from './fiiu-api.js';
import { resolveCheckinSecret, checkinClock } from './fiiu-checkin.js';
import { createRegistrationConfirmation } from './fiiu-email.js';
import { encodeQr as encodeQrCode } from './qr.js';
import { createNewsStore } from './news-repository.js';
import { createNewsApi } from './news-api.js';
import { preparePageHtml } from './page-shell.js';
import {createLocationProvider,validatePosition,validateCityId} from './location.js';
import { createCourseParticipants } from './course-participants.js';
import { exportCourseData, deleteCourseData } from './courses-privacy.js';
import {
  paymentsConfig, createCheckoutSession, verifyStripeWebhook, CYCLES,
} from './payments.js';
import { parseCookies, validateEmail, validatePassword } from './auth.js';
import { createRepository } from './repository.js';
import { dataBackend, resolveSupabaseEnv } from './supabase.js';
import {
  decodeCatalogCursor,
  decodeCatalogInterestCursor,
  isCatalogItemClosed,
  localizeCatalogItem,
  validateCatalogDraft,
  validateCatalogInterestMessage,
  validateCatalogPublication,
} from './catalog.js';

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
// /fiiu-checkin.html is public on purpose: a signed-out scan must land on the check-in page, which says
// "Sign in to check in" for that session and links to sign-in with the same code. It holds no data, and
// /api/fiiu/checkin still requires a session.
const PRIVATE_PAGES = new Set(['/fiiu-admin.html', '/fiiu-qr.html', '/dashboard.html', '/profile.html', '/payments.html', '/admin.html', '/courses.html', '/course.html', '/teaching.html']);
const STATIC_PAGES = new Set(['fiiu.html', 'fiiu-admin.html', 'fiiu-qr.html', 'fiiu-checkin.html', 'organisers-only.html', 'community.html', 'resources.html', 'knowledge.html', 'index.html', 'login.html', 'reset-password.html', 'accept-invitation.html', 'dashboard.html', 'profile.html', 'payments.html', 'opportunities.html', 'privacy.html', 'admin.html', 'courses.html', 'course.html', 'teaching.html']);
const STATIC_SCRIPTS = new Set(['fiiu-ui.js', 'fiiu.js', 'fiiu-admin.js', 'fiiu-hubs.js', 'fiiu-checkin.js', 'fiiu-qr.js', 'news-feed.js', 'admin.js', 'app.js', 'auth.js', 'password-recovery.js', 'recovery-i18n.js', 'accept-invitation.js', 'invitation-i18n.js', 'catalog.js', 'coastline.js', 'dashboard.js', 'globe.js', 'globe-geo.js', 'i18n.js', 'locale.js', 'nav.js', 'payments.js', 'profile.js', 'recs.js', 'script.js', 'hero-network.js', 'courses.js', 'teaching.js', 'pilot.js', 'pilot-i18n.js', 'location-check.js', 'location-i18n.js', 'privacy.js']);
const ORGANISER_PAGES = new Set(['/fiiu-admin.html', '/fiiu-qr.html']);
const STATIC_STYLES = new Set(['fiiu.css', 'auth.css', 'styles.css', 'dashboard.css', 'catalog.css', 'admin.css', 'courses.css', 'recovery.css', 'fonts.css', 'locale.css', 'privacy.css']);
const STATIC_ASSETS = new Set(['latam-map.webp', 'nodal-community.webp', 'nodal-wordmark.webp']);
const STATIC_FONTS = new Set(['montserrat-v31-latin-normal.woff2', 'montserrat-v31-latin-ext-normal.woff2', 'montserrat-v31-latin-italic.woff2', 'montserrat-v31-latin-ext-italic.woff2', 'OFL.txt']);
// The FIIU summary email's logo (server/fiiu-email.js), loaded by mail clients from other origins.
const STATIC_EMAIL_ASSETS = new Set(['nodal-lockup.png', 'nodal-lockup-dark.png']);
const AUTH_RATE_WINDOW_MS = 5 * 60 * 1000;
const AUTH_RATE_LIMIT = envInt('AUTH_RATE_LIMIT', 10);
// A classroom may share one public IP. Keep account guessing strict while
// bounding aggregate signup/login work independently (1–10,000 per window).
const AUTH_IP_RATE_LIMIT = Math.min(10000, Math.max(1, Math.floor(envInt('AUTH_IP_RATE_LIMIT', 800))));
/* Failed sign-ins are counted per account and requester (AUTH_RATE_LIMIT), so
   somebody else's wrong guesses never lock the owner out, and per account across
   every requester against distributed guessing. Successes count for neither. */
const AUTH_ACCOUNT_RATE_LIMIT = envInt('AUTH_ACCOUNT_RATE_LIMIT', 5 * AUTH_RATE_LIMIT);
/* Every anonymous sign-up can make the auth provider send an email, and that
   quota (300 an hour on the Supabase project, over the same Gmail account as
   FIIU mail) also carries password-recovery links and course invitations. Sign-ups
   stop at this many an hour per instance, which leaves the rest for those. */
const SIGNUP_EMAIL_HOURLY_LIMIT = envInt('SIGNUP_EMAIL_HOURLY_LIMIT', 200);
/* A refresh token that GoTrue rejects costs it a refresh against its per-IP limit,
   and GoTrue sees this server's address, not the visitor's. Each client address
   may cause this many rejected refreshes per five minutes; a real browser
   refreshes about once an hour, and successful refreshes are not counted. */
const SESSION_REFRESH_FAILURE_LIMIT = envInt('SESSION_REFRESH_FAILURE_LIMIT', 30);
const SUPABASE_ACCESS_COOKIE = 'nodal_session';
const SUPABASE_REFRESH_COOKIE = 'nodal_refresh';
// Routes that never read the session: resolving one would only cost provider calls.
const SESSIONLESS_API = new Set(['/api/health', '/api/billing/config', '/api/stripe/webhook']);
/* Routes that answer without a member and only personalise when there is one. A
   session-service outage serves them signed out instead of failing them. */
const OPTIONAL_SESSION_API = /^\/api\/(?:auth\/state|fiiu|news|catalog(?:\/[a-z0-9-]{1,40})?)$/;
/* Routes that use only the member's id, email, role and account status, which the
   profile row carries. The full profile adds two reads to every request. */
const ID_ONLY_API = /^\/api\/(?:network\/places|users|users\/search|users\/[^/]+\/(?:follow|interactions)|recommendations\/[^/]+|cities|billing\/status|checkout|me\/export|me\/catalog-interests|me\/location\/(?:suggest|accept)|(?:admin\/)?catalog(?:\/.*)?|admin\/interests(?:\/.*)?)$/;
// A Stripe subscription in any of these states exists and can still bill the member.
const LIVE_SUBSCRIPTION_STATUSES = new Set(['pending', 'active', 'trialing', 'past_due', 'unpaid', 'paused']);
const INTERACTION_RATE_WINDOW_MS = 60 * 1000;
const INTERACTION_RATE_LIMIT = envInt('INTERACTION_RATE_LIMIT', 60);
const LINKEDIN_RE = /^https:\/\/(www\.)?linkedin\.com\/(in|company)\/[A-Za-z0-9_-]+/;
const CITY_SEARCH_MIN_QUERY = 2;
const MEMBER_SEARCH_MIN_QUERY = 2;
const MEMBER_SEARCH_LIMIT = 8;
const MEMBER_SEARCH_WINDOW_MS = 60 * 1000;
const MEMBER_SEARCH_RATE_LIMIT = envInt('MEMBER_SEARCH_RATE_LIMIT', 40);
const CATALOG_READ_RATE_LIMIT = envInt('CATALOG_READ_RATE_LIMIT', 60);
const CATALOG_WRITE_RATE_LIMIT = envInt('CATALOG_WRITE_RATE_LIMIT', 20);
const CATALOG_PUBLIC_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=60';
const CATALOG_KINDS = new Set(['opportunity', 'project', 'learning_circle', 'resource', 'case_study']);
const CATALOG_SUBTYPES = new Set(['job', 'consulting', 'grant', 'open_call', 'fellowship', 'other']);
const CATALOG_STATUSES = new Set(['draft', 'published', 'archived']);
/* Anything below either leaves the building (an external geocoder, Stripe) or
   reads the whole directory. Unlimited, one signed-in account could burn a
   third-party quota or hold the database busy for everyone else. */
const READ_RATE_LIMIT = envInt('READ_RATE_LIMIT', 60);          // per minute
const WRITE_RATE_LIMIT = envInt('WRITE_RATE_LIMIT', 60);        // per minute
const COSTLY_RATE_WINDOW_MS = 10 * 60 * 1000;
const COSTLY_RATE_LIMIT = envInt('COSTLY_RATE_LIMIT', 10);      // per ten minutes
const PLACE_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // a city does not move
const NETWORK_GEOCODE_PER_REQUEST = envInt('NETWORK_GEOCODE_PER_REQUEST', 4);
// Total time one places build may spend waiting on the geocoder.
const NETWORK_GEOCODE_BUDGET_MS = envInt('NETWORK_GEOCODE_BUDGET_MS', 2000);
// A city the provider could not place (or a failed lookup) is not asked about again for this long.
const PLACE_MISS_TTL_MS = 10 * 60 * 1000;
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
  "style-src 'self'",
  "font-src 'self'",
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

function contentSecurityPolicy(env = process.env, courseRecordings = false) {
  const directives = [...BASE_CSP];
  if (courseRecordings) directives.push('frame-src https://drive.google.com https://www.youtube-nocookie.com https://player.vimeo.com');
  if (env.NODE_ENV === 'production') directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

function htmlSecurityHeaders(headers = {}, courseRecordings = false) {
  return securityHeaders({ 'Content-Security-Policy': contentSecurityPolicy(process.env, courseRecordings), ...headers });
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
  let sweptAt = 0;
  return {
    take(key, now = Date.now()) {
      // buckets are only ever added, so an attacker rotating keys would grow
      // this map without bound; drop the expired ones as we go
      if (now - sweptAt > windowMs) {
        sweptAt = now;
        for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
      }
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
    // Whether take() would succeed, without spending anything.
    peek(key, now = Date.now()) {
      const bucket = buckets.get(key);
      return !bucket || now >= bucket.resetAt || bucket.count < limit;
    },
    /* Gives back one unit from take(). A budget that only counts failures takes
       before the outcome is known, so parallel attempts cannot all slip past it,
       and returns the unit when the attempt did not fail. */
    release(key) {
      const bucket = buckets.get(key);
      if (bucket && bucket.count > 0) bucket.count -= 1;
    },
    reset(key) {
      buckets.delete(key);
    },
  };
}

/* The expiry of a token shaped like a JWT, read without verifying the signature:
   enough to know that asking the auth provider about it is pointless, never
   enough to trust it. null when the value is not a JWT at all. */
function jwtExpiry(token) {
  const value = String(token || '');
  const parts = value.split('.');
  if (value.length > 8192 || parts.length !== 3 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  try {
    const exp = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.exp;
    return Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

// GoTrue refresh tokens are short printable strings; empty, spaced or binary values are not.
const usableRefreshToken = value => /^[!-~]{1,2048}$/.test(String(value || ''));

// The same request with some cookies left out, for code that reads only req.headers.cookie.
function withoutCookies(req, names) {
  const cookie = String(req.headers.cookie || '').split(';')
    .filter(part => !names.includes(part.split('=')[0].trim()))
    .join(';');
  return { headers: { ...req.headers, cookie }, socket: req.socket, method: req.method, url: req.url };
}

/* Behind a proxy the leftmost X-Forwarded-For entry is whatever the client
   claimed, so keying a rate limit on it lets anyone reset their own bucket by
   rotating a header. Prefer X-Real-IP, which the proxy sets and a client cannot
   forge through it; otherwise take the rightmost hop, which is the address the
   nearest trusted proxy observed. */
/* Vercel always runs the app behind its own proxy, which sets X-Real-IP and X-Forwarded-For, so its headers are
   trusted there unless TRUST_PROXY is explicitly "false". Elsewhere only TRUST_PROXY=true trusts them. */
export function trustsProxy(env = process.env) {
  return env.TRUST_PROXY === 'true' || (env.VERCEL === '1' && env.TRUST_PROXY !== 'false');
}

function clientIp(req) {
  if (trustsProxy()) {
    const real = String(req.headers['x-real-ip'] ?? '').trim();
    if (real) return real.slice(0, 80);
    const chain = String(req.headers['x-forwarded-for'] ?? '').split(',').map((v) => v.trim()).filter(Boolean);
    if (chain.length) return chain[chain.length - 1].slice(0, 80);
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

/* Shown wherever a price would go while launch pricing is not announced yet,
   and while checkout cannot run (pilot mode, or no Stripe configuration): a
   price next to a membership nobody can buy reads as an offer. A period
   ("/ month") and a badge ("2 months free") are only meaningful next to a real
   amount, so they are suppressed with it. */
const PRICE_UNANNOUNCED = 'Soon';

export function publicBillingConfig(env = process.env, { checkout = false } = {}) {
  /* Only a live payments deployment must name a price. Requiring one of every
     production deployment made the "Soon" state above unreachable there — the
     documented pre-launch setup (NODE_ENV=production, PAYMENTS_MODE=preview,
     no SUBSCRIPTION_* set) turned this endpoint into a 500 on every call.
     The labels are still read (and required in live mode) when checkout is
     off; they are only withheld from the response. */
  const productionRequired = env.NODE_ENV === 'production' && env.PAYMENTS_MODE === 'live';
  const monthlyLabel = readRequiredEnv(env, 'SUBSCRIPTION_PRICE_MONTHLY_LABEL', { productionRequired });
  const annualLabel = readRequiredEnv(env, 'SUBSCRIPTION_PRICE_ANNUAL_LABEL', { productionRequired });
  const monthlyAmount = checkout ? monthlyLabel : '';
  const annualAmount = checkout ? annualLabel : '';
  return {
    checkout: Boolean(checkout),
    cycles: {
      monthly: {
        label: env.SUBSCRIPTION_MONTHLY_LABEL || 'Monthly',
        amount: monthlyAmount || PRICE_UNANNOUNCED,
        per: monthlyAmount ? (env.SUBSCRIPTION_MONTHLY_PERIOD || '') : '',
        note: env.SUBSCRIPTION_MONTHLY_NOTE || 'Cancel anytime.',
        renews: env.SUBSCRIPTION_MONTHLY_RENEWS || 'Every month, until you cancel',
        badge: monthlyAmount ? (env.SUBSCRIPTION_MONTHLY_BADGE || '') : '',
      },
      annual: {
        label: env.SUBSCRIPTION_ANNUAL_LABEL || 'Annual',
        amount: annualAmount || PRICE_UNANNOUNCED,
        per: annualAmount ? (env.SUBSCRIPTION_ANNUAL_PERIOD || '') : '',
        note: env.SUBSCRIPTION_ANNUAL_NOTE || '',
        renews: env.SUBSCRIPTION_ANNUAL_RENEWS || 'Every 12 months, until you cancel',
        badge: annualAmount ? (env.SUBSCRIPTION_ANNUAL_BADGE || '') : '',
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

const cityCoordinate = (value, bound) => value !== null && value !== undefined && value !== ''
  && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= bound ? Number(value) : null;

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
      lat: cityCoordinate(place.latitude, 90),
      lon: cityCoordinate(place.longitude, 180),
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
    lat: cityCoordinate(place.lat, 90),
    lon: cityCoordinate(place.lon, 180),
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
  maxEntries = 256,
  requestTimeoutMs = 4500,
} = {}) {
  const cache = new MemoryCache({ now, maxEntries });
  const pending = new Map();
  let nextRequestAt = 0;
  return {
    async search(query, acceptLanguage = '') {
      const q = cleanCityQuery(query);
      if (q.length < CITY_SEARCH_MIN_QUERY) return { cities: [], attribution: CITY_SEARCH_ATTRIBUTION };
      const lang = String(acceptLanguage || '').slice(0, 120);
      const cacheKey = `${q.toLowerCase()}|${lang.toLowerCase()}`;
      const cached = await cache.get(cacheKey);
      if (cached) return cached;
      if (pending.has(cacheKey)) return pending.get(cacheKey);
      const delay = Math.max(0, nextRequestAt - now());
      if (delay > 2000 || pending.size >= 32) throw new Error('city provider busy');
      nextRequestAt = Math.max(now(), nextRequestAt) + Math.max(0, minIntervalMs);
      const operation = (async () => {
        if (delay) await wait(delay);

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

        const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(requestTimeoutMs) });
        if (!res.ok) throw new Error(`city provider returned ${res.status}`);
        const payload = await res.json();
        const rows = Array.isArray(payload?.data) ? payload.data : payload;
        const seen = new Set();
        const cities = (Array.isArray(rows) ? rows.slice(0, 20) : [])
          .map(cityResultFromPlace)
          .filter(Boolean)
          .filter((city) => {
            const key = city.label.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        const value = { cities, attribution: CITY_SEARCH_ATTRIBUTION };
        await cache.set(cacheKey, value, CITY_SEARCH_CACHE_MS);
        return value;
      })();
      pending.set(cacheKey, operation);
      try { return await operation; } finally { pending.delete(cacheKey); }
    },
  };
}

/* Password-recovery and invitation emails, the FIIU summary and its check-in links
   use only the configured origin (server/supabase.js emailLinkOrigin). VERCEL_URL
   names one deployment, behind Vercel's protection, so the public site needs this. */
function requireExplicitOrigin(env) {
  const raw = String(env.PUBLIC_BASE_URL || env.NEXT_PUBLIC_APP_URL || '').trim();
  if (!raw) throw new Error('PUBLIC_BASE_URL (or NEXT_PUBLIC_APP_URL) is required on Vercel Production; email links never use VERCEL_URL');
  let url;
  try { url = new URL(raw); } catch { throw new Error('PUBLIC_BASE_URL must be a valid https origin'); }
  if (url.protocol !== 'https:') throw new Error('PUBLIC_BASE_URL must use https');
  if (url.username || url.password) throw new Error('PUBLIC_BASE_URL must not contain credentials');
}

export function validateRuntimeConfig(env = process.env) {
  const backend = dataBackend(env);
  const vercelProduction = env.VERCEL_ENV === 'production';
  /* Off Vercel, clientIp() trusts proxy headers only for the exact string "true"; any other spelling would silently
     key every per-client limit on the proxy's own hop, so one visitor would spend the budget of everyone. On Vercel
     the proxy is always there (trustsProxy), so a missing or odd value must not stop production from booting. */
  if (env.VERCEL !== '1' && !['', 'true', 'false'].includes(env.TRUST_PROXY ?? '')) throw new Error('TRUST_PROXY must be "true" or "false"');
  if (vercelProduction && env.TRUST_PROXY === 'false') console.warn('TRUST_PROXY=false on Vercel Production: every visitor shares one rate-limit bucket');
  if (vercelProduction) requireExplicitOrigin(env);
  if (env.NODE_ENV === 'production') {
    if (backend === 'sqlite' && !env.DATABASE_PATH) throw new Error('DATABASE_PATH is required in production');
    if (env.COOKIE_SECURE === 'false') throw new Error('COOKIE_SECURE must not be false in production');
    publicBaseUrl(env);
  }
  if (backend === 'supabase') resolveSupabaseEnv(env, { requireServer: true });
  // The FIIU check-in secret must be strong when set; the dev clock override never reaches production.
  if (env.FIIU_CHECKIN_SECRET) resolveCheckinSecret(env, backend);
  if (env.NODE_ENV === 'production' && String(env.FIIU_CHECKIN_NOW ?? '').trim()) throw new Error('FIIU_CHECKIN_NOW must not be set in production');
  checkinClock(env, backend);
  paymentsConfig(env);
  if (env.NODE_ENV === 'production' && env.PAYMENTS_MODE === 'live') publicBillingConfig(env);
}

function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
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

/* A private page asked for while the session service is down. The browser gets a
   page it can show, not a JSON error, and is asked to retry shortly. */
const UNAVAILABLE_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>NODAL</title></head>
<body>
<h1>NODAL is temporarily unavailable</h1>
<p>We could not check your sign-in just now. Please reload this page in a minute.</p>
<p lang="es">NODAL no está disponible en este momento. Recarga esta página en un minuto.</p>
<p lang="pt">A NODAL está temporariamente indisponível. Recarregue esta página em um minuto.</p>
</body>
</html>
`;

function sendUnavailablePage(req, res) {
  res.writeHead(503, htmlSecurityHeaders({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Retry-After': '30',
  }));
  res.end(req.method === 'HEAD' ? undefined : UNAVAILABLE_PAGE);
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
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('expected object');
        resolve(body);
      }
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
    /* Only a membership checkout counts. Another Checkout flow in the same Stripe
       account (a one-off payment, a Payment Link that accepts client_reference_id
       in its URL) must never mark a member as subscribed. */
    if ((object.mode !== undefined && object.mode !== 'subscription') || !object.subscription) return;
    /* createCheckoutSession always sets metadata.nodal_user_id, and a Payment Link
       cannot: one that only carries client_reference_id is not a NODAL checkout. */
    const reference = String(object.client_reference_id || '');
    const metadataUserId = String(object.metadata?.nodal_user_id || '');
    if (!metadataUserId || (reference && reference !== metadataUserId)) return;
    const userId = metadataUserId;
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
    // Stripe API 2025-03-31.basil moved the billing period from the subscription to its items.
    currentPeriodEnd: stripeTimestampToIso(object.current_period_end ?? object.items?.data?.[0]?.current_period_end),
  });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function graphFingerprint(graph) {
  const state = {
    users: [...graph.users.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, user]) => [id, stableValue(user)]),
    follows: [...graph.follows.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, targets]) => [id, [...targets].sort()]),
    engagement: [...graph.engagement.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      /* The sort has to be a total order, or the fingerprint depends on the
         order rows came back in. Two events on one edge can share a timestamp
         and a weight — a follow and a like both weigh 3 — and neither store
         orders its reads past created_at, so the type has to break the tie. */
      .map(([edge, events]) => [edge, [...events].map(stableValue).sort(
        (a, b) => a.at - b.at || a.w - b.w || String(a.type).localeCompare(String(b.type)),
      )]),
  };
  return createHash('sha256').update(JSON.stringify(state)).digest('base64url').slice(0, 24);
}

/* A strong validator over the exact bytes the caller would receive. The globe
   polls often and usually nothing has changed, so this turns almost every poll
   into an empty 304 instead of a full roll-up. */
function entityTag(serialized) {
  return `"${createHash('sha256').update(serialized).digest('base64url').slice(0, 24)}"`;
}

/* 304 carries no body and no content type — and stays no-store, because this
   payload is built for one viewer and must never sit in a shared cache. */
function sendNotModified(res, etag) {
  res.writeHead(304, securityHeaders({ ETag: etag, 'Cache-Control': 'no-store' }));
  res.end();
}

function sanitizeProfilePatch(body) {
  if (!body || typeof body !== 'object') throw Object.assign(new Error('invalid profile payload'), { status: 400 });
  if ('app_role' in body || 'appRole' in body || 'role' in body || 'permission' in body) {
    throw Object.assign(new Error('app_role cannot be changed through profile updates'), { status: 400 });
  }
  if ('fullName' in body && String(body.fullName).trim().length < 2) {
    throw Object.assign(new Error('full name is required'), { status: 400 });
  }
  /* Both places a LinkedIn URL can arrive are checked, and each on its own:
     `??` only falls through on null/undefined, so an empty partC.linkedin used
     to skip the check entirely and let an arbitrary top-level `linkedin` — a
     javascript: URL among them — be stored and served to other members. */
  for (const li of [body.partC?.linkedin, body.linkedin]) {
    if (li && !LINKEDIN_RE.test(String(li))) {
      throw Object.assign(new Error('LinkedIn link must use https://linkedin.com/in/...'), { status: 400 });
    }
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

function requireAdmin(res, user) {
  if (!requireAuth(res, user)) return false;
  if ((user.permission || user.role) === 'admin') return true;
  send(res, 403, { error: 'administrator access required' });
  return false;
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function oneQueryValue(params, name) {
  const values = params.getAll(name);
  if (values.length > 1) throw badRequest(`${name} is invalid`);
  return values[0];
}

function boundedQueryText(params, name, max) {
  const value = oneQueryValue(params, name);
  if (value === undefined) return undefined;
  const text = value.trim();
  if (!text || text.length > max) throw badRequest(`${name} is invalid`);
  return text;
}

function catalogQueryFromUrl(params, { admin = false } = {}) {
  const allowed = new Set(['lang', 'kind', 'subtype', 'q', 'topic', 'location', 'featured', 'state', 'cursor', 'limit', ...(admin ? ['status'] : [])]);
  if ([...params.keys()].some((key) => !allowed.has(key))) throw badRequest('catalog query is invalid');
  const lang = oneQueryValue(params, 'lang');
  if (lang === '') throw badRequest('lang is invalid');
  const resolvedLang = lang || 'en';
  if (!['en', 'es', 'pt'].includes(resolvedLang)) throw badRequest('lang is invalid');
  const query = { lang: resolvedLang };
  const kind = boundedQueryText(params, 'kind', 160);
  if (kind !== undefined) {
    const kinds = kind.split(',').map((part) => part.trim());
    if (!kinds.length || kinds.some((part) => !part || !CATALOG_KINDS.has(part))) throw badRequest('kind is invalid');
    query.kind = kinds.join(',');
  }
  const subtype = boundedQueryText(params, 'subtype', 40);
  if (subtype !== undefined) {
    if (!CATALOG_SUBTYPES.has(subtype)) throw badRequest('subtype is invalid');
    query.subtype = subtype;
  }
  for (const [name, max] of [['q', 320], ['topic', 60], ['location', 180]]) {
    const value = boundedQueryText(params, name, max);
    if (value !== undefined) query[name] = value;
  }
  const featured = oneQueryValue(params, 'featured');
  if (featured !== undefined) {
    if (featured !== 'true' && featured !== 'false') throw badRequest('featured is invalid');
    query.featured = featured;
  }
  const state = oneQueryValue(params, 'state');
  if (state === '') throw badRequest('state is invalid');
  const resolvedState = state || (admin ? 'all' : 'open');
  if (!['open', 'all'].includes(resolvedState)) throw badRequest('state is invalid');
  query.state = resolvedState;
  const cursor = oneQueryValue(params, 'cursor');
  if (cursor !== undefined) {
    try { decodeCatalogCursor(cursor); } catch { throw badRequest('catalog cursor is invalid'); }
    query.cursor = cursor;
  }
  const limit = oneQueryValue(params, 'limit');
  if (limit !== undefined) {
    if (!/^[1-9]\d*$/.test(limit) || Number(limit) > 24) throw badRequest('limit is invalid');
    query.limit = Number(limit);
  }
  if (admin) {
    const status = oneQueryValue(params, 'status');
    if (status !== undefined) {
      if (!CATALOG_STATUSES.has(status)) throw badRequest('status is invalid');
      query.status = status;
    }
  } else if (params.has('status')) {
    throw badRequest('status is invalid');
  }
  return query;
}

function catalogViewer(user) {
  return user ? { id: user.id, permission: user.permission || user.role } : null;
}

function catalogPublicViewer(user) {
  return user ? { id: user.id, permission: 'member' } : null;
}

function catalogPublicProjection(item, lang, { interestStatus, historical = false } = {}) {
  const localized = localizeCatalogItem(item, lang, { fallback: historical });
  return {
    ...localized,
    organization: item.organization,
    location: item.location,
    topics: item.topics,
    startsAt: item.startsAt,
    deadlineAt: item.deadlineAt,
    endDate: item.endDate,
    sourceLabel: item.sourceLabel,
    sourceUrl: item.sourceUrl,
    sourceVerifiedAt: item.sourceVerifiedAt,
    actionMode: item.actionMode,
    actionUrl: item.actionUrl,
    featured: Boolean(item.featured),
    isClosed: isCatalogItemClosed(item),
    ...(interestStatus === undefined ? {} : { interestStatus }),
  };
}

function catalogAdminInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('catalog item is invalid');
  try {
    return body.status === 'published' ? validateCatalogPublication(body) : validateCatalogDraft(body);
  } catch (err) {
    throw badRequest(safeErrorMessage(err));
  }
}

function requiredVersion(value) {
  if (!Number.isInteger(value) || value < 1) throw badRequest('version is invalid');
  return value;
}

async function adminInterestProjection(repository, interest) {
  if (!interest) return null;
  const user = repository.toApiUser(await repository.getUserById(interest.userId));
  const item = interest.item || await repository.getCatalogItem(interest.itemId, { permission: 'admin' });
  return {
    id: interest.id,
    version: interest.version,
    member: { name: user?.fullName || '', email: user?.email || '' },
    item: {
      itemId: interest.itemId,
      title: item?.translations?.en?.title || '',
      kind: item?.kind || '',
      organization: item?.organization || '',
    },
    message: interest.message,
    status: interest.status,
  };
}

function resolveUserId(param, sessionUser, useDb) {
  if (param === 'me') return sessionUser?.id ?? null;
  if (!useDb) return param;
  return sessionUser?.id === param ? param : null;
}

/* Takes the canonical path — already decoded and normalised by
   canonicalPathname — so the private-page check and the file lookup can never
   disagree, and nothing is decoded a second time. */
async function serveStatic(req, res, canonical, pilotMode, { status = 200 } = {}) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, { error: 'method not allowed' }); return; }

  const filePath = staticSourcePath(canonical);
  if (!filePath) { send(res, 404, { error: 'not found' }); return; }

  const type = MIME[path.extname(filePath).toLowerCase()];
  if (!type) { send(res, 404, { error: 'not found' }); return; }

  try {
    const raw = await fs.readFile(filePath);
    const data = type.startsWith('text/html') ? preparePageHtml(raw.toString('utf8'), { pilotMode }) : raw;
    // Mail clients load the email logo from another origin (vercel.json sends the same policy in production).
    const headers = type.startsWith('text/html') ? htmlSecurityHeaders({}, canonical === '/course.html')
      : securityHeaders(canonical.startsWith('/assets/email/') ? { 'Cross-Origin-Resource-Policy': 'cross-origin' } : {});
    res.writeHead(status, {
      ...headers,
      ...(canonical==='/dashboard.html'?{'Permissions-Policy':'camera=(), microphone=(), geolocation=(self), payment=()'}:{}),
      ...(['/reset-password.html','/accept-invitation.html'].includes(canonical) ? { 'Referrer-Policy': 'no-referrer' } : {}),
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
  if (rel.startsWith('assets/fonts/')) {
    const name = rel.slice('assets/fonts/'.length);
    if (STATIC_FONTS.has(name)) return path.join(WEB_ROOT, 'assets', 'fonts', name);
  }
  if (rel.startsWith('assets/email/')) {
    const name = rel.slice('assets/email/'.length);
    if (STATIC_EMAIL_ASSETS.has(name)) return path.join(WEB_ROOT, 'assets', 'email', name);
  }
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
  locationProvider = createLocationProvider(),
  repository = createRepository({ db, store }),
  pilotMode = process.env.PILOT_MODE !== 'false',
  courseStore = repository?.database ? createCourseStore({db:repository.database}) : repository?.kind === 'supabase' ? createCourseStore() : null,
  fiiuStore = repository?.database ? createFiiuStore({db:repository.database}) : repository?.kind === 'supabase' ? createFiiuStore() : null,
  /* {secret, now} for the rotating FIIU check-in codes: FIIU_CHECKIN_SECRET, else derived from the Supabase server
     key, else (SQLite) random per process; the clock honours FIIU_CHECKIN_NOW only on a local SQLite server. */
  fiiuCheckin = fiiuStore ? {
    secret: resolveCheckinSecret(process.env, repository?.kind === 'supabase' ? 'supabase' : 'sqlite'),
    now: checkinClock(process.env, repository?.kind === 'supabase' ? 'supabase' : 'sqlite'),
  } : null,
  // text => {size, modules} QR encoder for the check-in screen; null makes the API answer qr: null.
  encodeQr = encodeQrCode,
  /* The FIIU registration summary email (server/fiiu-email.js), sent after a first registration, or null (off).
     Supabase sends through EMAIL_SMTP_URL; a local SQLite server only to a loopback mail catcher, so local work and
     tests never reach a real provider. Tests inject an outbox. */
  fiiuConfirmation = fiiuStore ? createRegistrationConfirmation({ loopbackOnly: repository?.kind !== 'supabase' }) : null,
  // Summary emails per hour: per account, and for the whole server instance (see fiiuEmailCeiling below).
  fiiuEmailLimits = { perAccount: 3, overall: 60 },
  /* The organiser's "Send the summary" button (POST /api/admin/fiiu/confirmations): emails per request and per UTC
     day, defaults in server/fiiu-confirmations.js. Its requests spend the FIIU write budget (fiiuWriteLimiter). */
  fiiuBackfill = {},
  newsStore = repository?.database ? createNewsStore({db:repository.database}) : repository?.kind === 'supabase' ? createNewsStore() : null,
} = {}) {
  const useDb = Boolean(repository);
  const networkSnapshots = repository ? createNetworkSnapshots(repository) : null;
  const placeSnapshots = new WeakMap();
  const fingerprints = new WeakMap();
  const fingerprintOf = graph => {
    if (!fingerprints.has(graph)) fingerprints.set(graph, graphFingerprint(graph));
    return fingerprints.get(graph);
  };
  const authLimiter = createWindowRateLimiter({ windowMs: AUTH_RATE_WINDOW_MS, limit: AUTH_RATE_LIMIT });
  const authAccountLimiter = createWindowRateLimiter({ windowMs: AUTH_RATE_WINDOW_MS, limit: AUTH_RATE_LIMIT });
  const authIpLimiter = createWindowRateLimiter({ windowMs: AUTH_RATE_WINDOW_MS, limit: AUTH_IP_RATE_LIMIT });
  const authAllowed = (limiter, key, res) => {
    const rate = limiter.take(key);
    if (rate.ok) return true;
    send(res, 429, { error: 'too many authentication attempts' }, { 'Retry-After': String(rate.retryAfter) });
    return false;
  };
  const authAccountKey = (action, email) => `${action}:${createHash('sha256').update(email).digest('hex')}`;
  // Failed sign-ins for one account from every requester together (see AUTH_ACCOUNT_RATE_LIMIT).
  const authAddressLimiter = createWindowRateLimiter({ windowMs: AUTH_RATE_WINDOW_MS, limit: AUTH_ACCOUNT_RATE_LIMIT });
  const signupEmailCeiling = createWindowRateLimiter({ windowMs: 60 * 60 * 1000, limit: SIGNUP_EMAIL_HOURLY_LIMIT });
  /* Recovery emails: three per address per requester, so nobody can spend a
     member's budget for them, and ten per address from everyone together, so one
     inbox cannot be flooded from many places. */
  const recoveryEmailLimiter = createWindowRateLimiter({ windowMs: 15 * 60 * 1000, limit: 3 });
  const recoveryAddressLimiter = createWindowRateLimiter({ windowMs: 15 * 60 * 1000, limit: 10 });
  const sessionRefreshFailures = createWindowRateLimiter({ windowMs: AUTH_RATE_WINDOW_MS, limit: SESSION_REFRESH_FAILURE_LIMIT });
  // The repository's own cleared-cookie headers; a logout without an access token makes no provider call.
  const clearedSessionCookies = async () => (await repository.logout({ headers: {} }, process.env))?.cookies || [];

  /* Supabase sessions cost GoTrue calls: /user for the access token and, when that
     is rejected, a refresh, which GoTrue rate-limits per IP (this server's IP).
     Cookies are checked here first, so a value that cannot be a session is never
     sent, and the refreshes one client address can make fail are budgeted. */
  function sessionCookieState(req) {
    const cookies = parseCookies(req.headers.cookie);
    const expiry = jwtExpiry(cookies.get(SUPABASE_ACCESS_COOKIE));
    return {
      present: cookies.has(SUPABASE_ACCESS_COOKIE) || cookies.has(SUPABASE_REFRESH_COOKIE),
      liveAccess: expiry !== null && expiry * 1000 > Date.now(),
      refreshUsable: usableRefreshToken(cookies.get(SUPABASE_REFRESH_COOKIE)),
      budgetKey: `session-refresh:${clientIp(req)}`,
    };
  }
  async function resolveRequestSession(req, options) {
    if (repository.kind !== 'supabase') return repository.resolveSession(req, options);
    const { present, liveAccess, refreshUsable, budgetKey } = sessionCookieState(req);
    if (!present) return { user: null, cookies: [] };
    if (liveAccess) {
      // The provider may still reject the token (revoked, forged) and fall back to the refresh token.
      const mayRefresh = refreshUsable && sessionRefreshFailures.peek(budgetKey);
      const result = await repository.resolveSession(mayRefresh ? req : withoutCookies(req, [SUPABASE_REFRESH_COOKIE]), options);
      if (mayRefresh && !result.user && result.cookies?.length) sessionRefreshFailures.take(budgetKey);
      return result;
    }
    // Missing, expired or malformed access token: only a refresh can lead to a session.
    if (!refreshUsable) return { user: null, cookies: await clearedSessionCookies() };
    // Over budget: signed out for this request, cookies kept for when the budget returns.
    if (!sessionRefreshFailures.take(budgetKey).ok) return { user: null, cookies: [] };
    let result;
    try {
      result = await repository.resolveSession(withoutCookies(req, [SUPABASE_ACCESS_COOKIE]), options);
    } finally {
      // Only a refresh the provider rejected stays counted; a session or an outage hands the unit back.
      if (!result || result.user) sessionRefreshFailures.release(budgetKey);
    }
    return result;
  }
  /* Sign-out revokes the session at the provider and may redeem the refresh token
     to do it. The route takes no other budget, so a token that cannot be live is
     not sent, and each refresh it may cost reserves a unit of the same per-address
     budget. The unit is handed back unless the provider rejected that refresh
     token, so members signing out together from one school network never use up
     the budget their classmates' session refreshes depend on. Over budget, the
     cookies are still cleared here; only the revocation is skipped. */
  async function logoutSession(req) {
    if (repository.kind !== 'supabase') return repository.logout(req, process.env);
    const { liveAccess, refreshUsable, budgetKey } = sessionCookieState(req);
    const drop = [];
    if (!liveAccess) drop.push(SUPABASE_ACCESS_COOKIE);
    const reserved = refreshUsable && sessionRefreshFailures.take(budgetKey).ok;
    if (!reserved) drop.push(SUPABASE_REFRESH_COOKIE);
    let result;
    try {
      result = await repository.logout(drop.length ? withoutCookies(req, drop) : req, process.env);
    } finally {
      if (reserved && !result?.refreshRejected) sessionRefreshFailures.release(budgetKey);
    }
    return result;
  }
  const interactionLimiter = createWindowRateLimiter({ windowMs: INTERACTION_RATE_WINDOW_MS, limit: INTERACTION_RATE_LIMIT });
  const recommendationLimiter = createWindowRateLimiter({ windowMs: 60 * 1000, limit: READ_RATE_LIMIT });
  // each search walks the whole directory, so it is bounded per member
  const searchLimiter = createWindowRateLimiter({ windowMs: MEMBER_SEARCH_WINDOW_MS, limit: MEMBER_SEARCH_RATE_LIMIT });
  const readLimiter = createWindowRateLimiter({ windowMs: 60 * 1000, limit: READ_RATE_LIMIT });
  const catalogReadLimiter = createWindowRateLimiter({ windowMs: 60 * 1000, limit: CATALOG_READ_RATE_LIMIT });
  const catalogWriteLimiter = createWindowRateLimiter({ windowMs: 60 * 1000, limit: CATALOG_WRITE_RATE_LIMIT });
  /* Polling has its own budget so an open globe cannot starve directory
     search. The browser refreshes every 15 seconds with jitter. */
  const networkLimiter = createWindowRateLimiter({ windowMs: 60 * 1000, limit: envInt('NETWORK_RATE_LIMIT', 40) });
  const writeLimiter = createWindowRateLimiter({ windowMs: 60 * 1000, limit: WRITE_RATE_LIMIT });
  const locationLimiter = createWindowRateLimiter({windowMs:60000,limit:6});
  const costlyLimiter = createWindowRateLimiter({ windowMs: COSTLY_RATE_WINDOW_MS, limit: COSTLY_RATE_LIMIT });
  /* Keyed by session when there is one, by address otherwise, so a limit
     follows the account rather than a shared office IP. */
  /* City names change hands rarely and cities never move, so a resolved point
     is cached for a month. Returns null when the provider cannot place it —
     the member is told, rather than being dropped somewhere wrong. */
  async function resolveCity(city, acceptLanguage) {
    const key = `place:v1:${String(city).trim().toLowerCase()}`;
    const remembered = await cache.get(key);
    /* A miss is remembered too, for a shorter time. Otherwise every rebuild of the
       globe's places asked a failing (or rate-limited) provider about the same
       cities again, one after another, inside the request. */
    if (remembered === 'null') return null;
    if (remembered) { try { return JSON.parse(remembered); } catch { /* refetch */ } }
    let point = null;
    try {
      const found = await citySearch.search(city, acceptLanguage);
      const best = (found.cities || []).find((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
      if (best) point = { lat: best.lat, lon: best.lon, label: best.label || city };
    } catch { point = null; }
    try {
      await cache.set(key, point ? JSON.stringify(point) : 'null', point ? PLACE_TTL_MS : PLACE_MISS_TTL_MS);
    } catch { /* an unavailable cache only costs a later lookup */ }
    return point;
  }

  const throttle = (limiter, res2, req2, user, scope) => {
    const rate = limiter.take(`${scope}:${user?.id || clientIp(req2)}`);
    if (rate.ok) return true;
    send(res2, 429, { error: 'too many requests' }, { 'Retry-After': String(rate.retryAfter) });
    return false;
  };
  const courseReadLimiter=createWindowRateLimiter({windowMs:60000,limit:120});
  const courseWriteLimiter=createWindowRateLimiter({windowMs:60000,limit:40});
  const courseUploadLimiter=createWindowRateLimiter({windowMs:60000,limit:6});
  const courseInvitationLimiter=createWindowRateLimiter({windowMs:60000,limit:6});
  const courseParticipants=courseStore?createCourseParticipants({store:courseStore,userRepository:repository}):null;
  const fiiuReadLimiter=createWindowRateLimiter({windowMs:60000,limit:120});
  // Festival attendees may open the public programme from the same venue Wi-Fi.
  // Keep that shared-IP budget separate from private per-account operations.
  const fiiuPublicReadLimiter=createWindowRateLimiter({windowMs:60000,limit:600});
  const fiiuWriteLimiter=createWindowRateLimiter({windowMs:60000,limit:30});
  // Door check-in: one organiser account may confirm a queue of arrivals from several
  // devices, so attendance toggles have their own budget and never spend or exhaust
  // the one for reviews, settings and publications.
  const fiiuCheckInLimiter=createWindowRateLimiter({windowMs:60000,limit:300});
  // Attendee QR check-ins: a person scans once per block, so 20 a minute leaves room for retries while making the
  // 6-character fallback code impractical to guess. Separate, so it never spends registration or organiser budgets.
  const fiiuSelfCheckInLimiter=createWindowRateLimiter({windowMs:60000,limit:20});
  // Summary emails: three per account per hour, so registering and cancelling in a loop cannot turn NODAL into a mailer,
  // and a ceiling across all accounts (60 an hour per server instance), which slows a handful of accounts doing that.
  // It does not by itself protect the sending account's daily quota (about 500 for Gmail, 2,000 for Workspace): 60 an
  // hour is 1,440 a day, and each Vercel instance keeps its own count. A durable per-day send ledger is the open
  // follow-up (October 3 review, fiiu-1). The account limit is checked first, so one account never spends the shared
  // ceiling beyond its own three. A registration over either limit keeps confirmation_status 'none' for the backfill.
  const fiiuEmailLimiter=createWindowRateLimiter({windowMs:60*60*1000,limit:fiiuEmailLimits.perAccount});
  const fiiuEmailCeiling=createWindowRateLimiter({windowMs:60*60*1000,limit:fiiuEmailLimits.overall});
  // Check-in links point at the configured public origin; only a server outside production falls back to its Host.
  const fiiuPublicOrigin=req=>{try{return publicBaseUrl();}catch(err){if(process.env.NODE_ENV==='production')throw err;return new URL(`http://${req.headers.host}`).origin;}};
  const fiiuApi=fiiuStore?createFiiuApi({store:fiiuStore,sameOrigin,send,checkin:fiiuCheckin??{},encodeQr,publicOrigin:fiiuPublicOrigin,
    confirmation:fiiuConfirmation,emailAllowed:user=>fiiuEmailLimiter.take(`fiiu-email:${user.id}`).ok&&fiiuEmailCeiling.take('fiiu-email:all').ok,backfill:fiiuBackfill,
    rateLimit:(req,res,user,pathname)=>['GET','HEAD'].includes(req.method)?throttle(user?fiiuReadLimiter:fiiuPublicReadLimiter,res,req,user,'fiiu')
      :req.method==='PUT'&&/^\/api\/admin\/fiiu\/registrations\/[^/]+\/attendance$/.test(pathname)?throttle(fiiuCheckInLimiter,res,req,user,'fiiu-checkin')
      :req.method==='POST'&&pathname==='/api/fiiu/checkin'?throttle(fiiuSelfCheckInLimiter,res,req,user,'fiiu-self-checkin')
      :throttle(fiiuWriteLimiter,res,req,user,'fiiu'),
  }):null;
  // NODAL news: guests read the public feed from shared venue or office Wi-Fi, so their budget mirrors the FIIU
  // public read one; the desk's writes share a small per-account budget.
  const newsReadLimiter=createWindowRateLimiter({windowMs:60000,limit:120});
  const newsPublicReadLimiter=createWindowRateLimiter({windowMs:60000,limit:600});
  const newsWriteLimiter=createWindowRateLimiter({windowMs:60000,limit:30});
  const newsApi=newsStore?createNewsApi({store:newsStore,sameOrigin,send,
    rateLimit:(req,res,user)=>['GET','HEAD'].includes(req.method)?throttle(user?newsReadLimiter:newsPublicReadLimiter,res,req,user,'news')
      :throttle(newsWriteLimiter,res,req,user,'news-write'),
  }):null;
  const courseApi=courseStore?createCourseApi({store:courseStore,userRepository:repository,sameOrigin,send,
    // Only an upload spends the upload budget; staff list the file library after every upload, use and delete.
    rateLimit:(req,res,user,pathname)=>throttle(pathname.endsWith('/invitations')?courseInvitationLimiter:req.method==='POST'&&pathname.endsWith('/attachments')?courseUploadLimiter:['GET','HEAD'].includes(req.method)?courseReadLimiter:courseWriteLimiter,res,req,user,'course'),
  }):null;
  /* Recommendations for a member outside the directory need their private graph:
     the shared directory plus their own profile, and every follow and interaction.
     The authoritative network revision moves on any write to those rows, so a
     cached answer is looked up by revision before any of that is read. Supabase
     revisions are one database-wide counter; SQLite's are per connection, so
     there the key is also tied to this server. */
  const revisionScope = repository?.kind === 'supabase' ? 'db' : randomUUID();
  async function buildUnlisted(snapshot, userId) {
    const key = `rec:v5:${revisionScope}:${userId}:${snapshot.revision}`;
    const cached = await cache.get(key);
    if (cached) return { payload: cached, hit: true };
    const graph = await repository.loadGraphStore({ viewerId: userId, directoryRows: snapshot.rows });
    if (!graph.users.has(userId)) return null;
    // The model trained on this private graph is kept under its own key, never the shared one.
    const recommendations = recommend(graph, userId, { modelKey: graphFingerprint(graph) }) ?? [];
    const payload = JSON.stringify({ userId, generatedAt: new Date().toISOString(), recommendations });
    await cache.set(key, payload, REC_TTL_MS);
    return { payload, hit: false };
  }

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
      if(pathname==='/api/config' && req.method==='GET') { send(res,200,{pilotMode});return; }
      const canonical = canonicalPathname(pathname);
      const isApiRequest = pathname.startsWith('/api/');
      const pageNeedsSession = !isApiRequest
        && canonical
        && (PRIVATE_PAGES.has(canonical) || canonical === '/login.html');
      // These endpoints authenticate their own submitted credentials/proof.
      // A stale browser session must not delay sign-in or password recovery.
      const authenticatesRequest = req.method === 'POST' && [
        '/api/auth/login', '/api/auth/signup', '/api/auth/logout',
        '/api/auth/recovery/request', '/api/auth/recovery/complete',
        '/api/auth/course-invitation/complete',
      ].includes(pathname);
      const needsSession = pageNeedsSession || (isApiRequest && !authenticatesRequest && !SESSIONLESS_API.has(pathname));
      const authorizationOnly = pageNeedsSession || pathname === '/api/auth/state'
        || /^\/api\/(?:fiiu|admin\/fiiu)(?:\/|$)/.test(pathname)
        || /^\/api\/(?:admin\/)?news(?:\/|$)/.test(pathname)
        || /^\/api\/(?:courses(?:\/|$)|admin\/courses(?:\/|$)|course-attachments\/|feedback(?:\/|$)|admin\/feedback(?:\/|$))/.test(pathname)
        || ID_ONLY_API.test(pathname) || (req.method === 'DELETE' && pathname === '/api/me');
      const optionalSession = (req.method === 'GET' || req.method === 'HEAD')
        && (isApiRequest ? OPTIONAL_SESSION_API.test(pathname) : canonical === '/login.html');
      let session = { user: null, cookies: [] };
      if (useDb && needsSession) {
        try {
          session = await resolveRequestSession(req, { authorizationOnly });
        } catch (err) {
          /* The session service is down (or rate limiting this server). A route
             that works without a member is served signed out, with the cookies
             left alone; the rest fail closed, a private page as a page. */
          if (err?.status !== 503) throw err;
          if (!optionalSession) {
            if (!isApiRequest) { console.error('request error:', safeErrorMessage(err)); sendUnavailablePage(req, res); return; }
            throw err;
          }
          console.error('session unavailable, serving signed out:', safeErrorMessage(err));
        }
      }
      const sessionUser = session.user;
      // A locale preference does not personalize catalog data (lang is in the
      // URL). Keep every other cookie private, including expired sessions.
      const hasPrivateCookies = (req.headers.cookie || '').split(';').some(value => {
        const cookie = value.trim();
        return cookie && !/^nodal\.lang=(?:en|es|pt)$/.test(cookie);
      });
      const catalogReadIsPrivate = Boolean(sessionUser || hasPrivateCookies);
      if (session.cookies?.length) res.setHeader('Set-Cookie', session.cookies);

      if (!pathname.startsWith('/api/')) {
        if (!canonical) { send(res, 400, { error: 'bad path' }); return; }
        if (useDb && PRIVATE_PAGES.has(canonical) && !sessionUser) {
          redirect(res, `/login.html?next=${encodeURIComponent(safeNext(canonical + url.search))}`);
          return;
        }
        if (useDb && ['/admin.html','/teaching.html','/fiiu-admin.html','/fiiu-qr.html'].includes(canonical) && (sessionUser?.permission || sessionUser?.role) !== 'admin') {
          // A member who follows an organiser link gets a page that explains it, carrying no organiser data or script.
          if (ORGANISER_PAGES.has(canonical) && ['GET','HEAD'].includes(req.method)) { await serveStatic(req, res, '/organisers-only.html', pilotMode, { status: 403 }); return; }
          send(res, 403, { error: 'administrator access required' });
          return;
        }
        if(pilotMode && canonical==='/payments.html') { redirect(res,'/courses.html');return; }
        if (useDb && canonical === '/login.html' && sessionUser) {
          redirect(res, safeNext(url.searchParams.get('next')));
          return;
        }
        await serveStatic(req, res, canonical, pilotMode);
        return;
      }

      // HEAD too: uptime probes default to it, and a 404 there reads as an outage
      if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/api/health') { send(res, 200, { ok: true }); return; }
      if(courseApi && await courseApi({req,res,url,user:sessionUser?repository.toApiUser(sessionUser):null}))return;
      if(fiiuApi && await fiiuApi({req,res,url,user:sessionUser?repository.toApiUser(sessionUser):null}))return;
      if(newsApi && await newsApi({req,res,url,user:sessionUser?repository.toApiUser(sessionUser):null}))return;

      if(req.method==='POST'&&pathname==='/api/auth/course-invitation/complete') {
        if(!sameOrigin(req)){send(res,403,{code:'invitation_forbidden'});return;}
        /* A class accepts its invitations together from one school network, so the
           address gets the classroom budget sign-up and sign-in have. The invitation
           token is the credential, and each one gets the strict budget instead. */
        const rate=authIpLimiter.take(`invitation:${clientIp(req)}`);
        if(!rate.ok){send(res,429,{code:'invitation_rate'},{'Retry-After':String(rate.retryAfter)});return;}
        if(!courseParticipants||!repository?.completeCourseInvitation){send(res,503,{code:'invitation_unavailable'});return;}
        const input=await readJsonBody(req);
        if(!input||typeof input!=='object'||Array.isArray(input)){send(res,400,{code:'invitation_invalid'});return;}
        if(typeof input.tokenHash==='string'){
          const tokenRate=authAccountLimiter.take(`invitation:${createHash('sha256').update(input.tokenHash).digest('hex')}`);
          if(!tokenRate.ok){send(res,429,{code:'invitation_rate'},{'Retry-After':String(tokenRate.retryAfter)});return;}
        }
        const result=await repository.completeCourseInvitation({tokenHash:input.tokenHash,password:input.password,fullName:input.fullName,authorize:courseParticipants.authorize,enroll:courseParticipants.accept});
        send(res,result.status,{ok:result.status<400,...(result.code?{code:result.code}:{}),...(result.passwordChanged?{passwordChanged:true}:{}),...(result.courseIds?{courseIds:result.courseIds}:{})},result.cookies?.length?{'Set-Cookie':result.cookies}:{});
        return;
      }

      if (useDb && req.method === 'GET' && pathname === '/api/catalog') {
        const query = catalogQueryFromUrl(url.searchParams);
        if (!throttle(catalogReadLimiter, res, req, sessionUser, 'catalog-read')) return;
        const result = await repository.listCatalogItems(query, catalogPublicViewer(sessionUser));
        const payload = {
          items: result.items.map((item) => catalogPublicProjection(item, query.lang)),
          nextCursor: result.nextCursor,
        };
        if (catalogReadIsPrivate) { send(res, 200, payload); return; }
        const serialized = JSON.stringify(payload);
        const etag = entityTag(serialized);
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, securityHeaders({ ETag: etag, Vary: 'Cookie', 'Cache-Control': CATALOG_PUBLIC_CACHE_CONTROL }));
          res.end();
          return;
        }
        send(res, 200, serialized, { ETag: etag, Vary: 'Cookie', 'Cache-Control': CATALOG_PUBLIC_CACHE_CONTROL, 'Content-Type': 'application/json; charset=utf-8' });
        return;
      }

      let catalogMatch = pathname.match(/^\/api\/catalog\/([a-z0-9-]{1,40})$/);
      if (useDb && req.method === 'GET' && catalogMatch) {
        const suppliedLang = oneQueryValue(url.searchParams, 'lang');
        const lang = suppliedLang || 'en';
        if (suppliedLang === '' || !['en', 'es', 'pt'].includes(lang) || [...url.searchParams.keys()].some((key) => key !== 'lang')) throw badRequest('catalog detail query is invalid');
        const item = await repository.getCatalogItem(catalogMatch[1], catalogPublicViewer(sessionUser));
        if (!item) { send(res, 404, { error: 'catalog item not found' }); return; }
        let interestStatus;
        if (sessionUser) {
          interestStatus = (await repository.getCatalogInterest(item.id, sessionUser.id))?.status ?? null;
        }
        const payload = { item: catalogPublicProjection(item, lang, sessionUser ? { interestStatus } : {}) };
        if (catalogReadIsPrivate) { send(res, 200, payload); return; }
        const serialized = JSON.stringify(payload);
        const etag = entityTag(serialized);
        if (req.headers['if-none-match'] === etag) {
          res.writeHead(304, securityHeaders({ ETag: etag, Vary: 'Cookie', 'Cache-Control': CATALOG_PUBLIC_CACHE_CONTROL }));
          res.end();
          return;
        }
        send(res, 200, serialized, { ETag: etag, Vary: 'Cookie', 'Cache-Control': CATALOG_PUBLIC_CACHE_CONTROL, 'Content-Type': 'application/json; charset=utf-8' });
        return;
      }

      catalogMatch = pathname.match(/^\/api\/catalog\/([a-z0-9-]{1,40})\/interest$/);
      if (useDb && catalogMatch && (req.method === 'PUT' || req.method === 'DELETE')) {
        if (!requireAuth(res, sessionUser)) return;
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-origin request rejected' }); return; }
        if (!throttle(catalogWriteLimiter, res, req, sessionUser, 'catalog-interest')) return;
        const itemId = catalogMatch[1];
        if (req.method === 'PUT') {
          const item = await repository.getCatalogItem(itemId, catalogPublicViewer(sessionUser));
          if (!item || item.actionMode !== 'interest' || isCatalogItemClosed(item)) {
            send(res, 404, { error: 'catalog item does not accept interest' });
            return;
          }
          const body = await readJsonBody(req);
          let message;
          try { message = validateCatalogInterestMessage(body.message); } catch (err) { throw badRequest(safeErrorMessage(err)); }
          const interest = await repository.upsertCatalogInterest(itemId, sessionUser.id, message);
          send(res, 200, { interest: { itemId: interest.itemId, status: interest.status, message: interest.message } });
          return;
        }
        const existing = await repository.getCatalogInterest(itemId, sessionUser.id);
        if (!existing) { send(res, 404, { error: 'catalog interest not found' }); return; }
        const withdrawn = existing.status === 'withdrawn' || await repository.withdrawCatalogInterest(itemId, sessionUser.id);
        if (!withdrawn) { send(res, 404, { error: 'catalog interest not found' }); return; }
        send(res, 200, { interest: {
          itemId,
          status: 'withdrawn',
          message: existing?.message || '',
        } });
        return;
      }

      if (useDb && req.method === 'GET' && pathname === '/api/me/catalog-interests') {
        if (!requireAuth(res, sessionUser)) return;
        const requestedLang = oneQueryValue(url.searchParams, 'lang');
        const lang = requestedLang === undefined ? 'en' : requestedLang;
        const limit = oneQueryValue(url.searchParams, 'limit');
        const cursor = oneQueryValue(url.searchParams, 'cursor');
        if (!['en', 'es', 'pt'].includes(lang) || [...url.searchParams.keys()].some((key) => !['lang', 'limit', 'cursor'].includes(key))) throw badRequest('catalog interests query is invalid');
        if (limit !== undefined && (!/^[1-9]\d*$/.test(limit) || Number(limit) > 24)) throw badRequest('limit is invalid');
        if (cursor !== undefined) {
          try { decodeCatalogInterestCursor(cursor); } catch { throw badRequest('interest cursor is invalid'); }
        }
        const result = await repository.listCatalogInterestsForUser(sessionUser.id, {
          limit: limit === undefined ? undefined : Number(limit), cursor,
        });
        send(res, 200, {
          interests: result.interests.map((interest) => ({
            itemId: interest.itemId,
            status: interest.status,
            message: interest.message,
            item: interest.item?.status === 'published'
              ? { ...catalogPublicProjection(interest.item, lang, { historical: true }), status: interest.item.status }
              : null,
          })),
          nextCursor: result.nextCursor,
        });
        return;
      }

      if (useDb && req.method === 'GET' && pathname === '/api/admin/catalog') {
        if (!requireAdmin(res, sessionUser)) return;
        const query = catalogQueryFromUrl(url.searchParams, { admin: true });
        const result = await repository.listCatalogItems(query, catalogViewer(sessionUser));
        send(res, 200, result);
        return;
      }

      if (useDb && req.method === 'POST' && pathname === '/api/admin/catalog') {
        if (!requireAdmin(res, sessionUser)) return;
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-origin request rejected' }); return; }
        if (!throttle(catalogWriteLimiter, res, req, sessionUser, 'admin-catalog')) return;
        const item = await repository.createCatalogItem(catalogAdminInput(await readJsonBody(req)), sessionUser.id);
        send(res, 201, { item });
        return;
      }

      let adminMatch = pathname.match(/^\/api\/admin\/catalog\/([a-z0-9-]{1,40})$/);
      if (useDb && req.method === 'PATCH' && adminMatch) {
        if (!requireAdmin(res, sessionUser)) return;
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-origin request rejected' }); return; }
        if (!throttle(catalogWriteLimiter, res, req, sessionUser, 'admin-catalog')) return;
        const body = await readJsonBody(req);
        const version = requiredVersion(body.version);
        const input = catalogAdminInput(body);
        try {
          const item = await repository.updateCatalogItem(adminMatch[1], input, version, sessionUser.id);
          if (!item) { send(res, 404, { error: 'catalog item not found' }); return; }
          send(res, 200, { item });
        } catch (err) {
          if (err?.code !== 'CATALOG_VERSION_CONFLICT') throw err;
          const current = await repository.getCatalogItem(adminMatch[1], catalogViewer(sessionUser));
          send(res, 409, { error: 'catalog item changed by another editor', current });
        }
        return;
      }

      if (useDb && req.method === 'GET' && pathname === '/api/admin/interests') {
        if (!requireAdmin(res, sessionUser)) return;
        const status = oneQueryValue(url.searchParams, 'status');
        const limit = oneQueryValue(url.searchParams, 'limit');
        const cursor = oneQueryValue(url.searchParams, 'cursor');
        if ([...url.searchParams.keys()].some((key) => !['status', 'limit', 'cursor'].includes(key))) throw badRequest('admin interests query is invalid');
        if (status !== undefined && !['new', 'contacted', 'closed', 'withdrawn'].includes(status)) throw badRequest('interest status is invalid');
        if (limit !== undefined && (!/^[1-9]\d*$/.test(limit) || Number(limit) > 24)) throw badRequest('limit is invalid');
        if (cursor !== undefined) {
          try { decodeCatalogInterestCursor(cursor); } catch { throw badRequest('interest cursor is invalid'); }
        }
        const result = await repository.listAdminInterests({ status, limit: limit === undefined ? undefined : Number(limit), cursor });
        const interests = await Promise.all(result.interests.map((interest) => adminInterestProjection(repository, interest)));
        send(res, 200, { interests, nextCursor: result.nextCursor });
        return;
      }

      adminMatch = pathname.match(/^\/api\/admin\/interests\/([a-z0-9-]{1,40})$/);
      if (useDb && req.method === 'PATCH' && adminMatch) {
        if (!requireAdmin(res, sessionUser)) return;
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-origin request rejected' }); return; }
        if (!throttle(catalogWriteLimiter, res, req, sessionUser, 'admin-interest')) return;
        const body = await readJsonBody(req);
        const version = requiredVersion(body.version);
        if (!['new', 'contacted', 'closed', 'withdrawn'].includes(body.status)) throw badRequest('interest status is invalid');
        try {
          const interest = await repository.updateCatalogInterest(adminMatch[1], { status: body.status }, version, sessionUser.id);
          if (!interest) { send(res, 404, { error: 'catalog interest not found' }); return; }
          send(res, 200, { interest: { id: interest.id, version: interest.version, status: interest.status } });
        } catch (err) {
          if (err?.code !== 'CATALOG_VERSION_CONFLICT') throw err;
          const current = await repository.getCatalogInterestById(adminMatch[1]);
          send(res, 409, { error: 'catalog interest changed by another editor', current: await adminInterestProjection(repository, current) });
        }
        return;
      }

      if (req.method === 'GET' && pathname === '/api/billing/config') {
        // Amounts are published only when checkout could actually run.
        send(res, 200, publicBillingConfig(process.env, { checkout: !pilotMode && Boolean(payments?.config) }));
        return;
      }

      if (req.method === 'GET' && pathname === '/api/cities') {
        if (useDb && !requireAuth(res, sessionUser)) return;
        if (!throttle(readLimiter, res, req, sessionUser, 'cities')) return;
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
        if (!authAllowed(authIpLimiter, clientIp(req), res)) return;
        const body = await readJsonBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) { send(res, 400, { error: 'JSON object required' }); return; }
        const fullName = String(body.fullName ?? body.name ?? '').trim();
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (fullName.length < 2) { send(res, 400, { error: 'full name is required' }); return; }
        if (email.length > 254 || !validateEmail(email)) { send(res, 400, { error: 'valid email is required' }); return; }
        if (!validatePassword(password)) { send(res, 400, { error: 'password must be 8 to 72 characters' }); return; }
        if (!authAllowed(authAccountLimiter, authAccountKey('signup', email), res)) return;
        const ceiling = signupEmailCeiling.take('signup-email:all');
        if (!ceiling.ok) {
          send(res, 429, { error: 'Confirmation email is temporarily unavailable. Please try again later.' }, { 'Retry-After': String(ceiling.retryAfter) });
          return;
        }
        let result;
        try {
          result = await repository.signup({ fullName, email, password, env: process.env });
          // A refused sign-up sent no email, so it does not count against the ceiling.
          if (result?.error) signupEmailCeiling.release('signup-email:all');
        } catch (err) {
          if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500) signupEmailCeiling.release('signup-email:all');
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

      if (useDb && req.method === 'POST' && ['/api/auth/recovery/request', '/api/auth/recovery/complete'].includes(pathname)) {
        if (!sameOrigin(req)) { send(res, 403, { code: 'recovery_forbidden' }); return; }
        const rate = authLimiter.take(`recovery:${clientIp(req)}`);
        if (!rate.ok) { send(res, 429, { code: 'recovery_rate' }, { 'Retry-After': String(rate.retryAfter) }); return; }
        const body = await readJsonBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) { send(res, 400, { code: 'recovery_invalid' }); return; }
        let result;
        if (pathname.endsWith('/request')) {
          if (!repository.requestPasswordRecovery) { send(res, 503, { code: 'recovery_unavailable' }); return; }
          const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
          if (email.length > 254 || !validateEmail(email)) { send(res, 400, { code: 'recovery_email' }); return; }
          /* Keyed by requester first, so somebody else's requests never use up a
             member's own. Over budget is said plainly (the page shows "Too many
             attempts"); it applies to every address alike, so it reveals nothing
             about whether an account exists. A silent "sent" left members waiting
             for an email that never came. */
          const emailKey = createHash('sha256').update(email).digest('hex');
          const own = recoveryEmailLimiter.take(`${emailKey}:${clientIp(req)}`);
          const shared = own.ok ? recoveryAddressLimiter.take(emailKey) : own;
          if (!shared.ok) { send(res, 429, { code: 'recovery_rate' }, { 'Retry-After': String(shared.retryAfter) }); return; }
          result = await repository.requestPasswordRecovery({ email, req });
        } else {
          if (!repository.completePasswordRecovery) { send(res, 503, { code: 'recovery_unavailable' }); return; }
          result = await repository.completePasswordRecovery({ req, code: body.code, password: body.password });
        }
        send(res, result.status, { ok: result.status < 400, ...(result.code ? { code: result.code } : {}), ...(result.passwordChanged ? { passwordChanged: true } : {}) }, result.cookies?.length ? { 'Set-Cookie': result.cookies } : {});
        return;
      }

      if (useDb && req.method === 'POST' && pathname === '/api/auth/login') {
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-origin request rejected' }); return; }
        if (!authAllowed(authIpLimiter, clientIp(req), res)) return;
        const body = await readJsonBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) { send(res, 400, { error: 'JSON object required' }); return; }
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (email.length > 254 || !validateEmail(email) || !password) { send(res, 401, { error: 'invalid email or password' }); return; }
        /* Only wrong passwords count. Each attempt reserves a unit in both budgets
           before the check, so parallel guesses cannot all get past, and hands it
           back unless the password was wrong. A sign-in also forgives this
           requester's earlier mistakes. */
        const accountKey = authAccountKey('login', email);
        const requesterKey = `${accountKey}:${clientIp(req)}`;
        if (!authAllowed(authAccountLimiter, requesterKey, res)) return;
        if (!authAllowed(authAddressLimiter, accountKey, res)) { authAccountLimiter.release(requesterKey); return; }
        let result;
        try {
          result = await repository.login({ email, password, env: process.env });
        } finally {
          if (result?.status !== 401) { authAccountLimiter.release(requesterKey); authAddressLimiter.release(accountKey); }
        }
        if (!result.error && result.status < 400) authAccountLimiter.reset(requesterKey);
        if (result.error) { send(res, result.status, { error: result.error }); return; }
        send(res, result.status, { user: result.user }, result.cookies?.length ? { 'Set-Cookie': result.cookies } : {});
        return;
      }

      if (useDb && req.method === 'POST' && pathname === '/api/auth/logout') {
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-origin request rejected' }); return; }
        const result = await logoutSession(req);
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
        if (!throttle(costlyLimiter, res, req, sessionUser, 'export')) return;
        const data=await repository.exportUserData(sessionUser.id);
        if(courseStore)data.coursePilot=await exportCourseData(courseStore,sessionUser.id);
        if(fiiuStore)data.fiiu=await exportFiiuData(fiiuStore,sessionUser.id);
        send(res, 200, { data });
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
        /* Deleting the account removes the only record that ties a Stripe
           subscription to this member, while Stripe would go on charging them.
           The membership is cancelled first. */
        const subscription = repository.getSubscriptionStatus ? await repository.getSubscriptionStatus(sessionUser.id) : null;
        if (LIVE_SUBSCRIPTION_STATUSES.has(subscription?.status)) {
          send(res, 409, { error: 'Cancel your NODAL membership before deleting your account. Contact NODAL if you need help cancelling it.', code: 'subscription_active' });
          return;
        }
        if(courseStore)await deleteCourseData(courseStore,sessionUser.id);
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

      if(useDb&&req.method==='POST'&&['/api/me/location/suggest','/api/me/location/accept'].includes(pathname)) {
        if(!requireAuth(res,sessionUser))return;
        if(!sameOrigin(req)){send(res,403,{error:'cross-origin request rejected'});return;}
        if(!throttle(locationLimiter,res,req,sessionUser,'location'))return;
        if(url.search){send(res,400,{error:'location_invalid'});return;}
        const input=await readJsonBody(req);
        if(!input||typeof input!=='object'||Array.isArray(input)){send(res,400,{error:'location_invalid'});return;}
        if(pathname.endsWith('/suggest')) {
          const position=validatePosition(input);
          send(res,200,await locationProvider.suggest(position));return;
        }
        const cityId=validateCityId(input.cityId);
        if(typeof input.expectedCity!=='string'||input.expectedCity.length>120){send(res,400,{error:'location_invalid'});return;}
        const city=await locationProvider.city(cityId);
        const user=await repository.acceptUserLocation(sessionUser.id,city,input.expectedCity);
        if(!user){send(res,409,{error:'location_conflict'});return;}
        send(res,200,{user:repository.toApiUser(user)});return;
      }

      if (useDb && req.method === 'PATCH' && pathname === '/api/me') {
        if (!requireAuth(res, sessionUser)) return;
        if (!throttle(writeLimiter, res, req, sessionUser, 'profile')) return;
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-origin request rejected' }); return; }
        const patch = sanitizeProfilePatch(await readJsonBody(req));
        if(patch.expectedCity!==undefined&&(typeof patch.expectedCity!=='string'||patch.expectedCity.length>120)){send(res,400,{error:'location_invalid'});return;}
        const before = repository.toApiUser(await repository.getUserById(sessionUser.id));
        let user = await repository.updateUserProfile(sessionUser.id, patch);
        let saved = repository.toApiUser(user);

        /* The pin follows the city, and only the city. Coordinates are resolved
           here rather than accepted from the body, so nobody can drop their own
           pin on an arbitrary address, and the map never needs a geocoder when
           it is being drawn. */
        const cityChanged = String(saved.city || '') !== String(before?.city || '');
        if (repository.setUserLocation && (cityChanged || (saved.city && !saved.location))) {
          const point = saved.city ? await resolveCity(saved.city, req.headers['accept-language']) : null;
          user = await repository.setUserLocation(sessionUser.id, point, saved.city);
          saved = repository.toApiUser(user);
        }
        send(res, 200, { user: saved });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/users') {
        if (useDb) {
          if (!requireAuth(res, sessionUser)) return;
          if (!throttle(readLimiter, res, req, sessionUser, 'directory')) return;
          const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200));
          const rows = (await networkSnapshots.read()).rows;
          const cursor = url.searchParams.get('cursor');
          const index = cursor ? rows.findIndex(row => row.id === cursor) : -1;
          if (cursor && index < 0) { send(res, 400, { error: 'directory cursor expired; restart pagination' }); return; }
          const page = rows.slice(index + 1, index + 1 + Math.floor(limit));
          send(res, 200, {
            total: rows.length,
            nextCursor: index + 1 + page.length < rows.length ? page.at(-1).id : null,
            users: page.map((row) => {
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
         month because cities do not move. Snapshot revision checks make
         committed profile and consent changes visible on the next request. */
      if (useDb && req.method === 'GET' && pathname === '/api/network/places') {
        if (!requireAuth(res, sessionUser)) return;
        if (!throttle(networkLimiter, res, req, sessionUser, 'places')) return;
        const topic = String(url.searchParams.get('topic') || '').trim().slice(0, 80);
        const serialized = await networkSnapshots.run(async snapshot => {
          let variants = placeSnapshots.get(snapshot);
          if (!variants) { variants = new Map(); placeSnapshots.set(snapshot, variants); }
          const variant = topic.toLowerCase();
          let work = variants.get(variant);
          if (!work) {
            // Bound topic variants independently of the profile directory size.
            if (variants.size >= 32) variants.delete(variants.keys().next().value);
            work = (async () => {
              const rows = snapshot.rows;
              const groups = new Map();
              const cityOf = new Map();
              const topics = new Map();
              for (const row of rows) {
                const user = repository.toApiUser(row);
                (user.topics || []).forEach((entry) => {
                  const name = String(entry?.name || entry || '').trim();
                  if (name) topics.set(name, (topics.get(name) || 0) + 1);
                });
                // the filter narrows who is counted, never who exists
                if (topic && !(user.topics || []).some((entry) => String(entry?.name || entry || '').trim().toLowerCase() === topic.toLowerCase())) continue;
                const city = String(user.city || '').trim();
                if (!city) continue;
                const key = city.toLowerCase();
                if (!groups.has(key)) groups.set(key, { city, point: user.location || null, members: [] });
                if (!groups.get(key).point && user.location) groups.get(key).point = user.location;
                cityOf.set(user.id, key);
                groups.get(key).members.push({
                  id: user.id,
                  name: user.fullName,
                  role: user.title,
                  linkedin: user.linkedin || '',
                  /* A member can be in the directory and still choose not to be named
                     on a map. Absent on older profiles, which means named. */
                  named: user.partC?.listName !== false,
                  joinedAt: user.createdAt || null,
                });
              }

              /* Almost every city arrives already placed — the coordinate is resolved
                 and stored when the member saves their profile. The rest are looked
                 up here, one at a time behind the provider's minimum interval, so a
                 backlog of them would hold the request open for a second each and run
                 the function past its timeout. A few per request is enough: a found
                 point is cached for a month, so the backlog drains over a handful of
                 polls and every city lands within a minute. A city the provider
                 cannot place, or a failed lookup, is retried after ten minutes. */
              let geocodeBudget = NETWORK_GEOCODE_PER_REQUEST;
              /* Lookups also share a time budget: a slow or hanging provider would
                 otherwise hold the poll for its whole timeout per city. A lookup cut
                 short keeps running and caches its answer for the next build. */
              const geocodeDeadline = Date.now() + NETWORK_GEOCODE_BUDGET_MS;
              const places = [];
              for (const group of groups.values()) {
                let point = group.point;
                const remainingMs = geocodeDeadline - Date.now();
                if (!point && geocodeBudget > 0 && remainingMs > 0) {
                  geocodeBudget -= 1;
                  let timer;
                  point = await Promise.race([
                    resolveCity(group.city, req.headers['accept-language']),
                    new Promise(resolve => { timer = setTimeout(resolve, remainingMs, null); }),
                  ]).finally(() => clearTimeout(timer));
                }
                if (!point) continue;
                const named = group.members.filter((m) => m.named);
                places.push({
                  city: group.city,
                  label: point.label,
                  lat: point.lat,
                  lon: point.lon,
                  members: group.members.length,
                  named: named.length,
                  since: group.members.reduce((first, m) => (m.joinedAt && (!first || m.joinedAt < first) ? m.joinedAt : first), null),
                  people: named.slice(0, 12).map((m) => ({
                    id: m.id, name: m.name, role: m.role, linkedin: m.linkedin, joinedAt: m.joinedAt,
                  })),
                });
              }

              /* Real links, not geometry: who follows whom, rolled up to the pair of
                 cities they sit in. Aggregated on purpose — the map says two places
                 are connected and how strongly, never which two people. */
              const placeIndex = new Map(places.map((p, i) => [p.city.toLowerCase(), i]));
              const pairs = new Map();
              try {
                const graph = snapshot.graph;
                for (const [from, targets] of graph.follows) {
                  const a = placeIndex.get(cityOf.get(from));
                  if (a === undefined) continue;
                  for (const to of targets) {
                    const b = placeIndex.get(cityOf.get(to));
                    if (b === undefined || a === b) continue;
                    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
                    pairs.set(key, (pairs.get(key) || 0) + 1);
                  }
                }
              } catch { /* graph unavailable: the map still draws its places */ }
              const links = [...pairs].map(([key, weight]) => {
                const [a, b] = key.split(':').map(Number);
                return { a, b, weight };
              });

              return {
                members: places.reduce((n, p) => n + p.members, 0),
                places,
                links,
                topics: [...topics].sort((x, y) => y[1] - x[1]).map(([name, n]) => ({ name, members: n })),
              };
            })();
            variants.set(variant, work);
            work.catch(() => { if (variants.get(variant) === work) variants.delete(variant); });
          }
          const shared = await work;
          const viewerRow = snapshot.rows.find(row => row.id === sessionUser.id);
          const viewer = viewerRow ? repository.toApiUser(viewerRow) : null;
          const city = String(viewer?.city || '').trim();
          return JSON.stringify({ ...shared, you: {
            listed: Boolean(viewer), hasCity: city !== '',
            onMap: Boolean(viewer) && city !== '' && shared.places.some(p => p.city.toLowerCase() === city.toLowerCase()),
            city,
          } });
        });
        const etag = entityTag(serialized);
        if (req.headers['if-none-match'] === etag) { sendNotModified(res, etag); return; }
        send(res, 200, serialized, { 'X-Cache': 'MISS', ETag: etag, 'Content-Type': 'application/json; charset=utf-8' });
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
        const rows = (await networkSnapshots.read()).rows;
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
        // The session was freshly resolved for this request, including role
        // and account status; do not fetch its own full profile a second time.
        const row = id === sessionUser.id ? sessionUser : await repository.getUserById(id);
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
        if (!throttle(recommendationLimiter, res, req, sessionUser, 'recommendations')) return;
        const build = async snapshot => {
          // An unlisted viewer's own graph is private and never enters shared
          // snapshots or shared model keys. Listed members reuse one graph.
          if (snapshot && !snapshot.graph.users.has(userId)) return buildUnlisted(snapshot, userId);
          const activeStore = snapshot ? snapshot.graph : store;
          if (!activeStore.users.has(userId)) return null;
          const fingerprint = snapshot ? fingerprintOf(activeStore) : graphFingerprint(activeStore);
          const key = `rec:v4:${userId}:${fingerprint}`;
          const cached = await cache.get(key);
          if (cached) return { payload: cached, hit: true };
          const recommendations = recommend(activeStore, userId, { modelKey: fingerprint }) ?? [];
          const payload = JSON.stringify({ userId, generatedAt: new Date().toISOString(), recommendations });
          await cache.set(key, payload, REC_TTL_MS);
          return { payload, hit: false };
        };
        const result = useDb ? await networkSnapshots.run(build) : await build(null);
        if (!result) { send(res, 404, { error: 'unknown user' }); return; }
        send(res, 200, result.payload, { 'X-Cache': result.hit ? 'HIT' : 'MISS', 'Content-Type': 'application/json; charset=utf-8' });
        return;
      }

      m = pathname.match(/^\/api\/users\/([^/]+)\/(follow|interactions)$/);
      if (m && req.method === 'POST') {
        if (useDb && !requireAuth(res, sessionUser)) return;
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-origin request rejected' }); return; }
        const userId = resolveUserId(m[1], sessionUser, useDb);
        const action = m[2];
        if (!userId) { send(res, 403, { error: 'forbidden user scope' }); return; }
        if (!ID_RE.test(userId) || (!useDb && !store.users.has(userId))) { send(res, 404, { error: 'unknown user' }); return; }
        // Invalid attempts consume the budget too, before parsing or repository IO.
        const rate = interactionLimiter.take(action === 'follow' ? `follow:${userId}` : userId);
        if (!rate.ok) {
          send(res, 429, { error: 'too many interaction requests' }, { 'Retry-After': String(rate.retryAfter) });
          return;
        }

        const body = await readJsonBody(req);
        const targetId = body.targetId;
        if (typeof targetId !== 'string' || !ID_RE.test(targetId) || targetId === userId) {
          send(res, 400, { error: 'invalid targetId' });
          return;
        }
        if (action === 'interactions' && !API_INTERACTION_TYPES.has(body.type)) { send(res, 400, { error: 'invalid interaction type' }); return; }
        const target = useDb ? repository.toApiUser(await repository.getUserById(targetId)) : store.users.get(targetId);
        if (!target || (useDb && (target.accountStatus !== 'active' || target.partC?.consent !== true))) {
          send(res, 400, { error: 'invalid targetId' }); return;
        }

        if (action === 'follow') {
          if (useDb) await repository.addFollow(userId, targetId);
          else addFollow(store, userId, targetId);
        } else {
          if (useDb) await repository.recordInteraction(userId, targetId, body.type);
          else recordInteraction(store, userId, targetId, body.type);
        }

        // Database revisions (or the demo graph fingerprint) invalidate derived
        // recommendations without rebuilding the whole network on each write.
        send(res, 200, { ok: true, userId, targetId, action });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/checkout') {
        if (useDb && !requireAuth(res, sessionUser)) return;
        if (!sameOrigin(req)) { send(res, 403, { error: 'cross-origin request rejected' }); return; }
        if(pilotMode) { send(res,409,{error:'payments are unavailable during the prototype pilot'});return; }
        if (!throttle(costlyLimiter, res, req, sessionUser, 'checkout')) return;
        const body = await readJsonBody(req);
        if (body.plan !== 'membership' || !CYCLES.has(body.cycle)) {
          send(res, 400, { error: 'invalid plan or cycle' });
          return;
        }
        if (!payments.config) { send(res, 501, { error: 'payments not configured' }); return; }
        /* A second Checkout Session would open a second subscription next to the
           live one: the member is billed twice, and the one stored row then follows
           whichever subscription sent the last event. */
        if (useDb && LIVE_SUBSCRIPTION_STATUSES.has((await repository.getSubscriptionStatus(sessionUser.id))?.status)) {
          send(res, 409, { error: 'You already have a NODAL membership.', code: 'already_subscribed' });
          return;
        }
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
      /* Only our own wording goes back. A backend's message (marked
         expose: false where it is raised) names columns, constraints and
         internal state, and this is the one place it would reach a caller. */
      if (status >= 500 || err?.expose === false) console.error('request error:', safeErrorMessage(err));
      const body = status >= 500 ? 'internal error' : (err?.expose === false ? 'request failed' : safeErrorMessage(err));
      if (!res.headersSent) send(res, status, { error: body });
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
