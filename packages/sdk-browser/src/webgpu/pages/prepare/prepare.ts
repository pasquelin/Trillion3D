import { throwIfStopped } from '../io/lost.ts'
import { prepareGpuTiming } from './timing.ts'
import { type WebgpuPagesRuntime } from '../runtime.ts'
import { prepareWebgpuPages } from './preparePages.ts'

/** Prepares the timer, then the resources on the session handle. */
export async function prepareWebgpuBackend(rt: WebgpuPagesRuntime, device: GPUDevice) {
  // A first claim hears of a device already lost a microtask later: one tick, nothing is built.
  await undefined
  throwIfStopped(rt)
  prepareGpuTiming(rt, device)
  await prepareWebgpuPages(rt, device)
  throwIfStopped(rt)
}
