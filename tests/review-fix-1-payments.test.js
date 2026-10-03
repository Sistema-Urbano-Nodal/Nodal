/* Membership billing: a second subscription, account deletion while one is
   live, foreign Checkout Sessions and Stripe's item-level billing periods. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { createApp } from '../server/server.js';
import { createDatabase } from '../server/db.js';

const SECRET = 'whsec_review_fix_1';

async function fixture(t) {
  const oldBase = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'https://nodal.example';
  t.after(() => { if (oldBase === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = oldBase; });
  const db = createDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  const stripeCalls = [];
  const payments = {
    config: { secretKey: 'sk_test_x', webhookSecret: SECRET, prices: { monthly: 'price_m', annual: 'price_a' } },
    fetchImpl: async (url, opts) => {
      stripeCalls.push({ url: String(url), body: String(opts?.body || '') });
      return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_test_new' }) };
    },
  };
  const server = createApp({ db, payments, pilotMode: false, citySearch: { search: async () => ({ cities: [] }) } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (path, method, body, cookie) => fetch(`${base}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const signup = await json('/api/auth/signup', 'POST', { fullName: 'Paying Member', email: 'paying@example.test', password: 'correct-horse' });
  const user = (await signup.clone().json()).user;
  const cookie = signup.headers.get('set-cookie').split(';')[0];
  const webhook = event => {
    const payload = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', SECRET).update(`${ts}.${payload}`).digest('hex');
    return fetch(`${base}/api/stripe/webhook`, { method: 'POST', headers: { 'Stripe-Signature': `t=${ts},v1=${sig}` }, body: payload });
  };
  const status = async () => (await (await fetch(`${base}/api/billing/status`, { headers: { Cookie: cookie } })).json()).subscription;
  const subscribe = async () => {
    const res = await webhook({
      id: 'evt_completed', created: 100, type: 'checkout.session.completed',
      data: { object: { id: 'cs_a', mode: 'subscription', client_reference_id: user.id, metadata: { nodal_user_id: user.id }, customer: 'cus_a', subscription: 'sub_a', payment_status: 'paid' } },
    });
    assert.equal(res.status, 200);
    assert.equal((await status()).status, 'active');
  };
  return { db, user, cookie, json, webhook, status, subscribe, stripeCalls };
}

test('a member with a live subscription cannot open a second checkout', async t => {
  const f = await fixture(t);
  await f.subscribe();
  const second = await f.json('/api/checkout', 'POST', { plan: 'membership', cycle: 'annual' }, f.cookie);
  assert.equal(second.status, 409);
  assert.equal((await second.json()).code, 'already_subscribed');
  assert.equal(f.stripeCalls.length, 0, 'Stripe is never asked for a second session');

  // Once that subscription has ended, checkout opens again.
  assert.equal((await f.webhook({ id: 'evt_deleted', created: 200, type: 'customer.subscription.deleted', data: { object: { id: 'sub_a', customer: 'cus_a', status: 'canceled', metadata: { nodal_user_id: f.user.id } } } })).status, 200);
  const again = await f.json('/api/checkout', 'POST', { plan: 'membership', cycle: 'annual' }, f.cookie);
  assert.equal(again.status, 200);
  assert.equal(f.stripeCalls.length, 1);
});

test('account deletion waits until the membership is cancelled', async t => {
  const f = await fixture(t);
  await f.subscribe();
  const refused = await f.json('/api/me', 'DELETE', { confirmEmail: 'paying@example.test' }, f.cookie);
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).code, 'subscription_active');
  assert.ok(f.db.prepare('SELECT id FROM users WHERE id = ?').get(f.user.id), 'nothing was deleted');
  assert.equal((await f.webhook({ id: 'evt_gone', created: 300, type: 'customer.subscription.deleted', data: { object: { id: 'sub_a', customer: 'cus_a', status: 'canceled', metadata: { nodal_user_id: f.user.id } } } })).status, 200);
  const deleted = await f.json('/api/me', 'DELETE', { confirmEmail: 'paying@example.test' }, f.cookie);
  assert.equal(deleted.status, 200);
  assert.equal(f.db.prepare('SELECT id FROM users WHERE id = ?').get(f.user.id), undefined);
});

test('a completed Checkout Session that is not a NODAL membership never activates one', async t => {
  const f = await fixture(t);
  const foreign = [
    { id: 'cs_payment', mode: 'payment', client_reference_id: f.user.id, customer: 'cus_x', subscription: null, payment_status: 'paid' },
    { id: 'cs_nosub', mode: 'subscription', client_reference_id: f.user.id, customer: 'cus_x', payment_status: 'paid' },
    { id: 'cs_mismatch', mode: 'subscription', client_reference_id: f.user.id, metadata: { nodal_user_id: 'someone-else' }, customer: 'cus_x', subscription: 'sub_x', payment_status: 'paid' },
    // A subscription-mode Payment Link can carry client_reference_id in its URL but never NODAL's metadata.
    { id: 'cs_payment_link', mode: 'subscription', client_reference_id: f.user.id, customer: 'cus_x', subscription: 'sub_link', payment_status: 'paid' },
  ];
  for (const [i, object] of foreign.entries()) {
    assert.equal((await f.webhook({ id: `evt_foreign_${i}`, created: 10 + i, type: 'checkout.session.completed', data: { object } })).status, 200);
    assert.equal((await f.status()).status, 'none', object.id);
  }
});

test('the renewal date is read from the subscription item on current Stripe API versions', async t => {
  const f = await fixture(t);
  await f.subscribe();
  const periodEnd = Math.floor(Date.parse('2026-11-03T00:00:00Z') / 1000);
  assert.equal((await f.webhook({
    id: 'evt_updated', created: 150, type: 'customer.subscription.updated',
    data: { object: { id: 'sub_a', customer: 'cus_a', status: 'active', metadata: { nodal_user_id: f.user.id }, items: { data: [{ id: 'si_a', current_period_end: periodEnd }] } } },
  })).status, 200);
  assert.equal((await f.status()).currentPeriodEnd, '2026-11-03T00:00:00.000Z');
});
