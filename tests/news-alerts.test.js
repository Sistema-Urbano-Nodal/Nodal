import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createDatabase,createUser} from '../server/db.js';
import {createNewsStore} from '../server/news-repository.js';
import {deliverBatch} from '../server/news-alerts.js';

function fixture(t){
  const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
  const store=createNewsStore({db});
  const member=(n)=>createUser(db,{fullName:n,email:n+'@example.test',passwordHash:'unused'}).id;
  const make=(status='draft',url='')=>{const now=new Date().toISOString();return store.insert({id:randomUUID(),title:'Nueva convocatoria',body:'',url,status,pinned:false,createdBy:null,publishedAt:status==='published'?now:null,createdAt:now,updatedAt:now,version:1});};
  const queued=()=>db.prepare('SELECT status FROM news_email_outbox ORDER BY user_id').all().map(r=>r.status);
  return {db,store,member,make,queued};
}

test('first publication enqueues opted-in accounts once across edits and republishing',async t=>{
  const {store,member,make,queued}=fixture(t),a=member('ana'),b=member('bea');
  assert.equal(await store.alerts.preference(a),false);
  await store.alerts.subscribe(a,true);await store.alerts.subscribe(a,true);
  const item=await make();assert.deepEqual(queued(),[]);
  await store.update(item.id,1,{status:'published',publishedAt:new Date().toISOString(),version:2});
  await store.alerts.subscribe(b,true);
  await store.update(item.id,2,{status:'draft',version:3});
  await store.update(item.id,3,{status:'published',version:4});
  assert.deepEqual(queued(),['queued']);
  const deliveries=[];
  assert.deepEqual(await deliverBatch({alerts:store.alerts,send:async m=>deliveries.push(m),origin:'https://example.test'}),{sent:1,failed:0,uncertain:0,deferred:0});
  assert.deepEqual(queued(),['sent']);assert.equal(deliveries[0].to,'ana@example.test');assert.match(deliveries[0].text,/community.html#news-email/);
  await deliverBatch({alerts:store.alerts,send:async m=>deliveries.push(m),origin:'https://example.test'});
  assert.equal(deliveries.length,1);
});

test('withdrawal cancels pending deliveries and removes the subscription, including after rejoining',async t=>{
  const {store,member,make,queued}=fixture(t),a=member('ana');
  await store.alerts.subscribe(a,true);await make('published');
  await store.alerts.subscribe(a,false);await store.alerts.subscribe(a,true);
  assert.deepEqual(queued(),[]);
  const item=await make('published');
  await store.update(item.id,1,{status:'draft',version:2});
  const result=await store.alerts.claim();assert.equal(result,null);
});

test('concurrent workers cannot repeat an ambiguous SMTP result or deliver to a disabled account',async t=>{
  const {store,member,make,db,queued}=fixture(t),a=member('ana'),b=member('bea');
  await store.alerts.subscribe(a,true);await store.alerts.subscribe(b,true);await make('published');
  db.prepare("UPDATE users SET account_status='disabled' WHERE id=?").run(b);
  let attempts=0;const run=()=>deliverBatch({alerts:store.alerts,origin:'https://example.test',send:async()=>{attempts++;throw Object.assign(new Error('lost response'),{delivery:'unknown'});}});
  await Promise.all([run(),run()]);await run();
  assert.equal(attempts,1);assert.deepEqual(queued().sort(),['queued','uncertain']);
});

test('known temporary delivery failures back off and stop after the third attempt',async t=>{
  const {db,store,member,make,queued}=fixture(t),a=member('ana');
  await store.alerts.subscribe(a,true,'pt');await make('published');
  const run=()=>deliverBatch({alerts:store.alerts,origin:'https://example.test',send:async m=>{
    assert.equal(m.language,'pt');throw Object.assign(new Error('temporary refusal'),{delivery:'no'});}});
  for(let i=1;i<=3;i++){
    const result=await run();
    assert.equal(result[i===3?'failed':'deferred'],1);
    assert.equal(await store.alerts.claim(),null);
    db.exec('UPDATE news_email_outbox SET available_at=0');
  }
  assert.deepEqual(queued(),['failed']);
});

test('linked published forms reach only the consenting account and exporting or deleting an account respects ownership',async t=>{
  const {db,store,member,make}=fixture(t),a=member('ana'),b=member('bea');
  await store.alerts.subscribe(a,true,'pt');
  const url='https://example.test/form?q=nodal&lang=pt';
  const item=await make('published',url);
  let outgoing;
  await deliverBatch({alerts:store.alerts,send:async message=>{outgoing=message;},origin:'https://example.test'});
  assert.ok(outgoing.text.includes(url));assert.ok(outgoing.html.includes('q=nodal&amp;lang=pt'));
  assert.ok(outgoing.text.includes('Alterar minha preferência'));
  const own=await store.alerts.exportFor(a);
  assert.equal(own.subscription.language,'pt');assert.equal(own.deliveries[0].news_id,item.id);assert.equal(own.deliveries[0].status,'sent');
  assert.deepEqual(await store.alerts.exportFor(b),{subscription:null,deliveries:[]});
  db.prepare('DELETE FROM users WHERE id=?').run(a);
  assert.deepEqual(await store.alerts.exportFor(a),{subscription:null,deliveries:[]});
});

test('delivery command defaults to an offline preview and rejects a live run without configuration',async()=>{
  const {spawnSync}=await import('node:child_process'),script=new URL('../scripts/deliver-news-alerts.js',import.meta.url).pathname;
  const run=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',env:{PATH:process.env.PATH}});
  assert.match(run().stdout,/No connection or delivery/);
  assert.notEqual(run('--send').status,0);assert.match(run('--send').stderr,/Configure SMTP/);
  assert.notEqual(run('--limit','101').status,0);
});

test('claims keep the localized opportunity body when a legacy summary is blank and never infer a personal credit',async t=>{
  const {db,store,member}=fixture(t);
  const reader=member('reader'), privateActor=member('private-editor');
  await store.alerts.subscribe(reader,true,'pt');
  const translations={es:{title:'Español',summary:'Texto español'},pt:{title:'Português',summary:'  ',body:'Texto da oportunidade'}};
  db.prepare(`INSERT INTO catalog_items(id,kind,status,visibility,featured,translations_json,organization,created_by,published_by)
    VALUES(?,'opportunity','published','public',1,?,?,?,?)`).run(randomUUID(),JSON.stringify(translations),'Instituto da Cidade',privateActor,privateActor);
  const job=await store.alerts.claim();
  assert.equal(job.excerpt,'Texto da oportunidade');
  assert.equal(job.byline,'');
  assert.equal(job.organization,'Instituto da Cidade');
});

test('only public featured opportunities trigger a localized catalogue alert',async t=>{
  const {store,member,db}=fixture(t),a=member('ana');await store.alerts.subscribe(a,true,'pt');
  const insert=db.prepare("INSERT INTO catalog_items(id,kind,status,visibility,featured,translations_json) VALUES(?,?,'published',?,?,?)");
  const translations=JSON.stringify({pt:{title:'Nova oportunidade'}});
  for(const kind of ['resource','project','case_study','learning_circle']){
    insert.run(randomUUID(),kind,'public',1,translations);
  }
  const id=randomUUID();
  insert.run(id,'opportunity','members',1,translations);
  assert.equal(await store.alerts.claim(),null);
  db.prepare("UPDATE catalog_items SET featured=0,visibility='public' WHERE id=?").run(id);
  assert.equal(await store.alerts.claim(),null);
  db.prepare("UPDATE catalog_items SET featured=1 WHERE id=?").run(id);
  db.prepare("UPDATE catalog_items SET status='archived' WHERE id=?").run(id);
  assert.equal(await store.alerts.claim(),null);
  db.prepare("UPDATE catalog_items SET status='published' WHERE id=?").run(id);
  const messages=[];await deliverBatch({alerts:store.alerts,send:async m=>messages.push(m),origin:'https://example.test'});
  assert.equal(messages.length,1);assert.equal(messages[0].subject,'NODAL · Nova oportunidade');
  assert.ok(messages[0].text.includes('/opportunities.html?id='+id));
  db.prepare('UPDATE catalog_items SET featured=0 WHERE id=?').run(id);
  db.prepare('UPDATE catalog_items SET featured=1 WHERE id=?').run(id);
  assert.equal(await store.alerts.claim(),null);
});

test('a private delivery check must match its exact subscriber and draft and never fans out',async t=>{
  const {db,store,make,member,queued}=fixture(t);
  const recipient=member('target'),other=member('another');
  db.prepare("INSERT INTO news_email_preferences(user_id,notice_version) VALUES(?,'qa:single-message')").run(recipient);
  await store.alerts.subscribe(other,true);
  assert.equal(await store.alerts.preference(recipient),false);
  assert.equal((await store.alerts.exportFor(recipient)).subscription,null);
  const draft=await make('draft','https://example.test/private-draft-link');
  const key='test:'+recipient+':'+draft.id;
  const event=db.prepare('INSERT INTO news_email_events(event_id,news_id) VALUES(?,?)');
  const outbox=db.prepare('INSERT INTO news_email_outbox(event_id,user_id) VALUES(?,?)');
  event.run(key,draft.id);
  assert.deepEqual(queued(),[]);
  outbox.run(key,other);
  const malformed=await make(),badKey='test:'+recipient+':'+draft.id+'-wrong';
  event.run(badKey,malformed.id);outbox.run(badKey,recipient);
  assert.equal(await store.alerts.claim(),null);
  outbox.run(key,recipient);
  const messages=[];
  await deliverBatch({alerts:store.alerts,send:async m=>messages.push(m),origin:'https://example.test'});
  assert.deepEqual(messages.map(m=>m.to),['target@example.test']);
  assert.ok(messages[0].text.includes('https://example.test/community.html#nodal-news'));
  assert.doesNotMatch(messages[0].text,/private-draft-link|[?]news=/);
  assert.ok(messages[0].html.includes('href="https://example.test/community.html#nodal-news"'));
  assert.doesNotMatch(messages[0].html,/private-draft-link|[?]news=/);
  assert.equal(await store.alerts.claim(),null);
  const publicPost=await make('published');
  assert.equal(db.prepare('SELECT user_id FROM news_email_outbox WHERE event_id=?').get('n:'+publicPost.id).user_id,other);
  assert.equal(db.prepare('SELECT count(*) AS n FROM news_email_outbox WHERE event_id=?').get('n:'+publicPost.id).n,1);
  await store.alerts.subscribe(recipient,true,'pt');
  assert.equal(await store.alerts.preference(recipient),true);
  const {subscription}=await store.alerts.exportFor(recipient);
  assert.equal(subscription.notice_version,'news-v1');
  assert.equal(subscription.language,'pt');
});

const publicationActions = {
  es: {news: /Leer la noticia/i, opportunity: /Ver la oportunidad/i},
  en: {news: /read (?:the |this )?(?:news|story|article|update)/i, opportunity: /(?:view|explore|see|open) (?:the |this )?opportunity/i},
  pt: {news: /(?:ler|leia) (?:a |esta )?notícia/i, opportunity: /(?:ver|veja|explorar|conhecer) (?:a |esta )?oportunidade/i},
};

for (const [language, actions] of Object.entries(publicationActions)) {
  test(`news and featured opportunities send branded, accessible letters in ${language}`, async t => {
    const {db, store, member, make} = fixture(t);
    await store.alerts.subscribe(member('reader'), true, language);
    const origin = 'https://example.test';
    const title = 'NODAL <b>Ríos</b> & barrios';
    const external = 'https://publisher.example/story?a=1&b=2';
    const news = await make('draft', external);
    const newsExcerpt = 'Una plaza para peatones & ciclistas.';
    const opportunityExcerpt = 'Proyectos de movilidad para la red · ' + language;
    await store.update(news.id, 1, {title, body:newsExcerpt, publicByline:'Marta & Ana', status:'published', publishedAt:new Date().toISOString(), version:2});
    const catalogId = randomUUID();
    const translations = JSON.stringify({[language]: {title,summary:opportunityExcerpt,body:'A longer opportunity description'}});
    db.prepare("INSERT INTO catalog_items(id,kind,status,visibility,featured,translations_json,organization,public_byline) VALUES(?,'opportunity','published','public',1,?,'Instituto Urbano','Mesa editorial')")
      .run(catalogId, translations);

    const messages = [];
    await deliverBatch({alerts:store.alerts, origin, send:async message => messages.push(message)});
    assert.equal(messages.length, 2);
    const opportunity = origin + '/opportunities.html?id=' + catalogId;
    for (const [kind, destination] of [['news', external], ['opportunity', opportunity]]) {
      const message = messages.find(item => item.text.includes(destination));
      assert.ok(message, `${kind} retains its public link in the plain-text alternative`);
      assert.equal(message.language, language);
      assert.equal(message.subject, 'NODAL · ' + title);
      assert.ok(message.text.includes(title));
      assert.match(message.text, actions[kind]);
      assert.ok(message.text.includes(origin + '/community.html#news-email'));
      const {html} = message;
      const excerpt = kind === 'news' ? newsExcerpt : opportunityExcerpt;
      const credit = kind === 'news' ? 'Marta & Ana' : 'Mesa editorial';
      for (const value of [excerpt, credit]) {
        assert.ok(message.text.includes(value));
        assert.ok(html.includes(value.replaceAll('&', '&amp;')));
      }
      assert.equal(message.text.includes('Instituto Urbano'), kind === 'opportunity');
      assert.ok(!message.text.includes('A longer opportunity description'));
      assert.ok(html.includes(`<html lang="${language}"`));
      assert.match(html, /<h1\b[^>]*>[\s\S]*?&lt;b&gt;Ríos&lt;\/b&gt; &amp; barrios[\s\S]*?<\/h1>/i);
      assert.doesNotMatch(html, /<b>Ríos<\/b>/i);
      const actionLinks = [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)]
        .filter(link => link[1] === destination.replaceAll('&', '&amp;'));
      assert.ok(actionLinks.some(link => actions[kind].test(link[2])), 'the primary link names the action');
      assert.ok(html.includes('href="' + origin + '/community.html#news-email"'));
      for (const image of ['nodal-lockup.png', 'nodal-lockup-dark.png', 'nodal-network-map-v1.png']) {
        assert.ok(html.includes(`src="${origin}/assets/email/${image}"`), image);
      }
      assert.match(html, /alt="NODAL"/i);
      assert.match(html, /<table\b[^>]*role="presentation"/i);
      assert.match(html, /@media[^{}]*max-width\s*:/i);
      assert.match(html, /prefers-color-scheme\s*:\s*dark/i);
    }
  });
}
