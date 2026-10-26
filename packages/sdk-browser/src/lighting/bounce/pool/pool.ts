import { ceilDiv, workgroupCount } from '../../../../../math/src/scalar/integers.ts'
import { BOUNCE_SETTINGS } from '../../../../../sdk-core/src/bounce/contracts.ts'
import type { BounceCascades } from '../../../../../sdk-core/src/bounce/cascades.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import {
  computeBufferEntry,
  computeTextureEntry,
  namedEntries,
} from '../../../gpu/core/computeBindings.ts'
import { buildComputeStages } from '../../../gpu/core/computeStages.ts'
import { createReadbackRing } from '../../../gpu/core/readbackRing.ts'
import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { atlasEntry } from '../atlas.ts'
import {
  FINISH_BINDINGS as F,
  MARK_IMAGE_BINDINGS as MI,
  MARK_PROBES_BINDINGS as MP,
  POOL_ARGS,
  POOL_BINDINGS as B,
  POOL_COST,
  POOL_MARK_WORDS,
  POOL_PARAMS,
  POOL_PARAMS_BYTES,
  POOL_QUEUE,
  POOL_TABLE_TEXELS,
  POOL_WORK,
  freshWork,
  poolWorkWords,
} from './poolLayout.ts'
import { MARK_IMAGE_SHADER, MARK_PROBES_SHADER, markImageGroups } from './poolMarkWgsl.ts'
import { POOL_FINISH_SHADER, POOL_SHADER } from './poolWgsl.ts'

/** Statistics in flight at once: one an image at most, never a wait. */
const IN_FLIGHT = 3

/** Numbers that tell the image's surfaces changed: the camera's view matrix and projection (16 words
 *  each), then the nine of what the image draws (`frame/render/encodeLights.ts`, `drawnSurface`). */
const MARK_SIGNATURE = 32 + 9

/** A mark a pass of the engine adds to the surfaces' (`MarkSurface.markers`): `mark` runs beside them in the bounce pass, with the levels'
 *  uniform and the bitmap they fill; `revision` is a number that moves when what the mark reads changed (the translucency volume's
 *  grid, its settings), so that the pool marks again on a still view. */
export interface PoolMarker {
  readonly revision: number
  mark(pass: GPUComputePassEncoder, grid: GPUBuffer, marks: GPUBuffer): void
}

/** The screen probes the last image cast, whose records the pool marks the cells they stand in from (`MARK_PROBES_SHADER`): the atlas
 *  of their points and their normals, the buffer that holds the count of the adaptive ones placed, the uniform ones' count, the
 *  most adaptive ones the atlas holds, and the atlas's extent in probes. */
export interface MarkProbes {
  info: GPUTextureView
  normal: GPUTextureView
  counts: GPUBuffer
  uniform: number
  maxAdaptive: number
  tilesX: number
  rows: number
}

/** What the pool marks the cells from: the image's depth and normals, the view's uniform, the size it was
 *  drawn at and the signature of what it drew — a camera that moved, a cut that changed, rows that
 *  arrived: a surface the marks have not seen — and, where the last image cast screen probes, those. Filled in place each image. */
export type MarkSurface = {
  /** The view the image is of: each view is watched for its own change, so that views drawn in turn
   *  never look like a view that moves. */
  key: object | undefined
  depth: GPUTextureView | undefined
  normals: GPUTextureView | undefined
  view: GPUBuffer | undefined
  size: [number, number]
  /** `MARK_SIGNATURE` numbers, compared to the last mark's. */
  signature: Float64Array
  /** The screen probes the last image cast, none where it cast none. */
  probes: MarkProbes | undefined
  /** The marks the engine's other passes add (the translucency volume's, `../../translucencyGi/frame.ts`), none while they have none. */
  markers: readonly PoolMarker[]
}

/** No marker. */
export const NO_MARKERS: readonly PoolMarker[] = []

/** A surface with nothing in it yet. */
export const createMarkSurface = (): MarkSurface => ({
  key: undefined,
  depth: undefined,
  normals: undefined,
  view: undefined,
  size: [0, 0],
  signature: new Float64Array(MARK_SIGNATURE),
  probes: undefined,
  markers: NO_MARKERS,
})

/** What the last statistics that came back say of the pool (`POOL_WORK`): the probes alive, those that hold nothing yet, those short of their
 *  updates, the marks refused for want of a probe (in all), the probes the last pass queued and the cells it marked. `reads` counts the
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

/** Whether a surface's signature or size differs from the last one watched of its view, which it then becomes. */
function createViewWatch() {
  type Seen = { signature: Float64Array; width: number; height: number; revisions: number[] }
  const views = new WeakMap<object, Seen>()
  const made = (): Seen => ({
    signature: new Float64Array(MARK_SIGNATURE),
    width: 0,
    height: 0,
    revisions: [],
  })
  const alone = made()
  return (surface: MarkSurface) => {
    let seen = surface.key ? views.get(surface.key) : alone
    if (!seen) {
      seen = made()
      views.set(surface.key!, seen)
    }
    let differs = seen.width !== surface.size[0] || seen.height !== surface.size[1]
    seen.width = surface.size[0]
    seen.height = surface.size[1]
    for (let at = 0; at < MARK_SIGNATURE; at++) {
      if (seen.signature[at] !== surface.signature[at]) differs = true
      seen.signature[at] = surface.signature[at]
    }
    const { markers } = surface
    if (seen.revisions.length !== markers.length) differs = true
    seen.revisions.length = markers.length
    for (let at = 0; at < markers.length; at++) {
      if (seen.revisions[at] !== markers[at].revision) differs = true
      seen.revisions[at] = markers[at].revision
    }
    return differs
  }
}

/** The marks an image owes (`markJitter` after a change of view or of what it draws, of the levels or
 *  of the placements, one a mark issued), and whether this image's are due. */
function createMarkDebt() {
  const watch = createViewWatch()
  let owed = 0,
    changed = false
  return {
    get owed() {
      return owed
    },
    stale: () => void (changed = true),
    paid: () => void owed--,
    due(surface: MarkSurface | undefined, slid: boolean) {
      if (!surface?.depth || !surface.normals || !surface.view) owed = 0
      else if (watch(surface) || slid || changed) owed = BOUNCE_SETTINGS.markJitter
      changed = false
      return owed > 0
    },
  }
}

/** The mark pass over the image's depth: its layout and pipeline, compiled off the thread, and its group, made again only when the
 *  depth, the normals or the view's uniform moved. */
async function createImageMarks(device: GPUDevice, grid: GPUBuffer, marks: GPUBuffer) {
  const module = await createCheckedShaderModule(device, MARK_IMAGE_SHADER, 'BOUNCE_MARK_IMAGE')
  const layout = device.createBindGroupLayout({
    entries: [
      computeBufferEntry(MI.grid, 'uniform'),
      computeBufferEntry(MI.view, 'uniform'),
      computeTextureEntry(MI.depth, 'depth', '2d'),
      computeTextureEntry(MI.normals, 'unfilterable-float', '2d'),
      computeBufferEntry(MI.marks, 'storage'),
    ],
  })
  const { markImage } = await buildComputeStages(device, [layout], module, ['markImage'])
  const bound = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return (pass: GPUComputePassEncoder, surface: MarkSurface) => {
    bound.next[0] = surface.depth
    bound.next[1] = surface.normals
    bound.next[2] = surface.view
    if (bound.moved())
      group = device.createBindGroup({
        layout,
        entries: namedEntries(MI, {
          grid: { buffer: grid },
          marks: { buffer: marks },
          view: { buffer: surface.view! },
          depth: surface.depth!,
          normals: surface.normals!,
        }),
      })
    pass.setPipeline(markImage)
    pass.setBindGroup(0, group!)
    const [x, y] = markImageGroups(surface.size)
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
      computeTextureEntry(MP.normal, 'unfilterable-float', '2d'),
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
  const words = new Uint32Array(4)
  const bound = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return {
    dispatch(pass: GPUComputePassEncoder, probes: MarkProbes) {
      words.set([probes.uniform, probes.maxAdaptive, probes.tilesX, probes.rows])
      device.queue.writeBuffer(source, 0, words)
      bound.next[0] = probes.info
      bound.next[1] = probes.normal
      bound.next[2] = probes.counts
      if (bound.moved())
        group = device.createBindGroup({
          layout,
          entries: namedEntries(MP, {
            grid: { buffer: grid },
            source: { buffer: source },
            info: probes.info,
            normal: probes.normal,
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

/** The buffers the pool keeps and the passes bind. */
function createPoolBuffers(device: GPUDevice, slots: number) {
  const storage = (label: string, words: number, extra = 0) =>
    device.createBuffer({
      label: `Trillion3D bounce pool ${label} v1`,
      size: words * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | extra,
    })
  const work = storage('work', poolWorkWords(slots), GPUBufferUsage.COPY_SRC)
  device.queue.writeBuffer(work, 0, freshWork(slots))
  return {
    slots: storage('slots', slots * 8),
    table: storage('table', Math.max(1, POOL_TABLE_TEXELS * 4)),
    work,
    marks: storage('marks', POOL_MARK_WORDS),
    args: storage('arguments', POOL_ARGS.words, GPUBufferUsage.INDIRECT),
    params: device.createBuffer({
      label: 'Trillion3D bounce pool parameters v1',
      size: POOL_PARAMS_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
  }
}

/** The pool's kernels: its module compiled, its layout and its pipelines by entry point, and the finish pass's. */
async function compilePool(device: GPUDevice) {
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
    'restartProbes',
    'releaseProbes',
    'allocateProbes',
    'countProbes',
    'cutUntraced',
    'emitUntraced',
    'cutTraced',
    'emitTraced',
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
}

/** What one image asks of the pool's pass: whether it marks, whether the levels slid, the budget in probes, the squares of the
 *  distances the cost of a probe changes at. */
export interface PoolWork {
  marking: boolean
  slid: boolean
  probesPerFrame: number
  downsampleSq: number
  supersampleSq: number
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
      stats.queued = Math.min(words[POOL_WORK.queued], POOL_QUEUE)
      stats.marked = words[POOL_WORK.marked]
      stats.reads++
    },
  )
  return { stats, ring }
}

/** The writer of the pool's parameters (`POOL_PARAMS`) for the work of an image. */
function createPoolParams(device: GPUDevice, buffer: GPUBuffer) {
  const written = new ArrayBuffer(POOL_PARAMS_BYTES)
  const words = new Uint32Array(written),
    floats = new Float32Array(written)
  const P = POOL_PARAMS.at
  return (work: PoolWork) => {
    words[P.room] = work.probesPerFrame * POOL_COST.normal
    words[P.marking] = work.marking ? 1 : 0
    floats[P.distances] = work.downsampleSq
    floats[P.distances + 1] = work.supersampleSq
    device.queue.writeBuffer(buffer, 0, written)
  }
}

/**
 * The pool's kernels over the slots, the table and the work buffer, in order, from the clear of the counters to the table's publication,
 * then the finish pass: where the lights changed (`restart`) the traces every probe took are forgotten, where the image marks or the levels
 * slid the probes whose cell left are given back, where it marks the cells marked take a probe.
 */
function encodePoolKernels(
  pass: GPUComputePassEncoder,
  compiled: Awaited<ReturnType<typeof compilePool>>,
  groups: ReturnType<typeof createPoolGroups>,
  args: GPUBuffer,
  work: PoolWork,
  restart: boolean,
) {
  const { pipelines } = compiled
  pass.setBindGroup(0, groups.kernels)
  const over = (name: keyof typeof pipelines, threads: number) => {
    pass.setPipeline(pipelines[name])
    pass.dispatchWorkgroups(workgroupCount(threads, WORKGROUP_THREADS), 1, 1)
  }
  const alone = (name: keyof typeof pipelines) => over(name, 1)
  /** The arguments over the slots ever given, written from `high`. */
  const size = () => {
    pass.setPipeline(compiled.sizeSlots)
    pass.setBindGroup(0, groups.finish)
    pass.dispatchWorkgroups(1, 1, 1)
    pass.setBindGroup(0, groups.kernels)
  }
  /** A kernel a slot, over the slots ever given (`high`), none while none was. */
  const slots = (name: keyof typeof pipelines) => {
    pass.setPipeline(pipelines[name])
    pass.dispatchWorkgroupsIndirect(args, POOL_ARGS.slots * 4)
  }
  over('clearWork', POOL_WORK.stack)
  size()
  if (restart) slots('restartProbes')
  if (work.marking || work.slid) slots('releaseProbes')
  if (work.marking) {
    over('allocateProbes', POOL_MARK_WORDS)
    size()
  }
  slots('countProbes')
  alone('cutUntraced')
  slots('emitUntraced')
  alone('cutTraced')
  slots('emitTraced')
  slots('tallyProbes')
  over('publishTable', POOL_TABLE_TEXELS)
  pass.setPipeline(compiled.finishQueue)
  pass.setBindGroup(0, groups.finish)
  pass.dispatchWorkgroups(1, 1, 1)
}

/** What the pool is made over: the levels' uniform, the published table, the probe queue the pool writes. */
interface PoolParts {
  grid: GPUBuffer
  published: GPUTextureView
  queue: GPUBuffer
}

/** What the pool keeps between two images. */
interface PoolKit {
  readonly cascades: BounceCascades
  readonly grid: GPUBuffer
  readonly buffers: ReturnType<typeof createPoolBuffers>
  readonly compiled: Awaited<ReturnType<typeof compilePool>>
  readonly imageMarks: Awaited<ReturnType<typeof createImageMarks>>
  readonly probeMarks: Awaited<ReturnType<typeof createProbeMarks>>
  readonly groups: ReturnType<typeof createPoolGroups>
  readonly stats: PoolStats
  readonly ring: ReturnType<typeof createPoolStats>['ring']
  readonly writeParams: ReturnType<typeof createPoolParams>
  readonly debt: ReturnType<typeof createMarkDebt>
  staging: GPUBuffer | undefined
  /** The lights changed: the next pass forgets the traces every probe took. */
  pendingRestart: boolean
}

/** Whether the series is open (`BouncePool.working`). */
const poolWorking = ({ debt, pendingRestart, ring, stats }: PoolKit) =>
  debt.owed > 0 || pendingRestart || ring.held() > 0 || stats.unfilled > 0 || stats.refreshing > 0

/** The pool's work in the bounce pass (`BouncePool.dispatch`). */
function dispatchPool(
  kit: PoolKit,
  pass: GPUComputePassEncoder,
  work: PoolWork,
  surface: MarkSurface | undefined,
) {
  kit.writeParams(work)
  if (work.marking && surface) {
    if (surface.probes) kit.probeMarks.dispatch(pass, surface.probes)
    else kit.imageMarks(pass, surface)
    for (const marker of surface.markers) marker.mark(pass, kit.grid, kit.buffers.marks)
  }
  encodePoolKernels(pass, kit.compiled, kit.groups, kit.buffers.args, work, kit.pendingRestart)
  kit.pendingRestart = false
}

/** The pool's buffers, kernels and marks, made. */
async function createPoolKit(
  device: GPUDevice,
  cascades: BounceCascades,
  parts: PoolParts,
): Promise<PoolKit> {
  const buffers = createPoolBuffers(device, cascades.probes)
  const compiled = await compilePool(device)
  const { stats, ring } = createPoolStats(device)
  return {
    cascades,
    grid: parts.grid,
    buffers,
    compiled,
    imageMarks: await createImageMarks(device, parts.grid, buffers.marks),
    probeMarks: await createProbeMarks(device, parts.grid, buffers.marks),
    groups: createPoolGroups(device, compiled, buffers, parts),
    stats,
    ring,
    writeParams: createPoolParams(device, buffers.params),
    debt: createMarkDebt(),
    staging: undefined,
    pendingRestart: false,
  }
}

/**
 * THE POOL OF PROBES, on the GPU (`poolWgsl.ts`): a fixed count of probes, given to the cells the image reads and given back, and
 * the choice of those traced each image, none of it read back to be decided. An image that marks (`begin`: its view differs from the
 * last mark's, its levels slid, the placements or the lights changed, or marks are owed) marks the points of the screen probes the last
 * image cast — the image's own surface where it cast none —, the cells round them taking a probe from the pool or being refused one;
 * every image the pool works in chooses the probes traced, by the budget, and writes the queue and the arguments of the dispatches
 * over it, which the passes that read it are dispatched by (`args`). The CPU is told, a few images late, how many probes are alive,
 * hold nothing yet or are short of their updates (`stats`): the series is open while any are (`working`).
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
    /** Whether the series is open: marks owed, a restart not yet encoded, statistics still to come back, or probes alive that hold nothing
     *  yet or are short of their updates, as the last statistics counted them. */
    get working() {
      return poolWorking(kit)
    },
    /** The placements moved or arrived: the cells the image reads are marked again, from the next image that draws. */
    stale: kit.debt.stale,
    /** Every probe is traced again, up to `settledTraces` times, from the next pass. */
    restart() {
      kit.pendingRestart = true
    },
    /**
     * Whether the image marks: its view differs from the last mark's, its levels `slid`, the placements or the lights changed or marks are
     * owed. An image that drew no surface (`surface` none) owes none.
     */
    begin(surface: MarkSurface | undefined, slid: boolean) {
      const marking = kit.debt.due(surface, slid)
      if (marking) kit.debt.paid()
      return marking
    },
    /** The marks' bitmap cleared and a staging buffer taken for the statistics, before the pass. */
    clear(encoder: GPUCommandEncoder, work: Pick<PoolWork, 'marking'>) {
      kit.staging = ring.take()
      if (work.marking) encoder.clearBuffer(buffers.marks)
    },
    /**
     * The pool's work in the bounce pass: the cells the image reads marked (from the screen probes' points where `surface` holds them, else
     * from the image's surface), and the pool's kernels. The arguments of the dispatches over the queue are written at its end.
     */
    dispatch(pass: GPUComputePassEncoder, work: PoolWork, surface: MarkSurface | undefined) {
      dispatchPool(kit, pass, work, surface)
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
      kit.probeMarks.destroy()
      for (const buffer of Object.values(buffers)) buffer.destroy()
    },
  }
}

/** The pool, made. */
export type BouncePool = Awaited<ReturnType<typeof createBouncePool>>
