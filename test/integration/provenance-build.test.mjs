import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprintBuild } from '../../scripts/write-build-provenance.mjs';

test('build identity tracks executed modules and ignores its own generated provenance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wg-build-'));
  try {
    await writeFile(join(directory, 'engine.js'), 'export const value=1;');
    const first = await fingerprintBuild(directory);
    await writeFile(join(directory, 'buildProvenance.js'), 'generated timestamp');
    assert.deepEqual(await fingerprintBuild(directory), first);
    await writeFile(join(directory, 'engine.js'), 'export const value=2;');
    const changed = await fingerprintBuild(directory);
    assert.notEqual(changed.hash, first.hash);
    assert.notEqual(changed.modules['engine.js'], first.modules['engine.js']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
