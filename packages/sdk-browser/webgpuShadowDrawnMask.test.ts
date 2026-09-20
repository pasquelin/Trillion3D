// The slice buffer carries, per face, which physical pages are drawn: a strip that entered a
// slid window is stale until its draw, and the read must fall through it to the next cascade.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHADOW_FACE_FLOATS,
  SHADOW_FACE_MASK_WORD,
  SHADOW_SLICE_FLOATS,
  type SceneLight,
  type ShadowViewpoint,
} from '../sdk-core/index.ts';
import { createShadowSlicePack } from './gpuShadowSlicePack.ts';
import { createWebgpuLightState } from './webgpuPagesStateLights.ts';
import { writeDrawnMasks } from './webgpuShadowDrawnMask.ts';

const VIEW: ShadowViewpoint = {
  position: [0, 5, 0],
  forward: [0, 0, -1],
  halfFovY: 0.6,
  aspect: 16 / 9,
  near: 0.1,
  far: 200,
};
const SUN: SceneLight = {
  id: 'sun',
  kind: 'directional',
  direction: [0, -1, 0],
  color: [1, 1, 1],
  intensity: 1,
  castsShadow: true,
};

function scene() {
  const lights = createWebgpuLightState();
  const pack = createShadowSlicePack(4096, 256);
  lights.shadows = pack as unknown as NonNullable<typeof lights.shadows>;
  lights.store.add(SUN);
  const words = new Uint32Array(pack.slicePacked.buffer);
  const wordsOf = (slice: number, face: number) => {
    const at = slice * SHADOW_SLICE_FLOATS + face * SHADOW_FACE_FLOATS + SHADOW_FACE_MASK_WORD;
    return [words[at], words[at + 1]];
  };
  return { lights, wordsOf };
}

test('a face whose pages are all drawn carries a full mask, and an untouched frame pushes nothing', () => {
  const { lights, wordsOf } = scene();
  const flushed = new Int32Array(8);
  // Frame 0 queues every page; the plan with a large region cap draws them all.
  lights.plan.plan(lights.store, VIEW, 0, 0);
  const slice = lights.store.sliceOf(0);
  assert.equal(writeDrawnMasks(lights, flushed, 0), 1, 'the first mask is a change: pushed');
  assert.deepEqual(wordsOf(slice, 0), [0xffffffff, 0xffffffff]);
  assert.equal(writeDrawnMasks(lights, flushed, 0), 0, 'nothing changed: nothing to push');
});

test('a strip refused by a full region cap stays undrawn in the mask, and the slice is pushed', () => {
  const { lights, wordsOf } = scene();
  const flushed = new Int32Array(8);
  lights.plan.plan(lights.store, VIEW, 0, 0);
  writeDrawnMasks(lights, flushed, 0);
  const slice = lights.store.sliceOf(0);
  // Stale the top row of the near cascade without drawing it: the regions are already taken.
  lights.plan.slices.dirty.setWindow(slice, 0, 0, 0);
  lights.plan.slices.dirty.slide(slice, 0, 8, 0, -1, 16, 1);
  assert.equal(writeDrawnMasks(lights, flushed, 0), 1);
  assert.equal(flushed[0], slice);
  assert.deepEqual(wordsOf(slice, 0), [0xffffff00, 0xffffffff], 'row 0 undrawn, the rest drawn');
});
