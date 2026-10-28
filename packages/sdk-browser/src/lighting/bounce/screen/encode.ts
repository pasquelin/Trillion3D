import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { SCREEN_PROBE_PASS } from '../../../diagnostic/stage/passLabels.ts'
import type { RadianceCache } from '../cache/radianceCache.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { REFLECTION_GROUP } from '../../reflections/viewLayout.ts'
import type { ScreenProbeGroups } from './groups.ts'
import type { CastKernels, ScreenProbeKernels } from './kernels.ts'
import type { ScreenProbeResources } from './resources.ts'
import type { ScreenProbeGeometry } from './screenProbeLayout.ts'
import { CLASSIFIED_POINTS } from './integratePassWgsl.ts'
import {
  INTEGRATE_TILE_SIDE,
  SCREEN_PROBE_ARGS,
  adaptiveWorkgroups,
  gatherMipSide,
  integrateArgsAt,
} from './screenProbeLayout.ts'
import type { MeshStageRun } from './meshStage.ts'
import { TRACE_MESH_GROUP } from './traceMeshWgsl.ts'
import type { TracedSceneGroups } from './traceGroups.ts'
import { TRACE_TRACED_SCENE } from './traceTracedWgsl.ts'

/** What a frame's dispatches are made of. */
export interface ScreenProbeRun {
  kernels: ScreenProbeKernels
  resources: ScreenProbeResources
  groups: ScreenProbeGroups
  /** The reflection group: the depth pyramid, the last lit image and the lighting's view. */
  reflection: GPUBindGroup
  /** The part of it the scene stages read: the view, the lighting's view and the sky light (`reflectionSceneLayout`). */
  sceneReflection: GPUBindGroup
  settings: ScreenProbeSettings
  /** The radiance cache, whose update the probes' importance is added to before: none where the cache is none. */
  cache?: Pick<RadianceCache, 'encode'>
  /** The scene stage that casts the rays through the scene's triangles, where this image has it (`tracedSceneOf`): none, the rays are marched. */
  traced?: TracedSceneGroups
  /** The meshes' fields stage (`meshStageOf`), where this image traces them for the probes the scene stage marches through the global field: dispatched before it. */
  meshes?: MeshStageRun
  /** A stage a pass of the frame adds once the rays are traced and filtered (`ScreenProbeStage`), where its kernel is compiled: dispatched over the scene stage's group 0. */
  stage?: { pipeline: GPUComputePipeline; encode(pass: GPUComputePassEncoder): void }
}

/** What the passes over the probes are made of: the run, its kernels and groups over the probes. */
export type CastRun = Omit<ScreenProbeRun, 'kernels' | 'groups'> & {
  kernels: CastKernels
  groups: ScreenProbeGroups['cast']
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
 *  cover marked, each kept unless a sample of a lower rank covers it, then numbered in the order of the tiles and of the ranks (`placeWgsl.ts`) —, then the arguments of the kernels over the
 *  probes in use, then what the pixels ask of the probes' rays (`screenData`). */
function placeProbes(pass: GPUComputePassEncoder, run: CastRun) {
  const { geometry: g } = run.resources
  const { place } = run.groups
  const { pipelines } = run.kernels.place
  dispatch(pass, pipelines.placeUniform, place, ceilDiv(g.tilesX, 8), ceilDiv(g.tilesY, 8))
  if (g.maxAdaptive > 0) {
    const [x, y] = adaptiveWorkgroups(g)
    dispatch(pass, pipelines.adaptiveMark, place, x, y)
    dispatch(pass, pipelines.adaptiveSpawn, place, x, y)
    dispatch(pass, pipelines.adaptiveNumber, place, 1, 1)
    dispatch(pass, pipelines.adaptiveWrite, place, x, y)
  }
  dispatch(pass, pipelines.probeArgs, place, 1, 1)
  dispatchOver(
    pass,
    run.kernels.screenData.pipelines.screenData,
    run.groups.screenData,
    run.resources.args,
    PROBES_AT,
  )
}

/** The update of the radiance cache the rays read and, with importance sampling, the directions the rays are traced in (`genRays`, where the light
 *  is the second half), from what the pixels asked of the probes (`screenData`, in the placement). */
function chooseRays(pass: GPUComputePassEncoder, run: CastRun) {
  const { groups, kernels, settings, resources } = run
  if (run.cache?.encode(pass)) pass.setBindGroup(REFLECTION_GROUP, run.reflection)
  if (settings.values.screenProbeImportanceSampling)
    dispatchOver(pass, kernels.rays.pipelines.genRays, groups.rays, resources.args, PROBES_AT)
}

/** The scene's stage over the list of the rays the screen left: the march through the global distance field, the radiance cache answering
 *  the rays it leaves; or, where the image casts them through the scene's triangles (`run.traced`), that trace — group 2 the scene trace — and
 *  then the radiance cache's answer to the rays it left (`traceFar`, over the march's group). The scene stages read the part of the reflection group
 *  that is theirs (`run.sceneReflection`), set before them and the whole group set back after, for the kernels that follow. */
function traceScene(pass: GPUComputePassEncoder, run: CastRun) {
  const { groups, kernels, resources, traced, meshes } = run
  const { sceneRays } = resources
  pass.setBindGroup(REFLECTION_GROUP, run.sceneReflection)
  if (traced) {
    pass.setPipeline(traced.pipeline)
    pass.setBindGroup(0, traced.groups[0])
    pass.setBindGroup(TRACE_TRACED_SCENE.group, traced.groups[1])
    pass.dispatchWorkgroupsIndirect(sceneRays, 0)
    dispatchOver(pass, kernels.traceScene.pipelines.traceFar, groups.traceScene, sceneRays, 0)
  } else {
    if (meshes) {
      pass.setPipeline(meshes.pipeline)
      pass.setBindGroup(0, groups.traceScene)
      pass.setBindGroup(TRACE_MESH_GROUP, meshes.group)
      pass.dispatchWorkgroupsIndirect(sceneRays, 0)
    }
    dispatchOver(pass, kernels.traceScene.pipelines.traceScene, groups.traceScene, sceneRays, 0)
  }
  pass.setBindGroup(REFLECTION_GROUP, run.reflection)
}

/** The stage a pass of the frame added, over the scene stage's group 0 and the whole reflection group the pass holds. */
function addedStage(pass: GPUComputePassEncoder, run: ScreenProbeRun, cast: CastRun) {
  if (!run.stage) return
  pass.setPipeline(run.stage.pipeline)
  pass.setBindGroup(0, cast.groups.traceScene)
  run.stage.encode(pass)
}

/** The levels of the gathered radiance with their border: the finest level's border fixed up from the filtered radiance, then, where the gather holds
 *  more than one level (`screenProbeGatherNumMips`), each coarser level the mean of the one before. */
function gatherLevels(pass: GPUComputePassEncoder, run: CastRun) {
  const { groups, kernels, resources: r, settings } = run
  const { fixup } = kernels
  const { geometry: g } = r
  const side = (level: number) => gatherMipSide(g.gather, settings.gatherMips, level)
  const over = (level: number) =>
    [ceilDiv(g.tilesX * side(level), 8), ceilDiv(g.rows * side(level), 8)] as const
  dispatch(pass, fixup.pipelines.fixup, groups.fixup, ...over(0))
  kernels.mips.forEach((kernel, at) =>
    dispatch(pass, kernel.pipelines.mip, groups.mips[at], ...over(at + 1)),
  )
}

/** The trace of the rays — the screen's stage, which lists the rays it left, the scene's over that list: the near trace, then the radiance
 *  cache for the share of a ray it leaves —, then the filter: the composite into the octahedron, the temporal filter of the probes, the spatial passes, the
 *  conversion to what the pixels read and the levels of the filtered radiance. */
function traceAndFilter(pass: GPUComputePassEncoder, run: CastRun) {
  const { groups, kernels, settings, resources } = run
  const { args } = resources
  dispatchOver(pass, kernels.traceScreen.pipelines.traceScreen, groups.traceScreen, args, PROBES_AT)
  traceScene(pass, run)
  dispatchOver(pass, kernels.composite.pipelines.composite, groups.composite, args, PROBES_AT)
  if (kernels.probeFilter && groups.probeFilter)
    dispatchOver(
      pass,
      kernels.probeFilter.pipelines.probeFilter,
      groups.probeFilter,
      args,
      TEXELS_AT,
    )
  for (let k = 0; k < settings.spatialFilterPasses; k++)
    dispatchOver(pass, kernels.spatial.pipelines.spatialFilter, groups.spatial[k], args, TEXELS_AT)
  dispatchOver(pass, kernels.convert.pipelines.convert, groups.convert, args, PROBES_AT)
  gatherLevels(pass, run)
}

/** The integration of the probes the pixels read: where the tiles are classified, the tiles of cells (pixels, or one in each two by two block where the integration is downsampled) classified
 *  by the most complete mode their pixels need (a tile with no lit pixel cleared), then the integration of the tiles of each mode, dispatched over the workgroups the classification counted;
 *  else one integration over every cell. */
function integratePixels(pass: GPUComputePassEncoder, run: ScreenProbeRun, cast: CastRun) {
  const { geometry: g, tileArgs } = run.resources
  const { tile, integrate } = run.groups
  if (!integrate) return
  const { tile: classify, integrate: modes, integrateEvery } = cast.kernels
  const reduction = run.settings.integrateDownsample
  const cells = [
    ceilDiv(ceilDiv(g.width, reduction), INTEGRATE_TILE_SIDE),
    ceilDiv(ceilDiv(g.height, reduction), INTEGRATE_TILE_SIDE),
  ] as const
  if (classify && modes && tile) {
    dispatch(pass, classify.pipelines.tileInit, tile, 1, 1)
    dispatch(pass, classify.pipelines.tileClassify, tile, ...cells)
    dispatch(pass, classify.pipelines.tileFinish, tile, 1, 1)
    CLASSIFIED_POINTS.forEach((point, mode) =>
      dispatchOver(pass, modes.pipelines[point], integrate, tileArgs, integrateArgsAt(mode)),
    )
  } else if (integrateEvery) {
    dispatch(pass, integrateEvery.pipelines.integrateEvery, integrate, ...cells)
  }
}

/** The short-range occlusion's pass over an image of the geometry `g`, a thread a texel of the image over `downsample`. */
function dispatchOcclusion(
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline,
  group: GPUBindGroup,
  g: Pick<ScreenProbeGeometry, 'width' | 'height'>,
  downsample: number,
) {
  dispatch(
    pass,
    pipeline,
    group,
    ceilDiv(ceilDiv(g.width, downsample), 8),
    ceilDiv(ceilDiv(g.height, downsample), 8),
  )
}

/** The short-range occlusion alone, in a compute pass of its own with the reflection group `reflection` set: the irradiance field's (`encodeFieldOcclusion`). */
export function encodeOcclusionOnly(
  encoder: GPUCommandEncoder,
  reflection: GPUBindGroup,
  pipeline: GPUComputePipeline,
  group: GPUBindGroup,
  g: Pick<ScreenProbeGeometry, 'width' | 'height'>,
  downsample: number,
) {
  const pass = encoder.beginComputePass({ label: SCREEN_PROBE_PASS })
  pass.setBindGroup(REFLECTION_GROUP, reflection)
  dispatchOcclusion(pass, pipeline, group, g, downsample)
  pass.end()
}

/** The pixels: the short-range occlusion is searched, the probes they read integrated, the texel each reads of that integration picked where it is downsampled, and the temporal pass blends
 *  the light with its history, writing what the lighting reads. */
function shadePixels(pass: GPUComputePassEncoder, run: ScreenProbeRun, cast: CastRun) {
  const { geometry: g } = run.resources
  const { groups, kernels, settings } = run
  const image = [ceilDiv(g.width, 8), ceilDiv(g.height, 8)] as const
  if (settings.occlusion)
    dispatchOcclusion(
      pass,
      kernels.occlusion.pipelines.occlusion,
      groups.occlusion,
      g,
      settings.occlusionDownsample,
    )
  integratePixels(pass, run, cast)
  if (cast.kernels.stochastic && run.groups.stochastic)
    dispatch(
      pass,
      cast.kernels.stochastic.pipelines.stochasticOffsets,
      run.groups.stochastic,
      ...image,
    )
  dispatch(pass, kernels.temporal.pipelines.temporal, groups.temporal, ...image)
}

/** The compute pass of the screen probes, its reflection group set: the group is group 1 of every kernel, set once a pass. */
function beginPass(encoder: GPUCommandEncoder, run: ScreenProbeRun) {
  const pass = encoder.beginComputePass({ label: SCREEN_PROBE_PASS })
  pass.setBindGroup(REFLECTION_GROUP, run.reflection)
  return pass
}

/** The run over the probes: made once an image, at its placement. */
const castOf = (run: ScreenProbeRun): CastRun => ({
  ...run,
  kernels: run.kernels.cast,
  groups: run.groups.cast,
})

/**
 * THE FIRST HALF OF AN IMAGE OF THE SCREEN PROBES, in a compute pass of its own: the list of the rays the screen leaves emptied, then
 * the placement and what the pixels ask of the probes' rays. The answer is the run of the probes placed, which `encodeProbeTrace` takes. What follows the placement — the probe pool's marks of the cells the probes stand in,
 * in passes of its own — is encoded between the two.
 */
export function encodeProbePlacement(encoder: GPUCommandEncoder, run: ScreenProbeRun) {
  const cast = castOf(run)
  encoder.copyBufferToBuffer(run.resources.listHead, 0, run.resources.sceneRays, 0, 16)
  const pass = beginPass(encoder, run)
  placeProbes(pass, cast)
  pass.end()
  return cast
}

/**
 * THE SECOND HALF OF AN IMAGE OF THE SCREEN PROBES, in a compute pass of its own: the choice of the rays, the trace, the filter, the short-range occlusion, the integration of the probes the pixels read (over the tiles it lists) and the temporal pass, which blends it. The reflection group — the depth
 * pyramid, the last lit image, the lighting's view — is group 1 of every kernel. The kernels over the probes are dispatched over the
 * atlas's rows that hold one (`probeArgs`), the scene's over the rays listed. The result is the history of this image's turn
 * (`ScreenProbeResources.history`), which the lighting reads. `cast` is the run of the probes the placement answered.
 */
export function encodeProbeTrace(encoder: GPUCommandEncoder, run: ScreenProbeRun, cast: CastRun) {
  const pass = beginPass(encoder, run)
  chooseRays(pass, cast)
  traceAndFilter(pass, cast)
  addedStage(pass, run, cast)
  shadePixels(pass, run, cast)
  pass.end()
}
