import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createSurfaceBuffer, withLobes } from './surfaceAllocation.ts'
import { holds } from './surfaceBuffer.ts'
import {
  PHYSICAL_LOBES_FORMAT,
  PHYSICAL_LOBES_TARGET,
  hasLightingLobes,
  hasPhysicalLobes,
} from './physicalLobes.ts'
import { LOBE_AXIS_WGSL } from '../../lighting/lobeAxisWgsl.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'

test('a lit surface carries a lobe with a strength or a coat above zero, and only then', () => {
  assert.equal(hasPhysicalLobes({ lit: true, anisotropy: 0.2 }), true)
  assert.equal(hasPhysicalLobes({ lit: true, clearcoat: 1 }), true)
  assert.equal(hasPhysicalLobes({ lit: true, anisotropy: 0, clearcoat: 0 }), false)
  assert.equal(hasPhysicalLobes({ lit: true }), false)
  assert.equal(hasPhysicalLobes({ lit: false, clearcoat: 1 }), false)
})

test('a declared specular makes a record, whatever its value, and no lobe: the lobes target is not asked', () => {
  for (const specularIntensity of [0, 0.5, 1]) {
    assert.equal(hasPhysicalLobes({ lit: true, specularIntensity }), true)
    assert.equal(hasLightingLobes({ lit: true, specularIntensity }), false)
  }
  assert.equal(hasPhysicalLobes({ lit: false, specularIntensity: 1 }), false)
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
  assert.equal(wanted.colours, without.colours)
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

type Vec3 = [number, number, number]
const widths = shaderRun<{
  lobeAxis(d: Vec3, strength: number, n: Vec3, alpha: number): number[]
  lobeAcross(strength: number, alpha: number): number
  packedCoat(w: number[]): number[]
}>(LOBE_AXIS_WGSL, ['lobeAxis', 'lobeAcross', 'packedCoat'], {
  ROUGHNESS_FLOOR: 0.045,
  unpack2x16unorm: (word: number) => [(word & 0xffff) / 65535, (word >>> 16) / 65535],
})

test('an anisotropy widens the highlight along its axis and narrows it across as α(1 ± a)', () => {
  // Roughness 0.3, anisotropy 0.5: α = 0.09, the widths 0.135 along and 0.045 across.
  const alpha = 0.3 * 0.3
  const along = widths.lobeAxis([1, 0, 0], 0.5, [0, 0, 1], alpha)
  assert.ok(Math.abs(along[3]! - 0.135) < 1e-6)
  assert.ok(Math.abs(widths.lobeAcross(0.5, alpha) - 0.045) < 1e-6)
  assert.deepEqual(
    along.slice(0, 3),
    [1, 0, 0],
    'the axis is the direction kept orthogonal to the normal',
  )
  // No anisotropy, no stretch; the width across is held above 0.001.
  assert.equal(widths.lobeAxis([1, 0, 0], 0, [0, 0, 1], alpha)[3], alpha)
  assert.equal(widths.lobeAcross(0, alpha), alpha)
  assert.equal(widths.lobeAcross(1, alpha), 0.001)
})

test('the coat read takes the roughness the texel holds', () => {
  const rough = new Float32Array([0.25])
  const bits = new Uint32Array(rough.buffer)[0]!
  assert.equal(widths.packedCoat([0, 0, 0, bits])[1], 0.25)
})
