import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import type { FakeTexture } from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { createCameraFrames } from '../cameraFrames.ts'
import { FRAME_ROW_WORDS } from '../types.ts'
import { rootWorlds } from '../pack/packWorlds.ts'
import { rootWorldsToRenderOrigin } from '../pack/pack.fixture.ts'
import { WORLD_TABLE } from './worldTable.ts'
import { recordWordAt } from '../../../gpu/core/recordTexture.fixture.ts'

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

test('the worlds stay one table past one storage binding, and keep absolute origins across camera moves', () => {
  const sources = roots(),
    next = new Float32Array(sources.length * 16)
  rootWorlds(next, sources)
  const rowBytes = FRAME_ROW_WORDS * 4
  const fake = fakeDevice({
    limits: {
      maxBufferSize: 2 * rowBytes,
      maxStorageBufferBindingSize: 2 * rowBytes,
      minUniformBufferOffsetAlignment: 256,
    },
  })
  const frames = createCameraFrames(
    fake.device,
    new Float32Array(sources.length * FRAME_ROW_WORDS),
    sources.length,
    next,
    sources,
  )
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
    assert.equal(fake.textureWrites.length - before, 1, 'one write, whatever one binding holds')
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
    new Float32Array(sources.length * FRAME_ROW_WORDS),
    sources.length,
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

/** The first axis of placement `w`'s translation in the record table `table`, as the queue and the
 *  copies left it. */
const translationX = (table: { texture: GPUTexture }, w: number) => {
  const texture = table.texture as unknown as FakeTexture,
    at = recordWordAt(WORLD_TABLE, texture, 'Matrix', w)
  return new Float32Array(texture.words!.slice(at, at + 16).buffer)[12]
}

/** Camera frames of `count` placements, the translation of placement `w` at `first + w`. */
function framesOf(fake: ReturnType<typeof fakeDevice>, count: number, first: number) {
  const sources = Array.from({ length: count }, (_, w) => ({
    world: {
      elements: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, first + w, 0, 0, 1]),
    },
  }))
  const worlds = new Float32Array(count * 16)
  sources.forEach((source, w) => worlds.set(source.world.elements, w * 16))
  const frames = createCameraFrames(
    fake.device,
    new Float32Array(count * FRAME_ROW_WORDS),
    count,
    worlds,
    sources as never,
  )
  const kept = () => Array.from({ length: count }, (_, w) => translationX(frames.previous.table, w))
  return { frames, previous: frames.previous, worlds, kept }
}

test('the kept poses take the placements that moved at the first keep after a drawn frame, and none after a held one', () => {
  const { frames, worlds, kept } = framesOf(fakeDevice(), 4, 0)
  const { previous } = frames
  assert.deepEqual(kept(), [0, 1, 2, 3], 'a placement made takes its pose at once')
  assert.equal(previous.moving, true, 'every pose is to be copied at the first keep')
  previous.keep()
  assert.equal(previous.moving, false)
  // Placements 1 and 2 move in the worlds' table; only 1 is told: the copy follows the moved list.
  worlds[1 * 16 + 12] = 50
  worlds[2 * 16 + 12] = 60
  frames.writeWorlds(worlds)
  previous.moved(1)
  assert.deepEqual(kept(), [0, 1, 2, 3], 'the table keeps the poses of the last drawn image')
  assert.equal(previous.moving, true)
  // A frame none of whose views were drawn leaves the table and the list as they are.
  previous.keep()
  assert.deepEqual(kept(), [0, 1, 2, 3], 'a held frame copies nothing')
  assert.equal(previous.moving, true, 'its moves wait for the next drawn frame')
  previous.drawn()
  previous.keep()
  assert.deepEqual(kept(), [0, 50, 2, 3], 'the moved placement alone is copied')
  assert.equal(previous.moving, false)
  previous.keep()
  assert.deepEqual(kept(), [0, 50, 2, 3], 'one keep a drawn frame: a second finds nothing drawn')
})

test('a cut made over the placements of the one it replaces takes their kept poses, not the worlds it was packed at', () => {
  const fake = fakeDevice()
  const older = framesOf(fake, 4, 0)
  older.previous.keep()
  older.worlds[1 * 16 + 12] = 50
  older.frames.writeWorlds(older.worlds)
  older.previous.moved(1)
  older.previous.drawn()
  older.previous.keep()
  const grown = framesOf(fake, 6, 100)
  assert.deepEqual(grown.kept(), [100, 101, 102, 103, 104, 105])
  grown.previous.keep()
  grown.previous.adopt(older.previous)
  assert.deepEqual(grown.kept(), [0, 50, 2, 3, 104, 105], 'its first four are the kept poses')
  assert.equal(grown.previous.moving, true, 'every pose is copied again at the next keep')
})
