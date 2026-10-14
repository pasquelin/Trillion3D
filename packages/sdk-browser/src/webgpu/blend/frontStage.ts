import { preparedPipeline, type PreparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { FRONT_TARGET_FORMATS, type FrontOutputs } from '../../reflections/frontLayer.ts'
import { stageDescriptors, type FrontStagePipelines } from './stagePipelines.ts'
import { blendFrontShader, blendReflects } from './frontStageWgsl.ts'
import { hasPhysicalLobes } from '../../scene/physicalLobes.ts'
import type { PageSurface } from '../../page/surface.ts'

/** The targets of the front stage of `outputs`, in its outputs' order: the Hi-Z front layer, the surface
 *  flags, then the normal and roughness, then the lobes texel (`../../reflections/frontLayer.ts`). */
export const frontStageTargets = (outputs: FrontOutputs): GPUColorTargetState[] => [
  { format: FRONT_TARGET_FORMATS.front },
  { format: FRONT_TARGET_FORMATS.flags },
  ...(outputs > 0 ? [{ format: FRONT_TARGET_FORMATS.normals }] : []),
  ...(outputs > 1 ? [{ format: FRONT_TARGET_FORMATS.lobes }] : []),
]

/** What a front pass writes (`FrontOutputs`) for transparents of which one `reflects`, one carrying a
 *  lobe where `lobed`: the frame's (`frontPass.ts`) and prepare's (`pipelines.ts`) one rule. */
export const frontOutputsOf = (reflects: boolean, lobed: boolean): FrontOutputs =>
  !reflects ? 0 : lobed ? 2 : 1

/** What a front pass of `items` writes, as prepare sees them. */
export const frontStageOf = (items: readonly { surface: PageSurface }[]) =>
  frontOutputsOf(
    items.some((item) => blendReflects(item.surface)),
    items.some((item) => hasPhysicalLobes(item.surface)),
  )

/**
 * The front stages of a device's blend layout, one set of three culls for each `FrontOutputs`, its
 * module of its own (`blendFrontShader`): what every blend program's front pass draws with, whatever its
 * lights' key. Their depth is tested and written as the water surface stage's is — the nearest fragment
 * that covers or reflects is the one kept —, on the blend group alone. Nothing is described nor compiled
 * before its first ask: prepare's, for what the scene's transparents reach (`prepare`), or a frame's that
 * reaches another (`ask`), off the frame, the frames held until it lands. A scene without a transparent
 * never asks one. A rank of any blending mode draws its cull's.
 */
export function createFrontStages(device: GPUDevice, layout: GPUBindGroupLayout) {
  const sets: FrontStagePipelines[] = []
  const setOf = (outputs: FrontOutputs): FrontStagePipelines => {
    let culls: PreparedPipeline<GPURenderPipeline>[] | undefined
    const made = () => {
      if (culls) return culls
      const module = device.createShaderModule({
        label: 'Trillion3D front stage',
        code: blendFrontShader(outputs),
      })
      const fragment = { module, entryPoint: 'fsFront', targets: frontStageTargets(outputs) }
      return (culls = stageDescriptors(
        device,
        module,
        layout,
        fragment,
        true,
        undefined,
        false,
      ).map((descriptor) => preparedPipeline(device, descriptor)))
    }
    return {
      get ready() {
        return !!culls && culls.every((cull) => cull.ready)
      },
      ask() {
        for (const cull of made()) cull.ask()
      },
      prepare: () => Promise.all(made().map((cull) => cull.prepare())),
      at: (rank) => made()[rank % 3].get(),
    }
  }
  return (outputs: FrontOutputs) => (sets[outputs] ??= setOf(outputs))
}
