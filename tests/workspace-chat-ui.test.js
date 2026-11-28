import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { Node, flush } from './helpers/fiiu-ui-harness.js';

const script = name => readFileSync(new URL('../web/scripts/' + name + '.js', import.meta.url), 'utf8');

class ChatNode extends Node {
  constructor(tag) {
    super(tag);
    const classes = () => new Set((this.className || '').split(' ').filter(Boolean));
    this.classList = {
      contains: value => classes().has(value),
      add: value => { this.className = [...classes().add(value)].join(' '); },
      remove: value => { const list = classes(); list.delete(value); this.className = [...list].join(' '); },
      toggle: (value, enabled) => this.classList[enabled ? 'add' : 'remove'](value),
    };
  }
  get isConnected() { return this.tagName === 'body' || !!this.parent?.isConnected; }
  insertBefore(node, reference) { if (reference) reference.before(node); else this.append(node); }
  getClientRects() { return [{}]; }
}

async function openChat(firstContact, lang = 'en', { invite = false, emailPreference, emailLink = false } = {}) {
  const body = new ChatNode('body'), ids = new Map();
  for (const id of ['detail', 'inbox-list', 'inbox-search', 'new-message', 'new-group', 'mailbox-owner']) {
    const element = new ChatNode('div');
    ids.set(id, element); body.append(element);
  }
  const current = new URL('https://nodal.test/messages.html');
  if (emailPreference) {
    const fields = {'email-alerts':'details','dm-email-choice':'label','dm-email-enabled':'input','dm-email-status':'p','dm-email-retry':'button'};
    for (const [id, tag] of Object.entries(fields)) {
      const element = new ChatNode(tag);
      ids.set(id, element);
      body.append(element);
    }
    if (emailLink === 'query') current.searchParams.set('settings','email');
    else if (emailLink) current.hash = '#email-alerts';
  }
  const me = { id: randomUUID(), fullName: 'Ana' }, peer = { id: randomUUID(), fullName: 'Rosa', title: 'Member' };
  const thread = { id: randomUUID(), name: firstContact ? peer.fullName : 'School streets', revision: 0,
    kind: firstContact ? 'direct' : 'group', status: firstContact ? 'pending' : 'active', peerId: peer.id, initiatorId: me.id };
  current.searchParams.set(firstContact ? 'to' : 'thread', firstContact ? peer.id : thread.id);
  const invitation = { id: randomUUID(), name: 'Station square', inviterName: peer.fullName };
  let pending = invite;
  if (invite) current.search = '?invite=' + invitation.id;
  const writes = [], messages = [], fileId = randomUUID();
  const events = [], openedThreads = [];
  async function fetch(path, options) {
    let data;
    if (path === '/api/workspace/email-preference' && emailPreference) {
      data = await emailPreference(options.method || 'GET', options.body && JSON.parse(options.body));
    } else if (path === '/api/auth/me') data = { user: me };
    else if (path === '/api/users/' + peer.id) data = { user: peer };
    else if (path === '/api/workspace' && options.method !== 'POST') {
      data = { threads: firstContact && !messages.length ? [] : [thread], invitations: pending ? [invitation] : [] };
    } else if (path === '/api/workspace?threadId=' + thread.id) {
      openedThreads.push(thread.id);
      data = { thread, messages, members: [{ id: me.id, status: 'active' }], projects: [], moreMessages: false };
    } else if (path === '/api/workspace' && options.method === 'POST') {
      const request = JSON.parse(options.body);
      writes.push(request);
      if (request.op === 'decline') {
        pending = false;
      } else if (writes.length === 1) {
        const attachments = request.attachments.map(({ name, mime, size }) => ({ id: fileId, name, mime, size }));
        messages.push({ id: randomUUID(), authorId: me.id, body: request.body, createdAt: new Date().toISOString(), attachments });
        thread.revision++;
        throw new Error('Lost reply after the server stored the message');
      }
      data = { threadId: thread.id };
    } else throw new Error('Unexpected request ' + path);
    return { ok: true, status: 200, json: async () => structuredClone(data) };
  }
  const document = {
    body, documentElement: { lang }, getElementById: id => ids.get(id), addEventListener() {},
    dispatchEvent: event => events.push(event.type),
    createElement: tag => new ChatNode(tag), createElementNS: (_, tag) => new ChatNode(tag),
    querySelectorAll: selector => body.querySelectorAll(selector),
  };
  class FileReader {
    readAsDataURL(file) { this.result = 'data:' + file.type + ';base64,' + file.bytes.toString('base64'); this.onload(); }
  }
  const context = vm.createContext({
    document, location: current, URL, URLSearchParams, Event, crypto: { randomUUID }, FileReader, clearTimeout, fetch,
    history: { replaceState: (_, title, url) => { current.href = new URL(url, current).href; } },
    window: { addEventListener() {}, setInterval() {}, matchMedia: () => ({ matches: true }) },
  });
  for (const name of ['messages-i18n', 'messages']) vm.runInContext(script(name), context, { filename: name + '.js' });
  await flush();
  return { detail: ids.get('detail'), ids, writes, current, thread, peer, fileId, events, openedThreads, invitation };
}

test('direct-message email is optional, reads the saved choice, and writes only explicit changes in the member’s language', async () => {
  for (const lang of ['en','es','pt']) {
    let enabled = false;
    const changes = [];
    const {ids} = await openChat(false, lang, {emailLink:lang === 'es' ? 'query' : true, emailPreference(method, body) {
      if (method === 'POST') { changes.push(body); enabled = body.enabled; }
      return {enabled};
    }});
    const panel = ids.get('email-alerts'), checkbox = ids.get('dm-email-enabled');
    assert.equal(panel.open, true);
    assert.equal(checkbox.checked, false);
    assert.deepEqual(changes, []);
    for (const next of [true,false]) {
      checkbox.checked = next;
      await checkbox.listeners.change();
      assert.equal(enabled, next);
      assert.equal(checkbox.disabled, false);
      assert.deepEqual(changes.at(-1), {enabled:next, language:lang});
      assert.equal(ids.get('dm-email-status').dataset.msg,'emailSaved');
      panel.listeners.toggle();
      await flush();
      assert.equal(checkbox.checked, next);
    }
    assert.equal(changes.length, 2);
  }
});

test('a failed read or lost save response requires a fresh read before changing the preference again', async () => {
  let saved = false, reads = 0, posts = 0;
  const {ids} = await openChat(false, 'es', {emailLink:true, emailPreference(method, body) {
    if (method === 'GET') {
      if (++reads === 1) return {};
      return {enabled:saved};
    }
    posts++;
    saved = body.enabled;
    throw Error('Lost save response');
  }});
  const choice = ids.get('dm-email-choice'), checkbox = ids.get('dm-email-enabled');
  const retry = ids.get('dm-email-retry');
  assert.equal(choice.hidden, true);
  assert.equal(retry.hidden, false);
  await retry.listeners.click();
  assert.equal(checkbox.checked, false);
  checkbox.checked = true;
  await checkbox.listeners.change();
  assert.equal(choice.hidden, true);
  assert.equal(retry.hidden, false);
  await retry.listeners.click();
  assert.equal(checkbox.checked, true);
  assert.equal(posts, 1);
});

test('a notification opens the specific invitation without reading another conversation; declining clears it', async () => {
  const { detail, invitation, openedThreads, writes, events } = await openChat(false, 'en', { invite: true });
  assert.equal(detail.querySelector('h2').textContent, invitation.name);
  assert.deepEqual(openedThreads, []);
  const decline = detail.querySelectorAll('button').find(b => b.textContent === 'Decline');
  await decline.listeners.click();
  assert.deepEqual(writes, [{ op: 'decline', threadId: invitation.id }]);
  assert.deepEqual(events, ['nodal:workspace-changed']);
  assert.equal(detail.querySelector('h2').textContent, 'This invitation is no longer pending.');
  assert.deepEqual(openedThreads, []);
});

test('the composer displays localized Photo, File and Send actions and opens the corresponding native picker', async () => {
  for (const [lang, labels, names] of [
    ['en', ['Photo', 'File', 'Send'], ['Attach photos', 'Attach files', 'Send message']],
    ['es', ['Foto', 'Archivo', 'Enviar'], ['Adjuntar fotos', 'Adjuntar archivos', 'Enviar mensaje']],
    ['pt', ['Foto', 'Arquivo', 'Enviar'], ['Anexar fotos', 'Anexar arquivos', 'Enviar mensagem']],
  ]) {
    const { detail } = await openChat(true, lang);
    const form = detail.querySelector('.chat-composer'), buttons = form.querySelectorAll('button');
    assert.deepEqual(buttons.map(b => b.querySelector('.composer-action-text').textContent), labels);
    assert.deepEqual(buttons.map(b => b.querySelector('.visually-hidden').textContent), names);
    for (const b of buttons) assert.equal(b.querySelector('.composer-action-text').getAttribute('aria-hidden'), 'true');
    assert.deepEqual(buttons.map(b => b.disabled), [false, false, true]);
    const opened = [];
    for (const picker of form.querySelectorAll('.chat-file-picker')) picker.click = () => opened.push(picker.accept);
    buttons[0].listeners.click();
    buttons[1].listeners.click();
    assert.deepEqual(opened[0].split(','), ['image/jpeg', 'image/png', 'image/webp']);
    assert.ok(opened[1].split(',').includes('.pdf'));
  }
});

for (const firstContact of [true, false]) {
  const kind = firstContact ? 'first direct message' : 'open group chat';
  test(kind + ' picks a file, preserves it across a lost response and shows the confirmed download', async () => {
    const { detail, writes, current, thread, peer, fileId } = await openChat(firstContact);
    const form = detail.querySelector('.chat-composer');
    assert.ok(form);
    const send = form.querySelector('.send-message'), picker = form.querySelector('.chat-file-picker');
    assert.equal(send.disabled, true);
    const bytes = Buffer.from('Street plan');
    picker.files = [{ name: 'plan.txt', size: bytes.length, type: 'text/plain', bytes }];
    picker.listeners.change(); await flush();
    assert.equal(form.querySelector('.file-name').textContent, 'plan.txt');
    assert.equal(send.disabled, false);

    const submit = () => form.listeners.submit({ preventDefault() {} });
    await submit();
    assert.ok(form.querySelector('.error'));
    assert.equal(form.querySelector('.file-name').textContent, 'plan.txt');
    assert.equal(send.disabled, false);
    await submit();

    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0], writes[1]);
    const { op, targetId, threadId, body, attachments, clientId } = writes[0];
    assert.equal(op, firstContact ? 'directFiles' : 'sendFiles');
    assert.equal(firstContact ? targetId : threadId, firstContact ? peer.id : thread.id);
    assert.ok(clientId); assert.equal(body, '');
    assert.deepEqual(attachments, [{ name: 'plan.txt', size: bytes.length, mime: 'text/plain', data: bytes.toString('base64') }]);
    const link = detail.querySelector('.chat-document');
    assert.equal(link.href, '/api/workspace/attachments/' + fileId);
    assert.equal(link.download, 'plan.txt');
    assert.equal(current.searchParams.get('thread'), thread.id);
    if (firstContact) assert.equal(detail.querySelector('.chat-composer'), null);
    else assert.equal(detail.querySelector('.chat-composer'), form, 'refresh updates the timeline in the existing chat');
  });
}

test('pasted screenshots and dropped files use the same pending queue while text stays native', async () => {
  const { detail } = await openChat(true), form = detail.querySelector('.chat-composer');
  const input = form.querySelector('.message-input');
  const image = { name: 'image.png', type: 'image/png', size: 7, bytes: Buffer.from('preview') };
  const event = data => ({ ...data, prevented: false, preventDefault() { this.prevented = true; } });
  const text = event({ clipboardData: { files: [], getData: () => 'Pasted text' } });
  input.listeners.paste(text);
  assert.equal(text.prevented, false);
  const paste = event({ clipboardData: { files: [image], getData: () => '' } });
  input.listeners.paste(paste); await flush();
  assert.equal(paste.prevented, true);
  assert.ok(form.querySelector('.composer-thumb'));
  const plainDrop = event({ dataTransfer: { types: ['text/plain'], files: [] } });
  form.listeners.drop(plainDrop);
  assert.equal(plainDrop.prevented, false);
  const file = { name: 'notes.txt', type: 'text/plain', size: 5, bytes: Buffer.from('notes') };
  const drop = event({ dataTransfer: { types: ['Files'], files: [file] } });
  form.listeners.dragover(drop); assert.equal(form.classList.contains('is-dragging-files'), true);
  form.listeners.drop(drop); await flush();
  assert.equal(form.classList.contains('is-dragging-files'), false);
  assert.equal(drop.prevented, true);
  assert.deepEqual(form.querySelectorAll('.file-name').map(n => n.textContent), ['image.png', 'notes.txt']);
});
