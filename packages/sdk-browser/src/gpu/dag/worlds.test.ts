// Object-to-view stretch depends only on the linear part of the world matrices: a render frame
// that follows the eye only moves their translations, so it must recompute nothing and push
// nothing. Oracle: the previous full recompute, `maxStretch` on each matrix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maxStretch } from '../../../../sdk-core/src/index.ts';
import { FRAME_VEC4 } from './types.ts';
import {
  primitiveFrameWords,
  primitiveWordAt,
  refreshWorldStretch,
  worldsChanged,
} from './worlds.ts';

const WORLDS = 4;

/** Four world matrices with distinct scales and rotations, translations included. */
function scene() {
  const worlds = new Float32Array(WORLDS * 16);
  for (let w = 0; w < WORLDS; w++) {
    const base = w * 16,
      scale = 1 + w * 0.75;
    worlds[base] = scale;
    worlds[base + 5] = scale * 0.5;
    worlds[base + 10] = scale * 2;
    worlds[base + 15] = 1;
    worlds[base + 12] = w * 3;
    worlds[base + 13] = w * 5;
    worlds[base + 14] = w * 7;
  }
  return worlds;
}
/** Oracle: each primitive's stretch, recomputed without looking at what moved. */
const reference = (worlds: Float32Array) =>
  Float32Array.from({ length: WORLDS }, (_, w) => maxStretch(worlds.subarray(w * 16, w * 16 + 16)));

function packedOf() {
  return { worldCount: WORLDS, worldStretch: new Float32Array(WORLDS) };
}

test('a moved origin recomputes no stretch and pushes no frame', () => {
  const previous = scene(),
    packed = packedOf(),
    frameData = new Float32Array(WORLDS * FRAME_VEC4 * 4);
  assert.equal(refreshWorldStretch(new Float32Array(WORLDS * 16), previous, packed, frameData), 4);
  const stretch = packed.worldStretch.slice(),
    frames = frameData.slice();
  // The render frame follows the eye: only translations change, from one frame to the next.
  const next = previous.slice();
  for (let w = 0; w < WORLDS; w++) {
    next[w * 16 + 12] += 1000;
    next[w * 16 + 13] -= 2000;
    next[w * 16 + 14] += 3;
  }
  assert.equal(refreshWorldStretch(previous, next, packed, frameData), 0);
  assert.deepEqual([...packed.worldStretch], [...stretch]);
  assert.deepEqual([...frameData], [...frames]);
  // And what the full recompute would have written is already there.
  assert.deepEqual([...packed.worldStretch], [...reference(next)]);
});

test('a single resized primitive is the only one recomputed, to the float', () => {
  const previous = scene(),
    packed = packedOf(),
    frameData = new Float32Array(WORLDS * FRAME_VEC4 * 4);
  refreshWorldStretch(new Float32Array(WORLDS * 16), previous, packed, frameData);
  const next = previous.slice();
  next[2 * 16 + 5] = 9.5;
  next[0 * 16 + 12] = 42;
  assert.equal(refreshWorldStretch(previous, next, packed, frameData), 1);
  assert.deepEqual([...packed.worldStretch], [...reference(next)]);
  assert.equal(frameData[(2 * FRAME_VEC4 + 6) * 4], reference(next)[2]);
});

test('worldsChanged is false on identical buffers and true on one moved translation', () => {
  const previous = scene(),
    next = Float32Array.from(previous);
  assert.equal(worldsChanged(previous, next), false);
  next[2 * 16 + 14] += 1;
  assert.equal(worldsChanged(previous, next), true);
});

test('the frame words carry each primitive stretch, root and record shift, as the kernel reads them', () => {
  const packed = {
    worldCount: 3,
    worldStretch: Float32Array.of(1, 2.5, 4),
    rootNodes: Uint32Array.of(0, 0xffffffff, 17),
    // A shift below zero wraps: page 12 of the second primitive reads record 2.
    recordShift: Uint32Array.of(0, (2 - 12) >>> 0, 5),
  };
  const frames = primitiveFrameWords(packed),
    ints = new Uint32Array(frames.buffer);
  assert.equal(frames.length, 3 * FRAME_VEC4 * 4);
  for (let w = 0; w < 3; w++) {
    const at = primitiveWordAt(w);
    assert.equal(frames[at], packed.worldStretch[w]);
    assert.equal(ints[at + 1], packed.rootNodes[w]);
    assert.equal(ints[at + 2], packed.recordShift[w]);
  }
  assert.equal((12 + ints[primitiveWordAt(1) + 2]) >>> 0, 2);
});
