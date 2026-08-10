import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeCatalogCursor,
  encodeCatalogCursor,
  isCatalogItemClosed,
  localizeCatalogItem,
  validateCatalogDraft,
  validateCatalogPublication,
} from '../server/catalog.js';
import { createDatabase, createUser, deleteUserById, exportUserData } from '../server/db.js';
import { createRepository } from '../server/repository.js';

function completeCatalogInput(patch = {}) {
  const input = {
    kind: 'opportunity',
    subtype: 'job',
    status: 'published',
    visibility: 'public',
    translations: {
      en: { title: 'Urban mobility lead', summary: 'Lead a safe-streets program.', body: 'Work with city partners.', cta: 'Apply now' },
      es: { title: 'Lider de movilidad urbana', summary: 'Lidere un programa de calles seguras.', body: 'Trabaje con socios de la ciudad.', cta: 'Postularse' },
      pt: { title: 'Liderança em mobilidade urbana', summary: 'Lidere um programa de ruas seguras.', body: 'Trabalhe com parceiros da cidade.', cta: 'Candidate-se' },
    },
    organization: 'Cities for People',
    location: 'São Paulo, Brazil',
    topics: ['mobility', 'safety'],
    deadlineAt: '2030-05-20T00:00:00.000Z',
    sourceUrl: 'https://cities.example.org/jobs/mobility-lead',
    sourceVerifiedAt: '2030-05-01T00:00:00.000Z',
    actionMode: 'external',
    actionUrl: 'https://cities.example.org/jobs/mobility-lead/apply',
    featured: true,
  };
  return { ...input, ...patch, translations: patch.translations || input.translations };
}

test('a complete trilingual opportunity publishes as one normalized plain-text record', () => {
  const record = validateCatalogPublication(completeCatalogInput());
  assert.equal(record.kind, 'opportunity');
  assert.equal(record.subtype, 'job');
  assert.equal(record.organization, 'Cities for People');
  assert.equal(record.translations.pt.cta, 'Candidate-se');
  assert.deepEqual(record.topics, ['mobility', 'safety']);
});

test('an incomplete draft persists without publication-only fields', () => {
  const draft = validateCatalogDraft({ status: 'draft', kind: 'resource', translations: { en: { title: '  Working title  ' } } });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.kind, 'resource');
  assert.equal(draft.translations.en.title, 'Working title');
  assert.equal(draft.organization, '');
});

test('publication rejects missing locale, organization, verified HTTPS source, type field, and action URL', () => {
  assert.throws(() => validateCatalogPublication(completeCatalogInput({ translations: { en: completeCatalogInput().translations.en, es: completeCatalogInput().translations.es } })), /PT/i);
  assert.throws(() => validateCatalogPublication(completeCatalogInput({ organization: '   ' })), /organization/i);
  assert.throws(() => validateCatalogPublication(completeCatalogInput({ sourceUrl: 'http://cities.example.org/source' })), /HTTPS/);
  assert.throws(() => validateCatalogPublication(completeCatalogInput({ sourceVerifiedAt: '' })), /verified/i);
  assert.throws(() => validateCatalogPublication(completeCatalogInput({ subtype: '' })), /subtype/i);
  assert.throws(() => validateCatalogPublication(completeCatalogInput({ actionMode: 'external', actionUrl: 'http://example.test/apply' })), /HTTPS/);
});

test('catalog field limits and plain text requirements are enforced', () => {
  assert.throws(() => validateCatalogDraft(completeCatalogInput({ translations: { en: { title: 'x'.repeat(121) } } })), /120/);
  assert.throws(() => validateCatalogDraft(completeCatalogInput({ topics: Array.from({ length: 9 }, (_, i) => `topic-${i}`) })), /8/);
  assert.throws(() => validateCatalogDraft(completeCatalogInput({ translations: { en: { title: '<b>Unsafe</b>' } } })), /plain text/i);
});

test('invalid JSON catalog data and cursor values fail closed', () => {
  assert.throws(() => validateCatalogDraft({ translations: '{bad json' }), /translations/i);
  assert.throws(() => decodeCatalogCursor('not-a-cursor'), /cursor/i);
  assert.throws(() => decodeCatalogCursor(Buffer.from('{"featured":true}', 'utf8').toString('base64url')), /cursor/i);
  assert.throws(() => decodeCatalogCursor(Buffer.from(JSON.stringify([1, 'not-a-date', '2030-05-01T00:00:00.000Z', 'item-1']), 'utf8').toString('base64url')), /cursor/i);
  assert.throws(() => decodeCatalogCursor(Buffer.from(JSON.stringify([1, '2030-05-20T00:00:00.000Z', '2030-05-01T00:00:00.000Z', 'item/1']), 'utf8').toString('base64url')), /cursor/i);
  assert.deepEqual(decodeCatalogCursor(encodeCatalogCursor([1, '2030-05-20T00:00:00.000Z', '2030-05-01T00:00:00.000Z', 'item-1'])), [1, '2030-05-20T00:00:00.000Z', '2030-05-01T00:00:00.000Z', 'item-1']);
});

test('localization exposes only the requested visitor fields', () => {
  const localized = localizeCatalogItem({
    id: 'item-1', kind: 'resource', subtype: null, status: 'published', visibility: 'public', organization: 'NODAL',
    translations: { en: { title: 'Guide', summary: 'English summary', body: 'English body', cta: 'Read' }, es: { title: 'Guía', summary: 'Resumen', body: 'Cuerpo', cta: 'Leer' }, pt: { title: 'Guia', summary: 'Resumo', body: 'Corpo', cta: 'Ler' } },
    createdBy: 'admin-1', editorId: 'admin-2', interestCount: 42,
  }, 'es');
  assert.deepEqual(localized, { id: 'item-1', kind: 'resource', subtype: null, title: 'Guía', summary: 'Resumen', body: 'Cuerpo', cta: 'Leer' });
});

test('closure is derived from deadline or end date rather than stored state', () => {
  const now = new Date('2030-06-01T00:00:00.000Z');
  assert.equal(isCatalogItemClosed({ deadlineAt: '2030-05-31T23:59:59.000Z' }, now), true);
  assert.equal(isCatalogItemClosed({ endDate: '2030-05-31' }, now), true);
  assert.equal(isCatalogItemClosed({ deadlineAt: '2030-06-02T00:00:00.000Z', endDate: '2030-05-01' }, now), false);
});

function sqliteCatalogRepo(t) {
  const db = createDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  const repo = createRepository({ db });
  const admin = createUser(db, { fullName: 'Catalog Admin', email: 'admin@example.test', passwordHash: 'hash', role: 'admin' });
  const member = createUser(db, { fullName: 'Catalog Member', email: 'member@example.test', passwordHash: 'hash' });
  return { db, repo, admin, member };
}

test('SQLite forward migration creates catalog tables and versioned item writes reject stale updates', async (t) => {
  const { db, repo, admin } = sqliteCatalogRepo(t);
  assert.equal(db.prepare('SELECT version FROM schema_migrations WHERE version = 6').get().version, 6);
  const created = await repo.createCatalogItem(completeCatalogInput({ actionMode: 'interest', actionUrl: '', deadlineAt: '2030-05-20T00:00:00.000Z' }), admin.id);
  assert.equal(created.version, 1);
  const updated = await repo.updateCatalogItem(created.id, { ...created, featured: false }, 1, admin.id);
  assert.equal(updated.version, 2);
  await assert.rejects(
    repo.updateCatalogItem(created.id, { ...updated, featured: true }, 1, admin.id),
    (err) => err.code === 'CATALOG_VERSION_CONFLICT',
  );
});

test('SQLite rejects values outside the member/admin role invariant', (t) => {
  const { db } = sqliteCatalogRepo(t);
  assert.throws(
    () => createUser(db, { fullName: 'Invalid Role', email: 'invalid-role@example.test', passwordHash: 'hash', role: 'owner' }),
    /CHECK constraint/i,
  );
});

test('SQLite catalog listing is deterministic, paginates without duplicates, and keeps member content private from visitors', async (t) => {
  const { repo, admin, member } = sqliteCatalogRepo(t);
  const common = { actionMode: 'none', actionUrl: '', sourceVerifiedAt: '2030-05-01T00:00:00.000Z' };
  const featured = await repo.createCatalogItem(completeCatalogInput({ ...common, featured: true, deadlineAt: '2030-05-03T00:00:00.000Z' }), admin.id);
  const nearest = await repo.createCatalogItem(completeCatalogInput({ ...common, featured: false, deadlineAt: '2030-05-01T00:00:00.000Z' }), admin.id);
  const farther = await repo.createCatalogItem(completeCatalogInput({ ...common, featured: false, deadlineAt: '2030-05-02T00:00:00.000Z' }), admin.id);
  const membersOnly = await repo.createCatalogItem(completeCatalogInput({ ...common, visibility: 'members', deadlineAt: '2030-05-04T00:00:00.000Z' }), admin.id);
  const first = await repo.listCatalogItems({ limit: 2, state: 'all' }, null);
  assert.deepEqual(first.items.map((item) => item.id), [featured.id, nearest.id]);
  const second = await repo.listCatalogItems({ limit: 2, cursor: first.nextCursor, state: 'all' }, null);
  assert.deepEqual(second.items.map((item) => item.id), [farther.id]);
  assert.deepEqual(new Set([...first.items, ...second.items].map((item) => item.id)).size, 3);
  const memberList = await repo.listCatalogItems({ limit: 10, state: 'all' }, { id: member.id, permission: 'member' });
  assert.ok(memberList.items.some((item) => item.id === membersOnly.id));
  assert.equal(await repo.getCatalogItem(membersOnly.id, null), null);
});

test('SQLite administrator listing honours the requested catalog status', async (t) => {
  const { repo, admin } = sqliteCatalogRepo(t);
  const draft = await repo.createCatalogItem({ kind: 'resource', status: 'draft', translations: { en: { title: 'Draft only' } } }, admin.id);
  const published = await repo.createCatalogItem(completeCatalogInput({ actionMode: 'none', actionUrl: '' }), admin.id);
  const result = await repo.listCatalogItems({ status: 'draft', state: 'all' }, { id: admin.id, permission: 'admin' });
  assert.deepEqual(result.items.map((item) => item.id), [draft.id]);
  assert.notEqual(draft.id, published.id);
});

test('SQLite interests reopen idempotently, withdraw historically, and admin changes are version guarded', async (t) => {
  const { repo, admin, member } = sqliteCatalogRepo(t);
  const item = await repo.createCatalogItem(completeCatalogInput({ actionMode: 'interest', actionUrl: '' }), admin.id);
  await assert.rejects(repo.upsertCatalogInterest(item.id, member.id, '<b>Not plain text</b>'), /plain text/i);
  const first = await repo.upsertCatalogInterest(item.id, member.id, 'I can contribute maps.');
  const repeated = await repo.upsertCatalogInterest(item.id, member.id, 'I can contribute maps.');
  assert.equal(first.id, repeated.id);
  assert.equal(repeated.status, 'new');
  await repo.withdrawCatalogInterest(item.id, member.id);
  assert.equal((await repo.listCatalogInterestsForUser(member.id, {})).interests[0].status, 'withdrawn');
  const reopened = await repo.upsertCatalogInterest(item.id, member.id, 'Updated message');
  assert.equal(reopened.id, first.id);
  assert.equal(reopened.status, 'new');
  const queue = await repo.listAdminInterests({});
  assert.equal(queue.interests[0].message, 'Updated message');
  const changed = await repo.updateCatalogInterest(reopened.id, { status: 'contacted' }, reopened.version, admin.id);
  assert.equal(changed.status, 'contacted');
  await assert.rejects(
    repo.updateCatalogInterest(reopened.id, { status: 'closed' }, reopened.version, admin.id),
    (err) => err.code === 'CATALOG_VERSION_CONFLICT',
  );
});

test('SQLite export includes interests while account deletion cascades interests and preserves item audit history as null', async (t) => {
  const { db, repo, admin, member } = sqliteCatalogRepo(t);
  const item = await repo.createCatalogItem(completeCatalogInput({ actionMode: 'interest', actionUrl: '' }), member.id);
  await repo.upsertCatalogInterest(item.id, member.id, 'Please contact me.');
  const exported = exportUserData(db, member.id);
  assert.equal(exported.catalogInterests.length, 1);
  assert.equal(deleteUserById(db, member.id), true);
  assert.equal(db.prepare('SELECT count(*) AS count FROM catalog_interests WHERE item_id = ?').get(item.id).count, 0);
  const audit = db.prepare('SELECT created_by, updated_by, published_by FROM catalog_items WHERE id = ?').get(item.id);
  assert.equal(audit.created_by, null);
  assert.equal(audit.updated_by, null);
  assert.equal(audit.published_by, null);
  assert.equal(await repo.getCatalogItem(item.id, { id: admin.id, permission: 'admin' }).then((row) => row.id), item.id);
});
