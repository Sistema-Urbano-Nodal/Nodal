import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import {
  createApp, createCitySearch, staticSourcePath, validateRuntimeConfig,
} from '../server/server.js';
import { createStore } from '../server/store.js';
import { createDatabase } from '../server/db.js';
import { MemoryCache } from '../server/cache.js';
import { createRepository } from '../server/repository.js';

const LIVE_STRIPE_SECRET = ['sk', 'live', 'abc123'].join('_');
const LIVE_STRIPE_WEBHOOK_SECRET = ['whsec', 'live123'].join('_');

async function bootApp(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}
const boot = (t) => bootApp(t, createApp({ store: createStore() }));
async function bootDbHandle(t, options = {}) {
  const db = createDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  const serverOptions = { ...options, db };
  return { db, base: await bootApp(t, createApp(serverOptions)) };
}
const bootDb = async (t) => (await bootDbHandle(t)).base;

const postJson = (base, path, body, headers = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const patchJson = (base, path, body, headers = {}) =>
  fetch(`${base}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const cookiePair = (res) => res.headers.get('set-cookie').split(';')[0];

const stripeSignature = (payload, secret, timestamp = Math.floor(Date.now() / 1000)) => {
  const sig = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
};

function rawRequest(base, { path = '/', headers = {} } = {}) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: url.hostname,
      port: Number(url.port),
      method: 'GET',
      path,
      headers,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET /api/recommendations/:userId — MISS then HIT, ranked payload', async (t) => {
  const base = await boot(t);
  const r1 = await fetch(`${base}/api/recommendations/you`);
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get('x-cache'), 'MISS');
  const body = await r1.json();
  assert.equal(body.userId, 'you');
  assert.ok(Array.isArray(body.recommendations) && body.recommendations.length > 0);
  const scores = body.recommendations.map((r) => r.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a), 'results are ranked');

  const r2 = await fetch(`${base}/api/recommendations/you`);
  assert.equal(r2.headers.get('x-cache'), 'HIT');
  assert.match(r2.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await r2.json(), body);
});

test('POST follow invalidates the cache and removes the followed user', async (t) => {
  const base = await boot(t);
  const before = await (await fetch(`${base}/api/recommendations/you`)).json();
  const target = before.recommendations[0].id;

  const follow = await fetch(`${base}/api/users/you/follow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetId: target }),
  });
  assert.equal(follow.status, 200);

  const after = await fetch(`${base}/api/recommendations/you`);
  assert.equal(after.headers.get('x-cache'), 'MISS', 'follow must invalidate the cache');
  const ids = (await after.json()).recommendations.map((r) => r.id);
  assert.ok(!ids.includes(target));
});

test('POST interactions records engagement and invalidates', async (t) => {
  const base = await boot(t);
  await fetch(`${base}/api/recommendations/you`);
  const r = await fetch(`${base}/api/users/you/interactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetId: 'flavia', type: 'skip' }),
  });
  assert.equal(r.status, 200);
  const next = await fetch(`${base}/api/recommendations/you`);
  assert.equal(next.headers.get('x-cache'), 'MISS');
});

test('input validation: bad ids, unknown users, bad types', async (t) => {
  const base = await boot(t);
  assert.equal((await fetch(`${base}/api/recommendations/NOPE$$`)).status, 400);
  assert.equal((await fetch(`${base}/api/recommendations/ghost`)).status, 404);
  const bad = await fetch(`${base}/api/users/you/interactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetId: 'flavia', type: 'message' }),
  });
  assert.equal(bad.status, 400);
});

test('cross-origin POSTs are rejected', async (t) => {
  const base = await boot(t);
  const r = await fetch(`${base}/api/users/you/follow`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ targetId: 'flavia' }),
  });
  assert.equal(r.status, 403);
});

test('POST /api/checkout without configuration returns 501', async (t) => {
  const base = await bootApp(t, createApp({ store: createStore(), payments: { config: null } }));
  const res = await postJson(base, '/api/checkout', { plan: 'membership', cycle: 'monthly' });
  assert.equal(res.status, 501);
  assert.equal((await res.json()).error, 'payments not configured');
});

test('POST /api/checkout validates plan and cycle', async (t) => {
  const base = await boot(t);
  const badCycle = await postJson(base, '/api/checkout', { plan: 'membership', cycle: 'weekly' });
  assert.equal(badCycle.status, 400);
  const badPlan = await postJson(base, '/api/checkout', { plan: 'gold', cycle: 'monthly' });
  assert.equal(badPlan.status, 400);
});

test('POST /api/checkout rejects cross-origin', async (t) => {
  const base = await boot(t);
  const res = await postJson(base, '/api/checkout', { plan: 'membership', cycle: 'monthly' },
    { Origin: 'https://evil.example' });
  assert.equal(res.status, 403);
});

test('configured checkout creates a Stripe session via REST', async (t) => {
  const oldBaseUrl = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'https://nodal.example';
  t.after(() => {
    if (oldBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldBaseUrl;
  });
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_123' }) };
  };
  const payments = {
    config: { secretKey: 'sk_test_x', prices: { monthly: 'price_m', annual: 'price_a' } },
    fetchImpl: fakeFetch,
  };
  const base = await bootApp(t, createApp({ store: createStore(), payments }));
  const res = await postJson(base, '/api/checkout', { plan: 'membership', cycle: 'annual' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).url, 'https://checkout.stripe.com/c/pay/cs_test_123');
  assert.equal(captured.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(captured.opts.headers.Authorization, 'Bearer sk_test_x');
  const form = new URLSearchParams(captured.opts.body.toString());
  assert.equal(form.get('mode'), 'subscription');
  assert.equal(form.get('client_reference_id'), 'local');
  assert.equal(form.get('metadata[nodal_user_id]'), 'local');
  assert.equal(form.get('line_items[0][price]'), 'price_a');
  assert.equal(form.get('line_items[0][quantity]'), '1');
  assert.equal(form.get('success_url'), 'https://nodal.example/payments.html?checkout=success');
});

test('authenticated checkout sends user metadata and customer email to Stripe', async (t) => {
  const oldBaseUrl = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'https://nodal.example';
  t.after(() => {
    if (oldBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldBaseUrl;
  });
  let captured;
  const payments = {
    config: {
      secretKey: 'sk_test_x',
      webhookSecret: 'whsec_test',
      prices: { monthly: 'price_m', annual: 'price_a' },
    },
    fetchImpl: async (url, opts) => {
      captured = { url, opts };
      return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_user' }) };
    },
  };
  const { base } = await bootDbHandle(t, { payments });
  const signup = await postJson(base, '/api/auth/signup', {
    fullName: 'Paying Member',
    email: 'paying@example.com',
    password: 'correct-horse',
  });
  const user = (await signup.clone().json()).user;
  const res = await postJson(base, '/api/checkout', { plan: 'membership', cycle: 'monthly' }, { Cookie: cookiePair(signup) });
  assert.equal(res.status, 200);
  const form = new URLSearchParams(captured.opts.body.toString());
  assert.equal(form.get('client_reference_id'), user.id);
  assert.equal(form.get('metadata[nodal_user_id]'), user.id);
  assert.equal(form.get('subscription_data[metadata][nodal_user_id]'), user.id);
  assert.equal(form.get('customer_email'), 'paying@example.com');
});

test('configured checkout fails closed without a public application URL', async (t) => {
  const oldBaseUrl = process.env.PUBLIC_BASE_URL;
  const oldAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const oldVercelUrl = process.env.VERCEL_URL;
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.VERCEL_URL;
  t.after(() => {
    if (oldBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = oldBaseUrl;
    if (oldAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = oldAppUrl;
    if (oldVercelUrl === undefined) delete process.env.VERCEL_URL;
    else process.env.VERCEL_URL = oldVercelUrl;
  });
  let called = false;
  const payments = {
    config: { secretKey: 'sk_test_x', prices: { monthly: 'price_m', annual: 'price_a' } },
    fetchImpl: async () => { called = true; throw new Error('should not call provider'); },
  };
  const base = await bootApp(t, createApp({ store: createStore(), payments }));
  const res = await postJson(base, '/api/checkout', { plan: 'membership', cycle: 'monthly' });
  assert.equal(res.status, 500);
  assert.equal(called, false);
});

test('Stripe webhook must be signed before subscription status changes', async (t) => {
  const secret = 'whsec_test_secret';
  const payments = {
    config: {
      secretKey: 'sk_test_x',
      webhookSecret: secret,
      prices: { monthly: 'price_m', annual: 'price_a' },
    },
    fetchImpl: async () => { throw new Error('not used'); },
  };
  const { base } = await bootDbHandle(t, { payments });
  const signup = await postJson(base, '/api/auth/signup', {
    fullName: 'Webhook Member',
    email: 'webhook@example.com',
    password: 'correct-horse',
  });
  const user = (await signup.clone().json()).user;
  const cookie = cookiePair(signup);
  const payload = JSON.stringify({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_verified',
        client_reference_id: user.id,
        customer: 'cus_verified',
        subscription: 'sub_verified',
        payment_status: 'paid',
      },
    },
  });

  const spoof = await fetch(`${base}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'Stripe-Signature': 't=1,v1=bad' },
    body: payload,
  });
  assert.equal(spoof.status, 400);
  let status = await (await fetch(`${base}/api/billing/status`, { headers: { Cookie: cookie } })).json();
  assert.equal(status.subscription.status, 'none');

  const signed = await fetch(`${base}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'Stripe-Signature': stripeSignature(payload, secret) },
    body: payload,
  });
  assert.equal(signed.status, 200);
  status = await (await fetch(`${base}/api/billing/status`, { headers: { Cookie: cookie } })).json();
  assert.equal(status.subscription.status, 'active');
  assert.equal(status.subscription.active, true);
});

test('Stripe webhook retries a mutation that failed before it was committed', async (t) => {
  const secret = 'whsec_test_secret';
  const payments = {
    config: {
      secretKey: 'sk_test_x',
      webhookSecret: secret,
      prices: { monthly: 'price_m', annual: 'price_a' },
    },
    fetchImpl: async () => { throw new Error('not used'); },
  };
  const db = createDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  const baseRepository = createRepository({ db });
  let failOnce = true;
  const repository = {
    ...baseRepository,
    async applyStripeEvent(event) {
      if (failOnce) {
        failOnce = false;
        throw new Error('transient subscription write failure');
      }
      return baseRepository.applyStripeEvent(event);
    },
  };
  const base = await bootApp(t, createApp({ repository, payments }));
  const signup = await postJson(base, '/api/auth/signup', {
    fullName: 'Retry Member',
    email: 'retry-webhook@example.com',
    password: 'correct-horse',
  });
  const user = (await signup.clone().json()).user;
  const cookie = cookiePair(signup);
  const event = {
    id: 'evt_retryable',
    created: 300,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_retryable',
        client_reference_id: user.id,
        metadata: { nodal_user_id: user.id },
        customer: 'cus_retryable',
        subscription: 'sub_retryable',
        payment_status: 'paid',
      },
    },
  };
  const payload = JSON.stringify(event);
  const send = () => fetch(`${base}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'Stripe-Signature': stripeSignature(payload, secret) },
    body: payload,
  });

  assert.equal((await send()).status, 500);
  assert.equal((await send()).status, 200);
  const status = await (await fetch(`${base}/api/billing/status`, { headers: { Cookie: cookie } })).json();
  assert.equal(status.subscription.status, 'active');
});

test('Stripe webhook ignores duplicate and older subscription events', async (t) => {
  const secret = 'whsec_test_secret';
  const payments = {
    config: {
      secretKey: 'sk_test_x',
      webhookSecret: secret,
      prices: { monthly: 'price_m', annual: 'price_a' },
    },
    fetchImpl: async () => { throw new Error('not used'); },
  };
  const { base } = await bootDbHandle(t, { payments });
  const signup = await postJson(base, '/api/auth/signup', {
    fullName: 'Ordered Webhook Member',
    email: 'ordered-webhook@example.com',
    password: 'correct-horse',
  });
  const user = (await signup.clone().json()).user;
  const cookie = cookiePair(signup);

  const sendStripe = (event) => {
    const payload = JSON.stringify(event);
    return fetch(`${base}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'Stripe-Signature': stripeSignature(payload, secret) },
      body: payload,
    });
  };

  const activeEvent = {
    id: 'evt_newer_active',
    created: 200,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_ordered',
        client_reference_id: user.id,
        customer: 'cus_ordered',
        subscription: 'sub_ordered',
        payment_status: 'paid',
      },
    },
  };
  assert.equal((await sendStripe(activeEvent)).status, 200);
  assert.equal((await sendStripe(activeEvent)).status, 200);

  const olderDeletedEvent = {
    id: 'evt_older_deleted',
    created: 100,
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: 'sub_ordered',
        customer: 'cus_ordered',
        status: 'canceled',
        current_period_end: 100,
        metadata: { nodal_user_id: user.id },
      },
    },
  };
  assert.equal((await sendStripe(olderDeletedEvent)).status, 200);
  let status = await (await fetch(`${base}/api/billing/status`, { headers: { Cookie: cookie } })).json();
  assert.equal(status.subscription.status, 'active');
  assert.equal(status.subscription.active, true);

  const sameSecondDeletedEvent = {
    ...olderDeletedEvent,
    id: 'evt_same_second_deleted',
    created: 200,
  };
  assert.equal((await sendStripe(sameSecondDeletedEvent)).status, 200);

  const sameSecondLateCheckout = {
    ...activeEvent,
    id: 'evt_same_second_late_checkout',
    data: {
      object: {
        ...activeEvent.data.object,
        id: 'cs_ordered_late',
      },
    },
  };
  assert.equal((await sendStripe(sameSecondLateCheckout)).status, 200);
  status = await (await fetch(`${base}/api/billing/status`, { headers: { Cookie: cookie } })).json();
  assert.equal(status.subscription.status, 'canceled');
  assert.equal(status.subscription.active, false);
});

test('production runtime config fails closed when deploy-critical env is missing', () => {
  assert.throws(() => validateRuntimeConfig({
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'https://nodal.example',
    COOKIE_SECURE: 'true',
    PAYMENTS_MODE: 'preview',
  }), /DATABASE_PATH/);
  assert.doesNotThrow(() => validateRuntimeConfig({
    NODE_ENV: 'production',
    DATA_BACKEND: 'sqlite',
    DATABASE_PATH: '/var/lib/nodal/nodal.sqlite',
    PUBLIC_BASE_URL: 'https://nodal.example',
    COOKIE_SECURE: 'true',
    PAYMENTS_MODE: 'preview',
  }));
  assert.doesNotThrow(() => validateRuntimeConfig({
    NODE_ENV: 'production',
    DATA_BACKEND: 'sqlite',
    DATABASE_PATH: '/var/lib/nodal/nodal.sqlite',
    VERCEL_URL: 'nodal-preview.vercel.app',
    COOKIE_SECURE: 'true',
    PAYMENTS_MODE: 'preview',
  }));
  assert.throws(() => validateRuntimeConfig({
    NODE_ENV: 'production',
    DATA_BACKEND: 'sqlite',
    DATABASE_PATH: '/var/lib/nodal/nodal.sqlite',
    COOKIE_SECURE: 'true',
    PAYMENTS_MODE: 'preview',
  }), /public base URL/);
  assert.throws(() => validateRuntimeConfig({
    NODE_ENV: 'production',
    DATA_BACKEND: 'supabase',
    PUBLIC_BASE_URL: 'https://nodal.example',
    COOKIE_SECURE: 'true',
    PAYMENTS_MODE: 'preview',
  }), /NEXT_PUBLIC_SUPABASE_URL/);
  assert.throws(() => validateRuntimeConfig({
    NODE_ENV: 'production',
    VERCEL: '1',
    PUBLIC_BASE_URL: 'https://nodal.example',
    COOKIE_SECURE: 'true',
    PAYMENTS_MODE: 'preview',
  }), /NEXT_PUBLIC_SUPABASE_URL/);
  assert.throws(() => validateRuntimeConfig({
    NODE_ENV: 'production',
    DATA_BACKEND: 'supabase',
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public123',
    SUPABASE_SECRET_KEY: 'sb_secret_server123',
    PUBLIC_BASE_URL: 'https://nodal.example',
    COOKIE_SECURE: 'true',
    PAYMENTS_MODE: 'live',
    STRIPE_SECRET_KEY: LIVE_STRIPE_SECRET,
    STRIPE_PRICE_MONTHLY: 'price_monthly123',
    STRIPE_PRICE_ANNUAL: 'price_annual123',
    STRIPE_WEBHOOK_SECRET: LIVE_STRIPE_WEBHOOK_SECRET,
  }), /SUBSCRIPTION_PRICE_MONTHLY_LABEL/);
  assert.throws(() => validateRuntimeConfig({
    NODE_ENV: 'production',
    DATA_BACKEND: 'supabase',
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public123',
    SUPABASE_SECRET_KEY: 'sb_secret_server123',
    PUBLIC_BASE_URL: 'https://nodal.example',
    COOKIE_SECURE: 'true',
    PAYMENTS_MODE: 'live',
    STRIPE_SECRET_KEY: `${LIVE_STRIPE_SECRET} extra`,
    STRIPE_PRICE_MONTHLY: 'price_monthly123',
    STRIPE_PRICE_ANNUAL: 'price_annual123',
    STRIPE_WEBHOOK_SECRET: LIVE_STRIPE_WEBHOOK_SECRET,
    SUBSCRIPTION_PRICE_MONTHLY_LABEL: 'US$10',
    SUBSCRIPTION_PRICE_ANNUAL_LABEL: 'US$100',
  }), /invalid Stripe secret key format/);
  assert.throws(() => validateRuntimeConfig({
    NODE_ENV: 'production',
    DATA_BACKEND: 'supabase',
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public123',
    SUPABASE_SECRET_KEY: 'sb_secret_server123',
    PUBLIC_BASE_URL: 'https://nodal.example',
    COOKIE_SECURE: 'true',
    PAYMENTS_MODE: 'live',
    STRIPE_SECRET_KEY: 'sk_test_abc123',
    STRIPE_PRICE_MONTHLY: 'price_monthly123',
    STRIPE_PRICE_ANNUAL: 'price_annual123',
    STRIPE_WEBHOOK_SECRET: LIVE_STRIPE_WEBHOOK_SECRET,
    SUBSCRIPTION_PRICE_MONTHLY_LABEL: 'US$10',
    SUBSCRIPTION_PRICE_ANNUAL_LABEL: 'US$100',
  }), /live Stripe secret key/);
  assert.doesNotThrow(() => validateRuntimeConfig({
    NODE_ENV: 'production',
    DATA_BACKEND: 'supabase',
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public123',
    SUPABASE_SECRET_KEY: 'sb_secret_server123',
    PUBLIC_BASE_URL: 'https://nodal.example',
    COOKIE_SECURE: 'true',
    PAYMENTS_MODE: 'live',
    STRIPE_SECRET_KEY: LIVE_STRIPE_SECRET,
    STRIPE_PRICE_MONTHLY: 'price_monthly123',
    STRIPE_PRICE_ANNUAL: 'price_annual123',
    STRIPE_WEBHOOK_SECRET: LIVE_STRIPE_WEBHOOK_SECRET,
    SUBSCRIPTION_PRICE_MONTHLY_LABEL: 'US$10',
    SUBSCRIPTION_PRICE_ANNUAL_LABEL: 'US$100',
  }));
});

test('billing config is served from environment, not frontend literals', async (t) => {
  const keys = [
    'SUBSCRIPTION_PRICE_MONTHLY_LABEL',
    'SUBSCRIPTION_MONTHLY_PERIOD',
    'SUBSCRIPTION_PRICE_ANNUAL_LABEL',
    'SUBSCRIPTION_ANNUAL_PERIOD',
    'SUBSCRIPTION_ANNUAL_BADGE',
  ];
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.SUBSCRIPTION_PRICE_MONTHLY_LABEL = 'US$12';
  process.env.SUBSCRIPTION_MONTHLY_PERIOD = '/ month';
  process.env.SUBSCRIPTION_PRICE_ANNUAL_LABEL = 'US$120';
  process.env.SUBSCRIPTION_ANNUAL_PERIOD = '/ year';
  process.env.SUBSCRIPTION_ANNUAL_BADGE = 'configured annual';
  t.after(() => {
    for (const key of keys) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  });
  const base = await boot(t);
  const res = await fetch(`${base}/api/billing/config`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.cycles.monthly.amount, 'US$12');
  assert.equal(body.cycles.monthly.per, '/ month');
  assert.equal(body.cycles.annual.amount, 'US$120');
  assert.equal(body.cycles.annual.per, '/ year');
  assert.equal(body.cycles.annual.badge, 'configured annual');
});

test('billing config reports "Soon" while no launch price is configured', async (t) => {
  const keys = [
    'SUBSCRIPTION_PRICE_MONTHLY_LABEL',
    'SUBSCRIPTION_MONTHLY_PERIOD',
    'SUBSCRIPTION_PRICE_ANNUAL_LABEL',
    'SUBSCRIPTION_ANNUAL_PERIOD',
  ];
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  delete process.env.SUBSCRIPTION_PRICE_MONTHLY_LABEL;
  delete process.env.SUBSCRIPTION_PRICE_ANNUAL_LABEL;
  process.env.SUBSCRIPTION_MONTHLY_PERIOD = '/ month';
  process.env.SUBSCRIPTION_ANNUAL_PERIOD = '/ year';
  t.after(() => {
    for (const key of keys) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  });
  const base = await boot(t);
  const res = await fetch(`${base}/api/billing/config`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.cycles.monthly.amount, 'Soon');
  assert.equal(body.cycles.annual.amount, 'Soon');
  // a dangling "/ month" next to "Soon" would read as a price
  assert.equal(body.cycles.monthly.per, '');
  assert.equal(body.cycles.annual.per, '');
});

test('landing membership price is loaded from billing config instead of a hardcoded amount', async (t) => {
  const base = await boot(t);
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /data-billing-price/);
  assert.doesNotMatch(html, /US\$\d+/);
});

test('city search proxies global city provider for authenticated profile autocomplete', async (t) => {
  let captured;
  const citySearch = createCitySearch({
    baseUrl: 'https://city-provider.example/search',
    minIntervalMs: 0,
    fetchImpl: async (url, opts) => {
      captured = { url, opts };
      return {
        ok: true,
        json: async () => ([
          {
            lat: '-21.4647310',
            lon: '-47.0024050',
            name: 'Mococa',
            city: 'Mococa',
            region: 'São Paulo',
            country: 'Brasil',
            countryCode: 'BR',
            latitude: -21.4647310,
            longitude: -47.0024050,
            address: { municipality: 'Mococa', state: 'São Paulo', country: 'Brasil', country_code: 'br' },
          },
        ]),
      };
    },
  });
  const { base } = await bootDbHandle(t, { citySearch });
  const signup = await postJson(base, '/api/auth/signup', {
    fullName: 'City Searcher',
    email: 'city-searcher@example.com',
    password: 'correct-horse',
  });
  const res = await fetch(`${base}/api/cities?q=mococa`, {
    headers: { Cookie: cookiePair(signup), 'Accept-Language': 'pt-BR' },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.cities[0].label, 'Mococa, São Paulo, Brasil');
  assert.equal(body.cities[0].countryCode, 'BR');
  assert.equal(captured.url.searchParams.get('namePrefix'), 'mococa');
  assert.equal(captured.url.searchParams.get('types'), 'CITY');
  assert.match(captured.opts.headers['User-Agent'], /NODAL city search/);
});

test('static server does not expose deploy metadata or internal docs', async (t) => {
  const base = await boot(t);
  for (const path of [
    '/server/server.js',
    '/package.json',
    '/package-lock.json',
    '/vercel.json',
    '/DEPLOYMENT.md',
    '/api/index.js',
    '/scripts/build-static.js',
    '/tests/api.test.js',
    '/web/pages/index.html',
    '/web/assets/source/nodal-wordmark.png',
    '/supabase/migrations/20260709_production_core.sql',
    '/docs/private-plan.md',
    '/docs/nodal-member-journey/nodal-journey.html',
    '/.env.example',
  ]) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 404, `${path} should not be public`);
  }
});

test('auth: signup creates a user session and duplicate email is rejected', async (t) => {
  const base = await bootDb(t);
  const signup = await postJson(base, '/api/auth/signup', {
    fullName: 'Ana Pereira',
    email: 'ana@example.com',
    password: 'correct-horse',
  });
  assert.equal(signup.status, 201);
  assert.match(signup.headers.get('set-cookie'), /nodal_session=.*HttpOnly/);
  const cookie = signup.headers.get('set-cookie').split(';')[0];
  const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, 'ana@example.com');

  const dupe = await postJson(base, '/api/auth/signup', {
    fullName: 'Ana Again',
    email: 'ana@example.com',
    password: 'correct-horse',
  });
  assert.equal(dupe.status, 409);
  assert.equal((await dupe.json()).error, 'signup could not be completed');
});

test('auth: signup hides provider rate-limit details behind a useful retry message', async (t) => {
  const repository = {
    async resolveSession() { return { user: null, cookies: [] }; },
    async signup() {
      throw Object.assign(new Error('email rate limit exceeded'), { status: 429 });
    },
    close() {},
  };
  const base = await bootApp(t, createApp({ repository }));
  const response = await postJson(base, '/api/auth/signup', {
    fullName: 'Rate Limited Member',
    email: 'member@example.com',
    password: 'correct-horse',
  });

  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.error, 'Confirmation email is temporarily unavailable. Please try again later.');
  assert.doesNotMatch(body.error, /rate limit/i);
});

test('auth: signup never exposes provider database errors', async (t) => {
  const repository = {
    async resolveSession() { return { user: null, cookies: [] }; },
    async signup() {
      throw Object.assign(new Error(
        'insert or update on table "profile_preferences" violates foreign key constraint',
      ), { status: 409 });
    },
    close() {},
  };
  const base = await bootApp(t, createApp({ repository }));
  const response = await postJson(base, '/api/auth/signup', {
    fullName: 'Existing Member',
    email: 'member@example.com',
    password: 'correct-horse',
  });

  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(
    body.error,
    'Account creation could not be completed. If you already confirmed your email, sign in.',
  );
  assert.doesNotMatch(body.error, /profile_preferences|foreign key|constraint/i);
});

test('auth: repeated login attempts are rate limited before password work', async (t) => {
  const base = await bootDb(t);
  let last;
  for (let i = 0; i < 10; i += 1) {
    last = await postJson(base, '/api/auth/login', {
      email: 'nobody@example.com',
      password: 'wrong-password',
    });
    assert.equal(last.status, 401);
  }
  const limited = await postJson(base, '/api/auth/login', {
    email: 'nobody@example.com',
    password: 'wrong-password',
  });
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get('retry-after'), /^\d+$/);
});

test('resolved session cookies are propagated to the response', async (t) => {
  const repository = {
    async resolveSession() {
      return {
        user: null,
        cookies: ['nodal_session=refreshed; HttpOnly; Path=/; SameSite=Lax'],
      };
    },
    close() {},
  };
  const base = await bootApp(t, createApp({ repository }));
  const response = await fetch(`${base}/api/auth/state`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /nodal_session=refreshed/);
});

test('auth: login, profile persistence and logout', async (t) => {
  const base = await bootDb(t);
  await postJson(base, '/api/auth/signup', {
    fullName: 'Bruno Lima',
    email: 'bruno@example.com',
    password: 'correct-horse',
  });
  const login = await postJson(base, '/api/auth/login', {
    email: 'bruno@example.com',
    password: 'correct-horse',
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const patch = await fetch(`${base}/api/me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      title: 'Urban Planner',
      city: 'Lima',
      topics: [{ name: 'Mobility', level: 2, validatedAt: 0, endorsedAt: 0 }],
      partC: { bio: 'Planner', linkedin: '', portfolio: '', references: '', availability: '2 h / month', consent: true },
      assessed: true,
    }),
  });
  assert.equal(patch.status, 200);
  const saved = await patch.json();
  assert.equal(saved.user.title, 'Urban Planner');
  assert.equal(saved.user.partC.availability, '2 h / month');

  const partialResponse = await patchJson(base, '/api/me', {
    partC: { bio: 'Planner and researcher' },
  }, { Cookie: cookie });
  const partial = await partialResponse.json();
  assert.equal(partial.user.partC.bio, 'Planner and researcher');
  assert.equal(partial.user.partC.availability, '2 h / month');
  assert.equal(partial.user.partC.consent, true);

  const logout = await postJson(base, '/api/auth/logout', {}, { Cookie: cookie });
  assert.equal(logout.status, 200);
  const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(me.status, 401);
});

test('privacy: member can export personal data and delete their account', async (t) => {
  const base = await bootDb(t);
  const signup = await postJson(base, '/api/auth/signup', {
    fullName: 'Privacy Member',
    email: 'privacy-member@example.com',
    password: 'correct-horse',
  });
  const cookie = cookiePair(signup);
  await patchJson(base, '/api/me', {
    title: 'Civic ecologist',
    city: 'Mococa, São Paulo, Brazil',
    interests: ['water'],
    active: ['pm'],
    partC: { bio: 'Works with water justice.', consent: true },
  }, { Cookie: cookie });

  const exported = await (await fetch(`${base}/api/me/export`, { headers: { Cookie: cookie } })).json();
  assert.equal(exported.data.user.email, 'privacy-member@example.com');
  assert.equal(exported.data.user.title, 'Civic ecologist');
  assert.equal(exported.data.user.city, 'Mococa, São Paulo, Brazil');
  assert.equal(exported.data.user.passwordHash, undefined);
  assert.equal(exported.data.user.password_hash, undefined);
  assert.ok(Array.isArray(exported.data.follows));
  assert.ok(Array.isArray(exported.data.interactions));

  const rejected = await fetch(`${base}/api/me`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ confirmEmail: 'wrong@example.com' }),
  });
  assert.equal(rejected.status, 400);

  const deleted = await fetch(`${base}/api/me`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ confirmEmail: 'privacy-member@example.com' }),
  });
  assert.equal(deleted.status, 200);
  assert.match(deleted.headers.get('set-cookie'), /nodal_session=;/);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })).status, 401);
});

test('privacy: consent revocation invalidates a shared cache across app instances', async (t) => {
  const db = createDatabase({ filename: ':memory:' });
  const cache = new MemoryCache();
  t.after(() => db.close());
  const first = await bootApp(t, createApp({ db, cache }));
  const second = await bootApp(t, createApp({ db, cache }));

  const viewerSignup = await postJson(first, '/api/auth/signup', {
    fullName: 'Cache Viewer',
    email: 'cache-viewer@example.com',
    password: 'correct-horse',
  });
  const viewerCookie = cookiePair(viewerSignup);
  const peerSignup = await postJson(second, '/api/auth/signup', {
    fullName: 'Cache Peer',
    email: 'cache-peer@example.com',
    password: 'correct-horse',
  });
  const peerCookie = cookiePair(peerSignup);

  await patchJson(first, '/api/me', {
    city: 'Lima',
    interests: ['mobility'],
    active: ['pm'],
    partC: { consent: true },
  }, { Cookie: viewerCookie });
  await patchJson(second, '/api/me', {
    city: 'Lima',
    interests: ['mobility'],
    active: ['pm'],
    partC: { consent: true },
  }, { Cookie: peerCookie });

  const primed = await fetch(`${first}/api/recommendations/me`, { headers: { Cookie: viewerCookie } });
  assert.equal(primed.headers.get('x-cache'), 'MISS');
  assert.ok((await primed.json()).recommendations.some((user) => user.name === 'Cache Peer'));

  await patchJson(second, '/api/me', { partC: { consent: false } }, { Cookie: peerCookie });
  const refreshed = await fetch(`${first}/api/recommendations/me`, { headers: { Cookie: viewerCookie } });
  assert.equal(refreshed.headers.get('x-cache'), 'MISS');
  assert.ok(!(await refreshed.json()).recommendations.some((user) => user.name === 'Cache Peer'));
});

test('privacy: account deletion makes cached recommendation data unreachable', async (t) => {
  const db = createDatabase({ filename: ':memory:' });
  const cache = new MemoryCache();
  t.after(() => db.close());
  const base = await bootApp(t, createApp({ db, cache }));

  const viewerSignup = await postJson(base, '/api/auth/signup', {
    fullName: 'Delete Cache Viewer',
    email: 'delete-cache-viewer@example.com',
    password: 'correct-horse',
  });
  const viewerCookie = cookiePair(viewerSignup);
  const peerSignup = await postJson(base, '/api/auth/signup', {
    fullName: 'Delete Cache Peer',
    email: 'delete-cache-peer@example.com',
    password: 'correct-horse',
  });
  const peerCookie = cookiePair(peerSignup);

  for (const [cookie, title] of [[viewerCookie, 'Viewer'], [peerCookie, 'Peer']]) {
    await patchJson(base, '/api/me', {
      title,
      city: 'Lima',
      interests: ['housing'],
      active: ['am'],
      partC: { consent: true },
    }, { Cookie: cookie });
  }

  const primed = await fetch(`${base}/api/recommendations/me`, { headers: { Cookie: viewerCookie } });
  assert.ok((await primed.json()).recommendations.some((user) => user.name === 'Delete Cache Peer'));

  const deleted = await fetch(`${base}/api/me`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Cookie: peerCookie },
    body: JSON.stringify({ confirmEmail: 'delete-cache-peer@example.com' }),
  });
  assert.equal(deleted.status, 200);

  const refreshed = await fetch(`${base}/api/recommendations/me`, { headers: { Cookie: viewerCookie } });
  assert.equal(refreshed.headers.get('x-cache'), 'MISS');
  assert.ok(!(await refreshed.json()).recommendations.some((user) => user.name === 'Delete Cache Peer'));
});

test('profile updates cannot forge validation markers or gated mentor state', async (t) => {
  const base = await bootDb(t);
  const signup = await postJson(base, '/api/auth/signup', {
    fullName: 'Carla Trust',
    email: 'carla@example.com',
    password: 'correct-horse',
  });
  const cookie = cookiePair(signup);

  const patch = await patchJson(base, '/api/me', {
    topics: [{ name: 'Mobility', level: 4, validatedAt: 4, endorsedAt: 4 }],
    indicators: { leadership: 'Regularly', transmission: 'No' },
    requests: { project: true, unknown: true },
    mentorApplied: true,
    assessed: true,
  }, { Cookie: cookie });
  assert.equal(patch.status, 200);
  const user = (await patch.json()).user;
  assert.deepEqual(user.topics, [{ name: 'Mobility', level: 3, validatedAt: 0, endorsedAt: 0 }]);
  assert.equal(user.mentorApplied, false);
  assert.equal(user.requests.project, false);
  assert.equal(user.requests.unknown, undefined);
});

test('directory consent filters member listing and recommendations', async (t) => {
  const base = await bootDb(t);
  const aliceSignup = await postJson(base, '/api/auth/signup', {
    fullName: 'Alice Visible',
    email: 'alice-visible@example.com',
    password: 'correct-horse',
  });
  const aliceCookie = cookiePair(aliceSignup);
  const bobSignup = await postJson(base, '/api/auth/signup', {
    fullName: 'Bob Hidden',
    email: 'bob-hidden@example.com',
    password: 'correct-horse',
  });
  const bobCookie = cookiePair(bobSignup);

  await patchJson(base, '/api/me', {
    city: 'Lima',
    interests: ['climate'],
    partC: { linkedin: 'https://www.linkedin.com/in/alice-visible', consent: true },
  }, { Cookie: aliceCookie });
  await patchJson(base, '/api/me', {
    city: 'Lima',
    interests: ['climate'],
    partC: { linkedin: 'https://www.linkedin.com/in/bob-hidden', consent: false },
  }, { Cookie: bobCookie });

  const users = await (await fetch(`${base}/api/users`, { headers: { Cookie: aliceCookie } })).json();
  assert.ok(users.users.some((u) => u.name === 'Alice Visible'));
  assert.ok(!users.users.some((u) => u.name === 'Bob Hidden'));

  const recs = await (await fetch(`${base}/api/recommendations/me`, { headers: { Cookie: aliceCookie } })).json();
  assert.ok(!recs.recommendations.some((u) => u.name === 'Bob Hidden'));
});

test('recommendations use arbitrary roles and global city labels from real profiles', async (t) => {
  const base = await bootDb(t);
  const viewerSignup = await postJson(base, '/api/auth/signup', {
    fullName: 'Global Viewer',
    email: 'global-viewer@example.com',
    password: 'correct-horse',
  });
  const viewerCookie = cookiePair(viewerSignup);
  const peerSignup = await postJson(base, '/api/auth/signup', {
    fullName: 'Global Peer',
    email: 'global-peer@example.com',
    password: 'correct-horse',
  });
  const peerCookie = cookiePair(peerSignup);

  await patchJson(base, '/api/me', {
    title: 'Water justice organizer',
    city: 'Mococa, São Paulo, Brazil',
    interests: ['water', 'public space'],
    active: ['pm'],
    partC: { consent: true },
  }, { Cookie: viewerCookie });
  await patchJson(base, '/api/me', {
    title: 'Participatory hydrologist',
    city: 'mococa, sao paulo, brazil',
    interests: ['water', 'climate'],
    active: ['pm'],
    partC: { consent: true },
  }, { Cookie: peerCookie });

  const recs = await (await fetch(`${base}/api/recommendations/me`, { headers: { Cookie: viewerCookie } })).json();
  const peer = recs.recommendations.find((u) => u.name === 'Global Peer');
  assert.ok(peer, 'peer with arbitrary role and global city should be recommended');
  assert.equal(peer.role, 'Participatory hydrologist');
  assert.equal(peer.reasons.sameCity, true);
  assert.ok(peer.reasons.sharedInterests.includes('water'));
});

test('interactions are bounded, rate limited, and cannot poison the target deck', async (t) => {
  const { db, base } = await bootDbHandle(t);
  const victimSignup = await postJson(base, '/api/auth/signup', {
    fullName: 'Victim Member',
    email: 'victim@example.com',
    password: 'correct-horse',
  });
  const victim = (await victimSignup.clone().json()).user;
  const victimCookie = cookiePair(victimSignup);
  const attackerSignup = await postJson(base, '/api/auth/signup', {
    fullName: 'Attacker Member',
    email: 'attacker@example.com',
    password: 'correct-horse',
  });
  const attackerCookie = cookiePair(attackerSignup);

  await patchJson(base, '/api/me', {
    city: 'Lima',
    interests: ['housing'],
    active: ['am'],
    partC: { consent: true },
  }, { Cookie: victimCookie });
  await patchJson(base, '/api/me', {
    city: 'Quito',
    interests: ['marine biology'],
    active: ['eve'],
    partC: { consent: true },
  }, { Cookie: attackerCookie });

  const before = await (await fetch(`${base}/api/recommendations/me`, { headers: { Cookie: victimCookie } })).json();
  assert.deepEqual(before.recommendations, []);

  assert.equal((await postJson(base, '/api/users/me/interactions', { targetId: victim.id, type: 'message' }, { Cookie: attackerCookie })).status, 400);
  for (let i = 0; i < 60; i += 1) {
    const res = await postJson(base, '/api/users/me/interactions', { targetId: victim.id, type: 'skip' }, { Cookie: attackerCookie });
    assert.equal(res.status, 200);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM interactions').get().n, 50);

  const limited = await postJson(base, '/api/users/me/interactions', { targetId: victim.id, type: 'skip' }, { Cookie: attackerCookie });
  assert.equal(limited.status, 429);

  const after = await (await fetch(`${base}/api/recommendations/me`, { headers: { Cookie: victimCookie } })).json();
  assert.deepEqual(after.recommendations, []);
});

test('auth: private pages and user APIs require a session', async (t) => {
  const base = await bootDb(t);
  const page = await fetch(`${base}/dashboard.html`, { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location'), /^\/login\.html/);
  const encoded = await fetch(`${base}/%64ashboard.html`, { redirect: 'manual' });
  assert.equal(encoded.status, 302);
  assert.match(encoded.headers.get('location'), /^\/login\.html\?next=%2Fdashboard\.html/);
  assert.equal((await fetch(`${base}/api/users`)).status, 401);
  assert.equal((await fetch(`${base}/api/recommendations/me`)).status, 401);
});

test('malformed metadata and backslash next values fail safely', async (t) => {
  const base = await bootDb(t);
  const signup = await postJson(base, '/api/auth/signup', {
    fullName: 'Dana Redirect',
    email: 'dana@example.com',
    password: 'correct-horse',
  });
  const cookie = cookiePair(signup);

  const redirect = await fetch(`${base}/login.html?next=/%5Cevil.example/phish`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), '/dashboard.html');

  const malformedCookie = await fetch(`${base}/api/health`, { headers: { Cookie: 'nodal_session=%E0%A4%A' } });
  assert.equal(malformedCookie.status, 200);

  const malformedHost = await rawRequest(base, { path: '/api/health', headers: { Host: '[' } });
  assert.equal(malformedHost.status, 200);
});

test('static serving: pages resolve, traversal does not', async (t) => {
  const base = await boot(t);
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  const image = await fetch(`${base}/assets/nodal-wordmark.webp`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/webp');
  assert.equal((await fetch(`${base}/payments.html`)).status, 200);
  assert.equal((await fetch(`${base}/..%2f..%2fetc%2fpasswd`)).status, 404);
  assert.equal((await fetch(`${base}/package.json/../server/server.js`)).status, 404);
});

test('static source map preserves public URLs without exposing source directories', () => {
  assert.equal(path.basename(staticSourcePath('/')), 'index.html');
  assert.equal(path.basename(staticSourcePath('/dashboard.html')), 'dashboard.html');
  assert.equal(path.basename(staticSourcePath('/styles.css')), 'styles.css');
  assert.equal(path.basename(staticSourcePath('/dashboard.js')), 'dashboard.js');
  assert.equal(path.basename(staticSourcePath('/assets/nodal-wordmark.webp')), 'nodal-wordmark.webp');
  assert.equal(staticSourcePath('/web/pages/index.html'), null);
  assert.equal(staticSourcePath('/server/server.js'), null);
  assert.equal(staticSourcePath('/tests/api.test.js'), null);
  assert.equal(staticSourcePath('/scripts/build-static.js'), null);
});

test('static assets bypass session resolution and carry reusable cache headers', async (t) => {
  let sessionResolutions = 0;
  const repository = {
    async resolveSession() {
      sessionResolutions += 1;
      return { user: null, cookies: [] };
    },
    close() {},
  };
  const base = await bootApp(t, createApp({ repository }));

  const asset = await fetch(`${base}/styles.css`, {
    headers: { Cookie: 'nodal_session=existing-session' },
  });
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control'), /max-age=3600/);
  assert.equal(sessionResolutions, 0);

  const privatePage = await fetch(`${base}/dashboard.html`, {
    headers: { Cookie: 'nodal_session=existing-session' },
    redirect: 'manual',
  });
  assert.equal(privatePage.status, 302);
  assert.equal(sessionResolutions, 1);
});

const consentingMember = async (base, { name, email, city = 'Lima', title = 'Transport planner', consent = true }) => {
  const signup = await postJson(base, '/api/auth/signup', { fullName: name, email, password: 'corridor-2026' });
  assert.equal(signup.status, 201);
  const cookie = cookiePair(signup);
  const user = (await signup.clone().json()).user;
  await patchJson(base, '/api/me', {
    fullName: name,
    title,
    city,
    partC: { bio: `${name} works on bus corridors.`, linkedin: '', portfolio: 'https://example.test/folio', references: 'Ref One · ref@example.test', availability: '4 h / month', consent },
  }, { Cookie: cookie });
  return { cookie, id: user.id };
};
const getJson = async (base, path, cookie) => {
  const res = await fetch(`${base}${path}`, cookie ? { headers: { Cookie: cookie } } : undefined);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test('member search needs a session, skips you and anyone who never consented, and never returns an email', async (t) => {
  const base = await bootDb(t);
  const ana = await consentingMember(base, { name: 'Ana Pereira', email: 'ana@example.test' });
  const bruno = await consentingMember(base, { name: 'Bruno Dias', email: 'bruno@example.test', city: 'Recife', consent: false });

  assert.equal((await getJson(base, '/api/users/search?q=ana')).status, 401);

  const byName = await getJson(base, '/api/users/search?q=ana', bruno.cookie);
  assert.equal(byName.status, 200);
  assert.deepEqual(byName.body.users.map((u) => u.name), ['Ana Pereira']);
  assert.deepEqual(Object.keys(byName.body.users[0]).sort(), ['city', 'id', 'name', 'role']);

  // a full registration address resolves; a fragment of one must not
  const exact = await getJson(base, `/api/users/search?q=${encodeURIComponent('ana@example.test')}`, bruno.cookie);
  assert.deepEqual(exact.body.users.map((u) => u.id), [ana.id]);
  const fragment = await getJson(base, '/api/users/search?q=%40example.test', bruno.cookie);
  assert.deepEqual(fragment.body.users, []);

  // you never find yourself, and an unlisted member is never found
  assert.deepEqual((await getJson(base, '/api/users/search?q=ana', ana.cookie)).body.users, []);
  assert.deepEqual((await getJson(base, '/api/users/search?q=bruno', ana.cookie)).body.users, []);

  // below the minimum query length nothing is scanned
  assert.deepEqual((await getJson(base, '/api/users/search?q=a', bruno.cookie)).body.users, []);
});

test('a member card shows directory fields only, and hides members who never consented', async (t) => {
  const base = await bootDb(t);
  const ana = await consentingMember(base, { name: 'Ana Pereira', email: 'ana@example.test' });
  const bruno = await consentingMember(base, { name: 'Bruno Dias', email: 'bruno@example.test', consent: false });

  assert.equal((await getJson(base, `/api/users/${ana.id}`)).status, 401);
  assert.equal((await getJson(base, '/api/users/not a valid id', ana.cookie)).status, 400);
  assert.equal((await getJson(base, '/api/users/11111111-1111-1111-1111-111111111111', ana.cookie)).status, 404);

  const card = await getJson(base, `/api/users/${ana.id}`, bruno.cookie);
  assert.equal(card.status, 200);
  assert.equal(card.body.self, false);
  assert.equal(card.body.user.fullName, 'Ana Pereira');
  assert.equal(card.body.user.email, undefined, 'a member card must never carry an email');
  assert.equal(card.body.user.partC.portfolio, '', 'portfolio stays private');
  assert.equal(card.body.user.partC.references, '', 'reference contacts stay private');
  assert.ok(card.body.user.partC.bio.includes('bus corridors'));

  // your own record still comes back whole
  const own = await getJson(base, `/api/users/${ana.id}`, ana.cookie);
  assert.equal(own.body.self, true);
  assert.equal(own.body.user.email, 'ana@example.test');
  assert.equal(own.body.user.partC.references, 'Ref One · ref@example.test');

  // an unlisted member is indistinguishable from one that does not exist
  assert.equal((await getJson(base, `/api/users/${bruno.id}`, ana.cookie)).status, 404);
});

test('member search is rate limited per session', async (t) => {
  const base = await bootDb(t);
  const ana = await consentingMember(base, { name: 'Ana Pereira', email: 'ana@example.test' });
  let limited = null;
  for (let i = 0; i < 60 && !limited; i += 1) {
    const res = await fetch(`${base}/api/users/search?q=ana`, { headers: { Cookie: ana.cookie } });
    if (res.status === 429) limited = res;
    else await res.arrayBuffer();
  }
  assert.ok(limited, 'expected the search endpoint to start refusing');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  await limited.arrayBuffer();
});

test('a request target starting with // is a path, not another origin', async (t) => {
  const base = await bootDb(t);
  // "//" used to throw inside URL parsing and surface as a 500
  const root = await fetch(`${base}//`);
  assert.equal(root.status, 200);
  assert.match(await root.text(), /<title/);

  // the host in "//host/path" must not win over the server's own base
  const spoof = await fetch(`${base}//evil.example/dashboard.html`, { redirect: 'manual' });
  assert.equal(spoof.status, 404, 'should resolve to /evil.example/dashboard.html and miss');

  const deep = await fetch(`${base}///`);
  assert.ok(deep.status < 500, `expected no server error, got ${deep.status}`);

  // the routing decision and the file lookup must read the same path
  const encoded = await fetch(`${base}/%2f%2fdashboard.html`, { redirect: 'manual' });
  assert.ok([302, 400, 404].includes(encoded.status), `unexpected ${encoded.status}`);
  const traversal = await fetch(`${base}/assets/%252e%252e/%252e%252e/server/db.js`);
  assert.equal(traversal.status, 404, 'a double-encoded traversal must not resolve');
});

test('the globe reads the directory and says why you are not on it', async (t) => {
  const geocoded = [];
  const citySearch = {
    async search(query) {
      geocoded.push(query);
      if (String(query).toLowerCase() === 'mococa') {
        return { cities: [{ label: 'Mococa, São Paulo, Brazil', lat: -21.47, lon: -47.0 }] };
      }
      return { cities: [] };            // a city the provider cannot place
    },
  };
  const { base } = await bootDbHandle(t, { citySearch });

  const listed = await consentingMember(base, { name: 'João Lucas', email: 'joao@example.test', city: 'Mococa', title: 'Urbanista' });
  const quiet = await consentingMember(base, { name: 'Sem Consentimento', email: 'quiet@example.test', city: 'Recife', consent: false });

  assert.equal((await getJson(base, '/api/network/places')).status, 401);

  const seen = await getJson(base, '/api/network/places', listed.cookie);
  assert.equal(seen.status, 200);
  const mococa = seen.body.places.find((p) => p.city === 'Mococa');
  assert.ok(mococa, 'a city nobody hardcoded still reaches the map');
  assert.equal(mococa.lat, -21.47);
  assert.deepEqual(mococa.people, [{ name: 'João Lucas', role: 'Urbanista' }]);
  assert.deepEqual(seen.body.you, { listed: true, hasCity: true, onMap: true, city: 'Mococa' });
  // nobody who withheld consent leaks onto the map
  assert.equal(seen.body.places.some((p) => p.city === 'Recife'), false);

  const hidden = await getJson(base, '/api/network/places', quiet.cookie);
  assert.equal(hidden.body.you.listed, false, 'and they are told they are not listed');

  /* Coordinates are cached per city, independently of the per-viewer roll-up:
     read it as a DIFFERENT member so the roll-up cache misses and only the
     city cache can keep the geocoder from being called again. */
  const before = geocoded.length;
  await getJson(base, '/api/network/places', quiet.cookie);
  assert.equal(geocoded.length, before, 'city coordinates are cached across viewers');
});
