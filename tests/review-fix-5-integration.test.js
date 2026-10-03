/* October 3 full review, integration pass: the changes that connect one fixer's server work to another's client or
   docs. Each test names the finding it covers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createDatabase, createUser } from '../server/db.js';
import { createSession } from '../server/auth.js';
import { createApp } from '../server/server.js';
import { createCourseStore } from '../server/courses-repository.js';
import { setupCoursePilot } from '../scripts/setup-course-pilot.js';
import { createCheckoutSession } from '../server/payments.js';
import { createSupabaseRepository } from '../server/supabase.js';
import { createCourseParticipants } from '../server/course-participants.js';

const script = name => readFileSync(new URL(`../web/scripts/${name}.js`, import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

/* ---------- membership page (catalog-news-payments-1, frontend-xss-1) ---------- */
function paymentsPage({ status = { status: 'none', active: false }, checkout, AbortSignal: signalApi = AbortSignal, search = '' } = {}) {
  const node = id => ({ id, textContent: '', hidden: true, disabled: false, listeners: {}, attributes: {},
    classList: { toggle() {} }, setAttribute(k, v) { this.attributes[k] = v; }, addEventListener(k, f) { this.listeners[k] = f; } });
  const ids = ['cycleMonthly', 'cycleAnnual', 'proPrice', 'proPer', 'proNote', 'sumCycle', 'sumPrice', 'sumRenews', 'cycleAnnualBadge', 'selectPro', 'summaryCheckout', 'payCheckoutNote'];
  const nodes = Object.fromEntries(ids.map(id => [id, node(id)]));
  const requests = [], languageListeners = [];
  let assigned = null;
  const i18n = { lang: 'en', t: key => `${i18n.lang}:${key}`, onChange: f => languageListeners.push(f) };
  const context = {
    window: { nodalI18n: i18n }, URLSearchParams, URL, AbortSignal: signalApi,
    document: { getElementById: id => nodes[id] ?? null, querySelector: () => ({ scrollIntoView() {} }) },
    location: { search, pathname: '/payments.html', assign: url => { assigned = url; } },
    fetch: async (path, options = {}) => {
      requests.push({ path, options });
      if (path === '/api/billing/config') return { ok: false, status: 404, json: async () => ({}) };
      if (path === '/api/billing/status') return { ok: true, status: 200, json: async () => ({ subscription: status }) };
      const answer = await (checkout ?? (async () => ({ status: 200, body: { url: 'https://checkout.stripe.com/c/pay/cs_x' } })))(options);
      return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
    },
  };
  vm.createContext(context);
  vm.runInContext(script('payments'), context);
  return {
    nodes, requests, assigned: () => assigned,
    click: async () => { await nodes.selectPro.listeners.click(); await flush(); },
    lang: lang => { i18n.lang = lang; languageListeners.forEach(f => f()); },
  };
}

test('frontend-xss-1: membership checkout still starts on Safari before 16, which has no AbortSignal.timeout', async () => {
  const page = paymentsPage({ AbortSignal: {} });
  await flush();
  await page.click();
  const checkout = page.requests.find(r => r.path === '/api/checkout');
  assert.ok(checkout, 'the checkout request is sent');
  assert.equal('signal' in checkout.options, false);
  assert.equal(page.assigned(), 'https://checkout.stripe.com/c/pay/cs_x');
});

test('catalog-news-payments-1: a second checkout refused as already_subscribed is explained in the member’s language', async () => {
  const page = paymentsPage({ checkout: async () => ({ status: 409, body: { error: 'You already have a NODAL membership.', code: 'already_subscribed' } }) });
  await flush();
  await page.click();
  assert.equal(page.assigned(), null);
  assert.equal(page.nodes.payCheckoutNote.textContent, 'en:y.alreadyMember');
  assert.equal(page.nodes.payCheckoutNote.hidden, false);
  assert.equal(page.nodes.selectPro.disabled, true, 'the buttons stay off');
  page.lang('pt');
  assert.equal(page.nodes.payCheckoutNote.textContent, 'pt:y.alreadyMember');
  // Another 409 keeps the old fallback.
  const other = paymentsPage({ checkout: async () => ({ status: 409, body: { error: 'conflict' } }) });
  await flush();
  await other.click();
  assert.equal(other.nodes.payCheckoutNote.textContent, 'en:y.notConfigured');
  assert.equal(other.nodes.selectPro.disabled, false);
});

test('catalog-news-payments-1: a live membership turns checkout off when the page loads', async () => {
  for (const status of ['pending', 'active', 'trialing', 'past_due', 'unpaid', 'paused']) {
    const page = paymentsPage({ status: { status, active: status === 'active' } });
    await flush();
    assert.equal(page.nodes.selectPro.disabled, true, status);
    assert.equal(page.nodes.summaryCheckout.disabled, true, status);
    assert.equal(page.nodes.payCheckoutNote.textContent, 'en:y.alreadyMember', status);
    await page.click();
    assert.equal(page.requests.some(r => r.path === '/api/checkout'), false, `${status}: no checkout request`);
  }
  for (const status of ['none', 'canceled', 'incomplete_expired']) {
    const page = paymentsPage({ status: { status, active: false } });
    await flush();
    assert.equal(page.nodes.selectPro.disabled, false, status);
  }
  const i18n = script('i18n');
  for (const key of ['y.alreadyMember', 'd.uc.deleteSubscription']) assert.equal(i18n.split(`'${key}':`).length - 1, 3, `${key} in EN, ES and PT`);
});

/* ---------- console account deletion (catalog-news-payments-2) ---------- */
test('catalog-news-payments-2: the console shows a refused deletion in the member’s language', async () => {
  const source = script('dashboard');
  const api = source.slice(source.indexOf('  async function api(path, options = {}) {'), source.indexOf('  function normalizeApiUser'));
  const start = source.indexOf("    uc.deleteAccount?.addEventListener('click'");
  const handler = source.slice(start, source.indexOf("\n  }\n\n  byId('logoutBtn')", start));
  assert.ok(api.length > 100 && handler.length > 100, 'the code is where the test expects it');
  for (const [answer, shown] of [
    [{ status: 409, body: { error: 'Cancel your NODAL membership before deleting your account.', code: 'subscription_active' } }, 'd.uc.deleteSubscription'],
    [{ status: 400, body: { error: 'account deletion requires email confirmation' } }, 'account deletion requires email confirmation'],
  ]) {
    let click;
    const context = vm.createContext({
      t: key => key, JSON, prompt: () => 'member@example.test', encodeURIComponent,
      location: { pathname: '/dashboard.html', assign() { throw new Error('must not navigate'); } },
      fetch: async () => ({ ok: false, status: answer.status, json: async () => answer.body }),
      uc: { deleteAccount: { addEventListener: (type, fn) => { click = fn; } }, error: { hidden: true, textContent: '' } },
    });
    vm.runInContext(api + handler, context);
    await click();
    assert.equal(context.uc.error.textContent, shown);
    assert.equal(context.uc.error.hidden, false);
  }
});

/* ---------- teaching workspace (frontend-xss-1); its UI test is in course-participants-ui.test.js ---------- */
test('frontend-xss-1: the teaching workspace leaves the request time limit to api(), which guards Safari before 16', () => {
  const source = script('teaching').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(source, /AbortSignal\.timeout/);
  // Every remaining call in the front end checks for the method first.
  for (const name of ['payments', 'globe', 'accept-invitation', 'pilot', 'auth', 'password-recovery', 'fiiu-ui', 'fiiu-admin']) {
    const code = script(name).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    for (const match of code.matchAll(/AbortSignal\.timeout\(/g)) {
      const before = code.slice(Math.max(0, match.index - 160), match.index);
      assert.match(before, /typeof AbortSignal\.timeout\s*===\s*'function'/, `${name}.js guards AbortSignal.timeout`);
    }
  }
});

/* ---------- Stripe checkout idempotency (catalog-news-payments-1) ---------- */
test('catalog-news-payments-1: repeated checkout requests in one window share a Stripe Idempotency-Key', async () => {
  const keys = [];
  const fetchImpl = async (url, options) => {
    keys.push(options.headers['Idempotency-Key']);
    return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/cs_x' }) };
  };
  const config = { secretKey: 'sk_test_x', prices: { monthly: 'price_m', annual: 'price_a' } };
  const user = { id: '00000000-0000-4000-8000-000000000001', email: 'member@example.test' };
  const at = Date.parse('2026-10-03T12:00:00Z');
  for (const [cycle, now] of [['monthly', at], ['monthly', at + 60_000], ['annual', at], ['monthly', at + 11 * 60_000]]) {
    await createCheckoutSession({ cycle, origin: 'https://nodal.example', user }, config, fetchImpl, now);
  }
  assert.ok(keys.every(key => /^[0-9a-f]{64}$/.test(key)));
  assert.equal(keys[0], keys[1], 'a double click gets the same session');
  assert.notEqual(keys[0], keys[2], 'another cycle is another session');
  assert.notEqual(keys[0], keys[3], 'a later attempt is a new session');
  assert.doesNotMatch(keys.join(''), /member@example|00000000/);
});

/* ---------- legacy attachment names (courses-1) ---------- */
test('courses-1: a file stored before names were cleaned is listed and downloaded under its type’s extension', async t => {
  const db = createDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  const store = createCourseStore({ db }), course = await setupCoursePilot(store);
  const module = (await store.find('modules', { courseId: course.id, kind: 'session' }))[0];
  const server = createApp({ db, pilotMode: true });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`, cookies = {}, users = {};
  const call = (actor, path, method = 'GET', body) => fetch(base + path, { method, headers: { Cookie: cookies[actor], Origin: base, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const actor of ['author', 'peer']) {
    users[actor] = createUser(db, { fullName: actor, email: `${actor}@example.test`, passwordHash: 'unused' });
    cookies[actor] = createSession(db, users[actor].id).cookie.split(';')[0];
    assert.ok((await call(actor, `/api/courses/${course.id}/enroll`, 'POST', {})).ok);
    assert.ok((await call(actor, `/api/courses/${course.id}/intake`, 'PUT', { fullName: actor, profession: 'Planner', city: 'Lima', motivation: 'Learn', experience: 'Some', expectations: 'Practice', caseStudy: 'Station', digitalFamiliarity: 'Comfortable' })).ok);
  }
  // A row written by the old upload code, which kept the uploader's name as sent.
  const id = randomUUID(), legacy = 'grades‮txt.hta';
  const row = await store.insert('attachments', { id, courseId: course.id, moduleId: module.id, userId: users.author.id, purpose: 'post', name: legacy, mime: 'text/plain', size: 5, storagePath: `${users.author.id}/${id}`, status: 'ready', createdAt: new Date().toISOString() });
  await store.putFile(row, Buffer.from('notes'));
  assert.equal((await call('author', `/api/courses/${course.id}/modules/${module.id}/posts`, 'POST', { clientId: randomUUID(), kind: 'question', body: 'See attached', attachmentIds: [id] })).status, 201);
  const listing = await (await call('peer', `/api/courses/${course.id}/modules/${module.id}/posts`)).json();
  const shown = JSON.stringify(listing);
  assert.match(shown, /grades_txt\.hta\.txt/);
  assert.doesNotMatch(shown, /‮|\\u202e/i);
  const download = await call('peer', `/api/course-attachments/${id}`);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-disposition'), `attachment; filename="grades_txt.hta.txt"; filename*=UTF-8''grades_txt.hta.txt`);
});

/* ---------- Supabase profile lists (catalog-news-payments-6) ---------- */
test('catalog-news-payments-6: the Supabase repository caps profile lists on read and on write, like SQLite', async () => {
  const userId = '00000000-0000-4000-8000-0000000000aa';
  const long = 'x'.repeat(2300), writes = [];
  const onboarding = { user_id: userId, created_at: '2026-10-01T00:00:00Z', interests: [long, ' water ', 'water', '', 7, { nested: true }, ...Array.from({ length: 20 }, (_, i) => `topic ${i}`)], skills: [long], goals: [long], raw_answers: { active: Array.from({ length: 9 }, (_, i) => `slot ${i}`) } };
  const fetchImpl = async (raw, options = {}) => {
    const url = new URL(raw);
    if (options.method && options.method !== 'GET') { writes.push({ path: url.pathname, body: options.body ? JSON.parse(options.body) : null }); return new Response('[]', { status: 200 }); }
    if (url.pathname.endsWith('/profiles')) return new Response(JSON.stringify([{ id: userId, email: 'member@example.test', full_name: 'Member', app_role: 'member', account_status: 'active', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }]), { status: 200 });
    if (url.pathname.endsWith('/profile_preferences')) return new Response(JSON.stringify([{ user_id: userId, data_consent: {}, notification_preferences: {} }]), { status: 200 });
    if (url.pathname.endsWith('/onboarding_responses')) return new Response(JSON.stringify([onboarding]), { status: 200 });
    return new Response('[]', { status: 200 });
  };
  const repo = createSupabaseRepository({ env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-public-key', SUPABASE_SECRET_KEY: 'test-server-key' }, fetchImpl });
  const user = await repo.getUserById(userId);
  assert.equal(user.interests.length, 12);
  assert.deepEqual(user.interests.slice(0, 3), ['x'.repeat(80), 'water', '7']);
  assert.deepEqual(user.skills, ['x'.repeat(80)]);
  assert.deepEqual(user.goals, ['x'.repeat(80)]);
  assert.equal(user.active.length, 6);
  await repo.updateUserProfile(userId, { interests: [long, long, 'mobility'], skills: [' GIS ', 'GIS'], active: Array.from({ length: 8 }, (_, i) => `slot ${i}`) }).catch(() => null);
  const written = JSON.stringify(writes);
  assert.ok(writes.length > 0, 'the profile was written');
  assert.doesNotMatch(written, /x{81}/, 'no item over 80 characters is written');
  assert.match(written, /"mobility"/);
});

/* ---------- course invitation failures keep their cause (courses-9) ---------- */
test('courses-9: a provider failure behind an invitation stays attached as the cause', async () => {
  const provider = Object.assign(new Error('SMTP relay refused the message'), { status: 500 });
  const rows = new Map();
  const store = {
    async find(name, filters) { return [...rows.values()].filter(row => row.table === name && Object.entries(filters).every(([k, v]) => row[k] === v)); },
    async insert(name, row) { const stored = { ...row, table: name }; rows.set(row.id, stored); return stored; },
    async update(name, filters, patch) { const [row] = await this.find(name, filters); if (!row) return null; Object.assign(row, patch); return row; },
    async remove() { return true; },
    async count() { return 0; },
  };
  const participants = createCourseParticipants({ store, userRepository: { findCourseAccount: async () => null, sendCourseInvitation: async () => { throw provider; } } });
  const course = { id: '00000000-0000-4000-8000-0000000000c1', status: 'published', enrollmentOpen: true };
  const error = await participants.invite(course, 'new@example.test', '00000000-0000-4000-8000-0000000000a1').catch(e => e);
  assert.ok(error instanceof Error, 'the invitation fails');
  assert.equal(error.code, 'invitation_uncertain');
  assert.equal(error.cause, provider);
});

/* ---------- build configuration (config-deps-5) ---------- */
test('config-deps-5: the Vercel install keeps devDependencies even if NODE_ENV is set as a project variable', () => {
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(vercel.installCommand, 'npm ci --include=dev');
  const deployment = readFileSync(new URL('../DEPLOYMENT.md', import.meta.url), 'utf8');
  const block = deployment.slice(deployment.indexOf('Set these in Vercel Project Settings:'), deployment.indexOf('Amounts appear only when checkout'));
  assert.doesNotMatch(block, /^NODE_ENV=/m);
  for (const name of ['SIGNUP_EMAIL_HOURLY_LIMIT', 'AUTH_ACCOUNT_RATE_LIMIT', 'SESSION_REFRESH_FAILURE_LIMIT', 'NETWORK_GEOCODE_BUDGET_MS', '--ignore-cap', '20261003201144_course_posts_revision_definer.sql', '20261003201338_close_client_grants_on_server_tables.sql']) {
    assert.ok(deployment.includes(name), `DEPLOYMENT.md documents ${name}`);
  }
});
