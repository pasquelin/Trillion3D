import {
  DISPATCH_BASE,
  DISPATCH_WORDS,
  MODE_DEPTH,
  MODE_ID,
  RASTER_CLASSES,
  RASTER_PASSES,
  RASTER_PASS_MAIN,
  RASTER_PASS_POST,
  rasterEntry,
  rasterListWords,
  type RasterPass,
} from './contract.ts'
import { RESOLVE, rasterSource } from './shader.ts'
import { binLayoutEntries, binSource } from './binWgsl.ts'
import { lazyTessellatedBin, stagesOf } from './binStages.ts'
import { SMALL_BINDINGS, atlasLayoutEntries } from '../../gpu/bind/bindLayout.ts'
import { createRasterBindings } from './bindings.ts'
import { createRasterResolves } from './resolve.ts'
import type { GpuRasterInput } from './types.ts'
import type { OpenPass } from '../../gpu/core/lazyComputePass.ts'
import { followTessellation } from '../tessellation/follow.ts'
import type { Tessellation } from '../tessellation/tessellation.ts'
import type { TessellationCapacity } from '../tessellation/uniform.ts'
import { dispatchRows } from '../../gpu/dispatch/grid.ts'
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
  COMPUTE,
} from '../../gpu/core/computeBindings.ts'

/**
 * The visibility raster's buffer and its software half: the cluster split and the binning, the
 * software classes, and the resolves of the buffer both rasters write (`VIS_WRITE_WGSL`).
 *
 * `width` × `height` is the size of the targets, the most any image draws; `capacity` the number
 * of triangles a list can hold: every triangle of every drawable row. Each pass's two lists
 * therefore each hold the whole, and no frame loses one.
 */
export function createGpuRaster(
  device: GPUDevice,
  width: number,
  height: number,
  capacity: number,
  clipping = false,
) {
  const { targetBytes, listOffsets, work, indirect } = rasterBuffers(
    device,
    width,
    height,
    capacity,
  )
  const { layouts, ...pipelines } = rasterPipelines(device, capacity, listOffsets, clipping)
  const bindings = createRasterBindings(device, layouts, work)
  const r: Raster = {
    ...{ work, indirect, listOffsets, targetBytes, ...pipelines },
    resolves: createRasterResolves(device, RESOLVE, work, targetBytes),
    bindings,
    group: undefined,
    tessellation: undefined,
    tessellating: false,
  }
  return {
    width,
    height,
    capacity,
    /** The hardware raster's group over the visibility buffer its fragments write. */
    hardwareGroup: bindings.hardware,
    /** The binning of `pass`: the cluster split written into the draw records of the rows its
     *  mask selects, its software rows binned into its lists, then `compact`'s dispatches in the
     *  same compute pass — the pass's hardware compaction, which reads those records. The main
     *  pass's opens the image, the visibility buffer cleared with its class counts; the post
     *  pass's clears its own counts alone. Returns the number of compute dispatches encoded. */
    encodeBinning: (
      encoder: GPUCommandEncoder,
      input: GpuRasterInput,
      pass: RasterPass,
      compact?: (open: OpenPass) => void,
    ) => encodeBinning(r, encoder, input, pass, compact),
    /** The software depth of `pass`'s lists, after its hardware slots'. */
    encodeDepth(encoder: GPUCommandEncoder, pass: RasterPass) {
      return encodeMode(r, encoder, pass === RASTER_PASS_MAIN ? MAIN_ONLY : POST_ONLY, MODE_DEPTH)
    },
    /** Keeps the tessellation of the displaced surfaces as `asked` says — its capacity, none where
     *  the image tessellates nothing: made, its pipelines and the binning's variant that leaves it
     *  the rows asked off the frame, made again when the capacity moved, given back when none. */
    followTessellation: (device: GPUDevice, asked: TessellationCapacity | undefined) =>
      followTessellation(r, device, work, asked),
    /** The tessellation held now: the shadow maps' chain runs in its buffers
     *  (`../../lighting/shadows/vsm/tessellation/shadowChain.ts`). */
    get tessellation() {
      return r.tessellation
    },
    /** The depth both rasters wrote so far, into the pyramid's level zero (`size` the image's
     *  drawn size). */
    encodeDepthLevel(encoder: GPUCommandEncoder, input: GpuRasterInput, size: readonly number[]) {
      r.resolves.encodeDepthLevel(encoder, input, size[0]!, size[1]!)
    },
    /** The software identifiers over the lists of the main pass — and of the post pass when
     *  `post` —, after the hardware raster's, and the frame closed. */
    encodeIds(
      encoder: GPUCommandEncoder,
      input: GpuRasterInput,
      size: readonly number[],
      post: boolean,
    ) {
      const passes = post ? RASTER_PASSES : MAIN_ONLY
      const dispatches = encodeMode(r, encoder, passes, MODE_ID)
      r.resolves.encodeFinal(encoder, input, size[0]!, size[1]!)
      return dispatches
    },
    dispose() {
      r.tessellation?.dispose()
      work.destroy()
      indirect.destroy()
    },
  }
}

const MAIN_ONLY = [RASTER_PASS_MAIN] as const,
  POST_ONLY = [RASTER_PASS_POST] as const
/** Each mode's compute pass label, by mode (`MODE_DEPTH`, `MODE_ID`) then by the first pass it
 *  draws: the passes' depths are timed apart, the identifiers of both together. */
const MODE_LABELS = [
  [RASTER_OCCLUDER_DEPTH_PASS, RASTER_TESTED_DEPTH_PASS],
  [RASTER_IDENTIFIERS_PASS, RASTER_IDENTIFIERS_PASS],
] as const

type Raster = Omit<ReturnType<typeof rasterPipelines>, 'layouts'> & {
  work: GPUBuffer
  indirect: GPUBuffer
  listOffsets: readonly number[]
  targetBytes: number
  resolves: ReturnType<typeof createRasterResolves>
  bindings: ReturnType<typeof createRasterBindings>
  /** The software raster's group, the image's, bound by the main pass's binning. */
  group: GPUBindGroup | undefined
  /** The tessellation of the displaced surfaces, held while the image asks it
   *  (`followTessellation`), and whether this image draws it: set by the main pass's binning. */
  tessellation: Tessellation | undefined
  tessellating: boolean
}

/** One storage buffer for the image and for the lists: the compute stage is allowed only eight
 *  buffers on the poorest device WebGPU guarantees, and the raster uses six. The image first —
 *  depth keys, then identifiers —, then the main pass's lists, then the post pass's. */
function rasterBuffers(device: GPUDevice, width: number, height: number, capacity: number) {
  const targetBytes = Math.max(8, width * height * 8),
    passBytes = rasterListWords(capacity) * 4
  const listOffsets = RASTER_PASSES.map((pass) => targetBytes + pass * passBytes)
  const work = device.createBuffer({
    label: 'Trillion3D visibility buffer and lists',
    size: targetBytes + RASTER_PASSES.length * passBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  // Dispatch words are copied out of the lists instead of being written by a binding, so no
  // pass holds the buffer it launches from: one pass's after the other's.
  const indirect = device.createBuffer({
    label: 'Trillion3D raster dispatch',
    size: RASTER_PASSES.length * DISPATCH_WORDS * 4,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  })
  return { targetBytes, listOffsets, work, indirect }
}

function rasterPipelines(
  device: GPUDevice,
  capacity: number,
  listOffsets: readonly number[],
  clipping: boolean,
) {
  const b = SMALL_BINDINGS
  const compute = COMPUTE
  const rasterLayout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(b.indices, 'read-only-storage', compute),
      computeBufferEntry(b.positions, 'read-only-storage', compute),
      computeBufferEntry(b.pages, 'read-only-storage', compute),
      computeBufferEntry(b.uniform, 'uniform', compute),
      computeBufferEntry(b.uvs, 'read-only-storage', compute),
      ...atlasLayoutEntries(b.color, compute),
      computeSamplerEntry(b.sampler, 'filtering', compute),
      computeBufferEntry(b.work, 'storage', compute),
      computeTextureEntry(b.material, 'uint', '2d-array', compute),
      computeTextureEntry(b.normals, 'unfilterable-float', '2d-array', compute),
    ],
  })
  const binLayout = device.createBindGroupLayout({ entries: binLayoutEntries() })
  const stages = stagesOf(device, listOffsets)
  const binStage = stages(
      binLayout,
      device.createShaderModule({ code: binSource(capacity, false, clipping) }),
    ),
    rasterStage = stages(rasterLayout, device.createShaderModule({ code: rasterSource(capacity) }))
  const bin = RASTER_PASSES.map((pass) => binStage('bin', pass)),
    plan = RASTER_PASSES.map((pass) => binStage('plan', pass))
  /** One pipeline per pass, class and mode: neither the lists nor the mode travel by a uniform,
   *  they ARE the pipeline, so no dispatch rereads a word to know what it does. */
  const raster = RASTER_PASSES.map((pass) =>
    RASTER_CLASSES.map((klass) =>
      [MODE_DEPTH, MODE_ID].map((mode) => rasterStage(rasterEntry(klass, mode), pass)),
    ),
  )
  return {
    layouts: { raster: rasterLayout, bin: binLayout },
    bin,
    tessellatedBin: lazyTessellatedBin(device, capacity, clipping, binLayout, stages),
    plan,
    raster,
  }
}

/** The three indirect dispatches of a mode for each of `passes`, in a single compute pass: two
 *  consecutive passes already see each other's writes, so every class of both passes has written
 *  its depth before any chooses an identifier — one chosen before a class wrote its depth would
 *  name a losing triangle. */
function encodeMode(
  r: Raster,
  encoder: GPUCommandEncoder,
  passes: readonly RasterPass[],
  mode: number,
) {
  const compute = encoder.beginComputePass({ label: MODE_LABELS[mode]![passes[0]!] })
  compute.setBindGroup(0, r.group!)
  for (const pass of passes)
    for (let klass = 0; klass < RASTER_CLASSES.length; klass++) {
      compute.setPipeline(r.raster[pass]![klass]![mode]!.get())
      compute.dispatchWorkgroupsIndirect(r.indirect, (pass * DISPATCH_WORDS + klass * 3) * 4)
    }
  // The displaced surfaces' micro-triangles, after the classes: the dicing binds its own group.
  if (r.tessellating) for (const pass of passes) r.tessellation!.encodeDice(compute, pass, mode)
  compute.end()
  return passes.length * (RASTER_CLASSES.length + (r.tessellating ? 1 : 0))
}

function encodeBinning(
  r: Raster,
  encoder: GPUCommandEncoder,
  input: GpuRasterInput,
  pass: RasterPass,
  compact?: (open: OpenPass) => void,
) {
  const { work } = r,
    list = r.listOffsets[pass]!
  // Zero is the far plane's key and the background's identifier: the main pass's binning opens
  // the image, which starts there with its class counts, in one clear; the post pass's clears its
  // counts alone, the depth the main pass wrote kept.
  if (pass === RASTER_PASS_MAIN) {
    r.group = r.bindings.raster(input)
    encoder.clearBuffer(work, 0, list + DISPATCH_BASE * 4)
    // The image's tessellation is decided once, by its main pass: its dicing follows in both.
    r.tessellating = !!input.tessellation && !!r.tessellation
  } else encoder.clearBuffer(work, list, DISPATCH_BASE * 4)
  // The tessellation's pass state is cleared before the compute pass that fills it.
  if (r.tessellating) r.tessellation!.begin(encoder, input, pass)
  const binning = encoder.beginComputePass({ label: RASTER_BINNING_PASS })
  binning.setBindGroup(0, r.bindings.bin(input, pass))
  binning.setPipeline((r.tessellating ? r.tessellatedBin() : r.bin)[pass]!.get())
  // A workgroup a drawable row, in rows.
  dispatchRows(binning, Math.max(1, input.pageRows))
  binning.setPipeline(r.plan[pass]!.get())
  binning.dispatchWorkgroups(1)
  if (r.tessellating) r.tessellation!.encodeLevels(binning, pass)
  compact?.({ pass: binning })
  binning.end()
  encoder.copyBufferToBuffer(
    work,
    list + DISPATCH_BASE * 4,
    r.indirect,
    pass * DISPATCH_WORDS * 4,
    DISPATCH_WORDS * 4,
  )
  return 2 + (r.tessellating ? r.tessellation!.levelDispatches(pass) : 0)
}
export type GpuRaster = ReturnType<typeof createGpuRaster>
