/* The join page of the Membresía Fundador 2027 (/fundadores.html): the team's text "Texto Para Landing Page de Nodal
   Fundadores" (21 Oct 2026), which asked for "a much simpler site explaining the benefits and the payment options".
   The Spanish is the team's, word for word; the English and the Portuguese are NODAL's. One block per language, shown
   by html[lang] (set by locale.js and i18n.js, as the site's language choice sets it everywhere). The page is public
   and ships to the CDN like the terms page; its only action, the button to the payments page, follows
   GET /api/billing/config. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {STATIC_PAGES} from '../scripts/build-static.js';
import {FUNDADORES_2027} from '../server/membership-offer.js';
import {createApp, publicBillingConfig, staticSourcePath} from '../server/server.js';
import {createDatabase} from '../server/db.js';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const PAGE = 'web/pages/fundadores.html', SCRIPT = 'web/scripts/fundadores.js', STYLE = 'web/styles/fundadores.css';
const LANGS = ['es', 'en', 'pt'];
const entities = {'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' '};
const words = text => text.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, entity => entities[entity]).replace(/\s+/g, ' ').trim();
// Inline tags (<mark>, <span>) join their text to what follows, so the markup spells out every space it means.
const plain = html => words(html.replace(/<[^>]+>/g, ''));
// One language's copy of the page: an <article> that holds no other article.
const block = (html, lang) => html.match(new RegExp(`<article class="fund-copy" data-fund-lang="${lang}" lang="${lang}">([\\s\\S]*?)</article>`))?.[1];
/* What a reader reads, in order: headings, paragraphs, table cells and links. The page's own additions are marked and
   left out: the kicker over the title and the lines app state writes under the title and the closing heading. */
const ELEMENTS = /<(h1|h2|h3|p|th|td|a)\b([^>]*)>([\s\S]*?)<\/\1>/g;
const sequence = part => [...part.matchAll(ELEMENTS)]
  .filter(([, , attributes]) => !/class="fund-kicker"|data-fund-state/.test(attributes))
  .map(([, tag, , inner]) => [tag, plain(inner)]);

// The team's text in its order, with the PDF's line wraps joined (the renewal paragraph runs from page 2 to page 3).
const TEXT = [
  ['h1', 'Las ciudades cambian cuando nos conectamos'],
  ['p', 'Súmate a Nodal y sé parte desde el comienzo.'],
  ['p', 'Si te apasionan las ciudades y quieres aportar a transformarlas, aquí puedes encontrar personas con quienes compartir ideas, aprender y dar el siguiente paso.'],
  ['p', 'Nodal es una comunidad para conectar, colaborar y transformar nuestras ciudades desde el Urbanismo Colaborativo. Con tu Membresía Fundador accedes a conocimientos, herramientas y oportunidades para impulsar tu trabajo, y formas parte de la comunidad que está construyendo este espacio desde el inicio.'],
  ['h2', 'Un año para conectar, aprender y hacer crecer tus ideas'],
  ['h3', 'Conecta con personas que comparten tus intereses.'],
  ['p', 'Amplía tu red, participa en espacios de encuentro y descubre posibles colaboraciones a través de conexiones e introducciones curadas.'],
  ['h3', 'Encuentra oportunidades para dar el siguiente paso.'],
  ['p', 'Explora convocatorias, empleos, fondos y otras oportunidades seleccionadas para la comunidad.'],
  ['h3', 'Sigue aprendiendo.'],
  ['p', 'Tu membresía incluye un curso y una masterclass durante 2027, además de acceso a la biblioteca y los recursos de Nodal. También tienes 20% de descuento en cursos y masterclasses adicionales, no acumulable con otras promociones o tarifas especiales; se aplica la tarifa más favorable.'],
  ['h3', 'Haz visible lo que haces.'],
  ['p', 'Comparte tu experiencia, proyectos y contribuciones con un perfil ampliado y oportunidades de difusión vinculadas a tu participación.'],
  ['h2', 'Entra antes y ayúdanos a darle forma a Nodal'],
  ['p', 'Al sumarte durante 2026, accedes a la plataforma desde la aprobación de tu primer pago, sin costo adicional hasta el 31 de diciembre.'],
  ['p', 'Este acceso anticipado es también una invitación a construir juntos: explora la plataforma, prueba sus herramientas y comparte qué te resulta útil, qué mejorarías y qué te gustaría encontrar. Tus ideas y tu experiencia contribuirán a darle forma a Nodal para que responda mejor a las necesidades de su comunidad.'],
  ['h2', 'Tu lugar en la historia de Nodal'],
  ['p', 'Ser Fundador es estar desde el comienzo y aportar a lo que viene.'],
  ['p', 'Al sumarte, recibirás el badge Founder, una insignia que permanecerá en tu perfil como reconocimiento por haber sido parte de la comunidad fundadora. Aunque en el futuro decidas no renovar tu membresía, conservarás esta distinción mientras mantengas tu cuenta en Nodal.'],
  ['p', 'La insignia reconoce tu historia en la comunidad. Los beneficios de pago y el descuento de renovación dependen de que mantengas activa tu membresía conforme a sus condiciones.'],
  ['h2', 'Todo un año, desde el equivalente a S/41.58 al mes'],
  ['p', 'La Membresía Fundador 2027 es anual y puedes pagarla en una o dos partes:'],
  ['th', 'Modalidad'], ['th', '¿Cómo pagas?'], ['th', 'Equivalente mensual*'],
  ['th', 'Pago único: S/499'], ['td', 'Un solo pago al inscribirte.'], ['td', 'S/41.58 al mes'],
  ['th', 'Pago dividido: S/550 en total'], ['td', 'S/275 al inscribirte y S/275 automáticamente dos meses calendario después de la aprobación del primer pago.'], ['td', 'S/45.83 al mes'],
  ['p', 'Los mismos beneficios en ambas opciones. Todos los precios incluyen IGV.'],
  ['p', 'El equivalente mensual resulta de dividir el precio total entre los 12 meses de membresía y está redondeado a dos decimales. Es una referencia del costo: no se realizan cobros mensuales.'],
  ['h2', 'Empieza a explorar hoy. Disfruta de tu membresía durante todo 2027.'],
  ['p', 'Tu membresía anual estará vigente del 1 de enero al 31 de diciembre de 2027, además del acceso anticipado que recibes al sumarte en 2026.'],
  ['p', 'El curso y la masterclass incluidos se habilitan desde el primer pago: no necesitas completar el segundo para acceder a ellos. Las actividades se realizarán durante 2027, según programación y disponibilidad de cupos, y debes mantener tu membresía al día.'],
  ['h2', 'Trae tus ideas, tu experiencia y tus ganas de colaborar. Construyamos juntos nuevas posibilidades para nuestras ciudades.'],
  ['a', 'Quiero ser parte de Nodal'],
  ['p', 'Oferta disponible para quienes se inscriban y tengan su primer pago aprobado hasta el 31 de diciembre de 2026.'],
  ['p', 'Tu membresía tiene renovación automática el 1 de enero de 2028, salvo que solicites su no renovación antes de esa fecha. Mientras conserves activa tu condición de Fundador, tendrás 5% de descuento sobre la tarifa regular vigente de tu modalidad. Antes de la renovación te informaremos el precio y las fechas de cobro.'],
  ['a', 'Conoce los términos y condiciones de la Membresía Fundador'],
];
// NODAL's translations of the headings, the table, the button and the terms link, so they do not drift unseen.
const HEADINGS = {
  en: ['Cities change when we connect', 'A year to connect, learn and grow your ideas', 'Come in early and help us shape Nodal', "Your place in Nodal's story",
    'A whole year, from the equivalent of S/41.58 a month', 'Start exploring today. Enjoy your membership throughout 2027.',
    "Bring your ideas, your experience and your eagerness to collaborate. Let's build new possibilities for our cities together."],
  pt: ['As cidades mudam quando nos conectamos', 'Um ano para conectar, aprender e fazer as suas ideias crescerem', 'Entre antes e ajude a dar forma à Nodal', 'O seu lugar na história da Nodal',
    'Um ano inteiro, a partir do equivalente a S/41.58 por mês', 'Comece a explorar hoje. Aproveite a sua membresia durante todo o ano de 2027.',
    'Traga as suas ideias, a sua experiência e a sua vontade de colaborar. Vamos construir juntos novas possibilidades para as nossas cidades.'],
};
const CELLS = {
  en: ['Option', 'How do you pay?', 'Monthly equivalent*', 'Single payment: S/499', 'One payment when you sign up.', 'S/41.58 a month',
    'Split payment: S/550 in total', 'S/275 when you sign up and S/275 automatically two calendar months after your first payment is approved.', 'S/45.83 a month'],
  pt: ['Modalidade', 'Como você paga?', 'Equivalente mensal*', 'Pagamento único: S/499', 'Um só pagamento ao se inscrever.', 'S/41.58 por mês',
    'Pagamento dividido: S/550 no total', 'S/275 ao se inscrever e S/275 automaticamente dois meses-calendário após a aprovação do primeiro pagamento.', 'S/45.83 por mês'],
};
const LINKS = {
  es: ['Quiero ser parte de Nodal', 'Conoce los términos y condiciones de la Membresía Fundador'],
  en: ['I want to be part of Nodal', 'Read the Founder Membership terms and conditions (in Spanish)'],
  pt: ['Quero fazer parte da Nodal', 'Conheça os termos e condições da Membresia Fundador (em espanhol)'],
};
const TITLES = {es: 'Nodal Fundadores · Membresía Fundador 2027', en: 'Nodal Fundadores · Founder Membership 2027', pt: 'Nodal Fundadores · Membresia Fundador 2027'};
const ENDED = {es: 'La oferta Membresía Fundador 2027 cerró el 31 de diciembre de 2026.', en: 'The Founder Membership 2027 offer closed on 31 December 2026.', pt: 'A oferta Membresia Fundador 2027 foi encerrada em 31 de dezembro de 2026.'};
const SOON = {es: 'Las inscripciones abren pronto.', en: 'Sign-ups open soon.', pt: 'As inscrições abrem em breve.'};

test('the Spanish page is the team’s text, every heading and paragraph word for word and in its order', () => {
  const html = read(PAGE);
  assert.match(html, /<html lang="es" translate="no">/);
  const es = block(html, 'es');
  assert.ok(es, 'a Spanish block');
  assert.deepEqual(sequence(es), TEXT);
  // The headings the text has: a title, six sections (the closing line among them) and four benefits.
  assert.equal((es.match(/<h1\b/g) || []).length, 1);
  assert.equal((es.match(/<h2\b/g) || []).length, 6);
  assert.equal((es.match(/<h3\b/g) || []).length, 4);
  // The kicker names the membership; the text itself starts with the title.
  assert.match(es, /<p class="fund-kicker">Membresía Fundador 2027<\/p>\s*<h1\b/);
  assert.doesNotMatch(html, /---- page|●|AGREGAR/, 'no PDF page markers or placeholders');
});

test('the English and Portuguese pages say the same things in the same structure', () => {
  const html = read(PAGE), shape = part => sequence(part).map(([tag]) => tag);
  for (const lang of ['en', 'pt']) {
    const part = block(html, lang);
    assert.ok(part, `a ${lang} block`);
    assert.deepEqual(shape(part), shape(block(html, 'es')), `${lang}: one element for each of the text's`);
    const items = sequence(part);
    for (const [index, [tag, text]] of items.entries()) {
      assert.ok(text, `${lang} ${tag} ${index} has text`);
      if (!/S\/\d/.test(text)) assert.notEqual(text, TEXT[index][1], `${lang}: “${text.slice(0, 40)}” is translated`);
    }
    assert.deepEqual(items.filter(([tag]) => tag === 'h1' || tag === 'h2').map(([, text]) => text), HEADINGS[lang], `${lang} headings`);
    assert.deepEqual(items.filter(([tag]) => tag === 'th' || tag === 'td').map(([, text]) => text), CELLS[lang], `${lang} table`);
    assert.deepEqual(items.filter(([tag]) => tag === 'a').map(([, text]) => text), LINKS[lang], `${lang} links`);
    assert.equal((part.match(/<h3\b/g) || []).length, 4, `${lang}: four benefits`);
  }
  assert.deepEqual(sequence(block(html, 'es')).filter(([tag]) => tag === 'a').map(([, text]) => text), LINKS.es);
  // Each block owns its ids, so a reader switching languages lands on a page that still works.
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const lang of LANGS) assert.ok(ids.includes(`${lang}-precio`), `${lang} price section`);
  // The stylesheet shows the block of the language on <html> and hides the others.
  const css = read(STYLE);
  assert.match(css, /\[data-fund-lang\]\s*\{\s*display:\s*none;?\s*\}/);
  for (const lang of LANGS) assert.match(css, new RegExp(`html\\[lang="${lang}"\\] \\[data-fund-lang="${lang}"\\]`), lang);
});

test('each payment option is a row of a real table, with its headers', () => {
  const html = read(PAGE);
  for (const lang of LANGS) {
    const table = block(html, lang).match(/<table\b([^>]*)>([\s\S]*?)<\/table>/);
    assert.ok(table, `${lang} table`);
    assert.match(table[1], new RegExp(`aria-labelledby="${lang}-modalidades"`), `${lang}: named by the sentence that introduces it`);
    assert.ok(block(html, lang).includes(`id="${lang}-modalidades"`));
    assert.equal((table[2].match(/<th scope="col"/g) || []).length, 3, `${lang} column headers`);
    assert.equal((table[2].match(/<th scope="row"/g) || []).length, 2, `${lang} one row per option`);
    assert.match(table[2], /<thead\b[\s\S]*<\/thead>\s*<tbody\b[\s\S]*<\/tbody>/);
    // On a phone each row stacks: every cell names its column, in its language.
    const labels = [...table[2].matchAll(/<td\b[^>]*data-label="([^"]+)"/g)].map(match => match[1]);
    const headers = [...table[2].matchAll(/<th scope="col"[^>]*>([^<]+)</g)].map(match => match[1]);
    assert.deepEqual(labels, [headers[1], headers[2], headers[1], headers[2]], lang);
  }
});

const amount = text => Number(String(text).replace(/[^\d.]/g, ''));
test('every amount on the page is the offer’s: S/499 once, or S/550 as two of S/275, and each a month over twelve', () => {
  const {once: single, installments} = FUNDADORES_2027.options;
  const prices = {once: amount(single.amount), total: amount(installments.total), each: amount(installments.each)};
  assert.deepEqual(prices, {once: 499, total: 550, each: 275});
  assert.equal(prices.each * installments.count, prices.total, 'the two payments add up to the total');
  const monthly = total => (Math.round(total / 12 * 100) / 100).toFixed(2);
  assert.deepEqual([monthly(prices.once), monthly(prices.total)], ['41.58', '45.83']);
  const html = read(PAGE);
  const allowed = new Set([`S/${prices.once}`, `S/${prices.total}`, `S/${prices.each}`, `S/${monthly(prices.once)}`, `S/${monthly(prices.total)}`]);
  for (const found of html.matchAll(/S\/\s?[\d.,]+\d/g)) assert.ok(allowed.has(found[0]), `${found[0]} is not one of the offer’s amounts`);
  for (const lang of LANGS) {
    const part = block(html, lang), cells = sequence(part).filter(([tag]) => tag === 'th' || tag === 'td').map(([, text]) => text);
    const [once, onceMonthly, split, schedule, splitMonthly] = [cells[3], cells[5], cells[6], cells[7], cells[8]];
    assert.deepEqual(once.match(/S\/[\d.]+/g), [`S/${prices.once}`], `${lang} single payment`);
    assert.deepEqual(onceMonthly.match(/S\/[\d.]+/g), [`S/${monthly(prices.once)}`], `${lang} single payment a month`);
    assert.deepEqual(split.match(/S\/[\d.]+/g), [`S/${prices.total}`], `${lang} split payment`);
    assert.deepEqual(schedule.match(/S\/[\d.]+/g), Array(installments.count).fill(`S/${prices.each}`), `${lang} the two payments`);
    assert.deepEqual(splitMonthly.match(/S\/[\d.]+/g), [`S/${monthly(prices.total)}`], `${lang} split payment a month`);
    // The heading names the lower of the two monthly equivalents.
    const heading = sequence(part).filter(([tag]) => tag === 'h2')[3][1];
    assert.deepEqual(heading.match(/S\/[\d.]+/g), [`S/${monthly(Math.min(prices.once, prices.total))}`], `${lang} heading`);
    // "dos meses calendario" is the offer's monthsApart, and the discounts are its percentages.
    assert.equal(installments.monthsApart, 2);
    const text = plain(part);
    assert.ok(text.includes(`${FUNDADORES_2027.additionalTrainingDiscountPercent}%`), `${lang} training discount`);
    assert.ok(text.includes(`${FUNDADORES_2027.renewalDiscountPercent}%`), `${lang} renewal discount`);
  }
});

// fundadores.js against a page that has a button and two status lines (under the title, in the closing band) in each language. Every node it touches is kept.
async function run({lang = 'es', answer, i18n = true} = {}) {
  const node = extra => ({hidden: true, removed: false, textContent: '', dataset: {}, ...extra, remove() { this.removed = true; }});
  const joins = LANGS.map(() => node({}));
  // Per language: the line under the title (only for a closed offer) and the one in the closing band.
  const states = LANGS.flatMap(language => [node({dataset: {fundState: language, fundEndedOnly: ''}}), node({dataset: {fundState: language}})]);
  const listeners = [], requests = [];
  const document = {
    documentElement: {lang, dataset: {}},
    title: '',
    querySelectorAll: selector => (selector === '[data-fund-join]' ? joins.filter(link => !link.removed) : selector === '[data-fund-state]' ? states : []),
  };
  const context = {
    document,
    console,
    fetch: async (path, options = {}) => { requests.push({path, method: options.method || 'GET', accept: options.headers?.Accept}); return answer(); },
    window: {nodalI18n: i18n ? {onChange: fn => listeners.push(fn)} : undefined},
  };
  vm.runInNewContext(read(SCRIPT), context, {filename: 'fundadores.js'});
  for (let i = 0; i < 10; i += 1) await new Promise(resolve => setImmediate(resolve));
  return {joins, states, document, listeners, requests};
}
const json = payload => async () => ({ok: true, status: 200, async json() { return payload; }});
const NOW = Date.parse('2026-10-22T15:00:00.000Z'), AFTER = Date.parse('2027-01-01T05:00:00.000Z');
const OPEN_ENV = {MERCADOPAGO_LINK_ANNUAL: 'https://link.mercadopago.com.pe/nodal', MERCADOPAGO_LINK_INSTALLMENTS: 'https://www.mercadopago.com.pe/subscriptions/checkout?preapproval_plan_id=2c93', MEMBERSHIP_CONTACT_EMAIL: 'membresias@nodal.example', MEMBERSHIP_COMPLAINTS_URL: 'https://reclamos.example/nodal'};
// The server's own answers, so a change to their shape shows up here.
const SERVER = {open: publicBillingConfig(OPEN_ENV, NOW), soon: publicBillingConfig({}, NOW), ended: publicBillingConfig(OPEN_ENV, AFTER)};

test('the server’s three states are the ones the page reads', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(SERVER).map(([name, config]) => [name, config.state])), {open: 'open', soon: 'soon', ended: 'ended'});
});

test('while sign-ups are open the button to the payments page appears, and nothing else is said', async () => {
  const page = await run({answer: json(SERVER.open)});
  assert.deepEqual(page.requests, [{path: '/api/billing/config', method: 'GET', accept: 'application/json'}]);
  for (const link of page.joins) { assert.equal(link.removed, false); assert.equal(link.hidden, false); }
  for (const slot of page.states) { assert.equal(slot.hidden, true); assert.equal(slot.textContent, ''); }
  assert.equal('fundEnded' in page.document.documentElement.dataset, false, 'the 2026 sections stay');
});

test('once the offer has ended there is no button, each language says when it closed, and the page is marked ended', async () => {
  const page = await run({answer: json(SERVER.ended)});
  for (const link of page.joins) assert.equal(link.removed, true);
  assert.equal(page.states.length, LANGS.length * 2);
  for (const slot of page.states) { assert.equal(slot.textContent, ENDED[slot.dataset.fundState]); assert.equal(slot.hidden, false); }
  // <html data-fund-ended>: fundadores.css then hides the sections that still sell the 2026 offer.
  assert.equal(page.document.documentElement.dataset.fundEnded, '');
});

test('once the offer has ended the stylesheet hides early access, prices and the 2027 year, and nothing else', () => {
  const css = read(STYLE), html = read(PAGE);
  const hidden = [...css.matchAll(/([^{}]*\[data-fund-ended\][^{}]*)\{([^}]*)\}/g)]
    .filter(([, , body]) => /display:\s*none/.test(body)).flatMap(([, selector]) => selector.match(/\.fund-[a-z-]+/g) || []);
  assert.deepEqual([...new Set(hidden)].sort(), ['.fund-early', '.fund-price', '.fund-year']);
  // Every language has those three sections, so the rule hides the same ones in each.
  for (const lang of LANGS) for (const name of ['fund-early', 'fund-price', 'fund-year']) assert.match(block(html, lang), new RegExp(`<section class="fund-band ${name}"`), `${lang} ${name}`);
});

test('before sign-ups open, without an answer, or on static hosting, there is no button and sign-ups open soon', async () => {
  const answers = {
    soon: json(SERVER.soon),
    refused: async () => ({ok: false, status: 500, async json() { return SERVER.open; }}),
    offline: async () => { throw new TypeError('Failed to fetch'); },
    notJson: async () => ({ok: true, status: 200, async json() { throw new SyntaxError('Unexpected token <'); }}),
    // An older server said only whether checkout ran; the page reads the state.
    legacy: json({checkout: true, annual: {amount: 'S/ 240', per: '/ year'}}),
    // The page offers both ways to pay: with one link set, the other could not be bought, so it waits for both.
    onceOnly: json({...SERVER.open, options: SERVER.open.options.filter((option) => option.id === 'once')}),
    installmentsOnly: json({...SERVER.open, options: SERVER.open.options.filter((option) => option.id === 'installments')}),
    empty: json(null),
  };
  for (const [name, answer] of Object.entries(answers)) {
    const page = await run({answer});
    for (const link of page.joins) assert.equal(link.removed, true, `${name}: a closed checkout leads nowhere`);
    // "Sign-ups open soon" belongs where the button would be; the line under the title waits for a closed offer.
    for (const slot of page.states) {
      const top = 'fundEndedOnly' in slot.dataset;
      assert.equal(slot.textContent, top ? '' : SOON[slot.dataset.fundState], `${name} ${slot.dataset.fundState}`);
      assert.equal(slot.hidden, top, name);
    }
    assert.equal('fundEnded' in page.document.documentElement.dataset, false, `${name}: nothing has ended`);
  }
});

test('while the settings are on their way nothing shows: no button, no line', async () => {
  let respond;
  const page = await run({answer: () => new Promise(resolve => { respond = resolve; })});
  for (const link of page.joins) { assert.equal(link.removed, false); assert.equal(link.hidden, true); }
  for (const slot of page.states) assert.equal(slot.hidden, true);
  respond({ok: true, status: 200, async json() { return SERVER.open; }});
  for (let i = 0; i < 10; i += 1) await new Promise(resolve => setImmediate(resolve));
  for (const link of page.joins) assert.equal(link.hidden, false);
});

test('the tab is named in the language shown, and follows a language switch', async () => {
  for (const lang of LANGS) assert.equal((await run({lang, answer: json(SERVER.soon)})).document.title, TITLES[lang], lang);
  const page = await run({lang: 'es', answer: json(SERVER.soon)});
  page.document.documentElement.lang = 'pt';
  page.listeners.forEach(fn => fn('pt'));
  assert.equal(page.document.title, TITLES.pt);
  // Without the dictionaries (they failed to load) the page still names itself, in the language locale.js chose.
  assert.equal((await run({lang: 'en', i18n: false, answer: json(SERVER.soon)})).document.title, TITLES.en);
  assert.equal((await run({lang: 'fr', answer: json(SERVER.soon)})).document.title, TITLES.es, 'anything else reads as the Spanish text');
  assert.match(read(PAGE), new RegExp(`<title>${TITLES.es}</title>`));
});

test('the script writes text, never markup', () => {
  const js = read(SCRIPT);
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.match(js, /textContent/);
});

test('the button and the lines ship hidden in every language, and the terms link is always there', () => {
  const html = read(PAGE);
  for (const lang of LANGS) {
    const part = block(html, lang), line = `<p class="fund-state" data-fund-state="${lang}" hidden></p>`, top = `<p class="fund-state" data-fund-state="${lang}" data-fund-ended-only hidden></p>`;
    assert.match(part, /<a class="btn btn-primary btn-lg" href="payments\.html" data-fund-join hidden>[^<]+<\/a>/, `${lang} button`);
    // One line under the title, so a closed offer says so first, and one where the button would be.
    assert.equal(part.split('data-fund-state=').length - 1, 2, `${lang} two lines`);
    assert.ok(part.match(/<section class="fund-hero"[\s\S]*?<\/section>/)[0].includes(top), `${lang} line under the title, for a closed offer only`);
    assert.ok(part.match(/<section class="cta-band fund-join"[\s\S]*?<\/section>/)[0].includes(line), `${lang} line in the closing band`);
    assert.match(part, /<a class="link-arrow fund-terms" href="terminos-fundadores\.html" hreflang="es">[^<]+<\/a>/, `${lang} terms`);
  }
  // .btn sets display, so the stylesheet must let the hidden attribute win (styles.css does).
  assert.match(read('web/styles/styles.css'), /\.btn\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
});

test('the page works under the strict CSP: no inline script, style or handler, and its scripts load from the head', () => {
  const html = read(PAGE);
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
  assert.equal(meta, read('web/pages/privacy.html').match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1], 'the privacy page’s policy');
  assert.doesNotMatch(html, /<style\b|\sstyle="|\son[a-z]+=|javascript:/i);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  const i18n = read('web/pages/index.html').match(/src="i18n\.js\?v=([^"]+)"/)[1];
  assert.deepEqual(scripts.map(([, attributes]) => attributes.trim()), ['src="locale.js?v=20261009a"', 'defer src="nav.js?v=20261013b"', `defer src="i18n.js?v=${i18n}"`, 'defer src="fundadores.js?v=20261029a"']);
  assert.ok(scripts.every(([, , body]) => body === ''), 'no inline script');
  assert.ok(html.lastIndexOf('<script') < html.indexOf('</head>'));
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(match => match[1]);
  assert.deepEqual(sheets, ['locale.css?v=20260929a', 'fonts.css?v=20260911b', 'styles.css?v=36', 'fundadores.css?v=20261029a']);
});

test('the page has a description, the NODAL icon, and the site’s header and footer', () => {
  const html = read(PAGE), landing = read('web/pages/index.html'), privacy = read('web/pages/privacy.html');
  assert.match(html, /<meta name="description" content="Súmate a Nodal con la Membresía Fundador 2027:[^"]+">/);
  const icon = page => page.match(/<link rel="icon" href="([^"]+)"/)[1];
  assert.equal(icon(html), icon(privacy));
  // The landing's navigation (with the programme link pointing at its section) and language switch.
  const nav = page => page.match(/<nav class="nav-main"[\s\S]*?<\/nav>/)[0];
  assert.equal(nav(html), nav(landing).replace('href="#membership"', 'href="index.html#membership"'));
  const account = page => page.match(/<nav class="nav-account"[\s\S]*?<\/nav>/)[0];
  assert.equal(account(html), account(landing));
  assert.match(html, /<button type="button" class="nav-toggle" id="navToggle" aria-label="Menu" data-i18n-aria-label="nav\.menuLabel">/);
  // The landing's footer: its contact, its links and its social profiles.
  const socials = page => page.match(/<nav class="socials"[\s\S]*?<\/nav>/)[0];
  assert.equal(socials(html), socials(landing));
  for (const key of ['foot.touch', 'foot.rights', 'foot.old', 'nav.privacy']) assert.ok(html.includes(`data-i18n="${key}"`), key);
  for (const address of ['mailto:fmuro@sistemaurbano.org', 'mailto:malegre@sistemaurbano.org']) assert.ok(html.includes(address), address);
  // A skip link in each language, to the content.
  assert.match(html, /<a class="fund-skip" href="#contenido">(?:<span data-fund-lang="(?:es|en|pt)" lang="(?:es|en|pt)">[^<]+<\/span>){3}<\/a>/);
  assert.match(html, /<main id="contenido"/);
});

test('the page ships to the CDN like the terms page, with the same headers for it, its script and its style', () => {
  assert.ok(STATIC_PAGES.includes('fundadores.html'));
  const build = read('scripts/build-static.js');
  assert.ok(build.includes(`'fundadores.js'`) && build.includes(`'fundadores.css'`));
  const {headers} = JSON.parse(read('vercel.json'));
  const rules = path => headers.filter(rule => new RegExp(`^${rule.source}$`).test(path)).map(rule => rule.source);
  const merged = path => Object.fromEntries(headers.filter(rule => new RegExp(`^${rule.source}$`).test(path)).flatMap(rule => rule.headers.map(({key, value}) => [key, value])));
  for (const [file, like] of [['/fundadores.html', '/terminos-fundadores.html'], ['/fundadores.js', '/membership-terms.js'], ['/fundadores.css', '/terms.css']]) {
    assert.deepEqual(rules(file), rules(like), file);
    assert.deepEqual(merged(file), merged(like), file);
  }
  assert.equal(staticSourcePath('/fundadores.html'), new URL('../' + PAGE, import.meta.url).pathname);
  assert.equal(staticSourcePath('/fundadores.js'), new URL('../' + SCRIPT, import.meta.url).pathname);
  assert.equal(staticSourcePath('/fundadores.css'), new URL('../' + STYLE, import.meta.url).pathname);
});

test('a signed-out visitor reads the page, and its button takes them to sign in and back to the payments page', async (t) => {
  const db = createDatabase({filename: ':memory:'});
  t.after(() => db.close());
  const server = createApp({db, billingEnv: {}, pilotMode: false, citySearch: {search: async () => ({cities: []})}});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(`${base}/fundadores.html`, {redirect: 'manual'});
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.ok((await page.text()).includes('Las ciudades cambian cuando nos'));
  for (const [file, type] of [['/fundadores.js', /javascript/], ['/fundadores.css', /^text\/css/]]) {
    const res = await fetch(`${base}${file}`);
    assert.equal(res.status, 200, file);
    assert.match(res.headers.get('content-type'), type, file);
    await res.arrayBuffer();
  }
  const payments = await fetch(`${base}/payments.html`, {redirect: 'manual'});
  assert.equal(payments.status, 302);
  assert.equal(payments.headers.get('location'), `/login.html?next=${encodeURIComponent('/payments.html')}`);
});

test('the team’s emphasis is kept: the bold phrases of their document, and the italic note under the prices', () => {
  const html = read(PAGE), css = read('web/styles/fundadores.css');
  const strong = [...html.matchAll(/<strong>([^<]+)<\/strong>/g)].map((match) => match[1]);
  for (const phrase of ['Nodal es una comunidad para conectar, colaborar y transformar nuestras ciudades desde el Urbanismo Colaborativo.', 'badge Founder', '1 de enero al 31 de diciembre de 2027', '5% de descuento sobre la tarifa regular vigente', 'no necesitas completar el segundo para acceder a ellos'])
    assert.ok(strong.includes(phrase), phrase);
  assert.equal(strong.length % 3, 0, 'the same phrases in each language');
  assert.match(css, /\.fund-note \{[^}]*font-style: italic;/);
});
