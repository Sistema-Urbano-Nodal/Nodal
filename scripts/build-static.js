import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WEB_ROOT = path.join(ROOT, 'web');
const OUTPUT = path.join(ROOT, 'public');
const STATIC_PAGES = ['opportunities.html'];
const STATIC_SCRIPTS = [
  'app.js',
  'auth.js',
  'catalog.js',
  'coastline.js',
  'dashboard.js',
  'globe.js',
  'globe-geo.js',
  'i18n.js',
  'nav.js',
  'payments.js',
  'profile.js',
  'recs.js',
  'script.js',
];
const STATIC_STYLES = ['catalog.css', 'dashboard.css', 'styles.css'];
const STATIC_ASSETS = [
  'latam-map.webp',
  'nodal-community.webp',
  'nodal-wordmark.webp',
];

await mkdir(OUTPUT, { recursive: true });
await Promise.all(STATIC_PAGES.map((file) => copyFile(
  path.join(WEB_ROOT, 'pages', file),
  path.join(OUTPUT, file),
)));
await Promise.all(STATIC_SCRIPTS.map((file) => copyFile(
  path.join(WEB_ROOT, 'scripts', file),
  path.join(OUTPUT, file),
)));
await Promise.all(STATIC_STYLES.map((file) => copyFile(
  path.join(WEB_ROOT, 'styles', file),
  path.join(OUTPUT, file),
)));
await rm(path.join(OUTPUT, 'assets'), { recursive: true, force: true });
await mkdir(path.join(OUTPUT, 'assets'), { recursive: true });
await Promise.all(STATIC_ASSETS.map((file) => copyFile(
  path.join(WEB_ROOT, 'assets', 'optimized', file),
  path.join(OUTPUT, 'assets', file),
)));
