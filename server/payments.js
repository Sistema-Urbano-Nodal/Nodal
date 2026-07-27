/* Stripe-ready checkout seam. Zero-dependency: the session is created
   against Stripe's REST API with fetch. Without Stripe configuration the
   route reports local misconfiguration outside production. */

import { createHmac, timingSafeEqual } from 'node:crypto';

const STRIPE_SESSIONS_URL = 'https://api.stripe.com/v1/checkout/sessions';
export const CYCLES = new Set(['monthly', 'annual']);
const STRIPE_KEY_RE = /^sk_(test|live)_[A-Za-z0-9]+$/;
const STRIPE_PRICE_RE = /^price_[A-Za-z0-9]+$/;
const STRIPE_WEBHOOK_RE = /^whsec_[A-Za-z0-9]+$/;
const WEBHOOK_TOLERANCE_SEC = 5 * 60;

function isProduction(env = process.env) {
  return env.NODE_ENV === 'production';
}

function wantsLivePayments(env = process.env) {
  return env.PAYMENTS_MODE === 'live';
}

function configError(message) {
  return Object.assign(new Error(message), { status: 500 });
}

export function paymentsConfig(env = process.env) {
  const values = {
    STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
    STRIPE_PRICE_MONTHLY: env.STRIPE_PRICE_MONTHLY,
    STRIPE_PRICE_ANNUAL: env.STRIPE_PRICE_ANNUAL,
    STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET,
  };
  const hasAnyStripeConfig = Object.values(values).some(Boolean);
  if (!hasAnyStripeConfig) {
    if (wantsLivePayments(env)) throw configError('live payments require Stripe environment variables');
    return null;
  }
  const missing = Object.entries(values).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw configError(`incomplete Stripe configuration: missing ${missing.join(', ')}`);
  if (!STRIPE_KEY_RE.test(values.STRIPE_SECRET_KEY)) throw configError('invalid Stripe secret key format');
  if (wantsLivePayments(env) && !values.STRIPE_SECRET_KEY.startsWith('sk_live_')) {
    throw configError('live payments require a live Stripe secret key');
  }
  if (!STRIPE_PRICE_RE.test(values.STRIPE_PRICE_MONTHLY) || !STRIPE_PRICE_RE.test(values.STRIPE_PRICE_ANNUAL)) {
    throw configError('invalid Stripe price id format');
  }
  if (!STRIPE_WEBHOOK_RE.test(values.STRIPE_WEBHOOK_SECRET)) throw configError('invalid Stripe webhook secret format');
  return {
    secretKey: values.STRIPE_SECRET_KEY,
    webhookSecret: values.STRIPE_WEBHOOK_SECRET,
    prices: { monthly: values.STRIPE_PRICE_MONTHLY, annual: values.STRIPE_PRICE_ANNUAL },
  };
}

export async function createCheckoutSession({ cycle, origin, user }, config, fetchImpl = fetch) {
  const price = config.prices[cycle];
  if (!price) throw Object.assign(new Error(`no price configured for ${cycle} billing`), { status: 501 });
  const body = new URLSearchParams({
    mode: 'subscription',
    client_reference_id: user.id,
    'metadata[nodal_user_id]': user.id,
    'subscription_data[metadata][nodal_user_id]': user.id,
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    success_url: `${origin}/payments.html?checkout=success`,
    cancel_url: `${origin}/payments.html?checkout=cancelled`,
  });
  if (user.email) body.set('customer_email', user.email);
  const res = await fetchImpl(STRIPE_SESSIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) throw Object.assign(new Error('payment provider error'), { status: 502 });
  const session = await res.json();
  if (typeof session.url !== 'string') throw Object.assign(new Error('payment provider error'), { status: 502 });
  try {
    const url = new URL(session.url);
    if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('bad checkout URL');
  } catch {
    throw Object.assign(new Error('payment provider error'), { status: 502 });
  }
  return { url: session.url };
}

function parseStripeSignature(header = '') {
  const parts = new Map();
  for (const part of String(header).split(',')) {
    const [key, value] = part.split('=');
    if (key && value) parts.set(key.trim(), value.trim());
  }
  // trimmed: a single space after a comma would drop every signature and
  // reject the delivery as unsigned
  const signatures = String(header).split(',')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('v1='))
    .map((p) => p.slice(3));
  return { timestamp: parts.get('t'), signatures };
}

function safeEqualHex(a, b) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyStripeWebhook(payload, signatureHeader, secret, { now = Date.now } = {}) {
  if (!secret) throw Object.assign(new Error('webhook secret is not configured'), { status: 503 });
  const { timestamp, signatures } = parseStripeSignature(signatureHeader);
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || !signatures.length) {
    throw Object.assign(new Error('invalid webhook signature'), { status: 400 });
  }
  const age = Math.abs(Math.floor(now() / 1000) - ts);
  if (age > WEBHOOK_TOLERANCE_SEC) throw Object.assign(new Error('stale webhook signature'), { status: 400 });
  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  if (!signatures.some((sig) => safeEqualHex(sig, expected))) {
    throw Object.assign(new Error('invalid webhook signature'), { status: 400 });
  }
  try {
    return JSON.parse(payload);
  } catch {
    throw Object.assign(new Error('invalid webhook payload'), { status: 400 });
  }
}
