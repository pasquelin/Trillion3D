import { skyLightReadOf } from '../../frame/render/skyLightState.ts'
import { wantsContractLighting } from '../../frame/prepare/lit.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { noiseFrame } from '../../frame/render/noiseFrame.ts'
import { frontStamp } from './frontLayer.ts'
import { firstPersonBoundsOf } from './firstPersonBounds.ts'
import type { ScreenReflection } from './gpu.ts'
import { reflectionField, reflectionGroup, reflectionLightView } from './group.ts'
import { readableCache } from './hitCards.ts'
import { hardwareReflections } from './hardware.ts'
import { followReflectionLight } from './reflectionPipelines.ts'
import { surfaceCacheLightOf } from '../surfaceCache/light.ts'
import type { LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'
import { rayFogReadOf } from './rayFog.ts'
import { sceneRaysOf } from '../surfaceCache/lighting/surfaceLighting.ts'
import { stageReflectionImage } from './image.ts'
import { holdLitImage, vectorsReach } from './litImage.ts'
import {
  cameraSeen,
  NEVER_SEEN,
  previousCameraOf,
} from '../../frame/backend/state/previousCamera.ts'
import { demandSurfaceCache, surfaceHitReads } from '../surfaceCache/frame.ts'
import { encodeReflectionTrace } from './trace/traceEncode.ts'
import { reflectionMeshesOf } from './trace/meshes.ts'
import { radianceCacheStage } from './radianceCache/stage.ts'
import { screenProbeVectors } from '../bounce/screen/vectorSource.ts'
import { drawsLit } from '../../visibility/shader/shadeMode.ts'
import { reflects } from '../../frame/backend/state/viewOverrides.ts'
import { waterFrontOf } from '../../blend/water/waterReflection.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { readHizSetting } from '../../../../sdk-core/src/contracts/hizOptions.ts'
import type { ReflectionSettings } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { blueNoiseNow, noiseViewOn } from '../../gpu/noise/blueNoiseTextures.ts'

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

/** The sphere that holds the first-person stand-ins, the scratch every image fills (`firstPersonBoundsOf`). */
const firstPerson = new Float64Array(4)

/** Stages the image's reflection view (`stageReflectionImage`), which the trace and the forward
 *  programs read: `traced`, whether the trace runs this image; unchanged, nothing is sent. */
function writeFrame(
  rt: WebgpuPagesRuntime,
  reflection: ScreenReflection,
  settings: ReflectionSettings,
  traced: boolean,
) {
  const { gpu, run } = rt,
    { frame } = reflection
  frame.size = gpu.targetSize
  frame.depthDrawn = run.depthDrawn
  frame.frameIndex = noiseFrame(rt)
  frame.eye = run.gate.cam.eye
  frame.preExposure = preExposureOf(rt).now
  frame.firstPerson = firstPersonBoundsOf(rt, firstPerson)
  // The view was cut, or the image the lit image was drawn at is not the one before: nothing of it describes this image, the history starts again.
  const { held } = reflection.lit
  const revision = run.gate.temporalRevision
  frame.historyCut =
    revision !== reflection.revision ||
    (held.valid && !cameraSeen(previousCameraOf(rt), reflection.litFrame))
  reflection.revision = revision
  // The depth the last trace kept is the lit image's, where it is the same image.
  frame.depthKept = held.valid && reflection.depthImage === held.image
  frame.jitter = jitterOf(rt)
  // The transparents' front surface, answered where this very image's pass wrote it (`encodeFrontPass`).
  frame.front = traced && reflection.front.reflected === frontStamp(run.frame)
  // The depth bias the hits of rays through the scene's triangles read the cards with, from the scene trace the lighting made for the image.
  frame.cardDepthBias = sceneRaysOf(rt.surfaceCache?.lighting, run.frame)?.depthBias
  frame.settings = settings
  stageReflectionImage(reflection, frame)
  reflection.stagedFrame = run.frame
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
  settings: ReflectionSettings,
  surfaces: NonNullable<WebgpuPagesRuntime['gpu']['surfaces']>,
  light: LightAtlasFormat,
) {
  const { gpu, lights } = rt
  const views = surfaces.views()
  const { inputs } = reflection
  inputs.flags = views[3]
  inputs.normals = views[1]
  inputs.lobes = surfaces.lobesView
  inputs.lights = lights.buffer!
  inputs.fog = rayFogReadOf(gpu, gpu.deferred!.placeholders)
  inputs.field = reflectionField(rt)!
  // The rays marched through the field read the surface cache for their hits, and the main view's write what they
  // would have read finer (`feedbackBuffer.ts`).
  const cache = settings.marchesField ? readableCache(rt) : undefined
  if (settings.marchesField) demandSurfaceCache(rt)
  const writes = rt.views.active === rt.views.main ? cache : undefined
  writes?.feedback.begin(writes.cache, gpu.targetSize, rt.surfaceCache?.lighting?.begunFeedback)
  inputs.hit = surfaceHitReads(rt, reflection.device, undefined, light).hit
  // The vectors are this image's motion since the image before: read only against that image's history.
  const reach = vectorsReach(reflection.lit.held, reflection.frame.image ?? NEVER_SEEN)
  inputs.vectors = (reach && screenProbeVectors(rt)) || reflection.noVectors
  // The blue noise a ray's direction is drawn from: asked of the file here (`blueNoiseNow`), the stand-in bound until it is made.
  blueNoiseNow(reflection.device)
  inputs.blue = noiseViewOn(reflection.device)
  return writes
}

/** What the trace of an image's reflections needs of the view staged for it (`stageReflections`). */
interface StagedReflections {
  reflection: ScreenReflection
  stages: NonNullable<WebgpuPagesRuntime['vis']['reflectionPipelines']>
  depth: NonNullable<ReturnType<NonNullable<WebgpuPagesRuntime['vis']['gpuHiz']>['depth']>>
  lightView: NonNullable<ReturnType<typeof reflectionLightView>>
  surfaces: NonNullable<WebgpuPagesRuntime['gpu']['surfaces']>
  settings: ReflectionSettings
}

/**
 * The image's reflection view, staged before the screen probes, which read it (`stageReflections`), and the image's reflections traced after them
 * (`traceReflections`), before its lighting, as the probes' light is what they read: the view uniform, then one compute pass — both
 * surfaces' rays, traced a pixel each, reused and accumulated (`trace/trace.ts`) into the reflection target the
 * resolve reads and the front radiance the forward fragments read, when the image is lit, its field
 * read from the bounce cascades, its hits from the surface cache. What the lighting's view holds of the image — its
 * inverse view-projection, the eye, the exposure, the display curve, the background — the trace
 * reads there (`gpu.deferred.update`, written before the image is submitted). Every lit image traces
 * and accumulates, still or moving: a still view is how the history fills, a moving one how it
 * follows. A view that shows no lit image (`drawsLit`), or that does not `reflecting`, traces none (the view is still staged:
 * the screen probes and the translucency's light read it), and makes no grid for it.
 * Staged here: the view, whether the image traces or not, and what the trace needs where it does (none else).
 */
export function stageReflections(
  rt: WebgpuPagesRuntime,
  reflecting: boolean,
): StagedReflections | undefined {
  const { gpu, vis, lights, run } = rt,
    reflection = gpu.reflection,
    stages = vis.reflectionPipelines,
    hiz = vis.gpuHiz,
    depth = hiz?.depth(),
    lightView = reflectionLightView(rt)
  // This image traces nothing until its trace says so (`census.copy`).
  reflection?.census.idle()
  if (!reflection || !stages || !lightView) {
    // No reflection, no look: the view goes back to the plain light rather than keep the last one written.
    gpu.deferred?.setReflectionLook(1, 1)
    return undefined
  }
  // The kernels follow the format the surface cache's final light is stored in.
  followReflectionLight(
    vis,
    reflection.device,
    rt.setup.reflectionStatistics,
    surfaceCacheLightOf(rt, reflection.device),
  )
  // What a ray may spend and which stages run, from the session's settings (`settings.ts`): the `'off'` level traces nothing.
  const settings = reflection.settings(rt.context, waterFrontOf(rt))
  // The look of the light a surface reflects, which the lighting's passes read in the view whether this image traces or not.
  gpu.deferred?.setReflectionLook(settings.contrast, settings.specularScale)
  const surfaces = gpu.surfaces,
    deferred = gpu.deferred,
    traced =
      settings.enabled &&
      reflecting &&
      wantsContractLighting(rt) &&
      drawsLit(run.diagnostic) &&
      !!surfaces &&
      !!lights.buffer &&
      !!deferred
  // Every image whose radiance is built is staged, reflecting or not.
  writeFrame(rt, reflection, settings, traced)
  if (!hiz || !depth || !traced) return undefined
  return { reflection, stages, depth, lightView, surfaces, settings }
}

/** The image's reflections traced, over the view it staged (`stageReflections`) and the vectors the screen probes made of this image. */
export function traceReflections(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  staged: StagedReflections | undefined,
) {
  if (!staged) return
  const { reflection, stages, depth, lightView, surfaces, settings } = staged
  const writes = bindTraceInputs(rt, reflection, settings, surfaces, stages.light)
  const group = reflectionGroup(reflection, depth, lightView, skyLightReadOf(rt))
  // Where the scene has acceleration structures the scene stage's rays go through its triangles; else they are marched through the field.
  const hardware = hardwareReflections(rt, reflection, settings, stages.light)
  reflection.inputs.rays = hardware?.rays
  // The rays count this image's alone: the counters emptied before the trace, copied after it.
  reflection.census.clear(encoder)
  // The meshes' fields stage of the opaque rays (`trace/meshes.ts`): none while the trace is off or the scene stage casts through triangles.
  const meshes = reflectionMeshesOf(
    rt,
    reflection.device,
    encoder,
    reflection.meshes,
    stages,
    settings,
    !!hardware,
    reflection.frame.viewProjection,
    reflection.grids.meshRays,
  )
  encodeReflectionTrace(
    encoder,
    reflection,
    stages,
    reflection.inputs,
    group,
    rt.gpu.targetSize,
    [settings.block, settings.blockY],
    settings.frontBlock,
    [settings.reconstruction, settings.frontReconstruction],
    !!reflection.frame.front,
    hardware?.stage,
    meshes,
    radianceCacheStage(rt, reflection, reflection.inputs, settings),
  )
  reflection.depthImage = reflection.frame.image ?? NEVER_SEEN
  reflection.census.copy(encoder, rt.run.frame, !hardware)
  writes?.feedback.end(encoder, writes.cache)
}

/** Whether the reflections have a lit image to keep: an image they staged (`stageReflections` told its
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
  reflection.litFrame = rt.run.frame
  holdLitImage(
    reflection.lit,
    frame.viewProjection,
    frame.size,
    frame.preExposure,
    frame.jitter,
    frame.image,
  )
}
