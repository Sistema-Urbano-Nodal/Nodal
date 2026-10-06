import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const copy = {
  en: {
    file:'en', title:'Privacy policy', home:'Back to NODAL', contents:'On this page', skip:'Skip to policy',
    date:'Updated 5 October 2026', status:'Draft for review',
    notice:'This is a public draft. The legal entity, privacy contact, retention periods and provider arrangements are still being confirmed. It has not yet been adopted as a final policy.',
    controller:'NODAL is a learning and networking platform for people interested in urban issues. The legal identity, registration and address of the entity responsible for personal data are awaiting confirmation.',
    contact:'the team’s existing contact details',
    contactParagraph:'For questions, requests or complaints about your data, use [the team’s existing contact details](index.html#contact), including if you do not have an account or cannot sign in. The privacy lead or data protection officer has not yet been formally designated.',
    providers:'The complete provider list, processing countries and transfer safeguards are awaiting confirmation.',
    retention:'Retention periods for these categories, including backups and staff exports, are awaiting approval and implementation.',
    age:'awaiting confirmation', top:'Back to top', language:'Language', table:'Data categories and purposes',
  },
  es: {
    file:'es', title:'Política de privacidad', home:'Volver a NODAL', contents:'En esta página', skip:'Ir a la política',
    date:'Actualizado el 5 de octubre de 2026', status:'Borrador en revisión',
    notice:'Este es un borrador público. La entidad responsable, el contacto de privacidad, los plazos de conservación y los acuerdos con proveedores están pendientes de confirmación. Aún no se ha adoptado como política definitiva.',
    controller:'NODAL es una plataforma de aprendizaje y conexión entre personas interesadas en temas urbanos. La identidad legal, el registro y el domicilio de la entidad responsable de los datos están pendientes de confirmación.',
    contact:'los contactos actuales del equipo',
    contactParagraph:'Para consultas, solicitudes o reclamos sobre tus datos, utiliza [los contactos actuales del equipo](index.html#contact), aunque no tengas una cuenta o no puedas acceder a ella. La designación formal de la persona responsable de privacidad está pendiente.',
    providers:'La lista completa de proveedores, los países de tratamiento y las garantías de transferencia están pendientes de confirmación.',
    retention:'Los plazos de conservación de estas categorías, incluidas las copias de seguridad y las exportaciones del equipo, están pendientes de aprobación e implementación.',
    age:'pendiente de confirmación', top:'Volver al inicio', language:'Idioma', table:'Categorías de datos y finalidades',
  },
  pt: {
    file:'pt-BR', title:'Política de privacidade', home:'Voltar à NODAL', contents:'Nesta página', skip:'Ir para a política',
    date:'Atualizado em 5 de outubro de 2026', status:'Minuta em revisão',
    notice:'Esta é uma minuta pública. A entidade responsável, o contato de privacidade, os prazos de retenção e os acordos com fornecedores ainda estão em confirmação. Ela ainda não foi adotada como política definitiva.',
    controller:'A NODAL é uma plataforma de aprendizagem e conexão entre pessoas interessadas em temas urbanos. A identidade jurídica, o registro e o endereço da entidade responsável pelos dados ainda estão em confirmação.',
    contact:'os contatos atuais da equipe',
    contactParagraph:'Para dúvidas, solicitações ou reclamações sobre seus dados, use [os contatos atuais da equipe](index.html#contact), mesmo sem uma conta ou sem conseguir acessá-la. A designação formal da pessoa responsável pela privacidade ainda está pendente.',
    providers:'A relação completa de fornecedores, os países de tratamento e as garantias de transferência ainda estão em confirmação.',
    retention:'Os prazos de retenção dessas categorias, incluindo cópias de segurança e exportações da equipe, aguardam aprovação e implementação.',
    age:'em confirmação', top:'Voltar ao início', language:'Idioma', table:'Categorias de dados e finalidades',
  },
};

const escape = text => String(text).replace(/[&<>"']/g, value => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]));
// Deliberately limited to the authored policy's Markdown. No raw HTML or
// arbitrary URL schemes are accepted; this is build-time content, not input.
function inline(text) {
  return escape(text).replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+|index\.html#contact)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
function blocks(text, labels) {
  return text.trim().split(/\n\s*\n/).map(block => {
    if (block.includes('{{CONTROLADOR}}')) block = labels.controller;
    if (block.includes('{{ENCARREGADO}}')) block = labels.contactParagraph;
    block = block.replaceAll('{{CONTATO_PRIVACIDADE}}',`[${labels.contact}](index.html#contact)`)
      .replaceAll('**{{FORNECEDORES_TRANSFERENCIAS}}**',labels.providers)
      .replaceAll('**{{RETENCAO}}**',labels.retention)
      .replaceAll('{{PUBLICO_ETARIO}}',labels.age);
    if (/\{\{/.test(block)) throw new Error('Unresolved privacy publication field');
    if (block.startsWith('|')) {
      const rows = block.split('\n').filter(row => !/^\|[\s|:-]+\|$/.test(row))
        .map(row => row.split('|').slice(1,-1).map(cell => cell.trim()));
      return `<div class="policy-table" role="region" aria-label="${labels.table}" tabindex="0"><table><thead><tr>${rows[0].map(cell=>`<th scope="col">${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(row=>`<tr>${row.map(cell=>`<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    if (block.startsWith('- ')) return `<ul>${block.split('\n').map(line=>`<li>${inline(line.replace(/^- /,''))}</li>`).join('')}</ul>`;
    return `<p>${inline(block)}</p>`;
  }).join('\n');
}

export async function renderPrivacyPage() {
  const versions = await Promise.all(Object.entries(copy).map(async ([lang,labels]) => {
    const md = await readFile(path.join(ROOT,'docs/privacy',`privacy-policy.${labels.file}.md`),'utf8');
    const sections = [...md.matchAll(/^## (\d+)\. ([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
    if (sections.length !== 12) throw new Error(`Expected 12 privacy sections for ${lang}`);
    return `<article data-policy-lang="${lang}" lang="${lang}" data-title="${labels.title}">
<h1>${labels.title}</h1><p class="policy-date">${labels.date}</p>
<aside class="policy-draft"><strong>${labels.status}</strong><p>${labels.notice}</p></aside>
<nav class="policy-contents" aria-label="${labels.contents}"><h2>${labels.contents}</h2><ol>${sections.map(([,n,title])=>`<li><a href="#${lang}-${n}">${escape(title)}</a></li>`).join('')}</ol></nav>
${sections.map(([,n,title,body])=>`<section id="${lang}-${n}"><h2>${n}. ${escape(title)}</h2>\n${blocks(body,labels)}</section>`).join('\n')}
<a class="policy-top" href="#top">${labels.top} ↑</a>
</article>`;
  }));
  const localized = key => Object.entries(copy).map(([lang,labels])=>`<span data-policy-lang="${lang}" lang="${lang}">${labels[key]}</span>`).join('');
  return `<!DOCTYPE html>
<!-- Generated from docs/privacy/privacy-policy.*.md by scripts/build-privacy-page.js. -->
<html lang="en" translate="no">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'">
  <meta name="robots" content="noindex, follow">
  <title>NODAL · Privacy policy</title>
  <link rel="stylesheet" href="locale.css?v=20260929a">
  <script src="locale.js?v=20260918b"></script>
  <link rel="preload" href="assets/fonts/montserrat-v31-latin-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="fonts.css?v=20260911b">
  <link rel="stylesheet" href="privacy.css?v=20260919a">
  <script defer src="privacy.js?v=20260919a"></script>
</head>
<body id="top">
  <a class="policy-skip" href="#policy">${localized('skip')}</a>
  <header class="policy-header">
    <a class="policy-brand" href="index.html" aria-label="NODAL"><img src="assets/nodal-wordmark.webp" width="112" height="47" alt="NODAL"></a>
    <a class="policy-home" href="index.html">${localized('home')}</a>
    <div class="policy-languages" role="group" aria-label="Language" data-policy-label="language">
      <button type="button" data-lang="en" aria-label="English" aria-pressed="true">EN</button>
      <button type="button" data-lang="es" aria-label="Español" aria-pressed="false">ES</button>
      <button type="button" data-lang="pt" aria-label="Português" aria-pressed="false">PT</button>
    </div>
  </header>
  <main class="policy-main" id="policy">${versions.join('\n')}</main>
  <footer class="policy-footer"><span>NODAL</span><a href="index.html">${localized('home')}</a></footer>
</body>
</html>
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await writeFile(path.join(ROOT,'web/pages/privacy.html'),await renderPrivacyPage());
}
