import { REFLECTION_PASS, REFLECTION_RADIANCE_PASS } from '../stage/passLabels.ts'
import { LazyComputePass } from '../gpu/core/lazyComputePass.ts'
import {
  directLightResources,
  wantsContractLighting,
} from '../webgpu/pages/prepare/lightResources.ts'
import { viewProj } from '../webgpu/pages/helpers.ts'
import { clearValueOf } from '../../../sdk-core/src/world/math/packedColour.ts'
import { srgbToLinear } from '../../../math/src/color/color.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { reflectionGroup } from './gpu.ts'
import { encodeRadiancePyramid } from './radiance.ts'
import { encodeReflectionTrace, type TraceInputs } from './trace.ts'
import type { ReflectionFrame } from './viewWrite.ts'

/** The reflections' compute pass, opened by the first of its dispatches. */
const reflectionPass = new LazyComputePass(REFLECTION_PASS)

/** The half byte below white the background's display value is held under: the display shows
 *  1 only at an infinite radiance, and no byte tells the two apart. */
const WHITE = 254.5 / 255

/** What an image tells its reflection view, and what the trace reads: written in place, each image. */
const frame: ReflectionFrame = {
  viewProjection: viewProj,
  inverseViewProjection: viewProj,
  camera: viewProj,
  size: [0, 0],
  depthDrawn: false,
  background: [0, 0, 0],
  exposure: 1,
  curve: 0,
}
const inputs = {} as TraceInputs
const radianceInputs = {} as { hdr: GPUTextureView; uniform: GPUBuffer }

/**
 * The image's reflections, before its lighting: the view uniform, then one compute pass — the depth
 * pyramid's nearest layer once the visibility drew the whole depth (`GpuHiz.encodeNearest`: the
 * Hi-Z's build, which only the readers of the whole depth read, built in their first pass), then
 * the frame state and the opaque surfaces' trace into the reflection target the resolve reads,
 * when the image is lit, its field read from the bounce cascades the resolve reads.
 * `inverseViewProjection` and `camera` are the lighting's own, `direct` the parameters its resolve
 * reads (`encodeDirectLights`: the exposure and the display curve's rank).
 */
export function encodeReflections(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  inverseViewProjection: ArrayLike<number>,
  camera: ArrayLike<number>,
  direct: ArrayLike<number>,
) {
  const { gpu, vis, run, lights } = rt,
    reflection = gpu.reflection,
    stages = vis.reflectionPipelines,
    hiz = vis.gpuHiz,
    depth = hiz?.depth()
  if (!reflection || !stages || !hiz || !depth) return
  frame.inverseViewProjection = inverseViewProjection
  frame.camera = camera
  frame.size = gpu.targetSize
  frame.depthDrawn = run.depthDrawn
  displayedBackground(run.clearColor, frame.background as number[])
  frame.exposure = direct[3]
  frame.curve = direct[4]
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
    inputs.flags = views[3]
    inputs.normals = views[1]
    inputs.lobes = surfaces.lobesView
    inputs.lights = lights.buffer!
    inputs.bounceGrid = contract.bounceGrid ?? deferred.placeholders.bounceGrid
    inputs.probes = contract.probes ?? deferred.placeholders.probes
    const group = reflectionGroup(reflection, depth)
    encodeReflectionTrace(open.pass, reflection, stages, inputs, group, gpu.targetSize)
  }
  reflectionPass.end()
}

/** The background `0xrrggbb` as the display shows it, in linear, held below white (`WHITE`),
 *  written into `out`. */
function displayedBackground(clearColor: number, out: number[]) {
  const { r, g, b } = clearValueOf(clearColor)
  out[0] = srgbToLinear(Math.min(r, WHITE))
  out[1] = srgbToLinear(Math.min(g, WHITE))
  out[2] = srgbToLinear(Math.min(b, WHITE))
}

/** The radiance pyramid of the image's lit colour, once every surface drew into it and before
 *  the temporal resolve reads it: what the next image's reflections reproject their hits into. */
export function encodeReflectionRadiance(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis } = rt,
    reflection = gpu.reflection,
    stages = vis.reflectionPipelines
  if (!reflection || !stages || !gpu.hdrView) return
  const pass = encoder.beginComputePass({ label: REFLECTION_RADIANCE_PASS })
  radianceInputs.hdr = gpu.hdrView
  radianceInputs.uniform = reflection.uniform
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
}
