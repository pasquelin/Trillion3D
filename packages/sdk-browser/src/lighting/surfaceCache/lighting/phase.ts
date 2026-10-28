import { stochasticPhase } from '../../../post/taa/frameState.ts'
import { noiseFrame } from '../../../frame/render/noiseFrame.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'

/**
 * The phase the lighting's noise turns on, the one rule for every pass that has such a phase: the view's stochastic rank (`stochasticPhase`) counted from the image the
 * surface cache's light began (`begunSample`), so that two worlds of one scene, one having drawn an image more before the start, meet the same phases from there. A rank
 * below that start is a temporal state made again (the pass rebuilt, switched, a view with a state of its own): the phase counts from it. Before the start, the rank itself.
 * A view with no temporal state has no rank: its phase is the noise's own clock (`noiseFrame`), which turns with every image while the view changes and counts the images
 * of its establishment once it stands still.
 */
export function lightingPhase(
  rt: Pick<WebgpuPagesRuntime, 'gpu' | 'surfaceCache' | 'run' | 'lights'>,
) {
  const temporal = rt.gpu.temporal?.frame
  if (!temporal) return noiseFrame(rt)
  const rank = stochasticPhase(temporal)
  const lighting = rt.surfaceCache?.lighting
  if (lighting?.begunSample === undefined) return rank
  if (rank < lighting.begunSample) lighting.begunSample = rank
  return rank - lighting.begunSample
}
