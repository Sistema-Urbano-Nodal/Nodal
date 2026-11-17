import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

/* A PostgreSQL suite skips itself unless its NODAL_*_TEST_DATABASE_URL is set, and Vercel's build has no PostgreSQL, so
   CI is the only place it runs. Three suites (Founder acceptances, festival conversations, account erasure) skipped
   there for weeks because nobody added their database to the workflow. Each suite needs an empty database of its own. */
test('CI gives every PostgreSQL suite its own disposable database',()=>{
 const workflow=readFileSync(path.join(ROOT,'.github','workflows','ci.yml'),'utf8');
 const names=new Set();
 for(const file of readdirSync(path.join(ROOT,'tests')).filter(name=>name.endsWith('.test.js')))
  for(const [,name] of readFileSync(path.join(ROOT,'tests',file),'utf8').matchAll(/process\.env\.(NODAL_[A-Z_]+_TEST_DATABASE_URL)\b/g))names.add(name);
 assert.ok(names.has('NODAL_METRICS_TEST_DATABASE_URL')&&names.size>=8,'the scan finds the suites');
 const databases=new Map();
 for(const name of names){
  const url=workflow.match(new RegExp(`^\\s+${name}: (\\S+)$`,'m'))?.[1];
  assert.ok(url,`${name} is not set in ci.yml`);
  const database=new URL(url).pathname.slice(1);
  assert.match(workflow,new RegExp(`^\\s+CREATE DATABASE ${database} `,'m'),`${name}: ci.yml never creates ${database}`);
  assert.ok(!databases.has(database),`${name} and ${databases.get(database)} share ${database}`);
  databases.set(database,name);
 }
});
