import { ceilDiv, workgroupCount } from '../../../../../math/src/scalar/integers.ts'
import type { BounceCascades } from '../../../../../sdk-core/src/bounce/cascades.ts'
import type { TranslucentMarkSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import {
  computeBufferEntry,
  computeTextureEntry,
  namedEntries,
} from '../../../gpu/core/computeBindings.ts'
import { buildComputeStages } from '../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { putVec4 } from '../../../gpu/core/fieldLayout.ts'
import { createReadbackRing } from '../../../gpu/core/readbackRing.ts'
import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import { wordViews } from '../../../gpu/core/wordViews.ts'
import { writeChanged } from '../../../gpu/core/writeChanged.ts'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { atlasEntry } from '../atlas.ts'
import {
  FINISH_BINDINGS as F,
  MARK_IMAGE_BINDINGS as MI,
  MARK_PROBES_BINDINGS as MP,
  POOL_ARGS,
  POOL_BINDINGS as B,
  POOL_PARAMS,
  POOL_PARAMS_BYTES,
  POOL_SLOT,
  POOL_WORK,
  freshWork,
  poolLimits,
  poolShapeOf,
  poolWorkWords,
  type PoolShape,
} from './poolLayout.ts'
import { MARK_IMAGE_SHADER, MARK_PROBES_SHADER, markImageGroups } from './poolMarkWgsl.ts'
import { POOL_FINISH_SHADER, POOL_SHADER } from './poolWgsl.ts'

/** Statistics in flight at once: one an image at most, never a wait. */
const IN_FLIGHT = 3

/** A mark a pass of the engine adds to the surfaces' (`MarkSurface.markers`): `mark` runs beside them in the bounce pass, with the levels'
 *  uniform and the bitmap they fill. */
export interface PoolMarker {
  mark(pass: GPUComputePassEncoder, grid: GPUBuffer, marks: GPUBuffer): void
}

/** The translucent surfaces' mark of the cells they read (`translucentMark.ts`): `mark` encodes, in the image's encoder, the pass that draws
 *  their meshes and marks the bitmap `marks` of the levels' uniform `grid` from their fragments — after the bitmap is cleared and before
 *  the pool's kernels, which are a compute pass of their own. */
export interface TranslucentMarker {
  mark(
    encoder: GPUCommandEncoder,
    grid: GPUBuffer,
    marks: GPUBuffer,
    settings: TranslucentMarkSettings,
  ): void
}

/** The screen probes the last image cast, whose records the pool marks the cells they stand in from (`MARK_PROBES_SHADER`): the atlas
 *  of their points, the buffer that holds the count of the adaptive ones placed, the uniform ones' count, the
 *  most adaptive ones the atlas holds, and the atlas's extent in probes. */
export interface MarkProbes {
  info: GPUTextureView
  counts: GPUBuffer
  uniform: number
  maxAdaptive: number
  tilesX: number
  rows: number
}

/** What the pool marks the cells from: the image's depth, the view's uniform, the size it was
 *  drawn at and, where the last image cast screen probes, those. Filled in place each image. */
export type MarkSurface = {
  depth: GPUTextureView | undefined
  view: GPUBuffer | undefined
  size: [number, number]
  /** The screen probes the last image cast, none where it cast none. */
  probes: MarkProbes | undefined
  /** The marks the engine's other passes add (the translucency volume's, `../../translucencyGi/frame.ts`), none while they have none. */
  markers: readonly PoolMarker[]
  /** The translucent surfaces' mark, none while the scene draws none. */
  translucent: TranslucentMarker | undefined
}

/** No marker. */
export const NO_MARKERS: readonly PoolMarker[] = []

/** A surface with nothing in it yet. */
export const createMarkSurface = (): MarkSurface => ({
  depth: undefined,
  view: undefined,
  size: [0, 0],
  probes: undefined,
  markers: NO_MARKERS,
  translucent: undefined,
})

/** What the last statistics that came back say of the pool (`POOL_WORK`): the probes alive, those that hold nothing yet, those not traced
 *  since the lights last changed, the marks refused for want of a probe (in all), the probes the last pass queued and the cells it marked. `reads` counts the
 *  statistics that came back. */
export interface PoolStats {
  reads: number
  live: number
  unfilled: number
  refreshing: number
  refused: number
  queued: number
  marked: number
}

/** The mark pass over the image's depth: its layout and pipeline, compiled off the thread, and its group, made again only when the
 *  depth or the view's uniform moved. */
async function createImageMarks(
  device: GPUDevice,
  grid: GPUBuffer,
  marks: GPUBuffer,
  params: GPUBuffer,
) {
  const module = await createCheckedShaderModule(device, MARK_IMAGE_SHADER, 'BOUNCE_MARK_IMAGE')
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(MI.grid, 'uniform'),
      computeBufferEntry(MI.view, 'uniform'),
      computeTextureEntry(MI.depth, 'depth', '2d'),
      computeBufferEntry(MI.params, 'uniform'),
      computeBufferEntry(MI.marks, 'storage'),
    ],
  })
  const { markImage } = await buildComputeStages(device, [layout], module, ['markImage'])
  const bound = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return (pass: GPUComputePassEncoder, surface: MarkSurface, work: PoolWork) => {
    bound.next[0] = surface.depth
    bound.next[1] = surface.view
    if (bound.moved())
      group = device.createBindGroup({
        layout,
        entries: namedEntries(MI, {
          grid: { buffer: grid },
          marks: { buffer: marks },
          params: { buffer: params },
          view: { buffer: surface.view! },
          depth: surface.depth!,
        }),
      })
    pass.setPipeline(markImage)
    pass.setBindGroup(0, group!)
    const [x, y] = markImageGroups(surface.size, work.markDownsample, work.interpolateDownsample)
    pass.dispatchWorkgroups(x, y, 1)
  }
}

/** The mark pass over the screen probes the last image cast: its layout and pipeline, compiled off the thread, its uniform (the counts
 *  it bounds the atlas by) and its group, made again only when the records or the count's buffer moved. */
async function createProbeMarks(device: GPUDevice, grid: GPUBuffer, marks: GPUBuffer) {
  const module = await createCheckedShaderModule(device, MARK_PROBES_SHADER, 'BOUNCE_MARK_PROBES')
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(MP.grid, 'uniform'),
      computeBufferEntry(MP.source, 'uniform'),
      computeTextureEntry(MP.info, 'unfilterable-float', '2d'),
      computeBufferEntry(MP.counts, 'read-only-storage'),
      computeBufferEntry(MP.marks, 'storage'),
    ],
  })
  const { markProbes } = await buildComputeStages(device, [layout], module, ['markProbes'])
  const source = device.createBuffer({
    label: 'Trillion3D bounce marks screen probes v1',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const { u: words } = wordViews(new ArrayBuffer(16))
  const bound = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return {
    dispatch(pass: GPUComputePassEncoder, probes: MarkProbes) {
      putVec4(words, 0, probes.uniform, probes.maxAdaptive, probes.tilesX, probes.rows)
      writeChanged(device, source, words, 0, 4)
      bound.next[0] = probes.info
      bound.next[1] = probes.counts
      if (bound.moved())
        group = device.createBindGroup({
          layout,
          entries: namedEntries(MP, {
            grid: { buffer: grid },
            source: { buffer: source },
            info: probes.info,
            counts: { buffer: probes.counts },
            marks: { buffer: marks },
          }),
        })
      pass.setPipeline(markProbes)
      pass.setBindGroup(0, group!)
      pass.dispatchWorkgroups(ceilDiv(probes.tilesX, 8), ceilDiv(probes.rows, 8), 1)
    },
    destroy: () => source.destroy(),
  }
}

/** The buffers the pool keeps and the passes bind, for `slots` probes and a table of `shape`. */
function createPoolBuffers(device: GPUDevice, slots: number, shape: PoolShape) {
  const storage = (label: string, words: number, extra = 0) =>
    device.createBuffer({
      label: `Trillion3D bounce pool ${label} v1`,
      size: words * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | extra,
    })
  const work = storage('work', poolWorkWords(slots), GPUBufferUsage.COPY_SRC)
  device.queue.writeBuffer(work, 0, freshWork(slots))
  return {
    slots: storage('slots', slots * POOL_SLOT.words),
    table: storage('table', Math.max(1, shape.tableTexels * 4)),
    work,
    marks: storage('marks', shape.markWords),
    args: storage('arguments', POOL_ARGS.words, GPUBufferUsage.INDIRECT),
    params: device.createBuffer({
      label: 'Trillion3D bounce pool parameters v1',
      size: POOL_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
  }
}

/** The pool's kernels: its module compiled, its layout and its pipelines by entry point, and the finish pass's — made once for a device,
 *  whatever the pool they run over. */
const compilePool = oncePerDevice(async (device: GPUDevice) => {
  const module = await createCheckedShaderModule(device, POOL_SHADER, 'BOUNCE_POOL')
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(B.grid, 'uniform'),
      computeBufferEntry(B.params, 'uniform'),
      computeBufferEntry(B.slots, 'storage'),
      computeBufferEntry(B.table, 'storage'),
      computeBufferEntry(B.work, 'storage'),
      computeBufferEntry(B.marks, 'storage'),
      computeBufferEntry(B.queue, 'storage'),
      atlasEntry(B.published, true),
    ],
  })
  const pipelines = await buildComputeStages(device, [layout], module, [
    'clearWork',
    'stampChange',
    'clearIndirection',
    'updateProbes',
    'allocateProbes',
    'countProbes',
    'cutProbes',
    'emitProbes',
    'tallyProbes',
    'publishTable',
  ] as const)
  const finishModule = await createCheckedShaderModule(
    device,
    POOL_FINISH_SHADER,
    'BOUNCE_POOL_FINISH',
  )
  const finishLayout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(F.work, 'storage'),
      computeBufferEntry(F.args, 'storage'),
      computeBufferEntry(F.grid, 'storage'),
    ],
  })
  const finish = await buildComputeStages(device, [finishLayout], finishModule, [
    'sizeSlots',
    'finishQueue',
  ] as const)
  return { layout, pipelines, finishLayout, ...finish }
})

/** What one image asks of the pool's pass: the budget in probes, the probes its queue may hold (`queueProbes`, the block of the queue the radiance cache's
 *  atlases follow), the frames a probe nothing reads is kept, the factors the image is
 *  downsampled by to mark the cells it reads (the mark's, then the interpolation's), the squares of the distances the cost of a probe
 *  changes at. */
export interface PoolWork {
  probesPerFrame: number
  queueProbes: number
  keepFrames: number
  markDownsample: number
  interpolateDownsample: number
  downsampleSq: number
  supersampleSq: number
  /** How the translucent surfaces mark the cells they read; none where they do not. */
  translucent: TranslucentMarkSettings | undefined
}

/** The bind groups of the pool's kernels: those over the slots, the table and the work buffer, and the finish pass's. */
function createPoolGroups(
  device: GPUDevice,
  compiled: Awaited<ReturnType<typeof compilePool>>,
  buffers: ReturnType<typeof createPoolBuffers>,
  parts: PoolParts,
) {
  return {
    kernels: device.createBindGroup({
      layout: compiled.layout,
      entries: namedEntries(B, {
        grid: { buffer: parts.grid },
        params: { buffer: buffers.params },
        slots: { buffer: buffers.slots },
        table: { buffer: buffers.table },
        work: { buffer: buffers.work },
        marks: { buffer: buffers.marks },
        queue: { buffer: parts.queue },
        published: parts.published,
      }),
    }),
    finish: device.createBindGroup({
      layout: compiled.finishLayout,
      entries: namedEntries(F, {
        work: { buffer: buffers.work },
        args: { buffer: buffers.args },
        grid: { buffer: parts.grid },
      }),
    }),
  }
}

/** The statistics that came back (`PoolStats`), the ring they come through: no read waits, a few images late. */
function createPoolStats(device: GPUDevice) {
  const stats: PoolStats = {
    reads: 0,
    live: 0,
    unfilled: 0,
    refreshing: 0,
    refused: 0,
    queued: 0,
    marked: 0,
  }
  const ring = createReadbackRing(
    device,
    {
      label: 'Trillion3D bounce pool statistics readback',
      bytes: POOL_WORK.stats * 4,
      count: IN_FLIGHT,
    },
    (mapped) => {
      const words = new Uint32Array(mapped, 0, POOL_WORK.stats)
      stats.live = words[POOL_WORK.live]
      stats.unfilled = words[POOL_WORK.unfilled]
      stats.refreshing = words[POOL_WORK.refreshing]
      stats.refused = words[POOL_WORK.refused]
      stats.queued = words[POOL_WORK.queued]
      stats.marked = words[POOL_WORK.marked]
      stats.reads++
    },
  )
  return { stats, ring }
}

/** The writer of the pool's parameters (`POOL_PARAMS`) for the work of an image, which is a full update where `full`: no budget, every probe
 *  given back. The probes it may queue are the work's. */
function createPoolParams(device: GPUDevice, buffer: GPUBuffer) {
  const { u: words, f: floats } = wordViews(new ArrayBuffer(POOL_PARAMS_BYTES))
  const P = POOL_PARAMS.at
  return (work: PoolWork, full: boolean) => {
    const limits = poolLimits(work.probesPerFrame, full, work.queueProbes)
    words[P.room] = limits.room
    words[P.keep] = work.keepFrames
    words[P.cap] = limits.cap
    words[P.fullUpdate] = limits.fullUpdate
    words[P.markDownsample] = work.markDownsample
    words[P.markDownsample + 1] = work.interpolateDownsample
    floats[P.distances] = work.downsampleSq
    floats[P.distances + 1] = work.supersampleSq
    writeChanged(device, buffer, words, 0, POOL_PARAMS.words)
  }
}

/**
 * The pool's kernels over the slots, the table and the work buffer, in order, from the clear of the indirection to the table's publication:
 * the indirection is cleared, the cells the image reads marked (`mark`), and the probes of the last pass put back in it from them, then
 * the counters cleared (where the lights changed (`restart`) the frame is kept as that of the change), the cells marked that hold no
 * probe take one, the probes are chosen and the arguments of the dispatches over those chosen written, then the table is counted and published.
 */
function encodePoolKernels(
  pass: GPUComputePassEncoder,
  compiled: Awaited<ReturnType<typeof compilePool>>,
  groups: ReturnType<typeof createPoolGroups>,
  args: GPUBuffer,
  shape: PoolShape,
  restart: boolean,
  mark: () => void,
) {
  const { pipelines } = compiled
  pass.setBindGroup(0, groups.kernels)
  const over = (name: keyof typeof pipelines, threads: number) => {
    pass.setPipeline(pipelines[name])
    pass.dispatchWorkgroups(workgroupCount(threads, WORKGROUP_THREADS), 1, 1)
  }
  const alone = (name: keyof typeof pipelines) => over(name, 1)
  /** A kernel of the finish pass (the arguments over the slots ever given, written from `high`; the arguments over the queue), the kernels' group set back after it. */
  const finish = (pipeline: GPUComputePipeline) => {
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, groups.finish)
    pass.dispatchWorkgroups(1, 1, 1)
    pass.setBindGroup(0, groups.kernels)
  }
  /** A kernel a slot, over the slots ever given (`high`), none while none was. */
  const slots = (name: keyof typeof pipelines) => {
    pass.setPipeline(pipelines[name])
    pass.dispatchWorkgroupsIndirect(args, POOL_ARGS.slots * 4)
  }
  over('clearIndirection', shape.entries)
  mark()
  finish(compiled.sizeSlots)
  slots('updateProbes')
  over('clearWork', POOL_WORK.stack)
  if (restart) alone('stampChange')
  over('allocateProbes', shape.markWords)
  finish(compiled.sizeSlots)
  slots('countProbes')
  alone('cutProbes')
  slots('emitProbes')
  finish(compiled.finishQueue)
  slots('tallyProbes')
  over('publishTable', shape.tableTexels)
}

/** What the pool is made over: the levels' uniform, the published table, the probe queue the pool writes, and whether the surfaces the image
 *  draws mark cells (the world's probes: the image's depth, the screen probes it cast) — else only the marks the engine's other passes add
 *  (`MarkSurface.markers`) do. */
interface PoolParts {
  grid: GPUBuffer
  published: GPUTextureView
  queue: GPUBuffer
  surfaceMarks: boolean
}

/** What the pool keeps between two images. */
interface PoolKit {
  readonly grid: GPUBuffer
  readonly buffers: ReturnType<typeof createPoolBuffers>
  readonly compiled: Awaited<ReturnType<typeof compilePool>>
  readonly shape: PoolShape
  /** The marks of the image's surfaces, none in a pool that only the engine's other passes mark. */
  readonly surfaceMarks:
    | {
        imageMarks: Awaited<ReturnType<typeof createImageMarks>>
        probeMarks: Awaited<ReturnType<typeof createProbeMarks>>
      }
    | undefined
  readonly groups: ReturnType<typeof createPoolGroups>
  readonly stats: PoolStats
  readonly ring: ReturnType<typeof createPoolStats>['ring']
  readonly writeParams: ReturnType<typeof createPoolParams>
  staging: GPUBuffer | undefined
  /** The lights changed: the next pass keeps its frame as that of the change. */
  pendingRestart: boolean
  /** The next pass is a full update: every probe is given back, those the image reads are traced all, at no budget. */
  pendingDiscard: boolean
  /** The count of statistics read (`PoolStats.reads`) from which the pass that kept the change's frame is counted: the series stays open
   *  till it is. */
  restartRead: number
}

/** Whether the series is open (`BouncePool.working`): a change not yet counted, or probes that hold nothing or have not been traced since. */
const poolWorking = ({ pendingRestart, restartRead, stats }: PoolKit) =>
  pendingRestart || stats.reads < restartRead || stats.unfilled > 0 || stats.refreshing > 0

/** The pool's work in the bounce pass (`BouncePool.dispatch`). */
function dispatchPool(
  kit: PoolKit,
  pass: GPUComputePassEncoder,
  work: PoolWork,
  surface: MarkSurface | undefined,
) {
  kit.writeParams(work, kit.pendingDiscard)
  if (kit.pendingRestart) kit.restartRead = kit.stats.reads + kit.ring.held()
  const mark = () => {
    if (!surface) return
    const { surfaceMarks } = kit
    if (surfaceMarks && surface.probes) surfaceMarks.probeMarks.dispatch(pass, surface.probes)
    else if (surfaceMarks && surface.depth) surfaceMarks.imageMarks(pass, surface, work)
    for (const marker of surface.markers) marker.mark(pass, kit.grid, kit.buffers.marks)
  }
  encodePoolKernels(
    pass,
    kit.compiled,
    kit.groups,
    kit.buffers.args,
    kit.shape,
    kit.pendingRestart,
    mark,
  )
  kit.pendingRestart = kit.pendingDiscard = false
}

/** The pool's buffers, kernels and marks, made. */
async function createPoolKit(
  device: GPUDevice,
  cascades: BounceCascades,
  parts: PoolParts,
): Promise<PoolKit> {
  const shape = poolShapeOf(cascades)
  const buffers = createPoolBuffers(device, cascades.probes, shape)
  const compiled = await compilePool(device)
  const { stats, ring } = createPoolStats(device)
  return {
    grid: parts.grid,
    buffers,
    compiled,
    shape,
    surfaceMarks: parts.surfaceMarks
      ? {
          imageMarks: await createImageMarks(device, parts.grid, buffers.marks, buffers.params),
          probeMarks: await createProbeMarks(device, parts.grid, buffers.marks),
        }
      : undefined,
    groups: createPoolGroups(device, compiled, buffers, parts),
    stats,
    ring,
    writeParams: createPoolParams(device, buffers.params),
    staging: undefined,
    pendingRestart: false,
    // The first pass has no history: it is a full update.
    pendingDiscard: true,
    restartRead: 0,
  }
}

/**
 * THE POOL OF PROBES, on the GPU (`poolWgsl.ts`): a fixed count of probes, given to the cells the image reads and given back, and
 * the choice of those traced each image, none of it read back to be decided. Every image marks the points of the screen probes the last
 * image cast — the image's own surface where it cast none —, the indirection is made again from the probes it kept and the cells round
 * the points take a probe from the pool or are refused one; every probe is then in the one histogram the budget chooses the probes traced
 * from, and the queue and the arguments of the dispatches over it, which the passes that read it are dispatched by (`args`), are written.
 * The CPU is told, a few images late, how many probes are alive, hold nothing yet or have not been traced since the lights last changed
 * (`stats`): the series is open while any are (`working`).
 */
export async function createBouncePool(
  device: GPUDevice,
  cascades: BounceCascades,
  parts: PoolParts,
) {
  const kit = await createPoolKit(device, cascades, parts)
  const { buffers, stats, ring } = kit
  return {
    /** The statistics the last read brought back (`PoolStats`): a few images late. */
    stats,
    /** The arguments of the dispatches over the probes the image traces (`POOL_ARGS`): what the radiance cache is dispatched by. */
    args: buffers.args,
    /** Whether the series is open: a restart not yet encoded or counted, or probes alive that hold nothing yet or have not been traced since
     *  the lights last changed, as the last statistics counted them. */
    get working() {
      return poolWorking(kit)
    },
    /** The lights changed: the next pass keeps its frame as the frame of the change; the series is open till every probe is traced since. */
    restart() {
      kit.pendingRestart = true
    },
    /** The cache the probes hold is discarded (the maps were made again, or the lighting changed by a great deal): the next pass is a full
     *  update, which also restarts the series. */
    discard() {
      kit.pendingRestart = kit.pendingDiscard = true
    },
    /** The marks' bitmap cleared and a staging buffer taken for the statistics, before the pass. */
    clear(encoder: GPUCommandEncoder) {
      kit.staging = ring.take()
      encoder.clearBuffer(buffers.marks)
    },
    /** Whether the next pass is a full update (`discard`): known before it, as the block of its queue (`work.queueProbes`) follows it. */
    get full() {
      return kit.pendingDiscard
    },
    /**
     * The pool's work in the bounce pass: the indirection cleared, the cells the image reads marked (from the screen probes' points where `surface`
     * holds them, else from the image's surface), and the pool's kernels. The arguments of the dispatches over the queue are written as soon as it is chosen.
     */
    dispatch(pass: GPUComputePassEncoder, work: PoolWork, surface: MarkSurface | undefined) {
      return dispatchPool(kit, pass, work, surface)
    },
    /** The translucent surfaces' mark (`MarkSurface.translucent`), encoded after `clear` and before the pass: only in a pool the image's surfaces mark. */
    markTranslucent(
      encoder: GPUCommandEncoder,
      settings: TranslucentMarkSettings | undefined,
      surface: MarkSurface | undefined,
    ) {
      if (settings && kit.surfaceMarks && surface?.translucent)
        surface.translucent.mark(encoder, kit.grid, buffers.marks, settings)
    },
    /** The statistics copied to the staging buffer `clear` took, after the pass. */
    copy(encoder: GPUCommandEncoder) {
      const { staging } = kit
      if (staging) encoder.copyBufferToBuffer(buffers.work, 0, staging, 0, POOL_WORK.stats * 4)
    },
    /** After the image's submit: its copy maps. */
    submitted: () => ring.submitted(),
    dispose() {
      ring.destroy()
      kit.surfaceMarks?.probeMarks.destroy()
      for (const buffer of Object.values(buffers)) buffer.destroy()
    },
  }
}

/** The pool, made. */
export type BouncePool = Awaited<ReturnType<typeof createBouncePool>>
