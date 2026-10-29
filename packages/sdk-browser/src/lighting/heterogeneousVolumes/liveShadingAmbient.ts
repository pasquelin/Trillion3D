import type { HeterogeneousVolumeField } from '../../../../sdk-core/src/contracts/heterogeneousVolumeOptions.ts'
import { heldLightingCache } from './liveShadingGpu.ts'
import { dropHeld, type State } from './liveShadingState.ts'

type Settings = (field: HeterogeneousVolumeField) => number

/** Whether the volumes' indirect light is darkened by an occlusion: the setting, and an indirect light to darken
 *  (`HeterogeneousVolumesAmbientOcclusionPipeline.cpp:748`, `EnableAmbientOcclusion() && UseIndirectLighting()`). */
const ambientOcclusionOn = (settings: Settings, indirectMode: number) =>
  !!settings('heterogeneousVolumesAmbientOcclusion') && indirectMode !== 0

/** The voxels of the occlusion of a volume of `resolution` voxels: the resolution over the downsample factor (at least 1/8), held to
 *  1024 by 1024 by 512 (`GetAmbientOcclusionResolution`, `HeterogeneousVolumesAmbientOcclusionPipeline.cpp:94-106`), the factor made coarser by
 *  the level of detail's. */
function ambientOcclusionResolution(
  resolution: readonly number[],
  factor: number,
  lodFactor: number,
): [number, number, number] {
  const by = Math.max(factor * lodFactor, 0.125)
  return [
    Math.min(Math.max(Math.trunc(resolution[0] / by), 1), 1024),
    Math.min(Math.max(Math.trunc(resolution[1] / by), 1), 1024),
    Math.min(Math.max(Math.trunc(resolution[2] / by), 1), 512),
  ]
}

/**
 * The occlusion texture of a volume, computed by a dispatch of `pipeline` before the passes read it: none (the volume reads one) where
 * the occlusion is off or the volume is a holdout (`HeterogeneousVolumeInterface->IsHoldout()`, `:757`). `groupOf` makes the bind
 * group that writes `texture`, the view's words being the rays along each side, the farthest ray's bits and the most steps.
 */
export function ambientOcclusionOf(c: {
  held: State
  device: GPUDevice
  encoder: GPUCommandEncoder
  pipeline: GPUComputePipeline | undefined
  resolution: readonly number[]
  lodFactor: number
  id: string
  holdout: boolean
  settings: Settings
  indirectMode: number
  /** The existence mask of the occlusion's grid of that size (`existenceMaskOf`), none where it is not used or not ready. */
  existenceOf(size: readonly [number, number, number]): GPUTexture | undefined
  groupOf(words: ArrayLike<number>, texture: GPUTexture, mask: GPUTexture | undefined): GPUBindGroup
}) {
  const { held, device, settings } = c
  if (!c.pipeline || c.holdout || !ambientOcclusionOn(settings, c.indirectMode)) {
    // The occlusion is off for this volume: its texture goes with it.
    dropHeld(held, (key) => key.startsWith(`ao:${c.id}:`))
    return undefined
  }
  const size = ambientOcclusionResolution(
    c.resolution,
    settings('heterogeneousVolumesAmbientOcclusionDownsampleFactor'),
    c.lodFactor,
  )
  const texture = heldLightingCache(held.caches, device, `ao:${c.id}:`, size, `${c.id} occlusion`)
  // The farthest ray is held to the shadow rays' and the most steps to the march's (`:76`, `:81`).
  const distance = new Uint32Array(
    new Float32Array([
      Math.min(
        settings('heterogeneousVolumesAmbientOcclusionMaxTraceDistance'),
        settings('heterogeneousVolumesMaxShadowTraceDistance'),
      ),
    ]).buffer,
  )[0]
  const words = [
    settings('heterogeneousVolumesAmbientOcclusionRayCountX'),
    settings('heterogeneousVolumesAmbientOcclusionRayCountY'),
    distance,
    Math.min(
      settings('heterogeneousVolumesAmbientOcclusionMaxStepCount'),
      settings('heterogeneousVolumesMaxStepCount'),
    ),
    0,
    0,
    0,
    0,
  ]
  const mask = c.existenceOf(size)
  const pass = c.encoder.beginComputePass({ label: 'Trillion3D heterogeneous volume occlusion' })
  pass.setPipeline(c.pipeline)
  pass.setBindGroup(0, c.groupOf(words, texture, mask))
  pass.dispatchWorkgroups(Math.ceil(size[0] / 4), Math.ceil(size[1] / 4), Math.ceil(size[2] / 4))
  pass.end()
  return texture
}
