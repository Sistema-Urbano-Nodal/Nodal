/* membership-terms.js fills the contact email and the Libro de Reclamaciones link on /terminos-fundadores.html from
   GET /api/billing/config `contact` ({email, complaintsUrl} | null), and checks both again before using them. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Node, descendants} from './helpers/fiiu-ui-harness.js';

const script = readFileSync(new URL('../web/scripts/membership-terms.js', import.meta.url), 'utf8');
const PENDING = 'pendiente de publicación';
const EMAIL = 'atencion@sistemaurbano.pe', BOOK = 'https://www.sistemaurbano.pe/libro-de-reclamaciones';
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

// A slot as the page has it: a span holding the pending text, which replaceChildren clears as in a browser.
class Slot extends Node {
  constructor(kind) { super('span'); this.dataset.termsContact = kind; this.textContent = PENDING; }
  replaceChildren(...nodes) { this.textContent = ''; super.replaceChildren(...nodes); }
}

async function page({config = {contact: {email: EMAIL, complaintsUrl: BOOK}}, status = 200, fails = false} = {}) {
  const slots = [...['email', 'complaints', 'email', 'email', 'complaints'].map(kind => new Slot(kind))];
  const requests = [];
  const context = {
    URL,
    document: {
      querySelectorAll: selector => (selector === '[data-terms-contact]' ? slots : []),
      createElement: tag => new Node(tag),
    },
    fetch: async (path, options = {}) => {
      requests.push({path, method: options.method || 'GET', accept: options.headers?.Accept});
      if (fails) throw new TypeError('Failed to fetch');
      return {ok: status < 400, status, json: async () => config};
    },
  };
  context.window = context;
  vm.createContext(context); vm.runInContext(script, context); await flush();
  const of = kind => slots.filter(slot => slot.dataset.termsContact === kind);
  return {requests, slots, email: of('email'), complaints: of('complaints')};
}
const pending = slot => slot.children.length === 0 && slot.textContent === PENDING;
const text = node => [node.textContent, ...descendants(node).map(child => child.textContent)].join('');

test('the contact email becomes a mail link and the Libro de Reclamaciones a link that opens in a new tab', async () => {
  const p = await page();
  assert.deepEqual(p.requests, [{path: '/api/billing/config', method: 'GET', accept: 'application/json'}]);
  for (const slot of p.email) {
    assert.equal(slot.children.length, 1);
    const [link] = slot.children;
    assert.equal(link.tagName, 'a'); assert.equal(link.href, `mailto:${EMAIL}`); assert.equal(text(link), EMAIL);
    assert.equal(link.target, undefined, 'mail links stay in place');
  }
  for (const slot of p.complaints) {
    assert.equal(slot.children.length, 1);
    const [link] = slot.children;
    assert.equal(link.tagName, 'a'); assert.equal(link.href, BOOK);
    assert.equal(link.target, '_blank'); assert.equal(link.rel, 'noopener noreferrer');
    assert.match(text(link), /Libro de Reclamaciones/);
    assert.match(text(link), /se abre en una pestaña nueva/, 'says it opens a new tab');
  }
});

test('until both settings are published, or when the configuration cannot be read, every field stays pending', async () => {
  for (const options of [{config: {contact: null}}, {config: {checkout: false}}, {config: null}, {status: 500, config: {contact: {email: EMAIL, complaintsUrl: BOOK}}}, {fails: true}, {config: {contact: 'x'}}]) {
    const p = await page(options);
    assert.ok(p.slots.every(pending), JSON.stringify(options));
  }
});

test('a complaints address that is not https never becomes a link, and the email is still filled', async () => {
  for (const complaintsUrl of ['http://www.sistemaurbano.pe/libro', 'javascript:alert(1)', 'data:text/html,<b>x</b>', '//evil.example/libro', 'https://user:secret@evil.example/libro', 'libro-de-reclamaciones', 42, null, '']) {
    const p = await page({config: {contact: {email: EMAIL, complaintsUrl}}});
    assert.ok(p.complaints.every(pending), String(complaintsUrl));
    assert.ok(p.email.every(slot => slot.children[0]?.href === `mailto:${EMAIL}`), String(complaintsUrl));
  }
});

test('an implausible email is never shown or linked, and the Libro de Reclamaciones is still filled', async () => {
  for (const email of ['not-an-email', 'ana@localhost', '<img src=x onerror=alert(1)>@x.pe', 'ana@x.pe?bcc=other@x.pe', 'ana maria@x.pe', 'ana@x.pe\n', `${'a'.repeat(250)}@x.pe`, 42, null, '']) {
    const p = await page({config: {contact: {email, complaintsUrl: BOOK}}});
    assert.ok(p.email.every(pending), JSON.stringify(email));
    assert.ok(p.complaints.every(slot => slot.children[0]?.href === BOOK), JSON.stringify(email));
  }
});

test('configuration values reach the page only as text and attributes, never as markup', async () => {
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|DOMParser/);
  const p = await page();
  for (const node of p.slots.flatMap(slot => [slot, ...descendants(slot)])) {
    assert.ok(!Object.hasOwn(node, 'innerHTML') && !Object.hasOwn(node, 'outerHTML'), 'no markup property is set');
  }
});
