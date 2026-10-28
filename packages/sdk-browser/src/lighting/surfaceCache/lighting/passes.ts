import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { dispatchGrid, WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { dagReadGroupEntries, type DagReadTables } from '../../../geometry/dag/shader/bindings.ts'
import { skyLightReadBindEntries } from '../../../modules/sky/skyLight/read.ts'
import { cloudShadowBindEntries } from '../../atmosphere/cloudShadowRead.ts'
import type { SceneTrace } from '../../rays/sceneTrace/sceneTraceResources.ts'
import { sceneTraceBindEntries } from '../../rays/sceneTrace/sceneTraceWgsl.ts'
import type { SurfaceHitResources } from '../hitWgsl.ts'
import type { SurfaceAtlases } from '../atlases.ts'
import { COMBINE_BINDINGS } from './combineWgsl.ts'
import {
  CONTEXT_FEEDBACK_BINDING,
  CONTEXT_PAGE_ARGS_BINDING,
  CONTEXT_TRACES_BINDING,
  SPLICE_CONTEXT_BINDING,
} from './contextWgsl.ts'
import { CULL_BINDINGS, CULL_ENTRY } from './cullWgsl.ts'
import {
  DIRECT_BINDINGS,
  DIRECT_CLOUD_SHADOW,
  DIRECT_LIGHT_PROFILE,
  DIRECT_ENTRY,
  DIRECT_TRACED_ENTRY,
} from './directWgsl.ts'
import type {
  fixedKernels,
  ShapedKernels,
  tracedRadiosityKernels,
  tracedShadowKernels,
} from './kernels.ts'
import type { Kernel } from '../kernel.ts'
import type { StandalonePrepared } from './lightFunctionPass.ts'
import { LIGHT_FUNCTION_PASS_BINDINGS, LIGHT_FUNCTION_PASS_ENTRY } from './lightFunctionPassWgsl.ts'
import { LIGHTING_CONTEXTS } from '../../../../../sdk-core/src/lighting/surfaceCache/lightingMath.ts'
import {
  BATCHABLE_LIGHT_TYPES,
  CONTEXT_ARGS,
  CONTEXT_AT,
  LIGHT_TILE_ARGS,
  LIGHT_TILE_ARGS_WORDS,
  PAGE_ARGS_SLOT_WORDS,
} from './layout.ts'
import {
  LIGHT_TILE_COMPACT_BINDINGS,
  LIGHT_TILE_COMPACT_ENTRY,
  LIGHT_TILE_COUNTS_BINDINGS,
} from './lightTilesWgsl.ts'
import { lightProfileBindEntries } from '../../lightProfile/profileBindings.ts'
import type { LightingInputs } from './surfaceLighting.ts'
import { RADIOSITY_BUILD_BINDINGS } from './radiosityBuildWgsl.ts'
import { RADIOSITY_FILTER_BINDINGS } from './radiosityFilterWgsl.ts'
import {
  RADIOSITY_INTEGRATE_BINDINGS,
  RADIOSITY_INTEGRATE_ENTRY,
} from './radiosityIntegrateWgsl.ts'
import {
  RADIOSITY_TRACE_BINDINGS,
  RADIOSITY_TRACE_ENTRY,
  RADIOSITY_TRACED_BINDINGS,
  RADIOSITY_TRACED_SCENE,
} from './radiosityTraceWgsl.ts'
import {
  SHADOW_MASK_BINDINGS,
  SHADOW_MASK_CLOUD_SHADOW,
  SHADOW_MASK_LIGHT_PROFILE,
  SHADOW_MASK_TYPE_SLOTS,
} from './shadowMaskWgsl.ts'
import {
  SHADOW_ARGS_BINDINGS,
  SHADOW_ARGS_ENTRY,
  SHADOW_TRACE_BINDINGS,
  SHADOW_TRACE_ENTRY,
  SHADOW_TRACE_SCENE,
} from './shadowTraceWgsl.ts'
import type { LightingResources, LightSlots, TracedShadowBuffers } from './resources.ts'
import { TILE_DEPTH_RANGE_BINDINGS, TILE_DEPTH_RANGE_ENTRY } from './tileDepthRangeWgsl.ts'

/**
 * THE DISPATCHES OF AN IMAGE'S LIGHTING, each with the bind group of its program over what the image holds (`Encoding`): the
 * update context, the direct light (the light tiles of its tiles, made and compacted by slot; its shadows traced, where the image
 * has the scene trace: the masks, the arguments and the trace come between its lights and its light) and the radiosity, in the
 * order `surfaceLighting.ts` says. A program's group is made again
 * only where a resource it names moved (`Kernel.group`); the dispatches that follow a list the GPU made read their sizes
 * from its header (`CONTEXT_ARGS`) or, those over the light tiles, from the arguments of the light slots (`LIGHT_TILE_ARGS`).
 */

/** What rays are cast through the scene's triangles with in an image: the programs, the scene trace (its resources, which the
 *  image wrote the parameters of) and the cut's tables it is cast through. */
export interface TracedScene<K = ReturnType<typeof tracedRadiosityKernels>> {
  readonly kernels: K
  readonly sceneTrace: SceneTrace
  readonly views: DagReadTables
}

/** What the direct light's shadows are traced with in an image: their programs over the scene, and the buffers of their
 *  masks and traces. */
export interface TracedShadows extends TracedScene<ReturnType<typeof tracedShadowKernels>> {
  readonly buffers: TracedShadowBuffers
}

/** Everything the passes of one image read. */
export interface Encoding {
  readonly pass: GPUComputePassEncoder
  readonly resources: LightingResources
  /** The counters of the light tiles each slot holds, the arguments of the dispatches over them, and the slots they are made for. */
  readonly lightSlots: LightSlots
  readonly slots: number
  readonly atlases: SurfaceAtlases
  readonly tables: GPUBuffer
  readonly inputs: LightingInputs
  readonly hit: SurfaceHitResources
  readonly noise: GPUTextureView
  readonly fixed: ReturnType<typeof fixedKernels>
  readonly shaped: ShapedKernels
  /** The workgroups a dispatch in rows is cut at, the pages of the cache and the capacity of the indirect list in tiles. */
  readonly width: number
  readonly pages: number
  readonly indirectTiles: number
  /** Whether the radiosity's rays are filtered. */
  readonly filtered: boolean
  /** Whether the lights of a tile are culled to its depth range (`surfaceCacheDirectLightingCullToTileDepthRange`). */
  readonly cullToTileDepthRange: boolean
  /** The traced shadows of the direct light; none, the direct light's shadow is one ray through the global distance field. */
  readonly traced?: TracedShadows
  /** The scene the radiosity's rays are cast through; none, they are marched through the global distance field. */
  readonly scene?: TracedScene
  /** The light functions the atlas holds no slot of: their dispatches and the bits the cull marks their lights by. */
  readonly standalone: StandalonePrepared
  /** Where the scratch of those light functions is kept where the shadows are not traced (it follows the masks where they are);
   *  none where no light function is evaluated apart. */
  readonly scratch?: GPUBuffer
}

const buffer = (binding: number, resource: GPUBuffer) => ({
  binding,
  resource: { buffer: resource },
})
const view = (binding: number, resource: GPUTextureView) => ({ binding, resource })

function dispatch(e: Encoding, pipeline: GPUComputePipeline, group: GPUBindGroup, threads: number) {
  e.pass.setPipeline(pipeline)
  e.pass.setBindGroup(0, group)
  const [x, y] = dispatchGrid(Math.max(1, ceilDiv(threads, WORKGROUP_THREADS)), e.width)
  e.pass.dispatchWorkgroups(x, y)
}

/** A dispatch of one workgroup. */
function single(e: Encoding, pipeline: GPUComputePipeline, group: GPUBindGroup) {
  e.pass.setPipeline(pipeline)
  e.pass.setBindGroup(0, group)
  e.pass.dispatchWorkgroups(1)
}

/** A dispatch whose groups the context's header names in `slot`; `later` are the bind groups after the first. */
function fromContext(
  e: Encoding,
  pipeline: GPUComputePipeline,
  group: GPUBindGroup,
  slot: number,
  later: readonly GPUBindGroup[] = [],
  offsets?: readonly number[],
) {
  e.pass.setPipeline(pipeline)
  e.pass.setBindGroup(0, group, offsets)
  later.forEach((bound, at) => e.pass.setBindGroup(at + 1, bound))
  e.pass.dispatchWorkgroupsIndirect(e.resources.context, (CONTEXT_AT.args + 4 * slot) * 4)
}

/** A dispatch whose groups the light tiles' arguments name at `entry` (`LIGHT_TILE_ARGS`); `offsets` are the dynamic offsets of the bind group. */
function fromLightTiles(
  e: Encoding,
  pipeline: GPUComputePipeline,
  group: GPUBindGroup,
  entry: number,
  offsets?: readonly number[],
) {
  e.pass.setPipeline(pipeline)
  e.pass.setBindGroup(0, group, offsets)
  e.pass.dispatchWorkgroupsIndirect(e.lightSlots.args, entry * LIGHT_TILE_ARGS_WORDS * 4)
}

/** The bind group of the scene trace's resources, in the group `where` of `kernel`. */
function sceneGroup(
  kernel: Pick<Kernel<string>, 'group'>,
  sceneTrace: SceneTrace,
  where: { readonly group: number; readonly first: number },
) {
  return kernel.group(
    [sceneTrace.params, sceneTrace.nodes, sceneTrace.triangles, sceneTrace.table],
    () => sceneTraceBindEntries(sceneTrace, where.first),
    where.group,
  )
}

/** The tiles of the updates this image lights, chosen. */
export function contextPasses(e: Encoding) {
  const { params, context, pageArgs, standIn, feedbackStandIn } = e.resources
  const shadowTraces = e.traced?.buffers.traces ?? standIn
  const feedback = e.inputs.feedback ?? feedbackStandIn
  const kernel = e.fixed.context
  const group = kernel.group([params, e.tables, context, shadowTraces, feedback, pageArgs], () => [
    buffer(0, params),
    buffer(1, e.tables),
    buffer(2, context),
    buffer(CONTEXT_TRACES_BINDING, shadowTraces),
    buffer(CONTEXT_FEEDBACK_BINDING, feedback),
    buffer(CONTEXT_PAGE_ARGS_BINDING, pageArgs),
  ])
  const splice = e.fixed.splice
  const splicing = splice.group([params, e.tables, context], () => [
    buffer(0, params),
    buffer(1, e.tables),
    buffer(SPLICE_CONTEXT_BINDING, context),
  ])
  single(e, kernel.pipeline('contextClear'), group)
  dispatch(e, kernel.pipeline('contextHistogram'), group, e.pages)
  single(e, kernel.pipeline('contextSelect'), group)
  dispatch(e, kernel.pipeline('contextList'), group, e.pages)
  single(e, kernel.pipeline('contextPageArgs'), group)
  for (const [entry, update] of [
    ['spliceDirect', LIGHTING_CONTEXTS.direct],
    ['spliceIndirect', LIGHTING_CONTEXTS.indirect],
  ] as const) {
    e.pass.setPipeline(splice.pipeline(entry))
    e.pass.setBindGroup(0, splicing)
    e.pass.dispatchWorkgroupsIndirect(pageArgs, update * PAGE_ARGS_SLOT_WORDS * 4)
  }
  single(e, kernel.pipeline('contextArgs'), group)
}

/** The masks' buffer: the traced shadows' where they are traced, else the scratch of the light functions apart from the atlas alone,
 *  else the stand-in. The scratch is in it at the word the parameters name (`scratchAt`). */
const masksOf = (e: Encoding) => e.traced?.buffers.masks ?? e.scratch ?? e.resources.standIn

/** The light functions the atlas holds no slot of, evaluated at the texels of the light tiles of their lights, into the scratch. */
function lightFunctionPasses(e: Encoding) {
  const { params, compactedLightTiles } = e.resources
  const { counts } = e.lightSlots
  const { depth, normal } = e.atlases.physical
  const masks = masksOf(e)
  const B = LIGHT_FUNCTION_PASS_BINDINGS
  for (const { kernel, slot, offset, bytes, maps } of e.standalone.passes) {
    const group = kernel.group(
      [
        params,
        e.tables,
        counts,
        depth,
        normal,
        compactedLightTiles,
        masks,
        e.standalone.given,
        ...maps.map(({ resource }) => ('buffer' in resource ? resource.buffer : resource)),
      ],
      () => [
        buffer(0, params),
        buffer(B.tables, e.tables),
        buffer(B.counts, counts),
        view(B.depth, depth),
        view(B.normal, normal),
        buffer(B.lightTiles, compactedLightTiles),
        buffer(B.masks, masks),
        { binding: B.given, resource: { buffer: e.standalone.given!, size: bytes } },
        ...maps,
      ],
    )
    fromLightTiles(
      e,
      kernel.pipeline(LIGHT_FUNCTION_PASS_ENTRY),
      group,
      LIGHT_TILE_ARGS.slots + BATCHABLE_LIGHT_TYPES + slot,
      [offset],
    )
  }
}

/** The shadow masks of the light tiles, which list the traces they need: those of the slots of the lights together, then of the point lights', the spots'
 *  and the rectangles' slots, each by the arguments of its own. */
function shadowMaskPass(e: Encoding, { kernels, buffers }: TracedShadows) {
  const { params, compactedLightTiles } = e.resources
  const { counts } = e.lightSlots
  const { physical, factors } = e.atlases
  const { masks: shadowMasks, traces: shadowTraces } = buffers
  const { cloudShadow, lights, lightFunction, lightProfile } = e.inputs
  const M = SHADOW_MASK_BINDINGS
  const masking = kernels.shadowMask.group(
    [
      params,
      e.tables,
      counts,
      physical.depth,
      physical.normal,
      compactedLightTiles,
      shadowMasks,
      lights,
      lightFunction,
      cloudShadow.block,
      cloudShadow.maps[0],
      cloudShadow.maps[1],
      cloudShadow.sampler,
      factors,
      shadowTraces,
      lightProfile.view,
      lightProfile.sampler,
    ],
    () => [
      buffer(0, params),
      buffer(M.tables, e.tables),
      buffer(M.counts, counts),
      view(M.depth, physical.depth),
      view(M.normal, physical.normal),
      buffer(M.lightTiles, compactedLightTiles),
      buffer(M.masks, shadowMasks),
      buffer(M.lights, lights),
      view(M.lightFunction, lightFunction),
      ...cloudShadowBindEntries(SHADOW_MASK_CLOUD_SHADOW, cloudShadow),
      buffer(M.factors, factors),
      buffer(M.traces, shadowTraces),
      ...lightProfileBindEntries(SHADOW_MASK_LIGHT_PROFILE, lightProfile),
    ],
  )
  const slots = LIGHT_TILE_ARGS.slots
  const masked = [
    ['shadowMaskLights', LIGHT_TILE_ARGS.lights],
    ['shadowMaskPoint', slots + SHADOW_MASK_TYPE_SLOTS.shadowMaskPoint],
    ['shadowMaskSpot', slots + SHADOW_MASK_TYPE_SLOTS.shadowMaskSpot],
    ['shadowMaskRect', slots + SHADOW_MASK_TYPE_SLOTS.shadowMaskRect],
  ] as const
  for (const [entry, args] of masked)
    fromLightTiles(e, kernels.shadowMask.pipeline(entry), masking, args)
}

/** The arguments of the traces the masks listed. */
function shadowArgsPass(e: Encoding, { kernels, buffers }: TracedShadows) {
  const { params, context } = e.resources
  const A = SHADOW_ARGS_BINDINGS
  const args = kernels.shadowArgs.group([params, e.tables, context, buffers.traces], () => [
    buffer(0, params),
    buffer(A.tables, e.tables),
    buffer(A.context, context),
    buffer(A.traces, buffers.traces),
  ])
  single(e, kernels.shadowArgs.pipeline(SHADOW_ARGS_ENTRY), args)
}

/** The traces the masks listed, cast through the scene and the cut's tables. */
function shadowTracePass(e: Encoding, { kernels, buffers, sceneTrace, views }: TracedShadows) {
  const { params, compactedLightTiles } = e.resources
  const { physical } = e.atlases
  const { masks: shadowMasks, traces: shadowTraces } = buffers
  const { lights } = e.inputs
  const T = SHADOW_TRACE_BINDINGS
  const tracing = kernels.shadowTrace.group(
    [
      params,
      e.tables,
      shadowTraces,
      physical.depth,
      physical.normal,
      shadowMasks,
      lights,
      compactedLightTiles,
      views.nodes,
      views.frames,
      views.worlds,
      views.tree,
    ],
    () => [
      buffer(0, params),
      buffer(T.tables, e.tables),
      buffer(T.traces, shadowTraces),
      view(T.depth, physical.depth),
      view(T.normal, physical.normal),
      buffer(T.masks, shadowMasks),
      buffer(T.lights, lights),
      buffer(T.lightTiles, compactedLightTiles),
      ...dagReadGroupEntries(views),
    ],
  )
  const scene = sceneGroup(kernels.shadowTrace, sceneTrace, SHADOW_TRACE_SCENE)
  fromContext(
    e,
    kernels.shadowTrace.pipeline(SHADOW_TRACE_ENTRY),
    tracing,
    CONTEXT_ARGS.shadowTraces,
    [scene],
  )
}

/** The passes between the lights of the tiles and their light: the shadow masks, the traces' arguments
 *  and the traces. */
function shadowPasses(e: Encoding, traced: TracedShadows) {
  shadowMaskPass(e, traced)
  shadowArgsPass(e, traced)
  shadowTracePass(e, traced)
}

/** The depth range of each tile of the direct list, which the cull of the lights bounds the tile's box by. */
function tileDepthRangePass(e: Encoding) {
  const { params, context, depthRanges } = e.resources
  const { depth, normal } = e.atlases.physical
  const T = TILE_DEPTH_RANGE_BINDINGS
  const kernel = e.fixed.tileDepthRanges
  const ranges = kernel.group([params, e.tables, context, depth, normal, depthRanges], () => [
    buffer(0, params),
    buffer(T.tables, e.tables),
    buffer(T.context, context),
    view(T.depth, depth),
    view(T.normal, normal),
    buffer(T.ranges, depthRanges),
  ])
  fromContext(e, kernel.pipeline(TILE_DEPTH_RANGE_ENTRY), ranges, CONTEXT_ARGS.directTiles)
}

/**
 * The light tiles of the direct list, as the reference makes them: the lights of each tile, picked and appended to a list of light tiles (the
 * counters emptied before, the culled list written, the offsets of the slots and the arguments of the dispatches over them
 * then made), and the list compacted by slot (the count of what each slot has placed emptied before).
 */
function lightTilePasses(e: Encoding) {
  const { params, context, culledLightTiles, compactedLightTiles, cardTileLights } = e.resources
  const { cardTileOffsets, depthRanges } = e.resources
  const { counts, args } = e.lightSlots
  const tallies = e.fixed.lightTileCounts
  const C = LIGHT_TILE_COUNTS_BINDINGS
  const tallying = tallies.group([params, counts, args], () => [
    buffer(0, params),
    buffer(C.counts, counts),
    buffer(C.args, args),
  ])
  single(e, tallies.pipeline('lightTilesClear'), tallying)
  const cull = e.shaped.cull
  const K = CULL_BINDINGS
  const culling = cull.group(
    [
      params,
      e.tables,
      context,
      counts,
      cardTileOffsets,
      culledLightTiles,
      e.inputs.lights,
      depthRanges,
      e.standalone.flags,
    ],
    () => [
      buffer(0, params),
      buffer(K.tables, e.tables),
      buffer(K.context, context),
      buffer(K.counts, counts),
      buffer(K.cardTileOffsets, cardTileOffsets),
      buffer(K.culled, culledLightTiles),
      buffer(K.lights, e.inputs.lights),
      buffer(K.depthRanges, depthRanges),
      buffer(K.standalone, e.standalone.flags),
    ],
  )
  fromContext(e, cull.pipeline(CULL_ENTRY), culling, CONTEXT_ARGS.directTiles)
  single(e, tallies.pipeline('lightTilesOffsets'), tallying)
  dispatch(e, tallies.pipeline('lightTilesArgs'), tallying, e.slots)
  single(e, tallies.pipeline('lightTilesClearCompacted'), tallying)
  const compact = e.fixed.lightTileCompact
  const P = LIGHT_TILE_COMPACT_BINDINGS
  const compacting = compact.group(
    [
      params,
      counts,
      context,
      e.tables,
      culledLightTiles,
      compactedLightTiles,
      cardTileOffsets,
      cardTileLights,
    ],
    () => [
      buffer(0, params),
      buffer(P.counts, counts),
      buffer(P.context, context),
      buffer(P.tables, e.tables),
      buffer(P.culled, culledLightTiles),
      buffer(P.compacted, compactedLightTiles),
      buffer(P.cardTileOffsets, cardTileOffsets),
      buffer(P.cardTileLights, cardTileLights),
    ],
  )
  fromLightTiles(
    e,
    compact.pipeline(LIGHT_TILE_COMPACT_ENTRY),
    compacting,
    LIGHT_TILE_ARGS.compaction,
  )
}

/** The depth range of each tile of the direct list, the lights of each tile, their light on its texels, and the final light of the tiles. */
export function directPasses(e: Encoding) {
  const { params, context, cardTileLights, cardTileOffsets } = e.resources
  const shadowMasks = masksOf(e)
  const { physical, factors } = e.atlases
  const common = [buffer(0, params), buffer(1, e.tables), buffer(2, context)]
  if (e.cullToTileDepthRange) tileDepthRangePass(e)
  lightTilePasses(e)
  lightFunctionPasses(e)
  if (e.traced) shadowPasses(e, e.traced)
  const D = DIRECT_BINDINGS
  const { cloudShadow, field } = e.inputs
  const direct = e.fixed.direct.group(
    [
      params,
      e.tables,
      context,
      physical.depth,
      physical.normal,
      cardTileLights,
      physical.direct,
      e.inputs.lights,
      e.inputs.lightFunction,
      cloudShadow.block,
      cloudShadow.maps[0],
      cloudShadow.maps[1],
      cloudShadow.sampler,
      field.readGeneration,
      shadowMasks,
      factors,
      cardTileOffsets,
      e.inputs.lightProfile.view,
      e.inputs.lightProfile.sampler,
    ],
    () => [
      ...common,
      view(D.depth, physical.depth),
      view(D.normal, physical.normal),
      buffer(D.cardTileLights, cardTileLights),
      view(D.out, physical.direct),
      buffer(D.lights, e.inputs.lights),
      view(D.lightFunction, e.inputs.lightFunction),
      ...cloudShadowBindEntries(DIRECT_CLOUD_SHADOW, cloudShadow),
      ...field.readEntries(D.field),
      buffer(D.masks, shadowMasks),
      buffer(D.factors, factors),
      buffer(D.cardTileOffsets, cardTileOffsets),
      ...lightProfileBindEntries(DIRECT_LIGHT_PROFILE, e.inputs.lightProfile),
    ],
  )
  const entry = e.traced ? DIRECT_TRACED_ENTRY : DIRECT_ENTRY
  fromContext(e, e.fixed.direct.pipeline(entry), direct, CONTEXT_ARGS.directTiles)
  combine(e, 'combineDirect', CONTEXT_ARGS.directTiles)
}

/** The final light of a list's tiles. */
function combine(e: Encoding, entry: 'combineDirect' | 'combineIndirect', slot: number) {
  const { params, context } = e.resources
  const { physical } = e.atlases
  const C = COMBINE_BINDINGS
  const kernel = e.shaped.combine
  const group = kernel.group(
    [
      params,
      e.tables,
      context,
      physical.albedo,
      physical.emissive,
      physical.direct,
      physical.indirect,
      physical.final,
    ],
    () => [
      buffer(0, params),
      buffer(C.tables, e.tables),
      buffer(C.context, context),
      view(C.albedo, physical.albedo),
      view(C.emissive, physical.emissive),
      view(C.direct, physical.direct),
      view(C.indirect, physical.indirect),
      view(C.out, physical.final),
    ],
  )
  fromContext(e, kernel.pipeline(entry), group, slot)
}

/** The tiles of the rays' probes, and the arguments of their dispatches. */
function radiosityTiles(e: Encoding) {
  const { params, context } = e.resources
  const { physical } = e.atlases
  const R = RADIOSITY_BUILD_BINDINGS
  const build = e.fixed.radiosityBuild
  const tiles = build.group([params, e.tables, context, physical.depth, physical.normal], () => [
    buffer(0, params),
    buffer(R.tables, e.tables),
    buffer(R.context, context),
    view(R.depth, physical.depth),
    view(R.normal, physical.normal),
  ])
  dispatch(e, build.pipeline('radiosityTiles'), tiles, e.indirectTiles)
  single(e, build.pipeline('radiosityArgs'), tiles)
}

/** The rays filtered and projected on the harmonics. */
function radiosityFilter(e: Encoding) {
  const { params, context, trace, filtered, harmonics, hits } = e.resources
  const { physical } = e.atlases
  const F = RADIOSITY_FILTER_BINDINGS
  const filter = e.fixed.radiosityFilter
  const probes = filter.group(
    [
      params,
      e.tables,
      context,
      physical.depth,
      physical.normal,
      e.noise,
      trace,
      filtered,
      harmonics,
      hits,
    ],
    () => [
      buffer(0, params),
      buffer(F.tables, e.tables),
      buffer(F.context, context),
      view(F.depth, physical.depth),
      view(F.normal, physical.normal),
      view(F.noise, e.noise),
      view(F.trace, trace),
      buffer(F.filtered, filtered),
      view(F.harmonics, harmonics),
      view(F.hits, hits),
    ],
  )
  if (e.filtered) fromContext(e, filter.pipeline('radiosityFilter'), probes, CONTEXT_ARGS.traces)
  fromContext(e, filter.pipeline('radiosityToSh'), probes, CONTEXT_ARGS.probes)
}

/** The harmonics integrated into the indirect light of the tiles. */
function radiosityIntegrate(e: Encoding) {
  const { params, context, harmonics, hits } = e.resources
  const { physical } = e.atlases
  const I = RADIOSITY_INTEGRATE_BINDINGS
  const integrate = e.fixed.radiosityIntegrate
  const group = integrate.group(
    [
      params,
      e.tables,
      context,
      physical.depth,
      physical.normal,
      harmonics,
      physical.indirect,
      physical.frames,
      hits,
    ],
    () => [
      buffer(0, params),
      buffer(I.tables, e.tables),
      buffer(I.context, context),
      view(I.depth, physical.depth),
      view(I.normal, physical.normal),
      view(I.harmonics, harmonics),
      view(I.indirect, physical.indirect),
      view(I.frames, physical.frames),
      view(I.hits, hits),
    ],
  )
  fromContext(e, integrate.pipeline(RADIOSITY_INTEGRATE_ENTRY), group, CONTEXT_ARGS.indirectTiles)
}

/** The rays' probes: their tiles, the rays traced through the scene's triangles or the field, filtered, projected on the harmonics, integrated. */
export function radiosityPasses(e: Encoding) {
  radiosityTiles(e)
  traceRays(e)
  radiosityFilter(e)
  radiosityIntegrate(e)
  combine(e, 'combineIndirect', CONTEXT_ARGS.indirectTiles)
}

/** The trace of the probes' rays, through the scene's triangles where the image has the scene trace, else the global field. */
function traceRays(e: Encoding) {
  if (e.scene) traceRaysThroughScene(e, e.scene)
  else traceRaysThroughField(e)
}

/** What either trace of the probes' rays reads and writes, at its bindings `T`: the parameters, the cards' tables and
 *  layers, the context, the trace atlas, the lights and the sky. */
function rayTraceShared(
  e: Encoding,
  T: typeof RADIOSITY_TRACE_BINDINGS | typeof RADIOSITY_TRACED_BINDINGS,
) {
  const { params, context, trace } = e.resources
  const { physical } = e.atlases
  const { sky, lights } = e.inputs
  return {
    identity: [
      params,
      e.tables,
      physical.depth,
      physical.normal,
      physical.final,
      context,
      trace,
      lights,
      sky.cube,
      sky.sampler,
      sky.harmonics,
      sky.params,
      e.hit.instances,
      e.noise,
    ],
    entries: () => [
      buffer(0, params),
      buffer(T.tables, e.tables),
      view(T.depth, physical.depth),
      view(T.normal, physical.normal),
      view(T.final, physical.final),
      buffer(T.context, context),
      view(T.out, trace),
      buffer(T.lights, lights),
      ...skyLightReadBindEntries(T.sky, sky),
      buffer(T.instances, e.hit.instances),
      view(T.noise, e.noise),
    ],
  }
}

/** The trace of the probes' rays through the scene's triangles, beside the cut's tables. */
function traceRaysThroughScene(e: Encoding, { kernels, sceneTrace, views }: TracedScene) {
  const shared = rayTraceShared(e, RADIOSITY_TRACED_BINDINGS)
  const { hits } = e.resources
  const kernel = kernels.radiosityTraced
  const group = kernel.group(
    [...shared.identity, hits, views.nodes, views.frames, views.worlds, views.tree],
    () => [
      ...shared.entries(),
      view(RADIOSITY_TRACED_BINDINGS.hits, hits),
      ...dagReadGroupEntries(views),
    ],
  )
  const scene = sceneGroup(kernel, sceneTrace, RADIOSITY_TRACED_SCENE)
  fromContext(e, kernel.pipeline(RADIOSITY_TRACE_ENTRY), group, CONTEXT_ARGS.traces, [scene])
}

/** The trace of the probes' rays through the global distance field. */
function traceRaysThroughField(e: Encoding) {
  const T = RADIOSITY_TRACE_BINDINGS
  const shared = rayTraceShared(e, T)
  const { field } = e.inputs
  const kernel = e.fixed.radiosityTrace
  const group = kernel.group([...shared.identity, field.readGeneration, e.hit.grid], () => [
    ...shared.entries(),
    ...field.readEntries(T.field),
    buffer(T.grid, e.hit.grid),
  ])
  fromContext(e, kernel.pipeline(RADIOSITY_TRACE_ENTRY), group, CONTEXT_ARGS.traces)
}
