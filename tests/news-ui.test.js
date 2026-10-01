import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');
const FEED = read('web', 'scripts', 'news-feed.js');

class Node {
  constructor(tag) {
    this.tagName = tag;
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.dataset = {};
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  scrollIntoView(options) { (this.scrolls ||= []).push(options); }
}
const all = (node) => (node.children || []).flatMap((child) => [child, ...all(child)]);
const textOf = (node) => [node.textContent, ...(node.children || []).map(textOf)].filter(Boolean).join(' ');
const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

function loadI18n(lang) {
  const context = {
    document: { body: { dataset: { page: 'community' } }, documentElement: {}, querySelectorAll: () => [] },
    window: { location: { search: '' } },
    localStorage: { getItem() { return null; }, setItem() {} },
    URLSearchParams,
    console,
  };
  vm.runInNewContext(read('web', 'scripts', 'i18n.js'), context);
  context.window.nodalI18n.apply(lang);
  return context.window.nodalI18n;
}

function host(dataset = {}) {
  const node = new Node('section');
  node.hidden = true;
  Object.assign(node.dataset, { nodalNews: '' }, dataset);
  return node;
}

async function mount(hosts, fetchImpl, lang = 'en', { hash = '' } = {}) {
  const requests = [];
  const i18n = loadI18n(lang);
  const context = {
    URL,
    URLSearchParams,
    Intl,
    document: {
      querySelectorAll: (selector) => (selector === '[data-nodal-news]' ? hosts : []),
      createElement: (tag) => new Node(tag),
    },
    window: { nodalI18n: i18n, location: { hash } },
    fetch: async (url, options) => { requests.push({ url, options }); return fetchImpl(url, options); },
  };
  vm.runInNewContext(FEED, context, { filename: 'news-feed.js' });
  await settle();
  return { requests, i18n };
}

const ok = (payload) => ({ ok: true, status: 200, async json() { return payload; } });
const post = (id, overrides = {}) => ({ id, title: `Post ${id}`, body: `Body ${id}`, url: '', pinned: false, publishedAt: '2026-09-20T12:00:00.000Z', ...overrides });
const articles = (node) => all(node).filter((child) => child.tagName === 'article');
const day = (lang, iso) => new Intl.DateTimeFormat({ en: 'en-GB', es: 'es-ES', pt: 'pt-BR' }[lang], { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
const titles = (node) => articles(node).map((article) => article.children.find((child) => /^h\d$/.test(child.tagName)).textContent);

test('news renders pinned first, then newest, as plain text', async () => {
  const feed = host({ nodalNewsLimit: '3' });
  const { requests } = await mount([feed], async () => ok({
    items: [
      post('old', { publishedAt: '2026-09-01T12:00:00.000Z' }),
      post('new', { publishedAt: '2026-09-29T12:00:00.000Z', title: '<img src=x onerror=alert(1)>' }),
      post('pin', { pinned: true, publishedAt: '2026-08-01T12:00:00.000Z' }),
    ],
    nextCursor: null,
  }));
  assert.equal(requests[0].url, '/api/news?limit=3');
  assert.equal(feed.hidden, false);
  assert.deepEqual(titles(feed), ['Post pin', '<img src=x onerror=alert(1)>', 'Post old']);
  const [pinned] = articles(feed);
  assert.equal(textOf(pinned), `Pinned ${day('en', '2026-08-01T12:00:00.000Z')} Post pin Body pin`);
  assert.equal(all(pinned).find((child) => child.tagName === 'time').dateTime, '2026-08-01T12:00:00.000Z');
  assert.doesNotMatch(FEED, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test('only https links are linked, in a new tab with noopener', async () => {
  const feed = host();
  await mount([feed], async () => ok({ items: [
    post('a', { url: 'https://nodal.example/course' }),
    post('b', { url: 'http://insecure.example' }),
    post('c', { url: 'javascript:alert(1)' }),
    post('d', { url: 'data:text/html,hi' }),
    post('e', { url: '//cdn.example/x' }),
  ], nextCursor: null }));
  const links = all(feed).filter((child) => child.tagName === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://nodal.example/course');
  assert.equal(links[0].target, '_blank');
  assert.equal(links[0].rel, 'noopener noreferrer');
  assert.equal(links[0].textContent, 'Read more');
  assert.equal(links[0].getAttribute('aria-label'), 'Read more: Post a (opens in a new tab)');
});

test('the block stays hidden with no news, a failed request or no API', async () => {
  for (const reply of [
    async () => ok({ items: [], nextCursor: null }),
    async () => ({ ok: false, status: 500, async json() { return { items: [post('x')] }; } }),
    async () => { throw new TypeError('Failed to fetch'); },
    async () => ok({ items: [{ id: 'no-title', title: '   ' }, null, 'junk'] }),
  ]) {
    const feed = host();
    await mount([feed], reply);
    assert.equal(feed.hidden, true);
    assert.equal(articles(feed).length, 0);
  }
});

test('news is localised and follows the language switch', async () => {
  const feed = host({ nodalNewsAll: 'community.html#nodal-news' });
  const { i18n } = await mount([feed], async () => ok({ items: [post('p', { pinned: true, url: 'https://nodal.example' })], nextCursor: null }), 'es');
  const strings = () => textOf(feed);
  const when = (lang) => day(lang, '2026-09-20T12:00:00.000Z');
  assert.equal(strings(), `Fijada ${when('es')} Post p Body p Leer más Todas las noticias NODAL`);
  const allLink = all(feed).find((child) => child.className.includes('nodal-news-all'));
  assert.equal(allLink.href, 'community.html#nodal-news');
  i18n.apply('pt');
  assert.equal(strings(), `Fixada ${when('pt')} Post p Body p Ler mais Todas as notícias NODAL`);
  assert.equal(all(feed).find((child) => child.tagName === 'a').getAttribute('aria-label'), 'Ler mais: Post p (abre em uma nova aba)');
  i18n.apply('en');
  assert.equal(strings(), `Pinned ${when('en')} Post p Body p Read more All NODAL news`);
});

test('the community feed pages through older news without duplicates', async () => {
  const feed = host({ nodalNewsLimit: '2', nodalNewsMore: '' });
  const { requests } = await mount([feed], async (url) => (url.includes('cursor=')
    ? ok({ items: [post('b', { publishedAt: '2026-09-02T12:00:00.000Z' }), post('c', { publishedAt: '2026-09-01T12:00:00.000Z' })], nextCursor: null })
    : ok({ items: [post('a', { publishedAt: '2026-09-03T12:00:00.000Z' }), post('b', { publishedAt: '2026-09-02T12:00:00.000Z' })], nextCursor: 'page-2' })));
  const more = all(feed).find((child) => child.tagName === 'button');
  assert.equal(more.hidden, false);
  assert.equal(more.textContent, 'More news');
  assert.equal(more.type, 'button');
  more.listeners.get('click')();
  await settle();
  assert.equal(requests[1].url, '/api/news?limit=2&cursor=page-2');
  assert.deepEqual(titles(feed), ['Post a', 'Post b', 'Post c']);
  assert.equal(more.hidden, true);
  assert.equal(more.disabled, false);
});

test('limits and heading levels are bounded, and every block loads independently', async () => {
  const dashboard = host({ nodalNewsLimit: '999', nodalNewsHeading: 'script' });
  const community = host({ nodalNewsLimit: '0', nodalNewsHeading: 'h4' });
  const { requests } = await mount([dashboard, community], async () => ok({ items: [post('a')], nextCursor: null }));
  assert.deepEqual(requests.map((request) => request.url).sort(), ['/api/news?limit=20', '/api/news?limit=5']);
  assert.equal(articles(dashboard)[0].children.at(-1).tagName, 'p');
  assert.ok(articles(dashboard)[0].children.some((child) => child.tagName === 'h3'), 'an unknown heading falls back to h3');
  assert.ok(articles(community)[0].children.some((child) => child.tagName === 'h4'));
});

test('the console and the community page carry a hidden news block and load the feed after i18n', () => {
  for (const [page, attributes] of [
    ['dashboard.html', /<section class="ctx-block f-news-widget" id="nodalNews" data-nodal-news data-nodal-news-limit="3" data-nodal-news-all="community\.html#nodal-news" aria-labelledby="nodalNewsTitle" hidden>/],
    ['community.html', /<section class="f-updates" id="nodal-news" data-nodal-news data-nodal-news-limit="10" data-nodal-news-more aria-labelledby="nodalNewsTitle" hidden>/],
  ]) {
    const html = read('web', 'pages', page);
    assert.match(html, attributes, page);
    assert.match(html, /<h2 id="nodalNewsTitle" data-i18n="news\.title">NODAL news<\/h2>/, page);
    const i18n = html.indexOf('src="i18n.js'), feed = html.indexOf('<script defer src="news-feed.js');
    assert.ok(i18n > 0 && feed > i18n, `${page} must load news-feed.js after i18n.js`);
  }
  // The dashboard block clips each post to the festival widget's two lines; the full text lives on the community page.
  assert.match(read('web', 'pages', 'community.html'), /id="nodal-news"/);
});

test('a link to the news block lands on it once the first page is shown, and nothing else scrolls', async () => {
  // community.html#nodal-news: the block ships hidden, so the browser had nothing to jump to while the page loaded.
  const feed = Object.assign(host({ nodalNewsMore: '' }), { id: 'nodal-news' });
  let page = 0;
  const { i18n } = await mount([feed], async () => ok({ items: [post(`p${page += 1}`)], nextCursor: page < 2 ? 'next' : null }), 'en', { hash: '#nodal-news' });
  assert.equal(feed.hidden, false);
  assert.equal(JSON.stringify(feed.scrolls), JSON.stringify([{ block: 'start' }]));
  const more = all(feed).find((child) => child.tagName === 'button');
  await more.listeners.get('click')();
  await settle();
  i18n.apply('es');
  assert.equal(feed.scrolls.length, 1, 'the next page and a language change keep the reader where they are');
  // Another address, or a block without news, never scrolls.
  const other = Object.assign(host(), { id: 'nodal-news' });
  await mount([other], async () => ok({ items: [post('a')], nextCursor: null }), 'en', { hash: '#network' });
  assert.equal(other.scrolls, undefined);
  const empty = Object.assign(host(), { id: 'nodal-news' });
  await mount([empty], async () => ok({ items: [], nextCursor: null }), 'en', { hash: '#nodal-news' });
  assert.equal(empty.hidden, true);
  assert.equal(empty.scrolls, undefined);
});
