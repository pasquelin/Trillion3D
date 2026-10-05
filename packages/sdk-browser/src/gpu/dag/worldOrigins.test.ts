import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fakeDevice,
  replayWrites,
  type FakeBuffer,
  type FakeWrite,
} from '../../../../../tests/kit/gpu/fakeDevice.ts';
import { createCameraFrames, framesBytes } from './frameRanges.ts';
import { FRAME_VEC4 } from './types.ts';
import { rootWorldsToRenderOrigin } from './pack.ts';

const world = (x: number) => Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]);
const roots = () =>
  [1e9 + 0.013, -1e9 + 0.002, 1e6 + 0.007].map((x) => ({
    world: { elements: world(x) },
    pages: [],
  }));
const data = (buffer: GPUBuffer, writes: FakeWrite[]) => {
  const bytes = (buffer as unknown as FakeBuffer).getMappedRange();
  replayWrites(
    bytes,
    writes.filter((write) => write.buffer === buffer),
  );
  return new Float32Array(bytes);
};

test('split world bindings retain camera matrix bytes and keep absolute origins across camera rebases', () => {
  const sources = roots(),
    next = new Float32Array(sources.length * 16);
  rootWorldsToRenderOrigin(next, sources, [0, 0, 0], new Float64Array(sources.length * 3));
  const fake = fakeDevice({
    limits: {
      maxBufferSize: framesBytes(2),
      maxStorageBufferBindingSize: framesBytes(2),
      minUniformBufferOffsetAlignment: 256,
    },
  });
  const frames = createCameraFrames(
    fake.device,
    new Float32Array(sources.length * FRAME_VEC4 * 4),
    sources.length,
    (descriptor) => fake.device.createBuffer(descriptor),
    next,
    sources,
  );
  const tails = frames.worldBuffers.map((buffer, r) => {
    const { first, count } = frames.ranges[r],
      words = data(buffer, fake.writes);
    assert.equal(buffer.size, count * 96);
    assert.ok(buffer.size <= fake.device.limits.maxStorageBufferBindingSize);
    assert.deepEqual(
      words.subarray(0, count * 16),
      next.subarray(first * 16, (first + count) * 16),
    );
    return words.slice(count * 16);
  });
  for (const origin of [1e9 + 0.01, 1e6 + 0.002, -1e9 - 0.013]) {
    rootWorldsToRenderOrigin(next, sources, [origin, 0, 0], new Float64Array(sources.length * 3));
    const before = fake.writes.length;
    frames.writeWorlds(next);
    assert.equal(fake.writes.length - before, frames.ranges.length);
    frames.worldBuffers.forEach((buffer, r) =>
      assert.deepEqual(data(buffer, fake.writes).subarray(frames.ranges[r].count * 16), tails[r]),
    );
    assert.equal(
      frames.writeWorldOrigins(),
      false,
      'unchanged physical poses upload no origin tail',
    );
  }
});

test('a millimetre physical move updates only its origin words even if absolute float matrices agree', () => {
  const sources = roots(),
    next = new Float32Array(sources.length * 16);
  rootWorldsToRenderOrigin(next, sources, [0, 0, 0], new Float64Array(sources.length * 3));
  const fake = fakeDevice();
  const frames = createCameraFrames(
    fake.device,
    new Float32Array(sources.length * FRAME_VEC4 * 4),
    sources.length,
    (descriptor) => fake.device.createBuffer(descriptor),
    next,
    sources,
  );
  const before = fake.writes.length,
    original = next[12];
  sources[0].world.elements[12] += 0.001;
  rootWorldsToRenderOrigin(next, sources, [0, 0, 0], new Float64Array(sources.length * 3));
  assert.equal(next[12], original, 'single absolute float cannot carry this move');
  assert.equal(frames.writeWorldOrigins(), true);
  assert.equal(fake.writes.length - before, 1);
  const last = fake.writes.at(-1)!;
  assert.equal(last.offset, sources.length * 64);
  assert.equal(last.size, 32);
  const words = data(frames.worldBuffers[0], fake.writes),
    at = sources.length * 16;
  assert.ok(Math.abs(words[at] + words[at + 4] - sources[0].world.elements[12]) < 2e-6);
});
