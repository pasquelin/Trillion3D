// The bounce probes left their storage buffers for a float atlas, so the
// deferred lighting with bounce holds the eight storage buffers WebGPU guarantees. Defects these
// tests catch: two probe vectors written to one texel (a probe then reads its neighbour's
// coefficients), an atlas that drops the last entries or outgrows the 2D texture limit, a value
// that does not come back bit for bit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_SETTINGS, PROBE_FLOATS } from '../../../sdk-core/src/bounce/contracts.ts'
import { createBounceCascades } from '../../../sdk-core/src/bounce/cascades.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import type { Vec } from '../texture/shaderRunBuiltins.fixture.ts'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { GUARANTEED_SIDE } from '../gpu/core/textureLimits.ts'
import { PROBE_TEXELS, atlasBytes, probeAtlasExtent } from './atlas.ts'
import { ATLAS_CALLS, simulatedAtlas } from './atlas.fixture.ts'
import { ensureBounceFits } from './limits.ts'
import { BOUNCE_PROBE_SHADER } from './probeWgsl.ts'

type Probe = {
  probeAddress: (level: number, wrapped: Vec) => Vec
  probeAt: (probe: Vec, k: number) => Vec
  probeStore: (probe: Vec, k: number, value: Vec) => void
}

test('every probe vector has a texel of its own, read back bit for bit where it was written', () => {
  const [side, levels] = [3, 2]
  // Every texel unwritten (NaN) until a vector is stored there.
  const probes = simulatedAtlas(probeAtlasExtent(side, levels), () => NaN)
  const bounce = { counts: [side, levels, side ** 3, 1] }
  const run = shaderRun<Probe>(BOUNCE_PROBE_SHADER, ['probeAddress', 'probeAt', 'probeStore'], {
    ...ATLAS_CALLS,
    probes,
    probesOut: probes,
    bounce,
  })
  const vectors: [Vec, number][] = []
  for (let level = 0; level < levels; level++)
    for (let z = 0; z < side; z++)
      for (let y = 0; y < side; y++)
        for (let x = 0; x < side; x++)
          for (let k = 0; k < PROBE_TEXELS; k++)
            vectors.push([run.probeAddress(level, [x, y, z]), k])
  const value = (i: number) => [i, Math.fround(i / 3), -i, Math.fround(Math.PI * i)]
  vectors.forEach(([probe, k], i) => run.probeStore(probe, k, value(i)))
  const written = probes.texels.filter((texel) => !Number.isNaN(texel[0])).length
  assert.equal(written, levels * side ** 3 * PROBE_TEXELS, 'no two vectors share a texel')
  vectors.forEach(([probe, k], i) => assert.deepEqual(run.probeAt(probe, k), value(i), `${i}`))
})

test('the probe atlas holds a level per layer, every declared level, a probe its floats', () => {
  const cascades = createBounceCascades([0, 0, 0, 20, 3, 3])
  const extent = probeAtlasExtent(cascades.size, BOUNCE_SETTINGS.cascadeLevels)
  assert.equal(extent[0] * extent[1], cascades.probesPerLevel * PROBE_TEXELS, 'a level a layer')
  assert.equal(extent[2], BOUNCE_SETTINGS.cascadeLevels)
  assert.equal(atlasBytes(extent), cascades.reserveCount * PROBE_FLOATS * 4)
  assert.ok(extent[0] <= GUARANTEED_SIDE && extent[1] <= GUARANTEED_SIDE)
})

// Behaviour: the probes' atlas is as wide as the device grants; past its side it is refused.
test('a probe atlas within the 2D limit is made, and a larger one is refused', () => {
  const device = (maxTextureDimension2D: number) =>
    fakeDevice({ limits: { maxTextureDimension2D, maxTextureArrayLayers: 256 } }).device
  const wide = [GUARANTEED_SIDE + 1, 1, 1]
  assert.throws(
    () => ensureBounceFits(device(GUARANTEED_SIDE), wide, 16),
    /bounce atlas "probes" needs .* over this device's maxTextureDimension2D of 8192/,
  )
  assert.doesNotThrow(() => ensureBounceFits(device(2 * GUARANTEED_SIDE), wide, 16))
})
