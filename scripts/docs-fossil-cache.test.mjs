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
const asset = join(root, 'docs/assets/gallery/fossil-excavation');
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
  'the complete canonical fossil cache reproduces exactly through the public compiler',
  { skip: !existsSync(compiler) },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'wg-fossil-proof-'));
    try {
      execFileSync(
        compiler,
        [
          join(asset, 'source/excavation.obj'),
          temporary,
          'full',
          '150000',
          '2',
          '256',
          '../../../../source/',
          'none',
        ],
        { stdio: 'ignore' },
      );
      await canonicalizeFossilCache(temporary);
      const published = join(asset, 'cache');
      const expected = await files(published);
      assert.deepEqual(await files(temporary), expected);
      for (const path of expected) {
        const before = await readFile(join(published, path));
        const rebuilt = await readFile(join(temporary, path));
        assert.ok(before.equals(rebuilt), `canonical artifact differs: ${path}`);
      }
      const pointer = JSON.parse(
        await readFile(join(temporary, 'native/full/manifest.json'), 'utf8'),
      );
      const manifestPath = join(temporary, 'native/full', pointer.url);
      const first = await readFile(manifestPath);
      const manifest = JSON.parse(first);
      assert.equal(manifest.metrics.compileMs, null);
      assert.equal(manifest.metrics.importMs, null);
      assert.equal(manifest.sourceTriangles, 9784);
      assert.ok(!manifest.cutouts.sheet.startsWith('/'));
      await canonicalizeFossilCache(temporary);
      assert.ok(first.equals(await readFile(manifestPath)), 'normalization is idempotent');
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
