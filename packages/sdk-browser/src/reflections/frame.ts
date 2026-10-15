import {
  directLightResources,
  wantsContractLighting,
} from '../webgpu/pages/prepare/contractLight.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import { frontStamp } from './frontLayer.ts'
import type { ScreenReflection } from './gpu.ts'
import { reflectionGroup, reflectionLightView, reflectionProxy } from './group.ts'
import { encodeImageRadiance, stageReflectionImage } from './image.ts'
import { encodeReflectionTrace } from './traceEncode.ts'
import {
  environmentCurve,
  environmentExposure,
} from '../../../sdk-core/src/scene/core/environment.ts'

/** Stages the image's reflection view (`stageReflectionImage`), which the trace and the forward
 *  programs read: `traced`, whether the trace runs this image; `pose`, the camera's view-projection,
 *  the jitter aside; unchanged, nothing is sent. */
function writeFrame(
  rt: WebgpuPagesRuntime,
  reflection: ScreenReflection,
  traced: boolean,
  pose: ArrayLike<number>,
) {
  const { gpu, run } = rt,
    { frame } = reflection
  frame.size = gpu.targetSize
  frame.pose = pose
  frame.depthDrawn = run.depthDrawn
  const { environment } = rt.lights.store
  frame.surroundings = reflection.surroundings(
    run.clearColor,
    environmentExposure(environment),
    environmentCurve(environment),
  )
  // The transparents' front surface, answered where this very image's pass wrote it (`encodeFrontPass`).
  frame.front = traced && reflection.front.reflected === frontStamp(run.frame)
  stageReflectionImage(reflection, frame, rt.lights.store.epoch)
}

/**
 * The depth pyramid's nearest layer, with the finished depth's farthest, once the visibility drew
 * the whole depth (`GpuHiz.encodeNearest`: the Hi-Z's build, which only the readers of the whole
 * depth read): one compute pass, after this image's front pass wrote the transparents' covering depth
 * into level 0's front layer (`frontLayer.ts`), which the build folds in where the pass drew this image
 * — its frame word up —, and before every reader of it — the direct lights' contact rays (`vsm/`) and
 * the reflections' trace both walk it with the screen march (`gpu/hiz/screenMarch.ts`).
 */
export function encodeDepthPyramid(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis, run } = rt,
    hiz = vis.gpuHiz,
    reflection = gpu.reflection
  if (!hiz) return
  // An image whose front pass drew none, a scene that lost its last transparent: the word down, so no
  // reader folds the last glass.
  hiz.front(reflection?.front.drawn === frontStamp(run.frame))
  // The pass is the view's reflection's, made with the surfaces every lit image draws.
  if (!run.depthDrawn || !reflection) return
  hiz.encodeNearest(reflection.depthPass.begin(encoder))
  reflection.depthPass.end()
}

/**
 * The image's reflections, before its lighting: the view uniform, then one compute pass — both
 * surfaces' rays, traced a pixel each, reused and accumulated (`trace.ts`) into the reflection target the
 * resolve reads and the front radiance the forward fragments read, when the image is lit, its field
 * read from the bounce cascades and its proxy from the scene's proxy. What the lighting's view holds of the image — its
 * inverse view-projection, the eye, the exposure, the display curve, the background — the trace
 * reads there (`gpu.deferred.update`, written before the image is submitted); where the camera `cam`
 * stands, the jitter aside, decides whether the image is drawn for a change.
 */
export function encodeReflections(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
) {
  const { gpu, vis, lights } = rt,
    reflection = gpu.reflection,
    stages = vis.reflectionPipelines,
    hiz = vis.gpuHiz,
    depth = hiz?.depth(),
    lightView = reflectionLightView(rt)
  if (!reflection || !stages || !lightView) return
  const surfaces = gpu.surfaces,
    deferred = gpu.deferred,
    traced = wantsContractLighting(rt) && !!surfaces && !!lights.buffer && !!deferred
  // Every image whose radiance is built is staged, its move decided: the build reads that decision.
  writeFrame(rt, reflection, traced, cam.viewProjection)
  if (!hiz || !depth) return
  // A frozen view is drawn from what no longer moves — its pose, its lights, its content, its history,
  // its pyramid —: the targets the last image wrote are this one's, and nothing is traced. A jitter of
  // the temporal accumulation is no move (`stageReflectionImage`): the reflections hold the phase they
  // froze on, as the history does.
  if (reflection.settle.frozen) return
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
    const group = reflectionGroup(reflection, depth, lightView)
    encodeReflectionTrace(
      encoder,
      reflection,
      stages,
      inputs,
      group,
      gpu.targetSize,
      !!reflection.frame.front,
    )
  }
}

/** The radiance pyramid of the image's lit colour, once every surface drew into it and before
 *  the temporal resolve reads it: what the next image's reflections reproject their hits into, the
 *  lit image itself its level 0 once the image is encoded (`adoptRadianceImage`). Its hash is
 *  copied while the view is unsettled (`RadianceSettle`). */
export function encodeReflectionRadiance(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis } = rt,
    reflection = gpu.reflection,
    stages = vis.reflectionPipelines
  if (!reflection || !stages || !gpu.hdrTexture || !gpu.deferred) return
  const { radianceInputs } = reflection
  radianceInputs.texture = gpu.hdrTexture
  radianceInputs.view = gpu.deferred.uniform
  radianceInputs.hash = reflection.settle.hash
  encodeImageRadiance(encoder, reflection, stages, radianceInputs, reflection.frame)
}

/** The image is submitted: the hash it copied is mapped (`RadianceSettle.submitted`). */
export const reflectionsSubmitted = ({ gpu }: Pick<WebgpuPagesRuntime, 'gpu'>) =>
  gpu.reflection?.settle.submitted()
