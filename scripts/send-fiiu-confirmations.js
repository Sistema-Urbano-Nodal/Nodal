import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createRepository } from '../server/repository.js';
import { dataBackend } from '../server/supabase.js';
import { createFiiuStore } from '../server/fiiu-repository.js';
import { EVENT_ID, DEFAULT_CONFIG } from '../server/fiiu-domain.js';
import { createRegistrationConfirmation, isReservedRecipient, emailLanguage, EMAIL_LANGUAGES } from '../server/fiiu-email.js';
import { validAddress } from '../server/mailer.js';

/* Optional backfill for the FIIU registration summary email, for people who registered before it existed or over
   the sending limit (confirmation_status 'none'). Dry run by default: it lists who would be emailed and writes nothing.

     node scripts/send-fiiu-confirmations.js                 list registrations still at 'none'
     node scripts/send-fiiu-confirmations.js --send          email them, one at a time
     node scripts/send-fiiu-confirmations.js --send --retry-failed --limit 5   (--limit=5 works too)
     node scripts/send-fiiu-confirmations.js --test-to <your own inbox> --language es   one sample summary, no data touched

   Anything it does not understand (an unknown flag, a missing value, a --limit that is not a positive whole number,
   --test-to together with --send) stops it before any email goes out.

   Each send claims the row with the same compare-and-set as the API ('none' → 'pending', or 'failed' → 'pending'
   with --retry-failed), so a rerun, or a second copy running at the same time, never emails anyone twice. 'failed'
   means the provider cannot have the message, so retrying it is safe; 'uncertain' is never retried automatically.
   The email goes out in the language stored with the registration, else Spanish. Uses the same environment as the
   server (DATA_BACKEND and the Supabase variables, EMAIL_SMTP_URL, EMAIL_FROM, EMAIL_REPLY_TO, PUBLIC_BASE_URL). */
const maskEmail = email => { const [name, domain] = String(email).split('@'); return `${name.slice(0, 1)}***@${domain ?? ''}`; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function sendConfirmations({ store, confirm = null, send = false, retryFailed = false, limit = Infinity, delayMs = 1000, log = console.log }) {
  if (send && !confirm) throw new Error('Email is not configured: set EMAIL_SMTP_URL, EMAIL_FROM and PUBLIC_BASE_URL.');
  const configRow = (await store.find('config', { id: EVENT_ID }, { limit: 1 }))[0];
  const config = { ...DEFAULT_CONFIG, ...configRow?.data };
  const statuses = retryFailed ? ['none', 'failed'] : ['none'];
  const due = [];
  for (const confirmationStatus of statuses) {
    let after;
    do {
      const page = await store.find('registrations', { eventId: EVENT_ID, confirmationStatus }, { after, limit: 200 });
      due.push(...page);
      after = page.length === 200 ? page.at(-1).id : null;
    } while (after);
  }
  const results = { listed: 0, sent: 0, failed: 0, uncertain: 0, skipped: 0, claimedElsewhere: 0 };
  for (const registration of due.slice(0, limit)) {
    const language = emailLanguage(registration.confirmationLanguage);
    results.listed++;
    if (!send) { log(`${registration.id}  ${registration.createdAt}  ${language}  ${maskEmail(registration.email)}${isReservedRecipient(registration.email) ? '  (test address: would be skipped)' : ''}`); continue; }
    const claimed = await store.update('registrations', { id: registration.id, confirmationStatus: registration.confirmationStatus }, { confirmationStatus: 'pending', confirmationLanguage: language });
    if (!claimed) { results.claimedElsewhere++; continue; }
    let outcome;
    try { outcome = await confirm({ registration: claimed, config, language }); } catch { outcome = { status: 'uncertain' }; }
    const status = ['sent', 'failed', 'uncertain', 'skipped'].includes(outcome?.status) ? outcome.status : 'uncertain';
    await store.update('registrations', { id: registration.id, confirmationStatus: 'pending' }, { confirmationStatus: status, confirmationSentAt: status === 'sent' ? outcome.sentAt ?? new Date().toISOString() : null });
    results[status]++;
    log(`${registration.id}  ${status}`);
    if (delayMs) await pause(delayMs);
  }
  return results;
}

// A fixed example registration, for checking the provider settings and the layout in a real inbox.
export const SAMPLE_REGISTRATION = {
  id: 'sample', labStatus: 'pending',
  answers: { firstName: 'Ana', applyLab: true, activities: ['day1-am', 'day1-pm', 'day2-am'], externalActivities: ['workshop-calles-gente', 'route-arcoiris'] },
};

/* The command line, read strictly: `--flag value` and `--flag=value` both work, and anything else throws, so a
   mistyped canary such as `--limit=1`, `--limit 0` or `--test-to=me@…` can never turn into an unlimited send. */
export function parseCliArgs(argv) {
  const { values } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: {
    send: { type: 'boolean' }, 'retry-failed': { type: 'boolean' }, limit: { type: 'string' }, 'test-to': { type: 'string' }, language: { type: 'string' },
  } });
  const testTo = values['test-to'];
  if (values.limit !== undefined && !/^[1-9]\d*$/.test(values.limit)) throw new Error('--limit must be a positive whole number, for example --limit 5');
  if (testTo !== undefined) {
    if (!validAddress(testTo)) throw new Error('--test-to must be one email address');
    if (values.send || values['retry-failed'] || values.limit !== undefined) throw new Error('--test-to sends one sample summary and cannot be combined with --send, --retry-failed or --limit');
  }
  if (values.language !== undefined) {
    if (testTo === undefined) throw new Error('--language only applies to --test-to: the backfill uses the language stored with each registration');
    if (!EMAIL_LANGUAGES.includes(values.language)) throw new Error(`--language must be one of ${EMAIL_LANGUAGES.join(', ')}`);
  }
  return { send: Boolean(values.send), retryFailed: Boolean(values['retry-failed']), limit: values.limit === undefined ? Infinity : Number(values.limit), testTo: testTo ?? null, language: emailLanguage(values.language) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let options;
  try { options = parseCliArgs(process.argv.slice(2)); }
  catch (err) { console.error(`${err.message}\nNothing was sent. Usage: see the comment at the top of scripts/send-fiiu-confirmations.js.`); process.exit(1); }
  const backend = dataBackend();
  if (options.testTo) {
    const confirm = createRegistrationConfirmation();
    if (!confirm) { console.error('Email is not configured: set EMAIL_SMTP_URL, EMAIL_FROM and PUBLIC_BASE_URL.'); process.exit(1); }
    const outcome = await confirm({ registration: { ...SAMPLE_REGISTRATION, email: options.testTo }, config: DEFAULT_CONFIG, language: options.language });
    console.log(`sample summary (${options.language}): ${outcome.status}`);
    process.exit(outcome.status === 'sent' ? 0 : 1);
  }
  const repository = backend === 'supabase' ? null : createRepository();
  try {
    const store = backend === 'supabase' ? createFiiuStore() : createFiiuStore({ db: repository.database });
    const { send, retryFailed, limit } = options;
    const confirm = send ? createRegistrationConfirmation({ loopbackOnly: backend !== 'supabase' }) : null;
    const results = await sendConfirmations({ store, confirm, send, retryFailed, limit });
    console.log(JSON.stringify({ mode: send ? 'send' : 'dry run', ...results }));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally { repository?.close?.(); }
}
