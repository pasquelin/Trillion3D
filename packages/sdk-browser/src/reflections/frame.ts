import { REFLECTION_PASS, REFLECTION_RADIANCE_PASS } from '../stage/passLabels.ts'
import { wantsContractLighting } from '../webgpu/pages/prepare/lightResources.ts'
import { viewProj } from '../webgpu/pages/helpers.ts'
import { clearValueOf } from '../../../sdk-core/src/world/math/packedColour.ts'
import { srgbToLinear } from '../../../math/src/color/color.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import {
  encodeRadiancePyramid,
  encodeReflectionDepth,
  encodeReflectionTrace,
  reflectionGroup,
  writeReflectionView,
} from './gpu.ts'

/** The half byte below white the background's display value is held under: the display shows
 *  1 only at an infinite radiance, and no byte tells the two apart. */
const WHITE = 254.5 / 255

/**
 * The image's reflections, before its lighting: the view uniform, then one compute pass — the
 * depth the reflections march, from the Hi-Z's level 0 once the visibility drew the depth, then
 * the surroundings and the opaque surfaces' trace into the reflection target the resolve reads,
 * when the image is lit. `inverseViewProjection` and `camera` are the lighting's own, `direct` the
 * parameters its resolve reads (`encodeDirectLights`: the exposure and the display curve's rank).
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
    pipelines = vis.reflectionPipelines,
    hiz = vis.gpuHiz
  if (!reflection || !pipelines || !hiz) return
  writeReflectionView(reflection, {
    viewProjection: viewProj,
    inverseViewProjection,
    camera,
    size: gpu.targetSize,
    depthDrawn: run.depthDrawn,
    display: {
      background: displayedBackground(run.clearColor),
      exposure: direct[3],
      curve: direct[4],
    },
  })
  const surfaces = gpu.surfaces,
    traced = wantsContractLighting(rt) && !!surfaces && !!lights.buffer
  if (!run.depthDrawn && !traced) return
  const pass = encoder.beginComputePass({ label: REFLECTION_PASS })
  if (run.depthDrawn) encodeReflectionDepth(pass, reflection, pipelines, hiz)
  if (traced) {
    const views = surfaces.views()
    const inputs = {
      flags: views[3],
      normals: views[1],
      lobes: surfaces.lobesView,
      surfaces,
      lights: lights.buffer!,
    }
    const group = reflectionGroup(reflection, hiz)
    encodeReflectionTrace(pass, reflection, pipelines, inputs, group, gpu.targetSize)
  }
  pass.end()
}

/** The background `0xrrggbb` as the display shows it, in linear, held below white (`WHITE`). */
const displayedBackground = (clearColor: number) => {
  const { r, g, b } = clearValueOf(clearColor)
  return [r, g, b].map((c) => srgbToLinear(Math.min(c, WHITE))) as [number, number, number]
}

/** The radiance pyramid of the image's lit colour, once every surface drew into it and before
 *  the temporal resolve reads it: what the next image's reflections reproject their hits into. */
export function encodeReflectionRadiance(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { gpu, vis } = rt,
    reflection = gpu.reflection,
    pipelines = vis.reflectionPipelines
  if (!reflection || !pipelines || !gpu.hdrView) return
  const pass = encoder.beginComputePass({ label: REFLECTION_RADIANCE_PASS })
  encodeRadiancePyramid(pass, reflection, pipelines, gpu.hdrView, gpu.targetSize, viewProj)
  pass.end()
}
