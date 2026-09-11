import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {staticSourcePath} from '../server/server.js';

const ROOT=path.resolve(import.meta.dirname,'..');
const pages=()=>readdirSync(path.join(ROOT,'web/pages')).filter(name=>name.endsWith('.html')).map(name=>[name,readFileSync(path.join(ROOT,'web/pages',name),'utf8')]);

test('startup scripts are discovered in the head and execute after parsing in dependency order',()=>{
  for(const [name,html] of pages()){
    const headEnd=html.indexOf('</head>');
    const scripts=[...html.matchAll(/<script\b([^>]*\bsrc="([^"]+)"[^>]*)><\/script>/g)];
    for(const script of scripts){
      assert.ok(script.index<headEnd,`${name}: ${script[2]} must be discovered in the head`);
      if(name==='accept-invitation.html'&&script[2].startsWith('accept-invitation.js')){
        assert.doesNotMatch(script[1],/\b(?:defer|async)\b/,'invitation tokens must be removed before other resources');
        assert.ok(script.index<html.indexOf('<link'),'invitation capture must remain before resource links');
      }else{
        assert.match(script[1],/\bdefer\b/,`${name}: ${script[2]} must wait for the parsed DOM`);
        assert.doesNotMatch(script[1],/\basync\b/,`${name}: dependencies require deterministic execution`);
      }
    }
    const files=scripts.map(script=>script[2].split('?')[0]);
    const before=(first,second)=>{if(files.includes(second))assert.ok(files.indexOf(first)>=0&&files.indexOf(first)<files.indexOf(second),`${name}: ${first} must precede ${second}`);};
    before('pilot-i18n.js','pilot.js');before('pilot.js','courses.js');before('pilot.js','teaching.js');
    for(const file of ['app.js','recs.js','dashboard.js','globe.js'])before('i18n.js',file);
    before('i18n.js','auth.js');before('recovery-i18n.js','password-recovery.js');
    before('coastline.js','globe.js');before('globe-geo.js','globe.js');
    if(name==='dashboard.html'){before('location-check.js','dashboard.js');before('dashboard.js','coastline.js');}
  }
});

test('Montserrat is available locally before first use, with no external font stylesheet',()=>{
  for(const [name,html] of pages()){
    assert.doesNotMatch(html,/fonts\.(?:googleapis|gstatic)\.com/,`${name}: fonts must load from this origin`);
    assert.match(html,/<link\b[^>]*href="fonts\.css(?:\?[^\"]*)?"[^>]*>/,`${name}: local font stylesheet is required`);
    assert.match(html,/<link\b[^>]*rel="preload"[^>]*href="assets\/fonts\/montserrat-v31-latin-normal\.woff2"[^>]*as="font"[^>]*crossorigin/,`${name}: preload must use the same anonymous font request`);
    assert.match(html,/font-src 'self'/,`${name}: page CSP must permit local fonts`);
  }
  const css=readFileSync(path.join(ROOT,'web/styles/fonts.css'),'utf8');
  const urls=[...css.matchAll(/url\(['"]?(\/assets\/fonts\/[^)'" ]+)['"]?\)/g)].map(match=>match[1]);
  assert.equal(new Set(urls).size,4,'normal and italic each have Latin and Latin-ext subsets');
  assert.equal((css.match(/font-weight:\s*100 900/g)||[]).length,4,'all faces preserve variable weights including 650');
  assert.equal((css.match(/font-display:\s*swap/g)||[]).length,4);
  assert.match(css,/U\+0*000-00FF/i,'Latin includes Portuguese and Spanish accents');
  assert.match(css,/U\+0100-02BA/i,'extended Latin coverage remains available');
  const build=readFileSync(path.join(ROOT,'scripts/build-static.js'),'utf8');
  const config=JSON.parse(readFileSync(path.join(ROOT,'vercel.json'),'utf8'));
  for(const url of ['/fonts.css',...urls]){
    const file=staticSourcePath(url);
    assert.ok(file,`${url} must be served by the application`);
    const data=readFileSync(file);
    if(url.endsWith('.woff2'))assert.equal(data.subarray(0,4).toString(),'wOF2',`${url} must be a WOFF2 font`);
    assert.ok(build.includes(path.basename(url)),`${url} must be included in the static build`);
    assert.ok(config.headers.some(route=>new RegExp(`^${route.source}$`).test(url)),`${url} must have deployment cache headers`);
  }
  assert.match(readFileSync(path.join(ROOT,'web/assets/fonts/OFL.txt'),'utf8'),/SIL OPEN FONT LICENSE/);
});

test('pilot pages reserve a single banner in the initial HTML without adding one to the public home',()=>{
  for(const [name,html] of pages()){
    const hasPilot=/<script\b[^>]*src="pilot\.js[?"]/.test(html);
    assert.equal((html.match(/data-pilot-banner/g)||[]).length,hasPilot?1:0,name);
    if(!hasPilot)continue;
    assert.match(html,/<div class="pilot-notice" data-pilot-banner hidden>/,`${name}: server decides initial banner visibility`);
    if(name==='dashboard.html')assert.match(html,/<main class="work"[^>]*>\s*<div class="pilot-notice" data-pilot-banner/);
    else if(name==='admin.html')assert.match(html,/<body[^>]*>\s*<div class="pilot-notice" data-pilot-banner/);
    else assert.match(html,/<\/header>\s*<div class="pilot-notice" data-pilot-banner/,name);
  }
});
