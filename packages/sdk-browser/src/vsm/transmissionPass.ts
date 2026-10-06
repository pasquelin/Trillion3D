/**
 * Host side of the translucent casters' transmission (`transmissionWgsl.ts`): made with the first
 * blended caster, then encoded each frame after the opaque VSM raster and before the projection,
 * all in compute:
 *
 *   vsm.transmission.clear (a redrawn slice stamped, a redrawn or freed slice's blocks given back)
 *   → vsm.transmission.bin (candidates, then per chunk of blended rows the opaque raster's cull,
 *   each command's redrawn pages, each command's triangles projected once and recorded in its pages)
 *   → vsm.transmission.resolve (the slices numbered, the records placed, each slice's cells built in
 *   its group and written with its records into blocks, the page headers of the slices that changed).
 *
 * The blended candidates take the same static / dynamic rule as every caster (engine mobility),
 * into the same slice of the page as the depth would: a slice is rebuilt exactly when the VSM
 * redraws that slice, and a still scene rebuilds none. Every dispatch past the clear is indirect
 * on what the GPU counted: a still frame dispatches no group of them.
 *
 * A row is decoded and projected once per command (one level of one map), not once per page it
 * reaches, and no global atomic is issued per cell: a sea strip's command reaches ~80–120 pages
 * of which it touches ~10, so the old group per (row, page) decoded every triangle ~10 times for
 * nothing, and each covered cell took a node by an atomic on one counter, ~1 M a frame on a
 * moving sea.
 *
 * Capacities (`VsmTransmissionCaps`) start from the pool's pages: 64 records a page (a sea page
 * holds ~10–40 triangles, a page covered with 10-pixel triangles ~52), one block a page (a sea
 * page's slice takes one), and a page-sized textured pane's patch (130² words, a power of two up).
 * A frame that wanted more says so through the feedback a few frames late; the owner grows once to
 * the power of two that holds it.
 */
import {
  createVsmRowBound,
  vsmWorstChunk,
  type VsmBoundLight,
  type VsmChunk,
  type VsmRowBound,
} from './rowPageBound.ts'
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { vsmBufferEntry, vsmComputePipe } from './passKit.ts'
import { ceilDiv, roundUpPow2, type VsmLayout } from './layout.ts'
import { storageBufferCap } from '../residency/pools.ts'
import { PORTABLE_TEXTURE_SIDE } from '../frame/referenceTilePlacement.ts'
import { createVsmReadbackRing } from './readbackRing.ts'
import { vsmWriteChanged } from './writeChanged.ts'
import { shadowPageEntries } from '../webgpu/shadow/pageGroup.ts'
import {
  VSM_RENDER_ARGS_EXPAND,
  VSM_RENDER_ARGS_STRIDE_WORDS,
  VSM_RENDER_CULL_SPECS,
  VSM_RENDER_PARAMS_SLOT,
  vsmRenderCullWgsl,
} from './renderCullWgsl.ts'
import {
  encodeVsmCandidates,
  encodeVsmChunkCommands,
  vsmBufferGroup,
  vsmChunkKernels,
  vsmChunkListGroups,
  vsmChunkListSizes,
  vsmChunkRows,
  vsmChunkRowsWithin,
  vsmContextBytes,
  vsmDrawFloorBytes,
  vsmEnsureLists,
  vsmReleaseContext,
  vsmRenderParamsEntry,
  vsmRenderStorage,
  vsmRenderViews,
  vsmSceneRowsMoved,
  vsmSetChunking,
  vsmWriteChunkParams,
  type VsmChunkKernels,
  type VsmRenderScene,
} from './renderPass.ts'
import {
  type VsmFrameBuffers,
  type VsmResources,
  vsmBindGroupEntries,
  vsmBindGroupLayoutEntries,
  vsmPerFrameSet,
} from './resources.ts'
import {
  VSM_TRANSMISSION_CLEAR_SPECS,
  VSM_TRANSMISSION_HEADER_BYTES,
  VSM_TRANSMISSION_NONE,
  VSM_TRANSMISSION_PAGE_BYTES,
  VSM_TRANSMISSION_PAGE_GROUP,
  VSM_TRANSMISSION_PAGES_SPECS,
  vsmTransmissionBinWgsl,
  vsmTransmissionCandidatesWgsl,
  vsmTransmissionClearWgsl,
  vsmTransmissionNumberWgsl,
  vsmTransmissionPagesWgsl,
  vsmTransmissionPlaceWgsl,
  vsmTransmissionResolveWgsl,
} from './transmissionWgsl.ts'
import {
  headerRows,
  VSM_TRANSMISSION_ARGS_AT,
  VSM_TRANSMISSION_ARGS_WORDS,
  VSM_TRANSMISSION_BLOCKS_A_ROW,
  VSM_TRANSMISSION_COUNTER_WORDS,
  VSM_TRANSMISSION_COUNTERS,
  VSM_TRANSMISSION_FEEDBACK_BYTES,
  VSM_TRANSMISSION_FORMAT,
  VSM_TRANSMISSION_UNIFORM_BYTES,
  VSM_TRANSMISSION_WIDTH,
  vsmTransmissionBytes,
  vsmTransmissionFirstCaps,
  vsmTransmissionMemoryDescriptor,
  vsmTransmissionRegions,
  type VsmTransmissionCaps,
} from './transmissionLayout.ts'

/** Blended candidates a chunk takes: its page list holds this many times the pool's pages. */
const CHUNK_ROWS = 64

/** The tables, the build buffer and the readable memory, made for one VSM resource set. */
export interface VsmTransmission {
  layout: VsmLayout
  caps: VsmTransmissionCaps
  /** Page × slice → first block (none: `VSM_TRANSMISSION_NONE`), persistent. */
  table: GPUBuffer
  /** [free count, spare, free blocks…]. */
  pool: GPUBuffer
  /** Each block's next in its slice's chain. */
  links: GPUBuffer
  /** Counters, each slice's stamp, first place and counts, the frame's slices, the dirty list, the
   *  order, records and patches (`vsmTransmissionRegions`). */
  build: GPUBuffer
  /** The indirect dispatches the GPU writes (`VSM_TRANSMISSION_ARGS_WORDS`). */
  args: GPUBuffer
  uniform: GPUBuffer
  memory: GPUTexture
  /** The read view (2-D array of one layer, uint), what the consumers bind. */
  view: GPUTextureView
  storageView: GPUTextureView
  /** The capacities a frame wanted past these (read back late): the owner grows to them. Never once
   *  `capped`: no frame waits for a growth that will not come (`vsmUnsettled`). */
  wanted?: VsmTransmissionCaps
  /** Slices a frame found past the longest chain, as last read: drawn uncoloured. */
  full: number
  /** True once the GPU budget or the device held no larger capacities. */
  capped: boolean
  /** Copies the counters out after the frame's submit. */
  readFeedback(encoder: GPUCommandEncoder): void
  afterSubmit(): void
  /** Every byte it asked the device for (`vsmTransmissionBytes`). */
  bytes: number
  destroy(): void
}

/**
 * The largest capacities a device of `limits` holds for `layout`: the blocks the largest texture
 * holds below the page headers, and the build buffer within one storage binding
 * (`storageBufferCap`). A growth stops there.
 */
export function vsmTransmissionMostCaps(
  layout: VsmLayout,
  limits?: Parameters<typeof storageBufferCap>[0] & { maxTextureDimension2D?: number },
) {
  const side = limits?.maxTextureDimension2D ?? PORTABLE_TEXTURE_SIDE
  return {
    blocks: (side - headerRows(layout.poolPages)) * VSM_TRANSMISSION_BLOCKS_A_ROW,
    buildWords: Math.floor(storageBufferCap(limits) / 4),
  }
}

/** Whether `caps` fit a device of `limits`. */
export function vsmTransmissionFits(
  layout: VsmLayout,
  caps: VsmTransmissionCaps,
  limits?: Parameters<typeof vsmTransmissionMostCaps>[1],
) {
  const most = vsmTransmissionMostCaps(layout, limits)
  return (
    caps.blocks <= most.blocks &&
    vsmTransmissionRegions(layout.poolPages, caps).words <= most.buildWords
  )
}

/** The capacities that hold what a frame counted (`counters`, the build buffer's first words):
 *  each short one to the power of two at or above its need, none when all held. */
function vsmTransmissionWanted(
  caps: VsmTransmissionCaps,
  counters: Uint32Array,
): VsmTransmissionCaps | undefined {
  const C = VSM_TRANSMISSION_COUNTERS
  const grow = (held: number, need: number) => (need > held ? roundUpPow2(need) : held)
  const next = {
    records: grow(caps.records, counters[C.records]),
    patchWords: grow(caps.patchWords, counters[C.patchWords]),
    blocks: grow(caps.blocks, caps.blocks + counters[C.blocksShort]),
  }
  const same = (Object.keys(next) as (keyof VsmTransmissionCaps)[]).every(
    (key) => next[key] === caps[key],
  )
  return same ? undefined : next
}

/** The transmission of `caps` for `layout`; one `grownFrom` a smaller one of that layout keeps
 *  its draw context, which depends on the layout alone. */
export function createVsmTransmission(
  device: GPUDevice,
  layout: VsmLayout,
  caps = vsmTransmissionFirstCaps(layout.poolPages),
  grownFrom?: VsmTransmission,
): VsmTransmission {
  const pages = layout.poolPages
  const storage = (label: string, bytes: number, extra = 0) =>
    device.createBuffer({
      label: `vsm.transmission.${label}`,
      size: bytes,
      usage: vsmRenderStorage() | extra,
    })
  // Two slices a physical page: dynamic, static.
  const table = storage('table', 2 * pages * 4)
  device.queue.writeBuffer(table, 0, new Uint32Array(2 * pages).fill(VSM_TRANSMISSION_NONE))
  const pool = storage('pool', (caps.blocks + 2) * 4)
  const free = new Uint32Array(caps.blocks + 2)
  free[0] = caps.blocks
  for (let k = 0; k < caps.blocks; k++) free[2 + k] = caps.blocks - 1 - k
  device.queue.writeBuffer(pool, 0, free)
  const links = storage('links', caps.blocks * 4)
  const build = storage(
    'build',
    vsmTransmissionRegions(pages, caps).words * 4,
    GPUBufferUsage.COPY_SRC,
  )
  const args = device.createBuffer({
    label: 'vsm.transmission.args',
    size: VSM_TRANSMISSION_ARGS_WORDS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
  })
  const uniform = device.createBuffer({
    label: 'vsm.transmission.frame',
    size: VSM_TRANSMISSION_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const memory = device.createTexture(
    vsmTransmissionMemoryDescriptor(
      layout,
      caps.blocks,
      GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    ),
  )
  // Every page header none: a page no slice was resolved for reads no block.
  const rows = headerRows(pages)
  device.queue.writeTexture(
    { texture: memory },
    new Uint32Array(4 * VSM_TRANSMISSION_WIDTH * rows).fill(VSM_TRANSMISSION_NONE),
    { bytesPerRow: 16 * VSM_TRANSMISSION_WIDTH, rowsPerImage: rows },
    [VSM_TRANSMISSION_WIDTH, rows],
  )
  // The counters, read back a few frames late.
  const feedback = createVsmReadbackRing(
    device,
    {
      label: 'vsm.transmission.feedback',
      bytes: VSM_TRANSMISSION_FEEDBACK_BYTES,
      count: 2,
      eager: true,
    },
    (mapped) => {
      const counters = new Uint32Array(mapped)
      trans.full = counters[VSM_TRANSMISSION_COUNTERS.full]
      if (trans.capped) return
      const wanted = vsmTransmissionWanted(trans.wanted ?? trans.caps, counters)
      if (wanted) trans.wanted = wanted
    },
  )
  const trans: VsmTransmission = {
    layout,
    caps,
    table,
    pool,
    links,
    build,
    args,
    uniform,
    memory,
    view: memory.createView({ dimension: '2d-array' }),
    storageView: memory.createView({ dimension: '2d' }),
    full: 0,
    capped: false,
    readFeedback(encoder) {
      // A copy whose frame was never submitted is still pending: this frame's copy reuses it.
      const buffer = feedback.take()
      if (buffer) encoder.copyBufferToBuffer(build, 0, buffer, 0, VSM_TRANSMISSION_FEEDBACK_BYTES)
    },
    afterSubmit: feedback.submitted,
    bytes: vsmTransmissionBytes(layout, caps),
    destroy() {
      feedback.destroy()
      for (const buffer of [table, pool, links, build, args, uniform]) buffer.destroy()
      memory.destroy()
    },
  }
  const kept = grownFrom && contexts.get(grownFrom)
  if (kept) contexts.set(trans, kept)
  return trans
}

type Pipe = ReturnType<typeof vsmComputePipe>

interface Ctx extends VsmChunkKernels {
  device: GPUDevice
  clear: Pipe
  candidates: Pipe
  pages: Pipe
  bin: Pipe
  number: Pipe
  place: Pipe
  resolve: Pipe
  headers: Pipe
  /** The groups over one transmission's buffers (`transmissionGroups`), made again for another. */
  groups?: TransmissionGroups
  buffers: Partial<
    Record<'params' | 'views' | 'candidates' | 'counts' | 'cmds' | 'pairs' | 'args', GPUBuffer>
  >
  /** What the chunk groups bound when made (`chunkGroups`). */
  bound: WebgpuBindIdentity
  /** The chunk groups over those alone, made again when one of them moved. */
  lists?: ChunkLists
  /** The chunk groups over the tables of a frame set (`res.current`), made once a set. */
  tables: WeakMap<VsmFrameBuffers, ChunkTables>
  /** Where the blended rows are, binned for the chunks' bound. */
  rowBound: VsmRowBound
}

/** The groups of the clear, the number, the place and the resolve of one transmission. */
interface TransmissionGroups {
  trans: VsmTransmission
  /** The clear's group of the VSM tables, by the frame's tables it binds. */
  clear0: WeakMap<VsmFrameBuffers, GPUBindGroup>
  clear1: GPUBindGroup
  number: GPUBindGroup
  place: GPUBindGroup
  resolve: GPUBindGroup
}

const contexts = new WeakMap<VsmTransmission, Ctx>()

/** Bytes the draw context of `trans` holds on the device: its lists. */
export function vsmTransmissionContextBytes(trans: VsmTransmission) {
  const ctx = contexts.get(trans)
  return ctx ? vsmContextBytes(ctx) : 0
}

/** Frees the draw context of `trans`, which a grown transmission keeps (`grownFrom`). */
export function releaseVsmTransmission(trans: VsmTransmission) {
  const ctx = contexts.get(trans)
  if (ctx) vsmReleaseContext(ctx)
  contexts.delete(trans)
}

/** The transmission's compute pipes of `layout` (`vsmComputePipe`: prepared, shared a device and
 *  text), with the group layouts their kernels bind. */
function vsmTransmissionPipes(device: GPUDevice, layout: VsmLayout) {
  const C = GPUShaderStage.COMPUTE
  const buf = (binding: number, type: GPUBufferBindingType) => vsmBufferEntry(binding, C, type)
  const pipe = (name: string, code: string, entry: string, groups: GPUBindGroupLayoutEntry[][]) =>
    vsmComputePipe(device, `vsm.transmission.${name}`, code, entry, groups)
  const clear = pipe('clear', vsmTransmissionClearWgsl(layout), 'vsmTransmissionClear', [
    vsmBindGroupLayoutEntries(VSM_TRANSMISSION_CLEAR_SPECS, layout, C),
    [buf(0, 'uniform'), buf(1, 'storage'), buf(2, 'storage'), buf(3, 'storage'), buf(4, 'storage')],
  ])
  const resolveCode = vsmTransmissionResolveWgsl(layout)
  const resolveGroups = [
    [
      buf(0, 'uniform'),
      ...[1, 2, 3, 4].map((b) => buf(b, 'storage')),
      {
        binding: 5,
        visibility: C,
        storageTexture: { access: 'write-only', format: VSM_TRANSMISSION_FORMAT },
      } as GPUBindGroupLayoutEntry,
    ],
  ]
  return {
    clear,
    candidates: pipe('candidates', vsmTransmissionCandidatesWgsl(), 'vsmTransmissionCandidates', [
      [
        vsmRenderParamsEntry(0),
        ...[1, 2, 3, 4].map((b) => buf(b, 'read-only-storage')),
        buf(5, 'storage'),
        buf(6, 'storage'),
        buf(7, 'uniform'),
      ],
    ]),
    pages: pipe('pages', vsmTransmissionPagesWgsl(layout), 'vsmTransmissionPages', [
      vsmBindGroupLayoutEntries(VSM_TRANSMISSION_PAGES_SPECS, layout, C),
      [
        vsmRenderParamsEntry(0),
        buf(1, 'read-only-storage'),
        buf(2, 'storage'),
        buf(3, 'storage'),
        buf(4, 'read-only-storage'),
        buf(5, 'uniform'),
      ],
    ]),
    bin: pipe('bin', vsmTransmissionBinWgsl(layout), 'vsmTransmissionBin', [
      shadowPageEntries(),
      [
        buf(0, 'read-only-storage'),
        buf(1, 'read-only-storage'),
        buf(2, 'uniform'),
        buf(3, 'storage'),
      ],
    ]),
    number: pipe('number', vsmTransmissionNumberWgsl(layout), 'vsmTransmissionNumber', [
      [buf(0, 'uniform'), buf(1, 'storage'), buf(2, 'storage')],
    ]),
    place: pipe('place', vsmTransmissionPlaceWgsl(layout), 'vsmTransmissionPlace', [
      [buf(0, 'uniform'), buf(1, 'storage')],
    ]),
    resolve: pipe('resolve', resolveCode, 'vsmTransmissionResolve', resolveGroups),
    headers: pipe('resolve', resolveCode, 'vsmTransmissionHeaders', resolveGroups),
  }
}

function context(trans: VsmTransmission, device: GPUDevice): Ctx {
  const existing = contexts.get(trans)
  if (existing && existing.device === device) return existing
  const { layout } = trans
  const ctx: Ctx = {
    device,
    ...vsmTransmissionPipes(device, layout),
    ...vsmChunkKernels(
      device,
      layout,
      'vsm.transmission',
      vsmRenderCullWgsl(layout, { marksDirty: false }),
    ),
    buffers: {},
    bound: createWebgpuBindIdentity(),
    tables: new WeakMap(),
    rowBound: existing?.rowBound ?? createVsmRowBound(),
  }
  contexts.set(trans, ctx)
  return ctx
}

export interface VsmTransmissionFrame {
  device: GPUDevice
  lights: readonly VsmBoundLight[]
  /** Unique per frame, never 0: the clear's stamp. */
  stamp: number
  /** The blended caster rows `[rowFirst, rowEnd)`. */
  rowFirst: number
  rowEnd: number
  /** Rows in use among them: the candidates' bound, which sizes the chunks. */
  used: number
}

/** What a frame's bin takes: its views, its chunks within the GPU budget's room
 *  (`vsmChunkRowsWithin`), and the commands and pages a chunk's lists hold. */
interface BinPlan {
  views: number[]
  rowCount: number
  used: number
  within: ReturnType<typeof vsmChunkRowsWithin<ReturnType<ReturnType<typeof transmissionSizes>>>>
  chunks: number
  cmds: number
  pairs: number
}

/**
 * Clears, bins and resolves the transmission slices this frame redraws. Between `encodeVsmRender`
 * and `encodeVsmAfterRaster` (it reads `res.current`). Returns the rows a chunk took within the
 * GPU budget's room (`vsmChunkRowsWithin`), none without a bin.
 */
export function encodeVsmTransmission(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  trans: VsmTransmission,
  frame: VsmTransmissionFrame,
  scene: VsmRenderScene,
) {
  const { device } = frame
  const ctx = context(trans, device)
  const { layout, caps } = trans
  const plan = binPlan(ctx, trans, frame, scene)
  const regions = vsmTransmissionRegions(layout.poolPages, caps)
  uniformImage[0] = frame.stamp >>> 0
  uniformImage[1] = frame.rowFirst
  uniformImage[2] = caps.records
  uniformImage[3] = caps.patchWords
  uniformImage[4] = caps.blocks
  uniformImage[5] = regions.records
  uniformImage[6] = regions.patches
  uniformImage[7] = plan?.within.size ? plan.cmds : 0
  uniformImage[8] = plan?.within.size ? plan.pairs : 0
  vsmWriteChanged(device, trans.uniform, uniformImage, 0, uniformImage.length)

  const groups = transmissionGroups(device, ctx, trans)
  encoder.clearBuffer(trans.build, 0, VSM_TRANSMISSION_COUNTER_WORDS * 4)
  {
    const pass = encoder.beginComputePass({ label: 'vsm.transmission.clear' })
    pass.setPipeline(ctx.clear.pipeline)
    pass.setBindGroup(0, clearTablesGroup(device, ctx, groups, res))
    pass.setBindGroup(1, groups.clear1)
    pass.dispatchWorkgroups(ceilDiv(layout.poolPages, VSM_TRANSMISSION_PAGE_GROUP))
    pass.end()
  }
  if (plan?.within.size) encodeBin(encoder, res, trans, ctx, scene, plan)

  // Resolve: the slices numbered, a thread a record placed, a group a slice, a thread a dirty slice.
  {
    const pass = encoder.beginComputePass({ label: 'vsm.transmission.resolve' })
    pass.setPipeline(ctx.number.pipeline)
    pass.setBindGroup(0, groups.number)
    pass.dispatchWorkgroups(1)
    pass.setPipeline(ctx.place.pipeline)
    pass.setBindGroup(0, groups.place)
    pass.dispatchWorkgroupsIndirect(trans.args, VSM_TRANSMISSION_ARGS_AT.place)
    for (const [pipe, at] of [
      [ctx.resolve, VSM_TRANSMISSION_ARGS_AT.resolve],
      [ctx.headers, VSM_TRANSMISSION_ARGS_AT.headers],
    ] as const) {
      pass.setPipeline(pipe.pipeline)
      pass.setBindGroup(0, groups.resolve)
      pass.dispatchWorkgroupsIndirect(trans.args, at)
    }
    pass.end()
  }
  return plan?.within || undefined
}

// The frame's scratch of `encodeVsmTransmission`, rewritten each frame.
const uniformImage = new Uint32Array(VSM_TRANSMISSION_UNIFORM_BYTES / 4)
const viewList: number[] = []
const binPass: GPUComputePassDescriptor = { label: 'vsm.transmission.bin' }
/** Each chunk's parameter offset, made once for every frame. */
const chunkOffsets: number[][] = []
const chunkOffset = (c: number) => (chunkOffsets[c] ??= [c * VSM_RENDER_PARAMS_SLOT])

/** The groups of the clear, the number, the place and the resolve of `trans`: made once per
 *  transmission. */
function transmissionGroups(device: GPUDevice, ctx: Ctx, trans: VsmTransmission) {
  if (ctx.groups?.trans === trans) return ctx.groups
  const { uniform, build, table, pool, links } = trans
  return (ctx.groups = {
    trans,
    clear0: new WeakMap(),
    clear1: vsmBufferGroup(device, ctx.clear.groups[1], [uniform, build, table, pool, links]),
    number: vsmBufferGroup(device, ctx.number.groups[0], [uniform, build, trans.args]),
    place: vsmBufferGroup(device, ctx.place.groups[0], [uniform, build]),
    resolve: device.createBindGroup({
      layout: ctx.resolve.groups[0],
      entries: [
        ...[uniform, build, table, pool, links].map((buffer, binding) => ({
          binding,
          resource: { buffer },
        })),
        { binding: 5, resource: trans.storageView },
      ],
    }),
  })
}

/** The clear's group of the VSM tables this frame reads (`res.current`), made once per set. */
function clearTablesGroup(
  device: GPUDevice,
  ctx: Ctx,
  groups: TransmissionGroups,
  res: VsmResources,
) {
  let group = groups.clear0.get(res.current)
  if (!group) {
    group = device.createBindGroup({
      layout: ctx.clear.groups[0],
      entries: vsmBindGroupEntries(res, VSM_TRANSMISSION_CLEAR_SPECS),
    })
    groups.clear0.set(res.current, group)
  }
  return group
}

/** The transmission's lists for a chunk of `rows` of its `used` blended rows, by buffer: the
 *  render lists, its page list holding a header a command and the pages after them. */
const transmissionSizes =
  (used: number, rowCount: number, viewWords: number, holds: VsmChunk) => (rows: number) => ({
    ...vsmChunkListSizes(rows, used, rowCount, viewWords, holds),
    pairs:
      holds.cmds(rows) * VSM_TRANSMISSION_HEADER_BYTES +
      holds.pairs(rows) * VSM_TRANSMISSION_PAGE_BYTES,
  })

/**
 * The fewest bytes a transmission's chunk lists take to bin `used` of `rowCount` blended rows
 * under views of `viewWords` words and `viewMips` mips at `pages` pages (`vsmDrawFloorBytes`).
 * Asked with the first transmission.
 */
export function vsmTransmissionFloorBytes(
  used: number,
  rowCount: number,
  viewWords: number,
  viewMips: number,
  pages: number,
) {
  if (used <= 0 || rowCount <= 0 || viewWords <= 0) return 0
  const holds = vsmWorstChunk(Math.min(CHUNK_ROWS, used), Math.min(viewMips, pages), pages)
  return vsmDrawFloorBytes(
    Math.min(CHUNK_ROWS, used),
    transmissionSizes(used, rowCount, viewWords, holds),
  )
}

/** The chunk groups over the scene's rows, the lists and the transmission alone (`Ctx.lists`). */
interface ChunkLists {
  trans: VsmTransmission
  cand: GPUBindGroup
  cull1: GPUBindGroup
  args: GPUBindGroup
  pages1: GPUBindGroup
}

/** The chunk groups over the tables of `res.current` (`Ctx.tables`). */
interface ChunkTables {
  cull0: GPUBindGroup
  pages0: GPUBindGroup
  bin1: GPUBindGroup
}

function chunkLists(ctx: Ctx, trans: VsmTransmission, bound: readonly unknown[]): ChunkLists {
  const { device } = ctx
  const { params, counts, pairs, cand, cull1, args } = vsmChunkListGroups(
    device,
    ctx,
    ctx.candidates.groups[0],
    bound,
    [trans.uniform],
  )
  return {
    trans,
    cand,
    cull1,
    args,
    pages1: vsmBufferGroup(device, ctx.pages.groups[1], [
      params,
      ctx.buffers.cmds!,
      counts,
      pairs,
      trans.build,
      trans.uniform,
    ]),
  }
}

function chunkTables(res: VsmResources, ctx: Ctx): ChunkTables {
  const { device } = ctx,
    { trans } = ctx.lists!
  return {
    cull0: device.createBindGroup({
      layout: ctx.cull.groups[0],
      entries: vsmBindGroupEntries(res, VSM_RENDER_CULL_SPECS),
    }),
    pages0: device.createBindGroup({
      layout: ctx.pages.groups[0],
      entries: vsmBindGroupEntries(res, VSM_TRANSMISSION_PAGES_SPECS),
    }),
    bin1: vsmBufferGroup(device, ctx.bin.groups[1], [
      ctx.buffers.pairs!,
      res.current.projectionData,
      trans.uniform,
      trans.build,
    ]),
  }
}

/**
 * The chunk groups this frame: those over the scene's rows, the lists and the transmission
 * (`ctx.lists`) made again only when one of them moved, those over the VSM tables once a frame
 * set: the opaque raster's mechanism (`renderPass.ts: renderGroups`).
 */
function chunkGroups(ctx: Ctx, trans: VsmTransmission, res: VsmResources, scene: VsmRenderScene) {
  const b = ctx.buffers as Required<Ctx['buffers']>
  const bound = ctx.bound.next
  bound[11] = trans.uniform
  bound[12] = trans.build
  bound[13] = trans.args
  if (vsmSceneRowsMoved(ctx.bound, scene, b, 3)) {
    ctx.lists = undefined
    ctx.tables = new WeakMap()
  }
  const lists = (ctx.lists ??= chunkLists(ctx, trans, bound))
  return { lists, tables: vsmPerFrameSet(ctx.tables, res, chunkTables, ctx) }
}

/** The frame's bin: the blended rows' chunks the GPU budget's room holds (`vsmChunkRowsWithin`),
 *  none when not even one row's lists fit; undefined without a view or a row. */
function binPlan(
  ctx: Ctx,
  trans: VsmTransmission,
  frame: VsmTransmissionFrame,
  scene: VsmRenderScene,
): BinPlan | undefined {
  // Map views, as the opaque raster's.
  const { views, viewMips } = vsmRenderViews(frame.lights, viewList)
  const rowCount = Math.max(0, frame.rowEnd - frame.rowFirst)
  if (views.length === 0 || rowCount === 0 || frame.used <= 0) return
  const pages = trans.layout.poolPages
  const used = Math.min(frame.used, rowCount)
  const chosen = vsmChunkRows(
    ctx.rowBound,
    scene.rowSpheres,
    { first: frame.rowFirst, end: frame.rowEnd, candidates: used },
    frame.lights,
    {
      rows: Math.min(CHUNK_ROWS, used),
      cmdsPerRow: Math.min(viewMips, pages),
      pages,
      cap: CHUNK_ROWS * pages,
    },
  )
  const within = vsmChunkRowsWithin(
    frame.device,
    ctx.buffers,
    chosen.rows,
    transmissionSizes(used, rowCount, views.length, chosen),
  )
  const chunkRows = within.rows
  // The opaque raster's parameter slots (`renderPass.ts`), `rowCount` = the blended rows.
  if (within.size)
    vsmSetChunking(
      { rowCount, viewCount: views.length / 4, chunks: ceilDiv(used, chunkRows), chunkRows },
      chosen,
    )
  return {
    views,
    rowCount,
    used,
    within,
    chunks: within.size ? ceilDiv(used, chunkRows) : 0,
    cmds: chosen.cmds(chunkRows),
    pairs: chosen.pairs(chunkRows),
  }
}

/** The blended rows' bin, in the chunks `plan` holds: candidates, then per chunk the cull, its
 *  commands' redrawn pages and the bin, every dispatch in one compute pass. */
function encodeBin(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  trans: VsmTransmission,
  ctx: Ctx,
  scene: VsmRenderScene,
  plan: BinPlan,
) {
  const { device } = ctx
  const { params, views, counts, args } = vsmEnsureLists(ctx, 'vsm.transmission', plan.within.size!)
  vsmWriteChunkParams(device, scene.camera, params, views, plan.views)
  encoder.clearBuffer(counts, 0, plan.within.size!.counts)

  const { lists, tables } = chunkGroups(ctx, trans, res, scene)
  const pass = encoder.beginComputePass(binPass)
  encodeVsmCandidates(pass, ctx.candidates.pipeline, lists.cand, ctx, lists.args, plan.rowCount)
  const cull = { cull0: tables.cull0, cull1: lists.cull1, args: lists.args }
  for (let c = 0; c < plan.chunks; c++) {
    const offset = chunkOffset(c)
    encodeVsmChunkCommands(pass, ctx, cull, args, c, offset)
    // A group per command, as the expand's arguments: its pages, then its triangles.
    const at = (c * VSM_RENDER_ARGS_STRIDE_WORDS + VSM_RENDER_ARGS_EXPAND) * 4
    pass.setPipeline(ctx.pages.pipeline)
    pass.setBindGroup(0, tables.pages0)
    pass.setBindGroup(1, lists.pages1, offset)
    pass.dispatchWorkgroupsIndirect(args, at)
    pass.setPipeline(ctx.bin.pipeline)
    pass.setBindGroup(0, scene.pageGroup)
    pass.setBindGroup(1, tables.bin1)
    pass.dispatchWorkgroupsIndirect(args, at)
  }
  pass.end()
}
