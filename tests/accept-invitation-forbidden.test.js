/* Audit 22 Oct 2026, A4: Vercel's Security Checkpoint answers a flagged address (a venue's Wi-Fi) with its own HTML 403,
   marked x-vercel-mitigated, and only a page load passes it. The invitation page has already taken the token out of its
   address, so "try again" can never work there: it says to open the page from the newest invitation email, as a JSON
   invitation_forbidden does, and keeps the form and the unspent token. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const script = name => readFileSync(new URL(`../web/scripts/${name}.js`, import.meta.url), 'utf8');
class Node {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.hidden = false; this.textContent = ''; this.value = ''; this.classList = { toggle() {} }; }
  append(...nodes) { nodes.forEach(n => { n.parent = this; this.children.push(n); }); }
  setAttribute(k, v) { this[k] = v; }
  removeAttribute(k) { delete this[k]; }
  addEventListener(k, f) { this.listeners[k] = f; }
  focus() { this.focused = true; }
  contains() { return false; }
}
const descendants = node => node.children.flatMap(n => [n, ...descendants(n)]);
const TOKEN = 'a'.repeat(56);

function invitationPage(answer) {
  const body = new Node('body'), nodes = {}, listeners = {}, requests = [];
  for (const id of ['invitationForm', 'recoveryMessage', 'invitationTitle', 'invitationName', 'invitationPassword', 'invitationConfirm', 'invitationSubmit', 'invitationSignIn']) {
    const n = new Node(id === 'invitationForm' ? 'form' : 'div'); n.id = id; nodes[id] = n; body.append(n);
  }
  nodes.invitationForm.hidden = true; nodes.invitationSubmit.dataset.invitationText = 'accept';
  const language = { value: 'en' };
  const document = { body, documentElement: {}, readyState: 'loading', getElementById: id => nodes[id], querySelector: () => null,
    querySelectorAll: s => s === '[data-invitation-text]' ? descendants(body).filter(n => n.dataset.invitationText) : [],
    addEventListener: (k, f) => { listeners[k] = f; } };
  const ctx = { document, URLSearchParams, AbortSignal, Response, window: {}, location: { hash: '#token_hash=' + TOKEN, search: '' },
    history: { replaceState() {} }, localStorage: { getItem: () => language.value, setItem() {} },
    fetch: async (path, options) => { requests.push({ path, body: JSON.parse(options.body) }); return answer(); } };
  vm.createContext(ctx); vm.runInContext(script('accept-invitation'), ctx); vm.runInContext(script('invitation-i18n'), ctx); listeners.DOMContentLoaded();
  const fill = () => { nodes.invitationName.value = 'Ana Pérez'; nodes.invitationPassword.value = nodes.invitationConfirm.value = 'secure password'; };
  return { nodes, requests, ctx, fill, submit: () => nodes.invitationForm.listeners.submit({ preventDefault() {} }),
    lang: value => { ctx.window.nodalInvitationI18n.setLanguage(value); } };
}

test('a checkpoint or another non-JSON 403 says to open the page from the newest invitation email, and keeps the invitation', async () => {
  const answers = {
    checkpoint: () => new Response('<!doctype html><title>Vercel Security Checkpoint</title>', { status: 403, headers: { 'content-type': 'text/html', 'x-vercel-mitigated': 'challenge' } }),
    plain403: () => new Response('<html>Forbidden</html>', { status: 403, headers: { 'content-type': 'text/html' } }),
    mitigatedOther: () => new Response('<html>Too many requests</html>', { status: 429, headers: { 'content-type': 'text/html', 'x-vercel-mitigated': 'deny' } }),
  };
  for (const [name, answer] of Object.entries(answers)) {
    const page = invitationPage(answer); page.fill();
    for (let attempt = 1; attempt <= 2; attempt++) {
      await page.submit();
      assert.equal(page.nodes.recoveryMessage.dataset.invitationText, 'invitation_forbidden', `${name}, try ${attempt}`);
      assert.equal(page.nodes.recoveryMessage.textContent, 'Reload this page using the newest invitation email and try again.', name);
      // The request never reached NODAL: the form, the typed password and the token stay for the next try.
      assert.equal(page.nodes.invitationForm.hidden, false, name);
      assert.equal(page.nodes.invitationPassword.value, 'secure password', name);
      assert.equal(page.nodes.invitationSubmit.disabled, false, name);
    }
    assert.deepEqual(page.requests.map(r => r.body.tokenHash), [TOKEN, TOKEN], name);
    page.lang('es'); assert.equal(page.nodes.recoveryMessage.textContent, 'Abre esta página desde el correo de invitación más reciente e inténtalo de nuevo.', name);
    page.lang('pt'); assert.equal(page.nodes.recoveryMessage.textContent, 'Abra esta página pelo e-mail de convite mais recente e tente novamente.', name);
  }
});

test('any other unreadable answer keeps its "could not confirm" wording', async () => {
  const page = invitationPage(() => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } })); page.fill();
  await page.submit();
  assert.equal(page.nodes.recoveryMessage.dataset.invitationText, 'invitation_retry');
  assert.equal(page.nodes.invitationForm.hidden, false);
});
