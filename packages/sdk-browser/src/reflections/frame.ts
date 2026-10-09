import { REFLECTION_PASS, REFLECTION_RADIANCE_PASS } from '../stage/passLabels.ts'
import { LazyComputePass } from '../gpu/core/lazyComputePass.ts'
import {
  directLightResources,
  wantsContractLighting,
} from '../webgpu/pages/prepare/lightResources.ts'
import { viewProj } from '../webgpu/pages/helpers.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { reflectionGroup, reflectionOver } from './gpu.ts'
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
  proxyCell: 0,
  proxyError: 0,
}
const inputs = {} as TraceInputs
const radianceInputs = {} as RadianceInputs

/**
 * The image's reflections, before its lighting: the view uniform, then one compute pass — the depth
 * pyramid's nearest layer, with the finished depth's farthest, once the visibility drew the whole
 * depth (`GpuHiz.encodeNearest`: the Hi-Z's build, which only the readers of the whole depth read,
 * built in their first pass), then the frame state and the opaque surfaces' trace into the
 * reflection target the resolve reads, when the image is lit, its field read from the bounce
 * cascades and its proxy from the resident proxy. What the lighting's view holds of the image — its
 * inverse view-projection, the eye, the exposure, the display curve, the background — the trace
 * reads there (`gpu.deferred.update`, written before the image is submitted).
 */
export function encodeReflections(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis, run, lights, bounce } = rt,
    reflection = gpu.reflection,
    stages = vis.reflectionPipelines,
    hiz = vis.gpuHiz,
    depth = hiz?.depth(),
    over = reflectionOver(rt),
    resident = bounce.probes?.proxy
  if (!reflection || !stages || !hiz || !depth || !over) return
  frame.size = gpu.targetSize
  frame.depthDrawn = run.depthDrawn
  frame.proxyCell = resident?.cellMetres ?? 0
  frame.proxyError = resident?.errorMetres ?? 0
  reflection.writeView(frame, reflection.radiance.held, reflection.radiance.levels)
  const surfaces = gpu.surfaces,
    deferred = gpu.deferred,
    traced = wantsContractLighting(rt) && !!surfaces && !!lights.buffer && !!deferred
  const open = reflectionPass.begin(encoder)
  if (run.depthDrawn) hiz.encodeNearest(open)
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
  reflection.settle.drawn()
  if (!reflection.settle.verified) reflection.settle.copy(encoder)
}

/** The image is submitted: the hash it copied is mapped (`RadianceSettle.submitted`). */
export const reflectionsSubmitted = ({ gpu }: Pick<WebgpuPagesRuntime, 'gpu'>) =>
  gpu.reflection?.settle.submitted()
