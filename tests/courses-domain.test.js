import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeAttachment} from '../server/courses-domain.js';

const png=Buffer.from([137,80,78,71,13,10,26,10,0,0]).toString('base64');
test('decodeAttachment keeps its course defaults and accepts narrower types and limits',()=>{
 assert.equal(decodeAttachment({name:'a.txt',mime:'text/plain',data:Buffer.from('hello').toString('base64')}).mime,'text/plain');
 assert.throws(()=>decodeAttachment({name:'a.txt',mime:'text/plain',data:Buffer.from('hello').toString('base64')},{types:['image/png']}),err=>err.status===400&&err.code==='file_type');
 assert.throws(()=>decodeAttachment({name:'a.png',mime:'image/png',data:png},{types:['image/png'],max:4}),err=>err.status===413&&err.code==='file_size');
 assert.equal(decodeAttachment({name:'a.png',mime:'image/png',data:png},{types:['image/png'],max:10}).size,10);
});
test('decodeAttachment keeps the course wording and statuses, and tags type and size refusals with a code',()=>{
 assert.throws(()=>decodeAttachment({name:'a.gif',mime:'image/gif',data:png}),err=>err.status===400&&err.code==='file_type'&&err.message==='unsupported file type: use JPG, PNG, WebP, PDF or text');
 assert.throws(()=>decodeAttachment({name:'a.png',mime:'image/png',data:'A'.repeat(Math.ceil(3*1024*1024/3)*4+4)}),err=>err.status===413&&err.code==='file_size'&&err.message==='file exceeds 3 MB');
 // A renamed HEIC sent as JPEG is a type problem for the person, so the client can translate it the same way.
 assert.throws(()=>decodeAttachment({name:'a.jpg',mime:'image/jpeg',data:png}),err=>err.status===400&&err.code==='file_type'&&err.message==='file content does not match its type');
 assert.equal(decodeAttachment({name:'a.png',mime:'image/png',data:png},{types:['image/png'],max:100*1024}).name,'a.png','a narrower limit still accepts files under it');
});
