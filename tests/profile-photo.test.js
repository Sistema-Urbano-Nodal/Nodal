import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import jpeg from 'jpeg-js';
import { createSession } from '../server/auth.js';
import { createDatabase, createUser, updateUserProfile } from '../server/db.js';
import { MAX_PHOTO_BYTES, normalizeProfilePhoto } from '../server/profile-photo.js';
import { createApp } from '../server/server.js';
import { createSupabaseRepository } from '../server/supabase.js';

function portrait(width = 32, height = width) {
  return jpeg.encode({ width, height, data: Buffer.alloc(width * height * 4, 120),
    comments: ['private test metadata'], exifBuffer: Buffer.from('Exif\0\0private') }, 70).data;
}

test('photo storage decodes pixels and strips EXIF and comments from bounded JPEGs', () => {
  const source = portrait();
  const clean = normalizeProfilePhoto(source);
  assert.ok(source.includes(Buffer.from('private')));
  assert.equal(clean.includes(Buffer.from('private')), false);
  const image = jpeg.decode(clean);
  assert.deepEqual([image.width, image.height], [32, 32]);
  assert.throws(() => normalizeProfilePhoto(portrait(32, 16)), { status: 400 });
  assert.throws(() => normalizeProfilePhoto(portrait(513)), { status: 400 });
  assert.throws(() => normalizeProfilePhoto(source.subarray(0, -4)), { status: 400 });
  assert.throws(() => normalizeProfilePhoto(Buffer.from([0xff,0xd8,0xff,0xd9])), { status: 400 });
});

test('owner photo upload, search, display, replacement, export and removal respect current directory visibility', async t => {
  const db = createDatabase({filename: ':memory:'});
  const server = createApp({db});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  function account(name) {
    const user = createUser(db, { fullName: name, email: name + '@example.test', passwordHash: 'unused' });
    return { ...user, cookie: createSession(db, user.id).cookie.split(';')[0] };
  }
  const owner = account('Ana'), peer = account('Bia');
  const call = (path, user, method = 'GET', body, mime = 'image/jpeg', origin = base) => fetch(base + path, {
    method, body, headers: { Cookie: user?.cookie || '', Origin: origin, 'Content-Type': mime },
  });
  const ownPath = '/api/me/photo', card = '/api/users/' + owner.id, photo = card + '/photo';
  const bytes = portrait();
  assert.equal((await call(ownPath, null, 'PUT', bytes)).status, 401);
  assert.equal((await call(ownPath, owner, 'PUT', bytes, 'image/jpeg', 'https://elsewhere.test')).status, 403);
  assert.equal((await call(ownPath, owner, 'PUT', bytes, 'image/png')).status, 415);
  assert.equal((await call(ownPath, owner, 'PUT', Buffer.alloc(MAX_PHOTO_BYTES + 1))).status, 413);
  const saved = await call(ownPath, owner, 'PUT', bytes);
  assert.equal(saved.status, 200);
  const { photoUrl } = await saved.json();
  assert.ok(photoUrl.startsWith(photo + '?v='));
  assert.equal((await call(photoUrl, null)).status, 401);
  assert.equal((await call(photoUrl, peer)).status, 404);
  assert.equal((await (await call('/api/auth/me', owner)).json()).user.photoUrl, photoUrl);
  assert.equal((await (await call('/api/me', owner, 'PATCH', JSON.stringify({title: 'Planner'}), 'application/json')).json()).user.photoUrl, photoUrl);
  updateUserProfile(db, owner.id, {partC: {consent: true}});
  assert.equal((await (await call(card, peer)).json()).user.photoUrl, photoUrl);
  assert.equal((await (await call('/api/users?limit=6', peer)).json()).users.find(u => u.id === owner.id).photoUrl, photoUrl);
  const search = await call('/api/users/search', peer, 'POST', JSON.stringify({q: 'Ana'}), 'application/json');
  assert.equal((await search.json()).users[0].photoUrl, photoUrl);
  const shown = await call(photoUrl, peer);
  assert.equal(shown.status, 200);
  assert.equal(shown.headers.get('content-type'), 'image/jpeg');
  assert.match(shown.headers.get('cache-control'), /no-store/);
  assert.equal(shown.headers.get('x-content-type-options'), 'nosniff');
  const content = Buffer.from(await shown.arrayBuffer());
  assert.equal(content.includes(Buffer.from('private')), false);
  const exported = await (await call('/api/me/export', owner)).json();
  assert.equal(exported.data.profilePhoto.data, content.toString('base64'));
  const replacement = await (await call(ownPath, owner, 'PUT', portrait(48))).json();
  assert.notEqual(replacement.photoUrl, photoUrl);
  assert.equal((await call(photoUrl, peer)).status, 404);
  assert.equal((await call(replacement.photoUrl, peer)).status, 200);
  updateUserProfile(db, owner.id, {partC: {consent: false}});
  assert.equal((await call(replacement.photoUrl, peer)).status, 404);
  assert.equal((await call(replacement.photoUrl, owner)).status, 200);
  assert.deepEqual(await (await call(ownPath, owner, 'DELETE')).json(), {photoUrl: null});
  assert.equal((await call(photo, owner)).status, 404);
  assert.equal((await (await call('/api/auth/me', owner)).json()).user.photoUrl, undefined);
  assert.equal((await call(ownPath, owner, 'PUT', bytes)).status, 200);
  db.prepare('DELETE FROM users WHERE id=?').run(owner.id);
  assert.equal(db.prepare('SELECT count(*) n FROM member_profile_photos').get().n, 0);
});

test('hosted adapter round-trips binary photo data through the service RPCs', async () => {
  const requests = [], bytes = portrait();
  const repo = createSupabaseRepository({
    env: { NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.test', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public', SUPABASE_SECRET_KEY: 'secret' },
    fetchImpl: async (url, options) => {
      requests.push({ path: new URL(url).pathname, data: JSON.parse(options.body) });
      return Response.json(url.endsWith('read_member_profile_photo') ? bytes.toString('base64') : true);
    },
  });
  assert.equal(await repo.setProfilePhoto('ana', 'revision', bytes), true);
  assert.deepEqual(requests.at(-1), {path:'/rest/v1/rpc/set_member_profile_photo',
    data:{p_actor:'ana',p_revision:'revision',p_jpeg:'\\x'+bytes.toString('hex')}});
  assert.deepEqual(await repo.readProfilePhoto('bia', 'ana', 'revision'), bytes);
  assert.deepEqual(requests.at(-1).data, {p_actor:'bia',p_member:'ana',p_revision:'revision'});
  await repo.setProfilePhoto('ana', null, null);
  assert.deepEqual(requests.at(-1).data, {p_actor:'ana',p_revision:null,p_jpeg:null});
});
