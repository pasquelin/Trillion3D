/**
 * THE RASTER ENCODED (`renderPass.ts`): its groups — over the scene's rows and the lists, made again
 * when one of them moved, and over the VSM tables once a frame set —, then the candidates and, for
 * each view pass (`renderViewPasses.ts`), one compute pass — its views, its cull over every caster
 * and every listed mip view, the bin — and one raster pass, a draw a tier: one cull and
 * one raster over every view of a pass. With the occlusion
 * culling and a previous frame to test against, the cull is its first, and the pass goes on:
 * the pyramid built over what it drew (`encodeVsmPyramid`), a
 * second compute pass — the second cull over the records the first held back, the bin — and a
 * second raster pass.
 */
import { standInBuffer, standInTexture } from '../../../../gpu/core/standIns.ts'
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../../../gpu/dispatch/grid.ts'
import type { HeldGroup } from '../../../../gpu/bind/bindIdentity.ts'
import { sequentialEntries } from '../../../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../../../gpu/core/oncePerDevice.ts'
import type { PreparedPipeline } from '../../../deferred/fullscreen.ts'
import { vsmBufferGroup, type VsmComputePipe } from '../passKit.ts'
import { vsmBindGroupEntries, vsmPerFrameSet, type VsmResources } from '../resources.ts'
import type { VsmShadowTessellation } from '../tessellation/shadowChain.ts'
import { vsmRenderCullSpecs } from './renderCullWgsl.ts'
import { vsmRenderBinSpecs } from './renderBinWgsl.ts'
import { VSM_RENDER_VIEWS_SPECS } from './renderViewsWgsl.ts'
import { vsmSoftwareSpecs } from './renderSoftwareWgsl.ts'
import { VSM_RENDER_WORLD_GROUP } from './renderCandidatesWgsl.ts'
import {
  VSM_RENDER_RASTER_FRAGMENT_SPECS,
  VSM_RENDER_RASTER_SHARED_SPECS,
  VSM_RENDER_RASTER_VERTEX_SPECS,
} from './renderRasterWgsl.ts'
import {
  VSM_RENDER_ARGS_BIN,
  VSM_RENDER_ARGS_CULL,
  VSM_RENDER_ARGS_DRAW,
  VSM_RENDER_ARGS_POST,
  VSM_RENDER_ARGS_SOFTWARE,
  VSM_RENDER_ARGS_SOFTWARE_ALL,
  VSM_RENDER_ARGS_SOFTWARE_STATIC,
  VSM_RENDER_COUNT_PASS,
  VSM_RENDER_COUNT_WORDS,
  vsmCountWords,
  vsmRenderTiersDrawn,
  vsmCullMarks,
  vsmSoftwareMerged,
  vsmViewsLaid,
} from './renderParamsWgsl.ts'
import { VSM_RENDER_FIRST_SLOT, VSM_RENDER_PARAMS_BYTES } from './renderParams.ts'
import { RASTER_PASS_MAIN, RASTER_PASS_POST } from '../../../../visibility/raster/contract.ts'
import type { VsmListName } from './renderLists.ts'
import { renderCulls, type VsmRenderContext, type VsmRenderCullPipes } from './renderPipes.ts'
import type { VsmThrottleState } from '../throttle.ts'
import type { VsmRenderScene } from './renderPass.ts'
import {
  clearVsmDescent,
  encodeVsmDescent,
  encodeVsmDescentPost,
  VSM_DESCENT_LISTED_ARGS,
  type VsmDescent,
  type VsmDescentScene,
} from '../traversal/traversalPass.ts'
import { ComputeRun } from '../../../../gpu/core/lazyComputePass.ts'
import {
  encodeVsmPyramid,
  prepareVsmPyramid,
  frameParity,
  type VsmOcclusionContext,
} from '../occlusion/occlusionPass.ts'

/** What the candidates read of the main view's filter while it has none — one word, which
 *  `filterBase` 0 says no one reads —, and of the clusters' edges while the cut names none (an
 *  edge of none, the hardware raster's): one a device. */
const noFilter = oncePerDevice((device: GPUDevice) =>
  standInBuffer(device, 'Trillion3D shadow casters no filter', 4, GPUBufferUsage.STORAGE),
)

/** The occlusion's group of a cull with no pyramid to test against (`vsmRenderCull`): a texel of
 *  each table, which no test of that cull reads — its kind skips them —, one set a device, a group a
 *  layout. */
const blankOcclusion = oncePerDevice((device: GPUDevice) => {
  const texel = (format: GPUTextureFormat, layers?: number) =>
    standInTexture(device, 'Trillion3D shadow occlusion blank', format).createView(
      layers ? { dimension: '2d-array' } : {},
    )
  return { pyramid: texel('r32float', 1), table: texel('r32uint') }
})
const blankGroups = new WeakMap<GPUBindGroupLayout, GPUBindGroup>()
function noOcclusionGroup(device: GPUDevice, layout: GPUBindGroupLayout) {
  let group = blankGroups.get(layout)
  if (group) return group
  const { pyramid, table } = blankOcclusion(device)
  group = device.createBindGroup({
    label: 'Trillion3D shadow occlusion blank',
    layout,
    entries: [0, 1, 2, 3].map((binding) => ({ binding, resource: binding ? table : pyramid })),
  })
  blankGroups.set(layout, group)
  return group
}

/** The candidates' group over the camera cut's tables (`VsmRenderScene.world`) — its cold words and
 *  frame words, its clusters' hot records, its placements' worlds and previous poses —, the bits of
 *  the main view's filter and the shadow views' descent's flags `listed`, held in `held` on `layout`
 *  (`VSM_RENDER_WORLD_GROUP`): made again only when the layout, the cut's tables or the flags moved
 *  — another cut, a table grown, a world packed or let go. */
export function vsmWorldGroup(
  device: GPUDevice,
  held: HeldGroup,
  layout: GPUBindGroupLayout,
  world: VsmRenderScene['world'],
  listed: GPUTextureView,
) {
  const { next } = held.identity,
    filter = world.filter?.buffer ?? noFilter(device)
  next[0] = layout
  next[1] = world.cold
  next[2] = world.frames
  next[3] = filter
  next[4] = world.clusters
  next[5] = world.worlds
  // The previous poses: the worlds themselves where the cut names none (every pose stood still).
  next[6] = world.previous ?? world.worlds
  next[7] = listed
  next.length = 8
  if (held.identity.moved())
    held.group = device.createBindGroup({
      layout,
      entries: sequentialEntries([
        world.cold,
        world.frames,
        { buffer: filter },
        world.clusters,
        world.worlds,
        next[6] as GPUTextureView,
        listed,
      ]),
    })
  return held.group!
}

/** The groups over the scene's rows and the lists: the candidates', the views', the cull's, the
 *  bin's and the arguments', with the parameters' window, the counters and the sorted records the
 *  tessellation reads. */
export interface RenderListGroups {
  params: GPUBufferBinding
  lights: GPUBuffer
  counts: GPUBuffer
  /** The placements' words, which the shadow views' descent reads too. */
  rootWords: GPUBuffer
  sorted: GPUBuffer
  cand: GPUBindGroup
  /** The casters' closing kernels' group 0, over the stats buffer they flag an overflow in. */
  done: GPUBindGroup
  views1: GPUBindGroup
  cull1: GPUBindGroup
  bin1: GPUBindGroup
  args: GPUBindGroup
}

/** The raster's groups over the VSM tables of a frame set (`rasterTables`), and with the occlusion
 *  its culls' groups over the pyramid and the kept tables: the previous frame set's for the first,
 *  this one's for the second. */
export interface RasterTables {
  views0: GPUBindGroup
  cull0: GPUBindGroup
  bin0: GPUBindGroup
  raster1: GPUBindGroup
  /** The software half's group 1 (`renderSoftwareWgsl.ts`): over the pool's slice 0, and over its
   *  static slice where the set has one. */
  software: [all: GPUBindGroup, staticLayer?: GPUBindGroup]
  occlusion?: [first: GPUBindGroup, second: GPUBindGroup]
}

/** Whether what the list groups bind moved since they were made: the scene's rows, the lists
 *  `b` and the `stats` buffer. `ctx.bound` compares them alone, and holds them after. */
function rowsMoved(
  ctx: VsmRenderContext,
  scene: VsmRenderScene,
  b: Record<VsmListName, GPUBuffer>,
  stats: GPUBuffer,
) {
  const next = ctx.bound.next
  next[0] = scene.info
  next[1] = scene.rootWords
  next[2] = scene.rootBoxes
  next[3] = scene.casters
  next[4] = b.params
  next[5] = b.views
  next[6] = b.candidates
  next[7] = b.counts
  next[8] = b.records
  next[9] = b.sorted
  next[10] = b.args
  next[11] = b.lights
  next[12] = scene.edges
  next[13] = stats
  next.length = 14
  return ctx.bound.moved()
}

/** The groups over the scene's rows and the lists `b` (`RenderListGroups`). */
function listGroups(
  ctx: VsmRenderContext,
  scene: VsmRenderScene,
  b: Record<VsmListName, GPUBuffer>,
  stats: GPUBuffer,
): RenderListGroups {
  const params = { buffer: b.params, size: VSM_RENDER_PARAMS_BYTES }
  const group = (layout: GPUBindGroupLayout, buffers: (GPUBuffer | GPUBufferBinding)[]) =>
    vsmBufferGroup(ctx.device, layout, buffers)
  const { views, lights, candidates, counts, records, sorted, args } = b
  return {
    params,
    lights,
    counts,
    rootWords: scene.rootWords,
    sorted,
    cand: group(ctx.candidates.groups[0], [
      params,
      scene.info,
      scene.rootWords,
      scene.rootBoxes,
      scene.casters,
      candidates,
      counts,
      // A cut that names no edges hands the candidates a word of none: every cluster hardware's.
      scene.edges ?? noFilter(ctx.device),
    ]),
    done: group(ctx.candidatesDone.groups[0], [params, scene.casters, counts, stats]),
    views1: group(ctx.views.groups[1], [params, views, counts, lights]),
    cull1: group(ctx.cull.groups[1], [params, views, candidates, counts, records]),
    bin1: group(ctx.bin.groups[1], [params, counts, records, sorted]),
    args: group(ctx.args.cull.groups[0], [params, counts, args, stats]),
  }
}

/** The occlusion's groups of the frame set of `res.current`: the pyramid, every level, and the kept
 *  tables of the previous set (the first cull) and of this one (the second). */
function occlusionGroups(res: VsmResources, ctx: VsmRenderContext): RasterTables['occlusion'] {
  const { occlusion, kept } = res
  if (!occlusion || !kept) return undefined
  const pyramid = occlusion.pyramid.createView({ dimension: '2d-array' })
  const parity = frameParity(res)
  const group = (k: number) =>
    ctx.device.createBindGroup({
      layout: ctx.cullFirst.groups[2],
      entries: [
        { binding: 0, resource: pyramid },
        { binding: 1, resource: kept[k].table.createView() },
        { binding: 2, resource: kept[k].marks.createView() },
        { binding: 3, resource: kept[k].rects.createView() },
      ],
    })
  return [group(1 - parity), group(parity)]
}

/** The software half's group 1 on `layout` (`vsmSoftwareSpecs`): the sorted records, the page table,
 *  the pool's slice `slice` — the one its entry writes — or, with none (`vsmSoftwareMerged`), both
 *  slices, the uniforms, the parameters' window `params` and, on a device with a storage buffer past
 *  those (`vsmViewsLaid`), the projection data. */
function softwareGroup(
  res: VsmResources,
  ctx: VsmRenderContext,
  layout: GPUBindGroupLayout,
  params: GPUBufferBinding,
  slice?: number,
) {
  const specs = vsmSoftwareSpecs(!vsmViewsLaid(ctx.device), slice === undefined)
  return ctx.device.createBindGroup({
    layout,
    entries: [
      ...sequentialEntries([{ buffer: ctx.buffers.sorted! }]),
      ...vsmBindGroupEntries(
        res,
        slice === undefined ? specs : specs.filter((spec) => spec.resource !== 'pagePool'),
      ),
      ...(slice === undefined ? [] : [{ binding: 2, resource: { buffer: res.pagePool[slice]! } }]),
      { binding: 4, resource: params },
    ],
  })
}

/** The raster's groups over the tables of `res.current`, and the sorted records of `ctx` its raster
 *  draws (`vsmPerFrameSet`). */
function rasterTables(res: VsmResources, ctx: VsmRenderContext): RasterTables {
  const { device } = ctx,
    sorted = ctx.buffers.sorted!,
    params = ctx.groups!.params,
    cached = res.layout.cacheEnabled,
    merged = vsmSoftwareMerged(device)
  const group = (layout: GPUBindGroupLayout, specs: Parameters<typeof vsmBindGroupEntries>[1]) =>
    device.createBindGroup({ layout, entries: vsmBindGroupEntries(res, specs) })
  return {
    software: [
      softwareGroup(res, ctx, ctx.software.all.groups[1]!, params, merged ? undefined : 0),
      cached && ctx.software.static
        ? softwareGroup(res, ctx, ctx.software.static.groups[1]!, params, 1)
        : undefined,
    ],
    occlusion: occlusionGroups(res, ctx),
    views0: group(ctx.views.groups[0], VSM_RENDER_VIEWS_SPECS),
    cull0: group(ctx.cull.groups[0], vsmRenderCullSpecs(vsmCullMarks(device))),
    bin0: group(ctx.bin.groups[0], vsmRenderBinSpecs(vsmCullMarks(device))),
    raster1: device.createBindGroup({
      layout: ctx.raster.layout1,
      entries: [
        ...sequentialEntries([{ buffer: sorted }]),
        ...vsmBindGroupEntries(res, VSM_RENDER_RASTER_VERTEX_SPECS),
        ...vsmBindGroupEntries(res, VSM_RENDER_RASTER_FRAGMENT_SPECS),
        ...vsmBindGroupEntries(res, VSM_RENDER_RASTER_SHARED_SPECS),
      ],
    }),
  }
}

/** The raster's groups this frame: those over the scene's rows and the lists made again only when
 *  one of them moved, those over the VSM tables once a frame set. */
export function renderGroups(
  ctx: VsmRenderContext,
  res: VsmResources,
  scene: VsmRenderScene,
  lists: Record<VsmListName, GPUBuffer>,
) {
  if (rowsMoved(ctx, scene, lists, res.stats) || !ctx.groups)
    ctx.groups = listGroups(ctx, scene, lists, res.stats)
  const tables = vsmPerFrameSet(ctx.tables, res, rasterTables, ctx, ctx.groups)
  return { lists: ctx.groups, tables }
}

/** What the raster's first pass descends: the shadow views' descent (`../traversal/`), its cut's
 *  levels and queue 0, and the frame's lights and the views they list at most. */
interface VsmRasterDescent {
  descent: VsmDescent
  info: VsmDescentScene['info']
  lights: number
  views: number
}

/** The shadow views' descent (`encodeVsmDescent`) under the occlusion group `occlusion`, the
 *  candidates' kernel over the pages it listed — dispatched on the argument it armed —, then the
 *  kernel that closes their list, in `pass`: the groups `lists`, the camera cut's tables `world`, the
 *  first slot's parameters. */
function encodeCandidates(
  pass: GPUComputePassEncoder,
  ctx: VsmRenderContext,
  lists: RenderListGroups,
  world: GPUBindGroup,
  { descent, info, lights, views }: VsmRasterDescent,
  occlusion: GPUBindGroup,
) {
  encodeVsmDescent(pass, descent, info, { lights, views }, occlusion)
  encodeCasters(pass, ctx, lists, world, descent, ctx.candidatesDone)
}

/** The candidates' kernel over the pages the descent listed — dispatched on the argument it armed —,
 *  then the kernel `done` that closes their list, in `pass`. */
function encodeCasters(
  pass: GPUComputePassEncoder,
  ctx: VsmRenderContext,
  lists: RenderListGroups,
  world: GPUBindGroup,
  descent: VsmDescent,
  done: VsmComputePipe,
) {
  const candidates = ctx.candidates.pipeline
  const closing = done.pipeline
  if (!candidates || !closing) return
  pass.setPipeline(candidates)
  pass.setBindGroup(0, lists.cand, VSM_RENDER_FIRST_SLOT)
  pass.setBindGroup(VSM_RENDER_WORLD_GROUP, world)
  pass.dispatchWorkgroupsIndirect(descent.args, VSM_DESCENT_LISTED_ARGS)
  pass.setPipeline(closing)
  pass.setBindGroup(0, lists.done, VSM_RENDER_FIRST_SLOT)
  pass.dispatchWorkgroups(1)
}

/** One view pass's compute work in `pass`, its parameters at `offset`: the lights with pages to draw
 *  among the frame's `lights` (`renderViewsWgsl.ts`), the cull's arguments and the cull over every
 *  candidate and listed light — the occlusion's first (`first`, over its group of the previous frame's
 *  pyramid and tables) or the one with no test —, then the bin (`encodeBin`). The argument kernels
 *  run a thread each, directly: they write `args`, bound as storage, and a dispatch may not read its
 *  arguments from a buffer it binds writable (one usage scope). */
function encodeViewPass(
  pass: GPUComputePassEncoder,
  ctx: VsmRenderContext,
  { lists, tables }: ReturnType<typeof renderGroups>,
  args: GPUBuffer,
  offset: readonly number[],
  lights: number,
  first: boolean,
  culls: VsmRenderCullPipes,
  lay: number,
) {
  const views = ctx.views.pipeline
  const cullArgs = ctx.args.cull.pipeline
  const cull = (first ? culls.cullFirst : culls.cull).pipeline
  if (!views || !cullArgs || !cull) return
  pass.setPipeline(views)
  pass.setBindGroup(0, tables.views0)
  pass.setBindGroup(1, lists.views1, offset)
  dispatchRows(pass, ceilDiv(lights, WORKGROUP_THREADS))
  pass.setPipeline(cullArgs)
  pass.setBindGroup(0, lists.args, offset)
  pass.dispatchWorkgroups(1)
  pass.setPipeline(cull)
  pass.setBindGroup(0, tables.cull0)
  pass.setBindGroup(1, lists.cull1, offset)
  pass.setBindGroup(2, mainSight(ctx, tables, first))
  pass.dispatchWorkgroupsIndirect(args, VSM_RENDER_ARGS_CULL * 4)
  if (lay > 0) encodeLayViews(pass, ctx, lists, tables, offset, lay)
  encodeBin(pass, ctx, lists, tables, args, offset)
}

/** The views of the pass's maps laid in the sorted list for the software raster, which binds no
 *  projection data (`vsmRenderLayViews`): a thread a map, `maps` at most; once a view pass, the
 *  second bin finding them laid. */
function encodeLayViews(
  pass: GPUComputePassEncoder,
  ctx: VsmRenderContext,
  lists: RenderListGroups,
  tables: RasterTables,
  offset: readonly number[],
  maps: number,
) {
  const lay = ctx.layViews.pipeline
  if (!lay) return
  pass.setPipeline(lay)
  pass.setBindGroup(0, tables.bin0)
  pass.setBindGroup(1, lists.bin1, offset)
  dispatchRows(pass, ceilDiv(maps, WORKGROUP_THREADS))
}

/** The group the first cull and the descent's levels judge by (group 2): the previous frame's pyramid
 *  and tables while they are kept (`twoPass`), else a blank one. */
function mainSight(ctx: VsmRenderContext, tables: RasterTables, twoPass: boolean) {
  return twoPass ? tables.occlusion![0] : noOcclusionGroup(ctx.device, ctx.cull.groups[2]!)
}

/** The bin's arguments — the bins' reserve, the draws, the software half's groups — and the bin, over the
 *  records the last cull stored. */
function encodeBin(
  pass: GPUComputePassEncoder,
  ctx: VsmRenderContext,
  lists: RenderListGroups,
  tables: RasterTables,
  args: GPUBuffer,
  offset: readonly number[],
) {
  const binArgs = ctx.args.bin.pipeline
  const bin = ctx.bin.pipeline
  if (!binArgs || !bin) return
  pass.setPipeline(binArgs)
  pass.setBindGroup(0, lists.args, offset)
  pass.dispatchWorkgroups(1)
  pass.setPipeline(bin)
  pass.setBindGroup(0, tables.bin0)
  pass.setBindGroup(1, lists.bin1, offset)
  pass.dispatchWorkgroupsIndirect(args, VSM_RENDER_ARGS_BIN * 4)
}

/** The software half (`renderSoftwareWgsl.ts`) in a compute pass of its own, after the hardware raster
 *  pass that drew the records beside it: a group a record the bin sorted first (`encodeSoftware`), then the
 *  patches of the displaced surfaces the tessellation listed, diced and rastered the same way (`tessellation`). It
 *  writes the pool as the raster pass before it does, by an atomic max: the order of the two is free,
 *  and both are done before the occlusion's pyramid reads what they drew. */
function encodeSoftwarePass(
  encoder: GPUCommandEncoder,
  label: GPUComputePassDescriptor,
  ctx: VsmRenderContext,
  tables: RasterTables,
  args: GPUBuffer,
  offset: readonly number[],
  pageCompute: GPUBindGroup,
  post: boolean,
  tessellation?: VsmShadowTessellation,
) {
  const pass = encoder.beginComputePass(label)
  encodeSoftware(pass, ctx, tables, args, offset, pageCompute)
  tessellation?.dice(pass, post, pageCompute)
  pass.end()
}

/** The software half's dispatches: one group a record of either layer, the dynamic layer's into the
 *  pool's slice 0 and the static layer's into the static slice, where the device grants it
 *  (`vsmSoftwareMerged`); else a group a record of the dynamic layer's into slice 0, then, where the
 *  set has a static slice, a group a record of the static layer's into it. */
function encodeSoftware(
  pass: GPUComputePassEncoder,
  ctx: VsmRenderContext,
  tables: RasterTables,
  args: GPUBuffer,
  offset: readonly number[],
  pageCompute: GPUBindGroup,
) {
  const [all, staticLayer] = tables.software
  const software = ctx.software.all.pipeline
  const staticSoftware = ctx.software.static?.pipeline
  if (!software || (ctx.software.static && !staticSoftware)) return
  pass.setPipeline(software)
  pass.setBindGroup(0, pageCompute)
  pass.setBindGroup(1, all, offset)
  if (!ctx.software.static) {
    pass.dispatchWorkgroupsIndirect(args, VSM_RENDER_ARGS_SOFTWARE_ALL * 4)
    return
  }
  pass.dispatchWorkgroupsIndirect(args, VSM_RENDER_ARGS_SOFTWARE * 4)
  if (!staticLayer) return
  pass.setPipeline(staticSoftware!)
  pass.setBindGroup(1, staticLayer, offset)
  pass.dispatchWorkgroupsIndirect(args, VSM_RENDER_ARGS_SOFTWARE_STATIC * 4)
}

/** The occlusion's second half of the culls in `pass`: their arguments — a thread a record the first
 *  held back, a thread a caster the descent's post pass found —, the post cull over those casters
 *  and the second over those records, both against this frame's pyramid and kept tables, then the
 *  bin. */
function encodeSecondCull(
  pass: GPUComputePassEncoder,
  ctx: VsmRenderContext,
  { lists, tables }: ReturnType<typeof renderGroups>,
  args: GPUBuffer,
  offset: readonly number[],
  culls: VsmRenderCullPipes,
) {
  const secondArgs = ctx.args.second.pipeline
  const post = culls.cullPost.pipeline
  const second = culls.cullSecond.pipeline
  if (!secondArgs || !post || !second) return
  pass.setPipeline(secondArgs)
  pass.setBindGroup(0, lists.args, offset)
  pass.dispatchWorkgroups(1)
  pass.setBindGroup(0, tables.cull0)
  pass.setBindGroup(1, lists.cull1, offset)
  pass.setBindGroup(2, tables.occlusion![1])
  pass.setPipeline(post)
  pass.dispatchWorkgroupsIndirect(args, VSM_RENDER_ARGS_POST * 4)
  pass.setPipeline(second)
  pass.dispatchWorkgroupsIndirect(args, VSM_RENDER_ARGS_CULL * 4)
  encodeBin(pass, ctx, lists, tables, args, offset)
}

const rasterDepth: GPURenderPassDepthStencilAttachment = {
  view: undefined as never,
  depthClearValue: 0,
  depthLoadOp: 'clear',
  depthStoreOp: 'discard',
}
/** The raster's descriptor, held: its label and its depth target are those of the pass. */
const RASTER: GPURenderPassDescriptor = {
  colorAttachments: [],
  depthStencilAttachment: rasterDepth,
}

/** One view pass's raster: one drawIndirect a tier of `tiers` named by `drawn`, of its sorted
 *  records, into the window-sized dummy `target`. The records the tessellation took are left undrawn:
 *  their patches are rastered in software (`encodeSoftwarePass`). */
function encodeRaster(
  encoder: GPUCommandEncoder,
  label: string,
  [tiers, drawn]: readonly [readonly PreparedPipeline<GPURenderPipeline>[], readonly number[]],
  target: GPUTextureView,
  pageGroup: GPUBindGroup,
  raster1: GPUBindGroup,
  args: GPUBuffer,
) {
  RASTER.label = label
  rasterDepth.view = target
  const raster = encoder.beginRenderPass(RASTER)
  raster.setBindGroup(0, pageGroup)
  raster.setBindGroup(1, raster1)
  for (const t of drawn) {
    const tier = tiers[t].get()
    if (!tier) continue
    raster.setPipeline(tier)
    raster.drawIndirect(args, (VSM_RENDER_ARGS_DRAW + 4 * t) * 4)
  }
  raster.end()
}

/** The descent and the candidates alone, in a compute pass of their own: what counts the casters
 *  of a frame that has room for none, the descent with no occlusion to judge by (a blank group). */
function encodeCountOnly(
  encoder: GPUCommandEncoder,
  ctx: VsmRenderContext,
  { lists, tables }: ReturnType<typeof renderGroups>,
  world: GPUBindGroup,
  descent: VsmRasterDescent,
) {
  const pass = encoder.beginComputePass(ctx.passes.pass(0).cull)
  encodeCandidates(pass, ctx, lists, world, descent, mainSight(ctx, tables, false))
  pass.end()
}

/** The counters a view pass owns, cleared before each pass after the first (`VSM_RENDER_COUNT_PASS`
 *  on). */
function clearPassCounts(encoder: GPUCommandEncoder, counts: GPUBuffer) {
  encoder.clearBuffer(
    counts,
    VSM_RENDER_COUNT_PASS * 4,
    (VSM_RENDER_COUNT_WORDS - VSM_RENDER_COUNT_PASS) * 4,
  )
}

/** The occlusion culling of a frame (`vsmEncodeRaster`): the set's pyramid build, whether every page
 *  is built again (`shadowOcclusionFullUpdate`), and whether the previous frame's pyramid and tables
 *  are there to test against — without, one cull a view pass. */
interface VsmRasterOcclusion {
  ctx: VsmOcclusionContext
  res: VsmResources
  fullUpdate: boolean
  twoPass: boolean
}

/** What a view pass of the raster works with: the frame's groups and lists, the cull pipelines and the half-passes' resources. */
interface ViewPassWork {
  readonly ctx: VsmRenderContext
  readonly groups: ReturnType<typeof renderGroups>
  readonly world: GPUBindGroup
  readonly scene: Pick<VsmRenderScene, 'decode'>
  readonly args: GPUBuffer
  readonly lights: number
  readonly descent: VsmRasterDescent & { viewBase: number }
  readonly occlusion?: VsmRasterOcclusion
  readonly culls: VsmRenderCullPipes
  readonly tessellation: VsmRenderScene['tessellation']
  readonly pageCompute: GPUBindGroup | undefined
  readonly lay: number
  readonly twoPass: boolean
  readonly raster: (label: string) => void
}

/** The view pass `p`: its cull and bin in one compute pass, its raster, the software half and, with the occlusion's two culls, the second half. */
function encodeOneViewPass(encoder: GPUCommandEncoder, work: ViewPassWork, p: number) {
  const {
    ctx,
    groups,
    world,
    scene,
    args,
    lights,
    descent,
    occlusion,
    culls,
    tessellation,
    pageCompute,
    lay,
    twoPass,
    raster,
  } = work
  const { counts } = groups.lists
  const each = ctx.passes.pass(p)
  if (p) clearPassCounts(encoder, counts)
  tessellation?.begin(encoder, false)
  const pass = encoder.beginComputePass(each.cull)
  if (!p) {
    const sight = mainSight(ctx, groups.tables, twoPass)
    encodeCandidates(pass, ctx, groups.lists, world, descent, sight)
    scene.decode(pass, RASTER_PASS_MAIN)
  }
  encodeViewPass(pass, ctx, groups, args, each.offset, lights, twoPass, culls, lay)
  // The records the pass listed are cut into patches, to be rastered by the software half's pass.
  tessellation?.compute(
    pass,
    false,
    groups.lists,
    each.offset,
    mainSight(ctx, groups.tables, twoPass),
  )
  pass.end()
  raster(each.raster)
  // The software half after the hardware raster, over the same sorted records.
  if (pageCompute)
    encodeSoftwarePass(
      encoder,
      each.software,
      ctx,
      groups.tables,
      args,
      each.offset,
      pageCompute,
      false,
      tessellation,
    )
  if (twoPass)
    encodeSecondHalf(encoder, ctx, groups, args, each, occlusion!, {
      ...{ pageCompute, tessellation, raster, culls },
      ...{ world, decode: scene.decode, descent },
    })
}

/**
 * The frame's raster: the counters cleared, the shadow views' descent (`descent`) and the
 * candidates over the pages it listed, the camera cut's tables bound by `world`, the list of casters
 * they close decoded by `scene.decode`; then each of the `passes` view passes — one at least, the
 * maps being some —, its views, cull and bin in one compute pass and its draws in one raster pass,
 * the counters of a pass cleared before it (`VSM_RENDER_COUNT_PASS` on); with the occlusion's two
 * culls (`occlusion`), the pyramid built after its first raster, then the descent's post pass, the
 * casters it finds, its second cull and bin and raster. With no caster (`empty`), the descent and
 * the candidates in a pass of their own, which count them, and nothing else. `throttle`: the cull
 * also counts the clusters per map.
 */
export function vsmEncodeRaster(
  encoder: GPUCommandEncoder,
  ctx: VsmRenderContext,
  groups: ReturnType<typeof renderGroups>,
  world: GPUBindGroup,
  scene: Pick<
    VsmRenderScene,
    'pageGroup' | 'decode' | 'tiers' | 'tessellation' | 'pageCompute' | 'hardwareEdge'
  >,
  args: GPUBuffer,
  {
    passes,
    mostMaps,
    lights,
    throttle,
  }: { passes: number; mostMaps: number; lights: number; throttle?: VsmThrottleState },
  empty: boolean,
  descent: VsmRasterDescent & { viewBase: number },
  occlusion?: VsmRasterOcclusion,
) {
  const { counts } = groups.lists
  const twoPass = !!occlusion?.twoPass && !!groups.tables.occlusion
  // The throttle's counts are the frame's: cleared here, kept by every pass.
  encoder.clearBuffer(counts, 0, vsmCountWords(throttle?.feedbackWords) * 4)
  clearVsmDescent(encoder, descent.descent, descent.viewBase)
  if (empty) {
    encodeCountOnly(encoder, ctx, groups, world, descent)
    return
  }
  const culls = renderCulls(ctx, !!throttle)
  const tiers = [ctx.raster.tiers, vsmRenderTiersDrawn(scene.tiers)] as const
  const tessellation = scene.tessellation
  // The patches are judged by the pyramid the cull judges the casters by, where the frame keeps one.
  if (twoPass) tessellation?.sight()
  const pageCompute = scene.pageCompute?.group
  // The views the software raster reads, laid where it draws a record and binds no projection data.
  const lay =
    pageCompute && (scene.hardwareEdge ?? 0) > 0 && vsmViewsLaid(ctx.device) ? mostMaps : 0
  const raster = (label: string) =>
    encodeRaster(encoder, label, tiers, ctx.target, scene.pageGroup, groups.tables.raster1, args)
  const work: ViewPassWork = {
    ctx,
    groups,
    world,
    scene,
    args,
    lights,
    descent,
    occlusion,
    culls,
    tessellation,
    pageCompute,
    lay,
    twoPass,
    raster,
  }
  for (let p = 0; p < passes; p++) encodeOneViewPass(encoder, work, p)
}

const secondRun = new ComputeRun()

/** The labels and parameter offset of one view pass (`VsmRenderContext.passes`). */
type ViewPassLabels = ReturnType<VsmRenderContext['passes']['pass']>

/** What a view pass's second half works with beside the frame's groups. */
interface SecondHalfWork {
  culls: VsmRenderCullPipes
  pageCompute: GPUBindGroup | undefined
  tessellation: VsmShadowTessellation | undefined
  raster: (label: string) => void
  world: GPUBindGroup
  decode: VsmRenderScene['decode']
  descent: VsmRasterDescent
}

/** The second half of a view pass `each` with the occlusion's two culls: the pyramid built over what
 *  its first raster drew, then, in a compute pass of their own, the descent's post pass and the
 *  casters it finds (`encodePostCasters`), the second cull, the post cull and the bin — and the
 *  tessellation of what they stored —, and `work.raster` over their records. */
function encodeSecondHalf(
  encoder: GPUCommandEncoder,
  ctx: VsmRenderContext,
  groups: ReturnType<typeof renderGroups>,
  args: GPUBuffer,
  each: ViewPassLabels,
  occlusion: VsmRasterOcclusion,
  work: SecondHalfWork,
) {
  prepareVsmPyramid(encoder, occlusion.res, occlusion.ctx, occlusion.fullUpdate)
  work.tessellation?.begin(encoder, true)
  // The build and the second cull follow one another: one compute pass, but on a frame timed per pass.
  const steps = secondRun.begin(encoder)
  encodeVsmPyramid(steps, occlusion.res, occlusion.ctx)
  const second = steps.pass(each.second)
  encodePostCasters(second, ctx, groups, work, each.offset)
  encodeSecondCull(second, ctx, groups, args, each.offset, work.culls)
  work.tessellation?.compute(second, true, groups.lists, each.offset, groups.tables.occlusion![1])
  steps.end()
  work.raster(each.rasterSecond)
  if (work.pageCompute) {
    const { tables } = groups
    encodeSoftwarePass(
      encoder,
      each.softwareSecond,
      ctx,
      tables,
      args,
      each.offset,
      work.pageCompute,
      true,
      work.tessellation,
    )
  }
}

/** The casters the pyramid just built shows the main pass was wrong to hold back, in `pass`: the
 *  descent's post pass over the views of the view pass whose parameters lie at `offset`, the
 *  candidates' kernel over the pages it listed — behind those of the main pass —, the kernel that
 *  closes their list, and their decode. */
function encodePostCasters(
  pass: GPUComputePassEncoder,
  ctx: VsmRenderContext,
  { lists, tables }: ReturnType<typeof renderGroups>,
  { descent, world, decode }: SecondHalfWork,
  offset: readonly number[],
) {
  encodeVsmDescentPost(pass, descent.descent, descent.info, tables.occlusion![1], offset)
  encodeCasters(pass, ctx, lists, world, descent.descent, ctx.candidatesPostDone)
  decode(pass, RASTER_PASS_POST)
}
