/* Boot-time checks for the Vercel Production deployment: the proxy setting every
   per-client limit depends on, and the explicit origin that email links need. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntimeConfig, trustsProxy } from '../server/server.js';

const production = {
  NODE_ENV: 'production',
  VERCEL: '1',
  VERCEL_ENV: 'production',
  VERCEL_URL: 'nodal-abc123.vercel.app',
  DATA_BACKEND: 'supabase',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public123',
  SUPABASE_SECRET_KEY: 'sb_secret_server123',
  PUBLIC_BASE_URL: 'https://nodal.example',
  COOKIE_SECURE: 'true',
  PAYMENTS_MODE: 'preview',
  TRUST_PROXY: 'true',
};

test('TRUST_PROXY must be exactly true or false off Vercel; on Vercel its proxy is trusted and a missing value never stops production booting', () => {
  assert.doesNotThrow(() => validateRuntimeConfig(production));
  const { TRUST_PROXY: _unset, VERCEL: _vercel, VERCEL_ENV: _env, VERCEL_URL: _url, ...offVercel } = production;
  for (const value of ['1', 'TRUE', 'yes', ' true']) {
    assert.throws(() => validateRuntimeConfig({ DATA_BACKEND: 'sqlite', TRUST_PROXY: value }), /TRUST_PROXY/, `${value} off Vercel`);
    assert.doesNotThrow(() => validateRuntimeConfig({ ...production, TRUST_PROXY: value }), `${value} on Vercel boots`);
  }
  const { TRUST_PROXY: _proxy, ...withoutProxy } = production;
  assert.doesNotThrow(() => validateRuntimeConfig(withoutProxy), 'unset on Vercel Production boots');
  assert.doesNotThrow(() => validateRuntimeConfig({ ...production, TRUST_PROXY: 'false' }), 'an explicit false only warns');
  assert.ok(offVercel.DATA_BACKEND);
  // Local servers and previews keep working without it.
  assert.doesNotThrow(() => validateRuntimeConfig({ DATA_BACKEND: 'sqlite' }));
  assert.doesNotThrow(() => validateRuntimeConfig({ DATA_BACKEND: 'sqlite', TRUST_PROXY: 'false' }));
  assert.doesNotThrow(() => validateRuntimeConfig({ DATA_BACKEND: 'sqlite', TRUST_PROXY: '' }), 'an empty value is the same as unset');
  assert.doesNotThrow(() => validateRuntimeConfig({ ...withoutProxy, VERCEL_ENV: 'preview' }));
});

test('client IPs come from the proxy headers on Vercel or with TRUST_PROXY=true, and never off Vercel without it', () => {
  assert.equal(trustsProxy({ VERCEL: '1' }), true);
  assert.equal(trustsProxy({ VERCEL: '1', TRUST_PROXY: 'TRUE' }), true);
  assert.equal(trustsProxy({ VERCEL: '1', TRUST_PROXY: 'false' }), false);
  assert.equal(trustsProxy({ TRUST_PROXY: 'true' }), true);
  assert.equal(trustsProxy({}), false);
  assert.equal(trustsProxy({ TRUST_PROXY: '1' }), false);
});

test('Vercel Production needs an explicit https origin, not the per-deployment VERCEL_URL', () => {
  const { PUBLIC_BASE_URL: _unset, ...withoutOrigin } = production;
  assert.throws(() => validateRuntimeConfig(withoutOrigin), /PUBLIC_BASE_URL/);
  assert.doesNotThrow(() => validateRuntimeConfig({ ...withoutOrigin, NEXT_PUBLIC_APP_URL: 'https://nodal.example' }));
  assert.throws(() => validateRuntimeConfig({ ...production, PUBLIC_BASE_URL: 'http://nodal.example' }), /https/);
  assert.throws(() => validateRuntimeConfig({ ...production, PUBLIC_BASE_URL: 'https://user:secret@nodal.example' }), /credentials/);
  assert.throws(() => validateRuntimeConfig({ ...production, PUBLIC_BASE_URL: 'not a url' }), /PUBLIC_BASE_URL/);
  // A Preview deployment still runs on its own VERCEL_URL.
  assert.doesNotThrow(() => validateRuntimeConfig({ ...withoutOrigin, VERCEL_ENV: 'preview' }));
});
