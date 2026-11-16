import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* The landing's own stylesheet, read as the browser would apply it: comments out. */
const css = readFileSync(new URL('../web/styles/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// every block that opens with `header`, braces balanced, joined (a sheet may hold several `@media (scripting: none)`)
function blocks(sheet, header) {
  const found = [];
  for (let at = sheet.indexOf(header); at !== -1; at = sheet.indexOf(header, at + 1)) {
    let depth = 0;
    for (let i = sheet.indexOf('{', at); i < sheet.length; i += 1) {
      if (sheet[i] === '{') depth += 1;
      else if (sheet[i] === '}' && (depth -= 1) === 0) { found.push(sheet.slice(at, i + 1)); break; }
    }
  }
  return found.join('\n');
}
// the declarations of every top-level rule written for exactly this selector, in source order (the last one wins)
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g'))].map((match) => match[1]);
  assert.ok(found.length, `${selector} has a rule`);
  return found.join(';');
}

/* ---------- M95: the headline is there without JavaScript ---------- */

test('the hero headline shows when scripts are off, and still rises in when script.js runs', () => {
  // with scripts on, script.js adds .in to .headline and each line rises from a hidden start
  assert.match(rule('.headline > span'), /opacity: 0;/);
  assert.match(css, /\.headline\.in \.word-building \{ animation: rise /);
  // with scripts off nothing adds .in, so the lines must rest where they would have landed
  const noScript = blocks(css, '@media (scripting: none)');
  assert.match(noScript, /\.headline > span \{[^}]*opacity: 1;[^}]*transform: none;/);
  // the kicker, the subtitle and the buttons need no script: the kicker's rise is CSS alone, the other two rest visible
  assert.match(rule('.hero-kicker'), /animation: rise /);
  for (const selector of ['.hero-sub', '.hero-cta']) assert.doesNotMatch(rule(selector), /opacity: 0/, selector);
});
