import { REFLECTION_PASS, REFLECTION_RADIANCE_PASS } from '../stage/passLabels.ts'
import { LazyComputePass } from '../gpu/core/lazyComputePass.ts'
import {
  directLightResources,
  wantsContractLighting,
} from '../webgpu/pages/prepare/lightResources.ts'
import { viewProj } from '../webgpu/pages/helpers.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { encodeFrontDepth } from './frontDepth.ts'
import { reflectionGroup, reflectionOver, type ScreenReflection } from './gpu.ts'
import { encodeRadiancePyramid, type RadianceInputs } from './radiance.ts'
import { encodeReflectionTrace, type TraceInputs } from './trace.ts'
import type { ReflectionFrame } from './viewWrite.ts'

/** The reflections' compute pass, opened by the first of its dispatches. */
const reflectionPass = new LazyComputePass(REFLECTION_PASS)

/** What an image tells its reflection view, and what the trace reads: written in place, each image. */
const frame: ReflectionFrame = {
  viewProjection: viewProj,
  size: [0, 0],
  depthDrawn: false,
  proxyError: 0,
}
const inputs = {} as TraceInputs
const radianceInputs = {} as RadianceInputs

/**
/** Stages the image's reflection view (`ScreenReflection.writeView`): what the front depth's carry
 *  (`encodeDepthPyramid`) and the trace (`encodeReflections`) both read; unchanged, nothing is sent. */
function writeFrame(rt: WebgpuPagesRuntime, reflection: ScreenReflection) {
  const { gpu, run, bounce } = rt
  frame.size = gpu.targetSize
  frame.depthDrawn = run.depthDrawn
  frame.proxyError = bounce.probes?.proxy?.errorMetres ?? 0
  // The run-time proxy's answers are of an epoch: it moves with the view, the lights, the poses and the proxy.
  frame.epoch = reflection.history.follow(
    [rt.lights.store.epoch, run.gpuSelection?.proxyRevision() ?? 0],
    // The camera's own view: the jitter moves the render matrix every image, and an epoch that followed it
    // would restart the budget for ever.
    gpu.temporal?.frame.active ? gpu.temporal.frame.cameraViewProjection : frame.viewProjection,
  )
  reflection.writeView(frame, reflection.radiance.held, reflection.radiance.levels)
}

/**
 * The depth pyramid's nearest layer, with the finished depth's farthest, once the visibility drew
 * the whole depth (`GpuHiz.encodeNearest`: the Hi-Z's build, which only the readers of the whole
 * depth read): the last image's transparents' front depth carried to this one's pixels first
 * (`frontDepth.ts`), which the nearest layer folds in, then one compute pass, before every reader
 * of it — the direct lights' contact rays (`vsm/`) and the reflections' trace both walk it with the
 * screen march (`gpu/hiz/screenMarch.ts`).
 */
export function encodeDepthPyramid(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis } = rt,
    reflection = gpu.reflection,
    stages = vis.reflectionPipelines,
    hiz = vis.gpuHiz,
    depth = hiz?.depth()
  if (!hiz) return
  if (reflection && stages && depth && reflectionOver(rt)) {
    writeFrame(rt, reflection)
    encodeFrontDepth(encoder, reflection, stages, depth.front, gpu.targetSize)
  }
  if (!rt.run.depthDrawn) return
  hiz.encodeNearest(reflectionPass.begin(encoder))
  reflectionPass.end()
}

/**
 * The image's reflections, before its lighting: the view uniform, then one compute pass — the frame
 * state and the opaque surfaces' trace into the reflection target the resolve reads, when the image is lit, its field read from the bounce
 * cascades and its proxy from the resident proxy. What the lighting's view holds of the image — its
 * inverse view-projection, the eye, the exposure, the display curve, the background — the trace
 * reads there (`gpu.deferred.update`, written before the image is submitted).
 */
export function encodeReflections(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis, lights, bounce } = rt,
    reflection = gpu.reflection,
    stages = vis.reflectionPipelines,
    hiz = vis.gpuHiz,
    depth = hiz?.depth(),
    over = reflectionOver(rt),
    resident = bounce.probes?.proxy
  if (!reflection || !stages || !hiz || !depth || !over) return
  writeFrame(rt, reflection)
  const surfaces = gpu.surfaces,
    deferred = gpu.deferred,
    traced = wantsContractLighting(rt) && !!surfaces && !!lights.buffer && !!deferred
  const open = reflectionPass.begin(encoder)
  if (traced) {
    const views = surfaces.views()
    // The cascades the resolve reads, else its empty ones: the field a miss reads is the diffuse's.
    const contract = directLightResources(rt)
    inputs.base = views[0]
    inputs.flags = views[3]
    inputs.normals = views[1]
    inputs.lobes = surfaces.lobesView
    inputs.lights = lights.buffer!
    inputs.bounceGrid = contract.bounceGrid ?? deferred.placeholders.bounceGrid
    inputs.probes = contract.probes ?? deferred.placeholders.probes
    inputs.proxy = resident?.buffer ?? deferred.placeholders.proxy
    // What the world cut at run time, which has no cooked proxy, else the empty stand-in.
    rt.run.gpuSelection?.proxyCopies(rt.setup.blendCopies)
    const meshes = rt.run.gpuSelection?.proxyBuffers()
    const empty = deferred.placeholders.runtime
    inputs.runtime = meshes ?? { proxy: empty, nodes: empty, cold: empty, worlds: empty }
    inputs.history = reflection.history.buffer ?? deferred.placeholders.history
    inputs.lightView = over.lightView
    const group = reflectionGroup(reflection, depth, over)
    encodeReflectionTrace(open.pass, reflection, stages, inputs, group, gpu.targetSize)
  }
  reflectionPass.end()
}

/** The radiance pyramid of the image's lit colour, once every surface drew into it and before
 *  the temporal resolve reads it: what the next image's reflections reproject their hits into. Its
 *  hash is copied while the view is unsettled (`RadianceSettle`). */
export function encodeReflectionRadiance(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis } = rt,
    reflection = gpu.reflection,
    stages = vis.reflectionPipelines
  if (!reflection || !stages || !gpu.hdrView || !gpu.deferred) return
  const pass = encoder.beginComputePass({ label: REFLECTION_RADIANCE_PASS })
  radianceInputs.hdr = gpu.hdrView
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
  )
  pass.end()
  reflection.settle.image(
    encoder,
    reflection.tiles.args,
    reflection.history.buffer ?? gpu.deferred.placeholders.history,
  )
}

/** The image is submitted: the hash it copied is mapped (`RadianceSettle.submitted`). */
export const reflectionsSubmitted = ({ gpu }: Pick<WebgpuPagesRuntime, 'gpu'>) =>
  gpu.reflection?.settle.submitted()
