import test from 'node:test';
import assert from 'node:assert/strict';
import {createObjectStorage} from '../server/object-storage.js';

test('object storage puts, gets and removes inside one bucket with the server key and encoded paths',async()=>{
 const calls=[];const fetchImpl=async(url,init)=>{calls.push({url,init});return {ok:true,arrayBuffer:async()=>new TextEncoder().encode('hi').buffer};};
 const storage=createObjectStorage({env:{url:'https://p.supabase.co',serverKey:'service-key'},fetchImpl,bucket:'course-attachments'});
 await storage.put('fiiu/u 1/f#1','image/jpeg',Buffer.from('x'));
 assert.equal(calls[0].url,'https://p.supabase.co/storage/v1/object/course-attachments/fiiu/u%201/f%231');
 assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.headers['x-upsert'],'false');assert.equal(calls[0].init.headers.Authorization,'Bearer service-key');
 assert.equal((await storage.get('fiiu/u/f')).toString(),'hi');
 await storage.remove(['fiiu/u/f','fiiu/u/f.thumb']);
 assert.equal(calls[2].url,'https://p.supabase.co/storage/v1/object/course-attachments');assert.deepEqual(JSON.parse(calls[2].init.body),{prefixes:['fiiu/u/f','fiiu/u/f.thumb']});
});
test('object storage reports provider failures as 502 without leaking the provider text',async()=>{
 const storage=createObjectStorage({env:{url:'https://p',serverKey:'k'},fetchImpl:async()=>({ok:false,status:500}),bucket:'b'});
 await assert.rejects(storage.put('a','image/png',Buffer.from('x')),err=>err.status===502&&err.message==='attachment storage unavailable');
 await assert.rejects(storage.remove(['a']),err=>err.status===502&&err.message==='attachment cleanup unavailable');
});
