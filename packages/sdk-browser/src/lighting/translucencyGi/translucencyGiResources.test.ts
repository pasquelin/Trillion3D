// The translucency global illumination volume's frame and resources: the frame's layout and the eye's travel, the volume's textures, the views the
// surfaces read and the kernels within WebGPU's default limits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { TRANSLUCENCY_GI_RULES } from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { withinDefaults } from '../../gpu/core/stageLimits.fixture.ts'
import { pipelinesSettled } from '../deferred/compileLedger.ts'
import { translucencyGiKernels } from './kernels.ts'
import { translucencyGiView } from './frame.ts'
import { createGiResources } from './resources.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { writeGiFrame, type GiCacheRead, type TranslucencyGiState } from './gpu.ts'
import { TRANSLUCENCY_GI_FRAME, translucencyGiAmbientFormat, translucencyGiGrid } from './layout.ts'
import { WORD_LIGHT_FORMAT } from '../../gpu/core/lightAtlasFormat.ts'

const values = resolveSettings(TRANSLUCENCY_GI_RULES, {})

test('the frame the passes read has one layout: the struct and its words', () => {
  assert.equal(TRANSLUCENCY_GI_FRAME.words % 4, 0)
  assert.equal(TRANSLUCENCY_GI_FRAME.at.previous % 4, 0)
  assert.match(TRANSLUCENCY_GI_FRAME.wgsl, /previous:mat4x4f/)
  assert.match(TRANSLUCENCY_GI_FRAME.wgsl, /eyeMoved:vec4f/)
})

test('the history is carried by the eye’s travel, taken in double precision', () => {
  let words = new Float32Array(0)
  const device = {
    queue: {
      writeBuffer: (_: unknown, __: number, data: ArrayBuffer) =>
        (words = new Float32Array(data.slice(0))),
    },
  } as unknown as GPUDevice
  const state = {
    resources: { frame: {} },
    previous: new Float32Array(16),
    previousEye: Float64Array.of(1e6, 2e6, -3e6),
  } as unknown as TranslucencyGiState
  const image = {
    width: 64,
    height: 64,
    near: 0.1,
    preExposure: 1,
    frame: 0,
    history: true,
    eye: [1e6 + 0.25, 2e6, -3e6 + 0.5],
    viewProjection: new Float32Array(16),
    inverse: new Float32Array(16),
  }
  const read: GiCacheRead = {
    cached: true,
    bias: 0,
    cache: { radiusScale: 10, resolution: 8, mipmaps: 3, sky: false },
  }
  writeGiFrame(device, state, translucencyGiGrid(values, 64, 64, 0.1, 80), values, image, read)
  const at = TRANSLUCENCY_GI_FRAME.at.eyeMoved
  // Single precision holds a million to a sixteenth: the travel is the difference of the doubles, not of two rounded eyes.
  assert.deepEqual([...words.slice(at, at + 3)], [0.25, 0, 0.5])
  // The cache read is the volume's own: its radius scale, its maps' side and levels of detail, no sky apart.
  const cache = TRANSLUCENCY_GI_FRAME.at.cache
  assert.deepEqual([...words.slice(cache, cache + 4)], [10, 8, 3, 0])
})

test('the volume the surfaces read is one texture twice as deep as the grid, the ambient and the directional light stacked, in half floats or in single floats where the ambient light is', () => {
  // The ambient light follows the cones’ format; single floats are kept where the device filters them, half floats where it does not,
  // since the surfaces read the volume through a filtering sampler. The volume holds both lights in one format.
  const filters = new Set(['float32-filterable'])
  const plain = new Set<string>()
  assert.equal(translucencyGiAmbientFormat('rg11b10ufloat', plain), 'rg11b10ufloat')
  assert.equal(translucencyGiAmbientFormat('rgba16float', filters), 'rgba16float')
  assert.equal(translucencyGiAmbientFormat('rgba32float', filters), 'rgba32float')
  assert.equal(translucencyGiAmbientFormat('rgba32float', plain), 'rgba16float')
  const grid = translucencyGiGrid(values, 1920, 1080, 0.1, 80)
  for (const [cones, volume, features] of [
    ['rgba16float', 'rgba16float', ['texture-formats-tier1']],
    ['rg11b10ufloat', 'rgba16float', ['texture-formats-tier1']],
    ['rgba32float', 'rgba32float', ['texture-formats-tier1', 'float32-filterable']],
    ['rgba32float', 'rgba16float', ['texture-formats-tier1']],
  ] as const) {
    const { device, textures } = fakeDevice({ features: [...features] })
    const resources = createGiResources(device as unknown as GPUDevice, grid, 3, cones)
    const named = (prefix: string) => textures.filter((t) => t.label?.includes(prefix))
    // Two take turns, each twice the grid’s depth; the fog’s volume is of the same shape, in half floats.
    assert.equal(resources.volumes.length, 2)
    assert.deepEqual(
      named('volume ')
        .filter((t) => !t.label?.includes('fog'))
        .map((t) => [t.width, t.height, t.depthOrArrayLayers, t.format]),
      [
        [60, 34, 52, volume],
        [60, 34, 52, volume],
      ],
    )
    const [fog] = named('fog volume')
    assert.deepEqual([fog.format, fog.depthOrArrayLayers], ['rgba16float', 52])
    resources.destroy()
  }
})

test('the surfaces read the image’s volume, one half-float one-cell stand-in per device where none is made', () => {
  const rt = { gpu: {}, context: {} } as unknown as WebgpuPagesRuntime
  const half = fakeDevice({ features: ['texture-formats-tier1'] })
  const view = translucencyGiView(rt, half.device as unknown as GPUDevice)
  assert.equal((view as unknown as { format: string }).format, 'rgba16float')
  assert.equal(
    translucencyGiView(rt, half.device as unknown as GPUDevice),
    view,
    'one for the device',
  )
  // The format the setting asks for does not change it: a sampled 3D float texture binds any filterable float format.
  const asked = {
    gpu: {},
    context: { translucencyGiLightingDataFormat: 'r11g11b10' },
  } as unknown as WebgpuPagesRuntime
  assert.equal(translucencyGiView(asked, half.device as unknown as GPUDevice), view)
  const texture = (
    view as unknown as {
      texture: { width: number; depthOrArrayLayers: number; dimension: string }
    }
  ).texture
  assert.deepEqual([texture.width, texture.depthOrArrayLayers, texture.dimension], [1, 1, '3d'])
  // A volume made is what the surfaces read.
  const volume = {} as GPUTextureView
  const made = {
    gpu: { translucencyGi: { published: { volume } } },
    context: {},
  } as unknown as WebgpuPagesRuntime
  assert.equal(translucencyGiView(made, half.device as unknown as GPUDevice), volume)
})

test('the kernels fit WebGPU’s default limits and are built on their layouts', async () => {
  // A device that stores the packed format (`texture-formats-tier1`), the one the frame packs the cones on.
  const { device, pipelineLayouts: layouts } = fakeDevice({ features: ['texture-formats-tier1'] })
  // The kernels are asked of the device as a frame asks them, off the frame, and awaited as the frame gate awaits them.
  for (const format of ['rgba16float', 'rg11b10ufloat', 'rgba32float'] as const) {
    assert.equal(translucencyGiKernels(device, format, WORD_LIGHT_FORMAT), undefined)
    await pipelinesSettled(device)
    const kernels = translucencyGiKernels(device, format, WORD_LIGHT_FORMAT)!
    assert.deepEqual(Object.keys(kernels).sort(), ['filter', 'integrate', 'mark', 'trace'])
  }
  withinDefaults(layouts, 'the translucency global illumination volume')
})
