/* Server-side error reports to Sentry, over its plain HTTP envelope API, so the server keeps zero dependencies.
   Off unless SENTRY_DSN is set. A report carries only what fixing needs: the error's type, its message with emails,
   tokens and ids removed, its code locations relative to the app, the request method, the route with ids replaced and
   the status. It never carries a query string, header, cookie, body, IP address or account. Each instance sends at most
   `perMinute` reports a minute and one per identical error and route a minute, so a crash loop cannot burn the quota,
   and a report never waits longer than `timeoutMs` nor throws. */
import { randomUUID } from 'node:crypto';

const MESSAGE_MAX = 500;
// Scrubbing reads at most this much of a message, so a huge one costs no more than a normal one.
const SCRUB_INPUT_MAX = 4000;
const FRAMES_MAX = 30;
const SEGMENTS_MAX = 8;

export function sentryEndpoint(dsn) {
  try {
    const url = new URL(String(dsn ?? '').trim());
    const parts = url.pathname.split('/').filter(Boolean), project = parts.pop();
    if (url.protocol !== 'https:' || !url.username || !/^\d+$/.test(project ?? '')) return null;
    return { url: `${url.origin}${parts.length ? `/${parts.join('/')}` : ''}/api/${project}/envelope/`, key: decodeURIComponent(url.username) };
  } catch {
    return null;
  }
}

// Emails (also %40-encoded, and with comments such as ana(trabajo)@…), query-string values, JWTs, bearer values and Supabase keys, then ids, then any long mixed run of letters and digits
// (keys, tokens), then long numbers such as phones and national ids. An error code such as participant_enrollment_closed
// has no digit and stays readable; so do short numbers like a line or an HTTP status.
export function scrub(text) {
  return String(text ?? '').slice(0, SCRUB_INPUT_MAX).replace(/%40/gi, '@')
    .replace(/[^\s"<>]+@[^\s"<>]+/g, '[email]')
    .replace(/([?&][^=\s&?#"'<>]+=)[^\s&#"'<>]+/g, '$1[value]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g, '[token]')
    .replace(/\bBearer\s+\S+/gi, '[token]')
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[token]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/\b[0-9a-f]{16,}\b/gi, '[id]')
    .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g, '[token]')
    .replace(/\+?\d(?:[\s().-]?\d){6,}/g, '[number]')
    .slice(0, MESSAGE_MAX).toWellFormed();
}

// The route a request took, without its query string. Only NODAL's own path words survive (lowercase letters, dots,
// dashes, underscores: api, courses, payments.html); any other segment, an id, a number, a name, a token, is :id.
export function routeOf(rawUrl) {
  let pathname = '/';
  try { pathname = new URL(`http://route.invalid${String(rawUrl ?? '').startsWith('/') ? '' : '/'}${rawUrl ?? ''}`).pathname; } catch { /* stays / */ }
  const segments = pathname.split('/').filter(Boolean).slice(0, SEGMENTS_MAX).map((segment) => {
    return /^[a-z][a-z._-]{0,39}$/.test(segment) ? segment : ':id';
  });
  return `/${segments.join('/')}`;
}

// "at fn (file:line:col)" or "at file:line:col", newest first in the stack; Sentry wants the oldest first.
function frames(stack) {
  return String(stack ?? '').split('\n').slice(1).flatMap((line) => {
    const match = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!match) return [];
    const path = match[2].replace(/^file:\/\//, ''), app = /(?:^|\/)((?:server|api|scripts|web)\/[^\s]*)$/.exec(path);
    const internal = path.startsWith('node:') || path.includes('/node_modules/');
    return [{ function: (match[1] || '<anonymous>').replace(/^async /, ''), filename: app ? app[1] : internal ? path : path.split('/').pop(), lineno: Number(match[3]), colno: Number(match[4]), in_app: Boolean(app) && !internal }];
  }).slice(0, FRAMES_MAX).reverse();
}

export function createErrorReporter({
  dsn = process.env.SENTRY_DSN,
  environment = process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
  release = process.env.VERCEL_GIT_COMMIT_SHA || undefined,
  fetchImpl = fetch,
  now = Date.now,
  timeoutMs = 1500,
  perMinute = 20,
  log = console.warn,
} = {}) {
  const endpoint = sentryEndpoint(dsn);
  // Said once, when the reporter is made (once per instance), so a mistyped DSN shows up in the logs; never the DSN itself.
  if (!endpoint) {
    if (String(dsn ?? '').trim()) log('SENTRY_DSN is set but is not a valid https Sentry DSN; error reports are off');
    return { enabled: false, report: async () => false };
  }
  log(`error reports are on (Sentry project ${endpoint.url.split('/').at(-3)})`);
  const sent = [], lastSent = new Map();
  let pausedUntil = 0;
  async function report(error, { method, route, status } = {}) {
    try {
      const at = now();
      // Sentry answered 429: nothing more until the wait it asked for has passed.
      if (at < pausedUntil) return false;
      const type = error instanceof Error ? (error.name || 'Error') : 'Error', message = scrub(error instanceof Error ? error.message : error);
      while (sent.length && at - sent[0] >= 60_000) sent.shift();
      for (const [key, time] of lastSent) if (at - time >= 60_000) lastSent.delete(key);
      const key = `${type}\n${message}\n${route ?? ''}`;
      if (sent.length >= perMinute || lastSent.has(key)) return false;
      sent.push(at); lastSent.set(key, at);
      const eventId = randomUUID().replace(/-/g, ''), stack = error instanceof Error ? frames(error.stack) : [];
      const tags = Object.fromEntries(Object.entries({ method, route, status: status === undefined ? undefined : String(status) }).filter(([, value]) => value !== undefined));
      const event = {
        event_id: eventId, timestamp: at / 1000, platform: 'node', level: 'error', logger: 'nodal', environment,
        ...(release ? { release } : {}), transaction: route ? `${method ?? ''} ${route}`.trim() : 'unknown', tags,
        exception: { values: [{ type, value: message, ...(stack.length ? { stacktrace: { frames: stack } } : {}) }] },
      };
      const body = [JSON.stringify({ event_id: eventId, sent_at: new Date(at).toISOString() }), JSON.stringify({ type: 'event', content_type: 'application/json' }), JSON.stringify(event)].join('\n');
      // A plain timer, not AbortSignal.timeout (unreferenced): the limit holds even when nothing else keeps the process busy.
      const controller = new AbortController();
      let timer;
      const limit = new Promise((resolve) => { timer = setTimeout(() => { controller.abort(new Error('error report timed out')); resolve(null); }, timeoutMs); });
      try {
        const res = await Promise.race([fetchImpl(endpoint.url, {
          method: 'POST', body, signal: controller.signal,
          headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${endpoint.key}, sentry_client=nodal-server/1` },
        }), limit]);
        if (res?.status === 429) pausedUntil = at + (Number(res.headers?.get?.('retry-after')) || 60) * 1000;
        return Boolean(res?.ok);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }
  return { enabled: true, report };
}
