import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fakeDevice,
  replayWrites,
  type FakeBuffer,
  type FakeWrite,
} from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createCameraFrames, framesBytes } from './frameRanges.ts'
import { FRAME_VEC4 } from './types.ts'
import { rootWorlds } from './pack.ts'
import { rootWorldsToRenderOrigin } from './pack.fixture.ts'

const world = (x: number) => Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1])
const roots = () =>
  [1e9 + 0.013, -1e9 + 0.002, 1e6 + 0.007].map((x) => ({
    world: { elements: world(x) },
    pages: [],
  }))
const data = (buffer: GPUBuffer, writes: FakeWrite[]) => {
  const bytes = (buffer as unknown as FakeBuffer).getMappedRange()
  replayWrites(
    bytes,
    writes.filter((write) => write.buffer === buffer),
  )
  return new Float32Array(bytes)
}

test('split world bindings retain camera matrix bytes and keep absolute origins across camera moves', () => {
  const sources = roots(),
    next = new Float32Array(sources.length * 16)
  rootWorlds(next, sources)
  const fake = fakeDevice({
    limits: {
      maxBufferSize: framesBytes(2),
      maxStorageBufferBindingSize: framesBytes(2),
      minUniformBufferOffsetAlignment: 256,
    },
  })
  const frames = createCameraFrames(
    fake.device,
    new Float32Array(sources.length * FRAME_VEC4 * 4),
    sources.length,
    (descriptor) => fake.device.createBuffer(descriptor),
    next,
    sources,
  )
  const tails = frames.worldBuffers.map((buffer, r) => {
    const { first, count } = frames.ranges[r],
      words = data(buffer, fake.writes)
    assert.equal(buffer.size, count * 96)
    assert.ok(buffer.size <= fake.device.limits.maxStorageBufferBindingSize)
    assert.deepEqual(words.subarray(0, count * 16), next.subarray(first * 16, (first + count) * 16))
    return words.slice(count * 16)
  })
  for (const origin of [1e9 + 0.01, 1e6 + 0.002, -1e9 - 0.013]) {
    rootWorldsToRenderOrigin(next, sources, [origin, 0, 0])
    const before = fake.writes.length
    frames.writeWorlds(next)
    assert.equal(fake.writes.length - before, frames.ranges.length)
    frames.worldBuffers.forEach((buffer, r) =>
      assert.deepEqual(data(buffer, fake.writes).subarray(frames.ranges[r].count * 16), tails[r]),
    )
    assert.equal(
      frames.writeWorldOrigins().length,
      0,
      'unchanged physical poses upload no origin tail',
    )
  }
})

test('a millimetre physical move updates only its origin words, its exact double', () => {
  const sources = roots(),
    next = new Float32Array(sources.length * 16)
  rootWorlds(next, sources)
  const fake = fakeDevice()
  const frames = createCameraFrames(
    fake.device,
    new Float32Array(sources.length * FRAME_VEC4 * 4),
    sources.length,
    (descriptor) => fake.device.createBuffer(descriptor),
    next,
    sources,
  )
  const before = fake.writes.length,
    original = next[12]
  sources[0].world.elements[12] += 0.001
  rootWorlds(next, sources)
  assert.equal(next[12], original, 'single absolute float cannot carry this move')
  assert.deepEqual([...frames.writeWorldOrigins()], [0])
  assert.equal(fake.writes.length - before, 1)
  const last = fake.writes.at(-1)!
  assert.equal(last.offset, sources.length * 64)
  assert.equal(last.size, 32)
  // The double, high word then low word, as the GPU holds it (`math/src/wgsl/double.ts`).
  const tail = new Uint32Array(data(frames.worldBuffers[0], fake.writes).buffer),
    at = sources.length * 16,
    held = new Float64Array(new Uint32Array([tail[at + 1], tail[at]]).buffer)[0]
  assert.equal(held, sources[0].world.elements[12])
})
