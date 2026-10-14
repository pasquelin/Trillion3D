import { preparedPipeline, type PreparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { FRONT_TARGET_FORMATS } from '../../reflections/frontLayer.ts'
import { stageDescriptors, type FrontStagePipelines } from './stagePipelines.ts'

/** The targets of the front stage, in its outputs' order: the normal and roughness, the surface flags,
 *  then, with `lobes`, the lobes texel (`../../reflections/frontLayer.ts`). */
export const frontStageTargets = (lobes: boolean): GPUColorTargetState[] => [
  { format: FRONT_TARGET_FORMATS.normals },
  { format: FRONT_TARGET_FORMATS.flags },
  ...(lobes ? [{ format: FRONT_TARGET_FORMATS.lobes }] : []),
]

/**
 * The front stage's three culls (`fsFront`, `frontStageWgsl.ts`) of the blend module `module`, on the
 * blend layout, their depth tested and written as the water surface stage's are: the nearest reflecting
 * transparent of a pixel is the one kept. Nothing is described nor compiled before a front pass asks for
 * them (`ask`, `frontPass.ts`): a scene without the proxy's store or without a transparent never does. Their
 * compile runs off the frame, the frames held until it lands; a rank of any blending mode draws its cull's,
 * the stage blending nothing.
 */
export function frontStagePipelines(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUBindGroupLayout,
  lobes: boolean,
): FrontStagePipelines {
  let culls: PreparedPipeline<GPURenderPipeline>[] | undefined
  const made = () =>
    (culls ??= stageDescriptors(
      device,
      module,
      layout,
      { module, entryPoint: 'fsFront', targets: frontStageTargets(lobes) },
      true,
    ).map((descriptor) => preparedPipeline(device, descriptor)))
  return {
    lobes,
    get ready() {
      return !!culls && culls.every((cull) => cull.ready)
    },
    ask() {
      for (const cull of made()) cull.ask()
    },
    at: (rank) => made()[rank % 3].get(),
  }
}
