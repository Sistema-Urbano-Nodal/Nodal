/* The Create account hint gives the whole rule the form enforces: auth.js and the server refuse a password under 8
   characters or over 72 bytes of UTF-8. It says so in the words the invitation and reset pages already use, in English
   (the markup), Spanish and Portuguese, so a long passphrase with accents is not refused by a rule nobody mentioned. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
// The shared dictionaries as the sign-in page has them, read through nodalI18n.t.
function shared(lang){
 const context={document:{body:{dataset:{}},documentElement:{},querySelectorAll:()=>[]},window:{location:{search:''}},localStorage:{getItem(){return null;},setItem(){}},URLSearchParams,console};
 vm.runInNewContext(read('web/scripts/i18n.js'),context);const api=context.window.nodalI18n;api.apply(lang,{persist:false});return api;
}
function invitation(){const context={window:{},document:{documentElement:{},querySelectorAll:()=>[],querySelector:()=>null},localStorage:{getItem:()=>null,setItem(){}}};vm.runInNewContext(read('web/scripts/invitation-i18n.js'),context);return context.window.nodalInvitationI18n.rows;}

test('the sign-up hint gives the 8–72 character rule the form enforces, as the invitation page words it',()=>{
 const hint=read('web/pages/login.html').match(/<p class="auth-hint" id="signupHint" data-i18n="a\.hint">([^<]*)<\/p>/)?.[1];
 const texts=[hint,shared('es').t('a.hint'),shared('pt').t('a.hint')];
 assert.deepEqual(texts,[
  'Use 8–72 characters (fewer with accents or emoji). Your password is protected before storage.',
  'Usa entre 8 y 72 caracteres (menos con tildes o emojis). Tu contraseña se protege antes de guardarse.',
  'Use entre 8 e 72 caracteres (menos com acentos ou emojis). Sua senha é protegida antes de ser armazenada.',
 ]);
 // The first sentence is the invitation page's password note, word for word, in each language.
 const note=invitation().passwordNote;
 texts.forEach((text,i)=>assert.ok(note[i].startsWith(text.slice(0,text.indexOf('.')+1)),note[i]));
});
