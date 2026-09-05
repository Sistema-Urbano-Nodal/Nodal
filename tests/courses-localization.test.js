import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDatabase} from '../server/db.js';
import {createCourseStore} from '../server/courses-repository.js';
import {normalizeCourse,normalizeModule} from '../server/courses-domain.js';
import {setupCoursePilot} from '../scripts/setup-course-pilot.js';

test('course and module translations retain base fallbacks and validate their allowed locale fields',()=>{
  const course=normalizeCourse({title:'Base course',translations:{pt:{title:' Curso ',description:'Descrição'},en:{title:'Course'}}});
  assert.equal(course.title,'Base course');
  assert.deepEqual(course.translations,{pt:{title:'Curso',description:'Descrição'},en:{title:'Course'}});
  assert.deepEqual(normalizeCourse({description:'Edited'},course).translations,course.translations);
  assert.deepEqual(normalizeCourse({title:'Base'}).translations,{});
  const module=normalizeModule({title:'Base session',translations:{pt:{title:'Sessão',objectives:'Observar',instructions:'Registrar'}},resources:[{title:'Slides',url:'https://example.test/slides',translations:{pt:{title:'Apresentação'}}}]});
  assert.equal(module.translations.pt.instructions,'Registrar');
  assert.equal(module.resources[0].translations.pt.title,'Apresentação');
  for(const translations of [null,[],{fr:{title:'Cours'}},{pt:{url:'https://example.test'}},{pt:{title:7}},{pt:{description:'a'.repeat(6001)}},{pt:'Curso'}])assert.throws(()=>normalizeCourse({title:'Course',translations}));
  assert.throws(()=>normalizeModule({title:'Module',translations:{en:{instructions:'a'.repeat(10001)}}}));
  assert.throws(()=>normalizeModule({title:'Module',resources:[{title:'Slides',url:'https://example.test/slides',translations:{pt:{url:'https://evil.test'}}}]}));
});

test('SQLite upgrades existing course tables without losing staff edits and persists localized content',async t=>{
  const db=createDatabase({filename:':memory:'});t.after(()=>db.close());
  createCourseStore({db});
  // Simulate the deployed pre-localization course schema without reproducing its DDL.
  for(const table of ['pilot_courses','course_modules'])if(db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name==='translations'))db.exec(`ALTER TABLE ${table} DROP COLUMN translations`);
  const stamp=new Date().toISOString(),id=randomUUID();
  db.prepare("INSERT INTO pilot_courses (id,title,description,status,created_at,updated_at) VALUES (?,?,'Staff description','draft',?,?)").run(id,'Staff course',stamp,stamp);
  const store=createCourseStore({db});
  const old=(await store.find('courses',{id}))[0];assert.equal(old.title,'Staff course');assert.deepEqual(old.translations,{});
  const saved=await store.update('courses',{id},{translations:{pt:{title:'Curso da equipe'}}});
  assert.equal(saved.translations.pt.title,'Curso da equipe');
  const module=await store.insert('modules',{id:randomUUID(),courseId:id,...normalizeModule({title:'Session',translations:{en:{instructions:'Observe'},pt:{instructions:'Observe o local'}}}),version:1,createdAt:stamp,updatedAt:stamp});
  assert.equal(module.translations.pt.instructions,'Observe o local');
  createCourseStore({db});assert.equal((await store.find('courses',{id}))[0].description,'Staff description');
});

test('Supabase course adapter sends and reads translation objects without JSON stringifying them',async()=>{
  const store=createCourseStore({clients:{admin:{rest:async(_table,{body})=>[{...body,id:'localized-module'}]}}});
  const module=await store.insert('modules',normalizeModule({title:'Session',translations:{pt:{title:'Sessão'}},resources:[{title:'Reading',url:'https://example.test/read',translations:{es:{title:'Lectura'}}}]}));
  assert.deepEqual(module.translations,{pt:{title:'Sessão'}});
  assert.equal(module.resources[0].translations.es.title,'Lectura');
});

test('pilot setup localizes the supplied shell and enriches legacy rows without replacing staff content',async t=>{
  const db=createDatabase({filename:':memory:'});t.after(()=>db.close());const store=createCourseStore({db});
  let course=await setupCoursePilot(store);
  assert.equal(course.translations.pt.title,'Curso de Mobilidade Nível 2');
  assert.equal(course.translations.en.title,'Mobility Level 2 Course');
  const modules=await store.find('modules',{courseId:course.id},{order:['position','id']});
  assert.deepEqual(modules.map(m=>m.translations.pt.title),['Sessão 1','Sessão 2','Sessão 3','Sessão 4']);
  // Existing untranslated defaults can be enriched; staff changes and explicit overrides cannot.
  await store.update('courses',{id:course.id},{title:'Staff custom title',translations:{pt:{description:'Descrição da equipe'}}});
  await store.update('modules',{id:modules[0].id},{title:'Staff session',translations:{}});
  await store.update('modules',{id:modules[1].id},{translations:{pt:{title:'Sessão da equipe'}}});
  await store.update('modules',{id:modules[2].id},{translations:{}});
  course=await setupCoursePilot(store);
  assert.equal(course.title,'Staff custom title');
  assert.equal(course.translations.pt.description,'Descrição da equipe');
  assert.equal(course.translations.en.title,undefined);
  assert.deepEqual((await store.find('modules',{id:modules[0].id}))[0].translations,{});
  assert.equal((await store.find('modules',{id:modules[1].id}))[0].translations.pt.title,'Sessão da equipe');
  assert.equal((await store.find('modules',{id:modules[2].id}))[0].translations.en.title,'Session 3');
  const before=(await store.find('modules',{id:modules[2].id}))[0].version;
  await setupCoursePilot(store);assert.equal((await store.find('modules',{id:modules[2].id}))[0].version,before);
});
