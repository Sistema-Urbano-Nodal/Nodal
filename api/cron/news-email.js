import { timingSafeEqual } from 'node:crypto';
import { createNewsAlerts, createNewsEmailSender } from '../../server/news-alerts.js';
import { dataBackend } from '../../server/supabase.js';

function authorized(header, secret) {
  if (!secret || typeof header !== 'string') return false;
  const supplied = Buffer.from(header);
  const expected = Buffer.from('Bearer ' + secret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function drainNewsEmail(env, {
  alerts = createNewsAlerts({ env }),
  sendBatch = createNewsEmailSender(env),
} = {}) {
  // Stop claiming work before the platform deadline, allowing in-flight SMTP and
  // database calls to settle. Each batch claims individual rows atomically.
  const deadline = Date.now() + 240_000;
  const totals = { sent: 0, failed: 0, uncertain: 0, deferred: 0 };
  for (let batches = 0; batches < 10 && Date.now() < deadline; batches++) {
    const result = await sendBatch(alerts, { limit: 100, deadline });
    for (const status of Object.keys(totals)) totals[status] += result[status];
    if (Object.values(result).reduce((total, count) => total + count, 0) < 100) break;
  }
  return totals;
}

export function createNewsEmailCron({ env = process.env, run = drainNewsEmail, log = console } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    function reply(status, body) {
      res.statusCode = status;
      res.end(JSON.stringify(body));
    }
    if (env.VERCEL_ENV !== 'production') return reply(404, { error: 'not found' });
    if (!authorized(req.headers.authorization, env.CRON_SECRET)) return reply(401, { error: 'unauthorized' });
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return reply(405, { error: 'method not allowed' });
    }
    try {
      if (dataBackend(env) !== 'supabase') throw Error('a persistent outbox is required');
      const counts = await run(env);
      if (counts.failed || counts.uncertain || counts.deferred) {
        log.warn('News email deliveries need attention', counts);
        return reply(502, counts);
      }
      return reply(200, counts);
    } catch {
      log.error('News email sender could not finish. Check the production database and email settings.');
      return reply(503, { error: 'news email sender unavailable' });
    }
  };
}

export default createNewsEmailCron();
