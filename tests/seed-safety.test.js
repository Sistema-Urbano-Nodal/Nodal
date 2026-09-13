import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
