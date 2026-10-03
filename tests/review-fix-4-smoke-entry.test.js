import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// email-qr-scripts-5: the least-privilege smoke compared import.meta.url (percent-encoded, symlink-resolved) with a raw
// `file://${argv[1]}`, so from a checkout path with a space, or through a symlink, it never ran and exited 0. Every
// copy here runs with no Supabase settings and no network: the check must start and fail on the missing URL.
const run=file=>new Promise(resolve=>execFile(process.execPath,[file],{env:{PATH:process.env.PATH??''},timeout:20000},(error,stdout,stderr)=>resolve({code:error?.code??0,stdout,stderr})));

test('the Supabase Data API smoke check runs when started from a path with spaces or through a symlink',async t=>{
 const root=mkdtempSync(join(tmpdir(),'nodal smoke '));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const source=new URL('../scripts/smoke-supabase-data-api.js',import.meta.url);
 for(const dir of ['plain','with space','percent%20name','acentuação']){mkdirSync(join(root,dir));copyFileSync(source,join(root,dir,'smoke.js'));}
 symlinkSync(join(root,'with space'),join(root,'linked'));
 for(const file of [join(root,'plain','smoke.js'),join(root,'with space','smoke.js'),join(root,'percent%20name','smoke.js'),join(root,'acentuação','smoke.js'),join(root,'linked','smoke.js')]){
  const result=await run(file);
  assert.equal(result.code,1,file);assert.equal(result.stderr.trim(),'NEXT_PUBLIC_SUPABASE_URL is required',file);
 }
});

test('importing the smoke check runs nothing',async()=>{
 const module=await import('../scripts/smoke-supabase-data-api.js');assert.equal(typeof module.run,'function');
});
