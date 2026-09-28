import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFallbackUniform } from './uniforms.ts';

test('fallback packing writes every shader word at its offset and preserves integer bits', () => {
  const packed = new Float32Array(128).fill(7),
    ints = new Uint32Array(packed.buffer);
  const projection = Array.from({ length: 16 }, (_, i) => i + 1);
  const world = projection.map((n) => -n);
  writeFallbackUniform(packed, ints, 64, {
    projection,
    world,
    color: [0.25, 0.5, 0.75],
    opacity: 1,
    pageOffset: 0x80000001,
    indexCount: 0x80000002,
    mode: 3,
    identity: 0xfedcba98,
    lineWidth: 2,
    pixelRatio: 1.5,
    width: 1280,
    height: 720,
    dash: 4,
    gap: 5,
    spriteRotation: 0.5,
    spriteMode: -1,
  });
  assert.deepEqual(Array.from(packed.subarray(64, 100)), [
    ...projection,
    ...world,
    0.25,
    0.5,
    0.75,
    1,
  ]);
  assert.deepEqual(Array.from(ints.subarray(100, 104)), [0x80000001, 0x80000002, 3, 0xfedcba98]);
  assert.deepEqual(Array.from(packed.subarray(104, 112)), [2, 1.5, 1280, 720, 4, 5, 0.5, -1]);
  assert.ok(packed.subarray(0, 64).every((word) => word === 7));
  assert.ok(packed.subarray(112).every((word) => word === 7));
});
