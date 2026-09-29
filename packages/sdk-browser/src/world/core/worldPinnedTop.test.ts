// #1237: a compiled model's world roots are read as it loads. What the runtime pins is the world
// top the cook published (`worldRoots.pinnedTopBytes`), never an object's roots; the court is not
// partitioned, so its one cell holds the bundles past the top its roots depend on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellDependencies } from '../../../../sdk-core/src/manifest/worldRoots.ts';
import { loadModel } from './loadedModel.ts';
import { HOST } from './worldRuntime.fixture.ts';

const MODEL = `${HOST}assets/gallery/signature-architecture/cache/native/full/manifest.json`;

test('a loaded model pins the world top its cook published, and its cell holds the rest', async () => {
  const model = await loadModel(MODEL, { textureSource: 'cache' });
  const cooked = (model.record.metadata as unknown as Record<string, Record<string, number>>)
    .worldRoots;
  const [roots] = model.record.scene.worldRoots;
  assert.ok(roots, 'the world roots are read');
  assert.deepEqual(
    [roots.pinned.bundles, roots.pinned.bytes],
    [cooked.pinnedBundles, cooked.pinnedTopBytes],
    'the pinned set is the world top alone',
  );
  const held = cellDependencies(roots.table, 0);
  assert.deepEqual(roots.held(), held, 'the one cell holds its bundles past the top');
  const heldBytes = held.reduce((sum, bundle) => sum + roots.table.bundles[bundle].bytes, 0);
  assert.equal(roots.bytes(), cooked.pinnedTopBytes + heldBytes, 'every byte is counted');
});
