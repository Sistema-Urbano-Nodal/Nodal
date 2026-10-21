import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createApp as createProductionApp, publicBillingConfig, staticSourcePath } from '../server/server.js';
import { createDatabase, createUser, deleteUserById } from '../server/db.js';
import { createSession } from '../server/auth.js';
import { createRepository } from '../server/repository.js';
import { createSupabaseRepository } from '../server/supabase.js';
import { FUNDADORES_2027 } from '../server/membership-offer.js';

/* The Founder Membership 2027 (docs/superpowers/specs/2026-10-21-nodal-fundadores-design.md). Every app here gets its own
   billing settings and clock: Vercel runs the suite with the production environment, and on any date. */
const ROOT = path.resolve(import.meta.dirname, '..');
const ONCE = 'https://link.mercadopago.com.pe/nodal-fundadores';
const TWICE = 'https://www.mercadopago.com.pe/subscriptions/checkout?preapproval_plan_id=2c938084fundadores';
const CONTACT = { MEMBERSHIP_CONTACT_EMAIL: 'membresias@nodal.example', MEMBERSHIP_COMPLAINTS_URL: 'https://reclamos.example/nodal' };
const OPEN = { MERCADOPAGO_LINK_ANNUAL: ONCE, MERCADOPAGO_LINK_INSTALLMENTS: TWICE, ...CONTACT };
const BEFORE = Date.parse('2026-10-21T15:00:00.000Z');
const STARTS = Date.parse('2026-10-21T05:00:00.000Z');
const ENDS = Date.parse('2027-01-01T05:00:00.000Z');
const VERSION = 'FUNDADORES-2027-v1';
const OFFER = {
  name: 'Membresía Fundador 2027', version: VERSION, effectiveFrom: '2026-10-21', endsAt: '2027-01-01T05:00:00.000Z',
  earlyAccessUntil: '2026-12-31', membershipFrom: '2027-01-01', membershipTo: '2027-12-31', renewalFrom: '2028-01-01',
  seller: { name: 'Sistema Urbano', ruc: '20605878815', address: 'Calle General Varela 154 A, Miraflores' },
};
const OPTION_ONCE = { id: 'once', amount: 'S/ 499' };
const OPTION_TWICE = { id: 'installments', amount: 'S/ 550', each: 'S/ 275', count: 2, monthsApart: 2 };
const CONTACT_VIEW = { email: 'membresias@nodal.example', complaintsUrl: 'https://reclamos.example/nodal' };
const closed = (state, contact = null) => ({ checkout: false, provider: null, state, offer: OFFER, annual: { amount: 'Soon', per: '' }, options: [], contact });

async function boot(t, { billingEnv = OPEN, now = () => BEFORE, pilotMode = false, ...options } = {}) {
  const db = createDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  const server = createProductionApp({ db, billingEnv, now, pilotMode, citySearch: { search: async () => ({ cities: [] }) }, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const member = (fullName = 'Ana Fundadora', email = 'ana@example.test', role = 'member') => {
    const user = createUser(db, { fullName, email, passwordHash: 'unused', role });
    return { user, cookie: createSession(db, user.id).cookie.split(';')[0] };
  };
  return { db, base, member };
}
const valid = (option = 'once') => ({ option, version: VERSION, accept: { terms: true, payment: true, renewal: true } });
const accept = (base, cookie, body, headers = {}) => fetch(`${base}/api/membership/acceptances`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...headers },
  body: JSON.stringify(body),
});
const rows = (db) => db.prepare('SELECT * FROM membership_acceptances ORDER BY accepted_at ASC, rowid ASC').all().map((row) => ({ ...row }));

test('the offer in code is the terms version FUNDADORES-2027-v1, frozen', () => {
  assert.equal(FUNDADORES_2027.version, VERSION);
  assert.equal(FUNDADORES_2027.endsAt, '2027-01-01T05:00:00.000Z', '31 Dec 2026, 23:59:59 in Lima is the last moment');
  assert.equal(FUNDADORES_2027.effectiveFromAt, `${FUNDADORES_2027.effectiveFrom}T05:00:00.000Z`, '00:00 in Lima on the day the terms take effect');
  assert.deepEqual(FUNDADORES_2027.options, { once: { amount: 'S/ 499' }, installments: { each: 'S/ 275', total: 'S/ 550', count: 2, monthsApart: 2 } });
  assert.deepEqual(FUNDADORES_2027.seller, OFFER.seller);
  for (const value of [FUNDADORES_2027, FUNDADORES_2027.options, FUNDADORES_2027.options.once, FUNDADORES_2027.options.installments, FUNDADORES_2027.seller]) assert.ok(Object.isFrozen(value));
});

test('billing config is open, with the offer and both options but never a link, only before endsAt with both links and the contact set', async (t) => {
  const open = { checkout: true, provider: 'mercadopago', state: 'open', offer: OFFER, annual: { amount: 'S/ 499', per: '' }, options: [OPTION_ONCE, OPTION_TWICE], contact: CONTACT_VIEW };
  assert.deepEqual(publicBillingConfig(OPEN, BEFORE), open);
  assert.deepEqual(publicBillingConfig(OPEN, ENDS - 1), open, 'the last millisecond of 31 Dec 2026 in Lima');
  for (const pilotMode of [true, false]) {
    const { base } = await boot(t, { pilotMode });
    const res = await fetch(`${base}/api/billing/config`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), open, `pilot ${pilotMode}`);
    assert.doesNotMatch(text, /mercadopago\.com\.pe|preapproval_plan_id|"url"/, 'the links come only from an acceptance');
  }
  // Either option alone is offered by itself; the year's price is the single payment's, or the installments' total.
  assert.deepEqual(publicBillingConfig({ MERCADOPAGO_LINK_ANNUAL: ONCE, ...CONTACT }, BEFORE).options, [OPTION_ONCE]);
  const twice = publicBillingConfig({ MERCADOPAGO_LINK_INSTALLMENTS: TWICE, ...CONTACT }, BEFORE);
  assert.deepEqual([twice.state, twice.options, twice.annual], ['open', [OPTION_TWICE], { amount: 'S/ 550', per: '' }]);
  // The amounts come from the terms version: the old price labels change nothing.
  assert.deepEqual(publicBillingConfig({ ...OPEN, SUBSCRIPTION_PRICE_ANNUAL_LABEL: 'S/ 240', SUBSCRIPTION_PRICE_INSTALLMENTS_LABEL: '2 × S/ 120', SUBSCRIPTION_ANNUAL_PERIOD: '/ year' }, BEFORE), open);
});

test('billing config stays "soon" until an option and the contact email are set; the Libro de Reclamaciones link is optional', () => {
  assert.deepEqual(publicBillingConfig({}, BEFORE), closed('soon'), 'nothing configured');
  assert.deepEqual(publicBillingConfig({ MERCADOPAGO_LINK_ANNUAL: ONCE, MERCADOPAGO_LINK_INSTALLMENTS: TWICE }, BEFORE), closed('soon'), 'links without a contact');
  // 21 Oct 2026, the user's decision: sales open with the contact email alone until Sistema Urbano's book exists.
  const withoutBook = publicBillingConfig({ ...OPEN, MEMBERSHIP_COMPLAINTS_URL: '' }, BEFORE);
  assert.equal(withoutBook.state, 'open', 'no complaints book yet');assert.equal(withoutBook.checkout, true);
  assert.deepEqual(withoutBook.contact, { email: CONTACT_VIEW.email, complaintsUrl: null });
  assert.deepEqual(publicBillingConfig({ ...OPEN, MEMBERSHIP_CONTACT_EMAIL: '  ' }, BEFORE), closed('soon'), 'no contact email');
  assert.deepEqual(publicBillingConfig(CONTACT, BEFORE), closed('soon', CONTACT_VIEW), 'a contact without links');
  assert.deepEqual(publicBillingConfig({ ...CONTACT, MERCADOPAGO_LINK_ANNUAL: 'https://evil.example/pay', MERCADOPAGO_LINK_INSTALLMENTS: 'http://link.mercadopago.com.pe/x' }, BEFORE), closed('soon', CONTACT_VIEW), 'only bad links');
  // The default clock is the real one.
  assert.equal(publicBillingConfig({}).offer.version, VERSION);
});

test('billing config stays "soon" before the terms take effect (21 Oct 2026, 00:00 Lima), whatever is configured', () => {
  assert.deepEqual(publicBillingConfig(OPEN, STARTS - 1), closed('soon', CONTACT_VIEW), 'the last millisecond of 20 Oct 2026 in Lima');
  assert.deepEqual(publicBillingConfig(OPEN, Date.parse('2026-10-20T15:00:00.000Z')), closed('soon', CONTACT_VIEW), 'the day before');
  assert.equal(publicBillingConfig(OPEN, STARTS).state, 'open', 'exactly when the terms take effect');
});

test('billing config says "ended" from endsAt on, whatever is configured, and offers nothing', () => {
  assert.deepEqual(publicBillingConfig(OPEN, ENDS), closed('ended', CONTACT_VIEW), 'exactly at endsAt');
  assert.deepEqual(publicBillingConfig(OPEN, ENDS + 86400000), closed('ended', CONTACT_VIEW), 'the day after');
  assert.deepEqual(publicBillingConfig({}, ENDS), closed('ended'), 'nothing configured');
  assert.deepEqual(publicBillingConfig({ MERCADOPAGO_LINK_ANNUAL: ONCE }, ENDS), closed('ended'), 'a link without a contact');
});

test('a contact email that is not a plain address keeps the membership closed, a complaints link that is not https is left out, and each is logged once', (t) => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  t.after(() => { console.warn = original; });
  for (const email of ['not-an-email', 'a@b', 'membresias@nodal', 'two@@nodal.example', 'with space@nodal.example', 'x@nodal.example?subject=hi',
    '<membresias@nodal.example>', 'mailto:membresias@nodal.example', 'membresias@nodal.example,other@nodal.example', `${'a'.repeat(250)}@nodal.example`]) {
    assert.deepEqual(publicBillingConfig({ ...OPEN, MEMBERSHIP_CONTACT_EMAIL: email }, BEFORE), closed('soon'), email);
  }
  for (const url of ['http://reclamos.example/nodal', 'https://user:pass@reclamos.example/nodal', 'https://user@reclamos.example/nodal', 'javascript:alert(1)',
    'not a url', '//reclamos.example/nodal', 'ftp://reclamos.example/nodal', 'data:text/html,hi']) {
    const config = publicBillingConfig({ ...OPEN, MEMBERSHIP_COMPLAINTS_URL: url }, BEFORE);
    assert.equal(config.state, 'open', url);assert.deepEqual(config.contact, { email: CONTACT_VIEW.email, complaintsUrl: null }, url);
  }
  assert.equal(warnings.filter((w) => w.includes('MEMBERSHIP_CONTACT_EMAIL')).length, 10);
  assert.equal(warnings.filter((w) => w.includes('MEMBERSHIP_COMPLAINTS_URL')).length, 8);
  assert.ok(warnings.every((w) => !w.includes('user:pass') && !w.includes('alert')), 'the value itself is never logged');
  const logged = warnings.length;
  publicBillingConfig({ ...OPEN, MEMBERSHIP_CONTACT_EMAIL: 'not-an-email', MEMBERSHIP_COMPLAINTS_URL: 'not a url' }, BEFORE);
  assert.equal(warnings.length, logged, 'once per value and instance');
  // Surrounding spaces are not a mistake.
  assert.deepEqual(publicBillingConfig({ ...OPEN, MEMBERSHIP_CONTACT_EMAIL: ' membresias@nodal.example ', MEMBERSHIP_COMPLAINTS_URL: ' https://reclamos.example/nodal ' }, BEFORE).contact, CONTACT_VIEW);
  assert.equal(publicBillingConfig({ ...OPEN, MEMBERSHIP_COMPLAINTS_URL: 'https://Reclamos.example/libro?id=7' }, BEFORE).contact.complaintsUrl, 'https://reclamos.example/libro?id=7');
});

test('an acceptance needs a signed-in, same-origin request with exactly true flags for a known, offered option of the current terms', async (t) => {
  const { db, base, member } = await boot(t);
  const { cookie } = member();
  assert.equal((await accept(base, null, valid())).status, 401);
  assert.equal((await accept(base, cookie, valid(), { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await accept(base, cookie, valid(), { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const invalid = [
    { ...valid(), option: 'yearly' }, { ...valid(), option: 'toString' }, { ...valid(), option: '__proto__' }, { ...valid(), option: ['once'] }, { version: VERSION, accept: valid().accept },
    { ...valid(), accept: undefined }, { ...valid(), accept: null }, { ...valid(), accept: [true, true, true] }, { ...valid(), accept: true },
    { ...valid(), accept: { terms: 'true', payment: true, renewal: true } }, { ...valid(), accept: { terms: true, payment: 1, renewal: true } },
    { ...valid(), accept: { terms: true, payment: true, renewal: false } }, { ...valid(), accept: { terms: true, payment: true } },
  ];
  for (const body of invalid) {
    const res = await accept(base, cookie, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(await res.json(), { code: 'acceptance_invalid' });
  }
  for (const version of ['FUNDADORES-2027-v0', 'fundadores-2027-v1', '', undefined, 1]) {
    const res = await accept(base, cookie, { ...valid(), version });
    assert.equal(res.status, 409, String(version));
    assert.deepEqual(await res.json(), { code: 'terms_changed', version: VERSION });
  }
  assert.deepEqual(rows(db), [], 'a refusal stores nothing');
});

test('an acceptance is refused with 410 from endsAt on and with 503 while its option or the contact is missing', async (t) => {
  const ended = await boot(t, { now: () => ENDS });
  const res = await accept(ended.base, ended.member().cookie, valid());
  assert.equal(res.status, 410);
  assert.deepEqual(await res.json(), { code: 'offer_ended' });
  const onlyOnce = await boot(t, { billingEnv: { MERCADOPAGO_LINK_ANNUAL: ONCE, ...CONTACT } });
  const cookie = onlyOnce.member().cookie;
  const unavailable = await accept(onlyOnce.base, cookie, valid('installments'));
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { code: 'membership_unavailable' });
  assert.equal((await accept(onlyOnce.base, cookie, valid('once'))).status, 201);
  // Without the contact email nothing is sold; without the complaints book alone it is (the user's decision, 21 Oct 2026).
  const noContact = await boot(t, { billingEnv: { MERCADOPAGO_LINK_ANNUAL: ONCE, MERCADOPAGO_LINK_INSTALLMENTS: TWICE, MEMBERSHIP_COMPLAINTS_URL: CONTACT.MEMBERSHIP_COMPLAINTS_URL } });
  const missing = await accept(noContact.base, noContact.member().cookie, valid('once'));
  assert.equal(missing.status, 503);
  assert.deepEqual(await missing.json(), { code: 'membership_unavailable' });
  assert.deepEqual([rows(ended.db), rows(noContact.db)], [[], []]);
  const noBook = await boot(t, { billingEnv: { MERCADOPAGO_LINK_ANNUAL: ONCE, MERCADOPAGO_LINK_INSTALLMENTS: TWICE, MEMBERSHIP_CONTACT_EMAIL: CONTACT.MEMBERSHIP_CONTACT_EMAIL } });
  assert.equal((await accept(noBook.base, noBook.member().cookie, valid('once'))).status, 201);
  // Before the terms take effect nothing can be accepted under them.
  let at = STARTS - 1;
  const early = await boot(t, { now: () => at });
  const earlyCookie = early.member().cookie;
  const tooEarly = await accept(early.base, earlyCookie, valid('once'));
  assert.equal(tooEarly.status, 503);
  assert.deepEqual(await tooEarly.json(), { code: 'membership_unavailable' });
  assert.deepEqual(rows(early.db), []);
  at = STARTS;
  assert.equal((await accept(early.base, earlyCookie, valid('once'))).status, 201);
});

test('acceptances spend the write budget profile saves use, so a loop answers 429', async (t) => {
  const { base, member } = await boot(t);
  const { cookie } = member();
  let limited = null;
  for (let i = 0; i < 400 && !limited; i += 1) {
    const res = await accept(base, cookie, { option: 'nope' });
    if (res.status === 429) limited = res;
    else assert.equal(res.status, 400);
  }
  assert.ok(limited, 'rate limited');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
});

test('a member records at most 10 acceptances an hour, so a loop cannot flood the acceptances CSV', async (t) => {
  const { db, base, member } = await boot(t);
  const ana = member('Ana Fundadora', 'ana@example.test'), beatriz = member('Beatriz', 'beatriz@example.test');
  // Refusals store nothing and spend none of it.
  for (let i = 0; i < 5; i += 1) assert.equal((await accept(base, ana.cookie, { ...valid(), version: 'FUNDADORES-2027-v0' })).status, 409);
  for (let i = 0; i < 10; i += 1) assert.equal((await accept(base, ana.cookie, valid(i % 2 ? 'installments' : 'once'))).status, 201, `acceptance ${i + 1}`);
  const limited = await accept(base, ana.cookie, valid('once'));
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { error: 'too many requests' });
  const retryAfter = Number(limited.headers.get('retry-after'));
  assert.ok(retryAfter > 3500 && retryAfter <= 3600, `about an hour, not a minute: ${retryAfter}`);
  assert.equal(rows(db).length, 10, 'the eleventh is not stored');
  assert.equal((await accept(base, beatriz.cookie, valid('once'))).status, 201, 'per member');
});

test('an acceptance stores who accepted what and when, and answers the Mercado Pago link of that option', async (t) => {
  let at = BEFORE;
  const { db, base, member } = await boot(t, { now: () => at });
  const { user, cookie } = member('Ana Fundadora', 'ana@example.test');
  const first = await accept(base, cookie, { ...valid('once'), accept: { terms: true, payment: true, renewal: true, extra: 'ignored' } });
  assert.equal(first.status, 201);
  const once = await first.json();
  assert.equal(once.url, ONCE);
  assert.match(once.acceptance.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.deepEqual(once.acceptance, { id: once.acceptance.id, option: 'once', version: VERSION, acceptedAt: '2026-10-21T15:00:00.000Z' });
  at += 60000;
  const second = await accept(base, cookie, valid('installments'));
  assert.equal(second.status, 201);
  const twice = await second.json();
  assert.equal(twice.url, TWICE);
  assert.equal(twice.acceptance.option, 'installments');
  const authorizations = JSON.stringify({ terms: true, payment: true, renewal: true });
  assert.deepEqual(rows(db), [
    { id: once.acceptance.id, user_id: user.id, email: 'ana@example.test', full_name: 'Ana Fundadora', option: 'once', terms_version: VERSION, amount_text: 'S/ 499', authorizations, accepted_at: '2026-10-21T15:00:00.000Z' },
    { id: twice.acceptance.id, user_id: user.id, email: 'ana@example.test', full_name: 'Ana Fundadora', option: 'installments', terms_version: VERSION, amount_text: '2 × S/ 275 (S/ 550)', authorizations, accepted_at: '2026-10-21T15:01:00.000Z' },
  ]);
});

test('a storage failure is answered 503 and reported; a deliberate refusal is not reported', async (t) => {
  const reports = [];
  const errorReport = { enabled: true, report: async (error, context) => { reports.push({ message: error.message, ...context }); return true; } };
  const db = createDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  const repository = { ...createRepository({ db }), recordMembershipAcceptance: async () => { throw Object.assign(new Error('membership insert failed'), { status: 503, expose: false }); } };
  const server = createProductionApp({ db, repository, billingEnv: { MERCADOPAGO_LINK_ANNUAL: ONCE, ...CONTACT }, now: () => BEFORE, pilotMode: false, errorReport, citySearch: { search: async () => ({ cities: [] }) } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const user = createUser(db, { fullName: 'Ana', email: 'ana@example.test', passwordHash: 'unused' });
  const cookie = createSession(db, user.id).cookie.split(';')[0];
  assert.equal((await accept(base, cookie, valid('installments'))).status, 503, 'not offered');
  assert.deepEqual(reports, [], 'a closed option is not an error');
  const failed = await accept(base, cookie, valid('once'));
  assert.equal(failed.status, 503);
  const body = await failed.json();
  assert.deepEqual(body, { code: 'membership_unavailable' });
  assert.ok(!('url' in body), 'no link without a record');
  assert.deepEqual(reports, [{ message: 'membership insert failed', method: 'POST', route: '/api/membership/acceptances', status: 503 }]);
  // A failed insert gives its unit of the hourly budget back: the member is asked to try again.
  for (let i = 0; i < 10; i += 1) assert.equal((await accept(base, cookie, valid('once'))).status, 503, `retry ${i + 1}`);
});

test('the acceptances CSV is for platform admins, newest first, with Lima time beside UTC and formulas neutralised', async (t) => {
  let at = BEFORE;
  const { base, member } = await boot(t, { now: () => at });
  const admin = member('Admin Persona', 'admin@example.test', 'admin');
  const plain = member('Beatriz', 'beatriz@example.test');
  const hostile = member('=HYPERLINK("https://evil.example","x")', 'hostile@example.test');
  const late = member('Carla', 'carla@example.test');
  assert.equal((await accept(base, hostile.cookie, valid('once'))).status, 201);
  at += 60000;
  assert.equal((await accept(base, plain.cookie, valid('installments'))).status, 201);
  // 21:10 on 31 Dec 2026 in Lima is already 1 Jan 2027 in UTC: Mercado Pago shows the Lima date.
  at = Date.parse('2027-01-01T02:10:00.000Z');
  assert.equal((await accept(base, late.cookie, valid('once'))).status, 201);
  const csvUrl = `${base}/api/admin/membership/acceptances`;
  assert.equal((await fetch(csvUrl)).status, 401);
  assert.equal((await fetch(csvUrl, { headers: { Cookie: plain.cookie } })).status, 403);
  const res = await fetch(csvUrl, { headers: { Cookie: admin.cookie } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="membresia-fundador-acceptances\.csv"$/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'a byte order mark, so Excel reads it as UTF-8');
  assert.deepEqual(bytes.subarray(3).toString('utf8').split('\r\n'), [
    '"accepted_at","accepted_at_lima","full_name","email","option","amount","terms_version"',
    `"2027-01-01T02:10:00.000Z","2026-12-31 21:10","Carla","carla@example.test","once","S/ 499","${VERSION}"`,
    `"2026-10-21T15:01:00.000Z","2026-10-21 10:01","Beatriz","beatriz@example.test","installments","2 × S/ 275 (S/ 550)","${VERSION}"`,
    `"2026-10-21T15:00:00.000Z","2026-10-21 10:00","'=HYPERLINK(""https://evil.example"",""x"")","hostile@example.test","once","S/ 499","${VERSION}"`,
  ]);
  assert.equal((await fetch(csvUrl, { method: 'POST', headers: { Cookie: admin.cookie, Origin: base } })).status, 404, 'read only');
});

test('a member\'s export includes their acceptances, and deleting the account keeps each record without its user id', async (t) => {
  const { db, base, member } = await boot(t);
  const ana = member('Ana Fundadora', 'ana@example.test');
  const other = member('Otra', 'otra@example.test');
  const { acceptance } = await (await accept(base, ana.cookie, valid('installments'))).json();
  assert.equal((await accept(base, other.cookie, valid('once'))).status, 201);
  const { data } = await (await fetch(`${base}/api/me/export`, { headers: { Cookie: ana.cookie } })).json();
  assert.deepEqual(data.membershipAcceptances, [{
    id: acceptance.id, option: 'installments', termsVersion: VERSION, amountText: '2 × S/ 275 (S/ 550)',
    authorizations: { terms: true, payment: true, renewal: true }, email: 'ana@example.test', fullName: 'Ana Fundadora', acceptedAt: '2026-10-21T15:00:00.000Z',
  }]);
  const deleted = await fetch(`${base}/api/me`, { method: 'DELETE', headers: { Cookie: ana.cookie, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmEmail: 'ana@example.test' }) });
  assert.equal(deleted.status, 200);
  const kept = db.prepare('SELECT user_id, email, full_name, option FROM membership_acceptances WHERE id = ?').get(acceptance.id);
  assert.deepEqual({ ...kept }, { user_id: null, email: 'ana@example.test', full_name: 'Ana Fundadora', option: 'installments' }, 'contract evidence outlives the account');
  assert.equal(deleteUserById(db, other.user.id), true);
  assert.deepEqual(rows(db).map((row) => [row.user_id, row.email]), [[null, 'ana@example.test'], [null, 'otra@example.test']]);
});

test('the course pilot keeps the payments page closed only while the membership is "soon"', async (t) => {
  const billingEnv = {};
  let at = BEFORE;
  const { base, member } = await boot(t, { billingEnv, now: () => at, pilotMode: true });
  const { cookie } = member();
  const page = () => fetch(`${base}/payments.html`, { redirect: 'manual', headers: { Cookie: cookie } });
  assert.equal((await page()).headers.get('location'), '/courses.html', 'nothing configured');
  Object.assign(billingEnv, { MERCADOPAGO_LINK_ANNUAL: ONCE, MERCADOPAGO_LINK_INSTALLMENTS: TWICE });
  assert.equal((await page()).headers.get('location'), '/courses.html', 'links without a contact');
  Object.assign(billingEnv, CONTACT);
  assert.equal((await page()).status, 200, 'open');
  at = STARTS - 1;
  assert.equal((await page()).headers.get('location'), '/courses.html', 'everything set, before the terms take effect');
  at = ENDS;
  assert.equal((await page()).status, 200, 'ended: the page says the offer closed');
  for (const key of Object.keys(billingEnv)) delete billingEnv[key];
  assert.equal((await page()).status, 200, 'ended with nothing configured');
  const outside = await boot(t, { billingEnv: {}, pilotMode: false });
  assert.equal((await fetch(`${outside.base}/payments.html`, { redirect: 'manual', headers: { Cookie: outside.member().cookie } })).status, 200, 'outside the pilot the page is never redirected');
});

test('the public Fundadores terms page, its script and its style are served like the privacy policy', async (t) => {
  assert.equal(staticSourcePath('/terminos-fundadores.html'), path.join(ROOT, 'web', 'pages', 'terminos-fundadores.html'));
  assert.equal(staticSourcePath('/membership-terms.js'), path.join(ROOT, 'web', 'scripts', 'membership-terms.js'));
  assert.equal(staticSourcePath('/terms.css'), path.join(ROOT, 'web', 'styles', 'terms.css'));
  const { base } = await boot(t);
  const res = await fetch(`${base}/terminos-fundadores.html`, { redirect: 'manual' });
  assert.notEqual(res.status, 302, 'signed out, it is never sent to sign-in');
  assert.equal(res.headers.get('location'), null);
});

const SUPABASE_ENV = { NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-public-key', SUPABASE_SECRET_KEY: 'test-server-key' };
const USER_ID = '00000000-0000-0000-0000-000000000001';
const ROW = {
  id: '11111111-1111-4111-8111-111111111111', user_id: USER_ID, email: 'ana@example.test', full_name: 'Ana Fundadora', option: 'once',
  terms_version: VERSION, amount_text: 'S/ 499', authorizations: { terms: true, payment: true, renewal: true }, accepted_at: '2026-10-21T15:00:00+00:00',
};
const RECORD = {
  id: ROW.id, userId: USER_ID, email: 'ana@example.test', fullName: 'Ana Fundadora', option: 'once', termsVersion: VERSION,
  amountText: 'S/ 499', authorizations: { terms: true, payment: true, renewal: true }, acceptedAt: '2026-10-21T15:00:00.000Z',
};
function supabaseFake(acceptanceRows = [ROW]) {
  const calls = [];
  const fetchImpl = async (raw, options = {}) => {
    const url = new URL(raw), method = options.method || 'GET';
    calls.push({ url, method, headers: options.headers, body: options.body ? JSON.parse(options.body) : undefined });
    if (url.pathname === '/rest/v1/membership_acceptances' && method === 'POST') return new Response(null, { status: 201 });
    if (url.pathname === '/rest/v1/membership_acceptances') {
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 1000);
      const page = acceptanceRows.slice(offset, offset + Math.min(limit, 2));
      return new Response(JSON.stringify(page), { headers: { 'Content-Type': 'application/json', 'Content-Range': page.length ? `${offset}-${offset + page.length - 1}/*` : '*/*' } });
    }
    if (url.pathname === '/rest/v1/profiles') return Response.json([{ id: USER_ID, full_name: 'Ana Fundadora', email: 'ana@example.test' }]);
    if (method === 'GET' && url.pathname.startsWith('/rest/v1/')) return Response.json([]);
    throw new Error(`unexpected Supabase request: ${method} ${url.pathname}`);
  };
  return { calls, repository: createSupabaseRepository({ env: SUPABASE_ENV, fetchImpl }) };
}

test('Supabase stores an acceptance with the service role in one insert and answers the record', async () => {
  const { calls, repository } = supabaseFake();
  assert.deepEqual(await repository.recordMembershipAcceptance(RECORD), RECORD);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url.pathname, '/rest/v1/membership_acceptances');
  assert.equal(calls[0].headers.Prefer, 'return=minimal');
  assert.equal(calls[0].headers.Authorization, 'Bearer test-server-key');
  assert.deepEqual(calls[0].body, [{ ...ROW, accepted_at: '2026-10-21T15:00:00.000Z' }]);
});

test('Supabase lists acceptances newest first, page by page up to the limit, and exports a member\'s own', async () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ ...ROW, id: `${i}1111111-1111-4111-8111-111111111111`, accepted_at: `2026-10-2${5 - i}T15:00:00+00:00` }));
  const { calls, repository } = supabaseFake(many);
  const listed = await repository.listMembershipAcceptances();
  assert.deepEqual(listed.map((row) => row.acceptedAt), ['2026-10-25T15:00:00.000Z', '2026-10-24T15:00:00.000Z', '2026-10-23T15:00:00.000Z', '2026-10-22T15:00:00.000Z', '2026-10-21T15:00:00.000Z']);
  assert.deepEqual(listed[0], { ...RECORD, id: many[0].id, acceptedAt: '2026-10-25T15:00:00.000Z' });
  for (const call of calls) {
    assert.equal(call.url.searchParams.get('order'), 'accepted_at.desc,id.desc');
    assert.ok(Number(call.url.searchParams.get('limit')) <= 500);
  }
  assert.deepEqual((await supabaseFake(many).repository.listMembershipAcceptances({ limit: 3 })).length, 3);
  const exporting = supabaseFake();
  const exported = await exporting.repository.exportUserData(USER_ID);
  assert.deepEqual(exported.membershipAcceptances, [{ id: ROW.id, option: 'once', termsVersion: VERSION, amountText: 'S/ 499', authorizations: RECORD.authorizations, email: 'ana@example.test', fullName: 'Ana Fundadora', acceptedAt: '2026-10-21T15:00:00.000Z' }]);
  const scoped = exporting.calls.filter((call) => call.url.pathname === '/rest/v1/membership_acceptances');
  assert.ok(scoped.length > 0 && scoped.every((call) => call.url.searchParams.get('user_id') === `eq.${USER_ID}`), 'only the member\'s own records');
});

test('the Supabase table is server-only contract evidence that outlives the profile it names', () => {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const name = readdirSync(dir).find((file) => file.endsWith('_membership_acceptances.sql'));
  assert.equal(name, '20261021000000_membership_acceptances.sql');
  const raw = readFileSync(path.join(dir, name), 'utf8');
  assert.match(raw, /npx --no-install supabase db query --linked -f supabase\/migrations\/20261021000000_membership_acceptances\.sql/);
  assert.match(raw, /supabase migration repair --status applied 20261021000000/);
  assert.match(raw, /Never `db push`/);
  // Applied before main is pushed: until then the acceptances, the account export and the admin CSV fail on Supabase.
  assert.match(raw, /BEFORE pushing `main`/);
  for (const route of ['/api/membership/acceptances', '/api/me/export', '/api/admin/membership/acceptances']) assert.ok(raw.includes(route), route);
  const deployment = readFileSync(path.join(ROOT, 'DEPLOYMENT.md'), 'utf8');
  const step = deployment.slice(deployment.indexOf('## Founder Membership acceptances'), deployment.indexOf('## Supabase Setup'));
  assert.match(step, /before pushing `main`/);
  for (const route of ['/api/me/export', '/api/admin/membership/acceptances']) assert.ok(step.includes(route), `DEPLOYMENT.md: ${route}`);
  const statements = raw.replace(/--[^\n]*/g, '').split(';').map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
  assert.equal(statements[0], 'BEGIN');
  assert.equal(statements.at(-1), 'COMMIT');
  const table = statements.find((statement) => /^CREATE TABLE public\.membership_acceptances /i.test(statement));
  assert.ok(table, 'the table');
  assert.match(table, /user_id uuid REFERENCES public\.profiles\(id\) ON DELETE SET NULL/i);
  assert.match(table, /option text NOT NULL CHECK ?\(option IN \('once','installments'\)\)/i);
  for (const column of ['id uuid PRIMARY KEY', 'email text NOT NULL', 'full_name text NOT NULL', 'terms_version text NOT NULL', 'amount_text text NOT NULL', 'authorizations jsonb NOT NULL', 'accepted_at timestamptz NOT NULL']) assert.ok(table.includes(column), column);
  assert.ok(statements.some((statement) => /^CREATE INDEX \w+ ON public\.membership_acceptances ?\(user_id\)$/i.test(statement)), 'user_id index');
  assert.ok(statements.some((statement) => /^CREATE INDEX \w+ ON public\.membership_acceptances ?\(accepted_at DESC\)$/i.test(statement)), 'accepted_at index');
  assert.ok(statements.includes('ALTER TABLE public.membership_acceptances ENABLE ROW LEVEL SECURITY'));
  assert.ok(statements.includes('REVOKE ALL ON TABLE public.membership_acceptances FROM PUBLIC,anon,authenticated,service_role'), 'nothing for the browser roles, and only what follows for the server');
  assert.ok(statements.includes('GRANT SELECT,INSERT ON TABLE public.membership_acceptances TO service_role'));
  assert.ok(!statements.some((statement) => /^CREATE POLICY/i.test(statement)), 'no client policy');
  assert.equal(statements.length, 8, 'nothing else');
});
