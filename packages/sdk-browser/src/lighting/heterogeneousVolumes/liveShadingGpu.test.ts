// The live shading's resources: the volume's buffer, the cache's size and the image's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { downsampledSize, lightingCacheResolution } from './liveShadingGpu.ts'
import { HV_VOLUME_BYTES } from './liveShadingPack.ts'
import { packVolume } from './liveShadingPack.ts'
import { HV_COMPOSITE_WGSL, HV_KERNELS_WGSL } from './liveShadingKernelsWgsl.ts'

test('the cache is the volume over the factor, held to the limits of its sides', () => {
  assert.deepEqual(lightingCacheResolution([128, 64, 32], 0, 2), [64, 32, 16])
  assert.deepEqual(lightingCacheResolution([128, 64, 32], 4, 2), [32, 16, 8])
  assert.deepEqual(lightingCacheResolution([4000, 4000, 4000], 0, 1), [1024, 1024, 512])
  assert.deepEqual(lightingCacheResolution([1, 1, 1], 0, 8), [1, 1, 1])
})

test('the image is rounded up', () => {
  assert.deepEqual(downsampledSize([1921, 1080], 2), [961, 540])
})

test('the volume buffer holds the matrices, the vectors and the words in the order the shader reads', () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const bytes = packVolume({
    localToWorld: identity,
    worldToLocal: identity,
    boundsOrigin: [1, 2, 3],
    boundsExtent: [4, 5, 6],
    resolution: [7, 8, 9],
    lightKinds: 15,
    heightFog: true,
    volumetricFog: false,
    cacheResolution: [10, 11, 12],
    shadowBiasFactor: 0.5,
    step: [-1, 1, -1, 2],
    limits: [30000, 30000, 512, 1],
    flags: [1, 1, 1, 2],
    lightRank: 7,
    indirectMode: 2,
    indirectFactor: 0.5,
  })
  assert.equal(bytes.byteLength, HV_VOLUME_BYTES)
  const floats = new Float32Array(bytes)
  assert.deepEqual([...floats.slice(32, 36)], [1, 2, 3, 1])
  assert.deepEqual([...floats.slice(36, 40)], [4, 5, 6, 0])
  assert.deepEqual([...floats.slice(44, 48)], [10, 11, 12, 0.5])
  assert.deepEqual([...floats.slice(48, 52)], [-1, 1, -1, 2])
  assert.deepEqual([...new Uint32Array(bytes).slice(56, 60)], [1, 1, 1, 2])
  assert.deepEqual([...new Uint32Array(bytes).slice(60, 62)], [7, 2])
  assert.equal(floats[62], 0.5)
})

test('the kernels and the composition keep no backtick and name their entry points', () => {
  for (const block of [HV_KERNELS_WGSL, HV_COMPOSITE_WGSL])
    assert.equal(block.text.includes('`'), false)
  assert.match(HV_KERNELS_WGSL.text, /fn hvLightingCacheMain/)
  assert.match(HV_KERNELS_WGSL.text, /fn hvLiveShadingMain/)
  assert.match(HV_COMPOSITE_WGSL.text, /fn hvFiltered/)
})

test('the view uniform holds the unprojection, the eye, the rectangle, the exposure and the switches where the shader reads them', async () => {
  const { packView } = await import('./liveShadingView.ts')
  const bytes = packView(
    {
      inverseViewProj: Array.from({ length: 16 }, (_, i) => i),
      eye: [1, 2, 3],
      forward: [0, 0, -1],
      depthMap: [0.5, 0.25],
      perspective: true,
    },
    [4, 5, 6, 7],
    [2, 3],
    [8, 9],
    [1, 2, 3, 4],
    [10, 11, 12, 13, 14, 15, 16, 17],
  )
  const floats = new Float32Array(bytes)
  const words = new Uint32Array(bytes)
  assert.equal(bytes.byteLength, 304)
  assert.deepEqual([...floats.slice(16, 20)], [1, 2, 3, 1])
  assert.deepEqual([...floats.slice(24, 27)], [0.5, 0.25, 0])
  assert.deepEqual([...words.slice(28, 32)], [4, 5, 6, 7])
  assert.deepEqual([floats[32], floats[35]], [2, 3])
  assert.deepEqual([...words.slice(40, 44)], [1, 2, 3, 4])
  assert.deepEqual([...words.slice(44, 52)], [10, 11, 12, 13, 14, 15, 16, 17])
})

test('a graph that reads two sparse volumes gets a binding set for each, and the transmittance cache has its pass', async () => {
  const { HETEROGENEOUS_VOLUME_SHADERS } =
    await import('../../gpu/core/engineShaders.heterogeneousVolumes.fixture.ts')
  const text = HETEROGENEOUS_VOLUME_SHADERS.HETEROGENEOUS_VOLUME
  assert.match(text, /var svtPageTable0:texture_3d<u32>/)
  assert.match(text, /var svtPageTable1:texture_3d<u32>/)
  assert.doesNotMatch(text, /svtPageTable2/)
  assert.match(text, /if\(volume==svtSlots\.nodes\[1\]\)/)
  assert.match(text, /fn hvTransmittanceToLight/)
  assert.match(text, /hv\.flags\.z==1u/)
})

test('no two bindings of a program share a number, with the holdout and the sparse volumes bound', async () => {
  const { HETEROGENEOUS_VOLUME_SHADERS } =
    await import('../../gpu/core/engineShaders.heterogeneousVolumes.fixture.ts')
  for (const name of ['HETEROGENEOUS_VOLUME', 'HETEROGENEOUS_VOLUME_HOLDOUT']) {
    const bindings = [
      ...HETEROGENEOUS_VOLUME_SHADERS[name].matchAll(/@group\((\d+)\) @binding\((\d+)\)/g),
    ].map((m) => `${m[1]}:${m[2]}`)
    assert.equal(new Set(bindings).size, bindings.length, `${name} binds a number twice`)
  }
  assert.match(
    HETEROGENEOUS_VOLUME_SHADERS.HETEROGENEOUS_VOLUME_HOLDOUT,
    /var holdout:texture_storage_2d<r32float,read_write>/,
  )
  assert.doesNotMatch(HETEROGENEOUS_VOLUME_SHADERS.HETEROGENEOUS_VOLUME, /var holdout:/)
})
