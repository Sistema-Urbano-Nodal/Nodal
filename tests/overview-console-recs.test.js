import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

/* The landing page's match card (recs.js) with one live recommendation, as /api/recommendations/me answers it: the role is
   the member's title, the server's 'Member' placeholder when they set none, and the city can be empty. */
const source = readFileSync(new URL('../web/scripts/recs.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
function cardFor(recommendation) {
  const node = (tag) => ({
    tag, textContent: '', disabled: false, style: {}, attributes: {}, children: [],
    setAttribute(name, value) { this.attributes[name] = String(value); }, addEventListener() {},
    replaceChildren(...nodes) { this.children = nodes; },
  });
  const parts = Object.fromEntries(['.leader-initial', '.match-name', '.match-role', '.tags', '.match-why', '.m-skip', '.m-like'].map((selector) => [selector, node(selector)]));
  const card = { ...node('article'), querySelector: (selector) => parts[selector] ?? null };
  const stack = { ...node('div'), querySelector: () => card };
  const context = {
    document: { getElementById: (id) => (id === 'matchStack' ? stack : null), createElement: (tag) => node(tag) },
    window: { nodalI18n: { t: (key, vars) => (key === 'recs.match' ? `${vars.pct}% match` : key), onChange() {} } },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ recommendations: [recommendation] }) }),
    location: { assign() {} }, setTimeout, requestAnimationFrame: () => 0,
  };
  vm.runInNewContext(source, context, { filename: 'recs.js' });
  return parts;
}
const rosa = { id: 'rosa-id', name: 'Rosa Huamán', interests: ['mobility'], matchPct: 99, reasons: {} };

test('the match card’s role line leaves out the Member placeholder and an empty city, so no separator dangles', async () => {
  for (const [role, city, expected] of [
    ['Urbanista', 'Lima', 'Urbanista · Lima'],
    ['Urbanista', '', 'Urbanista'],
    ['Member', 'Lima', 'Lima'],
    ['Member', '', ''],
    ['', 'Cusco', 'Cusco'],
  ]) {
    const parts = cardFor({ ...rosa, role, city });
    await flush();
    assert.equal(parts['.match-name'].textContent, 'Rosa Huamán');
    assert.equal(parts['.match-role'].textContent, expected, `${role || 'no role'} in ${city || 'no city'}`);
  }
});
