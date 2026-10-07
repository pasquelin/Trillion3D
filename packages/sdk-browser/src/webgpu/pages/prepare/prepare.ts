import { throwIfStopped } from '../io/lost.ts'
import { prepareGpuTiming } from './timing.ts'
import { reserveRootBoxes } from '../../../page/selection/batchBoxes.ts'
import { type WebgpuPagesRuntime } from '../runtime.ts'
import { prepareWebgpuPages } from './preparePages.ts'

/** Prepares the timer, resources, then root world boxes on the session handle. */
export async function prepareWebgpuBackend(rt: WebgpuPagesRuntime, device: GPUDevice) {
  // A first claim hears of a device already lost a microtask later: one tick, nothing is built.
  await undefined
  throwIfStopped(rt)
  prepareGpuTiming(rt, device)
  await prepareWebgpuPages(rt, device)
  // Root world boxes last: linear memory no longer grows behind them, nor a node move.
  rt.context.preparationStep?.('root boxes')
  rt.layout.rootBoxes = await reserveRootBoxes(rt.layout.selectionRoots)
  throwIfStopped(rt)
}
