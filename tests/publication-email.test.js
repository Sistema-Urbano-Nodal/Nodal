import test from 'node:test';
import assert from 'node:assert/strict';
import {publicationEmail} from '../server/publication-email.js';
import {partyEmail, registrationEmail} from '../server/fiiu-email.js';

const origin = 'https://example.test';
const render = options => publicationEmail({
  language:'pt', title:'Caminhos para a escola', origin, destination:origin + '/community.html#nodal-news', ...options,
});
const preheader = html => html.match(/<div style="display:none;[^"]*">([^<]*)<\/div>/)[1];

test('the plain and HTML versions use the published excerpt and public credits', () => {
  const {html,text} = render({
    excerpt:'<p>O percurso tem 1 < 3 travessias e <em title="A > B">novas</em> árvores & bancos.</p><script>hidden()</script><p>Veja o mapa.</p>',
    authorName:'  Ana   & João ', organizationName:'Instituto da Praça',
  });
  const preview = 'O percurso tem 1 < 3 travessias e novas árvores & bancos. Veja o mapa.';
  const htmlPreview = 'O percurso tem 1 &lt; 3 travessias e novas árvores &amp; bancos. Veja o mapa.';
  assert.ok(text.includes(preview));
  assert.equal(preheader(html), htmlPreview);
  assert.ok(html.includes('>' + htmlPreview + '</p>'));
  assert.ok(text.includes('Publicado por Ana & João\nOrganização · Instituto da Praça'));
  assert.ok(html.includes('Publicado por <strong>Ana &amp; João</strong>'));
  assert.doesNotMatch(text + html, /hidden\(\)|title="A > B"/);
});

test('long summaries stop on whole words and long unspaced tokens on whole graphemes', () => {
  const excerpt = 'calçada '.repeat(100).trim();
  const {text,html} = render({excerpt});
  const paragraph = text.split('\n\n')[1];
  assert.match(paragraph,/^(?:calçada )*calçada…$/u);
  assert.ok(paragraph.length <= 280);
  assert.match(preheader(html),/^(?:calçada )*calçada…$/u);
  assert.ok(preheader(html).length <= 120);
  const glyph = '👩🏽‍🏫';
  const token = render({excerpt:glyph.repeat(500)});
  assert.equal(token.text.split('\n\n')[1], glyph.repeat(279) + '…');
  assert.equal(preheader(token.html), glyph.repeat(119) + '…');
});

test('missing or repeated metadata leaves a meaningful localized preview', () => {
  const title = 'Recursos para praças';
  const empty = render({title,opportunity:true,language:'en',excerpt:'<p>'+title+'</p>',authorName:'  ',organizationName:null});
  assert.equal(preheader(empty.html), 'Find the details of this opportunity on NODAL.');
  assert.doesNotMatch(empty.text, /Published by|Organization/);
  assert.equal(empty.text.split(title).length, 2);
  const author = render({authorName:'Rede Centro',organizationName:' rede   centro '});
  assert.equal(preheader(author.html),'Publicado por Rede Centro');
  assert.doesNotMatch(author.text,/Organização/);
  const organization = render({language:'es',organizationName:'Plaza Centro'});
  assert.equal(preheader(organization.html),'Organización · Plaza Centro');
  assert.doesNotMatch(organization.text,/Publicado por/);
});

test('only publication emails put a white card inside the beige page', () => {
  for (const opportunity of [false,true]) {
    const {html} = render({opportunity});
    assert.match(html, /<body class="bg" bgcolor="#F2ECEC"/);
    assert.match(html, /<td class="pub-card pub-card-cell" bgcolor="#ffffff"[^>]*>[\s\S]*alt="NODAL"[\s\S]*<h1[\s\S]*minha preferência/);
    assert.match(html, /prefers-color-scheme:dark\)\{\.pub-card\{/);
  }
  const options={language:'pt',origin,registration:{answers:{}},config:{}};
  for (const {html} of [registrationEmail(options),partyEmail(options)]) {
    assert.match(html, /<body class="bg" bgcolor="#F2ECEC"/);
    assert.doesNotMatch(html, /pub-card/);
  }
});

test('news and opportunity links use one flat button cell in light and dark mode', () => {
  for (const opportunity of [false,true]) {
    const destination = origin + '/publication';
    const {html} = render({opportunity,destination});
    const button = html.match(/<table\b[^>]*><tr><td class="pub-btn"[^>]*>[\s\S]*?<\/table>/)?.[0];
    assert.ok(button);
    assert.equal(button.match(/<td\b/g)?.length,1);
    assert.ok(button.includes('href="' + destination + '"'));
    assert.match(button, /bgcolor="#59BC53"[^>]*border:2px solid #59BC53/);
    assert.doesNotMatch(html, /btn-shadow|box-shadow|drop-shadow/);
  }
});

const itemId = 'c53bc3a0-d50b-4e11-9a12-8e240f8e8cd3';
const revision = 'abcd0123'.repeat(8);
const coverPath = kind => '/api/publication-covers/' + kind + '/' + itemId + '/' + revision + '.jpg';
const mapPath = '/assets/email/nodal-network-map-v1.png';

for (const [kind, opportunity] of [['news', false], ['opportunity', true]]) {
  test(kind + ' uses its public versioned cover at the photo aspect ratio', () => {
    const coverUrl = coverPath(kind);
    const coverAlt = 'Estudantes & famílias diante da placa "Escola"';
    const {html, text} = render({opportunity, coverUrl, coverAlt});
    const img = html.match(/<img\b[^>]*\/api\/publication-covers\/[^>]*>/)?.[0];
    assert.ok(img);
    assert.ok(img.includes('src="' + origin + coverUrl + '"'));
    assert.ok(img.includes('alt="Estudantes &amp; famílias diante da placa &quot;Escola&quot;"'));
    assert.match(img, /width="536" height="298"/);
    assert.match(img, /width:100%;[^"]*height:auto/);
    assert.doesNotMatch(img, /object-fit|role="presentation"/);
    assert.ok(!html.includes(mapPath));
    assert.ok(text.includes(coverAlt));
  });
}

test('optional and untrusted cover values fall back to the slim map and ignore stale descriptions', () => {
  for (const coverUrl of [undefined, null, '', 'https://remote.test/cover.jpg', origin + coverPath('news'),
    '//remote.test'+coverPath('news'), coverPath('opportunity'), coverPath('news')+'?tracking=1',
    coverPath('news')+'#other', coverPath('news').replace(revision,'latest'), coverPath('news').replace(itemId,'../private'),
    '/api/workspace/attachments/'+itemId]) {
    const {html, text} = render({coverUrl, coverAlt:'Unused editorial description'});
    assert.ok(html.includes('src="'+origin+mapPath+'"'));
    assert.doesNotMatch(html + text, /Unused editorial description|remote\.test|api\/publication-covers|workspace\/attachments/);
    assert.match(html, /nodal-network-map-v1\.png" width="536" alt="" role="presentation"/);
  }
  const {html} = render({coverUrl:coverPath('news')});
  assert.match(html, /<img\b[^>]*\/api\/publication-covers\/[^>]*alt="" role="presentation"/);
});
