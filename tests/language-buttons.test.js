import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,readdirSync} from 'node:fs';

// WCAG 2.5.3 (Label in Name): a speech-input user says the code a language button shows ("PT"), so the button's name
// starts with that code and then names the language in its own words for a screen reader.
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const languageButtons=html=>[...html.matchAll(/<button\b([^>]*\bdata-lang="(?:en|es|pt)"[^>]*)>([^<]*)<\/button>/g)]
 .map(([,attributes,shown])=>({shown:shown.trim(),name:/\baria-label="([^"]*)"/.exec(attributes)?.[1],pilot:/\bdata-pilot-aria="([^"]*)"/.exec(attributes)?.[1]}));

test('the landing page names each language button starting with the code it shows', () => {
 const buttons=languageButtons(read('web/pages/index.html')).map(({shown,name})=>[shown,name]);
 assert.deepEqual(buttons,[['EN','EN, English'],['ES','ES, Español'],['PT','PT, Português']]);
 for(const [shown,name] of buttons)assert.ok(name.startsWith(`${shown}, `),`${shown}: its name starts with what it shows`);
});

test('every page, and the privacy page builder, names its language buttons starting with the code they show', () => {
 const sources=[...readdirSync(new URL('../web/pages/',import.meta.url)).filter(name=>name.endsWith('.html')).map(name=>`web/pages/${name}`),'scripts/build-privacy-page.js'];
 let checked=0;
 for(const source of sources){
  const buttons=languageButtons(read(source));
  if(!buttons.length)continue;
  assert.deepEqual(buttons.map(({shown})=>shown),['EN','ES','PT'],`${source}: one button per language`);
  for(const {shown,name} of buttons){assert.ok(name?.startsWith(`${shown}, `),`${source} ${shown}: "${name}" starts with what it shows`);checked++;}
 }
 assert.ok(checked>=60,`the language buttons were found (${checked})`);
});

test('the course pages rename their language buttons in every language without losing the code they show', () => {
 const pilot={window:{}};vm.runInNewContext(read('web/scripts/pilot-i18n.js'),pilot);
 const {rows}=pilot.window.pilotI18n;
 const pages=['web/pages/course.html','web/pages/courses.html','web/pages/teaching.html'];
 for(const page of pages){
  const buttons=languageButtons(read(page));
  assert.equal(buttons.length,3,`${page}: three language buttons`);
  for(const {shown,pilot:key} of buttons){
   assert.equal(rows[key]?.length,3,`${page} ${shown}: ${key} is translated in three languages`);
   for(const name of rows[key])assert.ok(name.startsWith(`${shown}, `),`${page} ${shown}: "${name}" starts with what it shows`);
  }
 }
});
