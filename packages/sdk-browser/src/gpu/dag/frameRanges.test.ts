// A camera cut's `frames` past what one storage buffer binds (#979): the table splits into ranges,
// each its own buffer and bind group, and the cut is the one of the unsplit table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraFrameRanges, framesBytes } from './frameRanges.ts';
import { storageBufferCap } from '../../residency/pools.ts';
import { createGpuDagSelection, packDagSelection } from './selection.ts';
import { dagFixture, wideCamera } from '../../page/selection/dag.fixture.ts';
import { kernelUniforms, packed } from './selectionHelpers.fixture.ts';
import { mockDagDevice } from './selection.fixture.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';

test('the ranges cover every primitive once, each within one binding', () => {
  for (const limits of [
    { maxBufferSize: 256 << 20, maxStorageBufferBindingSize: 128 << 20 },
    { maxBufferSize: 64 << 20, maxStorageBufferBindingSize: 128 << 20 },
  ]) {
    const ranges = cameraFrameRanges(limits, 1_000_000);
    assert.ok(ranges.length > 1, 'a million primitives pass one binding');
    let next = 0;
    for (const { first, count } of ranges) {
      assert.equal(first, next, 'no gap, no overlap');
      assert.ok(framesBytes(count) <= storageBufferCap(limits));
      next += count;
    }
    assert.equal(next, 1_000_000);
  }
  const limits = { maxBufferSize: 256 << 20, maxStorageBufferBindingSize: 128 << 20 };
  assert.deepEqual(cameraFrameRanges(limits, 300_000), [{ first: 0, count: 300_000 }]);
});

/** Forty-eight placements of the fixture's primitive, spread in and out of the camera's view. */
function spread() {
  const fixture = dagFixture();
  const [root] = packed(fixture).roots;
  const roots = Array.from({ length: 48 }, (_, k) => {
    const elements = Array.from(root.world.elements);
    elements[12] += (k - 24) * 0.75;
    elements[14] -= (k % 3) * 4;
    return { ...root, world: { elements } };
  });
  return { fixture, roots };
}

async function cutOf(limits: { maxBufferSize: number; maxStorageBufferBindingSize: number }) {
  const { fixture, roots } = spread();
  const dag = packDagSelection(roots);
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0.5);
  const selection = await createGpuDagSelection(mockDagDevice(dag, { limits }).device, dag);
  assert.ok(selection, 'the device holds the cut');
  selection.dispatch(uniforms);
  const cut = await selection.flush();
  selection.dispose();
  fixture.geometry.dispose();
  assert.ok(cut);
  return { cut, worldCount: dag.worldCount };
}

test('a table past one binding splits in ranges, and cuts as the unsplit one', async () => {
  installGpuGlobals();
  const whole = await cutOf({ maxBufferSize: 1 << 20, maxStorageBufferBindingSize: 1 << 20 });
  // Enough for every other buffer of the scene, a third of the table.
  const small = { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: framesBytes(22) };
  assert.equal(cameraFrameRanges(small, whole.worldCount).length, 3);
  const split = await cutOf(small);
  const sorted = (ids: readonly number[]) => [...ids].sort((a, b) => a - b);
  assert.ok(whole.cut.pageIds.length > 0, 'the scene draws');
  assert.deepEqual(sorted(split.cut.pageIds), sorted(whole.cut.pageIds));
  assert.equal(split.cut.selectedTriangles, whole.cut.selectedTriangles);
});
