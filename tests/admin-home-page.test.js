import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/server.js';
import { createDatabase } from '../server/db.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const page = (name) => readFileSync(path.join(ROOT, 'web', 'pages', name), 'utf8');

test('the page is the desk\'s frame with the home\'s assets', () => {
  const html = page('admin-home.html');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(html, /<body class="admin-page" data-page="admin-home">/);
  const header = (source) => source.match(/<header class="navbar">[\s\S]*?<\/header>/)[0];
  assert.equal(header(html), header(page('admin.html')));
  const after = html.slice(html.indexOf(header(html)) + header(html).length);
  assert.match(after, /^\s*<nav class="staff-nav"[\s\S]*?<\/nav>\s*<main class="admin-shell" id="homeMain">/);
  const sheets = [...head.matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map((m) => m[1]);
  assert.deepEqual(sheets, ['locale.css', 'fonts.css', 'styles.css', 'admin.css', 'admin-home.css', 'workspace-notifications.css', 'admin-nav.css']);
  assert.match(head, /<script src="locale\.js\?v=\d+[a-z]?"><\/script>/);
  const deferred = [...head.matchAll(/<script defer src="([^"?]+)[^>]*>/g)].map((m) => m[1]);
  assert.deepEqual(deferred, ['nav.js', 'script.js', 'admin-nav.js', 'admin-home.js', 'i18n.js', 'workspace-notifications.js', 'visit.js']);
  assert.match(head, /<script defer src="visit\.js\?v=\d+[a-z]?" data-staff><\/script>\s*$/);
  assert.doesNotMatch(html, /i18n-dashboard/);
  assert.doesNotMatch(html, /data-i18n="(?:ops|d|p|y)\./);
  assert.ok(head.includes('<meta name="robots" content="noindex, nofollow" />'));
  assert.match(html, /<a class="admin-skip" href="#homeMain">Skip to content<\/a>/);
  assert.match(html, /id="homeStatus" role="status"/);
  // One live region (the status line), and no accessible name the script cannot translate.
  assert.equal((html.slice(html.indexOf('<main')).match(/aria-live=/g) || []).length, 1);
  assert.doesNotMatch(html.slice(html.indexOf('<main')), /aria-label=/);
  // The home's words are its script's own rows: no dictionary key in its markup.
  assert.doesNotMatch(html.slice(html.indexOf('<main')), /data-i18n/);
  assert.match(html, /id="homeRetry"[^>]*\bhidden\b/);
  assert.match(html, /id="homeSignIn"[^>]*href="login\.html\?next=%2Fadmin-home\.html"[^>]*\bhidden\b/);
  // Report and navigation controls become available when the page has data.
  for (const id of ['homeViews', 'homeReports', 'homeTop', 'homePending', 'homeReadingsCsv']) assert.match(html, new RegExp(`id="${id}"[^>]*\\bhidden\\b`), id);
  // Every id the script reads stands in the markup once.
  const script = readFileSync(path.join(ROOT, 'web', 'scripts', 'admin-home.js'), 'utf8');
  const read = [...script.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  for (const id of read) assert.equal((html.match(new RegExp(`\\bid="${id}"`, 'g')) || []).length, 1, id);
  const views = html.match(/<nav\b[^>]*id="homeViews"[^>]*>[\s\S]*?<\/nav>/)[0];
  assert.match(views, /aria-labelledby="homeTitle"/);
  const links = [...views.matchAll(/<a\b([^>]+)>([^<]+)<\/a>/g)];
  assert.deepEqual(links.map(([, attrs, label]) => [attrs.match(/href="#([^"]+)"/)[1], label]), [
    ['homeTop', 'Overview'], ['homeBlocks', 'Indicators'], ['homeTracking', 'Monthly history'],
  ]);
  assert.match(links[0][1], /aria-current="location"/);
  assert.equal((views.match(/aria-current=/g) || []).length, 1);
  for (const [, attrs] of links) {
    const id = attrs.match(/href="#([^"]+)"/)[1];
    assert.equal((html.match(new RegExp(`\\bid="${id}"`, 'g')) || []).length, 1, id);
  }
  const periods = html.match(/<section\b[^>]*aria-labelledby="homePeriodTitle"[^>]*>[\s\S]*?<\/section>/)[0];
  assert.match(periods, /id="homeWindows"/);
  assert.match(periods, /<a\b[^>]*id="homeCompare"[^>]*href="#homeTracking"[^>]*\bhidden\b/);
  const reports = html.match(/<details\b[^>]*id="homeReports"[^>]*>[\s\S]*?<\/details>/)[0];
  assert.match(reports, /<summary id="homeReportsLabel">Export report<\/summary>/);
  assert.match(reports, /role="group" aria-labelledby="homeCsvLabel"/);
  for (const id of ['homePrint', 'homeCsv', 'homeMonthsCsv', 'homeReadingsCsv']) assert.ok(reports.includes(`id="${id}"`), id);
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
