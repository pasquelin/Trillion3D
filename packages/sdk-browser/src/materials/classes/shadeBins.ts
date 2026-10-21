import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { buildComputeStages } from '../../gpu/core/computeStages.ts'
import { MATERIAL_CLASS_KEYS } from '../../visibility/shader/materialClass.ts'
import {
  SHADE_BIN_ARGS,
  SHADE_BIN_ELEMENTS_TABLE,
  SHADE_BIN_GROUP,
  SHADE_BIN_HEAD_WORDS,
  SHADE_BIN_LAYERS,
  SHADE_BIN_META,
  SHADE_BIN_META_WORDS,
  SHADE_BIN_NONE,
  SHADE_BIN_QUAD,
  SHADE_BIN_TILE,
  SHADE_BINS_TABLE,
} from '../../visibility/shader/shadeBinsWgsl.ts'
import { SHADE_BINS_SHADER } from '../../visibility/shader/shadeBinKernelsWgsl.ts'
import type { ShadeBinningMode } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import { shadeOutputLayout } from '../../visibility/passes/shadeLayout.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { createRecordTexture, type RecordTexture } from '../../gpu/core/recordTexture.ts'
import { standInTexture } from '../../gpu/core/standInTexture.ts'
import type { OpenPass } from '../../gpu/core/lazyComputePass.ts'
import type { SurfaceBuffer } from '../surface/surfaceBuffer.ts'
import { FEEDBACK_FORMAT } from '../../scene/targetFormats.ts'
import { groupWidth, groupWidthConstants } from '../../gpu/dispatch/grid.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  sequentialEntries,
} from '../../gpu/core/computeBindings.ts'

/** The bins' kernels, in the order an image dispatches them (`shadeBinsWgsl.ts`). */
const KERNELS = ['clearBins', 'countBins', 'reserveBins', 'scatterBins'] as const

/** The kernels' group: the visibility buffer, the page table, the resolve's uniform, the image's
 *  bin count, the bins' head — read and written — and their elements — written —, the counters and
 *  the dispatches. */
const binsLayoutEntries = () => [
  computeTextureEntry(0, 'uint'),
  computeBufferEntry(1, 'read-only-storage'),
  computeBufferEntry(2, 'uniform'),
  computeBufferEntry(3, 'uniform'),
  computeStorageTextureEntry(4, SHADE_BINS_TABLE.format, 'read-write', '2d-array'),
  computeStorageTextureEntry(5, SHADE_BIN_ELEMENTS_TABLE.format, 'write-only', '2d-array'),
  computeBufferEntry(6, 'storage'),
  computeBufferEntry(7, 'storage'),
]

/**
 * THE SHADING BINS of the image (`../../visibility/shader/shadeBinsWgsl.ts`): the head — the class
 * word of each class key and each bin's mode, rewritten when the classes the image holds or their
 * mode change, the surfaces' layers when they move —; the elements, grown with the image; the
 * counters and each bin's indirect dispatch, written by the kernels each image. Each class then
 * shades its own pixels through one indirect dispatch of its bin (`dispatch`), its group 1 the
 * surfaces' layered targets and the feedback target as storage, the head and the elements
 * (`outputs`). A device that refuses a kernel refuses the material pass by name: no class shades
 * without its bin.
 */
export async function createShadeBins(device: GPUDevice) {
  const module = await createCheckedShaderModule(device, SHADE_BINS_SHADER, 'SHADE_BINS')
  const layout = device.createBindGroupLayout({ entries: binsLayoutEntries() })
  const constants = groupWidthConstants(groupWidth(device.limits))
  const stages = await buildComputeStages(device, [layout], module, KERNELS, constants)
  const buffer = (label: string, size: number, usage: number) =>
    device.createBuffer({ label: `Trillion3D shading bins ${label}`, size, usage })
  const count = buffer('count', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    work = buffer('counters', (1 + 2 * MATERIAL_CLASS_KEYS) * 4, GPUBufferUsage.STORAGE),
    args = buffer(
      'dispatches',
      MATERIAL_CLASS_KEYS * SHADE_BIN_ARGS * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
    )
  const stored = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING
  const head = createRecordTexture(
    device,
    SHADE_BINS_TABLE,
    SHADE_BIN_HEAD_WORDS,
    stored | GPUTextureUsage.COPY_DST,
  )
  const elements = createRecordTexture(
    device,
    SHADE_BIN_ELEMENTS_TABLE,
    1,
    stored | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
  )
  // What the classes bind where the frame has no feedback target: their store of it is folded
  // away (`FEEDBACK`).
  const noFeedback = standInTexture(device, 'Trillion3D feedback stand-in', FEEDBACK_FORMAT, {
    storage: true,
  })
  const b: Bins = {
    ...{ device, layout, stages, count, work, args, head, elements, noFeedback },
    ...{ noFeedbackView: noFeedback.createView(), classes: new Uint32Array(MATERIAL_CLASS_KEYS) },
    ...{ modes: new Uint32Array(SHADE_BIN_META_WORDS * MATERIAL_CLASS_KEYS), quads: false },
    ...{ layers: Uint32Array.of(SHADE_BIN_NONE), held: [], counted: new Uint32Array(4) },
    ...{ binsGroup: undefined, outputGroup: undefined },
    ...{ binsBound: createWebgpuBindIdentity(), outputBound: createWebgpuBindIdentity() },
  }
  b.classes.fill(SHADE_BIN_NONE)
  return {
    /** Gives each class key of `keys` its bin, in order, of quads with `quads`
     *  (`shadeBinningQuads`); the head and the count go up when either changed. */
    assign: (keys: readonly number[], quads: boolean) => assign(b, keys, quads),
    /** Holds the elements of a `width` × `height` image — a word a pixel, two a quad where the bins
     *  hold quads —, refused by name past the device. */
    layFor(width: number, height: number) {
      if (!elements.hold(width * height * (b.quads ? 2 : 1)))
        throw new Error('SHADE_BINS_UNAVAILABLE')
    },
    /** The bins of the `width` × `height` image of the visibility buffer `vis` — its page table
     *  `pages`, the resolve's uniform `uniform` —, as dispatches of the frame's compute pass:
     *  cleared, counted, reserved, scattered. Returns the dispatches. */
    encode: (
      open: OpenPass,
      vis: GPUTextureView,
      pages: GPUBuffer,
      uniform: GPUBuffer,
      width: number,
      height: number,
    ) => encodeBins(b, open, vis, pages, uniform, width, height),
    /** The classes' group 1 on `surfaces` and the feedback target `feedback`, if the frame has one;
     *  the head names the surfaces' layers (`SurfaceBuffer.layers`). */
    outputs: (surfaces: SurfaceBuffer, feedback: GPUTextureView | undefined) =>
      outputs(b, surfaces, feedback),
    /** Shades class `at` of the keys assigned: the indirect dispatch its bin's reservation wrote. */
    dispatch(pass: GPUComputePassEncoder, at: number) {
      pass.dispatchWorkgroupsIndirect(args, at * SHADE_BIN_ARGS * 4)
    },
    dispose() {
      for (const made of [count, work, args, head, elements, noFeedback]) made.destroy()
    },
  }
}

/**
 * Whether a class's bin holds quads under the binning mode `mode`, the reference's rule: under
 * `auto` a class whose shading reads a neighbour's derivative is binned by quad, any other by
 * pixel; `pixel` and `quad` force one. No class of ours reads a neighbour's derivative — every
 * gradient is its triangle's own (`uvGradients`) —: under `auto` its bin holds pixels.
 */
export const shadeBinningQuads = (mode: ShadeBinningMode) => mode === 'quad'

type Bins = {
  device: GPUDevice
  layout: GPUBindGroupLayout
  stages: Record<(typeof KERNELS)[number], GPUComputePipeline>
  count: GPUBuffer
  work: GPUBuffer
  args: GPUBuffer
  head: RecordTexture
  elements: RecordTexture
  noFeedback: GPUTexture
  noFeedbackView: GPUTextureView
  /** The class word of each class key, as the head holds it. */
  classes: Uint32Array<ArrayBuffer>
  /** Each bin's words of the head, its mode among them, as the head holds them. */
  modes: Uint32Array<ArrayBuffer>
  /** Whether the bins hold quads. */
  quads: boolean
  /** The surfaces' layers, as the head holds them. */
  layers: Uint32Array<ArrayBuffer>
  /** The keys the head holds bins of, in their bins' order. */
  held: readonly number[]
  /** The image's bin count, as its uniform holds it. */
  counted: Uint32Array<ArrayBuffer>
  binsGroup: GPUBindGroup | undefined
  outputGroup: GPUBindGroup | undefined
  binsBound: WebgpuBindIdentity
  outputBound: WebgpuBindIdentity
}

/** The bins of `keys`, of quads with `quads`, written over those of the keys held: the class words
 *  go up whole — a class set changes seldom, they are one write —, the bins' mode words, and the
 *  count. */
function assign(b: Bins, keys: readonly number[], quads: boolean) {
  if (sameValues(b.held, keys) && b.quads === quads) return
  const flag = quads ? SHADE_BIN_QUAD : 0
  for (const key of b.held) b.classes[key] = SHADE_BIN_NONE
  keys.forEach((key, bin) => {
    b.classes[key] = (bin | flag) >>> 0
    b.modes[SHADE_BIN_META_WORDS * bin + 2] = quads ? 1 : 0
  })
  b.head.write('Word', 0, MATERIAL_CLASS_KEYS, b.classes.buffer, 0)
  b.head.write('Word', SHADE_BIN_META, SHADE_BIN_META_WORDS * keys.length, b.modes.buffer, 0)
  b.counted[0] = keys.length
  b.device.queue.writeBuffer(b.count, 0, b.counted)
  b.held = keys.slice()
  b.quads = quads
}

function encodeBins(
  b: Bins,
  open: OpenPass,
  vis: GPUTextureView,
  pages: GPUBuffer,
  uniform: GPUBuffer,
  width: number,
  height: number,
) {
  const { binsBound: bound, stages } = b
  bound.next[0] = vis
  bound.next[1] = pages
  bound.next[2] = uniform
  bound.next[3] = b.elements.view
  if (bound.moved() || !b.binsGroup)
    b.binsGroup = b.device.createBindGroup({
      layout: b.layout,
      entries: sequentialEntries([
        vis,
        { buffer: pages },
        { buffer: uniform },
        { buffer: b.count },
        b.head.view,
        b.elements.view,
        { buffer: b.work },
        { buffer: b.args },
      ]),
    })
  const pass = open.pass,
    lanes = ceilDiv(b.held.length, SHADE_BIN_GROUP),
    tilesX = ceilDiv(width, SHADE_BIN_TILE),
    tilesY = ceilDiv(height, SHADE_BIN_TILE)
  pass.setBindGroup(0, b.binsGroup)
  pass.setPipeline(stages.clearBins)
  pass.dispatchWorkgroups(lanes)
  pass.setPipeline(stages.countBins)
  pass.dispatchWorkgroups(tilesX, tilesY)
  pass.setPipeline(stages.reserveBins)
  pass.dispatchWorkgroups(lanes)
  pass.setPipeline(stages.scatterBins)
  pass.dispatchWorkgroups(tilesX, tilesY)
  return KERNELS.length
}

/** The classes' group 1: the surfaces' two layered targets, the feedback target's or its stand-in,
 *  the bins' head and elements; made again when one of them is another. The head's word of the
 *  surfaces' layers goes up when they moved. */
function outputs(b: Bins, surfaces: SurfaceBuffer, feedback: GPUTextureView | undefined) {
  const [colours, words] = surfaces.stores()
  if (b.layers[0] !== surfaces.layers) {
    b.layers[0] = surfaces.layers
    b.head.write('Word', SHADE_BIN_LAYERS, 1, b.layers.buffer, 0)
  }
  const { next } = b.outputBound
  next[0] = colours
  next[1] = words
  next[2] = feedback ?? b.noFeedbackView
  next[3] = b.head.view
  next[4] = b.elements.view
  if (b.outputBound.moved() || !b.outputGroup)
    b.outputGroup = b.device.createBindGroup({
      layout: shadeOutputLayout(b.device),
      entries: sequentialEntries(next as GPUBindingResource[]),
    })
  return b.outputGroup
}

export type ShadeBins = Awaited<ReturnType<typeof createShadeBins>>
