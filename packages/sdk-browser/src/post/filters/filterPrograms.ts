import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { preparedPipelines } from '../../gpu/core/preparedPipelines.ts'
import { fullscreenDescriptor, preparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { DOWNSAMPLE_WGSL } from './downsampleWgsl.ts'
import { GAUSSIAN_WGSL } from './gaussianWgsl.ts'
import { DOWNSAMPLE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'

/** The shader entry of each filter. */
type Entry = 'halve' | 'halveWide' | 'blurTaps'

/** The pipelines a reader of the filters needs: each filter's entry and the format it writes. */
export type FilterPairs = readonly (readonly [Entry, GPUTextureFormat])[]

/** The layouts of the filters' groups: the downsample's — an image, its sampler, the uniform — and
 *  the blur's, which reads a second image besides. */
function filterLayouts(device: GPUDevice) {
  const fragment = GPUShaderStage.FRAGMENT
  const entries = [
    computeTextureEntry(0, 'float', '2d', fragment),
    computeSamplerEntry(1, 'filtering', fragment),
    computeUniformEntry(2, {}, fragment),
  ]
  const layoutOf = (label: string, more: GPUBindGroupLayoutEntry[]) =>
    device.createBindGroupLayout({
      label: `${DOWNSAMPLE_PASS} ${label}`,
      entries: [...entries, ...more],
    })
  return {
    down: layoutOf('down', []),
    blur: layoutOf('blur', [computeTextureEntry(3, 'float', '2d', fragment)]),
  }
}

/**
 * The filters of the post chain's programs once a device: the downsample (`halve`, `halveWide`)
 * and the Gaussian blur's pass (`blurTaps`), each a pipeline prepared off the thread
 * (`PreparedPipeline`) at the format it writes, the layouts of their groups, and the bilinear
 * sampler, clamping to the edge, and the empty image they share — the image an unused slot reads.
 * Both the bloom (`../effects/webgpuBloom.ts`) and the local exposure (`../finish/local.ts`)
 * filter through them, asking, preparing and waiting for their pipelines by `FilterPairs`.
 */
export const filterPrograms = oncePerDevice((device: GPUDevice) => {
  const layouts = filterLayouts(device)
  const downLabel = `${DOWNSAMPLE_PASS} down`,
    blurLabel = `${DOWNSAMPLE_PASS} blur`
  const modules = {
    down: device.createShaderModule({ label: downLabel, code: DOWNSAMPLE_WGSL }),
    blur: device.createShaderModule({ label: blurLabel, code: GAUSSIAN_WGSL }),
  }
  // Each pipeline made at the first ask, then found by its format within its entry's table.
  const tableOf = (entry: Entry) => {
    const kind = entry === 'blurTaps' ? 'blur' : 'down'
    const [module, layout] = [modules[kind], layouts[kind]]
    return preparedPipelines((format: GPUTextureFormat) => {
      const label = `${DOWNSAMPLE_PASS} ${entry} ${format}`
      const targets = [{ format }]
      return preparedPipeline(
        device,
        fullscreenDescriptor(device, module, layout, entry, targets, label),
      )
    })
  }
  const tables = {
    halve: tableOf('halve'),
    halveWide: tableOf('halveWide'),
    blurTaps: tableOf('blurTaps'),
  }
  const empty = device.createTexture({
    label: `${DOWNSAMPLE_PASS} empty`,
    size: { width: 1, height: 1 },
    format: HDR_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  return {
    layouts,
    /** The pipeline of `entry` writing `format`. */
    pipeline: (entry: Entry, format: GPUTextureFormat) => tables[entry].of(format),
    /** Asks the pipelines `pairs` name off the thread, the frames held until they landed. */
    ask(pairs: FilterPairs) {
      for (const [entry, format] of pairs) tables[entry].of(format).ask()
    },
    /** Whether the pipelines `pairs` name are compiled. */
    ready(pairs: FilterPairs) {
      for (const [entry, format] of pairs) if (!tables[entry].of(format).ready) return false
      return true
    },
    /** Resolves once the pipelines `pairs` name are compiled. */
    prepare: (pairs: FilterPairs) =>
      Promise.all(pairs.map(([entry, format]) => tables[entry].of(format).prepare())),
    /** Bilinear, clamping to the edge. */
    clamped: device.createSampler({
      label: `${DOWNSAMPLE_PASS} clamp`,
      magFilter: 'linear',
      minFilter: 'linear',
    }),
    /** A 1 × 1 image of zeros: what an unused slot of a group is bound to. */
    empty: empty.createView(),
  }
})
