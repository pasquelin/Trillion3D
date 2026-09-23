// The slice buffer carries, per face, which physical pages are drawn and where the extent
// origin sits: a strip that entered a slid extent is stale until its draw, and the read must
// fall through it to the next cascade. Only a face whose mask changed is rewritten.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHADOW_FACE_FLOATS,
  SHADOW_FACE_MASK_WORD,
  SHADOW_SLICE_FLOATS,
  type SceneLight,
  type ShadowViewpoint,
} from '../../../../sdk-core/src/index.ts';
import { createShadowSlicePack } from '../../gpu/shadow/slicePack.ts';
import { createWebgpuLightState } from '../pages/state/lights.ts';
import { writeDrawnMasks } from './drawnMask.ts';

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
    return Array.from(words.subarray(at, at + 4));
  };
  /** Slices flagged to push, drained: what the atlas would write to the GPU. */
  const pushed = () => {
    const slices: number[] = [];
    pack.flushSlices((slice) => slices.push(slice));
    return slices;
  };
  return { lights, wordsOf, pushed };
}

test('a face whose pages are all drawn carries a full mask, and an untouched frame pushes nothing', () => {
  const { lights, wordsOf, pushed } = scene();
  // Frame 0 queues every page; the plan with a large region cap draws them all.
  lights.plan.plan(lights.store, VIEW, 0, 0);
  const slice = lights.store.sliceOf(0);
  writeDrawnMasks(lights);
  assert.deepEqual(pushed(), [slice], 'the first mask is a change: pushed');
  const [low, high] = wordsOf(slice, 0);
  assert.deepEqual([low, high], [0xffffffff, 0xffffffff]);
  writeDrawnMasks(lights);
  assert.deepEqual(pushed(), [], 'nothing changed: nothing to push');
});

test('a slid strip is unheld in the mask, the origin follows and the slice is pushed; a staled page stays held', () => {
  const { lights, wordsOf, pushed } = scene();
  lights.plan.plan(lights.store, VIEW, 0, 0);
  writeDrawnMasks(lights);
  pushed();
  const slice = lights.store.sliceOf(0);
  // Stale the top row of the near cascade without drawing it: the regions are already taken.
  lights.plan.slices.dirty.setExtent(slice, 0, 2, 7);
  lights.plan.slices.dirty.slide(slice, 0, 8, 0, -1, 16, 1);
  writeDrawnMasks(lights);
  assert.deepEqual(pushed(), [slice]);
  assert.deepEqual(
    wordsOf(slice, 0),
    [0xffffffff, 0x00ffffff, 2, 7],
    'row 7 unheld, origin (2, 7)',
  );
  // A world change stales row 3 without unholding it: the read keeps its last depth.
  lights.plan.slices.dirty.drew(slice, 0, 0, 7, 7, 7);
  writeDrawnMasks(lights);
  pushed();
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  lights.plan.slices.dirty.box(slice, 0, 8, identity, 0, [-1, -1, 0], [1, 1, 0.5], 32, 2);
  assert.ok(lights.plan.slices.dirty.pages(slice, 0) > 0);
  writeDrawnMasks(lights);
  assert.deepEqual(pushed(), [], 'nothing to push: every page still held');
  assert.deepEqual(wordsOf(slice, 0), [0xffffffff, 0xffffffff, 2, 7]);
});
