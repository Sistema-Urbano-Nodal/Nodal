import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {LIMIT_VARIABLES} from './setup/clear-limits.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=promisify(execFile);

test('the test preload clears every limit the server reads with envInt, and nothing else',()=>{
 const read=new Set();
 for(const dir of ['server','api'])for(const file of readdirSync(path.join(ROOT,dir)).filter(name=>name.endsWith('.js')))
  for(const [,name] of readFileSync(path.join(ROOT,dir,file),'utf8').matchAll(/\benvInt\(\s*'([A-Z0-9_]+)'/g))read.add(name);
 assert.ok(read.has('AUTH_IP_RATE_LIMIT')&&read.has('NETWORK_RATE_LIMIT'),'the scan finds the limits');
 assert.deepEqual([...LIMIT_VARIABLES].sort(),[...read].sort());
});

/* Vercel runs `npm run build`, and so `npm test`, with the project's variables. A limit raised there must not reach a
   test: run the package's own test command on a probe file with two limits set, and the probe must see neither. */
test('npm test hands every test file the default limits even when the deployment sets them',async t=>{
 const script=JSON.parse(readFileSync(path.join(ROOT,'package.json'),'utf8')).scripts.test;
 const args=script.split(/\s+/);
 assert.equal(args[0],'node');assert.ok(args.includes('tests/*.test.js'),script);
 const dir=mkdtempSync(path.join(tmpdir(),'nodal-limits-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const probe=path.join(dir,'probe.test.js');
 writeFileSync(probe,`import test from 'node:test';import assert from 'node:assert/strict';
test('limits',()=>{assert.equal(process.env.AUTH_IP_RATE_LIMIT,undefined);assert.equal(process.env.NETWORK_RATE_LIMIT,undefined);assert.equal(process.env.UNRELATED_SETTING,'kept');});\n`);
 const env={...process.env,AUTH_IP_RATE_LIMIT:'1000',NETWORK_RATE_LIMIT:'3',UNRELATED_SETTING:'kept'};
 delete env.NODE_TEST_CONTEXT;
 const result=await run(process.execPath,args.slice(1).map(arg=>arg==='tests/*.test.js'?probe:arg),{cwd:ROOT,env}).catch(err=>err);
 assert.equal(result.code??0,0,String(result.stdout));
 assert.match(String(result.stdout),/# pass 1\b/);
});
