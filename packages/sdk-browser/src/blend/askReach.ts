import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { activeResponsive } from '../frame/prepare/responsiveTarget.ts'
import { holdoutPassOn } from '../frame/prepare/alphaHoldout.ts'
import { keyFor } from '../frame/prepare/contractLight.ts'
import { wantsContractLighting } from '../frame/prepare/lit.ts'
import { FULL_CONTRACT } from '../lighting/deferred/contractCuts.ts'
import { track } from '../lighting/deferred/compileLedger.ts'
import { askHoldoutPasses } from './holdoutPasses.ts'

/** What a frame asks the programs to reach: one object, refilled each entry. */
const reached = {
  responsive: false,
  refracts: false,
  chromatic: false,
  filtered: false,
  holdout: false,
}

/** At a frame's entry: widens what the blend programs have to draw without compiling by what the
 *  frame needs (`reach.ts`) — the responsiveness pass, the refracting and chromatic layers, the
 *  display layers, the holdout and its passes —; what that adds is compiled with the frames waiting
 *  for it (`pipelinesCompiling`), so the draw finds it made. Likewise the program that lights the
 *  layers with these lights (`litAwaited`): a shadow-casting or rectangle light that appears asks
 *  its program here, before the frame draws, and the frame is held until it lands — no layer is
 *  ever drawn with a program lacking the code the lights need. */
export function askBlendReach(rt: WebgpuPagesRuntime) {
  const { vis, blendState } = rt,
    device = rt.gpu.device
  if (!vis.blendPipelines || !blendState.blendGpu.length || !device) return
  reached.responsive = !!activeResponsive(rt)
  reached.refracts = blendState.refracts
  reached.chromatic = blendState.chromatic
  reached.filtered = blendState.filtersDisplay
  reached.holdout = holdoutPassOn(rt)
  vis.blendPipelines.reach(reached)
  if (reached.holdout) askHoldoutPasses(device)
  // The key the frame will draw with, read off the lights (`keyFor`): unlit images draw with the
  // program of every code path.
  const key = wantsContractLighting(rt) ? keyFor('blend', rt) : FULL_CONTRACT
  track(device, vis.blendPipelines.litAwaited(key, blendState.lobed), true)
}
