import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import jpeg from 'jpeg-js';
import {createDatabase, createUser} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createApp} from '../server/server.js';
import {createNewsStore} from '../server/news-repository.js';
import {coverUpdate, readPublicationCover} from '../server/publication-cover.js';

function jpegUri(color, width=1080, height=600) {
  // Simulate a caller uploading metadata in an otherwise valid, already framed cover.
  const image = {width,height,data:Buffer.alloc(width*height*4,color),comments:['Private coordinates '.repeat(1500)]};
  return 'data:image/jpeg;base64,'+jpeg.encode(image,80).data.toString('base64');
}

test('only canonical frame-sized JPEGs enter the publication store; metadata is discarded and revisions identify the delivered bytes', ()=>{
  const upload = jpegUri(190);
  const {coverJpeg,coverRevision,coverAlt} = coverUpdate({coverImage:upload,coverAlt:' Foto  de Lima '});
  assert.equal(coverAlt,'Foto de Lima');
  assert.equal(coverRevision,createHash('sha256').update(coverJpeg).digest('hex'));
  assert.equal(coverJpeg.includes(Buffer.from('Private coordinates')),false);
  const decoded = jpeg.decode(coverJpeg);
  assert.deepEqual([decoded.width,decoded.height],[1080,600]);
  for (const coverImage of ['https://example.test/poster.jpg','data:image/png;base64,AAAA',jpegUri(100,600,1080),upload.slice(0,-3),upload+'A'.repeat(409601)]) {
    assert.throws(()=>coverUpdate({coverImage}),e=>e.status===400 && e.field==='coverImage');
  }
  assert.throws(()=>coverUpdate({coverAlt:'x'.repeat(241)}),e=>e.status===400 && e.field==='coverAlt');
});

test('public news and opportunity covers follow publication, versioned replacement, withdrawal and email claims through the live API handlers',async t=>{
  const db=createDatabase({filename:':memory:'});
  t.after(()=>db.close());
  const store=createNewsStore({db});
  const author=createUser(db,{fullName:'Editor',email:'editor@example.test',role:'admin',passwordHash:'unused'});
  const member=createUser(db,{fullName:'Reader',email:'reader@example.test',passwordHash:'unused'});
  await store.alerts.subscribe(member.id,true,'es');
  const cookie=createSession(db,author.id).cookie.split(';')[0];
  const server=createApp({db});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  const edit=async(path,method,data,expected)=>{
    const response=await fetch(base+path,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(data)});
    const payload=await response.json();
    assert.equal(response.status,expected,JSON.stringify(payload));
    return payload.item;
  };
  const read=(path,headers={},method='GET')=>fetch(base+path,{method,headers,redirect:'manual'});
  const expectFallback=async(path,headers={})=>{
    const response=await read(path,headers);
    assert.equal(response.status,302);
    assert.equal(response.headers.get('location'),'/assets/email/nodal-network-map-v1.png');
    assert.match(response.headers.get('cache-control'),/no-store/);
  };
  const dark=jpegUri(20),light=jpegUri(210);
  assert.ok(dark.length>32*1024,'ordinary 32 KiB JSON limit would prevent a cover upload');
  const draft=await edit('/api/admin/news','POST',{title:'Una plaza',coverImage:dark,coverAlt:'Vista de Lima'},201);
  assert.match(draft.coverUrl,new RegExp('^/api/publication-covers/news/'+draft.id+'/[a-f0-9]{64}\\.jpg$'));
  await expectFallback(draft.coverUrl);
  const adminRead=await read(draft.coverUrl,{Cookie:cookie});
  assert.equal(adminRead.status,200);
  assert.match(adminRead.headers.get('cache-control'),/private.*no-store/);
  assert.equal(adminRead.headers.get('cross-origin-resource-policy'),'same-origin');
  assert.ok((await adminRead.arrayBuffer()).byteLength);
  const postPath='/api/admin/news/'+draft.id;
  const published=await edit(postPath,'PATCH',{version:1,status:'published'},200);
  assert.equal(published.coverUrl,draft.coverUrl);
  const publicNews=(await (await read('/api/news/'+draft.id)).json()).item;
  assert.equal(publicNews.coverUrl,draft.coverUrl);
  assert.equal(publicNews.coverAlt,'Vista de Lima');
  assert.ok(!('coverJpeg' in publicNews) && !('coverImage' in publicNews));
  const img=await read(draft.coverUrl);
  assert.equal(img.status,200);
  assert.equal(img.headers.get('content-type'),'image/jpeg');
  assert.equal(img.headers.get('cross-origin-resource-policy'),'cross-origin');
  const bytes=Buffer.from(await img.arrayBuffer());
  assert.ok(draft.coverUrl.endsWith(createHash('sha256').update(bytes).digest('hex')+'.jpg'));
  const head=await read(draft.coverUrl,{},'HEAD');
  assert.equal(head.headers.get('content-length'),String(bytes.length));
  assert.equal((await head.arrayBuffer()).byteLength,0);
  await edit(postPath,'PATCH',{version:1,coverImage:light},409);
  const replaced=await edit(postPath,'PATCH',{version:2,coverImage:light,coverAlt:'La plaza'},200);
  assert.notEqual(replaced.coverUrl,draft.coverUrl);
  await expectFallback(draft.coverUrl);
  const newsJob=await store.alerts.claim();
  assert.equal(newsJob.cover_url,replaced.coverUrl);
  assert.equal(newsJob.cover_alt,'La plaza');
  const removed=await edit(postPath,'PATCH',{version:3,coverImage:null},200);
  assert.ok(!removed.coverUrl);
  await expectFallback(replaced.coverUrl);

  const translation={title:'Un taller',summary:'Un resumen',body:'Más detalles',cta:'Participar'};
  const opportunity={kind:'opportunity',subtype:'grant',status:'published',featured:true,visibility:'members',
    organization:'NODAL',sourceLabel:'Convocatoria',sourceUrl:'https://example.test/convocatoria',sourceVerifiedAt:'2030-01-01',
    deadlineAt:'2099-12-31',translations:{es:translation,en:translation,pt:translation}};
  const created=await edit('/api/admin/catalog','POST',{...opportunity,coverImage:light,coverAlt:'El cartel'},201);
  assert.ok(created.coverUrl.startsWith('/api/publication-covers/opportunity/'));
  await expectFallback(created.coverUrl);
  const catalogPath='/api/admin/catalog/'+created.id;
  const opened=await edit(catalogPath,'PATCH',{...opportunity,visibility:'public',version:1},200);
  assert.equal(opened.coverUrl,created.coverUrl);
  assert.equal((await read(created.coverUrl)).status,200);
  const opportunityJob=await store.alerts.claim();
  assert.equal(opportunityJob.cover_url,created.coverUrl);
  assert.equal(opportunityJob.cover_alt,'El cartel');
  const publicOpportunity=(await (await read('/api/catalog/'+created.id)).json()).item;
  assert.equal(publicOpportunity.coverUrl,created.coverUrl);
  await edit(catalogPath,'PATCH',{...opportunity,status:'archived',version:2},200);
  await expectFallback(created.coverUrl);
  const converted=await edit(catalogPath,'PATCH',{kind:'resource',status:'draft',version:3},200);
  assert.ok(!converted.coverUrl);
  assert.equal(db.prepare('SELECT cover_jpeg FROM catalog_items WHERE id=?').get(created.id).cover_jpeg,null);
});

test('Supabase resolves only the requested JPEG revision under the public visibility filters and reads no other column', async()=>{
  const calls=[];
  const admin={async rest(table,{query}){calls.push({table,query});return [{cover_jpeg:'\\xffd8ffd9'}];}};
  const id='11111111-2222-3333-4444-555555555555', revision='a'.repeat(64);
  for(const kind of ['news','opportunity']){
    const bytes=await readPublicationCover({admin},kind,id,revision,false);
    assert.equal(bytes.toString('hex'),'ffd8ffd9');
    assert.deepEqual(calls.at(-1),{table:kind==='news'?'nodal_news':'catalog_items',query:{
      select:'cover_jpeg',id:'eq.'+id,cover_revision:'eq.'+revision,limit:1,status:'eq.published',
      ...(kind==='opportunity' && {kind:'eq.opportunity',visibility:'eq.public'}),
    }});
  }
});
