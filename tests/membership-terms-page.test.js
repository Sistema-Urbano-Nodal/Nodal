/* The public commercial terms of Nodal Fundadores 2027 (/terminos-fundadores.html), from section 2 of the team's
   document "Condiciones de pago y membresía de pago" (docs/superpowers/specs/2026-10-21-nodal-fundadores-design.md).
   docs/membership/terminos-fundadores-2027.md is the reviewable source of the same text. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STATIC_PAGES} from '../scripts/build-static.js';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const PAGE = 'web/pages/terminos-fundadores.html', SOURCE = 'docs/membership/terminos-fundadores-2027.md';
const SECTIONS = [
  'Identificación del proveedor', 'Modalidades de acceso', 'Beneficios de las membresías', 'Curso y masterclass incluidos durante 2027',
  'Descuento en formación adicional', 'Precio de Nodal Fundadores 2027', 'Cálculo del vencimiento del segundo pago', 'Acceso anticipado y vigencia',
  'Autorización de pagos automáticos', 'Contrataciones anteriores con segundo pago a seis meses', 'Renovación automática',
  'No renovación, cancelación y solicitudes de devolución', 'Pagos rechazados y período de gracia', 'Conservación del perfil y condición de Fundador',
  'Servicios y actividades adicionales', 'Información contractual y aceptación', 'Atención y reclamaciones', 'Condiciones complementarias',
];
const PENDING = 'pendiente de publicación';
// The legal text, without the page around it or its table of contents.
const article = html => html.match(/<article class="terms-text" lang="es">([\s\S]*?)<\/article>/)[1].replace(/<nav\b[\s\S]*?<\/nav>/, '');
const section = (html, n) => html.match(new RegExp(`<section id="seccion-${n}">([\\s\\S]*?)</section>`))?.[1];
const entities = {'&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&#39;':"'", '&nbsp;':' '};
const words = text => text.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, entity => entities[entity]).replace(/\s+/g, ' ').trim();
// Inline tags join their text to what follows ("<a>…</a>."); every other tag separates words.
const pageText = html => words(html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<\/?(?:a|strong|span|time)\b[^>]*>/g, '').replace(/<[^>]+>/g, ' '));
const sourceText = md => words(md.replace(/<!--[\s\S]*?-->/g, ' ').replace(/^\|[\s|:-]+\|$/gm, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/^#+ /gm, ' ').replace(/^- /gm, ' ').replace(/\*\*/g, '').replace(/\|/g, ' '));
const pageLinks = html => [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(([, href, text]) => [href, pageText(text)]);
const sourceLinks = md => [...md.replace(/<!--[\s\S]*?-->/g, '').matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map(([, text, href]) => [href, words(text)]);

test('the terms page carries all 18 numbered sections of the team’s terms, with the version and the effective date', () => {
  const html = read(PAGE), text = article(html);
  assert.match(html, /<html lang="es"/);
  assert.match(text, /<h1>Términos comerciales de membresías 2027<\/h1>/);
  assert.equal((text.match(/<section /g) || []).length, 18);
  SECTIONS.forEach((title, index) => {
    const n = index + 1;
    assert.ok(section(text, n)?.includes(`<h2>${n}. ${title}</h2>`), `section ${n}: ${title}`);
    assert.ok(html.includes(`<a href="#seccion-${n}">${title}</a>`), `contents link to section ${n}`);
  });
  const plain = pageText(text);
  assert.ok(plain.includes('Versión: FUNDADORES-2027-v1'), 'version');
  assert.ok(plain.includes('Vigente para nuevas contrataciones desde: 21 de octubre de 2026'), 'effective date');
  assert.match(text, /<time datetime="2026-10-21">21 de octubre de 2026<\/time>/);
  for (const file of [PAGE, SOURCE]) {
    assert.doesNotMatch(read(file), /AGREGAR|\[(?:CONOCE|TÉRMINOS|LIBRO)/i, `${file}: every field is filled`);
    assert.doesNotMatch(read(file), /---- page|●/, `${file}: no PDF page markers or bullet glyphs`);
  }
  // Only section 2 of the document: not its internal intro, the membership page text, the purchase checkboxes or the team note.
  for (const absent of ['Aquí tienes la versión consolidada', 'Elige tu modalidad de pago', 'He leído y acepto', 'PARA NOSOTRAS', 'Antes de publicar, completa'])
    assert.ok(!html.includes(absent), absent);
  // The two parts of the document disagreed on the address; the terms use the membership page's.
  assert.ok(section(text, 1).includes('Domicilio: Calle General Varela 154 A, Miraflores'));
  assert.doesNotMatch(html, /Varela 154,/);
  // A word joined across a PDF line break in the source ("pagos.No") is separated again.
  assert.ok(section(text, 4).includes('modalidad de dos pagos. No se exige'));
});

/* The page is public, so it links only to public pages: the payments page and the courses sit behind sign-in (and the
   course pilot sends the payments page to the courses while sign-ups are not open). */
test('the terms link to the public membership benefits and the privacy policy, and name the 2026 programme and the general conditions without a link', () => {
  const html = read(PAGE), text = article(html);
  const links = pageLinks(text);
  const hrefs = new Set(links.map(([href]) => href));
  assert.deepEqual([...hrefs].sort(), ['/#membership', '/privacy.html'], 'no other link in the legal text');
  const benefits = section(text, 3);
  assert.match(benefits, /<li>Acceso Comunitario: <a href="\/#membership">[^<]+<\/a>\.<\/li>/);
  assert.match(benefits, /<li>Nodal Fundadores: <a href="\/#membership">beneficios de Nodal Fundadores[^<]*<\/a>\.<\/li>/);
  assert.ok(read('web/pages/index.html').includes('<section class="section membership" id="membership">'), 'the landing page’s membership section');
  assert.ok(section(text, 4).includes('Aquí puedes ver, a modo de ejemplo, la programación 2026.'), 'named, without a link to the member-only courses');
  const complementary = section(text, 18);
  assert.match(complementary, /<li>Condiciones generales de uso de la plataforma\.<\/li>/, 'kept, but promising no link NODAL does not have');
  assert.match(complementary, /<li><a href="\/privacy\.html">Política de privacidad<\/a>\.<\/li>/);
});

test('the second-payment examples are a table with column headers', () => {
  const table = section(article(read(PAGE)), 7).match(/<table>([\s\S]*?)<\/table>/)?.[1];
  assert.ok(table, 'section 7 has a table');
  assert.match(table, /<thead><tr><th scope="col">Primer pago aprobado<\/th><th scope="col">Vencimiento del segundo pago<\/th><\/tr><\/thead>/);
  const rows = [...table.matchAll(/<tr><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)].map(([, first, second]) => [first, second]);
  assert.deepEqual(rows, [
    ['20 de octubre de 2026', '20 de diciembre de 2026'],
    ['30 de noviembre de 2026', '30 de enero de 2027'],
    ['31 de diciembre de 2026', '28 de febrero de 2027'],
  ]);
});

test('every contact field waits for the settings, saying it is pending until the script fills it', () => {
  const text = article(read(PAGE));
  const slots = kind => [...text.matchAll(new RegExp(`<span class="terms-pending" data-terms-contact="${kind}">([^<]*)</span>`, 'g'))].map(match => match[1]);
  assert.deepEqual(slots('email'), [PENDING, PENDING, PENDING], 'the contact email in sections 1, 12 and 17');
  assert.deepEqual(slots('complaints'), [PENDING, PENDING], 'the Libro de Reclamaciones in sections 1 and 17');
  assert.equal((text.match(/data-terms-contact=/g) || []).length, 5);
  assert.ok(section(text, 1).includes(`Correo de atención: <span class="terms-pending" data-terms-contact="email">${PENDING}</span>`));
  assert.ok(section(text, 1).includes(`Libro de Reclamaciones: <span class="terms-pending" data-terms-contact="complaints">${PENDING}</span>`));
  assert.ok(section(text, 12).includes(`Canal de atención para estas solicitudes: <span class="terms-pending" data-terms-contact="email">${PENDING}</span>.`));
  assert.ok(section(text, 17).includes(`Correo de atención: <span class="terms-pending" data-terms-contact="email">${PENDING}</span>.`));
  assert.ok(section(text, 17).includes(`Libro de Reclamaciones: <span class="terms-pending" data-terms-contact="complaints">${PENDING}</span>.`));
});

test('the reviewable source and the page carry the same Spanish text and the same links', () => {
  const html = read(PAGE), md = read(SOURCE), text = article(html);
  assert.equal(pageText(text), sourceText(md), `edit ${SOURCE} and ${PAGE} together`);
  assert.deepEqual(pageLinks(text), sourceLinks(md));
  assert.equal((md.match(/^## \d+\. /gm) || []).length, 18);
});

test('the page says in English and Portuguese that the Spanish text is the binding one, before the terms', () => {
  const html = read(PAGE);
  const note = html.match(/<aside class="terms-language"[^>]*>([\s\S]*?)<\/aside>/)?.[1];
  assert.ok(note, 'a language note');
  assert.ok(html.indexOf(note) < html.indexOf('<article class="terms-text"'), 'before the terms');
  assert.match(note, /<p lang="en">[^<]*Spanish[^<]*binding[^<]*<\/p>/);
  assert.match(note, /<p lang="pt">[^<]*espanhol[^<]*vinculante[^<]*<\/p>/);
  assert.doesNotMatch(html, /data-lang=|data-policy-lang=/, 'the legal text has no translations to switch to');
});

test('the page works under the strict CSP: no inline script, style or handler, and its scripts load deferred from the head', () => {
  const html = read(PAGE);
  const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
  assert.equal(meta, read('web/pages/privacy.html').match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1], 'the privacy page’s policy');
  assert.doesNotMatch(html, /<style\b|\sstyle="|\son[a-z]+=|javascript:/i);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.deepEqual(scripts.map(([, attributes]) => attributes.trim()), ['defer src="membership-terms.js?v=20261021a"']);
  assert.ok(scripts.every(([, , body]) => body === ''), 'no inline script');
  assert.ok(html.indexOf('<script') < html.indexOf('</head>'));
  assert.match(html, /<link rel="stylesheet" href="terms\.css\?v=20261021a">/);
  assert.match(html, /<link rel="stylesheet" href="fonts\.css\?v=20260911b">/);
});

test('the page has a title, a description and the NODAL icon', () => {
  const html = read(PAGE), privacy = read('web/pages/privacy.html');
  assert.match(html, /<title>NODAL · Términos comerciales de membresías 2027<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]*Nodal Fundadores 2027[^"]*">/);
  const icon = page => page.match(/<link rel="icon" href="[^"]+">/)[0];
  assert.equal(icon(html), icon(privacy));
});

test('the page ships to the CDN like the privacy page, with the same headers for it, its script and its style', () => {
  assert.ok(STATIC_PAGES.includes('terminos-fundadores.html'));
  const build = read('scripts/build-static.js');
  assert.ok(build.includes(`'membership-terms.js'`) && build.includes(`'terms.css'`));
  const {headers} = JSON.parse(read('vercel.json'));
  const rules = path => headers.filter(rule => new RegExp(`^${rule.source}$`).test(path)).map(rule => rule.source);
  const merged = path => Object.fromEntries(headers.filter(rule => new RegExp(`^${rule.source}$`).test(path)).flatMap(rule => rule.headers.map(({key, value}) => [key, value])));
  for (const [file, like] of [['/terminos-fundadores.html', '/privacy.html'], ['/membership-terms.js', '/privacy.js'], ['/terms.css', '/privacy.css']]) {
    assert.deepEqual(rules(file), rules(like), file);
    assert.deepEqual(merged(file), merged(like), file);
  }
  assert.match(merged('/terminos-fundadores.html')['Content-Security-Policy'], /frame-ancestors 'none'/);
});
