import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase } from '../server/db.js';
import { createFiiuStore } from '../server/fiiu-repository.js';
import { createCourseStore } from '../server/courses-repository.js';
import { createVisitStore } from '../server/visits-repository.js';
import { createMetricsStore } from '../server/metrics-repository.js';

const execute = promisify(execFile);
test('development seeding refuses production before opening or creating a database', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nodal-seed-safety-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(execute(process.execPath, ['scripts/seed-dev.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, NODE_ENV: 'production', DATABASE_PATH: path.join(directory, 'must-not-exist.sqlite'), SEED_ADMIN_PASSWORD: '' },
  }), error => error.code === 1 && /development only/i.test(error.stderr));
  assert.deepEqual(await readdir(directory), [], 'refusal must precede all database side effects');
});

test('the dev seed gives every block of the admin home something to show', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nodal-seed-home-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'seed.sqlite');
  // Both runs seed from the same instant, never the real clock: a run either side of midnight adds no visit day.
  const run = () => execute(process.execPath, ['scripts/seed-dev.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, NODE_ENV: 'development', DATABASE_PATH: file, SEED_ADMIN_PASSWORD: 'seed-test-password-1', SEED_ADMIN_EMAIL: 'admin@nodal.local', SEED_NOW: '2026-11-14T15:00:00.000Z' },
  });
  const count = db => Object.fromEntries(['users', 'fiiu_registrations', 'fiiu_attendance', 'pilot_courses', 'course_enrollments', 'course_events', 'membership_acceptances', 'visit_counts']
    .map(name => [name, db.prepare(`SELECT count(*) AS n FROM ${name}`).get().n]));
  await run();
  const db = createDatabase({ filename: file });
  t.after(() => db.close());
  const before = count(db);
  // Never the real clock: the seed's last visit day is its "today".
  const today = db.prepare('SELECT max(day) AS day FROM visit_counts').get().day;
  assert.equal(today, '2026-11-14');
  createFiiuStore({ db }); createCourseStore({ db });
  const members = await createMetricsStore({ db }).memberDays(today);
  assert.ok(members.days.registrations.length > 0);
  assert.ok(members.days.acceptances.length > 0);
  assert.ok(members.days.founders.length > 0);
  assert.ok(members.now.bio > 0);
  assert.ok(members.now.learners > 0);
  assert.ok(members.active.d30.members > 0);
  assert.ok((await createMetricsStore({ db }).accountDays()).days.length >= 3);
  assert.ok((await createVisitStore({ db }).totals(today, today)).days.length >= 5);
  const countries = db.prepare("SELECT json_extract(answers,'$.country') AS c,count(*) AS n FROM fiiu_registrations GROUP BY 1").all();
  assert.ok(countries.length >= 5 && countries.some(r => r.n < 3));
  assert.ok(db.prepare("SELECT count(*) AS n FROM fiiu_attendance WHERE method='qr'").get().n > 0);
  assert.ok(db.prepare('SELECT count(*) AS n FROM course_enrollments WHERE user_id IN (SELECT id FROM users WHERE role=\'admin\')').get().n > 0);
  await run();
  assert.deepEqual(count(db), before, 'a second run adds nothing');
  await assert.rejects(execute(process.execPath, ['scripts/seed-dev.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, NODE_ENV: 'production', DATABASE_PATH: file, SEED_ADMIN_PASSWORD: '' },
  }), error => error.code === 1 && /development only/i.test(error.stderr));
});
