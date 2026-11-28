import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser,updateUserProfile,deleteUserById} from '../server/db.js';
import {createSqliteWorkspace} from '../server/workspace-sqlite.js';
import {deliverDirectEmail,directMessageEmail} from '../server/direct-email.js';
import {drainScheduledEmail} from '../api/cron/news-email.js';

function fixture(t) {
  const db=createDatabase({filename:':memory:'});
  t.after(()=>db.close());
  const ws=createSqliteWorkspace(db),store=ws.emailAlerts;
  const [a,b,c]=['Alicia','Bruno','Carla'].map(name=>{
    const {id}=createUser(db,{fullName:name,email:name+'@example.test',passwordHash:'unused'});
    updateUserProfile(db,id,{partC:{consent:true}});
    return id;
  });
  const command=(who,op,fields)=>ws.execute(who,op,{clientId:randomUUID(),...fields});
  const send=(fn)=>deliverDirectEmail({store,origin:'https://nodal.example',send:fn});
  return {db,ws,store,a,b,c,command,send};
}

test('private email starts off, coalesces unread direct messages, and carries only generic inbox and preference links',async t=>{
  const {store,a,b,c,command,send}=fixture(t);
  assert.equal(await store.preference(b),null);
  const dm=command(a,'direct',{targetId:b,body:'Sensitive introduction'});
  await store.setPreference(b,true,'pt');
  assert.equal(await store.claim(),undefined,'opting in does not send old mail');
  command(b,'send',{...dm,body:'reply'});
  const group=command(a,'group',{name:'Private Team',targetIds:[b,c]});
  command(b,'accept',group);
  command(a,'send',{...group,body:'Secret group conversation'});
  assert.equal(await store.claim(),undefined,'my reply, group invite and group post produce no email');
  command(a,'send',{...dm,body:'Secret location'});
  const file={name:'confidential-name.txt',mime:'text/plain',size:1,data:'eA=='};
  const data={...dm,clientId:randomUUID(),body:'',attachments:[file]};
  command(a,'sendFiles',data);
  command(a,'sendFiles',data);
  const captured=[];
  const result=await send(async msg=>captured.push(msg));
  assert.equal(result.sent,1);
  assert.equal(captured[0].to,'Bruno@example.test'.toLowerCase());
  assert.equal(captured[0].language,'pt');
  for (const content of [captured[0].text,captured[0].html]) {
    assert.match(content,/https:\/\/nodal\.example\/messages\.html/);
    assert.match(content,/messages\.html\?settings=email/);
    for (const secret of [dm.threadId,'Alicia','Secret location','confidential-name','Private Team']) assert.ok(!content.includes(secret));
  }
  assert.equal((await send(()=>assert.fail('duplicate'))).sent,0);
  assert.equal((await store.exportFor(b)).deliveries[0].status,'sent');
});

test('reads, blocks, account deletion and opt-out suppress pending delivery including a preference change after claim',async t=>{
  for (const reason of ['read','block','opt-out','erase','disabled']) {
    const {db,store,a,b,command,send}=fixture(t);
    await store.setPreference(b,true,'es');
    const dm=command(a,'direct',{targetId:b,body:'Private'});
    const claimed=await store.claim();
    assert.ok(await store.recipient(claimed));
    if (reason==='read') command(b,'read',{...dm,revision:command(b,'thread',dm).thread.revision});
    if (reason==='block') command(b,'block',dm);
    if (reason==='opt-out') await store.setPreference(b,false,'es');
    if (reason==='erase') deleteUserById(db,b);
    if (reason==='disabled') db.prepare("UPDATE users SET account_status='disabled' WHERE id=?").run(b);
    assert.equal(await store.recipient(claimed),undefined,reason);
    await store.settle(claimed,'skipped');
    assert.equal((await send(()=>assert.fail(reason))).sent,0);
  }
});

test('temporary SMTP refusals have a bounded retry; uncertain handoff never resends',async t=>{
  for (const delivery of ['no','unknown']) {
    const {db,store,a,b,command,send}=fixture(t);
    await store.setPreference(b,true,'en');
    command(a,'direct',{targetId:b,body:'Private'});
    let calls=0;
    const fail=()=>{calls++;throw Object.assign(new Error('test refusal'),{delivery});};
    const first=await send(fail);
    if (delivery==='no') {
      assert.equal(first.deferred,1);
      for (let n=0;n<2;n++){
        db.exec('UPDATE direct_email_outbox SET available_at=0');
        const retry=await send(fail);
        assert.equal(n===0?retry.deferred:retry.failed,1);
      }
      assert.equal(calls,3);
    } else assert.equal(first.uncertain,1);
    assert.equal(await store.claim(),undefined);
  }
});

test('scheduled delivery drains both queues and supports all email languages',async()=>{
  const timings=[];
  const counts=await drainScheduledEmail({}, {publications:async()=>{timings.push('news');return {sent:2,uncertain:1};},
    direct:async()=>{timings.push('direct');return {sent:1,skipped:3};}});
  assert.deepEqual(timings.sort(),['direct','news']);
  assert.deepEqual(counts,{sent:3,failed:0,deferred:0,uncertain:1,skipped:3});
  const subjects=['en','es','pt'].map(lang=>directMessageEmail(lang,'https://nodal.example').subject);
  assert.equal(new Set(subjects).size,3);
});
