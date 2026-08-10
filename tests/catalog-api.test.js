import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/server.js';
import { createDatabase, createUser } from '../server/db.js';
import { createRepository } from '../server/repository.js';

async function bootCatalogApp(t) {
  const db = createDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  const server = createApp({ db });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return { db, repo: createRepository({ db }), base: `http://127.0.0.1:${server.address().port}` };
}

const cookiePair = (res) => res.headers.get('set-cookie').split(';')[0];

async function signup(base, email = 'member@example.test') {
  const response = await fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fullName: 'Catalog Member', email, password: 'correct-horse' }),
  });
  assert.equal(response.status, 201);
  return { user: (await response.clone().json()).user, cookie: cookiePair(response) };
}

function completeItem(overrides = {}) {
  return {
    kind: 'opportunity', subtype: 'job', status: 'published', visibility: 'public',
    translations: {
      en: { title: 'English role', summary: 'English summary', body: 'English body', cta: 'Apply' },
      es: { title: 'Puesto español', summary: 'Resumen español', body: 'Cuerpo español', cta: 'Aplicar' },
      pt: { title: 'Vaga portuguesa', summary: 'Resumo português', body: 'Corpo português', cta: 'Participar' },
    },
    organization: 'NODAL', location: 'São Paulo', topics: ['Mobility', 'Climate'],
    startsAt: '2031-01-02T00:00:00.000Z', deadlineAt: '2030-12-31T00:00:00.000Z', endDate: null,
    sourceLabel: 'NODAL official source',
    sourceUrl: 'https://example.test/source', sourceVerifiedAt: '2030-01-01T00:00:00.000Z',
    actionMode: 'external', actionUrl: 'https://example.test/apply', featured: false,
    ...overrides,
  };
}

test('GET /api/catalog validates query values and filters localized visible records', async (t) => {
  // A missing HTTP query parser or an authorization-before-localization regression must fail this test.
  const { db, repo, base } = await bootCatalogApp(t);
  const admin = createUser(db, { fullName: 'Catalog Admin', email: 'admin@example.test', passwordHash: 'hash', role: 'admin' });
  const publicItem = await repo.createCatalogItem(completeItem({ featured: true }), admin.id);
  const membersItem = await repo.createCatalogItem(completeItem({ visibility: 'members', location: 'Bogotá', topics: ['Water'] }), admin.id);
  const expiredItem = await repo.createCatalogItem(completeItem({ deadlineAt: '2000-01-01T00:00:00.000Z', location: 'Lima' }), admin.id);

  for (const suffix of ['?kind=unknown', '?state=soon', '?limit=0', '?limit=25', '?featured=yes', '?cursor=not-a-cursor', '?unknown=value', '?lang=', '?state=']) {
    assert.equal((await fetch(`${base}/api/catalog${suffix}`)).status, 400, suffix);
  }

  const listed = await fetch(`${base}/api/catalog?lang=es&kind=opportunity,resource&subtype=job&topic=Mobility&location=s%C3%A3o&q=espa%C3%B1ol&featured=true&state=all&limit=24`);
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=60');
  const etag = listed.headers.get('etag');
  assert.ok(etag);
  const payload = await listed.json();
  assert.equal(payload.items.length, 1);
  assert.deepEqual(payload.items[0], {
    id: publicItem.id, kind: 'opportunity', subtype: 'job', title: 'Puesto español', summary: 'Resumen español', body: 'Cuerpo español', cta: 'Aplicar',
    organization: 'NODAL', location: 'São Paulo', topics: ['Mobility', 'Climate'], startsAt: '2031-01-02T00:00:00.000Z', deadlineAt: '2030-12-31T00:00:00.000Z', endDate: null,
    sourceLabel: 'NODAL official source', sourceUrl: 'https://example.test/source', sourceVerifiedAt: '2030-01-01T00:00:00.000Z', actionMode: 'external', actionUrl: 'https://example.test/apply', featured: true, isClosed: false,
  });
  assert.equal((await fetch(`${base}/api/catalog?lang=es&kind=opportunity,resource&subtype=job&topic=Mobility&location=s%C3%A3o&q=espa%C3%B1ol&featured=true&state=all&limit=24`, { headers: { 'If-None-Match': etag } })).status, 304);

  const anonymous = await (await fetch(`${base}/api/catalog?state=all`)).json();
  assert.ok(!anonymous.items.some((item) => item.id === membersItem.id));
  assert.ok(anonymous.items.some((item) => item.id === expiredItem.id));
  assert.ok(!((await (await fetch(`${base}/api/catalog`)).json()).items.some((item) => item.id === expiredItem.id)));

  const { cookie } = await signup(base);
  const memberListed = await fetch(`${base}/api/catalog?state=all`, { headers: { Cookie: cookie } });
  assert.equal(memberListed.headers.get('cache-control'), 'no-store');
  assert.ok((await memberListed.json()).items.some((item) => item.id === membersItem.id));
});

test('catalog cache headers partition anonymous reads and treat unresolved cookies as private', async (t) => {
  // Dropping the Vary partition or treating an invalid session cookie as anonymous cacheable must fail this test.
  const { db, repo, base } = await bootCatalogApp(t);
  const admin = createUser(db, { fullName: 'Catalog Admin', email: 'admin@example.test', passwordHash: 'hash', role: 'admin' });
  const item = await repo.createCatalogItem(completeItem(), admin.id);
  const anonymous = await fetch(`${base}/api/catalog`);
  const etag = anonymous.headers.get('etag');
  assert.equal(anonymous.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=60');
  assert.equal(anonymous.headers.get('vary'), 'Cookie');
  const unchanged = await fetch(`${base}/api/catalog`, { headers: { 'If-None-Match': etag } });
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=60');
  assert.equal(unchanged.headers.get('vary'), 'Cookie');
  const staleCookie = await fetch(`${base}/api/catalog`, { headers: { Cookie: 'nodal_session=expired-or-invalid' } });
  assert.equal(staleCookie.headers.get('cache-control'), 'no-store');
  assert.equal(staleCookie.headers.get('etag'), null);
  const staleCookieDetail = await fetch(`${base}/api/catalog/${item.id}`, { headers: { Cookie: 'nodal_session=expired-or-invalid' } });
  assert.equal(staleCookieDetail.headers.get('cache-control'), 'no-store');
  assert.equal(staleCookieDetail.headers.get('etag'), null);
});

test('GET /api/catalog/:id uses stable cursors and never discloses invisible records', async (t) => {
  // An unstable continuation, draft disclosure, or public detail leakage must fail this test.
  const { db, repo, base } = await bootCatalogApp(t);
  const admin = createUser(db, { fullName: 'Catalog Admin', email: 'admin@example.test', passwordHash: 'hash', role: 'admin' });
  const one = await repo.createCatalogItem(completeItem({ featured: true, deadlineAt: '2030-01-02T00:00:00.000Z' }), admin.id);
  const two = await repo.createCatalogItem(completeItem({ deadlineAt: '2030-01-03T00:00:00.000Z' }), admin.id);
  const draft = await repo.createCatalogItem(completeItem({ status: 'draft', translations: { en: { title: 'Draft' } } }), admin.id);
  const memberOnly = await repo.createCatalogItem(completeItem({ visibility: 'members' }), admin.id);

  const first = await (await fetch(`${base}/api/catalog?state=all&limit=1`)).json();
  assert.equal(first.items[0].id, one.id);
  const second = await (await fetch(`${base}/api/catalog?state=all&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`)).json();
  assert.equal(second.items[0].id, two.id);
  assert.notEqual(first.items[0].id, second.items[0].id);
  assert.equal((await fetch(`${base}/api/catalog/${draft.id}`)).status, 404);
  assert.equal((await fetch(`${base}/api/catalog/${memberOnly.id}`)).status, 404);

  const detail = await fetch(`${base}/api/catalog/${one.id}?lang=pt`);
  assert.equal(detail.status, 200);
  const body = await detail.json();
  assert.equal(body.item.title, 'Vaga portuguesa');
  assert.equal(body.item.isClosed, false);
  assert.equal('translations' in body.item, false);
  assert.equal('createdBy' in body.item, false);
});

test('administrator cookies do not widen public catalog list or detail visibility', async (t) => {
  // Passing the administrator role through the public repository boundary
  // exposes editorial records even though only /api/admin/catalog may do so.
  const { db, repo, base } = await bootCatalogApp(t);
  const admin = await signup(base, 'public-boundary-admin@example.test');
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.user.id);
  const published = await repo.createCatalogItem(completeItem({ visibility: 'public' }), admin.user.id);
  const members = await repo.createCatalogItem(completeItem({ visibility: 'members' }), admin.user.id);
  const draft = await repo.createCatalogItem(completeItem({ status: 'draft' }), admin.user.id);
  const archived = await repo.createCatalogItem(completeItem({ status: 'archived' }), admin.user.id);
  const headers = { Cookie: admin.cookie };

  const publicList = await (await fetch(`${base}/api/catalog?state=all`, { headers })).json();
  assert.deepEqual(new Set(publicList.items.map((item) => item.id)), new Set([published.id, members.id]));
  assert.equal((await fetch(`${base}/api/catalog/${published.id}`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/api/catalog/${members.id}`, { headers })).status, 200);
  assert.equal((await fetch(`${base}/api/catalog/${draft.id}`, { headers })).status, 404);
  assert.equal((await fetch(`${base}/api/catalog/${archived.id}`, { headers })).status, 404);

  const editorial = await (await fetch(`${base}/api/admin/catalog?state=all`, { headers })).json();
  assert.ok(editorial.items.some((item) => item.id === draft.id));
  assert.ok(editorial.items.some((item) => item.id === archived.id));
});

test('GET /api/catalog/:id reads the viewer interest directly beyond the first interest page', async (t) => {
  // Replacing the owned-interest lookup with a paged list must not hide an older interest status.
  const { db, repo, base } = await bootCatalogApp(t);
  const admin = createUser(db, { fullName: 'Catalog Admin', email: 'admin@example.test', passwordHash: 'hash', role: 'admin' });
  const target = await repo.createCatalogItem(completeItem({ actionMode: 'interest', actionUrl: '' }), admin.id);
  const member = await signup(base);
  await repo.upsertCatalogInterest(target.id, member.user.id, 'Older interest');
  for (let index = 0; index < 24; index += 1) {
    const item = await repo.createCatalogItem(completeItem({ actionMode: 'interest', actionUrl: '', location: `City ${index}` }), admin.id);
    await repo.upsertCatalogInterest(item.id, member.user.id, `Later interest ${index}`);
  }
  const detail = await (await fetch(`${base}/api/catalog/${target.id}`, { headers: { Cookie: member.cookie } })).json();
  assert.equal(detail.item.interestStatus, 'new');
});

test('catalog interest writes are member-owned, same-origin, idempotent, and historically withdrawn', async (t) => {
  // Removing the interest eligibility guard, account-scoped write limit, or ownership projection must fail this test.
  const { db, repo, base } = await bootCatalogApp(t);
  const admin = createUser(db, { fullName: 'Catalog Admin', email: 'admin@example.test', passwordHash: 'hash', role: 'admin' });
  const interestItem = await repo.createCatalogItem(completeItem({ actionMode: 'interest', actionUrl: '' }), admin.id);
  const externalItem = await repo.createCatalogItem(completeItem({ actionMode: 'external' }), admin.id);
  const noneItem = await repo.createCatalogItem(completeItem({ actionMode: 'none', actionUrl: '' }), admin.id);
  const closedItem = await repo.createCatalogItem(completeItem({ actionMode: 'interest', actionUrl: '', deadlineAt: '2000-01-01T00:00:00.000Z' }), admin.id);
  const member = await signup(base);
  const putInterest = (id, body, headers = {}) => fetch(`${base}/api/catalog/${id}/interest`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: member.cookie, ...headers }, body: JSON.stringify(body),
  });

  assert.equal((await fetch(`${base}/api/catalog/${interestItem.id}/interest`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await putInterest(externalItem.id, { message: 'Please contact me' })).status, 404);
  assert.equal((await putInterest(noneItem.id, { message: 'Please contact me' })).status, 404);
  assert.equal((await putInterest(closedItem.id, { message: 'Please contact me' })).status, 404);
  assert.equal((await putInterest(interestItem.id, { message: 'Please contact me' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await putInterest(interestItem.id, { message: 'x'.repeat(1001) })).status, 400);

  const first = await putInterest(interestItem.id, { message: 'I can contribute mapping research.' });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await first.json(), { interest: { itemId: interestItem.id, status: 'new', message: 'I can contribute mapping research.' } });
  const repeated = await putInterest(interestItem.id, { message: 'I can contribute mapping research.' });
  assert.equal(repeated.status, 200);
  const detail = await (await fetch(`${base}/api/catalog/${interestItem.id}`, { headers: { Cookie: member.cookie } })).json();
  assert.equal(detail.item.interestStatus, 'new');

  const withdrawal = await fetch(`${base}/api/catalog/${interestItem.id}/interest`, { method: 'DELETE', headers: { Cookie: member.cookie } });
  assert.equal(withdrawal.status, 200);
  assert.deepEqual(await withdrawal.json(), { interest: { itemId: interestItem.id, status: 'withdrawn', message: 'I can contribute mapping research.' } });
  assert.equal((await repo.listCatalogInterestsForUser(member.user.id, {})).interests.length, 1);
  const reopened = await putInterest(interestItem.id, { message: 'Updated message' });
  assert.equal(reopened.status, 200);

  const other = await signup(base, 'other@example.test');
  await repo.upsertCatalogInterest(interestItem.id, other.user.id, 'Other member message');
  const mine = await fetch(`${base}/api/me/catalog-interests?lang=pt`, { headers: { Cookie: member.cookie } });
  assert.equal(mine.status, 200);
  assert.equal(mine.headers.get('cache-control'), 'no-store');
  const mineBody = await mine.json();
  assert.equal(mineBody.interests[0].itemId, interestItem.id);
  assert.equal(mineBody.interests[0].status, 'new');
  assert.equal(mineBody.interests[0].message, 'Updated message');
  assert.equal(mineBody.interests[0].item.title, 'Vaga portuguesa');
  assert.equal(mineBody.interests[0].item.status, 'published');
  assert.equal('createdBy' in mineBody.interests[0].item, false);
  assert.equal(mineBody.nextCursor, null);

  for (let i = 0; i < 20; i += 1) await putInterest(interestItem.id, { message: `rate ${i}` });
  const secondCookie = (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'member@example.test', password: 'correct-horse' }) })).headers.get('set-cookie')).split(';')[0];
  const limited = await fetch(`${base}/api/catalog/${interestItem.id}/interest`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: secondCookie }, body: JSON.stringify({ message: 'same account, new session' }) });
  assert.equal(limited.status, 429);
});

test('owned and administrator interest endpoints validate cursors, localize history, and paginate without loss', async (t) => {
  const { db, repo, base } = await bootCatalogApp(t);
  const member = await signup(base);
  const other = await signup(base, 'other@example.test');
  const admin = await signup(base, 'admin@example.test');
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.user.id);
  const created = [];
  for (let index = 0; index < 3; index += 1) {
    const item = await repo.createCatalogItem(completeItem({
      visibility: 'members', actionMode: 'interest', actionUrl: '',
      translations: {
        ...completeItem().translations,
        en: { ...completeItem().translations.en, title: `English ${index}` },
        pt: { ...completeItem().translations.pt, title: `Português ${index}` },
      },
    }), admin.user.id);
    const interest = await repo.upsertCatalogInterest(item.id, member.user.id, `Private ${index}`);
    db.prepare('UPDATE catalog_interests SET updated_at = ? WHERE id = ?').run(`2030-06-0${index + 1}T00:00:00.000Z`, interest.id);
    created.push({ item, interest });
  }
  await repo.updateCatalogItem(created[1].item.id, { ...created[1].item, status: 'archived' }, created[1].item.version, admin.user.id);
  db.prepare('UPDATE catalog_items SET translations_json = ? WHERE id = ?').run(JSON.stringify({
    en: { ...completeItem().translations.en, title: 'English 1' },
  }), created[1].item.id);

  for (const route of ['/api/me/catalog-interests', '/api/admin/interests']) {
    const cookie = route.includes('/admin/') ? admin.cookie : member.cookie;
    assert.equal((await fetch(`${base}${route}?cursor=invalid`, { headers: { Cookie: cookie } })).status, 400);
  }
  for (const suffix of ['?lang=', '?lang=fr', '?lang=pt&unknown=value']) {
    assert.equal((await fetch(`${base}/api/me/catalog-interests${suffix}`, { headers: { Cookie: member.cookie } })).status, 400, suffix);
  }
  const firstResponse = await fetch(`${base}/api/me/catalog-interests?lang=pt&limit=2`, { headers: { Cookie: member.cookie } });
  const first = await firstResponse.json();
  const second = await (await fetch(`${base}/api/me/catalog-interests?lang=pt&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`, { headers: { Cookie: member.cookie } })).json();
  const owned = [...first.interests, ...second.interests];
  assert.deepEqual(owned.map((entry) => entry.itemId), created.map((entry) => entry.item.id).reverse());
  assert.deepEqual(owned.map((entry) => entry.item.title), ['Português 2', 'English 1', 'Português 0']);
  assert.equal(owned[1].item.status, 'archived');
  assert.equal(second.nextCursor, null);
  assert.deepEqual((await (await fetch(`${base}/api/me/catalog-interests?lang=pt`, { headers: { Cookie: other.cookie } })).json()).interests, []);
  assert.equal((await fetch(`${base}/api/me/catalog-interests?lang=pt`)).status, 401);

  const adminFirst = await (await fetch(`${base}/api/admin/interests?status=new&limit=2`, { headers: { Cookie: admin.cookie } })).json();
  const adminSecond = await (await fetch(`${base}/api/admin/interests?status=new&limit=2&cursor=${encodeURIComponent(adminFirst.nextCursor)}`, { headers: { Cookie: admin.cookie } })).json();
  const queue = [...adminFirst.interests, ...adminSecond.interests];
  assert.deepEqual(queue.map((entry) => entry.id), created.map((entry) => entry.interest.id));
  assert.deepEqual(queue[1].item, { itemId: created[1].item.id, title: 'English 1', kind: 'opportunity', organization: 'NODAL' });
  assert.equal(adminSecond.nextCursor, null);
});

test('DELETE interest requires existing owned history but permits withdrawal after catalog eligibility changes', async (t) => {
  // Fabricating a withdrawn result or reusing PUT eligibility for historical withdrawal must fail this test.
  const { db, repo, base } = await bootCatalogApp(t);
  const admin = createUser(db, { fullName: 'Catalog Admin', email: 'admin@example.test', passwordHash: 'hash', role: 'admin' });
  const item = await repo.createCatalogItem(completeItem({ actionMode: 'interest', actionUrl: '' }), admin.id);
  const member = await signup(base);
  const remove = () => fetch(`${base}/api/catalog/${item.id}/interest`, { method: 'DELETE', headers: { Cookie: member.cookie } });
  assert.equal((await remove()).status, 404);
  await repo.upsertCatalogInterest(item.id, member.user.id, 'I am already interested.');
  db.prepare("UPDATE catalog_items SET status = 'archived', action_mode = 'none', deadline_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(item.id);
  const withdrawn = await remove();
  assert.equal(withdrawn.status, 200);
  assert.deepEqual(await withdrawn.json(), { interest: { itemId: item.id, status: 'withdrawn', message: 'I am already interested.' } });
  const firstWithdrawal = await repo.getCatalogInterest(item.id, member.user.id);
  assert.equal((await remove()).status, 200);
  const repeatedWithdrawal = await repo.getCatalogInterest(item.id, member.user.id);
  assert.equal(repeatedWithdrawal.version, firstWithdrawal.version);
  assert.equal(repeatedWithdrawal.updatedAt, firstWithdrawal.updatedAt);
});

test('repeating an identical SQLite interest PUT preserves the active resource version and timestamp', async (t) => {
  // An unconditional upsert update turns transport retries into avoidable optimistic-lock conflicts.
  const { db, repo } = await bootCatalogApp(t);
  const admin = createUser(db, { fullName: 'Catalog Admin', email: 'admin@example.test', passwordHash: 'hash', role: 'admin' });
  const member = createUser(db, { fullName: 'Catalog Member', email: 'member@example.test', passwordHash: 'hash' });
  const item = await repo.createCatalogItem(completeItem({ actionMode: 'interest', actionUrl: '' }), admin.id);
  const first = await repo.upsertCatalogInterest(item.id, member.id, 'Same message');
  const repeated = await repo.upsertCatalogInterest(item.id, member.id, 'Same message');
  assert.equal(repeated.id, first.id);
  assert.equal(repeated.version, first.version);
  assert.equal(repeated.updatedAt, first.updatedAt);
});

test('admin catalog APIs are server-authorized, versioned, and keep the interest queue private', async (t) => {
  // Losing the server role check, publication guard, optimistic conflict response, or queue redaction must fail this test.
  const { db, repo, base } = await bootCatalogApp(t);
  const member = await signup(base);
  const admin = await signup(base, 'admin@example.test');
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.user.id);
  const adminHeaders = { 'Content-Type': 'application/json', Cookie: admin.cookie };

  assert.equal((await fetch(`${base}/admin.html`, { redirect: 'manual' })).status, 302);
  assert.equal((await fetch(`${base}/admin.html`, { headers: { Cookie: member.cookie } })).status, 403);
  const adminPage = await fetch(`${base}/admin.html`, { headers: { Cookie: admin.cookie } });
  assert.equal(adminPage.status, 200);
  assert.match(await adminPage.text(), /Catalog operations/);
  assert.equal((await fetch(`${base}/api/admin/catalog`)).status, 401);
  assert.equal((await fetch(`${base}/api/admin/catalog`, { headers: { Cookie: member.cookie } })).status, 403);

  const rejected = await fetch(`${base}/api/admin/catalog`, { method: 'POST', headers: adminHeaders, body: JSON.stringify({ kind: 'resource', status: 'published' }) });
  assert.equal(rejected.status, 400);
  const unknownOffset = await fetch(`${base}/api/admin/catalog`, {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify(completeItem({ status: 'draft', deadlineAt: '2030-12-31T12:00:00-00:00' })),
  });
  assert.equal(unknownOffset.status, 400);
  const createdResponse = await fetch(`${base}/api/admin/catalog`, { method: 'POST', headers: adminHeaders, body: JSON.stringify(completeItem({ actionMode: 'interest', actionUrl: '', featured: true })) });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).item;
  assert.equal(created.featured, true);
  assert.equal(created.version, 1);
  assert.equal(created.createdBy, admin.user.id);
  assert.equal((await fetch(`${base}/api/admin/catalog/${created.id}`, { method: 'DELETE', headers: { Cookie: admin.cookie } })).status, 404);

  const updatedResponse = await fetch(`${base}/api/admin/catalog/${created.id}`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ ...created, featured: false, version: created.version }) });
  assert.equal(updatedResponse.status, 200);
  const updated = (await updatedResponse.json()).item;
  assert.equal(updated.featured, false);
  const stale = await fetch(`${base}/api/admin/catalog/${created.id}`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ ...created, featured: true, version: created.version }) });
  assert.equal(stale.status, 409);
  const staleBody = await stale.json();
  assert.equal(staleBody.current.id, created.id);
  assert.equal(staleBody.current.version, updated.version);

  const interested = await repo.upsertCatalogInterest(created.id, member.user.id, 'Please contact me privately.');
  const queue = await fetch(`${base}/api/admin/interests`, { headers: { Cookie: admin.cookie } });
  assert.equal(queue.status, 200);
  const queueEntry = (await queue.json()).interests.find((entry) => entry.id === interested.id);
  assert.deepEqual(Object.keys(queueEntry).sort(), ['id', 'item', 'member', 'message', 'status', 'version']);
  assert.deepEqual(queueEntry.member, { name: 'Catalog Member', email: 'member@example.test' });
  assert.deepEqual(queueEntry.item, { itemId: created.id, title: 'English role', kind: 'opportunity', organization: 'NODAL' });
  assert.equal((await fetch(`${base}/api/admin/interests/${interested.id}`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'invalid', version: interested.version }) })).status, 400);
  const reviewed = await fetch(`${base}/api/admin/interests/${interested.id}`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'contacted', version: interested.version }) });
  assert.equal(reviewed.status, 200);
  assert.equal((await reviewed.json()).interest.status, 'contacted');
  const staleInterest = await fetch(`${base}/api/admin/interests/${interested.id}`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'closed', version: interested.version }) });
  assert.equal(staleInterest.status, 409);
  assert.equal((await staleInterest.json()).current.status, 'contacted');

  const archived = await fetch(`${base}/api/admin/catalog/${created.id}`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ ...updated, status: 'archived', version: updated.version }) });
  assert.equal(archived.status, 200);
  const adminList = await (await fetch(`${base}/api/admin/catalog?status=archived`, { headers: { Cookie: admin.cookie } })).json();
  assert.ok(adminList.items.some((item) => item.id === created.id && item.status === 'archived'));
});
