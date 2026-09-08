import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocationProvider,validatePosition} from '../server/location.js';
const cambridge={id:3204,wikiDataId:'Q49111',type:'CITY',city:'Cambridge',region:'Massachusetts',country:'United States',countryCode:'US',latitude:42.375,longitude:-71.106111111};
test('nearby lookup uses rounded coordinates, preserves zeroes and never caches positions',async()=>{
 const calls=[];const provider=createLocationProvider({minIntervalMs:0,fetchImpl:async(url,args)=>{calls.push({url:new URL(url),args});return new Response(JSON.stringify({data:[cambridge]}));}});
 for(let i=0;i<2;i++)assert.equal((await provider.suggest({latitude:42.374321,longitude:-71.112341})).city.id,'Q49111');
 assert.equal(calls.length,2);assert.match(decodeURIComponent(calls[0].url.pathname),/\/locations\/\+42\.37-071\.11\/nearbyCities$/);
 assert.equal(calls[0].url.searchParams.get('distanceUnit'),'KM');assert.equal(calls[0].url.searchParams.has('sort'),false);assert.ok(calls[0].args.signal);
 assert.deepEqual(validatePosition({latitude:0,longitude:0}),{latitude:0,longitude:0});
 for(const input of [{latitude:'1',longitude:2},{latitude:91,longitude:0},{latitude:0,longitude:-181},{latitude:NaN,longitude:0},{latitude:1,longitude:2,accuracy:-1},{latitude:1,longitude:2,accuracyMeters:10001},{latitude:1,longitude:2,accuracyMeters:'5'},null])assert.throws(()=>validatePosition(input),{status:400});
});
test('trusted city details are ID-bound, bounded and public-only cached with valid zero coordinates',async()=>{
 let calls=0;const provider=createLocationProvider({minIntervalMs:0,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({data:{...cambridge,latitude:0,longitude:0}}));}});
 const city=await provider.city('Q49111');assert.equal(city.lat,0);assert.equal(city.lon,0);assert.equal((await provider.city('Q49111')).label,city.label);assert.equal(calls,1);
 for(const id of ['../users','Q1?x=1','0','Q0'])await assert.rejects(provider.city(id),{status:400});
 await assert.rejects(provider.city('Q42'),{status:503});
 const unavailable=createLocationProvider({minIntervalMs:0,fetchImpl:async()=>new Response('{}',{status:429})});await assert.rejects(unavailable.suggest({latitude:1,longitude:2}),{status:503});
 const empty=createLocationProvider({minIntervalMs:0,fetchImpl:async()=>new Response('{"data":[]}')});assert.equal((await empty.suggest({latitude:1,longitude:2})).city,null);
});
