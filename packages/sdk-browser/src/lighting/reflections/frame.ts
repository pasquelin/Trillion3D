import { skyLightReadOf } from '../../frame/render/skyLightState.ts'
import { wantsContractLighting } from '../../frame/prepare/lit.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { frontStamp } from './frontLayer.ts'
import type { ScreenReflection } from './gpu.ts'
import { reflectionField, reflectionGroup, reflectionLightView } from './group.ts'
import { readableCache } from './hitCards.ts'
import { stageReflectionImage } from './image.ts'
import { holdLitImage, vectorsReach } from './litImage.ts'
import { demandSurfaceCache, surfaceHitReads } from '../surfaceCache/frame.ts'
import { encodeReflectionTrace } from './trace/traceEncode.ts'
import { screenProbeVectors } from '../bounce/screen/vectorSource.ts'
import { drawsLit } from '../../visibility/shader/shadeMode.ts'
import { reflects } from '../../frame/backend/state/viewOverrides.ts'
import { waterFrontOf } from '../../blend/water/waterReflection.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { readHizSetting } from '../../../../sdk-core/src/contracts/hizOptions.ts'

/** The device offset the temporal anti-aliasing shifts this image's view-projection by
 *  (`jitterViewProjection`), none when the image does not accumulate; the scratch tuple it fills is
 *  the one every image returns. */
const NO_JITTER = [0, 0] as const
const jitter: [number, number] = [0, 0]
function jitterOf({ gpu }: WebgpuPagesRuntime): readonly [number, number] {
  const taa = gpu.temporal?.frame
  if (!taa?.active) return NO_JITTER
  jitter[0] = (2 * taa.jitter[0]) / taa.jitterGrid[0]
  jitter[1] = (2 * taa.jitter[1]) / taa.jitterGrid[1]
  return jitter
}

/** Stages the image's reflection view (`stageReflectionImage`), which the trace and the forward
 *  programs read: `traced`, whether the trace runs this image; unchanged, nothing is sent. */
function writeFrame(rt: WebgpuPagesRuntime, reflection: ScreenReflection, traced: boolean) {
  const { gpu, run } = rt,
    { frame } = reflection
  frame.size = gpu.targetSize
  frame.depthDrawn = run.depthDrawn
  frame.eye = run.gate.cam.eye
  frame.preExposure = preExposureOf(rt).now
  frame.jitter = jitterOf(rt)
  frame.surroundings = reflection.surroundings(run.clearColor)
  // The scene's extent bounds a ray the scene walks: the probes' cascades' reach, none without probes.
  const cascades = rt.bounce.wanted ? rt.bounce.probes?.cascades : undefined
  frame.sceneReach =
    cascades && cascades.levels.length > 0 && cascades.probes > 0 ? cascades.reach : undefined
  // The transparents' front surface, answered where this very image's pass wrote it (`encodeFrontPass`).
  frame.front = traced && reflection.front.reflected === frontStamp(run.frame)
  // What a ray may spend and which stages run, from the session's settings (`settings.ts`).
  const settings = (frame.settings = reflection.settings(rt.context, waterFrontOf(rt)))
  stageReflectionImage(reflection, frame)
  return settings
}

/**
 * The depth pyramid's trace layers — the nearest and, with the planes, the finished depth's farthest —
 * which the readers of the whole depth read: the direct lights' contact rays (`lighting/shadows/vsm/`)
 * and the reflections' trace both walk them with the screen march (`visibility/hiz/gpu/screenMarch.ts`).
 * They are built with the culling layer, in the visibility's last build
 * (`../../visibility/passes/passes.ts`), from the opaque depth: here only the frame words go up. With
 * `hizFoldTransparents` the build is made again here (`GpuHiz.encodeFull`), in one compute pass after this image's
 * front pass wrote the transparents' covering depth into level 0's front layer (`frontLayer.ts`),
 * which it folds in where the pass drew this image — its frame word up.
 * The settings decide what the layers hold: `hizTrace` — the planes' corners and the finished
 * depth's farthest, or the closest depth of each texel's centre — and `hizFoldTransparents` — the
 * transparent surfaces folded into them, or the opaque depth alone (`hizOptions.ts`).
 */
export function encodeDepthPyramid(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis, run } = rt,
    hiz = vis.gpuHiz,
    reflection = gpu.reflection
  if (!hiz) return
  // An image whose front pass drew none, a scene that lost its last transparent: the word down, so no
  // reader folds the last glass; and down while the setting leaves the transparents out.
  const folds = readHizSetting(rt, 'hizFoldTransparents')
  hiz.front(folds && reflection?.front.drawn === frontStamp(run.frame))
  hiz.planes(readHizSetting(rt, 'hizTrace') === 'planes')
  // The pass is the view's reflection's, made with the surfaces every lit image draws.
  if (!folds || !run.depthDrawn || !reflection) return
  hiz.encodeFull(reflection.depthPass.begin(encoder))
  reflection.depthPass.end()
}

/** The depth pyramid's resources where this image built its finished-depth layers from the opaque
 *  depth alone — after the raster's rest pass; the fog's furthest depth is read from them —, none where the image drew no depth or its transparents' front is folded into
 *  them: a cell behind a pane is not hidden. */
export function opaquePyramidOf(rt: WebgpuPagesRuntime) {
  const { gpu, vis, run } = rt,
    reflection = gpu.reflection
  if (!run.depthDrawn || !reflection || reflection.front.drawn === frontStamp(run.frame)) return
  return vis.gpuHiz?.depth()
}

/** Binds what the trace reads into the inputs of `reflection`; the surface cache whose feedback the main
 *  view's trace writes, none for another view. */
function bindTraceInputs(
  rt: WebgpuPagesRuntime,
  reflection: ScreenReflection,
  settings: ReturnType<typeof writeFrame>,
  surfaces: NonNullable<WebgpuPagesRuntime['gpu']['surfaces']>,
) {
  const { gpu, lights } = rt
  const views = surfaces.views()
  const { inputs } = reflection
  inputs.base = views[0]
  inputs.flags = views[3]
  inputs.normals = views[1]
  inputs.lobes = surfaces.lobesView
  inputs.lights = lights.buffer!
  inputs.field = reflectionField(rt)!
  // The rays marched through the field read the surface cache for their hits, and the main view's write what they
  // would have read finer (`feedbackBuffer.ts`).
  const cache = settings.marchesField ? readableCache(rt) : undefined
  if (settings.marchesField) demandSurfaceCache(rt)
  const writes = rt.views.active === rt.views.main ? cache : undefined
  writes?.feedback.begin(writes.cache, gpu.targetSize)
  inputs.hit = surfaceHitReads(rt, reflection.device).hit
  // The vectors are this image's motion since the image before: read only against that image's history.
  const reach = vectorsReach(reflection.lit.held, reflection.frame.image ?? 0)
  inputs.vectors = (reach && screenProbeVectors(rt)) || reflection.noVectors
  return writes
}

/**
 * The image's reflections, before its lighting: the view uniform, then one compute pass — both
 * surfaces' rays, traced a pixel each, reused and accumulated (`trace/trace.ts`) into the reflection target the
 * resolve reads and the front radiance the forward fragments read, when the image is lit, its field
 * read from the bounce cascades, its hits from the surface cache. What the lighting's view holds of the image — its
 * inverse view-projection, the eye, the exposure, the display curve, the background — the trace
 * reads there (`gpu.deferred.update`, written before the image is submitted). Every lit image traces
 * and accumulates, still or moving: a still view is how the history fills, a moving one how it
 * follows. A view that shows no lit image (`drawsLit`), or that does not `reflecting`, traces none (the view is still staged:
 * the screen probes and the translucency's light read it), and makes no grid for it.
 */
export function encodeReflections(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  reflecting: boolean,
) {
  const { gpu, vis, lights, run } = rt,
    reflection = gpu.reflection,
    stages = vis.reflectionPipelines,
    hiz = vis.gpuHiz,
    depth = hiz?.depth(),
    lightView = reflectionLightView(rt)
  // This image traces nothing until its trace says so (`census.copy`).
  reflection?.census.idle()
  if (!reflection || !stages || !lightView) return
  const surfaces = gpu.surfaces,
    deferred = gpu.deferred,
    traced =
      reflecting &&
      wantsContractLighting(rt) &&
      drawsLit(run.diagnostic) &&
      !!surfaces &&
      !!lights.buffer &&
      !!deferred
  // Every image whose radiance is built is staged, reflecting or not.
  const settings = writeFrame(rt, reflection, traced)
  if (!hiz || !depth) return
  if (traced) {
    const writes = bindTraceInputs(rt, reflection, settings, surfaces)
    const group = reflectionGroup(reflection, depth, lightView, skyLightReadOf(rt))
    // The rays count this image's alone: the counters emptied before the trace, copied after it.
    reflection.census.clear(encoder)
    encodeReflectionTrace(
      encoder,
      reflection,
      stages,
      reflection.inputs,
      group,
      gpu.targetSize,
      [settings.block, settings.block],
      settings.frontBlock,
      !!reflection.frame.front,
    )
    reflection.census.copy(encoder, run.frame)
    writes?.feedback.end(encoder, writes.cache)
  }
}

/** Whether the reflections have a lit image to keep: an image they staged (`encodeReflections` told its
 *  view of it). */
const holdsLit = ({ gpu, vis }: WebgpuPagesRuntime) =>
  !!vis.reflectionPipelines && !!gpu.hdrTexture && !!gpu.deferred

/** Whether this image's lit colour is kept for the next image's reflections (`holdReflectionImage`),
 *  so that what is composed onto it is what they read. */
export const keepsLitImage = (rt: WebgpuPagesRuntime) =>
  !!rt.gpu.reflection && holdsLit(rt) && reflects(rt.views.active.overrides)

/** The image's lit colour is kept, once every surface drew into it and before the temporal resolve
 *  reads it: what the next image's reflections reproject their hits into, read as it is, the lit
 *  image once the image is encoded (`adoptLitImage`). */
export function holdReflectionImage(rt: WebgpuPagesRuntime) {
  const reflection = rt.gpu.reflection
  if (!reflection || !holdsLit(rt)) return
  const { frame } = reflection
  holdLitImage(
    reflection.lit,
    frame.viewProjection,
    frame.size,
    frame.preExposure,
    frame.jitter,
    frame.image,
  )
}
