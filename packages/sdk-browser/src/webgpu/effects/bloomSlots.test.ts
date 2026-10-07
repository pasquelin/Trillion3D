// A device aligning uniform offsets at 512 bytes: the bloom's slots lie 512 bytes apart.
import test from 'node:test'
import assert from 'node:assert/strict'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import { bloomLevelSizes } from '../../effects/bloomFilter.ts'
import { input, loaded, recorder, floatsOf } from './webgpuEffects.fixture.ts'

test('a device aligning at 512 lays the bloom’s uniform slots 512 bytes apart', async () => {
  const { gpu, effects } = await loaded(512)
  const { encoder, passes } = recorder()
  const bloom = effect.bloom({ intensity: 0.5, radius: 2 })
  effects.encode(encoder, [bloom], input, 64, 32)
  await effects.settled()
  passes.length = 0
  effects.encode(encoder, [bloom], input, 64, 32)
  const levels = bloomLevelSizes(64, 32).length
  const uniform = gpu.buffers.find((buffer) => buffer.label === 'Trillion3D bloom uniform')!
  assert.equal(uniform.size, 2 * levels * 512)
  // Every pass reads its own slot, the up passes from the smallest level back.
  assert.deepEqual(
    passes.map((pass) => pass.offset!).sort((a, b) => a - b),
    Array.from({ length: 2 * levels }, (_, slot) => slot * 512),
  )
  // Each slot's radius at its fifth float, 128 floats a slot.
  const floats = new Float32Array(uniform.size / 4)
  const writes = gpu.writes.filter((write) => write.buffer === (uniform as unknown))
  // The range in one write, as at 256 bytes: from the first slot's struct to the last's.
  assert.equal(writes.length, 1)
  for (const write of writes) floats.set(floatsOf(write), write.offset / 4)
  for (let slot = 0; slot < 2 * levels; slot++) assert.equal(floats[slot * 128 + 4], 2)
  assert.ok(
    floats.every((word, k) => k % 128 < 8 || word === 0),
    'the padding holds zeros',
  )
  passes.length = 0
  effects.encode(encoder, [bloom], input, 64, 32, true)
  assert.equal(effects.blend!.offset, (2 * levels - 1) * 512, 'the blend reads its own slot')
})
