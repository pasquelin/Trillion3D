// #1410: the bounce probes and surface cache left their storage buffers for float atlases, so the
// deferred lighting with bounce holds the eight storage buffers WebGPU guarantees. Defects these
// tests catch: two probe vectors written to one texel (a probe then reads its neighbour's
// coefficients), an atlas that drops the last entries or outgrows the 2D texture limit, a value
// that does not come back bit for bit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { BOUNCE_SETTINGS, createBounceCascades } from '../../../sdk-core/src/index.ts'
import { ownedProxy } from '../../../sdk-core/src/scene/core/proxy.fixture.ts'
import { shaderRun, type Vec } from '../texture/shaderRun.fixture.ts'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { PORTABLE_TEXTURE_SIDE as ATLAS_DIMENSION } from '../frame/referenceTilePlacement.ts'
import { PROBE_TEXELS, atlasBytes, atlasExtent, probeAtlasExtent } from './atlas.ts'
import { bounceProbeBytes, ensureBounceFits } from './limits.ts'
import { BOUNCE_PROBE_SHADER } from './probeWgsl.ts'

/** A simulated atlas: `textureDimensions`, `textureLoad` and `textureStore` over a texel map, every
 *  texel asked of it inside its extent. */
function atlas([width, height, layers]: number[]) {
  const texels = new Map<string, Vec>()
  const key = ([x, y]: Vec, layer: number) => {
    assert.ok(Number(x) < width && Number(y) < height && layer < layers, 'in the atlas')
    return `${x},${y},${layer}`
  }
  const scope = {
    probes: {},
    probesOut: {},
    textureLoad: (_: object, at: Vec, layer: number) => texels.get(key(at, layer)) ?? [0, 0, 0, 0],
    textureStore: (_: object, at: Vec, layer: number, value: Vec) =>
      void texels.set(key(at, layer), value),
  }
  return { texels, scope }
}
type Probe = {
  probeAddress: (level: number, wrapped: Vec) => Vec
  probeAt: (probe: Vec, k: number) => Vec
  probeStore: (probe: Vec, k: number, value: Vec) => void
}

test('every probe vector has a texel of its own, read back bit for bit where it was written', () => {
  const [side, levels] = [3, 2]
  const { texels, scope } = atlas(probeAtlasExtent(side, levels))
  const bounce = { counts: [side, levels, side ** 3, 1] }
  const run = shaderRun<Probe>(BOUNCE_PROBE_SHADER, ['probeAddress', 'probeAt', 'probeStore'], {
    ...scope,
    bounce,
    PROBE_VECTORS: PROBE_TEXELS,
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
  assert.equal(texels.size, levels * side ** 3 * PROBE_TEXELS, 'no two vectors share a texel')
  vectors.forEach(([probe, k], i) => assert.deepEqual(run.probeAt(probe, k), value(i), `${i}`))
})

test('the probe atlas holds a level per layer and weighs what the buffer did', () => {
  const cascades = createBounceCascades(ownedProxy().bounds)
  const extent = probeAtlasExtent(cascades.size, BOUNCE_SETTINGS.cascadeLevels)
  assert.equal(extent[0] * extent[1], cascades.probesPerLevel * PROBE_TEXELS, 'a level a layer')
  assert.equal(extent[2], BOUNCE_SETTINGS.cascadeLevels)
  assert.equal(atlasBytes(extent), bounceProbeBytes(cascades.reserveCount))
  assert.ok(extent[0] <= ATLAS_DIMENSION && extent[1] <= ATLAS_DIMENSION)
})

test('a surface cache atlas keeps every texel within the 2D limit, and a larger one is refused', () => {
  for (const texels of [1, 2, 8191, 8192, 8193, 2_000_003, ATLAS_DIMENSION ** 2]) {
    const [width, height] = atlasExtent(texels)
    assert.ok(width <= ATLAS_DIMENSION && height <= ATLAS_DIMENSION, `${texels}: within the limit`)
    assert.ok(width * height >= texels, `${texels}: no texel lost`)
    assert.ok(width * height - texels < height, `${texels}: under a texel of padding per row`)
  }
  const { device } = fakeDevice({
    limits: { maxTextureDimension2D: ATLAS_DIMENSION, maxTextureArrayLayers: 256 },
  })
  const proxy = { ...ownedProxy(), triangles: ATLAS_DIMENSION ** 2 / 2 + 1 }
  assert.throws(
    () => ensureBounceFits(device, proxy, [1, 1, 1], 16),
    /bounce atlas "surface cache" needs .* over this device's maxTextureDimension2D of 8192/,
  )
})
