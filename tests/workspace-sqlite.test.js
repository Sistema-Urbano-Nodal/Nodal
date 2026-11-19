import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { createDatabase, createUser, deleteUserById, updateUserProfile } from '../server/db.js';
import { createSqliteWorkspace } from '../server/workspace-sqlite.js';

function fixture(t, filename = ':memory:') {
  const db = createDatabase({ filename });
  t.after(() => db.close());
  const store = createSqliteWorkspace(db);
  const ids = ['Alice', 'Bob', 'Cam', 'Dee'].map(name => {
    const { id } = createUser(db, { fullName: name, email: `${name}@example.test`, passwordHash: 'x' });
    updateUserProfile(db, id, { partC: { consent: true } });
    return id;
  });
  const [alice, bob, cam, dee] = ids;
  const run = (actor, op, data) => store.execute(actor, op, data);
  const write = (actor, op, data) => run(actor, op, { ...data, clientId: randomUUID() });
  const get = (actor, threadId) => run(actor, 'thread', { threadId });
  const inbox = actor => run(actor, 'inbox');
  return { db, alice, bob, cam, dee, run, write, get, inbox };
}

test('introductions wait for a reply, survive retries and persist unread per participant', t => {
  const { db, alice, bob, cam, run, write, get, inbox } = fixture(t);
  const introduction = { clientId: randomUUID(), targetId: bob, body: 'I enjoyed your workshop.' };
  updateUserProfile(db, alice, { partC: { consent: false } });
  const { threadId } = run(alice, 'direct', introduction);
  assert.equal(run(alice, 'direct', introduction).threadId, threadId);
  assert.throws(() => run(alice, 'direct', { ...introduction, body: 'Changed' }), { status: 409 });
  assert.throws(() => write(alice, 'send', { threadId, body: 'Second introduction' }), { status: 409 });
  assert.throws(() => get(cam, threadId), { status: 404 });
  assert.deepEqual(inbox(bob).threads[0], { id: threadId, kind: 'direct', name: 'Alice',
    status: 'pending', revision: 1, initiatorId: alice, peerId: alice, unread: true,
    lastMessage: { body: introduction.body, authorId: alice, createdAt: get(bob, threadId).messages[0].createdAt, hasAttachments: false } });
  assert.equal(get(bob, threadId).thread.unread, true, 'reading the snapshot leaves the marker intact');
  run(bob, 'read', { threadId, revision: get(bob, threadId).thread.revision });
  assert.equal(inbox(bob).threads[0].unread, false);
  const reply = { clientId: randomUUID(), targetId: alice, body: 'Thank you!' };
  assert.equal(run(bob, 'direct', reply).threadId, threadId);
  assert.equal(run(bob, 'direct', reply).threadId, threadId);
  assert.equal(inbox(alice).threads[0].unread, true);
  assert.equal(get(alice, threadId).thread.status, 'active');
  assert.deepEqual(get(alice, threadId).messages.map(m => [m.authorName, m.body]), [
    ['Alice', introduction.body], ['Bob', reply.body],
  ]);
  updateUserProfile(db, bob, { partC: { consent: false } });
  write(alice, 'send', { threadId, body: 'See you there' });
  assert.throws(() => write(cam, 'direct', { targetId: bob, body: 'New' }), { status: 404 });
  db.prepare("UPDATE users SET account_status='disabled' WHERE id=?").run(bob);
  assert.throws(() => write(alice, 'send', { threadId, body: 'No delivery' }), { status: 403 });
});

test('groups require an invitation and shared groups survive direct blocks', t => {
  const { db, alice, bob, cam, dee, run, write, get, inbox } = fixture(t);
  const direct = write(alice, 'direct', { targetId: bob, body: 'Private note' }).threadId;
  const create = { name: 'Workshop', targetIds: [bob, bob, cam], clientId: randomUUID() };
  const group = run(alice, 'group', create).threadId;
  assert.equal(run(alice, 'group', create).threadId, group);
  assert.deepEqual(inbox(bob).invitations.map(i => ({ ...i })), [{ id: group, name: 'Workshop', inviterName: 'Alice' }]);
  assert.throws(() => get(cam, group), { status: 404 });
  assert.throws(() => write(cam, 'send', { threadId: group, body: 'unjoined' }), { status: 404 });
  run(bob, 'accept', { threadId: group });
  run(cam, 'decline', { threadId: group });
  assert.deepEqual(get(bob, group).members.map(m => [m.name, m.status]), [['Alice', 'active'], ['Bob', 'active']]);
  assert.deepEqual(get(bob, group).messages, []);
  const pending = write(alice, 'group', { name: 'Another room', targetIds: [bob] }).threadId;
  assert.equal(inbox(bob).invitations[0].id, pending);
  run(bob, 'block', { threadId: direct });
  assert.equal(get(alice, direct).thread.status, 'blocked');
  assert.deepEqual(inbox(bob).invitations, []);
  assert.throws(() => write(alice, 'direct', { targetId: bob, body: 'again' }), { status: 403 });
  assert.throws(() => write(alice, 'invite', { threadId: pending, targetId: bob }), { status: 403 });
  write(bob, 'send', { threadId: group, body: 'For the whole group' });
  write(bob, 'invite', { threadId: group, targetId: cam });
  write(bob, 'invite', { threadId: group, targetId: cam });
  assert.equal(inbox(cam).invitations.length, 1);
  updateUserProfile(db, dee, { partC: { consent: false } });
  assert.throws(() => write(bob, 'group', { name: 'Atomic', targetIds: [cam, dee] }), { status: 404 });
  assert.equal(inbox(cam).invitations.length, 1, 'an ineligible later invite rolls the entire group back');
  run(cam, 'accept', { threadId: group });
  assert.deepEqual(get(cam, group).messages.map(m => m.body), ['For the whole group']);
  assert.throws(() => get(cam, direct), { status: 404 });
});

test('replaying an invitation after its recipient declines does not invite them a second time', t => {
  const { alice, bob, cam, dee, run, write, inbox } = fixture(t);
  const { threadId } = write(alice, 'group', { name: 'Workshop', targetIds: [bob] });
  const invitation = { threadId, targetId: cam, clientId: randomUUID() };
  run(alice, 'invite', invitation);
  run(cam, 'decline', { threadId });
  assert.deepEqual(run(alice, 'invite', invitation), { threadId });
  assert.deepEqual(inbox(cam).invitations, []);
  assert.throws(() => run(alice, 'invite', { ...invitation, targetId: dee }), { status: 409 });
  write(alice, 'invite', { threadId, targetId: cam });
  assert.equal(inbox(cam).invitations.length, 1, 'a deliberate new invitation can still be sent');
});

test('a shared project preserves member privacy, clears left assignments, and expires with its group', t => {
  const { alice, bob, cam, dee, run, write, get, inbox } = fixture(t);
  const groupRequest = { name: 'Field notes', targetIds: [bob], clientId: randomUUID() };
  const { threadId } = run(alice, 'group', groupRequest);
  run(bob, 'accept', { threadId });
  const proposal = { threadId, title: 'Bus corridors', goal: 'Compare two routes', clientId: randomUUID() };
  const { projectId } = run(bob, 'createProject', proposal);
  assert.equal(run(bob, 'createProject', proposal).projectId, projectId);
  const project = { threadId, projectId };
  run(alice, 'link', { ...project, link: 'https://example.test/doc' });
  assert.throws(() => write(bob, 'step', { ...project, description: 'Visit', assigneeId: cam }), { status: 400 });
  const newStep = { ...project, assigneeId: bob, description: 'Count riders', clientId: randomUUID() };
  run(alice, 'step', newStep);
  run(alice, 'step', newStep);
  const step = get(bob, threadId).projects[0].steps[0];
  run(bob, 'toggle', { ...project, stepId: step.id, done: true });
  const update = { ...project, body: 'Traffic was light', clientId: randomUUID() };
  run(bob, 'update', update);
  run(bob, 'update', update);
  write(alice, 'update', { ...project, body: 'I counted too' });
  const snapshot = get(bob, threadId).projects[0];
  assert.equal(snapshot.steps.length, 1);
  assert.equal(snapshot.steps[0].done, true);
  assert.deepEqual(snapshot.updates.map(u => u.body), [update.body, 'I counted too']);
  assert.deepEqual(get(bob, threadId).messages, []);
  const exported = run(bob, 'export');
  assert.deepEqual(exported.updates.map(u => u.body), [update.body]);
  assert.equal(exported.projects[0].title, proposal.title);
  assert.deepEqual(exported.steps, []);
  assert.deepEqual(exported.links, []);
  const other = write(cam, 'group', { name: 'Different', targetIds: [dee] }).threadId;
  assert.throws(() => run(cam, 'link', { ...project, threadId: other, link: '' }), { status: 404 });
  write(bob, 'invite', { threadId, targetId: cam });
  run(bob, 'leave', { threadId });
  assert.deepEqual(inbox(cam).invitations, []);
  assert.throws(() => run(bob, 'update', update), { status: 404 });
  assert.throws(() => get(bob, threadId), { status: 404 });
  assert.equal(get(alice, threadId).projects[0].steps[0].assigneeId, null);
  write(alice, 'invite', { threadId, targetId: dee });
  run(alice, 'leave', { threadId });
  assert.equal(inbox(dee).invitations.some(i => i.id === threadId), false);
  assert.throws(() => run(alice, 'group', groupRequest), { status: 404 });
});

test('erasure removes authored private text and preserves the other participants’ work', t => {
  const { db, alice, bob, cam, run, write, get, inbox } = fixture(t);
  const secret = 'DATA-TO-ERASE';
  const dm = write(alice, 'direct', { targetId: bob, body: secret }).threadId;
  write(bob, 'send', { threadId: dm, body: 'My reply' });
  const { threadId } = write(alice, 'group', { name: secret, targetIds: [bob, cam] });
  run(bob, 'accept', { threadId });
  const { projectId } = write(alice, 'createProject', { threadId, title: secret, goal: secret });
  const project = { threadId, projectId };
  run(alice, 'link', { ...project, link: secret });
  write(alice, 'step', { ...project, assigneeId: bob, description: secret });
  write(bob, 'step', { ...project, assigneeId: alice, description: 'Keep step' });
  write(alice, 'update', { ...project, body: secret });
  write(bob, 'update', { ...project, body: 'Keep update' });
  write(alice, 'send', { threadId, body: secret });
  assert.equal(deleteUserById(db, alice), true);
  const surviving = get(bob, threadId);
  assert.equal(JSON.stringify(surviving).includes(secret), false);
  assert.equal(JSON.stringify(surviving).includes(alice), false);
  assert.deepEqual(surviving.projects[0].steps.map(s => [s.description, s.assigneeId]), [['Keep step', null]]);
  assert.deepEqual(surviving.projects[0].updates.map(u => u.body), ['Keep update']);
  assert.deepEqual(inbox(cam).invitations, []);
  const personal = get(bob, dm);
  assert.equal(personal.thread.peerId, null);
  assert.equal(personal.thread.status, 'blocked');
  assert.deepEqual(personal.messages.map(m => m.body), ['My reply']);
  assert.throws(() => write(bob, 'send', { threadId: dm, body: 'New reply' }), { status: 403 });
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('concurrent first sends on independent SQLite connections converge on the same direct exchange', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'nodal-workspace-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'workspace.sqlite');
  const { alice, bob, get } = fixture(t, filename);
  const code = `
    import { parentPort, workerData } from 'node:worker_threads';
    import { DatabaseSync } from 'node:sqlite';
    const { createSqliteWorkspace } = await import(workerData.module);
    const db = new DatabaseSync(workerData.filename);
    db.exec('PRAGMA foreign_keys=ON');
    const store = createSqliteWorkspace(db);
    parentPort.once('message', () => {
      try { parentPort.postMessage(store.execute(workerData.actor, 'direct', workerData.data)); }
      finally { db.close(); }
    });
    parentPort.postMessage('ready');
  `;
  const makeWorker = (actor, targetId) => new Worker(new URL('data:text/javascript,' + encodeURIComponent(code)), {
    workerData: { filename, actor, module: new URL('../server/workspace-sqlite.js', import.meta.url).href,
      data: { targetId, body: 'Hello', clientId: randomUUID() } },
  });
  const workers = [makeWorker(alice, bob), makeWorker(bob, alice)];
  t.after(() => Promise.all(workers.map(worker => worker.terminate())));
  await Promise.all(workers.map(worker => once(worker, 'message')));
  const replies = Promise.all(workers.map(worker => once(worker, 'message')));
  workers.forEach(worker => worker.postMessage('send'));
  const [[one], [two]] = await replies;
  assert.equal(one.threadId, two.threadId);
  const result = get(alice, one.threadId);
  assert.equal(result.thread.status, 'active');
  assert.deepEqual(result.messages.map(m => m.authorId).sort(), [alice, bob].sort());
});

test('chat pages have stable conversation-scoped cursors and an old view cannot clear new activity', t => {
  const { alice, bob, cam, run, write, get, inbox } = fixture(t);
  const { threadId } = write(alice, 'direct', { targetId: bob, body: 'message 1' });
  write(bob, 'send', { threadId, body: 'message 2' });
  for (let n = 3; n <= 51; n += 1) write(alice, 'send', { threadId, body: `message ${n}` });
  const latest = get(bob, threadId);
  assert.equal(latest.moreMessages, true);
  assert.equal(latest.messages.length, 50);
  assert.deepEqual([latest.messages[0].body, latest.messages.at(-1).body], ['message 2', 'message 51']);
  write(alice, 'send', { threadId, body: 'message 52' });
  run(bob, 'read', { threadId, revision: latest.thread.revision });
  assert.equal(inbox(bob).threads[0].unread, true, 'activity committed since the view stays unread');
  const older = run(bob, 'thread', { threadId, beforeMessageId: latest.messages[0].id });
  assert.deepEqual(older.messages.map(m => m.body), ['message 1']);
  assert.equal(older.moreMessages, false);
  const newest = get(bob, threadId);
  assert.ok(newest.thread.revision > latest.thread.revision);
  run(bob, 'read', { threadId, revision: newest.thread.revision });
  assert.equal(inbox(bob).threads[0].unread, false);
  const other = write(alice, 'direct', { targetId: cam, body: 'different conversation' });
  const foreign = get(alice, other.threadId).messages[0];
  assert.throws(() => run(bob, 'thread', { threadId, beforeMessageId: foreign.id }), { status: 404 });
});

test('chat files obey post access, quota, retries, export and cascading deletion', t => {
  const { db, alice, bob, cam, dee, run, write, get, inbox } = fixture(t);
  const file = text => ({name:'notes.txt',mime:'text/plain',size:Buffer.byteLength(text),data:Buffer.from(text).toString('base64')});
  const { threadId } = write(alice, 'group', { name:'Notes', targetIds:[bob,cam] });
  assert.equal(inbox(alice).threads[0].lastMessage, null);
  run(bob, 'accept', {threadId});
  const files = [file('secret bytes'), file('more')];
  const send = {threadId,body:'',attachments:files,clientId:randomUUID()};
  assert.throws(() => write(bob,'sendFiles',{threadId,body:'Caption',attachments:[]}),{status:400});
  run(bob,'sendFiles',send);
  run(bob,'send',send);
  assert.throws(() => run(bob,'send',{...send,attachments:[file('edited')]}),{status:409});
  const [post] = get(alice,threadId).messages;
  assert.equal(post.attachments.length,2);
  const descriptor = post.attachments[0], ref = {attachmentId:descriptor.id};
  assert.deepEqual(Object.keys(descriptor).sort(), ['id','mime','name','size']);
  assert.deepEqual(inbox(alice).threads[0].lastMessage,{body:'',authorId:bob,createdAt:post.createdAt,hasAttachments:true});
  assert.deepEqual(run(alice,'attachment',ref), {...descriptor,data:files[0].data});
  assert.throws(() => run(cam,'attachment',ref),{status:404});
  assert.throws(() => run(dee,'attachment',ref),{status:404});
  assert.throws(() => run(alice,'exportAttachment',ref),{status:404});
  const exported = run(bob,'export').attachments[0];
  assert.equal(exported.downloadUrl,'/api/me/export/attachments/' + descriptor.id);
  assert.equal(exported.messageId,post.id);
  assert.equal(exported.data,undefined);
  assert.deepEqual(run(alice,'export').attachments,[]);
  const used = db.prepare('SELECT bytes FROM workspace_file_usage WHERE author_id=?');
  assert.equal(used.get(bob).bytes,16);
  assert.throws(() => write(bob,'send',{threadId,body:'',attachments:[...files,...files,...files]}),{status:413});
  assert.throws(() => write(bob,'send',{threadId,body:'',attachments:[{...files[0],size:3145729}]}),{status:413});
  assert.throws(() => write(bob,'send',{threadId,body:'',attachments:[files[0],{...files[1],data:'%%%%'}]}),{status:400});
  assert.equal(used.get(bob).bytes,16);
  assert.equal(get(alice,threadId).messages.length,1);
  db.prepare('UPDATE workspace_file_usage SET bytes=67108864 WHERE author_id=?').run(bob);
  assert.throws(() => write(bob,'direct',{targetId:dee,body:'',attachments:files}),{status:413});
  assert.equal(inbox(dee).threads.length,0,'an over-quota introduction leaves no thread');
  db.prepare('UPDATE workspace_file_usage SET bytes=16 WHERE author_id=?').run(bob);
  run(bob,'leave',{threadId});
  assert.throws(() => run(bob,'attachment',ref),{status:404});
  assert.equal(run(bob,'exportAttachment',ref).data,files[0].data);
  run(alice,'leave',{threadId});
  assert.throws(() => run(bob,'exportAttachment',ref),{status:404});
  assert.equal(used.get(bob).bytes,0);
  const dm = write(bob,'directFiles',{targetId:alice,body:'',attachments:[file('hello')]});
  const dmRef = {attachmentId:get(alice,dm.threadId).messages[0].attachments[0].id};
  run(alice,'block',dm);
  assert.equal(run(alice,'attachment',dmRef).data,file('hello').data);
  deleteUserById(db,bob);
  assert.throws(() => run(alice,'attachment',dmRef),{status:404});
  assert.equal(inbox(alice).threads[0].lastMessage,null);
});

test('inbox summaries show a listed direct peer’s current photo revision only', t => {
  const {db,alice,bob,write,inbox} = fixture(t);
  const revision=randomUUID();
  db.prepare('UPDATE users SET photo_revision=? WHERE id=?').run(revision,bob);
  write(alice,'direct',{targetId:bob,body:'Hi!'});
  assert.equal(inbox(alice).threads[0].photoUrl, `/api/users/${bob}/photo?v=${revision}`);
  updateUserProfile(db,bob,{partC:{consent:false}});
  assert.equal(inbox(alice).threads[0].photoUrl,undefined);
});
