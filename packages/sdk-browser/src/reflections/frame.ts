import {
  REFLECTION_PASS,
  REFLECTION_RADIANCE_PASS,
  REFLECTION_TRACE_PASS,
} from '../stage/passLabels.ts'
import { LazyComputePass } from '../gpu/core/lazyComputePass.ts'
import {
  directLightResources,
  wantsContractLighting,
} from '../webgpu/pages/prepare/contractLight.ts'
import { viewProj } from '../webgpu/pages/helpers.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { frontStamp } from './frontLayer.ts'
import { reflectionGroup, reflectionLightView, type ScreenReflection } from './gpu.ts'
import { encodeRadiancePyramid, type RadianceInputs } from './radianceBuild.ts'
import { encodeReflectionTrace, type TraceInputs } from './traceEncode.ts'
import type { ReflectionFrame } from './viewWrite.ts'
import { createSurroundings } from '../lighting/toneUnmap.ts'
import {
  environmentCurve,
  environmentExposure,
} from '../../../sdk-core/src/scene/core/environment.ts'

/** The depth pyramid's nearest layer's compute pass, and the trace's, each opened by its first
 *  dispatch: the trace is timed alone, the proxy budget's measure (`reflectionTraceGpuMs`). */
const reflectionPass = new LazyComputePass(REFLECTION_PASS)
const tracePass = new LazyComputePass(REFLECTION_TRACE_PASS)

/** What an image tells its reflection view, and what the trace reads: written in place, each image. */
const frame: ReflectionFrame = {
  viewProjection: viewProj,
  size: [0, 0],
  depthDrawn: false,
  proxyError: 0,
}
/** The radiance a ray that leaves the scene reaches, computed again when the background, the
 *  exposure or the curve moves. */
const surroundings = createSurroundings()
const inputs = {} as TraceInputs
const radianceInputs = {} as RadianceInputs

/** Stages the image's reflection view (`ScreenReflection.writeView`), which the trace and the forward
 *  programs read: `traced`, whether the trace runs this image; unchanged, nothing is sent. */
function writeFrame(rt: WebgpuPagesRuntime, reflection: ScreenReflection, traced: boolean) {
  const { gpu, run, bounce } = rt
  frame.size = gpu.targetSize
  frame.depthDrawn = run.depthDrawn
  frame.proxyError = bounce.proxy?.errorMetres ?? 0
  const { environment } = rt.lights.store
  frame.surroundings = surroundings(
    run.clearColor,
    environmentExposure(environment),
    environmentCurve(environment),
  )
  // The run-time proxy's answers are of an epoch: it moves with the view, the lights, the poses and the proxy;
  // its store is read where the camera last wrote it.
  frame.runtime = reflection.store.follow(
    rt.lights.store.epoch,
    run.gpuSelection?.proxy()?.writes ?? 0,
    run.gpuSelection?.worldRevision ?? 0,
    // The camera's own view: the jitter moves the render matrix every image, and an epoch that followed it
    // would restart the budget for ever.
    gpu.temporal?.frame.active ? gpu.temporal.frame.cameraViewProjection : frame.viewProjection,
    frame.size,
  )
  // The transparents' front surface, answered where this very image's pass wrote it (`encodeFrontPass`).
  frame.front = traced && reflection.front.reflected === frontStamp(run.frame)
  reflection.writeView(frame, reflection.radiance.held, reflection.radiance.levels)
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
 * The image's reflections, before its lighting: the view uniform, then one compute pass — the frame
 * state and the opaque surfaces' trace into the reflection target the resolve reads, when the image is lit, its field read from the bounce
 * cascades and its proxy from the scene's proxy. What the lighting's view holds of the image — its
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
  if (!reflection || !stages || !hiz || !depth || !lightView) return
  const surfaces = gpu.surfaces,
    deferred = gpu.deferred,
    traced = wantsContractLighting(rt) && !!surfaces && !!lights.buffer && !!deferred
  writeFrame(rt, reflection, traced)
  const open = tracePass.begin(encoder)
  if (traced) {
    const views = surfaces.views()
    // The cascades the resolve reads, else its empty ones: the field a miss reads is the diffuse's.
    const contract = directLightResources(rt)
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
    inputs.store = reflection.store.view ?? deferred.placeholders.runtimeStore
    const group = reflectionGroup(reflection, depth, lightView)
    encodeReflectionTrace(open.pass, reflection, stages, inputs, group, gpu.targetSize)
    reflection.store.traced()
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
  const pass = encoder.beginComputePass({ label: REFLECTION_RADIANCE_PASS })
  radianceInputs.texture = gpu.hdrTexture
  radianceInputs.view = gpu.deferred.uniform
  radianceInputs.hash = reflection.settle.hash
  encodeRadiancePyramid(
    pass,
    reflection.device,
    reflection.radiance,
    stages,
    radianceInputs,
    gpu.targetSize,
    viewProj,
    // A settled view samples no hash: its image is not hashed.
    reflection.settle.verified,
  )
  pass.end()
  reflection.store.built()
  reflection.settle.image(
    encoder,
    reflection.tiles.args,
    reflection.tiles.list,
    reflection.radiance.hashed,
  )
}

/** The image is submitted: the hash it copied is mapped (`RadianceSettle.submitted`). */
export const reflectionsSubmitted = ({ gpu }: Pick<WebgpuPagesRuntime, 'gpu'>) =>
  gpu.reflection?.settle.submitted()
