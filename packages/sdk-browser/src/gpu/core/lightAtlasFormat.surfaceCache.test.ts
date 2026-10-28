// The surface cache and the radiance cache's raw atlas follow the format their light is stored in: the layers, the clears, the programs and the layouts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import {
  cacheSplatEntries,
  cacheTracedLayouts,
  cacheTraceEntries,
} from '../../lighting/bounce/cache/cacheBindings.ts'
import {
  cacheSplatProgramOf,
  cacheTraceProgramOf,
  cacheTracedProgramOf,
} from '../../lighting/bounce/cache/cacheTraceWgsl.ts'
import { radianceRawFormat, cacheTraceBytes } from '../../lighting/bounce/cache/cacheLayout.ts'
import { cacheFilterProgram } from '../../lighting/bounce/cache/cacheFilterWgsl.ts'
import { occlusionProgram } from '../../lighting/bounce/irradianceField/mapsWgsl.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { ensureSurfaceAtlases } from '../../lighting/surfaceCache/atlases.ts'
import { createCaptureKernels } from '../../lighting/surfaceCache/copy.ts'
import { atlasFormats, captureFormats } from '../../lighting/surfaceCache/layout.ts'
import { lightWordsOf } from './lightWords.ts'
import {
  surfaceCacheReadLayoutEntries,
  SURFACE_CACHE_LAYER_AT,
} from '../../lighting/surfaceCache/sampleWgsl.ts'
import {
  surfaceHitCardsLayoutEntries,
  surfaceHitWgsl,
  surfaceHitBindingsFrom,
} from '../../lighting/surfaceCache/hitWgsl.ts'
import {
  directMeshKernel,
  fixedKernels,
  shapedKernels,
  stochasticKernels,
  tracedRadiosityKernels,
  tracedShadowKernels,
} from '../../lighting/surfaceCache/lighting/kernels.ts'
import { combineWgsl } from '../../lighting/surfaceCache/lighting/combineWgsl.ts'
import { radiosityIntegrateProgramOf } from '../../lighting/surfaceCache/lighting/radiosityIntegrateWgsl.ts'
import {
  WORD_LIGHT_FORMAT,
  lightAtlasSampleType,
  type LightAtlasFormat,
} from './lightAtlasFormat.ts'

const ALL_FORMATS: readonly LightAtlasFormat[] = [
  'r32uint',
  'rg11b10ufloat',
  'rgba16float',
  'rgba32float',
]

test('each format makes the surface cache: its direct and final light in the format, its indirect light in the words it takes, the capture atlas alike', () => {
  const size = (device: ReturnType<typeof fakeDevice>, label: string) => {
    const texture = device.textures.find((made) => made.label?.endsWith(label))!
    return { width: texture.width, height: texture.height, format: texture.format }
  }
  let bytes = 0
  for (const light of ALL_FORMATS) {
    const f = fakeDevice({ features: ['texture-formats-tier1'] })
    const made = ensureSurfaceAtlases(
      undefined,
      f.device as unknown as GPUDevice,
      512,
      256,
      false,
      8,
      light,
    )
    assert.equal(made.atlases?.light, light)
    const words = lightWordsOf(light)
    for (const [label, side] of [
      ['direct lighting', 512],
      ['final lighting', 512],
      ['capture direct lighting', 256],
    ] as const)
      assert.deepEqual(
        size(f, label),
        { width: side, height: side, format: light },
        `${label} ${light}`,
      )
    // The indirect light is read and written in place: words of a texture that grants it, a texel of `words` of them.
    assert.deepEqual(size(f, 'indirect lighting'), {
      width: 512 * words,
      height: 512,
      format: 'r32uint',
    })
    assert.deepEqual(size(f, 'capture indirect lighting'), {
      width: 256 * words,
      height: 256,
      format: 'r32uint',
    })
    assert.equal(atlasFormats(false, light).final, light)
    assert.equal(captureFormats(light).direct, light)
    assert.ok((made.atlases?.bytes ?? 0) >= bytes, 'a format of more bytes costs no less')
    bytes = made.atlases?.bytes ?? 0
    // The atlases held are kept for the format they were made in, made again for another.
    const again = ensureSurfaceAtlases(
      made.atlases,
      f.device as unknown as GPUDevice,
      512,
      256,
      false,
      8,
      light,
    )
    assert.equal(again.atlases, made.atlases)
  }
  const f = fakeDevice({ features: ['texture-formats-tier1'] })
  const first = ensureSurfaceAtlases(
    undefined,
    f.device as unknown as GPUDevice,
    512,
    256,
    false,
    8,
    'r32uint',
  ).atlases
  const other = ensureSurfaceAtlases(
    first,
    f.device as unknown as GPUDevice,
    512,
    256,
    false,
    8,
    'rgba16float',
  ).atlases
  assert.notEqual(other, first)
  assert.equal(other?.light, 'rgba16float')
  assert.deepEqual(
    [
      lightWordsOf('r32uint'),
      lightWordsOf('rg11b10ufloat'),
      lightWordsOf('rgba16float'),
      lightWordsOf('rgba32float'),
    ],
    [1, 1, 2, 3],
  )
})

test('the layers of the native 11-11-10 format are cleared by copies of zeros, the others by a render pass each', () => {
  for (const light of ALL_FORMATS) {
    const f = fakeDevice({ features: ['texture-formats-tier1'] })
    const device = f.device as unknown as GPUDevice
    const made = ensureSurfaceAtlases(undefined, device, 512, 256, false, 8, light).atlases!
    const encoder = device.createCommandEncoder()
    made.clear(encoder)
    made.clearLayer(encoder, 'direct')
    const native = light === 'rg11b10ufloat'
    // No attachment of the native format is asked for, and a copy fills whole rows of a layer: 512 texels of 4 bytes a row, a strip of rows (here all 512) at a time.
    for (const texture of f.textures.filter((made) => made.format === 'rg11b10ufloat'))
      assert.equal(texture.usage & GPUTextureUsage.RENDER_ATTACHMENT, 0)
    const copies = f.textureBufferCopies
    // The direct and final layers are cleared by `clear`, the direct one again by `clearLayer`.
    assert.equal(copies.length, native ? 3 : 0, light)
    for (const copy of copies) {
      assert.deepEqual(copy.size, [512, 512])
      assert.equal((copy.source as GPUTexelCopyBufferInfo).bytesPerRow, 512 * 4)
    }
    made.dispose()
  }
})

test('the raw and trace atlases of the radiance cache hold the light in its words beside the distance word, and every pass that reads or writes them follows', () => {
  for (const light of ALL_FORMATS) {
    const words = lightWordsOf(light)
    const raw = radianceRawFormat(light)
    assert.equal(raw, words === 1 ? 'rg32uint' : 'rgba32uint')
    const texel = words === 1 ? 'vec2u' : 'vec4u'
    const filter = cacheFilterProgram(light)
    assert.match(filter, new RegExp(`fn cacheRawAt\\(base:vec2u,texel:vec2u\\)->${texel}\\{`))
    assert.equal(/fn lightFloats\(/.test(filter), words > 1)
    for (const program of [cacheTraceProgramOf(light), cacheTracedProgramOf(light)])
      assert.match(program, new RegExp(`(rawOut|traceOut):texture_storage_2d<${raw},write>`))
    const splat = cacheSplatProgramOf(light)
    assert.match(splat, new RegExp(`var rawOut:texture_storage_2d<${raw},write>`))
    assert.equal(/lightFloats\(taken\.xyz\),taken\.w/.test(splat), words > 1)
    // The distance word is the second of two and the last of four.
    assert.match(
      occlusionProgram(8, light),
      new RegExp(`cacheRaw,vec2i\\(raw\\+source\\),0\\)\\.${words === 1 ? 'g' : 'a'};`),
    )
    for (const entries of [
      cacheTraceEntries(light),
      cacheSplatEntries(light),
      cacheTracedLayouts(light)[0],
    ])
      assert.equal(
        entries.find((entry) => entry.binding === 6 && entry.storageTexture)?.storageTexture
          ?.format ??
          entries.find((entry) => entry.binding === 20 && entry.storageTexture)?.storageTexture
            ?.format,
        raw,
      )
    // A trace atlas costs what its texel does.
    assert.equal(cacheTraceBytes(512, light), 4096 * 8 * (words === 1 ? 8 : 16))
  }
})

test('the programs and layouts of the surface cache follow the format: the sample types, the storage formats and the words of the indirect light', () => {
  const L = SURFACE_CACHE_LAYER_AT
  for (const light of ALL_FORMATS) {
    const entries = surfaceCacheReadLayoutEntries(0, { feedback: false, compressed: false, light })
    const sample = (layer: number) =>
      entries.find((entry) => entry.binding === layer)?.texture?.sampleType
    assert.equal(sample(L.direct), lightAtlasSampleType(light))
    assert.equal(sample(L.final), lightAtlasSampleType(light))
    assert.equal(sample(L.indirect), 'uint')
    const hit = surfaceHitCardsLayoutEntries({ cards: 0, instances: 20 }, light).find(
      (entry) => entry.binding === L.final,
    )
    assert.equal(hit?.texture?.sampleType, lightAtlasSampleType(light))
    const wordly = light === WORD_LIGHT_FORMAT
    assert.match(
      wgslModule(surfaceHitWgsl(surfaceHitBindingsFrom(0, 0), light)),
      new RegExp(`var scFinalAtlas:texture_2d<${wordly ? 'u32' : 'f32'}>`),
    )
    const combine = combineWgsl(false, light)
    assert.match(combine, new RegExp(`var directAtlas:texture_2d<${wordly ? 'u32' : 'f32'}>`))
    assert.match(combine, new RegExp(`var outFinal:texture_storage_2d<${light},write>`))
    assert.match(combine, /var indirectAtlas:texture_2d<u32>/)
    assert.equal(/fn indirectRead\(/.test(combine), lightWordsOf(light) > 1)
    const integrate = radiosityIntegrateProgramOf(light)
    assert.match(integrate, /var indirectAtlas:texture_storage_2d<r32uint,read_write>/)
    assert.equal(/indirectWriteInPlace\(/.test(integrate), lightWordsOf(light) > 1)
    // Only the word format dithers the accumulation: the floats keep what they hold.
    assert.equal(/ditherLight\(mix\(/.test(integrate), lightWordsOf(light) === 1)
  }
  // The kernels are made for every format on a device that grants the tier.
  const f = fakeDevice({
    features: ['texture-formats-tier1'],
    limits: {
      maxStorageBuffersPerShaderStage: 64,
      maxStorageTexturesPerShaderStage: 64,
      maxSampledTexturesPerShaderStage: 64,
      maxBindGroups: 8,
      maxBindingsPerBindGroup: 1000,
      maxUniformBuffersPerShaderStage: 32,
    },
  })
  const device = f.device as unknown as GPUDevice
  for (const light of ALL_FORMATS) {
    fixedKernels(device, 'grey', light)
    directMeshKernel(device, 'colour', light)
    stochasticKernels(device, 'grey', light)
    tracedRadiosityKernels(device, light)
    shapedKernels(device, 8, true, light)
    createCaptureKernels(device, false, light)
  }
  tracedShadowKernels(device, 'grey')
})
