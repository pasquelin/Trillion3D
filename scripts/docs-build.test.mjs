import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildPortal } from './docs/build-portal.mjs';
import { buildRuntime } from './docs/build-runtime.mjs';
import { buildStyles } from './docs/build-styles.mjs';
const root = resolve(import.meta.dirname, '..');

test('published docs styles, runtime and workers match the maintained sources', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'wg-docs-build-'));
  try {
    await buildRuntime(root, temporary);
    await buildPortal(root, temporary);
    await buildStyles(root, { output: join(temporary, 'site.css') });
    for (const [source, target] of [
      ['site.css', 'css/site.css'],
      ...[
        'engine.js',
        'highlighter.js',
        'portal.js',
        'pageDecodeWorker.js',
        'pageIntegrationWorker.js',
        'pageCodec.wasm',
      ].map((file) => [file, `runtime/${file}`]),
    ]) {
      assert.deepEqual(
        await readFile(join(temporary, source)),
        await readFile(join(root, 'docs', target)),
        `${target} is stale: run pnpm build:docs`,
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
