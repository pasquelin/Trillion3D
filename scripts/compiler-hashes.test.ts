import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cacheFingerprint, differences } from './compiler-hashes.ts';

/** A cache as the compiler lays it out, under `key`, with one page of `page` bytes and a manifest
 *  that reports the run's time and names the folder it was written to. */
function cache(key: string, page: string, compileMs: number): string {
  const root = mkdtempSync(join(tmpdir(), 'trillion3d-hashes-'));
  const manifest = {
    key,
    url: `${key}/c`,
    sheet: join(root, 'cutouts.json'),
    metrics: { compileMs },
  };
  mkdirSync(join(root, 'native/full', key), { recursive: true });
  writeFileSync(join(root, 'native/.lock'), String(process.pid));
  writeFileSync(join(root, 'native/full/manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'native/full', key, 'page.bin'), page);
  return root;
}

// Behaviour: two compilers that cook the same bytes have one fingerprint, whatever their key, their
// run's times and their folder; one changed byte is named — the platforms against Linux x64, the
// branch against develop (#1352).
test('the fingerprint compares the cooked bytes and names the file that differs', () => {
  const develop = cache('a'.repeat(64), 'page', 1),
    branch = cache('b'.repeat(64), 'page', 2),
    changed = cache('c'.repeat(64), 'pagf', 1);
  try {
    const record = (compiler: string, root: string) => ({
      compiler,
      files: cacheFingerprint(root, 'scene'),
    });
    const reference = record('develop', develop);
    assert.deepEqual(Object.keys(reference.files), [
      'scene/native/full/<sha>/page.bin',
      'scene/native/full/manifest.json',
    ]);
    assert.deepEqual(differences(reference, record('branch', branch)), []);
    assert.deepEqual(differences(reference, record('changed', changed)), [
      'scene/native/full/<sha>/page.bin',
    ]);
  } finally {
    for (const root of [develop, branch, changed]) rmSync(root, { recursive: true, force: true });
  }
});
