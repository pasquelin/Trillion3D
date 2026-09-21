import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { canonicalizeFossilCache } from './docs/fossil-excavation/canonical.mjs';

const root = resolve(import.meta.dirname, '..');
const compiler = join(root, 'packages/asset-compiler-rust/target/release/web-geometry-compiler');
const asset = join(root, 'site/assets/gallery/fossil-excavation');
function compile(output) {
  execFileSync(
    compiler,
    [
      join(asset, 'source/excavation.obj'),
      output,
      'full',
      '150000',
      '2',
      '256',
      '../../../../source/',
      'none',
    ],
    { stdio: 'ignore' },
  );
}
async function files(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...(await files(directory, path)));
    else if (entry.name !== '.lock') result.push(path);
  }
  return result.sort();
}

test(
  'two fresh canonical fossil caches are byte-identical in one compiler environment',
  { skip: !existsSync(compiler) },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'wg-fossil-proof-'));
    try {
      const firstCache = join(temporary, 'first');
      const secondCache = join(temporary, 'second');
      compile(firstCache);
      compile(secondCache);
      await canonicalizeFossilCache(firstCache);
      await canonicalizeFossilCache(secondCache);
      const expected = await files(firstCache);
      assert.deepEqual(await files(secondCache), expected);
      for (const path of expected) {
        const first = await readFile(join(firstCache, path));
        const second = await readFile(join(secondCache, path));
        assert.ok(first.equals(second), `fresh canonical artifacts differ: ${path}`);
      }
      const pointer = JSON.parse(
        await readFile(join(firstCache, 'native/full/manifest.json'), 'utf8'),
      );
      const manifestPath = join(firstCache, 'native/full', pointer.url);
      const first = await readFile(manifestPath);
      const manifest = JSON.parse(first);
      assert.equal(manifest.metrics.compileMs, null);
      assert.equal(manifest.metrics.importMs, null);
      assert.equal(manifest.sourceTriangles, 9784);
      assert.ok(!manifest.cutouts.sheet.startsWith('/'));
      await canonicalizeFossilCache(firstCache);
      assert.ok(first.equals(await readFile(manifestPath)), 'normalization is idempotent');
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
