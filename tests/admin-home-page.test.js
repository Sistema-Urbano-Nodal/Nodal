import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/server.js';
import { createDatabase } from '../server/db.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const page = (name) => readFileSync(path.join(ROOT, 'web', 'pages', name), 'utf8');
const IDS = ['homeMain', 'homeTitle', 'homeAsOf', 'homeRefresh', 'homeWindows', 'homeStatus', 'homeRetry', 'homeSignIn', 'homeCsv', 'homePrint', 'homeLead', 'homePending', 'homeBlocks', 'homeTracking', 'homeReadingsCsv', 'homeMonthsCsv', 'homePrintHead',
  'homeTop', 'homeRoute', 'homeCsvLabel', 'homeCompare'];

test('the page is the desk\'s frame with the home\'s assets', () => {
  const html = page('admin-home.html');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(html, /<body class="admin-page" data-page="admin-home">/);
  const header = (source) => source.match(/<header class="navbar">[\s\S]*?<\/header>/)[0];
  assert.equal(header(html), header(page('admin.html')));
  const after = html.slice(html.indexOf(header(html)) + header(html).length);
  assert.match(after, /^\s*<nav class="staff-nav"[\s\S]*?<\/nav>\s*<main class="admin-shell" id="homeMain">/);
  const sheets = [...head.matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map((m) => m[1]);
  assert.deepEqual(sheets, ['locale.css', 'fonts.css', 'styles.css', 'admin.css', 'admin-home.css', 'admin-nav.css']);
  assert.match(head, /<script src="locale\.js\?v=\d+[a-z]?"><\/script>/);
  const deferred = [...head.matchAll(/<script defer src="([^"?]+)[^>]*>/g)].map((m) => m[1]);
  assert.deepEqual(deferred, ['nav.js', 'script.js', 'admin-nav.js', 'admin-home.js', 'i18n.js', 'visit.js']);
  assert.match(head, /<script defer src="visit\.js\?v=\d+[a-z]?" data-staff><\/script>\s*$/);
  assert.doesNotMatch(html, /i18n-dashboard/);
  assert.doesNotMatch(html, /data-i18n="(?:ops|d|p|y)\./);
  assert.ok(head.includes('<meta name="robots" content="noindex, nofollow" />'));
  for (const id of IDS) assert.equal((html.match(new RegExp(`\\bid="${id}"`, 'g')) || []).length, 1, id);
  assert.match(html, /id="homeStatus" role="status"/);
  // One live region (the status line), and no accessible name the script cannot translate.
  assert.equal((html.slice(html.indexOf('<main')).match(/aria-live=/g) || []).length, 1);
  assert.doesNotMatch(html.slice(html.indexOf('<main')), /aria-label=/);
  // The home's words are its script's own rows: no dictionary key in its markup.
  assert.doesNotMatch(html.slice(html.indexOf('<main')), /data-i18n/);
  assert.match(html, /id="homeRetry"[^>]*\bhidden\b/);
  assert.match(html, /id="homeSignIn"[^>]*\bhidden\b/);
  // Hidden until the script has something to put in them: the top, the queues, the readings download, the month jump.
  for (const id of ['homeTop', 'homePending', 'homeReadingsCsv', 'homeCompare']) assert.match(html, new RegExp(`id="${id}"[^>]*\\bhidden\\b`), id);
  // Every id the script reads stands in the markup once.
  const script = readFileSync(path.join(ROOT, 'web', 'scripts', 'admin-home.js'), 'utf8');
  const read = [...script.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(read.length >= 20, read.join());
  for (const id of read) assert.equal((html.match(new RegExp(`\\bid="${id}"`, 'g')) || []).length, 1, id);
  // The tools in the order a phone stacks them, the downloads named by their visible label; the top in reading order.
  const order = (ids) => ids.map((id) => html.indexOf(`id="${id}"`));
  const tools = order(['homeRefresh', 'homePrint', 'homeCsvLabel', 'homeCsv', 'homeMonthsCsv', 'homeReadingsCsv', 'homeCompare']);
  assert.deepEqual(tools, [...tools].sort((a, b) => a - b));
  assert.match(html, /<span class="home-csv" role="group" aria-labelledby="homeCsvLabel">/);
  const sheet = order(['homeStatus', 'homeRetry', 'homeTop', 'homeRoute', 'homeLead', 'homePending', 'homeBlocks', 'homeTracking']);
  assert.deepEqual(sheet, [...sheet].sort((a, b) => a - b));
  assert.match(html, /<a class="home-compare" id="homeCompare" href="#homeTracking" hidden>/);
  // Nothing the pages' Content-Security-Policy refuses: no inline script, no style element or attribute.
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(html, /<style\b|\sstyle=/);
});

test('the staff bar on the home marks Metrics as current', () => {
  const bar = page('admin-home.html').match(/<nav class="staff-nav"[\s\S]*?<\/nav>/)[0];
  assert.ok(bar.includes('<nav class="staff-nav" data-staff-nav aria-label="Administration"><a href="admin-home.html" data-staff="home" aria-current="page">Metrics</a><a href="admin.html" data-staff="desk">Publishing</a><a href="fiiu-admin.html" data-staff="festival">Festival</a><a href="teaching.html" data-staff="courses">Courses</a><button type="button" data-staff="signOut">Sign out</button><span role="status" aria-live="polite" data-staff-status></span></nav>'));
  assert.doesNotMatch(bar, /<li\b|data-i18n|\bid=/);
});

test('the home is gated like the desk', async (t) => {
  const saved = process.env.PILOT_MODE;
  t.after(() => { if (saved === undefined) delete process.env.PILOT_MODE; else process.env.PILOT_MODE = saved; });
  process.env.PILOT_MODE = 'false';
  const db = createDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  const server = createApp({ db, citySearch: { search: async () => ({ cities: [] }) } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const signedOut = await fetch(`${base}/admin-home.html`, { redirect: 'manual' });
  assert.equal(signedOut.status, 302);
  assert.equal(signedOut.headers.get('location'), '/login.html?next=%2Fadmin-home.html');

  const signUp = async (email) => {
    const res = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: 'Home Tester', email, password: 'correct-horse' }) });
    assert.ok(res.ok, `sign-up ${res.status}`);
    return { cookie: res.headers.get('set-cookie').split(';')[0], id: (await res.json()).user.id };
  };
  const member = await signUp('home-member@example.com');
  // A member who types /admin (or follows a shared link) gets the page that says the area is for the team, not raw JSON.
  const denied = await fetch(`${base}/admin-home.html`, { headers: { Cookie: member.cookie }, redirect: 'manual' });
  assert.equal(denied.status, 403);
  assert.match(denied.headers.get('content-type'), /^text\/html/);
  const deniedPage = await denied.text();
  assert.match(deniedPage, /data-fiiu-text="organisersOnly"/);
  assert.doesNotMatch(deniedPage, /admin-home\.js|id="homeMain"/);

  const admin = await signUp('home-admin@example.com');
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);
  const ok = await fetch(`${base}/admin-home.html`, { headers: { Cookie: admin.cookie }, redirect: 'manual' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.match(await ok.text(), /id="homeMain"/);
});

test('/admin opens the home', async (t) => {
  const saved = process.env.PILOT_MODE;
  t.after(() => { if (saved === undefined) delete process.env.PILOT_MODE; else process.env.PILOT_MODE = saved; });
  process.env.PILOT_MODE = 'false';
  const db = createDatabase({ filename: ':memory:' });
  t.after(() => db.close());
  const server = createApp({ db, citySearch: { search: async () => ({ cities: [] }) } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: 'Door Admin', email: 'door-admin@example.com', password: 'correct-horse' }) });
  assert.ok(res.ok);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run((await res.json()).user.id);
  for (const p of ['/admin', '/admin/', '/ADMIN']) for (const method of ['GET', 'HEAD']) {
    const r = await fetch(`${base}${p}`, { method, headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(r.status, 302, `${method} ${p}`);
    assert.equal(r.headers.get('location'), '/admin-home.html', `${method} ${p}`);
  }
  const out = await fetch(`${base}/admin`, { redirect: 'manual' });
  assert.equal(out.status, 302);
  assert.equal(out.headers.get('location'), '/admin-home.html');
  const next = await fetch(`${base}/admin-home.html`, { redirect: 'manual' });
  assert.equal(next.status, 302);
  assert.equal(next.headers.get('location'), '/login.html?next=%2Fadmin-home.html');
  const post = await fetch(`${base}/admin`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}', redirect: 'manual' });
  assert.notEqual(post.status, 302, 'only page loads are redirected');
  for (const p of ['/admin.html', '/admin.html#nodes', '/admin.html#founders']) {
    const r = await fetch(`${base}${p}`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /Publishing/);
  }
});
