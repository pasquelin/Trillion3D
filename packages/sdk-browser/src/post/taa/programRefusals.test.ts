// What the temporal pass does when a driver refuses a program of the device's features — the wave
// programs, the packed formats' — and the anti-aliasing mask the device's limits choose.
import test from 'node:test'
import assert from 'node:assert/strict'
import { taaInputs, taaShape, taaSlices } from './frame.fixture.ts'
import { createTemporalAntialiasing } from './temporalAntialiasing.ts'
import { createVelocity } from './velocity.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { pipelinesSettled } from '../../lighting/deferred/compileLedger.ts'
import { createShapeMemo } from './historyShape.ts'
import { TAA_LEVEL_KNOBS } from './levels.ts'
import { spatialAntiAliasingShader } from './spatialAntiAliasingWgsl.ts'
import { rejectShadingShader } from './rejectionWgsl.ts'
import { analysisBytesPerPixel } from './analysisTargets.ts'
import { createAnalysisLayouts } from './analysisLayouts.ts'
import { BUFFER_FORMS, rejectionStorageForms, type StorageForms } from './storageForms.ts'
import { grantSubgroups, resolveLabelsOf } from './programVariants.fixture.ts'

// A program a driver refuses must not take the pass with it: the wave programs refused, the plain
// ones run, and the pass is made all the same.
test('a device that refuses the wave programs runs the plain ones', async () => {
  const { device, computePasses } = fakeDevice({ features: ['subgroups'] })
  grantSubgroups(device)
  const refuse =
    (create: (d: GPUComputePipelineDescriptor) => unknown) => (d: GPUComputePipelineDescriptor) => {
      if (d.label?.includes('wave')) throw new Error('refused')
      return create(d)
    }
  const raw = device as unknown as Record<string, (d: GPUComputePipelineDescriptor) => unknown>
  raw.createComputePipeline = refuse(raw.createComputePipeline.bind(device))
  raw.createComputePipelineAsync = async (d) => refuse(raw.createComputePipeline)(d)
  const temporal = await createTemporalAntialiasing(device, createVelocity(device))
  temporal.resize(taaShape(8, 4, 'high'), 8, 4)
  // An image asks the programs it skips; the next one runs them.
  for (let asked = true; asked;) {
    temporal.encode(device.createCommandEncoder(), taaInputs(), [8, 4], taaSlices())
    const settled = pipelinesSettled(device)
    asked = !!settled
    await settled
  }
  computePasses.length = 0
  temporal.encode(device.createCommandEncoder(), taaInputs(), [8, 4], taaSlices())
  const updates = resolveLabelsOf(computePasses)
  assert.deepEqual(updates, ['TAA_UPDATE false false plain'])
  temporal.dispose()
})

// The same for the packed formats' programs: one the driver refuses leaves the core's formats, for
// the history, the update and the anti-aliaser's target alike.
test('a device that refuses the programs of the packed formats keeps the core’s formats', async () => {
  const { device, textures } = fakeDevice({ features: ['texture-formats-tier1'] })
  const create = device.createBindGroupLayout.bind(device)
  device.createBindGroupLayout = (descriptor) => {
    const stores = [...descriptor.entries].map((entry) => entry.storageTexture?.format)
    if (stores.includes('rg11b10ufloat')) throw new Error('refused')
    return create(descriptor)
  }
  const temporal = await createTemporalAntialiasing(device, createVelocity(device))
  const shape = createShapeMemo(device)(
    TAA_LEVEL_KNOBS.max,
    { frames: 2, interval: 31, packed: true },
    8,
    4,
  )
  assert.deepEqual(
    [shape.formats.color, shape.formats.validity, shape.formats.antiAlias],
    ['rgba16float', 'rgba8unorm', 'rgba8uint'],
  )
  temporal.resize(shape, 8, 4)
  const formats = (name: string) =>
    textures
      .filter(({ label }) => label?.startsWith(`Trillion3D TAA ${name}`))
      .map(({ format }) => format)
  assert.deepEqual(
    [formats('history'), formats('validity'), formats('spatial')],
    [Array(4).fill('rgba16float'), Array(4).fill('rgba8unorm'), ['rgba8uint']],
  )
  temporal.dispose()
})

// The anti-aliasing mask is an r8uint storage texture, one byte a texel, where the device has
// `texture-formats-tier1` and grants the five storage textures the rejection then binds; else the
// buffer of a word a texel. The programs, the layouts and the bytes follow the one choice.
test('the anti-aliasing mask is a texture where the device allows it, a buffer else', async () => {
  const on = {
    features: ['texture-formats-tier1' as GPUFeatureName],
    limits: { maxStorageTexturesPerShaderStage: 5 },
  }
  const shapeFor = (options: Parameters<typeof fakeDevice>[0]) =>
    createShapeMemo(fakeDevice(options).device)(
      TAA_LEVEL_KNOBS.max,
      { frames: 2, interval: 31, packed: true },
      8,
      4,
    )
  const texture = shapeFor(on)
  assert.equal(texture.formats.mask, 'texture')
  assert.equal(
    shapeFor({ features: on.features }).formats.mask,
    'buffer',
    'the four storage textures a device is guaranteed, which the rejection binds itself',
  )
  const cinematic = createShapeMemo(fakeDevice(on).device)(
    TAA_LEVEL_KNOBS.max,
    { frames: 2, interval: 31, packed: false },
    8,
    4,
  )
  assert.deepEqual(
    [cinematic.formats.color, cinematic.formats.mask],
    ['rgba16float', 'texture'],
    'the mask follows the device, not the packed setting',
  )
  assert.equal(shapeFor({ limits: on.limits }).formats.mask, 'buffer', 'no tier 1')
  // The programs: the texture is stored by the rejection and loaded by the anti-aliaser.
  const writes = rejectShadingShader('rgb10a2unorm', 'rg11b10ufloat', false, 'texture')
  assert.match(writes, /var antiAliasMaskOut:texture_storage_2d<r8uint,write>/)
  assert.match(writes, /textureStore\(antiAliasMaskOut,p,vec4u\(select\(0u,1u,on\),0u,0u,0u\)\)/)
  const reads = spatialAntiAliasingShader('rg8uint', false, 'texture')
  assert.match(reads, /var antiAliasMask:texture_storage_2d<r8uint,read>/)
  assert.match(reads, /textureLoad\(antiAliasMask,p\)\.x>0u/)
  assert.match(reads, /^requires texture_formats_tier1;/)
  assert.match(
    rejectShadingShader('rgba8unorm', 'rgba16float'),
    /var<storage,read_write> antiAliasMaskOut:array<u32>/,
  )
  assert.match(spatialAntiAliasingShader(), /var<storage,read> antiAliasMask:array<u32>/)
  // The bytes a texel of the analysis takes: one for the texture, four for the buffer.
  // The shape alone, on a limit under the five that give the mask a texture: its form follows it.
  const buffer = shapeFor({
    features: on.features,
    limits: { maxStorageTexturesPerShaderStage: 4 },
  })
  assert.equal(
    analysisBytesPerPixel(buffer.sequence, buffer.field, true, buffer.formats) -
      analysisBytesPerPixel(texture.sequence, texture.field, true, texture.formats),
    3,
  )
  // The device makes the texture, its layouts bind it, and a level without the anti-aliaser a stand-in.
  const { device, textures } = fakeDevice(on)
  const temporal = await createTemporalAntialiasing(device, createVelocity(device))
  const memo = createShapeMemo(device)
  temporal.resize(memo(TAA_LEVEL_KNOBS.max, { frames: 2, interval: 31, packed: true }, 8, 4), 8, 4)
  const masks = () =>
    textures.filter(({ label }) => label?.startsWith('Trillion3D TAA anti-aliasing mask'))
  assert.deepEqual(
    masks().map(({ format }) => format),
    ['r8uint'],
  )
  temporal.dispose()
  const off = fakeDevice({ limits: on.limits })
  const plain = await createTemporalAntialiasing(off.device, createVelocity(off.device))
  plain.resize(
    createShapeMemo(off.device)(
      TAA_LEVEL_KNOBS.max,
      { frames: 2, interval: 31, packed: true },
      8,
      4,
    ),
    8,
    4,
  )
  assert.equal(
    off.textures.filter(({ label }) => label?.startsWith('Trillion3D TAA anti-aliasing mask'))
      .length,
    0,
    'a buffer, no texture',
  )
  plain.dispose()
})

// The LDR luma is an r8unorm storage texture, a plain store a texel, where the device has
// `texture-formats-tier1` and grants the storage texture it takes beside the rejection's others:
// five with the mask a buffer, six with the mask a texture; else the packed buffer of atomics.
test('the LDR luma is a texture where the device allows it, a buffer else', async () => {
  const shapeFor = (options: Parameters<typeof fakeDevice>[0]) =>
    createShapeMemo(fakeDevice(options).device)(
      TAA_LEVEL_KNOBS.max,
      { frames: 2, interval: 31, packed: true },
      8,
      4,
    ).formats
  const tier1 = ['texture-formats-tier1' as GPUFeatureName]
  const limit = (maxStorageTexturesPerShaderStage: number) => ({
    features: tier1,
    limits: { maxStorageTexturesPerShaderStage },
  })
  const formsAt = (n: number) => {
    const { mask, luma } = shapeFor(limit(n))
    return [mask, luma]
  }
  assert.deepEqual(formsAt(4), ['buffer', 'buffer'], 'four storage textures: neither')
  assert.deepEqual(formsAt(5), ['texture', 'buffer'], 'five: the mask, six are needed for both')
  assert.deepEqual(formsAt(6), ['texture', 'texture'], 'six: both')
  assert.equal(shapeFor({ limits: limit(8).limits }).luma, 'buffer', 'no tier 1')
  // The programs: one plain store, no atomic; the anti-aliaser loads the texture.
  const writes = rejectShadingShader('rgb10a2unorm', 'rg11b10ufloat', false, 'texture', 'texture')
  assert.match(writes, /var lumaOut:texture_storage_2d<r8unorm,write>/)
  assert.match(writes, /textureStore\(lumaOut,g,vec4f\(luma\/\(0\.5\+luma\),0\.0,0\.0,0\.0\)\)/)
  assert.doesNotMatch(writes, /atomic(And|Or)\(&lumaOut/)
  const reads = spatialAntiAliasingShader('rg8uint', false, 'buffer', 'texture')
  assert.match(reads, /var luma:texture_2d<f32>/)
  assert.match(reads, /textureLoad\(luma,q,0\)\.x/)
  assert.match(rejectShadingShader('rgba8unorm', 'rgba16float'), /array<atomic<u32>>/)
})

// The storage textures the rejection always binds are what the layout holds with both resources as
// buffers; the mask and the luma add one each as textures.
test('the rejection binds the storage textures the allocator counts', () => {
  // The layout the analysis makes for the rejection, on a device that grants textures to spare, counted in its storage textures.
  const stored = (forms: StorageForms) => {
    const { device } = fakeDevice({
      features: ['texture-formats-tier1'],
      limits: { maxStorageTexturesPerShaderStage: 8 },
    })
    const { rejectShading } = createAnalysisLayouts(device, {
      antiAlias: 'rgba8unorm',
      guide: 'rgba8unorm',
      measure: 'r32float',
      ...forms,
    })
    return [...(rejectShading as unknown as GPUBindGroupLayoutDescriptor).entries].filter(
      (entry) => entry.storageTexture,
    ).length
  }
  // What the allocator counts as always bound: the textures below the first limit that grants the mask a texture.
  const tier1 = { has: () => true }
  const counted =
    [...Array(16).keys()].find(
      (limit) =>
        rejectionStorageForms(tier1, { maxStorageTexturesPerShaderStage: limit }).mask ===
        'texture',
    )! - 1
  assert.equal(stored(BUFFER_FORMS), counted)
  assert.equal(stored({ mask: 'texture', luma: 'buffer' }), counted + 1)
  assert.equal(stored({ mask: 'texture', luma: 'texture' }), counted + 2)
})
