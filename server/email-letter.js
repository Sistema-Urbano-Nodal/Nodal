// Shared NODAL email stationery. Use inline styles and table cells for Gmail and Outlook.
const FONT="'Montserrat',Arial,Helvetica,sans-serif";
export const PAPER='#F2ECEC',INK='#1d271b',COPY='#2f3a2b',MUTED='#586253',FOREST='#3D5C38',LEAF='#59BC53',MINT='#ADDEA8';
/* The lockup PNGs in web/assets/email/, published by scripts/build-static.js with a cross-origin resource policy so mail
   clients may load them. Every email already sent points at these paths: never change their bytes; a new version of
   the logo needs a new file name. */
const EMAIL_LOCKUP={light:'/assets/email/nodal-lockup.png',dark:'/assets/email/nodal-lockup-dark.png',width:168,height:64};

const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);

export function emailLetter(lang,origin,{card=false}={}){
 const e=escapeHtml,f=`font-family:${FONT};`;
 const type=(size,lh,weight,color,extra='')=>`${f}font-size:${size}px;mso-line-height-rule:exactly;line-height:${lh}px;font-weight:${weight};color:${color};${extra}`;
 const es=value=>lang==='es'?e(value):`<span lang="es">${e(value)}</span>`;
 const p=(content,{size=16,lh=26,weight=400,color=COPY,cls='c-copy',margin='0 0 16px'}={})=>`<p class="${cls}" style="margin:${margin};${type(size,lh,weight,color)}">${content}</p>`;
 const a=(href,label)=>`<a class="c-link" href="${e(href)}" style="color:${FOREST};font-weight:700;text-decoration:underline;">${label}</a>`;
 const runIn=title=>`<strong class="c-ink" style="font-weight:700;color:${INK};">${e(title)}.</strong> `;
 const spacer=size=>`font-size:${size}px;mso-line-height-rule:exactly;line-height:${size}px;`;
 // FIIU uses offset table cells for its festival button. Publication cards use a single, flat button cell.
 const pressPlate=(href,label)=>`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;mso-table-lspace:0;mso-table-rspace:0;"><tr>`
  +`<td class="${card?'pub-btn':'btn-face'}" bgcolor="${LEAF}" style="background:${LEAF};border:2px solid ${card?LEAF:INK};border-radius:7px;mso-padding-alt:12px 22px;"><a class="btn-a" href="${e(href)}" style="display:inline-block;padding:12px 22px;${type(16,20,700,INK,'text-decoration:none;border-radius:7px;')}">${e(label)}</a></td>`
  +(card?'</tr></table>':`<td class="btn-shadow" width="4" valign="top" bgcolor="${INK}" style="width:4px;background:${INK};font-size:0;line-height:0;"><table role="presentation" width="4" cellpadding="0" cellspacing="0" border="0"><tr><td class="bg" width="4" height="4" bgcolor="${PAPER}" style="width:4px;height:4px;background:${PAPER};${spacer(4)}">&nbsp;</td></tr></table></td></tr>`
  +`<tr><td style="padding:0 0 0 4px;font-size:0;line-height:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="btn-shadow" height="4" bgcolor="${INK}" style="height:4px;background:${INK};border-radius:0 0 0 5px;${spacer(4)}">&nbsp;</td></tr></table></td>`
  +`<td class="btn-shadow" width="4" height="4" bgcolor="${INK}" style="width:4px;height:4px;background:${INK};border-radius:0 0 5px 0;${spacer(4)}">&nbsp;</td></tr></table>`);
 // The FIIU page's second action beside the press plate: a plain outline on the paper.
 const outline=(href,label)=>`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;"><tr><td class="btn2" style="border:2px solid ${FOREST};border-radius:7px;mso-padding-alt:12px 22px;"><a class="btn2-a" href="${e(href)}" style="display:inline-block;padding:12px 22px;${type(16,20,700,FOREST,'text-decoration:none;')}">${e(label)}</a></td></tr></table>`;

 const logoWidth=card?136:EMAIL_LOCKUP.width,logoHeight=card?52:EMAIL_LOCKUP.height;
 const logoText=type(28,64,800,INK,'letter-spacing:1px;');
 const lockup=`<a href="${e(origin)}/" style="text-decoration:none;color:${INK};">`
  +`<img class="logo-light" src="${e(origin)}${EMAIL_LOCKUP.light}" width="${logoWidth}" height="${logoHeight}" alt="NODAL" style="display:block;border:0;outline:none;text-decoration:none;width:${logoWidth}px;height:${logoHeight}px;${logoText}">`
  +`<!--[if !mso]><!--><img class="logo-dark" src="${e(origin)}${EMAIL_LOCKUP.dark}" width="${logoWidth}" height="${logoHeight}" alt="NODAL" style="display:none;max-height:0;overflow:hidden;border:0;outline:none;text-decoration:none;${logoText}"><!--<![endif]-->`
  +`</a>`;

 // Keep the surrounding paper visible beside the publication card on phones.
 const cardStyle=card?`<style>
@media only screen and (min-width:521px){.pub-logo .logo-light,.pub-logo .logo-dark{width:168px!important;height:64px!important}}
@media only screen and (max-width:520px){.pub-title{font-size:27px!important;line-height:32px!important}.pub-card-cell{padding:22px 18px!important}}
@media (prefers-color-scheme:dark){.pub-card{background:#263128!important;background-color:#263128!important}.pub-card-cell{border-color:#485549!important}}
</style>`:'';
 const outerPadding=card?'32px 12px 40px':'40px 0 48px';
 const contentCell=card
  ? `<td class="pub-card pub-card-cell" bgcolor="#ffffff" align="left" style="background-color:#ffffff;border:1px solid #dfdfd6;border-radius:14px;padding:28px 30px;text-align:left;${f}color:${COPY};">`
  : `<td class="gutter" align="left" style="padding:0 24px;text-align:left;${f}color:${COPY};">`;
 const document=({subject,preheader,body})=>`<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${e(subject)}</title>
<!--[if mso]><style>body,table,td,p,a,span,strong,h1,h2{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
<style>
@media only screen and (min-width:521px){.gutter{padding-left:32px!important;padding-right:32px!important}.num{font-size:52px!important;line-height:52px!important}}
@media only screen and (max-width:520px){.gutter{padding-left:20px!important;padding-right:20px!important}.top{padding-top:28px!important}.h1{font-size:26px!important;line-height:31px!important;margin-top:32px!important}.num{font-size:34px!important;line-height:34px!important}.rail,.main{display:block!important;width:100%!important}.rail{padding:0 0 2px!important}.rail p{display:inline!important}.sep{display:inline!important}}
</style>
<style>
@media (prefers-color-scheme:dark){.bg{background:#18211a!important;background-color:#18211a!important}.c-ink,.c-copy{color:#F2ECEC!important}.c-muted{color:#c3cbbf!important}.c-forest,.c-link{color:#ADDEA8!important}.hl{background-color:#ADDEA8!important;color:#18211a!important}.logo-light{display:none!important}.logo-dark{display:block!important;max-height:none!important;width:${logoWidth}px!important;height:${logoHeight}px!important;color:#F2ECEC!important}.btn-face{border-color:#F2ECEC!important}.btn-a{color:#18211a!important}${card?'':'.btn-shadow{background:#ADDEA8!important;background-color:#ADDEA8!important}'}.btn2{border-color:#ADDEA8!important}.btn2-a{color:#ADDEA8!important}}
</style>${cardStyle}</head>
<body class="bg" bgcolor="${PAPER}" style="margin:0;padding:0;background:${PAPER};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;color:${PAPER};">${e(preheader)}</div>
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${'&zwnj;&nbsp;'.repeat(60)}</div>
<table role="presentation" class="bg" width="100%" bgcolor="${PAPER}" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};"><tr><td class="top" align="center" style="padding:${outerPadding};">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;${card?'table-layout:fixed;border-collapse:separate;':''}"><tr>${contentCell}
${body}
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
 return {e,f,type,es,p,a,runIn,pressPlate,outline,lockup,document};
}
