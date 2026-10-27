/**
 * Step 5: the shadow raster on the engine's casters — the cull, the bin and the raster into the
 * physical pool (`renderCullWgsl.ts`, `renderBinWgsl.ts`, `renderRasterWgsl.ts`). Called between
 * `encodeVsmPageMapping` and `encodeVsmAfterRaster`, before `swapFrames`: it reads `res.current`
 * (page table, flags, receiver covers, uncached rects, projection data) and writes `res.pagePool`
 * and `res.rasterMarks`.
 *
 * As the reference renders its shadow views: the views of a pass
 * listed, then one cull over every caster and every view — each view selecting its own level of
 * detail —, the visible windows of pages binned by raster pipeline and drawn by one raster, every
 * view and every page of the pass at once. A pass holds every light's maps, however many lights and
 * levels the frame holds, up to the maps a dispatch of the cull lists (`renderViewPasses.ts`), as the
 * reference holds up to its views a pass.
 *
 * The records a pass emits — a window of pages a caster draws in a map's mip — are held by one list
 * whose room is the cut's cap of visible clusters (`cutMaxVisibleClusters`, within the device and the
 * budget), fixed: a pass past it draws what fits. The candidates are the clusters that may cast,
 * within the cut's cap of candidate clusters (`cutMaxCandidateClusters`), the descent's nodes the
 * cut's cap (`cutMaxNodes`). A frame with no cluster that may cast encodes the candidates' pass alone,
 * and no view pass.
 *
 * Order (one frame per submit: parameters go through `queue.writeBuffer`):
 *   clear counters → the shadow views' descent (`../traversal/`) → vsmRenderCandidates (a thread a
 *              page it listed) → vsmRenderCandidatesDone → the decode of the casters
 *              (`../../casters/casterFeed.ts`)
 *   per view pass (the second on: its counters cleared): vsmRenderViews (a thread a light) →
 *              vsmRenderArgsCull → vsmRenderCull (indirect, a thread a caster and a listed light) →
 *              vsmRenderArgsBin → vsmRenderBin (indirect, a thread a record) → raster pass, one
 *              drawIndirect a tier into a window-sized dummy target;
 *              with the occlusion's two culls (`../occlusion/`), vsmRenderCullFirst in place of the
 *              cull, then after the raster: the pyramid's build (select, tiles, top) → the
 *              descent's post pass (the nodes it held back, judged by this pyramid) →
 *              vsmRenderCandidates over the pages it listed → vsmRenderCandidatesPostDone → their
 *              decode → vsmRenderArgsSecond → vsmRenderCullPost (a thread a caster it found) →
 *              vsmRenderCullSecond (indirect, a thread a record held back) →
 *              vsmRenderArgsBin → vsmRenderBin → raster pass.
 *   The pyramid's last build of the frame follows the raster (`../frame/vsmEncode.ts`).
 */
import { clampLowWins } from '../../../../../../math/src/scalar/reals.ts'
import type { GraphRasters } from '../../../../materials/graph/graphRasters.ts'
import type { RasterPass } from '../../../../visibility/raster/contract.ts'
import { ledgerRoom } from '../../../../gpu/core/deviceLedger.ts'
import { vsmFrameParity, type VsmResources } from '../resources.ts'
import type { VsmBoundLight } from '../mapViews.ts'
import type { VsmShadowTessellation } from '../tessellation/shadowChain.ts'
import {
  vsmWriteLights,
  vsmWriteRenderParams,
  type VsmRenderCamera,
  type VsmRenderLayout,
} from './renderParams.ts'
import {
  heldRecords,
  vsmContextBytes,
  vsmEnsureLists,
  vsmListGrowth,
  vsmListSizes,
  type VsmListSizes,
} from './renderLists.ts'
import {
  RENDER_LABEL,
  vsmReleaseContext,
  vsmRenderContext,
  type VsmRenderContext,
} from './renderPipes.ts'
import { vsmViewPasses, vsmViewsPerPass, type VsmViewPass } from './renderViewPasses.ts'
import { renderGroups, vsmEncodeRaster, vsmWorldGroup } from './renderEncode.ts'
import { VSM_RENDER_COUNT_WORDS, vsmViewsLaid, type CompiledTiers } from './renderParamsWgsl.ts'
import { vsmOcclusionContext, vsmTwoPass } from '../occlusion/occlusionPass.ts'
import {
  prepareVsmDescent,
  releaseVsmDescent,
  vsmDescentBytes,
  vsmDescentGrowth,
  type VsmDescentScene,
} from '../traversal/traversalPass.ts'
import { encodeVsmDescentRequests, releaseVsmDescentRequests } from '../traversal/requests.ts'
import type { VsmThrottleState } from '../throttle.ts'
import { flagSectionStart } from '../../../../geometry/dag/flagSections.ts'
import { viewWord } from '../../../../geometry/dag/viewLayout.ts'

/**
 * The engine's casters: every resident cluster that may cast, listed each frame by the candidates
 * kernel from the packed pages (`renderCandidatesWgsl.ts`) and decoded by the engine's decode
 * (`../../casters/casterFeed.ts`); `pageLayout` / `pageGroup` the shadow page group
 * (`shadows.freshDraws.pageLayout`, `shadowPageGroup(rt, device)`), group 0 of the raster, which
 * names the decoded clusters.
 */
export interface VsmRenderScene {
  /** The casters the frame holds room for: the clusters that may cast
   *  (`ClusterState.candidateCount`) within the cut's cap of candidate clusters; the candidates,
   *  their list and the decoded clusters are sized for them. */
  rowCount: number
  /** The records a view pass holds room for. */
  recordCapacity: number
  /** The packed pages, each listed once at most by the shadow views' descent; the cut's pages (its
   *  residency bits). */
  packedPages: number
  pageCount: number
  /** What the shadow views' descent reads of the camera cut (`../traversal/traversalPass.ts`). */
  descent: VsmDescentScene
  /** The cut's cluster records, the placements' words and world boxes the candidates read, and the
   *  list of casters they write. */
  info: GPUBuffer
  rootWords: GPUBuffer
  rootBoxes: GPUBuffer
  casters: GPUBuffer
  /** Each cluster record's longest edge (`GpuSelection.edges`): what picks a cluster's raster in a
   *  map's view; a word of none where absent. */
  edges?: GPUBuffer
  /** The decode of the list of casters into the decoded clusters, encoded after the candidates
   *  (`encodeCasterDecode`). */
  decode: (pass: GPUComputePassEncoder, which: RasterPass) => void
  pageLayout: GPUBindGroupLayout
  pageGroup: GPUBindGroup
  camera: VsmRenderCamera
  /** The camera cut's tables, which the candidates judge a cluster by as its descent does
   *  (`../../../../geometry/dag/shader/worldGateWgsl.ts`, `worldDraws`): its cold words and its
   *  frame words, its clusters' hot records and its placements' worlds, and the cold word its
   *  placements' links start at — zero for a cut that follows no world, which then has the frame
   *  words alone, for the draw distances (`drawDistance`). */
  world: {
    cold: GPUTextureView
    frames: GPUTextureView
    clusters: GPUTextureView
    worlds: GPUTextureView
    /** The poses the previous image drew the placements at (`../../../../geometry/dag/previousPoses.ts`,
     *  the worlds' layout), which the occlusion's first cull tests a caster at; the worlds where
     *  absent. */
    previous?: GPUTextureView
    links?: number
    /** The main view's filter, held in the cut's `work` (`GpuSelection.holdFilter`): the buffer
     *  and the word its bits start at; none for a view that filters none. */
    filter?: { buffer: GPUBuffer; base: number }
  }
  /** The draw distances the objects name, which the casters take as the camera's cut does, from the
   *  main view's eye and scaled by `scale` (`cutViewDistanceScale`): present when the cut holds a
   *  placement that names one; those of the instances of an instanced mesh only while the host did not
   *  turn their cull off (`instances`, `cutDrawDistanceCulling`). */
  drawDistance?: { scale: number; instances: boolean }
  /** The families the frame's pipelines were compiled for (the plan's `tiers`): the raster draws
   *  no tier past them (`vsmEncodeRaster`). */
  tiers: CompiledTiers
  /** The tessellation of the displaced surfaces' records, while the frame has one
   *  (`vsmShadowTessellation`): its `kinds` say which maps take it, and each view pass runs it. */
  tessellation?: VsmShadowTessellation
  /** Whether the lights whose maps would pass what a pass lists are drawn in several passes
   *  (`shadowMultipassViews`, `vsmViewPasses`); false puts every light in one. */
  multipassViews: boolean
  /** The cutouts and offsets of the session's surfaces the raster's module holds
   *  (`WebgpuVisState.rasters`). */
  rasters?: GraphRasters
  /** Whether the occlusion pyramid is built again over every held page (`shadowOcclusionFullUpdate`);
   *  false when absent. */
  occlusionFullUpdate?: boolean
  /** The edge, in a map's pixels, past which a cluster is the hardware raster's
   *  (`hardwareRasterEdgePixels`); 0 or absent, the software
   *  raster is off (`softwareRaster`) and every cluster is the hardware raster's. */
  hardwareEdge?: number
  /** The shadow page group's compute twin (`../../casters/pageGroup.ts`), which the software raster
   *  binds; absent, no software raster. */
  pageCompute?: { layout: GPUBindGroupLayout; group: GPUBindGroup }
}

export interface VsmRenderFrame {
  device: GPUDevice
  /** This frame's lights (`VsmFramePlan.lights`), every one drawn. */
  lights: readonly VsmBoundLight[]
  /** The compute throttle's buffers where it runs this frame: the cull counts the clusters per map. */
  throttle?: VsmThrottleState
}

/** What one call encoded, for diagnostics. */
export interface VsmRenderStats {
  /** The view passes drawn — none at all when 0: the raster skipped, for want of room
   *  (`roomLimited`) or of casters (`empty`). */
  passes: number
  /** The records a view pass held room for. */
  records: number
  /** The GPU budget's room held the records' list short of the room asked: the pages past it are
   *  drawn by a later frame — none at all when `passes` is 0, the raster skipped. */
  roomLimited: boolean
  /** No caster to draw: only the candidates' pass was encoded, which counts them. */
  empty: boolean
}

/** Frees the raster's context of `res`, with the set it was made for (`destroyEngineVsm`). */
export function releaseVsmRender(res: VsmResources) {
  if (res.render) vsmReleaseContext(res.render)
  releaseVsmDescent(res)
  releaseVsmDescentRequests(res)
  res.render = undefined
}

/** Bytes the raster's context of `res` holds on the device: its lists and its dummy target. */
export const vsmRenderContextBytes = (res: VsmResources) =>
  vsmContextBytes(res.render) + vsmDescentBytes(res)

/** The frame's layout and list sizes, rewritten each frame. */
const layout: VsmRenderLayout = {
  casterCap: 0,
  listedBase: 0,
  viewCap: 0,
  lights: 0,
  recordCapacity: 0,
  passes: [],
}
const sizes = {} as VsmListSizes

/**
 * Renders the casters of this frame into the pages marked and allocated this frame.
 * Nothing when no light renders or no row exists.
 */
export function encodeVsmRender(
  encoder: GPUCommandEncoder,
  res: VsmResources,
  frame: VsmRenderFrame,
  scene: VsmRenderScene,
): VsmRenderStats | undefined {
  const { device } = frame
  // The views' bound: every map of the frame's lights, in the view passes their maps fill; the GPU
  // lists those with pages to draw.
  const limit = vsmViewsPerPass(device.limits, scene.multipassViews)
  const { list: passes, maps, mostMaps } = vsmViewPasses(frame.lights, limit)
  if (maps === 0 || scene.packedPages <= 0) return
  // The lists are sized for one caster at least, the slot of the candidates' parameters held; the
  // room itself is the scene's.
  const room = scene.rowCount,
    empty = room <= 0
  const ctx = vsmRenderContext(res, device, scene.pageLayout, scene.rasters)
  const { throttle } = frame
  const sized = sizeLists(ctx, res, scene, frame, { passes, mostMaps })
  if (!sized) return { passes: 0, records: 0, roomLimited: true, empty: false }
  const { records, roomLimited, descentSizes } = sized
  const bound = bindFrame(ctx, res, scene, frame, { room, records, passes, descentSizes })
  const { lists, groups, descent, world } = bound
  const lights = frame.lights.length,
    { views } = descentSizes
  // The leaves the shadow views asked for in the last frame, to the streaming, read back at the start of
  // this one, before its descent clears them.
  encodeVsmDescentRequests(device, encoder, res, descent.out!, descent.listCap)
  vsmEncodeRaster(
    encoder,
    ctx,
    groups,
    world,
    scene,
    lists.args,
    { passes: passes.length, mostMaps, lights, throttle },
    empty,
    { descent, info: scene.descent.info, lights, views, viewBase: bound.viewBase },
    occlusionOf(res, device, scene),
  )
  // The counts the cull made are the frame's feedback, which the next frame's throttle reads.
  if (throttle)
    encoder.copyBufferToBuffer(
      lists.counts,
      VSM_RENDER_COUNT_WORDS * 4,
      throttle.feedback[vsmFrameParity(res)],
      0,
      throttle.feedbackWords * 4,
    )
  return { passes: empty ? 0 : passes.length, records, roomLimited, empty }
}

/** The occlusion's two culls this frame, while the previous frame's pyramid and tables are kept
 *  (`vsmTwoPass`); none where the set holds no occlusion. */
function occlusionOf(res: VsmResources, device: GPUDevice, scene: VsmRenderScene) {
  const ctx = vsmOcclusionContext(res, device)
  return (
    ctx && { ctx, res, fullUpdate: scene.occlusionFullUpdate ?? false, twoPass: vsmTwoPass(res) }
  )
}

/** The frame's lists sized — the view `passes`, at most `mostMaps` maps in one — for the records
 *  the frames asked, or as held where the budget's room refuses their growth (`recordsWithinRoom`),
 *  with the descent's sizes; none where not even that fits. */
function sizeLists(
  ctx: VsmRenderContext,
  res: VsmResources,
  scene: VsmRenderScene,
  frame: VsmRenderFrame,
  { passes, mostMaps }: { passes: readonly Pick<VsmViewPass, 'mips'>[]; mostMaps: number },
) {
  const lights = frame.lights.length
  const sized = (records: number) =>
    vsmListSizes(
      sizes,
      ctx.slots,
      passes.length,
      mostMaps,
      lights,
      Math.max(1, scene.rowCount),
      records,
      frame.throttle?.feedbackWords,
      vsmViewsLaid(ctx.device),
    )
  const descentSizes = descentSizesOf(res, scene, lights, passes)
  const within = recordsWithinRoom(
    ctx,
    scene,
    (records) =>
      vsmListGrowth(ctx.buffers, sized(records)) +
      vsmDescentGrowth(res, scene.descent, descentSizes),
  )
  if (!within) return undefined
  sized(within.records)
  return { ...within, descentSizes }
}

/** The frame's lists grown and written — the lights, the parameters —, its groups, the descent
 *  prepared over them and the candidates' group over the cut's tables and the descent's flags. */
function bindFrame(
  ctx: VsmRenderContext,
  res: VsmResources,
  scene: VsmRenderScene,
  frame: VsmRenderFrame,
  at: {
    room: number
    records: number
    passes: VsmRenderLayout['passes']
    descentSizes: ReturnType<typeof descentSizesOf>
  },
) {
  const { device } = ctx
  const lists = vsmEnsureLists(ctx, RENDER_LABEL, sizes)
  vsmWriteLights(device, lists.lights, frame.lights)
  const groups = renderGroups(ctx, res, scene, lists)
  const { descent, viewBase } = prepareVsmDescent(
    res,
    device,
    scene.descent,
    at.descentSizes,
    groups.lists,
    // A frame with room for no caster only counts them: no node waits for a pass that is not run.
    vsmTwoPass(res) && at.room > 0,
  )
  // The candidates read the pages the descent listed behind its queue (`candBase`).
  const lights = frame.lights.length
  const { queueCap } = descent,
    { candCap, nodeBudget } = at.descentSizes
  Object.assign(layout, {
    listedBase: flagSectionStart(1, { queueWords: queueCap, candCap, nodeBudget }),
    casterCap: at.room,
    lights,
  })
  layout.viewCap = at.descentSizes.views
  layout.recordCapacity = at.records
  layout.passes = at.passes
  vsmWriteRenderParams(device, scene, layout, lists.params, ctx.slots)
  const listed = descent.flags!.view
  const world = vsmWorldGroup(device, ctx.world, ctx.candidates.groups[1], scene.world, listed)
  return { lists, groups, descent, viewBase, world }
}

/** The descent's lists for `lights` lights: every view's queue 0, a view a map and a mip of it that
 *  may have a page to draw (the view `passes`' `mips`), the nodes of the cut's cap, each packed
 *  page once — the main view's node budget a light, the cut's own cap (`cutMaxNodes`). */
function descentSizesOf(
  res: VsmResources,
  scene: VsmRenderScene,
  lights: number,
  passes: readonly Pick<VsmViewPass, 'mips'>[],
) {
  const firstNodes = scene.descent.info.block[viewWord('nodeBudget')]! * lights
  return {
    views: Math.max(
      1,
      passes.reduce((sum, pass) => sum + pass.mips, 0),
    ),
    lights,
    nodeBudget: Math.max(1, firstNodes),
    candCap: Math.max(1, scene.packedPages),
  }
}

/** The records' list as the frames asked it (`scene.recordCapacity`), or as held where the budget's
 *  room refuses its growth (`grows`, the bytes the lists ask at a capacity); none where not even
 *  that fits. */
function recordsWithinRoom(
  ctx: VsmRenderContext,
  scene: VsmRenderScene,
  grows: (records: number) => number,
) {
  const room = ledgerRoom(ctx.device)
  if (grows(scene.recordCapacity) <= room)
    return { records: scene.recordCapacity, roomLimited: false }
  const records = clampLowWins(scene.recordCapacity, 1, heldRecords(ctx))
  return grows(records) <= room ? { records, roomLimited: true } : undefined
}
