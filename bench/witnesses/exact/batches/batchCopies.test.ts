import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { ClusterBatches, type ClusterDrawOwner } from './batches.ts';
import type { SceneCopy } from '../../../../packages/sdk-browser/src/webgl/cluster/copyCulling.ts';
import { createHostDrawCamera } from '../../../../packages/sdk-browser/src/camera/world.ts';
import { quad } from '../../../../tests/browser/support/webglClusterPixels.ts';

test('a copy of no graph is culled and drawn at its pose, the engine storage left as it is', () => {
  // The copy's matrix IS the engine's world storage (`createBlendCopy`): a move rewrites it.
  const storage = new G.Matrix4().makeTranslation(0.21, 0, 0).elements;
  const copy = G.mesh(quad(-0.5, 0.06), G.basicSurface({ transparent: true, opacity: 0.5 }));
  copy.matrixAutoUpdate = false;
  copy.matrix.elements = storage;
  const seen: number[][] = [];
  const owner = {
    backdropPasses: 0,
    copySubmissions: 0,
    backdropSubmissions: 0,
    backdropBytes: 0,
    draw(...args: unknown[]) {
      for (const drawn of args[6] as readonly SceneCopy[])
        seen.push(Array.from(drawn.matrixWorld.elements));
      return 0;
    },
  } as unknown as ClusterDrawOwner;
  const batches = new ClusterBatches(new G.GraphScene(), [], owner, [copy]);
  const camera = createHostDrawCamera();
  batches.draw(camera, false, true);
  assert.equal(seen[0][12], 0.21, 'the owner reads the pose, not an identity world');
  storage[12] = -0.4;
  batches.draw(camera, false, true);
  assert.equal(seen[1][12], -0.4, 'a move is read at the next frame');
  assert.equal(copy.matrix.elements, storage, 'the engine storage is still the pose');
  assert.equal(storage[12], -0.4, 'and the draw wrote nothing into it');
});
