import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { setWebgpuTransform } from './transform.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

// A node set where it already stands — its first write included, while its pose is still its
// position, rotation and scale — moves nothing: no placement turns moving, no page is staled.
test('a node moved to the world it already stands at moves nothing, on its first write too', () => {
  const scene = new G.GraphGroup(),
    crate = new G.GraphGroup();
  crate.name = 'Crate';
  crate.position.set(1.5, 2, -3);
  scene.add(crate);
  scene.updateMatrixWorld(true);
  const moved: number[] = [];
  const rt = {
    setup: { source: scene },
    lights: { mobility: { move: (rank: number) => moved.push(rank) } },
  } as unknown as WebgpuPagesRuntime;
  setWebgpuTransform(rt, 'Crate', Float32Array.from(crate.matrixWorld.elements));
  assert.deepEqual(moved, []);
  assert.equal(crate.matrixAutoUpdate, true, 'the node is left as the host posed it');
});
