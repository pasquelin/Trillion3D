import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildBundles, copyStatics, SITE_URL } from './docs/site.ts';
import { LANGUAGES } from '../site/content/i18n/dictionary.ts';
const root = resolve(import.meta.dirname, '..');

test('the site build writes every bundle of the published tree', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'trillion3d-site-build-'));
  try {
    await buildBundles(root, temporary);
    for (const file of [
      'css/site.css',
      'runtime/portal.js',
      'runtime/engine.js',
      'runtime/kit.js',
      'runtime/pageDecodeWorker.js',
      'runtime/pageIntegrationWorker.js',
      'runtime/pageCodec.wasm',
    ])
      assert.ok((await stat(join(temporary, file))).size > 0, `${file} is built`);
    // The flags the languages name, and no other, with the licence of the package they come from.
    const flags = [...new Set(LANGUAGES.map(({ flag }) => `${flag}.svg`))];
    assert.deepEqual(
      (await readdir(join(temporary, 'flags'))).sort(),
      [...flags, 'LICENSE'].sort(),
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('the statics are copied as served, sources excluded, up-to-date copies left alone, removed ones removed, the root pages written from the site address', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'trillion3d-site-statics-'));
  const source = join(temporary, 'site');
  const out = join(temporary, 'out');
  try {
    await mkdir(join(source, 'reports/campaign'), { recursive: true });
    await mkdir(join(source, 'assets'), { recursive: true });
    await mkdir(join(source, 'data'), { recursive: true });
    await mkdir(join(source, 'examples'), { recursive: true });
    await writeFile(join(source, 'examples/cube.html'), '<!doctype html>');
    await writeFile(join(source, 'index.html'), '<!doctype html>\n<head>\n  </head>\n');
    await writeFile(join(source, 'reports/index.json'), '[]');
    await writeFile(join(source, 'reports/contract.ts'), 'export {};');
    await writeFile(join(source, 'reports/campaign/report.json'), '{}');
    await writeFile(join(source, 'assets/manifest.json'), '{}');
    // What an earlier build copied and the sources no longer have: a removed example, a page.
    await mkdir(join(out, 'examples'), { recursive: true });
    await writeFile(join(out, 'examples/removed.html'), '');
    await writeFile(join(out, 'report.html'), '');
    await copyStatics(source, out);
    await assert.rejects(stat(join(out, 'examples/removed.html')));
    await assert.rejects(stat(join(out, 'report.html')));
    assert.equal(
      await readFile(join(out, 'index.html'), 'utf8'),
      `<!doctype html>\n<head>\n    <link rel="canonical" href="${SITE_URL}" />\n  </head>\n`,
    );
    assert.equal(await readFile(join(out, 'robots.txt'), 'utf8'), 'User-agent: *\nAllow: /\n');
    assert.equal(await readFile(join(out, 'reports/campaign/report.json'), 'utf8'), '{}');
    assert.equal(await readFile(join(out, 'assets/manifest.json'), 'utf8'), '{}');
    assert.equal(await readFile(join(out, 'examples/cube.html'), 'utf8'), '<!doctype html>');
    await assert.rejects(stat(join(out, 'reports/contract.ts')));
    await assert.rejects(stat(join(out, 'styles')));
    const copied = (await stat(join(out, 'assets/manifest.json'))).mtimeMs;
    await copyStatics(source, out);
    assert.equal((await stat(join(out, 'assets/manifest.json'))).mtimeMs, copied);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
