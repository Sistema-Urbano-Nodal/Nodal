import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildStatic } from '../scripts/build-static.js';

async function workspace(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'nodal-build-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('rebuild removes stale scripts and server pages, preserves .gitkeep, and copies current assets', async t => {
  const output = await workspace(t);
  await mkdir(path.join(output, 'old-assets'));
  for (const file of ['.gitkeep', 'obsolete.js', 'dashboard.html', 'profile.html', 'admin.html', 'old-assets/unused.png']) {
    await writeFile(path.join(output, file), 'old output');
  }
  await buildStatic({ output, pilotMode: true });
  for (const file of ['obsolete.js', 'dashboard.html', 'profile.html', 'admin.html', 'old-assets']) {
    await assert.rejects(access(path.join(output, file)), { code: 'ENOENT' });
  }
  assert.equal(await readFile(path.join(output, '.gitkeep'), 'utf8'), 'old output');
  for (const file of ['i18n.js', 'styles.css', 'assets/nodal-wordmark.webp', 'assets/fonts/montserrat-v31-latin-normal.woff2']) {
    await access(path.join(output, file));
  }
  assert.deepEqual((await readdir(output)).filter(file => file.endsWith('.html')), ['opportunities.html']);
  assert.match(await readFile(path.join(output, 'opportunities.html'), 'utf8'), /data-pilot="true"/);
  const first = (await readdir(output)).sort();
  await buildStatic({ output, pilotMode: false });
  assert.deepEqual((await readdir(output)).sort(), first);
  assert.match(await readFile(path.join(output, 'opportunities.html'), 'utf8'), /data-pilot="false"/);
});

test('missing sources fail before removing the previous build', async t => {
  const root = await workspace(t), output = path.join(root, 'public');
  await mkdir(output);
  await writeFile(path.join(output, 'previous.js'), 'previous working build');
  await assert.rejects(buildStatic({ output, webRoot: path.join(root, 'missing') }), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(output, 'previous.js'), 'utf8'), 'previous working build');
});
