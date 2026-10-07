import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createSurfaceBuffer, withLobes } from './surfaceAllocation.ts'
import { holds } from './surfaceBuffer.ts'
import { PHYSICAL_LOBES_FORMAT, PHYSICAL_LOBES_TARGET, hasPhysicalLobes } from './physicalLobes.ts'

test('a lit surface carries a lobe with a strength or a coat above zero, and only then', () => {
  assert.equal(hasPhysicalLobes({ lit: true, anisotropy: 0.2 }), true)
  assert.equal(hasPhysicalLobes({ lit: true, clearcoat: 1 }), true)
  assert.equal(hasPhysicalLobes({ lit: true, anisotropy: 0, clearcoat: 0 }), false)
  assert.equal(hasPhysicalLobes({ lit: true }), false)
  assert.equal(hasPhysicalLobes({ lit: false, clearcoat: 1 }), false)
})

test('the lobes target takes one texel a pixel when wanted, a 1×1 otherwise', () => {
  // Its texel is its format's, four words (`textureBytesOf`).
  assert.equal(PHYSICAL_LOBES_TARGET.texelBytes, 16)
  const gpu = fakeDevice({ limits: { maxTextureDimension2D: 4096 } })
  const without = createSurfaceBuffer(gpu.device, 13, 7)
  const wanted = createSurfaceBuffer(gpu.device, 13, 7, { lobes: true })
  assert.equal(
    wanted.allocationBytes - without.allocationBytes,
    (13 * 7 - 1) * PHYSICAL_LOBES_TARGET.texelBytes,
  )
  assert.equal(holds(without, without.lobes), false)
  assert.equal(holds(wanted, wanted.lobes), true)
  const lobes = wanted.lobes as unknown as { width: number; height: number; format: string }
  assert.deepEqual([lobes.width, lobes.height, lobes.format], [13, 7, PHYSICAL_LOBES_FORMAT])
  without.dispose()
  wanted.dispose()
})

test('a lobe that comes remakes the lobes target alone, the other targets kept', () => {
  const gpu = fakeDevice({ limits: { maxTextureDimension2D: 4096 } })
  const without = createSurfaceBuffer(gpu.device, 13, 7)
  const made = gpu.textures.length
  const wanted = withLobes(gpu.device, without, true)
  assert.equal(gpu.textures.length, made + 1, 'one texture made: the lobes target')
  assert.ok(holds(wanted, wanted.lobes))
  assert.deepEqual(
    wanted.views(),
    without.views().map((view, at) => (at === 2 ? view : view)),
  )
  assert.equal(wanted.baseMetal, without.baseMetal)
  assert.equal(
    wanted.allocationBytes - without.allocationBytes,
    (13 * 7 - 1) * PHYSICAL_LOBES_TARGET.texelBytes,
  )
  const back = withLobes(gpu.device, wanted, false)
  assert.equal(holds(back, back.lobes, false), true)
  assert.equal(back.allocationBytes, without.allocationBytes)
  // Asked again at the size it has, the target is counted once.
  assert.equal(withLobes(gpu.device, wanted, true).allocationBytes, wanted.allocationBytes)
  assert.equal(withLobes(gpu.device, back, false).allocationBytes, back.allocationBytes)
})
