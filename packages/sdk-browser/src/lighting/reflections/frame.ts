import { skyLightReadOf } from '../../frame/render/encodeSkyLight.ts'
import { directLightResources, wantsContractLighting } from '../../frame/prepare/contractLight.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { frontStamp } from './frontLayer.ts'
import type { ScreenReflection } from './gpu.ts'
import { reflectionGroup, reflectionLightView, reflectionProxy } from './group.ts'
import { encodeImageRadiance, stageReflectionImage } from './image.ts'
import { encodeReflectionTrace } from './trace/traceEncode.ts'
import { drawsLit } from '../../visibility/shader/shadeMode.ts'
import { environmentCurve } from '../../../../sdk-core/src/scene/core/environment.ts'
import { appliedExposureOf } from '../../post/exposure/applied.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { hizSetting } from '../../visibility/hiz/setting.ts'

/** Stages the image's reflection view (`stageReflectionImage`), which the trace and the forward
 *  programs read: `traced`, whether the trace runs this image; unchanged, nothing is sent. */
function writeFrame(rt: WebgpuPagesRuntime, reflection: ScreenReflection, traced: boolean) {
  const { gpu, run } = rt,
    { frame } = reflection
  frame.size = gpu.targetSize
  frame.depthDrawn = run.depthDrawn
  frame.eye = run.gate.cam.eye
  frame.preExposure = preExposureOf(rt).now
  const { environment } = rt.lights.store
  frame.surroundings = reflection.surroundings(
    run.clearColor,
    appliedExposureOf(rt),
    environmentCurve(environment),
  )
  // The transparents' front surface, answered where this very image's pass wrote it (`encodeFrontPass`).
  frame.front = traced && reflection.front.reflected === frontStamp(run.frame)
  // What a ray may spend and which stages run, from the session's settings (`settings.ts`).
  const settings = (frame.settings = reflection.settings(rt.context))
  reflection.census.budget(settings.ringWork, settings.ringTests)
  stageReflectionImage(reflection, frame)
  return settings
}

/**
 * The depth pyramid's nearest layer, with the finished depth's farthest, once the visibility drew
 * the whole depth (`GpuHiz.encodeNearest`: the Hi-Z's build, which only the readers of the whole
 * depth read): one compute pass, after this image's front pass wrote the transparents' covering depth
 * into level 0's front layer (`frontLayer.ts`), which the build folds in where the pass drew this image
 * — its frame word up —, and before every reader of it — the direct lights' contact rays (`lighting/shadows/vsm/`) and
 * the reflections' trace both walk it with the screen march (`visibility/hiz/gpu/screenMarch.ts`).
 * The settings decide what it holds: `hizTrace` — the planes' corners and the finished depth's
 * farthest, or the closest depth of each texel's centre — and `hizFoldTransparents` — the
 * transparent surfaces folded into the trace layers, or the opaque depth alone (`hizOptions.ts`).
 */
export function encodeDepthPyramid(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis, run } = rt,
    hiz = vis.gpuHiz,
    reflection = gpu.reflection
  if (!hiz) return
  // An image whose front pass drew none, a scene that lost its last transparent: the word down, so no
  // reader folds the last glass; and down while the setting leaves the transparents out.
  hiz.front(
    hizSetting(rt, 'hizFoldTransparents') && reflection?.front.drawn === frontStamp(run.frame),
  )
  hiz.planes(hizSetting(rt, 'hizTrace') === 'planes')
  // The pass is the view's reflection's, made with the surfaces every lit image draws.
  if (!run.depthDrawn || !reflection) return
  hiz.encodeNearest(reflection.depthPass.begin(encoder))
  reflection.depthPass.end()
}

/** The depth pyramid's resources where this image built its finished-depth layers from the opaque
 *  depth alone — after the raster's rest pass, by `encodeDepthPyramid`; the fog's furthest depth is
 *  read from them —, none where the image drew no depth or its transparents' front is folded into
 *  them: a cell behind a pane is not hidden. */
export function opaquePyramidOf(rt: WebgpuPagesRuntime) {
  const { gpu, vis, run } = rt,
    reflection = gpu.reflection
  if (!run.depthDrawn || !reflection || reflection.front.drawn === frontStamp(run.frame)) return
  return vis.gpuHiz?.depth()
}

/**
 * The image's reflections, before its lighting: the view uniform, then one compute pass — both
 * surfaces' rays, traced a pixel each, reused and accumulated (`trace/trace.ts`) into the reflection target the
 * resolve reads and the front radiance the forward fragments read, when the image is lit, its field
 * read from the bounce cascades and its proxy from the scene's proxy. What the lighting's view holds of the image — its
 * inverse view-projection, the eye, the exposure, the display curve, the background — the trace
 * reads there (`gpu.deferred.update`, written before the image is submitted). Every lit image traces
 * and accumulates, still or moving: a still view is how the history fills, a moving one how it
 * follows. A view that shows no lit image (`drawsLit`) traces none, and makes no grid for it.
 */
export function encodeReflections(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
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
      wantsContractLighting(rt) &&
      drawsLit(run.diagnostic) &&
      !!surfaces &&
      !!lights.buffer &&
      !!deferred
  // Every image whose radiance is built is staged.
  const settings = writeFrame(rt, reflection, traced)
  if (!hiz || !depth) return
  if (traced) {
    const views = surfaces.views()
    // The cascades the resolve reads, else its empty ones: the field a miss reads is the diffuse's.
    const contract = directLightResources(rt),
      { inputs } = reflection
    inputs.base = views[0]
    inputs.flags = views[3]
    inputs.normals = views[1]
    inputs.lobes = surfaces.lobesView
    inputs.lights = lights.buffer!
    inputs.lightLists = lights.tiles?.buffer ?? deferred.placeholders.tiles
    inputs.bounceGrid = contract.bounceGrid ?? deferred.placeholders.bounceGrid
    inputs.probes = contract.probes ?? deferred.placeholders.probes
    inputs.proxy = reflectionProxy(rt)!
    const group = reflectionGroup(reflection, depth, lightView, skyLightReadOf(rt))
    // The rays count this image's alone: the counters emptied before the trace, copied after it.
    reflection.census.clear(encoder)
    encodeReflectionTrace(
      encoder,
      reflection,
      stages,
      inputs,
      group,
      gpu.targetSize,
      settings.block,
      !!reflection.frame.front,
    )
    reflection.census.copy(encoder, run.frame)
  }
}

/** The radiance pyramid of the image's lit colour, once every surface drew into it and before
 *  the temporal resolve reads it: what the next image's reflections reproject their hits into, the
 *  lit image itself its level 0 once the image is encoded (`adoptRadianceImage`). */
export function encodeReflectionRadiance(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis } = rt,
    reflection = gpu.reflection,
    stages = vis.reflectionPipelines
  if (!reflection || !stages || !gpu.hdrTexture || !gpu.deferred) return
  const { radianceInputs } = reflection
  radianceInputs.texture = gpu.hdrTexture
  radianceInputs.view = gpu.deferred.uniform
  encodeImageRadiance(encoder, reflection, stages, radianceInputs, reflection.frame)
}
