/* Audit 22 Oct 2026: the console's account tools and links.
   A3 — a refused export or deletion is shown in the member's language: a known refusal by its code, anything else as
   the plain "could not" line. The server's English sentence never reaches a Spanish or Portuguese member.
   P1 — deleting an account does not stop a Founder Membership's pending Mercado Pago charge, so the deletion prompt says
   to write to the contact email first, and the team's routine (docs/supporter-payments.md) follows up deleted accounts.
   P4 — the console's Membership link and the profile's "See membership" link stay visible in the course pilot. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('web/scripts/dashboard.js');
const dictionaries = (() => { const context = vm.createContext({ window: {} }); vm.runInContext(read('web/scripts/i18n-dashboard.js'), context); return context.window.NODAL_I18N_DASH; })();
const LANGS = ['en', 'es', 'pt'];

// api() and the two click handlers exactly as dashboard.js ships them, run with the console's real dictionaries.
const api = source.slice(source.indexOf('  async function api(path, options = {}) {'), source.indexOf('  function normalizeApiUser'));
const exportStart = source.indexOf("    uc.exportData?.addEventListener('click'");
const deleteStart = source.indexOf("    uc.deleteAccount?.addEventListener('click'");
const exportHandler = source.slice(exportStart, deleteStart);
const deleteHandler = source.slice(deleteStart, source.indexOf("\n  }\n\n  byId('logoutBtn')", deleteStart));
function console_(lang, answer, { email = 'member@example.test' } = {}) {
  const clicks = {}, prompts = [];
  const context = vm.createContext({
    t: key => { const value = dictionaries[lang][key]; assert.equal(typeof value, 'string', `${lang}: ${key}`); return value; },
    JSON, Object, Error, encodeURIComponent,
    prompt: text => { prompts.push(text); return email; },
    location: { pathname: '/dashboard.html', assign() { throw new Error('must not navigate'); } },
    fetch: async () => { if (answer instanceof Error) throw answer; return { ok: false, status: answer.status, json: async () => answer.body }; },
    uc: {
      exportData: { addEventListener: (type, fn) => { clicks.export = fn; } },
      deleteAccount: { addEventListener: (type, fn) => { clicks.delete = fn; } },
      error: { hidden: true, textContent: '' },
    },
  });
  vm.runInContext(api + exportHandler + deleteHandler, context);
  return { clicks, prompts, error: context.uc.error };
}

test('the handlers are where the test expects them', () => {
  assert.ok(api.length > 100 && exportHandler.length > 100 && deleteHandler.length > 100);
});

test('A3: a refused deletion is shown by its code in the member’s language, never in the server’s English', async () => {
  const cases = [
    [{ status: 400, body: { error: 'account deletion requires email confirmation', code: 'confirm_email_mismatch' } },
      ['The email you typed does not match your account email. Nothing was deleted.', 'El correo que escribiste no coincide con el de tu cuenta. No se eliminó nada.', 'O e-mail digitado não corresponde ao e-mail da sua conta. Nada foi excluído.']],
    [{ status: 409, body: { error: 'An upload is in progress. Try again in a few minutes.', code: 'upload_in_progress' } },
      ['One of your files is still uploading. Try again in a few minutes.', 'Uno de tus archivos aún se está subiendo. Inténtalo de nuevo en unos minutos.', 'Um dos seus arquivos ainda está sendo enviado. Tente novamente em alguns minutos.']],
    [{ status: 409, body: { error: 'A course certificate is being uploaded for this account. Try again in a few minutes.', code: 'certificate_upload_in_progress' } },
      ['A course certificate is being uploaded for this account. Try again in a few minutes.', 'Se está subiendo un certificado del curso para esta cuenta. Inténtalo de nuevo en unos minutos.', 'Um certificado do curso está sendo enviado para esta conta. Tente novamente em alguns minutos.']],
    [{ status: 409, body: { error: 'Cancel your NODAL membership before deleting your account.', code: 'subscription_active' } },
      LANGS.map(lang => dictionaries[lang]['d.uc.deleteSubscription'])],
    // No code, an unknown code, an inherited name, a gateway page, a dropped connection: the plain failure line.
    ...[
      { status: 400, body: { error: 'account deletion requires email confirmation' } },
      { status: 500, body: { error: 'internal error', code: 'something_new' } },
      { status: 400, body: { error: 'inherited code', code: 'constructor' } },
      { status: 502, body: {} },
      new TypeError('Failed to fetch'),
    ].map(answer => [answer, ['Could not delete this account.', 'No se pudo eliminar esta cuenta.', 'Não foi possível excluir esta conta.']]),
  ];
  for (const [answer, expected] of cases) {
    for (const [i, lang] of LANGS.entries()) {
      const h = console_(lang, answer);
      await h.clicks.delete();
      assert.equal(h.error.textContent, expected[i], `${lang}: ${answer.body?.code ?? answer.message}`);
      assert.equal(h.error.hidden, false);
      if (answer.body?.error && lang !== 'en') assert.ok(!h.error.textContent.includes(answer.body.error), `${lang} never shows the server's English`);
    }
  }
});

test('A3: a failed export says so in the member’s language, never with the server’s text', async () => {
  for (const answer of [{ status: 429, body: { error: 'too many requests' } }, { status: 500, body: { error: 'internal error' } }, new TypeError('Failed to fetch')]) {
    for (const [lang, expected] of [['en', 'Could not export your data.'], ['es', 'No se pudieron exportar tus datos.'], ['pt', 'Não foi possível exportar seus dados.']]) {
      const h = console_(lang, answer);
      await h.clicks.export();
      assert.equal(h.error.textContent, expected, `${lang}: ${answer.body?.error ?? answer.message}`);
      assert.equal(h.error.hidden, false);
    }
  }
});

test('A3: every new refusal is translated in the three languages', () => {
  for (const key of ['d.uc.deleteEmailMismatch', 'd.uc.deleteUploading', 'd.uc.deleteCertificateUploading']) {
    for (const lang of LANGS) assert.equal(typeof dictionaries[lang][key], 'string', `${lang}: ${key}`);
    assert.equal(new Set(LANGS.map(lang => dictionaries[lang][key])).size, 3, key);
  }
});

// The festival's registration and attendance (its certificate hours) go with the account, so the prompt says so (24 Oct 2026).
test('P1: the deletion prompt tells Founder members to write to the contact email first to stop a pending payment, and FIIU registrants that their hours go too', async () => {
  const expected = {
    en: 'Type your account email to delete your NODAL account. If you are a Founder Membership member and want to stop a pending payment, write to the contact email in the membership terms first. If you registered for FIIU, your festival registration, attendance and certificate hours are deleted too: use Export my data first if you want a copy.',
    es: 'Escribe el correo de tu cuenta para eliminar tu cuenta NODAL. Si eres miembro de la Membresía Fundador y quieres detener un pago pendiente, escribe primero al correo de atención de los términos de la membresía. Si te inscribiste en el FIIU, también se eliminan tu inscripción al festival, tu asistencia y tus horas para el certificado: usa Exportar mis datos antes si quieres una copia.',
    pt: 'Digite o e-mail da sua conta para excluir sua conta NODAL. Se você é membro da Membresia Fundador e quer interromper um pagamento pendente, escreva primeiro para o e-mail de atendimento dos termos da membresia. Se você se inscreveu no FIIU, sua inscrição no festival, sua presença e suas horas para o certificado também são excluídas: use Exportar meus dados antes se quiser uma cópia.',
  };
  for (const lang of LANGS) {
    assert.equal(dictionaries[lang]['d.uc.deletePrompt'], expected[lang], lang);
    const h = console_(lang, { status: 400, body: {} }, { email: '' });
    await h.clicks.delete();
    assert.deepEqual(h.prompts, [expected[lang]], 'the prompt the member sees');
  }
});

test('P1 and P2/P3: the payments routine follows up deleted accounts and remedies after the offer closes', () => {
  const doc = read('docs/supporter-payments.md');
  // P1: the acceptances CSV marks deleted accounts, and the routine says what to do with them.
  assert.match(doc, /`account_deleted`/);
  assert.match(doc, /\*\*A payer who deleted their NODAL account[^*]*\*\*[^\n]*section 12/);
  // P2: from 1 January 2027 the payments page answers 410, so the remedy is a written acceptance from the contact email.
  assert.match(doc, /From 1 January 2027[^\n]*in writing[^\n]*`FUNDADORES-2027-v1`/);
  assert.match(doc, /dated after the payment[^\n]*expected/);
  // P3: one link alone closes the join page, so removing a link is not a quiet change.
  assert.doesNotMatch(doc, /Removing a link only hides its option/);
  assert.match(doc, /`\/fundadores\.html`[^\n]*both/);
});

test('P4: the console’s Membership link and the profile’s See membership link stay visible in the course pilot', () => {
  const css = read('web/styles/courses.css');
  // The pilot hides every link to the payments page except the ones marked as the Founder Membership's.
  assert.match(css, /html:not\(\[data-pilot="false"\]\) a\[href\*="payments\.html"\]:not\(\[data-supporter-link\]\)/);
  for (const page of ['dashboard.html', 'profile.html']) {
    const html = read(`web/pages/${page}`);
    const links = [...html.matchAll(/<a\b[^>]*href="payments\.html"[^>]*>/g)].map(m => m[0]);
    assert.ok(links.length >= 1, page);
    for (const link of links) assert.match(link, /\sdata-supporter-link(?:[\s>=])/, `${page}: ${link}`);
  }
});
