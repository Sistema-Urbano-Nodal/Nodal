/* The payments page for Nodal Fundadores 2027 (docs/superpowers/specs/2026-10-21-nodal-fundadores-design.md): the member picks
   a payment option, ticks the three acceptances of the terms' section 3, and the acceptance the server records answers with
   the Mercado Pago link for that option, opened in the same tab. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Node} from './helpers/fiiu-ui-harness.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const script=read('web/scripts/payments.js'),html=read('web/pages/payments.html');
const flush=async()=>{for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));};
const VERSION='FUNDADORES-2027-v1';
const OFFER={name:'Nodal Fundadores 2027',version:VERSION,effectiveFrom:'2026-10-21',endsAt:'2027-01-01T05:00:00.000Z',earlyAccessUntil:'2026-12-31',membershipFrom:'2027-01-01',membershipTo:'2027-12-31',renewalFrom:'2028-01-01',
 seller:{name:'Sistema Urbano',ruc:'20605878815',address:'Calle General Varela 154 A, Miraflores'}};
const CONTACT={email:'membresia@sistemaurbano.org',complaintsUrl:'https://reclamos.sistemaurbano.org/nodal'};
const OPEN={checkout:true,provider:'mercadopago',state:'open',offer:OFFER,annual:{amount:'S/ 499',per:''},
 options:[{id:'once',amount:'S/ 499'},{id:'installments',amount:'S/ 550',each:'S/ 275',count:2,monthsApart:2}],contact:CONTACT};
const CLOSED=state=>({checkout:false,provider:null,state,offer:OFFER,annual:{amount:'Soon',per:''},options:[],contact:state==='ended'?CONTACT:null});
const MP='https://www.mercadopago.com.pe/subscriptions/checkout?preapproval_plan_id=2c938084';
const CREATED={status:201,data:{url:MP,acceptance:{id:'a1',option:'installments',version:VERSION,acceptedAt:'2026-10-21T15:00:00.000Z'}}};

// Every element of payments.html that carries an id, as the page script finds it, with the attributes it reads from the markup.
function elements(){
 const nodes={};
 for(const [,tag,attrs] of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)){
  const id=attrs.match(/\bid="([^"]+)"/)?.[1];if(!id)continue;
  const node=Object.assign(new Node(tag),{id,checked:/\schecked\b/.test(attrs),hidden:/\shidden\b/.test(attrs),disabled:/\sdisabled\b/.test(attrs)});
  for(const name of ['type','name','value','href','target','rel'])if(attrs.match(new RegExp(`\\s${name}="([^"]*)"`)))node[name]=attrs.match(new RegExp(`\\s${name}="([^"]*)"`))[1];
  nodes[id]=node;
 }
 return nodes;
}

// config: the /api/billing/config answer (or a function of the request count); answers: what each acceptance POST gets, in turn.
async function page({config=OPEN,me={user:{email:'ana@example.test'}},answers=[CREATED],i18n:dictionary}={}){
 const nodes=elements(),requests=[],assigned=[],listeners=[];let configs=0;
 const fake={lang:'en',t:(key,vars)=>`${fake.lang}:${key}`+(vars?' '+Object.entries(vars).map(([name,value])=>`${name}=${value}`).join(' '):''),onChange:listener=>listeners.push(listener)};
 const i18n=dictionary??fake;
 const queue=[...answers];
 const context={window:{nodalI18n:i18n},URL,JSON,
  location:{pathname:'/payments.html',search:'',assign:url=>assigned.push(url)},
  document:{getElementById:id=>nodes[id]??null,createElement:tag=>new Node(tag)},
  fetch:async(path,options={})=>{
   const request={path,method:options.method||'GET',credentials:options.credentials,headers:options.headers,body:options.body===undefined?undefined:JSON.parse(options.body)};requests.push(request);
   if(path==='/api/billing/config'){const answer=typeof config==='function'?config(++configs):config;if(answer instanceof Error)throw answer;return{ok:true,status:200,json:async()=>answer};}
   if(path==='/api/auth/me')return me?{ok:true,status:200,json:async()=>me}:{ok:false,status:401,json:async()=>({error:'sign in required'})};
   if(path==='/api/membership/acceptances'){const answer=await (queue.length>1?queue.shift():queue[0]);if(answer instanceof Error)throw answer;return{ok:answer.status<400,status:answer.status,json:async()=>answer.data??{}};}
   throw Error('unexpected request '+path);
  }};
 vm.createContext(context);vm.runInContext(script,context);await flush();
 const radios={once:nodes.payOptionOnce,installments:nodes.payOptionInstallments},boxes=[nodes.payAcceptTerms,nodes.payAcceptPayment,nodes.payAcceptRenewal];
 const change=target=>nodes.fundForm.listeners.change({target});
 return{nodes,requests,assigned,radios,boxes,
  posts:()=>requests.filter(request=>request.method==='POST'),
  lang:lang=>{fake.lang=lang;listeners.forEach(listener=>listener());},
  // A browser checks one radio of the group and unchecks the other, then fires change on the one checked.
  choose:option=>{for(const [id,radio] of Object.entries(radios))radio.checked=id===option;change(radios[option]);},
  tick:(box,value=true)=>{box.checked=value;change(box);},
  tickAll(){for(const box of boxes)this.tick(box);},
  submit:()=>nodes.fundForm.listeners.submit({preventDefault(){}}),
 };
}
const visible=node=>!node.hidden;

test('an open offer shows the offered options with their amounts and a purchase box whose three boxes start unticked and whose button is off',async()=>{
 const p=await page(),n=p.nodes;
 assert.ok(visible(n.modalidad)&&visible(n.payPurchase),'the choice and the purchase box show');assert.equal(n.payClosed.hidden,true);
 assert.ok(visible(n.payChoiceOnce)&&visible(n.payChoiceInstallments));
 assert.equal(n.payOnceAmount.textContent,'S/ 499');
 assert.equal(n.payInstallmentsTotal.textContent,'en:y.fund.twiceTotal total=S/ 550');
 assert.equal(n.payInstallmentsText.textContent,'en:y.fund.twiceText each=S/ 275');
 assert.deepEqual(Object.values(p.radios).map(radio=>[radio.checked,radio.disabled]),[[false,false],[false,false]]);
 assert.deepEqual(p.boxes.map(box=>box.checked),[false,false,false]);
 assert.equal(n.payContinue.disabled,true);assert.equal(n.payHint.hidden,false,'the hint says what turns the button on');
 // Before an option is chosen there is no payment authorization to accept, only a line asking to choose.
 assert.equal(n.payPaymentRow.hidden,true);assert.equal(n.payPaymentHint.hidden,false);
 assert.equal(p.posts().length,0);
});

test('the button turns on only once an option is chosen and all three boxes are ticked',async()=>{
 const p=await page(),n=p.nodes;
 p.tick(n.payAcceptTerms);p.tick(n.payAcceptRenewal);assert.equal(n.payContinue.disabled,true,'no option yet');
 p.choose('once');assert.equal(n.payContinue.disabled,true,'the payment authorization is not ticked');
 p.tick(n.payAcceptPayment);assert.equal(n.payContinue.disabled,false);assert.equal(n.payHint.hidden,true);
 for(const box of p.boxes){p.tick(box,false);assert.equal(n.payContinue.disabled,true,box.id);p.tick(box);assert.equal(n.payContinue.disabled,false,box.id);}
});

test('only the chosen option’s payment authorization shows, and choosing the other option unticks it',async()=>{
 const p=await page(),n=p.nodes;
 p.choose('once');
 assert.equal(n.payPaymentRow.hidden,false);assert.equal(n.payPaymentHint.hidden,true);
 assert.equal(n.payPaymentText.textContent,'en:y.fund.authOnce amount=S/ 499');
 p.tickAll();assert.equal(n.payContinue.disabled,false);
 p.choose('installments');
 assert.equal(n.payPaymentText.textContent,'en:y.fund.authTwice total=S/ 550 each=S/ 275');
 assert.equal(n.payAcceptPayment.checked,false,'an authorization for another amount is never carried over');
 assert.deepEqual([n.payAcceptTerms.checked,n.payAcceptRenewal.checked],[true,true],'the other two acceptances stay');
 assert.equal(n.payContinue.disabled,true);
 // A language switch translates the authorization without changing what was ticked.
 p.tick(n.payAcceptPayment);p.lang('es');
 assert.equal(n.payPaymentText.textContent,'es:y.fund.authTwice total=S/ 550 each=S/ 275');assert.equal(n.payAcceptPayment.checked,true);assert.equal(n.payContinue.disabled,false);
});

test('continuing records the acceptance with exactly the chosen option, the terms version and three true flags, then opens the Mercado Pago link in this tab',async()=>{
 const p=await page();
 p.choose('installments');p.tickAll();await p.submit();await flush();
 const [post]=p.posts();
 assert.equal(post.path,'/api/membership/acceptances');assert.equal(post.credentials,'same-origin');assert.equal(post.headers['Content-Type'],'application/json');
 assert.deepEqual(post.body,{option:'installments',version:VERSION,accept:{terms:true,payment:true,renewal:true}});
 assert.deepEqual(p.assigned,[MP]);
 assert.equal(p.nodes.payContinue.disabled,true,'the button stays off while the browser leaves for Mercado Pago');
 const once=await page();once.choose('once');once.tickAll();await once.submit();await flush();
 assert.equal(once.posts()[0].body.option,'once');
});

test('a double click posts once',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const p=await page({answers:[pending]});
 p.choose('once');p.tickAll();
 const first=p.submit(),second=p.submit();
 assert.equal(p.nodes.payContinue.disabled,true,'the button is off while the acceptance is saved');
 release(CREATED);await Promise.all([first,second]);await flush();
 assert.equal(p.posts().length,1);assert.deepEqual(p.assigned,[MP]);
});

test('only an https link from the answer is followed; anything else is an error the member can retry',async()=>{
 for(const url of ['http://link.mercadopago.com.pe/nodal','javascript:alert(1)','//evil.example/pay','https://user:pass@link.mercadopago.com.pe/x','not a url',42,undefined]){
  const p=await page({answers:[{status:201,data:{url}},CREATED]});
  p.choose('once');p.tickAll();await p.submit();await flush();
  assert.deepEqual(p.assigned,[],String(url));
  assert.equal(p.nodes.payStatus.textContent,'en:y.fund.error',String(url));assert.equal(p.nodes.payContinue.disabled,false,String(url));
  await p.submit();await flush();assert.deepEqual(p.assigned,[MP],'the retry goes through');
 }
});

test('changed terms reload the configuration, clear every tick and say so',async()=>{
 const p=await page({answers:[{status:409,data:{code:'terms_changed',version:'FUNDADORES-2027-v2'}}]});
 p.choose('installments');p.tickAll();await p.submit();await flush();
 assert.equal(p.requests.filter(request=>request.path==='/api/billing/config').length,2,'the configuration is read again');
 assert.deepEqual([...Object.values(p.radios),...p.boxes].map(input=>input.checked),[false,false,false,false,false],'nothing accepted before stands');
 assert.equal(p.nodes.payStatus.textContent,'en:y.fund.changed');assert.equal(p.nodes.payContinue.disabled,true);assert.deepEqual(p.assigned,[]);
 // A server on terms this page does not carry is not sold from it: the member reloads the page to read them.
 const newer=await page({config:count=>count===1?OPEN:{...OPEN,offer:{...OFFER,version:'FUNDADORES-2027-v2'}},answers:[{status:409,data:{code:'terms_changed',version:'FUNDADORES-2027-v2'}}]});
 newer.choose('once');newer.tickAll();await newer.submit();await flush();
 assert.equal(newer.nodes.payPurchase.hidden,true);assert.equal(newer.nodes.modalidad.hidden,true);
 assert.equal(newer.nodes.payClosed.hidden,false);assert.equal(newer.nodes.payClosed.textContent,'en:y.fund.outdated');
});

test('an offer that ended meanwhile shows the closed offer, and a signed-out member goes to sign in and back',async()=>{
 const ended=await page({answers:[{status:410,data:{code:'offer_ended'}}]});
 ended.choose('once');ended.tickAll();await ended.submit();await flush();
 assert.equal(ended.nodes.payPurchase.hidden,true);assert.equal(ended.nodes.modalidad.hidden,true);
 assert.equal(ended.nodes.payClosed.textContent,'en:y.fund.ended');assert.deepEqual(ended.assigned,[]);
 const out=await page({answers:[{status:401,data:{error:'authentication required'}}]});
 out.choose('once');out.tickAll();await out.submit();await flush();
 assert.deepEqual(out.assigned,['/login.html?next=%2Fpayments.html']);
});

test('any other refusal, or no answer, keeps the choices and says in the live region that it can be tried again',async()=>{
 for(const answer of [{status:400,data:{code:'acceptance_invalid'}},{status:503,data:{code:'membership_unavailable'}},{status:429,data:{}},{status:500,data:{}},{status:403,data:{}},TypeError('Failed to fetch')]){
  const p=await page({answers:[answer,CREATED]}),label=answer.status??answer.message;
  p.choose('installments');p.tickAll();await p.submit();await flush();
  assert.equal(p.nodes.payStatus.textContent,'en:y.fund.error',label);assert.deepEqual(p.assigned,[],label);
  assert.deepEqual(p.boxes.map(box=>box.checked),[true,true,true],label);assert.equal(p.nodes.payContinue.disabled,false,label);
  p.lang('pt');assert.equal(p.nodes.payStatus.textContent,'pt:y.fund.error','the message follows the language');
  await p.submit();await flush();assert.equal(p.posts().length,2,label);assert.deepEqual(p.assigned,[MP],label);
 }
 assert.match(html,/<p class="[^"]*" id="payStatus" role="status" aria-live="polite"><\/p>/);
});

test('before sign-ups open, after the offer closed, and without an answer, there is no purchase box, only what the state is',async()=>{
 for(const [config,key] of [[CLOSED('soon'),'y.fund.soon'],[CLOSED('ended'),'y.fund.ended'],[new TypeError('Failed to fetch'),'y.fund.soon'],[null,'y.fund.soon'],
  // The shape before Nodal Fundadores, and an open answer missing what the page needs, read as opening soon.
  [{checkout:true,provider:'mercadopago',annual:{amount:'S/ 240',per:'/ year'},options:[{id:'once',url:MP,amount:'S/ 240'}]},'y.fund.soon'],[{...OPEN,contact:null},'y.fund.soon'],[{...OPEN,options:[]},'y.fund.soon'],
  [{...OPEN,contact:{email:'not an email',complaintsUrl:CONTACT.complaintsUrl}},'y.fund.soon'],[{...OPEN,contact:{email:CONTACT.email,complaintsUrl:'http://reclamos.example'}},'y.fund.soon'],
  [{...OPEN,offer:{...OFFER,version:'FUNDADORES-2027-v2'}},'y.fund.outdated']]){
  const p=await page({config}),label=JSON.stringify(config)?.slice(0,80);
  assert.equal(p.nodes.payPurchase.hidden,true,label);assert.equal(p.nodes.modalidad.hidden,true,label);
  assert.equal(p.nodes.payClosed.hidden,false,label);assert.equal(p.nodes.payClosed.textContent,'en:'+key,label);
  assert.equal(p.nodes.payContinue.disabled,true,label);
  await p.submit();await flush();assert.equal(p.posts().length,0,label);
 }
});

test('an option the server does not offer is not a choice',async()=>{
 const p=await page({config:{...OPEN,options:[OPEN.options[0]]}});
 assert.equal(p.nodes.payChoiceInstallments.hidden,true);assert.equal(p.radios.installments.disabled,true);assert.equal(p.nodes.payInstallmentsText.textContent,'');
 assert.equal(p.nodes.payChoiceOnce.hidden,false);
 const twice=await page({config:{...OPEN,options:[OPEN.options[1],{id:'monthly',amount:'S/ 50'},{id:'once'}]}});
 assert.deepEqual([twice.nodes.payChoiceOnce.hidden,twice.nodes.payChoiceInstallments.hidden],[true,false],'an unknown option or one without its amount is skipped');
});

test('the seller block links the contact email and opens the Libro de Reclamaciones in a new tab, or says pending until they are set',async()=>{
 const p=await page(),n=p.nodes;
 assert.equal(n.payContactEmail.href,'mailto:membresia@sistemaurbano.org');assert.equal(n.payContactEmail.textContent,'membresia@sistemaurbano.org');assert.equal(n.payContactEmail.hidden,false);
 assert.equal(n.payComplaints.href,'https://reclamos.sistemaurbano.org/nodal');assert.equal(n.payComplaints.target,'_blank');assert.equal(n.payComplaints.rel,'noopener noreferrer');
 assert.deepEqual([n.payContactPending.hidden,n.payComplaintsPending.hidden],[true,true]);
 assert.deepEqual([n.paySellerName.textContent,n.paySellerRuc.textContent,n.paySellerAddress.textContent],['Sistema Urbano','20605878815','Calle General Varela 154 A, Miraflores']);
 const soon=await page({config:CLOSED('soon')});
 assert.deepEqual([soon.nodes.payContactEmail.hidden,soon.nodes.payComplaints.hidden,soon.nodes.payContactPending.hidden,soon.nodes.payComplaintsPending.hidden],[true,true,false,false]);
 // The markup carries the seller's details for static hosting.
 for(const value of ['Sistema Urbano','20605878815','Calle General Varela 154 A, Miraflores'])assert.ok(html.includes(`>${value}<`),value);
 assert.match(html,/<a id="payComplaints"[^>]*target="_blank" rel="noopener noreferrer"/);
 assert.match(html,/href="terminos-fundadores\.html"/);
});

test('the purchase box shows the email of the member’s NODAL account to pay with',async()=>{
 const p=await page();
 assert.equal(p.nodes.payEmail.textContent,'ana@example.test');assert.equal(p.nodes.payEmailStep.hidden,false);
 const anonymous=await page({me:null});
 assert.equal(anonymous.nodes.payEmail.textContent,'');assert.equal(anonymous.nodes.payEmailStep.hidden,true,'no empty slot when the email is unknown');
});

test('in Spanish the authorizations read as the terms’ section 3 with the amounts of the offer',async()=>{
 const context={document:{body:{dataset:{}},documentElement:{},querySelectorAll:()=>[]},window:{location:{search:''}},localStorage:{getItem(){return null;},setItem(){}},URLSearchParams,console};
 vm.createContext(context);vm.runInContext(read('web/scripts/i18n-dashboard.js'),context);vm.runInContext(read('web/scripts/i18n.js'),context);
 const i18n=context.window.nodalI18n;i18n.apply('es',{persist:false});
 const p=await page({i18n}),n=p.nodes;
 assert.equal(n.payInstallmentsTotal.textContent,'S/ 550 en total');
 assert.equal(n.payInstallmentsText.textContent,'S/ 275 al inscribirte y un segundo cobro automático de S/ 275 dos meses calendario después de la fecha de aprobación del primer pago. (Si el mes de destino no tiene el día correspondiente, el segundo pago vencerá el último día de ese mes).');
 p.choose('once');assert.equal(n.payPaymentText.textContent,'Autorizo el cobro de S/ 499, incluido IGV, por mi membresía Nodal Fundadores 2027.');
 p.choose('installments');
 assert.equal(n.payPaymentText.textContent,'Autorizo dos cobros de S/ 275 cada uno, por un total de S/ 550, incluido IGV: el primero al inscribirme y el segundo automáticamente dos meses calendario después de la fecha de aprobación del primer pago. Si el mes de destino no tiene el día correspondiente, el segundo pago vencerá el último día de ese mes.');
 for(const [key,es] of [['y.fund.soon','Las inscripciones abren pronto.'],['y.fund.ended','La oferta Nodal Fundadores 2027 cerró el 31 de diciembre de 2026.'],['y.fund.continue','Continuar a Mercado Pago'],
  ['y.fund.authRenew','Autorizo la renovación automática de mi membresía a partir del 1 de enero de 2028, y posteriormente cada 1 de enero, salvo que solicite su no renovación antes del inicio del siguiente período. Entiendo que se aplicará la tarifa regular vigente correspondiente a mi modalidad, con un 5% de descuento mientras conserve activa mi condición de Fundador, y que el precio y las fechas de cobro se me comunicarán antes de la renovación.']])
  assert.equal(i18n.t(key),es,key);
 assert.equal([i18n.t('y.fund.acceptPre'),i18n.t('y.fund.termsLink'),i18n.t('y.fund.acceptPost')].join(''),'He leído y acepto los Términos comerciales de Nodal Fundadores, incluidos los beneficios de la membresía, su vigencia, el precio total, el calendario de pagos y las condiciones de renovación automática.');
});

test('the markup is a real form: a labelled radio group, three unticked checkboxes bound to their text, and a button off until JavaScript turns it on',()=>{
 const form=html.slice(html.indexOf('<form'),html.indexOf('</form>'));assert.match(form,/<form class="[^"]*" id="fundForm" novalidate>/);
 const group=form.slice(form.indexOf('<fieldset'),form.indexOf('</fieldset>'));
 assert.match(group,/<legend>[\s\S]*data-i18n="y\.fund\.chooseTitle"/,'the group is named by its legend');
 for(const [id,value] of [['payOptionOnce','once'],['payOptionInstallments','installments']])assert.match(group,new RegExp(`<label class="pay-choice" id="payChoice\\w+">\\s*<input type="radio" id="${id}" name="option" value="${value}" />`),id);
 for(const [id,name] of [['payAcceptTerms','terms'],['payAcceptPayment','payment'],['payAcceptRenewal','renewal']])assert.match(form,new RegExp(`<label class="pay-check"[^>]*>\\s*<input type="checkbox" id="${id}" name="${name}" />`),id);
 assert.doesNotMatch(form,/\schecked\b/,'nothing comes ticked');
 assert.match(form,/<button type="submit" class="btn btn-primary btn-block" id="payContinue" disabled aria-describedby="payHint" data-i18n="y\.fund\.continue">Continue to Mercado Pago<\/button>/);
 // The terms open in a new tab from the purchase box, so the ticks stay.
 assert.match(form,/<a href="terminos-fundadores\.html" target="_blank" rel="noopener" data-i18n="y\.fund\.termsLink">/);
 for(const id of ['modalidad','beneficios','gratis'])assert.match(html,new RegExp(`<section class="[^"]*" id="${id}"`),id);
 const benefits=html.slice(html.indexOf('id="beneficios"'),html.indexOf('</section>',html.indexOf('id="beneficios"')));
 assert.equal((benefits.match(/<li>/g)||[]).length,7,'the seven benefits of section 1');
 // The old Supporting membership copy contradicted the terms.
 assert.doesNotMatch(html,/12 months|doesn['’]t renew|does not renew|y\.mp\.|data-option=|Stripe/i);
 // Prices come from the offer at runtime.
 assert.doesNotMatch(html,/S\/\s?\d|US\$\s?\d/,'no price in the markup');
});
