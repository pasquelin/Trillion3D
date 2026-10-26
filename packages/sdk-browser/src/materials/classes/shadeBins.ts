import { retire } from '../../gpu/core/frameRetire.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import {
  buildComputeStage,
  buildComputeStages,
  preparedComputeStage,
} from '../../gpu/core/computeStages.ts'
import { pipelineLayoutOf, type PreparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { MATERIAL_CLASS_KEYS } from '../../visibility/shader/materialClass.ts'
import {
  SHADE_BIN_ARGS,
  SHADE_BIN_ELEMENTS_TABLE,
  SHADE_BIN_GROUP,
  SHADE_BIN_HEAD_WORDS,
  SHADE_BIN_LAYERS,
  SHADE_BIN_META_QUADS,
  SHADE_BIN_META_WORDS,
  SHADE_BIN_NONE,
  SHADE_BIN_QUAD,
  SHADE_BIN_TILE,
  SHADE_BINS_TABLE,
  SHADING_MASK_BIN_BITS,
} from '../../visibility/shader/shadeBinsWgsl.ts'
import {
  MASK_BINDINGS,
  SHADE_BINS_SHADER,
  SHADE_BIN_SUBGROUP_LANES,
  SHADE_BINS_SUBGROUP_SHADERS,
} from '../../visibility/shader/shadeBinKernelsWgsl.ts'
import { uniformSubgroupLanes } from '../../gpu/core/subgroups.ts'
import type { ShadeBinningMode } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import { shadeOutputLayout } from '../../visibility/passes/shadeLayout.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { createRecordTexture, type RecordTexture } from '../../gpu/core/recordTexture.ts'
import { grownByCopy } from '../../gpu/core/tableGrowth.ts'
import { standInTexture } from '../../gpu/core/standIns.ts'
import type { OpenPass } from '../../gpu/core/lazyComputePass.ts'
import type { SurfaceBuffer } from '../surface/surfaceBuffer.ts'
import { FEEDBACK_FORMAT } from '../../scene/targetFormats.ts'
import { groupWidth, groupWidthConstants } from '../../gpu/dispatch/grid.ts'
import { ceilDiv, nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  sequentialEntries,
} from '../../gpu/core/computeBindings.ts'

/** The bins' kernels, in the order an image dispatches them (`shadeBinsWgsl.ts`). */
const KERNELS = ['clearBins', 'countBins', 'reserveBins', 'scatterBins'] as const
/** The kernels that walk the pixels, built again for the image whose bins hold quads. */
const WALKS = ['countBins', 'scatterBins'] as const

/** The kernels' group: the shading masks, the image's bin count, the bins' meta and their
 *  elements — written —, the counters and the dispatches. */
const binsLayoutEntries = () => [
  computeTextureEntry(0, 'uint'),
  computeBufferEntry(1, 'uniform'),
  computeBufferEntry(2, 'storage'),
  computeStorageTextureEntry(3, SHADE_BIN_ELEMENTS_TABLE.format, 'write-only', '2d-array'),
  computeBufferEntry(4, 'storage'),
  computeBufferEntry(5, 'storage'),
]

/** The group of `maskBins`, which builds the masks of an image whose identifiers no export classed: its
 *  identifiers, page table, resolve uniform, the bins' head and the masks. */
const maskLayoutEntries = () => [
  computeTextureEntry(MASK_BINDINGS.ids, 'uint'),
  computeBufferEntry(MASK_BINDINGS.pages, 'read-only-storage'),
  computeBufferEntry(MASK_BINDINGS.uniform, 'uniform'),
  computeTextureEntry(MASK_BINDINGS.head, 'uint', '2d-array'),
  computeStorageTextureEntry(MASK_BINDINGS.mask, 'r32uint'),
]
/** Threads a side of `maskBins`' workgroup. */
const MASK_SIDE = 8

/** Bins the counters, the dispatches and the meta hold at first; a larger class set grows them to
 *  the next power of two (`assign`). */
const SHADE_BIN_START_CAPACITY = 256
/** The most bins an image holds: what a shading mask's bin addresses. */
const SHADE_BIN_LIMIT = 2 ** SHADING_MASK_BIN_BITS

/** The bins' counters, meta and dispatch arguments, for `bins` bins. */
function createBinWork(device: GPUDevice, bins: number) {
  const buffer = (label: string, size: number, usage: number) =>
    device.createBuffer({ label: `Trillion3D shading bins ${label}`, size, usage })
  return {
    work: buffer('counters', (1 + 2 * bins) * 4, GPUBufferUsage.STORAGE),
    meta: buffer(
      'meta',
      bins * SHADE_BIN_META_WORDS * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    ),
    args: buffer(
      'dispatches',
      bins * SHADE_BIN_ARGS * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
    ),
  }
}

/** The bins' buffers and textures: the count, the counters, the meta, the dispatch arguments, the
 *  head and the elements, and the stand-in for a frame with no feedback target. */
function createBinTargets(device: GPUDevice) {
  const count = device.createBuffer({
    label: 'Trillion3D shading bins count',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const { work, meta, args } = createBinWork(device, SHADE_BIN_START_CAPACITY)
  // The head is read by the export and the classes, written from the host: it never grows.
  const head = createRecordTexture(
    device,
    SHADE_BINS_TABLE,
    SHADE_BIN_HEAD_WORDS,
    GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  )
  const elements = createRecordTexture(
    device,
    SHADE_BIN_ELEMENTS_TABLE,
    1,
    GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC,
  )
  // What the classes bind where the frame has no feedback target: their store of it is folded
  // away (`FEEDBACK`).
  const noFeedback = standInTexture(device, 'Trillion3D feedback stand-in', FEEDBACK_FORMAT, {
    storage: true,
  })
  return { count, work, meta, args, head, elements, noFeedback }
}

/**
 * THE SHADING BINS of the image (`../../visibility/shader/shadeBinsWgsl.ts`): the head — the class
 * word of each class key, rewritten when the classes the image holds or their mode change, the
 * surfaces' layers when they move —, which the export of the visibility buffer reads to write each
 * pixel's shading mask; the bins' meta, a `vec4u` a bin (its mode from the host, its element count
 * and first word from the kernels); the elements, grown with the image; the counters and each
 * bin's indirect dispatch, written by the kernels each image. Each class then shades its own pixels
 * through one indirect dispatch of its bin (`dispatch`), its group 1 the surfaces' layered targets
 * and the feedback target as storage, the head, the elements and the meta (`outputs`). A device
 * that refuses a kernel refuses the material pass by name: no class shades without its bin.
 *
 * The kernels run on the subgroup where the device's subgroups are the bins' workgroup
 * or its half (`uniformSubgroupLanes`), on the workgroup's barriers otherwise. A mode no bin holds has no pass
 * (`ANY_PIXEL`, `ANY_QUAD`): the walks are built for each mode, the image runs the one `assign` set.
 */
export async function createShadeBins(device: GPUDevice) {
  const subgroupLanes = uniformSubgroupLanes(device, SHADE_BIN_SUBGROUP_LANES)
  const module = await createCheckedShaderModule(
    device,
    subgroupLanes ? SHADE_BINS_SUBGROUP_SHADERS[subgroupLanes] : SHADE_BINS_SHADER,
    'SHADE_BINS',
  )
  const layout = device.createBindGroupLayout({ entries: binsLayoutEntries() })
  const widths = groupWidthConstants(groupWidth(device.limits))
  const modeConstants = (quads: boolean) => ({
    ...widths,
    ANY_PIXEL: quads ? 0 : 1,
    ANY_QUAD: quads ? 1 : 0,
  })
  const maskLayout = device.createBindGroupLayout({ entries: maskLayoutEntries() })
  const [stages, maskStage] = await Promise.all([
    buildComputeStages(device, [layout], module, KERNELS, modeConstants(false)),
    buildComputeStage(device, [maskLayout], module, 'maskBins'),
  ])
  const { count, work, meta, args, head, elements, noFeedback } = createBinTargets(device)
  const b: Bins = {
    ...{
      device,
      layout,
      stages,
      module,
      quadConstants: modeConstants(true),
      maskLayout,
      maskStage,
      count,
      work,
      meta,
      args,
      head,
      elements,
      noFeedback,
    },
    ...{ noFeedbackView: noFeedback.createView(), classes: new Uint32Array(MATERIAL_CLASS_KEYS) },
    ...{ modes: new Uint32Array(SHADE_BIN_META_WORDS * SHADE_BIN_START_CAPACITY), quads: false },
    ...{ capacity: SHADE_BIN_START_CAPACITY },
    ...{ layers: Uint32Array.of(SHADE_BIN_NONE), held: [], counted: new Uint32Array(4) },
    ...{ binsGroup: undefined, outputGroup: undefined, masks: undefined, maskGroup: undefined },
    ...{ binsBound: createWebgpuBindIdentity(), outputBound: createWebgpuBindIdentity() },
    ...{ maskBound: createWebgpuBindIdentity() },
  }
  b.classes.fill(SHADE_BIN_NONE)
  // The head starts at zero: every class word is written once, then only the spans that change.
  head.write('Word', 0, MATERIAL_CLASS_KEYS, b.classes.buffer, 0)
  return {
    /** Gives each class key of `keys` its bin, in order, of quads with `quads`
     *  (`shadeBinningQuads`) once their kernels are compiled; the head, the meta's modes and the count go up when either changed.
     *  Called before the frame submits, so the export of the shading masks reads the bins it set. */
    assign: (keys: readonly number[], quads: boolean) => assign(b, keys, quads),
    /** Holds the elements of a `width` × `height` image — a word a pixel, two a quad where the bins
     *  hold quads —, refused by name past the device. */
    layFor(width: number, height: number) {
      if (!elements.hold(width * height * (b.quads ? 2 : 1)))
        throw new Error('SHADE_BINS_UNAVAILABLE')
    },
    /** The class words the export of the shading masks reads. */
    head: head.view,
    /** The bins of the `width` × `height` image whose shading masks are `mask` (the export wrote
     *  them), as dispatches of the frame's compute pass: cleared, counted, reserved, scattered.
     *  Returns the dispatches. */
    encode: (open: OpenPass, mask: GPUTextureView, width: number, height: number) =>
      encodeBins(b, open, mask, width, height),
    /** As `encode`, for an image whose identifiers `ids` no export classed (a capture's): its masks
     *  are built first, from `ids`, its page table `pages` and the resolve's uniform `uniform`. */
    encodeFromIds: (
      open: OpenPass,
      ids: GPUTextureView,
      pages: GPUBuffer,
      uniform: GPUBuffer,
      width: number,
      height: number,
    ) => encodeFromIds(b, open, ids, pages, uniform, width, height),
    /** The classes' group 1 on `surfaces` and the feedback target `feedback`, if the frame has one;
     *  the head names the surfaces' layers (`SurfaceBuffer.layers`). */
    outputs: (surfaces: SurfaceBuffer, feedback: GPUTextureView | undefined) =>
      outputs(b, surfaces, feedback),
    /** Shades class `at` of the keys assigned: the indirect dispatch its bin's reservation wrote. */
    dispatch(pass: GPUComputePassEncoder, at: number) {
      pass.dispatchWorkgroupsIndirect(b.args, at * SHADE_BIN_ARGS * 4)
    },
    dispose() {
      for (const made of [count, b.work, b.meta, b.args, head, elements, noFeedback]) made.destroy()
      b.masks?.texture.destroy()
    },
  }
}

/**
 * Whether a class's bin holds quads under the binning mode `mode`: `pixel` and `quad` force one;
 * under `auto` a class is binned by quad when its shading takes a derivative of a neighbour, by
 * pixel when it takes none. No class of ours takes one: a program has no screen derivative, and a
 * texture read finds its footprint from its own triangle (`uvGradients`) or from the coordinate
 * evaluated a pixel over (`NEIGHBOURS`, `../../materials/graph/state.ts`) — so under `auto` every
 * bin holds pixels, and only `quad` asks quads.
 */
export const shadeBinningQuads = (mode: ShadeBinningMode) => mode === 'quad'

type Bins = {
  device: GPUDevice
  layout: GPUBindGroupLayout
  stages: Record<(typeof KERNELS)[number], GPUComputePipeline>
  module: GPUShaderModule
  /** The overrides of the kernels that walk the pixels in quads. */
  quadConstants: Record<string, number>
  /** Those kernels, asked the first time an image bins in quads (`quadWalks`), until compiled. */
  quadAsked?: (readonly [(typeof WALKS)[number], PreparedPipeline<GPUComputePipeline>])[]
  /** The kernels that walk the pixels, for the image whose bins hold quads, once compiled. */
  quadStages?: Record<(typeof WALKS)[number], GPUComputePipeline>
  count: GPUBuffer
  work: GPUBuffer
  /** Each bin's meta, a `vec4u`: element count, first word, flags (`SHADE_BIN_META_QUADS`), a spare. */
  meta: GPUBuffer
  args: GPUBuffer
  head: RecordTexture
  elements: RecordTexture
  noFeedback: GPUTexture
  noFeedbackView: GPUTextureView
  /** The class word of each class key, as the head holds it. */
  classes: Uint32Array<ArrayBuffer>
  /** Each bin's meta words, its mode among them, as the host writes them. */
  modes: Uint32Array<ArrayBuffer>
  /** The bins the counters, the dispatches, the meta and `modes` hold. */
  capacity: number
  /** Whether the bins hold quads. */
  quads: boolean
  /** The surfaces' layers, as the head holds them. */
  layers: Uint32Array<ArrayBuffer>
  /** The keys the head holds bins of, in their bins' order. */
  held: readonly number[]
  /** The image's bin count, as its uniform holds it. */
  counted: Uint32Array<ArrayBuffer>
  maskLayout: GPUBindGroupLayout
  maskStage: GPUComputePipeline
  /** The masks `encodeFromIds` builds, of the size asked last. */
  masks: { texture: GPUTexture; view: GPUTextureView; width: number; height: number } | undefined
  binsGroup: GPUBindGroup | undefined
  outputGroup: GPUBindGroup | undefined
  maskGroup: GPUBindGroup | undefined
  binsBound: WebgpuBindIdentity
  outputBound: WebgpuBindIdentity
  maskBound: WebgpuBindIdentity
}

/** Holds `bins` bins: the counters, the meta and the dispatches grown to the next power of two; the
 *  groups that bind them follow (`encodeBins`). */
function holdBins(b: Bins, bins: number) {
  if (bins <= b.capacity) return
  const capacity = nextPow2(bins)
  // The frame's encoder may already name the buffers replaced: they go after its submit.
  const replaced = [b.work, b.meta, b.args]
  Object.assign(b, createBinWork(b.device, capacity))
  grownByCopy(b.device, replaced)
  b.capacity = capacity
  b.modes = new Uint32Array(SHADE_BIN_META_WORDS * capacity)
}

/** The kernels that walk the pixels in quads, compiled off the frame the first time they are asked,
 *  the frames waiting for them (`pipelinesCompiling`); none until every one is (all or nothing:
 *  the bins' mode and the kernels that walk it change together, in `assign`). */
function quadWalks(b: Bins) {
  if (b.quadStages) return b.quadStages
  const asked = (b.quadAsked ??= WALKS.map(
    (name) =>
      [
        name,
        preparedComputeStage(
          b.device,
          pipelineLayoutOf(b.device, [b.layout]),
          b.module,
          name,
          b.quadConstants,
        ).ask(),
      ] as const,
  ))
  const made = asked.map(([, pipeline]) => pipeline.get())
  if (made.some((pipeline) => !pipeline)) return undefined
  return (b.quadStages = Object.fromEntries(
    asked.map(([name], at) => [name, made[at]]),
  ) as NonNullable<Bins['quadStages']>)
}

/** The bins of `keys`, of quads with `quads` (where `wantsQuads` and every kernel of
 *  `quadWalks` is compiled, else one by one), written over those of the keys held: the class words
 *  of the keys that came or went — one write over their span —, the bins' modes, and the count. */
function assign(b: Bins, keys: readonly number[], wantsQuads: boolean) {
  const quads = wantsQuads && !!quadWalks(b)
  if (sameValues(b.held, keys) && b.quads === quads) return
  if (keys.length > SHADE_BIN_LIMIT) throw new Error('SHADE_BINS_UNAVAILABLE')
  holdBins(b, keys.length)
  const flag = quads ? SHADE_BIN_QUAD : 0
  let first = MATERIAL_CLASS_KEYS,
    last = -1
  const touch = (key: number) => {
    first = Math.min(first, key)
    last = Math.max(last, key)
  }
  for (const key of b.held) {
    b.classes[key] = SHADE_BIN_NONE
    touch(key)
  }
  keys.forEach((key, bin) => {
    b.classes[key] = (bin | flag) >>> 0
    b.modes[SHADE_BIN_META_WORDS * bin + 2] = quads ? SHADE_BIN_META_QUADS : 0
    touch(key)
  })
  if (last >= first) b.head.write('Word', first, last - first + 1, b.classes.buffer, first * 4)
  b.device.queue.writeBuffer(b.meta, 0, b.modes, 0, SHADE_BIN_META_WORDS * keys.length)
  b.counted[0] = keys.length
  b.device.queue.writeBuffer(b.count, 0, b.counted)
  b.held = keys.slice()
  b.quads = quads
}

function encodeBins(b: Bins, open: OpenPass, mask: GPUTextureView, width: number, height: number) {
  const { binsBound: bound, stages } = b
  const walks = (b.quads && b.quadStages) || stages
  bound.next[0] = mask
  bound.next[1] = b.meta
  bound.next[2] = b.elements.view
  bound.next[3] = b.work
  bound.next[4] = b.args
  if (bound.moved() || !b.binsGroup)
    b.binsGroup = b.device.createBindGroup({
      layout: b.layout,
      entries: sequentialEntries([
        mask,
        { buffer: b.count },
        { buffer: b.meta },
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
  pass.setPipeline(walks.countBins)
  pass.dispatchWorkgroups(tilesX, tilesY)
  pass.setPipeline(stages.reserveBins)
  pass.dispatchWorkgroups(lanes)
  pass.setPipeline(walks.scatterBins)
  pass.dispatchWorkgroups(tilesX, tilesY)
  return KERNELS.length
}

/** The masks of the `width` × `height` identifiers `ids` built (`maskBins`), then the bins of them. */
function encodeFromIds(
  b: Bins,
  open: OpenPass,
  ids: GPUTextureView,
  pages: GPUBuffer,
  uniform: GPUBuffer,
  width: number,
  height: number,
) {
  let { masks } = b
  if (masks?.width !== width || masks.height !== height) {
    if (masks) retire(b.device, masks.texture)
    const texture = b.device.createTexture({
      label: 'Trillion3D shading bins masks',
      size: [width, height],
      format: 'r32uint',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
    masks = b.masks = { texture, view: texture.createView(), width, height }
  }
  const { next } = b.maskBound
  next[0] = ids
  next[1] = pages
  next[2] = uniform
  next[3] = b.head.view
  next[4] = masks.view
  if (b.maskBound.moved() || !b.maskGroup)
    b.maskGroup = b.device.createBindGroup({
      layout: b.maskLayout,
      entries: [
        { binding: MASK_BINDINGS.ids, resource: ids },
        { binding: MASK_BINDINGS.pages, resource: { buffer: pages } },
        { binding: MASK_BINDINGS.uniform, resource: { buffer: uniform } },
        { binding: MASK_BINDINGS.head, resource: b.head.view },
        { binding: MASK_BINDINGS.mask, resource: masks.view },
      ],
    })
  const pass = open.pass
  pass.setPipeline(b.maskStage)
  pass.setBindGroup(0, b.maskGroup)
  pass.dispatchWorkgroups(ceilDiv(width, MASK_SIDE), ceilDiv(height, MASK_SIDE))
  return 1 + encodeBins(b, open, masks.view, width, height)
}

/** The classes' group 1: the surfaces' two layered targets, the feedback target's or its stand-in,
 *  the bins' head, elements and meta; made again when one of them is another. The head's word of the
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
  next[5] = b.meta
  if (b.outputBound.moved() || !b.outputGroup)
    b.outputGroup = b.device.createBindGroup({
      layout: shadeOutputLayout(b.device),
      entries: sequentialEntries([
        colours,
        words,
        feedback ?? b.noFeedbackView,
        b.head.view,
        b.elements.view,
        { buffer: b.meta },
      ]),
    })
  return b.outputGroup
}

export type ShadeBins = Awaited<ReturnType<typeof createShadeBins>>
