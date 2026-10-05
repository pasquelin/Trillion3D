import test from 'node:test';
import assert from 'node:assert/strict';
import { updateWholeDeformationBounds } from './wholeBounds.ts';
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import type { SessionDeformation } from './session.ts';

/** One whole deformed copy of a unit box, its record steady or not, and the regions it dirties. */
function wholeCopy() {
  const matrix = new Matrix4();
  const item = {
    matrix,
    deformBounds: new Float64Array(6),
    sourceGeometry: { boundingBox: { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } } },
    bounds: null as Float64Array | null,
  };
  const regions: number[][] = [];
  const rt = {
    blendState: { blendGpu: [item], hierarchy: { count: -1 } },
    lights: {
      changes: {
        worldChanged: (min: ArrayLike<number>, max: ArrayLike<number>) =>
          regions.push([...Array.from(min), ...Array.from(max)]),
      },
    },
    run: { temporalHizState: {} },
  } as unknown as WebgpuPagesRuntime;
  const state = { changed: true };
  const deformation = {
    changedOfWorld: () => state.changed,
    reachOfWorld: () => 0,
  } as unknown as SessionDeformation;
  return { item, matrix, regions, rt, state, deformation };
}

test('a whole copy carried by its moving node follows the node, its old and new boxes dirtied', () => {
  const { item, matrix, regions, rt, state, deformation } = wholeCopy();
  updateWholeDeformationBounds(rt, deformation, false);
  assert.deepEqual(Array.from(item.deformBounds), [-1, -1, -1, 1, 1, 1]);
  state.changed = false;
  matrix.elements[12] = 10;
  updateWholeDeformationBounds(rt, deformation, true);
  assert.deepEqual(Array.from(item.deformBounds), [9, -1, -1, 11, 1, 1], 'the box follows');
  assert.equal(item.bounds, item.deformBounds);
  assert.deepEqual(regions.at(-1), [-1, -1, -1, 11, 1, 1], 'old and new place both dirtied');
});

test('a steady copy dirties nothing when another node moves; a changed record always does', () => {
  const { regions, rt, state, deformation } = wholeCopy();
  updateWholeDeformationBounds(rt, deformation, false);
  const first = regions.length;
  state.changed = false;
  updateWholeDeformationBounds(rt, deformation, true);
  assert.equal(regions.length, first, 'same box, same record: no shadow page redrawn');
  state.changed = true;
  updateWholeDeformationBounds(rt, deformation, false);
  assert.equal(regions.length, first + 1, 'a surface moving inside its box still dirties it');
});
