import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = (name) => readFileSync(new URL(`../web/pages/${name}.html`, import.meta.url), 'utf8');

test('the Resources, Knowledge and Community hubs tell a visitor without JavaScript only that the page needs it, in all three languages', () => {
  for (const hub of ['resources', 'knowledge', 'community']) {
    const notices = [...page(hub).matchAll(/<noscript>([\s\S]*?)<\/noscript>/g)].map(([, inner]) => inner);
    assert.equal(notices.length, 1, hub);
    const lines = Object.fromEntries([...notices[0].matchAll(/<p lang="(en|es|pt)">([^<]+)<\/p>/g)].map(([, lang, text]) => [lang, text]));
    assert.deepEqual(lines, {
      en: 'Enable JavaScript to see this page.',
      es: 'Activa JavaScript para ver esta página.',
      pt: 'Ative o JavaScript para ver esta página.',
    }, hub);
    // These hubs are not the festival's sign-up, which has its own page and mailbox.
    assert.doesNotMatch(notices[0], /FIIU|regist|inscri|ocupatucalle/i, hub);
  }
});
