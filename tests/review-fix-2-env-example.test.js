import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
// Lines an operator copies into Vercel Project Settings: every uncommented assignment.
const assignments = template.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  .map((line) => line.split('=')[0]);

test('the Vercel template does not set NODE_ENV or PORT, which would break every install and build', () => {
  // NODE_ENV=production as a project variable reaches `npm ci` (no devDependencies, so no
  // eslint) and the test run; the runtime already sets it for the functions.
  assert.equal(assignments.includes('NODE_ENV'), false);
  assert.equal(assignments.includes('PORT'), false, 'a Vercel function never listens on PORT');
  assert.match(template, /Do not add NODE_ENV or PORT to Vercel/);
  // The values an operator does need are still there.
  for (const name of ['DATA_BACKEND', 'PUBLIC_BASE_URL', 'COOKIE_SECURE', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY']) assert.ok(assignments.includes(name), name);
});
