import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { SCREEN_PROBE_PASS } from '../../../diagnostic/stage/passLabels.ts'
import type { RadianceCache } from '../cache/radianceCache.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { REFLECTION_GROUP } from '../../reflections/viewLayout.ts'
import type { ScreenProbeGroups } from './groups.ts'
import type { CastKernels, ScreenProbeKernels } from './kernels.ts'
import type { ScreenProbeResources } from './resources.ts'
import { SCREEN_PROBE_ARGS } from './screenProbeLayout.ts'

/** What a frame's dispatches are made of. */
interface ScreenProbeRun {
  kernels: ScreenProbeKernels
  resources: ScreenProbeResources
  groups: ScreenProbeGroups
  /** The reflection group: the depth pyramid, the last lit image and the lighting's view. */
  reflection: GPUBindGroup
  settings: ScreenProbeSettings
  /** The radiance cache, whose update the probes' importance is added to before: none where the cache is none. */
  cache?: Pick<RadianceCache, 'encode'>
}

/** What the passes over the probes are made of: the run of a level that casts them, its kernels and groups over the probes. */
type CastRun = Omit<ScreenProbeRun, 'kernels' | 'groups'> & {
  kernels: CastKernels
  groups: NonNullable<ScreenProbeGroups['cast']>
}

/** The bytes at which the arguments of the kernels over the probes in use and over their texels start. */
const PROBES_AT = SCREEN_PROBE_ARGS.probes * 4
const TEXELS_AT = SCREEN_PROBE_ARGS.texels * 4

/** A dispatch of a kernel `pipeline` over `group` in group 0, `x` by `y` workgroups. */
function dispatch(
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline,
  group: GPUBindGroup,
  x: number,
  y: number,
) {
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(Math.max(1, x), Math.max(1, y))
}

/** A dispatch over `group` of the workgroups `args` holds at byte `at`, written by the GPU (`probeArgs`) or a list's head. */
function dispatchOver(
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline,
  group: GPUBindGroup,
  args: GPUBuffer,
  at: number,
) {
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroupsIndirect(args, at)
}

/** The placement: the uniform probes, then the adaptive ones — the samples a tile's uniform probes do not
 *  cover marked, each kept unless a sample of a lower rank covers it (`placeWgsl.ts`) —, then the arguments of the kernels over the
 *  probes in use. */
function placeProbes(pass: GPUComputePassEncoder, run: CastRun) {
  const { geometry: g } = run.resources
  const { place } = run.groups
  const { pipelines } = run.kernels.place
  dispatch(pass, pipelines.placeUniform, place, ceilDiv(g.tilesX, 8), ceilDiv(g.tilesY, 8))
  if (g.maxAdaptive > 0) {
    const x = ceilDiv(g.tilesX * g.samplesX, 8),
      y = ceilDiv(g.tilesY * g.samplesY, 8)
    dispatch(pass, pipelines.adaptiveMark, place, x, y)
    dispatch(pass, pipelines.adaptiveSpawn, place, x, y)
  }
  dispatch(pass, pipelines.probeArgs, place, 1, 1)
}

/** What the pixels ask of the probes' rays (`screenData`), the update of the radiance cache the pixels' importance goes into
 *  (`scatterPdf`, between the cache's clear and its tiles), and, with importance sampling, the directions the rays are traced in
 *  (`genRays`, where the light is the second half): the cache is read by them. */
function chooseRays(pass: GPUComputePassEncoder, run: CastRun) {
  const { groups, kernels, settings, resources } = run
  dispatchOver(
    pass,
    kernels.screenData.pipelines.screenData,
    groups.screenData,
    resources.args,
    PROBES_AT,
  )
  const scatter = (inPass: GPUComputePassEncoder) =>
    dispatchOver(
      inPass,
      kernels.scatter.pipelines.scatterPdf,
      groups.scatter,
      resources.args,
      PROBES_AT,
    )
  if (run.cache?.encode(pass, scatter)) pass.setBindGroup(REFLECTION_GROUP, run.reflection)
  if (settings.values.screenProbeImportanceSampling)
    dispatchOver(pass, kernels.rays.pipelines.genRays, groups.rays, resources.args, PROBES_AT)
}

/** The trace of the rays — the screen's stage, which lists the rays it left, the scene's over that list: the near trace, then the radiance
 *  cache for the share of a ray it leaves —, then the filter: the composite into the octahedron, the spatial passes, the conversion to what
 *  the pixels read. */
function traceAndFilter(pass: GPUComputePassEncoder, run: CastRun) {
  const { groups, kernels, settings, resources } = run
  const { args, sceneRays } = resources
  dispatchOver(pass, kernels.traceScreen.pipelines.traceScreen, groups.traceScreen, args, PROBES_AT)
  dispatchOver(pass, kernels.traceScene.pipelines.traceScene, groups.traceScene, sceneRays, 0)
  dispatchOver(pass, kernels.composite.pipelines.composite, groups.composite, args, PROBES_AT)
  for (let k = 0; k < settings.spatialFilterPasses; k++)
    dispatchOver(
      pass,
      kernels.spatial.pipelines.spatialFilter,
      groups.spatial[k % 2],
      args,
      TEXELS_AT,
    )
  dispatchOver(pass, kernels.convert.pipelines.convert, groups.convert, args, PROBES_AT)
}

/** The pixels: the short-range occlusion is searched, and the temporal pass integrates each pixel's probes — where the level casts
 *  them — and blends it with the history, writing what the lighting reads. */
function shadePixels(pass: GPUComputePassEncoder, run: ScreenProbeRun) {
  const { geometry: g } = run.resources
  const { groups, kernels, settings } = run
  const image = [ceilDiv(g.width, 8), ceilDiv(g.height, 8)] as const
  if (settings.occlusion) {
    const d = settings.occlusionDownsample
    dispatch(
      pass,
      kernels.occlusion.pipelines.occlusion,
      groups.occlusion,
      ceilDiv(ceilDiv(g.width, d), 8),
      ceilDiv(ceilDiv(g.height, d), 8),
    )
  }
  dispatch(pass, kernels.temporal.pipelines.temporal, groups.temporal, ...image)
}

/**
 * ONE IMAGE OF THE SCREEN PROBES, in a compute pass of its own: the list of the rays the screen leaves emptied, then in order the
 * placement, the choice of the rays, the trace, the filter — the levels that cast probes —, the short-range occlusion and the
 * temporal pass, which integrates. The reflection group — the depth pyramid, the last lit image, the lighting's view — is group 1
 * of every kernel, set once. The kernels over the probes are dispatched over the atlas's rows that hold one (`probeArgs`), the
 * scene's over the rays listed. The result is the history of this image's turn (`ScreenProbeResources.history`), which the
 * lighting reads.
 */
export function encodeScreenProbes(encoder: GPUCommandEncoder, run: ScreenProbeRun) {
  const { resources } = run
  const { cast: kernels } = run.kernels,
    { cast: groups } = run.groups
  const cast: CastRun | undefined = kernels && groups && { ...run, kernels, groups }
  if (cast) encoder.copyBufferToBuffer(resources.listHead, 0, resources.sceneRays, 0, 16)
  const pass = encoder.beginComputePass({ label: SCREEN_PROBE_PASS })
  pass.setBindGroup(REFLECTION_GROUP, run.reflection)
  if (cast) {
    placeProbes(pass, cast)
    chooseRays(pass, cast)
    traceAndFilter(pass, cast)
  }
  shadePixels(pass, run)
  pass.end()
}
