import { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import {
  LIST_DISPATCH,
  MODE_DEPTH,
  MODE_ID,
  RASTER_PASSES,
  RASTER_PASS_MAIN,
  RASTER_PASS_POST,
  headerWord,
  rasterEntry,
  rasterListWords,
  type RasterPass,
} from './contract.ts'
import { rasterSource } from './shader.ts'
import { cameraMasks } from '../shader/maskSets.ts'
import { visibilityWpo } from '../shader/wpoSets.ts'
import { NO_RASTERS, type GraphRasters } from '../../materials/graph/graphRasters.ts'
import { graphFrameEntry } from '../shader/graphFrameWgsl.ts'
import { BLUE_NOISE_FORMAT } from '../../gpu/noise/blueNoiseTextures.ts'
import { SMALL_BINDINGS, atlasLayoutEntries } from '../../gpu/bind/bindLayout.ts'
import { createRasterBindings } from './bindings.ts'
import { createRasterExport } from './export.ts'
import type { GpuRasterInput } from './types.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { pendingBuffers, type PendingGrowth } from '../../gpu/core/tableGrowth.ts'
import { followTessellation } from '../tessellation/follow.ts'
import type { Tessellation } from '../tessellation/tessellation.ts'
import type { TessellationCapacity } from '../tessellation/uniform.ts'
import { hasWideAtomics } from '../../gpu/core/wideAtomics.ts'
import { gpuCapsOf, nativeOrPolyfill } from '../../gpu/core/gpuCaps.ts'
import {
  RASTER_BINNING_PASS,
  RASTER_IDENTIFIERS_PASS,
  RASTER_OCCLUDER_DEPTH_PASS,
  RASTER_TESTED_DEPTH_PASS,
} from '../../diagnostic/stage/passLabels.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeTextureEntry,
  storageTextureLayout,
  COMPUTE,
} from '../../gpu/core/computeBindings.ts'

/**
 * The visibility raster's buffer and its software half: the software raster of the clusters the bins
 * list for it, and the export of the buffer both rasters write (`visWriteWgsl`) into the images the
 * consumers read.
 *
 * `width` × `height` is the size of the targets, the most any image draws; `capacity` the clusters
 * the lists can hold, the room of the cut's list of visible clusters
 * (`../../geometry/dag/visible/layout.ts`): a cluster is in a pass's list once, so no frame loses
 * one, and the lists are made again when the room grows (`growLists`). On a device with the 64-bit
 * atomic maximum (`wide`, `../../gpu/core/wideAtomics.ts`) the buffer holds a pair a pixel; on one
 * without it the hardware raster draws into a texture pair of its own (`hardwareIds`) and the
 * export merges.
 */
export function createGpuRaster(
  device: GPUDevice,
  width: number,
  height: number,
  capacity: number,
  rasters: GraphRasters = NO_RASTERS,
  clipping = false,
) {
  const wide = hasWideAtomics(device)
  const { targetBytes, work, lists } = rasterBuffers(device, width, height, capacity)
  const hardware = wide ? undefined : hardwareTarget(device, width, height)
  const { layouts, ...pipelines } = rasterPipelines(device, rasters, wide)
  // The lists are read live: a growth puts another buffer in place.
  const bindings = createRasterBindings(device, layouts, work, () => r.lists, wide)
  const r: Raster = {
    ...{ work, lists, capacity, targetBytes, wide, ...pipelines },
    exported: createRasterExport(device, wide, work, width, height, hardware?.view),
    bindings,
    group: undefined,
    tessellation: undefined,
    tessellating: false,
  }
  return rasterApi(r, { width, height, rasters, clipping, hardware })
}

/** What a raster is made over: the size of its targets, the graph outputs its modules hold, whether
 *  they cut at the view's plane and the hardware raster's own target. */
type RasterShape = {
  width: number
  height: number
  rasters: GraphRasters
  clipping: boolean
  hardware: ReturnType<typeof hardwareTarget> | undefined
}

/** What the binning of a pass runs, in order (`encodeBinning`): its counters cleared, the decode of
 *  its clusters, their deformation — between two compute passes, none when no deformation
 *  runs —, then the bins. */
export type BinningSteps = {
  /** Whether the decode and the bins of the pass are all compiled (`chainReady`): none runs else. */
  ready(): boolean
  clear(encoder: GPUCommandEncoder): void
  decode(compute: GPUComputePassEncoder): void
  deform?(run: ComputeRun): void
  bins(compute: GPUComputePassEncoder): void
}

/** The members of the raster `r` that encode: the binning, the depths, the close, the growth of
 *  the lists. */
function rasterEncoders(
  r: Raster,
  rasters: RasterShape['rasters'],
  clipping: RasterShape['clipping'],
) {
  const { work } = r
  return {
    /** The binning of `pass`: `steps` in the pass's compute passes — the decode of its clusters, the
     *  deformation between, the bins, then the tessellation's seeding and levels. The main pass's
     *  opens the image, the visibility buffer cleared. Returns the number of compute dispatches
     *  encoded: the decode's and the bins' (the deformation's own are counted by its stages). */
    encodeBinning: (
      encoder: GPUCommandEncoder,
      input: GpuRasterInput,
      pass: RasterPass,
      steps: BinningSteps,
    ) => encodeBinning(r, encoder, input, pass, steps),
    /** The software depth of `pass`'s list, after its hardware slots', then the depth both rasters
     *  wrote so far into the pyramid's level zero: steps of the run `steps`. Returns the number of
     *  compute dispatches encoded. */
    encodeDepth(steps: ComputeRun, pass: RasterPass, input: GpuRasterInput) {
      const dispatches = encodeMode(
        r,
        steps,
        pass === RASTER_PASS_MAIN ? MAIN_ONLY : POST_ONLY,
        MODE_DEPTH,
      )
      r.exported.encodeDepth(steps, input)
      return dispatches + 1
    },
    /** Keeps the tessellation of the displaced surfaces as `asked` says — its capacity, none where
     *  the image tessellates nothing: made, its pipelines asked off the frame, made again when the
     *  capacity moved, given back when none. */
    followTessellation: (device: GPUDevice, asked: TessellationCapacity | undefined) =>
      followTessellation(r, device, work, () => r.lists, asked, clipping, rasters),
    /** On a device without the 64-bit word, the software identifiers over the lists of the main
     *  pass — and of the post pass when `post` —, after the hardware raster's drawn; then the image
     *  closed: its identifiers and the scene's depth over the viewport `size`. Returns the number of
     *  compute dispatches encoded. */
    encodeClose(
      encoder: GPUCommandEncoder,
      input: GpuRasterInput,
      size: readonly number[],
      post: boolean,
    ) {
      const steps = closeRun.begin(encoder)
      const dispatches = r.wide
        ? 0
        : encodeMode(r, steps, post ? RASTER_PASSES : MAIN_ONLY, MODE_ID)
      r.exported.encodeClose(steps, input, size[0]!, size[1]!)
      steps.end()
      return dispatches + 1
    },
    /** Lists for `capacity` clusters, made now and put in place by `commit`: what the next image
     *  reads, the groups naming them made again (`createRasterBindings`). */
    growLists(device: GPUDevice, capacity: number): PendingGrowth {
      const made = listsBuffer(device, capacity)
      return pendingBuffers(device, [made], () => {
        const old = r.lists
        r.lists = made
        r.capacity = capacity
        return [old]
      })
    },
  }
}

/** The members of the raster `r` (`createGpuRaster`). */
function rasterApi(r: Raster, { width, height, rasters, clipping, hardware }: RasterShape) {
  const { work, bindings } = r
  return {
    width,
    height,
    /** The clusters its lists hold room for. */
    get capacity() {
      return r.capacity
    },
    /** The graph outputs its modules were made with (`GraphRasters`): made again when a graph joins. */
    rasters,
    /** Whether the visibility buffer holds a 64-bit pair a pixel (the device has the atomic maximum)
     *  and the hardware raster's fragments write it (`hardwareGroup`), or the hardware raster draws
     *  once, with the hardware depth test, into `hardwareIds` and the scene's depth. */
    wide: r.wide,
    /** The hardware raster's group over the visibility buffer its fragments write; none on a
     *  device without the 64-bit word. */
    hardwareGroup: bindings.hardware,
    /** The identifiers the hardware raster draws on a device without the 64-bit word. */
    hardwareIds: hardware?.view,
    /** The lists the bins write and the rasters read (`./contract.ts`). */
    get lists() {
      return r.lists
    },
    ...rasterEncoders(r, rasters, clipping),
    /** The tessellation held now: the shadow maps' chain runs in its buffers
     *  (`../../lighting/shadows/vsm/tessellation/shadowChain.ts`). */
    get tessellation() {
      return r.tessellation
    },
    /** The shading masks the closed image's export wrote. */
    get shadingMask() {
      return r.exported.mask
    },
    dispose() {
      r.exported.dispose()
      r.tessellation?.dispose()
      work.destroy()
      r.lists.destroy()
      hardware?.texture.destroy()
    },
  }
}

const MAIN_ONLY = [RASTER_PASS_MAIN] as const,
  POST_ONLY = [RASTER_PASS_POST] as const
/** Each mode's compute pass label, by mode (`MODE_DEPTH`, `MODE_ID`) then by the first pass it
 *  draws: the passes' depths are timed apart, the identifiers of both together. */
const MODE_PASSES: readonly (readonly GPUComputePassDescriptor[])[] = [
  [{ label: RASTER_OCCLUDER_DEPTH_PASS }, { label: RASTER_TESTED_DEPTH_PASS }],
  [{ label: RASTER_IDENTIFIERS_PASS }, { label: RASTER_IDENTIFIERS_PASS }],
]
const BINNING: GPUComputePassDescriptor = { label: RASTER_BINNING_PASS }
/** The software identifiers and the export of the closed image: one compute pass but on a frame timed
 *  per pass. */
const closeRun = new ComputeRun()
/** The binning's decode, the deformation of the clusters decoded and the bins. */
const binningRun = new ComputeRun()

type Raster = Omit<ReturnType<typeof rasterPipelines>, 'layouts'> & {
  work: GPUBuffer
  lists: GPUBuffer
  capacity: number
  targetBytes: number
  wide: boolean
  exported: ReturnType<typeof createRasterExport>
  bindings: ReturnType<typeof createRasterBindings>
  /** The software raster's group, the image's, bound by the main pass's binning. */
  group: GPUBindGroup | undefined
  /** The tessellation of the displaced surfaces, held while the image asks it
   *  (`followTessellation`), and whether this image draws it: set by the main pass's binning. */
  tessellation: Tessellation | undefined
  tessellating: boolean
}

/** The passes' lists of clusters: read by the rasters and the tessellation's seeding, written by the
 *  bins, and the source of the dispatches the lists' headers name (`./contract.ts`). */
const listsBuffer = (device: GPUDevice, capacity: number) =>
  device.createBuffer({
    label: 'Trillion3D raster cluster lists',
    size: rasterListWords(capacity) * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
  })

/** The visibility buffer — a depth key then an identifier a pixel, or one 64-bit pair, eight bytes
 *  in all — and the passes' lists of clusters: separate buffers, so that the buffer is bound to the
 *  software raster as one writable word and the lists read-only beside it. */
function rasterBuffers(device: GPUDevice, width: number, height: number, capacity: number) {
  const targetBytes = Math.max(8, width * height * 8)
  const work = device.createBuffer({
    label: 'Trillion3D visibility buffer',
    size: targetBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  return { targetBytes, work, lists: listsBuffer(device, capacity) }
}

/** The identifiers the hardware raster draws on a device without the 64-bit word, with the scene's
 *  depth as its depth target: what the export merges with the software raster's buffer. */
function hardwareTarget(device: GPUDevice, width: number, height: number) {
  const texture = device.createTexture({
    label: 'Trillion3D hardware raster identifiers',
    size: { width, height },
    format: 'r32uint',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  return { texture, view: texture.createView() }
}

/** The software raster's group, its entries in binding order: the geometry, the page rows, the pass's
 *  lists, the uniform, the colour atlas and the maps' records, the visibility buffer. The camera's
 *  raster (`rasterPipelines`) and the raster of the surface cache's cards
 *  (`../../lighting/surfaceCache/capture/cardRaster.ts`) are made over it. */
export function rasterLayoutEntries(): GPUBindGroupLayoutEntry[] {
  const b = SMALL_BINDINGS
  const compute = COMPUTE
  return [
    computeBufferEntry(b.indices, 'read-only-storage', compute),
    computeBufferEntry(b.positions, 'read-only-storage', compute),
    computeBufferEntry(b.pages, 'read-only-storage', compute),
    computeBufferEntry(b.lists, 'read-only-storage', compute),
    computeBufferEntry(b.uniform, 'uniform', compute),
    computeBufferEntry(b.uvs, 'read-only-storage', compute),
    ...atlasLayoutEntries(b.color, compute),
    computeSamplerEntry(b.sampler, 'filtering', compute),
    computeBufferEntry(b.work, 'storage', compute),
    computeTextureEntry(b.material, 'uint', '2d-array', compute),
    computeTextureEntry(b.normals, 'unfilterable-float', '2d-array', compute),
    graphFrameEntry(b.frame, compute),
    { binding: b.noise, visibility: compute, ...storageTextureLayout(BLUE_NOISE_FORMAT) },
  ]
}

function rasterPipelines(device: GPUDevice, rasters: GraphRasters, wide: boolean) {
  // The masks and the offsets the session's surfaces wear, held at its open.
  const wpo = visibilityWpo(rasters)
  const rasterLayout = device.createBindGroupLayout({ entries: rasterLayoutEntries() })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [rasterLayout] })
  const { native, tag } = nativeOrPolyfill(gpuCapsOf(device), 'subgroups')
  const label = `Trillion3D software raster (${tag})`
  const module = device.createShaderModule({
    label,
    code: rasterSource(cameraMasks(rasters), wpo, wide, native),
  })
  /** One pipeline per pass and mode: neither the pass's list nor the mode travel by a uniform, they
   *  ARE the pipeline (`LIST`, the word the pass's header starts at), so no dispatch rereads a word
   *  to know what it does. A device with the 64-bit word runs the first mode alone. */
  const raster = RASTER_PASSES.map((pass) =>
    (wide ? [MODE_DEPTH] : [MODE_DEPTH, MODE_ID]).map((mode) =>
      preparedComputeStage(device, pipelineLayout, module, rasterEntry(mode), {
        LIST: headerWord(pass),
      }).ask(),
    ),
  )
  return { layouts: { raster: rasterLayout }, raster }
}

/** The indirect dispatch of the software raster of a mode for each of `passes`, in a single compute
 *  pass: two consecutive passes already see each other's writes, so every cluster of both passes
 *  has written its depth before any chooses an identifier — one chosen before a cluster wrote its
 *  depth would name a losing triangle. */
function encodeMode(r: Raster, steps: ComputeRun, passes: readonly RasterPass[], mode: number) {
  const compute = steps.pass(MODE_PASSES[mode]![passes[0]!]!)
  compute.setBindGroup(0, r.group!)
  for (const pass of passes) {
    const pipeline = r.raster[pass]![mode]!.get()
    if (!pipeline) continue
    compute.setPipeline(pipeline)
    compute.dispatchWorkgroupsIndirect(r.lists, (headerWord(pass) + LIST_DISPATCH) * 4)
  }
  // The displaced surfaces' micro-triangles, after the clusters: the dicing binds its own group.
  if (r.tessellating) for (const pass of passes) r.tessellation!.encodeDice(compute, pass, mode)
  return passes.length * (1 + (r.tessellating ? 1 : 0))
}

/** The compute dispatches a pass's binning encodes: the decode's plan, the decode and the plan of the
 *  deformation (`createGpuDecode`), then the bins' count, reservation, scatter and finalizing
 *  (`createGpuBins`). */
const BINNING_DISPATCHES = 3 + 4

function encodeBinning(
  r: Raster,
  encoder: GPUCommandEncoder,
  input: GpuRasterInput,
  pass: RasterPass,
  steps: BinningSteps,
) {
  // The decode and the bins run together or not at all: the frame is held (`pipelinesCompiling`).
  if (!steps.ready()) return 0
  // Zero is the far plane's key and the background's identifier: the main pass's binning opens the
  // image, which starts there; the post pass's finds the buffer as the main pass left it.
  if (pass === RASTER_PASS_MAIN) {
    r.group = r.bindings.raster(input)
    encoder.clearBuffer(r.work, 0, r.targetBytes)
    // The image's tessellation is decided once, by its main pass: its dicing follows in both.
    r.tessellating = !!input.tessellation && !!r.tessellation
  }
  steps.clear(encoder)
  // The tessellation's pass state is cleared before the compute pass that fills it.
  if (r.tessellating) r.tessellation!.begin(encoder, input, pass)
  const run = binningRun.begin(encoder)
  steps.decode(run.pass(BINNING))
  // The deformation runs on the decoded clusters, in a pass of its own on a frame timed per pass,
  // before anything reads their vertices: the bins and the tessellation's seeding.
  steps.deform?.(run)
  const binning = run.pass(BINNING)
  steps.bins(binning)
  if (r.tessellating) r.tessellation!.encodeLevels(binning, pass)
  run.end()
  return BINNING_DISPATCHES + (r.tessellating ? r.tessellation!.levelDispatches(pass) : 0)
}
export type GpuRaster = ReturnType<typeof createGpuRaster>
