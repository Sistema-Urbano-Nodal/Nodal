import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../server/server.js';
import {createDatabase,createUser,toApiUser} from '../server/db.js';
import {createSession} from '../server/auth.js';
const city={id:'Q49111',name:'Cambridge',label:'Cambridge, Massachusetts, United States',countryCode:'US',lat:42.375,lon:-71.106111111};
async function boot(t,options={}){
 const db=createDatabase({filename:':memory:'});t.after(()=>db.close());const user=createUser(db,{fullName:'Member',email:'location@example.test',passwordHash:'unused',city:'Old city'}),cookie=createSession(db,user.id).cookie.split(';')[0];
 const server=createApp({db,locationProvider:{suggest:async()=>({city,attribution:'GeoDB Cities'}),city:async()=>city},...options});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());const base=`http://127.0.0.1:${server.address().port}`;
 const call=(path,body,extra={})=>fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json',...extra},body:body?JSON.stringify(body):undefined});
 return {db,user,cookie,server,base,call};
}
test('location suggestion never saves; explicit acceptance atomically updates only city and center with CAS',async t=>{
 const {db,user,call}=await boot(t);const before=toApiUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id));
 assert.equal((await call('/api/me/location/suggest',{latitude:42.37,longitude:-71.11})).status,200);
 assert.deepEqual(toApiUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)),before);
 const accepted=await call('/api/me/location/accept',{cityId:'Q49111',expectedCity:'Old city',lat:0,lon:0,partC:{consent:true}});assert.equal(accepted.status,200);
 const saved=(await accepted.json()).user;assert.equal(saved.city,city.label);assert.deepEqual(saved.location,{lat:city.lat,lon:city.lon,label:city.label});assert.deepEqual(saved.partC,before.partC);
 assert.equal((await call('/api/me/location/accept',{cityId:'Q49111',expectedCity:'Old city'})).status,409);
 assert.equal((await call('/api/me/location/suggest',{latitude:'42',longitude:0})).status,400);
 assert.equal((await call('/api/me/location/suggest',{latitude:42,longitude:0},{Origin:'https://evil.test'})).status,403);
 assert.equal((await call('/api/me/location/suggest',{latitude:42,longitude:0},{Cookie:''})).status,401);
 assert.match((await call('/dashboard.html')).headers.get('permissions-policy'),/geolocation=\(self\)/);
 assert.match((await call('/')).headers.get('permissions-policy'),/geolocation=\(\)/);
});
test('slow manual geocoding cannot overwrite a newer accepted city and explicit stale city patches conflict',async t=>{
 let release,started;const wait=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{started=resolve;});
 const {call,base,cookie}=await boot(t,{citySearch:{search:async()=>{started();await wait;return{cities:[{lat:1,lon:2,label:'Slow'}]};}}});
 const patch=(body)=>fetch(base+'/api/me',{method:'PATCH',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const saving=patch({city:'Slow city',expectedCity:'Old city'});await ready;
 assert.equal((await call('/api/me/location/accept',{cityId:'Q49111',expectedCity:'Slow city'})).status,200);release();assert.equal((await saving).status,200);
 const me=(await(await call('/api/auth/me')).json()).user;assert.equal(me.city,city.label);assert.equal(me.location.lat,city.lat);
 assert.equal((await patch({city:'Stale city',expectedCity:'Old city',fullName:'Stale name'})).status,409);
 assert.equal((await(await call('/api/auth/me')).json()).user.fullName,'Member');
});

test('optional location requests have a per-account ceiling and reject coordinates in the route query',async t=>{
 const {call}=await boot(t);
 assert.equal((await call('/api/me/location/suggest?latitude=42',{latitude:42,longitude:-71})).status,400);
 for(let i=0;i<5;i++)assert.equal((await call('/api/me/location/suggest',{latitude:42,longitude:-71})).status,200);
 const limited=await call('/api/me/location/suggest',{latitude:42,longitude:-71});assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
});
