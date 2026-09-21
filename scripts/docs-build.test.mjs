import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BUNDLES, buildDocs, trackedBundles } from './docs/bundles.mjs';

// No bundle is ever committed: the build runs on demand, here once into a temporary tree.
const root = resolve(import.meta.dirname, '..');

test('build:docs writes every generated bundle from the maintained sources', async () => {
  const fresh = await mkdtemp(join(tmpdir(), 'wg-docs-build-'));
  try {
    await buildDocs(root, fresh);
    for (const bundle of BUNDLES)
      assert.ok((await stat(join(fresh, bundle))).size > 0, `${bundle} is empty`);
  } finally {
    await rm(fresh, { recursive: true, force: true });
  }
});

test('the untracked check names a bundle git tracks and nothing in this repository', async () => {
  assert.deepEqual(trackedBundles(root), []);
  const scratch = await mkdtemp(join(tmpdir(), 'wg-docs-tracked-'));
  const git = (...args) => execFileSync('git', args, { cwd: scratch, stdio: 'pipe' });
  try {
    git('init', '-q');
    const file = join(scratch, 'docs', BUNDLES[0]);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, '');
    assert.deepEqual(trackedBundles(scratch), []);
    git('add', file);
    assert.deepEqual(trackedBundles(scratch), [`docs/${BUNDLES[0]}`]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
