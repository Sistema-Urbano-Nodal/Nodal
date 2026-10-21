/* The Nodal Fundadores 2027 copy across the payments page, the landing card and the course note
   (docs/superpowers/specs/2026-10-21-nodal-fundadores-design.md): every new string in English, Spanish and Portuguese,
   the Spanish of the team's document word for word, and nothing left from the Supporting membership that contradicts the terms. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const payments=read('web/pages/payments.html'),landing=read('web/pages/index.html');
const LANGS=['en','es','pt'];
function console_(){const context={window:{}};vm.runInNewContext(read('web/scripts/i18n-dashboard.js'),context);return context.window.NODAL_I18N_DASH;}
// The shared dictionaries as the landing page has them, read through nodalI18n.t (English from i18n.js only: the markup is not loaded here).
function shared(lang){
 const context={document:{body:{dataset:{page:'home'}},documentElement:{},querySelectorAll:()=>[]},window:{location:{search:''}},localStorage:{getItem(){return null;},setItem(){}},URLSearchParams,console};
 vm.runInNewContext(read('web/scripts/i18n.js'),context);const api=context.window.nodalI18n;api.apply(lang,{persist:false});return api;
}
function pilot(){const context={window:{}};vm.runInNewContext(read('web/scripts/pilot-i18n.js'),context);return context.window.pilotI18n.rows;}
const placeholders=value=>[...String(value).matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort().join();
// The markup's own text of a data-i18n element, entities as written.
const markup=(html,key)=>[...html.matchAll(new RegExp(`data-i18n="${key.replace(/\./g,'\\.')}">([^<]*)<`,'g'))].map(match=>match[1]);

test('every Nodal Fundadores string of the payments page is in English, Spanish and Portuguese, and the markup reads as the English',()=>{
 const dict=console_();
 const used=new Set([...payments.matchAll(/data-i18n="(y\.fund\.[^"]+)"/g),...read('web/scripts/payments.js').matchAll(/'(y\.fund\.[A-Za-z0-9]+)'/g)].map(match=>match[1]));
 assert.ok(used.size>=70,`${used.size} keys`);
 for(const key of used){
  for(const lang of LANGS)assert.ok(typeof dict[lang][key]==='string'&&dict[lang][key].trim(),`${key} in ${lang}`);
  assert.notEqual(dict.es[key],dict.en[key],`${key} is translated into Spanish`);
  assert.equal(placeholders(dict.es[key]),placeholders(dict.en[key]),`${key}: Spanish placeholders`);assert.equal(placeholders(dict.pt[key]),placeholders(dict.en[key]),`${key}: Portuguese placeholders`);
  // The English dictionary wins over the markup once i18n.js runs, so both must say the same.
  for(const text of markup(payments,key))assert.equal(text,dict.en[key],`${key}: markup and English dictionary`);
 }
 // Every key in the dictionaries is used, so none drifts unseen.
 for(const lang of LANGS)for(const key of Object.keys(dict[lang]).filter(key=>key.startsWith('y.fund.')))assert.ok(used.has(key),`${lang} ${key} is unused`);
});

test('the payments page Spanish is the team document’s section 1 and section 3 word for word',()=>{
 const es=console_().es;
 const SECTION={
  'y.fund.intro':'Forma parte de la comunidad que está construyendo una nueva manera de conectar, colaborar y transformar nuestras ciudades desde el Urbanismo Colaborativo.',
  'y.fund.chooseTitle':'Elige tu modalidad de pago','y.fund.onceName':'Pago único','y.fund.onceText':'Un solo pago al inscribirte por tu membresía anual.','y.fund.twiceName':'Dos pagos',
  'y.fund.sameBenefits':'Ambas opciones incluyen los mismos beneficios. Todos los precios incluyen IGV.',
  'y.fund.notMonthly':'La modalidad de dos pagos corresponde a una sola membresía anual. No es una suscripción mensual ni una membresía de dos meses.',
  'y.fund.includesTitle':'Tu membresía incluye',
  'y.fund.b1t':'Acceso anticipado:','y.fund.b1':'desde la aprobación del primer pago hasta el 31 de diciembre de 2026 en el formato Early Access (Acceso temprano).',
  'y.fund.b2t':'Membresía anual:','y.fund.b2':'del 1 de enero al 31 de diciembre de 2027.',
  'y.fund.b3t':'Conecta:','y.fund.b3':'acceso a la comunidad, conexiones e introducciones curadas y espacios de networking.',
  'y.fund.b4t':'Encuentra oportunidades:','y.fund.b4':'acceso a oportunidades seleccionadas, con herramientas de búsqueda y curaduría.',
  'y.fund.b5t':'Aprende:','y.fund.b5':'un curso y una masterclass incluidos durante 2027, acceso a la biblioteca y recursos de Nodal.',
  'y.fund.b6t':'Haz visible tu trabajo:','y.fund.b6':'un perfil ampliado y oportunidades de difusión vinculadas a tu participación y contribuciones.',
  'y.fund.b7t':'Formación adicional:','y.fund.b7':'20% de descuento en cursos y masterclasses adicionales durante 2027, no acumulable con otras promociones ni tarifas especiales. Se aplicará la tarifa más favorable.',
  'y.fund.courseNote':'El curso y la masterclass incluidos se habilitan desde la aprobación del primer pago, también si eliges pagar en dos partes. Las actividades se ofrecerán durante 2027, según la programación y disponibilidad de cupos. No necesitas completar el segundo pago para habilitar estos beneficios; debes mantener tu membresía al día conforme a sus condiciones.',
  'y.fund.termTitle':'Vigencia y pagos',
  'y.fund.term1':'La oferta Nodal Fundadores 2027 está disponible para quienes se inscriban y tengan su primer pago aprobado hasta el 31 de diciembre de 2026.',
  'y.fund.term2':'Una vez completado el pago único o los dos pagos de la modalidad elegida, no se realizarán cobros adicionales por ese ciclo de membresía. Tu acceso continuará hasta el 31 de diciembre de 2027.',
  'y.fund.renewTitle':'Renovación automática',
  'y.fund.renew1':'Tu membresía se renovará el 1 de enero de 2028, salvo que solicites su no renovación antes de esa fecha.',
  'y.fund.renew2':'El precio de renovación será la tarifa regular vigente correspondiente a tu modalidad de pago, con un 5% de descuento mientras conserves activa tu condición de Fundador. El precio de renovación puede ser diferente del precio promocional de 2027.',
  'y.fund.renew3':'Antes de la renovación te comunicaremos el precio aplicable, las fechas de cobro y cómo solicitar la no renovación. Los cobros estarán sujetos a tu autorización válida y a las funcionalidades habilitadas por el proveedor de pagos.',
  'y.fund.renew4':'Antes de confirmar tu compra podrás revisar el precio total, el calendario de pagos, los beneficios y las condiciones de renovación automática.',
  'y.fund.contactEmail':'Correo de atención','y.fund.complaints':'Libro de Reclamaciones','y.fund.sellerBy':'Servicio ofrecido por',
  'y.fund.acceptHead':'Aceptación de condiciones','y.fund.authHead':'Autorización correspondiente a la modalidad seleccionada',
  'y.fund.payWithEmail':'Paga en Mercado Pago con el correo de tu cuenta de NODAL:',
 };
 for(const [key,text] of Object.entries(SECTION))assert.equal(es[key],text,key);
 // The seller as section 1 names it, with "154 A" (the spec's choice where section 2 says 154).
 assert.match(payments,/<span id="paySellerName">Sistema Urbano<\/span>[\s\S]*<dd id="paySellerRuc">20605878815<\/dd>[\s\S]*<dd id="paySellerAddress">Calle General Varela 154 A, Miraflores<\/dd>/);
});

test('the landing card names the Founder Membership and the course note Nodal Fundadores, in all three languages',()=>{
 const used=[...new Set([...landing.matchAll(/data-i18n="(mem\.fund\.[^"]+)"/g),...read('web/scripts/app.js').matchAll(/'(mem\.fund\.[A-Za-z0-9]+)'/g)].map(match=>match[1]))];
 assert.deepEqual(used.sort(),['mem.fund.connect','mem.fund.connectText','mem.fund.cta','mem.fund.discount','mem.fund.early','mem.fund.ended','mem.fund.find','mem.fund.findText','mem.fund.flag','mem.fund.learn','mem.fund.learnText','mem.fund.name','mem.fund.tagline','mem.fund.terms','mem.fund.visible','mem.fund.visibleText']);
 const api=Object.fromEntries(LANGS.map(lang=>[lang,shared(lang)]));
 for(const key of used){
  for(const lang of ['es','pt'])assert.notEqual(api[lang].t(key),key,`${key} in ${lang}`);
  // English is the markup's own text, or i18n.js's for the lines app.js writes.
  assert.ok(markup(landing,key).length===1||api.en.t(key)!==key,`${key} in English`);
 }
 for(const key of used)assert.equal(placeholders(api.es.t(key)),'',key);
 const rows=pilot();
 for(const key of ['supportersOnly','supportersNote','supportersNoteOpen','supportersNoteEnded']){
  assert.equal(rows[key].length,3,key);
  for(const text of rows[key])assert.match(text,/Nodal Fundadores/,key);
 }
 // The course note's button names the membership as the landing card does.
 assert.deepEqual([...rows.becomeSupporter],['Join the Founder Membership','Únete a la Membresía Fundador','Junte-se à Membresia Fundador']);
 // The course is a 2026 one: members join it during their early access, and it is not the course included in 2027 (sections 4, 8 and 15).
 assert.deepEqual([...rows.supportersNoteOpen],['Nodal Fundadores members can join this course during their 2026 early access; it is not the course included in 2027. People already enrolled keep full access.',
  'Los miembros de Nodal Fundadores pueden sumarse a este curso durante su acceso anticipado de 2026; no reemplaza el curso incluido en 2027. Quienes ya están inscritos conservan el acceso completo.',
  'Os membros do Nodal Fundadores podem entrar neste curso durante o acesso antecipado de 2026; ele não substitui o curso incluído em 2027. Quem já está inscrito mantém o acesso completo.']);
 assert.deepEqual([...rows.supportersNote],['Nodal Fundadores members can join this course during their 2026 early access, which opens soon; it is not the course included in 2027. People already enrolled keep full access.',
  'Los miembros de Nodal Fundadores pueden sumarse a este curso durante su acceso anticipado de 2026, que abre pronto; no reemplaza el curso incluido en 2027. Quienes ya están inscritos conservan el acceso completo.',
  'Os membros do Nodal Fundadores podem entrar neste curso durante o acesso antecipado de 2026, que abre em breve; ele não substitui o curso incluído em 2027. Quem já está inscrito mantém o acesso completo.']);
 for(const text of rows.supportersNoteEnded)assert.match(text,/2026/);
 // The teaching team adds each member whose payment was approved, not "each Supporter who paid".
 assert.deepEqual([...rows.participantsSupporters],['Enrollment is closed to the public. Add here each Nodal Fundadores member whose payment was approved on Mercado Pago, with the email of their NODAL account.',
  'Las inscripciones están cerradas al público. Agrega aquí a cada miembro de Nodal Fundadores cuyo pago fue aprobado en Mercado Pago, con el correo de su cuenta de NODAL.',
  'As inscrições estão fechadas ao público. Adicione aqui cada membro do Nodal Fundadores cujo pagamento foi aprovado no Mercado Pago, com o e-mail da conta dele na NODAL.']);
});

test('no copy left from the Supporting membership contradicts the terms: no twelve months from the payment, no membership that does not renew',()=>{
 const dict=console_(),rows=pilot();
 const texts=[payments,landing,...LANGS.flatMap(lang=>Object.entries(dict[lang]).filter(([key])=>key.startsWith('y.fund.')).map(([,value])=>value)),
  ...['es','pt'].flatMap(lang=>{const api=shared(lang);return ['mem.fund.flag','mem.fund.name','mem.fund.tagline','mem.fund.early','mem.fund.discount','mem.fund.cta','mem.fund.terms','mem.fund.ended'].map(key=>api.t(key));}),
  ...['supportersOnly','supportersNote','supportersNoteOpen','supportersNoteEnded','becomeSupporter','participantsSupporters'].flatMap(key=>rows[key])];
 for(const text of texts)assert.doesNotMatch(text,/12 months from|12 meses desde|12 meses a partir|doesn['’]t renew|does not renew by itself|no se renueva sola|não renova sozinha|Supporting membership|membresía de apoyo|assinatura de apoio/i,text.slice(0,80));
 // The dictionaries no longer carry the Mercado Pago links page or the Supporter courses lines.
 for(const lang of LANGS)assert.deepEqual(Object.keys(dict[lang]).filter(key=>key.startsWith('y.mp.')||key==='y.p6'),[],lang);
 // Nor the landing card's price slot: its period suffixes, its "Soon!" and its two-payment line.
 for(const lang of LANGS){const api=shared(lang);for(const key of ['mem.fund.split','mem.priceSoon','y.perMonth','y.perYear'])assert.equal(api.t(key),key,`${lang} ${key}`);}
 // In Portuguese the paid plan is a membresia, as on the landing card, not an assinatura (a subscription).
 assert.equal(dict.pt['d.nav.membership'],'Membresia');assert.equal(shared('pt').t('res.link'),'Conheça a membresia');
});
