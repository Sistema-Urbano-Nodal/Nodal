import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDatabase,createUser,updateUserProfile,getUserById,toApiUser,cleanProfileList} from '../server/db.js';
import {createSession} from '../server/auth.js';
import {createApp} from '../server/server.js';

const long=n=>'x'.repeat(n);

// catalog-news-payments-6: interests, availability slots and skills had a count cap but no length cap per item, so a
// member could park ~27,600 characters of "interests" that every other member then downloaded from the directory.
test('profile lists keep their counts, cap each item at 80 characters and drop blank, repeated and non-text items',()=>{
 const db=createDatabase({filename:':memory:'});
 try{
  const user=createUser(db,{fullName:'Ana',email:'ana@example.test',passwordHash:'unused'});
  updateUserProfile(db,user.id,{interests:[...Array.from({length:14},(_,i)=>`${i}`+long(2300)),'water'],active:[' pm ','pm','',long(500),{slot:'am'},'am','sat','sun','mon','tue'],skills:[long(300),{name:'GIS'},'GIS',' GIS ',null,7]});
  const saved=toApiUser(getUserById(db,user.id));
  assert.equal(saved.interests.length,12);assert.ok(saved.interests.every(item=>item.length===80));
  assert.deepEqual(saved.active,['pm',long(80),'am','sat','sun','mon']);
  assert.deepEqual(saved.skills,[long(80),'GIS','7']);
  const stored=getUserById(db,user.id);assert.ok(stored.interests_json.length<12*90,'the stored row is capped too');
  // Rows written before the cap are served capped.
  db.prepare('UPDATE users SET interests_json=?,active_json=?,skills_json=? WHERE id=?').run(JSON.stringify(Array(20).fill(0).map((_,i)=>i+long(5000))),JSON.stringify([long(900)]),JSON.stringify([{legacy:true},long(120)]),user.id);
  const legacy=toApiUser(getUserById(db,user.id));
  assert.equal(legacy.interests.length,12);assert.ok(legacy.interests.every(item=>item.length===80));assert.deepEqual(legacy.active,[long(80)]);assert.deepEqual(legacy.skills,[long(80)]);
  // Ordinary values are untouched.
  updateUserProfile(db,user.id,{interests:['water','public space'],active:['pm'],skills:['GIS']});
  const plain=toApiUser(getUserById(db,user.id));assert.deepEqual([plain.interests,plain.active,plain.skills],[['water','public space'],['pm'],['GIS']]);
  assert.deepEqual(cleanProfileList('water',12),[]);
 }finally{db.close();}
});

test('end to end: another member reads at most 80 characters per interest through the directory',async t=>{
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
 const server=createApp({db});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`,cookies={},users={};
 for(const name of ['author','reader']){users[name]=createUser(db,{fullName:name,email:`${name}@example.test`,passwordHash:'unused'});cookies[name]=createSession(db,users[name].id).cookie.split(';')[0];}
 const call=(actor,path,method='GET',body)=>fetch(base+path,{method,headers:{Cookie:cookies[actor],Origin:base,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const patch=await call('author','/api/me','PATCH',{partC:{consent:true},interests:Array.from({length:12},(_,i)=>`${i}`+long(2300))});assert.equal(patch.status,200);
 const author=(await(await call('reader','/api/users')).json()).users.find(user=>user.id===users.author.id);assert.ok(author,'the author is listed');
 assert.equal(author.interests.length,12);assert.ok(author.interests.every(item=>item.length===80));
 const profile=await call('reader',`/api/users/${users.author.id}`);assert.equal(profile.status,200);
 const {user}=await profile.json();assert.equal(user.interests.length,12);assert.ok(user.interests.every(item=>item.length===80));
});
