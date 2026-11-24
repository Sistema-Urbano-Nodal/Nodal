import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {promisify} from 'node:util';

const databaseUrl = process.env.NODAL_WORKSPACE_TEST_DATABASE_URL;
const execute = promisify(execFile);
const migration = new URL('../supabase/migrations/20261119013754_member_workspace.sql', import.meta.url);
const quote = value => "'" + value.replaceAll("'", "''") + "'";

test('PostgreSQL member conversations, invitations and project collaboration', {skip: !databaseUrl, timeout: 120000}, async t => {
  const url = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.match(url.pathname, /^\/nodal_workspace_test_[a-z0-9_]+$/);
  assert.equal(url.search, '');
  const args = [databaseUrl, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
  const sql = async statement => (await execute('psql', [...args, '-c', statement])).stdout.trim();
  assert.equal(await sql("SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"), '0',
    'the test requires an empty disposable database');
  await sql(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
    END $$;
    CREATE TABLE profiles(id uuid PRIMARY KEY,full_name text,preferred_name text,account_status text DEFAULT 'active');
    CREATE TABLE profile_preferences(user_id uuid PRIMARY KEY, data_consent jsonb);
    CREATE TABLE onboarding_responses(user_id uuid PRIMARY KEY, raw_answers jsonb);
    GRANT USAGE ON SCHEMA public TO service_role,anon,authenticated,supabase_auth_admin;
    GRANT SELECT ON profiles,profile_preferences,onboarding_responses TO service_role;
    GRANT UPDATE ON profiles TO service_role;
    GRANT UPDATE(account_status) ON profiles TO service_role;
    GRANT DELETE,SELECT(id) ON profiles TO supabase_auth_admin;`);
  await execute('psql', [...args, '-f', migration.pathname]);
  for (const role of ['anon','authenticated']) {
    assert.equal(await sql(`SELECT has_function_privilege('${role}','public.member_workspace(uuid,text,jsonb)','execute')`), 'f');
    assert.equal(await sql(`SELECT has_schema_privilege('${role}','member_work','usage')`), 'f');
  }
  assert.equal(await sql("SELECT prosecdef FROM pg_proc WHERE oid='public.member_workspace(uuid,text,jsonb)'::regprocedure"), 'f');
  const ids = Array.from({length:6}, () => randomUUID());
  const [a,b,c,d,e,f] = ids;
  for (const [i,id] of ids.entries()) {
    await sql(`INSERT INTO profiles(id,full_name) VALUES('${id}','Member ${i}');
      INSERT INTO profile_preferences VALUES('${id}','{"directoryPublic":true}');`);
  }
  const op = async (actor, name, data={}) => JSON.parse(await sql(`SET ROLE service_role;
    SELECT public.member_workspace('${actor}',${quote(name)},${quote(JSON.stringify(data))}::jsonb)`));
  const message = (targetId,body) => ({targetId,body,clientId:randomUUID()});
  const erase = actor => sql(`SET ROLE supabase_auth_admin; DELETE FROM profiles WHERE id='${actor}'`);
  await t.test('profile photos are service-only, follow current directory consent and erase with the profile', async () => {
    const migration = new URL('../supabase/migrations/20261119020652_member_profile_photos.sql', import.meta.url);
    await execute('psql', [...args, '-f', migration.pathname]);
    for (const role of ['anon','authenticated']) {
      for (const name of ['read_member_profile_photo(uuid,uuid,uuid)','set_member_profile_photo(uuid,uuid,bytea)']) {
        assert.equal(await sql(`SELECT has_function_privilege('${role}','public.${name}','execute')`), 'f');
      }
    }
    const id = randomUUID(), rev = randomUUID();
    await sql(`INSERT INTO profiles(id,full_name) VALUES('${id}','Photo member');
      INSERT INTO profile_preferences VALUES('${id}','{"directoryPublic":true}')`);
    const run = statement => sql('SET ROLE service_role; SELECT ' + statement);
    const photo = `public.read_member_profile_photo('${b}','${id}','${rev}')`;
    assert.equal(await run(`public.set_member_profile_photo('${id}','${rev}',decode('ffd8ffd9','hex'))`),'t');
    assert.equal(await run(photo),'/9j/2Q==');
    assert.equal(await run(`public.read_member_profile_photo('${b}','${id}','${randomUUID()}') IS NULL`),'t');
    await sql(`UPDATE profile_preferences SET data_consent='{"directoryPublic":false}' WHERE user_id='${id}'`);
    assert.equal(await run(photo + ' IS NULL'),'t');
    assert.equal(await run(`public.read_member_profile_photo('${id}','${id}','${rev}')`),'/9j/2Q==');
    assert.equal(await run(`public.set_member_profile_photo('${id}',NULL,NULL)`),'t');
    assert.equal(await run(`public.read_member_profile_photo('${id}','${id}',NULL) IS NULL`),'t');
    await run(`public.set_member_profile_photo('${id}','${rev}',decode('ffd8ffd9','hex'))`);
    await erase(id);
    assert.equal(await sql(`SELECT count(*) FROM member_work.profile_photos WHERE user_id='${id}'`),'0');
  });
  await t.test('private chat files share the message transaction, membership, idempotency and erasure', async () => {
    const migration = new URL('../supabase/migrations/20261119044206_private_message_attachments.sql', import.meta.url);
    const file = text => ({name:'notes.txt',mime:'text/plain',size:Buffer.byteLength(text),data:Buffer.from(text).toString('base64')});
    const [owner,writer,invited]=[randomUUID(),randomUUID(),randomUUID()];
    for (const id of [owner,writer,invited]) {
      await sql(`INSERT INTO profiles(id,full_name) VALUES('${id}','Collaborator');
        INSERT INTO profile_preferences VALUES('${id}','{"directoryPublic":true}')`);
    }
    // During a rollout, file-bearing requests must fail on the old RPC without creating a chat or stripping its file.
    const legacyRoom = await op(owner,'group',{name:'Before migration',targetIds:[writer],clientId:randomUUID()});
    const legacyText = {...legacyRoom,clientId:randomUUID(),body:'From the previous release'};
    await op(owner,'send',legacyText);
    const sentFiles = {...legacyRoom,clientId:randomUUID(),body:'Caption',attachments:[file('test')]};
    const directFiles = {targetId:writer,clientId:randomUUID(),body:'Caption',attachments:[file('test')]};
    assert.equal((await op(owner,'sendFiles',sentFiles)).status,400);
    assert.equal((await op(owner,'directFiles',directFiles)).status,404);
    assert.equal((await op(owner,'thread',legacyRoom)).messages.length,1);
    assert.equal((await op(owner,'inbox')).threads.length,1);
    await execute('psql', [...args, '-f', migration.pathname]);
    assert.deepEqual(await op(owner,'send',legacyText),legacyRoom,'old clients can retry their pre-migration text receipt');
    assert.deepEqual(await op(owner,'sendFiles',sentFiles),legacyRoom);
    assert.equal((await op(owner,'sendFiles',{...sentFiles,body:'Caption',attachments:[],clientId:randomUUID()})).status,400);
    const migrated=(await op(owner,'thread',legacyRoom)).messages;
    assert.deepEqual(migrated.map(post=>post.attachments.length),[0,1]);
    // Exercise the full RPC payload without passing four MiB on the psql command line.
    const maxId=randomUUID();
    const maxData=`jsonb_build_object('threadId','${legacyRoom.threadId}','clientId','${maxId}','body','',
      'attachments',jsonb_build_array(jsonb_build_object('name','max.txt','mime','text/plain',
        'size',3145728,'data',repeat('YWFh',1048576))))`;
    assert.deepEqual(JSON.parse(await sql(`SET ROLE service_role; SELECT public.member_workspace('${owner}','sendFiles',${maxData})`)),legacyRoom);
    const latest=(await op(owner,'thread',legacyRoom)).messages.at(-1);
    assert.equal(latest.attachments[0].size,3145728);
    assert.equal(await sql(`SET ROLE service_role; SELECT length(public.member_workspace('${owner}','attachment',
      '{"attachmentId":"${latest.attachments[0].id}"}') ->> 'data')`),'4194304');
    assert.equal(await sql(`SELECT octet_length(digest) FROM member_work.receipts WHERE author='${owner}' AND client_id='${maxId}'`),'32');
    await op(owner,'leave',legacyRoom);
    for (const role of ['anon','authenticated']) {
      assert.equal(await sql(`SELECT has_table_privilege('${role}','member_work.message_files','select')`),'f');
      assert.equal(await sql(`SELECT has_function_privilege('${role}','member_work.store_files(uuid,uuid,jsonb)','execute')`),'f');
    }
    const group = await op(owner,'group',{name:'Docs',targetIds:[writer,invited],clientId:randomUUID()});
    await op(writer,'accept',group);
    const draft={...group,body:'',attachments:[file('documents')],clientId:randomUUID()};
    const retries=await Promise.all([op(writer,'sendFiles',draft),op(writer,'send',draft)]);
    assert.deepEqual(retries,[group,group]);
    assert.equal((await op(writer,'send',{...draft,attachments:[file('different')]})).status,409);
    const page = await op(owner,'thread',group);
    const [post]=page.messages;
    assert.equal(page.messages.length,1);
    const [attachment]=post.attachments;
    assert.deepEqual(Object.keys(attachment).sort(),['id','mime','name','size']);
    const ref={attachmentId:attachment.id};
    assert.deepEqual((await op(owner,'inbox')).threads[0].lastMessage,
      {body:'',hasAttachments:true,authorId:writer,createdAt:post.createdAt});
    assert.deepEqual(await op(owner,'attachment',ref),{...attachment,data:draft.attachments[0].data});
    assert.equal((await op(invited,'attachment',ref)).status,404);
    assert.equal((await op(owner,'exportAttachment',ref)).status,404);
    assert.deepEqual((await op(owner,'export')).attachments,[]);
    assert.equal((await op(writer,'export')).attachments[0].downloadUrl,'/api/me/export/attachments/'+attachment.id);
    const usage=()=>sql(`SELECT bytes FROM member_work.file_usage WHERE author='${writer}'`);
    assert.equal(await usage(),'9');
    const invalid={...group,body:'',attachments:[file('valid'),{...file('boo'),data:'!!!!'}],clientId:randomUUID()};
    assert.equal((await op(writer,'send',invalid)).status,400);
    assert.equal(await usage(),'9');
    assert.equal((await op(owner,'thread',group)).messages.length,1);
    assert.equal((await op(writer,'send',{...invalid,attachments:Array(5).fill(file('x'))})).status,413);
    // Only one byte of capacity remains. Concurrent writes to different rooms must not both fit.
    await sql(`UPDATE member_work.file_usage SET bytes=67108863 WHERE author='${writer}'`);
    const introductions=await Promise.all([owner,invited].map(targetId=>op(writer,'directFiles',{
      targetId,body:'',attachments:[file('x')],clientId:randomUUID()})));
    assert.equal(introductions.filter(r=>r.status===413).length,1);
    const dm=introductions.find(r=>r.threadId);
    assert.ok(dm);
    assert.equal(await usage(),'67108864');
    const rejected=[owner,invited][introductions.findIndex(r=>r.status===413)];
    assert.equal((await op(rejected,'inbox')).threads.some(r=>r.kind==='direct'),false);
    const peer=[owner,invited][introductions.findIndex(r=>r.threadId)];
    const rev=randomUUID();
    await sql(`UPDATE profiles SET photo_revision='${rev}' WHERE id='${peer}'`);
    assert.equal((await op(writer,'thread',dm)).thread.photoUrl,'/api/users/'+peer+'/photo?v='+rev);
    await sql(`UPDATE profile_preferences SET data_consent='{"directoryPublic":false}' WHERE user_id='${peer}'`);
    assert.equal((await op(writer,'thread',dm)).thread.photoUrl,undefined);
    const directFile=(await op(peer,'thread',dm)).messages[0].attachments[0];
    await op(peer,'block',dm);
    assert.equal((await op(peer,'attachment',{attachmentId:directFile.id})).size,1);
    await sql(`UPDATE member_work.file_usage SET bytes=10 WHERE author='${writer}'`);
    await op(writer,'leave',group);
    assert.equal((await op(writer,'attachment',ref)).status,404);
    assert.equal((await op(writer,'exportAttachment',ref)).data,file('documents').data);
    await op(owner,'leave',group);
    assert.equal(await usage(),'1');
    await erase(writer);
    assert.equal((await op(peer,'attachment',{attachmentId:directFile.id})).status,404);
    assert.equal((await op(peer,'thread',dm)).thread.lastMessage,null);
    await erase(owner); await erase(invited);
  });
  await t.test('service-only notification feed tracks current incoming events and preserves read races', async () => {
    const [sender,reader,guest]=[randomUUID(),randomUUID(),randomUUID()];
    for (const id of [sender,reader,guest]) await sql(`INSERT INTO profiles(id,full_name) VALUES('${id}','Sender');
      INSERT INTO profile_preferences VALUES('${id}','{"directoryPublic":true}')`);
    const group = await op(sender,'group',{name:'Old group',targetIds:[reader,guest],clientId:randomUUID()});
    await op(reader,'accept',group);
    const send = (author,room,body) => op(author,'send',{...room,body,clientId:randomUUID()});
    await send(sender,group,'Mixed historical unread');
    const direct = await op(sender,'direct',message(reader,'Old direct'));
    const migration = new URL('../supabase/migrations/20261119232657_workspace_notifications.sql',import.meta.url);
    await execute('psql',[...args,'-f',migration.pathname]);
    const feed = async id => JSON.parse(await sql(`SET ROLE service_role; SELECT public.member_workspace_notifications('${id}')`));
    for (const role of ['anon','authenticated']) {
      assert.equal(await sql(`SELECT has_function_privilege('${role}','public.member_workspace_notifications(uuid)','execute')`),'f');
      assert.equal(await sql(`SELECT has_table_privilege('${role}','member_work.notifications','select')`),'f');
    }
    const legacy = await feed(reader);
    assert.equal(legacy.total,1);
    assert.equal(legacy.items[0].threadId,direct.threadId);
    const invitation = (await feed(guest)).items[0];
    assert.deepEqual(invitation,{id:invitation.id,type:'invitation',threadId:group.threadId,threadKind:'group',groupName:'Old group',
      actorName:'Sender',createdAt:null});
    await op(guest,'decline',group);
    const invite = {...group,targetId:guest,clientId:randomUUID()};
    await op(sender,'invite',invite); await op(sender,'invite',invite);
    const reinvited=(await feed(guest)).items[0];
    assert.notEqual(reinvited.id,invitation.id);
    assert.ok(Number.isFinite(Date.parse(reinvited.createdAt)));
    await send(sender,group,'New group message');
    assert.deepEqual((await feed(guest)).items,[reinvited]);
    const seen = await op(reader,'thread',group);
    const latest = seen.messages.at(-1);
    const active = (await feed(reader)).items.find(i=>i.threadId===group.threadId);
    assert.deepEqual(active,{id:latest.id,type:'message',threadId:group.threadId,threadKind:'group',groupName:'Old group',
      actorName:'Sender',createdAt:latest.createdAt});
    await send(reader,group,'My own outgoing message');
    await op(sender,'createProject',{...group,title:'Walk',goal:'Review',clientId:randomUUID()});
    assert.deepEqual((await feed(reader)).items.find(i=>i.threadId===group.threadId),active);
    await op(reader,'read',{...group,revision:seen.thread.revision});
    assert.equal((await feed(reader)).total,2);
    const beforeIncoming=(await op(reader,'thread',group)).thread.revision;
    await Promise.all([send(sender,group,'New while open'),op(reader,'read',{...group,revision:beforeIncoming})]);
    const arrived=(await op(reader,'thread',group)).messages.at(-1).id;
    assert.equal((await feed(reader)).items.find(i=>i.threadId===group.threadId).id,arrived);
    await op(reader,'read',{...group,revision:(await op(reader,'thread',group)).thread.revision});
    await op(sender,'createProject',{...group,title:'Walk again',goal:'Review',clientId:randomUUID()});
    assert.deepEqual((await feed(reader)).items,legacy.items);
    await op(reader,'block',direct);
    assert.deepEqual(await feed(reader),{total:0,items:[]});
    await op(guest,'accept',group);
    assert.equal((await feed(guest)).total,0);
    await send(sender,group,'New activity');
    await op(guest,'leave',group);
    assert.equal((await feed(guest)).total,0);
    await erase(sender);
    assert.equal((await feed(reader)).total,0);
    assert.equal((await feed(sender)).status,403);
    await sql(`SET ROLE service_role; SELECT public.member_workspace('${reader}','group',jsonb_build_object('name','Team','targetIds',
      jsonb_build_array('${guest}'::text),'clientId',gen_random_uuid())) FROM generate_series(1,22)`);
    const capped=await feed(guest);
    assert.equal(capped.total,22);
    assert.equal(capped.items.length,20);
    assert.deepEqual(capped.items.map(i=>i.createdAt),capped.items.map(i=>i.createdAt).sort().reverse());
  });
  await t.test('editorial notices reach members independently of preferences and coexist with chat',async () => {
    const migrate = async name => execute('psql',[...args,'-f',new URL('../supabase/migrations/'+name,import.meta.url).pathname]);
    await sql(`ALTER TABLE profiles ADD COLUMN created_at timestamptz DEFAULT now();
      CREATE TABLE catalog_items(id uuid PRIMARY KEY,kind text,status text,visibility text,featured boolean,translations jsonb);
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
      GRANT SELECT,INSERT,UPDATE,DELETE ON catalog_items TO service_role;`);
    await migrate('20261001011356_nodal_news.sql');
    await migrate('20261122010000_news_email_alerts.sql');
    const ids=Array.from({length:6},()=>randomUUID()),[historic,draft,news,listing,other,qa]=ids;
    const addNews=(id,published)=>sql(`SET ROLE service_role; INSERT INTO nodal_news
      (id,title,body,url,status,pinned,published_at,created_at,updated_at,version)
      VALUES('${id}','New edition','','','${published?'published':'draft'}',false,${published?'now()':'NULL'},now(),now(),1)`);
    await addNews(historic,true);
    await migrate('20261124030000_editorial_bell.sql');
    for(const role of ['anon','authenticated']) {
      for(const rpc of ['member_workspace_bell(uuid)','read_editorial_notification(uuid,text)']) {
        assert.equal(await sql(`SELECT has_function_privilege('${role}','public.${rpc}','execute')`),'f');
      }
      for(const name of ['editorial_events','editorial_reads','visible_editorial_notifications']) {
        assert.equal(await sql(`SELECT has_table_privilege('${role}','member_work.${name}','select')`),'f');
      }
    }
    const feed=async user=>JSON.parse(await sql(`SET ROLE service_role; SELECT public.member_workspace_bell('${user}')`));
    const read=async (user,key)=>JSON.parse(await sql(`SET ROLE service_role; SELECT public.read_editorial_notification('${user}',${quote(key)})`));
    assert.deepEqual(await feed(a),{total:0,workspaceTotal:0,items:[]});
    await addNews(draft,false); await addNews(qa,false);
    await sql(`SET ROLE service_role; INSERT INTO news_email_events(event_id,news_id) VALUES('test:${a}:${qa}','${qa}');
      INSERT INTO catalog_items VALUES('${listing}','opportunity','published','public',false,'{"en":{"title":"Grant"},"pt":{"title":"Bolsa"},"es":{"title":"Beca"}}'),
      ('${other}','resource','published','public',true,'{}')`);
    assert.equal((await feed(a)).total,0);
    await addNews(news,true);
    await sql(`SET ROLE service_role; UPDATE catalog_items SET featured=true WHERE id='${listing}'`);
    const first=await feed(a);
    assert.equal(first.total,2);
    assert.deepEqual(first.items.map(i=>[i.id,i.type,i.title]),[
      [listing,'opportunity',{en:'Grant',pt:'Bolsa',es:'Beca'}],[news,'news','New edition'],
    ]);
    assert.equal(await sql('SELECT count(*) FROM news_email_outbox'),'0');
    const reader=randomUUID(),sender=randomUUID();
    await sql(`INSERT INTO profiles(id,full_name) VALUES('${reader}','Reader'),('${sender}','Sender');
      INSERT INTO profile_preferences VALUES('${reader}','{"directoryPublic":true}'),('${sender}','{"directoryPublic":true}')`);
    assert.equal((await feed(reader)).total,0,'a new account does not inherit previously published notices');
    await op(reader,'group',{name:'Messages',targetIds:[a],clientId:randomUUID()});
    const mixed=await feed(a);
    assert.equal(mixed.total,3); assert.equal(mixed.workspaceTotal,1);
    assert.equal(mixed.items[0].type,'invitation');
    // Hidden or nonsensical read attempts cannot preemptively suppress a future publication.
    assert.deepEqual(await read(a,'n:'+draft),{ok:true});
    assert.deepEqual(await Promise.all([read(a,'c:'+listing),read(a,'c:'+listing)]),[{ok:true},{ok:true}]);
    assert.equal((await feed(a)).total,2);
    assert.equal((await feed(b)).total,2,'independent recipient');
    await sql(`SET ROLE service_role; UPDATE catalog_items SET visibility='members' WHERE id='${listing}';
      UPDATE nodal_news SET status='draft' WHERE id='${news}'`);
    assert.equal((await feed(b)).total,0);
    await sql(`SET ROLE service_role; UPDATE nodal_news SET status='published',title='Edited' WHERE id='${news}';
      UPDATE catalog_items SET visibility='public' WHERE id='${listing}'`);
    assert.equal((await feed(a)).total,2);
    assert.equal((await feed(b)).items.find(i=>i.id===news).title,'Edited');
    await sql(`SET ROLE service_role; INSERT INTO nodal_news(id,title,body,url,status,pinned,published_at,created_at,updated_at,version)
      SELECT gen_random_uuid(),'More','','','published',false,now(),now(),now(),1 FROM generate_series(1,21)`);
    assert.equal((await feed(b)).total,23);
    assert.equal((await feed(b)).items.length,20);
    await sql(`SET ROLE service_role; DELETE FROM catalog_items WHERE id='${listing}';
      DELETE FROM nodal_news;`);
    assert.equal(await sql('SELECT count(*) FROM member_work.editorial_reads'),'0');
    await erase(reader); await erase(sender);
    assert.equal((await feed(reader)).status,403);
    assert.equal((await read(reader,'n:'+news)).status,403);
  });
  const opening = message(b,'Where should we start?');
  const first = await Promise.all([op(a,'direct',opening), op(a,'direct',opening)]);
  assert.deepEqual(first[0],first[1]);
  const dm = {threadId:first[0].threadId};
  assert.equal((await op(a,'direct',message(b,'Again'))).status,409);
  assert.equal((await op(a,'direct',{...opening,body:'A different draft'})).status,409);
  assert.equal((await op(c,'thread',dm)).status,404);
  assert.equal((await op(b,'inbox')).threads[0].unread,true);
  assert.deepEqual(await op(b,'read',{...dm,revision:(await op(b,'thread',dm)).thread.revision}),dm);
  assert.equal((await op(b,'inbox')).threads[0].unread,false);
  await sql(`UPDATE profile_preferences SET data_consent='{"directoryPublic":false}' WHERE user_id='${a}';
    INSERT INTO onboarding_responses VALUES('${a}','{"partC":{"consent":true}}')`);
  assert.equal((await op(c,'direct',message(a,'hidden?'))).status,404);
  assert.deepEqual(await op(b,'send',{...dm,body:'The station',clientId:randomUUID()}),dm);
  assert.equal((await op(a,'thread',dm)).thread.status,'active');
  const staleRevision = (await op(a,'thread',dm)).thread.revision;
  assert.deepEqual(await op(a,'send',{...dm,body:'Following up',clientId:randomUUID()}),dm);
  await op(a,'read',{...dm,revision:staleRevision});
  assert.equal((await op(a,'inbox')).threads[0].unread,true,'writing from an old tab preserves unseen activity');
  await op(a,'read',{...dm,revision:(await op(a,'thread',dm)).thread.revision});
  assert.equal((await op(a,'inbox')).threads[0].unread,false);
  await sql(`UPDATE profiles SET account_status='disabled' WHERE id='${d}'`);
  assert.equal((await op(c,'direct',message(d,'Suspended recipient'))).status,404);
  assert.equal((await op(c,'inbox')).threads.length,0,'refusing an introduction creates no empty conversation');
  await sql(`UPDATE profiles SET account_status='active' WHERE id='${d}'`);

  const crossing = await Promise.all([op(e,'direct',message(f,'Hello F')),op(f,'direct',message(e,'Hello E'))]);
  assert.deepEqual(crossing[0],crossing[1]);
  assert.equal((await op(e,'thread',crossing[0])).messages.length,2);

  const viewedRevision = (await op(e,'thread',crossing[0])).thread.revision;
  const sends = Array.from({length:51},(_,i) => ({...crossing[0],body:'Item '+i,clientId:randomUUID()}));
  for (const item of sends) await op(f,'send',item);
  await op(e,'read',{...crossing[0],revision:viewedRevision});
  assert.equal((await op(e,'inbox')).threads[0].unread,true);
  const current = await op(e,'thread',crossing[0]);
  assert.equal(current.moreMessages,true);
  assert.equal(current.messages.length,50);
  assert.equal(current.messages[0].body,'Item 1');
  const older = await op(e,'thread',{...crossing[0],beforeMessageId:current.messages[0].id});
  assert.equal(older.moreMessages,false);
  assert.equal(older.messages.length,3);
  assert.equal(older.messages.at(-1).body,'Item 0');
  assert.equal((await op(a,'thread',{...dm,beforeMessageId:current.messages[0].id})).status,404);
  await op(e,'read',{...crossing[0],revision:current.thread.revision});
  assert.equal((await op(e,'inbox')).threads[0].unread,false);

  const create = {name:'Safer streets',targetIds:[b,c],clientId:randomUUID()};
  const grp = await op(a,'group',create);
  assert.deepEqual(await op(a,'group',create),grp);
  assert.equal((await op(c,'thread',grp)).status,404);
  assert.deepEqual((await op(c,'inbox')).invitations,[{id:grp.threadId,name:create.name,inviterName:'Member 0'}]);
  assert.equal((await op(c,'send',{...grp,body:'too soon',clientId:randomUUID()})).status,404);
  await op(b,'accept',grp);
  assert.equal((await op(b,'invite',{...grp,targetId:d})).status,400);
  const individualInvite = {...grp,targetId:d,clientId:randomUUID()};
  assert.deepEqual(await op(b,'invite',individualInvite),grp);
  await op(d,'decline',grp);
  assert.deepEqual(await op(b,'invite',individualInvite),grp);
  assert.deepEqual((await op(d,'inbox')).invitations,[],'a retry after a decline does not create another invitation');
  assert.equal((await op(d,'thread',grp)).status,404);
  await op(c,'accept',grp);
  assert.equal((await op(c,'thread',grp)).messages.length,0);
  assert.equal((await op(c,'thread',dm)).status,404);

  const project = {...grp,title:'Crosswalks',goal:'Collect field notes',clientId:randomUUID()};
  const projectRef = await op(a,'createProject',project);
  assert.deepEqual(await op(a,'createProject',project),projectRef);
  const newStep = {...projectRef,description:'Site visit',assigneeId:b,clientId:randomUUID()};
  await op(c,'step',newStep);
  await op(c,'step',newStep);
  assert.equal((await op(c,'step',{...newStep,clientId:randomUUID(),assigneeId:d})).status,400);
  const before = (await op(b,'thread',grp)).projects[0];
  assert.equal(before.steps.length,1);
  await op(b,'toggle',{...projectRef,stepId:before.steps[0].id,done:true});
  await op(c,'link',{...projectRef,link:'https://example.org/notes'});
  await op(b,'update',{...projectRef,body:'Paint faded',clientId:randomUUID()});
  assert.equal((await op(c,'thread',grp)).projects[0].steps[0].done,true);
  assert.deepEqual((await op(a,'export')).updates,[]);
  assert.deepEqual((await op(b,'export')).updates.map(x=>x.body),['Paint faded']);
  assert.deepEqual((await op(b,'export')).messages.map(x=>x.body),['The station']);
  assert.equal((await op(c,'export')).steps.length,1);

  const invite = await op(a,'group',{name:'Pending with B',targetIds:[b],clientId:randomUUID()});
  assert.deepEqual(await op(b,'block',dm),dm);
  assert.equal((await op(b,'inbox')).invitations.length,0);
  assert.equal((await op(b,'accept',invite)).status,404);
  assert.equal((await op(a,'invite',{...invite,targetId:b,clientId:randomUUID()})).status,403);
  assert.equal((await op(a,'send',{...dm,body:'Blocked',clientId:randomUUID()})).status,403);
  assert.equal((await op(b,'thread',grp)).thread.name,'Safer streets');
  await op(c,'leave',grp);
  assert.equal((await op(c,'thread',grp)).status,404);
  assert.equal((await op(c,'step',newStep)).status,404);

  await erase(a);
  const survivor = await op(b,'thread',grp);
  assert.equal(survivor.thread.name,'');
  assert.equal(survivor.projects[0].title,'');
  assert.equal(survivor.projects[0].updates[0].body,'Paint faded');
  assert.equal(survivor.projects[0].link,'https://example.org/notes');
  const directHistory = await op(b,'thread',dm);
  assert.equal(directHistory.thread.peerId,null);
  assert.equal(directHistory.thread.initiatorId,null);
  assert.deepEqual(directHistory.messages.map(x=>x.body),['The station']);
  await erase(c);
  assert.equal((await op(b,'thread',grp)).projects[0].steps.length,0);
  assert.equal((await op(b,'thread',grp)).projects[0].link,'');
  await op(b,'leave',grp);
  assert.equal(await sql(`SELECT count(*) FROM member_work.rooms WHERE id='${grp.threadId}'`),'0');

  const last = {name:'Temporary',targetIds:[d],clientId:randomUUID()};
  const empty = await op(b,'group',last);
  await op(b,'leave',empty);
  assert.equal((await op(b,'group',last)).status,404);
  assert.equal((await op(d,'accept',empty)).status,404);
});
