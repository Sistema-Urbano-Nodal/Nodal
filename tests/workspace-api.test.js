import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createSession } from '../server/auth.js';
import { createDatabase, createUser, updateUserProfile } from '../server/db.js';
import { createApp } from '../server/server.js';
import { createHostedWorkspace } from '../server/workspace-api.js';

test('members can find the right namesake, reply, invite a team and work on a private project', async t => {
  const db = createDatabase({ filename: ':memory:' });
  const server = createApp({ db });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const people = ['Lucas', 'Ana', 'Ana', 'Rosa'].map((fullName, i) => {
    const { id } = createUser(db, { fullName, email: `m${i}@example.test`, passwordHash: 'unused', city: ['Lima', 'Cusco', 'Recife', 'Lima'][i] });
    updateUserProfile(db, id, { partC: { consent: true } });
    return { id, cookie: createSession(db, id).cookie.split(';')[0] };
  });
  const [lucas, ana, namesake, rosa] = people;
  const call = (who, path, body, origin = base) => fetch(base + path, {
    method: body ? 'POST' : 'GET', redirect: 'manual',
    headers: { Cookie: who?.cookie ?? '', Origin: origin, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  async function ok(who, path, body) {
    const res = await call(who, path, body);
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    assert.equal(res.headers.get('cache-control'), 'no-store');
    return data;
  }
  const command = (who, op, data) => ok(who, '/api/workspace', { op, ...data });
  const threadPath = id => '/api/workspace?threadId=' + id;
  assert.equal((await call(null, '/messages.html')).status, 302);
  assert.equal((await call(null, '/api/workspace')).status, 401);
  assert.equal((await call(lucas, '/api/workspace', { op: 'export' })).status, 400);
  assert.equal((await call(lucas, '/api/workspace', { op: 'group' }, 'https://elsewhere.example')).status, 403);
  const { users } = await ok(lucas, '/api/users/search', { q: 'Ana' });
  assert.deepEqual(users.map(u => u.city).sort(), ['Cusco', 'Recife']);
  const targetId = users.find(u => u.city === 'Cusco').id;
  const intro = { targetId, body: 'Interested in a street audit?', clientId: randomUUID() };
  const { threadId } = await command(lucas, 'direct', intro);
  assert.deepEqual(await command(lucas, 'direct', intro), { threadId });
  assert.equal((await ok(ana, '/api/workspace')).threads[0].unread, true);
  assert.deepEqual((await ok(namesake, '/api/workspace')).threads, []);
  await command(ana, 'send', { threadId, body: 'Yes, Sunday works.', clientId: randomUUID() });
  const exchange = await ok(lucas, threadPath(threadId));
  assert.deepEqual(exchange.messages.map(m => m.body), [intro.body, 'Yes, Sunday works.']);
  const { threadId: group } = await command(lucas, 'group', { name: 'Street audit', targetIds: [ana.id, rosa.id], clientId: randomUUID() });
  assert.equal((await ok(rosa, '/api/workspace')).invitations[0].id, group);
  assert.equal((await call(rosa, threadPath(group))).status, 404);
  for (const person of [ana, rosa]) await command(person, 'accept', { threadId: group });
  assert.deepEqual((await ok(rosa, threadPath(group))).messages, []);
  assert.equal((await call(rosa, threadPath(threadId))).status, 404);
  const project = await command(ana, 'createProject', { threadId: group, title: 'June audit', goal: 'Document crossings', clientId: randomUUID() });
  await command(lucas, 'step', { ...project, description: 'Map three crossings', assigneeId: rosa.id, clientId: randomUUID() });
  let shared = (await ok(rosa, threadPath(group))).projects[0];
  assert.equal(shared.steps[0].assigneeId, rosa.id);
  await command(rosa, 'toggle', { ...project, stepId: shared.steps[0].id, done: true });
  await command(rosa, 'update', { ...project, body: 'Crossings mapped.', clientId: randomUUID() });
  shared = (await ok(ana, threadPath(group))).projects[0];
  assert.equal(shared.steps[0].done, true);
  assert.equal(shared.updates[0].body, 'Crossings mapped.');
  assert.equal((await call(namesake, '/api/workspace', { ...project, op: 'update', body: 'x', clientId: randomUUID() })).status, 404);
  assert.equal((await call(ana, '/api/workspace', { ...project, op: 'link', link: 'javascript:alert(1)' })).status, 400);
  await command(rosa, 'leave', { threadId: group });
  assert.equal((await call(rosa, threadPath(group))).status, 404);
  const { data: exported } = await ok(ana, '/api/me/export');
  assert.deepEqual(exported.memberWorkspace.messages.map(m => m.body), ['Yes, Sunday works.']);
  assert.equal(exported.memberWorkspace.updates.length, 0);
});

test('the hosted store passes the session actor in a server-side RPC and preserves business refusals', async () => {
  let called;
  const store = createHostedWorkspace({ admin: { rest: async (...args) => {
    called = args;
    return { status: 404, error: 'thread unavailable' };
  } } });
  await assert.rejects(store.execute('actor', 'thread', { threadId: 'room' }), { status: 404 });
  assert.deepEqual(called, ['rpc/member_workspace', { method: 'POST', body: { p_actor: 'actor', p_op: 'thread', p_data: { threadId: 'room' } } }]);
});
