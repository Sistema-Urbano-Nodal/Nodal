// Regenerate the two hosted Supabase "Confirm sign up" fields with:
// node scripts/build-signup-confirmation-email.js
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { emailLetter, MUTED } from '../server/email-letter.js';

const copy = {
  es: {
    subject: 'Confirma tu correo en NODAL',
    message: 'Confirma tu correo para terminar de crear tu cuenta en NODAL.',
    action: 'Confirmar mi correo',
    notice: 'Si no te registraste en NODAL, puedes ignorar este correo.',
  },
  en: {
    subject: 'Confirm your email for NODAL',
    message: 'Confirm your email address to finish creating your NODAL account.',
    action: 'Confirm my email',
    notice: 'If you didn’t sign up for NODAL, you can ignore this email.',
  },
  pt: {
    subject: 'Confirme seu e-mail na NODAL',
    message: 'Confirme seu e-mail para concluir seu cadastro na NODAL.',
    action: 'Confirmar meu e-mail',
    notice: 'Se você não se cadastrou na NODAL, pode ignorar este e-mail.',
  },
};

// Metadata is user-supplied. Compare its string representation only to our fixed
// locale codes, so a missing key, array or object cannot break Go's eq function.
const language = '{{ $lang := printf "%v" (and .Data .Data.language) }}';
const conditions = '{{ $en := eq $lang "en" }}{{ $pt := eq $lang "pt" }}';
const choose = (en, pt, es) => `{{ if $en }}${en}{{ else if $pt }}${pt}{{ else }}${es}{{ end }}`;
const localized = key => choose(copy.en[key], copy.pt[key], copy.es[key]);

export function signupConfirmationTemplate() {
  const prefix = language + conditions;
  const site = '{{ .SiteURL }}';
  const confirmation = '{{ .ConfirmationURL }}';
  const letter = emailLetter(choose('en', 'pt', 'es'), site);
  const body = [
    letter.lockup,
    letter.p(localized('message'), { margin: '24px 0' }),
    letter.pressPlate(confirmation, localized('action')),
    letter.p(localized('notice'), { size: 14, lh: 21, color: MUTED, cls: 'c-muted', margin: '24px 0 0' }),
  ].join('\n');
  return {
    subject: prefix + localized('subject'),
    html: prefix + letter.document({ subject: localized('subject'), preheader: localized('message'), body }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = new URL('../supabase/templates/', import.meta.url);
  const { subject, html } = signupConfirmationTemplate();
  mkdirSync(directory, { recursive: true });
  writeFileSync(new URL('confirmation.subject.txt', directory), subject + '\n');
  writeFileSync(new URL('confirmation.html', directory), html + '\n');
}
