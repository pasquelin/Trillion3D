import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLinks } from './check-links.mjs';

test('reports a broken link in an ordinary file but ignores the same broken link under test-assets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wg-check-links-'));
  try {
    await mkdir(join(directory, 'docs'), { recursive: true });
    await mkdir(join(directory, 'test-assets', 'gltf', 'Foo'), { recursive: true });
    await writeFile(join(directory, 'docs', 'broken.md'), '[dead link](./does-not-exist.md)\n');
    await writeFile(
      join(directory, 'test-assets', 'gltf', 'Foo', 'upstream-LICENSE.md'),
      '[dead link](./does-not-exist.md)\n',
    );

    const result = checkLinks(directory);

    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0][0], /docs[\\/]broken\.md$/);
    assert.equal(
      result.errors.some((e) => e[0].includes('test-assets')),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
