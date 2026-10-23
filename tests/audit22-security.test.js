/* Security findings of the 22 Oct 2026 audit (S1 log lines, S2, S4). SQLite apps, and a fake PostgREST for the
   Supabase ids: nothing here reaches a real provider. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/server.js';
import { createDatabase, createUser } from '../server/db.js';
import { createSession } from '../server/auth.js';
import { createSupabaseRepository } from '../server/supabase.js';
import { STATIC_PAGES } from '../scripts/build-static.js';

const ROOT = path.resolve(import.meta.dirname, '..');
async function listen(t, server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}
async function bootDb(t, options = {}) {
  const db = createDatabase({ filename: ':memory:' }); t.after(() => db.close());
  const base = await listen(t, createApp({ db, pilotMode: false, fiiuConfirmation: null, fiiuPartyNotice: null, citySearch: { search: async () => ({ cities: [] }) }, ...options }));
  const account = (role = 'member', email = `${role}@example.test`) => {
    const user = createUser(db, { fullName: `${role} Persona`, email, passwordHash: 'unused', role });
    return { user, cookie: createSession(db, user.id).cookie.split(';')[0] };
  };
  return { base, account };
}
function capture(t, method) {
  const lines = [], original = console[method];
  console[method] = (...args) => { lines.push(args.join(' ')); };
  t.after(() => { console[method] = original; });
  return lines;
}

/* The two downloads with the most personal data (every festival registrant's answers, national id included, and
   every Founder Membership acceptance) leave a line in the server log: who (the account id, nothing else) and when. */
test('each download of the festival export or the acceptances CSV is logged with the account id and time only', async t => {
  const { base, account } = await bootDb(t);
  const admin = account('admin');
  const lines = capture(t, 'info');
  for (const route of ['/api/admin/fiiu/export', '/api/admin/membership/acceptances']) {
    const before = lines.length;
    const response = await fetch(base + route, { headers: { Cookie: admin.cookie } });
    assert.equal(response.status, 200, route);
    await response.arrayBuffer();
    const logged = lines.slice(before).filter(line => line.includes(route));
    assert.equal(logged.length, 1, route);
    assert.ok(logged[0].includes(admin.user.id), 'who');
    assert.match(logged[0], /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/, 'when');
    assert.doesNotMatch(logged[0], /@|Persona/, 'no email or name');
  }
  // A refused download is no download.
  const member = account('member');
  const before = lines.length;
  assert.equal((await fetch(base + '/api/admin/membership/acceptances', { headers: { Cookie: member.cookie } })).status, 403);
  assert.equal(lines.slice(before).filter(line => /acceptances/.test(line)).length, 0);
});

test('catalog details and member cards are read on a budget like the catalog and the directory', async t => {
  const { base, account } = await bootDb(t);
  // Until the budget (60 a minute unless CATALOG_READ_RATE_LIMIT / READ_RATE_LIMIT say otherwise) runs out.
  const until429 = async request => {
    const statuses = [];
    for (let i = 0; i < 400 && statuses.at(-1) !== 429; i += 1) statuses.push((await request(i)).status);
    return statuses;
  };
  const details = await until429(i => fetch(`${base}/api/catalog/nope-${i}`));
  assert.equal(details.at(-1), 429, 'a guest guessing ids is throttled');
  assert.deepEqual([...new Set(details.slice(0, -1))], [404]);
  const member = account();
  const cards = await until429(() => fetch(`${base}/api/users/${member.user.id}`, { headers: { Cookie: member.cookie } }));
  assert.equal(cards.at(-1), 429);
  assert.deepEqual([...new Set(cards.slice(0, -1))], [200]);
});

/* catalog_items and profiles key on uuids, and PostgREST answers any other id with 22P02 (a 400): every guest guess
   cost a provider call, an error log line and an error report. An id that cannot exist is answered as missing here. */
test('Supabase answers a catalog item or a member that cannot exist without asking PostgREST', async t => {
  const calls = [];
  const fetchImpl = async raw => {
    calls.push(new URL(raw).pathname);
    return new Response(JSON.stringify({ code: '22P02', message: 'invalid input syntax for type uuid: "probe"' }), { status: 400, headers: { 'content-type': 'application/json' } });
  };
  const repository = createSupabaseRepository({ env: { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-public-key', SUPABASE_SECRET_KEY: 'test-server-key' }, fetchImpl });
  assert.equal(await repository.getCatalogItem('probe1'), null);
  assert.equal(await repository.getCatalogItem('probe1', { permission: 'admin' }), null);
  assert.equal(await repository.getUserById('member-1'), null);
  assert.equal(await repository.getUserById({ toString: 1 }), null);
  assert.deepEqual(calls, []);
  const reports = [], errors = capture(t, 'error');
  const base = await listen(t, createApp({ repository, courseStore: null, fiiuStore: null, newsStore: null, errorReport: { enabled: true, report: async (_err, context) => { reports.push(context); return true; } } }));
  for (let i = 0; i < 5; i += 1) assert.equal((await fetch(`${base}/api/catalog/probe${i}`)).status, 404);
  assert.deepEqual(calls, []);
  assert.deepEqual(reports, []);
  assert.deepEqual(errors, []);
});

/* The pages the CDN serves (scripts/build-static.js) never pass through the server, so vercel.json gives them the
   headers the server gives its own pages: the full policy (production adds upgrade-insecure-requests), the referrer,
   permissions and opener policies, besides framing. */
test('the CDN pages get the server\'s page policy, referrer, permissions and opener headers', async t => {
  const { base } = await bootDb(t);
  const served = await fetch(`${base}/login.html`);
  await served.arrayBuffer();
  const vercel = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  for (const page of STATIC_PAGES) {
    const rule = vercel.headers.find(route => new RegExp(`^${route.source}$`).test(`/${page}`));
    assert.ok(rule, page);
    const header = key => rule.headers.find(entry => entry.key.toLowerCase() === key.toLowerCase())?.value;
    // The suite also runs with the production environment (Vercel's build), where the server adds the directive itself.
    const policy = served.headers.get('content-security-policy').replace(/; upgrade-insecure-requests$/, '');
    assert.equal(header('Content-Security-Policy'), `${policy}; upgrade-insecure-requests`, page);
    for (const key of ['Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Opener-Policy', 'X-Frame-Options']) assert.equal(header(key), served.headers.get(key), `${page}: ${key}`);
  }
});
