import {
  TAA_RESOLVE_HISTORY_PASS,
  TAA_RESOLVE_LAYERS_PASS,
} from '../../diagnostic/stage/passLabels.ts'
import { FILTER_FORMAT } from '../../blend/display/displayFilter.ts'
import {
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
  namedEntries,
} from '../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import type { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import {
  RESOLVE_BINDINGS,
  RESOLVE_LAYER_BINDINGS,
  RESOLVE_TILE,
  resolveHistoryShader,
  resolveLayersShader,
} from './historyResolveWgsl.ts'
import { keptTexture } from './keptTexture.ts'
import type { HistoryFrame } from './historyTargets.ts'
import type { DisplayLayers } from './layers.ts'
import type { AccumulatedImage } from '../../lighting/deferred/program.ts'

/** Bytes of the resolved image of a `width × height` display: its colour, in `colorFormat` (the
 *  history's, `HistoryFormats.color`). */
export const outputBytes = (width: number, height: number, colorFormat: GPUTextureFormat) =>
  width * height * texelBytesOf(colorFormat)

/** The display's size, which the resolve's targets are made at. */
type DisplaySize = { width: number; height: number }

/** A compute stage of the resolve, under the label of its entry. */
const resolveStage = (
  device: GPUDevice,
  bind: GPUBindGroupLayout,
  code: string,
  entry: string,
  constants?: Record<string, number>,
) =>
  preparedComputeStage(
    device,
    device.createPipelineLayout({ bindGroupLayouts: [bind] }),
    device.createShaderModule({ label: `TAA_${entry}`, code }),
    entry,
    constants,
    `TAA_${entry}`,
  )

/** A target of the resolve, kept in `kept` until it is retired; returns its view. */
const resolveTarget = (
  device: GPUDevice,
  kept: GPUTexture[],
  label: string,
  format: GPUTextureFormat,
  width: number,
  height: number,
) => {
  return keptTexture(device, kept, {
    label,
    size: { width, height },
    format,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  }).createView()
}

/** The colour's bind group layout for a colour format. */
const colourLayoutOf = (device: GPUDevice, colorFormat: GPUTextureFormat) =>
  device.createBindGroupLayout({
    entries: [
      computeUniformEntry(RESOLVE_BINDINGS.view),
      computeTextureEntry(RESOLVE_BINDINGS.history, 'float'),
      computeStorageTextureEntry(RESOLVE_BINDINGS.color, colorFormat),
      // The half-size image in the history's colour format: four bytes a texel (11-11-10 floats)
      // where the device stores to them, else half floats.
      computeStorageTextureEntry(RESOLVE_BINDINGS.half, colorFormat),
    ],
  })

/** The group kept under `key`, made by `make` the first time it is asked. */
const groupFor = (
  groups: Map<GPUTextureView, GPUBindGroup>,
  key: GPUTextureView,
  make: () => GPUBindGroup,
) => {
  let group = groups.get(key)
  if (!group) groups.set(key, (group = make()))
  return group
}

/** A compute pass of the resolve over the display's `size`. */
const dispatchResolve = (
  steps: ComputeRun,
  pass: GPUComputePassDescriptor,
  pipeline: GPUComputePipeline | undefined,
  group: GPUBindGroup,
  size: DisplaySize,
) => {
  if (!pipeline) return
  const compute = steps.pass(pass)
  compute.setPipeline(pipeline)
  compute.setBindGroup(0, group)
  compute.dispatchWorkgroups(ceilDiv(size.width, RESOLVE_TILE), ceilDiv(size.height, RESOLVE_TILE))
}

/**
 * The colour's layouts and programs by colour format, made at the first that asks: without the
 * half-size image, then with it.
 */
function createColourPrograms(device: GPUDevice) {
  const colours = new Map<
    GPUTextureFormat,
    { layout: GPUBindGroupLayout; stages: ReturnType<typeof resolveStage>[] }
  >()
  return (colorFormat: GPUTextureFormat) => {
    let made = colours.get(colorFormat)
    if (!made) {
      const layout = colourLayoutOf(device, colorFormat)
      const code = resolveHistoryShader(colorFormat)
      made = {
        layout,
        stages: [
          resolveStage(device, layout, code, 'resolveHistory', { HALF: 0 }),
          resolveStage(device, layout, code, 'resolveHistory', { HALF: 1 }),
        ],
      }
      colours.set(colorFormat, made)
    }
    return made
  }
}

/** The colour resolve's group over the history frame's `history` colour, the target `color` and the
 *  half-size image `halfView`. */
function colourGroup(
  device: GPUDevice,
  uniform: GPUBuffer,
  layout: GPUBindGroupLayout,
  history: GPUTextureView,
  color: GPUTextureView,
  halfView: GPUTextureView,
) {
  return device.createBindGroup({
    layout,
    entries: namedEntries(RESOLVE_BINDINGS, {
      view: { buffer: uniform },
      history,
      color,
      half: halfView,
    }),
  })
}

/**
 * The colour of the resolve: the display's image in the history's colour format, and the half-size
 * image beside it when asked.
 */
function createColourResolve(device: GPUDevice, uniform: GPUBuffer) {
  const colourOf = createColourPrograms(device)
  const textures: GPUTexture[] = []
  const size = { width: 0, height: 0 }
  let format: GPUTextureFormat | undefined
  let image: { color: GPUTextureView } | undefined
  /** The groups by the history frame's colour. */
  const groups = new Map<GPUTextureView, GPUBindGroup>()
  const pass = { label: TAA_RESOLVE_HISTORY_PASS }
  return {
    /** The display's size the targets are made at. */
    size,
    /** Bytes of the targets as allocated. */
    get bytes() {
      return textures.length && format ? outputBytes(size.width, size.height, format) : 0
    },
    /** Asks every program for the colour format allocated, off the frame. */
    ask: () => {
      if (format) colourOf(format).stages.forEach((variant) => variant.ask())
    },
    /** Makes the target at the display's `width × height` in `colorFormat`. */
    allocate(width: number, height: number, colorFormat: GPUTextureFormat) {
      size.width = width
      size.height = height
      format = colorFormat
      image = {
        color: resolveTarget(device, textures, 'Trillion3D TAA output', colorFormat, width, height),
      }
    },
    drop() {
      for (const texture of textures) retire(device, texture)
      textures.length = 0
      image = undefined
      groups.clear()
    },
    /** The program of the resolve, writing the half-size image when `half`: none before `allocate`. */
    stage: (half: boolean) => format && colourOf(format).stages[half ? 1 : 0],
    /** Encodes the resolve of `frame`, writing the half-size image `halfView` when `half`. Returns
     *  the resolved colour. */
    encode(steps: ComputeRun, frame: HistoryFrame, halfView: GPUTextureView, half: boolean) {
      if (!image || !format) throw new Error('TAA_OUTPUT_MISSING')
      const colour = colourOf(format)
      const { color } = image
      const group = groupFor(groups, frame.color, () =>
        colourGroup(device, uniform, colour.layout, frame.color, color, halfView),
      )
      dispatchResolve(steps, pass, colour.stages[half ? 1 : 0].get(), group, size)
      return color
    },
  }
}

/**
 * The display layers of the resolve, in a second pass over the same kernel: their targets are made
 * at the first image that resolves some, at the display's size, and given back with `drop`.
 */
function createLayersResolve(device: GPUDevice) {
  const layersLayout = device.createBindGroupLayout({
    entries: [
      computeTextureEntry(RESOLVE_LAYER_BINDINGS.tintHistory, 'float'),
      computeTextureEntry(RESOLVE_LAYER_BINDINGS.addHistory, 'float'),
      computeStorageTextureEntry(RESOLVE_LAYER_BINDINGS.tint, FILTER_FORMAT),
      computeStorageTextureEntry(RESOLVE_LAYER_BINDINGS.add, FILTER_FORMAT),
    ],
  })
  const stage = resolveStage(device, layersLayout, resolveLayersShader(), 'resolveLayers')
  const textures: GPUTexture[] = []
  let views: DisplayLayers | undefined
  let counted = 0
  /** The groups by their history's tint. */
  const groups = new Map<GPUTextureView, GPUBindGroup>()
  const pass = { label: TAA_RESOLVE_LAYERS_PASS }
  const bytes = (size: DisplaySize) =>
    textures.length ? 2 * size.width * size.height * texelBytesOf(FILTER_FORMAT) : 0
  const made = (label: string, { width, height }: DisplaySize) =>
    resolveTarget(device, textures, `Trillion3D TAA output ${label}`, FILTER_FORMAT, width, height)
  return {
    /** Bytes of the targets as allocated, at the display's `size`. */
    bytes,
    /** The bytes the targets made since last asked: what the frame's target bytes add. */
    uncounted: (size: DisplaySize) => -counted + (counted = bytes(size)),
    ask: () => stage.ask(),
    stage,
    /** The targets given back, made again by the next image that resolves layers. */
    drop() {
      for (const texture of textures) retire(device, texture)
      textures.length = counted = 0
      views = undefined
      groups.clear()
    },
    /** Encodes the layers' resolve of `history`, the targets made by the first. Returns their
     *  views. */
    encode(steps: ComputeRun, history: DisplayLayers, size: DisplaySize) {
      if (!views) {
        views = [made('tint', size), made('added value', size)]
        groups.clear()
      }
      const [tint, add] = views
      const group = groupFor(groups, history[0], () =>
        device.createBindGroup({
          layout: layersLayout,
          entries: namedEntries(RESOLVE_LAYER_BINDINGS, {
            tintHistory: history[0],
            addHistory: history[1],
            tint,
            add,
          }),
        }),
      )
      dispatchResolve(steps, pass, stage.get(), group, size)
      return views
    },
  }
}

/**
 * THE HISTORY'S RESOLVE: where the history is larger than the display, the image brought down to
 * the display's size (`resolveHistoryShader`), colour — in the history's colour format, as the
 * history of the display's size keeps it —, the half-size image the scene's chain reads beside it
 * when asked, and, in a second pass over the same kernel, the display
 * layers (`resolveLayersShader`). Its targets are made at the display's size (`allocate`) and stay
 * until the history is another size, the layers' at the first image that resolves some; its
 * programs are asked off the frame (`ask`). The half-size image is the history targets' own
 * (`historyTargets.ts`), which the update writes at the display's size.
 */
export function createHistoryResolve(device: GPUDevice, uniform: GPUBuffer) {
  const colour = createColourResolve(device, uniform)
  const layers = createLayersResolve(device)
  const resolved = {} as AccumulatedImage
  const resolve = {
    /** Bytes of the targets as allocated. */
    get bytes() {
      return colour.bytes + layers.bytes(colour.size)
    },
    /** Bytes of the layers' targets alone. */
    get layerBytes() {
      return layers.bytes(colour.size)
    },
    /** The bytes the layers' targets made since last asked: what the frame's target bytes add. */
    uncounted: () => layers.uncounted(colour.size),
    /** Asks every program of the pass for the colour format allocated, off the frame. */
    ask: () => {
      colour.ask()
      layers.ask()
    },
    /** The programs of the resolve of an image, its display layers where `filtered`, the half-size
     *  image written where `half`: the chain's, which the history update's output goes through. */
    stages: (filtered: boolean, half: boolean) => [
      colour.stage(half),
      filtered ? layers.stage : undefined,
    ],
    /** Makes the targets at the display's `width × height`, the colour in `colorFormat`, the former
     *  ones dropped. */
    allocate(width: number, height: number, colorFormat: GPUTextureFormat) {
      resolve.drop()
      colour.allocate(width, height, colorFormat)
    },
    drop() {
      colour.drop()
      layers.drop()
    },
    /** The layers' targets given back, made again by the next image that resolves layers. */
    dropLayers() {
      layers.drop()
    },
    /**
     * Encodes the resolve of `frame`, its display layers `history` where there are some (the
     * layers' targets made by the first), writing the half-size image `halfView` when `half`.
     * Returns the resolved image, one object the pass rewrites at each image.
     */
    encode(
      steps: ComputeRun,
      frame: HistoryFrame,
      history: DisplayLayers | undefined,
      halfView: GPUTextureView,
      half: boolean,
    ): AccumulatedImage {
      resolved.color = colour.encode(steps, frame, halfView, half)
      resolved.filter = history && layers.encode(steps, history, colour.size)
      resolved.half = half ? halfView : undefined
      return resolved
    },
    dispose() {
      resolve.drop()
    },
  }
  return resolve
}

export type HistoryResolve = ReturnType<typeof createHistoryResolve>
