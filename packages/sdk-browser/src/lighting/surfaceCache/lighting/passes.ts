import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { dispatchGrid, WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { dagReadGroupEntries, type DagReadTables } from '../../../geometry/dag/shader/bindings.ts'
import { skyLightReadBindEntries } from '../../../modules/sky/skyLight/read.ts'
import { cloudShadowBindEntries } from '../../atmosphere/cloudShadowRead.ts'
import type { SceneTrace } from '../../rays/sceneTrace/sceneTraceResources.ts'
import {
  sceneTraceGroupEntries,
  sceneTraceGroupResources,
} from '../../rays/sceneTrace/sceneTraceGroup.ts'
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
import { DIRECT_BINDINGS, DIRECT_ENTRY } from './directWgsl.ts'
import { FIELD_SHADOW_FIRST, FIELD_SHADOW_MESH_ENTRY } from './fieldShadowWgsl.ts'
import type {
  fieldShadowKernels,
  fieldShadowMeshKernel,
  fixedKernels,
  ShapedKernels,
  tracedRadiosityKernels,
  tracedShadowKernels,
} from './kernels.ts'
import type { Kernel } from '../kernel.ts'
import type { MeshShadow } from './meshShadow.ts'
import { MESH_SHADOW_GROUP } from './meshShadowWgsl.ts'
import type { StandalonePrepared } from './standaloneMask.ts'
import { STANDALONE_MASK_GIVEN_BINDING } from './standaloneMaskWgsl.ts'
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
  SHADOW_MASK_STANDALONE_ENTRY,
  SHADOW_MASK_TYPE_SLOTS,
} from './shadowMaskWgsl.ts'
import {
  SHADOW_ARGS_BINDINGS,
  SHADOW_ARGS_ENTRY,
  SHADOW_TRACE_BINDINGS,
  SHADOW_TRACE_ENTRY,
  SHADOW_TRACE_SCENE,
} from './shadowTraceWgsl.ts'
import {
  STOCHASTIC_COMPACT_BINDINGS,
  STOCHASTIC_COMPACT_ENTRY,
  STOCHASTIC_GENERATE_BINDINGS,
  STOCHASTIC_GENERATE_ENTRY,
  STOCHASTIC_GENERATE_LIGHT_PROFILE,
  STOCHASTIC_SHADE_BINDINGS,
  STOCHASTIC_SHADE_ENTRY,
  STOCHASTIC_TEMPORAL_BINDINGS,
  STOCHASTIC_TEMPORAL_ENTRY,
} from './stochasticWgsl.ts'
import type { stochasticKernels } from './kernels.ts'
import type {
  LightingResources,
  LightSlots,
  StochasticBuffers,
  TracedShadowBuffers,
} from './resources.ts'
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

/** What the direct light's shadows are traced with in an image whose scene is not traced through its triangles: the masks' programs and the pass through the
 *  global distance field, the buffers of the masks and traces, and, where the meshes' fields are listed for the suns, the pass through those and their lists. */
export interface FieldShadows {
  readonly kernels: ReturnType<typeof fieldShadowKernels>
  /** The masks, and the buffer the masks' program lists no trace in (a stand-in: the distance fields' pass walks the light tiles). */
  readonly buffers: { readonly masks: GPUBuffer; readonly traces: GPUBuffer }
  readonly mesh?: {
    readonly lists: MeshShadow
    readonly kernel: ReturnType<typeof fieldShadowMeshKernel>
  }
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
  /** The traced shadows of the direct light, their rays cast through the scene's triangles. */
  readonly traced?: TracedShadows
  /** The shadows of the direct light traced through the distance fields; none where `traced` is. */
  readonly field?: FieldShadows
  /** The stochastic direct light (`stochasticWgsl.ts`), where it is asked for and the shadows are traced: its programs, its memory and the half of its history this image reads. */
  readonly stochastic?: {
    readonly kernels: ReturnType<typeof stochasticKernels>
    readonly buffers: StochasticBuffers
    readonly read: 0 | 1
    /** Whether the light is blended over the images (`surfaceCacheDirectLightingStochasticTemporal`). */
    readonly temporal: boolean
  }
  /** The scene the radiosity's rays are cast through; none, they are marched through the global distance field. */
  readonly scene?: TracedScene
  /** The light functions the atlas holds no slot of: the dispatches of the masks of their lights and the bits the cull marks their lights by. */
  readonly standalone: StandalonePrepared
}

/** The buffers of the masks and traces of the image's shadows, whatever they are traced through. */
const shadowBuffers = (e: Encoding) => (e.traced ?? e.field)?.buffers

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

/** Binds `pipeline`, `group` first with its dynamic `offsets`, then `later`. No offsets are no argument: the browser's
 *  optimised call takes an absent sequence badly once the function is hot. */
function bindAll(
  e: Encoding,
  pipeline: GPUComputePipeline,
  group: GPUBindGroup,
  later: readonly GPUBindGroup[],
  offsets: readonly number[] | undefined,
) {
  e.pass.setPipeline(pipeline)
  if (offsets) e.pass.setBindGroup(0, group, offsets)
  else e.pass.setBindGroup(0, group)
  later.forEach((bound, at) => e.pass.setBindGroup(at + 1, bound))
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
  bindAll(e, pipeline, group, later, offsets)
  e.pass.dispatchWorkgroupsIndirect(e.resources.context, (CONTEXT_AT.args + 4 * slot) * 4)
}

/** A dispatch whose groups the light tiles' arguments name at `entry` (`LIGHT_TILE_ARGS`); `offsets` are the dynamic offsets of the bind group. */
function fromLightTiles(
  e: Encoding,
  pipeline: GPUComputePipeline,
  group: GPUBindGroup,
  entry: number,
  offsets?: readonly number[],
  later: readonly GPUBindGroup[] = [],
) {
  bindAll(e, pipeline, group, later, offsets)
  e.pass.dispatchWorkgroupsIndirect(e.lightSlots.args, entry * LIGHT_TILE_ARGS_WORDS * 4)
}

/** The names of the scene trace's resources: the kernel copies them as it is asked, so one list serves every group. */
const sceneNames: unknown[] = []

/** The bind group of the scene trace's resources, in the group `where` of `kernel`. */
function sceneGroup(
  kernel: Pick<Kernel<string>, 'group'>,
  sceneTrace: SceneTrace,
  where: { readonly group: number; readonly first: number },
) {
  return kernel.group(
    sceneTraceGroupResources(sceneTrace, sceneNames),
    () => sceneTraceGroupEntries(sceneTrace, where.first),
    where.group,
  )
}

/** The tiles of the updates this image lights, chosen. */
export function contextPasses(e: Encoding) {
  const { params, context, pageArgs, standIn, feedbackStandIn } = e.resources
  const shadowTraces = shadowBuffers(e)?.traces ?? standIn
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
  // The cut among the pages of the bucket the budget ends in, by index (`contextCut`).
  single(e, kernel.pipeline('contextCut'), group)
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

/** The masks' buffer, the stand-in where the image's shadows have none. */
const masksOf = (e: Encoding) => shadowBuffers(e)?.masks ?? e.resources.standIn

/** The dispatches over the light tiles that make the masks and, in the same order and by the same arguments, settle them through the distance fields: the lights together, then each batchable type. */
const MASK_DISPATCHES = [
  { mask: 'shadowMaskLights', field: 'fieldShadowLights', args: LIGHT_TILE_ARGS.lights },
  {
    mask: 'shadowMaskPoint',
    field: 'fieldShadowPoint',
    args: LIGHT_TILE_ARGS.slots + SHADOW_MASK_TYPE_SLOTS.shadowMaskPoint,
  },
  {
    mask: 'shadowMaskSpot',
    field: 'fieldShadowSpot',
    args: LIGHT_TILE_ARGS.slots + SHADOW_MASK_TYPE_SLOTS.shadowMaskSpot,
  },
  {
    mask: 'shadowMaskRect',
    field: 'fieldShadowRect',
    args: LIGHT_TILE_ARGS.slots + SHADOW_MASK_TYPE_SLOTS.shadowMaskRect,
  },
] as const

/** What the masks and the traces' arguments are made with, whatever the traces are answered through: the programs of the masks and of the arguments, and the buffers. */
interface ShadowSet {
  readonly kernels: Pick<ReturnType<typeof tracedShadowKernels>, 'shadowMask'>
  readonly buffers: { readonly masks: GPUBuffer; readonly traces: GPUBuffer }
}

/** The masks of the lights whose function the atlas holds no slot of, made by the program of each light's material over the tiles of the light's slot: the
 *  mask's bindings of the image in group 0, the light's block and the maps, at the light's offset, in group 1. */
function standaloneMaskPasses(
  e: Encoding,
  identity: readonly unknown[],
  entries: () => GPUBindGroupEntry[],
) {
  for (const { kernel, slot, offset, bytes, maps } of e.standalone.passes) {
    const masking = kernel.group(identity, entries)
    const given = kernel.group(
      [
        e.standalone.given,
        ...maps.map(({ resource }) => ('buffer' in resource ? resource.buffer : resource)),
      ],
      () => [
        {
          binding: STANDALONE_MASK_GIVEN_BINDING,
          resource: { buffer: e.standalone.given!, size: bytes },
        },
        ...maps,
      ],
      1,
    )
    e.pass.setPipeline(kernel.pipeline(SHADOW_MASK_STANDALONE_ENTRY))
    e.pass.setBindGroup(0, masking)
    e.pass.setBindGroup(1, given, [offset])
    e.pass.dispatchWorkgroupsIndirect(
      e.lightSlots.args,
      (LIGHT_TILE_ARGS.slots + BATCHABLE_LIGHT_TYPES + slot) * LIGHT_TILE_ARGS_WORDS * 4,
    )
  }
}

/** The shadow masks of the light tiles, which list the traces they need: those of the slots of the lights together, then of the point lights', the spots'
 *  and the rectangles' slots, each by the arguments of its own, after the masks of the lights whose function the atlas holds no slot of, made by the program of their
 *  material and listing their traces the same way. */
function shadowMaskPass(e: Encoding, { kernels, buffers }: ShadowSet) {
  const { params, compactedLightTiles } = e.resources
  const { counts } = e.lightSlots
  const { physical, factors } = e.atlases
  const { masks: shadowMasks, traces: shadowTraces } = buffers
  const { cloudShadow, lights, lightFunction, lightProfile } = e.inputs
  const M = SHADOW_MASK_BINDINGS
  const identity = [
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
    lightProfile.rectView,
  ]
  const entries = () => [
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
  ]
  const masking = kernels.shadowMask.group(identity, entries)
  // The lights whose function the atlas holds no slot of come first, as the reference makes their masks before the batched types'.
  standaloneMaskPasses(e, identity, entries)
  for (const { mask, args } of MASK_DISPATCHES)
    fromLightTiles(e, kernels.shadowMask.pipeline(mask), masking, args)
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

/** The resources a pass that answers the listed traces binds in its first group, and their entries (`SHADOW_TRACE_BINDINGS`). */
function traceAnswerBindings(e: Encoding, { masks, traces }: TracedShadowBuffers) {
  const { params, compactedLightTiles } = e.resources
  const { depth, normal } = e.atlases.physical
  const { lights } = e.inputs
  const T = SHADOW_TRACE_BINDINGS
  return {
    identity: [params, e.tables, traces, depth, normal, masks, lights, compactedLightTiles],
    entries: () => [
      buffer(0, params),
      buffer(T.tables, e.tables),
      buffer(T.traces, traces),
      view(T.depth, depth),
      view(T.normal, normal),
      buffer(T.masks, masks),
      buffer(T.lights, lights),
      buffer(T.lightTiles, compactedLightTiles),
    ],
  }
}

/** The traces the masks listed, cast through the scene and the cut's tables. */
function shadowTracePass(e: Encoding, { kernels, buffers, sceneTrace, views }: TracedShadows) {
  const bound = traceAnswerBindings(e, buffers)
  const tracing = kernels.shadowTrace.group(
    [...bound.identity, views.nodes, views.frames, views.worlds, views.tree],
    () => [...bound.entries(), ...dagReadGroupEntries(views)],
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

/** The masks of the light tiles settled through the distance fields, over the same light tiles and dispatch arguments as the masks: first the suns' whose meshes' fields are listed, through those meshes, then the rest through the global field. */
function fieldShadowPasses(e: Encoding, { kernels, buffers, mesh }: FieldShadows) {
  const { params, compactedLightTiles } = e.resources
  const { counts } = e.lightSlots
  const { depth, normal } = e.atlases.physical
  const { lights, field } = e.inputs
  const M = SHADOW_MASK_BINDINGS
  const tiles = [
    params,
    e.tables,
    counts,
    depth,
    normal,
    compactedLightTiles,
    buffers.masks,
    lights,
  ]
  const entries = () => [
    buffer(0, params),
    buffer(M.tables, e.tables),
    buffer(M.counts, counts),
    view(M.depth, depth),
    view(M.normal, normal),
    buffer(M.lightTiles, compactedLightTiles),
    buffer(M.masks, buffers.masks),
    buffer(M.lights, lights),
  ]
  if (mesh) {
    fromLightTiles(
      e,
      mesh.kernel.pipeline(FIELD_SHADOW_MESH_ENTRY),
      mesh.kernel.group(tiles, entries),
      LIGHT_TILE_ARGS.lights,
      undefined,
      [mesh.kernel.group(mesh.lists.identity, mesh.lists.entries, MESH_SHADOW_GROUP)],
    )
  }
  const marching = kernels.fieldShadow.group([...tiles, field.readGeneration], () => [
    ...entries(),
    ...field.readEntries(FIELD_SHADOW_FIRST),
  ])
  for (const { field: entry, args } of MASK_DISPATCHES)
    fromLightTiles(e, kernels.fieldShadow.pipeline(entry), marching, args)
}

/** The stochastic light of the image where it is asked for and its shadows are traced. */
const stochasticOf = (e: Encoding) => (e.traced ? e.stochastic : undefined)

/** The lights of each tile of the direct list as the stochastic light picks them (`stochasticGenerate`): the lights that reach the tile, the lights each texel picks among
 *  them, and the lights picked appended to the list of light tiles, as the cull appends the lights it keeps. */
function stochasticGeneratePass(
  e: Encoding,
  { kernels, buffers }: NonNullable<Encoding['stochastic']>,
) {
  const { params, context, culledLightTiles, cardTileOffsets } = e.resources
  const { counts } = e.lightSlots
  const { physical } = e.atlases
  const { lights, lightFunction, lightProfile } = e.inputs
  const G = STOCHASTIC_GENERATE_BINDINGS
  const generating = kernels.generate.group(
    [
      params,
      e.tables,
      context,
      counts,
      physical.depth,
      physical.normal,
      culledLightTiles,
      cardTileOffsets,
      lights,
      e.standalone.flags,
      buffers.samples,
      lightFunction,
      lightProfile.view,
      lightProfile.sampler,
      lightProfile.rectView,
      e.noise,
    ],
    () => [
      buffer(0, params),
      buffer(G.tables, e.tables),
      buffer(G.context, context),
      buffer(G.counts, counts),
      view(G.depth, physical.depth),
      view(G.normal, physical.normal),
      buffer(G.culled, culledLightTiles),
      buffer(G.cardTileOffsets, cardTileOffsets),
      buffer(G.lights, lights),
      buffer(G.standalone, e.standalone.flags),
      buffer(G.samples, buffers.samples),
      view(G.lightFunction, lightFunction),
      ...lightProfileBindEntries(STOCHASTIC_GENERATE_LIGHT_PROFILE, lightProfile),
      view(G.noise, e.noise),
    ],
  )
  fromContext(
    e,
    kernels.generate.pipeline(STOCHASTIC_GENERATE_ENTRY),
    generating,
    CONTEXT_ARGS.directTiles,
  )
}

/** The traces of the lights picked (`stochasticCompact`), in the shadow traces' list the masks left empty. */
function stochasticCompactPass(
  e: Encoding,
  kernels: NonNullable<Encoding['stochastic']>['kernels'],
  samples: GPUBuffer,
  traced: TracedShadows,
) {
  const { params, context, cardTileLights, cardTileOffsets } = e.resources
  const { physical } = e.atlases
  const { masks, traces } = traced.buffers
  const C = STOCHASTIC_COMPACT_BINDINGS
  const compacting = kernels.compact.group(
    [
      params,
      e.tables,
      context,
      cardTileLights,
      cardTileOffsets,
      samples,
      masks,
      traces,
      physical.depth,
      physical.normal,
    ],
    () => [
      buffer(0, params),
      buffer(C.tables, e.tables),
      buffer(C.context, context),
      buffer(C.cardTileLights, cardTileLights),
      buffer(C.cardTileOffsets, cardTileOffsets),
      buffer(C.samples, samples),
      buffer(C.masks, masks),
      buffer(C.traces, traces),
      view(C.depth, physical.depth),
      view(C.normal, physical.normal),
    ],
  )
  fromContext(
    e,
    kernels.compact.pipeline(STOCHASTIC_COMPACT_ENTRY),
    compacting,
    CONTEXT_ARGS.directTiles,
  )
}

/** The blend of the resolved light with the images before (`stochasticTemporal`), the history taking turns. */
function stochasticTemporalPass(
  e: Encoding,
  kernels: NonNullable<Encoding['stochastic']>['kernels'],
  buffers: NonNullable<Encoding['stochastic']>['buffers'],
  read: number,
) {
  const { params, context } = e.resources
  const { physical } = e.atlases
  const { samples, resolved, history } = buffers
  const T = STOCHASTIC_TEMPORAL_BINDINGS
  const [last, next] = [history[read], history[read === 0 ? 1 : 0]]
  const blending = kernels.temporal.group(
    [
      params,
      e.tables,
      context,
      physical.depth,
      physical.normal,
      samples,
      resolved,
      last.lighting,
      last.frames,
      next.lighting,
      next.frames,
      physical.direct,
    ],
    () => [
      buffer(0, params),
      buffer(T.tables, e.tables),
      buffer(T.context, context),
      view(T.depth, physical.depth),
      view(T.normal, physical.normal),
      buffer(T.samples, samples),
      view(T.resolved, resolved),
      view(T.historyLighting, last.lighting),
      view(T.historyFrames, last.frames),
      view(T.lightingOut, next.lighting),
      view(T.framesOut, next.frames),
      view(T.out, physical.direct),
    ],
  )
  fromContext(
    e,
    kernels.temporal.pipeline(STOCHASTIC_TEMPORAL_ENTRY),
    blending,
    CONTEXT_ARGS.directTiles,
  )
}

/** The light of the picked lights (`stochasticShade`) and, where it is blended over the images, the blend (`stochasticTemporal`), in the place of the direct light's own program. */
function stochasticShadingPasses(
  e: Encoding,
  { kernels, buffers, read, temporal }: NonNullable<Encoding['stochastic']>,
  traced: TracedShadows,
) {
  const { params, context, cardTileLights, cardTileOffsets } = e.resources
  const { physical } = e.atlases
  const { samples, resolved } = buffers
  const { masks } = traced.buffers
  const S = STOCHASTIC_SHADE_BINDINGS
  const shading = kernels.shade.group(
    [
      params,
      e.tables,
      context,
      physical.depth,
      physical.normal,
      cardTileLights,
      cardTileOffsets,
      samples,
      masks,
      physical.direct,
      resolved,
    ],
    () => [
      buffer(0, params),
      buffer(S.tables, e.tables),
      buffer(S.context, context),
      view(S.depth, physical.depth),
      view(S.normal, physical.normal),
      buffer(S.cardTileLights, cardTileLights),
      buffer(S.cardTileOffsets, cardTileOffsets),
      buffer(S.samples, samples),
      buffer(S.masks, masks),
      view(S.out, physical.direct),
      view(S.resolved, resolved),
    ],
  )
  fromContext(e, kernels.shade.pipeline(STOCHASTIC_SHADE_ENTRY), shading, CONTEXT_ARGS.directTiles)
  if (temporal) stochasticTemporalPass(e, kernels, buffers, read)
}

/** The passes between the lights of the tiles and their light: the shadow masks, the traces' arguments
 *  and the traces, answered through the scene's triangles or through the distance fields. */
export function shadowPasses(e: Encoding) {
  const { traced, field } = e
  const shadows = traced ?? field
  if (!shadows) return
  shadowMaskPass(e, shadows)
  if (field) return fieldShadowPasses(e, field)
  if (!traced) return
  // The stochastic light lists the traces of the lights it picked (the masks list none), before the arguments count them.
  const stochastic = stochasticOf(e)
  if (stochastic) stochasticCompactPass(e, stochastic.kernels, stochastic.buffers.samples, traced)
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

/** The lights of each tile of the direct list, picked and appended to the list of light tiles (`cull`). */
function lightTileCullPass(e: Encoding) {
  const { params, context, culledLightTiles, cardTileOffsets, depthRanges } = e.resources
  const { counts } = e.lightSlots
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
}

/** The list of light tiles compacted by slot, each tile's lights placed in it. */
function lightTileCompactPass(e: Encoding) {
  const { params, context, culledLightTiles, compactedLightTiles, cardTileLights } = e.resources
  const { cardTileOffsets } = e.resources
  const { counts } = e.lightSlots
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

/**
 * The light tiles of the direct list, as the reference makes them: the lights of each tile, picked and appended to a list of light tiles (the
 * counters emptied before, the culled list written, the offsets of the slots and the arguments of the dispatches over them
 * then made), and the list compacted by slot (the count of what each slot has placed emptied before). The stochastic light picks the lights of the
 * tiles in its own generation of the samples, which appends the lights it picked in the place of the cull.
 */
function lightTilePasses(e: Encoding) {
  const { params } = e.resources
  const { counts, args } = e.lightSlots
  const tallies = e.fixed.lightTileCounts
  const C = LIGHT_TILE_COUNTS_BINDINGS
  const tallying = tallies.group([params, counts, args], () => [
    buffer(0, params),
    buffer(C.counts, counts),
    buffer(C.args, args),
  ])
  single(e, tallies.pipeline('lightTilesClear'), tallying)
  const stochastic = stochasticOf(e)
  if (stochastic) stochasticGeneratePass(e, stochastic)
  else lightTileCullPass(e)
  single(e, tallies.pipeline('lightTilesOffsets'), tallying)
  dispatch(e, tallies.pipeline('lightTilesArgs'), tallying, e.slots)
  single(e, tallies.pipeline('lightTilesClearCompacted'), tallying)
  lightTileCompactPass(e)
}
/** The direct light of the texels, from the lights' irradiance and the shadow masks (`DIRECT_ENTRY`). */
function directShadePass(e: Encoding) {
  const { params, context, cardTileLights, cardTileOffsets } = e.resources
  const shadowMasks = masksOf(e)
  const { physical, factors } = e.atlases
  const D = DIRECT_BINDINGS
  const kernel = e.fixed.direct
  const direct = kernel.group(
    [
      params,
      e.tables,
      context,
      physical.depth,
      physical.normal,
      cardTileLights,
      physical.direct,
      e.inputs.lights,
      shadowMasks,
      factors,
      cardTileOffsets,
    ],
    () => [
      buffer(0, params),
      buffer(1, e.tables),
      buffer(2, context),
      view(D.depth, physical.depth),
      view(D.normal, physical.normal),
      buffer(D.cardTileLights, cardTileLights),
      view(D.out, physical.direct),
      buffer(D.lights, e.inputs.lights),
      buffer(D.masks, shadowMasks),
      buffer(D.factors, factors),
      buffer(D.cardTileOffsets, cardTileOffsets),
    ],
  )
  fromContext(e, kernel.pipeline(DIRECT_ENTRY), direct, CONTEXT_ARGS.directTiles)
}

/** The depth range of each tile of the direct list, the lights of each tile, their light on its texels, and the final light of the tiles. */
export function directPasses(e: Encoding) {
  if (e.cullToTileDepthRange && !stochasticOf(e)) tileDepthRangePass(e)
  lightTilePasses(e)
  shadowPasses(e)
  const stochastic = stochasticOf(e)
  if (e.traced && stochastic) {
    stochasticShadingPasses(e, stochastic, e.traced)
    combine(e, 'combineDirect', CONTEXT_ARGS.directTiles)
    return
  }
  directShadePass(e)
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
