import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>readFileSync(path.join(ROOT,file),'utf8');

/* Vercel's `npm run build` runs the suite with Vercel's variables and the project's Production settings, and only a
   passing build deploys. CI's vercel-env job runs the same build with stand-ins for them, so a test that relies on one
   being unset fails in CI first (3 Oct 2026: the forwarded-header test passed CI and failed the Vercel build). */
test('CI runs the build once more with stand-ins for every Vercel Production setting, and none of them is real',()=>{
 const lines=read('.github/workflows/ci.yml').split('\n'),start=lines.indexOf('  vercel-env:');
 assert.ok(start>0,'ci.yml has a vercel-env job');
 let end=start+1;while(end<lines.length&&(lines[end]===''||lines[end].startsWith('    ')))end++;
 const job=lines.slice(start,end).join('\n');
 assert.match(job,/^ {8}run: npm run build$/m);
 const env=new Map([...job.matchAll(/^ {10}([A-Z][A-Z0-9_]*): (.+)$/gm)].map(([,name,value])=>[name,value.replace(/^'(.*)'$/,'$1')]));
 assert.equal(env.get('VERCEL'),'1');assert.equal(env.get('VERCEL_ENV'),'production');
 // Every documented Production setting, with the documented value where it is a plain word; mail as well.
 const documented=read('DEPLOYMENT.md').match(/^## Vercel Environment Variables\n[\s\S]*?```text\n([\s\S]*?)```/m)?.[1];
 assert.ok(documented,'DEPLOYMENT.md lists the Vercel Production settings');
 for(const [,name,value] of documented.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)){
  assert.ok(env.has(name),`the vercel-env job does not set ${name}`);
  if(/^[a-z]+$/.test(value))assert.equal(env.get(name),value,name);
 }
 for(const name of ['EMAIL_SMTP_URL','EMAIL_FROM','PUBLIC_BASE_URL'])assert.ok(env.has(name),name);
 // No secret, and nothing the suite could reach: each server and address is on a .invalid name.
 assert.doesNotMatch(job,/secrets\./);
 assert.ok(![...env.keys()].some(name=>/_TEST_DATABASE_URL$/.test(name)),'no PostgreSQL, as on Vercel');
 for(const [name,value] of env){
  if(name.startsWith('MERCADOPAGO_LINK_')){assert.match(new URL(value).hostname,/^(?:mpago\.la|(?:[a-z0-9-]+\.)*mercadopago\.com\.pe)$/,name);continue;}
  if(!/(?:URL|EMAIL|FROM)$/.test(name))continue;
  const host=/^[a-z]+:\/\//.test(value)?new URL(value).hostname:value.includes('@')?value.split('@').pop().replace(/>$/,''):value;
  assert.match(host,/\.invalid$/,`${name} must not name a real host`);
 }
});
