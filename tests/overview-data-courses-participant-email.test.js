/* The teaching page turns a refused participant or invitation address into its own message only through the code table
   in web/scripts/pilot.js (requestError). The server used to answer participant_email, a code missing from that table,
   so the organiser read the generic "Review the fields and try again" instead of "Enter a valid email address". */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { participantEmail } from '../server/course-participants.js';

const pilot = readFileSync(new URL('../web/scripts/pilot.js', import.meta.url), 'utf8');
const pageCodes = Object.fromEntries([...pilot.match(/const codes=\{([^}]*)\}/)[1].matchAll(/([a-z_]+):'([A-Za-z]+)'/g)].map(([, code, key]) => [code, key]));

test('a refused participant email carries the code the teaching page translates as participantEmailError', () => {
  assert.ok(Object.keys(pageCodes).length > 10, 'the page code table was read');
  // maria@gmail passes the browser's type=email check but not the server's, which wants a dot in the domain.
  for (const email of ['maria@gmail', 'bad', '', `${'a'.repeat(260)}@example.test`]) {
    let refusal = null;
    try { participantEmail(email); } catch (error) { refusal = error; }
    assert.equal(refusal?.status, 400, email);
    assert.equal(pageCodes[refusal.code], 'participantEmailError', `${JSON.stringify(email)} is refused with ${refusal.code}`);
  }
  assert.equal(participantEmail(' Maria@Gmail.com '), 'maria@gmail.com');
});
