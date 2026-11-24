import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { Node, content, descendants, flush } from './helpers/fiiu-ui-harness.js';

const source = readFileSync(new URL('../web/scripts/workspace-notifications.js', import.meta.url), 'utf8');
const item = (overrides = {}) => ({
  id: randomUUID(), threadId: randomUUID(), type: 'message', threadKind: 'direct', groupName: '',
  actorName: 'Ana', createdAt: '2026-11-19T12:00:00Z', ...overrides,
});
const ok = (items, total = items.length, workspaceTotal) => ({ ok: true, status: 200, json: async () => ({ items, total, workspaceTotal }) });

async function bell(initial, { dashboard = false, hidden = false } = {}) {
  const listeners = {}, timers = new Map(), requests = [], counts = [];
  let answer = initial, timerId = 0, localize;
  const location = new URL('https://nodal.test/dashboard.html');
  const document = {
    hidden, activeElement: null, documentElement: { lang: 'en' },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    dispatchEvent(event) { for (const fn of listeners[event.type] || []) fn(event); },
  };
  class Element extends Node {
    constructor(tag) {
      super(tag); this.style = {};
      this.classList.add = cls => { this.className = [this.className, cls].filter(Boolean).join(' '); };
    }
    contains(other) { return this === other || descendants(this).includes(other); }
    focus() { document.activeElement = this; }
    matches() { return false; }
    getBoundingClientRect() { return { top: 20, bottom: 60, right: 350 }; }
    closest(selector) { return selector === 'a[href]' && this.tagName === 'a' ? this : this.parent?.closest(selector); }
    querySelector(selector) {
      if (selector.startsWith('[data-')) {
        const attr = selector.match(/^\[(data-[\w-]+)(?:="([^"]+)")?\]$/);
        return descendants(this).find(n => attr && (attr[1] === 'data-notice' ? n.dataset.notice === attr[2] : n.getAttribute(attr[1]) !== null)) || null;
      }
      return super.querySelector(selector);
    }
  }
  const mount = new Element(), original = new Element('button'), extra = new Element('details');
  if (dashboard) {
    original.setAttribute('data-workspace-trigger', ''); extra.setAttribute('data-workspace-extra', '');
    mount.append(original, extra);
  }
  document.querySelector = selector => selector === '[data-workspace-notifications]' ? mount : null;
  document.createElement = tag => new Element(tag);
  document.createElementNS = (_, tag) => new Element(tag);
  document.addEventListener('nodal:workspace-count', event => counts.push(event.detail.count));
  const i18n = { lang: 'en', onChange(fn) { localize = fn; } };
  vm.runInNewContext(source, {
    document, location, window: { nodalI18n: i18n, innerWidth: 390, innerHeight: 800, addEventListener() {}, removeEventListener() {} },
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout: id => timers.delete(id), URLSearchParams, CustomEvent, AbortController,
    fetch: async (path, options) => { requests.push({ path, options }); return typeof answer === 'function' ? answer(path, options) : answer; },
  });
  await flush();
  return {
    mount, original, extra, document, location, requests, counts, timers, get: cls => mount.querySelector('.workspace-bell-' + cls),
    fire: (type, event = {}) => document.dispatchEvent({ type, ...event }),
    async refresh(next) { answer = next; document.dispatchEvent({ type: 'nodal:workspace-changed' }); await flush(); },
    lang(code) { i18n.lang = code; localize(); },
  };
}

test('the shared bell adopts dashboard controls and links direct, group and invitation notices in all languages', async () => {
  const direct = item({ actorName: '<Ana>' });
  const group = item({ threadKind: 'group', groupName: 'School streets' });
  const invite = item({ threadKind: 'group', type: 'invitation', groupName: 'Lima', createdAt: null });
  const h = await bell(ok([direct, group, invite], 25), { dashboard: true });
  assert.equal(h.get('button'), h.original);
  assert.equal(h.extra.parent, h.get('panel'));
  assert.equal(h.get('button').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(h.counts, [25]);
  assert.equal(h.get('count').textContent, '25');
  const links = () => h.get('list').querySelectorAll('a');
  assert.deepEqual(links().map(n => n.href), [
    '/messages.html?thread=' + direct.threadId, '/messages.html?thread=' + group.threadId, '/messages.html?invite=' + invite.threadId,
  ]);
  assert.match(content(links()[0]), /<Ana> sent you a message/);
  assert.match(content(links()[1]), /Ana wrote in School streets/);
  assert.match(content(links()[2]), /Ana invited you to join Lima/);
  h.get('button').listeners.keydown({ key: 'ArrowDown', preventDefault() {} });
  assert.equal(h.document.activeElement, links()[0]);
  h.lang('es'); assert.match(content(h.get('list')), /Ana te invitó a unirte a Lima/);
  assert.equal(h.document.activeElement, links()[0]);
  h.lang('pt'); assert.match(content(h.get('list')), /Ana enviou uma mensagem em School streets/);
  h.fire('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(h.get('panel').hidden, true); assert.equal(h.document.activeElement, h.original);
  h.original.listeners.click(); h.fire('focusin', { target: h.mount });
  assert.equal(h.get('panel').hidden, true);
  h.original.listeners.click(); h.fire('click', { target: h.mount });
  assert.equal(h.get('panel').hidden, true);
});

test('unchanged polling is silent, reading clears the count, network or format failures preserve the last known notices', async () => {
  const one = item(), two = item({ actorName: 'Rosa' });
  const h = await bell(ok([one]));
  assert.equal(h.get('live').textContent, '');
  const first = h.get('item');
  await h.refresh(ok([one])); assert.equal(h.get('item'), first);
  await h.refresh(ok([two, one])); assert.match(h.get('live').textContent, /Rosa sent you a message/);
  h.get('live').textContent = '';
  await h.refresh(ok([two, one])); assert.equal(h.get('live').textContent, '');
  await h.refresh({ ok: true, status: 200, json: async () => ({ threads: [], invitations: [] }) });
  assert.equal(h.get('retry').hidden, false); assert.equal(h.get('count').textContent, '2');
  await h.refresh(() => { throw new Error('offline'); });
  assert.equal(h.get('list').children.length, 2);
  await h.refresh(ok([])); assert.deepEqual(h.counts, [1, 2, 0]);
  assert.equal(h.get('count').hidden, true); assert.equal(h.get('retry').hidden, true);
  assert.match(h.get('status').textContent, /No unread notifications/);
  await h.refresh({ ok: false, status: 401 });
  assert.equal(h.get('panel').parent.hidden, true);
  assert.equal(h.timers.size, 0);
  assert.ok(h.requests.every(r => r.path === '/api/workspace/notifications?editorial=1' && r.options.cache === 'no-store' && !r.options.method));
});

test('polling pauses in hidden tabs and a read during an in-flight request supersedes its stale result', async () => {
  let resolve;
  const stale = item(), h = await bell(ok([stale]), { hidden: true });
  assert.equal(h.requests.length, 0); assert.equal(h.timers.size, 0);
  h.document.hidden = false; h.fire('visibilitychange'); await flush();
  assert.deepEqual(h.counts, [1]);
  const outstanding = new Promise(r => { resolve = r; });
  await h.refresh(() => outstanding); await h.refresh(ok([]));
  resolve(ok([stale, item()])); await flush();
  assert.deepEqual(h.counts, [1, 0]);
  assert.equal(h.get('live').textContent, '');
  h.document.hidden = true; h.fire('visibilitychange');
  assert.equal(h.timers.size, 0);
});

test('a second message in an unread thread shows a dismissible banner even though the count stays at one', async () => {
  const first = item(), second = item({ threadId: first.threadId, actorName: 'Ana' }), h = await bell(ok([first]));
  const toast = h.get('toast'), link = toast.querySelector('a');
  assert.equal(toast.hidden, true, 'initial history does not create a banner');
  await h.refresh(ok([item({ type: 'invitation', threadKind: 'group', createdAt: null })]));
  assert.equal(toast.hidden, true, 'a historical invitation newly exposed by paging is not a new arrival');
  assert.equal(h.get('live').textContent, '');
  await h.refresh(ok([second]));
  assert.equal(toast.hidden, false); assert.equal(link.href, '/messages.html?thread=' + first.threadId);
  assert.match(link.textContent, /Ana sent you a message/);
  h.get('dismiss').listeners.click({ detail: 1 }); assert.equal(toast.hidden, true);
  await h.refresh(ok([second])); assert.equal(toast.hidden, true); assert.deepEqual(h.counts, [1]);
  h.location.href = 'https://nodal.test/messages.html?thread=' + first.threadId;
  await h.refresh(ok([item({ threadId: first.threadId })])); assert.equal(toast.hidden, true);
  h.location.href = 'https://nodal.test/dashboard.html';
  await h.refresh(ok([item(), item()])); assert.equal(toast.hidden, false);
  const several = toast.querySelector('button'); assert.match(several.textContent, /2 new notifications/);
  several.listeners.click(); assert.equal(toast.hidden, true); assert.equal(h.get('panel').hidden, false);
  await h.refresh(ok([item()])); assert.equal(toast.hidden, true, 'the open bell already shows incoming activity');
  assert.ok(h.requests.every(r => !r.options.method));
});

test('the bell links editorial items by source, translates headlines and keeps the inbox count separate', async () => {
  const news = { type: 'news', id: randomUUID(), title: 'Ríos <urbanos>', createdAt: '2026-11-24T12:00:00Z' };
  const opportunity = { type: 'opportunity', id: news.id, title: { en: 'Summer school', es: 'Escuela de verano', pt: 'Escola de verão' }, createdAt: news.createdAt };
  const direct = item();
  const h = await bell(ok([news, opportunity, direct], 35, 7));
  const links = () => h.get('list').querySelectorAll('a');
  assert.equal(h.get('count').textContent, '35');
  assert.deepEqual(h.counts, [7], 'the sidebar only advertises unread conversations and invitations');
  assert.deepEqual(links().map(n => n.href), [
    '/community.html?news=' + news.id + '#nodal-news', '/opportunities.html?id=' + opportunity.id, '/messages.html?thread=' + direct.threadId,
  ]);
  assert.match(content(links()[0]), /Ríos <urbanos>/);
  assert.match(content(links()[1]), /Featured opportunity/);
  h.get('button').listeners.click(); links()[1].focus();
  h.lang('es'); assert.match(content(links()[1]), /Oportunidad destacada.*Escuela de verano/);
  h.lang('pt'); assert.match(content(links()[1]), /Oportunidade em destaque.*Escola de verão/);
  assert.equal(h.document.activeElement, links()[1]);
  assert.ok(h.requests.every(r => !r.options.method), 'opening the bell or reading its preview does not mark it read');
  let read = false;
  await h.refresh(async (path, options) => {
    if (options.method === 'POST') { read = true; return { ok: true }; }
    return read ? ok([opportunity, direct], 34, 7) : ok([news, opportunity, direct], 35, 7);
  });
  const link = links()[0]; link.listeners.click({type: 'click', button: 0});
  await flush();
  const writes = h.requests.filter(r => r.options.method === 'POST');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/api/workspace/notifications/read');
  assert.deepEqual(JSON.parse(writes[0].options.body), { type: 'news', id: news.id });
  assert.equal(writes[0].options.keepalive, true);
  assert.equal(writes[0].options.credentials, 'same-origin');
  assert.equal(h.get('count').textContent, '34');
  assert.deepEqual(h.counts, [7]);
  assert.equal(links().some(l => l.href === link.href), false);
});

test('a featured opportunity can be opened from a single-arrival toast and a failed receipt leaves it unread', async () => {
  const id = randomUUID(), at = '2026-11-24T12:00:00Z';
  const news = { type: 'news', id, title: 'Lima hoy', createdAt: at };
  const opportunity = { type: 'opportunity', id, title: { en: 'Call', pt: 'Edital', es: 'Convocatoria' }, createdAt: at };
  const h = await bell(ok([news], 1, 0));
  await h.refresh(async (path, options) => options.method === 'POST' ? { ok: false } : ok([news, opportunity], 2, 0));
  const toast = h.get('toast'), link = toast.querySelector('a');
  assert.equal(toast.hidden, false, 'the news item with the same UUID does not suppress an opportunity');
  assert.equal(link.href, '/opportunities.html?id=' + id);
  assert.match(link.textContent, /Featured opportunity.*Call/);
  link.listeners.auxclick({type: 'auxclick', button: 1}); await flush();
  assert.deepEqual(JSON.parse(h.requests.find(r => r.options.method === 'POST').options.body), {type: 'opportunity', id});
  assert.equal(h.get('count').textContent, '2');
});
