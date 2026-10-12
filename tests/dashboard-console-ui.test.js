import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/* The member console on a phone at the festival: the bell, the globe, the festival block, the news, the profile
   prompt, touch sizes and the globe download. Rules are read from the shipped CSS and behaviour is run from the
   shipped scripts, cut at their section markers where running the whole console would need a whole DOM. */
const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const css = () => read('web', 'styles', 'dashboard.css');

// Every `header { … }` block in the stylesheet, joined; a brace scan, since rules nest inside media queries.
function blocks(source, header) {
  const found = [];
  for (let start = source.indexOf(header); start !== -1; start = source.indexOf(header, start + 1)) {
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}' && --depth === 0) { found.push(source.slice(start, i + 1)); break; }
    }
  }
  assert.ok(found.length, `${header} block is missing`);
  return found.join('\n');
}

/* ---------------- notifications (finding 30) ---------------- */

test('on phones the bell stays at the right edge and its panel opens inside the screen gutter', () => {
  const phone = blocks(css(), '@media (max-width: 760px)');
  // The wrapped topbar put the bell at the left, so the right-anchored panel hung about 226px off the screen.
  assert.match(phone, /\.top-actions\s*\{\s*margin-left:\s*auto;?\s*\}/);
  assert.match(phone, /\.notif-pop\s*\{[^}]*width:\s*min\(320px,\s*calc\(100vw - 2 \* var\(--pad\)\)\)/, 'never wider than the screen less both gutters');
});

/* ---------------- touch targets and search scopes (finding 35) ---------------- */

test('every console control is at least 44px on a touch screen, without changing type sizes', () => {
  const touch = blocks(css(), '@media (pointer: coarse)');
  for (const selector of ['.chip', '.seg button', '.side-link', '.side-out', '.lang-btn', '.btn-ghost', '.btn-dark', '.btn-green', '.pill-btn', '.pc-cancel', '.globe-chip', '.globe-play', '.notif-clear', '.location-check .btn-ghost', '.location-check-preference', '.uc-topics label', '.partc input[type="text"]', '.partc select']) {
    assert.ok(touch.includes(selector), `${selector} must reach 44px on touch`);
  }
  assert.match(touch, /min-height:\s*44px/);
  assert.match(touch, /\.top-ico,\s*\.top-avatar\s*\{\s*width:\s*44px;\s*height:\s*44px;?\s*\}/);
  assert.match(touch, /#fiiuDashboard :is\(\.f-button, \.f-text-link\)/, 'the festival block links (fiiu.css stops at 40px)');
  assert.match(touch, /#nodalNews :is\(\.f-text-link, \.nodal-news-all\)/);
  assert.match(touch, /\.side-privacy/);
  assert.doesNotMatch(touch, /font-size/, 'type sizes stay as they are');
});

test('all four search scopes stay visible: two by two on phones, wrapping under the box on laptops', () => {
  const sheet = css();
  assert.match(sheet, /\.search\s*\{[^}]*flex-wrap:\s*wrap/, 'the chips wrap under the input instead of being clipped');
  assert.match(sheet, /\.search-chips\s*\{[^}]*flex:\s*0 0 auto/, 'the chip row is never squeezed into a hidden scroll');
  assert.match(sheet, /\.search input\s*\{[^}]*flex:\s*1 1 \d+px/);
  assert.match(blocks(sheet, '@media (max-width: 1439px)'), /\.search-in\s*\{\s*display:\s*none;?\s*\}/);
  const phone = blocks(sheet, '@media (max-width: 760px)');
  assert.match(phone, /\.search-chips\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
});

