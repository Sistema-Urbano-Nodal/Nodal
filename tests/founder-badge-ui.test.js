import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

/* The Founder badge (web/pages/fundadores.html promises it to every Membresía Fundador member, for as long as they keep
   their NODAL account). One helper in pilot.js draws it everywhere it shows, one block of courses.css styles it, and its
   visible word is "Founder" in every language, as on the Fundadores page. Where it shows is tested with each page:
   profile-ui, dashboard-console-ui, courses-ui, course-participants-ui and founders-desk-ui. */
const read = (...parts) => readFileSync(new URL(`../${parts.join('/')}`, import.meta.url), 'utf8');

// pilot-i18n.js and pilot.js with just enough document to build a badge and re-translate it on a language switch.
function pilot(lang = 'en') {
  const nodes = [], listeners = [], state = { lang };
  const node = (tag = 'div') => {
    const n = { tagName: tag, dataset: {}, children: [], hidden: false, className: '', textContent: '', append(...c) { this.children.push(...c); }, setAttribute(k, v) { this[k] = String(v); }, getAttribute(k) { return this[k] ?? null; } };
    nodes.push(n);
    return n;
  };
  const document = {
    readyState: 'complete', documentElement: { dataset: { pilot: 'false' } }, body: { dataset: {} }, createElement: node,
    getElementById: () => null, querySelector: () => null,
    querySelectorAll: (selector) => (selector === '[data-pilot-text]' ? nodes.filter((n) => n.dataset.pilotText) : selector === '[data-pilot-dynamic]' ? nodes.filter((n) => n.dataset.pilotDynamic) : []),
  };
  const context = vm.createContext({ console, URL, URLSearchParams, Intl, document, fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    window: { nodalI18n: { get lang() { return state.lang; }, onChange: (fn) => listeners.push(fn) } } });
  for (const name of ['pilot-i18n', 'pilot']) vm.runInContext(read('web', 'scripts', `${name}.js`), context);
  return { api: context.window.nodalPilot, rows: context.window.pilotI18n.rows, setLang(value) { state.lang = value; listeners.forEach((fn) => fn()); } };
}

const NOTE = {
  en: 'Founder · part of the Nodal founding community',
  es: 'Founder · parte de la comunidad fundadora de Nodal',
  pt: 'Founder · parte da comunidade fundadora da Nodal',
};

test('the Founder badge reads "Founder" in every language, and its note follows a language switch', () => {
  const p = pilot('es');
  const small = p.api.founderBadge(), large = p.api.founderBadge({ large: true });
  assert.equal(small.tagName, 'span');
  assert.equal(small.className, 'founder-badge');
  assert.equal(large.className, 'founder-badge is-large');
  for (const lang of ['es', 'pt', 'en']) {
    p.setLang(lang);
    for (const badge of [small, large]) {
      assert.equal(badge.textContent, 'Founder', lang);
      assert.equal(badge.title, NOTE[lang], lang);
    }
  }
  // Spread out of the page's realm, so deepEqual compares values only.
  assert.deepEqual([...p.rows.founderNote], [NOTE.en, NOTE.es, NOTE.pt]);
  assert.deepEqual([...p.rows.founderCaption], ['Part of the founding community', 'Parte de la comunidad fundadora', 'Parte da comunidade fundadora']);
  assert.equal(pilot('pt').api.founderBadge().title, NOTE.pt, 'a badge drawn in Portuguese starts in Portuguese');
});

// The declarations of every rule for exactly this selector (in an @media block when media is given), later ones winning.
function declarations(css, selector, media = null) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = {};
  const take = (text, inMedia) => {
    for (const chunk of text.split('}')) {
      const at = chunk.indexOf('{');
      if (at < 0 || inMedia !== media) continue;
      if (!chunk.slice(0, at).split(',').map((s) => s.trim()).includes(selector)) continue;
      for (const d of chunk.slice(at + 1).split(';')) {
        const colon = d.indexOf(':');
        if (colon > 0) found[d.slice(0, colon).trim()] = d.slice(colon + 1).trim();
      }
    }
  };
  for (let i = 0; ;) {
    const at = css.indexOf('@media', i);
    if (at < 0) { take(css.slice(i), null); break; }
    take(css.slice(i, at), null);
    const open = css.indexOf('{', at);
    let depth = 1, end = open + 1;
    for (; depth; end += 1) { if (css[end] === '{') depth += 1; else if (css[end] === '}') depth -= 1; }
    take(css.slice(open + 1, end - 1), css.slice(at + 6, open).trim());
    i = end;
  }
  return found;
}

test('courses.css draws the badge as the Fundadores stamp: beige plate, forest ink, the network mark, tilted when large', () => {
  const css = read('web', 'styles', 'courses.css');
  const MARK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 130'%3E%3Cg fill='none' stroke='%233f8f43' stroke-width='10' stroke-linecap='round'%3E%3Cpath d='M30 18 40 72M66 28 40 72M66 28 92 60M92 60 74 94M40 72 74 94M74 94 44 116'/%3E%3C/g%3E%3Cg fill='%233f8f43'%3E%3Ccircle cx='30' cy='18' r='11'/%3E%3Ccircle cx='66' cy='28' r='12'/%3E%3Ccircle cx='92' cy='60' r='10'/%3E%3Ccircle cx='40' cy='72' r='17'/%3E%3Ccircle cx='74' cy='94' r='15'/%3E%3Ccircle cx='44' cy='116' r='10.5'/%3E%3C/g%3E%3C/svg%3E") center/contain no-repeat`;
  assert.deepEqual(declarations(css, '.founder-badge'), {
    display: 'inline-flex', 'align-items': 'center', gap: '5px', padding: '2px 7px 2px 5px', border: '1.5px solid #3d5c38', 'border-radius': '4px',
    background: '#f2ecec', color: '#3d5c38', font: 'inherit', 'font-size': '10px', 'font-weight': '700', 'line-height': '1.4',
    'letter-spacing': '.14em', 'text-transform': 'uppercase', 'white-space': 'nowrap', 'vertical-align': 'middle',
  });
  assert.deepEqual(declarations(css, '.founder-badge::before'), { content: "''", flex: 'none', width: '10px', height: '11px', background: MARK });
  assert.deepEqual(declarations(css, '.founder-badge.is-large'), {
    gap: '8px', padding: '6px 13px 6px 9px', 'border-width': '2px', 'border-radius': '6px', 'font-size': '12px', 'letter-spacing': '.16em',
    transform: 'rotate(-3deg)', 'box-shadow': '2px 2px 0 rgba(37,52,31,.45)',
  });
  assert.deepEqual(declarations(css, '.founder-badge.is-large::before'), { width: '16px', height: '17px' });
  assert.equal(declarations(css, '.founder-badge.is-large', 'print')['box-shadow'], 'none', 'no shadow on paper');
  // Forced colours drop the beige plate: the outline comes back in the system ink and the word stays.
  const forced = declarations(css, '.founder-badge', '(forced-colors:active)');
  assert.equal(forced['border-color'], 'CanvasText');
  assert.equal(forced.display, undefined, 'the badge text is never hidden');
  // The profile line is a flex row; it is hidden by its attribute until profile.js shows it.
  assert.equal(declarations(css, '.pf-founder[hidden]').display, 'none');
  assert.match(declarations(css, '.pf-founder').margin, /^\d+px 0 \d+px$/, 'room above and below, so the tilted stamp never touches the name or the role line');
});

test('the profile and the console reserve the badge in their markup, with no separator left when it is hidden', () => {
  const profile = read('web', 'pages', 'profile.html'), dashboard = read('web', 'pages', 'dashboard.html');
  assert.match(profile, /<h1 id="pfName">…<\/h1>\s*<div class="pf-founder" id="pfFounder" hidden><\/div>\s*<p class="pf-role" id="pfRole">/);
  // The " · " before the badge is drawn with it, so a member without the badge sees no dangling separator.
  assert.match(dashboard, /<span id="sheetRole">—<\/span><span id="sheetFounder" hidden><\/span>\s*<\/p>/);
  for (const [name, html] of [['profile.html', profile], ['dashboard.html', dashboard]]) {
    assert.match(html, /href="courses\.css\?v=20261023a"/, `${name} loads the badge styles`);
    assert.match(html, /src="pilot\.js\?v=20261023a"/, `${name} loads the badge helper`);
  }
});
