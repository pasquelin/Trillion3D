import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { PAGE_SIZE } from '../../../../../sdk-core/src/lighting/surfaceCache/cardResolution.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { heldGroup, type HeldGroup } from '../../../gpu/bind/bindIdentity.ts'
import { createRecordTexture, type RecordTexture } from '../../../gpu/core/recordTexture.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { presentClassKeys } from '../../../gpu/core/presentClasses.ts'
import { createReadbackRing, type ReadbackRing } from '../../../gpu/core/readbackRing.ts'
import { sizedBuffer } from '../../../gpu/core/sizedBuffer.ts'
import { noiseViewOn } from '../../../gpu/noise/blueNoiseTextures.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { FLAG_TABLE } from '../../../geometry/dag/cut/cutTables.ts'
import type { CutTables } from '../../../geometry/dag/cut/cutReaders.ts'
import {
  DAG_ARGS,
  DAG_ARGS_INITIAL,
  DAG_ARM_BINDING,
} from '../../../geometry/dag/shader/armWgsl.ts'
import { DAG_UNIFORM_BYTES } from '../../../geometry/dag/shader/viewsWgsl.ts'
import { BLOCK_MASK_WORDS, FRAME_COUNTERS } from '../../../geometry/dag/shader/floorWgsl.ts'
import { entryWords } from '../../../geometry/dag/shader/descentShape.ts'
import { flagShapeWords } from '../../../geometry/dag/flagSections.ts'
import { copiedWords } from '../../../geometry/dag/readoutWords.ts'
import { viewWord } from '../../../geometry/dag/viewLayout.ts'
import { cutListCaps } from '../../../geometry/dag/lists/cutListCaps.ts'
import { visibleBytes } from '../../../geometry/dag/visible/layout.ts'
import { createGpuDecode, type DecodeInputs } from '../../../visibility/decode/decode.ts'
import { DECODE_ARGS_BYTES, DEFORM } from '../../../visibility/decode/contract.ts'
import { PAGE_INFO } from '../../../visibility/pageInfo.ts'
import { RASTER_PASS_MAIN } from '../../../visibility/raster/contract.ts'
import { createRasterBindings } from '../../../visibility/raster/bindings.ts'
import type { GpuRasterInput } from '../../../visibility/raster/types.ts'
import { VIS_UNIFORM } from '../../../visibility/shader/uniformLayout.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { CARD_COUNT, CARD_DESCENT_SHAPE, CARD_PARAMS, cardCountWords } from './cardDescentWgsl.ts'
import { chainReady } from '../../deferred/fullscreen.ts'
import { askCardPipes, cardDescentPipes, cardEndPipes, cardRasterPipes } from './cardPipes.ts'
import { cardTableWords, writeCardViews, type CardViewSource } from './cardViewTable.ts'
import type { CardBatch, CardRaster } from './raster.ts'

/**
 * THE RASTER OF THE CARDS' VIEWS (`raster.ts`), over the engine's own: the pages of an image are drawn
 * from their views in one go, as the reference draws up to its captures a frame in one mesh pass, and
 * the engine's raster of clusters (`../../../visibility/raster/`) writes what each sees.
 *
 *  1. the views of the pages whose placement the cut holds (`rankOf`), laid in a table
 *     (`cardViewTable.ts`) in the order of their placements;
 *  2. the descent of the cut's hierarchy over those views and the cull of the clusters of the pages it
 *     lists, one record in the list of visible clusters for each cluster and view that draws it
 *     (`cardDescentWgsl.ts`); the engine's decode (`../../../visibility/decode/`) makes each its row,
 *     which takes its view (`cardRows`);
 *  3. the raster of the rows into the visibility buffer, depth then identifiers (`cardRasterWgsl.ts`);
 *  4. the export of the buffer into the capture atlas's identifiers and depth over each view's
 *     rectangle, and of the views into the rows of the identifier texture past the atlas, where the
 *     surfaces' shading reads them (`shade.ts`).
 * Every page of the image whose placement the cut holds is drawn, up to the atlas's rows of views
 * (`CaptureTargets.viewRows`) and to what the room of the rows has held; the others are not and are
 * asked again. A view whose records, or whose descent, were cut short by a budget (the shared room of
 * the rows, the pages and the nodes the descent may list) is incomplete: the counters that say so come
 * back a few images late through a ring, a batch at a time (`CardBatch`), and the pages of such a view
 * are not confirmed. A batch that lost something halves the views the next images draw, a clean one
 * doubles them again. What the engine's raster does
 * not draw of a cluster, it does not draw here either: a displaced surface is flat, a line, a sprite and
 * a voxel brick are left out.
 */

/** The rows a view may hold at most, for the list of visible clusters and the decoded rows. */
const ROWS_PER_VIEW = 128
const MOST_ROWS = 1 << 16
const LEAST_ROWS = 1024
/** The views an image holds records of at most, the rows of the capture atlas past its image; and the
 *  pages and nodes a view may list at most, for the descent's mask of pages and its budgets. */
export const MOST_VIEWS = 2048
/** Batches whose counters are in flight at once; an image draws none while all are. */
const IN_FLIGHT = 8

/** The side of the export's workgroups, in texels (`cardRasterWgsl.ts`: 8 × 8 a view). */
const EXPORT_TILE = 8

/** The decode of the capture's rows, one a device (its groups follow the buffers they name). */
const cardDecode = oncePerDevice(createGpuDecode)

const PAGE_BYTES = PAGE_INFO.words * 4
/** Storage a copy writes, read when a buffer is made (the GPU globals exist only there). */
const storage = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST

/** The rows the capture holds room for, `views` views at most. */
const rowsFor = (views: number) => clamp(views * ROWS_PER_VIEW, LEAST_ROWS, MOST_ROWS)

/** The bytes the capture holds beside the atlases for a capture atlas of `side` texels and `views`
 *  views a frame: the visibility buffer, the table of views and the rows. */
export function cardRasterBytes(side: number, views: number) {
  const rows = rowsFor(views)
  return (
    side * side * 8 +
    cardTableWords(views) * 4 +
    visibleBytes(rows) +
    rows * PAGE_BYTES +
    4 * (DEFORM.at + DEFORM.list + rows)
  )
}

/** The buffers of a capture of a `side` and `views`: made again when either changes. */
function createBuffers(device: GPUDevice, side: number, views: number) {
  const rows = rowsFor(views)
  const make = (label: string, size: number, usage: GPUBufferUsageFlags) =>
    device.createBuffer({
      label: `Trillion3D card capture ${label}`,
      size: Math.max(16, size),
      usage,
    })
  const uniforms = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  const atlas = make('atlas', 16, uniforms)
  device.queue.writeBuffer(atlas, 0, Uint32Array.of(side, 0, 0, 0))
  const uniform = make('uniform', VIS_UNIFORM.words * 4, uniforms)
  const viewport = new Float32Array(VIS_UNIFORM.words)
  viewport[VIS_UNIFORM.at.viewport] = viewport[VIS_UNIFORM.at.viewport + 1] = side
  device.queue.writeBuffer(uniform, 0, viewport)
  const owned = {
    atlas,
    uniform,
    params: make('parameters', CARD_PARAMS.words * 4, uniforms),
    table: make('views', cardTableWords(views) * 4, storage()),
    counts: make(
      'counters',
      cardCountWords(views) * 4,
      storage() | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC,
    ),
    work: make('visibility', side * side * 8, storage()),
    visible: make('visible clusters', visibleBytes(rows), storage()),
    pages: make('rows', rows * PAGE_BYTES, storage()),
    decodeWork: make('decode work', 4 * (DEFORM.at + DEFORM.list + rows), storage()),
    decodeArgs: make('decode arguments', DECODE_ARGS_BYTES, storage() | GPUBufferUsage.INDIRECT),
  }
  const table = new ArrayBuffer(cardTableWords(views) * 4)
  const params = new ArrayBuffer(CARD_PARAMS.words * 4)
  return {
    ...owned,
    side,
    views,
    rows,
    /** The table of views as laid before it goes up, and the parameters. */
    table32: { bytes: table, u: new Uint32Array(table), f: new Float32Array(table) },
    params32: { bytes: params, u: new Uint32Array(params), f: new Float32Array(params) },
    dispose() {
      for (const buffer of Object.values(owned)) buffer.destroy()
    },
  }
}
type Buffers = ReturnType<typeof createBuffers>

/** The descent's buffers, which follow the cut they read: its uniform block, its lists, its readout. */
interface Descent {
  readonly block: Uint32Array<ArrayBuffer>
  readonly uniform: GPUBuffer
  readonly args: GPUBuffer
  out?: GPUBuffer
  work?: GPUBuffer
  flags?: RecordTexture
  readonly groups: Record<'cut' | 'card' | 'arm' | 'rows' | 'export', HeldGroup>
}

function createDescent(device: GPUDevice): Descent {
  const args = device.createBuffer({
    label: 'Trillion3D card capture descent args',
    size: DAG_ARGS_INITIAL.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(args, 0, DAG_ARGS_INITIAL)
  return {
    block: new Uint32Array(DAG_UNIFORM_BYTES / 4),
    uniform: device.createBuffer({
      label: 'Trillion3D card capture descent uniform',
      size: DAG_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    args,
    groups: {
      cut: heldGroup(),
      card: heldGroup(),
      arm: heldGroup(),
      rows: heldGroup(),
      export: heldGroup(),
    },
  }
}

/** The bind group `held` keeps over the `count` resources written in its identity's `next`, of `layout`,
 *  made again when one of them moved; its `entries` are asked only then. */
function bound(
  device: GPUDevice,
  held: HeldGroup,
  layout: GPUBindGroupLayout,
  count: number,
  entries: () => GPUBindGroupEntry[],
) {
  held.identity.next.length = count
  if (held.identity.moved() || !held.group)
    held.group = device.createBindGroup({
      label: 'Trillion3D card capture',
      layout,
      entries: entries(),
    })
  return held.group
}

const buffersAt = (...buffers: GPUBuffer[]): GPUBindGroupEntry[] =>
  buffers.map((buffer, binding) => ({ binding, resource: { buffer } }))

/** What the decode names, rewritten each frame. */
const decodeInputs = {} as DecodeInputs

/** What a capture reads of the session. */
interface Session {
  cut: NonNullable<WebgpuPagesRuntime['run']['gpuSelection']>
  placements: NonNullable<WebgpuPagesRuntime['vis']['placementGpu']>
  worlds: NonNullable<NonNullable<WebgpuPagesRuntime['rootWorlds']>['worlds']>
  vis: WebgpuPagesRuntime['vis']
  gpu: WebgpuPagesRuntime['gpu']
}

/** What a capture reads of the session, written into `into`; none while one is missing. */
function sessionOf(rt: WebgpuPagesRuntime, into: Session) {
  const { vis, gpu, run } = rt
  const cut = run.gpuSelection,
    placements = vis.placementGpu,
    worlds = rt.rootWorlds?.worlds
  if (
    !cut ||
    !placements ||
    !worlds ||
    !gpu.cache ||
    !vis.concatPos ||
    !vis.concatUv ||
    !vis.concatNrm ||
    !vis.textures ||
    !vis.mapsSampler ||
    !vis.materialTable.view
  )
    return undefined
  into.cut = cut
  into.placements = placements
  into.worlds = worlds
  into.vis = vis
  into.gpu = gpu
  return into
}

/** The descent's arming between two levels: the lists armed, the cut's group bound again. */
function armDescent(
  pass: GPUComputePassEncoder,
  arm: GPUComputePipeline,
  g: { readonly arm: GPUBindGroup; readonly cut: GPUBindGroup },
) {
  pass.setPipeline(arm)
  pass.setBindGroup(0, g.arm)
  pass.dispatchWorkgroups(1)
  pass.setBindGroup(0, g.cut)
}

/**
 * The raster of the cards' views of the session `rt` on `device`. `rankOf` is the rank, in the cut's
 * tables, of the root a placement of the cache follows, -1 where the cut holds none.
 */
export function createCardRaster(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  rankOf: (placement: number) => number,
): CardRaster {
  let failure: unknown
  let asked: unknown
  let pipes: ReturnType<typeof askCardPipes> = []
  let buffers: Buffers | undefined
  let descent: Descent | undefined
  let bindings: ReturnType<typeof createRasterBindings> | undefined
  let bindingsOf: readonly GPUBuffer[] = []
  const input = {} as GpuRasterInput
  const sources: CardViewSource[] = []
  const order: number[] = []
  const drawn: number[] = []
  const session = {} as Session
  // The batches whose counters came back, and the ones handed out (`landed`); the ring they come through.
  let ring: ReadbackRing<CardBatch> | undefined
  const arrived: CardBatch[] = []
  const handed: CardBatch[] = []
  // The batches drawn that hold a page other than a refresh and are not handed out yet.
  let unsettled = 0
  // The views an image may draw: halved by a batch that lost records, doubled by a clean one.
  let viewLimit = MOST_VIEWS

  /** A batch's counters came back: what it lost, and the views the next images may draw. */
  const arrive = (mapped: ArrayBuffer, _staging: GPUBuffer, batch: CardBatch) => {
    const words = new Uint32Array(mapped, 0, 1 + batch.pages.length)
    let lost = false
    for (let rank = 0; rank < batch.pages.length; rank++) {
      const incomplete = words[0] !== 0 || words[1 + rank] !== 0
      batch.lost[rank] = incomplete ? 1 : 0
      lost ||= incomplete
    }
    viewLimit = lost ? Math.max(1, batch.pages.length >> 1) : Math.min(MOST_VIEWS, viewLimit * 2)
    arrived.push(batch)
  }

  /** The pipes asked for the session's graphs, again when they changed. */
  const compiled = () => {
    if (asked !== rt.vis.rasters) {
      asked = rt.vis.rasters
      pipes = askCardPipes(device, rt.vis.rasters, (error) => void (failure ??= error))
    }
    // Every stage is asked, each missing one now: the capture draws only once all are compiled.
    return chainReady(...pipes.map((pipe) => pipe.prepared)) && cardDecode(device).ready
  }
  compiled()

  /** The descent's lists grown for the cut `tables`, its uniform block written. */
  function prepareDescent(d: Descent, b: Buffers, tables: CutTables, pageCount: number) {
    const { descent: info } = tables
    const nodeBudget = Math.max(
      1,
      Math.min(info.block[viewWord('nodeBudget')]!, b.views * MOST_VIEWS),
    )
    const candCap = Math.max(
      1,
      Math.min(cutListCaps(rt.context).candidates, pageCount, b.views * MOST_VIEWS),
    )
    const queueCap = entryWords(CARD_DESCENT_SHAPE) * (b.views + nodeBudget)
    const flagWords = flagShapeWords({ queueWords: queueCap, candCap, nodeBudget })
    d.out = sizedBuffer(device, d.out, 4 * copiedWords(info.listCap), storage(), 'card capture out')
    d.work = sizedBuffer(
      device,
      d.work,
      4 * (FRAME_COUNTERS + info.blockCount * BLOCK_MASK_WORDS),
      storage(),
      'card capture work',
    )
    if (!d.flags || d.flags.capacity < flagWords) {
      d.flags?.texture.destroy()
      d.flags = createRecordTexture(
        device,
        { ...FLAG_TABLE, label: 'Trillion3D card capture flags' },
        flagWords,
        GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      )
    }
    const W = viewWord
    d.block.set(info.block.subarray(0, d.block.length))
    d.block[W('queueCap')] = queueCap
    d.block[W('candCap')] = candCap
    d.block[W('nodeBudget')] = nodeBudget
    d.block[W('listCap')] = info.listCap
    // No pyramid, no filter, no placement tree, one root a view (`cardDescentWgsl.ts`).
    d.block[W('occlusion')] = 0
    d.block[W('cullOff')] = 0
    d.block[W('filterBase')] = 0
    d.block[W('treeTop')] = 0
    d.block[W('alwaysCount')] = 0
    d.block[W('worldCount')] = 1
    device.queue.writeBuffer(d.uniform, 0, d.block)
  }

  /** The groups the kernels of the descent, the cull and the rows bind, their resources written in place. */
  function groupsOf(d: Descent, b: Buffers, s: Session, t: CutTables) {
    const pipesOf = cardDescentPipes(device)
    let next = d.groups.cut.identity.next
    next[0] = t.clusters
    next[1] = t.views.nodes
    next[2] = d.uniform
    next[3] = d.flags!.view
    next[4] = d.out!
    next[5] = d.work!
    next[6] = t.views.worlds
    next[7] = t.views.frames
    next[8] = t.cold
    next[9] = t.views.tree
    next[10] = s.cut.previous
    next[11] = b.visible
    next[12] = s.cut.info
    const cut = bound(device, d.groups.cut, pipesOf.prepare.groups[0]!, 13, () => [
      { binding: 0, resource: t.clusters },
      { binding: 1, resource: t.views.nodes },
      { binding: 2, resource: { buffer: d.uniform } },
      { binding: 3, resource: d.flags!.view },
      { binding: 4, resource: { buffer: d.out! } },
      { binding: 5, resource: { buffer: d.work! } },
      { binding: 6, resource: t.views.worlds },
      { binding: 7, resource: t.views.frames },
      { binding: 8, resource: t.cold },
      { binding: 9, resource: t.views.tree },
      { binding: 10, resource: s.cut.previous },
      { binding: 11, resource: { buffer: b.visible } },
      { binding: 12, resource: { buffer: s.cut.info } },
    ])
    next = d.groups.card.identity.next
    next[0] = b.params
    next[1] = b.table
    next[2] = b.counts
    const card = bound(device, d.groups.card, pipesOf.prepare.groups[1]!, 3, () =>
      buffersAt(b.params, b.table, b.counts),
    )
    next = d.groups.arm.identity.next
    next[0] = d.work!
    next[1] = d.args
    const arm = bound(device, d.groups.arm, pipesOf.arm.groups[0]!, 2, () => [
      { binding: DAG_ARM_BINDING.work, resource: { buffer: d.work! } },
      { binding: DAG_ARM_BINDING.args, resource: { buffer: d.args } },
    ])
    next = d.groups.rows.identity.next
    next[0] = b.visible
    next[1] = b.pages
    const rows = bound(device, d.groups.rows, cardEndPipes(device).rows.groups[0]!, 2, () =>
      buffersAt(b.visible, b.pages),
    )
    return { cut, card, arm, rows }
  }

  /** The raster's group over the rows and the table. */
  function rasterGroup(b: Buffers, s: Session, ids: GPUTextureView) {
    if (bindingsOf[0] !== b.work || bindingsOf[1] !== b.table) {
      bindingsOf = [b.work, b.table]
      bindings = createRasterBindings(
        device,
        { raster: cardRasterPipes(device, rt.vis.rasters).depth.groups[0]! },
        b.work,
        () => b.table,
        false,
      )
    }
    const { vis, gpu } = s
    input.indices = gpu.cache!.buffer
    input.positions = vis.concatPos!
    input.pages = b.pages
    input.uniform = b.uniform
    input.uvs = vis.concatUv!
    input.normals = vis.concatNrm!
    input.textures = vis.textures!
    input.sampler = vis.mapsSampler!
    input.material = vis.materialTable.view!
    input.frame = vis.graphFrame.bufferOn(device)
    input.noise = noiseViewOn(device)
    input.idsView = input.depthView = input.hizView = ids
    return bindings!.raster(input)
  }

  return {
    ready: (placement) => rankOf(placement) >= 0 && compiled() && !!sessionOf(rt, session),
    get failure() {
      return failure
    },
    get awaiting() {
      return unsettled > 0
    },
    landed() {
      // The encoder of the image before is submitted by now: its counters map.
      ring?.submitted()
      handed.length = 0
      for (const batch of arrived) {
        handed.push(batch)
        if (!batch.refresh) unsettled--
      }
      arrived.length = 0
      return handed
    },
    draw(encoder, targets, pages, views, eye, stamp) {
      const s = sessionOf(rt, session)
      const tables = s?.cut.cutTables()
      if (!s || !tables || !compiled()) return undefined
      sources.length = drawn.length = 0
      const most = Math.min(targets.viewRows, viewLimit)
      for (let at = 0; at < pages.length && sources.length < most; at++) {
        const place = rankOf(pages[at]!.placement)
        if (place < 0) continue
        sources.push({ view: views[at]!, place })
        drawn.push(at)
      }
      const n = sources.length
      if (!n) return undefined
      if (buffers?.side !== targets.side || buffers.views !== targets.viewRows) {
        buffers?.dispose()
        buffers = createBuffers(device, targets.side, targets.viewRows)
      }
      const b = buffers
      // The table of views in the order of their placements; the batch names the page of each record.
      writeCardViews(b.table32, sources, eye, order)
      const batch: CardBatch = {
        stamp,
        refresh: drawn.every((at) => pages[at]!.refresh),
        pages: new Array<number>(n),
        lost: new Uint8Array(n),
      }
      for (let rank = 0; rank < n; rank++) batch.pages[rank] = pages[drawn[order[rank]!]!]!.page
      ring ??= createReadbackRing<CardBatch>(
        device,
        { label: 'Trillion3D card capture lost', bytes: 4 * (1 + MOST_VIEWS), count: IN_FLIGHT },
        arrive,
      )
      const staging = ring.take(batch)
      if (!staging) return undefined
      if (!batch.refresh) unsettled++
      const d = (descent ??= createDescent(device))
      device.queue.writeBuffer(b.table, 0, b.table32.bytes, 0, cardTableWords(n) * 4)
      const { params32 } = b
      params32.u[CARD_PARAMS.at.views] = n
      params32.u[CARD_PARAMS.at.rowCap] = b.rows
      // The pages are drawn at the view's pixel error over the capture's detail factor.
      params32.f[CARD_PARAMS.at.threshold] =
        rt.run.gate.pixelError / (rt.surfaceCache?.settings.surfaceCacheCaptureLodScaleFactor ?? 1)
      device.queue.writeBuffer(b.params, 0, params32.bytes)
      prepareDescent(d, b, tables, s.cut.pageCount)
      const g = groupsOf(d, b, s, tables)
      const stages = cardDescentPipes(device)
      const inputs = decodeInputs
      inputs.visible = b.visible
      inputs.info = s.cut.info
      inputs.rootWorlds = s.worlds
      inputs.placements = s.placements.buffer
      inputs.outputs = s.placements.outputs
      inputs.pages = b.pages
      inputs.work = b.decodeWork
      inputs.args = b.decodeArgs

      const pass = encoder.beginComputePass({ label: 'Trillion3D card capture cull' })
      pass.setBindGroup(0, g.cut)
      pass.setBindGroup(1, g.card)
      pass.setPipeline(stages.prepare.pipeline!)
      dispatchRows(pass, ceilDiv(Math.max(n, tables.descent.blockCount), WORKGROUP_THREADS))
      pass.setPipeline(stages.levels[0]!.pipeline!)
      dispatchRows(pass, ceilDiv(n, WORKGROUP_THREADS))
      for (let level = 1; level < tables.descent.levels; level++) {
        armDescent(pass, stages.arm.pipeline!, g)
        pass.setPipeline(stages.levels[level % 3]!.pipeline!)
        pass.dispatchWorkgroupsIndirect(d.args, DAG_ARGS.queues[level % 3]!)
      }
      armDescent(pass, stages.arm.pipeline!, g)
      pass.setPipeline(stages.close.pipeline!)
      pass.dispatchWorkgroups(1)
      pass.setPipeline(stages.emit.pipeline!)
      pass.dispatchWorkgroupsIndirect(d.args, DAG_ARGS.cand)
      pass.setPipeline(stages.done.pipeline!)
      pass.dispatchWorkgroups(1)
      cardDecode(device).encode(pass, RASTER_PASS_MAIN, inputs)
      const end = cardEndPipes(device)
      pass.setPipeline(end.rows.pipeline!)
      pass.setBindGroup(0, g.rows)
      dispatchRows(pass, ceilDiv(b.rows, WORKGROUP_THREADS))
      pass.end()
      // What the descent and the cull dropped, back a few images late (`landed`).
      encoder.copyBufferToBuffer(b.counts, CARD_COUNT.descentLost * 4, staging, 0, (1 + n) * 4)

      encoder.clearBuffer(b.work)
      const raster = encoder.beginComputePass({ label: 'Trillion3D card capture raster' })
      raster.setBindGroup(0, rasterGroup(b, s, targets.ids))
      const phases = cardRasterPipes(device, rt.vis.rasters)
      raster.setPipeline(phases.depth.pipeline!)
      raster.dispatchWorkgroupsIndirect(b.counts, CARD_COUNT.args * 4)
      raster.setPipeline(phases.ids.pipeline!)
      raster.dispatchWorkgroupsIndirect(b.counts, CARD_COUNT.args * 4)
      raster.end()

      const exported = encoder.beginComputePass({ label: 'Trillion3D card capture export' })
      const next = d.groups.export.identity.next
      next[0] = b.work
      next[1] = b.table
      next[2] = targets.ids
      next[3] = targets.depth
      next[4] = b.atlas
      exported.setBindGroup(
        0,
        bound(device, d.groups.export, end.exportIds.groups[0]!, 5, () => [
          { binding: 0, resource: { buffer: b.work } },
          { binding: 1, resource: { buffer: b.table } },
          { binding: 2, resource: targets.ids },
          { binding: 3, resource: targets.depth },
          { binding: 4, resource: { buffer: b.atlas } },
        ]),
      )
      exported.setPipeline(end.exportIds.pipeline!)
      exported.dispatchWorkgroups(PAGE_SIZE / EXPORT_TILE, PAGE_SIZE / EXPORT_TILE, n)
      exported.setPipeline(end.exportViews.pipeline!)
      exported.dispatchWorkgroups(n)
      exported.end()

      return {
        pages: drawn,
        rows: b.pages,
        rowCount: b.rows,
        classKeys: presentClassKeys(rt.vis.presentClasses),
      }
    },
    dispose() {
      buffers?.dispose()
      descent?.uniform.destroy()
      descent?.args.destroy()
      descent?.out?.destroy()
      descent?.work?.destroy()
      descent?.flags?.texture.destroy()
      ring?.destroy()
      buffers = descent = ring = undefined
      arrived.length = handed.length = unsettled = 0
      viewLimit = MOST_VIEWS
    },
  }
}
