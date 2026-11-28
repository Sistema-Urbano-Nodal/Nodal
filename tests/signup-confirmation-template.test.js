import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { signupConfirmationTemplate } from '../scripts/build-signup-confirmation-email.js';

test('hosted signup confirmation files match the shared NODAL email renderer', () => {
  const { subject, html } = signupConfirmationTemplate();
  for (const [file, expected] of [['confirmation.subject.txt', subject], ['confirmation.html', html]]) {
    const path = new URL('../supabase/templates/' + file, import.meta.url);
    assert.equal(readFileSync(path, 'utf8'), expected + '\n', 'Regenerate with node scripts/build-signup-confirmation-email.js');
  }
  assert.doesNotMatch(subject, /[\r\n]/);
  assert.match(html, /class="btn-a" href="{{ \.ConfirmationURL }}"/);
  assert.equal(html.split('{{ .ConfirmationURL }}').length - 1, 1, 'Only the confirmation button should contain the token');
  assert.match(html, /src="{{ \.SiteURL }}\/assets\/email\/nodal-lockup\.png"/);
  assert.match(html, /src="{{ \.SiteURL }}\/assets\/email\/nodal-lockup-dark\.png"/);
  assert.doesNotMatch(html, /https?:\/\/|{{\s*\.(?:Email|RedirectTo|Token|TokenHash)\b/);
});
