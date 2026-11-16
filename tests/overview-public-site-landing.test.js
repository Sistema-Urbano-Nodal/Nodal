import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* The landing's own stylesheet, read as the browser would apply it: comments out, the colour tokens resolved. */
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
const root = rule(':root');
function resolve(value) {
  let v = value.trim();
  while (v.startsWith('var(')) {
    const name = v.slice(4, -1).trim();
    const token = root.match(new RegExp(`(?:^|[;\\s])${name}:\\s*([^;]+);`));
    assert.ok(token, `${name} is a token`);
    v = token[1].trim();
  }
  return v.replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i, '#$1$1$2$2$3$3');
}
const declared = (selector, property) => {
  const values = [...rule(selector).matchAll(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`, 'g'))];
  assert.ok(values.length, `${selector} sets ${property}`);
  return resolve(values.at(-1)[1]);
};
const luminance = (hex) => {
  const [r, g, b] = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

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

/* ---------- M98: the landing captions reach WCAG AA ---------- */

test('the graph hint on the white platform and the hero kicker on plaster read at 4.5:1 or more', () => {
  const white = declared('.platform', 'background');
  const plaster = declared('body', 'background');
  assert.equal(white, '#ffffff');
  for (const [selector, ground] of [['.graph-hint', white], ['.hero-kicker', plaster]]) {
    const ratio = contrast(declared(selector, 'color'), ground);
    assert.ok(ratio >= 4.5, `${selector} reads at ${ratio.toFixed(2)}:1`);
  }
});
