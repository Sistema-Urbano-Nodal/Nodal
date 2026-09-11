import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { preparePageHtml } from '../server/page-shell.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const WEB_ROOT = path.join(ROOT, 'web');
const OUTPUT = path.join(ROOT, 'public');
const STATIC_PAGES = ['opportunities.html'];
// These pages stay on the Node server for authorization, recovery redirects,
// and runtime configuration. Validate them without copying them to the CDN.
const SERVER_PAGES = ['index.html', 'login.html', 'reset-password.html', 'accept-invitation.html', 'dashboard.html', 'profile.html', 'payments.html', 'admin.html', 'courses.html', 'course.html', 'teaching.html'];
const STATIC_SCRIPTS = [
  'admin.js',
  'app.js',
  'auth.js',
  'password-recovery.js',
  'recovery-i18n.js',
  'accept-invitation.js',
  'invitation-i18n.js',
  'catalog.js',
  'courses.js',
  'coastline.js',
  'dashboard.js',
  'globe.js',
  'globe-geo.js',
  'i18n.js',
  'location-i18n.js',
  'location-check.js',
  'nav.js',
  'payments.js',
  'pilot.js',
  'pilot-i18n.js',
  'profile.js',
  'recs.js',
  'script.js',
  'teaching.js',
];
const STATIC_STYLES = ['auth.css', 'admin.css', 'catalog.css', 'courses.css', 'dashboard.css', 'styles.css', 'recovery.css', 'fonts.css'];
const STATIC_ASSETS = [
  'latam-map.webp',
  'nodal-community.webp',
  'nodal-wordmark.webp',
];
const STATIC_FONTS = [
  'montserrat-v31-latin-normal.woff2',
  'montserrat-v31-latin-ext-normal.woff2',
  'montserrat-v31-latin-italic.woff2',
  'montserrat-v31-latin-ext-italic.woff2',
  'OFL.txt',
];

export async function buildStatic({ output = OUTPUT, webRoot = WEB_ROOT, pilotMode = process.env.PILOT_MODE !== 'false' } = {}) {
  const copies = [
    ...STATIC_SCRIPTS.map(file => [path.join('scripts', file), file]),
    ...STATIC_STYLES.map(file => [path.join('styles', file), file]),
    ...STATIC_ASSETS.map(file => [path.join('assets', 'optimized', file), path.join('assets', file)]),
    ...STATIC_FONTS.map(file => [path.join('assets', 'fonts', file), path.join('assets', 'fonts', file)]),
  ];
  // Fail on a missing source before touching the last build.
  await Promise.all([
    ...SERVER_PAGES.map(file => path.join('pages', file)),
    ...STATIC_PAGES.map(file => path.join('pages', file)),
    ...copies.map(([source]) => source),
  ].map(file => access(path.join(webRoot, file))));
  const pages = await Promise.all(STATIC_PAGES.map(async file => [
    file, preparePageHtml(await readFile(path.join(webRoot, 'pages', file), 'utf8'), { pilotMode }),
  ]));

  await mkdir(output, { recursive: true });
  // public/ is generated. Old scripts and HTML must never survive a rebuild:
  // Vercel serves filesystem matches ahead of the authenticated Node routes.
  await Promise.all((await readdir(output)).filter(file => file !== '.gitkeep')
    .map(file => rm(path.join(output, file), { recursive: true, force: true })));
  await mkdir(path.join(output, 'assets', 'fonts'), { recursive: true });
  await Promise.all([
    ...pages.map(([file, html]) => writeFile(path.join(output, file), html)),
    ...copies.map(([source, destination]) => copyFile(path.join(webRoot, source), path.join(output, destination))),
  ]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await buildStatic();
