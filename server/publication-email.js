import {emailLetter, COPY, INK, MUTED, FOREST} from './email-letter.js';

const copy = {
  es: {
    news: ['Noticias de la red', 'Leer la noticia', 'Una nueva publicación de la comunidad de NODAL.'],
    opportunity: ['Oportunidad destacada', 'Ver la oportunidad', 'Encuentra los detalles de la convocatoria en NODAL.'],
    by: 'Publicado por', organization: 'Organización', image: 'Imagen',
    reason: 'Recibes este correo porque activaste las novedades de NODAL.',
    manage: 'Cambiar mi preferencia', privacy: 'Política de privacidad',
  },
  en: {
    news: ['Network news', 'Read the story', 'A new publication from the NODAL community.'],
    opportunity: ['Featured opportunity', 'View the opportunity', 'Find the details of this opportunity on NODAL.'],
    by: 'Published by', organization: 'Organization', image: 'Image',
    reason: 'You are receiving this email because you subscribed to NODAL updates.',
    manage: 'Change my preference', privacy: 'Privacy policy',
  },
  pt: {
    news: ['Notícias da rede', 'Ler a notícia', 'Uma nova publicação da comunidade NODAL.'],
    opportunity: ['Oportunidade em destaque', 'Ver a oportunidade', 'Confira os detalhes desta oportunidade na NODAL.'],
    by: 'Publicado por', organization: 'Organização', image: 'Imagem',
    reason: 'Você recebe este e-mail porque ativou as novidades da NODAL.',
    manage: 'Alterar minha preferência', privacy: 'Política de privacidade',
  },
};

const graphemes = new Intl.Segmenter(undefined, {granularity:'grapheme'});
const singleLine = value => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';

const blockTags = new Set(['p','div','li','ul','ol','br','h1','h2','h3','h4','h5','h6']);
// Each attribute match consumes either one unquoted character or a whole quoted string.
// A literal less-than sign ends the candidate, so a comparison in the text stays intact.
const pastedTag = /<\/?([a-z][\w:-]{0,64})(?=[\s/>])(?:[^<>"']|"[^"<]*"|'[^'<]*')*>/gi;

function previewText(value) {
  if (typeof value !== 'string') return '';
  return singleLine(value
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style)\b[^<>]{0,512}>[\s\S]*?(?:<\/\1\s{0,32}>|$)/gi, '')
    .replace(pastedTag, (_, tag) => blockTags.has(tag.toLowerCase()) ? ' ' : '')
    .replace(/&nbsp;/gi, ' '));
}

function shorten(text, limit) {
  const characters = Array.from(graphemes.segment(text), part => part.segment);
  if (characters.length <= limit) return text;
  let prefix = characters.slice(0, limit - 1).join('');
  const space = prefix.lastIndexOf(' ');
  if (space > 0 && characters[limit - 1] !== ' ') prefix = prefix.slice(0, space);
  return prefix.trimEnd() + '…';
}

// The stored route identifies a public editorial asset, never a reader or a third-party host.
const publicationCoverPath = /^\/api\/publication-covers\/(news|opportunity)\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-f0-9]{64}\.jpg$/;

export function publicationEmail({language, title, excerpt, authorName, organizationName, opportunity, destination, origin, coverUrl, coverAlt}) {
  const lang = Object.hasOwn(copy, language) ? language : 'es';
  const {by, organization, reason, manage, privacy, image} = copy[lang];
  const kind = opportunity ? 'opportunity' : 'news';
  const [section, action, fallbackPreview] = copy[lang][kind];
  const author = singleLine(authorName);
  const org = singleLine(organizationName);
  const credits = [];
  if (author) credits.push([by + ' ', author]);
  if (org && org.localeCompare(author, lang, {sensitivity:'accent'}) !== 0) credits.push([organization + ' · ', org]);
  const rawExcerpt = previewText(excerpt);
  const summary = rawExcerpt === singleLine(title) ? '' : shorten(rawExcerpt, 280);
  const creditLines = credits.map(([label, value]) => label + value);
  const preheader = shorten(summary || creditLines[0] || fallbackPreview, 120);
  const preference = origin + '/community.html#news-email';
  const policy = origin + '/privacy.html';
  const subject = 'NODAL · ' + title;
  const {e, type, p, a, lockup, pressPlate, document} = emailLetter(lang, origin, {card:true});
  const cover = typeof coverUrl === 'string' && publicationCoverPath.exec(coverUrl)?.[1] === kind;
  const description = cover ? singleLine(coverAlt) : '';
  const imagePath = cover ? coverUrl : '/assets/email/nodal-network-map-v1.png';
  // Editorial uploads already contain the whole picture on a 1080×600 canvas. Fixed Outlook
  // dimensions and fluid width elsewhere preserve it without depending on client-side cropping.
  const banner = `<img src="${e(origin + imagePath)}" width="536"${cover ? ' height="298"' : ''} alt="${e(description)}"${description ? '' : ' role="presentation"'} style="display:block;width:100%;max-width:100%;height:auto;border:0;${description ? type(14,20,400,MUTED) : ''}">`;
  const creditHtml = credits.map(([label,value]) => `${e(label)}<strong>${e(value)}</strong>`).join('<br>');
  const body = [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="pub-logo" valign="middle">${lockup}</td>
      <td align="right" valign="middle" style="padding-left:8px;text-align:right;">
        <p class="c-forest" style="margin:0;${type(11,16,700,FOREST,'letter-spacing:0.8px;text-transform:uppercase;')}">${e(section)}</p>
      </td></tr></table>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>
      <td style="padding:20px 0 0;font-size:0;line-height:0;">
        ${banner}
      </td></tr><tr><td style="padding:23px 0 22px;overflow-wrap:anywhere;word-wrap:break-word;">
        <h1 class="c-ink pub-title" style="margin:0;${type(35,40,800,INK,'letter-spacing:-0.8px;')}">${e(title)}</h1>
        ${creditHtml ? p(creditHtml, {size:14,lh:21,color:FOREST,cls:'c-forest',margin:'10px 0 0'}) : ''}
        ${summary ? p(e(summary), {size:16,lh:25,color:COPY,margin:'16px 0 0'}) : ''}
      </td></tr></table>`,
    pressPlate(destination, action),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-top:30px;"><div style="border-top:1px solid #cbd2c8;font-size:0;line-height:0;">&nbsp;</div></td>
      </tr><tr><td style="padding-top:16px;">
        ${p('NODAL &middot; Nodos Urbanos de Am&eacute;rica Latina', {size:13,lh:20,weight:700,color:INK,cls:'c-ink',margin:'0 0 4px'})}
        ${p(e(reason), {size:13,lh:20,color:MUTED,cls:'c-muted',margin:'0 0 3px'})}
        ${p(a(preference,e(manage))+' &nbsp;&middot;&nbsp; '+a(policy,e(privacy)), {size:13,lh:20,color:MUTED,cls:'c-muted',margin:'0'})}
      </td></tr></table>`,
  ].join('\n');
  const text = [
    section, title, ...creditLines, ...(summary ? ['', summary] : []), ...(description ? ['', image+' · '+description] : []),
    '', action + ': ' + destination, '', reason, manage + ': ' + preference, privacy + ': ' + policy,
  ].join('\n');
  return {subject, language:lang, text, html:document({subject, preheader, body})};
}
