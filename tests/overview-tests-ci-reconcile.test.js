import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {reconcileSource} from '../scripts/reconcile-course-uploads.js';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=promisify(execFile);

/* `npm run uploads:reconcile` in a shell without the production variables reads (and creates) a local SQLite file
   and finds nothing. Its report must say which data it read, so nobody takes that for production's answer. */
test('uploads:reconcile names the backend it read, and says when it is a local SQLite file rather than production',async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'nodal-reconcile-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const database=path.join(dir,'nodal.sqlite');
 // Only what the command needs: none of the deployment's variables (a Vercel-like build sets VERCEL=1).
 const {stdout,stderr}=await run(process.execPath,[path.join(ROOT,'scripts','reconcile-course-uploads.js')],{cwd:ROOT,env:{PATH:process.env.PATH,DATABASE_PATH:database}});
 const report=JSON.parse(stdout);
 assert.equal(report.backend,'sqlite');assert.equal(report.database,database);
 assert.deepEqual([report.examined,report.stale,report.orphaned,report.dryRun],[0,0,0,true]);
 assert.deepEqual(report.certificates,{pending:0,pendingRemoved:0,deleting:0,deletingRemoved:0,dryRun:true});
 assert.match(stderr,/local SQLite file/);assert.match(stderr,/not production/);
 for(const name of ['DATA_BACKEND=supabase','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY'])assert.ok(stderr.includes(name),name);
});

test('uploads:reconcile reads Supabase as the server does, and reports its host without any key',()=>{
 const env={NEXT_PUBLIC_SUPABASE_URL:'https://project-ref.supabase.co/',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SECRET_KEY:'sb_secret_test'};
 assert.deepEqual(reconcileSource({...env,DATA_BACKEND:'supabase'}),{backend:'supabase',host:'project-ref.supabase.co'});
 assert.deepEqual(reconcileSource({...env,VERCEL:'1'}),{backend:'supabase',host:'project-ref.supabase.co'});
 assert.deepEqual(reconcileSource({DATABASE_PATH:'/srv/nodal/nodal.sqlite'}),{backend:'sqlite',database:'/srv/nodal/nodal.sqlite'});
 assert.deepEqual(reconcileSource({}),{backend:'sqlite',database:path.join(ROOT,'data','nodal.sqlite')});
 assert.throws(()=>reconcileSource({DATA_BACKEND:'supabase'}),/NEXT_PUBLIC_SUPABASE_URL is required/);
});
