import { preparedPipeline, type PreparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { FRONT_OUTPUTS, type FrontOutputs } from '../../reflections/frontLayer.ts'
import { fragmentTargets } from '../../gpu/core/fragmentOutputs.ts'
import { stageDescriptors, type FrontStagePipelines } from './stagePipelines.ts'
import { blendFrontShader, blendReflects } from './frontStageWgsl.ts'
import { hasPhysicalLobes } from '../../scene/physicalLobes.ts'
import type { PageSurface } from '../../page/surface.ts'

/** What a front pass of the transparents `items` writes (`FrontOutputs`): nothing past the covering
 *  depth and flags unless one reflects, the lobes too where one carries a lobe. The one decision of
 *  prepare's compile (`prepareFrontStage`) and of the scene refresh the frame reads
 *  (`blendState.frontOutputs`). */
export function frontStageOf(items: readonly { surface: PageSurface }[]): FrontOutputs {
  if (!items.some((item) => blendReflects(item.surface))) return 0
  return items.some((item) => hasPhysicalLobes(item.surface)) ? 2 : 1
}

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
      const fragment = {
        module,
        entryPoint: 'fsFront',
        targets: fragmentTargets(FRONT_OUTPUTS[outputs]),
      }
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

/** Prepare's compile of the front stage the scene's transparents `items` reach (`frontStageOf`), with
 *  them; none without a transparent. Refused, no front pass draws (`frontPass.ts`). */
export const prepareFrontStage = (
  stages: ReturnType<typeof createFrontStages>,
  items: readonly { surface: PageSurface }[],
) =>
  items.length
    ? stages(frontStageOf(items))
        .prepare()
        .catch(() => undefined)
    : undefined
