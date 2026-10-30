import { cullOf, transmitsRank, variantOf, waterRank } from './plan/planCull.ts'
import { modePipelines, type BlendModePipelines } from './stagePipelines.ts'
import type { blendVariantPipeline } from '../diagnostic/gpuVariant.ts'

/**
 * THE BLEND STAGE OF THE SKY MESHES' CAPTURE (`../frame/render/encodeSkyMeshFace.ts`): the blend modes' own fragment stage, drawn with
 * the depth of each pixel written (`modePipelines`' `depthWrite`) in the depth buffer of the face, so that the surfaces cover each other by
 * their distance and the face's depth says how far the mesh seen there is. Its pipelines are described and compiled when a draw first
 * reaches them (`at`, the draw's own waiting rule), never with the program: a scene with no sky material never builds one. A transmissive
 * or water rank is not drawn.
 */
export function createSkyFacePipelines(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  selected: ReturnType<typeof blendVariantPipeline>,
  feedback: boolean,
): BlendModePipelines['skyFace'] {
  const set = modePipelines(device, module, layout, selected, feedback, false, true)
  const skips = (rank: number) => transmitsRank(rank) || waterRank(rank)
  return {
    at: (rank) => (skips(rank) ? undefined : set.at(variantOf(rank), cullOf(rank))),
    skips,
  }
}
