/* A full name has one cap in both data twins, PROFILE_NAME_MAX. The SQLite twin used to keep any length at sign-up and
   cut it to 80 characters at the next profile save, while Supabase (production) keeps 120 everywhere. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, createUser, updateUserProfile } from '../server/db.js';
import { PROFILE_NAME_MAX } from '../server/domain.js';

test('SQLite keeps a full name of up to PROFILE_NAME_MAX characters at sign-up and on every save, as Supabase does', (t) => {
  assert.equal(PROFILE_NAME_MAX, 120, 'production profiles already hold names of up to 120 characters');
  const db = createDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  const user = createUser(db, { fullName: `  ${'m'.repeat(PROFILE_NAME_MAX + 10)}  `, email: 'long-name@example.test', passwordHash: 'test' });
  assert.equal(user.full_name, 'm'.repeat(PROFILE_NAME_MAX));
  // The dashboard sends the name with every profile save, so a long name must survive one unchanged.
  const hundred = 'Ana '.repeat(25).trim();
  assert.equal(updateUserProfile(db, user.id, { fullName: hundred }).full_name, hundred);
  assert.equal(updateUserProfile(db, user.id, { fullName: 'x'.repeat(PROFILE_NAME_MAX + 1) }).full_name, 'x'.repeat(PROFILE_NAME_MAX));
});
