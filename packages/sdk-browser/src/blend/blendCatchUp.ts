import { askDisplayProgram, prepareDisplayProgram } from './display/displayFilterProgram.ts'
import type { createRoutedPipelines } from './routedPipelines.ts'
import type { Reach } from './reach.ts'
import type { VariantPipelines } from './stagePipelines.ts'
import { variantBlending, variantOfBlend } from './plan/planCull.ts'

type RoutedPipelines = ReturnType<typeof createRoutedPipelines>

/** Compiles what is reached and not made yet, off the frame; a program built later calls `prepare`
 *  again, a reach that grows calls `ask`, the frames waiting for the compile (`pipelinesCompiling`).
 *  The responsiveness pass's pipelines are compiled once it is reached, the holdout's — a mode's, in
 *  the forward lighting — once the holdout is accumulated; the display layers are no part of a
 *  diagnostic variant (`beginDisplayFilter`). */
export function blendCatchUp(
  device: GPUDevice,
  reach: Reach,
  set: { perVariant: VariantPipelines; routed: RoutedPipelines },
  responsive: readonly { prepare(): Promise<unknown>; ask(): unknown }[],
  holdout: VariantPipelines,
  diagnostic: boolean,
) {
  const reached = () => {
    const list = [...reach.state.variants]
    return {
      list,
      filtered: reach.state.filtered && !diagnostic,
      held: reach.state.holdout
        ? [...new Set(list.map((variant) => variantOfBlend(variantBlending(variant)!, 'forward')))]
        : [],
    }
  }
  return {
    prepare: async () => {
      const { list, filtered, held } = reached()
      await Promise.all([
        filtered && prepareDisplayProgram(device),
        set.perVariant.precompile(list),
        filtered && set.routed.precompile(list),
        holdout.precompile(held),
        ...(reach.state.responsive ? responsive.map((pipeline) => pipeline.prepare()) : []),
      ])
    },
    ask() {
      const { list, filtered, held } = reached()
      if (filtered) askDisplayProgram(device)
      set.perVariant.ask(list)
      if (filtered) set.routed.ask(list)
      holdout.ask(held)
      if (reach.state.responsive) for (const pipeline of responsive) pipeline.ask()
    },
  }
}
