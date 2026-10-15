import { REFLECTION_PASS, REFLECTION_TRACE_PASS } from '../stage/passLabels.ts'
import { LazyComputePass } from '../gpu/core/lazyComputePass.ts'
import {
  directLightResources,
  wantsContractLighting,
} from '../webgpu/pages/prepare/contractLight.ts'
import { viewProj } from '../webgpu/pages/helpers.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { frontStamp } from './frontLayer.ts'
import { reflectionGroup, reflectionLightView, type ScreenReflection } from './gpu.ts'
import { encodeImageRadiance, stageReflectionImage } from './image.ts'
import { encodeReflectionTrace } from './halfEncode.ts'
import type { ReflectionFrame } from './viewWrite.ts'
import { createSurroundings } from '../lighting/toneUnmap.ts'
import {
  environmentCurve,
  environmentExposure,
} from '../../../sdk-core/src/scene/core/environment.ts'

/** The depth pyramid's nearest layer's compute pass, and the trace's, each opened by its first
 *  dispatch: the trace and its upsample are timed alone (`reflectionTraceGpuMs`). */
const reflectionPass = new LazyComputePass(REFLECTION_PASS)
const tracePass = new LazyComputePass(REFLECTION_TRACE_PASS)

/** What an image tells its reflection view, and what the trace reads: written in place, each image. */
const frame: ReflectionFrame = {
  viewProjection: viewProj,
  size: [0, 0],
  depthDrawn: false,
}
/** The radiance a ray that leaves the scene reaches, computed again when the background, the
 *  exposure or the curve moves. */
const surroundings = createSurroundings()

/** Stages the image's reflection view (`stageReflectionImage`), which the trace and the forward
 *  programs read: `traced`, whether the trace runs this image; unchanged, nothing is sent. */
function writeFrame(rt: WebgpuPagesRuntime, reflection: ScreenReflection, traced: boolean) {
  const { gpu, run } = rt
  frame.size = gpu.targetSize
  frame.depthDrawn = run.depthDrawn
  const { environment } = rt.lights.store
  frame.surroundings = surroundings(
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
    hiz = vis.gpuHiz
  if (!hiz) return
  // An image whose front pass drew none, a scene that lost its last transparent: the word down, so no
  // reader folds the last glass.
  hiz.front(encoder, gpu.reflection?.front.drawn === frontStamp(run.frame))
  if (!run.depthDrawn) return
  hiz.encodeNearest(reflectionPass.begin(encoder))
  reflectionPass.end()
}

/**
 * The image's reflections, before its lighting: the view uniform, then one compute pass — the trace
 * of both surfaces' half grids and their upsample (`traceHalf.ts`) into the reflection target the
 * resolve reads and the front radiance the forward fragments read, when the image is lit, its field
 * read from the bounce cascades and its proxy from the scene's proxy. What the lighting's view holds of the image — its
 * inverse view-projection, the eye, the exposure, the display curve, the background — the trace
 * reads there (`gpu.deferred.update`, written before the image is submitted).
 */
export function encodeReflections(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
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
  writeFrame(rt, reflection, traced)
  if (!hiz || !depth) return
  const open = tracePass.begin(encoder)
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
    // What a ray can meet of the scene, its blended copies taken before the cut (`dispatchCut`),
    // else the empty stand-in.
    const proxy = rt.run.gpuSelection?.proxy()
    inputs.proxy = proxy?.buffer ?? deferred.placeholders.runtime
    inputs.proxyWorlds = proxy?.worlds ?? deferred.placeholders.runtimeWorlds
    inputs.proxyTree = proxy?.tree ?? deferred.placeholders.runtimeTree
    const group = reflectionGroup(reflection, depth, lightView)
    encodeReflectionTrace(
      open.pass,
      reflection,
      stages,
      inputs,
      group,
      gpu.targetSize,
      !!frame.front,
    )
  }
  tracePass.end()
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
  encodeImageRadiance(encoder, reflection, stages, radianceInputs, frame)
}

/** The image is submitted: the hash it copied is mapped (`RadianceSettle.submitted`). */
export const reflectionsSubmitted = ({ gpu }: Pick<WebgpuPagesRuntime, 'gpu'>) =>
  gpu.reflection?.settle.submitted()
