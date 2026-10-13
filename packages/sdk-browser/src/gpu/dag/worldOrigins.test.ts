import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import type { FakeTexture } from '../../../../../tests/kit/gpu/fakeRecords.ts'
import { createCameraFrames } from './frameRanges.ts'
import { PRIMITIVE_BYTES } from './cameraRanges.ts'
import { FRAME_VEC4 } from './types.ts'
import { rootWorlds } from './pack.ts'
import { rootWorldsToRenderOrigin } from './pack.fixture.ts'
import { WORLD_TABLE } from './worldTable.ts'
import { recordWordAt } from '../core/recordTexture.fixture.ts'

const world = (x: number) => Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1])
const roots = () =>
  [1e9 + 0.013, -1e9 + 0.002, 1e6 + 0.007].map((x) => ({
    world: { elements: world(x) },
    pages: [],
  }))
/** Field `field` of record `w` of the worlds' table, as the queue wrote it. */
const field = (frames: { worlds: { texture: GPUTexture } }, name: string, w: number) => {
  const texture = frames.worlds.texture as unknown as FakeTexture,
    at = recordWordAt(WORLD_TABLE, texture, name, w)
  return texture.words!.slice(at, at + WORLD_TABLE.fields[name] * 4)
}

test('the worlds stay one table past one binding of the frames, and keep absolute origins across camera moves', () => {
  const sources = roots(),
    next = new Float32Array(sources.length * 16)
  rootWorlds(next, sources)
  const fake = fakeDevice({
    limits: {
      maxBufferSize: 2 * PRIMITIVE_BYTES,
      maxStorageBufferBindingSize: 2 * PRIMITIVE_BYTES,
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
  assert.equal(frames.ranges.length, 2, 'the frames split')
  const origins = sources.map((_, w) => {
    assert.deepEqual(
      new Float32Array(field(frames, 'Matrix', w).buffer),
      next.subarray(w * 16, w * 16 + 16),
    )
    return field(frames, 'Origin', w)
  })
  for (const origin of [1e9 + 0.01, 1e6 + 0.002, -1e9 - 0.013]) {
    rootWorldsToRenderOrigin(next, sources, [origin, 0, 0])
    const before = fake.textureWrites.length
    frames.writeWorlds(next)
    assert.equal(fake.textureWrites.length - before, 1, 'one write, whatever the ranges')
    sources.forEach((_, w) => assert.deepEqual(field(frames, 'Origin', w), origins[w]))
    assert.equal(frames.writeWorldOrigins().length, 0, 'unchanged physical poses upload no origin')
  }
})

test('a millimetre physical move updates only its origin texels, its exact double', () => {
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
  const before = fake.textureWrites.length,
    original = next[12]
  sources[0].world.elements[12] += 0.001
  rootWorlds(next, sources)
  assert.equal(next[12], original, 'single absolute float cannot carry this move')
  assert.deepEqual([...frames.writeWorldOrigins()], [0])
  assert.equal(fake.textureWrites.length - before, 1)
  const last = fake.textureWrites.at(-1)!
  assert.deepEqual(last.destination.origin, [1 << (WORLD_TABLE.rowShift + 2), 0, 0])
  assert.deepEqual(last.size, [2, 1, 1], 'its two texels')
  // The double, high word then low word, as the GPU holds it (`math/src/wgsl/double.ts`).
  const held = field(frames, 'Origin', 0),
    value = new Float64Array(new Uint32Array([held[1], held[0]]).buffer)[0]
  assert.equal(value, sources[0].world.elements[12])
})
