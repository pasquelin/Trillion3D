import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { dispatchGrid, WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { skyLightReadBindEntries } from '../../../modules/sky/skyLight/read.ts'
import { cloudShadowBindEntries } from '../../atmosphere/cloudShadowRead.ts'
import type { SurfaceHitResources } from '../hitWgsl.ts'
import type { SurfaceAtlases } from '../atlases.ts'
import { COMBINE_BINDINGS } from './combineWgsl.ts'
import { DIRECT_BINDINGS, DIRECT_CLOUD_SHADOW } from './directWgsl.ts'
import type { staticKernels, ShapedKernels } from './kernels.ts'
import { CONTEXT_ARGS, CONTEXT_AT } from './layout.ts'
import type { LightingInputs } from './surfaceLighting.ts'
import { RADIOSITY_BUILD_BINDINGS } from './radiosityBuildWgsl.ts'
import { RADIOSITY_FILTER_BINDINGS } from './radiosityFilterWgsl.ts'
import { RADIOSITY_INTEGRATE_BINDINGS } from './radiosityIntegrateWgsl.ts'
import { RADIOSITY_TRACE_BINDINGS } from './radiosityTraceWgsl.ts'
import type { LightingResources } from './resources.ts'

/**
 * THE DISPATCHES OF AN IMAGE'S LIGHTING, each with the bind group of its program over what the image holds (`Encoding`): the
 * update context, the direct light and the radiosity, in the order `surfaceLighting.ts` says. A program's group is made again
 * only where a resource it names moved (`Kernel.group`); the dispatches that follow a list the GPU made read their sizes
 * from its header (`CONTEXT_ARGS`).
 */

/** Everything the passes of one image read. */
export interface Encoding {
  readonly pass: GPUComputePassEncoder
  readonly resources: LightingResources
  readonly atlases: SurfaceAtlases
  readonly tables: GPUBuffer
  readonly inputs: LightingInputs
  readonly hit: SurfaceHitResources
  readonly noise: GPUTextureView
  readonly fixed: ReturnType<typeof staticKernels>
  readonly shaped: ShapedKernels
  /** The workgroups a dispatch in rows is cut at, the pages of the cache and the capacity of the indirect list in tiles. */
  readonly width: number
  readonly pages: number
  readonly indirectTiles: number
  /** Whether the radiosity's rays are filtered. */
  readonly filtered: boolean
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

/** A dispatch whose groups the context's header names in `slot`. */
function fromContext(e: Encoding, pipeline: GPUComputePipeline, group: GPUBindGroup, slot: number) {
  e.pass.setPipeline(pipeline)
  e.pass.setBindGroup(0, group)
  e.pass.dispatchWorkgroupsIndirect(e.resources.context, (CONTEXT_AT.args + 4 * slot) * 4)
}

/** The tiles of the updates this image lights, chosen. */
export function contextPasses(e: Encoding) {
  const { params, context } = e.resources
  const kernel = e.fixed.context
  const group = kernel.group([params, e.tables, context], () => [
    buffer(0, params),
    buffer(1, e.tables),
    buffer(2, context),
  ])
  single(e, kernel.pipeline('contextClear'), group)
  dispatch(e, kernel.pipeline('contextHistogram'), group, e.pages)
  single(e, kernel.pipeline('contextSelect'), group)
  dispatch(e, kernel.pipeline('contextList'), group, e.pages)
  single(e, kernel.pipeline('contextArgs'), group)
}

/** The lights of each tile, their light on its texels, and the final light of the tiles. */
export function directPasses(e: Encoding) {
  const { params, context, tileLights } = e.resources
  const { physical } = e.atlases
  const common = [buffer(0, params), buffer(1, e.tables), buffer(2, context)]
  const cull = e.shaped.cull
  const culling = cull.group(
    [params, e.tables, context, physical.depth, physical.normal, tileLights, e.inputs.lights],
    () => [
      ...common,
      view(3, physical.depth),
      view(4, physical.normal),
      buffer(5, tileLights),
      buffer(6, e.inputs.lights),
    ],
  )
  fromContext(e, cull.pipeline('cullLights'), culling, CONTEXT_ARGS.directTiles)
  const D = DIRECT_BINDINGS
  const { cloudShadow, field } = e.inputs
  const direct = e.fixed.direct.group(
    [
      params,
      e.tables,
      context,
      physical.depth,
      physical.normal,
      tileLights,
      physical.direct,
      e.inputs.lights,
      e.inputs.lightFunction,
      cloudShadow.block,
      cloudShadow.maps[0],
      cloudShadow.maps[1],
      cloudShadow.sampler,
      field.readGeneration,
    ],
    () => [
      ...common,
      view(D.depth, physical.depth),
      view(D.normal, physical.normal),
      buffer(D.tileLights, tileLights),
      view(D.out, physical.direct),
      buffer(D.lights, e.inputs.lights),
      view(D.lightFunction, e.inputs.lightFunction),
      ...cloudShadowBindEntries(DIRECT_CLOUD_SHADOW, cloudShadow),
      ...field.readEntries(D.field),
    ],
  )
  fromContext(e, e.fixed.direct.pipeline('directShade'), direct, CONTEXT_ARGS.directTiles)
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
  const tiles = build.group(
    [params, e.tables, context, physical.depth, physical.normal, e.noise],
    () => [
      buffer(0, params),
      buffer(R.tables, e.tables),
      buffer(R.context, context),
      view(R.depth, physical.depth),
      view(R.normal, physical.normal),
      view(R.noise, e.noise),
    ],
  )
  dispatch(e, build.pipeline('radiosityTiles'), tiles, e.indirectTiles)
  single(e, build.pipeline('radiosityArgs'), tiles)
}

/** The rays filtered and projected on the harmonics. */
function radiosityFilter(e: Encoding) {
  const { params, context, trace, filtered, harmonics } = e.resources
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
    ],
  )
  if (e.filtered) fromContext(e, filter.pipeline('radiosityFilter'), probes, CONTEXT_ARGS.traces)
  fromContext(e, filter.pipeline('radiosityToSh'), probes, CONTEXT_ARGS.probes)
}

/** The harmonics integrated into the indirect light of the tiles. */
function radiosityIntegrate(e: Encoding) {
  const { params, context, harmonics } = e.resources
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
      e.noise,
      harmonics,
      physical.indirect,
      physical.frames,
    ],
    () => [
      buffer(0, params),
      buffer(I.tables, e.tables),
      buffer(I.context, context),
      view(I.depth, physical.depth),
      view(I.normal, physical.normal),
      view(I.noise, e.noise),
      view(I.harmonics, harmonics),
      view(I.indirect, physical.indirect),
      view(I.frames, physical.frames),
    ],
  )
  fromContext(e, integrate.pipeline('radiosityIntegrate'), group, CONTEXT_ARGS.indirectTiles)
}

/** The rays' probes: their tiles, the rays traced through the field, filtered, projected on the harmonics, integrated. */
export function radiosityPasses(e: Encoding) {
  radiosityTiles(e)
  traceRays(e)
  radiosityFilter(e)
  radiosityIntegrate(e)
  combine(e, 'combineIndirect', CONTEXT_ARGS.indirectTiles)
}

/** The trace of the probes' rays. */
function traceRays(e: Encoding) {
  const { params, context, trace } = e.resources
  const { physical } = e.atlases
  const T = RADIOSITY_TRACE_BINDINGS
  const { sky, field, lights } = e.inputs
  const kernel = e.fixed.radiosityTrace
  const group = kernel.group(
    [
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
      field.readGeneration,
      e.hit.grid,
      e.hit.instances,
      e.noise,
    ],
    () => [
      buffer(0, params),
      buffer(T.tables, e.tables),
      view(T.depth, physical.depth),
      view(T.normal, physical.normal),
      view(T.final, physical.final),
      buffer(T.context, context),
      view(T.out, trace),
      buffer(T.lights, lights),
      ...skyLightReadBindEntries(T.sky, sky),
      ...field.readEntries(T.field),
      buffer(T.grid, e.hit.grid),
      buffer(T.instances, e.hit.instances),
      view(T.noise, e.noise),
    ],
  )
  fromContext(e, kernel.pipeline('radiosityTrace'), group, CONTEXT_ARGS.traces)
}
