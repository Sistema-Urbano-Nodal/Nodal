import { createApp, validateRuntimeConfig } from '../server/server.js';
import { createCache } from '../server/cache.js';
import { createErrorReporter, routeOf } from '../server/error-report.js';

/* The Vercel function. boot() builds the app once per instance; reporter sends server errors to Sentry when
   SENTRY_DSN is set. createHandler is exported so a test can give it its own boot and reporter. */
export function createHandler({ boot, reporter }) {
  let appPromise;
  function app() {
    if (!appPromise) {
      appPromise = boot();
      /* A rejected promise stays rejected. Without this, one transient failure
         here — a cache that was not reachable at the moment this instance woke
         up — would fail every later request on the instance with the same error,
         long after the cause had cleared. */
      appPromise.catch(() => { appPromise = undefined; });
    }
    return appPromise;
  }
  return async function handler(req, res) {
    let server;
    try {
      server = await app();
    } catch (err) {
      // An instance that cannot start (a bad setting, an unreachable cache) is the worst outage: report why, then answer.
      console.error('instance could not start:', err instanceof Error ? err.message : String(err));
      await reporter.report(err, { method: req.method, route: routeOf(req.url), status: 500 });
      if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); }
      res.end(JSON.stringify({ error: 'internal error' }));
      return;
    }
    server.emit('request', req, res);
  };
}

const reporter = createErrorReporter();
export default createHandler({
  reporter,
  boot: async () => {
    validateRuntimeConfig();
    return createApp({ cache: await createCache(), errorReport: reporter });
  },
});
