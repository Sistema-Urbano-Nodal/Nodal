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

async function openChat(firstContact, lang = 'en') {
  const body = new ChatNode('body'), ids = new Map();
  for (const id of ['detail', 'inbox-list', 'inbox-search', 'new-message', 'new-group', 'mailbox-owner']) {
    const element = new ChatNode('div');
    ids.set(id, element); body.append(element);
  }
  const current = new URL('https://nodal.test/messages.html');
  const me = { id: randomUUID(), fullName: 'Ana' }, peer = { id: randomUUID(), fullName: 'Rosa', title: 'Member' };
  const thread = { id: randomUUID(), name: firstContact ? peer.fullName : 'School streets', revision: 0,
    kind: firstContact ? 'direct' : 'group', status: firstContact ? 'pending' : 'active', peerId: peer.id, initiatorId: me.id };
  current.searchParams.set(firstContact ? 'to' : 'thread', firstContact ? peer.id : thread.id);
  const writes = [], messages = [], fileId = randomUUID();
  async function fetch(path, options) {
    let data;
    if (path === '/api/auth/me') data = { user: me };
    else if (path === '/api/users/' + peer.id) data = { user: peer };
    else if (path === '/api/workspace' && options.method !== 'POST') {
      data = { threads: firstContact && !messages.length ? [] : [thread], invitations: [] };
    } else if (path === '/api/workspace?threadId=' + thread.id) {
      data = { thread, messages, members: [{ id: me.id, status: 'active' }], projects: [], moreMessages: false };
    } else if (path === '/api/workspace' && options.method === 'POST') {
      const request = JSON.parse(options.body);
      writes.push(request);
      if (writes.length === 1) {
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
    createElement: tag => new ChatNode(tag), createElementNS: (_, tag) => new ChatNode(tag),
    querySelectorAll: selector => body.querySelectorAll(selector),
  };
  class FileReader {
    readAsDataURL(file) { this.result = 'data:' + file.type + ';base64,' + file.bytes.toString('base64'); this.onload(); }
  }
  const context = vm.createContext({
    document, location: current, URL, URLSearchParams, crypto: { randomUUID }, FileReader, clearTimeout, fetch,
    history: { replaceState: (_, title, url) => { current.href = new URL(url, current).href; } },
    window: { addEventListener() {}, setInterval() {}, matchMedia: () => ({ matches: true }) },
  });
  for (const name of ['messages-i18n', 'messages']) vm.runInContext(script(name), context, { filename: name + '.js' });
  await flush();
  return { detail: ids.get('detail'), writes, current, thread, peer, fileId };
}

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
