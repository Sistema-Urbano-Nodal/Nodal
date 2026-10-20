/* The payments page for the annual Supporting membership, paid on Mercado Pago through the links the team sets
   (docs/superpowers/specs/2026-10-20-mercadopago-payment-links-design.md). */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Node,descendants} from './helpers/fiiu-ui-harness.js';

const script=readFileSync(new URL('../web/scripts/payments.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../web/pages/payments.html',import.meta.url),'utf8');
const dictionaries=readFileSync(new URL('../web/scripts/i18n-dashboard.js',import.meta.url),'utf8');
const flush=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));};
const ONCE='https://link.mercadopago.com.pe/nodal',TWICE='https://www.mercadopago.com.pe/subscriptions/checkout?preapproval_plan_id=2c938084';
const OPEN={checkout:true,provider:'mercadopago',annual:{amount:'S/ 240',per:'/ year'},options:[{id:'once',url:ONCE,amount:'S/ 240'},{id:'installments',url:TWICE,amount:'2 × S/ 120'}]};

async function page({config=OPEN,me={user:{email:'ana@example.test'}},configFails=false}={}){
 const nodes=Object.fromEntries(['proPrice','proPer','payOptions','paySoon','payEmail','payEmailStep'].map(id=>[id,Object.assign(new Node(id==='payOptions'?'div':'span'),{id})]));
 const listeners=[],i18n={lang:'en',t:key=>`${i18n.lang}:${key}`,onChange:listener=>listeners.push(listener)};
 const context={window:{nodalI18n:i18n},URL,
  document:{getElementById:id=>nodes[id]??null,createElement:tag=>new Node(tag)},
  fetch:async path=>{
   if(path==='/api/billing/config'){if(configFails)throw TypeError('Failed to fetch');return{ok:true,status:200,json:async()=>config};}
   if(path==='/api/auth/me')return me?{ok:true,status:200,json:async()=>me}:{ok:false,status:401,json:async()=>({error:'sign in required'})};
   throw Error('unexpected request '+path);
  }};
 vm.createContext(context);vm.runInContext(script,context);await flush();
 return{nodes,lang:lang=>{i18n.lang=lang;listeners.forEach(listener=>listener());},buttons:()=>nodes.payOptions.children};
}
const textOf=node=>[node.textContent,...descendants(node).map(child=>child.textContent)].join(' ');

test('each offered Mercado Pago link becomes a button that opens it in a new tab, beside the year’s price',async()=>{
 const p=await page();
 assert.equal(p.nodes.proPrice.textContent,'S/ 240');assert.equal(p.nodes.proPer.textContent,'en:y.perYear');
 assert.deepEqual(p.buttons().map(a=>[a.tagName,a.href,a.target,a.rel,a.dataset.option]),[['a',ONCE,'_blank','noopener noreferrer','once'],['a',TWICE,'_blank','noopener noreferrer','installments']]);
 assert.deepEqual(p.buttons().map(a=>a.className),['btn btn-primary','btn btn-ghost'],'paying the year is the main choice');
 assert.match(textOf(p.buttons()[0]),/en:y\.mp\.payOnce .*S\/ 240/);assert.match(textOf(p.buttons()[1]),/en:y\.mp\.payInstallments .*2 × S\/ 120/);
 assert.equal(p.nodes.paySoon.hidden,true);
 // The language follows a switch, the operator's amounts do not change.
 p.lang('es');assert.match(textOf(p.buttons()[1]),/es:y\.mp\.payInstallments .*2 × S\/ 120/);assert.equal(p.nodes.proPer.textContent,'es:y.perYear');
});

test('with nothing offered, or no answer from the server, the price says Soon and no button leads anywhere',async()=>{
 for(const options of [{config:{checkout:false,provider:null,annual:{amount:'Soon',per:''},options:[]}},{configFails:true},{config:null}]){
  const p=await page(options);
  assert.equal(p.nodes.proPrice.textContent,'en:y.soon');assert.equal(p.nodes.proPer.textContent,'');
  assert.equal(p.buttons().length,0);assert.equal(p.nodes.paySoon.hidden,false);
 }
});

test('a link that is not an https Mercado Pago Peru address never becomes a button, whatever the server sends',async()=>{
 const bad=['https://evil.example/pay','http://link.mercadopago.com.pe/nodal','https://mercadopago.com.pe.evil.example/x','javascript:alert(1)','https://www.mercadopago.com.ar/x',42];
 const p=await page({config:{...OPEN,options:[...bad.map((url,i)=>({id:i%2?'once':'installments',url,amount:'S/ 1'})),{id:'other',url:ONCE,amount:'S/ 9'},{id:'once',url:'https://mpago.la/2Xh3k',amount:'S/ 240'}]}});
 assert.deepEqual(p.buttons().map(a=>a.href),['https://mpago.la/2Xh3k'],'only the Mercado Pago link with a known option');
});

test('the first step shows the email of the member’s NODAL account, to use on Mercado Pago',async()=>{
 const p=await page();
 assert.equal(p.nodes.payEmail.textContent,'ana@example.test');assert.equal(p.nodes.payEmailStep.hidden,false);
 const anonymous=await page({me:null});
 assert.equal(anonymous.nodes.payEmail.textContent,'');assert.equal(anonymous.nodes.payEmailStep.hidden,true,'no empty slot when the email is unknown');
});

test('the page carries the Mercado Pago copy in English, and every new string has Spanish and Portuguese',()=>{
 assert.doesNotMatch(html,/Stripe|id="cycleMonthly"|id="summaryCheckout"/,'no Stripe wording and no monthly toggle');
 for(const id of ['proPrice','proPer','payOptions','paySoon','payEmail','payEmailStep'])assert.match(html,new RegExp(`id="${id}"`),id);
 const keys=[...new Set([...html.matchAll(/data-i18n="(y\.mp\.[^"]+)"/g)].map(match=>match[1]).concat(['y.mp.payOnce','y.mp.payInstallments']))];
 assert.ok(keys.length>=12,keys.join());
 for(const key of keys)assert.equal(dictionaries.split(`'${key}':`).length-1,3,`${key} in English, Spanish and Portuguese`);
});
