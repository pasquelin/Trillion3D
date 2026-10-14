import { prepareDisplayProgram } from './displayFilterProgram.ts'
import type { createRoutedPipelines } from './routedPipelines.ts'
import type { Reach } from './reach.ts'
import type { ModePipelines } from './stagePipelines.ts'

type RoutedPipelines = ReturnType<typeof createRoutedPipelines>

/** Compiles, off the frame, what is reached and not made yet; a program built later, or a reach
 *  that grows, calls it again. The mask pass is one set's, whatever the share; the display layers
 *  are no part of a diagnostic variant (`beginDisplayFilter`). */
export function blendCatchUp(
  device: GPUDevice,
  reach: Reach,
  sets: { perMode: ModePipelines; routed: RoutedPipelines }[],
  maskSet: RoutedPipelines,
  diagnostic: boolean,
) {
  return async () => {
    const { modes, shares } = reach.state
    const filtered = reach.state.filtered && !diagnostic
    const list = [...modes]
    await Promise.all([
      filtered && prepareDisplayProgram(device),
      ...[...shares].map((withShare) => {
        const { perMode, routed } = sets[+withShare]
        return Promise.all([
          perMode.precompile(list),
          filtered && (routed === maskSet ? routed : routed.filtered).precompile(list),
        ])
      }),
    ])
  }
}
